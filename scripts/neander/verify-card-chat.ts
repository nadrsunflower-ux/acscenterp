// ============================================================
//  카톡 카드 메모 검증 — 읽기 · 대조 · 근거
// ------------------------------------------------------------
//  Firestore 를 타지 않는다. 손으로 만든 대화와 거래로 card-chat.ts 와
//  자동분류의 메모 근거(classify.ts)가 지켜야 할 것을 못 박는다.
//
//  전부 실제 단톡방 · 실제 장부에서 나온 모양이다:
//    · 날짜를 본문에 따로 적는다 (`8.4`) — 메시지를 며칠 뒤에 몰아서 올린다
//    · 날짜 앞에 행사 이름을 적는다 (`Siwf`)
//    · 옛 기록은 한 줄에 `/` 로 이어 썼다
//    · 카드 명세서가 없는 달에는 같은 금액의 통장 이체가 대신 걸렸다
//    · 낱말만으로는 못 맞힌다 (여러 달 나오는 아이돌 이름 · 낱말 조각)
//    · 프로젝트 결제는 같은 가게 · 같은 품목이라도 계정이 다르다
//
//    npm run finance:verify-card-chat
//    npm run finance:verify-card-chat -- --file <카톡 내보내기.csv>   (읽은 결과 요약)
// ============================================================

import { readFileSync } from "node:fs";
import {
  looksLikeKakaoChat,
  matchCardChat,
  memoLineOf,
  memoParts,
  parseCardChat,
  planCardChat,
  projectOfMemo,
  waitingForStatement,
} from "@/lib/neander/finance/card-chat";
import { buildVendorIndex, classifyOne, type ClassifyContext } from "@/lib/neander/finance/classify";
import { engineSigOf, isEngineOwned, relearnPending } from "@/lib/neander/finance/relearn";
import type { FinTransaction, TxType } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

// ---- 실제 파일 요약 (선택) ------------------------------------
const fileAt = process.argv.indexOf("--file");
if (fileAt > 0) {
  const entries = parseCardChat(readFileSync(process.argv[fileAt + 1], "utf8"));
  const byMonth = new Map<string, number>();
  entries.forEach((e) => byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + 1));
  console.log(`결제 기록 ${entries.length}건 · ${entries[0]?.date} ~ ${entries[entries.length - 1]?.date}`);
  console.log([...byMonth.entries()].slice(-8).map(([m, n]) => `${m} ${n}건`).join(" · "));
  entries.slice(-5).forEach((e) => console.log(`  ${e.date} ${e.amounts.join("/")}원  ${memoLineOf(e)}`));
  process.exit(0);
}

// ---- 읽기 ----------------------------------------------------
const CSV = [
  "Date,User,Message",
  // 날짜 · 구매처 · 품목 · 금액
  `2026-08-05 10:12:00,"유재영","8.4\n배너공장\n아사히 지디 배너\n17,860"`,
  // 날짜 앞의 꼬리표
  `2026-08-06 09:00:00,"김제연","Siwf\n8.5\n쿠팡\n행사 테이블보\n23,900원"`,
  // 한 줄 양식
  `2025-06-21 18:00:00,"이동주","6월21일/네이버스마트스토어/프린터잉크/44,400원"`,
  // 문자 승인 알림을 붙여 넣은 것
  `2026-09-04 13:40:00,"유재영","[Web발신]\n신한법인승인 4306 09/04 13:32 12,760원 파슬미디어 잔액1,234,567원\n도메인 연장"`,
  // 금액이 없는 메시지 — 버린다
  `2026-08-06 09:01:00,"김제연","사진"`,
  `2026-08-06 09:02:00,"김제연","확인했습니다"`,
  // 해를 넘긴 날짜
  `2026-01-02 09:00:00,"유재영","12.31\n쿠팡\n연말 간식\n15,000"`,
  // 한 메시지에 결제 둘
  `2026-08-07 09:00:00,"유재영","8.7\n애즈랜드\nJIMFF 클리커 스티커 2종\n33,000\n11,000"`,
].join("\n");

console.log("=== 읽기 ===");
ok(looksLikeKakaoChat(CSV.slice(0, 40)), "머리글로 카톡 내보내기를 알아본다");
ok(looksLikeKakaoChat(`﻿${CSV.slice(0, 30)}`), "BOM 이 붙어 있어도 알아본다");
ok(!looksLikeKakaoChat("거래일시,적요,출금,입금"), "은행 CSV 는 아니다");

const entries = parseCardChat(CSV);
const find = (store: string) => entries.find((e) => e.store.includes(store));
ok(entries.length === 6, "금액이 있는 메시지만 기록이 된다", `${entries.length}건`);
{
  const e = find("배너공장");
  ok(e?.date === "2026-08-04" && e.item === "아사히 지디 배너" && e.amounts[0] === 17860,
    "본문의 날짜가 결제일이다 (메시지는 다음 날 올렸다)", e ? `${e.date} ${memoLineOf(e)}` : "");
}
{
  const e = entries.find((x) => x.tag === "Siwf");
  ok(e?.store === "쿠팡" && e.date === "2026-08-05" && memoLineOf(e) === "[Siwf] 쿠팡 / 행사 테이블보",
    "날짜 앞에 적은 줄은 꼬리표다", e ? memoLineOf(e) : "");
}
{
  const e = find("네이버스마트스토어");
  ok(e?.date === "2025-06-21" && e.item === "프린터잉크" && e.amounts[0] === 44400, "한 줄에 / 로 이어 쓴 옛 양식도 읽는다");
}
{
  const e = find("파슬미디어");
  ok(!!e && e.amounts.includes(12760) && !e.amounts.includes(1234567) && !/잔액|승인|Web/.test(memoLineOf(e)),
    "문자 승인 알림의 틀은 걷어낸다 (잔액은 금액이 아니다)", e ? `${memoLineOf(e)} · ${e.amounts.join("/")}` : "못 읽음");
}
ok(entries.find((e) => e.item === "연말 간식")?.date === "2025-12-31", "1월에 적은 12.31 은 작년이다");
ok(find("애즈랜드")?.amounts.join("/") === "33000/11000", "한 메시지에 금액이 둘이면 둘 다 든다");
ok(parseCardChat(CSV).every((e, i) => e.id === entries[i].id), "같은 파일을 다시 읽어도 열쇠가 같다");

// ---- 대조 ----------------------------------------------------
const PMS = [
  { id: "4306", last4: "4306", alias: "(신법)유재영", site: "네안데르", personal: false, kind: "card" },
  { id: "0429", last4: "0429", alias: "토스모임", site: "네안데르", personal: false, kind: "account" },
] as FinPaymentMethodDoc[];

let seq = 0;
const tx = (over: Partial<FinTransaction> & { date: string; vendor: string; gross: number }): FinTransaction =>
  ({
    id: `t${++seq}`, last4: "4306", txType: "지출" as TxType, adjust: 0,
    status: "needs_review", dedupHash: `h${seq}`, createdAt: 0, ...over,
  }) as FinTransaction;

console.log("\n=== 대조 ===");
{
  const banner = tx({ date: "2026-08-04", vendor: "헥토파이낸셜", gross: 17860 });
  const late = tx({ date: "2026-08-07", vendor: "쿠팡(주)", gross: 23900 }); // 이틀 차이
  const tooLate = tx({ date: "2026-09-08", vendor: "KCP", gross: 12760 }); // 나흘 차이
  const transfer = tx({ date: "2026-08-07", vendor: "김제연", gross: 33000, last4: "0429" }); // 통장 이체
  const income = tx({ date: "2025-06-21", vendor: "네이버", gross: 44400, txType: "수입" });
  const res = matchCardChat(entries, [banner, late, tooLate, transfer, income], PMS);
  const of = (t: FinTransaction) => res.matched.find((m) => m.tx.id === t.id)?.entry;
  ok(of(banner)?.store === "배너공장", "금액과 날짜가 같으면 붙는다 — 가맹점 이름은 결제대행사라도");
  ok(of(late)?.store === "쿠팡", "이틀 차이까지는 같은 결제로 본다");
  ok(!of(tooLate), "나흘 차이는 붙이지 않는다");
  ok(!of(transfer), "통장 이체는 금액이 같아도 이름이 다르면 붙이지 않는다 (김제연 ↔ 애즈랜드)");
  ok(!of(income), "들어온 돈에는 붙이지 않는다");

  const named = tx({ date: "2026-08-07", vendor: "애즈랜드", gross: 33000, last4: "0429" });
  ok(matchCardChat(entries, [named], PMS).matched.length === 1, "통장 이체라도 이름이 맞으면 붙는다 (계좌이체로 산 것)");

  // 같은 금액 두 건 — 날짜가 가까운 쪽
  const a = tx({ date: "2026-08-04", vendor: "A", gross: 17860 });
  const b = tx({ date: "2026-08-05", vendor: "B", gross: 17860 });
  const two = matchCardChat(entries, [b, a], PMS);
  ok(two.matched.length === 1 && two.matched[0].tx.id === a.id, "후보가 둘이면 날짜가 같은 쪽에 한 번만 붙는다");

  // 다시 올리기
  const done = { ...banner, cardMemo: "배너공장 / 아사히 지디 배너", cardChatId: of(banner)!.id };
  const again = matchCardChat(entries, [done, tx({ date: "2026-08-04", vendor: "다른곳", gross: 17860 })], PMS);
  ok(again.matched.length === 0 && again.already === 1, "이미 붙은 기록은 다른 거래에 또 붙지 않는다");

  const wait = waitingForStatement(
    res.unmatched,
    [banner, late, tx({ date: "2025-06-01", vendor: "x", gross: 1, last4: "0429" })],
    PMS,
  );
  ok(wait.length === 1 && wait[0].month === "2026-09" && wait[0].count === 1,
    "카드 거래가 없는 최근 달의 짝 없는 기록은 「명세서를 기다린다」 — 오래된 달은 세지 않는다",
    wait.map((w) => `${w.month} ${w.count}`).join(" · "));
  ok(waitingForStatement(res.unmatched, [banner, late, tx({ date: "2026-09-02", vendor: "카드", gross: 1 })], PMS).length === 0,
    "그 달 카드 거래가 장부에 있으면 기다리는 게 아니다 (그냥 짝이 없는 기록)");
}

// ---- 프로젝트 ------------------------------------------------
const PROJECTS = [
  { code: "JIMFF", name: "2026 JIMFF 행사", status: "done" as const },
  { code: "JIMFF-CLICKER", name: "2026 JIMFF 클리커", status: "done" as const },
  { code: "BL", name: "2026 BL 향수", status: "active" as const },
  { code: "금연", name: "금연", status: "active" as const },
  { code: "WOW", name: "2026 와우 리모델링", status: "planning" as const },
  { code: "OLD", name: "지난 행사", status: "cancelled" as const },
];
console.log("\n=== 프로젝트 ===");
{
  const p = (item: string, tag?: string) => projectOfMemo({ store: "애즈랜드", item, tag }, PROJECTS);
  ok(p("JIMFF 엽서") === "JIMFF", "품목에 코드가 적혀 있으면 그 프로젝트");
  ok(p("JIMFF 클리커 스티커 2종") === "JIMFF-CLICKER", "둘이 걸리면 더 길게 맞은 쪽 (JIMFF 클리커)");
  ok(p("스티커", "금연") === "금연", "꼬리표에 적힌 것도 본다");
  ok(p("금연 스티커류") === "금연", "한글 코드는 품목 속에 들어 있으면 된다");
  ok(p("TABLE 커버") === undefined, "영문 코드는 낱말 경계를 본다 (TABLE 속의 BL 이 아니다)");
  ok(p("와우비닐") === undefined, "이름의 한 낱말만으로는 걸지 않는다 (와우 ≠ 와우 리모델링)");
  ok(p("와우 리모델링 페인트") === "WOW", "연도를 뗀 이름이 통째로 있으면 건다");
  ok(p("OLD 재고") === undefined, "취소된 프로젝트는 보지 않는다");
}

// ---- 저장 계획 -----------------------------------------------
console.log("\n=== 저장 계획 ===");
{
  const jimff = tx({ date: "2026-08-07", vendor: "KCP", gross: 33000, classReason: "거래처 「KCP」 과거 이력·규칙 없음" });
  const labeled = tx({ date: "2026-08-04", vendor: "헥토", gross: 17860, projectCode: "FNC", status: "confirmed" });
  const res = matchCardChat(entries, [jimff, labeled], PMS);
  const plan = planCardChat(res.matched, PROJECTS, (t) => (isEngineOwned(t) ? engineSigOf(t) : undefined));
  const up = (t: FinTransaction) => plan.updates.find((u) => u.id === t.id)?.patch;
  ok(up(jimff)?.projectCode === "JIMFF-CLICKER" && !!up(jimff)?.cardMemo, "프로젝트가 비어 있던 거래에는 메모가 가리키는 프로젝트를 넣는다");
  ok(up(labeled)?.projectCode === undefined, "사람이 정해 둔 프로젝트는 건드리지 않는다");
  ok(Object.keys(up(labeled) ?? {}).every((k) => k === "cardMemo" || k === "cardChatId"),
    "확정된 거래는 메모만 붙는다 — 분류는 손대지 않는다", Object.keys(up(labeled) ?? {}).join(","));
  ok(up(jimff)?.engineSig === engineSigOf(jimff), "엔진이 붙인 대기 건은 지문을 남겨 계속 배울 수 있게 한다");
  const un = plan.undo.find((u) => u.id === jimff.id)?.patch;
  ok(un?.cardMemo === null && un?.projectCode === null && plan.undo.find((u) => u.id === labeled.id)?.patch.projectCode === undefined,
    "되돌리기는 메모를 떼고, 이번에 넣은 프로젝트만 지운다");
}

// ---- 근거 ----------------------------------------------------
const acct = (major: string, mid: string, minor: string): FinAccountDoc =>
  ({ id: `${major}|${mid}|${minor}`, lookupKey: "", txType: "지출", major, mid, minor,
     example: "", code: "", vat: "", asset: "", pay: "", branch: "" }) as FinAccountDoc;
const ACCOUNTS = [
  acct("마케팅비", "광고선전", "배너제작비"),
  acct("운영비", "홍대공용운영비", "생카소모품비"),
  acct("제품개발운영비", "공통원자재", "원자재비"),
  acct("운영비", "일반운영비", "일반소모품비"),
];
const BANNER = { acctMajor: "마케팅비", acctMid: "광고선전", acctMinor: "배너제작비", bizMajor: "B2C", bizMinor: "홍대공용" };
const SUPPLY = { acctMajor: "운영비", acctMid: "홍대공용운영비", acctMinor: "생카소모품비", bizMajor: "B2C", bizMinor: "홍대공용" };
const RAW = { acctMajor: "제품개발운영비", acctMid: "공통원자재", acctMinor: "원자재비", bizMajor: "B2B", bizMinor: "조향" };

/** 결제대행사 이름으로 찍힌 확정 거래 — 거래처는 매번 달라서 이름으로는 못 배운다 */
const past = (date: string, memo: string, cls: object, over: Partial<FinTransaction> = {}) =>
  tx({ date, vendor: `PG${++seq}`, gross: 10000 + seq, status: "confirmed", cardMemo: memo, ...cls, ...over });

const ctxOf = (rows: FinTransaction[]): ClassifyContext => ({
  vendorIndex: buildVendorIndex(rows),
  vendorRules: [],
  paymentMethods: PMS,
  accounts: ACCOUNTS,
});
const ask = (rows: FinTransaction[], cardMemo: string, over: object = {}) =>
  classifyOne({ vendor: "KCP_1", last4: "4306", txType: "지출", gross: 17860, cardMemo, ...over }, ctxOf(rows));

console.log("\n=== 자동분류 근거 ===");
{
  const parts = memoParts("[Siwf] 네이버스마트스토어 플떡랜드 / 오해원배너");
  ok(parts?.store === "네이버" && parts.words.includes("배너") && !parts.words.includes("siwf"),
    "메모를 구매처와 품목 낱말로 나눈다 — 네이버 스토어는 한 구매처, 꼬리표는 뺀다", parts?.store);

  const banners = ["03", "04", "05", "06"].map((m) => past(`2026-${m}-10`, `배너공장 / ${m}월 생카 배너`, BANNER));
  const s = ask(banners, "배너공장 / 아사히 지디 배너");
  ok(s.status === "suggested" && s.acctMinor === "배너제작비", "같은 구매처 · 같은 품목 낱말이 한결같으면 제안한다", s.classReason);
  ok(s.bizMinor === "홍대공용", "사업구분도 메모에서 얻는다");
  ok(/^카드 메모 「/.test(s.classReason), "사유가 「카드 메모」 로 시작한다 (계속 배우기가 엔진 것으로 알아본다)");

  const many = Array.from({ length: 12 }, (_, i) => past(`2026-0${(i % 6) + 1}-1${i % 9}`, "배너공장 / 생카 배너", BANNER));
  ok(ask(many, "배너공장 / 배너").status === "suggested", "아무리 한결같아도 확정하지 않는다 — 메모가 엉뚱한 결제에 붙었을 수 있다");

  const oneMonth = ["01", "02", "03", "04"].map((d) => past(`2026-06-${d}`, "배너공장 / 생카 배너", BANNER));
  ok(ask(oneMonth, "배너공장 / 아사히 배너").status === "needs_review", "한 달에 몰린 기록은 믿지 않는다");

  // 낱말만 같고 구매처가 다르다
  ok(ask(banners, "처음가본곳 / 지디 배너").status === "needs_review", "구매처 없이 낱말만으로는 제안하지 않는다");

  // 갈리는 구매처
  const mixed = [
    ...["03", "04", "05"].map((m) => past(`2026-${m}-10`, "쿠팡 / 종이컵", SUPPLY)),
    ...["03", "04", "05"].map((m) => past(`2026-${m}-11`, "쿠팡 / 공병", RAW)),
  ];
  ok(ask(mixed, "쿠팡 / 마스킹테이프").status === "needs_review", "여러 계정으로 갈리는 구매처는 제안하지 않는다");

  // 프로젝트 결제
  const cards = ["03", "04", "05", "06"].map((m) => past(`2026-${m}-10`, "애즈랜드 / 생카 엽서", SUPPLY));
  ok(ask(cards, "애즈랜드 / 시온 엽서").acctMinor === "생카소모품비", "생카 엽서는 소모품으로 제안한다");
  const proj = ask(cards, "애즈랜드 / JIMFF 엽서", { projectCode: "JIMFF" });
  ok(proj.status === "needs_review" && !proj.acctMinor, "프로젝트에 묶인 결제에는 메모 근거를 쓰지 않는다 (JIMFF 엽서는 원자재)");
  const fnc = ["01", "02", "03"].map((d) => past(`2026-07-${d}`, "성원애드피아 / FNC 시향지", RAW, { projectCode: "FNC" }));
  const byProj = ask([...cards, ...fnc], "애즈랜드 / FNC 엽서", { projectCode: "FNC" });
  ok(byProj.bizMajor === "B2B" && byProj.bizMinor === "조향" && byProj.status === "needs_review",
    "프로젝트의 거래가 한 사업부로 모였으면 사업구분은 안다 (계정은 사람이)", byProj.classReason);

  // 같은 거래처 · 같은 계좌가 한결같으면 그쪽이 이긴다
  const steady = ["03", "04", "05", "06", "07"].map((m) =>
    tx({ date: `2026-${m}-01`, vendor: "배너공장", gross: 5000, status: "confirmed", ...RAW }));
  const own = classifyOne(
    { vendor: "배너공장", last4: "4306", txType: "지출", gross: 5000, cardMemo: "배너공장 / 아사히 지디 배너" },
    ctxOf([...banners, ...steady]),
  );
  ok(own.status === "confirmed" && own.acctMinor === "원자재비", "거래처 이력으로 확정되는 건은 메모가 뒤집지 않는다");

  // 원본 장부가 사업구분을 적어 둔 행
  const kept = ask(banners, "배너공장 / 지디 배너", { bizMajor: "B2C", bizMinor: "와우" });
  ok(kept.bizMinor === "와우", "원본 장부가 적어 둔 사업구분은 그대로 둔다");
}

// ---- 계속 배우기 ---------------------------------------------
console.log("\n=== 계속 배우기 ===");
{
  const banners = ["03", "04", "05", "06"].map((m) => past(`2026-${m}-10`, `배너공장 / ${m}월 생카 배너`, BANNER));
  const row = tx({ date: "2026-09-04", vendor: "헥토파이낸셜", gross: 17860, classReason: "거래처 「헥토파이낸셜」 과거 이력·규칙 없음" });
  ok(relearnPending([...banners, row], ctxOf(banners)).length === 0, "메모가 없으면 바뀔 것이 없다");

  // 메모를 붙이면 (지문과 함께 — 저장하면 수정 시각이 찍힌다)
  const attached = { ...row, cardMemo: "배너공장 / 9월 생카 배너", engineSig: engineSigOf(row), updatedAt: 1 } as FinTransaction;
  const plan = relearnPending([...banners, attached], ctxOf(banners), { confirm: false });
  ok(plan.length === 1 && plan[0].status === "suggested" && plan[0].patch.acctMinor === "배너제작비",
    "메모가 붙으면 대기 건에 제안이 붙는다", plan[0]?.patch.classReason ?? "");

  const noSig = { ...row, cardMemo: "배너공장 / 9월 생카 배너", updatedAt: 1 } as FinTransaction;
  ok(relearnPending([...banners, noSig], ctxOf(banners)).length === 0,
    "지문 없이 저장하면 사람이 고친 행으로 보여 다시 배우지 못한다 (그래서 지문을 같이 남긴다)");

  const applied = { ...attached, ...Object.fromEntries(Object.entries(plan[0].patch).filter(([, v]) => v !== null)) } as FinTransaction;
  ok(isEngineOwned(applied) && relearnPending([...banners, applied], ctxOf(banners), { confirm: false }).length === 0,
    "제안이 붙은 뒤에도 엔진 것이고, 같은 장부면 더 바꿀 것이 없다");
}

// 계정은 모르고 사업구분만 아는 건 — 엔진이 채운 사업구분을 다음 번에 「원본 장부 값」 으로 읽으면 안 된다
{
  const fnc = ["01", "02", "03"].map((d) => past(`2026-07-${d}`, "성원애드피아 / FNC 시향지", RAW, { projectCode: "FNC" }));
  const row = tx({ date: "2026-09-04", vendor: "KCP", gross: 9900, projectCode: "FNC", cardMemo: "애즈랜드 / FNC 엽서",
    classReason: "거래처 「KCP」 과거 이력·규칙 없음" });
  const first = relearnPending([...fnc, row], ctxOf(fnc), { confirm: false });
  ok(first.length === 1 && first[0].status === "needs_review" && first[0].patch.bizMinor === "조향" && first[0].patch.acctMinor === null,
    "계정을 모르면 검토필요로 두고 사업구분만 채운다", first[0]?.patch.classReason ?? "");
  const applied = { ...row, ...Object.fromEntries(Object.entries(first[0].patch).filter(([, v]) => v !== null)), updatedAt: 2 } as FinTransaction;
  const second = relearnPending([...fnc, applied], ctxOf(fnc), { confirm: false });
  ok(second.length === 0, "다시 돌려도 그대로다 — 엔진이 채운 사업구분을 사람이 적은 것으로 읽지 않는다",
    second[0]?.patch.classReason ?? "");
}

console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
