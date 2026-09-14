// ============================================================
//  인건비 — 근무 일지 실측 · 없으면 가정값
// ------------------------------------------------------------
//  매출 손익의 인건비는 원래 **가정값**이었다 (아이디 하루 7시간 × 30일 ×
//  시급, 와우 이벤트 운영일 × 8시간 × 1명 × 시급). 이제 AC'SCENT 근무 일지
//  (`schedules` 컬렉션)에 쌓인 **실제 근무**로 계산하고, 실측을 쓸 수 없는
//  달만 가정값으로 돌아가 「추정」이라고 밝힌다.
//
//  이 파일은 **판정과 배분만** 한다 — 순수 함수라 화면·서버·비서가 같은
//  규칙을 쓴다(buildPnl · monthlyTrend · buildEventPerf 가 모두 여기를 부른다).
//  근무 기록을 모으는 계산은 server/labor.ts, 원본은 서버에서만 읽는다.
//
//  규칙 (2026-09-15 사용자 결정)
//   · 실측은 **달이 끝났고** 그 매장·그 달에 근무 기록이 있을 때만.
//     진행 중인 달은 기록이 있어도 추정이다.
//   · 금액 = 근무 일지에 저장된 급여(pay) + 주휴수당(급여 보고서와 같은 규칙)
//     + 정직원 근무시간 × 가정 시급. 정직원은 실제로 시급을 받지 않는다 —
//     그 몫은 「가정 시급 환산」으로 따로 들고 다니며 화면에 드러낸다.
//     3.3% 원천징수는 직원 몫에서 떼는 돈이라 회사 비용에 더하지 않는다.
//   · 아이디 실측은 고정비 「상시 인건비」 자리를 **대신**한다.
//   · 와우 실측은 이벤트 인건비 자리를 **대신**한다. 날마다 그날의 인건비를
//     그날 열린 이벤트(이 달에 시작한 것)에 똑같이 나눈다. 이벤트가 없는
//     날의 근무는 와우 「상시 인건비」로 둔다.
//   · 실측 달에는 가정 인건비를 **더하지 않는다** — 엑셀이 같은 사람의
//     같은 시간을 두 번 세던 문제를 다시 만들지 않기 위해서다. 같은 이유로
//     엑셀 재현 모드의 접객 인건비도 실측 달에는 넣지 않는다 (aggregate.ts).
// ============================================================

import {
  eventLabor,
  idRegularLabor,
  type SalesAssumptions,
  type SalesEvent,
  type SalesStore,
} from "./types";

/** 근무 기록이 있는 매장 — 온라인은 근무 기록이 없다 */
export type LaborStore = "id" | "wow";
export type LaborSource = "actual" | "assumed";
/** 왜 이 출처인가 — 화면이 사람 말로 바꿔 보여준다 */
export type LaborReason = "actual" | "month_open" | "no_records" | "no_data";

export const LABOR_REASON_LABEL: Record<LaborReason, string> = {
  actual: "근무 일지 실측",
  month_open: "진행 중인 달 — 달이 끝나면 근무 일지 실측으로 바뀝니다",
  no_records: "이 달 근무 기록이 없어 가정값",
  no_data: "근무 일지를 불러오지 못해 가정값",
};

/** 하루치 — 이벤트에 나누려면 날짜 단위가 필요하다 */
export interface LaborDay {
  /** 근무시간 전부 (정직원 포함) */
  hours: number;
  /** 저장된 급여 합계 */
  paid: number;
  /** 이 날에 얹힌 주휴수당 (그 주의 근무시간 비례) */
  holiday: number;
  /** 급여 0 으로 저장된 정직원 근무시간 — 가정 시급으로 환산할 몫 */
  staffHours: number;
}

/** 직원별 합계 — 화면의 펼침 내역 */
export interface LaborEmployee {
  id: string;
  name: string;
  /** 정직원(isStaff) */
  staff: boolean;
  /** employees 컬렉션에 없는 직원 */
  unknown: boolean;
  hours: number;
  staffHours: number;
  paid: number;
  holiday: number;
}

/** 월 × 매장 실측 */
export interface LaborStoreMonth {
  month: string;
  store: LaborStore;
  /** 근무 건수 */
  shifts: number;
  /** 근무가 있던 날 수 */
  recordDays: number;
  hours: number;
  staffHours: number;
  paid: number;
  holiday: number;
  employees: LaborEmployee[];
  days: Record<string, LaborDay>;
}

/** 서버가 만들어 내려보내는 집계 — 원본 근무 기록은 들어 있지 않다 */
export interface LaborActuals {
  /** `${month}|${store}` → 실측 */
  byKey: Record<string, LaborStoreMonth>;
  /** 기록이 있는 달 (오름차순) */
  months: string[];
  /** 집계 중 걸린 것 (미등록 직원 등) */
  warnings: string[];
}

export const laborKey = (month: string, store: LaborStore) => `${month}|${store}`;

/** 집계 함수에 넘기는 인건비 맥락. 없으면 전부 가정값 (예전과 같다) */
export interface LaborContext {
  actuals?: LaborActuals | null;
  /** 오늘 (YYYY-MM-DD) — 달이 끝났는지 판단. 없으면 한국 시각 오늘 */
  today?: string;
}

/**
 * 한국 시각 오늘. months.ts 의 todayMonth 는 UTC 라 매달 1일 오전 9시까지
 * 지난달을 「이번 달」로 본다 — 실측 판정이 그 몇 시간 동안 흔들리지 않게 따로 둔다.
 */
export const kstToday = (): string => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 실측으로 계산했을 때의 내역 */
export interface ActualLabor {
  shifts: number;
  recordDays: number;
  hours: number;
  staffHours: number;
  /** 알바 실지급 (저장된 급여) */
  paid: number;
  holiday: number;
  /** 정직원 환산에 쓴 가정 시급 */
  staffWage: number;
  /** 정직원 근무시간 × 가정 시급 — 실제로 나간 돈이 아니다 */
  staffEquivalent: number;
  total: number;
  /** 이벤트에 나눈 몫 (와우) */
  eventShare: number;
  /** 상시 인건비로 둔 몫 (아이디 전부 · 와우 이벤트 없는 날) */
  commonShare: number;
  employees: LaborEmployee[];
}

/** 한 매장·한 달의 인건비 — 출처와 함께 */
export interface StoreLabor {
  source: LaborSource;
  reason: LaborReason;
  /** 고정비 「상시 인건비」 */
  regularLabor: number;
  /** 이벤트 id → 이벤트 인건비 (이 달에 시작한 이벤트) */
  eventLabor: Record<string, number>;
  eventLaborTotal: number;
  /** 실측일 때만 */
  actual?: ActualLabor;
}

/**
 * 한 매장·한 달의 인건비를 정한다. 세 집계 함수가 모두 이것만 부른다.
 *
 * @param monthEvents 이 매장의, **이 달에 시작한** 이벤트 (buildPnl 과 같은 기준)
 */
export function resolveStoreLabor(
  month: string,
  store: SalesStore,
  monthEvents: SalesEvent[],
  a: SalesAssumptions,
  ctx?: LaborContext,
): StoreLabor {
  const assumed = (reason: LaborReason): StoreLabor => {
    const map: Record<string, number> = {};
    let total = 0;
    monthEvents.forEach((e) => {
      const v = eventLabor(e, a);
      map[e.id] = v;
      total += v;
    });
    return {
      source: "assumed",
      reason,
      regularLabor: store === "id" ? idRegularLabor(a) : 0,
      eventLabor: map,
      eventLaborTotal: total,
    };
  };

  // 온라인은 근무 기록이 없다 — 예전과 같게 (이벤트 가정만)
  if (store === "online") return assumed("no_records");
  if (!ctx?.actuals) return assumed("no_data");
  const today = ctx.today ?? kstToday();
  if (month >= today.slice(0, 7)) return assumed("month_open");
  const rec = ctx.actuals.byKey[laborKey(month, store)];
  if (!rec || rec.shifts === 0) return assumed("no_records");

  // 정직원 환산 시급 — 그 매장의 가정 시급 (아이디 상시 · 와우 이벤트 스태프)
  const staffWage = store === "id" ? a.wage.idRegular : a.wage.eventStaff;
  const map: Record<string, number> = {};
  monthEvents.forEach((e) => (map[e.id] = 0));
  let eventShare = 0;
  let commonShare = 0;

  Object.entries(rec.days).forEach(([date, d]) => {
    const cost = d.paid + d.holiday + d.staffHours * staffWage;
    // 아이디 이벤트는 상시 인력이 운영한다(스태프 0명) — 아이디 실측은 전부 상시 인건비
    const covering =
      store === "wow" ? monthEvents.filter((e) => e.from <= date && date <= e.to) : [];
    if (covering.length === 0) {
      commonShare += cost;
      return;
    }
    const each = cost / covering.length;
    covering.forEach((e) => (map[e.id] += each));
    eventShare += cost;
  });

  const staffEquivalent = rec.staffHours * staffWage;
  return {
    source: "actual",
    reason: "actual",
    regularLabor: commonShare,
    eventLabor: map,
    eventLaborTotal: eventShare,
    actual: {
      shifts: rec.shifts,
      recordDays: rec.recordDays,
      hours: rec.hours,
      staffHours: rec.staffHours,
      paid: rec.paid,
      holiday: rec.holiday,
      staffWage,
      staffEquivalent,
      total: rec.paid + rec.holiday + staffEquivalent,
      eventShare,
      commonShare,
      employees: rec.employees,
    },
  };
}
