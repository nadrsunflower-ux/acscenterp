"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useChat } from "@/components/neander/chat";
import { TEAM_CONVERSATION, dmConversationId, uploadChatFile } from "@/lib/neander/db/chat";
import {
  createConversation,
  renameConversation,
  leaveConversation,
} from "@/lib/neander/db/conversations";
import { Button, Card, Input, PageHeader, EmptyState, MemberAvatar, cn } from "@/components/neander/ui";
import {
  sameDay,
  sameMinute,
  formatChatTime,
  formatChatDate,
  formatFileSize,
} from "@/lib/neander/format";
import type { ChatMessage, Conversation, Member } from "@/lib/neander/types";

const MAX_FILE_MB = 25;

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
      alert(`파일이 너무 큽니다. 최대 ${MAX_FILE_MB}MB 까지 첨부할 수 있어요.`);
      return;
    }
    setUploadPct(0);
    try {
      const attachment = await uploadChatFile(selected, file, setUploadPct);
      await send(selected, "", attachment);
      markRead(selected);
    } catch (err) {
      console.error(err);
      alert("파일 업로드에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setUploadPct(null);
    }
  }

  if (!currentMember) {
    return (
      <div>
        <PageHeader title="메신저" description="팀원 간 실시간 대화" />
        <EmptyState
          icon="💬"
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
      <PageHeader title="메신저" description="전체 팀 채팅·1:1·단체 채팅방. 이미지/파일 첨부 가능. 탭이 열려 있으면 새 메시지를 알림으로 받습니다." />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* 대화 목록 (모바일: 대화 선택 시 숨김) */}
        <Card className={cn("!p-2 lg:max-h-[600px] lg:overflow-y-auto", selected && "hidden lg:block")}>
          {/* 새 채팅방 만들기 */}
          <button
            onClick={() => setCreating((v) => !v)}
            className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50"
          >
            {creating ? "✕ 닫기" : "＋ 새 채팅방"}
          </button>

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

          <div className="flex flex-col gap-1">
            {conversations.map((c) => {
              const unread = unreadFor(c.id);
              const last = lastByConv.get(c.id);
              const active = c.id === selected;
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-left transition",
                    active ? "bg-indigo-50" : "hover:bg-zinc-100",
                  )}
                >
                  <ConvBadge meta={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("truncate text-sm", active ? "font-semibold text-indigo-700" : "font-medium text-zinc-800")}>
                        {c.label}
                        {c.kind === "room" && c.room && (
                          <span className="ml-1 text-[10px] font-normal text-zinc-400">
                            {c.room.isGroup ? `· ${c.room.memberIds.length}명` : "· 1:1"}
                          </span>
                        )}
                      </span>
                      {unread > 0 && (
                        <span className="shrink-0 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          {unread}
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-xs text-zinc-400">
                      {last ? lastPreview(last, currentMember.name) : "대화를 시작하세요"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* 대화창 (모바일: 선택 없을 때 숨김) */}
        <Card className={cn("flex h-[70vh] min-h-[420px] flex-col !p-0 lg:h-[600px]", !selected && "hidden lg:flex")}>
          {/* 헤더 */}
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-3 sm:px-4">
            {/* 모바일 뒤로가기 */}
            <button
              onClick={() => setSelected("")}
              className="-ml-1 rounded-lg px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 lg:hidden"
              aria-label="대화 목록으로"
            >
              ←
            </button>
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
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  className="h-8 flex-1 !py-1"
                  placeholder="채팅방 이름"
                />
                <Button type="submit" className="!px-2.5 !py-1 !text-xs">저장</Button>
                <Button type="button" variant="secondary" className="!px-2.5 !py-1 !text-xs" onClick={() => setRenaming(false)}>
                  취소
                </Button>
              </form>
            ) : (
              <>
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">
                  {selectedMeta?.label ?? "대화를 선택하세요"}
                  {selectedMeta?.kind === "room" && selectedMeta.room && (
                    <span className="ml-1.5 text-xs font-normal text-zinc-400">
                      {selectedMeta.room.isGroup ? `${selectedMeta.room.memberIds.length}명` : "1:1"}
                    </span>
                  )}
                </h2>
                {selectedMeta?.kind === "room" && selectedMeta.room && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => {
                        setRenameText(selectedMeta.room!.name);
                        setRenaming(true);
                      }}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
                    >
                      ✏️ 이름
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`'${selectedMeta.room!.name}' 채팅방에서 나갈까요?`)) {
                          await leaveConversation(selectedMeta.room!.id, myId!);
                          setSelected("");
                        }
                      }}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-red-50 hover:text-red-500"
                    >
                      나가기
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            {!selected ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-400">왼쪽에서 대화를 선택하세요 💬</p>
              </div>
            ) : convMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-400">첫 메시지를 보내보세요 💬</p>
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
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-500">
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
            <div className="border-t border-zinc-100 px-4 py-2">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="whitespace-nowrap">
                  {uploadPct === 100 ? "첨부 마무리 중…" : `첨부 업로드 중… ${uploadPct}%`}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={cn("h-full bg-indigo-500 transition-all", uploadPct === 100 && "animate-pulse")}
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 입력 */}
          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-zinc-100 p-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handlePickFile}
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.txt,.zip"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selected || uploading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-lg text-zinc-500 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="파일 첨부"
              title="이미지/파일 첨부"
            >
              📎
            </button>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={selected ? "메시지를 입력하세요" : "먼저 대화를 선택하세요"}
              className="flex-1"
              disabled={!selected}
            />
            <Button type="submit" disabled={sending || !text.trim() || !selected}>
              전송
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
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold text-white">
        팀
      </span>
    );
  }
  if (meta.kind === "room") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-base text-white">
        {meta.room?.isGroup ? "👥" : "💬"}
      </span>
    );
  }
  return <MemberAvatar name={meta.label} color={meta.color} avatar={meta.avatar} className="h-9 w-9 text-sm" />;
}

// ---- 목록 미리보기 텍스트 ---------------------------------
function lastPreview(m: ChatMessage, myName: string): string {
  const who = m.senderName === myName ? "나" : m.senderName;
  const body = m.text || (m.attachment ? (m.attachment.kind === "image" ? "📷 사진" : `📎 ${m.attachment.name}`) : "");
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
      {showSender && <span className="mb-0.5 ml-1 text-[11px] text-zinc-400">{m.senderName}</span>}
      <div className={cn("flex items-end gap-1.5", mine ? "flex-row-reverse" : "flex-row")}>
        <div className={cn("flex max-w-[78vw] flex-col gap-1 sm:max-w-[440px]", mine ? "items-end" : "items-start")}>
          {m.attachment?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={m.attachment.url} target="_blank" rel="noreferrer">
              <img
                src={m.attachment.url}
                alt={m.attachment.name}
                className="max-h-64 max-w-full rounded-2xl border border-zinc-200 object-cover"
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
                "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm ring-1 transition",
                mine ? "bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-700" : "bg-white text-zinc-800 ring-zinc-200 hover:bg-zinc-50",
              )}
            >
              <span className="text-lg">📎</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{m.attachment.name}</span>
                <span className={cn("text-[11px]", mine ? "text-indigo-100" : "text-zinc-400")}>
                  {formatFileSize(m.attachment.size)}
                </span>
              </span>
            </a>
          )}
          {m.text && (
            <div
              className={cn(
                "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                mine ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-800",
              )}
            >
              {m.text}
            </div>
          )}
        </div>
        {showTime && <span className="mb-0.5 shrink-0 text-[10px] text-zinc-300">{formatChatTime(m.createdAt)}</span>}
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
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isGroup = picked.length > 1;

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    if (picked.length === 0) {
      alert("대화 상대를 한 명 이상 선택하세요.");
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
    <div className="mb-2 flex flex-col gap-3 rounded-lg bg-zinc-50 p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-500">대화 상대 (복수 선택 = 단체방)</span>
        {members.length === 0 ? (
          <p className="text-xs text-zinc-400">다른 팀원이 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = picked.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition",
                    on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
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
        <span className="text-xs font-medium text-zinc-500">
          채팅방 이름 <span className="text-zinc-400">(선택 — 비우면 자동 지정)</span>
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isGroup ? "예: 마케팅 TF" : "예: 주연님과의 대화"}
          className="h-9 !py-1.5"
        />
      </div>
      <Button onClick={submit} disabled={busy || picked.length === 0} className="!py-1.5 !text-sm">
        {busy ? "만드는 중…" : isGroup ? `단체 채팅방 만들기 (${picked.length + 1}명)` : "1:1 채팅방 만들기"}
      </Button>
    </div>
  );
}
