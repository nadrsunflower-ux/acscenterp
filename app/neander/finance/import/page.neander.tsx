"use client";

// ============================================================
//  엑셀 임포트 — 기존 장부를 그대로 올린다
// ------------------------------------------------------------
//  순서: 파일 선택 → 파싱 → 중복 검사 → 자동분류 → **미리보기** →
//        확정 적재. 확정 전에는 아무것도 쓰지 않는다.
//
//  같은 파일을 두 번 올려도 중복 적재되지 않는다(dedupHash). 그래도
//  잘못 올렸을 때를 대비해 배치 단위 되돌리기를 둔다 — 재무 데이터를
//  손으로 지우게 만들면 안 된다.
// ============================================================

import { useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, Badge, Select } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useAppData } from "@/components/neander/app-data";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import { parseLedgerFile, type ParseResult, type ParsedRow } from "@/lib/neander/finance/xlsx";
import { classifyOne, summarize, type ClassifySuggestion } from "@/lib/neander/finance/classify";
import {
  bulkAddFinTransactions,
  createFinImport,
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

interface Prepared {
  row: ParsedRow;
  suggestion: ClassifySuggestion;
  duplicate: boolean;
}

export default function ImportPage() {
  const { transactions, paymentMethods, vendorRules, vendorIndex, imports, masterEmpty, refresh } =
    useFinance();
  const { currentMember } = useAppData();

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<{ inserted: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // 적재/되돌리기 실패를 반드시 화면에 띄운다. catch 없이 두면 버튼을 눌러도
  // 아무 일도 안 일어난 것처럼 보여서, 사용자는 실패한 줄도 모른다.
  const [failure, setFailure] = useState<FriendlyError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 이미 적재된 거래를 중복 키별로 **센다**.
  // 같은 날 같은 거래처에 같은 금액이 실제로 두 번 청구되는 일이 있어서
  // (2607 장부 실측 4건), 키 존재 여부로 막으면 멀쩡한 거래가 누락된다.
  const existingCounts = useMemo(() => {
    const m = new Map<string, number>();
    transactions.forEach((t) => {
      if (t.dedupHash) m.set(t.dedupHash, (m.get(t.dedupHash) ?? 0) + 1);
    });
    return m;
  }, [transactions]);

  const prepared = useMemo<Prepared[]>(() => {
    if (!parsed) return [];
    const seen = new Map<string, number>();
    return parsed.rows.map((row) => {
      // 이 파일에서 이 키가 몇 번째로 나왔는지
      const nth = seen.get(row.dedupHash) ?? 0;
      seen.set(row.dedupHash, nth + 1);
      // DB 에 이미 그만큼 있으면 중복, 그보다 많이 나오면 새 건이다
      const duplicate = nth < (existingCounts.get(row.dedupHash) ?? 0);
      return {
        row,
        duplicate,
        suggestion: classifyOne(row, { vendorIndex, vendorRules, paymentMethods }),
      };
    });
  }, [parsed, existingCounts, vendorIndex, vendorRules, paymentMethods]);

  const fresh = useMemo(() => prepared.filter((p) => !p.duplicate), [prepared]);
  const dupCount = prepared.length - fresh.length;
  const summary = useMemo(() => summarize(fresh.map((p) => p.suggestion)), [fresh]);
  const freshTotal = useMemo(() => {
    let income = 0;
    let expense = 0;
    fresh.forEach((p) => {
      const n = (p.row.gross || 0) - (p.row.adjust || 0);
      if (p.row.txType === "수입") income += n;
      else if (p.row.txType === "지출") expense += n;
    });
    return { income, expense };
  }, [fresh]);

  const handleFile = async (f: File, sheetName?: string) => {
    setBusy(true);
    setDone(null);
    setFailure(null);
    try {
      const res = await parseLedgerFile(f, sheetName);
      setFile(f);
      setParsed(res);
      setSheet(res.sheetName);
    } catch (e) {
      setFailure({
        title: "파일을 읽지 못했습니다",
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (fresh.length === 0) return;
    setBusy(true);
    setFailure(null);
    setProgress({ done: 0, total: fresh.length });
    try {
      const { id: batchId } = await createFinImport({
        fileName: file?.name ?? "(파일명 없음)",
        inserted: fresh.length,
        skipped: dupCount,
        byMemberId: currentMember?.id,
      });

      const rows: FinTransactionInput[] = fresh.map(({ row, suggestion }) => ({
        date: row.date,
        datetime: row.datetime,
        last4: row.last4,
        txType: row.txType,
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

      await bulkAddFinTransactions(rows, (d: number, t: number) =>
        setProgress({ done: d, total: t }),
      );
      await refresh();
      setDone({ inserted: fresh.length, skipped: dupCount });
      setParsed(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
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
    <div className="mx-auto w-full max-w-5xl px-5 py-8">
      <PageHeader
        title="엑셀 임포트"
        description="통합거래장 시트를 가진 .xlsx 를 올리면 중복을 걸러내고 자동분류한 뒤 미리 보여줍니다."
      />

      {masterEmpty && (
        <Card className="mb-4 border-amber-200 bg-amber-50/60">
          <p className="text-sm text-zinc-700">
            <b>계정 마스터가 아직 비어 있습니다.</b> 마스터 탭에서 먼저 적재하면 자동분류
            정확도와 계정 선택 드롭다운이 정상 동작합니다. 지금 임포트해도 적재는 되지만
            대부분 검토필요로 남습니다.
          </p>
        </Card>
      )}

      {failure && (
        <Card className="mb-4 border-rose-200 bg-rose-50/60">
          <p className="font-semibold text-rose-900">{failure.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-rose-800">{failure.detail}</p>
          {failure.command && (
            <code className="mt-2 inline-block rounded bg-white px-2 py-1 font-mono text-sm text-rose-900 ring-1 ring-rose-200">
              {failure.command}
            </code>
          )}
        </Card>
      )}

      {done && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50/60">
          <p className="text-sm text-zinc-800">
            <b>{done.inserted.toLocaleString("ko-KR")}건 적재 완료.</b>{" "}
            {done.skipped > 0 && `중복 ${done.skipped.toLocaleString("ko-KR")}건은 건너뛰었습니다.`}
          </p>
        </Card>
      )}

      {/* 드롭 영역 */}
      {!parsed && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 transition ${
            dragOver ? "border-indigo-400 bg-indigo-50/60" : "border-zinc-300 bg-white hover:bg-zinc-50"
          }`}
        >
          <div className="mb-2 text-4xl">📥</div>
          <p className="font-medium text-zinc-800">
            {busy ? "읽는 중…" : "장부 파일을 여기에 끌어다 놓으세요"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">.xlsx · 통합거래장 시트를 자동으로 찾습니다</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
      )}

      {/* 미리보기 */}
      {parsed && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-zinc-900">{file?.name}</p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  시트 <b>{parsed.sheetName}</b> · 헤더 {parsed.headerRowNo}행 · 데이터{" "}
                  {parsed.rows.length.toLocaleString("ko-KR")}행
                </p>
              </div>
              <div className="flex items-center gap-2">
                {parsed.sheetNames.length > 1 && (
                  <Select
                    value={sheet}
                    className="w-auto"
                    onChange={(e) => file && handleFile(file, e.target.value)}
                  >
                    {parsed.sheetNames.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                )}
                <Button variant="ghost" onClick={() => { setParsed(null); setFile(null); }}>
                  다른 파일
                </Button>
              </div>
            </div>
          </Card>

          {parsed.errors.length > 0 && (
            <Card className="mb-4 border-rose-200 bg-rose-50/60">
              <SectionTitle>읽지 못한 행 {parsed.errors.length}건</SectionTitle>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm text-zinc-700">
                {parsed.errors.slice(0, 30).map((e, i) => (
                  <li key={i}>
                    <b className="tabular-nums">{e.rowNo}행</b> — {e.reason}
                  </li>
                ))}
                {parsed.errors.length > 30 && (
                  <li className="text-zinc-400">… 외 {parsed.errors.length - 30}건</li>
                )}
              </ul>
            </Card>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-zinc-500">새로 적재</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 tabular-nums">
                {fresh.length.toLocaleString("ko-KR")}
                <span className="ml-1 text-sm font-normal text-zinc-400">건</span>
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-zinc-500">중복 (건너뜀)</p>
              <p className="mt-1 text-xl font-bold text-zinc-400 tabular-nums">
                {dupCount.toLocaleString("ko-KR")}
                <span className="ml-1 text-sm font-normal text-zinc-400">건</span>
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-zinc-500">수입 합계</p>
              <p className="mt-1 text-xl font-bold"><Money value={freshTotal.income} /></p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-zinc-500">지출 합계</p>
              <p className="mt-1 text-xl font-bold"><Money value={freshTotal.expense} /></p>
            </Card>
          </div>

          <Card className="mb-4">
            <SectionTitle hint={`자동확정률 ${Math.round(summary.autoRate * 100)}%`}>
              자동분류 결과
            </SectionTitle>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>확정 <b className="tabular-nums">{summary.confirmed.toLocaleString("ko-KR")}</b></span>
              <span>제안됨 <b className="tabular-nums">{summary.suggested.toLocaleString("ko-KR")}</b></span>
              <span>검토필요 <b className="tabular-nums">{summary.needsReview.toLocaleString("ko-KR")}</b></span>
            </div>
            {summary.needsReview + summary.suggested > 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                확정이 아닌 {(summary.needsReview + summary.suggested).toLocaleString("ko-KR")}건은
                적재 후 검토 대기함에서 승인하면 됩니다.
              </p>
            )}
          </Card>

          <Card className="mb-4 overflow-hidden p-0">
            <div className="px-5 pt-5">
              <SectionTitle hint={`앞 20건 미리보기 · 전체 ${fresh.length.toLocaleString("ko-KR")}건`}>
                적재될 거래
              </SectionTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-y border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                    <th className="px-4 py-2 text-left font-medium">거래일</th>
                    <th className="px-3 py-2 text-left font-medium">유형</th>
                    <th className="px-3 py-2 text-left font-medium">거래처</th>
                    <th className="px-3 py-2 text-left font-medium">계정</th>
                    <th className="px-3 py-2 text-right font-medium">순금액</th>
                    <th className="px-4 py-2 text-left font-medium">분류 근거</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {fresh.slice(0, 20).map((p, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-600">{p.row.date}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{p.row.txType}</td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-zinc-900">{p.row.vendor ?? "—"}</td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-zinc-600">
                        {p.suggestion.acctMinor ?? <span className="text-zinc-300">미분류</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Money value={(p.row.gross || 0) - (p.row.adjust || 0)} unit={false} />
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          <Badge color={STATUS_COLOR[p.suggestion.status]}>
                            {STATUS_LABEL[p.suggestion.status]}
                          </Badge>
                          <span className="truncate text-xs text-zinc-500">
                            {p.suggestion.classReason}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {progress && (
              <span className="text-sm text-zinc-500 tabular-nums">
                {progress.done.toLocaleString("ko-KR")} / {progress.total.toLocaleString("ko-KR")} 적재 중…
              </span>
            )}
            <Button variant="secondary" onClick={() => { setParsed(null); setFile(null); }} disabled={busy}>
              취소
            </Button>
            <Button onClick={commit} disabled={busy || fresh.length === 0}>
              {fresh.length.toLocaleString("ko-KR")}건 적재하기
            </Button>
          </div>
        </>
      )}

      {/* 임포트 이력 */}
      {imports.length > 0 && (
        <Card className="mt-8">
          <SectionTitle hint="잘못 올렸으면 배치 단위로 되돌릴 수 있습니다">임포트 이력</SectionTitle>
          <ul className="divide-y divide-zinc-100">
            {imports.map((im) => (
              <li key={im.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-800">{im.fileName}</p>
                  <p className="text-xs text-zinc-500">
                    {formatTimestamp(im.createdAt)} · 적재 {im.inserted.toLocaleString("ko-KR")}건
                    {im.skipped > 0 && ` · 중복 ${im.skipped.toLocaleString("ko-KR")}건 건너뜀`}
                  </p>
                </div>
                <Button variant="danger" disabled={busy} onClick={() => undo(im.id)}>
                  되돌리기
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
