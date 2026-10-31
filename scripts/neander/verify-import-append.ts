// 엑셀 안전 추가 검증. 메모리 DB만 사용하며 Firebase 인증·실제 DB/API에 접근하지 않는다.
// npx tsx --conditions react-server scripts/neander/verify-import-append.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "../../lib/neander/collections";
import { buildSplit } from "../../lib/neander/finance/split";
import { dedupHashOf, type FinTransaction } from "../../lib/neander/finance/types";
import { appendFinanceImport, ImportAppendError } from "../../lib/neander/finance/server/import-append";

type Data = Record<string, any>;
type Write = { kind: "create" | "set" | "update" | "delete"; ref: Ref; data?: Data; merge?: boolean };
type Filter = { key: string; op: string; value: unknown };
const copy = <T,>(value: T): T => structuredClone(value);
const field = (data: Data, key: string): any => key.split(".").reduce((value, part) => value?.[part], data);

class Ref {
  constructor(readonly db: MemoryDb, readonly path: string) {}
  get id() { return this.path.split("/").at(-1)!; }
  collection(path: string) { return new Query(this.db, `${this.path}/${path}`); }
  async get() { this.db.read(this.path); return this.db.snapshot(this); }
}

class Query {
  constructor(readonly db: MemoryDb, readonly path: string, readonly filters: Filter[] = [], readonly cap = Infinity, readonly selected?: string[]) {}
  doc(id?: string) { return new Ref(this.db, `${this.path}/${id ?? this.db.nextId()}`); }
  where(key: string, op: string, value: unknown) {
    if (op === "in") assert(Array.isArray(value) && value.length > 0 && value.length <= 30, "Firestore in-query limit");
    return new Query(this.db, this.path, [...this.filters, { key, op, value }], this.cap, this.selected);
  }
  limit(cap: number) { return new Query(this.db, this.path, this.filters, cap, this.selected); }
  select(...keys: string[]) { return new Query(this.db, this.path, this.filters, this.cap, keys); }
  async get() {
    this.db.read(this.path);
    const docs = [...this.db.data.entries()].filter(([path, data]) => path.startsWith(`${this.path}/`) &&
      !path.slice(this.path.length + 1).includes("/") && this.filters.every(({ key, op, value }) => {
        const actual = field(data, key);
        if (op === "==") return actual === value;
        if (op === ">=") return actual >= (value as any);
        if (op === "<=") return actual <= (value as any);
        if (op === ">") return actual > (value as any);
        if (op === "<") return actual < (value as any);
        if (op === "in") return (value as unknown[]).includes(actual);
        throw new Error(`mock query operator not supported: ${op}`);
      })).slice(0, this.cap).map(([path]) => this.db.snapshot(new Ref(this.db, path), this.selected));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class MemoryDb {
  data = new Map<string, Data>();
  version = 0;
  retries = 0;
  maxWrites = 0;
  commits: { reads: string[]; writes: Write[] }[] = [];
  failReadAt: string | undefined;
  failCommit = false;
  failCommitAt: number | undefined;
  commitAttempts = 0;
  failFinancialCommitAt: number | undefined;
  financialCommitAttempts = 0;
  failFinancialReadTransactionAt: number | undefined;
  financialReadTransactions = 0;
  private sequence = 0;
  private reads: string[] = [];
  nextId() { return `mock${String(++this.sequence).padStart(16, "0")}`; }
  collection(path: string) { return new Query(this, path); }
  doc(path: string) { return new Ref(this, path); }
  async getAll(...refs: Ref[]) { return Promise.all([...refs].reverse().map((ref) => ref.get())); }
  read(path: string) {
    this.reads.push(path);
    if (this.failReadAt && path.startsWith(this.failReadAt)) throw new Error("injected read failure");
  }
  snapshot(ref: Ref, selected?: string[]) {
    const stored = this.data.get(ref.path);
    const data = stored && selected ? Object.fromEntries(selected.filter((key) => field(stored, key) !== undefined).map((key) => [key, field(stored, key)])) : stored;
    return {
      ref, id: ref.id, exists: data !== undefined,
      data: () => data === undefined ? undefined : copy(data),
      get: (key: string) => data === undefined ? undefined : copy(field(data, key)),
    };
  }
  put(collection: string, id: string, data: Data) { this.data.set(`${collection}/${id}`, copy(data)); this.version++; }
  rows(collection: string): Data[] {
    return [...this.data.entries()].filter(([path]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/"))
      .map(([path, data]) => ({ ...copy(data), id: path.split("/").at(-1)! }));
  }
  state() { return [...this.data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, copy(data)]); }
  async runTransaction<T>(run: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const version = this.version;
      const writes: Write[] = [];
      const reads: string[] = [];
      let readFinancial = false;
      const reading = (paths: string[]) => {
        assert.equal(writes.length, 0, "Firestore requires all reads before writes");
        reads.push(...paths);
        if (!readFinancial && paths.some((path) => path === C.finTransactions || path.startsWith(`${C.finTransactions}/`))) {
          readFinancial = true;
          this.financialReadTransactions++;
          if (this.financialReadTransactions === this.failFinancialReadTransactionAt) throw new Error("injected read failure");
        }
      };
      const tx = {
        get: async (ref: Ref | Query) => { reading([ref.path]); return ref.get(); },
        // Return snapshots in reverse order to catch code that matches by array position.
        getAll: async (...refs: Ref[]) => { reading(refs.map((ref) => ref.path)); return Promise.all([...refs].reverse().map((ref) => ref.get())); },
        create: (ref: Ref, data: Data) => { writes.push({ kind: "create", ref, data }); return tx; },
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) => { writes.push({ kind: "set", ref, data, merge: options?.merge }); return tx; },
        update: (ref: Ref, data: Data) => { writes.push({ kind: "update", ref, data }); return tx; },
        delete: (ref: Ref) => { writes.push({ kind: "delete", ref }); return tx; },
      };
      const result = await run(tx);
      if (this.version !== version) { this.retries++; continue; }
      assert(writes.length <= 500, `Firestore atomic write limit: ${writes.length}`);
      const staged = new Map(this.data);
      for (const { kind, ref, data, merge } of writes) {
        if (kind === "delete") { staged.delete(ref.path); continue; }
        if (kind === "create") assert(!staged.has(ref.path), "create must not overwrite an existing document");
        if (kind === "update") assert(staged.has(ref.path), "update must not resurrect a deleted document");
        const value: Data = kind === "update" || merge ? { ...staged.get(ref.path) } : {};
        for (const [key, item] of Object.entries(data!)) {
          if (item === FieldValue.delete()) delete value[key];
          else value[key] = copy(item);
        }
        staged.set(ref.path, value);
      }
      const financialWrite = writes.some((write) => write.ref.path.startsWith(`${C.finTransactions}/`));
      this.commitAttempts++;
      if (financialWrite) this.financialCommitAttempts++;
      if (this.failCommit || this.commitAttempts === this.failCommitAt ||
          (financialWrite && this.financialCommitAttempts === this.failFinancialCommitAt)) throw new Error("injected write failure");
      this.data = staged;
      this.maxWrites = Math.max(this.maxWrites, writes.length);
      this.commits.push({ reads, writes });
      if (writes.length) this.version++;
      return result;
    }
    throw new Error("mock transaction retry exhausted");
  }
}

const C = NEANDER_COL;
const by = "append-verify@example.local";
const asDb = (db: MemoryDb) => db as unknown as Firestore;

function fixture() {
  const db = new MemoryDb();
  for (const [last4, kind, bank] of [
    ["4248", "account", "shinhan"], ["4223", "account", "shinhan"],
    ["3513", "card", "shinhan-card"], ["7753", "card", "shinhan-card"],
    ["3800", "card", "kb-card"],
  ]) db.put(C.finPaymentMethods, last4, { last4, kind, bank, site: "네안데르", personal: false, alias: `검증 ${last4}` });
  for (const [txType, major, mid, minor] of [
    ["지출", "운영비", "일반운영비", "구독서비스비"],
    ["수입", "매출", "B2B매출", "웹페이지제작"],
    ["자금거래", "가수금", "가수금관리", "가수금지급"],
    ["지출", "재무비용", "금융비용", "카드대금결제"],
  ]) {
    const lookupKey = `${txType}|${major}|${mid}|${minor}`;
    db.put(C.finAccounts, lookupKey, { txType, major, mid, minor, lookupKey, active: true });
  }
  return db;
}

function sourceRow(number = 1, patch: Partial<FinTransaction> = {}): FinTransaction {
  const data: FinTransaction = {
    id: `source-${number}`, date: "2026-10-29", last4: "4248", txType: "지출", vendor: `거래처 ${number}`,
    gross: 10_000 + number, adjust: 0, site: "네안데르", status: "confirmed", createdAt: 0,
    bizMajor: "공용", bizMinor: "공용", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "구독서비스비",
    dedupHash: "", ...patch,
  };
  data.dedupHash = patch.dedupHash ?? dedupHashOf(data);
  return data;
}
const transactions = (db: MemoryDb) => db.rows(C.finTransactions) as FinTransaction[];
const financialState = (db: MemoryDb) => transactions(db).sort((a, b) => a.id.localeCompare(b.id));
function assertPreserved(before: FinTransaction[], db: MemoryDb) {
  const after = new Map(transactions(db).map((row) => [row.id, row]));
  before.forEach((row) => assert.deepEqual(after.get(row.id), row, `existing transaction ${row.id} was changed`));
}
let checked = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checked++;
  console.log(`✓ ${name}`);
}

type AppendInput = Parameters<typeof appendFinanceImport>[2];
function input(rows = [sourceRow()], patch: Partial<AppendInput> = {}): AppendInput {
  const dates = rows.map((row) => row.date).sort();
  return {
    fileName: "신한_4248_202610.xlsx",
    fileHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    month: "2026-10", slotKey: "account:4248", adapterId: "shinhan-bank",
    from: dates[0] || "2026-10-01", to: dates.at(-1) || "2026-10-31", last4s: ["4248"],
    rows: rows.map(({ id: _id, createdAt: _at, ...row }) => row), ...patch,
  };
}
const append = (db: MemoryDb, payload: AppendInput) => appendFinanceImport(asDb(db), by, payload);
function seedExisting(db: MemoryDb, row: FinTransaction, batchId = "old_import_001") {
  const { id, ...data } = row;
  db.put(C.finTransactions, id, { ...data, importBatchId: batchId });
  db.put(C.finImports, batchId, { fileName: "이전 원본.xlsx", month: "2026-10", slotKey: "account:4248", inserted: 99, skipped: 8,
    income: 123_000, expense: 45_000, createdAt: 1, note: "이전 적재 이력 보존" });
}

async function main() {
  await check("추가 파일은 기존 원장·메모·배치를 보존하고 새 거래만 만든다", async () => {
    const db = fixture();
    const original = sourceRow(1, { note: "사용자가 확인한 메모", cardMemo: "품목 메모", engineSig: "hold", projectCode: "보존 코드" });
    seedExisting(db, original);
    const before = financialState(db), batchBefore = copy(db.data.get(`${C.finImports}/old_import_001`));
    await append(db, input([sourceRow(1), sourceRow(2)]));
    assertPreserved(before, db);
    assert.deepEqual(db.data.get(`${C.finImports}/old_import_001`), batchBefore);
    assert.equal(transactions(db).length, 2);
    assert.equal(transactions(db).filter((row) => row.vendor === "거래처 2").length, 1);
    assert(db.commits.every((commit) => !commit.writes.some((write) => write.kind === "delete" && write.ref.path.startsWith(`${C.finTransactions}/`))));
  });
  await check("같은 날·가맹점·금액의 실제 두 결제는 두 건으로 보존하고 재시도는 추가하지 않는다", async () => {
    const db = fixture(), first = sourceRow(1), second = { ...first, id: "source-2" };
    const payload = input([first, second]);
    await append(db, payload);
    assert.equal(transactions(db).length, 2);
    assert.equal(transactions(db).filter((row) => row.dedupHash === first.dedupHash).length, 2);
    const before = financialState(db);
    await append(db, payload);
    assertPreserved(before, db);
    assert.equal(transactions(db).length, 2);
    await append(db, input([first, second, { ...first, id: "source-3" }], { fileName: "다음 추가 파일.xlsx" }));
    assert.equal(transactions(db).length, 3);
  });
  await check("같은 파일 확인값으로 금액·조정액·날짜·원본 행 수를 바꿔 재요청하면 409로 막는다", async () => {
    const db = fixture(), payload = input([sourceRow(1)]);
    await append(db, payload);
    const before = financialState(db);
    for (const changed of [
      input([sourceRow(1, { gross: 11_000 })], { fileHash: payload.fileHash }),
      input([sourceRow(1, { adjust: 500 })], { fileHash: payload.fileHash }),
      input([sourceRow(1, { date: "2026-10-30" })], { fileHash: payload.fileHash }),
      input([sourceRow(1), sourceRow(2)], { fileHash: payload.fileHash }),
    ]) {
      await assert.rejects(append(db, changed), (error: any) => error.status === 409);
      assert.deepEqual(financialState(db), before);
    }
  });
  await check("같은 원본 파일을 분류만 바꿔 대조해도 이미 저장한 거래는 덮어쓰지 않는다", async () => {
    const db = fixture(), payload = input([sourceRow(1)]);
    await append(db, payload);
    const before = financialState(db);
    const reclassified = input([sourceRow(1, { txType: "자금거래", dedupHash: sourceRow(1).dedupHash,
      acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급", note: "새로 읽은 파일의 분류 제안" })], { fileHash: payload.fileHash });
    const result = await append(db, reclassified);
    assert.equal(result.inserted, 0);
    assert.deepEqual(financialState(db), before);
  });
  await check("한 결제의 분할 조각은 원본 한 건으로 세고 분류·메모·합계를 보존한다", async () => {
    const db = fixture(), original = sourceRow(1, { note: "분할 뒤 보존할 메모", cardMemo: "사용자가 붙인 품목" });
    const split = buildSplit(original as FinTransaction & Data, [
      { gross: 4000, bizMajor: "공용", bizMinor: "공용", acctMajor: original.acctMajor, acctMid: original.acctMid, acctMinor: original.acctMinor },
      { gross: original.gross - 4000, bizMajor: "B2B", bizMinor: "조향", projectCode: "사용자 프로젝트", acctMajor: original.acctMajor, acctMid: original.acctMid, acctMinor: original.acctMinor },
    ], 2, by);
    seedExisting(db, { ...original, ...split.rootPatch } as FinTransaction);
    db.put(C.finTransactions, "split_child_001", split.children[0]);
    const before = financialState(db);
    await append(db, input([sourceRow(1)]));
    assert.equal(transactions(db).length, 2);
    assertPreserved(before, db);
    assert.equal(transactions(db).reduce((sum, row) => sum + row.gross, 0), original.gross);
    await append(db, input([sourceRow(1), { ...sourceRow(1), id: "another-real-payment" }], { fileName: "실제 두 결제.xlsx" }));
    assert.equal(transactions(db).length, 3);
    assertPreserved(before, db);
  });
  await check("원본을 지운 분할 묶음도 남아 있는 조각의 원본 키로 재적재를 막는다", async () => {
    const db = fixture(), original = sourceRow(1);
    const split = buildSplit(original as FinTransaction & Data, [{ gross: 4000 }, { gross: original.gross - 4000 }], 2, by);
    db.put(C.finTransactions, "orphan_piece_001", split.children[0]);
    const before = financialState(db);
    await append(db, input([sourceRow(1)]));
    assert.equal(transactions(db).length, 1);
    assertPreserved(before, db);
  });
  await check("수동으로 바꾼 날짜·가맹점·금액·유형도 원본 중복 키로 보존한다", async () => {
    const db = fixture(), raw = sourceRow(1);
    seedExisting(db, { ...raw, date: "2026-10-28", vendor: "확인 후 고친 상호", gross: 9000, txType: "자금거래",
      acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급", note: "은행 원문과 대조 후 수동 수정", engineSig: "hold" });
    const before = financialState(db);
    await append(db, input([raw]));
    assert.equal(transactions(db).length, 1);
    assertPreserved(before, db);
  });
  await check("자금거래·카드대금으로 분류가 바뀌어도 은행 원본 출금 키로 중복을 판정한다", async () => {
    const db = fixture(), funding = sourceRow(1), cardBill = sourceRow(2);
    seedExisting(db, { ...funding, txType: "자금거래", acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급" });
    seedExisting(db, { ...cardBill, txType: "카드대금결제", acctMajor: "재무비용", acctMid: "금융비용", acctMinor: "카드대금결제" });
    const before = financialState(db);
    await append(db, input([funding, cardBill]));
    assert.equal(transactions(db).length, 2);
    assertPreserved(before, db);
  });
  await check("카드사 한 파일에 여러 법인카드가 있어도 같은 월의 기존 결제만 건너뛴다", async () => {
    const db = fixture();
    const a = sourceRow(1, { last4: "3513" }), b = sourceRow(2, { last4: "7753" });
    seedExisting(db, a, "old_card_batch");
    const before = financialState(db);
    const payload = input([a, b], { fileName: "신한카드_10월.xlsx", slotKey: "card:shinhan-card", adapterId: "shinhan-card", last4s: ["3513", "7753"] });
    await append(db, payload); await append(db, payload);
    assert.equal(transactions(db).length, 2); assertPreserved(before, db);
  });
  await check("카드 취소의 음수 지출과 환급을 보존하고 추가분 합계를 순액으로 센다", async () => {
    const db = fixture();
    const rows = [
      sourceRow(1, { last4: "3513", gross: 10_000 }),
      sourceRow(2, { last4: "3513", gross: -2_000 }),
      sourceRow(3, { last4: "3513", txType: "환급", gross: 1_500 }),
    ];
    const payload = input(rows, { fileName: "신한카드_취소포함.xlsx", slotKey: "card:shinhan-card", adapterId: "shinhan-card", last4s: ["3513"] });
    const result = await append(db, payload);
    assert.equal(transactions(db).length, 3);
    assert.deepEqual([result.income, result.expense], [0, 6_500]);
    await append(db, payload);
    assert.equal(transactions(db).length, 3);
  });
  await check("대량 파일의 청크 경계를 넘는 동일 결제도 실제 횟수만큼 남는다", async () => {
    const db = fixture(), rows = Array.from({ length: 405 }, (_, i) => sourceRow(i + 1));
    rows[200] = { ...rows[0], id: "identical-after-chunk-boundary" };
    await append(db, input(rows));
    assert.equal(transactions(db).length, rows.length);
    assert.equal(transactions(db).filter((row) => row.dedupHash === rows[0].dedupHash).length, 2);
    assert(db.maxWrites <= 500);
    assert(db.commits.filter((commit) => commit.writes.some((write) => write.ref.path.startsWith(`${C.finTransactions}/`))).length >= 3);
    const before = financialState(db); await append(db, input(rows));
    assert.equal(transactions(db).length, rows.length); assertPreserved(before, db);
  });
  await check("서로 다른 두 추가 업로드가 동시에 들어와도 중복 거래가 생기지 않는다", async () => {
    const db = fixture();
    const a = input([sourceRow(1), sourceRow(2)]), b = input([sourceRow(1), sourceRow(2), sourceRow(3)], { fileName: "추가분.xlsx" });
    await Promise.allSettled([append(db, a), append(db, b)]);
    await append(db, a); await append(db, b);
    assert.equal(transactions(db).length, 3);
    assert.equal(new Set(transactions(db).map((row) => row.dedupHash)).size, 3);
    assert(db.retries > 0, "concurrent transactions should have exercised a retry");
    assert(db.commits.some((commit) => commit.writes.some((write) => write.ref.path.startsWith(`${C.finSettings}/`))), "a shared scope lock must protect the duplicate read");
  });
  await check("첫 청크의 읽기·쓰기 실패는 기존 거래를 바꾸거나 신규 거래 일부를 남기지 않는다", async () => {
    for (const kind of ["read", "write"] as const) {
      const db = fixture(); seedExisting(db, sourceRow(1));
      const before = financialState(db);
      if (kind === "read") db.failReadAt = C.finTransactions;
      else db.failFinancialCommitAt = 1;
      await assert.rejects(append(db, input([sourceRow(1), sourceRow(2)])),
        (error) => error instanceof ImportAppendError && error.status === 503 && error.partial?.inserted === 0);
      assert.deepEqual(financialState(db), before);
    }
  });
  await check("두 번째 청크 실패는 첫 청크를 보존하고 같은 파일 재시도로 나머지만 추가한다", async () => {
    for (const fault of ["read", "write"] as const) {
      const db = fixture(); seedExisting(db, sourceRow(999));
      const original = financialState(db), rows = Array.from({ length: 405 }, (_, i) => sourceRow(i + 1));
      rows[200] = { ...rows[0], id: "identical-in-next-chunk" };
      const payload = input(rows);
      if (fault === "write") db.failFinancialCommitAt = 2;
      else db.failFinancialReadTransactionAt = 2;
      let partialCount: number | undefined;
      await assert.rejects(append(db, payload), (error) => {
        if (!(error instanceof ImportAppendError) || error.status !== 503) return false;
        partialCount = error.partial?.inserted;
        return partialCount !== undefined;
      });
      assertPreserved(original, db);
      const retained = transactions(db).length - original.length;
      assert(retained > 0 && retained < rows.length, "only fully committed earlier chunks should remain");
      assert.equal(partialCount, retained);
      const partial = financialState(db);
      const batch = db.rows(C.finImports).find((row) => row.mode === "append");
      assert(batch, "the committed first chunk must have an import record");
      assert.equal(batch.complete, false);
      db.failFinancialCommitAt = undefined;
      db.failFinancialReadTransactionAt = undefined;
      const resumed = await append(db, payload);
      assertPreserved(partial, db);
      assert.equal(transactions(db).length, rows.length + original.length);
      assert.deepEqual([resumed.inserted, resumed.skipped], [rows.length - retained, retained]);
      assert.equal(resumed.id, batch.id);
      assert.equal(db.data.get(`${C.finImports}/${batch.id}`)!.complete, true);
      assert.equal(transactions(db).filter((row) => row.dedupHash === rows[0].dedupHash).length, 2);
      const repeated = await append(db, payload);
      assert.deepEqual([repeated.inserted, repeated.skipped, repeated.id], [0, rows.length, batch.id]);
      assert.equal(transactions(db).length, rows.length + original.length);
      assert(db.maxWrites <= 500);
    }
  });
  await check("거래 없음 표시는 정상 추가 때만 제거하고 기존 금융 거래는 삭제하지 않는다", async () => {
    const db = fixture(); seedExisting(db, sourceRow(99));
    db.put(C.finImports, "no_activity_marker", { noActivity: true, month: "2026-10", slotKey: "account:4248", fileName: "거래 없음", inserted: 0, skipped: 0, createdAt: 1 });
    db.put(C.finImports, "other_month_marker", { noActivity: true, month: "2026-09", slotKey: "account:4248", fileName: "거래 없음", inserted: 0, skipped: 0, createdAt: 1 });
    const before = financialState(db);
    db.failFinancialCommitAt = 1;
    await assert.rejects(append(db, input([sourceRow(1)])),
      (error) => error instanceof ImportAppendError && error.status === 503 && error.partial?.inserted === 0);
    assert(db.data.has(`${C.finImports}/no_activity_marker`));
    assert.deepEqual(financialState(db), before);
    db.failFinancialCommitAt = undefined;
    await append(db, input([sourceRow(1)]));
    assertPreserved(before, db);
    assert(!db.data.has(`${C.finImports}/no_activity_marker`));
    assert(db.data.has(`${C.finImports}/other_month_marker`));
    assert.equal(transactions(db).length, 2);
    assert(db.commits.every((commit) => commit.writes.filter((write) => write.kind === "delete").every((write) => write.ref.path.startsWith(`${C.finImports}/`))));
  });
  await check("거래 없음 표시 400개와 신규 거래 200건도 한 청크 500쓰기를 넘지 않고 기존 금융 거래를 보존한다", async () => {
    const db = fixture(); seedExisting(db, sourceRow(999));
    for (let i = 0; i < 400; i++) db.put(C.finImports, `many_no_activity_${i}`, {
      noActivity: true, month: "2026-10", slotKey: "account:4248", fileName: "거래 없음", inserted: 0, skipped: 0, createdAt: 1,
    });
    const before = financialState(db), payload = input(Array.from({ length: 200 }, (_, i) => sourceRow(i + 1)));
    const result = await append(db, payload);
    assert.equal(result.inserted, 200);
    assert.equal(transactions(db).length, 201);
    assertPreserved(before, db);
    assert.equal(db.maxWrites, 500);
    assert.equal(db.rows(C.finImports).filter((row) => row.noActivity).length, 102);
    assert(db.commits.every((commit) => commit.writes.filter((write) => write.kind === "delete").every((write) => write.ref.path.startsWith(`${C.finImports}/`))));
    const after = financialState(db);
    const repeated = await append(db, payload);
    assert.equal(repeated.inserted, 0);
    assert.equal(db.rows(C.finImports).filter((row) => row.noActivity).length, 0);
    assert.deepEqual(financialState(db), after);
    assert.equal(db.maxWrites, 500);
  });
  await check("이전 완료 파일의 재대조가 둘째 청크에서 실패하면 미완료로 남고 기존 405건을 보존한 채 재시도한다", async () => {
    const db = fixture(), payload = input(Array.from({ length: 405 }, (_, i) => sourceRow(i + 1)));
    const first = await append(db, payload);
    assert.equal(db.data.get(`${C.finImports}/${first.id}`)!.complete, true);
    const before = financialState(db);
    db.failCommitAt = db.commitAttempts + 2;
    await assert.rejects(append(db, payload), (error) => error instanceof ImportAppendError && error.status === 503 && error.partial?.inserted === 0);
    assert.equal(db.data.get(`${C.finImports}/${first.id}`)!.complete, false);
    assert.equal(transactions(db).length, 405);
    assert.deepEqual(financialState(db), before);
    db.failCommitAt = undefined;
    const resumed = await append(db, payload);
    assert.deepEqual([resumed.id, resumed.inserted, resumed.skipped], [first.id, 0, 405]);
    assert.equal(db.data.get(`${C.finImports}/${first.id}`)!.complete, true);
    assert.deepEqual(financialState(db), before);
  });
  await check("날짜·월·계좌 칸·카드사·행수 범위가 틀린 요청은 금융 거래를 남기지 않는다", async () => {
    const wrong: AppendInput[] = [
      input([sourceRow(1, { date: "2026-11-01" })]),
      input([sourceRow(1)], { month: "2026-13" }),
      input([sourceRow(1)], { slotKey: "account:4223" }),
      input([sourceRow(1, { last4: "4223" })]),
      input([sourceRow(1)], { adapterId: "kb-bank" }),
      input([sourceRow(1, { last4: "3800" })], { slotKey: "card:shinhan-card", adapterId: "shinhan-card", last4s: ["3800"] }),
      input(Array.from({ length: 5001 }, (_, i) => sourceRow(i + 1))),
    ];
    for (const payload of wrong) {
      const db = fixture(); seedExisting(db, sourceRow(99));
      const before = financialState(db);
      await assert.rejects(append(db, payload));
      assert.deepEqual(financialState(db), before);
    }
  });
  console.log(`\n${checked}개 검증 통과 — 메모리 DB만 사용했습니다.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
