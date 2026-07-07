// ============================================================
//  브릿지 — 개발 작업 ↔ 일일업무 미러 동기화
//
//  규칙 (UNIFIED_HUB_SPEC §2.4 — 결정적·멱등):
//  · 미러 대상: status !== "backlog" && 담당자 있음. (백로그 복귀 → 미러 삭제)
//  · 담당자 1명당 일일업무 1건. date = dueDate || 오늘. category "dev".
//  · 상태 매핑: dev done → "done", 그 외 → "todo".
//    단, 일일업무 쪽에서 사용자가 연장/보류/완료로 바꾼 것은 존중하고
//    dev 가 done/재오픈으로 '전이'할 때만 매핑값으로 덮어쓴다.
//    전이 감지는 dev 문서의 lastMirroredStatus(지난 동기화 때 반영한 매핑값,
//    브릿지 전용 북키핑 — 아래 BridgeState)와 현재 매핑값 비교로 한다.
//    (현재값끼리 비교하면 제목 수정 등 무관한 sync 마다 사용자 변경이 소실됨)
//  · dueDate 없으면 기존 미러 날짜 유지(재-오늘화 금지).
//  · 담당 제외 → 그 멤버 미러 삭제. dev 작업 삭제 → 미러 전부 삭제.
//  · 연결은 DevTask.dailyTaskIds(assigneeId→dailyId) + DailyTask.sourceType/sourceId 양방향.
//  · 이 모듈은 dev/tasks.ts 를 import 하지 않는다(순환 방지) — 원시 doc 접근만.
// ============================================================
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { cleanForUpdate } from "@/lib/neander/db/helpers";
import { addTask, updateTask, deleteTask } from "@/lib/neander/db/tasks";
import { todayStr } from "@/lib/neander/format";
import type { DailyTask, DailyTaskInput } from "@/lib/neander/types";
import type { DevTask } from "@/lib/neander/dev/types";

const devRef = (id: string) => doc(getNeanderDb(), NEANDER_COL.devTasks, id);
const dailyRef = (id: string) => doc(getNeanderDb(), NEANDER_COL.dailyTasks, id);

/**
 * 브릿지 전용 북키핑 — dev 문서에만 저장하며 공개 DevTask 타입에는 노출하지 않는다.
 * lastMirroredStatus: 지난 동기화 때 미러에 반영한 매핑 상태("done"|"todo").
 * 현재 매핑값과 다르면 dev 상태가 실제로 done↔재오픈 '전이'한 것이다.
 */
type BridgeState = { lastMirroredStatus?: "done" | "todo" };

/** 미러 detail 문구 (생성 시 1회 — 이후 사용자가 고쳐도 덮어쓰지 않음) */
function mirrorDetail(task: DevTask): string {
  return `[개발${task.featureName ? "·" + task.featureName : ""}] 개발 보드에서 자동 연동됨`;
}

/**
 * dev 작업 하나의 일일업무 미러를 규칙대로 맞춘다(upsert/삭제).
 * dev 문서를 다시 읽으므로 '쓰기 직후' 호출하면 최신 상태 기준으로 동기화된다.
 * dev 작업이 이미 삭제된 경우엔 아무것도 하지 않는다(삭제는 deleteDevTask 가 선처리).
 */
export async function syncDevTaskMirrors(taskId: string): Promise<void> {
  const snap = await getDoc(devRef(taskId));
  if (!snap.exists()) return;
  const task = { id: snap.id, ...(snap.data() as Omit<DevTask, "id">) } as DevTask & BridgeState;

  const existing = task.dailyTaskIds ?? {};
  const wanted =
    task.status !== "backlog" && task.assigneeIds.length > 0 ? task.assigneeIds : [];
  const mappedStatus = task.status === "done" ? "done" : "todo";
  // 상태 '전이' 감지: 지난 동기화 때 반영한 매핑값과 다를 때만 미러 status 를 덮어쓴다.
  // 필드가 없는 과거 문서는 "todo"(미러 기본 생성 상태)로 간주 — 열린 작업의 미러를
  // 사용자가 손댄 경우를 최대한 보존하는 보수적 기본값.
  const statusTransition = (task.lastMirroredStatus ?? "todo") !== mappedStatus;
  const next: Record<string, string> = {};

  // 1) 더 이상 대상이 아닌 미러 삭제 (담당 제외 / 백로그 복귀)
  for (const [memberId, dailyId] of Object.entries(existing)) {
    if (!wanted.includes(memberId)) {
      try {
        await deleteTask(dailyId);
      } catch {
        /* 이미 없으면 무시 */
      }
    }
  }

  // 2) 대상 담당자별 upsert
  for (const memberId of wanted) {
    const memberName = task.assigneeNames[task.assigneeIds.indexOf(memberId)] ?? "";
    const dailyId = existing[memberId];

    if (dailyId) {
      const dsnap = await getDoc(dailyRef(dailyId));
      if (dsnap.exists()) {
        const cur = dsnap.data() as DailyTask;
        const patch: Partial<DailyTaskInput> = {};
        if (cur.title !== task.title) patch.title = task.title;
        if (task.dueDate && cur.date !== task.dueDate) patch.date = task.dueDate;
        // 상태는 '전이'(done↔재오픈으로 실제 바뀜)일 때만 매핑값으로 강제.
        // 전이가 없으면 사용자가 일일업무에서 바꾼 상태(연장/보류/완료)를 존중한다.
        if (statusTransition && cur.status !== mappedStatus) patch.status = mappedStatus;
        if (Object.keys(patch).length > 0) await updateTask(dailyId, patch);
        next[memberId] = dailyId;
        continue;
      }
      // 미러가 수동 삭제됨 → 아래에서 재생성
    }

    next[memberId] = await addTask({
      memberId,
      memberName,
      date: task.dueDate || todayStr(),
      category: "dev",
      title: task.title,
      detail: mirrorDetail(task),
      status: mappedStatus,
      sourceType: "dev",
      sourceId: task.id,
    });
  }

  // 3) 역링크·북키핑 갱신 (변경 시에만). updateDevTask 를 쓰지 않는다(재동기화 순환 방지).
  //    lastMirroredStatus 는 미러 patch '성공 후' 기록 — 중간 실패 시 다음 sync 가 전이를 재시도.
  const linksChanged =
    JSON.stringify(existing ?? {}) !== JSON.stringify(next) ||
    Object.keys(existing).length !== Object.keys(next).length;
  const devPatch: Record<string, unknown> = {};
  if (linksChanged) {
    devPatch.dailyTaskIds = Object.keys(next).length > 0 ? next : undefined; // 빈 맵은 필드 삭제
  }
  if (task.lastMirroredStatus !== mappedStatus) devPatch.lastMirroredStatus = mappedStatus;
  if (Object.keys(devPatch).length > 0) {
    await updateDoc(devRef(taskId), cleanForUpdate(devPatch));
  }
}

/**
 * dev 작업 삭제 직전에 호출: 남아있는 미러 일일업무를 전부 정리한다.
 * (삭제 후에는 dailyTaskIds 를 읽을 수 없으므로 반드시 '먼저' 호출)
 */
export async function removeDevTaskMirrors(taskId: string): Promise<void> {
  const snap = await getDoc(devRef(taskId));
  if (!snap.exists()) return;
  const ids = (snap.data() as Pick<DevTask, "dailyTaskIds">).dailyTaskIds ?? {};
  for (const dailyId of Object.values(ids)) {
    try {
      await deleteTask(dailyId);
    } catch {
      /* 이미 없으면 무시 */
    }
  }
}
