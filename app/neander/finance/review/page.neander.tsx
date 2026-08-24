"use client";

// ============================================================
//  검토 대기함 — 자동분류가 확신하지 못한 건을 사람이 승인
// ------------------------------------------------------------
//  수백 건을 처리해야 하므로 **키보드만으로** 넘길 수 있어야 한다.
//    ↑/↓ 또는 J/K  이동
//    Enter          현재 건 확정
//    E              상세 열기 (분류를 고쳐야 할 때)
//
//  각 행에는 "왜 이렇게 제안했는지"(classReason)를 함께 보여준다.
//  근거 없이 승인 버튼만 있으면 사람은 그냥 다 눌러버린다.
//
//  ── AI 추천 ──
//  규칙(classify.ts)은 거래처가 **정확히** 일치할 때만 맞힌다. 새 거래처가
//  오면 손을 든다. 「AI 추천」은 그 남은 건들을 모델에게 물어본다 —
//  `FACEBK *KEV69QZM62` 와 `FACEBK *FXEVTN5N62` 가 같은 메타 광고라는 걸
//  알아보는 종류의 판단이다.
//
//  ⚠️ AI 결과는 **자동 저장되지 않는다.** 화면에 추천으로 얹히고, 사람이
//     「적용」을 눌러야 저장된다. 확신도가 낮은 건은 눌러도 확정이 아니라
//     제안됨으로 들어간다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, Badge, EmptyState, Select } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import { AccountPicker, type AccountValue } from "@/components/neander/finance/AccountPicker";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import {
  updateFinTransaction,
  deleteFinTransaction,
  bulkUpdateFinStatus,
  bulkPatchFinTransactions,
  applyFinEdits,
  requestAiSuggestions,
  type AiSuggestResult,
} from "@/lib/neander/finance/client";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  netAmount,
  type ClassificationStatus,
  type FinTransaction,
} from "@/lib/neander/finance/types";

const ALL = "__all__";

export default function ReviewPage() {
  const { transactions, accounts, paymentMethods, loading, refresh } = useFinance();

  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<FinTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  // 여러 건을 골라 같은 계정으로 한 번에 고친다. 같은 문제를 가진 거래가
  // 수십 건씩 몰려 있어서, 하나씩 누르게 하면 아무도 끝까지 안 한다.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAcct, setBulkAcct] = useState<AccountValue>({});
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  // ---- AI 추천 ----
  const [ai, setAi] = useState<AiSuggestResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  /** 추천을 이미 적용한 거래 (다시 적용하지 않게) */
  const [aiApplied, setAiApplied] = useState<Set<string>>(new Set());
  const aiById = useMemo(
    () => new Map((ai?.suggestions ?? []).map((s) => [s.id, s])),
    [ai],
  );

  const pending = useMemo(
    () =>
      transactions
        .filter((t) => t.status === "suggested" || t.status === "needs_review")
        .filter((t) => statusFilter === ALL || t.status === statusFilter)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, statusFilter],
  );

  const bizMinors = useMemo(
    () =>
      [...new Set(transactions.map((t) => t.bizMinor).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "ko"),
      ),
    [transactions],
  );

  /**
   * 물어볼 대상: 계정이 아직 없거나 「검토필요」인 건. 최대 40건.
   * 「제안됨」이면서 계정이 있는 건은 규칙이 이미 근거를 댄 것이라 뺀다 —
   * 모델을 부를 값이 없고 비용만 든다.
   */
  const aiTargets = useMemo(
    () =>
      pending
        .filter((t) => (!t.acctMinor || t.status === "needs_review") && !aiApplied.has(t.id))
        .slice(0, 40),
    [pending, aiApplied],
  );

  const askAi = async () => {
    if (aiTargets.length === 0) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await requestAiSuggestions(aiTargets.map((t) => t.id));
      setAi(res);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 추천에 실패했습니다.");
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * 추천을 저장한다. 확신도 0.7 이상이면 제안됨, 그 아래는 검토필요로 둔다 —
   * AI 가 확정을 만들지는 않는다.
   */
  const applyAi = async (ids: string[]) => {
    const picks = ids
      .map((id) => aiById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (picks.length === 0) return;
    setBusy(true);
    try {
      await applyFinEdits({
        updates: picks.map((s) => ({
          id: s.id,
          patch: {
            acctMajor: s.acctMajor,
            acctMid: s.acctMid,
            acctMinor: s.acctMinor,
            bizMajor: s.bizMajor,
            bizMinor: s.bizMinor,
            status: s.confidence >= 0.7 ? "suggested" : "needs_review",
            classReason: `AI 추천(확신 ${Math.round(s.confidence * 100)}%) — ${s.reason}`,
          },
        })),
        inserts: [],
        deletes: [],
      });
      setAiApplied((prev) => new Set([...prev, ...picks.map((s) => s.id)]));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // 목록이 줄어들면 커서가 범위를 벗어난다
  useEffect(() => {
    if (cursor >= pending.length) setCursor(Math.max(0, pending.length - 1));
  }, [pending.length, cursor]);

  const approve = useCallback(
    async (t: FinTransaction) => {
      if (!t) return;
      await updateFinTransaction(t.id, { status: "confirmed" });
      // 실시간 구독이 아니므로 직접 다시 불러와야 목록에서 빠진다
      await refresh();
    },
    [refresh],
  );

  // 키보드 조작
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (pending.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setCursor((c) => Math.min(pending.length - 1, c + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const t = pending[cursor];
        if (t) approve(t);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setEditing(pending[cursor] ?? null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, cursor, editing, approve]);

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRows = pending.filter((t) => selected.has(t.id));
  // 거래유형이 섞이면 계정 후보가 달라져 하나로 못 고른다
  const selectedTypes = [...new Set(selectedRows.map((t) => t.txType))];
  const bulkTxType = selectedTypes.length === 1 ? selectedTypes[0] : null;

  const applyBulk = async () => {
    if (!bulkAcct.acctMinor || selectedRows.length === 0) return;
    setBusy(true);
    try {
      await bulkPatchFinTransactions(
        selectedRows.map((t) => t.id),
        {
          ...bulkAcct,
          status: "confirmed",
          classReason: `검토 대기함에서 ${selectedRows.length}건 일괄 지정`,
        },
      );
      setSelected(new Set());
      setBulkAcct({});
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const approveAllSuggested = async () => {
    const ids = pending.filter((t) => t.status === "suggested").map((t) => t.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await bulkUpdateFinStatus(ids, "confirmed");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="px-5 py-16 text-center text-zinc-400">불러오는 중…</div>;
  }

  const suggestedCount = transactions.filter((t) => t.status === "suggested").length;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <PageHeader
        title="검토 대기함"
        description="자동분류가 확신하지 못한 거래입니다. 근거를 보고 승인하거나 고치세요."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              className="w-auto"
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value={ALL}>전체</option>
              {(["suggested", "needs_review"] as ClassificationStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
            {aiTargets.length > 0 && (
              <Button variant="secondary" onClick={askAi} disabled={aiBusy || busy}>
                {aiBusy ? "AI 가 보고 있습니다…" : `AI 추천 (${aiTargets.length}건)`}
              </Button>
            )}
            {suggestedCount > 0 && (
              <Button variant="secondary" onClick={approveAllSuggested} disabled={busy}>
                제안됨 {suggestedCount}건 일괄 확정
              </Button>
            )}
          </div>
        }
      />

      {aiError && (
        <Card className="mb-4 border-rose-200 bg-rose-50/60">
          <p className="font-semibold text-rose-900">AI 추천을 받지 못했습니다</p>
          <p className="mt-1 text-sm leading-relaxed text-rose-800">{aiError}</p>
        </Card>
      )}

      {ai && (
        <Card className="mb-4 border-violet-200 bg-violet-50/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900">
                AI 추천 {ai.suggestions.length}건
                <span className="ml-2 text-xs font-normal text-zinc-500">{ai.model}</span>
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                아래 각 거래에 추천이 붙었습니다. <b>저장되지 않았습니다</b> — 확인 후 적용하세요.
                확신도 70% 미만은 적용해도 「검토필요」로 남습니다.
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                토큰 입력 {ai.usage.inputTokens.toLocaleString("ko-KR")}
                {ai.usage.cacheReadTokens > 0 &&
                  ` (캐시 재사용 ${ai.usage.cacheReadTokens.toLocaleString("ko-KR")})`}
                {" · 출력 "}
                {ai.usage.outputTokens.toLocaleString("ko-KR")}
                {ai.usage.costUsd !== undefined && ` · 비용 $${ai.usage.costUsd.toFixed(4)}`}
              </p>
              {ai.rejected.length > 0 && (
                <p className="mt-1.5 text-xs text-amber-800">
                  계정 마스터에 없는 계정을 제안한 {ai.rejected.length}건은 버렸습니다
                  ({ai.rejected.slice(0, 2).map((r) => r.proposed).join(", ")}
                  {ai.rejected.length > 2 && " …"}).
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setAi(null)} disabled={busy}>
                추천 지우기
              </Button>
              <Button
                onClick={() =>
                  applyAi(
                    ai.suggestions.filter((x) => x.confidence >= 0.7 && !aiApplied.has(x.id)).map((x) => x.id),
                  )
                }
                disabled={busy || ai.suggestions.every((x) => x.confidence < 0.7 || aiApplied.has(x.id))}
              >
                확신 70%↑ 일괄 적용
              </Button>
            </div>
          </div>
        </Card>
      )}

      {pending.length === 0 ? (
        <EmptyState
          icon="✅"
          title="검토할 거래가 없습니다"
          description="모든 거래가 확정 상태입니다."
        />
      ) : (
        <>
          <Card className="mb-4 py-3">
            <p className="text-sm text-zinc-600">
              <b className="text-zinc-900">{pending.length.toLocaleString("ko-KR")}건</b> 대기 ·
              키보드로 처리할 수 있습니다 —{" "}
              <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-xs">↑</kbd>{" "}
              <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-xs">↓</kbd> 이동 ·{" "}
              <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-xs">Enter</kbd> 확정 ·{" "}
              <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-xs">E</kbd> 상세
            </p>
          </Card>

          {selected.size > 0 && (
            <Card className="sticky top-14 z-10 mb-3 border-indigo-300 bg-indigo-50/80 backdrop-blur">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">
                    {selected.size}건 선택됨
                  </p>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="mt-0.5 text-xs text-zinc-500 underline hover:text-zinc-800"
                  >
                    선택 해제
                  </button>
                </div>
                {bulkTxType ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <AccountPicker
                        accounts={accounts}
                        txType={bulkTxType}
                        compact
                        value={bulkAcct}
                        onChange={setBulkAcct}
                      />
                    </div>
                    <Button
                      onClick={applyBulk}
                      disabled={busy || !bulkAcct.acctMinor}
                    >
                      {selected.size}건에 적용
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-rose-700">
                    거래유형이 섞여 있어 계정을 한 번에 지정할 수 없습니다
                    ({selectedTypes.join(" · ")}). 같은 유형끼리 골라주세요.
                  </p>
                )}
              </div>
            </Card>
          )}

          <div className="mb-2 flex items-center gap-3 text-sm">
            <button
              onClick={() =>
                setSelected(
                  selected.size === pending.length
                    ? new Set()
                    : new Set(pending.map((t) => t.id)),
                )
              }
              className="text-indigo-700 underline hover:text-indigo-900"
            >
              {selected.size === pending.length ? "전체 해제" : `전체 선택 (${pending.length})`}
            </button>
            <span className="text-zinc-400">
              여러 건을 골라 같은 계정으로 한 번에 지정할 수 있습니다
            </span>
          </div>

          <ul className="space-y-2">
            {pending.map((t, i) => {
              const active = i === cursor;
              return (
                <li
                  key={t.id}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  onClick={() => setCursor(i)}
                  className={`rounded-xl border bg-white p-4 shadow-sm transition ${
                    active ? "border-indigo-500 ring-2 ring-indigo-100" : "border-zinc-200"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer rounded border-zinc-300 accent-indigo-600"
                          aria-label="선택"
                        />
                        <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                        <span className="tabular-nums text-sm text-zinc-500">{t.date}</span>
                        <span className="text-sm text-zinc-500">{t.txType}</span>
                        <span className="font-semibold text-zinc-900">
                          {t.vendor || "(거래처 없음)"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-zinc-500">{t.classReason}</p>
                      {aiById.has(t.id) && !aiApplied.has(t.id) && (() => {
                        const s = aiById.get(t.id)!;
                        const strong = s.confidence >= 0.7;
                        return (
                          <div className="mt-2 rounded-lg border border-violet-300 bg-white px-3 py-2">
                            <p className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
                                AI 추천
                              </span>
                              <span className="font-medium text-zinc-900">
                                {[s.acctMajor, s.acctMid, s.acctMinor].join(" › ")}
                              </span>
                              {s.bizMinor && (
                                <span className="text-xs text-zinc-500">
                                  {s.bizMajor} · {s.bizMinor}
                                </span>
                              )}
                              <span className={`text-xs font-medium ${strong ? "text-emerald-700" : "text-amber-700"}`}>
                                확신 {Math.round(s.confidence * 100)}%
                              </span>
                              <button
                                type="button"
                                onClick={(ev) => { ev.stopPropagation(); void applyAi([t.id]); }}
                                disabled={busy}
                                className="rounded-md border border-violet-300 px-2 py-0.5 text-xs font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                              >
                                적용
                              </button>
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{s.reason}</p>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-lg font-bold">
                        <Money value={netAmount(t)} />
                      </span>
                      <Button variant="secondary" onClick={() => setEditing(t)}>
                        상세
                      </Button>
                      <Button onClick={() => approve(t)}>확정</Button>
                    </div>
                  </div>

                  {/* 현재 커서 행에서만 바로 분류를 고칠 수 있게 */}
                  {active && (
                    <div className="mt-3 border-t border-zinc-100 pt-3">
                      <p className="mb-2 text-xs font-medium text-zinc-500">
                        계정 (여기서 바로 고칠 수 있습니다)
                      </p>
                      <AccountPicker
                        accounts={accounts}
                        txType={t.txType}
                        compact
                        value={{
                          acctMajor: t.acctMajor,
                          acctMid: t.acctMid,
                          acctMinor: t.acctMinor,
                        }}
                        onChange={async (v) => {
                          await updateFinTransaction(t.id, v);
                          await refresh();
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {editing && (
        <TransactionEditor
          tx={editing}
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={bizMinors}
          onSave={async (patch) => {
            await updateFinTransaction(editing.id, patch);
            await refresh();
          }}
          onDelete={async () => {
            await deleteFinTransaction(editing.id);
            await refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
