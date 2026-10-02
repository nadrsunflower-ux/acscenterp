// ============================================================
//  그날 일정 검증 — 구글 일정을 날짜별 줄로 펴는 규칙
// ------------------------------------------------------------
//  구글을 부르지 않는다. 손으로 만든 일정으로 finance/calendar.ts 가 지켜야
//  할 것을 못 박는다. 틀리기 쉬운 곳은 **끝 날짜**다 — 종일 일정의 end 는
//  「포함하지 않는 날」 이라, 하루짜리 일정이 이틀로 보이기 쉽다.
//
//    npm run finance:verify-calendar
//    npm run finance:verify-calendar -- --live <캘린더 ID>   (실제로 읽어 본다 · 읽기 전용)
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  addDays,
  cleanCalendars,
  dayLabel,
  expandGoogleEvent,
  monthRange,
  sortDayEvents,
} from "@/lib/neander/finance/calendar";

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

const CAL = { id: "team@example.com", label: "팀" };
const dates = (ev: Parameters<typeof expandGoogleEvent>[0], range?: { from: string; to: string }) =>
  expandGoogleEvent(ev, CAL, range).map((e) => e.date).join(",");

async function main() {
  const liveAt = process.argv.indexOf("--live");
  if (liveAt > 0) {
    const { listDayEvents, serviceEmail } = await import("@/lib/neander/finance/server/gcal");
    const id = process.argv[liveAt + 1];
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const { from, to } = monthRange(today.slice(0, 7));
    console.log(`서버 계정 ${serviceEmail()}`);
    const { events, issues } = await listDayEvents([{ id, label: "확인" }], from, to);
    issues.forEach((i) => console.log(`못 읽음 [${i.code}] ${i.message}`));
    console.log(`${from} ~ ${to} 일정 ${events.length}건`);
    events.slice(0, 12).forEach((e) => console.log(`  ${e.date} ${e.time ?? "종일"} ${e.title}`));
    process.exit(issues.length ? 1 : 0);
  }

  console.log("=== 날짜로 펴기 ===");
  ok(dates({ id: "a", start: { date: "2026-09-27" }, end: { date: "2026-09-28" } }) === "2026-09-27",
    "하루짜리 종일 일정은 하루다 (끝 날짜는 포함하지 않는 날)");
  ok(dates({ id: "b", start: { date: "2026-09-12" }, end: { date: "2026-09-15" } }) === "2026-09-12,2026-09-13,2026-09-14",
    "사흘짜리 종일 일정은 날마다 한 줄");
  ok(dates({ id: "c", start: { dateTime: "2026-09-27T14:00:00+09:00" }, end: { dateTime: "2026-09-27T15:30:00+09:00" } }) === "2026-09-27",
    "시간 일정은 한국 시간의 그 날");
  ok(dates({ id: "d", start: { dateTime: "2026-09-27T22:00:00+09:00" }, end: { dateTime: "2026-09-28T00:00:00+09:00" } }) === "2026-09-27",
    "자정에 끝나는 일정은 다음 날로 넘어가지 않는다");
  ok(dates({ id: "e", start: { dateTime: "2026-09-27T22:00:00+09:00" }, end: { dateTime: "2026-09-28T02:00:00+09:00" } }) === "2026-09-27,2026-09-28",
    "자정을 넘긴 일정은 이틀에 걸친다");
  {
    const rows = expandGoogleEvent(
      { id: "f", summary: "와우 리모델링", location: "서교동", start: { dateTime: "2026-09-12T10:00:00+09:00" }, end: { dateTime: "2026-09-13T18:00:00+09:00" } },
      CAL,
    );
    ok(rows[0].time === "10:00" && !rows[0].continued && rows[1].time === undefined && rows[1].continued === true,
      "시작 시각은 첫날에만 적고, 둘째 날부터는 이어지는 일정이다");
    ok(rows[0].location === "서교동" && rows[0].calendar === "팀" && rows[0].key !== rows[1].key, "장소 · 캘린더 이름이 따라오고 줄마다 열쇠가 다르다");
  }
  ok(dates({ id: "g", status: "cancelled", start: { date: "2026-09-27" }, end: { date: "2026-09-28" } }) === "", "취소된 일정은 버린다");
  ok(expandGoogleEvent({ id: "h", start: { date: "2026-09-27" }, end: { date: "2026-09-28" } }, CAL)[0].title === "(제목 없음)", "제목이 없으면 그렇게 적는다");
  ok(dates({ id: "i", start: { date: "2026-08-30" }, end: { date: "2026-09-03" } }, { from: "2026-09-01", to: "2026-09-30" }) === "2026-09-01,2026-09-02",
    "물은 기간 밖의 날은 버린다 (달을 걸친 일정)");
  ok(expandGoogleEvent({ id: "j", start: { date: "2026-01-01" }, end: { date: "2027-01-01" } }, CAL).length === 45,
    "한 해 내내 걸린 일정이 줄을 수백 개 만들지 않는다");
  ok(dates({ id: "j2", start: { date: "2026-01-01" }, end: { date: "2027-01-01" } }, { from: "2026-09-26", to: "2026-09-28" }) === "2026-09-26,2026-09-27,2026-09-28",
    "오래전에 시작한 긴 일정도 물은 기간에는 나온다");
  ok(dates({ id: "k", start: { date: "2026-09-27" } }) === "2026-09-27", "끝이 없는 일정은 하루로 본다");

  console.log("\n=== 순서 · 날짜 ===");
  {
    const day = sortDayEvents([
      ...expandGoogleEvent({ id: "1", summary: "저녁", start: { dateTime: "2026-09-27T19:00:00+09:00" }, end: { dateTime: "2026-09-27T20:00:00+09:00" } }, CAL),
      ...expandGoogleEvent({ id: "2", summary: "아침", start: { dateTime: "2026-09-27T09:00:00+09:00" }, end: { dateTime: "2026-09-27T10:00:00+09:00" } }, CAL),
      ...expandGoogleEvent({ id: "3", summary: "행사", start: { date: "2026-09-27" }, end: { date: "2026-09-28" } }, CAL),
    ]);
    ok(day.map((e) => e.title).join(">") === "행사>아침>저녁", "종일 일정이 먼저, 그다음 시각순");
  }
  ok(addDays("2026-09-30", 3) === "2026-10-03" && addDays("2026-03-01", -1) === "2026-02-28", "날짜 더하기는 달을 넘는다");
  ok(JSON.stringify(monthRange("2026-02")) === JSON.stringify({ from: "2026-02-01", to: "2026-02-28" }) && monthRange("2028-02").to === "2028-02-29",
    "그 달의 끝날 (윤년 포함)");
  ok(dayLabel("2026-09-27") === "9월 27일 (일)", "날짜 이름에 요일이 붙는다", dayLabel("2026-09-27"));

  console.log("\n=== 캘린더 목록 다듬기 ===");
  {
    const list = cleanCalendars([
      { id: " team@example.com ", label: "팀" },
      { id: "TEAM@example.com", label: "중복" },
      { id: "", label: "빈 줄" },
      { id: "ceo@example.com" },
    ]);
    ok(list.length === 2 && list[0].id === "team@example.com", "빈 줄 · 중복(대소문자 무시)을 버리고 앞뒤 빈칸을 뗀다");
    ok(list[1].label === "ceo", "이름이 없으면 ID 앞머리를 쓴다");
    ok(cleanCalendars("x").length === 0 && cleanCalendars(Array.from({ length: 30 }, (_, i) => ({ id: `c${i}@x.com` }))).length === 10,
      "목록이 아니면 비우고, 열 개까지만 받는다");
  }

  console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
