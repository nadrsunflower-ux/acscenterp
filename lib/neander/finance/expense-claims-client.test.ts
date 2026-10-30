import assert from "node:assert/strict";
import { test } from "node:test";
import { createExpenseClaimsClient } from "./expense-claims-client";
import type { ExpenseClaimImportInput } from "./expense-claims";

function mockClient(body: unknown = {}, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createExpenseClaimsClient(async () => "mock-auth-only", async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { client, calls };
}

test("creating the client does not read or write the API", () => {
  const { calls } = mockClient();
  assert.equal(calls.length, 0);
});

test("listing is an authenticated abortable GET with no mutation body", async () => {
  const { client, calls } = mockClient({ claims: [{ id: "claim-1" }] });
  const controller = new AbortController();
  assert.deepEqual(await client.list(controller.signal), [{ id: "claim-1" }]);
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.signal, controller.signal);
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer mock-auth-only");
});

test("import preserves distinct same-day source rows, raw memo and optional empty project", async () => {
  const row = { rowNo: 8, date: "2026-10-29", vendor: "테스트 가맹점", gross: 12000, txType: "지출" as const,
    bizMajor: "공용", bizMinor: "공용", acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "소모품비", note: "원본 계정: 공용 · 프로젝트 미지정" };
  const input: ExpenseClaimImportInput = { payer: "테스트 결제자", site: "네안데르", fileName: "내역.xlsx", fileHash: "a".repeat(64), rows: [row, { ...row, rowNo: 9 }] };
  const { client, calls } = mockClient({ claim: { id: "claim-1" }, transactions: [], inserted: 2, skipped: 0 });
  const result = await client.import(input);
  const sent = JSON.parse(String(calls[0].init?.body));
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(sent, { action: "import", input });
  assert.equal(sent.input.rows.length, 2);
  assert.notEqual(sent.input.rows[0].rowNo, sent.input.rows[1].rowNo);
  assert.equal("last4" in sent.input.rows[0], false);
  assert.equal(sent.input.rows[0].projectCode, undefined);
  assert.equal(sent.input.rows[0].note, row.note);
  assert.equal(result.inserted, 2);
});

test("settlement methods send existing transaction IDs without creating amounts or receipts", async () => {
  const { client, calls } = mockClient({ ok: true, transactions: [] });
  await client.linkSettlement("claim-1", "bank-tx-1");
  await client.unlinkSettlement("claim-1", "bank-tx-1");
  assert.deepEqual(calls.map((call) => JSON.parse(String(call.init?.body))), [
    { action: "linkSettlement", claimId: "claim-1", txId: "bank-tx-1" },
    { action: "unlinkSettlement", claimId: "claim-1", txId: "bank-tx-1" },
  ]);
});

test("cancel uses the exact encoded claim ID and returns removed IDs for the local store", async () => {
  const { client, calls } = mockClient({ ok: true, removed: 1, removedIds: ["expense-1"], transactions: [] });
  const result = await client.cancel("claim/one");
  assert.equal(calls[0].url, "/api/neander/finance/expense-claims?id=claim%2Fone");
  assert.equal(calls[0].init?.method, "DELETE");
  assert.equal(calls[0].init?.body, undefined);
  assert.deepEqual(result.removedIds, ["expense-1"]);
});

test("authentication failure prevents any network write", async () => {
  let requests = 0;
  const client = createExpenseClaimsClient(async () => { throw new Error("로그인이 필요합니다."); }, async () => {
    requests += 1;
    return new Response("{}");
  });
  await assert.rejects(client.linkSettlement("claim-1", "bank-tx-1"), /로그인이 필요/);
  assert.equal(requests, 0);
});

test("server rejection stays a rejection with the supplied status and message", async () => {
  const { client, calls } = mockClient({ error: "이미 상환에 연결된 출금입니다." }, 409);
  await assert.rejects(client.linkSettlement("claim-1", "bank-tx-1"), (error: unknown) => {
    assert.equal((error as Error).message, "이미 상환에 연결된 출금입니다.");
    assert.equal((error as { status: number }).status, 409);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("non-JSON API errors show HTTP status without retrying a mutation", async () => {
  let requests = 0;
  const client = createExpenseClaimsClient(async () => "mock-auth-only", async () => {
    requests += 1;
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(client.cancel("claim-1"), /HTTP 503/);
  assert.equal(requests, 1);
});
