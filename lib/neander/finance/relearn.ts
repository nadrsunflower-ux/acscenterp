// ============================================================
//  계속 배우기 — 확정이 쌓일 때마다 대기함을 다시 분류한다
// ------------------------------------------------------------
//  자동분류(classify.ts)는 확정된 거래로 배운다. 그런데 대기함에 들어온
//  거래는 **올리던 순간의 제안**을 그대로 들고 있다. 그 뒤로 사람이 같은
//  거래처를 열 번 확정해도, 남은 건은 여전히 「이력 없음」 이다.
//
//  이 모듈이 그 틈을 메운다. 사람이 한 건을 확정하면 —
//    · 같은 거래처의 남은 건에 제안이 붙고
//    · 근거가 충분해진 건은 스스로 확정되어 대기함을 떠난다
//  (실측: 여섯 달 2,802건에서 사람이 직접 골라야 하는 건 814 → 736)
//
//  ── 엔진이 손댈 수 있는 행 ──
//  **엔진이 붙이고, 그 뒤로 아무도 안 고친 행**만이다. 사람이 계정만 골라
//  두고 아직 확정을 안 누른 행을 엔진이 덮어쓰면 안 된다.
//    · 사유가 엔진의 것이고 (「거래처 「…」 …」 · 규칙)
//    · 적재 뒤 한 번도 수정된 적이 없거나(updatedAt 없음), 지금 값이 엔진이
//      남긴 지문(engineSig)과 같다
//  사람이 무엇이든 고치면 지문이 어긋나 그 행은 사람 것이 된다. 따로 표시를
//  남길 필요가 없어서 원장·편집기·비서 어디서 고쳐도 지켜진다.
//
//  어댑터가 판정한 행(카드대금 · 계좌간 이동 · 이자입금)은 다시 돌리지 않는다 —
//  엑셀의 적요를 근거로 한 것인데 그 적요 판정은 저장돼 있지 않다.
// ============================================================

import { classifyOne, type ClassifyContext } from "./classify";
import type { ClassificationStatus, FinTransaction, TxType } from "./types";

/** 엔진이 스스로 붙인 사유 */
export const ENGINE_REASON = /^거래처 「|^거래처가 비어 있어 판단 불가|^구독 규칙 「|^분류 규칙 「/;
/** 엔진이 거래유형을 고쳐 둔 행 — 은행이 알려준 원래 유형을 사유에서 되찾는다 */
const TYPE_FIXED = /거래유형을 (\S+) 에서 (\S+) 로/;
/** 사람이 되돌린 행 — 엔진이 다시 손대지 않는다 */
export const ENGINE_HOLD = "hold";

/** 분류에 해당하는 필드 — 엔진은 이것만 읽고 쓴다 */
const CLASS_FIELDS = ["status", "txType", "acctMajor", "acctMid", "acctMinor", "bizMajor", "bizMinor"] as const;
type ClassField = (typeof CLASS_FIELDS)[number];

/** 지문 — 엔진이 붙인 분류 그대로인지 가린다 */
export const engineSigOf = (t: Partial<Record<ClassField, string | undefined>>) =>
  CLASS_FIELDS.map((f) => t[f] ?? "").join("|");

/** 엔진이 다시 배워 고쳐도 되는 행인가 */
export function isEngineOwned(t: FinTransaction): boolean {
  if (t.status === "confirmed") return false;
  if (!ENGINE_REASON.test(t.classReason ?? "")) return false;
  if (t.engineSig) return t.engineSig === engineSigOf(t);
  return t.updatedAt == null;
}

export interface RelearnChange {
  id: string;
  /** 고치기 전의 거래 (되돌리기용) */
  before: FinTransaction;
  /** 서버에 보낼 패치 — 비울 필드는 null */
  patch: Record<ClassField | "classReason" | "engineSig", string | null>;
  status: ClassificationStatus;
}

/**
 * 대기함의 엔진 소유 행을 지금 색인으로 다시 분류하고, **달라진 것만** 돌려준다.
 * 같은 입력이면 같은 결과라 몇 번을 돌려도 된다.
 *
 * `confirm: false` 면 엔진이 확정이라고 해도 제안으로 둔다 (아무도 안 보는
 * 일괄 작업용 — scripts/neander/reclassify-pending.ts).
 */
export function relearnPending(
  transactions: FinTransaction[],
  ctx: ClassifyContext,
  opts: { confirm?: boolean; owned?: (t: FinTransaction) => boolean } = {},
): RelearnChange[] {
  const { confirm = true, owned = isEngineOwned } = opts;
  const out: RelearnChange[] = [];
  transactions.forEach((t) => {
    if (t.status === "confirmed" || !owned(t)) return;
    const fixed = (t.classReason ?? "").match(TYPE_FIXED);
    const bankType = (fixed && fixed[2] === t.txType ? fixed[1] : t.txType) as TxType;
    const sug = classifyOne(
      {
        vendor: t.vendor,
        last4: t.last4,
        txType: bankType,
        gross: t.gross,
        adjust: t.adjust,
        site: t.site,
        // 「검토필요」 행에 남아 있는 대분류·중분류는 엔진이 붙인 게 아니라 원본
        // 장부에 사람이 적어 둔 것이다 (소분류만 비어 있던 행).
        ...(t.status === "needs_review" && !t.acctMinor
          ? { acctMajor: t.acctMajor, acctMid: t.acctMid, bizMajor: t.bizMajor, bizMinor: t.bizMinor }
          : {}),
      },
      ctx,
    );
    const status: ClassificationStatus = sug.status === "confirmed" && !confirm ? "suggested" : sug.status;
    const after = {
      status,
      txType: sug.txType ?? bankType,
      acctMajor: sug.acctMajor,
      acctMid: sug.acctMid,
      acctMinor: sug.acctMinor,
      bizMajor: sug.bizMajor,
      bizMinor: sug.bizMinor,
    };
    const sig = engineSigOf(after);
    const same =
      sig === engineSigOf(t) && (t.classReason ?? "") === sug.classReason && (t.engineSig ?? sig) === sig;
    if (same) return;
    out.push({
      id: t.id,
      before: t,
      status,
      patch: {
        status,
        txType: after.txType,
        acctMajor: after.acctMajor ?? null,
        acctMid: after.acctMid ?? null,
        acctMinor: after.acctMinor ?? null,
        bizMajor: after.bizMajor ?? null,
        bizMinor: after.bizMinor ?? null,
        classReason: sug.classReason,
        engineSig: sig,
      },
    });
  });
  return out;
}

// ---- 계정이 말해 주는 사업구분 --------------------------------

/** 계정 경로 `유형|대|중|소` */
const pathKey = (t: Pick<FinTransaction, "txType" | "acctMajor" | "acctMid" | "acctMinor">) =>
  `${t.txType}|${t.acctMajor ?? ""}|${t.acctMid ?? ""}|${t.acctMinor ?? ""}`;

/** 최근 몇 건을 보고, 몇 건 이상 · 얼마나 쏠려야 「이 계정은 이 사업부」 라고 하는가 */
const BIZ_RECENT = 60;
const BIZ_MIN_COUNT = 5;
const BIZ_MIN_RATIO = 0.95;

export interface AccountBiz {
  bizMajor: string;
  bizMinor: string;
}

/**
 * 계정만 보고 사업구분을 아는 경우 — 「와우판매」 는 B2C·와우, 「임원급여」 는 공용.
 *
 * 확정된 거래에서 그 계정의 최근 60건이 95% 이상 한 사업구분이면 그렇게 본다.
 * 사람이 계정을 고르는 순간 사업구분을 같이 채우는 데 쓴다 — 고른 사람이
 * 보고 바꿀 수 있으므로 제안이지 확정이 아니다.
 * (실측: 2026-07·08 사람이 붙인 1,093건 중 77% 를 채우고 그중 93~97% 가 맞았다.
 *  일반소모품비 · 원자재비처럼 여러 사업부가 쓰는 계정은 채우지 않는다)
 */
export function buildAccountBiz(
  transactions: FinTransaction[],
): (t: Pick<FinTransaction, "txType" | "acctMajor" | "acctMid" | "acctMinor">) => AccountBiz | undefined {
  const seen = new Map<string, string[]>();
  transactions
    .filter((t) => t.status === "confirmed" && !!t.acctMinor && !!t.bizMajor && !!t.bizMinor)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((t) => {
      const k = pathKey(t);
      const list = seen.get(k);
      const v = `${t.bizMajor}|${t.bizMinor}`;
      if (list) list.push(v);
      else seen.set(k, [v]);
    });
  const known = new Map<string, AccountBiz>();
  seen.forEach((list, k) => {
    const rows = list.slice(-BIZ_RECENT);
    if (rows.length < BIZ_MIN_COUNT) return;
    const count = new Map<string, number>();
    rows.forEach((v) => count.set(v, (count.get(v) ?? 0) + 1));
    const [top, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / rows.length < BIZ_MIN_RATIO) return;
    const [bizMajor, bizMinor] = top.split("|");
    known.set(k, { bizMajor, bizMinor });
  });
  return (t) => (t.acctMinor ? known.get(pathKey(t)) : undefined);
}
