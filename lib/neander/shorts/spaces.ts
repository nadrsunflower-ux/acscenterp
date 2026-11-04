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

/**
 * 자체 운영 = 우리 채널을 키운다 (쿠팡 수수료 · 광고 수익).
 * 대행 = 계약한 업체(고객사 · clients)의 브랜드를 맡아 운영한다 — 업체 하나에 프로젝트 여러 개.
 * 대행 프로젝트는 AI STUDIO 관리자와 그 업체 담당자만 본다 (계약 금액 · 브리프가 들어 있어서).
 */
export type SpaceKind = "own" | "agency";
export const SPACE_KIND_LABEL: Record<SpaceKind, string> = { own: "자체 운영", agency: "대행" };

export type SpaceProduction = "shoot" | "ai";
export const PRODUCTION_LABEL: Record<SpaceProduction, string> = { shoot: "직접 촬영", ai: "AI 생성" };

export interface SpaceDoc {
  name: string;
  /** 자체 운영 · 대행 — 만들 때 정하고 바꾸지 않는다 (없으면 자체 운영) */
  kind?: SpaceKind;
  /** 대행이면 계약 업체(고객사) id */
  clientId?: string | null;
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
  kind: "own",
  clientId: null,
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

/** 자체 운영 · 대행 (예전 문서는 kind 가 없다 — 자체 운영) */
export const spaceKind = (s: Pick<SpaceDoc, "kind"> | null | undefined): SpaceKind => (s?.kind === "agency" ? "agency" : "own");

/**
 * 이 사람이 이 프로젝트를 볼 수 있나 — 자체 운영은 팀 공용, 대행은 관리자 · 그 업체 담당자만.
 * membersOf: 업체 id → 담당자 이메일 (없는 업체면 undefined)
 */
export function canSeeSpace(s: Pick<SpaceDoc, "kind" | "clientId">, email: string, admin: boolean, membersOf: (clientId: string) => string[] | undefined): boolean {
  if (spaceKind(s) === "own" || admin) return true;
  return !!s.clientId && !!membersOf(s.clientId)?.includes(email);
}

/** 자료가 어느 프로젝트의 것인가 — spaceId 가 없으면 처음부터 있던 「살림설계사무소」 */
export const spaceOf = (d: { spaceId?: string | null } | null | undefined): string => d?.spaceId || DEFAULT_SPACE_ID;

/**
 * 이 프로젝트에 붙은 게시 계정 — 자체 운영은 우리 계정만, 대행은 그 프로젝트에 붙은 고객사 계정까지.
 * 하나라도 있으면 실제 채널이 있는 「운영 중」, 없으면 기획만 있고 채널이 아직 없는 「준비 중」 이다
 * (프로젝트 화면 · 대시보드 · 위 툴바의 프로젝트 고르기가 같은 기준으로 나눈다).
 */
export function spaceAccounts<A extends { spaceId?: string | null; clientId?: string | null }>(
  s: Pick<SpaceDoc, "kind"> & { id: string },
  accounts: A[],
): A[] {
  const agency = spaceKind(s) === "agency";
  return accounts.filter((a) => spaceOf(a) === s.id && (agency || !a.clientId));
}

export const isSpaceRunning = (s: Pick<SpaceDoc, "kind"> & { id: string }, accounts: { spaceId?: string | null; clientId?: string | null }[]) =>
  spaceAccounts(s, accounts).length > 0;

/** 프로젝트 id — 기본은 salim, 새로 만든 것은 sp + 영숫자 */
export const isSpaceId = (v: unknown): v is string => typeof v === "string" && (v === DEFAULT_SPACE_ID || /^sp[a-z0-9]{6,20}$/.test(v));

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+$/g, "").slice(0, max) : "");

export function sanitizeSpace(input: unknown, prev: SpaceDoc | null, email: string, now = Date.now()): SpaceDoc {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // 새로 만들 때 대본 방식을 안 정했으면 만드는 방식에서 (AI 생성 → 스토리 광고)
  const base = prev ?? { ...DEFAULT_SPACE, name: "", description: "", createdBy: email, createdAt: now, order: now, ...newSpaceDefaults(r.production === "ai" ? "ai" : "shoot") };
  const name = str(r.name, 40).trim() || base.name;
  if (!name) throw new Error("프로젝트 이름을 적어 주세요.");
  // 자체 운영 · 대행과 업체는 만들 때만 정한다 (자료가 그 업체의 담당자 권한을 따르므로)
  const kind: SpaceKind = prev ? spaceKind(prev) : r.kind === "agency" ? "agency" : "own";
  const clientId = prev ? (prev.clientId ?? null) : kind === "agency" && typeof r.clientId === "string" && /^[\w-]{6,60}$/.test(r.clientId) ? r.clientId : null;
  if (kind === "agency" && !clientId) throw new Error("대행 프로젝트는 계약 업체를 골라 주세요.");
  return {
    ...base,
    name,
    kind,
    clientId,
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
