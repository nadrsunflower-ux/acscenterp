// 근무 일지(scheduler) 전체 데이터 초기화 스크립트.
// schedules / weekSchedules / weekNotes 컬렉션을 모두 비운다(직원은 보존).
// 실행: npm run scheduler:clear-all
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
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

async function clearAllData() {
  console.log('Clearing all schedule data...\n');

  // Clear schedules collection
  const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
  console.log(`Deleting ${schedulesSnapshot.size} schedules...`);
  for (const docSnap of schedulesSnapshot.docs) {
    await deleteDoc(doc(db, 'schedules', docSnap.id));
  }
  console.log('Schedules cleared.');

  // Clear weekSchedules collection
  const weekSchedulesSnapshot = await getDocs(collection(db, 'weekSchedules'));
  console.log(`Deleting ${weekSchedulesSnapshot.size} weekSchedules...`);
  for (const docSnap of weekSchedulesSnapshot.docs) {
    await deleteDoc(doc(db, 'weekSchedules', docSnap.id));
  }
  console.log('WeekSchedules cleared.');

  // Clear weekNotes collection
  const weekNotesSnapshot = await getDocs(collection(db, 'weekNotes'));
  console.log(`Deleting ${weekNotesSnapshot.size} weekNotes...`);
  for (const docSnap of weekNotesSnapshot.docs) {
    await deleteDoc(doc(db, 'weekNotes', docSnap.id));
  }
  console.log('WeekNotes cleared.');

  console.log('\nAll data cleared successfully!');
  process.exit(0);
}

clearAllData().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
