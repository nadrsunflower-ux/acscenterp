// 생일 이벤트 발주 알림 확인 — `npm run sales:verify-order-alert` (읽기만)
//   --since 2026-10-01  지난 이벤트까지 짝을 보여 준다 (기본: 오늘부터 45일)
//   --today 2026-11-25  그날이라고 치고 알림을 계산한다
//   --run               실제로 노션 표를 맞추고 알림을 보낸다 (cron 과 같은 일)
import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { loadOrderEvents, runOrderAlert } from "@/lib/neander/sales/server/order-alert";
import { alertKey, daysBetween, inWindow, ORDER_STAGE_LABEL, orderStage, orderStoreLabel, periodText } from "@/lib/neander/sales/order-alert";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  const db = adminDb();
  const today = arg("--today") ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const since = arg("--since");
  const all = await loadOrderEvents(db);
  const list = since ? all.filter((e) => e.to >= since && daysBetween(today, e.from) <= 45 && e.store !== "online") : all.filter((e) => inWindow(e, today));
  console.log(`오늘 ${today} · 이벤트 ${list.length}건\n`);
  for (const e of list) {
    const st = orderStage(e, today);
    const lead = e.ordered ? `발주 ${e.ordered.date}(${e.ordered.from === "field" ? "칸" : "메모"}) · ${daysBetween(e.ordered.date, e.from)}일 전` : "발주 기록 없음";
    const key = alertKey(e, today);
    console.log(
      [
        `${orderStoreLabel(e.store)} ${periodText(e)}`.padEnd(14),
        e.name.padEnd(18),
        (e.erpId ?? "ERP 없음").padEnd(8),
        e.key.startsWith("erp:") ? "캘린더 없음" : "",
        e.storeMismatch ? "매장 다름" : "",
        ((d) => (d < 0 ? `D+${-d}` : `D-${d}`))(daysBetween(today, e.from)),
        ORDER_STAGE_LABEL[st],
        lead,
        key ? `→ 알림 ${key.split("¦")[1]}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
  const r = await runOrderAlert(db, { today, dryRun: !process.argv.includes("--run") });
  console.log(`\n${process.argv.includes("--run") ? "실행" : "미리 보기"}:`, JSON.stringify(r, null, 2));
  process.exit(0);
})();
