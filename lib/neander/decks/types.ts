// ============================================================
//  가정값을 바꿀 수 있는 발표 장표 — 형식(타입)만 둔다
// ------------------------------------------------------------
//  이 저장소는 public 이다. 장표의 **내용**(문구·가정 기본값·스냅샷·매물·
//  학원 이름)은 여기 두지 않는다. 깃에서 빠진 private/decks/<slug>/ 에서
//  쓰고, scripts/neander/upload-deck.ts 가 Firestore(neander_decks)에 올린다.
//  화면은 로그인한 재무 권한자에게만 API 로 받는다.
//
//  코드에 남는 것은 뼈대뿐이다 — 이 파일의 형식, 계산식(calc.ts),
//  실측 규칙의 **방법**(actuals.ts). 숫자는 전부 내용 쪽에 있다.
// ============================================================

/** 가정 패널의 묶음 — 이 순서로 보여 준다 */
export const ASSUMPTION_GROUPS = ["목표", "매장", "매출·현금", "B2B", "생카", "스모트", "운영", "점수판"] as const;
export type AssumptionGroup = (typeof ASSUMPTION_GROUPS)[number];

/**
 * 값의 성격.
 *   가정  사람이 정한 값 — 입력칸·슬라이더로 바꾼다
 *   실측  장부·동기화 데이터에서 나온 값 — ERP 에서 자동 계산되면 그 값이 기본값
 *   계산  다른 가정에서 따라 나오는 값 — 직접 덮어쓸 수도 있다
 *   고정  바꿀 이유가 없는 값 (부가세율)
 */
export type AssumptionKind = "가정" | "실측" | "계산" | "고정";

/** null = 「입력 필요」 — 비워 둔 값. 이 값에 기대는 계산은 결과도 비운다 */
export type AssumptionValue = number | boolean | null;

export interface AssumptionDef {
  key: string;
  label: string;
  /** 장표 칩에 쓰는 짧은 이름 — 없으면 label */
  short?: string;
  /** 만원 · % · 건 · 원/C · C · 개월 · 곳 · 일 … (bool 이면 빈 문자열) */
  unit: string;
  default: AssumptionValue;
  min?: number;
  max?: number;
  step?: number;
  group: AssumptionGroup;
  kind: AssumptionKind;
  /** 근거 한 줄 */
  source: string;
  note?: string;
  /** 켜기/끄기 · 몇 개 중 고르기 */
  type?: "number" | "bool" | "choice";
  /** type = choice 일 때 고를 수 있는 값 */
  options?: { value: number; label: string }[];
  /** 실측인데 ERP 가 아닌 자료에서 온 값의 기준일 (예: 「9/22 자료」) */
  asOf?: string;
}

// ---- 실측 --------------------------------------------------

/** 학원 한 곳 — 학원 이름은 내용과 같은 보호를 받는다 (로그인 뒤에서만) */
export interface AcademyActual {
  id: string;
  name: string;
  payments: number;
  /** 결제 합계 (원) */
  total: number;
  /** 첫 결제 달 YYYY-MM */
  firstMonth: string;
  lastDate?: string;
  /** 첫 결제 달부터 기준 달까지 개월 수 (양 끝 포함) */
  months: number;
  /** 월 지출 = total ÷ months (원) */
  monthlySpend: number;
  /** 산 크레딧 합계 — 결제액을 환산표로 바꾼 값 */
  credits: number;
  /** 월 필요 크레딧 (구매량 대용) = credits ÷ months */
  monthlyCredits: number;
  /** 첫 결제 뒤 다른 달에 다시 결제했나 */
  repeat?: boolean;
  /** 더 큰 묶음으로 올렸나 */
  upgraded?: boolean;
}

export interface SmoatMonthActual {
  month: string;
  /** 사이트 대시보드에 보이는 합 (내부·테스트 결제 포함) */
  dashboard: number;
  /** 내부·테스트 결제 */
  internal: number;
  /** 학원 이름 없는 입금 */
  unnamed: number;
  /** 실제 학원 결제 */
  academies: number;
  payments: number;
}

export interface SmoatActuals {
  /** 마지막 동기화 날짜 (YYYY-MM-DD) */
  asOf: string;
  /** 월 지출·필요량을 나누는 기준 달 */
  baseMonth: string;
  months: SmoatMonthActual[];
  academies: AcademyActual[];
  unnamed: { payments: number; total: number };
  totals: { academies: number; payments: number; total: number };
  /** 재구매 — cohort 기간에 첫 결제한 학원 중 다른 달에 다시 결제한 곳 */
  repurchase: { from: string; to: string; cohort: number; repeat: number; upgraded: number };
  aiCost: {
    from: string;
    to: string;
    krw: number;
    creditsUsed: number;
    creditsSold: number;
    /** 원/C */
    perCredit: number;
    /** 쓰인 크레딧 중 판 크레딧으로 설명되지 않는 몫 (무료 사용 근사) */
    freeShare: number;
  };
  /** 기준 달 매출 — 내부·테스트 제외, 이름 없는 입금 포함 (원) */
  revMonth: number;
  /** 사용자 확인값으로 바꿨을 때 원래 ERP 값 */
  revMonthErp?: number;
  /** 기준 달 AI 원가 (원) — 원가 기록이 없으면 null */
  baseAiKrw: number | null;
  /** 실제 학원 결제의 월평균 (원) — 첫 결제 달부터 기준 달까지 */
  avgMonthly: number;
  avgFrom: string;
  peak: { month: string; amount: number };
  /** 가장 큰 학원의 매출 비중 (0~1) */
  topShare: number;
  /** 실제 학원 결제의 묶음(결제액)별 건수 — 작은 묶음이 몇 %인가 */
  packMix: { price: number; count: number }[];
}

export interface ProjectActual {
  code: string;
  name: string;
  /** 매출·계약 금액 (원) */
  revenue: number;
  /** 직접비 (원, 내부 인건비 제외) */
  direct: number;
  rate: number;
  basis: "장부" | "체크리스트";
  /** ERP 체크리스트 준비 품목 수 (체크리스트가 없으면 없음) */
  items?: number;
  /** 성격 (제품형 · 향 중심 …) — 내용의 규칙에서 */
  kind?: string;
}

export interface FinanceActuals {
  /** 장부 마지막 거래일 */
  asOf: string;
  ledgerEnd: string;
  b2b: {
    from: string;
    to: string;
    total: number;
    clients: number;
    perClient: number;
    dealsPerMonth: number;
    maxSingle: number;
    /** 9~1월 비중 (0~1) */
    peakShare: number;
    monthly: { month: string; amount: number }[];
    /** 최근 6개월 월평균 */
    recentAvg: number;
    recentFrom: string;
  };
  subsidy: { from: string; to: string; total: number; months: number; monthlyAvg: number };
  cost: {
    from: string;
    to: string;
    monthlyAvg: number;
    /** 빼고 센 금액의 월평균 */
    excludedVat: number;
    excludedCardPay: number;
    /** 공용 사업부 지출 월평균 */
    commonMonthlyAvg: number;
    /** 같은 방법으로 12개월 (B2B 12개월과 같은 기간) — 기준 기간을 12개월로 볼 때 */
    from12?: string;
    monthlyAvg12?: number;
    commonMonthlyAvg12?: number;
  };
  projects: ProjectActual[];
  /** 프로젝트 직접비율 가중평균 (0~1) */
  projectsRate: number;
}

export interface DeckActuals {
  smoat?: SmoatActuals;
  finance?: FinanceActuals;
}

// ---- 장표 내용 -------------------------------------------------

/**
 * 장표 블록. 글자 안의 `{{v.키|형식}}` · `{{r.경로|형식}}` 은 가정값과 계산 결과로
 * 바뀐다 (template.ts). `[^3]` 은 출처 3번 각주.
 */
export type Block =
  /** size note = 각주성 설명 한 줄 (작은 글씨, 역할: 각주) */
  | { type: "text"; md: string; size?: "sm" | "md" | "lg" | "xl" | "note"; muted?: boolean }
  | { type: "bullets"; items: (string | { t: string; sub?: string[] })[]; size?: "sm" | "md" | "lg"; numbered?: boolean }
  | {
      type: "table";
      head: string[];
      rows: string[][];
      /** 열마다 l · r · c */
      align?: string;
      /** 열 너비 비율 */
      widths?: number[];
      /** 강조할 행 (0부터) */
      strong?: number[];
      /** 강조할 열 (0부터) */
      strongCols?: number[];
      note?: string;
      size?: "xs" | "sm" | "md" | "lg";
    }
  | { type: "kpis"; items: { label: string; value: string; sub?: string; tone?: Tone }[]; cols?: number }
  | { type: "callout"; md: string; tone?: Tone; label?: string; big?: boolean }
  /** 아이콘 카드 — 이유·상태·결정 목록. icon 은 components/.../icons.tsx 의 이름 */
  | {
      type: "icons";
      items: { icon?: string; title: string; body?: string; tag?: string; tone?: Tone; span?: number; big?: boolean }[];
      cols?: number;
      numbered?: boolean;
    }
  /** 좌우 체크리스트 — 칸마다 표시(✕ 하지 않을 것 · ✓ 할 것)와 항목 */
  | { type: "checks"; cols: { title: string; mark: "x" | "check"; tone?: Tone; items: string[] }[] }
  /** 흐름도 — 줄마다 단계들 → 결과 (전과 후 비교) */
  | { type: "flow"; rows: { label: string; steps: string[]; result?: string; tone?: Tone }[] }
  /** 계단 — 뒤로 갈수록 높아지는 단계 */
  | { type: "stairs"; items: { title: string; body?: string }[] }
  | { type: "cols"; cols: Block[][]; widths?: number[]; gap?: number }
  | { type: "card"; title?: string; tone?: Tone; blocks: Block[] }
  | { type: "steps"; items: { title: string; body?: string }[]; dir?: "row" | "col" }
  | { type: "spacer"; h?: number }
  | { type: "computed"; kind: string; opts?: Record<string, unknown> };

export type Tone = "accent" | "good" | "bad" | "warn" | "muted" | "a" | "b";

export interface SlideSpec {
  id: string;
  /** 화면에 찍는 번호 — "1" · "A3" */
  no: string;
  chapter: string;
  kicker?: string;
  title: string;
  lead?: string;
  blocks: Block[];
  /** 발표자 노트 (N) — 여러 문단은 빈 줄로 */
  notes?: string;
  /** 이 장표에 쓰인 가정 — 칩으로 보인다. 템플릿·계산 블록이 쓰는 키는 자동으로 더해진다 */
  keys?: string[];
  /** 부록 여부 */
  appendix?: boolean;
  /**
   * 장 안에서 누를 것이 있다 (매물 링크 등) — 좌우 클릭존을 치운다.
   * 매물 블록이 있으면 화면이 알아서 켠다.
   */
  interactive?: boolean;
  /** 표지처럼 큰 글자 한 장 */
  layout?: "default" | "hero";
}

export interface DeckProperty {
  id: string;
  region: string;
  no: number;
  location: string;
  layout: string;
  money: string;
  monthlyFixed: string;
  articleNos: string[];
  feature: string;
  /** 자산 id (assets/{id}) — 없으면 「사진 없음」 */
  photo?: string | null;
  lat: number;
  lng: number;
  /** 좌표가 근사치인가 */
  approx?: boolean;
  /** 현 매장에서 걸어서 */
  walk?: string;
  extra?: string;
  /** 월 고정비 범위 (만원) — 지역 비교 카드가 쓴다 */
  fixedMin?: number;
  fixedMax?: number;
  /**
   * 층별 광고 — 카드 안 작은 링크 칩. 첫 번째가 카드 전체 링크다.
   * ended = 광고가 내려간 매물 (링크는 두되 「광고 종료」 배지)
   */
  links?: { no: string; label: string; ended?: boolean }[];
}

/** 네이버 부동산 광고 주소 */
export const naverArticleUrl = (no: string) => `https://fin.land.naver.com/articles/${encodeURIComponent(no)}`;

export interface DeckRegion {
  id: string;
  name: string;
  title: string;
  verdict: string;
  /** 한 장 지도의 핀 머리글자 (A · B · C · D) */
  code?: string;
  /** 지역 비교 카드의 한 줄 평 (짧게) */
  brief?: string;
  /** 지역 상세 부록 장 id — 비교 카드를 누르면 그 장으로 간다 */
  detailSlide?: string;
  /**
   * 지도에 현 매장을 같이 찍나 — 너무 멀면(성수) 빼고 거리만 적는다.
   * 지도 범위·타일은 이 점들로 계산한다 (map.ts fitMap).
   */
  includeStore?: boolean;
  /** 한 장 지도에서 따로 확대해 보이는 지역 (현 매장 근처) */
  inset?: boolean;
  /** 지도 핀 색 (CSS 색 또는 var(--…)) */
  color?: string;
}

export interface DeckSource {
  id: number;
  label: string;
  url?: string;
  /** 확인 결과 한 줄 (예: 「2026-09-29 확인, 문구 일치」) */
  checked?: string;
}

export interface DeckMeta {
  title: string;
  dateLabel: string;
  presenter: string;
  /** 발표 화면 포인트 색 */
  accent?: string;
}

/** 실측 규칙 — 방법은 코드(actuals.ts), 이름·표·기간은 내용 쪽 */
export interface DeckActualRules {
  smoat: {
    /** 내부·테스트로 보고 뺄 학원 이름 */
    excludeNames: string[];
    /** 이 상태의 줄은 뺀다 (예: MANUAL_GRANT) */
    excludeStatuses: string[];
    /** 이 이름은 「이름 없는 입금」으로 따로 센다 */
    unnamedNames: string[];
    /** 결제액(원) → 크레딧 */
    creditTable: { price: number; credits: number }[];
    /** AI 원가 평균을 내는 첫 달 */
    aiCostFrom: string;
    /** 재구매 cohort 기간 */
    repurchaseFrom: string;
    repurchaseTo: string;
    /** 기준 달 — 비우면 마지막 결제 달 */
    baseMonth?: string;
    /**
     * 기준 달 매출을 사람이 확인한 값 (원). 동기화가 늦어 ERP 값이 이보다 작을 때만
     * 이 값을 쓴다 — ERP 가 따라오면 ERP 값.
     */
    confirmedRevMonth?: { month: string; amount: number; note: string };
  };
  finance: {
    /** B2B 거래처 이름 합치기 (정규화한 이름 → 대표 이름) */
    vendorAliases: Record<string, string>;
    /** 장부 마지막 달을 비우면 자동 (가장 최근 거래 달) */
    ledgerEnd?: string;
    /** 프로젝트 코드 → 장표에 쓰는 이름 */
    projectNames?: Record<string, string>;
    /** 프로젝트 코드 → 성격 (성격별 직접비율 막대) */
    projectKinds?: Record<string, string>;
  };
}

export interface DeckContent {
  slug: string;
  version: number;
  meta: DeckMeta;
  assumptions: AssumptionDef[];
  /** 요금제 이름 — 가격·크레딧은 가정값(tier1Price …)으로 */
  tierNames: string[];
  /** 매출 구성 막대의 갈래 — 가정 키 · 이름 · 사업부 표시 (이름은 내부 표현이라 내용 쪽에 둔다) */
  mix: { key: string; label: string; unit: string }[];
  /** 학원 월 크레딧 구간 경계 (이하) — 예 [300, 800, 2000] */
  creditBands: number[];
  /** 상품별 직접비율 가정의 키와 표시 이름, 시작가(만원) */
  products: {
    key: string;
    name: string;
    startPrice: number;
    market: string;
    edge: string;
    /**
     * 경쟁 시세 범위 위에 우리 시작가 점을 찍는 값 (상품마다 단위가 달라 한 줄씩 제 눈금).
     * 공개 시세가 없으면 비운다.
     */
    range?: { unit: string; min: number; max: number; maxPlus?: boolean; ours: number; note?: string };
  }[];
  rules: DeckActualRules;
  /** ERP 를 못 읽으면 대신 쓰는 값 */
  snapshot: DeckActuals & { note: string };
  regions: DeckRegion[];
  properties: DeckProperty[];
  currentStore: { label: string; lat: number; lng: number };
  sources: DeckSource[];
  slides: SlideSpec[];
}

/** 서버가 화면에 주는 것 */
export interface DeckPayload {
  content: DeckContent;
  actuals: DeckActuals;
  /** 실측을 못 읽은 부분과 이유 — 화면은 이 부분에 스냅샷을 쓴다 */
  errors: { smoat?: string; finance?: string };
  source: "firestore" | "local";
  serverTime: number;
}

/** 회의용 저장본 */
export interface DeckScenario {
  id: string;
  slug: string;
  name: string;
  values: Record<string, AssumptionValue>;
  createdBy: string;
  createdAt: number;
}
