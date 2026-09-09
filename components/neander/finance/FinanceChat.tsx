"use client";

// ============================================================
//  재무 비서 채팅 패널
// ------------------------------------------------------------
//  재무 화면 어디서나 오른쪽에서 열린다. 장부를 물어보고, 고칠 것이 있으면
//  **제안**을 받는다.
//
//  ⚠️ 모델은 장부를 직접 바꾸지 못한다. 제안은 「바뀔 내용」을 전/후로 보여
//     주고, 사람이 「적용」을 눌러야 그때 저장된다 (server/ai-tools.ts 주석).
//     그래서 이 패널의 화면 대부분은 "무엇이 바뀌는지" 를 보여주는 데 쓴다.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/neander/ui";
import { useFinance } from "./FinanceProvider";
import { fetchChat, fetchChatList, deleteChat } from "@/lib/neander/finance/client";
import type { FinChatSummary } from "@/lib/neander/finance/chat-log";
import { Money } from "./ui";
import {
  applyFinEdits,
  sendFinanceChat,
  type ChangeProposal,
  type ChatMessage,
  type ChatResult,
} from "@/lib/neander/finance/client";
import {
  DEFAULT_FIN_AI_MODEL,
  FIN_AI_MODELS,
  finAiModelConfirm,
  finAiModelLabel,
  isFinAiModelId,
  type FinAiModelOption,
} from "@/lib/neander/finance/ai-models";
import { openChatReportPdf } from "@/lib/neander/finance/chat-pdf";
import {
  ATTACH_ACCEPT,
  ATTACH_EXTS,
  MAX_ATTACH_FILES,
  MAX_ATTACH_TOTAL_BYTES,
  fileExt,
} from "@/lib/neander/finance/attachment-limits";

/** 고른 모델은 이 브라우저에만 기억된다 */
const MODEL_STORAGE_KEY = "neander.finance.chatModel";
/** 패널 배치(도킹/팝업 · 크기 · 위치)도 기기별 취향이라 localStorage */
const LAYOUT_STORAGE_KEY = "neander.finance.chatLayout";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 도킹 패널 너비 한계 — 본문이 아예 안 보일 만큼은 못 넓힌다 */
const dockWidthBounds = () => [320, Math.max(320, Math.min(800, window.innerWidth - 160))] as const;

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** 첨부 텍스트까지 붙여 실제로 모델에 간 내용 — 다음 턴 히스토리는 이걸 쓴다 */
  wireContent?: string;
  /** 사용자 턴: 첨부한 파일 이름 (말풍선 위 칩) */
  attachmentNames?: string[];
  /** 비서 턴: 서버가 첨부에서 몇 글자를 읽었는지 */
  readAttachments?: ChatResult["attachments"];
  toolCalls?: ChatResult["toolCalls"];
  proposals?: ChangeProposal[];
  usage?: ChatResult["usage"];
  model?: string;
}

const EXAMPLES = [
  "7월에 구독비 얼마 썼어?",
  "검토필요로 남은 거래 보여줘",
  "쿠팡이츠 거래를 전부 일반식대로 바꿔줘",
  "지난달 대비 이번 달에 크게 늘어난 계정은?",
];

export function FinanceChat() {
  const { refresh } = useFinance();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [model, setModel] = useState(DEFAULT_FIN_AI_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  /** 확인을 기다리는 모델. 사람이 「바꾸기」를 눌러야 model 로 넘어간다 */
  const [modelToConfirm, setModelToConfirm] = useState<FinAiModelOption | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  /**
   * 대화 이어가기.
   *
   * id 는 서버가 만들어 응답에 실어 준다. 「새 대화」는 이 값을 비우는 것이
   * 전부다 — 다음 질문에서 서버가 새 문서를 만든다.
   */
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [listOpen, setListOpen] = useState(false);
  const [chats, setChats] = useState<FinChatSummary[] | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  // 배치: 도킹(본문을 밀어냄) ↔ 팝업(자유 이동·크기조절)
  const [panelMode, setPanelMode] = useState<"docked" | "floating">("docked");
  const [dockWidth, setDockWidth] = useState(448);
  const [floatBox, setFloatBox] = useState({ x: 80, y: 72, w: 420, h: 620 });
  const layoutLoaded = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** dragenter/leave 는 자식 요소마다 발화한다 — 깊이를 세서 겹침을 무시 */
  const dragDepth = useRef(0);

  /** 형식·개수·용량을 미리 거른다 (서버도 다시 검사한다) */
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
      if (next.some((p) => p.name === f.name && p.size === f.size)) continue; // 같은 파일 중복
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
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (isFinAiModelId(saved)) setModel(saved);
    } catch {
      // 저장이 막힌 브라우저면 기본 모델로 간다
    }
  }, []);

  /** 실제로 바꾸는 곳. 여기까지 온 선택은 확인을 받았거나 물을 필요가 없는 것이다 */
  const pickModel = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      // 못 남겨도 이번 세션 동안은 선택이 유지된다
    }
  };

  /**
   * 메뉴에서 하나를 눌렀을 때. 비싼 모델이면 바로 바꾸지 않고 확인 창을 띄운다.
   *
   * 메뉴는 먼저 닫는다 — 확인 창 뒤에 메뉴가 남아 있으면 어느 쪽을 눌러야
   * 하는지 헷갈리고, 바깥 클릭으로 메뉴를 닫으려다 확인 창까지 건드리게 된다.
   */
  const requestModel = (id: string) => {
    setModelMenuOpen(false);
    const reason = finAiModelConfirm(id, model);
    if (reason === undefined) {
      pickModel(id);
      return;
    }
    setModelToConfirm(FIN_AI_MODELS.find((m) => m.id === id) ?? null);
  };

  // 저장된 배치 불러오기 — 뷰포트 밖으로 나간 값은 안으로 끌어온다
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let saved: Partial<{
      mode: string;
      dockWidth: number;
      float: { x: number; y: number; w: number; h: number };
    }> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null");
    } catch {
      /* 파싱 실패 — 기본 배치로 간다 */
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
  }, []);

  // 배치가 바뀌면 저장 (불러오기 전에는 기본값으로 덮어쓰지 않게 막는다)
  useEffect(() => {
    if (!layoutLoaded.current) return;
    try {
      localStorage.setItem(
        LAYOUT_STORAGE_KEY,
        JSON.stringify({ mode: panelMode, dockWidth, float: floatBox }),
      );
    } catch {
      /* noop */
    }
  }, [panelMode, dockWidth, floatBox]);

  /** 포인터 드래그 한 사이클 — 이동 중 본문 글자가 끌려 선택되지 않게 막는다 */
  const trackPointer = (onMove: (ev: PointerEvent) => void) => {
    document.body.style.userSelect = "none";
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  /** 도킹 모드: 왼쪽 경계 드래그로 너비 조절 */
  const startDockResize = (e: React.PointerEvent) => {
    e.preventDefault();
    trackPointer((ev) => {
      const [minW, maxW] = dockWidthBounds();
      setDockWidth(clamp(window.innerWidth - ev.clientX, minW, maxW));
    });
  };

  /** 팝업 모드: 헤더를 잡고 창 이동 */
  const startFloatDrag = (e: React.PointerEvent) => {
    // 헤더 안의 버튼 클릭은 드래그가 아니다
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y } = floatBox;
    trackPointer((ev) => {
      setFloatBox((f) => ({
        ...f,
        // 헤더가 화면 밖으로 완전히 나가 못 잡게 되는 일은 막는다
        x: clamp(x + ev.clientX - sx, 120 - f.w, window.innerWidth - 120),
        y: clamp(y + ev.clientY - sy, 0, window.innerHeight - 56),
      }));
    });
  };

  /** 팝업 모드: 오른쪽 아래 모서리로 크기 조절 */
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

  // 메뉴 밖 클릭·Esc 로 닫기
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelMenuOpen]);

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

  /** 목록은 열 때마다 새로 받는다 — 다른 기기에서 나눈 대화도 보여야 한다 */
  const openList = useCallback(async () => {
    setListOpen(true);
    setChats(null);
    try {
      setChats(await fetchChatList());
    } catch (e) {
      setChats([]);
      setError(e instanceof Error ? e.message : "대화 목록을 불러오지 못했습니다.");
    }
  }, []);

  /**
   * 지난 대화를 펼친다. 저장된 것은 질문·답변·조회 근거·제안이라, 화면의
   * Turn 모양으로 되돌린다. 제안의 「적용」 상태는 남기지 않는다 — 이미
   * 적용됐는지는 장부를 봐야 알 수 있고, 여기서 짐작하면 두 번 적용된다.
   */
  const openChat = useCallback(async (id: string) => {
    setLoadingChat(true);
    setError(null);
    try {
      const chat = await fetchChat(id);
      // 저장 구조가 화면의 Turn 과 같은 발화 단위라 그대로 옮기면 된다.
      // 비용·모델은 남기지 않는다 — 지난 대화에 그 숫자가 떠 있으면 방금
      // 쓴 비용으로 오해한다.
      setTurns(
        chat.messages.map((m) => ({
          role: m.role,
          content: m.content,
          // args 가 없는 것은 이 필드를 저장하기 전의 옛 기록이다
          toolCalls: m.toolCalls?.map((t) => ({ ...t, args: t.args ?? {} })),
          proposals: m.proposals,
        })),
      );
      setConversationId(chat.id);
      setApplied(new Set());
      setListOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "대화를 불러오지 못했습니다.");
    } finally {
      setLoadingChat(false);
    }
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      if (!confirm("이 대화를 지울까요? 되돌릴 수 없습니다.")) return;
      try {
        await deleteChat(id);
        setChats((prev) => (prev ?? []).filter((c) => c.id !== id));
        if (conversationId === id) startNew();
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      }
    },
    [conversationId, startNew],
  );

  const send = async (text: string) => {
    const q = text.trim();
    const files = pendingFiles;
    if ((!q && files.length === 0) || busy) return;
    setError(null);
    setInput("");
    setPendingFiles([]);
    const next: Turn[] = [
      ...turns,
      {
        role: "user",
        // 파일만 던지고 질문을 안 쓴 경우의 기본 요청
        content: q || "첨부한 파일을 확인해줘.",
        attachmentNames: files.length > 0 ? files.map((f) => f.name) : undefined,
      },
    ];
    setTurns(next);
    setBusy(true);
    try {
      // 이전 턴에 첨부가 있었다면 wireContent(첨부 텍스트 포함)를 실어 보낸다
      const history: ChatMessage[] = next.map((t) => ({
        role: t.role,
        content: t.wireContent ?? t.content,
      }));
      const res = await sendFinanceChat(history, model, files, conversationId);
      // 서버가 만든/이어붙인 대화 id — 다음 턴부터 이어진다
      if (res.conversationId) setConversationId(res.conversationId);
      // 서버가 첨부를 붙여 보낸 실제 내용을 히스토리에 남긴다 — 다음 턴에도 맥락 유지
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
      // 실패한 질문·첨부는 입력창에 되돌려 준다 — 다시 만들게 하면 안 된다
      setInput(q);
      setPendingFiles(files);
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (p: ChangeProposal) => {
    setBusy(true);
    setError(null);
    try {
      await applyFinEdits({
        updates: p.ids.map((id) => ({
          id,
          patch: { ...p.patch, classReason: `재무 비서 제안 — ${p.reason}` },
        })),
        inserts: [],
        deletes: [],
      });
      setApplied((prev) => new Set(prev).add(p.id));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "적용에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 여는 버튼 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-700"
          aria-label="재무 비서 열기"
        >
          <span className="text-base">💬</span>
          재무 비서
        </button>
      )}

      {/* 도킹 모드: 본문을 밀어낼 자리 — 실제 패널은 fixed 로 화면 오른쪽 끝에
          겹쳐 그린다 (메인 영역 패딩과 무관하게 가장자리에 붙이기 위해) */}
      {open && panelMode === "docked" && (
        <div aria-hidden className="shrink-0" style={{ width: dockWidth }} />
      )}

      {/* 패널 */}
      {open && (
        <div
          className={
            panelMode === "docked"
              ? "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-zinc-200 bg-white shadow-xl"
              : "fixed z-40 flex flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl"
          }
          style={
            panelMode === "docked"
              ? { width: dockWidth, maxWidth: "100vw" }
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
          {/* 도킹: 왼쪽 경계를 드래그해 너비 조절 */}
          {panelMode === "docked" && (
            <div
              onPointerDown={startDockResize}
              title="드래그해서 너비 조절"
              className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-indigo-300 active:bg-indigo-400"
            />
          )}

          {/* 드래그 중 안내 오버레이 */}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-indigo-400 bg-indigo-50/85">
              <p className="text-sm font-medium text-indigo-700">
                파일을 놓아 첨부 — PDF · Word(docx) · 엑셀 · 한글(hwpx)
              </p>
            </div>
          )}
          <header
            onPointerDown={panelMode === "floating" ? startFloatDrag : undefined}
            className={`flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3 ${
              panelMode === "floating" ? "cursor-move touch-none select-none" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900">재무 비서</p>
              <p className="text-xs text-zinc-500">
                장부를 조회하고 고칠 것을 제안합니다 · 저장은 승인 후에만
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => (listOpen ? setListOpen(false) : void openList())}
                disabled={busy}
                title="지난 대화"
                aria-label="지난 대화"
                className={`rounded-md px-2 py-1 text-sm leading-none hover:bg-zinc-100 disabled:opacity-50 ${
                  listOpen ? "bg-zinc-100 text-zinc-800" : "text-zinc-400 hover:text-zinc-700"
                }`}
              >
                ☰
              </button>
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={startNew}
                  disabled={busy}
                  className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
                >
                  새 대화
                </button>
              )}
              <button
                type="button"
                onClick={() => setPanelMode((m) => (m === "docked" ? "floating" : "docked"))}
                title={panelMode === "docked" ? "팝업 창으로 띄우기" : "오른쪽에 고정"}
                aria-label={panelMode === "docked" ? "팝업 창으로 띄우기" : "오른쪽에 고정"}
                className="rounded-md px-2 py-1 text-sm leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                {panelMode === "docked" ? "⧉" : "⇥"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-lg leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          </header>

          {/* 지난 대화 — 패널 폭이 좁아 옆에 두지 않고 본문 위를 덮는다.
              고르면 닫히므로 대화 화면을 오래 가리지 않는다. */}
          {listOpen && (
            <div className="flex min-h-0 flex-1 flex-col border-b border-zinc-200 bg-zinc-50/60">
              <div className="flex items-center justify-between px-4 py-2">
                <p className="text-xs font-semibold text-zinc-600">지난 대화</p>
                <button
                  type="button"
                  onClick={startNew}
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  + 새 대화
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {chats === null ? (
                  <p className="px-2 py-6 text-center text-xs text-zinc-400">불러오는 중…</p>
                ) : chats.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-zinc-400">
                    아직 나눈 대화가 없습니다.
                  </p>
                ) : (
                  chats.map((c) => (
                    <div
                      key={c.id}
                      className={`group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white ${
                        c.id === conversationId ? "bg-white ring-1 ring-indigo-200" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void openChat(c.id)}
                        disabled={loadingChat}
                        className="min-w-0 flex-1 text-left disabled:opacity-50"
                      >
                        <p className="truncate text-xs font-medium text-zinc-800">{c.title}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          {new Date(c.updatedAt).toLocaleString("ko-KR", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" · "}
                          {c.messageCount}개
                          {/* 제안이 오간 대화는 나중에 되짚을 일이 많다 */}
                          {c.hasProposals && (
                            <span className="ml-1 text-amber-600">· 변경 제안</span>
                          )}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeChat(c.id)}
                        title="이 대화 지우기"
                        aria-label="이 대화 지우기"
                        className="shrink-0 rounded px-1.5 py-1 text-xs text-zinc-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="pt-6">
                <p className="text-sm text-zinc-500">
                  장부에 대해 물어보세요. 계정을 고쳐야 할 것 같으면 제안해 드립니다 —
                  <b className="text-zinc-700"> 승인 전에는 아무것도 저장되지 않습니다.</b>
                </p>
                <div className="mt-3 space-y-1.5">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => void send(e)}
                      className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50/50"
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
                          className="max-w-full truncate rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-800"
                        >
                          📎 {n}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
                    {t.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {t.readAttachments && t.readAttachments.length > 0 && (
                    <p className="text-[11px] text-zinc-400">
                      {t.readAttachments
                        .map(
                          (a) =>
                            `📎 ${a.name} — ${a.chars.toLocaleString("ko-KR")}자 읽음${a.truncated ? " (길어서 일부만)" : ""}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                  {t.toolCalls && t.toolCalls.length > 0 && (
                    <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5">
                      <summary className="cursor-pointer text-xs text-zinc-500">
                        조회 {t.toolCalls.length}회 — 어떻게 찾았는지 보기
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-500">
                        {t.toolCalls.map((c, k) => (
                          <li key={k} className="break-all">· {c.summary}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {t.content && (
                    <div className="max-w-full rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 py-2.5 text-sm text-zinc-800">
                      <Markdown text={t.content} />
                    </div>
                  )}

                  {(t.proposals ?? []).map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      applied={applied.has(p.id)}
                      busy={busy}
                      onApply={() => void apply(p)}
                      onDismiss={() => setApplied((prev) => new Set(prev).add(p.id))}
                    />
                  ))}

                  <div className="flex items-center justify-between gap-2">
                    {t.usage && (
                      <p className="text-[11px] text-zinc-400">
                        {t.model} · 입력 {t.usage.inputTokens.toLocaleString("ko-KR")}
                        {t.usage.cacheReadTokens > 0 &&
                          ` (캐시 ${t.usage.cacheReadTokens.toLocaleString("ko-KR")})`}
                        {" · 출력 "}
                        {t.usage.outputTokens.toLocaleString("ko-KR")}
                        {t.usage.costUsd !== undefined && ` · $${t.usage.costUsd.toFixed(4)}`}
                      </p>
                    )}
                    {t.content && (
                      <button
                        type="button"
                        onClick={() => {
                          // 이 답변을 만든 질문 = 앞쪽에서 가장 가까운 사용자 발화
                          const q =
                            turns.slice(0, i).reverse().find((x) => x.role === "user")?.content ?? "";
                          if (!openChatReportPdf({ question: q, answer: t.content, model: t.model })) {
                            setError("팝업이 차단되어 보고서 창을 열지 못했습니다. 이 사이트의 팝업을 허용해주세요.");
                          }
                        }}
                        className="shrink-0 text-[11px] text-zinc-400 underline decoration-zinc-300 underline-offset-2 hover:text-indigo-600"
                      >
                        PDF 저장
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}

            {busy && (
              <p className="text-sm text-zinc-400">
                <span className="inline-block animate-pulse">장부를 보고 있습니다…</span>
              </p>
            )}
            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 border-t border-zinc-200 p-3">
            {/* 네이티브 select 는 열리는 방향을 못 정한다 — 위로 열리게 직접 그린다 */}
            <div ref={modelMenuRef} className="relative mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
              모델
              <button
                type="button"
                onClick={() => setModelMenuOpen((v) => !v)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:border-indigo-400 disabled:opacity-50"
              >
                {finAiModelLabel(model)}
                <span className="text-[9px] text-zinc-400">▲</span>
              </button>
              {modelMenuOpen && (
                <ul className="absolute bottom-full left-0 z-10 mb-1.5 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                  {FIN_AI_MODELS.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => requestModel(m.id)}
                        className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-indigo-50 ${
                          m.id === model ? "bg-indigo-50/60 font-medium text-indigo-700" : "text-zinc-700"
                        }`}
                      >
                        {m.label}
                        <span className="shrink-0 text-[11px] font-normal text-zinc-400">{m.note}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* 보내기 전 첨부 목록 */}
            {pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((f, k) => (
                  <span
                    key={`${f.name}-${f.size}`}
                    className="flex max-w-full items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700 ring-1 ring-zinc-200"
                  >
                    <span className="truncate">📎 {f.name}</span>
                    <span className="shrink-0 text-zinc-400">
                      {(f.size / 1024).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}KB
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== k))}
                      disabled={busy}
                      className="shrink-0 text-zinc-400 hover:text-rose-600 disabled:opacity-50"
                      aria-label={`${f.name} 첨부 취소`}
                    >
                      ✕
                    </button>
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
                  e.target.value = ""; // 같은 파일을 다시 골라도 change 가 뜨게
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                aria-label="파일 첨부 (PDF·Word·엑셀·한글)"
                title="파일 첨부 — 드래그해서 놓아도 됩니다"
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-lg text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50"
              >
                +
              </button>
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
                placeholder="장부에 대해 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)"
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <Button
                onClick={() => void send(input)}
                disabled={busy || (!input.trim() && pendingFiles.length === 0)}
              >
                보내기
              </Button>
            </div>
          </div>

          {/* 팝업: 오른쪽 아래 모서리를 드래그해 크기 조절 */}
          {panelMode === "floating" && (
            <div
              onPointerDown={startFloatResize}
              title="드래그해서 크기 조절"
              className="absolute bottom-0 right-0 z-20 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end p-1 text-zinc-300 hover:text-indigo-500"
            >
              <svg viewBox="0 0 10 10" className="h-3 w-3" fill="currentColor" aria-hidden>
                <circle cx="8.5" cy="8.5" r="1.1" />
                <circle cx="8.5" cy="4.5" r="1.1" />
                <circle cx="4.5" cy="8.5" r="1.1" />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* 비싼 모델은 고르는 순간 한 번 물어본다 */}
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
//  모델 바꾸기 확인 창
// ------------------------------------------------------------
//  기본 포커스를 「취소」에 둔다. 메뉴를 키보드로 훑다가 Enter 를 치는 손이
//  그대로 비싼 모델로 넘어가면 확인 창을 둔 뜻이 없어진다 — 바꾸려면 그
//  버튼을 눈으로 찾아 눌러야 한다.
//
//  패널이 z-40 이라 이 창은 z-50 이다. 다른 재무 화면의 모달과 같은 층이다.
// ============================================================

function ModelConfirmDialog({
  option,
  current,
  onCancel,
  onConfirm,
}: {
  option: FinAiModelOption;
  /** 지금 쓰고 있는 모델 — 무엇에서 무엇으로 가는지 보여준다 */
  current: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fin-model-confirm-title"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="fin-model-confirm-title" className="text-base font-bold leading-relaxed text-zinc-900">
          정말로 「{option.label}」 모델로 선택하시겠습니까?
        </h2>

        {option.confirm && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {option.confirm}
          </p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          지금은 <b className="font-medium text-zinc-700">{finAiModelLabel(current)}</b> 를 쓰고 있습니다.
          바꾸면 다음 질문부터 이 모델로 물어보고, 이 브라우저에 기억됩니다.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            「{option.label}」 로 바꾸기
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  변경 제안 카드 — 무엇이 바뀌는지 전/후로 보여준다
// ============================================================

const FIELD_LABEL: Record<string, string> = {
  acctMajor: "계정대분류",
  acctMid: "계정중분류",
  acctMinor: "계정소분류",
  bizMajor: "사업대분류",
  bizMinor: "사업소분류",
  txType: "거래유형",
  status: "상태",
  site: "사업장",
  note: "비고",
  vendor: "거래처",
};

function ProposalCard({
  proposal,
  applied,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: ChangeProposal;
  applied: boolean;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? proposal.before : proposal.before.slice(0, 5);
  const total = proposal.before.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900">
          변경 제안 · {proposal.ids.length}건
          <span className="ml-2 text-xs font-normal text-zinc-500">
            합계 <Money value={total} unit={false} />원
          </span>
        </p>
        {applied ? (
          <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
            처리됨
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-200 disabled:opacity-50"
            >
              무시
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              적용
            </button>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-zinc-600">{proposal.reason}</p>

      {/* 바뀔 값 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(proposal.patch).map(([k, v]) => (
          <span key={k} className="rounded bg-white px-2 py-0.5 text-xs ring-1 ring-amber-200">
            <span className="text-zinc-500">{FIELD_LABEL[k] ?? k}</span>{" "}
            <b className="text-zinc-900">{String(v)}</b>
          </span>
        ))}
      </div>

      {/* 대상 거래 */}
      <div className="mt-2 overflow-x-auto rounded-lg border border-amber-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-amber-100 text-zinc-500">
              <th className="px-2 py-1 text-left font-medium">거래일</th>
              <th className="px-2 py-1 text-left font-medium">거래처</th>
              <th className="px-2 py-1 text-left font-medium">지금 계정</th>
              <th className="px-2 py-1 text-right font-medium">금액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-50">
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums text-zinc-600">{b.date}</td>
                <td className="max-w-[120px] truncate px-2 py-1 text-zinc-900">{b.vendor ?? "—"}</td>
                <td className="max-w-[140px] truncate px-2 py-1 text-zinc-500">{b.acct}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                  {b.amount.toLocaleString("ko-KR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {proposal.before.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full border-t border-amber-100 px-2 py-1 text-xs text-amber-800 hover:bg-amber-50"
          >
            {expanded ? "접기" : `나머지 ${proposal.before.length - 5}건 보기`}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  아주 작은 마크다운 렌더러 — 표와 굵게만
// ------------------------------------------------------------
//  모델에게 표를 쓰라고 했으니 표는 표로 보여야 한다. 라이브러리를 하나
//  더 얹을 만큼은 아니라서 필요한 것만 처리한다.
// ============================================================

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isTableRow = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
  const cells = (l: string) =>
    l.trim().slice(1, -1).split("|").map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    // 표: 헤더 + 구분선 + 본문
    if (isTableRow(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="my-1.5 overflow-x-auto rounded border border-zinc-300 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                {head.map((h, k) => (
                  <th key={k} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td
                      key={j}
                      className={`px-2 py-1 ${/^[\d,.\-△()₩원%]+$/.test(c) ? "text-right tabular-nums" : ""}`}
                    >
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
    // 그 외는 한 줄씩
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

/** **굵게** 와 `코드` 만 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <b key={i}>{p.slice(2, -2)}</b>;
        }
        if (p.startsWith("`") && p.endsWith("`")) {
          return (
            <code key={i} className="rounded bg-zinc-200/70 px-1 text-[0.92em]">
              {p.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
