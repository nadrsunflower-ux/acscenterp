import {
  collection,
  doc,
  addDoc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean } from "./helpers";
import type { ChatMessage, ChatReads } from "@/lib/neander/types";

const msgCol = () => collection(getNeanderDb(), NEANDER_COL.messages);
const readsRef = (memberId: string) => doc(getNeanderDb(), NEANDER_COL.chatReads, memberId);

// ---- 대화 식별자 ------------------------------------------

export const TEAM_CONVERSATION = "team";

/** 1:1 DM 대화 id (멤버 id 정렬로 결정적 생성) */
export function dmConversationId(a: string, b: string): string {
  return "dm_" + [a, b].sort().join("__");
}

/** 이 대화가 현재 사용자(myId)에게 보이는 대화인지 */
export function isMyConversation(conversationId: string, myId: string): boolean {
  if (conversationId === TEAM_CONVERSATION) return true;
  if (!conversationId.startsWith("dm_")) return false;
  return conversationId.slice(3).split("__").includes(myId);
}

// ---- 메시지 ------------------------------------------------

/** 최근 메시지 N개 구독 (최신순 desc 반환) */
export function subscribeRecentMessages(
  n: number,
  cb: (messages: ChatMessage[]) => void,
) {
  const q = query(msgCol(), orderBy("createdAt", "desc"), limit(n));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, "id">) })));
  });
}

export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
}) {
  await addDoc(msgCol(), clean({ ...input, createdAt: Date.now() }));
}

// ---- 읽음 상태 ---------------------------------------------

/** 현재 사용자의 대화별 읽음 시각 맵 구독 */
export function subscribeReads(memberId: string, cb: (reads: ChatReads) => void) {
  return onSnapshot(readsRef(memberId), (snap) => {
    cb((snap.data() as ChatReads) ?? {});
  });
}

/** 특정 대화를 지금 시각으로 읽음 처리 */
export async function markConversationRead(memberId: string, conversationId: string) {
  await setDoc(readsRef(memberId), { [conversationId]: Date.now() }, { merge: true });
}
