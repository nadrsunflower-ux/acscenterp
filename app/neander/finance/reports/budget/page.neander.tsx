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
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { TreeTable, type TreeColumn } from "@/components/neander/finance/TreeTable";
import { Money, StatTile, SectionTitle } from "@/components/neander/finance/ui";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { saveFinBudget } from "@/lib/neander/finance/client";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  budgetLinesOf,
  budgetNoteOf,
  budgetSummary,
  expenseMajors,
  rateTone,
  rollupBudget,
} from "@/lib/neander/finance/budget";
import { buildReport, makeIsCard, type TreeNode } from "@/lib/neander/finance/report";

/** 예산은 통장에서 나가는 시점이 아니라 비용이 생긴 시점으로 관리한다 */
const BASIS = "accrual" as const;

export default function BudgetReport() {
  const { transactions, accounts, paymentMethods, budgets, loading, refresh } = useFinance();

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const [month, setMonth] = useState<string>("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const activeMonth = month || months[0] || "";
  const isCard = useMemo(() => makeIsCard(paymentMethods), [paymentMethods]);
  const majors = useMemo(() => expenseMajors(accounts), [accounts]);

  const saved = useMemo(() => budgetLinesOf(budgets, activeMonth), [budgets, activeMonth]);
  /** 초안이 없으면 저장된 값이 그대로 보인다 */
  const lines = draft ?? saved;

  // 달을 바꾸면 초안을 버린다 — 다른 달의 숫자가 섞이면 안 된다
  useEffect(() => {
    setDraft(null);
    setNotice(null);
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
    setNotice(null);
    try {
      const r = await saveFinBudget(activeMonth, draft);
      setDraft(null);
      setNotice({ kind: "ok", text: `${activeMonth} 예산 ${r.saved}줄을 저장했습니다.` });
      await refresh();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "저장에 실패했습니다." });
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
      setNotice({ kind: "error", text: `${prev} 에 저장된 예산이 없습니다.` });
      return;
    }
    setDraft({ ...prevLines });
    setNotice({ kind: "ok", text: `${prev} 예산 ${Object.keys(prevLines).length}줄을 불러왔습니다. 확인 후 저장하세요.` });
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
              <span className="text-zinc-300">—</span>
            ) : (
              <span className="pr-1 font-medium">{v.toLocaleString("ko-KR")}</span>
            );
          }
          const changed = draft && (saved[node.path] ?? 0) !== (draft[node.path] ?? 0);
          return (
            <input
              type="number"
              inputMode="numeric"
              value={lines[node.path] ?? ""}
              placeholder="0"
              onChange={(e) => setLine(node.path, Number(e.target.value))}
              className={`h-6 w-24 rounded border px-1.5 text-right text-xs tabular-nums outline-none focus:border-indigo-500 ${
                changed ? "border-amber-400 bg-amber-50" : "border-zinc-200"
              }`}
              aria-label={`${node.label} 예산`}
            />
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
        render: (node) => {
          const b = rolled[node.path] ?? 0;
          const a = node.value.expensePure;
          if (b === 0) return <span className="text-zinc-300">—</span>;
          const rate = a / b;
          return (
            <span className={`font-medium ${rateTone(rate, true)}`}>
              {(rate * 100).toFixed(0)}%
            </span>
          );
        },
        renderTotal: () => (
          <span className={rateTone(summary.rate, summary.budget > 0)}>
            {summary.budget > 0 ? `${(summary.rate * 100).toFixed(0)}%` : "—"}
          </span>
        ),
      },
    ],
    [rolled, lines, draft, saved, setLine, summary],
  );

  if (loading) {
    return <div className="px-5 py-16 text-center text-zinc-400">불러오는 중…</div>;
  }
  if (transactions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-8">
        <ReportTabs />
        <div className="mt-6">
          <EmptyState icon="🎯" title="아직 거래가 없습니다" description="결산과 비교할 실적이 있어야 예산이 의미를 가집니다." />
        </div>
      </div>
    );
  }

  const noSavedBudget = Object.keys(saved).length === 0 && !draft;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ReportTabs />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 cursor-pointer rounded-md border border-zinc-300 bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500"
          >
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="accent-indigo-600"
            />
            예산·지출 없는 계정도 보기
          </label>
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!prevMonth || saving}
            onClick={copyPrevious}
            title={prevMonth ? `${prevMonth} 예산을 복사` : "직전 달이 없습니다"}
          >
            지난달 예산 복사
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            disabled={dirtyKeys.length === 0 || saving}
            onClick={() => {
              setDraft(null);
              setNotice(null);
            }}
          >
            변경 취소
          </Button>
          <Button
            className="h-8 px-3 text-xs"
            disabled={dirtyKeys.length === 0 || saving}
            onClick={save}
          >
            {saving ? "저장 중…" : dirtyKeys.length > 0 ? `저장 (${dirtyKeys.length})` : "저장"}
          </Button>
        </div>
      </div>

      {noSavedBudget && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {activeMonth} 예산이 아직 없습니다. 소분류 칸에 금액을 넣거나{" "}
          {prevMonth ? <b>지난달 예산 복사</b> : "직전 달 예산을 먼저 만든 뒤 복사"}로 시작하세요.
          예산 없이도 결산은 그대로 보입니다.
        </p>
      )}

      {dirtyKeys.length > 0 ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          저장 안 된 예산 변경 <b>{dirtyKeys.length}줄</b> — 저장하면 {activeMonth} 예산이 이 값으로 바뀝니다.
        </p>
      ) : (
        notice && (
          <p
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
              notice.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {notice.text}
          </p>
        )
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="예산" value={summary.budget} hint={`${activeMonth} · 지출 계정`} />
        <StatTile label="결산" value={summary.actual} hint="개인사용·환급 차감" />
        <StatTile
          label="남은 예산"
          value={summary.remaining}
          hint={summary.remaining < 0 ? "예산 초과" : "집행 가능"}
        />
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-zinc-500">집행률</p>
          <p className={`mt-1 text-xl font-bold tracking-tight tabular-nums ${rateTone(summary.rate, summary.budget > 0)}`}>
            {summary.budget > 0 ? `${(summary.rate * 100).toFixed(0)}%` : "—"}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className={`h-full rounded-full ${summary.rate > 1 ? "bg-rose-500" : summary.rate > 0.9 ? "bg-amber-500" : "bg-indigo-500"}`}
              style={{ width: `${Math.min(100, Math.round(summary.rate * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            초과 {summary.overCount}개 계정
            {summary.unbudgetedCount > 0 && ` · 예산 없는 지출 ${summary.unbudgetedCount}개`}
          </p>
        </div>
      </div>

      {summary.unbudgetedCount > 0 && (
        <p className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          예산을 안 잡았는데 지출이 있는 계정 <b>{summary.unbudgetedCount}개</b> ·{" "}
          <Money value={summary.unbudgetedAmount} unit={false} />원. 계획에 없던 지출인지, 예산을
          빠뜨린 것인지 확인하세요 — 「예산·지출 없는 계정도 보기」를 끄면 이 계정들만 보입니다.
        </p>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionTitle hint="지출 계정만 · 결산 숫자를 누르면 원장이 그 조건으로 열립니다">
            계정별 예산 대비 결산
          </SectionTitle>
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
      </Card>
    </div>
  );
}
