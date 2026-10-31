// ============================================================
//  쇼핑쇼츠 — 데이터 모양 (브라우저 · 서버 공용, 의존성 없음)
// ------------------------------------------------------------
//  쿠팡 파트너스 제휴 수익을 위한 쇼핑쇼츠를 한 흐름으로 다룬다:
//    소재(트렌드) → 중국어 소스 → 쿠팡 동일 상품 → 성공 공식 → 대본·장면
//    → 편집·출력 → 계정 게시 → 성과
//
//  저장은 전부 서버(Admin SDK)를 거친다 — 새 컬렉션은 보안 규칙을 게시할
//  권한이 없어 브라우저가 직접 붙을 수 없다 (lib/neander/server/admin.ts).
//
//  숫자에는 늘 「어디서 왔는가」 를 붙인다 (Measured.src). 공개되지 않은
//  저장·DM 수는 0 이 아니라 null 이다 — 0 은 「확인해 보니 없었다」 이다.
// ============================================================

/** 나만 보기 · 팀 보기. 팀 보기여도 지우기 · 공개 범위 바꾸기는 소유자만 */
export type Visibility = "private" | "team";

/**
 * 숫자의 출처.
 *  api      공식 API 응답 그대로
 *  manual   사람이 직접 보고 적은 값
 *  estimate 계산·추정 (예: 조회수 ÷ 경과일)
 *  ai       AI 가 만든 값 (분석 · 제안) — 사실 확인이 아니다
 */
export type Provenance = "api" | "manual" | "estimate" | "ai";

export interface Measured {
  /** null = 모름 · 비공개. 0 은 확인해 보니 0 */
  v: number | null;
  src: Provenance;
  /** 확인한 시각 (ms) */
  at?: number;
  /** 근거 한 줄 (예: 「YouTube Data API videos.list」 · 「댓글 200개 표본 직접 셈」) */
  ref?: string;
}

export interface Owned {
  owner: string;
  visibility: Visibility;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

// ---- 소재 · 트렌드 ------------------------------------------------

export type ShortsPlatform =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "xiaohongshu"
  | "douyin"
  | "coupang"
  | "other";

export type TrendMetricKey = "views" | "likes" | "comments" | "saves" | "shares" | "infoRequests";

/** 정보 요청 댓글 표본 — 「어디서 사요 / 링크 / 정보 / DM」 류 댓글을 센 것 */
export interface InfoRequestSample {
  /** 읽어 본 댓글 수 */
  sampled: number | null;
  /** 그중 제품 정보·구매처·링크·DM 을 요청한 댓글 */
  matched: number | null;
  /** 센 기준 낱말 */
  keywords: string[];
  src: Provenance;
  at?: number;
}

/** 국내 유사 콘텐츠 확인 — 「없다」 가 아니라 「이 표본에서 못 찾았다」 만 말할 수 있다 */
export type DomesticStatus = "unchecked" | "found" | "none_in_sample";

export interface DomesticCheck {
  status: DomesticStatus;
  query: string;
  /** api = YouTube 검색 API 표본 · manual = 사람이 직접 검색 */
  method: "api" | "manual" | null;
  checkedAt: number | null;
  /** 살펴본 결과 수 (표본 크기) */
  sampleSize: number | null;
  matches: { url: string; title: string; views: number | null; src: Provenance }[];
  note: string;
  /** 서버가 YouTube 검색 API 로 받은 마지막 표본 — 사람이 그중 유사한 것을 고른다 */
  lastSearch?: { query: string; at: number; results: { id: string; url: string; title: string; views: number | null }[] } | null;
}

export interface TrendDoc extends Owned {
  platform: ShortsPlatform;
  url: string;
  /** 플랫폼 안 id (YouTube 영상 id 등) */
  externalId: string | null;
  channel: string;
  title: string;
  /** 원본 게시 시각 (ISO) — 모르면 null */
  publishedAt: string | null;
  /** 이 기록을 모은 시각 (ms) */
  collectedAt: number;
  /** 어떻게 모았나 */
  collectedBy: "youtube_api" | "manual";
  /** API 검색에서 왔다면 그 조건 */
  searchContext: { query: string; regionCode: string; language: string } | null;
  product: string;
  category: string;
  /** ISO 국가 코드 (KR · US · CN …) — 모르면 "" */
  country: string;
  /** ko · en · zh … */
  language: string;
  /** 영상 속 상품을 무엇으로 확인했나 */
  identification: { status: "unconfirmed" | "likely" | "confirmed"; evidence: string };
  metrics: Record<TrendMetricKey, Measured>;
  /** 조회수 기록 — 다시 모을 때마다 한 줄. 증가 속도를 실제 증가로 잰다 */
  viewHistory: { at: number; views: number; src: Provenance }[];
  infoSample: InfoRequestSample;
  domestic: DomesticCheck;
  tags: string[];
  notes: string;
  /** 제작 프로젝트로 넘겼으면 그 id */
  projectId: string | null;
  /** 화면 예시용 — 실제 수치가 아니다. 분석 · 성과에서 빠진다 */
  sample: boolean;
}

/** 반응 점수 가중치 (사람마다 다르게 둔다) */
export type ScoreWeights = Record<Exclude<TrendMetricKey, "views">, number>;

// ---- 해외 소스 ----------------------------------------------------

export type SegmentPurpose = "hook" | "problem" | "product" | "demo" | "compare" | "twist" | "proof" | "cta" | "broll";

export interface SourceSegment {
  id: string;
  /** 구간을 고른 파일 (소스에 붙은 파일 중 하나). 파일 없이 원본 시각만 적을 수도 있다 */
  fileId: string | null;
  start: number;
  end: number;
  purpose: SegmentPurpose;
  note: string;
}

export interface SourceClip {
  id: string;
  platform: ShortsPlatform;
  url: string;
  creator: string;
  title: string;
  memo: string;
  /** 출처 · 이용 조건 메모 (선택 — 편집 승인 조건이 아니다) */
  terms: string;
  collectedAt: number;
  collectedBy: string;
  fileIds: string[];
  segments: SourceSegment[];
}

export type ChineseTermKind = "name" | "synonym" | "use" | "problem";

export interface ChineseTerm {
  id: string;
  text: string;
  kind: ChineseTermKind;
  /** 한국어 뜻 */
  meaning: string;
  by: "ai" | "manual";
}

// ---- 쿠팡 동일 상품 ------------------------------------------------

/** 사람이 하나씩 대조한 항목 — null 은 아직 안 봄 */
export type MatchCheckKey = "brand" | "model" | "size" | "material" | "options" | "appearance";

export interface CoupangCandidate {
  id: string;
  url: string;
  productId: string | null;
  name: string;
  brand: string;
  model: string;
  size: string;
  material: string;
  spec: string;
  options: string;
  /** 확인 시점 가격 (원) — 모르면 null */
  price: number | null;
  saleStatus: "on_sale" | "sold_out" | "unknown";
  checkedAt: number;
  /** api = 파트너스 검색 API 결과 · manual = 사람이 쿠팡에서 직접 봄 */
  source: "api" | "manual";
  /** 해외 영상 속 상품과 비교한 근거 */
  comparison: string;
  /**
   * candidate = 비슷한 후보 (아직 같다고 말할 수 없다)
   * identical = 사람이 대조해 같은 상품으로 확인함
   * rejected  = 다른 상품
   */
  match: "candidate" | "identical" | "rejected";
  checks: Record<MatchCheckKey, boolean | null>;
  /** identical 로 바꾼 사람 · 시각 — 자동 검증이 아니라 사람의 확인이다 */
  confirmedBy: string | null;
  confirmedAt: number | null;
}

export interface AffiliateLink {
  url: string;
  /** 어느 후보의 링크인가 */
  candidateId: string | null;
  subId: string;
  /** api = 파트너스 딥링크 API · manual = 파트너스 사이트에서 발급해 붙여 넣음 */
  method: "api" | "manual";
  issuedAt: number;
  by: string;
  /**
   * 누구의 쿠팡 파트너스 계정 링크인가 (ERP 이메일). 수수료가 이 사람에게 간다.
   * api = 그 사람의 키로 만들었다 · manual = 붙여 넣은 사람의 링크로 본다.
   * 게시 계정의 주인과 같아야 한다 (그 사람의 파트너스에 등록된 채널이어야 하므로).
   */
  coupangOwner: string | null;
  /** 어느 게시 계정용으로 만들었나 (그 계정의 채널 아이디를 썼다) */
  accountId: string | null;
}

// ---- 성공 공식 ----------------------------------------------------

export type BeatKey = "hook" | "problem" | "empathy" | "reveal" | "demo" | "compare" | "twist" | "proof" | "cta";

export interface Beat {
  key: BeatKey;
  label: string;
  startSec: number | null;
  endSec: number | null;
  /** 이 구간이 하는 일 */
  summary: string;
  /** 다른 상품에 옮길 때 쓰는 말 틀 — 「{상품} 쓰기 전엔 …」 */
  pattern: string;
}

export type CtaType = "comment_keyword" | "dm_keyword" | "link_in_bio" | "pinned_comment" | "description_link" | "other";

export interface CtaPlan {
  type: CtaType;
  keyword: string;
  wording: string;
  atSec: number | null;
}

/**
 * 참고 영상 분석. URL 을 읽지 않는다 — basis 가 무엇을 근거로 했는지 말한다.
 *  transcript  붙여 넣은 대본 글
 *  timing      사람이 영상을 보며 적은 장면 시각
 */
export interface FormulaAnalysis {
  basis: ("transcript" | "timing")[];
  /** 서버가 URL 내용을 읽었는가 — 늘 false. 화면에 「URL 미열람」 으로 보인다 */
  urlRead: false;
  refs: { url: string; title: string }[];
  totalSec: number | null;
  productRevealSec: number | null;
  avgShotSec: number | null;
  cutCount: number | null;
  hookPattern: string;
  beats: Beat[];
  narrationSubtitle: "same" | "summary" | "keywords" | "none" | "unknown";
  cta: CtaPlan;
  notes: string;
  by: "ai" | "manual";
  model?: string;
  costUsd?: number;
}

export interface TemplateDoc extends Owned {
  name: string;
  /** 비율로 담는다 (0~1) — 길이가 다른 영상에도 옮겨 쓴다 */
  beats: (Omit<Beat, "startSec" | "endSec"> & { from: number; to: number })[];
  totalSec: number;
  avgShotSec: number | null;
  productRevealRatio: number | null;
  narrationSubtitle: FormulaAnalysis["narrationSubtitle"];
  hookPattern: string;
  cta: CtaPlan;
  notes: string;
  /** 어디서 뽑았나 */
  origin: { projectId: string | null; versionId: string | null; basis: FormulaAnalysis["basis"] };
  sample: boolean;
}

// ---- 대본 · 장면 --------------------------------------------------

export interface ScriptLine {
  id: string;
  beat: BeatKey;
  /** 읽을 말 */
  text: string;
  /** 화면 자막 — 비우면 text 를 그대로 */
  caption: string;
  sceneId: string | null;
}

export type SceneKind = "clip" | "ai" | "image" | "blank";

export type AiSceneStatus = "draft" | "generating" | "review" | "approved" | "rejected" | "failed";

export interface Scene {
  id: string;
  kind: SceneKind;
  label: string;
  /** 타임라인 길이 (초) — clip 은 end-start 와 같게 맞춘다 */
  duration: number;
  clip: { fileId: string; start: number; end: number; sourceId: string | null; segmentId: string | null } | null;
  ai: {
    prompt: string;
    status: AiSceneStatus;
    jobId: string | null;
    fileId: string | null;
    model: string | null;
    reviewNote: string;
  } | null;
  image: { fileId: string } | null;
  /** 원본 소리를 살릴 것인가 (내레이션이 있으면 기본 끔) */
  keepAudio: boolean;
}

export interface Narration {
  kind: "none" | "ai" | "recording" | "file";
  /** 녹음 · 음성 파일 한 개 (ai 는 segments) */
  fileId: string | null;
  duration: number | null;
  voice: string | null;
  model: string | null;
  /**
   * AI 음성은 대본 한 줄 = 파일 하나로 만든다. 줄마다 실제 길이를 알아서
   * 자막이 내레이션에 정확히 맞는다. 줄 사이 쉼은 gapSec.
   */
  segments: { lineId: string; fileId: string; duration: number }[];
  gapSec: number;
  /** 이 음성을 만들 때의 대본 — 지금 대본과 다르면 「대본이 바뀌었다」 */
  scriptHash: string | null;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  lineId: string | null;
}

export interface PublishSettings {
  title: string;
  description: string;
  hashtags: string[];
  privacy: "private" | "unlisted" | "public";
  madeForKids: boolean;
  /** 실제처럼 보이는 AI 합성 장면 포함 여부 — null 은 아직 안 정함 (게시 전에 정해야 한다) */
  synthetic: boolean | null;
}

/** 확인 하나 — 프로그램이 본 것과 사람이 확인한 것을 따로 남긴다 */
export interface ComplianceCheck {
  system: { ok: boolean; detail: string; at: number } | null;
  user: { ok: boolean; by: string; at: number; note: string } | null;
}

export type ComplianceKey =
  | "disclosure"
  | "videoDisclosure"
  | "channelRegistered"
  | "productMatch"
  | "claims"
  | "invalidClick"
  | "dmConsent"
  | "clientApproval"
  | "noPaidRelation"
  | "sourceRights";

export interface CostEntry {
  id: string;
  kind: "ai_text" | "ai_voice" | "ai_video" | "material" | "labor" | "other";
  /** 원화 환산 (모르면 null) */
  krw: number | null;
  usd: number | null;
  minutes: number | null;
  note: string;
  at: number;
  by: string;
  /** 자동으로 붙은 비용 (AI 응답의 usage.cost) 인가 */
  auto: boolean;
}

export type ProjectStage =
  | "research"
  | "sourcing"
  | "matching"
  | "scripting"
  | "editing"
  | "ready"
  | "published"
  | "archived";

export type ProductionMode = "remix" | "hybrid" | "ai";

/**
 * coupang = 쿠팡 파트너스 제휴 쇼츠 (내 채널에 올려 수수료)
 * brand   = 고객사(브랜드) 대행 영상 — 고객 승인을 받은 파일만 게시한다
 * general = 일반 영상 (제휴 없음) — 제휴 링크 · 협찬 · 대가가 없는 영상. 고지 문구가 붙지 않는다
 */
export type ProjectKind = "coupang" | "brand" | "general";

export interface ReviewRound {
  n: number;
  renderId: string;
  sentAt: number;
  sentBy: string;
  /** withdrawn = 담당자가 새 파일로 바꿔 보내며 거둬들임 (고객의 수정 요청이 아니다) */
  decision: "pending" | "approved" | "revision" | "withdrawn";
  feedback: string;
  /** 검토한 사람 이름 (링크에서 고객이 적은 이름 · 담당자가 대신 기록하면 그 이메일) */
  decidedBy: string | null;
  decidedVia: "link" | "staff" | null;
  decidedAt: number | null;
  /** 계약상 수정 횟수를 넘은 요청인가 */
  extra: boolean;
}

export interface ReviewState {
  /** none 보내기 전 · waiting 고객 검토 중 · revision 수정 요청 받음 · approved 승인 */
  state: "none" | "waiting" | "revision" | "approved";
  rounds: ReviewRound[];
  /** 고객이 수정을 요청한 횟수 (상한을 넘은 것 포함) */
  revisionsUsed: number;
}

export interface ProjectDoc extends Owned {
  kind: ProjectKind;
  /** 브랜드 대행이면 고객사 · 그 달 계약분 · 고객사 제품 · 바탕 형식(정찰 카드) */
  clientId: string | null;
  /** 고객사 이름 (표시 · 고지 문구용 사본) */
  clientName: string;
  month: string | null;
  clientProductId: string | null;
  formatId: string | null;
  /** 브랜드 영상을 어디에 올리나 — 고객사 계정이면 자기 광고, 우리 채널이면 「광고」 고지 */
  brandTarget: "client" | "own";
  /** 고객사 담당자 (고객사 문서의 사본 — 이 사람들이 읽고 고친다) */
  members: string[];
  review: ReviewState;
  title: string;
  product: string;
  category: string;
  trendId: string | null;
  stage: ProjectStage;
  mode: ProductionMode;
  /** 대본에 써도 되는 확인된 사실 — 여기 없는 가격·성능·후기는 만들지 않는다 */
  facts: string[];
  notes: string;
  chinese: { terms: ChineseTerm[]; generatedAt: number | null };
  sources: SourceClip[];
  coupang: { candidates: CoupangCandidate[]; affiliate: AffiliateLink | null };
  /** 참고 대본 · 장면 시각 (분석의 재료) */
  reference: { url: string; title: string; transcript: string; timing: string };
  analysis: FormulaAnalysis | null;
  templateId: string | null;
  script: { lines: ScriptLine[] };
  scenes: Scene[];
  narration: Narration;
  subtitles: { cues: SubtitleCue[]; edited: boolean };
  output: {
    width: number;
    height: number;
    fps: number;
    /** 원본 소리 크기 (내레이션 위에 깔 때) 0~1 */
    sourceVolume: number;
    /** 영상 안 「광고」 고지 띠 — 쿠팡 공지: 쇼츠는 영상 안·배너·제목 중 하나 + 설명란 첫 부분 */
    disclosureOverlay: boolean;
  };
  /** AI 가상인물이 나오는가 — 나오면 고지에 「[가상인물 포함]」 을 함께 붙인다 (쿠팡 공지 2026-06-11) */
  virtualHuman: boolean;
  publish: PublishSettings;
  cta: CtaPlan;
  compliance: Partial<Record<ComplianceKey, ComplianceCheck>>;
  costs: CostEntry[];
  /** 끝낸 출력 파일 (최근 것이 마지막) */
  renderIds: string[];
  sample: boolean;
}

/** 버전 기록 — 참고 자료 · 구성 분석 · 대본을 바꿀 때마다 한 벌 */
export interface VersionDoc {
  projectId: string;
  kind: "reference" | "analysis" | "script";
  at: number;
  by: string;
  note: string;
  data: unknown;
}

// ---- 파일 ---------------------------------------------------------

export type MediaKind = "source" | "ai_scene" | "voice" | "recording" | "audio" | "image" | "render";

export interface MediaDoc {
  owner: string;
  /** 프로젝트 파일이면 프로젝트 id, 고객사 자료(제품 사진)면 "" */
  projectId: string;
  /** 고객사 자료면 고객사 id */
  clientId?: string | null;
  kind: MediaKind;
  name: string;
  type: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  parts: number;
  complete: boolean;
  createdAt: number;
  /** 무엇이 만들었나 (AI 작업 id · 출력 작업 id) */
  origin: { jobId: string | null; model: string | null } | null;
  /** 출력 파일의 코덱 확인 결과 (avc · aac) */
  codecs: { video: string | null; audio: string | null } | null;
  /** 출력 파일에 영상 안 고지 띠를 넣었는가 (출력기가 기록) */
  overlay: { disclosure: boolean; text: string } | null;
}

export type MediaView = Omit<MediaDoc, "parts" | "complete"> & { id: string };

// ---- 작업 큐 ------------------------------------------------------

export type JobKind = "ai_video" | "tts" | "render" | "publish" | "metrics";

/**
 *  queued      실행기를 기다림
 *  running     실행기가 잡고 있음 (임대 중)
 *  waiting     제공사 처리를 기다림 (다음 확인 시각 runAt)
 *  succeeded   끝
 *  failed      확실히 실패 — 다시 할 수 있다
 *  cancelled   사람이 취소
 *  uncertain   결과를 모름 (쓰기 도중 끊김) — 자동으로 다시 하지 않는다
 *  interrupted 브라우저 출력이 끊김 — 같은 설계도로 다시 출력하면 된다
 */
export type JobStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain"
  | "interrupted";

export interface JobDoc {
  owner: string;
  projectId: string;
  kind: JobKind;
  /** browser = 사용자 브라우저가 실행 (출력) · server = 서버 실행기 */
  runner: "browser" | "server";
  status: JobStatus;
  step: string;
  /** writing = 되돌릴 수 없는 외부 쓰기 도중. 이 상태로 임대가 끝나면 uncertain */
  stepState: "idle" | "writing";
  runAt: number;
  leaseUntil: number;
  leaseBy: string | null;
  attempts: number;
  progress: { pct: number; message: string };
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  log: { at: number; msg: string }[];
  /** 같은 요청 두 번을 막는 열쇠 (작업 종류마다 다르게 만든다) */
  dedupeKey: string | null;
}

export type JobView = Omit<JobDoc, "leaseBy" | "input" | "state"> & {
  id: string;
  input: Record<string, unknown>;
};

// ---- 게시 계정 · 게시 원장 ------------------------------------------

export type PublishPlatform = "youtube" | "instagram";

export type AccountAuthMode = "google_oauth" | "facebook_login" | "manual_token";

export interface AccountDoc {
  owner: string;
  platform: PublishPlatform;
  authMode: AccountAuthMode;
  /** YouTube 채널 id · Instagram 프로페셔널 계정 id */
  externalId: string;
  externalName: string;
  /** 암호문 — 서버 밖으로 나가지 않는다 (mail/server/secret.ts 와 같은 방식, AAD = 계정 문서 id) */
  sealed: string;
  scopes: string[];
  tokenExpiresAt: number | null;
  /** 이 계정으로 게시해도 되는 다른 팀원 (소유자가 정한다) */
  sharedWith: string[];
  status: "connected" | "needs_reauth";
  /** 쿠팡 파트너스 활동 채널로 등록했는지 — 사람이 파트너스 사이트에서 확인한 기록 */
  coupangChannel: { registered: boolean; by: string; at: number; url: string } | null;
  /** 이 계정에 붙일 쿠팡 채널 아이디(subId) — 소유자의 파트너스에 등록한 것 중에서 */
  coupangSubId: string | null;
  /**
   * 고객사 소유 계정 — owner 는 연결한 담당자(토큰 보관자)이고, 그 고객사 담당자
   * 누구나(clientMembers · 고객사 문서의 사본) 게시할 수 있다
   */
  clientId?: string | null;
  clientMembers?: string[];
  createdAt: number;
  updatedAt: number;
}

export type AccountView = Omit<AccountDoc, "sealed"> & { id: string; canPublish: boolean; mine: boolean };

// ---- 사람별 채널 세트 (쿠팡 키 · 개인 검색 키) ---------------------------------

/**
 * 사람마다 한 문서 (문서 id = ERP 이메일). 쿠팡 파트너스 키는 그 사람의 것이고
 * 남과 공유하지 않는다 (파트너스 FAQ: API 키는 1개 · 공유 불가). 키는 암호문으로만.
 */
export interface ProfileDoc {
  owner: string;
  coupang: {
    /** 암호문 { accessKey, secretKey } — 없으면 null */
    sealed: string | null;
    /** 액세스 키 끝 4자리 (화면 표시용) */
    keyHint: string | null;
    /** 파트너스 아이디 (AF…) — 기록용 */
    afCode: string;
    /** none 키 없음 · unverified 넣기만 함 · ok 확인됨 · failed 확인 실패 */
    status: "none" | "unverified" | "ok" | "failed";
    checkedAt: number | null;
    message: string;
    /** 호출 한도를 넘겨 쿠팡이 막은 경우 풀리는 시각 */
    blockedUntil: number | null;
  };
  /** 파트너스에 등록한 채널 아이디 (최대 10개 · 8~20자 영문·숫자) */
  subIds: { id: string; label: string }[];
  /** 개인 YouTube Data API 키 (선택 — 없으면 회사 키) */
  youtubeKey: { sealed: string | null; hint: string | null };
  updatedAt: number;
}

export interface ProfileView {
  owner: string;
  coupang: Omit<ProfileDoc["coupang"], "sealed"> & { configured: boolean };
  subIds: ProfileDoc["subIds"];
  youtubeKey: { configured: boolean; hint: string | null };
  updatedAt: number;
}

export type PublicationStatus =
  | "scheduled"
  | "queued"
  | "uploading"
  | "processing"
  | "published"
  | "failed"
  | "uncertain"
  | "cancelled";

export interface PublicationDoc {
  owner: string;
  projectId: string;
  accountId: string;
  platform: PublishPlatform;
  renderId: string;
  status: PublicationStatus;
  scheduledAt: number | null;
  jobId: string | null;
  meta: {
    title: string;
    caption: string;
    privacy: PublishSettings["privacy"];
    madeForKids: boolean;
    synthetic: boolean;
  };
  compliance: Partial<Record<ComplianceKey, ComplianceCheck>>;
  result: { externalId: string; url: string | null; at: number; by: "api" | "manual" } | null;
  error: { code: string; message: string } | null;
  history: { at: number; status: PublicationStatus; msg: string; by: string }[];
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export type PublicationView = PublicationDoc & { id: string };

// ---- 성과 ---------------------------------------------------------

export type PerfMetricKey =
  | "views"
  | "likes"
  | "comments"
  | "saves"
  | "shares"
  | "infoRequests"
  | "clicks"
  | "orders"
  | "revenue";

export type PerfSource = "youtube_api" | "instagram_api" | "coupang_api" | "manual";

export interface MetricSnapshotDoc {
  owner: string;
  projectId: string;
  publicationId: string | null;
  platform: PublishPlatform | "coupang" | "other";
  at: number;
  source: PerfSource;
  values: Partial<Record<PerfMetricKey, number | null>>;
  note: string;
  by: string;
}

export type MetricSnapshotView = MetricSnapshotDoc & { id: string };

/** 서버 연결 상태 — 값은 절대 안 보낸다. 있음/없음과 빠진 이름만 */
export interface IntegrationStatus {
  openrouter: { configured: boolean };
  youtubeSearch: { configured: boolean; missing: string[] };
  youtubeOAuth: { configured: boolean; missing: string[] };
  meta: { configured: boolean; missing: string[] };
  coupang: { configured: boolean; missing: string[] };
  tokenKey: { configured: boolean; missing: string[] };
  cron: { configured: boolean };
  /** 회사 공용 쿠팡 키(서버 환경변수) — 검색에만 대신 쓴다. 딥링크 · 리포트는 각자의 키로만 */
  companyCoupang: { configured: boolean };
  storage: { driver: "firestore-chunks"; quotaMb: number; usedMb: number };
  allowlist: { restricted: boolean };
}

// ---- 고객사 (브랜드 대행) -------------------------------------------------

export type ClientStatus = "active" | "paused" | "ended";

export interface ClientProduct {
  id: string;
  name: string;
  url: string;
  /** 확인된 제품 사실 — AI 대본은 이 밖의 성능 · 가격 · 후기를 만들지 않는다 */
  facts: string[];
  /** 실사진 (고객사 자료 파일 id) */
  photoIds: string[];
  note: string;
}

export interface ClientDoc {
  name: string;
  status: ClientStatus;
  /** 담당자 (ERP 이메일) — 고객사 자료 · 영상 · 계정을 함께 쓴다 */
  members: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  /** 조회수 약속 칸은 일부러 없다 — 계약은 제작 편수 · 수정 횟수까지만 */
  contract: {
    monthlyFeeKrw: number | null;
    vat: "excluded" | "included";
    videosPerMonth: number;
    /** 영상 한 편당 고객이 요청할 수 있는 수정 횟수 */
    revisionLimit: number;
    startMonth: string;
    endMonth: string | null;
    /** 재무 프로젝트 코드 (PJ-…) — 입금 · 손익은 재무에서 */
    financeCode: string;
    note: string;
  };
  brief: {
    summary: string;
    target: string;
    tone: string;
    keyMessages: string[];
    mustInclude: string[];
    /** 금지 표현 — 대본 · 문구 검사가 찾아낸다 */
    banned: string[];
    references: string[];
    notes: string;
  };
  products: ClientProduct[];
  /** 고객사 담당자 이름 (연락처는 두지 않는다) */
  contactName: string;
}

export type ClientView = ClientDoc & { id: string; canEdit: boolean };

/** 고객 검토 링크 — 문서 id 는 토큰의 sha256 (토큰 자체는 저장하지 않는다) */
export interface ReviewLinkDoc {
  projectId: string;
  clientId: string;
  round: number;
  renderId: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
}
