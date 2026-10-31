import "server-only";

// 쇼츠 API 공용 — 오류를 사람이 읽을 응답으로. 접근 오류는 그 상태 코드 그대로.
import { NextResponse } from "next/server";
import { accessErrorResponse } from "@/lib/neander/server/auth";
import { CoupangApiError } from "./coupang";
import { PublishingError } from "./platforms";

export function fail(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  if (e instanceof PublishingError) return NextResponse.json({ error: e.message, code: e.code, uncertain: e.uncertain }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
  if (e instanceof CoupangApiError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 400 });
}

export const json = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
