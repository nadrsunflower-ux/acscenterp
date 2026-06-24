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
import type { Shortcut, ShortcutInput } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.shortcuts);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.shortcuts, id);

/**
 * 전체 바로가기 구독 (생성순 오름차순).
 * 분류 필터는 클라이언트에서 처리 → Firestore 복합 인덱스 불필요.
 */
export function subscribeShortcuts(cb: (shortcuts: Shortcut[]) => void) {
  const q = query(col(), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shortcut, "id">) })));
  });
}

export async function addShortcut(input: ShortcutInput): Promise<string> {
  const now = Date.now();
  const refDoc = await addDoc(col(), clean({ ...input, createdAt: now, updatedAt: now }));
  return refDoc.id;
}

export async function updateShortcut(id: string, patch: Partial<ShortcutInput>) {
  await updateDoc(ref(id), cleanForUpdate({ ...patch, updatedAt: Date.now() }));
}

export async function deleteShortcut(id: string) {
  await deleteDoc(ref(id));
}
