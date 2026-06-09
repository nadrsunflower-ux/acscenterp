// 날짜/달력 유틸 — 외부 라이브러리 없이 직접 구현.
// 모든 날짜 문자열은 YYYY-MM-DD (로컬 시간 기준) 사용.

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Date -> "YYYY-MM-DD" (로컬 시간 기준)
export function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 연/월/일(1-base month) -> "YYYY-MM-DD"
export function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// "YYYY-MM-DD" -> Date (로컬 자정)
export function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

// 오늘 "YYYY-MM-DD"
export function todayYMD(): string {
  return toYMD(new Date());
}

// 한국(서울, Asia/Seoul) 기준 오늘 "YYYY-MM-DD".
// 사용자의 기기 시간대와 무관하게 항상 서울 날짜로 판정한다.
export function seoulTodayYMD(): string {
  // en-CA 로캘은 YYYY-MM-DD 형식으로 출력된다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// 같은 날짜인지 (Date | "YYYY-MM-DD" 모두 허용)
export function isSameDay(a: Date | string, b: Date | string): boolean {
  const ay = typeof a === "string" ? a : toYMD(a);
  const by = typeof b === "string" ? b : toYMD(b);
  return ay === by;
}

// 월 가감 (day는 가능한 범위로 클램프)
export function addMonths(d: Date, delta: number): Date {
  const year = d.getFullYear();
  const month = d.getMonth() + delta;
  const target = new Date(year, month, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

// 일 가감
export function addDays(d: Date, delta: number): Date {
  const res = new Date(d);
  res.setDate(res.getDate() + delta);
  return res;
}

// 해당 월의 일 수 (month: 1-base)
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export interface MonthCell {
  date: Date;
  ymd: string;
  day: number; // 1-31
  inMonth: boolean; // 현재 표시 월에 속하는지
  weekday: number; // 0(일)~6(토)
  isToday: boolean;
}

// 달력 그리드 행렬 생성.
// 일요일 시작, 6주(42칸) 고정 — 앞뒤 달의 날짜로 채워 항상 같은 높이를 유지.
// month는 1-base.
export function getMonthMatrix(year: number, month: number): MonthCell[][] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startOffset = firstOfMonth.getDay(); // 0~6
  const gridStart = new Date(year, month - 1, 1 - startOffset);
  const today = todayYMD();

  const weeks: MonthCell[][] = [];
  let cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const row: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const ymd = toYMD(cursor);
      row.push({
        date: new Date(cursor),
        ymd,
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month - 1,
        weekday: cursor.getDay(),
        isToday: ymd === today,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

// 날짜가 [from, to] (YYYY-MM-DD, 포함) 범위 안에 있는지
export function isWithinRange(ymd: string, from: string, to: string): boolean {
  return ymd >= from && ymd <= to;
}

// 해당 날짜가 속한 주의 월요일 (월요일 시작 주)
export function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0(일)~6(토)
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(d, offset);
}

// 월요일 날짜 기준, 그 달의 몇 번째 주인지 (1-base)
export function weekOfMonth(monday: Date): number {
  return Math.floor((monday.getDate() - 1) / 7) + 1;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

// 요일 한글 ("일"~"토"). 0~6
export function weekdayKo(weekday: number): string {
  return WEEKDAY_KO[((weekday % 7) + 7) % 7];
}

// "YYYY-MM-DD" -> "2026년 6월 4일 (목)"
export function formatKoreanDate(ymd: string): string {
  const d = parseYMD(ymd);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdayKo(
    d.getDay()
  )})`;
}

// "YYYY-MM-DD" -> "6월 4일 (목)" (년 생략 — 목록 등 공간 절약용)
export function formatMonthDay(ymd: string): string {
  const d = parseYMD(ymd);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdayKo(d.getDay())})`;
}

// "YYYY-MM" 표시용 -> "2026년 6월"
export function formatKoreanMonth(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

// 금액 -> "48,000원"
export function formatPrice(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

// 밀리초 타임스탬프 -> "2026년 6월 6일 오후 3:24" (서울 기준)
export function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

// 시간 문자열을 분 단위 숫자로 ("12:30" -> 750). 비교/정렬용.
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}
