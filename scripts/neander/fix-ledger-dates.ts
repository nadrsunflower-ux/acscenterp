// ============================================================
//  이관 장부의 거래일 바로잡기 — 하루 이르게 들어간 날짜
// ------------------------------------------------------------
//  엑셀 통합거래장의 날짜 칸이 **글자가 아니라 날짜 값**이면, 임포트가 그 값을
//  UTC 로 잘라 날짜를 만들었다 (xlsx.ts 의 toDateStr — 2026-10-02 에 고침).
//  한국 시간 0시~9시 사이의 값은 UTC 로는 전날이라, 날짜만 적힌 칸(0시)은 전부,
//  시각이 적힌 칸은 새벽 거래가 하루 이르게 들어갔다.
//
//      엑셀      2025-02-25            (날짜만)
//      datetime  2025-02-24T15:00:00.000Z   ← 맞는 시각 (한국 시간 25일 0시)
//      date      2025-02-24                 ← 틀림. 25일이어야 한다
//
//  고치는 규칙: 저장된 datetime(ISO)을 초 단위로 반올림해 **한국 날짜**로.
//  반올림이 필요한 이유 — 엑셀 날짜는 소수라 `…T14:59:59.999Z` 처럼 1ms 모자라게
//  읽히는 칸이 있다. 그건 다음 날 0시다.
//
//  2026-10-02 에 원본 엑셀 6개(2025 통합거래장 v9 · 2602~2606 월 장부)의 날짜
//  직렬값과 장부 9,543건을 전건 대조해 이 규칙이 원본과 한 건도 어긋나지 않음을
//  확인하고 4,472건을 고쳤다 (337건은 달이 바뀐다 — 1일 거래가 전달 말일에 있었다).
//
//  함께 고치는 것:
//    dedupHash — 중복 검사 키가 날짜로 시작한다. 날짜만 바꾸면 같은 파일을 다시
//                올렸을 때 중복으로 못 알아본다. 키의 날짜 부분도 같이 바꾼다
//    updatedAt — 지금. 화면의 증분 동기화가 바로 받아 가게
//  datetime 은 건드리지 않는다 — 맞는 값이고, 그것이 이 스크립트의 근거다
//  (그래서 다시 돌려도 더 고칠 것이 없다).
//
//    npm run finance:fix-dates                 (미리보기 — 아무것도 쓰지 않는다)
//    npm run finance:fix-dates -- --apply      (고치기 전 값을 output/ 에 남기고 적용)
//    npm run finance:fix-dates -- --undo <output/finance-fix-dates/before-….json>
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { netAmount, PL_TX_TYPES, type FinTransaction } from "@/lib/neander/finance/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const UNDO = arg("--undo");
const BATCH = 400;
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

interface Backup {
  at: number;
  rows: { id: string; date: string; dedupHash?: string }[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** ISO 시각 → 한국 날짜 (초 단위로 반올림한 뒤) */
export function kstDateOf(iso: string): string {
  const ms = Math.round(Date.parse(iso) / 1000) * 1000;
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
}

/** 달별 건수·수입·지출 — 손익에 잡히는 거래만 금액에 넣는다 */
function byMonth(rows: FinTransaction[], dateOf: (t: FinTransaction) => string) {
  const out = new Map<string, { count: number; income: number; expense: number }>();
  rows.forEach((t) => {
    const m = dateOf(t).slice(0, 7);
    const cur = out.get(m) ?? { count: 0, income: 0, expense: 0 };
    cur.count += 1;
    if (PL_TX_TYPES.includes(t.txType)) {
      if (t.txType === "수입") cur.income += netAmount(t);
      else if (t.txType === "지출") cur.expense += netAmount(t);
      else cur.expense -= netAmount(t); // 환급은 지출에서 뺀다
    }
    out.set(m, cur);
  });
  return out;
}

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finTransactions);
  const now = Date.now();

  // ---- 되돌리기 ----
  if (UNDO) {
    const saved = JSON.parse(readFileSync(UNDO, "utf8")) as Backup;
    console.log(`${UNDO} — ${saved.rows.length}건의 날짜를 고치기 전으로 되돌립니다.`);
    for (let i = 0; i < saved.rows.length; i += BATCH) {
      const wb = db.batch();
      saved.rows.slice(i, i + BATCH).forEach((r) =>
        wb.update(col.doc(r.id), { date: r.date, ...(r.dedupHash !== undefined ? { dedupHash: r.dedupHash } : {}), updatedAt: now }),
      );
      await wb.commit();
    }
    console.log("되돌렸습니다.");
    return;
  }

  const snap = await col.get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinTransaction);
  const fixed = new Map<string, string>();
  all.forEach((t) => {
    if (!t.datetime || !ISO.test(t.datetime)) return;
    const right = kstDateOf(t.datetime);
    if (right !== t.date) fixed.set(t.id, right);
  });
  const targets = all.filter((t) => fixed.has(t.id));
  const newDate = (t: FinTransaction) => fixed.get(t.id) ?? t.date;

  console.log(`장부 ${all.length}건 중 날짜가 한국 날짜와 다른 거래 ${targets.length}건`);
  if (targets.length === 0) {
    console.log("고칠 것이 없습니다.");
    return;
  }
  const dayMs = 86400_000;
  const gaps = new Map<number, number>();
  targets.forEach((t) => {
    const g = Math.round((Date.parse(newDate(t)) - Date.parse(t.date)) / dayMs);
    gaps.set(g, (gaps.get(g) ?? 0) + 1);
  });
  console.log("  날짜 차이:", [...gaps].map(([g, n]) => `${g > 0 ? "+" : ""}${g}일 ${n}건`).join(" · "));
  console.log(
    `  달이 바뀌는 것 ${targets.filter((t) => newDate(t).slice(0, 7) !== t.date.slice(0, 7)).length}건 · ` +
      `날짜만 적힌 칸 ${targets.filter((t) => t.datetime!.endsWith("T15:00:00.000Z")).length}건 · ` +
      `시각이 적힌 새벽 거래 ${targets.filter((t) => !t.datetime!.endsWith("T15:00:00.000Z")).length}건`,
  );
  // 하루가 아닌 차이는 이 버그가 아니다 — 사람이 날짜를 직접 고친 행일 수 있어 멈춘다
  if ([...gaps.keys()].some((g) => g !== 1)) {
    console.log("\n하루가 아닌 차이가 있습니다. 누가 날짜를 직접 고친 행일 수 있어 멈춥니다. 아무것도 쓰지 않았습니다.");
    process.exit(1);
  }
  const badHash = targets.filter((t) => t.dedupHash && !t.dedupHash.startsWith(`${t.date}¦`));
  if (badHash.length > 0) console.log(`  ⚠ 중복 키가 옛 날짜로 시작하지 않는 거래 ${badHash.length}건 — 날짜만 고치고 키는 둡니다`);

  const before = byMonth(all, (t) => t.date);
  const after = byMonth(all, newDate);
  console.log("\n달별 변화 (건수 · 수입 · 지출) — 바뀌는 달만");
  [...new Set([...before.keys(), ...after.keys()])].sort().forEach((m) => {
    const b = before.get(m) ?? { count: 0, income: 0, expense: 0 };
    const a = after.get(m) ?? { count: 0, income: 0, expense: 0 };
    if (b.count === a.count && b.income === a.income && b.expense === a.expense) return;
    const d = (x: number, y: number) => (y === x ? "" : ` (${y > x ? "+" : ""}${fmt(y - x)})`);
    console.log(
      `  ${m}  ${String(b.count).padStart(4)} → ${String(a.count).padStart(4)}건` +
        `  수입 ${fmt(a.income).padStart(13)}${d(b.income, a.income)}` +
        `  지출 ${fmt(a.expense).padStart(13)}${d(b.expense, a.expense)}`,
    );
  });

  if (!APPLY) {
    console.log("\n미리보기입니다. 실제로 고치려면 --apply");
    return;
  }

  const dir = path.join("output", "finance-fix-dates");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `before-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`);
  const backup: Backup = { at: now, rows: targets.map((t) => ({ id: t.id, date: t.date, dedupHash: t.dedupHash })) };
  writeFileSync(file, JSON.stringify(backup));
  console.log(`\n고치기 전 값을 ${file} 에 남겼습니다.`);

  for (let i = 0; i < targets.length; i += BATCH) {
    const wb = db.batch();
    targets.slice(i, i + BATCH).forEach((t) => {
      const date = newDate(t);
      const patch: Record<string, string | number> = { date, updatedAt: now };
      if (t.dedupHash?.startsWith(`${t.date}¦`)) patch.dedupHash = date + t.dedupHash.slice(t.date.length);
      wb.update(col.doc(t.id), patch);
    });
    await wb.commit();
    console.log(`  ${Math.min(i + BATCH, targets.length)} / ${targets.length}`);
  }
  console.log(`${targets.length}건을 고쳤습니다. 되돌리려면: npm run finance:fix-dates -- --undo ${file}`);
})();
