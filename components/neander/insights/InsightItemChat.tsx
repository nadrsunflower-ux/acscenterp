"use client";

// ============================================================
//  InsightItemChat — 문장 하나에 붙는 「묻기」 팝오버 대화
// ------------------------------------------------------------
//  보기 화면에서 문장의 「묻기」를 누르면 그 문장 **아래(자리가 없으면 위)** 에
//  말풍선으로 열린다 — 문장을 가리지 않아야 읽으면서 피드백을 쓸 수 있다.
//  앵커가 문장 블록 전체라서 위치 훅이 뒤집어도 문장과 겹치지 않는다.
//
//  고치기 화면의 옆 대화(InsightDiscussion)와 다른 점:
//    · 이 문장을 두고 나눈 말만 보이고, 모델에도 그것만 보낸다 (message.focus)
//    · 편집 초안이 없으므로 수정안의 「반영하고 저장」이 곧바로 저장한다 —
//      패널이 되돌리기 알림을 띄운다
// ============================================================

import { useEffect, useRef, useState, type RefObject } from "react";
import { SendHorizontal, Sparkles, X } from "lucide-react";
import { IconButton, InlineNotice, LoadingState, Popover } from "@/components/neander/ui";
import { Markdown } from "@/components/neander/assistant/AssistantChat";
import type { AgentMessage } from "@/lib/neander/ai/agent";
import { itemLabel } from "@/lib/neander/insights/edit";
import type {
  InsightDiscussionMessage,
  InsightDraft,
  InsightEditProposal,
  InsightItem,
  InsightSection,
} from "@/lib/neander/insights/types";
import { ProposalCard, UserBubble, focusPrefix, proposalState } from "./InsightDiscussion";
import type { UseInsight } from "./useInsight";

const EXAMPLES: Record<InsightSection, string[]> = {
  summary: ["이 숫자가 어디서 나왔는지 설명해줘", "원 데이터로 맞는지 확인해줘", "더 짧고 분명하게 고쳐줘"],
  actions: ["왜 이 일을 해야 하는지 설명해줘", "누가 무엇을 언제까지 하는지 드러나게 고쳐줘", "예상 영향이 맞는지 확인해줘"],
  risks: ["무엇을 확인하라는 건지 설명해줘", "원 데이터로 실제 문제인지 확인해줘", "필요 없으면 지우자고 제안해줘"],
};

export function InsightItemChat({
  anchorRef,
  open,
  onClose,
  section,
  item,
  draft,
  discussion,
  discuss,
  saving,
  onApply,
  overDialog = false,
}: {
  /** 발표 화면의 인사이트 관리 창 안 — 팝오버를 창 위 층으로 올린다 */
  overDialog?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  section: InsightSection;
  item: InsightItem;
  /** 저장된 문장 — 보기 화면에는 편집 초안이 없다 */
  draft: InsightDraft;
  discussion: InsightDiscussionMessage[];
  discuss: UseInsight["discuss"];
  saving: boolean;
  /** 수정안을 저장까지 한다 — 성공하면 true */
  onApply: (p: InsightEditProposal) => Promise<boolean>;
}) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = pending !== null;
  const label = itemLabel(draft, section, item.id) ?? "이 문장";

  const thread = discussion.filter((m) => m.focus?.section === section && m.focus.itemId === item.id);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.length, pending]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const content = focusPrefix(label, item.text) + q;
    setError(null);
    setInput("");
    setPending(content);
    try {
      // 이 문장을 두고 나눈 말만 — 다른 문장 이야기가 섞이면 답이 흐려지고 비싸진다
      const history: AgentMessage[] = [
        ...thread.slice(-12).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];
      await discuss(history, draft, { section, itemId: item.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      setInput(q);
    } finally {
      setPending(null);
    }
  };

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-start"
      arrow
      unpadded
      overDialog={overDialog}
      autoFocus={false}
      ariaLabel={`${label} 피드백`}
      className="flex w-[min(460px,calc(100vw-2rem))] flex-col"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-nd-line px-3 py-2">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-nd-caption font-semibold text-nd-fg">
            <Sparkles size={13} className="text-nd-accent" aria-hidden />
            {label} 에 피드백
          </p>
          <p className="text-nd-micro text-nd-fg-3">묻거나 고칠 방향을 적으면 AI 가 설명하고 수정안을 냅니다</p>
        </div>
        <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />
      </header>

      <div className="nd-scroll max-h-[340px] min-h-0 space-y-2.5 overflow-y-auto px-3 py-2.5">
        {thread.length === 0 && !pending && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES[section].map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => void send(e)}
                className="rounded-full border border-nd-line bg-nd-content px-2.5 py-1 text-nd-micro text-nd-fg-2 transition-colors duration-nd-fast hover:border-nd-accent/50 hover:bg-nd-accent-soft/50 hover:text-nd-fg"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {thread.map((m, i) =>
          m.role === "user" ? (
            <UserBubble key={i} content={m.content} hideFocus />
          ) : (
            <div key={i} className="space-y-2">
              {m.toolCalls && m.toolCalls.length > 0 && (
                <details className="rounded-nd-md border border-nd-line bg-nd-content px-2.5 py-1">
                  <summary className="cursor-pointer text-nd-micro text-nd-fg-2">
                    조회 {m.toolCalls.length}회 — 어떻게 찾았는지 보기
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-nd-micro text-nd-fg-2">
                    {m.toolCalls.map((c, k) => (
                      <li key={k} className="break-all">
                        · {c.summary}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {m.content && (
                <div className="rounded-2xl rounded-bl-[6px] bg-nd-content px-3 py-2 text-nd-caption text-nd-fg">
                  <Markdown text={m.content} />
                </div>
              )}
              {(m.proposals ?? []).map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  draft={draft}
                  state={proposalState(draft, p, dismissed)}
                  disabled={busy || saving}
                  applyLabel="반영하고 저장"
                  appliedLabel="반영됨"
                  onApply={() => void onApply(p)}
                  onDismiss={() => setDismissed((s) => new Set(s).add(p.id))}
                />
              ))}
            </div>
          ),
        )}

        {pending && (
          <>
            <UserBubble content={pending} hideFocus />
            <LoadingState size="inline" label="근거를 읽고 있습니다…" />
          </>
        )}
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <div ref={endRef} />
      </div>

      <div className="flex shrink-0 items-end gap-2 border-t border-nd-line p-2">
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="예: 248만원은 자산 취득이라 비용 급증으로 보면 안 돼"
          aria-label={`${label} 피드백`}
          className="min-h-[44px] min-w-0 flex-1 resize-none rounded-nd-md border border-nd-border bg-nd-content px-2.5 py-1.5 text-nd-caption text-nd-fg outline-none transition-colors duration-nd-fast placeholder:text-nd-fg-3 focus:border-nd-accent"
        />
        <IconButton
          icon={SendHorizontal}
          label="보내기"
          variant="primary"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
        />
      </div>
    </Popover>
  );
}
