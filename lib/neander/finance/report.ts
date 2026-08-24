// ============================================================
//  리포트 엔진 — 엑셀 「지출상세」·「B2C/B2B/공용」 시트를 코드로
// ------------------------------------------------------------
//  하나의 함수가 세 화면을 먹인다. 엑셀은 시트마다 SUMIFS 조건을 따로
//  써서 기준이 조금씩 갈라졌다 — 여기서는 "무엇을 세는가"를 이 파일
//  한 곳에만 둔다.
//
//  집계 축
//    계정 3단 트리(대 ▸ 중 ▸ 소)  × 기간 × 기준 × 사업구분/사업장
//
//  기준(basis) — 엑셀 두 시트의 헤더 주석 그대로다.
//    발생주의  카드사용내역 포함, 카드대금결제 제외  → 비용이 발생한 시점
//    현금흐름  카드대금결제 포함, 카드사용내역 제외  → 통장에서 돈이 나간 시점
//
//  열 정의 (엑셀과 동일)
//    지출금액        지출 합계
//    지출금액(순수)  지출 − 개인사용 − 환급
//    차이(개인·환급) 개인사용 + 환급
//    순금액          수입 − 순수지출
//
//  ⚠️ 순금액은 대시보드의 순손익과 **개인사용분만큼 다르다**.
//     대시보드: 수입 − (지출 − 환급)          → 개인사용을 비용으로 본다
//     이 리포트: 수입 − (지출 − 환급 − 개인사용) → 개인사용은 회수 대상이라 뺀다
//     엑셀 지출상세 시트가 후자다. 둘 다 맞는 관점이라 어느 쪽도 바꾸지 않고,
//     화면에서 개인사용이 0이 아니면 차이를 밝힌다.
// ============================================================

import { FIN_ACCOUNTS } from "./master-data";
import type { FinAccountDoc, FinPaymentMethodDoc, FinSubscriptionDoc } from "./db-types";
import { netAmount, type FinTransaction } from "./types";

export type Basis = "accrual" | "cash";

export const BASIS_LABEL: Record<Basis, string> = {
  accrual: "발생주의",
  cash: "현금흐름",
};

export const BASIS_HINT: Record<Basis, string> = {
  accrual: "카드사용내역 포함 · 카드대금결제 제외 — 비용이 발생한 시점",
  cash: "카드대금결제 포함 · 카드사용내역 제외 — 통장에서 돈이 나간 시점",
};

/** 계정이 비어 있을 때의 표기 (aggregate.ts 의 UNSET 과 같은 뜻) */
export const NO_ACCOUNT = "(미분류)";

// ---- 결제수단 종류 --------------------------------------------

/**
 * 카드 결제인가. 현금흐름 기준을 계산하려면 이 판정이 필요하다.
 *
 * 마스터의 `kind` 를 본다. `kind` 가 없는 문서(이 필드가 생기기 전에 적재된
 * 것)는 `personal` 로 판정한다 — 지금 카드는 전부 임직원 개인 명의라 두
 * 값이 일치하기 때문이다. 마스터를 다시 적재하면 `kind` 가 채워지고,
 * 법인카드가 생겨 둘이 갈라져도 `kind` 쪽이 이긴다.
 */
export function makeIsCard(paymentMethods: FinPaymentMethodDoc[]): (last4?: string) => boolean {
  const cards = new Set(
    paymentMethods.filter((p) => (p.kind ? p.kind === "card" : p.personal)).map((p) => p.last4),
  );
  return (last4?: string) => (last4 ? cards.has(last4) : false);
}

/** 마스터에 `kind` 가 아직 없는 결제수단 — 마스터 재적재를 권할 근거 */
export const legacyPaymentMethods = (paymentMethods: FinPaymentMethodDoc[]) =>
  paymentMethods.filter((p) => !p.kind);

// ---- 기준 필터 ------------------------------------------------

/**
 * 이 거래를 이 기준의 집계에 넣는가.
 *
 * 자금거래(계좌간 이동·예수금 등)는 어느 기준에서도 제외한다 — 손익이
 * 아니고 엑셀 지출상세 시트에도 그 계정 섹션이 없다.
 */
export function inBasis(
  t: FinTransaction,
  basis: Basis,
  isCard: (last4?: string) => boolean,
): boolean {
  if (t.txType === "자금거래") return false;
  if (basis === "accrual") return t.txType !== "카드대금결제";
  // 현금흐름: 카드로 쓴 건 아직 통장에서 안 나갔고, 카드대금결제가 그 시점이다
  if (t.txType === "카드대금결제") return true;
  if (t.txType === "지출" && isCard(t.last4)) return false;
  return true;
}

// ---- 집계 값 --------------------------------------------------

export interface ReportValue {
  income: number;
  /** 지출 합계 (개인사용·환급 차감 전) */
  expense: number;
  /** 임직원 개인 사용분 */
  personal: number;
  refund: number;
  /** 순수 지출 = 지출 − 개인사용 − 환급 */
  expensePure: number;
  /** 차이 = 개인사용 + 환급 */
  diff: number;
  /** 순금액 = 수입 − 순수지출 */
  net: number;
  count: number;
}

const zero = (): ReportValue => ({
  income: 0,
  expense: 0,
  personal: 0,
  refund: 0,
  expensePure: 0,
  diff: 0,
  net: 0,
  count: 0,
});

function add(v: ReportValue, t: FinTransaction): void {
  const n = netAmount(t);
  v.count += 1;
  if (t.txType === "수입") v.income += n;
  else if (t.txType === "환급") v.refund += n;
  else {
    // 지출 · 카드대금결제
    v.expense += n;
    if (t.personalUse) v.personal += n;
  }
}

function seal(v: ReportValue): ReportValue {
  v.expensePure = v.expense - v.personal - v.refund;
  v.diff = v.personal + v.refund;
  v.net = v.income - v.expensePure;
  return v;
}

const sumInto = (target: ReportValue, src: ReportValue): void => {
  target.income += src.income;
  target.expense += src.expense;
  target.personal += src.personal;
  target.refund += src.refund;
  target.count += src.count;
};

export const isEmptyValue = (v: ReportValue) =>
  v.income === 0 && v.expense === 0 && v.refund === 0 && v.count === 0;

// ---- 범위 -----------------------------------------------------

export interface ReportScope {
  /** `YYYY-MM`. 비우면 전체 기간 */
  month?: string;
  bizMajor?: string;
  bizMinor?: string;
  site?: string;
}

export function inScope(t: FinTransaction, scope: ReportScope): boolean {
  if (scope.month && !(t.date ?? "").startsWith(scope.month)) return false;
  if (scope.bizMajor && (t.bizMajor ?? "") !== scope.bizMajor) return false;
  if (scope.bizMinor && (t.bizMinor ?? "") !== scope.bizMinor) return false;
  if (scope.site && (t.site ?? "") !== scope.site) return false;
  return true;
}

// ---- 계정 트리 ------------------------------------------------

export interface TreeNode {
  /** 계정 경로 `대|중|소` — 행 키이자 드릴다운 링크의 근거 */
  path: string;
  level: 0 | 1 | 2;
  major: string;
  mid?: string;
  minor?: string;
  label: string;
  value: ReportValue;
  children: TreeNode[];
  /** 이 노드에 속한 거래 (요약·드릴다운용). 잎에만 담고 상위는 비운다 */
  rows: FinTransaction[];
}

export interface Report {
  roots: TreeNode[];
  total: ReportValue;
  /** 기준에서 걸러지기 전 원본 건수 — "몇 건이 빠졌나"를 밝히는 데 쓴다 */
  scopedCount: number;
  usedCount: number;
}

/**
 * 통합_MAP 의 등장 순서를 그대로 쓴다. 엑셀 지출상세 시트의 행 순서가
 * 이 순서라서, 나란히 놓고 대조할 수 있어야 이관이 검증된다.
 * 마스터에 없는 계정(과거 장부의 폐지된 계정 등)은 뒤에 가나다순으로 붙인다.
 */
const ORDER = (() => {
  const major = new Map<string, number>();
  const mid = new Map<string, number>();
  const minor = new Map<string, number>();
  FIN_ACCOUNTS.forEach((a, i) => {
    if (!major.has(a.major)) major.set(a.major, i);
    const midKey = `${a.major}|${a.mid}`;
    if (!mid.has(midKey)) mid.set(midKey, i);
    minor.set(`${a.major}|${a.mid}|${a.minor}`, i);
  });
  return { major, mid, minor };
})();

const LAST = Number.MAX_SAFE_INTEGER;
const rank = (m: Map<string, number>, key: string) => m.get(key) ?? LAST;

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const map = a.level === 0 ? ORDER.major : a.level === 1 ? ORDER.mid : ORDER.minor;
    const ra = rank(map, a.path);
    const rb = rank(map, b.path);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label, "ko");
  });
  nodes.forEach((n) => sortNodes(n.children));
}

/**
 * 리포트 한 판.
 *
 * `accounts` 를 주면 거래가 없는 계정도 0원 행으로 나온다 (엑셀 지출상세는
 * 전체 계정을 항상 펼쳐 놓는다 — "이 계정에 아무것도 안 잡혔다"가 정보다).
 * 화면에서 0원 행을 숨길지는 보는 사람이 정한다.
 */
export function buildReport(
  transactions: FinTransaction[],
  opts: {
    basis: Basis;
    isCard: (last4?: string) => boolean;
    scope?: ReportScope;
    /** 계정 마스터 — 거래가 없는 계정까지 행으로 만들려면 넘긴다 */
    accounts?: FinAccountDoc[];
  },
): Report {
  const scope = opts.scope ?? {};
  const scoped = transactions.filter((t) => inScope(t, scope));
  const used = scoped.filter((t) => inBasis(t, opts.basis, opts.isCard));

  const roots = new Map<string, TreeNode>();

  const node = (
    parent: Map<string, TreeNode> | TreeNode,
    level: 0 | 1 | 2,
    path: string,
    label: string,
    parts: { major: string; mid?: string; minor?: string },
  ): TreeNode => {
    const bucket = parent instanceof Map ? parent : undefined;
    const list = bucket ? undefined : (parent as TreeNode).children;
    const found = bucket
      ? bucket.get(path)
      : list!.find((c) => c.path === path);
    if (found) return found;
    const created: TreeNode = {
      path,
      level,
      label,
      value: zero(),
      children: [],
      rows: [],
      ...parts,
    };
    if (bucket) bucket.set(path, created);
    else list!.push(created);
    return created;
  };

  /** 계정 3단 경로를 트리에 만들어 두고 잎 노드를 돌려준다 */
  const leafFor = (major: string, mid: string, minor: string): TreeNode => {
    const a = node(roots, 0, major, major, { major });
    const b = node(a, 1, `${major}|${mid}`, mid, { major, mid });
    return node(b, 2, `${major}|${mid}|${minor}`, minor, { major, mid, minor });
  };

  // 1) 마스터의 계정을 미리 깔아 둔다 (0원 행)
  opts.accounts?.forEach((a) => leafFor(a.major, a.mid, a.minor));

  // 2) 실제 거래를 잎에 담는다
  used.forEach((t) => {
    const leaf = leafFor(
      t.acctMajor || NO_ACCOUNT,
      t.acctMid || NO_ACCOUNT,
      t.acctMinor || NO_ACCOUNT,
    );
    add(leaf.value, t);
    leaf.rows.push(t);
  });

  // 3) 잎 → 중 → 대 로 굴려 올린다
  const rootList = [...roots.values()];
  rootList.forEach((major) => {
    major.children.forEach((mid) => {
      mid.children.forEach((leaf) => {
        seal(leaf.value);
        sumInto(mid.value, leaf.value);
      });
      seal(mid.value);
      sumInto(major.value, mid.value);
    });
    seal(major.value);
  });

  const total = zero();
  rootList.forEach((r) => sumInto(total, r.value));
  seal(total);

  sortNodes(rootList);

  return { roots: rootList, total, scopedCount: scoped.length, usedCount: used.length };
}

// ---- 노드 요약 ------------------------------------------------

export interface VendorBit {
  vendor: string;
  count: number;
  amount: number;
}

/** 이 계정에서 돈이 오간 상위 거래처 — 엑셀 B2C/B2B/공용 시트의 「비고」 자리 */
export function topVendorsOf(node: TreeNode, limit = 3): VendorBit[] {
  const map = new Map<string, VendorBit>();
  node.rows.forEach((t) => {
    const v = t.vendor?.trim() || "(거래처 없음)";
    if (!map.has(v)) map.set(v, { vendor: v, count: 0, amount: 0 });
    const s = map.get(v)!;
    s.count += 1;
    s.amount += netAmount(t);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** "쿠팡 외 4곳 · 13건" 같은 한 줄 요약 */
export function summarize(node: TreeNode): string {
  if (node.rows.length === 0) return "";
  const vendors = new Set(node.rows.map((t) => t.vendor?.trim() || "(거래처 없음)"));
  const top = topVendorsOf(node, 1)[0];
  const others = vendors.size - 1;
  const who = others > 0 ? `${top.vendor} 외 ${others}곳` : top.vendor;
  return `${who} · ${node.rows.length}건`;
}

// ---- 사업부 축 ------------------------------------------------

export interface UnitKey {
  bizMajor: string;
  bizMinor: string;
  label: string;
}

/** 엑셀 사업부손익 시트의 사업부 순서 (B2C → B2B → 공용) */
const UNIT_MAJOR_ORDER = ["B2C", "B2B", "공용", "해당없음"];

export function availableUnits(rows: FinTransaction[]): UnitKey[] {
  const set = new Map<string, UnitKey>();
  rows.forEach((t) => {
    const bizMajor = t.bizMajor || "(미정)";
    const bizMinor = t.bizMinor || "(미정)";
    const key = `${bizMajor}|${bizMinor}`;
    if (!set.has(key)) set.set(key, { bizMajor, bizMinor, label: `${bizMajor} · ${bizMinor}` });
  });
  return [...set.values()].sort((a, b) => {
    const ia = UNIT_MAJOR_ORDER.indexOf(a.bizMajor);
    const ib = UNIT_MAJOR_ORDER.indexOf(b.bizMajor);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.bizMinor.localeCompare(b.bizMinor, "ko");
  });
}

// ---- 구독 ------------------------------------------------------

/**
 * 구독으로 인정하는 계정소분류.
 *
 * 엑셀 구독서비스 관리 시트는 `운영비 > 일반운영비 > 구독서비스비` 하나만
 * 셌지만, 실제 장부에는 SMOAT·개발 툴 구독이 다른 계정에도 들어간다.
 * 세 계정을 모두 센다.
 */
export const SUBSCRIPTION_ACCOUNTS = ["구독서비스비", "툴구독비", "개발프로그램구독비"];

export const isSubscriptionAccount = (t: FinTransaction) =>
  SUBSCRIPTION_ACCOUNTS.includes(t.acctMinor ?? "");

export interface SubscriptionRow {
  service: string;
  /** 실제로 맞은 키워드들 */
  keywords: string[];
  count: number;
  /** 지출 합계 */
  expense: number;
  /** 환급·환불 */
  refund: number;
  /** 순지출 */
  net: number;
  /** 실제로 쓰인 결제수단 뒷 4자리 */
  last4: string[];
  rows: FinTransaction[];
}

export interface SubscriptionReport {
  services: SubscriptionRow[];
  /** 구독 계정인데 어느 규칙에도 안 걸린 거래 */
  unmatched: FinTransaction[];
  unmatchedTotal: number;
  /** 구독 계정 전체 (= services 합 + unmatched) */
  total: number;
  count: number;
}

/**
 * 구독 매칭 규칙. 구독 마스터(neander_fin_subscriptions)가 정본이고,
 * 아직 적재되지 않았으면 옛 거래처 규칙에서 만들어 쓴다 — 마스터를 넣기
 * 전에도 화면이 비지 않게.
 */
export interface SubscriptionMatcher {
  service: string;
  keywords: string[];
  /** 이 계정소분류일 때만. 비우면 구독 계정 전체 */
  acctMinors?: string[];
  cycle?: "monthly" | "usage";
  expected?: number;
  recommendedCard?: string;
  status?: "active" | "review" | "cancelled";
  note?: string;
}

export function subscriptionMatchers(
  subscriptions: FinSubscriptionDoc[],
  vendorRules: { service: string; keyword: string }[],
): SubscriptionMatcher[] {
  if (subscriptions.length > 0) {
    return subscriptions
      .filter((s) => s.status !== "cancelled")
      .map((s) => ({
        service: s.service,
        keywords: s.keywords ?? [],
        acctMinors: s.acctMinors,
        cycle: s.cycle,
        expected: s.expected,
        recommendedCard: s.recommendedCard,
        status: s.status,
        note: s.note,
      }));
  }
  // 폴백: 옛 규칙은 키워드가 하나뿐이라 같은 서비스의 다른 표기를 놓친다
  const byService = new Map<string, SubscriptionMatcher>();
  vendorRules.forEach((r) => {
    const m = byService.get(r.service) ?? { service: r.service, keywords: [] };
    m.keywords.push(r.keyword);
    byService.set(r.service, m);
  });
  return [...byService.values()];
}

/**
 * 구독 서비스별 집계.
 *
 * ⚠️ 반드시 **구독 계정 안에서만** 거래처 키워드를 맞춘다. 계정 조건 없이
 *    거래처만 보면 사람 이름 키워드(`이동주`·`김제연`)가 급여 이체를 구독비로
 *    끌어온다 — 2026-07 실측으로 500만원이 그렇게 섞여 들어왔다.
 */
export function subscriptionReport(
  rows: FinTransaction[],
  matchers: SubscriptionMatcher[],
): SubscriptionReport {
  const pool = rows.filter(
    (t) => isSubscriptionAccount(t) && (t.txType === "지출" || t.txType === "환급"),
  );

  const out: SubscriptionRow[] = [];
  const matched = new Set<FinTransaction>();

  matchers.forEach((m) => {
    const kws = m.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (kws.length === 0) return;
    const row: SubscriptionRow = {
      service: m.service,
      keywords: m.keywords,
      count: 0,
      expense: 0,
      refund: 0,
      net: 0,
      last4: [],
      rows: [],
    };
    pool.forEach((t) => {
      if (matched.has(t)) return; // 규칙이 겹치면 먼저 맞은 서비스에 귀속
      if (m.acctMinors?.length && !m.acctMinors.includes(t.acctMinor ?? "")) return;
      const vendor = (t.vendor ?? "").toLowerCase();
      if (!kws.some((k) => vendor.includes(k))) return;
      matched.add(t);
      row.count += 1;
      const n = netAmount(t);
      if (t.txType === "환급") row.refund += n;
      else row.expense += n;
      row.rows.push(t);
      if (t.last4 && !row.last4.includes(t.last4)) row.last4.push(t.last4);
    });
    row.net = row.expense - row.refund;
    if (row.count > 0) out.push(row);
  });

  const unmatched = pool.filter((t) => !matched.has(t));
  const amount = (list: FinTransaction[]) =>
    list.reduce((s, t) => s + (t.txType === "환급" ? -netAmount(t) : netAmount(t)), 0);

  return {
    services: out.sort((a, b) => b.net - a.net),
    unmatched,
    unmatchedTotal: amount(unmatched),
    total: amount(pool),
    count: pool.length,
  };
}

// ---- 구독 경고 ------------------------------------------------

export interface SubscriptionAlert {
  kind: "split" | "missing" | "spike" | "over" | "review";
  message: string;
}

export interface SubscriptionView {
  matcher: SubscriptionMatcher;
  /** 이번 달 집계 (없으면 결제가 없었다는 뜻) */
  current?: SubscriptionRow;
  /** 직전 달들의 순지출 (최근 → 과거) */
  history: { month: string; net: number }[];
  /** 직전 달들의 중앙값 — 급증 판단의 기준 */
  baseline: number;
  alerts: SubscriptionAlert[];
}

const median = (xs: number[]) => {
  const v = xs.filter((n) => n > 0).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/**
 * 이번 달 구독 현황 + 경고.
 *
 * 경고 기준을 마스터의 `expected` 하나에만 맡기지 않는다 — 아무도 채워두지
 * 않으면 영영 울리지 않기 때문이다. 대신 **직전 달들의 중앙값**을 기본
 * 기준선으로 삼고, `expected` 가 있으면 그걸 함께 본다. 평균이 아니라
 * 중앙값인 이유는 사용량 과금이 한 달만 튀는 일이 잦아서다.
 */
export function subscriptionMonthView(
  transactions: FinTransaction[],
  matchers: SubscriptionMatcher[],
  month: string,
  historyMonths: string[],
): { views: SubscriptionView[]; report: SubscriptionReport } {
  const inMonthRows = (m: string) => transactions.filter((t) => (t.date ?? "").startsWith(m));
  const report = subscriptionReport(inMonthRows(month), matchers);

  const past = historyMonths
    .filter((m) => m !== month)
    .map((m) => ({ month: m, report: subscriptionReport(inMonthRows(m), matchers) }));

  const views = matchers.map<SubscriptionView>((matcher) => {
    const current = report.services.find((s) => s.service === matcher.service);
    const history = past.map((p) => ({
      month: p.month,
      net: p.report.services.find((s) => s.service === matcher.service)?.net ?? 0,
    }));
    const baseline = median(history.map((h) => h.net));
    const alerts: SubscriptionAlert[] = [];

    if (current && current.last4.length > 1) {
      alerts.push({
        kind: "split",
        message: `결제수단 ${current.last4.length}개로 분산 — 카드 1장으로 모으면 청구서만 봐도 귀속이 갈립니다`,
      });
    }
    if (!current && matcher.status === "active" && matcher.cycle === "monthly" && baseline > 0) {
      alerts.push({
        kind: "missing",
        message: `이번 달 결제 없음 — 직전 중앙값 ${won(baseline)}. 해지했다면 마스터에서 상태를 바꾸세요`,
      });
    }
    if (current && baseline > 0 && current.net > baseline * 1.5) {
      const pct = Math.round((current.net / baseline - 1) * 100);
      alerts.push({ kind: "spike", message: `직전 중앙값 대비 +${pct}% (${won(baseline)} → ${won(current.net)})` });
    }
    if (current && matcher.expected && current.net > matcher.expected) {
      alerts.push({ kind: "over", message: `월 예상 ${won(matcher.expected)} 초과 (${won(current.net)})` });
    }
    if (matcher.status === "review") {
      alerts.push({ kind: "review", message: matcher.note ?? "확인 필요로 표시된 서비스입니다" });
    }
    return { matcher, current, history, baseline, alerts };
  });

  return { views, report };
}

/** 구독 월별 추이 — 서비스 × 월 히트맵의 원자료 */
export function subscriptionByMonth(
  rows: FinTransaction[],
  matchers: SubscriptionMatcher[],
  months: string[],
): { service: string; byMonth: Record<string, number>; total: number }[] {
  const out = new Map<string, { service: string; byMonth: Record<string, number>; total: number }>();
  months.forEach((m) => {
    const r = subscriptionReport(
      rows.filter((t) => (t.date ?? "").startsWith(m)),
      matchers,
    );
    r.services.forEach((s) => {
      if (!out.has(s.service)) out.set(s.service, { service: s.service, byMonth: {}, total: 0 });
      const e = out.get(s.service)!;
      e.byMonth[m] = s.net;
      e.total += s.net;
    });
  });
  return [...out.values()].sort((a, b) => b.total - a.total);
}
