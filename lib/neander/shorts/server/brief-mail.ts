import "server-only";

// ============================================================
//  아침 브리핑 — 대시보드 카드 · 「메일로 받기」 (보내기 · 설정 · 미리 보기)
// ------------------------------------------------------------
//  · 대시보드 카드: 이 사람이 볼 수 있는 프로젝트마다(listSpacesFor — 대행은 관리자 · 그 업체 담당자만) 오늘 브리핑.
//  · 메일: 켠 사람이 ERP 메일에 연결한 **자기 계정으로 자기에게** 보내는 내게쓰기 (send.ts sendComposed · self).
//    회사 명의로 보내지 않는다 — ERP 알림은 사람 명의로만 (bridge/notify.ts). 팀 공용 계정으로는 보내지 않는다
//    (공용 받은편지함에 개인 브리핑이 쌓이지 않게).
//  · 자동: cron-market 이 모든 프로젝트 브리핑을 만든 뒤 sendBriefMails — 사람마다 따로(한 사람 실패가 다른 사람을
//    막지 않게) · 같은 날 두 번 안 보낸다 · 3번 이어 실패하면 저절로 끈다 (brief-mail.ts applyBriefMailOutcome).
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { sendComposed } from "@/lib/neander/mail/server/send";
import { listUserAccounts, userOf, type MailAccountDoc } from "@/lib/neander/mail/server/store";
import {
  BRIEF_MAIL_ITEMS,
  BRIEF_MAIL_TEST_PER_DAY,
  applyBriefMailOutcome,
  briefMailDue,
  buildBriefMail,
  sanitizeBriefMailPref,
  type BriefMailPref,
  type BriefMailSection,
} from "../brief-mail";
import type { MarketBriefItem } from "../market";
import { spaceKind, type SpaceView } from "../spaces";
import { envShortsAdmins, isShortsAdmin, loadShortsAccess, shortsAllowlist } from "./access";
import { getBrief, getMarketSettings } from "./market";
import { getBriefMailPref, listBriefMailSubscribers, updateBriefMailPref } from "./profiles";
import { kstDay } from "./radar-run";
import { listSpacesFor, rootDb, spaceDb } from "./space-db";
import { readQuota, takeQuota } from "./store";

const DAY = 86_400_000;

// ---- 대시보드 카드 ---------------------------------------------------------------

export interface BriefDigest {
  spaceId: string;
  spaceName: string;
  kind: "own" | "agency";
  /** ready · none(오늘 아직 없음) · off(설정에서 꺼짐) */
  status: BriefMailSection["status"];
  day: string;
  brief: { headline: string; at: number; by: string; items: Pick<MarketBriefItem, "kind" | "title" | "numbers">[]; total: number } | null;
  /** 오늘 것이 없을 때 — 어제 브리핑 헤드라인 (있으면) */
  yesterday: { day: string; headline: string } | null;
}

async function sectionOf(db: Firestore, s: SpaceView, day: string): Promise<{ status: BriefMailSection["status"]; brief: Awaited<ReturnType<typeof getBrief>> }> {
  const sdb = spaceDb(db, s.id);
  const [settings, brief] = await Promise.all([getMarketSettings(sdb), getBrief(sdb, day)]);
  // 꺼져 있어도 사람이 그날 직접 만든 브리핑은 보인다
  return { status: brief ? "ready" : settings.enabled ? "none" : "off", brief };
}

/** 볼 수 있는 프로젝트마다 오늘 브리핑 (특기 사항은 앞 3개만) */
export async function listBriefDigests(db: Firestore, email: string, now = Date.now()): Promise<{ today: string; digests: BriefDigest[] }> {
  const root = rootDb(db);
  const today = kstDay(now);
  const spaces = await listSpacesFor(root, email, isShortsAdmin(email));
  const digests = await Promise.all(
    spaces.map(async (s): Promise<BriefDigest> => {
      const { status, brief } = await sectionOf(root, s, today);
      const y = brief ? null : await getBrief(spaceDb(root, s.id), kstDay(now - DAY));
      return {
        spaceId: s.id,
        spaceName: s.name,
        kind: spaceKind(s),
        status,
        day: today,
        brief: brief ? { headline: brief.headline, at: brief.at, by: brief.by, items: brief.items.slice(0, BRIEF_MAIL_ITEMS).map((x) => ({ kind: x.kind, title: x.title, numbers: x.numbers })), total: brief.items.length } : null,
        yesterday: y ? { day: y.day, headline: y.headline } : null,
      };
    }),
  );
  return { today, digests };
}

// ---- 메일 계정 · 설정 --------------------------------------------------------------

export interface BriefMailAccount {
  key: string;
  address: string;
  label: string | null;
  provider: string;
  authFailed: boolean;
}

/** 이 사람이 직접 연결한 메일 계정 (팀 공용은 뺀다) */
async function ownAccounts(db: Firestore, email: string): Promise<MailAccountDoc[]> {
  return (await listUserAccounts(rootDb(db), email)).filter((a) => userOf(a) === email && !a.team);
}

const accountView = (a: MailAccountDoc): BriefMailAccount => ({ key: a.owner, address: a.address, label: a.label || null, provider: a.provider ?? "cafe24", authFailed: !!a.authFailed });

/** 보낼 계정 — 고른 것이 있으면 그것(내 계정이어야), 없으면 비밀번호가 맞는 첫 계정 */
function pickAccount(list: MailAccountDoc[], key: string | null): MailAccountDoc | null {
  if (key) return list.find((a) => a.owner === key) ?? null;
  return list.find((a) => !a.authFailed) ?? list[0] ?? null;
}

export interface BriefMailState {
  pref: BriefMailPref;
  accounts: BriefMailAccount[];
  /** 지금 쓰일 계정 (없으면 null — 켤 수 없다) */
  account: BriefMailAccount | null;
  /** 켤 수 없는 이유 */
  blocked: string | null;
  spaces: { id: string; name: string; kind: "own" | "agency" }[];
  test: { used: number; limit: number };
  today: string;
}

const blockReason = (acc: MailAccountDoc | null, list: MailAccountDoc[]): string | null =>
  !list.length
    ? "ERP 메일에 연결한 내 메일 계정이 없습니다 — 메일 화면에서 내 계정을 먼저 연결해 주세요 (팀 공용 계정으로는 보내지 않습니다)."
    : !acc
      ? "고른 메일 계정을 찾지 못했습니다 — 다른 계정을 골라 주세요."
      : acc.authFailed
        ? `「${acc.address}」 의 메일 비밀번호가 맞지 않아 멈춰 있습니다 — 메일 설정에서 비밀번호를 다시 넣어 주세요.`
        : null;

const testKey = (email: string, day: string) => `briefmailtest_${day}_${email}`.replace(/[^\w@.-]/g, "_");

export async function getBriefMailState(db: Firestore, email: string, now = Date.now()): Promise<BriefMailState> {
  const root = rootDb(db);
  const today = kstDay(now);
  const [pref, list, spaces, used] = await Promise.all([getBriefMailPref(root, email), ownAccounts(root, email), listSpacesFor(root, email, isShortsAdmin(email)), readQuota(root, testKey(email, today))]);
  const acc = pickAccount(list, pref.account);
  return {
    pref: { ...pref, sending: null },
    accounts: list.map(accountView),
    account: acc ? accountView(acc) : null,
    blocked: blockReason(acc, list),
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, kind: spaceKind(s) })),
    test: { used, limit: BRIEF_MAIL_TEST_PER_DAY },
    today,
  };
}

/** 저장 — 켜기 · 받을 프로젝트 · 보낼 계정. 계정이 없거나 비밀번호가 멈춘 계정이면 켤 수 없다 */
export async function saveBriefMailPref(db: Firestore, email: string, input: unknown): Promise<BriefMailState> {
  const root = rootDb(db);
  const list = await ownAccounts(root, email);
  await updateBriefMailPref(root, email, (prev) => {
    const next = sanitizeBriefMailPref(input, prev);
    if (next.account && !list.some((a) => a.owner === next.account)) throw new AccessError(403, "내가 연결한 메일 계정이 아닙니다.");
    if (next.enabled && !prev.enabled) {
      const why = blockReason(pickAccount(list, next.account), list);
      if (why) throw new Error(`켤 수 없습니다 — ${why}`);
    }
    if (next.enabled && !next.all && !next.spaces.length) throw new Error("받을 프로젝트를 하나 이상 골라 주세요.");
    return next;
  });
  return getBriefMailState(root, email);
}

// ---- 메일 짓기 -------------------------------------------------------------------

/** 이 사람이 받을 프로젝트의 그날 브리핑 — 볼 수 있는 프로젝트 중에서만 (권한이 바뀌었으면 빠진다) */
async function sectionsFor(db: Firestore, email: string, pref: Pick<BriefMailPref, "all" | "spaces">, day: string): Promise<BriefMailSection[]> {
  const root = rootDb(db);
  const spaces = (await listSpacesFor(root, email, isShortsAdmin(email))).filter((s) => pref.all || pref.spaces.includes(s.id));
  return Promise.all(
    spaces.map(async (s) => {
      const { status, brief } = await sectionOf(root, s, day);
      return { spaceId: s.id, spaceName: s.name, kind: spaceKind(s), status, brief };
    }),
  );
}

export interface BriefMailPreview {
  day: string;
  from: string | null;
  to: string | null;
  mail: { subject: string; html: string; text: string } | null;
  sections: { spaceId: string; spaceName: string; status: BriefMailSection["status"] }[];
  blocked: string | null;
}

/**
 * 미리 보기 — 보내지 않는다. draft 를 주면 아직 저장하지 않은 받을 프로젝트로 (화면에서 고르는 중).
 * 오늘 브리핑이 하나도 없으면 가장 최근 날(어제)로 모양을 보여 준다.
 */
export async function previewBriefMail(db: Firestore, email: string, origin: string, draft?: unknown, now = Date.now()): Promise<BriefMailPreview> {
  const root = rootDb(db);
  const saved = await getBriefMailPref(root, email);
  const pref = draft ? sanitizeBriefMailPref(draft, saved, now) : saved;
  const list = await ownAccounts(root, email);
  const acc = pickAccount(list, pref.account);
  let day = kstDay(now);
  let sections = await sectionsFor(root, email, pref, day);
  if (!sections.some((s) => s.status === "ready")) {
    const y = kstDay(now - DAY);
    const ys = await sectionsFor(root, email, pref, y);
    if (ys.some((s) => s.status === "ready")) {
      day = y;
      sections = ys;
    }
  }
  return {
    day,
    from: acc?.address ?? null,
    to: acc?.address ?? null,
    mail: buildBriefMail({ day, sections, origin, to: acc?.address ?? email }),
    sections: sections.map((s) => ({ spaceId: s.spaceId, spaceName: s.spaceName, status: s.status })),
    blocked: blockReason(acc, list),
  };
}

async function sendTo(db: Firestore, email: string, acc: MailAccountDoc, mail: { subject: string; html: string; text: string }) {
  await sendComposed(rootDb(db), acc.owner, { to: [], cc: [], bcc: [], subject: mail.subject, html: mail.html, text: mail.text, mode: "html", blobs: [], self: true }, undefined, email);
}

/** 「지금 나에게 보내 보기」 — 사람이 누를 때만 · 하루 한도 · 자동 발송 기록(같은 날 두 번 안 보내기)은 건드리지 않는다 */
export async function sendBriefMailTest(db: Firestore, email: string, origin: string, now = Date.now()): Promise<{ to: string; subject: string; day: string; test: { used: number; limit: number } }> {
  const root = rootDb(db);
  const p = await previewBriefMail(root, email, origin, undefined, now);
  if (p.blocked) throw new Error(p.blocked);
  if (!p.mail) throw new Error("보낼 브리핑이 없습니다 — 받을 프로젝트에 오늘 · 어제 브리핑이 하나도 없습니다.");
  const acc = pickAccount(await ownAccounts(root, email), (await getBriefMailPref(root, email)).account);
  if (!acc) throw new Error("보낼 메일 계정을 찾지 못했습니다.");
  const q = await takeQuota(root, testKey(email, kstDay(now)), BRIEF_MAIL_TEST_PER_DAY);
  if (!q.ok) throw new Error(`「지금 나에게 보내 보기」 는 하루 ${BRIEF_MAIL_TEST_PER_DAY}번까지입니다 — 내일 다시 해 주세요.`);
  await sendTo(root, email, acc, p.mail);
  return { to: acc.address, subject: p.mail.subject, day: p.day, test: { used: q.used, limit: BRIEF_MAIL_TEST_PER_DAY } };
}

// ---- 자동 (cron-market) -------------------------------------------------------------

/** 아직 AI STUDIO 를 쓸 수 있는 사람인가 — 목록에서 빠진 사람에게는 보내지 않는다 (requireShortsUser 와 같은 기준) */
async function stillAllowed(email: string): Promise<boolean> {
  const access = await loadShortsAccess();
  const allow = shortsAllowlist();
  return allow.length === 0 || allow.includes(email) || access.users.includes(email) || access.admins.includes(email) || envShortsAdmins().includes(email);
}

export interface BriefMailRunSummary {
  day: string;
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  turnedOff: number;
  notes: string[];
}

/**
 * 켠 사람마다 그날 브리핑 한 통. deadline 안에서만 — 남은 사람은 「시간이 모자라」 로 적고 넘긴다(실패로 세지 않는다).
 * 사람마다 잡아 두고(sending) 보내서 두 실행이 겹쳐도 같은 날 두 번 가지 않는다.
 */
export async function sendBriefMails(db: Firestore, o: { deadline: number; origin: string; now?: number }): Promise<BriefMailRunSummary> {
  const root = rootDb(db);
  const now = o.now ?? Date.now();
  const day = kstDay(now);
  await loadShortsAccess(true).catch(() => undefined);
  const subs = (await listBriefMailSubscribers(root)).filter((x) => briefMailDue(x.pref, day, now));
  const out: BriefMailRunSummary = { day, due: subs.length, sent: 0, skipped: 0, failed: 0, turnedOff: 0, notes: [] };
  for (const { email } of subs) {
    if (Date.now() > o.deadline - 8_000) {
      out.skipped++;
      await updateBriefMailPref(root, email, (p) => (briefMailDue(p, day) ? applyBriefMailOutcome(p, { kind: "skipped", day, at: Date.now(), note: "시간이 모자라 오늘 메일을 보내지 못했습니다 (실패로 세지 않음)" }) : null)).catch(() => undefined);
      continue;
    }
    // 잡기 — 다른 실행이 이미 보냈거나 보내는 중이면 건너뛴다
    let claimed = false;
    const pref = await updateBriefMailPref(root, email, (p) => {
      if (!briefMailDue(p, day)) return null;
      claimed = true;
      return { ...p, sending: { day, until: Date.now() + 3 * 60_000 } };
    }).catch(() => null);
    if (!claimed || !pref) continue;
    let outcome: Parameters<typeof applyBriefMailOutcome>[1];
    try {
      if (!(await stillAllowed(email))) {
        outcome = { kind: "skipped", day, at: Date.now(), note: "AI STUDIO 사용자 목록에 없어 보내지 않았습니다" };
      } else {
        const list = await ownAccounts(root, email);
        const acc = pickAccount(list, pref.account);
        const why = blockReason(acc, list);
        if (why) throw new Error(why);
        const mail = buildBriefMail({ day, sections: await sectionsFor(root, email, pref, day), origin: o.origin, to: acc!.address });
        if (!mail) outcome = { kind: "skipped", day, at: Date.now(), note: "받을 프로젝트에 오늘 브리핑이 없어 보내지 않았습니다" };
        else {
          await sendTo(root, email, acc!, mail);
          outcome = { kind: "sent", day, at: Date.now() };
        }
      }
    } catch (e) {
      outcome = { kind: "failed", day, at: Date.now(), error: e instanceof Error ? e.message : String(e) };
    }
    const after = await updateBriefMailPref(root, email, (p) => applyBriefMailOutcome(p, outcome)).catch(() => null);
    if (outcome.kind === "sent") out.sent++;
    else if (outcome.kind === "skipped") out.skipped++;
    else {
      out.failed++;
      if (after && !after.enabled) out.turnedOff++;
      out.notes.push(`${email.split("@")[0]}: ${outcome.error.slice(0, 80)}`);
    }
  }
  return out;
}
