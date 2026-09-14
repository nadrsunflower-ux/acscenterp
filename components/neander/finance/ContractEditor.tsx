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

import {
  useMemo,
  useState,
} from "react";
import { Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  Field,
  InlineNotice,
  Input,
  Money,
  Select,
  Textarea,
  useConfirm,
} from "@/components/neander/ui";
import { DocFilesField } from "@/components/neander/finance/DocFiles";
import {
  deleteFinDoc,
  saveFinDoc,
  uploadFinDocFiles,
} from "@/lib/neander/finance/client";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABEL,
  type ContractStatus,
  type FinContractInput,
  type FinDocFile,
} from "@/lib/neander/finance/docs";
import {
  VAT_HINT,
  VAT_LABEL,
  VAT_MODES,
  splitVat,
  type VatMode,
} from "@/lib/neander/finance/project";

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
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: `계약서 「${form.title}」 를 지울까요?`,
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

  return (
    <Dialog
      open
      onClose={() => void close()}
      size="xl"
      closeOnOverlay={false}
      title={docId ? "계약서" : "계약서 등록"}
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
      <div className="space-y-4">
        {(error || okMsg) && (
          <InlineNotice tone={error ? "danger" : "success"}>{error ?? okMsg}</InlineNotice>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-nd-caption font-medium text-nd-fg-2">
            파일 <span className="ml-1 font-normal text-nd-fg-3">도장 찍힌 PDF 가 원본. 초안·수정본도 함께 두면 흐름이 남습니다</span>
          </span>
          <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={saving} onError={setError} />
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Field label="계약명">
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="OST페어 관객체험프로그램 개발 및 운영 용역 계약" />
          </Field>
          <Field label="상대방" hint="주최사 · 발주처">
            <Input value={form.counterparty} onChange={(e) => set("counterparty", e.target.value)} placeholder="사단법인 제천국제음악영화제" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="계약금액" hint="적힌 그대로">
            <Input
              type="number"
              inputMode="numeric"
              value={form.amount || ""}
              placeholder="0"
              onChange={(e) => set("amount", Number(e.target.value) || 0)}
              className="nd-num text-right font-semibold"
            />
          </Field>
          <Field label="부가세">
            <Select value={form.vatMode} onChange={(e) => set("vatMode", e.target.value as VatMode)} title={VAT_HINT[form.vatMode]}>
              {VAT_MODES.map((m) => (
                <option key={m} value={m}>{VAT_LABEL[m]}</option>
              ))}
            </Select>
          </Field>
          <Field label="상태">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as ContractStatus)}>
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="체결일" hint="날인한 날">
            <Input type="date" value={form.signedDate ?? ""} onChange={(e) => set("signedDate", e.target.value || undefined)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,12rem))_1fr]">
          <Field label="계약기간 시작">
            <Input type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || undefined)} />
          </Field>
          <Field label="계약기간 끝">
            <Input type="date" value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || undefined)} />
          </Field>
          <dl className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-0.5 self-end rounded-nd-md bg-nd-sunken px-3.5 py-2 text-nd-caption">
            <dt className="text-nd-fg-2">공급가액</dt>
            <dd className="text-right"><Money value={split.supply} unit={false} /></dd>
            <dt className="text-nd-fg-2">부가세</dt>
            <dd className="text-right"><Money value={split.vat} unit={false} muted /></dd>
            <dt className="font-semibold text-nd-fg">총액</dt>
            <dd className="text-right font-semibold"><Money value={split.total} unit={false} /></dd>
          </dl>
        </div>

        <Field label="메모" hint="지급 조건 · 보증보험 · 지체상금 같은, 나중에 찾게 될 조항">
          <Textarea
            rows={3}
            value={form.note ?? ""}
            onChange={(e) => set("note", e.target.value || undefined)}
            placeholder="검수 완료일로부터 21일 이내 전액 · 계약이행보증보험 10% · 지체상금 1/1000"
          />
        </Field>
      </div>
    </Dialog>
  );
}
