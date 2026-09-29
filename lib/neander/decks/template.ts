// ============================================================
//  장표 문구 속 숫자 자리 — `{{v.revGray|man}}` · `{{r.reloc.min|months}}`
// ------------------------------------------------------------
//  문구에 숫자를 적어 두면 가정을 바꿔도 따라 바뀌지 않는다. 그래서 숫자는
//  전부 자리표시로 쓰고, 그리는 순간 가정값(v)과 계산 결과(r)에서 채운다.
//
//    경로   v.키 · r.점.경로 · r.목록[0].필드
//    형식   | 뒤 이름 (format.ts FORMATTERS), 인자는 콜론 뒤 숫자 — `|pct:1`
//    반올림 형식이 없으면 숫자는 정수로, 글자는 그대로
// ============================================================

import { EMPTY, FORMATTERS, num } from "./format";

const TOKEN = /\{\{\s*([^}|]+?)\s*(?:\|\s*([a-z]+)(?::(-?\d+))?\s*)?\}\}/g;

/** 점 경로로 값 꺼내기 — `a.b[2].c` */
export function getPath(scope: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function formatValue(value: unknown, fmt?: string, arg?: number): string {
  if (fmt) {
    const f = FORMATTERS[fmt];
    if (!f) return `{{?${fmt}}}`;
    return f(value, arg);
  }
  if (typeof value === "number") return Number.isFinite(value) ? num(value) : EMPTY;
  if (value === null || value === undefined) return EMPTY;
  return String(value);
}

/** 문구 안의 자리를 모두 채운다 */
export function fill(text: string, scope: unknown): string {
  return text.replace(TOKEN, (_, path: string, fmt?: string, arg?: string) =>
    formatValue(getPath(scope, path.trim()), fmt, arg !== undefined ? Number(arg) : undefined),
  );
}

/** 문구가 쓰는 경로 목록 — 칩(이 장표의 가정)과 검사에 쓴다 */
export function tokenPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) out.push(m[1].trim());
  return out;
}

/** 문구가 쓰는 형식 이름 — 없는 형식을 검사한다 */
export function tokenFormats(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (m[2]) out.push(m[2]);
  return out;
}
