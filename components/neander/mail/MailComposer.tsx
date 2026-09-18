"use client";

// ============================================================
//  메일 쓰기 — 새 메일 · 내게쓰기 · 답장 · 전체 답장 · 전달 · 임시저장 · 예약
// ------------------------------------------------------------
//  카페24 웹메일 쓰기 화면의 줄을 그대로 옮겼다:
//    보내는 계정(계정을 여러 개 로그인해 뒀을 때)
//    받는사람(+내게쓰기·주소록) · 참조(+숨은참조) · 제목 · 파일첨부 · 편집기
//    보낸메일함 저장 · 한 사람씩 보내기 · 예약 발송 · 미리보기 · 임시저장
//
//  서명은 창이 열릴 때 계정의 기본 서명(새 메일 · 답장 따로)을 본문 아래에 넣는다.
//  「서명」 고르기로 그 칸만 바꾸거나 뺀다 (signature.ts). 보내는 계정을 바꾸면 그
//  계정의 기본 서명으로 갈아 끼운다.
//
//  첨부는 고르는 즉시 조각으로 올린다 (Vercel 요청 한도 4.5MB 를 비켜 20MB 까지).
//  답장·전달의 원문 인용은 서버가 붙인다 (send.ts) — 여기서는 붙는다는 것만 알린다.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookUser, Clock, Eye, FileText, Paperclip, Plus, Quote, Save, Send, Trash2, UploadCloud } from "lucide-react";
import { Button, Checkbox, Dialog, Icon, InlineNotice, Input, Select, cn, useConfirm, useToast } from "@/components/neander/ui";
import { formatFileSize } from "@/lib/neander/format";
import { deleteBlobs, saveDraft, sendMailNow, uploadBlob } from "@/lib/neander/mail/client";
import {
  MAX_SEND_ATTACH_BYTES,
  type MailAddr,
  type MailAttachmentMeta,
  type MailBlobRef,
  type MailAccountView,
  type MailComposeState,
  type MailSendInput,
  type MailSignature,
} from "@/lib/neander/mail/types";
import { withSignatureHtml, withSignatureText } from "./signature";
import { MailBody } from "./MailBody";
import { AddressBook, RecipientInput } from "./Recipients";
import { RichEditor, htmlToText, type EditorMode } from "./RichEditor";
import { useMail } from "./MailProvider";

/** 쓰기 창을 여는 값 */
export interface ComposeInit extends Partial<MailComposeState> {
  /** 보내는 계정 (없으면 지금 보는 계정) */
  acct?: string;
  /** 임시보관함에서 다시 연 것 */
  draftId?: string;
  /** 전달할 때 함께 가는 원본 첨부 */
  forwardFiles?: MailAttachmentMeta[];
  /** 자동 서명 — 새 메일이면 new, 답장·전달이면 reply. 임시저장을 다시 열 때는 넣지 않는다 */
  sigMode?: "new" | "reply";
}

/** 그 계정이 이 쓰기에 자동으로 넣는 서명 */
function defaultSignature(acc: MailAccountView | undefined, mode: ComposeInit["sigMode"]): MailSignature | null {
  const set = acc?.signatures;
  if (!set || !mode) return null;
  const id = mode === "new" ? set.sigNew : set.sigReply;
  return set.list.find((s) => s.id === id) ?? null;
}

interface FileItem {
  key: string;
  name: string;
  size: number;
  type: string;
  status: "uploading" | "done" | "error";
  progress: number;
  blob?: MailBlobRef;
  error?: string;
}

/** 요청 한도(4.5MB) 안 — 본문 속 이미지가 커지면 여기서 막는다 */
const MAX_BODY_CHARS = 3_500_000;

const TITLE = { reply: "답장", replyAll: "전체 답장", forward: "전달" } as const;

/** datetime-local 기본값 — 한 시간 뒤 정각 */
function nextHourLocal(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 줄 이름 칸 — 넓은 화면에서는 입력칸 높이 가운데에 선다 (입력칸과 같은 줄) */
function RowLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-nd-caption font-medium text-nd-fg-2 sm:flex sm:h-ctl-md sm:items-center">
      {children}
    </label>
  );
}

export function MailComposer({ init, onClose }: { init: ComposeInit | null; onClose: () => void }) {
  const { accounts, activeKey, publish, refresh, loadContacts } = useMail();
  const toast = useToast();
  const confirm = useConfirm();

  const [to, setTo] = useState<MailAddr[]>([]);
  const [cc, setCc] = useState<MailAddr[]>([]);
  const [bcc, setBcc] = useState<MailAddr[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<EditorMode>("rich");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [forwardSkip, setForwardSkip] = useState<Set<number>>(new Set());
  const [self, setSelf] = useState(false);
  const [saveSent, setSaveSent] = useState(true);
  const [individually, setIndividually] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [sendAt, setSendAt] = useState(nextHourLocal);
  const [draftId, setDraftId] = useState<string>();
  const [fromKey, setFromKey] = useState<string>();
  /** 지금 본문에 든 서명 ("" = 없음) */
  const [sigId, setSigId] = useState("");
  /** TEXT 모드에서 마지막으로 넣은 서명 글자 — 바꿀 때 찾아 지운다 */
  const sigText = useRef<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [error, setError] = useState<string>();
  const [bookOpen, setBookOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dirty = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // 창이 열릴 때 초안을 채운다
  useEffect(() => {
    if (!init) return;
    void loadContacts();
    setTo(init.to ?? []);
    setCc(init.cc ?? []);
    setBcc(init.bcc ?? []);
    setShowBcc(!!init.bcc?.length);
    setSubject(init.subject ?? "");
    setMode(init.mode ?? "rich");
    // 자동 서명 — 보내는 계정의 기본 서명을 본문 아래에
    const acc = accounts.find((a) => a.key === (init.acct ?? activeKey));
    const sig = defaultSignature(acc, init.sigMode);
    const startHtml = sig && init.mode !== "text" ? withSignatureHtml(init.html ?? "", sig) : init.html ?? "";
    const started = sig && init.mode === "text" ? withSignatureText(init.text ?? "", null, sig) : null;
    setHtml(startHtml);
    setText(started ? started.text : sig ? htmlToText(startHtml) : init.text ?? "");
    sigText.current = started?.sigText ?? null;
    setSigId(sig?.id ?? "");
    setFiles(
      (init.blobs ?? []).map((b) => ({ key: b.id, name: b.name, size: b.size, type: b.type, status: "done", progress: 1, blob: b })),
    );
    setPicked(new Set());
    setForwardSkip(new Set(init.forwardSkip ?? []));
    setSelf(!!init.self);
    setSaveSent(init.saveSent !== false);
    setIndividually(!!init.individually);
    setScheduleOn(false);
    setSendAt(nextHourLocal());
    setDraftId(init.draftId);
    setFromKey(init.acct ?? activeKey);
    setError(undefined);
    setResetKey((k) => k + 1);
    dirty.current = false;
    // activeKey 는 창을 열 때의 값만 쓴다 (열어 둔 채 계정을 바꿔도 보내는 계정은 그대로)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init, loadContacts]);

  const from = accounts.find((a) => a.key === fromKey) ?? accounts.find((a) => a.key === activeKey);
  const signatures = from?.signatures?.list ?? [];

  /** 본문의 서명 칸을 바꾼다 (null 이면 뺀다) */
  const applySignature = (sig: MailSignature | null) => {
    if (mode === "text") {
      const r = withSignatureText(text, sigText.current, sig);
      setText(r.text);
      sigText.current = r.sigText;
    } else {
      const next = withSignatureHtml(html, sig);
      setHtml(next);
      setText(htmlToText(next));
      setResetKey((k) => k + 1);
    }
    setSigId(sig?.id ?? "");
    dirty.current = true;
  };

  const touch = () => {
    dirty.current = true;
  };

  const forwardFiles = init?.ref?.mode === "forward" ? init.forwardFiles ?? [] : [];
  const forwardBytes = forwardFiles.filter((f) => !forwardSkip.has(f.index)).reduce((s, f) => s + f.size, 0);
  const total = files.reduce((s, f) => s + f.size, 0) + forwardBytes;
  const over = total > MAX_SEND_ATTACH_BYTES;
  const uploading = files.some((f) => f.status === "uploading");

  const addFiles = useCallback((list: File[]) => {
    if (!list.length) return;
    dirty.current = true;
    const items: FileItem[] = list.map((f) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      size: f.size,
      type: f.type,
      status: "uploading",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...items]);
    items.forEach((it, i) => {
      uploadBlob(list[i], it.name, (p) => setFiles((prev) => prev.map((x) => (x.key === it.key ? { ...x, progress: p } : x))))
        .then((blob) => setFiles((prev) => prev.map((x) => (x.key === it.key ? { ...x, status: "done", progress: 1, blob } : x))))
        .catch((e) =>
          setFiles((prev) =>
            prev.map((x) => (x.key === it.key ? { ...x, status: "error", error: e instanceof Error ? e.message : String(e) } : x)),
          ),
        );
    });
  }, []);

  const removePicked = () => {
    const initial = new Set((init?.blobs ?? []).map((b) => b.id));
    const gone = files.filter((f) => picked.has(f.key));
    // 임시저장에 들어 있던 조각은 저장할 때 서버가 치운다 — 새로 올린 것만 지금 지운다
    void deleteBlobs(gone.map((f) => f.blob?.id).filter((x): x is string => !!x && !initial.has(x)));
    setFiles((prev) => prev.filter((f) => !picked.has(f.key)));
    setForwardSkip((prev) => {
      const next = new Set(prev);
      for (const f of forwardFiles) if (picked.has(`fw-${f.index}`)) next.add(f.index);
      return next;
    });
    setPicked(new Set());
    touch();
  };

  const composeState = (): MailComposeState => ({
    to,
    cc,
    bcc,
    subject: subject.trim(),
    html: mode === "text" ? undefined : html,
    text: mode === "text" ? text : text || htmlToText(html),
    mode,
    ref: init?.ref,
    blobs: files.filter((f) => f.status === "done" && f.blob).map((f) => f.blob!),
    forwardSkip: forwardSkip.size ? [...forwardSkip] : undefined,
    self: self || undefined,
    saveSent,
    individually: individually || undefined,
  });

  const saveNow = async (): Promise<boolean> => {
    if (uploading) {
      setError("첨부를 올리는 중입니다. 잠시 뒤 저장해 주세요.");
      return false;
    }
    setBusy("save");
    setError(undefined);
    try {
      const { draft } = await saveDraft(composeState(), draftId, from?.key);
      setDraftId(draft.id);
      dirty.current = false;
      void refresh();
      toast.success("임시보관함에 저장했어요.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    if (busy) return;
    if (dirty.current) {
      const keep = await confirm({
        title: "쓰던 메일을 임시저장할까요?",
        message: "저장하지 않으면 쓴 내용과 새로 올린 첨부가 사라집니다.",
        confirmLabel: "임시저장",
        cancelLabel: "저장 안 함",
      });
      if (keep) {
        if (!(await saveNow())) return;
      } else {
        const initial = new Set((init?.blobs ?? []).map((b) => b.id));
        void deleteBlobs(files.map((f) => f.blob?.id).filter((x): x is string => !!x && !initial.has(x)));
      }
    }
    onClose();
  };

  const send = async () => {
    setError(undefined);
    const c = composeState();
    if (!self && !c.to.length && !c.cc.length && !c.bcc.length) return setError("받는 사람을 넣어 주세요.");
    if (uploading) return setError("첨부를 올리는 중입니다. 다 올라간 뒤 보내 주세요.");
    if (files.some((f) => f.status === "error")) return setError("올리지 못한 첨부가 있습니다. 빼고 다시 첨부해 주세요.");
    if (over) return setError("첨부는 합쳐서 20MB 까지 보낼 수 있습니다.");
    if ((c.html?.length ?? 0) > MAX_BODY_CHARS) return setError("본문 속 이미지가 너무 큽니다. 이미지를 파일 첨부로 보내 주세요.");
    if (!c.subject && !(await confirm({ title: "제목 없이 보낼까요?", confirmLabel: "보내기" }))) return;

    let at: number | undefined;
    if (scheduleOn) {
      at = new Date(sendAt).getTime();
      if (!at || at < Date.now() + 60_000) return setError("예약 시각은 지금부터 1분 뒤 이후로 골라 주세요.");
    }

    setBusy("send");
    try {
      const input: MailSendInput = { ...c, draftId, sendAt: at };
      const res = await sendMailNow(input, from?.key);
      if (res.scheduled) {
        const when = new Date(at!).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
        toast.success(`${when}에 보내도록 예약했어요.`, { title: "예약 완료" });
      } else {
        if (res.sent) publish([{ ...res.sent, acct: from?.key }]);
        const who = self ? "나" : c.to[0]?.name || c.to[0]?.address || c.cc[0]?.address || "받는 사람";
        if (res.failed?.length) toast.error(`${res.failed.join(", ")} 에게는 보내지 못했어요.`, { title: "일부만 보냄" });
        else toast.success(`${who}에게 보냈어요.`, { title: "메일 보냄" });
      }
      dirty.current = false;
      void refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const title = init?.ref ? TITLE[init.ref.mode] : self ? "내게쓰기" : "메일쓰기";

  const fileRows = [
    ...forwardFiles.map((f) => ({
      key: `fw-${f.index}`,
      name: f.name,
      size: f.size,
      note: forwardSkip.has(f.index) ? "빼기로 함" : "원본 첨부",
      skipped: forwardSkip.has(f.index),
      failed: false,
    })),
    ...files.map((f) => ({
      key: f.key,
      name: f.name,
      size: f.size,
      note: f.status === "uploading" ? `올리는 중 ${Math.round(f.progress * 100)}%` : f.status === "error" ? f.error ?? "실패" : "",
      skipped: false,
      failed: f.status === "error",
    })),
  ];

  return (
    <>
      <Dialog
        open={!!init}
        onClose={() => void close()}
        title={title}
        size="xl"
        closeOnOverlay={false}
        initialFocus={to.length || self ? subjectRef : toRef}
        bodyClassName="pt-1"
        footer={
          <>
            <Button variant="ghost" icon={Eye} onClick={() => setPreview(true)} className="mr-auto">
              미리보기
            </Button>
            <Button variant="secondary" icon={Save} loading={busy === "save"} disabled={!!busy} onClick={() => void saveNow()}>
              임시저장
            </Button>
            <Button icon={scheduleOn ? Clock : Send} loading={busy === "send"} disabled={!!busy || over} onClick={() => void send()}>
              {scheduleOn ? "예약하기" : "보내기"}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onKeyDown={(e) => {
            // ⌘/Ctrl + Enter 로 보내기
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          onChange={touch}
        >
          {/* 보내기 설정 — 카페24 쓰기 화면 오른쪽 위와 같은 것 */}
          <div className="flex min-h-ctl-md flex-wrap items-center gap-x-4 gap-y-2 rounded-nd-md bg-nd-sunken px-3 py-1.5">
            <Checkbox label="보낸메일함 저장" checked={saveSent || self} disabled={self} onChange={(e) => setSaveSent(e.target.checked)} />
            <Checkbox
              label="한 사람씩 보내기"
              checked={individually}
              disabled={self}
              onChange={(e) => setIndividually(e.target.checked)}
            />
            <Checkbox label="예약 발송" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
            <label className="ml-auto flex items-center gap-2 text-nd-body text-nd-fg-2">
              서명
              <Select
                size="sm"
                aria-label="서명"
                value={sigId}
                onChange={(e) => applySignature(signatures.find((s) => s.id === e.target.value) ?? null)}
                className="w-auto min-w-[120px]"
              >
                <option value="">넣지 않음</option>
                {signatures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            {scheduleOn && (
              <Input
                type="datetime-local"
                size="sm"
                aria-label="예약 시각"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
                className="w-auto"
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[88px_minmax(0,1fr)]">
            {accounts.length > 1 && (
              <>
                <RowLabel htmlFor="mail-from">보내는 계정</RowLabel>
                <Select
                  id="mail-from"
                  value={from?.key ?? ""}
                  // 임시저장·예약은 그 계정의 메일함에 들어 있다 — 도중에 바꾸면 두 계정에 갈라진다
                  disabled={!!draftId}
                  onChange={(e) => {
                    const next = accounts.find((a) => a.key === e.target.value);
                    setFromKey(e.target.value);
                    // 보내는 계정이 바뀌면 그 계정의 서명으로 (서명을 넣어 둔 쓰기일 때만)
                    if (sigId || init?.sigMode) applySignature(defaultSignature(next, init?.sigMode ?? "new"));
                    touch();
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label ? `${a.label} · ` : ""}
                      {a.name ? `${a.name} <${a.address}>` : a.address}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <RowLabel>받는사람</RowLabel>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                {self ? (
                  <div className="flex h-ctl-md items-center rounded-nd-md border border-nd-border bg-nd-sunken px-3 text-nd-body text-nd-fg-2">
                    나 ({from?.address})
                  </div>
                ) : (
                  <RecipientInput
                    value={to}
                    onChange={(v) => (setTo(v), touch())}
                    ariaLabel="받는사람"
                    placeholder="이름이나 주소 — 쉼표로 여러 명"
                    inputRef={toRef}
                  />
                )}
              </div>
              <div className="flex h-ctl-md shrink-0 items-center gap-2">
                <Checkbox label="내게쓰기" checked={self} onChange={(e) => setSelf(e.target.checked)} />
                <Button variant="secondary" size="sm" icon={BookUser} onClick={() => setBookOpen(true)} disabled={self}>
                  주소록
                </Button>
              </div>
            </div>

            {!self && (
              <>
                <RowLabel>참조</RowLabel>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <RecipientInput value={cc} onChange={(v) => (setCc(v), touch())} ariaLabel="참조" />
                  </div>
                  <div className="flex h-ctl-md shrink-0 items-center">
                    <Button variant="ghost" size="sm" icon={Plus} aria-expanded={showBcc} onClick={() => setShowBcc((v) => !v)}>
                      숨은참조
                    </Button>
                  </div>
                </div>
                {showBcc && (
                  <>
                    <RowLabel>숨은참조</RowLabel>
                    <RecipientInput value={bcc} onChange={(v) => (setBcc(v), touch())} ariaLabel="숨은참조" />
                  </>
                )}
              </>
            )}

            <RowLabel htmlFor="mail-subject">제목</RowLabel>
            <Input
              id="mail-subject"
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="제목을 입력하세요"
            />

            <RowLabel>파일첨부</RowLabel>
            <div
              className={cn(
                "rounded-nd-md border border-dashed border-nd-border transition-colors duration-nd-fast",
                dragging && "border-nd-accent bg-nd-accent-soft/40",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <Button variant="secondary" size="sm" icon={Paperclip} onClick={() => fileRef.current?.click()}>
                  파일찾기
                </Button>
                <Button variant="ghost" size="sm" icon={Trash2} disabled={!picked.size} onClick={removePicked}>
                  삭제
                </Button>
                <span className={cn("ml-auto text-nd-caption", over ? "text-nd-danger-text" : "text-nd-fg-3")}>
                  일반 {formatFileSize(total)} / 20MB
                </span>
              </div>
              {fileRows.length === 0 ? (
                <p className="flex items-center justify-center gap-1.5 border-t border-nd-line px-3 py-4 text-nd-caption text-nd-fg-3">
                  <Icon icon={UploadCloud} size={15} />
                  여기로 파일을 끌어 놓아도 됩니다
                </p>
              ) : (
                <ul className="border-t border-nd-line">
                  {fileRows.map((f) => (
                    <li key={f.key} className="flex items-center gap-2 border-b border-nd-line px-2 py-1.5 last:border-b-0">
                      <Checkbox
                        aria-label={`${f.name} 고르기`}
                        checked={picked.has(f.key)}
                        disabled={f.skipped}
                        onChange={(e) =>
                          setPicked((p) => {
                            const next = new Set(p);
                            if (e.target.checked) next.add(f.key);
                            else next.delete(f.key);
                            return next;
                          })
                        }
                      />
                      <Icon icon={FileText} size={14} className="shrink-0 text-nd-fg-3" />
                      <span className={cn("min-w-0 flex-1 truncate text-nd-body", f.skipped ? "text-nd-fg-3 line-through" : "text-nd-fg")}>
                        {f.name}
                      </span>
                      {f.note && (
                        <span className={cn("shrink-0 text-nd-caption", f.failed ? "text-nd-danger-text" : "text-nd-fg-3")}>{f.note}</span>
                      )}
                      <span className="w-16 shrink-0 text-right text-nd-caption text-nd-fg-3">{formatFileSize(f.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <RichEditor
            mode={mode}
            onModeChange={(m) => (setMode(m), touch())}
            html={html}
            text={text}
            resetKey={resetKey}
            onChange={(v) => {
              if (v.html !== undefined) setHtml(v.html);
              setText(v.text);
              touch();
            }}
            footer={
              init?.ref ? (
                <p className="flex items-center gap-1.5 text-nd-caption text-nd-fg-3">
                  <Icon icon={Quote} size={13} />
                  {init.ref.mode === "forward"
                    ? "원본 메일이 본문 아래에 붙어 함께 전달됩니다."
                    : "원본 메일이 본문 아래에 인용되어 함께 보내집니다."}
                </p>
              ) : undefined
            }
          />

          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        </form>
      </Dialog>

      <AddressBook
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        onAdd={(target, list) => {
          const merge = (prev: MailAddr[]) => {
            const have = new Set(prev.map((a) => a.address.toLowerCase()));
            return [...prev, ...list.filter((a) => !have.has(a.address.toLowerCase()))];
          };
          if (target === "to") setTo(merge);
          if (target === "cc") setCc(merge);
          if (target === "bcc") {
            setShowBcc(true);
            setBcc(merge);
          }
          touch();
        }}
      />

      <Dialog open={preview} onClose={() => setPreview(false)} title="미리보기" size="lg">
        <div className="flex flex-col gap-2">
          <h3 className="text-nd-title text-nd-fg">{subject || "(제목 없음)"}</h3>
          <p className="text-nd-caption text-nd-fg-3">
            {from && accounts.length > 1 ? `보내는 계정: ${from.address} · ` : ""}
            받는 사람: {self ? from?.address : [...to, ...cc].map((a) => a.name || a.address).join(", ") || "(없음)"}
          </p>
          <MailBody html={mode === "text" ? undefined : html} text={text} />
          {init?.ref && <p className="text-nd-caption text-nd-fg-3">보낼 때 원본 메일이 이 아래에 붙습니다.</p>}
        </div>
      </Dialog>
    </>
  );
}
