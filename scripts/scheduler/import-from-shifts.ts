// 기존 운영 사이트의 shifts 컬렉션(WorkShift: store=id|wow, staffName, start/end)을
// 근무 일지(scheduler)의 schedules 컬렉션(WorkSchedule: store=accent-id|accent-wow,
// employeeId, startTime/endTime, hours, pay)으로 변환·이식하는 스크립트.
//
// - 직원은 employees 컬렉션에서 staffName == name 으로 매칭하여 employeeId/시급을 얻는다.
//   (매칭 실패 시 해당 shift는 건너뛰고 경고)
// - hours/pay 는 scheduler 와 동일한 방식으로 계산(시급 0=정규직이면 pay 0).
// - 문서 id 는 scheduler 규칙 `${date}_${employeeId}_${store}` (주간 그리드 dedupe 호환).
// - 추가(setDoc)만 하며 기존 shifts 는 건드리지 않는다(비파괴적). 재실행 시 같은 id 덮어쓰기.
//
// 실행: npm run scheduler:import-shifts -- 2026-06   (월 인자 생략 시 전체 shifts)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env.local') });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// id|wow -> accent-id|accent-wow
const STORE_MAP: Record<string, 'accent-id' | 'accent-wow'> = {
  id: 'accent-id',
  wow: 'accent-wow',
};

function calculateHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

async function importFromShifts() {
  const monthArg = process.argv[2]; // 예: 2026-06 (선택)
  console.log(`Importing shifts -> schedules${monthArg ? ` (월: ${monthArg})` : ' (전체)'}...\n`);

  // 1) employees: name -> {id, wage, isStaff}
  const empSnap = await getDocs(collection(db, 'employees'));
  const byName = new Map<string, { id: string; wage: number; isStaff: boolean }>();
  const dupNames = new Set<string>();
  empSnap.docs.forEach((d) => {
    const x = d.data() as { name?: string; hourlyWage?: number; isStaff?: boolean };
    if (!x.name) return;
    if (byName.has(x.name)) dupNames.add(x.name);
    byName.set(x.name, { id: d.id, wage: x.hourlyWage || 0, isStaff: !!x.isStaff });
  });
  if (dupNames.size) {
    console.warn(`⚠️  동명이인(employees) 존재 — 마지막 항목 사용: ${[...dupNames].join(', ')}\n`);
  }

  // 2) shifts 읽기 + 월 필터
  interface ShiftDoc {
    id: string;
    date?: string;
    store?: string;
    staffName?: string;
    start?: string;
    end?: string;
    memo?: string;
  }
  const shiftSnap = await getDocs(collection(db, 'shifts'));
  const shifts: ShiftDoc[] = shiftSnap.docs
    .map((d) => {
      const x = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        date: x.date as string | undefined,
        store: x.store as string | undefined,
        staffName: x.staffName as string | undefined,
        start: x.start as string | undefined,
        end: x.end as string | undefined,
        memo: x.memo as string | undefined,
      };
    })
    .filter((s) => (monthArg ? typeof s.date === 'string' && s.date.startsWith(monthArg) : true));

  console.log(`대상 shifts: ${shifts.length}건\n`);

  let created = 0;
  const skipped: string[] = [];

  for (const s of shifts) {
    const store = STORE_MAP[s.store as string];
    const emp = s.staffName ? byName.get(s.staffName) : undefined;

    if (!store) {
      skipped.push(`${s.date} ${s.staffName}: 알 수 없는 store '${s.store}'`);
      continue;
    }
    if (!emp) {
      skipped.push(`${s.date} ${s.store}: 직원 매칭 실패 '${s.staffName}'`);
      continue;
    }
    if (!s.start || !s.end || !s.date) {
      skipped.push(`${s.date} ${s.staffName}: 시간/날짜 누락`);
      continue;
    }

    const hours = calculateHours(s.start, s.end);
    const pay = Math.round(hours * emp.wage);
    const id = `${s.date}_${emp.id}_${store}`;

    await setDoc(doc(db, 'schedules', id), {
      employeeId: emp.id,
      date: s.date,
      startTime: s.start,
      endTime: s.end,
      hours,
      pay,
      store,
    });
    created++;
    console.log(`✓ ${s.date} | ${store} | ${s.staffName}(${emp.id}) | ${s.start}-${s.end} | ${hours}H | ${pay.toLocaleString()}원`);
  }

  console.log(`\n완료: ${created}건 생성/갱신, ${skipped.length}건 건너뜀.`);
  if (skipped.length) {
    console.log('건너뜀 상세:');
    skipped.forEach((m) => console.log('  - ' + m));
  }
  process.exit(0);
}

importFromShifts().catch((error) => {
  console.error('Error importing shifts:', error);
  process.exit(1);
});
