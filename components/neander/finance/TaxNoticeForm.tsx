"use client";

// ============================================================
//  세금 고지서 칸 — 넣기(목록 화면) · 고치기(한 장 화면)가 같이 쓴다
// ------------------------------------------------------------
//  고치기는 저장 버튼 없이 칸을 벗어나면 바로 저장한다(onCommit — 사용자 요청: 저장 버튼 없이).
//  넣기는 칸을 다 채운 뒤 「넣기」 한 번.
// ============================================================

import { FormRow, Field, Input, NumberInput, Select } from "@/components/neander/ui";
import { TAX_ITEM_NAMES, TAX_SITE_NAMES, itemDef, type TaxNotice } from "@/lib/neander/finance/tax-notice";

export type TaxDraft = Pick<TaxNotice, "site" | "level" | "item" | "amount" | "dueDate" | "period" | "office" | "payNo" | "note">;

export function TaxNoticeFields({
  value,
  onChange,
  onCommit,
  compact = false,
}: {
  value: TaxDraft;
  onChange: (next: TaxDraft) => void;
  /** 칸을 벗어날 때 그 칸만 — 고치기 화면 */
  onCommit?: (field: keyof TaxDraft, v: unknown) => void;
  /** 넣기 — 꼭 필요한 칸만 */
  compact?: boolean;
}) {
  const set = <K extends keyof TaxDraft>(k: K, v: TaxDraft[K], commitNow = false) => {
    const next = { ...value, [k]: v };
    // 세목을 고르면 국세 · 지방세도 따라온다
    if (k === "item") {
      const lvl = itemDef(v as string)?.level;
      if (lvl) next.level = lvl;
    }
    onChange(next);
    if (commitNow && onCommit) {
      onCommit(k, v ?? null);
      if (k === "item" && next.level !== value.level) onCommit("level", next.level ?? null);
    }
  };
  const blur = (k: keyof TaxDraft) => () => onCommit?.(k, value[k] ?? null);
  const items = value.item && !TAX_ITEM_NAMES.includes(value.item) ? [value.item, ...TAX_ITEM_NAMES] : TAX_ITEM_NAMES;

  return (
    <div className="flex flex-col gap-4">
      <FormRow className="grid-cols-1 sm:grid-cols-2">
        <Field label="사업자">
          <Select value={value.site ?? ""} onChange={(e) => set("site", e.target.value || undefined, true)}>
            <option value="">모름</option>
            {TAX_SITE_NAMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="세목">
          <Select value={value.item ?? ""} onChange={(e) => set("item", e.target.value || undefined, true)}>
            <option value="">모름</option>
            {items.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </FormRow>
      <FormRow className="grid-cols-1 sm:grid-cols-2">
        <Field label="낼 돈 (원)">
          <NumberInput
            value={value.amount ?? ""}
            onValueChange={(raw) => set("amount", raw ? Number(raw) : undefined)}
            onBlur={blur("amount")}
            placeholder="고지서의 납부할 세액"
          />
        </Field>
        <Field label="납부기한">
          {/* 날짜는 고르는 즉시 저장 — 폰 날짜 고르기 창은 닫혀도 칸에 초점이 남아 「벗어날 때」 가 안 올 수 있다 */}
          <Input type="date" value={value.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || undefined, true)} />
        </Field>
      </FormRow>
      {!compact ? (
        <>
          <FormRow className="grid-cols-1 sm:grid-cols-3">
            <Field label="국세 · 지방세">
              <Select value={value.level ?? ""} onChange={(e) => set("level", (e.target.value || undefined) as TaxDraft["level"], true)}>
                <option value="">모름</option>
                <option value="국세">국세</option>
                <option value="지방세">지방세</option>
              </Select>
            </Field>
            <Field label="귀속" hint="예: 2026년 2기 · 2026-07">
              <Input value={value.period ?? ""} onChange={(e) => set("period", e.target.value || undefined)} onBlur={blur("period")} />
            </Field>
            <Field label="세무서 · 구청">
              <Input value={value.office ?? ""} onChange={(e) => set("office", e.target.value || undefined)} onBlur={blur("office")} />
            </Field>
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="전자납부번호">
              <Input value={value.payNo ?? ""} onChange={(e) => set("payNo", e.target.value || undefined)} onBlur={blur("payNo")} />
            </Field>
            <Field label="메모">
              <Input value={value.note ?? ""} onChange={(e) => set("note", e.target.value || undefined)} onBlur={blur("note")} />
            </Field>
          </FormRow>
        </>
      ) : null}
    </div>
  );
}

export const TAX_STATE: Record<TaxNotice["state"], { label: string; tone: "warning" | "success" | "neutral" }> = {
  open: { label: "낼 것", tone: "warning" },
  paid: { label: "냈음", tone: "success" },
  dismissed: { label: "무시함", tone: "neutral" },
};

export const TAX_SOURCE: Record<TaxNotice["source"], string> = {
  sms: "문자",
  push: "앱 알림",
  mail: "메일",
  manual: "직접 넣음",
};
