"use client";

// ============================================================
//  진행 소식 항목 — 한 개의 개발 활동(수동 업데이트/커밋/PR)
//  반응(이모지) · 댓글 토글 · 핀 · 삭제.
//  source 배지(수동/GitHub/Claude)로 출처를 시각 구분하고,
//  커밋(meta.sha) 항목은 제목을 모노스페이스로 요약한다.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAppData } from "@/components/neander/app-data";
import { toggleReaction, deleteActivity, setPinned } from "@/lib/neander/dev/activity";
import { AttachmentGallery } from "@/components/neander/dev/ScreenshotUploader";
import { FeatureChip } from "@/components/neander/dev/atoms";
import { CommentThread } from "@/components/neander/dev/CommentThread";
import { MemberAvatar, cn } from "@/components/neander/ui";
import { formatTimestamp } from "@/lib/neander/format";
import type { DevActivity, DevFeature } from "@/lib/neander/dev/types";

const REACTIONS = ["👍", "🔥", "🎉", "👀", "❤️"];

const SOURCE_META: Record<DevActivity["source"], { label: string; icon: string; color: string }> = {
  manual: { label: "수동", icon: "✍️", color: "#6366f1" },
  github: { label: "GitHub", icon: "🐙", color: "#111827" },
  claude: { label: "Claude", icon: "🤖", color: "#d97757" },
};

const TYPE_ICON: Record<DevActivity["type"], string> = {
  update: "📣",
  note: "🗒️",
  commit: "🔀",
  pr: "🔃",
  status: "🔁",
};

export function ActivityItem({
  activity,
  feature,
}: {
  activity: DevActivity;
  feature?: DevFeature;
}) {
  const { currentMember, members } = useAppData();
  const [showComments, setShowComments] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const reactRef = useRef<HTMLDivElement>(null);

  // 반응 팝오버: 바깥 클릭 / ESC 로 닫기 (터치·키보드 지원)
  useEffect(() => {
    if (!reactOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (reactRef.current && !reactRef.current.contains(e.target as Node)) {
        setReactOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setReactOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [reactOpen]);

  const a = activity;
  const isAuthor = !!currentMember && currentMember.id === a.authorId;
  const authorColor = members.find((m) => m.id === a.authorId)?.color ?? SOURCE_META[a.source].color;
  const authorAvatar = members.find((m) => m.id === a.authorId)?.avatar;
  const src = SOURCE_META[a.source];

  function react(emoji: string) {
    if (!currentMember) return;
    toggleReaction(a.id, emoji, currentMember.id, a.reactions);
  }

  const reactionEntries = Object.entries(a.reactions ?? {}).filter(([, ids]) => ids.length > 0);

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-white p-4 shadow-sm transition",
        a.pinned ? "border-amber-200 ring-1 ring-amber-100" : "border-zinc-200",
      )}
    >
      {a.pinned && (
        <span className="absolute -top-2 left-4 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-white">
          📌 고정됨
        </span>
      )}

      <div className="flex items-start gap-3">
        <MemberAvatar name={a.authorName} color={authorColor} avatar={authorAvatar} className="h-8 w-8 text-xs" />
        <div className="min-w-0 flex-1">
          {/* 헤더 */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-zinc-800">{a.authorName}</span>
            <span className="text-sm leading-none" title={a.type}>
              {TYPE_ICON[a.type]}
            </span>
            {/* source 배지 — 수동/GitHub/Claude 출처를 항상 표시 */}
            <span
              className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: `${src.color}14`,
                borderColor: `${src.color}33`,
                color: src.color,
              }}
              title={`출처: ${src.label}`}
            >
              {src.icon} {src.label}
            </span>
            <span className="text-[11px] text-zinc-400">{formatTimestamp(a.createdAt)}</span>
            <div className="ml-auto flex items-center gap-1">
              {(isAuthor || currentMember) && (
                <button
                  onClick={() => setPinned(a.id, !a.pinned)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs transition",
                    a.pinned ? "text-amber-500" : "text-zinc-300 hover:text-amber-500",
                  )}
                  aria-label="고정 토글"
                  title="고정"
                >
                  📌
                </button>
              )}
              {isAuthor && (
                <button
                  onClick={() => {
                    if (confirm("이 항목을 삭제할까요?")) deleteActivity(a.id);
                  }}
                  className="rounded px-1.5 py-0.5 text-xs text-zinc-300 hover:text-red-500"
                  aria-label="삭제"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* 제목 — 커밋(meta.sha) 항목은 모노스페이스 요약 */}
          {a.meta?.sha ? (
            <p className="mt-0.5 break-words font-mono text-[13px] font-medium leading-snug text-zinc-800">
              {a.title}
            </p>
          ) : (
            <p className="mt-0.5 text-[15px] font-semibold leading-snug text-zinc-900">{a.title}</p>
          )}

          {/* 태그들 */}
          {(a.featureName || a.taskTitle) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {a.featureName && <FeatureChip feature={feature} name={a.featureName} />}
              {a.taskTitle &&
                (a.taskId ? (
                  <Link
                    href={`/neander/dev/board?task=${a.taskId}`}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 transition hover:bg-indigo-50 hover:text-indigo-600"
                    aria-label={`연결 작업 열기: ${a.taskTitle}`}
                  >
                    🔗 {a.taskTitle}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                    🔗 {a.taskTitle}
                  </span>
                ))}
            </div>
          )}

          {/* 본문 */}
          {a.body && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-600">
              {a.body}
            </p>
          )}

          {/* 자동연동 커밋/PR 메타 */}
          {a.meta && (a.meta.sha || a.meta.branch || a.meta.url) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              {a.meta.branch && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono">⎇ {a.meta.branch}</span>
              )}
              {a.meta.sha && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono">{a.meta.sha.slice(0, 7)}</span>
              )}
              {typeof a.meta.additions === "number" && (
                <span className="text-emerald-600">+{a.meta.additions}</span>
              )}
              {typeof a.meta.deletions === "number" && (
                <span className="text-red-500">-{a.meta.deletions}</span>
              )}
              {a.meta.url && (
                <a href={a.meta.url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
                  원본 보기 ↗
                </a>
              )}
            </div>
          )}

          {/* 첨부 */}
          {a.attachments && (
            <div className="mt-2.5">
              <AttachmentGallery attachments={a.attachments} />
            </div>
          )}

          {/* 반응 + 댓글 토글 */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {reactionEntries.map(([emoji, ids]) => {
              const mine = !!currentMember && ids.includes(currentMember.id);
              return (
                <button
                  key={emoji}
                  onClick={() => react(emoji)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition",
                    mine
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                      : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50",
                  )}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{ids.length}</span>
                </button>
              );
            })}

            {/* 빠른 반응 추가 — 클릭 토글(터치·키보드 지원) */}
            {currentMember && (
              <div className="relative" ref={reactRef}>
                <button
                  type="button"
                  onClick={() => setReactOpen((v) => !v)}
                  className={cn(
                    "rounded-full border border-dashed px-2 py-0.5 text-xs transition",
                    reactOpen
                      ? "border-indigo-300 text-indigo-500"
                      : "border-zinc-300 text-zinc-400 hover:border-indigo-300 hover:text-indigo-500",
                  )}
                  aria-label={reactOpen ? "반응 선택 닫기" : "반응 추가"}
                  aria-expanded={reactOpen}
                  aria-haspopup="menu"
                >
                  ＋
                </button>
                {reactOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-full border border-zinc-200 bg-white p-1 shadow-md"
                  >
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          react(emoji);
                          setReactOpen(false);
                        }}
                        className="rounded-full px-1 text-base hover:bg-zinc-100"
                        aria-label={`${emoji} 반응`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setShowComments((v) => !v)}
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition",
                showComments ? "bg-indigo-50 text-indigo-600" : "text-zinc-400 hover:bg-zinc-100",
              )}
            >
              💬 댓글
            </button>
          </div>

          {/* 댓글 스레드 */}
          {showComments && (
            <div className="mt-3 border-t border-zinc-100 pt-3">
              <CommentThread targetType="activity" targetId={a.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
