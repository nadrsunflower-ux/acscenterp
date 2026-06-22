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
import type { Meeting, MeetingInput } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.meetings);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.meetings, id);

/** 회의 날짜 최신순으로 구독 */
export function subscribeMeetings(cb: (meetings: Meeting[]) => void) {
  const q = query(col(), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Meeting, "id">) })));
  });
}

export async function addMeeting(input: MeetingInput): Promise<string> {
  const now = Date.now();
  const refDoc = await addDoc(col(), clean({ ...input, createdAt: now, updatedAt: now }));
  return refDoc.id;
}

export async function updateMeeting(id: string, patch: Partial<MeetingInput>) {
  await updateDoc(ref(id), cleanForUpdate({ ...patch, updatedAt: Date.now() }));
}

export async function deleteMeeting(id: string) {
  await deleteDoc(ref(id));
}
