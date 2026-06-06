"use client";

// 악센트 아이디 - 영업시간 (하위 기본 페이지). 헤더/서브네비는 app/id/layout.tsx.
import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import { hoursForStore } from "@/lib/content";

export default function IdHoursPage() {
  const idHours = hoursForStore("id");

  return (
    <Section
      title="영업시간"
      subtitle="요일/이벤트에 따라 기본 또는 확장 운영"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {idHours.map((h) => (
          <div
            key={h.label}
            className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <Badge color={h.label === "확장" ? "orange" : "brand"}>
                {h.label}
              </Badge>
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
