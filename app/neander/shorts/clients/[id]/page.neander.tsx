"use client";

// ============================================================
//  고객사 하나 — 월별 영상 · 계약·브리프 · 제품·사진 · 게시 계정 · 월간 보고
// ------------------------------------------------------------
//  고친 것은 저절로 저장된다 (담당자만). 관리자 몰아보기는 읽기 전용으로 잠긴다.
//  영상은 「영상 추가」 로 그 달 계약분을 만든다 — 제품의 확인된 사실이 재료가 되고,
//  바이럴 형식 정찰의 형식 카드를 고르면 그 형식(훅 · 구성 · 편집)을 참고 자료로 옮긴다.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Ban, ChevronLeft, ClipboardCheck, ImageIcon, KeyRound, Plug, Plus, Printer, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  MonthStepper,
  NumberInput,
  PageShell,
  SectionHeader,
  Select,
  Table,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  buttonClass,
  cn,
  type Tone,
  useConfirm,
} from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { ConnBadge, KindTile, PubBadge, StageBadge, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { MediaThumb, MediaUpload, useClientMedia } from "@/components/neander/shorts/media";
import { deleteMedia, mutate, shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, REVIEW_LABEL, currentMonth, latestRound, monthProgress, newId } from "@/lib/neander/shorts/model";
import { splitVat } from "@/lib/neander/finance/project";
import type { AccountView, ClientDoc, ClientView, ProjectDoc, PublishPlatform } from "@/lib/neander/shorts/types";

const TABS = [
  { key: "month", label: "월별 영상" },
  { key: "brief", label: "계약 · 브리프" },
  { key: "products", label: "제품 · 사진" },
  { key: "accounts", label: "게시 계정" },
];

/** 고객 검토 상태 색 — 승인 초록 · 검토 대기 노랑 · 수정 요청 빨강 · 보내기 전 회색 */
const REVIEW_TONE: Record<ProjectDoc["review"]["state"], Tone> = { approved: "success", waiting: "warning", revision: "danger", none: "neutral" };

/** from ~ to 의 달 목록 — MonthStepper 가 받는 대로 최신 달이 앞 */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) (m = 1), y++;
    if (out.length > 60) break;
  }
  return out.reverse();
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useShorts();
  const client = data!.clients.find((c) => c.id === id);
  if (!client) {
    return (
      <PageShell>
        <EmptyState title="고객사를 찾지 못했습니다" description="지워졌거나 내가 담당자가 아닌 고객사입니다." action={<Link href="/neander/shorts/clients" className={buttonClass("secondary")}>목록으로</Link>} />
      </PageShell>
    );
  }
  return <ClientWorkspace key={client.id} initial={client} />;
}

/** 고객사 사본 — 고치면 1.2초 뒤 저장 */
function useClientDraft(initial: ClientView) {
  const { refresh } = useShorts();
  const [c, setC] = useState<ClientView>(initial);
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(c);
  const timer = useRef<number | null>(null);
  ref.current = c;
  const save = useCallback(async () => {
    setState("saving");
    try {
      await mutate("client.save", { id: ref.current.id, client: ref.current });
      setState("saved");
      setError(null);
      await refresh();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    }
  }, [refresh]);
  const update = useCallback(
    (fn: (x: ClientView) => void) => {
      if (!initial.canEdit) return;
      setC((prev) => {
        const next = structuredClone(prev);
        fn(next);
        return next;
      });
      setState("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), 1200);
    },
    [initial.canEdit, save],
  );
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  return { c, update, state, error };
}

function ClientWorkspace({ initial }: { initial: ClientView }) {
  const { data, nameOf } = useShorts();
  const d = data!;
  const router = useRouter();
  const ask = useConfirm();
  const { run } = useAction();
  const { c, update, state, error } = useClientDraft(initial);
  const [tab, setTab] = useState("month");
  useCrumbTail(c.name);
  const readOnly = !initial.canEdit;
  const saveLabel = readOnly ? "읽기 전용" : state === "saving" ? "저장 중…" : state === "dirty" ? "저장 대기" : state === "error" ? "저장 실패" : "저장됨";

  return (
    <PageShell>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/neander/shorts/clients" className="mb-1 inline-flex items-center gap-1 text-[13px] text-nd-fg-3 hover:text-nd-fg">
            <ChevronLeft size={14} /> 고객사
          </Link>
          <Input aria-label="고객사 이름" value={c.name} disabled={readOnly} onChange={(e) => update((x) => void (x.name = e.target.value))} className="h-auto border-transparent bg-transparent px-0 text-nd-title font-semibold shadow-none focus:border-nd-border disabled:bg-transparent disabled:text-nd-fg" />
          <p className="mt-1 text-[13px] text-nd-fg-3">
            담당자 {c.members.map(nameOf).join(", ") || "없음"} · <span className={cn(state === "error" && !readOnly && "font-medium text-nd-danger-text")}>{saveLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select size="sm" aria-label="상태" value={c.status} disabled={readOnly} onChange={(e) => update((x) => void (x.status = e.target.value as ClientDoc["status"]))} className="w-auto">
            <option value="active">진행</option>
            <option value="paused">멈춤</option>
            <option value="ended">종료</option>
          </Select>
          {c.createdBy === d.me && (
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="고객사 지우기" onClick={async () => {
              if (!(await ask({ title: "고객사를 지울까요?", message: "영상이나 고객사 계정이 남아 있으면 지울 수 없습니다 — 그때는 상태를 「종료」 로 바꾸세요.", tone: "danger", confirmLabel: "지우기" }))) return;
              await run("del", async () => { await mutate("client.delete", { id: c.id }); router.push("/neander/shorts/clients"); });
            }} />
          )}
        </div>
      </div>
      {error && <InlineNotice tone="danger" className="mb-4">{error}</InlineNotice>}
      {readOnly && <InlineNotice tone="info" className="mb-4">관리자 몰아보기 — 담당자가 아니라 읽기만 합니다.</InlineNotice>}
      <Tabs className="mb-5" items={TABS} value={tab} onChange={setTab} ariaLabel="고객사" />
      {tab === "month" && <MonthBoard c={c} />}
      <fieldset disabled={readOnly} className="min-w-0">
        {tab === "brief" && <BriefTab c={c} update={update} />}
        {tab === "products" && <ProductsTab c={c} update={update} />}
        {tab === "accounts" && <AccountsTab c={c} />}
      </fieldset>
    </PageShell>
  );
}

// ---- 월별 영상 -----------------------------------------------------------

interface FormatLite {
  id: string;
  name: string;
  summary: string;
  archived: boolean;
  korea: { status: string };
}

/** 고객사 계정이 하나라도 연결돼 있는가 — 고객사 계정 게시의 전제 */
const clientConnected = (accounts: AccountView[], clientId: string) => accounts.some((a) => a.clientId === clientId && a.status === "connected");

function MonthBoard({ c }: { c: ClientView }) {
  const { data, refresh } = useShorts();
  const d = data!;
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [adding, setAdding] = useState(false);
  const months = useMemo(() => {
    const last = (() => {
      const [y, m] = currentMonth().split("-").map(Number);
      const t = new Date(Date.UTC(y, m + 1, 1));
      return t.toISOString().slice(0, 7);
    })();
    return monthsBetween(c.contract.startMonth < currentMonth() ? c.contract.startMonth : currentMonth(), last);
  }, [c.contract.startMonth]);
  const projects = d.projects.filter((p) => p.clientId === c.id && p.month === month);
  const prog = monthProgress(projects, c.contract.videosPerMonth);
  const connected = clientConnected(d.accounts, c.id);
  const left = prog.planned - prog.made;
  const addButton = (
    <Button icon={Plus} disabled={!c.canEdit} onClick={() => setAdding(true)}>영상 추가</Button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthStepper months={months} value={month} onChange={setMonth} />
        <div className="flex flex-wrap gap-2">
          <Link href={`/neander/shorts/clients/${c.id}/report?month=${month}`} className={buttonClass("secondary")}>
            <Printer size={16} aria-hidden /> {Number(month.slice(5))}월 보고
          </Link>
          {addButton}
        </div>
      </div>
      <KpiStrip columns={6}>
        <KpiItem label="계약" value={String(prog.planned)} unit="편" hint={`편당 수정 ${c.contract.revisionLimit}회까지`} />
        <KpiItem label="제작" value={String(prog.made)} unit="편" hint={left > 0 ? `계약까지 ${left}편 남음` : left < 0 ? `계약보다 ${-left}편 많음` : "계약 편수를 채움"} />
        <KpiItem label="고객 승인" value={String(prog.approved)} unit="편" tone="success" />
        <KpiItem label="검토 대기" value={String(prog.waiting)} unit="편" tone="warning" />
        <KpiItem label="수정 요청 중" value={String(prog.revision)} unit="편" tone="danger" />
        <KpiItem label="게시됨" value={String(prog.published)} unit="편" tone="success" />
      </KpiStrip>
      {projects.length === 0 ? (
        <EmptyState
          compact
          icon={ClipboardCheck}
          title={`${Number(month.slice(5))}월 영상이 없습니다`}
          description={`계약은 월 ${c.contract.videosPerMonth}편입니다. 「영상 추가」 로 제품 · 정찰 형식을 골라 시작하세요.`}
          action={addButton}
        />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table size="md" minWidth={1040}>
              <thead>
                <tr>
                  <Th>영상</Th>
                  <Th>단계</Th>
                  <Th>고객 검토</Th>
                  <Th align="right">수정 사용 / 상한</Th>
                  <Th>올릴 곳</Th>
                  <Th>게시</Th>
                  <Th align="right">갱신</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const pubs = d.publications.filter((x) => x.projectId === p.id);
                  const product = c.products.find((x) => x.id === p.clientProductId)?.name ?? "제품 미정";
                  const round = latestRound(p.review);
                  const overLimit = p.review.revisionsUsed > c.contract.revisionLimit;
                  return (
                    <Tr key={p.id}>
                      <Td className="max-w-[360px]">
                        <div className="flex min-w-0 items-center gap-3">
                          <KindTile kind="brand" />
                          <div className="min-w-0">
                            <Link href={`/neander/shorts/projects/${p.id}`} title={p.title} className="block truncate font-medium hover:underline">{p.title}</Link>
                            <div className="truncate text-[13px] text-nd-fg-3" title={product}>{product}{p.formatId ? " · 정찰 형식" : ""}</div>
                          </div>
                        </div>
                      </Td>
                      <Td><StageBadge stage={p.stage} size="lg" /></Td>
                      <Td>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <Badge size="lg" tone={REVIEW_TONE[p.review.state]}>{REVIEW_LABEL[p.review.state]}</Badge>
                          {round && <span className="nd-num whitespace-nowrap text-[13px] text-nd-fg-3">{round.n}차</span>}
                        </div>
                      </Td>
                      <Td num className={overLimit ? "font-medium text-nd-danger-text" : ""} title={overLimit ? "계약상 수정 횟수를 넘었습니다 (별도 협의 대상)" : undefined}>
                        {p.review.revisionsUsed} / {c.contract.revisionLimit}
                        {overLimit && <span className="ml-1 text-[13px]">초과</span>}
                      </Td>
                      <Td>
                        {p.brandTarget === "client" ? (
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span>고객사 계정</span>
                            <ConnBadge ok={connected} on="연결됨" off="연결 필요" offTone="danger" />
                          </div>
                        ) : (
                          <span className="whitespace-nowrap text-nd-fg-2">우리 채널 <span className="text-[13px] text-nd-fg-3">(광고 고지)</span></span>
                        )}
                      </Td>
                      <Td>
                        {pubs.length ? (
                          <div className="space-y-1.5">
                            {pubs.map((x) => (
                              <div key={x.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <PubBadge status={x.status} size="lg" />
                                <span className="whitespace-nowrap text-[13px] text-nd-fg-3">
                                  {PLATFORM_LABEL[x.platform]} · {fmtWhen(x.result?.at ?? x.scheduledAt ?? x.updatedAt)}
                                  {x.result?.by === "manual" ? " · 수동 기록" : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-nd-fg-3" title="아직 게시 기록이 없습니다">—</span>
                        )}
                      </Td>
                      <Td num className="whitespace-nowrap text-[13px] text-nd-fg-3">{fmtWhen(p.updatedAt)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {adding && <AddVideo c={c} month={month} onClose={() => setAdding(false)} onCreated={async (id) => { await refresh(); router.push(`/neander/shorts/projects/${id}?tab=client`); }} />}
    </div>
  );
}

function AddVideo({ c, month, onClose, onCreated }: { c: ClientView; month: string; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  const [formats, setFormats] = useState<FormatLite[] | null>(null);
  const [f, setF] = useState({ productId: c.products[0]?.id ?? "", formatId: "", brandTarget: "client" as "client" | "own", title: "" });
  useEffect(() => {
    shortsGet<{ formats: FormatLite[] }>("scout").then((r) => setFormats(r.formats.filter((x) => !x.archived)), () => setFormats([]));
  }, []);
  const KOREA: Record<string, string> = { unchecked: "국내 미확인", none_in_sample: "국내 표본에 없음", some: "국내에 조금", spread: "국내에 퍼짐" };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${Number(month.slice(5))}월 영상 추가`}
      description="제품의 확인된 사실이 대본의 재료가 됩니다. 정찰 형식을 고르면 그 형식의 훅 · 구성 · 편집이 참고 자료로 들어갑니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={busy === "a"} onClick={() => void run("a", async () => { const r = await mutate<{ id: string }>("client.createProject", { clientId: c.id, month, ...f }); await onCreated(r.id); })}>만들기</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="제품">
          <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
            <option value="">(제품 미정)</option>
            {c.products.map((p) => <option key={p.id} value={p.id}>{p.name} · 사실 {p.facts.length}개 · 사진 {p.photoIds.length}장</option>)}
          </Select>
        </Field>
        <Field label="바탕 형식 (바이럴 형식 정찰)" hint={formats === null ? "불러오는 중…" : formats.length ? "해외에서 먹히고 국내에 아직 덜 퍼진 형식이 들여오기 좋습니다" : "정찰 형식 카드가 아직 없습니다"}>
          <Select value={f.formatId} onChange={(e) => setF({ ...f, formatId: e.target.value })}>
            <option value="">(형식 없이)</option>
            {(formats ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} · {KOREA[x.korea.status] ?? x.korea.status}</option>)}
          </Select>
        </Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="올릴 곳" hint="고객사 계정이면 자기 광고라 고지 불필요 · 우리 채널이면 「광고」 고지">
            <Select value={f.brandTarget} onChange={(e) => setF({ ...f, brandTarget: e.target.value as "client" | "own" })}>
              <option value="client">고객사 계정</option>
              <option value="own">우리 채널</option>
            </Select>
          </Field>
          <Field label="제목 (비우면 자동)"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        </FormRow>
      </div>
    </Dialog>
  );
}

// ---- 계약 · 브리프 ---------------------------------------------------------

function ListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder,
  tone = "neutral",
  className,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /** danger — 금지 표현처럼 눈에 띄어야 하는 목록 */
  tone?: "neutral" | "danger";
  className?: string;
}) {
  const [text, setText] = useState("");
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="space-y-2">
        {values.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {values.map((v, i) => (
              <span
                key={`${v}-${i}`}
                title={v}
                className={cn(
                  "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full py-1 pl-3 pr-2 text-[13px]",
                  tone === "danger" ? "bg-nd-danger-soft font-medium text-nd-danger-text" : "bg-nd-fg/[.06] text-nd-fg",
                )}
              >
                <span className="min-w-0 break-all">{v}</span>
                <button type="button" aria-label={`${v} 지우기`} className="shrink-0 rounded-full p-0.5 text-nd-fg-3 hover:bg-nd-fg/10 hover:text-nd-danger disabled:hidden" onClick={() => onChange(values.filter((_, j) => j !== i))}>
                  <X size={13} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <Input
          size="sm"
          value={text}
          placeholder={placeholder ?? "입력 후 Enter"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              onChange([...values, text.trim()]);
              setText("");
            }
          }}
        />
      </div>
    </Field>
  );
}

/** 월 금액을 부가세 기준에 따라 풀어 보인다 — 공급가액 · 부가세 · 받을 돈 */
function VatBreakdown({ fee, vat }: { fee: number | null; vat: ClientDoc["contract"]["vat"] }) {
  if (fee === null || !(fee > 0)) {
    return <p className="rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] text-nd-fg-3">월 금액을 적으면 공급가액 · 부가세 · 받을 돈을 나눠 보여 줍니다.</p>;
  }
  const s = splitVat(fee, vat);
  const rows: [string, number, boolean][] = [
    ["공급가액", s.supply, vat === "excluded"],
    ["부가세 10%", s.vat, false],
    ["받을 돈 (월)", s.total, vat === "included"],
  ];
  return (
    <div className="rounded-nd-md bg-nd-sunken px-3 py-2">
      <dl className="grid grid-cols-3 gap-3">
        {rows.map(([k, v, typed]) => (
          <div key={k} className="min-w-0">
            <dt className="truncate text-[13px] text-nd-fg-3">{k}{typed ? " · 적은 금액" : ""}</dt>
            <dd className="nd-num truncate font-semibold text-nd-fg">{won(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[13px] text-nd-fg-3">{vat === "excluded" ? "부가세 별도 — 적은 금액이 공급가액이고 부가세 10% 를 더 받습니다." : "부가세 포함 — 적은 금액 안에 부가세가 들어 있습니다."}</p>
    </div>
  );
}

function BriefTab({ c, update }: { c: ClientView; update: (fn: (x: ClientView) => void) => void }) {
  const [members, setMembers] = useState(c.members.join(", "));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <section className="min-w-0">
        <SectionHeader size="lg" title="계약" hint="조회수는 약속하지 않습니다 — 계약은 제작 편수 · 수정 횟수까지" />
        <Card className="space-y-4">
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Field label="월 금액 (원)"><NumberInput size="sm" value={c.contract.monthlyFeeKrw} onValueChange={(r) => update((x) => void (x.contract.monthlyFeeKrw = r === "" ? null : Number(r)))} /></Field>
            <Field label="부가세">
              <Select size="sm" value={c.contract.vat} onChange={(e) => update((x) => void (x.contract.vat = e.target.value as "excluded" | "included"))}>
                <option value="excluded">별도</option>
                <option value="included">포함</option>
              </Select>
            </Field>
          </FormRow>
          <VatBreakdown fee={c.contract.monthlyFeeKrw} vat={c.contract.vat} />
          <FormRow className="grid-cols-2">
            <Field label="월 편수"><NumberInput size="sm" value={c.contract.videosPerMonth} onValueChange={(r) => update((x) => void (x.contract.videosPerMonth = Math.max(1, Number(r) || 1)))} /></Field>
            <Field label="한 편당 수정 횟수"><NumberInput size="sm" value={c.contract.revisionLimit} onValueChange={(r) => update((x) => void (x.contract.revisionLimit = Math.max(0, Number(r) || 0)))} /></Field>
          </FormRow>
          <FormRow className="grid-cols-2">
            <Field label="시작 월"><Input size="sm" type="month" value={c.contract.startMonth} onChange={(e) => update((x) => void (x.contract.startMonth = e.target.value))} /></Field>
            <Field label="끝 월 (비우면 계속)"><Input size="sm" type="month" value={c.contract.endMonth ?? ""} onChange={(e) => update((x) => void (x.contract.endMonth = e.target.value || null))} /></Field>
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="재무 프로젝트 코드" hint="입금 · 손익은 재무에서"><Input size="sm" value={c.contract.financeCode} placeholder="PJ-…" onChange={(e) => update((x) => void (x.contract.financeCode = e.target.value))} /></Field>
            <Field label="고객사 담당자 이름"><Input size="sm" value={c.contactName} onChange={(e) => update((x) => void (x.contactName = e.target.value))} /></Field>
          </FormRow>
          <Field label="계약 메모"><Textarea rows={3} value={c.contract.note} onChange={(e) => update((x) => void (x.contract.note = e.target.value))} /></Field>
          <FormRow className="grid-cols-[minmax(0,1fr)_auto]">
            <Field label="우리 쪽 담당자 (ERP 이메일, 쉼표)" hint="이 사람들이 고객사 자료 · 영상 · 계정을 함께 씁니다"><Input size="sm" value={members} onChange={(e) => setMembers(e.target.value)} /></Field>
            <FieldAction>
              <Button size="sm" variant="secondary" onClick={() => update((x) => void (x.members = members.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)))}>담당자 반영</Button>
            </FieldAction>
          </FormRow>
        </Card>
      </section>
      <section className="min-w-0">
        <SectionHeader size="lg" title="브리프" hint="AI 대본 · 문구 검사가 이 내용을 씁니다" />
        <Card className="space-y-4">
          <div className="flex gap-3 rounded-nd-md border border-nd-danger/25 bg-nd-danger-soft/40 p-3.5">
            <Ban size={18} aria-hidden className="mt-0.5 shrink-0 text-nd-danger" />
            <ListEditor tone="danger" className="min-w-0 flex-1" label="금지 표현" hint="대본 · 게시 문구에 들어가면 게시 전 점검이 찾아냅니다 (AI 에게도 금지로 넘깁니다)" values={c.brief.banned} onChange={(v) => update((x) => void (x.brief.banned = v))} placeholder="예: 최저가 · 1위 · 치료 · 경쟁사 이름" />
          </div>
          <Field label="브랜드 · 캠페인 요약"><Textarea rows={3} value={c.brief.summary} onChange={(e) => update((x) => void (x.brief.summary = e.target.value))} /></Field>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="대상 (누구에게)"><Input size="sm" value={c.brief.target} onChange={(e) => update((x) => void (x.brief.target = e.target.value))} /></Field>
            <Field label="말투"><Input size="sm" value={c.brief.tone} onChange={(e) => update((x) => void (x.brief.tone = e.target.value))} placeholder="예: 담백하고 친근하게, 과장 없이" /></Field>
          </FormRow>
          <FormRow className="grid-cols-1 lg:grid-cols-2">
            <ListEditor label="핵심 메시지" values={c.brief.keyMessages} onChange={(v) => update((x) => void (x.brief.keyMessages = v))} />
            <ListEditor label="반드시 넣을 것" values={c.brief.mustInclude} onChange={(v) => update((x) => void (x.brief.mustInclude = v))} />
          </FormRow>
          <ListEditor label="참고 영상 · 자료 주소" values={c.brief.references} onChange={(v) => update((x) => void (x.brief.references = v))} placeholder="https://…" />
          <Field label="그 밖의 지시"><Textarea rows={4} value={c.brief.notes} onChange={(e) => update((x) => void (x.brief.notes = e.target.value))} /></Field>
        </Card>
      </section>
    </div>
  );
}

// ---- 제품 · 사진 -----------------------------------------------------------

function Photo({ id, alt, onRemove }: { id: string; alt: string; onRemove: () => void }) {
  return (
    <div className="relative">
      <MediaThumb id={id} type="image/*" alt={alt} className="aspect-square w-full rounded-nd-md" />
      <button
        type="button"
        aria-label="사진 지우기"
        title="사진 지우기"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:hidden"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

function ProductsTab({ c, update }: { c: ClientView; update: (fn: (x: ClientView) => void) => void }) {
  const { media, refresh } = useClientMedia(c.id);
  const ask = useConfirm();
  const addProduct = () => update((x) => void x.products.push({ id: newId("pd_"), name: "새 제품", url: "", facts: [], photoIds: [], note: "" }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-nd-body text-nd-fg-2">실사진은 AI 장면을 실제 제품과 비교하는 기준이 됩니다. 확인된 사실 밖의 성능 · 가격 · 후기는 대본에 쓰지 않습니다.</p>
        <Button size="sm" icon={Plus} onClick={addProduct}>제품 추가</Button>
      </div>
      {c.products.length === 0 && <EmptyState compact icon={ImageIcon} title="제품이 없습니다" description="홍보할 제품과 확인된 사실 · 실사진을 넣어 주세요." action={<Button size="sm" icon={Plus} onClick={addProduct}>제품 추가</Button>} />}
      {c.products.map((p, i) => (
        <Card key={p.id}>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <FormRow className="grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                <Field label="제품 이름"><Input size="sm" value={p.name} onChange={(e) => update((x) => void (x.products[i].name = e.target.value))} /></Field>
                <Field label="제품 주소" className="order-last col-span-2 sm:order-none sm:col-span-1"><Input size="sm" value={p.url} onChange={(e) => update((x) => void (x.products[i].url = e.target.value))} placeholder="https://…" /></Field>
                <FieldAction>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="제품 지우기" onClick={async () => {
                    if (!(await ask({ title: `「${p.name}」 을 지울까요?`, tone: "danger", confirmLabel: "지우기" }))) return;
                    update((x) => void x.products.splice(i, 1));
                  }} />
                </FieldAction>
              </FormRow>
              <ListEditor label="확인된 사실" hint="고객사 자료 · 상세 페이지로 확인한 것만" values={p.facts} onChange={(v) => update((x) => void (x.products[i].facts = v))} />
              <Field label="메모"><Input size="sm" value={p.note} onChange={(e) => update((x) => void (x.products[i].note = e.target.value))} /></Field>
            </div>
            <div className="min-w-0 space-y-2.5">
              <p className="text-nd-body font-medium text-nd-fg">실사진 <span className="nd-num text-nd-fg-3">{p.photoIds.length}장</span></p>
              {p.photoIds.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {p.photoIds.map((pid) => (
                    <Photo
                      key={pid}
                      id={pid}
                      alt={media.find((m) => m.id === pid)?.name ?? `${p.name} 사진`}
                      onRemove={async () => {
                        await deleteMedia(pid).catch(() => undefined);
                        update((x) => void (x.products[i].photoIds = x.products[i].photoIds.filter((y) => y !== pid)));
                        await refresh();
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-nd-fg-3">아직 실사진이 없습니다 — 실제 제품 사진을 올리면 AI 장면과 비교하는 기준이 됩니다.</p>
              )}
              <MediaUpload compact projectId="" clientId={c.id} kind="image" title="제품 사진 올리기" onUploaded={async (ms) => { update((x) => void x.products[i].photoIds.push(...ms.map((m) => m.id))); await refresh(); }} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---- 게시 계정 -------------------------------------------------------------

function AccountsTab({ c }: { c: ClientView }) {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const [manual, setManual] = useState(false);
  const accounts = d.accounts.filter((a) => a.clientId === c.id);
  const s = d.status;
  const connect = (platform: "youtube" | "instagram") =>
    run(platform, async () => {
      const r = await shortsPost<{ url: string }>("oauth", { platform, clientId: c.id });
      window.location.assign(r.url);
    });
  /** 연결 버튼을 못 누르는 까닭 — 서버 설정 · 권한 */
  const blocked = (app: { configured: boolean; missing: string[] }, appName: string) => {
    if (!c.canEdit) return "담당자만 연결할 수 있습니다.";
    if (!app.configured) return `서버에 ${appName} 연결 설정이 없습니다${app.missing.length ? ` (빠진 값: ${app.missing.join(", ")})` : ""}.`;
    if (!s.tokenKey.configured) return "서버에 토큰 암호화 키가 없습니다.";
    return null;
  };
  const platforms: { key: PublishPlatform; app: { configured: boolean; missing: string[] }; appName: string; need: string }[] = [
    { key: "youtube", app: s.youtubeOAuth, appName: "YouTube", need: "고객사 YouTube 채널의 관리자 권한" },
    { key: "instagram", app: s.meta, appName: "Instagram (Meta)", need: "고객사 Meta 비즈니스 · Instagram 프로페셔널 계정 권한" },
  ];
  return (
    <div className="space-y-4">
      <InlineNotice tone="info">
        고객사 계정은 고객사의 것입니다 — 담당자 누구나 이 계정으로 게시하고, 토큰은 서버에 암호화해 둡니다. 고객사 계정에 올리는 브랜드 영상은 자기 광고라 「광고」 고지가 필요 없습니다. 연결은 고객사가 우리에게 계정 권한(Meta 비즈니스 · YouTube 관리자)을 준 뒤에 합니다.
      </InlineNotice>
      {accounts.length === 0 ? (
        <InlineNotice tone="warning">
          아직 연결한 고객사 계정이 없습니다 — 고객사 계정 게시는 미연결 상태입니다. 우리 채널에 「광고」 고지를 달아 올릴 수는 있습니다.
        </InlineNotice>
      ) : (
        !accounts.some((a) => a.status === "connected") && (
          <InlineNotice tone="warning">연결이 끊긴 고객사 계정만 있습니다 — 다시 연결해야 고객사 계정으로 게시할 수 있습니다.</InlineNotice>
        )
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {platforms.map(({ key, app, appName, need }) => {
          const list = accounts.filter((a) => a.platform === key);
          const ok = list.some((a) => a.status === "connected");
          const reauth = !ok && list.some((a) => a.status === "needs_reauth");
          const why = blocked(app, appName);
          return (
            <Card key={key} className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-nd-section text-nd-fg">고객사 {PLATFORM_LABEL[key]}</h3>
                {reauth ? <Badge tone="warning" size="lg">다시 연결 필요</Badge> : <ConnBadge ok={ok} on="연결됨" off="연결 필요" offTone="danger" size="lg" />}
              </div>
              {list.length ? (
                <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
                  {list.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                      <span className="min-w-0 truncate font-medium" title={a.externalName}>{a.externalName}</span>
                      {a.status === "connected" ? <Badge tone="success">연결됨</Badge> : <Badge tone="warning">다시 연결 필요</Badge>}
                      <span className="text-[13px] text-nd-fg-3">연결 {nameOf(a.owner)} · {fmtWhen(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-nd-fg-3">연결한 계정이 없습니다 — 연결하려면 {need}이 필요합니다.</p>
              )}
              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" icon={Plug} disabled={!!why || busy === key} onClick={() => void connect(key)}>
                  고객사 {PLATFORM_LABEL[key]} 연결
                </Button>
                {key === "instagram" && (
                  <Button size="sm" variant="secondary" icon={KeyRound} disabled={!c.canEdit || !s.tokenKey.configured} onClick={() => setManual(true)}>Instagram 토큰 직접 입력</Button>
                )}
              </div>
              {why && <p className="break-words text-[13px] text-nd-fg-3">{why}</p>}
            </Card>
          );
        })}
      </div>
      {manual && <ManualToken clientId={c.id} onClose={() => setManual(false)} onDone={async () => { setManual(false); await refresh(); }} />}
    </div>
  );
}

function ManualToken({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ igUserId: "", token: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="고객사 Instagram 토큰 직접 입력"
      description="서버가 읽기 요청으로 계정을 확인한 뒤에만 고객사 계정으로 암호화해 저장합니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={busy === "m" || !f.igUserId || !f.token} onClick={() => void run("m", async () => { await mutate("account.manualInstagram", { ...f, clientId }); await onDone(); }, "고객사 계정을 연결했습니다.")}>확인 후 연결</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Instagram 프로페셔널 계정 ID (숫자)"><Input value={f.igUserId} onChange={(e) => setF({ ...f, igUserId: e.target.value.trim() })} /></Field>
        <Field label="페이지 접근 토큰"><Input type="password" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value.trim() })} /></Field>
      </div>
    </Dialog>
  );
}
