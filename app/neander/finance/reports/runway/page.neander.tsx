"use client";

// ============================================================
//  리포트 › 런웨이 — 지금 현금으로 몇 달을 버티는가
// ------------------------------------------------------------
//  계산은 lib/neander/finance/runway.ts 한 곳에 있다. 이 화면은 그 숫자를
//  보여주고, 사람이 가정을 고치게 한다.
//
//    핵심 지표   지금 현금 · 매달 순현금 · 런웨이 둘(잡힌 돈만 / 평소 수주)
//    그래프      달마다 남는 현금
//    월별 표     줄마다 무엇이 들어가 그 숫자가 됐는지 — 켜고 끄기 · 「바꾸기」
//    가정        평균 한 줄을 어느 달부터 바꾸기 · 돈 한 덩이 더하기
//    받을 돈     프로젝트 회차 — 받을 날은 프로젝트에서 적는다(정본은 하나)
//    시작 현금   통장 잔액 — 잔액이 안 찍히는 계좌만 손으로
//
//  가정은 팀이 함께 쓰는 문서 하나라 예산 화면처럼 초안 → 「저장」 이다.
//  화면 구성 순서는 형제 리포트와 같다: 제목 줄 → 탭 → 조회 조건 → 지표 → 본문.
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Calculator,
  ExternalLink,
  Hourglass,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Checkbox,
  cn,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  FieldAction,
  FilterBar,
  FilterField,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  NumberInput,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Select,
  SERIES,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { RunwayChart } from "@/components/neander/finance/RunwayChart";
import { CutTable, ScenarioBar, ScenarioCompare, useCutScenarios } from "@/components/neander/finance/RunwaySimulator";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { fetchRunwaySettings, saveRunwaySettings } from "@/lib/neander/finance/client";
import {
  BASE_MONTH_OPTIONS,
  buildRunway,
  DEFAULT_RUNWAY,
  defaultAsOf,
  HORIZON_OPTIONS,
  newItem,
  newOverride,
  runwayPayload,
  type InflowStatus,
  type RunwayLine,
  type RunwayOutcome,
  type RunwaySettings,
} from "@/lib/neander/finance/runway";
import { formatSigned, monthLabel, shortWon, todayStrKST } from "@/lib/neander/format";

/** 표는 만원 단위 — 24개월 × 원 단위는 자릿수를 세다 지친다 */
const man = (v: number) => Math.round(v / 10_000).toLocaleString("ko-KR");

const shortMonth = (m: string) => `${m.slice(2, 4)}.${Number(m.slice(5))}`;

const INFLOW_LABEL: Record<InflowStatus, string> = { scheduled: "예정", overdue: "연체", undated: "날짜 미정" };
const INFLOW_TONE: Record<InflowStatus, Tone> = { scheduled: "info", overdue: "danger", undated: "neutral" };

/** 런웨이 개월 → 지표 숫자 */
function runwayValue(o: RunwayOutcome, horizon: number): string {
  if (o.months === null) return `${horizon}+`;
  return o.months.toFixed(1);
}

function runwayHint(o: RunwayOutcome, horizon: number): string {
  if (o.months === null) return `${horizon}개월 안에는 안 바닥남 · 가장 적은 달 ${shortWon(o.lowest)}`;
  if (o.months === 0) return "시작 현금이 이미 0 아래";
  return `${monthLabel(o.zeroMonth ?? "")} 중 바닥`;
}

/** 3개월 안이면 위험, 6개월 안이면 주의 — 색만이 아니라 숫자·글자가 함께 나온다 */
function runwayTone(o: RunwayOutcome): Tone {
  if (o.months === null) return "success";
  if (o.months < 3) return "danger";
  if (o.months < 6) return "warning";
  return "success";
}

export default function RunwayReport() {
  const { transactions, paymentMethods, projects, loading } = useFinance();
  const toast = useToast();

  const [saved, setSaved] = useState<RunwaySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RunwaySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState("");

  // 재무 데이터가 뜬 뒤(= 로그인 확인 뒤)에 가정을 받는다
  useEffect(() => {
    if (loading || saved || loadError) return;
    fetchRunwaySettings()
      .then((s) => setSaved(s ?? DEFAULT_RUNWAY))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "가정을 불러오지 못했습니다."));
  }, [loading, saved, loadError]);

  const today = todayStrKST();
  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const fallbackAsOf = useMemo(() => defaultAsOf(transactions, today.slice(0, 7)), [transactions, today]);
  const asOf = month || fallbackAsOf;

  const base = saved ?? DEFAULT_RUNWAY;
  const settings = draft ?? base;
  const update = (fn: (s: RunwaySettings) => RunwaySettings) => setDraft((prev) => fn(prev ?? base));

  const dirty = useMemo(
    () => draft !== null && JSON.stringify(runwayPayload(draft)) !== JSON.stringify(runwayPayload(base)),
    [draft, base],
  );

  const result = useMemo(
    () => buildRunway({ transactions, paymentMethods, projects, settings, asOf, today }),
    [transactions, paymentMethods, projects, settings, asOf, today],
  );

  // 비용 줄여 보기 — 고른 시나리오가 지표·그래프·월별 표에 얹힌다
  const ed = useCutScenarios({ result, settings, update, thisMonth: today.slice(0, 7) });

  const sites = useMemo(() => {
    const set = new Set<string>();
    paymentMethods.forEach((p) => p.site && set.add(p.site));
    transactions.forEach((t) => t.site && set.add(t.site));
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [paymentMethods, transactions]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await saveRunwaySettings(runwayPayload(draft));
      setSaved(next);
      setDraft(null);
      toast.success("런웨이 가정을 저장했습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || (!saved && !loadError)) return <LoadingState label="런웨이를 계산하는 중…" />;
  if (transactions.length === 0) {
    return (
      <PageShell>
        <PageHeader title="리포트" description="지금 현금으로 몇 달을 버티는가" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={Hourglass}
          title="아직 거래가 없습니다"
          description="엑셀 임포트에서 통장·카드 내역을 올리면 잔액과 최근 수입·지출로 런웨이를 계산합니다."
        />
      </PageShell>
    );
  }

  const r = result;
  const firstMonth = r.months[0];
  const baseLabel = `${Number(r.baseMonths[0].slice(5))}~${Number(asOf.slice(5))}월`;
  const undated = r.inflows.filter((f) => f.status === "undated");
  const noBalance = r.cash.filter((c) => c.ledger === null && c.manual === null);
  const includedInflow = r.inflows.filter((f) => f.included).reduce((s, f) => s + f.amount, 0);
  const lineByKey = new Map(r.lines.map((l) => [l.key, l]));

  // ---- 고치기 ----
  const toggleLine = (l: RunwayLine, on: boolean) =>
    update((s) => {
      const lineToggles = { ...s.lineToggles };
      if (on === l.defaultOn) delete lineToggles[l.key];
      else lineToggles[l.key] = on;
      return { ...s, lineToggles };
    });

  const addOverride = (l: RunwayLine) => {
    update((s) => ({ ...s, overrides: [...s.overrides, newOverride(l.key, firstMonth, Math.max(0, l.avg))] }));
    // 바꾸기는 아래 「가정」 칸에서 마저 적는다 — 거기로 데려간다
    window.setTimeout(() => document.getElementById("runway-assumptions")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const setCash = (last4: string, raw: string) =>
    update((s) => {
      const cash = { ...s.cash };
      if (raw === "" || raw === "-") delete cash[last4];
      else cash[last4] = Math.round(Number(raw));
      return { ...s, cash };
    });

  const toggleInflow = (id: string, include: boolean) =>
    update((s) => ({
      ...s,
      skipInflows: include ? s.skipInflows.filter((x) => x !== id) : [...new Set([...s.skipInflows, id])],
    }));

  const toggleSite = (site: string, include: boolean) =>
    update((s) => ({
      ...s,
      excludeSites: include ? s.excludeSites.filter((x) => x !== site) : [...new Set([...s.excludeSites, site])],
    }));

  // ---- 표 ----
  const COLS = r.months.length;
  const monthHead = r.months.map((m) => (
    <Th key={m} align="right" className={cn(m.endsWith("-01") && "border-l border-nd-line")}>
      {shortMonth(m)}
    </Th>
  ));

  const cell = (v: number, opts: { month: string; flow?: "income" | "expense" | "net"; strong?: boolean; tint?: boolean; title?: string }) => (
    <Td
      key={opts.month}
      num
      className={cn(
        opts.tint && "bg-nd-accent-soft/60",
        opts.strong && "font-semibold",
        opts.month.endsWith("-01") && "border-l border-nd-line",
      )}
      title={opts.title}
    >
      {Math.round(v / 10_000) === 0 ? (
        <span className="text-nd-fg-4">–</span>
      ) : (
        <Money value={Math.round(v / 10_000)} unit={false} flow={opts.flow} />
      )}
    </Td>
  );

  const sectionRow = (label: string) => (
    <tr className="bg-nd-sunken/60">
      <Td sticky="left" className="bg-nd-sunken py-1.5 text-nd-caption font-medium text-nd-fg-2" colSpan={2}>
        {label}
      </Td>
      <td colSpan={COLS} className="bg-nd-sunken/60" />
    </tr>
  );

  const lineRow = (l: RunwayLine) => (
    <tr key={l.key} className={cn("border-b border-nd-line", !l.on && "text-nd-fg-3")}>
      <Td sticky="left" className="min-w-[13rem]">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={l.on}
            onChange={(e) => toggleLine(l, e.target.checked)}
            aria-label={`${l.label} 넣기`}
          />
          <div className="min-w-0 flex-1">
            <div className={cn("truncate", !l.on && "line-through decoration-nd-fg-4")}>{l.label}</div>
            <div className="truncate text-nd-caption text-nd-fg-3">{l.hint}</div>
          </div>
          <IconButton
            icon={SlidersHorizontal}
            size="sm"
            label={`${l.label} — 어느 달부터 다른 금액으로`}
            onClick={() => addOverride(l)}
          />
        </div>
      </Td>
      <Td num muted title={l.base.map((v, i) => `${monthLabel(r.baseMonths[i])} ${formatSigned(v)}원`).join("\n")}>
        {man(l.avg)}
      </Td>
      {l.values.map((v, i) =>
        cell(v, {
          flow: l.on ? (l.flow === "in" ? "income" : "expense") : undefined,
          tint: l.overridden[i],
          title: l.overridden[i] ? "가정으로 바꾼 달" : undefined,
          month: r.months[i],
        }),
      )}
    </tr>
  );

  const incomeLines = r.lines.filter((l) => l.flow === "in");
  const expenseLines = r.lines.filter((l) => l.flow === "out");
  const itemsIn = r.items.filter((x) => x.item.flow === "in");
  const itemsOut = r.items.filter((x) => x.item.flow === "out");

  const itemRow = (x: (typeof r.items)[number]) => (
    <tr key={x.item.id} className="border-b border-nd-line">
      <Td sticky="left">
        <div className="truncate">{x.item.label || "(이름 없는 가정)"}</div>
        <div className="text-nd-caption text-nd-fg-3">가정 · {x.item.to === x.item.from ? "한 번" : "매달"}</div>
      </Td>
      <Td num muted>
        –
      </Td>
      {x.values.map((v, i) => cell(v, { flow: x.item.flow === "in" ? "income" : "expense", tint: v !== 0, month: r.months[i] }))}
    </tr>
  );

  const totalRow = (label: ReactNode, avg: number | null, values: number[], flow?: "income" | "expense" | "net", strong = false) => (
    <tr className={cn("border-b border-nd-line", strong && "bg-nd-sunken")}>
      <Td sticky="left" className={cn("font-medium", strong && "bg-nd-sunken")}>
        {label}
      </Td>
      <Td num muted>
        {avg === null ? "–" : man(avg)}
      </Td>
      {values.map((v, i) => cell(v, { flow, strong, month: r.months[i] }))}
    </tr>
  );

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={asOf} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="리포트"
        description="지금 현금으로 몇 달을 버티는가"
        className="mb-4"
        meta={
          dirty ? (
            <Badge tone="warning">
              <Icon icon={TriangleAlert} size={13} />
              저장 안 한 가정
            </Badge>
          ) : base.updatedAt ? (
            <span className="text-nd-caption text-nd-fg-3">
              가정 저장 {new Date(base.updatedAt).toLocaleDateString("ko-KR")}
              {base.updatedBy ? ` · ${base.updatedBy.split("@")[0]}` : ""}
            </span>
          ) : undefined
        }
        actions={
          dirty ? (
            <>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
                변경 취소
              </Button>
              <Button size="sm" loading={saving} onClick={save}>
                가정 저장
              </Button>
            </>
          ) : undefined
        }
      />

      <ReportTabs className="mb-4" />

      {loadError && (
        <ErrorState
          className="mb-4"
          title="저장된 가정을 불러오지 못했습니다"
          description={`${loadError} — 아래 숫자는 기본 가정(최근 3개월 평균)으로 계산한 것입니다.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => setLoadError(null)}>
              다시 불러오기
            </Button>
          }
        />
      )}

      <FilterBar className="mb-3">
        <FilterField label="평균" as="div">
          <SegmentedControl<string>
            size="sm"
            ariaLabel="평균 낼 기간"
            value={String(settings.baseMonths)}
            onChange={(v) => update((s) => ({ ...s, baseMonths: Number(v) }))}
            options={BASE_MONTH_OPTIONS.map((n) => ({ value: String(n), label: `최근 ${n}개월` }))}
          />
        </FilterField>
        <FilterField label="내다보기" as="div">
          <SegmentedControl<string>
            size="sm"
            ariaLabel="내다볼 기간"
            value={String(settings.horizon)}
            onChange={(v) => update((s) => ({ ...s, horizon: Number(v) }))}
            options={HORIZON_OPTIONS.map((n) => ({ value: String(n), label: `${n}개월` }))}
          />
        </FilterField>
        <FilterField label="사업장" as="div">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sites.map((s) => (
              <Checkbox
                key={s}
                label={s}
                checked={!settings.excludeSites.includes(s)}
                onChange={(e) => toggleSite(s, e.target.checked)}
                className="text-nd-caption text-nd-fg-2"
              />
            ))}
          </div>
        </FilterField>
      </FilterBar>

      <BasisLine
        className="mb-4"
        items={[
          <>
            <b className="font-medium text-nd-fg-2">{monthLabel(asOf)} 말</b> 통장 잔액에서 출발
          </>,
          `반복 수입·지출은 ${baseLabel} 평균 (발생주의)`,
          "B2B 는 프로젝트 받을 날 기준",
          "자금거래·카드대금결제 제외",
        ]}
      />

      <KpiStrip columns={4} className="mb-4">
        <StatTile
          label="지금 현금"
          value={r.openingCash}
          hint={`${monthLabel(asOf)} 말 · 계좌 ${r.cash.filter((c) => c.used !== 0).length}개`}
        />
        {ed.active ? (
          <StatTile
            label={`매달 순현금 · ${ed.scenario?.name ?? "줄인 뒤"}`}
            value={r.baseNet + ed.sim.savingFull}
            flow="net"
            hint={`줄이기 전 ${shortWon(r.baseNet)} · 매달 ${shortWon(ed.sim.savingFull)} 아낌 · B2B 빼고`}
          />
        ) : (
          <StatTile
            label="매달 순현금"
            value={r.baseNet}
            flow="net"
            hint={`B2B 빼고 · 수입 ${shortWon(r.baseIncome)} − 지출 ${shortWon(r.baseExpense)}`}
          />
        )}
        <KpiItem
          label="런웨이 · 잡힌 돈만"
          value={ed.active ? `${runwayValue(r.outcome, settings.horizon)} → ${runwayValue(ed.sim.outcome, settings.horizon)}` : runwayValue(r.outcome, settings.horizon)}
          unit="개월"
          tone={runwayTone(ed.sim.outcome)}
          hint={runwayHint(ed.sim.outcome, settings.horizon)}
        />
        <KpiItem
          label="런웨이 · 평소만큼 수주"
          value={ed.active ? `${runwayValue(r.outcomeAlt, settings.horizon)} → ${runwayValue(ed.sim.outcomeAlt, settings.horizon)}` : runwayValue(r.outcomeAlt, settings.horizon)}
          unit="개월"
          tone={runwayTone(ed.sim.outcomeAlt)}
          hint={`${runwayHint(ed.sim.outcomeAlt, settings.horizon)} · B2B 월 ${shortWon(r.b2bAvg)}`}
        />
      </KpiStrip>

      {(undated.length > 0 || noBalance.length > 0) && (
        <div className="mb-4 flex flex-col gap-2">
          {undated.length > 0 && (
            <InlineNotice tone="warning" icon={TriangleAlert}>
              받을 날이 안 적힌 B2B 받을 돈 <b className="font-medium">{undated.length}건 · {shortWon(undated.reduce((s, f) => s + f.amount, 0))}원</b>은
              「잡힌 돈만」 에 들어가지 않았습니다. 프로젝트에 받을 날(입금 회차)을 적으면 그 달에 들어옵니다 — 아래 「받을 돈」.
            </InlineNotice>
          )}
          {noBalance.length > 0 && (
            <InlineNotice tone="info">
              장부에 잔액이 안 찍힌 계좌 {noBalance.length}개({noBalance.map((c) => c.alias).join(" · ")})는 0원으로 셉니다. 아래
              「시작 현금」 에서 적을 수 있습니다.
            </InlineNotice>
          )}
        </div>
      )}

      <ScenarioBar ed={ed} className="mb-3" />

      <Card className="mb-3">
        <SectionHeader
          title="달마다 남는 현금"
          hint={
            ed.active
              ? `파랑은 「${ed.scenario?.name}」 로 줄인 뒤, 회색은 줄이기 전 · 실선은 잡힌 돈만, 점선은 B2B 가 평소만큼 들어올 때`
              : "실선은 잡힌 돈만, 점선은 B2B 가 평소만큼 들어올 때"
          }
        />
        <RunwayChart
          months={[asOf, ...r.months]}
          series={[
            // 색 = 줄이기 전(회색)·후(파랑), 선 모양 = B2B 기준(실선 잡힌 돈만 · 점선 평소 수주)
            ...(ed.active
              ? [
                  { key: "pre-alt", label: "줄이기 전 · 평소 수주", values: [r.openingCash, ...r.rows.map((m) => m.closingAlt)], color: SERIES.neutral, dashed: true, quiet: true },
                  { key: "pre", label: "줄이기 전", legend: "줄이기 전 (회색)", values: [r.openingCash, ...r.rows.map((m) => m.closing)], color: SERIES.neutral },
                ]
              : []),
            { key: "alt", label: "평소 수주", legend: "평소만큼 수주 (점선)", values: [r.openingCash, ...ed.sim.rows.map((m) => m.closingAlt)], color: SERIES.income, dashed: true },
            { key: "booked", label: "잡힌 돈만", values: [r.openingCash, ...ed.sim.rows.map((m) => m.closing)], color: SERIES.income },
          ]}
          zero={ed.sim.outcome}
          extraRows={(i) => [
            { key: "in", label: "들어올 돈", value: formatSigned(r.rows[i - 1].income) },
            { key: "out", label: "나갈 돈", value: formatSigned(-(r.rows[i - 1].expense - ed.sim.rows[i - 1].saving)), negative: true },
            ...(ed.active ? [{ key: "save", label: "그중 아낀 돈", value: formatSigned(ed.sim.rows[i - 1].saving) }] : []),
          ]}
        />
      </Card>

      <CutTable ed={ed} className="mb-3" />
      <ScenarioCompare ed={ed} className="mb-3" />

      <Card padding="none" className="mb-3 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="월별 현금 흐름"
            hint="체크를 끄면 그 줄을 빼고 계산합니다 · 조절 단추로 어느 달부터 다른 금액을 넣습니다 · 칠한 칸은 가정"
            action={<TableNote>단위: 만원</TableNote>}
          />
        </div>
        <TableScroll>
          <Table dense minWidth={360 + COLS * 72}>
            <thead>
              <tr>
                <Th sticky="left" className="min-w-[13rem]">
                  항목
                </Th>
                <Th align="right" title={`${baseLabel} 평균`}>
                  평균
                </Th>
                {monthHead}
              </tr>
            </thead>
            <tbody>
              {totalRow("기초 현금", null, ed.sim.rows.map((m, i) => (i === 0 ? r.openingCash : ed.sim.rows[i - 1].closing)))}

              {sectionRow("들어오는 돈")}
              {incomeLines.map(lineRow)}
              <tr className="border-b border-nd-line">
                <Td sticky="left">
                  <div>B2B 받을 돈</div>
                  <div className="text-nd-caption text-nd-fg-3">프로젝트 회차 · 평균은 참고</div>
                </Td>
                <Td num muted title={r.b2bBase.map((v, i) => `${monthLabel(r.baseMonths[i])} ${formatSigned(v)}원`).join("\n")}>
                  {man(r.b2bAvg)}
                </Td>
                {r.rows.map((m) => cell(m.b2b, { flow: "income", month: m.month }))}
              </tr>
              {itemsIn.map(itemRow)}
              {totalRow("들어오는 돈 합계", r.baseIncome, r.rows.map((m) => m.income), "income")}

              {sectionRow("나가는 돈")}
              {expenseLines.map(lineRow)}
              {itemsOut.map(itemRow)}
              {ed.active && (
                <tr className="border-b border-nd-line">
                  <Td sticky="left">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => document.getElementById("runway-cuts")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      <div>줄이기 · {ed.scenario?.name}</div>
                      <div className="text-nd-caption text-nd-fg-3">「어디를 줄일까」 에서 고칩니다</div>
                    </button>
                  </Td>
                  <Td num muted>
                    {man(-ed.sim.savingFull)}
                  </Td>
                  {ed.sim.rows.map((m) => cell(-m.saving, { month: m.month, flow: "income", tint: m.saving > 0 }))}
                </tr>
              )}
              {totalRow("나가는 돈 합계", r.baseExpense - ed.sim.savingFull, r.rows.map((m, i) => m.expense - ed.sim.rows[i].saving), "expense")}

              {totalRow("순현금", r.baseNet + ed.sim.savingFull, r.rows.map((m, i) => m.net + ed.sim.rows[i].saving), "net")}
              {totalRow("기말 현금 · 잡힌 돈만", null, ed.sim.rows.map((m) => m.closing), undefined, true)}
              {totalRow(
                <span className="font-normal text-nd-fg-2">기말 현금 · 평소 수주</span>,
                null,
                ed.sim.rows.map((m) => m.closingAlt),
              )}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        {/* ---- 가정 ---- */}
        <Card id="runway-assumptions">
          <SectionHeader
            title="가정"
            hint="평균 한 줄을 어느 달부터 바꾸거나, 돈 한 덩이를 더합니다"
            action={
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  onClick={() => update((s) => ({ ...s, items: [...s.items, newItem(firstMonth)] }))}
                >
                  돈 더하기
                </Button>
              </div>
            }
          />

          {settings.overrides.length === 0 && settings.items.length === 0 && (
            <p className="text-nd-body text-nd-fg-3">
              아직 가정이 없습니다. 예) 표의 「와우 매출」 조절 단추 → 12월부터 0원 · 「돈 더하기」 → 11월 권리금 500만원 들어옴.
            </p>
          )}

          {settings.overrides.length > 0 && (
            <div className="mb-4 flex flex-col gap-3">
              <h3 className="text-nd-caption font-medium text-nd-fg-2">바꾼 줄</h3>
              {settings.overrides.map((o) => {
                const line = lineByKey.get(o.lineKey);
                const patch = (p: Partial<typeof o>) =>
                  update((s) => ({ ...s, overrides: s.overrides.map((x) => (x.id === o.id ? { ...x, ...p } : x)) }));
                return (
                  <FormRow key={o.id} className="grid-cols-2 sm:grid-cols-[minmax(9rem,1.3fr)_6.5rem_8.5rem_minmax(7rem,1fr)_auto]">
                    <Field label="줄" className="col-span-2 sm:col-span-1">
                      <Select size="sm" value={o.lineKey} onChange={(e) => patch({ lineKey: e.target.value })}>
                        {!line && <option value={o.lineKey}>{o.lineKey} (지금 범위에 없음)</option>}
                        {r.lines.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.flow === "in" ? "수입" : "지출"} · {l.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="부터">
                      <Select size="sm" value={o.from} onChange={(e) => patch({ from: e.target.value })}>
                        {!r.months.includes(o.from) && <option value={o.from}>{shortMonth(o.from)}</option>}
                        {r.months.map((m) => (
                          <option key={m} value={m}>
                            {shortMonth(m)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={line ? `월 금액 · 평균 ${shortWon(line.avg)}` : "월 금액"}>
                      <NumberInput size="sm" value={o.amount} onValueChange={(v) => patch({ amount: Math.abs(Number(v) || 0) })} className="text-right" />
                    </Field>
                    <Field label="메모">
                      <Input size="sm" value={o.note ?? ""} placeholder="와우 철수" onChange={(e) => patch({ note: e.target.value })} />
                    </Field>
                    <FieldAction>
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        label="이 가정 지우기"
                        onClick={() => update((s) => ({ ...s, overrides: s.overrides.filter((x) => x.id !== o.id) }))}
                      />
                    </FieldAction>
                  </FormRow>
                );
              })}
            </div>
          )}

          {settings.items.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-nd-caption font-medium text-nd-fg-2">더한 돈</h3>
              {settings.items.map((it) => {
                const patch = (p: Partial<typeof it>) =>
                  update((s) => ({ ...s, items: s.items.map((x) => (x.id === it.id ? { ...x, ...p } : x)) }));
                return (
                  <FormRow key={it.id} className="grid-cols-2 sm:grid-cols-[minmax(8rem,1.2fr)_6rem_6.5rem_6.5rem_8.5rem_auto]">
                    <Field label="이름" className="col-span-2 sm:col-span-1">
                      <Input size="sm" value={it.label} placeholder="권리금" onChange={(e) => patch({ label: e.target.value })} />
                    </Field>
                    <Field label="방향">
                      <Select size="sm" value={it.flow} onChange={(e) => patch({ flow: e.target.value === "in" ? "in" : "out" })}>
                        <option value="in">들어옴</option>
                        <option value="out">나감</option>
                      </Select>
                    </Field>
                    <Field label="부터">
                      <Select
                        size="sm"
                        value={it.from}
                        onChange={(e) => {
                          const from = e.target.value;
                          // 한 번짜리였으면 끝 달도 같이 옮긴다
                          patch({ from, to: it.to === it.from ? from : it.to && it.to < from ? from : it.to });
                        }}
                      >
                        {!r.months.includes(it.from) && <option value={it.from}>{shortMonth(it.from)}</option>}
                        {r.months.map((m) => (
                          <option key={m} value={m}>
                            {shortMonth(m)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="까지">
                      <Select size="sm" value={it.to ?? ""} onChange={(e) => patch({ to: e.target.value || undefined })}>
                        <option value="">끝까지</option>
                        {it.to && !r.months.includes(it.to) && <option value={it.to}>{shortMonth(it.to)}</option>}
                        {r.months
                          .filter((m) => m >= it.from)
                          .map((m) => (
                            <option key={m} value={m}>
                              {m === it.from ? `${shortMonth(m)} (한 번)` : shortMonth(m)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label={it.to === it.from ? "금액" : "월 금액"}>
                      <NumberInput size="sm" value={it.amount} onValueChange={(v) => patch({ amount: Math.abs(Number(v) || 0) })} className="text-right" />
                    </Field>
                    <FieldAction>
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        label="이 가정 지우기"
                        onClick={() => update((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) }))}
                      />
                    </FieldAction>
                  </FormRow>
                );
              })}
            </div>
          )}
        </Card>

        {/* ---- 받을 돈 ---- */}
        <Card>
          <SectionHeader
            title="받을 돈 (B2B 프로젝트)"
            hint={`넣은 돈 ${shortWon(includedInflow)}원 · 받을 날은 프로젝트의 입금 회차에서 적습니다`}
          />
          {r.inflows.length === 0 ? (
            <p className="text-nd-body text-nd-fg-3">아직 받을 돈이 남은 프로젝트가 없습니다.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-nd-line">
              {r.inflows.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2">
                  <Checkbox
                    checked={f.included}
                    disabled={f.status === "undated"}
                    onChange={(e) => toggleInflow(f.id, e.target.checked)}
                    aria-label={`${f.projectName} ${f.kind} 넣기`}
                    title={f.status === "undated" ? "받을 날이 없어 넣을 달을 모릅니다" : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/neander/finance/projects/${f.projectId}`}
                      className="inline-flex max-w-full items-center gap-1 truncate text-nd-body text-nd-fg hover:underline"
                    >
                      <span className="truncate">{f.projectName}</span>
                      <Icon icon={ExternalLink} size={12} className="shrink-0 text-nd-fg-3" />
                    </Link>
                    <div className="text-nd-caption text-nd-fg-3">
                      {f.code} · {f.kind} · {f.dueDate ? `받을 날 ${f.dueDate}` : "받을 날을 적어 주세요"}
                      {f.status === "overdue" && f.month && ` → ${shortMonth(f.month)}에 넣음`}
                    </div>
                  </div>
                  <Badge tone={INFLOW_TONE[f.status]} size="sm">
                    {INFLOW_LABEL[f.status]}
                  </Badge>
                  <span className="w-24 shrink-0 text-right">
                    <Money value={f.amount} unit={false} flow={f.included ? "income" : undefined} muted={!f.included} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ---- 시작 현금 ---- */}
      <Card className="mb-3">
        <SectionHeader
          title="시작 현금"
          hint={`${monthLabel(asOf)} 말까지의 마지막 「거래후 잔액」 · 칸에 적으면 장부 잔액 대신 씁니다`}
          action={<Money value={r.openingCash} flow="net" className="text-nd-body font-semibold" />}
        />
        <TableScroll>
          <Table dense minWidth={560}>
            <thead>
              <tr>
                <Th>계좌</Th>
                <Th>사업장</Th>
                <Th align="right">장부 잔액</Th>
                <Th align="right">직접 적기</Th>
              </tr>
            </thead>
            <tbody>
              {r.cash.map((c) => (
                <tr key={c.last4} className="border-b border-nd-line last:border-b-0">
                  <Td>
                    {c.alias} <span className="text-nd-caption text-nd-fg-3">{c.last4}</span>
                  </Td>
                  <Td muted>{c.site ?? "–"}</Td>
                  <Td num>
                    {c.ledger === null ? (
                      <span className="text-nd-fg-3">잔액 없음</span>
                    ) : (
                      <>
                        <Money value={c.ledger} unit={false} muted={c.manual !== null} />
                        <div className="text-nd-caption text-nd-fg-3">{c.ledgerDate}</div>
                      </>
                    )}
                  </Td>
                  <Td num className="w-40">
                    <NumberInput
                      size="sm"
                      negative
                      value={c.manual ?? ""}
                      placeholder={c.ledger === null ? "0" : "장부 그대로"}
                      onValueChange={(v) => setCash(c.last4, v)}
                      className="text-right"
                      aria-label={`${c.alias} 잔액 직접 적기`}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <Disclosure icon={Calculator} title="계산식 안내" description="숫자를 어디서 가져오는가" defaultOpen={false}>
        <dl className="flex flex-col gap-2.5 text-nd-caption leading-relaxed">
          {[
            ["기말 현금", "기초 현금 + 들어오는 돈 − 나가는 돈. 이걸 달마다 굴려 0 아래로 내려가는 자리를 찾습니다. 그 달 안에서는 고르게 줄어든다고 보고 몇 째 달인지 소수로 나눕니다."],
            ["시작 현금", `통장 내역의 「거래후 잔액」 중 ${monthLabel(asOf)} 말까지의 마지막 값입니다. 카드와 대출 계좌는 넣지 않습니다.`],
            ["반복 수입·지출", `${baseLabel} 실적의 평균입니다(발생주의 — 카드는 쓴 날). 지출은 개인사용을 빼고 환급을 차감한 순수지출이라 리포트 지출상세와 같은 숫자입니다. 기타수입(지원금·환불수입 등)은 매달 반복되지 않아 기본으로 뺍니다.`],
            ["B2B 받을 돈", "평균을 내지 않습니다. 프로젝트 입금 회차 중 아직 안 받은 것을 받을 날의 달에 넣습니다(부가세 포함 청구액). 날짜가 지났으면 첫 달에 넣고 「연체」 로 표시합니다."],
            ["평소만큼 수주", `B2B 입금이 최근 평균(월 ${shortWon(r.b2bAvg)})보다 적은 달은 평균만큼 들어온다고 봅니다. 아직 따내지 않은 일까지 넣은 낙관적인 선입니다.`],
            ["빠지는 것", "자금거래(계좌 간 이동·가수금·보증금·예수금)와 카드대금결제. 임원이 넣어 준 가수금으로 버틴 달은 그만큼 런웨이가 짧게 나옵니다. 부가세 납부처럼 분기마다 몰리는 돈은 평균에 섞여 고르게 나뉩니다 — 큰 납부가 예정돼 있으면 「돈 더하기」 로 넣으세요."],
          ].map(([term, desc]) => (
            <div key={term} className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3">
              <dt className="font-medium text-nd-fg">{term}</dt>
              <dd className="text-nd-fg-2">{desc}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </PageShell>
  );
}
