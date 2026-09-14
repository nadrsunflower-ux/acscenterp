"use client";

// ============================================================
//  MasterDetail — 왼쪽 목록 · 오른쪽 상세
//  (재무 마스터 · 매출 상품 관리 · 매출 마스터 · 이벤트 입력)
// ------------------------------------------------------------
//  목업의 「목록에서 고르면 옆에서 처리한다」 배치. 한 항목을 처리하려고
//  화면을 떠났다 돌아오지 않아도 되는 것이 요점이다.
//
//  좁은 화면에서는 두 판이 나란히 설 자리가 없다. 목록만 보여주고, 고른
//  항목이 있으면 상세로 **바꿔** 그린다 (겹치거나 잘리지 않게).
//
//  ⚠️ 어느 쪽을 그릴지 자바스크립트 미디어쿼리로 정하지 않는다. 서버에서
//     그릴 때는 화면 폭을 모르니 한 번 틀리게 그린 뒤 붙자마자 바뀌고,
//     그 사이 한 프레임 동안 배치가 튄다. 그래서 **양쪽을 늘 그려 두고
//     CSS 로 감춘다** — 서버와 브라우저가 같은 것을 그린다.
// ============================================================
import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";

export function MasterDetail({
  list,
  detail,
  /** 고른 항목이 있는가 — 좁은 화면에서 어느 쪽을 보일지 정한다 */
  selected,
  onBack,
  backLabel = "목록으로",
  /** 목록 판의 폭 (lg 이상). 기본 380px */
  listWidth = 380,
  className,
}: {
  list: ReactNode;
  detail: ReactNode;
  selected: boolean;
  onBack?: () => void;
  backLabel?: string;
  listWidth?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        "lg:grid lg:items-start lg:gap-4 lg:[grid-template-columns:minmax(0,var(--nd-md-list))_minmax(0,1fr)]",
        className,
      )}
      style={{ "--nd-md-list": `${listWidth}px` } as CSSProperties}
    >
      <div className={cn("min-w-0", selected && "max-lg:hidden")}>{list}</div>
      <div className={cn("min-w-0", !selected && "max-lg:hidden")}>
        {onBack && selected && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex h-ctl-md w-fit items-center gap-1 rounded-full border border-nd-border bg-nd-content px-3 text-nd-body font-medium text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-sunken hover:text-nd-fg lg:hidden"
          >
            <Icon icon={ChevronLeft} size={16} />
            {backLabel}
          </button>
        )}
        {detail}
      </div>
    </div>
  );
}
