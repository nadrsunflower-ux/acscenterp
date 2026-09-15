"use client";

// ============================================================
//  매출 › 리포트 › 월간 보고 슬라이드 — 임원 회의에서 한 달을 발표한다
// ------------------------------------------------------------
//  /neander/sales/reports/deck?month=2026-08
//
//  매출 리포트의 「슬라이드로 보기」가 보고 있는 달을 넘긴다. 발표 엔진은
//  재무 리포트·회의 준비 자료와 같은 <Deck>(16:9 고정 캔버스)이다.
//
//  조작: ←/→/Space 넘기기 · F 전체화면 · [ / ] 이전·다음 달 · Esc 리포트로
// ============================================================

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { Deck } from "@/components/neander/deck/Deck";
import { Dialog, EmptyState, LoadingState, PageShell } from "@/components/neander/ui";
import { useSales } from "@/components/neander/sales/SalesProvider";
import { useInsight } from "@/components/neander/insights/useInsight";
import { InsightPanel } from "@/components/neander/insights/InsightPanel";
import { availableMonths } from "@/lib/neander/sales/aggregate";
import { buildSalesDeck } from "@/lib/neander/sales/monthlyDeck";
import { monthLabel } from "@/lib/neander/format";
import { buildSalesSlides } from "./slides";

export default function SalesReportDeckPage() {
  return (
    <Suspense fallback={<LoadingState label="발표 자료를 만드는 중…" />}>
      <SalesReportDeck />
    </Suspense>
  );
}

function SalesReportDeck() {
  const router = useRouter();
  const sp = useSearchParams();
  const { lines, products, events, assumptions, loading, labor } = useSales();
  const laborCtx = useMemo(() => ({ actuals: labor }), [labor]);

  const months = useMemo(() => availableMonths(lines, events), [lines, events]);
  const asked = sp.get("month") ?? "";
  const month = months.includes(asked) ? asked : months[0] ?? "";

  const data = useMemo(
    () => (month ? buildSalesDeck(month, lines, products, events, assumptions, laborCtx) : null),
    [month, lines, products, events, assumptions, laborCtx],
  );
  // 리포트 화면에서 만들고 고친 해설 — 발표 중에 AI 를 부르지 않는다(만들기는 사람이 누를 때만).
  // 관리 창(InsightPanel)에 같은 상태를 넘겨, 창에서 고친 것이 곧바로 슬라이드에 보이게 한다
  const insightState = useInsight("sales", month || undefined);
  const insight = insightState.doc;
  const [manageOpen, setManageOpen] = useState(false);
  const slides = useMemo(
    () => (data ? buildSalesSlides(data, insight, () => setManageOpen(true)) : []),
    [data, insight],
  );

  // [ 이전 달 · ] 다음 달 — 슬라이드 위치는 그대로 두고 숫자만 바꾼다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !month) return;
      const i = months.indexOf(month);
      const target = e.key === "[" ? months[i + 1] : e.key === "]" ? months[i - 1] : undefined;
      if (target) router.replace(`/neander/sales/reports/deck?month=${target}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [months, month, router]);

  if (loading) return <LoadingState label="발표 자료를 만드는 중…" />;
  if (!data) {
    return (
      <PageShell>
        <EmptyState
          icon={TrendingUp}
          title="발표할 판매가 없습니다"
          description="매출 적재에서 판매 파일을 올리면 월간 보고 슬라이드를 만들 수 있습니다."
        />
      </PageShell>
    );
  }

  return (
    <>
      <Deck
        meta={{
          title: `${monthLabel(month)} 매출 보고`,
          dateLabel: `${monthLabel(month)} 매출 보고`,
          presenter: "판매 실적 기준",
          accent: "#fb923c",
          exitHref: `/neander/sales/reports?month=${month}`,
          // 매출 비서가 기간 없는 질문을 이 달 기준으로 답하게
          assistantContext: { module: "sales", month },
        }}
        slides={slides}
      />
      {/* 인사이트 관리 — 발표 화면 위에 리포트 화면과 같은 패널을 띄운다 */}
      <Dialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        size="full"
        title={`${monthLabel(month)} 인사이트`}
        description="판매 실적 기준 · 여기서 만들고 고친 내용이 슬라이드에 바로 반영됩니다"
      >
        <InsightPanel module="sales" month={month} insight={insightState} />
      </Dialog>
    </>
  );
}
