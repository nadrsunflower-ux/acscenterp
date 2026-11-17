// 부재중 전화 알림이 노션 · 폰까지 가는지 — 가짜 번호 한 통을 보낸다
//   npx tsx --conditions=react-server scripts/neander/test-missed-call.ts [--keep]
// 끝나면 Firestore 기록은 지운다(30일 횟수에 안 섞이게). 노션 줄은 남긴다(--keep 없으면 휴지통으로).
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { adminDb } = await import("@/lib/neander/server/admin");
  const { saveMissedCall, notifyMissedCall } = await import("@/lib/neander/phone/server/missed-call");
  const { moneyCall } = await import("@/lib/neander/finance/server/money-calendar");
  const { NEANDER_COL } = await import("@/lib/neander/collections");
  const db = adminDb();
  const r = await saveMissedCall(db, { number: "010-0000-0000", name: "ERP 연결 확인(시험)" });
  console.log("저장", r.id, r.duplicate ? "(이미 있음)" : "");
  const out = await notifyMissedCall(db, r.id);
  console.log("노션", out);
  const snap = await db.collection(NEANDER_COL.phoneCalls).doc(r.id).get();
  const pageId = snap.get("notify.pageId");
  console.log("줄", pageId, "멘션", snap.get("notify.mode"));
  const s = await db.collection(NEANDER_COL.finSettings).doc("missed-call").get();
  console.log("표", s.get("table")?.url, "받는 사람 수", (s.get("userIds") ?? []).length);
  await snap.ref.delete();
  if (pageId && !process.argv.includes("--keep")) {
    await moneyCall("PATCH", `/pages/${pageId}`, { in_trash: true });
    console.log("시험 줄을 휴지통으로 옮김");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
