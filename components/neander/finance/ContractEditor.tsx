"use client";

// ============================================================
//  계약서 편집창 — 파일이 본체, 나머지는 요약
// ------------------------------------------------------------
//  계약서 본문은 여기서 쓰지 않는다. 주최측 양식으로 오는 PDF·한글 파일이
//  원본이고, 우리는 그걸 프로젝트에 붙여 두는 것이다. 옆에 적는 계약명·
//  상대방·금액·기간·상태는 목록에서 파일을 열지 않고도 "얼마짜리, 언제
//  까지, 도장은 찍혔나" 를 읽기 위한 요약이다.
//
//  금액은 적힌 그대로 넣고 부가세 기준을 따로 고른다 — 계약서마다
//  「부가세 포함」 「별도」 가 섞여 오고, 이걸 잘못 읽으면 프로젝트 이익이
//  10% 틀린다. 아래에 갈라진 값을 바로 보여 주어 계약서 숫자와 맞춰
//  볼 수 있게 한다.
// ============================================================

import { useMemo, useState } from "react";
import { Button } from "@/components/neander/ui";
import { Money } from "@/components/neander/finance/ui";
import { DocFilesField } from "@/components/neander/finance/DocFiles";
import { deleteFinDoc, saveFinDoc, uploadFinDocFiles } from "@/lib/neander/finance/client";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABEL,
  type ContractStatus,
  type FinContractInput,
  type FinDocFile,
} from "@/lib/neander/finance/docs";
import { VAT_HINT, VAT_LABEL, VAT_MODES, splitVat, type VatMode } from "@/lib/neander/finance/project";

const cell =
  "h-8 w-full rounded border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-indigo-500 focus:bg-indigo-50/30";
const numCell = `${cell} text-right tabular-nums`;
const lbl = "flex flex-col gap-1 text-xs text-zinc-500";

export function ContractEditor({
  id: initialId,
  initial,
  initialFiles = [],
  onClose,
  onSaved,
  onDeleted,
  onApplyAmount,
}: {
  id?: string;
  initial: FinContractInput;
  initialFiles?: FinDocFile[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  onDeleted?: () => Promise<void>;
  /** 프로젝트 초안의 계약금액·부가세 기준에 이 값을 넣는다 */
  onApplyAmount?: (amount: number, vatMode: VatMode) => void;
}) {
  const [docId, setDocId] = useState<string | undefined>(initialId);
  const [form, setForm] = useState<FinContractInput>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [files, setFiles] = useState<FinDocFile[]>(initialFiles);
  const [pending, setPending] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== savedSnapshot || pending.length > 0;
  const split = useMemo(() => splitVat(form.amount, form.vatMode), [form.amount, form.vatMode]);

  const set = <K extends keyof FinContractInput>(k: K, v: FinContractInput[K]) => setForm((f) => ({ ...f, [k]: v }));

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
      if (uploadError) setError(`계약서 요약은 저장했습니다. 파일만 올리지 못했습니다 — ${uploadError}`);
      else setOkMsg("저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!docId || !onDeleted) return;
    if (!window.confirm(`계약서 「${form.title}」 를 지웁니다. 붙은 파일 ${files.length}개도 함께 사라집니다.`)) return;
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 sm:p-8" onClick={close}>
      <div role="dialog" aria-modal="true" className="w-full max-w-3xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-bold text-zinc-900">{docId ? "계약서" : "계약서 등록"}</h2>
          <button type="button" onClick={close} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100" aria-label="닫기">✕</button>
        </div>

        {(error || okMsg) && (
          <p className={`mx-6 mt-4 rounded-lg border px-3 py-2 text-xs ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {error ?? okMsg}
          </p>
        )}

        <div className="space-y-4 px-6 py-5">
          <div className={lbl}>
            파일 <span className="text-[10px] text-zinc-400">도장 찍힌 PDF 가 원본. 초안·수정본도 함께 두면 흐름이 남습니다</span>
            <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={saving} onError={setError} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <label className={lbl}>
              계약명
              <input value={form.title} onChange={(e) => set("title", e.target.value)} className={cell} placeholder="OST페어 관객체험프로그램 개발 및 운영 용역 계약" />
            </label>
            <label className={lbl}>
              상대방 <span className="text-[10px] text-zinc-400">주최사 · 발주처</span>
              <input value={form.counterparty} onChange={(e) => set("counterparty", e.target.value)} className={cell} placeholder="사단법인 제천국제음악영화제" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={lbl}>
              계약금액 <span className="text-[10px] text-zinc-400">적힌 그대로</span>
              <input type="number" inputMode="numeric" value={form.amount || ""} placeholder="0" onChange={(e) => set("amount", Number(e.target.value) || 0)} className={`${numCell} font-semibold`} />
            </label>
            <label className={lbl}>
              부가세
              <select value={form.vatMode} onChange={(e) => set("vatMode", e.target.value as VatMode)} className={`${cell} cursor-pointer`} title={VAT_HINT[form.vatMode]}>
                {VAT_MODES.map((m) => (
                  <option key={m} value={m}>{VAT_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <label className={lbl}>
              상태
              <select value={form.status} onChange={(e) => set("status", e.target.value as ContractStatus)} className={`${cell} cursor-pointer`}>
                {CONTRACT_STATUSES.map((s) => (
                  <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className={lbl}>
              체결일 <span className="text-[10px] text-zinc-400">날인한 날</span>
              <input type="date" value={form.signedDate ?? ""} onChange={(e) => set("signedDate", e.target.value || undefined)} className={cell} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,12rem))_1fr]">
            <label className={lbl}>
              계약기간 시작
              <input type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || undefined)} className={cell} />
            </label>
            <label className={lbl}>
              계약기간 끝
              <input type="date" value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || undefined)} className={cell} />
            </label>
            <dl className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-0.5 self-end rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs">
              <dt className="text-zinc-500">공급가액</dt>
              <dd className="text-right"><Money value={split.supply} unit={false} /></dd>
              <dt className="text-zinc-500">부가세</dt>
              <dd className="text-right"><Money value={split.vat} unit={false} muted /></dd>
              <dt className="font-semibold">총액</dt>
              <dd className="text-right font-semibold"><Money value={split.total} unit={false} /></dd>
            </dl>
          </div>

          <label className={lbl}>
            메모 <span className="text-[10px] text-zinc-400">지급 조건 · 보증보험 · 지체상금 같은, 나중에 찾게 될 조항</span>
            <textarea rows={3} value={form.note ?? ""} onChange={(e) => set("note", e.target.value || undefined)} className={`${cell} h-auto resize-y py-1.5`} placeholder="검수 완료일로부터 21일 이내 전액 · 계약이행보증보험 10% · 지체상금 1/1000" />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-6 py-4">
          <div className="flex items-center gap-2">
            {docId && onDeleted && (
              <Button variant="danger" className="h-8 px-3 text-xs" onClick={remove} disabled={saving}>삭제</Button>
            )}
            {onApplyAmount && (
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={saving || form.amount === 0}
                onClick={() => {
                  onApplyAmount(form.amount, form.vatMode);
                  setOkMsg(`프로젝트 계약금액 칸에 ${form.amount.toLocaleString("ko-KR")} (${VAT_LABEL[form.vatMode]}) 을 넣었습니다. 프로젝트 화면에서 「저장」 해야 남습니다.`);
                }}
                title="프로젝트 수입 칸의 계약금액·부가세 기준에 이 값을 넣습니다 (프로젝트 저장은 따로)"
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
