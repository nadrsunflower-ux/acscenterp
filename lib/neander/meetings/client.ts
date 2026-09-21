"use client";

// ============================================================
//  회의 첨부 파일 클라이언트 — 서버 API 경유
// ------------------------------------------------------------
//  첨부 컬렉션은 보안 규칙에 없어 브라우저가 직접 못 읽는다
//  (app/api/neander/meetings/files). 회의록 본문은 지금처럼 브라우저가
//  Firestore 를 직접 구독한다 — 여기는 첨부만.
//
//  올리기·받기는 메일 첨부(mail/client.ts)와 같은 조각 방식이다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import { MEETING_FILE_PART_BYTES, type MeetingFile } from "./types";

const BASE = "/api/neander/meetings/files";

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

async function post<T>(body: object): Promise<T> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** 모든 회의의 첨부 */
export async function fetchMeetingFiles(): Promise<MeetingFile[]> {
  const res = await fetch(BASE, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { files: MeetingFile[] }).files;
}

export const deleteMeetingFile = (id: string) => post({ action: "delete", id });

/** 회의를 지우기 전에 그 회의의 첨부를 모두 지운다 */
export const deleteFilesOfMeeting = (meetingId: string) => post({ action: "delete-meeting", meetingId });

// ---- 올리기 --------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 회의에 파일을 올린다 — 진행률(0~1)을 알려 준다. 중간에 실패하면 올린 조각을 치운다 */
export async function uploadMeetingFile(meetingId: string, file: File, onProgress?: (p: number) => void): Promise<MeetingFile> {
  const { id, partBytes, parts } = await post<{ id: string; partBytes: number; parts: number }>({
    action: "create",
    meetingId,
    name: file.name,
    type: file.type,
    size: file.size,
  });
  try {
    let done = 0;
    const one = async (n: number) => {
      const buf = await file.slice(n * partBytes, (n + 1) * partBytes).arrayBuffer();
      await post({ action: "part", id, n, base64: toBase64(buf) });
      done++;
      onProgress?.(done / parts);
    };
    // 세 조각씩 나란히
    for (let n = 0; n < parts; n += 3) await Promise.all([n, n + 1, n + 2].filter((i) => i < parts).map(one));
    return (await post<{ file: MeetingFile }>({ action: "done", id })).file;
  } catch (e) {
    void deleteMeetingFile(id).catch(() => undefined);
    throw e;
  }
}

// ---- 받기 · 열기 ---------------------------------------------

/** 노션으로 옮긴 파일의 새 주소 — 1시간이면 만료되므로 누를 때마다 받는다 */
export async function archivedFileUrl(id: string): Promise<string> {
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  const { url } = (await res.json()) as { url?: string };
  if (!url) throw new Error("노션에서 파일 주소를 받지 못했습니다.");
  return url;
}

async function readMeetingFile(f: MeetingFile): Promise<Blob> {
  const auth = { Authorization: `Bearer ${await token()}` };
  const parts = Math.ceil(f.size / MEETING_FILE_PART_BYTES);
  const chunks: ArrayBuffer[] = [];
  for (let from = 0; from < parts; from += 5) {
    const r = await fetch(`${BASE}?id=${encodeURIComponent(f.id)}&from=${from}&count=5`, { headers: auth, cache: "no-store" });
    if (!r.ok) throw new Error(await readError(r));
    chunks.push(await r.arrayBuffer());
  }
  // 글 파일은 문자셋을 붙여야 한글이 안 깨진다
  const type = f.type === "text/plain" ? "text/plain;charset=utf-8" : f.type || "application/octet-stream";
  return new Blob(chunks, { type });
}

function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 브라우저가 그 자리에서 보여 주는 형식 — 새 탭에서 연다. 나머지(한글·엑셀 등)는 내려받는다 */
export const canPreviewMeetingFile = (f: MeetingFile) =>
  /^(image\/|video\/|audio\/|text\/plain|application\/pdf)/.test(f.type);

export async function downloadMeetingFile(f: MeetingFile): Promise<void> {
  if (f.archive) return openArchived(f);
  saveAs(await readMeetingFile(f), f.name);
}

/**
 * 노션에 보관된 파일 — 새 탭에서 연다. 창을 **클릭 시점에 먼저** 열어 둔다
 * (주소를 받아 오는 사이에 window.open 을 부르면 팝업으로 막힌다).
 */
async function openArchived(f: MeetingFile): Promise<void> {
  const w = window.open("", "_blank");
  try {
    const url = await archivedFileUrl(f.id);
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

/**
 * 새 탭에서 연다. 창을 **클릭 시점에 먼저** 열어 둔다 — 조각을 받는 사이(await)에
 * window.open 을 부르면 브라우저가 팝업으로 보고 막는다 (finance/DocFiles 와 같은 이유).
 */
export async function openMeetingFile(f: MeetingFile): Promise<void> {
  if (f.archive) return openArchived(f);
  if (!canPreviewMeetingFile(f)) return downloadMeetingFile(f);
  const w = window.open("", "_blank");
  try {
    const blob = await readMeetingFile(f);
    if (!w) return saveAs(blob, f.name);
    const url = URL.createObjectURL(blob);
    w.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}
