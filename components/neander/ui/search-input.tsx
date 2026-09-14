"use client";

// ============================================================
//  SearchInput — 돋보기가 붙은 검색칸
// ------------------------------------------------------------
//  화면마다 `relative + Input pl-8 + 절대배치 아이콘` 을 손으로 조합하고
//  있었다 (재무 마스터·매출 상품 관리). 폭·아이콘 위치·지우기 버튼이
//  제각각이라 여기서 한 벌로 만든다.
//
//  type="search" 라 낭독기가 검색칸으로 읽고, 값이 있으면 지우기 버튼이
//  나타난다 (터치에서 전체 선택 후 삭제하기 어렵다).
// ============================================================
import { Search, X } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";
import { Input, type ControlSize } from "./field";

export function SearchInput({
  value,
  onValueChange,
  placeholder = "검색",
  ariaLabel,
  size = "sm",
  className,
  id,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  size?: ControlSize;
  className?: string;
  id?: string;
}) {
  return (
    <span className={cn("relative inline-block", className?.includes("w-") ? className : cn("w-full", className))}>
      <Icon
        icon={Search}
        size={size === "sm" ? 14 : 16}
        className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-nd-fg-3", size === "sm" ? "left-2.5" : "left-3")}
      />
      <Input
        id={id}
        type="search"
        size={size}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cn("w-full", size === "sm" ? "pl-8 pr-7" : "pl-9 pr-8", "[&::-webkit-search-cancel-button]:hidden")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label="검색어 지우기"
          className={cn(
            "absolute top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-nd-fg-3 transition-colors duration-nd-fast hover:bg-nd-fg/[.08] hover:text-nd-fg",
            size === "sm" ? "right-1.5" : "right-2",
          )}
        >
          <Icon icon={X} size={13} />
        </button>
      )}
    </span>
  );
}
