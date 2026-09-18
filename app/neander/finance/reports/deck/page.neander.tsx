"use client";

// ============================================================
//  리포트 › 월간 보고 슬라이드 — 임원 회의에서 한 달을 발표한다
// ------------------------------------------------------------
//  /neander/finance/reports/deck?month=2026-08&basis=accrual&site=네안데르
//
//  지출상세 화면의 「슬라이드로 보기」가 지금 보고 있는 달·기준·사업장을
//  그대로 넘긴다. 발표 엔진은 회의 준비 자료와 같은 <Deck>(16:9 고정 캔버스)을
//  쓴다.
//
//  조작: ←/→/Space 넘기기 · F 전체화면 · [ / ] 이전·다음 달 · Esc 리포트로
// ============================================================

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { Deck } from "@/components/neander/deck/Deck";
import { Dialog, EmptyState, LoadingState, PageShell } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useInsight } from "@/components/neander/insights/useInsight";
import { InsightPanel } from "@/components/neander/insights/InsightPanel";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { buildMonthlyDeck } from "@/lib/neander/finance/monthlyDeck";
import { makeIsCard, type Basis } from "@/lib/neander/finance/report";
import { monthLabel } from "@/lib/neander/format";
import { buildSlides } from "./slides";

export default function MonthlyReportDeckPage() {
  return (
    <Suspense fallback={<LoadingState label="발표 자료를 만드는 중…" />}>
      <MonthlyReportDeck />
    </Suspense>
  );
}

function MonthlyReportDeck() {
  const router = useRouter();
  const sp = useSearchParams();
  const { transactions, paymentMethods, loading } = useFinance();

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const basis: Basis = sp.get("basis") === "cash" ? "cash" : "accrual";
  const site = sp.get("site") || undefined;
  const asked = sp.get("month") ?? "";
  const month = months.includes(asked) ? asked : months[0] ?? "";

  const isCard = useMemo(() => makeIsCard(paymentMethods), [paymentMethods]);
  const data = useMemo(
    () => (month ? buildMonthlyDeck(transactions, { month, basis, isCard, site }) : null),
    [transactions, month, basis, isCard, site],
  );
  const siteLabel = site ?? "전체 사업장";
  // 리포트 화면에서 만들고 고친 해설 — 화면과 같은 범위(사업장)로 읽는다.
  // 관리 창(InsightPanel)에 같은 상태를 넘겨, 창에서 고친 것이 곧바로 슬라이드에 보이게 한다
  const insightState = useInsight("finance", month || undefined, site);
  const insight = insightState.doc;
  const [manageOpen, setManageOpen] = useState(false);
  const slides = useMemo(
    () => (data ? buildSlides(data, { basis, siteLabel, site }, insight, () => setManageOpen(true)) : []),
    [data, basis, siteLabel, site, insight],
  );

  const hrefFor = (base: string, m: string) => {
    const q = new URLSearchParams({ month: m, basis });
    if (site) q.set("site", site);
    return `${base}?${q.toString()}`;
  };

  // [ 이전 달 · ] 다음 달 — 슬라이드 위치는 그대로 두고 숫자만 바꾼다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !month) return;
      const i = months.indexOf(month);
      const target = e.key === "[" ? months[i + 1] : e.key === "]" ? months[i - 1] : undefined;
      if (target) router.replace(hrefFor("/neander/finance/reports/deck", target));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, month, basis, site, router]);

  if (loading) return <LoadingState label="발표 자료를 만드는 중…" />;
  if (!data) {
    return (
      <PageShell>
        <EmptyState
          icon={BarChart3}
          title="발표할 거래가 없습니다"
          description="엑셀 임포트에서 장부를 올리면 월간 보고 슬라이드를 만들 수 있습니다."
        />
      </PageShell>
    );
  }

  return (
    <>
    <Deck
      meta={{
        title: `${monthLabel(month)} 재무 보고`,
        dateLabel: `${monthLabel(month)} 재무 보고`,
        presenter: siteLabel,
        accent: "#22d3ee",
        exitHref: hrefFor("/neander/finance/reports", month),
        // 재무 비서가 기간 없는 질문을 이 달 기준으로 답하게
        assistantContext: { module: "finance", month },
      }}
      slides={slides}
    />
    {/* 인사이트 관리 — 발표 화면 위에 리포트 화면과 같은 패널을 띄운다 */}
    <Dialog
      open={manageOpen}
      onClose={() => setManageOpen(false)}
      size="full"
      title={`${monthLabel(month)} 인사이트`}
      description={`${siteLabel} · 여기서 만들고 고친 내용이 슬라이드에 바로 반영됩니다`}
    >
      <InsightPanel module="finance" month={month} scope={site} insight={insightState} inDialog />
    </Dialog>
    </>
  );
}
