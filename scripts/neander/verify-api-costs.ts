// ============================================================
//  API 비용 실호출 확인 — 오픈라우터 시간별 기록을 한국 날짜로 받아 쌓고, 화면과 같은
//  묶음(apiCostView)을 찍어 본다. 쓰는 것은 neander_fin_api_days · 키 이름 표뿐이다.
//
//    npm run finance:verify-api-costs            — 최근 사흘만 다시 받기
//    npm run finance:verify-api-costs -- --all   — 시간별 기록이 남아 있는 날을 모두 다시 받기
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { managementKey } from "@/lib/neander/shorts/server/ai-usage";
import { apiCostView, syncApiDays } from "@/lib/neander/finance/server/api-cost";
import { costRows, EXACT_FROM, sumByKey, sumByTarget, usdText } from "@/lib/neander/finance/api-cost";

let fails = 0;
const ok = (cond: unknown, label: string, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};

(async () => {
  ok(managementKey(), "OPENROUTER_MANAGEMENT_KEY 있음");
  if (!managementKey()) process.exit(1);
  const all = process.argv.includes("--all");
  const db = adminDb();
  const t0 = Date.now();
  const s = await syncApiDays(db, all ? { from: EXACT_FROM, force: true } : { back: 3 });
  ok(s.dates.length > 0, "날짜별 기록 받음", `${s.dates.length}일 (${s.dates[0]} ~ ${s.through}) · ${((Date.now() - t0) / 1000).toFixed(1)}초`);

  const v = await apiCostView(db);
  const used = v.days.filter((d) => d.keys.length > 0);
  console.log(`  「9시 기준」 날 ${used.filter((d) => d.legacy).length}일 · 한국 날짜 ${used.filter((d) => !d.legacy).length}일`);
  ok(used.length > 0, "쓴 날", `${used.length}일 · ${used[0]?.date} ~ ${used[used.length - 1]?.date}`);

  // 쌓은 돈이 계정 전체 · 키별 누적과 맞는가 — 오픈라우터 두 집계가 소수점 안쪽으로 조금 다르다
  const total = v.days.reduce((n, d) => n + d.keys.reduce((m, k) => m + k.usd, 0), 0);
  const gap = total - v.credits.used;
  ok(Math.abs(gap) <= Math.max(5, v.credits.used * 0.005), "쌓은 합 ≈ 계정 전체 사용액", `${usdText(total)} / ${usdText(v.credits.used)} (차이 ${gap.toFixed(2)})`);
  console.log(`  충전 잔액 ${usdText(v.credits.balance)} · 환율 ${v.settings.krwPerUsd}원 · 만료 · 삭제 키 ${v.keys.filter((k) => k.gone).length}개`);

  // 시간별 금액 — 정확한 날은 시간 합이 그날 금액과 맞아야 나눠도 돈이 안 샌다
  const exact = v.days.filter((d) => !d.legacy && d.date >= EXACT_FROM);
  const noHours = exact.filter((d) => d.keys.some((k) => k.usd > 0 && !k.hours)).map((d) => d.date);
  ok(noHours.length === 0, "정확한 날은 모두 시간별 금액 있음", noHours.join(", "));
  const off = exact.flatMap((d) => d.keys.filter((k) => Math.abs(Object.values(k.hours ?? {}).reduce((n, h) => n + h.usd, 0) - k.usd) > 0.001).map((k) => `${d.date} ${k.name}`));
  ok(off.length === 0, "시간 합 = 그날 금액", off.slice(0, 5).join(", "));
  const rowSum = costRows(v.days, v.allocs).reduce((n, r) => n + r.usd, 0);
  ok(Math.abs(rowSum - total) < 0.01, "나눠 붙여도 합이 그대로", `${usdText(rowSum)} / ${usdText(total)}`);

  const rows = costRows(v.days, v.allocs);
  for (const k of sumByKey(rows).slice(0, 12)) console.log(`  ${k.name.padEnd(36)} ${usdText(k.usd).padStart(10)} · 정함 ${usdText(k.assigned).padStart(9)} · ${k.days}일`);
  for (const t of sumByTarget(rows)) console.log(`  [${t.key || "안 정함"}] ${usdText(t.usd)} · 키 ${t.keys.length}개`);
  console.log(fails ? `\n✗ ${fails}개 실패` : "\n✓ 모두 통과");
  process.exit(fails ? 1 : 0);
})();
