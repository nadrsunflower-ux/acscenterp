"use client";

// ============================================================
//  거래 편집 모달 — 원장/검토함 공용
// ------------------------------------------------------------
//  파생 값(순금액·회계코드 등)은 입력받지 않고 즉시 계산해 보여준다.
//  "지금 무엇이 저장되는지"가 화면에 그대로 드러나야 재무 데이터를
//  믿고 고칠 수 있다.
// ============================================================

import { useEffect, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/neander/ui";
import { AccountPicker } from "./AccountPicker";
import { Money } from "./ui";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import {
  TX_TYPES,
  dedupHashOf,
  netAmount,
  type FinTransaction,
  type FinTransactionInput,
  type TxType,
  type ClassificationStatus,
} from "@/lib/neander/finance/types";

const BIZ_MAJORS = ["B2C", "B2B", "공용", "해당없음"];

export function TransactionEditor({
  tx,
  accounts,
  paymentMethods,
  knownBizMinors,
  isNew = false,
  onSave,
  onDelete,
  onClose,
}: {
  tx: FinTransaction;
  /** 새 거래 입력 모드 — 삭제를 숨기고 문구를 바꾼다 */
  isNew?: boolean;
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  knownBizMinors: string[];
  onSave: (patch: Partial<FinTransactionInput>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FinTransaction>(tx);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setForm(tx);
    setConfirmDelete(false);
  }, [tx]);

  const set = <K extends keyof FinTransaction>(k: K, v: FinTransaction[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const net = netAmount(form);
  const pm = paymentMethods.find((p) => p.last4 === form.last4);

  const save = async (status?: ClassificationStatus) => {
    setSaving(true);
    try {
      await onSave({
        date: form.date,
        last4: form.last4 || undefined,
        txType: form.txType,
        bizMajor: form.bizMajor || undefined,
        bizMinor: form.bizMinor || undefined,
        acctMajor: form.acctMajor || undefined,
        acctMid: form.acctMid || undefined,
        acctMinor: form.acctMinor || undefined,
        vendor: form.vendor || undefined,
        acctNote: form.acctNote || undefined,
        gross: Number(form.gross) || 0,
        adjust: Number(form.adjust) || 0,
        site: form.site || undefined,
        note: form.note || undefined,
        personalUse: form.personalUse || undefined,
        projectCode: form.projectCode || undefined,
        refundMatchId: form.refundMatchId || undefined,
        status: status ?? form.status,
        // 날짜·계좌·거래처·금액이 바뀌면 중복 키도 다시 계산해야 한다
        dedupHash: dedupHashOf({
          date: form.date,
          last4: form.last4,
          vendor: form.vendor,
          gross: Number(form.gross) || 0,
          txType: form.txType,
        }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">
              {isNew ? "거래 추가" : "거래 수정"}
            </h2>
            {form.classReason && (
              <p className="mt-1 text-sm text-zinc-500">근거: {form.classReason}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="거래일" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="거래유형" required>
            <Select
              value={form.txType}
              onChange={(e) => {
                const next = e.target.value as TxType;
                // 거래유형이 바뀌면 계정 후보가 통째로 달라진다 → 초기화
                setForm((f) => ({
                  ...f,
                  txType: next,
                  acctMajor: undefined,
                  acctMid: undefined,
                  acctMinor: undefined,
                }));
              }}
            >
              {TX_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="계좌/카번" hint={pm ? `${pm.alias} · ${pm.site}` : "뒷 4자리"}>
            <Select
              value={form.last4 ?? ""}
              onChange={(e) => set("last4", e.target.value || undefined)}
            >
              <option value="">(없음)</option>
              {paymentMethods.map((p) => (
                <option key={p.last4} value={p.last4}>
                  {p.last4} · {p.alias}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="사업장">
            <Input
              value={form.site ?? ""}
              placeholder={pm?.site ?? "네안데르"}
              onChange={(e) => set("site", e.target.value || undefined)}
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="거래처">
            <Input
              value={form.vendor ?? ""}
              onChange={(e) => set("vendor", e.target.value || undefined)}
            />
          </Field>
          <Field label="사업대분류">
            <Select
              value={form.bizMajor ?? ""}
              onChange={(e) => set("bizMajor", e.target.value || undefined)}
            >
              <option value="">(미정)</option>
              {BIZ_MAJORS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
          </Field>
          <Field label="사업소분류">
            <Input
              list="fin-biz-minors"
              value={form.bizMinor ?? ""}
              onChange={(e) => set("bizMinor", e.target.value || undefined)}
            />
          </Field>
        </div>
        <datalist id="fin-biz-minors">
          {knownBizMinors.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>

        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium text-zinc-700">계정</p>
          <AccountPicker
            accounts={accounts}
            txType={form.txType}
            value={{
              acctMajor: form.acctMajor,
              acctMid: form.acctMid,
              acctMinor: form.acctMinor,
            }}
            onChange={(v) => setForm((f) => ({ ...f, ...v }))}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="원금액" required>
            <Input
              type="number"
              value={String(form.gross ?? 0)}
              onChange={(e) => set("gross", Number(e.target.value))}
            />
          </Field>
          <Field label="조정금액" hint="환불·부분취소분">
            <Input
              type="number"
              value={String(form.adjust ?? 0)}
              onChange={(e) => set("adjust", Number(e.target.value))}
            />
          </Field>
          <div className="flex flex-col justify-end pb-1">
            <span className="text-sm font-medium text-zinc-700">순금액</span>
            <span className="mt-1.5 text-lg font-bold">
              <Money value={net} />
            </span>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="프로젝트코드">
            <Input
              value={form.projectCode ?? ""}
              onChange={(e) => set("projectCode", e.target.value || undefined)}
            />
          </Field>
          <Field label="환급매칭ID" hint="원거래와 공유하는 라벨">
            <Input
              value={form.refundMatchId ?? ""}
              onChange={(e) => set("refundMatchId", e.target.value || undefined)}
            />
          </Field>
          <Field label="개인사용">
            <Select
              value={form.personalUse ? "Y" : ""}
              onChange={(e) => set("personalUse", e.target.value === "Y" || undefined)}
            >
              <option value="">아니오</option>
              <option value="Y">예 (임직원 개인 사용분)</option>
            </Select>
          </Field>
        </div>

        <Field label="비고" className="mt-3">
          <Textarea
            rows={2}
            value={form.note ?? ""}
            onChange={(e) => set("note", e.target.value || undefined)}
          />
        </Field>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            {!isNew &&
              onDelete &&
              (confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-rose-600">정말 삭제할까요?</span>
                  <Button
                    variant="danger"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await onDelete();
                        onClose();
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    삭제
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    취소
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  삭제
                </Button>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              취소
            </Button>
            <Button onClick={() => save("confirmed")} disabled={saving || !form.date}>
              {saving ? "저장 중…" : isNew ? "추가" : "확정 저장"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
