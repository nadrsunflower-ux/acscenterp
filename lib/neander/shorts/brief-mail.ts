// ============================================================
//  아침 브리핑 「메일로 받기」 — 사람별 설정 · 메일 본문 (순수 함수 · 브라우저 · 서버 공용)
// ------------------------------------------------------------
//  ERP 알림은 늘 사람 명의로만 보낸다(lib/neander/bridge/notify.ts). 그래서 회사 발송 주소를 따로 두지 않고,
//  **켠 사람이 ERP 메일에 연결한 자기 계정으로 자기에게 보내는 「내게쓰기」** 로 보낸다
//  (lib/neander/mail/server/send.ts sendComposed · self). 메일 계정이 없으면 켤 수 없다.
//  · 기본 꺼짐. 매일 07:30 cron-market 이 모든 프로젝트 브리핑을 만든 뒤 켠 사람마다 한 통 — 같은 날 두 번 안 보낸다.
//  · 3번 이어 보내지 못하면 저절로 끄고 이유를 남긴다 (비밀번호가 바뀐 계정으로 매일 실패하지 않게).
//  · 본문의 글은 모두 이스케이프한다 — 브리핑 글은 AI 가 쓴 것이라 HTML 로 믿지 않는다.
//  설정 저장 · 보내기는 server/brief-mail.ts.
// ============================================================

import { BRIEF_KIND_LABEL, type MarketBriefDoc } from "./market";

export interface BriefMailPref {
  enabled: boolean;
  /** 볼 수 있는 모든 프로젝트 (새로 생긴 것도) — false 면 spaces 만 */
  all: boolean;
  spaces: string[];
  /** 보낼 메일 계정 키 (내가 연결한 계정) — null 이면 첫 계정 */
  account: string | null;
  lastSentDay: string | null;
  lastSentAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  /** 이어서 실패한 횟수 — 보내면 0 */
  failures: number;
  /** 저절로 끈 이유 — 다시 켜면 지운다 */
  autoOff: string | null;
  /** 마지막 자동 실행의 메모 (보낼 브리핑이 없어 건너뜀 등 — 실패는 아니다) */
  lastNote: string | null;
  lastNoteAt: number | null;
  /** 보내는 중 — 같은 날 두 번 보내지 않으려고 잠깐 잡아 둔다 */
  sending: { day: string; until: number } | null;
  updatedAt: number;
}

export const BRIEF_MAIL_MAX_FAILURES = 3;
/** 「지금 나에게 보내 보기」 하루 한도 (사람마다) */
export const BRIEF_MAIL_TEST_PER_DAY = 5;

export const DEFAULT_BRIEF_MAIL_PREF: BriefMailPref = {
  enabled: false,
  all: true,
  spaces: [],
  account: null,
  lastSentDay: null,
  lastSentAt: null,
  lastError: null,
  lastErrorAt: null,
  failures: 0,
  autoOff: null,
  lastNote: null,
  lastNoteAt: null,
  sending: null,
  updatedAt: 0,
};

const isSpaceIdLike = (v: unknown): v is string => typeof v === "string" && /^[\w-]{2,40}$/.test(v);

/** 저장된 값 펴기 — 예전 문서 · 빈 칸은 기본값 */
export const readBriefMailPref = (raw: unknown): BriefMailPref => ({ ...DEFAULT_BRIEF_MAIL_PREF, ...((raw && typeof raw === "object" ? raw : {}) as Partial<BriefMailPref>) });

/**
 * 사람이 고치는 칸만 (켜기 · 받을 프로젝트 · 보낼 계정). 다시 켜면 저절로 끈 이유 · 실패 횟수를 지운다.
 * 보낸 기록 · 오류는 서버만 쓴다.
 */
export function sanitizeBriefMailPref(raw: unknown, prev: BriefMailPref, now = Date.now()): BriefMailPref {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const enabled = typeof r.enabled === "boolean" ? r.enabled : prev.enabled;
  const turnedOn = enabled && !prev.enabled;
  return {
    ...prev,
    enabled,
    all: typeof r.all === "boolean" ? r.all : prev.all,
    spaces: Array.isArray(r.spaces) ? [...new Set(r.spaces.filter(isSpaceIdLike))].slice(0, 30) : prev.spaces,
    account: r.account === null ? null : typeof r.account === "string" && r.account.length <= 200 ? r.account : prev.account,
    failures: turnedOn ? 0 : prev.failures,
    autoOff: turnedOn ? null : prev.autoOff,
    updatedAt: now,
  };
}

export type BriefMailOutcome = { kind: "sent"; day: string; at: number } | { kind: "failed"; day: string; at: number; error: string } | { kind: "skipped"; day: string; at: number; note: string };

/** 자동 실행 한 번의 결과를 설정에 적는다 — 3번 이어 실패하면 끈다 */
export function applyBriefMailOutcome(prev: BriefMailPref, o: BriefMailOutcome): BriefMailPref {
  const base = { ...prev, sending: null };
  if (o.kind === "sent") return { ...base, lastSentDay: o.day, lastSentAt: o.at, failures: 0, lastError: null, lastNote: null, lastNoteAt: null };
  if (o.kind === "skipped") return { ...base, lastNote: o.note.slice(0, 200), lastNoteAt: o.at };
  const failures = prev.failures + 1;
  const off = failures >= BRIEF_MAIL_MAX_FAILURES;
  return {
    ...base,
    failures,
    lastError: o.error.slice(0, 300),
    lastErrorAt: o.at,
    enabled: off ? false : prev.enabled,
    autoOff: off ? `${BRIEF_MAIL_MAX_FAILURES}번 이어 보내지 못해 저절로 껐습니다 — 마지막 오류: ${o.error.slice(0, 160)}` : prev.autoOff,
  };
}

/** 오늘 보낼 차례인가 — 켰고 · 오늘 아직 안 보냈고 · 다른 실행이 보내는 중이 아니다 */
export function briefMailDue(p: BriefMailPref, day: string, now = Date.now()): boolean {
  if (!p.enabled || p.lastSentDay === day) return false;
  if (p.sending && p.sending.day === day && p.sending.until > now) return false;
  return true;
}

// ---- 본문 -------------------------------------------------------------------------

/** 메일 한 통의 프로젝트 한 칸 */
export interface BriefMailSection {
  spaceId: string;
  spaceName: string;
  kind: "own" | "agency";
  /** ready = 그날 브리핑 있음 · none = 아직 없음 · off = 시장 트렌드 자동 실행이 꺼져 있음 */
  status: "ready" | "none" | "off";
  brief: Pick<MarketBriefDoc, "headline" | "summary" | "items" | "at" | "by"> | null;
}

export const BRIEF_MAIL_ITEMS = 3;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 2026-11-04 → 11/4 (수) */
export const briefDayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} (${WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 그 프로젝트의 시장 트렌드로 — 화면이 ?space= 를 보고 프로젝트를 바꾼다 */
export const marketUrl = (origin: string, spaceId: string) => `${origin.replace(/\/$/, "")}/neander/shorts/market?space=${encodeURIComponent(spaceId)}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * 메일 한 통 — 볼 수 있는 프로젝트의 그날 브리핑(헤드라인 · 요약 · 특기 사항 3개 · 「ERP 에서 보기」).
 * 브리핑이 하나도 없으면 null (보내지 않는다).
 */
export function buildBriefMail(x: { day: string; sections: BriefMailSection[]; origin: string; to: string }): { subject: string; html: string; text: string } | null {
  const ready = x.sections.filter((s) => s.status === "ready" && s.brief);
  if (!ready.length) return null;
  const first = ready[0];
  const more = ready.length > 1 ? ` 외 ${ready.length - 1}곳` : "";
  const subject = clip(`[AI STUDIO] ${briefDayLabel(x.day)} 아침 브리핑 · ${first.spaceName}${more} — ${first.brief!.headline}`, 140);

  const S = {
    wrap: "margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2329;",
    card: "max-width:640px;margin:0 auto 16px;background:#ffffff;border:1px solid #e3e6ea;border-radius:12px;padding:20px 22px;",
    kicker: "margin:0 0 6px;font-size:14px;color:#5b6470;",
    h1: "margin:0 0 4px;font-size:22px;line-height:1.35;color:#1f2329;",
    h2: "margin:0 0 8px;font-size:19px;line-height:1.4;color:#1f2329;",
    p: "margin:0 0 10px;font-size:15px;line-height:1.6;color:#3a414b;",
    small: "margin:0;font-size:14px;line-height:1.6;color:#5b6470;",
    tag: "display:inline-block;margin-right:6px;padding:1px 8px;border-radius:999px;background:#eef2f7;font-size:13px;color:#3a414b;",
    item: "margin:0 0 10px;padding:10px 12px;border-left:3px solid #2a78d6;background:#f7f9fb;font-size:15px;line-height:1.55;color:#1f2329;",
    btn: "display:inline-block;margin-top:6px;padding:9px 16px;border-radius:8px;background:#2a78d6;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;",
  };
  const e = escapeHtml;
  const html: string[] = [`<div style="${S.wrap}">`, `<div style="${S.card}">`, `<p style="${S.kicker}">AI STUDIO · 시장 트렌드</p>`, `<h1 style="${S.h1}">${e(briefDayLabel(x.day))} 아침 브리핑</h1>`, `<p style="${S.small}">프로젝트 ${ready.length}곳 · 매일 07:30 자동 생성 · AI 해설은 자료 숫자로만 썼고, 사실 확인은 ERP 의 원본으로 합니다.</p>`, `</div>`];
  const text: string[] = [`AI STUDIO 아침 브리핑 · ${briefDayLabel(x.day)}`, `AI 해설은 자료 숫자로만 썼고, 사실 확인은 ERP 의 원본으로 합니다.`, ""];

  for (const s of ready) {
    const b = s.brief!;
    const url = marketUrl(x.origin, s.spaceId);
    html.push(`<div style="${S.card}">`, `<p style="${S.kicker}">${e(s.spaceName)}${s.kind === "agency" ? " · 대행" : ""}${b.by === "company" ? "" : " · 직접 만든 브리핑"}</p>`, `<h2 style="${S.h2}">${e(b.headline)}</h2>`);
    text.push(`■ ${s.spaceName}${s.kind === "agency" ? " (대행)" : ""}`, b.headline);
    for (const line of b.summary.slice(0, 3)) {
      html.push(`<p style="${S.p}">· ${e(line)}</p>`);
      text.push(`· ${line}`);
    }
    const items = b.items.slice(0, BRIEF_MAIL_ITEMS);
    if (items.length) {
      html.push(`<p style="${S.small};margin-bottom:8px;font-weight:600;color:#1f2329;">특기 사항 ${items.length}개 (AI)</p>`);
      text.push("", `특기 사항 ${items.length}개 (AI)`);
      for (const it of items) {
        html.push(`<div style="${S.item}"><span style="${S.tag}">${e(BRIEF_KIND_LABEL[it.kind] ?? it.kind)}</span><b>${e(it.title)}</b>${it.numbers ? `<br><span style="font-size:14px;color:#5b6470;">${e(it.numbers)}</span>` : ""}</div>`);
        text.push(`- [${BRIEF_KIND_LABEL[it.kind] ?? it.kind}] ${it.title}${it.numbers ? ` — ${it.numbers}` : ""}`);
      }
    }
    if (b.items.length > items.length) {
      html.push(`<p style="${S.small}">나머지 ${b.items.length - items.length}개는 ERP 에서 봅니다.</p>`);
      text.push(`(나머지 ${b.items.length - items.length}개는 ERP 에서)`);
    }
    html.push(`<a href="${e(url)}" style="${S.btn}">ERP 에서 보기</a>`, `</div>`);
    text.push(`ERP 에서 보기: ${url}`, "");
  }

  const rest = x.sections.filter((s) => !ready.includes(s));
  if (rest.length) {
    const lines = rest.map((s) => `${s.spaceName} — ${s.status === "off" ? "시장 트렌드 자동 실행이 꺼져 있음" : "오늘 브리핑 없음"}`);
    html.push(`<div style="${S.card}">`, `<p style="${S.small};font-weight:600;color:#1f2329;margin-bottom:6px;">브리핑이 없는 프로젝트</p>`, ...lines.map((l) => `<p style="${S.small}">${e(l)}</p>`), `</div>`);
    text.push("브리핑이 없는 프로젝트", ...lines, "");
  }
  const foot = `이 메일은 ERP 「메일로 받기」 를 켠 ${x.to} 님에게, 그 사람이 ERP 메일에 연결한 계정으로 보낸 내게쓰기입니다. 끄려면 AI STUDIO 대시보드 › 오늘 아침 브리핑 › 메일로 받기.`;
  html.push(`<p style="max-width:640px;margin:0 auto;${S.small}">${e(foot)}</p>`, `</div>`);
  text.push(foot);
  return { subject, html: html.join(""), text: text.join("\n") };
}
