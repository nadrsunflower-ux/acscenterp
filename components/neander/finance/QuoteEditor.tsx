"use client";

// ============================================================
//  견적서 편집창
// ------------------------------------------------------------
//  「견적서(최종)」 시트의 칸을 그대로 둔다 — 견적번호·견적일·수신·견적명·
//  납품기한·지불방식·유효기간, 품목 표, 공급자 표. 「미리보기」 를 누르면
//  인쇄될 모습 그대로 보인다 (quote-pdf.ts 의 같은 HTML).
//
//  저장은 문서를 통째로 보낸다. 파일은 저장 뒤에 올린다 — 문서 id 아래에
//  놓이기 때문이다. 파일 올리기가 실패해도 문서는 남고, 편집창은 열린
//  채로 사유를 보여 준다.
//
//  「계약금액으로 반영」 은 프로젝트 초안에 총액과 부가세 기준을 넣어 줄
//  뿐, 프로젝트를 저장하지는 않는다 — 프로젝트 화면의 「저장」 이 그 일을
//  한다. 두 저장이 한 버튼에 묶이면 어디까지 반영됐는지 흐려진다.
// ============================================================

import { useMemo, useState } from "react";
import { Button } from "@/components/neander/ui";
import { Money } from "@/components/neander/finance/ui";
import { DocFilesField } from "@/components/neander/finance/DocFiles";
import { deleteFinDoc, saveFinDoc, uploadFinDocFiles } from "@/lib/neander/finance/client";
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_LABEL,
  QUOTE_VAT_LABEL,
  koreanNumber,
  newQuoteLine,
  quoteLineAmount,
  quoteTotals,
  type FinDocFile,
  type FinQuoteInput,
  type FinQuoteLine,
  type FinSupplier,
  type QuoteStatus,
  type QuoteVatMode,
} from "@/lib/neander/finance/docs";
import { QUOTE_CSS, openQuotePdf, quoteHtml } from "@/lib/neander/finance/quote-pdf";
import { exportQuoteXlsx } from "@/lib/neander/finance/quote-xlsx";
import type { VatMode } from "@/lib/neander/finance/project";

const cell =
  "h-8 w-full rounded border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-indigo-500 focus:bg-indigo-50/30";
const numCell = `${cell} text-right tabular-nums`;
const lbl = "flex flex-col gap-1 text-xs text-zinc-500";

const SUPPLIER_FIELDS: { key: keyof FinSupplier; label: string }[] = [
  { key: "name", label: "상호" },
  { key: "bizNo", label: "사업자번호" },
  { key: "ceo", label: "대표자" },
  { key: "address", label: "소재지" },
  { key: "bizType", label: "업태" },
  { key: "bizItem", label: "종목" },
  { key: "contact", label: "담당자" },
  { key: "phone", label: "연락처" },
];

export function QuoteEditor({
  id: initialId,
  initial,
  initialFiles = [],
  onClose,
  onSaved,
  onDeleted,
  onApplyAmount,
}: {
  /** 저장된 문서면 id. 새 문서면 없음 */
  id?: string;
  initial: FinQuoteInput;
  initialFiles?: FinDocFile[];
  onClose: () => void;
  /** 저장 뒤 (id 는 새로 만들어졌을 수 있다). 목록을 새로고침하는 자리 */
  onSaved: (id: string) => Promise<void>;
  onDeleted?: () => Promise<void>;
  /** 프로젝트 초안의 계약금액에 총액을 넣는다 */
  onApplyAmount?: (amount: number, vatMode: VatMode) => void;
}) {
  const [docId, setDocId] = useState<string | undefined>(initialId);
  const [form, setForm] = useState<FinQuoteInput>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [files, setFiles] = useState<FinDocFile[]>(initialFiles);
  const [pending, setPending] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [supplierOpen, setSupplierOpen] = useState(false);

  const dirty = JSON.stringify(form) !== savedSnapshot || pending.length > 0;
  const totals = useMemo(() => quoteTotals(form), [form]);
  const previewHtml = useMemo(() => (tab === "preview" ? quoteHtml(form) : ""), [tab, form]);

  const set = <K extends keyof FinQuoteInput>(k: K, v: FinQuoteInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setSupplier = (k: keyof FinSupplier, v: string) => setForm((f) => ({ ...f, supplier: { ...f.supplier, [k]: v } }));
  const setLine = (lid: string, patch: Partial<FinQuoteLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }));
  const removeLine = (lid: string) => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.id !== lid) }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, newQuoteLine()] }));

  const close = () => {
    if (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return;
    onClose();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await saveFinDoc(form, docId);
      setDocId(res.id);
      setSavedSnapshot(JSON.stringify(form));
      let uploadError: string | null = null;
      if (pending.length > 0) {
        try {
          const next = await uploadFinDocFiles(res.id, pending);
          setFiles(next);
          setPending([]);
        } catch (e) {
          uploadError = e instanceof Error ? e.message : "파일을 올리지 못했습니다.";
        }
      }
      await onSaved(res.id);
      if (uploadError) setError(`견적서는 저장했습니다. 파일만 올리지 못했습니다 — ${uploadError}`);
      else setOkMsg("저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!docId || !onDeleted) return;
    if (!window.confirm(`견적서 「${form.title || form.quoteNo}」 를 지웁니다. 붙은 파일 ${files.length}개도 함께 사라집니다.`)) return;
    setSaving(true);
    try {
      await deleteFinDoc(docId);
      await onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      setSaving(false);
    }
  };

  /** 인쇄·엑셀은 저장 여부와 무관하게 화면의 값으로 뽑는다 — 대신 빈 곳을 알린다 */
  const missing = () => {
    const m: string[] = [];
    if (!form.recipient.trim()) m.push("수신");
    if (!form.title.trim()) m.push("견적명");
    if (form.lines.filter((l) => l.name.trim()).length === 0) m.push("품목");
    return m;
  };
  const exportGuard = () => {
    const m = missing();
    return m.length === 0 || window.confirm(`${m.join(" · ")} 이(가) 비어 있습니다. 그대로 뽑을까요?`);
  };
  const print = () => {
    if (!exportGuard()) return;
    if (!openQuotePdf(form)) setError("팝업이 차단되어 인쇄창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.");
  };
  const excel = () => {
    if (!exportGuard()) return;
    exportQuoteXlsx(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 sm:p-8" onClick={close}>
      <div role="dialog" aria-modal="true" className="w-full max-w-5xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* ---- 머리 ---- */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-zinc-900">{docId ? "견적서" : "새 견적서"}</h2>
            <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs">
              {(["edit", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-md px-2.5 py-1 ${tab === t ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
                >
                  {t === "edit" ? "편집" : "미리보기"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={excel} disabled={saving} title="같은 판형의 엑셀 (숫자를 만질 수 있는 사본)">
              엑셀
            </Button>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={print} disabled={saving} title="인쇄창을 엽니다 — 대상에서 「PDF로 저장」">
              인쇄 / PDF
            </Button>
            <button type="button" onClick={close} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100" aria-label="닫기">
              ✕
            </button>
          </div>
        </div>

        {(error || okMsg) && (
          <p className={`mx-6 mt-4 rounded-lg border px-3 py-2 text-xs ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {error ?? okMsg}
          </p>
        )}

        {tab === "preview" ? (
          <div className="px-6 py-5">
            <style>{QUOTE_CSS}</style>
            <div className="mx-auto max-w-[800px] rounded-lg border border-zinc-200 p-6 shadow-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        ) : (
          <div className="space-y-5 px-6 py-5">
            {/* ---- 머리 칸 ---- */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className={lbl}>
                견적번호
                <span className="flex items-center gap-1">
                  <span className="text-sm text-zinc-500">제</span>
                  <input value={form.quoteNo} onChange={(e) => set("quoteNo", e.target.value)} className={`${cell} font-mono`} placeholder="26-001" />
                  <span className="text-sm text-zinc-500">호</span>
                </span>
              </label>
              <label className={lbl}>
                견적일
                <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={cell} />
              </label>
              <label className={lbl}>
                상태
                <select value={form.status} onChange={(e) => set("status", e.target.value as QuoteStatus)} className={`${cell} cursor-pointer`}>
                  {QUOTE_STATUSES.map((s) => (
                    <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </label>
              <label className={lbl}>
                단가 기준
                <select value={form.vatMode} onChange={(e) => set("vatMode", e.target.value as QuoteVatMode)} className={`${cell} cursor-pointer`} title="표의 단가가 부가세를 포함한 값인지">
                  {(Object.keys(QUOTE_VAT_LABEL) as QuoteVatMode[]).map((m) => (
                    <option key={m} value={m}>{QUOTE_VAT_LABEL[m]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className={lbl}>
                수신 <span className="text-[10px] text-zinc-400">「○○ 님 귀하」</span>
                <input value={form.recipient} onChange={(e) => set("recipient", e.target.value)} className={cell} placeholder="FNC" />
              </label>
              <label className={lbl}>
                견적명
                <input value={form.title} onChange={(e) => set("title", e.target.value)} className={cell} placeholder="N.Flying 'into REM' 룸스프레이의 건" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={lbl}>
                납품기한
                <input value={form.delivery ?? ""} onChange={(e) => set("delivery", e.target.value)} className={cell} placeholder="발주 후 3주 · 납품 완료" />
              </label>
              <label className={lbl}>
                대금 지불방식
                <input value={form.payment ?? ""} onChange={(e) => set("payment", e.target.value)} className={cell} placeholder="납품 후 세금계산서 발행, 30일 내 입금" />
              </label>
              <label className={lbl}>
                견적 유효기간
                <input value={form.validity ?? ""} onChange={(e) => set("validity", e.target.value)} className={cell} placeholder="견적일로부터 7일간" />
              </label>
            </div>

            {/* ---- 품목 ---- */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                <span>품목 <span className="text-zinc-400">— 공급가액은 수량 × 단가</span></span>
                <button type="button" onClick={addLine} className="text-indigo-600 hover:underline">+ 줄 추가</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-zinc-400">
                      <th className="pb-1 font-medium">품명</th>
                      <th className="w-36 pb-1 font-medium">규격/사양</th>
                      <th className="w-20 pb-1 text-right font-medium">수량</th>
                      <th className="w-28 pb-1 text-right font-medium">단가</th>
                      <th className="w-28 pb-1 text-right font-medium">공급가액</th>
                      <th className="w-28 pb-1 font-medium">비고</th>
                      <th className="w-6 pb-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-0.5 pr-1"><input value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} className={cell} placeholder="품명" /></td>
                        <td className="py-0.5 pr-1"><input value={l.spec ?? ""} onChange={(e) => setLine(l.id, { spec: e.target.value })} className={cell} placeholder="개/200ml" /></td>
                        <td className="py-0.5 pr-1"><input type="number" inputMode="numeric" value={l.qty || ""} placeholder="0" onChange={(e) => setLine(l.id, { qty: Number(e.target.value) || 0 })} className={numCell} /></td>
                        <td className="py-0.5 pr-1"><input type="number" inputMode="numeric" value={l.unitPrice || ""} placeholder="0" onChange={(e) => setLine(l.id, { unitPrice: Number(e.target.value) || 0 })} className={numCell} /></td>
                        <td className="py-0.5 pr-1 text-right tabular-nums text-zinc-700">{quoteLineAmount(l).toLocaleString("ko-KR")}</td>
                        <td className="py-0.5 pr-1"><input value={l.note ?? ""} onChange={(e) => setLine(l.id, { note: e.target.value })} className={cell} placeholder="VAT포함" /></td>
                        <td className="py-0.5"><button type="button" onClick={() => removeLine(l.id)} className="text-zinc-300 hover:text-rose-600" title="줄 삭제">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                <div className="text-sm">
                  <span className="text-zinc-500">일금</span>{" "}
                  <b className="text-base text-zinc-900">{koreanNumber(totals.total)}</b>{" "}
                  <span className="text-zinc-500">원정</span>
                  <span className="ml-2 text-xs text-zinc-400">{QUOTE_VAT_LABEL[form.vatMode]}</span>
                </div>
                <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-xs">
                  <dt className="text-zinc-500">표 합계</dt>
                  <dd className="text-right"><Money value={totals.sum} unit={false} /></dd>
                  <dt className="text-zinc-500">공급가액</dt>
                  <dd className="text-right"><Money value={totals.supply} unit={false} muted /></dd>
                  <dt className="text-zinc-500">부가세</dt>
                  <dd className="text-right"><Money value={totals.vat} unit={false} muted /></dd>
                  <dt className="border-t border-zinc-200 pt-0.5 font-semibold">합계금액</dt>
                  <dd className="border-t border-zinc-200 pt-0.5 text-right font-semibold"><Money value={totals.total} unit={false} /></dd>
                </dl>
              </div>
            </div>

            {/* ---- 공급자 ---- */}
            <div className="rounded-lg border border-zinc-200">
              <button
                type="button"
                onClick={() => setSupplierOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-50"
              >
                <span>
                  공급자 <span className="text-zinc-400">— {form.supplier.name || "(상호 없음)"} · {form.supplier.contact || "담당자 없음"} {form.supplier.phone}</span>
                </span>
                <span className="text-zinc-400">{supplierOpen ? "접기 ▲" : "고치기 ▼"}</span>
              </button>
              {supplierOpen && (
                <div className="grid gap-3 border-t border-zinc-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  {SUPPLIER_FIELDS.map((f) => (
                    <label key={f.key} className={`${lbl} ${f.key === "address" ? "sm:col-span-2" : ""}`}>
                      {f.label}
                      <input value={form.supplier[f.key]} onChange={(e) => setSupplier(f.key, e.target.value)} className={cell} />
                    </label>
                  ))}
                  <p className="text-[11px] text-zinc-400 sm:col-span-2 lg:col-span-4">
                    여기서 고친 값은 이 견적서에 남고, 다음 새 견적서가 이어받습니다.
                  </p>
                </div>
              )}
            </div>

            <label className={lbl}>
              메모 <span className="text-[10px] text-zinc-400">견적서 아래에 함께 찍힙니다 — 배송비·샘플 조건 등</span>
              <textarea rows={2} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} className={`${cell} h-auto resize-y py-1.5`} />
            </label>

            <div className={lbl}>
              파일 <span className="text-[10px] text-zinc-400">받은 견적 요청서, 보낸 PDF, 상대가 되보낸 수정본</span>
              <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={saving} onError={setError} />
            </div>
          </div>
        )}

        {/* ---- 발 ---- */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-6 py-4">
          <div className="flex items-center gap-2">
            {docId && onDeleted && (
              <Button variant="danger" className="h-8 px-3 text-xs" onClick={remove} disabled={saving}>삭제</Button>
            )}
            {onApplyAmount && (
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={saving || totals.total === 0}
                onClick={() => {
                  onApplyAmount(totals.total, form.vatMode);
                  setOkMsg(`프로젝트 계약금액 칸에 ${totals.total.toLocaleString("ko-KR")} (${QUOTE_VAT_LABEL[form.vatMode]}) 을 넣었습니다. 프로젝트 화면에서 「저장」 해야 남습니다.`);
                }}
                title="프로젝트 수입 칸의 계약금액에 이 견적 총액을 넣습니다 (프로젝트 저장은 따로)"
              >
                계약금액으로 반영
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-amber-700">저장 안 됨</span>}
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={close} disabled={saving}>닫기</Button>
            <Button className="h-8 px-3 text-xs" onClick={save} disabled={saving || !dirty}>
              {saving ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
