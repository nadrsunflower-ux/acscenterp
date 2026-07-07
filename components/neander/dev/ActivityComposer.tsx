"use client";

// ============================================================
//  진행 소식 작성기 — 개발자가 진행 상황을 올린다
//  제목 + 상세 + 프로젝트(featureId) + 연결 작업(선택) + 스크린샷.
//  source="manual", type="update"(기본)/"note".
//  "진행 업데이트"(type update) 게시는 addActivity 에 actor 를 넘겨
//  팀 메신저에도 자동 전달된다(메모는 소음 방지를 위해 제외).
//
//  선택 props(계약):
//   - defaultTaskId    : 초기 연결 작업 프리필
//   - defaultFeatureId : 초기 연결 기능 프리필
//   - compact          : 항상 펼친 간결 모드 (TaskDetailModal 등에서 소비)
//   - onPosted         : 제출 성공 시 콜백
//  props 없이 쓰면 기존과 100% 동일하게 동작한다.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import { addActivity } from "@/lib/neander/dev/activity";
import { ScreenshotUploader } from "@/components/neander/dev/ScreenshotUploader";
import { Button, Card, Input, Select, Textarea, MemberAvatar, cn } from "@/components/neander/ui";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import type { ActivityType, DevAttachment } from "@/lib/neander/dev/types";

const TYPE_TABS: { value: ActivityType; label: string; icon: string }[] = [
  { value: "update", label: "진행 업데이트", icon: "📣" },
  { value: "note", label: "메모", icon: "🗒️" },
];

export function ActivityComposer({
  defaultTaskId,
  defaultFeatureId,
  compact = false,
  onPosted,
}: {
  defaultTaskId?: string;
  defaultFeatureId?: string;
  compact?: boolean;
  onPosted?: () => void;
} = {}) {
  const { currentMember } = useAppData();
  const { features, tasks } = useDevData();

  const [type, setType] = useState<ActivityType>("update");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [featureId, setFeatureId] = useState(defaultFeatureId ?? "");
  const [taskId, setTaskId] = useState(defaultTaskId ?? "");
  const [taskSearch, setTaskSearch] = useState("");
  const [atts, setAtts] = useState<DevAttachment[]>([]);
  const [expanded, setExpanded] = useState(compact);
  const [busy, setBusy] = useState(false);

  // 프리필 props 가 (재)전달되면 연결 상태를 동기화. props 없으면 undefined → skip.
  useEffect(() => {
    if (defaultFeatureId !== undefined) setFeatureId(defaultFeatureId);
  }, [defaultFeatureId]);
  useEffect(() => {
    if (defaultTaskId !== undefined) setTaskId(defaultTaskId);
  }, [defaultTaskId]);

  // 작업 검색: 제목 필터. 선택된 작업은 필터에서 빠져도 옵션에 유지한다.
  const filteredTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    const base = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks;
    if (taskId && !base.some((t) => t.id === taskId)) {
      const sel = tasks.find((t) => t.id === taskId);
      if (sel) return [sel, ...base];
    }
    return base;
  }, [tasks, taskSearch, taskId]);

  const canSubmit = !!currentMember && title.trim().length > 0;

  async function submit() {
    if (!canSubmit || !currentMember) return;
    setBusy(true);
    try {
      const feature = features.find((f) => f.id === featureId);
      const task = tasks.find((t) => t.id === taskId);
      await addActivity(
        {
          type,
          source: "manual",
          authorId: currentMember.id,
          authorName: currentMember.name,
          title: title.trim(),
          body: emptyToUndef(body),
          featureId: feature?.id,
          featureName: feature?.name,
          taskId: task?.id,
          taskTitle: task?.title,
          attachments: atts.length ? atts : undefined,
        },
        currentMember, // actor — "진행 업데이트"면 팀 메신저 알림
      );
      setTitle("");
      setBody("");
      // 프리필 컨텍스트는 유지(모달 재사용 대비), 아니면 초기값("")으로 복귀
      setFeatureId(defaultFeatureId ?? "");
      setTaskId(defaultTaskId ?? "");
      setTaskSearch("");
      setAtts([]);
      if (!compact) setExpanded(false);
      onPosted?.();
    } finally {
      setBusy(false);
    }
  }

  if (!currentMember) {
    return (
      <Card className="!rounded-2xl">
        <p className="text-sm text-zinc-500">
          진행 상황을 올리려면 <span className="font-medium text-zinc-700">팀원 계정</span>으로
          로그인하세요.
        </p>
      </Card>
    );
  }

  return (
    <Card className={cn("!rounded-2xl", compact && "!p-3 !shadow-none")}>
      <div className="flex items-start gap-3">
        <MemberAvatar
          name={currentMember.name}
          color={currentMember.color ?? "#71717a"}
          avatar={currentMember.avatar}
          className={compact ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm"}
        />
        <div className="min-w-0 flex-1">
          {/* 종류 세그먼트 */}
          <div className="mb-2 flex gap-1">
            {TYPE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition",
                  type === t.value
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200",
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setExpanded(true)}
            placeholder={type === "note" ? "메모 한 줄…" : "무엇을 진행했나요? (예: 결제 웹훅 연동 완료)"}
            className="!border-zinc-200 !bg-zinc-50 font-medium"
          />

          {expanded && (
            <div className="mt-2.5 flex flex-col gap-2.5">
              <Textarea
                rows={compact ? 2 : 3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="상세 내용 (선택) — 무엇을·왜·다음 할 일 등"
              />

              {/* 연결 선택 — compact(작업 상세 등에서 프리필됨)에서는 숨김 */}
              {!compact && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    value={featureId}
                    onChange={(e) => setFeatureId(e.target.value)}
                    className="!text-sm"
                    aria-label="프로젝트 연결"
                  >
                    <option value="">프로젝트 연결 (선택)</option>
                    {features.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>

                  {/* 작업 검색 인풋 + 필터된 목록 (전체 작업 연결 가능) */}
                  <div className="flex flex-col gap-1.5">
                    <Input
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      placeholder="작업 검색 (제목)…"
                      className="!py-1.5 !text-sm"
                      aria-label="연결 작업 검색"
                    />
                    <Select
                      value={taskId}
                      onChange={(e) => setTaskId(e.target.value)}
                      className="!text-sm"
                      aria-label="작업 연결"
                    >
                      <option value="">작업 연결 (선택)</option>
                      {filteredTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}

              <ScreenshotUploader scope="activity" attachments={atts} onChange={setAtts} compact />

              <div className="flex items-center gap-2">
                {/* 진행 업데이트만 팀 메신저로 전달됨을 안내 (메모는 미전달) */}
                {type === "update" && (
                  <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
                    📨 게시하면 팀 메신저에도 소식이 전달됩니다
                  </p>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {!compact && (
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 !text-xs"
                      onClick={() => {
                        setExpanded(false);
                        setBody("");
                        setAtts([]);
                      }}
                      disabled={busy}
                    >
                      접기
                    </Button>
                  )}
                  <Button className="!px-4 !py-1.5 !text-xs" onClick={submit} disabled={busy || !canSubmit}>
                    {busy ? "올리는 중…" : "소식 올리기"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
