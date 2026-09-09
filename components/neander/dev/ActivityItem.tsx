"use client";

// ============================================================
//  진행 소식 항목 — 한 개의 개발 활동(수동 업데이트/커밋/PR)
//  반응(이모지) · 댓글 토글 · 핀 · 삭제.
//  source 배지(수동/GitHub/Claude)로 출처를 시각 구분하고,
//  커밋(meta.sha) 항목은 제목을 모노스페이스로 요약한다.
// ============================================================

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  GitFork,
  Link2,
  Megaphone,
  MessageCircle,
  PenLine,
  Pin,
  Plus,
  RefreshCw,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { toggleReaction, deleteActivity, setPinned } from "@/lib/neander/dev/activity";
import { AttachmentGallery } from "@/components/neander/dev/ScreenshotUploader";
import { FeatureChip } from "@/components/neander/dev/atoms";
import { CommentThread } from "@/components/neander/dev/CommentThread";
import { Badge, Button, Icon, IconButton, MemberAvatar, Popover, cn, useConfirm, type Tone } from "@/components/neander/ui";
import { formatTimestamp } from "@/lib/neander/format";
import type { DevActivity, DevFeature } from "@/lib/neander/dev/types";

const REACTIONS = ["👍", "🔥", "🎉", "👀", "❤️"];

// 출처 배지 — 수동은 의미 톤, GitHub/Claude 는 외부 브랜드 색(데이터 색)을 유지
const SOURCE_META: Record<
  DevActivity["source"],
  { label: string; icon: LucideIcon; tone?: Tone; color?: string; avatarColor: string }
> = {
  manual: { label: "수동", icon: PenLine, tone: "accent", avatarColor: "#6366f1" },
  github: { label: "GitHub", icon: GitFork, color: "#111827", avatarColor: "#111827" },
  claude: { label: "Claude", icon: Bot, color: "#d97757", avatarColor: "#d97757" },
};

const TYPE_ICON: Record<DevActivity["type"], LucideIcon> = {
  update: Megaphone,
  note: StickyNote,
  commit: GitBranch,
  pr: GitPullRequest,
  status: RefreshCw,
};

export function ActivityItem({
  activity,
  feature,
}: {
  activity: DevActivity;
  feature?: DevFeature;
}) {
  const { currentMember, members } = useAppData();
  const confirm = useConfirm();
  const [showComments, setShowComments] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  // 반응 팝오버: 바깥 클릭 / ESC / 포커스 복귀는 Popover 가 담당한다
  const reactBtnRef = useRef<HTMLButtonElement>(null);

  const a = activity;
  const isAuthor = !!currentMember && currentMember.id === a.authorId;
  const authorColor = members.find((m) => m.id === a.authorId)?.color ?? SOURCE_META[a.source].avatarColor;
  const authorAvatar = members.find((m) => m.id === a.authorId)?.avatar;
  const src = SOURCE_META[a.source];

  function react(emoji: string) {
    if (!currentMember) return;
    toggleReaction(a.id, emoji, currentMember.id, a.reactions);
  }

  const reactionEntries = Object.entries(a.reactions ?? {}).filter(([, ids]) => ids.length > 0);

  return (
    <article
      className={cn(
        "nd-surface relative rounded-nd-lg p-4",
        a.pinned && "ring-1 ring-nd-warning/40",
      )}
    >
      {a.pinned && (
        <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full bg-nd-warning px-2 py-0.5 text-nd-micro font-semibold text-white">
          <Icon icon={Pin} size={10} />
          고정됨
        </span>
      )}

      <div className="flex items-start gap-3">
        <MemberAvatar name={a.authorName} color={authorColor} avatar={authorAvatar} className="h-8 w-8 text-xs" />
        <div className="min-w-0 flex-1">
          {/* 헤더 */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-nd-body font-semibold text-nd-fg">{a.authorName}</span>
            <Icon icon={TYPE_ICON[a.type]} size={14} className="text-nd-fg-3" label={a.type} />
            {/* source 배지 — 수동/GitHub/Claude 출처를 항상 표시 */}
            <span title={`출처: ${src.label}`} className="inline-flex">
              <Badge size="sm" tone={src.tone} color={src.color} className="font-semibold">
                <Icon icon={src.icon} size={11} />
                {src.label}
              </Badge>
            </span>
            <span className="text-nd-micro font-normal text-nd-fg-3">{formatTimestamp(a.createdAt)}</span>
            <div className="ml-auto flex items-center gap-0.5">
              {(isAuthor || currentMember) && (
                <IconButton
                  icon={Pin}
                  label={a.pinned ? "고정 해제" : "고정"}
                  size="sm"
                  active={a.pinned}
                  onClick={() => setPinned(a.id, !a.pinned)}
                  className={cn(!a.pinned && "text-nd-fg-4 hover:text-nd-warning")}
                />
              )}
              {isAuthor && (
                <IconButton
                  icon={X}
                  label="삭제"
                  size="sm"
                  onClick={async () => {
                    if (await confirm({ title: "이 항목을 삭제할까요?", confirmLabel: "삭제", tone: "danger" }))
                      deleteActivity(a.id);
                  }}
                  className="text-nd-fg-4 hover:text-nd-danger"
                />
              )}
            </div>
          </div>

          {/* 제목 — 커밋(meta.sha) 항목은 모노스페이스 요약 */}
          {a.meta?.sha ? (
            <p className="mt-0.5 break-words font-mono text-nd-table font-medium leading-snug text-nd-fg">
              {a.title}
            </p>
          ) : (
            <p className="mt-0.5 text-nd-section leading-snug text-nd-fg">{a.title}</p>
          )}

          {/* 태그들 */}
          {(a.featureName || a.taskTitle) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {a.featureName && <FeatureChip feature={feature} name={a.featureName} />}
              {a.taskTitle &&
                (a.taskId ? (
                  <Link
                    href={`/neander/dev/board?task=${a.taskId}`}
                    className="inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-nd-fg/[.07] px-1.5 text-nd-micro text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-accent-soft hover:text-nd-accent-strong"
                    aria-label={`연결 작업 열기: ${a.taskTitle}`}
                    title={a.taskTitle}
                  >
                    <Icon icon={Link2} size={11} />
                    <span className="truncate">{a.taskTitle}</span>
                  </Link>
                ) : (
                  <Badge size="sm" tone="neutral" className="max-w-full">
                    <Icon icon={Link2} size={11} />
                    <span className="truncate" title={a.taskTitle}>
                      {a.taskTitle}
                    </span>
                  </Badge>
                ))}
            </div>
          )}

          {/* 본문 */}
          {a.body && (
            <p className="mt-2 whitespace-pre-wrap break-words text-nd-body leading-relaxed text-nd-fg-2">
              {a.body}
            </p>
          )}

          {/* 자동연동 커밋/PR 메타 */}
          {a.meta && (a.meta.sha || a.meta.branch || a.meta.url) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-nd-micro font-normal text-nd-fg-3">
              {a.meta.branch && (
                <span className="inline-flex items-center gap-1 rounded-nd-sm bg-nd-fg/[.06] px-1.5 py-0.5 font-mono">
                  <Icon icon={GitBranch} size={11} />
                  {a.meta.branch}
                </span>
              )}
              {a.meta.sha && (
                <span className="rounded-nd-sm bg-nd-fg/[.06] px-1.5 py-0.5 font-mono">{a.meta.sha.slice(0, 7)}</span>
              )}
              {typeof a.meta.additions === "number" && (
                <span className="nd-num text-nd-success-text">+{a.meta.additions}</span>
              )}
              {typeof a.meta.deletions === "number" && (
                <span className="nd-num text-nd-danger-text">-{a.meta.deletions}</span>
              )}
              {a.meta.url && (
                <a
                  href={a.meta.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-nd-accent-strong hover:underline"
                >
                  원본 보기
                  <Icon icon={ExternalLink} size={11} />
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
                  aria-pressed={mine}
                  aria-label={`${emoji} 반응 ${ids.length}`}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-nd-caption transition-colors duration-nd-fast",
                    mine
                      ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                      : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                  )}
                >
                  <span>{emoji}</span>
                  <span className="nd-num">{ids.length}</span>
                </button>
              );
            })}

            {/* 빠른 반응 추가 — 클릭 토글(터치·키보드 지원) */}
            {currentMember && (
              <>
                <button
                  ref={reactBtnRef}
                  type="button"
                  onClick={() => setReactOpen((v) => !v)}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed transition-colors duration-nd-fast",
                    reactOpen
                      ? "border-nd-accent text-nd-accent"
                      : "border-nd-strong text-nd-fg-3 hover:border-nd-accent hover:text-nd-accent",
                  )}
                  aria-label={reactOpen ? "반응 선택 닫기" : "반응 추가"}
                  aria-expanded={reactOpen}
                  aria-haspopup="menu"
                >
                  <Icon icon={Plus} size={14} />
                </button>
                {/* 반응 이모지는 데이터 — 팝오버 껍데기만 공통 Popover 로 */}
                <Popover
                  open={reactOpen}
                  onClose={() => setReactOpen(false)}
                  anchorRef={reactBtnRef}
                  placement="top-start"
                  role="menu"
                  ariaLabel="반응 선택"
                >
                  <div className="flex gap-0.5">
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          react(emoji);
                          setReactOpen(false);
                        }}
                        className="h-8 w-8 rounded-full text-base transition-colors duration-nd-fast hover:bg-nd-fg/[.06]"
                        aria-label={`${emoji} 반응`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </Popover>
              </>
            )}

            <Button
              variant={showComments ? "soft" : "ghost"}
              size="sm"
              icon={MessageCircle}
              onClick={() => setShowComments((v) => !v)}
              aria-expanded={showComments}
              className="ml-auto"
            >
              댓글
            </Button>
          </div>

          {/* 댓글 스레드 */}
          {showComments && (
            <div className="mt-3 border-t border-nd-line pt-3">
              <CommentThread targetType="activity" targetId={a.id} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
