"use client";

// 악센트 와우 - 영업시간 (하위 기본 페이지). 헤더/서브네비는 app/wow/layout.tsx.
import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import { hoursForStore } from "@/lib/content";

export default function WowHoursPage() {
  const wowHours = hoursForStore("wow");

  return (
    <Section title="영업시간" subtitle="와우 매장 운영시간 안내">
      <div className="grid gap-3 sm:grid-cols-2">
        {wowHours.map((h) => (
          <div
            key={h.label}
            className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <Badge color="gray">{h.label}</Badge>
              <span className="text-sm text-gray-500">운영</span>
            </div>
            <span className="text-base font-semibold text-gray-900">
              {h.start} ~ {h.end}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
