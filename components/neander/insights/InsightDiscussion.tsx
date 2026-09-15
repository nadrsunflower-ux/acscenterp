"use client";

// ============================================================
//  InsightDiscussion — 인사이트 초안 옆 「AI 와 고치기」 대화
// ------------------------------------------------------------
//  초안을 읽다가 모르는 문장을 짚고(「묻기」) 물어보면 AI 가 근거를 풀어
//  설명하고, 방향이 정해지면 수정안을 낸다. 수정안 카드의 「반영」은 편집
//  초안만 바꾼다 — 패널의 「저장」을 눌러야 문서에 남는다.
//
//  반영 여부는 따로 기억하지 않고 **지금 초안에서 읽는다** (proposalState).
//  대화를 다시 열었을 때 기억과 초안이 어긋나면 두 번 반영되기 쉽다.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { Badge, Button, IconButton, InlineNotice, LoadingState, cn, useConfirm } from "@/components/neander/ui";
import { Markdown } from "@/components/neander/assistant/AssistantChat";
import type { AgentMessage } from "@/lib/neander/ai/agent";
import { SECTION_LABEL, canApplyInsightEdit, itemLabel } from "@/lib/neander/insights/edit";
import type {
  InsightDiscussionMessage,
  InsightDraft,
  InsightEditProposal,
  InsightSection,
} from "@/lib/neander/insights/types";
import type { UseInsight } from "./useInsight";

export interface InsightFocus {
  section: InsightSection;
  itemId: string;
}

const QUOTE_MAX = 40;
/** 사용자 메시지 앞머리 — 서버 프롬프트가 이 꼴을 안다 (insights/server/discuss.ts) */
const FOCUS_RE = /^\((.+?) 「([^」]*)」 에 대해\)\n/;

type ProposalState = "pending" | "applied" | "stale" | "dismissed";

function proposalState(draft: InsightDraft, p: InsightEditProposal, dismissed: Set<string>): ProposalState {
  if (p.kind === "comment") {
    const now = draft.comments[p.chapter] ?? "";
    if (now === p.text) return "applied";
  } else if (p.op === "remove") {
    if (!draft[p.section].some((x) => x.id === p.targetId)) return "applied";
  } else if (p.item) {
    const it = p.item;
    const same = draft[p.section].some(
      (x) => (p.op === "add" || x.id === p.targetId) && x.text === it.text && (x.detail ?? "") === (it.detail ?? ""),
    );
    if (same) return "applied";
  }
  if (dismissed.has(p.id)) return "dismissed";
  return canApplyInsightEdit(draft, p) ? "pending" : "stale";
}

export function InsightDiscussion({
  draft,
  discussion,
  focus,
  onClearFocus,
  discuss,
  clearDiscussion,
  onApply,
  onClose,
  className,
}: {
  draft: InsightDraft;
  discussion: InsightDiscussionMessage[];
  focus: InsightFocus | null;
  onClearFocus: () => void;
  discuss: UseInsight["discuss"];
  clearDiscussion: UseInsight["clearDiscussion"];
  onApply: (p: InsightEditProposal) => void;
  onClose: () => void;
  className?: string;
}) {
  const confirm = useConfirm();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  const focusItem = focus ? draft[focus.section].find((x) => x.id === focus.itemId) : undefined;
  const focusLabel = focus && focusItem ? itemLabel(draft, focus.section, focus.itemId) : null;

  // 「묻기」로 문장을 짚으면 바로 쓸 수 있게
  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [discussion.length, pending]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const quote = focusItem ? focusItem.text.slice(0, QUOTE_MAX) + (focusItem.text.length > QUOTE_MAX ? "…" : "") : "";
    const content = focusLabel ? `(${focusLabel} 「${quote}」 에 대해)\n${q}` : q;
    setError(null);
    setInput("");
    setPending(content);
    try {
      const history: AgentMessage[] = [
        ...discussion.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];
      await discuss(history, draft);
      onClearFocus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      setInput(q);
    } finally {
      setPending(null);
    }
  };

  const onClear = async () => {
    const ok = await confirm({
      title: "대화를 비울까요?",
      message: "이 달 인사이트를 두고 나눈 대화가 모두 지워집니다. 초안 문장은 그대로입니다.",
      confirmLabel: "비우기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await clearDiscussion();
      setDismissed(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "대화를 비우지 못했습니다.");
    }
  };

  const examples = focusLabel
    ? ["이 문장의 숫자가 어디서 나왔는지 설명해줘", "이 문장이 맞는지 원 데이터로 확인해줘", "이 문장을 더 정확하게 고쳐줘"]
    : [
        "근거가 약하거나 과장된 문장이 있는지 짚어줘",
        "다음 달 할 일을 누가 무엇을 하는지 드러나게 고쳐줘",
        "확인이 필요한 것 중 겹치는 게 있으면 합쳐줘",
      ];

  return (
    <aside
      aria-label="AI 와 고치기"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-nd-lg border border-nd-line bg-nd-sunken", className)}
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-nd-line px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-nd-body font-semibold text-nd-fg">
            <Sparkles size={14} className="text-nd-accent" aria-hidden />
            AI 와 고치기
          </p>
          <p className="text-nd-micro text-nd-fg-3">문장의 「묻기」로 짚어 물어보세요 · 수정안은 반영 후 저장해야 남습니다</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {discussion.length > 0 && (
            <IconButton icon={Trash2} label="대화 비우기" size="sm" onClick={() => void onClear()} disabled={busy} />
          )}
          <IconButton icon={X} label="대화 닫기" size="sm" onClick={onClose} />
        </div>
      </header>

      <div className="nd-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {discussion.length === 0 && !pending && (
          <div className="space-y-1.5">
            <p className="text-nd-caption leading-relaxed text-nd-fg-2">
              AI 가 이 초안의 근거 신호를 읽고, 필요하면 원 데이터(장부·판매 줄)를 직접 조회해 설명합니다. 방향이
              정해지면 문장 수정안을 냅니다.
            </p>
            {examples.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => void send(e)}
                className="block w-full rounded-nd-md border border-nd-line bg-nd-content px-2.5 py-1.5 text-left text-nd-caption text-nd-fg transition-colors duration-nd-fast hover:border-nd-accent/50 hover:bg-nd-accent-soft/50"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {discussion.map((m, i) =>
          m.role === "user" ? (
            <UserBubble key={i} content={m.content} />
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
                  disabled={busy}
                  onApply={() => onApply(p)}
                  onDismiss={() => setDismissed((s) => new Set(s).add(p.id))}
                />
              ))}
              {(m.model || typeof m.costUsd === "number") && (
                <p className="nd-num text-nd-micro text-nd-fg-4">
                  {m.model}
                  {typeof m.costUsd === "number" ? ` · $${m.costUsd.toFixed(4)}` : ""}
                </p>
              )}
            </div>
          ),
        )}

        {pending && (
          <>
            <UserBubble content={pending} />
            <LoadingState size="inline" label="근거를 읽고 있습니다…" />
          </>
        )}
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-nd-line bg-nd-content p-2.5">
        {focus && focusItem && (
          <div className="mb-1.5 flex items-center gap-1 rounded-[8px] bg-nd-accent-soft py-0.5 pl-2 pr-0.5 text-nd-micro text-nd-accent-strong">
            <CornerDownRight size={12} className="shrink-0" aria-hidden />
            <span className="shrink-0 font-semibold">{focusLabel}</span>
            <span className="min-w-0 truncate" title={focusItem.text}>
              {focusItem.text}
            </span>
            <IconButton icon={X} label="짚은 문장 풀기" size="sm" onClick={onClearFocus} className="ml-auto h-6 w-6" />
          </div>
        )}
        <div className="flex items-end gap-2">
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
            placeholder={focusLabel ? `${focusLabel} 에 대해 묻기…` : "모르는 곳을 묻거나, 어떻게 고칠지 말해 주세요"}
            aria-label="AI 에게 묻기"
            className="min-h-[48px] min-w-0 flex-1 resize-none rounded-nd-md border border-nd-border bg-nd-content px-2.5 py-1.5 text-nd-caption text-nd-fg outline-none transition-colors duration-nd-fast placeholder:text-nd-fg-3 focus:border-nd-accent"
          />
          <IconButton
            icon={SendHorizontal}
            label="보내기"
            variant="primary"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
          />
        </div>
      </div>
    </aside>
  );
}

function UserBubble({ content }: { content: string }) {
  const m = FOCUS_RE.exec(content);
  const body = m ? content.slice(m[0].length) : content;
  return (
    <div className="flex flex-col items-end gap-1">
      {m && (
        <span className="inline-flex max-w-[90%] items-center gap-1 text-nd-micro text-nd-fg-3" title={m[2]}>
          <CornerDownRight size={11} className="shrink-0" aria-hidden />
          <span className="shrink-0 font-medium text-nd-fg-2">{m[1]}</span>
          <span className="truncate">{m[2]}</span>
        </span>
      )}
      <p className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-[6px] bg-nd-accent px-3 py-1.5 text-nd-caption text-white">
        {body}
      </p>
    </div>
  );
}

function ProposalCard({
  proposal: p,
  draft,
  state,
  disabled,
  onApply,
  onDismiss,
}: {
  proposal: InsightEditProposal;
  draft: InsightDraft;
  state: ProposalState;
  disabled: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  let title: string;
  let before: string | undefined;
  let after: { text: string; detail?: string; impact?: string } | undefined;
  if (p.kind === "comment") {
    title = `장별 한 줄 · ${p.chapter}`;
    before = p.before;
    after = p.text ? { text: p.text } : undefined;
  } else {
    const label = (p.targetId && itemLabel(draft, p.section, p.targetId)) || SECTION_LABEL[p.section];
    title = p.op === "add" ? `${SECTION_LABEL[p.section]} 추가` : p.op === "remove" ? `${label} 지우기` : `${label} 고치기`;
    before = p.before?.text;
    after = p.item;
  }

  return (
    <div
      className={cn(
        "rounded-nd-md border bg-nd-content p-2.5",
        state === "pending" ? "border-nd-accent/40" : "border-nd-line",
        (state === "dismissed" || state === "stale") && "opacity-60",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Badge size="sm" tone="accent">
          {title}
        </Badge>
        {state === "applied" && (
          <Badge size="sm" tone="success" dot>
            초안에 반영됨
          </Badge>
        )}
        {state === "stale" && (
          <Badge size="sm" tone="neutral">
            대상 문장이 없어짐
          </Badge>
        )}
        {state === "dismissed" && (
          <Badge size="sm" tone="neutral">
            넘김
          </Badge>
        )}
      </div>
      {before && (
        <p className={cn("text-nd-caption text-nd-fg-3", after || p.kind === "item" ? "line-through" : "")}>{before}</p>
      )}
      {after && (
        <div className="mt-1">
          <p className="text-nd-caption font-medium text-nd-fg">
            {after.text}
            {after.impact && (
              <Badge size="sm" tone="accent" className="ml-1.5 align-middle">
                {after.impact}
              </Badge>
            )}
          </p>
          {after.detail && <p className="mt-0.5 text-nd-micro leading-relaxed text-nd-fg-2">{after.detail}</p>}
        </div>
      )}
      <p className="mt-1.5 border-t border-nd-line pt-1.5 text-nd-micro leading-relaxed text-nd-fg-2">{p.reason}</p>
      {state === "pending" && (
        <div className="mt-2 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={disabled}>
            넘기기
          </Button>
          <Button size="sm" variant="primary" icon={Check} onClick={onApply} disabled={disabled}>
            초안에 반영
          </Button>
        </div>
      )}
    </div>
  );
}
