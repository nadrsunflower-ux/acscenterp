"use client";

// ============================================================
//  스크린샷/파일 업로더 — 개발 허브 공용
//  - 파일 선택 / 이미지 붙여넣기(Ctrl+V) / 드래그 드롭
//  - 업로드 진행률 표시, 썸네일 미리보기, 개별 삭제
//  - 완료된 첨부 목록을 onChange(attachments) 로 상위에 보고
// ============================================================

import { useCallback, useRef, useState } from "react";
import { uploadDevFile } from "@/lib/neander/dev/upload";
import { cn } from "@/components/neander/ui";
import { formatFileSize } from "@/lib/neander/format";
import type { DevAttachment } from "@/lib/neander/dev/types";

interface Uploading {
  key: string;
  name: string;
  pct: number;
}

export function ScreenshotUploader({
  scope,
  attachments,
  onChange,
  disabled,
  compact,
}: {
  /** Storage 경로 구분용 (예: "activity", "task_<id>", "comment") */
  scope: string;
  attachments: DevAttachment[];
  onChange: (next: DevAttachment[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  // 항상 '최신' 부모 첨부 목록을 참조하기 위한 ref. 렌더마다 동기화한다.
  // 이래야 겹치는 여러 handleFiles 호출(붙여넣기 직후 또 붙여넣기, 붙여넣기+드롭 동시)이
  // 각각 stale attachments 에서 시작해 서로를 덮어쓰는 문제(clobber)를 막을 수 있다.
  const attsRef = useRef(attachments);
  attsRef.current = attachments;

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      for (const file of list) {
        const key = `u${keyRef.current++}`;
        setUploads((prev) => [...prev, { key, name: file.name, pct: 0 }]);
        try {
          const att = await uploadDevFile(scope, file, (pct) =>
            setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, pct } : u))),
          );
          // 업로드 완료 시점의 '최신' 목록에 누적 → 순차/동시/삭제 모두 안전.
          const next = [...attsRef.current, att];
          attsRef.current = next;
          onChange(next);
        } catch {
          // 업로드 실패 — 조용히 항목 제거(사용자가 다시 시도)
        } finally {
          setUploads((prev) => prev.filter((u) => u.key !== key));
        }
      }
    },
    [scope, onChange],
  );

  function onPaste(e: React.ClipboardEvent) {
    if (disabled) return;
    const imgs = Array.from(e.clipboardData.items)
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length > 0) {
      e.preventDefault();
      handleFiles(imgs);
    }
  }

  function removeAt(i: number) {
    onChange(attachments.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 드롭/붙여넣기 영역 */}
      <div
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        tabIndex={0}
        role="button"
        aria-label="스크린샷 첨부: 클릭·붙여넣기·드래그"
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center transition",
          compact ? "px-3 py-2.5" : "px-4 py-5",
          dragOver
            ? "border-indigo-400 bg-indigo-50"
            : "border-zinc-300 bg-zinc-50/60 hover:border-indigo-300 hover:bg-zinc-50",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn("text-zinc-400", compact ? "text-lg" : "text-2xl")}>🖼️</span>
        <span className="text-xs font-medium text-zinc-500">
          이미지 붙여넣기 · 드래그 · <span className="text-indigo-600">클릭해서 선택</span>
        </span>
        {!compact && (
          <span className="text-[11px] text-zinc-400">스크린샷은 Ctrl+V 로 바로 붙일 수 있어요</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.zip,.txt,.log"
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* 업로드 진행 */}
      {uploads.map((u) => (
        <div key={u.key} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-zinc-600">{u.name}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${u.pct}%` }}
              />
            </div>
          </div>
          <span className="text-[11px] tabular-nums text-zinc-400">{u.pct}%</span>
        </div>
      ))}

      {/* 첨부 썸네일 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div
              key={`${a.url}-${i}`}
              className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-white"
            >
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.name} className="h-20 w-20 object-cover" />
              ) : (
                <div className="flex h-20 w-20 flex-col items-center justify-center gap-1 p-1.5 text-center">
                  <span className="text-xl">📎</span>
                  <span className="line-clamp-2 text-[9px] text-zinc-500">{a.name}</span>
                  <span className="text-[9px] text-zinc-400">{formatFileSize(a.size)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
                aria-label="첨부 삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 이미 저장된 첨부 목록을 읽기 전용으로 표시 (타임라인/댓글/작업 상세 공용) */
export function AttachmentGallery({ attachments }: { attachments?: DevAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a, i) =>
        a.kind === "image" ? (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-zinc-200 transition hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} className="max-h-64 max-w-[240px] object-cover" />
          </a>
        ) : (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 transition hover:bg-zinc-50"
          >
            <span>📎</span>
            <span className="max-w-[160px] truncate">{a.name}</span>
            <span className="text-zinc-400">{formatFileSize(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}
