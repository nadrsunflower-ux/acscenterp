// ============================================================
//  견적서 인감 이미지를 Firestore 에 올린다 (CLI)
// ------------------------------------------------------------
//  도장 파일은 깃에 없다 — 저장소가 public 이다. 배포본에서도 찍히려면
//  서버가 꺼내 줄 자리가 있어야 해서, 로컬의 public/images/seals/{id}.png
//  (각자 내려받아 둔 것)를 neander_fin_seals/{id} 에 바이트로 넣는다.
//  그 컬렉션은 보안 규칙에 없어 클라이언트가 직접 읽지 못하고,
//  api/neander/finance/seals/{id} 가 로그인을 확인한 뒤에만 내준다.
//
//  supplier.ts 의 SEALS 에 등록된 id 만 올린다. 파일이 없는 도장은 건너뛴다.
//  Firestore 문서 한도는 1MiB — 도장 PNG 는 수십 KB 라 넉넉하다.
//
//  실행:
//    npm run finance:upload-seals            무엇을 올릴지 보여주기만 한다
//    npm run finance:upload-seals -- --apply 실제로 올린다 (같은 id 는 덮어쓴다)
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { SEALS } from "@/lib/neander/finance/supplier";

const APPLY = process.argv.includes("--apply");
const MAX_BYTES = 900 * 1024;

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

async function main() {
  init();
  const col = getFirestore().collection(NEANDER_COL.finSeals);

  for (const seal of SEALS) {
    const file = path.join(process.cwd(), "public/images/seals", `${seal.id}.png`);
    if (!existsSync(file)) {
      console.log(`- ${seal.id}  파일 없음 — 건너뜀 (${file})`);
      continue;
    }
    const data = readFileSync(file);
    if (data.length > MAX_BYTES) {
      console.log(`! ${seal.id}  ${data.length} bytes — 너무 크다. 줄여서 다시.`);
      continue;
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    const live = (await col.doc(seal.id).get()).data() as { sha256?: string } | undefined;
    const same = live?.sha256 === sha256;
    console.log(`${same ? "=" : "+"} ${seal.id}  ${seal.label}  ${data.length} bytes${same ? "  (이미 같음)" : ""}`);
    if (!APPLY || same) continue;
    await col.doc(seal.id).set({
      mime: "image/png",
      data,
      bytes: data.length,
      sha256,
      label: seal.label,
      updatedAt: Date.now(),
      updatedBy: "script:upload-seals",
    });
  }
  if (!APPLY) console.log("\n(미리보기) 실제로 올리려면 -- --apply");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
