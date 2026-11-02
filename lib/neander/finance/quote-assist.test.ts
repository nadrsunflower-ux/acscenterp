import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuoteAssistClient } from "./quote-assist-client";
import { QUOTE_ASSIST_LIMITS, QuoteAssistError, normalizeQuoteAssistResult, parseQuoteAssistResponse, validateQuoteAssistInput } from "./quote-assist";

test("AI amounts use explicit prices only, retain zero quantity and strip unknown properties", () => {
  const result = normalizeQuoteAssistResult("items", { title: "  견적  ", projectId: "other", lines: [
    { id: "untrusted", name: "무료", qty: 0, unitPrice: 0, priceProvided: true, private: "drop" },
    { name: "직접 제시한 단가", qty: 1.5, unitPrice: 1234.6, priceProvided: true },
    { name: "모델이 추측한 단가", qty: 1, unitPrice: 900000 },
  ] });
  assert.equal(result.mode, "items");
  if (result.mode !== "items") return;
  assert.equal(result.title, "견적");
  assert.equal(result.lines[0].qty, 0);
  assert.equal(result.lines[0].unitPrice, 0);
  assert.notEqual(result.lines[0].id, "untrusted");
  assert.equal("private" in result.lines[0], false);
  assert.equal("projectId" in result, false);
  assert.equal(result.lines[1].qty, 1.5);
  assert.equal(result.lines[1].unitPrice, 1235);
  assert.equal(result.lines[2].unitPrice, 0);
  assert.match(result.warnings?.join(" ") ?? "", /모델이 추측한 단가/);
});

test("invalid or excessive quantities and amounts cannot reach ERP totals", () => {
  const result = normalizeQuoteAssistResult("items", { lines: [
    { name: "무한", qty: Infinity, unitPrice: Infinity, priceProvided: true },
    { name: "음수", qty: -1, unitPrice: -100, priceProvided: true },
    { name: "품목 금액 초과", qty: 1_000_000, unitPrice: 1_000_000_000, priceProvided: true },
  ] });
  if (result.mode !== "items") return;
  for (const line of result.lines) {
    assert.ok(Number.isFinite(line.qty));
    assert.ok(Number.isFinite(line.unitPrice));
    assert.ok(line.qty >= 0 && line.qty <= QUOTE_ASSIST_LIMITS.qty);
    assert.equal(line.unitPrice, 0);
  }
  assert.ok(result.warnings?.length);
});

test("receiver OCR keeps only named business fields and formats a ten digit number", () => {
  assert.deepEqual(normalizeQuoteAssistResult("receiver", { recipient: "  고객사 ", receiver: { ceo: "대표", bizNo: "1234567890", address: "서울", residentNo: "drop" }, supplier: { name: "drop" } }), {
    mode: "receiver", recipient: "고객사", receiver: { ceo: "대표", bizNo: "123-45-67890", address: "서울" },
  });
  assert.throws(() => normalizeQuoteAssistResult("receiver", { receiver: { bizNo: "123" } }), QuoteAssistError);
});

test("empty, excessive and malformed provider results are rejected", () => {
  assert.throws(() => normalizeQuoteAssistResult("items", { lines: [] }), /견적 품목/);
  assert.throws(() => normalizeQuoteAssistResult("items", { lines: Array.from({ length: 101 }, () => ({ name: "a" })) }), /100개/);
  assert.throws(() => parseQuoteAssistResponse("items", "not JSON"), /분석 결과/);
  assert.equal(parseQuoteAssistResponse("receiver", '```json\n{"recipient":"고객사","receiver":{}}\n```').mode, "receiver");
});

test("input validation bounds content, files and project IDs", () => {
  validateQuoteAssistInput({ mode: "items", projectId: "project", text: "0원 견적" });
  assert.throws(() => validateQuoteAssistInput({ mode: "items", projectId: "../other", text: "내용" }), /프로젝트/);
  assert.throws(() => validateQuoteAssistInput({ mode: "items", projectId: "project", text: "a".repeat(20001) }), /20,000/);
  assert.throws(() => validateQuoteAssistInput({ mode: "items", projectId: "project", file: { name: "large.pdf", type: "application/pdf", size: QUOTE_ASSIST_LIMITS.fileBytes + 1 } }), /4MB/);
  assert.throws(() => validateQuoteAssistInput({ mode: "receiver", projectId: "project", file: { name: "source.svg", type: "image/svg+xml", size: 100 } }), /PNG/);
});

test("client sends authenticated multipart without saving a document", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createQuoteAssistClient(async () => "test-token", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ mode: "items", lines: [{ id: "line", name: "품목", qty: 0, unitPrice: 0 }] });
  });
  const result = await client({ mode: "items", projectId: "project", text: "  내용  " });
  assert.equal(result.mode, "items");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/neander/finance/ai/quote");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].init?.headers, { Authorization: "Bearer test-token" });
  assert.ok(calls[0].init?.signal);
  const form = calls[0].init?.body as FormData;
  assert.equal(form.get("projectId"), "project");
  assert.equal(form.get("text"), "내용");
  assert.equal(form.get("mode"), "items");
});

test("missing authentication prevents a client network request", async () => {
  let calls = 0;
  const client = createQuoteAssistClient(async () => { throw new Error("로그인이 필요합니다."); }, async () => { calls++; return Response.json({}); });
  await assert.rejects(client({ mode: "items", projectId: "project", text: "내용" }), /로그인/);
  assert.equal(calls, 0);
});

test("client rejects an analysis response for another mode", async () => {
  const client = createQuoteAssistClient(async () => "test-token", async () => Response.json({ mode: "receiver", receiver: {} }));
  await assert.rejects(client({ mode: "items", projectId: "project", text: "내용" }), /형식/);
});
