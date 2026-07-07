import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit as fbLimit,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean } from "@/lib/neander/db/helpers";
import { notifyTeam, type NotifyActor } from "@/lib/neander/bridge/notify";
import type { DevActivity, DevActivityInput } from "@/lib/neander/dev/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.devActivity);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.devActivity, id);

/** 개발 타임라인 실시간 구독 — 최신순(desc), 최대 max 개 */
export function subscribeActivity(cb: (rows: DevActivity[]) => void, max = 200) {
  const q = query(col(), orderBy("createdAt", "desc"), fbLimit(max));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DevActivity, "id">) })));
  });
}

/**
 * 타임라인 활동 기록. actor 를 주고 type 이 "update"(진행 업데이트)면
 * 팀 메신저에도 소식을 쏜다(커밋/상태 자동기록은 소음 방지를 위해 제외).
 */
export async function addActivity(
  input: DevActivityInput,
  actor?: NotifyActor | null,
): Promise<string> {
  const r = await addDoc(col(), clean({ ...input, createdAt: Date.now() }));
  if (actor && input.type === "update") {
    // 본문 전문 전송 — 메신저 버블이 whitespace-pre-wrap 이라 줄바꿈 그대로 보인다.
    // (80자 미리보기로 잘랐더니 내용 파악이 안 된다는 사용자 피드백으로 전문으로 변경)
    const bodyBlock = input.body ? `\n${input.body}` : "";
    await notifyTeam(actor, `📣 [개발] ${input.authorName}: ${input.title}${bodyBlock}`);
  }
  return r.id;
}

export async function deleteActivity(id: string) {
  await deleteDoc(ref(id));
}

export async function setPinned(id: string, pinned: boolean) {
  await updateDoc(ref(id), { pinned });
}

/**
 * 이모지 반응 토글. 현재 reactions 맵을 받아 새 맵을 계산해 통째로 저장한다.
 * 이미 눌렀으면 제거, 아니면 추가. 빈 배열이 된 이모지는 키를 삭제한다.
 */
export async function toggleReaction(
  id: string,
  emoji: string,
  memberId: string,
  current?: Record<string, string[]>,
) {
  const next: Record<string, string[]> = { ...(current ?? {}) };
  const arr = next[emoji] ? [...next[emoji]] : [];
  const idx = arr.indexOf(memberId);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(memberId);
  if (arr.length === 0) delete next[emoji];
  else next[emoji] = arr;
  await updateDoc(ref(id), { reactions: next });
}
