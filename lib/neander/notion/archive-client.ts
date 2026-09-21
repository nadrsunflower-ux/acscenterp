import "server-only";

// ============================================================
//  노션 보관 — 쓰기 · 파일 올리기 (서버 전용)
// ------------------------------------------------------------
//  오래된 회의 자료를 노션으로 옮길 때만 쓴다 (meetings/server/archive.ts).
//
//  ⚠️ 비서가 쓰는 읽기 전용 연결(notion/client.ts · NOTION_TOKEN)과 **토큰을
//     나눈다**. 이쪽은 NOTION_ARCHIVE_TOKEN 이고, 노션에서 보관함 페이지
//     하나에만 공유한 별도 연결이다. 그래야 비서는 여전히 아무것도 못 쓰고,
//     이 연결이 새어도 건드릴 수 있는 건 보관함뿐이다 (docs/notion-archive.md).
//
//  노션 파일 올리기 규격 (2026-09-21 확인, Notion-Version 2026-03-11):
//    1) POST /v1/file_uploads            {filename, content_type, mode, number_of_parts?}
//       → { id, upload_url, complete_url, status, expiry_time }
//    2) POST /v1/file_uploads/{id}/send  multipart/form-data: file(, part_number)
//    3) 20MiB 가 넘으면 mode="multi_part" 로 만들고 조각마다 2)를 부른 뒤
//       POST /v1/file_uploads/{id}/complete
//    4) 올린 파일은 **1시간 안에** 블록·속성에 붙여야 한다. 붙이고 나면 영구다.
//    5) 노션이 주는 내려받기 주소도 1시간이면 만료된다 — 그래서 ERP 는 주소를
//       저장하지 않고, 받을 때마다 블록을 다시 읽어 새 주소를 받는다.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { gzipSync } from "node:zlib";
import { NOTION_VERSION } from "./client";

const NOTION_API = "https://api.notion.com/v1";
/** 파일을 올리는 동안은 넉넉히 — 30MB 를 보내는 요청이다 */
const TIMEOUT_MS = 120_000;
/** 이 크기를 넘으면 조각내서 올린다 (노션 규칙: 20MiB) */
export const NOTION_SINGLE_MAX = 20 * 1024 * 1024;
/** 조각 하나 크기 — 마지막 조각 말고는 5MiB 이상이어야 한다 */
const PART_BYTES = 10 * 1024 * 1024;

/**
 * 노션이 받는 확장자 (2026-09-22 문서 확인). 목록에 없으면 거절한다 —
 * 「Provided filename has an extension that is not supported」.
 * 우리 첨부에는 한글(.hwp)·알집(.alz) 처럼 목록에 없는 것이 흔해서, 그런 파일은
 * **gzip 으로 감싸** `회의자료.hwp.gz` 로 올린다. 내려받아 풀면 원래 이름이 돌아온다.
 */
const NOTION_AUDIO_EXT = new Set(["aac", "adts", "mid", "midi", "mp3", "mpga", "m4a", "m4b", "oga", "ogg", "opus", "wav", "wma", "weba", "flac"]);
const NOTION_EXT = new Set([
  ...NOTION_AUDIO_EXT,
  // 문서
  "pdf", "txt", "csv", "json", "js", "ts", "tsx", "py", "doc", "dot", "docx", "dotx", "xls", "xlt", "xla", "xlsx", "xltx",
  "ppt", "pot", "pps", "ppa", "pptx", "potx", "rtf", "md", "markdown", "html", "htm", "epub", "xml", "css", "odt", "ods",
  "odp", "ics", "yaml", "yml", "tsv", "zip", "gz", "gzip", "tar", "7z", "bz2", "rar",
  // 그림
  "gif", "heic", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp", "ico", "bmp", "avif", "apng",
  // 동영상 (mp4 는 소리에도 쓴다)
  "amv", "asf", "wmv", "avi", "f4v", "flv", "gifv", "m4v", "mp4", "mkv", "webm", "mov", "qt", "mpeg", "ogv", "3gp", "3g2",
]);

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export class NotionArchiveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const archiveToken = () => process.env.NOTION_ARCHIVE_TOKEN?.trim() ?? "";
export const archiveParent = () => process.env.NOTION_ARCHIVE_PAGE?.trim() ?? "";
/** 보관 기능을 쓸 수 있는가 — 토큰과 보관함 페이지가 모두 있어야 한다 */
export const notionArchiveEnabled = () => Boolean(archiveToken() && archiveParent());

/**
 * 노션 페이지 주소나 id 에서 32자리 id 만 꺼낸다.
 *
 * 주소는 `…/제목-<id>` 꼴이라 id 는 **마지막 조각의 끝**에 있다. 붙임표를 통째로
 * 지우고 앞에서부터 찾으면 제목의 숫자·a~f 가 id 앞에 붙어 버린다 — 「2026」 이라는
 * 제목의 링크(`…/2026-1529d069…`)에서 실제로 `20261529…` 를 읽었다(2026-09-22).
 * 미리보기로 연 페이지는 `?p=<id>` 가 그 페이지다.
 */
export function parseNotionPageId(v: string): string | null {
  const hex32 = (x: string) => {
    const m = x.replace(/-/g, "").match(/[0-9a-f]{32}$/i);
    return m ? m[0].toLowerCase() : null;
  };
  const raw = v.trim();
  if (/^[0-9a-f-]{32,36}$/i.test(raw)) return hex32(raw);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const peek = url.searchParams.get("p");
  if (peek && hex32(peek)) return hex32(peek);
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  return hex32(last);
}

function headers(extra?: Record<string, string>) {
  const token = archiveToken();
  if (!token) throw new NotionArchiveError(0, "NOTION_ARCHIVE_TOKEN 이 설정되지 않았습니다.");
  return { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, ...extra };
}

async function call<T = any>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: headers(body !== undefined ? { "Content-Type": "application/json" } : undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 요청 한도(429)·과부하(529) 는 쉬었다 다시 — 보관은 뒤에서 도는 일이라 조금 기다려도 된다
    if ((res.status === 429 || res.status === 529) && attempt < 3) {
      const wait = Math.min(30, Number(res.headers.get("retry-after")) || 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const raw = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      throw new NotionArchiveError(res.status, raw?.message ?? `노션 요청이 실패했습니다 (HTTP ${res.status})`);
    }
    return raw as T;
  }
}

/** 파일 조각 하나 보내기 — multipart/form-data (Content-Type 은 fetch 가 경계까지 붙인다) */
async function send(id: string, bytes: Buffer, contentType: string, filename: string, part?: number) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  if (part !== undefined) form.append("part_number", String(part));
  const res = await fetch(`${NOTION_API}/file_uploads/${id}/send`, {
    method: "POST",
    headers: headers(),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const raw = (await res.json().catch(() => null)) as any;
    throw new NotionArchiveError(res.status, raw?.message ?? `파일을 올리지 못했습니다 (HTTP ${res.status})`);
  }
}

/**
 * 파일 하나를 노션에 올린다 — 붙일 수 있는 file_upload id 를 돌려준다.
 * 올린 파일은 1시간 안에 블록에 붙여야 하므로, 부르는 쪽이 바로 붙인다.
 */
export async function uploadFile(args: {
  name: string;
  contentType: string;
  bytes: Buffer;
}): Promise<{ id: string; filename: string; gzipped: boolean }> {
  // 이름이 너무 길면 노션이 거절한다 (900바이트). 확장자는 남긴다
  const dot = args.name.lastIndexOf(".");
  const ext = dot > 0 ? args.name.slice(dot) : "";
  const base = (dot > 0 ? args.name.slice(0, dot) : args.name).slice(0, 120);
  let filename = `${base || "파일"}${ext}`;
  let contentType = args.contentType || "application/octet-stream";
  let bytes = args.bytes;

  // 노션이 안 받는 확장자는 gzip 으로 감싼다 (.hwp → .hwp.gz)
  const gzipped = !NOTION_EXT.has(extOf(filename));
  if (gzipped) {
    bytes = gzipSync(args.bytes);
    filename = `${filename}.gz`;
    contentType = "application/gzip";
  }

  if (bytes.length <= NOTION_SINGLE_MAX) {
    const made = await call<{ id: string }>("POST", "/file_uploads", { filename, content_type: contentType });
    await send(made.id, bytes, contentType, filename);
    return { id: made.id, filename, gzipped };
  }

  const parts = Math.ceil(bytes.length / PART_BYTES);
  const made = await call<{ id: string }>("POST", "/file_uploads", {
    filename,
    content_type: contentType,
    mode: "multi_part",
    number_of_parts: parts,
  });
  for (let i = 0; i < parts; i++) {
    await send(made.id, bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES), contentType, filename, i + 1);
  }
  await call("POST", `/file_uploads/${made.id}/complete`);
  return { id: made.id, filename, gzipped };
}

// ---- 블록 만들기 --------------------------------------------

/** 노션 텍스트 한 덩이 한도 — 넘으면 잘라서 여러 블록으로 */
const TEXT_MAX = 1900;

const rich = (text: string, link?: string) => [
  { type: "text", text: { content: text.slice(0, TEXT_MAX), ...(link ? { link: { url: link } } : {}) } },
];

export const paragraph = (text: string, link?: string) => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: text ? rich(text, link) : [] },
});

export const heading = (text: string) => ({
  object: "block",
  type: "heading_2",
  heading_2: { rich_text: rich(text) },
});

export const bullet = (text: string) => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: rich(text) },
});

/**
 * 올린 파일을 붙이는 블록. 노션이 소리로 아는 확장자만 audio 블록(그 자리에서 듣기)으로
 * 하고, 나머지는 file 블록이다 — 크롬이 녹음하는 webm 은 노션에서 동영상 취급이라
 * audio 블록에 넣으면 거절당한다. `caption` 에는 늘 원래 이름을 적는다.
 */
export const fileBlock = (uploadId: string, caption: string, uploadedName = caption) => {
  const audio = NOTION_AUDIO_EXT.has(extOf(uploadedName));
  const body = { type: "file_upload", file_upload: { id: uploadId }, caption: rich(caption) };
  return audio ? { object: "block", type: "audio", audio: body } : { object: "block", type: "file", file: body };
};

/** 긴 글을 문단 블록들로 — 빈 줄은 한 칸 띄우기로 */
export function textBlocks(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    for (let i = 0; i < t.length; i += TEXT_MAX) out.push(paragraph(t.slice(i, i + TEXT_MAX)));
  }
  return out;
}

// ---- 페이지 -------------------------------------------------

/**
 * 보관함 아래에 회의 한 건의 페이지를 만든다. `parentPageId` 를 주면 그 페이지
 * 아래에 (안건은 상위 회의 페이지 아래에). 새 페이지는 노션이 맨 끝에 붙인다 —
 * 오래된 회의부터 옮기므로 날짜 순서대로 쌓인다.
 */
export async function createArchivePage(
  title: string,
  children: any[],
  opts: { parentPageId?: string; emoji?: string } = {},
): Promise<{ id: string; url: string }> {
  const parent = opts.parentPageId ?? parseNotionPageId(archiveParent());
  if (!parent) throw new NotionArchiveError(0, "NOTION_ARCHIVE_PAGE 가 노션 페이지 주소나 id 가 아닙니다.");
  const page = await call<{ id: string; url: string }>("POST", "/pages", {
    parent: { type: "page_id", page_id: parent },
    properties: { title: { title: rich(title) } },
    ...(opts.emoji ? { icon: { type: "emoji", emoji: opts.emoji } } : {}),
    // 한 요청에 100 블록까지 — 나머지는 appendBlocks 로 이어 붙인다
    children: children.slice(0, 100),
  });
  for (let i = 100; i < children.length; i += 100) await appendBlocks(page.id, children.slice(i, i + 100));
  return page;
}

/**
 * 페이지에 이미 적힌 소제목·문단 글줄 — 중간에 끊겨 다시 돌릴 때 「첨부 파일」
 * 소제목과 올린 사람 줄을 두 번 쓰지 않으려고 본다.
 */
export async function pageLines(pageId: string): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await call<any>("GET", `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of res.results ?? []) {
      const rt = b?.heading_2?.rich_text ?? b?.paragraph?.rich_text;
      if (rt) out.add(rt.map((t: any) => t?.plain_text ?? "").join(""));
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

export const appendBlocks = (pageId: string, children: any[]) =>
  call("PATCH", `/blocks/${pageId}/children`, { children });

/** 보관한 파일의 새 내려받기 주소 — 노션 주소는 1시간이면 만료된다 */
export async function freshFileUrl(blockId: string): Promise<string> {
  const block = await call<any>("GET", `/blocks/${blockId}`);
  const url = block?.file?.file?.url ?? block?.audio?.file?.url ?? block?.pdf?.file?.url ?? block?.image?.file?.url;
  if (typeof url !== "string") throw new NotionArchiveError(404, "노션에서 이 파일을 찾지 못했습니다.");
  return url;
}

/** 보관함 페이지에 접근할 수 있는지 — 설정을 확인하는 화면이 쓴다 */
export async function checkArchiveAccess(): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  try {
    const id = parseNotionPageId(archiveParent());
    if (!id) return { ok: false, error: "NOTION_ARCHIVE_PAGE 가 노션 페이지 주소나 id 가 아닙니다." };
    const page = await call<any>("GET", `/pages/${id}`);
    const title =
      Object.values(page?.properties ?? {})
        .flatMap((p: any) => (p?.type === "title" ? p.title : []))
        .map((t: any) => t?.plain_text ?? "")
        .join("") || "(제목 없음)";
    return { ok: true, title };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "노션 확인에 실패했습니다." };
  }
}
