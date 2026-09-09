// ============================================================
//  아이콘 — lucide-react 선형 아이콘을 한 굵기·한 크기 규칙으로
// ------------------------------------------------------------
//  획 1.75, 기본 16px. 텍스트 옆에 놓일 때 x-height 와 맞는 크기다.
//  장식용이면 aria-hidden, 의미를 전달하면 label 을 준다.
// ============================================================
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "./cn";

export type { LucideIcon };

export function Icon({
  icon: I,
  size = 16,
  strokeWidth = 1.75,
  className,
  label,
  ...rest
}: {
  icon: LucideIcon;
  size?: number;
  /** 접근 가능한 이름. 없으면 장식으로 취급해 숨긴다 */
  label?: string;
} & Omit<LucideProps, "ref" | "size">) {
  return (
    <I
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...rest}
    />
  );
}
