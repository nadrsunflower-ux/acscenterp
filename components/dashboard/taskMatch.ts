// 대시보드 전용 헬퍼 — 특정 업무(Task)가 특정 날짜(YYYY-MM-DD)에 해당하는지 판정.
// lib/date.ts 에는 업무 주기 판정 유틸이 없으므로 여기에 직접 구현한다.
import type { Task } from "@/lib/types";
import { parseYMD } from "@/lib/date";

// task 가 ymd 날짜에 수행 대상인지 여부.
// - daily(일일) 업무: task.date 가 정확히 일치할 때만.
// - recurring(주기) 업무:
//     recurrence === "daily"   → 매일
//     recurrence === "weekly"  → weekdays(0=일~6=토) 에 해당 요일이 포함될 때
//     recurrence === "monthly" → monthDay 가 그 달의 일(day) 과 일치할 때
export function taskOccursOn(task: Task, ymd: string): boolean {
  if (task.type === "daily") {
    return !!task.date && task.date === ymd;
  }

  // recurring
  const date = parseYMD(ymd);
  switch (task.recurrence) {
    case "daily":
      return true;
    case "weekly":
      return Array.isArray(task.weekdays) && task.weekdays.includes(date.getDay());
    case "monthly":
      return typeof task.monthDay === "number" && task.monthDay === date.getDate();
    default:
      return false;
  }
}

// 주어진 업무 목록 중 ymd 날짜에 해당하는 것만 반환.
export function tasksForDate(tasks: Task[], ymd: string): Task[] {
  return tasks.filter((t) => taskOccursOn(t, ymd));
}
