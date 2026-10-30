"use client";

import { getNeanderAuth } from "@/lib/neander/firebase";
import {
  GRANT_FILE_PART_BYTES,
  GRANT_FILE_READ_PARTS,
  validateGrantFileMeta,
  type GrantFile,
} from "./grant-files";

const URL_ = "/api/neander/finance/grants/files";

async function token() {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

async function readError(response: Response) {
  try {
    return ((await response.json()) as { error?: string }).error || `요청이 실패했습니다 (HTTP ${response.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${response.status})`;
  }
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("파일 전송을 취소했습니다.", "AbortError");
}

async function post<T>(body: object, signal?: AbortSignal): Promise<T> {
  checkCancelled(signal);
  const response = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw Object.assign(new Error(await readError(response)), { status: response.status });
  return response.json() as Promise<T>;
}

export async function fetchGrantFiles(grantId: string, signal?: AbortSignal): Promise<GrantFile[]> {
  const response = await fetch(`${URL_}?grantId=${encodeURIComponent(grantId)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { files?: GrantFile[] }).files ?? [];
}

export async function deleteGrantFile(grantId: string, id: string, signal?: AbortSignal): Promise<void> {
  await post({ action: "delete", grantId, id }, signal);
}

const toBase64 = (bytes: ArrayBuffer) => {
  const view = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
};

async function uploadOne(grantId: string, file: File, onProgress: (bytes: number) => void, signal?: AbortSignal) {
  checkCancelled(signal);
  const checked = validateGrantFileMeta({ name: file.name, type: file.type, size: file.size, sha256: "0".repeat(64) });
  if (!checked.ok) throw new Error(checked.error);
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  checkCancelled(signal);
  const sha256 = [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
  const parsed = validateGrantFileMeta({ name: file.name, type: file.type, size: file.size, sha256 });
  if (!parsed.ok) throw new Error(parsed.error);
  const made = await post<{ id: string; partBytes: number; parts: number } | { duplicate: GrantFile }>({
    action: "create", grantId, ...parsed.value,
  });
  if ("duplicate" in made) {
    onProgress(file.size);
    return { file: made.duplicate, duplicate: true };
  }
  const { id, partBytes, parts } = made;
  let completing = false;
  try {
    checkCancelled(signal);
    if (partBytes !== GRANT_FILE_PART_BYTES || parts !== Math.ceil(file.size / partBytes)) throw new Error("파일 전송 정보를 확인하지 못했습니다.");
    let sent = 0;
    const one = async (n: number) => {
      checkCancelled(signal);
      const bytes = await file.slice(n * partBytes, (n + 1) * partBytes).arrayBuffer();
      const body = { action: "part", grantId, id, n, base64: toBase64(bytes) };
      for (let attempt = 0; ; attempt++) {
        try {
          await post(body, signal);
          break;
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (signal?.aborted || attempt >= 2 || (status && status !== 429 && status < 500)) throw e;
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
      sent += bytes.byteLength;
      onProgress(Math.min(file.size - 1, sent));
    };
    for (let n = 0; n < parts; n += 3) {
      // 실패한 조각이 있어도 진행 중인 요청이 끝난 뒤 정리한다.
      const results = await Promise.allSettled([n, n + 1, n + 2].filter((i) => i < parts).map(one));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    }
    checkCancelled(signal);
    // 확인을 시작한 파일은 완료까지 기다려 취소로 저장된 원본을 지우지 않는다.
    completing = true;
    const { file: saved } = await post<{ file: GrantFile }>({ action: "done", grantId, id });
    onProgress(file.size);
    return { file: saved, duplicate: false };
  } catch (e) {
    if (completing) {
      // 저장은 끝났지만 응답만 끊긴 경우에는 완성된 파일을 지우지 않는다.
      try {
        const saved = (await fetchGrantFiles(grantId)).find((f) => f.id === id);
        if (saved) {
          onProgress(file.size);
          return { file: saved, duplicate: false };
        }
      } catch { /* 연결이 돌아오면 목록에서 완료 여부를 확인한다. */ }
    } else await deleteGrantFile(grantId, id).catch(() => undefined);
    throw e;
  }
}

export interface GrantFileUploadReport {
  added: GrantFile[];
  duplicates: GrantFile[];
  failed: { name: string; error: string }[];
  cancelled: boolean;
}

export async function uploadGrantFiles(
  grantId: string,
  files: File[],
  onProgress?: (progress: number, name: string) => void,
  signal?: AbortSignal,
): Promise<GrantFileUploadReport> {
  const report: GrantFileUploadReport = { added: [], duplicates: [], failed: [], cancelled: false };
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let done = 0;
  for (const file of files) {
    if (signal?.aborted) break;
    onProgress?.(total ? done / total : 0, file.name);
    try {
      const result = await uploadOne(grantId, file, (sent) => onProgress?.(total ? (done + sent) / total : 0, file.name), signal);
      (result.duplicate ? report.duplicates : report.added).push(result.file);
    } catch (e) {
      if (signal?.aborted) break;
      report.failed.push({ name: file.name, error: e instanceof Error ? e.message : "파일을 올리지 못했습니다." });
    }
    done += file.size;
    onProgress?.(total ? done / total : 1, file.name);
  }
  report.cancelled = signal?.aborted ?? false;
  return report;
}

async function readGrantFile(grantId: string, file: GrantFile, signal?: AbortSignal): Promise<Blob> {
  checkCancelled(signal);
  const headers = { Authorization: `Bearer ${await token()}` };
  const parts = Math.ceil(file.size / GRANT_FILE_PART_BYTES);
  const buffers: ArrayBuffer[] = [];
  let size = 0;
  for (let from = 0; from < parts; from += GRANT_FILE_READ_PARTS) {
    const query = new URLSearchParams({ grantId, id: file.id, from: String(from), count: String(GRANT_FILE_READ_PARTS) });
    const response = await fetch(`${URL_}?${query}`, { headers, cache: "no-store", signal });
    if (!response.ok) throw new Error(await readError(response));
    const bytes = await response.arrayBuffer();
    size += bytes.byteLength;
    buffers.push(bytes);
  }
  if (size !== file.size) throw new Error("파일을 모두 받지 못했습니다. 다시 시도해 주세요.");
  checkCancelled(signal);
  return new Blob(buffers, { type: file.type || "application/octet-stream" });
}

function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const canPreviewGrantFile = (file: GrantFile) => ["application/pdf", "image/png", "image/jpeg"].includes(file.type);

export async function downloadGrantFile(grantId: string, file: GrantFile, signal?: AbortSignal): Promise<void> {
  saveAs(await readGrantFile(grantId, file, signal), file.name);
}

export async function openGrantFile(grantId: string, file: GrantFile, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  if (!canPreviewGrantFile(file)) return downloadGrantFile(grantId, file, signal);
  const opened = window.open("", "_blank");
  if (opened) {
    opened.opener = null;
    opened.document.title = "파일을 불러오는 중";
    opened.document.body.textContent = "파일을 불러오는 중입니다…";
  }
  try {
    const blob = await readGrantFile(grantId, file, signal);
    if (opened?.closed) return;
    if (!opened) return saveAs(blob, file.name);
    const url = URL.createObjectURL(blob);
    opened.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    opened?.close();
    throw e;
  }
}
