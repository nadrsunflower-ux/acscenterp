// ============================================================
//  계속 배우기 검증 — 엔진이 무엇을 다시 분류하고 무엇을 건드리지 않는가
// ------------------------------------------------------------
//  Firestore 를 타지 않는다. 손으로 만든 거래로 relearn.ts 의 약속을 못 박는다.
//
//  지켜야 하는 것은 하나다 — **사람이 고른 것을 엔진이 덮어쓰지 않는다.**
//  대기함에서 계정만 골라 두고 아직 확정을 안 누른 행, 사람이 되돌린 행,
//  어댑터가 적요로 판정한 행은 엔진이 다시 배워도 그대로여야 한다.
//
//    npm run finance:verify-relearn
// ============================================================

import { buildVendorIndex, type ClassifyContext } from "@/lib/neander/finance/classify";
import {
  buildAccountBiz,
  ENGINE_HOLD,
  engineSigOf,
  isEngineOwned,
  relearnPending,
} from "@/lib/neander/finance/relearn";
import type { FinTransaction, TxType } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

const acct = (major: string, mid: string, minor: string, txType: string): FinAccountDoc =>
  ({ id: `${major}|${mid}|${minor}`, lookupKey: "", txType, major, mid, minor,
     example: "", code: "", vat: "", asset: "", pay: "", branch: "" }) as FinAccountDoc;

const ACCOUNTS = [
  acct("운영비", "홍대공용운영비", "임차료", "지출"),
  acct("매출", "B2C매출", "와우판매", "수입"),
  acct("운영비", "일반운영비", "일반소모품비", "지출"),
];
const PMS = [
  { id: "4223", last4: "4223", alias: "신한출금", site: "네안데르", personal: false, kind: "account" },
] as FinPaymentMethodDoc[];

let seq = 0;
const tx = (over: Partial<FinTransaction> & { date: string; vendor: string }): FinTransaction =>
  ({
    id: `t${++seq}`, last4: "4223", txType: "지출" as TxType, gross: 100_000, adjust: 0,
    status: "confirmed", dedupHash: `h${seq}`, createdAt: 0, ...over,
  }) as FinTransaction;

const RENT = { acctMajor: "운영비", acctMid: "홍대공용운영비", acctMinor: "임차료", bizMajor: "B2C", bizMinor: "홍대공용" };

/** 임대인에게 다섯 달 내내 임차료 */
const HISTORY = ["03", "04", "05", "06", "07"].map((m) => tx({ date: `2026-${m}-01`, vendor: "건물주", ...RENT }));

const ctxOf = (rows: FinTransaction[]): ClassifyContext => ({
  vendorIndex: buildVendorIndex(rows),
  vendorRules: [],
  paymentMethods: PMS,
  accounts: ACCOUNTS,
});

const pending = (over: Partial<FinTransaction> = {}): FinTransaction =>
  tx({
    date: "2026-08-01", vendor: "건물주", status: "needs_review",
    classReason: "거래처 「건물주」 과거 이력·규칙 없음", ...over,
  });

console.log("=== 엔진이 손댈 수 있는 행 ===");
{
  const fresh = pending();
  ok(isEngineOwned(fresh), "적재 뒤 아무도 안 고친 행은 엔진 것");

  const edited = pending({ updatedAt: 1, acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비" });
  ok(!isEngineOwned(edited), "사람이 계정을 골라 둔 행(지문 없음 · 수정됨)은 건드리지 않는다");

  const signed = pending({ updatedAt: 1 });
  signed.engineSig = engineSigOf(signed);
  ok(isEngineOwned(signed), "엔진이 지문을 남긴 행은 수정 시각이 있어도 엔진 것");
  ok(!isEngineOwned({ ...signed, bizMajor: "공용", bizMinor: "공용" }), "지문을 남긴 뒤 사람이 사업구분을 고르면 사람 것");
  ok(!isEngineOwned({ ...signed, engineSig: ENGINE_HOLD }), "사람이 되돌린 행은 건드리지 않는다");
  ok(!isEngineOwned(pending({ classReason: "카드대금 결제로 판정 — 손익 대상이 아님 — 확인 필요" })), "어댑터가 판정한 행은 다시 돌리지 않는다");
  ok(!isEngineOwned(pending({ classReason: "사업구분이 비어 있습니다 — 사업부 손익과 공통비 배분에서 빠집니다" })), "사업구분만 비어서 온 행은 엔진 것이 아니다");
  ok(!isEngineOwned(pending({ status: "confirmed" })), "확정된 행은 대상이 아니다");
}

console.log("\n=== 다시 배우기 ===");
{
  const row = pending();
  const all = [...HISTORY, row];
  const plan = relearnPending(all, ctxOf(all));
  ok(plan.length === 1 && plan[0].status === "confirmed" && plan[0].patch.acctMinor === "임차료",
    "이력이 쌓이면 대기함의 행이 스스로 확정된다", plan[0]?.patch.classReason ?? "");
  ok(plan[0]?.patch.bizMinor === "홍대공용", "사업구분도 같이 붙는다");

  const cautious = relearnPending(all, ctxOf(all), { confirm: false });
  ok(cautious[0]?.status === "suggested", "일괄 작업(confirm: false)은 확정하지 않고 제안으로 둔다");

  // 적용한 뒤에는 더 바뀔 것이 없다
  const applied = { ...row, ...Object.fromEntries(Object.entries(cautious[0].patch).filter(([, v]) => v !== null)), updatedAt: 2 } as FinTransaction;
  const again = relearnPending([...HISTORY, applied], ctxOf([...HISTORY, applied]), { confirm: false });
  ok(again.length === 0, "같은 장부면 두 번째에는 바꿀 것이 없다");

  // 사람이 그 행의 계정을 고쳐 두면 엔진은 물러선다
  const humanFixed = { ...applied, acctMid: "일반운영비", acctMinor: "일반소모품비" } as FinTransaction;
  ok(relearnPending([...HISTORY, humanFixed], ctxOf([...HISTORY, humanFixed])).length === 0,
    "사람이 고친 뒤에는 이력이 뭐라 하든 덮어쓰지 않는다");

  // 약한 제안을 거둘 때는 붙어 있던 계정을 비운다 (null 로 보내야 서버에서 지워진다)
  const stale = pending({ vendor: "처음보는곳", status: "suggested", ...RENT, classReason: "거래처 「처음보는곳」 과거 3건 중 34% 가 같은 분류" });
  const cleared = relearnPending([...HISTORY, stale], ctxOf([...HISTORY, stale]));
  ok(cleared.length === 1 && cleared[0].status === "needs_review" && cleared[0].patch.acctMinor === null,
    "근거가 사라진 옛 제안은 거두고 계정을 비운다");
}

console.log("\n=== 계정이 말해 주는 사업구분 ===");
{
  const sales = Array.from({ length: 6 }, (_, i) =>
    tx({ date: `2026-07-0${i + 1}`, vendor: `손님${i}`, txType: "수입", acctMajor: "매출", acctMid: "B2C매출", acctMinor: "와우판매", bizMajor: "B2C", bizMinor: "와우" }));
  const mixed = ["공용", "아이디", "와우", "공용", "홍대공용", "공용"].map((b, i) =>
    tx({ date: `2026-07-1${i}`, vendor: "쿠팡", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비", bizMajor: b === "공용" ? "공용" : "B2C", bizMinor: b }));
  const bizOf = buildAccountBiz([...sales, ...mixed, ...HISTORY]);
  const a = bizOf({ txType: "수입", acctMajor: "매출", acctMid: "B2C매출", acctMinor: "와우판매" });
  ok(a?.bizMajor === "B2C" && a?.bizMinor === "와우", "한 사업부만 쓰는 계정은 사업구분을 안다 (와우판매 → B2C·와우)");
  ok(bizOf({ txType: "지출", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비" }) === undefined,
    "여러 사업부가 쓰는 계정은 모른다고 한다 (일반소모품비)");
  ok(bizOf({ txType: "지출", acctMajor: "운영비", acctMid: "홍대공용운영비", acctMinor: "임차료" })?.bizMinor === "홍대공용",
    "다섯 건이면 안다");
  ok(bizOf({ txType: "지출", acctMajor: "운영비", acctMid: "홍대공용운영비" }) === undefined, "소분류가 없으면 묻지 않는다");
}

console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
