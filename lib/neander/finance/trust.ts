// ============================================================
//  믿을 범위 — 자동분류를 어디까지 믿고 사람 손을 뺄 것인가
// ------------------------------------------------------------
//  자동분류(classify.ts)는 근거마다 문턱을 손으로 정해 두었다 (같은 거래처 ·
//  같은 계좌 5건 95% 면 확정 …). 문턱은 2026-10 백테스트로 골랐지만, 근거마다
//  **실제로 얼마나 맞는지**는 화면 어디에도 없었다. 그래서 「이름이 닮은 거래」
//  제안이 98% 맞는데도 사람이 199건을 하나씩 눌러 확정했다.
//
//  이 파일이 그 숫자를 잰다.
//
//    칸     근거 꼬리표(EvidenceBasis)를 몇 갈래로 묶은 것 — 근거의 종류 ·
//           일치 비율 · 본 건수 · 유형을 고쳤나 · 사업구분이 갈렸나
//    실측   확정된 장부를 달마다 「그 달 이전 것만 보고」 다시 맞혀 본다
//           (scripts/neander/verify-classify.ts 의 백테스트와 같은 방식).
//           사람이 확인하지 않은 확정(엔진이 붙인 채 아무도 안 고친 행)은
//           정답으로 쓰지 않는다 — 엔진이 엔진을 채점하면 늘 맞는다.
//    관문   실측이 기준(기본 98% · 20건) 이상인 칸의 제안은 확정으로 올리고,
//           기준 아래인 칸의 확정은 제안으로 내린다. 계좌·카드마다 「제안만」 도
//           고를 수 있다 (사람이 그 계좌의 거래를 다 본다).
//    운영   적재 때 엔진이 붙인 칸(engineCell)과 지문(engineSig)이 거래에 남는다.
//           그 뒤 사람이 바꿨는지를 세면 「나중에 사람이 바꾼 비율」 이 된다.
//
//  ⚠️ 관문은 사람이 켠다 (기본 꺼짐). 켜기 전에는 엔진이 예전과 똑같이 돈다.
//     정답을 정하는 것은 사람이고, 기준을 몇으로 둘지도 사람이 정한다.
// ============================================================

import {
  buildVendorIndex,
  classifyOne,
  type EvidenceBasis,
  type EvidenceKind,
  type TrustGate,
} from "./classify";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "./db-types";
import { ENGINE_REASON, engineSigOf } from "./relearn";
import type { FinTransaction, TxType } from "./types";

// ---- 칸 -----------------------------------------------------------

/** 일치 비율의 갈래 */
const ratioBand = (r?: number) =>
  r === undefined ? "" : r >= 0.999 ? "r100" : r >= 0.9 ? "r90" : r >= 0.8 ? "r80" : "rlow";

/** 본 건수의 갈래 */
const countBand = (n?: number) => (n === undefined ? "" : n >= 5 ? "n5" : n >= 3 ? "n3" : "n1");

/**
 * 근거 꼬리표 → 칸 이름. `family:r100:n5` · `history:r90:n5:biz`.
 * 거래에 그대로 남는 값이라 **모양을 바꾸면 운영 실적이 끊긴다** — 늘리기만 한다.
 */
export function trustCellOf(b: EvidenceBasis): string {
  return [b.kind, ratioBand(b.ratio), countBand(b.n), b.typeFixed ? "type" : "", b.bizSplit ? "biz" : ""]
    .filter(Boolean)
    .join(":");
}

export const KIND_LABEL: Record<EvidenceKind, string> = {
  original: "원본 장부에 분류가 있음",
  nonpl: "손익 아님 (분류 불필요)",
  "nonpl-hint": "은행 적요로 판정한 비손익",
  rule: "분류 규칙",
  history: "같은 거래처 · 같은 계좌 (한결같음)",
  "history-weak": "같은 거래처 · 같은 계좌",
  memo: "카드 메모",
  "same-amount": "같은 거래처 · 같은 금액",
  "same-amount-elsewhere": "같은 거래처 · 같은 금액 (다른 계좌까지)",
  elsewhere: "같은 거래처 · 다른 계좌",
  family: "이름이 닮은 거래 · 같은 계좌",
  "family-elsewhere": "이름이 닮은 거래 · 다른 계좌",
  split: "분류가 갈리는 거래처",
  subscription: "구독 규칙",
  hint: "은행·카드 엑셀이 알려준 것",
  kind: "업종 (처음 보는 가맹점)",
  prior: "계좌 기본값 (처음 보는 거래처)",
  none: "근거 없음",
};

const BAND_LABEL: Record<string, string> = {
  r100: "전부 같음",
  r90: "90% 이상 같음",
  r80: "80% 이상 같음",
  rlow: "절반쯤 같음",
  n5: "5건 이상",
  n3: "3~4건",
  n1: "1~2건",
  type: "거래유형 고침",
  biz: "사업구분 갈림",
};

export const kindOfCell = (cell: string) => cell.split(":")[0] as EvidenceKind;

/** 칸을 사람 말로 — 「이름이 닮은 거래 · 같은 계좌」 + 「전부 같음 · 5건 이상」 */
export function trustCellLabel(cell: string): { title: string; detail: string } {
  const [kind, ...bands] = cell.split(":");
  return {
    title: KIND_LABEL[kind as EvidenceKind] ?? kind,
    detail: bands.map((b) => BAND_LABEL[b] ?? b).join(" · "),
  };
}

/**
 * 관문이 손대지 않는 칸. 원본 장부 · 비손익은 볼 것이 없고, 규칙은 사람이 정한 것이며
 * (확정할지는 규칙의 방식이 정한다), 갈리는 거래처 · 근거 없음은 애초에 분류가 없다.
 */
const UNGATED = new Set<EvidenceKind>(["original", "nonpl", "nonpl-hint", "rule", "split", "none"]);
export const isGatedCell = (cell: string) => !UNGATED.has(kindOfCell(cell));

// ---- 설정 (neander_fin_settings/trust) ---------------------------

export interface TrustCellStat {
  /** 이 칸에 떨어진 거래 */
  n: number;
  /** 엔진이 매긴 상태별 */
  confirmed: number;
  suggested: number;
  review: number;
  /** 채점할 수 있었던 것 — 손익 거래는 정답에 사업구분이 있어야 한다 */
  judged: number;
  /** 계정 · 거래유형 · (손익이면) 사업구분까지 맞은 것 */
  right: number;
  /** 계정만 맞은 것 (사업구분을 몰라 채점에서 빠진 것 포함) */
  acctRight: number;
}

export interface TrustMeasure {
  /** 잰 달 (오래된 것부터) */
  months: string[];
  /** 채점한 거래 */
  total: number;
  cells: Record<string, TrustCellStat>;
  /** 잰 시각 */
  at: number;
}

export interface FinTrustSettings {
  /** 실측이 기준 이상인 칸은 확정 · 아래인 칸은 제안 — 꺼 두면 엔진의 문턱 그대로 */
  enabled: boolean;
  /** 0.95 ~ 0.999 */
  threshold: number;
  /** 이만큼 채점한 칸만 믿는다 */
  minSamples: number;
  /** 「제안만」 계좌·카드 (뒷 4자리) */
  suggestOnly: string[];
}

export interface FinTrustDoc extends FinTrustSettings {
  id: string;
  measure?: TrustMeasure;
  updatedAt?: number;
  updatedBy?: string;
}

export const TRUST_DOC_ID = "trust";
export const THRESHOLD_OPTIONS = [0.97, 0.98, 0.99] as const;
export const MIN_SAMPLE_OPTIONS = [20, 30, 50] as const;

export const DEFAULT_TRUST: FinTrustSettings = {
  enabled: false,
  threshold: 0.98,
  minSamples: 20,
  suggestOnly: [],
};

/** 받은 값을 설정으로 다듬는다 — 서버가 저장 직전에 쓴다 */
export function sanitizeTrust(raw: Partial<FinTrustSettings> | undefined | null): FinTrustSettings {
  const r = raw ?? {};
  const threshold = Number(r.threshold);
  const minSamples = Number(r.minSamples);
  return {
    enabled: r.enabled === true,
    threshold: Number.isFinite(threshold) ? Math.min(0.999, Math.max(0.95, threshold)) : DEFAULT_TRUST.threshold,
    minSamples: Number.isFinite(minSamples) ? Math.min(500, Math.max(10, Math.round(minSamples))) : DEFAULT_TRUST.minSamples,
    suggestOnly: [...new Set((Array.isArray(r.suggestOnly) ? r.suggestOnly : []).map(String).filter((s) => /^\w{1,12}$/.test(s)))],
  };
}

export const trustSettingsOf = (doc?: Partial<FinTrustDoc> | null): FinTrustSettings => sanitizeTrust(doc ?? DEFAULT_TRUST);

export const cellPrecision = (s: TrustCellStat) => (s.judged > 0 ? s.right / s.judged : 0);

const pct1 = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;

/** 칸 하나가 관문에서 어떻게 되는가 */
export type CellVerdict = "promote" | "keep" | "demote" | "few" | "ungated";

export function cellVerdict(cell: string, s: TrustCellStat | undefined, set: FinTrustSettings): CellVerdict {
  if (!isGatedCell(cell)) return "ungated";
  if (!s || s.judged < set.minSamples) return "few";
  const p = cellPrecision(s);
  if (p >= set.threshold) return s.suggested > 0 ? "promote" : "keep";
  return s.confirmed > 0 ? "demote" : "keep";
}

/**
 * 이 기준으로 켜면 잰 기간에 무엇이 달라지는가 — 제안 → 확정 몇 건, 확정 → 제안 몇 건,
 * 그리고 올라간 칸에서 틀릴 것으로 보이는 건수 (실측의 틀린 비율 × 올라간 건수).
 */
export function trustEffect(measure: TrustMeasure | undefined, set: FinTrustSettings) {
  let promote = 0;
  let demote = 0;
  let promoteWrong = 0;
  let demoteWrong = 0;
  Object.entries(measure?.cells ?? {}).forEach(([cell, s]) => {
    const v = cellVerdict(cell, s, set);
    const miss = 1 - cellPrecision(s);
    if (v === "promote") {
      promote += s.suggested;
      promoteWrong += s.suggested * miss;
    }
    if (v === "demote") {
      demote += s.confirmed;
      demoteWrong += s.confirmed * miss;
    }
  });
  return { promote, demote, promoteWrong: Math.round(promoteWrong), demoteWrong: Math.round(demoteWrong), total: measure?.total ?? 0 };
}

/**
 * 설정 → 엔진이 쓸 관문. 걸 것이 없으면 undefined (엔진이 예전과 똑같이 돈다).
 */
export function trustGateOf(doc?: Partial<FinTrustDoc> | null): TrustGate | undefined {
  if (!doc) return undefined;
  const set = trustSettingsOf(doc);
  const promote = new Set<string>();
  const demote = new Set<string>();
  const note = new Map<string, string>();
  if (set.enabled && doc.measure) {
    Object.entries(doc.measure.cells ?? {}).forEach(([cell, s]) => {
      if (!isGatedCell(cell) || s.judged < set.minSamples) return;
      const p = cellPrecision(s);
      note.set(cell, `실측 ${pct1(p)} · ${s.judged.toLocaleString("ko-KR")}건`);
      if (p >= set.threshold) promote.add(cell);
      else demote.add(cell);
    });
  }
  const suggestOnly = new Set(set.suggestOnly);
  if (promote.size === 0 && demote.size === 0 && suggestOnly.size === 0) return undefined;
  return { promote, demote, suggestOnly, note, cellOf: trustCellOf };
}

// ---- 실측 (백테스트) ---------------------------------------------

/** 은행 엑셀이 아는 거래유형 — 입금이면 수입, 출금이면 지출 (verify-classify.ts 와 같다) */
export function bankTypeOfTruth(t: Pick<FinTransaction, "txType" | "acctMid" | "acctMinor">): TxType {
  if (t.txType === "수입" || t.txType === "환급") return "수입";
  if (t.txType === "지출" || t.txType === "카드대금결제") return "지출";
  return /입금|회수|수령/.test(`${t.acctMid ?? ""} ${t.acctMinor ?? ""}`) ? "수입" : "지출";
}

const pathOf = (t: { acctMajor?: string; acctMid?: string; acctMinor?: string }) =>
  `${t.acctMajor ?? ""}|${t.acctMid ?? ""}|${t.acctMinor ?? ""}`;
const bizOf = (t: { bizMajor?: string; bizMinor?: string }) => `${t.bizMajor ?? ""}|${t.bizMinor ?? ""}`;
const isPl = (txType: TxType) => txType === "수입" || txType === "지출" || txType === "환급";

/**
 * 엔진이 붙인 채 아무도 안 고친 확정 — 사람이 확인한 적이 없다.
 * 실측의 정답으로 쓰지 않고, 「자동으로 처리됨」 목록이 모은다.
 */
export function isEngineConfirmed(t: FinTransaction): boolean {
  if (t.status !== "confirmed") return false;
  if (t.engineSig) return t.engineSig.startsWith("confirmed|") && t.engineSig === engineSigOf(t);
  return ENGINE_REASON.test(t.classReason ?? "") && t.updatedAt == null;
}

export interface MeasureRefs {
  paymentMethods: FinPaymentMethodDoc[];
  accounts: FinAccountDoc[];
  vendorRules?: FinVendorRuleDoc[];
}

/** 몇 달을 재는가 · 한 달에 확정이 몇 건 이상이어야 재는가 */
const MEASURE_MONTHS = 6;
const MIN_PER_MONTH = 200;

const emptyStat = (): TrustCellStat => ({ n: 0, confirmed: 0, suggested: 0, review: 0, judged: 0, right: 0, acctRight: 0 });

/**
 * 확정된 장부를 달마다 「그 달 이전 것만 보고」 다시 맞혀 칸마다 센다.
 * 은행 엑셀이 아는 것만 준다 — 거래처 · 계좌 · 입출금 방향 · 금액 · 카드 메모 · 업종.
 * 분류 규칙은 주지 않는다 (사람이 앞으로를 정한 것이라 과거를 채점할 수 없다).
 */
export function measureTrust(
  all: FinTransaction[],
  refs: MeasureRefs,
  opts: { months?: number; minPerMonth?: number; now?: number } = {},
): TrustMeasure {
  const learned = all.filter((t) => t.status === "confirmed" && !!t.acctMinor);
  const truth = learned.filter((t) => !isEngineConfirmed(t));
  const perMonth = new Map<string, number>();
  truth.forEach((t) => perMonth.set(t.date.slice(0, 7), (perMonth.get(t.date.slice(0, 7)) ?? 0) + 1));
  const months = [...perMonth.entries()]
    .filter(([, n]) => n >= (opts.minPerMonth ?? MIN_PER_MONTH))
    .map(([m]) => m)
    .sort()
    .slice(-(opts.months ?? MEASURE_MONTHS));

  const cells: Record<string, TrustCellStat> = {};
  let total = 0;
  for (const M of months) {
    // 배우는 쪽은 운영과 같다 — 엔진이 확정한 것도 다음 달의 이력이 된다
    const vendorIndex = buildVendorIndex(learned.filter((t) => t.date.slice(0, 7) < M));
    const ctx = { vendorIndex, vendorRules: refs.vendorRules ?? [], paymentMethods: refs.paymentMethods, accounts: refs.accounts };
    for (const t of truth) {
      if (t.date.slice(0, 7) !== M) continue;
      const bankType = bankTypeOfTruth(t);
      const sug = classifyOne(
        {
          vendor: t.vendor,
          last4: t.last4,
          txType: bankType,
          gross: t.gross,
          adjust: t.adjust,
          site: t.site,
          cardMemo: t.cardMemo,
          vendorKind: t.vendorKind,
        },
        ctx,
      );
      const cell = trustCellOf(sug.basis ?? { kind: "none" });
      const s = (cells[cell] ??= emptyStat());
      total += 1;
      s.n += 1;
      if (sug.status === "confirmed") s.confirmed += 1;
      else if (sug.status === "suggested") s.suggested += 1;
      else s.review += 1;
      const acctRight = !!sug.acctMinor && pathOf(sug) === pathOf(t) && (sug.txType ?? bankType) === t.txType;
      if (acctRight) s.acctRight += 1;
      const judgeable = !isPl(t.txType) || !!t.bizMinor;
      if (!judgeable) continue;
      s.judged += 1;
      if (acctRight && (!isPl(t.txType) || bizOf(sug) === bizOf(t))) s.right += 1;
    }
  }
  return { months, total, cells, at: opts.now ?? Date.now() };
}

// ---- 운영 실적 -----------------------------------------------------

/** 지문(engineSig)에 담긴 엔진의 분류 — status|txType|대|중|소|사업대|사업소 */
export function engineClassOf(sig?: string) {
  if (!sig || sig === "hold") return null;
  const [status, txType, acctMajor, acctMid, acctMinor, bizMajor, bizMinor] = sig.split("|");
  return { status, txType, acctMajor, acctMid, acctMinor, bizMajor, bizMinor };
}

export interface LiveCellStat {
  /** 엔진이 확정한 것 · 그중 나중에 사람이 바꾼 것 */
  auto: number;
  autoChanged: number;
  /** 엔진이 제안한 것 중 사람이 확정한 것 · 그중 제안 그대로 확정한 것 */
  offered: number;
  accepted: number;
}

/**
 * 운영에서 엔진이 붙인 칸 → 사람이 그 뒤에 어떻게 했나. 적재 때 칸과 지문을 남기기
 * 시작한 뒤(2026-10)의 거래만 셀 수 있다 — 그 전 거래에는 칸이 없다.
 */
export function liveTrust(transactions: FinTransaction[]): Map<string, LiveCellStat> {
  const out = new Map<string, LiveCellStat>();
  transactions.forEach((t) => {
    if (!t.engineCell || t.status !== "confirmed") return;
    const eng = engineClassOf(t.engineSig);
    if (!eng) return;
    const s = out.get(t.engineCell) ?? { auto: 0, autoChanged: 0, offered: 0, accepted: 0 };
    const same =
      eng.txType === t.txType &&
      eng.acctMajor === (t.acctMajor ?? "") &&
      eng.acctMid === (t.acctMid ?? "") &&
      eng.acctMinor === (t.acctMinor ?? "") &&
      eng.bizMajor === (t.bizMajor ?? "") &&
      eng.bizMinor === (t.bizMinor ?? "");
    if (eng.status === "confirmed") {
      s.auto += 1;
      if (!same) s.autoChanged += 1;
    } else if (eng.status === "suggested") {
      s.offered += 1;
      if (same) s.accepted += 1;
    }
    out.set(t.engineCell, s);
  });
  return out;
}
