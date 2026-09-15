"use client";

// ============================================================
//  비서 채팅 패널 — 모듈 공용 껍데기
// ------------------------------------------------------------
//  재무 비서(finance/FinanceChat.tsx)의 패널을 그대로 뽑아 모듈 무관하게
//  만든 것이다. 도킹/팝업 배치, 지난 대화, 모델 선택, 첨부, 마크다운 표시,
//  조회 근거 펼침 — 이건 어느 비서든 같다.
//
//  모듈마다 다른 것만 adapter 로 받는다:
//    · 이름·안내문·예시 질문
//    · 서버와 주고받는 함수 (보내기·목록·불러오기·삭제)
//    · 제안의 모양 — 카드를 어떻게 그리고, 「적용」이 무엇을 저장하는지
//
//  ⚠️ 모델은 데이터를 직접 바꾸지 못한다. 제안은 「바뀔 내용」을 보여주고,
//     사람이 「적용」을 눌러야 그때 각 모듈의 저장 경로로 나간다. 그래서 이
//     패널의 화면 대부분은 "무엇이 바뀌는지" 를 보여주는 데 쓴다.
//
//  재무 비서는 아직 자기 파일을 쓴다. 그쪽 작업이 잠잠해지면 어댑터 하나로
//  여기에 얹으면 된다 — 그때 FinanceChat.tsx 는 100줄로 줄어든다.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Dialog,
  Icon,
  IconButton,
  InlineNotice,
  LoadingState,
  Menu,
  cn,
  useConfirm,
  useMediaQuery,
} from "@/components/neander/ui";
import {
  ChevronUp,
  FileDown,
  History,
  MessageSquareText,
  PanelRight,
  Paperclip,
  PictureInPicture2,
  Plus,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { ToolbarPortal, useDockReservation } from "@/components/neander/shell/context";
import {
  ASSISTANT_CONTEXT_EVENT,
  ASSISTANT_EVENT,
  announceAssistant,
  type AssistantAction,
  type PresentationContext,
} from "./events";
import type { AgentMessage, AgentResult } from "@/lib/neander/ai/agent";
import type { AssistantChatDoc, AssistantChatSummary } from "@/lib/neander/ai/chat-log";
import {
  DEFAULT_FIN_AI_MODEL,
  FIN_AI_MODELS,
  finAiModelConfirm,
  finAiModelLabel,
  isFinAiModelId,
  type FinAiModelOption,
} from "@/lib/neander/ai/models";
import { openChatReportPdf } from "@/lib/neander/ai/chat-pdf";
import {
  ATTACH_ACCEPT,
  ATTACH_EXTS,
  MAX_ATTACH_FILES,
  MAX_ATTACH_TOTAL_BYTES,
  fileExt,
} from "@/lib/neander/ai/attachment-limits";

export type AssistantResult<P> = AgentResult<P> & { conversationId?: string };

/** 모듈이 채워 주는 것 */
export interface AssistantAdapter<P> {
  /** 「매출 비서」 */
  name: string;
  /** 머리의 한 줄 설명 */
  subtitle: string;
  /** localStorage 키 접두 — 모델·배치는 비서마다 따로 기억한다 */
  storagePrefix: string;
  /** 빈 대화에 보여줄 안내 */
  intro: ReactNode;
  examples: string[];
  inputPlaceholder: string;
  busyLabel: string;

  send: (
    messages: AgentMessage[],
    model: string,
    files: File[],
    conversationId?: string,
    /** 보고 슬라이드 발표 중이면 그 달·장 — 서버가 기간 없는 질문의 기준으로 쓴다 */
    context?: PresentationContext,
  ) => Promise<AssistantResult<P>>;
  listChats: () => Promise<AssistantChatSummary[]>;
  loadChat: (id: string) => Promise<AssistantChatDoc<P>>;
  deleteChat: (id: string) => Promise<void>;

  /** 제안을 실제로 저장한다 — 사람이 「적용」을 눌렀을 때만 불린다 */
  apply: (proposal: P) => Promise<void>;
  proposalKey: (proposal: P) => string;
  renderProposal: (props: {
    proposal: P;
    applied: boolean;
    busy: boolean;
    onApply: () => void;
    onDismiss: () => void;
  }) => ReactNode;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dockWidthBounds = () => [320, Math.max(320, Math.min(800, window.innerWidth - 160))] as const;
const NARROW_QUERY = "(max-width: 767px)";

interface Turn<P> {
  role: "user" | "assistant";
  content: string;
  wireContent?: string;
  attachmentNames?: string[];
  readAttachments?: AgentResult<P>["attachments"];
  toolCalls?: AgentResult<P>["toolCalls"];
  proposals?: P[];
  usage?: AgentResult<P>["usage"];
  model?: string;
}

export function AssistantChat<P>({ adapter }: { adapter: AssistantAdapter<P> }) {
  const ask = useConfirm();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn<P>[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [model, setModel] = useState(DEFAULT_FIN_AI_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelToConfirm, setModelToConfirm] = useState<FinAiModelOption | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [listOpen, setListOpen] = useState(false);
  const [chats, setChats] = useState<AssistantChatSummary[] | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [panelMode, setPanelMode] = useState<"docked" | "floating">("docked");
  const [dockWidth, setDockWidth] = useState(448);
  useDockReservation(open && panelMode === "docked" && !narrow ? dockWidth : 0);
  const [floatBox, setFloatBox] = useState({ x: 80, y: 72, w: 420, h: 620 });
  const layoutLoaded = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const MODEL_KEY = `${adapter.storagePrefix}.model`;
  const LAYOUT_KEY = `${adapter.storagePrefix}.layout`;
  const fullScreen = panelMode === "docked" && narrow;

  // 도구 막대가 가려진 화면(발표 화면 Deck)에서도 부를 수 있게 — 창 이벤트로 열고 닫고,
  // 지금 이름·열림 상태를 알린다 (assistant/events.ts)
  useEffect(() => {
    const onCall = (e: Event) => {
      const action = (e as CustomEvent<{ action?: AssistantAction }>).detail?.action;
      if (action === "toggle") setOpen((v) => !v);
      else if (action === "open") setOpen(true);
      else if (action === "close") setOpen(false);
      else if (action === "ping") announceAssistant({ name: adapter.name, open });
    };
    window.addEventListener(ASSISTANT_EVENT, onCall);
    return () => window.removeEventListener(ASSISTANT_EVENT, onCall);
  }, [adapter.name, open]);
  useEffect(() => {
    announceAssistant({ name: adapter.name, open });
  }, [adapter.name, open]);
  useEffect(() => () => announceAssistant({ name: null, open: false }), []);

  // 보고 슬라이드 발표 중이면 그 달·장 — 질문과 함께 서버로 보낸다 (Deck 이 알려 온다)
  const [presentation, setPresentation] = useState<PresentationContext | null>(null);
  useEffect(() => {
    const onCtx = (e: Event) => setPresentation((e as CustomEvent<PresentationContext | null>).detail);
    window.addEventListener(ASSISTANT_CONTEXT_EVENT, onCtx);
    return () => window.removeEventListener(ASSISTANT_CONTEXT_EVENT, onCtx);
  }, []);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list || busy) return;
    const incoming = Array.from(list);
    const next = [...pendingFiles];
    const problems: string[] = [];
    for (const f of incoming) {
      if (!ATTACH_EXTS.includes(fileExt(f.name))) {
        problems.push(`${f.name}: 지원하지 않는 형식 (PDF·docx·엑셀·hwpx·txt 만)`);
        continue;
      }
      if (next.some((p) => p.name === f.name && p.size === f.size)) continue;
      next.push(f);
    }
    if (next.length > MAX_ATTACH_FILES) {
      problems.push(`첨부는 한 번에 ${MAX_ATTACH_FILES}개까지입니다.`);
      next.length = MAX_ATTACH_FILES;
    }
    if (next.reduce((s, f) => s + f.size, 0) > MAX_ATTACH_TOTAL_BYTES) {
      problems.push("첨부 합계가 4MB 를 넘습니다. 필요한 부분만 잘라 올려주세요.");
      setError(problems.join(" · "));
      return;
    }
    setError(problems.length > 0 ? problems.join(" · ") : null);
    setPendingFiles(next);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      if (isFinAiModelId(saved)) setModel(saved);
    } catch {
      /* 저장이 막힌 브라우저면 기본 모델로 */
    }
  }, [MODEL_KEY]);

  const pickModel = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* noop */
    }
  };

  const requestModel = (id: string) => {
    setModelMenuOpen(false);
    const reason = finAiModelConfirm(id, model);
    if (reason === undefined) {
      pickModel(id);
      return;
    }
    setModelToConfirm(FIN_AI_MODELS.find((m) => m.id === id) ?? null);
  };

  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let saved: Partial<{
      mode: string;
      dockWidth: number;
      float: { x: number; y: number; w: number; h: number };
    }> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
    } catch {
      /* 기본 배치 */
    }
    if (saved?.mode === "floating" || saved?.mode === "docked") setPanelMode(saved.mode);
    const [minW, maxW] = dockWidthBounds();
    setDockWidth(clamp(typeof saved?.dockWidth === "number" ? saved.dockWidth : 448, minW, maxW));
    const f = saved?.float;
    setFloatBox({
      w: clamp(typeof f?.w === "number" ? f.w : 420, 340, vw),
      h: clamp(typeof f?.h === "number" ? f.h : 620, 380, vh),
      x: clamp(typeof f?.x === "number" ? f.x : vw - 452, 0, Math.max(0, vw - 240)),
      y: clamp(typeof f?.y === "number" ? f.y : 72, 0, Math.max(0, vh - 160)),
    });
    layoutLoaded.current = true;
  }, [LAYOUT_KEY]);

  useEffect(() => {
    if (!layoutLoaded.current) return;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ mode: panelMode, dockWidth, float: floatBox }));
    } catch {
      /* noop */
    }
  }, [LAYOUT_KEY, panelMode, dockWidth, floatBox]);

  const trackPointer = (onMove: (ev: PointerEvent) => void) => {
    document.body.style.userSelect = "none";
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const startDockResize = (e: React.PointerEvent) => {
    e.preventDefault();
    trackPointer((ev) => {
      const [minW, maxW] = dockWidthBounds();
      setDockWidth(clamp(window.innerWidth - ev.clientX, minW, maxW));
    });
  };

  const startFloatDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y } = floatBox;
    trackPointer((ev) => {
      setFloatBox((f) => ({
        ...f,
        x: clamp(x + ev.clientX - sx, 120 - f.w, window.innerWidth - 120),
        y: clamp(y + ev.clientY - sy, 0, window.innerHeight - 56),
      }));
    });
  };

  const startFloatResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const { w, h } = floatBox;
    trackPointer((ev) => {
      setFloatBox((f) => ({
        ...f,
        w: clamp(w + ev.clientX - sx, 340, window.innerWidth),
        h: clamp(h + ev.clientY - sy, 380, window.innerHeight),
      }));
    });
  };

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, open, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const startNew = useCallback(() => {
    setTurns([]);
    setConversationId(undefined);
    setError(null);
    setPendingFiles([]);
    setListOpen(false);
  }, []);

  const openList = useCallback(async () => {
    setListOpen(true);
    setChats(null);
    try {
      setChats(await adapter.listChats());
    } catch (e) {
      setChats([]);
      setError(e instanceof Error ? e.message : "대화 목록을 불러오지 못했습니다.");
    }
  }, [adapter]);

  const openChat = useCallback(
    async (id: string) => {
      setLoadingChat(true);
      setError(null);
      try {
        const chat = await adapter.loadChat(id);
        setTurns(
          chat.messages.map((m) => ({
            role: m.role,
            content: m.content,
            toolCalls: m.toolCalls?.map((t) => ({ ...t, args: t.args ?? {} })),
            proposals: m.proposals,
          })),
        );
        setConversationId(chat.id);
        // 「적용」 상태는 남기지 않는다 — 이미 적용됐는지는 데이터를 봐야 알고,
        // 여기서 짐작하면 두 번 적용된다.
        setApplied(new Set());
        setListOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "대화를 불러오지 못했습니다.");
      } finally {
        setLoadingChat(false);
      }
    },
    [adapter],
  );

  const removeChat = useCallback(
    async (id: string) => {
      const ok = await ask({
        title: "이 대화를 지울까요?",
        message: "되돌릴 수 없습니다.",
        confirmLabel: "삭제",
        tone: "danger",
      });
      if (!ok) return;
      try {
        await adapter.deleteChat(id);
        setChats((prev) => (prev ?? []).filter((c) => c.id !== id));
        if (conversationId === id) startNew();
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      }
    },
    [adapter, ask, conversationId, startNew],
  );

  const send = async (text: string) => {
    const q = text.trim();
    const files = pendingFiles;
    if ((!q && files.length === 0) || busy) return;
    setError(null);
    setInput("");
    setPendingFiles([]);
    const next: Turn<P>[] = [
      ...turns,
      {
        role: "user",
        content: q || "첨부한 파일을 확인해줘.",
        attachmentNames: files.length > 0 ? files.map((f) => f.name) : undefined,
      },
    ];
    setTurns(next);
    setBusy(true);
    try {
      const history: AgentMessage[] = next.map((t) => ({
        role: t.role,
        content: t.wireContent ?? t.content,
      }));
      const res = await adapter.send(history, model, files, conversationId, presentation ?? undefined);
      if (res.conversationId) setConversationId(res.conversationId);
      const settled = res.sentUserContent
        ? next.map((t, k) => (k === next.length - 1 ? { ...t, wireContent: res.sentUserContent } : t))
        : next;
      setTurns([
        ...settled,
        {
          role: "assistant",
          content: res.reply,
          toolCalls: res.toolCalls,
          proposals: res.proposals,
          usage: res.usage,
          model: res.model,
          readAttachments: res.attachments,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      // 실패한 질문·첨부는 입력창에 되돌려 준다
      setInput(q);
      setPendingFiles(files);
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (p: P) => {
    setBusy(true);
    setError(null);
    try {
      await adapter.apply(p);
      setApplied((prev) => new Set(prev).add(adapter.proposalKey(p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "적용에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ToolbarPortal order={10}>
        <Button
          variant="secondary"
          pill
          icon={MessageSquareText}
          onClick={() => setOpen((v) => !v)}
          aria-pressed={open}
          aria-label={open ? `${adapter.name} 닫기` : `${adapter.name} 열기`}
          title={adapter.name}
          className={cn(
            "max-sm:w-9 max-sm:px-0",
            open ? "border-transparent bg-nd-accent-soft text-nd-accent-strong" : "nd-glass border-0",
          )}
        >
          <span className="max-sm:hidden">{adapter.name}</span>
        </Button>
      </ToolbarPortal>

      {open && (
        <section
          aria-label={adapter.name}
          className={cn(
            "fixed z-nd-dock flex flex-col bg-nd-content",
            panelMode === "docked"
              ? fullScreen
                ? "inset-0"
                : "inset-y-0 right-0 border-l border-nd-line shadow-nd-pop"
              : "overflow-hidden rounded-nd-xl border border-nd-line shadow-nd-dialog",
          )}
          style={
            panelMode === "docked"
              ? fullScreen
                ? { width: "100vw" }
                : { width: dockWidth, maxWidth: "100vw" }
              : { left: floatBox.x, top: floatBox.y, width: floatBox.w, height: floatBox.h }
          }
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDragLeave={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragOver(false);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepth.current = 0;
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          {panelMode === "docked" && !fullScreen && (
            <div
              onPointerDown={startDockResize}
              title="드래그해서 너비 조절"
              className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none transition-colors duration-nd-fast hover:bg-nd-accent/40 active:bg-nd-accent/60"
            />
          )}

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-nd-accent bg-nd-accent-soft/85">
              <p className="text-nd-body font-medium text-nd-accent-strong">
                파일을 놓아 첨부 — PDF · Word(docx) · 엑셀 · 한글(hwpx)
              </p>
            </div>
          )}

          <header
            onPointerDown={panelMode === "floating" ? startFloatDrag : undefined}
            className={cn(
              "flex shrink-0 items-center justify-between gap-2 border-b border-nd-line px-4 py-3",
              panelMode === "floating" && "cursor-move touch-none select-none",
            )}
          >
            <div className="min-w-0">
              <p className="text-nd-section text-nd-fg">{adapter.name}</p>
              {presentation ? (
                // 발표 중 — 기간을 말하지 않은 질문이 어느 달 기준으로 답해지는지 늘 보이게
                <p
                  className="truncate text-nd-caption font-medium text-nd-accent-strong"
                  title="기간을 말하지 않으면 이 달 기준으로 답합니다. 「2025년」·「3월」처럼 기간을 말하면 그 기간으로 답합니다."
                >
                  발표 중 · {Number(presentation.month.slice(0, 4))}년 {Number(presentation.month.slice(5, 7))}월 기준
                  {presentation.chapter ? ` · ${presentation.chapter}` : ""}
                </p>
              ) : (
                <p className="truncate text-nd-caption text-nd-fg-3">{adapter.subtitle}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                icon={History}
                label="지난 대화"
                size="sm"
                active={listOpen}
                onClick={() => (listOpen ? setListOpen(false) : void openList())}
                disabled={busy}
                className={cn(listOpen && "bg-nd-fg/[.08] text-nd-fg")}
              />
              {turns.length > 0 && (
                <IconButton icon={Plus} label="새 대화" size="sm" onClick={startNew} disabled={busy} />
              )}
              {!narrow && (
                <IconButton
                  icon={panelMode === "docked" ? PictureInPicture2 : PanelRight}
                  label={panelMode === "docked" ? "팝업 창으로 띄우기" : "오른쪽에 고정"}
                  size="sm"
                  onClick={() => setPanelMode((m) => (m === "docked" ? "floating" : "docked"))}
                />
              )}
              <IconButton icon={X} label="닫기" size="sm" onClick={() => setOpen(false)} />
            </div>
          </header>

          {listOpen && (
            <div className="flex min-h-0 flex-1 flex-col border-b border-nd-line bg-nd-sunken">
              <div className="flex items-center justify-between px-4 py-2">
                <p className="text-nd-caption font-semibold text-nd-fg-2">지난 대화</p>
                <Button size="sm" icon={Plus} onClick={startNew}>
                  새 대화
                </Button>
              </div>
              <div className="nd-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {chats === null ? (
                  <LoadingState size="block" />
                ) : chats.length === 0 ? (
                  <p className="px-2 py-6 text-center text-nd-caption text-nd-fg-3">아직 나눈 대화가 없습니다.</p>
                ) : (
                  chats.map((c) => (
                    <div
                      key={c.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-nd-md px-2 py-1.5 transition-colors duration-nd-fast hover:bg-nd-content",
                        c.id === conversationId && "bg-nd-content shadow-nd-card",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void openChat(c.id)}
                        disabled={loadingChat}
                        className="min-w-0 flex-1 rounded-[6px] py-0.5 text-left disabled:opacity-50"
                      >
                        <p className="truncate text-nd-caption font-medium text-nd-fg" title={c.title}>
                          {c.title}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-nd-micro font-normal text-nd-fg-3">
                          <span className="nd-num">
                            {new Date(c.updatedAt).toLocaleString("ko-KR", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" · "}
                            {c.messageCount}개
                          </span>
                          {c.hasProposals && (
                            <Badge tone="warning" size="sm">
                              변경 제안
                            </Badge>
                          )}
                        </p>
                      </button>
                      <IconButton
                        icon={Trash2}
                        label="이 대화 지우기"
                        size="sm"
                        onClick={() => void removeChat(c.id)}
                        className="text-nd-fg-3 opacity-0 transition-opacity hover:text-nd-danger-text focus-visible:opacity-100 group-hover:opacity-100"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="nd-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="pt-4">
                <p className="text-nd-body text-nd-fg-2">{adapter.intro}</p>
                <div className="mt-3 space-y-1.5">
                  {adapter.examples.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => void send(e)}
                      className="block w-full rounded-nd-md border border-nd-line px-3 py-2 text-left text-nd-body text-nd-fg transition-colors duration-nd-fast hover:border-nd-accent/50 hover:bg-nd-accent-soft/50"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="flex flex-col items-end gap-1">
                  {t.attachmentNames && t.attachmentNames.length > 0 && (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                      {t.attachmentNames.map((n) => (
                        <span
                          key={n}
                          className="inline-flex max-w-full items-center gap-1 rounded-[6px] bg-nd-accent-soft px-2 py-0.5 text-nd-micro text-nd-accent-strong"
                          title={n}
                        >
                          <Icon icon={Paperclip} size={12} />
                          <span className="truncate">{n}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-[6px] bg-nd-accent px-3.5 py-2 text-nd-body text-white">
                    {t.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {t.readAttachments && t.readAttachments.length > 0 && (
                    <p className="flex items-start gap-1 text-nd-micro font-normal text-nd-fg-3">
                      <Icon icon={Paperclip} size={12} className="mt-0.5" />
                      <span>
                        {t.readAttachments
                          .map(
                            (a) =>
                              `${a.name} — ${a.chars.toLocaleString("ko-KR")}자 읽음${a.truncated ? " (길어서 일부만)" : ""}`,
                          )
                          .join(" · ")}
                      </span>
                    </p>
                  )}
                  {t.toolCalls && t.toolCalls.length > 0 && (
                    <details className="rounded-nd-md border border-nd-line bg-nd-sunken px-3 py-1.5">
                      <summary className="cursor-pointer text-nd-caption text-nd-fg-2">
                        조회 {t.toolCalls.length}회 — 어떻게 찾았는지 보기
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 text-nd-caption text-nd-fg-2">
                        {t.toolCalls.map((c, k) => (
                          <li key={k} className="break-all">
                            · {c.summary}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {t.content && (
                    <div className="max-w-full rounded-2xl rounded-bl-[6px] bg-nd-sunken px-3.5 py-2.5 text-nd-body text-nd-fg">
                      <Markdown text={t.content} />
                    </div>
                  )}

                  {(t.proposals ?? []).map((p) => {
                    const key = adapter.proposalKey(p);
                    return (
                      <div key={key}>
                        {adapter.renderProposal({
                          proposal: p,
                          applied: applied.has(key),
                          busy,
                          onApply: () => void apply(p),
                          onDismiss: () => setApplied((prev) => new Set(prev).add(key)),
                        })}
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between gap-2">
                    {t.usage && (
                      <p className="nd-num text-nd-micro font-normal text-nd-fg-3">
                        {t.model} · 입력 {t.usage.inputTokens.toLocaleString("ko-KR")}
                        {t.usage.cacheReadTokens > 0 && ` (캐시 ${t.usage.cacheReadTokens.toLocaleString("ko-KR")})`}
                        {" · 출력 "}
                        {t.usage.outputTokens.toLocaleString("ko-KR")}
                        {t.usage.costUsd !== undefined && ` · $${t.usage.costUsd.toFixed(4)}`}
                      </p>
                    )}
                    {t.content && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={FileDown}
                        onClick={() => {
                          const q = turns.slice(0, i).reverse().find((x) => x.role === "user")?.content ?? "";
                          if (!openChatReportPdf({ question: q, answer: t.content, model: t.model })) {
                            setError("팝업이 차단되어 보고서 창을 열지 못했습니다. 이 사이트의 팝업을 허용해주세요.");
                          }
                        }}
                        className="ml-auto shrink-0 text-nd-fg-3"
                      >
                        PDF 저장
                      </Button>
                    )}
                  </div>
                </div>
              ),
            )}

            {busy && <LoadingState size="inline" label={adapter.busyLabel} />}
            {error && <InlineNotice tone="danger">{error}</InlineNotice>}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 border-t border-nd-line p-3">
            <div className="mb-2 flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
              모델
              <button
                ref={modelBtnRef}
                type="button"
                onClick={() => setModelMenuOpen((v) => !v)}
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                className="inline-flex h-ctl-sm items-center gap-1 rounded-[8px] border border-nd-border bg-nd-content px-2 text-[13px] text-nd-fg transition-colors duration-nd-fast hover:border-nd-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {finAiModelLabel(model)}
                <Icon icon={ChevronUp} size={12} className="text-nd-fg-3" />
              </button>
              <Menu
                open={modelMenuOpen}
                onClose={() => setModelMenuOpen(false)}
                anchorRef={modelBtnRef}
                placement="top-start"
                ariaLabel="모델 선택"
                className="w-72"
                items={FIN_AI_MODELS.map((m) => ({
                  key: m.id,
                  label: m.label,
                  hint: m.note,
                  checked: m.id === model,
                  onSelect: () => requestModel(m.id),
                }))}
              />
            </div>
            {pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((f, k) => (
                  <span
                    key={`${f.name}-${f.size}`}
                    className="inline-flex h-7 max-w-full items-center gap-1 rounded-[8px] border border-nd-border bg-nd-sunken pl-2 pr-0.5 text-nd-micro font-normal text-nd-fg"
                  >
                    <Icon icon={Paperclip} size={12} className="text-nd-fg-3" />
                    <span className="truncate" title={f.name}>
                      {f.name}
                    </span>
                    <span className="nd-num shrink-0 text-nd-fg-3">
                      {(f.size / 1024).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}KB
                    </span>
                    <IconButton
                      icon={X}
                      label={`${f.name} 첨부 취소`}
                      size="sm"
                      onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== k))}
                      disabled={busy}
                      className="text-nd-fg-3 hover:text-nd-danger-text"
                    />
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <IconButton
                icon={Paperclip}
                label="파일 첨부 (PDF·Word·엑셀·한글)"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                title="파일 첨부 — 드래그해서 놓아도 됩니다"
                className="mb-0.5"
              />
              <textarea
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={adapter.inputPlaceholder}
                aria-label="질문"
                className="min-h-[52px] min-w-0 flex-1 resize-none rounded-nd-md border border-nd-border bg-nd-content px-3 py-2 text-nd-body text-nd-fg outline-none transition-colors duration-nd-fast placeholder:text-nd-fg-3 focus:border-nd-accent"
              />
              <Button
                icon={SendHorizontal}
                onClick={() => void send(input)}
                disabled={busy || (!input.trim() && pendingFiles.length === 0)}
                className="max-sm:w-9 max-sm:px-0"
                aria-label="보내기"
              >
                <span className="max-sm:hidden">보내기</span>
              </Button>
            </div>
          </div>

          {panelMode === "floating" && (
            <div
              onPointerDown={startFloatResize}
              title="드래그해서 크기 조절"
              className="absolute bottom-0 right-0 z-20 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end p-1 text-nd-fg-4 hover:text-nd-accent"
            >
              <svg viewBox="0 0 10 10" className="h-3 w-3" fill="currentColor" aria-hidden>
                <circle cx="8.5" cy="8.5" r="1.1" />
                <circle cx="8.5" cy="4.5" r="1.1" />
                <circle cx="4.5" cy="8.5" r="1.1" />
              </svg>
            </div>
          )}
        </section>
      )}

      {modelToConfirm && (
        <ModelConfirmDialog
          option={modelToConfirm}
          current={model}
          onCancel={() => setModelToConfirm(null)}
          onConfirm={() => {
            pickModel(modelToConfirm.id);
            setModelToConfirm(null);
          }}
        />
      )}
    </>
  );
}

// ============================================================
//  모델 바꾸기 확인 창 — 기본 포커스를 「취소」에 둔다
// ============================================================

function ModelConfirmDialog({
  option,
  current,
  onCancel,
  onConfirm,
}: {
  option: FinAiModelOption;
  current: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={`정말로 「${option.label}」 모델로 선택하시겠습니까?`}
      initialFocus={cancelRef}
      hideClose
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={onConfirm}>「{option.label}」 로 바꾸기</Button>
        </>
      }
    >
      {option.confirm && (
        <InlineNotice tone="warning" className="text-nd-caption">
          {option.confirm}
        </InlineNotice>
      )}
      <p className="mt-3 text-nd-caption leading-relaxed text-nd-fg-2">
        지금은 <b className="font-medium text-nd-fg">{finAiModelLabel(current)}</b> 를 쓰고 있습니다.
        바꾸면 다음 질문부터 이 모델로 물어보고, 이 브라우저에 기억됩니다.
      </p>
    </Dialog>
  );
}

// ============================================================
//  아주 작은 마크다운 렌더러 — 표와 굵게만 (재무 비서와 같은 부분집합)
// ============================================================

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isTableRow = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
  const cells = (l: string) => l.trim().slice(1, -1).split("|").map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="nd-scroll my-1.5 overflow-x-auto rounded-[8px] border border-nd-line bg-nd-content">
          <table className="w-full text-nd-caption">
            <thead>
              <tr className="border-b border-nd-line bg-nd-sunken text-nd-fg-2">
                {head.map((h, k) => (
                  <th key={k} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-nd-line">
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} className={cn("px-2 py-1", /^[\d,.\-△()₩원%]+$/.test(c) && "nd-num text-right")}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-2" />);
    } else {
      blocks.push(
        <p key={key++} className="whitespace-pre-wrap leading-relaxed">
          <Inline text={line} />
        </p>,
      );
    }
    i += 1;
  }
  return <>{blocks}</>;
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.startsWith("`") && p.endsWith("`")) {
          return (
            <code key={i} className="rounded-[4px] bg-nd-fg/[.08] px-1 text-[0.92em]">
              {p.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
