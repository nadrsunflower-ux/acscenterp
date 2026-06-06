// 근무 일지(scheduler) schedules 컬렉션 점검 스크립트.
// 최근(2024-12-30 이후) 스케줄 문서를 상세 출력한다.
// 실행: npm run scheduler:check
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env.local') });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkSchedules() {
  console.log('Checking schedules collection...\n');

  const schedulesSnapshot = await getDocs(collection(db, 'schedules'));

  console.log(`Total schedules: ${schedulesSnapshot.size}\n`);

  schedulesSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.date >= '2024-12-30') {
      console.log(`ID: ${doc.id}`);
      console.log(`  date: ${data.date}`);
      console.log(`  employeeId: ${data.employeeId}`);
      console.log(`  store: ${data.store}`);
      console.log(`  time: ${data.startTime} - ${data.endTime}`);
      console.log(`  hours: ${data.hours}, pay: ${data.pay}`);
      console.log('---');
    }
  });

  process.exit(0);
}

checkSchedules().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
