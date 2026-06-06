"use client";

// 악센트 아이디 - 매장 이벤트 (할인·증정 프로모션).
import { useEffect, useState } from "react";

import Section from "@/components/ui/Section";
import PromotionCard from "@/components/ui/PromotionCard";
import { listPromotions } from "@/lib/db";
import type { Promotion } from "@/lib/types";
import { defaultPromotions } from "@/lib/defaults";

const FALLBACK_PROMOTIONS = defaultPromotions.filter((p) => p.store === "id");

export default function IdEventsPage() {
  const [promotions, setPromotions] =
    useState<Promotion[]>(FALLBACK_PROMOTIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const promos = await listPromotions("id");
        if (!alive) return;
        if (promos.length > 0) setPromotions(promos.filter((p) => p.active));
      } catch {
        // 패칭 실패 시 정적 폴백 유지
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Section
      title="매장 이벤트"
      subtitle={`진행 중 ${promotions.length}건${loaded ? "" : " · 불러오는 중…"}`}
    >
      {promotions.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {promotions.map((p) => (
            <PromotionCard key={p.id} promotion={p} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">진행 중인 이벤트가 없습니다.</p>
      )}
    </Section>
  );
}
