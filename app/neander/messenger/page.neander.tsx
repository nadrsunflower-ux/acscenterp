"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Users,
  X,
} from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useChat } from "@/components/neander/chat";
import { TEAM_CONVERSATION, dmConversationId, uploadChatFile } from "@/lib/neander/db/chat";
import {
  createConversation,
  renameConversation,
  leaveConversation,
} from "@/lib/neander/db/conversations";
import {
  Button,
  Card,
  CountBadge,
  EmptyState,
  Icon,
  IconButton,
  Input,
  MemberAvatar,
  PageHeader,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import {
  sameDay,
  sameMinute,
  formatChatTime,
  formatChatDate,
  formatFileSize,
} from "@/lib/neander/format";
import type { ChatMessage, Conversation, Member } from "@/lib/neander/types";

const MAX_FILE_MB = 25;

/** 대화창 높이 — 상단바·페이지 여백을 뺀 나머지. 모바일에서도 고정 600px 대신 화면에 맞춘다 */
const PANE_H = "h-[calc(100dvh-var(--nd-topbar-h)-6rem)] min-h-[420px]";

type ConvKind = "team" | "room" | "dm";
interface ConvMeta {
  id: string;
  label: string;
  kind: ConvKind;
  color?: string;
  avatar?: string;
  room?: Conversation;
  /** 1:1 DM 상대 (kind==="dm") */
  otherMember?: Member;
  /** 보낸 사람 이름을 말풍선 위에 표시할지 (전체 팀/단체방) */
  showSender: boolean;
}

export default function MessengerPage() {
  const { members, currentMember } = useAppData();
  const { messages, rooms, unreadFor, send, markRead } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  // 기본은 '선택 없음' — 대화창을 클릭해야 읽음 처리되어 안읽음 수가 유지된다
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // 채팅방 만들기 패널
  const [creating, setCreating] = useState(false);
  // 첨부 업로드 상태
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // 방 이름 변경
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const myId = currentMember?.id ?? null;

  // 알림 권한 요청 (최초 1회)
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // 대화 목록: 전체 팀 채팅 + 내가 만든 채팅방 + 팀원별 1:1 DM
  const conversations: ConvMeta[] = useMemo(() => {
    const list: ConvMeta[] = [
      { id: TEAM_CONVERSATION, label: "전체 팀 채팅", kind: "team", showSender: true },
    ];
    if (!myId) return list;
    for (const r of rooms) {
      list.push({ id: r.id, label: r.name, kind: "room", room: r, showSender: r.isGroup });
    }
    for (const m of members) {
      if (m.id === myId) continue;
      list.push({
        id: dmConversationId(myId, m.id),
        label: m.name,
        kind: "dm",
        color: m.color ?? "#71717a",
        avatar: m.avatar,
        otherMember: m,
        showSender: false,
      });
    }
    return list;
  }, [rooms, members, myId]);

  // 대화별 마지막 메시지 (목록 미리보기용) — messages 는 최신순
  const lastByConv = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) {
      if (!map.has(m.conversationId)) map.set(m.conversationId, m);
    }
    return map;
  }, [messages]);

  // 선택된 대화의 메시지 (오래된→최신)
  const convMessages = useMemo(
    () =>
      messages
        .filter((m) => m.conversationId === selected)
        .sort((a, b) => a.createdAt - b.createdAt),
    [messages, selected],
  );

  // 선택 대화에 안읽음이 있고 화면이 보일 때 읽음 처리.
  // 탭이 백그라운드일 때 도착한 메시지는 포그라운드 복귀(visibilitychange) 시 읽음 처리.
  useEffect(() => {
    const tryMark = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (unreadFor(selected) > 0) markRead(selected);
    };
    tryMark();
    document.addEventListener("visibilitychange", tryMark);
    return () => document.removeEventListener("visibilitychange", tryMark);
  }, [selected, messages, unreadFor, markRead]);

  // 새 메시지 시 맨 아래로 스크롤
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [convMessages.length, selected]);

  // 대화 전환 시 이름변경 패널 닫기
  useEffect(() => {
    setRenaming(false);
  }, [selected]);

  function openConversation(id: string) {
    setSelected(id);
    setCreating(false);
    markRead(id);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !selected) return;
    setSending(true);
    try {
      await send(selected, t);
      setText("");
      markRead(selected);
    } finally {
      setSending(false);
    }
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file || !selected) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`파일이 너무 큽니다. 최대 ${MAX_FILE_MB}MB 까지 첨부할 수 있어요.`);
      return;
    }
    setUploadPct(0);
    try {
      const attachment = await uploadChatFile(selected, file, setUploadPct);
      await send(selected, "", attachment);
      markRead(selected);
    } catch (err) {
      console.error(err);
      toast.error("파일 업로드에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setUploadPct(null);
    }
  }

  if (!currentMember) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="메신저" description="팀원 간 실시간 대화" />
        <EmptyState
          icon={MessageCircle}
          title="로그인 계정이 팀원과 연결되어야 합니다"
          description="팀원 관리에서 본인 Google 이메일을 등록하면 메신저를 사용할 수 있습니다."
        />
      </div>
    );
  }

  const selectedMeta = conversations.find((c) => c.id === selected);
  const uploading = uploadPct !== null;

  return (
    <div>
      <PageHeader
        compact
        title="메신저"
        description="전체 팀 채팅·1:1·단체 채팅방. 이미지/파일 첨부 가능. 탭이 열려 있으면 새 메시지를 알림으로 받습니다."
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr] [&>*]:min-w-0">
        {/* 대화 목록 (모바일: 대화 선택 시 숨김) */}
        <Card
          padding="none"
          className={cn(
            "nd-scroll flex flex-col overflow-y-auto lg:h-[calc(100dvh-var(--nd-topbar-h)-6rem)] lg:min-h-[420px]",
            selected && "hidden lg:flex",
          )}
        >
          {/* 새 채팅방 만들기 */}
          <div className="p-2">
            <Button
              variant={creating ? "secondary" : "soft"}
              size="sm"
              icon={creating ? X : Plus}
              onClick={() => setCreating((v) => !v)}
              className="w-full"
              aria-expanded={creating}
            >
              {creating ? "닫기" : "새 채팅방"}
            </Button>
          </div>

          {creating && (
            <NewRoomPanel
              members={members.filter((m) => m.id !== myId)}
              onCreate={async (name, memberIds, isGroup) => {
                const id = await createConversation({
                  name,
                  memberIds: [myId!, ...memberIds],
                  isGroup,
                  createdBy: myId!,
                });
                setCreating(false);
                openConversation(id);
              }}
            />
          )}

          <div className="flex flex-col divide-y divide-nd-line border-t border-nd-line" role="list">
            {conversations.map((c) => {
              const unread = unreadFor(c.id);
              const last = lastByConv.get(c.id);
              const active = c.id === selected;
              return (
                <button
                  key={c.id}
                  role="listitem"
                  onClick={() => openConversation(c.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2.5 px-3 py-2 text-left transition-colors duration-nd-fast",
                    active ? "bg-nd-accent-soft" : "hover:bg-nd-fg/[.04]",
                  )}
                >
                  <ConvBadge meta={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "truncate text-nd-body",
                          active ? "font-semibold text-nd-accent-strong" : "font-medium text-nd-fg",
                        )}
                        title={c.label}
                      >
                        {c.label}
                        {c.kind === "room" && c.room && (
                          <span className="ml-1 text-nd-micro font-normal text-nd-fg-3">
                            {c.room.isGroup ? `· ${c.room.memberIds.length}명` : "· 1:1"}
                          </span>
                        )}
                      </span>
                      <CountBadge count={unread} label={`안읽음 ${unread}건`} className="shrink-0" />
                    </div>
                    <span className="block truncate text-nd-caption text-nd-fg-3">
                      {last ? lastPreview(last, currentMember.name) : "대화를 시작하세요"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* 대화창 (모바일: 선택 없을 때 숨김) */}
        <Card padding="none" className={cn("flex flex-col", PANE_H, !selected && "hidden lg:flex")}>
          {/* 헤더 */}
          <div className="flex items-center gap-2 border-b border-nd-line px-3 py-2.5 sm:px-4">
            {/* 모바일 뒤로가기 */}
            <IconButton
              icon={ArrowLeft}
              label="대화 목록으로"
              onClick={() => setSelected("")}
              className="-ml-1 lg:hidden"
            />
            {renaming && selectedMeta?.kind === "room" ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const n = renameText.trim();
                  if (n && selectedMeta.room) await renameConversation(selectedMeta.room.id, n);
                  setRenaming(false);
                }}
              >
                <Input
                  size="sm"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  className="flex-1"
                  placeholder="채팅방 이름"
                  aria-label="채팅방 이름"
                />
                <Button type="submit" size="sm">
                  저장
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setRenaming(false)}>
                  취소
                </Button>
              </form>
            ) : (
              <>
                <h2 className="min-w-0 flex-1 truncate text-nd-body font-semibold text-nd-fg" title={selectedMeta?.label}>
                  {selectedMeta?.label ?? "대화를 선택하세요"}
                  {selectedMeta?.kind === "room" && selectedMeta.room && (
                    <span className="ml-1.5 text-nd-caption font-normal text-nd-fg-3">
                      {selectedMeta.room.isGroup ? `${selectedMeta.room.memberIds.length}명` : "1:1"}
                    </span>
                  )}
                </h2>
                {selectedMeta?.kind === "room" && selectedMeta.room && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      onClick={() => {
                        setRenameText(selectedMeta.room!.name);
                        setRenaming(true);
                      }}
                    >
                      이름
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={LogOut}
                      className="hover:bg-nd-danger-soft hover:text-nd-danger-text"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `'${selectedMeta.room!.name}' 채팅방에서 나갈까요?`,
                          message: "나가면 이 채팅방의 대화를 더 이상 볼 수 없습니다.",
                          confirmLabel: "나가기",
                          tone: "danger",
                        });
                        if (ok) {
                          await leaveConversation(selectedMeta.room!.id, myId!);
                          setSelected("");
                        }
                      }}
                    >
                      나가기
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 메시지 영역 */}
          <div className="nd-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            {!selected ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  compact
                  icon={MessageCircle}
                  title="왼쪽에서 대화를 선택하세요"
                  className="w-full max-w-sm border-0"
                />
              </div>
            ) : convMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  compact
                  icon={MessageCircle}
                  title="첫 메시지를 보내보세요"
                  className="w-full max-w-sm border-0"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {convMessages.map((m, i) => {
                  const prev = convMessages[i - 1];
                  const next = convMessages[i + 1];
                  const mine = m.senderId === myId;
                  const showDate = !prev || !sameDay(prev.createdAt, m.createdAt);
                  const firstOfGroup =
                    showDate || !prev || prev.senderId !== m.senderId;
                  const lastOfGroup =
                    !next ||
                    next.senderId !== m.senderId ||
                    !sameMinute(next.createdAt, m.createdAt);
                  return (
                    <Fragment key={m.id}>
                      {showDate && (
                        <div className="my-2 flex items-center justify-center">
                          <span className="rounded-full bg-nd-fg/[.06] px-3 py-1 text-nd-micro text-nd-fg-2">
                            {formatChatDate(m.createdAt)}
                          </span>
                        </div>
                      )}
                      <MessageBubble
                        m={m}
                        mine={mine}
                        showSender={!mine && !!selectedMeta?.showSender && firstOfGroup}
                        showTime={lastOfGroup}
                      />
                    </Fragment>
                  );
                })}
                <div ref={endRef} />
              </div>
            )}
          </div>

          {/* 업로드 진행 표시 */}
          {uploading && (
            <div className="border-t border-nd-line px-4 py-2">
              <div className="flex items-center gap-2 text-nd-caption text-nd-fg-2">
                <span className="nd-num whitespace-nowrap">
                  {uploadPct === 100 ? "첨부 마무리 중…" : `첨부 업로드 중… ${uploadPct}%`}
                </span>
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-nd-fg/[.07]"
                  role="progressbar"
                  aria-valuenow={uploadPct ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="첨부 업로드"
                >
                  <div
                    className={cn("h-full bg-nd-accent transition-all duration-nd", uploadPct === 100 && "animate-pulse")}
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 입력 */}
          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-nd-line p-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handlePickFile}
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.txt,.zip"
            />
            <IconButton
              icon={Paperclip}
              label="파일 첨부"
              variant="secondary"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selected || uploading}
            />
            <Input
              size="lg"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={selected ? "메시지를 입력하세요" : "먼저 대화를 선택하세요"}
              className="min-w-0 flex-1"
              disabled={!selected}
              aria-label="메시지"
            />
            <Button type="submit" size="lg" icon={Send} aria-label="전송" disabled={sending || !text.trim() || !selected}>
              <span className="hidden sm:inline">전송</span>
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

// ---- 대화 목록 뱃지(아바타) -------------------------------
function ConvBadge({ meta }: { meta: ConvMeta }) {
  if (meta.kind === "team") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nd-accent text-nd-body font-bold text-white" aria-hidden>
        팀
      </span>
    );
  }
  if (meta.kind === "room") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nd-success text-white" aria-hidden>
        <Icon icon={meta.room?.isGroup ? Users : MessageCircle} size={16} />
      </span>
    );
  }
  return <MemberAvatar name={meta.label} color={meta.color} avatar={meta.avatar} className="h-9 w-9 text-sm" />;
}

// ---- 목록 미리보기 텍스트 ---------------------------------
function lastPreview(m: ChatMessage, myName: string): string {
  const who = m.senderName === myName ? "나" : m.senderName;
  const body = m.text || (m.attachment ? (m.attachment.kind === "image" ? "사진" : `파일 · ${m.attachment.name}`) : "");
  return `${who}: ${body}`;
}

// ---- 메시지 말풍선 (이미지/파일/텍스트 + 시간) ------------
function MessageBubble({
  m,
  mine,
  showSender,
  showTime,
}: {
  m: ChatMessage;
  mine: boolean;
  showSender: boolean;
  showTime: boolean;
}) {
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {showSender && <span className="mb-0.5 ml-1 text-nd-micro font-normal text-nd-fg-3">{m.senderName}</span>}
      <div className={cn("flex items-end gap-1.5", mine ? "flex-row-reverse" : "flex-row")}>
        <div className={cn("flex max-w-[78vw] flex-col gap-1 sm:max-w-[440px]", mine ? "items-end" : "items-start")}>
          {m.attachment?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={m.attachment.url} target="_blank" rel="noreferrer">
              <img
                src={m.attachment.url}
                alt={m.attachment.name}
                className="max-h-64 max-w-full rounded-nd-lg border border-nd-line object-cover"
              />
            </a>
          )}
          {m.attachment?.kind === "file" && (
            <a
              href={m.attachment.url}
              target="_blank"
              rel="noreferrer"
              download={m.attachment.name}
              className={cn(
                "flex items-center gap-2 rounded-nd-lg px-3 py-2 text-nd-body transition-colors duration-nd-fast",
                mine
                  ? "bg-nd-accent text-white hover:bg-nd-accent-strong"
                  : "bg-nd-sunken text-nd-fg ring-1 ring-nd-line hover:bg-nd-fg/[.06]",
              )}
            >
              <Icon icon={Paperclip} size={18} className={mine ? "text-white/80" : "text-nd-fg-3"} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium" title={m.attachment.name}>
                  {m.attachment.name}
                </span>
                <span className={cn("nd-num text-nd-micro font-normal", mine ? "text-white/70" : "text-nd-fg-3")}>
                  {formatFileSize(m.attachment.size)}
                </span>
              </span>
            </a>
          )}
          {m.text && (
            <div
              className={cn(
                "whitespace-pre-wrap break-words rounded-nd-lg px-3 py-2 text-nd-body",
                mine ? "bg-nd-accent text-white" : "bg-nd-sunken text-nd-fg",
              )}
            >
              {m.text}
            </div>
          )}
        </div>
        {showTime && <span className="nd-num mb-0.5 shrink-0 text-nd-micro font-normal text-nd-fg-4">{formatChatTime(m.createdAt)}</span>}
      </div>
    </div>
  );
}

// ---- 새 채팅방 만들기 패널 --------------------------------
function NewRoomPanel({
  members,
  onCreate,
}: {
  members: Member[];
  onCreate: (name: string, memberIds: string[], isGroup: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isGroup = picked.length > 1;

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    if (picked.length === 0) {
      toast.error("대화 상대를 한 명 이상 선택하세요.");
      return;
    }
    const pickedNames = picked.map((id) => members.find((m) => m.id === id)?.name ?? "").filter(Boolean);
    const autoName = isGroup
      ? `${pickedNames.slice(0, 3).join(", ")}${pickedNames.length > 3 ? ` 외 ${pickedNames.length - 3}` : ""}`
      : pickedNames[0] ?? "새 채팅방";
    setBusy(true);
    try {
      await onCreate(name.trim() || autoName, picked, isGroup);
      setName("");
      setPicked([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-2 mb-2 flex flex-col gap-3 rounded-nd-md bg-nd-sunken p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-nd-caption font-medium text-nd-fg-2">대화 상대 (복수 선택 = 단체방)</span>
        {members.length === 0 ? (
          <p className="text-nd-caption text-nd-fg-3">다른 팀원이 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = picked.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-nd-caption font-medium transition-colors duration-nd-fast",
                    on
                      ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                      : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-fg/[.04]",
                  )}
                >
                  <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-5 w-5 text-[10px]" />
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-nd-caption font-medium text-nd-fg-2">
          채팅방 이름 <span className="text-nd-fg-3">(선택 — 비우면 자동 지정)</span>
        </span>
        <Input
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isGroup ? "예: 마케팅 TF" : "예: 주연님과의 대화"}
          aria-label="채팅방 이름"
        />
      </div>
      <Button size="sm" onClick={submit} disabled={busy || picked.length === 0} loading={busy}>
        {busy ? "만드는 중…" : isGroup ? `단체 채팅방 만들기 (${picked.length + 1}명)` : "1:1 채팅방 만들기"}
      </Button>
    </div>
  );
}
