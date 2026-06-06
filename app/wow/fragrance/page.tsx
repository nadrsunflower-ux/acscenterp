"use client";

// 악센트 와우 - 향료 교체.
import { useEffect, useState } from "react";

import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import { getFragrance } from "@/lib/db";
import type { FragranceReplacement } from "@/lib/types";
import { formatKoreanDate, parseYMD, todayYMD } from "@/lib/date";

// 다음 향료 교체일까지 남은 일수 (오늘 기준, 음수면 경과).
function daysUntil(ymd: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const target = parseYMD(ymd).getTime();
  const today = parseYMD(todayYMD()).getTime();
  return Math.round((target - today) / MS_PER_DAY);
}

function ddayLabel(days: number): string {
  if (days === 0) return "D-DAY";
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

export default function WowFragrancePage() {
  const [fragrance, setFragrance] = useState<FragranceReplacement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const frag = await getFragrance("wow");
        if (!alive) return;
        if (frag) setFragrance(frag);
      } catch {
        // 무시
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!fragrance) {
    return (
      <Section title="향료 교체 주기" subtitle="최근 교체일과 다음 예정일">
        <p className="text-sm text-gray-400">
          {loaded
            ? "아직 등록된 향료 교체일이 없습니다. 관리자 페이지(향료 교체일 탭 → 와우 선택)에서 등록할 수 있습니다."
            : "불러오는 중…"}
        </p>
      </Section>
    );
  }

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
