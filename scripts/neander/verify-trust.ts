// ============================================================
//  믿을 범위 검증 — 관문 규칙 점검 + 실제 장부로 칸별 실측
// ------------------------------------------------------------
//  ① 규칙 점검 (Firestore 를 타지 않는다)
//     관문이 무엇을 올리고 무엇을 내리고 무엇을 손대지 않는지 못 박는다.
//       · 꺼져 있으면 엔진이 예전과 똑같다
//       · 실측이 기준 위인 칸의 제안만 확정으로 — 사업구분이 없으면 그대로 제안
//       · 실측이 기준 아래인 칸의 확정은 제안으로
//       · 「제안만」 계좌는 규칙이 확정하라고 해도 제안
//       · 원본 장부 · 비손익은 손대지 않는다
//       · 운영 실적 — 엔진이 붙인 뒤 사람이 바꿨는지
//
//  ② 실측 (읽기 전용 — 아무것도 쓰지 않는다)
//     확정된 장부로 칸마다 정확도를 재고, 기준(98% · 20건)이면 관문이 무엇을
//     하는지 보여 준다.
//
//    npm run finance:verify-trust             (규칙 + 실측)
//    npm run finance:verify-trust -- --no-db  (규칙만)
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { buildVendorIndex, classifyOne, type ClassifyContext } from "@/lib/neander/finance/classify";
import { engineSigOf, relearnPending } from "@/lib/neander/finance/relearn";
import {
  cellPrecision,
  cellVerdict,
  DEFAULT_TRUST,
  isEngineConfirmed,
  liveTrust,
  measureTrust,
  sanitizeTrust,
  trustCellLabel,
  trustCellOf,
  trustGateOf,
  type FinTrustDoc,
} from "@/lib/neander/finance/trust";
import type { FinClassRuleDoc } from "@/lib/neander/finance/class-rules";
import { keywordOf, suggestRuleFor } from "@/lib/neander/finance/rule-suggest";
import { diffFields } from "@/lib/neander/finance/tx-log";
import { groupPending } from "@/lib/neander/finance/review-groups";
import type { FinTransaction, TxType } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

const NO_DB = process.argv.includes("--no-db");

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

// ---- ① 규칙 점검 --------------------------------------------

const acct = (major: string, mid: string, minor: string, txType: string): FinAccountDoc =>
  ({ id: `${major}|${mid}|${minor}`, lookupKey: "", txType, major, mid, minor,
     example: "", code: "", vat: "", asset: "", pay: "", branch: "" }) as FinAccountDoc;

const INSURE: [string, string, string] = ["인건비", "사대보험", "고용보험"];
const SALARY: [string, string, string] = ["인건비", "급여", "임원급여"];
const ACCOUNTS = [acct(...INSURE, "지출"), acct(...SALARY, "지출")];
const PMS = [
  { id: "4223", last4: "4223", alias: "신한출금", site: "네안데르", personal: false, kind: "account" },
  { id: "0429", last4: "0429", alias: "토스모임", site: "안다르", personal: false, kind: "account" },
] as FinPaymentMethodDoc[];

let seq = 0;
const tx = (date: string, vendor: string, last4: string, txType: TxType, path: [string, string, string], amount: number,
  biz: [string, string] = ["공용", "공용"], over: Partial<FinTransaction> = {}): FinTransaction =>
  ({
    id: `t${++seq}`, date, vendor, last4, txType,
    acctMajor: path[0], acctMid: path[1], acctMinor: path[2], bizMajor: biz[0], bizMinor: biz[1],
    gross: amount, adjust: 0, status: "confirmed", dedupHash: `h${seq}`, createdAt: 0,
    classReason: "원본 장부에 분류가 있어 그대로 확정", ...over,
  }) as FinTransaction;

const HISTORY: FinTransaction[] = [
  // 달마다 앞머리가 바뀌는 이름 — 「이름이 닮은 거래 · 같은 계좌」 로 제안된다
  ...["03", "04", "05", "06", "07"].map((m) => tx(`2026-${m}-10`, `26${m}고용보험`, "4223", "지출", INSURE, 90_000)),
  // 급여 통장의 유재영 — 한결같다 (확정)
  ...["03", "04", "05", "06", "07"].map((m) => tx(`2026-${m}-25`, "유재영", "4223", "지출", SALARY, 2_300_000)),
];

function gateDoc(over: Partial<FinTrustDoc> = {}): FinTrustDoc {
  const family = trustCellOf({ kind: "family", n: 5, ratio: 1 });
  const history = trustCellOf({ kind: "history", n: 5, ratio: 1 });
  return {
    id: "trust",
    ...DEFAULT_TRUST,
    enabled: true,
    measure: {
      months: ["2026-07"],
      total: 300,
      at: 0,
      cells: {
        [family]: { n: 199, confirmed: 0, suggested: 199, review: 0, judged: 199, right: 197, acctRight: 197 },
        [history]: { n: 60, confirmed: 60, suggested: 0, review: 0, judged: 60, right: 55, acctRight: 56 },
      },
    },
    ...over,
  };
}

function ruleChecks() {
  console.log("=== 규칙 점검 ===");
  const vendorIndex = buildVendorIndex(HISTORY);
  const base: ClassifyContext = { vendorIndex, vendorRules: [], paymentMethods: PMS, accounts: ACCOUNTS };
  const run = (gate: ReturnType<typeof trustGateOf>, over: Partial<Parameters<typeof classifyOne>[0]> = {}, rules: FinClassRuleDoc[] = []) =>
    classifyOne({ vendor: "2608고용보험", last4: "4223", txType: "지출", gross: 90_000, ...over }, { ...base, classRules: rules, trust: gate });

  const plain = run(undefined);
  ok(plain.status === "suggested" && plain.basis?.kind === "family", "관문 없이 — 이름이 닮은 거래는 제안", plain.classReason);
  ok(trustCellOf(plain.basis!) === "family:r100:n5", "칸 이름", trustCellOf(plain.basis!));

  ok(trustGateOf(gateDoc({ enabled: false })) === undefined, "꺼져 있으면 관문이 없다 (엔진 그대로)");
  ok(trustGateOf({ ...gateDoc({ enabled: false }), suggestOnly: ["0429"] }) !== undefined, "꺼져 있어도 「제안만」 계좌는 지킨다");

  const up = run(trustGateOf(gateDoc()));
  ok(up.status === "confirmed" && /자동 확정 \(이 근거의 실측 99\.0% · 199건\)/.test(up.classReason), "기준 위인 칸의 제안은 확정으로", up.classReason);

  const noBiz = classifyOne(
    { vendor: "2608고용보험", last4: "4223", txType: "지출", gross: 90_000 },
    { ...base, vendorIndex: buildVendorIndex(HISTORY.map((t) => (t.vendor?.includes("고용보험") ? { ...t, bizMajor: undefined, bizMinor: undefined } : t))), trust: trustGateOf(gateDoc()) },
  );
  ok(noBiz.status === "suggested", "사업구분이 없으면 올리지 않는다 (월 마감이 다시 잡는다)", noBiz.classReason);

  const strict = run(trustGateOf(gateDoc({ threshold: 0.995 })));
  ok(strict.status === "suggested", "기준을 올리면 같은 칸이 제안에 머문다");

  const few = run(trustGateOf(gateDoc({ minSamples: 200 })));
  ok(few.status === "suggested", "표본이 모자라면 믿지 않는다");

  const down = run(trustGateOf(gateDoc()), { vendor: "유재영", gross: 2_300_000 });
  ok(down.status === "suggested" && /실측이 기준에 못 미쳐/.test(down.classReason), "기준 아래인 칸의 확정은 제안으로 (55/60)", down.classReason);

  const only = run(trustGateOf(gateDoc({ enabled: false, suggestOnly: ["4223"] })), { vendor: "유재영", gross: 2_300_000 });
  ok(only.status === "suggested" && /「제안만」/.test(only.classReason), "「제안만」 계좌는 확정하지 않는다", only.classReason);

  const rule: FinClassRuleDoc = {
    id: "r1", keyword: "유재영", flow: "out", txType: "지출", acctMajor: SALARY[0], acctMid: SALARY[1], acctMinor: SALARY[2],
    bizMajor: "공용", bizMinor: "공용", mode: "confirm", active: true, createdAt: 0,
  };
  const ruled = run(trustGateOf(gateDoc({ suggestOnly: ["4223"] })), { vendor: "유재영", gross: 1 }, [rule]);
  ok(ruled.status === "suggested" && ruled.basis?.kind === "rule", "「제안만」 계좌는 규칙이 확정하라고 해도 제안", ruled.classReason);
  const ruledElse = run(trustGateOf(gateDoc()), { vendor: "유재영", gross: 1 }, [rule]);
  ok(ruledElse.status === "confirmed", "규칙은 실측 관문이 손대지 않는다 (확정할지는 규칙이 정한다)");

  const orig = run(trustGateOf(gateDoc({ suggestOnly: ["4223"] })), { acctMajor: INSURE[0], acctMid: INSURE[1], acctMinor: INSURE[2] });
  ok(orig.status === "confirmed" && orig.basis?.kind === "original", "원본 장부의 분류는 손대지 않는다");

  // 계속 배우기 — 칸을 같이 남긴다
  const pending = { ...tx("2026-08-10", "2608고용보험", "4223", "지출", INSURE, 90_000), status: "suggested", classReason: "거래처 「2608고용보험」 과거 이력·규칙 없음", acctMajor: undefined, acctMid: undefined, acctMinor: undefined, bizMajor: undefined, bizMinor: undefined } as FinTransaction;
  const plan = relearnPending([...HISTORY, pending], { ...base, trust: trustGateOf(gateDoc()) }, { cellOf: trustCellOf });
  ok(plan.length === 1 && plan[0].status === "confirmed" && plan[0].patch.engineCell === "family:r100:n5", "계속 배우기 — 관문을 따르고 칸을 남긴다", plan[0]?.patch.classReason ?? "");

  // 자동으로 처리됨 · 운영 실적
  const auto = { ...pending, status: "confirmed", acctMajor: INSURE[0], acctMid: INSURE[1], acctMinor: INSURE[2], bizMajor: "공용", bizMinor: "공용", classReason: "거래처 「2608고용보험」 … — 자동 확정", engineCell: "family:r100:n5", updatedAt: 1 } as FinTransaction;
  auto.engineSig = engineSigOf(auto);
  ok(isEngineConfirmed(auto), "엔진이 확정한 채 아무도 안 고친 행을 알아본다");
  const changed = { ...auto, acctMinor: "임원급여", acctMid: "급여" } as FinTransaction;
  ok(!isEngineConfirmed(changed), "사람이 고치면 자동 처리 목록에서 빠진다");
  const live = liveTrust([auto, changed]).get("family:r100:n5");
  ok(live?.auto === 2 && live.autoChanged === 1, "운영 실적 — 엔진이 확정한 2건 중 사람이 바꾼 1건", JSON.stringify(live));
  const offered = { ...changed, engineSig: engineSigOf({ ...auto, status: "suggested" }) } as FinTransaction;
  const live2 = liveTrust([offered]).get("family:r100:n5");
  ok(live2?.offered === 1 && live2.accepted === 0, "운영 실적 — 제안을 사람이 다른 계정으로 확정");

  // ---- 확정 → 규칙 제안 ----
  ok(keywordOf("2608고용보험") === "고용보험" && keywordOf("FACEBK *KEV69QZM62") === "facebk", "규칙 키워드 — 날짜·결제 코드를 걷어낸다", `${keywordOf("2608고용보험")} · ${keywordOf("FACEBK *KEV69QZM62")}`);
  const insured = [...HISTORY.filter((t) => t.vendor?.includes("고용보험")), { ...tx("2026-08-10", "2608고용보험", "4223", "지출", INSURE, 90_000), classReason: "검토 대기함에서 확정" }];
  const ctxFor = (rows: FinTransaction[]) => ({ vendorIndex: buildVendorIndex(rows), vendorRules: [], paymentMethods: PMS, accounts: ACCOUNTS, classRules: [] as FinClassRuleDoc[] });
  const sug = suggestRuleFor(insured[insured.length - 1], insured, ctxFor(insured));
  ok(!!sug && sug.rule.keyword === "고용보험" && sug.rule.last4 === "4223" && sug.rule.mode === "confirm", "이름 뼈대로만 맞히던 거래처를 사람이 세 번 확정하면 규칙을 제안", sug ? `${sug.condition} → ${sug.result}` : "없음");
  const salary = HISTORY.filter((t) => t.vendor === "유재영");
  ok(suggestRuleFor(salary[salary.length - 1], salary, ctxFor(salary)) === null, "엔진이 이미 스스로 확정하는 거래처는 규칙을 제안하지 않는다");
  const mixed = [...insured.slice(0, -2), { ...insured[insured.length - 2], acctMinor: "임원급여", acctMid: "급여" }, insured[insured.length - 1]] as FinTransaction[];
  ok(suggestRuleFor(mixed[mixed.length - 1], mixed, ctxFor(mixed)) === null, "최근 확정이 갈리면 제안하지 않는다");
  ok(suggestRuleFor(insured[insured.length - 1], insured, ctxFor(insured), new Set([sug?.key ?? ""])) === null, "「이번엔 아니오」 한 조건은 다시 묻지 않는다");
  const bizMixed = insured.map((t, i) => (i === insured.length - 2 ? { ...t, bizMajor: "B2C", bizMinor: "와우" } : t)) as FinTransaction[];
  const sugBiz = suggestRuleFor(bizMixed[bizMixed.length - 1], bizMixed, ctxFor(bizMixed));
  ok(sugBiz?.rule.mode === "suggest" && !sugBiz.rule.bizMinor, "사업구분이 갈리면 사업구분 없이 「제안」 규칙", sugBiz?.result);

  // ---- 묶음으로 묻기 ----
  const queued = ["01", "02", "03"].map((d) => ({ ...tx(`2026-09-${d}`, `26${d}고용보험`, "4223", "지출", INSURE, 91_000), status: "suggested" }) as FinTransaction);
  const big = { ...tx("2026-09-05", "2609고용보험", "4223", "지출", INSURE, 1_200_000), status: "suggested" } as FinTransaction;
  const lone = { ...tx("2026-09-06", "처음보는곳", "4223", "지출", INSURE, 10_000), status: "needs_review" } as FinTransaction;
  const gs = groupPending([...queued, big, lone], { vendorIndex: buildVendorIndex(HISTORY), vendorRules: [], paymentMethods: PMS, accounts: ACCOUNTS });
  ok(gs.length === 1 && gs[0].rows.length === 3, "이름 뼈대 · 계좌 · 금액대가 같은 것끼리 묶는다 (금액대가 다른 120만원 · 한 건짜리는 빠진다)", gs.map((g) => `${g.vendor} ${g.rows.length}건 ${g.band}`).join(" | "));
  ok(gs[0]?.proposal?.acctMinor === "고용보험", "묶음 안 행들이 같은 제안을 들고 있으면 그 제안이 첫 후보");

  // ---- 변경 이력 ----
  const d = diffFields({ status: "suggested", acctMinor: "고용보험", note: "", extra: { a: "1" } }, { status: "confirmed", acctMinor: "고용보험", note: null, updatedAt: 1 });
  ok(d.length === 1 && d[0].f === "status" && d[0].from === "suggested" && d[0].to === "confirmed", "변경 이력 — 바뀐 칸만 · 빈 글자와 null 은 같다 · 기록하지 않는 칸은 뺀다", JSON.stringify(d));

  const clean = sanitizeTrust({ enabled: true, threshold: 2, minSamples: 1, suggestOnly: ["4223", "4223", "../x"] as string[] });
  ok(clean.threshold === 0.999 && clean.minSamples === 10 && clean.suggestOnly.join() === "4223", "설정 다듬기 — 범위 밖 값 · 중복 · 이상한 번호", JSON.stringify(clean));
}

// ---- ② 실측 ---------------------------------------------------

const won = (n: number) => n.toLocaleString("ko-KR");
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

async function measure() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { NEANDER_COL } = await import("@/lib/neander/collections");
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.log("\n(FIREBASE_SERVICE_ACCOUNT_B64 가 없어 실측은 건너뜁니다)");
    return;
  }
  if (getApps().length === 0) {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
  }
  const db = getFirestore();
  const [txSnap, acctSnap, pmSnap, ruleSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finAccounts).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
    db.collection(NEANDER_COL.finVendorRules).get(),
  ]);
  const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const accounts = acctSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];
  const vendorRules = ruleSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[];

  const t0 = Date.now();
  const m = measureTrust(all, { paymentMethods, accounts, vendorRules });
  console.log(`\n=== 실측 — ${m.months[0]} ~ ${m.months[m.months.length - 1]} · ${won(m.total)}건 · ${Date.now() - t0}ms ===`);
  const set = { ...DEFAULT_TRUST, enabled: true };
  const rows = Object.entries(m.cells).sort((a, b) => b[1].n - a[1].n);
  let promoted = 0;
  let demoted = 0;
  rows.forEach(([cell, s]) => {
    const v = cellVerdict(cell, s, set);
    if (v === "promote") promoted += s.suggested;
    if (v === "demote") demoted += s.confirmed;
    const { title, detail } = trustCellLabel(cell);
    console.log(
      `  ${String(s.n).padStart(5)}건  확정 ${String(s.confirmed).padStart(4)} 제안 ${String(s.suggested).padStart(4)}  ` +
        `채점 ${String(s.judged).padStart(4)} 정확 ${s.judged ? pct(cellPrecision(s)).padStart(6) : "     —"}  ${v.padEnd(7)} ${title}${detail ? ` · ${detail}` : ""}`,
    );
  });
  // 대기함을 묶으면
  const pending = all.filter((t) => t.status !== "confirmed");
  const ctx = { vendorIndex: buildVendorIndex(all), vendorRules, paymentMethods, accounts };
  const gs = groupPending(pending, ctx);
  const inGroups = gs.reduce((n, g) => n + g.rows.length, 0);
  console.log(`\n  대기함 ${won(pending.length)}건 → 묶음 ${won(gs.length)}개에 ${won(inGroups)}건 (질문 수 ${won(pending.length - inGroups + gs.length)}개로)`);
  gs.slice(0, 8).forEach((g) => console.log(`    ${String(g.rows.length).padStart(4)}건  ${g.vendor} [${g.last4 ?? "-"}] ${g.band} — 후보 ${[g.proposal, ...g.candidates].filter(Boolean).map((c) => c!.acctMinor).join(" · ") || "없음"}`));
  // 최근 확정 거래마다 규칙을 제안했을 것인가 (조건 하나에 한 번)
  const seen = new Set<string>();
  let sugs = 0;
  const recent = all.filter((t) => t.status === "confirmed" && (t.date ?? "") >= "2026-08-01").slice(0, 3000);
  const ruleCtx = { ...ctx, classRules: [] as FinClassRuleDoc[] };
  for (const t of recent) {
    const s = suggestRuleFor(t, all, ruleCtx, seen);
    if (!s) continue;
    seen.add(s.key);
    sugs += 1;
    if (sugs <= 6) console.log(`    규칙 제안 예: ${s.condition} → ${s.result} (닿는 ${s.preview.total}건 · 대기함 ${s.follow}건 따라옴)`);
  }
  console.log(`  2026-08 뒤 확정 ${won(recent.length)}건을 다시 눌렀다면 — 규칙 제안 ${won(sugs)}개`);

  const engineAuto = all.filter(isEngineConfirmed).length;
  console.log(`\n  기준 98% · 20건으로 켜면 — 제안 → 확정 ${won(promoted)}건 · 확정 → 제안 ${won(demoted)}건 (잰 기간 기준)`);
  console.log(`  지금 장부에서 엔진이 확정한 채 아무도 안 고친 거래 ${won(engineAuto)}건`);
  ok(m.total > 0 && m.months.length > 0, "실측할 달이 있다");
}

(async () => {
  ruleChecks();
  if (!NO_DB) await measure();
  console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
