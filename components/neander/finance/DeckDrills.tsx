"use client";

// ============================================================
//  재무 보고 슬라이드의 숫자 드릴 — 올리면 미리보기, 누르면 전체 내역 창
// ------------------------------------------------------------
//  리포트 화면의 TxDrill(NodePreview.tsx)을 발표 화면에서도 쓴다. 회의 중
//  "이 지출 뭐야?"에 슬라이드를 떠나지 않고 답하려는 것이다. 매출 슬라이드의
//  DeckDrills(components/neander/sales/DeckDrills.tsx)와 같은 손놀림이다.
//
//  ⚠️ 창 합계는 슬라이드 숫자와 원 단위로 같아야 한다. 그래서 거르는 규칙을
//     슬라이드 숫자를 만드는 lib/neander/finance/monthlyDeck.ts 와 똑같이 둔다:
//       수입·지출 계정   buildReport(같은 기준·같은 사업장) 트리의 그 노드
//       사업부           그 달·사업장 거래 중 사업대·소분류가 같은 것 + 기준(inBasis)
//       거래처           순수지출 — 수입·개인사용·인건비 제외, 환급은 차감
// ============================================================

import { useMemo, type ReactNode } from "react";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  buildReport,
  inBasis,
  inScope,
  makeIsCard,
  type Basis,
  type Report,
  type TreeNode,
} from "@/lib/neander/finance/report";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";
import type { DeckLine } from "@/lib/neander/finance/monthlyDeck";
import { monthLabel } from "@/lib/neander/format";
import { useFinance } from "./FinanceProvider";
import { columnAmount, nodeDrill, TxDrill } from "./NodePreview";

/** 발표 한 판의 조건 — 슬라이드 페이지가 buildMonthlyDeck 에 넘긴 것과 같게 */
export interface FinDeckScope {
  month: string;
  basis: Basis;
  /** 사업장 — 비우면 전체 */
  site?: string;
}

/** 달별 리포트를 한 번씩만 센다 (추이 여섯 달 × 칸 수만큼 다시 돌지 않게) */
function useDeckReport(scope: FinDeckScope) {
  const { transactions, paymentMethods } = useFinance();
  const isCard = useMemo(() => makeIsCard(paymentMethods), [paymentMethods]);
  return useMemo(() => {
    const cache = new Map<string, Report>();
    const report = (m: string) => {
      if (!cache.has(m)) {
        cache.set(m, buildReport(transactions, { basis: scope.basis, isCard, scope: { month: m, site: scope.site } }));
      }
      return cache.get(m)!;
    };
    return { report, isCard, transactions };
  }, [transactions, isCard, scope.basis, scope.site]);
}

const siteSuffix = (site?: string) => (site ? ` · ${site}` : "");

/** 트리에서 경로(`대` · `대|중`)로 노드 찾기 */
function findNode(roots: TreeNode[], path: string): TreeNode | undefined {
  for (const r of roots) {
    if (r.path === path) return r;
    const mid = r.children.find((c) => c.path === path);
    if (mid) return mid;
  }
  return undefined;
}

const common = { tone: "dark" as const };

// ---- 핵심 요약 · 월별 추이 ----------------------------------------

export type FinTotalCol = "income" | "expense" | "expensePure" | "net";

const COL_LABEL: Record<FinTotalCol, string> = {
  income: "수입",
  expense: "지출 총액",
  expensePure: "순수지출",
  net: "순금액",
};

/** 한 달 전체의 수입·지출·순금액 (month 를 주면 추이의 그 달) */
export function FinTotalDrill({
  scope,
  col,
  month,
  children,
}: {
  scope: FinDeckScope;
  col: FinTotalCol;
  month?: string;
  children: ReactNode;
}) {
  const { report } = useDeckReport(scope);
  const m = month ?? scope.month;
  return (
    <TxDrill
      {...common}
      title={`${monthLabel(m)} ${COL_LABEL[col]}`}
      subtitle={`전체 계정${siteSuffix(scope.site)}`}
      href={ledgerHref({ month: m, site: scope.site })}
      {...nodeDrill({ children: report(m).roots, rows: [] }, col)}
    >
      {children}
    </TxDrill>
  );
}

// ---- 수입 구성 · 지출 구성 · 전월 대비 변동 --------------------------

/**
 * 계정 한 줄 (BarRows 의 줄). line.parent 가 있으면 중분류(`대|중`), 없으면 대분류.
 * col — 수입 구성은 income, 지출 구성·전월 대비는 expensePure.
 */
export function FinAccountLineDrill({
  scope,
  line,
  col,
  children,
}: {
  scope: FinDeckScope;
  line: DeckLine;
  col: "income" | "expensePure";
  children: ReactNode;
}) {
  const { report } = useDeckReport(scope);
  const path = line.parent ? `${line.parent}|${line.label}` : line.label;
  const node = findNode(report(scope.month).roots, path);
  // 「기타 N개 계정」 묶음 줄이나 이번 달에 0원이 된 계정은 열 거래가 없다
  if (!node) return <>{children}</>;
  return (
    <TxDrill
      {...common}
      title={line.parent ? `${line.parent} › ${line.label}` : line.label}
      subtitle={`${monthLabel(scope.month)} · ${col === "income" ? "수입" : "순수지출"}${siteSuffix(scope.site)}`}
      href={ledgerHref({
        month: scope.month,
        site: scope.site,
        acctMajor: node.major,
        acctMid: node.level >= 1 ? node.mid : undefined,
      })}
      {...nodeDrill(node, col)}
    >
      {children}
    </TxDrill>
  );
}

// ---- 사업부별 손익 --------------------------------------------------

/** DeckUnit.label(`사업대 · 사업소`, 빈 값은 「(미정)」)을 원래 값으로 */
function splitUnit(label: string) {
  const [a = "", b = ""] = label.split(" · ");
  const un = (v: string) => (v === "(미정)" ? "" : v);
  return { bizMajor: un(a), bizMinor: un(b) };
}

export function FinUnitDrill({
  scope,
  label,
  col,
  children,
}: {
  scope: FinDeckScope;
  label: string;
  col: "income" | "expensePure" | "net";
  children: ReactNode;
}) {
  const { isCard, transactions } = useDeckReport(scope);
  const { bizMajor, bizMinor } = splitUnit(label);
  // monthlyDeck 과 같은 거름 — 그 달·사업장 · 사업대·소분류 일치 · 기준(발생/현금)
  const rows = () =>
    transactions.filter(
      (t) =>
        inScope(t, { month: scope.month, site: scope.site }) &&
        (t.bizMajor ?? "") === bizMajor &&
        (t.bizMinor ?? "") === bizMinor &&
        inBasis(t, scope.basis, isCard) &&
        columnAmount(col, t) !== null,
    );
  return (
    <TxDrill
      {...common}
      title={`${label} · ${col === "income" ? "수입" : col === "net" ? "순손익" : "순수지출"}`}
      subtitle={`${monthLabel(scope.month)}${siteSuffix(scope.site)}`}
      href={ledgerHref({ month: scope.month, site: scope.site, bizMajor, bizMinor })}
      rows={rows}
      amountOf={(t) => columnAmount(col, t) ?? 0}
      flow={col === "income" ? "income" : col === "net" ? "net" : "expense"}
    >
      {children}
    </TxDrill>
  );
}

// ---- 지출 상위 거래처 -----------------------------------------------

const LABOR = "인건비";

export function FinVendorDrill({ scope, vendor, children }: { scope: FinDeckScope; vendor: string; children: ReactNode }) {
  const { report } = useDeckReport(scope);
  // monthlyDeck 거래처 순위와 같은 거름 — 이번 달 트리의 거래 중 수입·개인사용·인건비 제외
  const rows = (): FinTransaction[] =>
    report(scope.month)
      .roots.flatMap((r) => r.children.flatMap((m) => m.children.flatMap((l) => l.rows)))
      .filter(
        (t) =>
          t.txType !== "수입" &&
          !t.personalUse &&
          t.acctMajor !== LABOR &&
          (t.vendor?.trim() || "(거래처 없음)") === vendor,
      );
  return (
    <TxDrill
      {...common}
      title={vendor}
      subtitle={`${monthLabel(scope.month)} · 순수지출 (환급 차감)${siteSuffix(scope.site)}`}
      href={ledgerHref({ month: scope.month, site: scope.site, vendor: vendor === "(거래처 없음)" ? undefined : vendor })}
      rows={rows}
      amountOf={(t) => (t.txType === "환급" ? -netAmount(t) : netAmount(t))}
      flow="expense"
    >
      {children}
    </TxDrill>
  );
}
