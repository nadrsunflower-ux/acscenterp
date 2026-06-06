"use client";

// 악센트 아이디 - 기타 운영 가이드 (매장 와이파이 + 재고 위치).
import Section from "@/components/ui/Section";
import ImageBlock from "@/components/ui/ImageBlock";
import CopyField from "@/components/id/CopyField";
import { wifi, stockLocations } from "@/lib/content";

export default function IdGuidePage() {
  return (
    <div className="space-y-6">
      {/* 매장 와이파이 */}
      <Section title="매장 와이파이" subtitle="고객 안내용">
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="네트워크 이름 (SSID)" value={wifi.ssid} />
          <CopyField label="비밀번호" value={wifi.password} mono />
        </div>
      </Section>

      {/* 재고 위치 */}
      <Section title="재고 위치" subtitle="매장 내 재고 보관 위치">
        <div className="grid gap-4 sm:grid-cols-3">
          {stockLocations.map((loc) => (
            <ImageBlock key={loc.label} src={loc.image} label={loc.label} />
          ))}
        </div>
      </Section>
    </div>
  );
}
