"use client";

// ============================================================
//  자동 코드 칸 — 고칠 수 없는 코드를 입력칸 자리에 보여 준다
// ------------------------------------------------------------
//  코드는 저절로 붙고(lib/neander/finance/codes.ts) 원장 거래가 그 글자로 이어져
//  있어 고치지 않는다. 입력칸처럼 생기면 고쳐 보려고 누르게 되니, 같은 높이의
//  점선 상자에 「자동」 표시를 붙인다 — 폼 한 줄에서 옆 칸과 높이가 맞는다.
// ============================================================

import { cn } from "@/components/neander/ui";

/** tag — 새로 만들 때는 「자동」, 이미 붙은 코드는 「고정」 (예전 코드는 사람이 지은 것이라 「자동」 이 아니다) */
export function AutoCodeBox({
  code,
  size = "md",
  tag = "자동",
  className,
}: {
  code?: string;
  size?: "sm" | "md";
  tag?: string;
  className?: string;
}) {
  return (
    <div
      role="textbox"
      aria-readonly
      aria-label={code ? `코드 ${code} (${tag})` : "코드 없음"}
      className={cn(
        "flex w-full items-center gap-2 border border-dashed border-nd-border bg-nd-sunken font-mono text-nd-fg",
        size === "sm" ? "h-ctl-sm rounded-[8px] px-2.5 text-[13px]" : "h-ctl-md rounded-nd-md px-3 text-nd-body",
        className,
      )}
    >
      <span className="min-w-0 truncate">{code || "—"}</span>
      <span className="ml-auto shrink-0 font-sans text-nd-caption text-nd-fg-3">{tag}</span>
    </div>
  );
}
