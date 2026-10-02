// ============================================================
//  자동분류 엔진
// ------------------------------------------------------------
//  임포트된 거래에 계정·사업구분을 자동으로 붙인다. 근거를 순서대로
//  시도하고, 어느 것도 못 맞히면 사람에게 넘긴다.
//
//    0) 분류 규칙   사람이 정해 둔 「이 거래처는 이 계정」 (class-rules.ts).
//                   **이력보다 먼저** 본다 — 이력이 갈리거나 아직 없어서 사람이
//                   직접 말해 둔 것이기 때문이다. 재무 비서에게 말해서 만든다.
//    1) 과거 이력   확정된 장부가 곧 학습 자료다. 네 가지 열쇠로 찾는다 —
//         ① 같은 거래처 · 같은 계좌   가장 강하다. **확정은 이것만** 만든다
//         ② 같은 거래처 · 다른 계좌    제안
//         ③ 이름 뼈대 (날짜·일련번호를 걷어낸 이름) · 같은 계좌   제안
//              `2608고용보험` ↔ `2607고용보험`, `FACEBK *KEV69QZM62` ↔ `FACEBK *7WB84M9N62`
//         ④ 이름 뼈대 · 다른 계좌     제안
//       그리고 같은 거래처가 여러 계정으로 갈릴 때는 **같은 금액**을 본다
//       (자동이체 14,900원은 급여가 아니라 구독료다).
//    1′) 카드 메모  결제한 사람이 단톡방에 남긴 「구매처 / 품목」 (card-chat.ts).
//                   명세서의 거래처가 결제대행사(`KCP_1`)라 이름으로는 알 수 없는
//                   결제를 맞힌다. **제안까지만** — 메모는 금액과 날짜로 붙인 것이라
//                   다른 결제에 잘못 붙어 있을 수 있다.
//                   (2026-03~08 메모가 붙은 423건: 메모가 계정을 정한 96건 중 93% 가 맞았다.
//                    같은 건들의 거래처 이력 제안은 59% 였다)
//    2) 구독 규칙   거래처명에 등록된 키워드가 포함되면 그 규칙을 쓴다.
//                   (ANTHROPIC → Anthropic (Claude) 등)
//    3) 어댑터 힌트 은행·카드 엑셀이 알려주는 것 (이자입금, 카드대금결제,
//                   카드 업종 등). 확실한 것만 오므로 suggested 로 둔다.
//    3′) 업종      처음 보는 가맹점인데 무슨 가게인지는 이름이 말해 준다 (음식점 · 카페 ·
//                   주유소). 업종은 모델이 이름을 보고 붙이고(vendor-kind.ts), 여기서는
//                   그 업종의 다른 가맹점들이 어떻게 분류돼 왔는지만 본다. 제안까지만.
//    4) 계좌 기본값 처음 보는 거래처라도 **그 계좌에 들어온(나간) 돈이 늘
//                   무엇이었는지**는 안다 (우리온라인 통장 입금은 온라인판매).
//                   한 가지 일만 하는 계좌에서만 쓴다.
//
//  ── 왜 이렇게 생겼나 (2026-10 백테스트) ──
//  2026-03~08 여섯 달 2,802건을 「그 달 이전 장부만 보고」 맞혀 봤다
//  (npm run finance:verify-classify).
//
//                        예전(거래처 이름만)   지금
//    자동 확정            50.6%               45.0%
//      그중 틀린 확정      42건 (3.0%)         18건 (1.4%)
//    제안                 23.7%               33.2%
//      제안의 적중률       46.7%               78.2%
//    판단 불가            25.7%               21.8%
//
//  자동 확정이 줄어든 것은 일부러다 — 틀린 확정을 절반 넘게 걷어낸 값이다.
//  남은 18건은 사람이 그 달에 분류를 바꾼 것이라(와우판매 ↔ 아이디판매,
//  결제대행사 뒤의 품목이 달라진 경우) 이력으로는 알 수 없다.
//
//  · **계좌를 같이 본다.** 같은 「유재영」 이라도 급여 통장에서 나가면 급여,
//    모임 통장에서 나가면 대납 정산이다. 이름만 보면 31% 짜리 제안이 된다.
//  · **들어온 돈과 나간 돈을 따로 센다.** 직원 이름으로 들어온 돈에 급여
//    계정을 붙이려다 「검토필요」 로 떨어지던 것이 사라진다.
//  · **최근 12건만 본다.** 계정 체계도 매장도 바뀐다 (2026-08 분류 개편,
//    신촌 폐점). 3년 전 분류가 지금 분류를 이기면 안 된다.
//  · **한 달에 몰린 3~4건은 믿지 않는다.** 행사 준비로 며칠 사이 같은 곳에서
//    여러 번 산 것은 「늘 그렇다」 가 아니다 — 실측 적중률 72%.
//  · **절반도 못 맞히는 근거는 제안하지 않는다.** 27% 짜리 제안은 맞는
//    것보다 틀리는 것이 많다. 후보만 사유에 적고 사람에게 넘긴다.
//
//  ⚠️ 자동분류는 절대 최종 확정을 남발하지 않는다. 확신이 충분할 때만
//     confirmed 로 두고, 나머지는 suggested / needs_review 로 남겨
//     검토 대기함에서 사람이 승인하게 한다. 재무 데이터에서 조용히
//     틀린 분류가 쌓이는 것이 가장 나쁘다.
// ============================================================

import type { FinTransaction, ClassificationStatus, TxType } from "./types";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "./db-types";
import {
  describeRuleResult,
  matchClassRule,
  ruleConfirms,
  type FinClassRuleDoc,
} from "./class-rules";
import { memoParts } from "./card-chat";
import { isUsefulKind } from "./vendor-kind";

/** 이력에서 「최근」 으로 보는 건수 — 오래된 분류보다 최근 분류를 따른다 */
const RECENT = 12;
/** 확정으로 볼 최소 건수 · 최소 일치 비율 (같은 거래처 · 같은 계좌) */
const MIN_HISTORY_COUNT = 5;
const MIN_HISTORY_RATIO = 0.95;
/** 건수가 적어도 **두 달 이상에 걸쳐** 한 번도 안 갈렸으면 확정으로 본다 */
const MIN_STEADY_COUNT = 3;
/** 확정하려면 사업구분도 이만큼 한결같아야 한다 */
const MIN_BIZ_RATIO = 0.95;
/**
 * 제안으로 올릴 최소 일치 비율 — 이보다 낮으면 맞는 것보다 틀리는 것이 많다.
 *
 * 다른 계좌의 이력은 훨씬 엄하게 본다. 같은 이름이 계좌마다 다른 일을 하기
 * 때문이다 — 「다른 계좌까지 합쳐 50~79%」 인 제안은 실측 적중률이 18% 였다
 * (직원 이름이 급여 통장에서는 급여, 다른 통장에서는 정산·환급).
 */
const MIN_SUGGEST_RATIO = 0.5;
const MIN_SUGGEST_RATIO_ELSEWHERE = 0.8;
/**
 * 다른 계좌의 이력은 건수도 본다. 한두 건은 **동명이인**일 수 있다 — 다른
 * 통장에 한 번 입금한 「이정현」 과 이번 「이정현」 이 같은 사람이라는 보장이
 * 없다 (1~2건짜리 실측 적중률 53~63%, 3건 이상이면 92%).
 */
const MIN_ELSEWHERE_COUNT = 3;
/** 같은 금액을 근거로 삼을 최소 건수 (모두 같은 분류여야 한다) */
const MIN_SAME_AMOUNT = 2;
/**
 * 계좌 기본값 — 최근 몇 건을 보고, 몇 건 이상 · 얼마나 쏠려야 쓰는가.
 *
 * 한 가지 일만 하는 계좌에서만 통한다 (우리온라인 입금 → 온라인판매 48/48).
 * 여러 용도가 섞인 계좌는 80% 가 쏠려 있어도 열에 넷은 틀린다 — 신한입금의
 * 처음 보는 입금자를 「와우판매」 로 제안했더니 17건이 전부 틀렸다. 그래서
 * 문턱이 높다.
 */
const PRIOR_RECENT = 60;
const PRIOR_MIN_COUNT = 8;
const PRIOR_MIN_RATIO = 0.9;

/**
 * 카드 메모 근거 — 몇 건 이상 · 얼마나 쏠려야 · 몇 달에 걸쳐 나와야 쓰는가.
 *
 * 품목 낱말은 **여러 달에 걸쳐 나온 것만** 쓴다. 한두 달만 나오는 낱말은 대개
 * 그 달 생일카페의 아이돌 이름이고, 그 이름이 가리키던 분류는 다음 달에 맞지 않는다.
 *
 * 구매처 없이 **낱말만으로는 보지 않는다.** 재 보니 7건 중 3건만 맞았다 — 여러 달
 * 나오는 아이돌 이름(`아이유`)과 낱말 조각(`스포이드` 의 `이드`)이 걸린다.
 * 구매처가 붙으면 96건 중 89건(93%)이 맞는다.
 */
const MEMO_MIN_COUNT = 4;
const MEMO_MIN_RATIO = 0.9;
const MEMO_MIN_MONTHS = 3;
const MEMO_STORE_MIN_MONTHS = 2;
/** 프로젝트가 말해 주는 사업구분 — 그 프로젝트의 확정 거래가 이만큼 한결같을 때 */
const PROJECT_MIN_COUNT = 3;
const PROJECT_MIN_RATIO = 0.9;
/**
 * 업종 — 처음 보는 가맹점이라도 **무슨 가게인지**는 이름이 말해 준다 (`카페엔젤` ·
 * `연길반점` · `시화주유소`). 그 판단은 사람의 상식이라 모델에게 맡기고(vendor-kind.ts),
 * 여기서는 「그 업종의 다른 가맹점들이 어떻게 분류돼 왔나」 만 본다.
 *
 * 거래 건수가 아니라 **가맹점 수**로 센다 — 한 식당을 백 번 간 것은 「음식점은 늘
 * 식대다」 의 근거가 아니다.
 *
 * (2026-03~09, 처음 보는 카드 가맹점 190건: 100건에 제안이 붙고 89% 가 맞았다.
 *  틀린 것은 회식 · 영업미팅처럼 같은 식당이라도 **자리의 성격**이 다른 경우다.
 *  이름의 낱말을 직접 세는 방식은 26~36건 · 81~88% 였다 — 식당 이름에는 공통
 *  낱말이 없다. 카드 · 시간대 · 금액으로 식대를 짐작하는 것은 59% 가 한계였다)
 */
const KIND_MIN_VENDORS = 5;
const KIND_MIN_RATIO = 0.8;
/** 같은 카드 · 같은 계정의 사업구분을 쓸 최소 건수 · 일치 비율 */
const CARD_BIZ_MIN_COUNT = 3;
const CARD_BIZ_MIN_RATIO = 0.9;

export const normVendor = (s?: string) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** 분류 결과 — 거래에 덮어쓸 필드들 */
export interface ClassifySuggestion {
  status: ClassificationStatus;
  /**
   * 거래유형 교정. 은행 엑셀은 입출금 **방향**만 알고 성격은 모른다.
   * 이력이 준 계정이 자금거래·카드대금결제 계열이면 유형도 그것이어야
   * 한다 — 안 그러면 `지출 + 계좌간이동` 같은 모순이 생기고, 리포트에서
   * 비손익 거래가 손익으로 잡힌다.
   */
  txType?: TxType;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  bizMajor?: string;
  bizMinor?: string;
  site?: string;
  classReason: string;
}

/**
 * 이름 뼈대 — 날짜·일련번호를 걷어낸 거래처 이름 (normVendor 를 거친 값에 쓴다).
 *
 *   `2608고용보험` → `#고용보험`        달마다 앞머리가 바뀐다
 *   `삼성화09027`  → `삼성화#`          증권번호가 붙는다
 *   `facebk *kev69qzm62` → `facebk *`  결제마다 코드가 바뀐다
 */
export const vendorFamily = (v: string) =>
  v
    .replace(/\*\s*\S+$/, "*")
    .replace(/\d{2,}/g, "#")
    .replace(/\s+/g, " ")
    .trim();

/** 들어온 돈 · 나간 돈 — 은행 엑셀이 확실히 아는 것은 이것뿐이다 */
type Flow = "in" | "out";

function flowOfInput(txType: TxType): Flow {
  return txType === "수입" || txType === "환급" ? "in" : "out";
}

function flowOfHistory(t: FinTransaction): Flow {
  if (t.txType === "수입" || t.txType === "환급") return "in";
  if (t.txType === "지출" || t.txType === "카드대금결제") return "out";
  // 자금거래는 유형에 방향이 없다 — 계정 이름이 말한다 (이체입금 · 가수금입금 · 보증금회수)
  return /입금|회수|수령/.test(`${t.acctMid ?? ""} ${t.acctMinor ?? ""}`) ? "in" : "out";
}

/** 이력 한 건 — 색인에 담는 최소 정보 */
interface Seen {
  vendor: string;
  txType: TxType;
  acctMajor: string;
  acctMid: string;
  acctMinor: string;
  bizMajor: string;
  bizMinor: string;
  /** `YYYY-MM` */
  month: string;
  /** 순금액 */
  amount: number;
}

/** 찾는 열쇠의 종류 — 위에서부터 구체적이다 */
type KeyKind =
  /** 같은 거래처 · 같은 계좌 */
  | "va"
  /** 같은 거래처 (계좌 무관) */
  | "v"
  /** 이름 뼈대 · 같은 계좌 */
  | "fa"
  /** 이름 뼈대 (계좌 무관) */
  | "f"
  /** 계좌만 */
  | "a";

const keyOf = (kind: KeyKind, name: string, last4: string, flow: Flow) =>
  kind === "va" || kind === "fa"
    ? `${kind}|${name}|${last4}|${flow}`
    : kind === "a"
      ? `a|${last4}|${flow}`
      : `${kind}|${name}|${flow}`;

/** 카드 메모 열쇠 — 구매처+낱말 · 구매처 */
type MemoKind = "msw" | "ms";
const memoKey = (kind: MemoKind, store: string, word: string, flow: Flow) => `${kind}|${store}|${word}|${flow}`;

/** 프로젝트 열쇠 — 그 프로젝트로 묶인 거래들 */
const projectKey = (code: string, flow: Flow) => `pj|${code.trim().toLowerCase()}|${flow}`;

/**
 * 확정된 과거 거래의 색인. 열쇠마다 그 열쇠로 본 분류를 **오래된 것부터**
 * 담는다 — 최근 N건을 잘라 보기 위해서다.
 */
export interface VendorIndex {
  seen: Map<string, Seen[]>;
  /**
   * 업종 → 그 업종의 가맹점들 (가맹점마다 **가장 최근 분류 하나**). 나간 돈만 담는다.
   */
  kinds: Map<string, Seen[]>;
}

/** 같은 카드 · 같은 계정으로 쓴 거래들 — 사업구분을 고를 때 본다 */
const cardClassKey = (last4: string, s: Pick<Seen, "txType" | "acctMajor" | "acctMid" | "acctMinor">) =>
  `cb|${last4}|${s.txType}|${s.acctMajor}|${s.acctMid}|${s.acctMinor}`;

/**
 * 확정된 과거 거래로 색인을 만든다.
 * 임포트 1건마다 전체 이력을 훑지 않도록 미리 한 번만 계산한다.
 */
export function buildVendorIndex(history: FinTransaction[]): VendorIndex {
  const seen = new Map<string, Seen[]>();
  const push = (key: string, s: Seen) => {
    const list = seen.get(key);
    if (list) list.push(s);
    else seen.set(key, [s]);
  };
  // 업종 → 가맹점 → 가장 최근 분류 (오래된 것부터 훑으므로 나중 것이 덮는다)
  const byKind = new Map<string, Map<string, Seen>>();

  history
    .filter((t) => t.status === "confirmed" && !!t.acctMinor)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((t) => {
      const v = normVendor(t.vendor);
      const last4 = t.last4 ?? "";
      const flow = flowOfHistory(t);
      const s: Seen = {
        vendor: t.vendor ?? "",
        txType: t.txType,
        acctMajor: t.acctMajor ?? "",
        acctMid: t.acctMid ?? "",
        acctMinor: t.acctMinor ?? "",
        bizMajor: t.bizMajor ?? "",
        bizMinor: t.bizMinor ?? "",
        month: (t.date ?? "").slice(0, 7),
        amount: (t.gross ?? 0) - (t.adjust ?? 0),
      };
      if (v) {
        const f = vendorFamily(v);
        push(keyOf("va", v, last4, flow), s);
        push(keyOf("v", v, last4, flow), s);
        push(keyOf("fa", f, last4, flow), s);
        push(keyOf("f", f, last4, flow), s);
      }
      if (last4) push(keyOf("a", "", last4, flow), s);
      if (last4) push(cardClassKey(last4, s), s);
      if (v && flow === "out" && isUsefulKind(t.vendorKind)) {
        const vendors = byKind.get(t.vendorKind);
        if (vendors) vendors.set(v, s);
        else byKind.set(t.vendorKind, new Map([[v, s]]));
      }
      if (t.projectCode) push(projectKey(t.projectCode, flow), s);
      const memo = memoParts(t.cardMemo);
      if (memo) {
        push(memoKey("ms", memo.store, "", flow), s);
        memo.words.forEach((w) => push(memoKey("msw", memo.store, w, flow), s));
      }
    });

  const kinds = new Map<string, Seen[]>();
  byKind.forEach((vendors, k) => kinds.set(k, [...vendors.values()]));

  return { seen, kinds };
}

/** 한 열쇠로 본 최근 이력의 요약 */
interface KeyStat {
  kind: KeyKind;
  /** 본 건수 (최근 RECENT 건 이내) */
  n: number;
  /** 가장 많이 쓰인 분류 */
  top: Seen;
  count: number;
  ratio: number;
  /** 그 분류가 걸쳐 있는 달 수 */
  months: number;
  /** 그 분류 안에서 가장 많이 쓰인 사업구분과 그 비율 */
  biz: { major: string; minor: string; ratio: number };
  /** 분류별 건수 (많은 것부터) — 갈릴 때 사유에 적는다 */
  spread: { label: string; count: number; rows: Seen[] }[];
}

const classKey = (s: Seen) => `${s.txType}|${s.acctMajor}|${s.acctMid}|${s.acctMinor}`;

function statOf(list: Seen[] | undefined, kind: KeyKind, recent: number): KeyStat | null {
  if (!list || list.length === 0) return null;
  const rows = list.slice(-recent);
  const groups = new Map<string, Seen[]>();
  rows.forEach((s) => {
    const k = classKey(s);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  });
  // 건수가 같으면 더 최근에 쓰인 분류를 고른다 (rows 는 오래된 것부터)
  const ranked = [...groups.values()].sort(
    (a, b) => b.length - a.length || rows.lastIndexOf(b[b.length - 1]) - rows.lastIndexOf(a[a.length - 1]),
  );
  const best = ranked[0];
  const bizCount = new Map<string, number>();
  best.forEach((s) => {
    const k = `${s.bizMajor}|${s.bizMinor}`;
    bizCount.set(k, (bizCount.get(k) ?? 0) + 1);
  });
  const [bizKey, bizN] = [...bizCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const [bizMajor, bizMinor] = bizKey.split("|");
  return {
    kind,
    n: rows.length,
    top: best[best.length - 1],
    count: best.length,
    ratio: best.length / rows.length,
    months: new Set(best.map((s) => s.month)).size,
    biz: { major: bizMajor, minor: bizMinor, ratio: bizN / best.length },
    spread: ranked.map((g) => ({ label: g[0].acctMinor || g[0].txType, count: g.length, rows: g })),
  };
}

/** 카드 메모가 가리킨 분류 */
interface MemoHit {
  kind: MemoKind;
  store: string;
  word: string;
  /** 본 건수 (최근 RECENT 건 이내) */
  n: number;
  ratio: number;
  /** 가장 많이 쓰인 분류의 가장 최근 거래 */
  top: Seen;
}

/** 앞자리부터 견줘 a 가 앞서는가 */
const outranks = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

const bizKey = (s: Seen) => (s.bizMinor ? `${s.bizMajor}|${s.bizMinor}` : "");

/**
 * 메모로 찾은 가장 믿을 만한 근거. 구매처+낱말이 구매처만보다 구체적이고,
 * 같은 급이면 더 쏠린 쪽 · 더 긴 낱말 · 더 많이 본 쪽이다.
 *
 * `classOf` 가 무엇을 맞히는지 정한다 (계정 · 사업구분). 빈 값을 돌려주는
 * 이력은 세지 않는다 — 사업구분이 비어 있던 거래가 「미정」 한 표가 되면 안 된다.
 */
function memoEvidence(
  seen: Map<string, Seen[]>,
  memo: { store: string; words: string[] },
  flow: Flow,
  classOf: (s: Seen) => string,
): MemoHit | null {
  let best: { hit: MemoHit; rank: number[] } | null = null;
  const look = (kind: MemoKind, word: string, tier: number, minCount: number, minMonths: number) => {
    const all = seen.get(memoKey(kind, memo.store, word, flow));
    if (!all || all.length < minCount) return;
    const list = all.filter((s) => classOf(s) !== "");
    if (list.length < minCount || new Set(list.map((s) => s.month)).size < minMonths) return;
    const rows = list.slice(-RECENT);
    const count = new Map<string, number>();
    rows.forEach((s) => count.set(classOf(s), (count.get(classOf(s)) ?? 0) + 1));
    const [topClass, topN] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    const ratio = topN / rows.length;
    if (ratio < MEMO_MIN_RATIO) return;
    const rank = [tier, ratio, word.length, rows.length];
    if (best && !outranks(rank, best.rank)) return;
    const top = [...rows].reverse().find((s) => classOf(s) === topClass)!;
    best = { rank, hit: { kind, store: memo.store, word, n: rows.length, ratio, top } };
  };
  memo.words.forEach((w) => look("msw", w, 2, MEMO_MIN_COUNT, MEMO_MIN_MONTHS));
  look("ms", "", 1, MEMO_MIN_COUNT, MEMO_STORE_MIN_MONTHS);
  return (best as { hit: MemoHit } | null)?.hit ?? null;
}

/** 메모 근거를 사람이 읽는 말로 — `「배너공장 · 배너」` */
const memoLabel = (h: MemoHit) => (h.kind === "msw" ? `「${h.store} · ${h.word}」` : `「${h.store}」`);

/** 자동분류에 필요한 참조 데이터 묶음 */
export interface ClassifyContext {
  vendorIndex: VendorIndex;
  vendorRules: FinVendorRuleDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  /**
   * 계정 마스터. 제안한 계정의 거래유형이 실제 거래유형과 맞는지 검증한다.
   * 없으면 검증을 건너뛴다(예전 호출부 호환).
   */
  accounts?: FinAccountDoc[];
  /** 사람이 정한 분류 규칙 (class-rules.ts). 없으면 이력부터 본다 */
  classRules?: FinClassRuleDoc[];
}

/** 계정 3단으로 마스터를 찾아 그 계정의 거래유형을 돌려준다 */
function accountTxType(
  accounts: FinAccountDoc[] | undefined,
  major?: string,
  mid?: string,
  minor?: string,
): TxType | undefined {
  if (!accounts?.length || !major || !minor) return undefined;
  const hit = accounts.find(
    (a) => a.major === major && (!mid || a.mid === mid) && a.minor === minor,
  );
  return hit ? (hit.txType as TxType) : undefined;
}

/**
 * 계정의 거래유형과 실제 거래유형이 **의도적으로** 다른 조합.
 *
 * 카드대금결제 계정은 `지출 > 재무비용 > 금융비용 > 카드대금결제` 로
 * 등록돼 있다 — 재무비용 밑에 있으니 계정 자체는 지출이다. 하지만 거래유형은
 * 별도의 `카드대금결제` 다(손익에서 빼기 위해). 기존 장부의 확립된 관행이라
 * 불일치로 보면 안 된다.
 *
 * 키는 `거래유형|계정소분류`.
 */
const ALLOWED_MISMATCH = new Set(["카드대금결제|카드대금결제"]);

/**
 * 거래유형과 계정의 거래유형이 달라도 **정상**인가.
 *
 * `acctTxType` 을 주면 규칙 하나가 더 걸린다 — **환급은 지출 계정을 쓴다.**
 * 환급은 "쓴 돈을 되돌려받은 것"이라 되돌린 대상 계정(=지출 계정)을
 * 가리켜야 순손익 계산 `수입 − (지출 − 환급)` 이 맞는다. 전용 환급 계정을
 * 따로 두면 어느 비용이 줄었는지 알 수 없다.
 *
 * 이걸 빠뜨려서 장부의 환급 4건이 전부 「검토필요」로 떨어져 있었다.
 * 규칙이 맞다고 우기는 대신 실제 장부를 보고 찾았다 (7월 143,700원).
 */
export const isAllowedTxAccountMismatch = (
  txType: string,
  acctMinor?: string,
  acctTxType?: string,
) => {
  if (ALLOWED_MISMATCH.has(`${txType}|${acctMinor ?? ""}`)) return true;
  return txType === "환급" && acctTxType === "지출";
};

/** 분류 대상 — 임포트 직후의 최소 정보 */
export interface ClassifyInput {
  vendor?: string;
  last4?: string;
  txType: TxType;
  /** 엑셀에 이미 분류가 들어있으면 그대로 존중한다 */
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  bizMajor?: string;
  bizMinor?: string;
  site?: string;
  /** 원금액 · 조정금액 — 같은 거래처가 여러 계정으로 갈릴 때 같은 금액을 찾는다 */
  gross?: number;
  adjust?: number;
  /** 단톡방 카드 기록에서 붙은 한 줄 — `구매처 / 품목` (card-chat.ts) */
  cardMemo?: string;
  /** 이 거래가 묶인 프로젝트 — 사업구분의 근거가 된다 (JIMFF 는 조향) */
  projectCode?: string;
  /** 가맹점의 업종 (음식점 · 카페 · 주유소 …) — 모델이 이름을 보고 붙인다 (vendor-kind.ts) */
  vendorKind?: string;
  /**
   * 임포트 어댑터의 추정 (확정 아님). 은행·카드 엑셀이 알려주는 것들 —
   * 「이자입금」적요, 카드대금 판정, 카드 업종명 같은 것. 과거 이력·구독
   * 규칙이 없을 때 마지막 후보로 쓰고 `suggested` 로 남긴다.
   */
  hint?: {
    acctMajor?: string;
    acctMid?: string;
    acctMinor?: string;
    bizMajor?: string;
    bizMinor?: string;
    reason: string;
  };
}

export function classifyOne(input: ClassifyInput, ctx: ClassifyContext): ClassifySuggestion {
  const sug = classifyByEvidence(input, ctx);

  // 사업구분은 거래처보다 **무엇을 샀는가**가 말해 준다 — 같은 쿠팡이라도 향료 원료는
  // 조향, 매장 비품은 와우다. 엔진이 확정하지 못한 건에 메모가 사업구분을 알면 그것을 쓴다.
  // (확정은 건드리지 않는다. 원본 장부가 적어 둔 사업구분도 그대로 둔다)
  if (sug.status === "confirmed" || input.bizMajor || input.bizMinor) return sug;
  if (input.txType === "자금거래" || input.txType === "카드대금결제") return sug;
  const seen = ctx.vendorIndex.seen;
  const flow = flowOfInput(input.txType);

  // 프로젝트에 묶인 지출은 그 프로젝트의 사업부 것이다 — 무엇을 어디서 샀든.
  // (JIMFF 엽서를 애즈랜드에서 샀다고 생카 소모품이 되지 않는다)
  if (input.projectCode) {
    const rows = (seen.get(projectKey(input.projectCode, flow)) ?? []).filter((s) => bizKey(s) !== "").slice(-RECENT);
    const count = new Map<string, number>();
    rows.forEach((s) => count.set(bizKey(s), (count.get(bizKey(s)) ?? 0) + 1));
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || rows.length < PROJECT_MIN_COUNT || top[1] / rows.length < PROJECT_MIN_RATIO) return sug;
    const [bizMajor, bizMinor] = top[0].split("|");
    if (sug.bizMajor === bizMajor && sug.bizMinor === bizMinor) return sug;
    return {
      ...sug,
      bizMajor,
      bizMinor,
      classReason: `${sug.classReason} · 사업구분은 프로젝트 「${input.projectCode}」 의 최근 ${rows.length}건 중 ${Math.round((top[1] / rows.length) * 100)}% 가 ${bizMinor}`,
    };
  }

  const memo = memoParts(input.cardMemo);
  const hit = memo ? memoEvidence(seen, memo, flow, bizKey) : null;
  if (!hit || (sug.bizMajor === hit.top.bizMajor && sug.bizMinor === hit.top.bizMinor)) return sug;
  return {
    ...sug,
    bizMajor: hit.top.bizMajor,
    bizMinor: hit.top.bizMinor,
    classReason:
      sug.classReason +
      // 계정과 같은 메모에서 나온 근거면 되풀이하지 않는다 — 검토할 때 가장 많이 읽는 줄이다
      (sug.classReason.startsWith(`카드 메모 ${memoLabel(hit)} `)
        ? ` · 사업구분도 같은 메모에서 ${Math.round(hit.ratio * 100)}% 가 ${hit.top.bizMinor}`
        : ` · 사업구분은 카드 메모 ${memoLabel(hit)} 최근 ${hit.n}건 중 ${Math.round(hit.ratio * 100)}% 가 ${hit.top.bizMinor}`),
  };
}

/** 근거를 순서대로 시도한다 (파일 머리 주석) */
function classifyByEvidence(input: ClassifyInput, ctx: ClassifyContext): ClassifySuggestion {
  const pm = input.last4
    ? ctx.paymentMethods.find((p) => p.last4 === input.last4)
    : undefined;
  // 사업장은 계좌 마스터 기본값을 쓰되, 원본에 값이 있으면 그것을 우선한다
  // (엑셀에서도 수기 덮어쓰기가 가능한 열이다).
  const site = input.site || pm?.site;

  // 0) 원본에 이미 완전한 분류가 있으면 그대로 확정.
  //    기존 장부를 옮기는 경우가 여기에 해당한다 — 사람이 이미 분류해둔 것을
  //    엔진이 다시 의심할 이유가 없다.
  if (input.acctMajor && input.acctMid && input.acctMinor) {
    return {
      status: "confirmed",
      acctMajor: input.acctMajor,
      acctMid: input.acctMid,
      acctMinor: input.acctMinor,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: "원본 장부에 분류가 있어 그대로 확정",
    };
  }

  // 자금거래·카드대금결제는 손익에 안 잡히므로 계정 분류가 필요 없다.
  // 다만 어댑터가 판정한 경우(은행 적요로 추정)는 사람이 한 번 봐야 한다 —
  // 「카드결」 같은 문구로 맞힌 것이라 틀릴 수 있고, 틀리면 지출이 사라진다.
  if (input.txType === "자금거래" || input.txType === "카드대금결제") {
    return {
      status: input.hint ? "suggested" : "confirmed",
      acctMajor: input.acctMajor || input.hint?.acctMajor,
      acctMid: input.acctMid || input.hint?.acctMid,
      acctMinor: input.acctMinor || input.hint?.acctMinor,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: input.hint
        ? `${input.hint.reason} — 확인 필요`
        : `${input.txType}는 손익 대상이 아니라 분류 불필요`,
    };
  }

  const v = normVendor(input.vendor);
  const last4 = input.last4 ?? "";
  const flow = flowOfInput(input.txType);
  const where = pm?.alias ?? (last4 || "계좌 미지정");
  const seen = ctx.vendorIndex.seen;

  /** 이력이 준 분류를 결과 모양으로 */
  const fromStat = (s: KeyStat) => ({
    // 은행 엑셀은 입출금 방향만 안다. 이력이 이 거래를 비손익·환급으로 분류해
    // 왔다면 유형도 그것이어야 한다 — 고쳐 제안하고 사람이 확인한다.
    ...(s.top.txType !== input.txType ? { txType: s.top.txType } : {}),
    acctMajor: s.top.acctMajor || undefined,
    acctMid: s.top.acctMid || undefined,
    acctMinor: s.top.acctMinor || undefined,
    bizMajor: input.bizMajor || s.biz.major || undefined,
    bizMinor: input.bizMinor || s.biz.minor || undefined,
    site,
  });

  /**
   * 이력이 준 계정을 이번 거래에 쓸 수 있는가. 못 쓰면 사유를 돌려준다.
   * (계정 마스터의 거래유형과 어긋나면 부호가 뒤집힌다 — 수입 ↔ 지출)
   */
  const unusable = (s: { top: Seen }): string | null => {
    // 원본 장부가 대분류·중분류까지만 적어 둔 행 — 사람이 적은 것과 어긋나는 이력은 쓰지 않는다
    if (input.acctMajor && s.top.acctMajor !== input.acctMajor) {
      return `원본 장부의 대분류(${input.acctMajor})와 다릅니다`;
    }
    if (input.acctMid && s.top.acctMid !== input.acctMid) {
      return `원본 장부의 중분류(${input.acctMid})와 다릅니다`;
    }
    const finalType = s.top.txType;
    const acctTx = accountTxType(ctx.accounts, s.top.acctMajor, s.top.acctMid, s.top.acctMinor);
    if (acctTx && acctTx !== finalType && !isAllowedTxAccountMismatch(finalType, s.top.acctMinor, acctTx)) {
      return `그 계정(${s.top.acctMinor})은 ${acctTx} 용이라 이번 ${finalType} 에 맞지 않습니다`;
    }
    return null;
  };

  const pct = (s: KeyStat) => Math.round(s.ratio * 100);
  const evidence = (s: KeyStat): string => {
    const tail = `최근 ${s.n}건 중 ${pct(s)}% 가 같은 분류`;
    if (s.kind === "va") return `거래처 「${input.vendor}」 — ${where} 에서 ${tail}`;
    if (s.kind === "v") return `거래처 「${input.vendor}」 — 다른 계좌·카드까지 합쳐 ${tail}`;
    const like = s.top.vendor && normVendor(s.top.vendor) !== v ? ` (「${s.top.vendor}」 등)` : "";
    if (s.kind === "fa") return `거래처 「${input.vendor}」 와 이름이 닮은 거래${like} — ${where} 에서 ${tail}`;
    return `거래처 「${input.vendor}」 와 이름이 닮은 거래${like} — ${tail}`;
  };
  const typeNote = (s: KeyStat) =>
    s.top.txType !== input.txType ? ` → 거래유형을 ${input.txType} 에서 ${s.top.txType} 로 고쳐 제안` : "";

  // 0-나) 사람이 정한 분류 규칙 — 이력보다 먼저.
  //       이력은 「지금까지 그랬다」 이고 규칙은 「앞으로 이렇게 하라」 다. 다만
  //       조용히 틀리지 않도록: 마스터에서 사라진 계정의 규칙은 쓰지 않고,
  //       원본 장부가 적어 둔 대·중분류와 어긋나면 양보하고, 손익 거래인데
  //       사업구분이 없으면 확정하지 않고 제안으로 올린다.
  const ruled = v ? matchClassRule(input, ctx.classRules ?? []) : undefined;
  if (ruled) {
    const known =
      !ctx.accounts?.length ||
      accountTxType(ctx.accounts, ruled.acctMajor, ruled.acctMid, ruled.acctMinor) === ruled.txType;
    const agrees =
      (!input.acctMajor || input.acctMajor === ruled.acctMajor) &&
      (!input.acctMid || input.acctMid === ruled.acctMid);
    if (known && agrees) {
      const bizMajor = input.bizMajor || ruled.bizMajor;
      const bizMinor = input.bizMinor || ruled.bizMinor;
      const confirm = ruleConfirms(ruled, !!bizMajor && !!bizMinor);
      return {
        status: confirm ? "confirmed" : "suggested",
        ...(ruled.txType !== input.txType ? { txType: ruled.txType } : {}),
        acctMajor: ruled.acctMajor,
        acctMid: ruled.acctMid,
        acctMinor: ruled.acctMinor,
        bizMajor,
        bizMinor,
        site,
        classReason:
          `분류 규칙 「${ruled.keyword}」 → ${describeRuleResult(ruled)}` +
          (ruled.mode === "confirm" && !confirm ? " — 사업구분이 규칙에 없어 확인 필요" : "") +
          (ruled.txType !== input.txType ? ` (거래유형을 ${input.txType} 에서 ${ruled.txType} 로)` : ""),
      };
    }
  }

  // 1) 과거 이력 — 구체적인 열쇠부터
  const stats: KeyStat[] = v
    ? (
        [
          statOf(seen.get(keyOf("va", v, last4, flow)), "va", RECENT),
          statOf(seen.get(keyOf("v", v, last4, flow)), "v", RECENT),
          statOf(seen.get(keyOf("fa", vendorFamily(v), last4, flow)), "fa", RECENT),
          statOf(seen.get(keyOf("f", vendorFamily(v), last4, flow)), "f", RECENT),
        ] as (KeyStat | null)[]
      ).filter((s): s is KeyStat => s !== null)
    : [];

  // 1-가) 같은 거래처 · 같은 계좌가 한결같다 → 확정
  const own = stats.find((s) => s.kind === "va");
  if (own) {
    const steady =
      (own.n >= MIN_HISTORY_COUNT && own.ratio >= MIN_HISTORY_RATIO) ||
      (own.n >= MIN_STEADY_COUNT && own.ratio === 1 && own.months >= 2);
    if (steady) {
      const why = unusable(own);
      if (why) {
        return {
          status: "needs_review",
          site,
          bizMajor: input.bizMajor,
          bizMinor: input.bizMinor,
          classReason: `${evidence(own)} 이지만 ${why} — 직접 골라주세요`,
        };
      }
      const bizSteady = !!input.bizMajor || own.biz.ratio >= MIN_BIZ_RATIO;
      const sameType = own.top.txType === input.txType;
      return {
        status: bizSteady && sameType ? "confirmed" : "suggested",
        ...fromStat(own),
        classReason:
          evidence(own) +
          typeNote(own) +
          (bizSteady ? "" : ` — 사업구분은 갈립니다 (${own.biz.minor || "미정"} ${Math.round(own.biz.ratio * 100)}%)`),
      };
    }
  }

  // 1′) 카드 메모 — 명세서의 거래처는 결제대행사라도 메모는 무엇을 샀는지 안다.
  //     같은 거래처 · 같은 계좌가 한결같을 때(위)는 그쪽이 더 정확해서 그 뒤에 본다.
  //     확정은 만들지 않는다 — 메모가 엉뚱한 결제에 붙어 있을 수 있다 (card-chat.ts).
  //     프로젝트에 묶인 결제에는 쓰지 않는다 — 같은 가게의 같은 품목이라도 프로젝트 것은
  //     계정이 다르다 (생카 엽서는 소모품, JIMFF 엽서는 원자재). 7건 중 4건만 맞았다.
  const memo = input.projectCode ? null : memoParts(input.cardMemo);
  const memoHit = memo ? memoEvidence(seen, memo, flow, classKey) : null;
  if (memoHit && !unusable(memoHit)) {
    const t = memoHit.top;
    return {
      status: "suggested",
      ...(t.txType !== input.txType ? { txType: t.txType } : {}),
      acctMajor: t.acctMajor || undefined,
      acctMid: t.acctMid || undefined,
      acctMinor: t.acctMinor || undefined,
      // 사업구분은 classifyOne 이 메모의 사업구분 근거로 따로 채운다
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason:
        `카드 메모 ${memoLabel(memoHit)} — 최근 ${memoHit.n}건 중 ${Math.round(memoHit.ratio * 100)}% 가 같은 분류` +
        (t.txType !== input.txType ? ` → 거래유형을 ${input.txType} 에서 ${t.txType} 로 고쳐 제안` : ""),
    };
  }

  // 1-나) 거래처는 여러 계정으로 갈리지만 **같은 금액**은 늘 같은 분류였다
  //       (자동이체 · 정기결제 — 이동주 14,900원은 급여가 아니라 유튜브 구독료)
  const amount = (input.gross ?? 0) - (input.adjust ?? 0);
  if (v && amount !== 0) {
    for (const kind of ["va", "v"] as const) {
      const same = (seen.get(keyOf(kind, v, last4, flow)) ?? []).filter((s) => s.amount === amount);
      const st = statOf(same, kind, RECENT);
      if (st && st.n >= MIN_SAME_AMOUNT && st.ratio === 1 && !unusable(st)) {
        return {
          status: "suggested",
          ...fromStat(st),
          classReason:
            `거래처 「${input.vendor}」 — 같은 금액(${amount.toLocaleString("ko-KR")}원) 과거 ${st.n}건이 모두 같은 분류` +
            typeNote(st),
        };
      }
    }
  }

  // 1-다) 일치율이 가장 높은 근거로 제안 (같으면 구체적인 쪽)
  const usable = stats.filter((s) => {
    if (unusable(s)) return false;
    if (s.kind === "va" || s.kind === "fa") return s.ratio >= MIN_SUGGEST_RATIO;
    return s.ratio >= MIN_SUGGEST_RATIO_ELSEWHERE && s.n >= MIN_ELSEWHERE_COUNT;
  });
  const best = usable.reduce<KeyStat | null>((a, b) => (a === null || b.ratio > a.ratio ? b : a), null);
  if (best) {
    return {
      status: "suggested",
      ...fromStat(best),
      classReason: evidence(best) + typeNote(best),
    };
  }

  // 1-라) 아는 거래처인데 한쪽으로 모이지 않는다 — 제안하면 틀리는 쪽이 더
  //       많다. 후보만 적어 사람에게 넘긴다. 구독 규칙·계좌 기본값으로 내려
  //       보내지 않는다 — 「이동주」 70만원 이체가 유튜브 구독료가 되면 안 된다.
  //       (엑셀의 적요가 알려준 것이 있으면 그쪽이 더 구체적이라 양보한다)
  const split = stats.find((s) => s.kind === "va" || s.kind === "fa" || s.n >= MIN_ELSEWHERE_COUNT);
  if (split && !(input.hint?.acctMinor || input.hint?.acctMajor)) {
    const cands = split.spread
      .slice(0, 3)
      .map((c) => `${c.label} ${c.count}건`)
      .join(" · ");
    const mismatch = unusable(split);
    return {
      status: "needs_review",
      acctMajor: input.acctMajor,
      acctMid: input.acctMid,
      acctMinor: input.acctMinor,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: mismatch
        ? `${evidence(split)} 이지만 ${mismatch} — 직접 골라주세요`
        : `거래처 「${input.vendor}」 는 분류가 갈립니다 (${split.kind === "va" ? `${where} ` : ""}최근 ${split.n}건: ${cands}) — 직접 골라주세요`,
    };
  }

  // 2) 구독 규칙 (거래처명 부분일치)
  const rule = v
    ? ctx.vendorRules.find((r) => r.keyword && v.includes(r.keyword.toLowerCase()))
    : undefined;
  if (rule) {
    const [rMajor, rMid, rMinor] = (rule.lookupKey ?? "").split("|").slice(1);
    return {
      status: "suggested",
      acctMajor: input.acctMajor || rMajor || undefined,
      acctMid: input.acctMid || rMid || undefined,
      acctMinor: input.acctMinor || rMinor || undefined,
      bizMajor: input.bizMajor,
      bizMinor: input.bizMinor,
      site,
      classReason: `구독 규칙 「${rule.keyword}」 → ${rule.service}`,
    };
  }

  // 3) 어댑터 힌트 — 은행·카드 엑셀이 알려준 것
  if (input.hint?.acctMinor || input.hint?.acctMajor) {
    return {
      status: "suggested",
      acctMajor: input.acctMajor || input.hint.acctMajor,
      acctMid: input.acctMid || input.hint.acctMid,
      acctMinor: input.acctMinor || input.hint.acctMinor,
      bizMajor: input.bizMajor || input.hint.bizMajor,
      bizMinor: input.bizMinor || input.hint.bizMinor,
      site,
      classReason: input.hint.reason,
    };
  }

  // 3′) 업종 — 처음 보는 가맹점인데 무슨 가게인지는 안다 (음식점 · 카페 · 주유소).
  //      그 업종의 다른 가맹점들이 한쪽으로 모여 있을 때만. 제안까지만 — 같은 식당이라도
  //      회식 · 영업미팅은 계정이 다르고, 그것은 사람이 안다.
  const kindVendors =
    flow === "out" && stats.length === 0 && isUsefulKind(input.vendorKind)
      ? ctx.vendorIndex.kinds?.get(input.vendorKind)
      : undefined;
  if (v && kindVendors && kindVendors.length >= KIND_MIN_VENDORS) {
    const count = new Map<string, number>();
    kindVendors.forEach((s) => count.set(classKey(s), (count.get(classKey(s)) ?? 0) + 1));
    const [topClass, topN] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    const ratio = topN / kindVendors.length;
    const hit = { top: [...kindVendors].reverse().find((s) => classKey(s) === topClass)! };
    if (ratio >= KIND_MIN_RATIO && !unusable(hit)) {
      const t = hit.top;
      // 사업구분은 업종이 아니라 **누가 긁었나**가 말해 준다 — 같은 카드로 같은 계정을 쓴 거래들
      const mine = (seen.get(cardClassKey(last4, t)) ?? []).filter((s) => bizKey(s) !== "").slice(-RECENT);
      const bizCount = new Map<string, number>();
      mine.forEach((s) => bizCount.set(bizKey(s), (bizCount.get(bizKey(s)) ?? 0) + 1));
      const topBiz = [...bizCount.entries()].sort((a, b) => b[1] - a[1])[0];
      const cardBiz =
        topBiz && mine.length >= CARD_BIZ_MIN_COUNT && topBiz[1] / mine.length >= CARD_BIZ_MIN_RATIO
          ? topBiz[0].split("|")
          : undefined;
      return {
        status: "suggested",
        ...(t.txType !== input.txType ? { txType: t.txType } : {}),
        acctMajor: t.acctMajor || undefined,
        acctMid: t.acctMid || undefined,
        acctMinor: t.acctMinor || undefined,
        bizMajor: input.bizMajor || cardBiz?.[0],
        bizMinor: input.bizMinor || cardBiz?.[1],
        site,
        classReason:
          `거래처 「${input.vendor}」 는 처음 — 업종 「${input.vendorKind}」 인 다른 가맹점 ${kindVendors.length}곳 중 ${Math.round(ratio * 100)}% 가 이 분류` +
          (cardBiz
            ? ` · 사업구분은 ${where} 로 쓴 같은 계정 ${mine.length}건 중 ${Math.round((topBiz[1] / mine.length) * 100)}% 가 ${cardBiz[1]}`
            : "") +
          (t.txType !== input.txType ? ` → 거래유형을 ${input.txType} 에서 ${t.txType} 로 고쳐 제안` : ""),
      };
    }
  }

  // 4) 계좌 기본값 — 처음 보는 거래처. 그 계좌에 들어온(나간) 돈이 대개 무엇이었나
  if (last4) {
    const prior = statOf(seen.get(keyOf("a", "", last4, flow)), "a", PRIOR_RECENT);
    if (prior && prior.n >= PRIOR_MIN_COUNT && prior.ratio >= PRIOR_MIN_RATIO && !unusable(prior)) {
      return {
        status: "suggested",
        ...fromStat(prior),
        classReason:
          `${v ? `거래처 「${input.vendor}」 는 처음` : "거래처 없음"} — ${where} 의 ${flow === "in" ? "입금" : "출금"}은 ` +
          `최근 ${prior.n}건 중 ${pct(prior)}% 가 이 분류` +
          typeNote(prior),
      };
    }
  }

  // 5) 판단 불가 — 사람에게 넘긴다
  return {
    status: "needs_review",
    acctMajor: input.acctMajor,
    acctMid: input.acctMid,
    acctMinor: input.acctMinor,
    bizMajor: input.bizMajor,
    bizMinor: input.bizMinor,
    site,
    classReason: v
      ? `거래처 「${input.vendor}」 과거 이력·규칙 없음`
      : "거래처가 비어 있어 판단 불가",
  };
}

// ---- 후보 — 갈리는 거래처에서 사람이 고를 것들 --------------------

/** 과거에 이 거래처가 쓰인 분류 하나 — 검토 화면이 누르는 단추로 보인다 */
export interface ClassCandidate {
  txType: TxType;
  acctMajor: string;
  acctMid: string;
  acctMinor: string;
  /** 그 분류 안에서 사업구분이 한결같을 때만 (아니면 사람이 고른다) */
  bizMajor?: string;
  bizMinor?: string;
  /** 그 분류로 쓰인 건수 */
  count: number;
}

export interface ClassCandidates {
  /** 무엇을 보고 뽑았나 — `(신법)이동주 에서 최근 12건` */
  basis: string;
  /** 본 건수 */
  n: number;
  /** 많이 쓰인 순 */
  items: ClassCandidate[];
}

/** 후보로 보여 줄 최대 수 — 그 아래는 한두 건짜리 예외다 */
const MAX_CANDIDATES = 4;

/**
 * 이 거래처가 과거에 어떤 분류들로 쓰였나. 「분류가 갈립니다」 의 후보를 **누를 수 있는
 * 것**으로 돌려준다 (사유 문장에는 소분류 이름과 건수만 있다).
 *
 * 자동분류가 사유를 만들 때 본 것과 같은 이력을 본다 — 같은 거래처 · 같은 계좌가 먼저,
 * 없으면 다른 계좌까지. 이번 거래에 쓸 수 없는 분류(수입 계정을 지출에)는 뺀다.
 * 이력이 없으면 null.
 */
export function classCandidates(
  input: Pick<ClassifyInput, "vendor" | "last4" | "txType" | "acctMajor" | "acctMid">,
  ctx: ClassifyContext,
): ClassCandidates | null {
  const v = normVendor(input.vendor);
  if (!v) return null;
  const last4 = input.last4 ?? "";
  const flow = flowOfInput(input.txType);
  const seen = ctx.vendorIndex.seen;
  const stats = (
    [
      statOf(seen.get(keyOf("va", v, last4, flow)), "va", RECENT),
      statOf(seen.get(keyOf("v", v, last4, flow)), "v", RECENT),
      statOf(seen.get(keyOf("fa", vendorFamily(v), last4, flow)), "fa", RECENT),
      statOf(seen.get(keyOf("f", vendorFamily(v), last4, flow)), "f", RECENT),
    ] as (KeyStat | null)[]
  ).filter((s): s is KeyStat => s !== null);
  // 사유를 만들 때와 같은 순서로 고른다 (classifyByEvidence 의 1-라)
  const st = stats.find((s) => s.kind === "va" || s.kind === "fa" || s.n >= MIN_ELSEWHERE_COUNT) ?? stats[0];
  if (!st) return null;

  const pm = last4 ? ctx.paymentMethods.find((p) => p.last4 === last4) : undefined;
  const where = pm?.alias ?? (last4 || "계좌 미지정");
  const items = st.spread
    .filter(({ rows }) => {
      const top = rows[rows.length - 1];
      if (!top.acctMinor) return false;
      // 원본 장부가 적어 둔 대·중분류와 어긋나는 것은 후보가 아니다
      if (input.acctMajor && top.acctMajor !== input.acctMajor) return false;
      if (input.acctMid && top.acctMid !== input.acctMid) return false;
      const acctTx = accountTxType(ctx.accounts, top.acctMajor, top.acctMid, top.acctMinor);
      return !acctTx || acctTx === top.txType || isAllowedTxAccountMismatch(top.txType, top.acctMinor, acctTx);
    })
    .slice(0, MAX_CANDIDATES)
    .map(({ rows, count }): ClassCandidate => {
      const top = rows[rows.length - 1];
      const bizCount = new Map<string, number>();
      rows.forEach((s) => bizCount.set(bizKey(s), (bizCount.get(bizKey(s)) ?? 0) + 1));
      const [biz, bizN] = [...bizCount.entries()].sort((a, b) => b[1] - a[1])[0];
      const steady = biz !== "" && bizN / rows.length >= MIN_BIZ_RATIO;
      const [bizMajor, bizMinor] = biz.split("|");
      return {
        txType: top.txType,
        acctMajor: top.acctMajor,
        acctMid: top.acctMid,
        acctMinor: top.acctMinor,
        ...(steady ? { bizMajor, bizMinor } : {}),
        count,
      };
    });
  if (items.length === 0) return null;
  return {
    basis: st.kind === "va" || st.kind === "fa" ? `${where} 에서 최근 ${st.n}건` : `다른 계좌·카드까지 최근 ${st.n}건`,
    n: st.n,
    items,
  };
}

/** 임포트 미리보기용 요약 */
export interface ClassifySummary {
  confirmed: number;
  suggested: number;
  needsReview: number;
  total: number;
  /** 자동확정률 */
  autoRate: number;
}

export function summarize(results: ClassifySuggestion[]): ClassifySummary {
  const confirmed = results.filter((r) => r.status === "confirmed").length;
  const suggested = results.filter((r) => r.status === "suggested").length;
  const needsReview = results.filter((r) => r.status === "needs_review").length;
  const total = results.length;
  return {
    confirmed,
    suggested,
    needsReview,
    total,
    autoRate: total ? confirmed / total : 0,
  };
}
