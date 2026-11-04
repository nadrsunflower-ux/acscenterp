"use client";

// 금액 + 「원」 — 공용 Money 는 단위를 0.85em 으로 줄여 작은 칸에서 13px 아래가 된다.
// AI STUDIO 는 13px 이상만 쓰므로 단위를 13px 로 따로 붙인다 (색 · 부호 규칙은 Money 그대로).
import { Money, cn, type MoneyFlow } from "@/components/neander/ui";

export function Won({ value, flow, className }: { value: number; flow?: MoneyFlow; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <Money value={value} flow={flow} unit={false} />
      <span className="ml-0.5 text-[13px] font-normal text-nd-fg-3">원</span>
    </span>
  );
}
