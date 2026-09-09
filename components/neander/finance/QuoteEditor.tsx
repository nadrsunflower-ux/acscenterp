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
import { ChevronDown, ChevronUp, FileSpreadsheet, Plus, Printer, Trash2, X } from "lucide-react";
import {
  Button,
  Dialog,
  Field,
  IconButton,
  InlineNotice,
  Input,
  SectionHeader,
  SegmentedControl,
  Select,
  Table,
  TableScroll,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
  useConfirm,
} from "@/components/neander/ui";
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

/** 표 안 머리글 — 카드 안의 표라 배경 없이 얇은 선만 */
const thCls = "!bg-transparent border-t-0";

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
    if (!openQuotePdf(form)) setError("팝업이 차단되어 인쇄창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.");
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
      {/* ---- 편집/미리보기 · 내보내기 ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<"edit" | "preview">
          size="sm"
          ariaLabel="보기"
          value={tab}
          onChange={setTab}
          options={[
            { value: "edit", label: "편집" },
            { value: "preview", label: "미리보기" },
          ]}
        />
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

      {tab === "preview" ? (
        <div>
          <style>{QUOTE_CSS}</style>
          <div className="mx-auto max-w-[800px] rounded-lg border border-nd-line p-6 shadow-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ---- 머리 칸 ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="견적번호">
              <span className="flex items-center gap-1.5">
                <span className="text-nd-body text-nd-fg-2">제</span>
                <Input value={form.quoteNo} onChange={(e) => set("quoteNo", e.target.value)} className="font-mono" placeholder="26-001" />
                <span className="text-nd-body text-nd-fg-2">호</span>
              </span>
            </Field>
            <Field label="견적일">
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="상태">
              <Select value={form.status} onChange={(e) => set("status", e.target.value as QuoteStatus)}>
                {QUOTE_STATUSES.map((s) => (
                  <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </Field>
            <Field label="단가 기준">
              <Select value={form.vatMode} onChange={(e) => set("vatMode", e.target.value as QuoteVatMode)} title="표의 단가가 부가세를 포함한 값인지">
                {(Object.keys(QUOTE_VAT_LABEL) as QuoteVatMode[]).map((m) => (
                  <option key={m} value={m}>{QUOTE_VAT_LABEL[m]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="수신" hint="「○○ 님 귀하」">
              <Input value={form.recipient} onChange={(e) => set("recipient", e.target.value)} placeholder="FNC" />
            </Field>
            <Field label="견적명">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="N.Flying 'into REM' 룸스프레이의 건" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="납품기한">
              <Input value={form.delivery ?? ""} onChange={(e) => set("delivery", e.target.value)} placeholder="발주 후 3주 · 납품 완료" />
            </Field>
            <Field label="대금 지불방식">
              <Input value={form.payment ?? ""} onChange={(e) => set("payment", e.target.value)} placeholder="납품 후 세금계산서 발행, 30일 내 입금" />
            </Field>
            <Field label="견적 유효기간">
              <Input value={form.validity ?? ""} onChange={(e) => set("validity", e.target.value)} placeholder="견적일로부터 7일간" />
            </Field>
          </div>

          {/* ---- 품목 ---- */}
          <div>
            <SectionHeader
              as="h3"
              title="품목"
              hint="공급가액은 수량 × 단가"
              className="mb-2"
              action={
                <Button variant="ghost" size="sm" icon={Plus} onClick={addLine}>
                  줄 추가
                </Button>
              }
            />
            <TableScroll>
              <Table minWidth={720} dense className="[&_td]:px-1 [&_th]:px-1">
                <thead>
                  <tr>
                    <Th className={thCls}>품명</Th>
                    <Th className={cn("w-36", thCls)}>규격/사양</Th>
                    <Th align="right" className={cn("w-20", thCls)}>수량</Th>
                    <Th align="right" className={cn("w-28", thCls)}>단가</Th>
                    <Th align="right" className={cn("w-28", thCls)}>공급가액</Th>
                    <Th className={cn("w-28", thCls)}>비고</Th>
                    <Th className={cn("w-8", thCls)} aria-label="동작" />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l) => (
                    <Tr key={l.id} hover={false} className="border-b-0">
                      <Td>
                        <Input size="sm" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} placeholder="품명" aria-label="품명" className="min-w-[10rem]" />
                      </Td>
                      <Td>
                        <Input size="sm" value={l.spec ?? ""} onChange={(e) => setLine(l.id, { spec: e.target.value })} placeholder="개/200ml" aria-label="규격/사양" />
                      </Td>
                      <Td>
                        <Input size="sm" type="number" inputMode="numeric" value={l.qty || ""} placeholder="0" onChange={(e) => setLine(l.id, { qty: Number(e.target.value) || 0 })} className="nd-num text-right" aria-label="수량" />
                      </Td>
                      <Td>
                        <Input size="sm" type="number" inputMode="numeric" value={l.unitPrice || ""} placeholder="0" onChange={(e) => setLine(l.id, { unitPrice: Number(e.target.value) || 0 })} className="nd-num text-right" aria-label="단가" />
                      </Td>
                      <Td num className="text-nd-fg-2">{quoteLineAmount(l).toLocaleString("ko-KR")}</Td>
                      <Td>
                        <Input size="sm" value={l.note ?? ""} onChange={(e) => setLine(l.id, { note: e.target.value })} placeholder="VAT포함" aria-label="비고" />
                      </Td>
                      <Td className="pr-0">
                        <IconButton icon={X} label="줄 삭제" size="sm" onClick={() => removeLine(l.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-nd-md bg-nd-sunken px-4 py-3">
              <div className="text-nd-body">
                <span className="text-nd-fg-2">일금</span>{" "}
                <b className="nd-num text-[16px] text-nd-fg">{koreanNumber(totals.total)}</b>{" "}
                <span className="text-nd-fg-2">원정</span>
                <span className="ml-2 text-nd-caption text-nd-fg-3">{QUOTE_VAT_LABEL[form.vatMode]}</span>
              </div>
              <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-nd-caption">
                <dt className="text-nd-fg-2">표 합계</dt>
                <dd className="text-right"><Money value={totals.sum} unit={false} /></dd>
                <dt className="text-nd-fg-2">공급가액</dt>
                <dd className="text-right"><Money value={totals.supply} unit={false} muted /></dd>
                <dt className="text-nd-fg-2">부가세</dt>
                <dd className="text-right"><Money value={totals.vat} unit={false} muted /></dd>
                <dt className="border-t border-nd-line pt-0.5 font-semibold text-nd-fg">합계금액</dt>
                <dd className="border-t border-nd-line pt-0.5 text-right font-semibold"><Money value={totals.total} unit={false} /></dd>
              </dl>
            </div>
          </div>

          {/* ---- 공급자 ---- */}
          <div className="rounded-nd-md border border-nd-line">
            <button
              type="button"
              onClick={() => setSupplierOpen((v) => !v)}
              aria-expanded={supplierOpen}
              className="flex w-full items-center justify-between gap-3 rounded-nd-md px-4 py-2.5 text-left text-nd-caption text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-sunken"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-nd-fg">공급자</span>
                <span className="text-nd-fg-3"> — {form.supplier.name || "(상호 없음)"} · {form.supplier.contact || "담당자 없음"} {form.supplier.phone}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-nd-fg-3">
                {supplierOpen ? "접기" : "고치기"}
                {supplierOpen ? <ChevronUp size={14} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden />}
              </span>
            </button>
            {supplierOpen && (
              <div className="grid gap-3 border-t border-nd-line px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                {SUPPLIER_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label} className={f.key === "address" ? "sm:col-span-2" : undefined}>
                    <Input size="sm" value={form.supplier[f.key]} onChange={(e) => setSupplier(f.key, e.target.value)} />
                  </Field>
                ))}
                <p className="text-nd-micro text-nd-fg-3 sm:col-span-2 lg:col-span-4">
                  여기서 고친 값은 이 견적서에 남고, 다음 새 견적서가 이어받습니다.
                </p>
              </div>
            )}
          </div>

          <Field label="메모" hint="견적서 아래에 함께 찍힙니다 — 배송비·샘플 조건 등">
            <Textarea rows={2} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} className="!min-h-0" />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">
              파일 <span className="ml-1 font-normal text-nd-fg-3">받은 견적 요청서, 보낸 PDF, 상대가 되보낸 수정본</span>
            </span>
            <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={saving} onError={setError} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
