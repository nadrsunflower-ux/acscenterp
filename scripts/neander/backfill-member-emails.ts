// ============================================================
//  백필: neander_member_emails (이메일 → 팀원 매핑) 시드
// ------------------------------------------------------------
//  Firestore 보안 규칙이 neander_member_emails/{email} 존재로
//  '허용 팀원'을 판정하므로, 규칙을 게시(deploy)하기 전에 기존
//  팀원들의 매핑 문서를 미리 만들어 둬야 잠기지 않는다.
//
//  멱등(idempotent): 여러 번 실행해도 안전(덮어쓰기만).
//  ⚠️ 반드시 "규칙 게시 전(현재 열린 규칙 상태)" 에 실행할 것.
//
//  실행: npm run neander:backfill-emails
// ============================================================
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
} from "firebase/firestore";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const MEMBERS = "neander_members";
const MEMBER_EMAILS = "neander_member_emails";

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snap = await getDocs(collection(db, MEMBERS));
  console.log(`팀원 ${snap.size}명 확인.`);

  let seeded = 0;
  let skipped = 0;
  for (const m of snap.docs) {
    const data = m.data() as { email?: string; name?: string };
    const email = data.email?.trim().toLowerCase();
    if (!email) {
      skipped += 1;
      console.log(`  - (건너뜀) ${data.name ?? m.id}: 이메일 없음`);
      continue;
    }
    await setDoc(doc(db, MEMBER_EMAILS, email), {
      memberId: m.id,
      name: data.name ?? "",
      updatedAt: Date.now(),
    });
    seeded += 1;
    console.log(`  ✓ ${email} → ${data.name ?? m.id}`);
  }

  console.log(`\n완료: 매핑 ${seeded}건 생성/갱신, ${skipped}건 건너뜀(이메일 없음).`);
  console.log("이제 안전하게 firestore.rules 를 게시할 수 있습니다.");
  process.exit(0);
}

main().catch((e) => {
  console.error("백필 실패:", e);
  process.exit(1);
});
