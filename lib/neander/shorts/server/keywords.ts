import "server-only";

// 조사 키워드 — 서버 쪽 (shorts/keywords.ts)
//
//  읽기: 저장한 적이 있으면 그 목록, 없으면 레이더 검색어(살림은 기본 살림 검색어, 새 프로젝트는 빈 목록).
//  저장: 키워드 문서 · 레이더 검색어 · 시장 트렌드 네이버 묶음을 한 번에 (batch) — 화면마다 따로 고치던
//  것이 어긋나지 않게. db 는 요청의 프로젝트로 감싼 것이다 (space-db.ts requestDb).

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { keywordGroupsOf, sanitizeProjectKeywords, type ProjectKeywords } from "../keywords";
import { getMarketSettings } from "./market";
import { getRadarSettings } from "./radar-run";

const settingsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings);

export async function getProjectKeywords(db: Firestore): Promise<ProjectKeywords & { saved: boolean }> {
  const d = (await settingsCol(db).doc("keywords").get()).data() as Partial<ProjectKeywords> | undefined;
  if (d && Array.isArray(d.keywords)) return { keywords: d.keywords, updatedAt: d.updatedAt ?? 0, updatedBy: d.updatedBy ?? "", saved: true };
  const radar = await getRadarSettings(db);
  return { keywords: radar.keywords, updatedAt: 0, updatedBy: "", saved: false };
}

export async function saveProjectKeywords(db: Firestore, by: string, input: unknown): Promise<ProjectKeywords> {
  const keywords = sanitizeProjectKeywords(input);
  const [radar, market] = await Promise.all([getRadarSettings(db), getMarketSettings(db)]);
  const now = Date.now();
  const stamp = { updatedAt: now, updatedBy: by };
  const col = settingsCol(db);
  const batch = db.batch();
  batch.set(col.doc("keywords"), { keywords, ...stamp });
  // 레이더 · 시장 설정의 다듬기(sanitize)는 빈 목록이면 옛 값을 지킨다 — 여기서는 다 지우는 것도 그대로 적는다
  batch.set(col.doc("radar"), { ...radar, keywords, ...stamp });
  batch.set(col.doc("market"), { ...market, groups: keywordGroupsOf(keywords, market.groups), ...stamp });
  await batch.commit();
  return { keywords, ...stamp };
}
