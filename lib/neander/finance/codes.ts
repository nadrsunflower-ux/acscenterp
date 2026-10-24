// ============================================================
//  자동 코드 — 프로젝트 · 지원사업 · 돌려줄 돈
// ------------------------------------------------------------
//  코드는 원장의 프로젝트코드 칸 하나로 거래를 건에 잇는 열쇠다. 사람이 지어 붙이면
//  「JIMFF」 「제이진」 「이태원」 처럼 규칙이 없고, 새로 지을 때마다 겹치는지 따로
//  봐야 했다. 그래서 새 건은 「머리글-연월-순번」 으로 저절로 붙인다(2026-10-25
//  사용자 결정 — 손으로 적지 않는다).
//
//    프로젝트 PJ-2610-01 · 지원사업 GR-2610-01 · 돌려줄 돈 PB-2610-01
//
//  연월은 그 건이 시작하는 달(행사 시작일 · 협약 시작일)이고, 모르면 만드는 달이다.
//  순번은 같은 머리글-연월 안에서 가장 큰 번호 + 1 이다. 원장에 이미 찍힌 코드와 다른
//  건의 코드는 모두 피한다.
//
//  예전 코드(MRNC-2609 · 제이진 …)는 바꾸지 않는다 — 원장 거래가 그 글자로 이어져 있다.
//  한 번 붙은 코드는 화면에서 고칠 수 없다. 같은 까닭이다.
//
//  만드는 순간 두 사람이 같은 번호를 받을 수 있어, 저장이 「이미 쓰고 있다」 로 막히면
//  다음 번호로 다시 보낸다(saveWithAutoCode). 서버의 중복 검사가 마지막 문지기다.
// ============================================================

import { todayStrKST } from "../format";

export type CodeKind = "project" | "grant" | "payback";

export const CODE_PREFIX: Record<CodeKind, string> = {
  project: "PJ",
  grant: "GR",
  payback: "PB",
};

/** 코드의 연월 — `2026-10-03` → `2610`. 날짜가 없거나 이상하면 오늘 */
export function codeMonth(date?: string, today = todayStrKST()): string {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  return `${d.slice(2, 4)}${d.slice(5, 7)}`;
}

/** 쓰고 있는 코드 — 대소문자를 가리지 않는다 (원장 매칭이 그렇게 한다) */
export function takenCodes(...lists: Iterable<string | undefined | null>[]): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    for (const c of list) {
      const t = (c ?? "").trim().toLowerCase();
      if (t) out.add(t);
    }
  }
  return out;
}

/** 다음 코드 — 같은 머리글-연월의 가장 큰 번호 + 1, 쓰고 있는 코드는 건너뛴다 */
export function nextCode(kind: CodeKind, taken: Set<string>, date?: string, today = todayStrKST()): string {
  const head = `${CODE_PREFIX[kind]}-${codeMonth(date, today)}-`;
  const lower = head.toLowerCase();
  let max = 0;
  taken.forEach((c) => {
    if (!c.startsWith(lower)) return;
    const n = Number(c.slice(lower.length));
    if (Number.isInteger(n) && n > max) max = n;
  });
  for (let n = max + 1; ; n++) {
    const code = `${head}${String(n).padStart(2, "0")}`;
    if (!taken.has(code.toLowerCase())) return code;
  }
}

/** 저장이 코드 겹침으로 막혔나 — 서버 문구 「코드 X 는 이미 「…」 이 쓰고 있습니다」 */
export const isCodeClash = (e: unknown) => e instanceof Error && /는 이미 「.*」 이 쓰고 있습니다/.test(e.message);

/**
 * 자동 코드로 저장한다. 다른 사람이 방금 같은 번호를 가져가 막히면 다음 번호로
 * 다시 보낸다 (다섯 번까지). 쓴 코드를 돌려준다.
 */
export async function saveWithAutoCode<T>(
  kind: CodeKind,
  taken: Set<string>,
  date: string | undefined,
  save: (code: string) => Promise<T>,
  today = todayStrKST(),
): Promise<{ code: string; result: T }> {
  const seen = new Set(taken);
  for (let attempt = 0; ; attempt++) {
    const code = nextCode(kind, seen, date, today);
    try {
      return { code, result: await save(code) };
    } catch (e) {
      if (!isCodeClash(e) || attempt >= 4) throw e;
      seen.add(code.toLowerCase());
    }
  }
}
