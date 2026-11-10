// ============================================================
//  GL AI 스튜디오 구독 플랜 — 표준 계약서의 가격표 · 1편 금액 · 약정 (순수 함수 · 화면 · 서버 공용)
// ------------------------------------------------------------
//  원본: 「GL AI 스튜디오 콘텐츠·마케팅 구독 서비스 계약서」(2026-10-29) 제2조 · 제3조 · 제6조 ⑤ · 제7조 ①.
//  업체(ClientDoc)의 계약 칸에 plan · term 을 고르면 가격표대로 월 금액 · 편수를 채운다.
//  금액은 협의로 바꿀 수 있다 — 표와 다르면 화면이 알려 줄 뿐 막지 않는다.
//  plan 이 없으면 플랜 없이 직접 정한 계약(예전 업체 포함)이고, 지금까지처럼 칸을 손으로 채운다.
//
//  수정 횟수는 둘로 센다 — 대본(scriptRevisionLimit, 계약 조건 기록) · 완성본(revisionLimit, 검토 링크가 센다).
//  revisionLimit 이라는 이름은 예전 문서와 맞추느라 그대로 둔다.
// ============================================================

import type { ClientDoc, ClientPlan, ClientTerm } from "./types";

export type { ClientPlan, ClientTerm };
export const CLIENT_PLAN_IDS = ["weekly", "start", "growth", "fullGrowth", "enterprise"] as const satisfies readonly ClientPlan[];
export const CLIENT_TERM_IDS = ["monthly", "m3", "m12"] as const satisfies readonly ClientTerm[];

export const TERM_LABEL: Record<ClientTerm, string> = { monthly: "월 단위", m3: "3개월 약정", m12: "12개월 약정" };
export const TERM_MONTHS: Record<ClientTerm, number> = { monthly: 1, m3: 3, m12: 12 };

export interface PlanInfo {
  label: string;
  /** 월 편수 — 엔터프라이즈는 견적서에 */
  videos: number | null;
  /** 월 이용료 (부가세 별도) — 엔터프라이즈는 별도 견적 */
  fees: Record<ClientTerm, number> | null;
  /** 그 플랜에 든 일 (제2조 ②) */
  summary: string;
}

export const CLIENT_PLANS: Record<ClientPlan, PlanInfo> = {
  weekly: { label: "주 1회 연재", videos: 4, fees: { monthly: 990_000, m3: 940_000, m12: 890_000 }, summary: "월 4편" },
  start: { label: "스타트", videos: 8, fees: { monthly: 1_500_000, m3: 1_420_000, m12: 1_350_000 }, summary: "월 8편(주 2회) · 월 1회 리뷰 미팅" },
  growth: { label: "그로스", videos: 8, fees: { monthly: 2_700_000, m3: 2_560_000, m12: 2_430_000 }, summary: "스타트 전부 + 인플루언서 시딩 월 20명 · 네이버 광고 운영 · 주간 경쟁사 · 시장 동향 리포트" },
  fullGrowth: { label: "풀 그로스", videos: 8, fees: { monthly: 3_500_000, m3: 3_320_000, m12: 3_150_000 }, summary: "그로스 전부 + 쿠팡 운영 · 광고 · 리뷰 · 재구매 관리" },
  enterprise: { label: "엔터프라이즈", videos: null, fees: null, summary: "별도 견적서로 정한다" },
};

/** 모든 플랜에 든 수정 횟수 (제6조 ⑤) — 영상 한 편당 */
export const PLAN_REVISIONS = { script: 2, cut: 2 } as const;
/** 넘는 수정 1회 금액 (부가세 별도, 미리 알리고 동의를 받는다) */
export const EXTRA_REVISION_KRW = 50_000;
/** 못 채운 시딩 1명 금액 (제7조 ①) */
export const SEEDING_UNIT_KRW = 30_000;

type Contract = ClientDoc["contract"];

export const isPlan = (v: unknown): v is ClientPlan => typeof v === "string" && (CLIENT_PLAN_IDS as readonly string[]).includes(v);
export const isTerm = (v: unknown): v is ClientTerm => typeof v === "string" && (CLIENT_TERM_IDS as readonly string[]).includes(v);

/** 가격표 금액 — 플랜 없음 · 엔터프라이즈는 null */
export const planFee = (plan: ClientPlan | null | undefined, term: ClientTerm = "monthly"): number | null => (plan ? (CLIENT_PLANS[plan].fees?.[term] ?? null) : null);
export const planVideos = (plan: ClientPlan | null | undefined): number | null => (plan ? CLIENT_PLANS[plan].videos : null);

/**
 * 1편 금액 (제7조 ①) — 못 채운 편을 빼거나 돌려줄 때 쓴다.
 * 주 1회 연재는 그 이용료의 4분의 1, 그 밖의 플랜은 같은 약정의 스타트 이용료의 8분의 1. 플랜 없음 · 엔터프라이즈는 null.
 */
export function videoUnitKrw(plan: ClientPlan | null | undefined, term: ClientTerm = "monthly"): number | null {
  if (!plan || plan === "enterprise") return null;
  if (plan === "weekly") return Math.round(CLIENT_PLANS.weekly.fees![term] / 4);
  return Math.round(CLIENT_PLANS.start.fees![term] / 8);
}

/** YYYY-MM 에 n 달을 더한다 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 약정의 마지막 달 — 시작 월부터 3 · 12 달. 월 단위 · 시작 월이 이상하면 null */
export function commitmentEndMonth(startMonth: string, term: ClientTerm | undefined): string | null {
  if (!term || term === "monthly" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) return null;
  return addMonths(startMonth, TERM_MONTHS[term] - 1);
}

/** 플랜 · 약정을 고르면 가격표대로 — 금액 · 편수 · 부가세 별도. 엔터프라이즈는 견적서 금액을 적도록 금액을 비운다 */
export function applyPlan<C extends Pick<Contract, "monthlyFeeKrw" | "vat" | "videosPerMonth" | "plan" | "term">>(c: C, plan: ClientPlan | null, term: ClientTerm): C {
  const next = { ...c, plan, term };
  if (!plan) return next;
  next.vat = "excluded";
  next.monthlyFeeKrw = planFee(plan, term);
  next.videosPerMonth = planVideos(plan) ?? c.videosPerMonth;
  return next;
}

/** 가격표와 다른 칸 — 협의한 값일 수 있어 막지 않고 알린다. 같으면 null */
export function planDiff(c: Pick<Contract, "monthlyFeeKrw" | "vat" | "videosPerMonth" | "plan" | "term">): { fee: number | null; videos: number | null; vat: boolean } | null {
  if (!c.plan || c.plan === "enterprise") return null;
  const fee = planFee(c.plan, c.term ?? "monthly");
  const videos = planVideos(c.plan);
  const d = { fee: fee !== null && c.monthlyFeeKrw !== fee ? fee : null, videos: videos !== null && c.videosPerMonth !== videos ? videos : null, vat: c.vat !== "excluded" };
  return d.fee !== null || d.videos !== null || d.vat ? d : null;
}

/** 「스타트 · 3개월 약정」 — 플랜 없으면 빈 글 */
export const planText = (c: Pick<Contract, "plan" | "term">): string => (c.plan ? `${CLIENT_PLANS[c.plan].label} · ${TERM_LABEL[c.term ?? "monthly"]}` : "");

export const scriptRevisions = (c: Pick<Contract, "scriptRevisionLimit">): number => c.scriptRevisionLimit ?? PLAN_REVISIONS.script;

/** 「대본 2회 · 완성본 2회」 */
export const revisionText = (c: Pick<Contract, "scriptRevisionLimit" | "revisionLimit">): string => `대본 ${scriptRevisions(c)}회 · 완성본 ${c.revisionLimit}회`;

/** 넘는 수정 1회 금액 — 표준 계약서(플랜)로 맺은 업체만. 직접 정한 계약은 null (따로 협의) */
export const extraRevisionKrw = (c: Pick<Contract, "plan">): number | null => (c.plan ? EXTRA_REVISION_KRW : null);

// ---- 저장 전 다듬기 (서버 client.save) ----------------------------------------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const monthOf = (v: unknown) => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/**
 * 계약 칸 다듬기. 금액을 안 적었는데 플랜이 가격표를 가지면 가격표 금액, 편수를 안 적었으면 플랜 편수를 쓴다
 * (비서 · MCP 처럼 플랜만 보내는 쪽도 계약이 채워지도록).
 */
export function cleanClientContract(raw: unknown, prev: Contract | null, fallbackStart: string): Contract {
  const c = (raw ?? {}) as Record<string, unknown>;
  const plan = isPlan(c.plan) ? c.plan : null;
  const term = isTerm(c.term) ? c.term : "monthly";
  const fee = typeof c.monthlyFeeKrw === "number" && Number.isFinite(c.monthlyFeeKrw) && c.monthlyFeeKrw >= 0 ? Math.round(c.monthlyFeeKrw) : planFee(plan, term);
  return {
    plan,
    term,
    monthlyFeeKrw: fee,
    vat: c.vat === "included" ? "included" : "excluded",
    videosPerMonth: clampInt(c.videosPerMonth, 1, 60, planVideos(plan) ?? 8),
    scriptRevisionLimit: clampInt(c.scriptRevisionLimit, 0, 10, PLAN_REVISIONS.script),
    revisionLimit: clampInt(c.revisionLimit, 0, 10, PLAN_REVISIONS.cut),
    startMonth: monthOf(c.startMonth) ?? prev?.startMonth ?? fallbackStart,
    endMonth: monthOf(c.endMonth),
    financeCode: str(c.financeCode, 30).trim(),
    // 재무 계약 프로젝트 코드 여러 개 (예전 한 칸도 받아 합친다)
    financeCodes: [...new Set([...(Array.isArray(c.financeCodes) ? c.financeCodes : []), c.financeCode].map((x) => str(x, 30).trim().toUpperCase()).filter((x) => /^[A-Z0-9][A-Z0-9-]{1,29}$/.test(x)))].slice(0, 20),
    note: str(c.note, 2000),
  };
}
