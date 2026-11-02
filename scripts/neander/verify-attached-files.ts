// 재무 첨부파일 저장소(server/attached-files.ts) 실 Firestore 검증.
// 장부 컬렉션은 건드리지 않는다 — 검증 전용 컬렉션에 주인 문서를 잠깐 만들고 지운다.
// 지원사업 · 프로젝트 저장소는 목록 읽기만 확인한다.
//   npm run finance:verify-attached-files
import { config } from "dotenv";
config({ path: ".env.local" });
import { createHash, randomBytes } from "node:crypto";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { ATTACHED_FILE_PART_BYTES, ATTACHED_FILE_READ_PARTS, withObjectParticle } from "@/lib/neander/finance/attached-files";
import { attachedFileStore, grantFiles, projectFiles } from "@/lib/neander/finance/server/attached-files";

const VERIFY_FILES = "neander_verify_attached_files";
const VERIFY_PARENT = "neander_verify_attached_owner";
const BY = "verify@cli";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function rejects(name: string, run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
    check(name, false, "거절되지 않았다");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, pattern.test(msg), msg);
  }
}

(async () => {
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64!, "base64").toString("utf8"));
    initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
  }
  const db = getFirestore();
  const store = attachedFileStore({ files: VERIFY_FILES, parent: VERIFY_PARENT, key: "ownerId", label: "검증주인" });
  const ownerId = `verify-${randomBytes(6).toString("hex")}`;
  const otherId = `verify-${randomBytes(6).toString("hex")}`;

  check("조사: 프로젝트를", withObjectParticle("프로젝트") === "프로젝트를");
  check("조사: 지원사업을", withObjectParticle("지원사업") === "지원사업을");

  try {
    await db.collection(VERIFY_PARENT).doc(ownerId).set({ at: Date.now() });
    await db.collection(VERIFY_PARENT).doc(otherId).set({ at: Date.now() });

    // 조각 3개짜리 파일 (마지막 조각은 짧다)
    const bytes = randomBytes(ATTACHED_FILE_PART_BYTES * 2 + 12345);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const meta = { name: "검증 제안서.pdf", type: "application/pdf", size: bytes.length, sha256 };

    await rejects("없는 주인에게는 못 올린다", () => store.create(db, BY, "verify-missing-owner", meta), /찾지 못했습니다/);
    await rejects("허용 안 된 확장자", () => store.create(db, BY, ownerId, { ...meta, name: "a.exe" }), /지원하지 않는/);

    const made = await store.create(db, BY, ownerId, meta);
    check("만들기", "id" in made && made.parts === 3, JSON.stringify(made));
    if (!("id" in made)) throw new Error("만들기 실패");
    const part = (n: number) => bytes.subarray(n * ATTACHED_FILE_PART_BYTES, (n + 1) * ATTACHED_FILE_PART_BYTES);

    await rejects("조각 크기가 틀리면 거절", () => store.putPart(db, BY, ownerId, made.id, 2, part(0)), /크기가 맞지 않습니다/);
    await rejects("다른 주인 이름으로 조각을 못 넣는다", () => store.putPart(db, BY, otherId, made.id, 0, part(0)), /첨부파일이 아닙니다/);
    await rejects("다른 사람은 조각을 못 넣는다", () => store.putPart(db, "someone@else", ownerId, made.id, 0, part(0)), /조각을 더 넣을 수 없습니다/);

    await store.putPart(db, BY, ownerId, made.id, 0, part(0));
    await store.putPart(db, BY, ownerId, made.id, 2, part(2));
    await rejects("조각이 빠지면 확인 실패", () => store.complete(db, BY, ownerId, made.id), /모두 올라오지 않았습니다/);
    check("확인 실패 뒤 목록에 안 보인다", (await store.list(db, ownerId)).length === 0);

    await store.putPart(db, BY, ownerId, made.id, 1, part(1));
    const done = await store.complete(db, BY, ownerId, made.id);
    check("확인 완료", done.id === made.id && done.size === bytes.length && done.sha256 === sha256);
    const listed = await store.list(db, ownerId);
    check("목록에 보인다", listed.length === 1 && listed[0].name === "검증 제안서.pdf");
    check("다른 주인 목록엔 없다", (await store.list(db, otherId)).length === 0);

    const dup = await store.create(db, BY, ownerId, meta);
    check("같은 파일은 중복으로 돌려준다", "duplicate" in dup && dup.duplicate.id === made.id);

    const chunks: Buffer[] = [];
    for (let from = 0; from < 3; from += ATTACHED_FILE_READ_PARTS) chunks.push(await store.read(db, ownerId, made.id, from, ATTACHED_FILE_READ_PARTS));
    check("읽은 내용이 원본과 같다", Buffer.concat(chunks).equals(bytes));
    await rejects("다른 주인 이름으로는 못 읽는다", () => store.read(db, otherId, made.id, 0, 1), /첨부파일이 아닙니다/);

    await rejects("주인이 있으면 일괄 정리 거절", () => store.removeAllFor(db, ownerId), /먼저 삭제해 주세요/);
    await store.remove(db, ownerId, made.id);
    check("삭제 뒤 목록이 빈다", (await store.list(db, ownerId)).length === 0);
    check("삭제 뒤 조각이 남지 않는다", (await db.collection(VERIFY_FILES).doc(made.id).collection("parts").count().get()).data().count === 0);

    // 주인 삭제 → 남은 파일 일괄 정리
    const small = randomBytes(1000);
    const made2 = await store.create(db, BY, ownerId, { name: "b.txt", type: "text/plain", size: small.length, sha256: createHash("sha256").update(small).digest("hex") });
    if (!("id" in made2)) throw new Error("두 번째 만들기 실패");
    await store.putPart(db, BY, ownerId, made2.id, 0, small);
    await store.complete(db, BY, ownerId, made2.id);
    await db.collection(VERIFY_PARENT).doc(ownerId).delete();
    await store.removeAllFor(db, ownerId);
    check("주인 삭제 뒤 일괄 정리", (await db.collection(VERIFY_FILES).where("ownerId", "==", ownerId).get()).empty);

    // 실제 저장소 — 목록 읽기만
    const grant = (await db.collection(NEANDER_COL.finGrants).limit(1).get()).docs[0];
    if (grant) check("지원사업 첨부 목록 읽기", Array.isArray(await grantFiles.list(db, grant.id)), grant.id);
    const project = (await db.collection(NEANDER_COL.finProjects).limit(1).get()).docs[0];
    if (project) check("프로젝트 자료 목록 읽기", Array.isArray(await projectFiles.list(db, project.id)), project.id);
  } finally {
    await db.recursiveDelete(db.collection(VERIFY_FILES)).catch(() => undefined);
    await db.recursiveDelete(db.collection(VERIFY_PARENT)).catch(() => undefined);
  }
  console.log(`\n${passed}건 통과 · ${failed}건 실패`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
