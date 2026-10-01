// ============================================================
//  분류 규칙 점검 — DB 를 건드리지 않는다
// ------------------------------------------------------------
//  사람이 정해 둔 「이 거래처는 이 계정」 (class-rules.ts) 이
//    ① 제대로 걸러지고 (없는 계정 · 한 글자 키워드 · 모르는 계좌)
//    ② 맞는 거래에만 걸리고 (띄어쓰기 · 계좌 · 방향 · 금액 · 더 구체적인 규칙)
//    ③ 자동분류에서 이력보다 먼저 쓰이되, 조용히 틀리지 않고
//    ④ 재무 비서 도구가 제안만 하고 (저장하지 않고) 닿는 범위를 알려주고
//    ⑤ 검토 대기함 AI 가 규칙에 걸리는 거래를 모델에 보내지 않는지
//  를 가짜 장부로 확인한다.
//
//    npm run finance:verify-rules
// ============================================================

import {
  matchClassRule,
  normalizeClassRule,
  previewClassRule,
  ruleHits,
  type FinClassRule,
  type FinClassRuleDoc,
} from "@/lib/neander/finance/class-rules";
import { buildVendorIndex, classifyOne } from "@/lib/neander/finance/classify";
import { runTool } from "@/lib/neander/finance/server/ai-tools";
import { suggestByRules } from "@/lib/neander/finance/server/ai-classify";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinTransaction, TxType } from "@/lib/neander/finance/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const acct = (txType: string, major: string, mid: string, minor: string): FinAccountDoc =>
  ({ id: `${txType}|${major}|${mid}|${minor}`, lookupKey: `${txType}|${major}|${mid}|${minor}`, txType, major, mid, minor, example: "", code: "" }) as FinAccountDoc;

const ACCOUNTS: FinAccountDoc[] = [
  acct("지출", "인건비", "복리후생비", "일반식대"),
  acct("지출", "운영비", "소모품비", "사무용품"),
  acct("지출", "인건비", "급여", "직원급여"),
  acct("수입", "매출", "B2C매출", "온라인판매"),
  acct("자금거래", "자금", "가수금", "가수금입금"),
];
const PMS = [
  { id: "4223", last4: "4223", alias: "신한출금", site: "네안데르", kind: "account" },
  { id: "0429", last4: "0429", alias: "토스모임", site: "안다르", kind: "account" },
] as unknown as FinPaymentMethodDoc[];
const refs = { accounts: ACCOUNTS, paymentMethods: PMS };

const FOOD = { keyword: "쿠팡이츠", acctMajor: "인건비", acctMid: "복리후생비", acctMinor: "일반식대", bizMajor: "공용", bizMinor: "공용" };
const mk = (raw: Record<string, unknown>): FinClassRule => {
  const r = normalizeClassRule(raw, refs);
  if (!r.ok) throw new Error(r.error);
  return r.rule;
};
const doc = (rule: FinClassRule, id: string, at = 1): FinClassRuleDoc => ({ ...rule, id, createdAt: at });

let seq = 0;
const tx = (over: Partial<FinTransaction>): FinTransaction =>
  ({
    id: `t${++seq}`,
    date: "2026-08-10",
    last4: "4223",
    txType: "지출",
    vendor: "쿠팡이츠",
    gross: 12000,
    adjust: 0,
    status: "confirmed",
    createdAt: 0,
    ...over,
  }) as FinTransaction;

console.log("① 규칙을 걸러낸다");
{
  const ok = normalizeClassRule(FOOD, refs);
  check("실재하는 계정이면 통과", ok.ok);
  if (ok.ok) {
    check("지출 계정은 「나간 돈」 으로 정해진다", ok.rule.flow === "out" && ok.rule.txType === "지출");
    check("기본은 바로 확정 · 켜짐", ok.rule.mode === "confirm" && ok.rule.active);
  }
  const short = normalizeClassRule({ ...FOOD, keyword: "쿠" }, refs);
  check("한 글자 키워드는 거부", !short.ok, short.ok ? "" : short.error);
  const ghost = normalizeClassRule({ ...FOOD, acctMinor: "없는계정" }, refs);
  check("마스터에 없는 계정은 거부", !ghost.ok, ghost.ok ? "" : ghost.error);
  const noAcct = normalizeClassRule({ keyword: "쿠팡이츠", acctMajor: "인건비" }, refs);
  check("계정 세 단계가 다 있어야 한다", !noAcct.ok);
  const badPm = normalizeClassRule({ ...FOOD, last4: "9999" }, refs);
  check("마스터에 없는 계좌는 거부", !badPm.ok, badPm.ok ? "" : badPm.error);
  const range = normalizeClassRule({ ...FOOD, minAmount: 50000, maxAmount: 1000 }, refs);
  check("거꾸로 된 금액 범위는 거부", !range.ok);
  const income = normalizeClassRule({ keyword: "네이버페이", acctMajor: "매출", acctMid: "B2C매출", acctMinor: "온라인판매", flow: "out" }, refs);
  check("수입 계정은 방향을 다르게 적어 와도 「들어온 돈」", income.ok && income.rule.flow === "in");
  const fund = normalizeClassRule({ keyword: "유재영", acctMajor: "자금", acctMid: "가수금", acctMinor: "가수금입금" }, refs);
  check("자금거래 계정은 이름으로 방향을 안다 (가수금입금 → 들어온 돈)", fund.ok && fund.rule.flow === "in" && fund.rule.txType === "자금거래");
}

console.log("\n② 맞는 거래에만 걸린다");
{
  const food = doc(mk(FOOD), "food");
  check("띄어쓰기·대소문자를 무시한다", ruleHits(food, { vendor: "쿠팡 이츠 (주)", txType: "지출" }));
  check("다른 거래처에는 안 걸린다", !ruleHits(food, { vendor: "쿠팡", txType: "지출" }));
  check("방향이 다르면 안 걸린다 (환불로 들어온 돈)", !ruleHits(food, { vendor: "쿠팡이츠", txType: "수입" }));

  const broad = doc(mk({ ...FOOD, keyword: "쿠팡", acctMajor: "운영비", acctMid: "소모품비", acctMinor: "사무용품" }), "broad");
  const hit = matchClassRule({ vendor: "쿠팡이츠", txType: "지출" }, [broad, food]);
  check("「쿠팡」 보다 「쿠팡이츠」 가 이긴다", hit?.id === "food");
  check("「쿠팡」 만 있으면 그게 걸린다", matchClassRule({ vendor: "쿠팡", txType: "지출" }, [broad, food])?.id === "broad");

  const payroll = doc(mk({ keyword: "유재영", last4: "4223", acctMajor: "인건비", acctMid: "급여", acctMinor: "직원급여", bizMajor: "공용", bizMinor: "공용" }), "payroll");
  check("계좌를 정한 규칙은 그 계좌에서만", !!matchClassRule({ vendor: "유재영", last4: "4223", txType: "지출" }, [payroll]) && !matchClassRule({ vendor: "유재영", last4: "0429", txType: "지출" }, [payroll]));

  const small = doc(mk({ ...FOOD, maxAmount: 30000 }), "small");
  check("금액 범위 안에서만", ruleHits(small, { vendor: "쿠팡이츠", txType: "지출", gross: 12000 }) && !ruleHits(small, { vendor: "쿠팡이츠", txType: "지출", gross: 90000 }));
  check("금액 조건이 있는 쪽이 더 구체적이다", matchClassRule({ vendor: "쿠팡이츠", txType: "지출", gross: 12000 }, [food, small])?.id === "small");
  check("꺼진 규칙은 쓰지 않는다", !matchClassRule({ vendor: "쿠팡이츠", txType: "지출" }, [{ ...food, active: false }]));
}

console.log("\n③ 자동분류 — 이력보다 먼저, 조용히 틀리지 않게");
{
  // 이력: 쿠팡이츠는 지금까지 늘 사무용품으로 확정돼 왔다 (사람이 잘못 굳힌 경우)
  const history = Array.from({ length: 8 }, (_, i) =>
    tx({ date: `2026-0${(i % 4) + 4}-1${i}`, acctMajor: "운영비", acctMid: "소모품비", acctMinor: "사무용품", bizMajor: "공용", bizMinor: "공용" }),
  );
  const vendorIndex = buildVendorIndex(history);
  const base = { vendorIndex, vendorRules: [], paymentMethods: PMS, accounts: ACCOUNTS };
  const input = { vendor: "쿠팡이츠", last4: "4223", txType: "지출" as TxType, gross: 15000, adjust: 0 };

  const before = classifyOne(input, base);
  check("규칙이 없으면 이력대로 (사무용품 확정)", before.acctMinor === "사무용품" && before.status === "confirmed");

  const food = doc(mk(FOOD), "food");
  const after = classifyOne(input, { ...base, classRules: [food] });
  check("규칙이 있으면 이력보다 먼저 (일반식대)", after.acctMinor === "일반식대" && after.acctMid === "복리후생비");
  check("사업구분까지 있으면 바로 확정", after.status === "confirmed" && after.bizMinor === "공용");
  check("근거에 규칙이 적힌다", /^분류 규칙 「쿠팡이츠」/.test(after.classReason), after.classReason);

  const noBiz = doc(mk({ ...FOOD, bizMajor: undefined, bizMinor: undefined }), "nobiz");
  const s1 = classifyOne(input, { ...base, classRules: [noBiz] });
  check("사업구분이 없는 손익 규칙은 확정하지 않는다", s1.status === "suggested" && s1.acctMinor === "일반식대", s1.classReason);

  const soft = doc(mk({ ...FOOD, mode: "suggest" }), "soft");
  check("「제안」 규칙은 제안으로 올린다", classifyOne(input, { ...base, classRules: [soft] }).status === "suggested");

  const stale = { ...food, acctMinor: "사라진계정" };
  const s2 = classifyOne(input, { ...base, classRules: [stale] });
  check("마스터에서 사라진 계정의 규칙은 쓰지 않는다 (이력으로)", s2.acctMinor === "사무용품");

  const s3 = classifyOne({ ...input, acctMajor: "운영비", acctMid: "소모품비" }, { ...base, classRules: [food] });
  check("원본 장부가 적어 둔 대·중분류와 어긋나면 양보한다", s3.acctMinor !== "일반식대");

  const s4 = classifyOne({ ...input, acctMajor: "운영비", acctMid: "소모품비", acctMinor: "사무용품" }, { ...base, classRules: [food] });
  check("원본에 분류가 다 있으면 그대로", s4.acctMinor === "사무용품" && /원본 장부/.test(s4.classReason));

  const fund = doc(mk({ keyword: "유재영", acctMajor: "자금", acctMid: "가수금", acctMinor: "가수금입금" }), "fund");
  const s5 = classifyOne({ vendor: "유재영", last4: "0429", txType: "수입", gross: 4400 }, { ...base, classRules: [fund] });
  check("자금거래 규칙은 거래유형도 고친다 (수입 → 자금거래)", s5.txType === "자금거래" && s5.acctMinor === "가수금입금" && s5.status === "confirmed", s5.classReason);

  const s6 = classifyOne({ vendor: "유재영", last4: "0429", txType: "자금거래", gross: 4400 }, { ...base, classRules: [fund] });
  check("어댑터가 이미 자금거래로 본 거래는 건드리지 않는다", !/분류 규칙/.test(s6.classReason));
}

console.log("\n④ 재무 비서 도구 — 제안만 하고 닿는 범위를 알려준다");
{
  const ledger = [
    tx({ acctMajor: "인건비", acctMid: "복리후생비", acctMinor: "일반식대" }),
    tx({ acctMajor: "운영비", acctMid: "소모품비", acctMinor: "사무용품" }),
    tx({ status: "needs_review" }),
    tx({ vendor: "쿠팡", acctMajor: "운영비", acctMid: "소모품비", acctMinor: "사무용품" }),
  ];
  const ctx = { transactions: ledger, accounts: ACCOUNTS, paymentMethods: PMS, classRules: [] as FinClassRuleDoc[] };
  const out = runTool("propose_class_rule", { ...FOOD, reason: "쿠팡이츠는 직원 식대라서" }, ctx);
  const res = out.result as { ok: boolean; matchesNow?: { total: number; alreadyThisAccount: number; confirmedAsOtherAccount: number; notYetConfirmed: number }; pendingIds?: string[]; willConfirm?: boolean };
  check("제안이 만들어진다 (저장은 아님)", res.ok && out.proposal?.rule?.action === "save" && out.proposal.ids.length === 0);
  check("사유가 규칙 메모로 남는다", out.proposal?.rule?.rule.note === "쿠팡이츠는 직원 식대라서");
  check(
    "지금 장부에서 걸리는 거래를 센다 (3건: 같은 계정 1 · 다른 계정 확정 1 · 미확정 1)",
    res.matchesNow?.total === 3 && res.matchesNow.alreadyThisAccount === 1 && res.matchesNow.confirmedAsOtherAccount === 1 && res.matchesNow.notYetConfirmed === 1,
    JSON.stringify(res.matchesNow),
  );
  check("미확정 거래 id 를 돌려준다 (이어서 고치자고 제안할 수 있게)", res.pendingIds?.length === 1);
  check("바로 확정되는 규칙인지 알려준다", res.willConfirm === true);
  check("사람 말로 된 조건·결과가 실린다", /쿠팡이츠/.test(out.proposal?.rule?.condition ?? "") && /일반식대/.test(out.proposal?.rule?.result ?? ""), `${out.proposal?.rule?.condition} → ${out.proposal?.rule?.result}`);

  const bad = runTool("propose_class_rule", { ...FOOD, acctMinor: "없는계정", reason: "x" }, ctx);
  check("없는 계정이면 제안하지 않는다", !(bad.result as { ok: boolean }).ok && !bad.proposal);
  const noReason = runTool("propose_class_rule", { ...FOOD }, ctx);
  check("사유가 없으면 제안하지 않는다", !(noReason.result as { ok: boolean }).ok && !noReason.proposal);

  const saved = doc(mk(FOOD), "saved-1");
  const ctx2 = { ...ctx, classRules: [saved] };
  const again = runTool("propose_class_rule", { ...FOOD, acctMajor: "운영비", acctMid: "소모품비", acctMinor: "사무용품", reason: "바꿈" }, ctx2);
  check("조건이 같은 규칙이 있으면 새로 만들지 않고 그것을 고친다", again.proposal?.rule?.ruleId === "saved-1");
  const list = runTool("list_class_rules", {}, ctx2).result as { count: number; rules: { ruleId: string }[] };
  check("저장된 규칙을 보여준다", list.count === 1 && list.rules[0].ruleId === "saved-1");
  const del = runTool("propose_class_rule_delete", { ruleId: "saved-1", reason: "이제 안 씀" }, ctx2);
  check("삭제도 제안으로만", del.proposal?.rule?.action === "delete" && del.proposal.rule.ruleId === "saved-1");
  const delBad = runTool("propose_class_rule_delete", { ruleId: "nope", reason: "x" }, ctx2);
  check("없는 규칙은 지우자고 하지 않는다", !delBad.proposal);

  const p = previewClassRule(mk({ ...FOOD, keyword: "쿠팡" }), ledger).preview;
  check("넓은 키워드는 미리보기에서 드러난다 (4건 · 다른 계정 확정 2)", p.total === 4 && p.conflict === 2, `${p.total}건 · 충돌 ${p.conflict}`);
}

console.log("\n⑤ 검토 대기함 AI — 규칙에 걸리면 모델에 묻지 않는다");
{
  const food = doc(mk(FOOD), "food");
  const items = [tx({ id: "a", status: "needs_review" }), tx({ id: "b", vendor: "처음 보는 곳", status: "needs_review" }), tx({ id: "c", txType: "수입", status: "needs_review" })];
  const sug = suggestByRules(items, [food], ACCOUNTS);
  check("규칙에 걸리는 거래만 답한다", sug.length === 1 && sug[0].id === "a" && sug[0].acctMinor === "일반식대" && sug[0].confidence === 1);
  check("근거에 규칙이 적힌다", /^분류 규칙/.test(sug[0]?.reason ?? ""));
  check("규칙이 없으면 아무것도 답하지 않는다", suggestByRules(items, [], ACCOUNTS).length === 0);
}

console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
