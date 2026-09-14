// ============================================================
//  금액 표시 — Money · StatTile
// ------------------------------------------------------------
//  금액의 부호는 색에만 맡기지 않는다. 음수는 △ 표기를 함께 단다.
//  숫자는 tabular-nums(nd-num)라 자릿수가 위아래로 맞는다.
//
//  ⚠️ 재무 폴더에 있던 것을 여기로 옮겼다. 같은 회사의 같은 성격의
//     숫자를 매출도 찍는데, 두 모듈이 다른 서체·다른 음수 표기를 쓰면
//     같은 화면을 번갈아 보는 사람이 매번 다시 적응해야 한다.
// ============================================================
import type { ReactNode } from "react";
import { formatSigned } from "@/lib/neander/format";
import { cn } from "./cn";
import { KpiItem } from "./metric";
import type { Tone } from "./badge";

/** 금액 표시. 음수는 △ + 붉은 글씨(색 단독에 의존하지 않음). */
export function Money({
  value,
  className,
  unit = true,
  muted = false,
}: {
  value: number;
  className?: string;
  unit?: boolean;
  muted?: boolean;
}) {
  const neg = value < 0;
  return (
    <span
      className={cn(
        "nd-num",
        neg ? "text-nd-danger-text" : muted ? "text-nd-fg-3" : "text-nd-fg",
        className,
      )}
    >
      {formatSigned(value)}
      {unit && <span className="ml-0.5 text-[0.85em] font-normal text-nd-fg-3">원</span>}
    </span>
  );
}

/**
 * 금액 KPI 타일 — 헤드라인 숫자 몇 개를 나란히 놓을 때.
 * KpiStrip 안에 놓으면 한 표면에 얇은 선으로 나뉜다.
 * (비율은 RatioTile, 건수는 KpiItem)
 */
export function StatTile({
  label,
  value,
  hint,
  accent,
  tone,
  size = "md",
  tag,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
  /** 계열 식별 점 색 (hex) */
  accent?: string;
  tone?: Tone;
  size?: "md" | "lg";
  /** 숫자 옆 작은 태그 (예: 손실) */
  tag?: ReactNode;
}) {
  return (
    <KpiItem
      tag={tag}
      label={label}
      value={<Money value={value} unit={false} />}
      unit="원"
      hint={hint}
      marker={accent}
      tone={tone}
      size={size}
    />
  );
}

/** 계열 범례 — 계열이 2개 이상이면 항상 표시한다 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: i.color }}
            aria-hidden
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}
