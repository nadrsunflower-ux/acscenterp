// 대납 비용·은행 상환 검증. 메모리 DB만 사용하며 Firebase 인증/실제 DB에 접근하지 않는다.
// npx tsx --conditions react-server scripts/neander/verify-expense-claims.ts
import assert from "node:assert/strict";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "../../lib/neander/collections";
import { expenseClaimCandidates, expenseClaimSummary, type ExpenseClaimDoc, type ExpenseClaimImportInput, type ExpenseClaimRow } from "../../lib/neander/finance/expense-claims";
import { cancelExpenseClaim, importExpenseClaim, linkExpenseClaimSettlement, unlinkExpenseClaimSettlement } from "../../lib/neander/finance/server/expense-claims";
import { buildSplit } from "../../lib/neander/finance/split";
import type { FinTransaction } from "../../lib/neander/finance/types";

type Data = Record<string, any>;
const copy = <T,>(value: T): T => structuredClone(value);
const field = (data: Data, key: string) => key.split(".").reduce((value, part) => value?.[part], data);
class Ref {
  constructor(readonly db: MemoryDb, readonly path: string) {}
  get id() { return this.path.split("/").at(-1)!; }
  async get() { return this.db.snapshot(this); }
}
class Query {
  constructor(readonly db: MemoryDb, readonly path: string, readonly filters: [string, unknown][] = []) {}
  doc(id?: string) { return new Ref(this.db, `${this.path}/${id ?? this.db.nextId()}`); }
  where(key: string, op: string, value: unknown) { assert.equal(op, "=="); return new Query(this.db, this.path, [...this.filters, [key, value]]); }
  async get() {
    const docs = [...this.db.data.entries()].filter(([path, data]) => path.startsWith(`${this.path}/`) &&
      !path.slice(this.path.length + 1).includes("/") && this.filters.every(([key, value]) => field(data, key) === value))
      .map(([path]) => this.db.snapshot(new Ref(this.db, path)));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}
class MemoryDb {
  data = new Map<string, Data>();
  version = 0;
  retries = 0;
  maxWrites = 0;
  private sequence = 0;
  nextId() { return `test${String(++this.sequence).padStart(16, "0")}`; }
  collection(path: string) { return new Query(this, path); }
  snapshot(ref: Ref) {
    const data = this.data.get(ref.path);
    return { ref, id: ref.id, exists: data !== undefined, data: () => data === undefined ? undefined : copy(data) };
  }
  put(collection: string, id: string, data: Data) { this.data.set(`${collection}/${id}`, copy(data)); this.version++; }
  rows(collection: string): Data[] { return [...this.data.entries()].filter(([path]) => path.startsWith(`${collection}/`)).map(([path, value]) => ({ ...copy(value), id: path.split("/").at(-1)! })); }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const version = this.version;
      const writes: { kind: string; ref: Ref; data?: Data }[] = [];
      const reading = () => assert.equal(writes.length, 0, "Firestore requires all reads before writes");
      const tx = {
        get: async (ref: Ref | Query) => { reading(); return ref.get(); },
        getAll: async (...refs: Ref[]) => { reading(); return Promise.all([...refs].reverse().map((ref) => ref.get())); },
        create: (ref: Ref, data: Data) => writes.push({ kind: "create", ref, data }),
        set: (ref: Ref, data: Data) => writes.push({ kind: "set", ref, data }),
        update: (ref: Ref, data: Data) => writes.push({ kind: "update", ref, data }),
        delete: (ref: Ref) => writes.push({ kind: "delete", ref }),
      };
      const result = await fn(tx);
      if (this.version !== version) { this.retries++; continue; }
      assert(writes.length <= 500, "atomic write limit");
      const staged = new Map(this.data);
      writes.forEach(({ kind, ref, data }) => {
        if (kind === "delete") { staged.delete(ref.path); return; }
        if (kind === "create") assert(!staged.has(ref.path), "create must not overwrite");
        if (kind === "update") assert(staged.has(ref.path), "update must not resurrect");
        const value = kind === "update" ? { ...staged.get(ref.path) } : {};
        Object.entries(data!).forEach(([key, item]) => {
          if (item === FieldValue.delete()) delete value[key];
          else value[key] = copy(item);
        });
        staged.set(ref.path, value);
      });
      this.data = staged;
      this.maxWrites = Math.max(this.maxWrites, writes.length);
      if (writes.length) this.version++;
      return result;
    }
    throw new Error("mock transaction retry exhausted");
  }
}

const C = NEANDER_COL;
const by = "test@example.local";
const asDb = (db: MemoryDb) => db as unknown as Firestore;
function fixture() {
  const db = new MemoryDb();
  db.put(C.finAccounts, "expense-account", { lookupKey: "지출|운영비|일반운영비|구독서비스비", active: true });
  db.put(C.finAccounts, "refund-account", { lookupKey: "환급|환급수입|환불수입|기타비용환급", active: true });
  db.put(C.finPaymentMethods, "4248", { last4: "4248", kind: "account", site: "네안데르" });
  db.put(C.finPaymentMethods, "3513", { last4: "3513", kind: "card", site: "네안데르" });
  db.put(C.finProjects, "project123456", { code: "PJ-2610-01" });
  return db;
}
const txs = (db: MemoryDb) => db.rows(C.finTransactions) as FinTransaction[];
const row = (rowNo = 4, gross = 100): ExpenseClaimRow => ({ rowNo, date: "2026-10-08", vendor: "도구 구독", gross, txType: "지출" as const,
  bizMajor: "공용", bizMinor: "공용", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "구독서비스비" });
const input = (rows = [row()]): ExpenseClaimImportInput => ({ payer: "김주연", site: "네안데르", paymentLabel: "비자075", fileName: "회사 비용.xlsx", fileHash: "a".repeat(64), rows });
const bank = (gross: number, extra: Data = {}) => ({ date: "2026-10-30", txType: "자금거래", acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급",
  gross, adjust: 0, vendor: "김주연", last4: "4248", site: "네안데르", status: "confirmed", dedupHash: "bank-original", createdAt: 1, ...extra });
let count = 0;
async function check(name: string, run: () => Promise<void>) { await run(); count++; console.log(`✓ ${name}`); }

async function main() {
  await check("same-day identical charges stay distinct; repeat import and normalized payer skip only existing occurrences", async () => {
    const db = fixture(), source = input([row(4), row(5)]);
    const first = await importExpenseClaim(asDb(db), by, source);
    assert.equal(first.inserted, 2);
    const again = await importExpenseClaim(asDb(db), by, { ...source, payer: " 김 주연 ", fileHash: "b".repeat(64) });
    assert.deepEqual([again.inserted, again.skipped, again.claim.id], [0, 2, first.claim.id]);
    assert.equal(db.rows(C.finExpenseClaims).length, 1);
    const third = await importExpenseClaim(asDb(db), by, input([row(4), row(5), row(6)]));
    assert.equal(third.inserted, 1); assert.equal(third.skipped, 2);
    assert.equal(expenseClaimSummary(first.claim, txs(db)).total, 200);
    assert(txs(db).every((t) => !t.last4 && !t.importBatchId && t.personalUse === false));
  });
  await check("concurrent imports are serialized and never duplicate costs", async () => {
    const db = fixture();
    const result = await Promise.all([importExpenseClaim(asDb(db), by, input()), importExpenseClaim(asDb(db), by, input())]);
    assert.deepEqual(result.map((r) => r.inserted).sort(), [0, 1]); assert.equal(txs(db).length, 1); assert(db.retries > 0);
    assert(db.rows(C.finSettings).some((r) => r.id.startsWith("expense-claim-scope-")));
  });
  await check("another payment label has a separate duplicate scope", async () => {
    const db = fixture(); await importExpenseClaim(asDb(db), by, input());
    const other = await importExpenseClaim(asDb(db), by, { ...input(), paymentLabel: "다른 개인 결제" });
    assert.equal(other.inserted, 1); assert.equal(txs(db).length, 2);
  });
  await check("refunds may retain the original real expense-account path; exported notes retain payer and original payment label", async () => {
    const db = fixture();
    const a = await importExpenseClaim(asDb(db), by, input([row(4, 100), { ...row(5, 20), txType: "환급" }]));
    assert.equal(expenseClaimSummary(a.claim, txs(db)).total, 80);
    assert(txs(db).every((tx) => tx.note?.includes("김주연") && tx.note.includes("비자075") && tx.note.includes("회사 비용.xlsx")));
    assert.equal(txs(db).find((tx) => tx.txType === "환급")?.acctMinor, "구독서비스비");
  });
  await check("invalid classification, dates, project, site, amounts, row identity and oversize input create no partial claim", async () => {
    const bad: ExpenseClaimImportInput[] = [
      input([{ ...row(), acctMinor: "없는 계정" }]), input([{ ...row(), date: "2026-02-30" }]),
      input([{ ...row(), projectCode: "NO-SUCH-PROJECT" }]), { ...input(), site: "없는 사업체" },
      input([row(4, 1.5)]), input([row(4), row(4)]), input(Array.from({ length: 151 }, (_, i) => row(i + 1))),
    ];
    for (const source of bad) { const db = fixture(); await assert.rejects(importExpenseClaim(asDb(db), by, source)); assert.equal(txs(db).length, 0); assert.equal(db.rows(C.finExpenseClaims).length, 0); }
  });
  await check("whole eligible bank repayment changes only metadata; same tx cannot settle a second claim", async () => {
    const db = fixture(), a = await importExpenseClaim(asDb(db), by, input());
    const b = await importExpenseClaim(asDb(db), by, { ...input(), paymentLabel: "다른 결제" });
    db.put(C.finTransactions, "bank00000001", bank(60));
    const before = copy(db.data.get(`${C.finTransactions}/bank00000001`));
    const linked = await linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000001");
    assert.equal(linked.transactions.length, 1);
    const saved = db.data.get(`${C.finTransactions}/bank00000001`)!;
    const { expenseReimbursement, engineSig, updatedAt, updatedBy, ...unchanged } = saved;
    assert.deepEqual(unchanged, before); assert.equal(expenseReimbursement.claimId, a.claim.id);
    assert.equal(engineSig, "hold");
    assert.deepEqual([expenseClaimSummary(a.claim, txs(db)).settled, expenseClaimSummary(a.claim, txs(db)).remaining], [60, 40]);
    await assert.rejects(linkExpenseClaimSettlement(asDb(db), by, b.claim.id, "bank00000001"));
    await assert.rejects(cancelExpenseClaim(asDb(db), by, a.claim.id));
    assert(db.rows(C.finTxLog).some((r) => r.changes?.[0]?.f === "expenseReimbursement"));
  });
  await check("ineligible, overlarge, card and legacy-debt repayments are rejected", async () => {
    const variants = [bank(101), bank(50, { last4: "3513" }), bank(50, { txType: "지출" }), bank(50, { acctMinor: "가수금입금" }), bank(50, { personalUse: true })];
    for (const data of variants) { const db = fixture(), a = await importExpenseClaim(asDb(db), by, input()); db.put(C.finTransactions, "bank00000002", data); await assert.rejects(linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000002")); }
    for (const role of ["origins", "settles"]) {
      const db = fixture(), a = await importExpenseClaim(asDb(db), by, input()); db.put(C.finTransactions, "bank00000002", bank(50));
      db.put(C.finSuspense, "legacy00001", { origins: [], settles: [], [role]: [{ txId: "bank00000002", amount: 50 }] });
      await assert.rejects(linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000002"), /가수금 기록장/);
    }
  });
  await check("concurrent repayments cannot exceed the live unpaid cost total", async () => {
    const db = fixture(), a = await importExpenseClaim(asDb(db), by, input());
    db.put(C.finTransactions, "bank00000011", bank(60)); db.put(C.finTransactions, "bank00000012", bank(60));
    const result = await Promise.allSettled([
      linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000011"),
      linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000012"),
    ]);
    assert.equal(result.filter((value) => value.status === "fulfilled").length, 1);
    assert.equal(expenseClaimSummary(a.claim, txs(db)).settled, 60);
    assert.equal(expenseClaimSummary(a.claim, txs(db)).remaining, 40);
  });
  await check("reclassified, private-use and non-bank linked rows stay visible for unlink but no longer settle the claim", async () => {
    const db = fixture(), a = await importExpenseClaim(asDb(db), by, input()); db.put(C.finTransactions, "bank00000021", bank(100));
    await linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000021");
    const original = copy(db.data.get(`${C.finTransactions}/bank00000021`));
    const methods = db.rows(C.finPaymentMethods) as any;
    for (const changes of [{ acctMinor: "가수금입금" }, { txType: "지출" }, { personalUse: true }, { last4: "3513" }]) {
      db.put(C.finTransactions, "bank00000021", { ...original, ...changes });
      const summary = expenseClaimSummary(a.claim, txs(db), methods);
      assert.equal(summary.settlements.length, 1); assert.equal(summary.invalidSettlements.length, 1);
      assert.equal(summary.settled, 0); assert.equal(summary.remaining, 100);
    }
    await unlinkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000021");
    assert.equal(db.data.get(`${C.finTransactions}/bank00000021`)!.expenseReimbursement, undefined);
  });
  await check("unlink removes only claim metadata, then cancellation archives costs and audit atomically", async () => {
    const db = fixture(), a = await importExpenseClaim(asDb(db), by, input()); db.put(C.finTransactions, "bank00000003", bank(100));
    await linkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000003");
    await unlinkExpenseClaimSettlement(asDb(db), by, a.claim.id, "bank00000003");
    assert.equal(db.data.get(`${C.finTransactions}/bank00000003`)!.expenseReimbursement, undefined);
    assert.equal(db.data.get(`${C.finTransactions}/bank00000003`)!.gross, 100);
    const cancelled = await cancelExpenseClaim(asDb(db), by, a.claim.id);
    assert.equal(cancelled.removed, 1); assert.equal(db.rows(C.finExpenseClaims).length, 0);
    assert(db.data.has(`${C.finTrash}/${cancelled.removedIds[0]}`));
    assert(db.rows(C.finTxLog).some((r) => r.kind === "delete"));
    assert.equal(db.data.get(`${C.finTransactions}/bank00000003`)!.gross, 100);
    assert.equal((await importExpenseClaim(asDb(db), by, input())).inserted, 1);
  });
  await check("edits, refunds, split pieces and deletions dynamically change totals without duplicating original-source counts", async () => {
    const db = fixture(), a = await importExpenseClaim(asDb(db), by, input());
    const original = txs(db)[0], split = buildSplit(original as FinTransaction & Data, [
      { gross: 40, bizMajor: "공용", bizMinor: "공용" }, { gross: 60, bizMajor: "공용", bizMinor: "공용" },
    ], 2, by);
    db.put(C.finTransactions, original.id, { ...db.data.get(`${C.finTransactions}/${original.id}`), ...split.rootPatch });
    db.put(C.finTransactions, "split0000001", split.children[0]);
    assert.equal(expenseClaimSummary(a.claim, txs(db)).total, 100);
    assert.equal((await importExpenseClaim(asDb(db), by, input())).inserted, 0);
    const piece = db.data.get(`${C.finTransactions}/split0000001`)!;
    db.put(C.finTransactions, "split0000001", { ...piece, gross: 20 });
    assert.equal(expenseClaimSummary(a.claim, txs(db)).total, 60);
    db.put(C.finTransactions, "split0000001", { ...piece, gross: 20, txType: "환급" });
    assert.equal(expenseClaimSummary(a.claim, txs(db)).total, 20);
    db.put(C.finTransactions, original.id, { ...db.data.get(`${C.finTransactions}/${original.id}`), personalUse: true });
    assert.equal(expenseClaimSummary(a.claim, txs(db)).total, -20);
    assert.equal(expenseClaimSummary(a.claim, txs(db)).overpaid, 20);
    db.data.delete(`${C.finTransactions}/split0000001`);
    assert.equal(expenseClaimSummary(a.claim, txs(db)).total, 0);
  });
  await check("candidate list uses real bank paths and live remaining, and supports explicitly split current bank rows", async () => {
    const claim = { id: "claim00000001" } as ExpenseClaimDoc;
    const cost = { ...bank(100), id: "cost00000001", txType: "지출", expenseClaim: { claimId: claim.id } } as FinTransaction;
    const candidates = expenseClaimCandidates(claim, [cost,
      { ...bank(60), id: "eligible", splitGroup: "original-bank", splitCount: 2 },
      { ...bank(101), id: "too-large" }, { ...bank(50), id: "card", last4: "3513" },
    ] as FinTransaction[], [
      { id: "4248", last4: "4248", kind: "account" }, { id: "3513", last4: "3513", kind: "card" },
    ] as any);
    assert.deepEqual(candidates.map((r) => r.id), ["eligible"]);
  });
  await check("150-row import and cancellation remain within one 500-write transaction even with distinct labels", async () => {
    const db = fixture(), source = input(Array.from({ length: 150 }, (_, i) => ({ ...row(i + 1), paymentLabel: `결제수단 ${i + 1}` })));
    const a = await importExpenseClaim(asDb(db), by, source); assert.equal(a.inserted, 150);
    const cancelled = await cancelExpenseClaim(asDb(db), by, a.claim.id); assert.equal(cancelled.removed, 150);
    assert(db.maxWrites <= 500);
  });
  console.log(`\n${count}개 검증 통과 — 메모리 DB만 사용했습니다.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
