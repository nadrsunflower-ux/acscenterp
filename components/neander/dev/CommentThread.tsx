"use client";

// ============================================================
//  댓글 스레드 — 작업(task)/타임라인(activity) 공용
//  - 대상별 실시간 구독, 텍스트 + 스크린샷 첨부로 댓글 작성
//  - 비개발자·개발자 모두 팔로업(댓글) 가능. 작성은 로그인 팀원만.
// ============================================================

import { useEffect, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { subscribeComments, addComment, deleteComment } from "@/lib/neander/dev/comments";
import { ScreenshotUploader, AttachmentGallery } from "@/components/neander/dev/ScreenshotUploader";
import { Button, MemberAvatar, cn } from "@/components/neander/ui";
import { formatTimestamp } from "@/lib/neander/format";
import type { CommentTarget, DevComment, DevAttachment } from "@/lib/neander/dev/types";

export function CommentThread({
  targetType,
  targetId,
  className,
}: {
  targetType: CommentTarget;
  targetId: string;
  className?: string;
}) {
  const { currentMember, members } = useAppData();
  const [comments, setComments] = useState<DevComment[]>([]);
  const [body, setBody] = useState("");
  const [atts, setAtts] = useState<DevAttachment[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return subscribeComments(targetType, targetId, setComments);
  }, [targetType, targetId]);

  const colorOf = (id?: string) => members.find((m) => m.id === id)?.color ?? "#71717a";
  const avatarOf = (id?: string) => members.find((m) => m.id === id)?.avatar;

  async function submit() {
    const t = body.trim();
    if ((!t && atts.length === 0) || !currentMember) return;
    setBusy(true);
    try {
      await addComment({
        targetType,
        targetId,
        authorId: currentMember.id,
        authorName: currentMember.name,
        body: t,
        attachments: atts.length ? atts : undefined,
      });
      setBody("");
      setAtts([]);
      setShowUploader(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          댓글 {comments.length > 0 && <span className="text-zinc-500">{comments.length}</span>}
        </h4>
      </div>

      {/* 목록 */}
      {comments.length > 0 && (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <MemberAvatar
                name={c.authorName}
                color={colorOf(c.authorId)}
                avatar={avatarOf(c.authorId)}
                className="mt-0.5 h-7 w-7 text-xs"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-800">{c.authorName}</span>
                  <span className="text-[11px] text-zinc-400">{formatTimestamp(c.createdAt)}</span>
                  {currentMember?.id === c.authorId && (
                    <button
                      onClick={() => {
                        if (confirm("댓글을 삭제할까요?")) deleteComment(c.id);
                      }}
                      className="ml-auto text-[11px] text-zinc-300 hover:text-red-500"
                      aria-label="댓글 삭제"
                    >
                      삭제
                    </button>
                  )}
                </div>
                {c.body && (
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-700">{c.body}</p>
                )}
                {c.attachments && (
                  <div className="mt-1.5">
                    <AttachmentGallery attachments={c.attachments} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 입력 */}
      {currentMember ? (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2.5">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            rows={2}
            placeholder="댓글 남기기… (Ctrl+Enter 전송, 이미지 붙여넣기 가능)"
            className="w-full resize-y rounded-md border-0 bg-transparent px-1 py-0.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
          />
          {showUploader && (
            <ScreenshotUploader scope="comment" attachments={atts} onChange={setAtts} compact />
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowUploader((v) => !v)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition",
                showUploader ? "bg-indigo-50 text-indigo-600" : "text-zinc-500 hover:bg-zinc-100",
              )}
            >
              🖼️ 스크린샷 {atts.length > 0 && `(${atts.length})`}
            </button>
            <Button
              className="!px-3 !py-1.5 !text-xs"
              onClick={submit}
              disabled={busy || (!body.trim() && atts.length === 0)}
            >
              {busy ? "등록 중…" : "댓글 등록"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-400">댓글을 남기려면 팀원 계정으로 로그인하세요.</p>
      )}
    </div>
  );
}
