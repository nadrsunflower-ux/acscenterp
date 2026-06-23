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
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import { getNeanderDb, getNeanderStorage, NEANDER_COL } from "@/lib/neander/firebase";
import { clean } from "./helpers";
import type { ChatAttachment, ChatMessage, ChatReads } from "@/lib/neander/types";

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
  attachment?: ChatAttachment;
}) {
  await addDoc(msgCol(), clean({ ...input, createdAt: Date.now() }));
}

// ---- 첨부 파일 업로드 --------------------------------------

/** 파일명에서 Storage 경로에 안전하지 않은 문자를 정리 */
function safeFileName(name: string): string {
  return name.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 120) || "file";
}

/**
 * 이미지/파일을 Firebase Storage(neander_chat/<conversationId>/...)에 업로드하고
 * 메시지에 붙일 ChatAttachment 를 반환한다. onProgress 로 0~100 진행률 콜백.
 */
export function uploadChatFile(
  conversationId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const contentType = file.type || "application/octet-stream";
    const path = `neander_chat/${conversationId}/${Date.now()}_${safeFileName(file.name)}`;
    const task = uploadBytesResumable(storageRef(getNeanderStorage(), path), file, {
      contentType,
    });
    task.on(
      "state_changed",
      (snap) => {
        if (snap.totalBytes > 0) {
          onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      async () => {
        try {
          // 바이트 전송 완료 — getDownloadURL 대기 구간을 100%(마무리)로 표시
          onProgress?.(100);
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            kind: contentType.startsWith("image/") ? "image" : "file",
            url,
            name: file.name,
            contentType,
            size: file.size,
          });
        } catch (e) {
          reject(e as Error);
        }
      },
    );
  });
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
