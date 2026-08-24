import "server-only";

// ============================================================
//  영수증 사진 — 서버를 거쳐 올리고, 짧게 사는 서명 URL 로 보여준다
// ------------------------------------------------------------
//  Storage 보안 규칙에서 `neander_chat` · `neander_dev` 를 뺀 나머지 경로는
//  전부 공개다(catch-all). 새 폴더를 만들어 브라우저에서 직접 올리면
//  영수증이 누구나 읽고 쓸 수 있는 자리에 놓인다. 규칙을 고쳐 게시하려면
//  사용자 계정 로그인이 필요해서(scripts/deploy-rules.sh) 코드만으로는
//  닫을 수 없다.
//
//  그래서 재무가 Firestore 를 다루는 방식과 같게 간다 — **서버만 접근한다.**
//  Admin SDK 는 규칙을 우회하므로 규칙이 어떻든 우리 서버는 쓸 수 있고,
//  브라우저에는 객체 경로 대신 만료되는 서명 URL 만 준다. 규칙을 나중에
//  닫아도 이 코드는 그대로 동작한다.
// ============================================================

import { getStorage } from "firebase-admin/storage";
import { adminApp } from "./admin";

/** 영수증이 놓이는 자리 */
const PREFIX = "neander_fin/card-memo";
/** 서명 URL 수명. 화면을 열어 두고 한참 보는 일은 없다 */
const URL_TTL_MS = 60 * 60 * 1000;

function bucket() {
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!name) {
    throw new Error(
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET 이 없습니다. 사진 없이 메모만 저장할 수 있습니다.",
    );
  }
  return getStorage(adminApp()).bucket(name);
}

/** 경로에 넣기 안전한 이름으로 (다른 업로더와 같은 규칙) */
const safeName = (n: string) => n.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80) || "photo";

export async function uploadReceipt(
  memoId: string,
  file: { name: string; type: string; bytes: Buffer },
): Promise<string> {
  const path = `${PREFIX}/${memoId}/${Date.now()}_${safeName(file.name)}`;
  await bucket()
    .file(path)
    .save(file.bytes, {
      contentType: file.type || "application/octet-stream",
      resumable: false,
    });
  return path;
}

/** 화면에 보여줄 때만 만든다. 저장하지 않는다 — 만료되기 때문이다. */
export async function signedUrl(path: string): Promise<string> {
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({ action: "read", expires: Date.now() + URL_TTL_MS });
  return url;
}

export async function deleteReceipts(paths: string[]): Promise<void> {
  const b = bucket();
  await Promise.all(
    paths.map((p) =>
      b
        .file(p)
        .delete()
        .catch(() => {
          // 이미 없는 파일은 무시한다 — 메모 삭제가 여기서 막히면 안 된다
        }),
    ),
  );
}
