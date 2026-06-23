"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { useChat } from "@/components/neander/chat";
import { TEAM_CONVERSATION, dmConversationId } from "@/lib/neander/db/chat";
import { Button, Card, Input, PageHeader, EmptyState, MemberAvatar, cn } from "@/components/neander/ui";
import { formatTimestamp } from "@/lib/neander/format";
import type { ChatMessage } from "@/lib/neander/types";

interface ConvMeta {
  id: string;
  label: string;
  color?: string;
  avatar?: string;
  isTeam: boolean;
}

export default function MessengerPage() {
  const { members, currentMember } = useAppData();
  const { messages, unreadFor, send, markRead } = useChat();
  // 기본은 '선택 없음' — 대화창을 클릭해야 읽음 처리되어 안읽음 수가 유지된다
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const myId = currentMember?.id ?? null;

  // 알림 권한 요청 (최초 1회)
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // 대화 목록: 팀 채팅 + 나를 제외한 멤버들과의 1:1 DM
  const conversations: ConvMeta[] = useMemo(() => {
    const list: ConvMeta[] = [{ id: TEAM_CONVERSATION, label: "전체 팀 채팅", isTeam: true }];
    if (!myId) return list;
    for (const m of members) {
      if (m.id === myId) continue;
      list.push({
        id: dmConversationId(myId, m.id),
        label: m.name,
        color: m.color ?? "#71717a",
        avatar: m.avatar,
        isTeam: false,
      });
    }
    return list;
  }, [members, myId]);

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

  // 선택 대화에 안읽음이 있고 화면이 보일 때 읽음 처리
  useEffect(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (unreadFor(selected) > 0) markRead(selected);
  }, [selected, messages, unreadFor, markRead]);

  // 새 메시지 시 맨 아래로 스크롤
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [convMessages.length, selected]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      await send(selected, t);
      setText("");
      markRead(selected);
    } finally {
      setSending(false);
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

  return (
    <div>
      <PageHeader title="메신저" description="전체 팀 채팅과 팀원 간 1:1 대화. 탭이 열려 있으면 새 메시지를 브라우저 알림으로 받습니다." />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* 대화 목록 */}
        <Card className="!p-2">
          <div className="flex flex-col gap-1">
            {conversations.map((c) => {
              const unread = unreadFor(c.id);
              const last = lastByConv.get(c.id);
              const active = c.id === selected;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelected(c.id);
                    markRead(c.id);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-left transition",
                    active ? "bg-indigo-50" : "hover:bg-zinc-100",
                  )}
                >
                  {c.isTeam ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold text-white">
                      팀
                    </span>
                  ) : (
                    <MemberAvatar
                      name={c.label}
                      color={c.color}
                      avatar={c.avatar}
                      className="h-8 w-8 text-sm"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("truncate text-sm", active ? "font-semibold text-indigo-700" : "font-medium text-zinc-800")}>
                        {c.label}
                      </span>
                      {unread > 0 && (
                        <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          {unread}
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-xs text-zinc-400">
                      {last ? `${last.senderName === currentMember.name ? "나" : last.senderName}: ${last.text}` : "대화를 시작하세요"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* 대화창 */}
        <Card className="flex h-[600px] flex-col !p-0">
          <div className="border-b border-zinc-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-800">{selectedMeta?.label ?? "대화를 선택하세요"}</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!selected ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-400">왼쪽에서 대화를 선택하세요 💬</p>
              </div>
            ) : convMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-400">첫 메시지를 보내보세요 💬</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {convMessages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                      {!mine && selectedMeta?.isTeam && (
                        <span className="mb-0.5 text-[11px] text-zinc-400">{m.senderName}</span>
                      )}
                      <div className="flex items-end gap-1.5">
                        {mine && <span className="text-[10px] text-zinc-300">{formatTimestamp(m.createdAt)}</span>}
                        <div
                          className={cn(
                            "max-w-[420px] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                            mine ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-800",
                          )}
                        >
                          {m.text}
                        </div>
                        {!mine && <span className="text-[10px] text-zinc-300">{formatTimestamp(m.createdAt)}</span>}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-zinc-100 p-3">
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
