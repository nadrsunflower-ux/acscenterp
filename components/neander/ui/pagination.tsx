"use client";

// ============================================================
//  Pagination — 「총 n건 · ‹ 1 › · 50개씩 보기」 한 줄
// ------------------------------------------------------------
//  목업의 모든 목록 화면이 표 아래에 같은 줄을 둔다. 지금까지는 화면마다
//  손으로 만들어 버튼 크기와 문구가 제각각이었다 (재무 검토는 수기 버튼,
//  재무 마스터는 없음). 여기서 한 번만 정한다.
//
//  전체 건수는 늘 왼쪽에 남는다 — 몇 건인지가 페이지 번호보다 중요하다.
// ============================================================
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";
import { Select } from "./field";

export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [50, 100, 200],
  /** 건수 단위 (기본 "건") */
  unit = "건",
  className,
}: {
  total: number;
  /** 1-base */
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (n: number) => void;
  pageSizeOptions?: number[];
  unit?: string;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  const btn =
    "inline-flex h-ctl-sm w-8 items-center justify-center rounded-[8px] text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg disabled:cursor-not-allowed disabled:opacity-35";
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-nd-caption text-nd-fg-2", className)}>
      <span>
        총 <span className="nd-num font-semibold text-nd-fg">{total.toLocaleString("ko-KR")}</span>
        {unit}
        {total > pageSize && (
          <span className="ml-1.5 text-nd-fg-3">
            (<span className="nd-num">{from.toLocaleString("ko-KR")}–{to.toLocaleString("ko-KR")}</span> 표시)
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button type="button" className={btn} onClick={() => onPageChange(cur - 1)} disabled={cur <= 1} aria-label="이전 쪽">
              <Icon icon={ChevronLeft} size={16} />
            </button>
            <span className="nd-num px-1" aria-live="polite">
              <span className="font-semibold text-nd-fg">{cur}</span>
              <span className="text-nd-fg-3"> / {pages}</span>
            </span>
            <button type="button" className={btn} onClick={() => onPageChange(cur + 1)} disabled={cur >= pages} aria-label="다음 쪽">
              <Icon icon={ChevronRight} size={16} />
            </button>
          </span>
        )}
        {onPageSizeChange && (
          <Select
            size="sm"
            aria-label="한 쪽에 보일 개수"
            className="w-auto"
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}개씩 보기
              </option>
            ))}
          </Select>
        )}
      </span>
    </div>
  );
}
