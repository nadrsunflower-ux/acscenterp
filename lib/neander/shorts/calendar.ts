// ============================================================
//  AI STUDIO 일정 — 손으로 적는 일정 + 자료에서 저절로 모이는 일정 (순수 함수)
// ------------------------------------------------------------
//  손으로: 촬영 · 미팅 · 마감·납품 · 기타 (neander_shorts_events · 프로젝트마다 — 대행은 관리자 · 담당자만)
//  저절로: 게시 예약 · 게시됨 · 고객 검토 보냄 · 승인 · 수정 요청 (영상 · 게시 기록)
//          업체 계약 시작 · 끝 (계약 월) · 재무 회차 받을 날 · 받은 날 · 계약서 체결일 (재무 권한이 있을 때)
//  날짜는 모두 한국 날짜 `YYYY-MM-DD`.
// ============================================================

import type { ClientFinanceSummary } from "./agency";
import type { ClientDoc, ProjectDoc, PublicationDoc } from "./types";
import { TERM_LABEL, commitmentEndMonth } from "./plans";

export const EVENT_KINDS = ["shoot", "meeting", "deadline", "etc"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABEL: Record<EventKind, string> = { shoot: "촬영", meeting: "미팅", deadline: "마감 · 납품", etc: "기타" };

export interface ShortsEventDoc {
  title: string;
  date: string;
  /** 여러 날이면 마지막 날 */
  endDate: string | null;
  /** 시각 `HH:MM` (종일이면 null) */
  time: string | null;
  kind: EventKind;
  /** 어느 AI STUDIO 프로젝트의 일정인가 (보는 사람은 그 프로젝트 권한을 따른다) */
  spaceId: string;
  /** 대행 프로젝트면 그 업체 (서버가 프로젝트에서 찍는다) */
  clientId: string | null;
  note: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}
export type ShortsEventView = ShortsEventDoc & { id: string };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 손으로 적는 일정 다듬기 — 제목 · 날짜 필수, 끝 날은 시작 이후, 90일까지 */
export function sanitizeEvent(input: unknown, prev: ShortsEventDoc | null, email: string, spaceId: string, clientId: string | null, now = Date.now()): ShortsEventDoc {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const title = str(r.title, 100) || prev?.title || "";
  if (!title) throw new Error("일정 제목을 적어 주세요.");
  const date = isDate(r.date) ? r.date : prev?.date;
  if (!date) throw new Error("날짜를 골라 주세요.");
  let endDate = isDate(r.endDate) && r.endDate > date ? r.endDate : null;
  if (endDate && (Date.parse(endDate) - Date.parse(date)) / 86_400_000 > 90) endDate = null;
  const time = typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : null;
  return {
    title,
    date,
    endDate,
    time,
    kind: EVENT_KINDS.includes(r.kind as EventKind) ? (r.kind as EventKind) : (prev?.kind ?? "etc"),
    spaceId,
    clientId,
    note: r.note === undefined ? (prev?.note ?? "") : str(r.note, 1000),
    createdBy: prev?.createdBy ?? email,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: email,
  };
}

// ---- 한 줄로 모으기 ----------------------------------------------------------

export type CalSource = "manual" | "publish" | "published" | "review" | "approved" | "revision" | "contract" | "finance-due" | "finance-overdue" | "finance-paid" | "finance-contract" | "team";
export const CAL_SOURCE_LABEL: Record<CalSource, string> = {
  manual: "직접 적은 일정",
  publish: "게시 예약",
  published: "게시됨",
  review: "고객 검토 보냄",
  approved: "고객 승인",
  revision: "수정 요청",
  contract: "업체 계약",
  "finance-due": "받을 돈",
  "finance-overdue": "받을 돈 (연체)",
  "finance-paid": "받은 돈",
  "finance-contract": "계약서 체결",
  team: "팀 일정",
};

export interface CalItem {
  key: string;
  date: string;
  endDate?: string | null;
  time?: string | null;
  title: string;
  /** 달력 칸에 쓰는 짧은 글 — 무슨 일인지가 앞에 (「계약 시작 · 업체」) */
  chip: string;
  /** 한 줄 더 (어느 영상 · 업체 · 금액) */
  detail: string;
  source: CalSource;
  spaceId?: string;
  clientId?: string | null;
  /** 누르면 갈 곳 */
  href?: string;
  /** 손으로 적은 일정이면 그 문서 */
  event?: ShortsEventView;
}

/** ms → 한국 날짜 */
export const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const monthLast = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`;
};
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
/** YYYY-MM-DD 에서 n 일 */
const shiftDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Proj = Pick<ProjectDoc, "title" | "kind" | "clientId" | "clientName" | "review" | "spaceId"> & { id: string };

/** 자료에서 저절로 모이는 일정 */
export function autoItems(x: {
  projects: Proj[];
  publications: (Pick<PublicationDoc, "projectId" | "platform" | "status" | "scheduledAt" | "result"> & { id: string })[];
  clients: (Pick<ClientDoc, "name" | "contract"> & { id: string })[];
  clientFinance: Record<string, ClientFinanceSummary[]>;
  today: string;
}): CalItem[] {
  const out: CalItem[] = [];
  const byId = new Map(x.projects.map((p) => [p.id, p]));
  const platform = (p: string) => (p === "youtube" ? "YouTube" : "Instagram");
  for (const pub of x.publications) {
    const p = byId.get(pub.projectId);
    if (!p) continue;
    const href = `/neander/shorts/projects/${p.id}?tab=publish`;
    if (pub.status === "scheduled" && pub.scheduledAt) out.push({ key: `pub-${pub.id}`, date: kstDate(pub.scheduledAt), time: new Date(pub.scheduledAt + 9 * 3600_000).toISOString().slice(11, 16), title: p.title || "영상", chip: `게시 예약 · ${p.title || "영상"}`, detail: `${platform(pub.platform)} 게시 예약`, source: "publish", spaceId: p.spaceId, clientId: p.clientId, href });
    if (pub.status === "published" && pub.result?.at) out.push({ key: `pubd-${pub.id}`, date: kstDate(pub.result.at), title: p.title || "영상", chip: `게시 · ${p.title || "영상"}`, detail: `${platform(pub.platform)} 게시됨`, source: "published", spaceId: p.spaceId, clientId: p.clientId, href });
  }
  for (const p of x.projects) {
    if (p.kind !== "brand") continue;
    const href = `/neander/shorts/projects/${p.id}?tab=client`;
    for (const r of p.review?.rounds ?? []) {
      out.push({ key: `rv-${p.id}-${r.n}`, date: kstDate(r.sentAt), title: p.title || "영상", chip: `검토 보냄 · ${p.title || "영상"}`, detail: `${p.clientName || "고객사"} 검토 ${r.n}차 보냄`, source: "review", spaceId: p.spaceId, clientId: p.clientId, href });
      if (r.decidedAt && (r.decision === "approved" || r.decision === "revision"))
        out.push({ key: `rd-${p.id}-${r.n}`, date: kstDate(r.decidedAt), title: p.title || "영상", chip: `${r.decision === "approved" ? "승인" : "수정 요청"} · ${p.title || "영상"}`, detail: `${p.clientName || "고객사"} ${r.decision === "approved" ? "승인" : "수정 요청"}${r.feedback ? ` — ${r.feedback.slice(0, 40)}` : ""}`, source: r.decision === "approved" ? "approved" : "revision", spaceId: p.spaceId, clientId: p.clientId, href });
    }
  }
  for (const c of x.clients) {
    const href = `/neander/shorts/clients/${c.id}`;
    if (c.contract.startMonth) out.push({ key: `cs-${c.id}`, date: `${c.contract.startMonth}-01`, title: c.name, chip: `계약 시작 · ${c.name}`, detail: `계약 시작 · 월 ${c.contract.videosPerMonth}편`, source: "contract", clientId: c.id, href });
    if (c.contract.endMonth) out.push({ key: `ce-${c.id}`, date: monthLast(c.contract.endMonth), title: c.name, chip: `계약 끝 · ${c.name}`, detail: "계약 끝 (갱신 확인)", source: "contract", clientId: c.id, href });
    // 약정 끝 — 구독 계약서 제3조 ③: 스튜디오는 30일 전까지 알리고, 고객사는 14일 전까지 알리면 약정 끝에 해지. 그대로면 같은 금액 월 단위
    const commit = commitmentEndMonth(c.contract.startMonth, c.contract.term);
    if (commit) {
      const end = monthLast(commit);
      const term = TERM_LABEL[c.contract.term ?? "monthly"];
      out.push({ key: `cn-${c.id}`, date: shiftDays(end, -30), title: c.name, chip: `약정 끝 알림 · ${c.name}`, detail: `${term} ${end} 끝 — 오늘까지 고객사에 알립니다 (고객사 해지 통보는 14일 전까지 · 그대로면 같은 금액 월 단위)`, source: "contract", clientId: c.id, href });
      out.push({ key: `cm-${c.id}`, date: end, title: c.name, chip: `약정 끝 · ${c.name}`, detail: `${term} 끝 — 다음 달부터 월 단위 (다시 약정하려면 고객사 서면 동의)`, source: "contract", clientId: c.id, href });
    }
    for (const f of x.clientFinance[c.id] ?? []) {
      if (!f.projectId) continue;
      const fhref = `/neander/finance/projects/${f.projectId}`;
      for (const i of f.installments ?? []) {
        if (i.received && i.paidDate) out.push({ key: `fp-${f.code}-${i.id}`, date: i.paidDate, title: c.name, chip: `${i.kind} 받음 · ${c.name}`, detail: `${i.kind} 받음 ${won(i.amount)} · ${f.code}`, source: "finance-paid", clientId: c.id, href: fhref });
        else if (!i.received && i.dueDate) out.push({ key: `fd-${f.code}-${i.id}`, date: i.dueDate, title: c.name, chip: `${i.kind} 받을 날 · ${c.name}`, detail: `${i.kind} 받을 날 ${won(i.amount)}${i.dueLabel && i.dueLabel !== i.dueDate ? ` (${i.dueLabel})` : ""} · ${f.code}`, source: i.dueDate < x.today ? "finance-overdue" : "finance-due", clientId: c.id, href: fhref });
      }
      for (const k of f.contracts) if (k.signedDate) out.push({ key: `fc-${k.id}`, date: k.signedDate, title: c.name, chip: `계약서 체결 · ${c.name}`, detail: `계약서 체결 — ${k.title || f.name}`, source: "finance-contract", clientId: c.id, href: fhref });
    }
  }
  return out;
}

/** 손으로 적은 일정 → 한 줄 */
export const eventItem = (e: ShortsEventView): CalItem => ({
  key: `ev-${e.id}`,
  date: e.date,
  endDate: e.endDate,
  time: e.time,
  title: e.title,
  chip: e.title,
  detail: `${EVENT_KIND_LABEL[e.kind]}${e.note ? ` · ${e.note.slice(0, 60)}` : ""}`,
  source: "manual",
  spaceId: e.spaceId,
  clientId: e.clientId,
  event: e,
});

/** 그 달 날짜마다 — 여러 날 일정은 걸친 날마다 넣는다. 날마다 시각 순(종일 먼저) */
export function itemsByDate(items: CalItem[], fromDate: string, toDate: string): Map<string, CalItem[]> {
  const out = new Map<string, CalItem[]>();
  const add = (d: string, it: CalItem) => out.set(d, [...(out.get(d) ?? []), it]);
  for (const it of items) {
    const end = it.endDate && it.endDate > it.date ? it.endDate : it.date;
    if (end < fromDate || it.date > toDate) continue;
    let d = it.date < fromDate ? fromDate : it.date;
    let guard = 0;
    while (d <= end && d <= toDate && guard++ < 100) {
      add(d, it);
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.source.localeCompare(b.source)));
  return out;
}
