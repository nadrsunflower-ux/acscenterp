// ============================================================
//  조사 키워드 — 프로젝트 하나의 키워드 목록 (기획 네 화면 공용)
// ------------------------------------------------------------
//  예전에는 키워드가 화면마다 따로 있었다 — 소재 발굴(레이더)의 유튜브 검색어, 시장 트렌드의
//  네이버 검색어 묶음. 새 프로젝트는 둘 다 비어 있어서 아무것도 조사하지 않았고, 어느 화면에서
//  고쳐야 하는지도 흩어져 있었다.
//
//  이제 프로젝트마다 목록 하나가 정본이다 (neander_shorts_settings[__id]/keywords).
//  저장하면 서버가 아래로 같이 적는다 (server/keywords.ts):
//    · 소재 발굴   레이더 검색어 = 이 목록 (하나에 유튜브 검색 1회)
//    · 시장 트렌드 네이버 추이 묶음 = 이 목록의 앞 12개 (키워드 하나가 한 줄)
//                  이름이 같은 묶음이 이미 있으면 그 묶음의 비슷한 말을 그대로 둔다
//    · 바이럴 형식 한국 채널은 소재 발굴이 찾은 영상에서 채운다 — 따라온다
//  성공 공식은 키워드로 조사하지 않는다 (분석한 레퍼런스에서 만든다).
//
//  순수 함수만 둔다 (브라우저 · 서버 공용).
// ============================================================

import { MAX_KEYWORD_GROUPS, type KeywordGroup } from "./market";

/** 레이더가 한 번에 받는 검색어 수와 같다 (radar.ts sanitizeRadarSettings) */
export const MAX_PROJECT_KEYWORDS = 20;
/** 네이버 추이 묶음으로 쓰는 앞 몇 개 */
export const NAVER_KEYWORDS = MAX_KEYWORD_GROUPS;

export interface ProjectKeywords {
  keywords: string[];
  updatedAt: number;
  updatedBy: string;
}

/** 비교용 — 대소문자 · 띄어쓰기를 무시한다 (「다이소 꿀템」 = 「다이소꿀템」) */
export const keywordKey = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 받은 값(목록 또는 쉼표 · 줄바꿈 글)을 키워드 목록으로 — 다듬고 겹친 것을 빼고 20개까지 */
export function sanitizeProjectKeywords(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const k = x.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!k || seen.has(keywordKey(k))) continue;
    seen.add(keywordKey(k));
    out.push(k);
    if (out.length >= MAX_PROJECT_KEYWORDS) break;
  }
  return out;
}

/** 묶음 id — 네이버 추이 기록이 키워드마다 같은 자리에 쌓이게 글자에서 만든다 */
const groupId = (k: string) => {
  let h = 5381;
  for (const c of keywordKey(k)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return `k${h.toString(36)}`;
};

/**
 * 키워드 목록 → 시장 트렌드의 네이버 추이 묶음. 앞 12개만, 키워드 하나가 한 줄.
 * 예전 묶음 중 이름이 같은 것은 id · 비슷한 말을 그대로 쓴다 (살림 기본 묶음 「다이소」 의 네 검색어 등).
 */
export function keywordGroupsOf(keywords: string[], prev: KeywordGroup[]): KeywordGroup[] {
  const byName = new Map(prev.map((g) => [keywordKey(g.name), g]));
  return keywords.slice(0, NAVER_KEYWORDS).map((k) => {
    const old = byName.get(keywordKey(k));
    return old ? { ...old, name: k } : { id: groupId(k), name: k, keywords: [k] };
  });
}
