"use client";

// ============================================================
//  재무 대시보드 — 자동 점검 띠
// ------------------------------------------------------------
//  프로그램이 사람 대신 본 것 네 가지를 한 줄로: 사람 없이 확정한 것 · 장부에 들어온
//  받을 돈 · 빠진 정기 지출 · 이 달 마감을 막는 것. 누르면 그 일을 하는 화면으로 간다.
//  전부 이 브라우저가 들고 있는 장부로 바로 센다 (서버를 따로 부르지 않는다).
// ============================================================

import { useMemo } from "react";
import { Bot, CalendarCheck, CalendarClock, HandCoins } from "lucide-react";
import { Badge, LinkTile } from "@/components/neander/ui";
import { useFinance } from "./FinanceProvider";
import { isEngineConfirmed } from "@/lib/neander/finance/trust";
import { matchReceipts } from "@/lib/neander/finance/receivables";
import { detectRecurring } from "@/lib/neander/finance/recurring";
import { blockingChecks, runMonthChecks } from "@/lib/neander/finance/close";
import { todayStrKST } from "@/lib/neander/format";

export function AutomationStrip({ month, className }: { month: string; className?: string }) {
  const { transactions, accounts, paymentMethods, projects, closes } = useFinance();
  const today = todayStrKST();
  const n = useMemo(() => {
    const auto = transactions.filter((t) => (t.date ?? "").startsWith(month) && isEngineConfirmed(t)).length;
    const total = transactions.filter((t) => (t.date ?? "").startsWith(month)).length;
    const receipts = matchReceipts({ projects, transactions, paymentMethods, today }).filter((m) => m.confidence !== "low").length;
    const missing = detectRecurring(transactions, paymentMethods, today).filter((s) => s.status === "missing").length;
    const checks = runMonthChecks({ month, transactions, accounts, paymentMethods });
    return { auto, total, receipts, missing, blocks: blockingChecks(checks).length, warns: checks.filter((c) => c.severity === "warn").length };
  }, [transactions, accounts, paymentMethods, projects, month, today]);
  const closed = closes.some((c) => c.month === month);

  return (
    <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className ?? ""}`}>
      <LinkTile
        href="/neander/finance/auto"
        icon={Bot}
        title="사람 없이 확정"
        sub={n.total ? `이 달 ${n.total.toLocaleString("ko-KR")}건 중` : "이 달 거래 없음"}
        badge={<Badge tone="accent">{n.auto.toLocaleString("ko-KR")}건</Badge>}
      />
      <LinkTile
        href="/neander/finance/auto#receipts"
        icon={HandCoins}
        title="장부에 들어온 받을 돈"
        sub={n.receipts ? "받음 처리만 남음" : "짝지을 입금 없음"}
        badge={n.receipts ? <Badge tone="success">{n.receipts}건</Badge> : undefined}
      />
      <LinkTile
        href="/neander/finance/auto#recurring"
        icon={CalendarClock}
        title="빠진 정기 지출"
        sub={n.missing ? "예정일이 지났는데 없음" : "빠진 것 없음"}
        badge={n.missing ? <Badge tone="warning">{n.missing}건</Badge> : undefined}
      />
      <LinkTile
        href="/neander/finance/close"
        icon={CalendarCheck}
        title={closed ? "이 달 마감됨" : "이 달 마감 준비"}
        sub={closed ? "마감 뒤 변동은 월 마감에서" : `막는 것 ${n.blocks} · 확인할 것 ${n.warns}`}
        badge={!closed && n.blocks ? <Badge tone="danger">막힘</Badge> : undefined}
      />
    </div>
  );
}
