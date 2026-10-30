"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Paperclip, RefreshCw, Trash2, X } from "lucide-react";
import {
  Button, Card, EmptyState, Icon, IconButton, InlineNotice, LoadingState, SectionHeader,
  cn, useConfirm, useToast,
} from "@/components/neander/ui";
import { formatBytes } from "@/lib/neander/finance/docs";
import {
  GRANT_FILE_ACCEPT, MAX_GRANT_FILE_BYTES, MAX_GRANT_FILES, validateGrantFileMeta, type GrantFile,
} from "@/lib/neander/finance/grant-files";
import {
  canPreviewGrantFile, deleteGrantFile, downloadGrantFile, fetchGrantFiles, openGrantFile, uploadGrantFiles,
} from "@/lib/neander/finance/grant-files-client";

const dateOf = (timestamp: number) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(timestamp);

export function GrantFilesPanel({ grantId }: { grantId: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<GrantFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ value: 0, name: "" });
  const [operation, setOperation] = useState<{ id: string; action: "open" | "download" | "delete" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const busy = uploading || operation !== null;

  const refresh = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    try {
      const list = await fetchGrantFiles(grantId, controller.signal);
      if (!controller.signal.aborted) {
        setFiles(list);
        setError(null);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "첨부파일을 불러오지 못했습니다.");
    } finally {
      if (listRequest.current === controller) {
        listRequest.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [grantId]);

  useEffect(() => {
    void refresh();
    return () => {
      listRequest.current?.abort();
      const active = request.current;
      request.current = null;
      active?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const upload = async (picked: File[]) => {
    if (request.current || listRequest.current || loading || !picked.length) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of picked) {
      const checked = validateGrantFileMeta({ name: file.name, type: file.type, size: file.size, sha256: "0".repeat(64) });
      if (checked.ok) accepted.push(file);
      else rejected.push(`${file.name}: ${checked.error}`);
    }
    if (!accepted.length) { setError(rejected.join("\n")); return; }
    if (files.length + accepted.length > MAX_GRANT_FILES) {
      setError(`한 지원사업에는 첨부파일을 ${MAX_GRANT_FILES}개까지 올릴 수 있습니다.`);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setError(rejected.length ? rejected.join("\n") : null);
    setUploading(true);
    setProgress({ value: 0, name: accepted[0].name });
    try {
      const report = await uploadGrantFiles(grantId, accepted, (value, name) => {
        if (request.current === controller && !controller.signal.aborted) setProgress({ value, name });
      }, controller.signal);
      if (request.current !== controller) return;
      await refresh();
      if (request.current !== controller) return;
      const problems = [...rejected, ...report.failed.map((f) => `${f.name}: ${f.error}`)];
      if (problems.length) setError(problems.join("\n"));
      if (report.added.length) toast.success(`파일 ${report.added.length}개를 첨부했습니다.`);
      if (report.duplicates.length) toast.info(`이미 첨부한 파일 ${report.duplicates.length}개는 그대로 두었습니다.`);
      if (report.cancelled) toast.info("남은 파일 전송을 취소했습니다. 첨부가 끝난 파일은 유지됩니다.");
    } catch (e) {
      if (request.current === controller && !controller.signal.aborted) setError(e instanceof Error ? e.message : "파일을 올리지 못했습니다.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setUploading(false);
      }
    }
  };

  const act = async (file: GrantFile, action: "open" | "download" | "delete") => {
    if (request.current || listRequest.current || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setOperation({ id: file.id, action });
    setError(null);
    try {
      if (action === "delete" && !await confirm({
        title: `「${file.name}」 파일을 삭제할까요?`,
        message: "이 지원사업의 첨부파일에서 삭제합니다. 사업 정보와 금액은 유지됩니다.",
        confirmLabel: "삭제", tone: "danger",
      })) return;
      if (controller.signal.aborted) return;
      if (action === "open") await openGrantFile(grantId, file, controller.signal);
      else if (action === "download") await downloadGrantFile(grantId, file, controller.signal);
      else {
        await deleteGrantFile(grantId, file.id, controller.signal);
        if (request.current !== controller) return;
        setFiles((current) => current.filter((f) => f.id !== file.id));
        toast.success("첨부파일을 삭제했습니다.");
      }
    } catch (e) {
      if (request.current === controller && !controller.signal.aborted) setError(e instanceof Error ? e.message : "파일 작업을 완료하지 못했습니다.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setOperation(null);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <InlineNotice tone="danger"><span className="whitespace-pre-line">{error}</span></InlineNotice>}
      <Card
        padding="sm"
        className={cn("transition-colors duration-nd-fast", dragOver && "ring-2 ring-nd-accent")}
        onDragOver={(event) => { event.preventDefault(); if (!busy && !loading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault(); setDragOver(false);
          if (!busy && !loading) void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <SectionHeader
          title="첨부파일"
          hint={`${files.length}개 · 사업계획서, 협약서, 정산 증빙을 함께 보관합니다`}
          action={<>
            <IconButton icon={RefreshCw} label="첨부파일 새로고침" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void refresh()} />
            <Button size="sm" icon={Paperclip} disabled={busy || loading || files.length >= MAX_GRANT_FILES} onClick={() => picker.current?.click()}>파일 올리기</Button>
          </>}
        />
        <input
          ref={picker} type="file" multiple accept={GRANT_FILE_ACCEPT} disabled={busy || loading} className="hidden" aria-label="지원사업 첨부파일 선택"
          onChange={(event) => { const picked = Array.from(event.target.files ?? []); event.target.value = ""; void upload(picked); }}
        />
        <p className="mb-4 text-nd-table text-nd-fg-3">PDF · 엑셀 · 한글 · 문서 · 사진을 올리거나 이곳으로 끌어다 놓으세요. 파일 하나 {formatBytes(MAX_GRANT_FILE_BYTES)}, 최대 {MAX_GRANT_FILES}개.</p>
        {uploading && (
          <div className="mb-4 rounded-nd-md bg-nd-sunken px-3 py-3" role="status" aria-live="polite">
            <div className="mb-2 flex min-w-0 items-center gap-3 text-nd-table">
              <span className="min-w-0 flex-1 truncate" title={progress.name}>{progress.name}</span>
              <span className="nd-num shrink-0">{Math.round(progress.value * 100)}%</span>
            </div>
            <div role="progressbar" aria-label="첨부파일 업로드" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value * 100)} className="h-1.5 overflow-hidden rounded-full bg-nd-border">
              <div className="h-full rounded-full bg-nd-accent transition-[width] duration-nd-fast" style={{ width: `${Math.round(progress.value * 100)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-nd-caption text-nd-fg-3">파일을 올리는 중입니다. 첨부가 끝난 파일은 취소해도 유지됩니다.</p>
              <Button size="sm" variant="ghost" icon={X} onClick={() => request.current?.abort()}>전송 취소</Button>
            </div>
          </div>
        )}
        {loading ? <LoadingState label="첨부파일을 불러오는 중…" /> : files.length === 0 ? (
          <EmptyState compact icon={Paperclip} title="아직 첨부파일이 없습니다" description="관련 서류를 올리면 이 지원사업에서 다시 열거나 내려받을 수 있습니다." />
        ) : (
          <ul className="divide-y divide-nd-line" aria-label="지원사업 첨부파일 목록">
            {files.map((file) => (
              <li key={file.id} className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <span className="flex min-w-0 flex-1 items-start gap-2.5">
                  <Icon icon={FileText} size={18} className="mt-0.5 shrink-0 text-nd-fg-3" />
                  <span className="min-w-0">
                    <span className="block break-all text-nd-body font-medium text-nd-fg">{file.name}</span>
                    <span className="mt-1 block text-nd-caption text-nd-fg-3"><span className="nd-num">{formatBytes(file.size)}</span> · 등록일 {dateOf(file.uploadedAt)}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
                  {canPreviewGrantFile(file) && <Button variant="secondary" size="sm" icon={ExternalLink} disabled={busy || loading} loading={operation?.id === file.id && operation.action === "open"} onClick={() => void act(file, "open")}>열기</Button>}
                  <Button variant="ghost" size="sm" icon={Download} disabled={busy || loading} loading={operation?.id === file.id && operation.action === "download"} onClick={() => void act(file, "download")}>받기</Button>
                  <IconButton icon={Trash2} label={`${file.name} 삭제`} variant="ghost" size="sm" disabled={busy || loading} onClick={() => void act(file, "delete")} className="text-nd-fg-3 hover:text-nd-danger-text" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
