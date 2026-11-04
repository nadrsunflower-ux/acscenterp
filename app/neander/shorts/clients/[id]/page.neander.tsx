"use client";

// ============================================================
//  업체(고객사) 하나 — 월별 영상 · 계약·브리프 · 프로젝트 · 재무 · 계약서 · 제품·사진 · 게시 계정 · 월간 보고
//  (2026-11 목업 04 개편)
//  업체 하나에 대행 프로젝트(space) 여러 개 — 영상은 그 업체의 프로젝트 하나에 들어간다.
//  재무 · 계약서는 재무 계약 프로젝트(PJ-…)를 이어서 읽기만 한다 (재무 권한이 있는 사람에게만).
// ------------------------------------------------------------
//  고친 것은 저절로 저장된다 (담당자만) — 머리의 저장 표시(SaveIndicator)가 조용히 알려 준다.
//  관리자 몰아보기는 읽기 전용으로 잠긴다.
//  탭은 주소의 ?tab= 로 연다 (계약 화면 · 대시보드의 연체 바로 가기는 ?tab=finance).
//  화면 머리의 주요 버튼은 탭마다 다르다: 월별 영상 → 「N월 보고」·「영상 추가」 · 프로젝트 → 「이 업체에 프로젝트」 ·
//  재무 → 「재무 계약 잇기」 · 제품 → 「제품 추가」.
//  영상은 「영상 추가」 로 그 달 계약분을 만든다 — 제품의 확인된 사실이 재료가 되고,
//  바이럴 형식 정찰의 형식 카드를 고르면 그 형식(훅 · 구성 · 편집)을 참고 자료로 옮긴다.
//  「계약 · 브리프」 의 「홈페이지에서 읽어 채우기」(agency-ui/brand-site.tsx)는 홈페이지 한 장을 읽어
//  제안만 받고, 사람이 고른 것만 이 화면의 update(자동 저장)로 넣는다.
// ============================================================

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  Building2,
  ChevronLeft,
  ClipboardCheck,
  ExternalLink,
  FileSignature,
  ImageIcon,
  KeyRound,
  Link2,
  Pencil,
  Plug,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  Input,
  MonthStepper,
  NumberInput,
  PageShell,
  Select,
  Tabs,
  Textarea,
  buttonClass,
  cn,
  type Tone,
  useConfirm,
} from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { Won } from "@/components/neander/shorts/agency-ui/won";
import { BrandSiteFill } from "@/components/neander/shorts/agency-ui/brand-site";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { ConnBadge, PubBadge, StageBadge, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { MediaThumb, MediaUpload, useClientMedia } from "@/components/neander/shorts/media";
import { ProgressLine, RecordTable, SaveIndicator, StudioCard, StudioHeader, StudioMetric, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { daysBetween, fmtDateStr, fmtDayKst, installmentState, overdueLines, vatText, wonText } from "@/components/neander/shorts/agency-ui/finance";
import { deleteMedia, mutate, shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, REVIEW_LABEL, currentMonth, latestRound, monthProgress, newId } from "@/lib/neander/shorts/model";
import { PROJECT_STATUS_LABEL, splitVat, type ProjectStatus } from "@/lib/neander/finance/project";
import { todayStrKST } from "@/lib/neander/format";
import { CLIENT_DELIVERY_LABEL, type AccountView, type ClientDelivery, type ClientDoc, type ClientView, type ProjectDoc, type PublishPlatform } from "@/lib/neander/shorts/types";
import { CONTRACT_STATUS_TEXT, clientFinanceCodes, type ClientFinanceContract, type ClientFinanceSummary } from "@/lib/neander/shorts/agency";
import { PRODUCTION_LABEL, spaceKind, spaceOf } from "@/lib/neander/shorts/spaces";
import type { WithId } from "@/components/neander/shorts/ShortsProvider";

const TABS = [
  { key: "month", label: "월별 영상" },
  { key: "brief", label: "계약 · 브리프" },
  { key: "spaces", label: "프로젝트" },
  { key: "finance", label: "재무 · 계약서" },
  { key: "products", label: "제품 · 사진" },
  { key: "accounts", label: "게시 계정" },
];
type TabKey = "month" | "brief" | "spaces" | "finance" | "products" | "accounts";

/** 고객 검토 상태 색 — 승인 초록 · 검토 대기 노랑 · 수정 요청 빨강 · 보내기 전 회색 */
const REVIEW_TONE: Record<ProjectDoc["review"]["state"], Tone> = { approved: "success", waiting: "warning", revision: "danger", none: "neutral" };
const CLIENT_STATUS_BADGE: Record<ClientDoc["status"], [string, Tone]> = { active: ["진행 중", "success"], paused: ["멈춤", "warning"], ended: ["종료", "neutral"] };
const CONTRACT_TONE: Record<ClientFinanceContract["status"], Tone> = { draft: "neutral", signed: "success", done: "info", cancelled: "danger" };

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

export default function ClientPage() {
  // useSearchParams(?tab=) 를 쓰는 화면은 Suspense 경계가 있어야 정적 빌드가 된다
  return (
    <Suspense>
      <ClientPageInner />
    </Suspense>
  );
}

function ClientPageInner() {
  const { id } = useParams<{ id: string }>();
  const { data } = useShorts();
  const client = data!.clients.find((c) => c.id === id);
  if (!client) {
    return (
      <PageShell>
        <EmptyState
          icon={Building2}
          title="고객사를 찾지 못했습니다"
          description="지워졌거나 내가 담당자가 아닌 고객사입니다."
          action={
            <Link href="/neander/shorts/clients" className={buttonClass("secondary")}>
              목록으로
            </Link>
          }
        />
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
  const [savedAt, setSavedAt] = useState<number | null>(initial.updatedAt || null);
  const ref = useRef(c);
  const timer = useRef<number | null>(null);
  ref.current = c;
  const save = useCallback(async () => {
    setState("saving");
    try {
      await mutate("client.save", { id: ref.current.id, client: ref.current });
      setState("saved");
      setSavedAt(Date.now());
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
  return { c, update, state, error, savedAt, retry: save };
}

type FinOption = { code: string; name: string; client: string; status: string };

function ClientWorkspace({ initial }: { initial: ClientView }) {
  const { data, nameOf, refresh } = useShorts();
  const d = data!;
  const router = useRouter();
  const search = useSearchParams();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const { c, update, state, error, savedAt, retry } = useClientDraft(initial);
  const wanted = search.get("tab") ?? "";
  const tab: TabKey = TABS.some((t) => t.key === wanted) ? (wanted as TabKey) : "month";
  const setTab = (k: string) => router.replace(`/neander/shorts/clients/${c.id}?tab=${k}`, { scroll: false });
  useCrumbTail(c.name);
  const readOnly = !initial.canEdit;
  const nameRef = useRef<HTMLInputElement>(null);

  // 월별 영상 — 달 · 영상 추가 창 (머리의 「N월 보고」·「영상 추가」 가 함께 쓴다)
  const [month, setMonth] = useState(currentMonth());
  const [adding, setAdding] = useState(false);
  const months = useMemo(() => {
    const [y, m] = currentMonth().split("-").map(Number);
    const last = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 7);
    return monthsBetween(c.contract.startMonth < currentMonth() ? c.contract.startMonth : currentMonth(), last);
  }, [c.contract.startMonth]);
  const monthProjects = d.projects.filter((p) => p.clientId === c.id && p.month === month);
  const prog = monthProgress(monthProjects, c.contract.videosPerMonth);

  // 재무 계약 잇기 — 고를 목록 (머리의 「재무 계약 잇기」 가 연다)
  const [finOptions, setFinOptions] = useState<FinOption[] | null>(null);
  const loadFinOptions = () => void run("opt", async () => setFinOptions((await mutate<{ options: FinOption[] }>("finance.options")).options));

  const addProduct = () => update((x) => void x.products.push({ id: newId("pd_"), name: "새 제품", url: "", facts: [], photoIds: [], note: "" }));
  const M = Number(month.slice(5));

  const actions =
    tab === "month" ? (
      <>
        <Link href={`/neander/shorts/clients/${c.id}/report?month=${month}`} className={buttonClass("secondary", "md", "gap-1.5")}>
          <Printer size={16} aria-hidden /> {M}월 보고
        </Link>
        <Button icon={Plus} disabled={!c.canEdit} onClick={() => setAdding(true)}>
          영상 추가
        </Button>
      </>
    ) : tab === "spaces" ? (
      (c.canEdit || d.admin) && (
        <Link href={`/neander/shorts/spaces?newFor=${c.id}`} className={buttonClass("primary", "md", "gap-1.5")}>
          <Plus size={16} aria-hidden /> 이 업체에 프로젝트
        </Link>
      )
    ) : tab === "finance" ? (
      d.financeAccess &&
      !readOnly && (
        <Button icon={Link2} loading={busy === "opt"} onClick={loadFinOptions}>
          재무 계약 잇기
        </Button>
      )
    ) : tab === "products" ? (
      <Button icon={Plus} disabled={readOnly} onClick={addProduct}>
        제품 추가
      </Button>
    ) : null;

  return (
    <PageShell>
      <StudioHeader
        className="mb-4"
        kicker={
          <Link href="/neander/shorts/clients" className="hover:text-nd-fg hover:underline">
            업체 · 계약
          </Link>
        }
        kickerIcon={ChevronLeft}
        title={
          <span className="relative inline-grid max-w-full align-top">
            {/* 글자 폭만큼 칸이 늘어나게 — 보이지 않는 같은 글자로 너비를 잡는다 */}
            <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre px-1.5">
              {c.name || "업체 이름"}
            </span>
            <input
              ref={nameRef}
              aria-label="업체 이름"
              value={c.name}
              maxLength={80}
              disabled={readOnly}
              placeholder="업체 이름"
              onChange={(e) => update((x) => void (x.name = e.target.value))}
              className="col-start-1 row-start-1 -mx-1.5 w-full min-w-0 rounded-nd-md border border-transparent bg-transparent px-1.5 text-inherit [font:inherit] outline-none transition-colors hover:border-nd-line focus:border-nd-accent focus:bg-nd-content disabled:hover:border-transparent"
            />
          </span>
        }
        description={`월 ${c.contract.videosPerMonth}편의 제작부터 고객 승인과 계약 대금까지 한곳에서 관리합니다.`}
        actions={actions || undefined}
      />
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-nd-fg-2">
          <Badge tone={CLIENT_STATUS_BADGE[c.status][1]} size="lg">
            {CLIENT_STATUS_BADGE[c.status][0]}
          </Badge>
          <span>담당 {c.members.map(nameOf).join(", ") || "없음"}</span>
          {c.contactName && <span className="text-nd-fg-3">고객사 담당 {c.contactName}</span>}
          {readOnly ? (
            <Badge tone="warning" size="lg">
              읽기 전용
            </Badge>
          ) : (
            <SaveIndicator state={state} savedAt={savedAt} onRetry={() => void retry()} />
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!readOnly && (
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => nameRef.current?.focus()}>
              이름 바로 고치기
            </Button>
          )}
          <Select size="sm" aria-label="상태" value={c.status} disabled={readOnly} onChange={(e) => update((x) => void (x.status = e.target.value as ClientDoc["status"]))} className="w-auto">
            <option value="active">상태 · 진행</option>
            <option value="paused">상태 · 멈춤</option>
            <option value="ended">상태 · 종료</option>
          </Select>
          {c.createdBy === d.me && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label="고객사 지우기"
              onClick={async () => {
                if (!(await ask({ title: "고객사를 지울까요?", message: "영상이나 고객사 계정이 남아 있으면 지울 수 없습니다 — 그때는 상태를 「종료」 로 바꾸세요.", tone: "danger", confirmLabel: "지우기" }))) return;
                await run("del", async () => {
                  await mutate("client.delete", { id: c.id });
                  router.push("/neander/shorts/clients");
                });
              }}
            />
          )}
        </div>
      </div>
      {error && state === "error" && (
        <StudioNotice
          tone="danger"
          title="고친 내용을 저장하지 못했습니다"
          className="mb-4"
          action={
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void retry()}>
              다시 저장
            </Button>
          }
        >
          {error}
        </StudioNotice>
      )}
      {readOnly && (
        <StudioNotice tone="info" className="mb-4">
          관리자 몰아보기 — 이 업체의 담당자가 아니라 읽기만 합니다.
        </StudioNotice>
      )}
      <Tabs className="mb-5" items={TABS} value={tab} onChange={setTab} ariaLabel="고객사" />
      {tab === "month" && <MonthBoard c={c} month={month} months={months} setMonth={setMonth} prog={prog} projects={monthProjects} onAdd={() => setAdding(true)} />}
      <fieldset disabled={readOnly} className="min-w-0">
        {tab === "brief" && <BriefTab c={c} update={update} />}
        {tab === "products" && <ProductsTab c={c} update={update} onAdd={addProduct} />}
        {tab === "accounts" && <AccountsTab c={c} onBrief={() => setTab("brief")} />}
        {tab === "finance" && <FinanceTab c={c} update={update} readOnly={readOnly} options={finOptions} onLoadOptions={loadFinOptions} loading={busy === "opt"} />}
      </fieldset>
      {tab === "spaces" && <SpacesTab c={c} />}
      {adding && (
        <AddVideo
          c={c}
          month={month}
          prog={prog}
          onClose={() => setAdding(false)}
          onCreated={async (id) => {
            await refresh();
            router.push(`/neander/shorts/projects/${id}?tab=client`);
          }}
        />
      )}
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

function MonthBoard({
  c,
  month,
  months,
  setMonth,
  prog,
  projects,
  onAdd,
}: {
  c: ClientView;
  month: string;
  months: string[];
  setMonth: (m: string) => void;
  prog: ReturnType<typeof monthProgress>;
  projects: WithId<ProjectDoc>[];
  onAdd: () => void;
}) {
  const { data } = useShorts();
  const d = data!;
  const connected = clientConnected(d.accounts, c.id);
  const left = prog.planned - prog.made;
  const M = Number(month.slice(5));
  const fileOnly = c.delivery === "file";
  const rows = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const overCap = rows.filter((p) => p.review.revisionsUsed > c.contract.revisionLimit);
  const revisionFirst = overCap[0] ?? rows.find((p) => p.review.state === "revision");
  const waitingRows = rows.filter((p) => p.review.state === "waiting");
  const spaceName = (p: ProjectDoc) => d.spaces.find((x) => x.id === spaceOf(p))?.name ?? "";
  const pct = prog.planned > 0 ? Math.round((prog.made / prog.planned) * 100) : 0;
  const showNotice = month >= currentMonth() && (left > 0 || prog.waiting > 0 || overCap.length > 0);
  const addButton = (
    <Button icon={Plus} disabled={!c.canEdit} onClick={onAdd}>
      영상 추가
    </Button>
  );

  const columns: RecordColumn<WithId<ProjectDoc>>[] = [
    {
      key: "title",
      header: "영상 · 프로젝트",
      mobile: "title",
      cell: (p) => {
        const product = c.products.find((x) => x.id === p.clientProductId)?.name ?? "제품 미정";
        return (
          <span className="block min-w-0 max-w-[340px]">
            <span className="block truncate font-semibold" title={p.title}>
              {p.title}
            </span>
            <span className="block truncate text-[13px] font-normal text-nd-fg-3" title={product}>
              {[spaceName(p), product, p.formatId ? "정찰 형식" : ""].filter(Boolean).join(" · ")}
            </span>
          </span>
        );
      },
    },
    {
      key: "review",
      header: "검토 상태",
      cell: (p) => {
        const round = latestRound(p.review);
        return (
          <span className="inline-flex flex-col items-end gap-1 md:items-start">
            <Badge size="lg" tone={REVIEW_TONE[p.review.state]}>
              {REVIEW_LABEL[p.review.state]}
            </Badge>
            <span className="max-w-[220px] truncate text-[13px] text-nd-fg-3" title={round?.feedback || undefined}>
              {p.review.state === "revision" && round?.feedback ? `“${round.feedback}”` : round ? `${round.n}차 · ${p.review.state === "approved" && round.decidedAt ? `승인 ${fmtDayKst(round.decidedAt)}` : `보냄 ${fmtDayKst(round.sentAt)}`}` : "보내기 전"}
            </span>
          </span>
        );
      },
    },
    {
      key: "rev",
      header: "수정 횟수",
      align: "right",
      cell: (p) => {
        const over = p.review.revisionsUsed > c.contract.revisionLimit;
        return (
          <span className={cn("whitespace-nowrap", over && "font-semibold text-nd-danger-text")} title={over ? "계약상 수정 횟수를 넘었습니다 (별도 협의 대상)" : undefined}>
            {p.review.revisionsUsed} / {c.contract.revisionLimit}회{over ? " · 초과" : ""}
          </span>
        );
      },
    },
    { key: "stage", header: "제작 단계", cell: (p) => <StageBadge stage={p.stage} size="lg" /> },
    {
      key: "where",
      header: "올릴 곳 · 게시",
      cell: (p) => {
        const pubs = d.publications.filter((x) => x.projectId === p.id);
        return (
          <span className="block min-w-0">
            {p.brandTarget === "client" ? (
              fileOnly ? (
                <span className="block whitespace-nowrap">
                  완성 파일 납품 <span className="text-[13px] text-nd-fg-3">(게시는 고객사)</span>
                </span>
              ) : (
                <span className="flex items-center justify-end gap-2 whitespace-nowrap md:justify-start">
                  고객사 계정
                  <ConnBadge ok={connected} on="연결됨" off="연결 필요" offTone="danger" />
                </span>
              )
            ) : (
              <span className="block whitespace-nowrap text-nd-fg-2">
                우리 채널 <span className="text-[13px] text-nd-fg-3">(광고 고지)</span>
              </span>
            )}
            {pubs.length ? (
              <span className="mt-1 block space-y-1">
                {pubs.map((x) => (
                  <span key={x.id} className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 md:justify-start">
                    <PubBadge status={x.status} size="lg" />
                    <span className="whitespace-nowrap text-[13px] text-nd-fg-3">
                      {PLATFORM_LABEL[x.platform]} · {fmtWhen(x.result?.at ?? x.scheduledAt ?? x.updatedAt)}
                      {x.result?.by === "manual" ? " · 수동 기록" : ""}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="mt-0.5 block text-[13px] text-nd-fg-3">아직 게시 전</span>
            )}
          </span>
        );
      },
    },
    { key: "at", header: "갱신", align: "right", cell: (p) => <span className="whitespace-nowrap text-[13px] text-nd-fg-3">{fmtWhen(p.updatedAt)}</span> },
    {
      key: "open",
      header: "열기",
      mobile: "hide",
      cell: (p) => {
        const review = p.review.state === "waiting" || p.review.state === "revision";
        return (
          <Link href={`/neander/shorts/projects/${p.id}?tab=${review ? "review" : "client"}`} className={buttonClass("ghost", "sm", "gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            {p.review.state === "waiting" ? "검토 보기" : p.review.state === "revision" ? "요청 보기" : "영상 열기"}
          </Link>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      {showNotice && (
        <StudioNotice
          tone={left > 0 || overCap.length ? "warning" : "info"}
          title={left > 0 ? `${M}월 납품까지 ${left}편 남았어요` : `${M}월 계약 편수를 채웠어요`}
          action={
            revisionFirst && (
              <Link href={`/neander/shorts/projects/${revisionFirst.id}?tab=review`} className={buttonClass("secondary", "sm", "gap-1.5")}>
                <ArrowRight size={15} aria-hidden />
                수정 요청 보기
              </Link>
            )
          }
        >
          {[
            prog.waiting ? `승인 대기 ${prog.waiting}편을 먼저 확인하고` : "",
            overCap.length ? `수정 상한을 넘은 ${overCap.map((p) => p.title).join(", ")}은 고객사와 범위를 협의하세요.` : prog.revision ? `수정 요청 ${prog.revision}편을 반영하세요.` : "",
            left > 0 && !prog.waiting && !overCap.length && !prog.revision ? `계약은 월 ${c.contract.videosPerMonth}편입니다 — 「영상 추가」 로 남은 영상을 시작하세요.` : "",
          ]
            .filter(Boolean)
            .join(" ") || "남은 영상은 「영상 추가」 로 시작합니다."}
        </StudioNotice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthStepper months={months} value={month} onChange={setMonth} />
        <Badge tone="neutral" size="lg">
          계약 {c.contract.startMonth} ~ {c.contract.endMonth ?? "끝 월 없음"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StudioMetric
          label="제작 / 계약"
          value={`${prog.made} / ${prog.planned}`}
          unit="편"
          tone="accent"
          detail={`제작 진행률 ${pct}% · ${left > 0 ? `${left}편 남음` : left < 0 ? `계약보다 ${-left}편 많음` : "계약 편수를 채움"} · 편당 수정 ${c.contract.revisionLimit}회까지`}
        />
        <StudioMetric label="고객 승인" value={String(prog.approved)} unit="편" tone="success" detail="납품 기준 · 승인일은 표에서 확인" />
        <StudioMetric label="검토 대기" value={String(prog.waiting)} unit="편" tone={prog.waiting ? "warning" : undefined} detail={waitingRows.length ? waitingRows.slice(0, 2).map((p) => p.title).join(" · ") : "기다리는 검토 없음"} />
        <StudioMetric label="수정 요청 중" value={String(prog.revision)} unit="편" tone={prog.revision ? "danger" : undefined} detail={overCap.length ? `상한 초과 ${overCap.length}편` : "상한 초과 없음"} />
        <StudioMetric label="게시됨" value={String(prog.published)} unit="편" tone={prog.published ? "success" : undefined} detail={fileOnly ? "완성 파일만 납품 — 게시는 고객사" : "승인 후 순서대로 게시"} />
      </div>
      {projects.length === 0 ? (
        <EmptyState compact icon={ClipboardCheck} title={`${M}월 영상이 없습니다`} description={`계약은 월 ${c.contract.videosPerMonth}편입니다. 「영상 추가」 로 제품 · 정찰 형식을 골라 시작하세요.`} action={addButton} />
      ) : (
        <StudioCard flush title={`${M}월 영상`} action={<span className="text-[13px] text-nd-fg-3">{rows.length}편 · 최근 수정 순</span>}>
          <RecordTable rows={rows} columns={columns} rowKey={(p) => p.id} rowHref={(p) => `/neander/shorts/projects/${p.id}`} ariaLabel={`${M}월 영상`} className="[&>ul]:px-4 [&>ul]:pb-4" />
        </StudioCard>
      )}
      <StudioCard title="이번 달 진행">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="nd-num shrink-0 text-[14px] font-semibold text-nd-fg">계약 {prog.planned}편</span>
          <ProgressLine className="min-w-[160px] flex-1" value={prog.made} total={prog.planned} />
          <span className="nd-num shrink-0 text-[14px] text-nd-fg-2">
            <b className="font-semibold text-nd-accent-strong">제작 {prog.made}편</b> · 남은 {Math.max(0, left)}편 · 고객 승인 {prog.approved}편
          </span>
        </div>
      </StudioCard>
    </div>
  );
}

function AddVideo({ c, month, prog, onClose, onCreated }: { c: ClientView; month: string; prog: ReturnType<typeof monthProgress>; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  const { data, space } = useShorts();
  // 이 업체의 대행 프로젝트 — 지금 화면의 프로젝트가 그중 하나면 그것, 아니면 첫 프로젝트
  const spaces = (data?.spaces ?? []).filter((x) => !x.archived && spaceKind(x) === "agency" && x.clientId === c.id);
  const [formats, setFormats] = useState<FormatLite[] | null>(null);
  const [f, setF] = useState({ productId: c.products[0]?.id ?? "", formatId: "", brandTarget: (c.delivery === "file" ? "client" : "client") as "client" | "own", title: "", spaceId: spaces.find((x) => x.id === space)?.id ?? spaces[0]?.id ?? "" });
  useEffect(() => {
    shortsGet<{ formats: FormatLite[] }>("scout").then((r) => setFormats(r.formats.filter((x) => !x.archived)), () => setFormats([]));
  }, []);
  const KOREA: Record<string, string> = { unchecked: "국내 미확인", none_in_sample: "국내 표본에 없음", some: "국내에 조금", spread: "국내에 퍼짐" };
  const M = Number(month.slice(5));
  const over = prog.made - prog.planned + 1;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`${M}월 영상 추가`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            icon={Plus}
            loading={busy === "a"}
            disabled={busy === "a" || !spaces.length}
            onClick={() =>
              void run("a", async () => {
                const r = await mutate<{ id: string }>("client.createProject", { clientId: c.id, month, ...f });
                await onCreated(r.id);
              })
            }
          >
            영상 만들기
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {over > 0 ? (
          <StudioNotice tone="warning" title="계약 편수를 이미 채웠습니다">
            지금 {prog.made} / {prog.planned}편 — 이 영상은 계약보다 {over}편 많은 추가분이 됩니다. 추가 금액은 고객사와 협의하세요.
          </StudioNotice>
        ) : (
          <StudioNotice tone="info" title="계약 분량에 포함되는 영상입니다">
            지금 {prog.made} / {prog.planned}편 · 제품의 확인된 사실과 선택한 형식을 대본 자료로 가져옵니다.
          </StudioNotice>
        )}
        {!spaces.length && (
          <StudioNotice tone="warning" title="이 업체의 대행 프로젝트가 없습니다">
            「프로젝트」 탭에서 브랜드(채널) 프로젝트를 먼저 만들어 주세요.
          </StudioNotice>
        )}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="프로젝트 (브랜드 · 채널)">
            <Select value={f.spaceId} disabled={!spaces.length} onChange={(e) => setF({ ...f, spaceId: e.target.value })}>
              {!spaces.length && <option value="">(프로젝트 없음)</option>}
              {spaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="제품">
            <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
              <option value="">(제품 미정)</option>
              {c.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · 사실 {p.facts.length}개 · 사진 {p.photoIds.length}장
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="바탕 형식 (바이럴 형식 정찰)" hint={formats === null ? "불러오는 중…" : formats.length ? "해외에서 먹히고 국내에 아직 덜 퍼진 형식이 들여오기 좋습니다" : "정찰 형식 카드가 아직 없습니다"}>
            <Select value={f.formatId} onChange={(e) => setF({ ...f, formatId: e.target.value })}>
              <option value="">(형식 없이)</option>
              {(formats ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {KOREA[x.korea.status] ?? x.korea.status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="올릴 곳" hint={c.delivery === "file" ? "완성 파일만 납품하는 계약 — 고객사 계정이면 게시는 고객사가 합니다" : "고객사 계정이면 자기 광고라 고지 불필요 · 우리 채널이면 「광고」 고지"}>
            <Select value={f.brandTarget} onChange={(e) => setF({ ...f, brandTarget: e.target.value as "client" | "own" })}>
              <option value="client">고객사 계정</option>
              <option value="own">우리 채널</option>
            </Select>
          </Field>
        </FormRow>
        <Field label="제목" hint={`비우면 「${c.name} ${month.slice(5)}월 #순번 · 제품 · 형식」 으로 자동`}>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
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

/** 월 금액을 부가세 기준에 따라 풀어 보인다 — 공급가액 · 부가세 · 받을 돈을 나란히 */
function VatBreakdown({ fee, vat }: { fee: number | null; vat: ClientDoc["contract"]["vat"] }) {
  if (fee === null || !(fee > 0)) {
    return <p className="rounded-nd-md bg-nd-sunken px-4 py-3 text-[13px] text-nd-fg-3">월 금액을 적으면 공급가액 · 부가세 · 받을 돈을 나눠 보여 줍니다.</p>;
  }
  const s = splitVat(fee, vat);
  const rows: [string, number, boolean][] = [
    ["공급가액", s.supply, vat === "excluded"],
    ["부가세 10%", s.vat, false],
    ["월 받을 돈", s.total, vat === "included"],
  ];
  return (
    <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
      <dl className="grid grid-cols-3 gap-3">
        {rows.map(([k, v, typed], i) => (
          <div key={k} className={cn("min-w-0", i === 2 && "border-l border-nd-line pl-3")}>
            <dt className="truncate text-[13px] text-nd-fg-3">
              {k}
              {typed ? " · 적은 금액" : ""}
            </dt>
            <dd className="mt-0.5 truncate text-[15px] font-semibold">
              <Won value={v} flow="income" />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[13px] text-nd-fg-3">{vat === "excluded" ? "부가세 별도 — 적은 금액이 공급가액이고 부가세 10% 를 더 받습니다." : "부가세 포함 — 적은 금액 안에 부가세가 들어 있습니다."}</p>
    </div>
  );
}

function BriefTab({ c, update }: { c: ClientView; update: (fn: (x: ClientView) => void) => void }) {
  const { nameOf } = useShorts();
  const [members, setMembers] = useState(c.members.join(", "));
  return (
    <div className="space-y-5">
      <StudioNotice tone="info" title="조회수는 계약상 보장하지 않아요">
        제작 편수와 수정 범위를 계약 기준으로 사용합니다. 브리프는 AI 대본과 게시 문구 검사에 함께 적용됩니다.{c.canEdit ? " 고친 내용은 저절로 저장됩니다." : ""}
      </StudioNotice>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <StudioCard title="제작 계약">
          <div className="space-y-4">
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="월 금액 (원)">
                <NumberInput size="sm" value={c.contract.monthlyFeeKrw} onValueChange={(r) => update((x) => void (x.contract.monthlyFeeKrw = r === "" ? null : Number(r)))} />
              </Field>
              <Field label="부가세 기준">
                <Select size="sm" value={c.contract.vat} onChange={(e) => update((x) => void (x.contract.vat = e.target.value as "excluded" | "included"))}>
                  <option value="excluded">별도</option>
                  <option value="included">포함</option>
                </Select>
              </Field>
            </FormRow>
            <VatBreakdown fee={c.contract.monthlyFeeKrw} vat={c.contract.vat} />
            <FormRow className="grid-cols-2">
              <Field label="월 제작 편수">
                <NumberInput size="sm" value={c.contract.videosPerMonth} onValueChange={(r) => update((x) => void (x.contract.videosPerMonth = Math.max(1, Number(r) || 1)))} />
              </Field>
              <Field label="영상당 수정 상한 (회)">
                <NumberInput size="sm" value={c.contract.revisionLimit} onValueChange={(r) => update((x) => void (x.contract.revisionLimit = Math.max(0, Number(r) || 0)))} />
              </Field>
            </FormRow>
            <FormRow className="grid-cols-2">
              <Field label="시작 월">
                <Input size="sm" type="month" value={c.contract.startMonth} onChange={(e) => update((x) => void (x.contract.startMonth = e.target.value))} />
              </Field>
              <Field label="끝 월 (비우면 계속)">
                <Input size="sm" type="month" value={c.contract.endMonth ?? ""} onChange={(e) => update((x) => void (x.contract.endMonth = e.target.value || null))} />
              </Field>
            </FormRow>
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="게시 방식" hint="업체마다 다름 — 재무 계약 · 계약서는 「재무 · 계약서」 탭">
                <Select size="sm" value={c.delivery ?? "upload"} onChange={(e) => update((x) => void (x.delivery = e.target.value as ClientDelivery))}>
                  {(Object.keys(CLIENT_DELIVERY_LABEL) as ClientDelivery[]).map((k) => (
                    <option key={k} value={k}>
                      {CLIENT_DELIVERY_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="고객사 담당자 이름">
                <Input size="sm" value={c.contactName} onChange={(e) => update((x) => void (x.contactName = e.target.value))} />
              </Field>
            </FormRow>
            <FormRow className="grid-cols-[minmax(0,1fr)_auto]">
              <Field label="우리 쪽 담당자 (ERP 이메일, 쉼표)" hint={`지금: ${c.members.map(nameOf).join(", ") || "없음"} — 이 사람들이 고객사 자료 · 영상 · 계정을 함께 씁니다`}>
                <Input size="sm" value={members} onChange={(e) => setMembers(e.target.value)} />
              </Field>
              <FieldAction>
                <Button size="sm" variant="secondary" onClick={() => update((x) => void (x.members = members.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)))}>
                  담당자 반영
                </Button>
              </FieldAction>
            </FormRow>
            <Field label="계약 메모">
              <Textarea rows={3} value={c.contract.note} onChange={(e) => update((x) => void (x.contract.note = e.target.value))} />
            </Field>
          </div>
        </StudioCard>
        <StudioCard title="브랜드 브리프" description="AI 대본 · 문구 검사가 이 내용을 씁니다">
          <div className="space-y-4">
            {/* 홈페이지를 읽어 아래 칸에 넣을 제안 — 고른 것만 update 로 (자동 저장) */}
            <BrandSiteFill c={c} update={update} />
            <div className="flex gap-3 rounded-nd-md border border-nd-danger/25 bg-nd-danger-soft/50 p-4">
              <Ban size={18} aria-hidden className="mt-0.5 shrink-0 text-nd-danger" />
              <ListEditor tone="danger" className="min-w-0 flex-1" label="금지 표현" hint="대본 · 게시 문구에 들어가면 게시 전 점검이 찾아냅니다 (AI 에게도 금지로 넘깁니다)" values={c.brief.banned} onChange={(v) => update((x) => void (x.brief.banned = v))} placeholder="예: 최저가 · 1위 · 치료 · 경쟁사 이름" />
            </div>
            <Field label="브랜드 · 캠페인 요약">
              <Textarea rows={3} value={c.brief.summary} onChange={(e) => update((x) => void (x.brief.summary = e.target.value))} />
            </Field>
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="대상 (누구에게)">
                <Input size="sm" value={c.brief.target} onChange={(e) => update((x) => void (x.brief.target = e.target.value))} />
              </Field>
              <Field label="톤 · 말투">
                <Input size="sm" value={c.brief.tone} onChange={(e) => update((x) => void (x.brief.tone = e.target.value))} placeholder="예: 담백하고 친근하게, 과장 없이" />
              </Field>
            </FormRow>
            <ListEditor label="핵심 메시지" values={c.brief.keyMessages} onChange={(v) => update((x) => void (x.brief.keyMessages = v))} />
            <ListEditor label="꼭 넣을 것" values={c.brief.mustInclude} onChange={(v) => update((x) => void (x.brief.mustInclude = v))} />
            <ListEditor label="참고 영상 · 자료 주소" values={c.brief.references} onChange={(v) => update((x) => void (x.brief.references = v))} placeholder="https://…" />
            <Field label="그 밖의 지시">
              <Textarea rows={4} value={c.brief.notes} onChange={(e) => update((x) => void (x.brief.notes = e.target.value))} />
            </Field>
          </div>
        </StudioCard>
      </div>
    </div>
  );
}

// ---- 제품 · 사진 -----------------------------------------------------------

function Photo({ id, alt, onRemove, className }: { id: string; alt: string; onRemove: () => void; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <MediaThumb id={id} type="image/*" alt={alt} className="h-full w-full rounded-nd-md" />
      <button
        type="button"
        aria-label="사진 지우기"
        title="사진 지우기"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:hidden"
      >
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

function ProductsTab({ c, update, onAdd }: { c: ClientView; update: (fn: (x: ClientView) => void) => void; onAdd: () => void }) {
  const { media, refresh } = useClientMedia(c.id);
  const ask = useConfirm();
  return (
    <div className="space-y-5">
      <StudioNotice tone="info" title="확인된 사실과 실사진이 대본의 기준이에요">
        제품의 성능 · 가격 · 후기는 고객사 자료로 확인한 것만 씁니다. 실사진은 AI 장면을 실제 제품과 비교하는 기준이 됩니다.
      </StudioNotice>
      {c.products.length === 0 && (
        <EmptyState
          compact
          icon={ImageIcon}
          title="제품이 없습니다"
          description="홍보할 제품과 확인된 사실 · 실사진을 넣어 주세요."
          action={
            <Button size="sm" icon={Plus} onClick={onAdd}>
              제품 추가
            </Button>
          }
        />
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {c.products.map((p, i) => {
          const removePhoto = async (pid: string) => {
            await deleteMedia(pid).catch(() => undefined);
            update((x) => void (x.products[i].photoIds = x.products[i].photoIds.filter((y) => y !== pid)));
            await refresh();
          };
          const [first, ...rest] = p.photoIds;
          return (
            <StudioCard key={p.id} title={p.name || "이름 없는 제품"} description={`확인된 사실 ${p.facts.length}개 · 실사진 ${p.photoIds.length}장`}>
              <div className="space-y-4">
                {first ? (
                  <div className="space-y-2">
                    <Photo id={first} alt={media.find((m) => m.id === first)?.name ?? `${p.name} 사진`} onRemove={() => void removePhoto(first)} className="aspect-[16/10] w-full" />
                    {rest.length > 0 && (
                      <div className="grid grid-cols-4 gap-2">
                        {rest.map((pid) => (
                          <Photo key={pid} id={pid} alt={media.find((m) => m.id === pid)?.name ?? `${p.name} 사진`} onRemove={() => void removePhoto(pid)} className="aspect-square" />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 rounded-nd-md border border-dashed border-nd-line bg-nd-sunken/60 px-4 text-center">
                    <ImageIcon size={22} aria-hidden className="text-nd-fg-3" />
                    <p className="text-[13px] text-nd-fg-3">아직 실사진이 없습니다 — 실제 제품 사진을 올리면 AI 장면과 비교하는 기준이 됩니다.</p>
                  </div>
                )}
                <FormRow className="grid-cols-1 sm:grid-cols-2">
                  <Field label="제품 이름">
                    <Input size="sm" value={p.name} onChange={(e) => update((x) => void (x.products[i].name = e.target.value))} />
                  </Field>
                  <Field label="제품 주소 (링크)">
                    <Input size="sm" value={p.url} onChange={(e) => update((x) => void (x.products[i].url = e.target.value))} placeholder="https://…" />
                  </Field>
                </FormRow>
                <ListEditor label="확인된 사실" hint="고객사 자료 · 상세 페이지로 확인한 것만 — 입력 후 Enter" values={p.facts} onChange={(v) => update((x) => void (x.products[i].facts = v))} />
                <Field label="메모" hint="확인 안 된 성능 · 촬영 메모는 여기에 (대본 재료로 쓰지 않습니다)">
                  <Input size="sm" value={p.note} onChange={(e) => update((x) => void (x.products[i].note = e.target.value))} />
                </Field>
                <div className="flex flex-wrap items-start justify-between gap-3 border-t border-nd-line pt-4">
                  <div className="min-w-0 flex-1">
                    <MediaUpload
                      compact
                      projectId=""
                      clientId={c.id}
                      kind="image"
                      title="제품 사진 올리기"
                      onUploaded={async (ms) => {
                        update((x) => void x.products[i].photoIds.push(...ms.map((m) => m.id)));
                        await refresh();
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={async () => {
                      if (!(await ask({ title: `「${p.name}」 을 지울까요?`, tone: "danger", confirmLabel: "지우기" }))) return;
                      update((x) => void x.products.splice(i, 1));
                    }}
                  >
                    제품 지우기
                  </Button>
                </div>
              </div>
            </StudioCard>
          );
        })}
      </div>
    </div>
  );
}

// ---- 게시 계정 -------------------------------------------------------------

function AccountsTab({ c, onBrief }: { c: ClientView; onBrief: () => void }) {
  const { data, refresh, nameOf, currentSpace } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const [manual, setManual] = useState(false);
  const accounts = d.accounts.filter((a) => a.clientId === c.id);
  const s = d.status;
  const fileOnly = c.delivery === "file";
  const spaceName = (a: AccountView) => d.spaces.find((x) => x.id === spaceOf(a))?.name ?? "프로젝트 미정";
  const hereIsClient = !!currentSpace && spaceKind(currentSpace) === "agency" && currentSpace.clientId === c.id;
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
    <div className="space-y-5">
      <StudioNotice
        tone="info"
        title={fileOnly ? "완성 파일만 납품하는 계약입니다" : "고객사 계정에 게시하는 계약입니다"}
        action={
          <Button size="sm" variant="secondary" icon={ArrowRight} onClick={onBrief}>
            계약 · 브리프 보기
          </Button>
        }
      >
        {fileOnly
          ? "게시는 고객사가 합니다 — 계정 연결 없이 납품할 수 있습니다. 연결해 두면 우리가 대신 게시할 수도 있습니다."
          : "게시 권한을 가진 담당자가 연결합니다. 완성 파일만 납품하는 계약으로 바꾸면 계정 연결 없이 납품할 수 있습니다."}{" "}
        고객사 계정은 고객사의 것입니다 — 담당자 누구나 이 계정으로 게시하고, 토큰은 서버에 암호화해 둡니다. 고객사 계정에 올리는 브랜드 영상은 자기 광고라 「광고」 고지가 필요 없습니다.
      </StudioNotice>
      {!fileOnly &&
        (accounts.length === 0 ? (
          <StudioNotice tone="warning">아직 연결한 고객사 계정이 없습니다 — 고객사 계정 게시는 미연결 상태입니다. 우리 채널에 「광고」 고지를 달아 올릴 수는 있습니다.</StudioNotice>
        ) : (
          !accounts.some((a) => a.status === "connected") && <StudioNotice tone="warning">연결이 끊긴 고객사 계정만 있습니다 — 다시 연결해야 고객사 계정으로 게시할 수 있습니다.</StudioNotice>
        ))}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {platforms.map(({ key, app, appName, need }) => {
          const list = accounts.filter((a) => a.platform === key);
          const ok = list.some((a) => a.status === "connected");
          const reauth = !ok && list.some((a) => a.status === "needs_reauth");
          const why = blocked(app, appName);
          return (
            <StudioCard
              key={key}
              title={`고객사 ${PLATFORM_LABEL[key]}`}
              action={
                reauth ? (
                  <Badge tone="warning" size="lg">
                    다시 연결 필요
                  </Badge>
                ) : (
                  <ConnBadge ok={ok} on="연결됨" off={fileOnly ? "미연결 · 필요 없음" : "연결 필요"} offTone={fileOnly ? "neutral" : "danger"} size="lg" />
                )
              }
            >
              {list.length ? (
                <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
                  {list.map((a) => (
                    <li key={a.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="min-w-0 truncate text-[15px] font-semibold" title={a.externalName}>
                          {a.externalName}
                        </span>
                        {a.status === "connected" ? (
                          <Badge tone="success" size="lg">
                            연결됨
                          </Badge>
                        ) : (
                          <Badge tone="warning" size="lg">
                            다시 연결 필요
                          </Badge>
                        )}
                      </div>
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
                        <dt className="text-nd-fg-3">프로젝트</dt>
                        <dd className="text-nd-fg-2">{spaceName(a)}</dd>
                        <dt className="text-nd-fg-3">연결한 사람</dt>
                        <dd className="text-nd-fg-2">
                          {nameOf(a.owner)} · {fmtWhen(a.createdAt)}
                        </dd>
                        <dt className="text-nd-fg-3">함께 게시할 팀원</dt>
                        <dd className="text-nd-fg-2">{(a.clientMembers ?? c.members).filter((m) => m !== a.owner).map(nameOf).join(", ") || "없음 (연결한 사람만)"}</dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-nd-fg-3">연결한 계정이 없습니다 — 연결하려면 {need}이 필요합니다.</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant={reauth ? "primary" : "secondary"} icon={reauth ? RefreshCw : Plug} disabled={!!why || busy === key} loading={busy === key} onClick={() => void connect(key)}>
                  {reauth ? "다시 연결" : `고객사 ${PLATFORM_LABEL[key]} 연결`}
                </Button>
                {key === "instagram" && (
                  <Button size="sm" variant="ghost" icon={KeyRound} disabled={!c.canEdit || !s.tokenKey.configured} onClick={() => setManual(true)}>
                    Instagram 토큰 직접 입력
                  </Button>
                )}
              </div>
              {why && <p className="mt-2 break-words text-[13px] text-nd-fg-3">{why}</p>}
            </StudioCard>
          );
        })}
      </div>
      <StudioCard title="계정 연결">
        <p className="text-[14px] text-nd-fg-2">
          새로 연결하는 계정은 지금 프로젝트 「{currentSpace?.name ?? "프로젝트"}」 에 붙습니다.
          {!hereIsClient && <span className="font-medium text-nd-warning-text"> 지금 프로젝트가 이 업체의 프로젝트가 아닙니다 — 위 툴바에서 이 업체의 프로젝트를 먼저 고르세요.</span>}
        </p>
      </StudioCard>
      {manual && (
        <ManualToken
          clientId={c.id}
          onClose={() => setManual(false)}
          onDone={async () => {
            setManual(false);
            await refresh();
          }}
        />
      )}
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
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy === "m" || !f.igUserId || !f.token} loading={busy === "m"} onClick={() => void run("m", async () => { await mutate("account.manualInstagram", { ...f, clientId }); await onDone(); }, "고객사 계정을 연결했습니다.")}>
            확인 후 연결
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Instagram 프로페셔널 계정 ID (숫자)">
          <Input value={f.igUserId} onChange={(e) => setF({ ...f, igUserId: e.target.value.trim() })} />
        </Field>
        <Field label="페이지 접근 토큰">
          <Input type="password" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value.trim() })} />
        </Field>
      </div>
    </Dialog>
  );
}

// ---- 프로젝트 (이 업체의 대행 프로젝트) ---------------------------------------------

function SpacesTab({ c }: { c: ClientView }) {
  const { data, space, setSpace } = useShorts();
  const d = data!;
  const router = useRouter();
  const thisMonth = currentMonth();
  const spaces = d.spaces.filter((x) => spaceKind(x) === "agency" && x.clientId === c.id);
  const live = spaces.filter((x) => !x.archived);
  return (
    <div className="space-y-5">
      <StudioNotice tone="info" title="이 업체의 자료는 담당자와 AI STUDIO 관리자에게만 보여요">
        담당자가 아닌 관리자가 모아 볼 때는 읽기 전용입니다. 프로젝트를 고르면 기획 · 영상 · 게시 · 성과도 함께 바뀝니다.
      </StudioNotice>
      {spaces.length === 0 ? (
        <EmptyState
          compact
          icon={Building2}
          title="아직 프로젝트가 없습니다"
          description="브랜드(채널)마다 대행 프로젝트를 만들면 그 안에서 기획 · 영상 · 게시 · 성과를 따로 관리합니다."
          action={
            (c.canEdit || d.admin) && (
              <Link href={`/neander/shorts/spaces?newFor=${c.id}`} className={buttonClass("primary", "sm", "gap-1.5")}>
                <Plus size={15} aria-hidden /> 이 업체에 프로젝트
              </Link>
            )
          }
        />
      ) : (
        <div className="grid items-stretch gap-5 lg:grid-cols-2">
          {spaces.map((x) => {
            const vids = d.projects.filter((p) => spaceOf(p) === x.id && !p.sample);
            const monthVids = vids.filter((p) => p.month === thisMonth).length;
            const accs = d.accounts.filter((a) => spaceOf(a) === x.id);
            const usable = accs.filter((a) => a.status === "connected").length;
            return (
              <StudioCard key={x.id} title={x.name} className={cn(x.archived && "opacity-75", x.id === space && "ring-2 ring-nd-accent/40")}>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="warning" size="lg">
                    대행
                  </Badge>
                  <Badge tone="neutral" size="lg">
                    {PRODUCTION_LABEL[x.production]}
                  </Badge>
                  {x.id === space && (
                    <Badge tone="accent" size="lg">
                      지금 프로젝트
                    </Badge>
                  )}
                  {x.archived && (
                    <Badge tone="neutral" size="lg">
                      보관
                    </Badge>
                  )}
                </div>
                <p className="mt-3 line-clamp-3 text-[14px] leading-relaxed text-nd-fg-2" title={x.description || undefined}>
                  {x.description || <span className="text-nd-fg-3">설명 없음</span>}
                </p>
                <p className="mt-3 text-[14px] font-semibold text-nd-fg">새 영상 기본값</p>
                <p className="text-[13px] text-nd-fg-3">고객사 브랜드 · 대본 {x.writerStyle === "story" ? "스토리 광고" : "제품 소개"}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-nd-md border border-nd-line px-4 py-3">
                    <p className="text-[13px] text-nd-fg-3">영상</p>
                    <p className="nd-num mt-1 text-[22px] font-bold text-nd-fg">
                      {vids.length}
                      <span className="ml-0.5 text-[14px] font-medium text-nd-fg-2">편</span>
                    </p>
                    <p className="text-[13px] text-nd-fg-3">이번 달 {monthVids}편</p>
                  </div>
                  <div className="rounded-nd-md border border-nd-line px-4 py-3">
                    <p className="text-[13px] text-nd-fg-3">연결 계정</p>
                    <p className="nd-num mt-1 text-[22px] font-bold text-nd-fg">
                      {accs.length}
                      <span className="ml-0.5 text-[14px] font-medium text-nd-fg-2">개</span>
                    </p>
                    <p className="text-[13px] text-nd-fg-3">게시 가능 {usable}개</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!x.archived && (
                    <Button
                      size="sm"
                      icon={ArrowRight}
                      onClick={() => {
                        setSpace(x.id);
                        router.push("/neander/shorts/projects");
                      }}
                    >
                      이 프로젝트로
                    </Button>
                  )}
                  <Link href={`/neander/shorts/spaces?edit=${x.id}`} className={buttonClass("secondary", "sm", "gap-1.5")}>
                    <Pencil size={15} aria-hidden />
                    고치기
                  </Link>
                </div>
              </StudioCard>
            );
          })}
        </div>
      )}
      {live.length > 0 && (
        <StudioCard title="계약을 함께 사용하는 프로젝트">
          <p className="text-[14px] leading-relaxed text-nd-fg-2">
            {live.length > 1 ? `${live.length}개 프로젝트의` : "이 프로젝트의"} 이번 달 제작 편수는 하나의 월 {c.contract.videosPerMonth}편 계약으로 합산합니다. 계약 금액은 프로젝트마다 중복해서 세지 않습니다.
          </p>
        </StudioCard>
      )}
    </div>
  );
}

// ---- 재무 · 계약서 (재무 계약 프로젝트를 이어서 읽기만) --------------------------------

const wonOrDash = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("ko-KR")}원`);
const finStatus = (s: string) => PROJECT_STATUS_LABEL[s as ProjectStatus] ?? (s || "상태 미확인");

function FinanceTab({
  c,
  update,
  readOnly,
  options,
  onLoadOptions,
  loading,
}: {
  c: ClientView;
  update: (fn: (x: ClientView) => void) => void;
  readOnly: boolean;
  options: FinOption[] | null;
  onLoadOptions: () => void;
  loading: boolean;
}) {
  const { data } = useShorts();
  const d = data!;
  const codes = clientFinanceCodes(c);
  const rows: ClientFinanceSummary[] = d.clientFinance[c.id] ?? [];
  const [pick, setPick] = useState("");
  const today = todayStrKST();
  if (!d.financeAccess) {
    return (
      <StudioNotice tone="neutral" title="재무 권한이 필요합니다">
        재무 계약 · 입금 · 계약서는 재무 권한이 있는 사람에게만 보입니다. 계약 조건(월 금액 · 편수 · 수정 상한)은 「계약 · 브리프」 탭에 있습니다.
      </StudioNotice>
    );
  }
  const setCodes = (next: string[]) =>
    update((x) => {
      x.contract.financeCodes = next;
      x.contract.financeCode = next[0] ?? "";
    });
  const overdue = overdueLines(rows, today);
  return (
    <div className="space-y-5">
      {overdue.length > 0 && (
        <StudioNotice
          tone="danger"
          title={`기한이 지난 받을 돈 ${overdue.length}건`}
          action={
            overdue[0].projectId && (
              <Link href={`/neander/finance/projects/${overdue[0].projectId}`} className={buttonClass("secondary", "sm", "gap-1.5")}>
                <ExternalLink size={15} aria-hidden />
                재무에서 열기
              </Link>
            )
          }
        >
          {overdue.map((o) => `${o.dueDate} 예정 ${wonText(o.amount)}(${vatText(o.vat)}) · ${o.kind || "회차"} · ${o.days}일 지남`).join(" / ")} — 아직 확인되지 않았습니다. 재무에서 입금 기록을 확인하세요.
        </StudioNotice>
      )}
      {!readOnly && options !== null && (
        <StudioCard title="재무 계약 프로젝트 잇기" description="재무의 계약 프로젝트(PJ-…)를 이어 계약 금액 · 입금 · 계약서를 봅니다 — 고치기는 재무 화면에서">
          <FormRow className="grid-cols-[minmax(0,1fr)_auto]">
            <Field label="재무 계약 프로젝트" hint="재무 프로젝트가 아직 없으면 재무 › 프로젝트에서 계약을 먼저 만드세요 (계약서 만들기도 거기에 있습니다)">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">고르기 — 최근 것부터</option>
                {options
                  .filter((o) => !codes.includes(o.code.toUpperCase()))
                  .map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.code} · {o.name}
                      {o.client ? ` · ${o.client}` : ""}
                    </option>
                  ))}
              </Select>
            </Field>
            <FieldAction size="md">
              <Button
                disabled={!pick}
                icon={Link2}
                onClick={() => {
                  setCodes([...codes, pick.toUpperCase()]);
                  setPick("");
                }}
              >
                잇기
              </Button>
            </FieldAction>
          </FormRow>
        </StudioCard>
      )}
      {codes.length === 0 ? (
        <EmptyState
          compact
          icon={FileSignature}
          title="이은 재무 계약이 없습니다"
          description="재무 계약 프로젝트를 이으면 계약 금액 · 받은 돈 · 다음 받을 날 · 계약서가 여기에 보입니다."
          action={
            !readOnly &&
            options === null && (
              <Button variant="secondary" icon={Link2} loading={loading} onClick={onLoadOptions}>
                재무 계약 프로젝트 잇기
              </Button>
            )
          }
        />
      ) : (
        codes.map((code) => {
          const r = rows.find((x) => x.code.toUpperCase() === code);
          const pct = r && r.received !== null && r.contractAmount > 0 ? Math.round((r.received / r.contractAmount) * 100) : null;
          return (
            <div key={code} className="space-y-5">
              <StudioCard
                title={
                  <span className="block">
                    <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      {r?.projectId && (
                        <Badge tone={r.status === "active" ? "success" : r.status === "planning" ? "warning" : "neutral"} size="lg">
                          계약 {finStatus(r.status)}
                        </Badge>
                      )}
                      <Badge tone="neutral" size="lg">
                        <span className="font-mono">{code}</span>
                      </Badge>
                    </span>
                    <span className="block text-[18px]">{r?.name ?? "저장 뒤 불러옵니다…"}</span>
                  </span>
                }
                description={r?.startDate ? `${r.startDate} ~ ${r.endDate ?? ""} · 월 ${c.contract.videosPerMonth}편` : undefined}
                action={
                  <>
                    {r?.projectId && (
                      <Link href={`/neander/finance/projects/${r.projectId}`} className={buttonClass("secondary", "sm", "gap-1.5")}>
                        <ExternalLink size={15} aria-hidden />
                        재무에서 열기
                      </Link>
                    )}
                    {!readOnly && (
                      <Button size="sm" variant="ghost" icon={X} onClick={() => setCodes(codes.filter((x) => x !== code))}>
                        연결 끊기
                      </Button>
                    )}
                  </>
                }
              >
                {r && r.projectId ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                      <MoneyTile label="계약 금액" value={r.contractAmount} vat={r.vatMode} />
                      <MoneyTile label="받은 금액" value={r.received} vat={r.vatMode} note={pct !== null ? `${pct}%` : "회차가 없어 셀 수 없음"} />
                      <MoneyTile label="남은 금액" value={r.remaining} vat={r.vatMode} plain />
                      <div className="min-w-0 rounded-nd-md border border-nd-line px-4 py-3">
                        <p className="text-[13px] text-nd-fg-3">다음 받을 날</p>
                        <p className="nd-num mt-1 text-[20px] font-bold text-nd-fg">{r.next ? fmtDateStr(r.next.date) : "—"}</p>
                        <p className="text-[13px] text-nd-fg-3">{r.next ? `${wonOrDash(r.next.amount)} · ${vatText(r.vatMode)}` : "잡힌 회차 없음"}</p>
                      </div>
                      <div className="min-w-0 rounded-nd-md border border-nd-line px-4 py-3">
                        <p className="text-[13px] text-nd-fg-3">연체</p>
                        <p className={cn("nd-num mt-1 text-[20px] font-bold", r.overdue ? "text-nd-danger-text" : "text-nd-fg")}>
                          {r.overdue}
                          <span className="ml-0.5 text-[14px] font-medium">건</span>
                        </p>
                        <p className="text-[13px] text-nd-fg-3">기한 지난 미입금 회차</p>
                      </div>
                    </div>
                    {r.received !== null && r.contractAmount > 0 && <ProgressLine className="mt-4" value={r.received} total={r.contractAmount} tone="success" />}
                    <p className="mt-3 text-[13px] text-nd-fg-3">재무 자료는 읽기 전용이며 재무 권한이 있는 사람에게만 보입니다. 금액 · 회차 · 계약서를 고치려면 「재무에서 열기」.</p>
                  </>
                ) : r && !r.projectId ? (
                  <StudioNotice tone="warning">재무에서 「{code}」 프로젝트를 찾지 못했습니다 — 코드가 바뀌었거나 지워졌을 수 있습니다.</StudioNotice>
                ) : (
                  <p className="text-[13px] text-nd-fg-3">저장한 뒤 재무 자료를 불러옵니다.</p>
                )}
              </StudioCard>
              {r && r.projectId && (
                <>
                  <StudioCard flush title="받을 돈 일정" description="재무의 회차 기록 그대로 — 받음 · 연체 · 예정">
                    <RecordTable
                      rows={r.installments.map((i, n) => ({ ...i, n: n + 1 }))}
                      rowKey={(i) => i.id}
                      ariaLabel="받을 돈 일정"
                      className="[&>ul]:px-4 [&>ul]:pb-4"
                      empty={<p className="px-5 pb-5 text-[14px] text-nd-fg-3 sm:px-6">회차가 없습니다 — 재무에서 받을 날을 나눠 적으면 여기에 보입니다.</p>}
                      columns={[
                        { key: "n", header: "회차", mobile: "title", cell: (i) => `${i.n}차${i.kind ? ` · ${i.kind}` : ""}` },
                        { key: "due", header: "기한", cell: (i) => <span className="nd-num whitespace-nowrap">{i.dueDate ?? (i.dueLabel || "날짜 미정")}</span> },
                        {
                          key: "amount",
                          header: "금액",
                          align: "right",
                          cell: (i) => (
                            <span className="block whitespace-nowrap">
                              <Won value={i.amount} flow="income" />
                              <span className="block text-[13px] text-nd-fg-3">{vatText(r.vatMode)}</span>
                            </span>
                          ),
                        },
                        {
                          key: "state",
                          header: "상태",
                          cell: (i) => {
                            const st = installmentState(i, today);
                            return st === "paid" ? (
                              <Badge tone="success" size="lg">
                                받음
                              </Badge>
                            ) : st === "overdue" ? (
                              <Badge tone="danger" size="lg">
                                연체 {daysBetween(i.dueDate!, today)}일
                              </Badge>
                            ) : (
                              <Badge tone="info" size="lg">
                                예정
                              </Badge>
                            );
                          },
                        },
                        { key: "paid", header: "입금 기록", cell: (i) => <span className="nd-num whitespace-nowrap text-nd-fg-2">{i.received ? (i.paidDate ?? "받음 · 날짜 미확인") : installmentState(i, today) === "overdue" ? "미입금" : "확인 전"}</span> },
                      ]}
                    />
                  </StudioCard>
                  <StudioCard
                    flush
                    title="계약서"
                    action={
                      <span className="flex flex-wrap gap-1.5" aria-label="계약서 상태 종류">
                        {(Object.keys(CONTRACT_STATUS_TEXT) as ClientFinanceContract["status"][]).map((k) => (
                          <Badge key={k} tone={CONTRACT_TONE[k]} size="lg">
                            {CONTRACT_STATUS_TEXT[k]}
                          </Badge>
                        ))}
                      </span>
                    }
                  >
                    <RecordTable
                      rows={r.contracts}
                      rowKey={(x) => x.id}
                      rowHref={() => `/neander/finance/projects/${r.projectId}`}
                      ariaLabel="계약서"
                      className="[&>ul]:px-4 [&>ul]:pb-4"
                      empty={<p className="px-5 pb-5 text-[14px] text-nd-fg-3 sm:px-6">이 재무 프로젝트에 계약서가 없습니다 — 「재무에서 열기」 에서 표준 양식으로 만들거나 받은 계약서를 붙이세요.</p>}
                      columns={[
                        { key: "title", header: "제목", mobile: "title", cell: (x) => <span className="font-medium">{x.title || "(제목 없음)"}</span> },
                        {
                          key: "status",
                          header: "상태",
                          cell: (x) => (
                            <Badge tone={CONTRACT_TONE[x.status]} size="lg">
                              {CONTRACT_STATUS_TEXT[x.status]}
                            </Badge>
                          ),
                        },
                        { key: "signed", header: "체결일", cell: (x) => <span className="nd-num whitespace-nowrap text-nd-fg-2">{x.signedDate ?? "—"}</span> },
                        {
                          key: "period",
                          header: "계약 기간",
                          cell: (x) => (
                            <span className="nd-num whitespace-nowrap text-nd-fg-2">
                              {x.startDate ?? ""}
                              {x.endDate ? ` ~ ${x.endDate}` : x.startDate ? " ~" : "—"}
                            </span>
                          ),
                        },
                        {
                          key: "amount",
                          header: "금액",
                          align: "right",
                          cell: (x) =>
                            x.amount ? (
                              <span className="block whitespace-nowrap">
                                <Won value={x.amount} flow="income" />
                                <span className="block text-[13px] text-nd-fg-3">{vatText(x.vatMode)}</span>
                              </span>
                            ) : (
                              <Unknown title="계약서에 금액이 없습니다" />
                            ),
                        },
                        {
                          key: "open",
                          header: "열기",
                          mobile: "hide",
                          cell: () => (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-nd-accent">
                              <ExternalLink size={14} aria-hidden /> 재무에서 열기
                            </span>
                          ),
                        },
                      ]}
                    />
                  </StudioCard>
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/** 재무 금액 한 칸 — 들어오는 돈은 초록, 부가세 기준을 옆에 */
function MoneyTile({ label, value, vat, note, plain = false }: { label: string; value: number | null; vat: "excluded" | "included"; note?: string; plain?: boolean }) {
  return (
    <div className="min-w-0 rounded-nd-md border border-nd-line px-4 py-3">
      <p className="text-[13px] text-nd-fg-3">{label}</p>
      <p className="mt-1 truncate text-[20px] font-bold">{value === null ? <Unknown title="회차가 없어 셀 수 없습니다" /> : <Won value={value} flow={plain ? undefined : "income"} />}</p>
      <p className="text-[13px] text-nd-fg-3">
        {vatText(vat)}
        {note ? ` · ${note}` : ""}
      </p>
    </div>
  );
}
