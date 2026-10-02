// ============================================================
//  거래 나누기 — 한 번에 결제한 것을 여러 줄로 가른다
// ------------------------------------------------------------
//  배너를 한 번에 주문했는데 둘은 JIMFF 것, 넷은 평택 것이다. 카드 명세서에는
//  45,580원 한 줄뿐이라, 어느 한 프로젝트에 다 붙이면 다른 프로젝트의 원가가 빈다.
//
//  거래 한 줄을 **여러 줄로 쪼갠다.** 한 줄 안에 「내역」 을 따로 두지 않는다 —
//  그러면 계정별 · 사업부별 · 프로젝트별 집계가 전부 그 내역을 알아야 한다.
//  줄로 쪼개면 집계는 아무것도 몰라도 된다 (엑셀 장부에서도 줄을 나눠 적었다).
//
//  ── 지켜야 하는 것 ──
//  · **합이 원래 금액과 같다.** 통장 · 카드의 숫자가 장부에서 달라지면 안 된다.
//  · 첫 조각은 원래 거래 그 자리다 (문서 id · 중복 검사 키가 그대로) — 같은 명세서를
//    다시 올려도 새 거래로 들어오지 않는다. 나머지 조각은 새 줄이다.
//  · 조각들은 한 묶음이다 (`splitGroup` = 원래 거래의 id). 적재를 되돌리면 같이
//    지워지고(importBatchId 를 물려받는다), 「합치기」 로 다시 한 줄이 된다.
//  · 조정금액(부분 취소)이 있는 거래는 나누지 않는다 — 어느 조각의 취소인지 모른다.
//
//  이 파일은 서버·화면 공용이다 (저장은 api/neander/finance/split).
// ============================================================

import type { FinTransaction } from "./types";

/** 한 거래를 나눌 수 있는 최대 조각 수 */
export const SPLIT_MAX_PARTS = 8;

/** 조각 하나 — 금액과, 원래 거래와 달리할 분류 */
export interface SplitPart {
  /** 이 조각의 금액 (원, 양수) */
  gross: number;
  projectCode?: string;
  bizMajor?: string;
  bizMinor?: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
}

/** 조각이 원래 거래에서 바꿀 수 있는 필드 — 이 밖의 것(날짜 · 거래처 · 결제수단)은 물려받는다 */
const PART_FIELDS = ["projectCode", "bizMajor", "bizMinor", "acctMajor", "acctMid", "acctMinor"] as const;

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 나눌 수 있는 거래인가. 못 나누면 까닭을 돌려준다 */
export function splitBlocker(t: Pick<FinTransaction, "gross" | "adjust" | "splitGroup" | "txType">): string | null {
  if (t.splitGroup) return "이미 나눈 거래입니다 — 합친 뒤 다시 나누세요.";
  if ((t.adjust ?? 0) !== 0) return "조정금액(부분 취소)이 있는 거래는 나눌 수 없습니다.";
  if (!(Math.abs(t.gross ?? 0) >= 2)) return "나눌 금액이 없습니다.";
  if (t.txType === "카드대금결제") return "카드대금 결제는 나누지 않습니다 — 카드 거래 쪽을 나누세요.";
  return null;
}

/** 조각들이 원래 거래를 온전히 덮는가. 문제가 있으면 까닭을 돌려준다 */
export function validateSplit(t: Pick<FinTransaction, "gross" | "adjust" | "splitGroup" | "txType">, parts: SplitPart[]): string | null {
  const blocked = splitBlocker(t);
  if (blocked) return blocked;
  if (!Array.isArray(parts) || parts.length < 2) return "둘 이상으로 나눠야 합니다.";
  if (parts.length > SPLIT_MAX_PARTS) return `${SPLIT_MAX_PARTS}조각까지 나눌 수 있습니다.`;
  const sign = Math.sign(t.gross);
  for (const p of parts) {
    if (!Number.isFinite(p.gross) || !Number.isInteger(p.gross)) return "금액은 원 단위 숫자여야 합니다.";
    if (p.gross === 0 || Math.sign(p.gross) !== sign) return "조각마다 금액이 있어야 합니다.";
  }
  const sum = parts.reduce((s, p) => s + p.gross, 0);
  if (sum !== Math.round(t.gross)) {
    return `조각의 합(${won(sum)}원)이 원래 금액(${won(t.gross)}원)과 다릅니다.`;
  }
  return null;
}

/**
 * 금액을 비율대로 나눈다. 원 단위로 떨어지지 않는 나머지는 **마지막 조각**에 얹는다 —
 * 합이 원래 금액과 정확히 같아야 한다.
 */
export function splitByRatio(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(sum > 0) || weights.some((w) => !(w > 0))) return [];
  const out = weights.map((w) => Math.floor((Math.abs(total) * w) / sum));
  out[out.length - 1] += Math.abs(total) - out.reduce((s, n) => s + n, 0);
  return out.map((n) => n * Math.sign(total));
}

/** `2:4` · `1/2` · `30 70` → 비율. 읽지 못하면 null */
export function parseRatio(text: string): number[] | null {
  const nums = text
    .split(/[:/,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (nums.length < 2 || nums.length > SPLIT_MAX_PARTS || nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums;
}

/**
 * 카드 메모에 적힌 수량 — 「JIMFF 배너2, 평택배너4」 → [2, 4].
 * 쉼표·가운뎃점으로 가른 조각이 **모두** 숫자로 끝날 때만 돌려준다 (추측하지 않는다).
 */
export function quantitiesInMemo(memo?: string): { labels: string[]; weights: number[] } | null {
  if (!memo) return null;
  const item = memo.replace(/^\[[^\]]*\]\s*/, "").split(" / ").slice(1).join(" / ") || "";
  const segs = item
    .split(/[,·]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length < 2 || segs.length > SPLIT_MAX_PARTS) return null;
  const weights: number[] = [];
  const labels: string[] = [];
  for (const seg of segs) {
    const m = seg.match(/^(.*?)(\d{1,4})\s*(개|장|매|ea|EA)?$/);
    if (!m || !(Number(m[2]) > 0)) return null;
    labels.push(m[1].trim());
    weights.push(Number(m[2]));
  }
  return { labels, weights };
}

/** 조각이 바꾼 분류 — 적은 것만 (비운 칸은 원래 값을 물려받지 않고 **비운다**) */
function partClass(p: SplitPart): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  PART_FIELDS.forEach((f) => {
    const v = p[f];
    out[f] = typeof v === "string" && v.trim() ? v.trim() : null;
  });
  return out;
}

export interface SplitWrite {
  /** 원래 거래(첫 조각)에 덮어쓸 값 — null 은 필드를 지운다 */
  rootPatch: Record<string, unknown>;
  /** 새로 만들 조각들 (온전한 문서 — id 는 저장하는 쪽이 붙인다) */
  children: Record<string, unknown>[];
}

/**
 * 나누기 → 쓸 것. `full` 은 **온전한 문서**여야 한다 (숨긴 필드 포함 — 서버에서만 부른다).
 *
 * 조각의 상태: 원래 확정이었어도 조각은 사람이 다시 본다 — 계정이 있으면 「제안됨」,
 * 없으면 「검토필요」. 나눈 순간 금액이 달라졌으니 확정을 물려받지 않는다.
 */
export function buildSplit(
  full: FinTransaction & Record<string, unknown>,
  parts: SplitPart[],
  now: number,
  by?: string,
): SplitWrite {
  const total = Math.round(full.gross);
  const n = parts.length;
  const common = (p: SplitPart, k: number) => {
    const cls = partClass(p);
    return {
      ...cls,
      gross: p.gross,
      status: cls.acctMinor ? "suggested" : "needs_review",
      classReason: `거래를 나눔 — 원래 ${won(total)}원을 ${n}조각으로 (${k + 1}/${n})`,
      splitGroup: full.id,
      splitNo: k + 1,
      splitCount: n,
      splitTotal: total,
      updatedAt: now,
      updatedBy: by ?? null,
    };
  };
  // 자동분류의 지문은 거둔다 — 이제 사람이 나눈 줄이다 (계속 배우기가 덮어쓰지 않게)
  const rootPatch = { ...common(parts[0], 0), engineSig: null };

  const { id: _id, balanceAfter: _b, engineSig: _e, refundMatchId: _r, ...base } = full;
  const children = parts.slice(1).map((p, i) => {
    const doc: Record<string, unknown> = {
      ...base,
      ...common(p, i + 1),
      // 중복 검사 키는 겹치지 않게 — 원래 키는 첫 조각만 갖는다 (명세서의 그 한 줄)
      dedupHash: `${full.dedupHash || full.id}#split${i + 2}`,
      createdAt: now,
    };
    // 비운 칸은 문서에 남기지 않는다
    Object.keys(doc).forEach((k) => {
      if (doc[k] === null || doc[k] === undefined) delete doc[k];
    });
    return doc;
  });
  return { rootPatch, children };
}

/** 합치기 — 조각들을 다시 한 줄로. 남길 줄(root)의 금액과, 지울 줄들 */
export function buildMerge(
  parts: Pick<FinTransaction, "id" | "gross" | "splitGroup" | "splitNo">[],
): { rootId: string; gross: number; removeIds: string[] } | null {
  if (parts.length === 0) return null;
  const group = parts[0].splitGroup;
  if (!group || parts.some((p) => p.splitGroup !== group)) return null;
  // 원래 거래(첫 조각)가 남아 있으면 그 줄로, 지워졌으면 번호가 가장 앞선 조각으로 모은다
  const root = parts.find((p) => p.id === group) ?? [...parts].sort((a, b) => (a.splitNo ?? 99) - (b.splitNo ?? 99))[0];
  return {
    rootId: root.id,
    gross: parts.reduce((s, p) => s + Math.round(p.gross ?? 0), 0),
    removeIds: parts.filter((p) => p.id !== root.id).map((p) => p.id),
  };
}
