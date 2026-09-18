import "server-only";

// ============================================================
//  보내기 — 카페24 SMTP (smtp.cafe24.com:587, STARTTLS)
// ------------------------------------------------------------
//  외부 SMTP 로 보낸 메일은 카페24 웹메일의 「보낸편지함」에 남지 않는다
//  (IMAP 이 없어 넣어 줄 길도 없다). 그래서
//
//    1) ERP 가 보낸 메일을 sent(내게쓰기는 self)에 직접 남기고
//    2) keepSentCopy 면 내 주소를 봉투에만 넣어(숨은 참조) 카페24 받은편지함에
//       사본을 남긴다. 그 사본이 들어오면 sync.ts 가 보낸 메일 문서에 원문
//       위치를 이어 준다 — 보낸 첨부를 나중에 다시 열 수 있다 (Storage 가 없다).
//
//  첨부는 브라우저가 조각으로 미리 올려 둔 것(blobs.ts)을 모아 붙인다 —
//  Vercel 요청 한도 4.5MB 를 비켜 카페24 웹메일과 같은 20MB 까지 된다.
//
//  답장·전달의 인용문은 서버가 원본(Firestore)에서 붙인다. 브라우저가 원본
//  HTML 을 다시 올려 보내면 요청 한도를 인용문이 먹는다.
// ============================================================

import { createHash, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Firestore } from "firebase-admin/firestore";
import {
  MAX_SEND_ATTACH_BYTES,
  type MailAddr,
  type MailAttachmentMeta,
  type MailComposeState,
  type MailSendInput,
  type MailSummary,
} from "../types";
import { SMTP_HOSTS, SMTP_PORT, smtpTlsOptions } from "./cafe24";
import { openSecret } from "./secret";
import { packCapped, parseRaw, snippetOf, unpackBody, type MailBody } from "./parse";
import { fetchRawForDoc } from "./sync";
import { deleteBlobs, readBlob } from "./blobs";
import { newTrackId, trackPixel, writeTracks } from "./track";
import {
  boxRef,
  cleanAddrs,
  noteRecipients,
  readAccount,
  resolveBox,
  sortKeys,
  stripUndefined,
  toSummary,
  userOf,
  type MailAccountDoc,
  type MailDoc,
} from "./store";

const ADDR_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function transport(host: string, address: string, password: string) {
  return nodemailer.createTransport({
    host,
    port: SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: address, pass: password },
    tls: smtpTlsOptions(host),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
}

/** 네이버·Gmail — 보통의 TLS (465 는 처음부터, 587 은 STARTTLS) */
function imapProviderTransport(host: string, port: number, secure: boolean, address: string, password: string) {
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: address, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
}

/** 계정의 보내는 서버 */
function transportFor(acc: MailAccountDoc, password: string) {
  if (acc.provider && acc.provider !== "cafe24") {
    return imapProviderTransport(acc.smtpHost, acc.smtpPort ?? 587, !!acc.smtpSecure, acc.loginUser || acc.address, password);
  }
  return transport(acc.smtpHost, acc.address, password);
}

/** 네이버·Gmail 연결 전 보내는 서버 로그인만 해 본다 */
export async function testSmtpAt(host: string, port: number, secure: boolean, address: string, password: string): Promise<void> {
  const t = imapProviderTransport(host, port, secure, address, password);
  try {
    await t.verify();
  } catch (e) {
    throw new Error(
      `받기(IMAP)는 로그인됐지만 보내는 서버(SMTP)가 거절했습니다 — SMTP 사용이 켜져 있는지 확인해 주세요. (${host}: ${e instanceof Error ? e.message : e})`,
    );
  } finally {
    t.close();
  }
}

/**
 * 연결하기 전에 보내는 서버 로그인만 해 본다 — 카페24 는 계정(메일 상품)에 따라
 * smtp · ecsmtp 중 한 곳만 받는다. 되는 곳을 돌려준다 (계정에 적어 둔다).
 * 부를 때는 받기(POP3) 로그인이 이미 된 뒤다 — 비밀번호는 맞다는 뜻이다.
 */
export async function testSmtp(address: string, password: string, preferred?: string): Promise<string> {
  const hosts = [...new Set([preferred, ...SMTP_HOSTS].filter((h): h is string => !!h))];
  const errors: string[] = [];
  for (const host of hosts) {
    const t = transport(host, address, password);
    try {
      await t.verify();
      return host;
    } catch (e) {
      errors.push(`${host}: ${e instanceof Error ? e.message : e}`);
    } finally {
      t.close();
    }
  }
  throw new Error(
    "받기(POP3)는 로그인됐지만 보내는 서버(SMTP)가 로그인을 거절했습니다. 비밀번호는 맞습니다 — " +
      "그 계정으로 카페24 웹메일에 로그인해 환경설정 → POP3/SMTP 사용설정이 「사용함」인지 확인하고, " +
      `방금 켰다면 몇 분 뒤 다시 해 보세요. (${errors.join(" · ")})`,
  );
}

// ---- 본문 짓기 ------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const textToHtml = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

const fmtAddr = (a: MailAddr) => (a.name ? `${a.name} <${a.address}>` : a.address);

const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(ms);

/** 원본이 문서 통째(<html>…)면 body 안쪽만 */
const innerBody = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

interface Original {
  owner: string;
  doc: MailDoc;
  body: MailBody;
}

function quote(mode: "reply" | "replyAll" | "forward", o: Original): { html: string; text: string } {
  const origHtml = o.body.html ? innerBody(o.body.html) : textToHtml(o.body.text ?? "");
  const origText = o.body.text ?? "";
  if (mode === "forward") {
    const lines = [
      "---------- 전달된 메일 ----------",
      `보낸 사람: ${fmtAddr(o.doc.from)}`,
      `날짜: ${fmtDate(o.doc.date)}`,
      `제목: ${o.doc.subject}`,
      `받는 사람: ${o.doc.to.map(fmtAddr).join(", ")}`,
      ...(o.doc.cc.length ? [`참조: ${o.doc.cc.map(fmtAddr).join(", ")}`] : []),
    ];
    return {
      html: `<br><br><div>${lines.map(esc).join("<br>")}</div><br>${origHtml}`,
      text: `\n\n${lines.join("\n")}\n\n${origText}`,
    };
  }
  const head = `${fmtDate(o.doc.date)}, ${fmtAddr(o.doc.from)} 님이 작성:`;
  return {
    html:
      `<br><br><div>${esc(head)}</div>` +
      `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${origHtml}</blockquote>`,
    text: `\n\n${head}\n${origText
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n")}`,
  };
}

const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");

/** 내게쓰기면 받는 사람을 나로 바꾼다 */
export function normalizeRecipients(input: MailComposeState, acc: MailAccountDoc): MailComposeState {
  if (!input.self) return input;
  return { ...input, to: [{ name: acc.name || undefined, address: acc.address }], cc: [], bcc: [] };
}

export function validateRecipients(input: MailComposeState): void {
  const all = [...input.to, ...input.cc, ...input.bcc];
  if (!all.length) throw new Error("받는 사람을 한 명 이상 넣어 주세요.");
  const bad = all.find((a) => !ADDR_RE.test(a.address.trim()));
  if (bad) throw new Error(`메일 주소 형식이 아닙니다: ${bad.address}`);
  const bytes = input.blobs.reduce((s, b) => s + (b.size || 0), 0);
  if (bytes > MAX_SEND_ATTACH_BYTES) throw new Error("첨부는 합쳐서 20MB 까지 보낼 수 있습니다.");
}

/** 답장·전달 원본 — 내 다른 메일 계정이나 동료가 공유한 메일함의 메일일 수도 있다 */
async function loadOriginal(db: Firestore, viewer: string, ref: MailComposeState["ref"]): Promise<Original | null> {
  if (!ref) return null;
  const at = await resolveBox(db, viewer, ref.box, ref.owner);
  const snap = await boxRef(db, at.owner, at.box).doc(ref.id).get();
  if (!snap.exists) throw new Error("답장할 원본 메일을 찾지 못했습니다.");
  const doc = snap.data() as MailDoc;
  return { owner: at.owner, doc, body: unpackBody(doc.body) };
}

export interface SendOutcome {
  sent: MailSummary | null;
  /** 한 사람씩 보내기에서 실패한 주소 */
  failed: string[];
}

/**
 * 지금 보낸다. 예약 발송(dispatch.ts)도 이 함수를 부른다.
 * origin 은 수신확인 이미지 주소 — 없으면(로컬) 붙이지 않는다.
 * actor 는 실제로 쓰는 ERP 사용자 — 팀 공용 계정에서는 계정 주인이 아니라 이 사람이
 * 첨부 조각의 주인이다.
 */
export async function sendComposed(
  db: Firestore,
  owner: string,
  raw: MailSendInput,
  origin?: string,
  actor?: string,
): Promise<SendOutcome> {
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("연결된 메일 계정이 없습니다.");
  if (acc.authFailed) throw new Error("메일 비밀번호가 맞지 않아 멈춰 있습니다. 메일 설정에서 비밀번호를 다시 넣어 주세요.");
  const input = normalizeRecipients(raw, acc);
  validateRecipients(input);
  const password = openSecret(acc.secret, owner);
  const self = !!input.self;
  const saveSent = self || input.saveSent !== false;

  // 첨부 조각·답장 원본의 권한은 메일 계정이 아니라 ERP 사용자 기준이다
  const user = actor ?? userOf(acc);
  const original = await loadOriginal(db, user, input.ref);

  // 첨부 — 미리 올려 둔 조각을 모은다
  const files: { filename: string; contentType: string; content: Buffer }[] = [];
  for (const b of input.blobs) {
    const { meta, bytes } = await readBlob(db, user, b.id);
    files.push({ filename: meta.name, contentType: meta.type, content: bytes });
  }

  // 전달이면 원본 첨부를 서버 원문에서 꺼내 붙인다 (뺀 것은 빼고)
  const skip = new Set(input.forwardSkip ?? []);
  const forwardList = input.ref?.mode === "forward" && original ? original.doc.attachments.filter((a) => !skip.has(a.index)) : [];
  if (forwardList.length && original) {
    if (!original.doc.uidlHash && !original.doc.imap) {
      throw new Error("원본 첨부가 메일 서버에 없어 함께 전달할 수 없습니다. (백업에서 가져온 메일이거나 사본이 아직 안 들어왔어요)");
    }
    const parsed = await parseRaw(await fetchRawForDoc(db, original.owner, original.doc));
    for (const meta of forwardList) {
      const a =
        (meta.checksum && parsed.attachments.find((x) => x.checksum === meta.checksum)) || parsed.attachments[meta.index];
      if (a) files.push({ filename: meta.name, contentType: meta.type, content: a.content });
    }
  }
  const total = files.reduce((s, f) => s + f.content.length, 0);
  if (total > MAX_SEND_ATTACH_BYTES) throw new Error("첨부는 합쳐서 20MB 까지 보낼 수 있습니다.");

  const q = input.ref && original ? quote(input.ref.mode, original) : { html: "", text: "" };
  const bodyHtml = input.mode !== "text" && input.html ? input.html : textToHtml(input.text);
  const html = `<div>${bodyHtml}</div>${q.html}`;
  const text = `${input.text}${q.text}`;

  const domain = acc.address.split("@")[1];
  const threading =
    input.ref && input.ref.mode !== "forward" && original?.doc.messageId
      ? {
          inReplyTo: original.doc.messageId,
          references: [...(original.doc.references ?? []), original.doc.messageId].slice(-20),
        }
      : {};

  // 한 사람씩 보내기면 받는 사람마다 따로 (서로의 주소가 보이지 않는다)
  const everyone = [...input.to, ...input.cc, ...input.bcc];
  const batches: { to: MailAddr[]; cc: MailAddr[]; bcc: MailAddr[] }[] =
    input.individually && !self && everyone.length > 1
      ? everyone.map((a) => ({ to: [a], cc: [], bcc: [] }))
      : [{ to: input.to, cc: input.cc, bcc: input.bcc }];

  const track = !self && saveSent && acc.trackOpens !== false && !!origin;
  // 네이버·Gmail 은 SMTP 로 보낸 메일을 서버 보낸메일함에 스스로 남긴다 — 사본을 따로 보내지 않는다
  const imapProvider = !!acc.provider && acc.provider !== "cafe24";
  const keepCopy = !self && saveSent && acc.keepSentCopy !== false && !imapProvider;
  const tracks: { address: string; trackId: string }[] = [];
  const failed: string[] = [];
  let firstMessageId: string | undefined;

  const t = transportFor(acc, password);
  try {
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const messageId = `<${randomUUID()}@${domain}>`;
      const trackId = track ? newTrackId() : undefined;
      const rcpt = [...b.to, ...b.cc, ...b.bcc].map((a) => a.address.trim());
      // 사본은 한 통만 — 한 사람씩 보내기에서 모두 남기면 받은편지함이 사본으로 찬다
      if (keepCopy && i === 0) rcpt.push(acc.address);
      try {
        await t.sendMail({
          from: { name: acc.name, address: acc.address },
          to: b.to,
          cc: b.cc,
          bcc: b.bcc,
          subject: input.subject,
          text,
          html: html + (trackId ? trackPixel(origin, trackId) : ""),
          messageId,
          ...threading,
          attachments: files,
          // 편집기 본문 속 이미지(data: URL)를 cid 첨부로 — 대부분의 메일 프로그램이 data: 는 막는다
          attachDataUrls: true,
          envelope: { from: acc.address, to: [...new Set(rcpt.map((r) => r.toLowerCase()))] },
        });
        firstMessageId ??= messageId;
        if (trackId) tracks.push({ address: batches.length > 1 ? b.to[0].address : "전체", trackId });
      } catch (e) {
        if (batches.length === 1) throw new Error(`메일을 보내지 못했습니다: ${e instanceof Error ? e.message : e}`);
        failed.push(b.to[0].address);
      }
    }
  } finally {
    t.close();
  }
  if (failed.length === batches.length) throw new Error(`메일을 보내지 못했습니다: ${failed.join(", ")}`);

  const attachments: MailAttachmentMeta[] = files.map((f, index) => ({
    index,
    name: f.filename,
    type: f.contentType,
    size: f.content.length,
    checksum: md5(f.content),
  }));

  let sent: MailSummary | null = null;
  if (saveSent) {
    const now = Date.now();
    const packed = packCapped({ html, text });
    const base = {
      from: stripUndefined({ name: acc.name || undefined, address: acc.address }),
      to: cleanAddrs(input.to),
      cc: cleanAddrs(input.cc),
      subject: input.subject,
      date: now,
      snippet: snippetOf(input.text),
      read: true,
      attachments,
    };
    const doc: MailDoc = stripUndefined({
      ...base,
      ...sortKeys(base),
      bcc: input.bcc.length ? cleanAddrs(input.bcc) : undefined,
      messageId: firstMessageId,
      inReplyTo: threading.inReplyTo ?? null,
      references: threading.references ?? [],
      uidl: null,
      uidlHash: null,
      body: packed.body,
      partial: packed.partial,
      tracks: tracks.length ? tracks : undefined,
      opens: tracks.length ? 0 : undefined,
      createdAt: now,
    });
    const box = self ? "self" : "sent";
    const ref = boxRef(db, owner, box).doc();
    await ref.set(doc);
    await writeTracks(db, owner, ref.id, input.subject, tracks);
    sent = toSummary(ref.id, box, doc);
  }

  if (!self) await noteRecipients(db, owner, everyone).catch(() => undefined);
  // 보냈으니 조각·임시저장은 치운다
  await deleteBlobs(db, user, input.blobs.map((b) => b.id));
  if (raw.draftId) await boxRef(db, owner, "drafts").doc(raw.draftId).delete().catch(() => undefined);
  return { sent, failed };
}
