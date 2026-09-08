"use client";

// ============================================================
//  프로젝트 손익 — 상세 (체크리스트 + 계약금액 + 손익)
// ------------------------------------------------------------
//  엑셀 체크리스트를 화면으로 옮긴 것이다. 분류별로 묶인 표에 수량·단가를
//  넣으면 견적금액이 굴러가고, 위에 계약금액과 이익이 바로 보인다.
//
//  편집은 예산 화면과 같은 초안 방식이다 — 셀을 고칠 때마다 서버에 쓰지
//  않고 「저장」 한 번에 프로젝트를 통째로 반영한다. 행사 준비 중에는
//  수십 줄을 연달아 고치므로 셀마다 요청을 보내면 느리고, 중간에 끊기면
//  반쯤 바뀐 표가 남는다.
//
//  「실제금액」 열은 나중에 채운다. 견적(수량×단가)은 준비할 때, 실제는
//  결제가 끝난 뒤. 안 채운 줄은 견적으로 계산하되 몇 줄이 비었는지 위에
//  적어 둔다 — 실질 이익이 "아직 견적 섞인 숫자"인지 알 수 있어야 한다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Textarea } from "@/components/neander/ui";
import { ChecklistSheet } from "@/components/neander/finance/ChecklistSheet";
import { CHECKLIST_LAYOUT_KEY, useSheetLayout } from "@/components/neander/finance/useSheetLayout";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import { deleteFinProject, saveFinProject, updateFinTransaction } from "@/lib/neander/finance/client";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import { ProjectDocs } from "@/components/neander/finance/ProjectDocs";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import { exportProjectXlsx, parseChecklistXlsx } from "@/lib/neander/finance/project-xlsx";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  VAT_LABEL,
  VAT_MODES,
  VAT_HINT,
  INSTALLMENT_KINDS,
  INSTALLMENT_STATUS_COLOR,
  INSTALLMENT_STATUS_LABEL,
  installmentStatus,
  isReceived,
  newInstallment,
  splitVat,
  type FinProjectInstallment,
  type InstallmentKind,
  type VatMode,
  formatMargin,
  groupLines,
  ledgerRowsOf,
  newLine,
  newRevenue,
  projectSummary,
  type FinProjectDoc,
  type FinProjectInput,
  type FinProjectLine,
  type FinProjectRevenue,
  type ProjectStatus,
} from "@/lib/neander/finance/project";
import { netAmount, type FinTransaction, type FinTransactionInput } from "@/lib/neander/finance/types";

/** 저장된 문서에서 편집 가능한 부분만 떼어 초안으로 쓴다 */
function toInput(p: FinProjectDoc): FinProjectInput {
  return {
    code: p.code,
    name: p.name,
    client: p.client,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    bizMinor: p.bizMinor,
    contractAmount: p.contractAmount ?? 0,
    revenues: (p.revenues ?? []).map((r) => ({ ...r })),
    lines: (p.lines ?? []).map((l) => ({ ...l })),
    note: p.note,
  };
}

/**
 * 빈 값이 된 **선택** 항목의 키를 없앤다. id·분류·품목·수량은 언제나 남긴다
 * — 줄의 정체이고, 없애면 시트 셀의 value 가 undefined 가 되어 제어를 놓는다.
 */
const KEEP_KEYS = new Set<keyof FinProjectLine>(["id", "category", "item", "qty"]);
function tidyLine(l: FinProjectLine): FinProjectLine {
  const next = { ...l };
  (Object.keys(next) as (keyof FinProjectLine)[]).forEach((k) => {
    if (KEEP_KEYS.has(k)) return;
    const v = next[k];
    if (v === undefined || v === "" || v === false || (typeof v === "number" && Number.isNaN(v))) {
      delete next[k];
    }
  });
  // 시트에서 새로 만든 행은 분류·품목이 비어 있을 수 있다 — 문자열로 맞춘다
  next.category = next.category ?? "";
  next.item = next.item ?? "";
  next.qty = Number.isFinite(next.qty) ? next.qty : 0;
  return next;
}

const cell =
  "h-7 w-full rounded border border-zinc-200 bg-white px-1.5 text-xs outline-none focus:border-indigo-500 focus:bg-indigo-50/30";
const numCell = `${cell} text-right tabular-nums`;

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const { projects, transactions, accounts, paymentMethods, loading, refresh } = useFinance();

  const saved = useMemo(() => projects.find((p) => p.id === id) ?? null, [projects, id]);
  const [draft, setDraft] = useState<FinProjectInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 원장 대조 표에서 열어 둔 거래 — 그 자리에서 고친다 */
  const [editingTx, setEditingTx] = useState<FinTransaction | null>(null);
  /** 프로젝트에 없는 거래를 찾아 붙이는 칸 */
  const [attachQuery, setAttachQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  /** 지출 시트의 열 너비·행 높이·배율 (원장과 따로 남는다) */
  const sheetLayout = useSheetLayout(CHECKLIST_LAYOUT_KEY);

  // 다른 프로젝트로 옮기면 초안을 버린다
  useEffect(() => {
    setDraft(null);
    setNotice(null);
  }, [id]);

  const form: FinProjectInput | null = draft ?? (saved ? toInput(saved) : null);
  const dirty = useMemo(
    () => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(toInput(saved)),
    [draft, saved],
  );

  // 떠나기 전 경고 — 저장 안 한 체크리스트가 날아가면 다시 적어야 한다
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const summary = useMemo(
    () => (form ? projectSummary(form, transactions) : null),
    [form, transactions],
  );
  const groups = useMemo(() => (form ? groupLines(form.lines) : []), [form]);
  const ledgerRows = useMemo(
    () => (form ? ledgerRowsOf(transactions, form.code) : []),
    [transactions, form],
  );

  /** 사업소분류 후보 — 원장에 있는 값 */
  const bizMinors = useMemo(() => {
    const s = new Set<string>();
    transactions.forEach((t) => t.bizMinor && s.add(t.bizMinor));
    return [...s].sort();
  }, [transactions]);
  // ---- 초안 조작 ---------------------------------------------

  const edit = useCallback(
    (fn: (f: FinProjectInput) => FinProjectInput) => {
      setDraft((prev) => {
        const base = prev ?? (saved ? toInput(saved) : null);
        return base ? fn(base) : prev;
      });
    },
    [saved],
  );

  const setField = <K extends keyof FinProjectInput>(k: K, v: FinProjectInput[K]) =>
    edit((f) => ({ ...f, [k]: v }));

  /**
   * 시트는 줄 배열을 통째로 돌려준다 (행 추가·삭제·붙여넣기가 모두 여기로
   * 온다). 넘어온 줄을 그대로 초안에 싣되, 빈 값이 된 선택 항목의 키는
   * 없애 저장 문서와의 비교가 어긋나지 않게 한다.
   */
  const setLines = useCallback(
    (next: FinProjectLine[]) => edit((f) => ({ ...f, lines: next.map(tidyLine) })),
    [edit],
  );

  const updateInstallment = (iid: string, patch: Partial<FinProjectInstallment>) =>
    edit((f) => ({
      ...f,
      installments: (f.installments ?? []).map((i) => (i.id === iid ? { ...i, ...patch } : i)),
    }));
  const removeInstallment = (iid: string) =>
    edit((f) => ({ ...f, installments: (f.installments ?? []).filter((i) => i.id !== iid) }));
  /**
   * 새 회차. 다음 단계를 짐작해 넣는다 — 선금이 있으면 중도금, 중도금까지
   * 있으면 잔금. 금액은 계약금액에서 이미 나눈 몫을 뺀 나머지를 채운다.
   */
  const addInstallment = () =>
    edit((f) => {
      const list = f.installments ?? [];
      const used = new Set(list.map((i) => i.kind));
      const kind: InstallmentKind = !used.has("선금")
        ? "선금"
        : !used.has("중도금")
          ? "중도금"
          : "잔금";
      const rest = Math.max(0, (f.contractAmount || 0) - list.reduce((n, i) => n + (i.amount || 0), 0));
      return { ...f, installments: [...list, { ...newInstallment(kind), amount: rest }] };
    });

  const updateRevenue = (rid: string, patch: Partial<FinProjectRevenue>) =>
    edit((f) => ({ ...f, revenues: f.revenues.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }));
  const removeRevenue = (rid: string) => edit((f) => ({ ...f, revenues: f.revenues.filter((r) => r.id !== rid) }));

  /** 엑셀 지출 목록을 초안 뒤에 붙인다 — 저장 전까지는 서버에 안 간다 */
  const importXlsx = async (file: File) => {
    try {
      const parsed = parseChecklistXlsx(await file.arrayBuffer());
      if (parsed.error) {
        setNotice({ kind: "error", text: parsed.error });
        return;
      }
      if (parsed.lines.length === 0) {
        setNotice({ kind: "error", text: "가져올 줄이 없습니다." });
        return;
      }
      edit((f) => ({ ...f, lines: [...f.lines, ...parsed.lines] }));
      setNotice({
        kind: "ok",
        text: `${file.name} 에서 ${parsed.lines.length}줄을 불러왔습니다${parsed.skipped ? ` (품목 없는 ${parsed.skipped}줄 건너뜀)` : ""}. 확인 후 저장하세요.`,
      });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "파일을 읽지 못했습니다." });
    }
  };

  // ---- 원장 거래 직접 손보기 -------------------------------------
  //
  //  이 화면에서 거래를 고치는 것은 **원장을 고치는 것**이다. 체크리스트와
  //  달리 초안이 없고 누르는 즉시 반영된다 — 원장은 프로젝트 문서가 아니라
  //  회사 장부라, 이 화면의 「저장」에 묶어두면 어디까지 반영됐는지 흐려진다.

  const savedCode = saved?.code ?? "";
  /** 코드를 고쳐놓고 아직 저장 안 했으면 붙이기를 막는다 — 어느 코드로 붙일지 모호하다 */
  const codeUnsaved = !!form && form.code !== savedCode;

  const patchTx = async (txId: string, patch: Partial<FinTransactionInput>, okText: string) => {
    setAttaching(true);
    setNotice(null);
    try {
      await updateFinTransaction(txId, patch);
      await refresh();
      setNotice({ kind: "ok", text: okText });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "원장 수정에 실패했습니다." });
    } finally {
      setAttaching(false);
    }
  };

  const attachTx = (t: FinTransaction) =>
    patchTx(t.id, { projectCode: savedCode }, `${t.date} ${t.vendor ?? ""} 를 ${savedCode} 에 붙였습니다.`);

  /** 떼기는 빈 문자열로 — undefined 는 JSON 에서 사라져 서버까지 못 간다 */
  const detachTx = (t: FinTransaction) =>
    patchTx(t.id, { projectCode: "" }, `${t.date} ${t.vendor ?? ""} 를 이 프로젝트에서 뗐습니다.`);

  /** 붙일 후보 — 아직 어느 프로젝트에도 안 붙은 거래에서 찾는다 */
  const attachCandidates = useMemo(() => {
    const q = attachQuery.trim().toLowerCase();
    if (!q) return [];
    return transactions
      .filter((t) => !(t.projectCode ?? "").trim())
      .filter((t) =>
        [t.vendor, t.note, t.acctNote, t.acctMinor, t.date, String(t.gross)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [transactions, attachQuery]);

  // ---- 저장 · 삭제 --------------------------------------------

  const save = async () => {
    if (!draft || !dirty) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveFinProject(draft, id);
      await refresh();
      setDraft(null);
      setNotice({ kind: "ok", text: "저장했습니다." });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    if (!window.confirm(`「${saved.name}」 프로젝트를 지웁니다. 지출 ${saved.lines?.length ?? 0}줄도 함께 사라집니다. 원장 거래는 그대로 남습니다.`)) return;
    setSaving(true);
    try {
      await deleteFinProject(id);
      await refresh();
      router.push("/neander/finance/projects");
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "삭제에 실패했습니다." });
      setSaving(false);
    }
  };

  // ---- 렌더 --------------------------------------------------

  if (loading) return <div className="px-5 py-16 text-center text-zinc-400">불러오는 중…</div>;
  if (!saved || !form || !summary) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-8">
        <EmptyState icon="🔍" title="프로젝트를 찾을 수 없습니다" description="지워졌거나 주소가 잘못됐습니다." />
        <div className="mt-4 text-center">
          <Link href="/neander/finance/projects" className="text-sm text-indigo-600 hover:underline">← 프로젝트 목록</Link>
        </div>
      </div>
    );
  }

  const unfilled = summary.lineCount - summary.actualFilled;
  /**
   * 시트 높이 — 줄 수에 맞춰 늘리되 화면을 다 먹지 않게 640px 에서 멈춘다.
   * 줄이 적을 때 빈 격자가 길게 남으면 표가 비어 보인다.
   */
  const sheetHeight = Math.min(
    640,
    Math.max(240, (form.lines.length + 1) * sheetLayout.layout.rowHeight + 44),
  );
  const ledgerNet = summary.ledger.expense - summary.ledger.refund;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-6">
      {/* ---- 머리 ---- */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/neander/finance/projects" className="text-xs text-zinc-400 hover:text-indigo-600">← 프로젝트 목록</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="min-w-[16rem] flex-1 rounded-md border border-transparent bg-transparent px-1 text-2xl font-bold tracking-tight text-zinc-900 outline-none hover:border-zinc-200 focus:border-indigo-400 focus:bg-white"
              aria-label="프로젝트 이름"
            />
            <Badge color={PROJECT_STATUS_COLOR[form.status]}>{PROJECT_STATUS_LABEL[form.status]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importXlsx(f);
            }}
          />
          <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => fileRef.current?.click()} disabled={saving} title="분류·제품명·수량·단가 열이 있는 지출 엑셀">
            엑셀에서 줄 가져오기
          </Button>
          <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => exportProjectXlsx({ ...saved, ...form }, transactions)} disabled={saving}>
            엑셀 내려받기
          </Button>
          <Button variant="danger" className="h-8 px-3 text-xs" onClick={remove} disabled={saving}>
            삭제
          </Button>
          <Button variant="ghost" className="h-8 px-3 text-xs" disabled={!dirty || saving} onClick={() => { setDraft(null); setNotice(null); }}>
            변경 취소
          </Button>
          <Button className="h-8 px-3 text-xs" disabled={!dirty || saving} onClick={save}>
            {saving ? "저장 중…" : "저장"}
          </Button>
        </div>
      </div>

      {dirty ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          저장 안 된 변경이 있습니다. 「저장」을 누르면 이 프로젝트가 통째로 이 내용으로 바뀝니다.
        </p>
      ) : (
        notice && (
          <p className={`mb-4 rounded-lg border px-3 py-2 text-xs ${notice.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            {notice.text}
          </p>
        )
      )}

      {/* ---- 기본 정보 ---- */}
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            코드 <span className="text-[10px] text-zinc-400">원장 프로젝트코드</span>
            <input value={form.code} onChange={(e) => setField("code", e.target.value.trim())} className={`${cell} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            발주처 · 주최
            <input value={form.client ?? ""} onChange={(e) => setField("client", e.target.value || undefined)} className={cell} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            상태
            <select value={form.status} onChange={(e) => setField("status", e.target.value as ProjectStatus)} className={`${cell} cursor-pointer`}>
              {PROJECT_STATUSES.map((st) => (
                <option key={st} value={st}>{PROJECT_STATUS_LABEL[st]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            시작일
            <input type="date" value={form.startDate ?? ""} onChange={(e) => setField("startDate", e.target.value || undefined)} className={cell} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            종료일
            <input type="date" value={form.endDate ?? ""} onChange={(e) => setField("endDate", e.target.value || undefined)} className={cell} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            사업소분류
            <input value={form.bizMinor ?? ""} onChange={(e) => setField("bizMinor", e.target.value || undefined)} list="project-biz-minors" className={cell} placeholder="조향 · SMOAT …" />
            <datalist id="project-biz-minors">
              {bizMinors.map((b) => <option key={b} value={b} />)}
            </datalist>
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
          메모
          <Textarea rows={2} value={form.note ?? ""} onChange={(e) => setField("note", e.target.value || undefined)} className="text-xs" placeholder="계약 조건, 부가세 기준, 정산 일정 …" />
        </label>
      </Card>

      {/* ---- 손익 요약 ---- */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="수입 (공급가액)"
          value={summary.revenue}
          hint={
            summary.revenueVat > 0
              ? `부가세 ${summary.revenueVat.toLocaleString("ko-KR")} 별도 · 총액 ${summary.revenueTotal.toLocaleString("ko-KR")}`
              : "면세 — 부가세 없음"
          }
        />
        <Tile label="견적 원가" value={summary.estimate} hint={`${summary.lineCount}줄 · 수량 × 단가`} />
        <Tile label="예상 이익" value={summary.profitEstimate} hint={`이익률 ${formatMargin(summary.marginEstimate)}`} />
        <Tile
          label="실제 원가"
          value={summary.actual}
          hint={summary.lineCount === 0 ? "줄 없음" : unfilled > 0 ? `실제금액 미입력 ${unfilled}줄은 견적으로` : "모든 줄 실제금액 입력됨"}
          warn={unfilled > 0 && summary.actualFilled > 0}
        />
        <Tile label="실질 이익" value={summary.profitActual} hint={`이익률 ${formatMargin(summary.marginActual)}`} strong />
        <Tile
          label="미수금"
          value={summary.unpaid}
          hint={
            summary.overdue > 0
              ? `연체 ${summary.overdueCount}건 · ${summary.overdue.toLocaleString("ko-KR")}원`
              : summary.unpaid === 0
                ? "다 받았습니다"
                : `받은 돈 ${summary.received.toLocaleString("ko-KR")}원`
          }
          warn={summary.overdue > 0}
        />
      </div>
      <p className="mb-5 -mt-3 text-xs text-zinc-400">
        이익 = 공급가액 − 원가. 원가는 실제로 지불한 금액(대개 부가세 포함)이라, 매입세액을 공제받으면 실제 부담은 이보다 적습니다.
      </p>

      {/* ---- 견적서 · 계약서 ---- */}
      {/* 문서는 편집창 안에서 바로 저장된다 (프로젝트 「저장」 과 따로). 계약금액 반영만 초안을 거친다 */}
      <ProjectDocs
        project={saved}
        onApplyAmount={(amount, vatMode) => edit((f) => ({ ...f, contractAmount: amount, vatMode }))}
        onNotice={setNotice}
      />

      {/* ---- 원장 대조 ---- */}
      <Card className="mb-5 p-4">
        <SectionTitle
          hint={`원장에서 프로젝트코드 ${form.code || "(없음)"} 가 찍힌 거래 — 줄을 누르면 그 자리에서 고칩니다`}
          action={
            form.code ? (
              <Link href={ledgerHref({ projectCode: form.code })} className="text-xs text-indigo-600 hover:underline">
                원장에서 보기 →
              </Link>
            ) : undefined
          }
        >
          원장 대조
        </SectionTitle>

        {ledgerRows.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span className="text-zinc-500">거래 <b className="text-zinc-800">{ledgerRows.length}</b>건</span>
            <span className="text-zinc-500">수입 <Money value={summary.ledger.income} unit={false} className="font-medium" /></span>
            <span className="text-zinc-500">
              지출 <Money value={ledgerNet} unit={false} className="font-medium" />
              {summary.ledger.refund > 0 && <span className="ml-1 text-xs text-zinc-400">(환급 {summary.ledger.refund.toLocaleString("ko-KR")} 차감)</span>}
            </span>
            <span className="text-zinc-500">
              지출 실제 원가와 차이 <Money value={summary.actual - ledgerNet} unit={false} className="font-medium" />
              <span className="ml-1 text-xs text-zinc-400">
                {summary.actual - ledgerNet > 0
                  ? "원장에 아직 안 찍힌 지출이 있거나 견적이 높습니다"
                  : summary.actual - ledgerNet < 0
                    ? "지출 목록에 빠진 항목이 원장에 있습니다"
                    : "일치"}
              </span>
            </span>
          </div>
        )}

        {ledgerRows.length === 0 ? (
          <p className="mb-3 text-xs text-zinc-400">
            아직 이 코드로 잡힌 거래가 없습니다. 아래에서 거래를 찾아 붙이거나, 원장에서 프로젝트코드에{" "}
            <span className="font-mono">{form.code || "코드"}</span> 를 적으면 여기 모입니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="px-2 py-1.5 font-medium">거래일</th>
                  <th className="px-2 py-1.5 font-medium">유형</th>
                  <th className="px-2 py-1.5 font-medium">거래처</th>
                  <th className="px-2 py-1.5 font-medium">계정</th>
                  <th className="px-2 py-1.5 text-right font-medium">순금액</th>
                  <th className="w-16 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setEditingTx(t)}
                    className="cursor-pointer border-b border-zinc-100 hover:bg-indigo-50/50"
                    title="눌러서 이 거래를 고칩니다"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5">{t.date}</td>
                    <td className="px-2 py-1.5">{t.txType}</td>
                    <td className="px-2 py-1.5">{t.vendor ?? ""}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{[t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(" › ")}</td>
                    <td className="px-2 py-1.5 text-right"><Money value={netAmount(t)} unit={false} /></td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={attaching}
                        onClick={(e) => {
                          e.stopPropagation();
                          void detachTx(t);
                        }}
                        className="text-zinc-300 hover:text-rose-600 disabled:opacity-40"
                        title="이 프로젝트에서 떼기 (거래는 원장에 남습니다)"
                      >
                        떼기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 거래 붙이기 — 프로젝트코드가 비어 있는 거래를 찾아 이 코드로 묶는다 */}
        <div className="mt-3 border-t border-zinc-100 pt-3">
          {codeUnsaved ? (
            <p className="text-xs text-amber-700">
              코드를 <span className="font-mono">{form.code || "(빈 값)"}</span> 로 고쳤습니다. 먼저 저장해야 거래를 붙일 수 있습니다.
            </p>
          ) : (
            <>
              <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                거래 붙이기
                <input
                  value={attachQuery}
                  onChange={(e) => setAttachQuery(e.target.value)}
                  placeholder="거래처·비고·금액·날짜로 찾기"
                  className={`${cell} h-7 w-72`}
                  disabled={!savedCode || attaching}
                />
                <span className="text-zinc-400">프로젝트코드가 비어 있는 거래만 나옵니다</span>
              </label>
              {attachQuery.trim() && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded border border-zinc-200">
                  {attachCandidates.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-zinc-400">찾은 거래가 없습니다.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <tbody>
                        {attachCandidates.map((t) => (
                          <tr key={t.id} className="border-b border-zinc-100 last:border-0">
                            <td className="whitespace-nowrap px-2 py-1.5">{t.date}</td>
                            <td className="px-2 py-1.5">{t.txType}</td>
                            <td className="px-2 py-1.5">{t.vendor ?? ""}</td>
                            <td className="px-2 py-1.5 text-zinc-500">{[t.acctMid, t.acctMinor].filter(Boolean).join(" › ")}</td>
                            <td className="px-2 py-1.5 text-right"><Money value={netAmount(t)} unit={false} /></td>
                            <td className="w-16 px-2 py-1.5 text-right">
                              <button
                                type="button"
                                disabled={attaching}
                                onClick={() => void attachTx(t)}
                                className="rounded border border-indigo-200 px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
                              >
                                붙이기
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ---- 수입 (부가세) ---- */}
      <Card className="mb-5 p-4">
        <SectionTitle hint="계약서에 적힌 금액이 부가세를 포함한 값인지 골라 주세요">수입</SectionTitle>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                계약금액
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.contractAmount || ""}
                  placeholder="0"
                  onChange={(e) => setField("contractAmount", Number(e.target.value) || 0)}
                  className={`${numCell} h-8 w-40 text-sm font-semibold`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                부가세
                <select
                  value={form.vatMode ?? "excluded"}
                  onChange={(e) => setField("vatMode", e.target.value as VatMode)}
                  className={`${cell} h-8 w-32 cursor-pointer text-sm`}
                  title={VAT_HINT[form.vatMode ?? "excluded"]}
                >
                  {VAT_MODES.map((m) => (
                    <option key={m} value={m}>{VAT_LABEL[m]}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-1.5 text-xs text-zinc-400">{VAT_HINT[form.vatMode ?? "excluded"]}</p>

            {/* 갈라진 값을 바로 보여준다 — 계약서 숫자를 그대로 읽어 확인할 수 있게 */}
            <dl className="mt-3 space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-zinc-500">공급가액</dt>
                <dd><Money value={summary.revenue} unit={false} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">부가세</dt>
                <dd><Money value={summary.revenueVat} unit={false} muted /></dd>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold">
                <dt>청구 총액</dt>
                <dd><Money value={summary.revenueTotal} unit={false} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">받은 돈</dt>
                <dd><Money value={summary.received} unit={false} muted /></dd>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold">
                <dt className={summary.unpaid > 0 ? "text-rose-700" : ""}>미수금</dt>
                <dd className={summary.unpaid > 0 ? "text-rose-700" : ""}>
                  <Money value={summary.unpaid} unit={false} className={summary.unpaid > 0 ? "text-rose-700" : ""} />
                </dd>
              </div>
            </dl>
            {summary.overdue > 0 && (
              <p className="mt-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
                받기로 한 날이 지난 회차 <b>{summary.overdueCount}건 · {summary.overdue.toLocaleString("ko-KR")}원</b>
              </p>
            )}
            <p className="mt-1.5 text-xs text-zinc-400">
              이익은 공급가액으로 계산합니다. 받은 부가세는 나중에 낼 돈이라 회사에 남는 돈이 아닙니다.
            </p>
          </div>

          <div>
            {/* ---- 입금 일정 (선금·중도금·잔금) ---- */}
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
              <span>
                입금 일정 <span className="text-zinc-400">— 계약금액을 나눠 받는 회차</span>
              </span>
              <button type="button" onClick={addInstallment} className="text-indigo-600 hover:underline">
                + 회차 추가
              </button>
            </div>
            {(form.installments ?? []).length === 0 ? (
              <p className="mb-3 text-xs text-zinc-300">
                아직 없습니다. 「+ 회차 추가」로 선금·중도금·잔금을 나눠 적으면 미수금이 계산됩니다.
              </p>
            ) : (
              <table className="mb-1 w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-400">
                    <th className="w-20 pb-1 font-medium">구분</th>
                    <th className="w-28 pb-1 text-right font-medium">금액</th>
                    <th className="w-24 pb-1 text-right font-medium">청구액</th>
                    <th className="w-32 pb-1 font-medium">받기로 한 날</th>
                    <th className="w-32 pb-1 font-medium">입금일</th>
                    <th className="w-14 pb-1 font-medium">상태</th>
                    <th className="pb-1 font-medium">비고</th>
                    <th className="w-6 pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {(form.installments ?? []).map((i) => {
                    const st = installmentStatus(i);
                    const billed = splitVat(i.amount, form.vatMode ?? "excluded").total;
                    return (
                      <tr key={i.id}>
                        <td className="py-0.5 pr-1">
                          <select
                            value={i.kind}
                            onChange={(e) => updateInstallment(i.id, { kind: e.target.value as InstallmentKind })}
                            className={`${cell} cursor-pointer`}
                          >
                            {INSTALLMENT_KINDS.map((k) => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-0.5 pr-1">
                          <input
                            type="number"
                            inputMode="numeric"
                            value={i.amount || ""}
                            placeholder="0"
                            onChange={(e) => updateInstallment(i.id, { amount: Number(e.target.value) || 0 })}
                            className={numCell}
                          />
                        </td>
                        <td className="py-0.5 pr-1 text-right tabular-nums text-zinc-500" title="부가세를 더한 실제 청구액">
                          {billed.toLocaleString("ko-KR")}
                        </td>
                        <td className="py-0.5 pr-1">
                          <input
                            type="date"
                            value={i.dueDate ?? ""}
                            onChange={(e) => updateInstallment(i.id, { dueDate: e.target.value || undefined })}
                            className={cell}
                          />
                        </td>
                        <td className="py-0.5 pr-1">
                          <input
                            type="date"
                            value={i.paidDate ?? ""}
                            onChange={(e) => updateInstallment(i.id, { paidDate: e.target.value || undefined })}
                            className={`${cell} ${i.paidDate ? "border-emerald-300 bg-emerald-50/40" : ""}`}
                            title="날짜를 넣으면 입금 완료로 셉니다"
                          />
                        </td>
                        <td className="py-0.5 pr-1">
                          <span
                            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                            style={{ backgroundColor: INSTALLMENT_STATUS_COLOR[st] }}
                          >
                            {INSTALLMENT_STATUS_LABEL[st]}
                          </span>
                        </td>
                        <td className="py-0.5 pr-1">
                          <input
                            value={i.note ?? ""}
                            onChange={(e) => updateInstallment(i.id, { note: e.target.value || undefined })}
                            placeholder="비고"
                            className={cell}
                          />
                        </td>
                        <td className="py-0.5">
                          <button type="button" onClick={() => removeInstallment(i.id)} className="text-zinc-300 hover:text-rose-600" title="회차 삭제">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {summary.installmentCount > 0 && summary.scheduleGap !== 0 && (
              <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                회차 합계가 계약 청구액과 <b>{Math.abs(summary.scheduleGap).toLocaleString("ko-KR")}원</b>{" "}
                {summary.scheduleGap > 0 ? "모자랍니다" : "많습니다"}. 아직 안 나눈 몫이면 회차를 더하고, 잘못 적었으면 금액을 고치세요.
              </p>
            )}

            <div className="mb-1 mt-4 flex items-center justify-between text-xs text-zinc-500">
              <span>추가 수입 <span className="text-zinc-400">— 추가 정산 · 현장 판매 · 지원금 …</span></span>
              <button type="button" onClick={() => edit((f) => ({ ...f, revenues: [...f.revenues, newRevenue()] }))} className="text-indigo-600 hover:underline">
                + 줄 추가
              </button>
            </div>
            {form.revenues.length === 0 ? (
              <p className="text-xs text-zinc-300">없음</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-400">
                    <th className="pb-1 font-medium">항목</th>
                    <th className="w-28 pb-1 text-right font-medium">금액</th>
                    <th className="w-28 pb-1 font-medium">부가세</th>
                    <th className="w-24 pb-1 text-right font-medium">공급가액</th>
                    <th className="w-32 pb-1 font-medium">입금일</th>
                    <th className="pb-1 font-medium">비고</th>
                    <th className="w-6 pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {form.revenues.map((r) => {
                    const split = splitVat(r.amount, r.vatMode ?? form.vatMode ?? "excluded");
                    return (
                      <tr key={r.id}>
                        <td className="py-0.5 pr-1"><input value={r.label} onChange={(e) => updateRevenue(r.id, { label: e.target.value })} placeholder="항목" className={cell} /></td>
                        <td className="py-0.5 pr-1"><input type="number" inputMode="numeric" value={r.amount || ""} placeholder="0" onChange={(e) => updateRevenue(r.id, { amount: Number(e.target.value) || 0 })} className={numCell} /></td>
                        <td className="py-0.5 pr-1">
                          <select
                            value={r.vatMode ?? ""}
                            onChange={(e) => updateRevenue(r.id, { vatMode: (e.target.value || undefined) as VatMode | undefined })}
                            className={`${cell} cursor-pointer`}
                          >
                            <option value="">계약과 동일</option>
                            {VAT_MODES.map((m) => (
                              <option key={m} value={m}>{VAT_LABEL[m]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-0.5 pr-1 text-right tabular-nums text-zinc-600">{split.supply.toLocaleString("ko-KR")}</td>
                        <td className="py-0.5 pr-1">
                          <input
                            type="date"
                            value={r.receivedDate ?? ""}
                            onChange={(e) => updateRevenue(r.id, { receivedDate: e.target.value || undefined, received: undefined })}
                            className={`${cell} ${isReceived(r) ? "border-emerald-300 bg-emerald-50/40" : ""}`}
                            title="날짜를 넣으면 입금 완료로 셉니다"
                          />
                        </td>
                        <td className="py-0.5 pr-1"><input value={r.note ?? ""} onChange={(e) => updateRevenue(r.id, { note: e.target.value || undefined })} placeholder="비고" className={cell} /></td>
                        <td className="py-0.5"><button type="button" onClick={() => removeRevenue(r.id)} className="text-zinc-300 hover:text-rose-600" title="줄 삭제">✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Card>

      {/* ---- 지출 (원장과 같은 시트) ---- */}
      <Card className="mb-5 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-700">
            지출
            <span className="ml-2 font-normal text-zinc-400">
              {summary.lineCount}줄 · 준비 {summary.doneCount}/{summary.lineCount} · 물품·인쇄물·식대·인건비·운송 모두 여기에
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-zinc-400 sm:inline">
              엑셀처럼 씁니다 — 붙여넣기 · 방향키 이동 · 오른쪽 클릭으로 줄 넣기/지우기
            </span>
            <div className="flex items-center gap-0.5 rounded-md border border-zinc-300">
              <button
                type="button"
                onClick={() => sheetLayout.stepZoom(-1)}
                className="px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
                title="축소"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => sheetLayout.setZoom(1)}
                className="min-w-[3rem] px-1 py-0.5 text-xs tabular-nums text-zinc-600 hover:bg-zinc-100"
                title="100% 로"
              >
                {Math.round(sheetLayout.layout.zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => sheetLayout.stepZoom(1)}
                className="px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
                title="확대"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <ChecklistSheet
          lines={form.lines}
          onChange={setLines}
          columns={form.columns ?? []}
          onColumnsChange={(cols) => setField("columns", cols)}
          createRow={() => newLine("")}
          height={sheetHeight}
          sheet={sheetLayout}
        />

        <div className="flex flex-wrap items-center justify-end gap-6 border-t border-zinc-200 px-4 py-2 text-xs">
          <span className="text-zinc-500">
            견적 합계 <b className="ml-1 text-sm"><Money value={summary.estimate} unit={false} /></b>
          </span>
          <span className="text-zinc-500">
            실제 합계 <b className="ml-1 text-sm"><Money value={summary.actual} unit={false} /></b>
            {unfilled > 0 && <span className="ml-1 text-zinc-400">(미입력 {unfilled}줄은 견적으로)</span>}
          </span>
        </div>
      </Card>

      {/* ---- 분류별 소계 ---- */}
      {groups.length > 0 && (
        <Card className="mb-5 p-4">
          <SectionTitle hint="지출을 분류별로 묶은 소계">분류별 소계</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="px-2 py-1.5 font-medium">분류</th>
                  <th className="px-2 py-1.5 text-right font-medium">줄 수</th>
                  <th className="px-2 py-1.5 text-right font-medium">준비</th>
                  <th className="px-2 py-1.5 text-right font-medium">견적</th>
                  <th className="px-2 py-1.5 text-right font-medium">실제</th>
                  <th className="px-2 py-1.5 text-right font-medium">수입 대비</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.category} className="border-b border-zinc-100">
                    <td className="px-2 py-1.5">{g.category}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{g.lines.length}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{g.doneCount}/{g.lines.length}</td>
                    <td className="px-2 py-1.5 text-right"><Money value={g.estimate} unit={false} muted /></td>
                    <td className="px-2 py-1.5 text-right"><Money value={g.actual} unit={false} /></td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{summary.revenue > 0 ? `${((g.actual / summary.revenue) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-2 py-1.5">총계</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{summary.lineCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{summary.doneCount}/{summary.lineCount}</td>
                  <td className="px-2 py-1.5 text-right"><Money value={summary.estimate} unit={false} /></td>
                  <td className="px-2 py-1.5 text-right"><Money value={summary.actual} unit={false} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{summary.revenue > 0 ? `${((summary.actual / summary.revenue) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 원장 거래 수정 — 원장·검토함과 같은 편집기를 그대로 쓴다 */}
      {editingTx && (
        <TransactionEditor
          tx={editingTx}
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={bizMinors}
          onSave={async (patch) => {
            await updateFinTransaction(editingTx.id, patch);
            await refresh();
            setNotice({ kind: "ok", text: "원장 거래를 수정했습니다." });
          }}
          onClose={() => setEditingTx(null)}
        />
      )}
    </div>
  );
}

// ---- 부품 ------------------------------------------------------

function Tile({ label, value, hint, strong, warn }: { label: string; value: number; hint?: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${strong ? "border-indigo-200" : "border-zinc-200"}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 font-bold tracking-tight ${strong ? "text-2xl" : "text-xl"}`}><Money value={value} /></p>
      {hint && <p className={`mt-1 text-xs ${warn ? "text-amber-600" : "text-zinc-400"}`}>{hint}</p>}
    </div>
  );
}
