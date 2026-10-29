"use client";

// ============================================================
//  납기 칸 — 날짜 옆에 남은 날(D-9 · 오늘 · 3일 지남)
// ------------------------------------------------------------
//  프로젝트 목록과 홈의 진행 중 표가 같이 쓴다. 일주일 안이면 주황,
//  지났으면 빨강 — 색만으로 알리지 않고 「D-3」 「지남」 글자가 늘 함께 붙는다.
// ============================================================

import { cn } from "@/components/neander/ui";
import { deliveryCountdown, type FinProjectDoc } from "@/lib/neander/finance/project";

/** 남은 날이 이만큼 이하면 「곧」 으로 칠한다 */
const SOON_DAYS = 7;

export function DeliveryDate({
  project,
  className,
}: {
  project: Pick<FinProjectDoc, "deliveryDate" | "status">;
  className?: string;
}) {
  if (!project.deliveryDate) return <span className="text-nd-fg-4">—</span>;
  const left = deliveryCountdown(project);
  const soon = left && !left.late && left.days <= SOON_DAYS;
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {project.deliveryDate}
      {left && (
        <span
          className={cn(
            "ml-1.5 font-medium",
            left.late ? "text-nd-danger-text" : soon ? "text-nd-warning-text" : "text-nd-fg-3",
          )}
        >
          {left.text}
        </span>
      )}
    </span>
  );
}
