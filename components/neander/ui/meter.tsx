// ============================================================
//  Meter — 표 칸 안의 진행률 막대 (예산 집행률 · 공헌이익률 · 구성비)
// ------------------------------------------------------------
//  숫자를 대신하지 않고 **옆에 선다.** 막대만 두면 정확한 값을 읽을 수
//  없고, 색만으로 초과를 알리면 색을 못 보는 사람이 놓친다. 그래서
//  값(숫자)은 부르는 쪽이 같이 찍고, 초과분은 색과 함께 100%를 넘은
//  길이로도 드러난다.
// ============================================================
import { cn } from "./cn";

export function Meter({
  value,
  max = 1,
  /** 이 비율을 넘으면 경고색 (예산 100% 초과) */
  warnAbove,
  className,
  width = 96,
  label,
}: {
  value: number | null | undefined;
  max?: number;
  warnAbove?: number;
  className?: string;
  width?: number;
  /** 낭독기용 이름. 옆에 숫자를 함께 찍을 때는 생략(중복) */
  label?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value) || max <= 0) {
    return <span className={cn("inline-block rounded-full bg-nd-sunken", className)} style={{ width, height: 6 }} aria-hidden />;
  }
  const r = value / max;
  const over = warnAbove !== undefined && r > warnAbove;
  return (
    <span
      className={cn("inline-block overflow-hidden rounded-full bg-nd-fg/[.08] align-middle", className)}
      style={{ width, height: 6 }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span
        className={cn("block h-full rounded-full", over ? "bg-nd-danger" : "bg-nd-accent")}
        style={{ width: `${Math.max(0, Math.min(100, r * 100))}%` }}
      />
    </span>
  );
}
