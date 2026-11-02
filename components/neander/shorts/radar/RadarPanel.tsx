"use client";

// ============================================================
//  AI 레이더 — 소재 발굴 맨 위. 매일 아침 키워드로 훑은 「반응 큰 상품 후보」
// ------------------------------------------------------------
//  회사 공용 목록이다. 숫자는 YouTube API(출처 「API」), 상품은 AI 추정(영상을 보지 않고 글로),
//  국내 추세는 네이버 데이터랩 상대값. 「소재로 저장」 하면 내 소재(비공개)가 된다.
//  필터(분류 · 상품 · 국내 검색 · 배수 · 기간 · 검색어 · 낱말 · 정렬)는 이 브라우저에 기억한다.
//  카드를 누르면 오른쪽 드로어가 열리고, 후보를 YouTube 쇼츠처럼 세로로 한 편씩 넘겨 본다
//  (스냅 스크롤 · 휠 · ↑↓ · 위아래 버튼). 플레이어(youtube-nocookie 퍼가기)는 보고 있는 한 편에만 띄운다 —
//  나머지는 썸네일이다. 넘기면서 저장 · 제외를 바로 고른다.
//
//  배치 (2026-11-02 가독성 목업): 짧은 상태 바(긴 실행 기록은 「실행 상세」) · 두 줄 필터 ·
//  카드 = 큰 세로 썸네일 + 제목 + 같은 자리의 점수 · 지표 3칸 + AI 한 줄 요약(「분석 보기」 로 펼침).
//  카드 안 배치는 카드 폭(컨테이너 쿼리)으로 바꾼다 — 사이드바를 펴든 접든 같은 기준이다.
//  레이더 점수는 아래 「저장한 소재」 의 반응 점수와 다른 산식이다 — 섞지 않는다.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  ExternalLink,
  EyeOff,
  Film,
  GalleryVerticalEnd,
  Info,
  Play,
  Radar,
  RotateCcw,
  SquarePlay,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  IconButton,
  InlineNotice,
  NumberInput,
  SearchInput,
  Sheet,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
  cn,
  type Tone,
} from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, SourceTag, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { Ago, Multiple, fmtDur } from "@/components/neander/shorts/scout/bits";
import { mutate, shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import {
  DEFAULT_RADAR_FILTER,
  NAVER_LABEL,
  RADAR_CATEGORIES,
  RADAR_SORT_LABEL,
  filterRadarGroups,
  isDefaultRadarFilter,
  krwOf,
  type NaverTrend,
  type RadarDoc,
  type RadarFilter,
  type RadarRunSummary,
  type RadarSettings,
} from "@/lib/neander/shorts/radar";

type Item = RadarDoc & { id: string };
interface RadarData {
  me: string;
  admin: boolean;
  settings: RadarSettings;
  last: RadarRunSummary | null;
  today: { day: string; spentKrw: number; budgetKrw: number; searchUsed: number; searchLimit: number };
  ready: { youtube: boolean; ai: boolean; naver: boolean };
  items: Item[];
}

const NAVER_TONE: Record<NaverTrend["label"], Tone> = { rising: "success", steady: "neutral", falling: "warning", low: "neutral" };
const FILTER_KEY = "neander.shorts.radarFilter";
const PAGE = 12;
const won = (n: number) => n.toLocaleString("ko-KR");


function loadFilter(): RadarFilter {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(FILTER_KEY) : null;
    return raw ? { ...DEFAULT_RADAR_FILTER, ...(JSON.parse(raw) as Partial<RadarFilter>) } : DEFAULT_RADAR_FILTER;
  } catch {
    return DEFAULT_RADAR_FILTER;
  }
}

// ---- 상품 확인 상태 ----------------------------------------------------------

/** known = AI 가 상품을 짚음 · multi = 여러 상품 모음 · unknown = 글로는 모름 · pending = AI 추정 전 */
type ProductState = "known" | "multi" | "unknown" | "pending";
const productState = (i: Item): ProductState => (!i.ai ? "pending" : i.ai.product ? "known" : /여러 상품/.test(i.ai.evidence) ? "multi" : "unknown");

const STATE_BADGE: Record<Exclude<ProductState, "known">, { label: string; tone: Tone; title: string }> = {
  unknown: { label: "상품 확인 필요", tone: "neutral", title: "제목 · 설명 · 태그 · 댓글 글로는 상품을 알 수 없습니다 — 영상에서 직접 확인하세요" },
  multi: { label: "여러 상품 모음", tone: "info", title: "여러 상품을 차례로 보여 주는 영상이라 AI 가 상품 하나를 고르지 않았습니다 — 영상에서 직접 확인하세요" },
  pending: { label: "AI 추정 전", tone: "neutral", title: "아직 AI 가 상품을 추정하지 않았습니다 (하루 AI 상한 · 키 없음 등) — 숫자만 있습니다" },
};

/** 분류 · 상품 확인 상태 · 제외됨/무관 · 국내 검색 배지 줄 (상태는 버튼 줄에 두지 않는다 — 버튼 자리가 카드마다 같게) */
function BadgeRow({ i }: { i: Item }) {
  const ai = i.ai;
  const st = productState(i);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ai && ai.category !== "기타" && (
        <Badge tone="accent" size="md">
          {ai.category}
        </Badge>
      )}
      {st !== "known" && (
        <span title={ai ? `${STATE_BADGE[st].title}\nAI 근거: ${ai.evidence}` : STATE_BADGE[st].title} className="inline-flex">
          <Badge tone={STATE_BADGE[st].tone} size="md">
            {STATE_BADGE[st].label}
          </Badge>
        </span>
      )}
      {i.dismissed && (
        <span className="inline-flex" title={`${fmtWhen(i.dismissed.at)} 에 제외했습니다 — 「되살리기」 로 새 후보에 돌려놓습니다`}>
          <Badge tone="neutral" size="md">
            제외됨 · {fmtWhen(i.dismissed.at)}
          </Badge>
        </span>
      )}
      {!i.dismissed && ai?.relevant === false && (
        <span className="inline-flex" title="AI 가 글로 보고 살림 · 주방 · 수납 · 청소 상품 영상이 아니라고 봤습니다 (추정)">
          <Badge tone="warning" size="md">
            AI: 살림 상품 아님
          </Badge>
        </span>
      )}
      {i.naver && (
        <span
          className="inline-flex"
          title={`네이버 데이터랩 검색어 트렌드 (${i.naver.keywords.join(", ")}) — 최근 2주 평균 ÷ 그 전 6주 평균 (상대값). 「검색 적음」 은 데이터랩 기준이며 국내에 없다는 뜻이 아닙니다.`}
        >
          <Badge tone={NAVER_TONE[i.naver.label]} size="md">
            {NAVER_LABEL[i.naver.label]}
            {i.naver.change !== null && i.naver.label !== "steady" ? ` ×${i.naver.change}` : ""}
          </Badge>
        </span>
      )}
    </div>
  );
}

/** AI 추정 배지 — 상품명 바로 옆 */
function AiTag({ i }: { i: Item }) {
  if (!i.ai) return null;
  return (
    <span className="inline-flex shrink-0" title={`AI 추정 — 영상을 보지 않고 제목 · 설명 · 태그 · 댓글 글로 추정했습니다. 근거: ${i.ai.evidence}`}>
      <Badge tone="accent" size="md">
        AI 추정{i.ai.confidence === "unclear" ? " · 불확실" : ""}
      </Badge>
    </span>
  );
}

/**
 * 제목 덩어리 — 상품을 짚었으면 상품명(+AI 추정)이 크고 원본 제목이 아래 한 줄,
 * 아니면 원본 영상 제목이 주된 제목(두 줄까지)이다. 제목을 누르면 플레이어가 열린다.
 */
function Headline({ i, onOpen, size = "md" }: { i: Item; onOpen?: () => void; size?: "md" | "lg" }) {
  const big = size === "lg" ? "text-[19px]" : "text-[17px]";
  const title = (className: string) =>
    onOpen ? (
      <button type="button" onClick={onOpen} title={i.title} className={cn("text-left hover:underline", className)}>
        {i.title}
      </button>
    ) : (
      <p className={className} title={i.title}>
        {i.title}
      </p>
    );
  if (i.ai?.product) {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className={cn("min-w-0 truncate font-bold leading-snug text-nd-fg", big)} title={i.ai.product}>
            {i.ai.product}
          </h3>
          <AiTag i={i} />
        </div>
        {/* line-clamp 는 display 를 바꾸므로 block 과 같이 쓰지 않는다 */}
        {title(cn("mt-0.5 w-full text-nd-body text-nd-fg-2", size === "lg" ? "block" : "line-clamp-1"))}
      </div>
    );
  }
  return (
    <h3 className="min-w-0">
      {title(cn("w-full font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]", big, size === "lg" ? "block" : "line-clamp-2"))}
    </h3>
  );
}

/** 채널 · 올린 지 · 원본 플랫폼 (+ 같은 상품 묶음) */
function MetaLine({ i, groupSize = 1, keywords = false }: { i: Item; groupSize?: number; keywords?: boolean }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-nd-fg-3">
      <span className="min-w-0 max-w-full truncate" title={i.channel}>
        {i.channel || <Unknown title="채널 이름을 모릅니다" />}
      </span>
      <span aria-hidden>·</span>
      <Ago iso={i.publishedAt} />
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <SquarePlay size={14} className="text-nd-danger" aria-hidden />
        YouTube
      </span>
      {groupSize > 1 && (
        <span title="AI 가 같은 상품으로 본 영상을 한 카드로 묶었습니다. 카드의 숫자는 묶음 합계가 아니라 대표 영상(맨 위) 하나의 값입니다.">
          · 같은 상품 영상 {groupSize}편 (숫자는 대표 영상)
        </span>
      )}
      {keywords && i.keywords.length > 0 && <span>· 찾은 검색어 {i.keywords.join(", ")}</span>}
    </p>
  );
}

/** 주의 한 줄 — 접힌 카드에서도 보인다 (전문은 마우스 · 「분석 보기」) */
function CautionLine({ i, full = false }: { i: Item; full?: boolean }) {
  if (!i.ai?.caution) return null;
  return (
    <p className={cn("flex items-start gap-1 text-[13px] text-nd-warning-text", !full && "min-w-0")} title={i.ai.caution}>
      <TriangleAlert size={14} className="mt-[3px] shrink-0" aria-hidden />
      <span className={cn("min-w-0", !full && "truncate")}>주의 · {i.ai.caution}</span>
    </p>
  );
}

/** 레이더 점수 — 카드마다 같은 자리(오른쪽 위) */
function ScoreBox({ score, className }: { score: number; className?: string }) {
  return (
    <div
      data-radar-score
      className={cn("rounded-nd-md bg-nd-accent-soft px-3 py-2 text-nd-accent-strong", className)}
      title="레이더 점수 = 평소 대비 배수 40 + 하루 조회 속도 40 + 정보 요청 댓글 20 (모르는 항목은 0). 아래 「저장한 소재」 의 반응 점수와는 다른 산식입니다."
    >
      <div className="text-[13px] font-medium">레이더 점수</div>
      <div className="nd-num whitespace-nowrap text-[24px] font-bold leading-tight">
        {score.toFixed(1)}
        <span className="ml-0.5 text-[13px] font-medium text-nd-fg-3">/100</span>
      </div>
    </div>
  );
}

// ---- 지표 3칸 ---------------------------------------------------------------

function Metric({ label, tag, value, sub, title }: { label: string; tag?: ReactNode; value: ReactNode; sub: [ReactNode, ReactNode]; title?: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0" title={title}>
      <dt className="flex min-h-[22px] flex-wrap items-center gap-1 text-[13px] font-medium text-nd-fg-2">
        {label}
        {tag}
      </dt>
      {/* 큰 숫자는 지표 줄 폭에 맞춰 18~22px (cqi = 지표 줄 폭의 1%) */}
      <dd className="mt-1 text-[clamp(18px,6.2cqi,22px)] font-bold leading-tight text-nd-fg [overflow-wrap:anywhere]">{value}</dd>
      {/* 보조 설명은 칸마다 두 줄 — 세 칸의 높이가 같아 카드끼리 견주기 쉽다 */}
      <dd className="mt-0.5 text-[13px] leading-snug text-nd-fg-3 [overflow-wrap:anywhere] [word-break:keep-all]">
        <span className="block">{sub[0]}</span>
        <span className="block">{sub[1]}</span>
      </dd>
    </div>
  );
}

/** 큰 칸의 「미확인」 — 숫자보다 작게, 회색으로 */
const BigUnknown = ({ title }: { title: string }) => (
  <span className="text-[17px] font-semibold">
    <Unknown title={title} />
  </span>
);

/** 조회수 · 채널 평소 대비 · 요청 댓글 — 카드마다 같은 자리 · 같은 순서 */
function Metrics({ i, className }: { i: Item; className?: string }) {
  const rate = i.info && i.info.sampled > 0 ? i.info.matched / i.info.sampled : null;
  const vel = i.velocityPerDay;
  const velLabel = i.velocityBasis === "history" ? "관측 하루 증가" : i.velocityBasis === "since_publish" ? "게시 후 일평균" : "하루 증가";
  const velTitle =
    i.velocityBasis === "history"
      ? "같은 영상을 두 번 본 사이에 실제로 늘어난 조회수를 하루로 나눈 값 (YouTube Data API 실측)"
      : i.velocityBasis === "since_publish"
        ? "올린 뒤 지금까지의 평균 — 최근 속도가 아닙니다 (아직 한 번만 봤습니다)"
        : "게시일이나 조회수를 몰라 계산하지 않았습니다";
  return (
    <dl data-radar-metrics className={cn("grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x divide-nd-line border-y border-nd-line py-3 [container-type:inline-size]", className)}>
      <Metric
        label="조회수"
        tag={<SourceTag src="api" title={`YouTube Data API · ${fmtWhen(i.viewsAt)} 기준`} />}
        value={
          i.views === null ? (
            <BigUnknown title="조회수를 받지 못했습니다" />
          ) : (
            // 1억 · 10억 회가 넘으면 한 단계씩 작게 — 칸 폭 안에서 한 줄로
            <span className={i.views >= 1_000_000_000 ? "text-[15px]" : i.views >= 100_000_000 ? "text-[18px]" : undefined}>
              <Num value={i.views} />
            </span>
          )
        }
        title={velTitle}
        sub={[velLabel, vel === null ? <Unknown key="u" title={velTitle} /> : <b key="v" className="nd-num font-semibold text-nd-accent-strong">+{won(vel)}</b>]}
      />
      <Metric
        label="채널 평소 대비"
        title="해당 채널 최근 쇼츠 조회수 중앙값 대비 몇 배인지"
        value={i.multiple === null ? <BigUnknown title="그 채널 평소 조회수를 몰라 배수를 낼 수 없습니다" /> : <Multiple value={i.multiple} className="font-bold" />}
        sub={[
          i.baseline !== null ? <span key="b" className="nd-num">평소 {won(Math.round(i.baseline))}회</span> : "채널 평소 미확인",
          "최근 쇼츠 중앙값",
        ]}
      />
      <Metric
        label="요청 댓글"
        title={`분모는 조회수가 아니라 읽어 본 댓글 표본입니다. ${i.info ? `읽은 댓글 ${i.info.sampled}개 중 「어디서 사요 · 링크 · 정보」 류 ${i.info.matched}개` : "댓글 표본을 아직 안 읽었습니다"}`}
        value={rate === null ? <BigUnknown title="댓글 표본이 없어 계산하지 않았습니다" /> : <span className="nd-num">{Math.round(rate * 100)}%</span>}
        sub={[
          <span key="t" className="font-medium text-nd-fg-2">
            댓글 표본 기준
          </span>,
          i.info && i.info.sampled > 0 ? <span key="n" className="nd-num">{i.info.sampled}개 중 {i.info.matched}개</span> : "표본 없음",
        ]}
      />
    </dl>
  );
}

// ---- AI 요약 · 분석 ---------------------------------------------------------

/** 펼친 분석 — 카드의 「분석 보기」 와 플레이어 창이 같이 쓴다 */
function Analysis({ i }: { i: Item }) {
  const ai = i.ai;
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-nd-fg-2">
      {ai?.why && (
        <p>
          <b className="font-semibold text-nd-fg">왜 먹혔나</b> <span className="text-nd-fg-3">(추정)</span> {ai.why}
        </p>
      )}
      {ai?.hook && (
        <p>
          <b className="font-semibold text-nd-fg">훅</b> <span className="text-nd-fg-3">(추정)</span> {ai.hook}
        </p>
      )}
      {ai?.caution && (
        <p className="text-nd-warning-text">
          <b className="font-semibold">주의</b> {ai.caution}
        </p>
      )}
      {ai && (
        <p className="text-nd-fg-3">
          <b className="font-semibold text-nd-fg-2">추정 근거</b> {ai.evidence || "—"} · 영상을 보지 않고 글로 추정
          {ai.coupangQuery && <> · 쿠팡 검색어 「{ai.coupangQuery}」</>}
        </p>
      )}
      {i.naver && (
        <p className="text-nd-fg-3">
          <b className="font-semibold text-nd-fg-2">국내 검색</b> 네이버 데이터랩({i.naver.keywords.join(", ")}) 최근 2주 평균 {i.naver.recent ?? "—"} · 그 전 6주 평균{" "}
          {i.naver.before ?? "—"} (상대값 · {fmtWhen(i.naver.at)})
        </p>
      )}
      {!ai && <p className="text-nd-fg-3">AI 가 아직 이 영상을 보지 않았습니다 — 상품 · 해설 없이 숫자만 있습니다.</p>}
    </div>
  );
}

/** 카드 아래 AI 한 줄 요약 + 「분석 보기」 */
function AiSummary({ i, className }: { i: Item; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ai = i.ai;
  if (!ai) {
    return <div className={cn("rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] text-nd-fg-3", className)}>AI 분석 전 — 상품 · 해설 없이 숫자만 모았습니다</div>;
  }
  const summary = ai.why || ai.hook || ai.evidence || "해설 없음";
  return (
    <div className={cn("rounded-nd-md bg-nd-accent-soft/60", className)}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
        <Badge tone="accent" size="md" className="shrink-0">
          AI 추정
        </Badge>
        <p className="min-w-0 flex-1 truncate text-[13px] text-nd-fg-2" title={summary}>
          {summary}
        </p>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={id}
          className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-[8px] px-1.5 text-[13px] font-medium text-nd-fg-2 transition-colors hover:bg-nd-fg/[.06] hover:text-nd-fg"
        >
          분석 보기
          <ChevronDown size={15} className={cn("transition-transform duration-nd", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open && (
        <div id={id} className="border-t border-nd-accent/15 px-3 py-2.5">
          <Analysis i={i} />
        </div>
      )}
    </div>
  );
}

// ---- 썸네일 ----------------------------------------------------------------

/** YouTube 의 같은 영상 큰 썸네일 (mq 320×180 → hq 480×360). 못 받으면 저장된 주소 → 아이콘 상자 (가짜 사진 금지) */
const hqOf = (u: string) => (/^https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/mqdefault\.jpg$/.test(u) ? u.replace(/mqdefault\.jpg$/, "hqdefault.jpg") : u);

function RadarThumb({ i, onOpen, className }: { i: Item; onOpen: () => void; className?: string }) {
  const [step, setStep] = useState(0); // 0 = 큰 것 · 1 = 저장된 주소 · 2 = 실패
  const src = step === 0 ? hqOf(i.thumbnail) : step === 1 ? i.thumbnail : "";
  const dur = fmtDur(i.duration);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${i.title} — 여기서 보기`}
      className={cn("group relative block shrink-0 overflow-hidden rounded-nd-md bg-nd-fg/[.06] text-nd-fg-3", className)}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setStep(step === 0 && hqOf(i.thumbnail) !== i.thumbnail ? 1 : 2)}
          className="h-full w-full object-cover transition-transform duration-nd group-hover:scale-[1.03]"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Film size={22} aria-hidden />
        </span>
      )}
      <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/15" aria-hidden />
      <span className="absolute bottom-1.5 left-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white" aria-hidden>
        <Play size={13} fill="currentColor" className="ml-0.5" />
      </span>
      {dur && <span className="nd-num absolute bottom-1.5 right-1.5 rounded-[6px] bg-black/75 px-1.5 py-0.5 text-[13px] font-semibold leading-tight text-white">{dur}</span>}
    </button>
  );
}

// ---- 동작 ------------------------------------------------------------------

interface Actions {
  me: string;
  busy: string | null;
  onSave: (i: Item) => void;
  onMake: (i: Item) => void;
  onDismiss: (i: Item, dismissed: boolean) => void;
}

/** 소재로 저장 · 영상 만들기 · 제외(되살리기) · YouTube — 카드와 플레이어가 같은 순서 */
function ActionRow({ i, a, linkLabel = "YouTube" }: { i: Item; a: Actions; linkLabel?: string }) {
  const saved = i.saved.some((s) => s.by === a.me);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {saved ? (
        <span className="inline-flex" title="내 소재(비공개)로 저장했습니다 — 아래 「저장한 소재」 에 있습니다">
          <Badge tone="success" size="lg">
            <BookmarkCheck size={14} aria-hidden />
            저장됨
          </Badge>
        </span>
      ) : (
        <Button size="sm" variant="secondary" icon={BookmarkPlus} loading={a.busy === `save-${i.id}`} onClick={() => a.onSave(i)}>
          소재로 저장
        </Button>
      )}
      <Button size="sm" icon={Clapperboard} loading={a.busy === `make-${i.id}`} onClick={() => a.onMake(i)}>
        영상 만들기
      </Button>
      {i.dismissed ? (
        <Button size="sm" variant="ghost" icon={RotateCcw} loading={a.busy === `dis-${i.id}`} onClick={() => a.onDismiss(i, false)}>
          되살리기
        </Button>
      ) : (
        <Button size="sm" variant="ghost" icon={EyeOff} loading={a.busy === `dis-${i.id}`} onClick={() => a.onDismiss(i, true)}>
          제외
        </Button>
      )}
      <a href={i.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex h-8 items-center gap-1 rounded-[8px] px-1.5 text-[13px] font-medium text-nd-fg-2 hover:bg-nd-fg/[.06] hover:text-nd-fg">
        {linkLabel} <ExternalLink size={13} aria-hidden />
      </a>
    </div>
  );
}

// ---- 상태 바 ---------------------------------------------------------------

function StatusBar({ data, busy, onRun }: { data: RadarData; busy: boolean; onRun: () => void }) {
  const { last, today, ready, settings } = data;
  const [open, setOpen] = useState(false);
  const id = useId();
  const notes = last?.notes.filter((n) => !/키가 없어/.test(n)) ?? [];
  const overBudget = today.budgetKrw > 0 && today.spentKrw >= today.budgetKrw;
  const searchFull = today.searchUsed >= today.searchLimit;
  return (
    <Card data-radar-status padding="none" className="mb-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nd-accent-soft text-nd-accent" aria-hidden>
            <Radar size={20} />
          </span>
          <h2 className="text-[17px] font-bold text-nd-fg">AI 레이더</h2>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-nd-body text-nd-fg-2 sm:[&>*+*]:border-l sm:[&>*+*]:border-nd-line sm:[&>*+*]:pl-4">
          <span className="inline-flex items-center gap-2" title={last ? `마지막 실행 ${fmtWhen(last.at)}` : undefined}>
            {last ? <span className="nd-num">{fmtWhen(last.at)} 실행</span> : <span>아직 실행 안 함</span>}
            {last && (
              <span className="inline-flex" title="마지막 실행에서 처음 본 후보 영상 수">
                <Badge tone="accent" size="lg">
                  신규 {last.created}
                </Badge>
              </span>
            )}
          </span>
          <span className={cn("nd-num", overBudget && "text-nd-warning-text")} title="오늘 AI 상품 추정에 쓴 돈 (달러 어림 환산) / 하루 상한">
            오늘 AI <b className="text-[15px] font-bold text-nd-fg">{won(today.spentKrw)}</b> / {won(today.budgetKrw)}원
          </span>
          <span className={cn("nd-num", searchFull && "text-nd-warning-text")} title="오늘 YouTube 검색 사용량 — 아래 국내외 검색 비교와 같은 한도를 씁니다">
            YouTube 검색 <b className="text-[15px] font-bold text-nd-fg">{today.searchUsed}</b> / {today.searchLimit}회
          </span>
          {notes.length > 0 && (
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[13px] font-medium text-nd-warning-text hover:underline">
              <TriangleAlert size={14} aria-hidden />
              실행 메모 {notes.length}건
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" trailingIcon={ChevronDown} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={cn("[&>svg:last-child]:transition-transform", open && "[&>svg:last-child]:rotate-180")}>
            실행 상세
          </Button>
          <Button icon={Radar} loading={busy} disabled={!ready.youtube} onClick={onRun} title={!ready.youtube ? "회사 YouTube 키가 없어 돌릴 수 없습니다" : undefined}>
            {busy ? "훑는 중… (1~2분)" : "지금 돌리기"}
          </Button>
        </div>
      </div>
      {open && (
        <div id={id} className="space-y-3 border-t border-nd-line px-5 py-4 text-nd-body text-nd-fg-2">
          <p>
            매일 아침 {settings.keywords.length}개 검색어로 최근 {settings.days}일 쇼츠를 훑어 반응이 큰 상품 후보를 모읍니다 · {settings.enabled ? "매일 아침 자동" : "자동 꺼짐"} · AI 하루{" "}
            {won(settings.aiBudgetKrw)}원까지
          </p>
          {last ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
              {[
                ["실행 시각", `${fmtWhen(last.at)} · ${Math.round(last.ms / 1000)}초`],
                ["YouTube 검색", `${last.searched}회`],
                ["후보", `${last.found}편 (새로 ${last.created} · 갱신 ${last.updated})`],
                ["AI 추정", `${last.aiCalls}번 · ${won(krwOf(last.aiUsd))}원`],
                ["네이버 데이터랩", `${last.naverCalls}회`],
                ["실행한 사람", last.by || "—"],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[13px] text-nd-fg-3">{k}</dt>
                  <dd className="nd-num truncate font-medium text-nd-fg" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-nd-fg-3">아직 실행 기록이 없습니다.</p>
          )}
          <p className="text-[13px] text-nd-fg-3">
            YouTube 검색 한도는 하루 {today.searchLimit}회로, 아래 「국내외 검색 비교」 와 함께 씁니다. 오늘 AI 비용은 달러를 {won(krwOf(1))}원으로 어림 환산한 값입니다.
          </p>
          {(last?.notes.length ?? 0) > 0 && (
            <ul className="space-y-0.5 text-[13px] text-nd-warning-text">
              {last!.notes.map((n, k) => (
                <li key={k}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ---- 필터 ------------------------------------------------------------------

const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")";

/** 라벨이 칸 안 왼쪽에 붙은 선택 상자 (목업의 「분류 | 전체 ▾」) */
function LabeledSelect({ label, value, onChange, className, children }: { label: string; value: string; onChange: (v: string) => void; className?: string; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex h-ctl-md min-w-0 items-stretch overflow-hidden rounded-nd-md border border-nd-border bg-nd-content transition-colors duration-nd-fast focus-within:border-nd-accent focus-within:ring-2 focus-within:ring-nd-accent/20",
        className,
      )}
    >
      <span className="flex shrink-0 items-center border-r border-nd-line bg-nd-sunken px-3 text-[13px] font-medium text-nd-fg-2">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent bg-no-repeat pl-3 pr-8 text-nd-body text-nd-fg outline-none"
        style={{ backgroundImage: CHEVRON, backgroundPosition: "right 10px center" }}
      >
        {children}
      </select>
    </label>
  );
}

function RadarFilters({ filter, setFilter, keywordOptions }: { filter: RadarFilter; setFilter: (f: RadarFilter) => void; keywordOptions: string[] }) {
  const set = <K extends keyof RadarFilter>(k: K, v: RadarFilter[K]) => setFilter({ ...filter, [k]: v });
  const cell = "flex-[1_1_150px]";
  return (
    <div data-radar-filters className="nd-surface mb-5 space-y-2.5 rounded-nd-lg p-3">
      <div className="flex flex-wrap gap-2.5">
        <SearchInput size="md" className="min-w-[220px] flex-[3_1_320px]" value={filter.q} onValueChange={(q) => set("q", q)} placeholder="제목 · 상품 · 채널 검색" ariaLabel="제목 · 상품 · 채널 검색" />
        <LabeledSelect label="분류" className="flex-[1_1_150px]" value={filter.category} onChange={(v) => set("category", v as RadarFilter["category"])}>
          <option value="all">전체</option>
          {RADAR_CATEGORIES.filter((c) => c !== "기타").map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </LabeledSelect>
        <LabeledSelect label="정렬" className="flex-[1_1_170px]" value={filter.sort} onChange={(v) => set("sort", v as RadarFilter["sort"])}>
          {(Object.keys(RADAR_SORT_LABEL) as RadarFilter["sort"][]).map((k) => (
            <option key={k} value={k}>
              {RADAR_SORT_LABEL[k]}
            </option>
          ))}
        </LabeledSelect>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <LabeledSelect label="상품" className={cell} value={filter.product} onChange={(v) => set("product", v as RadarFilter["product"])}>
          <option value="all">전체</option>
          <option value="known">AI 추정 있음</option>
          <option value="unknown">확인 필요 · 모음</option>
          <option value="pending">AI 추정 전</option>
        </LabeledSelect>
        <LabeledSelect label="국내 검색" className={cell} value={filter.naver} onChange={(v) => set("naver", v as RadarFilter["naver"])}>
          <option value="all">전체</option>
          <option value="rising">상승</option>
          <option value="steady">유지</option>
          <option value="falling">하락</option>
          <option value="low">검색 적음</option>
          <option value="none">아직 안 봄</option>
        </LabeledSelect>
        <LabeledSelect label="평소 대비" className={cell} value={String(filter.minMultiple)} onChange={(v) => set("minMultiple", Number(v))}>
          <option value="0">전체</option>
          <option value="3">3배 이상</option>
          <option value="5">5배 이상</option>
          <option value="10">10배 이상</option>
          <option value="20">20배 이상</option>
        </LabeledSelect>
        <LabeledSelect label="올린 지" className={cell} value={String(filter.maxAgeDays)} onChange={(v) => set("maxAgeDays", Number(v))}>
          <option value="0">전체</option>
          <option value="3">3일 안</option>
          <option value="7">7일 안</option>
          <option value="14">14일 안</option>
        </LabeledSelect>
        <LabeledSelect label="발견 검색어" className="flex-[1.3_1_180px]" value={filter.keyword} onChange={(v) => set("keyword", v)}>
          <option value="">전체</option>
          {keywordOptions.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </LabeledSelect>
        <Button
          variant="secondary"
          icon={RotateCcw}
          className="shrink-0"
          disabled={isDefaultRadarFilter(filter)}
          aria-label="필터 초기화 (정렬은 그대로)"
          title="필터를 모두 풉니다 — 정렬은 그대로 둡니다"
          onClick={() => setFilter({ ...DEFAULT_RADAR_FILTER, sort: filter.sort })}
        >
          초기화
        </Button>
      </div>
    </div>
  );
}

// ---- 화면 ------------------------------------------------------------------

function RadarSkeleton() {
  return (
    <section className="mb-10" aria-busy="true">
      <p className="sr-only" role="status">
        AI 레이더를 불러오는 중…
      </p>
      <Skeleton className="mb-5 h-[68px] rounded-nd-lg" />
      <Skeleton className="mb-4 h-9 w-80" />
      <Skeleton className="mb-5 h-[110px] rounded-nd-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="nd-surface flex gap-4 rounded-nd-lg p-4">
            <Skeleton className="aspect-[5/7] w-[140px] shrink-0" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RadarPanel() {
  const { refresh: refreshShorts } = useShorts();
  const router = useRouter();
  const { busy, run } = useAction();
  const [data, setData] = useState<RadarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "saved" | "out">("new");
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilterState] = useState<RadarFilter>(DEFAULT_RADAR_FILTER);
  // 쇼츠처럼 보기 드로어 — 처음 보여 줄 영상 id (null = 닫힘. 같은 상품 묶음 안의 다른 영상일 수도 있다)
  const [feedStart, setFeedStart] = useState<string | null>(null);

  useEffect(() => setFilterState(loadFilter()), []);
  const setFilter = (next: RadarFilter) => {
    setFilterState(next);
    setLimit(PAGE);
    try {
      window.localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      /* 저장 못 해도 화면은 그대로 */
    }
  };

  const load = useCallback(async () => {
    try {
      setData(await shortsGet<RadarData>("radar"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "레이더를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const lists = useMemo(() => {
    const items = data?.items ?? [];
    const me = data?.me ?? "";
    const mine = (i: Item) => i.saved.some((s) => s.by === me);
    const out = (i: Item) => !!i.dismissed || i.ai?.relevant === false;
    return {
      new: items.filter((i) => !out(i) && !mine(i)),
      saved: items.filter(mine),
      out: items.filter((i) => out(i) && !mine(i)),
    };
  }, [data]);
  const groups = useMemo(() => filterRadarGroups(lists[tab], filter, Date.now()), [lists, tab, filter]);
  const shownCount = groups.reduce((n, g) => n + g.items.length, 0);

  const save = async (i: Item) => {
    const r = await shortsPost<{ trendId: string }>("radar", { action: "save", id: i.id });
    await Promise.all([load(), refreshShorts()]);
    return r.trendId;
  };
  const actions: Actions = {
    me: data?.me ?? "",
    busy,
    onSave: (i) => void run(`save-${i.id}`, () => save(i), "내 소재로 저장했습니다 — 아래 「저장한 소재」 에 있습니다."),
    onMake: (i) =>
      void run(`make-${i.id}`, async () => {
        const trendId = await save(i);
        const r = await mutate<{ id: string }>("trend.toProject", { id: trendId, visibility: "private" });
        await refreshShorts();
        router.push(`/neander/shorts/projects/${r.id}`);
      }),
    onDismiss: (i, dismissed) =>
      void run(`dis-${i.id}`, async () => {
        await shortsPost("radar", { action: "dismiss", id: i.id, dismissed });
        await load();
      }),
  };
  const runNow = () =>
    void run(
      "run",
      async () => {
        const r = await shortsPost<{ summary: RadarRunSummary }>("radar", { action: "run" });
        await load();
        return r;
      },
      "레이더를 돌렸습니다.",
    );

  if (!data && error) {
    return (
      <section className="mb-10">
        <ErrorState
          title="AI 레이더를 불러오지 못했습니다"
          description={error}
          action={
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void load()}>
              다시 불러오기
            </Button>
          }
        />
      </section>
    );
  }
  if (!data) return <RadarSkeleton />;
  const { last, ready, settings } = data;
  const keywordOptions = [...new Set([...settings.keywords, ...(data.items ?? []).flatMap((i) => i.keywords)])];
  const filtered = !isDefaultRadarFilter(filter);

  return (
    <section data-radar className="mb-10">
      <StatusBar data={data} busy={busy === "run"} onRun={runNow} />

      {error && (
        <InlineNotice
          tone="danger"
          className="mb-4"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              다시 불러오기
            </Button>
          }
        >
          최신 목록을 불러오지 못했습니다 — 지금 보이는 것은 그 전 목록입니다. ({error})
        </InlineNotice>
      )}
      {!ready.youtube && <InlineNotice tone="warning" className="mb-4">회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없어 레이더를 돌릴 수 없습니다.</InlineNotice>}
      {ready.youtube && !ready.ai && <InlineNotice tone="warning" className="mb-4">OPENROUTER_API_KEY 가 없어 AI 상품 추정 없이 숫자만 모읍니다.</InlineNotice>}
      {ready.youtube && !ready.naver && (
        <InlineNotice tone="info" className="mb-4">
          네이버 데이터랩 키(NAVER API HUB 의 Client ID · Secret → NEANDER_SHORTS_NAVER_CLIENT_ID · _SECRET)를 넣으면 후보마다 국내 검색 추세가 붙습니다.
        </InlineNotice>
      )}

      <Tabs
        className="mb-4"
        ariaLabel="레이더 목록"
        value={tab}
        onChange={(k) => {
          setTab(k as typeof tab);
          setLimit(PAGE);
        }}
        items={[
          { key: "new", label: "새 후보", hint: String(lists.new.length) },
          { key: "saved", label: "내가 저장한 것", hint: String(lists.saved.length) },
          { key: "out", label: "제외 · 무관", hint: String(lists.out.length) },
        ]}
      />

      <RadarFilters filter={filter} setFilter={setFilter} keywordOptions={keywordOptions} />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 data-radar-count className="text-[17px] font-bold text-nd-fg">
          후보 <span className="nd-num">{groups.length}</span>개
          {filtered && <span className="ml-2 text-[13px] font-normal text-nd-fg-3">필터 적용 중 · 이 탭 전체 {lists[tab].length}편</span>}
        </h3>
        <div className="flex items-center gap-3">
          <span className="nd-num text-[13px] text-nd-fg-2" title="편 = 영상 수 · 묶음 = AI 가 같은 상품으로 본 영상끼리 한 카드">
            {shownCount}편 · {groups.length}묶음
          </span>
          <Button size="sm" variant="secondary" icon={GalleryVerticalEnd} disabled={!groups.length} onClick={() => setFeedStart(groups[0]?.items[0].id ?? null)}>
            쇼츠처럼 보기
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          compact
          icon={Radar}
          title={filtered && lists[tab].length ? "필터에 맞는 후보가 없습니다" : tab === "new" ? (last ? "새 후보가 없습니다" : "아직 돌린 적이 없습니다") : tab === "saved" ? "내가 저장한 후보가 없습니다" : "제외하거나 무관한 후보가 없습니다"}
          description={
            filtered && lists[tab].length
              ? "필터를 풀면 이 탭의 후보가 다시 보입니다."
              : tab === "new"
                ? last
                  ? "내일 아침 다시 훑습니다. 검색어를 바꾸려면 아래 설정을 여세요."
                  : `「지금 돌리기」 를 누르면 YouTube 검색 ${settings.maxSearchesPerRun}회와 AI 수십 원 안쪽으로 첫 후보를 모읍니다. 매일 아침에는 저절로 돕니다.`
                : tab === "saved"
                  ? "카드의 「소재로 저장」 을 누르면 내 소재(비공개)로 저장되고 여기에 모입니다."
                  : "「제외」 한 후보와 AI 가 살림 상품 영상이 아니라고 본 후보가 여기에 모입니다."
          }
          action={
            filtered && lists[tab].length ? (
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setFilter({ ...DEFAULT_RADAR_FILTER, sort: filter.sort })}>
                필터 초기화
              </Button>
            ) : undefined
          }
        />
      ) : (
        // 열 수는 목록 폭으로 — 1000px 이상 2열 · 1800px 이상 3열 (카드가 지표 세 칸을 담을 만큼 넓을 때만 나눈다)
        <div className="[container-type:inline-size]">
          <div className="grid grid-cols-1 items-start gap-4 [@container(min-width:1000px)]:grid-cols-2 [@container(min-width:1800px)]:grid-cols-3">
            {groups.slice(0, limit).map((g) => (
              <RadarCard key={g.key} items={g.items} a={actions} onOpen={(i) => setFeedStart(i.id)} />
            ))}
          </div>
        </div>
      )}
      {groups.length > limit && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" icon={ChevronDown} onClick={() => setLimit(limit + PAGE)}>
            {groups.length - limit}묶음 더 보기
          </Button>
        </div>
      )}

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-3">
        <Info size={14} aria-hidden />
        <span>요청 댓글 = 읽은 댓글 표본 중 정보 · 구매처 요청 비율(조회수 대비 아님)</span>
        <span aria-hidden>·</span>
        <span>평소 대비 = 해당 채널 최근 쇼츠 조회수 중앙값 기준</span>
        <span aria-hidden>·</span>
        <span>묶음 카드의 숫자는 대표 영상 하나의 값</span>
        <span aria-hidden>·</span>
        <span>AI 상품명 · 해설은 추정</span>
      </p>

      <ShortsFeedSheet startId={feedStart} groups={groups} a={actions} onClose={() => setFeedStart(null)} />

      <Disclosure
        className="mt-6"
        title="레이더 설정 · 점수 산식"
        meta={
          <span className="text-[13px]">
            {settings.enabled ? "매일 아침 자동" : "자동 꺼짐"} · AI 하루 {won(settings.aiBudgetKrw)}원까지
          </span>
        }
      >
        <RadarSettingsForm settings={settings} admin={data.admin} onSaved={load} />
      </Disclosure>
    </section>
  );
}

function RadarCard({ items, a, onOpen }: { items: Item[]; a: Actions; onOpen: (i: Item) => void }) {
  const i = items[0];
  // 카드 폭(컨테이너)이 470px 이상이면 썸네일 옆에 제목 · 지표 · 요약, 좁으면 지표 · 요약이 썸네일 아래로
  return (
    <Card data-radar-card padding="none" className="flex min-w-0 flex-col p-4 [container-type:inline-size]">
      <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 [@container(min-width:470px)]:grid-cols-[140px_minmax(0,1fr)] [@container(min-width:470px)]:gap-x-4">
        <RadarThumb i={i} onOpen={() => onOpen(i)} className="aspect-[5/7] w-full self-start [@container(min-width:470px)]:row-span-3" />
        {/* 머리 높이를 고정해 지표 줄이 카드마다 같은 높이에서 시작한다 (배지 한 줄 + 제목 두 줄 + 채널 + 주의) */}
        <div className="flex min-w-0 flex-col gap-1.5 [@container(min-width:470px)]:min-h-[132px]">
          <BadgeRow i={i} />
          <div className="flex min-w-0 flex-col gap-2 [@container(min-width:470px)]:flex-row [@container(min-width:470px)]:items-start [@container(min-width:470px)]:gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Headline i={i} onOpen={() => onOpen(i)} />
              <MetaLine i={i} groupSize={items.length} />
              <CautionLine i={i} />
            </div>
            <ScoreBox score={i.score} className="self-start [@container(min-width:470px)]:shrink-0" />
          </div>
        </div>
        <Metrics i={i} className="col-span-2 [@container(min-width:470px)]:col-span-1 [@container(min-width:470px)]:col-start-2" />
        <AiSummary i={i} className="col-span-2 [@container(min-width:470px)]:col-span-1 [@container(min-width:470px)]:col-start-2" />
      </div>
      <div className="mt-4 border-t border-nd-line pt-3">
        <ActionRow i={i} a={a} />
      </div>
    </Card>
  );
}

// ---- 쇼츠처럼 보기 (오른쪽 드로어) -------------------------------------------

type FeedGroup = { key: string; items: Item[] };

/** 드로어 폭 — 화면 높이에 맞춘 세로 영상(9:16) + 오른쪽 정보 칸 */
function useFeedWidth() {
  const [w, setW] = useState(1000);
  useEffect(() => {
    const calc = () => {
      const videoW = Math.max(0, window.innerHeight - 64 - 32) * (9 / 16);
      setW(Math.round(Math.min(1320, Math.max(760, videoW + 32 + 20 + 430))));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return w;
}

/**
 * 후보를 쇼츠처럼 한 편씩 — 한 칸이 드로어 높이 전체(스냅 스크롤).
 * 넘기는 방법: 휠 · 터치 · ↑↓(PageUp/Down · J/K) · 머리의 위아래 버튼. 순서는 지금 필터 · 정렬의 묶음 순서.
 * 플레이어는 보고 있는 칸에만 띄우고, 앞뒤 두 칸까지만 내용을 그린다 (나머지는 빈 칸 — 높이만 같다).
 */
function ShortsFeedSheet({ startId, groups, a, onClose }: { startId: string | null; groups: FeedGroup[]; a: Actions; onClose: () => void }) {
  const width = useFeedWidth();
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pending = useRef<number | null>(null);
  // 묶음 안에서 고른 영상 (묶음 열쇠 → 영상 id)
  const [picked, setPicked] = useState<Record<string, string>>({});
  const open = !!startId;
  const cur = Math.max(0, Math.min(active, groups.length - 1));

  // 열 때 — 누른 후보 칸으로 바로 간다 (부드럽게 말고 즉시)
  useEffect(() => {
    if (!startId) return;
    const idx = Math.max(0, groups.findIndex((g) => g.items.some((x) => x.id === startId)));
    const g = groups[idx];
    setPicked(g && g.items[0].id !== startId ? { [g.key]: startId } : {});
    activeRef.current = idx;
    setActive(idx);
    pending.current = idx;
    if (scroller.current) {
      scroller.current.scrollTop = idx * scroller.current.clientHeight;
      pending.current = null;
    }
    // 열 때 한 번만 — 넘기는 동안 목록이 바뀌어도(제외 등) 다시 옮기지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId]);
  // 휠 · 트랙패드 — 한 번 굴리면 한 편. 관성으로 이어지는 휠은 멈출 때까지 한 번으로 친다.
  // (스냅만 두면 한 칸보다 짧은 휠은 제자리로 돌아가고, 트랙패드 관성은 여러 칸을 넘긴다)
  const goRef = useRef<(d: number) => void>(() => undefined);
  const wheel = useRef({ acc: 0, lockedAt: 0, last: 0, locked: false });
  const onWheel = useCallback((e: WheelEvent) => {
    const el = scroller.current;
    if (!el || e.ctrlKey) return;
    // 정보 칸처럼 스스로 더 굴러갈 수 있는 상자 안이면 그 상자를 먼저 굴린다
    for (let n = e.target as HTMLElement | null; n && n !== el; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) {
        if ((e.deltaY > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) || (e.deltaY < 0 && n.scrollTop > 0)) return;
      }
    }
    e.preventDefault();
    const w = wheel.current;
    const now = performance.now();
    if (w.locked && now - w.last > 220 && now - w.lockedAt > 450) w.locked = false;
    w.last = now;
    if (w.locked) return;
    w.acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(w.acc) >= 24) {
      goRef.current(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.locked = true;
      w.lockedAt = now;
    }
  }, []);
  // 드로어는 포털이라 칸 상자가 늦게 붙는다 — 붙는 순간 위치를 맞추고 휠을 건다(passive: false 라야 막을 수 있다)
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current?.removeEventListener("wheel", onWheel);
      scroller.current = el;
      if (!el) return;
      el.addEventListener("wheel", onWheel, { passive: false });
      if (pending.current !== null) {
        el.scrollTop = pending.current * el.clientHeight;
        pending.current = null;
      }
    },
    [onWheel],
  );

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
    }
  };
  const go = useCallback(
    (d: number) => {
      const el = scroller.current;
      if (!el) return;
      const next = Math.max(0, Math.min(groups.length - 1, activeRef.current + d));
      el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
    },
    [groups.length],
  );
  goRef.current = go;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key;
      const d = k === "ArrowDown" || k === "PageDown" || k === "j" || k === "ArrowRight" ? 1 : k === "ArrowUp" || k === "PageUp" || k === "k" || k === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      go(d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={width}
      ariaLabel="후보 쇼츠처럼 보기"
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>쇼츠처럼 보기</span>
          <span className="nd-num text-[13px] font-normal text-nd-fg-2" aria-live="polite">
            {groups.length ? `${cur + 1} / ${groups.length}` : "0 / 0"}
          </span>
          <span className="inline-flex items-center gap-1">
            <IconButton icon={ChevronUp} label="이전 후보 (↑)" variant="secondary" size="sm" data-feed-key disabled={cur <= 0} onClick={() => go(-1)} />
            <IconButton icon={ChevronDown} label="다음 후보 (↓)" variant="secondary" size="sm" data-feed-key disabled={cur >= groups.length - 1} onClick={() => go(1)} />
          </span>
          <span className="hidden text-[13px] font-normal text-nd-fg-3 md:inline">휠 · ↑↓ 넘기기 · 스페이스 재생/정지 · M 소리</span>
        </span>
      }
    >
      {groups.length === 0 ? (
        <div className="p-5">
          <EmptyState compact icon={GalleryVerticalEnd} title="넘겨 볼 후보가 없습니다" description="필터를 풀거나 다른 탭을 고르세요." />
        </div>
      ) : (
        <div ref={setScroller} onScroll={onScroll} data-radar-feed data-feed-key className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain">
          {groups.map((g, idx) => {
            const near = Math.abs(idx - cur) <= 2;
            const i = g.items.find((x) => x.id === picked[g.key]) ?? g.items[0];
            return (
              <section key={g.key} data-feed-slide={idx} aria-label={`${idx + 1}번째 후보`} className="h-full snap-start snap-always">
                {near && <FeedSlide i={i} group={g.items} active={idx === cur} a={a} onPick={(id) => setPicked((p) => ({ ...p, [g.key]: id }))} onFocus={() => go(idx - activeRef.current)} />}
              </section>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

const YT_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * 보고 있는 칸의 플레이어 — YouTube 퍼가기 위에 투명한 층을 깐다.
 * 층이 휠 · 스와이프를 받아 다음 편으로 넘기고(iframe 은 휠을 바깥으로 넘겨주지 않는다), 누르면 재생/정지.
 * 재생 · 소리(M)는 YouTube 플레이어 API(postMessage · enablejsapi)로 보낸다. 위 아이콘 줄(소리 · 자막 · 설정)과
 * 아래 진행 막대 줄은 층을 비워 YouTube 것을 그대로 쓴다.
 * 층을 눌러도 키보드가 iframe 으로 가지 않아 ↑↓ · 스페이스 · M 이 계속 듣는다.
 */
function FeedPlayer({ i }: { i: Item }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState(-1); // -1 시작 전 · 0 끝 · 1 재생 · 2 정지 · 3 버퍼링 · 5 대기
  const [muted, setMuted] = useState(false);
  const [stalled, setStalled] = useState(false);
  const known = useRef(false); // 플레이어가 상태를 알려 오는가 (안 오면 누를 때마다 번갈아 보낸다)
  const [guess, setGuess] = useState(true);
  const send = useCallback((func: string) => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), YT_ORIGIN), []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== ref.current?.contentWindow) return;
      let d: { event?: string; info?: unknown } | null = null;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = d?.info as { playerState?: number; muted?: boolean } | number | undefined;
      if (d?.event === "onStateChange" && typeof info === "number") {
        known.current = true;
        setState(info);
      }
      if (d?.event === "infoDelivery" && info && typeof info === "object") {
        if (typeof info.playerState === "number") {
          known.current = true;
          setState(info.playerState);
        }
        if (typeof info.muted === "boolean") setMuted(info.muted);
      }
    };
    window.addEventListener("message", onMsg);
    const t = window.setTimeout(() => setStalled(true), 2500);
    return () => {
      window.removeEventListener("message", onMsg);
      window.clearTimeout(t);
    };
  }, []);
  const playing = known.current ? state === 1 || state === 3 : guess;
  const toggle = useCallback(() => {
    if (known.current) send(state === 1 || state === 3 ? "pauseVideo" : "playVideo");
    else {
      send(guess ? "pauseVideo" : "playVideo");
      setGuess(!guess);
      setStalled(false);
    }
  }, [send, state, guess]);
  const toggleMute = useCallback(() => {
    send(muted ? "unMute" : "mute");
    setMuted(!muted);
  }, [send, muted]);
  useEffect(() => {
    const typing = (t: HTMLElement | null) => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    // 스페이스는 쇼츠처럼 늘 재생/정지 — 넘기기 버튼 · 영상 층 · 드로어 바탕에 포커스가 있어도. (저장 · 제외 같은 버튼은 그대로 스페이스로 누른다)
    const spaceIsPlayer = (t: HTMLElement | null) => !t || t === document.body || t.getAttribute("role") === "dialog" || !!t.closest("[data-feed-key]");
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (typing(t)) return;
      if (e.key === " " && spaceIsPlayer(t)) {
        e.preventDefault();
        if (!e.repeat) toggle();
      } else if (e.key === "m" || e.key === "M") toggleMute();
    };
    // 버튼은 스페이스를 뗄 때 눌리므로 그것도 막는다
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " " && !typing(e.target as HTMLElement | null) && spaceIsPlayer(e.target as HTMLElement | null)) e.preventDefault();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [toggle, toggleMute]);
  const showPlay = known.current ? state === 2 || state === 5 || (state === -1 && stalled) : !guess;
  return (
    <>
      <iframe
        ref={ref}
        src={`${YT_ORIGIN}/embed/${i.videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${i.videoId}&enablejsapi=1&origin=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin : "")}`}
        title={i.title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        onLoad={() => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: i.videoId, channel: "widget" }), YT_ORIGIN)}
        className="h-full w-full"
      />
      <button
        type="button"
        data-feed-overlay
        data-feed-key
        onClick={toggle}
        aria-label={playing ? "일시정지 (스페이스)" : "재생 (스페이스)"}
        className="absolute inset-x-0 bottom-14 top-14 flex items-center justify-center bg-transparent"
      >
        {showPlay && (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden>
            <Play size={28} fill="currentColor" className="ml-1" />
          </span>
        )}
      </button>
    </>
  );
}

/** 쇼츠 한 칸 — 왼쪽 세로 영상, 오른쪽(좁으면 아래) 근거 · 버튼 */
function FeedSlide({ i, group, active, a, onPick, onFocus }: { i: Item; group: Item[]; active: boolean; a: Actions; onPick: (id: string) => void; onFocus: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 pt-0 sm:flex-row sm:gap-5">
      <div className="flex min-h-0 flex-1 items-center justify-center sm:h-full sm:flex-none">
        <div className="relative aspect-[9/16] h-full max-w-full overflow-hidden rounded-nd-lg bg-black">
          {active ? (
            <FeedPlayer key={i.videoId} i={i} />
          ) : (
            <button type="button" onClick={onFocus} aria-label={`${i.title} — 이 후보로 넘기기`} className="group block h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.thumbnail && <img src={hqOf(i.thumbnail)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-80" />}
              <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden>
                <Play size={24} fill="currentColor" className="ml-1" />
              </span>
            </button>
          )}
        </div>
      </div>
      <div className="flex max-h-[46%] min-w-0 flex-col gap-3 overflow-y-auto sm:h-full sm:max-h-none sm:flex-1">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <BadgeRow i={i} />
            <Headline i={i} size="lg" />
            <MetaLine i={i} keywords />
          </div>
          <ScoreBox score={i.score} className="shrink-0" />
        </div>
        <Metrics i={i} />
        <div className="rounded-nd-md bg-nd-accent-soft/60 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <Badge tone={i.ai ? "accent" : "neutral"} size="md">
              {i.ai ? "AI 추정" : "AI 분석 전"}
            </Badge>
            <span className="text-[13px] font-medium text-nd-fg-2">분석</span>
          </div>
          <Analysis i={i} />
        </div>
        {group.length > 1 && (
          <div>
            <p className="mb-1 text-[13px] font-medium text-nd-fg-2">같은 상품 영상 {group.length}편 — 위 숫자는 지금 보는 영상 하나의 값</p>
            <ul className="space-y-1">
              {group.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => onPick(x.id)}
                    aria-pressed={x.id === i.id}
                    className={cn("flex w-full items-center gap-2 rounded-nd-sm px-2 py-1 text-left text-[13px] hover:bg-nd-fg/[.04]", x.id === i.id && "bg-nd-accent-soft")}
                  >
                    <span className="relative h-12 w-[34px] shrink-0 overflow-hidden rounded-[4px] bg-nd-fg/[.06]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {x.thumbnail && <img src={hqOf(x.thumbnail)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{x.title}</span>
                    <span className="shrink-0 text-nd-fg-3">평소의 {x.multiple ?? "?"}배</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="sticky bottom-0 mt-auto border-t border-nd-line bg-nd-content pt-3">
          <ActionRow i={i} a={a} linkLabel="YouTube에서 열기" />
        </div>
      </div>
    </div>
  );
}

function RadarSettingsForm({ settings, admin, onSaved }: { settings: RadarSettings; admin: boolean; onSaved: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ ...settings, keywordsText: settings.keywords.join("\n") });
  return (
    <div className="space-y-4">
      <p className="text-nd-body leading-relaxed text-nd-fg-2">
        점수 = 평소 대비 배수 40점(1배 0 → 20배 이상 40) + 하루 조회 속도 40점(1천 0 → 100만 이상 40) + 「어디서 사요 · 링크」 댓글 비율 20점(20% 이상 20). 모르는 항목은 0점입니다.
        상품은 AI 가 영상을 보지 않고 제목 · 설명 · 태그 · 댓글 글로 추정합니다. 국내 추세는 네이버 데이터랩 상대값입니다.
      </p>
      {!admin && <InlineNotice tone="neutral">설정은 AI STUDIO 관리자만 바꿉니다.</InlineNotice>}
      <Switch checked={f.enabled} disabled={!admin} onChange={(v) => setF({ ...f, enabled: v })} label="매일 아침 자동으로 훑기" />
      <Field label="검색어 (한 줄에 하나 · 하나에 YouTube 검색 1회)">
        <Textarea rows={5} disabled={!admin} value={f.keywordsText} onChange={(e) => setF({ ...f, keywordsText: e.target.value })} />
      </Field>
      <FormRow className="grid-cols-2 sm:grid-cols-4">
        <Field label="최근 며칠"><NumberInput disabled={!admin} value={f.days} onValueChange={(r) => setF({ ...f, days: Number(r) || 0 })} /></Field>
        <Field label="최소 조회수"><NumberInput disabled={!admin} value={f.minViews} onValueChange={(r) => setF({ ...f, minViews: Number(r) || 0 })} /></Field>
        <Field label="한 번에 검색 수"><NumberInput disabled={!admin} value={f.maxSearchesPerRun} onValueChange={(r) => setF({ ...f, maxSearchesPerRun: Number(r) || 0 })} /></Field>
        <Field label="AI 하루 상한 (원)"><NumberInput disabled={!admin} value={f.aiBudgetKrw} onValueChange={(r) => setF({ ...f, aiBudgetKrw: Number(r) || 0 })} /></Field>
      </FormRow>
      {admin && (
        <Button
          size="sm"
          disabled={busy === "s"}
          onClick={() =>
            void run(
              "s",
              async () => {
                const { keywordsText, ...rest } = f;
                await shortsPost("radar", { action: "settings.save", settings: { ...rest, keywords: keywordsText.split(/[\n,]/) } });
                await onSaved();
              },
              "레이더 설정을 저장했습니다.",
            )
          }
        >
          설정 저장
        </Button>
      )}
    </div>
  );
}
