import "server-only";

// ============================================================
//  중요 메일 판정 — 「아는 사람」과 「우리가 보낸 메일」 모음
// ------------------------------------------------------------
//    neander_mail_accounts/{계정 키}/meta/known
//      addrs  우리가 보낸 메일의 받는 사람(받는·참조·숨은참조) — 소문자
//      ids    우리가 보낸 메일의 Message-ID (답장 알아보기)
//      upto   여기까지 본 보낸 메일의 createdAt
//
//  주소록(meta/contacts)은 ERP 에서 보낸 것만 센다 — 백업 zip·네이버·Gmail
//  서버 보낸메일함에서 들어온 예전 메일은 빠진다. 그래서 보낸메일함 자체를
//  훑는다. 처음 한 번만 전부 읽고, 그다음부터는 upto 뒤에 들어온 보낸 메일만
//  (createdAt 단일 필드 자동 색인). 새 보낸 메일이 없으면 빈 질의 한 번이다.
//  두 요청이 동시에 채워도 합집합이라 결과가 같다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { ImportanceContext } from "../importance";
import type { MailAddr } from "../types";
import { accountRef, boxRef, readContacts, type MailAccountDoc } from "./store";

/** 오래된 것부터 버린다 — 문서 한도 1MB 안 (주소 5천 · Message-ID 5천 ≈ 500KB) */
const MAX_ADDRS = 5000;
const MAX_IDS = 5000;
const PAGE = 1000;

interface KnownDoc {
  addrs: string[];
  ids: string[];
  upto: number;
}

const knownRef = (db: Firestore, owner: string) => accountRef(db, owner).collection("meta").doc("known");
const low = (a: string | undefined) => (a ?? "").trim().toLowerCase();

/** 끝에 붙이고 겹친 것은 뒤(최근) 것만 남긴 뒤 한도로 자른다 */
function appendRecent(list: string[], add: string[], cap: number): string[] {
  if (!add.length) return list;
  const out = [...list, ...add];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (let i = out.length - 1; i >= 0; i--) {
    if (!out[i] || seen.has(out[i])) continue;
    seen.add(out[i]);
    kept.push(out[i]);
  }
  return kept.reverse().slice(-cap);
}

async function readKnown(db: Firestore, owner: string): Promise<KnownDoc> {
  const ref = knownRef(db, owner);
  const snap = await ref.get();
  const cur: KnownDoc = snap.exists
    ? { addrs: [], ids: [], upto: 0, ...(snap.data() as Partial<KnownDoc>) }
    : { addrs: [], ids: [], upto: 0 };

  let upto = cur.upto;
  const addrs: string[] = [];
  const ids: string[] = [];
  for (;;) {
    const page = await boxRef(db, owner, "sent")
      .where("createdAt", ">", upto)
      .orderBy("createdAt")
      .select("to", "cc", "bcc", "messageId", "createdAt")
      .limit(PAGE)
      .get();
    for (const d of page.docs) {
      for (const a of [...((d.get("to") as MailAddr[]) ?? []), ...((d.get("cc") as MailAddr[]) ?? []), ...((d.get("bcc") as MailAddr[]) ?? [])]) {
        addrs.push(low(a.address));
      }
      const id = d.get("messageId");
      if (typeof id === "string" && id) ids.push(id);
      upto = Math.max(upto, Number(d.get("createdAt")) || 0);
    }
    if (page.size < PAGE) break;
  }
  if (upto === cur.upto) return cur;

  const next: KnownDoc = {
    addrs: appendRecent(cur.addrs, addrs, MAX_ADDRS),
    ids: appendRecent(cur.ids, ids, MAX_IDS),
    upto,
  };
  await ref.set(next);
  return next;
}

/** 팀원 주소 — ERP 에 연결된 메일 계정 · 팀원 명단의 이메일 */
async function teamSet(db: Firestore): Promise<Set<string>> {
  const [accounts, members] = await Promise.all([
    db.collection(NEANDER_COL.mailAccounts).select("address").get(),
    db.collection(NEANDER_COL.members).select("email").get(),
  ]);
  const out = new Set<string>();
  for (const d of accounts.docs) out.add(low(d.get("address")));
  for (const d of members.docs) out.add(low(d.get("email")));
  out.delete("");
  return out;
}

/** 이 메일 계정의 판정 재료 */
export async function importanceContext(db: Firestore, acc: MailAccountDoc): Promise<ImportanceContext> {
  const [known, contacts, team] = await Promise.all([readKnown(db, acc.owner), readContacts(db, acc.owner), teamSet(db)]);
  const mine = new Set([low(acc.address), ...(acc.externals ?? []).map((x) => low(x.address))].filter(Boolean));
  // 계정 자신은 팀원이 아니다 — 공용 계정 주소로 온 메일은 「내 메일」이다
  for (const a of mine) team.delete(a);
  return {
    mine,
    known: new Set([...known.addrs, ...contacts.map((c) => low(c.address))]),
    sentIds: new Set(known.ids),
    team,
  };
}
