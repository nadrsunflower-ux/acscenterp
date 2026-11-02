"use client";

import { getNeanderAuth } from "@/lib/neander/firebase";
import { validateQuoteAssistInput, type QuoteAssistInput, type QuoteAssistResult } from "./quote-assist";

async function authToken(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

/** 테스트에서는 토큰과 요청만 바꾼다. 실제 서비스에 접근하지 않는다. */
export function createQuoteAssistClient(getToken = authToken, request: typeof fetch = (...args) => fetch(...args)) {
  return async (input: QuoteAssistInput): Promise<QuoteAssistResult> => {
    validateQuoteAssistInput(input);
    const token = await getToken();
    const form = new FormData();
    form.set("mode", input.mode);
    form.set("projectId", input.projectId);
    if (input.text?.trim()) form.set("text", input.text.trim());
    if (input.file) form.set("file", input.file);
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 95_000);
    try {
      response = await request("/api/neander/finance/ai/quote", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw new Error("분석 시간이 길어졌습니다. 내용을 나누어 다시 시도해 주세요.");
      throw new Error("분석 요청을 보내지 못했습니다. 연결을 확인해 주세요.");
    } finally {
      clearTimeout(timeout);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error("분석 응답을 읽지 못했습니다. 다시 시도해 주세요."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("분석 결과의 형식을 확인하지 못했습니다. 다시 시도해 주세요.");
    const result = body as Partial<QuoteAssistResult> & { error?: unknown };
    if (!response.ok) throw Object.assign(new Error(typeof result.error === "string" ? result.error : "분석하지 못했습니다. 다시 시도해 주세요."), { status: response.status });
    if (result.mode !== input.mode || (result.mode === "items" && !Array.isArray(result.lines)) || (result.mode === "receiver" && (!result.receiver || typeof result.receiver !== "object"))) throw new Error("분석 결과의 형식을 확인하지 못했습니다. 다시 시도해 주세요.");
    return result as QuoteAssistResult;
  };
}

export const requestQuoteAssist = createQuoteAssistClient();
