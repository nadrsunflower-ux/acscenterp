"use client";

// ============================================================
//  받기로 한 날 칸 — 정확한 날, 또는 「10월 말」 같은 대략
// ------------------------------------------------------------
//  발주처가 「이달 말쯤」 이라고만 할 때 아무 날짜를 찍어 두면 약속한 날처럼
//  읽힌다. 옆 단추로 대략(달 + 초·중·말)과 정확한 날을 오간다. 대략일 때
//  dueDate 는 그 구간의 끝 날이다 (lib/neander/finance/project.ts 의 DUE_PARTS).
// ============================================================

import { CalendarDays, CalendarRange } from "lucide-react";
import { IconButton, Input, Select, cn } from "@/components/neander/ui";
import {
  approxDueDate,
  DUE_PART_LABEL,
  DUE_PARTS,
  partOfDate,
  type DuePart,
} from "@/lib/neander/finance/project";
import { shiftMonth, todayStrKST } from "@/lib/neander/format";

export interface DueValue {
  dueDate?: string;
  dueApprox?: DuePart;
}

/** 고를 수 있는 달 — 기준 달 앞 6달 ~ 뒤 18달. 지금 값이 그 밖이면 그것도 넣는다 */
export function dueMonths(around: string, current?: string): string[] {
  const list = Array.from({ length: 25 }, (_, i) => shiftMonth(around, i - 6));
  if (current && !list.includes(current)) list.push(current);
  return list.sort();
}

export const dueMonthText = (m: string) => `${m.slice(2, 4)}년 ${Number(m.slice(5))}월`;

export function DueInput({
  value,
  onChange,
  label = "받기로 한 날",
  className,
}: {
  value: DueValue;
  onChange: (next: DueValue) => void;
  label?: string;
  className?: string;
}) {
  const thisMonth = todayStrKST().slice(0, 7);

  if (value.dueApprox && value.dueDate) {
    const month = value.dueDate.slice(0, 7);
    const part = value.dueApprox;
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Select
          size="sm"
          className="w-auto"
          value={month}
          onChange={(e) => onChange({ dueDate: approxDueDate(e.target.value, part), dueApprox: part })}
          aria-label={`${label} — 달`}
        >
          {dueMonths(thisMonth, month).map((m) => (
            <option key={m} value={m}>
              {dueMonthText(m)}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          className="w-auto"
          value={part}
          onChange={(e) => {
            const p = e.target.value as DuePart;
            onChange({ dueDate: approxDueDate(month, p), dueApprox: p });
          }}
          aria-label={`${label} — 초·중·말`}
        >
          {DUE_PARTS.map((p) => (
            <option key={p} value={p}>
              {DUE_PART_LABEL[p]}
            </option>
          ))}
        </Select>
        <IconButton
          icon={CalendarDays}
          size="sm"
          label="정확한 날짜로 적기"
          onClick={() => onChange({ dueDate: value.dueDate, dueApprox: undefined })}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Input
        size="sm"
        type="date"
        value={value.dueDate ?? ""}
        onChange={(e) => onChange({ dueDate: e.target.value || undefined, dueApprox: undefined })}
        aria-label={label}
      />
      <IconButton
        icon={CalendarRange}
        size="sm"
        label="대략으로 적기 — 「10월 말」 처럼"
        onClick={() => {
          const d = value.dueDate;
          const month = d ? d.slice(0, 7) : thisMonth;
          const part: DuePart = d ? partOfDate(d) : "late";
          onChange({ dueDate: approxDueDate(month, part), dueApprox: part });
        }}
      />
    </div>
  );
}
