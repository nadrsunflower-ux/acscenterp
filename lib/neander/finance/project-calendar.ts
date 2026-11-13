// ============================================================
//  프로젝트 달력 — 진행 기간 막대 · 납기 깃발을 주(週) 줄에 앉힌다
// ------------------------------------------------------------
//  프로젝트 목록 맨 위 달력(ProjectCalendar)이 쓴다. 화면과 떨어진 계산만
//  여기 둔다 — 시험할 수 있게(project-calendar.test.ts).
//
//  한 프로젝트에서 나오는 것
//    · 진행 기간(startDate ~ endDate) — 날짜를 가로지르는 막대 하나
//    · 시작일만 있으면 「시작」 한 칸, 종료일만 있으면 「종료」 한 칸
//      (월 대행처럼 끝이 안 정해진 건 · 문의 받은 날만 적힌 심사 중 건)
//    · 납기(deliveryDate) — 기간 안이면 그 막대 위 깃발, 밖이면 「납기」 한 칸
//      (설치를 전날 하는 행사는 납기가 기간 앞에 온다)
//  날짜가 하나도 없는 프로젝트는 달력에 못 앉으니 따로 센다(undated).
//
//  주 줄 배치는 구글 달력과 같다. 주마다 따로 줄(lane)을 나눠, 겹치는
//  막대는 아래 줄로 내린다. 주를 넘는 막대는 그 주에서 잘리고 잘린 쪽
//  모서리를 각지게 그린다(contLeft · contRight).
// ============================================================

import { addDays } from "@/lib/neander/format";
import type { ProjectEquipment } from "./equipment";

export interface CalProject {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate?: string;
  endDate?: string;
  deliveryDate?: string;
  /** 장비 배정 — 달력이 날마다 더해 보유 대수와 견준다 (equipment.ts) */
  equipment?: ProjectEquipment;
}

export type CalItemKind = "period" | "start" | "end" | "delivery";

export interface CalItem {
  key: string;
  project: CalProject;
  kind: CalItemKind;
  /** 첫날 · 끝날 `YYYY-MM-DD` (한 칸짜리는 같다) */
  from: string;
  to: string;
  /** 이 막대 위에 깃발로 꽂을 납기 (기간 안일 때만) */
  delivery?: string;
}

export interface CalSegment {
  item: CalItem;
  /** 0(일) ~ 6(토) */
  startCol: number;
  endCol: number;
  lane: number;
  /** 지난주에서 이어져 온다 / 다음 주로 이어진다 */
  contLeft: boolean;
  contRight: boolean;
  /** 이 주 안에 납기 깃발이 있으면 그 칸 */
  deliveryCol?: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (v: unknown): string | undefined => (typeof v === "string" && YMD.test(v) ? v : undefined);

/** 0 = 일요일 */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** 프로젝트 → 달력에 앉힐 것들. 날짜가 없는 건은 undated 로 */
export function projectCalItems(projects: CalProject[]): { items: CalItem[]; undated: CalProject[] } {
  const items: CalItem[] = [];
  const undated: CalProject[] = [];
  for (const p of projects) {
    const s = ymd(p.startDate);
    const e = ymd(p.endDate);
    const d = ymd(p.deliveryDate);
    if (!s && !e && !d) {
      undated.push(p);
      continue;
    }
    let base: CalItem | null = null;
    if (s && e) {
      const [from, to] = s <= e ? [s, e] : [e, s];
      base = { key: `${p.id}:period`, project: p, kind: "period", from, to };
    } else if (s) {
      base = { key: `${p.id}:start`, project: p, kind: "start", from: s, to: s };
    } else if (e) {
      base = { key: `${p.id}:end`, project: p, kind: "end", from: e, to: e };
    }
    if (base && d && d >= base.from && d <= base.to) base.delivery = d;
    if (base) items.push(base);
    if (d && !base?.delivery) items.push({ key: `${p.id}:delivery`, project: p, kind: "delivery", from: d, to: d });
  }
  return { items, undated };
}

/** 그 달을 덮는 주들 — 일요일부터 토요일까지, 앞뒤 달 날짜도 채운다 */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  if (!YMD.test(first)) return [];
  let day = addDays(first, -weekdayOf(first));
  const weeks: string[][] = [];
  while (weeks.length < 6) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(day, i));
    weeks.push(week);
    day = addDays(day, 7);
    if (day.slice(0, 7) !== month) break;
  }
  return weeks;
}

/** 이 기간과 겹치는 것만 */
export const itemsBetween = (items: CalItem[], from: string, to: string): CalItem[] =>
  items.filter((it) => it.from <= to && it.to >= from);

const KIND_ORDER: Record<CalItemKind, number> = { period: 0, start: 1, end: 1, delivery: 2 };

/** 한 주에 막대를 앉힌다. 긴 것 · 먼저 시작하는 것이 위 줄 */
export function layoutWeek(week: string[], items: CalItem[]): { segments: CalSegment[]; lanes: number } {
  const first = week[0];
  const last = week[week.length - 1];
  const col = (date: string) => week.indexOf(date);
  const raw = itemsBetween(items, first, last).map((item) => {
    const startCol = item.from < first ? 0 : col(item.from);
    const endCol = item.to > last ? week.length - 1 : col(item.to);
    const deliveryCol = item.delivery && item.delivery >= first && item.delivery <= last ? col(item.delivery) : undefined;
    return { item, startCol, endCol, contLeft: item.from < first, contRight: item.to > last, deliveryCol };
  });
  raw.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
      a.item.project.name.localeCompare(b.item.project.name, "ko"),
  );
  const laneEnds: number[] = [];
  const segments: CalSegment[] = raw.map((r) => {
    let lane = laneEnds.findIndex((end) => end < r.startCol);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(r.endCol);
    } else laneEnds[lane] = r.endCol;
    return { ...r, lane };
  });
  return { segments, lanes: laneEnds.length };
}

/** 막대에 적을 짧은 이름 — 앞의 연도(「2026 」)는 달력에선 군더더기 */
export const calName = (name: string): string => name.replace(/^20\d{2}\s+/, "").trim() || name;
