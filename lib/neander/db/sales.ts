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
import type { Sale, SaleInput } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.sales);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.sales, id);

/** 최신 등록순으로 전체 구독 (필터/집계는 클라이언트에서 처리) */
export function subscribeSales(cb: (sales: Sale[]) => void) {
  const q = query(col(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Sale, "id">) })));
  });
}

export async function addSale(input: SaleInput) {
  await addDoc(col(), clean({ ...input, createdAt: Date.now() }));
}

export async function updateSale(id: string, patch: Partial<SaleInput>) {
  await updateDoc(ref(id), cleanForUpdate(patch));
}

export async function deleteSale(id: string) {
  await deleteDoc(ref(id));
}
