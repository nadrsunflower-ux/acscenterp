"use client";

// ============================================================
//  댓글 스레드 — 작업(task)/타임라인(activity) 공용
//  - 대상별 실시간 구독, 텍스트 + 스크린샷 첨부로 댓글 작성
//  - 비개발자·개발자 모두 팔로업(댓글) 가능. 작성은 로그인 팀원만.
// ============================================================

import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { subscribeComments, addComment, deleteComment } from "@/lib/neander/dev/comments";
import { ScreenshotUploader, AttachmentGallery } from "@/components/neander/dev/ScreenshotUploader";
import { Button, MemberAvatar, cn, useConfirm } from "@/components/neander/ui";
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
  const confirm = useConfirm();
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
        <h4 className="text-nd-micro font-semibold uppercase tracking-wide text-nd-fg-3">
          댓글 {comments.length > 0 && <span className="nd-num text-nd-fg-2">{comments.length}</span>}
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
                  <span className="text-nd-body font-semibold text-nd-fg">{c.authorName}</span>
                  <span className="text-nd-micro font-normal text-nd-fg-3">{formatTimestamp(c.createdAt)}</span>
                  {currentMember?.id === c.authorId && (
                    <button
                      onClick={async () => {
                        if (await confirm({ title: "댓글을 삭제할까요?", confirmLabel: "삭제", tone: "danger" }))
                          deleteComment(c.id);
                      }}
                      className="ml-auto text-nd-micro text-nd-fg-3 transition-colors duration-nd-fast hover:text-nd-danger"
                      aria-label="댓글 삭제"
                    >
                      삭제
                    </button>
                  )}
                </div>
                {c.body && (
                  <p className="whitespace-pre-wrap break-words text-nd-body text-nd-fg-2">{c.body}</p>
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
        <div className="flex flex-col gap-2 rounded-nd-md border border-nd-border bg-nd-content p-2.5 transition-colors duration-nd-fast focus-within:border-nd-accent">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            rows={2}
            placeholder="댓글 남기기… (Ctrl+Enter 전송, 이미지 붙여넣기 가능)"
            aria-label="댓글"
            className="w-full resize-y rounded-[6px] border-0 bg-transparent px-1 py-0.5 text-nd-body text-nd-fg outline-none placeholder:text-nd-fg-3"
          />
          {showUploader && (
            <ScreenshotUploader scope="comment" attachments={atts} onChange={setAtts} compact />
          )}
          <div className="flex items-center justify-between">
            <Button
              variant={showUploader ? "soft" : "ghost"}
              size="sm"
              icon={ImageIcon}
              onClick={() => setShowUploader((v) => !v)}
              aria-pressed={showUploader}
            >
              스크린샷 {atts.length > 0 && `(${atts.length})`}
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={busy || (!body.trim() && atts.length === 0)}
              loading={busy}
            >
              {busy ? "등록 중…" : "댓글 등록"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-nd-caption text-nd-fg-3">댓글을 남기려면 팀원 계정으로 로그인하세요.</p>
      )}
    </div>
  );
}
