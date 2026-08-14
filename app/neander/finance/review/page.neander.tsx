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
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, Badge, EmptyState, Select } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import { AccountPicker } from "@/components/neander/finance/AccountPicker";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import {
  updateFinTransaction,
  deleteFinTransaction,
  bulkUpdateFinStatus,
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
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

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
            {suggestedCount > 0 && (
              <Button variant="secondary" onClick={approveAllSuggested} disabled={busy}>
                제안됨 {suggestedCount}건 일괄 확정
              </Button>
            )}
          </div>
        }
      />

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
                        <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                        <span className="tabular-nums text-sm text-zinc-500">{t.date}</span>
                        <span className="text-sm text-zinc-500">{t.txType}</span>
                        <span className="font-semibold text-zinc-900">
                          {t.vendor || "(거래처 없음)"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-zinc-500">{t.classReason}</p>
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
