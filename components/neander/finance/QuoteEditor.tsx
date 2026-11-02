"use client";

// 프로젝트 견적 작성기: 별도 프로그램의 폼·디자인을 ERP 문서 저장 흐름에 연결한다.

import { useMemo, useState } from "react";
import { FileSpreadsheet, ImageDown, Printer, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  InlineNotice,
  Select,
  useConfirm,
} from "@/components/neander/ui";
import { DocFilesField } from "@/components/neander/finance/DocFiles";
import { printableQuoteHtml } from "@/components/neander/finance/QuoteSheet";
import { deleteFinDoc, saveFinDoc, uploadFinDocFiles } from "@/lib/neander/finance/client";
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_LABEL,
  QUOTE_VAT_LABEL,
  quoteFileStem,
  quoteTotals,
  sanitizeFinDoc,
  type QuoteDesign,
  type FinDocFile,
  type FinQuoteInput,
  type QuoteStatus,
  type QuoteVatMode,
} from "@/lib/neander/finance/docs";
import { resolveSeal } from "@/lib/neander/finance/supplier";
import { loadSealImage } from "@/lib/neander/finance/seal-image";
import { QuoteForm } from "./QuoteForm";
import { QuotePaperPreview } from "./QuotePaperPreview";
import { QUOTE_DESIGNS, QUOTE_DESIGN_CSS } from "./quotation-designs/QuoteDesignPreview";
import { exportQuotePng } from "@/lib/neander/finance/quote-image";
import { QUOTE_CSS, openQuotePdf } from "@/lib/neander/finance/quote-pdf";
import { exportQuoteXlsx } from "@/lib/neander/finance/quote-xlsx";
import type { VatMode } from "@/lib/neander/finance/project";

/** 종이 위에 자리가 없는 값들 — 위 띠에 한 줄로 세운다 */
function ToolbarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </label>
  );
}

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
  const confirm = useConfirm();
  const [docId, setDocId] = useState<string | undefined>(initialId);
  const [form, setForm] = useState<FinQuoteInput>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [files, setFiles] = useState<FinDocFile[]>(initialFiles);
  const [pending, setPending] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== savedSnapshot || pending.length > 0;
  const totals = useMemo(() => quoteTotals(form), [form]);
  const busy = saving || exporting;

  const set = <K extends keyof FinQuoteInput>(k: K, v: FinQuoteInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const close = async () => {
    if (busy) return;
    if (
      dirty &&
      !(await confirm({
        title: "저장하지 않은 변경이 있습니다",
        message: "닫으면 고친 내용이 사라집니다. 닫을까요?",
        confirmLabel: "닫기",
        tone: "danger",
      }))
    )
      return;
    onClose();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const parsed = sanitizeFinDoc(form);
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.value.kind !== "quote") throw new Error("견적서가 아닙니다.");
      const next = parsed.value;
      const res = await saveFinDoc(next, docId);
      setDocId(res.id);
      setForm(next);
      setSavedSnapshot(JSON.stringify(next));
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
    const ok = await confirm({
      title: `견적서 「${form.title || form.quoteNo}」 를 지울까요?`,
      message: `붙은 파일 ${files.length}개도 함께 사라집니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
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
  const exportGuard = async () => {
    const m = missing();
    return (
      m.length === 0 ||
      confirm({
        title: `${m.join(" · ")} 이(가) 비어 있습니다`,
        message: "그대로 뽑을까요?",
        confirmLabel: "그대로 뽑기",
      })
    );
  };
  const print = async () => {
    if (!(await exportGuard())) return;
    // 클릭 직후 창을 먼저 열어 비동기 인감 로딩 때문에 브라우저가 팝업을 막지 않게 한다.
    const win = window.open("", "_blank");
    if (!win) { setError("팝업이 차단되어 인쇄창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요."); return; }
    setExporting(true);
    try {
      const seal = resolveSeal(form.sealId);
      if (seal) await loadSealImage(seal.id);
      openQuotePdf(printableQuoteHtml(form), quoteFileStem(form), win);
    } catch (e) {
      win.close();
      setError(e instanceof Error ? e.message : "인쇄본을 만들지 못했습니다.");
    } finally { setExporting(false); }
  };
  const image = async () => {
    if (!(await exportGuard())) return;
    setExporting(true);
    setError(null);
    try { await exportQuotePng(form); }
    catch (e) { setError(e instanceof Error ? e.message : "이미지를 만들지 못했습니다."); }
    finally { setExporting(false); }
  };
  const excel = async () => {
    if (!(await exportGuard())) return;
    exportQuoteXlsx(form);
  };

  return (
    <Dialog
      open
      onClose={() => void close()}
      size="full"
      className="sm:!max-w-[1440px]"
      description="프로젝트 정보로 시작해 견적을 작성하고, 선택한 디자인 그대로 출력합니다."
      closeOnOverlay={false}
      title={docId ? "견적서" : "새 견적서"}
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {docId && onDeleted && (
              <Button variant="danger" size="sm" icon={Trash2} onClick={remove} disabled={busy}>
                삭제
              </Button>
            )}
            {onApplyAmount && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || totals.sum === 0}
                onClick={() => {
                  // 표의 합을 단가 기준과 함께 넘긴다. 총액(부가세 포함)을 「별도」 로 넘기면
                  // 프로젝트가 거기에 부가세를 한 번 더 얹어 계약이 10% 부풀었다
                  onApplyAmount(totals.sum, form.vatMode);
                  setOkMsg(`프로젝트 계약금액 칸에 ${totals.sum.toLocaleString("ko-KR")} (${QUOTE_VAT_LABEL[form.vatMode]}) 을 넣었습니다. 프로젝트 화면에서 「저장」 해야 남습니다.`);
                }}
                title="프로젝트 수입 칸의 계약금액에 이 견적 금액을 단가 기준(VAT 별도·포함) 그대로 넣습니다 (프로젝트 저장은 따로)"
              >
                계약금액으로 반영
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-nd-caption text-nd-warning-text">저장 안 됨</span>}
            <Button variant="ghost" onClick={() => void close()} disabled={busy}>
              닫기
            </Button>
            <Button onClick={save} disabled={busy || (!dirty && !!docId)} loading={saving}>
              저장
            </Button>
          </div>
        </div>
      }
    >
      {/* ---- 종이에 자리가 없는 값 · 내보내기 ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ToolbarField label="단가 기준">
            <Select
              size="sm"
              className="w-auto"
              disabled={busy}
              value={form.vatMode}
              onChange={(e) => set("vatMode", e.target.value as QuoteVatMode)}
              title="표의 단가가 부가세를 포함한 값인지"
            >
              {(Object.keys(QUOTE_VAT_LABEL) as QuoteVatMode[]).map((m) => (
                <option key={m} value={m}>{QUOTE_VAT_LABEL[m]}</option>
              ))}
            </Select>
          </ToolbarField>
          <ToolbarField label="상태">
            <Select size="sm" className="w-auto" disabled={busy} value={form.status} onChange={(e) => set("status", e.target.value as QuoteStatus)}>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </ToolbarField>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={ImageDown} onClick={() => void image()} disabled={busy}>이미지</Button>
          <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={() => void excel()} disabled={busy} title="견적 내용을 엑셀 파일로 저장합니다">
            엑셀
          </Button>
          <Button variant="secondary" size="sm" icon={Printer} onClick={() => void print()} disabled={busy} title="인쇄창을 엽니다 — 대상에서 「PDF로 저장」">
            인쇄 / PDF
          </Button>
        </div>
      </div>

      {(error || okMsg) && (
        <InlineNotice tone={error ? "danger" : "success"} className="mb-4">
          {error ?? okMsg}
        </InlineNotice>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <ToolbarField label="출력 디자인">
          <Select aria-label="출력 디자인" size="sm" className="w-auto" value={form.design ?? 0} disabled={busy}
            onChange={(e) => set("design", e.target.value === "0" ? undefined : Number(e.target.value) as QuoteDesign)}>
            <option value={0}>기존 ERP 양식</option>
            {QUOTE_DESIGNS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </ToolbarField>
        <div className="flex gap-1 xl:hidden" aria-label="견적서 화면 선택">
          <Button size="sm" variant={view === "edit" ? "soft" : "ghost"} onClick={() => setView("edit")}>내용 편집</Button>
          <Button size="sm" variant={view === "preview" ? "soft" : "ghost"} onClick={() => setView("preview")}>미리보기</Button>
        </div>
      </div>
      <style>{QUOTE_CSS + QUOTE_DESIGN_CSS}</style>
      <fieldset disabled={busy} className="min-w-0">
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(320px,1fr)_minmax(0,820px)]">
          <div className={view === "edit" ? "min-w-0" : "hidden min-w-0 xl:block"}>
            <QuoteForm value={form} onChange={setForm} disabled={busy} />
          </div>
          <section aria-label="견적서 미리보기" className={view === "preview" ? "min-w-0" : "hidden min-w-0 xl:block"}>
            <QuotePaperPreview value={form} onChange={setForm} />
            <div className="mt-3 rounded-nd-md border border-nd-line bg-nd-content p-3 text-nd-caption" aria-label="견적 금액 요약">
              <p className="text-nd-fg-2">공급가액 {totals.supply.toLocaleString("ko-KR")}원 + 부가세 {totals.vat.toLocaleString("ko-KR")}원</p>
              <p className="mt-1 text-nd-body font-semibold text-nd-fg">합계 {totals.total.toLocaleString("ko-KR")}원</p>
            </div>
          </section>
        </div>
      </fieldset>

      <div className="mt-5 flex flex-col gap-1.5">
        <span className="text-nd-caption font-medium text-nd-fg-2">
          파일 <span className="ml-1 font-normal text-nd-fg-3">받은 견적 요청서, 보낸 PDF, 상대가 되보낸 수정본</span>
        </span>
        <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={busy} onError={setError} />
      </div>
    </Dialog>
  );
}
