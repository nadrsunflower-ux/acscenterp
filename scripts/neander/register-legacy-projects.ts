// ============================================================
//  원장에만 있던 프로젝트 코드 등록
// ------------------------------------------------------------
//  적재된 거래에는 프로젝트코드가 붙어 있는데 프로젝트 문서가 없어서
//  프로젝트 손익 화면에 아예 안 뜨던 코드들을 만든다. 코드는 원장 쪽이
//  정본이므로 **거래를 고치지 않고 프로젝트를 맞춘다.**
//
//  ⚠️ 원장에 있는 코드를 전부 만들지는 않는다. 프로젝트가 아닌 것이 섞여 있다.
//
//    공통   1건짜리 분류용 태그다. 프로젝트가 아니다.
//    SMOAT  사업소분류(bizMinor)로 이미 쓰이는 값이다. 사업부이지 프로젝트가
//           아니라서, 프로젝트로도 만들면 같은 지출이 두 축에서 각각
//           "프로젝트 원가" 로 잡혀 읽는 사람이 헷갈린다.
//
//  계약금액은 넣지 않는다. 실제 입금액(수입 합계)을 계약금액 칸에 넣으면
//  숫자는 그럴듯해도 **계약서에 없는 금액이 계약금액으로 남는다.** 화면에서
//  사람이 채워야 한다 — 비고에 그렇게 적어 둔다.
//
//    npx tsx scripts/neander/register-legacy-projects.ts          # 미리보기
//    npx tsx scripts/neander/register-legacy-projects.ts --apply  # 적재
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { ProjectStatus } from "@/lib/neander/finance/project";

const APPLY = process.argv.includes("--apply");
const BY = "register-legacy-projects";

/**
 * 이름은 코드를 그대로 쓴다. 실제 사업명을 모르는 채로 지어내면 재무
 * 데이터에 거짓이 남는다. `bizMinor` 는 거래가 한 가지로 모일 때만 넣는다.
 */
const PROJECTS: {
  code: string;
  status: ProjectStatus;
  bizMinor?: string;
  hint: string;
}[] = [
  // ---- 2025-11 ~ 12 에 끝난 건들 ----
  { code: "CCS-2511", status: "done", hint: "2025-11-02~11-27 · 11건 · 수입 15,200,000" },
  { code: "CRS-2511", status: "done", bizMinor: "조향", hint: "2025-12-02~12-19 · 6건 · 지출만 497,870" },
  { code: "ECS-2511", status: "done", hint: "2025-11-13 · 1건 · 에코사 수입 1,720,000" },
  { code: "HHS-2511", status: "done", hint: "2025-11-04~11-11 · 3건 · 지출만 298,000" },
  { code: "HRS-2511", status: "done", hint: "2025-11-05~12-04 · 21건 · 수입 21,384,360" },
  { code: "NSG-2511", status: "done", hint: "2025-11-13 · 1건 · (주)쥬스컴퍼니 수입 2,200,000" },
  { code: "PTB-2511", status: "done", hint: "2025-11-09 · 1건 · 김제연 지출 1,500,000" },

  // ---- 2026 진행분 ----
  { code: "제이진", status: "active", hint: "2026-07-03~07-29 · 3건 · (주)제이진옴므 수입 10,560,000" },
];

/** 프로젝트가 아니라서 일부러 만들지 않는 코드 — 왜 뺐는지 남긴다 */
const SKIPPED = [
  { code: "공통", why: "1건짜리 분류용 태그. 프로젝트가 아니다." },
  { code: "SMOAT", why: "사업소분류(bizMinor)로 이미 쓰는 값. 사업부이지 프로젝트가 아니다." },
];

const note = (hint: string) =>
  `원장에 코드만 있고 프로젝트 문서가 없어 자동 생성했습니다 (${hint}). ` +
  `이름·고객사·계약금액·기간은 확인해서 채워주세요. 계약금액은 실제 입금액과 다를 수 있어 비워 두었습니다.`;

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

  const col = db.collection(NEANDER_COL.finProjects);
  const existing = await col.get();
  const byCode = new Map<string, string>();
  existing.forEach((d) => {
    const code = (d.data() as any).code;
    if (code) byCode.set(code, d.id);
  });

  let made = 0;
  for (const p of PROJECTS) {
    if (byCode.has(p.code)) {
      console.log(`${p.code.padEnd(12)} 이미 있음, 건너뜀`);
      continue;
    }
    const doc = {
      code: p.code,
      name: p.code,
      status: p.status,
      ...(p.bizMinor ? { bizMinor: p.bizMinor } : {}),
      vatMode: "excluded" as const,
      revenues: [],
      lines: [],
      note: note(p.hint),
      createdAt: Date.now(),
      createdBy: BY,
      updatedBy: BY,
    };
    console.log(`${p.code.padEnd(12)} 새로 등록 · ${p.status}${p.bizMinor ? ` · ${p.bizMinor}` : ""}  (${p.hint})`);
    if (APPLY) await col.add(doc);
    made++;
  }

  console.log("\n일부러 만들지 않은 코드:");
  SKIPPED.forEach((s) => console.log(`  ${s.code.padEnd(12)} ${s.why}`));

  console.log(APPLY ? `\n완료 — ${made}건 생성.` : `\n(미리보기라 아무것도 쓰지 않았습니다 — ${made}건 생성 예정.)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
