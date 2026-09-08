"use client";

// ============================================================
//  문서에 붙은 파일 — 목록 · 열기 · 떼기 · 붙이기
// ------------------------------------------------------------
//  견적서와 계약서 편집창, 그리고 프로젝트 화면의 문서 목록이 같이 쓴다.
//
//  열기는 **창을 먼저 열고** 주소를 나중에 넣는다. 서명 URL 을 받아 오는
//  사이(await)에 window.open 을 부르면 브라우저가 "사용자 동작이 아니다"
//  라며 팝업을 막는다. 빈 창을 클릭 시점에 열어 두면 막히지 않는다.
//
//  아직 저장 안 된 문서에는 파일을 붙일 자리가 없다(Storage 경로가 문서
//  id 아래다). 그래서 편집창은 고른 파일을 「붙일 예정」 으로 들고 있다가
//  저장 직후 올린다 — 이 컴포넌트는 그 대기 목록도 같이 그린다.
// ============================================================

import { useRef, useState } from "react";
import { finDocFileUrl, removeFinDocFile } from "@/lib/neander/finance/client";
import { formatBytes, type FinDocFile } from "@/lib/neander/finance/docs";
import { DOC_FILE_ACCEPT, DOC_FILE_EXTS, MAX_DOC_FILES, MAX_DOC_FILE_BYTES, docFileExt } from "@/lib/neander/finance/doc-limits";

const ICON: Record<string, string> = {
  pdf: "📄",
  xlsx: "📗",
  xls: "📗",
  docx: "📘",
  hwp: "📙",
  hwpx: "📙",
  jpg: "🖼",
  jpeg: "🖼",
  png: "🖼",
  zip: "🗜",
};
const iconOf = (name: string) => ICON[docFileExt(name)] ?? "📎";

/** 파일 하나를 새 창에 연다. 실패하면 사유를 돌려준다. */
export async function openDocFile(path: string): Promise<string | null> {
  const w = window.open("", "_blank");
  try {
    const url = await finDocFileUrl(path);
    if (w) w.location.href = url;
    else window.location.assign(url);
    return null;
  } catch (e) {
    w?.close();
    return e instanceof Error ? e.message : "파일을 열지 못했습니다.";
  }
}

/** 고른 파일을 미리 거른다 — 서버에 보내기 전에 안 될 파일을 알려 준다 */
export function checkDocFiles(files: File[], already: number): { ok: File[]; error?: string } {
  const ok: File[] = [];
  const problems: string[] = [];
  files.forEach((f) => {
    if (!DOC_FILE_EXTS.includes(docFileExt(f.name))) problems.push(`${f.name} — 형식이 맞지 않습니다`);
    else if (f.size > MAX_DOC_FILE_BYTES) problems.push(`${f.name} — ${formatBytes(f.size)}, ${MAX_DOC_FILE_BYTES / 1024 / 1024}MB 를 넘습니다`);
    else ok.push(f);
  });
  if (already + ok.length > MAX_DOC_FILES) {
    problems.push(`한 문서에는 ${MAX_DOC_FILES}개까지 붙일 수 있습니다`);
    ok.splice(Math.max(0, MAX_DOC_FILES - already));
  }
  return { ok, error: problems.length ? problems.join(" · ") : undefined };
}

/** 파일 칩 하나 — 누르면 연다 */
export function FileChip({
  file,
  onRemove,
  busy,
}: {
  file: FinDocFile;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-200 bg-white pl-1.5 pr-1 text-xs text-zinc-700">
      <button
        type="button"
        disabled={opening || busy}
        onClick={async (e) => {
          e.stopPropagation();
          setOpening(true);
          const err = await openDocFile(file.path);
          setOpening(false);
          if (err) window.alert(err);
        }}
        className="flex min-w-0 items-center gap-1 py-0.5 hover:text-indigo-700 disabled:opacity-50"
        title={`${file.name} · ${formatBytes(file.size)} — 새 창에서 엽니다`}
      >
        <span aria-hidden>{iconOf(file.name)}</span>
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 text-[10px] text-zinc-400">{formatBytes(file.size)}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded px-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
          title="이 파일 떼기 (저장소에서도 지웁니다)"
          aria-label="파일 떼기"
        >
          ✕
        </button>
      )}
    </span>
  );
}

/**
 * 편집창의 파일 칸. 붙은 파일 + 붙일 예정 파일 + 고르기 버튼.
 * 떼기는 즉시 서버에 간다 — 문서 「저장」 과 묶지 않는다. 파일은 문서
 * 본문과 달리 초안이 없고, 뗀 파일이 저장을 안 눌렀다고 되살아나면 헷갈린다.
 */
export function DocFilesField({
  docId,
  files,
  onFilesChange,
  pending,
  onPendingChange,
  disabled,
  onError,
}: {
  /** 저장된 문서 id. 없으면 파일은 「붙일 예정」 으로만 쌓인다 */
  docId?: string;
  files: FinDocFile[];
  onFilesChange: (next: FinDocFile[]) => void;
  pending: File[];
  onPendingChange: (next: File[]) => void;
  disabled?: boolean;
  onError: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const { ok, error } = checkDocFiles(Array.from(list), files.length + pending.length);
    if (error) onError(error);
    if (ok.length) onPendingChange([...pending, ...ok]);
  };

  const remove = async (f: FinDocFile) => {
    if (!docId) return;
    if (!window.confirm(`「${f.name}」 을 이 문서에서 떼고 저장소에서도 지웁니다.`)) return;
    setRemoving(f.path);
    try {
      const res = await removeFinDocFile(docId, f.path);
      onFilesChange(res.files);
    } catch (e) {
      onError(e instanceof Error ? e.message : "파일을 떼지 못했습니다.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled) pick(e.dataTransfer.files);
      }}
      className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {files.map((f) => (
          <FileChip key={f.path} file={f} busy={disabled || removing === f.path} onRemove={docId ? () => void remove(f) : undefined} />
        ))}
        {pending.map((f, i) => (
          <span
            key={`${f.name}-${i}`}
            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 pl-1.5 pr-1 text-xs text-amber-900"
            title="저장하면 올라갑니다"
          >
            <span aria-hidden>{iconOf(f.name)}</span>
            <span className="max-w-[14rem] truncate">{f.name}</span>
            <span className="text-[10px] text-amber-700">{formatBytes(f.size)} · 붙일 예정</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPendingChange(pending.filter((_, j) => j !== i))}
              className="rounded px-1 text-amber-400 hover:text-rose-600"
              aria-label="예정 취소"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOC_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-indigo-200 bg-white px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
        >
          + 파일 붙이기
        </button>
        {files.length === 0 && pending.length === 0 && (
          <span className="text-[11px] text-zinc-400">
            PDF · 엑셀 · 한글 · 사진, 하나에 {MAX_DOC_FILE_BYTES / 1024 / 1024}MB 까지. 여기로 끌어다 놓아도 됩니다.
          </span>
        )}
      </div>
    </div>
  );
}
