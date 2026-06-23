// ============================================================
//  채팅방(Conversation) DB — NEANDER ERP
// ------------------------------------------------------------
//  사용자가 직접 만든 1:1 / 단체 채팅방. "team"(전체 팀 채팅)과
//  기본 1:1 DM("dm_...")은 별도 문서 없이 동작하지만, 이름을 지정해
//  여러 개 만들 수 있는 방은 이 컬렉션에 문서로 저장한다.
//  메시지의 conversationId 로 이 문서 id 를 사용한다.
// ============================================================
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  arrayRemove,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean } from "./helpers";
import type { Conversation, ConversationInput } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.conversations);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.conversations, id);

/**
 * 내가 참여한 채팅방 실시간 구독.
 * array-contains 단일 조건이라 복합 인덱스가 필요 없다(정렬은 클라이언트에서).
 */
export function subscribeConversations(
  memberId: string,
  cb: (rooms: Conversation[]) => void,
) {
  const q = query(col(), where("memberIds", "array-contains", memberId));
  return onSnapshot(q, (snap) => {
    const rooms = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Conversation, "id">),
    }));
    // 최근 활동(updatedAt) 내림차순
    rooms.sort((a, b) => b.updatedAt - a.updatedAt);
    cb(rooms);
  });
}

/** 채팅방 생성 → 새 문서 id 반환 */
export async function createConversation(input: ConversationInput): Promise<string> {
  const now = Date.now();
  const docRef = await addDoc(
    col(),
    clean({ ...input, createdAt: now, updatedAt: now }),
  );
  return docRef.id;
}

/** 채팅방 이름 변경 */
export async function renameConversation(id: string, name: string) {
  await updateDoc(ref(id), { name, updatedAt: Date.now() });
}

/** 채팅방 활동 시각 갱신 (메시지 전송 시 목록 정렬용) */
export async function touchConversation(id: string) {
  await updateDoc(ref(id), { updatedAt: Date.now() });
}

/**
 * 채팅방 나가기. 남은 인원이 없으면 방 문서를 삭제한다.
 * arrayRemove 로 원자적으로 제거해 동시에 여러 명이 나가도 유실되지 않는다.
 * (메시지 기록은 남지만 더 이상 목록에 노출되지 않음)
 */
export async function leaveConversation(id: string, memberId: string) {
  await updateDoc(ref(id), { memberIds: arrayRemove(memberId), updatedAt: Date.now() });
  // 최신 상태를 다시 읽어 비었으면 정리 (동시 삭제 경쟁은 무시)
  const snap = await getDoc(ref(id));
  if (snap.exists() && ((snap.data().memberIds as string[]) ?? []).length === 0) {
    await deleteDoc(ref(id)).catch(() => {});
  }
}

/** 채팅방 참여자 교체 (초대/제외) */
export async function setConversationMembers(id: string, memberIds: string[]) {
  await updateDoc(ref(id), { memberIds, updatedAt: Date.now() });
}
