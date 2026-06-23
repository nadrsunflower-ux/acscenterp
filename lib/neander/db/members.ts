import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
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

// ---- 이메일 → 팀원 매핑(보안 규칙 게이트 근거) -------------------
//  보안 규칙은 neander_member_emails/{email} 존재 여부로 '허용 팀원'을
//  판정한다. 팀원의 이메일이 추가/변경/삭제될 때 이 매핑을 동기화한다.
const emailRef = (email: string) =>
  doc(getNeanderDb(), NEANDER_COL.memberEmails, email.trim().toLowerCase());

async function setEmailLookup(email: string, memberId: string, name?: string) {
  const e = email.trim().toLowerCase();
  if (!e) return;
  await setDoc(emailRef(e), clean({ memberId, name, updatedAt: Date.now() }));
}

async function removeEmailLookup(email?: string) {
  const e = email?.trim().toLowerCase();
  if (!e) return;
  await deleteDoc(emailRef(e)).catch(() => {});
}

export function subscribeMembers(cb: (members: Member[]) => void) {
  const q = query(col(), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Member, "id">) })));
  });
}

export async function addMember(input: MemberInput) {
  const docRef = await addDoc(col(), clean({ ...input, createdAt: Date.now() }));
  if (input.email) await setEmailLookup(input.email, docRef.id, input.name);
}

export async function updateMember(id: string, patch: Partial<MemberInput>) {
  // 이메일이 바뀌면 매핑(neander_member_emails)도 함께 동기화
  if ("email" in patch) {
    const before = (await getDoc(ref(id))).data() as Member | undefined;
    const oldEmail = before?.email;
    const newEmail = patch.email;
    if (oldEmail && oldEmail.toLowerCase() !== (newEmail ?? "").toLowerCase()) {
      await removeEmailLookup(oldEmail);
    }
    await updateDoc(ref(id), cleanForUpdate(patch));
    if (newEmail) await setEmailLookup(newEmail, id, patch.name ?? before?.name);
  } else {
    await updateDoc(ref(id), cleanForUpdate(patch));
  }
}

export async function deleteMember(id: string) {
  const before = (await getDoc(ref(id))).data() as Member | undefined;
  await deleteDoc(ref(id));
  await removeEmailLookup(before?.email);
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
