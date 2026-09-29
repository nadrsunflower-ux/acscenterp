// ============================================================
//  장표 숫자 표기 — 한국식 단위(만원·억원)와 천 단위 쉼표
// ------------------------------------------------------------
//  음수는 「-」 로 쓴다 (△ 가 아니다 — ERP 금액 표기 규칙).
//  값이 없으면(null · NaN) 「미정」. 장표 문구에 긴 줄표를 쓰지 않는다.
// ============================================================

export const EMPTY = "미정";

const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** 1234.5 → "1,235" (자릿수 지정 시 소수) */
export function num(n: number | null | undefined, digits = 0): string {
  if (!ok(n)) return EMPTY;
  const s = Math.abs(n).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return n < 0 && s !== "0" ? `-${s}` : s;
}

/** 만원 단위 값 → "1,234만원" */
export function man(v: number | null | undefined, digits = 0): string {
  if (!ok(v)) return EMPTY;
  return `${num(v, digits)}만원`;
}

/**
 * 만원 단위 값 → 1억 이상이면 「1억 6,540만원」, 아니면 「5,800만원」.
 * 끝자리 만원은 반올림한다.
 */
export function eok(v: number | null | undefined): string {
  if (!ok(v)) return EMPTY;
  const r = Math.round(v);
  const sign = r < 0 ? "-" : "";
  const a = Math.abs(r);
  if (a < 10000) return `${sign}${a.toLocaleString("ko-KR")}만원`;
  const e = Math.floor(a / 10000);
  const m = a % 10000;
  return m === 0 ? `${sign}${e.toLocaleString("ko-KR")}억원` : `${sign}${e.toLocaleString("ko-KR")}억 ${m.toLocaleString("ko-KR")}만원`;
}

/** 원 → "12,345원" */
export function won(n: number | null | undefined): string {
  if (!ok(n)) return EMPTY;
  return `${num(Math.round(n))}원`;
}

/**
 * 원 → 만원으로 줄여서. 100만원 미만은 소수 한 자리(「79.1만원」),
 * 그 이상은 정수(「450만원」), 1억 이상은 억 단위.
 */
export function wonMan(n: number | null | undefined): string {
  if (!ok(n)) return EMPTY;
  const v = n / 10000;
  if (Math.abs(v) >= 10000) return eok(v);
  if (Math.abs(v) >= 100) return man(Math.round(v));
  const s = (Math.round(v * 10) / 10).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return `${s}만원`;
}

/** 퍼센트 숫자(46.2) → "46%" */
export function pct(v: number | null | undefined, digits = 0): string {
  if (!ok(v)) return EMPTY;
  return `${num(v, digits)}%`;
}

/** 비율(0.462) → "46%" */
export function ratio(v: number | null | undefined, digits = 0): string {
  if (!ok(v)) return EMPTY;
  return pct(v * 100, digits);
}

export const months = (v: number | null | undefined) => (ok(v) ? `${num(v)}개월` : EMPTY);
export const credits = (v: number | null | undefined) => (ok(v) ? `${num(v)}C` : EMPTY);
export const times = (v: number | null | undefined, digits = 1) => (ok(v) ? `${num(v, digits)}배` : EMPTY);
export const count = (v: number | null | undefined, unit: string, digits = 0) =>
  ok(v) ? `${num(v, digits)}${unit}` : EMPTY;

/** "2026-09" → "9월", 연도가 바뀌면 "2027년 1월" */
export function monthLabel(m: string, withYear = false): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return withYear ? `${y}년 ${mo}월` : `${mo}월`;
}

/** "2026-08-31" → "2026.8.31" */
export function dateLabel(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m) return d;
  return day ? `${y}.${m}.${day}` : `${y}.${m}`;
}

/** 가정값 하나를 단위에 맞춰 — 패널·칩·인쇄본이 같이 쓴다 */
export function formatAssumption(value: number | boolean | null | undefined, unit: string): string {
  if (typeof value === "boolean") return value ? "켜기" : "끄기";
  if (!ok(value)) return EMPTY;
  // 적힌 만큼만 소수를 보인다 (18.07 → 2자리, 2.4 → 1자리)
  const digits = Number.isInteger(value) ? 0 : Number.isInteger(Math.round(value * 1000) / 100) ? 1 : 2;
  switch (unit) {
    case "만원":
      return Math.abs(value) >= 10000 ? eok(value) : man(value, digits);
    case "원":
      return won(value);
    case "%":
      return pct(value, digits);
    default:
      return `${num(value, digits)}${unit}`;
  }
}

/**
 * 템플릿 형식 이름 → 함수. `{{r.reloc.min|months}}` 의 `months` 가 여기 키다.
 * 인자는 `|pct:1` 처럼 콜론 뒤 숫자 하나.
 */
export const FORMATTERS: Record<string, (v: unknown, arg?: number) => string> = {
  man: (v, a) => man(v as number, a ?? 0),
  eok: (v) => eok(v as number),
  won: (v) => won(v as number),
  wonman: (v) => wonMan(v as number),
  pct: (v, a) => pct(v as number, a ?? 0),
  ratio: (v, a) => ratio(v as number, a ?? 0),
  num: (v, a) => num(v as number, a ?? 0),
  int: (v) => num(v as number, 0),
  months: (v) => months(v as number),
  c: (v) => credits(v as number),
  x: (v, a) => times(v as number, a ?? 1),
  got: (v, a) => count(v as number, "곳", a ?? 0),
  gun: (v, a) => count(v as number, "건", a ?? 0),
  il: (v, a) => count(v as number, "일", a ?? 0),
  /** 비율 차이 → 「1.8%p」 */
  pp: (v, a) => (ok(v as number) ? `${num((v as number) * 100, a ?? 1)}%p` : EMPTY),
  /** 백 단위 반올림 → 「4,400」 (약 몇 곳) */
  r100: (v) => (ok(v as number) ? num(Math.round((v as number) / 100) * 100) : EMPTY),
  month: (v) => monthLabel(String(v)),
  date: (v) => dateLabel(String(v)),
  raw: (v) => (v === null || v === undefined ? EMPTY : String(v)),
};
