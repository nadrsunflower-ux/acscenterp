"use client";

// ============================================================
//  메신저 컨텍스트 (NEANDER ERP)
//  - 최근 메시지 실시간 구독 (전 대화 공통, 안읽음 뱃지/알림용)
//  - 내가 참여한 채팅방(neander_conversations) 실시간 구독
//  - 현재 사용자의 대화별 읽음 시각 구독
//  - 새 메시지 도착 시 브라우저 알림 (탭이 열려 있고 포커스가 없을 때)
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  subscribeRecentMessages,
  subscribeReads,
  sendMessage,
  markConversationRead,
  TEAM_CONVERSATION,
} from "@/lib/neander/db/chat";
import { subscribeConversations, touchConversation } from "@/lib/neander/db/conversations";
import { useAppData } from "@/components/neander/app-data";
import type { ChatAttachment, ChatMessage, ChatReads, Conversation } from "@/lib/neander/types";

const RECENT_LIMIT = 500;

interface ChatValue {
  messages: ChatMessage[]; // 최신순(desc)
  reads: ChatReads;
  /** 내가 참여한 사용자 정의 채팅방 (최근 활동순) */
  rooms: Conversation[];
  /** 현재 사용자가 참여한 대화의 총 안읽음 수 */
  totalUnread: number;
  unreadFor: (conversationId: string) => number;
  /** 이 대화가 현재 사용자에게 보이는 대화인지 (team / 내 dm / 내가 속한 방) */
  belongsToMe: (conversationId: string) => boolean;
  /**
   * 메시지 전송. 텍스트와/또는 첨부를 보낼 수 있다.
   * 실제로 전송됐으면 true, (미로그인/내용 없음으로) 전송 안 됐으면 false
   */
  send: (
    conversationId: string,
    text: string,
    attachment?: ChatAttachment,
  ) => Promise<boolean>;
  markRead: (conversationId: string) => void;
}

const ChatContext = createContext<ChatValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { currentMember, members } = useAppData();
  const myId = currentMember?.id ?? null;
  const myName = currentMember?.name ?? "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reads, setReads] = useState<ChatReads>({});
  const [rooms, setRooms] = useState<Conversation[]>([]);

  // 내가 속한 방 id 집합 — 알림/안읽음 멤버십 판정에 사용
  const roomIdSet = useMemo(() => new Set(rooms.map((r) => r.id)), [rooms]);
  // 현존 팀원 id 집합 — 삭제된 멤버와의 DM(유령 안읽음)을 제외하는 데 사용
  const memberIdSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  // 알림 콜백(구독 클로저)에서 최신 집합을 읽기 위한 ref
  const roomIdsRef = useRef<Set<string>>(new Set());
  const memberIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    roomIdsRef.current = roomIdSet;
  }, [roomIdSet]);
  useEffect(() => {
    memberIdsRef.current = memberIdSet;
  }, [memberIdSet]);

  // 멤버십 판정 (team / 내 dm / 내가 속한 방). 집합들을 인자로 받아 순수하게 유지.
  const belongsWith = (
    conversationId: string,
    id: string | null,
    roomIds: Set<string>,
    memberIds: Set<string>,
  ) => {
    if (conversationId === TEAM_CONVERSATION) return true;
    if (conversationId.startsWith("dm_")) {
      if (id == null) return false;
      const parts = conversationId.slice(3).split("__");
      if (!parts.includes(id)) return false;
      // 상대(나 외)가 현존 팀원일 때만 내 대화로 인정 → 삭제된 멤버 DM 제외
      const other = parts.find((p) => p !== id);
      return other != null && memberIds.has(other);
    }
    return roomIds.has(conversationId);
  };

  // 알림 baseline (최초 로드분은 알림하지 않음)
  const seenIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  // 내 채팅방 구독
  useEffect(() => {
    if (!myId) return;
    return subscribeConversations(myId, setRooms);
  }, [myId]);

  // 최근 메시지 구독
  useEffect(() => {
    if (!myId) return;
    return subscribeRecentMessages(RECENT_LIMIT, (msgs) => {
      if (!initialized.current) {
        msgs.forEach((m) => seenIds.current.add(m.id));
        initialized.current = true;
      } else if (typeof document !== "undefined" && document.hidden) {
        // 탭이 열려 있으나 포커스가 없을 때만 알림
        const fresh = msgs.filter(
          (m) =>
            !seenIds.current.has(m.id) &&
            m.senderId !== myId &&
            belongsWith(m.conversationId, myId, roomIdsRef.current, memberIdsRef.current),
        );
        fresh.forEach((m) => {
          seenIds.current.add(m.id);
          notify(m.senderName, notificationBody(m));
        });
      }
      msgs.forEach((m) => seenIds.current.add(m.id));
      setMessages(msgs);
    });
  }, [myId]);

  // 읽음 상태 구독
  useEffect(() => {
    if (!myId) return;
    return subscribeReads(myId, setReads);
  }, [myId]);

  const unreadFor = useMemo(() => {
    return (conversationId: string) => {
      if (!myId) return 0;
      const last = reads[conversationId] ?? 0;
      return messages.filter(
        (m) =>
          m.conversationId === conversationId &&
          m.senderId !== myId &&
          m.createdAt > last,
      ).length;
    };
  }, [messages, reads, myId]);

  const totalUnread = useMemo(() => {
    if (!myId) return 0;
    let n = 0;
    for (const m of messages) {
      if (m.senderId === myId) continue;
      if (!belongsWith(m.conversationId, myId, roomIdSet, memberIdSet)) continue;
      if (m.createdAt > (reads[m.conversationId] ?? 0)) n += 1;
    }
    return n;
  }, [messages, reads, myId, roomIdSet, memberIdSet]);

  const value: ChatValue = {
    messages,
    reads,
    rooms,
    totalUnread,
    unreadFor,
    belongsToMe: (conversationId) => belongsWith(conversationId, myId, roomIdSet, memberIdSet),
    async send(conversationId, text, attachment) {
      const t = text.trim();
      if ((!t && !attachment) || !myId) return false;
      await sendMessage({
        conversationId,
        senderId: myId,
        senderName: myName,
        text: t,
        attachment,
      });
      // 사용자 정의 방이면 목록 정렬용 활동 시각 갱신 (실패해도 무시)
      if (roomIdSet.has(conversationId)) {
        touchConversation(conversationId).catch(() => {});
      }
      return true;
    },
    markRead(conversationId) {
      if (myId) markConversationRead(myId, conversationId);
    },
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}

/** 알림 본문: 텍스트 우선, 없으면 첨부 종류 안내 */
function notificationBody(m: ChatMessage): string {
  if (m.text) return m.text;
  if (m.attachment) return m.attachment.kind === "image" ? "📷 사진" : `📎 ${m.attachment.name}`;
  return "";
}

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Safari 등에서 생성 실패 시 무시
  }
}
