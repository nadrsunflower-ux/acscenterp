// ============================================================
//  장비 배정 — 프로젝트마다 포토부스 · 키오스크 몇 대를 쓰는지, 날마다 겹치는지
// ------------------------------------------------------------
//  행사가 몰리는 달(2026-12 — 수원 · 교육AX · 농협 · 주거복지대전)에는 같은
//  날 장비가 보유 대수보다 많이 필요해진다. 프로젝트에 배정 대수를 적어 두면
//  달력(ProjectCalendar)과 상세 화면이 날마다 더해 보고, 넘치면 알린다.
//
//  · 쓰는 날 = 설치 첫날(납기)부터 행사 끝날까지 — 진행 시작일 · 종료일 · 납기 중
//    가장 이른 날 ~ 가장 늦은 날. 2026-11-13 규칙으로 납기가 설치 첫날이라
//    전날 설치하는 행사도 그날부터 잡힌다.
//  · 취소된 프로젝트는 세지 않는다. 심사 중은 센다 — 수주 전에 겹침을 봐야 한다.
//  · 보유 대수는 여기 상수(2026-11-13 사용자: 포토부스 3 · 키오스크 3).
//    장비를 사거나 팔면 EQUIPMENT_OWNED 를 고친다.
// ============================================================

import { addDays } from "@/lib/neander/format";

export const EQUIPMENT_KINDS = ["photobooth", "kiosk"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_LABEL: Record<EquipmentKind, string> = { photobooth: "포토부스", kiosk: "키오스크" };

/** 보유 대수 — 2026-11-13 사용자 「포토부스 3대, 키오스크 3대」 */
export const EQUIPMENT_OWNED: Record<EquipmentKind, number> = { photobooth: 3, kiosk: 3 };

/** 한 프로젝트에 적을 수 있는 최대 — 오타(30 → 3)를 막는 정도 */
export const EQUIPMENT_MAX = 20;

/** 프로젝트에 배정한 대수. 0 인 종류는 두지 않는다 */
export type ProjectEquipment = Partial<Record<EquipmentKind, number>>;

export function sanitizeEquipment(raw: unknown): ProjectEquipment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: ProjectEquipment = {};
  for (const k of EQUIPMENT_KINDS) {
    const n = Math.round(Number((raw as Record<string, unknown>)[k]));
    if (Number.isFinite(n) && n > 0) out[k] = Math.min(EQUIPMENT_MAX, n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const hasEquipment = (e: ProjectEquipment | undefined): boolean => EQUIPMENT_KINDS.some((k) => (e?.[k] ?? 0) > 0);

/** 「포토부스 2 · 키오스크 1」 */
export const equipmentText = (e: ProjectEquipment | undefined): string =>
  EQUIPMENT_KINDS.filter((k) => (e?.[k] ?? 0) > 0)
    .map((k) => `${EQUIPMENT_LABEL[k]} ${e![k]}`)
    .join(" · ");

export interface EquipmentProject {
  id: string;
  name: string;
  status: string;
  startDate?: string;
  endDate?: string;
  deliveryDate?: string;
  equipment?: ProjectEquipment;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 장비를 쓰는 날 — 시작일 · 종료일 · 납기 중 가장 이른 날 ~ 가장 늦은 날. 날짜가 없으면 null */
export function equipmentRange(p: Pick<EquipmentProject, "startDate" | "endDate" | "deliveryDate">): { from: string; to: string } | null {
  const dates = [p.startDate, p.endDate, p.deliveryDate].filter((d): d is string => typeof d === "string" && YMD.test(d)).sort();
  if (dates.length === 0) return null;
  return { from: dates[0], to: dates[dates.length - 1] };
}

export interface EquipmentUser {
  id: string;
  name: string;
  status: string;
  count: number;
}

export interface EquipmentDay {
  used: Record<EquipmentKind, number>;
  users: Record<EquipmentKind, EquipmentUser[]>;
}

/** 쓰는 날이 이보다 길면 잘못 적은 날짜로 보고 세지 않는다(월 대행 1년치 같은 것) */
const MAX_RANGE_DAYS = 120;

/** 날짜 → 그날 쓰는 대수 · 쓰는 프로젝트. 장비를 적은 프로젝트만, 취소 빼고 */
export function equipmentByDay(projects: EquipmentProject[]): Map<string, EquipmentDay> {
  const days = new Map<string, EquipmentDay>();
  for (const p of projects) {
    if (p.status === "cancelled" || !hasEquipment(p.equipment)) continue;
    const range = equipmentRange(p);
    if (!range) continue;
    let d = range.from;
    for (let i = 0; d <= range.to && i < MAX_RANGE_DAYS; i++, d = addDays(d, 1)) {
      let day = days.get(d);
      if (!day) {
        day = { used: { photobooth: 0, kiosk: 0 }, users: { photobooth: [], kiosk: [] } };
        days.set(d, day);
      }
      for (const k of EQUIPMENT_KINDS) {
        const n = p.equipment?.[k] ?? 0;
        if (n <= 0) continue;
        day.used[k] += n;
        day.users[k].push({ id: p.id, name: p.name, status: p.status, count: n });
      }
    }
  }
  return days;
}

export interface EquipmentConflict {
  kind: EquipmentKind;
  from: string;
  to: string;
  need: number;
  owned: number;
  users: EquipmentUser[];
}

/**
 * 보유 대수를 넘는 날들. 이어진 날 중 같은 프로젝트 · 같은 대수면 한 묶음으로
 * (「12/11~12/12 포토부스 4대 — 보유 3」).
 */
export function equipmentConflicts(byDay: Map<string, EquipmentDay>, owned: Record<EquipmentKind, number> = EQUIPMENT_OWNED): EquipmentConflict[] {
  const out: (EquipmentConflict & { sig: string })[] = [];
  const dates = [...byDay.keys()].sort();
  for (const kind of EQUIPMENT_KINDS) {
    let open: (EquipmentConflict & { sig: string }) | null = null;
    for (const d of dates) {
      const day = byDay.get(d)!;
      const need = day.used[kind];
      if (need <= owned[kind]) {
        open = null;
        continue;
      }
      const sig = `${need}|${day.users[kind].map((u) => `${u.id}:${u.count}`).join(",")}`;
      if (open && open.sig === sig && addDays(open.to, 1) === d) {
        open.to = d;
        continue;
      }
      open = { kind, from: d, to: d, need, owned: owned[kind], users: day.users[kind], sig };
      out.push(open);
    }
  }
  return out
    .map(({ sig: _sig, ...c }): EquipmentConflict => c)
    .sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
}

/** 이 기간과 겹치는 겹침만 */
export const conflictsBetween = (list: EquipmentConflict[], from: string, to: string): EquipmentConflict[] =>
  list.filter((c) => c.from <= to && c.to >= from);
