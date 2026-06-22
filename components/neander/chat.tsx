"use client";

// ============================================================
//  메신저 컨텍스트 (NEANDER ERP)
//  - 최근 메시지 실시간 구독 (전 대화 공통, 안읽음 뱃지/알림용)
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
  isMyConversation,
} from "@/lib/neander/db/chat";
import { useAppData } from "@/components/neander/app-data";
import type { ChatMessage, ChatReads } from "@/lib/neander/types";

const RECENT_LIMIT = 500;

interface ChatValue {
  messages: ChatMessage[]; // 최신순(desc)
  reads: ChatReads;
  /** 현재 사용자가 참여한 대화의 총 안읽음 수 */
  totalUnread: number;
  unreadFor: (conversationId: string) => number;
  /** 메시지 전송. 실제로 전송됐으면 true, (미로그인/빈 텍스트로) 전송 안 됐으면 false */
  send: (conversationId: string, text: string) => Promise<boolean>;
  markRead: (conversationId: string) => void;
}

const ChatContext = createContext<ChatValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { currentMember } = useAppData();
  const myId = currentMember?.id ?? null;
  const myName = currentMember?.name ?? "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reads, setReads] = useState<ChatReads>({});

  // 알림 baseline (최초 로드분은 알림하지 않음)
  const seenIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

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
            isMyConversation(m.conversationId, myId),
        );
        fresh.forEach((m) => {
          seenIds.current.add(m.id);
          notify(m.senderName, m.text);
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
      if (!isMyConversation(m.conversationId, myId)) continue;
      if (m.createdAt > (reads[m.conversationId] ?? 0)) n += 1;
    }
    return n;
  }, [messages, reads, myId]);

  const value: ChatValue = {
    messages,
    reads,
    totalUnread,
    unreadFor,
    async send(conversationId, text) {
      const t = text.trim();
      if (!t || !myId) return false;
      await sendMessage({ conversationId, senderId: myId, senderName: myName, text: t });
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

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Safari 등에서 생성 실패 시 무시
  }
}
