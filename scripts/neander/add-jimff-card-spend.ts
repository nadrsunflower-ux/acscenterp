// ============================================================
//  JIMFF 지출 — 현장 카드 사용분 (신한법인 1804) 적재
// ------------------------------------------------------------
//  2026-09-03 ~ 09-07 현장에서 쓴 식대·택시비 15건을 카드 승인 문자에서
//  옮긴다. 승인 문자에는 날짜·시각·금액·가맹점이 다 들어 있어 그대로
//  한 줄씩 만든다.
//
//  실제로 나간 돈이므로 **단가와 실제금액을 같은 값**으로 넣는다. 견적만
//  넣으면 「실제금액 미입력」으로 세어져 실질 이익이 아직 추정인 것처럼
//  보인다.
//
//  같이 지우는 것: 내가 예시로 넣어 둔 「현장 스태프 식대 24인 288,000」
//  한 줄. 실제 식대가 들어오면 둘이 겹쳐 식대 소계가 두 배가 된다.
//  인건비·KTX 예시는 대응하는 실제 자료가 아직 없어 그대로 둔다.
//
//  비고에 승인 시각과 카드를 남긴다 — 나중에 카드 명세서가 원장에 들어오면
//  이 줄과 짝을 맞출 근거가 된다. 이 값이 중복 적재를 막는 열쇠이기도 하다.
//
//    npx tsx scripts/neander/add-jimff-card-spend.ts          # 미리보기
//    npx tsx scripts/neander/add-jimff-card-spend.ts --apply  # 적재
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  groupLines,
  projectSummary,
  sanitizeLine,
  shortId,
  type FinProjectDoc,
  type FinProjectLine,
} from "@/lib/neander/finance/project";

const APPLY = process.argv.includes("--apply");
const CODE = "JIMFF";
const CARD = "신한법인 1804";
const YEAR = 2026;
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 승인 문자 그대로: [월일, 시각, 금액, 가맹점, 분류] */
const APPROVALS: [string, string, number, string, string][] = [
  ["09-03", "16:09", 5600, "메가엠지씨커피 제천시보건소", "식대"],
  ["09-04", "09:46", 5300, "티머니 개인택시", "교통·운송"],
  ["09-04", "09:47", 3200, "리안", "식대"],
  ["09-04", "12:28", 8900, "오월의식당", "식대"],
  ["09-05", "09:50", 4600, "티머니 개인택시", "교통·운송"],
  ["09-05", "09:51", 6700, "리안", "식대"],
  ["09-05", "23:02", 6700, "티머니 개인택시", "교통·운송"],
  ["09-06", "09:57", 6700, "리안", "식대"],
  ["09-06", "14:08", 11000, "다담뜰한식뷔페 제천점", "식대"],
  ["09-06", "22:40", 5700, "티머니 개인택시", "교통·운송"],
  ["09-07", "09:46", 4500, "티머니 개인택시", "교통·운송"],
  ["09-07", "09:48", 3200, "리안", "식대"],
  ["09-07", "14:13", 4000, "제천원조빨간오뎅보금자리", "식대"],
  ["09-07", "14:15", 2000, "제천원조빨간오뎅보금자리", "식대"],
  ["09-07", "17:22", 3200, "리안", "식대"],
];

/** 비고 = 중복 판정 키. 같은 승인은 한 번만 들어간다. */
const noteOf = (md: string, time: string) => `${YEAR}-${md} ${time} · ${CARD}`;

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finProjects);
  const snap = await col.get();
  const doc = snap.docs.find((d) => String(d.data().code ?? "").trim().toLowerCase() === CODE.toLowerCase());
  if (!doc) throw new Error(`코드 ${CODE} 프로젝트가 없습니다.`);
  const project = { id: doc.id, ...doc.data() } as FinProjectDoc;

  const before = project.lines ?? [];
  const existingNotes = new Set(before.map((l) => l.note).filter(Boolean) as string[]);

  // ① 예시 식대 줄 걷어내기 — 실제 식대와 겹친다
  const dropped = before.filter((l) => l.category === "식대" && (l.note ?? "").startsWith("예시"));
  const kept = before.filter((l) => !dropped.includes(l));

  // ② 승인 문자 → 줄
  const fresh: FinProjectLine[] = [];
  APPROVALS.forEach(([md, time, amount, merchant, category]) => {
    const note = noteOf(md, time);
    if (existingNotes.has(note)) return; // 이미 들어와 있다
    fresh.push(
      sanitizeLine({
        id: shortId(),
        category,
        item: merchant,
        qty: 1,
        unit: "건",
        unitPrice: amount,
        actual: amount,
        note,
      }),
    );
  });

  const lines = [...kept, ...fresh];
  const next = { ...project, lines };

  console.log(`\n[${project.name}] ${project.code}`);
  if (dropped.length > 0) {
    console.log(`  걷어낼 예시 줄 ${dropped.length}개: ${dropped.map((l) => `${l.item} ${fmt((l.qty ?? 0) * (l.unitPrice ?? 0))}`).join(", ")}`);
  }
  console.log(`  새로 넣을 줄 ${fresh.length}개 (승인 ${APPROVALS.length}건 중 중복 ${APPROVALS.length - fresh.length}건 제외)`);
  const byCat = new Map<string, { n: number; sum: number }>();
  fresh.forEach((l) => {
    const g = byCat.get(l.category) ?? { n: 0, sum: 0 };
    g.n += 1;
    g.sum += l.unitPrice ?? 0;
    byCat.set(l.category, g);
  });
  [...byCat.entries()].forEach(([c, g]) => console.log(`   · ${c.padEnd(8)} ${g.n}건  ${fmt(g.sum).padStart(9)}`));
  console.log(`   · 합계      ${fresh.length}건  ${fmt(fresh.reduce((s, l) => s + (l.unitPrice ?? 0), 0)).padStart(9)}`);

  const s = projectSummary(next);
  console.log(`\n  줄 ${before.length} → ${lines.length}`);
  console.log(`  견적 원가 ${fmt(s.estimate)} · 실제 원가 ${fmt(s.actual)} · 실제금액 입력 ${s.actualFilled}/${s.lineCount}줄`);
  console.log(`  실질 이익 ${fmt(s.profitActual)}`);
  console.log("\n  분류별 소계");
  groupLines(lines).forEach((g) =>
    console.log(`   · ${g.category.padEnd(18)} ${String(g.lines.length).padStart(2)}줄  실제 ${fmt(g.actual).padStart(11)}`),
  );

  if (!APPLY) {
    console.log("\n미리보기입니다. 적재하려면 --apply 를 붙이세요.");
    process.exit(0);
  }
  if (fresh.length === 0 && dropped.length === 0) {
    console.log("\n바뀔 것이 없습니다.");
    process.exit(0);
  }

  await col.doc(project.id).set(
    { lines, updatedAt: Date.now(), updatedBy: "add-jimff-card-spend" },
    { merge: true },
  );
  console.log(`\n저장했습니다 → /neander/finance/projects/${project.id}`);
  process.exit(0);
})();
