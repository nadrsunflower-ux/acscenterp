"use client";

// ============================================================
//  작업 상세 모달 — 설명/체크리스트/라벨/연결 타임라인 + 인라인 편집
//  우 사이드(TaskDetailSidebar): 상태/우선순위/종류/프로젝트/담당자/마감
//  + 일일업무 연동 상태. 하단: 진행 업데이트 작성기 + CommentThread.
//  task=null 이면 렌더 안 함. 뮤테이션은 currentMember 를 actor 로 전달.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GitBranch, GitPullRequest, Megaphone, Plus, RefreshCw, StickyNote, X, type LucideIcon } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import { updateDevTask } from "@/lib/neander/dev/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { CommentThread } from "@/components/neander/dev/CommentThread";
import { ActivityComposer } from "@/components/neander/dev/ActivityComposer";
import { TaskDetailSidebar } from "@/components/neander/dev/TaskDetailSidebar";
import { KindTag } from "@/components/neander/dev/atoms";
import { Badge, Button, Dialog, Icon, IconButton, Input, Textarea, cn } from "@/components/neander/ui";
import { formatTimestamp } from "@/lib/neander/format";
import {
  devId,
  type ChecklistItem,
  type DevTask,
  type DevFeature,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

const TYPE_ICON: Record<string, LucideIcon> = {
  update: Megaphone,
  note: StickyNote,
  commit: GitBranch,
  pr: GitPullRequest,
  status: RefreshCw,
};

/** 섹션 소제목 — 대문자 캡션 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-2 text-nd-micro font-semibold uppercase tracking-wide text-nd-fg-3">
      {children}
    </h3>
  );
}

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
  // ESC 닫기·포커스 가두기·스크롤 잠금은 Dialog 가 담당한다.
  if (!task) return null;

  // task.id 로 키를 주어 다른 작업 선택 시 로컬 편집 상태 초기화
  return <DetailBody key={task.id} task={task} onClose={onClose} members={members} features={features} />;
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

  // 헤더: 종류 아이콘 + (인라인 편집 가능한) 제목 + 배정자
  const header = (
    <div className="flex items-start gap-2">
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
              aria-label="제목"
            />
            <Button size="sm" onClick={saveTitle}>
              저장
            </Button>
          </div>
        ) : (
          <span
            className={cn(
              "block text-nd-title leading-snug text-nd-fg",
              canEdit && "cursor-text rounded-[6px] hover:bg-nd-sunken",
            )}
            onClick={() => canEdit && (setTitle(task.title), setTitleEdit(true))}
            title={canEdit ? "클릭해서 제목 수정" : undefined}
          >
            {task.title}
          </span>
        )}
        {task.reporterName && (
          <p className="mt-1 text-nd-caption font-normal text-nd-fg-3">배정: {task.reporterName}</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open onClose={onClose} size="xl" title={header}>
      {/* 머리글 아래 구분선은 본문 여백 밖까지(-mx) 그린다 */}
      <div className="-mx-5 grid grid-cols-1 gap-6 border-t border-nd-line px-5 pt-5 sm:-mx-6 sm:px-6 lg:grid-cols-[1fr_300px]">
        {/* ---- 좌: 본문 ---- */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* 설명 */}
          <section>
            <SectionLabel>설명</SectionLabel>
            {descEdit && canEdit ? (
              <div className="flex flex-col gap-2">
                <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDesc(task.description ?? "");
                      setDescEdit(false);
                    }}
                  >
                    취소
                  </Button>
                  <Button size="sm" onClick={saveDesc}>
                    저장
                  </Button>
                </div>
              </div>
            ) : task.description ? (
              <p
                className={cn(
                  "whitespace-pre-wrap break-words rounded-nd-md text-nd-body leading-relaxed text-nd-fg-2",
                  canEdit && "cursor-text hover:bg-nd-sunken",
                )}
                onClick={() => canEdit && (setDesc(task.description ?? ""), setDescEdit(true))}
              >
                {task.description}
              </p>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={canEdit ? Plus : undefined}
                onClick={() => canEdit && setDescEdit(true)}
                disabled={!canEdit}
                className="-ml-2.5 text-nd-fg-3"
              >
                {canEdit ? "설명 추가" : "설명 없음"}
              </Button>
            )}
          </section>

          {/* 체크리스트 */}
          <section>
            <SectionLabel>
              체크리스트
              {checklist.length > 0 && (
                <span className="nd-num text-nd-fg-2">
                  {doneCount}/{checklist.length}
                </span>
              )}
            </SectionLabel>
            {checklist.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1">
                {checklist.map((i) => (
                  <li key={i.id} className="group flex items-center gap-2">
                    <button
                      onClick={() => canEdit && toggleItem(i.id)}
                      disabled={!canEdit}
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-nd-fast",
                        i.done
                          ? "border-nd-success bg-nd-success text-white"
                          : "border-nd-strong hover:border-nd-fg-2",
                      )}
                      aria-label="완료 토글"
                      aria-pressed={i.done}
                    >
                      {i.done && <Icon icon={Check} size={11} strokeWidth={3} />}
                    </button>
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-nd-body",
                        i.done ? "text-nd-fg-3 line-through" : "text-nd-fg-2",
                      )}
                    >
                      {i.text}
                    </span>
                    {canEdit && (
                      <IconButton
                        icon={X}
                        label="항목 삭제"
                        size="sm"
                        onClick={() => removeItem(i.id)}
                        className="shrink-0 text-nd-fg-4 opacity-0 hover:text-nd-danger focus-visible:opacity-100 group-hover:opacity-100"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <Input
                size="sm"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addChecklistItem();
                }}
                placeholder="+ 항목 추가 후 Enter"
                aria-label="체크리스트 항목 추가"
              />
            )}
          </section>

          {/* 라벨 */}
          <section>
            <SectionLabel>라벨</SectionLabel>
            {labels.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {labels.map((l) => (
                  <Badge key={l} tone="neutral" size="sm">
                    #{l}
                    {canEdit && (
                      <button
                        onClick={() => removeLabel(l)}
                        className="-mr-0.5 inline-flex text-nd-fg-3 transition-colors duration-nd-fast hover:text-nd-danger"
                        aria-label={`라벨 삭제: ${l}`}
                      >
                        <Icon icon={X} size={11} />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            )}
            {canEdit ? (
              <Input
                size="sm"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                placeholder="+ 라벨 추가 후 Enter"
                aria-label="라벨 추가"
              />
            ) : (
              labels.length === 0 && <p className="text-nd-body text-nd-fg-3">라벨 없음</p>
            )}
          </section>

          {/* 연결된 타임라인 */}
          <section>
            <SectionLabel>
              연결된 타임라인
              {linkedActivity.length > 0 && <span className="nd-num text-nd-fg-2">{linkedActivity.length}</span>}
            </SectionLabel>
            {linkedActivity.length === 0 ? (
              <p className="text-nd-body text-nd-fg-3">이 작업에 연결된 진행 기록이 없습니다.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-nd-line rounded-nd-md border border-nd-line bg-nd-sunken">
                {linkedActivity.map((a) => {
                  const I = TYPE_ICON[a.type];
                  return (
                    <li key={a.id} className="flex items-start gap-2 px-2.5 py-1.5">
                      <span className="mt-0.5 text-nd-fg-3">
                        {I ? <Icon icon={I} size={14} /> : <span aria-hidden>•</span>}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-nd-body text-nd-fg-2" title={a.title}>
                          {a.title}
                        </p>
                        <p className="text-nd-micro font-normal text-nd-fg-3">
                          {a.authorName} · {formatTimestamp(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 진행 업데이트 올리기 (타임라인 작성기 프리필) */}
          <section>
            <SectionLabel>이 작업에 진행 업데이트 올리기</SectionLabel>
            <ActivityComposer defaultTaskId={task.id} defaultFeatureId={task.featureId} compact />
          </section>
        </div>

        {/* ---- 우: 속성 사이드바 ---- */}
        <TaskDetailSidebar task={task} onClose={onClose} members={members} features={features} />
      </div>

      {/* 하단: 댓글 — 본문 여백을 채워 바닥까지 */}
      <div className="-mx-5 -mb-5 mt-5 border-t border-nd-line bg-nd-sunken px-5 py-5 sm:-mx-6 sm:px-6">
        <CommentThread targetType="task" targetId={task.id} />
      </div>
    </Dialog>
  );
}
