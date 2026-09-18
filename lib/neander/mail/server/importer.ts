import "server-only";

// ============================================================
//  카페24 웹메일 백업 가져오기 (.eml 한 통씩)
// ------------------------------------------------------------
//  POP3 는 받은메일함만 보인다. 보낸메일함·스팸메일함·내 메일함 같은 카페24
//  메일함은 웹메일 → 환경설정 → 메일함 관리 → 백업(zip)으로 받아 ERP 에
//  올린다. zip 은 브라우저가 풀고(JSZip), 서버는 .eml 을 한 통씩 받는다 —
//  Vercel 요청 한도(4.5MB) 때문에 큰 메일은 조각(blobs.ts)으로 먼저 올린다.
//
//  원문은 두지 않는다 (Storage 버킷이 없다). 그래서 가져온 메일의 첨부는
//  이름만 보이고 열 수 없다 — imported 표시로 화면이 안내한다.
//
//  같은 백업을 두 번 올려도 한 번만 들어가게 문서 id 를 Message-ID(없으면
//  원문 해시)로 짓는다. 받은메일함으로 가져올 때는 POP3 로 이미 들어온
//  메일과도 Message-ID 로 겹침을 거른다.
// ============================================================

import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { MailBox } from "../types";
import { parseMail } from "./parse";
import { boxRef, sortKeys, stripUndefined, type MailDoc } from "./store";

export type ImportOutcome = "added" | "duplicate" | "failed";

export async function importRaw(db: Firestore, owner: string, box: MailBox, raw: Buffer): Promise<ImportOutcome> {
  let m;
  try {
    m = await parseMail(raw);
  } catch {
    return "failed";
  }
  const key = m.messageId || createHash("sha256").update(raw).digest("hex");
  const id = `imp_${createHash("sha256").update(key).digest("base64url").slice(0, 20)}`;
  const col = boxRef(db, owner, box);

  if (m.messageId) {
    const dup = await col.where("messageId", "==", m.messageId).limit(1).get();
    if (!dup.empty) return "duplicate";
  }

  const base = {
    from: m.from,
    to: m.to,
    cc: m.cc,
    replyTo: m.replyTo.length ? m.replyTo : undefined,
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
    read: true,
    attachments: m.attachments,
  };
  const doc: MailDoc = stripUndefined({
    ...base,
    ...sortKeys(base),
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
    references: m.references,
    uidl: null,
    uidlHash: null,
    imported: true,
    body: m.body,
    partial: m.partial,
    createdAt: Date.now(),
  });
  try {
    await col.doc(id).create(doc);
    return "added";
  } catch (e) {
    if ((e as { code?: number }).code === 6) return "duplicate";
    throw e;
  }
}
