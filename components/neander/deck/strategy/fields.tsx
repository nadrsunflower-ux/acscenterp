"use client";

// ============================================================
//  가정값 한 칸 — 가정 패널과 장표 칩 편집 창이 같이 쓴다
// ------------------------------------------------------------
//  숫자 칸은 치는 동안에는 계산을 다시 돌리지 않는다(반쯤 친 값으로 표가
//  춤추지 않게). Enter · 칸을 떠날 때 반영한다. 슬라이더는 끄는 대로 반영한다.
// ============================================================

import { useEffect, useState } from "react";
import type { ValueMeta } from "@/lib/neander/decks/model";
import type { AssumptionDef, AssumptionValue } from "@/lib/neander/decks/types";
import { dateLabel, formatAssumption } from "@/lib/neander/decks/format";

/** 값의 출처 표시 — 「실측(ERP, 2026.8.31)」 · 「가정으로 변경됨」 */
export function kindLabel(def: AssumptionDef, meta: ValueMeta | undefined): { text: string; cls: string } {
  if (meta?.overridden) return { text: def.kind === "실측" ? "가정으로 변경됨" : "변경됨", cls: "sd-k-changed" };
  if (meta?.note) return { text: `실측(${meta.note})`, cls: "sd-k-erp" };
  if (meta?.origin === "erp") return { text: `실측(ERP, ${meta.asOf ? dateLabel(meta.asOf) : ""})`, cls: "sd-k-erp" };
  if (meta?.origin === "snapshot") return { text: `실측(스냅샷, ${meta.asOf ? dateLabel(meta.asOf) : ""})`, cls: "sd-k-snap" };
  if (meta?.origin === "derived") return { text: "계산", cls: "" };
  if (def.kind === "실측") return { text: `실측(${def.asOf ?? "자료"})`, cls: "" };
  return { text: def.kind, cls: "" };
}

export function ValueEditor({
  def,
  value,
  onChange,
  autoFocus,
}: {
  def: AssumptionDef;
  value: AssumptionValue;
  onChange: (v: AssumptionValue) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  if (def.type === "bool") {
    return (
      <label className="sd-toggle">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{value === true ? "켜기" : "끄기"}</span>
      </label>
    );
  }

  if (def.type === "choice") {
    return (
      <select
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        aria-label={def.label}
        autoFocus={autoFocus}
      >
        {(def.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const commit = () => {
    const t = draft.trim().replace(/,/g, "");
    if (t === "") {
      if (value !== null) onChange(null);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    let x = n;
    if (def.min !== undefined) x = Math.max(def.min, x);
    if (def.max !== undefined) x = Math.min(def.max, x);
    if (x !== value) onChange(x);
    else setDraft(String(x));
  };

  const hasRange = def.min !== undefined && def.max !== undefined;
  return (
    <>
      <input
        type="number"
        value={draft}
        step={def.step ?? "any"}
        min={def.min}
        max={def.max}
        placeholder="입력 필요"
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setDraft(value === null ? "" : String(value));
        }}
        aria-label={def.label}
      />
      <span className="sd-field-unit">{def.unit}</span>
      {hasRange && (
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          value={typeof value === "number" ? value : (def.min as number)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${def.label} 슬라이더`}
        />
      )}
    </>
  );
}

export const shown = (def: AssumptionDef, v: AssumptionValue) =>
  def.type === "choice" ? def.options?.find((o) => o.value === v)?.label ?? formatAssumption(v, def.unit) : formatAssumption(v, def.unit);
