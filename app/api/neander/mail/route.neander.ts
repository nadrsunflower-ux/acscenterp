import { NextResponse } from "next/server";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireMember } from "@/lib/neander/server/auth";
import { popHostFor } from "@/lib/neander/mail/server/cafe24";
import { mailKeyConfigured, sealSecret } from "@/lib/neander/mail/server/secret";
import { testSmtp, testSmtpAt } from "@/lib/neander/mail/server/send";
import { IMAP_PRESETS, findImapLogin, testImap } from "@/lib/neander/mail/server/imap";
import { importOlder, syncMailbox, testPop } from "@/lib/neander/mail/server/sync";
import {
  addContact,
  addExternal,
  createFolder,
  deleteFolder,
  emptyBox,
  markNotSpam,
  markSpam,
  moveMails,
  purgeMails,
  removeContact,
  removeExternal,
  renameFolder,
  restoreMails,
  setRead,
  setStar,
  shareFolder,
  unblockSender,
  updateExternalPassword,
} from "@/lib/neander/mail/server/boxes";
import {
  cancelScheduled,
  countScheduled,
  deleteDraft,
  deleteScheduledOf,
  dispatchDue,
  listScheduled,
  saveDraft,
  sendScheduledNow,
} from "@/lib/neander/mail/server/compose";
import { deleteReceipts, listReceipts } from "@/lib/neander/mail/server/track";
import { importanceContext } from "@/lib/neander/mail/server/known";
import { judgeImportance } from "@/lib/neander/mail/importance";
import {
  FILTER_KEY,
  MailAccessError,
  SUMMARY_FIELDS,
  accountRef,
  accountView,
  boxRef,
  countUnread,
  listSharedFolders,
  listUserAccounts,
  newAccountKey,
  readAccount,
  readContacts,
  readSignatures,
  resolveAccount,
  signaturesRef,
  resolveBox,
  snapSummary,
  userOf,
  type MailAccountDoc,
} from "@/lib/neander/mail/server/store";
import {
  MAX_SIGNATURES,
  MAX_SIGNATURE_BYTES,
  MAX_SIGNATURE_TOTAL_BYTES,
  isCustomBox,
  isMailBox,
  type MailBox,
  type MailComposeState,
  type MailProvider,
  type MailSignature,
  type MailCounts,
  type MailFilter,
  type MailSummary,
  type MailSyncResult,
} from "@/lib/neander/mail/types";

// 메일 — 계정 연결 · 목록 · 확인(20초마다) · 메일함 동작.
//
// 메일은 **개인** 기능이라 재무 허용 목록이 아니라 팀원 확인만 한다
// (requireMember). 한 사람이 메일 계정을 여러 개 로그인해 둘 수 있어 요청마다
// acct(계정 키)를 받되, 그 계정의 주인이 검증된 토큰의 이메일인지 확인한다
// (resolveAccount). 예외는 동료가 **공유한** 폴더를 읽을 때뿐이다 (resolveBox).
//
// ⚠️ 파일명이 route.neander.ts 인 이유: next.config.mjs 의 pageExtensions
//    분기로 매장(ACSCENT) 빌드에서 제외하기 위해서다.
export const dynamic = "force-dynamic";
// 처음 연결은 최근 메일 30통을 받아 저장한다 — 기본 한도(10초)로는 모자라다
export const maxDuration = 60;

const PAGE = 50;
const FILTERS: MailFilter[] = ["unread", "starred", "read", "attach"];

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  if (e instanceof MailAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
  console.error("[mail]", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

async function countsOf(db: Firestore, owner: string): Promise<MailCounts> {
  const [unread, spamUnread, drafts, scheduled] = await Promise.all([
    countUnread(db, owner, "inbox"),
    countUnread(db, owner, "spam"),
    boxRef(db, owner, "drafts").count().get().then((a) => a.data().count),
    countScheduled(db, owner),
  ]);
  return { unread, spamUnread, drafts, scheduled };
}

/** 팀 주소록 — ERP 에 메일을 연결한 동료들 (내 다른 계정은 빼고) */
async function teamAddresses(db: Firestore, viewer: string) {
  const snap = await db.collection(NEANDER_COL.mailAccounts).select("address", "name", "user").get();
  return snap.docs
    .filter((d) => (d.get("user") ?? d.id) !== viewer)
    .map((d) => ({ address: String(d.get("address") ?? ""), name: String(d.get("name") ?? "") || undefined }))
    .filter((a) => a.address);
}

/** 내 계정들(+ 팀 공용) — 계정마다 메일함 수(계정 전환 목록의 배지)와 서명을 붙여서 */
async function accountViews(db: Firestore, me: string) {
  const list = await listUserAccounts(db, me);
  return Promise.all(
    list.map(async (a) => {
      const [counts, signatures] = await Promise.all([countsOf(db, a.owner), readSignatures(db, a)]);
      return { ...accountView(a), mine: userOf(a) === me, counts, signatures };
    }),
  );
}

/** 공용 계정의 주인 전용 동작 (연결 끊기 · 비밀번호 · 공용 켜고 끄기) */
function ownerOnly(acc: MailAccountDoc, me: string) {
  if (userOf(acc) !== me) {
    throw new MailAccessError(`공용 계정은 연결한 사람(${userOf(acc)})만 이 설정을 바꿀 수 있습니다.`);
  }
}

/** 서명 저장 — 크기를 막고 id 를 다듬는다 */
function cleanSignatures(raw: unknown): MailSignature[] {
  if (!Array.isArray(raw)) throw new Error("서명 목록이 올바르지 않습니다.");
  if (raw.length > MAX_SIGNATURES) throw new Error(`서명은 ${MAX_SIGNATURES}개까지 둘 수 있습니다.`);
  let total = 0;
  const list = raw.map((x, i): MailSignature => {
    const s = x as Partial<MailSignature>;
    const html = String(s.html ?? "");
    const bytes = Buffer.byteLength(html);
    if (bytes > MAX_SIGNATURE_BYTES) throw new Error(`「${s.name ?? "서명"}」이 너무 큽니다. 로고 이미지를 더 작게 넣어 주세요 (서명 하나 300KB).`);
    total += bytes;
    const id = typeof s.id === "string" && /^[\w-]{1,40}$/.test(s.id) ? s.id : `s${Date.now().toString(36)}${i}`;
    return { id, name: String(s.name ?? "").trim().slice(0, 30) || `서명 ${i + 1}`, html };
  });
  if (total > MAX_SIGNATURE_TOTAL_BYTES) throw new Error("서명을 합쳐 800KB 까지 둘 수 있습니다. 로고 이미지를 줄여 주세요.");
  return list;
}

/**
 * 안 읽은 받은 메일에 「중요」 이유를 붙인다 (importance.ts). 받은메일함·내 폴더만 —
 * 스팸함은 뺀다. 판정 재료를 못 읽어도 목록은 그대로 나가야 한다.
 */
const judged = (s: MailSummary) => !s.read && (s.box === "inbox" || isCustomBox(s.box));

async function markImportant(db: Firestore, acc: MailAccountDoc, rows: { s: MailSummary; d: DocumentData }[]) {
  const todo = rows.filter(({ s }) => judged(s));
  if (!todo.length) return;
  try {
    const ctx = await importanceContext(db, acc);
    for (const { s, d } of todo) {
      const why = judgeImportance(
        { from: s.from, subject: s.subject, inReplyTo: d.inReplyTo, references: d.references, bulk: !!d.bulk },
        ctx,
      );
      if (why) s.important = why;
    }
  } catch (e) {
    console.error("[mail] 중요 메일 판정", e instanceof Error ? e.message : e);
  }
}

/** 새 메일에 어느 계정 것인지 붙이고, 중요한 것은 표시한다 (화면이 그 계정의 목록에 끼운다) */
async function tag(db: Firestore, key: string, r: MailSyncResult): Promise<MailSyncResult> {
  const added = r.added.map((m) => ({ ...m, acct: key }));
  const unread = added.filter(judged);
  if (!unread.length) return { ...r, added };
  try {
    const acc = await readAccount(db, key);
    if (acc) {
      // 판정 신호(답장 머리 · 대량 발송)는 목록 요약에 없다 — 새로 온 몇 통만 다시 읽는다
      const snaps = await db.getAll(...unread.map((m) => boxRef(db, key, m.box as MailBox).doc(m.id)), {
        fieldMask: ["inReplyTo", "references", "bulk"],
      });
      await markImportant(db, acc, unread.map((s, i) => ({ s, d: snaps[i].data() ?? {} })));
    }
  } catch (e) {
    console.error("[mail] 중요 메일 판정", e instanceof Error ? e.message : e);
  }
  return { ...r, added };
}

/** 한 번의 확인이 모든 계정을 도는 시간 한도 (함수 60초 안) */
const SYNC_ALL_BUDGET_MS = 45_000;

export async function GET(req: Request) {
  try {
    const { email: me } = await requireMember(req);
    const db = adminDb();
    const url = new URL(req.url);
    const configured = mailKeyConfigured();
    const acct = url.searchParams.get("acct");
    const view = url.searchParams.get("view");
    const box = url.searchParams.get("box");

    if (!box && !view) {
      const [accounts, shared] = await Promise.all([accountViews(db, me), listSharedFolders(db, me)]);
      return NextResponse.json({ accounts, configured, shared });
    }

    if (view === "contacts") {
      const acc = await resolveAccount(db, me, acct);
      const [contacts, team] = await Promise.all([readContacts(db, acc.owner), teamAddresses(db, me)]);
      return NextResponse.json({ contacts, team });
    }
    if (view === "receipts") {
      const acc = await resolveAccount(db, me, acct);
      return NextResponse.json({ receipts: await listReceipts(db, acc.owner) });
    }
    if (view === "scheduled") {
      const acc = await resolveAccount(db, me, acct);
      return NextResponse.json({ list: { items: await listScheduled(db, acc.owner), hasMore: false } });
    }

    const at = await resolveBox(db, me, box, acct);
    const filter = url.searchParams.get("filter") as MailFilter | null;
    const key = filter && FILTERS.includes(filter) ? FILTER_KEY[filter] : "date";
    const before = Number(url.searchParams.get("before")) || 0;
    let q = boxRef(db, at.owner, at.box).orderBy(key, "desc");
    if (before) q = q.startAfter(before);
    const snap = await q
      .select(...SUMMARY_FIELDS)
      .limit(PAGE + 1)
      .get();
    const rows = snap.docs.slice(0, PAGE).map((d) => ({ s: snapSummary(d, at.box, at.account.externals), d: d.data() }));
    // 남의 공유 폴더는 판정하지 않는다 — 「아는 사람」은 내 보낸메일함 기준이다
    if (!at.readonly) await markImportant(db, at.account, rows);
    return NextResponse.json({
      list: {
        items: rows.map((r) => r.s),
        hasMore: snap.docs.length > PAGE,
      },
    });
  } catch (e) {
    return failure(e);
  }
}

interface Body {
  action?: string;
  address?: string;
  password?: string;
  name?: string;
  /** externalAdd: 외부 메일 이름 · update: 계정 별칭 (빈 값이면 지운다) */
  label?: string;
  /** update: 계정 동그라미 — 빈 값이면 지운다 */
  avatarPhoto?: string;
  avatarEmoji?: string;
  avatarColor?: string;
  host?: string;
  signature?: string;
  keepSentCopy?: boolean;
  trackOpens?: boolean;
  quotaMB?: number;
  force?: boolean;
  box?: string;
  to?: string;
  id?: string;
  ids?: string[];
  read?: boolean;
  starred?: boolean;
  shared?: boolean;
  draftId?: string;
  compose?: MailComposeState;
  /** 어느 메일 계정 (계정 키) */
  acct?: string;
  /** connect: 새 계정으로 더 붙인다 */
  add?: boolean;
  /** connect: 메일 서비스 (없으면 카페24) */
  provider?: MailProvider;
  /** team: 팀 공용 켜고 끄기 */
  team?: boolean;
}

const isDocId = (s: unknown): s is string => typeof s === "string" && /^[\w-]{1,80}$/.test(s);

export async function POST(req: Request) {
  let me: string;
  try {
    me = (await requireMember(req)).email;
  } catch (e) {
    return failure(e);
  }

  try {
    const body = (await req.json()) as Body;
    const db = adminDb();
    const ids = body.ids ?? (body.id ? [body.id] : []);

    // ---- 계정 연결 (새로 · 더 붙이기 · 다시) ----------------------
    if (body.action === "connect") {
      const address = body.address?.trim().toLowerCase() ?? "";
      // Gmail 앱 비밀번호는 「abcd efgh ijkl mnop」처럼 띄어 보여 준다 — 붙여 넣은 칸 사이 공백은 뗀다
      const password = body.provider === "gmail" ? (body.password ?? "").replace(/\s+/g, "") : body.password ?? "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return bad("메일 주소를 확인해 주세요.");
      if (!password) return bad("메일 비밀번호를 넣어 주세요.");
      if (!mailKeyConfigured()) return bad("서버에 NEANDER_MAIL_KEY 가 없어 비밀번호를 보관할 수 없습니다.");
      const visible = await listUserAccounts(db, me);
      // 팀 공용 계정은 목록에 보이지만 내 자리가 아니다 — 키를 정할 때는 내 계정만 센다
      const mine = visible.filter((a) => userOf(a) === me);
      const teamDup = visible.find((a) => a.address === address && userOf(a) !== me);
      if (teamDup) return bad(`${address} 은(는) 이미 팀 공용 계정으로 연결돼 있습니다. 메일 계정 목록에서 바로 쓰면 됩니다.`);
      const dup = mine.find((a) => a.address === address);
      if (body.add && dup) return bad(`${address} 은(는) 이미 연결한 계정입니다.`);

      const provider: MailProvider = body.provider === "naver" || body.provider === "gmail" ? body.provider : "cafe24";
      // 저장하기 전에 받기·보내기 둘 다 로그인해 본다
      let server: Pick<MailAccountDoc, "popHost" | "smtpHost" | "imapHost" | "imapPort" | "smtpPort" | "smtpSecure" | "loginUser">;
      if (provider === "cafe24") {
        const popHost = popHostFor(address);
        await testPop(popHost, address, password);
        server = { popHost, smtpHost: await testSmtp(address, password) };
      } else {
        const p = IMAP_PRESETS[provider];
        const loginUser = await findImapLogin(provider, p.imapHost, p.imapPort, address, password);
        await testSmtpAt(p.smtpHost, p.smtpPort, p.smtpSecure, loginUser, password);
        server = {
          popHost: "",
          smtpHost: p.smtpHost,
          imapHost: p.imapHost,
          imapPort: p.imapPort,
          smtpPort: p.smtpPort,
          smtpSecure: p.smtpSecure,
          ...(loginUser !== address ? { loginUser } : {}),
        };
      }

      // 키: 첫 계정은 ERP 이메일, 더 붙이면 새 키, 다시 연결이면 그 계정
      let key: string;
      if (body.add) key = mine.length ? newAccountKey(me) : me;
      else if (body.acct) {
        const target = await resolveAccount(db, me, body.acct);
        ownerOnly(target, me);
        key = target.owner;
      }
      else key = mine[0]?.owner ?? me;

      const prev = await readAccount(db, key);
      const same = prev?.address === address;
      // 같은 자리에 다른 주소로 다시 연결하면 예전 메일함은 비운다 (섞이면 안 된다)
      if (prev && !same) await db.recursiveDelete(accountRef(db, key));

      const doc: MailAccountDoc = {
        ...(same ? prev : {}),
        owner: key,
        user: me,
        provider,
        address,
        name: body.name?.trim() || prev?.name || "",
        signature: same ? prev.signature ?? "" : "",
        keepSentCopy: same ? prev.keepSentCopy !== false : true,
        secret: sealSecret(password, key),
        ...server,
        connectedAt: same ? prev.connectedAt : Date.now(),
        initialized: same ? prev.initialized : false,
        stat: null,
        lastError: null,
        errorSince: null,
        authFailed: false,
        authFailCount: 0,
        olderCount: same ? prev.olderCount ?? 0 : 0,
        pendingDelete: same ? prev.pendingDelete ?? [] : [],
      };
      await accountRef(db, key).set(doc);
      const sync = await tag(db, key, await syncMailbox(db, key, { force: true }));
      const accounts = await accountViews(db, me);
      return NextResponse.json({ key, accounts, sync });
    }

    // ---- 모든 계정 확인 (20초마다) --------------------------------
    if (body.action === "sync" && !body.acct) {
      const started = Date.now();
      const syncs: Record<string, MailSyncResult> = {};
      for (const a of await listUserAccounts(db, me)) {
        if (Date.now() - started > SYNC_ALL_BUDGET_MS) break;
        try {
          syncs[a.owner] = await tag(db, a.owner, await syncMailbox(db, a.owner, { force: !!body.force }));
        } catch (e) {
          syncs[a.owner] = { status: "error", added: [], unread: null, olderCount: a.olderCount ?? 0, checkedAt: Date.now(), error: e instanceof Error ? e.message : String(e) };
        }
      }
      // 보낼 때가 된 예약 — 누구의 확인이든 대신 보낸다 (compose.ts)
      await dispatchDue(db).catch((e) => console.error("[mail] 예약 발송", e instanceof Error ? e.message : e));
      return NextResponse.json({ syncs });
    }

    // 나머지 동작은 모두 한 계정에 — 내 계정인지 확인한다
    const acc = await resolveAccount(db, me, body.acct);
    const key = acc.owner;
    const withCounts = async (extra: object = {}) => NextResponse.json({ ...extra, counts: await countsOf(db, key) });
    const view = async () => {
      const a = await readAccount(db, key);
      return a && { ...accountView(a), mine: userOf(a) === me };
    };

    switch (body.action) {
      case "team": {
        // 팀 공용 — 켜면 ERP 팀원 모두의 계정 목록에 나온다 (앱 비밀번호는 다시 안 넣는다)
        ownerOnly(acc, me);
        await accountRef(db, key).update({ team: body.team === true });
        return NextResponse.json({ account: await view() });
      }

      case "signatures": {
        const raw = body as unknown as { list?: unknown; sigNew?: unknown; sigReply?: unknown };
        const list = cleanSignatures(raw.list);
        const pick = (v: unknown) => (typeof v === "string" && list.some((s) => s.id === v) ? v : null);
        await signaturesRef(db, key).set({ list, sigNew: pick(raw.sigNew), sigReply: pick(raw.sigReply) });
        // 옛 글자 서명은 서명 문서로 옮겨졌다 — 다시 「기본 서명」으로 살아나지 않게 비운다
        if (acc.signature) await accountRef(db, key).update({ signature: "" });
        const a = await readAccount(db, key);
        return NextResponse.json({ account: a && { ...accountView(a), signatures: await readSignatures(db, a) } });
      }

      case "update": {
        type Clearable = "label" | "avatarPhoto" | "avatarEmoji" | "avatarColor";
        const patch: Omit<Partial<MailAccountDoc>, Clearable> & Partial<Record<Clearable, string | FieldValue>> = {};
        if (typeof body.label === "string") patch.label = body.label.trim().slice(0, 30) || FieldValue.delete();
        // 사진은 브라우저가 작게 줄여 보낸다 (Storage 가 없어 계정 문서에 그대로 둔다) — 큰 것은 막는다
        if (typeof body.avatarPhoto === "string") {
          const v = body.avatarPhoto;
          if (v && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 60_000)) {
            return bad("사진이 너무 크거나 형식이 맞지 않습니다.");
          }
          patch.avatarPhoto = v || FieldValue.delete();
        }
        if (typeof body.avatarEmoji === "string") patch.avatarEmoji = [...body.avatarEmoji.trim()].slice(0, 8).join("") || FieldValue.delete();
        if (typeof body.avatarColor === "string") {
          patch.avatarColor = /^#[0-9a-f]{6}$/i.test(body.avatarColor) ? body.avatarColor : FieldValue.delete();
        }
        if (typeof body.name === "string") patch.name = body.name.trim();
        if (typeof body.signature === "string") patch.signature = body.signature;
        if (typeof body.keepSentCopy === "boolean") patch.keepSentCopy = body.keepSentCopy;
        if (typeof body.trackOpens === "boolean") patch.trackOpens = body.trackOpens;
        if (typeof body.quotaMB === "number" && body.quotaMB > 0) patch.quotaBytes = Math.round(body.quotaMB * 1024 * 1024);
        if (body.password) {
          ownerOnly(acc, me);
          if (acc.provider && acc.provider !== "cafe24") {
            const pw = acc.provider === "gmail" ? body.password.replace(/\s+/g, "") : body.password;
            await testImap(acc.imapHost!, acc.imapPort ?? 993, acc.loginUser || acc.address, pw);
            await testSmtpAt(acc.smtpHost, acc.smtpPort ?? 587, !!acc.smtpSecure, acc.loginUser || acc.address, pw);
            Object.assign(patch, { secret: sealSecret(pw, key), authFailed: false, authFailCount: 0, lastError: null, errorSince: null });
          } else {
            await testPop(acc.popHost, acc.address, body.password);
            const smtpHost = await testSmtp(acc.address, body.password, acc.smtpHost);
            Object.assign(patch, { secret: sealSecret(body.password, key), smtpHost, authFailed: false, authFailCount: 0, lastError: null, errorSince: null });
          }
        }
        await accountRef(db, key).update(patch);
        return NextResponse.json({ account: await view() });
      }

      case "disconnect": {
        ownerOnly(acc, me);
        // 암호문·ERP 메일함·예약·수신확인을 통째로 지운다. 카페24 의 메일은 그대로다.
        await deleteScheduledOf(db, key, userOf(acc));
        await deleteReceipts(db, key);
        await db.recursiveDelete(accountRef(db, key));
        return NextResponse.json({ ok: true });
      }

      case "sync": {
        const sync = await tag(db, key, await syncMailbox(db, key, { force: !!body.force }));
        // 보낼 때가 된 예약 — 누구의 확인이든 대신 보낸다 (compose.ts)
        await dispatchDue(db).catch((e) => console.error("[mail] 예약 발송", e instanceof Error ? e.message : e));
        return NextResponse.json({ syncs: { [key]: sync } });
      }

      case "older":
        return withCounts({ sync: await tag(db, key, await importOlder(db, key, undefined, body.box === "sent" ? "sent" : "inbox")) });

      // ---- 메일 여러 통 ----------------------------------------
      case "read":
      case "star":
      case "move":
      case "spam":
      case "purge": {
        if (!isMailBox(body.box)) return bad("메일함을 확인해 주세요.");
        if (body.action === "read") await setRead(db, key, body.box, ids, body.read !== false);
        if (body.action === "star") await setStar(db, key, body.box, ids, body.starred !== false);
        if (body.action === "move") {
          if (!isMailBox(body.to)) return bad("옮길 메일함을 확인해 주세요.");
          await moveMails(db, key, body.box, ids, body.to);
        }
        if (body.action === "spam") await markSpam(db, key, body.box, ids);
        if (body.action === "purge") await purgeMails(db, key, body.box, ids);
        return withCounts();
      }
      case "trash":
        if (!isMailBox(body.box)) return bad("메일함을 확인해 주세요.");
        await moveMails(db, key, body.box, ids, "trash");
        return withCounts();
      case "restore":
        await restoreMails(db, key, ids);
        return withCounts();
      case "notSpam":
        await markNotSpam(db, key, ids);
        return withCounts({ account: await view() });
      case "unblock":
        await unblockSender(db, key, String(body.address ?? ""));
        return NextResponse.json({ account: await view() });
      case "empty":
        if (body.box !== "trash" && body.box !== "spam") return bad("휴지통·스팸메일함만 비울 수 있습니다.");
        await emptyBox(db, key, body.box);
        return withCounts();

      // ---- 내 메일함 --------------------------------------------
      case "folderCreate":
        await createFolder(db, key, body.name);
        return NextResponse.json({ account: await view() });
      case "folderRename":
        if (!isDocId(body.id)) return bad("메일함을 지정해 주세요.");
        await renameFolder(db, key, body.id, body.name);
        return NextResponse.json({ account: await view() });
      case "folderShare":
        if (!isDocId(body.id)) return bad("메일함을 지정해 주세요.");
        await shareFolder(db, key, body.id, body.shared !== false);
        return NextResponse.json({ account: await view() });
      case "folderDelete":
        if (!isDocId(body.id)) return bad("메일함을 지정해 주세요.");
        await deleteFolder(db, key, body.id);
        return withCounts({ account: await view() });

      // ---- 외부 메일 설정 ---------------------------------------
      case "externalAdd": {
        const added = await addExternal(db, key, body);
        return withCounts({ account: await view(), added });
      }
      case "externalPassword":
        if (!isDocId(body.id)) return bad("외부 메일을 지정해 주세요.");
        await updateExternalPassword(db, key, body.id, String(body.password ?? ""));
        return NextResponse.json({ account: await view() });
      case "externalRemove":
        if (!isDocId(body.id)) return bad("외부 메일을 지정해 주세요.");
        await removeExternal(db, key, body.id);
        return NextResponse.json({ account: await view() });

      // ---- 주소록 ----------------------------------------------
      case "contactAdd":
        await addContact(db, key, { name: body.name, address: String(body.address ?? "") });
        return NextResponse.json({ contacts: await readContacts(db, key) });
      case "contactRemove":
        await removeContact(db, key, String(body.address ?? ""));
        return NextResponse.json({ contacts: await readContacts(db, key) });

      // ---- 임시보관함 · 예약 -------------------------------------
      case "draftSave": {
        if (!body.compose) return bad("저장할 내용이 없습니다.");
        const draft = await saveDraft(db, key, isDocId(body.draftId) ? body.draftId : undefined, body.compose, me);
        return withCounts({ draft });
      }
      case "draftDelete":
        for (const id of ids) if (isDocId(id)) await deleteDraft(db, key, id);
        return withCounts();
      case "scheduleCancel": {
        if (!isDocId(body.id)) return bad("예약 메일을 지정해 주세요.");
        const draft = await cancelScheduled(db, key, body.id);
        return withCounts({ draft });
      }
      case "scheduleNow":
        if (!isDocId(body.id)) return bad("예약 메일을 지정해 주세요.");
        await sendScheduledNow(db, key, body.id);
        await dispatchDue(db);
        return withCounts();

      default:
        return bad("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return failure(e);
  }
}
