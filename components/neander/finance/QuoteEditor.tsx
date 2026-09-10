"use client";

// ============================================================
//  견적서 편집창
// ------------------------------------------------------------
//  탭이 없다. 종이 한 장이 떠 있고 그 위에서 바로 고친다 — 예전에는
//  「편집」 에서 폼을 채우고 「미리보기」 로 넘어가 확인했는데, 그러면
//  고치는 화면과 나가는 종이가 서로 다른 물건이 되고 미리보기는 약속에
//  그친다. 지금은 화면의 그 종이가 그대로 인쇄된다 (QuoteSheet).
//
//  종이에 자리가 없는 것만 위 띠에 둔다 — 공급자 프리셋, 단가 기준,
//  상태. 앞의 둘은 종이에 결과가 보이고(공급자 표·「VAT 포함」), 상태는
//  우리끼리 쓰는 값이라 종이에 찍히지 않는다. 붙이는 파일도 종이 밖이라
//  시트 아래에 둔다.
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
import { FileSpreadsheet, Printer, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  InlineNotice,
  Select,
  useConfirm,
} from "@/components/neander/ui";
import { DocFilesField } from "@/components/neander/finance/DocFiles";
import { QuoteSheet, printableQuoteHtml } from "@/components/neander/finance/QuoteSheet";
import { deleteFinDoc, saveFinDoc, uploadFinDocFiles } from "@/lib/neander/finance/client";
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_LABEL,
  QUOTE_VAT_LABEL,
  quoteFileStem,
  quoteTotals,
  type FinDocFile,
  type FinQuoteInput,
  type QuoteStatus,
  type QuoteVatMode,
} from "@/lib/neander/finance/docs";
import { CUSTOM_PRESET, SUPPLIER_PRESETS, findPreset, matchPresetId } from "@/lib/neander/finance/supplier";
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
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== savedSnapshot || pending.length > 0;
  const totals = useMemo(() => quoteTotals(form), [form]);
  const presetId = matchPresetId(form.supplier);

  const set = <K extends keyof FinQuoteInput>(k: K, v: FinQuoteInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * 프리셋을 고르면 공급자 여덟 칸과 도장이 함께 갈린다. 도장을 같이
   * 갈아야 와작홈즈 견적서에 네안데르 대표이사인이 남는 일이 없다.
   * 채워 넣은 뒤로는 어느 칸이든 종이 위에서 손으로 고칠 수 있다.
   */
  const applyPreset = (id: string) => {
    const p = findPreset(id);
    if (!p) return;
    setForm((f) => ({ ...f, supplier: { ...p.supplier }, sealId: p.sealId }));
  };

  const close = async () => {
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
    if (!openQuotePdf(printableQuoteHtml(form), quoteFileStem(form)))
      setError("팝업이 차단되어 인쇄창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.");
  };
  const excel = async () => {
    if (!(await exportGuard())) return;
    exportQuoteXlsx(form);
  };

  return (
    <Dialog
      open
      onClose={() => void close()}
      size="xl"
      closeOnOverlay={false}
      title={docId ? "견적서" : "새 견적서"}
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {docId && onDeleted && (
              <Button variant="danger" size="sm" icon={Trash2} onClick={remove} disabled={saving}>
                삭제
              </Button>
            )}
            {onApplyAmount && (
              <Button
                variant="secondary"
                size="sm"
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
            {dirty && <span className="text-nd-caption text-nd-warning-text">저장 안 됨</span>}
            <Button variant="ghost" onClick={() => void close()} disabled={saving}>
              닫기
            </Button>
            <Button onClick={save} disabled={!dirty} loading={saving}>
              저장
            </Button>
          </div>
        </div>
      }
    >
      {/* ---- 종이에 자리가 없는 값 · 내보내기 ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ToolbarField label="공급자">
            <Select
              size="sm"
              className="w-auto"
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
              title="고르면 공급자 표와 도장이 함께 채워집니다. 그 뒤로는 종이 위에서 직접 고칠 수 있습니다"
            >
              {SUPPLIER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              {presetId === CUSTOM_PRESET && <option value={CUSTOM_PRESET}>직접 입력</option>}
            </Select>
          </ToolbarField>
          <ToolbarField label="단가 기준">
            <Select
              size="sm"
              className="w-auto"
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
            <Select size="sm" className="w-auto" value={form.status} onChange={(e) => set("status", e.target.value as QuoteStatus)}>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </ToolbarField>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={() => void excel()} disabled={saving} title="같은 판형의 엑셀 (숫자를 만질 수 있는 사본)">
            엑셀
          </Button>
          <Button variant="secondary" size="sm" icon={Printer} onClick={() => void print()} disabled={saving} title="인쇄창을 엽니다 — 대상에서 「PDF로 저장」">
            인쇄 / PDF
          </Button>
        </div>
      </div>

      {(error || okMsg) && (
        <InlineNotice tone={error ? "danger" : "success"} className="mb-4">
          {error ?? okMsg}
        </InlineNotice>
      )}

      {/* ---- 종이 ---- */}
      <style>{QUOTE_CSS}</style>
      <div className="nd-scroll overflow-x-auto">
        {/* 오른쪽 여백이 넉넉해야 품목 줄의 지우기 단추가 종이 밖에 설 자리가 있다 */}
        <div className="mx-auto min-w-[700px] max-w-[820px] rounded-lg border border-nd-line bg-white px-8 py-7 pr-12 shadow-sm">
          <QuoteSheet value={form} onChange={setForm} />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1.5">
        <span className="text-nd-caption font-medium text-nd-fg-2">
          파일 <span className="ml-1 font-normal text-nd-fg-3">받은 견적 요청서, 보낸 PDF, 상대가 되보낸 수정본</span>
        </span>
        <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={saving} onError={setError} />
      </div>
    </Dialog>
  );
}
