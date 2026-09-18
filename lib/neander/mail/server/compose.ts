import "server-only";

// ============================================================
//  임시보관함 · 예약메일함
// ------------------------------------------------------------
//  임시저장은 계정 아래 drafts 에, 예약 메일은 한 곳(neander_mail_scheduled)에
//  둔다. 예약을 한 곳에 모은 이유: 보낼 때가 된 예약을 **누구의 ERP 가 열려
//  있든** 20초 확인 한 번(dueAt <= 지금)으로 찾아 보내기 위해서다. 서버에
//  상주 프로세스가 없으니(Vercel) 시계를 대신 볼 사람이 필요하다.
//
//  ⚠️ 팀원 아무도 ERP 를 열어 두지 않은 시간에 잡힌 예약은, 다음에 누군가
//     ERP 를 열 때 나간다. 받는 쪽에서는 늦게 도착한다.
//
//  두 사람의 확인이 같은 예약을 동시에 잡지 않게 트랜잭션으로 「보내는 중」
//  임대를 건다. 보내다 함수가 죽으면 임대가 풀린 뒤 다시 잡힌다.
// ============================================================

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { MailAttachmentMeta, MailComposeState, MailSendInput, MailSummary } from "../types";
import { cleanupBlobs, deleteBlobs, setPinned } from "./blobs";
import { normalizeRecipients, sendComposed, validateRecipients } from "./send";
import { snippetOf } from "./parse";
import { boxRef, cleanAddrs, readAccount, sortKeys, stripUndefined, toSummary, userOf, type MailDoc } from "./store";

const LEASE_MS = 3 * 60_000;
/** 한 번의 확인에서 보내는 예약 수 — 확인 응답이 늦어지지 않게 */
const DISPATCH_PER_RUN = 3;

interface ScheduledDoc {
  owner: string;
  sendAt: number;
  /**
   * 보낼 차례 — 기다리는 동안만 있다 (실패하면 뗀다). dispatchDue 가 이 필드로
   * 찾는다: 실패한 예약이 sendAt 으로 계속 잡히면 뒤의 예약이 밀린다.
   */
  dueAt?: number;
  status: "pending" | "sending" | "failed";
  lease?: number;
  error?: string;
  input: MailComposeState;
  origin?: string;
  /** 예약한 ERP 사용자 — 첨부 조각의 주인 (팀 공용 계정에서는 계정 주인과 다르다) */
  by?: string;
  createdAt: number;
}

const scheduledCol = (db: Firestore) => db.collection(NEANDER_COL.mailScheduled);

const blobMetas = (c: MailComposeState): MailAttachmentMeta[] =>
  c.blobs.map((b, index) => ({ index, name: b.name, type: b.type, size: b.size }));

/** Firestore 에 넣을 수 있게 작성 내용을 다듬는다 (undefined 필드 빼기) */
function cleanCompose(c: MailComposeState): MailComposeState {
  return stripUndefined({
    to: cleanAddrs(c.to ?? []),
    cc: cleanAddrs(c.cc ?? []),
    bcc: cleanAddrs(c.bcc ?? []),
    subject: String(c.subject ?? ""),
    html: c.mode === "text" ? undefined : c.html,
    text: String(c.text ?? ""),
    mode: c.mode ?? "rich",
    ref: c.ref ? stripUndefined({ ...c.ref }) : undefined,
    blobs: (c.blobs ?? []).map((b) => ({ id: b.id, name: b.name, type: b.type, size: b.size })),
    forwardSkip: c.forwardSkip?.length ? c.forwardSkip : undefined,
    self: c.self || undefined,
    saveSent: c.saveSent === false ? false : undefined,
    individually: c.individually || undefined,
  });
}

// ---- 임시보관함 ----------------------------------------------

export async function saveDraft(
  db: Firestore,
  owner: string,
  draftId: string | undefined,
  compose: MailComposeState,
  actor?: string,
): Promise<MailSummary> {
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("연결된 메일 계정이 없습니다.");
  const by = actor ?? userOf(acc);
  const c = cleanCompose(compose);
  const ref = draftId ? boxRef(db, owner, "drafts").doc(draftId) : boxRef(db, owner, "drafts").doc();

  // 지난 저장에 있다가 빠진 첨부는 치운다
  const prev = draftId ? ((await ref.get()).data() as MailDoc | undefined) : undefined;
  const keep = new Set(c.blobs.map((b) => b.id));
  const dropped = (prev?.compose?.blobs ?? []).filter((b) => !keep.has(b.id)).map((b) => b.id);
  // 조각은 메일 계정이 아니라 올린 ERP 사용자의 것이다
  if (dropped.length) await deleteBlobs(db, prev?.by ?? by, dropped);
  await setPinned(db, by, [...keep], true);

  const base = {
    from: stripUndefined({ name: acc.name || undefined, address: acc.address }),
    to: c.self ? [{ address: acc.address }] : c.to,
    cc: c.cc,
    subject: c.subject || "(제목 없음)",
    date: Date.now(),
    snippet: snippetOf(c.text),
    read: true,
    attachments: blobMetas(c),
  };
  const doc: MailDoc = stripUndefined({ ...base, ...sortKeys(base), compose: c, by, createdAt: Date.now() });
  await ref.set(doc);
  return toSummary(ref.id, "drafts", doc);
}

export async function deleteDraft(db: Firestore, owner: string, id: string): Promise<void> {
  const ref = boxRef(db, owner, "drafts").doc(id);
  const d = (await ref.get()).data() as MailDoc | undefined;
  if (!d) return;
  const acc = await readAccount(db, owner);
  await deleteBlobs(db, d.by ?? (acc ? userOf(acc) : owner), (d.compose?.blobs ?? []).map((b) => b.id));
  await ref.delete();
}

// ---- 예약메일함 ----------------------------------------------

function scheduledSummary(id: string, d: ScheduledDoc, fromAddr: { name?: string; address: string }): MailSummary {
  return {
    id,
    box: "scheduled",
    from: fromAddr,
    to: d.input.self ? [fromAddr] : d.input.to,
    cc: d.input.cc,
    subject: d.input.subject || "(제목 없음)",
    date: d.sendAt,
    snippet: snippetOf(d.input.text),
    read: true,
    starred: false,
    attachments: blobMetas(d.input),
    onServer: false,
    schedule: { status: d.status, error: d.error },
  };
}

export async function scheduleMail(
  db: Firestore,
  owner: string,
  input: MailSendInput,
  origin: string | undefined,
  actor?: string,
): Promise<MailSummary> {
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("연결된 메일 계정이 없습니다.");
  const sendAt = Number(input.sendAt);
  if (!sendAt || sendAt < Date.now() + 60_000) throw new Error("예약 시각은 지금부터 1분 뒤 이후로 골라 주세요.");
  validateRecipients(normalizeRecipients(input, acc));

  const c = cleanCompose(input);
  const by = actor ?? userOf(acc);
  await setPinned(db, by, c.blobs.map((b) => b.id), true);
  const doc: ScheduledDoc = stripUndefined({
    owner,
    sendAt,
    dueAt: sendAt,
    status: "pending" as const,
    input: c,
    origin,
    by,
    createdAt: Date.now(),
  });
  const ref = scheduledCol(db).doc();
  await ref.set(doc);
  if (input.draftId) await boxRef(db, owner, "drafts").doc(input.draftId).delete().catch(() => undefined);
  return scheduledSummary(ref.id, doc, { name: acc.name || undefined, address: acc.address });
}

export async function listScheduled(db: Firestore, owner: string): Promise<MailSummary[]> {
  const acc = await readAccount(db, owner);
  const from = { name: acc?.name || undefined, address: acc?.address ?? "" };
  const snap = await scheduledCol(db).where("owner", "==", owner).get();
  return snap.docs.map((d) => scheduledSummary(d.id, d.data() as ScheduledDoc, from)).sort((a, b) => a.date - b.date);
}

export async function countScheduled(db: Firestore, owner: string): Promise<number> {
  return (await scheduledCol(db).where("owner", "==", owner).count().get()).data().count;
}

/** 예약 한 건 — 다시 열어 고칠 때 */
export async function readScheduled(db: Firestore, owner: string, id: string) {
  const snap = await scheduledCol(db).doc(id).get();
  const d = snap.data() as ScheduledDoc | undefined;
  if (!d || d.owner !== owner) throw new Error("예약 메일을 찾지 못했습니다.");
  return d;
}

/** 예약 취소 — 내용은 임시보관함으로 돌려 둔다 */
export async function cancelScheduled(db: Firestore, owner: string, id: string): Promise<MailSummary> {
  const ref = scheduledCol(db).doc(id);
  const d = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const v = snap.data() as ScheduledDoc | undefined;
    if (!v || v.owner !== owner) throw new Error("예약 메일을 찾지 못했습니다.");
    if (v.status === "sending" && (v.lease ?? 0) > Date.now()) throw new Error("지금 보내는 중이라 취소할 수 없습니다.");
    tx.delete(ref);
    return v;
  });
  return saveDraft(db, owner, undefined, d.input, d.by);
}

/** 지금 보내기 — 시각만 당기고 다음 확인이 보낸다 */
export async function sendScheduledNow(db: Firestore, owner: string, id: string): Promise<void> {
  const ref = scheduledCol(db).doc(id);
  const d = (await ref.get()).data() as ScheduledDoc | undefined;
  if (!d || d.owner !== owner) throw new Error("예약 메일을 찾지 못했습니다.");
  const now = Date.now();
  await ref.update({ sendAt: now, dueAt: now, status: "pending", error: null });
}

/**
 * 보낼 때가 된 예약을 보낸다 (누구의 확인에서든).
 * 끝으로 버려진 첨부 조각도 조금 치운다.
 */
export async function dispatchDue(db: Firestore): Promise<number> {
  const now = Date.now();
  const snap = await scheduledCol(db).where("dueAt", "<=", now).limit(DISPATCH_PER_RUN * 2).get();
  let sent = 0;
  for (const d of snap.docs) {
    if (sent >= DISPATCH_PER_RUN) break;
    const claimed = await db.runTransaction(async (tx) => {
      const v = (await tx.get(d.ref)).data() as ScheduledDoc | undefined;
      if (!v || v.status === "failed") return null;
      if (v.status === "sending" && (v.lease ?? 0) > Date.now()) return null;
      tx.update(d.ref, { status: "sending", lease: Date.now() + LEASE_MS });
      return v;
    });
    if (!claimed) continue;
    try {
      await sendComposed(db, claimed.owner, claimed.input, claimed.origin, claimed.by);
      await d.ref.delete();
      sent++;
    } catch (e) {
      await d.ref.update({
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        lease: null,
        dueAt: FieldValue.delete(),
      });
    }
  }
  await cleanupBlobs(db).catch(() => undefined);
  return sent;
}

/** 계정을 끊을 때 (user: 조각을 올린 ERP 사용자) */
export async function deleteScheduledOf(db: Firestore, owner: string, user: string): Promise<void> {
  const snap = await scheduledCol(db).where("owner", "==", owner).get();
  for (const d of snap.docs) {
    const v = d.data() as ScheduledDoc;
    await deleteBlobs(db, v.by ?? user, (v.input.blobs ?? []).map((b) => b.id));
    await d.ref.delete();
  }
}
