"use client";

// ============================================================
//  장비 배정 칸 · 겹침 목록 — 프로젝트 상세 화면과 프로젝트 달력이 같이 쓴다
// ------------------------------------------------------------
//  계산은 lib/neander/finance/equipment.ts. 여기는 그리기만.
// ============================================================

import { AlertTriangle, Camera, Minus, MonitorSmartphone, Plus, ScrollText } from "lucide-react";
import { Icon, cn, type LucideIcon } from "@/components/neander/ui";
import {
  EQUIPMENT_KINDS,
  EQUIPMENT_LABEL,
  EQUIPMENT_MAX,
  EQUIPMENT_OWNED,
  sanitizeEquipment,
  type EquipmentConflict,
  type EquipmentKind,
  type ProjectEquipment,
} from "@/lib/neander/finance/equipment";

export const EQUIPMENT_ICON: Record<EquipmentKind, LucideIcon> = { photobooth: Camera, sajuBooth: ScrollText, kiosk: MonitorSmartphone };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 「12/9(수)」 */
export const mdDay = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;
export const mdRange = (from: string, to: string) => (from === to ? mdDay(from) : `${mdDay(from)} ~ ${mdDay(to)}`);

/** 종류마다 − n + — 0 이면 그 종류는 안 쓴다 */
export function EquipmentStepper({
  value,
  onChange,
  disabled,
  className,
}: {
  value: ProjectEquipment | undefined;
  onChange: (next: ProjectEquipment | undefined) => void;
  disabled?: boolean;
  className?: string;
}) {
  const set = (k: EquipmentKind, n: number) => onChange(sanitizeEquipment({ ...value, [k]: Math.max(0, Math.min(EQUIPMENT_MAX, n)) }));
  return (
    <div className={cn("flex flex-wrap gap-x-6 gap-y-3", className)} role="group" aria-label="장비 배정">
      {EQUIPMENT_KINDS.map((k) => {
        const n = value?.[k] ?? 0;
        const btn =
          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-nd-line text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent/50";
        return (
          <div key={k} className="flex items-center gap-2.5">
            <span className="inline-flex min-w-[7.25rem] items-center gap-1.5 text-[14px] font-medium text-nd-fg">
              <Icon icon={EQUIPMENT_ICON[k]} size={16} className="text-nd-fg-3" />
              {EQUIPMENT_LABEL[k]}
            </span>
            <button type="button" className={btn} onClick={() => set(k, n - 1)} disabled={disabled || n <= 0} aria-label={`${EQUIPMENT_LABEL[k]} 한 대 빼기`}>
              <Icon icon={Minus} size={15} />
            </button>
            <span className={cn("nd-num w-7 text-center text-[17px] font-semibold", n > 0 ? "text-nd-fg" : "text-nd-fg-3")} aria-live="polite" aria-label={`${EQUIPMENT_LABEL[k]} ${n}대`}>
              {n}
            </span>
            <button type="button" className={btn} onClick={() => set(k, n + 1)} disabled={disabled || n >= EQUIPMENT_MAX} aria-label={`${EQUIPMENT_LABEL[k]} 한 대 더하기`}>
              <Icon icon={Plus} size={15} />
            </button>
            <span className="text-[13px] text-nd-fg-3">보유 {EQUIPMENT_OWNED[k]}대</span>
          </div>
        );
      })}
    </div>
  );
}

/** 겹침 한 줄씩 — 「12/11(금) ~ 12/12(토) 포토부스 4대 필요 · 보유 3대 — 수원 1 · 교육AX 3(심사 중)」 */
export function EquipmentConflictList({
  conflicts,
  me,
  name = (n) => n,
  className,
}: {
  conflicts: EquipmentConflict[];
  /** 이 프로젝트(id)를 굵게 */
  me?: string;
  name?: (n: string) => string;
  className?: string;
}) {
  if (conflicts.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)} aria-label="장비가 모자라는 날">
      {conflicts.map((c) => (
        <li key={`${c.kind}:${c.from}`} className="flex items-start gap-2 rounded-nd-md bg-nd-danger-soft px-3 py-2 text-[14px] text-nd-danger-text">
          <Icon icon={AlertTriangle} size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <b className="font-semibold">
              {mdRange(c.from, c.to)} {EQUIPMENT_LABEL[c.kind]} {c.need}대 필요 · 보유 {c.owned}대
            </b>
            <span className="text-nd-fg-2">
              {" — "}
              {c.users.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && " · "}
                  <span className={u.id === me ? "font-semibold text-nd-fg" : undefined}>
                    {name(u.name)} {u.count}
                    {u.status === "planning" ? "(심사 중)" : ""}
                  </span>
                </span>
              ))}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
