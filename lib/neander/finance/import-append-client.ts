"use client";

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { ImportAppendInput, ImportAppendResult } from "./import-append";

export async function hashImportFile(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 원장은 서버에서 다시 대조한다. 기존 거래를 삭제하거나 덮어쓰지 않는다. */
export async function appendFinImport(input: ImportAppendInput): Promise<ImportAppendResult> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const response = await fetch("/api/neander/finance/import-append", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `파일을 갱신하지 못했습니다 (HTTP ${response.status}). 기존 거래는 유지됩니다.`;
    try { message = ((await response.json()) as { error?: string }).error || message; } catch { /* 본문이 없을 수 있다. */ }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json() as Promise<ImportAppendResult>;
}
