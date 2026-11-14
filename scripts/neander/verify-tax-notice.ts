// ============================================================
//  세금 고지서 실검증 — 넣기 → 노션 「돈 나가는 날」 줄 → 무시하면 줄 치움 → 시험 문서 지움
// ------------------------------------------------------------
//    npm run finance:verify-tax-notice
//  멘션(폰 알림)은 보내지 않는다 (announce: false · mention: false).
//  시험 고지서는 금액 1원 · 사업자 없음 · 출처 verify: 로 넣고 끝에 지운다.
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { announceTaxNotice, ingestTaxText } from "@/lib/neander/finance/server/tax-notice";
import { moneyCall } from "@/lib/neander/finance/server/money-calendar";
import { sanitizeMoneySettings } from "@/lib/neander/finance/money-calendar";

let failed = 0;
const ok = (cond: boolean, label: string, detail?: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failed += 1;
};

(async () => {
  const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64!, "base64").toString("utf8"));
  if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
  const db = getFirestore();
  const s = sanitizeMoneySettings((await db.collection(NEANDER_COL.finSettings).doc("money-calendar").get()).data());
  const rowsOf = async (prefix: string) => {
    const res = await moneyCall<{ results: { id: string; in_trash?: boolean; properties: Record<string, { rich_text?: { plain_text: string }[]; date?: { start: string } }> }[] }>(
      "POST",
      `/data_sources/${s.dataSourceId}/query`,
      { filter: { property: "열쇠", rich_text: { starts_with: prefix } } },
    );
    return res.results.filter((p) => !p.in_trash);
  };

  const stamp = Date.now();
  const r = await ingestTaxText(db, {
    text: `[국세청] 시험 고지서입니다 (ERP 검증 ${stamp}). 세목: 인지세 납부할 세액: 1원 납부기한: 2026.12.24`,
    from: "verify",
    source: "sms",
    sourceId: `verify:${stamp}`,
    announce: false,
  });
  ok(r.kind === "notice" && !!r.id && r.created === true, "알림 글 → 고지서 한 장", JSON.stringify(r));
  const id = r.id!;
  const again = await ingestTaxText(db, { text: "같은 알림", from: "verify", source: "sms", sourceId: `verify:${stamp}`, announce: false });
  ok(again.kind === null || again.created !== true, "같은 출처는 두 번 안 넣는다");

  const doc = (await db.collection(NEANDER_COL.finTaxNotices).doc(id).get()).data()!;
  ok(doc.amount === 1 && doc.dueDate === "2026-12-24" && doc.item === "인지세", "금액 · 납기 · 세목", `${doc.amount} ${doc.dueDate} ${doc.item}`);

  const a1 = await announceTaxNotice(db, id, { mention: false });
  ok(a1.row === "created" && !a1.error, "노션 줄 만듦", JSON.stringify(a1));
  const ruleId = `tax-${id.toLowerCase()}`;
  let rows = await rowsOf(`${ruleId}¦`);
  ok(rows.length === 1 && rows[0].properties.날짜?.date?.start === "2026-12-24", "줄 하나 · 날짜 12/24");

  // 납기를 바꾸면 옛 줄은 치우고 새 줄
  await db.collection(NEANDER_COL.finTaxNotices).doc(id).update({ dueDate: "2026-12-28" });
  const a2 = await announceTaxNotice(db, id, { mention: false });
  rows = await rowsOf(`${ruleId}¦`);
  ok(a2.trashed === 1 && rows.length === 1 && rows[0].properties.날짜?.date?.start === "2026-12-28", "납기 바꿈 → 옛 줄 치우고 새 줄", JSON.stringify(a2));

  // 무시하면 줄이 없어진다
  await db.collection(NEANDER_COL.finTaxNotices).doc(id).update({ state: "dismissed" });
  const a3 = await announceTaxNotice(db, id, { mention: false });
  rows = await rowsOf(`${ruleId}¦`);
  ok(rows.length === 0 && a3.trashed === 1, "무시 → 줄 치움", JSON.stringify(a3));

  await db.collection(NEANDER_COL.finTaxNotices).doc(id).delete();
  const inbox = await db.collection(NEANDER_COL.finTaxNotices).where("sourceId", "==", `verify:${stamp}`).get();
  ok(inbox.empty, "시험 문서 지움");

  console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
  process.exit(failed ? 1 : 0);
})();
