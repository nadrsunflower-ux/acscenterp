import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  increment,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean } from "./helpers";
import type { WorkRequest, WorkRequestInput, RequestStatus } from "@/lib/neander/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.workRequests);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.workRequests, id);

export function subscribeRequests(cb: (requests: WorkRequest[]) => void) {
  const q = query(col(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkRequest, "id">) })),
    );
  });
}

export async function addRequest(input: WorkRequestInput) {
  const now = Date.now();
  await addDoc(
    col(),
    clean({ ...input, status: "requested" as RequestStatus, createdAt: now, updatedAt: now }),
  );
}

export async function setRequestStatus(id: string, status: RequestStatus) {
  await updateDoc(ref(id), { status, updatedAt: Date.now() });
}

/** 받은 사람이 요청자에게 남기는 답장 메시지 저장 */
export async function setRequestReply(id: string, replyMessage: string) {
  await updateDoc(ref(id), { replyMessage, updatedAt: Date.now() });
}

/** 받은 사람이 '확인완료' — 알림 뱃지에서 제외 */
export async function acknowledgeRequest(id: string) {
  await updateDoc(ref(id), { acknowledged: true, updatedAt: Date.now() });
}

/** 보낸 사람의 '압박 주기' — 횟수 1 증가 (메시지 전송은 호출 측에서 처리) */
export async function nudgeRequest(id: string) {
  await updateDoc(ref(id), { nudgeCount: increment(1), updatedAt: Date.now() });
}

/** 받은 요청을 일일업무로 등록했을 때 연결된 task id 저장 (중복 추가 방지) */
export async function setRequestTask(id: string, taskId: string) {
  await updateDoc(ref(id), { taskId, updatedAt: Date.now() });
}

export async function deleteRequest(id: string) {
  await deleteDoc(ref(id));
}
