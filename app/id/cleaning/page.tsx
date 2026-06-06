"use client";

// 악센트 아이디 - 기본 청소 가이드 (구역별 항목).
import { useEffect, useState } from "react";

import Section from "@/components/ui/Section";
import { getCleaning } from "@/lib/db";
import type { CleaningZone } from "@/lib/types";

export default function IdCleaningPage() {
  const [cleaningZones, setCleaningZones] = useState<CleaningZone[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const clean = await getCleaning("id");
        if (!alive) return;
        if (clean?.zones) setCleaningZones(clean.zones);
      } catch {
        // 패칭 실패 시 빈 상태 유지
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Section title="기본 청소 가이드" subtitle="구역별 청소 항목">
      {cleaningZones.length > 0 ? (
        <div className="space-y-4">
          {cleaningZones.map((zone, zi) => (
            <div key={zi}>
              <h3 className="mb-1.5 text-sm font-bold text-gray-900">
                {zone.name}
              </h3>
              {zone.items.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
                  {zone.items.map((item, ii) => (
                    <li key={ii}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="pl-1 text-sm text-gray-400">등록된 항목 없음</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          {loaded
            ? "아직 등록된 청소 가이드가 없습니다. 관리자 페이지(청소 가이드 탭)에서 등록할 수 있습니다."
            : "불러오는 중…"}
        </p>
      )}
    </Section>
  );
}
