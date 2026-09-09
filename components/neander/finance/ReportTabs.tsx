"use client";

// ============================================================
//  재무 › 리포트 하위 탭 + 월 선택 캡슐
// ------------------------------------------------------------
//  네 화면이 같은 리포트 엔진(report.ts)을 쓰고 같은 기간·기준 개념을
//  공유하므로 한 묶음으로 둔다. 탭은 URL 이동이라 공통 <Tabs> 의 href
//  모드를 쓴다(aria-current).
//
//  MonthStepper 는 대시보드의 월 선택(‹ 라벨 › + 목록 메뉴)과 같은
//  패턴이다. 리포트 네 화면과 월 마감이 함께 쓴다 — 재무 밖에서도 쓰이면
//  finance/ui.tsx 로 옮길 후보.
// ============================================================

import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { DateStepper, Menu, Tabs, type MenuItem } from "@/components/neander/ui";
import { monthLabel } from "./ui";

const TABS = [
  { key: "detail", href: "/neander/finance/reports", label: "지출상세", hint: "계정 3단" },
  { key: "units", href: "/neander/finance/reports/units", label: "사업부", hint: "B2C·B2B·공용" },
  { key: "subs", href: "/neander/finance/reports/subscriptions", label: "구독", hint: "SaaS 지출" },
  { key: "budget", href: "/neander/finance/reports/budget", label: "예산", hint: "예산 대비 결산" },
];

export function ReportTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const active =
    TABS.find((t) =>
      t.href === "/neander/finance/reports" ? pathname === t.href : pathname.startsWith(t.href),
    )?.key ?? TABS[0].key;
  return <Tabs ariaLabel="리포트 종류" items={TABS} value={active} className={className} />;
}

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
