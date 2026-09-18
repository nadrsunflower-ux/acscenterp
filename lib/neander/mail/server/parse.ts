import "server-only";

// ============================================================
//  원문(.eml 바이트) → 목록 요약 + 본문
// ------------------------------------------------------------
//  이 프로젝트에는 Firebase Storage 버킷이 없다 (2026-09-18 확인 —
//  기본 버킷이 만들어져 있지 않다). 그래서 원문·첨부는 ERP 에 두지 않고
//  **카페24 서버를 원본 보관소로 쓴다.** ERP(Firestore)에는
//
//    - 목록에 필요한 요약 (보낸 사람·제목·날짜·첨부 이름)
//    - 본문 HTML/텍스트를 gzip 한 바이트 (문서 한도 1MB 안에서)
//
//  만 둔다. 첨부를 열 때와 본문이 너무 커서 잘렸을 때만 카페24 에서
//  원문을 다시 받는다 (sync.ts fetchRaw).
//
//  본문 안 이미지(cid:)는 작으면 data: URL 로 바꿔 본문에 넣는다 — 서명
//  로고·캡처가 깨져 보이지 않게. 크면 빼고, 화면에서 원문 전체를 받게 한다.
// ============================================================

import { gunzipSync, gzipSync } from "node:zlib";
import { simpleParser, type AddressObject, type Attachment, type ParsedMail } from "mailparser";
import type { MailAddr, MailAttachmentMeta } from "../types";

/** gzip 한 본문의 한도 — 문서 1MB 에서 요약 필드 자리를 남긴다 */
const BODY_CAP = 700 * 1024;
/** 본문에 넣을 인라인 이미지 한도 (전체) */
const INLINE_CAP = 400 * 1024;
const SNIPPET_LEN = 160;

export interface ParsedMailParts {
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  from: MailAddr;
  to: MailAddr[];
  cc: MailAddr[];
  replyTo: MailAddr[];
  subject: string;
  date: number;
  snippet: string;
  attachments: MailAttachmentMeta[];
  /** gzip(JSON{html,text}) */
  body: Buffer;
  partial: boolean;
}

export interface MailBody {
  html?: string;
  text?: string;
}

export const parseRaw = (raw: Buffer) => simpleParser(raw, { skipImageLinks: true });

function addrs(v: AddressObject | AddressObject[] | undefined): MailAddr[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v : [v];
  const out: MailAddr[] = [];
  for (const o of list) {
    for (const a of o.value ?? []) {
      // 그룹 주소(group)는 안쪽 주소로 편다
      if (a.group) out.push(...a.group.filter((g) => g.address).map((g) => ({ name: g.name || undefined, address: g.address! })));
      else if (a.address) out.push({ name: a.name || undefined, address: a.address });
    }
  }
  return out;
}

const clean = (a: MailAddr): MailAddr => (a.name ? a : { address: a.address });

/** 첨부로 보여줄 것 — 본문에 박힌 이미지는 빼고 */
const isInline = (a: Attachment) => a.related === true || (a.contentDisposition === "inline" && !!a.cid);

export function attachmentMetas(parsed: ParsedMail): MailAttachmentMeta[] {
  return parsed.attachments
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => !isInline(a))
    .map(({ a, index }) => ({
      index,
      name: a.filename || `첨부${index + 1}`,
      type: a.contentType || "application/octet-stream",
      size: a.size ?? a.content?.length ?? 0,
      checksum: a.checksum,
    }));
}

/** cid: 이미지를 data: 로 — 한도 안의 것만 */
function inlineImages(html: string, parsed: ParsedMail): string {
  let budget = INLINE_CAP;
  const byCid = new Map<string, Attachment>();
  for (const a of parsed.attachments) if (a.cid) byCid.set(a.cid.replace(/^<|>$/g, ""), a);
  return html.replace(/cid:([^"'\s)>]+)/gi, (m, cid: string) => {
    const a = byCid.get(decodeURIComponent(cid));
    if (!a?.content || a.content.length > budget) return m;
    budget -= a.content.length;
    return `data:${a.contentType || "application/octet-stream"};base64,${a.content.toString("base64")}`;
  });
}

const packBody = (b: MailBody) => gzipSync(Buffer.from(JSON.stringify(b), "utf8"));

/** 이미 지은 본문(보낸 메일)을 한도 안으로 — 넘치면 텍스트만 */
export function packCapped(b: MailBody): { body: Buffer; partial: boolean } {
  const body = packBody(b);
  if (body.length <= BODY_CAP) return { body, partial: false };
  return { body: packBody({ text: (b.text ?? "").slice(0, 200_000) }), partial: true };
}

export function unpackBody(buf: Buffer | Uint8Array | undefined | null): MailBody {
  if (!buf || buf.length === 0) return {};
  try {
    return JSON.parse(gunzipSync(Buffer.from(buf)).toString("utf8")) as MailBody;
  } catch {
    return {};
  }
}

/** 본문을 한도 안으로 — 인라인 이미지 → 이미지 빼고 → 텍스트만(잘라서) 순으로 줄인다 */
export function bodyOf(parsed: ParsedMail): { body: Buffer; partial: boolean; full: MailBody } {
  const text = parsed.text ?? undefined;
  const html = typeof parsed.html === "string" ? parsed.html : undefined;
  const full: MailBody = { html: html ? inlineImages(html, parsed) : undefined, text };

  let body = packBody(full);
  if (body.length <= BODY_CAP) return { body, partial: false, full };

  body = packBody({ html, text });
  if (body.length <= BODY_CAP) return { body, partial: true, full };

  // 텍스트만, 그래도 크면 자른다 (gzip 전 기준으로 넉넉히)
  let t = text ?? "";
  do {
    t = t.slice(0, Math.floor(t.length * 0.7));
    body = packBody({ text: t });
  } while (body.length > BODY_CAP && t.length > 0);
  return { body, partial: true, full };
}

export function snippetOf(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, SNIPPET_LEN);
}

export async function parseMail(raw: Buffer): Promise<ParsedMailParts> {
  const parsed = await parseRaw(raw);
  const { body, partial } = bodyOf(parsed);
  const refs = parsed.references;
  return {
    messageId: parsed.messageId || undefined,
    inReplyTo: parsed.inReplyTo || undefined,
    references: (Array.isArray(refs) ? refs : refs ? [refs] : []).slice(-20),
    from: clean(addrs(parsed.from)[0] ?? { address: "(보낸 사람 없음)" }),
    to: addrs(parsed.to).map(clean),
    cc: addrs(parsed.cc).map(clean),
    replyTo: addrs(parsed.replyTo).map(clean),
    subject: parsed.subject?.trim() || "(제목 없음)",
    date: parsed.date?.getTime() || Date.now(),
    snippet: snippetOf(parsed.text),
    attachments: attachmentMetas(parsed),
    body,
    partial,
  };
}
