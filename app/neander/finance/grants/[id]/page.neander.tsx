"use client";

// ============================================================
//  지원금 — 상세 (한 지원사업)
// ------------------------------------------------------------
//  제목 줄 → 탭 다섯 → 탭 안 내용. 프로젝트 상세와 같은 틀이다.
//    개요     숫자 띠 · 기본 정보 · 원장에서 찾는 조건(전용 계좌 · 입금자)
//    받은 돈  수령 완료 회차 · 실제 입금 · 원장 밖 수령 · 반납
//    받을 돈  미수령·부분 수령 회차 · 매달 반복 만들기
//    쓴 돈    비목별 예산과 쓴 돈 · 원장에서 찾은 지출을 비목에 배정
//    첨부파일 사업계획서 · 협약서 · 증빙 파일 보관
//  셈은 lib/neander/finance/grant.ts. 원장 거래에는 아무것도 쓰지 않는다 —
//  이 사업 돈인지, 어느 비목인지는 지원사업 문서(alloc)에만 남긴다.
//
//  저장 버튼이 없다. 손을 멈추면 문서를 통째로 보낸다(프로젝트와 같다).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  CircleAlert,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  Menu,
  type MenuItem,
  Money,
  NumberInput,
  PageHeader,
  PageShell,
  SearchInput,
  SectionHeader,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  type Tone,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { AutoCodeBox } from "@/components/neander/finance/AutoCode";
import { DueInput } from "@/components/neander/finance/DueInput";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { GrantFilesPanel } from "@/components/neander/finance/GrantFiles";
import { useCrumbTail } from "@/components/neander/shell/context";
import { deleteGrant, saveGrant, useGrants } from "@/lib/neander/finance/grant-client";
import {
  ALLOC_IN,
  ALLOC_OUT,
  BUDGET_ITEM_SUGGESTIONS,
  GRANT_INST_LABEL,
  GRANT_KINDS,
  GRANT_STATUSES,
  GRANT_STATUS_LABEL,
  grantDueLabel,
  grantSummary,
  isGrantIncome,
  isGrantRefund,
  monthlyInstallments,
  newBudgetLine,
  newGrantInstallment,
  sanitizeGrant,
  type FinGrantBudgetLine,
  type FinGrantDoc,
  type FinGrantInput,
  type FinGrantInstallment,
  type GrantInstStatus,
  type GrantInstView,
  type GrantKind,
  type GrantStatus,
  type GrantTx,
} from "@/lib/neander/finance/grant";
import { PROJECT_ENTITIES, type ProjectEntity } from "@/lib/neander/finance/project";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";
import { formatChatTime, shiftMonth, todayStrKST } from "@/lib/neander/format";

/** 상태 → 의미 색 (목록 화면과 같은 표) */
const GRANT_STATUS_TONE: Record<GrantStatus, Tone> = {
  applying: "neutral",
  active: "accent",
  settling: "warning",
  done: "success",
  dropped: "danger",
};
const INST_TONE: Record<GrantInstStatus, Tone> = {
  paid: "success",
  partial: "warning",
  overdue: "danger",
  planned: "neutral",
};

type TabKey = "overview" | "received" | "receivable" | "spend" | "files";
const TAB_HASHES: Record<TabKey, string> = { overview: "#overview", received: "#received", receivable: "#receivable", spend: "#spend", files: "#files" };
const TAB_KEYS = Object.keys(TAB_HASHES) as TabKey[];

/** 좁은 화면에서는 칸이 두 줄로 접혀 줄끼리 섞여 보이므로 줄 사이에 선을 긋는다 */
const MOBILE_ROW_RULE = "border-t border-nd-line pt-3 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0";

/** 손을 멈추고 이만큼 지나면 저장한다 */
const AUTOSAVE_MS = 800;

/** 키 순서와 상관없이 같은 값인가 — 저장본과 초안을 견줄 때 */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function toInput(g: FinGrantDoc): FinGrantInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, createdBy, updatedAt, updatedBy, ...rest } = g;
  return {
    ...rest,
    accounts: g.accounts ? [...g.accounts] : undefined,
    installments: (g.installments ?? []).map((i) => ({ ...i })),
    budget: (g.budget ?? []).map((l) => ({ ...l })),
    alloc: g.alloc ? { ...g.alloc } : undefined,
  };
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function GrantDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  return <GrantEditor key={id} id={id} />;
}

function GrantEditor({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { transactions, paymentMethods, loading: finLoading } = useFinance();
  const { grants, loading, refresh } = useGrants();
  const saved = useMemo(() => grants.find((g) => g.id === id) ?? null, [grants, id]);
  useCrumbTail(saved?.name);

  const [draft, setDraft] = useState<FinGrantInput | null>(null);
  const form: FinGrantInput | null = draft ?? (saved ? toInput(saved) : null);
  const edit = useCallback(
    (fn: (g: FinGrantInput) => FinGrantInput) =>
      setDraft((d) => {
        const base = d ?? (saved ? toInput(saved) : null);
        return base ? fn(base) : d;
      }),
    [saved],
  );
  const setField = <K extends keyof FinGrantInput>(k: K, v: FinGrantInput[K]) => edit((g) => ({ ...g, [k]: v }));

  // ---- 탭 ----
  const [tab, setTab] = useState<TabKey>("overview");
  const [filesVisited, setFilesVisited] = useState(false);
  const [activeInst, setActiveInst] = useState<{ id: string; tab: "received" | "receivable" } | null>(null);
  useEffect(() => {
    if (tab === "files") setFilesVisited(true);
  }, [tab]);
  useEffect(() => {
    const apply = () => {
      // 이전 「받을 돈」 주소는 이미 받은 내역을 보던 주소이므로 수령 탭으로 잇는다.
      const hit = window.location.hash === "#receive" ? "received" : TAB_KEYS.find((k) => TAB_HASHES[k] === window.location.hash);
      if (hit) {
        setActiveInst(null);
        setTab(hit);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const goTab = useCallback((key: string) => {
    const next = (TAB_KEYS as string[]).includes(key) ? (key as TabKey) : "overview";
    setActiveInst(null);
    setTab(next);
    window.history.replaceState(null, "", TAB_HASHES[next]);
  }, []);

  // ---- 자동 저장 ----
  //  손을 멈추면 초안을 통째로 보낸다. 서버가 다듬은 값(공백 · 빈 줄)이 초안과
  //  같을 때만 초안을 내려놓고 저장본을 따라간다 — 아니면 방금 「추가」 한 빈 줄이
  //  사라진다(프로젝트 상세와 같은 이유).
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<FinGrantInput | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState<{ draft: FinGrantInput; message: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const removedRef = useRef(false);
  const dirty = !!draft && !!saved && stableJson(draft) !== stableJson(toInput(saved));
  const needsSave = dirty && draft !== lastSaved;

  const saveDraft = useCallback(
    async (snap: FinGrantInput) => {
      const checked = sanitizeGrant(snap);
      if (!checked.ok) {
        setInvalid(checked.error);
        return;
      }
      setInvalid(null);
      setSaving(true);
      try {
        await saveGrant(snap, id);
        await refresh();
        setLastSaved(snap);
        setSavedAt(Date.now());
        setFailed(null);
        if (stableJson(checked.value) === stableJson(snap)) setDraft((d) => (d === snap ? null : d));
      } catch (e) {
        setFailed({ draft: snap, message: e instanceof Error ? e.message : "저장에 실패했습니다." });
      } finally {
        setSaving(false);
      }
    },
    [id, refresh],
  );

  useEffect(() => {
    if (!draft || !needsSave || saving || removedRef.current) return;
    if (failed?.draft === draft) return;
    const t = window.setTimeout(() => void saveDraft(draft), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [draft, needsSave, saving, failed, saveDraft]);

  // 떠날 때 남은 변경을 보낸다 · 창을 닫으려 하면 막는다
  const leaveRef = useRef<FinGrantInput | null>(null);
  useEffect(() => {
    leaveRef.current = needsSave ? draft : null;
  });
  useEffect(
    () => () => {
      const left = leaveRef.current;
      if (left && !removedRef.current && sanitizeGrant(left).ok) {
        saveGrant(left, id).catch(() => toast.error("지원사업 변경을 저장하지 못했습니다."));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  useEffect(() => {
    if (!needsSave && !saving) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [needsSave, saving]);

  // ---- 셈 ----
  const today = todayStrKST();
  const summary = useMemo(() => (form ? grantSummary(form, transactions, today) : null), [form, transactions, today]);
  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const aliasOf = useCallback(
    (last4?: string) => paymentMethods.find((p) => p.last4 === last4)?.alias ?? last4 ?? "—",
    [paymentMethods],
  );

  // ---- 더보기 · 삭제 ----
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const remove = async () => {
    if (!saved) return;
    const ok = await confirm({
      title: `「${saved.name}」 지원사업을 지울까요?`,
      message: "회차 · 비목 · 배정도 함께 사라집니다. 원장 거래는 그대로 남습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    removedRef.current = true;
    try {
      await deleteGrant(id);
      await refresh();
      router.push("/neander/finance/grants");
    } catch (e) {
      removedRef.current = false;
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    }
  };
  const moreItems: MenuItem[] = [{ key: "delete", label: "삭제", icon: Trash2, danger: true, onSelect: () => void remove() }];

  if (loading || finLoading) return <LoadingState />;
  if (!form || !summary) {
    return (
      <PageShell>
        <EmptyState
          title="지원사업을 찾을 수 없습니다"
          description="지워졌거나 주소가 잘못됐습니다."
          action={
            <Link href="/neander/finance/grants">
              <Button variant="secondary" icon={ArrowLeft}>지원금 목록</Button>
            </Link>
          }
        />
      </PageShell>
    );
  }

  // ---- 줄 조작 ----
  const updateInst = (iid: string, patch: Partial<FinGrantInstallment>) =>
    edit((g) => ({ ...g, installments: g.installments.map((i) => (i.id === iid ? { ...i, ...patch } : i)) }));
  const removeInst = (iid: string) => edit((g) => ({ ...g, installments: g.installments.filter((i) => i.id !== iid) }));
  const updateLine = (lid: string, patch: Partial<FinGrantBudgetLine>) =>
    edit((g) => ({ ...g, budget: g.budget.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }));
  const removeLine = (lid: string) =>
    edit((g) => {
      // 그 비목에 배정한 거래는 배정을 푼다 — 남겨 두면 없는 비목을 가리킨다
      const alloc = Object.fromEntries(Object.entries(g.alloc ?? {}).filter(([, v]) => v !== lid));
      return { ...g, budget: g.budget.filter((l) => l.id !== lid), alloc };
    });
  const setAlloc = (txId: string, value: string | null) =>
    edit((g) => {
      const alloc = { ...(g.alloc ?? {}) };
      if (value === null) delete alloc[txId];
      else alloc[txId] = value;
      return { ...g, alloc };
    });

  const period =
    form.startDate || form.endDate ? `${form.startDate ?? "?"} ~ ${form.endDate ?? "?"}` : null;
  const excluded = Object.entries(form.alloc ?? {})
    .filter(([, v]) => v === ALLOC_OUT)
    .map(([txId]) => txById.get(txId))
    .filter((t): t is FinTransaction => !!t);

  // 허용 오차로 paid가 된 빈 줄·소액 회차도 실제 수령이 없으면 예정으로 보인다.
  const installmentRecords = summary.installments.map<GrantInstView>((v) => {
    if (v.status !== "paid" || v.filled > 0 || v.inst.received) return v;
    const amount = Math.max(0, Math.round(v.inst.amount) || 0);
    return {
      ...v,
      remaining: amount,
      status: amount > 0 && v.inst.dueDate && v.inst.dueDate < today ? "overdue" : "planned",
    };
  });
  const isReceivedInst = (v: GrantInstView) => v.status === "paid" && (v.filled > 0 || !!v.inst.received);
  const pendingInsts = installmentRecords.filter((v) => !isReceivedInst(v));
  const pendingAmount = pendingInsts.reduce((sum, v) => sum + v.remaining, 0);
  const overdueInsts = pendingInsts.filter((v) => v.remaining > 0 && v.inst.dueDate && v.inst.dueDate < today);
  const overdueAmount = overdueInsts.reduce((sum, v) => sum + v.remaining, 0);
  const nextInst = [...pendingInsts].filter((v) => v.remaining > 0).sort((a, b) => (a.inst.dueDate ?? "9999").localeCompare(b.inst.dueDate ?? "9999"))[0];
  // 금액·수령 표시를 고치는 동안에는 줄을 옮기지 않아 입력 포커스를 지킨다.
  const visibleInsts = installmentRecords.filter((v) =>
    activeInst?.id === v.inst.id && activeInst.tab === tab
      ? true
      : tab === "received" ? isReceivedInst(v) : !isReceivedInst(v),
  );
  const tabs = [
    { key: "overview", label: "개요" },
    { key: "received", label: "받은 돈", hint: `${summary.ledger.incomes.length + form.installments.filter((i) => i.received && i.amount > 0).length}건` },
    { key: "receivable", label: "받을 돈", hint: `${pendingInsts.length}회차` },
    { key: "spend", label: "쓴 돈", hint: form.budget.length > 0 ? `${form.budget.length}비목` : undefined },
    { key: "files", label: "첨부파일" },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        className="mb-4"
        eyebrow={
          <Link href="/neander/finance/grants" className="inline-flex items-center gap-1 hover:text-nd-accent-strong">
            <Icon icon={ArrowLeft} size={14} />
            지원금 목록
          </Link>
        }
        title={
          <span className="flex min-w-0 items-center gap-1">
            <span className="-ml-1.5 inline-grid min-w-0 grid-cols-[minmax(0,max-content)]">
              <span aria-hidden className="invisible col-start-1 row-start-1 truncate whitespace-pre border border-transparent px-1.5">
                {form.name || "사업 이름"}
              </span>
              <input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                size={1}
                className="col-start-1 row-start-1 w-full min-w-0 text-ellipsis rounded-nd-md border border-transparent bg-transparent px-1.5 text-nd-fg outline-none transition-colors duration-nd-fast placeholder:text-nd-fg-4 hover:border-nd-border focus:border-nd-accent focus:bg-nd-content"
                aria-label="사업 이름"
                placeholder="사업 이름"
              />
            </span>
            <Icon icon={Pencil} size={16} className="shrink-0 text-nd-fg-4" />
          </span>
        }
        titleSuffix={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={GRANT_STATUS_TONE[form.status]} dot>
              {GRANT_STATUS_LABEL[form.status]}
            </Badge>
            <span className="font-mono text-nd-caption text-nd-fg-2">{form.code || "코드 없음"}</span>
            <span className="text-nd-caption text-nd-fg-3">· {form.kind}</span>
            {form.agency && <span className="text-nd-caption text-nd-fg-3">· {form.agency}</span>}
            {period && <span className="nd-num text-nd-caption text-nd-fg-3">· {period}</span>}
          </span>
        }
        meta={
          <span role="status" className="flex items-center gap-2">
            {failed && failed.draft === draft ? (
              <>
                <Badge tone="danger">
                  <Icon icon={CircleAlert} size={14} />
                  저장하지 못했습니다
                </Badge>
                <span className="max-w-[260px] truncate text-nd-table text-nd-fg-3" title={failed.message}>
                  {failed.message}
                </span>
                <Button size="sm" variant="secondary" icon={RotateCw} onClick={() => void saveDraft(failed.draft)}>
                  다시 시도
                </Button>
              </>
            ) : invalid && needsSave ? (
              <>
                <Badge tone="warning">
                  <Icon icon={CircleAlert} size={14} />
                  저장 안 됨
                </Badge>
                <span className="text-nd-table text-nd-fg-2">{invalid}</span>
              </>
            ) : saving || needsSave ? (
              <span className="text-nd-table text-nd-fg-3">저장 중…</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-nd-table text-nd-fg-3">
                <Icon icon={Check} size={14} />
                {savedAt ? `저장됨 · ${formatChatTime(savedAt)}` : "자동 저장"}
              </span>
            )}
          </span>
        }
        actions={
          <IconButton
            ref={moreRef}
            icon={MoreHorizontal}
            label="지원사업 더보기"
            variant="secondary"
            onClick={() => setMoreOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          />
        }
      />
      <Menu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} placement="bottom-end" ariaLabel="지원사업 더보기" items={moreItems} />

      <Tabs className="mb-4" ariaLabel="지원사업 상세" value={tab} onChange={goTab} items={tabs} />

      {/* ================= 개요 ================= */}
      {tab === "overview" && (
        <>
          <KpiStrip columns={5} className="mb-5">
            {summary.total > 0 ? <StatTile
              label="총 지원금"
              value={summary.total}
              flow="income"
              hint={
                form.selfCash || form.selfInKind
                  ? `자부담 현금 ${won(form.selfCash ?? 0)} · 현물 ${won(form.selfInKind ?? 0)}`
                  : "정부 몫"
              }
            /> : <KpiItem label="총 지원금" value="미확인" hint="개요에서 전체 지원금액을 입력하세요" />}
            <StatTile
              label="받은 돈"
              value={summary.received}
              flow="income"
              hint={`원장 입금 ${summary.ledger.incomes.length}건${summary.refunded > 0 ? ` · 반납 ${won(summary.refunded)}` : ""}${summary.receivedManual > 0 ? ` · 원장 밖 ${won(summary.receivedManual)}` : ""}`}
            />
            {summary.total > 0 ? <StatTile
              label="앞으로 받을 돈"
              value={summary.remaining}
              tone={overdueAmount > 0 ? "danger" : undefined}
              hint={overdueAmount > 0 ? `늦은 회차 ${overdueInsts.length}건 · ${won(overdueAmount)}원` : summary.remaining === 0 ? "등록한 총 지원금 기준 수령 완료" : "아직 안 들어온 돈"}
            /> : <KpiItem label="앞으로 받을 돈" value="미확인" hint={`등록된 예정 금액 ${won(pendingAmount)}원 · 전체 잔액 미확인`} />}
            <StatTile
              label="다음 입금"
              value={nextInst?.remaining ?? 0}
              flow="income"
              hint={nextInst ? `${nextInst.inst.label || "회차"} · ${nextInst.inst.dueDate ? grantDueLabel(nextInst.inst) : "날짜 미정"}` : "등록된 입금 예정이 없습니다"}
            />
            <StatTile
              label="쓴 돈"
              value={summary.spent}
              flow="expense"
              hint={summary.budgetTotal > 0 ? `예산 ${won(summary.budgetTotal)} · ${Math.round((summary.spent / summary.budgetTotal) * 100)}%` : "비목 예산을 아직 안 적었습니다"}
            />
          </KpiStrip>

          <Card padding="sm" className="mb-5">
            <SectionHeader title="기본 정보" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="코드" hint="원장 프로젝트코드 — 이 코드를 붙인 거래는 이 사업 거래">
                <AutoCodeBox code={form.code} size="sm" tag="고정" />
              </Field>
              <Field label="종류">
                <Select size="sm" value={form.kind} onChange={(e) => setField("kind", e.target.value as GrantKind)}>
                  {GRANT_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              <Field label="상태">
                <Select size="sm" value={form.status} onChange={(e) => setField("status", e.target.value as GrantStatus)}>
                  {GRANT_STATUSES.map((st) => (
                    <option key={st} value={st}>{GRANT_STATUS_LABEL[st]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="주관 · 전담기관">
                <Input size="sm" value={form.agency ?? ""} onChange={(e) => setField("agency", e.target.value || undefined)} placeholder="중소벤처기업부" />
              </Field>
              <Field label="협약 시작일">
                <Input size="sm" type="date" value={form.startDate ?? ""} onChange={(e) => setField("startDate", e.target.value || undefined)} />
              </Field>
              <Field label="협약 종료일">
                <Input size="sm" type="date" value={form.endDate ?? ""} onChange={(e) => setField("endDate", e.target.value || undefined)} />
              </Field>
              <Field label="사업체" hint="지원금을 받은 사업자">
                <Select size="sm" value={form.entity ?? ""} onChange={(e) => setField("entity", (e.target.value || undefined) as ProjectEntity | undefined)}>
                  <option value="">고르지 않음</option>
                  {PROJECT_ENTITIES.map((en) => (
                    <option key={en} value={en}>{en}</option>
                  ))}
                </Select>
              </Field>
              <Field label="총 지원금" hint="정부 몫 · 모르면 비워 두세요">
                <NumberInput size="sm" value={form.total || ""} placeholder="0" onValueChange={(v) => setField("total", Number(v) || 0)} className="text-right" />
              </Field>
              <Field label="자부담 현금">
                <NumberInput size="sm" value={form.selfCash || ""} placeholder="0" onValueChange={(v) => setField("selfCash", Number(v) || undefined)} className="text-right" />
              </Field>
              <Field label="자부담 현물">
                <NumberInput size="sm" value={form.selfInKind || ""} placeholder="0" onValueChange={(v) => setField("selfInKind", Number(v) || undefined)} className="text-right" />
              </Field>
            </div>
            <Field label="메모" className="mt-3">
              <Textarea
                size="sm"
                rows={2}
                value={form.note ?? ""}
                onChange={(e) => setField("note", e.target.value || undefined)}
                className="!min-h-0"
                placeholder="협약 조건 · 정산 기한 · 담당자 …"
              />
            </Field>
          </Card>

          <LedgerRouteCard form={form} setField={setField} summary={summary} transactions={transactions} />
        </>
      )}

      {/* ================= 받은 돈 · 받을 돈 ================= */}
      {(tab === "received" || tab === "receivable") && (
        <div className="flex flex-col gap-5">
          {tab === "received" ? (
            <KpiStrip columns={3}>
              <StatTile label="받은 돈" value={summary.received} flow="income" hint="실제 입금 + 원장 밖 수령 − 반납" />
              <StatTile label="원장 입금" value={summary.receivedLedger} flow="income" hint={`${summary.ledger.incomes.length}건의 입금 내역`} />
              <StatTile label="반납한 돈" value={summary.refunded} flow="expense" hint={summary.receivedManual > 0 ? `원장 밖 수령 ${won(summary.receivedManual)}원 별도 포함` : "수령액에서 차감한 금액"} />
            </KpiStrip>
          ) : (
            <>
              <KpiStrip columns={3}>
                {summary.total > 0 ? (
                  <StatTile label="앞으로 받을 돈" value={summary.remaining} flow="income" hint="총 지원금에서 이미 받은 돈을 뺀 금액" />
                ) : (
                  <KpiItem label="앞으로 받을 돈" value="미확인" hint="총 지원금액을 아직 확인하지 못했습니다" />
                )}
                <StatTile label="등록된 예정 금액" value={pendingAmount} flow="income" hint={`${pendingInsts.length}회차 · 부분 수령 회차는 남은 금액만 포함`} />
                <StatTile label="늦은 회차" value={overdueAmount} tone={overdueAmount > 0 ? "danger" : undefined} hint={`${overdueInsts.length}회차 · 예정일이 지난 미수령 금액`} />
              </KpiStrip>
              {summary.total === 0 && (
                <InlineNotice tone="info">
                  <strong className="mr-1 font-medium">총 지원금액 미확인.</strong>
                  아래에는 등록한 입금 예정만 보입니다. 예정 회차가 없어도 전체 지원금을 다 받았다는 뜻은 아닙니다.
                </InlineNotice>
              )}
              {summary.total > 0 && summary.remaining > pendingAmount && (
                <InlineNotice tone="info">
                  <strong className="mr-1 font-medium">아직 일정이 없는 받을 돈.</strong>
                  남은 지원금 중 {won(summary.remaining - pendingAmount)}원은 회차가 등록되지 않았습니다. 받을 금액과 예정일을 추가하세요.
                </InlineNotice>
              )}
            </>
          )}
          <Card padding="sm">
            <SectionHeader
              title={tab === "received" ? "수령 완료 회차" : "앞으로 받을 회차"}
              hint={tab === "received" ? "완료된 회차 정보입니다. 회차 예정일과 실제 입금일은 다를 수 있으며, 실제 날짜는 아래 입금 내역에서 확인합니다." : "아직 못 받은 회차와 일부만 받은 회차를 관리합니다"}
              action={
                tab === "receivable" ? <>
                  <Button variant="ghost" size="sm" icon={CalendarPlus} onClick={() => setMonthlyOpen(true)}>
                    매달 회차 만들기
                  </Button>
                  <Button variant="ghost" size="sm" icon={Plus} onClick={() => edit((g) => ({ ...g, installments: [...g.installments, newGrantInstallment()] }))}>
                    회차 추가
                  </Button>
                </> : <Button variant="ghost" size="sm" icon={Plus} onClick={() => edit((g) => ({ ...g, installments: [...g.installments, { ...newGrantInstallment(), received: true }] }))}>원장 밖 수령 추가</Button>
              }
            />
            {visibleInsts.length === 0 ? (
              <p className="text-nd-table text-nd-fg-3">
                {tab === "received" ? "수령 완료로 확인된 회차가 없습니다. 실제 원장 입금은 아래에 표시됩니다." : "등록된 미수령 회차가 없습니다. 받을 돈이 있으면 「회차 추가」나 「매달 회차 만들기」로 등록하세요."}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleInsts.map(({ inst, status, filled, remaining }) => (
                  <FormRow
                    key={inst.id}
                    onFocusCapture={() => setActiveInst({ id: inst.id, tab })}
                    onBlurCapture={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiveInst(null);
                    }}
                    className={cn(MOBILE_ROW_RULE, "grid-cols-2 sm:grid-cols-[minmax(7rem,1fr)_9rem_minmax(11rem,auto)_9rem_auto_minmax(8rem,1.2fr)_auto]")}
                  >
                    <Field label="이름">
                      <Input size="sm" value={inst.label} onChange={(e) => updateInst(inst.id, { label: e.target.value })} placeholder="회차 이름" />
                    </Field>
                    <Field label="회차 금액">
                      <NumberInput size="sm" value={inst.amount || ""} placeholder="0" onValueChange={(v) => updateInst(inst.id, { amount: Number(v) || 0 })} className="text-right" />
                    </Field>
                    <Field label="회차 예정일">
                      <DueInput value={{ dueDate: inst.dueDate, dueApprox: inst.dueApprox }} onChange={(v) => updateInst(inst.id, { dueDate: v.dueDate, dueApprox: v.dueApprox })} label="회차 예정일" />
                    </Field>
                    <FieldAction center>
                      <span className="flex items-center gap-1.5">
                        <Badge tone={INST_TONE[inst.amount <= 0 ? "planned" : status]} size="sm">{inst.amount <= 0 ? "금액 미입력" : GRANT_INST_LABEL[status]}</Badge>
                        {status === "partial" && <span className="nd-num text-nd-table text-nd-fg-2">받음 {won(filled)} / 받을 돈 {won(remaining)}</span>}
                      </span>
                    </FieldAction>
                    <FieldAction center>
                      <label className="flex items-center gap-1.5 whitespace-nowrap text-nd-table text-nd-fg-2" title="원장에 없는 돈으로 받았다 — 장부 이전 · 다른 통장">
                        <Checkbox checked={!!inst.received} onChange={(e) => updateInst(inst.id, { received: e.target.checked || undefined })} />
                        원장 밖에서 받음
                      </label>
                    </FieldAction>
                    <Field label="메모">
                      <Input size="sm" value={inst.note ?? ""} onChange={(e) => updateInst(inst.id, { note: e.target.value || undefined })} />
                    </Field>
                    <FieldAction>
                      <IconButton icon={X} label={`${inst.label || "이 회차"} 빼기`} size="sm" onClick={() => removeInst(inst.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                    </FieldAction>
                  </FormRow>
                ))}
                <div className="mt-1 flex flex-wrap items-center justify-end gap-6 border-t border-nd-line pt-3 text-nd-table">
                  <span className="text-nd-fg-2">
                    전체 회차 합 <b className="ml-1 text-nd-body"><Money value={summary.scheduled} unit={false} flow="income" /></b>
                    {summary.total > 0 && summary.scheduled !== summary.total && (
                      <span className="ml-1.5 text-nd-warning-text">총 지원금과 {won(summary.total - summary.scheduled)} 차이</span>
                    )}
                  </span>
                  <span className="text-nd-fg-2">
                    {tab === "received" ? "실제 받은 돈" : "등록된 예정 잔액"} <b className="ml-1 text-nd-body"><Money value={tab === "received" ? summary.received : pendingAmount} unit={false} flow="income" /></b>
                  </span>
                </div>
              </div>
            )}
          </Card>

          {tab === "received" && <>
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="실제 입금·반납 내역"
                hint="개요의 「원장에서 찾는 조건」 으로 골랐습니다 — 이 사업 돈이 아니면 빼세요"
                action={<TableNote>단위: 원</TableNote>}
              />
            </div>
            {summary.ledger.incomes.length + summary.ledger.refunds.length === 0 ? (
              <p className="px-5 pb-5 text-nd-table text-nd-fg-3">
                아직 없습니다. 개요에서 전용 계좌나 입금자를 적거나, 아래에서 직접 넣으세요.
              </p>
            ) : (
              <TableScroll maxHeight={420}>
                <Table minWidth={760} dense>
                  <thead>
                    <tr>
                      <Th className="pl-5">날짜</Th>
                      <Th>계좌</Th>
                      <Th>입금자 · 거래처</Th>
                      <Th>계정</Th>
                      <Th align="right">금액</Th>
                      <Th>근거</Th>
                      <Th className="pr-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...summary.ledger.incomes.map((x) => ({ ...x, refund: false })), ...summary.ledger.refunds.map((x) => ({ ...x, refund: true }))]
                      .sort((a, b) => a.tx.date.localeCompare(b.tx.date))
                      .map((x) => (
                        <Tr key={x.tx.id}>
                          <Td className="pl-5 nd-num whitespace-nowrap">{x.tx.date}</Td>
                          <Td className="whitespace-nowrap text-nd-fg-2">{aliasOf(x.tx.last4)}</Td>
                          <Td className="max-w-[16rem] truncate" title={[x.tx.vendor, x.tx.note].filter(Boolean).join(" · ")}>
                            {x.tx.vendor || "—"}
                            {x.tx.note && <span className="ml-1.5 text-nd-fg-3">{x.tx.note}</span>}
                          </Td>
                          <Td className="whitespace-nowrap text-nd-fg-2">{x.tx.acctMinor ?? "—"}</Td>
                          <Td num>
                            <Money value={x.refund ? -x.amount : x.amount} unit={false} flow={x.refund ? "expense" : "income"} />
                            {x.refund && <span className="ml-1 text-nd-micro text-nd-fg-3">반납</span>}
                          </Td>
                          <Td className="whitespace-nowrap text-nd-table text-nd-fg-3">{whyText(x)}</Td>
                          <Td className="pr-5 text-right">
                            <Button variant="ghost" size="sm" onClick={() => setAlloc(x.tx.id, ALLOC_OUT)}>빼기</Button>
                          </Td>
                        </Tr>
                      ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>

          <Disclosure title="이 사업의 입금 연결 관리">
            <p className="mb-3 text-nd-table text-nd-fg-2">다른 지원사업의 입금도 검색됩니다. 이 사업에서 받은 돈으로 확인한 거래만 연결하세요.</p>
              <TxPicker
                label="입금 후보 검색"
                placeholder="입금자 · 금액 · 날짜"
                candidates={transactions.filter(
                  (t) =>
                    t.txType === "수입" &&
                    !summary.ledger.incomes.some((x) => x.tx.id === t.id) &&
                    form.alloc?.[t.id] !== ALLOC_OUT,
                )}
                preferred={(t) => isGrantIncome(t)}
                requireQuery
                aliasOf={aliasOf}
                renderAction={(t) => (
                  <Button variant="secondary" size="sm" onClick={() => setAlloc(t.id, ALLOC_IN)}>받은 돈으로</Button>
                )}
              />
          </Disclosure>

          <ExcludedList list={excluded.filter((t) => t.txType === "수입" || isGrantRefund(t))} aliasOf={aliasOf} onRestore={(txId) => setAlloc(txId, null)} />
          </>}
        </div>
      )}

      {/* ================= 쓴 돈 ================= */}
      {tab === "spend" && (
        <div className="flex flex-col gap-5">
          <Card padding="sm">
            <SectionHeader
              title="비목별 예산"
              hint="단서(거래처 이름 · 계정)를 적으면 협약 기간 안의 그 지출을 이 비목으로 찾습니다"
              action={
                <Button variant="ghost" size="sm" icon={Plus} onClick={() => edit((g) => ({ ...g, budget: [...g.budget, newBudgetLine()] }))}>
                  비목 추가
                </Button>
              }
            />
            {form.budget.length === 0 ? (
              <p className="text-nd-table text-nd-fg-3">
                아직 없습니다. 「인건비 · 김제연 · 215만 × 개월 수」 처럼 협약서의 비목을 옮겨 적으세요.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {summary.budget.map(({ line, spent, count }) => {
                  const rate = line.amount > 0 ? Math.round((spent / line.amount) * 100) : null;
                  return (
                    <FormRow
                      key={line.id}
                      className={cn(MOBILE_ROW_RULE, "grid-cols-2 sm:grid-cols-[8rem_minmax(8rem,1fr)_9rem_minmax(7rem,0.8fr)_8rem_minmax(9rem,auto)_auto]")}
                    >
                      <Field label="비목">
                        <Input size="sm" list="grant-budget-items" value={line.item} onChange={(e) => updateLine(line.id, { item: e.target.value })} placeholder="비목" />
                      </Field>
                      <Field label="세목 · 대상">
                        <Input size="sm" value={line.label ?? ""} onChange={(e) => updateLine(line.id, { label: e.target.value || undefined })} placeholder="누구 · 무엇" />
                      </Field>
                      <Field label="예산">
                        <NumberInput size="sm" value={line.amount || ""} placeholder="0" onValueChange={(v) => updateLine(line.id, { amount: Number(v) || 0 })} className="text-right" />
                      </Field>
                      <Field label="단서 · 거래처">
                        <Input size="sm" value={line.who ?? ""} onChange={(e) => updateLine(line.id, { who: e.target.value || undefined })} placeholder="거래처 이름 일부" />
                      </Field>
                      <Field label="단서 · 계정">
                        <Input size="sm" list="grant-acct-majors" value={line.acct ?? ""} onChange={(e) => updateLine(line.id, { acct: e.target.value || undefined })} placeholder="계정 이름" />
                      </Field>
                      <FieldAction center>
                        <span className="nd-num whitespace-nowrap text-nd-table">
                          <Money value={spent} unit={false} flow="expense" />
                          <span className="ml-1 text-nd-fg-3">
                            {count}건{rate !== null && ` · ${rate}%`}
                          </span>
                        </span>
                      </FieldAction>
                      <FieldAction>
                        <IconButton icon={X} label={`${line.item || "이 비목"} 빼기`} size="sm" onClick={() => removeLine(line.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                      </FieldAction>
                    </FormRow>
                  );
                })}
                <div className="mt-1 flex flex-wrap items-center justify-end gap-6 border-t border-nd-line pt-3 text-nd-table">
                  <span className="text-nd-fg-2">
                    예산 <b className="ml-1 text-nd-body"><Money value={summary.budgetTotal} unit={false} /></b>
                    {summary.total > 0 && summary.budgetTotal !== summary.total + (form.selfCash ?? 0) + (form.selfInKind ?? 0) && (
                      <span className="ml-1.5 text-nd-fg-3">(지원금 + 자부담 {won(summary.total + (form.selfCash ?? 0) + (form.selfInKind ?? 0))})</span>
                    )}
                  </span>
                  <span className="text-nd-fg-2">
                    쓴 돈 <b className="ml-1 text-nd-body"><Money value={summary.spent} unit={false} flow="expense" /></b>
                  </span>
                  {summary.unassigned !== 0 && (
                    <span className="text-nd-warning-text">비목 미정 {won(summary.unassigned)}</span>
                  )}
                </div>
              </div>
            )}
            <datalist id="grant-budget-items">
              {BUDGET_ITEM_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
            <datalist id="grant-acct-majors">
              {[...new Set(transactions.filter((t) => t.txType === "지출").flatMap((t) => [t.acctMajor, t.acctMid]))]
                .filter((s): s is string => !!s)
                .sort()
                .map((s) => <option key={s} value={s} />)}
            </datalist>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="원장에서 찾은 지출"
                hint="코드 꼬리표 · 전용 계좌 · 비목 단서로 골랐습니다 — 비목을 바꾸거나 이 사업 돈이 아니면 빼세요"
                action={<TableNote>단위: 원</TableNote>}
              />
            </div>
            {summary.ledger.spends.length === 0 ? (
              <p className="px-5 pb-5 text-nd-table text-nd-fg-3">
                아직 없습니다. 비목에 단서를 적거나, 원장에서 이 사업 지출에 코드 「{form.code}」 를 붙이거나, 아래에서 직접 넣으세요.
              </p>
            ) : (
              <TableScroll maxHeight={460}>
                <Table minWidth={860} dense>
                  <thead>
                    <tr>
                      <Th className="pl-5">날짜</Th>
                      <Th>계좌</Th>
                      <Th>거래처</Th>
                      <Th>계정</Th>
                      <Th align="right">금액</Th>
                      <Th>비목</Th>
                      <Th className="pr-5">근거</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.ledger.spends.map((x) => (
                      <Tr key={x.tx.id}>
                        <Td className="pl-5 nd-num whitespace-nowrap">{x.tx.date}</Td>
                        <Td className="whitespace-nowrap text-nd-fg-2">{aliasOf(x.tx.last4)}</Td>
                        <Td className="max-w-[16rem] truncate" title={[x.tx.vendor, x.tx.note].filter(Boolean).join(" · ")}>
                          {x.tx.vendor || "—"}
                        </Td>
                        <Td className="whitespace-nowrap text-nd-fg-2">{[x.tx.acctMajor, x.tx.acctMid].filter(Boolean).join(" › ") || "—"}</Td>
                        <Td num><Money value={x.amount} unit={false} flow="expense" /></Td>
                        <Td>
                          <Select
                            size="sm"
                            className="w-auto min-w-[9rem]"
                            aria-label={`${x.tx.date} ${x.tx.vendor ?? ""} 비목`}
                            value={x.lineId ?? ""}
                            onChange={(e) => setAlloc(x.tx.id, e.target.value || null)}
                          >
                            {!x.lineId && <option value="">비목 미정</option>}
                            {form.budget.map((l) => (
                              <option key={l.id} value={l.id}>{[l.item, l.label].filter(Boolean).join(" · ") || "이름 없는 비목"}</option>
                            ))}
                            <option value={ALLOC_OUT}>이 사업 돈 아님</option>
                          </Select>
                        </Td>
                        <Td className="pr-5 whitespace-nowrap text-nd-table text-nd-fg-3">{whyText(x)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
            <div className="border-t border-nd-line px-5 py-4">
              <TxPicker
                label="지출 더 찾기"
                placeholder="거래처 · 계정 · 금액 · 날짜"
                requireQuery
                candidates={transactions.filter(
                  (t) =>
                    (t.txType === "지출" || t.txType === "환급") &&
                    !isGrantRefund(t) &&
                    !summary.ledger.spends.some((x) => x.tx.id === t.id) &&
                    form.alloc?.[t.id] !== ALLOC_OUT &&
                    (!form.startDate || t.date >= form.startDate) &&
                    (!form.endDate || t.date <= form.endDate),
                )}
                aliasOf={aliasOf}
                renderAction={(t) =>
                  form.budget.length === 0 ? (
                    <span className="text-nd-table text-nd-fg-3">비목을 먼저 추가하세요</span>
                  ) : (
                    <Select size="sm" className="w-auto min-w-[9rem]" aria-label="넣을 비목" value="" onChange={(e) => e.target.value && setAlloc(t.id, e.target.value)}>
                      <option value="">비목에 넣기…</option>
                      {form.budget.map((l) => (
                        <option key={l.id} value={l.id}>{[l.item, l.label].filter(Boolean).join(" · ") || "이름 없는 비목"}</option>
                      ))}
                    </Select>
                  )
                }
              />
            </div>
          </Card>

          <ExcludedList list={excluded.filter((t) => t.txType !== "수입" && !isGrantRefund(t))} aliasOf={aliasOf} onRestore={(txId) => setAlloc(txId, null)} />
        </div>
      )}

      {(tab === "files" || filesVisited) && (
        <div hidden={tab !== "files"}><GrantFilesPanel grantId={id} /></div>
      )}

      {monthlyOpen && (
        <MonthlyDialog
          form={form}
          onClose={() => setMonthlyOpen(false)}
          onAdd={(list) => {
            edit((g) => ({ ...g, installments: [...g.installments, ...list] }));
            setMonthlyOpen(false);
            toast.success(`회차 ${list.length}개를 만들었습니다.`);
          }}
        />
      )}
    </PageShell>
  );
}

const whyText = (x: GrantTx) =>
  x.why === "code" ? "코드 꼬리표" : x.why === "route" ? "계좌 · 입금자" : x.why === "line" ? "비목 단서" : "직접 넣음";

// ---- 원장에서 찾는 조건 --------------------------------------------

function LedgerRouteCard({
  form,
  setField,
  summary,
  transactions,
}: {
  form: FinGrantInput;
  setField: <K extends keyof FinGrantInput>(k: K, v: FinGrantInput[K]) => void;
  summary: ReturnType<typeof grantSummary>;
  transactions: FinTransaction[];
}) {
  const { paymentMethods } = useFinance();
  const accounts = useMemo(() => paymentMethods.filter((p) => p.kind === "account"), [paymentMethods]);
  // 입금자 후보 — 원장의 지원금 입금 거래처 (숫자만 있는 이체 번호는 뺀다)
  const payers = useMemo(() => {
    const counts = new Map<string, number>();
    transactions.forEach((t) => {
      if (!isGrantIncome(t) || !t.vendor || /^\d+$/.test(t.vendor.trim())) return;
      counts.set(t.vendor, (counts.get(t.vendor) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [transactions]);
  const picked = new Set(form.accounts ?? []);
  const toggle = (last4: string) => {
    const next = new Set(picked);
    if (next.has(last4)) next.delete(last4);
    else next.add(last4);
    setField("accounts", next.size > 0 ? [...next] : undefined);
  };

  return (
    <Card padding="sm">
      <SectionHeader
        title="원장에서 찾는 조건"
        hint={`지금 조건으로 입금 ${summary.ledger.incomes.length}건 · 지출 ${summary.ledger.spends.length}건`}
      />
      <p className="mb-3 text-nd-table text-nd-fg-2">
        계정이 「지원금」 인 입금 중 아래 계좌로 들어왔거나 입금자가 맞는 것을 이 사업 돈으로 봅니다. 둘 다 적으면 둘 다 맞아야 합니다.
        전용 계좌에서 나간 지출은 이 사업으로 쓴 돈입니다. 원장에서 코드 「<span className="font-mono">{form.code}</span>」 를 붙인 거래는 조건과 상관없이 들어옵니다.
      </p>
      <Field label="전용 계좌 · 이 사업 돈이 드나드는 계좌">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="전용 계좌">
          {accounts.map((p) => {
            const on = picked.has(p.last4);
            return (
              <button
                key={p.last4}
                type="button"
                onClick={() => toggle(p.last4)}
                aria-pressed={on}
                className={cn(
                  "h-ctl-sm rounded-full border px-3 text-nd-table font-medium transition-colors duration-nd-fast",
                  on ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong" : "border-nd-line text-nd-fg-2 hover:bg-nd-fg/[.06]",
                )}
              >
                {p.alias} <span className="font-mono text-nd-fg-3">{p.last4}</span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="입금자 · 통장에 찍히는 이름" className="mt-3 max-w-md" hint="(주) · 사단법인 · 띄어쓰기는 무시합니다">
        <Input size="sm" list="grant-payers" value={form.payer ?? ""} onChange={(e) => setField("payer", e.target.value || undefined)} placeholder="비우면 계좌 · 코드로만 찾습니다" />
        <datalist id="grant-payers">
          {payers.map(([v, n]) => (
            <option key={v} value={v}>{`지원금 입금 ${n}건`}</option>
          ))}
        </datalist>
      </Field>
    </Card>
  );
}

// ---- 원장 거래 고르기 ------------------------------------------------

function TxPicker({
  label,
  placeholder,
  candidates,
  preferred,
  requireQuery = false,
  aliasOf,
  renderAction,
}: {
  label: string;
  placeholder: string;
  candidates: FinTransaction[];
  /** 검색어가 없을 때 먼저 보일 거래 */
  preferred?: (t: FinTransaction) => boolean;
  /** 검색어가 있어야 목록을 보인다 (지출처럼 후보가 수천 건일 때) */
  requireQuery?: boolean;
  aliasOf: (last4?: string) => string;
  renderAction: (t: FinTransaction) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/,/g, "");
    if (!s && requireQuery) return [];
    const hit = s
      ? candidates.filter((t) =>
          [t.date, t.vendor, t.note, t.acctMajor, t.acctMid, t.acctMinor, String(netAmount(t))].join(" ").toLowerCase().replace(/,/g, "").includes(s),
        )
      : candidates.filter((t) => !preferred || preferred(t));
    return [...hit].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  }, [q, candidates, preferred, requireQuery]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="text-nd-body font-semibold text-nd-fg">{label}</span>
        <SearchInput className="w-72" value={q} onValueChange={setQ} placeholder={placeholder} ariaLabel={label} />
      </div>
      {list.length === 0 ? (
        <p className="text-nd-table text-nd-fg-3">{q.trim() || !requireQuery ? "맞는 거래가 없습니다." : "검색어를 넣으면 원장에서 찾습니다."}</p>
      ) : (
        <ul className="flex max-h-72 flex-col divide-y divide-nd-line overflow-y-auto rounded-nd-md border border-nd-line">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-nd-table">
              <span className="nd-num w-24 shrink-0 text-nd-fg-2">{t.date}</span>
              <span className="w-20 shrink-0 truncate text-nd-fg-3">{aliasOf(t.last4)}</span>
              <span className="min-w-0 flex-1 truncate text-nd-fg" title={[t.vendor, t.note].filter(Boolean).join(" · ")}>
                {t.vendor || "—"}
                <span className="ml-1.5 text-nd-fg-3">{t.acctMinor ?? t.acctMid ?? ""}</span>
              </span>
              <span className="nd-num w-28 shrink-0 text-right">
                <Money value={netAmount(t)} unit={false} flow={t.txType === "수입" ? "income" : "expense"} />
              </span>
              <span className="shrink-0">{renderAction(t)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 「이 사업 돈 아님」 으로 뺀 거래 — 잘못 뺐으면 되돌린다 */
function ExcludedList({ list, aliasOf, onRestore }: { list: FinTransaction[]; aliasOf: (last4?: string) => string; onRestore: (txId: string) => void }) {
  if (list.length === 0) return null;
  return (
    <Card padding="sm">
      <SectionHeader as="h3" title="뺀 거래" hint={`${list.length}건 — 조건에는 걸리지만 이 사업 돈이 아니라고 한 것`} />
      <ul className="flex flex-col divide-y divide-nd-line">
        {list.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-nd-table">
            <span className="nd-num w-24 shrink-0 text-nd-fg-2">{t.date}</span>
            <span className="w-20 shrink-0 truncate text-nd-fg-3">{aliasOf(t.last4)}</span>
            <span className="min-w-0 flex-1 truncate">{t.vendor || "—"}</span>
            <Money value={netAmount(t)} unit={false} muted />
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => onRestore(t.id)}>되돌리기</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---- 매달 회차 만들기 ------------------------------------------------

function MonthlyDialog({
  form,
  onClose,
  onAdd,
}: {
  form: FinGrantInput;
  onClose: () => void;
  onAdd: (list: FinGrantInstallment[]) => void;
}) {
  const thisMonth = todayStrKST().slice(0, 7);
  const [from, setFrom] = useState(form.startDate?.slice(0, 7) ?? thisMonth);
  const [to, setTo] = useState(form.endDate?.slice(0, 7) ?? shiftMonth(thisMonth, 5));
  const [day, setDay] = useState(15);
  const months = from && to && from <= to ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1 : 0;
  const [amount, setAmount] = useState(() => (form.total > 0 && months > 0 ? Math.round(form.total / months) : 0));
  const preview = months > 0 && months <= 120 ? monthlyInstallments(from, to, day, amount) : [];

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="매달 회차 만들기"
      description="같은 날 같은 돈이 매달 들어오는 사업 — 회차를 한 번에 만듭니다. 이미 있는 회차는 그대로 둡니다."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button onClick={() => onAdd(preview)} disabled={preview.length === 0 || amount <= 0}>
            {preview.length > 0 ? `${preview.length}개 만들기` : "만들기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="첫 달">
          <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="마지막 달">
          <Input type="month" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="받는 날" hint="그 달에 없는 날이면 말일로">
          <NumberInput value={day || ""} onValueChange={(v) => setDay(Math.min(31, Math.max(1, Number(v) || 1)))} className="text-right" />
        </Field>
        <Field label="매달 금액" hint={form.total > 0 && months > 0 ? `총 지원금 ÷ ${months}달 = ${won(form.total / months)}` : undefined}>
          <NumberInput value={amount || ""} placeholder="0" onValueChange={(v) => setAmount(Number(v) || 0)} className="text-right" />
        </Field>
      </div>
      {preview.length > 0 && (
        <InlineNotice tone="neutral" className="mt-3">
          {preview[0].label} {preview[0].dueDate} ~ {preview[preview.length - 1].label} {preview[preview.length - 1].dueDate} · 합계 {won(amount * preview.length)}원
        </InlineNotice>
      )}
    </Dialog>
  );
}
