// 근무 일지(scheduler) 스케줄 데이터 초기화 스크립트.
// schedules / weekSchedules / weekNotes 컬렉션만 비우고 employees(직원)는 보존.
// 실행: npm run scheduler:clear-schedules
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore';
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

async function clearSchedules() {
  console.log('Clearing schedule data...');

  // schedules 컬렉션 삭제
  const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
  console.log(`Deleting ${schedulesSnapshot.size} documents from schedules collection...`);
  for (const doc of schedulesSnapshot.docs) {
    await deleteDoc(doc.ref);
  }

  // weekSchedules 컬렉션 삭제
  const weekSchedulesSnapshot = await getDocs(collection(db, 'weekSchedules'));
  console.log(`Deleting ${weekSchedulesSnapshot.size} documents from weekSchedules collection...`);
  for (const doc of weekSchedulesSnapshot.docs) {
    await deleteDoc(doc.ref);
  }

  // weekNotes 컬렉션 삭제
  const weekNotesSnapshot = await getDocs(collection(db, 'weekNotes'));
  console.log(`Deleting ${weekNotesSnapshot.size} documents from weekNotes collection...`);
  for (const doc of weekNotesSnapshot.docs) {
    await deleteDoc(doc.ref);
  }

  console.log('All schedule data cleared successfully!');
  console.log('Employee data (직원 정보) has been preserved.');
  process.exit(0);
}

clearSchedules().catch((error) => {
  console.error('Error clearing schedules:', error);
  process.exit(1);
});
