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
import { ChevronLeft, ClipboardCheck, KeyRound, Plug, Plus, Printer, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
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
  useConfirm,
} from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { PubBadge, StageBadge, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { MediaUpload, useBlobUrl, useClientMedia } from "@/components/neander/shorts/media";
import { deleteMedia, mutate, shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, REVIEW_LABEL, currentMonth, monthProgress, newId } from "@/lib/neander/shorts/model";
import type { ClientDoc, ClientView } from "@/lib/neander/shorts/types";

const TABS = [
  { key: "month", label: "월별 영상" },
  { key: "brief", label: "계약 · 브리프" },
  { key: "products", label: "제품 · 사진" },
  { key: "accounts", label: "게시 계정" },
];

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
  return out;
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useShorts();
  const client = data!.clients.find((c) => c.id === id);
  if (!client) {
    return (
      <PageShell>
        <EmptyState title="고객사를 찾지 못했습니다" description="지워졌거나 내가 담당자가 아닌 고객사입니다." action={<Link href="/neander/shorts/clients"><Button variant="secondary">목록으로</Button></Link>} />
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

  return (
    <PageShell>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/neander/shorts/clients" className="mb-1 inline-flex items-center gap-1 text-nd-caption text-nd-fg-3 hover:text-nd-fg">
            <ChevronLeft size={14} /> 고객사
          </Link>
          <Input aria-label="고객사 이름" value={c.name} disabled={readOnly} onChange={(e) => update((x) => void (x.name = e.target.value))} className="h-auto border-transparent bg-transparent px-0 text-nd-title font-semibold shadow-none focus:border-nd-border" />
          <p className="mt-1 text-nd-caption text-nd-fg-3">
            담당자 {c.members.map(nameOf).join(", ")} · {readOnly ? "읽기 전용" : state === "saving" ? "저장 중…" : state === "dirty" ? "저장 대기" : state === "error" ? "저장 실패" : "저장됨"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select size="sm" aria-label="상태" value={c.status} disabled={readOnly} onChange={(e) => update((x) => void (x.status = e.target.value as ClientDoc["status"]))}>
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthStepper months={months} value={month} onChange={setMonth} />
        <div className="flex gap-2">
          <Link href={`/neander/shorts/clients/${c.id}/report?month=${month}`}><Button variant="secondary" icon={Printer}>{month.slice(5)}월 보고</Button></Link>
          <Button icon={Plus} disabled={!c.canEdit} onClick={() => setAdding(true)}>영상 추가</Button>
        </div>
      </div>
      <KpiStrip columns={5}>
        <KpiItem label="제작 / 계약" value={`${prog.made} / ${prog.planned}`} unit="편" />
        <KpiItem label="고객 승인" value={String(prog.approved)} unit="편" />
        <KpiItem label="검토 대기" value={String(prog.waiting)} unit="편" />
        <KpiItem label="수정 요청 중" value={String(prog.revision)} unit="편" />
        <KpiItem label="게시됨" value={String(prog.published)} unit="편" />
      </KpiStrip>
      {projects.length === 0 ? (
        <EmptyState compact icon={ClipboardCheck} title={`${month.slice(5)}월 영상이 없습니다`} description={`계약은 월 ${c.contract.videosPerMonth}편입니다. 「영상 추가」 로 제품 · 정찰 형식을 골라 시작하세요.`} />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={860}>
              <thead>
                <tr>
                  <Th>영상</Th>
                  <Th>단계</Th>
                  <Th>고객 검토</Th>
                  <Th align="right">수정 사용 / 상한</Th>
                  <Th>올릴 곳</Th>
                  <Th>게시</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const pubs = d.publications.filter((x) => x.projectId === p.id);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`/neander/shorts/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                        <div className="text-nd-caption text-nd-fg-3">{c.products.find((x) => x.id === p.clientProductId)?.name ?? "제품 미정"}{p.formatId ? " · 정찰 형식" : ""}</div>
                      </Td>
                      <Td><StageBadge stage={p.stage} /></Td>
                      <Td><Badge size="sm" tone={p.review.state === "approved" ? "success" : p.review.state === "waiting" ? "info" : p.review.state === "revision" ? "warning" : "neutral"}>{REVIEW_LABEL[p.review.state]}</Badge></Td>
                      <Td num className={p.review.revisionsUsed > c.contract.revisionLimit ? "text-nd-danger-text" : ""}>{p.review.revisionsUsed} / {c.contract.revisionLimit}</Td>
                      <Td muted>{p.brandTarget === "client" ? "고객사 계정" : "우리 채널 (광고 고지)"}</Td>
                      <Td>{pubs.length ? pubs.map((x) => <span key={x.id} className="mr-1"><PubBadge status={x.status} /></span>) : <span className="text-nd-caption text-nd-fg-3">—</span>}</Td>
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
      title={`${month.slice(5)}월 영상 추가`}
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

function ListEditor({ label, hint, values, onChange, placeholder }: { label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-nd-fg/[.06] px-2.5 py-1 text-nd-caption">
              {v}
              <button type="button" aria-label={`${v} 지우기`} className="text-nd-fg-3 hover:text-nd-danger" onClick={() => onChange(values.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
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

function BriefTab({ c, update }: { c: ClientView; update: (fn: (x: ClientView) => void) => void }) {
  const [members, setMembers] = useState(c.members.join(", "));
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title="계약" hint="조회수는 약속하지 않습니다 — 계약은 제작 편수 · 수정 횟수까지" />
        <Card className="space-y-3">
          <FormRow className="grid-cols-2 sm:grid-cols-4">
            <Field label="월 금액 (원)"><NumberInput size="sm" value={c.contract.monthlyFeeKrw} onValueChange={(r) => update((x) => void (x.contract.monthlyFeeKrw = r === "" ? null : Number(r)))} /></Field>
            <Field label="부가세">
              <Select size="sm" value={c.contract.vat} onChange={(e) => update((x) => void (x.contract.vat = e.target.value as "excluded" | "included"))}>
                <option value="excluded">별도</option>
                <option value="included">포함</option>
              </Select>
            </Field>
            <Field label="월 편수"><NumberInput size="sm" value={c.contract.videosPerMonth} onValueChange={(r) => update((x) => void (x.contract.videosPerMonth = Math.max(1, Number(r) || 1)))} /></Field>
            <Field label="한 편당 수정 횟수"><NumberInput size="sm" value={c.contract.revisionLimit} onValueChange={(r) => update((x) => void (x.contract.revisionLimit = Math.max(0, Number(r) || 0)))} /></Field>
          </FormRow>
          <FormRow className="grid-cols-2 sm:grid-cols-4">
            <Field label="시작 월"><Input size="sm" type="month" value={c.contract.startMonth} onChange={(e) => update((x) => void (x.contract.startMonth = e.target.value))} /></Field>
            <Field label="끝 월 (비우면 계속)"><Input size="sm" type="month" value={c.contract.endMonth ?? ""} onChange={(e) => update((x) => void (x.contract.endMonth = e.target.value || null))} /></Field>
            <Field label="재무 프로젝트 코드" hint="입금 · 손익은 재무에서"><Input size="sm" value={c.contract.financeCode} placeholder="PJ-…" onChange={(e) => update((x) => void (x.contract.financeCode = e.target.value))} /></Field>
            <Field label="고객사 담당자 이름"><Input size="sm" value={c.contactName} onChange={(e) => update((x) => void (x.contactName = e.target.value))} /></Field>
          </FormRow>
          <Field label="계약 메모"><Textarea rows={2} value={c.contract.note} onChange={(e) => update((x) => void (x.contract.note = e.target.value))} /></Field>
          <FormRow className="grid-cols-1 sm:grid-cols-[3fr_auto]">
            <Field label="우리 쪽 담당자 (ERP 이메일, 쉼표)" hint="이 사람들이 고객사 자료 · 영상 · 계정을 함께 씁니다"><Input size="sm" value={members} onChange={(e) => setMembers(e.target.value)} /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" variant="secondary" onClick={() => update((x) => void (x.members = members.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)))}>담당자 반영</Button>
            </div>
          </FormRow>
        </Card>
      </section>
      <section>
        <SectionHeader title="브리프" hint="AI 대본 · 문구 검사가 이 내용을 씁니다" />
        <Card className="space-y-3">
          <Field label="브랜드 · 캠페인 요약"><Textarea rows={3} value={c.brief.summary} onChange={(e) => update((x) => void (x.brief.summary = e.target.value))} /></Field>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="대상 (누구에게)"><Input size="sm" value={c.brief.target} onChange={(e) => update((x) => void (x.brief.target = e.target.value))} /></Field>
            <Field label="말투"><Input size="sm" value={c.brief.tone} onChange={(e) => update((x) => void (x.brief.tone = e.target.value))} placeholder="예: 담백하고 친근하게, 과장 없이" /></Field>
          </FormRow>
          <ListEditor label="핵심 메시지" values={c.brief.keyMessages} onChange={(v) => update((x) => void (x.brief.keyMessages = v))} />
          <ListEditor label="반드시 넣을 것" values={c.brief.mustInclude} onChange={(v) => update((x) => void (x.brief.mustInclude = v))} />
          <ListEditor label="금지 표현" hint="대본 · 게시 문구에 들어가면 게시 전 점검이 찾아냅니다 (AI 에게도 금지로 넘깁니다)" values={c.brief.banned} onChange={(v) => update((x) => void (x.brief.banned = v))} placeholder="예: 최저가 · 1위 · 치료 · 경쟁사 이름" />
          <ListEditor label="참고 영상 · 자료 주소" values={c.brief.references} onChange={(v) => update((x) => void (x.brief.references = v))} placeholder="https://…" />
          <Field label="그 밖의 지시"><Textarea rows={3} value={c.brief.notes} onChange={(e) => update((x) => void (x.brief.notes = e.target.value))} /></Field>
        </Card>
      </section>
    </div>
  );
}

// ---- 제품 · 사진 -----------------------------------------------------------

function Photo({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { url } = useBlobUrl(id);
  return (
    <div className="relative h-24 w-24 overflow-hidden rounded-nd-md bg-nd-fg/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      <button type="button" aria-label="사진 지우기" onClick={onRemove} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-white">×</button>
    </div>
  );
}

function ProductsTab({ c, update }: { c: ClientView; update: (fn: (x: ClientView) => void) => void }) {
  const { refresh } = useClientMedia(c.id);
  const ask = useConfirm();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-nd-body text-nd-fg-2">실사진은 AI 장면을 실제 제품과 비교하는 기준이 됩니다. 확인된 사실 밖의 성능 · 가격 · 후기는 대본에 쓰지 않습니다.</p>
        <Button size="sm" icon={Plus} onClick={() => update((x) => void x.products.push({ id: newId("pd_"), name: "새 제품", url: "", facts: [], photoIds: [], note: "" }))}>제품 추가</Button>
      </div>
      {c.products.length === 0 && <EmptyState compact title="제품이 없습니다" description="홍보할 제품과 확인된 사실 · 실사진을 넣어 주세요." />}
      {c.products.map((p, i) => (
        <Card key={p.id} className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[1.5fr_2fr_auto]">
            <Field label="제품 이름"><Input size="sm" value={p.name} onChange={(e) => update((x) => void (x.products[i].name = e.target.value))} /></Field>
            <Field label="제품 주소"><Input size="sm" value={p.url} onChange={(e) => update((x) => void (x.products[i].url = e.target.value))} placeholder="https://…" /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="제품 지우기" onClick={async () => {
                if (!(await ask({ title: `「${p.name}」 을 지울까요?`, tone: "danger", confirmLabel: "지우기" }))) return;
                update((x) => void x.products.splice(i, 1));
              }} />
            </div>
          </FormRow>
          <ListEditor label="확인된 사실" hint="고객사 자료 · 상세 페이지로 확인한 것만" values={p.facts} onChange={(v) => update((x) => void (x.products[i].facts = v))} />
          <Field label="메모"><Input size="sm" value={p.note} onChange={(e) => update((x) => void (x.products[i].note = e.target.value))} /></Field>
          <div>
            <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">실사진 {p.photoIds.length}장</p>
            <div className="flex flex-wrap gap-2">
              {p.photoIds.map((pid) => (
                <Photo key={pid} id={pid} onRemove={async () => {
                  await deleteMedia(pid).catch(() => undefined);
                  update((x) => void (x.products[i].photoIds = x.products[i].photoIds.filter((y) => y !== pid)));
                  await refresh();
                }} />
              ))}
            </div>
            <div className="mt-2">
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
  return (
    <div className="space-y-4">
      <InlineNotice tone="info">
        고객사 계정은 고객사의 것입니다 — 담당자 누구나 이 계정으로 게시하고, 토큰은 서버에 암호화해 둡니다. 고객사 계정에 올리는 브랜드 영상은 자기 광고라 「광고」 고지가 필요 없습니다. 연결은 고객사가 우리에게 계정 권한(Meta 비즈니스 · YouTube 관리자)을 준 뒤에 합니다.
      </InlineNotice>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Plug} disabled={!c.canEdit || !s.youtubeOAuth.configured || !s.tokenKey.configured || busy === "youtube"} onClick={() => void connect("youtube")}>고객사 YouTube 연결</Button>
        <Button size="sm" icon={Plug} disabled={!c.canEdit || !s.meta.configured || !s.tokenKey.configured || busy === "instagram"} onClick={() => void connect("instagram")}>고객사 Instagram 연결</Button>
        <Button size="sm" variant="secondary" icon={KeyRound} disabled={!c.canEdit || !s.tokenKey.configured} onClick={() => setManual(true)}>Instagram 토큰 직접 입력</Button>
      </div>
      {accounts.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">아직 연결한 고객사 계정이 없습니다 — 고객사 계정 게시는 미연결 상태입니다. 우리 채널에 「광고」 고지를 달아 올릴 수는 있습니다.</p>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-nd-line">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium">{PLATFORM_LABEL[a.platform]} · {a.externalName}</span>
                {a.status === "connected" ? <Badge tone="success" size="sm">연결됨</Badge> : <Badge tone="warning" size="sm">다시 연결 필요</Badge>}
                <span className="text-nd-caption text-nd-fg-3">연결 {nameOf(a.owner)} · {fmtWhen(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
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
