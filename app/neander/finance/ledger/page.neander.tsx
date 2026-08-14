"use client";

// ============================================================
//  거래 원장 — 전체 거래 조회·수정
// ------------------------------------------------------------
//  필터는 한 줄에 모아 위에 둔다. 목록은 페이지네이션하되 합계는
//  **필터 결과 전체**를 기준으로 낸다 (현재 페이지 합계가 아니다 —
//  그건 재무에서 오해를 부른다).
// ============================================================

import { useMemo, useState } from "react";
import { Button, Card, Input, PageHeader, Select, Badge, EmptyState } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import {
  addFinTransaction,
  deleteFinTransaction,
  updateFinTransaction,
} from "@/lib/neander/finance/client";
import { exportLedgerXlsx } from "@/lib/neander/finance/export";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  TX_TYPES,
  netAmount,
  dedupHashOf,
  type ClassificationStatus,
  type FinTransaction,
} from "@/lib/neander/finance/types";
import { todayStr } from "@/lib/neander/format";
import { availableMonths, totals, plOnly } from "@/lib/neander/finance/aggregate";

const PAGE_SIZE = 50;
const ALL = "__all__";

export default function LedgerPage() {
  const { transactions, accounts, paymentMethods, loading, refresh } = useFinance();

  const [month, setMonth] = useState(ALL);
  const [txType, setTxType] = useState(ALL);
  const [bizMajor, setBizMajor] = useState(ALL);
  const [bizMinor, setBizMinor] = useState(ALL);
  const [acctMajor, setAcctMajor] = useState(ALL);
  const [site, setSite] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<FinTransaction | null>(null);
  // 신규 입력 — 엑셀을 거치지 않고 여기서 바로 거래를 만든다
  const [creating, setCreating] = useState<FinTransaction | null>(null);

  const blankTx = (): FinTransaction => ({
    id: "",
    date: todayStr(),
    txType: "지출",
    gross: 0,
    adjust: 0,
    status: "confirmed",
    dedupHash: "",
    createdAt: Date.now(),
  });

  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const opts = useMemo(() => {
    const pick = (f: (t: FinTransaction) => string | undefined) =>
      [...new Set(transactions.map(f).filter(Boolean) as string[])].sort((a, b) =>
        a.localeCompare(b, "ko"),
      );
    return {
      bizMajors: pick((t) => t.bizMajor),
      bizMinors: pick((t) => t.bizMinor),
      acctMajors: pick((t) => t.acctMajor),
      sites: pick((t) => t.site),
    };
  }, [transactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (month !== ALL && !(t.date ?? "").startsWith(month)) return false;
      if (txType !== ALL && t.txType !== txType) return false;
      if (bizMajor !== ALL && (t.bizMajor ?? "") !== bizMajor) return false;
      if (bizMinor !== ALL && (t.bizMinor ?? "") !== bizMinor) return false;
      if (acctMajor !== ALL && (t.acctMajor ?? "") !== acctMajor) return false;
      if (site !== ALL && (t.site ?? "") !== site) return false;
      if (status !== ALL && t.status !== status) return false;
      if (q) {
        const hay = [t.vendor, t.acctMinor, t.note, t.acctNote, t.last4]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, month, txType, bizMajor, bizMinor, acctMajor, site, status, search]);

  // 합계는 필터 결과 전체 기준
  const sum = useMemo(() => totals(plOnly(filtered)), [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const resetFilters = () => {
    setMonth(ALL); setTxType(ALL); setBizMajor(ALL); setBizMinor(ALL);
    setAcctMajor(ALL); setSite(ALL); setStatus(ALL); setSearch(""); setPage(0);
  };
  const anyFilter =
    month !== ALL || txType !== ALL || bizMajor !== ALL || bizMinor !== ALL ||
    acctMajor !== ALL || site !== ALL || status !== ALL || search.trim() !== "";

  if (loading) {
    return <div className="px-5 py-16 text-center text-zinc-400">불러오는 중…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8">
      <PageHeader
        title="거래 원장"
        description={`전체 ${transactions.length.toLocaleString("ko-KR")}건`}
        actions={
          <>
          <Button onClick={() => setCreating(blankTx())}>거래 추가</Button>
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() =>
              exportLedgerXlsx(
                filtered,
                accounts,
                paymentMethods,
                `통합거래장_${month === ALL ? "전체" : month}.xlsx`,
              )
            }
          >
            엑셀 내보내기
          </Button>
          </>
        }
      />

      {/* 필터 — 한 줄에 모아 위에 */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Select value={month} onChange={(e) => { setMonth(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>전체 기간</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select value={txType} onChange={(e) => { setTxType(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>거래유형</option>
            {TX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select value={bizMajor} onChange={(e) => { setBizMajor(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>사업대분류</option>
            {opts.bizMajors.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select value={bizMinor} onChange={(e) => { setBizMinor(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>사업소분류</option>
            {opts.bizMinors.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select value={acctMajor} onChange={(e) => { setAcctMajor(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>계정대분류</option>
            {opts.acctMajors.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select value={site} onChange={(e) => { setSite(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>사업장</option>
            {opts.sites.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="w-auto">
            <option value={ALL}>상태</option>
            {(["confirmed", "suggested", "needs_review"] as ClassificationStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Input
            placeholder="거래처·계정·비고 검색"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-56"
          />
          {anyFilter && (
            <Button variant="ghost" onClick={resetFilters}>필터 해제</Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-zinc-100 pt-3 text-sm">
          <span className="text-zinc-500">
            검색 결과 <b className="font-semibold text-zinc-900">{filtered.length.toLocaleString("ko-KR")}</b>건
          </span>
          <span className="text-zinc-500">수입 <Money value={sum.income} unit={false} /></span>
          <span className="text-zinc-500">지출 <Money value={sum.expense} unit={false} /></span>
          <span className="text-zinc-500">환급 <Money value={sum.refund} unit={false} /></span>
          <span className="text-zinc-500">순손익 <Money value={sum.net} unit={false} className="font-semibold" /></span>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState icon="🔍" title="조건에 맞는 거래가 없습니다" description="필터를 풀거나 검색어를 바꿔보세요." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-4 py-2 text-left font-medium">거래일</th>
                  <th className="px-3 py-2 text-left font-medium">유형</th>
                  <th className="px-3 py-2 text-left font-medium">거래처</th>
                  <th className="px-3 py-2 text-left font-medium">계정</th>
                  <th className="px-3 py-2 text-left font-medium">사업구분</th>
                  <th className="px-3 py-2 text-left font-medium">사업장</th>
                  <th className="px-3 py-2 text-right font-medium">순금액</th>
                  <th className="px-4 py-2 text-right font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {shown.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setEditing(t)}
                    className="cursor-pointer hover:bg-indigo-50/40"
                  >
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-600">{t.date}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{t.txType}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 font-medium text-zinc-900">
                      {t.vendor || <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-zinc-600">
                      {t.acctMinor ? (
                        <>
                          <span className="text-zinc-400">{t.acctMajor} · </span>
                          {t.acctMinor}
                        </>
                      ) : (
                        <span className="text-zinc-300">미분류</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                      {t.bizMajor ? `${t.bizMajor} · ${t.bizMinor ?? "(미정)"}` : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{t.site ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      <Money value={netAmount(t)} unit={false} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3">
              <span className="text-sm text-zinc-500">
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length.toLocaleString("ko-KR")}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  이전
                </Button>
                <span className="text-sm text-zinc-600">{safePage + 1} / {pageCount}</span>
                <Button variant="secondary" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                  다음
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {creating && (
        <TransactionEditor
          tx={creating}
          isNew
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={opts.bizMinors}
          onSave={async (patch) => {
            await addFinTransaction({
              ...patch,
              date: patch.date ?? todayStr(),
              txType: patch.txType ?? "지출",
              gross: patch.gross ?? 0,
              adjust: patch.adjust ?? 0,
              status: patch.status ?? "confirmed",
              classReason: "화면에서 직접 입력",
              dedupHash:
                patch.dedupHash ??
                dedupHashOf({
                  date: patch.date ?? todayStr(),
                  last4: patch.last4,
                  vendor: patch.vendor,
                  gross: patch.gross ?? 0,
                  txType: patch.txType ?? "지출",
                }),
            });
            await refresh();
          }}
          onClose={() => setCreating(null)}
        />
      )}

      {editing && (
        <TransactionEditor
          tx={editing}
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={opts.bizMinors}
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
