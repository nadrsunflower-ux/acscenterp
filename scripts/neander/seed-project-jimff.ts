// ============================================================
//  예시 프로젝트 적재 — 2026 JIMFF 행사
// ------------------------------------------------------------
//  「JIMFF_물품체크리스트0908.xlsx」 를 그대로 읽어 프로젝트 손익 화면의
//  첫 예시를 만든다. 화면의 「엑셀에서 줄 가져오기」 와 같은 파서를 쓰므로,
//  사람이 화면에서 올린 것과 결과가 같다.
//
//  엑셀에서 손댄 곳은 두 군데다.
//
//   ① 분류 보정 — 원본에서 용달 상행·하행은 분류 칸이 비어 있다. 파서가
//      바로 위 줄의 분류(조향 테이블)를 이어받으므로 「교통·운송」 으로 옮긴다.
//
//   ② 실제금액 1줄 — 조명류. 원장의 2026-07-31 AliExpress 44,881원이
//      이 줄의 발주처(알리익스)와 맞는 유일한 JIMFF 코드 지출이다.
//      나머지 줄은 아직 결제 전이라 비워 둔다(= 견적으로 계산된다).
//
//  엑셀에 없어서 **새로 넣은** 것은 식대·인건비 예시 3줄이다. 행사 원가에서
//  빠질 수 없는데 원본 체크리스트에는 칸이 없었다. 단가는 2025년 제천 행사
//  실측(씨유제천 23,000·22,600 / 컴포즈커피 12,300 / KTX 제천-청량리
//  63,200)에서 가져왔고, 비고에 「예시」 라고 적어 두었다.
//
//  ⚠️ 계약금액 3,520,000 은 **임시값**이다. 2025-08-17 「하이그림-OST페어」
//     납품계약 매출로, 지난 회차 같은 행사 기간의 실적이다. 올해 계약서
//     금액이 정해지면 화면에서 고쳐야 한다 — 메모에도 적어 두었다.
//
//  같은 코드의 프로젝트가 이미 있으면 새로 만들지 않고 덮어쓴다.
//
//    npx tsx scripts/neander/seed-project-jimff.ts          # 미리보기
//    npx tsx scripts/neander/seed-project-jimff.ts --apply  # 적재
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { parseChecklistXlsx } from "@/lib/neander/finance/project-xlsx";
import {
  groupLines,
  lineEstimate,
  projectSummary,
  sanitizeLine,
  sanitizeProject,
  shortId,
  type FinProjectLine,
} from "@/lib/neander/finance/project";

const APPLY = process.argv.includes("--apply");
const XLSX_PATH = join(homedir(), "Downloads", "JIMFF_물품체크리스트0908.xlsx");
const CODE = "JIMFF";
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

/** 엑셀에 없던 식대·인건비 — 2025년 제천 행사 실측 단가 (비고에 예시 표시) */
const EXTRA_LINES: Partial<FinProjectLine>[] = [
  {
    category: "식대",
    item: "현장 스태프 식대",
    qty: 24,
    unit: "인",
    unitPrice: 12000,
    note: "예시 — 4인 × 6끼. 2025 제천 실측(컴포즈커피 12,300)",
  },
  {
    category: "인건비",
    item: "현장 운영 인력",
    qty: 8,
    unit: "인일",
    unitPrice: 120000,
    note: "예시 — 2명 × 4일. 실제 인원·일당으로 고치세요",
  },
  {
    category: "교통·운송",
    item: "KTX 청량리-제천 왕복",
    qty: 4,
    unit: "인",
    unitPrice: 63200,
    note: "예시 — 2025-08-16 실측 63,200",
  },
];

(async () => {
  // ---- 엑셀 → 줄 ---------------------------------------------
  const file = readFileSync(XLSX_PATH);
  const parsed = parseChecklistXlsx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  if (parsed.error) throw new Error(parsed.error);

  const lines = parsed.lines.map((l) => {
    // ① 용달은 운송이다 — 원본에서 분류 칸이 비어 앞줄을 이어받았다
    if (/^용달/.test(l.item)) return { ...l, category: "교통·운송" };
    // ② 조명류: 원장의 알리익스프레스 결제액을 실제금액으로
    if (l.item === "조명류" && l.vendor?.startsWith("알리익")) {
      return { ...l, actual: 44881, note: "원장 2026-07-31 AliExpress 결제액" };
    }
    return l;
  });
  EXTRA_LINES.forEach((raw) => lines.push(sanitizeLine({ ...raw, id: shortId() })));

  const draft = sanitizeProject({
    code: CODE,
    name: "2026 JIMFF 행사",
    client: "제천국제음악영화제",
    status: "planning",
    bizMinor: "조향",
    contractAmount: 3_520_000,
    revenues: [],
    lines,
    note:
      "계약금액 3,520,000 은 임시값입니다 — 2025-08-17 「하이그림-OST페어」 납품계약 매출(지난 회차 같은 행사 기간)을 넣어 둔 것이라, " +
      "올해 계약서 금액으로 바꿔야 합니다. 행사 기간(시작일·종료일)도 확정되면 채우세요. " +
      "체크리스트는 JIMFF_물품체크리스트0908.xlsx 에서 가져왔고, 식대·인건비·KTX 3줄은 예시로 더한 것입니다.",
  });
  if (!draft.ok) throw new Error(draft.error);
  const value = draft.value;

  // ---- 미리보기 -----------------------------------------------
  const s = projectSummary(value);
  console.log(`\n[${value.name}] 코드 ${value.code}`);
  console.log(`  줄 ${s.lineCount}개 (엑셀 ${parsed.lines.length} + 추가 ${EXTRA_LINES.length})`);
  groupLines(value.lines).forEach((g) =>
    console.log(`   · ${g.category.padEnd(18)} ${String(g.lines.length).padStart(2)}줄  견적 ${fmt(g.estimate).padStart(11)}`),
  );
  console.log(`  계약금액 ${fmt(s.contract)} / 견적 원가 ${fmt(s.estimate)} / 실제 원가 ${fmt(s.actual)}`);
  console.log(`  예상 이익 ${fmt(s.profitEstimate)} · 실질 이익 ${fmt(s.profitActual)}`);
  const zero = value.lines.filter((l) => lineEstimate(l) === 0).length;
  console.log(`  단가 0/미입력 ${zero}줄 (이미 보유한 물품 등)`);

  if (!APPLY) {
    console.log("\n미리보기입니다. 적재하려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  // ---- 적재 ---------------------------------------------------
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finProjects);
  const now = Date.now();
  const existing = (await col.get()).docs.find(
    (d) => String(d.data().code ?? "").trim().toLowerCase() === CODE.toLowerCase(),
  );

  if (existing) {
    await col.doc(existing.id).set(
      { ...value, createdAt: existing.data().createdAt ?? now, createdBy: existing.data().createdBy, updatedAt: now, updatedBy: "seed-project-jimff" },
      { merge: false },
    );
    console.log(`\n덮어썼습니다 → /neander/finance/projects/${existing.id}`);
  } else {
    const ref = await col.add({ ...value, createdAt: now, createdBy: "seed-project-jimff", updatedAt: now, updatedBy: "seed-project-jimff" });
    console.log(`\n만들었습니다 → /neander/finance/projects/${ref.id}`);
  }
  process.exit(0);
})();
