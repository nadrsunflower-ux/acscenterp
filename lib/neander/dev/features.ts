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
import { clean, cleanForUpdate } from "@/lib/neander/db/helpers";
import type { DevFeature, DevFeatureInput } from "@/lib/neander/dev/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.devFeatures);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.devFeatures, id);

/** 기능(에픽) 실시간 구독 — 표시 순서(order) 오름차순 */
export function subscribeFeatures(cb: (rows: DevFeature[]) => void) {
  const q = query(col(), orderBy("order", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DevFeature, "id">) })));
  });
}

export async function addFeature(input: DevFeatureInput): Promise<string> {
  const now = Date.now();
  const r = await addDoc(col(), clean({ ...input, createdAt: now, updatedAt: now }));
  return r.id;
}

export async function updateFeature(id: string, patch: Partial<DevFeatureInput>) {
  await updateDoc(ref(id), cleanForUpdate({ ...patch, updatedAt: Date.now() }));
}

export async function deleteFeature(id: string) {
  await deleteDoc(ref(id));
}
