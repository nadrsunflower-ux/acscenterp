// ============================================================
//  쇼핑쇼츠 — 계산 · 규칙 (순수 함수, 브라우저 · 서버 공용)
// ------------------------------------------------------------
//  화면과 서버가 같은 셈을 하도록 여기 한 곳에 둔다. 외부 호출 없음.
//  검증: npm run shorts:test (model.test.ts)
// ============================================================

import type {
  AccountView,
  Beat,
  BeatKey,
  ChineseTermKind,
  ComplianceCheck,
  ComplianceKey,
  CoupangCandidate,
  CtaType,
  DomesticCheck,
  FormulaAnalysis,
  Measured,
  MetricSnapshotView,
  PerfMetricKey,
  ProjectDoc,
  ProjectStage,
  PublicationView,
  Scene,
  ScoreWeights,
  ScriptLine,
  SegmentPurpose,
  ShortsPlatform,
  SubtitleCue,
  TemplateDoc,
  TrendDoc,
  TrendMetricKey,
} from "./types";

// ---- 표준 문구 ------------------------------------------------------

/** 쿠팡 파트너스 표준 고지 — 게시 문구 첫 줄에 들어간다 (사용자 지정 문구 그대로) */
export const DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

/** AI 가상인물이 나오는 게시물 — 제목·첫 부분과 영상 안에 함께 (쿠팡 공지 189, 2026-06-11) */
export const VIRTUAL_HUMAN_TAG = "[광고][가상인물 포함]";

/** 게시 문구 첫 줄 */
export const disclosureLine = (virtualHuman: boolean) => (virtualHuman ? `${VIRTUAL_HUMAN_TAG} ${DISCLOSURE}` : DISCLOSURE);

/**
 * 영상 안 고지 띠 문구. 공정위 심사지침(2026-06-01)은 영상 전체가 추천이면 시작·끝과
 * 중간 반복을 요구한다 — 쇼츠는 짧아서 처음부터 끝까지 띠를 띄운다.
 * 한국어여야 한다 ('AD' · 'PR' 은 인정 안 됨).
 */
export const overlayText = (virtualHuman: boolean) =>
  virtualHuman ? "광고 · 가상인물 포함 · 쿠팡 파트너스 수수료 제공" : "광고 · 쿠팡 파트너스 활동으로 수수료를 받습니다";

/**
 * 브랜드 대행 영상을 **우리 채널**에 올릴 때의 고지 — 대가를 받은 광고다 (공정위 심사지침:
 * 한국어 「광고」 · 첫 부분). 고객사 **자기 계정**에 올리면 브랜드 자신의 광고라 이 고지가 필요 없다.
 */
export const brandDisclosureLine = (clientName: string) => `광고 · ${clientName || "브랜드"} 유료 광고`;

/** 영상 종류 이름 */
export const KIND_LABEL: Record<ProjectDoc["kind"], string> = { coupang: "쿠팡 제휴", brand: "고객사", general: "일반" };

/** 이 프로젝트의 영상 안 고지 띠 문구 — 필요 없으면 "" (고객사 자기 계정용 브랜드 영상 · 일반 영상) */
export function overlayFor(p: Pick<ProjectDoc, "kind" | "brandTarget" | "clientName" | "virtualHuman">): string {
  // 일반 영상은 광고가 아니라 고지 띠가 없다 — AI 가상인물이 나오면 그 표시만
  if (p.kind === "general") return p.virtualHuman ? "가상인물 포함" : "";
  if (p.kind !== "brand") return overlayText(p.virtualHuman);
  if (p.brandTarget === "own") return `${brandDisclosureLine(p.clientName)}${p.virtualHuman ? " · 가상인물 포함" : ""}`;
  return p.virtualHuman ? "가상인물 포함" : "";
}

/** 이 달 (KST, YYYY-MM) */
export const currentMonth = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 7);

export const STAGE_LABEL: Record<ProjectStage, string> = {
  research: "소재 조사",
  sourcing: "소스 수집",
  matching: "쿠팡 확인",
  scripting: "대본·장면",
  editing: "편집·출력",
  ready: "게시 준비",
  published: "게시됨",
  archived: "보관",
};

export const PLATFORM_LABEL: Record<ShortsPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  xiaohongshu: "샤오홍슈",
  douyin: "더우인",
  coupang: "쿠팡",
  other: "기타",
};

/**
 * 플랫폼별로 이 모듈이 실제로 해 주는 것. 화면이 이 표를 그대로 보여 준다 —
 * 「자동 수집」 을 말하려면 여기 api 가 있어야 한다.
 */
export const PLATFORM_SUPPORT: Record<
  ShortsPlatform,
  { search: "api" | "link" | "none"; metrics: "api" | "manual"; download: "upload_only"; note: string }
> = {
  youtube: {
    search: "api",
    metrics: "api",
    download: "upload_only",
    note: "검색·공개 통계는 YouTube Data API(서버 키 필요). 영상 파일은 직접 올린다.",
  },
  instagram: {
    search: "link",
    metrics: "manual",
    download: "upload_only",
    note: "남의 게시물 검색·통계 API 없음 — 링크 등록과 직접 입력. 내 계정 게시물만 API 로 성과를 읽는다.",
  },
  tiktok: { search: "link", metrics: "manual", download: "upload_only", note: "공개 검색 API 미연결 — 링크 등록과 직접 입력." },
  xiaohongshu: {
    search: "link",
    metrics: "manual",
    download: "upload_only",
    note: "제3자용 공개 검색 API 없음 — 검색창을 새 탭으로 열고, 고른 영상의 링크·파일을 등록한다.",
  },
  douyin: { search: "link", metrics: "manual", download: "upload_only", note: "검색창 열기 · 링크 등록 · 파일 올리기." },
  coupang: { search: "api", metrics: "manual", download: "upload_only", note: "파트너스 API 권한이 있으면 상품 검색, 없으면 직접 확인." },
  other: { search: "none", metrics: "manual", download: "upload_only", note: "링크 등록과 직접 입력." },
};

export const SEGMENT_PURPOSE_LABEL: Record<SegmentPurpose, string> = {
  hook: "후킹",
  problem: "문제 제기",
  product: "제품 등장",
  demo: "사용 장면",
  compare: "비교",
  twist: "반전",
  proof: "근거",
  cta: "CTA",
  broll: "보조 화면",
};

export const BEAT_LABEL: Record<BeatKey, string> = {
  hook: "후킹",
  problem: "문제 제기",
  empathy: "공감",
  reveal: "제품 등장",
  demo: "사용 장면",
  compare: "비교",
  twist: "반전",
  proof: "근거",
  cta: "CTA",
};

export const CTA_LABEL: Record<CtaType, string> = {
  comment_keyword: "댓글 키워드",
  dm_keyword: "DM 키워드",
  link_in_bio: "프로필 링크",
  pinned_comment: "고정 댓글",
  description_link: "설명란 링크",
  other: "기타",
};

export const TERM_KIND_LABEL: Record<ChineseTermKind, string> = {
  name: "상품명",
  synonym: "동의어",
  use: "용도",
  problem: "문제 상황",
};

// ---- 작은 도구 ------------------------------------------------------

export const newId = (prefix = "") =>
  prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function httpUrl(value: string): string {
  try {
    const u = new URL(value.trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return "";
    return u.href;
  } catch {
    return "";
  }
}

export const clampNum = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

/** 0 이상의 정수 또는 null (빈칸 · 음수 · 숫자 아님은 null) */
export function countOrNull(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : Number(String(n).replace(/,/g, ""));
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

export const measured = (v: number | null, src: Measured["src"], ref?: string, at?: number): Measured => ({
  v,
  src,
  ...(at ? { at } : {}),
  ...(ref ? { ref } : {}),
});

export const SOURCE_LABEL: Record<Measured["src"], string> = {
  api: "공식 API",
  manual: "직접 입력",
  estimate: "추정",
  ai: "AI 제안",
};

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1).replace(/\.0$/, "")}만`;
  return n.toLocaleString("ko-KR");
}

export const fmtPct = (r: number | null, digits = 2) =>
  r === null || !Number.isFinite(r) ? "—" : `${(r * 100).toFixed(digits).replace(/\.?0+$/, "")}%`;

export function fmtSec(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}초`;
}

// ---- 반응 점수 ------------------------------------------------------

export const DEFAULT_WEIGHTS: ScoreWeights = { likes: 1, comments: 3, saves: 4, shares: 3, infoRequests: 6 };

export const METRIC_LABEL: Record<TrendMetricKey | PerfMetricKey, string> = {
  views: "조회",
  likes: "좋아요",
  comments: "댓글",
  saves: "저장",
  shares: "공유",
  infoRequests: "정보 요청",
  clicks: "제휴 클릭",
  orders: "주문",
  revenue: "제휴 수익",
};

export interface TrendScore {
  /** 조회 1,000회당 가중 반응 — 쓸 수 있는 지표가 없으면 null */
  score: number | null;
  used: { key: Exclude<TrendMetricKey, "views">; perK: number; weight: number; src: Measured["src"] }[];
  missing: Exclude<TrendMetricKey, "views">[];
  formula: string;
}

/**
 * 반응 점수 = Σ(가중치 × 조회 1천회당 지표) ÷ Σ(쓴 가중치).
 *
 * 모르는 지표(null)는 0 으로 넣지 않고 빼며 가중치도 같이 뺀다 — 비공개 저장 수를
 * 0 으로 넣으면 저장이 많은 영상이 손해를 본다. 무엇을 빼고 셌는지 missing 에 남긴다.
 * 정보 요청은 댓글 표본의 비율이 있으면 「댓글 × 표본 비율」 로 환산한다.
 */
export function scoreTrend(
  trend: Pick<TrendDoc, "metrics" | "infoSample">,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): TrendScore {
  const views = trend.metrics.views?.v ?? null;
  const keys = Object.keys(DEFAULT_WEIGHTS) as Exclude<TrendMetricKey, "views">[];
  const used: TrendScore["used"] = [];
  const missing: TrendScore["missing"] = [];
  for (const key of keys) {
    const w = Math.max(0, Number(weights[key]) || 0);
    let value = trend.metrics[key]?.v ?? null;
    let src = trend.metrics[key]?.src ?? "manual";
    if (key === "infoRequests" && value === null) {
      const rate = infoRequestRate(trend.infoSample);
      const comments = trend.metrics.comments?.v ?? null;
      if (rate !== null && comments !== null) {
        value = Math.round(comments * rate);
        src = "estimate";
      }
    }
    if (value === null || !views || views <= 0) {
      missing.push(key);
      continue;
    }
    if (w === 0) continue;
    used.push({ key, perK: (value / views) * 1000, weight: w, src });
  }
  const wsum = used.reduce((n, u) => n + u.weight, 0);
  const score = wsum > 0 ? Math.round((used.reduce((n, u) => n + u.perK * u.weight, 0) / wsum) * 100) / 100 : null;
  const formula = used.length
    ? `(${used.map((u) => `${u.weight}×${METRIC_LABEL[u.key]}/천회`).join(" + ")}) ÷ ${wsum}`
    : "조회수와 반응 지표가 함께 있어야 계산합니다";
  return { score, used, missing, formula };
}

/** 정보 요청 댓글 비율 (표본) — 표본이 없으면 null */
export function infoRequestRate(s: TrendDoc["infoSample"] | null | undefined): number | null {
  if (!s || s.sampled === null || s.matched === null || s.sampled <= 0) return null;
  return Math.min(1, s.matched / s.sampled);
}

/** 기본 정보 요청 낱말 — 댓글 표본을 셀 때 */
export const INFO_REQUEST_KEYWORDS = [
  "어디서",
  "어디 제품",
  "제품명",
  "정보",
  "링크",
  "구매",
  "살 수",
  "사고 싶",
  "판매처",
  "dm",
  "디엠",
  "where",
  "link",
  "buy",
  "哪里买",
  "链接",
  "求链接",
];

/** 댓글 글 묶음에서 정보 요청 댓글을 센다 (공식 API 로 읽은 댓글 · 붙여 넣은 댓글 모두) */
export function countInfoRequests(comments: string[], keywords: string[] = INFO_REQUEST_KEYWORDS) {
  const ks = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const matched = comments.filter((c) => {
    const t = c.toLowerCase();
    return ks.some((k) => t.includes(k));
  }).length;
  return { sampled: comments.length, matched };
}

/**
 * 증가 속도 (조회/일). 같은 영상을 두 번 이상 모았으면 실제 증가로 재고(estimate 지만
 * 근거가 있다), 한 번뿐이면 게시일 이후 평균으로 잰다(누적 평균 — 최근 속도가 아니다).
 */
export function viewVelocity(
  t: Pick<TrendDoc, "viewHistory" | "publishedAt" | "collectedAt" | "metrics">,
): { perDay: number | null; basis: "history" | "since_publish" | null; label: string } {
  const h = [...(t.viewHistory ?? [])].sort((a, b) => a.at - b.at);
  if (h.length >= 2) {
    const a = h[h.length - 2];
    const b = h[h.length - 1];
    const days = (b.at - a.at) / 86_400_000;
    if (days > 0.01) {
      const perDay = Math.max(0, (b.views - a.views) / days);
      return { perDay, basis: "history", label: `최근 두 번 수집 사이 ${days.toFixed(1)}일의 증가` };
    }
  }
  const views = t.metrics.views?.v ?? null;
  const pub = t.publishedAt ? Date.parse(t.publishedAt) : NaN;
  if (views !== null && Number.isFinite(pub)) {
    const days = Math.max(1 / 24, (t.collectedAt - pub) / 86_400_000);
    return { perDay: views / days, basis: "since_publish", label: `게시 후 ${days.toFixed(1)}일 평균 (누적 평균)` };
  }
  return { perDay: null, basis: null, label: "게시일 또는 두 번 이상의 수집 기록이 필요합니다" };
}

/**
 * 국내 확산 상태 문구. 「유행하지 않았다」 고 단정하지 않는다 — 검색 표본에서
 * 못 찾은 것은 그 표본에서 못 찾은 것일 뿐이다.
 */
export function domesticLabel(d: DomesticCheck | null | undefined): { text: string; tone: "neutral" | "info" | "success" } {
  if (!d || d.status === "unchecked") return { text: "국내 유사 콘텐츠 미확인", tone: "neutral" };
  const how = d.method === "api" ? "YouTube 검색 표본" : "직접 검색";
  const size = d.sampleSize ? ` ${d.sampleSize}건` : "";
  if (d.status === "found") return { text: `국내 유사 콘텐츠 ${d.matches.length}건 확인 (${how}${size})`, tone: "info" };
  return {
    text: `${how}${size}에서 유사 콘텐츠를 찾지 못함 — 국내 미확산을 뜻하지는 않습니다`,
    tone: "success",
  };
}

// ---- 검색어 · 링크 --------------------------------------------------

const xhsSearchUrl = (q: string) => `https://www.xiaohongshu.com/search_result?keyword=${q}&type=51`;
const douyinSearchUrl = (q: string) => `https://www.douyin.com/search/${q}?type=video`;

/** 직접 검색 링크 — 자동 수집이 없는 플랫폼은 새 탭으로 연다 */
export function searchLinks(term: string): { platform: ShortsPlatform | "taobao" | "1688"; label: string; url: string }[] {
  const q = encodeURIComponent(term.trim());
  if (!q) return [];
  return [
    { platform: "xiaohongshu", label: "샤오홍슈", url: xhsSearchUrl(q) },
    { platform: "douyin", label: "더우인", url: douyinSearchUrl(q) },
    { platform: "taobao", label: "타오바오(상품 확인)", url: `https://s.taobao.com/search?q=${q}` },
    { platform: "1688", label: "1688(상품 확인)", url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q}` },
  ];
}

/** 소재 발굴에서 직접 둘러보는 플랫폼 (새 탭) */
export const BROWSE_PLATFORMS = ["instagram", "tiktok", "xiaohongshu", "douyin", "youtube"] as const;
export type BrowsePlatform = (typeof BROWSE_PLATFORMS)[number];

/** 샤오홍슈 · 더우인은 중국어로 검색해야 결과가 나온다 */
export const isChinesePlatform = (p: ShortsPlatform) => p === "xiaohongshu" || p === "douyin";

/** 둘러보기 주소 — 검색어가 있으면 짧은 영상 검색, 없으면 그 플랫폼의 탐색 화면 */
export function browseUrl(platform: BrowsePlatform, term: string): string {
  const q = encodeURIComponent(term.trim());
  switch (platform) {
    case "instagram":
      return q ? `https://www.instagram.com/explore/search/keyword/?q=${q}` : "https://www.instagram.com/reels/";
    case "tiktok":
      return q ? `https://www.tiktok.com/search/video?q=${q}` : "https://www.tiktok.com/explore";
    case "xiaohongshu":
      return q ? xhsSearchUrl(q) : "https://www.xiaohongshu.com/explore";
    case "douyin":
      return q ? douyinSearchUrl(q) : "https://www.douyin.com/";
    case "youtube":
      return q ? youtubeSearchUrl(term) : "https://www.youtube.com/shorts";
  }
}

/**
 * 붙여 넣은 글에서 첫 주소. 샤오홍슈 · 더우인 앱의 「공유」 문구는 설명 글 가운데에
 * 주소가 있다 — 문구째 붙여도 된다. 전각 쉼표 등 주소 밖 글자에서 끊고, 끝 문장부호는 뗀다.
 */
export function extractUrl(text: string): string {
  const m = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/.exec(text);
  return m ? httpUrl(m[0].replace(/[.,;:!?'")\]]+$/, "")) : "";
}

/**
 * 영상 하나를 가리키는 열쇠 — 같은 영상을 두 번 넣지 않으려고 쓴다. 주소 모양이 플랫폼마다
 * 여럿이다: 더우인 웹은 보고 있는 영상을 `?modal_id=` 로, 샤오홍슈는 경로 끝 24자리 노트 id,
 * 인스타는 /reel/ · /reels/ · /p/ 뒤 코드. 앱의 짧은 공유 주소는 그 자체를 열쇠로 쓴다.
 * 알려진 플랫폼인데 영상 주소가 아니면(검색 · 탐색 · 프로필 화면) null.
 */
export function videoKey(value: string): string | null {
  const u = parseUrl(value);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  switch (platformFromUrl(value)) {
    case "youtube": {
      const id = youtubeVideoId(value);
      return id ? `youtube:${id}` : null;
    }
    case "instagram": {
      const m = /^\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)$/.exec(path);
      return m ? `instagram:${m[1]}` : null;
    }
    case "tiktok": {
      const m = /\/(?:video|photo)\/(\d+)$/.exec(path);
      if (m) return `tiktok:${m[1]}`;
      return /^(?:vm|vt)\.tiktok\.com$/.test(host) && path.length > 1 ? `tiktok:short${path}` : null;
    }
    case "xiaohongshu": {
      if (host === "xhslink.com") return path.length > 1 ? `xiaohongshu:short${path}` : null;
      const m = /^\/(?:explore|discovery\/item|search_result|user\/profile\/[0-9a-f]{24})\/([0-9a-f]{24})$/i.exec(path);
      return m ? `xiaohongshu:${m[1].toLowerCase()}` : null;
    }
    case "douyin": {
      const modal = u.searchParams.get("modal_id");
      if (modal && /^\d+$/.test(modal)) return `douyin:${modal}`;
      const m = /\/(?:video|note)\/(\d+)$/.exec(path);
      if (m) return `douyin:${m[1]}`;
      return host === "v.douyin.com" && path.length > 1 ? `douyin:short${path}` : null;
    }
    default:
      return `${host}${path}`;
  }
}

/** 브라우저 탭 제목에서 플랫폼 이름 꼬리를 뗀다 (「… - 小红书」 「… | TikTok」) */
export function cleanPageTitle(title: string): string {
  const t = title
    .trim()
    .replace(/\s*[-|–·•]\s*(?:小红书|抖音|TikTok|YouTube|Instagram)(?:\s*[-–]\s*[^-|–]*)?$/i, "")
    .trim();
  return /^(?:小红书|抖音|TikTok|YouTube|Instagram)$/i.test(t) ? "" : t.slice(0, 300);
}

export const coupangSearchUrl = (term: string) =>
  `https://www.coupang.com/np/search?q=${encodeURIComponent(term.trim())}`;

export const youtubeSearchUrl = (term: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(term.trim())}&sp=EgIYAQ%253D%253D`;

/** 쿠팡 상품 상세 주소인가 (www.coupang.com/vp/products/숫자) */
export function isCoupangProductUrl(value: string): boolean {
  const u = parseUrl(value);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return (host === "coupang.com" || host.endsWith(".coupang.com")) && /^\/vp\/products\/\d+(?:\/|$)/.test(u.pathname);
}

/** 쿠팡 파트너스 링크인가 (link.coupang.com/a/… 단축 또는 /re/ 랜딩) */
export function isCoupangAffiliateUrl(value: string): boolean {
  const u = parseUrl(value);
  if (!u) return false;
  return u.hostname.toLowerCase() === "link.coupang.com" && (/^\/a\/[A-Za-z0-9]+\/?$/.test(u.pathname) || u.pathname.startsWith("/re/"));
}

export function coupangProductId(value: string): string | null {
  const u = parseUrl(value);
  if (!u) return null;
  const m = /\/vp\/products\/(\d+)/.exec(u.pathname);
  if (m) return m[1];
  const p = u.searchParams.get("pageKey");
  return p && /^\d+$/.test(p) ? p : null;
}

function parseUrl(value: string): URL | null {
  try {
    const u = new URL(value.trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function youtubeVideoId(value: string): string | null {
  const u = parseUrl(value);
  if (!u) return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
  if (host === "youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname);
    if (m) return m[1];
  }
  return null;
}

export function platformFromUrl(value: string): ShortsPlatform {
  const u = parseUrl(value);
  if (!u) return "other";
  const h = u.hostname.toLowerCase();
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return "youtube";
  if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
  if (/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
  if (/(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$/.test(h)) return "xiaohongshu";
  if (/(^|\.)(?:ies)?douyin\.com$/.test(h)) return "douyin";
  if (/(^|\.)coupang\.com$/.test(h)) return "coupang";
  return "other";
}

// ---- 쿠팡 동일 상품 ---------------------------------------------------

/** 확인된 동일 상품 (사람이 identical 로 바꾼 것) — 여럿이면 가장 최근 */
export function confirmedCandidate(p: Pick<ProjectDoc, "coupang">): CoupangCandidate | null {
  const list = p.coupang.candidates.filter((c) => c.match === "identical" && c.confirmedBy);
  return list.sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0))[0] ?? null;
}

/** 대조 항목 중 사람이 「같다」 고 표시한 수 / 본 수 */
export function matchChecksSummary(c: CoupangCandidate) {
  const vals = Object.values(c.checks);
  return {
    seen: vals.filter((v) => v !== null).length,
    same: vals.filter((v) => v === true).length,
    different: vals.filter((v) => v === false).length,
    total: vals.length,
  };
}

// ---- 문장 검사 (확인되지 않은 주장 · 무효 클릭 유도) ----------------------

export interface ClaimFlag {
  kind: "price" | "discount" | "scarcity" | "review" | "efficacy" | "invalid_click" | "ranking" | "banned";
  phrase: string;
  message: string;
}

const CLAIM_RULES: { kind: ClaimFlag["kind"]; re: RegExp; message: string }[] = [
  { kind: "price", re: /\d[\d,]*\s*(원|₩|만\s*원)|[₩￦]\s*\d/g, message: "가격은 바뀌므로 확인 시점 없이 적지 않습니다" },
  { kind: "discount", re: /\d+\s*%\s*(할인|세일|off)|최저가|특가|반값|할인\s*중|세일\s*중|쿠폰가/gi, message: "할인·최저가는 확인된 사실이 아니면 쓰지 않습니다" },
  { kind: "scarcity", re: /품절\s*(임박|직전)|곧\s*품절|마감\s*임박|한정\s*수량|재고\s*(얼마|몇\s*개)\s*안/g, message: "확인하지 않은 품절·한정 표현은 거짓 광고가 됩니다" },
  { kind: "review", re: /내돈내산|직접\s*(써|사용해)\s*(봤|보니)|써\s*보니|사용\s*후기|실사용\s*후기|별점\s*\d/g, message: "실제 사용·후기가 아니면 후기처럼 쓰지 않습니다" },
  { kind: "efficacy", re: /100\s*%|완벽(하게|히)?\s*(제거|해결|차단)|효과\s*보장|무조건|치료|완치|의학적|기적/g, message: "과장된 효능·보장 표현입니다" },
  { kind: "ranking", re: /판매\s*1\s*위|랭킹\s*1\s*위|\d+\s*만\s*개\s*판매|누적\s*판매/g, message: "순위·판매량은 근거 없이 쓰지 않습니다" },
  // 쿠팡 파트너스 공지 200 의 금지 문구 예시와 브랜드 가치 훼손 표현
  { kind: "discount", re: /가격\s*오류|쿠팡\s*미쳤|마지막\s*기회|땡처리|재고\s*정리/g, message: "쿠팡 파트너스가 금지한 가격·브랜드 표현입니다" },
  {
    kind: "invalid_click",
    re: /(링크|버튼)\s*(만\s*)?(눌러|클릭해)\s*(주시면|주면)\s*(도움|힘|감사)|클릭\s*(만\s*)?해\s*주세요|구매\s*안\s*해도\s*(클릭|눌러)/g,
    message: "구매 의사와 무관한 클릭 유도는 무효 클릭에 해당할 수 있습니다",
  },
];

/**
 * 대본·문구에서 확인되지 않은 주장을 찾는다. facts(확인된 사실)에 같은 말이
 * 있으면 넘어간다 — 예: 확인된 가격을 적은 경우.
 */
export function scanClaims(text: string, facts: string[] = [], banned: string[] = []): ClaimFlag[] {
  const factText = facts.join("\n");
  const out: ClaimFlag[] = [];
  // 고객사가 정한 금지 표현 — 사실 목록에 있어도 넘어가지 않는다
  const lower = text.toLowerCase();
  for (const b of banned.map((x) => x.trim()).filter(Boolean)) {
    if (lower.includes(b.toLowerCase()) && !out.some((f) => f.phrase === b)) out.push({ kind: "banned", phrase: b, message: "고객사 금지 표현입니다" });
  }
  for (const rule of CLAIM_RULES) {
    for (const m of text.matchAll(rule.re)) {
      const phrase = m[0].trim();
      if (rule.kind !== "invalid_click" && factText.includes(phrase)) continue;
      // 같은 낱말을 금지 표현으로 이미 잡았으면 한 번만
      if (!out.some((f) => (f.kind === rule.kind || f.kind === "banned") && f.phrase.toLowerCase() === phrase.toLowerCase())) out.push({ kind: rule.kind, phrase, message: rule.message });
    }
  }
  return out;
}

// ---- 게시 문구 ------------------------------------------------------

/** 문구 첫 줄이 표준 고지인가 (가상인물 표기가 앞에 붙는 것만 허용) */
export const startsWithDisclosure = (caption: string) => {
  const t = caption.trimStart();
  return t.startsWith(DISCLOSURE) || t.startsWith(`${VIRTUAL_HUMAN_TAG} ${DISCLOSURE}`);
};

export function hashtagLine(tags: string[]): string {
  return tags
    .map((t) => t.trim().replace(/^#+/, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .slice(0, 15)
    .map((t) => `#${t}`)
    .join(" ");
}

/**
 * 플랫폼별 게시 문구. 고지는 항상 첫 줄이다 — 사용자가 설명란에 고지를 지워도
 * 여기서 다시 맨 앞에 붙는다. Instagram 캡션의 링크는 눌리지 않으므로 링크
 * 대신 CTA(키워드 댓글 · 프로필 링크)를 쓴다.
 */
export function buildCaption(
  p: Pick<ProjectDoc, "publish" | "cta" | "coupang" | "virtualHuman"> & Partial<Pick<ProjectDoc, "kind" | "clientName">>,
  platform: "youtube" | "instagram",
  ctx: { ownBrandAccount?: boolean } = {},
): string {
  if (p.kind === "general") {
    // 일반 영상: 제휴 · 대가가 없어 고지 문구를 붙이지 않는다 (쿠팡 링크도 붙이지 않는다)
    const body = p.publish.description.trim();
    const lines = p.virtualHuman ? ["가상인물 포함", ""] : [];
    if (body) lines.push(body, "");
    if (p.cta.wording.trim()) lines.push(p.cta.wording.trim(), "");
    const tags = hashtagLine(p.publish.hashtags);
    if (tags) lines.push(tags);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (p.kind === "brand") {
    // 브랜드 영상: 쿠팡 고지 · 쿠팡 링크가 없다. 우리 채널이면 「광고」 를 첫 줄에, 고객사 계정이면 자기 광고
    const body = p.publish.description.replace(brandDisclosureLine(p.clientName ?? ""), "").trim();
    const head = ctx.ownBrandAccount ? (p.virtualHuman ? "가상인물 포함" : "") : `${brandDisclosureLine(p.clientName ?? "")}${p.virtualHuman ? " · 가상인물 포함" : ""}`;
    const lines = head ? [head, ""] : [];
    if (body) lines.push(body, "");
    if (p.cta.wording.trim()) lines.push(p.cta.wording.trim(), "");
    const tags = hashtagLine(p.publish.hashtags);
    if (tags) lines.push(tags);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  const body = p.publish.description.replace(VIRTUAL_HUMAN_TAG, "").replace(DISCLOSURE, "").trim();
  const link = p.coupang.affiliate?.url ?? "";
  const lines = [disclosureLine(!!p.virtualHuman), ""];
  if (body) lines.push(body, "");
  if (platform === "youtube" && link) lines.push(`제품 정보: ${link}`, "");
  if (p.cta.wording.trim()) lines.push(p.cta.wording.trim(), "");
  const tags = hashtagLine(p.publish.hashtags);
  if (tags) lines.push(tags);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const CAPTION_LIMIT = { youtube: 5000, instagram: 2200 } as const;
export const TITLE_LIMIT = 100;

/** YouTube 설명은 5,000바이트, Instagram 캡션은 2,200자 */
export function captionLength(caption: string, platform: "youtube" | "instagram") {
  return platform === "youtube" ? new TextEncoder().encode(caption).byteLength : [...caption].length;
}

// ---- 정책 확인 ------------------------------------------------------

export const COMPLIANCE_ITEMS: { key: ComplianceKey; label: string; required: boolean; how: string }[] = [
  {
    key: "disclosure",
    label: "게시 문구 첫 부분에 경제적 이해관계 고지",
    required: true,
    how: "프로그램이 게시 문구 첫 줄을 확인합니다. 영상 화면 안 고지는 사람이 확인합니다.",
  },
  {
    key: "videoDisclosure",
    label: "영상 안 「광고」 고지",
    required: true,
    how: "쇼츠는 영상 안·유료광고 배너·제목 중 하나에 더해 설명란 첫 부분에도 필요합니다(쿠팡 공지 160). 출력기가 고지 띠를 넣었는지 기록합니다.",
  },
  {
    key: "channelRegistered",
    label: "게시 계정이 쿠팡 파트너스 활동 채널로 등록됨",
    required: true,
    how: "파트너스 사이트에서 확인한 사람이 계정 설정에 기록합니다 (API 로 확인하지 않습니다).",
  },
  {
    key: "productMatch",
    label: "소개 내용과 연결 상품이 일치",
    required: true,
    how: "동일 상품 확인 기록과 제휴 링크가 같은 후보인지 프로그램이 보고, 영상 속 상품과 같은지는 사람이 확인합니다.",
  },
  {
    key: "claims",
    label: "확인되지 않은 가격·할인·성능·후기 표현 없음",
    required: true,
    how: "프로그램이 대본·문구에서 의심 표현을 찾고, 사람이 최종 확인합니다.",
  },
  {
    key: "invalidClick",
    label: "구매와 무관한 클릭 유도 · 무차별 DM 없음",
    required: true,
    how: "프로그램이 클릭 유도 문구를 찾고, DM 운영 방식은 사람이 확인합니다.",
  },
  {
    key: "dmConsent",
    label: "DM 은 먼저 요청한 사람에게만, 답장에도 고지 포함",
    required: true,
    how: "사전 동의 없는 DM 은 금지이고 동의한 DM 에도 대가성 문구가 필요합니다. 운영 방식은 사람이 확인합니다.",
  },
  {
    key: "sourceRights",
    label: "해외 소스 출처·이용 조건 기록 (선택)",
    required: false,
    how: "선택 항목 — 기록이 없어도 편집·게시를 막지 않습니다.",
  },
];

/** 브랜드 대행 영상의 확인 항목 — 쿠팡 항목(채널 등록 · 상품 일치 · DM)이 없고 고객 승인이 있다 */
export function brandComplianceItems(ownBrandAccount: boolean): typeof COMPLIANCE_ITEMS {
  return [
    ...(ownBrandAccount
      ? []
      : [
          { key: "disclosure" as const, label: "게시 문구 첫 부분에 「광고」 고지 (우리 채널에 올리는 대가 받은 광고)", required: true, how: "프로그램이 게시 문구 첫 줄을 확인합니다. 고객사 자기 계정에 올리면 필요 없습니다." },
          { key: "videoDisclosure" as const, label: "영상 안 「광고」 고지", required: true, how: "출력기가 고지 띠를 넣었는지 기록합니다 (영상 전체가 광고면 처음부터 끝까지)." },
        ]),
    { key: "clientApproval", label: "고객사가 이 완성 파일을 승인함", required: true, how: "검토 링크 · 담당자 기록에서 승인된 파일이 지금 게시할 파일과 같은지 프로그램이 봅니다. 사람 확인으로 넘길 수 없습니다." },
    { key: "claims", label: "고객사 금지 표현 · 확인되지 않은 성능·가격·후기 표현 없음", required: true, how: "프로그램이 금지 표현과 의심 표현을 찾고, 사람이 최종 확인합니다." },
    { key: "sourceRights", label: "사용한 소스 · 음원의 출처·이용 조건 기록 (선택)", required: false, how: "선택 항목 — 기록이 없어도 막지 않습니다." },
  ];
}

/**
 * 일반 영상(제휴 없음)의 확인 항목 — 고지가 필요 없는 대신 「정말 대가가 없는가」 를 사람이 확인한다.
 * 제휴 링크 · 협찬이 있으면 일반 영상이 아니다 (쿠팡 영상 · 고객사 영상으로 바꾼다).
 */
export const GENERAL_COMPLIANCE_ITEMS: typeof COMPLIANCE_ITEMS = [
  {
    key: "noPaidRelation",
    label: "제휴 링크 · 협찬 · 대가 없음 (있으면 쿠팡 영상이나 고객사 영상으로 바꿔 주세요)",
    required: true,
    how: "프로그램이 제목 · 게시 문구 · 대본에서 쿠팡 제휴 링크와 「쿠팡 파트너스 · 유료 광고 · 협찬」 같은 말을 찾고, 대가가 없다는 것은 사람이 확인합니다.",
  },
  {
    key: "claims",
    label: "확인되지 않은 가격·할인·성능·후기 표현 없음",
    required: true,
    how: "프로그램이 대본·문구에서 의심 표현을 찾고, 사람이 최종 확인합니다.",
  },
  {
    key: "sourceRights",
    label: "사용한 소스 · 음원의 출처·이용 조건 기록 (선택)",
    required: false,
    how: "선택 항목 — 기록이 없어도 편집·게시를 막지 않습니다.",
  },
];

export const complianceItemsFor = (p: Pick<ProjectDoc, "kind">, ownBrandAccount: boolean) =>
  p.kind === "brand" ? brandComplianceItems(ownBrandAccount) : p.kind === "general" ? GENERAL_COMPLIANCE_ITEMS : COMPLIANCE_ITEMS;

/** 일반 영상에 있으면 안 되는 것 — 제휴 링크 · 대가 표시 */
const PAID_LINK_RE = /link\.coupang\.com|coupa\.ng/i;
const PAID_WORD_RE = /쿠팡\s*파트너스|유료\s*광고|협찬|제작\s*지원|수수료를\s*(제공\s*)?받/;

export function paidRelationFlags(text: string): string[] {
  const out: string[] = [];
  const link = text.match(PAID_LINK_RE);
  if (link) out.push(`제휴 링크(${link[0]})`);
  const word = text.match(PAID_WORD_RE);
  if (word) out.push(`「${word[0]}」`);
  return out;
}

/**
 * 프로그램이 할 수 있는 확인. 사람의 확인(user)은 그대로 두고 system 칸만 새로 쓴다.
 */
export function systemChecks(
  p: ProjectDoc,
  caption: string,
  account: (Pick<AccountView, "coupangChannel" | "owner"> & { clientId?: string | null }) | null,
  render: { id?: string; overlay: { disclosure: boolean; text: string } | null } | null,
  now = Date.now(),
  banned: string[] = [],
): Partial<Record<ComplianceKey, ComplianceCheck["system"]>> {
  if (p.kind === "brand") return brandSystemChecks(p, caption, account, render, now, banned);
  if (p.kind === "general") return generalSystemChecks(p, caption, now);
  const out: Partial<Record<ComplianceKey, ComplianceCheck["system"]>> = {};
  out.disclosure = startsWithDisclosure(caption)
    ? { ok: true, detail: "게시 문구 첫 줄이 표준 고지입니다.", at: now }
    : { ok: false, detail: "게시 문구 첫 줄에 표준 고지가 없습니다.", at: now };
  if (p.virtualHuman && !caption.trimStart().startsWith(VIRTUAL_HUMAN_TAG)) {
    out.disclosure = { ok: false, detail: `가상인물이 나오면 첫 부분에 ${VIRTUAL_HUMAN_TAG} 를 함께 적어야 합니다.`, at: now };
  }

  if (!render) out.videoDisclosure = { ok: false, detail: "게시할 완성 파일을 고르지 않았습니다.", at: now };
  else if (render.overlay?.disclosure)
    out.videoDisclosure = { ok: true, detail: `완성 파일에 고지 띠 「${render.overlay.text}」 가 처음부터 끝까지 들어 있습니다.`, at: now };
  else
    out.videoDisclosure = {
      ok: false,
      detail: "이 완성 파일은 고지 띠 없이 출력됐습니다. 영상 안에 직접 넣었다면 사람이 확인으로 대신합니다.",
      at: now,
    };

  out.channelRegistered = account?.coupangChannel?.registered
    ? { ok: true, detail: `계정 설정에 등록 확인 기록이 있습니다 (${account.coupangChannel.by}).`, at: now }
    : { ok: false, detail: "선택한 계정에 활동 채널 등록 확인 기록이 없습니다.", at: now };

  const confirmed = confirmedCandidate(p);
  const aff = p.coupang.affiliate;
  if (!confirmed) out.productMatch = { ok: false, detail: "동일 상품으로 확인한 쿠팡 상품이 없습니다.", at: now };
  else if (!aff || !isCoupangAffiliateUrl(aff.url)) out.productMatch = { ok: false, detail: "쿠팡 파트너스 제휴 링크가 없습니다.", at: now };
  else if (aff.candidateId && aff.candidateId !== confirmed.id)
    out.productMatch = { ok: false, detail: "제휴 링크가 확인한 상품이 아닌 다른 후보에 연결돼 있습니다.", at: now };
  else if (account && aff.coupangOwner && aff.coupangOwner !== account.owner)
    // 다른 사람의 파트너스 링크를 이 계정에 올리면, 그 사람의 파트너스에 등록되지 않은 채널에서 활동하는 셈이 된다
    out.productMatch = {
      ok: false,
      detail: `제휴 링크는 ${aff.coupangOwner} 님의 쿠팡 파트너스 링크인데, 게시 계정은 ${account.owner} 님의 계정입니다. 게시 계정 주인의 쿠팡 키로 링크를 다시 만들어 주세요.`,
      at: now,
    };
  else
    out.productMatch = {
      ok: true,
      detail: `확인한 상품 「${confirmed.name}」 과 제휴 링크가 연결돼 있습니다${aff.coupangOwner ? ` (${aff.method === "api" ? "" : "붙여 넣은 사람 기준 "}${aff.coupangOwner} 님의 파트너스 링크)` : ""}.`,
      at: now,
    };

  const text = [p.publish.title, caption, ...p.script.lines.map((l) => `${l.text}\n${l.caption}`)].join("\n");
  const flags = scanClaims(text, p.facts);
  const claimFlags = flags.filter((f) => f.kind !== "invalid_click");
  const clickFlags = flags.filter((f) => f.kind === "invalid_click");
  out.claims = claimFlags.length
    ? { ok: false, detail: `확인할 표현 ${claimFlags.length}개: ${claimFlags.map((f) => `「${f.phrase}」`).join(", ")}`, at: now }
    : { ok: true, detail: "의심 표현을 찾지 못했습니다 (사람의 확인을 대신하지 않습니다).", at: now };
  out.invalidClick = clickFlags.length
    ? { ok: false, detail: `클릭 유도 표현: ${clickFlags.map((f) => `「${f.phrase}」`).join(", ")}`, at: now }
    : { ok: true, detail: "클릭 유도 문구를 찾지 못했습니다.", at: now };

  const recorded = p.sources.filter((s) => s.terms.trim()).length;
  out.sourceRights = {
    ok: recorded === p.sources.length,
    detail: p.sources.length ? `소스 ${p.sources.length}개 중 ${recorded}개에 출처·조건 기록` : "등록한 해외 소스가 없습니다.",
    at: now,
  };
  return out;
}

function generalSystemChecks(p: ProjectDoc, caption: string, now: number): Partial<Record<ComplianceKey, ComplianceCheck["system"]>> {
  const out: Partial<Record<ComplianceKey, ComplianceCheck["system"]>> = {};
  const text = [p.publish.title, caption, p.publish.description, ...p.script.lines.map((l) => `${l.text}\n${l.caption}`)].join("\n");
  const paid = paidRelationFlags(text);
  out.noPaidRelation = paid.length
    ? { ok: false, detail: `일반 영상인데 ${paid.join(" · ")} 이(가) 있습니다 — 빼거나 쿠팡 영상 · 고객사 영상으로 바꿔 주세요.`, at: now }
    : { ok: true, detail: "제휴 링크 · 대가 표시를 찾지 못했습니다 (대가가 없다는 것은 사람이 확인합니다).", at: now };
  const flags = scanClaims(text, p.facts);
  out.claims = flags.length
    ? { ok: false, detail: `확인할 표현 ${flags.length}개: ${flags.map((f) => `「${f.phrase}」`).join(", ")}`, at: now }
    : { ok: true, detail: "의심 표현을 찾지 못했습니다 (사람의 확인을 대신하지 않습니다).", at: now };
  const recorded = p.sources.filter((s) => s.terms.trim()).length;
  out.sourceRights = { ok: recorded === p.sources.length, detail: p.sources.length ? `소스 ${p.sources.length}개 중 ${recorded}개에 출처·조건 기록` : "등록한 소스가 없습니다.", at: now };
  return out;
}

function brandSystemChecks(
  p: ProjectDoc,
  caption: string,
  account: { clientId?: string | null } | null,
  render: { id?: string; overlay: { disclosure: boolean; text: string } | null } | null,
  now: number,
  banned: string[],
): Partial<Record<ComplianceKey, ComplianceCheck["system"]>> {
  const out: Partial<Record<ComplianceKey, ComplianceCheck["system"]>> = {};
  const own = !!account?.clientId && account.clientId === p.clientId;
  if (!own) {
    const head = brandDisclosureLine(p.clientName);
    out.disclosure = caption.trimStart().startsWith(head)
      ? { ok: true, detail: `게시 문구 첫 줄이 「${head}」 입니다.`, at: now }
      : { ok: false, detail: `우리 채널에 올리는 대가 받은 광고입니다 — 첫 줄에 「${head}」 가 필요합니다.`, at: now };
    out.videoDisclosure = !render
      ? { ok: false, detail: "게시할 완성 파일을 고르지 않았습니다.", at: now }
      : render.overlay?.disclosure && /광고/.test(render.overlay.text)
        ? { ok: true, detail: `완성 파일에 고지 띠 「${render.overlay.text}」 가 들어 있습니다.`, at: now }
        : { ok: false, detail: "이 완성 파일에는 「광고」 고지 띠가 없습니다. 영상 안에 직접 넣었다면 사람이 확인으로 대신합니다.", at: now };
  }
  // 「승인 취소」 하면 기록은 남지만 승인으로 치지 않는다
  const approved = p.review.state === "approved" ? [...p.review.rounds].reverse().find((r) => r.decision === "approved") : undefined;
  out.clientApproval = !approved
    ? { ok: false, detail: "고객사 승인을 받은 완성 파일이 없습니다.", at: now }
    : render?.id && approved.renderId !== render.id
      ? { ok: false, detail: `고객사가 승인한 파일은 ${approved.n}차 검토 파일입니다 — 승인한 그 파일만 게시합니다.`, at: now }
      : { ok: true, detail: `${approved.n}차 검토 파일을 ${approved.decidedBy ?? "고객사"} 이(가) 승인했습니다 (${approved.decidedVia === "link" ? "검토 링크" : "담당자 기록"}).`, at: now };
  const text = [p.publish.title, caption, ...p.script.lines.map((l) => `${l.text}\n${l.caption}`)].join("\n");
  const flags = scanClaims(text, p.facts, banned);
  out.claims = flags.length
    ? { ok: false, detail: `확인할 표현 ${flags.length}개: ${flags.map((f) => `「${f.phrase}」${f.kind === "banned" ? "(금지 표현)" : ""}`).join(", ")}`, at: now }
    : { ok: true, detail: "금지 표현 · 의심 표현을 찾지 못했습니다 (사람의 확인을 대신하지 않습니다).", at: now };
  const recorded = p.sources.filter((s) => s.terms.trim()).length;
  out.sourceRights = { ok: recorded === p.sources.length, detail: p.sources.length ? `소스 ${p.sources.length}개 중 ${recorded}개에 출처·조건 기록` : "등록한 소스가 없습니다.", at: now };
  return out;
}

/** 게시를 막는 항목 — 필수 항목이 프로그램 확인 실패이거나 사람 확인이 없을 때 */
export function complianceBlockers(
  checks: Partial<Record<ComplianceKey, ComplianceCheck>>,
  items: typeof COMPLIANCE_ITEMS = COMPLIANCE_ITEMS,
): { key: ComplianceKey; label: string; reason: string }[] {
  const out: { key: ComplianceKey; label: string; reason: string }[] = [];
  for (const item of items) {
    if (!item.required) continue;
    const c = checks[item.key];
    const userCanOverride = item.key === "claims" || item.key === "invalidClick" || item.key === "videoDisclosure";
    if (c?.system && !c.system.ok && !userCanOverride) {
      out.push({ key: item.key, label: item.label, reason: c.system.detail });
      continue;
    }
    // 고객 승인은 프로그램이 승인 기록으로 확인한다 — 사람의 「확인」 체크가 필요 없다
    if (item.key === "clientApproval") {
      if (!c?.system?.ok) out.push({ key: item.key, label: item.label, reason: c?.system?.detail ?? "게시 전 점검이 필요합니다." });
      continue;
    }
    if (!c?.user?.ok) out.push({ key: item.key, label: item.label, reason: "사람의 확인이 필요합니다." });
  }
  return out;
}

// ---- 자막 · SRT -----------------------------------------------------

/** 대본 글을 줄 단위로 (빈 줄 제외) */
export const lineText = (l: ScriptLine) => (l.caption.trim() || l.text.trim());

/**
 * 자막 시각을 정한다. 내레이션 길이가 있으면 그 안에서 글자 수 비례로,
 * 없으면 장면 길이 합 안에서 비례로 나눈다. 짧은 줄도 최소 0.6초는 보인다.
 */
export function timeSubtitles(lines: ScriptLine[], totalSec: number): SubtitleCue[] {
  const rows = lines.filter((l) => l.text.trim() || l.caption.trim());
  if (!rows.length || !(totalSec > 0)) return [];
  const weights = rows.map((l) => Math.max(4, [...l.text.trim()].length || [...lineText(l)].length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return rows.map((l, i) => {
    const start = t;
    t = i === rows.length - 1 ? totalSec : t + Math.max(0.6, (totalSec * weights[i]) / sum);
    t = Math.min(totalSec, t);
    return { start: round3(start), end: round3(t), text: lineText(l), lineId: l.id };
  }).filter((c) => c.end > c.start);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function srtStamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

export function toSrt(cues: SubtitleCue[]): string {
  return cues
    .filter((c) => c.end > c.start && c.text.trim())
    .map((c, i) => `${i + 1}\n${srtStamp(c.start)} --> ${srtStamp(c.end)}\n${c.text.trim()}`)
    .join("\n\n")
    .concat("\n");
}

/**
 * 줄마다 만든 AI 음성으로 자막을 정한다 — 줄의 실제 길이 그대로, 줄 사이 gap 만큼 쉰다.
 * 음성이 없는 줄은 건너뛴다.
 */
export function cuesFromSegments(
  lines: ScriptLine[],
  segments: { lineId: string; duration: number }[],
  gapSec: number,
): SubtitleCue[] {
  const dur = new Map(segments.map((s) => [s.lineId, s.duration]));
  const out: SubtitleCue[] = [];
  let t = 0;
  for (const l of lines) {
    const d = dur.get(l.id);
    if (!d || !(d > 0)) continue;
    out.push({ start: round3(t), end: round3(t + d), text: lineText(l), lineId: l.id });
    t += d + gapSec;
  }
  return out;
}

/** 내레이션 전체 길이 (줄 음성 + 쉼) */
export function narrationLength(n: Pick<ProjectDoc["narration"], "kind" | "duration" | "segments" | "gapSec">): number | null {
  if (n.kind === "ai") {
    if (!n.segments.length) return null;
    return round3(n.segments.reduce((a, s) => a + s.duration, 0) + n.gapSec * (n.segments.length - 1));
  }
  return n.kind === "none" ? null : n.duration;
}

/**
 * 장면 길이를 내레이션에 맞춘다 — 장면마다 연결된 줄들의 자막 구간을 덮도록.
 * 줄이 안 붙은 장면은 그대로 둔다. 원본 클립 장면은 구간 끝을 같이 늘리되 원본 길이를 넘기지 않는다.
 */
export function fitScenesToCues(
  scenes: Scene[],
  lines: ScriptLine[],
  cues: SubtitleCue[],
  sourceDuration: (fileId: string) => number | null,
): Scene[] {
  const byLine = new Map(cues.filter((c) => c.lineId).map((c) => [c.lineId as string, c]));
  return scenes.map((s) => {
    const mine = lines.filter((l) => l.sceneId === s.id).map((l) => byLine.get(l.id)).filter(Boolean) as SubtitleCue[];
    if (!mine.length) return s;
    const want = round3(mine.reduce((a, c) => a + (c.end - c.start), 0) + 0.15 * (mine.length - 1) + 0.15);
    if (s.kind === "clip" && s.clip) {
      const max = sourceDuration(s.clip.fileId);
      const end = max ? Math.min(max, s.clip.start + want) : s.clip.start + want;
      return { ...s, duration: round3(end - s.clip.start), clip: { ...s.clip, end: round3(end) } };
    }
    return { ...s, duration: want };
  });
}

/** 대본 내려받기 — 줄마다 구간 이름 · 연결 장면 */
export function scriptText(p: Pick<ProjectDoc, "title" | "script" | "scenes">): string {
  const sceneName = new Map(p.scenes.map((s, i) => [s.id, `#${i + 1} ${s.label}`]));
  return [
    `# ${p.title}`,
    "",
    ...p.script.lines.map(
      (l, i) =>
        `${i + 1}. [${BEAT_LABEL[l.beat]}] ${l.text}` +
        (l.caption.trim() && l.caption.trim() !== l.text.trim() ? `\n   자막: ${l.caption}` : "") +
        (l.sceneId ? `\n   장면: ${sceneName.get(l.sceneId) ?? "(지워진 장면)"}` : "\n   장면: (연결 안 됨)"),
    ),
  ].join("\n");
}

/** 대본이 바뀌었는지 — 내레이션을 다시 만들어야 하는가 */
export function scriptHash(lines: ScriptLine[]): string {
  const s = lines.map((l) => l.text.trim()).join("\n");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** 타임라인 길이 */
export const timelineSec = (scenes: Scene[]) => round3(scenes.reduce((n, s) => n + Math.max(0, s.duration), 0));

/** 출력 전에 막아야 할 것 */
export function renderBlockers(p: ProjectDoc): string[] {
  const out: string[] = [];
  if (!p.scenes.length) out.push("장면이 없습니다.");
  for (const [i, s] of p.scenes.entries()) {
    const n = `#${i + 1} ${s.label || ""}`.trim();
    if (!(s.duration > 0)) out.push(`${n}: 길이가 0입니다.`);
    if (s.kind === "clip" && !s.clip?.fileId) out.push(`${n}: 원본 파일이 없습니다.`);
    if (s.kind === "image" && !s.image?.fileId) out.push(`${n}: 이미지 파일이 없습니다.`);
    if (s.kind === "ai") {
      if (!s.ai?.fileId) out.push(`${n}: AI 장면이 아직 없습니다.`);
      else if (s.ai.status !== "approved") out.push(`${n}: AI 장면을 검토해 「사용」 으로 승인해야 합니다 (실제 제품과 다를 수 있음).`);
    }
  }
  if (timelineSec(p.scenes) > 180) out.push("쇼츠는 3분 이하로 만듭니다.");
  return out;
}

// ---- 성공 공식 → 템플릿 → 새 대본 ------------------------------------

export const DEFAULT_BEATS: { key: BeatKey; from: number; to: number; pattern: string }[] = [
  { key: "hook", from: 0, to: 0.1, pattern: "{상품} 하나로 {문제}가 이렇게 바뀝니다" },
  { key: "problem", from: 0.1, to: 0.25, pattern: "매번 {문제} 때문에 번거로우셨죠" },
  { key: "reveal", from: 0.25, to: 0.4, pattern: "그래서 찾은 게 바로 이 {상품}이에요" },
  { key: "demo", from: 0.4, to: 0.8, pattern: "{특징}" },
  { key: "cta", from: 0.8, to: 1, pattern: "제품 정보가 궁금하면 댓글에 「{키워드}」 남겨 주세요" },
];

/** 분석 → 템플릿 (시각을 비율로 바꾼다) */
export function analysisToTemplate(a: FormulaAnalysis): Pick<
  TemplateDoc,
  "beats" | "totalSec" | "avgShotSec" | "productRevealRatio" | "narrationSubtitle" | "hookPattern" | "cta"
> {
  const total = a.totalSec && a.totalSec > 0 ? a.totalSec : Math.max(1, ...a.beats.map((b) => b.endSec ?? 0)) || 30;
  const n = a.beats.length || 1;
  const beats = a.beats.map((b, i) => {
    const from = b.startSec !== null ? b.startSec / total : i / n;
    const to = b.endSec !== null ? b.endSec / total : (i + 1) / n;
    return {
      key: b.key,
      label: b.label,
      summary: b.summary,
      pattern: b.pattern,
      from: round3(Math.min(1, Math.max(0, from))),
      to: round3(Math.min(1, Math.max(from, to))),
    };
  });
  return {
    beats,
    totalSec: total,
    avgShotSec: a.avgShotSec,
    productRevealRatio: a.productRevealSec !== null ? round3(a.productRevealSec / total) : null,
    narrationSubtitle: a.narrationSubtitle,
    hookPattern: a.hookPattern,
    cta: a.cta,
  };
}

/**
 * 템플릿을 다른 상품에 옮긴 초안 (AI 없이). 사실(facts)에 있는 말만 채운다 —
 * 모르는 특징은 「(확인된 특징 입력)」 자리표시로 남긴다.
 */
export function draftFromTemplate(
  t: Pick<TemplateDoc, "beats" | "totalSec" | "cta">,
  input: { product: string; problem: string; facts: string[]; keyword: string; targetSec?: number },
): { lines: ScriptLine[]; scenes: Scene[] } {
  const total = input.targetSec && input.targetSec > 0 ? input.targetSec : t.totalSec || 30;
  const facts = input.facts.filter((f) => f.trim());
  let factIdx = 0;
  const fill = (pattern: string) =>
    pattern
      .replaceAll("{상품}", input.product || "이 제품")
      .replaceAll("{문제}", input.problem || "(문제 상황)")
      .replaceAll("{키워드}", input.keyword || t.cta.keyword || "정보")
      .replace(/\{특징\}/g, () => facts[factIdx++] ?? "(확인된 특징 입력)");
  const lines: ScriptLine[] = [];
  const scenes: Scene[] = [];
  const beats = t.beats.length ? t.beats : DEFAULT_BEATS.map((b) => ({ ...b, label: BEAT_LABEL[b.key], summary: "" }));
  for (const b of beats) {
    const sceneId = newId("sc_");
    const dur = round3(Math.max(0.5, (b.to - b.from) * total));
    scenes.push({
      id: sceneId,
      kind: "blank",
      label: b.label || BEAT_LABEL[b.key],
      duration: dur,
      clip: null,
      ai: null,
      image: null,
      keepAudio: false,
    });
    const text = fill(b.pattern || "");
    lines.push({ id: newId("ln_"), beat: b.key, text, caption: "", sceneId });
  }
  return { lines, scenes };
}

/** 대본 줄이 장면에 다 이어졌는가 */
export function unlinkedLines(p: Pick<ProjectDoc, "script" | "scenes">): ScriptLine[] {
  const ids = new Set(p.scenes.map((s) => s.id));
  return p.script.lines.filter((l) => !l.sceneId || !ids.has(l.sceneId));
}

// ---- 게시 중복 방지 ---------------------------------------------------

/**
 * 같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 — 게시 원장 문서 id 가 된다.
 * 문서를 create() 로 만드므로 두 요청이 동시에 와도 하나만 통과한다.
 */
export function publicationKey(accountId: string, renderId: string, platform: string): string {
  const s = `${platform}|${accountId}|${renderId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return `${platform}_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}_${renderId.slice(0, 12)}`;
}

export const PUBLICATION_LABEL: Record<PublicationView["status"], string> = {
  scheduled: "예약 대기 (아직 게시 전)",
  queued: "게시 대기열",
  uploading: "전송 중",
  processing: "플랫폼 처리 중",
  published: "게시됨",
  failed: "실패 (다시 시도 가능)",
  uncertain: "결과 확인 필요",
  cancelled: "취소됨",
};

// ---- 성과 비교 ------------------------------------------------------

export type PerfTotals = Record<PerfMetricKey, number | null> & { sources: Set<string> };

/**
 * 프로젝트 하나의 성과 합계. 게시물(플랫폼)마다 출처별 **마지막** 기록을 쓰고
 * 게시물끼리는 더한다. 같은 지표를 API 와 직접 입력이 둘 다 갖고 있으면 API 를 쓴다.
 * 쿠팡(클릭·주문·수익)은 게시물이 아니라 프로젝트(subId) 단위다.
 */
export function projectTotals(snaps: MetricSnapshotView[]): PerfTotals {
  const keys: PerfMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"];
  const latest = new Map<string, MetricSnapshotView>();
  for (const s of [...snaps].sort((a, b) => a.at - b.at)) {
    latest.set(`${s.publicationId ?? s.platform}|${s.source}`, s);
  }
  const byPub = new Map<string, MetricSnapshotView[]>();
  for (const s of latest.values()) {
    const k = s.publicationId ?? s.platform;
    byPub.set(k, [...(byPub.get(k) ?? []), s]);
  }
  const totals = Object.fromEntries(keys.map((k) => [k, null])) as unknown as PerfTotals;
  totals.sources = new Set();
  for (const list of byPub.values()) {
    const ranked = [...list].sort((a, b) => (a.source === "manual" ? 1 : 0) - (b.source === "manual" ? 1 : 0));
    for (const k of keys) {
      const hit = ranked.find((s) => typeof s.values[k] === "number");
      if (!hit) continue;
      totals[k] = (totals[k] ?? 0) + (hit.values[k] as number);
      totals.sources.add(hit.source);
    }
  }
  return totals;
}

export function perfRates(t: Pick<PerfTotals, "views" | "infoRequests" | "clicks" | "orders" | "revenue">) {
  const div = (a: number | null, b: number | null) => (a === null || b === null || b <= 0 ? null : a / b);
  return {
    infoRate: div(t.infoRequests, t.views),
    ctr: div(t.clicks, t.views),
    cvr: div(t.orders, t.clicks),
    revenuePerKView: t.revenue !== null && t.views ? (t.revenue / t.views) * 1000 : null,
  };
}

export const projectCost = (p: Pick<ProjectDoc, "costs">) => ({
  krw: p.costs.reduce((n, c) => n + (c.krw ?? 0), 0),
  usd: p.costs.reduce((n, c) => n + (c.usd ?? 0), 0),
  minutes: p.costs.reduce((n, c) => n + (c.minutes ?? 0), 0),
  aiUsd: p.costs.filter((c) => c.kind.startsWith("ai_")).reduce((n, c) => n + (c.usd ?? 0), 0),
});

/** 비교 축 — 상품 분류 · 사용한 공식 · CTA · 만든 사람 */
export type CompareAxis = "category" | "template" | "cta" | "owner" | "client";

export interface CompareRow {
  key: string;
  label: string;
  projects: number;
  views: number;
  infoRequests: number;
  clicks: number;
  orders: number;
  revenue: number;
  costKrw: number;
  infoRate: number | null;
  ctr: number | null;
  cvr: number | null;
  /** 지표 일부를 모르는 프로젝트 수 (합계에서 빠짐) */
  partial: number;
}

export function compareBy(
  axis: CompareAxis,
  rows: { project: ProjectDoc; totals: PerfTotals; templateName: string | null }[],
): CompareRow[] {
  const groups = new Map<string, CompareRow>();
  for (const { project: p, totals: t, templateName } of rows) {
    if (p.sample) continue;
    const key =
      axis === "category"
        ? p.category || "(분류 없음)"
        : axis === "template"
          ? p.templateId ?? "(공식 없음)"
          : axis === "owner"
            ? p.owner
            : axis === "client"
              ? p.clientId ?? "(자체 · 쿠팡)"
              : p.cta.type;
    const label =
      axis === "category"
        ? key
        : axis === "template"
          ? templateName ?? (p.templateId ? "(지워진 공식)" : "(공식 없음)")
          : axis === "owner"
            ? p.owner
            : axis === "client"
              ? p.clientName || "(자체 · 쿠팡)"
              : `${CTA_LABEL[p.cta.type]}${p.cta.keyword ? ` · ${p.cta.keyword}` : ""}`;
    const g =
      groups.get(key) ??
      ({ key, label, projects: 0, views: 0, infoRequests: 0, clicks: 0, orders: 0, revenue: 0, costKrw: 0, infoRate: null, ctr: null, cvr: null, partial: 0 } as CompareRow);
    g.projects += 1;
    const known = (["views", "infoRequests", "clicks", "orders", "revenue"] as const).every((k) => t[k] !== null);
    if (!known) g.partial += 1;
    g.views += t.views ?? 0;
    g.infoRequests += t.infoRequests ?? 0;
    g.clicks += t.clicks ?? 0;
    g.orders += t.orders ?? 0;
    g.revenue += t.revenue ?? 0;
    g.costKrw += projectCost(p).krw;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, ...perfRates(g) }))
    .sort((a, b) => b.views - a.views);
}

// ---- 빈 문서 --------------------------------------------------------

export function emptyMetrics(): TrendDoc["metrics"] {
  return {
    views: { v: null, src: "manual" },
    likes: { v: null, src: "manual" },
    comments: { v: null, src: "manual" },
    saves: { v: null, src: "manual" },
    shares: { v: null, src: "manual" },
    infoRequests: { v: null, src: "manual" },
  };
}

export function emptyDomestic(): DomesticCheck {
  return { status: "unchecked", query: "", method: null, checkedAt: null, sampleSize: null, matches: [], note: "" };
}

export function emptyProject(
  owner: string,
  input: Partial<Pick<ProjectDoc, "title" | "product" | "category" | "trendId" | "notes" | "visibility" | "kind">> = {},
  now = Date.now(),
): ProjectDoc {
  return {
    owner,
    visibility: input.visibility ?? "private",
    createdAt: now,
    updatedAt: now,
    updatedBy: owner,
    // 고객사 영상은 clients.createClientProject 로만 만든다
    kind: input.kind === "general" ? "general" : "coupang",
    clientId: null,
    clientName: "",
    month: null,
    clientProductId: null,
    formatId: null,
    brandTarget: "client",
    members: [],
    review: { state: "none", rounds: [], revisionsUsed: 0 },
    title: input.title || input.product || "새 영상",
    product: input.product ?? "",
    category: input.category ?? "",
    trendId: input.trendId ?? null,
    stage: "research",
    mode: "remix",
    facts: [],
    notes: input.notes ?? "",
    chinese: { terms: [], generatedAt: null },
    sources: [],
    coupang: { candidates: [], affiliate: null },
    reference: { url: "", title: "", transcript: "", timing: "" },
    analysis: null,
    templateId: null,
    script: { lines: [] },
    scenes: [],
    narration: { kind: "none", fileId: null, duration: null, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: null },
    subtitles: { cues: [], edited: false },
    output: { width: 720, height: 1280, fps: 30, sourceVolume: 0.25, disclosureOverlay: true },
    virtualHuman: false,
    publish: { title: "", description: "", hashtags: [], privacy: "private", madeForKids: false, synthetic: null },
    cta: { type: "comment_keyword", keyword: "", wording: "", atSec: null },
    compliance: {},
    costs: [],
    renderIds: [],
    sample: false,
  };
}

export const emptyBeat = (key: BeatKey): Beat => ({
  key,
  label: BEAT_LABEL[key],
  startSec: null,
  endSec: null,
  summary: "",
  pattern: "",
});

export function emptyAnalysis(): FormulaAnalysis {
  return {
    basis: [],
    urlRead: false,
    refs: [],
    totalSec: null,
    productRevealSec: null,
    avgShotSec: null,
    cutCount: null,
    hookPattern: "",
    beats: [],
    narrationSubtitle: "unknown",
    cta: { type: "comment_keyword", keyword: "", wording: "", atSec: null },
    notes: "",
    by: "manual",
  };
}

/**
 * 사람이 적은 장면 시각 메모를 읽는다. 한 줄에 「0:00-0:02 후킹 …」 또는 「0-2 hook …」.
 * 분석의 근거가 「사람이 본 시각」 일 때 AI 없이도 구성 표를 만든다.
 */
export function parseTimingNotes(text: string): { beats: Beat[]; cuts: number } {
  const keyOf = (s: string): BeatKey => {
    const t = s.toLowerCase();
    if (/후킹|hook|훅/.test(t)) return "hook";
    if (/공감|empathy/.test(t)) return "empathy";
    if (/문제|problem|불편/.test(t)) return "problem";
    if (/등장|reveal|제품|소개/.test(t)) return "reveal";
    if (/비교|compare|before|전후/.test(t)) return "compare";
    if (/반전|twist/.test(t)) return "twist";
    if (/근거|proof|증명/.test(t)) return "proof";
    if (/cta|댓글|dm|링크|구매/.test(t)) return "cta";
    return "demo";
  };
  const toSec = (s: string) => {
    const parts = s.split(":").map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return null;
    return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  };
  const beats: Beat[] = [];
  let cuts = 0;
  for (const raw of text.split(/\n+/)) {
    const m = /^\s*(\d{1,2}(?::\d{1,2}(?:\.\d+)?)?|\d+(?:\.\d+)?)\s*[-~–]\s*(\d{1,2}(?::\d{1,2}(?:\.\d+)?)?|\d+(?:\.\d+)?)\s*(.*)$/.exec(raw);
    if (!m) continue;
    const start = toSec(m[1]);
    const end = toSec(m[2]);
    if (start === null || end === null || end <= start) continue;
    const rest = m[3].trim();
    const cutM = /컷\s*(\d+)|(\d+)\s*컷/.exec(rest);
    if (cutM) cuts += Number(cutM[1] ?? cutM[2]);
    const key = keyOf(rest);
    beats.push({ key, label: BEAT_LABEL[key], startSec: start, endSec: end, summary: rest, pattern: "" });
  }
  return { beats, cuts };
}

// ---- 고객 검토 (수정 횟수) ------------------------------------------------

export const REVIEW_LABEL: Record<ProjectDoc["review"]["state"], string> = {
  none: "검토 전",
  waiting: "고객 검토 중",
  revision: "수정 요청 받음",
  approved: "고객 승인",
};

export const latestRound = (r: ProjectDoc["review"]) => r.rounds[r.rounds.length - 1] ?? null;

/** 계약상 수정을 더 요청할 수 있는가 (한 편당 상한) */
export const revisionsLeft = (r: ProjectDoc["review"], limit: number) => Math.max(0, limit - r.revisionsUsed);

/** 이 달 고객사 영상 진행 — 월 편수 대비 */
export function monthProgress(projects: Pick<ProjectDoc, "review" | "stage">[], perMonth: number) {
  return {
    planned: perMonth,
    made: projects.length,
    approved: projects.filter((p) => p.review.state === "approved").length,
    published: projects.filter((p) => p.stage === "published").length,
    waiting: projects.filter((p) => p.review.state === "waiting").length,
    revision: projects.filter((p) => p.review.state === "revision").length,
  };
}
