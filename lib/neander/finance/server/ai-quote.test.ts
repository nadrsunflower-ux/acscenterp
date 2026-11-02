import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { createQuoteAssistHandler, quoteAssistContent, runQuoteAssist } from "./ai-quote";
import type { QuoteAssistInput, QuoteAssistResult } from "../quote-assist";

const draft: QuoteAssistResult = { mode: "items", lines: [{ id: "draft", name: "항목", qty: 1, unitPrice: 0 }] };
const request = (mode = "items", text = "항목 내용", file?: File) => {
  const form = new FormData();
  form.set("mode", mode);
  form.set("projectId", "project");
  if (text) form.set("text", text);
  if (file) form.set("file", file);
  return new Request("https://erp.test/api/neander/finance/ai/quote", { method: "POST", body: form });
};

test("handler denies before parsing the form, reading the project or calling AI", async () => {
  let parsed = 0;
  let checked = 0;
  let analyzed = 0;
  const denial = new Error("denied");
  const handler = createQuoteAssistHandler({
    authenticate: async () => { throw denial; },
    accessDenied: (e) => e === denial ? Response.json({ error: "권한 없음" }, { status: 403 }) : null,
    projectExists: async () => { checked++; return true; },
    assist: async () => { analyzed++; return draft; },
  });
  const req = request();
  req.formData = async () => { parsed++; return new FormData(); };
  assert.equal((await handler(req)).status, 403);
  assert.deepEqual([parsed, checked, analyzed], [0, 0, 0]);
});

test("handler checks a stored project before analyzing and returns a draft only", async () => {
  const seen: string[] = [];
  let input: QuoteAssistInput | undefined;
  const handler = createQuoteAssistHandler({
    authenticate: async () => { seen.push("auth"); },
    accessDenied: () => null,
    projectExists: async (id) => { seen.push(id); return true; },
    assist: async (value) => { seen.push("assist"); input = value; return draft; },
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), draft);
  assert.deepEqual(seen, ["auth", "project", "assist"]);
  assert.equal(input?.mode, "items");
  assert.equal(input?.text, "항목 내용");
});

test("missing projects and oversized files do not invoke AI", async () => {
  let analyzed = 0;
  const handler = createQuoteAssistHandler({ authenticate: async () => {}, accessDenied: () => null, projectExists: async () => false, assist: async () => { analyzed++; return draft; } });
  assert.equal((await handler(request())).status, 404);
  assert.equal((await handler(request("items", "", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" })))).status, 400);
  assert.equal(analyzed, 0);
});

test("PDF uses a native file part, and mislabeled bytes cannot become an image", async () => {
  const pdf = new File(["%PDF-1.7\nsource"], "source.pdf", { type: "application/pdf" });
  const parts = await quoteAssistContent({ mode: "receiver", projectId: "project", file: pdf });
  assert.equal(parts[0].type, "file");
  if (parts[0].type === "file") assert.match(parts[0].file.file_data, /^data:application\/pdf;base64,/);
  await assert.rejects(quoteAssistContent({ mode: "receiver", projectId: "project", file: new File(["not an image"], "source.png", { type: "image/png" }) }), /이미지/);
});

test("Office files go through document extraction instead of binary text decoding", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["품명", "수량", "단가"], ["조향 체험", 20, 30000]]), "견적");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const file = new File([bytes], "source.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const content = await quoteAssistContent({ mode: "items", projectId: "project", file });
  assert.equal(content[0].type, "text");
  if (content[0].type === "text") {
    assert.match(content[0].text, /조향 체험,20,30000/);
    assert.doesNotMatch(content[0].text, /PK\u0003/);
  }
  await assert.rejects(quoteAssistContent({ mode: "items", projectId: "project", file: new File(["a".repeat(20_001)], "source.txt", { type: "text/plain" }) }), /20,000/);
});

test("provider errors never expose raw error bodies or keys", async () => {
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-placeholder";
  try {
    await assert.rejects(runQuoteAssist({ mode: "items", projectId: "project", text: "내용" }, async () => new Response("sensitive-provider-error", { status: 500 })), (error: unknown) => error instanceof Error && !/sensitive|test-placeholder/.test(error.message) && /분석하지 못/.test(error.message));
  } finally {
    if (old === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = old;
  }
});

test("provider request uses a bounded timeout and a source-only price prompt", async () => {
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-placeholder";
  try {
    let payload: Record<string, unknown> = {};
    let signal: AbortSignal | null | undefined;
    const result = await runQuoteAssist({ mode: "items", projectId: "project", text: "품목 3개 단가 1000원" }, async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      signal = init?.signal;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ lines: [{ name: "품목", qty: 3, unitPrice: 1000, priceProvided: true }] }) } }] });
    });
    assert.ok(signal);
    assert.match(JSON.stringify(payload.messages), /단가를 추정하거나 만들어 넣지/);
    assert.equal(result.mode, "items");
    if (result.mode === "items") assert.equal(result.lines[0].unitPrice, 1000);
  } finally {
    if (old === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = old;
  }
});
