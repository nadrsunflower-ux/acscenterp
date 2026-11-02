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
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  Hand,
  Clapperboard,
  ExternalLink,
  EyeOff,
  Film,
  GalleryVerticalEnd,
  Info,
  MessageCircle,
  Play,
  Radar,
  RotateCcw,
  Sparkles,
  SquarePlay,
  StickyNote,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  InlineNotice,
  NumberInput,
  SearchInput,
  SegmentedControl,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
  cn,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, SourceTag, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { Ago, Multiple, fmtAgo, fmtDur } from "@/components/neander/shorts/scout/bits";
import { FeedSlideLayout, FeedVideo, ShortsFeedSheet, hqOf, useFeedResume } from "@/components/neander/shorts/feed/ShortsFeed";
import { countInfoRequests } from "@/lib/neander/shorts/model";
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

const NAVER_TONE: Record<NaverTrend["label"], Tone> = { rising: "success", steady: "neutral", falling: "warning", low: "neutral" };
const FILTER_KEY = "neander.shorts.radarFilter";
/** 쇼츠처럼 보기에서 마지막으로 본 후보 (이 브라우저) — 다시 열 때 그 영상부터 */
const FEED_LAST_KEY = "neander.shorts.radarFeedLast";
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
      {i.filmed && <FilmedBadge f={i.filmed} />}
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

// ---- 반응 줄 (좋아요 · 댓글 · 저장) · 댓글 원문 ------------------------------

const pct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;

/**
 * 좋아요 · 댓글 · 저장 — 조회수와 같은 때 YouTube Data API 로 받은 값. 저장 · 공유 수는 YouTube 가 공개하지 않는다
 * (채널 주인만 YouTube Studio 에서 본다) — 0 이 아니라 「비공개」 로 적는다.
 */
function Engagement({ i, onComments, className }: { i: Item; onComments?: () => void; className?: string }) {
  const likeRate = i.likes !== null && i.views ? i.likes / i.views : null;
  const at = `YouTube Data API · ${fmtWhen(i.viewsAt)} 기준`;
  // 세 칸 고정 — 카드마다 같은 자리 · 같은 높이 (숫자 줄은 줄바꿈 없이)
  const cell = "min-w-0";
  const label = "flex items-center gap-1 text-[13px] text-nd-fg-3";
  const value = "mt-0.5 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-[15px] font-semibold text-nd-fg";
  return (
    <dl data-radar-engagement className={cn("grid grid-cols-3 gap-x-3 rounded-nd-md bg-nd-sunken/70 px-3 py-2", className)}>
      <div className={cell} title={`좋아요 수 — ${at}${likeRate !== null ? ` · 조회수 대비 ${pct(likeRate)}` : ""}`}>
        <dt className={label}>
          <ThumbsUp size={13} className="shrink-0" aria-hidden />
          좋아요
        </dt>
        <dd className={value}>
          {i.likes === null ? (
            <span className="font-normal text-nd-fg-3" title="채널이 좋아요 수를 숨겼습니다 — YouTube API 가 값을 주지 않습니다 (0 이 아닙니다)">
              비공개
            </span>
          ) : (
            <span className="nd-num truncate">{won(i.likes)}</span>
          )}
        </dd>
      </div>
      <div className={cell} title={`댓글 수 — ${at}`}>
        <dt className={label}>
          <MessageCircle size={13} className="shrink-0" aria-hidden />
          댓글
        </dt>
        <dd className={value}>
          {i.comments === null ? (
            <span className="font-normal text-nd-fg-3" title="댓글이 꺼져 있거나 받지 못했습니다">
              꺼짐
            </span>
          ) : (
            <span className="nd-num truncate">{won(i.comments)}</span>
          )}
          {onComments && (i.comments ?? 0) > 0 && (
            <button type="button" onClick={onComments} className="shrink-0 text-[13px] font-medium text-nd-accent hover:underline" aria-label={`댓글 ${won(i.comments ?? 0)}개 보기`}>
              보기
            </button>
          )}
        </dd>
      </div>
      <div className={cell} title="YouTube 는 저장 · 공유 수를 API 로 공개하지 않습니다 — 채널 주인만 YouTube Studio 에서 볼 수 있습니다">
        <dt className={label}>
          <Bookmark size={13} className="shrink-0" aria-hidden />
          저장
        </dt>
        <dd className={cn(value, "font-normal text-nd-fg-3")}>비공개</dd>
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
          <span className="inline-flex" title="「어디서 사요 · 링크 · 제품명」 같은 정보 요청 낱말이 들어 있습니다 — 카드의 「요청 댓글」 과 같은 기준">
            <Badge tone="accent" size="sm">
              정보 요청
            </Badge>
          </span>
        )}
      </div>
      <p className={cn("mt-1 whitespace-pre-line text-nd-body leading-relaxed text-nd-fg [overflow-wrap:anywhere]", long && !open && "line-clamp-5")}>{c.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-nd-fg-3">
        <span className="nd-num inline-flex items-center gap-1">
          <ThumbsUp size={12} aria-hidden />
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
          size="sm"
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

// ---- 메모 (AI 가 참고) -------------------------------------------------------

/** AI 요약 줄의 메모 표시 — 반영했으면 「메모 반영」, 분석 뒤에 바뀌었으면 「메모 반영 전」 */
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
    <Badge tone={f.value === "self" ? "success" : "neutral"} size="md">
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
        "inline-flex h-8 items-center gap-1 rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors",
        cur === v
          ? v === "self"
            ? "border-nd-success/40 bg-nd-success-soft text-nd-success-text"
            : "border-nd-fg-3/40 bg-nd-fg/[.08] text-nd-fg"
          : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
      )}
    >
      {RADAR_FILMED_LABEL[v]}
      {keys && <kbd className="ml-0.5 rounded-[4px] bg-nd-fg/[.06] px-1 text-[12px] font-normal text-nd-fg-3">{hint}</kbd>}
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
          icon={Sparkles}
          loading={busyRe}
          disabled={!hasAny || (a.busy !== null && !busyRe)}
          onClick={() => a.onReanalyze(i, dirty ? text : undefined)}
          title="이 영상 하나만 메모와 함께 AI 에 다시 보냅니다 (글만 읽음 · 약 2원 · 레이더 하루 상한 안)"
        >
          {busyRe ? "다시 분석하는 중…" : i.ai ? "메모 반영해 다시 분석 (약 2원)" : "메모 반영해 분석 (약 2원)"}
        </Button>
        <span className="text-[13px] text-nd-fg-3">
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
        </span>
      </div>
    </div>
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
    return (
      <div className={cn("rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] text-nd-fg-3", className)}>
        AI 분석 전 — 상품 · 해설 없이 숫자만 모았습니다{i.notes?.length ? ` · 메모 ${i.notes.length}개는 분석 때 참고` : ""}
      </div>
    );
  }
  const summary = ai.why || ai.hook || ai.evidence || "해설 없음";
  const ns = radarNoteState(i);
  return (
    <div className={cn("rounded-nd-md bg-nd-accent-soft/60", className)}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
        <Badge tone="accent" size="md" className="shrink-0">
          AI 추정
        </Badge>
        <NoteBadge state={ns} />
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

/** 소재로 저장 · 영상 만들기 · 제외(되살리기) · YouTube — 카드와 플레이어가 같은 순서 */
function ActionRow({ i, a, linkLabel = "YouTube", notes = true }: { i: Item; a: Actions; linkLabel?: string; notes?: boolean }) {
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
      {notes && (
        <Button size="sm" variant="ghost" icon={StickyNote} onClick={() => a.onNotes(i)} title="직접 촬영 표시 · 메모를 남기면 AI 가 다시 분석할 때 참고합니다">
          메모{i.notes?.length ? ` ${i.notes.length}` : ""}
        </Button>
      )}
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
        <LabeledSelect label="촬영" className={cell} value={filter.filmed ?? "all"} onChange={(v) => set("filmed", v as RadarFilter["filmed"])}>
          <option value="all">전체</option>
          <option value="self">직접 촬영</option>
          <option value="not_self">직접 촬영 아님</option>
          <option value="none">아직 표시 안 함</option>
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
  const toast = useToast();
  const [data, setData] = useState<RadarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "saved" | "out">("new");
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilterState] = useState<RadarFilter>(DEFAULT_RADAR_FILTER);
  // 쇼츠처럼 보기 드로어 — 처음 보여 줄 영상 id (null = 닫힘. 같은 상품 묶음 안의 다른 영상일 수도 있다)
  const [feedStart, setFeedStart] = useState<string | null>(null);
  // 카드의 「댓글 보기」 창
  const [commentsOf, setCommentsOf] = useState<Item | null>(null);
  // 카드의 「메모」 창 — id 로 들고 있다가 새로 받은 자료에서 찾는다 (다시 분석하면 바로 바뀌게)
  const [notesId, setNotesId] = useState<string | null>(null);
  // 쇼츠처럼 보기 — 마지막으로 본 후보 (이 브라우저)
  const { last: feedLast, onSeen } = useFeedResume(FEED_LAST_KEY);
  // 한 후보만 바로 고친다 (목록 전체를 다시 받지 않게 — 넘기며 빠르게 표시할 때)
  const patchItem = (id: string, patch: Partial<Item>) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : d));

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
          <span className="nd-num text-[13px] text-nd-fg-3" title="사람이 영상을 보고 고른 「직접 촬영」 표시 — 지금 목록 기준">
            직접 촬영 {filmedCount.self} · 아님 {filmedCount.not_self} · 표시 전 {filmedCount.none}
          </span>
          <span className="nd-num text-[13px] text-nd-fg-2" title="편 = 영상 수 · 묶음 = AI 가 같은 상품으로 본 영상끼리 한 카드">
            {shownCount}편 · {groups.length}묶음
          </span>
          {resumeIdx > 0 ? (
            <>
              <Button size="sm" icon={GalleryVerticalEnd} onClick={() => setFeedStart(feedLast!.id)} title={`쇼츠처럼 보기에서 마지막으로 본 영상(${resumeIdx + 1}번째)부터 이어서 봅니다`}>
                이어 보기 · <span className="nd-num">{resumeIdx + 1}</span>번째
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setFeedStart(groups[0].items[0].id)}>
                처음부터
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" icon={GalleryVerticalEnd} disabled={!groups.length} onClick={() => setFeedStart(groups[0]?.items[0].id ?? null)}>
              쇼츠처럼 보기
            </Button>
          )}
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

      <ShortsFeedSheet
        startId={feedStart}
        groups={groups}
        onClose={() => setFeedStart(null)}
        onSeen={onSeen}
        ariaLabel="후보 쇼츠처럼 보기"
        hint="휠 · ↑↓ 넘기기 · 스페이스 재생/정지 · M 소리 · 1 · 2 촬영 표시"
        emptyTitle="넘겨 볼 후보가 없습니다"
        onKey={(k, it, e) => {
          // 1 직접 촬영 · 2 직접 촬영 아님 · 0 지우기 — 보면서 바로 표시
          if ((k !== "1" && k !== "2" && k !== "0") || e.metaKey || e.ctrlKey || e.altKey) return false;
          e.preventDefault();
          const v = k === "1" ? "self" : k === "2" ? "not_self" : null;
          if ((it.filmed?.value ?? null) !== v) actions.onFilmed(it, v);
          return true;
        }}
        renderSlide={({ item, group, active, onPick, onFocus }) => <FeedSlide i={item} group={group} active={active} a={actions} onPick={onPick} onFocus={onFocus} />}
      />

      <Dialog open={!!commentsOf} onClose={() => setCommentsOf(null)} size="lg" title="댓글" description={commentsOf?.title}>
        {commentsOf && <CommentList key={commentsOf.id} i={commentsOf} />}
      </Dialog>

      <Dialog open={!!notesItem} onClose={() => setNotesId(null)} size="lg" title="메모 · AI 분석" description={notesItem?.title}>
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
        <RadarThumb i={i} onOpen={() => onOpen(i)} className="aspect-[5/7] w-full self-start [@container(min-width:470px)]:row-span-4" />
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
        <Engagement i={i} onComments={() => a.onComments(i)} className="col-span-2 [@container(min-width:470px)]:col-span-1 [@container(min-width:470px)]:col-start-2" />
        <AiSummary i={i} className="col-span-2 [@container(min-width:470px)]:col-span-1 [@container(min-width:470px)]:col-start-2" />
      </div>
      <div className="mt-4 border-t border-nd-line pt-3">
        <ActionRow i={i} a={a} />
      </div>
    </Card>
  );
}

// ---- 쇼츠처럼 보기 (오른쪽 드로어 · 공용 feed/ShortsFeed) ----------------------------

/** 쇼츠 한 칸 — 왼쪽 세로 영상, 오른쪽(좁으면 아래) 근거 · 버튼 */
function FeedSlide({ i, group, active, a, onPick, onFocus }: { i: Item; group: Item[]; active: boolean; a: Actions; onPick: (id: string) => void; onFocus: () => void }) {
  // 댓글은 누를 때만 읽는다 (넘길 때마다 YouTube 를 부르지 않게) — 다른 영상으로 바뀌면 닫는다
  const [comments, setComments] = useState(false);
  useEffect(() => setComments(false), [i.id]);
  return (
    <FeedSlideLayout video={<FeedVideo active={active} videoId={i.videoId} thumbnail={i.thumbnail} title={i.title} url={i.url} onFocus={onFocus} />}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <BadgeRow i={i} />
            <Headline i={i} size="lg" />
            <MetaLine i={i} keywords />
          </div>
          <ScoreBox score={i.score} className="shrink-0" />
        </div>
        <Metrics i={i} />
        <Engagement i={i} onComments={() => setComments(true)} />
        {comments && (
          <section aria-label="댓글" className="rounded-nd-md border border-nd-line px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-nd-fg-2">댓글</span>
              <button type="button" onClick={() => setComments(false)} className="text-[13px] font-medium text-nd-accent hover:underline">
                닫기
              </button>
            </div>
            <CommentList i={i} />
          </section>
        )}
        <section aria-label="촬영 · 메모" className="rounded-nd-md border border-nd-line px-3 py-2.5">
          <NotePanel i={i} a={a} keys />
        </section>
        <div className="rounded-nd-md bg-nd-accent-soft/60 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <Badge tone={i.ai ? "accent" : "neutral"} size="md">
              {i.ai ? "AI 추정" : "AI 분석 전"}
            </Badge>
            <NoteBadge state={radarNoteState(i)} />
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
          <ActionRow i={i} a={a} linkLabel="YouTube에서 열기" notes={false} />
        </div>
    </FeedSlideLayout>
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
