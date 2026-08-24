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

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/neander/ui";
import { useFinance } from "./FinanceProvider";
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
  isFinAiModelId,
} from "@/lib/neander/finance/ai-models";

/** 고른 모델은 이 브라우저에만 기억된다 */
const MODEL_STORAGE_KEY = "neander.finance.chatModel";

interface Turn {
  role: "user" | "assistant";
  content: string;
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
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (isFinAiModelId(saved)) setModel(saved);
    } catch {
      // 저장이 막힌 브라우저면 기본 모델로 간다
    }
  }, []);

  const pickModel = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      // 못 남겨도 이번 세션 동안은 선택이 유지된다
    }
  };

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, open, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setBusy(true);
    try {
      const history: ChatMessage[] = next.map((t) => ({ role: t.role, content: t.content }));
      const res = await sendFinanceChat(history, model);
      setTurns([
        ...next,
        {
          role: "assistant",
          content: res.reply,
          toolCalls: res.toolCalls,
          proposals: res.proposals,
          usage: res.usage,
          model: res.model,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      // 실패한 질문은 입력창에 되돌려 준다 — 다시 타이핑하게 만들면 안 된다
      setInput(q);
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

      {/* 패널 */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl">
          <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900">재무 비서</p>
              <p className="text-xs text-zinc-500">
                장부를 조회하고 고칠 것을 제안합니다 · 저장은 승인 후에만
              </p>
            </div>
            <div className="flex items-center gap-1">
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setTurns([]); setError(null); }}
                  disabled={busy}
                  className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
                >
                  새 대화
                </button>
              )}
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
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
                    {t.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
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
            <label className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
              모델
              <select
                value={model}
                onChange={(e) => pickModel(e.target.value)}
                disabled={busy}
                className="max-w-[280px] rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs text-zinc-700 outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                {FIN_AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.note}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
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
              <Button onClick={() => void send(input)} disabled={busy || !input.trim()}>
                보내기
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
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
