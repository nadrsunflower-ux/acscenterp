"use client";

// ============================================================
//  AI 레이더 — 소재 발굴 맨 위. 매일 아침 키워드로 훑은 「반응 큰 상품 후보」
// ------------------------------------------------------------
//  이 프로젝트의 회사 공용 목록이다. 숫자는 YouTube API(출처 「API」), 상품은 AI 추정(영상을 보지 않고 글로),
//  국내 추세는 네이버 데이터랩 상대값. 「소재로 저장」 하면 내 소재(비공개)가 된다.
//  필터(분류 · 상품 · 국내 검색 · 배수 · 기간 · 촬영 · 검색어 · 낱말 · 정렬)는 이 브라우저에 기억한다.
//  카드를 누르면 오른쪽 드로어가 열리고, 후보를 YouTube 쇼츠처럼 세로로 한 편씩 넘겨 본다
//  (스냅 스크롤 · 휠 · ↑↓ · 위아래 버튼). 플레이어(youtube-nocookie 퍼가기)는 보고 있는 한 편에만 띄운다 —
//  나머지는 썸네일이다. 넘기면서 저장 · 제외 · 촬영 표시(1 · 2 · 0)를 바로 고른다.
//
//  배치 (2026-11-04 AI STUDIO 목업 08):
//   머리 카드 = 실행 상태 · 오늘 AI 비용 / 하루 상한 · YouTube 검색 사용량 · 「지금 돌리기」 · 실행 상세 · 설정.
//   탭 = 새 후보 · 내가 저장한 것(저장한 소재 표가 맨 위) · 제외 · 무관(표 — 사유 · 쓴 사람 · 되살리기).
//   카드 = 큰 썸네일 → 제목 · 레이더 점수 → 조회 · 평소의 n배 → 좋아요 · 댓글 · 저장(같은 자리) →
//          AI 상품 추정 · 왜 먹혔나 · 훅 → 국내 검색 · 쿠팡 검색어 → 회사 공용 메모 · 직접 촬영 → 저장 · 제외.
//  레이더 점수는 아래 「저장한 소재」 의 반응 점수와 다른 산식이다 — 섞지 않는다.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  Clapperboard,
  ExternalLink,
  EyeOff,
  Film,
  GalleryVerticalEnd,
  Hand,
  Info,
  MessageCircle,
  Play,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  InlineNotice,
  NumberInput,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
  cn,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { SourceTag, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, RecordTable, StudioCard, StudioNotice, StudioSection, type RecordColumn } from "@/components/neander/shorts/studio";
import { Ago, fmtAgo, fmtDur } from "@/components/neander/shorts/scout/bits";
import { FeedSlideLayout, FeedVideo, ShortsFeedSheet, hqOf, useFeedResume } from "@/components/neander/shorts/feed/ShortsFeed";
import { CutsButton } from "@/components/neander/shorts/cuts/CutSheet";
import { countInfoRequests } from "@/lib/neander/shorts/model";
import { fmtMultiple } from "@/lib/neander/shorts/scout";
import { mutate, shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import {
  DEFAULT_RADAR_FILTER,
  NAVER_LABEL,
  RADAR_CATEGORIES,
  RADAR_SORT_LABEL,
  filterRadarGroups,
  isDefaultRadarFilter,
  RADAR_FILMED_LABEL,
  krwOf,
  radarFilmedCounts,
  radarNoteState,
  type NaverTrend,
  type RadarDoc,
  type RadarFilmed,
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

/** 레이더 탭 — 새 후보 · 내가 저장한 것 · 제외 · 무관 */
export type RadarTab = "new" | "saved" | "out";

const NAVER_TONE: Record<NaverTrend["label"], Tone> = { rising: "success", steady: "neutral", falling: "warning", low: "neutral" };
const FILTER_KEY = "neander.shorts.radarFilter";
/** 쇼츠처럼 보기에서 마지막으로 본 후보 (이 브라우저) — 다시 열 때 그 영상부터 */
const FEED_LAST_KEY = "neander.shorts.radarFeedLast";
const PAGE = 12;
const won = (n: number) => n.toLocaleString("ko-KR");
/** 메모 반영 다시 분석 한 번 — 글만 읽어 약 2원 (레이더 하루 상한 안) */
const REANALYZE_KRW = 2;
/** 정렬 이름 — 레이더 점수는 저장한 소재의 반응 점수와 다르다는 것을 이름에서도 */
const SORT_LABEL: Record<RadarFilter["sort"], string> = { ...RADAR_SORT_LABEL, score: "레이더 점수 순" };

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

/** 촬영 표시 · 분류 · 상품 확인 상태 · 제외됨/무관 배지 줄 (버튼 줄에 두지 않는다 — 버튼 자리가 카드마다 같게) */
function BadgeRow({ i }: { i: Item }) {
  const ai = i.ai;
  const st = productState(i);
  return (
    <div className="flex min-h-[28px] flex-wrap items-center gap-1.5">
      {i.filmed && <FilmedBadge f={i.filmed} />}
      {ai && ai.category !== "기타" && (
        <Badge tone="accent" size="lg">
          {ai.category}
        </Badge>
      )}
      {st !== "known" && (
        <span title={ai ? `${STATE_BADGE[st].title}\nAI 근거: ${ai.evidence}` : STATE_BADGE[st].title} className="inline-flex">
          <Badge tone={STATE_BADGE[st].tone} size="lg">
            {STATE_BADGE[st].label}
          </Badge>
        </span>
      )}
      {i.dismissed && (
        <span className="inline-flex" title={`${fmtWhen(i.dismissed.at)} 에 제외했습니다 — 「되살리기」 로 새 후보에 돌려놓습니다`}>
          <Badge tone="neutral" size="lg">
            제외됨 · {fmtWhen(i.dismissed.at)}
          </Badge>
        </span>
      )}
      {!i.dismissed && ai?.relevant === false && (
        <span className="inline-flex" title="AI 가 글로 보고 살림 · 주방 · 수납 · 청소 상품 영상이 아니라고 봤습니다 (추정)">
          <Badge tone="warning" size="lg">
            AI: 살림 상품 아님
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
 * 아니면 원본 영상 제목이 주된 제목(두 줄까지)이다. 제목을 누르면 쇼츠처럼 보기가 열린다.
 * 카드에서는 높이를 두 줄로 고정해 아래 숫자 줄이 카드마다 같은 높이에서 시작한다.
 */
function Headline({ i, onOpen, size = "md" }: { i: Item; onOpen?: () => void; size?: "md" | "lg" }) {
  const big = size === "lg" ? "text-[20px]" : "text-[18px]";
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
      <div className={cn("min-w-0", size === "md" && "min-h-[52px]")}>
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
    <h3 className={cn("min-w-0", size === "md" && "min-h-[52px]")}>
      {title(cn("w-full font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]", big, size === "lg" ? "block" : "line-clamp-2"))}
    </h3>
  );
}

/** 채널 · 올린 지 · 원본 플랫폼 (+ 같은 상품 묶음 · 찾은 검색어) */
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
        <Play size={13} className="text-nd-danger" aria-hidden />
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

/** 레이더 점수 — 카드마다 같은 자리(오른쪽 위) */
function ScoreBox({ score, className }: { score: number; className?: string }) {
  return (
    <div
      data-radar-score
      className={cn("shrink-0 text-right", className)}
      title="레이더 점수 = 평소 대비 배수 40 + 하루 조회 속도 40 + 정보 요청 댓글 20 (모르는 항목은 0). 아래 「저장한 소재」 의 반응 점수와는 다른 산식입니다."
    >
      <div className="text-[13px] font-medium text-nd-fg-3">레이더 점수</div>
      <div className="nd-num whitespace-nowrap text-[28px] font-bold leading-tight text-nd-accent-strong">
        {score.toFixed(1)}
        <span className="ml-0.5 text-[13px] font-medium text-nd-fg-3">/100</span>
      </div>
    </div>
  );
}

// ---- 조회 · 평소 대비 ----------------------------------------------------------

/** 조회수(+하루 증가) · 채널 평소 대비 배수 — 카드마다 같은 자리 */
function ViewsLine({ i, detail = false }: { i: Item; detail?: boolean }) {
  const vel = i.velocityPerDay;
  const velLabel = i.velocityBasis === "history" ? "관측 하루" : i.velocityBasis === "since_publish" ? "게시 후 하루 평균" : "하루";
  const velTitle =
    i.velocityBasis === "history"
      ? "같은 영상을 두 번 본 사이에 실제로 늘어난 조회수를 하루로 나눈 값 (YouTube Data API 실측)"
      : i.velocityBasis === "since_publish"
        ? "올린 뒤 지금까지의 평균 — 최근 속도가 아닙니다 (아직 한 번만 봤습니다)"
        : "게시일이나 조회수를 몰라 계산하지 않았습니다";
  const baseTitle = `해당 채널 최근 쇼츠 조회수 중앙값 대비 몇 배인지${i.baseline !== null ? ` — 평소 ${won(Math.round(i.baseline))}회` : " — 채널 평소 조회수 미확인"}`;
  return (
    <div data-radar-views className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[14px] text-nd-fg-2">
        <span title={`YouTube Data API · ${fmtWhen(i.viewsAt)} 기준`}>
          조회{" "}
          {i.views === null ? (
            <Unknown title="조회수를 받지 못했습니다" />
          ) : (
            <b className="nd-num text-[16px] font-bold text-nd-fg">{won(i.views)}</b>
          )}
        </span>
        <span className="text-[13px] text-nd-fg-3" title={velTitle}>
          · {velLabel} {vel === null ? <Unknown title={velTitle} /> : <b className="nd-num font-semibold text-nd-accent-strong">+{won(vel)}</b>}
        </span>
        {detail && <SourceTag src="api" title={`YouTube Data API · ${fmtWhen(i.viewsAt)} 기준`} />}
      </p>
      <p className="shrink-0 text-[14px] text-nd-fg-2" title={baseTitle}>
        평소의{" "}
        {i.multiple === null ? (
          <Unknown title="그 채널 평소 조회수를 몰라 배수를 낼 수 없습니다" />
        ) : (
          <b className="nd-num text-[16px] font-bold text-nd-warning-text">{fmtMultiple(i.multiple)}</b>
        )}
        {detail && (
          <span className="ml-1.5 text-[13px] text-nd-fg-3">
            ({i.baseline !== null ? <span className="nd-num">평소 {won(Math.round(i.baseline))}회</span> : "채널 평소 미확인"} · 최근 쇼츠 중앙값)
          </span>
        )}
      </p>
    </div>
  );
}

// ---- 반응 3칸 (좋아요 · 댓글 · 저장) · 댓글 원문 ------------------------------

const pct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;

/**
 * 좋아요 · 댓글 · 저장 — 조회수와 같은 때 YouTube Data API 로 받은 값. 카드마다 같은 자리 · 같은 높이.
 * 저장 · 공유 수는 YouTube 가 공개하지 않는다(채널 주인만 Studio 에서 본다) — 0 이 아니라 「미확인」.
 * 댓글 칸 아래 줄은 정보 요청 댓글 비율(분모는 읽은 댓글 표본 — 조회수 아님).
 */
function Engagement({ i, onComments, className }: { i: Item; onComments?: () => void; className?: string }) {
  const likeRate = i.likes !== null && i.views ? i.likes / i.views : null;
  const rate = i.info && i.info.sampled > 0 ? i.info.matched / i.info.sampled : null;
  const at = `YouTube Data API · ${fmtWhen(i.viewsAt)} 기준`;
  const tile = "min-w-0 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-3 py-2.5";
  const label = "flex min-w-0 items-center gap-1 text-[13px] text-nd-fg-2";
  const value = "mt-1 truncate text-[16px] font-bold leading-tight text-nd-fg";
  const sub = "mt-0.5 truncate text-[13px] text-nd-fg-3";
  const infoTitle = i.info ? `정보 요청 댓글 — 읽은 댓글 ${i.info.sampled}개 중 「어디서 사요 · 링크 · 정보」 류 ${i.info.matched}개 (분모는 조회수가 아니라 댓글 표본)` : "댓글 표본을 아직 안 읽어 정보 요청 비율을 모릅니다";
  return (
    <dl data-radar-engagement className={cn("grid grid-cols-3 gap-2", className)}>
      <div className={tile} title={`좋아요 수 — ${at}${likeRate !== null ? ` · 조회수 대비 ${pct(likeRate)}` : ""}`}>
        <dt className={label}>
          <ThumbsUp size={14} className="shrink-0" aria-hidden />
          좋아요
        </dt>
        <dd className={value}>{i.likes === null ? <Unknown title="채널이 좋아요 수를 숨겼습니다 — YouTube API 가 값을 주지 않습니다 (0 이 아닙니다)" /> : <span className="nd-num">{won(i.likes)}</span>}</dd>
        <dd className={sub}>{likeRate !== null ? <span className="nd-num">조회의 {pct(likeRate)}</span> : "비공개"}</dd>
      </div>
      <div className={tile} title={`댓글 수 — ${at}`}>
        <dt className={label}>
          <MessageCircle size={14} className="shrink-0" aria-hidden />
          댓글
          {onComments && (i.comments ?? 0) > 0 && (
            <button type="button" onClick={onComments} className="ml-auto shrink-0 font-medium text-nd-accent hover:underline" aria-label={`댓글 ${won(i.comments ?? 0)}개 원문 보기`}>
              원문
            </button>
          )}
        </dt>
        <dd className={value}>{i.comments === null ? <Unknown title="댓글이 꺼져 있거나 받지 못했습니다" /> : <span className="nd-num">{won(i.comments)}</span>}</dd>
        <dd className={sub} title={infoTitle}>
          {rate === null ? "요청 미확인" : <span className="nd-num">요청 {Math.round(rate * 100)}%</span>}
        </dd>
      </div>
      <div className={tile} title="YouTube 는 저장 · 공유 수를 API 로 공개하지 않습니다 — 채널 주인만 YouTube Studio 에서 볼 수 있습니다">
        <dt className={label}>
          <Bookmark size={14} className="shrink-0" aria-hidden />
          저장
        </dt>
        <dd className={value}>
          <Unknown title="YouTube 는 저장 수를 공개하지 않습니다 (0 이 아닙니다)" />
        </dd>
        <dd className={sub}>비공개</dd>
      </div>
    </dl>
  );
}

type RadarComment = { id: string; author: string; text: string; likes: number | null; replies: number | null; publishedAt: string | null };
type CommentPage = { items: RadarComment[]; next: string | null; disabled: boolean; order: "relevance" | "time"; at: number };

/** 댓글 하나 — 긴 글은 다섯 줄까지만, 「펼치기」 로 전부 */
function CommentItem({ c }: { c: RadarComment }) {
  const [open, setOpen] = useState(false);
  const long = c.text.length > 240 || c.text.split("\n").length > 5;
  const info = countInfoRequests([c.text]).matched > 0;
  return (
    <li className="border-b border-nd-line py-3 first:pt-1 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-3">
        <span className="max-w-[60%] truncate font-medium text-nd-fg-2" title={c.author}>
          {c.author || "이름 없음"}
        </span>
        {c.publishedAt && <span title={c.publishedAt}>{fmtAgo(c.publishedAt)}</span>}
        {info && (
          <span className="inline-flex" title="「어디서 사요 · 링크 · 제품명」 같은 정보 요청 낱말이 들어 있습니다 — 카드의 「요청」 과 같은 기준">
            <Badge tone="accent" size="md">
              정보 요청
            </Badge>
          </span>
        )}
      </div>
      <p className={cn("mt-1 whitespace-pre-line text-nd-body leading-relaxed text-nd-fg [overflow-wrap:anywhere]", long && !open && "line-clamp-5")}>{c.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-nd-fg-3">
        <span className="nd-num inline-flex items-center gap-1">
          <ThumbsUp size={13} aria-hidden />
          {c.likes === null ? "—" : won(c.likes)}
        </span>
        {(c.replies ?? 0) > 0 && <span className="nd-num">답글 {won(c.replies ?? 0)}</span>}
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="font-medium text-nd-accent hover:underline">
            {open ? "접기" : "펼치기"}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * 댓글 원문 — 열 때 YouTube 에서 읽어 온다 (회사 키 · 저장 안 함). 인기순 · 최신순 · 30개씩 더 보기.
 * 카드의 댓글 창과 쇼츠처럼 보기 드로어가 같이 쓴다.
 */
function CommentList({ i, className }: { i: Item; className?: string }) {
  const [order, setOrder] = useState<"relevance" | "time">("relevance");
  const [page, setPage] = useState<CommentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(
    async (next?: string) => {
      const n = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ comments: i.id, order });
        if (next) q.set("page", next);
        const r = await shortsGet<CommentPage>(`radar?${q}`);
        if (n !== seq.current) return; // 그사이 순서를 바꿨다
        setPage((prev) => (next && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
      } catch (e) {
        if (n === seq.current) setError(e instanceof Error ? e.message : "댓글을 불러오지 못했습니다.");
      } finally {
        if (n === seq.current) setLoading(false);
      }
    },
    [i.id, order],
  );
  useEffect(() => {
    setPage(null);
    void load();
  }, [load]);

  return (
    <div data-radar-comments className={cn("min-w-0", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          ariaLabel="댓글 순서"
          value={order}
          onChange={setOrder}
          options={[
            { value: "relevance", label: "인기순" },
            { value: "time", label: "최신순" },
          ]}
        />
        <span className="nd-num text-[13px] text-nd-fg-3">
          {page && !page.disabled ? `${i.comments !== null ? `댓글 ${won(i.comments)}개 중 ` : ""}${won(page.items.length)}개` : i.comments !== null ? `댓글 ${won(i.comments)}개` : ""}
        </span>
      </div>
      {error ? (
        <InlineNotice tone="warning">
          {error}{" "}
          <button type="button" onClick={() => void load()} className="font-medium underline">
            다시 시도
          </button>
        </InlineNotice>
      ) : !page ? (
        <div className="space-y-3 py-1" aria-busy="true">
          <p className="sr-only" role="status">
            댓글을 불러오는 중…
          </p>
          {[0, 1, 2].map((k) => (
            <div key={k} className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : page.disabled ? (
        <p className="py-2 text-nd-body text-nd-fg-3">이 영상은 댓글이 꺼져 있습니다.</p>
      ) : page.items.length === 0 ? (
        <p className="py-2 text-nd-body text-nd-fg-3">아직 댓글이 없습니다.</p>
      ) : (
        <>
          <ul>
            {page.items.map((c) => (
              <CommentItem key={c.id} c={c} />
            ))}
          </ul>
          {page.next && (
            <Button size="sm" variant="secondary" className="mt-2 w-full" loading={loading} onClick={() => void load(page.next ?? undefined)}>
              댓글 더 보기
            </Button>
          )}
        </>
      )}
      <p className="mt-2 text-[13px] text-nd-fg-3">
        YouTube 공개 댓글을 열 때 읽어 옵니다(저장하지 않음){page ? ` · ${fmtWhen(page.at)}` : ""} · 「정보 요청」 은 낱말로 고른 것입니다.
      </p>
    </div>
  );
}

// ---- 메모 · 직접 촬영 (회사 공용 · AI 가 참고) ---------------------------------

/** AI 분석 상자의 사람 표시 배지 — 반영했으면 「사람 표시 반영」, 분석 뒤에 바뀌었으면 「반영 전」 */
function NoteBadge({ state }: { state: ReturnType<typeof radarNoteState> }) {
  if (state === "applied")
    return (
      <span className="inline-flex shrink-0" title="이 분석은 사람 메모 · 직접 촬영 표시를 참고했습니다">
        <Badge tone="success" size="md">
          사람 표시 반영
        </Badge>
      </span>
    );
  if (state === "stale")
    return (
      <span className="inline-flex shrink-0" title="메모 · 직접 촬영 표시가 분석 뒤에 바뀌었습니다 — 「메모」 에서 다시 분석하면 반영됩니다">
        <Badge tone="warning" size="md">
          사람 표시 반영 전
        </Badge>
      </span>
    );
  return null;
}

const FilmedBadge = ({ f }: { f: NonNullable<Item["filmed"]> }) => (
  <span className="inline-flex" title={`사람이 영상을 보고 표시 · ${fmtWhen(f.at)}`}>
    <Badge tone={f.value === "self" ? "success" : "neutral"} size="lg">
      {RADAR_FILMED_LABEL[f.value]}
    </Badge>
  </span>
);

/** 직접 촬영인가 — 사람이 보고 고른다 (회사 공용 · 마지막에 고른 사람). 같은 칸을 다시 누르면 지운다 */
function FilmedToggle({ i, a, keys = false }: { i: Item; a: Actions; keys?: boolean }) {
  const { nameOf } = useShorts();
  const cur = i.filmed?.value ?? null;
  const opt = (v: RadarFilmed, hint: string) => (
    <button
      type="button"
      aria-pressed={cur === v}
      onClick={() => a.onFilmed(i, cur === v ? null : v)}
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors",
        cur === v
          ? v === "self"
            ? "border-nd-success/40 bg-nd-success-soft text-nd-success-text"
            : "border-nd-fg-3/40 bg-nd-fg/[.08] text-nd-fg"
          : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
      )}
    >
      {RADAR_FILMED_LABEL[v]}
      {keys && <kbd className="ml-0.5 rounded-[4px] bg-nd-fg/[.06] px-1 text-[13px] font-normal text-nd-fg-3">{hint}</kbd>}
    </button>
  );
  return (
    <div data-radar-filmed className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-nd-fg-2" title="크리에이터가 직접 찍은 실사 영상인가 — AI 생성 · 퍼온 영상 · 사진 넘기기 등은 「직접 촬영 아님」. AI 분석과 필터에 씁니다">
        <Hand size={14} aria-hidden />
        촬영
      </span>
      {opt("self", "1")}
      {opt("not_self", "2")}
      <span className="text-[13px] text-nd-fg-3">
        {i.filmed ? `${nameOf(i.filmed.by)} · ${fmtWhen(i.filmed.at)}` : "아직 표시 안 함"}
        {keys && i.filmed ? " · 0 지우기" : ""}
      </span>
    </div>
  );
}

/** 카드의 회사 공용 메모 — 가장 최근 메모 한 개(쓴 사람 · 시각) + 직접 촬영 표시. 쓰기는 「메모」 창에서 */
function MemoBlock({ i, a }: { i: Item; a: Actions }) {
  const { nameOf } = useShorts();
  const notes = [...(i.notes ?? [])].sort((x, y) => y.at - x.at);
  const top = notes[0];
  return (
    <section data-radar-memo aria-label="회사 공용 메모" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[14px] font-semibold text-nd-fg">회사 공용 메모</h4>
        <button type="button" onClick={() => a.onNotes(i)} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-1.5 text-[13px] font-medium text-nd-accent hover:bg-nd-accent-soft" title="메모를 남기면 AI 가 다시 분석할 때 참고합니다">
          <StickyNote size={14} aria-hidden />
          {notes.length ? `메모 ${notes.length}개 · 쓰기` : "메모 쓰기"}
        </button>
      </div>
      <div className="min-h-[44px]">
        {top ? (
          <>
            <p className="line-clamp-2 whitespace-pre-line text-[13px] leading-relaxed text-nd-fg [overflow-wrap:anywhere]" title={top.text}>
              {top.text}
            </p>
            <p className="mt-0.5 text-[13px] text-nd-fg-3">
              {nameOf(top.by)} · {fmtWhen(top.at)}
              {notes.length > 1 ? ` · 다른 메모 ${notes.length - 1}개` : ""}
            </p>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-nd-fg-3">아직 메모가 없습니다 — 영상을 보고 알게 된 것을 남기면 AI 가 다시 분석할 때 참고합니다.</p>
        )}
      </div>
      <FilmedToggle i={i} a={a} />
    </section>
  );
}

/**
 * 메모 칸 — 회사 공용 · 한 사람에 하나(쓴 사람 · 시각 표시). 칸을 벗어나면 저장, 빈 글이면 지운다.
 * 「메모 반영해 다시 분석」 은 이 영상 하나만 AI 에 다시 보낸다 (글만 읽어 약 2원 · 레이더 하루 상한 안).
 */
function NotePanel({ i, a, keys = false }: { i: Item; a: Actions; keys?: boolean }) {
  const { nameOf } = useShorts();
  const mine = (i.notes ?? []).find((n) => n.by === a.me);
  const others = (i.notes ?? []).filter((n) => n.by !== a.me).sort((x, y) => y.at - x.at);
  const [text, setText] = useState(mine?.text ?? "");
  useEffect(() => setText(mine?.text ?? ""), [mine?.text, i.id]);
  const dirty = text.trim() !== (mine?.text ?? "");
  const state = radarNoteState(i);
  const busyRe = a.busy === `re-${i.id}`;
  const hasAny = !!(i.notes?.length || text.trim() || i.filmed);
  return (
    <div data-radar-notes className="space-y-2.5">
      <FilmedToggle i={i} a={a} keys={keys} />
      {others.length > 0 && (
        <ul className="space-y-2">
          {others.map((n) => (
            <li key={n.by} className="rounded-nd-md bg-nd-sunken px-3 py-2">
              <p className="text-[13px] text-nd-fg-3">
                <span className="font-medium text-nd-fg-2">{nameOf(n.by)}</span> · {fmtWhen(n.at)}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-nd-body text-nd-fg [overflow-wrap:anywhere]">{n.text}</p>
            </li>
          ))}
        </ul>
      )}
      <Field label={others.length ? "내 메모" : "메모 — AI 가 분석할 때 참고합니다"}>
        <Textarea
          value={text}
          rows={3}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => dirty && void a.onNote(i, text)}
          placeholder="영상을 보고 알게 된 것 (예: 「다이소 실리콘 물막이 3천원」 「모음 영상 아님 — 상품 하나」 「훅은 물 튀는 장면」)"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          size="sm"
          variant="secondary"
          icon={Sparkles}
          loading={busyRe}
          disabled={!hasAny || (a.busy !== null && !busyRe)}
          onClick={() => a.onReanalyze(i, dirty ? text : undefined)}
          title="이 영상 하나만 메모와 함께 AI 에 다시 보냅니다 (글만 읽음 · 약 2원 · 레이더 하루 상한 안)"
        >
          {busyRe ? "다시 분석하는 중…" : i.ai ? "메모 반영해 다시 분석" : "메모 반영해 분석"}
        </Button>
        <AiCostNote estimate={REANALYZE_KRW} used={a.cost?.spentKrw ?? null} cap={a.cost?.budgetKrw ?? null} />
      </div>
      <p className="text-[13px] text-nd-fg-3">
        {a.busy === `note-${i.id}`
          ? "저장하는 중…"
          : dirty
            ? "칸을 벗어나면 저장됩니다"
            : state === "applied"
              ? `AI 분석이 ${[i.notes?.length ? `메모 ${i.notes.length}개` : "", i.filmed ? "촬영 표시" : ""].filter(Boolean).join(" · ")}를 반영했습니다 · ${fmtWhen(i.ai?.at)}`
              : state === "stale"
                ? i.notes?.length || i.filmed
                  ? "메모 · 촬영 표시가 분석 뒤에 바뀌었습니다 — 다시 분석하면 반영됩니다"
                  : "분석에 썼던 메모 · 표시가 지워졌습니다"
                : state === "pending"
                  ? "아직 AI 분석 전 — 아침 자동 분석 때도 메모 · 촬영 표시를 함께 참고합니다"
                  : "메모 · 촬영 표시는 회사 공용입니다 (남긴 사람 표시)"}
      </p>
    </div>
  );
}

// ---- AI 상품 추정 · 분석 ---------------------------------------------------------

/** 추정 근거 · 쿠팡 검색어 · 네이버 상세 — 「분석 보기」 를 펼치면 */
function Analysis({ i, detailOnly = false }: { i: Item; detailOnly?: boolean }) {
  const ai = i.ai;
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-nd-fg-2">
      {!detailOnly && ai?.why && (
        <p>
          <b className="font-semibold text-nd-fg">왜 먹혔나</b> <span className="text-nd-fg-3">(추정)</span> {ai.why}
        </p>
      )}
      {!detailOnly && ai?.hook && (
        <p>
          <b className="font-semibold text-nd-fg">훅</b> <span className="text-nd-fg-3">(추정)</span> {ai.hook}
        </p>
      )}
      {!detailOnly && ai?.caution && (
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

/**
 * AI 상품 추정 상자 — 확실도 · 왜 먹혔나 · 훅 · 주의. 카드에서는 줄 수를 묶어 높이를 맞추고
 * 「분석 보기」 로 근거를 펼친다. full 이면(드로어) 전부 보인다.
 */
function AiBox({ i, full = false, className }: { i: Item; full?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ai = i.ai;
  if (!ai) {
    return (
      <div className={cn("rounded-nd-md border border-dashed border-nd-strong px-3.5 py-3 text-[13px] leading-relaxed text-nd-fg-3", !full && "min-h-[128px]", className)}>
        <p className="flex items-center gap-1.5 font-semibold text-nd-fg-2">
          <Sparkles size={15} aria-hidden />
          AI 분석 전
        </p>
        <p className="mt-1">상품 · 해설 없이 숫자만 모았습니다{i.notes?.length ? ` · 메모 ${i.notes.length}개는 분석 때 참고합니다` : ""}.</p>
      </div>
    );
  }
  const clamp = (n: 1 | 2) => (full ? undefined : n === 1 ? "line-clamp-1" : "line-clamp-2");
  return (
    <div data-radar-ai className={cn("rounded-nd-md border border-nd-line bg-nd-sunken/60 px-3.5 py-3", className)}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-nd-fg" title={`AI 추정 — 영상을 보지 않고 제목 · 설명 · 태그 · 댓글 글로 추정했습니다. 근거: ${ai.evidence}`}>
          <Sparkles size={15} className="text-nd-accent" aria-hidden />
          AI 상품 추정 · 확실도 {ai.confidence === "likely" ? "근거 있음" : "불확실"}
        </span>
        <NoteBadge state={radarNoteState(i)} />
        {/* 주의는 카드에서는 꼬리표만 (전문은 마우스 · 「분석 보기」) — 상자 높이가 카드마다 같게 */}
        {!full && ai.caution && (
          <span className="inline-flex" title={`주의 · ${ai.caution}`}>
            <Badge tone="warning" size="md">
              <TriangleAlert size={13} aria-hidden />
              주의
            </Badge>
          </span>
        )}
        {!full && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={id}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-0.5 rounded-[8px] px-1.5 text-[13px] font-medium text-nd-fg-2 transition-colors hover:bg-nd-fg/[.06] hover:text-nd-fg"
          >
            분석 보기
            <ChevronDown size={15} className={cn("transition-transform duration-nd", open && "rotate-180")} aria-hidden />
          </button>
        )}
      </div>
      {/* 왜 먹혔나 두 줄 + 훅 한 줄 자리를 늘 잡아 둔다 */}
      <div className={cn("mt-1.5 space-y-1 text-[13px] leading-relaxed text-nd-fg-2", !full && "min-h-[68px]")}>
        <p className={clamp(2)} title={ai.why || undefined}>
          <b className="font-semibold text-nd-fg">왜 먹혔나</b> · {ai.why || <Unknown title="AI 해설이 없습니다" />}
        </p>
        <p className={clamp(1)} title={ai.hook || undefined}>
          <b className="font-semibold text-nd-fg">훅</b> · {ai.hook || <Unknown title="첫 장면 훅을 글로는 알 수 없습니다" />}
        </p>
        {full && ai.caution && (
          <p className="flex items-start gap-1 text-nd-warning-text">
            <TriangleAlert size={14} className="mt-[3px] shrink-0" aria-hidden />
            <span className="min-w-0">주의 · {ai.caution}</span>
          </p>
        )}
      </div>
      {(open || full) && (
        <div id={id} className="mt-2 space-y-1.5 border-t border-nd-line pt-2">
          {!full && ai.caution && (
            <p className="text-[13px] leading-relaxed text-nd-warning-text">
              <b className="font-semibold">주의</b> {ai.caution}
            </p>
          )}
          <Analysis i={i} detailOnly />
        </div>
      )}
    </div>
  );
}

/** 네이버 국내 검색 꼬리표 — 아직 안 봤으면 「국내 검색 미확인」 */
function NaverTag({ i }: { i: Item }) {
  if (!i.naver)
    return (
      <span className="inline-flex" title="네이버 데이터랩 검색어 추세를 아직 보지 않았습니다 (키 없음 · AI 추정 전 등)">
        <Badge tone="neutral" size="lg">
          국내 검색 미확인
        </Badge>
      </span>
    );
  return (
    <span
      className="inline-flex"
      title={`네이버 데이터랩 검색어 트렌드 (${i.naver.keywords.join(", ")}) — 최근 2주 평균 ÷ 그 전 6주 평균 (상대값). 「검색 적음」 은 데이터랩 기준이며 국내에 없다는 뜻이 아닙니다.`}
    >
      <Badge tone={NAVER_TONE[i.naver.label]} size="lg">
        {NAVER_LABEL[i.naver.label]}
        {i.naver.change !== null && i.naver.label !== "steady" ? ` ×${i.naver.change}` : ""}
      </Badge>
    </span>
  );
}

/** 국내 검색 꼬리표 · 쿠팡 검색어 — 카드마다 같은 자리 */
function TagLine({ i }: { i: Item }) {
  return (
    <div data-radar-tags className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-nd-fg-2">
      <NaverTag i={i} />
      {i.ai?.coupangQuery ? (
        <span className="min-w-0 truncate" title={`쿠팡에서 찾아볼 검색어 (AI 추정): ${i.ai.coupangQuery}`}>
          쿠팡 검색어 · <b className="font-medium text-nd-fg">{i.ai.coupangQuery}</b>
        </span>
      ) : (
        <span className="text-nd-fg-3">쿠팡 검색어 미확인</span>
      )}
    </div>
  );
}

// ---- 썸네일 ----------------------------------------------------------------

/**
 * 카드 위 큰 썸네일 — 쇼츠는 세로라 가운데 9:16 칸에 그 영상의 썸네일을, 양옆은 같은 그림을 흐리게 깐다.
 * YouTube 의 같은 영상 큰 썸네일(hq 480×360)부터 → 저장된 주소 → 아이콘 상자 (가짜 사진 금지).
 */
function RadarThumb({ i, onOpen, groupSize = 1, className }: { i: Item; onOpen: () => void; groupSize?: number; className?: string }) {
  const [step, setStep] = useState(0); // 0 = 큰 것 · 1 = 저장된 주소 · 2 = 실패
  const src = step === 0 ? hqOf(i.thumbnail) : step === 1 ? i.thumbnail : "";
  const dur = fmtDur(i.duration);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${i.title} — 쇼츠처럼 보기`}
      className={cn("group relative block aspect-video max-h-[280px] w-full shrink-0 overflow-hidden rounded-nd-md bg-nd-sunken text-nd-fg-3", className)}
    >
      {src ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" aria-hidden referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-2xl" />
          <span className="absolute inset-y-0 left-1/2 aspect-[9/16] h-full -translate-x-1/2 overflow-hidden bg-black/20 shadow-nd-dialog">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setStep(step === 0 && hqOf(i.thumbnail) !== i.thumbnail ? 1 : 2)}
              className="h-full w-full object-cover transition-transform duration-nd group-hover:scale-[1.03]"
            />
          </span>
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Film size={26} aria-hidden />
        </span>
      )}
      <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" aria-hidden />
      <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden>
        <Play size={20} fill="currentColor" className="ml-0.5" />
      </span>
      {groupSize > 1 && (
        <span className="absolute left-2 top-2 rounded-[6px] bg-black/70 px-2 py-0.5 text-[13px] font-medium text-white">같은 상품 {groupSize}편</span>
      )}
      {dur && <span className="nd-num absolute bottom-2 right-2 rounded-[6px] bg-black/75 px-1.5 py-0.5 text-[13px] font-semibold leading-tight text-white">{dur}</span>}
    </button>
  );
}

/** 표 줄의 작은 세로 썸네일 */
function MiniThumb({ i, onOpen }: { i: Item; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onOpen} aria-label={`${i.title} — 쇼츠처럼 보기`} className="relative h-14 w-10 shrink-0 overflow-hidden rounded-[6px] bg-nd-sunken text-nd-fg-3">
      {i.thumbnail && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hqOf(i.thumbnail)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Film size={16} aria-hidden />
        </span>
      )}
    </button>
  );
}

// ---- 동작 ------------------------------------------------------------------

interface Actions {
  me: string;
  busy: string | null;
  /** 오늘 레이더 AI 비용 · 하루 상한 (원) — 다시 분석 버튼 옆 */
  cost?: { spentKrw: number; budgetKrw: number };
  onSave: (i: Item) => void;
  onMake: (i: Item) => void;
  onDismiss: (i: Item, dismissed: boolean) => void;
  /** 댓글 원문 창 */
  onComments: (i: Item) => void;
  /** 메모 · AI 다시 분석 창 */
  onNotes: (i: Item) => void;
  /** 내 메모 저장 (빈 글이면 지움) */
  onNote: (i: Item, text: string) => Promise<unknown>;
  /** 메모 반영해 다시 분석 — 아직 저장 안 한 내 메모가 있으면 먼저 저장 */
  onReanalyze: (i: Item, unsaved?: string) => void;
  /** 직접 촬영 표시 — 같은 것을 다시 누르면 지움 */
  onFilmed: (i: Item, value: RadarFilmed | null) => void;
}

/** 소재로 저장 · 영상 만들기 · (메모) · 컷 표 · 제외(되살리기) · YouTube — 카드와 드로어가 같은 순서 */
function ActionRow({ i, a, linkLabel = "YouTube", notes = true }: { i: Item; a: Actions; linkLabel?: string; notes?: boolean }) {
  const saved = i.saved.some((s) => s.by === a.me);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {saved ? (
        <span className="inline-flex" title="내 소재(비공개)로 저장했습니다 — 「내가 저장한 것」 · 「저장한 소재」 에 있습니다">
          <Badge tone="success" size="lg">
            <BookmarkCheck size={14} aria-hidden />
            저장됨
          </Badge>
        </span>
      ) : (
        <Button icon={BookmarkPlus} loading={a.busy === `save-${i.id}`} onClick={() => a.onSave(i)}>
          소재로 저장
        </Button>
      )}
      <Button variant="secondary" icon={Clapperboard} loading={a.busy === `make-${i.id}`} onClick={() => a.onMake(i)}>
        영상 만들기
      </Button>
      {notes && (
        <Button variant="ghost" icon={StickyNote} onClick={() => a.onNotes(i)} title="직접 촬영 표시 · 메모를 남기면 AI 가 다시 분석할 때 참고합니다">
          메모{i.notes?.length ? ` ${i.notes.length}` : ""}
        </Button>
      )}
      <span className="ml-auto flex items-center gap-1">
        {/* 컷 전환마다 장면 · 말 · 초 (components/neander/shorts/cuts) — 그 구조로 대본을 쓴다 */}
        <CutsButton url={i.url} title={i.title} durationSec={i.duration} />
        {i.dismissed ? (
          <Button variant="ghost" icon={RotateCcw} loading={a.busy === `dis-${i.id}`} onClick={() => a.onDismiss(i, false)}>
            되살리기
          </Button>
        ) : (
          <Button variant="ghost" icon={EyeOff} loading={a.busy === `dis-${i.id}`} onClick={() => a.onDismiss(i, true)}>
            제외
          </Button>
        )}
        <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex h-ctl-md items-center gap-1 rounded-nd-md px-2 text-[13px] font-medium text-nd-fg-2 hover:bg-nd-fg/[.06] hover:text-nd-fg">
          {linkLabel} <ExternalLink size={14} aria-hidden />
        </a>
      </span>
    </div>
  );
}

// ---- 머리 카드 (실행 상태 · 비용 · 검색량 · 지금 돌리기 · 설정) ----------------------

function RadarHeader({ data, busy, onRun, onSaved }: { data: RadarData; busy: boolean; onRun: () => void; onSaved: () => Promise<void> }) {
  const { data: shorts } = useShorts();
  const { last, today, ready, settings } = data;
  const [open, setOpen] = useState(false);
  const id = useId();
  const warn = last?.notes.filter((n) => !/키가 없어/.test(n)) ?? [];
  const overBudget = today.budgetKrw > 0 && today.spentKrw >= today.budgetKrw;
  const searchFull = today.searchUsed >= today.searchLimit;
  // 「소재 발굴」 의 직접 검색(국내외 비교)은 개인 키가 있으면 내 계수기를 쓴다 — 회사 계수기와 따로 보인다
  const mine = shorts?.quotas.youtubeSearch;
  const status: { label: string; tone: Tone } = busy
    ? { label: "훑는 중", tone: "info" }
    : !ready.youtube
      ? { label: "YouTube 키 없음", tone: "danger" }
      : !last
        ? { label: "아직 안 돌림", tone: "neutral" }
        : warn.length
          ? { label: `실행 메모 ${warn.length}건`, tone: "warning" }
          : { label: "수집 완료", tone: "success" };
  return (
    <section data-radar-status className="nd-surface mb-4 rounded-nd-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 sm:px-6 sm:pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Radar size={22} className="shrink-0 text-nd-fg" aria-hidden />
          <h2 className="text-[19px] font-bold text-nd-fg">AI 레이더</h2>
          <Badge tone={status.tone} size="lg">
            {status.label}
          </Badge>
          {!settings.enabled && (
            <span className="inline-flex" title="매일 아침 자동 실행이 꺼져 있습니다 — 「실행 상세 · 설정」 에서 켭니다 (관리자)">
              <Badge tone="warning" size="lg">
                자동 꺼짐
              </Badge>
            </span>
          )}
        </div>
        <Button icon={Radar} loading={busy} disabled={!ready.youtube} onClick={onRun} title={!ready.youtube ? "회사 YouTube 키가 없어 돌릴 수 없습니다" : `YouTube 검색 최대 ${settings.maxSearchesPerRun}회 · AI 는 하루 상한 안에서`}>
          {busy ? "훑는 중… (1~2분)" : "지금 돌리기"}
        </Button>
      </div>
      <div className="mx-5 mt-4 border-t border-nd-line sm:mx-6" />
      <div className="grid gap-x-6 gap-y-3 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0" title="오늘 AI 상품 추정 · 다시 분석에 쓴 돈 (달러 어림 환산) / 하루 상한">
          <p className="nd-num flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] text-nd-fg-2">
            오늘 AI <b className={cn("font-bold", today.spentKrw > 0 ? "text-nd-danger-text" : "text-nd-fg")}>{won(today.spentKrw)}원</b> / 하루 상한 {won(today.budgetKrw)}원
            {overBudget && (
              <Badge tone="danger" size="lg">
                상한 도달
              </Badge>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-nd-fg-3">
            {last ? <AiCostNote compact estimate={`약 ${won(krwOf(last.aiUsd))}원 (지난 실행 기준)`} /> : <span>아직 실행 기록이 없어 예상 비용을 모릅니다</span>}
            <span aria-hidden>·</span>
            <span>달러를 {won(krwOf(1))}원으로 어림 환산</span>
          </p>
        </div>
        <div className="min-w-0">
          <p className={cn("nd-num text-[15px] text-nd-fg-2", searchFull && "text-nd-warning-text")} title="오늘 YouTube 검색 사용량 — 레이더 · 바이럴 형식 · 소재 발굴 검색이 같은 회사 한도를 씁니다">
            YouTube 검색 <b className="font-bold text-nd-fg">{today.searchUsed} / {today.searchLimit}회</b>
            {searchFull && <span className="ml-1.5 text-[13px] font-medium">오늘 한도 다 씀</span>}
          </p>
          <p className="mt-0.5 text-[13px] text-nd-fg-3">
            {settings.enabled ? "매일 아침 자동" : "자동 꺼짐"} · {last ? `마지막 ${fmtWhen(last.at)} · 새 후보 ${last.created}개` : "아직 실행 안 함"}
            {mine?.source === "personal" && ` · 내 검색 키 ${mine.used} / ${mine.limit}회`}
          </p>
        </div>
        <Button
          variant="ghost"
          icon={SlidersHorizontal}
          trailingIcon={ChevronDown}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className={cn("justify-self-start md:justify-self-end [&>svg:last-child]:transition-transform", open && "[&>svg:last-child]:rotate-180")}
        >
          실행 상세 · 설정
        </Button>
      </div>
      {open && (
        <div id={id} className="space-y-4 border-t border-nd-line px-5 py-4 text-nd-body text-nd-fg-2 sm:px-6">
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
            YouTube 검색 한도는 하루 {today.searchLimit}회로, 아래 「검색 표본 비교」 와 함께 씁니다. 오늘 AI 비용은 달러를 {won(krwOf(1))}원으로 어림 환산한 값입니다.
          </p>
          {(last?.notes.length ?? 0) > 0 && (
            <ul className="space-y-0.5 text-[13px] text-nd-warning-text">
              {last!.notes.map((n, k) => (
                <li key={k}>· {n}</li>
              ))}
            </ul>
          )}
          <div className="border-t border-nd-line pt-4">
            <h3 className="mb-3 text-[15px] font-semibold text-nd-fg">레이더 설정 · 점수 산식</h3>
            <RadarSettingsForm settings={settings} admin={data.admin} onSaved={onSaved} />
          </div>
        </div>
      )}
    </section>
  );
}

// ---- 필터 ------------------------------------------------------------------

function RadarFilters({
  filter,
  setFilter,
  keywordOptions,
  count,
  total,
}: {
  filter: RadarFilter;
  setFilter: (f: RadarFilter) => void;
  keywordOptions: string[];
  /** 지금 필터에 맞는 묶음 수 · 이 탭 전체 영상 수 */
  count: number;
  total: number;
}) {
  const set = <K extends keyof RadarFilter>(k: K, v: RadarFilter[K]) => setFilter({ ...filter, [k]: v });
  const filtered = !isDefaultRadarFilter(filter);
  return (
    <div data-radar-filters className="nd-surface mb-4 rounded-nd-lg px-4 py-4 sm:px-5">
      <FormRow className="grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4 lg:gap-x-4">
        <Field label="분류">
          <Select value={filter.category} onChange={(e) => set("category", e.target.value as RadarFilter["category"])}>
            <option value="all">전체</option>
            {RADAR_CATEGORIES.filter((c) => c !== "기타").map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="상품">
          <Select value={filter.product} onChange={(e) => set("product", e.target.value as RadarFilter["product"])}>
            <option value="all">전체</option>
            <option value="known">AI 추정 있음</option>
            <option value="unknown">확인 필요 · 모음</option>
            <option value="pending">AI 추정 전</option>
          </Select>
        </Field>
        <Field label="국내 검색">
          <Select value={filter.naver} onChange={(e) => set("naver", e.target.value as RadarFilter["naver"])}>
            <option value="all">전체</option>
            <option value="rising">상승</option>
            <option value="steady">유지</option>
            <option value="falling">하락</option>
            <option value="low">검색 적음</option>
            <option value="none">아직 안 봄</option>
          </Select>
        </Field>
        <Field label="평소 대비">
          <Select value={String(filter.minMultiple)} onChange={(e) => set("minMultiple", Number(e.target.value))}>
            <option value="0">전체</option>
            <option value="3">3배 이상</option>
            <option value="5">5배 이상</option>
            <option value="10">10배 이상</option>
            <option value="20">20배 이상</option>
          </Select>
        </Field>
        <Field label="올린 지">
          <Select value={String(filter.maxAgeDays)} onChange={(e) => set("maxAgeDays", Number(e.target.value))}>
            <option value="0">전체</option>
            <option value="3">최근 3일</option>
            <option value="7">최근 7일</option>
            <option value="14">최근 14일</option>
          </Select>
        </Field>
        <Field label="촬영">
          <Select value={filter.filmed ?? "all"} onChange={(e) => set("filmed", e.target.value as RadarFilter["filmed"])}>
            <option value="all">전체</option>
            <option value="self">직접 촬영</option>
            <option value="not_self">직접 촬영 아님</option>
            <option value="none">아직 표시 안 함</option>
          </Select>
        </Field>
        <Field label="발견 검색어">
          <Select value={filter.keyword} onChange={(e) => set("keyword", e.target.value)}>
            <option value="">전체 검색어</option>
            {keywordOptions.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="정렬">
          <Select value={filter.sort} onChange={(e) => set("sort", e.target.value as RadarFilter["sort"])}>
            {(Object.keys(SORT_LABEL) as RadarFilter["sort"][]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </FormRow>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SearchInput size="md" className="w-full sm:w-[340px]" value={filter.q} onValueChange={(q) => set("q", q)} placeholder="제목 · 상품 · 채널 검색" ariaLabel="제목 · 상품 · 채널 검색" />
        <p data-radar-count className="text-[13px] text-nd-fg-2">
          검색 조건에 맞는 후보 <b className="nd-num font-semibold text-nd-fg">{count}</b>개{filtered && <span className="text-nd-fg-3"> · 이 탭 전체 {total}편</span>}
        </p>
        <Button
          variant="ghost"
          icon={RotateCcw}
          className="ml-auto shrink-0"
          disabled={!filtered}
          title="필터를 모두 풉니다 — 정렬은 그대로 둡니다"
          onClick={() => setFilter({ ...DEFAULT_RADAR_FILTER, sort: filter.sort })}
        >
          필터 초기화
        </Button>
      </div>
    </div>
  );
}

// ---- 화면 ------------------------------------------------------------------

function RadarSkeleton() {
  return (
    <section className="mb-8" aria-busy="true">
      <p className="sr-only" role="status">
        AI 레이더를 불러오는 중…
      </p>
      <Skeleton className="mb-4 h-[150px] rounded-nd-lg" />
      <Skeleton className="mb-4 h-11 w-96 max-w-full" />
      <Skeleton className="mb-4 h-[180px] rounded-nd-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((k) => (
          <div key={k} className="nd-surface space-y-3 rounded-nd-lg p-5">
            <Skeleton className="aspect-video max-h-[280px] w-full" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function RadarPanel({
  tab: tabProp,
  onTabChange,
  savedSlot,
  savedCount,
}: {
  /** 지금 탭 — 화면이 들고 있으면 넘긴다 (없으면 스스로 기억) */
  tab?: RadarTab;
  onTabChange?: (tab: RadarTab) => void;
  /** 「내가 저장한 것」 탭 맨 위에 그릴 것 (저장한 소재 표 · 가중치) */
  savedSlot?: ReactNode;
  /** 「내가 저장한 것」 탭 숫자 — savedSlot 의 소재 수 (없으면 레이더에서 저장한 후보 수) */
  savedCount?: number;
} = {}) {
  const { refresh: refreshShorts } = useShorts();
  const router = useRouter();
  const { busy, run } = useAction();
  const toast = useToast();
  const [data, setData] = useState<RadarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabState, setTabState] = useState<RadarTab>("new");
  const tab = tabProp ?? tabState;
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilterState] = useState<RadarFilter>(DEFAULT_RADAR_FILTER);
  // 쇼츠처럼 보기 드로어 — 처음 보여 줄 영상 id (null = 닫힘. 같은 상품 묶음 안의 다른 영상일 수도 있다)
  const [feedStart, setFeedStart] = useState<string | null>(null);
  // 카드의 「댓글 원문」 창
  const [commentsOf, setCommentsOf] = useState<Item | null>(null);
  // 카드의 「메모」 창 — id 로 들고 있다가 새로 받은 자료에서 찾는다 (다시 분석하면 바로 바뀌게)
  const [notesId, setNotesId] = useState<string | null>(null);
  // 쇼츠처럼 보기 — 마지막으로 본 후보 (이 브라우저)
  const { last: feedLast, onSeen } = useFeedResume(FEED_LAST_KEY);
  // 한 후보만 바로 고친다 (목록 전체를 다시 받지 않게 — 넘기며 빠르게 표시할 때)
  const patchItem = (id: string, patch: Partial<Item>) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : d));

  const setTab = (t: RadarTab) => {
    setTabState(t);
    setLimit(PAGE);
    onTabChange?.(t);
  };

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
  // 이어 보기 — 마지막으로 본 영상이 지금 목록(탭 · 필터 · 정렬)의 몇 번째인가 (없으면 -1)
  const resumeIdx = feedLast ? groups.findIndex((g) => g.items.some((x) => x.id === feedLast.id)) : -1;
  const resumeItem = resumeIdx >= 0 ? (groups[resumeIdx].items.find((x) => x.id === feedLast?.id) ?? null) : null;
  const filmedCount = useMemo(() => radarFilmedCounts(groups.flatMap((g) => g.items)), [groups]);
  const shownCount = groups.reduce((n, g) => n + g.items.length, 0);

  const save = async (i: Item) => {
    const r = await shortsPost<{ trendId: string }>("radar", { action: "save", id: i.id });
    await Promise.all([load(), refreshShorts()]);
    return r.trendId;
  };
  const actions: Actions = {
    me: data?.me ?? "",
    busy,
    cost: data ? { spentKrw: data.today.spentKrw, budgetKrw: data.today.budgetKrw } : undefined,
    onSave: (i) => void run(`save-${i.id}`, () => save(i), "내 소재로 저장했습니다 — 「내가 저장한 것」 · 「저장한 소재」 에 있습니다."),
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
    onComments: (i) => setCommentsOf(i),
    onNotes: (i) => setNotesId(i.id),
    onNote: (i, text) =>
      run(`note-${i.id}`, async () => {
        await shortsPost("radar", { action: "note", id: i.id, text });
        await load();
      }),
    onFilmed: (i, value) => {
      const prev = i.filmed ?? null;
      patchItem(i.id, { filmed: value ? { value, by: data?.me ?? "", at: Date.now() } : null });
      void shortsPost<{ filmed: Item["filmed"] }>("radar", { action: "filmed", id: i.id, value })
        .then((r) => patchItem(i.id, { filmed: r.filmed }))
        .catch((e) => {
          patchItem(i.id, { filmed: prev });
          toast.error(e instanceof Error ? e.message : "직접 촬영 표시를 저장하지 못했습니다.");
        });
    },
    onReanalyze: (i, unsaved) =>
      void run(
        `re-${i.id}`,
        async () => {
          if (unsaved !== undefined) await shortsPost("radar", { action: "note", id: i.id, text: unsaved });
          await shortsPost("radar", { action: "reanalyze", id: i.id });
          await load();
        },
        "메모를 반영해 AI 가 다시 분석했습니다.",
      ),
  };
  const notesItem = notesId ? (data?.items.find((x) => x.id === notesId) ?? null) : null;
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
      <section className="mb-8">
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
  const startFeed = (id: string | null) => setFeedStart(id);

  const filters = <RadarFilters filter={filter} setFilter={setFilter} keywordOptions={keywordOptions} count={groups.length} total={lists[tab].length} />;

  // 쇼츠처럼 보기 줄 — 처음부터 · 이어 보기(마지막으로 본 후보) · 직접 촬영 표시 수
  const feedBar = (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="secondary" icon={GalleryVerticalEnd} disabled={!groups.length} onClick={() => startFeed(groups[0]?.items[0].id ?? null)}>
        {resumeIdx > 0 ? "처음부터 쇼츠처럼 보기" : "쇼츠처럼 보기"}
      </Button>
      {resumeIdx > 0 && resumeItem && (
        <Button variant="soft" onClick={() => startFeed(resumeItem.id)} title={`쇼츠처럼 보기에서 마지막으로 본 영상(${resumeIdx + 1}번째)부터 이어서 봅니다`}>
          이어 보기 · <span className="nd-num">{resumeIdx + 1}</span>번째
        </Button>
      )}
      <span className="min-w-0 truncate text-[13px] text-nd-fg-2">
        {resumeIdx > 0 && resumeItem ? `마지막으로 본 후보: ${resumeItem.ai?.product || resumeItem.title}` : "세로 영상을 한 편씩 넘겨 보며 저장 · 제외 · 촬영 표시"}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[13px] text-nd-fg-3">
        <span className="nd-num" title="사람이 영상을 보고 고른 「직접 촬영」 표시 — 지금 목록 기준">
          직접 촬영 {filmedCount.self} · 아님 {filmedCount.not_self} · 표시 전 {filmedCount.none}
        </span>
        <span className="nd-num text-nd-fg-2" title="편 = 영상 수 · 묶음 = AI 가 같은 상품으로 본 영상끼리 한 카드">
          {shownCount}편 · {groups.length}묶음
        </span>
      </span>
    </div>
  );

  const emptyTitle =
    filtered && lists[tab].length ? "필터에 맞는 후보가 없습니다" : tab === "new" ? (last ? "새 후보가 없습니다" : "아직 돌린 적이 없습니다") : tab === "saved" ? "레이더에서 저장한 후보가 없습니다" : "제외하거나 무관한 후보가 없습니다";
  const emptyDesc =
    filtered && lists[tab].length
      ? "필터를 풀면 이 탭의 후보가 다시 보입니다."
      : tab === "new"
        ? last
          ? "내일 아침 다시 훑습니다. 검색어를 바꾸려면 위 「실행 상세 · 설정」 을 여세요."
          : `「지금 돌리기」 를 누르면 YouTube 검색 ${settings.maxSearchesPerRun}회와 AI 수십 원 안쪽으로 첫 후보를 모읍니다. 매일 아침에는 저절로 돕니다.`
        : tab === "saved"
          ? "후보 카드의 「소재로 저장」 을 누르면 내 소재(비공개)로 저장되고 여기에 모입니다."
          : "「제외」 한 후보와 AI 가 살림 상품 영상이 아니라고 본 후보가 여기에 모입니다.";
  const empty = (
    <EmptyState
      compact
      icon={Radar}
      title={emptyTitle}
      description={emptyDesc}
      action={
        filtered && lists[tab].length ? (
          <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setFilter({ ...DEFAULT_RADAR_FILTER, sort: filter.sort })}>
            필터 초기화
          </Button>
        ) : undefined
      }
    />
  );

  // 카드 목록 — 목록 폭 1000px 이상 2열 · 1800px 이상 3열 (카드가 반응 세 칸을 담을 만큼 넓을 때만 나눈다)
  const cards =
    groups.length === 0 ? (
      empty
    ) : (
      <div className="[container-type:inline-size]">
        <div className="grid grid-cols-1 items-stretch gap-4 [@container(min-width:1000px)]:grid-cols-2 [@container(min-width:1800px)]:grid-cols-3">
          {groups.slice(0, limit).map((g) => (
            <RadarCard key={g.key} items={g.items} a={actions} onOpen={(i) => startFeed(i.id)} />
          ))}
        </div>
      </div>
    );
  const more = groups.length > limit && (
    <div className="mt-4 flex justify-center">
      <Button variant="secondary" icon={ChevronDown} onClick={() => setLimit(limit + PAGE)}>
        {groups.length - limit}묶음 더 보기
      </Button>
    </div>
  );
  const footnote = (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-3">
      <Info size={14} aria-hidden />
      <span>요청 = 읽은 댓글 표본 중 정보 · 구매처 요청 비율(조회수 대비 아님)</span>
      <span aria-hidden>·</span>
      <span>평소 대비 = 해당 채널 최근 쇼츠 조회수 중앙값 기준</span>
      <span aria-hidden>·</span>
      <span>묶음 카드의 숫자는 대표 영상 하나의 값</span>
      <span aria-hidden>·</span>
      <span>AI 상품명 · 해설은 추정</span>
    </p>
  );
  const outRows = groups.flatMap((g) => g.items);

  return (
    <section data-radar className="mb-8">
      <RadarHeader data={data} busy={busy === "run"} onRun={runNow} onSaved={load} />

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
      {!ready.youtube && (
        <StudioNotice tone="warning" className="mb-4" title="레이더를 돌릴 수 없습니다">
          회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없습니다.
        </StudioNotice>
      )}
      {ready.youtube && !ready.ai && (
        <StudioNotice tone="warning" className="mb-4" title="AI 상품 추정 없이 숫자만 모읍니다">
          OPENROUTER_API_KEY 가 없습니다.
        </StudioNotice>
      )}
      {ready.youtube && !ready.naver && (
        <StudioNotice tone="info" className="mb-4" title="국내 검색 추세가 붙지 않습니다">
          네이버 데이터랩 키(NAVER API HUB 의 Client ID · Secret → NEANDER_SHORTS_NAVER_CLIENT_ID · _SECRET)를 넣으면 후보마다 국내 검색 추세가 붙습니다.
        </StudioNotice>
      )}
      <StudioNotice tone="info" className="mb-4" title="공용 후보 → 내 소재">
        후보 · 메모 · 직접 촬영 표시는 이 프로젝트의 회사 공용입니다. 「소재로 저장」 하면 내 소재(나만 보기)로 저장되어 「내가 저장한 것」 과 「저장한 소재」 에 들어갑니다.
      </StudioNotice>

      <div className="nd-scroll mb-4 overflow-x-auto">
        <Tabs
          ariaLabel="레이더 목록"
          value={tab}
          onChange={(k) => setTab(k as RadarTab)}
          items={[
            { key: "new", label: "새 후보", hint: String(lists.new.length) },
            { key: "saved", label: "내가 저장한 것", hint: String(savedSlot !== undefined && savedCount !== undefined ? savedCount : lists.saved.length) },
            { key: "out", label: "제외 · 무관", hint: String(lists.out.length) },
          ]}
        />
      </div>

      {tab === "new" && (
        <>
          {filters}
          <StudioNotice tone="info" className="mb-4" title="레이더 점수 · 100점 만점">
            평소 대비 배수 40점 + 하루 조회 속도 40점 + 정보 요청 댓글 20점. 모르는 항목은 0점으로 계산합니다. 저장한 소재의 반응 점수는 따로 셈하는 산식입니다.
          </StudioNotice>
          {feedBar}
          {cards}
          {more}
          {footnote}
        </>
      )}

      {tab === "saved" && (
        <>
          {savedSlot}
          <StudioSection
            className={savedSlot ? "mt-6" : undefined}
            title={`레이더에서 저장한 후보 ${lists.saved.length}편`}
            description="내가 「소재로 저장」 한 레이더 후보 — 숫자 · AI 추정 · 메모는 레이더가 계속 고칩니다"
          >
            {lists.saved.length > 0 && filters}
            {lists.saved.length > 0 && feedBar}
            {cards}
            {more}
          </StudioSection>
        </>
      )}

      {tab === "out" && (
        <>
          {filters}
          {outRows.length === 0 ? (
            empty
          ) : (
            <StudioCard flush title="제외 · 무관 후보" description="사람이 「제외」 한 후보와 AI 가 살림 상품 영상이 아니라고 본 후보 — 이름을 누르면 쇼츠처럼 봅니다">
              <div className="px-3 pb-3 md:p-0">
                <ExcludedTable items={outRows.slice(0, limit)} a={actions} onOpen={(i) => startFeed(i.id)} />
              </div>
            </StudioCard>
          )}
          {outRows.length > limit && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" icon={ChevronDown} onClick={() => setLimit(limit + PAGE)}>
                {outRows.length - limit}편 더 보기
              </Button>
            </div>
          )}
        </>
      )}

      <ShortsFeedSheet
        startId={feedStart}
        groups={groups}
        onClose={() => setFeedStart(null)}
        onSeen={onSeen}
        ariaLabel="후보 쇼츠처럼 보기"
        subtitle={`AI 레이더 · ${tab === "new" ? "새 후보" : tab === "saved" ? "내가 저장한 것" : "제외 · 무관"} · 마지막으로 본 위치를 기억해 다음에 이어 봅니다`}
        hint="1 직접 촬영 · 2 직접 촬영 아님 · 0 표시 지우기 · ↑↓ 휠 넘기기 · 스페이스 재생/정지 · M 소리"
        emptyTitle="넘겨 볼 후보가 없습니다"
        onKey={(k, it, e) => {
          // 1 직접 촬영 · 2 직접 촬영 아님 · 0 지우기 — 보면서 바로 표시
          if ((k !== "1" && k !== "2" && k !== "0") || e.metaKey || e.ctrlKey || e.altKey) return false;
          e.preventDefault();
          const v = k === "1" ? "self" : k === "2" ? "not_self" : null;
          if ((it.filmed?.value ?? null) !== v) actions.onFilmed(it, v);
          return true;
        }}
        renderSlide={({ item, group, active, onPick, onFocus, index, total, onNext }) => (
          <FeedSlide i={item} group={group} active={active} a={actions} onPick={onPick} onFocus={onFocus} index={index} total={total} onNext={onNext} />
        )}
      />

      <Dialog open={!!commentsOf} onClose={() => setCommentsOf(null)} size="lg" title="댓글 원문" description={commentsOf?.title}>
        {commentsOf && <CommentList key={commentsOf.id} i={commentsOf} />}
      </Dialog>

      <Dialog open={!!notesItem} onClose={() => setNotesId(null)} size="lg" title="회사 공용 메모 · AI 분석" description={notesItem?.title}>
        {notesItem && (
          <div className="space-y-4">
            <NotePanel key={notesItem.id} i={notesItem} a={actions} />
            <div className="rounded-nd-md bg-nd-accent-soft/60 px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone={notesItem.ai ? "accent" : "neutral"} size="md">
                  {notesItem.ai ? "AI 추정" : "AI 분석 전"}
                </Badge>
                <NoteBadge state={radarNoteState(notesItem)} />
                <span className="text-[13px] font-medium text-nd-fg-2">지금 분석</span>
              </div>
              <Analysis i={notesItem} />
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

function RadarCard({ items, a, onOpen }: { items: Item[]; a: Actions; onOpen: (i: Item) => void }) {
  const i = items[0];
  // 위에서부터 같은 순서 · 같은 높이 — 카드끼리 견줄 때 같은 자리에 같은 숫자가 오게
  return (
    <article data-radar-card className="nd-surface flex min-w-0 flex-col gap-3.5 rounded-nd-lg p-4 sm:p-5">
      <RadarThumb i={i} onOpen={() => onOpen(i)} groupSize={items.length} />
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <BadgeRow i={i} />
          <Headline i={i} onOpen={() => onOpen(i)} />
          <MetaLine i={i} groupSize={items.length} />
        </div>
        <ScoreBox score={i.score} className="pt-0.5" />
      </div>
      <ViewsLine i={i} />
      <Engagement i={i} onComments={() => a.onComments(i)} />
      <AiBox i={i} />
      <TagLine i={i} />
      <div className="border-t border-nd-line pt-3">
        <MemoBlock i={i} a={a} />
      </div>
      <div className="mt-auto border-t border-nd-line pt-3">
        <ActionRow i={i} a={a} notes={false} />
      </div>
    </article>
  );
}

// ---- 제외 · 무관 표 ----------------------------------------------------------

/**
 * 제외 · 무관 후보 — 분류(사람 제외 · AI 무관) · 사유(남은 메모 · AI 근거) · 쓴 사람 · 되살리기.
 * 제외에는 사유 칸이 따로 없다 — 남긴 메모가 있으면 그것을, 없으면 「사유 기록 없음」 으로 보인다.
 */
function ExcludedTable({ items, a, onOpen }: { items: Item[]; a: Actions; onOpen: (i: Item) => void }) {
  const { nameOf } = useShorts();
  const columns: RecordColumn<Item>[] = [
    {
      key: "item",
      header: "후보",
      mobile: "title",
      // 표는 글 길이대로 늘어나므로 — 폭을 비율로 정하고(max-w-0) 긴 제목은 말줄임
      className: "md:w-[36%] md:max-w-0",
      cell: (i) => (
        <div className="flex min-w-0 items-center gap-3">
          <MiniThumb i={i} onOpen={() => onOpen(i)} />
          <div className="min-w-0">
            <button type="button" onClick={() => onOpen(i)} className="block max-w-full truncate text-left text-[14px] font-semibold text-nd-fg hover:underline" title={i.title}>
              {i.ai?.product || i.title}
            </button>
            <p className="truncate text-[13px] font-normal text-nd-fg-3" title={i.title}>
              {i.ai?.product ? `${i.title} · ` : ""}
              {i.channel || "채널 미확인"} · {fmtAgo(i.publishedAt)}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "분류",
      className: "md:min-w-[130px]",
      cell: (i) => (
        <span className="inline-flex flex-wrap justify-end gap-1 md:justify-start">
          {i.dismissed && (
            <Badge tone="neutral" size="lg">
              제외
            </Badge>
          )}
          {i.ai?.relevant === false && (
            <span className="inline-flex" title="AI 가 글로 보고 살림 · 주방 · 수납 · 청소 상품 영상이 아니라고 봤습니다 (추정)">
              <Badge tone="warning" size="lg">
                무관 · AI
              </Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "why",
      header: "사유 · 쓴 사람",
      mobileLabel: "사유",
      className: "md:w-[40%] md:max-w-0",
      cell: (i) => {
        const note = [...(i.notes ?? [])].sort((x, y) => y.at - x.at)[0];
        if (i.dismissed) {
          return (
            <div className="min-w-0">
              <p className={cn("line-clamp-2 text-[13px] [overflow-wrap:anywhere]", note ? "text-nd-fg" : "text-nd-fg-3")} title={note?.text}>
                {note ? `메모 · ${note.text}` : "사유 기록 없음"}
              </p>
              <p className="mt-0.5 text-[13px] text-nd-fg-3">
                {nameOf(i.dismissed.by)} · {fmtWhen(i.dismissed.at)} 제외{note && note.by !== i.dismissed.by ? ` · 메모 ${nameOf(note.by)}` : ""}
              </p>
            </div>
          );
        }
        return (
          <div className="min-w-0">
            <p className="line-clamp-2 text-[13px] text-nd-fg [overflow-wrap:anywhere]" title={i.ai?.evidence}>
              살림 상품 영상 아님 — {i.ai?.evidence || "근거 없음"}
            </p>
            <p className="mt-0.5 text-[13px] text-nd-fg-3">AI 추정 · {fmtWhen(i.ai?.at)}</p>
          </div>
        );
      },
    },
    {
      key: "score",
      header: "레이더 점수",
      align: "right",
      className: "md:min-w-[110px]",
      cell: (i) => <span className="font-semibold">{i.score.toFixed(1)}</span>,
    },
    {
      key: "act",
      header: "작업",
      className: "md:min-w-[210px]",
      cell: (i) =>
        i.dismissed ? (
          <Button variant="secondary" icon={RotateCcw} loading={a.busy === `dis-${i.id}`} onClick={() => a.onDismiss(i, false)} title={i.ai?.relevant === false ? "제외를 풉니다 — AI 가 무관으로 본 후보라 이 탭에 「무관」 으로 남습니다" : "새 후보로 돌려놓습니다"}>
            새 후보로 되살리기
          </Button>
        ) : (
          <Button variant="secondary" icon={StickyNote} onClick={() => a.onNotes(i)} title="AI 판단이 틀렸으면 메모를 남기고 다시 분석합니다 (약 2원)">
            메모 · 다시 분석
          </Button>
        ),
    },
  ];
  return <RecordTable rows={items} columns={columns} rowKey={(i) => i.id} ariaLabel="제외 · 무관 후보" />;
}

// ---- 쇼츠처럼 보기 (오른쪽 드로어 · 공용 feed/ShortsFeed) ----------------------------

/** 쇼츠 한 칸 — 왼쪽 세로 영상(+ 몇 번째 · 다음 후보), 오른쪽(좁으면 아래) 반응 · 분석 · 댓글 원문 · 메모 · 버튼 */
function FeedSlide({
  i,
  group,
  active,
  a,
  onPick,
  onFocus,
  index,
  total,
  onNext,
}: {
  i: Item;
  group: Item[];
  active: boolean;
  a: Actions;
  onPick: (id: string) => void;
  onFocus: () => void;
  index: number;
  total: number;
  onNext: () => void;
}) {
  // 댓글은 누를 때만 읽는다 (넘길 때마다 YouTube 를 부르지 않게) — 다른 영상으로 바뀌면 닫는다
  const [comments, setComments] = useState(false);
  useEffect(() => setComments(false), [i.id]);
  const dur = fmtDur(i.duration);
  return (
    <FeedSlideLayout
      video={<FeedVideo active={active} videoId={i.videoId} thumbnail={i.thumbnail} title={i.title} url={i.url} onFocus={onFocus} />}
      videoFooter={
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="nd-num truncate text-[13px] text-nd-fg-2">
            {index + 1} / {total}
            {dur ? ` · ${dur}` : ""}
          </span>
          <Button size="sm" variant="secondary" icon={ArrowDown} data-feed-key disabled={index >= total - 1} onClick={onNext}>
            다음 후보
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <BadgeRow i={i} />
          <Headline i={i} size="lg" />
          <MetaLine i={i} keywords />
        </div>
        <ScoreBox score={i.score} />
      </div>
      <ViewsLine i={i} detail />
      <Engagement i={i} onComments={() => setComments(true)} />
      <AiBox i={i} full />
      <TagLine i={i} />
      <section aria-label="댓글 원문" className="rounded-nd-md border border-nd-line px-3.5 py-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-[14px] font-semibold text-nd-fg">
            댓글 원문{i.comments !== null && <span className="nd-num ml-1.5 text-[13px] font-normal text-nd-fg-3">댓글 {won(i.comments)}개</span>}
          </h4>
          {comments && (
            <button type="button" onClick={() => setComments(false)} className="text-[13px] font-medium text-nd-accent hover:underline">
              접기
            </button>
          )}
        </div>
        {comments ? (
          <CommentList i={i} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="sm" variant="secondary" icon={MessageCircle} disabled={i.comments === 0} onClick={() => setComments(true)}>
              댓글 원문 읽기
            </Button>
            <span className="text-[13px] text-nd-fg-3">누를 때 YouTube 에서 30개씩 읽어 옵니다 (저장 안 함)</span>
          </div>
        )}
      </section>
      <section aria-label="회사 공용 메모 · 촬영" className="rounded-nd-md border border-nd-line bg-nd-sunken/50 px-3.5 py-3">
        <h4 className="mb-2 text-[14px] font-semibold text-nd-fg">회사 공용 메모 · 직접 촬영</h4>
        <NotePanel i={i} a={a} keys />
      </section>
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
                  <span className="shrink-0 text-nd-fg-3">평소의 {x.multiple === null ? "미확인" : fmtMultiple(x.multiple)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="sticky bottom-0 mt-auto border-t border-nd-line bg-nd-content pt-3">
        <ActionRow i={i} a={a} linkLabel="YouTube에서 열기" notes={false} />
      </div>
    </FeedSlideLayout>
  );
}

function RadarSettingsForm({ settings, admin, onSaved }: { settings: RadarSettings; admin: boolean; onSaved: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ ...settings });
  return (
    <div className="space-y-4">
      <p className="text-nd-body leading-relaxed text-nd-fg-2">
        점수 = 평소 대비 배수 40점(1배 0 → 20배 이상 40) + 하루 조회 속도 40점(1천 0 → 100만 이상 40) + 「어디서 사요 · 링크」 댓글 비율 20점(20% 이상 20). 모르는 항목은 0점입니다.
        상품은 AI 가 영상을 보지 않고 제목 · 설명 · 태그 · 댓글 글로 추정합니다. 국내 추세는 네이버 데이터랩 상대값입니다.
      </p>
      {!admin && <InlineNotice tone="neutral">설정은 AI STUDIO 관리자만 바꿉니다.</InlineNotice>}
      <Switch checked={f.enabled} disabled={!admin} onChange={(v) => setF({ ...f, enabled: v })} label="매일 아침 자동으로 훑기" />
      <p className="text-nd-body text-nd-fg-2">
        검색어는 맨 위 「조사 키워드」 막대에서 고칩니다 — 지금 {settings.keywords.length}개{settings.keywords.length ? ` (${settings.keywords.slice(0, 5).join(", ")}${settings.keywords.length > 5 ? " …" : ""})` : ""}.
      </p>
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
                // 검색어는 보내지 않는다 — 조사 키워드 막대가 정본이다 (서버는 빠진 값을 그대로 둔다)
                const { keywords: _k, ...rest } = f;
                await shortsPost("radar", { action: "settings.save", settings: rest });
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
