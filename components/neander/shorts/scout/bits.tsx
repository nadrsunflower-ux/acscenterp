"use client";

// 정찰 화면 공용 조각 — 나라 · 수명 · 한국 상태 · AI 재현 배지, 나라 고르기
import { Badge, Select, type Tone } from "@/components/neander/ui";
import {
  AI_LEVEL_LABEL,
  COUNTRIES,
  KOREA_LABEL,
  LANG_DEP_LABEL,
  LIFECYCLE_LABEL,
  ageDays,
  countryLabel,
  type AiLevel,
  type KoreaStatus,
  type LanguageDependence,
  type Lifecycle,
} from "@/lib/neander/shorts/scout";

const LIFE_TONE: Record<Lifecycle, Tone> = { seed: "info", rising: "success", steady: "neutral", saturating: "warning", faded: "neutral", unknown: "neutral" };
const KOREA_TONE: Record<KoreaStatus, Tone> = { unchecked: "neutral", none_in_sample: "accent", some: "info", spread: "warning" };
const AI_TONE: Record<AiLevel, Tone> = { easy: "success", possible: "info", hard: "warning" };

export const LifeBadge = ({ stage, basis }: { stage: Lifecycle; basis?: string }) => (
  <span title={basis}>
    <Badge tone={LIFE_TONE[stage]} size="sm">{LIFECYCLE_LABEL[stage]}</Badge>
  </span>
);
export const KoreaBadge = ({ status }: { status: KoreaStatus }) => <Badge tone={KOREA_TONE[status]} size="sm">{KOREA_LABEL[status]}</Badge>;
export const AiBadge = ({ level }: { level: AiLevel }) => <Badge tone={AI_TONE[level]} size="sm">{AI_LEVEL_LABEL[level]}</Badge>;
export const LangBadge = ({ dep }: { dep: LanguageDependence }) => <Badge tone={dep === "visual" ? "success" : dep === "verbal" ? "warning" : "neutral"} size="sm">{LANG_DEP_LABEL[dep]}</Badge>;
export const CountryTag = ({ code }: { code: string }) => <Badge tone={code === "KR" ? "accent" : "neutral"} size="sm">{countryLabel(code)}</Badge>;

export function CountrySelect({ value, onChange, allowEmpty = true, size = "sm", label = "나라" }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean; size?: "sm" | "md"; label?: string }) {
  return (
    <Select size={size} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {allowEmpty && <option value="">나라 모름</option>}
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
      ))}
    </Select>
  );
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  const d = ageDays(iso ?? null, now);
  if (d === null) return "—";
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}시간 전`;
  if (d < 60) return `${Math.floor(d)}일 전`;
  return `${Math.floor(d / 30)}개월 전`;
}

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const k = new Date(t + 9 * 3600_000);
  return `${k.getUTCFullYear() % 100}.${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
};
