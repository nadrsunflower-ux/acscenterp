// ============================================================
//  재무 마스터 데이터 — 엑셀 장부에서 추출 (자동 생성)
// ------------------------------------------------------------
//  출처: 2607(주)네안데르_장부_OPENROUTER정리완.xlsx
//        시트 통합_MAP / 계좌카드목록 / 통합_LISTS / 구독서비스 관리
//
//  ⚠️ 손으로 고치지 말 것. 엑셀이 바뀌면 다시 추출한다.
//     이 파일은 "마스터 초기 적재(seed)"의 원본이며, 적재 후에는
//     Firestore(neander_fin_accounts 등)가 정본이 된다.
// ============================================================

/** 계정 — 통합_MAP 의 잎 계정. 자연키는 4단 경로 전체(lookupKey). */
export interface FinAccountMaster {
  /** 조회키: `거래유형|계정대분류|계정중분류|계정소분류` */
  lookupKey: string;
  txType: string;
  major: string;
  mid: string;
  minor: string;
  /** 용례 설명 */
  example: string;
  /** 회계코드 (SL-002 등) */
  code: string;
  /** 부가세공제여부 */
  vat: string;
  /** 자산여부 */
  asset: string;
  /** 결제수단구분 기본값 */
  pay: string;
  /** 지점코드 */
  branch: string;
  /**
   * 은퇴 계정 (기본 true).
   *
   * 매장 폐점 등으로 더는 쓰지 않지만 과거 거래가 물려 있어 지울 수 없는
   * 계정은 false 로 둔다. 리포트·조인·월별 비교에는 그대로 잡히고,
   * 계정 선택 드롭다운과 AI 분류 추천에서만 빠진다 — 새 거래가 실수로
   * 붙는 것을 막는다. 이력이 있는 계정은 지우지 않는 것이 원칙이다.
   */
  active?: boolean;
}

/** 계좌·카드 — 뒷 4자리가 거래장의 `계좌/카번` 과 매칭된다. */
export interface FinPaymentMethodMaster {
  last4: string;
  alias: string;
  /** 사업장 (네안데르 / 안다르 / 일해라컴퍼니 / 와작홈즈) */
  site: string;
  /**
   * 임직원 **개인 명의** 카드인가 (회사 비용을 개인 카드로 긋고 나중에 대납).
   *
   * ⚠️ 별칭의 (신법)·(국법) 은 개인 카드가 아니다. **신한법인 · 국민법인**
   *    이고 뒤에 붙은 이름은 소지자다. 즉 지금 등록된 카드 14장은 전부
   *    법인카드이며 이 값은 모두 false 다. (2026-08-24 확인)
   *    처음에는 「법」을 개인 표기로 잘못 읽어 true 로 넣어 뒀었다.
   */
  personal: boolean;
  /**
   * 결제수단 종류. **현금흐름 기준 집계의 근거**다.
   *   account 통장 — 결제 시점이 곧 출금 시점
   *   card    카드 — 사용 시점과 대금 출금 시점이 다르다
   *   cash    현금 — 통장과 같게 본다
   * 지금은 카드 14장이 전부 법인카드라 personal 은 모두 false 다. 그래도
   * 별도 필드로 두는 건 개인 카드 대납이 생겼을 때 현금흐름 판정(kind)과
   * 정산 대상 판정(personal)이 서로 다른 질문이기 때문이다.
   */
  kind: "account" | "card" | "cash";
  /**
   * 어느 은행·카드사의 것인가 — 월별 적재 퍼즐이 파일을 칸에 맞출 때 쓴다.
   * 비어 있으면 별칭의 앞머리(신한·국민·우리·토스·카카오 / (신법)·(국법))로
   * 추정한다 (finance/import-slots.ts 의 bankOfMethod).
   */
  bank?: FinBankId;
  /**
   * 매달 거래내역 파일을 올리는 계좌인가 (퍼즐의 한 칸).
   * 비어 있으면 「통장이고 대출 계좌가 아니면 예」로 본다. 대출·현금·카드
   * 낱장은 파일이 따로 없으므로 칸이 아니다 (카드는 카드사 단위로 한 칸).
   */
  monthly?: boolean;
}

/** 은행·카드사 식별자 — 어댑터 id 와 1:1 (finance/import-slots.ts 의 FIN_BANKS) */
export type FinBankId = "kb" | "shinhan" | "woori" | "toss" | "kakao" | "kb-card" | "shinhan-card";

/**
 * 구독 서비스 마스터 — 엑셀 「구독서비스 관리」 + 「구독결제수단 정비」 시트
 *
 * 거래처 키워드만 쓰던 옛 규칙(FIN_VENDOR_RULES)을 대체한다. 두 가지가 다르다:
 *
 *  ① **계정으로 먼저 좁힌다.** 구독 계정(구독서비스비·툴구독비·개발프로그램구독비)
 *     안에서만 거래처를 맞춘다. 안 그러면 사람 이름 키워드가 급여 이체를
 *     구독비로 끌어온다 — 2026-07 실측 500만원이 그렇게 섞였다.
 *
 *  ② **키워드가 여러 개다.** 같은 서비스가 결제 창구마다 다른 이름으로 찍힌다.
 *     Anthropic 은 `ANTHROPIC* CLAUDE SUB` · `ANTHROPIC` · `CLAUDE.AI SUBSCRIPTION`
 *     세 가지로 들어오는데, 키워드 하나(`ANTHROPIC`)면 마지막 483,175원을 놓친다.
 *
 * `recommendedCard` 는 「구독결제수단 정비」 시트의 권장안이다. 현재 결제는
 * 전부 임직원 개인 명의 카드라(법인카드 0장) 이 열은 아직 "계획"이다.
 */
export interface FinSubscriptionMaster {
  service: string;
  /** 거래처명에 이 중 하나가 포함되면 매칭 (대소문자 무시) */
  keywords: string[];
  /** 이 계정소분류일 때만 매칭. 비우면 구독 계정 전체 */
  acctMinors?: string[];
  /** monthly 월정액 · usage 사용량 과금 */
  cycle: "monthly" | "usage";
  /** 월 예상액. 있으면 초과할 때 경고한다 (없으면 과거 중앙값을 기준으로 본다) */
  expected?: number;
  /** 권장 결제수단 그룹 — 「카드 1장 = 목적 1개」 */
  recommendedCard?: string;
  /** active 정상 · review 확인 필요 · cancelled 해지 */
  status: "active" | "review" | "cancelled";
  note?: string;
}

export const FIN_SUBSCRIPTIONS: FinSubscriptionMaster[] = [
  // ---- 전사 공통 SaaS ----
  { service: "Anthropic (Claude)", keywords: ["ANTHROPIC", "CLAUDE"], cycle: "monthly", recommendedCard: "법인_공용SaaS", status: "active", note: "결제 창구가 3종(ANTHROPIC* CLAUDE SUB / ANTHROPIC / CLAUDE.AI) — 카드 분산" },
  { service: "OpenAI (ChatGPT)", keywords: ["OPENAI"], cycle: "monthly", recommendedCard: "법인_공용SaaS", status: "active" },
  { service: "카페24", keywords: ["카페24"], cycle: "monthly", recommendedCard: "법인_공용SaaS", status: "active", note: "조향 원자재비로 오분류된 건 있음" },
  { service: "Adyen", keywords: ["Adyen"], cycle: "monthly", recommendedCard: "법인_공용SaaS", status: "review", note: "용도 확인 필요" },
  { service: "SGT", keywords: ["SGT"], cycle: "monthly", recommendedCard: "법인_공용SaaS", status: "review", note: "서비스 정체 확인 필요" },

  // ---- 인프라 (사용량 과금) ----
  { service: "Google Cloud", keywords: ["구글클라우드", "GOOGLE CLOUD"], cycle: "usage", recommendedCard: "법인_인프라", status: "active", note: "카드 2장 분산 · 프로젝트별 결제계정 분리 검토" },
  { service: "OpenRouter", keywords: ["OPENROUTER"], cycle: "usage", recommendedCard: "법인_인프라", status: "active", note: "키별 사용량으로 SMOAT·사내개발 배분 (OpenRouter배분 시트)" },
  { service: "Vercel", keywords: ["VERCEL"], cycle: "usage", recommendedCard: "법인_인프라", status: "active" },
  { service: "Supabase", keywords: ["SUPABASE"], cycle: "usage", recommendedCard: "법인_인프라", status: "active", note: "카드 2장 분산" },
  { service: "fal.ai", keywords: ["FAL FEATURES"], cycle: "usage", recommendedCard: "법인_인프라", status: "active" },
  { service: "다날 호스팅", keywords: ["다날"], cycle: "monthly", recommendedCard: "법인_인프라", status: "active" },

  // ---- 마케팅·제작 도구 ----
  { service: "미리디(미리캔버스)", keywords: ["미리디"], cycle: "monthly", recommendedCard: "법인_마케팅", status: "active" },
  { service: "Envato", keywords: ["ENVATO"], cycle: "monthly", recommendedCard: "법인_마케팅", status: "active" },
  { service: "Canva", keywords: ["CANVA"], cycle: "monthly", recommendedCard: "법인_마케팅", status: "active", note: "청구서가 건별로 쪼개져 들어온다" },
  { service: "Higgsfield", keywords: ["HIGGSFIELD"], cycle: "monthly", recommendedCard: "법인_마케팅", status: "active" },
  { service: "KlingAI", keywords: ["KLINGAI"], cycle: "monthly", recommendedCard: "법인_마케팅", status: "active", note: "영상생성 AI" },
  { service: "베러웨이시스템즈", keywords: ["베러웨이"], cycle: "monthly", recommendedCard: "법인_마케팅", status: "active" },

  // ---- 개인 대납 (구조 폐지 대상) ----
  // 이름 키워드지만 구독 계정 안에서만 맞추므로 급여가 섞이지 않는다.
  { service: "OpenRouter 대납(김제연)", keywords: ["김제연"], cycle: "usage", recommendedCard: "※ 법인카드 직접결제로 전환", status: "review", note: "대납 구조 폐지 대상 — 계정 자체를 프로젝트별로 분리 필요" },
  { service: "유튜브(이동주)", keywords: ["이동주"], cycle: "monthly", recommendedCard: "※ 법인카드 직접결제로 전환", status: "review", note: "대납 구조 폐지 대상" },
  { service: "개인대납(김주연)", keywords: ["김주연"], cycle: "monthly", recommendedCard: "※ 법인카드 직접결제로 전환", status: "review", note: "대납 구조 폐지 대상" },
  { service: "개인대납(유재영)", keywords: ["유재영"], cycle: "monthly", recommendedCard: "※ 법인카드 직접결제로 전환", status: "review", note: "대납 구조 폐지 대상" },

  // ---- 정체 미상 ----
  { service: "카카오페이 (미상)", keywords: ["카카오페이"], cycle: "monthly", status: "review", note: "결제대행 표기라 실제 서비스를 알 수 없다 — 거래처를 실제 서비스명으로 고칠 것" },
];

/**
 * 공통비 배분 규칙 — 사업부 손익을 "진짜" 손익으로 만드는 장치.
 *
 * 공용·홍대공용에 쌓인 비용은 어느 사업부에도 귀속돼 있지 않다. 그래서
 * 와우·아이디의 흑자는 공통비를 빼기 전 숫자다(2026-07 기준 공용 -3,071만,
 * 홍대공용 -1,528만). 이걸 나눠 실어야 "이 사업부가 돈을 버는가"에 답할 수 있다.
 *
 * ⚠️ **전부 비활성으로 시드한다.** 배분은 사실이 아니라 **경영 판단**이다.
 *    드라이버(무엇에 비례해 나눌 것인가)를 정하는 순간 사업부 손익이 달라지므로,
 *    사람이 규칙을 보고 켜기 전까지는 아무것도 바꾸지 않는다.
 *
 * ⚠️ OpenRouter 사용량 배분은 규칙으로 넣지 않았다. 이미 장부에서 수동으로
 *    재분류(2026-07-31 SMOAT -285,535 ↔ 공용 +285,535)돼 있어 규칙까지 걸면
 *    이중 계상된다.
 */
export interface FinAllocationMaster {
  /** 규칙 이름 (문서 id 로도 쓴다) */
  name: string;
  /** 배분 원천 사업부 */
  fromMajor: string;
  fromMinor: string;
  /** 이 계정대분류만 배분. 비우면 원천의 지출 전체 */
  acctMajors?: string[];
  /**
   * 배분 기준.
   *   revenue 대상 사업부의 수입 비율
   *   expense 대상 사업부의 지출 비율
   *   fixed   shares 에 적은 고정 비율
   */
  driver: "revenue" | "expense" | "fixed";
  /** 배분 받을 사업부 `대분류|소분류`. 비우면 원천을 뺀 전부 */
  targets?: string[];
  /** driver=fixed 일 때의 비율 (합이 1) */
  shares?: Record<string, number>;
  active: boolean;
  note?: string;
}

export const FIN_ALLOCATIONS: FinAllocationMaster[] = [
  {
    name: "홍대공용 → 와우·아이디 (매출비율)",
    fromMajor: "B2C",
    fromMinor: "홍대공용",
    driver: "revenue",
    targets: ["B2C|와우", "B2C|아이디"],
    active: false,
    note: "홍대 두 매장이 함께 쓰는 공간·인력 비용. 매출이 큰 쪽이 더 많이 쓴다고 본다. ⚠ 매출비율이라 그 달 매출이 0 인 사업부는 한 푼도 받지 않는다.",
  },
  {
    name: "공용 → 전 사업부 (매출비율)",
    fromMajor: "공용",
    fromMinor: "공용",
    driver: "revenue",
    active: false,
    note: "전사 인건비·임차료·SaaS. 매출 비율은 가장 무난한 기본값이다. ⚠ 매출이 0 인 사업부(예: 그 달 매출 없는 조향·개발)는 공통비를 받지 않아 실제보다 좋아 보인다 — 인원수·사용량 기준이 맞으면 fixed 로 바꿔 쓴다.",
  },
  {
    name: "공용 인건비만 → 전 사업부 (매출비율)",
    fromMajor: "공용",
    fromMinor: "공용",
    acctMajors: ["인건비"],
    driver: "revenue",
    active: false,
    note: "공용 전액이 부담스러우면 인건비만 먼저 나눠 보는 용도. 위 규칙과 함께 켜면 인건비가 두 번 배분되니 둘 중 하나만 켠다.",
  },
];

/** 거래처 키워드 → 구독 서비스 매핑 (자동분류·구독비 집계에 사용) */
export interface FinVendorRuleMaster {
  service: string;
  /** 거래처명에 이 문자열이 포함되면 매칭 (대소문자 무시) */
  keyword: string;
}

export const FIN_ACCOUNTS: FinAccountMaster[] = [
  { lookupKey: "수입|매출|B2C매출|온라인판매", txType: "수입", major: "매출", mid: "B2C매출", minor: "온라인판매", example: "자사몰·오픈마켓 등 온라인 채널 제품 판매", code: "SL-001", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2C매출|와우판매", txType: "수입", major: "매출", mid: "B2C매출", minor: "와우판매", example: "와우 매장 현장 판매", code: "SL-002", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "HON" },
  { lookupKey: "수입|매출|B2C매출|신촌판매", txType: "수입", major: "매출", mid: "B2C매출", minor: "신촌판매", example: "신촌 매장 현장 판매(2025 하반기 폐점 — 과거 거래용)", code: "SL-007", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "SIN", active: false },
  { lookupKey: "수입|매출|B2C매출|아이디판매", txType: "수입", major: "매출", mid: "B2C매출", minor: "아이디판매", example: "아이디 매장 현장 판매", code: "SL-003", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "ID" },
  { lookupKey: "수입|매출|B2C매출|정기구독", txType: "수입", major: "매출", mid: "B2C매출", minor: "정기구독", example: "정기구독 상품 결제 수입", code: "SL-004", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2C매출|선물세트", txType: "수입", major: "매출", mid: "B2C매출", minor: "선물세트", example: "시즌·명절 선물세트 판매", code: "SL-005", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2C매출|팝업현장판매", txType: "수입", major: "매출", mid: "B2C매출", minor: "팝업현장판매", example: "팝업·페어 현장 판매", code: "SL-006", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "HQ" },
  { lookupKey: "수입|매출|B2C매출|공간대관", txType: "수입", major: "매출", mid: "B2C매출", minor: "공간대관", example: "매장·공간 대관료(B2C 개인 대관)", code: "SL-051", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2C매출|장비대여", txType: "수입", major: "매출", mid: "B2C매출", minor: "장비대여", example: "장비·기기 대여료(B2C)", code: "SL-052", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|법인대량구매", txType: "수입", major: "매출", mid: "B2B매출", minor: "법인대량구매", example: "법인 대량 구매 주문", code: "SL-011", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|납품계약", txType: "수입", major: "매출", mid: "B2B매출", minor: "납품계약", example: "정기 납품계약 기반 매출", code: "SL-012", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|기업선물", txType: "수입", major: "매출", mid: "B2B매출", minor: "기업선물", example: "기업 명절·기념일 선물 단체주문", code: "SL-013", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|OEM제작", txType: "수입", major: "매출", mid: "B2B매출", minor: "OEM제작", example: "타사 브랜드 OEM·ODM 제작", code: "SL-014", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|향기컨설팅", txType: "수입", major: "매출", mid: "B2B매출", minor: "향기컨설팅", example: "향기 컨설팅 용역(시그니처스멜 기획 등)", code: "SL-021", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|공간컨설팅", txType: "수입", major: "매출", mid: "B2B매출", minor: "공간컨설팅", example: "공간 향기·연출 컨설팅 용역", code: "SL-022", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|브랜딩컨설팅", txType: "수입", major: "매출", mid: "B2B매출", minor: "브랜딩컨설팅", example: "브랜딩·브랜드 전략 컨설팅 용역", code: "SL-023", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|원데이클래스", txType: "수입", major: "매출", mid: "B2B매출", minor: "원데이클래스", example: "1회성 원데이 클래스 수강료", code: "SL-031", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|정규클래스", txType: "수입", major: "매출", mid: "B2B매출", minor: "정규클래스", example: "다회차 정규 클래스 수강료", code: "SL-032", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|기업워크숍", txType: "수입", major: "매출", mid: "B2B매출", minor: "기업워크숍", example: "기업 단체 워크숍·팀빌딩 프로그램", code: "SL-033", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|프라이빗클래스", txType: "수입", major: "매출", mid: "B2B매출", minor: "프라이빗클래스", example: "소수 프라이빗 맞춤 클래스", code: "SL-034", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|향수제작대행", txType: "수입", major: "매출", mid: "B2B매출", minor: "향수제작대행", example: "고객 의뢰 향수 제작 대행", code: "SL-041", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|디퓨저제작대행", txType: "수입", major: "매출", mid: "B2B매출", minor: "디퓨저제작대행", example: "고객 의뢰 디퓨저 제작 대행", code: "SL-042", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "수입|매출|B2B매출|3D프린팅대행", txType: "수입", major: "매출", mid: "B2B매출", minor: "3D프린팅대행", example: "3D프린팅 출력 대행 용역", code: "SL-043", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "수입|매출|B2B매출|웹프로그램제작대행", txType: "수입", major: "매출", mid: "B2B매출", minor: "웹프로그램제작대행", example: "웹사이트·프로그램 개발 대행 용역", code: "SL-044", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|B2B매출|공간대관", txType: "수입", major: "매출", mid: "B2B매출", minor: "공간대관", example: "기업·단체 대상 공간 대관료(B2B)", code: "SL-051", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "수입|매출|B2B매출|장비대여", txType: "수입", major: "매출", mid: "B2B매출", minor: "장비대여", example: "기업·단체 대상 장비 대여료(B2B)", code: "SL-052", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "수입|기타수입|지원금|정부지원금", txType: "수입", major: "기타수입", mid: "지원금", minor: "정부지원금", example: "중앙부처·지자체 사업 지원금 수령", code: "GR-001", vat: "면세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|지원금|창업지원금", txType: "수입", major: "기타수입", mid: "지원금", minor: "창업지원금", example: "창업지원사업 선정 지원금", code: "GR-002", vat: "면세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|지원금|R&D지원금", txType: "수입", major: "기타수입", mid: "지원금", minor: "R&D지원금", example: "R&D 과제 수행 지원금", code: "GR-003", vat: "면세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|지원금|고용지원금", txType: "수입", major: "기타수입", mid: "지원금", minor: "고용지원금", example: "청년추가고용려금 등 고용관련 지원금", code: "GR-004", vat: "면세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|이자수입|예금이자", txType: "수입", major: "기타수입", mid: "이자수입", minor: "예금이자", example: "보통·기업자유 예금 이자 수입", code: "II-001", vat: "면세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|이자수입|적금이자", txType: "수입", major: "기타수입", mid: "이자수입", minor: "적금이자", example: "적금 만기·중도 이자 수입", code: "II-002", vat: "면세", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "수입|기타수입|협찬수입|제품협찬", txType: "수입", major: "기타수입", mid: "협찬수입", minor: "제품협찬", example: "협찬사로부터 받은 제품·물품 협찬", code: "SP-001", vat: "과세", asset: "비자산", pay: "현물", branch: "HON" },
  { lookupKey: "수입|기타수입|협찬수입|현금협찬", txType: "수입", major: "기타수입", mid: "협찬수입", minor: "현금협찬", example: "협찬·제휴 대가로 받은 현금", code: "SP-002", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|보험환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "보험환급", example: "보험금·보험료 환급 수령 (과거 입력분 유지용)", code: "RF-001", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|세금환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "세금환급", example: "부가세·법인세 등 세금 환급 수령 (과거 입력분 유지용)", code: "RF-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|보증금환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "보증금환급", example: "임대·거래 보증금 반환 수령 (과거 입력분 유지용)", code: "RF-003", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|마케팅비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "마케팅비환급", example: "마케팅비 지출분 환급 (과거 입력분 유지용)", code: "RF-005", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|영업비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "영업비환급", example: "영업비 지출분 환급 (과거 입력분 유지용)", code: "RF-006", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|제품개발운영비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "제품개발운영비환급", example: "제품개발운영비 지출분 환급 (과거 입력분 유지용)", code: "RF-007", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|서비스개발비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "서비스개발비환급", example: "서비스개발비 지출분 환급 (과거 입력분 유지용)", code: "RF-008", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|운영비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "운영비환급", example: "운영비 지출분 환급 (과거 입력분 유지용)", code: "RF-009", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|재무비용환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "재무비용환급", example: "재무비용 지출분 환급 (과거 입력분 유지용)", code: "RF-010", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|기획전시비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "기획전시비환급", example: "기획·전시비 지출분 환급 (과거 입력분 유지용)", code: "RF-011", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|기타비용환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "기타비용환급", example: "기타비용 지출분 환급 (과거 입력분 유지용)", code: "RF-012", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|자산투자비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "자산투자비환급", example: "자산투자비 지출분 환급 (과거 입력분 유지용)", code: "RF-013", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|기타잡수입|폐기물매각", txType: "수입", major: "기타수입", mid: "기타잡수입", minor: "폐기물매각", example: "폐기물·고철 매각 대금", code: "MI-001", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|기타잡수입|샘플판매", txType: "수입", major: "기타수입", mid: "기타잡수입", minor: "샘플판매", example: "샘플·재고문정품 할인 판매", code: "MI-002", vat: "과세", asset: "비자산", pay: "현금/카드", branch: "HQ" },
  { lookupKey: "수입|기타수입|기타잡수입|기타", txType: "수입", major: "기타수입", mid: "기타잡수입", minor: "기타", example: "분류 불가한 소액 잡수입", code: "MI-099", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|유상증자|신주발행", txType: "수입", major: "투자·자본", mid: "유상증자", minor: "신주발행", example: "유상증자 신주발행 납입금(자본, 손익 아님)", code: "CP-001", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|유상증자|전환사채", txType: "수입", major: "투자·자본", mid: "유상증자", minor: "전환사채", example: "전환사채(CB) 발행 자금 수령", code: "CP-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|대출수령|운영자금대출", txType: "수입", major: "투자·자본", mid: "대출수령", minor: "운영자금대출", example: "운전자금 용도 대출 실행(부채)", code: "CP-011", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|대출수령|시설자금대출", txType: "수입", major: "투자·자본", mid: "대출수령", minor: "시설자금대출", example: "시설·설비 투자 목적 대출 실행", code: "CP-012", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|대출수령|정책자금대출", txType: "수입", major: "투자·자본", mid: "대출수령", minor: "정책자금대출", example: "중소벌진흥공단 등 정책자금 대출", code: "CP-013", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|보증금회수|임대보증금회수", txType: "수입", major: "투자·자본", mid: "보증금회수", minor: "임대보증금회수", example: "임대차 보증금 반환 수령 (신규는 자금거래>보증금회수 사용)", code: "CP-021", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|보증금회수|거래보증금회수", txType: "수입", major: "투자·자본", mid: "보증금회수", minor: "거래보증금회수", example: "거래 보증금 반환 수령 (신규는 자금거래>보증금회수 사용)", code: "CP-022", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|자산매각|장비매각", txType: "수입", major: "투자·자본", mid: "자산매각", minor: "장비매각", example: "사용 장비·기기 처분 대금", code: "CP-031", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|투자·자본|자산매각|차량매각", txType: "수입", major: "투자·자본", mid: "자산매각", minor: "차량매각", example: "법인 차량 매각 대금", code: "CP-032", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|마케팅비|디지털광고|B2C광고비", txType: "지출", major: "마케팅비", mid: "디지털광고", minor: "B2C광고비", example: "메타(인스타/페북) 광고, 유튜브배너, 네이버검색광고", code: "MK-001", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|마케팅비|콘텐츠제작|B2C콘텐츠제작비", txType: "지출", major: "마케팅비", mid: "콘텐츠제작", minor: "B2C콘텐츠제작비", example: "사진촬영, 릴스제작, 브랜디드영상 편집", code: "MK-002", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|마케팅비|콘텐츠제작|B2C디자인외주비", txType: "지출", major: "마케팅비", mid: "콘텐츠제작", minor: "B2C디자인외주비", example: "포스터/배너 디자인, 상세페이지", code: "MK-003", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|마케팅비|콘텐츠제작|B2C일반인쇄비", txType: "지출", major: "마케팅비", mid: "콘텐츠제작", minor: "B2C일반인쇄비", example: "전단지, 엽서, 브로슈어 인쇄, 현수막, 롤스크린, 포토월", code: "MK-004", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|마케팅비|프로모션이벤트|B2C이벤트비", txType: "지출", major: "마케팅비", mid: "프로모션이벤트", minor: "B2C이벤트비", example: "오프라인 프로모션, 런칭행사, 경품 운영", code: "MK-005", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|마케팅비|프로모션이벤트|B2C프로모션비", txType: "지출", major: "마케팅비", mid: "프로모션이벤트", minor: "B2C프로모션비", example: "시즌 쿠폰, 번들 할인 프로모션", code: "MK-006", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|마케팅비|프로모션이벤트|B2C협찬비", txType: "지출", major: "마케팅비", mid: "프로모션이벤트", minor: "B2C협찬비", example: "(일반 제품 프로모션)행사/브랜드 콜라보 제품 협찬", code: "MK-007", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|마케팅비|인플루언서리뷰|B2C인플루언서비", txType: "지출", major: "마케팅비", mid: "인플루언서리뷰", minor: "B2C인플루언서비", example: "SNS 협찬, 리뷰 영상, 체험단 비용", code: "MK-008", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|마케팅비|인플루언서리뷰|B2C리뷰체험단운영비", txType: "지출", major: "마케팅비", mid: "인플루언서리뷰", minor: "B2C리뷰체험단운영비", example: "리뷰 인센티브, 샘플 배송비", code: "MK-009", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|마케팅비|리서치홍보|B2C마케팅리서치비", txType: "지출", major: "마케팅비", mid: "리서치홍보", minor: "B2C마케팅리서치비", example: "소비자 설문, 시장조사 패널", code: "MK-010", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|마케팅비|리서치홍보|B2CPR대행비", txType: "지출", major: "마케팅비", mid: "리서치홍보", minor: "B2CPR대행비", example: "보도자료 배포, 미디어 피칭", code: "MK-011", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|마케팅비|SNS채널운영|B2CSNS운영비", txType: "지출", major: "마케팅비", mid: "SNS채널운영", minor: "B2CSNS운영비", example: "캘린더 운영, 게시글 스케줄링 툴", code: "MK-012", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|마케팅비|샘플체험물|B2C샘플배포비", txType: "지출", major: "마케팅비", mid: "샘플체험물", minor: "B2C샘플배포비", example: "시향지/미니어처 발송", code: "MK-013", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|영업비|대외관계거래관리비|B2B거래처관리비", txType: "지출", major: "영업비", mid: "대외관계거래관리비", minor: "B2B거래처관리비", example: "B2B 고객 선물, 명절선물, 감사품", code: "SA-001", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|대외관계거래관리비|B2B영업미팅비", txType: "지출", major: "영업비", mid: "대외관계거래관리비", minor: "B2B영업미팅비", example: "외부 미팅 식대, 커피, 회의장 대여", code: "SA-002", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|대외관계거래관리비|B2B접대비", txType: "지출", major: "영업비", mid: "대외관계거래관리비", minor: "B2B접대비", example: "거래처 식사, 접대비 (세법한도 내)", code: "SA-003", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|영업자료제작비|B2B제안서제작비", txType: "지출", major: "영업비", mid: "영업자료제작비", minor: "B2B제안서제작비", example: "인쇄물, 디자인 외주, PT 준비비", code: "SA-004", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|영업자료제작비|B2B영업자료제작비", txType: "지출", major: "영업비", mid: "영업자료제작비", minor: "B2B영업자료제작비", example: "브로슈어, 카탈로그, 견적서 제작", code: "SA-005", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|영업활동지원비|B2B출장비", txType: "지출", major: "영업비", mid: "영업활동지원비", minor: "B2B출장비", example: "교통비, 숙박비, 출장 식비", code: "SA-006", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|영업활동지원비|B2B교통통신비", txType: "지출", major: "영업비", mid: "영업활동지원비", minor: "B2B교통통신비", example: "외근용 택시, 업무용 통화료", code: "SA-007", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|외주협업프로모션비|B2B외주커뮤니케이션비", txType: "지출", major: "영업비", mid: "외주협업프로모션비", minor: "B2B외주커뮤니케이션비", example: "외주업체 미팅, 협업비용", code: "SA-008", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|외주협업프로모션비|B2B홍보영업지원비", txType: "지출", major: "영업비", mid: "외주협업프로모션비", minor: "B2B홍보영업지원비", example: "샘플 증정, 체험제품", code: "SA-009", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|영업비|행사네트워킹비|B2B대관행사참가비", txType: "지출", major: "영업비", mid: "행사네트워킹비", minor: "B2B대관행사참가비", example: "박람회 참가비, 전시 부스비", code: "SA-010", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|영업비|행사네트워킹비|B2B법인외부활동비", txType: "지출", major: "영업비", mid: "행사네트워킹비", minor: "B2B법인외부활동비", example: "세미나/네트워킹 행사비", code: "SA-011", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|포장디자인비", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "포장디자인비", example: "패키지 그래픽 시안", code: "RD-001", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|테스트비용", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "테스트비용", example: "안정성/잔향 테스트", code: "RD-002", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|조향비용", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "조향비용", example: "내부 조향, 외주 조향 수수료", code: "RD-003", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|외주개발비", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "외주개발비", example: "제품 포뮬라/디자인 외주", code: "RD-004", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|제품개선비", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "제품개선비", example: "리뉴얼 시료·재테스트", code: "RD-005", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|시제품제작비", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "시제품제작비", example: "신제품 샘플 배치", code: "RD-006", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|RND|제작도면비", txType: "지출", major: "제품개발운영비", mid: "RND", minor: "제작도면비", example: "CAD/금형 도면 제작", code: "RD-007", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|공통원자재|향료구입비", txType: "지출", major: "제품개발운영비", mid: "공통원자재", minor: "향료구입비", example: "시트러스/플로럴 향료 구매", code: "RD-008", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|공통원자재|패키지제작비", txType: "지출", major: "제품개발운영비", mid: "공통원자재", minor: "패키지제작비", example: "박스/라벨 대량 제작", code: "RD-009", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|공통원자재|시향지제작비", txType: "지출", major: "제품개발운영비", mid: "공통원자재", minor: "시향지제작비", example: "인쇄 시향 카드 제작", code: "RD-010", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|공통원자재|원자재비", txType: "지출", major: "제품개발운영비", mid: "공통원자재", minor: "원자재비", example: "용기, 마개, 라벨지", code: "RD-011", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|생카원자재|직접생산원자재비", txType: "지출", major: "제품개발운영비", mid: "생카원자재", minor: "직접생산원자재비", example: "필름라벨, 팬시페이퍼 등", code: "RD-012", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|제품개발운영비|생카원자재|외부발주원자재비", txType: "지출", major: "제품개발운영비", mid: "생카원자재", minor: "외부발주원자재비", example: "레드프린팅, 애즈랜드, 배너공장 등", code: "RD-013", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|개발디자인비|웹개발비", txType: "지출", major: "서비스개발비", mid: "개발디자인비", minor: "웹개발비", example: "예약/결제 웹 기능 개발", code: "SV-001", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|개발디자인비|AI모델개발비", txType: "지출", major: "서비스개발비", mid: "개발디자인비", minor: "AI모델개발비", example: "향 추천/감성 분석 모델", code: "SV-002", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|개발디자인비|UIUX디자인비", txType: "지출", major: "서비스개발비", mid: "개발디자인비", minor: "UIUX디자인비", example: "플로우맵, 와이어프레임", code: "SV-003", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|서버인프라비용|서버호스팅비", txType: "지출", major: "서비스개발비", mid: "서버인프라비용", minor: "서버호스팅비", example: "AWS/네이버클라우드", code: "SV-004", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|서버인프라비용|도메인비", txType: "지출", major: "서비스개발비", mid: "서버인프라비용", minor: "도메인비", example: "도메인 등록/연장", code: "SV-005", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|서버인프라비용|클라우드비용", txType: "지출", major: "서비스개발비", mid: "서버인프라비용", minor: "클라우드비용", example: "스토리지/백업 구독", code: "SV-006", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|외부연동API비|API사용료", txType: "지출", major: "서비스개발비", mid: "외부연동API비", minor: "API사용료", example: "카카오/구글 API 호출", code: "SV-007", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|외부연동API비|결제모듈비", txType: "지출", major: "서비스개발비", mid: "외부연동API비", minor: "결제모듈비", example: "토스페이/카드 모듈", code: "SV-008", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|툴보안유지비|개발프로그램구독비", txType: "지출", major: "서비스개발비", mid: "툴보안유지비", minor: "개발프로그램구독비", example: "CURSOR, CLAUDE, FLUX, VERCEL, SUPERBASE", code: "SV-009", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|툴보안유지비|보안유지비", txType: "지출", major: "서비스개발비", mid: "툴보안유지비", minor: "보안유지비", example: "SSL, 보안 솔루션", code: "SV-010", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|운영유지보수비|유지보수비", txType: "지출", major: "서비스개발비", mid: "운영유지보수비", minor: "유지보수비", example: "버그 픽스, 소규모 기능개선", code: "SV-011", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|운영유지보수비|시스템외주비", txType: "지출", major: "서비스개발비", mid: "운영유지보수비", minor: "시스템외주비", example: "프리랜서 개발 용역", code: "SV-012", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|운영유지보수비|데이터관리비", txType: "지출", major: "서비스개발비", mid: "운영유지보수비", minor: "데이터관리비", example: "DB 백업/로그 분석", code: "SV-013", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|웹사이트관리비|웹사이트리뉴얼비", txType: "지출", major: "서비스개발비", mid: "웹사이트관리비", minor: "웹사이트리뉴얼비", example: "디자인 개편 프로젝트", code: "SV-014", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|웹사이트관리비|CMS비용", txType: "지출", major: "서비스개발비", mid: "웹사이트관리비", minor: "CMS비용", example: "콘텐츠 관리 시스템 구독", code: "SV-015", vat: "공제", asset: "비자산", pay: "법인카드", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|임차료", txType: "지출", major: "운영비", mid: "와우운영비", minor: "임차료", example: "와우점 월세", code: "OP-001", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|관리비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "관리비", example: "건물관리비, 공용관리비", code: "OP-002", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|전기수도통신비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "전기수도통신비", example: "매장 전기세, 수도요금", code: "OP-003", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|인테리어유지비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "인테리어유지비", example: "가벽, 조명, 인테리어 보수", code: "OP-004", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|매장인건비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "매장인건비", example: "매장근무 알바생 인건비 (본사근무 인원 제외)", code: "OP-005", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|일반소모품비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "일반소모품비", example: "포장재, 시향지, 청소용품, 공용물품", code: "OP-006", vat: "공제", asset: "비자산", pay: "법인카드", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|생카소모품비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "생카소모품비", example: "생카디피물품", code: "OP-007", vat: "공제", asset: "비자산", pay: "법인카드", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|비품구입비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "비품구입비", example: "(50만원 미만)선반, 의자, 장식품", code: "OP-008", vat: "공제", asset: "비자산", pay: "법인카드", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|음향조명유지비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "음향조명유지비", example: "조명, 오디오 유지보수", code: "OP-009", vat: "공제", asset: "비자산", pay: "법인카드", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|보안소독비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "보안소독비", example: "방역, CCTV 유지보수", code: "OP-010", vat: "공제", asset: "비자산", pay: "법인카드", branch: "WOW" },
  { lookupKey: "지출|운영비|와우운영비|홍보물비", txType: "지출", major: "운영비", mid: "와우운영비", minor: "홍보물비", example: "POP, 포스터, 안내판", code: "OP-011", vat: "공제", asset: "비자산", pay: "법인카드", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|임차료", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "임차료", example: "아이디점 월세", code: "OP-012", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|관리비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "관리비", example: "건물관리비, 공용관리비", code: "OP-013", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|전기수도통신비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "전기수도통신비", example: "매장 전기세, 수도요금", code: "OP-014", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|인테리어유지비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "인테리어유지비", example: "가벽, 조명, 인테리어 보수", code: "OP-015", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|매장인건비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "매장인건비", example: "매장근무 알바생 인건비 (본사근무 인원 제외)", code: "OP-016", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|일반소모품비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "일반소모품비", example: "시향지, 청소용품, 공용물품", code: "OP-017", vat: "공제", asset: "비자산", pay: "법인카드", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|생카소모품비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "생카소모품비", example: "생카디피물품", code: "OP-018", vat: "공제", asset: "비자산", pay: "법인카드", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|비품구입비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "비품구입비", example: "(50만원 미만)선반, 의자, 장식품", code: "OP-019", vat: "공제", asset: "비자산", pay: "법인카드", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|음향조명유지비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "음향조명유지비", example: "조명, 오디오 유지보수", code: "OP-020", vat: "공제", asset: "비자산", pay: "법인카드", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|보안소독비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "보안소독비", example: "방역, CCTV 유지보수", code: "OP-021", vat: "공제", asset: "비자산", pay: "법인카드", branch: "ID" },
  { lookupKey: "지출|운영비|아이디운영비|홍보물비", txType: "지출", major: "운영비", mid: "아이디운영비", minor: "홍보물비", example: "POP, 포스터, 안내판", code: "OP-022", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|임차료", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "임차료", example: "홍대점 월세", code: "OP-023", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|관리비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "관리비", example: "건물관리비, 공용관리비", code: "OP-024", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|전기수도통신비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "전기수도통신비", example: "매장 전기세, 수도요금", code: "OP-025", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|인테리어유지비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "인테리어유지비", example: "가벽, 조명, 인테리어 보수", code: "OP-026", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|매장인건비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "매장인건비", example: "매장근무 알바생 인건비 (본사근무 인원 제외)", code: "OP-027", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|일반소모품비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "일반소모품비", example: "매장운영 일반소모품", code: "OP-029", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|생카소모품비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "생카소모품비", example: "생카디피물품", code: "OP-029", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|비품구입비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "비품구입비", example: "(50만원 미만)선반, 의자, 장식품", code: "OP-030", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|음향조명유지비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "음향조명유지비", example: "조명, 오디오 유지보수", code: "OP-031", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|보안소독비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "보안소독비", example: "방역, CCTV 유지보수", code: "OP-032", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|홍보물비", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "홍보물비", example: "POP, 포스터, 안내판", code: "OP-033", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HON" },
  { lookupKey: "지출|운영비|홍대공용운영비|보험료", txType: "지출", major: "운영비", mid: "홍대공용운영비", minor: "보험료", example: "화재보험 등", code: "OP-034", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|임차료", txType: "지출", major: "운영비", mid: "일반운영비", minor: "임차료", example: "사무실 월세", code: "OP-035", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  // 신촌 매장은 2025 하반기에 폐점 — 2024-12~2025 임차료 거래가 물려 있어 은퇴 계정으로 복원한다
  { lookupKey: "지출|운영비|신촌운영비|임차료", txType: "지출", major: "운영비", mid: "신촌운영비", minor: "임차료", example: "신촌점 월세(2025 하반기 폐점 — 과거 거래용)", code: "OP-048", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "SIN", active: false },
  { lookupKey: "지출|운영비|일반운영비|관리비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "관리비", example: "사무실 관리비, 공용비", code: "OP-036", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|전기수도통신비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "전기수도통신비", example: "전기세, 수도세, 인터넷/전화", code: "OP-037", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|비품구입비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "비품구입비", example: "(50만원 미만)의자, 책상, 복합기", code: "OP-038", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|일반소모품비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "일반소모품비", example: "문구류, 프린터잉크, 사무용품", code: "OP-039", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|구독서비스비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "구독서비스비", example: "Google Workspace, Notion, Adobe", code: "OP-040", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|청소비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "청소비", example: "사무실 청소 용역비", code: "OP-041", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|회의비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "회의비", example: "회의 간식, 음료", code: "OP-042", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|운영비|차량관리비|차량유지비", txType: "지출", major: "운영비", mid: "차량관리비", minor: "차량유지비", example: "법인차량 주유, 세차, 통행료, 주차비 등 연성 운영비", code: "OP-043", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|공공요금불공제분", txType: "지출", major: "운영비", mid: "일반운영비", minor: "공공요금불공제분", example: "부가세 불공제 공공요금", code: "OP-044", vat: "불공", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|차량관리비|차량정비비", txType: "지출", major: "운영비", mid: "차량관리비", minor: "차량정비비", example: "오일/필터 교체, 타이어/브레이크 교환, 일반 수리", code: "OP-045", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|택배배송비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "택배배송비", example: "일반택배배송", code: "OP-046", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|일반운영비|운송비", txType: "지출", major: "운영비", mid: "일반운영비", minor: "운송비", example: "퀵,용달화물", code: "OP-047", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|법인세", txType: "지출", major: "세금공과", mid: "국세", minor: "법인세", example: "법인의 순이익에 부과되는 세금(연 1회 신고)", code: "FI-001", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|부가가치세(VAT)", txType: "지출", major: "세금공과", mid: "국세", minor: "부가가치세(VAT)", example: "재화/용역 거래에 붙는 간접세(매출-매입)", code: "FI-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|원천징수소득세(근로)", txType: "지출", major: "세금공과", mid: "국세", minor: "원천징수소득세(근로)", example: "직원 급여 지급 시 원천징수", code: "FI-003", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|원천징수소득세(사업 3.3%)", txType: "지출", major: "세금공과", mid: "국세", minor: "원천징수소득세(사업 3.3%)", example: "프리랜서/사업소득 지급 시 원천징수", code: "FI-004", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|인지세", txType: "지출", major: "세금공과", mid: "국세", minor: "인지세", example: "일정 금액 이상의 계약서 작성 시 부과", code: "FI-005", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|증권거래세", txType: "지출", major: "세금공과", mid: "국세", minor: "증권거래세", example: "주식·지분 매도 시 부과", code: "FI-006", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|교육세(부가세형)", txType: "지출", major: "세금공과", mid: "국세", minor: "교육세(부가세형)", example: "금융·보험 등 특정세목에 부가되는 세금", code: "FI-007", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|국세|농어촌특별세", txType: "지출", major: "세금공과", mid: "국세", minor: "농어촌특별세", example: "감면·면세 혜택에 연동되어 부과", code: "FI-008", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|지방소득세(법인)", txType: "지출", major: "세금공과", mid: "지방세", minor: "지방소득세(법인)", example: "법인세의 10%를 지방에 납부", code: "FI-009", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|재산세", txType: "지출", major: "세금공과", mid: "지방세", minor: "재산세", example: "토지·건물 등 보유 자산에 부과", code: "FI-010", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|자동차세", txType: "지출", major: "세금공과", mid: "지방세", minor: "자동차세", example: "차량 보유자에게 부과(반기)", code: "FI-011", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|취득세", txType: "지출", major: "세금공과", mid: "지방세", minor: "취득세", example: "부동산·차량 등 자산 취득 시 부과", code: "FI-012", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|등록면허세", txType: "지출", major: "세금공과", mid: "지방세", minor: "등록면허세", example: "각종 등기·허가·등록 시 부과", code: "FI-013", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|지방교육세", txType: "지출", major: "세금공과", mid: "지방세", minor: "지방교육세", example: "취득세·자동차세 등에 연동 부과", code: "FI-014", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|지방세|주민세(사업소분)", txType: "지출", major: "세금공과", mid: "지방세", minor: "주민세(사업소분)", example: "법인/개인사업자에게 매년 부과", code: "FI-015", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|수입세|관세", txType: "지출", major: "세금공과", mid: "수입세", minor: "관세", example: "수입품 과세가격에 부과(물품+운송+보험)", code: "FI-016", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|수입세|수입부가세", txType: "지출", major: "세금공과", mid: "수입세", minor: "수입부가세", example: "수입품에도 부가세 부과(관세 포함 금액의 10%)", code: "FI-017", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|수입세|개별소비세(수입)", txType: "지출", major: "세금공과", mid: "수입세", minor: "개별소비세(수입)", example: "사치품·유류·담배 등 특정 품목 수입 시", code: "FI-018", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|수입세|교육세교통에너지환경세", txType: "지출", major: "세금공과", mid: "수입세", minor: "교육세교통에너지환경세", example: "유류·자동차 등 수입 시 연동 부과", code: "FI-019", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|기타세|가산세(가산금)", txType: "지출", major: "세금공과", mid: "기타세", minor: "가산세(가산금)", example: "신고/납부 지연에 대한 벌과금 성격", code: "FI-020", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|기타세|환경개선부담금", txType: "지출", major: "세금공과", mid: "기타세", minor: "환경개선부담금", example: "오염물질 배출 등에 부과되는 부담금", code: "FI-021", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|기타세|주세개별소비세(내수)", txType: "지출", major: "세금공과", mid: "기타세", minor: "주세개별소비세(내수)", example: "주류·향수 등 제조 특정세", code: "FI-022", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|금융비용|금융수수료", txType: "지출", major: "재무비용", mid: "금융비용", minor: "금융수수료", example: "계좌이체/송금 수수료", code: "FI-023", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|금융비용|이자비용", txType: "지출", major: "재무비용", mid: "금융비용", minor: "이자비용", example: "대출 이자, 마이너스통장 이자", code: "FI-024", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|세무기장료", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "세무기장료", example: "세무사 기장 대행료", code: "FI-025", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|회계소프트웨어비", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "회계소프트웨어비", example: "회계 SaaS 구독", code: "FI-026", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|법무비용", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "법무비용", example: "계약 검토, 자문료", code: "FI-027", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|회계감사비", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "회계감사비", example: "외부감사 비용", code: "FI-028", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|세금신고대행료", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "세금신고대행료", example: "부가세/법인세 신고 대행", code: "FI-029", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|납부대행수수료", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "납부대행수수료", example: "전자납부 대행 수수료", code: "FI-030", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|공증비", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "공증비", example: "공증 수수료", code: "FI-031", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|회계법무비|법인등기비", txType: "지출", major: "재무비용", mid: "회계법무비", minor: "법인등기비", example: "등기 변경 수수료", code: "FI-032", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|세금공과|기타세|부가세불공제분", txType: "지출", major: "세금공과", mid: "기타세", minor: "부가세불공제분", example: "불공 V.A.T 비용 처리", code: "FI-033", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|차량관리비|법인차량보험료", txType: "지출", major: "운영비", mid: "차량관리비", minor: "법인차량보험료", example: "종합보험, 자차, 대인/대물 등 금융/장기성 비용", code: "FI-034", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|운영비|차량관리비|법인차량리스료", txType: "지출", major: "운영비", mid: "차량관리비", minor: "법인차량리스료", example: "금융리스/운용리스 월 납부 등 금융/장기성 비용", code: "FI-035", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|감가상각비용|일반감가상각비", txType: "지출", major: "재무비용", mid: "감가상각비용", minor: "일반감가상각비", example: "비품/설비 상각비", code: "FI-036", vat: "해당없음", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|재무비용|감가상각비용|차량감가상각비", txType: "지출", major: "재무비용", mid: "감가상각비용", minor: "차량감가상각비", example: "법인 차량 자산 상각비용", code: "FI-037", vat: "해당없음", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "자금거래|가수금|가수금관리|가수금입금", txType: "자금거래", major: "가수금", mid: "가수금관리", minor: "가수금입금", example: "가수금입금(대표 또는 제3자로부터 자금 유입 시)", code: "FI-038", vat: "불공", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|가수금|가수금관리|가수금지급", txType: "자금거래", major: "가수금", mid: "가수금관리", minor: "가수금지급", example: "가수금지급(반환 혹은 정산 시)", code: "FI-039", vat: "불공", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|보증금|보증금지급|예약금지급", txType: "자금거래", major: "보증금", mid: "보증금지급", minor: "예약금지급", example: "예약금지급", code: "FI-041", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|보증금|보증금지급|거래보증금지급", txType: "자금거래", major: "보증금", mid: "보증금지급", minor: "거래보증금지급", example: "협력업체 거래보증금, 추후 반환예정", code: "FI-043", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|재무비용|금융비용|카드대금결제", txType: "지출", major: "재무비용", mid: "금융비용", minor: "카드대금결제", example: "신한카드/국민카드", code: "FI-042", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|급여|임원급여", txType: "지출", major: "인건비", mid: "급여", minor: "임원급여", example: "대표이사, 등기이사", code: "HR-001", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|급여|직원급여", txType: "지출", major: "인건비", mid: "급여", minor: "직원급여", example: "정규직 월급, 상여 (유선화는 명부상 직원, 매장알바는 운영비)", code: "HR-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|프리랜서비|외주인력", txType: "지출", major: "인건비", mid: "프리랜서비", minor: "외주인력", example: "일일노동자/디자이너/개발자 프리랜서", code: "HR-003", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|사대보험|국민연금", txType: "지출", major: "인건비", mid: "사대보험", minor: "국민연금", example: "국민연금 회사부담분", code: "HR-004", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|사대보험|건강보험", txType: "지출", major: "인건비", mid: "사대보험", minor: "건강보험", example: "건강보험 회사부담분", code: "HR-011", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|사대보험|고용보험", txType: "지출", major: "인건비", mid: "사대보험", minor: "고용보험", example: "고용보험 회사부담분", code: "HR-012", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|사대보험|산재보험", txType: "지출", major: "인건비", mid: "사대보험", minor: "산재보험", example: "산재보험 회사부담분", code: "HR-013", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|복리후생비|일반식대", txType: "지출", major: "인건비", mid: "복리후생비", minor: "일반식대", example: "일반 근무 시 식대", code: "HR-005", vat: "해당없음", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|인건비|복리후생비|회식워크숍비", txType: "지출", major: "인건비", mid: "복리후생비", minor: "회식워크숍비", example: "회식, 워크숍", code: "HR-006", vat: "해당없음", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|인건비|교육훈련비|직무교육세미나", txType: "지출", major: "인건비", mid: "교육훈련비", minor: "직무교육세미나", example: "강의, 컨퍼런스 참가비", code: "HR-007", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|퇴직금|임직원퇴직금적립및지급", txType: "지출", major: "인건비", mid: "퇴직금", minor: "임직원퇴직금적립및지급", example: "연말 정산분 포함", code: "HR-008", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|인센티브|성과급", txType: "지출", major: "인건비", mid: "인센티브", minor: "성과급", example: "영업 성과 보너스", code: "HR-009", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|인건비|인센티브|상여금", txType: "지출", major: "인건비", mid: "인센티브", minor: "상여금", example: "성과 무관 상여 보너스", code: "HR-010", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시설치운영비|전시자재비", txType: "지출", major: "기획·전시비", mid: "전시설치운영비", minor: "전시자재비", example: "벽면 패널, 디스플레이 소품", code: "EX-001", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시설치운영비|부스설치비", txType: "지출", major: "기획·전시비", mid: "전시설치운영비", minor: "부스설치비", example: "시공 인건비, 구조물 설치", code: "EX-002", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시설치운영비|장비렌탈비", txType: "지출", major: "기획·전시비", mid: "전시설치운영비", minor: "장비렌탈비", example: "조명/음향/프로젝터 렌탈", code: "EX-003", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|공간기획연출비|공간임차료", txType: "지출", major: "기획·전시비", mid: "공간기획연출비", minor: "공간임차료", example: "팝업/전시장 대관비", code: "EX-004", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|공간기획연출비|협업비용", txType: "지출", major: "기획·전시비", mid: "공간기획연출비", minor: "협업비용", example: "브랜드/아티스트 콜라보", code: "EX-005", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|공간기획연출비|전시연출비", txType: "지출", major: "기획·전시비", mid: "공간기획연출비", minor: "전시연출비", example: "콘셉트 연출, 디렉션", code: "EX-006", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|디자인홍보비|인테리어비", txType: "지출", major: "기획·전시비", mid: "디자인홍보비", minor: "인테리어비", example: "가벽/페인트/마감", code: "EX-007", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|디자인홍보비|홍보물제작비", txType: "지출", major: "기획·전시비", mid: "디자인홍보비", minor: "홍보물제작비", example: "배너/리플렛/가이드북", code: "EX-008", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|디자인홍보비|포스터디자인비", txType: "지출", major: "기획·전시비", mid: "디자인홍보비", minor: "포스터디자인비", example: "키비주얼/포스터 디자인", code: "EX-009", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시운영기록비|전시홍보비", txType: "지출", major: "기획·전시비", mid: "전시운영기록비", minor: "전시홍보비", example: "언론/SNS 전시 홍보", code: "EX-010", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시운영기록비|전시스태프비", txType: "지출", major: "기획·전시비", mid: "전시운영기록비", minor: "전시스태프비", example: "안내/운영 스태프 인건비", code: "EX-011", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시운영기록비|체험키트비", txType: "지출", major: "기획·전시비", mid: "전시운영기록비", minor: "체험키트비", example: "시향/체험 키트 제작", code: "EX-012", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시운영기록비|사진영상기록비", txType: "지출", major: "기획·전시비", mid: "전시운영기록비", minor: "사진영상기록비", example: "현장 촬영/편집", code: "EX-013", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시운영기록비|행사운영비", txType: "지출", major: "기획·전시비", mid: "전시운영기록비", minor: "행사운영비", example: "티켓, 현장 물품, 소모품", code: "EX-014", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기획·전시비|전시운영기록비|숙소비", txType: "지출", major: "기획·전시비", mid: "전시운영기록비", minor: "숙소비", example: "숙소비", code: "EX-015", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|일반관리비|잡비", txType: "지출", major: "기타비용", mid: "일반관리비", minor: "잡비", example: "분류 곤란 소액 지출", code: "OT-001", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|인건비|복리후생비|비업무식대", txType: "지출", major: "인건비", mid: "복리후생비", minor: "비업무식대", example: "개인 식사 등 비업무성", code: "OT-002", vat: "불공", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|인건비|복리후생비|간식비", txType: "지출", major: "인건비", mid: "복리후생비", minor: "간식비", example: "사무실 간식 구입", code: "OT-003", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|기부후원비|기부금", txType: "지출", major: "기타비용", mid: "기부후원비", minor: "기부금", example: "단체 기부, 후원금", code: "OT-004", vat: "불공", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|개인업무지원비|교통비", txType: "지출", major: "기타비용", mid: "개인업무지원비", minor: "교통비", example: "버스/지하철/KTX", code: "OT-005", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|개인업무지원비|경조사비", txType: "지출", major: "기타비용", mid: "개인업무지원비", minor: "경조사비", example: "축의/부의", code: "OT-006", vat: "불공", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|정산보상비|개인정산비", txType: "지출", major: "기타비용", mid: "정산보상비", minor: "개인정산비", example: "개인 결제분 회사정산", code: "OT-007", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|정산보상비|손해배상비", txType: "지출", major: "기타비용", mid: "정산보상비", minor: "손해배상비", example: "파손/분실 보상", code: "OT-008", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|기타비용|일반관리비|예비비", txType: "지출", major: "기타비용", mid: "일반관리비", minor: "예비비", example: "예상외 지출 대비금", code: "OT-009", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|비품설비투자비|비품구입비", txType: "지출", major: "자산투자비", mid: "비품설비투자비", minor: "비품구입비", example: "(50만원 이상)의자/책상/캐비닛", code: "FA-001", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|비품설비투자비|설비투자비", txType: "지출", major: "자산투자비", mid: "비품설비투자비", minor: "설비투자비", example: "작업 설비 신규 도입", code: "FA-002", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|비품설비투자비|인테리어설치비", txType: "지출", major: "자산투자비", mid: "비품설비투자비", minor: "인테리어설치비", example: "인테리어설치", code: "FA-003", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|비품설비투자비|인테리어철거비", txType: "지출", major: "자산투자비", mid: "비품설비투자비", minor: "인테리어철거비", example: "인테리어철거", code: "FA-004", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|비품설비투자비|보증금입금", txType: "지출", major: "자산투자비", mid: "비품설비투자비", minor: "보증금입금", example: "보증금입금", code: "FA-005", vat: "해당없음", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|비품설비투자비|보증금지급", txType: "지출", major: "자산투자비", mid: "비품설비투자비", minor: "보증금지급", example: "보증금지급", code: "FA-006", vat: "해당없음", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|장비투자비|3D프린터", txType: "지출", major: "자산투자비", mid: "장비투자비", minor: "3D프린터", example: "장비 본체/부품", code: "FA-007", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|장비투자비|조명장비", txType: "지출", major: "자산투자비", mid: "장비투자비", minor: "조명장비", example: "LED 패널/스탠드", code: "FA-008", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|장비투자비|촬영장비", txType: "지출", major: "자산투자비", mid: "장비투자비", minor: "촬영장비", example: "카메라/렌즈/삼각대", code: "FA-009", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|장비투자비|오디오장비", txType: "지출", major: "자산투자비", mid: "장비투자비", minor: "오디오장비", example: "믹서/마이크/스피커", code: "FA-010", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|공간비품투자비|가구구입비", txType: "지출", major: "자산투자비", mid: "공간비품투자비", minor: "가구구입비", example: "카운터, 쇼케이스", code: "FA-011", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|공간비품투자비|인테리어비품", txType: "지출", major: "자산투자비", mid: "공간비품투자비", minor: "인테리어비품", example: "진열대, 소도구", code: "FA-012", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|전자기기투자비|컴퓨터모니터", txType: "지출", major: "자산투자비", mid: "전자기기투자비", minor: "컴퓨터모니터", example: "본체, 모니터, 주변기기", code: "FA-013", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|전자기기투자비|영상재생기기", txType: "지출", major: "자산투자비", mid: "전자기기투자비", minor: "영상재생기기", example: "TV/빔프로젝터/스크린", code: "FA-014", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|장비투자비|향수혼합기기", txType: "지출", major: "자산투자비", mid: "장비투자비", minor: "향수혼합기기", example: "정밀 저울, 혼합기", code: "FA-015", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "지출|자산투자비|차량자산투자비|차량", txType: "지출", major: "자산투자비", mid: "차량자산투자비", minor: "차량", example: "업무용 차량 구입", code: "FA-016", vat: "공제", asset: "자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체출금|운영자금이동", txType: "자금거래", major: "계좌간이동", mid: "이체출금", minor: "운영자금이동", example: "계좌간 운영자금 이체", code: "TR-001", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체출금|급여준비이동", txType: "자금거래", major: "계좌간이동", mid: "이체출금", minor: "급여준비이동", example: "급여 지급 계좌로 이체", code: "TR-002", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체출금|예비비이동", txType: "자금거래", major: "계좌간이동", mid: "이체출금", minor: "예비비이동", example: "예비비 계좌로 이체", code: "TR-003", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체출금|세금준비이동", txType: "자금거래", major: "계좌간이동", mid: "이체출금", minor: "세금준비이동", example: "세금 납부 준비 이체", code: "TR-004", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체출금|일반이체", txType: "자금거래", major: "계좌간이동", mid: "이체출금", minor: "일반이체", example: "일반 계좌간 이체", code: "TR-005", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체입금|운영자금이동", txType: "자금거래", major: "계좌간이동", mid: "이체입금", minor: "운영자금이동", example: "계좌간 운영자금 이체", code: "TR-011", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체입금|급여준비이동", txType: "자금거래", major: "계좌간이동", mid: "이체입금", minor: "급여준비이동", example: "급여 지급 계좌로 이체", code: "TR-012", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체입금|예비비이동", txType: "자금거래", major: "계좌간이동", mid: "이체입금", minor: "예비비이동", example: "예비비 계좌로 이체", code: "TR-013", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체입금|세금준비이동", txType: "자금거래", major: "계좌간이동", mid: "이체입금", minor: "세금준비이동", example: "세금 납부 준비 이체", code: "TR-014", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|계좌간이동|이체입금|일반이체", txType: "자금거래", major: "계좌간이동", mid: "이체입금", minor: "일반이체", example: "일반 계좌간 이체", code: "TR-015", vat: "해당없음", asset: "해당없음", pay: "계좌이체", branch: "" },
  { lookupKey: "수입|인건비|인건비환급(차감)|급여차액환급", txType: "수입", major: "인건비", mid: "인건비환급(차감)", minor: "급여차액환급", example: "과다지급된 급여 차액 회수(인건비 차감)", code: "LB-101", vat: "비과세", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "수입|인건비|인건비환급(차감)|4대보험환급", txType: "수입", major: "인건비", mid: "인건비환급(차감)", minor: "4대보험환급", example: "4대보험료 과오납 환급(인건비 차감)", code: "LB-102", vat: "비과세", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "수입|인건비|인건비환급(차감)|기타인건비환급", txType: "수입", major: "인건비", mid: "인건비환급(차감)", minor: "기타인건비환급", example: "기타 인건비 관련 환급(인건비 차감)", code: "LB-103", vat: "비과세", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "수입|기타수입|지원금|위탁지원금", txType: "수입", major: "기타수입", mid: "지원금", minor: "위탁지원금", example: "위탁운영 사업 지원금 수령", code: "GR-005", vat: "과세", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|영업비|영업활동지원비|위탁수수료", txType: "지출", major: "영업비", mid: "영업활동지원비", minor: "위탁수수료", example: "위탁운영사에 지급하는 수수료", code: "FN-101", vat: "공제", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|예약금환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "예약금환불", example: "", code: "RF-001", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|제품환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "제품환불", example: "", code: "RF-002", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|클래스환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "클래스환불", example: "", code: "RF-003", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|서비스환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "서비스환불", example: "", code: "RF-004", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|보증금환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "보증금환불", example: "", code: "RF-005", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|지원금환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "지원금환불", example: "", code: "RF-006", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "지출|기타지출|환불지출|기타환불", txType: "지출", major: "기타지출", mid: "환불지출", minor: "기타환불", example: "", code: "RF-007", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "수입|기타수입|대행정산|정산입금(부가세포함)", txType: "수입", major: "기타수입", mid: "대행정산", minor: "정산입금(부가세포함)", example: "타업체 정산대행 입금(부가세 포함 전액)", code: "PA-001", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|기타지출|대행정산|정산반환(공급가액)", txType: "지출", major: "기타지출", mid: "대행정산", minor: "정산반환(공급가액)", example: "정산대행 입금분 반환(공급가액)", code: "PA-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|보험환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "보험환급", example: "", code: "RF-001", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|세금환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "세금환급", example: "", code: "RF-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|보증금환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "보증금환급", example: "", code: "RF-003", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|마케팅비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "마케팅비환급", example: "", code: "RF-005", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|영업비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "영업비환급", example: "", code: "RF-006", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|제품개발운영비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "제품개발운영비환급", example: "", code: "RF-007", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|서비스개발비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "서비스개발비환급", example: "", code: "RF-008", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|운영비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "운영비환급", example: "", code: "RF-009", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|재무비용환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "재무비용환급", example: "", code: "RF-010", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|기획전시비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "기획전시비환급", example: "", code: "RF-011", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|기타비용환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "기타비용환급", example: "", code: "RF-012", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|자산투자비환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "자산투자비환급", example: "", code: "RF-013", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급수입|환불수입|세금계산서환급", txType: "환급", major: "환급수입", mid: "환불수입", minor: "세금계산서환급", example: "세금계산서 발행분 입금(부가세 포함)", code: "RF-014", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "환급|환급지출|환불지출|예약금환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "예약금환불", example: "", code: "RF-001", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|제품환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "제품환불", example: "", code: "RF-002", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|클래스환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "클래스환불", example: "", code: "RF-003", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|서비스환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "서비스환불", example: "", code: "RF-004", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|보증금환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "보증금환불", example: "", code: "RF-005", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|지원금환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "지원금환불", example: "", code: "RF-006", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|기타환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "기타환불", example: "", code: "RF-007", vat: "불공", asset: "비자산", pay: "", branch: "" },
  { lookupKey: "환급|환급지출|환불지출|세금계산서환불", txType: "환급", major: "환급지출", mid: "환불지출", minor: "세금계산서환불", example: "세금계산서 입금분 반환(공급가액)", code: "RF-015", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|SMOAT매출|구독결제", txType: "수입", major: "매출", mid: "SMOAT매출", minor: "구독결제", example: "SMOAT 정기 구독 결제 수입", code: "SL-061", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|SMOAT매출|단건결제", txType: "수입", major: "매출", mid: "SMOAT매출", minor: "단건결제", example: "SMOAT 일회성 이용권/크레딧 결제", code: "SL-062", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|SMOAT매출|광고수익", txType: "수입", major: "매출", mid: "SMOAT매출", minor: "광고수익", example: "SMOAT 내 광고 게재 수익", code: "SL-063", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|매출|SMOAT매출|제휴/수수료수익", txType: "수입", major: "매출", mid: "SMOAT매출", minor: "제휴/수수료수익", example: "제휴 및 중개 수수료 수익", code: "SL-064", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|SMOAT운영비|서버인프라비", txType: "지출", major: "서비스개발비", mid: "SMOAT운영비", minor: "서버인프라비", example: "SMOAT 서버 호스팅/클라우드/도메인", code: "SV-021", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|SMOAT운영비|외주개발비", txType: "지출", major: "서비스개발비", mid: "SMOAT운영비", minor: "외주개발비", example: "SMOAT 개발/디자인 외주 용역", code: "SV-022", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|SMOAT운영비|툴구독비", txType: "지출", major: "서비스개발비", mid: "SMOAT운영비", minor: "툴구독비", example: "SMOAT 개발/운영 툴 구독 (Cursor, Vercel 등)", code: "SV-023", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|SMOAT운영비|광고홍보비", txType: "지출", major: "서비스개발비", mid: "SMOAT운영비", minor: "광고홍보비", example: "SMOAT 서비스 광고/마케팅", code: "SV-024", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|SMOAT운영비|결제수수료", txType: "지출", major: "서비스개발비", mid: "SMOAT운영비", minor: "결제수수료", example: "PG/결제모듈 수수료", code: "SV-025", vat: "공제", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|서비스개발비|SMOAT운영비|기타운영비", txType: "지출", major: "서비스개발비", mid: "SMOAT운영비", minor: "기타운영비", example: "SMOAT 기타 운영 지출", code: "SV-026", vat: "공제", asset: "비자산", pay: "미지정", branch: "HQ" },
  { lookupKey: "자금거래|예수금|예수금입금|예약금입금", txType: "자금거래", major: "예수금", mid: "예수금입금", minor: "예약금입금", example: "고객 예약금 수령(부채, 손익 아님)", code: "DP-001", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|예수금|예수금출금|예약금환불", txType: "자금거래", major: "예수금", mid: "예수금출금", minor: "예약금환불", example: "고객 예약금 반환(부채 감소, 손익 아님)", code: "DP-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|예수금|예수금출금|예약금매출전환", txType: "자금거래", major: "예수금", mid: "예수금출금", minor: "예약금매출전환", example: "예약금이 실제 매출로 전환될 때 상계", code: "DP-003", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|대행정산|정산입금|정산입금(부가세포함)", txType: "자금거래", major: "대행정산", mid: "정산입금", minor: "정산입금(부가세포함)", example: "타업체 정산대행 입금(부가세 포함 전액)", code: "PA-001", vat: "과세", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|대행정산|정산반환|정산반환(공급가액)", txType: "자금거래", major: "대행정산", mid: "정산반환", minor: "정산반환(공급가액)", example: "정산대행 입금분 반환(공급가액)", code: "PA-002", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|보증금|보증금지급|임대보증금지급", txType: "자금거래", major: "보증금", mid: "보증금지급", minor: "임대보증금지급", example: "임대차 보증금 지급(자산, 손익 아님)", code: "FA-006", vat: "해당없음", asset: "자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|보증금|보증금회수|임대보증금회수", txType: "자금거래", major: "보증금", mid: "보증금회수", minor: "임대보증금회수", example: "임대차 보증금 반환수령(손익 아님)", code: "CP-021", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "자금거래|보증금|보증금회수|거래보증금회수", txType: "자금거래", major: "보증금", mid: "보증금회수", minor: "거래보증금회수", example: "거래 보증금 반환수령(손익 아님)", code: "CP-022", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "수입|기타수입|환불수입|인건비환급", txType: "수입", major: "기타수입", mid: "환불수입", minor: "인건비환급", example: "인건비 관련 환급(고용지원금·보험료 환급 등) — 과거 입력분 유지용", code: "RF-004", vat: "해당없음", asset: "비자산", pay: "계좌이체", branch: "HQ" },
  { lookupKey: "지출|마케팅비|프로모션이벤트|온라인광고비", txType: "지출", major: "마케팅비", mid: "프로모션이벤트", minor: "온라인광고비", example: "프로모션 연계 온라인 광고 집행비", code: "MK-014", vat: "공제", asset: "비자산", pay: "법인카드", branch: "HQ" },
];

export const FIN_PAYMENT_METHODS: FinPaymentMethodMaster[] = [
  { last4: "7069", alias: "신한지원", site: "네안데르", personal: false, kind: "account", bank: "shinhan" },
  { last4: "4248", alias: "신한입금", site: "네안데르", personal: false, kind: "account", bank: "shinhan" },
  { last4: "4223", alias: "신한출금", site: "네안데르", personal: false, kind: "account", bank: "shinhan" },
  { last4: "8804", alias: "국민", site: "네안데르", personal: false, kind: "account", bank: "kb" },
  { last4: "9279", alias: "우리온라인", site: "네안데르", personal: false, kind: "account", bank: "woori" },
  { last4: "3695", alias: "우리지원", site: "네안데르", personal: false, kind: "account", bank: "woori" },
  { last4: "9719", alias: "우리대출", site: "네안데르", personal: false, kind: "account", monthly: false, bank: "woori" },
  { last4: "3470", alias: "신한신보대출", site: "네안데르", personal: false, kind: "account", monthly: false, bank: "shinhan" },
  { last4: "0429", alias: "토스모임", site: "안다르", personal: false, kind: "account", bank: "toss" },
  { last4: "9999", alias: "사무실지폐", site: "안다르", personal: false, kind: "cash" },
  { last4: "1769", alias: "신한일컴", site: "일해라컴퍼니", personal: false, kind: "account", bank: "shinhan" },
  { last4: "5346", alias: "카카오일컴", site: "일해라컴퍼니", personal: false, kind: "account", bank: "kakao" },
  { last4: "7773", alias: "카카오와작", site: "와작홈즈", personal: false, kind: "account", bank: "kakao" },
  { last4: "2171", alias: "(신법)이동주", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "2392", alias: "(신법)유재영하이", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "4306", alias: "(신법)유재영", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "1804", alias: "(신법)이동주", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "6379", alias: "(신법)김주희", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "3847", alias: "(신법)유선화", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "7753", alias: "(신법)김주연", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "4528", alias: "(신법)유재영-신", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "3513", alias: "(신법)김주연-신", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "2842", alias: "(신법)유다혜", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
  { last4: "0815", alias: "(국법)이동주", site: "네안데르", personal: false, kind: "card", bank: "kb-card" },
  { last4: "7889", alias: "(국법)유재영", site: "네안데르", personal: false, kind: "card", bank: "kb-card" },
  { last4: "9806", alias: "(국법)유선화", site: "네안데르", personal: false, kind: "card", bank: "kb-card" },
  { last4: "3800", alias: "(국법)식대", site: "네안데르", personal: false, kind: "card", bank: "kb-card" },
  // 2026-08 에 생긴 카드. 2608 장부 「계좌카드목록」 34행에 있다.
  { last4: "2639", alias: "(신법)이동주하이", site: "네안데르", personal: false, kind: "card", bank: "shinhan-card" },
];

export const FIN_VENDOR_RULES: FinVendorRuleMaster[] = [
  { service: "Anthropic (Claude)", keyword: "ANTHROPIC" },
  { service: "OpenRouter", keyword: "OPENROUTER" },
  { service: "OpenAI (ChatGPT)", keyword: "OPENAI" },
  { service: "Google Cloud", keyword: "구글클라우드" },
  { service: "Vercel", keyword: "VERCEL" },
  { service: "Supabase", keyword: "SUPABASE" },
  { service: "Higgsfield", keyword: "HIGGSFIELD" },
  { service: "fal.ai", keyword: "FAL FEATURES" },
  { service: "Canva", keyword: "CANVA" },
  { service: "Envato", keyword: "ENVATO" },
  { service: "카페24", keyword: "카페24" },
  { service: "미리디(미리캔버스)", keyword: "미리디" },
  { service: "베러웨이시스템즈", keyword: "베러웨이" },
  { service: "Adyen", keyword: "Adyen" },
  { service: "유튜브(이동주)", keyword: "이동주" },
  { service: "OpenRouter 대납(김제연)", keyword: "김제연" },
];

/** 통합_LISTS 의 드롭다운 목록 — 계정대분류별 중분류 후보 등 */
export const FIN_LISTS: Record<string, string[]> = {
  "거래유형": ["수입", "지출"],
  "수입_상위": ["매출", "기타수입", "투자·자본", "투자·자본"],
  "TopList": ["마케팅비", "영업비", "제품개발운영비", "서비스개발비", "운영비", "재무비용", "인건비", "기획·전시비", "기타비용", "자산투자비", "세금공과"],
  "마케팅비": ["디지털광고", "콘텐츠제작", "프로모션이벤트", "인플루언서리뷰", "리서치홍보", "SNS채널운영", "샘플체험물"],
  "영업비": ["대외관계거래관리비", "영업자료제작비", "영업활동지원비", "외주협업프로모션비", "행사네트워킹비"],
  "제품개발운영비": ["RND", "공통원자재", "생카원자재"],
  "서비스개발비": ["개발디자인비", "서버인프라비용", "외부연동API비", "툴보안유지비", "운영유지보수비", "웹사이트관리비", "SMOAT운영비"],
  "운영비": ["와우운영비", "아이디운영비", "홍대공용운영비", "일반운영비", "신촌운영비", "차량관리비"],
  "재무비용": ["금융비용", "회계법무비", "감가상각비용"],
  "인건비": ["급여", "프리랜서비", "4대보험", "복리후생비", "교육훈련비", "퇴직금", "인센티브"],
  "기획·전시비": ["전시설치운영비", "공간기획연출비", "디자인홍보비", "전시운영기록비"],
  "기타비용": ["일반관리비", "복리후생비", "기부후원비", "개인업무지원비", "정산보상비"],
  "자산투자비": ["비품설비투자비", "장비투자비", "공간비품투자비", "전자기기투자비", "차량자산투자비"],
  "세금공과": ["국세", "지방세", "수입세", "기타세"],
};
