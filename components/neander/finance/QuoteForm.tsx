"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Button,
  Checkbox,
  Disclosure,
  Field,
  InlineNotice,
  Input,
  NumberInput,
  Select,
  Textarea,
} from "@/components/neander/ui";
import {
  newQuoteLine,
  quoteLineAmount,
  quoteTotals,
  QUOTE_VAT_LABEL,
  type FinQuoteInput,
  type FinQuoteLine,
  type FinSupplier,
  type QuoteReceiver,
} from "@/lib/neander/finance/docs";
import {
  CUSTOM_PRESET,
  DEFAULT_SEAL_ID,
  NO_SEAL,
  SEALS,
  SUPPLIER_PRESETS,
  canonicalSealId,
  findPreset,
  matchPresetId,
  sealOwnerFields,
} from "@/lib/neander/finance/supplier";
import {
  QUOTE_BUSINESS_OPTIONS,
  QUOTE_CATEGORIES,
  hasBusinessChoice,
  toggleBusinessChoice,
} from "@/lib/neander/finance/quote-options";
import {
  QUOTE_ASSIST_FILE_ACCEPT,
  QUOTE_ASSIST_LIMITS,
  type QuoteAssistMode,
  type QuoteAssistResult,
} from "@/lib/neander/finance/quote-assist";
import { requestQuoteAssist } from "@/lib/neander/finance/quote-assist-client";

const won = (n: number) => n.toLocaleString("ko-KR");

function FormSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-nd-section text-nd-fg">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function BusinessChoices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <p className="text-nd-caption text-nd-fg-3">{label} · 여러 개 선택할 수 있습니다</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={hasBusinessChoice(value, option) ? "soft" : "secondary"}
            className="!h-auto min-h-7 !whitespace-normal py-1 text-left"
            aria-pressed={hasBusinessChoice(value, option)}
            onClick={() => onChange(toggleBusinessChoice(value, option))}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** 별도 견적서 프로그램의 입력 흐름을 ERP 문서 형식으로 편집한다. 저장은 바깥 편집창이 맡는다. */
export function QuoteForm({
  value,
  onChange,
  disabled = false,
}: {
  value: FinQuoteInput;
  onChange: (next: FinQuoteInput) => void;
  disabled?: boolean;
}) {
  const [supplierMode, setSupplierMode] = useState(() => matchPresetId(value.supplier));
  const presetId = supplierMode === CUSTOM_PRESET ? CUSTOM_PRESET : matchPresetId(value.supplier);
  const businessOptions = QUOTE_BUSINESS_OPTIONS[presetId];
  const sealId = canonicalSealId(value.sealId) ?? DEFAULT_SEAL_ID;
  const knownSeal = sealId === NO_SEAL || SEALS.some((seal) => seal.id === sealId);
  const totals = quoteTotals(value);
  const set = <K extends keyof FinQuoteInput>(key: K, next: FinQuoteInput[K]) => {
    if (!disabled) onChange({ ...value, [key]: next });
  };
  const setSupplier = (key: keyof FinSupplier, next: string) =>
    set("supplier", { ...value.supplier, [key]: next });
  const setReceiver = (key: keyof QuoteReceiver, next: string) =>
    set("receiver", { ...value.receiver, [key]: next });
  const setLine = (id: string, patch: Partial<FinQuoteLine>) =>
    set("lines", value.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));

  const applyPreset = (id: string) => {
    if (disabled) return;
    setSupplierMode(id);
    const preset = findPreset(id);
    if (preset) onChange({ ...value, supplier: { ...preset.supplier }, sealId: preset.sealId });
  };
  const duplicateLine = (id: string) => {
    const index = value.lines.findIndex((line) => line.id === id);
    if (index < 0) return;
    const copy = { ...value.lines[index], id: newQuoteLine().id };
    set("lines", [...value.lines.slice(0, index + 1), copy, ...value.lines.slice(index + 1)]);
  };

  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 space-y-6 border-0 p-0">
      <FormSection title="기본 정보">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="견적번호">
            <Input value={value.quoteNo} onChange={(e) => set("quoteNo", e.target.value)} />
          </Field>
          <Field label="견적일">
            <Input type="date" value={value.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="견적명" className="sm:col-span-2">
            <Input value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="프로젝트 · 견적 내용" />
          </Field>
          <Field label="분류" className="sm:col-span-2">
            <Select value={value.category ?? ""} onChange={(e) => set("category", e.target.value)}>
              <option value="">분류 없음</option>
              {value.category && !(QUOTE_CATEGORIES as readonly string[]).includes(value.category) && (
                <option value={value.category}>{value.category}</option>
              )}
              {QUOTE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </Select>
          </Field>
        </div>
      </FormSection>

      <QuoteAssist value={value} onChange={onChange} disabled={disabled} />

      <FormSection title="공급자 · 우리 회사">
        <Field label="공급자 선택" hint="선택하면 사업자 정보와 인감이 함께 채워집니다. 채운 뒤에도 아래에서 고칠 수 있습니다.">
          <Select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
            {SUPPLIER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            <option value={CUSTOM_PRESET}>직접 입력</option>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="공급자 상호">
            <Input value={value.supplier.name} onChange={(e) => setSupplier("name", e.target.value)} />
          </Field>
          <Field label="공급자 사업자등록번호">
            <Input value={value.supplier.bizNo} onChange={(e) => setSupplier("bizNo", e.target.value)} placeholder="000-00-00000" />
          </Field>
          <Field label="공급자 대표자">
            <Input value={value.supplier.ceo} onChange={(e) => setSupplier("ceo", e.target.value)} />
          </Field>
          <Field label="인감">
            <Select
              value={sealId}
              onChange={(e) => {
                const nextSeal = e.target.value;
                const owner = sealOwnerFields(nextSeal);
                if (!disabled) onChange({ ...value, sealId: nextSeal, supplier: { ...value.supplier, ...owner } });
              }}
            >
              {SEALS.map((seal) => <option key={seal.id} value={seal.id}>{seal.label}</option>)}
              <option value={NO_SEAL}>인감 없음</option>
              {!knownSeal && <option value={sealId}>등록되지 않은 인감 · 찍지 않음</option>}
            </Select>
          </Field>
          <Field label="공급자 소재지" className="sm:col-span-2">
            <Input value={value.supplier.address} onChange={(e) => setSupplier("address", e.target.value)} />
          </Field>
          <Field label="담당자">
            <Input value={value.supplier.contact} onChange={(e) => setSupplier("contact", e.target.value)} />
          </Field>
          <Field label="연락처">
            <Input type="tel" value={value.supplier.phone} onChange={(e) => setSupplier("phone", e.target.value)} />
          </Field>
          <Field label="업태" className="sm:col-span-2">
            <Input value={value.supplier.bizType} onChange={(e) => setSupplier("bizType", e.target.value)} placeholder="직접 입력하거나 아래에서 선택" />
          </Field>
        </div>
        {businessOptions && <BusinessChoices label="업태 선택" options={businessOptions.types} value={value.supplier.bizType} onChange={(next) => setSupplier("bizType", next)} />}
        <Field label="종목">
          <Input value={value.supplier.bizItem} onChange={(e) => setSupplier("bizItem", e.target.value)} placeholder="직접 입력하거나 아래에서 선택" />
        </Field>
        {businessOptions && <BusinessChoices label="종목 선택" options={businessOptions.items} value={value.supplier.bizItem} onChange={(next) => setSupplier("bizItem", next)} />}
      </FormSection>

      <FormSection title="수신자 · 상대방">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="수신 상호">
            <Input value={value.recipient} onChange={(e) => set("recipient", e.target.value)} />
          </Field>
          <Field label="수신자 대표자">
            <Input value={value.receiver?.ceo ?? ""} onChange={(e) => setReceiver("ceo", e.target.value)} />
          </Field>
          <Field label="수신자 사업자등록번호" className="sm:col-span-2">
            <Input value={value.receiver?.bizNo ?? ""} onChange={(e) => setReceiver("bizNo", e.target.value)} />
          </Field>
          <Field label="수신자 주소" className="sm:col-span-2">
            <Input value={value.receiver?.address ?? ""} onChange={(e) => setReceiver("address", e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title={`견적 품목 · ${value.lines.length}개`}
        action={<Button size="sm" variant="secondary" icon={Plus} onClick={() => set("lines", [...value.lines, newQuoteLine()])}>품목 추가</Button>}
      >
        {value.lines.length === 0 && <p className="text-nd-caption text-nd-fg-3">품목을 추가해 견적 내용을 입력하세요.</p>}
        <div className="space-y-3">
          {value.lines.map((line, index) => (
            <section key={line.id} className="space-y-3 rounded-nd-md border border-nd-line p-3" aria-label={`${index + 1}번 품목`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-nd-caption font-medium text-nd-fg-2">품목 {index + 1}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Copy} aria-label={`${index + 1}번 품목 복제`} onClick={() => duplicateLine(line.id)}>복제</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`${index + 1}번 품목 삭제`} onClick={() => set("lines", value.lines.filter((item) => item.id !== line.id))}>삭제</Button>
                </div>
              </div>
              <Field label="품명">
                <Input aria-label={`${index + 1}번 품명`} value={line.name} onChange={(e) => setLine(line.id, { name: e.target.value })} />
              </Field>
              <Field label="규격 / 사양">
                <Input aria-label={`${index + 1}번 규격 / 사양`} value={line.spec ?? ""} onChange={(e) => setLine(line.id, { spec: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="수량">
                  <NumberInput aria-label={`${index + 1}번 수량`} decimal value={line.qty} onValueChange={(raw) => setLine(line.id, { qty: Number(raw) || 0 })} />
                </Field>
                <Field label="단가 · 원">
                  <NumberInput aria-label={`${index + 1}번 단가`} negative value={line.unitPrice} onValueChange={(raw) => setLine(line.id, { unitPrice: Number(raw) || 0 })} />
                </Field>
              </div>
              <Field label="품목 비고">
                <Input aria-label={`${index + 1}번 품목 비고`} value={line.note ?? ""} onChange={(e) => setLine(line.id, { note: e.target.value })} />
              </Field>
              <p className="text-right text-nd-caption text-nd-fg-2">금액 <b className="nd-num ml-2 text-nd-fg">{won(quoteLineAmount(line))}원</b></p>
            </section>
          ))}
        </div>
        <dl className="space-y-2 rounded-nd-md bg-nd-sunken p-4 text-nd-body">
          <div className="flex justify-between gap-3"><dt className="text-nd-fg-2">공급가액</dt><dd className="nd-num">{won(totals.supply)}원</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-nd-fg-2">부가세</dt><dd className="nd-num">{won(totals.vat)}원</dd></div>
          <div className="flex justify-between gap-3 border-t border-nd-line pt-2 font-semibold"><dt>총 합계</dt><dd className="nd-num">{won(totals.total)}원</dd></div>
        </dl>
      </FormSection>

      <FormSection title="납품 · 결제 조건">
        <Field label="납품기한"><Input value={value.delivery ?? ""} onChange={(e) => set("delivery", e.target.value)} /></Field>
        <Field label="대금 지불방식"><Input value={value.payment ?? ""} onChange={(e) => set("payment", e.target.value)} /></Field>
        <Field label="견적 유효기간"><Input value={value.validity ?? ""} onChange={(e) => set("validity", e.target.value)} /></Field>
        <Field label="메모" hint="견적서 아래에 함께 표시됩니다.">
          <Textarea rows={3} value={value.note ?? ""} onChange={(e) => set("note", e.target.value)} />
        </Field>
      </FormSection>
    </fieldset>
  );
}

function QuoteAssist({ value, onChange, disabled }: { value: FinQuoteInput; onChange: (next: FinQuoteInput) => void; disabled: boolean }) {
  const [mode, setMode] = useState<QuoteAssistMode>("items");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteAssistResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [sourceSnapshot, setSourceSnapshot] = useState("");
  const [includeTitle, setIncludeTitle] = useState(false);
  const [includeNote, setIncludeNote] = useState(false);
  const requestRevision = useRef(0);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRevision.current += 1;
    };
  }, []);

  const resetResult = () => {
    setResult(null);
    setApplied(null);
    setError(null);
    setIncludeTitle(false);
    setIncludeNote(false);
  };
  const request = async () => {
    if (disabled || loading) return;
    resetResult();
    if (!text.trim() && !file) {
      setError("설명을 입력하거나 참고 파일을 선택해 주세요.");
      return;
    }
    const revision = ++requestRevision.current;
    setSourceSnapshot(JSON.stringify(value));
    setLoading(true);
    try {
      const next = await requestQuoteAssist({ mode, text: text.trim() || undefined, file: file ?? undefined, projectId: value.projectId });
      if (mounted.current && revision === requestRevision.current) setResult(next);
    } catch (e) {
      if (mounted.current && revision === requestRevision.current) setError(e instanceof Error ? e.message : "내용을 분석하지 못했습니다.");
    } finally {
      if (mounted.current && revision === requestRevision.current) setLoading(false);
    }
  };

  const applyItems = (replace: boolean) => {
    if (disabled || result?.mode !== "items") return;
    const lines = result.lines.map((line) => ({ ...line, id: newQuoteLine().id }));
    // 첫 빈 줄만 있던 초안은 비워 둔 양식일 뿐이므로 추가 시 그 빈 줄을 함께 붙이지 않는다.
    const existing = value.lines.filter((line) => line.name.trim() || line.spec?.trim() || line.note?.trim() || line.unitPrice !== 0 || line.qty !== 1);
    onChange({
      ...value,
      lines: replace ? lines : [...existing, ...lines],
      title: includeTitle && result.title ? result.title : value.title,
      note: includeNote && result.note ? result.note : value.note,
    });
    setResult(null);
    setApplied(`${lines.length}개 품목을 ${replace ? "교체" : "추가"}했습니다. 내용을 확인한 뒤 견적서를 저장하세요.`);
  };
  const applyReceiver = () => {
    if (disabled || result?.mode !== "receiver") return;
    const receiver = { ...value.receiver };
    for (const key of ["ceo", "bizNo", "address"] as const) {
      const next = result.receiver[key]?.trim();
      if (next) receiver[key] = next;
    }
    onChange({ ...value, recipient: result.recipient?.trim() || value.recipient, receiver });
    setResult(null);
    setApplied("분석된 수신자 정보를 적용했습니다. 내용을 확인한 뒤 견적서를 저장하세요.");
  };

  return (
    <Disclosure title="AI 작성 도우미" icon={Sparkles} description="요청서로 품목을 만들거나 사업자 정보를 읽어옵니다" keepMounted>
      <div className="space-y-3">
        <fieldset disabled={loading || disabled} className="m-0 min-w-0 space-y-3 border-0 p-0">
          <Field label="도움받을 내용">
            <Select value={mode} onChange={(e) => { setMode(e.target.value as QuoteAssistMode); resetResult(); }}>
              <option value="items">견적 품목 초안 만들기</option>
              <option value="receiver">수신자 사업자 정보 읽기</option>
            </Select>
          </Field>
          <Field label={mode === "items" ? "요청 내용" : "수신자 정보"} hint="텍스트와 참고 파일을 함께 사용할 수 있습니다.">
            <Textarea
              rows={4}
              maxLength={QUOTE_ASSIST_LIMITS.textChars}
              value={text}
              onChange={(e) => { setText(e.target.value); resetResult(); }}
              placeholder={mode === "items" ? "예: 행사 2일간 향수 체험 부스 운영. 운영인력 2명, 체험 키트 100개…" : "사업자등록증을 첨부하거나 상호 · 대표자 · 사업자번호 · 주소를 붙여넣으세요."}
            />
          </Field>
          <Field label="참고 파일" hint="이미지 · PDF · 엑셀 · 워드 · HWPX · 텍스트, 최대 4MB">
            <Input
              ref={fileInput}
              type="file"
              accept={QUOTE_ASSIST_FILE_ACCEPT}
              className="!h-auto min-h-9 py-1.5"
              onChange={(e) => {
                resetResult();
                const next = e.target.files?.[0] ?? null;
                if (next && next.size > QUOTE_ASSIST_LIMITS.fileBytes) {
                  setFile(null);
                  e.target.value = "";
                  setError("참고 파일은 4MB 이하로 선택해 주세요.");
                } else setFile(next);
              }}
            />
          </Field>
          {file && <div className="flex items-center justify-between gap-2 text-nd-caption text-nd-fg-2"><span className="truncate">{file.name}</span><Button size="sm" variant="ghost" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; resetResult(); }}>파일 선택 해제</Button></div>}
        </fieldset>
        <Button size="sm" variant="secondary" icon={Sparkles} loading={loading} disabled={disabled || (!text.trim() && !file)} onClick={() => void request()}>
          {loading ? "분석 중…" : mode === "items" ? "품목 초안 만들기" : "사업자 정보 읽기"}
        </Button>
        {loading && <p role="status" className="text-nd-caption text-nd-fg-3">분석이 끝나면 먼저 결과를 보여 드립니다. 견적서는 계속 편집할 수 있습니다.</p>}
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        {applied && <InlineNotice tone="success">{applied}</InlineNotice>}
        {result && (
          <div className="space-y-3 rounded-nd-md border border-nd-line p-3" aria-label="AI 분석 결과" aria-live="polite">
            <p className="text-nd-body font-medium text-nd-fg">분석 결과를 확인하고 적용하세요</p>
            {result.mode === "items" && <p className="text-nd-caption text-nd-fg-2">현재 단가 기준은 {QUOTE_VAT_LABEL[value.vatMode]}입니다. 원본 단가의 부가세 기준을 확인해 주세요.</p>}
            {sourceSnapshot !== JSON.stringify(value) && <InlineNotice tone="warning">분석을 요청한 뒤 견적 내용이 바뀌었습니다. 아래 결과와 현재 내용을 확인한 뒤 적용하세요.</InlineNotice>}
            {result.mode === "items" && result.warnings?.map((warning, index) => <InlineNotice key={index} tone="warning">{warning}</InlineNotice>)}
            {result.mode === "items" ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-nd-caption">
                    <thead><tr className="border-b border-nd-line text-nd-fg-3"><th className="py-2 pr-2 font-medium">품목 · 규격</th><th className="px-2 py-2 text-right font-medium">수량</th><th className="py-2 pl-2 text-right font-medium">단가</th></tr></thead>
                    <tbody>{result.lines.map((line, index) => <tr key={index} className="border-b border-nd-line last:border-0"><td className="py-2 pr-2"><p>{line.name}</p>{line.spec && <p className="mt-0.5 text-nd-fg-3">{line.spec}</p>}{line.note && <p className="mt-0.5 text-nd-fg-3">{line.note}</p>}</td><td className="nd-num px-2 py-2 text-right">{won(line.qty)}</td><td className="nd-num whitespace-nowrap py-2 pl-2 text-right">{won(line.unitPrice)}원</td></tr>)}</tbody>
                  </table>
                </div>
                {result.title && <Checkbox checked={includeTitle} onChange={(e) => setIncludeTitle(e.target.checked)} label={`견적명도 적용: ${result.title}`} />}
                {result.note && <div><Checkbox checked={includeNote} onChange={(e) => setIncludeNote(e.target.checked)} label="제안된 메모도 적용" /><p className="mt-1 whitespace-pre-wrap text-nd-caption text-nd-fg-3">{result.note}</p></div>}
                <p className="text-nd-caption text-nd-fg-3">단가와 수량은 적용 후 품목에서 고칠 수 있습니다. 기존 품목을 교체하면 현재 품목 전체가 바뀝니다.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={disabled || result.lines.length === 0} onClick={() => applyItems(false)}>기존 품목에 추가</Button>
                  <Button size="sm" variant="secondary" disabled={disabled || result.lines.length === 0} onClick={() => applyItems(true)}>기존 품목 교체</Button>
                </div>
              </>
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-nd-caption">
                  {[["상호", result.recipient], ["대표자", result.receiver.ceo], ["사업자등록번호", result.receiver.bizNo], ["주소", result.receiver.address]].map(([label, next]) => <div key={label} className="contents"><dt className="text-nd-fg-3">{label}</dt><dd className="break-words">{next || "읽지 못함"}</dd></div>)}
                </dl>
                <p className="text-nd-caption text-nd-fg-3">읽어온 항목만 현재 수신자 정보에 반영합니다. 빈 항목은 기존 값을 유지합니다.</p>
                <Button size="sm" disabled={disabled} onClick={applyReceiver}>수신자 정보 적용</Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setResult(null)}>결과 닫기</Button>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
