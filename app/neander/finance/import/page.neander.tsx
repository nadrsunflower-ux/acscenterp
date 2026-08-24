"use client";

// ============================================================
//  임포트 — 은행·카드·POS 엑셀을 그대로 올린다
// ------------------------------------------------------------
//  은행에서 받은 파일을 손으로 고쳐 통합거래장 모양으로 만들 필요가 없다.
//  파일을 끌어다 놓으면 열 이름으로 출처를 알아내고(어댑터), 중복을
//  걸러내고, 자동분류한 뒤 **미리 보여준다.** 확정 전에는 아무것도 쓰지
//  않는다.
//
//  파일 여러 개를 한 번에 올릴 수 있다. 한 달 마감이면 계좌 3개 + 카드
//  2개를 함께 올리는 게 자연스럽기 때문이다. 적재 배치는 **파일 단위**로
//  만든다 — 되돌리기가 "그 파일만" 이어야 쓸모가 있다.
//
//  ⚠️ 페이히어 POS 는 적재하지 않고 **대사**만 한다. 매장 매출은 이미
//     카드사 정산 입금으로 장부에 들어와 있어서, POS 를 넣으면 매출이 두
//     번 잡힌다 (adapters/pos.ts 주석 참고).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, Badge, Input } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useAppData } from "@/components/neander/app-data";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import {
  ADAPTERS,
  detectSource,
  looksEncrypted,
  parseWithAdapter,
  readWorkbook,
  type ParseFileResult,
} from "@/lib/neander/finance/adapters";
import { reconcilePos, storeToUnit, type PosResult } from "@/lib/neander/finance/adapters/pos";
import { parseReconcileSource } from "@/lib/neander/finance/adapters";
import { classifyOne, summarize, type ClassifySuggestion } from "@/lib/neander/finance/classify";
import {
  bulkAddFinTransactions,
  createFinImport,
  decryptFinanceFile,
  undoFinImport,
} from "@/lib/neander/finance/client";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  netAmount,
  type FinTransactionInput,
} from "@/lib/neander/finance/types";
import { formatTimestamp } from "@/lib/neander/format";
import { describeFinanceError, type FriendlyError } from "@/lib/neander/finance/errors";

type EntryStatus = "reading" | "password" | "ready" | "pos" | "error";

interface FileEntry {
  id: string;
  file: File;
  status: EntryStatus;
  buf?: ArrayBuffer;
  result?: ParseFileResult;
  pos?: PosResult;
  /** 사용자가 고른 출처 (자동 감지 덮어쓰기) */
  adapterId?: string;
  last4?: string;
  fxRate?: string;
  password?: string;
  error?: string;
}

const KIND_BADGE: Record<string, { text: string; color: string }> = {
  bank: { text: "은행", color: "#2a78d6" },
  card: { text: "카드", color: "#f59e0b" },
  pos: { text: "POS", color: "#16a34a" },
  ledger: { text: "장부", color: "#7c5cff" },
};

let seq = 0;

export default function ImportPage() {
  const { transactions, accounts, paymentMethods, vendorRules, vendorIndex, imports, masterEmpty, refresh } =
    useFinance();
  const { currentMember } = useAppData();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [done, setDone] = useState<{ files: number; inserted: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [failure, setFailure] = useState<FriendlyError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const knownLast4 = useMemo(() => paymentMethods.map((p) => p.last4), [paymentMethods]);
  /** 우리 법인·사업장 이름. 사람 이름은 넣지 않는다 (adapters/util.ts 주석) */
  const ownEntities = useMemo(
    () => [...new Set(paymentMethods.map((p) => p.site).filter(Boolean))],
    [paymentMethods],
  );

  // ---- 파일 읽기 ----------------------------------------------

  const readEntry = async (entry: FileEntry, overrides?: Partial<FileEntry>): Promise<FileEntry> => {
    const next: FileEntry = { ...entry, ...overrides, error: undefined };
    try {
      let buf = next.buf;
      if (!buf) {
        buf = await next.file.arrayBuffer();
        if (looksEncrypted(buf)) {
          if (!next.password) return { ...next, status: "password" };
          buf = await decryptFinanceFile(next.file, next.password);
        }
        next.buf = buf;
      }

      const wb = readWorkbook(buf);
      const detection = detectSource(wb, next.file.name);

      if (detection.pos && !next.adapterId) {
        const pos = parseReconcileSource(wb, next.file.name);
        return {
          ...next,
          status: "pos",
          pos: pos ?? undefined,
          error: pos ? undefined : "매출 파일을 읽지 못했습니다.",
        };
      }

      const result = parseWithAdapter(wb, {
        fileName: next.file.name,
        adapterId: next.adapterId,
        last4: next.last4,
        fxRate: next.fxRate ? Number(next.fxRate) : undefined,
        knownLast4,
        ownEntities,
      });
      if (!result) {
        return {
          ...next,
          status: "error",
          error:
            "이 파일의 출처를 알아내지 못했습니다. 아래에서 직접 고르거나, 통합거래장 형식으로 바꿔 올려주세요.",
        };
      }
      return { ...next, status: "ready", result };
    } catch (e) {
      return { ...next, status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  };

  const addFiles = async (files: File[]) => {
    setDone(null);
    setFailure(null);
    const fresh: FileEntry[] = files.map((f) => ({
      id: `f${++seq}`,
      file: f,
      status: "reading",
    }));
    setEntries((prev) => [...prev, ...fresh]);
    for (const entry of fresh) {
      const resolved = await readEntry(entry);
      setEntries((prev) => prev.map((e) => (e.id === resolved.id ? resolved : e)));
    }
  };

  const update = async (id: string, overrides: Partial<FileEntry>) => {
    const target = entries.find((e) => e.id === id);
    if (!target) return;
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...overrides, status: "reading" } : e)));
    // 출처·계좌·환율이 바뀌면 다시 파싱한다
    const resolved = await readEntry({ ...target, ...overrides });
    setEntries((prev) => prev.map((e) => (e.id === id ? resolved : e)));
  };

  const remove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const clearAll = () => {
    setEntries([]);
    setDone(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  // ---- 중복 검사 · 자동분류 -------------------------------------

  // 이미 적재된 거래를 중복 키별로 **센다**. 같은 날 같은 거래처에 같은
  // 금액이 실제로 두 번 청구되는 일이 있어서, 키 존재 여부로 막으면
  // 멀쩡한 거래가 누락된다.
  const existingCounts = useMemo(() => {
    const m = new Map<string, number>();
    transactions.forEach((t) => {
      if (t.dedupHash) m.set(t.dedupHash, (m.get(t.dedupHash) ?? 0) + 1);
    });
    return m;
  }, [transactions]);

  interface Prepared {
    entryId: string;
    fileName: string;
    row: ParseFileResult["rows"][number];
    suggestion: ClassifySuggestion;
    duplicate: boolean;
  }

  const prepared = useMemo<Prepared[]>(() => {
    const seen = new Map<string, number>();
    const out: Prepared[] = [];
    entries.forEach((e) => {
      if (e.status !== "ready" || !e.result) return;
      e.result.rows.forEach((row) => {
        const nth = seen.get(row.dedupHash) ?? 0;
        seen.set(row.dedupHash, nth + 1);
        const duplicate = nth < (existingCounts.get(row.dedupHash) ?? 0);
        out.push({
          entryId: e.id,
          fileName: e.file.name,
          row,
          duplicate,
          suggestion: classifyOne(
            { ...row, hint: row.hint },
            { vendorIndex, vendorRules, paymentMethods, accounts },
          ),
        });
      });
    });
    return out;
  }, [entries, existingCounts, vendorIndex, vendorRules, paymentMethods, accounts]);

  const fresh = useMemo(() => prepared.filter((p) => !p.duplicate), [prepared]);
  const dupCount = prepared.length - fresh.length;
  const summary = useMemo(() => summarize(fresh.map((p) => p.suggestion)), [fresh]);

  const byType = useMemo(() => {
    const m = new Map<string, { n: number; amt: number }>();
    fresh.forEach((p) => {
      const k = p.suggestion.txType ?? p.row.txType;
      if (!m.has(k)) m.set(k, { n: 0, amt: 0 });
      const v = m.get(k)!;
      v.n += 1;
      v.amt += netAmount(p.row);
    });
    return [...m.entries()];
  }, [fresh]);

  const totalErrors = entries.reduce((s, e) => s + (e.result?.errors.length ?? 0), 0);
  const readyCount = entries.filter((e) => e.status === "ready").length;
  const posEntries = entries.filter((e) => e.status === "pos" && e.pos);

  // ---- 적재 ---------------------------------------------------

  const commit = async () => {
    if (fresh.length === 0) return;
    setBusy(true);
    setFailure(null);
    let inserted = 0;
    let files = 0;
    try {
      // 배치는 파일 단위 — 되돌리기가 "그 파일만" 이어야 쓸모가 있다
      for (const entry of entries) {
        if (entry.status !== "ready") continue;
        const mine = fresh.filter((p) => p.entryId === entry.id);
        if (mine.length === 0) continue;
        const skipped = prepared.filter((p) => p.entryId === entry.id && p.duplicate).length;

        setProgress({ label: entry.file.name, done: 0, total: mine.length });
        const { id: batchId } = await createFinImport({
          fileName: `${entry.file.name} (${entry.result?.adapterLabel ?? ""})`,
          inserted: mine.length,
          skipped,
          byMemberId: currentMember?.id,
        });

        const rows: FinTransactionInput[] = mine.map(({ row, suggestion }) => ({
          date: row.date,
          datetime: row.datetime,
          last4: row.last4,
          // 분류가 유형을 고쳤으면 그것을 쓴다 (은행은 방향만 안다)
          txType: suggestion.txType ?? row.txType,
          bizMajor: suggestion.bizMajor,
          bizMinor: suggestion.bizMinor,
          acctMajor: suggestion.acctMajor,
          acctMid: suggestion.acctMid,
          acctMinor: suggestion.acctMinor,
          vendor: row.vendor,
          acctNote: row.acctNote,
          personalUse: row.personalUse,
          projectCode: row.projectCode,
          gross: row.gross,
          adjust: row.adjust,
          site: suggestion.site,
          note: row.note,
          status: suggestion.status,
          classReason: suggestion.classReason,
          refundMatchId: row.refundMatchId,
          dedupHash: row.dedupHash,
          importBatchId: batchId,
        }));

        await bulkAddFinTransactions(rows, (d, t) =>
          setProgress({ label: entry.file.name, done: d, total: t }),
        );
        inserted += mine.length;
        files += 1;
      }

      await refresh();
      setDone({ files, inserted, skipped: dupCount });
      clearAll();
    } catch (e) {
      setFailure(describeFinanceError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const undo = async (batchId: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await undoFinImport(batchId);
      await refresh();
    } catch (e) {
      setFailure(describeFinanceError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <PageHeader
        title="임포트"
        description="은행·카드사·POS 에서 받은 엑셀을 그대로 올리면 출처를 알아내 중복을 걸러내고 자동분류합니다. 여러 개를 한 번에 올릴 수 있습니다."
        actions={
          entries.length > 0 ? (
            <Button variant="ghost" onClick={clearAll} disabled={busy}>
              전체 지우기
            </Button>
          ) : undefined
        }
      />

      {masterEmpty && (
        <Card className="mb-4 border-amber-200 bg-amber-50/60">
          <p className="text-sm text-zinc-700">
            <b>계정 마스터가 아직 비어 있습니다.</b> 마스터 탭에서 먼저 적재하면 자동분류
            정확도가 올라갑니다. 지금 임포트해도 적재는 되지만 대부분 검토필요로 남습니다.
          </p>
        </Card>
      )}

      {failure && (
        <Card className="mb-4 border-rose-200 bg-rose-50/60">
          <p className="font-semibold text-rose-900">{failure.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-rose-800">{failure.detail}</p>
        </Card>
      )}

      {done && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50/60">
          <p className="text-sm text-zinc-800">
            <b>파일 {done.files}개 · {done.inserted.toLocaleString("ko-KR")}건 적재 완료.</b>{" "}
            {done.skipped > 0 && `중복 ${done.skipped.toLocaleString("ko-KR")}건은 건너뛰었습니다.`}
          </p>
        </Card>
      )}

      {/* ---- 드롭 영역 ---- */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) void addFiles(files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
          entries.length > 0 ? "py-8" : "py-14"
        } ${dragOver ? "border-indigo-400 bg-indigo-50/60" : "border-zinc-300 bg-white hover:bg-zinc-50"}`}
      >
        <div className="mb-2 text-3xl">📥</div>
        <p className="font-medium text-zinc-800">파일을 여기에 끌어다 놓으세요 (여러 개 가능)</p>
        <p className="mt-1 text-center text-sm text-zinc-500">
          국민·신한 은행/법인카드 · 토스뱅크 · 카카오뱅크 · 페이히어 · 통합거래장
          <br />
          <span className="text-zinc-400">토스·카카오처럼 암호가 걸린 파일은 비밀번호를 물어봅니다</span>
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void addFiles(files);
          }}
        />
      </div>

      {/* ---- 파일별 카드 ---- */}
      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          paymentMethods={paymentMethods}
          rowCount={prepared.filter((p) => p.entryId === e.id).length}
          freshCount={fresh.filter((p) => p.entryId === e.id).length}
          onUpdate={(o) => void update(e.id, o)}
          onRemove={() => remove(e.id)}
        />
      ))}

      {/* ---- POS 대사 ---- */}
      {posEntries.map((e) => (
        <PosCard key={e.id} entry={e} transactions={transactions} onRemove={() => remove(e.id)} />
      ))}

      {/* ---- 합계 미리보기 ---- */}
      {readyCount > 0 && (
        <Card className="mb-4">
          <SectionTitle hint={`파일 ${readyCount}개 기준`}>적재 미리보기</SectionTitle>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-zinc-500">
              새 거래 <b className="text-zinc-900">{fresh.length.toLocaleString("ko-KR")}</b>건
            </span>
            {dupCount > 0 && (
              <span className="text-zinc-500">
                중복 제외 <b className="text-zinc-700">{dupCount.toLocaleString("ko-KR")}</b>건
              </span>
            )}
            {totalErrors > 0 && (
              <span className="text-rose-600">
                읽지 못한 행 <b>{totalErrors.toLocaleString("ko-KR")}</b>건
              </span>
            )}
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byType.map(([type, v]) => (
              <div key={type} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                <span className="text-zinc-600">
                  {type}
                  <span className="ml-1.5 text-xs text-zinc-400">{v.n}건</span>
                </span>
                <Money value={v.amt} unit={false} />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-100 pt-3 text-sm">
            <span className="text-zinc-500">자동분류</span>
            <span><Badge color={STATUS_COLOR.confirmed}>확정 {summary.confirmed}</Badge></span>
            <span><Badge color={STATUS_COLOR.suggested}>제안됨 {summary.suggested}</Badge></span>
            <span><Badge color={STATUS_COLOR.needs_review}>검토필요 {summary.needsReview}</Badge></span>
            <span className="text-zinc-400">
              자동확정률 {Math.round(summary.autoRate * 100)}%
            </span>
          </div>

          {/* 처음 몇 건을 실제로 보여준다 — 숫자만 보고 적재하게 하면 안 된다 */}
          {fresh.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                    <th className="px-3 py-2 text-left font-medium">거래일</th>
                    <th className="px-2 py-2 text-left font-medium">계좌</th>
                    <th className="px-2 py-2 text-left font-medium">유형</th>
                    <th className="px-2 py-2 text-left font-medium">거래처</th>
                    <th className="px-2 py-2 text-right font-medium">금액</th>
                    <th className="px-2 py-2 text-left font-medium">자동분류</th>
                    <th className="px-3 py-2 text-left font-medium">근거</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {fresh.slice(0, 12).map((p, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-zinc-600">{p.row.date}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-zinc-500">{p.row.last4 ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-zinc-600">
                        {p.suggestion.txType && p.suggestion.txType !== p.row.txType ? (
                          <span className="text-indigo-700" title={`원본 ${p.row.txType} → 교정`}>
                            {p.suggestion.txType}<span className="text-zinc-400"> ←{p.row.txType}</span>
                          </span>
                        ) : (
                          p.row.txType
                        )}
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1.5 font-medium text-zinc-900">{p.row.vendor ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right"><Money value={netAmount(p.row)} unit={false} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <Badge color={STATUS_COLOR[p.suggestion.status]}>{STATUS_LABEL[p.suggestion.status]}</Badge>
                        {p.suggestion.acctMinor && (
                          <span className="ml-1.5 text-xs text-zinc-500">{p.suggestion.acctMinor}</span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-1.5 text-xs text-zinc-400" title={p.suggestion.classReason}>
                        {p.suggestion.classReason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fresh.length > 12 && (
                <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-400">
                  … 외 {(fresh.length - 12).toLocaleString("ko-KR")}건
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            {progress && (
              <span className="text-sm text-zinc-500">
                {progress.label} — {progress.done}/{progress.total}
              </span>
            )}
            <Button onClick={commit} disabled={busy || fresh.length === 0}>
              {busy ? "적재 중…" : `${fresh.length.toLocaleString("ko-KR")}건 적재`}
            </Button>
          </div>
        </Card>
      )}

      {/* ---- 적재 이력 ---- */}
      <Card className="p-0">
        <div className="border-b border-zinc-200 px-5 py-3">
          <SectionTitle hint="파일 단위로 통째 되돌릴 수 있습니다">적재 이력</SectionTitle>
        </div>
        {imports.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-400">아직 적재 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {imports.slice(0, 20).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-zinc-900">{b.fileName}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {b.inserted.toLocaleString("ko-KR")}건 적재
                    {b.skipped > 0 && ` · 중복 ${b.skipped}건 제외`}
                    {b.createdAt && ` · ${formatTimestamp(b.createdAt)}`}
                  </span>
                </span>
                <Button variant="ghost" disabled={busy} onClick={() => undo(b.id)}>
                  되돌리기
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ============================================================
//  파일 카드
// ============================================================

function EntryCard({
  entry,
  paymentMethods,
  rowCount,
  freshCount,
  onUpdate,
  onRemove,
}: {
  entry: FileEntry;
  paymentMethods: { last4: string; alias: string; site: string }[];
  rowCount: number;
  freshCount: number;
  onUpdate: (o: Partial<FileEntry>) => void;
  onRemove: () => void;
}) {
  const [pw, setPw] = useState("");
  const [rate, setRate] = useState(entry.fxRate ?? "");
  useEffect(() => setRate(entry.fxRate ?? ""), [entry.fxRate]);

  if (entry.status === "pos") return null; // PosCard 가 따로 그린다

  const r = entry.result;
  const kind = r ? ADAPTERS.find((a) => a.id === r.adapterId)?.kind : undefined;
  const badge = kind ? KIND_BADGE[kind] : undefined;
  const needsAccount = r?.needs.account || (r && !r.rows.some((x) => x.last4));
  const needsFx = Boolean(r?.needs.fxCurrency && !entry.fxRate);

  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-zinc-900">
            <span className="min-w-0 break-all">{entry.file.name}</span>
            {badge && <Badge color={badge.color}>{badge.text}</Badge>}
          </p>
          <p className="mt-0.5 text-sm text-zinc-500">
            {entry.status === "reading" && "읽는 중…"}
            {entry.status === "password" && "암호가 걸린 파일입니다 — 비밀번호를 입력하세요."}
            {entry.status === "error" && <span className="text-rose-600">{entry.error}</span>}
            {entry.status === "ready" && r && (
              <>
                <b className="text-zinc-700">{r.adapterLabel}</b> · 시트 {r.sheetName} · 헤더{" "}
                {r.headerRowNo}행 · {r.rows.length.toLocaleString("ko-KR")}행
                {rowCount !== freshCount && ` (새 거래 ${freshCount}건)`}
                {r.errors.length > 0 && (
                  <span className="text-rose-600"> · 읽지 못한 행 {r.errors.length}건</span>
                )}
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" onClick={onRemove}>제외</Button>
      </div>

      {/* 비밀번호 */}
      {entry.status === "password" && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input
            type="password"
            placeholder="파일 비밀번호"
            value={pw}
            onChange={(ev) => setPw(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && pw) onUpdate({ password: pw });
            }}
            className="w-48"
          />
          <Button disabled={!pw} onClick={() => onUpdate({ password: pw })}>
            열기
          </Button>
          <span className="text-xs text-zinc-400">
            비밀번호는 파일을 푸는 데만 쓰이고 저장되지 않습니다.
          </span>
        </div>
      )}

      {/* 출처·계좌·환율 조정 */}
      {(entry.status === "ready" || entry.status === "error") && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            출처
            <select
              value={entry.adapterId ?? r?.adapterId ?? ""}
              onChange={(ev) => onUpdate({ adapterId: ev.target.value })}
              className="h-8 cursor-pointer rounded-md border border-zinc-300 bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500"
            >
              <option value="">(자동 감지)</option>
              {ADAPTERS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            계좌·카드
            {needsAccount && <span className="text-amber-600">파일에 없음 — 선택 필요</span>}
            <select
              value={entry.last4 ?? ""}
              onChange={(ev) => onUpdate({ last4: ev.target.value || undefined })}
              className={`h-8 cursor-pointer rounded-md border bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500 ${
                needsAccount ? "border-amber-400" : "border-zinc-300"
              }`}
            >
              <option value="">
                {r?.detectedLast4.length
                  ? `파일에서 감지 (${r.detectedLast4.join(", ")})`
                  : "(선택)"}
              </option>
              {paymentMethods.map((p) => (
                <option key={p.last4} value={p.last4}>
                  {p.last4} · {p.alias} · {p.site}
                </option>
              ))}
            </select>
          </label>

          {r?.needs.fxCurrency && (
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {r.needs.fxCurrency} 환율 ({r.needs.fxRows}건)
              {needsFx && <span className="text-amber-600">입력 전에는 적재되지 않음</span>}
              <span className="flex items-center gap-1">
                <Input
                  type="number"
                  placeholder="예: 1380"
                  value={rate}
                  onChange={(ev) => setRate(ev.target.value)}
                  onBlur={() => rate !== (entry.fxRate ?? "") && onUpdate({ fxRate: rate })}
                  className={`h-8 w-28 text-xs ${needsFx ? "border-amber-400" : ""}`}
                />
              </span>
            </label>
          )}
        </div>
      )}

      {/* 경고 */}
      {r && r.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {r.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {/* 읽지 못한 행 */}
      {r && r.errors.length > 0 && (
        <details className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-rose-900">
            읽지 못한 행 {r.errors.length}건 보기
          </summary>
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-xs text-rose-800">
            {r.errors.slice(0, 40).map((x, i) => (
              <li key={i}><b className="tabular-nums">{x.rowNo}행</b> — {x.reason}</li>
            ))}
            {r.errors.length > 40 && <li className="text-rose-400">… 외 {r.errors.length - 40}건</li>}
          </ul>
        </details>
      )}
    </Card>
  );
}

// ============================================================
//  페이히어 POS — 대사 카드 (적재하지 않는다)
// ============================================================

function PosCard({
  entry,
  transactions,
  onRemove,
}: {
  entry: FileEntry;
  transactions: { date?: string; txType: string; acctMinor?: string; gross: number; adjust: number }[];
  onRemove: () => void;
}) {
  const pos = entry.pos;
  // 파서가 귀속을 알면 그것을 쓰고, 모르면 매장 이름에서 추정한다
  const guess = pos ? (pos.unit ?? storeToUnit(pos.store)) : {};
  /** 어느 매출 계정과 맞춰볼지 — 파서의 추정이 늘 맞지는 않는다 */
  const [acct, setAcct] = useState<string>(guess.acctMinor ?? "");
  useEffect(() => setAcct(guess.acctMinor ?? ""), [guess.acctMinor]);
  const unit = { ...guess, acctMinor: acct || guess.acctMinor };

  /** 같은 기간에 각 매출 계정이 얼마나 잡혔는지 — 고를 때 근거가 된다 */
  const acctOptions = useMemo(() => {
    if (!pos?.from || !pos?.to) return [];
    const m = new Map<string, { n: number; amt: number }>();
    transactions.forEach((t) => {
      if (t.txType !== "수입" && t.txType !== "환급") return;
      if (!t.acctMinor || !/판매|매출|구독/.test(t.acctMinor)) return;
      if ((t.date ?? "") < pos.from! || (t.date ?? "") > pos.to!) return;
      if (!m.has(t.acctMinor)) m.set(t.acctMinor, { n: 0, amt: 0 });
      const e = m.get(t.acctMinor)!;
      e.n += 1;
      e.amt += (t.txType === "환급" ? -1 : 1) * ((t.gross || 0) - (t.adjust || 0));
    });
    return [...m.entries()].sort((a, b) => b[1].amt - a[1].amt);
  }, [transactions, pos?.from, pos?.to]);

  // 같은 기간·같은 매장 계정으로 장부에 잡힌 매출.
  // ⚠️ 훅은 early return 앞에 둔다 — 조건부 호출은 React 규칙 위반이다.
  const ledger = useMemo(() => {
    if (!unit.acctMinor || !pos?.from || !pos?.to) return { ledgerSales: 0, ledgerCount: 0 };
    const rows = transactions.filter(
      (t) =>
        t.acctMinor === unit.acctMinor &&
        (t.txType === "수입" || t.txType === "환급") &&
        (t.date ?? "") >= pos.from! &&
        (t.date ?? "") <= pos.to!,
    );
    return {
      ledgerSales: rows.reduce(
        (s, t) => s + (t.txType === "환급" ? -1 : 1) * ((t.gross || 0) - (t.adjust || 0)),
        0,
      ),
      ledgerCount: rows.length,
    };
  }, [transactions, unit.acctMinor, pos?.from, pos?.to]);

  if (!pos) return null;
  const rec = reconcilePos(pos, ledger);

  return (
    <Card className="mb-3 border-emerald-200 bg-emerald-50/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-zinc-900">
            <span className="min-w-0 break-all">{entry.file.name}</span>
            <Badge color={KIND_BADGE.pos.color}>{pos.sourceLabel} · 대사용</Badge>
          </p>
          <p className="mt-0.5 text-sm text-zinc-600">
            {pos.store} · {pos.period} · {pos.summary.count}건
            {unit.acctMinor && <span className="text-zinc-400"> → 계정 {unit.acctMinor}</span>}
          </p>
        </div>
        <Button variant="ghost" onClick={onRemove}>제외</Button>
      </div>

      <p className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs leading-relaxed text-zinc-700">
        <b>이 파일은 적재하지 않습니다.</b> 매출은 이미 정산 입금(카드사 정산 · Npay정산)으로 장부에
        들어와 있어서, 여기서 또 넣으면 매출이 두 번 잡힙니다. 대신 아래처럼 <b>맞춰 봅니다</b> —
        차이가 결제 수수료와 미정산분입니다.
      </p>

      {acctOptions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            맞춰볼 매출 계정
            <select
              value={unit.acctMinor ?? ""}
              onChange={(ev) => setAcct(ev.target.value)}
              className="h-8 cursor-pointer rounded-md border border-zinc-300 bg-white pl-2 pr-6 text-xs text-zinc-800 outline-none focus:border-indigo-500"
            >
              <option value="">(선택)</option>
              {acctOptions.map(([name, v]) => (
                <option key={name} value={name}>
                  {name} — 같은 기간 {v.n}건 {v.amt.toLocaleString("ko-KR")}원
                </option>
              ))}
            </select>
          </label>
          <span className="pb-1.5 text-xs text-zinc-400">
            같은 기간 장부에 잡힌 매출 계정들입니다. 금액이 가까운 쪽이 대개 맞습니다.
          </span>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`${pos.sourceLabel} 실매출`} value={rec.posNet} hint={`${rec.posCount}건`} />
        <Stat
          label="장부 매출"
          value={rec.ledgerSales}
          hint={`${rec.ledgerCount}건 · ${unit.acctMinor ?? "계정 미선택"}`}
        />
        <Stat
          label="차이 (장부 − 원본)"
          value={rec.gap}
          hint={`${(rec.gapRate * 100).toFixed(1)}% · 수수료·미정산`}
        />
        <Stat
          label={rec.cardPortion > 0 ? "카드 결제분" : "간편결제분"}
          value={rec.cardPortion > 0 ? rec.cardPortion : pos.byMethod.easy}
          hint={`현금 ${rec.cashPortion.toLocaleString("ko-KR")}`}
        />
      </div>

      {pos.summary.refund > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          환불 {pos.summary.refundCount}건 <Money value={pos.summary.refund} unit={false} />원 —
          장부에서는 환급 또는 매출 차감으로 잡혀 있어야 합니다.
        </p>
      )}
      {pos.warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-amber-800">⚠ {w}</p>
      ))}
      {!unit.acctMinor && (
        <p className="mt-2 text-xs text-amber-800">
          ⚠ 맞춰볼 매출 계정을 고르지 않아 장부와 대조하지 못했습니다.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold"><Money value={value} unit={false} /></p>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}
