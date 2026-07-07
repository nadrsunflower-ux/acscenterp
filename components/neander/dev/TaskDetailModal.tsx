"use client";

// ============================================================
//  작업 상세 모달 — 설명/체크리스트/라벨/연결 타임라인 + 인라인 편집
//  우 사이드(TaskDetailSidebar): 상태/우선순위/종류/프로젝트/담당자/마감
//  + 일일업무 연동 상태. 하단: 진행 업데이트 작성기 + CommentThread.
//  task=null 이면 렌더 안 함. 뮤테이션은 currentMember 를 actor 로 전달.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import { updateDevTask } from "@/lib/neander/dev/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { CommentThread } from "@/components/neander/dev/CommentThread";
import { ActivityComposer } from "@/components/neander/dev/ActivityComposer";
import { TaskDetailSidebar } from "@/components/neander/dev/TaskDetailSidebar";
import { KindTag } from "@/components/neander/dev/atoms";
import { Button, Input, Textarea, cn } from "@/components/neander/ui";
import { formatTimestamp } from "@/lib/neander/format";
import {
  devId,
  type ChecklistItem,
  type DevTask,
  type DevFeature,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

const TYPE_ICON: Record<string, string> = {
  update: "📣",
  note: "🗒️",
  commit: "🔀",
  pr: "🔃",
  status: "🔁",
};

export function TaskDetailModal({
  task,
  onClose,
  members,
  features,
}: {
  task: DevTask | null;
  onClose: () => void;
  members: Member[];
  features: DevFeature[];
}) {
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [task, onClose]);

  if (!task) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`작업 상세: ${task.title}`}
    >
      {/* task.id 로 키를 주어 다른 작업 선택 시 로컬 편집 상태 초기화 */}
      <DetailBody key={task.id} task={task} onClose={onClose} members={members} features={features} />
    </div>
  );
}

function DetailBody({
  task,
  onClose,
  members,
  features,
}: {
  task: DevTask;
  onClose: () => void;
  members: Member[];
  features: DevFeature[];
}) {
  const { currentMember } = useAppData();
  const { activity } = useDevData();
  const canEdit = !!currentMember;

  const [titleEdit, setTitleEdit] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [descEdit, setDescEdit] = useState(false);
  const [desc, setDesc] = useState(task.description ?? "");
  const [newItem, setNewItem] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const linkedActivity = useMemo(
    () => activity.filter((a) => a.taskId === task.id),
    [activity, task.id],
  );

  // 체크리스트 로컬 낙관 버퍼. 연속 편집이 onSnapshot 반영보다 빨라도 유실되지 않도록
  // 렌더용 state 와 최신값 ref 를 함께 둔다. 서버 확정본(task.checklist) 변화 시 병합.
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist ?? []);
  const checklistRef = useRef(checklist);
  useEffect(() => {
    const server = task.checklist ?? [];
    checklistRef.current = server;
    setChecklist(server);
  }, [task.checklist]);

  // 라벨도 동일한 낙관 버퍼 패턴(연속 추가/삭제 유실 방지).
  const [labels, setLabels] = useState<string[]>(task.labels ?? []);
  const labelsRef = useRef(labels);
  useEffect(() => {
    const server = task.labels ?? [];
    labelsRef.current = server;
    setLabels(server);
  }, [task.labels]);

  function saveTitle() {
    const t = title.trim();
    if (t && t !== task.title) updateDevTask(task.id, { title: t }, currentMember);
    setTitleEdit(false);
  }
  function saveDesc() {
    updateDevTask(task.id, { description: emptyToUndef(desc) }, currentMember);
    setDescEdit(false);
  }

  // 항상 최신 로컬 버퍼를 기준으로 계산·반영·영속화.
  function writeChecklist(next: ChecklistItem[]) {
    checklistRef.current = next;
    setChecklist(next);
    updateDevTask(task.id, { checklist: next }, currentMember);
  }
  function addChecklistItem() {
    const t = newItem.trim();
    if (!t) return;
    writeChecklist([...checklistRef.current, { id: devId("cl"), text: t, done: false }]);
    setNewItem("");
  }
  function toggleItem(id: string) {
    writeChecklist(checklistRef.current.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }
  function removeItem(id: string) {
    writeChecklist(checklistRef.current.filter((i) => i.id !== id));
  }

  // 라벨: 문자열 배열. 빈 배열이면 undefined 로 넘겨 필드 제거(cleanForUpdate).
  function writeLabels(next: string[]) {
    labelsRef.current = next;
    setLabels(next);
    updateDevTask(task.id, { labels: next.length ? next : undefined }, currentMember);
  }
  function addLabel() {
    const t = newLabel.trim().replace(/^#+/, "");
    setNewLabel("");
    if (!t || labelsRef.current.includes(t)) return;
    writeLabels([...labelsRef.current, t]);
  }
  function removeLabel(l: string) {
    writeLabels(labelsRef.current.filter((x) => x !== l));
  }

  const doneCount = checklist.filter((i) => i.done).length;

  return (
    <div className="my-auto flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      {/* 헤더 (고정) — 본문만 내부 스크롤 */}
      <div className="flex shrink-0 items-start gap-2 border-b border-zinc-100 p-5 sm:p-6">
        <span className="mt-1">
          <KindTag kind={task.kind} iconOnly />
        </span>
        <div className="min-w-0 flex-1">
          {titleEdit && canEdit ? (
            <div className="flex items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                }}
                autoFocus
                className="font-semibold"
              />
              <Button className="!px-3 !py-1.5 !text-xs" onClick={saveTitle}>
                저장
              </Button>
            </div>
          ) : (
            <h2
              className={cn(
                "text-lg font-bold leading-snug tracking-tight text-zinc-900",
                canEdit && "cursor-text rounded hover:bg-zinc-50",
              )}
              onClick={() => canEdit && (setTitle(task.title), setTitleEdit(true))}
              title={canEdit ? "클릭해서 제목 수정" : undefined}
            >
              {task.title}
            </h2>
          )}
          {task.reporterName && (
            <p className="mt-1 text-xs text-zinc-400">배정: {task.reporterName}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_300px]">
          {/* ---- 좌: 본문 ---- */}
          <div className="flex min-w-0 flex-col gap-5">
            {/* 설명 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">설명</h3>
              {descEdit && canEdit ? (
                <div className="flex flex-col gap-2">
                  <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 !text-xs"
                      onClick={() => {
                        setDesc(task.description ?? "");
                        setDescEdit(false);
                      }}
                    >
                      취소
                    </Button>
                    <Button className="!px-3 !py-1.5 !text-xs" onClick={saveDesc}>
                      저장
                    </Button>
                  </div>
                </div>
              ) : task.description ? (
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-lg text-sm leading-relaxed text-zinc-700",
                    canEdit && "cursor-text hover:bg-zinc-50",
                  )}
                  onClick={() => canEdit && (setDesc(task.description ?? ""), setDescEdit(true))}
                >
                  {task.description}
                </p>
              ) : (
                <button
                  onClick={() => canEdit && setDescEdit(true)}
                  disabled={!canEdit}
                  className="text-sm text-zinc-400 hover:text-indigo-600 disabled:hover:text-zinc-400"
                >
                  {canEdit ? "＋ 설명 추가" : "설명 없음"}
                </button>
              )}
            </section>

            {/* 체크리스트 */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                체크리스트
                {checklist.length > 0 && (
                  <span className="tabular-nums text-zinc-500">
                    {doneCount}/{checklist.length}
                  </span>
                )}
              </h3>
              {checklist.length > 0 && (
                <ul className="mb-2 flex flex-col gap-1">
                  {checklist.map((i) => (
                    <li key={i.id} className="group flex items-center gap-2">
                      <button
                        onClick={() => canEdit && toggleItem(i.id)}
                        disabled={!canEdit}
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] transition",
                          i.done
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-zinc-300 hover:border-zinc-500",
                        )}
                        aria-label="완료 토글"
                      >
                        {i.done && "✓"}
                      </button>
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm",
                          i.done ? "text-zinc-400 line-through" : "text-zinc-700",
                        )}
                      >
                        {i.text}
                      </span>
                      {canEdit && (
                        <button
                          onClick={() => removeItem(i.id)}
                          className="shrink-0 text-xs text-zinc-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                          aria-label="항목 삭제"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addChecklistItem();
                  }}
                  placeholder="+ 항목 추가 후 Enter"
                  className="!py-1.5 !text-sm"
                />
              )}
            </section>

            {/* 라벨 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">라벨</h3>
              {labels.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {labels.map((l) => (
                    <span
                      key={l}
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
                    >
                      #{l}
                      {canEdit && (
                        <button
                          onClick={() => removeLabel(l)}
                          className="text-zinc-400 transition hover:text-red-500"
                          aria-label={`라벨 삭제: ${l}`}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {canEdit ? (
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLabel();
                    }
                  }}
                  placeholder="+ 라벨 추가 후 Enter"
                  className="!py-1.5 !text-sm"
                />
              ) : (
                labels.length === 0 && <p className="text-sm text-zinc-400">라벨 없음</p>
              )}
            </section>

            {/* 연결된 타임라인 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                연결된 타임라인{" "}
                {linkedActivity.length > 0 && <span className="text-zinc-500">{linkedActivity.length}</span>}
              </h3>
              {linkedActivity.length === 0 ? (
                <p className="text-sm text-zinc-400">이 작업에 연결된 진행 기록이 없습니다.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {linkedActivity.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start gap-2 rounded-lg border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5"
                    >
                      <span className="text-sm leading-tight">{TYPE_ICON[a.type] ?? "•"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-700">{a.title}</p>
                        <p className="text-[11px] text-zinc-400">
                          {a.authorName} · {formatTimestamp(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 진행 업데이트 올리기 (타임라인 작성기 프리필) */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                이 작업에 진행 업데이트 올리기
              </h3>
              <ActivityComposer defaultTaskId={task.id} defaultFeatureId={task.featureId} compact />
            </section>
          </div>

          {/* ---- 우: 속성 사이드바 ---- */}
          <TaskDetailSidebar task={task} onClose={onClose} members={members} features={features} />
        </div>

        {/* 하단: 댓글 */}
        <div className="border-t border-zinc-100 bg-zinc-50/50 p-5 sm:p-6">
          <CommentThread targetType="task" targetId={task.id} />
        </div>
      </div>
    </div>
  );
}
