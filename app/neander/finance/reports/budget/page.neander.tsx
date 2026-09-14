"use client";

// ============================================================
//  리포트 › 예산 — 엑셀 「예산vs결산」 시트
// ------------------------------------------------------------
//  엑셀은 월별 `예산 | 결산 | 차액` 열을 오른쪽으로 계속 붙여 나갔다
//  (10월·11월·12월…). 여기서는 달을 골라 한 달씩 본다 — 열이 늘어나면
//  스크롤로 찾아야 하고, 어느 해의 10월인지도 헷갈렸다.
//
//  예산은 **잎(계정소분류)에만** 입력한다. 중·대분류는 잎 합계를 굴려
//  보여줄 뿐 따로 받지 않는다. 둘 다 받으면 어긋날 수 있고 그때 어느 쪽이
//  맞는지 아무도 모른다.
//
//  편집은 원장 시트와 같은 초안 방식이다 — 고칠 때마다 서버에 쓰지 않고
//  「저장」 한 번에 그 달 예산을 통째로 반영한다.
//
//  화면 구성은 형제 화면(지출상세·사업부)과 같은 순서다: 제목 줄 → 리포트
//  탭 → 조회 조건 줄 → 핵심 지표 → 표. 미저장 상태는 배너가 아니라 제목
//  줄의 캡슐로 알린다 — 저장 버튼 바로 옆에 있어야 "무엇을 저장하는지"가
//  붙어 읽히고, 배너로 두면 스크롤 밖으로 밀려 사라진다(승인 목업
//  all-pages/finance-reports-budget.png).
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Copy,
  Target,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  KpiStrip,
  LoadingState,
  Meter,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  RatioTile,
  SectionHeader,
  StatTile,
  TableNote,
  useToast,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import {
  TreeTable,
  type TreeColumn,
} from "@/components/neander/finance/TreeTable";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { saveFinBudget } from "@/lib/neander/finance/client";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  budgetLinesOf,
  budgetSummary,
  expenseMajors,
  rollupBudget,
} from "@/lib/neander/finance/budget";
import {
  buildReport,
  makeIsCard,
} from "@/lib/neander/finance/report";
import {
  monthLabel,
} from "@/lib/neander/format";

/** 예산은 통장에서 나가는 시점이 아니라 비용이 생긴 시점으로 관리한다 */
const BASIS = "accrual" as const;

/**
 * 집행률 색 — budget.ts 의 rateTone 과 같은 문턱(100%·90%)을 토큰으로.
 * 색만으로 뜻을 전하지 않도록 숫자(%)가 항상 같이 나온다.
 */
function rateClass(rate: number, hasBudget: boolean): string {
  if (!hasBudget) return "text-nd-fg-4";
  if (rate > 1) return "text-nd-danger-text";
  if (rate > 0.9) return "text-nd-warning-text";
  return "text-nd-fg-2";
}

/**
 * 아직 저장하지 않은 입력칸 표시. 편집 중인 칸은 눈에 띄어야 하고,
 * 같은 뜻을 제목 줄 캡슐이 글자로도 알린다 — 색 하나에 기대지 않는다.
 * 조합을 여기 한 번만 적어 칸과 캡슐이 같은 톤(warning)을 쓰게 묶는다.
 */
const EDITED_CELL = "border-nd-warning bg-nd-warning-soft";

export default function BudgetReport() {
  const { transactions, accounts, paymentMethods, budgets, loading, refresh } = useFinance();
  const toast = useToast();

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const [month, setMonth] = useState<string>("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [saving, setSaving] = useState(false);

  const activeMonth = month || months[0] || "";
  const isCard = useMemo(() => makeIsCard(paymentMethods), [paymentMethods]);
  const majors = useMemo(() => expenseMajors(accounts), [accounts]);

  const saved = useMemo(() => budgetLinesOf(budgets, activeMonth), [budgets, activeMonth]);
  /** 초안이 없으면 저장된 값이 그대로 보인다 */
  const lines = draft ?? saved;

  // 달을 바꾸면 초안을 버린다 — 다른 달의 숫자가 섞이면 안 된다
  useEffect(() => {
    setDraft(null);
  }, [activeMonth]);

  const report = useMemo(
    () => buildReport(transactions, { basis: BASIS, isCard, scope: { month: activeMonth }, accounts }),
    [transactions, isCard, activeMonth, accounts],
  );
  const rolled = useMemo(() => rollupBudget(report.roots, lines), [report.roots, lines]);
  const summary = useMemo(
    () => budgetSummary(report.roots, rolled, majors),
    [report.roots, rolled, majors],
  );

  const dirtyKeys = useMemo(() => {
    if (!draft) return [];
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    return [...keys].filter((k) => (saved[k] ?? 0) !== (draft[k] ?? 0));
  }, [draft, saved]);

  const setLine = useCallback(
    (path: string, value: number) => {
      setDraft((prev) => {
        const base = prev ?? saved;
        const next = { ...base };
        if (!Number.isFinite(value) || value === 0) delete next[path];
        else next[path] = Math.round(value);
        return next;
      });
    },
    [saved],
  );

  const save = async () => {
    if (dirtyKeys.length === 0 || !draft) return;
    setSaving(true);
    try {
      const r = await saveFinBudget(activeMonth, draft);
      setDraft(null);
      toast.success(`${monthLabel(activeMonth)} 예산 ${r.saved}줄을 저장했습니다.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  /** 직전 달 예산을 그대로 가져온다 — 매달 처음부터 채우는 건 비현실적이다 */
  const copyPrevious = () => {
    const idx = months.indexOf(activeMonth);
    const prev = months[idx + 1]; // months 는 최신순
    if (!prev) return;
    const prevLines = budgetLinesOf(budgets, prev);
    if (Object.keys(prevLines).length === 0) {
      toast.error(`${monthLabel(prev)} 에 저장된 예산이 없습니다.`);
      return;
    }
    setDraft({ ...prevLines });
    toast.info(`${monthLabel(prev)} 예산 ${Object.keys(prevLines).length}줄을 불러왔습니다. 확인 후 저장하세요.`);
  };

  const prevMonth = months[months.indexOf(activeMonth) + 1];

  const columns = useMemo<TreeColumn[]>(
    () => [
      {
        key: "budget",
        label: "예산",
        hint: "소분류만 입력",
        value: (_v, node) => rolled[node.path] ?? 0,
        render: (node) => {
          const v = rolled[node.path] ?? 0;
          if (node.children.length > 0) {
            // 상위 행은 잎 합계를 읽기 전용으로 보여준다
            return v === 0 ? (
              <span className="text-nd-fg-4">—</span>
            ) : (
              <span className="pr-1 font-medium">{v.toLocaleString("ko-KR")}</span>
            );
          }
          const changed = draft && (saved[node.path] ?? 0) !== (draft[node.path] ?? 0);
          return (
            <span className="inline-block w-24">
              <Input
                size="sm"
                type="number"
                inputMode="numeric"
                value={lines[node.path] ?? ""}
                placeholder="0"
                onChange={(e) => setLine(node.path, Number(e.target.value))}
                className={cn("nd-num text-right", changed && EDITED_CELL)}
                aria-label={`${node.label} 예산`}
              />
            </span>
          );
        },
        renderTotal: () => <Money value={summary.budget} unit={false} />,
      },
      {
        key: "actual",
        label: "결산",
        hint: "순수 지출",
        value: (v) => v.expensePure,
        renderTotal: () => <Money value={summary.actual} unit={false} />,
      },
      {
        key: "remaining",
        label: "남은 예산",
        value: (v, node) => (rolled[node.path] ?? 0) - v.expensePure,
        renderTotal: () => <Money value={summary.remaining} unit={false} />,
      },
      {
        key: "rate",
        label: "집행률",
        // 막대는 줄 사이 비교를 빠르게 해 주지만 정확한 값을 못 준다 —
        // 목업처럼 막대와 숫자를 나란히 두고, 100% 초과는 색과 함께 길이로도 드러난다
        render: (node) => {
          const b = rolled[node.path] ?? 0;
          const a = node.value.expensePure;
          if (b === 0) return <span className="text-nd-fg-4">—</span>;
          const rate = a / b;
          return (
            <span className="inline-flex items-center justify-end gap-2">
              <Meter value={rate} warnAbove={1} width={64} />
              <span className={`font-medium ${rateClass(rate, true)}`}>{(rate * 100).toFixed(0)}%</span>
            </span>
          );
        },
        renderTotal: () =>
          summary.budget > 0 ? (
            <span className="inline-flex items-center justify-end gap-2">
              <Meter value={summary.rate} warnAbove={1} width={64} />
              <span className={rateClass(summary.rate, true)}>{(summary.rate * 100).toFixed(0)}%</span>
            </span>
          ) : (
            <span className={rateClass(summary.rate, false)}>—</span>
          ),
      },
    ],
    [rolled, lines, draft, saved, setLine, summary],
  );

  if (loading) return <LoadingState label="리포트를 만드는 중…" />;
  if (transactions.length === 0) {
    return (
      <PageShell>
        <PageHeader title="예산" description="예산 대비 결산" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={Target}
          title="아직 거래가 없습니다"
          description="결산과 비교할 실적이 있어야 예산이 의미를 가집니다."
        />
      </PageShell>
    );
  }

  const noSavedBudget = Object.keys(saved).length === 0 && !draft;
  const dirty = dirtyKeys.length > 0;

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="예산"
        description="예산 대비 결산"
        className="mb-4"
        /* 미저장은 상태지 안내가 아니다 — 저장 버튼 바로 왼쪽에 캡슐로 붙여
           둔다. 색만으로 알리지 않도록 ⚠ 아이콘과 줄 수를 함께 적는다. */
        meta={
          dirty ? (
            <Badge tone="warning">
              <Icon icon={TriangleAlert} size={13} />
              미저장 변경 {dirtyKeys.length}줄
            </Badge>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={Copy}
              disabled={!prevMonth || saving}
              onClick={copyPrevious}
              title={prevMonth ? `${monthLabel(prevMonth)} 예산을 복사` : "직전 달이 없습니다"}
            >
              지난달 예산 복사
            </Button>
            {/* 되돌릴 것도 저장할 것도 없을 때는 버튼을 아예 두지 않는다 —
                꺼져 있는 버튼 두 개가 늘 붙어 있으면 저장 여부를 눈으로 못 읽는다 */}
            {dirty && (
              <>
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
                  변경 취소
                </Button>
                <Button size="sm" loading={saving} onClick={save}>
                  저장 ({dirtyKeys.length})
                </Button>
              </>
            )}
          </>
        }
      />

      <ReportTabs className="mb-4" />

      {/* 보기 설정은 표 바로 위 조회 조건 줄로 — 제목 줄 오른쪽은 상태·주요 동작 자리다 */}
      <FilterBar
        className="mb-4"
        actions={
          <Checkbox
            label="예산·지출 없는 계정도 보기"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="text-nd-caption text-nd-fg-2"
          />
        }
      >
        <span className="text-nd-caption text-nd-fg-2">
          {monthLabel(activeMonth)} · 발생 기준 · 예산은 계정소분류에만 입력합니다
        </span>
      </FilterBar>

      {/* 예산이 한 줄도 없는 달은 「경고」가 아니라 「아직 시작하지 않은 상태」다.
          그래서 배너가 아니라 빈 상태로 두고, 시작 버튼을 그 안에 놓는다. */}
      {noSavedBudget && (
        <EmptyState
          className="mb-4"
          compact
          icon={Target}
          title={`${monthLabel(activeMonth)} 예산이 아직 없습니다`}
          description="소분류 칸에 금액을 넣으면 바로 초안이 됩니다. 예산 없이도 아래 결산은 그대로 보입니다."
          action={
            prevMonth ? (
              <Button variant="secondary" size="sm" icon={Copy} disabled={saving} onClick={copyPrevious}>
                {monthLabel(prevMonth)} 예산 복사
              </Button>
            ) : undefined
          }
        />
      )}

      <KpiStrip columns={4} className="mb-4">
        <StatTile label="예산" value={summary.budget} hint={`${monthLabel(activeMonth)} · 지출 계정`} />
        <StatTile label="결산" value={summary.actual} hint="개인사용·환급 차감" />
        <StatTile
          label="남은 예산"
          value={summary.remaining}
          hint={summary.remaining < 0 ? "예산 초과" : "집행 가능"}
        />
        {/* 집행률은 형제 화면의 비율 타일과 같은 부품으로 — 100% 초과는 「초과」 글자로도 나온다 */}
        <RatioTile
          label="집행률"
          value={summary.budget > 0 ? summary.rate : null}
          warnAbove={1}
          digits={0}
          hint={
            <>
              초과 {summary.overCount}개 계정
              {summary.unbudgetedCount > 0 && ` · 예산 없는 지출 ${summary.unbudgetedCount}개`}
            </>
          }
        />
      </KpiStrip>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="계정별 예산 대비 결산"
            hint="지출 계정만 · 결산 숫자를 누르면 원장이 그 조건으로 열립니다"
            action={<TableNote>단위: 원</TableNote>}
          />
        </div>
        <TreeTable
          roots={report.roots}
          total={report.total}
          columns={columns}
          showEmpty={showEmpty}
          filterRoot={(node) => majors.has(node.major)}
          hrefFor={(node) =>
            ledgerHref({
              month: activeMonth,
              txTypes: ["지출", "환급"],
              acctMajor: node.major,
              acctMid: node.level >= 1 ? node.mid : undefined,
              acctMinor: node.level >= 2 ? node.minor : undefined,
            })
          }
          totalLabel="지출 합계"
          emptyMessage="이 달에 지출이 없고 예산도 잡히지 않았습니다."
        />
        {/* 「예산을 빠뜨린 것인가」는 표를 다 읽고 나서 드는 질문이라 표 아래 각주로.
            위에 배너로 두면 정작 확인해야 할 표를 밀어낸다. */}
        {summary.unbudgetedCount > 0 && (
          <TableNote className="border-t border-nd-line px-5 py-2.5">
            예산을 안 잡았는데 지출이 있는 계정 <b className="font-medium text-nd-fg-2">{summary.unbudgetedCount}개</b> ·{" "}
            <Money value={summary.unbudgetedAmount} unit={false} />원. 계획에 없던 지출인지, 예산을
            빠뜨린 것인지 확인하세요 — 「예산·지출 없는 계정도 보기」를 끄면 이 계정들만 보입니다.
          </TableNote>
        )}
      </Card>
    </PageShell>
  );
}
