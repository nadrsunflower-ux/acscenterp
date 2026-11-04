"use client";

// 정찰 화면 공용 조각 — 나라 · 수명 · 국내 상태 · AI 제작 난이도 배지, 배수 · 썸네일 · 올린 지, 나라 고르기,
// 하위 거르기 알약 · 한국 시각 날짜 · AI 비용(원) 글자
import { useState, type ReactNode } from "react";
import { Film, UserRound } from "lucide-react";
import { Badge, Select, cn, type Tone } from "@/components/neander/ui";
import { Unknown } from "@/components/neander/shorts/parts";
import { krwOf } from "@/lib/neander/shorts/radar";
import {
  COUNTRIES,
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

/** 「표본에 없음」 은 표본에서 못 찾았다는 뜻 — 배지에 마우스를 올리면 그대로 알린다 */
const KOREA_TITLE: Record<KoreaStatus, string> = {
  unchecked: "아직 국내 검색을 하지 않았습니다",
  none_in_sample: "국내 검색 표본에서 못 찾았다는 뜻입니다 — 국내에 없다는 단정이 아닙니다",
  some: "국내 사례를 골랐거나 국내(KR) 터진 영상이 묶여 있습니다",
  spread: "국내에 이미 퍼진 것으로 표시했습니다",
};

/** 국내 퍼짐 단계 — 국내 미확인 → 표본에 없음 → 조금 → 퍼짐 (화면 꼬리표는 짧게, 근거는 따로 적는다) */
export const KOREA_SHORT: Record<KoreaStatus, string> = { unchecked: "국내 미확인", none_in_sample: "표본에 없음", some: "국내 조금", spread: "국내 퍼짐" };
/** AI 로 다시 만들기 얼마나 쉬운가 */
export const AI_LEVEL_SHORT: Record<AiLevel, string> = { easy: "AI 제작 쉬움", possible: "AI 제작 보통", hard: "AI 제작 어려움" };

export const LifeBadge = ({ stage, basis, size = "md" }: { stage: Lifecycle; basis?: string; size?: BadgeSize }) => (
  <span title={basis} className="inline-flex">
    <Badge tone={LIFE_TONE[stage]} size={size}>{LIFECYCLE_LABEL[stage]}</Badge>
  </span>
);
export const KoreaBadge = ({ status, size = "md" }: { status: KoreaStatus; size?: BadgeSize }) => (
  <span title={KOREA_TITLE[status]} className="inline-flex">
    <Badge tone={KOREA_TONE[status]} size={size}>{KOREA_SHORT[status]}</Badge>
  </span>
);
export const AiBadge = ({ level, size = "md" }: { level: AiLevel; size?: BadgeSize }) => <Badge tone={AI_TONE[level]} size={size}>{AI_LEVEL_SHORT[level]}</Badge>;
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

/** YouTube 썸네일을 큰 것(hqdefault 480×360)으로 — 저장된 주소(mqdefault 320×180)는 세로로 크게 자르면 흐리다 */
export const hqThumb = (u: string) => (/^https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/mqdefault\.jpg$/.test(u) ? u.replace(/mqdefault\.jpg$/, "hqdefault.jpg") : u);

/**
 * 원본 영상 썸네일 — 자료에 이미 있는 주소(YouTube 등)만 쓴다. 없거나 못 받으면 아이콘 상자 (가짜 사진 금지).
 * 길이를 알면 오른쪽 아래에 붙인다. hq 면 큰 썸네일부터 → 실패하면 저장된 주소 → 아이콘.
 */
export function VideoThumb({ src, duration, label, className, hq = false }: { src: string | null | undefined; duration?: number | null; label?: string; className?: string; hq?: boolean }) {
  const [step, setStep] = useState(0); // 0 = 큰 것(hq) 또는 저장된 주소 · 1 = 저장된 주소 · 2 = 실패
  const big = src && hq ? hqThumb(src) : src;
  const shown = step === 0 ? big : step === 1 ? src : null;
  const dur = fmtDur(duration);
  const box = cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-nd-sm bg-nd-fg/[.06] text-nd-fg-3", className ?? "h-[54px] w-24");
  return (
    <span className={box}>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setStep(step === 0 && big !== src ? 1 : 2)} />
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

// ---- 언어 · 날짜 · 돈 ------------------------------------------------------------

const LANG_LABEL: Record<string, string> = {
  ko: "한국어",
  en: "영어",
  ja: "일본어",
  zh: "중국어",
  id: "인도네시아어",
  th: "태국어",
  vi: "베트남어",
  pt: "포르투갈어",
  es: "스페인어",
  fr: "프랑스어",
  de: "독일어",
};
/** 언어 코드(ko · en · zh-Hant …) → 한국어 이름. 모르면 코드 그대로, 비었으면 「언어 모름」 */
export const langLabel = (code: string | null | undefined) => {
  const c = (code ?? "").trim();
  if (!c) return "언어 모름";
  return LANG_LABEL[c.toLowerCase().split(/[-_]/)[0]] ?? c;
};

/** 한국 시각 날짜 (2026-11-04) */
export const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** 한국 시각 「11/4 (수)」 — time 이면 「11/4 (수) 07:06」 */
export function fmtDay(ms: number | null | undefined, time = false): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const k = new Date(ms + 9 * 3600_000);
  const d = `${k.getUTCMonth() + 1}/${k.getUTCDate()} (${WEEKDAY[k.getUTCDay()]})`;
  return time ? `${d} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}` : d;
}

/** 달러 비용 → 「1,234원」 (어림 환산) */
export const wonOf = (usd: number) => `${krwOf(usd).toLocaleString("ko-KR")}원`;

/** 나가는 돈(AI 비용) — 빨간 글자. 달러를 어림 환산한 값이라 title 에 적는다 */
export function AiWon({ usd, className, prefix }: { usd: number; className?: string; prefix?: string }) {
  return (
    <span className={cn("nd-num font-semibold text-nd-danger-text", className)} title={`$${usd.toFixed(4)} — 달러를 원으로 어림 환산 · 부가세 별도`}>
      {prefix}
      {wonOf(usd)}
    </span>
  );
}

/**
 * 하위 거르기 알약 (묶기 전 · 형식에 묶음 · 제외 · 전체) — 같은 목록을 거를 뿐이라 탭이 아니라 눌림 단추.
 * 좁은 화면에서는 가로로 밀어 본다.
 */
export function FilterPills<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("nd-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5", className)}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(it.key)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-nd-md border px-3.5 text-[14px] font-medium transition-colors",
              on ? "border-nd-accent bg-nd-accent text-white" : "border-nd-line bg-nd-content text-nd-fg-2 hover:bg-nd-sunken hover:text-nd-fg",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn("nd-num", on ? "text-white/90" : "text-nd-fg-3")}>· {it.count.toLocaleString("ko-KR")}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 이름 · 값 한 줄 (형식 카드의 편집 · 소리 · 화면 글자 · 왜 먹히나) — 값이 없으면 「미입력」 */
export function SpecLine({ label, children, empty = "미입력" }: { label: string; children?: ReactNode; empty?: string }) {
  const has = children !== undefined && children !== null && children !== "";
  return (
    <div className="py-2.5 text-[14px] leading-relaxed first:pt-0 last:pb-0">
      <span className="font-semibold text-nd-fg">{label}</span>
      <span className="text-nd-fg-3"> · </span>
      {has ? <span className="text-nd-fg-2">{children}</span> : <span className="text-nd-fg-3">{empty}</span>}
    </div>
  );
}
