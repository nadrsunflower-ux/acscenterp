import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean, cleanForUpdate } from "./helpers";
import type { Member, MemberInput } from "@/lib/neander/types";

// ⚠️ 컬렉션/문서 참조는 호출 시점에 lazy 하게 만든다.
//    (AC'SCENT firebase 패턴: 모듈 import 시 throw 금지 — 빌드/프리렌더 통과)
const col = () => collection(getNeanderDb(), NEANDER_COL.members);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.members, id);

export function subscribeMembers(cb: (members: Member[]) => void) {
  const q = query(col(), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Member, "id">) })));
  });
}

export async function addMember(input: MemberInput) {
  await addDoc(col(), clean({ ...input, createdAt: Date.now() }));
}

export async function updateMember(id: string, patch: Partial<MemberInput>) {
  await updateDoc(ref(id), cleanForUpdate(patch));
}

export async function deleteMember(id: string) {
  await deleteDoc(ref(id));
}

// 기본 팀원 5명 (placeholder — 팀원 관리에서 실제 이름으로 수정)
const MEMBER_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777"];
const DEFAULT_MEMBERS: MemberInput[] = Array.from({ length: 5 }, (_, i) => ({
  name: `구성원 ${i + 1}`,
  role: "",
  color: MEMBER_COLORS[i],
}));

/** members 컬렉션이 비어있으면 기본 5명을 시드한다. 이미 있으면 false 반환. */
export async function seedDefaultMembers(): Promise<boolean> {
  const db = getNeanderDb();
  const snap = await getDocs(col());
  if (!snap.empty) return false;
  const batch = writeBatch(db);
  DEFAULT_MEMBERS.forEach((m, i) => {
    batch.set(doc(col()), clean({ ...m, createdAt: Date.now() + i }));
  });
  await batch.commit();
  return true;
}
