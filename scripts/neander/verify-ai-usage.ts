// ============================================================
//  AI 사용료 실호출 확인 — 오픈라우터 관리 키로 지금 상태를 읽어 그날 기록을 덮어쓰고,
//  화면과 같은 묶음(usageView)을 찍어 본다. 쓰는 것은 오늘 기록 문서 하나뿐이다.
//
//    npm run shorts:verify-usage
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { managementKey, usageView } from "@/lib/neander/shorts/server/ai-usage";
import { OWNER_GROUP_LABEL, usd } from "@/lib/neander/shorts/ai-usage";

let fails = 0;
const ok = (cond: unknown, label: string, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};

(async () => {
  ok(managementKey(), "OPENROUTER_MANAGEMENT_KEY 있음");
  if (!managementKey()) process.exit(1);
  const v = await usageView(adminDb());
  ok(v.keys.length > 0, "키 목록", `${v.keys.length}개 (만료 · 삭제 ${v.keys.filter((k) => k.gone).length})`);
  ok(v.credits.total > 0, "충전 · 사용", `충전 ${usd(v.credits.total)} · 사용 ${usd(v.credits.used)} · 잔액 ${usd(v.credits.balance)}`);
  const sumKeys = v.keys.reduce((n, k) => n + k.month, 0);
  const sumOwners = v.owners.reduce((n, o) => n + o.month, 0);
  ok(Math.abs(sumKeys - sumOwners) < 0.01, "사람별 합 = 키별 합", `${v.month} ${usd(sumOwners)}`);
  console.log(`  하루 평균 ${usd(v.pace.perDay)} (${v.pace.basis} · ${v.pace.days}일) · 남은 날 ${v.daysLeft?.toFixed(2) ?? "—"}`);
  for (const o of v.owners) console.log(`  ${(OWNER_GROUP_LABEL[o.owner] ?? (o.owner || "주인 없음")).padEnd(28)} 이번 달 ${usd(o.month).padStart(9)} · 키 ${o.keys}개`);
  console.log(`  키에 안 잡힌 돈 ${usd(v.untracked)} · 달별 ${v.months.map((m) => `${m.month} ${usd(m.total)}`).join(" / ")}`);
  for (const w of v.warnings) console.log(`  [${w.tone === "danger" ? "위험" : "확인"}] ${w.text}`);
  const orphan = v.keys.filter((k) => !k.gone && !k.owner);
  ok(orphan.length === 0, "주인 없는 키 없음", orphan.map((k) => k.name).join(", "));
  console.log(fails ? `\n✗ ${fails}개 실패` : "\n✓ 모두 통과");
  process.exit(fails ? 1 : 0);
})();
