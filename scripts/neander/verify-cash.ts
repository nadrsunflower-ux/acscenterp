// ============================================================
//  돈의 흐름 검증 — 받을 돈 짝짓기 · 정기 지출 · 결제 알림 메일
// ------------------------------------------------------------
//  ① 규칙 점검 (Firestore 를 타지 않는다)
//       · 부가세 별도 계약은 부가세까지 더한 금액으로 맞춘다
//       · 누가 보냈는지 모르면 같은 금액이라도 확신이 낮다
//       · 수수료만큼 모자란 입금 · 두 회차를 한 번에 보낸 입금
//       · 이미 짝지은 입금은 다시 쓰지 않는다 — 부분 입금은 남은 돈으로 본다
//       · 정기 지출 — 내역이 그날 뒤까지 올라왔을 때만 「빠짐」
//       · 결제 알림 메일 — 읽기 · 같은 결제 두 통 · 카드사 · 단톡방 메모 우선
//  ② 실제 장부 (읽기 전용 — 아무것도 쓰지 않는다)
//
//    npm run finance:verify-cash             (규칙 + 실제 장부)
//    npm run finance:verify-cash -- --no-db  (규칙만)
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { matchReceipts, openInstallments, payerAliases, receiptKey } from "@/lib/neander/finance/receivables";
import { detectRecurring } from "@/lib/neander/finance/recurring";
import { dedupeReads, matchPayMails, parsePayMail } from "@/lib/neander/finance/pay-mail";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import type { FinTransaction, TxType } from "@/lib/neander/finance/types";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

const NO_DB = process.argv.includes("--no-db");
let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

const PMS = [
  { id: "4248", last4: "4248", alias: "신한입금", site: "네안데르", personal: false, kind: "account" },
  { id: "4223", last4: "4223", alias: "신한출금", site: "네안데르", personal: false, kind: "account" },
  { id: "1804", last4: "1804", alias: "(신법)이동주", site: "네안데르", personal: false, kind: "card" },
] as FinPaymentMethodDoc[];

let seq = 0;
const tx = (date: string, vendor: string, last4: string, txType: TxType, amount: number, over: Partial<FinTransaction> = {}): FinTransaction =>
  ({ id: `t${++seq}`, date, vendor, last4, txType, gross: amount, adjust: 0, status: "suggested", dedupHash: `h${seq}`, createdAt: 0, ...over }) as FinTransaction;

const project = (over: Partial<FinProjectDoc>): FinProjectDoc =>
  ({ id: "p1", code: "JJH", name: "제이진옴므", client: "(주)제이진옴므", status: "active", contractAmount: 24_000_000, vatMode: "excluded", revenues: [], lines: [], createdAt: 0, ...over }) as FinProjectDoc;

function receivableChecks() {
  console.log("=== 받을 돈 짝짓기 ===");
  const p = project({
    installments: [
      { id: "i1", kind: "선금", amount: 9_600_000, dueDate: "2026-07-03" },
      { id: "i2", kind: "중도금", amount: 7_200_000, dueDate: "2026-10-31" },
      { id: "i3", kind: "잔금", amount: 7_200_000, dueDate: "2026-11-30" },
    ],
  });
  const open = openInstallments([p], []);
  ok(open[0].due === 10_560_000, "부가세 별도 계약은 부가세까지 더한 금액이 받을 돈", String(open[0].due));

  const named = tx("2026-07-03", "제이진옴므", "4248", "수입", 10_560_000);
  const stranger = tx("2026-07-04", "KB11810579", "4248", "수입", 10_560_000);
  const m1 = matchReceipts({ projects: [p], transactions: [named, stranger], paymentMethods: PMS, today: "2026-10-24" });
  ok(m1[0]?.tx.id === named.id && m1[0].confidence === "high" && m1[0].who === "name", "발주처 이름이 겹치는 같은 금액 입금이 먼저 · 확신 높음", m1.map((m) => `${m.tx.vendor} ${m.confidence}`).join(" | "));
  ok(!m1.some((m) => m.tx.id === stranger.id && m.targets[0].key === m1[0].targets[0].key), "같은 회차를 두 입금에 주지 않는다");

  const fee = tx("2026-10-30", "제이진옴므", "4248", "수입", 7_920_000 - 1_100);
  const m2 = matchReceipts({ projects: [p], transactions: [fee], paymentMethods: PMS, today: "2026-11-01" });
  ok(m2[0]?.amount === "fee" && m2[0].targets[0].installmentId === "i2", "수수료만큼 모자란 입금은 그 회차로", m2[0]?.reasons[0]);

  const both = tx("2026-11-20", "제이진옴므", "4248", "수입", 15_840_000);
  const m3 = matchReceipts({ projects: [p], transactions: [both], paymentMethods: PMS, today: "2026-11-21" });
  ok(m3[0]?.amount === "sum" && m3[0].targets.length === 2, "중도금 + 잔금을 한 번에 보낸 입금", m3[0]?.reasons[0]);

  const unknown = tx("2027-02-20", "홍길동", "4248", "수입", 7_920_000);
  const m4 = matchReceipts({ projects: [p], transactions: [unknown], paymentMethods: PMS, today: "2027-02-21" });
  ok(m4.length === 0, "누가 보냈는지 모르고 받을 날과도 먼 입금은 짝짓지 않는다");
  const near = tx("2026-11-02", "홍길동", "4248", "수입", 7_920_000);
  const m5 = matchReceipts({ projects: [p], transactions: [near], paymentMethods: PMS, today: "2026-11-03" });
  ok(m5[0]?.confidence === "medium", "모르는 이름 · 받을 날 즈음 · 같은 금액 → 확신 중간 (사람이 본다)");

  const card = tx("2026-07-03", "제이진옴므", "1804", "수입", 10_560_000);
  ok(matchReceipts({ projects: [p], transactions: [card], paymentMethods: PMS, today: "2026-07-04" }).length === 0, "카드 쪽 수입(취소 등)은 짝짓지 않는다");

  const store = tx("2026-07-03", "제이진옴므", "4248", "수입", 10_560_000, { status: "confirmed", acctMajor: "매출", acctMid: "B2C매출", acctMinor: "와우판매", bizMajor: "B2C", bizMinor: "와우" });
  ok(matchReceipts({ projects: [p], transactions: [store], paymentMethods: PMS, today: "2026-07-04" }).length === 0, "사람이 매장 매출로 확정한 입금은 짝짓지 않는다");

  // 부분 입금 → 남은 돈
  const part1 = tx("2026-10-25", "제이진옴므", "4248", "수입", 4_000_000, { receiptOf: [receiptKey("p1", "i2")] });
  const open2 = openInstallments([p], [part1]);
  ok(open2.find((o) => o.installmentId === "i2")?.remaining === 3_920_000, "부분 입금을 짝지으면 남은 돈만 받을 돈", String(open2.find((o) => o.installmentId === "i2")?.remaining));
  const rest = tx("2026-11-05", "제이진옴므", "4248", "수입", 3_920_000);
  const m6 = matchReceipts({ projects: [p], transactions: [part1, rest], paymentMethods: PMS, today: "2026-11-06" });
  ok(m6[0]?.tx.id === rest.id && m6[0].targets[0].installmentId === "i2" && m6[0].amount === "exact", "나머지 입금은 남은 돈과 맞춘다");

  // 사람이 짝지은 입금에서 이름을 배운다
  const pp = project({ id: "p2", code: "MRNC", name: "미리내컴", client: "평택시", installments: [{ id: "j1", kind: "잔금", amount: 11_000_000, vatMode: undefined } as never] , vatMode: "included" });
  const learned = tx("2026-09-10", "미리내컴퓨터교육", "4248", "수입", 5_000_000, { receiptOf: [receiptKey("p2", "j1")] });
  ok(payerAliases([pp], [learned]).get("p2")?.has("미리내컴퓨터교육") === true, "짝지은 입금자의 이름을 발주처 별칭으로 배운다");
  const again = tx("2026-10-10", "미리내컴퓨터교육", "4248", "수입", 6_000_000);
  const m7 = matchReceipts({ projects: [pp], transactions: [learned, again], paymentMethods: PMS, today: "2026-10-11" });
  ok(m7[0]?.who === "alias" && m7[0].amount === "exact", "발주처 이름과 달라도 배운 이름이면 확신 높음", m7[0]?.reasons.join(" · "));
}

function recurringChecks() {
  console.log("\n=== 정기 지출 ===");
  const rent = ["03", "04", "05", "06", "07", "08", "09"].map((m) => tx(`2026-${m}-25`, "(주)유니크씨앤", "4223", "지출", 5_170_000, { acctMinor: "임차료" }));
  const filler = tx("2026-10-30", "다른거래", "4223", "지출", 1_000);
  const s1 = detectRecurring([...rent, filler], PMS, "2026-11-02");
  const r = s1.find((s) => s.vendor === "(주)유니크씨앤");
  ok(r?.cadence === "monthly" && r.day === 25 && r.status === "missing" && r.nextDate === "2026-10-25", "10월 25일이 지났고 내역은 30일까지 있는데 없다 → 빠짐", JSON.stringify({ day: r?.day, next: r?.nextDate, status: r?.status }));
  const s2 = detectRecurring(rent, PMS, "2026-11-02");
  ok(s2.find((s) => s.vendor === "(주)유니크씨앤")?.status === "waiting", "내역이 그날까지 안 올라왔으면 빠짐이 아니라 기다리는 중");
  const s3 = detectRecurring(rent, PMS, "2026-10-10");
  ok(s3.find((s) => s.vendor === "(주)유니크씨앤")?.status === "active", "아직 그날이 안 왔으면 예정");
  const jitter = ["05", "06", "07", "08"].map((m, i) => tx(`2026-${m}-${["10", "12", "09", "11"][i]}`, `26${m}고용보험`, "4223", "지출", 90_000 + i * 1_000));
  ok(detectRecurring(jitter, PMS, "2026-08-20").some((s) => s.vendor.endsWith("고용보험")), "이름 뼈대가 같고 날짜 ±2일 · 금액 ±3% 면 한 줄");
  const odd = ["05", "06", "07"].map((m, i) => tx(`2026-${m}-${["03", "19", "28"][i]}`, "쿠팡", "4223", "지출", 30_000));
  ok(!detectRecurring(odd, PMS, "2026-08-01").some((s) => s.vendor === "쿠팡"), "날짜가 들쭉날쭉하면 정기 지출이 아니다");
  const yearly = [tx("2025-03-02", "가비아", "1804", "지출", 33_000), tx("2026-03-03", "가비아", "1804", "지출", 33_000)];
  ok(detectRecurring(yearly, PMS, "2026-04-01").find((s) => s.vendor === "가비아")?.cadence === "yearly", "해마다 나가는 것 (도메인)");
}

function payMailChecks() {
  console.log("\n=== 결제 알림 메일 ===");
  const at = Date.parse("2026-10-07T13:00:00Z");
  const kcp = parsePayMail({
    id: "m1", fromAddress: "noreply@kcp.co.kr", fromName: "NHN KCP 발신전용", date: at,
    subject: "NHN KCP - 사진인화샵의 결제 내역입니다.",
    text: "사진인화샵에서 2026년 10월 07일 15시 49분 결제하신 내역은 다음과 같습니다. 주문자명 홍길동 결제일시 2026년 10월 07일 15시 49분 결제금액 31,500 원 카드종류 신한카드 승인번호 11112222 할부기간 일시불",
  });
  ok(kcp?.pg === "KCP" && kcp.merchant === "사진인화샵" && kcp.amount === 31_500 && kcp.date === "2026-10-07" && kcp.issuer === "신한" && kcp.approvalNo === "11112222", "KCP 알림을 읽는다", JSON.stringify(kcp));
  const toss = parsePayMail({
    id: "m2", fromAddress: "no-reply@bill-mail.tosspayments.com", date: at,
    subject: "주식회사 테스트님, (주)명함가게에서 결제한 내역이 도착했어요.",
    text: "결제가 완료되었어요. 구매상품고급지명함 외 1건결제금액17,900원결제수단신용카드결제카드신한MASTER할부기간일시불결제일시2026/10/07 15:47:48승인번호33334444주문번호x 판매자(주)명함가게[https://x]",
  });
  ok(toss?.merchant === "(주)명함가게" && toss.item === "고급지명함 외 1건" && toss.amount === 17_900 && toss.issuer === "신한", "토스페이먼츠 알림을 읽는다", `${toss?.merchant} / ${toss?.item}`);
  const kicc = parsePayMail({
    id: "m3", fromAddress: "mail@easypay.co.kr", date: at,
    subject: "홍*동님, 쿠팡(주)에서 [신용카드]결제하신 내역입니다.",
    text: "구매자명 홍*동님 상품명 접이식 수레, 검은색 사이트주소 www.coupang.com 결제일시 2026/10/07 22:47 결제수단 신용카드 승인번호 55556666 결제기관 신한 상품금액 29,800원 상점정보 상호 쿠팡(주) 사이트 주소 www.coupang.com",
  });
  ok(kicc?.item === "접이식 수레, 검은색" && kicc.merchant === "쿠팡(주)" && !kicc.buyer, "이지페이 — 품목은 다음 칸 이름에서 자르고, 가려진 이름은 쓰지 않는다", `${kicc?.merchant} / ${kicc?.item}`);
  const coupang = parsePayMail({
    id: "m4", fromAddress: "order@e.coupang.com", date: at, subject: "[쿠팡] 홍*동님 주문하신 내역을 확인해주세요.",
    text: "구매 상세내역 쿠팡가 수량 구매금액 판매자 접이식 수레, 검은색, 1개 37,700원 1 37,700원 이코드롭 결제 정보 상품 가격 37,700원 할인금액 -7,900원 신한카드카드 / 일시불 29,800원 총 결제금액 29,800원",
  });
  ok(coupang?.amount === 29_800 && coupang.issuer === "신한", "쿠팡 주문 메일 — 할인 뒤 총 결제금액", coupang?.item);
  ok(dedupeReads([kicc!, coupang!]).length === 1, "같은 결제의 알림 두 통(이지페이 + 쿠팡 주문)은 하나로");
  const usd = parsePayMail({
    id: "m5", fromAddress: "invoice@stripe.com", fromName: "OpenRouter, Inc", date: at, subject: "Your OpenRouter, Inc receipt",
    text: "Receipt from OpenRouter, Inc Receipt #1 Amount paid $105.50 Date paid October 19, 2026 at 5:07:01 PM UTC Payment method - 3513",
  });
  ok(usd?.currency === "USD" && usd.merchant === "OpenRouter, Inc" && usd.cardLast4 === "3513" && usd.date === "2026-10-19", "해외 영수증 — 보낸 사람이 상점, 카드 뒷자리", JSON.stringify(usd));
  ok(parsePayMail({ id: "x", fromAddress: "news@kcp.co.kr", date: at, subject: "공지", text: "점검 안내" }) === null, "결제 알림이 아니면 읽지 않는다");

  const CARDS = [
    { id: "1804", last4: "1804", alias: "(신법)이동주", site: "", personal: false, kind: "card" },
    { id: "3800", last4: "3800", alias: "(국법)식대", site: "", personal: false, kind: "card" },
    { id: "3513", last4: "3513", alias: "(신법)김주연-신", site: "", personal: false, kind: "card" },
  ] as FinPaymentMethodDoc[];
  const kcpTx = tx("2026-10-07", "KCP_1", "1804", "지출", 31_500);
  const kbTx = tx("2026-10-07", "KCP_1", "3800", "지출", 31_500);
  const m = matchPayMails([kcp!], [kcpTx, kbTx], CARDS);
  ok(m.length === 1 && m[0].txId === kcpTx.id && m[0].memo === "[메일] 사진인화샵", "카드사가 맞는 카드 거래에만 (신한 알림 → 신한 카드)", m[0]?.memo);
  const memoed = { ...kcpTx, cardMemo: "[대표] 사진인화샵 / 사진" } as FinTransaction;
  ok(matchPayMails([kcp!], [memoed], CARDS).length === 0, "단톡방 메모가 이미 있으면 덮지 않는다");
  const twin = tx("2026-10-07", "KCP_2", "1804", "지출", 31_500);
  ok(matchPayMails([kcp!], [kcpTx, twin], CARDS).length === 0, "같은 날 같은 금액 카드 거래가 둘이면 붙이지 않는다");
  const orTx = tx("2026-10-20", "OPENROUTER, INC", "3513", "지출", 148_000);
  ok(matchPayMails([usd!], [orTx], CARDS)[0]?.txId === orTx.id, "해외 영수증은 카드 뒷자리 · 상점 이름 · ±2일로");
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

async function real() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { NEANDER_COL } = await import("@/lib/neander/collections");
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.log("\n(FIREBASE_SERVICE_ACCOUNT_B64 가 없어 실제 장부는 건너뜁니다)");
    return;
  }
  if (getApps().length === 0) {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
  }
  const db = getFirestore();
  const [txSnap, pmSnap, pSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
    db.collection(NEANDER_COL.finProjects).get(),
  ]);
  const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];
  const projects = pSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinProjectDoc[];
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  console.log(`\n=== 실제 장부 (${today}) ===`);
  const open = openInstallments(projects, transactions);
  console.log(`  받을 회차 ${open.length}개 · ${won(open.reduce((s, o) => s + o.remaining, 0))}원`);
  const matches = matchReceipts({ projects, transactions, paymentMethods, today });
  matches.slice(0, 10).forEach((m) =>
    console.log(`    [${m.confidence}${m.ambiguous ? "·후보 여럿" : ""}] ${m.tx.date} ${m.tx.vendor} ${won(m.tx.amount)} → ${m.targets.map((o) => `${o.projectName} ${o.kind}`).join(" + ")} :: ${m.reasons.join(" · ")}`),
  );
  console.log(`  짝지을 후보 ${matches.length}건 (높음 ${matches.filter((m) => m.confidence === "high").length})`);

  const rec = detectRecurring(transactions, paymentMethods, today);
  console.log(`\n  정기 지출 ${rec.length}줄 — 빠짐 ${rec.filter((s) => s.status === "missing").length} · 기다림 ${rec.filter((s) => s.status === "waiting").length} · 예정 ${rec.filter((s) => s.status === "active").length} · 끊김 ${rec.filter((s) => s.status === "ended").length}`);
  rec.filter((s) => s.status !== "ended").slice(0, 14).forEach((s) =>
    console.log(`    ${s.status.padEnd(7)} ${s.cadence === "monthly" ? "매달" : "해마다"} ${String(s.day).padStart(2)}일 ${won(s.amount).padStart(12)}  ${s.vendor} [${s.alias ?? s.last4}] ${s.acctMinor ?? ""} → ${s.nextDate}`),
  );


}

(async () => {
  receivableChecks();
  recurringChecks();
  payMailChecks();
  if (!NO_DB) await real();
  console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
