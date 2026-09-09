// ============================================================
//  장부 엑셀 → Firestore 적재 (CLI)
// ------------------------------------------------------------
//  임포트 화면과 **같은 파서·같은 자동분류**를 쓰되, 브라우저를 거치지
//  않고 Admin SDK 로 직접 넣는다. 여러 달치를 한 번에 밀어넣거나
//  브라우저에서 막혔을 때 쓰는 경로다.
//
//    npm run finance:import -- <장부.xlsx> [--dry] [--until YYYY-MM-DD]
//
//  --dry 를 붙이면 무엇이 들어갈지만 보여주고 쓰지 않는다.
//  --until 은 그 날짜 이후의 행을 걸러낸다 — 연말결산 통합본처럼
//  다음 해 첫 며칠이 섞여 들어간 파일을 이미 적재된 기간과 겹치지
//  않게 자를 때 쓴다.
//  적재분은 임포트 이력에 배치로 남으므로 화면에서 '되돌리기' 가능.
// ============================================================

import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import * as XLSX from "xlsx";
import path from "path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { parseWorkbook } from "../../lib/neander/finance/xlsx";
import { buildVendorIndex, classifyOne, summarize } from "../../lib/neander/finance/classify";
import { NEANDER_COL } from "../../lib/neander/collections";
import type { FinTransaction } from "../../lib/neander/finance/types";
import type { FinPaymentMethodDoc, FinVendorRuleDoc } from "../../lib/neander/finance/db-types";

const BATCH_LIMIT = 450;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

function initAdmin() {
  if (getApps().length) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.error(
      "FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다. .env.local 을 읽으려면 " +
        "`npm run finance:import` 로 실행하세요 (dotenv 로 주입됩니다).",
    );
    process.exit(1);
  }
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const untilIdx = args.indexOf("--until");
  const until = untilIdx >= 0 ? args[untilIdx + 1] : undefined;
  if (untilIdx >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(until ?? "")) {
    console.error("--until 은 YYYY-MM-DD 형식이어야 합니다.");
    process.exit(1);
  }
  // `--until` 이 없으면 untilIdx 는 -1 이라 untilIdx + 1 이 0 이 된다.
  // 그대로 비교하면 **첫 인자(파일 경로)를 건너뛴다** — `--until` 없이
  // 실행하면 늘 "사용법" 만 뜨던 이유다.
  const untilValueIdx = untilIdx >= 0 ? untilIdx + 1 : -1;
  const file = args.find((a, i) => !a.startsWith("--") && i !== untilValueIdx);
  if (!file) {
    console.error("사용법: npm run finance:import -- <장부.xlsx> [--dry] [--until YYYY-MM-DD]");
    process.exit(1);
  }

  initAdmin();
  const db = getFirestore();

  console.log(`파일: ${file}${dry ? "  (모의 실행 — 쓰지 않음)" : ""}\n`);
  const parsed = parseWorkbook(XLSX.readFile(file, { cellDates: true }));
  console.log(`시트 ${parsed.sheetName} · 헤더 ${parsed.headerRowNo}행`);
  console.log(`읽은 거래 ${parsed.rows.length}건 · 오류 ${parsed.errors.length}건`);
  parsed.errors.slice(0, 10).forEach((e) => console.log(`   ⚠️  ${e.rowNo}행 — ${e.reason}`));
  if (until) {
    const before = parsed.rows.length;
    parsed.rows = parsed.rows.filter((r) => r.date <= until);
    console.log(`--until ${until} — ${before - parsed.rows.length}건 잘라냄`);
  }
  if (parsed.rows.length === 0) process.exit(1);

  // 기존 데이터 — 중복 판정과 자동분류 이력의 근거
  const [txSnap, pmSnap, ruleSnap] = await Promise.all([
    db.collection(NEANDER_COL.finTransactions).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
    db.collection(NEANDER_COL.finVendorRules).get(),
  ]);
  const existing = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];
  const vendorRules = ruleSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinVendorRuleDoc[];
  console.log(`\n기존 거래 ${existing.length}건 · 계좌 ${paymentMethods.length} · 규칙 ${vendorRules.length}`);

  // 중복은 키 존재가 아니라 **건수**로 판정한다 (같은 날 같은 거래처에
  // 같은 금액이 실제로 두 번 청구되는 일이 있다)
  const existingCounts = new Map<string, number>();
  existing.forEach((t) => {
    if (t.dedupHash) existingCounts.set(t.dedupHash, (existingCounts.get(t.dedupHash) ?? 0) + 1);
  });

  const vendorIndex = buildVendorIndex(existing);
  const seen = new Map<string, number>();
  const fresh: { row: (typeof parsed.rows)[number]; sug: ReturnType<typeof classifyOne> }[] = [];
  let dup = 0;

  for (const row of parsed.rows) {
    const nth = seen.get(row.dedupHash) ?? 0;
    seen.set(row.dedupHash, nth + 1);
    if (nth < (existingCounts.get(row.dedupHash) ?? 0)) {
      dup++;
      continue;
    }
    fresh.push({ row, sug: classifyOne(row, { vendorIndex, vendorRules, paymentMethods }) });
  }

  const sum = summarize(fresh.map((f) => f.sug));
  console.log(`\n새로 적재 ${fresh.length}건 · 중복 건너뜀 ${dup}건`);
  console.log(
    `자동분류 — 확정 ${sum.confirmed} · 제안됨 ${sum.suggested} · 검토필요 ${sum.needsReview}` +
      ` (자동확정률 ${Math.round(sum.autoRate * 100)}%)`,
  );

  let income = 0;
  let expense = 0;
  fresh.forEach(({ row }) => {
    const n = (row.gross || 0) - (row.adjust || 0);
    if (row.txType === "수입") income += n;
    else if (row.txType === "지출") expense += n;
  });
  console.log(`수입 ${won(income)} · 지출 ${won(expense)}`);

  if (dry) {
    console.log("\n(모의 실행이라 여기서 끝냅니다)");
    process.exit(0);
  }
  if (fresh.length === 0) {
    console.log("\n적재할 새 거래가 없습니다.");
    process.exit(0);
  }

  // 임포트 배치 — 잘못 넣었을 때 화면에서 통째로 되돌릴 수 있게 한다
  const batchRef = await db.collection(NEANDER_COL.finImports).add({
    fileName: path.basename(file),
    inserted: fresh.length,
    skipped: dup,
    byEmail: "cli",
    createdAt: Date.now(),
  });

  const now = Date.now();
  const rows = fresh.map(({ row, sug }) => {
    const doc: Record<string, unknown> = {
      date: row.date,
      datetime: row.datetime,
      last4: row.last4,
      txType: row.txType,
      bizMajor: sug.bizMajor,
      bizMinor: sug.bizMinor,
      acctMajor: sug.acctMajor,
      acctMid: sug.acctMid,
      acctMinor: sug.acctMinor,
      vendor: row.vendor,
      acctNote: row.acctNote,
      personalUse: row.personalUse,
      projectCode: row.projectCode,
      gross: row.gross,
      adjust: row.adjust,
      site: sug.site,
      note: row.note,
      status: sug.status,
      classReason: sug.classReason,
      refundMatchId: row.refundMatchId,
      dedupHash: row.dedupHash,
      importBatchId: batchRef.id,
      createdAt: now,
    };
    Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);
    return doc;
  });

  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    rows.slice(i, i + BATCH_LIMIT).forEach((r) => {
      batch.set(db.collection(NEANDER_COL.finTransactions).doc(), r);
    });
    await batch.commit();
    console.log(`  적재 ${Math.min(i + BATCH_LIMIT, rows.length)}/${rows.length}`);
  }

  console.log(`\n✅ ${fresh.length}건 적재 완료 (배치 ${batchRef.id})`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
