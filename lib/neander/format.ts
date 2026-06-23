// ============================================================
//  포맷 / 날짜 유틸 (NEANDER ERP)
// ============================================================

/** 1234000 -> "1,234,000원" */
export function formatKRW(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 1234000 -> "1,234,000" (단위 없이) */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

/** 오늘 날짜를 YYYY-MM-DD 로 (로컬 기준) */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 이번 달 'YYYY-MM' */
export function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" -> "M월 D일 (요일)" */
export function formatDateKo(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${m}월 ${d}일 (${weekday})`;
}

/** epoch(ms) -> "M.D HH:mm" */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}.${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** dateStr("YYYY-MM-DD")가 month("YYYY-MM")에 속하는지 */
export function isInMonth(dateStr: string, month: string): boolean {
  return dateStr.startsWith(month);
}

/** 마감일이 지났는지 (오늘 포함 미래는 false) */
export function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  return dueDate < todayStr();
}

// ---- 주(week) 분류 유틸 (일요일 시작) ----------------------

/** epoch(ms) -> 그 주의 일요일 0시 Date */
export function weekStart(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // 일요일로 이동
  return d;
}

/** epoch(ms) -> 그 주의 7일(일~토) "YYYY-MM-DD" 배열 */
export function weekDates(ms: number): string[] {
  const s = weekStart(ms);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(s);
    d.setDate(s.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

/** epoch(ms) -> 정렬용 주 키 "YYYY-MM-DD"(주 시작일) */
export function weekKey(ms: number): string {
  const d = weekStart(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** epoch(ms) -> "M월 D일 ~ M월 D일" 주 범위 라벨 (이번 주/지난 주 접두) */
export function weekRangeLabel(ms: number): string {
  const s = weekStart(ms);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  const range = `${s.getMonth() + 1}월 ${s.getDate()}일 ~ ${e.getMonth() + 1}월 ${e.getDate()}일`;
  const thisWeek = weekStart(Date.now()).getTime();
  const diff = Math.round((thisWeek - s.getTime()) / (7 * 24 * 60 * 60 * 1000));
  if (diff === 0) return `이번 주 (${range})`;
  if (diff === 1) return `지난 주 (${range})`;
  if (diff === -1) return `다음 주 (${range})`;
  return range;
}

// ---- 달력(month grid) 유틸 ---------------------------------

/** "YYYY-MM" -> 6주 x 7일 = 42칸의 날짜 배열. 해당 달이 아닌 칸은 null */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return Array(42).fill(null);
  const first = new Date(y, m - 1, 1);
  const startPad = first.getDay(); // 앞쪽 빈 칸 수 (일요일 시작)
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** "YYYY-MM" 한 달 이동 (delta = -1 이전달, +1 다음달) */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" -> "YYYY년 M월" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${y}년 ${m}월`;
}

/** "YYYY-MM-DD"에 n일 더한 날짜 문자열 */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD"가 속한 주의 7일(일~토) */
export function weekDatesOf(dateStr: string): string[] {
  const [y, m, d] = dateStr.split("-").map(Number);
  return weekDates(new Date(y, m - 1, d).getTime());
}

/** "YYYY-MM-DD" 기준 그 주의 라벨 (이번 주/지난 주 + 범위) */
export function weekLabelOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return weekRangeLabel(new Date(y, m - 1, d).getTime());
}
