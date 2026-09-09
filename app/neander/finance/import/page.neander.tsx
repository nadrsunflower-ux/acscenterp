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
//
//  화면은 세 단계다: ① 파일 올리기 → ② 파일별 확인 → ③ 미리보기·적재.
//  단계마다 주요 동작은 하나다.
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Info, KeyRound, TriangleAlert, Undo2, Upload } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Field,
  Icon,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  PageHeader,
  SectionHeader,
  Select,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
  cn,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useAppData } from "@/components/neander/app-data";
import { Money } from "@/components/neander/finance/ui";
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
  STATUS_LABEL,
  netAmount,
  type ClassificationStatus,
  type FinTransactionInput,
} from "@/lib/neander/finance/types";
import { formatTimestamp } from "@/lib/neander/format";
import { describeFinanceError } from "@/lib/neander/finance/errors";

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

/** 출처 배지 — 종류는 의미이므로 tone 으로 */
const KIND_BADGE: Record<string, { text: string; tone: Tone }> = {
  bank: { text: "은행", tone: "info" },
  card: { text: "카드", tone: "warning" },
  pos: { text: "POS", tone: "success" },
  ledger: { text: "장부", tone: "accent" },
};

/** 자동분류 상태 → tone (types.ts 의 STATUS_COLOR 와 같은 뜻) */
const STATUS_TONE: Record<ClassificationStatus, Tone> = {
  confirmed: "success",
  suggested: "warning",
  needs_review: "danger",
};

let seq = 0;

export default function ImportPage() {
  const { transactions, accounts, paymentMethods, vendorRules, vendorIndex, imports, masterEmpty, refresh } =
    useFinance();
  const { currentMember } = useAppData();
  const toast = useToast();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
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
  const fileEntries = entries.filter((e) => e.status !== "pos");

  // ---- 적재 ---------------------------------------------------

  const commit = async () => {
    if (fresh.length === 0) return;
    setBusy(true);
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
      toast.success(
        `${dupCount > 0 ? `중복 ${dupCount.toLocaleString("ko-KR")}건은 건너뛰었습니다.` : ""}`.trim() || "장부에 반영됐습니다.",
        { title: `파일 ${files}개 · ${inserted.toLocaleString("ko-KR")}건 적재 완료` },
      );
      clearAll();
    } catch (e) {
      const f = describeFinanceError(e);
      toast.error(f.detail, { title: f.title });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const undo = async (batchId: string) => {
    setBusy(true);
    try {
      await undoFinImport(batchId);
      await refresh();
      toast.success("적재를 되돌렸습니다.");
    } catch (e) {
      const f = describeFinanceError(e);
      toast.error(f.detail, { title: f.title });
    } finally {
      setBusy(false);
    }
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader
        title="임포트"
        description="은행·카드사·POS 에서 받은 엑셀을 그대로 올리면 출처를 알아내 중복을 걸러내고 자동분류합니다."
        actions={
          entries.length > 0 ? (
            <Button variant="ghost" onClick={clearAll} disabled={busy}>
              전체 지우기
            </Button>
          ) : undefined
        }
      />

      {masterEmpty && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-5">
          <b>계정 마스터가 아직 비어 있습니다.</b> 마스터 탭에서 먼저 적재하면 자동분류
          정확도가 올라갑니다. 지금 임포트해도 적재는 되지만 대부분 검토필요로 남습니다.
        </InlineNotice>
      )}

      {/* ---- ① 파일 올리기 ---- */}
      <section className="mb-6">
        <StepHeader n={1} title="파일 올리기" hint="여러 개를 한 번에 올릴 수 있습니다" done={entries.length > 0} />
        <Card
          padding="none"
          role="button"
          tabIndex={0}
          aria-label="파일 올리기 — 끌어다 놓거나 눌러서 선택"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) void addFiles(files);
          }}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center border-2 border-dashed shadow-none transition-colors duration-nd-fast",
            entries.length > 0 ? "py-6" : "py-12",
            dragOver ? "border-nd-accent bg-nd-accent-soft" : "border-nd-border hover:bg-nd-sunken",
          )}
        >
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-nd-fg/[.06] text-nd-fg-2">
            <Icon icon={Upload} size={22} />
          </span>
          <p className="text-nd-body font-medium text-nd-fg">파일을 여기에 끌어다 놓으세요</p>
          <p className="mt-1 text-center text-nd-caption text-nd-fg-2">
            국민·신한 은행/법인카드 · 토스뱅크 · 카카오뱅크 · 페이히어 · 통합거래장
            <br />
            <span className="text-nd-fg-3">토스·카카오처럼 암호가 걸린 파일은 비밀번호를 물어봅니다</span>
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              openPicker();
            }}
          >
            파일 선택
          </Button>
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
        </Card>
      </section>

      {/* ---- ② 파일별 확인 ---- */}
      {entries.length > 0 && (
        <section className="mb-6">
          <StepHeader
            n={2}
            title="파일 확인"
            hint="출처·계좌·환율이 맞는지 보고, 비밀번호가 필요하면 입력합니다"
            done={readyCount > 0 && entries.every((e) => e.status === "ready" || e.status === "pos")}
          />
          <div className="space-y-3">
            {fileEntries.map((e) => (
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
            {posEntries.map((e) => (
              <PosCard key={e.id} entry={e} transactions={transactions} onRemove={() => remove(e.id)} />
            ))}
          </div>
        </section>
      )}

      {/* ---- ③ 미리보기 · 적재 ---- */}
      {readyCount > 0 && (
        <section className="mb-6">
          <StepHeader n={3} title="미리보기 · 적재" hint={`파일 ${readyCount}개 기준 — 확정 전에는 아무것도 쓰지 않습니다`} />
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-nd-body">
                <span className="text-nd-fg-2">
                  새 거래 <b className="nd-num text-nd-fg">{fresh.length.toLocaleString("ko-KR")}</b>건
                </span>
                {dupCount > 0 && (
                  <span className="text-nd-fg-2">
                    중복 제외 <b className="nd-num text-nd-fg">{dupCount.toLocaleString("ko-KR")}</b>건
                  </span>
                )}
                {totalErrors > 0 && (
                  <span className="text-nd-danger-text">
                    읽지 못한 행 <b className="nd-num">{totalErrors.toLocaleString("ko-KR")}</b>건
                  </span>
                )}
              </div>

              {byType.length > 0 && (
                <KpiStrip columns={byType.length <= 2 ? 2 : byType.length === 3 ? 3 : 4} className="mb-4">
                  {byType.map(([type, v]) => (
                    <KpiItem key={type} label={type} value={<Money value={v.amt} unit={false} />} hint={`${v.n}건`} />
                  ))}
                </KpiStrip>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-nd-line pt-3 text-nd-body">
                <span className="text-nd-fg-2">자동분류</span>
                <Badge tone="success">확정 {summary.confirmed}</Badge>
                <Badge tone="warning">제안됨 {summary.suggested}</Badge>
                <Badge tone="danger">검토필요 {summary.needsReview}</Badge>
                <span className="nd-num text-nd-caption text-nd-fg-3">
                  자동확정률 {Math.round(summary.autoRate * 100)}%
                </span>
              </div>
            </div>

            {/* 처음 몇 건을 실제로 보여준다 — 숫자만 보고 적재하게 하면 안 된다 */}
            {fresh.length > 0 && (
              <TableScroll className="mt-4 border-t border-nd-line">
                <Table minWidth={760} dense>
                  <thead>
                    <tr>
                      <Th className="pl-5">거래일</Th>
                      <Th>계좌</Th>
                      <Th>유형</Th>
                      <Th>거래처</Th>
                      <Th align="right">금액</Th>
                      <Th>자동분류</Th>
                      <Th className="pr-5">근거</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {fresh.slice(0, 12).map((p, i) => (
                      <Tr key={i}>
                        <Td className="nd-num whitespace-nowrap pl-5 text-nd-fg-2">{p.row.date}</Td>
                        <Td muted className="nd-num whitespace-nowrap">{p.row.last4 ?? "—"}</Td>
                        <Td className="whitespace-nowrap text-nd-fg-2">
                          {p.suggestion.txType && p.suggestion.txType !== p.row.txType ? (
                            <span className="text-nd-accent-strong" title={`원본 ${p.row.txType} → 교정`}>
                              {p.suggestion.txType}<span className="text-nd-fg-3"> ←{p.row.txType}</span>
                            </span>
                          ) : (
                            p.row.txType
                          )}
                        </Td>
                        <Td className="max-w-[160px] truncate font-medium text-nd-fg" title={p.row.vendor ?? undefined}>
                          {p.row.vendor ?? "—"}
                        </Td>
                        <Td num className="whitespace-nowrap"><Money value={netAmount(p.row)} unit={false} /></Td>
                        <Td className="whitespace-nowrap">
                          <Badge tone={STATUS_TONE[p.suggestion.status]} size="sm">{STATUS_LABEL[p.suggestion.status]}</Badge>
                          {p.suggestion.acctMinor && (
                            <span className="ml-1.5 text-nd-caption text-nd-fg-2">{p.suggestion.acctMinor}</span>
                          )}
                        </Td>
                        <Td className="max-w-[220px] truncate pr-5 text-nd-caption text-nd-fg-3" title={p.suggestion.classReason}>
                          {p.suggestion.classReason}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                {fresh.length > 12 && (
                  <TableNote className="border-t border-nd-line px-5 py-2">
                    … 외 {(fresh.length - 12).toLocaleString("ko-KR")}건
                  </TableNote>
                )}
              </TableScroll>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-nd-line px-5 py-4">
              {progress && (
                <LoadingState size="inline" label={`${progress.label} — ${progress.done}/${progress.total}`} />
              )}
              <Button onClick={commit} loading={busy} disabled={fresh.length === 0}>
                {`${fresh.length.toLocaleString("ko-KR")}건 적재`}
              </Button>
            </div>
          </Card>
        </section>
      )}

      {/* ---- 적재 이력 ---- */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader title="적재 이력" hint="파일 단위로 통째 되돌릴 수 있습니다" />
        </div>
        {imports.length === 0 ? (
          <p className="px-5 pb-8 pt-2 text-center text-nd-body text-nd-fg-3">아직 적재 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            {imports.slice(0, 20).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-nd-body">
                <span className="min-w-0">
                  <span className="font-medium text-nd-fg">{b.fileName}</span>
                  <span className="ml-2 text-nd-caption text-nd-fg-2">
                    {b.inserted.toLocaleString("ko-KR")}건 적재
                    {b.skipped > 0 && ` · 중복 ${b.skipped}건 제외`}
                    {b.createdAt && ` · ${formatTimestamp(b.createdAt)}`}
                  </span>
                </span>
                <Button variant="ghost" size="sm" icon={Undo2} disabled={busy} onClick={() => undo(b.id)}>
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
//  단계 제목 — 번호 원 + 제목 + 힌트 (공통화 후보: Stepper)
// ============================================================

function StepHeader({ n, title, hint, done = false }: { n: number; title: string; hint?: string; done?: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        aria-hidden
        className={cn(
          "nd-num inline-flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full text-nd-caption font-semibold",
          done ? "bg-nd-success text-white" : "bg-nd-accent text-white",
        )}
      >
        {n}
      </span>
      <h2 className="text-nd-section text-nd-fg">
        <span className="sr-only">{n}단계 </span>
        {title}
      </h2>
      {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
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

  let statusLine: ReactNode = null;
  if (entry.status === "reading") statusLine = <LoadingState size="inline" label="읽는 중…" />;
  else if (entry.status === "password") statusLine = "암호가 걸린 파일입니다 — 비밀번호를 입력하세요.";
  else if (entry.status === "error") statusLine = <span className="text-nd-danger-text">{entry.error}</span>;
  else if (entry.status === "ready" && r)
    statusLine = (
      <>
        <b className="font-medium text-nd-fg">{r.adapterLabel}</b> · 시트 {r.sheetName} · 헤더{" "}
        {r.headerRowNo}행 · {r.rows.length.toLocaleString("ko-KR")}행
        {rowCount !== freshCount && ` (새 거래 ${freshCount}건)`}
        {r.errors.length > 0 && (
          <span className="text-nd-danger-text"> · 읽지 못한 행 {r.errors.length}건</span>
        )}
      </>
    );

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-nd-body font-semibold text-nd-fg">
            <span className="min-w-0 break-all">{entry.file.name}</span>
            {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
          </p>
          <p className="mt-0.5 text-nd-body text-nd-fg-2">{statusLine}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>제외</Button>
      </div>

      {/* 비밀번호 */}
      {entry.status === "password" && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="inline-block w-48">
            <Input
              type="password"
              placeholder="파일 비밀번호"
              aria-label="파일 비밀번호"
              value={pw}
              onChange={(ev) => setPw(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && pw) onUpdate({ password: pw });
              }}
            />
          </span>
          <Button icon={KeyRound} disabled={!pw} onClick={() => onUpdate({ password: pw })}>
            열기
          </Button>
          <span className="text-nd-caption text-nd-fg-3">
            비밀번호는 파일을 푸는 데만 쓰이고 저장되지 않습니다.
          </span>
        </div>
      )}

      {/* 출처·계좌·환율 조정 */}
      {(entry.status === "ready" || entry.status === "error") && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-nd-line pt-3">
          <Field label="출처" className="w-56">
            <Select
              size="sm"
              value={entry.adapterId ?? r?.adapterId ?? ""}
              onChange={(ev) => onUpdate({ adapterId: ev.target.value })}
            >
              <option value="">(자동 감지)</option>
              {ADAPTERS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="계좌·카드"
            className="w-64"
            error={needsAccount ? "파일에 없음 — 선택 필요" : undefined}
          >
            <Select
              size="sm"
              value={entry.last4 ?? ""}
              onChange={(ev) => onUpdate({ last4: ev.target.value || undefined })}
              aria-invalid={needsAccount ? true : undefined}
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
            </Select>
          </Field>

          {r?.needs.fxCurrency && (
            <Field
              label={`${r.needs.fxCurrency} 환율 (${r.needs.fxRows}건)`}
              className="w-32"
              error={needsFx ? "입력 전에는 적재되지 않음" : undefined}
            >
              <Input
                size="sm"
                type="number"
                placeholder="예: 1380"
                value={rate}
                onChange={(ev) => setRate(ev.target.value)}
                onBlur={() => rate !== (entry.fxRate ?? "") && onUpdate({ fxRate: rate })}
                aria-invalid={needsFx ? true : undefined}
              />
            </Field>
          )}
        </div>
      )}

      {/* 경고 */}
      {r && r.warnings.length > 0 && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mt-3 text-nd-caption">
          <ul className="space-y-1">
            {r.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </InlineNotice>
      )}

      {/* 읽지 못한 행 */}
      {r && r.errors.length > 0 && (
        <details className="mt-3 rounded-nd-md bg-nd-danger-soft px-3.5 py-2.5 text-nd-danger-text">
          <summary className="cursor-pointer text-nd-caption font-medium">
            읽지 못한 행 {r.errors.length}건 보기
          </summary>
          <ul className="nd-scroll mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-nd-caption">
            {r.errors.slice(0, 40).map((x, i) => (
              <li key={i}><b className="nd-num">{x.rowNo}행</b> — {x.reason}</li>
            ))}
            {r.errors.length > 40 && <li className="opacity-70">… 외 {r.errors.length - 40}건</li>}
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
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-nd-body font-semibold text-nd-fg">
            <span className="min-w-0 break-all">{entry.file.name}</span>
            <Badge tone={KIND_BADGE.pos.tone}>{pos.sourceLabel} · 대사용</Badge>
          </p>
          <p className="mt-0.5 text-nd-body text-nd-fg-2">
            {pos.store} · {pos.period} · {pos.summary.count}건
            {unit.acctMinor && <span className="text-nd-fg-3"> → 계정 {unit.acctMinor}</span>}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>제외</Button>
      </div>

      <InlineNotice tone="success" icon={Info} className="mt-3 text-nd-caption">
        <b>이 파일은 적재하지 않습니다.</b> 매출은 이미 정산 입금(카드사 정산 · Npay정산)으로 장부에
        들어와 있어서, 여기서 또 넣으면 매출이 두 번 잡힙니다. 대신 아래처럼 <b>맞춰 봅니다</b> —
        차이가 결제 수수료와 미정산분입니다.
      </InlineNotice>

      {acctOptions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="맞춰볼 매출 계정" className="w-full max-w-md">
            <Select size="sm" value={unit.acctMinor ?? ""} onChange={(ev) => setAcct(ev.target.value)}>
              <option value="">(선택)</option>
              {acctOptions.map(([name, v]) => (
                <option key={name} value={name}>
                  {name} — 같은 기간 {v.n}건 {v.amt.toLocaleString("ko-KR")}원
                </option>
              ))}
            </Select>
          </Field>
          <span className="pb-1.5 text-nd-caption text-nd-fg-3">
            같은 기간 장부에 잡힌 매출 계정들입니다. 금액이 가까운 쪽이 대개 맞습니다.
          </span>
        </div>
      )}

      <KpiStrip columns={4} className="mt-3">
        <KpiItem label={`${pos.sourceLabel} 실매출`} value={<Money value={rec.posNet} unit={false} />} hint={`${rec.posCount}건`} />
        <KpiItem
          label="장부 매출"
          value={<Money value={rec.ledgerSales} unit={false} />}
          hint={`${rec.ledgerCount}건 · ${unit.acctMinor ?? "계정 미선택"}`}
        />
        <KpiItem
          label="차이 (장부 − 원본)"
          value={<Money value={rec.gap} unit={false} />}
          hint={`${(rec.gapRate * 100).toFixed(1)}% · 수수료·미정산`}
        />
        <KpiItem
          label={rec.cardPortion > 0 ? "카드 결제분" : "간편결제분"}
          value={<Money value={rec.cardPortion > 0 ? rec.cardPortion : pos.byMethod.easy} unit={false} />}
          hint={`현금 ${rec.cashPortion.toLocaleString("ko-KR")}`}
        />
      </KpiStrip>

      {pos.summary.refund > 0 && (
        <p className="mt-2 text-nd-caption text-nd-fg-2">
          환불 {pos.summary.refundCount}건 <Money value={pos.summary.refund} unit={false} />원 —
          장부에서는 환급 또는 매출 차감으로 잡혀 있어야 합니다.
        </p>
      )}
      {(pos.warnings.length > 0 || !unit.acctMinor) && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mt-2 text-nd-caption">
          <ul className="space-y-0.5">
            {pos.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {!unit.acctMinor && <li>맞춰볼 매출 계정을 고르지 않아 장부와 대조하지 못했습니다.</li>}
          </ul>
        </InlineNotice>
      )}
    </Card>
  );
}
