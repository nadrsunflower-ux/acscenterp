"use client";

// ============================================================
//  시장 트렌드 — 오늘의 브리핑 · 검색어 추이 · 채널 모니터링 · 트렌드 노트
// ------------------------------------------------------------
//  매일 아침 07:30 cron-market 이 채널 숫자 · 검색어 추이 · AI 브리핑을 만든다. 화면은 읽고, 사람이 고른 것을
//  「노트에 보관」 해 트렌드 노트에 모은다(기본 나만 보기 · 팀 공개 · 프로젝트마다 따로). 노트에서 바로 대본 작성기로 넘긴다.
//  노트 보드 · 노트 창(참고 영상 재생기 · 사진 · 긴 메모)은 NotesBoard.tsx · NoteMedia.tsx.
//  숫자는 모두 남의 원본 · 네이버 상대값 · 채널 공개 통계다 — 우리 영상 성과와 섞지 않는다(내 채널만 따로).
//  2026-11 목업 개편: 머리(StudioHeader) · 「다시 만들기」 옆 AI 비용(실제 오늘 쓴 돈 · 하루 상한) ·
//  차트는 한 축 · 선 끝 이름표 · 실선/점선 · 범례 · 수치 표 · 노트는 4칸 보드(카드마다 「옮기기」 메뉴 — 모바일도).
//  「제목 키워드」 탭 = 모은 영상 제목의 낱말 순위 (TitleTrends.tsx · AI 없음). 탭은 주소의 ?tab= 로도 연다 ·
//  ?space= 를 주면(브리핑 메일의 「ERP 에서 보기」) 그 프로젝트로 바꿔 연다.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Bookmark,
  Camera,
  Check,
  ExternalLink,
  EyeOff,
  FolderOpen,
  Lightbulb,
  Newspaper,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  Type,
  Users,
  Video,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FieldAction,
  FormRow,
  IconButton,
  Input,
  NumberInput,
  PageShell,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  Tabs,
  buttonClass,
  cn,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { Num, Unknown, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, RecordTable, StudioCard, StudioHeader, StudioNotice, StudioSection, type RecordColumn } from "@/components/neander/shorts/studio";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import {
  BRIEF_KIND_LABEL,
  TREND_RANGE_LABEL,
  channelDelta,
  channelTrackedDays,
  groupTrend,
  type ChannelStatDoc,
  type GroupSeries,
  type KeywordGroup,
  type MarketBriefDoc,
  type MarketBriefItem,
  type MarketSettings,
  type NoteStatus,
  type TrendNoteDoc,
  type TrendRange,
} from "@/lib/neander/shorts/market";
import { NAVER_LABEL, USD_KRW, type NaverTrendLabel } from "@/lib/neander/shorts/radar";
import { countryLabel } from "@/lib/neander/shorts/scout";
import { Sparkline, TREND_COLORS, TrendLines } from "./TrendLines";
import { TitleTrendsTab } from "./TitleTrends";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { NotesTab } from "./NotesBoard";

type WithId<T> = T & { id: string };
type ProductTrend = {
  id: string;
  product: string;
  keywords: string[];
  label: NaverTrendLabel;
  change: number | null;
  recent: number | null;
  candidates: number;
  title: string;
  url: string;
  thumbnail: string;
  multiple: number | null;
  at: number;
};
type WatchRow = {
  id: string;
  channelId: string;
  title: string;
  country: string;
  active: boolean;
  baseline: number | null;
  scannedAt: number | null;
  hits7: number;
  topics: string[];
};
interface MarketData {
  me: string;
  admin: boolean;
  today: string;
  settings: MarketSettings;
  ready: { naver: boolean; youtube: boolean; ai: boolean };
  spentKrwToday: number;
  brief: MarketBriefDoc | null;
  briefDays: { day: string; headline: string; at: number }[];
  series: Record<string, GroupSeries>;
  productTrends: ProductTrend[];
  channels: WithId<ChannelStatDoc>[];
  watch: WatchRow[];
  notes: WithId<TrendNoteDoc>[];
}
type NoteDraft = Partial<Pick<TrendNoteDoc, "title" | "memo" | "snapshot" | "product" | "tags">> & { source: TrendNoteDoc["source"] };
type SetD = (f: (x: MarketData | null) => MarketData | null) => void;

const NAVER_TONE: Record<NaverTrendLabel, Tone> = {
  rising: "success",
  steady: "neutral",
  falling: "warning",
  low: "neutral",
};
const BRIEF_TONE: Record<MarketBriefItem["kind"], Tone> = {
  product: "accent",
  format: "neutral",
  hit: "warning",
  keyword: "info",
  channel: "neutral",
  mine: "success",
};
const NOTE_STATUS_TONE: Record<NoteStatus, Tone> = {
  inbox: "accent",
  watch: "warning",
  script: "info",
  done: "success",
};
/** 브리핑 AI 한 번 예상 — 기존 안내와 같은 범위 (모델 · 자료 양에 따라) */
const BRIEF_ESTIMATE = "10~40원";
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 2026-11-04 → 11/4 (수) */
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} (${WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : "±"}${Math.abs(v).toLocaleString("ko-KR")}`;
const deltaClass = (v: number | null) => (v === null || v === 0 ? "text-nd-fg-3" : v > 0 ? "text-nd-success-text" : "text-nd-danger-text");
const naverShort = (l: NaverTrendLabel) => NAVER_LABEL[l].replace("국내 검색 ", "");

/** 7일 · 30일 변화 — 기록이 그만큼 안 쌓였으면 「미확인」 (0 과 다르다) */
function Delta({ v, unit = "" }: { v: number | null; unit?: string }) {
  if (v === null) return <Unknown title="기록이 그만큼 쌓이지 않아 아직 모릅니다 (0 이 아닙니다)" />;
  return (
    <span className={cn("nd-num font-semibold", deltaClass(v))}>
      {signed(v)}
      {unit}
    </span>
  );
}

type Tab = "brief" | "titles" | "trends" | "channels" | "notes";
const TABS: Tab[] = ["brief", "titles", "trends", "channels", "notes"];
const TAB_DESC: Record<Tab, string> = {
  brief: "AI 가 매일 아침 레이더 · 바이럴 형식 · 네이버 검색어 · 채널 변화를 훑어 특기할 것을 고릅니다. 근거를 확인하고 마음에 드는 것은 노트에 보관하세요.",
  titles: "레이더 · 바이럴 형식이 모은 영상 제목에서 평소보다 두드러지게 늘어난 낱말을 채널 수로 셉니다. AI 없이 세어 비용이 들지 않습니다.",
  trends: "분야와 상품의 국내 검색 흐름을 같은 기준으로 견줍니다. 값은 네이버 상대값이라 절대 검색량이 아닙니다.",
  channels: "내 채널과 감시 채널의 구독자 흐름을 섞지 않고 따로 봅니다. 우리 영상 성과는 성과 비교에서 봅니다.",
  notes: "발견한 흐름을 보관하고, 준비된 아이디어는 대본 작성기로 옮기세요.",
};

/** 주소의 ?tab= — 대시보드 · 메일의 바로 가기가 탭을 연다 */
const tabFromUrl = (): Tab => {
  if (typeof window === "undefined") return "brief";
  const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
  return t && TABS.includes(t) ? t : "brief";
};

export function MarketPage() {
  const [d, setD] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(tabFromUrl);
  const [editing, setEditing] = useState<WithId<TrendNoteDoc> | "new" | null>(null);
  const toast = useToast();
  const router = useRouter();
  const { data: shortsData, space, setSpace } = useShorts();
  const setTab = useCallback(
    (k: Tab) => {
      setTabState(k);
      router.replace(k === "brief" ? "/neander/shorts/market" : `/neander/shorts/market?tab=${k}`, { scroll: false });
    },
    [router],
  );
  const load = useCallback(async () => {
    try {
      setD(await shortsGet<MarketData>("market"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "시장 트렌드를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    // 메일의 「ERP 에서 보기」 는 ?space= 로 그 프로젝트를 연다 — 바꾸면 ShortsGate 가 이 화면을 새 프로젝트로 다시 그린다
    const want = new URLSearchParams(window.location.search).get("space");
    if (want) {
      if (want !== space && shortsData?.spaces.some((x) => x.id === want && !x.archived)) return setSpace(want);
      if (want !== space) toast.error("그 프로젝트를 볼 수 없어 지금 프로젝트로 엽니다.");
      router.replace(tab === "brief" ? "/neander/shorts/market" : `/neander/shorts/market?tab=${tab}`, { scroll: false });
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // 노트에 보관 — 어느 탭에서든
  const keep = useCallback(
    async (draft: NoteDraft) => {
      try {
        const r = await shortsPost<{ note: WithId<TrendNoteDoc> }>("market", {
          action: "note.save",
          note: draft,
        });
        setD((x) => (x ? { ...x, notes: [r.note, ...x.notes] } : x));
        toast.success("트렌드 노트에 보관했습니다.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "노트에 보관하지 못했습니다.");
      }
    },
    [toast],
  );
  const kept = useMemo(() => new Set((d?.notes ?? []).filter((x) => x.owner === d?.me).map((x) => `${x.source.kind}:${x.source.id}`)), [d?.notes, d?.me]);
  const isKept = (kind: string, id: string | null) => !!id && kept.has(`${kind}:${id}`);

  if (!d) {
    return (
      <PageShell>
        <StudioHeader kicker="AI STUDIO 워크스페이스" kickerIcon={FolderOpen} title="시장 트렌드" description={TAB_DESC.brief} />
        {error ? (
          <ErrorState
            title="시장 트렌드를 불러오지 못했습니다"
            description={error}
            action={
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                다시 시도
              </Button>
            }
          />
        ) : (
          <div className="space-y-4" aria-busy="true">
            <p className="sr-only" role="status">
              시장 트렌드를 불러오는 중…
            </p>
            <Skeleton className="h-11 w-full max-w-[520px]" />
            <Skeleton className="h-48 rounded-nd-lg" />
            <Skeleton className="h-72 rounded-nd-lg" />
          </div>
        )}
      </PageShell>
    );
  }

  // 검토 전 수 · 「보관됨」 은 내 노트만 (팀원이 공개한 노트는 섞지 않는다)
  const inbox = d.notes.filter((x) => x.owner === d.me && x.status === "inbox").length;
  const missing = [!d.ready.naver && "네이버 데이터랩 키", !d.ready.youtube && "회사 YouTube 키", !d.ready.ai && "OpenRouter 키"].filter(Boolean) as string[];
  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="시장 트렌드"
        description={TAB_DESC[tab]}
        actions={
          tab === "notes" ? (
            <Button icon={Plus} onClick={() => setEditing("new")}>
              새 노트
            </Button>
          ) : (
            <Button variant="secondary" icon={Bookmark} onClick={() => setTab("notes")}>
              트렌드 노트{inbox ? ` · 검토 전 ${inbox}` : ""}
            </Button>
          )
        }
      />
      {missing.length > 0 && (
        <StudioNotice tone="warning" title="일부 자료를 건너뜁니다" className="mb-4">
          {missing.join(" · ")} 가 없어 그 자료는 받지 않습니다. 배포 설정에 키를 넣으면 다음 아침부터 채워집니다.
        </StudioNotice>
      )}
      <Tabs
        className="mb-6"
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        ariaLabel="시장 트렌드"
        items={[
          { key: "brief", label: "오늘의 브리핑", icon: Newspaper },
          { key: "titles", label: "제목 키워드", icon: Type },
          { key: "trends", label: "검색어 추이", icon: TrendingUp },
          {
            key: "channels",
            label: "채널 모니터링",
            icon: Users,
            badge: d.channels.length || undefined,
          },
          {
            key: "notes",
            label: "트렌드 노트",
            icon: Bookmark,
            badge: inbox || undefined,
            badgeLabel: "검토 전 노트",
          },
        ]}
      />
      {tab === "brief" && <BriefTab d={d} setD={setD} keep={keep} isKept={isKept} onGo={setTab} />}
      {tab === "titles" && <TitleTrendsTab />}
      {tab === "trends" && <TrendsTab d={d} setD={setD} keep={keep} isKept={isKept} />}
      {tab === "channels" && <ChannelsTab d={d} reload={load} keep={keep} isKept={isKept} />}
      {tab === "notes" && <NotesTab notes={d.notes} me={d.me} setNotes={(f) => setD((x) => (x ? { ...x, notes: f(x.notes) } : x))} editing={editing} setEditing={setEditing} />}
    </PageShell>
  );
}

type KeepProps = {
  keep: (n: NoteDraft) => Promise<void>;
  isKept: (kind: string, id: string | null) => boolean;
};

function KeepButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return done ? (
    <Badge tone="success" size="lg">
      <Check size={14} aria-hidden /> 노트에 있음
    </Badge>
  ) : (
    <Button size="sm" variant="ghost" icon={Bookmark} onClick={onClick}>
      노트에 보관
    </Button>
  );
}

// ---- 오늘의 브리핑 ----------------------------------------------------------------

function BriefTab({ d, setD, keep, isKept, onGo }: { d: MarketData; setD: SetD; onGo: (t: Tab) => void } & KeepProps) {
  const { busy, run } = useAction();
  const [day, setDay] = useState<string | null>(null);
  const [other, setOther] = useState<MarketBriefDoc | null>(null);
  const b = day && other?.day === day ? other : d.brief;
  const cap = d.settings.briefBudgetKrw;
  const reached = cap > 0 && d.spentKrwToday >= cap;
  const pick = (v: string) => {
    if (v === d.brief?.day) return setDay(null);
    setDay(v);
    void shortsGet<{ brief: MarketBriefDoc | null }>(`market?brief=${v}`).then((r) => setOther(r.brief));
  };
  const make = () =>
    void run(
      "brief",
      async () => {
        const r = await shortsPost<{ brief: MarketBriefDoc }>("market", {
          action: "brief.run",
        });
        setD((x) =>
          x
            ? {
                ...x,
                brief: r.brief,
                briefDays: [
                  {
                    day: r.brief.day,
                    headline: r.brief.headline,
                    at: r.brief.at,
                  },
                  ...x.briefDays.filter((y) => y.day !== r.brief.day),
                ],
                spentKrwToday: x.spentKrwToday + Math.round(r.brief.costUsd * USD_KRW),
              }
            : x,
        );
        setDay(null);
      },
      "브리핑을 새로 만들었습니다.",
    );
  const cost = <AiCostNote estimate={BRIEF_ESTIMATE} used={d.spentKrwToday} cap={cap} label="브리핑 AI" />;
  const remake = (label: string, variant: "primary" | "secondary") => (
    <Button variant={variant} icon={variant === "primary" ? Sparkles : RefreshCw} loading={busy === "brief"} disabled={!d.ready.ai || reached} onClick={make} title={`오늘 브리핑을 다시 만듭니다 (AI 한 번 약 ${BRIEF_ESTIMATE} · 하루 상한 안)`}>
      {label}
    </Button>
  );
  if (!b) {
    return (
      <EmptyState
        icon={Newspaper}
        title="아직 브리핑이 없습니다"
        description={`매일 아침 07:30 에 자동으로 만들어집니다. 지금 만들 수도 있습니다 (AI 한 번 약 ${BRIEF_ESTIMATE} · 하루 상한 ${won(cap)}).`}
        action={
          <div className="flex flex-col items-center gap-2">
            {remake("지금 브리핑 만들기", "primary")}
            {cost}
          </div>
        }
      />
    );
  }
  const go = (it: MarketBriefItem) => {
    const r = it.ref;
    const cls = "inline-flex items-center gap-1.5 text-[14px] font-medium text-nd-accent-strong hover:underline";
    if (!r) return null;
    if (r.kind === "group")
      return (
        <button type="button" className={cls} onClick={() => onGo("trends")}>
          <TrendingUp size={15} aria-hidden /> 검색어 추이 보기
        </button>
      );
    if (r.kind === "format")
      return (
        <Link className={cls} href="/neander/shorts/scout">
          <ArrowUpRight size={15} aria-hidden /> 형식 카드 보기
        </Link>
      );
    if (r.url)
      return (
        <a className={cls} href={r.url} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden /> 원본 열기
        </a>
      );
    return null;
  };
  const thisCost = Math.round(b.costUsd * USD_KRW);
  return (
    <div className="space-y-6">
      {/* 날짜 · 만든 방식 · 다시 만들기 (+ AI 비용) */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <FormRow className="grid-cols-1 sm:grid-cols-[220px_auto]">
          <Field label="브리핑 날짜">
            <Select value={b.day} onChange={(e) => pick(e.target.value)}>
              {d.briefDays.map((x) => (
                <option key={x.day} value={x.day}>
                  {dayLabel(x.day)}
                  {x.day === d.today ? " · 오늘" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <FieldAction center size="md">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-3">
              <Badge tone={b.by === "company" ? "success" : "neutral"} size="lg">
                {b.by === "company" ? "매일 07:30 자동 생성" : "직접 만듦"}
              </Badge>
              <span>
                생성 {fmtWhen(b.at)} · 해설 모델 {b.model.split("/").pop()} · 이 브리핑 약 {won(thisCost)} ({fmtUsd(b.costUsd)})
              </span>
            </span>
          </FieldAction>
        </FormRow>
        <div className="flex flex-col items-start gap-1.5 lg:items-end lg:pt-6">
          {remake(d.brief?.day === d.today ? "다시 만들기" : "오늘 브리핑 만들기", "secondary")}
          {cost}
        </div>
      </div>
      {b.day !== d.today &&
        (b === d.brief ? (
          <StudioNotice tone="info" title={`오늘(${dayLabel(d.today)}) 브리핑은 아직 없습니다`}>
            가장 최근인 {dayLabel(b.day)} 브리핑을 보여 줍니다. 매일 아침 07:30 에 저절로 만들어지고, 「오늘 브리핑 만들기」 로 지금 만들 수도 있습니다.
          </StudioNotice>
        ) : (
          <StudioNotice
            tone="neutral"
            title={`지난 브리핑(${dayLabel(b.day)})을 보고 있습니다`}
            action={
              <Button size="sm" variant="secondary" onClick={() => setDay(null)}>
                최근 브리핑으로
              </Button>
            }
          >
            「{d.brief?.day === d.today ? "다시 만들기" : "오늘 브리핑 만들기"}」 는 오늘({dayLabel(d.today)}) 브리핑을 새로 만듭니다.
          </StudioNotice>
        ))}

      <StudioCard>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" size="lg">
            <Sparkles size={14} aria-hidden /> {b.day === d.today ? "오늘의 시장 브리핑" : `${dayLabel(b.day)} 브리핑`}
          </Badge>
          <Badge tone="neutral" size="lg">
            근거 {b.items.length}개
          </Badge>
        </div>
        <h2 className="mt-3 max-w-[40ch] text-[26px] font-bold leading-snug tracking-[-0.01em] text-nd-fg [overflow-wrap:anywhere]">{b.headline}</h2>
        {b.summary.length > 0 && (
          <ol className="mt-4 divide-y divide-nd-line rounded-nd-md border border-nd-line bg-nd-sunken/60">
            {b.summary.map((x, i) => (
              <li key={i} className="flex gap-3 px-4 py-3 text-nd-body text-nd-fg">
                <span className="nd-num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-nd-accent-soft text-[13px] font-semibold text-nd-accent-strong">{i + 1}</span>
                <span className="[overflow-wrap:anywhere]">{x}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-nd-fg-3">
          넣은 자료 · 레이더 {b.inputs.radar ?? 0} · 뜨는 상품 {b.inputs.productTrends ?? 0} · 터진 영상 {b.inputs.hits ?? 0} · 형식 {b.inputs.formats ?? 0} · 검색어 묶음 {b.inputs.groups ?? 0} · 채널 {b.inputs.channels ?? 0} — AI 해설은 자료
          숫자로만 썼고, 사실 확인은 사람이 합니다.
        </p>
        {b.notes.length > 0 && <p className="mt-1 text-[13px] font-medium text-nd-warning-text">{b.notes.join(" · ")}</p>}
      </StudioCard>

      <StudioSection title="근거를 보고, 다음 행동으로" description="원본을 확인하고 기획할 항목은 노트에 보관하세요. 보관한 숫자는 그때 값 그대로 남습니다.">
        {b.items.length === 0 ? (
          <EmptyState compact icon={Lightbulb} title="이 브리핑에는 항목이 없습니다" description="자료가 적은 날은 항목 없이 요약만 남습니다." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {b.items.map((it, i) => {
              const sid = `${b.day}:${i}`;
              return (
                <article key={i} className="nd-surface flex min-w-0 flex-col rounded-nd-lg px-5 py-4 sm:px-6 sm:py-5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge tone={BRIEF_TONE[it.kind]} size="lg">
                      {BRIEF_KIND_LABEL[it.kind]}
                    </Badge>
                    {it.numbers && <span className="nd-num min-w-0 text-[13px] font-semibold text-nd-fg-2 [overflow-wrap:anywhere]">{it.numbers}</span>}
                  </div>
                  <h3 className="mt-3 text-[17px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{it.title}</h3>
                  {it.ref?.label && (
                    <p className="mt-0.5 truncate text-[13px] text-nd-fg-3" title={it.ref.label}>
                      {it.ref.label}
                    </p>
                  )}
                  <dl className="mt-3 space-y-1.5 text-nd-body leading-relaxed">
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-semibold text-nd-fg">왜</dt>
                      <dd className="min-w-0 text-nd-fg-2 [overflow-wrap:anywhere]">{it.why}</dd>
                    </div>
                    {it.action && (
                      <div className="flex gap-2">
                        <dt className="flex shrink-0 items-center gap-1 font-semibold text-nd-fg">
                          <Lightbulb size={14} aria-hidden className="text-nd-accent" />해 볼 것
                        </dt>
                        <dd className="min-w-0 text-nd-fg-2 [overflow-wrap:anywhere]">{it.action}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="min-h-4 flex-1" aria-hidden />
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-nd-line pt-3">
                    {go(it) ?? <span />}
                    <KeepButton
                      done={isKept("brief", sid)}
                      onClick={() =>
                        void keep({
                          title: it.title,
                          memo: [it.why, it.action && `해 볼 것: ${it.action}`].filter(Boolean).join("\n"),
                          snapshot: it.numbers,
                          product: it.kind === "product" ? (it.ref?.label ?? it.title) : "",
                          source: {
                            kind: "brief",
                            id: sid,
                            url: it.ref?.url ?? null,
                            label: `${b.day} 브리핑 · ${BRIEF_KIND_LABEL[it.kind]}`,
                          },
                        })
                      }
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </StudioSection>

      <StudioCard>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-nd-fg">
              오늘 브리핑 AI 비용 <span className={cn("nd-num", reached && "text-nd-danger-text")}>{won(d.spentKrwToday)}</span> / 하루 상한 <span className="nd-num">{won(cap)}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-nd-fg-3">「다시 만들기」 도 하루 상한 안 · 남은 한도 {won(Math.max(0, cap - d.spentKrwToday))} · 상한은 검색어 추이 › 자동 실행 설정에서 관리자가 바꿉니다</p>
          </div>
          {reached && (
            <Badge tone="danger" size="lg">
              상한 도달 · 내일 다시
            </Badge>
          )}
        </div>
      </StudioCard>
    </div>
  );
}

// ---- 검색어 추이 -------------------------------------------------------------------

/** 묶음 색 — 설정 순서로 정하고, 고른 묶음끼리 겹치면 다음 빈 색 (고른 것을 빼도 남은 것의 색은 그대로) */
function colorFor(groupIds: string[], selected: string[]): Record<string, string> {
  const used = new Set<number>();
  const out: Record<string, string> = {};
  for (const id of groupIds.filter((g) => selected.includes(g))) {
    let slot = groupIds.indexOf(id) % TREND_COLORS.length;
    while (used.has(slot) && used.size < TREND_COLORS.length) slot = (slot + 1) % TREND_COLORS.length;
    used.add(slot);
    out[id] = TREND_COLORS[slot];
  }
  return out;
}

type CompareRes = {
  series: { name: string; points: { period: string; ratio: number }[] }[];
  mode: string;
};

function TrendsTab({ d, setD, keep, isKept }: { d: MarketData; setD: SetD } & KeepProps) {
  const toast = useToast();
  const { busy, run } = useAction();
  const groupIds = d.settings.groups.map((g) => g.id);
  const [sel, setSel] = useState<string[]>(groupIds.slice(0, 5));
  const [range, setRange] = useState<TrendRange>("1y");
  const [unit, setUnit] = useState<"week" | "month">("week");
  const [mode, setMode] = useState<"groups" | "segments">("groups");
  const [res, setRes] = useState<CompareRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const pickIds = mode === "segments" ? sel.slice(0, 1) : sel.slice(0, 5);
  const key = `${pickIds.join(",")}|${range}|${unit}|${mode}|${retry}`;
  useEffect(() => {
    if (!pickIds.length || !d.ready.naver) return;
    let live = true;
    setLoading(true);
    setErr(null);
    const q = new URLSearchParams({
      compare: "1",
      groups: pickIds.join(","),
      range,
      unit,
      mode,
    });
    shortsGet<CompareRes>(`market?${q}`)
      .then((r) => live && setRes(r))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "검색어 추이를 받지 못했습니다."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, d.ready.naver]);
  const colors = colorFor(groupIds, pickIds);
  const lines =
    res?.mode === "segments"
      ? res.series.map((s, i) => ({
          key: `seg${i}`,
          name: s.name,
          color: TREND_COLORS[i % TREND_COLORS.length],
          points: s.points,
        }))
      : (res?.series ?? []).map((s, i) => ({
          key: pickIds[i] ?? `g${i}`,
          name: s.name,
          color: colors[pickIds[i]] ?? TREND_COLORS[i % 5],
          points: s.points,
        }));
  // 한 묶음이 압도하면(나머지가 모두 10 아래) 나머지 선은 바닥에 붙는다 — 빼고 보기를 권한다
  const dominant = (() => {
    if (res?.mode !== "groups" || lines.length < 2) return null;
    const peaks = lines
      .map((l) => ({
        key: l.key,
        name: l.name,
        max: Math.max(0, ...l.points.map((p) => p.ratio)),
      }))
      .sort((a, b) => b.max - a.max);
    const second = peaks[1].max;
    return peaks[0].max >= 90 && second < 10
      ? {
          key: peaks[0].key,
          name: peaks[0].name,
          others: second.toLocaleString("ko-KR", { maximumFractionDigits: 1 }),
        }
      : null;
  })();
  const toggle = (id: string) => {
    if (mode === "segments") return setSel([id, ...sel.filter((x) => x !== id)]);
    if (sel.includes(id)) return setSel(sel.filter((x) => x !== id));
    if (sel.length >= 5) return toast.error("한 번에 5묶음까지 견줄 수 있습니다 (네이버 한 요청 한도).");
    setSel([...sel, id]);
  };
  const refresh = () =>
    void run(
      "series",
      async () => {
        const r = await shortsPost<{
          series: Record<string, GroupSeries>;
          notes: string[];
        }>("market", { action: "series.refresh" });
        setD((x) => (x ? { ...x, series: r.series } : x));
        if (r.notes.length) toast.error(r.notes.join(" · "));
      },
      "묶음별 추이를 새로 받았습니다.",
    );
  const basis = unit === "week" ? "최근 2주 ÷ 그 전 6주" : "최근 2달 ÷ 그 전 6달";
  const rangeUnit = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <SegmentedControl
        ariaLabel="기간"
        value={range}
        onChange={(v) => setRange(v)}
        options={(Object.keys(TREND_RANGE_LABEL) as TrendRange[]).map((r) => ({
          value: r,
          label: TREND_RANGE_LABEL[r],
        }))}
      />
      <SegmentedControl
        ariaLabel="단위"
        value={unit}
        onChange={(v) => setUnit(v)}
        options={[
          { value: "week", label: "주" },
          { value: "month", label: "달" },
        ]}
      />
    </div>
  );
  const segRows =
    res?.mode === "segments"
      ? lines.map((l) => ({
          l,
          t: groupTrend(l.points),
          last: l.points.at(-1)?.ratio ?? null,
        }))
      : [];

  return (
    <div className="space-y-8">
      <StudioCard
        title={mode === "groups" ? "분야 비교" : "나이 · 성별로 나눠 보기"}
        description={mode === "groups" ? "고른 묶음을 한 요청에 — 묶음끼리 크기를 견줄 수 있습니다 (5묶음까지)" : "고른 묶음 하나를 집단마다 따로 — 집단끼리 크기는 못 견주고 오르내림만 견줍니다"}
        action={
          <SegmentedControl
            ariaLabel="보기"
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: "groups", label: "분야 비교" },
              { value: "segments", label: "나이 · 성별" },
            ]}
          />
        }
      >
        {mode === "groups" ? (
          <div className="flex flex-col gap-3 border-b border-nd-line pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="견줄 검색어 묶음">
              {d.settings.groups.map((g) => {
                const on = pickIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(g.id)}
                    title={g.keywords.join(", ")}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors",
                      on ? "border-nd-accent/40 bg-nd-accent-soft text-nd-accent-strong" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                    )}
                  >
                    {on ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden className="text-nd-fg-3" />}
                    {on && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[g.id] }} aria-hidden />}
                    {g.name}
                  </button>
                );
              })}
            </div>
            {rangeUnit}
          </div>
        ) : (
          <FormRow className="grid-cols-1 border-b border-nd-line pb-4 sm:grid-cols-[minmax(0,360px)_auto]">
            <Field label="검색어 묶음" hint="집단마다 따로 부르므로 한 묶음씩 봅니다">
              <Select value={pickIds[0] ?? ""} onChange={(e) => toggle(e.target.value)}>
                {d.settings.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <FieldAction size="md" center className="sm:justify-self-end">
              {rangeUnit}
            </FieldAction>
          </FormRow>
        )}
        <div className="pt-4">
          {!d.ready.naver ? (
            <StudioNotice tone="warning" title="네이버 데이터랩 키가 없습니다">
              검색어 추이를 받을 수 없습니다. 네이버 클라우드 콘솔(API HUB)에서 받은 키를 배포 설정에 넣어 주세요.
            </StudioNotice>
          ) : !pickIds.length ? (
            <EmptyState compact icon={TrendingUp} title="견줄 묶음을 골라 주세요" description="위에서 묶음을 누르면 한 축에 함께 그립니다." />
          ) : err ? (
            <StudioNotice
              tone="warning"
              title="검색어 추이를 받지 못했습니다"
              action={
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setRetry((n) => n + 1)}>
                  다시 시도
                </Button>
              }
            >
              {err}
            </StudioNotice>
          ) : loading && !res ? (
            <Skeleton className="h-[340px] rounded-nd-md" />
          ) : (
            <div className={cn("space-y-4", loading && "opacity-60")} aria-busy={loading || undefined}>
              <TrendLines
                lines={lines}
                unit={unit}
                note={res?.mode === "segments" ? "집단마다 그 안에서 가장 높은 구간 = 100 · 집단끼리 크기는 견주지 않습니다" : "검색 지수 · 공통 축 (고른 묶음 중 가장 높은 구간 = 100)"}
                title={`${pickIds.map((id) => d.settings.groups.find((g) => g.id === id)?.name).join(" · ")} 검색어 추이`}
              />
              {res?.mode === "groups" && dominant && (
                <StudioNotice
                  tone="info"
                  title={`「${dominant.name}」 이 다른 묶음보다 훨씬 많이 검색됩니다`}
                  action={
                    <Button size="sm" variant="secondary" icon={EyeOff} onClick={() => toggle(dominant.key)}>
                      「{dominant.name}」 빼고 보기
                    </Button>
                  }
                >
                  나머지 선이 바닥에 붙어 보입니다 (다른 묶음은 가장 높아도 {dominant.others}). 빼면 나머지끼리 다시 100 기준으로 견줍니다.
                </StudioNotice>
              )}
            </div>
          )}
        </div>
        {mode === "segments" && res?.mode === "segments" && segRows.length > 0 && (
          <div className="-mx-5 mt-5 sm:-mx-6">
            <RecordTable
              rows={segRows}
              rowKey={(r) => r.l.key}
              ariaLabel="집단별 최근 흐름"
              columns={[
                {
                  key: "name",
                  header: "집단",
                  mobile: "title",
                  cell: (r) => (
                    <span className="inline-flex items-center gap-2 font-medium">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.l.color }} aria-hidden />
                      {r.l.name}
                    </span>
                  ),
                },
                {
                  key: "last",
                  header: "최근 값",
                  align: "right",
                  cell: (r) => <Num value={r.last} digits={1} />,
                },
                {
                  key: "change",
                  header: `변화 (${basis})`,
                  mobileLabel: "변화",
                  align: "right",
                  cell: (r) => (r.t.change === null ? <Unknown /> : <span className="nd-num">×{r.t.change}</span>),
                },
                {
                  key: "label",
                  header: "흐름",
                  cell: (r) => (
                    <Badge tone={NAVER_TONE[r.t.label]} size="lg">
                      {naverShort(r.t.label)}
                    </Badge>
                  ),
                },
                {
                  key: "basis",
                  header: "비교 기준",
                  mobile: "hide",
                  cell: () => <span className="text-[13px] text-nd-fg-3">그 집단 안의 상대값</span>,
                },
              ]}
            />
            <p className="mt-3 px-5 text-[13px] text-nd-fg-3 sm:px-6">
              집단마다 따로 부른 값이라 각 선은 그 집단 안에서 가장 높은 구간 = 100 입니다. 「20대 여성이 더 많이 찾는다」 는 이 그래프로 말할 수 없고, 「20대 여성에서 최근 더 오른다」 만 볼 수 있습니다.
            </p>
          </div>
        )}
      </StudioCard>

      <StudioSection
        title="묶음별 최근 추세"
        icon={TrendingUp}
        description="고르지 않은 묶음도 최근 흐름을 봅니다 · 최근 2주 ÷ 그 전 6주 · 매일 아침 새로 받음 (묶음마다 혼자 부른 1년 주간)"
        action={
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "series"} disabled={!d.ready.naver} onClick={refresh} title="네이버에서 묶음별 1년 추이를 지금 받습니다 (매일 아침 자동)">
            지금 받기
          </Button>
        }
      >
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {d.settings.groups.map((g) => {
            const s = d.series[g.id];
            const t = s ? groupTrend(s.points) : null;
            return (
              <div key={g.id} className="nd-surface min-w-0 rounded-nd-lg px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-nd-fg">{g.name}</p>
                    <p className="truncate text-[13px] text-nd-fg-3" title={g.keywords.join(", ")}>
                      {g.keywords.join(" · ")}
                    </p>
                  </div>
                  {t && (
                    <Badge tone={NAVER_TONE[t.label]} size="lg">
                      {naverShort(t.label)}
                    </Badge>
                  )}
                </div>
                <div className="mt-3">
                  {s ? <Sparkline values={s.points.slice(-26).map((p) => p.ratio)} width={220} height={36} className="max-w-full" /> : <span className="text-[13px] text-nd-fg-3">아직 안 받음 — 「지금 받기」 또는 내일 아침</span>}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-nd-line pt-2">
                  <span className="text-[13px] text-nd-fg-3">
                    최근 2주 ÷ 그 전 6주 <b className="nd-num font-semibold text-nd-fg">{t?.change !== null && t?.change !== undefined ? `×${t.change}` : "미확인"}</b>
                  </span>
                  <KeepButton
                    done={isKept("keyword", g.id)}
                    onClick={() =>
                      void keep({
                        title: `검색어 「${g.name}」 ${t ? NAVER_LABEL[t.label] : ""}`.trim(),
                        snapshot: t ? `최근 2주 ÷ 그 전 6주 ${t.change ?? "—"} · ${d.today}` : "",
                        memo: `검색어: ${g.keywords.join(", ")}`,
                        source: {
                          kind: "keyword",
                          id: g.id,
                          url: null,
                          label: `검색어 묶음 · ${g.name}`,
                        },
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </StudioSection>

      <ProductTrends d={d} keep={keep} isKept={isKept} />
      <GroupSettings d={d} setD={setD} />
    </div>
  );
}

function ProductTrends({ d, keep, isKept }: { d: MarketData } & KeepProps) {
  const [all, setAll] = useState(false);
  const list = all ? d.productTrends : d.productTrends.slice(0, 15);
  const columns: RecordColumn<ProductTrend>[] = [
    {
      key: "product",
      header: "상품 · 검색어",
      mobile: "title",
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-10 w-[56px] shrink-0 rounded-[6px] object-cover" referrerPolicy="no-referrer" loading="lazy" /> : null}
          <span className="min-w-0">
            <span className="block truncate font-semibold" title={p.product}>
              {p.product}
            </span>
            <span className="block truncate text-[13px] font-normal text-nd-fg-3" title={p.keywords.join(", ")}>
              검색어 {p.keywords.join(" · ")}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "label",
      header: "국내 검색",
      className: "w-[120px]",
      cell: (p) => (
        <Badge tone={NAVER_TONE[p.label]} size="lg">
          {naverShort(p.label)}
        </Badge>
      ),
    },
    {
      key: "change",
      header: "변화",
      align: "right",
      className: "w-[100px]",
      cell: (p) => (p.change === null ? <Unknown /> : `×${p.change}`),
    },
    {
      key: "candidates",
      header: "후보 영상",
      align: "right",
      className: "w-[100px]",
      cell: (p) => `${p.candidates.toLocaleString("ko-KR")}편`,
    },
    {
      key: "multiple",
      header: "평소 대비",
      align: "right",
      className: "w-[100px]",
      cell: (p) => (p.multiple === null ? <Unknown /> : `${p.multiple}배`),
    },
    {
      key: "keep",
      header: <span className="sr-only">노트</span>,
      mobileLabel: "노트",
      align: "right",
      className: "w-[140px]",
      cell: (p) => (
        <KeepButton
          done={isKept("radar", p.id)}
          onClick={() =>
            void keep({
              title: p.product,
              product: p.product,
              snapshot: `국내 검색 ${naverShort(p.label)}${p.change !== null ? ` ×${p.change}` : ""} · 후보 ${p.candidates}편 · 평소의 ${p.multiple ?? "?"}배 · ${d.today}`,
              memo: `대표 영상: ${p.title}`,
              source: {
                kind: "radar",
                id: p.id,
                url: p.url,
                label: `레이더 · ${p.product}`,
              },
            })
          }
        />
      ),
    },
  ];
  return (
    <StudioCard
      flush
      title="레이더 상품의 국내 검색 추이"
      description="AI 레이더가 찾은 상품마다 네이버 검색 · 변화 큰 순 (같은 상품은 한 줄) · 변화 = 최근 2주 평균 ÷ 그 전 6주 평균 · 평소 대비 = 대표 영상의 채널 평소 대비"
      bodyClassName="max-md:px-3 max-md:pb-3"
    >
      {!d.productTrends.length ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyState compact icon={TrendingUp} title="아직 국내 검색 추이가 붙은 레이더 상품이 없습니다" description="소재 발굴의 AI 레이더가 매일 아침 채웁니다." />
        </div>
      ) : (
        <>
          <RecordTable rows={list} columns={columns} rowKey={(p) => p.id} ariaLabel="레이더 상품의 국내 검색 추이" />
          {d.productTrends.length > 15 && (
            <div className="border-t border-nd-line py-2 text-center">
              <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
                {all ? "앞의 15개만" : `나머지 ${d.productTrends.length - 15}개 더 보기`}
              </Button>
            </div>
          )}
        </>
      )}
    </StudioCard>
  );
}

function GroupSettings({ d, setD }: { d: MarketData; setD: SetD }) {
  const { busy, run } = useAction();
  const [rows, setRows] = useState<{ id: string; name: string; keywords: string }[]>(
    d.settings.groups.map((g) => ({
      id: g.id,
      name: g.name,
      keywords: g.keywords.join(", "),
    })),
  );
  const [enabled, setEnabled] = useState(d.settings.enabled);
  const [budget, setBudget] = useState(String(d.settings.briefBudgetKrw));
  const [open, setOpen] = useState(false);
  const save = () =>
    void run(
      "save",
      async () => {
        const groups: KeywordGroup[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          keywords: r.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        }));
        const r = await shortsPost<{ settings: MarketSettings }>("market", {
          action: "settings.save",
          settings: { groups, enabled, briefBudgetKrw: Number(budget) || 0 },
        });
        setD((x) => (x ? { ...x, settings: r.settings } : x));
        setBudget(String(r.settings.briefBudgetKrw));
      },
      "설정을 저장했습니다 — 묶음 추이는 내일 아침부터 받습니다 (지금 받으려면 「지금 받기」).",
    );
  return (
    <StudioCard
      title="검색어 묶음 · 자동 실행"
      description="묶음 변경은 다음 수집부터 반영됩니다 · 설정은 AI STUDIO 관리자가 바꿉니다"
      action={
        <Button size="sm" variant={open ? "ghost" : "secondary"} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "닫기" : d.admin ? "고치기" : "설정 보기"}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-nd-fg-2">
        <Badge tone={d.settings.enabled ? "success" : "neutral"} size="lg">
          자동 실행 {d.settings.enabled ? "켜짐" : "꺼짐"}
        </Badge>
        <span>매일 아침 07:30 · 묶음 {d.settings.groups.length}개</span>
        <span aria-hidden className="text-nd-fg-4">
          |
        </span>
        <AiCostNote used={d.spentKrwToday} cap={d.settings.briefBudgetKrw} label="브리핑 AI" />
      </div>
      {open && (
        <div className="mt-4 space-y-4 border-t border-nd-line pt-4">
          {!d.admin && (
            <StudioNotice tone="neutral" title="읽기만 할 수 있습니다">
              설정은 AI STUDIO 관리자만 바꿉니다.
            </StudioNotice>
          )}
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="매일 아침 자동 실행 (07:30)" hint="묶음 추이 · 채널 숫자 · 브리핑을 차례로">
              <div className="flex h-ctl-md items-center">
                <Switch checked={enabled} disabled={!d.admin} onChange={setEnabled} label={enabled ? "켜짐" : "꺼짐"} />
              </div>
            </Field>
            <Field label="브리핑 AI 하루 상한 (원)" hint={`0 ~ 2,000 · 「다시 만들기」 포함 · 오늘 사용 ${won(d.spentKrwToday)}`}>
              <NumberInput value={budget} disabled={!d.admin} onValueChange={setBudget} aria-label="브리핑 AI 하루 상한" />
            </Field>
          </FormRow>
          <div>
            <p className="mb-2 text-[13px] text-nd-fg-3">묶음마다 검색어 20개까지 — 네이버는 묶음 안 검색어를 합쳐 셉니다. 동의어를 한 묶음에 넣으세요.</p>
            <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_36px] items-center gap-x-2 gap-y-2">
              <span className="text-[13px] font-medium text-nd-fg-2">이름</span>
              <span className="text-[13px] font-medium text-nd-fg-2">검색어 (쉼표로 · 20개까지)</span>
              <span />
              {rows.map((r, i) => (
                <div key={i} className="contents">
                  <Input value={r.name} disabled={!d.admin} maxLength={30} aria-label={`${i + 1}번째 묶음 이름`} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  <Input value={r.keywords} disabled={!d.admin} aria-label={`${i + 1}번째 묶음 검색어`} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, keywords: e.target.value } : x)))} />
                  <IconButton icon={Trash2} label={`${r.name || `${i + 1}번째`} 묶음 빼기`} disabled={!d.admin} onClick={() => setRows(rows.filter((_, k) => k !== i))} />
                </div>
              ))}
            </div>
          </div>
          {d.admin && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                disabled={rows.length >= 12}
                onClick={() =>
                  setRows([
                    ...rows,
                    {
                      id: `g${Date.now().toString(36)}`,
                      name: "",
                      keywords: "",
                    },
                  ])
                }
              >
                묶음 더하기
              </Button>
              <Button size="sm" loading={busy === "save"} onClick={save}>
                저장
              </Button>
            </div>
          )}
        </div>
      )}
    </StudioCard>
  );
}

// ---- 채널 모니터링 --------------------------------------------------------------------

type WatchView = {
  w: WatchRow;
  s: WithId<ChannelStatDoc> | null;
  subs7: number | null;
  subs30: number | null;
};

function ChannelsTab({ d, reload, keep, isKept }: { d: MarketData; reload: () => Promise<void> } & KeepProps) {
  const toast = useToast();
  const { busy, run } = useAction();
  const mine = d.channels.filter((c) => c.mine);
  const statsByWatch = new Map(d.channels.filter((c) => c.watchId).map((c) => [c.watchId!, c]));
  const rows: WatchView[] = d.watch
    .filter((w) => w.active)
    .map((w) => {
      const s = statsByWatch.get(w.id) ?? d.channels.find((c) => c.platform === "youtube" && c.externalId === w.channelId) ?? null;
      return {
        w,
        s,
        subs7: s ? channelDelta(s.history, 7, "subs") : null,
        subs30: s ? channelDelta(s.history, 30, "subs") : null,
      };
    })
    .sort((a, b) => (b.subs7 ?? -Infinity) - (a.subs7 ?? -Infinity) || b.w.hits7 - a.w.hits7);
  const days = Math.max(0, ...d.channels.map((c) => channelTrackedDays(c.history)));
  const lastAt = Math.max(0, ...d.channels.map((c) => c.updatedAt || 0));
  const snap = () =>
    void run("snap", async () => {
      const r = await shortsPost<{
        youtube: number;
        instagram: number;
        notes: string[];
      }>("market", { action: "channels.snapshot" });
      await reload();
      toast.success(`오늘 숫자를 받았습니다 — 유튜브 ${r.youtube}곳 · 인스타 ${r.instagram}곳`);
      if (r.notes.length) toast.error(r.notes.join(" · "));
    });
  const columns: RecordColumn<WatchView>[] = [
    {
      key: "channel",
      header: "채널 · 나라",
      mobile: "title",
      cell: ({ w }) => (
        <span className="block min-w-0">
          <a href={`https://www.youtube.com/channel/${w.channelId}`} target="_blank" rel="noreferrer" className="block truncate font-semibold hover:underline" title={w.title}>
            {w.title}
          </a>
          <span className="block truncate text-[13px] font-normal text-nd-fg-3">
            {countryLabel(w.country)}
            {w.topics.length > 0 ? ` · ${w.topics.join(" · ")}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "subs",
      header: "구독자",
      align: "right",
      cell: ({ s }) => (s ? <Num value={s.history.at(-1)?.subs} /> : <span className="text-nd-fg-3">기록 전</span>),
    },
    {
      key: "delta",
      header: "7일 · 30일 변화",
      align: "right",
      cell: ({ subs7, subs30 }) =>
        subs7 === null && subs30 === null ? (
          <Unknown title="기록이 7일 넘게 쌓이지 않아 아직 모릅니다 (0 이 아닙니다)" />
        ) : (
          <span className="inline-flex flex-col items-end leading-snug">
            <span>
              <span className="mr-1 text-[13px] text-nd-fg-3">7일</span>
              <Delta v={subs7} />
            </span>
            <span className="text-[13px]">
              <span className="mr-1 text-nd-fg-3">30일</span>
              <Delta v={subs30} />
            </span>
          </span>
        ),
    },
    {
      key: "trend",
      header: "최근 추이",
      mobile: "hide",
      className: "w-[140px]",
      cell: ({ s }) => (s ? <Sparkline values={s.history.slice(-30).map((h) => h.subs)} width={120} height={28} /> : null),
    },
    {
      key: "hits",
      header: "터진 영상 7일",
      align: "right",
      cell: ({ w }) => (w.hits7 ? <b className="nd-num text-nd-accent-strong">{w.hits7}편</b> : <span className="nd-num">0편</span>),
    },
    {
      key: "baseline",
      header: "평소 조회",
      align: "right",
      cell: ({ w }) => <Num value={w.baseline === null ? null : Math.round(w.baseline)} />,
    },
    {
      key: "keep",
      header: <span className="sr-only">노트</span>,
      mobileLabel: "노트",
      align: "right",
      className: "w-[140px]",
      cell: ({ w, s, subs7 }) => (
        <KeepButton
          done={isKept("channel", w.id)}
          onClick={() =>
            void keep({
              title: `채널 「${w.title}」`,
              snapshot: `구독자 ${s?.history.at(-1)?.subs?.toLocaleString("ko-KR") ?? "—"} · 7일 ${subs7 === null ? "—" : signed(subs7)} · 터진 영상 7일 ${w.hits7}편 · ${d.today}`,
              source: {
                kind: "channel",
                id: w.id,
                url: `https://www.youtube.com/channel/${w.channelId}`,
                label: `감시 채널 · ${w.title}`,
              },
            })
          }
        />
      ),
    },
  ];
  return (
    <div className="space-y-8">
      <StudioSection
        title="내 채널"
        icon={Video}
        description="연결한 유튜브 · 인스타 계정의 구독자 흐름 (내 채널 · 연결에서) · 영상 성과는 성과 비교에서"
        action={
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "snap"} onClick={snap} title="유튜브 · 인스타 공개 숫자를 지금 받습니다 (매일 아침 자동)">
            지금 숫자 받기
          </Button>
        }
      >
        {!mine.length ? (
          <EmptyState compact icon={Video} title="아직 내 채널 기록이 없습니다" description="「지금 숫자 받기」 를 누르거나 내일 아침을 기다려 주세요. 계정은 내 채널 · 연결에서 붙입니다." />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {mine.map((c) => {
              const last = c.history.at(-1);
              const s7 = channelDelta(c.history, 7, "subs");
              const s30 = channelDelta(c.history, 30, "subs");
              return (
                <div key={c.id} className="nd-surface flex min-w-0 flex-col rounded-nd-lg px-5 py-4">
                  <div className="flex items-center gap-3">
                    {c.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nd-fg/[.06] text-nd-fg-3">{c.platform === "youtube" ? <Video size={18} /> : <Camera size={18} />}</span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold text-nd-fg" title={c.name}>
                        {c.name}
                      </p>
                      <p className="text-[13px] text-nd-fg-3">
                        {c.platform === "youtube" ? "유튜브" : "인스타그램"} · 기록 {channelTrackedDays(c.history)}일째
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[13px] text-nd-fg-3">{c.platform === "youtube" ? "구독자" : "팔로워"}</p>
                      <p className="nd-num text-[30px] font-bold leading-tight tracking-[-0.02em] text-nd-fg">
                        <Num value={last?.subs} />
                        {last?.subs !== null && last?.subs !== undefined && <span className="ml-0.5 text-[14px] font-medium tracking-normal text-nd-fg-2">명</span>}
                      </p>
                    </div>
                    <Sparkline values={c.history.slice(-30).map((h) => h.subs)} width={130} height={44} color={c.platform === "youtube" ? TREND_COLORS[0] : TREND_COLORS[2]} />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-nd-line pt-2.5 text-[14px]">
                    <span>
                      <span className="mr-1 text-nd-fg-3">7일</span>
                      <Delta v={s7} unit="명" />
                    </span>
                    <span>
                      <span className="mr-1 text-nd-fg-3">30일</span>
                      <Delta v={s30} unit="명" />
                    </span>
                  </div>
                  <p className="nd-num mt-1.5 text-[13px] text-nd-fg-3">
                    {c.platform === "youtube" ? (
                      <>
                        총 조회 <Num value={last?.views} /> · 영상 <Num value={last?.posts} unit="편" />
                      </>
                    ) : (
                      <>
                        게시물 <Num value={last?.posts} unit="개" />
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </StudioSection>

      <StudioCard
        flush
        title="감시 채널"
        description="바이럴 형식에 등록한 채널 · 7일 구독자 증가 큰 순 · 남의 채널 공개 통계"
        action={
          <Link href="/neander/shorts/scout" className={buttonClass("ghost", "sm", "gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden /> 감시 채널 관리
          </Link>
        }
        bodyClassName="max-md:px-3 max-md:pb-3"
      >
        <RecordTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.w.id}
          ariaLabel="감시 채널"
          empty={
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState compact icon={Users} title="켜 둔 감시 채널이 없습니다" description="바이럴 형식 › 감시 채널에서 넣으세요." />
            </div>
          }
        />
      </StudioCard>

      <StudioNotice tone="info" title="숫자의 출처">
        {days ? `기록 ${days}일째` : "아직 기록 전"}
        {lastAt ? ` · 마지막 수집 ${fmtWhen(lastAt)}` : ""} · 매일 아침 07:30 한 번 · 유튜브 · 인스타 공개 통계. 구독자 숨김이나 수집 실패는 「미확인」 으로 보입니다 (0 이 아닙니다). 7일 · 30일 변화는 기록이 그만큼 쌓여야 나옵니다.
      </StudioNotice>
    </div>
  );
}
