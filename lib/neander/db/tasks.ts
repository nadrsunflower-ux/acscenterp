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
import type { DailyTask, DailyTaskInput, TaskStatus } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.dailyTasks);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.dailyTasks, id);

export function subscribeTasks(cb: (tasks: DailyTask[]) => void) {
  const q = query(col(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DailyTask, "id">) })));
  });
}

export async function addTask(input: DailyTaskInput): Promise<string> {
  const now = Date.now();
  const refDoc = await addDoc(col(), clean({ ...input, createdAt: now, updatedAt: now }));
  return refDoc.id;
}

export async function updateTask(id: string, patch: Partial<DailyTaskInput>) {
  await updateDoc(ref(id), cleanForUpdate({ ...patch, updatedAt: Date.now() }));
}

/** 예정/완료 등으로 전환 (연장일 필드는 제거) */
export async function setTaskStatus(id: string, status: TaskStatus) {
  await updateDoc(
    ref(id),
    cleanForUpdate({ status, extendedDate: undefined, updatedAt: Date.now() }),
  );
}

/** 연장 상태로 전환하며 연장 날짜 지정 */
export async function setTaskExtended(id: string, extendedDate: string) {
  await updateDoc(ref(id), { status: "extended", extendedDate, updatedAt: Date.now() });
}

export async function deleteTask(id: string) {
  await deleteDoc(ref(id));
}
