// ============================================================
//  2608 장부 적재 준비 — 새 카드·프로젝트 코드 등록
// ------------------------------------------------------------
//  8월 장부를 검사하다 마스터에 없는 값 세 개가 나왔다.
//
//    카드 2639      8월에 새로 생긴 하이패스 카드. 등록하지 않으면
//                   장부 시트에서 「계좌 마스터에 없는 번호」로 계속 뜬다.
//    프로젝트 FNC   기존 적재분에도 18건 있는 코드인데 프로젝트 문서가
//    프로젝트 금연  없어 프로젝트 손익에 안 잡혔다 (금연은 4건).
//
//  이름·계약금액은 모르는 값이라 비워 둔다 — 지어내면 재무 데이터에
//  거짓이 남는다. 화면에서 채우라고 비고에 적어 둔다.
//
//    npx tsx scripts/neander/register-2608-masters.ts          # 미리보기
//    npx tsx scripts/neander/register-2608-masters.ts --apply  # 적재
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";

const APPLY = process.argv.includes("--apply");
const BY = "register-2608-masters";

/** 새로 생긴 하이패스 카드 — 8월 사용은 통행료 2건 (r88·r89) */
const CARD = {
  last4: "2639",
  alias: "(신법)이동주하이",
  site: "네안데르",
  kind: "card" as const,
  personal: false,
};

/**
 * 프로젝트 코드. 이름은 코드를 그대로 쓴다 — 실제 사업명·고객사·계약금액을
 * 모르는 채로 지어내는 것보다, 코드만 맞춰 두고 화면에서 채우는 편이 낫다.
 */
const PROJECTS = [
  { code: "FNC", name: "FNC", bizMinor: "조향" },
  { code: "금연", name: "금연", bizMinor: "조향" },
];

const NOTE =
  "2608 장부 검사 중 원장에만 있고 프로젝트 문서가 없어 자동 생성했습니다. " +
  "이름·고객사·계약금액·기간은 확인해서 채워주세요.";

function init() {
  if (getApps().length) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

async function main() {
  init();
  const db = getFirestore();
  console.log(APPLY ? "적재합니다.\n" : "미리보기입니다 (--apply 를 붙이면 씁니다).\n");

  // ---- 카드 ----
  const pmRef = db.collection(NEANDER_COL.finPaymentMethods).doc(CARD.last4);
  const pmSnap = await pmRef.get();
  if (pmSnap.exists) {
    console.log(`카드 ${CARD.last4} — 이미 있음, 건너뜀 (${(pmSnap.data() as any).alias})`);
  } else {
    console.log(`카드 ${CARD.last4} — 새로 등록  ${CARD.alias} · ${CARD.site} · ${CARD.kind}`);
    if (APPLY) await pmRef.set(CARD);
  }

  // ---- 프로젝트 ----
  const projCol = db.collection(NEANDER_COL.finProjects);
  const existing = await projCol.get();
  const byCode = new Map<string, string>();
  existing.forEach((d) => {
    const code = (d.data() as any).code;
    if (code) byCode.set(code, d.id);
  });

  for (const p of PROJECTS) {
    if (byCode.has(p.code)) {
      console.log(`프로젝트 ${p.code} — 이미 있음, 건너뜀 (${byCode.get(p.code)})`);
      continue;
    }
    const doc = {
      code: p.code,
      name: p.name,
      status: "active" as const,
      bizMinor: p.bizMinor,
      vatMode: "excluded" as const,
      revenues: [],
      lines: [],
      note: NOTE,
      createdAt: Date.now(),
      createdBy: BY,
      updatedBy: BY,
    };
    console.log(`프로젝트 ${p.code} — 새로 등록  ${p.name} · ${p.bizMinor} · active`);
    if (APPLY) await projCol.add(doc);
  }

  console.log(APPLY ? "\n완료." : "\n(미리보기라 아무것도 쓰지 않았습니다.)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
