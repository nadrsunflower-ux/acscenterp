import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean, cleanForUpdate } from "@/lib/neander/db/helpers";
import { syncDevTaskMirrors, removeDevTaskMirrors } from "@/lib/neander/bridge/dev-daily";
import { notifyTeam, type NotifyActor } from "@/lib/neander/bridge/notify";
import type { DevTask, DevTaskInput, DevStatus } from "@/lib/neander/dev/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.devTasks);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.devTasks, id);

/** 개발 작업 실시간 구독 — 최신순(정렬은 컬럼별로 화면에서 order 기준 재정렬) */
export function subscribeDevTasks(cb: (rows: DevTask[]) => void) {
  const q = query(col(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DevTask, "id">) })));
  });
}

// ---- 브릿지 헬퍼 -------------------------------------------
// 미러 동기화 실패가 원 작업(생성/수정)의 성공을 깨지 않도록 감싼다.
async function safeSync(id: string) {
  try {
    await syncDevTaskMirrors(id);
  } catch {
    /* 미러 동기화 실패는 다음 변경 때 재시도됨 */
  }
}

/**
 * 작업 생성. actor 를 주면:
 *  · 담당자별 일일업무 미러 자동 생성(→ 대시보드 캘린더 반영)
 *  · 담당자가 있으면 팀 메신저에 배정 알림
 * (actor 없이 호출해도 미러 동기화는 수행 — 알림만 생략)
 */
export async function addDevTask(input: DevTaskInput, actor?: NotifyActor | null): Promise<string> {
  const now = Date.now();
  const r = await addDoc(col(), clean({ ...input, createdAt: now, updatedAt: now }));
  await safeSync(r.id);
  if (actor && input.assigneeIds.length > 0) {
    const due = input.dueDate ? ` · 마감 ${input.dueDate}` : "";
    await notifyTeam(
      actor,
      `🧩 [개발] ${actor.name} → ${input.assigneeNames.join(", ")}: "${input.title}" 배정${due}`,
    );
  }
  return r.id;
}

/**
 * 작업 수정. 제목/마감/담당자 변경 시 일일업무 미러도 따라간다.
 * actor 가 있고 담당자가 '추가'되면 팀 메신저에 배정 알림.
 */
export async function updateDevTask(
  id: string,
  patch: Partial<DevTaskInput>,
  actor?: NotifyActor | null,
) {
  const touchesMirror =
    "title" in patch || "dueDate" in patch || "assigneeIds" in patch || "status" in patch;

  // 담당자 추가 알림용 — 변경 전 스냅샷 (필요할 때만 1회 읽기)
  let prevAssignees: string[] | null = null;
  if (actor && patch.assigneeIds) {
    const snap = await getDoc(ref(id));
    prevAssignees = snap.exists() ? ((snap.data() as DevTask).assigneeIds ?? []) : [];
  }

  await updateDoc(ref(id), cleanForUpdate({ ...patch, updatedAt: Date.now() }));
  if (touchesMirror) await safeSync(id);

  if (actor && patch.assigneeIds && prevAssignees) {
    const addedIdx = patch.assigneeIds
      .map((mid, i) => (prevAssignees!.includes(mid) ? -1 : i))
      .filter((i) => i >= 0);
    if (addedIdx.length > 0) {
      const names = addedIdx.map((i) => patch.assigneeNames?.[i] ?? "").filter(Boolean);
      const snap = await getDoc(ref(id));
      const title = snap.exists() ? (snap.data() as DevTask).title : "";
      if (names.length > 0 && title) {
        await notifyTeam(actor, `🧩 [개발] ${actor.name} → ${names.join(", ")}: "${title}" 배정`);
      }
    }
  }
}

/**
 * 상태 변경. done 으로 갈 때 doneAt 을 찍고, done 에서 벗어나면 doneAt 을 제거한다.
 * order 를 주면 컬럼 내 위치도 함께 지정(드래그 이동 시).
 * ⚠️ order 를 넘기지 않으면 order 필드는 건드리지 않는다(기존 정렬 위치 보존).
 *    (cleanForUpdate 는 undefined 를 deleteField 로 바꾸므로, 미지정 order 를
 *     그대로 넘기면 정렬값이 삭제되는 버그가 됨 → 조건부로만 포함한다.)
 * actor 를 주면 리뷰 요청/완료 '전이'시 팀 메신저 알림 + 미러 상태 동기화.
 */
export async function setDevTaskStatus(
  id: string,
  status: DevStatus,
  order?: number,
  actor?: NotifyActor | null,
) {
  const snap = await getDoc(ref(id));
  const prev = snap.exists() ? (snap.data() as DevTask) : null;

  const patch: Record<string, unknown> = {
    status,
    doneAt: status === "done" ? Date.now() : undefined,
    updatedAt: Date.now(),
  };
  if (order !== undefined) patch.order = order;
  await updateDoc(ref(id), cleanForUpdate(patch));
  await safeSync(id);

  if (actor && prev && prev.status !== status) {
    if (status === "review") await notifyTeam(actor, `👀 [개발] "${prev.title}" 리뷰 요청 (${actor.name})`);
    if (status === "done") await notifyTeam(actor, `✅ [개발] "${prev.title}" 완료 (${actor.name})`);
  }
}

/**
 * 드래그 이동: 컬럼(status) + 정렬(order) 동시 갱신.
 * ⚠️ doneAt(완료 시각)은 '상태 전이'에만 반응해야 한다. 같은 컬럼 내 순서만
 *    바꾸거나 이미 done 인 카드를 재정렬할 때는 원래 완료 시각을 보존한다.
 *    (setDevTaskStatus 재사용 시 done 이기만 하면 doneAt 을 매번 '지금'으로
 *     덮어써 완료 시각이 소실되고 대시보드 주간 집계가 오염됨 → 직접 구현한다.)
 */
export async function reorderDevTask(
  id: string,
  status: DevStatus,
  order: number,
  actor?: NotifyActor | null,
) {
  const snap = await getDoc(ref(id));
  const prev = snap.exists() ? (snap.data() as DevTask) : null;
  const wasDone = prev?.status === "done";

  const patch: Record<string, unknown> = { status, order, updatedAt: Date.now() };
  if (status === "done" && !wasDone) {
    patch.doneAt = Date.now();       // 새로 완료됨 → 완료 시각 기록
  } else if (status !== "done" && wasDone) {
    patch.doneAt = undefined;        // 완료 해제 → doneAt 삭제(cleanForUpdate가 deleteField)
  }
  // 그 외(같은 상태 내 정렬, done→done 재정렬)에는 doneAt 미포함 → 기존 값 보존.
  await updateDoc(ref(id), cleanForUpdate(patch));

  if (prev && prev.status !== status) {
    await safeSync(id); // 상태가 실제로 바뀐 경우만 미러 동기화 (순수 재정렬은 스킵)
    if (actor) {
      if (status === "review") await notifyTeam(actor, `👀 [개발] "${prev.title}" 리뷰 요청 (${actor.name})`);
      if (status === "done") await notifyTeam(actor, `✅ [개발] "${prev.title}" 완료 (${actor.name})`);
    }
  }
}

/** 작업 삭제 — 연동된 일일업무 미러를 먼저 정리한 뒤 본문을 지운다. */
export async function deleteDevTask(id: string) {
  try {
    await removeDevTaskMirrors(id);
  } catch {
    /* 미러 정리 실패해도 본문 삭제는 진행 */
  }
  await deleteDoc(ref(id));
}
