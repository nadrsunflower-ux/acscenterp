// ============================================================
//  가정값 상태 — 덮어쓴 값 · 변경 이력 · 공유 링크 · 브라우저 저장
// ------------------------------------------------------------
//  기본값(내용·실측)은 상태에 넣지 않는다. 덮어쓴 값만 들고 있어야
//  ERP 숫자가 바뀌었을 때 덮어쓰지 않은 값이 새 숫자를 따라간다.
//
//  공유 링크는 `?a=` 뒤에 덮어쓴 값만 base64url(JSON) 으로 싣는다.
//  링크를 받은 사람도 로그인해야 열리므로 값이 URL 에 있어도 괜찮다.
// ============================================================

import type { AssumptionDef, AssumptionValue } from "./types";

export type Overrides = Record<string, AssumptionValue>;

export type ChangeVia = "패널" | "칩" | "공유 링크" | "저장본" | "되돌리기";

export interface HistoryEntry {
  key: string;
  from: AssumptionValue;
  to: AssumptionValue;
  at: number;
  via: ChangeVia;
}

export interface DeckLocalState {
  overrides: Overrides;
  history: HistoryEntry[];
  /** 학원 실명 보기 (기본은 익명) */
  realNames?: boolean;
}

const HISTORY_LIMIT = 200;

/** 값 하나를 정의에 맞게 다듬는다 — 범위 밖이면 가두고, 형식이 틀리면 버린다 */
export function sanitizeValue(def: AssumptionDef, raw: unknown): AssumptionValue | undefined {
  if (raw === null) return null;
  if (def.type === "bool") return typeof raw === "boolean" ? raw : undefined;
  const x = typeof raw === "string" ? Number(raw.replace(/,/g, "")) : raw;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  // 고르기 값은 목록에 있는 값만
  if (def.type === "choice") return def.options?.some((o) => o.value === x) ? x : undefined;
  let v = x;
  if (def.min !== undefined && v < def.min) v = def.min;
  if (def.max !== undefined && v > def.max) v = def.max;
  return v;
}

/** 모르는 키·틀린 형식을 걸러 낸다 — 링크·저장본·브라우저 저장 모두 이걸 거친다 */
export function sanitizeOverrides(defs: AssumptionDef[], raw: unknown): Overrides {
  if (!raw || typeof raw !== "object") return {};
  const out: Overrides = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    const def = byKey.get(k);
    if (!def) continue;
    const v = sanitizeValue(def, val);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 덮어쓰기 하나 — 기본값과 같아지면 덮어쓰기를 지운다 */
export function setOverride(
  state: DeckLocalState,
  key: string,
  to: AssumptionValue,
  base: AssumptionValue,
  current: AssumptionValue,
  via: ChangeVia,
  at = Date.now(),
): DeckLocalState {
  if (to === current) return state;
  const overrides = { ...state.overrides };
  if (to === base) delete overrides[key];
  else overrides[key] = to;
  return {
    ...state,
    overrides,
    history: [{ key, from: current, to, at, via }, ...state.history].slice(0, HISTORY_LIMIT),
  };
}

/** 되돌리기 — keys 가 없으면 전부 */
export function resetOverrides(
  state: DeckLocalState,
  current: Record<string, AssumptionValue>,
  base: Record<string, AssumptionValue>,
  keys?: string[],
  at = Date.now(),
): DeckLocalState {
  const targets = (keys ?? Object.keys(state.overrides)).filter((k) => k in state.overrides);
  if (targets.length === 0) return state;
  const overrides = { ...state.overrides };
  const entries: HistoryEntry[] = [];
  for (const k of targets) {
    delete overrides[k];
    entries.push({ key: k, from: current[k] ?? null, to: base[k] ?? null, at, via: "되돌리기" });
  }
  return { ...state, overrides, history: [...entries, ...state.history].slice(0, HISTORY_LIMIT) };
}

// ---- 공유 링크 ------------------------------------------------

const toB64Url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b + "===".slice((b.length + 3) % 4));
};

/** 덮어쓴 값 → 링크 조각. 키와 값이 ASCII 라 그대로 base64 로 싼다 */
export function encodeOverrides(o: Overrides): string {
  return toB64Url(JSON.stringify(o));
}

export function decodeOverrides(defs: AssumptionDef[], s: string | null | undefined): Overrides | null {
  if (!s) return null;
  try {
    return sanitizeOverrides(defs, JSON.parse(fromB64Url(s)));
  } catch {
    return null;
  }
}

/** 현재 주소에 덮어쓴 값과 장 번호를 실은 공유 링크 */
export function shareUrl(href: string, o: Overrides, slideNo?: number): string {
  const u = new URL(href);
  if (Object.keys(o).length) u.searchParams.set("a", encodeOverrides(o));
  else u.searchParams.delete("a");
  u.hash = slideNo ? `slide-${slideNo}` : "";
  return u.toString();
}

// ---- 브라우저 저장 ----------------------------------------------

const storageKey = (slug: string) => `nd-deck:${slug}`;

export function loadLocal(slug: string, defs: AssumptionDef[]): DeckLocalState {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return { overrides: {}, history: [] };
    const parsed = JSON.parse(raw) as Partial<DeckLocalState>;
    return {
      overrides: sanitizeOverrides(defs, parsed.overrides),
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [],
      realNames: parsed.realNames === true,
    };
  } catch {
    return { overrides: {}, history: [] };
  }
}

export function saveLocal(slug: string, state: DeckLocalState): void {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(state));
  } catch {
    // 사생활 보호 창·저장 공간 부족 — 저장 없이 그대로 쓴다
  }
}
