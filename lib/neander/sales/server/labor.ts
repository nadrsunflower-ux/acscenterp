// ============================================================
//  근무 일지 → 월 × 매장 실측 인건비
// ------------------------------------------------------------
//  원본은 AC'SCENT 근무 일지의 `schedules` 컬렉션이다 (같은 Firebase
//  프로젝트, neander_ 접두사 없음). `weekSchedules`·`weekNotes` 는 주간 표
//  화면용 사본이라 쓰지 않는다. 근무 일지 쪽은 **읽기만** 한다.
//
//  계산(computeLaborActuals)은 Firestore 를 모른다 — 근무 기록 배열과 직원
//  배열만 받아 테스트할 수 있다. 읽기(loadLaborActuals)는 따로 둔다.
//
//  금액 규칙은 급여 보고서(components/scheduler/ReportView.tsx)의 **매장별
//  통계**와 같다:
//   · 급여 = 저장된 pay 합계 (입력할 때 시급으로 계산해 저장된 값 —
//     시급을 나중에 바꿔도 예전 pay 는 그대로다)
//   · 주휴수당 = 직원 × 매장별로 주(월요일 시작)를 묶어, 주 15시간 이상이면
//     calculateWeeklyHolidayPay. 그 주의 **마지막 근무일이 속한 달**에 넣는다.
//     includesHolidayPay 직원·정직원·직원 목록에 없는 사람은 주지 않는다.
//   · 3.3% 는 직원 몫 원천징수라 더하지 않는다.
//  주 묶기와 주휴수당 식은 lib/scheduler/calculations 를 그대로 import 한다 —
//  규칙을 복제하면 급여 보고서와 조용히 갈라진다.
//
//  정직원(isStaff)은 급여가 0 으로 저장된다. 그 근무시간은 staffHours 로
//  따로 모으고, 가정 시급 환산은 화면·집계(../labor.ts)가 한다 — 시급은
//  매출 기본가정에서 바뀔 수 있어서 서버에서 굳히지 않는다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { calculateWeeklyHolidayPay, groupSchedulesByWeek } from "@/lib/scheduler/calculations";
import {
  laborKey,
  type LaborActuals,
  type LaborEmployee,
  type LaborStore,
  type LaborStoreMonth,
} from "../labor";

/** schedules 문서에서 쓰는 필드 */
export interface ScheduleRow {
  employeeId: string;
  date: string;
  hours: number;
  pay: number;
  store: string;
}

/** employees 문서에서 쓰는 필드 */
export interface EmployeeRow {
  id: string;
  name?: string;
  hourlyWage?: number;
  isStaff?: boolean;
  includesHolidayPay?: boolean;
}

/** 근무 일지 매장 코드 → 매출 매장 (lib/db.ts listScheduleShifts 와 같은 대응) */
const STORE: Record<string, LaborStore> = {
  "accent-id": "id",
  "accent-wow": "wow",
};

export function computeLaborActuals(schedules: ScheduleRow[], employees: EmployeeRow[]): LaborActuals {
  const E = new Map(employees.map((e) => [e.id, e]));
  const byKey: Record<string, LaborStoreMonth> = {};
  const people = new Map<string, Map<string, LaborEmployee>>();
  const unknownIds = new Set<string>();
  let skipped = 0;
  let staffWithPay = 0;

  type Row = { employeeId: string; date: string; hours: number; store: LaborStore };
  const rows: Row[] = [];

  for (const s of schedules) {
    const store = STORE[s.store];
    const date = String(s.date ?? "");
    if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped++;
      continue;
    }
    const month = date.slice(0, 7);
    const key = laborKey(month, store);
    const rec = (byKey[key] ??= {
      month,
      store,
      shifts: 0,
      recordDays: 0,
      hours: 0,
      staffHours: 0,
      paid: 0,
      holiday: 0,
      employees: [],
      days: {},
    });
    const day = (rec.days[date] ??= { hours: 0, paid: 0, holiday: 0, staffHours: 0 });
    const hours = Number(s.hours) || 0;
    const pay = Number(s.pay) || 0;
    const emp = E.get(s.employeeId);
    if (!emp) unknownIds.add(s.employeeId);
    const staff = !!emp?.isStaff;
    // 정직원인데 급여가 찍혀 있으면 그 금액을 실지급으로 보고 환산하지 않는다 (두 번 세지 않게)
    const staffHours = staff && pay === 0 ? hours : 0;
    if (staff && pay > 0) staffWithPay++;

    rec.shifts++;
    rec.hours += hours;
    rec.paid += pay;
    rec.staffHours += staffHours;
    day.hours += hours;
    day.paid += pay;
    day.staffHours += staffHours;

    const map = people.get(key) ?? new Map<string, LaborEmployee>();
    people.set(key, map);
    const person =
      map.get(s.employeeId) ??
      ({
        id: s.employeeId,
        name: emp?.name ?? "직원 목록에 없는 직원",
        staff,
        unknown: !emp,
        hours: 0,
        staffHours: 0,
        paid: 0,
        holiday: 0,
      } satisfies LaborEmployee);
    person.hours += hours;
    person.staffHours += staffHours;
    person.paid += pay;
    map.set(s.employeeId, person);

    rows.push({ employeeId: s.employeeId, date, hours, store });
  }

  // ---- 주휴수당 — 직원 × 매장별로 주를 묶는다 (급여 보고서 매장별 통계와 같다) ----
  const byEmpStore = new Map<string, Row[]>();
  rows.forEach((r) => {
    const k = `${r.employeeId}|${r.store}`;
    const list = byEmpStore.get(k) ?? [];
    list.push(r);
    byEmpStore.set(k, list);
  });

  byEmpStore.forEach((list) => {
    const emp = E.get(list[0].employeeId);
    if (!emp || emp.isStaff || emp.includesHolidayPay) return;
    const wage = Number(emp.hourlyWage) || 0;
    const store = list[0].store;
    (groupSchedulesByWeek(list) as Map<string, Row[]>).forEach((week) => {
      const weekHours = week.reduce((a, s) => a + s.hours, 0);
      const hp = calculateWeeklyHolidayPay(weekHours, wage);
      if (hp <= 0) return;
      const dates = week.map((s) => s.date).sort();
      const month = dates[dates.length - 1].slice(0, 7);
      const key = laborKey(month, store);
      const rec = byKey[key];
      if (!rec) return;
      rec.holiday += hp;
      const person = people.get(key)?.get(emp.id);
      if (person) person.holiday += hp;

      // 이벤트에 나누려면 날짜에 얹어야 한다 — 그 달에 속한 그 주 근무일에 시간 비례로
      const inMonth = week.filter((s) => s.date.startsWith(month));
      const h = inMonth.reduce((a, s) => a + s.hours, 0);
      let given = 0;
      inMonth.forEach((s, i) => {
        const part =
          i === inMonth.length - 1
            ? hp - given
            : Math.round(h > 0 ? (hp * s.hours) / h : hp / inMonth.length);
        given += part;
        rec.days[s.date].holiday += part;
      });
    });
  });

  // ---- 마무리 ----
  Object.entries(byKey).forEach(([key, rec]) => {
    rec.recordDays = Object.keys(rec.days).length;
    rec.employees = [...(people.get(key)?.values() ?? [])].sort((a, b) => b.hours - a.hours);
  });

  const warnings: string[] = [];
  if (unknownIds.size > 0) {
    warnings.push(
      `직원 목록에 없는 직원 ${unknownIds.size}명의 근무가 있습니다 — 저장된 급여는 넣고, 시급을 몰라 주휴수당은 계산하지 않았습니다 (급여 보고서와 같음).`,
    );
  }
  if (staffWithPay > 0) warnings.push(`급여가 찍힌 정직원 근무 ${staffWithPay}건은 가정 시급으로 환산하지 않고 찍힌 급여를 썼습니다.`);
  if (skipped > 0) warnings.push(`매장·날짜를 알 수 없는 근무 ${skipped}건은 뺐습니다.`);

  return {
    byKey,
    months: [...new Set(Object.values(byKey).map((r) => r.month))].sort(),
    warnings,
  };
}

/** Firestore 에서 읽어 집계한다 — 근무 일지 쪽에는 쓰지 않는다 */
export async function loadLaborActuals(db: Firestore): Promise<LaborActuals> {
  const [schedSnap, empSnap] = await Promise.all([
    db.collection("schedules").get(),
    db.collection("employees").get(),
  ]);
  return computeLaborActuals(
    schedSnap.docs.map((d) => d.data() as ScheduleRow),
    empSnap.docs.map((d) => ({ ...(d.data() as Omit<EmployeeRow, "id">), id: d.id })),
  );
}
