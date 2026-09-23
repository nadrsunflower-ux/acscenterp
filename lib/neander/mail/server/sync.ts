import "server-only";

// ============================================================
//  카페24(+외부 메일) → ERP 메일 가져오기
// ------------------------------------------------------------
//  화면이 열려 있는 동안 브라우저가 20초마다 부른다 (MailProvider).
//  서버에 상주 프로세스가 없으니(Vercel) 밀어 주는 쪽이 없다 — POP3 에는
//  푸시도 없다. 대신 한 번의 확인을 싸게 만든다:
//
//    로그인 → STAT → 지난번과 같으면 끝   (Firestore 읽기 1 · 쓰기 0)
//                  → 다르면 UIDL 로 새 것만 RETR → 저장
//
//  처음 연결할 때는 최근 INITIAL_IMPORT 통만 가져오고 나머지는 「예전 메일」
//  로 미뤄 둔다 (importOlder 로 조금씩). 처음부터 몇천 통을 받으면 함수
//  시간 한도를 넘고 Firestore 용량도 금방 찬다.
//
//  외부 메일(네이버·Gmail 등, 카페24 「외부 메일 설정」)은 같은 길을 2분에
//  한 번 돈다. 20초마다 남의 서버에 로그인하면 그쪽이 막는다.
//
//  ⚠️ 비밀번호가 틀리면 즉시 멈춘다. 20초마다 틀린 비밀번호로 두드리면
//     카페24 가 계정을 잠근다. 한 번은 일시 오류일 수 있어 두 번 연속일 때
//     authFailed 로 세우고, 사용자가 비밀번호를 다시 넣을 때까지 쉰다.
// ============================================================

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { ConnectionOptions } from "node:tls";
import type { MailBox, MailSummary, MailSyncResult } from "../types";
import { externalTlsOptions, popTlsOptions } from "./cafe24";
import { Pop3, Pop3Error } from "./pop3";
import { parseMail, signalFields } from "./parse";
import { openSecret } from "./secret";
import { fetchRawImap, importOlderImap, isImapAccount, syncImapAccount } from "./imap";
import {
  MAIL_SCHEMA,
  accountRef,
  boxRef,
  countUnread,
  hashUid,
  metaRef,
  readAccount,
  sortKeys,
  stripUndefined,
  toSummary,
  type ExternalAccountDoc,
  type MailAccountDoc,
  type MailDoc,
  type UidlMeta,
} from "./store";
import type { MailSyncResult as SyncResult } from "../types";

/** 처음 연결할 때 가져오는 최근 메일 수 */
const INITIAL_IMPORT = 30;
/** 한 번의 확인에서 가져오는 최대 수 — 나머지는 다음 확인이 잇는다 */
const MAX_PER_RUN = 30;
/** 「이전 메일 더 가져오기」 한 번 */
export const OLDER_BATCH = 30;
/** 함수 시간 한도(60초) 안에서 저장까지 마치도록 가져오기를 멈추는 시점 */
const IMPORT_BUDGET_MS = 40_000;
/** 비밀번호 오류가 이만큼 이어지면 확인을 멈춘다 */
const AUTH_FAIL_LIMIT = 2;
/** 외부 메일은 이 간격으로만 확인한다 */
const EXTERNAL_EVERY_MS = 120_000;

interface ListItem {
  n: number;
  uid: string;
  h: string;
}

/** 어느 받는 서버인가 — 카페24 본 계정 또는 외부 메일 하나 */
type Source = { kind: "main" } | { kind: "ext"; ext: ExternalAccountDoc };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function endpoint(acc: MailAccountDoc, src: Source): { host: string; tls: ConnectionOptions; user: string; pass: string } {
  if (src.kind === "main") {
    return { host: acc.popHost, tls: popTlsOptions(acc.popHost), user: acc.address, pass: openSecret(acc.secret, acc.owner) };
  }
  const x = src.ext;
  return {
    host: x.host,
    tls: externalTlsOptions(x.host),
    user: x.address,
    pass: openSecret(x.secret, `${acc.owner}#${x.id}`),
  };
}

async function openSession(acc: MailAccountDoc, src: Source = { kind: "main" }): Promise<Pop3> {
  const ep = endpoint(acc, src);
  const pop = await Pop3.connect(ep.host, ep.tls);
  try {
    await pop.login(ep.user, ep.pass);
    return pop;
  } catch (e) {
    pop.close();
    throw e;
  }
}

/** 연결하기 전에 로그인만 해 본다 */
export async function testPop(host: string, address: string, password: string, external = false): Promise<void> {
  const pop = await Pop3.connect(host, external ? externalTlsOptions(host) : popTlsOptions(host));
  try {
    await pop.login(address, password);
    await pop.stat();
  } finally {
    await pop.quit();
  }
}

async function listing(pop: Pop3): Promise<ListItem[]> {
  return (await pop.uidl()).map((x) => ({ ...x, h: hashUid(x.uid) }));
}

async function readMeta(db: Firestore, owner: string, ext?: string): Promise<UidlMeta> {
  const snap = await metaRef(db, owner, ext).get();
  const d = snap.data() as Partial<UidlMeta> | undefined;
  return { seen: d?.seen ?? [], older: d?.older ?? [] };
}

/** 문서 id — 외부 메일은 계정 id 를 앞에 붙여 카페24 메일과 겹치지 않게 */
const docId = (src: Source, h: string) => (src.kind === "main" ? h : `x${src.ext.id}_${h}`);

/**
 * 한 통을 가져와 받은편지함(또는 스팸함)에 넣는다. 넣지 않았으면 null.
 *
 * 내가 ERP 에서 보낸 메일의 사본(숨은 참조로 내게 온 것)과 내게쓰기는
 * 받은편지함에 넣지 않고 보낸·내게쓴 메일 문서에 원문 위치만 잇는다 —
 * 보낸 첨부를 나중에 다시 열 수 있게 된다.
 */
async function importOne(
  db: Firestore,
  acc: MailAccountDoc,
  src: Source,
  pop: Pop3,
  x: ListItem,
  read: boolean,
): Promise<MailSummary | null> {
  const m = await parseMail(await pop.retr(x.n));
  const from = m.from.address.toLowerCase();

  if (src.kind === "main" && m.messageId && from === acc.address.toLowerCase()) {
    for (const box of ["sent", "self"] as const) {
      const hit = await boxRef(db, acc.owner, box).where("messageId", "==", m.messageId).limit(1).get();
      if (!hit.empty) {
        await hit.docs[0].ref.update({ uidl: x.uid, uidlHash: x.h });
        return null;
      }
    }
  }

  // 스팸 신고한 보낸 사람은 스팸메일함으로
  const box: MailBox = (acc.blocked ?? []).includes(from) ? "spam" : "inbox";
  const base = {
    from: m.from,
    to: m.to,
    cc: m.cc,
    replyTo: m.replyTo.length ? m.replyTo : undefined,
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
    read,
    attachments: m.attachments,
  };
  const doc: MailDoc = stripUndefined({
    ...base,
    ...sortKeys(base),
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
    references: m.references,
    ...signalFields(m),
    uidl: x.uid,
    uidlHash: x.h,
    acct: src.kind === "ext" ? src.ext.id : undefined,
    body: m.body,
    partial: m.partial,
    createdAt: Date.now(),
  });
  const id = docId(src, x.h);
  try {
    // 두 탭이 동시에 확인해도 한 통은 한 번만 — id 가 UIDL 해시라 두 번째는 실패한다
    await boxRef(db, acc.owner, box).doc(id).create(doc);
  } catch (e) {
    if ((e as { code?: number }).code === 6) return null; // ALREADY_EXISTS
    throw e;
  }
  return toSummary(id, box, doc, acc.externals);
}

/** 외부 메일 계정 한 칸만 고친다 (배열째 다시 쓴다) */
async function patchExternal(db: Firestore, owner: string, id: string, patch: Partial<ExternalAccountDoc>) {
  const ref = accountRef(db, owner);
  await db.runTransaction(async (tx) => {
    const a = (await tx.get(ref)).data() as MailAccountDoc | undefined;
    if (!a) return;
    const externals = (a.externals ?? []).map((x) => (x.id === id ? stripUndefined({ ...x, ...patch }) : x));
    tx.update(ref, { externals });
  });
}

/** 로그인 실패를 기록한다. 이어서 실패하면 확인을 멈춘다 */
async function noteLoginFailure(db: Firestore, acc: MailAccountDoc, src: Source, e: unknown): Promise<boolean> {
  const msg = errMsg(e);
  const prev = src.kind === "main" ? acc : src.ext;
  if (e instanceof Pop3Error && e.auth) {
    const count = (prev.authFailCount ?? 0) + 1;
    const patch = { authFailCount: count, authFailed: count >= AUTH_FAIL_LIMIT, lastError: msg, lastCheckedAt: Date.now() };
    if (src.kind === "main") await accountRef(db, acc.owner).update(patch);
    else await patchExternal(db, acc.owner, src.ext.id, patch);
    return patch.authFailed;
  }
  // 일시 오류 — 같은 문구면 다시 쓰지 않는다 (20초마다 쓰기가 쌓이지 않게)
  if (src.kind === "main" && (prev.lastError !== msg || !acc.errorSince)) {
    await accountRef(db, acc.owner).update({ lastError: msg, errorSince: acc.errorSince ?? Date.now() });
  } else if (prev.lastError !== msg) {
    if (src.kind === "main") await accountRef(db, acc.owner).update({ lastError: msg });
    else await patchExternal(db, acc.owner, src.ext.id, { lastError: msg, lastCheckedAt: Date.now() });
  }
  return false;
}

/** 옛 모양의 메일 문서에 거르기용 정렬 키를 붙인다 (한 번만) */
async function migrate(db: Firestore, acc: MailAccountDoc): Promise<void> {
  if ((acc.schema ?? 1) >= MAIL_SCHEMA) return;
  for (const box of ["inbox", "sent", "trash"] as const) {
    const snap = await boxRef(db, acc.owner, box).select("date", "read", "starred", "attachments").get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + 400)) {
        const v = d.data() as Pick<MailDoc, "date" | "read" | "starred" | "attachments">;
        batch.update(d.ref, sortKeys({ date: v.date ?? 0, read: !!v.read, starred: !!v.starred, attachments: v.attachments ?? [] }));
      }
      await batch.commit();
    }
  }
  await accountRef(db, acc.owner).update({ schema: MAIL_SCHEMA });
}

interface RunResult {
  status: MailSyncResult["status"];
  added: MailSummary[];
  error?: string;
  first: boolean;
}

/** 받는 서버 하나를 한 번 확인한다 */
async function runSource(
  db: Firestore,
  acc: MailAccountDoc,
  src: Source,
  started: number,
  force: boolean,
): Promise<RunResult> {
  const owner = acc.owner;
  const state = src.kind === "main" ? acc : src.ext;
  const extId = src.kind === "ext" ? src.ext.id : undefined;
  if (state.authFailed) return { status: "auth_failed", added: [], error: state.lastError ?? undefined, first: false };

  let pop: Pop3;
  try {
    pop = await openSession(acc, src);
  } catch (e) {
    const stopped = await noteLoginFailure(db, acc, src, e);
    return { status: stopped ? "auth_failed" : "error", added: [], error: errMsg(e), first: false };
  }

  try {
    const stat = await pop.stat();
    const pendingDelete = src.kind === "main" ? acc.pendingDelete ?? [] : [];
    const unchanged =
      !force &&
      state.initialized &&
      pendingDelete.length === 0 &&
      state.stat?.count === stat.count &&
      state.stat?.size === stat.size;
    if (unchanged) {
      await pop.quit();
      // 오류에서 막 풀렸으면 표시를 지운다 (그 외에는 쓰지 않는다)
      // 용량을 아직 적어 두지 않은 계정(용량 표시 이전에 연결)은 한 번만 적는다
      if (src.kind === "main" && !acc.usage) {
        await accountRef(db, owner).update({ usage: { bytes: stat.size, count: stat.count } });
      }
      if (state.lastError || state.authFailCount) {
        if (src.kind === "main") await accountRef(db, owner).update({ lastError: null, errorSince: null, authFailCount: 0 });
        else await patchExternal(db, owner, src.ext.id, { lastError: null, authFailCount: 0, lastCheckedAt: Date.now() });
      } else if (src.kind === "ext") {
        await patchExternal(db, owner, src.ext.id, { lastCheckedAt: Date.now() });
      }
      return { status: "ok", added: [], first: false };
    }

    const list = await listing(pop);
    const meta = await readMeta(db, owner, extId);
    const seen = new Set(meta.seen);

    // 1) ERP 에서 영구 삭제한 메일을 카페24 에서도 지운다 (QUIT 때 확정)
    const del = new Set(pendingDelete);
    for (const x of list) if (del.has(x.h)) await pop.dele(x.n);
    const live = list.filter((x) => !del.has(x.h));

    // 2) 새 메일 — 최신부터
    const fresh = live.filter((x) => !seen.has(x.h)).sort((a, b) => b.n - a.n);
    const first = !state.initialized;
    const toImport = first ? fresh.slice(0, INITIAL_IMPORT) : fresh;

    const added: MailSummary[] = [];
    let done = 0;
    for (const x of toImport.slice(0, MAX_PER_RUN)) {
      if (Date.now() - started > IMPORT_BUDGET_MS) break;
      // 처음 가져오는 것은 이미 웹메일에서 본 메일이다 — 읽음으로 넣어 배지가 튀지 않게
      const s = await importOne(db, acc, src, pop, x, first);
      seen.add(x.h);
      done++;
      if (s) added.push(s);
    }

    // 처음 연결 때 못 가져온 것은 「예전 메일」로 미룬다 (최신이 앞) — 외부 메일은 버린다.
    // 그냥 두면 다음 확인이 새 메일로 여겨 안 읽음으로 넣는다.
    let older = meta.older;
    if (first) {
      const rest = fresh.slice(done);
      for (const x of rest) seen.add(x.h);
      if (src.kind === "main") older = [...rest.map((x) => x.h), ...older];
    }
    const complete = first || done === toImport.length;

    // 3) 서버에서 사라진 표시는 버린다 (목록이 끝없이 자라지 않게)
    const liveSet = new Set(live.map((x) => x.h));
    const nextOlder = older.filter((h) => liveSet.has(h));
    await metaRef(db, owner, extId).set({
      seen: [...seen].filter((h) => liveSet.has(h)),
      older: nextOlder,
    } satisfies UidlMeta);

    const common = {
      initialized: true,
      // 다 못 가져왔거나 지운 게 있으면 다음 확인이 STAT 으로 건너뛰지 않게 비워 둔다
      stat: complete && del.size === 0 ? stat : null,
      lastCheckedAt: Date.now(),
      lastError: null,
      authFailCount: 0,
    };
    if (src.kind === "main") {
      await accountRef(db, owner).update({
        ...common,
        olderCount: nextOlder.length,
        errorSince: null,
        usage: { bytes: stat.size, count: stat.count },
        ...(pendingDelete.length ? { pendingDelete: FieldValue.arrayRemove(...pendingDelete) } : {}),
      });
    } else {
      await patchExternal(db, owner, src.ext.id, common);
    }
    await pop.quit();
    return { status: "ok", added, first };
  } catch (e) {
    pop.close(); // QUIT 없이 끊어 DELE 를 취소한다
    const msg = errMsg(e);
    if (src.kind === "main" && (state.lastError !== msg || !acc.errorSince)) {
      await accountRef(db, owner).update({ lastError: msg, errorSince: acc.errorSince ?? Date.now() });
    } else if (state.lastError !== msg) {
      if (src.kind === "main") await accountRef(db, owner).update({ lastError: msg });
      else await patchExternal(db, owner, src.ext.id, { lastError: msg });
    }
    return { status: "error", added: [], error: msg, first: false };
  }
}

export async function syncMailbox(db: Firestore, owner: string, opts: { force?: boolean } = {}): Promise<MailSyncResult> {
  const started = Date.now();
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("연결된 메일 계정이 없습니다.");

  // 네이버·Gmail — IMAP (imap.ts). 1분에 한 번만 실제로 붙는다
  if (isImapAccount(acc)) {
    const r = await syncImapAccount(db, acc, { force: opts.force, started });
    const next = r.status !== "skipped" ? await readAccount(db, owner) : acc;
    // 실제로 붙는 건 1분에 한 번이다. 그 사이 건너뛴 확인은 지난 실제 확인의 결과(오류 포함)를
    // 그대로 돌려준다 — 「ok」로 돌려주면 오류 알림이 1분마다 떴다 사라졌다 한다.
    const skippedError = r.status === "skipped" ? acc.lastError ?? undefined : undefined;
    return {
      status: r.status === "skipped" ? (skippedError ? "error" : "ok") : r.status,
      added: r.added,
      unread: r.added.some((m) => m.box === "inbox") || r.first ? await countUnread(db, owner) : null,
      olderCount: next?.imapState?.inbox?.older ?? 0,
      checkedAt: r.status === "skipped" ? acc.lastCheckedAt ?? Date.now() : Date.now(),
      error: skippedError ?? r.error,
      errorSince: skippedError || r.error ? next?.errorSince ?? undefined : undefined,
    } satisfies SyncResult;
  }

  await migrate(db, acc);

  const main = await runSource(db, acc, { kind: "main" }, started, !!opts.force);
  const added = [...main.added];

  // 외부 메일 — 2분에 한 번 (새로고침 단추는 바로)
  for (const ext of acc.externals ?? []) {
    if (ext.authFailed) continue;
    if (!opts.force && ext.lastCheckedAt && Date.now() - ext.lastCheckedAt < EXTERNAL_EVERY_MS) continue;
    if (Date.now() - started > IMPORT_BUDGET_MS) break;
    const r = await runSource(db, acc, { kind: "ext", ext }, started, !!opts.force);
    added.push(...r.added);
  }
  added.sort((a, b) => b.date - a.date);

  const next = await readAccount(db, owner);
  const inboxAdded = added.some((m) => m.box === "inbox");
  return {
    status: main.status,
    added,
    unread: inboxAdded || main.first ? await countUnread(db, owner) : null,
    olderCount: next?.olderCount ?? acc.olderCount ?? 0,
    checkedAt: Date.now(),
    error: main.error,
    errorSince: main.error ? next?.errorSince ?? undefined : undefined,
  };
}

/** 외부 메일 하나를 처음 연결한 직후 바로 한 번 가져온다 */
export async function syncExternalNow(db: Firestore, owner: string, id: string): Promise<MailSummary[]> {
  const acc = await readAccount(db, owner);
  const ext = acc?.externals?.find((x) => x.id === id);
  if (!acc || !ext) return [];
  const r = await runSource(db, acc, { kind: "ext", ext }, Date.now(), true);
  if (r.status !== "ok") throw new Error(r.error || "외부 메일을 가져오지 못했습니다.");
  return r.added;
}

/**
 * 미뤄 둔 예전 메일을 최신부터 count 통 더 가져온다. 카페24 는 받은메일함만,
 * 네이버·Gmail 은 받은메일함·보낸메일함 모두 (서버 폴더를 바로 읽는다).
 */
export async function importOlder(
  db: Firestore,
  owner: string,
  count = OLDER_BATCH,
  box: "inbox" | "sent" = "inbox",
): Promise<MailSyncResult> {
  const started = Date.now();
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("연결된 메일 계정이 없습니다.");
  if (isImapAccount(acc)) {
    const r = await importOlderImap(db, acc, box);
    return { status: "ok", added: r.added, unread: null, olderCount: r.older, checkedAt: Date.now() };
  }
  const src: Source = { kind: "main" };
  const pop = await openSession(acc, src);
  try {
    const byHash = new Map((await listing(pop)).map((x) => [x.h, x]));
    const meta = await readMeta(db, owner);
    const remaining: string[] = [];
    const added: MailSummary[] = [];
    let taken = 0;
    for (const h of meta.older) {
      const x = byHash.get(h);
      if (!x) continue; // 서버에서 이미 지워졌다
      if (taken >= count || Date.now() - started > IMPORT_BUDGET_MS) {
        remaining.push(h);
        continue;
      }
      taken++;
      const s = await importOne(db, acc, src, pop, x, true);
      if (s) added.push(s);
    }
    await metaRef(db, owner).set({ older: remaining }, { merge: true });
    await accountRef(db, owner).update({ olderCount: remaining.length });
    await pop.quit();
    return { status: "ok", added, unread: null, olderCount: remaining.length, checkedAt: Date.now() };
  } catch (e) {
    pop.close();
    throw e;
  }
}

/** 메일 문서의 원문 — IMAP 계정이면 그 폴더에서, 카페24 면 POP3 로 */
export async function fetchRawForDoc(db: Firestore, owner: string, d: MailDoc): Promise<Buffer> {
  if (d.imap) {
    const acc = await readAccount(db, owner);
    if (!acc) throw new Error("연결된 메일 계정이 없습니다.");
    return fetchRawImap(acc, d.imap);
  }
  if (d.uidlHash) return fetchRaw(db, owner, d.uidlHash, d.acct);
  throw new Error("원문이 메일 서버에 없습니다.");
}

/**
 * 서버에 있는 원문을 다시 받는다 (첨부 열기 · 잘린 본문 · 전달 첨부).
 * 20초 확인과 겹쳐 로그인이 거절되면 LOGIN-DELAY(10초) 뒤 한 번 더 해 본다.
 */
export async function fetchRaw(db: Firestore, owner: string, uidlHash: string, acct?: string | null): Promise<Buffer> {
  const acc = await readAccount(db, owner);
  if (!acc) throw new Error("연결된 메일 계정이 없습니다.");
  let src: Source = { kind: "main" };
  if (acct) {
    const ext = acc.externals?.find((x) => x.id === acct);
    if (!ext) throw new Error("이 메일을 받은 외부 메일 계정이 지워져 원문을 받을 수 없습니다.");
    src = { kind: "ext", ext };
  }
  let pop: Pop3;
  try {
    pop = await openSession(acc, src);
  } catch (e) {
    if (!(e instanceof Pop3Error)) throw e;
    await new Promise((r) => setTimeout(r, 11_000));
    pop = await openSession(acc, src);
  }
  try {
    const hit = (await listing(pop)).find((x) => x.h === uidlHash);
    if (!hit) throw new Error("메일 서버에 원문이 없습니다. 웹메일이나 휴대폰에서 지웠을 수 있어요.");
    const raw = await pop.retr(hit.n);
    await pop.quit();
    return raw;
  } catch (e) {
    pop.close();
    throw e;
  }
}
