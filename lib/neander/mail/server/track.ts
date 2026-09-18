import "server-only";

// ============================================================
//  수신확인 — 보낸 메일에 1×1 투명 이미지를 붙여 열람을 센다
// ------------------------------------------------------------
//  카페24 웹메일의 「수신확인」과 같은 방식이다. 받는 사람의 메일 프로그램이
//  이미지를 불러오면 /api/neander/mail/t/{id} 가 불리고 열람으로 센다.
//
//  ⚠️ 「열람 추정」이다. 이미지를 막는 메일 프로그램에서는 열어도 0 으로 남고,
//     애플 메일(개인정보 보호)·Gmail 은 미리 불러와 안 열어도 1 로 뜰 수 있다.
//     내 카페24 받은편지함에 남는 사본(숨은 참조)을 휴대폰에서 열어도 센다.
//
//    neander_mail_track/{trackId}   owner · 보낸 메일 id · 받는 사람 · 열람 수·시각
//
//  한 사람씩 보내기면 받는 사람마다 따로 붙어 누가 열었는지 보인다.
// ============================================================

import { randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { MailReceipt } from "../types";
import { boxRef } from "./store";

/** 보낸 직후 몇 초는 세지 않는다 — 보내는 쪽 서버·미리보기가 부르는 것 */
const GRACE_MS = 5_000;

const trackRef = (db: Firestore, id: string) => db.collection(NEANDER_COL.mailTrack).doc(id);

export const newTrackId = () => randomBytes(15).toString("base64url");
export const isTrackId = (s: string) => /^[\w-]{20}$/.test(s);

/** 본문 끝에 붙일 이미지 — 공개 주소가 없으면(로컬) 붙이지 않는다 */
export function trackPixel(origin: string | undefined, id: string): string {
  if (!origin) return "";
  return `<img src="${origin}/api/neander/mail/t/${id}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`;
}

/** 로컬 개발 주소면 붙이지 않는다 — 받는 사람이 닿을 수 없다 */
export function publicOrigin(req: Request): string | undefined {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(host)) return undefined;
  return `${proto}://${host}`;
}

export async function writeTracks(
  db: Firestore,
  owner: string,
  sentId: string,
  subject: string,
  tracks: { address: string; trackId: string }[],
): Promise<void> {
  if (!tracks.length) return;
  const batch = db.batch();
  const sentAt = Date.now();
  for (const t of tracks) {
    batch.set(trackRef(db, t.trackId), { owner, sentId, address: t.address, subject, sentAt, opens: 0 });
  }
  await batch.commit();
}

/** 픽셀이 불렸다 — 조용히 센다 (실패해도 이미지는 돌려준다) */
export async function recordOpen(db: Firestore, trackId: string): Promise<void> {
  const ref = trackRef(db, trackId);
  const snap = await ref.get();
  const t = snap.data() as (MailReceipt & { owner: string }) | undefined;
  if (!t) return;
  const now = Date.now();
  if (now - t.sentAt < GRACE_MS) return;
  await ref.update({
    opens: FieldValue.increment(1),
    lastOpenAt: now,
    ...(t.firstOpenAt ? {} : { firstOpenAt: now }),
  });
  // 보낸메일함 목록에 열람 수를 보이게 — 옮겼거나 지웠으면 그냥 둔다
  await boxRef(db, t.owner, "sent")
    .doc(t.sentId)
    .update({ opens: FieldValue.increment(1) })
    .catch(() => undefined);
}

export async function listReceipts(db: Firestore, owner: string): Promise<MailReceipt[]> {
  // owner 하나로만 거르고 정렬은 여기서 — 복합 색인을 만들 수 없다 (store.ts)
  const snap = await db.collection(NEANDER_COL.mailTrack).where("owner", "==", owner).limit(500).get();
  return snap.docs
    .map((d) => {
      const t = d.data();
      return {
        trackId: d.id,
        sentId: t.sentId,
        address: t.address,
        subject: t.subject,
        sentAt: t.sentAt,
        opens: t.opens ?? 0,
        firstOpenAt: t.firstOpenAt,
        lastOpenAt: t.lastOpenAt,
      } satisfies MailReceipt;
    })
    .sort((a, b) => b.sentAt - a.sentAt);
}

/** 계정을 끊을 때 */
export async function deleteReceipts(db: Firestore, owner: string): Promise<void> {
  const snap = await db.collection(NEANDER_COL.mailTrack).where("owner", "==", owner).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
}
