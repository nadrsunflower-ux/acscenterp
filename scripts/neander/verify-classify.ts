// ============================================================
//  자동분류 엔진 검증 — 규칙 점검 + 실제 장부 백테스트
// ------------------------------------------------------------
//  ① 규칙 점검 (Firestore 를 타지 않는다)
//     손으로 만든 이력으로 엔진이 무엇을 확정하고 무엇을 넘기는지 못 박는다.
//     전부 실제 장부에서 틀렸던 모양이다:
//       · 한 달에 몰린 3건을 「늘 그렇다」 로 확정했다 (적중률 72%)
//       · 직원 이름으로 **들어온** 돈에 급여 계정을 붙이려 했다
//       · 급여 통장의 「유재영」 과 모임 통장의 「유재영」 을 한 사람 통계로 섞었다
//       · `2608고용보험` 은 `2607고용보험` 을 못 알아봤다
//
//  ② 백테스트 (읽기 전용 — 아무것도 쓰지 않는다)
//     확정된 장부를 달마다 「그 달 이전 것만 보고」 맞혀 본다. 은행 엑셀이
//     아는 것만 준다 — 거래처 · 계좌 · 입출금 방향 · 금액.
//
//       자동 확정의 정확도가 97.5% 아래로 내려가면 실패한다. 엔진을 고쳐서
//       확정이 늘었는데 틀린 확정도 같이 늘었다면 고친 게 아니다.
//
//    npm run finance:verify-classify             (규칙 + 백테스트)
//    npm run finance:verify-classify -- --no-db  (규칙만)
//    npm run finance:verify-classify -- --verbose
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { buildVendorIndex, classCandidates, classifyOne, vendorFamily, type ClassifyInput } from "@/lib/neander/finance/classify";
import type { FinTransaction, TxType } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

const NO_DB = process.argv.includes("--no-db");
const VERBOSE = process.argv.includes("--verbose");
/** 자동 확정의 계정 정확도 하한 */
const MIN_CONFIRM_ACCURACY = 0.975;

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

// ---- ① 규칙 점검 --------------------------------------------

const acct = (major: string, mid: string, minor: string, txType: string): FinAccountDoc =>
  ({ id: `${major}|${mid}|${minor}`, lookupKey: "", txType, major, mid, minor,
     example: "", code: "", vat: "", asset: "", pay: "", branch: "" }) as FinAccountDoc;

const ACCOUNTS: FinAccountDoc[] = [
  acct("인건비", "급여", "임원급여", "지출"),
  acct("운영비", "일반운영비", "구독서비스비", "지출"),
  acct("인건비", "사대보험", "고용보험", "지출"),
  acct("제품개발운영비", "공통원자재", "향료구입비", "지출"),
  acct("매출", "B2C매출", "온라인판매", "수입"),
  acct("매출", "B2C매출", "와우판매", "수입"),
  acct("가수금", "가수금관리", "가수금입금", "자금거래"),
];
const PMS = [
  { id: "4223", last4: "4223", alias: "신한출금", site: "네안데르", personal: false, kind: "account" },
  { id: "0429", last4: "0429", alias: "토스모임", site: "안다르", personal: false, kind: "account" },
  { id: "9279", last4: "9279", alias: "우리온라인", site: "네안데르", personal: false, kind: "account" },
] as FinPaymentMethodDoc[];

let seq = 0;
const tx = (
  date: string,
  vendor: string,
  last4: string,
  txType: TxType,
  path: [string, string, string],
  amount: number,
  biz: [string, string] = ["공용", "공용"],
): FinTransaction =>
  ({
    id: `t${++seq}`, date, vendor, last4, txType,
    acctMajor: path[0], acctMid: path[1], acctMinor: path[2],
    bizMajor: biz[0], bizMinor: biz[1],
    gross: amount, adjust: 0, status: "confirmed", dedupHash: `h${seq}`, createdAt: 0,
  }) as FinTransaction;

const SALARY: [string, string, string] = ["인건비", "급여", "임원급여"];
const SUBS: [string, string, string] = ["운영비", "일반운영비", "구독서비스비"];
const PERFUME: [string, string, string] = ["제품개발운영비", "공통원자재", "향료구입비"];
const ONLINE: [string, string, string] = ["매출", "B2C매출", "온라인판매"];

const HISTORY: FinTransaction[] = [
  // 급여 통장: 유재영은 다섯 달 내내 임원급여
  ...["03", "04", "05", "06", "07"].map((m) => tx(`2026-${m}-10`, "유재영", "4223", "지출", SALARY, 2_300_000)),
  // 모임 통장: 같은 이름이 구독료(7,890원 자동이체)와 향료 대금으로 갈린다
  ...["04", "05", "06"].map((m) => tx(`2026-${m}-01`, "유재영", "0429", "지출", SUBS, 7_890)),
  ...["04", "05", "06", "07"].map((m) => tx(`2026-${m}-20`, "유재영", "0429", "지출", PERFUME, 600_000 + Number(m), ["B2B", "조향"])),
  // 달마다 앞머리가 바뀌는 이름
  ...["05", "06", "07"].map((m) => tx(`2026-${m}-10`, `26${m}고용보험`, "4223", "지출", ["인건비", "사대보험", "고용보험"], 90_000)),
  // 한 달에 몰린 3건 — 행사 준비
  ...["03", "05", "09"].map((d) => tx(`2026-07-${d}`, "반짝상사", "4223", "지출", PERFUME, 50_000)),
  // 한 가지 일만 하는 계좌: 우리온라인 입금은 전부 온라인판매 (입금자는 매번 다르다)
  ...Array.from({ length: 10 }, (_, i) => tx(`2026-07-${String(i + 1).padStart(2, "0")}`, `구매자${i}`, "9279", "수입", ONLINE, 24_000, ["B2C", "온라인"])),
  // 대표 가수금 — 들어온 돈
  ...["05", "06", "07"].map((m) => tx(`2026-${m}-15`, "이동주", "0429", "자금거래", ["가수금", "가수금관리", "가수금입금"], 1_000_000, ["해당없음", "해당없음"])),
];

function ruleChecks() {
  console.log("=== 규칙 점검 ===");
  const index = buildVendorIndex(HISTORY);
  const run = (input: ClassifyInput) =>
    classifyOne(input, { vendorIndex: index, vendorRules: [], paymentMethods: PMS, accounts: ACCOUNTS });

  ok(vendorFamily("2608고용보험") === vendorFamily("2607고용보험"), "이름 뼈대 — 달 앞머리가 달라도 같다");
  ok(vendorFamily("facebk *kev69qzm62") === vendorFamily("facebk *7wb84m9n62"), "이름 뼈대 — 결제 코드가 달라도 같다");
  ok(vendorFamily("쿠팡") !== vendorFamily("쿠팡이츠"), "이름 뼈대 — 다른 가게를 합치지 않는다");

  const a = run({ vendor: "유재영", last4: "4223", txType: "지출", gross: 2_310_000 });
  ok(a.status === "confirmed" && a.acctMinor === "임원급여", "같은 거래처·같은 계좌 5건이 한결같으면 확정", a.classReason);

  const b = run({ vendor: "유재영", last4: "0429", txType: "지출", gross: 7_890 });
  ok(b.status === "suggested" && b.acctMinor === "구독서비스비", "갈리는 거래처는 같은 금액으로 가른다", b.classReason);

  const c = run({ vendor: "유재영", last4: "0429", txType: "지출", gross: 123_456 });
  ok(c.status !== "confirmed" && c.acctMinor !== "임원급여", "다른 계좌의 급여 이력을 끌어오지 않는다", c.classReason);

  const d = run({ vendor: "유재영", last4: "0429", txType: "수입", gross: 1_000_000 });
  ok(d.acctMinor !== "임원급여" && d.acctMinor !== "구독서비스비", "들어온 돈에 지출 계정을 붙이지 않는다", d.classReason);

  const e = run({ vendor: "2608고용보험", last4: "4223", txType: "지출", gross: 90_400 });
  ok(e.status === "suggested" && e.acctMinor === "고용보험", "이름 뼈대로 찾은 것은 제안까지만", e.classReason);

  const f = run({ vendor: "반짝상사", last4: "4223", txType: "지출", gross: 50_000 });
  ok(f.status === "suggested", "한 달에 몰린 3건은 확정하지 않는다", f.classReason);

  const g = run({ vendor: "처음보는사람", last4: "9279", txType: "수입", gross: 48_000 });
  ok(g.status === "suggested" && g.acctMinor === "온라인판매" && g.bizMinor === "온라인", "한 가지 일만 하는 계좌는 기본값을 제안", g.classReason);

  const h = run({ vendor: "처음보는사람", last4: "4223", txType: "지출", gross: 48_000 });
  ok(h.status === "needs_review" && !h.acctMinor, "여러 용도가 섞인 계좌는 기본값을 쓰지 않는다", h.classReason);

  const i = run({ vendor: "이동주", last4: "0429", txType: "수입", gross: 700_000 });
  ok(i.status === "suggested" && i.txType === "자금거래" && i.acctMinor === "가수금입금", "유형을 고쳐야 하면 확정하지 않고 제안", i.classReason);

  const j = run({ vendor: "유재영", last4: "4223", txType: "지출", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "구독서비스비" });
  ok(j.status === "confirmed" && j.acctMinor === "구독서비스비", "원본에 분류가 있으면 그대로 둔다");
}

// ---- ①″ 후보 — 갈리는 거래처에서 사람이 누를 것들 ----------------
console.log("\n=== 후보 (분류가 갈리는 거래처) ===");
{
  const ctx = { vendorIndex: buildVendorIndex(HISTORY), vendorRules: [], paymentMethods: PMS, accounts: ACCOUNTS };
  // 모임 통장의 유재영 — 향료구입비 4건 · 구독서비스비 3건
  const c = classCandidates({ vendor: "유재영", last4: "0429", txType: "지출" }, ctx);
  ok(c?.items.length === 2 && c.items[0].acctMinor === "향료구입비" && c.items[0].count === 4 && c.items[1].acctMinor === "구독서비스비",
    "과거에 쓰인 분류를 많이 쓰인 순으로 돌려준다", c?.items.map((i) => `${i.acctMinor} ${i.count}건`).join(" · "));
  ok(c?.items[0].acctMajor === "제품개발운영비" && c.items[0].acctMid === "공통원자재", "대·중·소분류가 다 들어 있다 (누르면 세 칸이 채워진다)");
  ok(c?.items[0].bizMinor === "조향" && c.items[1].bizMinor === "공용", "그 분류가 늘 한 사업부였으면 사업구분도 같이 준다");
  ok(/토스모임 에서 최근 7건/.test(c?.basis ?? ""), "무엇을 보고 뽑았는지 적는다", c?.basis);
  ok(classCandidates({ vendor: "처음보는곳", last4: "0429", txType: "지출" }, ctx) === null, "이력이 없으면 후보도 없다");
  ok(classCandidates({ vendor: "유재영", last4: "0429", txType: "수입" }, ctx) === null, "나간 돈의 이력을 들어온 돈의 후보로 쓰지 않는다");
  const narrowed = classCandidates({ vendor: "유재영", last4: "0429", txType: "지출", acctMajor: "운영비" }, ctx);
  ok(narrowed?.items.length === 1 && narrowed.items[0].acctMinor === "구독서비스비", "원본 장부가 적어 둔 대분류와 어긋나는 것은 후보에서 뺀다");
  // 급여 통장 — 한결같다 (후보는 하나)
  const one = classCandidates({ vendor: "유재영", last4: "4223", txType: "지출" }, ctx);
  ok(one?.items.length === 1 && one.items[0].acctMinor === "임원급여", "같은 계좌의 이력을 먼저 본다 (급여 통장의 유재영은 급여뿐)");
}

// ---- ①′ 업종 — 처음 보는 가맹점 --------------------------------
console.log("\n=== 업종 (처음 보는 카드 가맹점) ===");
{
  const FOOD: [string, string, string] = ["인건비", "복리후생비", "일반식대"];
  const MEET: [string, string, string] = ["영업비", "대외관계거래관리비", "B2B영업미팅비"];
  const CAR: [string, string, string] = ["운영비", "차량관리비", "차량유지비"];
  const CARD = [{ id: "4528", last4: "4528", alias: "(신법)유재영", site: "네안데르", personal: false, kind: "card" }] as FinPaymentMethodDoc[];
  const ACCTS = [acct(...FOOD, "지출"), acct(...MEET, "지출"), acct(...CAR, "지출"), acct(...SUBS, "지출")];
  const eat = (i: number, name: string, path = FOOD, biz: [string, string] = ["공용", "공용"]) =>
    ({ ...tx(`2026-0${(i % 6) + 1}-1${i % 9}`, name, "4528", "지출", path, 12_000 + i, biz), vendorKind: "음식점" }) as FinTransaction;
  // 식당 여섯 곳 — 이름에 공통된 낱말이 없다
  const diners = ["연길반점", "만게츠", "대박", "정정", "달달나라", "심야식당"].map((n, i) => eat(i, n));
  const ask = (history: FinTransaction[], over: Partial<ClassifyInput>) =>
    classifyOne({ vendor: "카페엔젤(cafe angel)", last4: "4528", txType: "지출", gross: 9_600, ...over },
      { vendorIndex: buildVendorIndex(history), vendorRules: [], paymentMethods: CARD, accounts: ACCTS });

  const a = ask(diners, { vendorKind: "음식점" });
  ok(a.status === "suggested" && a.acctMinor === "일반식대", "그 업종의 다른 가맹점들이 한결같으면 처음 보는 곳에도 제안한다", a.classReason);
  ok(a.bizMinor === "공용", "사업구분은 같은 카드로 같은 계정을 쓴 거래에서 얻는다");
  ok(ask(diners, {}).status === "needs_review", "업종이 없으면 예전처럼 사람에게 넘긴다");
  ok(ask(diners, { vendorKind: "기타" }).status === "needs_review" && ask(diners, { vendorKind: "모름" }).status === "needs_review",
    "「기타」·「모름」 은 근거로 쓰지 않는다");
  ok(ask(diners.slice(0, 4), { vendorKind: "음식점" }).status === "needs_review", "가맹점이 다섯 곳이 안 되면 믿지 않는다");

  // 한 식당을 스무 번 간 것은 가맹점 한 곳이다
  const regular = Array.from({ length: 20 }, (_, i) => eat(i, "단골집"));
  // (이 카드가 식대에만 쓰였다면 계좌 기본값이 대신 답할 수 있다 — 업종 근거가 아닌지만 본다)
  const r = ask(regular, { vendorKind: "음식점" });
  ok(!/업종 「/.test(r.classReason), "거래 건수가 아니라 가맹점 수로 센다 (단골집 스무 번은 한 곳)", r.classReason);

  // 절반이 영업미팅이면 제안하지 않는다
  const mixed = [...diners.slice(0, 3), ...["봄이보리밥", "여의도연탄집", "성광갈매기"].map((n, i) => eat(i, n, MEET, ["B2B", "조향"]))];
  ok(ask(mixed, { vendorKind: "음식점" }).status === "needs_review", "업종 안에서 계정이 갈리면 제안하지 않는다");

  // 아는 가맹점은 자기 이력이 먼저다
  const known = [...diners, ...["03", "04", "05", "06", "07"].map((m) =>
    ({ ...tx(`2026-${m}-02`, "카페엔젤(cafe angel)", "4528", "지출", MEET, 9_600, ["B2B", "조향"]), vendorKind: "카페·베이커리" }) as FinTransaction)];
  const b = ask(known, { vendorKind: "음식점" });
  ok(b.status === "confirmed" && b.acctMinor === "B2B영업미팅비", "이력이 있는 가맹점은 업종보다 자기 이력을 따른다", b.classReason);

  // 사업구분이 카드에서 갈리면 비워 둔다
  const split = diners.map((d, i) => ({ ...d, bizMajor: i % 2 ? "B2C" : "공용", bizMinor: i % 2 ? "와우" : "공용" }));
  const c = ask(split, { vendorKind: "음식점" });
  ok(c.acctMinor === "일반식대" && !c.bizMinor, "사업구분이 갈리면 계정만 제안하고 사업구분은 비워 둔다");
}

// ---- ② 백테스트 ---------------------------------------------

/** 은행 엑셀이 아는 거래유형 — 입금이면 수입, 출금이면 지출 */
function bankType(t: FinTransaction): TxType {
  if (t.txType === "수입" || t.txType === "환급") return "수입";
  if (t.txType === "지출" || t.txType === "카드대금결제") return "지출";
  return /입금|회수|수령/.test(`${t.acctMid ?? ""} ${t.acctMinor ?? ""}`) ? "수입" : "지출";
}

const pathOf = (t: { acctMajor?: string; acctMid?: string; acctMinor?: string }) =>
  `${t.acctMajor ?? ""}|${t.acctMid ?? ""}|${t.acctMinor ?? ""}`;
const bizOf = (t: { bizMajor?: string; bizMinor?: string }) => `${t.bizMajor ?? ""}|${t.bizMinor ?? ""}`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

async function backtest() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { NEANDER_COL } = await import("@/lib/neander/collections");
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.log("\n(FIREBASE_SERVICE_ACCOUNT_B64 가 없어 백테스트는 건너뜁니다)");
    return;
  }
  if (getApps().length === 0) {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
  }
  const db = getFirestore();
  const [txSnap, acctSnap, pmSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finAccounts).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
  ]);
  const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const accounts = acctSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];

  const truth = all.filter((t) => t.status === "confirmed" && !!t.acctMinor);
  // 확정 거래가 충분한 달 가운데 최근 여섯 달
  const perMonth = new Map<string, number>();
  truth.forEach((t) => perMonth.set(t.date.slice(0, 7), (perMonth.get(t.date.slice(0, 7)) ?? 0) + 1));
  const months = [...perMonth.entries()].filter(([, n]) => n >= 200).map(([m]) => m).sort().slice(-6);

  console.log(`\n=== 백테스트 — ${months[0]} ~ ${months[months.length - 1]} (확정 ${truth.length.toLocaleString("ko-KR")}건 중) ===`);
  const c: Record<string, number> = {};
  const add = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
  const wrong: string[] = [];
  const byReason = new Map<string, { n: number; hit: number }>();

  for (const M of months) {
    const index = buildVendorIndex(truth.filter((t) => t.date.slice(0, 7) < M));
    for (const t of truth.filter((x) => x.date.slice(0, 7) === M)) {
      const sug = classifyOne(
        // 카드 메모는 적재할 때 이미 아는 것이라 같이 준다 (단톡방 기록 — card-chat.ts)
        { vendor: t.vendor, last4: t.last4, txType: bankType(t), gross: t.gross, adjust: t.adjust, site: t.site, cardMemo: t.cardMemo, vendorKind: t.vendorKind },
        { vendorIndex: index, vendorRules: [], paymentMethods, accounts },
      );
      const hit = !!sug.acctMinor && pathOf(sug) === pathOf(t);
      add(sug.status);
      add(`${sug.status}.acct`, +hit);
      add(`${sug.status}.biz`, +(hit && bizOf(sug) === bizOf(t)));
      if (sug.status === "confirmed" && !hit) {
        wrong.push(`${M} ${t.vendor} [${t.last4 ?? "-"}] 장부 ${t.acctMinor} ← 엔진 ${sug.acctMinor} :: ${sug.classReason}`);
      }
      const key =
        sug.status +
        " · " +
        sug.classReason
          .replace(/「[^」]*」/g, "「…」")
          .replace(/\([^)]*\)/g, "")
          .replace(/— \S+ (에서|의) /, "— (계좌) $1 ")
          .replace(/[\d,]+/g, "N")
          .slice(0, 44);
      const r = byReason.get(key) ?? { n: 0, hit: 0 };
      r.n += 1;
      r.hit += +hit;
      byReason.set(key, r);
    }
  }

  const N = (c.confirmed ?? 0) + (c.suggested ?? 0) + (c.needs_review ?? 0);
  const confirmed = c.confirmed ?? 0;
  const suggested = c.suggested ?? 0;
  console.log(
    `  확정     ${confirmed}건 (${pct(confirmed, N)}) · 계정 정확 ${pct(c["confirmed.acct"] ?? 0, confirmed)} · 사업구분까지 ${pct(c["confirmed.biz"] ?? 0, confirmed)} · 틀린 확정 ${confirmed - (c["confirmed.acct"] ?? 0)}건`,
  );
  console.log(
    `  제안     ${suggested}건 (${pct(suggested, N)}) · 계정 정확 ${pct(c["suggested.acct"] ?? 0, suggested)} · 사업구분까지 ${pct(c["suggested.biz"] ?? 0, suggested)}`,
  );
  console.log(`  검토필요 ${c.needs_review ?? 0}건 (${pct(c.needs_review ?? 0, N)})`);
  console.log(`  계정까지 맞게 붙인 비율 ${pct((c["confirmed.acct"] ?? 0) + (c["suggested.acct"] ?? 0), N)} (전체 ${N}건)`);

  if (VERBOSE) {
    console.log("\n  근거별 적중률");
    [...byReason.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 20)
      .forEach(([k, v]) => console.log(`    ${String(v.n).padStart(5)}건 ${pct(v.hit, v.n).padStart(6)}  ${k}`));
    console.log("\n  틀린 확정");
    wrong.forEach((w) => console.log(`    ✗ ${w}`));
  }

  ok(
    confirmed > 0 && (c["confirmed.acct"] ?? 0) / confirmed >= MIN_CONFIRM_ACCURACY,
    `자동 확정의 계정 정확도 ${MIN_CONFIRM_ACCURACY * 100}% 이상`,
    pct(c["confirmed.acct"] ?? 0, confirmed),
  );
}

(async () => {
  ruleChecks();
  if (!NO_DB) await backtest();
  console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
