"use client";

// ============================================================
//  회의 첨부 파일 — 목록 상태 · 올리기 · 열기 · 지우기
// ------------------------------------------------------------
//  첨부는 회의 하나에 붙는다 (lib/neander/meetings/types.ts). 올리는 즉시
//  서버에 저장되고, 회의록 「저장」 과 묶이지 않는다 — 파일은 초안이 없다.
//
//  첨부 목록은 서버를 거쳐 읽어서(보안 규칙에 없는 컬렉션) 실시간 구독이
//  안 된다. 창으로 돌아올 때 다시 읽어 다른 사람이 올린 파일을 잡는다.
//
//  목록은 **올린 사람별로 묶어** 보여 준다 (2026-09-21). 회의 하나에 팀원이
//  각자 자료를 붙이는 자리라, 「누가 무엇을 올렸는가」 가 파일 이름만큼 중요하다.
//  내 묶음이 늘 맨 위에 온다.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Presentation,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  Button,
  DropZone,
  Icon,
  IconButton,
  InlineNotice,
  MemberAvatar,
  Meter,
  SectionHeader,
  Spinner,
  cn,
  useConfirm,
  useToast,
  type LucideIcon,
} from "@/components/neander/ui";
import { useAuth } from "@/components/neander/auth";
import {
  deleteFilesOfMeeting,
  deleteMeetingFile,
  downloadMeetingFile,
  fetchMeetingFiles,
  openMeetingFile,
  uploadMeetingFile,
} from "@/lib/neander/meetings/client";
import { MEETING_FILE_MAX_BYTES, type MeetingFile } from "@/lib/neander/meetings/types";
import { formatFileSize, formatTimestamp } from "@/lib/neander/format";

const MAX_MB = MEETING_FILE_MAX_BYTES / 1024 / 1024;

/** 확장자 → 아이콘. 종류를 구분할 만큼만 — 색은 쓰지 않는다 */
const EXT_ICON: Record<string, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  hwp: FileText,
  hwpx: FileText,
  txt: FileText,
  md: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  ppt: Presentation,
  pptx: Presentation,
  key: Presentation,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  png: ImageIcon,
  gif: ImageIcon,
  webp: ImageIcon,
  heic: ImageIcon,
  mp4: FileVideo,
  mov: FileVideo,
  zip: FileArchive,
};
const iconOf = (name: string): LucideIcon => EXT_ICON[name.split(".").pop()?.toLowerCase() ?? ""] ?? FileIcon;

export interface UploadItem {
  key: string;
  meetingId: string;
  name: string;
  size: number;
  progress: number;
}

let _seq = 0;

/** 모든 회의의 첨부와 올리는 중인 파일 — 회의록 화면 하나가 들고 있다 */
export function useMeetingFiles() {
  const toast = useToast();
  /** 한 번도 못 받았으면 null */
  const [files, setFiles] = useState<MeetingFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      setFiles(await fetchMeetingFiles());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "첨부 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // 올리는 중에 탭을 닫으면 한 번 묻는다 — 끊긴 파일은 목록에 안 남지만 다시 올려야 한다
  const uploading = uploads.length > 0;
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const upload = useCallback(
    async (meetingId: string, picked: File[]) => {
      const tooBig = picked.filter((f) => f.size > MEETING_FILE_MAX_BYTES);
      const ok = picked.filter((f) => f.size > 0 && f.size <= MEETING_FILE_MAX_BYTES);
      if (tooBig.length) {
        toast.error(
          `${tooBig.map((f) => `${f.name}(${formatFileSize(f.size)})`).join(", ")} — 한 파일은 ${MAX_MB}MB 까지입니다. 큰 자료는 드라이브에 두고 회의록의 「자료 링크」 로 걸어 주세요.`,
        );
      }
      const items = ok.map((f) => ({ key: `u${++_seq}`, meetingId, name: f.name, size: f.size, progress: 0 }));
      setUploads((u) => [...u, ...items]);
      // 파일은 하나씩 — 한 파일 안의 조각이 이미 셋씩 나란히 간다
      for (let i = 0; i < ok.length; i++) {
        const it = items[i];
        try {
          const saved = await uploadMeetingFile(meetingId, ok[i], (p) =>
            setUploads((u) => u.map((x) => (x.key === it.key ? { ...x, progress: p } : x))),
          );
          setFiles((fs) => (fs ? [...fs, saved] : fs));
        } catch (e) {
          toast.error(`「${it.name}」 을 올리지 못했습니다 — ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
        } finally {
          setUploads((u) => u.filter((x) => x.key !== it.key));
        }
      }
    },
    [toast],
  );

  const removeFile = useCallback(async (f: MeetingFile) => {
    await deleteMeetingFile(f.id);
    setFiles((fs) => (fs ? fs.filter((x) => x.id !== f.id) : fs));
  }, []);

  /** 회의를 지우기 전에 — 그 회의의 첨부를 모두 지운다 */
  const removeAllOf = useCallback(async (meetingId: string) => {
    await deleteFilesOfMeeting(meetingId);
    setFiles((fs) => (fs ? fs.filter((x) => x.meetingId !== meetingId) : fs));
  }, []);

  return { files, error, uploads, refresh, upload, removeFile, removeAllOf };
}

/** 파일 열기 — 누른 동안 돌아가는 표시, 실패는 알림 */
function useOpen() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (f: MeetingFile, how: "open" | "download") => {
    setBusy(f.id);
    try {
      await (how === "open" ? openMeetingFile(f) : downloadMeetingFile(f));
    } catch (e) {
      toast.error(`「${f.name}」 을 열지 못했습니다 — ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** 회의의 첨부 칸 — 올라간 파일 · 올리는 중 · 올리는 자리. 읽기 화면과 편집 폼이 같이 쓴다 */
export function MeetingAttachments({
  meetingId,
  files,
  uploads,
  loaded,
  error,
  onRetry,
  onUpload,
  onRemove,
  memberOf,
  compact = false,
}: {
  meetingId: string;
  /** 이 회의의 첨부 */
  files: MeetingFile[];
  uploads: UploadItem[];
  /** 첨부 목록을 한 번이라도 받았는가 */
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
  onUpload: (files: File[]) => void;
  onRemove: (f: MeetingFile) => Promise<void>;
  /** 올린 사람 ERP 이메일 → 팀원 (없으면 이메일 앞부분을 이름으로) */
  memberOf: (email: string) => { name: string; color?: string; avatar?: string };
  /** 파일이 없어도 올리는 자리를 한 줄로 — 회의록 문서 끝에서 큰 점선 상자가 본문보다 눈에 띄지 않게 */
  compact?: boolean;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const { busy, run } = useOpen();
  const [removing, setRemoving] = useState<string | null>(null);
  const total = files.reduce((s, f) => s + f.size, 0);
  const mine = uploads.filter((u) => u.meetingId === meetingId);
  const hasRows = mine.length > 0 || files.length > 0;
  const me = (user?.email ?? "").trim().toLowerCase();

  // 올린 사람별 묶음 — 내 묶음이 맨 위, 그다음은 먼저 올린 사람 순
  const groups = useMemo(() => {
    const by = new Map<string, MeetingFile[]>();
    for (const f of files) {
      const key = f.uploadedBy.trim().toLowerCase();
      const list = by.get(key);
      if (list) list.push(f);
      else by.set(key, [f]);
    }
    return [...by.entries()]
      .map(([email, list]) => ({
        email,
        isMe: email === me,
        files: [...list].sort((a, b) => a.createdAt - b.createdAt),
        bytes: list.reduce((s, f) => s + f.size, 0),
      }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.files[0].createdAt - b.files[0].createdAt);
  }, [files, me]);

  async function remove(f: MeetingFile) {
    const ok = await confirm({
      title: `「${f.name}」 을 지울까요?`,
      message: "팀 모두의 회의록에서 사라지고 되살릴 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    setRemoving(f.id);
    try {
      await onRemove(f);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "파일을 지우지 못했습니다.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      <SectionHeader
        as="h3"
        title="첨부 파일"
        hint={
          files.length
            ? `${groups.length > 1 ? `${groups.length}명 · ` : ""}${files.length}개 · ${formatFileSize(total)}`
            : "팀원 누구나 자기 자료를 올릴 수 있습니다 — 올리는 즉시 저장됩니다"
        }
      />

      {/* 처음 읽기에 실패했을 때만 — 이미 목록이 있으면 창 복귀 때의 재읽기 실패는 조용히 넘긴다 */}
      {!loaded && error && (
        <InlineNotice
          tone="danger"
          className="mb-3"
          action={
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={onRetry}>
              다시 읽기
            </Button>
          }
        >
          첨부 목록을 ERP 서버에서 받지 못했습니다.
          <span className="mt-0.5 block text-nd-caption opacity-80">{error}</span>
        </InlineNotice>
      )}

      {hasRows && (
        <div className="mb-2 overflow-hidden rounded-nd-md border border-nd-line">
          {groups.map((g) => {
            const m = memberOf(g.email);
            return (
              <section key={g.email}>
                <h4 className="flex items-center gap-2 border-b border-nd-line bg-nd-sunken/60 px-3 py-1.5">
                  <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-5 w-5 text-[10px]" />
                  <span className="truncate text-nd-caption font-semibold text-nd-fg-2">{m.name}</span>
                  {g.isMe && <span className="rounded-full bg-nd-accent-soft px-1.5 text-nd-micro font-medium text-nd-accent-strong">나</span>}
                  <span className="nd-num ml-auto shrink-0 text-nd-micro text-nd-fg-3">
                    {g.files.length}개 · {formatFileSize(g.bytes)}
                  </span>
                </h4>
                <ul className="divide-y divide-nd-line">
                  {g.files.map((f) => (
                    <li key={f.id} className="flex min-h-[48px] items-center gap-1 py-1 pl-3 pr-1.5">
                      <Icon icon={iconOf(f.name)} size={18} className="mr-2 shrink-0 text-nd-fg-3" />
                      <button
                        type="button"
                        onClick={() => void run(f, "open")}
                        disabled={busy === f.id || removing === f.id}
                        className="group min-w-0 flex-1 py-1 text-left disabled:opacity-60"
                        title={`${f.name} — 누르면 엽니다`}
                      >
                        <span className="block truncate text-nd-body font-medium text-nd-fg transition-colors duration-nd-fast group-hover:text-nd-accent-strong">
                          {f.name}
                        </span>
                        <span className="nd-num block text-nd-caption text-nd-fg-3">
                          {formatFileSize(f.size)} · {formatTimestamp(f.createdAt)}
                          {f.archive && " · 노션에 보관됨"}
                        </span>
                      </button>
                      {busy === f.id ? (
                        <span className="inline-flex h-ctl-md w-9 shrink-0 items-center justify-center">
                          <Spinner size={16} />
                        </span>
                      ) : (
                        <IconButton
                          icon={f.archive ? ExternalLink : Download}
                          label={f.archive ? `${f.name} 노션에서 열기` : `${f.name} 내려받기`}
                          onClick={() => void run(f, "download")}
                        />
                      )}
                      <IconButton
                        icon={Trash2}
                        label={`${f.name} 삭제`}
                        disabled={removing === f.id}
                        onClick={() => void remove(f)}
                        className="hover:text-nd-danger"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {mine.length > 0 && (
            <section>
              <h4 className={cn("border-b border-nd-line bg-nd-sunken/60 px-3 py-1.5 text-nd-caption font-semibold text-nd-fg-2", groups.length === 0 && "border-t-0")}>
                올리는 중
              </h4>
              <ul className="divide-y divide-nd-line">
                {mine.map((u) => (
                  <li key={u.key} className="flex min-h-[48px] items-center gap-3 px-3 py-2">
                    <Icon icon={iconOf(u.name)} size={18} className="shrink-0 text-nd-fg-3" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-nd-body text-nd-fg-2" title={u.name}>
                        {u.name}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <Meter value={u.progress} width={120} label={`${u.name} 올리는 중`} />
                        <span className="nd-num text-nd-caption text-nd-fg-3">
                          {Math.round(u.progress * 100)}% · {formatFileSize(u.size)}
                        </span>
                      </span>
                    </div>
                    <Spinner size={16} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <DropZone
        multiple
        compact={compact || hasRows}
        onFiles={onUpload}
        title={hasRows ? "파일 더 올리기" : "파일을 끌어다 놓거나 눌러서 고르세요"}
        hint={`한 파일 ${MAX_MB}MB 까지 · 여러 개를 한 번에 올릴 수 있습니다`}
      />
    </div>
  );
}
