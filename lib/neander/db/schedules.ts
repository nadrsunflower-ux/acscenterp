import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean, cleanForUpdate } from "./helpers";
import type { Schedule, ScheduleInput } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.schedules);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.schedules, id);

/** 일정 날짜 오름차순(가까운 일정 먼저)으로 구독 */
export function subscribeSchedules(cb: (schedules: Schedule[]) => void) {
  const q = query(col(), orderBy("date", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Schedule, "id">) })));
  });
}

export async function addSchedule(input: ScheduleInput) {
  const now = Date.now();
  await addDoc(col(), clean({ ...input, createdAt: now, updatedAt: now }));
}

export async function updateSchedule(id: string, patch: Partial<ScheduleInput>) {
  await updateDoc(ref(id), cleanForUpdate({ ...patch, updatedAt: Date.now() }));
}

export async function deleteSchedule(id: string) {
  await deleteDoc(ref(id));
}
