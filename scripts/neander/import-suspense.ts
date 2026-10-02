// ============================================================
//  가수금 기록장에 건을 한꺼번에 넣는다 — 수기 대장을 옮길 때
// ------------------------------------------------------------
//  건 목록(JSON)을 읽어 neander_fin_suspense 에 넣는다. 넣기 전에 화면·서버와
//  **같은 검사**(suspense.ts 의 sanitizeSuspense · checkNewLinks)를 거치고, 넣은 뒤의
//  사람별 잔액과 「안 붙은 장부 거래」 를 미리 보여 준다.
//
//  건 목록은 깃에 올리지 않는다 (이 저장소는 public — 누가 회사에 얼마를 넣었는지는
//  private/ 아래에 둔다). 모양:
//    { "source": "어디서 옮겼나",
//      "items": [ { "key": "legacy-01", "no": 1, "direction": "in", "date": "2023-03-18",
//                   "amount": 10000000, "nominee": "…", "owner": "…", "purpose": "…",
//                   "origins": [{ "txId": "…", "amount": 0 }],
//                   "settles": [{ "date": "…", "amount": 0, "method": "…", "txId": "…" }] } ] }
//
//  문서 id 는 key 다 — 같은 파일을 다시 돌려도 두 번 들어가지 않는다. 이미 있는 건은
//  건너뛴다 (화면에서 고친 것을 덮어쓰지 않으려고). 덮어쓰려면 --overwrite.
//
//    npm run finance:import-suspense -- private/suspense/hand-ledger-2025.json            (미리보기)
//    npm run finance:import-suspense -- private/suspense/hand-ledger-2025.json --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  allocatedByTx,
  buildSuspenseBook,
  checkNewLinks,
  sanitizeSuspense,
  SUSPENSE_MAJOR,
  type FinSuspenseDoc,
  type FinSuspenseInput,
} from "@/lib/neander/finance/suspense";
import type { FinTransaction } from "@/lib/neander/finance/types";

const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const OVERWRITE = process.argv.includes("--overwrite");
const BY = "script:import-suspense";
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
}

(async () => {
  if (!FILE) {
    console.error("건 목록 파일을 주세요: npm run finance:import-suspense -- <파일.json> [--apply]");
    process.exit(1);
  }
  const file = JSON.parse(readFileSync(FILE, "utf8")) as {
    source?: string;
    items: (Partial<FinSuspenseInput> & { key?: string })[];
  };
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finSuspense);

  // 붙일 수 있는 것은 가수금 계정의 거래뿐이라 그것만 읽는다
  const [txSnap, haveSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).where("acctMajor", "==", SUSPENSE_MAJOR).get(),
    col.get(),
  ]);
  const ledger = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinTransaction);
  const txById = new Map(ledger.map((t) => [t.id, t]));
  const have = new Map(haveSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as FinSuspenseDoc]));

  console.log(`${FILE} — ${file.source ?? "출처 없음"}`);
  console.log(`건 ${file.items.length} · 장부의 가수금 거래 ${ledger.length} · 이미 있는 건 ${have.size}\n`);

  const now = Date.now();
  let problems = 0;
  const keys = new Set<string>();
  const next = new Map(have);
  const writes: FinSuspenseDoc[] = [];
  for (const raw of file.items) {
    const key = String(raw.key ?? "").trim();
    const tag = `${String(raw.no ?? "-").padStart(3)} ${key}`;
    if (!key || keys.has(key)) {
      console.log(`  ✗ ${tag} — key 가 없거나 겹칩니다`);
      problems += 1;
      continue;
    }
    keys.add(key);
    if (have.has(key) && !OVERWRITE) {
      console.log(`  · ${tag} — 이미 있어 건너뜁니다`);
      continue;
    }
    const parsed = sanitizeSuspense(raw);
    if (!parsed.ok) {
      console.log(`  ✗ ${tag} — ${parsed.error}`);
      problems += 1;
      continue;
    }
    // 앞서 통과한 건들이 붙여 둔 금액까지 치고 본다 — 한 거래를 두 건이 겹쳐 가져가지 않게
    const others = allocatedByTx([...next.values()].filter((x) => x.id !== key));
    const problem = checkNewLinks(parsed.value, null, txById, others);
    if (problem) {
      console.log(`  ✗ ${tag} — ${problem}`);
      problems += 1;
      continue;
    }
    const doc: FinSuspenseDoc = { ...parsed.value, id: key, createdAt: have.get(key)?.createdAt ?? now, updatedAt: now, updatedBy: BY };
    next.set(key, doc);
    writes.push(doc);
  }

  // ---- 넣은 뒤의 모습 ----
  const book = buildSuspenseBook([...next.values()], ledger);
  console.log("\n건별");
  book.views.forEach((v) => {
    const it = v.item;
    const who = it.nominee && it.nominee !== it.owner ? `${it.owner} (명의 ${it.nominee})` : it.owner;
    console.log(
      `  ${String(it.no ?? "-").padStart(3)} ${(it.date ?? "날짜 없음").padEnd(10)} ${it.direction === "in" ? "받은 돈" : "내준 돈"} ` +
        `${fmt(it.amount).padStart(12)} 갚음 ${fmt(v.settled).padStart(12)} 남음 ${fmt(v.remaining).padStart(12)} ` +
        `${v.status.padEnd(7)} ${who} · ${it.purpose ?? ""}`,
    );
    v.issues.forEach((s) => console.log(`        ⚠ ${s}`));
  });
  const total = book.views.reduce((s, v) => s + v.item.amount, 0);
  console.log(`  합계 ${fmt(total)} · 회사 돈 ${book.totals.companyCount}건 ${fmt(book.totals.companyAmount)} · 어긋난 건 ${book.totals.issueCount}`);

  console.log("\n사람별");
  book.people.forEach((p) =>
    console.log(
      `  ${p.owner.padEnd(8)} 받은 돈 ${fmt(p.received).padStart(12)} 갚음 ${fmt(p.repaid).padStart(12)} 갚을 돈 ${fmt(p.payable).padStart(12)}` +
        ` | 내준 돈 ${fmt(p.lent).padStart(11)} 돌려받음 ${fmt(p.recovered).padStart(11)} 받을 돈 ${fmt(p.receivable).padStart(11)}`,
    ),
  );
  console.log(`  회사가 갚을 돈 ${fmt(book.totals.payable)} · 회사가 받을 돈 ${fmt(book.totals.receivable)}`);

  console.log(`\n안 붙은 장부 거래 ${book.unattached.length}건 ${fmt(book.totals.unattachedAmount)}`);
  book.unattached.forEach((u) =>
    console.log(`  ${u.tx.date} ${u.tx.last4 ?? "----"} ${u.tx.acctMinor} ${fmt(u.rest).padStart(12)} ${u.tx.vendor ?? ""} | ${u.tx.note ?? ""}`),
  );

  if (problems > 0 || book.totals.issueCount > 0) {
    console.log(`\n문제 ${problems + book.totals.issueCount}건 — 고친 뒤 다시 돌려 주세요. 아무것도 쓰지 않았습니다.`);
    process.exit(1);
  }
  if (!APPLY) {
    console.log(`\n미리보기입니다 — 새로 쓸 건 ${writes.length}. 실제로 넣으려면 --apply`);
    return;
  }
  const batch = db.batch();
  writes.forEach(({ id, ...data }) => {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    batch.set(col.doc(id), clean, { merge: false });
  });
  await batch.commit();
  console.log(`\n${writes.length}건을 넣었습니다 (${NEANDER_COL.finSuspense}).`);
})();
