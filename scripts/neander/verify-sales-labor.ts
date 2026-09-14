// ============================================================
//  매출 인건비 실측 검증 — 근무 일지 급여 보고서와 대조 · 가정값 대비 변화
// ------------------------------------------------------------
//  ① 대조: 월 × 매장 실측(저장 급여 + 주휴수당)이 급여 보고서
//     (components/scheduler/ReportView.tsx) 「매장별 통계」의 급여·주휴수당과
//     원 단위로 같은가. 아래 reportViewStore 는 그 화면 계산을 **대조군으로
//     옮긴 것**이다 — 실제 집계(server/labor.ts)와 따로 짜야 같은 실수를
//     두 번 하지 않는다.
//  ② 변화: 가정값이던 인건비 → 실측 인건비, 공헌이익·영업이익 차이.
//  ③ 배분 검산: 와우 이벤트 몫 + 상시 몫 = 실측 합계.
//
//    npx tsx scripts/neander/verify-sales-labor.ts [2026-06 2026-07 2026-08]
//  읽기만 한다.
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { calculateWeeklyHolidayPay, groupSchedulesByWeek } from "@/lib/scheduler/calculations";
import { buildEventPerf, buildPnl } from "@/lib/neander/sales/aggregate";
import { laborKey } from "@/lib/neander/sales/labor";
import { computeLaborActuals, type EmployeeRow, type ScheduleRow } from "@/lib/neander/sales/server/labor";
import { NEANDER_COL } from "@/lib/neander/collections";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import type { SalesAssumptions, SalesEvent, SalesLine, SalesProduct } from "@/lib/neander/sales/types";

const argMonths = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
const MONTHS = argMonths.length ? argMonths : ["2026-06", "2026-07", "2026-08"];
const TODAY = "2026-09-15";
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const signed = (n: number) => `${n >= 0 ? "+" : ""}${won(n)}`;

/** ReportView 「매장별 통계」의 급여·주휴수당 — 화면 코드를 대조군으로 옮김 */
function reportViewStore(
  schedules: ScheduleRow[],
  employees: EmployeeRow[],
  month: string,
  storeId: "accent-id" | "accent-wow",
) {
  const storeSchedules = schedules.filter((s) => s.store === storeId && s.date.startsWith(month));
  const pay = storeSchedules.reduce((a, s) => a + s.pay, 0);
  const ids = [...new Set(storeSchedules.map((s) => s.employeeId))];
  const storeEmployees = employees.filter((e) => ids.includes(e.id) && !e.isStaff);
  let holiday = 0;
  storeEmployees.forEach((emp) => {
    const all = schedules.filter((s) => s.employeeId === emp.id && s.store === storeId);
    if (emp.includesHolidayPay) return;
    groupSchedulesByWeek(all).forEach((week: ScheduleRow[]) => {
      const last = week.map((s) => s.date).sort().pop();
      if (last && last.startsWith(month)) {
        holiday += calculateWeeklyHolidayPay(week.reduce((a, s) => a + s.hours, 0), emp.hourlyWage ?? 0);
      }
    });
  });
  return { pay, holiday };
}

async function main() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
  }
  const db = getFirestore();
  const all = async <T>(c: string) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as T);

  const [schedules, employees, lines, products, events, aSnap] = await Promise.all([
    (async () => (await db.collection("schedules").get()).docs.map((d) => d.data() as ScheduleRow))(),
    all<EmployeeRow>("employees"),
    all<SalesLine>(NEANDER_COL.salesLines),
    all<SalesProduct>(NEANDER_COL.salesProducts),
    all<SalesEvent>(NEANDER_COL.salesEvents),
    db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
  ]);
  const a = (aSnap.exists ? { id: aSnap.id, ...aSnap.data() } : SEED_ASSUMPTIONS) as SalesAssumptions;
  const actuals = computeLaborActuals(schedules, employees);
  const ctx = { actuals, today: TODAY };

  console.log("══ ① 급여 보고서(매장별 통계) 대조 ══");
  let mismatch = 0;
  for (const m of MONTHS) {
    for (const [storeId, store] of [["accent-id", "id"], ["accent-wow", "wow"]] as const) {
      const rv = reportViewStore(schedules, employees, m, storeId);
      const rec = actuals.byKey[laborKey(m, store)];
      const ok = !!rec && rec.paid === rv.pay && rec.holiday === rv.holiday;
      if (!ok) mismatch++;
      console.log(
        `${ok ? "✓" : "✗"} ${m} ${store.padEnd(3)} 급여 ${won(rec?.paid ?? 0)} / 보고서 ${won(rv.pay)} · 주휴 ${won(rec?.holiday ?? 0)} / 보고서 ${won(rv.holiday)}` +
          (rec ? ` · 합계 ${won(rec.paid + rec.holiday)} · ${Math.round(rec.hours * 10) / 10}시간(정직원 ${Math.round(rec.staffHours * 10) / 10}) · 정직원 환산 ${won(rec.staffHours * (store === "id" ? a.wage.idRegular : a.wage.eventStaff))}` : ""),
      );
    }
  }
  if (actuals.warnings.length) console.log("  ⚠", actuals.warnings.join(" / "));

  console.log("\n══ ② 가정값 → 실측 ══");
  for (const m of MONTHS) {
    const before = buildPnl(m, lines, products, events, a);
    const after = buildPnl(m, lines, products, events, a, ctx);
    console.log(`\n■ ${m}`);
    for (const s of after.stores) {
      if (s.store === "online") continue;
      const b = before.stores.find((x) => x.store === s.store)!;
      const lab = (x: typeof s) => x.variable.eventLabor + x.variable.serviceLabor + x.regularLabor;
      console.log(
        `  ${s.store.padEnd(3)} [${s.labor.source}] 인건비(이벤트+상시) ${won(lab(b))} → ${won(lab(s))} (${signed(lab(s) - lab(b))})` +
          ` · 공헌이익 ${won(b.contribution)} → ${won(s.contribution)} (${signed(s.contribution - b.contribution)})` +
          ` · 영업이익 ${won(b.operating)} → ${won(s.operating)} (${signed(s.operating - b.operating)})`,
      );
      if (s.labor.actual) {
        const act = s.labor.actual;
        console.log(
          `       실측 = 알바 ${won(act.paid)} + 주휴 ${won(act.holiday)} + 정직원 환산 ${won(act.staffEquivalent)} = ${won(act.total)} · 이벤트 몫 ${won(act.eventShare)} · 상시 몫 ${won(act.commonShare)}`,
        );
      }
    }
    console.log(
      `  합계 공헌이익 ${won(before.total.contribution)} → ${won(after.total.contribution)} (${signed(after.total.contribution - before.total.contribution)})` +
        ` · 영업이익 ${won(before.total.operating)} → ${won(after.total.operating)} (${signed(after.total.operating - before.total.operating)})`,
    );

    // ③ 배분 검산 — 이벤트 실적의 이벤트 인건비 합 + 와우 상시 몫 = 와우 실측 합계
    const wow = after.stores.find((x) => x.store === "wow")!;
    if (wow.labor.actual) {
      const perf = buildEventPerf(m, lines, products, events, a, ctx).filter((p) => p.event.store === "wow");
      const eventLaborSum = perf.reduce((acc, p) => acc + (wow.labor.eventLabor[p.event.id] ?? 0), 0);
      const diff = Math.round(eventLaborSum + wow.regularLabor - wow.labor.actual.total);
      console.log(`  ③ 와우 배분: 이벤트 ${won(eventLaborSum)} + 상시 ${won(wow.regularLabor)} = 실측 ${won(wow.labor.actual.total)} → ${diff === 0 ? "일치" : `차이 ${diff}`}`);
    }
  }

  console.log(`\n${mismatch === 0 ? "✓ 급여 보고서와 모두 일치" : `✗ 불일치 ${mismatch}건`}`);
  process.exit(mismatch === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
