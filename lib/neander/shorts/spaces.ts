// ============================================================
//  AI STUDIO 「프로젝트」 — 채널 하나의 기획 단위 (코드 이름 space)
// ------------------------------------------------------------
//  영상(코드 이름 project)과 헷갈리지 않게 코드에서는 space 라 부른다. 화면 이름은 「프로젝트」.
//  프로젝트마다 따로: 시장 트렌드 · 소재 발굴(레이더) · 바이럴 형식 · 성공 공식 · 소재 · 영상 · 폴더 ·
//  연결 계정 · 게시 · 성과 · 대본 작성기 · 트렌드 노트 · 자동 실행 설정과 AI 비용 상한.
//  공용: AI 모델 · 서버 키 · 사람별 채널 세트(쿠팡 키 · 검색 키) · 고객사 · YouTube 검색 한도.
//  팀 공용 — AI STUDIO 사용자 누구나 보고 만든다 (보관은 관리자만).
//
//  처음부터 있던 자료는 모두 「살림설계사무소」(DEFAULT_SPACE_ID) 의 것이다 — spaceId 가 없으면 이 프로젝트.
//  옮겨 적는 작업 없이 그대로 둔다.
// ============================================================

import type { ProjectKind } from "./types";

export const DEFAULT_SPACE_ID = "salim";

export type SpaceProduction = "shoot" | "ai";
export const PRODUCTION_LABEL: Record<SpaceProduction, string> = { shoot: "직접 촬영", ai: "AI 생성" };

export interface SpaceDoc {
  name: string;
  /** 어떤 채널인가 — 주제 · 시청자 · 톤 (AI 가 참고) */
  description: string;
  production: SpaceProduction;
  /** 새 영상의 기본 종류 */
  defaultKind: Exclude<ProjectKind, "brand">;
  /** 대본 작성기 기본 방식 */
  writerStyle: "intro" | "story";
  /** 목록 순서 (작을수록 위) */
  order: number;
  /** 보관 — 목록 · 자동 실행에서 빠진다 (자료는 그대로) */
  archived: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type SpaceView = SpaceDoc & { id: string };

export const DEFAULT_SPACE: SpaceDoc = {
  name: "살림설계사무소",
  description: "다이소 · 생활템을 직접 사서 찍어 소개하는 쇼츠 — 쿠팡 제휴 · 일반 정보",
  production: "shoot",
  defaultKind: "coupang",
  writerStyle: "intro",
  order: 0,
  archived: false,
  createdBy: "system",
  createdAt: 0,
  updatedAt: 0,
  updatedBy: "system",
};

/** 자료가 어느 프로젝트의 것인가 — spaceId 가 없으면 처음부터 있던 「살림설계사무소」 */
export const spaceOf = (d: { spaceId?: string | null } | null | undefined): string => d?.spaceId || DEFAULT_SPACE_ID;

/** 프로젝트 id — 기본은 salim, 새로 만든 것은 sp + 영숫자 */
export const isSpaceId = (v: unknown): v is string => typeof v === "string" && (v === DEFAULT_SPACE_ID || /^sp[a-z0-9]{6,20}$/.test(v));

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+$/g, "").slice(0, max) : "");

export function sanitizeSpace(input: unknown, prev: SpaceDoc | null, email: string, now = Date.now()): SpaceDoc {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // 새로 만들 때 대본 방식을 안 정했으면 만드는 방식에서 (AI 생성 → 스토리 광고)
  const base = prev ?? { ...DEFAULT_SPACE, name: "", description: "", createdBy: email, createdAt: now, order: now, ...newSpaceDefaults(r.production === "ai" ? "ai" : "shoot") };
  const name = str(r.name, 40).trim() || base.name;
  if (!name) throw new Error("프로젝트 이름을 적어 주세요.");
  return {
    ...base,
    name,
    description: r.description === undefined ? base.description : str(r.description, 1000).trim(),
    production: r.production === "ai" || r.production === "shoot" ? r.production : base.production,
    defaultKind: r.defaultKind === "general" || r.defaultKind === "coupang" ? r.defaultKind : base.defaultKind,
    writerStyle: r.writerStyle === "story" || r.writerStyle === "intro" ? r.writerStyle : base.writerStyle,
    order: typeof r.order === "number" && Number.isFinite(r.order) ? r.order : base.order,
    archived: typeof r.archived === "boolean" ? r.archived : base.archived,
    updatedAt: now,
    updatedBy: email,
  };
}

/** 새 프로젝트의 기본값 — AI 생성이면 스토리 광고 대본 */
export function newSpaceDefaults(production: SpaceProduction): Pick<SpaceDoc, "production" | "writerStyle"> {
  return { production, writerStyle: production === "ai" ? "story" : "intro" };
}

/** 목록 순서 — 기본 프로젝트 먼저, 그다음 순서 · 만든 때 */
export function sortSpaces<T extends SpaceDoc & { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(b.id === DEFAULT_SPACE_ID) - Number(a.id === DEFAULT_SPACE_ID) || a.order - b.order || a.createdAt - b.createdAt);
}

/** 화면이 지금 고른 프로젝트를 서버에 알리는 머리글 (client.ts 가 모든 요청에 붙인다) */
export const SPACE_HEADER = "x-neander-shorts-space";
