// ============================================================
//  검토 대기함을 지금 엔진으로 다시 분류한다
// ------------------------------------------------------------
//  자동분류 엔진(classify.ts)을 고치면 **앞으로 올리는 파일**만 좋아진다.
//  이미 대기함에 들어와 있는 거래는 옛 엔진이 붙여 둔 제안을 그대로 들고
//  있다 — 「유재영 과거 101건 중 31%」 같은, 맞는 것보다 틀리는 것이 많은
//  제안들이다. 이 스크립트가 그 행들을 지금 엔진으로 다시 돌린다.
//
//  손대는 것 — **엔진이 스스로 붙인 분류만**:
//    · 사유가 「거래처 「…」 …」 로 시작하는 대기함 행 (이력 · 이력 없음)
//
//  손대지 않는 것:
//    · 확정된 거래
//    · 사람이 고친 흔적(updatedBy 가 팀원)이 있는 행 — 대기함에서 계정만
//      골라 두고 아직 확정을 안 누른 행을 덮어쓰면 안 된다
//    · 어댑터가 판정한 행 (카드대금 · 계좌간 이동 · 이자입금) — 엑셀의 적요를
//      근거로 한 것이라 이력보다 구체적이다
//    · 사업구분만 비어서 온 행, AI 추천을 적용한 행, 이관 스크립트가 보낸 행
//
//  ⚠️ **확정은 만들지 않는다.** 엔진이 확정이라고 해도 「제안됨」 으로 둔다.
//     파일을 올릴 때의 확정은 미리보기에서 사람이 보고 넘긴 것이지만, 이건
//     아무도 안 보는 사이에 도는 일괄 작업이다.
//
//  바꾸기 전 값은 output/ (깃 밖)에 떠 둔다. 잘못됐으면 그 파일로 되돌린다.
//
//    npm run finance:reclassify-pending                    미리보기
//    npm run finance:reclassify-pending -- --apply         적용
//    npm run finance:reclassify-pending -- --audit         옛 엔진이 자동 확정한 행을 지금 엔진과 대조 (보기만)
//    npm run finance:reclassify-pending -- --undo <파일>   떠 둔 값으로 되돌리기
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { buildVendorIndex, classifyOne } from "@/lib/neander/finance/classify";
import { ENGINE_REASON, engineSigOf, ledgerPartial } from "@/lib/neander/finance/relearn";
import { netAmount, type FinTransaction, type TxType } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc, FinVendorRuleDoc } from "@/lib/neander/finance/db-types";
import type { FinClassRuleDoc } from "@/lib/neander/finance/class-rules";

const APPLY = process.argv.includes("--apply");
const AUDIT = process.argv.includes("--audit");
const undoIdx = process.argv.indexOf("--undo");
const UNDO_FILE = undoIdx >= 0 ? process.argv[undoIdx + 1] : undefined;
const BATCH = 400;
const BY = "script:reclassify-pending";

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 옛 엔진이 거래유형을 고쳐 놓은 행 — 은행이 알려준 원래 유형을 사유에서 되찾는다 */
const TYPE_FIXED = /거래유형을 (\S+) 에서 (\S+) 로 고쳐 제안/;

/** 분류에 해당하는 필드 — 이것만 읽고 쓴다 */
const FIELDS = ["status", "txType", "acctMajor", "acctMid", "acctMinor", "bizMajor", "bizMinor", "classReason", "engineSig"] as const;
type Field = (typeof FIELDS)[number];
type Snapshot = Partial<Record<Field, string>>;

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

const snapshotOf = (t: FinTransaction): Snapshot =>
  Object.fromEntries(FIELDS.filter((f) => t[f] !== undefined).map((f) => [f, t[f] as string]));

const acctLabel = (s: Snapshot) => (s.acctMinor ? `${s.acctMinor}${s.bizMinor ? `·${s.bizMinor}` : ""}` : "(없음)");

/** 사람이 고친 행인가 — 스크립트가 남긴 표시는 사람이 아니다 */
const touchedByHuman = (t: FinTransaction) => !!t.updatedBy && !/^(script:|fix-)/.test(t.updatedBy);

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finTransactions);

  // ---- 되돌리기 ----
  if (UNDO_FILE) {
    const saved = JSON.parse(readFileSync(UNDO_FILE, "utf8")) as { id: string; before: Snapshot }[];
    console.log(`${UNDO_FILE} — ${saved.length}건을 떠 둔 값으로 되돌립니다.`);
    const now = Date.now();
    for (let i = 0; i < saved.length; i += BATCH) {
      const b = db.batch();
      saved.slice(i, i + BATCH).forEach(({ id, before }) => {
        const patch: Record<string, unknown> = { updatedAt: now, updatedBy: `${BY}:undo` };
        FIELDS.forEach((f) => (patch[f] = before[f] ?? FieldValue.delete()));
        b.set(col.doc(id), patch, { merge: true });
      });
      await b.commit();
    }
    console.log("완료.");
    process.exit(0);
  }

  const [txSnap, acctSnap, pmSnap, ruleSnap, classRuleSnap] = await Promise.all([
    col.get(),
    db.collection(NEANDER_COL.finAccounts).get(),
    db.collection(NEANDER_COL.finPaymentMethods).get(),
    db.collection(NEANDER_COL.finVendorRules).get(),
    db.collection(NEANDER_COL.finClassRules).get(),
  ]);
  const all = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const accounts = acctSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[];
  const paymentMethods = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[];
  const vendorRules = ruleSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinVendorRuleDoc[];
  // 사람이 정해 둔 분류 규칙 — 대기함에 이미 있던 거래에도 닿게 한다 (class-rules.ts)
  const classRules = classRuleSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinClassRuleDoc[];

  // 확정된 거래가 곧 학습 자료다 (대기함 행은 색인에 들어가지 않는다)
  const vendorIndex = buildVendorIndex(all);
  const classify = (t: FinTransaction, txType: TxType) =>
    classifyOne(
      {
        vendor: t.vendor,
        last4: t.last4,
        txType,
        gross: t.gross,
        adjust: t.adjust,
        site: t.site,
        // 단톡방 카드 기록 · 프로젝트 — 결제대행사 이름으로는 모르는 것을 말해 준다 (card-chat.ts)
        cardMemo: t.cardMemo,
        projectCode: t.projectCode,
        // 원본 장부에 사람이 적어 둔 대분류·중분류 (relearn.ts)
        ...ledgerPartial(t),
      },
      { vendorIndex, vendorRules, paymentMethods, accounts, classRules },
    );

  // ---- 대조만: 옛 엔진이 자동 확정한 행을 지금 엔진은 어떻게 보는가 ----
  if (AUDIT) {
    const auto = all.filter(
      (t) => t.status === "confirmed" && /^거래처 「.*」 과거 \d+건 중/.test(t.classReason ?? "") && !touchedByHuman(t),
    );
    // 자기 자신이 색인에 들어 있으면 자기를 근거로 삼는다 — 빼고 다시 만든다
    const others = buildVendorIndex(all.filter((t) => !auto.includes(t)));
    let same = 0;
    const differ: string[] = [];
    auto.forEach((t) => {
      const sug = classifyOne(
        { vendor: t.vendor, last4: t.last4, txType: t.txType, gross: t.gross, adjust: t.adjust, site: t.site },
        { vendorIndex: others, vendorRules, paymentMethods, accounts },
      );
      if (sug.acctMinor === t.acctMinor && sug.acctMid === t.acctMid) same += 1;
      else differ.push(`  ${t.date} ${t.vendor} ${fmt(netAmount(t))}원 — 지금 ${t.acctMinor} · 엔진 ${sug.acctMinor ?? "(판단 불가)"} :: ${sug.classReason}`);
    });
    console.log(`옛 엔진이 자동 확정한 ${auto.length}건 — 지금 엔진과 같은 계정 ${same}건 · 다른 계정 ${differ.length}건`);
    differ.forEach((d) => console.log(d));
    process.exit(0);
  }

  // ---- 다시 분류 ----
  const pending = all.filter((t) => t.status !== "confirmed");
  const mine = pending.filter((t) => ENGINE_REASON.test(t.classReason ?? ""));
  // 엔진이 남긴 지문(engineSig)이 있으면 그것으로 가린다 — 화면의 「계속 배우기」
  // 가 쓴 행은 updatedBy 가 팀원이지만 엔진이 붙인 그대로다. 지문이 없는 옛
  // 행은 updatedBy 로 가린다 (화면은 updatedBy 를 못 보지만 여기서는 보인다).
  const engineOwned = (t: FinTransaction) =>
    t.engineSig ? t.engineSig === engineSigOf(t) : !touchedByHuman(t);
  const skippedHuman = mine.filter((t) => !engineOwned(t));
  const targets = mine.filter(engineOwned);

  const plan = targets
    .map((t) => {
      const before = snapshotOf(t);
      // 옛 엔진이 유형을 고쳐 둔 행은 은행이 알려준 원래 유형으로 되돌려 묻는다
      const fixed = (t.classReason ?? "").match(TYPE_FIXED);
      const bankType = (fixed && fixed[2] === t.txType ? fixed[1] : t.txType) as TxType;
      const sug = classify(t, bankType);
      const after: Snapshot = {
        // 일괄 작업은 확정을 만들지 않는다
        status: sug.status === "confirmed" ? "suggested" : sug.status,
        txType: sug.txType ?? bankType,
        acctMajor: sug.acctMajor,
        acctMid: sug.acctMid,
        acctMinor: sug.acctMinor,
        bizMajor: sug.bizMajor,
        bizMinor: sug.bizMinor,
        classReason: sug.classReason,
      };
      (Object.keys(after) as Field[]).forEach((f) => after[f] === undefined && delete after[f]);
      // 지문을 남긴다 — 이게 있어야 화면이 「엔진이 붙인 뒤 아무도 안 고친 행」 임을 안다
      after.engineSig = engineSigOf(after);
      const changed = FIELDS.some((f) => (before[f] ?? "") !== (after[f] ?? ""));
      return { t, before, after, changed, engineConfirmed: sug.status === "confirmed" };
    })
    .filter((x) => x.changed);

  console.log("=".repeat(76));
  console.log(
    `대기함 ${pending.length}건 · 엔진이 붙인 분류 ${mine.length}건 · 사람이 고친 흔적이 있어 건너뜀 ${skippedHuman.length}건 · 바뀌는 것 ${plan.length}건`,
  );
  console.log("=".repeat(76));

  const tally = new Map<string, { n: number; amount: number }>();
  plan.forEach(({ t, before, after }) => {
    const acctChanged = (before.acctMinor ?? "") !== (after.acctMinor ?? "") || (before.acctMid ?? "") !== (after.acctMid ?? "");
    const k =
      `${before.status === "needs_review" ? "검토필요" : "제안됨"} → ${after.status === "needs_review" ? "검토필요" : "제안됨"}` +
      (acctChanged
        ? before.acctMinor
          ? after.acctMinor
            ? " (계정 바뀜)"
            : " (약한 제안을 거둠)"
          : " (계정 새로 붙음)"
        : FIELDS.every((f) => f === "engineSig" || (before[f] ?? "") === (after[f] ?? ""))
          ? " (그대로 — 지문만 남김)"
          : " (계정 그대로 · 근거·사업구분만)");
    const r = tally.get(k) ?? { n: 0, amount: 0 };
    r.n += 1;
    r.amount += netAmount(t);
    tally.set(k, r);
  });
  [...tally.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(`  ${String(v.n).padStart(4)}건 ${fmt(v.amount).padStart(14)}원  ${k}`));

  console.log("");
  plan
    .sort((a, b) => (a.t.date < b.t.date ? -1 : 1))
    .forEach(({ t, before, after, engineConfirmed }) => {
      console.log(
        `  ${t.date} ${(t.vendor ?? "").padEnd(14)} ${fmt(netAmount(t)).padStart(11)}원  ${acctLabel(before)} → ${acctLabel(after)}` +
          `${after.txType !== before.txType ? ` [${before.txType}→${after.txType}]` : ""}${engineConfirmed ? " ★" : ""}`,
      );
      console.log(`      ${after.classReason}`);
    });
  console.log("\n  ★ = 파일을 새로 올렸다면 엔진이 확정했을 건 (여기서는 제안으로 둔다)");

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }
  if (plan.length === 0) {
    console.log("\n바꿀 것이 없습니다.");
    process.exit(0);
  }

  // 바꾸기 전 값을 떠 둔다 (깃 밖)
  const dir = path.join("output", "finance-reclassify");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backup, JSON.stringify(plan.map(({ t, before, after }) => ({ id: t.id, date: t.date, vendor: t.vendor, before, after })), null, 1));
  console.log(`\n바꾸기 전 값 → ${backup}`);

  const now = Date.now();
  for (let i = 0; i < plan.length; i += BATCH) {
    const b = db.batch();
    plan.slice(i, i + BATCH).forEach(({ t, after }) => {
      const patch: Record<string, unknown> = { updatedAt: now, updatedBy: BY };
      // 새 결과에 없는 필드는 지운다 — 옛 엔진의 약한 제안이 남아 있으면 안 된다
      FIELDS.forEach((f) => (patch[f] = after[f] ?? FieldValue.delete()));
      b.set(col.doc(t.id), patch, { merge: true });
    });
    await b.commit();
    console.log(`  ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }
  console.log(`\n완료 — ${plan.length}건. 되돌리려면: npm run finance:reclassify-pending -- --undo ${backup}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
