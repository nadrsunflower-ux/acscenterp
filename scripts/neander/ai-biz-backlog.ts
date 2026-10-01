// ============================================================
//  사업구분만 빈 대기 건에 AI 로 사업구분을 제안한다
// ------------------------------------------------------------
//  검토 대기함에 쌓인 「계정은 있는데 사업구분만 비어 있는」 거래를 모델에
//  물어, **확신 80% 이상만** 제안으로 올린다 (server/ai-biz.ts).
//  나머지는 건드리지 않는다 — 모델도 모르는 것을 그럴듯하게 채우지 않는다.
//
//  두 단계로 나뉜다. 모델을 부르는 일(돈이 든다)과 장부에 쓰는 일을 섞지
//  않기 위해서다.
//
//    ① 묻기   결과를 output/finance-ai-biz/ (깃 밖)에 쌓는다. 장부는 그대로.
//             도중에 끊겨도 같은 파일을 주면 이어서 묻는다.
//    ② 쓰기   그 파일을 읽어 확신 80% 이상만 「제안됨」 으로 쓴다. 모델을 다시
//             부르지 않는다. 그 사이 사람이 처리한 건은 건너뛴다.
//
//    npm run finance:ai-biz -- --limit 120                     120건만 묻기 (맛보기)
//    npm run finance:ai-biz                                    남은 건 전부 묻기
//    npm run finance:ai-biz -- --resume <결과파일>             이어서 묻기
//    npm run finance:ai-biz -- --apply <결과파일>              장부에 쓰기 (제안으로)
//    npm run finance:ai-biz -- --undo <되돌리기파일>           쓴 것 되돌리기
//
//  ⚠️ 확정은 만들지 않는다. 사유에 「AI 추천(사업구분 · 확신 N%)」 이 남는다.
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  AI_BIZ_BATCH,
  AI_BIZ_MIN_CONFIDENCE,
  suggestBizUnits,
  type BizSuggestion,
} from "@/lib/neander/finance/server/ai-biz";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY_FILE = arg("--apply");
const UNDO_FILE = arg("--undo");
const RESUME_FILE = arg("--resume");
const LIMIT = Number(arg("--limit") ?? Infinity);
/** 한꺼번에 부르는 묶음 수 */
const PARALLEL = 3;
const BATCH = 400;
const BY = "script:ai-biz";
const DIR = path.join("output", "finance-ai-biz");

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

interface Saved {
  model: string;
  costUsd: number;
  /** 물어본 거래 id (답이 버려졌어도 다시 묻지 않는다) */
  asked: string[];
  suggestions: (BizSuggestion & { date: string; vendor?: string; acctMinor?: string; memo?: string; amount: number })[];
}

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

/** 계정은 있는데 사업구분만 빈 대기 건 */
const isTarget = (t: FinTransaction) => t.status !== "confirmed" && !!t.acctMinor && !t.bizMajor;

function summarize(saved: Saved) {
  const band = (c: number) => (c >= 0.9 ? "90%+" : c >= 0.8 ? "80~89%" : c >= 0.7 ? "70~79%" : c >= 0.5 ? "50~69%" : "50% 미만");
  const count = new Map<string, number>();
  saved.suggestions.forEach((s) => count.set(band(s.confidence), (count.get(band(s.confidence)) ?? 0) + 1));
  console.log(`\n물어본 것 ${saved.asked.length}건 · 답 ${saved.suggestions.length}건 · 비용 $${saved.costUsd.toFixed(2)} · 모델 ${saved.model}`);
  ["90%+", "80~89%", "70~79%", "50~69%", "50% 미만"].forEach((b) => console.log(`  확신 ${b.padEnd(8)} ${String(count.get(b) ?? 0).padStart(4)}건`));
  const usable = saved.suggestions.filter((s) => s.confidence >= AI_BIZ_MIN_CONFIDENCE);
  console.log(`\n제안으로 올릴 것(확신 ${AI_BIZ_MIN_CONFIDENCE * 100}% 이상) ${usable.length}건 ${fmt(usable.reduce((n, s) => n + s.amount, 0))}원`);
  const byAcct = new Map<string, { n: number; to: Map<string, number> }>();
  usable.forEach((s) => {
    const r = byAcct.get(s.acctMinor ?? "") ?? { n: 0, to: new Map<string, number>() };
    r.n += 1;
    r.to.set(s.bizMinor, (r.to.get(s.bizMinor) ?? 0) + 1);
    byAcct.set(s.acctMinor ?? "", r);
  });
  [...byAcct.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([k, r]) =>
      console.log(`  ${k.padEnd(12)} ${String(r.n).padStart(4)}건 → ${[...r.to.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${n}`).join(" · ")}`),
    );
}

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finTransactions);

  // ---- 되돌리기 ----
  if (UNDO_FILE) {
    const saved = JSON.parse(readFileSync(UNDO_FILE, "utf8")) as { id: string; before: Record<string, string | undefined> }[];
    console.log(`${UNDO_FILE} — ${saved.length}건을 되돌립니다.`);
    const now = Date.now();
    for (let i = 0; i < saved.length; i += BATCH) {
      const b = db.batch();
      saved.slice(i, i + BATCH).forEach(({ id, before }) => {
        const patch: Record<string, unknown> = { updatedAt: now, updatedBy: `${BY}:undo` };
        ["status", "bizMajor", "bizMinor", "classReason"].forEach((f) => (patch[f] = before[f] ?? FieldValue.delete()));
        b.set(col.doc(id), patch, { merge: true });
      });
      await b.commit();
    }
    console.log("완료.");
    process.exit(0);
  }

  const [txSnap, pmSnap] = await Promise.all([col.get(), db.collection(NEANDER_COL.finPaymentMethods).get()]);
  const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];
  const byId = new Map(all.map((t) => [t.id, t]));

  // ---- ② 쓰기 ----
  if (APPLY_FILE) {
    const saved = JSON.parse(readFileSync(APPLY_FILE, "utf8")) as Saved;
    summarize(saved);
    const usable = saved.suggestions.filter((s) => s.confidence >= AI_BIZ_MIN_CONFIDENCE);
    // 그 사이 사람이 처리한 건(확정했거나 사업구분을 채운 건)은 건너뛴다
    const plan = usable.map((s) => ({ s, t: byId.get(s.id) })).filter((x): x is { s: (typeof usable)[number]; t: FinTransaction } => !!x.t && isTarget(x.t));
    console.log(`\n지금도 대상인 것 ${plan.length}건 (그 사이 처리된 것 ${usable.length - plan.length}건은 건너뜀)`);
    if (plan.length === 0) process.exit(0);
    mkdirSync(DIR, { recursive: true });
    const backup = path.join(DIR, `before-${stamp()}.json`);
    writeFileSync(
      backup,
      JSON.stringify(plan.map(({ t }) => ({ id: t.id, before: { status: t.status, bizMajor: t.bizMajor, bizMinor: t.bizMinor, classReason: t.classReason } })), null, 1),
    );
    console.log(`바꾸기 전 값 → ${backup}`);
    const now = Date.now();
    for (let i = 0; i < plan.length; i += BATCH) {
      const b = db.batch();
      plan.slice(i, i + BATCH).forEach(({ s, t }) => {
        b.set(
          col.doc(t.id),
          {
            bizMajor: s.bizMajor,
            bizMinor: s.bizMinor,
            status: "suggested",
            // 「사업구분이 비어 있습니다」 는 이제 사실이 아니라 바꾼다. 다른 사유(어댑터의
            // 「계좌간 이동으로 추정 — 아니면 유형을 바꿔주세요」 등)는 지우지 않고 덧붙인다.
            classReason: /^사업구분이 비어/.test(t.classReason ?? "") || !t.classReason
              ? `AI 추천(사업구분 · 확신 ${Math.round(s.confidence * 100)}%) — ${s.reason}`
              : `${t.classReason} / 사업구분은 AI 추천(확신 ${Math.round(s.confidence * 100)}%) — ${s.reason}`,
            updatedAt: now,
            updatedBy: BY,
          },
          { merge: true },
        );
      });
      await b.commit();
      console.log(`  ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
    }
    console.log(`\n완료 — ${plan.length}건을 제안으로 올렸습니다. 되돌리려면: npm run finance:ai-biz -- --undo ${backup}`);
    process.exit(0);
  }

  // ---- ① 묻기 ----
  mkdirSync(DIR, { recursive: true });
  const file = RESUME_FILE ?? path.join(DIR, `results-${stamp()}.json`);
  const saved: Saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { model: "", costUsd: 0, asked: [], suggestions: [] };
  const asked = new Set(saved.asked);
  const targets = all
    .filter(isTarget)
    .filter((t) => !asked.has(t.id))
    // 최근 것부터 — 지금 달 마감에 가까운 것이 먼저다
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, LIMIT);
  console.log(`사업구분만 빈 대기 건 ${all.filter(isTarget).length}건 · 이미 물어본 것 ${asked.size}건 · 이번에 물어볼 것 ${targets.length}건 (${Math.ceil(targets.length / AI_BIZ_BATCH)}묶음)`);
  console.log(`결과 파일: ${file}`);

  const chunks: FinTransaction[][] = [];
  for (let i = 0; i < targets.length; i += AI_BIZ_BATCH) chunks.push(targets.slice(i, i + AI_BIZ_BATCH));
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const results = await Promise.allSettled(
      chunks.slice(i, i + PARALLEL).map((chunk) => suggestBizUnits({ items: chunk, history: all, paymentMethods }).then((r) => ({ chunk, r }))),
    );
    results.forEach((res) => {
      if (res.status === "rejected") {
        console.log(`  ⚠️ 한 묶음 실패 — ${res.reason instanceof Error ? res.reason.message : res.reason} (이어서 묻기로 다시 시도)`);
        return;
      }
      const { chunk, r } = res.value;
      saved.model = r.model;
      saved.costUsd += r.usage.costUsd ?? 0;
      chunk.forEach((t) => saved.asked.push(t.id));
      r.suggestions.forEach((s) => {
        const t = byId.get(s.id)!;
        saved.suggestions.push({ ...s, date: t.date, vendor: t.vendor, acctMinor: t.acctMinor, memo: t.acctNote, amount: netAmount(t) });
      });
    });
    writeFileSync(file, JSON.stringify(saved, null, 1));
    console.log(`  ${Math.min((i + PARALLEL) * AI_BIZ_BATCH, targets.length)}/${targets.length} · 누적 $${saved.costUsd.toFixed(2)}`);
  }
  summarize(saved);
  console.log(`\n※ 장부는 그대로입니다. 쓰려면: npm run finance:ai-biz -- --apply ${file}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
