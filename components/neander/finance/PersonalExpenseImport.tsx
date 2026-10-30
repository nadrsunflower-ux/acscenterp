"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, RefreshCw, Trash2, Upload, X } from "lucide-react";
import {
  Badge, Button, Card, Checkbox, Disclosure, DropZone, EmptyState, Field, Input,
  InlineNotice, KpiStrip, LoadingState, Money, SectionHeader, Select, StatTile,
  Table, TableScroll, Td, Th, Tr, useConfirm, useToast,
} from "@/components/neander/ui";
import { useFinance } from "./FinanceProvider";
import { AccountPicker } from "./AccountPicker";
import { decryptFinanceFile } from "@/lib/neander/finance/client";
import { looksEncrypted, readWorkbook } from "@/lib/neander/finance/adapters";
import {
  parsePersonalExpenseWorkbook, suggestPersonalExpenseRows,
  type PersonalExpenseParseResult,
} from "@/lib/neander/finance/personal-expense-import";
import {
  expenseClaimCandidates, expenseClaimSummary, MAX_EXPENSE_CLAIM_ROWS,
  type ExpenseClaimDoc, type ExpenseClaimRow,
} from "@/lib/neander/finance/expense-claims";
import {
  cancelExpenseClaim, fetchExpenseClaims, importExpenseClaim,
  linkExpenseClaimSettlement, unlinkExpenseClaimSettlement,
} from "@/lib/neander/finance/expense-claims-client";
import { BIZ_MAJORS } from "@/lib/neander/finance/sheet";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";

interface PreviewRow {
  row: ExpenseClaimRow;
  selected: boolean;
  duplicateCandidates: { id: string; date: string; vendor?: string; gross: number; reason?: string }[];
  warnings: string[];
}
interface Preview {
  fileName: string;
  fileHash: string;
  result: PersonalExpenseParseResult;
  rows: PreviewRow[];
}
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const errorText = (e: unknown) => e instanceof Error ? e.message : "요청을 완료하지 못했습니다.";

export function PersonalExpenseImport({ initialFile, onInitialFileConsumed }: {
  initialFile?: File | null;
  onInitialFileConsumed?: () => void;
}) {
  const { accounts, paymentMethods, projects, transactions, loading, applyTransactions } = useFinance();
  const confirm = useConfirm();
  const toast = useToast();
  const [payer, setPayer] = useState("");
  const [site, setSite] = useState("");
  const [paymentLabel, setPaymentLabel] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"reading" | "importing" | "changing" | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [claims, setClaims] = useState<ExpenseClaimDoc[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [activeId, setActiveId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const operation = useRef(false);
  const mounted = useRef(true);
  const listRequest = useRef<AbortController | null>(null);
  const source = useRef<File | null>(null);
  const consumed = useRef<File | null>(null);

  const loadClaims = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setClaimsLoading(true);
    try {
      const list = await fetchExpenseClaims(controller.signal);
      if (!controller.signal.aborted && mounted.current) {
        setClaims(list);
        setClaimsError(null);
      }
    } catch (e) {
      if (!controller.signal.aborted && mounted.current) setClaimsError(errorText(e));
    } finally {
      if (listRequest.current === controller) {
        listRequest.current = null;
        if (mounted.current) setClaimsLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void loadClaims();
    return () => { mounted.current = false; listRequest.current?.abort(); };
  }, [loadClaims]);
  useEffect(() => {
    if (phase !== "importing" && phase !== "changing") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const readFile = useCallback(async (file: File, secret?: string) => {
    if (operation.current || loading) return;
    operation.current = true;
    source.current = file;
    setPhase("reading"); setError(null); setPreview(null); setNeedsPassword(false);
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error("개인 결제 명세서 엑셀(.xlsx, .xls)을 선택하세요.");
      const original = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", original);
      const fileHash = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
      const bytes = looksEncrypted(original) ? await decryptFinanceFile(file, secret) : original;
      const result = parsePersonalExpenseWorkbook(readWorkbook(bytes));
      const suggested = suggestPersonalExpenseRows(result.rows, accounts, projects, transactions);
      if (mounted.current) {
        setPreview({ fileName: file.name, fileHash, result, rows: suggested.rows.map((item) => {
          const { duplicateCandidates = [], warnings = [], ...row } = item;
          return { row, duplicateCandidates, warnings, selected: duplicateCandidates.length === 0 };
        }) });
        setPassword("");
      }
    } catch (e) {
      if (mounted.current) {
        setNeedsPassword(Boolean((e as { needsPassword?: boolean })?.needsPassword));
        setError(errorText(e));
      }
    } finally {
      operation.current = false;
      if (mounted.current) setPhase(null);
    }
  }, [accounts, projects, transactions, loading]);
  useEffect(() => {
    if (!initialFile || initialFile === consumed.current || operation.current || loading) return;
    consumed.current = initialFile;
    void readFile(initialFile);
    onInitialFileConsumed?.();
  }, [initialFile, onInitialFileConsumed, readFile, loading, phase]);

  const sites = useMemo(() => [...new Set(paymentMethods.map((p) => p.site).filter(Boolean))].sort(), [paymentMethods]);
  const refundAccounts = useMemo(() => [...accounts, ...accounts.filter((a) => a.txType === "지출").map((a) => ({ ...a, txType: "환급" }))], [accounts]);
  const businessNames = useMemo(() => [...new Set(transactions.map((t) => t.bizMinor).filter((s): s is string => !!s))].sort(), [transactions]);
  const selected = preview?.rows.filter((p) => p.selected) ?? [];
  const selectedTotal = selected.reduce((sum, p) => sum + (p.row.txType === "환급" ? -p.row.gross : p.row.gross), 0);
  const invalidRows = selected.filter(({ row }) => !BIZ_MAJORS.includes(row.bizMajor as typeof BIZ_MAJORS[number]) || !row.bizMinor?.trim() ||
    !accounts.some((a) => a.active !== false && (a.txType === row.txType || (row.txType === "환급" && a.txType === "지출")) && a.major === row.acctMajor && a.mid === row.acctMid && a.minor === row.acctMinor) ||
    (row.projectCode && !projects.some((p) => p.code === row.projectCode)));
  const changeRow = (index: number, patch: Partial<ExpenseClaimRow>) => setPreview((p) => p ? {
    ...p, rows: p.rows.map((r, i) => i === index ? { ...r, row: { ...r.row, ...patch } } : r),
  } : p);
  const toggleRow = (index: number, checked: boolean) => setPreview((p) => p ? {
    ...p, rows: p.rows.map((r, i) => i === index ? { ...r, selected: checked } : r),
  } : p);

  const importSelected = async () => {
    if (operation.current || !preview || !selected.length || selected.length > MAX_EXPENSE_CLAIM_ROWS || invalidRows.length || !payer.trim() || !site) return;
    operation.current = true; setPhase("importing"); setError(null);
    try {
      const duplicates = selected.filter((p) => p.duplicateCandidates.length > 0).length;
      if (duplicates && !await confirm({ title: "중복 후보를 포함해 등록할까요?", message: `기존 거래와 겹칠 수 있는 ${duplicates}건을 직접 선택했습니다. 선택한 회사 비용 ${selected.length}건, 순액 ${won(selectedTotal)}원을 등록합니다.`, confirmLabel: "선택 내역 등록" })) return;
      const result = await importExpenseClaim({ payer: payer.trim(), site, paymentLabel: paymentLabel.trim() || undefined,
        fileName: preview.fileName, fileHash: preview.fileHash, rows: selected.map((p) => p.row) });
      applyTransactions({ upsert: result.transactions });
      if (!mounted.current) return;
      setActiveId(result.claim.id); setCandidateId(""); setPreview(null); source.current = null;
      toast.success(`대납 비용 ${result.inserted}건 등록 · 기존 ${result.skipped}건 제외`);
      await loadClaims();
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { operation.current = false; if (mounted.current) setPhase(null); }
  };

  const summaries = useMemo(() => new Map(claims.map((c) => [c.id, expenseClaimSummary(c, transactions, paymentMethods)])), [claims, transactions, paymentMethods]);
  const activeClaim = claims.find((c) => c.id === activeId);
  const summary = activeClaim ? summaries.get(activeClaim.id) : undefined;
  const candidates = useMemo(() => activeClaim ? expenseClaimCandidates(activeClaim, transactions, paymentMethods) : [], [activeClaim, transactions, paymentMethods]);
  const alias = (tx: FinTransaction) => {
    const method = paymentMethods.find((p) => p.last4 === tx.last4);
    return method ? `${method.site} ${method.alias} (${method.last4})` : tx.last4 ?? "계좌 미확인";
  };
  const visibleCandidates = candidates.filter((tx) => `${tx.date} ${tx.vendor ?? ""} ${tx.note ?? ""} ${alias(tx)} ${netAmount(tx)}`.toLowerCase().includes(candidateQuery.trim().toLowerCase()));
  const chosen = candidates.find((tx) => tx.id === candidateId);

  const settlement = async (claim: ExpenseClaimDoc, tx: FinTransaction, unlink = false) => {
    if (operation.current) return;
    operation.current = true; setPhase("changing"); setClaimsError(null);
    try {
      const ok = await confirm({ title: unlink ? "상환 연결을 해제할까요?" : "실제 출금 전체를 상환으로 연결할까요?",
        message: `${claim.payer} · ${claim.site}\n${tx.date} ${alias(tx)} ${tx.vendor ?? ""} ${won(netAmount(tx))}원\n${unlink ? "비용과 은행 거래를 유지하고 이 대납 건의 상환 연결을 해제합니다." : "선택한 기존 은행 출금의 전체 금액을 이 대납 건의 상환으로 기록합니다."}`,
        confirmLabel: unlink ? "연결 해제" : "상환 연결" });
      if (!ok) return;
      const result = unlink ? await unlinkExpenseClaimSettlement(claim.id, tx.id) : await linkExpenseClaimSettlement(claim.id, tx.id);
      applyTransactions({ upsert: result.transactions });
      if (mounted.current) { setCandidateId(""); toast.success(unlink ? "상환 연결을 해제했습니다." : "실제 출금을 상환 내역에 연결했습니다."); }
    } catch (e) { if (mounted.current) setClaimsError(errorText(e)); }
    finally { operation.current = false; if (mounted.current) setPhase(null); }
  };
  const cancel = async (claim: ExpenseClaimDoc) => {
    if (operation.current) return;
    operation.current = true; setPhase("changing"); setClaimsError(null);
    try {
      if (!await confirm({ title: "대납 비용 등록을 취소할까요?", message: `${claim.payer} · ${claim.fileName}\n이 명세서에서 등록한 대납 비용을 원장에서 삭제합니다.`, confirmLabel: "등록 취소", tone: "danger" })) return;
      const result = await cancelExpenseClaim(claim.id);
      applyTransactions({ remove: result.removedIds, upsert: result.transactions });
      if (!mounted.current) return;
      setActiveId(""); toast.success(`대납 비용 ${result.removed}건 등록을 취소했습니다.`);
      await loadClaims();
    } catch (e) { if (mounted.current) setClaimsError(errorText(e)); }
    finally { operation.current = false; if (mounted.current) setPhase(null); }
  };

  return (
    <section id="personal-expenses" className="scroll-mt-24 flex flex-col gap-4">
      <Card padding="sm">
        <SectionHeader title="개인 결제 · 회사 비용 대납" hint="명세서를 먼저 확인한 뒤 회사 비용만 골라 등록하고, 실제 은행 상환 내역을 연결합니다." />
        {error && <InlineNotice tone="danger" className="mb-3"><span className="whitespace-pre-line">{error}</span></InlineNotice>}
        <fieldset disabled={!!phase} className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="먼저 결제한 사람" hint="실제 결제자 이름"><Input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="이름 입력" /></Field>
          <Field label="비용을 부담할 사업체"><Select value={site} onChange={(e) => setSite(e.target.value)}><option value="">사업체 선택</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="결제수단 설명 (선택)" hint="카드번호 없이도 등록할 수 있습니다"><Input value={paymentLabel} onChange={(e) => setPaymentLabel(e.target.value)} placeholder="예: 개인 삼성카드" /></Field>
        </fieldset>
        <fieldset disabled={!!phase || loading} className="min-w-0"><DropZone accept=".xlsx,.xls" disabled={!!phase || loading} busy={phase === "reading"} compact={!!preview} icon={Upload}
          title={phase === "reading" ? "명세서를 확인하는 중…" : "개인 결제 명세서 미리보기"} hint="엑셀 파일을 선택하세요. 회사 비용을 확인한 뒤 등록합니다."
          onFiles={(files) => { if (files[0]) void readFile(files[0]); }} /></fieldset>
        {needsPassword && <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="파일 열기 암호"><Input type="password" value={password} autoComplete="off" disabled={!!phase} onChange={(e) => setPassword(e.target.value)} /></Field><Button disabled={!password || !!phase} onClick={() => source.current && void readFile(source.current, password)}>암호로 미리보기</Button></div>}
      </Card>

      {preview && <Card padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <SectionHeader title={preview.fileName} hint={`${preview.result.from ?? ""}${preview.result.to ? ` ~ ${preview.result.to}` : ""} · 확인된 거래 ${preview.rows.length}건`}
            action={<Button variant="ghost" size="sm" icon={X} disabled={!!phase} onClick={() => { setPreview(null); source.current = null; setError(null); }}>미리보기 닫기</Button>} />
          <KpiStrip columns={3}><StatTile label="파일에서 읽은 비용 순액" value={preview.result.actualTotal} flow="expense" /><StatTile label="선택한 회사 비용" value={selectedTotal} flow="expense" hint={`${selected.length}건`} /><StatTile label="파일 합계 표시" value={preview.result.declaredTotal ?? 0} hint={preview.result.declaredTotal === undefined ? "합계 표시 없음" : `${preview.result.declaredCount ?? "미기재"}건으로 표시`} /></KpiStrip>
          {preview.result.warnings.map((message, i) => <InlineNotice key={i} tone="warning">{message}</InlineNotice>)}
          {preview.result.errors.map((item, i) => <InlineNotice key={i} tone="danger">{item.rowNo}행: {item.message}</InlineNotice>)}
          <p className="text-nd-table text-nd-fg-2">회사 비용만 선택하세요. 기존 거래와 겹칠 수 있는 행은 선택을 해제해 두었습니다. 같은 날 같은 금액의 다른 결제는 각 행으로 유지됩니다.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={!!phase} onClick={() => setPreview((p) => p ? { ...p, rows: p.rows.map((r) => ({ ...r, selected: !r.duplicateCandidates.length })) } : p)}>중복 후보 제외 모두 선택</Button><Button size="sm" variant="ghost" disabled={!!phase} onClick={() => setPreview((p) => p ? { ...p, rows: p.rows.map((r) => ({ ...r, selected: false })) } : p)}>모두 해제</Button></div>
        </div>
        <fieldset disabled={!!phase} className="min-w-0">
          <TableScroll maxHeight={580}><Table minWidth={1300} dense>
            <thead><tr><Th>선택</Th><Th>원본 행 · 날짜</Th><Th>결제 내역 · 원본 메모</Th><Th align="right">금액</Th><Th>실제 비용 계정</Th><Th>사업 구분</Th><Th>프로젝트 (선택)</Th></tr></thead>
            <tbody>{preview.rows.map((item, index) => <Tr key={`${item.row.rowNo}:${index}`}>
              <Td><Checkbox aria-label={`${item.row.rowNo}행 회사 비용 선택`} checked={item.selected} onChange={(e) => toggleRow(index, e.target.checked)} /></Td>
              <Td className="whitespace-nowrap"><span className="text-nd-fg-3">{item.row.rowNo}행</span><br />{item.row.date}<br /><Badge size="sm" tone={item.row.txType === "환급" ? "info" : "neutral"}>{item.row.txType}</Badge></Td>
              <Td className="min-w-[16rem] max-w-[24rem]"><span className="font-medium">{item.row.vendor}</span>{item.row.note && <p className="mt-1 whitespace-pre-wrap break-words text-nd-fg-2">{item.row.note}</p>}<p className="mt-1 text-nd-caption text-nd-fg-3">원본 계정: {item.row.accountText || "없음"} · 프로젝트: {item.row.projectText || "없음"}{item.row.paymentLabel ? ` · ${item.row.paymentLabel}` : ""}</p>{item.warnings.map((w, i) => <p key={i} className="mt-1 text-nd-warning-text">{w}</p>)}{item.duplicateCandidates.map((c) => <p key={c.id} className="mt-1 text-nd-warning-text">중복 후보: {c.date} {c.vendor} {won(c.gross)}원{c.reason ? ` · ${c.reason}` : ""}</p>)}</Td>
              <Td num><Money value={item.row.txType === "환급" ? -item.row.gross : item.row.gross} unit={false} flow="expense" /></Td>
              <Td className="min-w-[19rem]"><AccountPicker compact accounts={item.row.txType === "환급" ? refundAccounts : accounts} txType={item.row.txType} value={item.row} onChange={(value) => changeRow(index, value)} />{!item.row.acctMinor && <p className="mt-1 text-nd-warning-text">실제 계정 선택 필요</p>}</Td>
              <Td className="min-w-[9rem]"><Select size="sm" aria-label={`${item.row.rowNo}행 사업대분류`} value={item.row.bizMajor ?? ""} onChange={(e) => changeRow(index, { bizMajor: e.target.value || undefined, bizMinor: ["공용", "해당없음"].includes(e.target.value) ? e.target.value : undefined })}><option value="">사업 구분 선택</option>{BIZ_MAJORS.map((m) => <option key={m} value={m}>{m}</option>)}</Select><Input size="sm" className="mt-1" aria-label={`${item.row.rowNo}행 사업소분류`} list="personal-expense-businesses" value={item.row.bizMinor ?? ""} onChange={(e) => changeRow(index, { bizMinor: e.target.value || undefined })} placeholder="사업소분류" /></Td>
              <Td className="min-w-[11rem]"><Select size="sm" aria-label={`${item.row.rowNo}행 프로젝트`} value={item.row.projectCode ?? ""} onChange={(e) => changeRow(index, { projectCode: e.target.value || undefined })}><option value="">프로젝트 없음</option>{projects.map((p) => <option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}</Select></Td>
            </Tr>)}</tbody>
          </Table></TableScroll>
        </fieldset>
        <datalist id="personal-expense-businesses">{businessNames.map((name) => <option key={name} value={name} />)}</datalist>
        <div className="flex flex-col items-start gap-3 border-t border-nd-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <span className="text-nd-table text-nd-fg-2">{selected.length > MAX_EXPENSE_CLAIM_ROWS ? `한 번에 ${MAX_EXPENSE_CLAIM_ROWS}건까지 등록할 수 있습니다. 회사 비용을 나누어 선택하세요.` : invalidRows.length ? `선택한 ${invalidRows.length}건의 실제 계정·사업 구분을 확인하세요.` : !payer.trim() || !site ? "결제자와 비용 부담 사업체를 입력하세요." : `${selected.length}건 · ${won(selectedTotal)}원 등록 예정`}</span>
          <Button icon={Upload} loading={phase === "importing"} disabled={!!phase || !selected.length || selected.length > MAX_EXPENSE_CLAIM_ROWS || invalidRows.length > 0 || !payer.trim() || !site} onClick={() => void importSelected()}>선택 {selected.length}건 비용 등록</Button>
        </div>
      </Card>}

      <Card padding="sm">
        <SectionHeader title="대납 비용 · 실제 상환" hint="비용 등록액과 실제 은행 출금으로 확인한 상환액을 구분합니다."
          action={<Button size="sm" variant="ghost" icon={RefreshCw} disabled={!!phase || claimsLoading} onClick={() => void loadClaims()}>새로고침</Button>} />
        {claimsError && <InlineNotice tone="danger" className="mb-3">{claimsError}</InlineNotice>}
        {claimsLoading ? <LoadingState label="대납 내역을 불러오는 중…" /> : !claims.length ? <EmptyState compact title="등록한 개인 대납 비용이 없습니다" /> : <TableScroll><Table minWidth={720} dense><thead><tr><Th>결제자 · 명세서</Th><Th>사업체</Th><Th align="right">비용 순액</Th><Th align="right">상환액</Th><Th align="right">미상환</Th><Th /></tr></thead><tbody>{claims.map((claim) => {
          const s = summaries.get(claim.id)!;
          return <Tr key={claim.id}><Td><span className="font-medium">{claim.payer}</span><p className="text-nd-caption text-nd-fg-3">{claim.fileName}</p></Td><Td>{claim.site}</Td><Td num><Money value={s.total} unit={false} flow="expense" /></Td><Td num><Money value={s.settled} unit={false} /></Td><Td num><Money value={s.remaining} unit={false} />{s.overpaid > 0 && <p className="text-nd-warning-text">초과 {won(s.overpaid)}</p>}</Td><Td><Button size="sm" variant={activeId === claim.id ? "secondary" : "ghost"} disabled={!!phase} onClick={() => { setActiveId(claim.id); setCandidateId(""); setCandidateQuery(""); }}>내역 보기</Button></Td></Tr>;
        })}</tbody></Table></TableScroll>}
      </Card>

      {activeClaim && summary && <Card padding="sm">
        <SectionHeader title={`${activeClaim.payer} · ${activeClaim.fileName}`} hint={`${activeClaim.site}${activeClaim.paymentLabel ? ` · ${activeClaim.paymentLabel}` : ""}`}
          action={<Button size="sm" variant="ghost" icon={Trash2} disabled={!!phase || summary.settlements.length > 0} onClick={() => void cancel(activeClaim)}>비용 등록 취소</Button>} />
        <KpiStrip columns={3}><StatTile label="비용 순액" value={summary.total} flow="expense" /><StatTile label="실제 상환" value={summary.settled} /><StatTile label="미상환" value={summary.remaining} tone={summary.remaining > 0 ? "warning" : undefined} hint={summary.overpaid ? `초과 상환 ${won(summary.overpaid)}원` : summary.remaining === 0 && summary.total > 0 ? "실제 은행 출금 연결 기준" : "상환 출금 내역을 연결하세요"} /></KpiStrip>
        {summary.invalidSettlements.length > 0 && <InlineNotice tone="warning" className="mt-3">연결된 출금 {summary.invalidSettlements.length}건의 계정·거래유형 또는 계좌 정보가 변경되어 상환액 집계에서 제외했습니다. 은행 거래를 확인하거나 상환 연결을 해제하세요.</InlineNotice>}
        {summary.expenses.some((tx) => tx.personalUse) && <InlineNotice tone="info" className="mt-3">원장에서 개인 사용으로 변경한 행은 아래 원본 내역에 남지만 회사 비용 순액과 미상환액에서 제외됩니다.</InlineNotice>}
        <Disclosure title={`등록된 비용 ${summary.expenses.length}건`} className="mt-4"><TableScroll><Table minWidth={640} dense><thead><tr><Th>원본 행 · 날짜</Th><Th>거래처</Th><Th align="right">비용</Th><Th>계정 · 프로젝트 · 메모</Th></tr></thead><tbody>{summary.expenses.map((tx) => <Tr key={tx.id}><Td>{tx.expenseClaim?.rowNo}행 · {tx.date}</Td><Td>{tx.vendor}</Td><Td num><Money value={tx.txType === "환급" ? -netAmount(tx) : netAmount(tx)} unit={false} flow="expense" /></Td><Td className="whitespace-pre-wrap">{[tx.acctMajor, tx.acctMid, tx.acctMinor].filter(Boolean).join(" › ")}<br />{tx.projectCode || "프로젝트 없음"}{tx.note ? ` · ${tx.note}` : ""}</Td></Tr>)}</tbody></Table></TableScroll></Disclosure>
        <div className="mt-4 flex flex-col gap-3">
          <SectionHeader title="연결한 은행 상환 내역" />
          {summary.settlements.length === 0 ? <p className="text-nd-table text-nd-fg-3">아직 연결한 실제 상환 출금이 없습니다.</p> : summary.settlements.map((tx) => <div key={tx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-nd-md bg-nd-sunken p-3 text-nd-table"><span>{tx.date} · {alias(tx)} · {tx.vendor} · {won(netAmount(tx))}원</span><Button size="sm" variant="ghost" disabled={!!phase} onClick={() => void settlement(activeClaim, tx, true)}>연결 해제</Button></div>)}
          {summary.remaining > 0 && <>
            <p className="text-nd-table text-nd-fg-2">가수금 지급으로 분류된 통장 출금 중 이 사람에게 실제로 상환한 거래를 선택하세요. 선택한 출금 전체 금액을 연결합니다.</p>
            <Input aria-label="상환 출금 후보 검색" value={candidateQuery} disabled={!!phase} onChange={(e) => { setCandidateQuery(e.target.value); setCandidateId(""); }} placeholder="결제자 이름 · 날짜 · 금액 · 계좌로 검색" />
            <Select aria-label="실제 상환 출금 선택" value={candidateId} disabled={!!phase} onChange={(e) => setCandidateId(e.target.value)}><option value="">실제 은행 출금 선택 ({visibleCandidates.length}건)</option>{visibleCandidates.map((tx) => <option key={tx.id} value={tx.id}>{tx.date} · {alias(tx)} · {tx.vendor} · {won(netAmount(tx))}원</option>)}</Select>
            {!candidates.length && <InlineNotice tone="info">연결할 수 있는 실제 출금이 없습니다. 은행 거래와 가수금 지급 분류를 확인하세요.</InlineNotice>}
            <div><Button size="sm" icon={Link2} disabled={!!phase || !chosen} onClick={() => chosen && void settlement(activeClaim, chosen)}>선택한 실제 출금을 상환으로 연결</Button></div>
          </>}
        </div>
      </Card>}
    </section>
  );
}
