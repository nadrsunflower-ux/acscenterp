// ============================================================
//  개발허브 홈 — 마감일 분류 헬퍼 (순수 함수, 렌더 전용)
//  지연=빨강 / 오늘=주황 / 내일=호박 / 이번 주·이후=회색.
//  날짜는 "YYYY-MM-DD" 문자열 비교(사전순 == 시간순) 관용구를 따른다.
// ============================================================

import { addDays, todayStr, weekDates } from "@/lib/neander/format";

export type DueTone = "overdue" | "today" | "tomorrow" | "week" | "later";

export interface DueInfo {
  tone: DueTone;
  /** 짧은 배지 라벨 (예: "지연 · 7/3") */
  label: string;
  /** 배지용 tailwind 클래스 (배경+글자색) */
  cls: string;
}

/** "YYYY-MM-DD" → "M/D" */
export function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  if (!m || !d) return dateStr;
  return `${m}/${d}`;
}

/** 이번 주(일~토) 마지막 날짜 "YYYY-MM-DD" */
export function thisWeekEnd(): string {
  return weekDates(Date.now())[6];
}

/** 마감일을 지연/오늘/내일/이번 주/이후로 분류해 배지 정보 반환 */
export function dueInfo(dueDate: string): DueInfo {
  const today = todayStr();
  if (dueDate < today) {
    return {
      tone: "overdue",
      label: `지연 · ${shortDate(dueDate)}`,
      cls: "bg-red-50 text-red-600",
    };
  }
  if (dueDate === today) {
    return { tone: "today", label: "오늘 마감", cls: "bg-orange-50 text-orange-600" };
  }
  if (dueDate === addDays(today, 1)) {
    return { tone: "tomorrow", label: "내일 마감", cls: "bg-amber-50 text-amber-600" };
  }
  if (dueDate <= thisWeekEnd()) {
    return {
      tone: "week",
      label: `이번 주 · ${shortDate(dueDate)}`,
      cls: "bg-zinc-100 text-zinc-600",
    };
  }
  return { tone: "later", label: `${shortDate(dueDate)} 마감`, cls: "bg-zinc-100 text-zinc-500" };
}
