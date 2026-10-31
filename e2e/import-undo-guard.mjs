// 실제 mutate POST·휴지통·감사 기록 코드를 메모리 DB에서만 실행한다.
// Firebase Admin 모듈은 번들 단계부터 거부하며 네트워크 함수도 제공하지 않는다.
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const mocks = {
  admin: "export const adminDb=()=>globalThis.__undoFixtureDb;",
  auth: "export const requireErpUser=async()=>({uid:'fixture',email:'fixture@example.invalid'});export const accessErrorResponse=()=>null;",
  next: "export const NextResponse={json:(data,options)=>Response.json(data,options)};",
  empty: "",
  seed: "export async function seedFinanceMasterData(){throw new Error('Unexpected master seed in undo fixture')}",
  storage: "export async function deleteFiles(){throw new Error('Unexpected storage mutation in undo fixture')}",
};
const bundle = await build({
  absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", metafile: true,
  outfile: "/tmp/import-undo-guard-fixture.cjs", logLevel: "silent",
  stdin: { resolveDir: process.cwd(), loader: "ts", contents: `export {POST} from './app/api/neander/finance/mutate/route.neander.ts';export {NEANDER_COL} from './lib/neander/collections.ts';` },
  plugins: [{ name: "undo-fixture-only", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/neander\/server\/admin$/ }, () => ({ path: "admin", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/server\/auth$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/server\/storage$/ }, () => ({ path: "storage", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/neander\/finance\/server\/seed$/ }, () => ({ path: "seed", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next", namespace: "fixture" }));
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "fixture" }));
    builder.onResolve({ filter: /^(?:firebase(?:-admin)?(?:\/|$)|node:)/ }, ({ path }) => {
      throw new Error(`Network/SDK dependency forbidden in fixture: ${path}`);
    });
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
  } }],
});
assert.ok(!Object.keys(bundle.metafile.inputs).some((path) => /(?:^|\/)firebase(?:-admin)?\//.test(path)), "Firebase SDK must never enter the test bundle");

function memoryDb(seed) {
  const collections = new Map(Object.entries(seed).map(([name, docs]) => [name, new Map(Object.entries(structuredClone(docs)))]));
  const mutations = [];
  let sequence = 0;
  const getCollection = (name) => collections.get(name) ?? new Map();
  const snapshot = (name, id) => ({ id, exists: getCollection(name).has(id), data: () => structuredClone(getCollection(name).get(id)) });
  function write(kind, ref, data, options) {
    mutations.push({ kind, collection: ref.collectionName, id: ref.id });
    if (!collections.has(ref.collectionName)) collections.set(ref.collectionName, new Map());
    const docs = collections.get(ref.collectionName);
    if (kind === "delete") docs.delete(ref.id);
    else docs.set(ref.id, structuredClone(options?.merge ? { ...docs.get(ref.id), ...data } : data));
  }
  function ref(collectionName, id = `fixture-auto-${++sequence}`) {
    return { collectionName, id, get: async () => snapshot(collectionName, id),
      set: async (data, options) => write("set", { collectionName, id }, data, options),
      delete: async () => write("delete", { collectionName, id }) };
  }
  return {
    mutations,
    collection(name) {
      return {
        doc: (id) => ref(name, id),
        where(field, operator, value) {
          assert.equal(operator, "==");
          return { get: async () => ({ docs: [...getCollection(name)].filter(([, doc]) => doc[field] === value).map(([id]) => snapshot(name, id)) }) };
        },
      };
    },
    getAll: async (...refs) => refs.map((r) => snapshot(r.collectionName, r.id)),
    batch() {
      const pending = [];
      return {
        set: (ref, data, options) => pending.push(["set", ref, data, options]),
        delete: (ref) => pending.push(["delete", ref]),
        commit: async () => { for (const operation of pending) write(...operation); },
      };
    },
    dump: () => Object.fromEntries([...collections].map(([name, docs]) => [name, Object.fromEntries(docs)])),
  };
}

const module = { exports: {} }, errors = [];
const now = 1793400000000;
const sandbox = { module, exports: module.exports, Response, Request,
  Date: class extends Date { static now() { return now; } },
  console: { error: (...args) => errors.push(args.map(String).join(" ")) },
  fetch: () => { throw new Error("Network requests are forbidden in this fixture"); },
};
vm.runInNewContext(bundle.outputFiles[0].text, sandbox, { filename: "import-undo-guard-fixture.cjs" });
const { POST, NEANDER_COL: col } = module.exports;
const original = {
  date: "2026-10-10", vendor: "검증 거래", gross: 1100000, txType: "수입", last4: "4248", status: "confirmed",
  bizMajor: "B2B", bizMinor: "조향", acctMajor: "매출", acctMid: "B2B매출", acctMinor: "납품계약",
  note: "사람이 확인한 메모", receiptOf: ["fixture-project:fixture-installment"], projectCode: "PJ-FIXTURE",
  dedupHash: "2026-10-10¦4248¦검증 거래¦1100000¦수입", importBatchId: "batch", createdAt: 123, updatedBy: "original@example.invalid",
  classReason: "원본 근거", splitGroup: "fixture-parent", splitNo: 1, splitCount: 2,
};
const importDoc = { fileName: "원본.xlsx", fileHash: "fixture-hash", month: "2026-10", slotKey: "account:4248", inserted: 1, byEmail: "original@example.invalid", createdAt: 123 };
const oldLog = { txId: "kept", kind: "edit", by: "original@example.invalid", at: 124, changes: [{ f: "note", from: null, to: original.note }] };
function fixture({ empty = false, noActivity = false, extraTransactions = {} } = {}) {
  const seed = {
    [col.finTransactions]: { ...(empty ? {} : { kept: original }), unrelated: { ...original, importBatchId: "other" }, ...extraTransactions },
    [col.finImports]: { batch: { ...importDoc, ...(noActivity ? { noActivity: true } : {}) } },
    [col.finTrash]: { "keep-trash": { doc: { note: "기존 휴지통" }, deletedAt: 1 } },
    [col.finTxLog]: { "keep-log": oldLog },
  };
  const db = memoryDb(seed); sandbox.__undoFixtureDb = db;
  return { db, before: structuredClone(db.dump()), seed };
}
async function mutate(action, payload) {
  const response = await POST(new Request("https://fixture.invalid/api/neander/finance/mutate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }),
  }));
  return { status: response.status, body: await response.json() };
}
const undo = (payload) => mutate("import.undo", payload);

// 과거 UI와 truthy 문자열도 명시적 true 승인이 아니므로 쓰기 전에 멈춘다.
for (const confirmDelete of [undefined, false, "true", 1]) {
  const { db, before } = fixture();
  const result = await undo({ id: "batch", ...(confirmDelete === undefined ? {} : { confirmDelete }) });
  assert.equal(result.status, 409); assert.match(result.body.error, /기존 거래를 삭제하지 않았습니다/);
  assert.deepEqual(db.dump(), before); assert.equal(db.mutations.length, 0);
}

// 사용자가 명시적으로 되돌린 경우에만 원문 전체·파일 이력·감사 기록을 남기고 삭제한다.
{
  const { db, before } = fixture();
  const result = await undo({ id: "batch", confirmDelete: true });
  assert.deepEqual(result, { status: 200, body: { ok: true, deleted: 1 } });
  const after = db.dump();
  assert.equal(after[col.finTransactions].kept, undefined); assert.equal(after[col.finImports].batch, undefined);
  assert.deepEqual(after[col.finTransactions].unrelated, before[col.finTransactions].unrelated);
  assert.deepEqual(after[col.finTrash].kept, { doc: original, deletedAt: now, deletedBy: "fixture@example.invalid" });
  assert.deepEqual(after[col.finTrash][`import_batch_${now}`], {
    kind: "import", sourceCollection: col.finImports, sourceId: "batch", doc: importDoc, deletedAt: now, deletedBy: "fixture@example.invalid",
  });
  assert.deepEqual(after[col.finTrash]["keep-trash"], before[col.finTrash]["keep-trash"]);
  assert.deepEqual(after[col.finTxLog]["keep-log"], oldLog);
  const addedLogs = Object.entries(after[col.finTxLog]).filter(([id]) => id !== "keep-log").map(([, entry]) => entry);
  assert.deepEqual(addedLogs, [{ txId: "kept", at: now, by: "fixture@example.invalid", kind: "delete", via: "import" }]);
}

// 빈 '거래 없음' 배치는 거래 삭제 확인 없이 메타데이터만 되돌릴 수 있다.
{
  const { db, before } = fixture({ empty: true, noActivity: true });
  const result = await undo({ id: "batch" });
  assert.deepEqual(result, { status: 200, body: { ok: true, deleted: 0 } });
  const after = db.dump();
  assert.deepEqual(after[col.finTransactions], before[col.finTransactions]);
  assert.deepEqual(after[col.finTxLog], before[col.finTxLog]);
  assert.equal(after[col.finImports].batch, undefined);
  assert.deepEqual(after[col.finTrash][`import_batch_${now}`].doc, before[col.finImports].batch);
  assert.ok(db.mutations.every((entry) => entry.collection === col.finImports || entry.collection === col.finTrash));
}

// 메타데이터의 잘못된 noActivity 값보다 실제 거래 존재 여부가 우선한다.
{
  const { db, before } = fixture({ noActivity: true });
  const result = await undo({ id: "batch" });
  assert.equal(result.status, 409); assert.deepEqual(db.dump(), before); assert.equal(db.mutations.length, 0);
}

// 원장/편집기가 현재 유형으로 중복 키를 재계산해 보내도 적재 원본 키는 유지한다.
// 실제 사실·분류·메모 수정은 저장하며, 적재 출처가 없는 수동 거래는 키 수정도 허용한다.
for (const action of ["transaction.update", "transaction.bulkPatch", "transaction.applyEdits"]) {
  const { importBatchId: _batch, ...withoutBatch } = original;
  const manual = { ...withoutBatch, dedupHash: "manual-original-key" };
  const claim = { ...withoutBatch, dedupHash: "claim-original-key", expenseClaim: {
    claimId: "fixture-claim", payer: "검증자", payerKey: "검증자", fileName: "개인경비.xlsx", rowNo: 2,
  } };
  const { db, before } = fixture({ extraTransactions: { manual, claim } });
  const ids = ["kept", "manual", "claim"];
  const patch = {
    txType: "지출", date: "2026-10-12", gross: 1200000, vendor: "수정한 거래처", note: "수정한 메모",
    bizMajor: "공용", bizMinor: "공용", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "일반소모품비",
    dedupHash: "changed",
  };
  const responses = [];
  if (action === "transaction.update") {
    for (const id of ids) responses.push(await mutate(action, { id, patch, via: "editor" }));
  } else if (action === "transaction.bulkPatch") {
    responses.push(await mutate(action, { ids, patch, via: "ledger" }));
  } else {
    responses.push(await mutate(action, { updates: ids.map((id) => ({ id, patch })), inserts: [], deletes: [], via: "ledger" }));
  }
  assert.ok(responses.every((result) => result.status === 200 && result.body.ok), action);
  const after = db.dump();
  for (const id of ids) {
    const row = after[col.finTransactions][id];
    for (const [field, value] of Object.entries(patch)) {
      if (field !== "dedupHash") assert.deepEqual(row[field], value, `${action}/${id}: ${field} 수정은 반영`);
    }
    assert.equal(row.dedupHash, id === "manual" ? "changed" : before[col.finTransactions][id].dedupHash, `${action}/${id}: 원본 키 보호 범위`);
    assert.equal(row.status, "confirmed"); assert.deepEqual(row.receiptOf, original.receiptOf);
    assert.equal(row.updatedAt, now); assert.equal(row.updatedBy, "fixture@example.invalid");
  }
  assert.deepEqual(after[col.finTransactions].unrelated, before[col.finTransactions].unrelated);
  assert.deepEqual(after[col.finImports], before[col.finImports]);
  assert.deepEqual(after[col.finTrash], before[col.finTrash]);
  assert.deepEqual(after[col.finTransactions].claim.expenseClaim, claim.expenseClaim);
  const returned = responses.flatMap((response) => response.body.transactions);
  assert.equal(returned.length, ids.length);
  assert.ok(returned.every((row) => !("dedupHash" in row) && !("importBatchId" in row)), "보호된 숨김 필드가 클라이언트 응답으로 새지 않는다");
  const addedLogs = Object.entries(after[col.finTxLog]).filter(([id]) => id !== "keep-log").map(([, log]) => log);
  assert.equal(addedLogs.length, ids.length, `${action}: 변경 기록 보존`);
  assert.ok(addedLogs.every((log) => log.kind === "edit" && log.changes.some((change) => change.f === "gross" && change.to === patch.gross)));
}
assert.deepEqual(errors, [], "실제 route/helper 내부 오류가 없어야 한다");
console.log("PASS import undo guard: unacknowledged deletion has zero writes; explicit undo preserves originals/metadata/audit; empty and false-noActivity guards; update/bulkPatch/applyEdits preserve import/claim source keys while saving edited facts and permitting manual keys. No Firebase initialization or network.");
