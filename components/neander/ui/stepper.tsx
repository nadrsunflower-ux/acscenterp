// ============================================================
//  Stepper — 여러 단계를 거치는 화면의 진행 표시 (임포트 · 월 마감)
// ------------------------------------------------------------
//  지금 어느 단계인지, 무엇이 끝났는지, 다음이 무엇인지를 한 줄로.
//  상태를 색에만 맡기지 않는다 — 끝난 단계는 체크 표시, 현재 단계는
//  번호와 굵은 글씨, 남은 단계는 옅은 번호다.
// ============================================================
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";

export interface Step {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
}

export function Stepper({
  steps,
  /** 현재 단계 인덱스 (0-base). 이 앞은 완료로 본다 */
  current,
  className,
  ariaLabel = "진행 단계",
}: {
  steps: Step[];
  current: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-3 gap-y-3", className)} aria-label={ariaLabel}>
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-3" aria-current={now ? "step" : undefined}>
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-nd-caption font-semibold",
                done && "bg-nd-accent text-white",
                now && "bg-nd-accent text-white",
                !done && !now && "bg-nd-sunken text-nd-fg-3",
              )}
            >
              {done ? <Icon icon={Check} size={16} /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-nd-body", now || done ? "font-semibold text-nd-fg" : "text-nd-fg-3")}>
                {s.label}
                <span className="sr-only">{done ? " (완료)" : now ? " (진행 중)" : " (예정)"}</span>
              </span>
              {s.hint && <span className="block truncate text-nd-caption text-nd-fg-3">{s.hint}</span>}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className={cn("hidden h-px min-w-6 flex-1 sm:block", done ? "bg-nd-accent" : "bg-nd-line")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
