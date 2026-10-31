"use client";

// 정찰 화면 공용 조각 — 나라 · 수명 · 한국 상태 · AI 재현 배지, 배수 · 썸네일 · 올린 지, 나라 고르기
import { useState, type ReactNode } from "react";
import { Film, UserRound } from "lucide-react";
import { Badge, Select, cn, type Tone } from "@/components/neander/ui";
import { Unknown } from "@/components/neander/shorts/parts";
import {
  AI_LEVEL_LABEL,
  COUNTRIES,
  KOREA_LABEL,
  LANG_DEP_LABEL,
  LIFECYCLE_LABEL,
  ageDays,
  countryLabel,
  fmtMultiple,
  type AiLevel,
  type KoreaStatus,
  type LanguageDependence,
  type Lifecycle,
} from "@/lib/neander/shorts/scout";

type BadgeSize = "sm" | "md" | "lg";

const LIFE_TONE: Record<Lifecycle, Tone> = { seed: "info", rising: "success", steady: "neutral", saturating: "warning", faded: "neutral", unknown: "neutral" };
const KOREA_TONE: Record<KoreaStatus, Tone> = { unchecked: "neutral", none_in_sample: "accent", some: "info", spread: "warning" };
const AI_TONE: Record<AiLevel, Tone> = { easy: "success", possible: "info", hard: "warning" };

/** 「국내 표본에 없음」 은 표본에서 못 찾았다는 뜻 — 배지에 마우스를 올리면 그대로 알린다 */
const KOREA_TITLE: Record<KoreaStatus, string> = {
  unchecked: "아직 국내 검색을 하지 않았습니다",
  none_in_sample: "국내 검색 표본에서 못 찾았다는 뜻입니다 — 국내에 없다는 단정이 아닙니다",
  some: "국내 사례를 골랐거나 국내(KR) 터진 영상이 묶여 있습니다",
  spread: "국내에 이미 퍼진 것으로 표시했습니다",
};

export const LifeBadge = ({ stage, basis, size = "md" }: { stage: Lifecycle; basis?: string; size?: BadgeSize }) => (
  <span title={basis} className="inline-flex">
    <Badge tone={LIFE_TONE[stage]} size={size}>{LIFECYCLE_LABEL[stage]}</Badge>
  </span>
);
export const KoreaBadge = ({ status, size = "md" }: { status: KoreaStatus; size?: BadgeSize }) => (
  <span title={KOREA_TITLE[status]} className="inline-flex">
    <Badge tone={KOREA_TONE[status]} size={size}>{KOREA_LABEL[status]}</Badge>
  </span>
);
export const AiBadge = ({ level, size = "md" }: { level: AiLevel; size?: BadgeSize }) => <Badge tone={AI_TONE[level]} size={size}>{AI_LEVEL_LABEL[level]}</Badge>;
export const LangBadge = ({ dep, size = "md" }: { dep: LanguageDependence; size?: BadgeSize }) => (
  <Badge tone={dep === "visual" ? "success" : dep === "verbal" ? "warning" : "neutral"} size={size}>{LANG_DEP_LABEL[dep]}</Badge>
);
export const CountryTag = ({ code, size = "md" }: { code: string; size?: BadgeSize }) => <Badge tone={code === "KR" ? "accent" : "neutral"} size={size}>{countryLabel(code)}</Badge>;

/** 표 안의 나라 — 배지 대신 글자로 (「미국 · 대만」). 비어 있으면 「나라 모름」 */
export function CountryText({ codes, className }: { codes: string[]; className?: string }) {
  const list = codes.filter(Boolean);
  if (!list.length) return <span className={cn("text-nd-fg-3", className)}>나라 모름</span>;
  return (
    <span className={className} title={list.join(" · ")}>
      {list.map((c, i) => (
        <span key={c}>
          {i > 0 && <span className="text-nd-fg-3"> · </span>}
          <span className={c === "KR" ? "font-medium text-nd-accent-strong" : undefined}>{countryLabel(c)}</span>
        </span>
      ))}
    </span>
  );
}

/** 배수 (그 채널 평소의 몇 배) — 평소를 모르면 「미확인」 */
export function Multiple({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <Unknown title="그 채널 평소 조회수를 몰라 배수를 낼 수 없습니다" />;
  return <span className={cn("nd-num font-semibold text-nd-accent-strong", className)}>{fmtMultiple(value)}</span>;
}

/** 올린 지 — 게시일을 모르면 「미확인」 */
export function Ago({ iso }: { iso: string | null | undefined }) {
  if (!iso || ageDays(iso, Date.now()) === null) return <Unknown title="게시일을 모릅니다" />;
  return <span title={fmtDate(iso)}>{fmtAgo(iso)}</span>;
}

export const fmtDur = (sec: number | null | undefined) => {
  if (!sec || !Number.isFinite(sec)) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * 원본 영상 썸네일 — 자료에 이미 있는 주소(YouTube 등)만 쓴다. 없거나 못 받으면 아이콘 상자 (가짜 사진 금지).
 * 길이를 알면 오른쪽 아래에 붙인다.
 */
export function VideoThumb({ src, duration, label, className }: { src: string | null | undefined; duration?: number | null; label?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const dur = fmtDur(duration);
  const box = cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-nd-sm bg-nd-fg/[.06] text-nd-fg-3", className ?? "h-[54px] w-24");
  return (
    <span className={box}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className="flex flex-col items-center gap-0.5" aria-label={label ? `${label} 영상` : "영상"}>
          <Film size={16} aria-hidden />
          {label && <span className="text-nd-caption">{label}</span>}
        </span>
      )}
      {dur && <span className="absolute bottom-1 right-1 rounded-[4px] bg-black/70 px-1 text-nd-caption leading-[1.35] text-white nd-num">{dur}</span>}
    </span>
  );
}

/** 감시 채널 얼굴 — 채널 썸네일 주소가 있으면 그것, 없으면 아이콘 */
export function ChannelAvatar({ src, className }: { src: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-nd-fg/[.06] text-nd-fg-3", className ?? "h-9 w-9")}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <UserRound size={16} aria-hidden />
      )}
    </span>
  );
}

/** 표 아래 짧은 설명 (13px) */
export const Note = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("text-[13px] leading-relaxed text-nd-fg-3", className)}>{children}</p>;

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
