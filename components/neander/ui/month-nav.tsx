"use client";

// ============================================================
//  MonthStepper — ‹ 2026년 7월 › 캡슐
// ------------------------------------------------------------
//  재무 리포트 네 화면 · 월 마감 · 엑셀 임포트 · 매출 일곱 화면이 전부
//  같은 컨트롤로 달을 고른다. 예전에는 finance/ReportTabs.tsx 안에 있어
//  매출이 재무를 import 해야 했다 — 그 파일 주석에도 "재무 밖에서도
//  쓰이면 옮길 후보" 라고 적혀 있었다. 이제 옮겼다.
// ============================================================
import { useRef, useState } from "react";
import { monthLabel } from "@/lib/neander/format";
import { DateStepper } from "./date-nav";
import { Menu, type MenuItem } from "./popover";

/**
 * ‹ 2026년 7월 › 캡슐 — 가운데를 누르면 달 목록이 열린다.
 * months 는 최신순(availableMonths / monthsOf 결과 그대로).
 * 툴바에 올릴 때는 glass 를 켠다.
 */
export function MonthStepper({
  months,
  value,
  onChange,
  glass = false,
  size = "md",
  labelFor,
}: {
  months: string[];
  value: string;
  onChange: (m: string) => void;
  glass?: boolean;
  size?: "sm" | "md";
  /** 목록 항목에 붙일 부가 정보 (예: "마감") */
  labelFor?: (m: string) => string | undefined;
}) {
  const idx = months.indexOf(value);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const items: MenuItem[] = months.map((m) => ({
    key: m,
    label: monthLabel(m),
    hint: labelFor?.(m),
    checked: m === value,
    onSelect: () => onChange(m),
  }));
  return (
    <>
      <DateStepper
        glass={glass}
        size={size}
        onPrev={() => idx < months.length - 1 && onChange(months[idx + 1])}
        onNext={() => idx > 0 && onChange(months[idx - 1])}
        prevDisabled={idx >= months.length - 1}
        nextDisabled={idx <= 0}
        prevLabel="이전 달"
        nextLabel="다음 달"
      >
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`월 선택: ${monthLabel(value)}`}
          className={
            size === "sm"
              ? "nd-num h-6 min-w-[6rem] rounded-full px-2 text-[13px] font-semibold text-nd-fg hover:bg-nd-fg/[.06]"
              : "nd-num h-8 min-w-[6.5rem] rounded-full px-2 text-nd-body font-semibold text-nd-fg hover:bg-nd-fg/[.06]"
          }
        >
          {monthLabel(value)}
        </button>
      </DateStepper>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        placement="bottom"
        ariaLabel="월 선택"
        className="max-h-[60vh]"
        items={items}
      />
    </>
  );
}
