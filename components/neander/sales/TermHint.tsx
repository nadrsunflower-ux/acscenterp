"use client";

// ============================================================
//  매출 용어 풀이 — 「공헌이익」 옆 작은 물음표
// ------------------------------------------------------------
//  공헌이익·공헌이익률·영업이익은 회계를 배우지 않은 사람에게는 낯설다.
//  계산 기준 판(InfoPopover)은 한 번 열어 읽는 곳이고, 표를 보다 "이게 뭐였지"
//  싶은 순간에는 그 단어 바로 옆에서 답해야 한다. 커서를 두거나 키보드로
//  초점을 옮기면 풀이가 뜬다 (Tooltip).
//
//  풀이는 여기 한 곳에만 둔다 — 화면마다 다르게 적으면 같은 말이 다른 뜻이 된다.
//  계산은 lib/neander/sales/aggregate.ts buildPnl 과 같아야 한다.
// ============================================================

import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Icon, Tooltip } from "@/components/neander/ui";

export const SALES_TERMS = {
  공헌이익: {
    short: "팔아서 직접 남긴 돈",
    desc: "확정 매출에서 변동비(재료비 · 이벤트·제작 인건비 · 준비물 · 결제 수수료)를 뺀 금액. 임대료·상시 인건비 같은 고정비를 내기 전, 판매가 직접 벌어 온 이익입니다.",
    formula: "확정 매출 − 변동비",
  },
  공헌이익률: {
    short: "매출 1만원당 남는 몫",
    desc: "공헌이익을 확정 매출로 나눈 비율. 80%면 1만원어치 팔 때 8,000원이 고정비를 내고 이익을 만드는 데 쓰입니다. 높을수록 파는 만큼 많이 남습니다.",
    formula: "공헌이익 ÷ 확정 매출",
  },
  영업이익: {
    short: "매장이 실제로 남긴 돈",
    desc: "공헌이익에서 고정비(공통 고정비 배부 + 상시 인건비)까지 뺀 금액. 음수면 판매로 번 돈이 매장 유지비를 못 채운 달입니다.",
    formula: "공헌이익 − 고정비",
  },
} as const;

export type SalesTerm = keyof typeof SALES_TERMS;

/** 용어 + 물음표. 표 머리글·KPI 라벨에 그대로 넣는다 */
export function TermLabel({ term, children }: { term: SalesTerm; children?: ReactNode }) {
  const t = SALES_TERMS[term];
  return (
    <span className="inline-flex items-center gap-1">
      {children ?? term}
      <Tooltip
        delay={150}
        label={
          <span className="block text-left">
            <span className="block font-semibold">
              {term} <span className="font-normal opacity-75">· {t.short}</span>
            </span>
            <span className="mt-1 block leading-relaxed">{t.desc}</span>
            <span className="mt-1.5 block font-medium opacity-90">= {t.formula}</span>
          </span>
        }
      >
        <span
          tabIndex={0}
          role="img"
          // 정렬 머리글 안에 있어도 물음표를 누른 것으로 정렬이 바뀌지 않게
          onClick={(e) => e.stopPropagation()}
          aria-label={`${term} 뜻: ${t.formula}`}
          // 머리글 글자색·굵기를 물려받지 않게 — 물음표는 늘 옅게
          className="inline-flex cursor-help items-center rounded-full font-normal text-nd-fg-3 outline-none transition-colors duration-nd-fast hover:text-nd-fg-2 focus-visible:text-nd-fg-2"
        >
          <Icon icon={CircleHelp} size={13} />
        </span>
      </Tooltip>
    </span>
  );
}
