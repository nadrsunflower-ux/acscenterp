"use client";

// ============================================================
//  시장 트렌드 › 제목 키워드 — 레이더 · 바이럴 형식이 모은 영상 제목의 낱말 순위 (shorts/title-trends.ts)
// ------------------------------------------------------------
//  AI 없이 센다 (추가 비용 0원). 채널 수로 센다 — 한 채널이 열 번 써도 1.
//  점수는 「평소 대비 이번 주에 얼마나 두드러지게 늘었나」 — 모은 양이 적은 주는 흔들리니 주마다 모은 영상 수를 함께 밝힌다.
//  워드클라우드는 크기 · 위치로 읽기 어려워 쓰지 않는다 — 순위 막대 + 숫자.
//  낱말을 고르면(최대 5) 주별 채널 수 선 그래프(한 축 · 선 끝 이름표 · 범례 · 표) + 그 낱말을 쓴 영상.
//  색은 고른 순서가 아니라 자리(slot)로 정한다 — 하나를 빼도 나머지 색은 그대로.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Plus, Search, Type, X } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, InfoPopover, Input, SegmentedControl, Select, Skeleton, Switch, cn } from "@/components/neander/ui";
import { RecordTable, StudioCard, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { Multiple, VideoThumb } from "@/components/neander/shorts/scout/bits";
import { shortsPost } from "@/lib/neander/shorts/client";
import { countryLabel } from "@/lib/neander/shorts/scout";
import { MAX_TITLE_WORDS, TITLE_SOURCE_LABEL, normalizeQuery, onePerChannel, type TitleSourcePick, type TitleTrendsResult, type TitleWordRow } from "@/lib/neander/shorts/title-trends";
import { TREND_COLORS, TREND_DASHES, TREND_DASH_LABEL, TrendLines, niceTicks } from "./TrendLines";

type Pick = { word: string; slot: number };
type Video = TitleTrendsResult["videos"][number];

/** 점수 정의 — 함수 주석(title-trends.ts)과 같은 말 */
export const TITLE_SCORE_HELP =
  "점수(-100~100) = 이번 주 채널 수가 2곳 이상일 때만 100 × (이번 주 − 평소) ÷ (이번 주 + 평소). 평소 = 고른 주 앞 최대 4주 중 모은 영상이 있는 주의 채널 수 평균(그 주에 안 썼으면 0). 평소가 0 이면 100, 비교할 지난 기록이 없으면 점수 없음.";

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekText = (start: string) => `${md(start)} ~ ${md(addDays(start, 6))}`;
const kstMd = (ms: number) => {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const kstYmd = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const fmtBase = (v: number | null) => (v === null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: 1 }));
/** 모은 영상이 이보다 적은 주는 점수가 크게 흔들린다고 알린다 */
const THIN_WEEK = 30;

export function TitleTrendsTab() {
  const [source, setSource] = useState<TitleSourcePick>("both");
  const [country, setCountry] = useState("");
  const [week, setWeek] = useState<string | null>(null);
  const [sort, setSort] = useState<"score" | "count">("score");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [onePer, setOnePer] = useState(false);
  const [res, setRes] = useState<TitleTrendsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const words = picks.map((p) => p.word);
  const key = `${source}|${country}|${week ?? ""}|${words.join(",")}|${retry}`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    shortsPost<TitleTrendsResult>("market", { action: "titles.get", source, country: source === "radar" ? "" : country, week, sort: "score", words })
      // 처음(week = null)은 서버가 고른 주 — 받은 주를 다시 넣지 않는다 (같은 것을 두 번 묻지 않게)
      .then((r) => live && setRes(r))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "제목 키워드를 계산하지 못했습니다."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const colorOf = useMemo(() => new Map(picks.map((p) => [p.word, TREND_COLORS[p.slot]])), [picks]);
  const toggle = (word: string) => {
    if (picks.some((p) => p.word === word)) return setPicks(picks.filter((p) => p.word !== word));
    if (picks.length >= MAX_TITLE_WORDS) return;
    const used = new Set(picks.map((p) => p.slot));
    const slot = [0, 1, 2, 3, 4].find((i) => !used.has(i)) ?? 0;
    setPicks([...picks, { word, slot }]);
  };

  if (!res) {
    return err ? (
      <StudioNotice
        tone="warning"
        title="제목 키워드를 계산하지 못했습니다"
        action={
          <Button size="sm" variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </Button>
        }
      >
        {err}
      </StudioNotice>
    ) : (
      <div className="space-y-4" aria-busy="true">
        <p className="sr-only" role="status">
          제목 키워드를 세는 중…
        </p>
        <Skeleton className="h-28 rounded-nd-lg" />
        <Skeleton className="h-96 rounded-nd-lg" />
      </div>
    );
  }

  const wi = res.weeks.findIndex((w) => w.key === res.week);
  const cur = res.weeks[wi];
  const withData = res.weeks.filter((w) => w.videos > 0);
  const isThis = res.week === res.thisWeek;
  const lastDone = [...res.weeks].reverse().find((w) => w.key < res.thisWeek);
  const dayOfWeek = isThis ? Math.min(7, Math.floor((Date.now() - Date.parse(`${cur.start}T00:00:00+09:00`)) / 86_400_000) + 1) : 0;
  const nq = normalizeQuery(q);
  const sorted = [...res.rows.filter((r) => r.cur >= 2)].sort(sort === "count" ? (a, b) => b.cur - a.cur || (b.score ?? -1000) - (a.score ?? -1000) || a.word.localeCompare(b.word) : (a, b) => (b.score ?? -1000) - (a.score ?? -1000) || b.cur - a.cur || a.word.localeCompare(b.word));
  const filtered = nq ? sorted.filter((r) => r.word.includes(nq)) : sorted;
  const shown = all || nq ? filtered : filtered.slice(0, 30);
  const exactMissing = !!nq && !sorted.some((r) => r.word === nq) && !words.includes(nq);
  const rowOf = (w: string) => res.rows.find((r) => r.word === w) ?? null;
  const vids = onePer ? onePerChannel(res.videos) : res.videos;
  const maxCh = Math.max(1, ...res.series.flatMap((s) => s.points.map((p) => p.channels ?? 0)));
  const go = (k: string) => setWeek(k);

  return (
    <div className="space-y-6">
      <StudioCard
        title="제목 키워드"
        description="모은 영상 제목의 낱말을 채널 수로 셉니다 — 한 채널이 여러 번 써도 1곳. AI 없이 세어 비용이 들지 않습니다."
        action={
          <InfoPopover
            label="점수 기준"
            title="점수는 이렇게 셉니다"
            terms={[
              { term: "점수", desc: TITLE_SCORE_HELP },
              { term: "이번 주 · 평소", desc: "고른 주에 그 낱말을 제목에 쓴 채널 수 · 앞 최대 4주(자료 있는 주) 평균" },
              { term: "처음 본 날", desc: "모은 자료 중 그 낱말을 쓴 영상을 가장 일찍 올린 날 — 실제로 처음 쓰인 날이 아니라 우리가 모은 범위 안에서" },
              { term: "낱말 나누기", desc: "공백 · 문장부호로 자르고 조사를 뗍니다. 해시태그는 # 없이 한 낱말, 일본어는 가타카나 · 한자 덩어리만. 숫자 · 한 글자 · 흔한 말(쇼츠 · 추천 · 꿀템 · 진짜 …)은 셉니다에서 뺍니다." },
            ]}
            footer="레이더는 45일 지난 후보를 치워 오래된 주는 자료가 줄어듭니다. 사람이 뺀 후보 · 주제 밖으로 본 후보는 세지 않습니다."
          />
        }
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <div className="min-w-0">
              <p className="mb-1.5 text-[13px] font-medium text-nd-fg-2">자료</p>
              <SegmentedControl ariaLabel="자료" value={source} onChange={(v) => setSource(v)} options={(["both", "radar", "hits"] as TitleSourcePick[]).map((v) => ({ value: v, label: TITLE_SOURCE_LABEL[v] }))} />
            </div>
            {source !== "radar" && (
              <label className="block min-w-[140px]">
                <span className="mb-1.5 block text-[13px] font-medium text-nd-fg-2">나라</span>
                <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="나라">
                  <option value="">모든 나라</option>
                  {res.countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {countryLabel(c.code)} · {c.videos.toLocaleString("ko-KR")}편
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[13px] font-medium text-nd-fg-2">주 (월~일 · 올린 날 기준)</p>
            <div className="flex flex-wrap items-center gap-2">
              <IconButton icon={ChevronLeft} label="앞 주" variant="secondary" disabled={wi <= 0} onClick={() => go(res.weeks[wi - 1].key)} />
              <span className="nd-num min-w-[9.5rem] text-center text-[15px] font-semibold text-nd-fg">
                {weekText(cur.start)}
                <span className="ml-1.5 text-[13px] font-medium text-nd-fg-3">{isThis ? "이번 주" : cur.key === lastDone?.key ? "지난주" : cur.key.slice(5)}</span>
              </span>
              <IconButton icon={ChevronRight} label="다음 주" variant="secondary" disabled={wi >= res.weeks.length - 1} onClick={() => go(res.weeks[wi + 1].key)} />
              <Button size="sm" variant="ghost" disabled={isThis} onClick={() => go(res.thisWeek)}>
                이번 주
              </Button>
            </div>
          </div>
        </div>

        {/* 자료 범위 — 점수가 얼마나 믿을 만한가 */}
        <div className="mt-4 border-t border-nd-line pt-3">
          <p className="text-[14px] text-nd-fg-2">
            기록이 있는 주 <b className="nd-num font-semibold text-nd-fg">{withData.length}주</b>
            {withData[0] ? ` (${md(withData[0].start)} 주부터)` : ""} · 이 주 영상 <b className="nd-num font-semibold text-nd-fg">{cur.videos.toLocaleString("ko-KR")}편</b> · 채널{" "}
            <b className="nd-num font-semibold text-nd-fg">{cur.channels.toLocaleString("ko-KR")}곳</b> · 평소 = 앞 {res.baseWeeks.length}주 평균
            {res.baseWeeks.length ? ` (${res.baseWeeks.map((k) => md(res.weeks.find((w) => w.key === k)!.start)).join(" · ")} 주)` : ""}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="주마다 모은 영상 수">
            {res.weeks.map((w) => (
              <li key={w.key}>
                <button
                  type="button"
                  onClick={() => go(w.key)}
                  aria-pressed={w.key === res.week}
                  className={cn(
                    "nd-num inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[13px] transition-colors",
                    w.key === res.week ? "border-nd-accent/40 bg-nd-accent-soft font-semibold text-nd-accent-strong" : res.baseWeeks.includes(w.key) ? "border-nd-border bg-nd-sunken text-nd-fg-2" : "border-nd-line bg-nd-content text-nd-fg-3 hover:bg-nd-sunken",
                  )}
                  title={`${weekText(w.start)} · 영상 ${w.videos}편 · 채널 ${w.channels}곳${res.baseWeeks.includes(w.key) ? " · 평소에 넣음" : ""}`}
                >
                  {md(w.start)}
                  <span className={w.videos ? undefined : "text-nd-fg-4"}>{w.videos ? `${w.videos}편` : "없음"}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-2 empty:hidden">
            {isThis && res.totals.videos > 0 && (
              <StudioNotice tone="info" title={`이번 주는 아직 진행 중입니다 (${dayOfWeek}일째)`}>
                끝난 주와 견주면 채널 수가 덜 차 점수가 낮게 나옵니다. 흐름을 볼 때는 지난주를 먼저 보세요.
              </StudioNotice>
            )}
            {res.totals.videos === 0 ? null : !res.baseWeeks.length ? (
              <StudioNotice tone="neutral" title="비교할 지난 기록이 없습니다">
                이 주 앞 4주에 모은 영상이 없어 점수를 매기지 않습니다 — 채널 수만 봅니다.
              </StudioNotice>
            ) : (
              cur.videos < THIN_WEEK && (
                <StudioNotice tone="warning" title={`이 주 영상이 ${cur.videos}편뿐입니다`}>
                  모은 양이 적은 주는 한두 채널로 점수가 크게 흔들립니다. 숫자(이번 주 · 평소)를 함께 보세요.
                </StudioNotice>
              )
            )}
          </div>
        </div>
      </StudioCard>

      {res.totals.videos === 0 ? (
        <EmptyState
          icon={Type}
          title="이 프로젝트에는 아직 모은 영상이 없습니다"
          description={`${source === "radar" ? "AI 레이더" : source === "hits" ? "바이럴 형식" : "AI 레이더 · 바이럴 형식"}가 영상을 모으면(레이더 검색어 · 감시 채널) 다음 날부터 제목 낱말을 셉니다.`}
        />
      ) : (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* 순위 */}
        <StudioCard
          flush
          title={`${sort === "score" ? "두드러지게 늘어난 낱말" : "많이 쓴 낱말"} · ${filtered.length.toLocaleString("ko-KR")}개`}
          description="이 주에 채널 2곳 이상이 쓴 낱말 · 누르면 주별 추이와 그 낱말을 쓴 영상을 봅니다"
          action={<SegmentedControl ariaLabel="정렬" value={sort} onChange={(v) => setSort(v)} options={[{ value: "score", label: "점수 순" }, { value: "count", label: "많이 쓴 순" }]} />}
        >
          <div className="px-5 pb-3 sm:px-6">
            <div className="relative">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nd-fg-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="낱말 직접 찾기 (예: 수납 · 이케아)" aria-label="낱말 찾기" className="pl-9" />
            </div>
            {exactMissing && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-nd-fg-3">
                「{nq}」 은(는) 이 주 순위에 없습니다 (채널 2곳 아래).
                <Button size="sm" variant="secondary" icon={Plus} disabled={picks.length >= MAX_TITLE_WORDS} onClick={() => (toggle(nq), setQ(""))}>
                  「{nq}」 추이 보기
                </Button>
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState compact icon={Type} title={nq ? "찾는 낱말이 없습니다" : "이 주에 채널 2곳 이상이 쓴 낱말이 없습니다"} description={nq ? "다른 말로 찾거나 위 버튼으로 추이를 직접 보세요." : "다른 주를 고르거나 자료를 「둘 다」 로 넓혀 보세요."} />
            </div>
          ) : (
            <WordList rows={shown} colorOf={colorOf} full={picks.length >= MAX_TITLE_WORDS} onToggle={toggle} />
          )}
          {!nq && filtered.length > 30 && (
            <div className="border-t border-nd-line px-5 py-3 sm:px-6">
              <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                {all ? "상위 30개만" : `나머지 ${(filtered.length - 30).toLocaleString("ko-KR")}개 더 보기`}
              </Button>
            </div>
          )}
        </StudioCard>

        {/* 고른 낱말 — 추이 · 영상 */}
        <div className={cn("min-w-0 space-y-6", loading && "opacity-60")} aria-busy={loading || undefined}>
          <StudioCard title="주별 추이" description={`고른 낱말을 제목에 쓴 채널 수 — 최대 ${MAX_TITLE_WORDS}개 · 자료 없는 주는 선을 끊습니다`}>
            {picks.length === 0 ? (
              <EmptyState compact icon={Type} title="낱말을 골라 주세요" description="왼쪽 순위에서 낱말을 누르면 주마다 몇 채널이 썼는지 한 축에 그립니다." />
            ) : (
              <>
                <ul className="mb-4 flex flex-wrap gap-2" aria-label="고른 낱말">
                  {picks.map((p) => {
                    const r = rowOf(p.word);
                    return (
                      <li key={p.word}>
                        <span className="inline-flex h-9 items-center gap-2 rounded-full border border-nd-border bg-nd-content pl-3 pr-1 text-[14px]">
                          <svg width={22} height={10} aria-hidden className="shrink-0">
                            <line x1={1} x2={21} y1={5} y2={5} stroke={TREND_COLORS[p.slot]} strokeWidth={2.5} strokeDasharray={TREND_DASHES[p.slot] || undefined} strokeLinecap="round" />
                          </svg>
                          <span className="font-semibold text-nd-fg">{p.word}</span>
                          <span className="text-[13px] text-nd-fg-3">
                            {TREND_DASH_LABEL[p.slot]} · 이 주 {r?.cur ?? 0}곳{r && r.totalVideos === 0 ? " · 자료에 없음" : ""}
                          </span>
                          <IconButton icon={X} label={`「${p.word}」 빼기`} size="sm" variant="ghost" onClick={() => toggle(p.word)} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <TrendLines
                  lines={res.series.map((s) => ({
                    key: s.word,
                    name: s.word,
                    color: colorOf.get(s.word) ?? TREND_COLORS[0],
                    dash: picks.find((p) => p.word === s.word)?.slot,
                    points: s.points.map((p) => ({ period: p.start, ratio: p.channels })),
                  }))}
                  unit="week"
                  note={`제목에 쓴 채널 수 · 공통 축 (주 = 월요일 날짜)${res.weeks.at(-1)?.key === res.thisWeek ? ` · 마지막 ${md(res.weeks.at(-1)!.start)} 주는 아직 진행 중` : ""}`}
                  title={`${words.join(" · ")} 제목 키워드 주별 채널 수`}
                  scale={{ ticks: niceTicks(maxCh), unit: "곳", tableNote: "주마다 그 낱말을 제목에 쓴 채널 수 — 자료 없는 주는 —", rowHeader: "주(월요일)" }}
                />
              </>
            )}
          </StudioCard>

          {picks.length > 0 && (
            <StudioCard
              flush
              title={`이 낱말을 쓴 영상 · ${vids.length.toLocaleString("ko-KR")}편`}
              description="최근에 올린 순 · 모든 주 · 최대 80편"
              action={<Switch checked={onePer} onChange={setOnePer} label="같은 채널은 하나만" />}
            >
              <VideoList rows={vids} colorOf={colorOf} week={res.week} />
            </StudioCard>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function ScoreBar({ r }: { r: TitleWordRow }) {
  if (r.score === null)
    return (
      <span className="text-[13px] text-nd-fg-3" title={r.cur < 2 ? "이 주 채널이 2곳 아래라 점수를 매기지 않습니다" : "비교할 지난 기록이 없습니다"}>
        —
      </span>
    );
  const w = Math.min(100, Math.abs(r.score));
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-nd-sunken" aria-hidden>
        <span className={cn("block h-full rounded-full", r.score >= 0 ? "bg-nd-accent" : "bg-nd-fg-4")} style={{ width: `${Math.max(3, w)}%` }} />
      </span>
      <span className={cn("nd-num w-10 shrink-0 text-right text-[14px] font-semibold", r.score >= 0 ? "text-nd-fg" : "text-nd-fg-3")}>{r.score}</span>
    </span>
  );
}

/**
 * 순위 줄 — 순위 · 낱말(아래 줄에 평소 · 처음 본 날) · 점수 막대 · 이번 주 채널 수.
 * 순위 칸은 화면 절반 너비라 칸을 넷으로 줄였다 (모바일은 이번 주도 아래 줄로).
 * 평소 · 처음 본 날 · 영상 수 줄은 자르지 않고 줄을 바꾼다 — 말줄임표로 숨기면 처음 본 날 · 영상 수가 안 보인다.
 */
function WordList({ rows, colorOf, full, onToggle }: { rows: TitleWordRow[]; colorOf: Map<string, string>; full: boolean; onToggle: (w: string) => void }) {
  const cols = "grid-cols-[1.75rem_minmax(0,1fr)_6.5rem] md:grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_3.75rem]";
  return (
    <div className="min-w-0">
      <div className={cn("hidden items-center gap-x-3 border-y border-nd-line bg-nd-sunken/70 px-5 py-2.5 text-[13px] font-medium text-nd-fg-3 sm:px-6 md:grid", cols)}>
        <span>순위</span>
        <span className="min-w-0">낱말 · 평소 · 처음 본 날 · 영상</span>
        <span>점수</span>
        <span className="text-right">이번 주</span>
      </div>
      <ol className="divide-y divide-nd-line border-t border-nd-line md:border-t-0">
        {rows.map((r, i) => {
          const color = colorOf.get(r.word);
          const on = !!color;
          const first = r.firstSeen ? kstMd(r.firstSeen) : "—";
          return (
            <li key={r.word}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => onToggle(r.word)}
                title={on ? `「${r.word}」 빼기` : full ? `한 번에 ${MAX_TITLE_WORDS}개까지 견줍니다` : `「${r.word}」 추이 보기`}
                className={cn("grid w-full items-center gap-x-3 px-5 py-2.5 text-left transition-colors sm:px-6", cols, on ? "bg-nd-accent-soft/60" : "enabled:hover:bg-nd-sunken/60", !on && full && "cursor-not-allowed")}
              >
                <span className="nd-num text-[13px] text-nd-fg-3">{i + 1}</span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    {on && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
                    <span className="truncate text-[15px] font-semibold text-nd-fg">{r.word}</span>
                  </span>
                  <span className="nd-num mt-0.5 block text-[13px] text-nd-fg-3" title={r.firstSeen ? `처음 본 날 ${kstYmd(r.firstSeen)}` : undefined}>
                    <span className="md:hidden">이번 주 {r.cur}곳 · </span>평소 {fmtBase(r.base)}곳 · 처음 {first} · 이 주 영상 {r.videos}편
                  </span>
                </span>
                <span className="min-w-0">
                  <ScoreBar r={r} />
                </span>
                <span className="nd-num hidden text-right text-[14px] font-semibold text-nd-fg md:block">{r.cur}곳</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function VideoList({ rows, colorOf, week }: { rows: Video[]; colorOf: Map<string, string>; week: string }) {
  const columns: RecordColumn<Video>[] = [
    {
      key: "video",
      header: "영상",
      mobile: "title",
      className: "md:min-w-[17rem]",
      cell: (v) => (
        <span className="flex min-w-0 items-start gap-3">
          <VideoThumb src={v.thumbnail} label="YouTube" className="h-[54px] w-24" />
          <span className="min-w-0">
            <a href={v.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium text-nd-fg [overflow-wrap:anywhere] hover:underline" title={v.title}>
              {v.title}
              <ExternalLink size={13} aria-hidden className="ml-1 inline align-[-1px] text-nd-fg-3" />
            </a>
            <span className="mt-1 flex flex-wrap gap-1">
              {v.matched.map((w) => (
                <Badge key={w} tone="neutral" size="md">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf.get(w) }} aria-hidden />
                  {w}
                </Badge>
              ))}
              {v.week === week && (
                <Badge tone="accent" size="md">
                  고른 주
                </Badge>
              )}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "channel",
      header: "채널 · 출처",
      mobileLabel: "채널",
      cell: (v) => (
        <span className="block min-w-0 max-w-[13rem] md:max-w-[9rem]">
          <span className="block truncate text-nd-fg" title={v.channel}>
            {v.channel || "—"}
          </span>
          <span className="block truncate text-[13px] text-nd-fg-3">
            {v.country ? countryLabel(v.country) : "나라 모름"} · {v.sources.map((s) => (s === "radar" ? "레이더" : "바이럴 형식")).join(" · ")}
          </span>
        </span>
      ),
    },
    { key: "multiple", header: "평소의", align: "right", cell: (v) => <span className="whitespace-nowrap"><Multiple value={v.multiple} /></span> },
    {
      key: "at",
      header: "올린 날",
      align: "right",
      cell: (v) => (
        <span className="whitespace-nowrap" title={v.atBasis === "collected" ? "올린 날을 몰라 모은 날로 셉니다" : undefined}>
          {kstMd(v.at)}
          {v.atBasis === "collected" && <span className="ml-1 text-[13px] text-nd-fg-3">(모은 날)</span>}
        </span>
      ),
    },
  ];
  return <RecordTable rows={rows} columns={columns} rowKey={(v) => v.key} ariaLabel="이 낱말을 쓴 영상" className="[&>ul]:px-4 [&>ul]:pb-4" empty={<p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">이 낱말을 쓴 영상이 없습니다.</p>} />;
}
