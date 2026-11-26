"use client";

// ============================================================
//  급여 지급 — 지급일에 보낼 사람 · 금액 · 계좌를 미리 적어 두는 표
// ------------------------------------------------------------
//  한 달 = 표 하나 (lib/neander/finance/payroll.ts 머리말). 지급일에 이 표를 보며
//  회사 통장마다 보내고, 장부에 출금이 들어오면 줄마다 「보냄」 으로 바뀐다.
//
//  · 저장 버튼이 없다 — 손을 멈추면 0.8초 뒤 그 달 표를 통째로 보낸다. 서버가
//    빈 줄을 버려도 화면의 초안은 바꿔 끼우지 않는다(방금 추가한 빈 줄이 사라지지 않게).
//  · 탭은 보내는 회사 — 지급일엔 통장 하나씩 열어 보내므로 그 회사 줄만 본다.
//  · 세무사 급여대장과 견주기는 맨 아래 접힌 칸. 대장은 귀속월 말일을 지급일로
//    적지만 실제 이체는 다음 달 1일이라, 지급일 5일 전이 든 달의 대장과 견준다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Copy, Plus, RotateCw, Trash2, WalletCards } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  MonthStepper,
  NumberInput,
  PageHeader,
  PageShell,
  Select,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { PROJECT_ENTITIES, type ProjectEntity } from "@/lib/neander/finance/project";
import {
  PAY_KINDS,
  copyPlan,
  daysUntil,
  defaultPayDate,
  emptyLine,
  isDone,
  matchPayroll,
  payrollTotals,
  planFromLedger,
  previousAmount,
  sanitizePayroll,
  shiftMonth,
  upcomingPayMonth,
  type LineStatus,
  type PayKind,
  type PayLine,
  type PayrollInput,
} from "@/lib/neander/finance/payroll";
import { deletePayroll, fetchPayrolls, savePayroll } from "@/lib/neander/finance/payroll-client";
import { useTaxDocs } from "@/lib/neander/finance/tax-docs-client";
import { buildTaxMonths } from "@/lib/neander/finance/tax-docs-check";
import { personKey } from "@/lib/neander/finance/tax-docs";
import { monthLabel, todayStrKST } from "@/lib/neander/format";

const AUTOSAVE_MS = 800;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const signed = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `-${won(-n)}` : "0");
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEK[d.getDay()]})`;
};
const mmdd = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const manwon = (n: number) => `${(Math.round(n / 1000) / 10).toLocaleString("ko-KR")}만`;
const json = (p: PayrollInput | undefined) => (p ? JSON.stringify(p) : "");

type SaveView = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error"; message: string };

export default function PayrollPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { transactions, loading: finLoading } = useFinance();
  const today = todayStrKST();

  // ---- 불러오기 ----
  const [plans, setPlans] = useState<Record<string, PayrollInput> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const savedRef = useRef<Record<string, string>>({});
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await fetchPayrolls();
      const map: Record<string, PayrollInput> = {};
      for (const d of list) {
        const { updatedAt: _a, updatedBy: _b, ...input } = d;
        map[d.id] = input;
        savedRef.current[d.id] = json(input);
      }
      setPlans(map);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "급여 지급 표를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // ---- 달 ----
  const [month, setMonth] = useState(() => upcomingPayMonth(todayStrKST()));
  const months = useMemo(() => {
    const upcoming = upcomingPayMonth(today);
    const set = new Set<string>([shiftMonth(upcoming, 1), upcoming, shiftMonth(upcoming, -1), ...Object.keys(plans ?? {})]);
    return [...set].sort().reverse();
  }, [plans, today]);
  const plan = plans?.[month];
  const prev = useMemo(() => {
    const before = Object.keys(plans ?? {})
      .filter((m) => m < month && (plans?.[m]?.lines.length ?? 0) > 0)
      .sort()
      .pop();
    return before ? plans?.[before] : undefined;
  }, [plans, month]);

  // ---- 자동 저장 ----
  //  달이 바뀌어도 앞 달의 남은 변경까지 같이 보낸다 — 고친 달을 모두 훑는다.
  const [saveView, setSaveView] = useState<SaveView>({ kind: "idle" });
  const failsRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const dirtyMonths = useCallback(
    (map: Record<string, PayrollInput> | null) => Object.keys(map ?? {}).filter((m) => json(map![m]) !== savedRef.current[m]),
    [],
  );
  const saveDirty = useCallback(
    async (map: Record<string, PayrollInput>) => {
      const dirty = dirtyMonths(map);
      if (!dirty.length) return;
      for (const m of dirty) {
        const checked = sanitizePayroll(map[m]);
        if (!checked.ok) {
          setSaveView({ kind: "error", message: checked.error });
          return;
        }
      }
      setSaveView({ kind: "saving" });
      try {
        for (const m of dirty) {
          const snap = map[m];
          await savePayroll(snap);
          savedRef.current[m] = json(snap);
        }
        failsRef.current = 0;
        setSaveView({ kind: "saved", at: Date.now() });
      } catch (e) {
        failsRef.current += 1;
        const message = e instanceof Error ? e.message : "저장하지 못했습니다.";
        // 첫 실패는 3초 뒤 조용히 다시 — 두 번째부터 알린다
        if (failsRef.current === 1) {
          setSaveView({ kind: "saving" });
          window.setTimeout(() => setRetryTick((n) => n + 1), 3000);
        } else setSaveView({ kind: "error", message });
      }
    },
    [dirtyMonths],
  );
  useEffect(() => {
    if (!plans || !dirtyMonths(plans).length) return;
    const t = window.setTimeout(() => void saveDirty(plans), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [plans, retryTick, dirtyMonths, saveDirty]);

  // 떠날 때 남은 변경을 보낸다 · 창을 닫으려 하면 막는다
  const plansRef = useRef(plans);
  plansRef.current = plans;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyMonths(plansRef.current).length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      const left = plansRef.current;
      if (left && dirtyMonths(left).length) void saveDirty(left);
    };
  }, [dirtyMonths, saveDirty]);

  const update = useCallback(
    (fn: (p: PayrollInput) => PayrollInput) => setPlans((all) => (all && all[month] ? { ...all, [month]: fn(all[month]) } : all)),
    [month],
  );
  const updateLine = useCallback(
    (id: string, patch: Partial<PayLine>) =>
      update((p) => ({
        ...p,
        lines: p.lines.map((l) => {
          if (l.id !== id) return l;
          const next: PayLine = { ...l, ...patch };
          // 빈 값은 칸을 지운다 — 저장본에 「""」 가 남지 않게
          (Object.keys(patch) as (keyof PayLine)[]).forEach((k) => {
            if (patch[k] === undefined || patch[k] === "") delete next[k];
          });
          if (next.name === undefined) next.name = "";
          return next;
        }),
      })),
    [update],
  );
  const start = (p: PayrollInput) => setPlans((all) => ({ ...(all ?? {}), [month]: p }));

  // ---- 장부와 맞추기 ----
  const status = useMemo(
    () => (plan && !finLoading ? matchPayroll(plan, transactions, today) : new Map<string, LineStatus>()),
    [plan, transactions, finLoading, today],
  );
  const totals = useMemo(() => payrollTotals(plan?.lines ?? [], status), [plan, status]);
  const ledgerStart = useMemo(
    () => (plan || finLoading ? null : planFromLedger(transactions, month, defaultPayDate(month))),
    [plan, finLoading, transactions, month],
  );

  // ---- 회사 탭 ----
  const [tab, setTab] = useState<string>("all");
  const tabItems = useMemo(
    () => [
      { key: "all", label: `전체 · ${manwon(totals.amount)}`, badge: totals.count },
      ...totals.byEntity.map((e) => ({ key: e.entity, label: `${e.entity} · ${manwon(e.amount)}`, badge: e.count })),
    ],
    [totals],
  );
  useEffect(() => {
    if (tab !== "all" && !tabItems.some((t) => t.key === tab)) setTab("all");
  }, [tab, tabItems]);
  const shown = (plan?.lines ?? []).filter((l) => tab === "all" || (l.entity ?? "미정") === tab);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} 복사했습니다`);
    } catch {
      toast.error("복사하지 못했습니다 — 브라우저가 클립보드를 막았습니다.");
    }
  };

  const removeMonth = async () => {
    const ok = await confirm({
      title: `${monthLabel(month)} 지급 표를 지울까요?`,
      message: "이 달 표만 사라집니다. 장부 거래는 그대로 남습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deletePayroll(month);
      delete savedRef.current[month];
      setPlans((all) => {
        if (!all) return all;
        const { [month]: _gone, ...rest } = all;
        return rest;
      });
      toast.success("지웠습니다");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  };

  // ---- 그리기 ----
  const left = totals.amount - totals.sentAmount;
  const leftCount = totals.count - totals.sentCount;
  const dDay = plan ? daysUntil(today, plan.payDate) : null;
  const prevTotal = prev ? prev.lines.reduce((s, l) => s + l.amount, 0) : null;

  const saveBadge =
    saveView.kind === "error" ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Badge tone="danger">
          <Icon icon={CircleAlert} size={14} />
          저장하지 못했습니다
        </Badge>
        <span className="text-nd-table text-nd-fg-2">{saveView.message}</span>
        <Button size="sm" variant="secondary" icon={RotateCw} onClick={() => plans && void saveDirty(plans)}>
          다시 시도
        </Button>
      </span>
    ) : saveView.kind === "saving" || (plans && dirtyMonths(plans).length) ? (
      <span className="text-nd-table text-nd-fg-3">저장 중…</span>
    ) : (
      <span className="inline-flex items-center gap-1 text-nd-table text-nd-fg-3">
        <Icon icon={Check} size={14} />
        {saveView.kind === "saved" ? `저장됨 · ${new Date(saveView.at).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}` : "자동 저장"}
      </span>
    );

  return (
    <PageShell>
      <PageHeader
        title="급여 지급"
        description="지급일에 보낼 사람 · 금액 · 계좌를 미리 적어 두고, 그날 이 표를 보며 보냅니다. 장부에 이름이 든 출금이 들어오면 줄마다 「보냄」 으로 바뀝니다."
        meta={saveBadge}
        actions={<MonthStepper months={months} value={month} onChange={setMonth} labelFor={(m) => (plans?.[m] ? "표 있음" : undefined)} />}
      />

      {loadError ? <ErrorState title="급여 지급 표를 불러오지 못했습니다" description={loadError} action={<Button onClick={() => void load()}>다시 시도</Button>} /> : null}
      {!plans && !loadError ? <LoadingState label="급여 지급 표를 불러오는 중…" /> : null}

      {plans && !plan ? (
        <Card>
          <EmptyState
            icon={WalletCards}
            title={`${monthLabel(month)} 지급 표가 아직 없습니다`}
            description={
              prev
                ? `${monthLabel(prev.id)} 표를 그대로 가져와 바뀐 사람 · 금액만 고치면 됩니다.`
                : ledgerStart
                  ? `장부의 ${dayLabel(ledgerStart.from)} 무렵 급여 출금 ${ledgerStart.plan.lines.length}건으로 시작할 수 있습니다. 계좌는 장부에 없어 채워 넣어야 합니다.`
                  : finLoading
                    ? "장부를 불러오는 중입니다…"
                    : "빈 표로 시작해 사람을 더해 주세요."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {prev ? <Button onClick={() => start(copyPlan(prev, month))}>{monthLabel(prev.id)} 표 그대로 가져오기</Button> : null}
                {!prev && ledgerStart ? <Button onClick={() => start(ledgerStart.plan)}>장부의 {mmdd(ledgerStart.from)} 지급으로 시작</Button> : null}
                <Button variant="secondary" onClick={() => start({ id: month, payDate: defaultPayDate(month), lines: [emptyLine("네안데르")] })}>
                  빈 표로 시작
                </Button>
              </div>
            }
          />
        </Card>
      ) : null}

      {plan ? (
        <div className="flex min-w-0 flex-col gap-4">
          {dDay !== null && leftCount > 0 && !finLoading ? (
            dDay < 0 ? (
              <InlineNotice tone="danger" className="text-nd-body">
                지급일({dayLabel(plan.payDate)})이 지났는데 장부에 출금이 안 보이는 사람이 {leftCount}명 · {won(left)}원입니다. 보냈으면 「보냄」 을 눌러 두세요 — 장부는 은행 문자 · 엑셀이 들어와야 바뀝니다.
              </InlineNotice>
            ) : dDay <= 3 ? (
              <InlineNotice tone="warning" className="text-nd-body">
                {dDay === 0 ? "오늘이 지급일입니다" : `지급일 D-${dDay} · ${dayLabel(plan.payDate)}`} — 보낼 사람 {leftCount}명 · {won(left)}원
              </InlineNotice>
            ) : null
          ) : null}

          <KpiStrip columns={4}>
            <KpiItem label="보낼 돈" value={won(totals.amount)} unit="원" hint={`${totals.count}줄 · ${dayLabel(plan.payDate)}`} />
            <KpiItem label="보냄" value={won(totals.sentAmount)} unit="원" hint={finLoading ? "장부 확인 중…" : `${totals.sentCount}줄`} tone={totals.count && totals.sentCount === totals.count ? "success" : undefined} />
            <KpiItem label="남은 돈" value={won(left)} unit="원" hint={`${leftCount}줄`} tone={left > 0 && dDay !== null && dDay < 0 ? "danger" : undefined} />
            <KpiItem
              label="지난번과"
              value={prevTotal === null ? "—" : signed(totals.amount - prevTotal)}
              unit={prevTotal === null ? undefined : "원"}
              hint={prev ? `${monthLabel(prev.id)} ${won(prevTotal ?? 0)}원` : "지난 표 없음"}
            />
          </KpiStrip>

          <Card padding="none">
            <div className="flex flex-col gap-3 border-b border-nd-line p-4">
              <FormRow className="sm:grid-cols-[12rem_minmax(0,1fr)]">
                <Field label="지급일">
                  <Input type="date" value={plan.payDate} onChange={(e) => e.target.value && update((p) => ({ ...p, payDate: e.target.value }))} />
                </Field>
                <Field label="이 달 메모" hint="상여 · 정산 · 퇴사자처럼 이번 달만의 사정">
                  <Input value={plan.note ?? ""} onChange={(e) => update((p) => ({ ...p, note: e.target.value || undefined }))} />
                </Field>
              </FormRow>
              <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel="보내는 회사" />
            </div>
            <TableScroll>
              <Table minWidth={1380}>
                <thead>
                  <Tr hover={false}>
                    <Th className="w-[12rem] pl-4">보냄</Th>
                    <Th className="w-[8rem]">이름</Th>
                    <Th className="w-[7rem]">구분</Th>
                    <Th className="w-[9rem]">보내는 회사</Th>
                    <Th align="right" className="w-[10rem]">
                      보낼 돈 (실수령)
                    </Th>
                    <Th align="right" className="w-[8rem]">
                      지난번
                    </Th>
                    <Th className="w-[7rem]">은행</Th>
                    <Th className="w-[13rem]">계좌번호</Th>
                    <Th className="w-[7rem]">예금주</Th>
                    <Th>메모</Th>
                    <Th className="w-[3rem] pr-4" aria-label="지우기" />
                  </Tr>
                </thead>
                <tbody>
                  {shown.map((l) => (
                    <PayRow
                      key={l.id}
                      line={l}
                      status={finLoading ? undefined : status.get(l.id)}
                      prevAmount={previousAmount(l, prev)}
                      today={today}
                      onChange={(patch) => updateLine(l.id, patch)}
                      onRemove={() => update((p) => ({ ...p, lines: p.lines.filter((x) => x.id !== l.id) }))}
                      onCopy={copy}
                    />
                  ))}
                </tbody>
              </Table>
            </TableScroll>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-nd-line p-4">
              <Button
                variant="secondary"
                icon={Plus}
                onClick={() => update((p) => ({ ...p, lines: [...p.lines, emptyLine(tab !== "all" && tab !== "미정" ? (tab as ProjectEntity) : undefined)] }))}
              >
                사람 더하기
              </Button>
              <TableNote className="text-nd-table">
                장부 대조: 지급일 5일 전 ~ 10일 뒤 출금 가운데 거래처에 이름(또는 예금주)이 들어 있고 회사가 같은 것 · 1,000원 안쪽 차이(이체 수수료)는 같은 돈으로 봅니다.
              </TableNote>
            </div>
          </Card>

          <Disclosure title="세무사 급여대장과 견주기 (참고)" description="귀속월 대장의 차인지급액과 이 표의 금액 — 다르면 어느 쪽이 맞는지 세무사와 확인합니다.">
            <TaxCompare plan={plan} today={today} />
          </Disclosure>

          <div className="flex justify-end">
            <Button variant="ghost" icon={Trash2} onClick={() => void removeMonth()}>
              {monthLabel(month)} 표 지우기
            </Button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

// ---- 한 줄 ------------------------------------------------------------

function PayRow({
  line,
  status,
  prevAmount,
  today,
  onChange,
  onRemove,
  onCopy,
}: {
  line: PayLine;
  status: LineStatus | undefined;
  prevAmount: number | undefined;
  today: string;
  onChange: (patch: Partial<PayLine>) => void;
  onRemove: () => void;
  onCopy: (text: string, what: string) => void;
}) {
  const who = line.name || "이 줄";
  const change = prevAmount === undefined ? undefined : line.amount - prevAmount;
  return (
    <Tr hover={false} className={cn(isDone(status) && "bg-nd-success/[.04]")}>
      <Td className="pl-4 align-middle">
        <StatusCell line={line} status={status} today={today} onChange={onChange} />
      </Td>
      <Td>
        <Input size="sm" aria-label="이름" value={line.name} placeholder="이름" onChange={(e) => onChange({ name: e.target.value })} />
      </Td>
      <Td>
        <Select size="sm" aria-label={`${who} 구분`} value={line.kind ?? ""} onChange={(e) => onChange({ kind: (e.target.value || undefined) as PayKind | undefined })}>
          <option value="">—</option>
          {PAY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </Td>
      <Td>
        <Select
          size="sm"
          aria-label={`${who} 보내는 회사`}
          value={line.entity ?? ""}
          onChange={(e) => onChange({ entity: (e.target.value || undefined) as ProjectEntity | undefined })}
        >
          <option value="">미정</option>
          {PROJECT_ENTITIES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <NumberInput
            size="sm"
            aria-label={`${who} 보낼 돈`}
            className="nd-num text-right"
            value={line.amount || ""}
            onValueChange={(raw) => onChange({ amount: Number(raw) || 0 })}
          />
          <IconButton size="sm" icon={Copy} label={`${who} 금액 복사`} disabled={!line.amount} onClick={() => onCopy(String(line.amount), "금액을")} />
        </div>
      </Td>
      <Td num className="whitespace-nowrap">
        {prevAmount === undefined ? (
          <span className="text-nd-fg-3">새 줄</span>
        ) : change === 0 ? (
          <span className="text-nd-fg-3">같음</span>
        ) : (
          <span title={`지난번 ${won(prevAmount)}원`} className={change! > 0 ? "text-nd-warning-text" : "text-nd-info-text"}>
            {signed(change!)}
          </span>
        )}
      </Td>
      <Td>
        <Input size="sm" aria-label={`${who} 은행`} value={line.bank ?? ""} placeholder="은행" onChange={(e) => onChange({ bank: e.target.value })} />
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <Input size="sm" aria-label={`${who} 계좌번호`} className="nd-num" value={line.account ?? ""} placeholder="계좌번호" onChange={(e) => onChange({ account: e.target.value })} />
          <IconButton
            size="sm"
            icon={Copy}
            label={`${who} 계좌 복사`}
            disabled={!line.account}
            onClick={() => onCopy([line.bank, line.account].filter(Boolean).join(" "), "계좌를")}
          />
        </div>
      </Td>
      <Td>
        <Input size="sm" aria-label={`${who} 예금주`} value={line.holder ?? ""} placeholder={line.name || "예금주"} onChange={(e) => onChange({ holder: e.target.value })} />
      </Td>
      <Td>
        <Input size="sm" aria-label={`${who} 메모`} value={line.memo ?? ""} onChange={(e) => onChange({ memo: e.target.value })} />
      </Td>
      <Td className="pr-4">
        <IconButton size="sm" icon={Trash2} label={`${who} 줄 지우기`} onClick={onRemove} />
      </Td>
    </Tr>
  );
}

function StatusCell({ line, status, today, onChange }: { line: PayLine; status: LineStatus | undefined; today: string; onChange: (patch: Partial<PayLine>) => void }) {
  if (!status) return <span className="text-nd-table text-nd-fg-3">장부 확인 중…</span>;
  if (status.state === "sent" && status.tx) {
    return (
      <span className="flex flex-col items-start gap-0.5">
        <Badge tone="success">보냄 · {mmdd(status.tx.date)}</Badge>
        {status.diff ? <span className="nd-num text-nd-table text-nd-fg-3">장부 {signed(status.diff)}원 (수수료)</span> : null}
      </span>
    );
  }
  if (status.state === "diff" && status.tx) {
    return (
      <span className="flex flex-col items-start gap-0.5">
        <Badge tone="warning">금액 다름 · {mmdd(status.tx.date)}</Badge>
        <span className="nd-num text-nd-table text-nd-fg-2">장부 {won(status.diff! + line.amount)}원 ({signed(status.diff!)})</span>
      </span>
    );
  }
  const manual = status.state === "manual";
  return (
    <span className="flex flex-col items-start gap-1">
      {status.state === "late" ? <Badge tone="danger">장부에 없음</Badge> : null}
      <Checkbox
        checked={manual}
        onChange={(e) => onChange({ sent: e.target.checked ? today : undefined })}
        label={manual ? `보냄 (직접 표시 · ${mmdd(line.sent!)})` : "보냄"}
      />
    </span>
  );
}

// ---- 세무사 급여대장과 견주기 ----------------------------------------------

function TaxCompare({ plan, today }: { plan: PayrollInput; today: string }) {
  const { docs, loading, error } = useTaxDocs();
  const { transactions } = useFinance();
  // 대장의 지급일은 귀속월 말일, 실제 이체는 다음 달 1일 무렵 — 지급일 5일 전이 든 달
  const period = new Date(Date.parse(`${plan.payDate}T00:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 7);
  const view = useMemo(() => buildTaxMonths(docs, transactions, today).find((v) => v.period === period), [docs, transactions, today, period]);

  if (loading) return <LoadingState label="세무 서류를 불러오는 중…" />;
  if (error) return <InlineNotice tone="danger">{error}</InlineNotice>;
  if (!view || !view.people.length) {
    return <p className="text-nd-body text-nd-fg-2">{monthLabel(period)} 귀속 급여대장 · 사업대장이 아직 없습니다. 「급여 · 세무 서류」 에 올리면 여기서 견줍니다.</p>;
  }
  const entity = view.docs.find((d) => d.entity)?.entity;
  const mine = plan.lines.filter((l) => !entity || !l.entity || l.entity === entity);
  const sumOf = (key: string) => mine.filter((l) => personKey(l.name) === key || (l.holder && personKey(l.holder) === key)).reduce((s, l) => s + l.amount, 0);
  const rows = view.people.map((p) => ({ name: p.name, type: p.type, net: p.net, mine: sumOf(p.key) }));
  const known = new Set(view.people.map((p) => p.key));
  const extra = mine.filter((l) => l.name && !known.has(personKey(l.name)));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-nd-body text-nd-fg-2">
        {monthLabel(period)} 귀속{entity ? ` · ${entity}` : ""} 대장과 이 표의 {entity ?? ""} 줄을 이름으로 견줍니다.
      </p>
      <TableScroll>
        <Table minWidth={560}>
          <thead>
            <Tr hover={false}>
              <Th>이름</Th>
              <Th>소득</Th>
              <Th align="right">대장 차인지급액</Th>
              <Th align="right">이 표</Th>
              <Th align="right">차이</Th>
            </Tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.mine - r.net;
              return (
                <Tr key={`${r.name}-${r.type}`} hover={false}>
                  <Td>{r.name}</Td>
                  <Td>{r.type === "wage" ? "근로" : "사업"}</Td>
                  <Td num>{won(r.net)}</Td>
                  <Td num>{r.mine ? won(r.mine) : <span className="text-nd-fg-3">없음</span>}</Td>
                  <Td num className={cn(d === 0 ? "text-nd-fg-3" : "font-semibold text-nd-warning-text")}>{d === 0 ? "같음" : signed(d)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
      {extra.length ? (
        <p className="text-nd-table text-nd-fg-3">대장에 없는 줄: {extra.map((l) => `${l.name} ${won(l.amount)}`).join(" · ")} — 신고 밖 지급(알바 · 정산)이면 그대로 둡니다.</p>
      ) : null}
    </div>
  );
}
