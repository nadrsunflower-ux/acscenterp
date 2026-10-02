// ============================================================
//  가수금 기록장 점검 — DB 를 건드리지 않는다
// ------------------------------------------------------------
//  건별 기록(suspense.ts) 이
//    ① 남은 돈을 맞게 세고 (갚음 · 더 갚음 · 회사 돈은 잔액에서 뺌)
//    ② 사람별로 「회사가 갚을 돈 · 받을 돈」 을 실제 돈 주인 앞으로 모으고
//    ③ 한 번의 입금을 여러 건에 나눠 붙였을 때 안 붙은 몫만 남기고
//    ④ 붙인 거래가 어긋나면 알리고 (지워짐 · 계정 바뀜 · 방향 반대 · 겹쳐 붙임)
//    ⑤ 서버가 새로 붙이는 줄만 막고, 이미 있던 줄은 그대로 두는지
//    ⑥ 저장 전 정리가 빈 줄을 버리고 빠진 값을 잡는지
//  를 가짜 장부로 확인한다.
//
//    npm run finance:verify-suspense
// ============================================================

import {
  allocatedByTx,
  attachCandidates,
  attachTx,
  buildSuspenseBook,
  checkNewLinks,
  nextSuspenseNo,
  roleFlow,
  sanitizeSuspense,
  toInput,
  type FinSuspenseDoc,
} from "@/lib/neander/finance/suspense";
import type { FinTransaction } from "@/lib/neander/finance/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const tx = (id: string, date: string, minor: "가수금입금" | "가수금지급", gross: number, over: Partial<FinTransaction> = {}): FinTransaction => ({
  id,
  date,
  txType: "자금거래",
  acctMajor: "가수금",
  acctMid: "가수금관리",
  acctMinor: minor,
  gross,
  adjust: 0,
  status: "confirmed",
  dedupHash: id,
  createdAt: 1,
  ...over,
});

let seq = 0;
const item = (over: Partial<FinSuspenseDoc>): FinSuspenseDoc => ({
  id: `s${(seq += 1)}`,
  direction: "in",
  amount: 0,
  owner: "가",
  origins: [],
  settles: [],
  createdAt: seq,
  ...over,
});

// 한 번의 입금 1,000만 = 가 500 + 회사 돈 350 + 나 150 (수기 대장 9·10·11번 모양)
const LEDGER: FinTransaction[] = [
  tx("in1", "2025-03-17", "가수금입금", 10_000_000),
  tx("out1", "2025-08-11", "가수금지급", 1_000_000),
  tx("out2", "2025-08-31", "가수금지급", 2_000_000),
  tx("out3", "2025-08-31", "가수금지급", 1_500_000),
  tx("out4", "2025-11-07", "가수금지급", 5_240_000),
  tx("lend1", "2026-08-28", "가수금지급", 7_392_500),
  tx("pay", "2025-03-20", "가수금지급", 300_000, { txType: "지출", acctMajor: "인건비", acctMinor: "직원급여" }),
];
const ITEMS: FinSuspenseDoc[] = [
  item({ id: "a", no: 9, date: "2025-03-18", amount: 5_000_000, owner: "가", nominee: "가",
    origins: [{ txId: "in1", amount: 5_000_000 }],
    settles: [
      { txId: "out1", amount: 1_000_000 },
      { txId: "out2", amount: 2_000_000 },
      { date: "2025-06-12", amount: 1_000_000, method: "현금" },
    ] }),
  item({ id: "b", no: 10, date: "2025-03-18", amount: 3_500_000, owner: "회사 현금", nominee: "가", companyMoney: true,
    origins: [{ txId: "in1", amount: 3_500_000 }] }),
  item({ id: "c", no: 11, date: "2025-03-18", amount: 1_500_000, owner: " 나 ", nominee: "가",
    origins: [{ txId: "in1", amount: 1_500_000 }],
    settles: [{ txId: "out3", amount: 1_500_000 }] }),
  item({ id: "d", no: 1, date: "2023-03-18", amount: 10_000_000, owner: "가" }),
  item({ id: "e", direction: "out", date: "2026-08-28", amount: 7_392_500, owner: "가",
    origins: [{ txId: "lend1", amount: 7_392_500 }] }),
];

console.log("① 남은 돈");
{
  const book = buildSuspenseBook(ITEMS, LEDGER);
  const v = (id: string) => book.views.find((x) => x.item.id === id)!;
  check("갚은 만큼 줄어든다", v("a").settled === 4_000_000 && v("a").remaining === 1_000_000 && v("a").status === "open");
  check("마지막으로 갚은 날은 장부 거래의 날짜도 본다", v("a").lastSettleDate === "2025-08-31", String(v("a").lastSettleDate));
  check("다 갚으면 「다 갚음」", v("c").remaining === 0 && v("c").status === "done");
  check("회사 돈은 남은 돈 0 · 따로 센다", v("b").remaining === 0 && v("b").status === "company"
    && book.totals.companyCount === 1 && book.totals.companyAmount === 3_500_000);
  check("번호 순으로 선다 (번호 없는 건은 뒤)", book.views.map((x) => x.item.id).join("") === "dabce", book.views.map((x) => x.item.id).join(""));
  check("새 번호는 가장 큰 번호 다음", nextSuspenseNo(ITEMS) === 12);

  const over = buildSuspenseBook([item({ id: "o", amount: 1_500_000, settles: [{ date: "2025-09-01", amount: 3_500_000 }] })], []);
  check("적은 금액보다 더 갚으면 알린다", over.views[0].status === "over" && over.views[0].remaining === -2_000_000
    && over.views[0].issues.some((s) => s.includes("더 갚았습니다")));
}

console.log("② 사람별");
{
  const book = buildSuspenseBook(ITEMS, LEDGER);
  const p = (owner: string) => book.people.find((x) => x.owner === owner);
  check("실제 돈 주인 앞으로 모은다 (명의가 아니라)", p("가")?.received === 15_000_000 && p("가")?.repaid === 4_000_000 && p("가")?.payable === 11_000_000);
  check("내준 돈은 회사가 받을 돈", p("가")?.lent === 7_392_500 && p("가")?.receivable === 7_392_500 && p("가")?.net === 11_000_000 - 7_392_500);
  check("이름 앞뒤 공백은 같은 사람", p("나")?.received === 1_500_000 && p("나")?.payable === 0);
  check("회사 돈은 사람 목록에 없다", !book.people.some((x) => x.owner.includes("회사")));
  check("합계", book.totals.payable === 11_000_000 && book.totals.receivable === 7_392_500 && book.totals.openCount === 3,
    JSON.stringify(book.totals));
}

console.log("③ 안 붙은 장부 거래");
{
  const book = buildSuspenseBook(ITEMS, LEDGER);
  check("세 건에 나눠 다 붙인 입금은 안 남는다", !book.unattached.some((u) => u.tx.id === "in1"));
  check("아무 건에도 안 붙은 지급만 남는다", book.unattached.map((u) => u.tx.id).join() === "out4", book.unattached.map((u) => u.tx.id).join());
  check("가수금 계정이 아닌 거래는 후보가 아니다", !book.unattached.some((u) => u.tx.id === "pay"));

  const part = buildSuspenseBook([item({ amount: 4_000_000, origins: [{ txId: "in1", amount: 4_000_000 }] })], LEDGER);
  const u = part.unattached.find((x) => x.tx.id === "in1");
  check("일부만 붙이면 나머지 몫이 남는다", u?.allocated === 4_000_000 && u?.rest === 6_000_000);

  const cands = attachCandidates("out", book.views);
  check("나간 돈 → 받은 돈의 갚음 · 내준 돈의 생긴 거래", cands.map((c) => `${c.view.item.id}:${c.role}`).join() === "d:settle,a:settle,b:settle",
    cands.map((c) => `${c.view.item.id}:${c.role}`).join());
  const inCands = attachCandidates("in", book.views);
  check("들어온 돈 → 내준 돈의 돌려받음 (다 붙은 건은 빠진다)", inCands.map((c) => `${c.view.item.id}:${c.role}`).join() === "d:origin,e:settle",
    inCands.map((c) => `${c.view.item.id}:${c.role}`).join());

  const va = book.views.find((x) => x.item.id === "a")!;
  const next = attachTx(va, "settle", book.unattached[0]);
  check("붙일 때 금액은 건의 남은 돈까지만", next.settles.at(-1)?.txId === "out4" && next.settles.at(-1)?.amount === 1_000_000);
  check("방향 — 받은 돈은 생길 때 들어오고 갚을 때 나간다", roleFlow("in", "origin") === "in" && roleFlow("in", "settle") === "out"
    && roleFlow("out", "origin") === "out" && roleFlow("out", "settle") === "in");
}

console.log("④ 어긋남");
{
  const gone = buildSuspenseBook([item({ amount: 1_000_000, origins: [{ txId: "없음", amount: 1_000_000 }] })], LEDGER);
  check("지워진 거래", gone.views[0].issues.some((s) => s.includes("원장에 없습니다")));
  const moved = buildSuspenseBook([item({ amount: 300_000, settles: [{ txId: "pay", amount: 300_000 }] })], LEDGER);
  check("가수금 계정을 벗어난 거래", moved.views[0].issues.some((s) => s.includes("가수금 계정이 아닙니다")));
  const wrong = buildSuspenseBook([item({ amount: 1_000_000, origins: [{ txId: "out1", amount: 1_000_000 }] })], LEDGER);
  check("방향이 반대인 거래", wrong.views[0].issues.some((s) => s.includes("방향")));
  const twice = buildSuspenseBook([
    item({ id: "x", amount: 1_000_000, settles: [{ txId: "out1", amount: 1_000_000 }] }),
    item({ id: "y", amount: 1_000_000, settles: [{ txId: "out1", amount: 1_000_000 }] }),
  ], LEDGER);
  check("한 거래를 두 건이 겹쳐 붙임", twice.views.every((v) => v.issues.some((s) => s.includes("더 붙어 있습니다"))) && twice.totals.issueCount === 2);
  check("멀쩡한 장부는 어긋남 0", buildSuspenseBook(ITEMS, LEDGER).totals.issueCount === 0);
}

console.log("⑤ 저장 전 장부 대조");
{
  const txById = new Map(LEDGER.map((t) => [t.id, t]));
  const others = (skip: string) => allocatedByTx(ITEMS.filter((x) => x.id !== skip));
  const a = ITEMS[0];
  check("그대로 다시 저장하면 통과", checkNewLinks(toInput(a), a, txById, others("a")) === null);
  const more = { ...toInput(a), settles: [...a.settles, { txId: "out4", amount: 1_000_000 }] };
  check("남은 몫 안에서 새로 붙이면 통과", checkNewLinks(more, a, txById, others("a")) === null);
  const dup = { ...toInput(ITEMS[3]), settles: [{ txId: "out3", amount: 1_500_000 }] };
  check("다른 건이 다 쓴 거래는 막는다", (checkNewLinks(dup, ITEMS[3], txById, others("d")) ?? "").includes("남은 몫은 0원"),
    String(checkNewLinks(dup, ITEMS[3], txById, others("d"))));
  const rev = { ...toInput(ITEMS[3]), origins: [{ txId: "out4", amount: 1_000_000 }] };
  check("방향이 반대면 막는다", (checkNewLinks(rev, ITEMS[3], txById, others("d")) ?? "").includes("방향이 반대"));
  const non = { ...toInput(ITEMS[3]), settles: [{ txId: "pay", amount: 300_000 }] };
  check("가수금 계정이 아니면 막는다", (checkNewLinks(non, ITEMS[3], txById, others("d")) ?? "").includes("가수금 계정이 아닙니다"));
  const ghost = { ...toInput(ITEMS[3]), settles: [{ txId: "없음", amount: 1 }] };
  check("없는 거래는 막는다", (checkNewLinks(ghost, ITEMS[3], txById, others("d")) ?? "").includes("원장에 없습니다"));
  // 붙여 둔 거래가 나중에 다른 계정으로 옮겨졌어도 비고는 고칠 수 있어야 한다
  const stale = item({ id: "z", amount: 300_000, settles: [{ txId: "pay", amount: 300_000 }] });
  check("이미 있던 줄은 다시 따지지 않는다", checkNewLinks({ ...toInput(stale), note: "고침" } as never, stale, txById, new Map()) === null);
}

console.log("⑥ 저장 전 정리");
{
  const ok = sanitizeSuspense({
    direction: "in", amount: 5_000_000.4, owner: "  가   나 ", nominee: "", date: "2025-03-18",
    origins: [{ txId: "in1", amount: 3_000_000 }, { txId: "in1", amount: 2_000_000 }, { txId: "", amount: 9 }],
    settles: [{ amount: 0 }, { date: "2025-09-01", amount: 1_000_000, method: " 4223 > 가 " }, { txId: "out1", amount: 1_000_000 }],
  });
  check("빈 줄은 버리고 같은 거래는 합친다", ok.ok && ok.value.origins.length === 1 && ok.value.origins[0].amount === 5_000_000
    && ok.value.settles.length === 2 && ok.value.settles[0].method === "4223 > 가");
  check("이름의 공백을 정리하고 빈 칸은 넣지 않는다", ok.ok && ok.value.owner === "가 나" && !("nominee" in ok.value) && ok.value.amount === 5_000_000);
  const bad = (raw: Parameters<typeof sanitizeSuspense>[0]) => { const r = sanitizeSuspense(raw); return r.ok ? "" : r.error; };
  check("금액이 없으면 거절", bad({ owner: "가" }).includes("금액"));
  check("돈 주인이 없으면 거절", bad({ amount: 1 }).includes("돈 주인"));
  check("날짜 형식", bad({ amount: 1, owner: "가", date: "25.3.18" }).includes("YYYY-MM-DD"));
  check("장부 밖 갚음에는 날짜가 필요", bad({ amount: 1, owner: "가", settles: [{ amount: 1, method: "현금" }] }).includes("날짜"));
  check("방향을 모르면 받은 돈", (() => { const r = sanitizeSuspense({ amount: 1, owner: "가", direction: "x" as never }); return r.ok && r.value.direction === "in"; })());
}

console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
