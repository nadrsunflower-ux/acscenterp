// ============================================================
//  이번 달에 튄 지출 — 리포트에 형광펜을 칠할 근거
// ------------------------------------------------------------
//  "평소와 다르다"를 사람 대신 먼저 짚는다. 기준은 셋이다 (2026-09-15 사용자 결정):
//
//    계정 급증        그 계정의 이번 달 지출이 직전 6개월 중앙값의 1.5배 이상,
//                     차이 30만원 이상. 평균이 아니라 중앙값이라 한 달 튄 달이
//                     기준선을 끌어올리지 않는다 (구독 화면의 급증 판정과 같은 생각).
//    처음 보는 거래처  이전 달들에 한 번도 없던 거래처로 30만원 이상 나간 거래
//    평소보다 큰 금액  같은 거래처 과거 건별 중앙값의 2배 이상, 차이 30만원 이상
//
//  지출은 「지출」 거래만 센다 — 카드대금결제는 카드로 이미 센 돈을 한 번 더
//  갚는 것이라 넣으면 두 번 튄다. 계정 합계에서는 환급을 뺀다.
//
//  형광펜은 따라 내려가면 원인에 닿아야 한다 (2026-09-15 사용자 결정):
//    위 → 아래  계정이 튀면 그 계정 안에서 증가를 이끈 거래처(drivers)를 함께
//               짚는다. 작은 결제가 쌓여 튄 계정(구독 늘어남)은 건별 기준에 안
//               걸리므로, 이게 없으면 창을 열어도 이유가 안 보인다.
//    아래 → 위  계정은 안 튀었는데 안에 튄 거래가 있으면 계정 줄에 점을 찍는다
//               (flaggedTxCounts). 없으면 표에서 출발해서는 그 거래를 못 찾는다.
//
//  ⚠️ 판정일 뿐 오류가 아니다. 칠해진 칸은 "확인해 볼 만하다"는 뜻이고,
//     이유는 칸에 커서를 두면 나온다.
//
//  사람이 끌 수 있다 (AnomalyIgnores — neander_fin_anomaly_ignores):
//    신뢰한 거래처  그 거래처 거래는 칠하지 않고, 계정 급증 계산에서도 뺀다
//                   (그 거래처가 유일한 원인이었다면 계정 형광펜도 같이 꺼진다)
//    확인한 계정    그 달 그 계정 줄만 끈다 — 다음 달에 또 튀면 다시 칠한다
// ============================================================

import { inScope, NO_ACCOUNT, type ReportScope } from "./report";
import { netAmount, type FinTransaction } from "./types";

export const ANOMALY_RULE = {
  /** 계정 급증의 기준선으로 볼 직전 달 수 */
  lookback: 6,
  /** 기준선이 되려면 최소 이만큼의 과거 달이 있어야 한다 */
  minHistory: 3,
  spikeRatio: 1.5,
  vendorRatio: 2,
  /** 이보다 작은 차이는 튀어도 칠하지 않는다 — 형광펜이 너무 많으면 아무것도 안 보인다 */
  minDiff: 300_000,
  /** 계정 증가분의 이만큼을 설명할 때까지 큰 거래처부터 원인으로 짚는다 */
  driverCover: 0.7,
  /** 원인 거래처는 최대 이만큼 — 다섯을 넘으면 "고르게 늘었다" 에 가깝다 */
  maxDrivers: 5,
} as const;

/** 계정 증가를 이끈 거래처 하나 */
export interface SpikeDriver {
  /** 거래처 원문 (없으면 "(거래처 없음)") */
  vendor: string;
  current: number;
  baseline: number;
  reason: string;
}

export interface AccountSpike {
  current: number;
  baseline: number;
  reason: string;
  /** 거래처 비교 키(vendorKey) → 원인. 증가분이 큰 순서로 넣는다 */
  drivers: Map<string, SpikeDriver>;
}

export interface TxFlag {
  /** driver = 튄 계정의 증가를 이끈 거래처의 거래 */
  kind: "newVendor" | "bigger" | "driver";
  reason: string;
}

/** 사람이 끈 형광펜 */
export interface AnomalyIgnores {
  /** 신뢰한 거래처의 비교 키 (vendorKey) */
  vendors: Set<string>;
  /** 확인한 계정 — `${month}::${path}` */
  accounts: Set<string>;
}

export const NO_IGNORES: AnomalyIgnores = { vendors: new Set(), accounts: new Set() };

export const ignoredAccountKey = (month: string, path: string) => `${month}::${path}`;

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 장부의 첫 달 — 그보다 앞선 달은 "지출 0" 이 아니라 "기록 없음" 이다 */
function firstMonth(txs: FinTransaction[]): string {
  let first = "9999-99";
  txs.forEach((t) => {
    const m = t.date?.slice(0, 7);
    if (m && m < first) first = m;
  });
  return first;
}

/** 거래처 이름 비교용 — 띄어쓰기·대소문자 차이는 같은 곳으로 본다 */
export const vendorKey = (v?: string) => (v ?? "").toLowerCase().replace(/\s+/g, "");

/** 계정 경로 세 단 — TreeNode.path 와 같은 모양 */
export function accountPaths(t: FinTransaction): string[] {
  const major = t.acctMajor || NO_ACCOUNT;
  const mid = t.acctMid || NO_ACCOUNT;
  const minor = t.acctMinor || NO_ACCOUNT;
  return [major, `${major}|${mid}`, `${major}|${mid}|${minor}`];
}

/** 계정 합계에 더하는 값 — 지출은 +, 환급은 −, 나머지는 세지 않는다 */
const expenseDelta = (t: FinTransaction): number | null =>
  t.txType === "지출" ? netAmount(t) : t.txType === "환급" ? -netAmount(t) : null;

interface VendorSums {
  label: string;
  byMonth: Map<string, number>;
}

/**
 * 계정 경로(`대` · `대|중` · `대|중|소`)별 급증 판정 + 그 증가를 이끈 거래처.
 * scope 로 사업부·사업장을 좁히면 그 안에서의 평소와 비교한다.
 */
export function accountSpikes(
  txs: FinTransaction[],
  month: string,
  scope: Omit<ReportScope, "month"> = {},
  ignores: AnomalyIgnores = NO_IGNORES,
): Map<string, AccountSpike> {
  const out = new Map<string, AccountSpike>();
  const first = firstMonth(txs);
  const history: string[] = [];
  for (let i = 1; i <= ANOMALY_RULE.lookback; i++) {
    const m = addMonths(month, -i);
    if (m >= first) history.push(m);
  }
  if (history.length < ANOMALY_RULE.minHistory) return out;

  const wanted = new Set([month, ...history]);
  const sums = new Map<string, Map<string, number>>();
  /** 경로 → 거래처 → 달별 합 (원인 거래처를 짚는 데 쓴다) */
  const vendorSums = new Map<string, Map<string, VendorSums>>();
  txs.forEach((t) => {
    const m = t.date?.slice(0, 7);
    if (!m || !wanted.has(m) || !inScope(t, scope)) return;
    const vk = vendorKey(t.vendor);
    // 신뢰한 거래처는 이번 달·과거 모두에서 뺀다 — 한쪽에만 빼면 기준선이 틀어진다
    if (ignores.vendors.has(vk)) return;
    const d = expenseDelta(t);
    if (d === null) return;
    accountPaths(t).forEach((path) => {
      const byMonth = sums.get(path) ?? new Map<string, number>();
      byMonth.set(m, (byMonth.get(m) ?? 0) + d);
      sums.set(path, byMonth);

      const vendors = vendorSums.get(path) ?? new Map<string, VendorSums>();
      const v = vendors.get(vk) ?? { label: t.vendor?.trim() || "(거래처 없음)", byMonth: new Map() };
      v.byMonth.set(m, (v.byMonth.get(m) ?? 0) + d);
      vendors.set(vk, v);
      vendorSums.set(path, vendors);
    });
  });

  sums.forEach((byMonth, path) => {
    const current = byMonth.get(month) ?? 0;
    const baseline = median(history.map((h) => byMonth.get(h) ?? 0));
    const diff = current - baseline;
    if (current <= 0 || diff < ANOMALY_RULE.minDiff) return;
    if (baseline > 0 && current < baseline * ANOMALY_RULE.spikeRatio) return;
    if (ignores.accounts.has(ignoredAccountKey(month, path))) return;
    out.set(path, {
      current,
      baseline,
      reason:
        baseline <= 0
          ? `직전 ${history.length}개월엔 거의 없던 지출 — 중앙값 0원 → ${won(current)}원`
          : `직전 ${history.length}개월 중앙값의 ${(current / baseline).toFixed(1)}배 — ${won(baseline)}원 → ${won(current)}원`,
      drivers: driversOf(vendorSums.get(path), month, history, diff),
    });
  });
  return out;
}

/**
 * 계정 증가분을 거래처별로 나눠, 큰 순서로 증가분의 70% 를 설명할 때까지 짚는다.
 * 거래처마다 "평소 월 합(직전 달들 중앙값)" 과 이번 달을 비교한다.
 */
function driversOf(
  vendors: Map<string, VendorSums> | undefined,
  month: string,
  history: string[],
  accountDiff: number,
): Map<string, SpikeDriver> {
  const out = new Map<string, SpikeDriver>();
  if (!vendors) return out;
  const ups = [...vendors.entries()]
    .map(([key, v]) => {
      const current = v.byMonth.get(month) ?? 0;
      const baseline = median(history.map((h) => v.byMonth.get(h) ?? 0));
      return { key, label: v.label, current, baseline, diff: current - baseline };
    })
    .filter((x) => x.diff > 0)
    .sort((a, b) => b.diff - a.diff);
  const totalUp = ups.reduce((s, x) => s + x.diff, 0);
  let covered = 0;
  for (const x of ups) {
    if (out.size >= ANOMALY_RULE.maxDrivers || covered >= totalUp * ANOMALY_RULE.driverCover) break;
    // 계정 증가분의 10% 도 안 되는 거래처는 원인이라 부르기 어렵다 (첫 번째는 예외)
    if (out.size > 0 && x.diff < accountDiff * 0.1) break;
    out.set(x.key, {
      vendor: x.label,
      current: x.current,
      baseline: x.baseline,
      reason:
        x.baseline <= 0
          ? `이 계정 증가의 원인 — 평소엔 없던 거래처, 이번 달 ${won(x.current)}원`
          : `이 계정 증가의 원인 — 평소 월 ${won(x.baseline)}원 → ${won(x.current)}원`,
    });
    covered += x.diff;
  }
  return out;
}

/** 그 달 지출 거래 중 튄 것 (거래 id → 이유) */
export function txFlags(
  txs: FinTransaction[],
  month: string,
  ignores: AnomalyIgnores = NO_IGNORES,
): Map<string, TxFlag[]> {
  const out = new Map<string, TxFlag[]>();
  const past = new Map<string, number[]>();
  let hasHistory = false;
  txs.forEach((t) => {
    const m = t.date?.slice(0, 7);
    if (!m || m >= month) return;
    hasHistory = true;
    if (t.txType !== "지출") return;
    const k = vendorKey(t.vendor);
    if (!k) return;
    const list = past.get(k) ?? [];
    list.push(netAmount(t));
    past.set(k, list);
  });
  if (!hasHistory) return out;

  txs.forEach((t) => {
    if (t.txType !== "지출" || t.date?.slice(0, 7) !== month) return;
    const n = netAmount(t);
    if (n < ANOMALY_RULE.minDiff) return;
    const k = vendorKey(t.vendor);
    if (!k || ignores.vendors.has(k)) return;
    const history = past.get(k);
    if (!history) {
      out.set(t.id, [{ kind: "newVendor", reason: "처음 보는 거래처" }]);
      return;
    }
    if (history.length < 2) return;
    const m = median(history);
    if (m > 0 && n >= m * ANOMALY_RULE.vendorRatio && n - m >= ANOMALY_RULE.minDiff) {
      out.set(t.id, [{ kind: "bigger", reason: `이 거래처 평소(${won(m)}원)의 ${(n / m).toFixed(1)}배` }]);
    }
  });
  return out;
}

/**
 * 계정 경로별 "안에 튄 거래" 건수 — 계정은 안 튀었어도 표에서 찾아 들어가게.
 * scope 는 표가 좁힌 범위(사업부·사업장)와 같게.
 */
export function flaggedTxCounts(
  txs: FinTransaction[],
  month: string,
  scope: Omit<ReportScope, "month"> = {},
  ignores: AnomalyIgnores = NO_IGNORES,
): Map<string, number> {
  const flags = txFlags(txs, month, ignores);
  const out = new Map<string, number>();
  if (flags.size === 0) return out;
  txs.forEach((t) => {
    if (!flags.has(t.id) || !inScope(t, scope)) return;
    accountPaths(t).forEach((p) => out.set(p, (out.get(p) ?? 0) + 1));
  });
  return out;
}
