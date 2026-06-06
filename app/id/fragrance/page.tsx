"use client";

// 악센트 아이디 - 향료 교체 주기.
import { useEffect, useState } from "react";

import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import { getFragrance } from "@/lib/db";
import type { FragranceReplacement } from "@/lib/types";
import { defaultFragrance } from "@/lib/defaults";
import { formatKoreanDate, parseYMD, todayYMD } from "@/lib/date";

// 다음 향료 교체일까지 남은 일수 (오늘 기준, 음수면 경과). 자정 기준 정수 일.
function daysUntil(ymd: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const target = parseYMD(ymd).getTime();
  const today = parseYMD(todayYMD()).getTime();
  return Math.round((target - today) / MS_PER_DAY);
}

// D-day 라벨 ("D-21" / "D-DAY" / "D+3")
function ddayLabel(days: number): string {
  if (days === 0) return "D-DAY";
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

export default function IdFragrancePage() {
  const [fragrance, setFragrance] =
    useState<FragranceReplacement>(defaultFragrance);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const frag = await getFragrance("id");
        if (!alive) return;
        if (frag) setFragrance(frag);
      } catch {
        // 패칭 실패 시 정적 폴백 유지
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const fragranceDays = daysUntil(fragrance.nextDate);

  return (
    <Section
      title="향료 교체 주기"
      subtitle="최근 교체일과 다음 예정일"
      action={
        <Badge color={fragranceDays <= 7 ? "red" : "blue"}>
          {ddayLabel(fragranceDays)}
        </Badge>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <div className="text-xs font-medium text-gray-500">최근 교체일</div>
          <div className="mt-0.5 text-base font-semibold text-gray-900">
            {formatKoreanDate(fragrance.recentDate)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <div className="text-xs font-medium text-gray-500">
            다음 교체 예정일
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-base font-semibold text-gray-900">
              {formatKoreanDate(fragrance.nextDate)}
            </span>
            <span
              className={
                "text-xs font-semibold " +
                (fragranceDays <= 7 ? "text-red-600" : "text-brand-dark")
              }
            >
              {fragranceDays >= 0
                ? `${fragranceDays}일 남음`
                : `${Math.abs(fragranceDays)}일 경과`}
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}
