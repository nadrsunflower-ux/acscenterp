"use client";

// ============================================================
//  자동 처리 — 사람 없이 처리된 거래 · 어디까지 믿을지
// ------------------------------------------------------------
//  자동분류가 확정한 거래는 검토 대기함에 오지 않는다. 그래서 「엔진이 무엇을
//  사람 없이 확정했는지」 를 볼 자리가 없었다 — 틀린 확정이 조용히 쌓여도
//  월 마감 · 세무 때가 돼서야 드러난다. 이 화면이 그 자리다.
//
//    ① 자동으로 처리된 거래   이 달 엔진이 확정한 채 아무도 안 고친 거래를
//                             근거 칸별로 묶는다. 한 건 · 한 묶음씩 대기함으로
//                             돌려보낼 수 있다 (되돌리기도 된다).
//    ② 믿을 범위              근거 칸마다 실측 정확도 (trust.ts). 기준 이상인
//                             칸은 확정까지, 아래인 칸은 제안까지. 켜고 끄는 것과
//                             기준은 사람이 고른다 — 기본은 꺼짐.
//    ③ 계좌·카드별            「제안만」 으로 두면 그 계좌는 엔진이 확정하지 않는다.
//
//  설정은 바꾸는 즉시 저장한다 (저장 단추가 없다 — 사용자 선호).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CreditCard,
  HandCoins,
  Landmark,
  Mail,
  RefreshCw,
  Undo2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  Disclosure,
  EmptyState,
  Icon,
  InlineNotice,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Switch,
  Table,
  TableScroll,
  Td,
  Th,
  type Tone,
  Tr,
  UndoHistory,
  useConfirm,
  useToast,
  useUndoHistory,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  applyFinEdits,
  markFinReceipt,
  measureFinTrust,
  restoreFinTransactions,
  runPayMail,
  saveFinTrust,
  type PayMailRun,
} from "@/lib/neander/finance/client";
import { isEngineOwned, relearnPending } from "@/lib/neander/finance/relearn";
import type { ClassifyContext } from "@/lib/neander/finance/classify";
import {
  cellPrecision,
  cellVerdict,
  isEngineConfirmed,
  isGatedCell,
  liveTrust,
  MIN_SAMPLE_OPTIONS,
  THRESHOLD_OPTIONS,
  trustCellLabel,
  trustCellOf,
  trustEffect,
  trustGateOf,
  trustSettingsOf,
  type CellVerdict,
  type FinTrustSettings,
} from "@/lib/neander/finance/trust";
import { netAmount, txFlow, type FinTransaction } from "@/lib/neander/finance/types";
import { matchReceipts, openInstallments, type MatchConfidence } from "@/lib/neander/finance/receivables";
import { detectRecurring, RECURRING_STATUS_LABEL } from "@/lib/neander/finance/recurring";
import { monthLabel, todayStrKST } from "@/lib/neander/format";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;
const monthOf = (t: FinTransaction) => (t.date ?? "").slice(0, 7);
/** 칸 기록이 없는 옛 적재분 — 근거를 사유 문장으로만 안다 */
const LEGACY = "__legacy__";

const CONF: Record<MatchConfidence, { label: string; tone: Tone }> = {
  high: { label: "확신 높음", tone: "success" },
  medium: { label: "확인 필요", tone: "warning" },
  low: { label: "부분 · 낮음", tone: "neutral" },
};

const VERDICT: Record<CellVerdict, { label: string; tone: Tone }> = {
  promote: { label: "자동 확정으로", tone: "success" },
  keep: { label: "그대로", tone: "neutral" },
  demote: { label: "제안으로 내림", tone: "warning" },
  few: { label: "표본 부족", tone: "neutral" },
  ungated: { label: "관문 밖", tone: "neutral" },
};

/** 실측 정확도 알약 — 기준 이상 초록 · 5%p 안 노랑 · 그 아래 빨강 */
function PrecisionPill({ value, threshold }: { value: number; threshold: number }) {
  const tone =
    value >= threshold
      ? "bg-nd-success-soft text-nd-success-text"
      : value >= threshold - 0.05
        ? "bg-nd-warning-soft text-nd-warning-text"
        : "bg-nd-danger-soft text-nd-danger-text";
  return <span className={cn("nd-num rounded-[6px] px-1.5 py-0.5 font-semibold", tone)}>{pct(value)}</span>;
}

export default function AutoPage() {
  const finance = useFinance();
  const {
    transactions,
    accounts,
    paymentMethods,
    projects,
    vendorIndex,
    vendorRules,
    classRules,
    trust,
    applyTrust,
    applyTransactions,
    loading,
    error,
  } = finance;
  const toast = useToast();
  const confirm = useConfirm();

  const undoLog = useUndoHistory<FinTransaction>({
    keyOf: (t) => t.id,
    restore: async (before) => {
      const res = await restoreFinTransactions(before);
      applyTransactions({ upsert: res.transactions });
    },
  });

  // ---- ① 자동으로 처리된 거래 ----
  const autoRows = useMemo(() => transactions.filter(isEngineConfirmed), [transactions]);
  const months = useMemo(() => [...new Set(autoRows.map(monthOf))].filter(Boolean).sort().reverse(), [autoRows]);
  const [month, setMonth] = useState("");
  const active = month || months[0] || "";
  const monthRows = useMemo(() => transactions.filter((t) => monthOf(t) === active), [transactions, active]);
  const monthAuto = useMemo(() => autoRows.filter((t) => monthOf(t) === active), [autoRows, active]);
  const counts = useMemo(() => {
    const pending = monthRows.filter((t) => t.status !== "confirmed").length;
    return { total: monthRows.length, auto: monthAuto.length, pending, human: monthRows.length - monthAuto.length - pending };
  }, [monthRows, monthAuto]);

  const groups = useMemo(() => {
    const m = new Map<string, FinTransaction[]>();
    monthAuto.forEach((t) => {
      const k = t.engineCell ?? LEGACY;
      m.set(k, [...(m.get(k) ?? []), t]);
    });
    return [...m.entries()]
      .map(([cell, rows]) => ({ cell, rows: rows.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [monthAuto]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * 대기함으로 돌려보낸다 — 상태만 제안으로. 엔진의 지문은 그대로 두므로 엔진은 이 행을
   * 다시 손대지 않고(지문이 어긋난다), 사람이 다시 확정하면 운영 실적에 「그대로 맞음」 으로 남는다.
   */
  const sendBack = async (rows: FinTransaction[]) => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const res = await applyFinEdits({
        updates: rows.map((t) => ({
          id: t.id,
          patch: { status: "suggested", classReason: `${t.classReason ?? ""} — 자동 확정을 되돌려 확인 대기` },
        })),
        inserts: [],
        deletes: [],
        via: "auto",
      });
      undoLog.record(
        `${won(rows.length)}건을 검토 대기함으로 돌려보냈습니다.`,
        rows.length === 1
          ? { subject: `${rows[0].vendor || "(거래처 없음)"} ${won(netAmount(rows[0]))}원`, change: "자동 확정 → 대기함" }
          : `자동 확정 ${won(rows.length)}건 → 대기함`,
        rows,
      );
      applyTransactions({ upsert: res.transactions });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "돌려보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // ---- ② 믿을 범위 ----
  const saved = useMemo(() => trustSettingsOf(trust), [trust]);
  const [saving, setSaving] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const measure = trust?.measure;
  const live = useMemo(() => liveTrust(transactions), [transactions]);
  const effect = useMemo(() => trustEffect(measure, { ...saved, enabled: true }), [measure, saved]);

  /** 대기함에서 이 설정으로 바로 확정될 것 — 계속 배우기를 미리 돌려 본다 */
  const planFor = (set: FinTrustSettings) => {
    const gate = trustGateOf({ ...trust, ...set, id: "trust", measure });
    const ctx = {
      vendorIndex,
      vendorRules,
      paymentMethods,
      accounts,
      ...(classRules ? { classRules } : {}),
      ...(gate ? { trust: gate } : {}),
    } as ClassifyContext;
    return relearnPending(transactions, ctx, { owned: isEngineOwned, cellOf: trustCellOf });
  };
  const queueEffect = useMemo(
    () => (measure ? planFor({ ...saved, enabled: true }).filter((c) => c.status === "confirmed").length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measure, saved, transactions, vendorIndex, vendorRules, classRules, paymentMethods, accounts],
  );

  const save = async (next: FinTrustSettings, opts: { apply?: boolean } = {}) => {
    setSaving(true);
    try {
      const res = await saveFinTrust(next);
      applyTrust(res.trust);
      if (opts.apply) {
        // 켜자마자 대기함에도 반영한다 — 검토 대기함을 열 때까지 기다리지 않게
        const plan = relearnPending(
          transactions,
          {
            vendorIndex,
            vendorRules,
            paymentMethods,
            accounts,
            ...(classRules ? { classRules } : {}),
            ...(trustGateOf(res.trust) ? { trust: trustGateOf(res.trust) } : {}),
          } as ClassifyContext,
          { owned: isEngineOwned, cellOf: trustCellOf },
        );
        if (plan.length > 0) {
          const out = await applyFinEdits({
            updates: plan.map((c) => ({ id: c.id, patch: c.patch as unknown as Partial<FinTransaction> })),
            inserts: [],
            deletes: [],
            via: "trust",
          });
          const confirmed = plan.filter((c) => c.status === "confirmed").length;
          undoLog.record(
            `믿을 범위를 켰습니다 — 대기함에서 ${won(confirmed)}건 확정 · ${won(plan.length - confirmed)}건 제안 갱신`,
            `믿을 범위 켜기 (${won(plan.length)}건)`,
            plan.map((c) => c.before),
          );
          applyTransactions({ upsert: out.transactions });
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (on: boolean) => {
    if (on) {
      const n = measure ? planFor({ ...saved, enabled: true }).filter((c) => c.status === "confirmed").length : 0;
      const ok = await confirm({
        title: "믿을 범위를 켤까요?",
        message:
          `실측 정확도가 ${pct(saved.threshold)} 이상인 근거는 사람 없이 확정하고, 그 아래인 근거의 확정은 제안으로 내립니다.` +
          (n > 0 ? ` 지금 대기함에서 ${won(n)}건이 바로 확정됩니다.` : "") +
          " 확정된 거래는 이 화면의 「자동으로 처리된 거래」 에서 언제든 대기함으로 돌려보낼 수 있습니다.",
        confirmLabel: "켜기",
      });
      if (!ok) return;
    }
    await save({ ...saved, enabled: on }, { apply: on });
  };

  const remeasure = async () => {
    setMeasuring(true);
    try {
      const res = await measureFinTrust();
      if (trust) applyTrust({ ...trust, measure: res.measure });
      else applyTrust({ id: "trust", ...saved, measure: res.measure });
      toast.success(`다시 쟀습니다 — ${won(res.measure.total)}건을 다시 맞혀 봤습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "재지 못했습니다.");
    } finally {
      setMeasuring(false);
    }
  };

  const cells = useMemo(
    () =>
      Object.entries(measure?.cells ?? {})
        .filter(([cell]) => isGatedCell(cell))
        .sort((a, b) => b[1].n - a[1].n),
    [measure],
  );
  const bigCells = cells.filter(([, s]) => s.judged >= 10);
  const smallCells = cells.filter(([, s]) => s.judged < 10);

  // ---- 받을 돈 — 장부에 들어온 입금을 회차에 짝짓는다 (receivables.ts) ----
  const today = todayStrKST();
  const openDue = useMemo(() => openInstallments(projects, transactions), [projects, transactions]);
  const receipts = useMemo(() => matchReceipts({ projects, transactions, paymentMethods, today }), [projects, transactions, paymentMethods, today]);
  const [receiving, setReceiving] = useState<string | null>(null);
  const markReceived = async (m: (typeof receipts)[number]) => {
    setReceiving(m.tx.id);
    try {
      const res = await markFinReceipt(m.targets[0].projectId, m.targets.map((o) => o.installmentId), m.tx.id);
      applyTransactions({ upsert: res.transactions });
      // 회차의 입금일은 프로젝트 문서에 찍힌다 — 다시 받아 받을 돈에서 뺀다
      await finance.refresh();
      toast.success(
        res.covered.length > 0
          ? `${m.targets.map((o) => `${o.projectName} ${o.kind}`).join(" + ")} — 받음으로 표시했습니다.`
          : "부분 입금으로 붙였습니다 — 남은 돈만 받을 돈으로 남습니다.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "받음 처리를 하지 못했습니다.");
    } finally {
      setReceiving(null);
    }
  };

  // ---- 빠진 정기 지출 (recurring.ts) ----
  const recurring = useMemo(() => detectRecurring(transactions, paymentMethods, today), [transactions, paymentMethods, today]);
  const missing = recurring.filter((s) => s.status === "missing");
  const liveSeries = recurring.filter((s) => s.status !== "ended");

  // ---- ④ 결제 알림 메일 → 카드 메모 ----
  const [mailRun, setMailRun] = useState<PayMailRun | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const fromMail = useMemo(() => transactions.filter((t) => (t.cardChatId ?? "").startsWith("mail:")).length, [transactions]);
  const runMail = async () => {
    setMailBusy(true);
    try {
      const res = await runPayMail(false);
      setMailRun(res);
      if (res.attached > 0) await finance.refresh();
      toast.success(res.attached > 0 ? `결제 알림 ${res.attached}건을 카드 거래에 메모로 붙였습니다.` : `결제 알림 ${res.reads}통을 읽었습니다 — 새로 붙일 것은 없습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "메일을 읽지 못했습니다.");
    } finally {
      setMailBusy(false);
    }
  };

  // ---- ③ 계좌·카드별 ----
  const suggestOnly = new Set(saved.suggestOnly);
  const monthAutoBy = useMemo(() => {
    const m = new Map<string, number>();
    monthAuto.forEach((t) => t.last4 && m.set(t.last4, (m.get(t.last4) ?? 0) + 1));
    return m;
  }, [monthAuto]);
  const methods = useMemo(
    () =>
      [...paymentMethods]
        .filter((p) => p.kind === "account" || p.kind === "card")
        .sort((a, b) => (a.kind === b.kind ? (monthAutoBy.get(b.last4) ?? 0) - (monthAutoBy.get(a.last4) ?? 0) || a.alias.localeCompare(b.alias, "ko") : a.kind === "account" ? -1 : 1)),
    [paymentMethods, monthAutoBy],
  );
  const setScope = (last4: string, only: boolean) => {
    const next = new Set(saved.suggestOnly);
    if (only) next.add(last4);
    else next.delete(last4);
    void save({ ...saved, suggestOnly: [...next] });
  };

  if (loading) return <LoadingState label="장부를 불러오는 중…" />;
  if (error) return null;

  const rate = counts.total ? counts.auto / counts.total : 0;

  return (
    <PageShell>
      {months.length > 0 && (
        <ToolbarPortal order={0}>
          <MonthStepper glass months={months} value={active} onChange={setMonth} />
        </ToolbarPortal>
      )}

      <PageHeader
        title="자동 처리"
        description="자동분류가 사람 없이 확정한 거래와, 근거마다 어디까지 믿을지를 봅니다."
        className="mb-4"
        meta={
          saved.enabled ? (
            <Badge tone="success" dot>믿을 범위 켜짐 · 기준 {pct(saved.threshold)}</Badge>
          ) : (
            <Badge tone="neutral" dot>믿을 범위 꺼짐 — 엔진 문턱 그대로</Badge>
          )
        }
        actions={
          <Link href="/neander/finance/review">
            <Button variant="secondary" icon={ArrowRight}>검토 대기함</Button>
          </Link>
        }
      />

      <UndoHistory className="mb-4" entries={undoLog.entries} undoingId={undoLog.undoingId} onUndo={(e) => void undoLog.undo(e)} />

      {active && (
        <KpiStrip columns={4} className="mb-4">
          <KpiItem label={`${monthLabel(active)} 거래`} value={won(counts.total)} unit="건" tone="neutral" />
          <KpiItem label="자동 확정 (사람 없이)" value={won(counts.auto)} unit="건" tone="accent" hint={`이 달 거래의 ${pct(rate)}`} />
          <KpiItem label="사람이 확정 · 원본 장부" value={won(counts.human)} unit="건" tone="neutral" />
          <KpiItem label="아직 대기 중" value={won(counts.pending)} unit="건" tone={counts.pending > 0 ? "warning" : "neutral"} />
        </KpiStrip>
      )}

      {/* ---- ① 자동으로 처리된 거래 ---- */}
      <Card padding="none" className="mb-4 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="자동으로 처리된 거래"
            hint={active ? `${monthLabel(active)} · ${won(monthAuto.length)}건 · 엔진이 확정한 채 아무도 안 고친 것` : undefined}
          />
        </div>
        {groups.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState compact icon={Bot} title="자동으로 확정된 거래가 없습니다" description="이 달은 모든 거래를 사람이 확인했습니다." className="border-0" />
          </div>
        ) : (
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            {groups.map(({ cell, rows }) => {
              const label = cell === LEGACY ? { title: "근거 기록 전 적재분", detail: "사유 문장으로만 근거를 압니다" } : trustCellLabel(cell);
              const s = measure?.cells[cell];
              const expanded = open === cell;
              const amount = rows.reduce((n, t) => n + netAmount(t), 0);
              return (
                <li key={cell}>
                  <div className="flex items-start gap-3 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : cell)}
                      aria-expanded={expanded}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <Icon icon={expanded ? ChevronDown : ChevronRight} size={16} className="mt-1 shrink-0 text-nd-fg-3" />
                      <div className="min-w-0 flex-1">
                        <p className="text-nd-body font-semibold text-nd-fg">{label.title}</p>
                        <p className="mt-0.5 text-nd-body text-nd-fg-2">
                          {label.detail}
                          {s && s.judged > 0 && (
                            <>
                              {label.detail ? " · " : ""}실측 <PrecisionPill value={cellPrecision(s)} threshold={saved.threshold} /> ({won(s.judged)}건)
                            </>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="nd-num text-nd-body font-semibold text-nd-fg">{won(rows.length)}건</p>
                        <p className="nd-num text-nd-table text-nd-fg-3">{won(amount)}원</p>
                      </div>
                    </button>
                    <Button variant="ghost" size="sm" icon={Undo2} disabled={busy} onClick={() => void sendBack(rows)}>
                      묶음 돌려보내기
                    </Button>
                  </div>
                  {expanded && (
                    <div className="border-t border-nd-line bg-nd-sunken/40 px-5 py-3">
                      <TableScroll>
                        <Table minWidth={760} dense>
                          <thead>
                            <tr>
                              <Th className="pl-0">날짜</Th>
                              <Th>거래처</Th>
                              <Th>계정</Th>
                              <Th>사업구분</Th>
                              <Th align="right">금액</Th>
                              <Th align="right" className="pr-0"><span className="sr-only">돌려보내기</span></Th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((t) => (
                              <Tr key={t.id}>
                                <Td className="pl-0 nd-num text-nd-fg-2">{t.date.slice(5)}</Td>
                                <Td className="max-w-[16rem] truncate text-nd-fg" title={t.classReason}>{t.vendor || "(거래처 없음)"}</Td>
                                <Td className="text-nd-fg-2">{[t.acctMid, t.acctMinor].filter(Boolean).join(" > ")}</Td>
                                <Td className="text-nd-fg-2">{t.bizMinor ?? "—"}</Td>
                                <Td num><Money value={netAmount(t)} flow={txFlow(t.txType)} unit={false} /></Td>
                                <Td align="right" className="pr-0">
                                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void sendBack([t])}>
                                    돌려보내기
                                  </Button>
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </TableScroll>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---- ② 믿을 범위 ---- */}
      <Card className="mb-4">
        <SectionHeader
          title="믿을 범위"
          hint="근거마다 실측 정확도로 자동 확정을 넓히고 좁힙니다"
          action={
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={measuring} onClick={() => void remeasure()}>
              {measure ? "다시 재기" : "지금 재기"}
            </Button>
          }
        />
        {measure ? (
          <p className="mb-4 text-nd-body text-nd-fg-2">
            {monthLabel(measure.months[0])} ~ {monthLabel(measure.months[measure.months.length - 1])} 확정 장부{" "}
            <b className="nd-num font-semibold text-nd-fg">{won(measure.total)}건</b>을 「그 달 이전 장부만 보고」 다시 맞혀 봤습니다
            · {new Date(measure.at).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}. 정답은 계정 · 거래유형 ·
            (손익 거래면) 사업구분까지 맞아야 합니다. 엔진이 확정한 채 아무도 안 본 거래는 정답으로 쓰지 않습니다.
          </p>
        ) : (
          <InlineNotice tone="info" className="mb-4">
            아직 재지 않았습니다. 「지금 재기」 를 누르면 확정된 장부로 근거마다 정확도를 잽니다 (몇 초).
          </InlineNotice>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-nd-md border border-nd-line p-4">
            <Switch
              checked={saved.enabled}
              disabled={saving || !measure}
              onChange={(on) => void toggle(on)}
              label={<span className="text-nd-body font-semibold text-nd-fg">실측이 기준 이상인 근거는 사람 없이 확정</span>}
            />
            <p className="mt-2 text-nd-body text-nd-fg-2">
              꺼 두면 엔진이 지금까지의 문턱 그대로 돕니다. 켜면 아래 표의 「자동 확정으로」 칸은 확정, 「제안으로 내림」 칸은 제안이 됩니다.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-nd-table font-medium text-nd-fg-2">기준 정확도</p>
                <SegmentedControl
                  ariaLabel="기준 정확도"
                  size="sm"
                  value={String(saved.threshold)}
                  onChange={(v) => void save({ ...saved, threshold: Number(v) })}
                  options={THRESHOLD_OPTIONS.map((t) => ({ value: String(t), label: pct(t) }))}
                />
              </div>
              <div>
                <p className="mb-1.5 text-nd-table font-medium text-nd-fg-2">최소 표본</p>
                <SegmentedControl
                  ariaLabel="최소 표본"
                  size="sm"
                  value={String(saved.minSamples)}
                  onChange={(v) => void save({ ...saved, minSamples: Number(v) })}
                  options={MIN_SAMPLE_OPTIONS.map((n) => ({ value: String(n), label: `${n}건` }))}
                />
              </div>
            </div>
          </div>
          <div className="rounded-nd-md border border-nd-line p-4">
            <p className="text-nd-body font-semibold text-nd-fg">이 기준이면</p>
            {measure ? (
              <ul className="mt-2 space-y-1.5 text-nd-body text-nd-fg-2">
                <li>
                  잰 기간에 제안 → 확정 <b className="nd-num font-semibold text-nd-fg">{won(effect.promote)}건</b>
                  {effect.promote > 0 && <> (그중 틀릴 것으로 보이는 것 약 {won(effect.promoteWrong)}건)</>}
                </li>
                <li>
                  확정 → 제안 <b className="nd-num font-semibold text-nd-fg">{won(effect.demote)}건</b>
                  {effect.demote > 0 && <> (그중 실제로 틀렸던 것 약 {won(effect.demoteWrong)}건 — 이만큼 틀린 확정이 줄어든다)</>}
                </li>
                <li>
                  지금 대기함에서 바로 확정될 것 <b className="nd-num font-semibold text-nd-fg">{won(queueEffect)}건</b>
                </li>
              </ul>
            ) : (
              <p className="mt-2 text-nd-body text-nd-fg-3">재고 나면 보입니다.</p>
            )}
          </div>
        </div>

        {measure && bigCells.length > 0 && (
          <div className="mt-5">
            <TableScroll>
              <Table minWidth={900} dense>
                <thead>
                  <tr>
                    <Th className="pl-0">근거</Th>
                    <Th align="right">잰 건수</Th>
                    <Th align="right">엔진이 한 것</Th>
                    <Th align="right">실측 정확도</Th>
                    <Th align="right">운영 실적</Th>
                    <Th align="right" className="pr-0">이 기준이면</Th>
                  </tr>
                </thead>
                <tbody>
                  {bigCells.map(([cell, s]) => {
                    const { title, detail } = trustCellLabel(cell);
                    const v = cellVerdict(cell, s, saved);
                    const l = live.get(cell);
                    return (
                      <Tr key={cell}>
                        <Td className="pl-0">
                          <p className="text-nd-table font-medium text-nd-fg">{title}</p>
                          {detail && <p className="text-nd-table text-nd-fg-3">{detail}</p>}
                        </Td>
                        <Td num>{won(s.judged)}건</Td>
                        <Td num muted>
                          {s.confirmed > 0 && `확정 ${won(s.confirmed)}`}
                          {s.confirmed > 0 && s.suggested > 0 && " · "}
                          {s.suggested > 0 && `제안 ${won(s.suggested)}`}
                        </Td>
                        <Td num><PrecisionPill value={cellPrecision(s)} threshold={saved.threshold} /></Td>
                        <Td num muted>
                          {l
                            ? [
                                l.auto > 0 ? `자동 ${won(l.auto)} 중 바뀜 ${won(l.autoChanged)}` : "",
                                l.offered > 0 ? `제안 ${won(l.offered)} 중 그대로 ${won(l.accepted)}` : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "—"}
                        </Td>
                        <Td align="right" className="pr-0">
                          <Badge tone={VERDICT[v].tone}>{VERDICT[v].label}</Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
            <p className="mt-2 text-nd-table text-nd-fg-3">
              운영 실적은 근거 기록을 남기기 시작한 뒤 적재한 거래만 셉니다 — 「자동 n 중 바뀜 m」 은 엔진이 확정한 뒤 사람이 계정·사업구분을 바꾼 것입니다.
            </p>
            {smallCells.length > 0 && (
              <Disclosure
                className="mt-3"
                title={`작은 근거 ${smallCells.length}가지`}
                description="10건이 안 돼 아직 판단하지 않는 근거입니다"
              >
                <ul className="grid gap-1 text-nd-table text-nd-fg-2 sm:grid-cols-2">
                  {smallCells.map(([cell, s]) => {
                    const { title, detail } = trustCellLabel(cell);
                    return (
                      <li key={cell} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{title}{detail ? ` · ${detail}` : ""}</span>
                        <span className="nd-num shrink-0">{won(s.right)}/{won(s.judged)}</span>
                      </li>
                    );
                  })}
                </ul>
              </Disclosure>
            )}
          </div>
        )}
      </Card>

      {/* ---- 받을 돈 ---- */}
      <Card id="receipts" padding="none" className="mb-4 scroll-mt-20 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="장부에 들어온 받을 돈"
            hint={`받을 회차 ${openDue.length}건 · ${won(openDue.reduce((n, o) => n + o.remaining, 0))}원 남음 — 통장 입금을 회차에 짝짓습니다. 받을 날 · 월별 흐름은 런웨이에서`}
          />
        </div>
        {receipts.length === 0 ? (
          <p className="px-5 pb-5 text-nd-body text-nd-fg-3">
            짝지을 입금이 없습니다 — 받을 돈과 같은 금액(부가세 포함 · 수수료 3천 원까지)의 입금이 아직 장부에 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            {receipts.map((m) => (
              <li key={m.tx.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                <Icon icon={HandCoins} size={18} className="mt-0.5 shrink-0 text-nd-income-text" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-nd-body">
                    <span className="nd-num text-nd-fg-2">{m.tx.date}</span>
                    <b className="font-semibold text-nd-fg">{m.tx.vendor || "(입금자 없음)"}</b>
                    <Money value={m.tx.amount} flow="income" />
                    <span className="text-nd-fg-3">→</span>
                    <b className="font-semibold text-nd-fg">{m.targets.map((o) => `${o.projectName} ${o.kind}`).join(" + ")}</b>
                    <Badge tone={CONF[m.confidence].tone}>{CONF[m.confidence].label}</Badge>
                    {m.ambiguous && <Badge tone="warning">후보 여럿</Badge>}
                  </p>
                  <p className="mt-0.5 text-nd-table text-nd-fg-2">{m.reasons.join(" · ")}</p>
                </div>
                <Button
                  size="sm"
                  variant={m.confidence === "high" ? "primary" : "secondary"}
                  loading={receiving === m.tx.id}
                  disabled={!!receiving}
                  onClick={() => void markReceived(m)}
                >
                  {m.amount === "partial" ? "부분 입금으로 붙이기" : "받음 처리"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- 빠진 정기 지출 ---- */}
      <Card id="recurring" padding="none" className="mb-4 scroll-mt-20 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="빠진 정기 지출"
            hint="매달 같은 날 · 비슷한 금액으로 나가던 돈이, 그 계좌 내역이 예정일 뒤까지 올라왔는데도 없는 것"
          />
        </div>
        {missing.length === 0 ? (
          <p className="px-5 pb-4 text-nd-body text-nd-fg-3">빠진 것이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            {missing.map((s) => (
              <li key={s.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-nd-body">
                <Icon icon={CalendarClock} size={16} className="shrink-0 translate-y-0.5 text-nd-warning-text" />
                <b className="font-semibold text-nd-fg">{s.vendor}</b>
                <span className="text-nd-fg-2">{s.alias ?? s.last4} · {s.acctMinor ?? "계정 없음"}</span>
                <Money value={-s.amount} flow="expense" />
                <span className="text-nd-fg-2">매달 {s.day}일 · 예정 {s.nextDate} · 마지막 {s.lastDate}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-nd-line px-5 py-3">
          <Disclosure title={`정기 지출 전체 ${liveSeries.length}줄`} description="최근 8개월에 3달 이상 같은 날 · 비슷한 금액으로 나간 돈 (해마다 나가는 것 포함)">
            <ul className="grid gap-1 text-nd-table text-nd-fg-2 sm:grid-cols-2">
              {liveSeries.map((s) => (
                <li key={s.key} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {s.vendor} · {s.alias ?? s.last4} · {s.cadence === "monthly" ? `매달 ${s.day}일` : "해마다"}
                  </span>
                  <span className="nd-num shrink-0">
                    {won(s.amount)}원 · {RECURRING_STATUS_LABEL[s.status]}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      </Card>

      {/* ---- ④ 결제 알림 메일 ---- */}
      <Card className="mb-4">
        <SectionHeader
          title="결제 알림 메일 → 카드 거래 메모"
          hint="회사 메일함(카페24 · 팀 공용)의 KCP · 토스페이먼츠 · 이지페이 · 헥토 · 쿠팡 · 해외 영수증"
          action={
            <Button variant="secondary" size="sm" icon={Mail} loading={mailBusy} onClick={() => void runMail()}>
              지금 찾기
            </Button>
          }
        />
        <p className="text-nd-body text-nd-fg-2">
          카드 명세서의 거래처가 결제대행사일 때 「무엇을 샀나」 를 메일에서 가져와 메모로 붙입니다 — 같은 금액 · 승인일 ±1일 · 카드사가 맞는
          거래가 하나뿐일 때만, 단톡방 메모가 없는 거래에만. 매일 밤 점검이 저절로 하고, 붙은 메모는 자동분류가 근거로 씁니다(제안까지).
          지금까지 메일에서 붙은 메모 <b className="nd-num font-semibold text-nd-fg">{won(fromMail)}건</b>.
        </p>
        {mailRun && mailRun.matches.length > 0 && (
          <ul className="mt-3 grid gap-1 text-nd-table text-nd-fg-2 sm:grid-cols-2">
            {mailRun.matches.slice(0, 20).map((m) => (
              <li key={m.txId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="nd-num text-nd-fg-3">{m.date.slice(5)}</span> {m.memo}
                </span>
                <span className="nd-num shrink-0">{m.currency === "USD" ? `$${m.amount}` : `${won(m.amount)}원`}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- ③ 계좌·카드별 ---- */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="계좌·카드별 범위"
            hint="「제안만」 으로 두면 그 계좌·카드는 엔진이 확정하지 않고 사람이 다 봅니다"
          />
        </div>
        <TableScroll>
          <Table minWidth={620} dense>
            <thead>
              <tr>
                <Th className="pl-5">계좌·카드</Th>
                <Th align="right">{active ? `${monthLabel(active)} 자동 확정` : "자동 확정"}</Th>
                <Th align="right" className="pr-5">범위</Th>
              </tr>
            </thead>
            <tbody>
              {methods.map((p) => (
                <Tr key={p.id}>
                  <Td className="pl-5">
                    <span className="inline-flex items-center gap-2 text-nd-table text-nd-fg">
                      <Icon icon={p.kind === "card" ? CreditCard : Landmark} size={15} className="text-nd-fg-3" />
                      <span className="nd-num">{p.last4}</span>
                      <span className="text-nd-fg-2">{p.alias}</span>
                    </span>
                  </Td>
                  <Td num muted>{monthAutoBy.get(p.last4) ? `${won(monthAutoBy.get(p.last4) ?? 0)}건` : "—"}</Td>
                  <Td align="right" className="pr-5">
                    <SegmentedControl
                      size="sm"
                      ariaLabel={`${p.alias} 범위`}
                      value={suggestOnly.has(p.last4) ? "suggest" : "confirm"}
                      onChange={(v) => setScope(p.last4, v === "suggest")}
                      options={[
                        { value: "confirm", label: "확정까지" },
                        { value: "suggest", label: "제안만" },
                      ]}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Card>
    </PageShell>
  );
}
