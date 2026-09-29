// ============================================================
//  화면 검증용 로그인 토큰 (CLI) — 로그인 뒤 화면을 헤드리스로 검사할 때
// ------------------------------------------------------------
//  e2e 프로필 세션이 만료되면 캡처가 전부 로그인 화면이 된다. 관리자 SDK 로
//  본인 계정의 커스텀 토큰을 만들어 Firebase 로그인 토큰으로 바꾸고, 파일에
//  적는다. 검사 스크립트(e2e/deck-overflow.mjs)가 이 파일을 읽어 일회용
//  브라우저의 IndexedDB 에 넣는다. 끝나면 파일을 지운다.
//
//    NEANDER_E2E_EMAIL=나@example.com npm run e2e:token -- <저장할 파일>
//  ⚠️ 본인 계정으로만 쓴다. 토큰 파일은 저장소 밖(스크래치)에 둔다.
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { adminAuth } from "@/lib/neander/server/admin";

async function main() {
  const email = process.env.NEANDER_E2E_EMAIL;
  const out = process.argv[2];
  if (!email || !out) throw new Error("NEANDER_E2E_EMAIL 과 저장할 파일 경로가 필요합니다.");
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY 가 없습니다.");
  const user = await adminAuth().getUserByEmail(email);
  const custom = await adminAuth().createCustomToken(user.uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`토큰 교환 실패: HTTP ${res.status}`);
  const t = (await res.json()) as { idToken: string; refreshToken: string; expiresIn: string };
  writeFileSync(
    out,
    JSON.stringify({
      apiKey,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      idToken: t.idToken,
      refreshToken: t.refreshToken,
      expirationTime: Date.now() + Number(t.expiresIn) * 1000,
    }),
    { mode: 0o600 },
  );
  console.log(`토큰을 ${out} 에 적었습니다 (${user.email}). 검사가 끝나면 지우세요.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
