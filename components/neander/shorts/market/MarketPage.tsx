"use client";

// ============================================================
//  시장 트렌드 — 오늘의 브리핑 · 검색어 추이 · 채널 모니터링 · 트렌드 노트
// ------------------------------------------------------------
//  매일 아침 07:30 cron-market 이 채널 숫자 · 검색어 추이 · AI 브리핑을 만든다. 화면은 읽고, 사람이 고른 것을
//  「노트에 보관」 해 트렌드 노트에 모은다(사람마다 비공개). 노트에서 바로 대본 작성기로 넘긴다.
//  숫자는 모두 남의 원본 · 네이버 상대값 · 채널 공개 통계다 — 우리 영상 성과와 섞지 않는다(내 채널만 따로).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  CalendarDays,
  Camera,
  ExternalLink,
  Lightbulb,
  Newspaper,
  PenLine,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  InlineNotice,
  Input,
  NumberInput,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  Table,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import {
  BRIEF_KIND_LABEL,
  NOTE_SOURCE_LABEL,
  NOTE_STATUSES,
  NOTE_STATUS_LABEL,
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

type WithId<T> = T & { id: string };
type ProductTrend = { id: string; product: string; keywords: string[]; label: NaverTrendLabel; change: number | null; recent: number | null; candidates: number; title: string; url: string; thumbnail: string; multiple: number | null; at: number };
type WatchRow = { id: string; channelId: string; title: string; country: string; active: boolean; baseline: number | null; scannedAt: number | null; hits7: number; topics: string[] };
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

const NAVER_TONE: Record<NaverTrendLabel, Tone> = { rising: "success", steady: "neutral", falling: "warning", low: "neutral" };
const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("ko-KR"));
const signed = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "-" : "±"}${Math.abs(v).toLocaleString("ko-KR")}`);
const deltaClass = (v: number | null) => (v === null || v === 0 ? "text-nd-fg-3" : v > 0 ? "text-nd-success-text" : "text-nd-danger-text");

type Tab = "brief" | "trends" | "channels" | "notes";

export function MarketPage() {
  const [d, setD] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const toast = useToast();
  const load = useCallback(async () => {
    try {
      setD(await shortsGet<MarketData>("market"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "시장 트렌드를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 노트에 보관 — 어느 탭에서든
  const keep = useCallback(
    async (draft: NoteDraft) => {
      try {
        const r = await shortsPost<{ note: WithId<TrendNoteDoc> }>("market", { action: "note.save", note: draft });
        setD((x) => (x ? { ...x, notes: [r.note, ...x.notes] } : x));
        toast.success("트렌드 노트에 보관했습니다.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "노트에 보관하지 못했습니다.");
      }
    },
    [toast],
  );
  const kept = useMemo(() => new Set((d?.notes ?? []).map((x) => `${x.source.kind}:${x.source.id}`)), [d?.notes]);
  const isKept = (kind: string, id: string | null) => !!id && kept.has(`${kind}:${id}`);

  if (!d) {
    return (
      <PageShell>
        <PageHeader title="시장 트렌드" description="AI 가 매일 아침 시장을 훑어 특기할 것을 고르고, 검색어 추이 · 채널 변화를 모아 둡니다." />
        {error ? (
          <ErrorState title="시장 트렌드를 불러오지 못했습니다" description={error} action={<Button size="sm" variant="secondary" onClick={() => void load()}>다시 시도</Button>} />
        ) : (
          <div className="space-y-4" aria-busy="true">
            <p className="sr-only" role="status">시장 트렌드를 불러오는 중…</p>
            <Skeleton className="h-11 w-96" />
            <Skeleton className="h-40 rounded-nd-lg" />
            <Skeleton className="h-72 rounded-nd-lg" />
          </div>
        )}
      </PageShell>
    );
  }

  const inbox = d.notes.filter((x) => x.status === "inbox").length;
  return (
    <PageShell>
      <PageHeader
        title="시장 트렌드"
        description="AI 가 매일 아침 레이더 · 바이럴 형식 · 네이버 검색어 · 채널 변화를 훑어 특기할 것을 고릅니다. 마음에 드는 것은 노트에 보관해 두세요."
      />
      {(!d.ready.naver || !d.ready.youtube || !d.ready.ai) && (
        <InlineNotice tone="warning" className="mb-4">
          {[!d.ready.naver && "네이버 데이터랩 키", !d.ready.youtube && "회사 YouTube 키", !d.ready.ai && "OpenRouter 키"].filter(Boolean).join(" · ")} 가 없어 일부를 건너뜁니다.
        </InlineNotice>
      )}
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        ariaLabel="시장 트렌드"
        items={[
          { key: "brief", label: "오늘의 브리핑", icon: Newspaper },
          { key: "trends", label: "검색어 추이", icon: TrendingUp },
          { key: "channels", label: "채널 모니터링", icon: Users, badge: d.channels.length || undefined },
          { key: "notes", label: "트렌드 노트", icon: Bookmark, badge: inbox || undefined, badgeLabel: "검토 전 노트" },
        ]}
      />
      {tab === "brief" && <BriefTab d={d} setD={setD} keep={keep} isKept={isKept} onGo={setTab} />}
      {tab === "trends" && <TrendsTab d={d} setD={setD} keep={keep} isKept={isKept} />}
      {tab === "channels" && <ChannelsTab d={d} reload={load} keep={keep} isKept={isKept} />}
      {tab === "notes" && <NotesTab d={d} setD={setD} />}
    </PageShell>
  );
}

type KeepProps = { keep: (n: NoteDraft) => Promise<void>; isKept: (kind: string, id: string | null) => boolean };

function KeepButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return done ? (
    <Badge tone="success" size="md">
      <Bookmark size={12} aria-hidden /> 보관함
    </Badge>
  ) : (
    <Button size="sm" variant="ghost" icon={Bookmark} onClick={onClick}>
      노트에 보관
    </Button>
  );
}

// ---- 오늘의 브리핑 ----------------------------------------------------------------

function BriefTab({ d, setD, keep, isKept, onGo }: { d: MarketData; setD: (f: (x: MarketData | null) => MarketData | null) => void; onGo: (t: Tab) => void } & KeepProps) {
  const { busy, run } = useAction();
  const [day, setDay] = useState<string | null>(null);
  const [other, setOther] = useState<MarketBriefDoc | null>(null);
  const b = day && other?.day === day ? other : d.brief;
  const pick = (v: string) => {
    if (v === d.brief?.day) return setDay(null);
    setDay(v);
    void shortsGet<{ brief: MarketBriefDoc | null }>(`market?brief=${v}`).then((r) => setOther(r.brief));
  };
  const make = () =>
    void run(
      "brief",
      async () => {
        const r = await shortsPost<{ brief: MarketBriefDoc }>("market", { action: "brief.run" });
        setD((x) => (x ? { ...x, brief: r.brief, briefDays: [{ day: r.brief.day, headline: r.brief.headline, at: r.brief.at }, ...x.briefDays.filter((y) => y.day !== r.brief.day)], spentKrwToday: x.spentKrwToday + Math.round(r.brief.costUsd * USD_KRW) } : x));
        setDay(null);
      },
      "브리핑을 새로 만들었습니다.",
    );
  if (!b) {
    return (
      <EmptyState
        icon={Newspaper}
        title="아직 브리핑이 없습니다"
        description="매일 아침 07:30 에 자동으로 만들어집니다. 지금 만들 수도 있습니다 (AI 한 번 약 10~40원)."
        action={
          <Button icon={Sparkles} loading={busy === "brief"} disabled={!d.ready.ai} onClick={make}>
            지금 브리핑 만들기
          </Button>
        }
      />
    );
  }
  const go = (it: MarketBriefItem) => {
    const r = it.ref;
    if (!r) return null;
    if (r.kind === "group") return <button type="button" className="text-[13px] font-medium text-nd-accent hover:underline" onClick={() => onGo("trends")}>검색어 추이 보기</button>;
    if (r.kind === "format") return <a className="text-[13px] font-medium text-nd-accent hover:underline" href="/neander/shorts/scout">형식 카드 보기</a>;
    if (r.url) return <a className="inline-flex items-center gap-1 text-[13px] font-medium text-nd-accent hover:underline" href={r.url} target="_blank" rel="noreferrer">원본 열기 <ExternalLink size={12} aria-hidden /></a>;
    return null;
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-auto min-w-[200px]" value={b.day} onChange={(e) => pick(e.target.value)} aria-label="브리핑 날짜">
            {d.briefDays.map((x) => (
              <option key={x.day} value={x.day}>
                {x.day}
                {x.day === d.today ? " (오늘)" : ""}
              </option>
            ))}
          </Select>
          <span className="text-[13px] text-nd-fg-3">
            {fmtWhen(b.at)} · {b.by === "company" ? "매일 아침 자동" : "직접 만듦"} · {b.model.split("/").pop()} · {fmtUsd(b.costUsd)}
          </span>
        </div>
        <Button variant="secondary" icon={RefreshCw} loading={busy === "brief"} disabled={!d.ready.ai} onClick={make} title="오늘 브리핑을 다시 만듭니다 (AI 한 번 약 10~40원 · 하루 상한 안)">
          다시 만들기
        </Button>
      </div>

      <Card className="space-y-2.5">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-nd-accent-strong">
          <Sparkles size={14} aria-hidden /> {b.day === d.today ? "오늘의 시장 브리핑" : `${b.day} 브리핑`}
        </p>
        <h2 className="text-[20px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{b.headline}</h2>
        <ul className="space-y-1">
          {b.summary.map((x, i) => (
            <li key={i} className="flex gap-2 text-nd-body text-nd-fg-2">
              <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-nd-accent" />
              <span className="[overflow-wrap:anywhere]">{x}</span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-nd-fg-3">
          넣은 자료 · 레이더 {b.inputs.radar ?? 0} · 뜨는 상품 {b.inputs.productTrends ?? 0} · 터진 영상 {b.inputs.hits ?? 0} · 형식 {b.inputs.formats ?? 0} · 검색어 묶음 {b.inputs.groups ?? 0} · 채널 {b.inputs.channels ?? 0} — AI 해설은 자료 숫자로만 썼고, 사실 확인은 사람이 합니다.
        </p>
        {b.notes.length > 0 && <p className="text-[13px] text-nd-warning-text">{b.notes.join(" · ")}</p>}
      </Card>

      <div className="grid gap-3 [@container(min-width:900px)]:grid-cols-2 lg:grid-cols-2">
        {b.items.map((it, i) => {
          const sid = `${b.day}:${i}`;
          return (
            <Card key={i} padding="none" className="flex min-w-0 flex-col p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={it.kind === "mine" ? "success" : it.kind === "product" ? "accent" : "neutral"} size="md">
                  {BRIEF_KIND_LABEL[it.kind]}
                </Badge>
                {it.ref?.label && <span className="min-w-0 truncate text-[13px] text-nd-fg-3" title={it.ref.label}>{it.ref.label}</span>}
              </div>
              <h3 className="text-[16px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{it.title}</h3>
              <p className="mt-1 text-nd-body text-nd-fg-2 [overflow-wrap:anywhere]">{it.why}</p>
              {it.numbers && <p className="nd-num mt-1.5 text-[13px] font-semibold text-nd-accent-strong [overflow-wrap:anywhere]">{it.numbers}</p>}
              {it.action && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-nd-fg-2">
                  <Lightbulb size={14} className="mt-[2px] shrink-0 text-nd-accent" aria-hidden />
                  <span className="[overflow-wrap:anywhere]">{it.action}</span>
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
                {go(it) ?? <span />}
                <KeepButton
                  done={isKept("brief", sid)}
                  onClick={() =>
                    void keep({
                      title: it.title,
                      memo: [it.why, it.action && `해 볼 것: ${it.action}`].filter(Boolean).join("\n"),
                      snapshot: it.numbers,
                      product: it.kind === "product" ? (it.ref?.label ?? it.title) : "",
                      source: { kind: "brief", id: sid, url: it.ref?.url ?? null, label: `${b.day} 브리핑 · ${BRIEF_KIND_LABEL[it.kind]}` },
                    })
                  }
                />
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-[13px] text-nd-fg-3">오늘 브리핑 AI 비용 {d.spentKrwToday.toLocaleString("ko-KR")}원 / 하루 상한 {d.settings.briefBudgetKrw.toLocaleString("ko-KR")}원</p>
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

function TrendsTab({ d, setD, keep, isKept }: { d: MarketData; setD: (f: (x: MarketData | null) => MarketData | null) => void } & KeepProps) {
  const toast = useToast();
  const { busy, run } = useAction();
  const groupIds = d.settings.groups.map((g) => g.id);
  const [sel, setSel] = useState<string[]>(groupIds.slice(0, 5));
  const [range, setRange] = useState<TrendRange>("1y");
  const [unit, setUnit] = useState<"week" | "month">("week");
  const [mode, setMode] = useState<"groups" | "segments">("groups");
  const [res, setRes] = useState<{ series: { name: string; points: { period: string; ratio: number }[] }[]; mode: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pickIds = mode === "segments" ? sel.slice(0, 1) : sel.slice(0, 5);
  const key = `${pickIds.join(",")}|${range}|${unit}|${mode}`;
  useEffect(() => {
    if (!pickIds.length || !d.ready.naver) return;
    let live = true;
    setLoading(true);
    setErr(null);
    const q = new URLSearchParams({ compare: "1", groups: pickIds.join(","), range, unit, mode });
    shortsGet<{ series: { name: string; points: { period: string; ratio: number }[] }[]; mode: string }>(`market?${q}`)
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
      ? res.series.map((s, i) => ({ key: `seg${i}`, name: s.name, color: TREND_COLORS[i % TREND_COLORS.length], points: s.points }))
      : (res?.series ?? []).map((s, i) => ({ key: pickIds[i] ?? `g${i}`, name: s.name, color: colors[pickIds[i]] ?? TREND_COLORS[i % 5], points: s.points }));
  // 한 묶음이 압도하면(나머지가 모두 10 아래) 나머지 선은 바닥에 붙는다 — 빼고 보기를 권한다
  const dominant = (() => {
    if (res?.mode !== "groups" || lines.length < 2) return null;
    const peaks = lines.map((l) => ({ key: l.key, name: l.name, max: Math.max(0, ...l.points.map((p) => p.ratio)) })).sort((a, b) => b.max - a.max);
    const second = peaks[1].max;
    return peaks[0].max >= 90 && second < 10 ? { key: peaks[0].key, name: peaks[0].name, others: second.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) } : null;
  })();
  const toggle = (id: string) => {
    if (mode === "segments") return setSel([id, ...sel.filter((x) => x !== id)]);
    if (sel.includes(id)) return setSel(sel.filter((x) => x !== id));
    if (sel.length >= 5) return toast.error("한 번에 5묶음까지 견줄 수 있습니다 (네이버 한 요청 한도).");
    setSel([...sel, id]);
  };
  const refresh = () =>
    void run("series", async () => {
      const r = await shortsPost<{ series: Record<string, GroupSeries>; notes: string[] }>("market", { action: "series.refresh" });
      setD((x) => (x ? { ...x, series: r.series } : x));
      if (r.notes.length) toast.error(r.notes.join(" · "));
    }, "묶음별 추이를 새로 받았습니다.");

  return (
    <div className="space-y-6 [container-type:inline-size]">
      <Card className="space-y-3">
        <SectionHeader
          size="lg"
          title={mode === "groups" ? "분야 비교" : "나이 · 성별로 나눠 보기"}
          hint={mode === "groups" ? "고른 묶음을 한 요청에 — 묶음끼리 크기를 견줄 수 있습니다" : "고른 묶음 하나를 집단마다 따로 — 집단끼리 크기는 못 견주고 오르내림만 견줍니다"}
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
        />
        <div className="flex flex-wrap items-center gap-2">
          {d.settings.groups.map((g) => {
            const on = pickIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g.id)}
                title={g.keywords.join(", ")}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors", on ? "border-nd-accent/40 bg-nd-accent-soft text-nd-accent-strong" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken")}
              >
                {on && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: mode === "segments" ? TREND_COLORS[0] : colors[g.id] }} aria-hidden />}
                {g.name}
              </button>
            );
          })}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <SegmentedControl size="sm" ariaLabel="기간" value={range} onChange={(v) => setRange(v)} options={(Object.keys(TREND_RANGE_LABEL) as TrendRange[]).map((r) => ({ value: r, label: TREND_RANGE_LABEL[r] }))} />
            <SegmentedControl size="sm" ariaLabel="단위" value={unit} onChange={(v) => setUnit(v)} options={[{ value: "week", label: "주" }, { value: "month", label: "달" }]} />
          </span>
        </div>
        {!d.ready.naver ? (
          <InlineNotice tone="warning">네이버 데이터랩 키가 없어 검색어 추이를 받을 수 없습니다.</InlineNotice>
        ) : !pickIds.length ? (
          <p className="py-8 text-center text-nd-body text-nd-fg-3">위에서 묶음을 골라 주세요.</p>
        ) : err ? (
          <InlineNotice tone="warning">{err}</InlineNotice>
        ) : loading && !res ? (
          <Skeleton className="h-[280px] rounded-nd-md" />
        ) : (
          <div className={cn("space-y-3", loading && "opacity-60")}>
            <TrendLines lines={lines} unit={unit} title={`${pickIds.map((id) => d.settings.groups.find((g) => g.id === id)?.name).join(" · ")} 검색어 추이`} />
            {res?.mode === "groups" && dominant && (
              <InlineNotice tone="info">
                「{dominant.name}」 검색이 다른 묶음보다 훨씬 많아 나머지 선이 바닥에 붙어 보입니다 (다른 묶음은 가장 높아도 {dominant.others}). 빼면 나머지끼리 다시 100 기준으로 견줍니다.
                <div className="mt-2">
                  <Button size="sm" variant="secondary" onClick={() => toggle(dominant.key)}>
                    「{dominant.name}」 빼고 보기
                  </Button>
                </div>
              </InlineNotice>
            )}
          </div>
        )}
        {mode === "segments" && <p className="text-[13px] text-nd-fg-3">집단마다 따로 부른 값이라 각 선은 그 집단 안에서 가장 높은 구간 = 100 입니다. 「20대 여성이 더 많이 찾는다」 는 이 그래프로 말할 수 없고, 「20대 여성에서 최근 더 오른다」 만 볼 수 있습니다.</p>}
      </Card>

      <section>
        <SectionHeader
          size="lg"
          title="묶음별 최근 추세"
          hint="최근 2주 ÷ 그 전 6주 · 매일 아침 새로 받음 (묶음마다 혼자 부른 1년 주간)"
          action={
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "series"} disabled={!d.ready.naver} onClick={refresh}>
              지금 받기
            </Button>
          }
        />
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          {d.settings.groups.map((g) => {
            const s = d.series[g.id];
            const t = s ? groupTrend(s.points) : null;
            return (
              <Card key={g.id} padding="none" className="min-w-0 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-nd-fg">{g.name}</p>
                    <p className="truncate text-[13px] text-nd-fg-3" title={g.keywords.join(", ")}>{g.keywords.join(" · ")}</p>
                  </div>
                  {t && (
                    <Badge tone={NAVER_TONE[t.label]} size="md">
                      {NAVER_LABEL[t.label].replace("국내 검색 ", "")}
                      {t.change !== null ? ` ×${t.change}` : ""}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  {s ? <Sparkline values={s.points.slice(-26).map((p) => p.ratio)} width={150} height={36} /> : <span className="text-[13px] text-nd-fg-3">아직 안 받음</span>}
                  <KeepButton
                    done={isKept("keyword", g.id)}
                    onClick={() =>
                      void keep({
                        title: `검색어 「${g.name}」 ${t ? NAVER_LABEL[t.label] : ""}`.trim(),
                        snapshot: t ? `최근 2주 ÷ 그 전 6주 ${t.change ?? "—"} · ${d.today}` : "",
                        memo: `검색어: ${g.keywords.join(", ")}`,
                        source: { kind: "keyword", id: g.id, url: null, label: `검색어 묶음 · ${g.name}` },
                      })
                    }
                  />
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <ProductTrends d={d} keep={keep} isKept={isKept} />
      <GroupSettings d={d} setD={setD} />
    </div>
  );
}

function ProductTrends({ d, keep, isKept }: { d: MarketData } & KeepProps) {
  const [all, setAll] = useState(false);
  const list = all ? d.productTrends : d.productTrends.slice(0, 15);
  return (
    <section>
      <SectionHeader size="lg" title="레이더 상품의 국내 검색 추이" hint="AI 레이더가 찾은 상품마다 네이버 검색 · 변화 큰 순 (같은 상품은 한 줄)" />
      {!d.productTrends.length ? (
        <p className="text-nd-body text-nd-fg-3">아직 국내 검색 추이가 붙은 레이더 상품이 없습니다. 레이더가 매일 아침 채웁니다.</p>
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table size="md" minWidth={760}>
              <thead>
                <tr>
                  <Th>상품</Th>
                  <Th>국내 검색</Th>
                  <Th align="right" title="최근 2주 평균 ÷ 그 전 6주 평균">변화</Th>
                  <Th align="right">후보 영상</Th>
                  <Th align="right" title="대표 영상의 채널 평소 대비">평소 대비</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <Tr key={p.id}>
                    <Td className="max-w-0 w-[40%]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-10 w-[56px] shrink-0 rounded-[6px] object-cover" referrerPolicy="no-referrer" loading="lazy" /> : null}
                        <span className="min-w-0">
                          <span className="block truncate font-medium" title={p.product}>{p.product}</span>
                          <span className="block truncate text-[13px] text-nd-fg-3" title={p.keywords.join(", ")}>검색어 {p.keywords.join(" · ")}</span>
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={NAVER_TONE[p.label]} size="md">
                        {NAVER_LABEL[p.label].replace("국내 검색 ", "")}
                      </Badge>
                    </Td>
                    <Td num>{p.change === null ? "—" : `×${p.change}`}</Td>
                    <Td num>{p.candidates}편</Td>
                    <Td num>{p.multiple === null ? "—" : `${p.multiple}배`}</Td>
                    <Td className="text-right">
                      <KeepButton
                        done={isKept("radar", p.id)}
                        onClick={() =>
                          void keep({
                            title: p.product,
                            product: p.product,
                            snapshot: `국내 검색 ${NAVER_LABEL[p.label].replace("국내 검색 ", "")}${p.change !== null ? ` ×${p.change}` : ""} · 후보 ${p.candidates}편 · 평소의 ${p.multiple ?? "?"}배 · ${d.today}`,
                            memo: `대표 영상: ${p.title}`,
                            source: { kind: "radar", id: p.id, url: p.url, label: `레이더 · ${p.product}` },
                          })
                        }
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {d.productTrends.length > 15 && (
        <div className="mt-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
            {all ? "앞의 15개만" : `나머지 ${d.productTrends.length - 15}개 더 보기`}
          </Button>
        </div>
      )}
    </section>
  );
}

function GroupSettings({ d, setD }: { d: MarketData; setD: (f: (x: MarketData | null) => MarketData | null) => void }) {
  const { busy, run } = useAction();
  const [rows, setRows] = useState<{ id: string; name: string; keywords: string }[]>(d.settings.groups.map((g) => ({ id: g.id, name: g.name, keywords: g.keywords.join(", ") })));
  const [enabled, setEnabled] = useState(d.settings.enabled);
  const [budget, setBudget] = useState(String(d.settings.briefBudgetKrw));
  const [open, setOpen] = useState(false);
  const save = () =>
    void run("save", async () => {
      const groups: KeywordGroup[] = rows.map((r) => ({ id: r.id, name: r.name, keywords: r.keywords.split(",").map((k) => k.trim()).filter(Boolean) }));
      const r = await shortsPost<{ settings: MarketSettings }>("market", { action: "settings.save", settings: { groups, enabled, briefBudgetKrw: Number(budget) || 0 } });
      setD((x) => (x ? { ...x, settings: r.settings } : x));
      setBudget(String(r.settings.briefBudgetKrw));
    }, "설정을 저장했습니다 — 묶음 추이는 내일 아침부터 받습니다 (지금 받으려면 「지금 받기」).");
  return (
    <section>
      <SectionHeader
        size="lg"
        title="검색어 묶음 · 자동 실행"
        hint={`${d.settings.groups.length}묶음 · 매일 아침 07:30 ${d.settings.enabled ? "켜짐" : "꺼짐"} · 브리핑 하루 상한 ${d.settings.briefBudgetKrw.toLocaleString("ko-KR")}원`}
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "닫기" : "고치기"}
          </Button>
        }
      />
      {open && (
        <Card className="space-y-2.5">
          {!d.admin && <InlineNotice tone="neutral">설정은 AI STUDIO 관리자만 바꿉니다.</InlineNotice>}
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Field label="매일 아침 자동 (07:30)" hint="묶음 추이 · 채널 숫자 · 브리핑을 차례로">
              <div className="flex h-ctl-md items-center">
                <Switch checked={enabled} disabled={!d.admin} onChange={setEnabled} label={enabled ? "켜짐" : "꺼짐"} />
              </div>
            </Field>
            <Field label="브리핑 AI 하루 상한 (원)" hint="0 ~ 2,000 · 「다시 만들기」 포함">
              <NumberInput value={budget} disabled={!d.admin} onValueChange={setBudget} aria-label="브리핑 AI 하루 상한" />
            </Field>
          </FormRow>
          <p className="pt-1 text-[13px] text-nd-fg-3">묶음마다 검색어 20개까지 — 네이버는 묶음 안 검색어를 합쳐 셉니다.</p>
          <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_32px] gap-x-2 gap-y-2">
            <span className="text-[13px] font-medium text-nd-fg-2">이름</span>
            <span className="text-[13px] font-medium text-nd-fg-2">검색어 (쉼표로 · 20개까지)</span>
            <span />
            {rows.map((r, i) => (
              <div key={i} className="contents">
                <Input value={r.name} disabled={!d.admin} maxLength={30} aria-label={`${i + 1}번째 묶음 이름`} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <Input value={r.keywords} disabled={!d.admin} aria-label={`${i + 1}번째 묶음 검색어`} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, keywords: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`${r.name || `${i + 1}번째`} 묶음 빼기`} disabled={!d.admin} onClick={() => setRows(rows.filter((_, k) => k !== i))} />
              </div>
            ))}
          </div>
          {d.admin && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={Plus} disabled={rows.length >= 12} onClick={() => setRows([...rows, { id: `g${Date.now().toString(36)}`, name: "", keywords: "" }])}>
                묶음 더하기
              </Button>
              <Button size="sm" loading={busy === "save"} onClick={save}>
                저장
              </Button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}

// ---- 채널 모니터링 --------------------------------------------------------------------

function ChannelsTab({ d, reload, keep, isKept }: { d: MarketData; reload: () => Promise<void> } & KeepProps) {
  const toast = useToast();
  const { busy, run } = useAction();
  const mine = d.channels.filter((c) => c.mine);
  const statsByWatch = new Map(d.channels.filter((c) => c.watchId).map((c) => [c.watchId!, c]));
  const rows = d.watch
    .filter((w) => w.active)
    .map((w) => {
      const s = statsByWatch.get(w.id) ?? d.channels.find((c) => c.platform === "youtube" && c.externalId === w.channelId) ?? null;
      return { w, s, subs7: s ? channelDelta(s.history, 7, "subs") : null, subs30: s ? channelDelta(s.history, 30, "subs") : null };
    })
    .sort((a, b) => (b.subs7 ?? -Infinity) - (a.subs7 ?? -Infinity) || b.w.hits7 - a.w.hits7);
  const days = Math.max(0, ...d.channels.map((c) => channelTrackedDays(c.history)));
  const snap = () =>
    void run("snap", async () => {
      const r = await shortsPost<{ youtube: number; instagram: number; notes: string[] }>("market", { action: "channels.snapshot" });
      await reload();
      toast.success(`오늘 숫자를 받았습니다 — 유튜브 ${r.youtube}곳 · 인스타 ${r.instagram}곳`);
      if (r.notes.length) toast.error(r.notes.join(" · "));
    });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-nd-fg-3">
          {days ? `기록 ${days}일째` : "아직 기록 전"} · 매일 아침 한 번 숫자를 남깁니다 — 7일 · 30일 변화는 기록이 그만큼 쌓여야 나옵니다.
        </p>
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "snap"} onClick={snap}>
          지금 숫자 받기
        </Button>
      </div>

      <section>
        <SectionHeader size="lg" title="내 채널" hint="연결한 유튜브 · 인스타 계정 (내 채널 · 연결에서)" />
        {!mine.length ? (
          <p className="text-nd-body text-nd-fg-3">아직 기록이 없습니다 — 「지금 숫자 받기」 를 누르거나 내일 아침을 기다려 주세요.</p>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {mine.map((c) => {
              const last = c.history.at(-1);
              const s7 = channelDelta(c.history, 7, "subs");
              const s30 = channelDelta(c.history, 30, "subs");
              return (
                <Card key={c.id} padding="none" className="min-w-0 p-4">
                  <div className="flex items-center gap-2.5">
                    {c.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-nd-fg/[.06] text-nd-fg-3">{c.platform === "youtube" ? <Video size={18} /> : <Camera size={18} />}</span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-nd-fg" title={c.name}>{c.name}</p>
                      <p className="text-[13px] text-nd-fg-3">{c.platform === "youtube" ? "유튜브" : "인스타그램"} · 기록 {channelTrackedDays(c.history)}일째</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-[13px] text-nd-fg-3">{c.platform === "youtube" ? "구독자" : "팔로워"}</p>
                      <p className="nd-num text-[26px] font-bold leading-tight text-nd-fg">{n(last?.subs)}</p>
                      <p className="nd-num text-[13px]">
                        <span className={deltaClass(s7)}>7일 {signed(s7)}</span> · <span className={deltaClass(s30)}>30일 {signed(s30)}</span>
                      </p>
                    </div>
                    <Sparkline values={c.history.slice(-30).map((h) => h.subs)} width={110} height={40} />
                  </div>
                  <p className="nd-num mt-2 text-[13px] text-nd-fg-3">
                    {c.platform === "youtube" ? `총 조회 ${n(last?.views)} · 영상 ${n(last?.posts)}편` : `게시물 ${n(last?.posts)}개`}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionHeader size="lg" title="감시 채널" hint="바이럴 형식에 등록한 채널 · 7일 구독자 증가 큰 순 · 남의 채널 공개 통계" />
        {!rows.length ? (
          <p className="text-nd-body text-nd-fg-3">켜 둔 감시 채널이 없습니다 — 바이럴 형식 › 감시 채널에서 넣으세요.</p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table size="md" minWidth={980}>
                <thead>
                  <tr>
                    <Th>채널</Th>
                    <Th>나라</Th>
                    <Th align="right">구독자</Th>
                    <Th align="right">7일</Th>
                    <Th align="right">30일</Th>
                    <Th>추이</Th>
                    <Th align="right" title="최근 7일에 바이럴 형식이 찾은 터진 영상 수">터진 영상 7일</Th>
                    <Th align="right" title="최근 쇼츠 조회수 중앙값">평소 조회</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ w, s, subs7, subs30 }) => {
                    const last = s?.history.at(-1);
                    return (
                      <Tr key={w.id}>
                        <Td className="max-w-0 w-[26%]">
                          <a href={`https://www.youtube.com/channel/${w.channelId}`} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline" title={w.title}>
                            {w.title}
                          </a>
                          {w.topics.length > 0 && <span className="block truncate text-[13px] text-nd-fg-3">{w.topics.join(" · ")}</span>}
                        </Td>
                        <Td>{countryLabel(w.country)}</Td>
                        <Td num>{s ? n(last?.subs) : <span className="text-nd-fg-3">기록 전</span>}</Td>
                        <Td num>
                          <span className={deltaClass(subs7)}>{signed(subs7)}</span>
                        </Td>
                        <Td num>
                          <span className={deltaClass(subs30)}>{signed(subs30)}</span>
                        </Td>
                        <Td>{s ? <Sparkline values={s.history.slice(-30).map((h) => h.subs)} width={90} height={26} /> : null}</Td>
                        <Td num>{w.hits7 ? <b className="text-nd-accent-strong">{w.hits7}편</b> : "0"}</Td>
                        <Td num>{n(w.baseline === null ? null : Math.round(w.baseline))}</Td>
                        <Td className="text-right">
                          <KeepButton
                            done={isKept("channel", w.id)}
                            onClick={() =>
                              void keep({
                                title: `채널 「${w.title}」`,
                                snapshot: `구독자 ${n(last?.subs)} · 7일 ${signed(subs7)} · 터진 영상 7일 ${w.hits7}편 · ${d.today}`,
                                source: { kind: "channel", id: w.id, url: `https://www.youtube.com/channel/${w.channelId}`, label: `감시 채널 · ${w.title}` },
                              })
                            }
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>
    </div>
  );
}

// ---- 트렌드 노트 ----------------------------------------------------------------------


function NotesTab({ d, setD }: { d: MarketData; setD: (f: (x: MarketData | null) => MarketData | null) => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [editing, setEditing] = useState<WithId<TrendNoteDoc> | "new" | null>(null);
  const tags = [...new Set(d.notes.flatMap((x) => x.tags))].sort();
  const shown = d.notes.filter((x) => (!tag || x.tags.includes(tag)) && (!q.trim() || [x.title, x.memo, x.snapshot, x.source.label].some((s) => s.toLowerCase().includes(q.trim().toLowerCase()))));
  const save = async (id: string | null, patch: Record<string, unknown>) => {
    try {
      const r = await shortsPost<{ note: WithId<TrendNoteDoc> }>("market", { action: "note.save", id, note: patch });
      setD((x) => (x ? { ...x, notes: id ? x.notes.map((y) => (y.id === id ? r.note : y)) : [r.note, ...x.notes] } : x));
      return r.note;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "노트를 저장하지 못했습니다.");
      return null;
    }
  };
  const del = async (x: WithId<TrendNoteDoc>) => {
    if (!(await ask({ title: "이 노트를 지울까요?", message: x.title, confirmLabel: "지우기", tone: "danger" }))) return;
    try {
      await shortsPost("market", { action: "note.delete", id: x.id });
      setD((y) => (y ? { ...y, notes: y.notes.filter((z) => z.id !== x.id) } : y));
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  };
  const toScript = (x: WithId<TrendNoteDoc>) => {
    const q = new URLSearchParams({ new: "1", product: x.product || x.title, info: [x.snapshot, x.memo].filter(Boolean).join("\n").slice(0, 1500) });
    void save(x.id, { status: "script" });
    router.push(`/neander/shorts/scripts?${q}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nd-fg-3" aria-hidden />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 · 메모 · 숫자 검색" aria-label="노트 검색" />
        </div>
        {tags.length > 0 && (
          <Select className="w-auto" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="태그">
            <option value="">모든 태그</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Select>
        )}
        <Button icon={Plus} onClick={() => setEditing("new")}>
          새 노트
        </Button>
      </div>
      {!d.notes.length ? (
        <EmptyState icon={Bookmark} title="아직 보관한 노트가 없습니다" description="브리핑 · 검색어 추이 · 레이더 상품 · 채널에서 「노트에 보관」 을 누르면 여기 모입니다. 나만 봅니다." />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
          {NOTE_STATUSES.map((st) => {
            const col = shown.filter((x) => x.status === st);
            return (
              <section key={st} aria-label={NOTE_STATUS_LABEL[st]} className="min-w-0 rounded-nd-lg bg-nd-fg/[.03] p-2.5">
                <p className="mb-2 flex items-center justify-between px-1 text-[13px] font-semibold text-nd-fg-2">
                  <span>{NOTE_STATUS_LABEL[st]}</span>
                  <span className="nd-num text-nd-fg-3">{col.length}</span>
                </p>
                <div className="space-y-2">
                  {col.map((x) => (
                    <NoteCard key={x.id} x={x} onOpen={() => setEditing(x)} onScript={() => toScript(x)} onPin={() => void save(x.id, { pinned: !x.pinned })} />
                  ))}
                  {!col.length && <p className="px-1 py-3 text-center text-[13px] text-nd-fg-3">없음</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <NoteDialog
        note={editing}
        onClose={() => setEditing(null)}
        onSave={async (id, patch) => {
          const r = await save(id, patch);
          if (r && !id) setEditing(r);
        }}
        onDelete={(x) => void del(x)}
        onScript={(x) => toScript(x)}
      />
    </div>
  );
}

function NoteCard({ x, onOpen, onScript, onPin }: { x: WithId<TrendNoteDoc>; onOpen: () => void; onScript: () => void; onPin: () => void }) {
  return (
    <Card padding="none" className="min-w-0 p-3">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="line-clamp-2 text-nd-body font-semibold text-nd-fg [overflow-wrap:anywhere]">{x.title}</p>
        </button>
        <button type="button" onClick={onPin} aria-pressed={x.pinned} aria-label={x.pinned ? "고정 풀기" : "위에 고정"} className={cn("shrink-0 rounded p-0.5", x.pinned ? "text-nd-accent" : "text-nd-fg-4 hover:text-nd-fg-2")}>
          <Pin size={14} fill={x.pinned ? "currentColor" : "none"} />
        </button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-[13px] text-nd-fg-3">
        <Badge tone="neutral" size="sm">
          {NOTE_SOURCE_LABEL[x.source.kind]}
        </Badge>
        {x.source.url ? (
          <a href={x.source.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline" title={x.source.label}>
            {x.source.label}
          </a>
        ) : (
          <span className="min-w-0 truncate" title={x.source.label}>{x.source.label}</span>
        )}
      </p>
      {x.snapshot && <p className="nd-num mt-1 text-[13px] font-medium text-nd-accent-strong [overflow-wrap:anywhere]">{x.snapshot}</p>}
      {x.memo && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">{x.memo}</p>}
      {x.tags.length > 0 && <p className="mt-1 text-[13px] text-nd-accent-strong">{x.tags.map((t) => `#${t}`).join(" ")}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[12px] text-nd-fg-3">{fmtWhen(x.updatedAt)}</span>
        <Button size="sm" variant="ghost" icon={PenLine} onClick={onScript} title="이 노트로 대본 작성기를 엽니다 (제품 이름 · 숫자 · 메모를 채워서)">
          대본으로
        </Button>
      </div>
    </Card>
  );
}

/** 노트 고치기 — 칸을 벗어나면 저장 (새 노트는 제목을 적고 벗어나면 만든다) */
function NoteDialog({
  note,
  onClose,
  onSave,
  onDelete,
  onScript,
}: {
  note: WithId<TrendNoteDoc> | "new" | null;
  onClose: () => void;
  onSave: (id: string | null, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (x: WithId<TrendNoteDoc>) => void;
  onScript: (x: WithId<TrendNoteDoc>) => void;
}) {
  const x = note && note !== "new" ? note : null;
  const [f, setF] = useState({ title: "", memo: "", tags: "", product: "" });
  useEffect(() => {
    setF({ title: x?.title ?? "", memo: x?.memo ?? "", tags: (x?.tags ?? []).join(" "), product: x?.product ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x?.id]);
  const commit = (k: "title" | "memo" | "tags" | "product") => {
    const v = f[k];
    if (!x) {
      if (k === "title" && v.trim()) void onSave(null, { title: v, memo: f.memo, tags: f.tags, product: f.product, source: { kind: "manual", id: null, url: null, label: "직접 적음" } });
      return;
    }
    const prev = k === "tags" ? x.tags.join(" ") : x[k];
    if (v !== prev) void onSave(x.id, { [k]: v });
  };
  return (
    <Dialog open={!!note} onClose={onClose} size="md" title={x ? "노트" : "새 노트"} description={x ? `${NOTE_SOURCE_LABEL[x.source.kind]} · ${x.source.label}` : "제목을 적고 칸을 벗어나면 만들어집니다"}>
      <div className="space-y-3">
        <Field label="제목">
          <Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => commit("title")} />
        </Field>
        {x?.snapshot && (
          <p className="nd-num rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] text-nd-fg-2">
            <CalendarDays size={13} className="mr-1 inline" aria-hidden />
            보관할 때 숫자 · {x.snapshot}
          </p>
        )}
        <Field label="메모">
          <Textarea rows={5} value={f.memo} maxLength={3000} onChange={(e) => setF({ ...f, memo: e.target.value })} onBlur={() => commit("memo")} />
        </Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="태그 (띄어쓰기로)">
            <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} onBlur={() => commit("tags")} placeholder="예: 주방 다이소 겨울" />
          </Field>
          <Field label="대본 작성기에 넘길 제품 이름">
            <Input value={f.product} maxLength={120} onChange={(e) => setF({ ...f, product: e.target.value })} onBlur={() => commit("product")} />
          </Field>
        </FormRow>
        {x && (
          <div className="flex flex-wrap items-center gap-2 border-t border-nd-line pt-3">
            <Select className="w-auto" value={x.status} onChange={(e) => void onSave(x.id, { status: e.target.value })} aria-label="상태">
              {NOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {NOTE_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" icon={PenLine} onClick={() => onScript(x)}>
                대본 작성기로
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onDelete(x)}>
                지우기
              </Button>
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

