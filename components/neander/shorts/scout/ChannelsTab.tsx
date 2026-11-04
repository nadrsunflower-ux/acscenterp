"use client";

// ============================================================
//  감시 채널 — 나라별로 지켜볼 YouTube 채널. (2026-11-04 목업 09-scout-channels)
// ------------------------------------------------------------
//  채널 찾기(검색 표본 · 검색 사용량) → 감시 채널 표(나라 · 언어 · 주제 · 평소 조회 · 추가 방식 · 상태 · 최근 수집)
//  → 직접 추가. 표는 모바일에서 카드 목록이 된다(RecordTable).
//  「터진 영상 기준 · 자동 분석」(정찰 설정)은 자동 수집 「설정」 구간으로 옮겼다 — 여기서는 바로 가기만.
//  감시 채널은 우리 게시 계정이 아니다 — 원본 영상의 흐름을 보려고 지켜보는 남의 채널.
//  채널마다 「터진 vs 평소」 서랍 — 같은 채널 안에서 평소의 몇 배로 터진 영상과 평소 영상을 견준다
//  (숫자는 scout.ts 계산 · 차이는 AI 가설 · 결과는 회사 공용이라 함께 본다).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, GitCompareArrows, Plus, RefreshCw, Search, Settings2, Sparkles, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Field,
  FieldAction,
  FormRow,
  Input,
  LoadingState,
  Select,
  Sheet,
  Switch,
  Table,
  TableScroll,
  Td,
  Th,
  buttonClass,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { Num, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { AiCostNote, RecordTable, StudioCard, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { fmtCount, fmtPct, fmtSec } from "@/lib/neander/shorts/model";
import {
  CHANNEL_COMPARE_DAILY_LIMIT,
  COMPARE_ASPECT_LABEL,
  COMPARE_MEASURED_USD,
  COMPARE_MIN_AGE_DAYS,
  COMPARE_STRENGTH_LABEL,
  COMPARE_USUAL_MAX,
  COMPARE_USUAL_MIN,
  COUNTRIES,
  TIME_BANDS,
  WEEKDAYS_KO,
  countryLabel,
  languageOf,
  type ChannelCompare,
  type ChannelCompareCalc,
  type CompareGroupStats,
  type CompareVideo,
  type WatchChannelDoc,
} from "@/lib/neander/shorts/scout";
import { AUTO_TOPIC } from "@/lib/neander/shorts/scout-auto";
import { AiWon, ChannelAvatar, CountrySelect, Multiple, VideoThumb, fmtAgo, fmtDate, fmtDay, langLabel, wonOf } from "./bits";
import { scout, type ScoutData, type WithId } from "./useScout";

interface DiscoverGroup {
  channel: { channelId: string; handle: string; title: string; thumbnail: string; country: string; subscribers: number | null };
  videos: { id: string; url: string; title: string; views: number | null; publishedAt: string }[];
  watched: boolean;
}

type Watch = WithId<WatchChannelDoc>;

/** 자동으로 넣은 채널 — 주제 「자동 추가」 또는 회사 자동화가 넣은 것 */
const isAuto = (c: Watch) => c.topics.includes(AUTO_TOPIC) || c.owner === "company";

export function ChannelsTab({ d, refresh, onOpenSettings }: { d: ScoutData; refresh: () => Promise<void>; onOpenSettings?: () => void }) {
  const ask = useConfirm();
  const toast = useToast();
  const { busy, run } = useAction();
  const [add, setAdd] = useState({ ref: "", country: "US", topics: "" });
  const [disc, setDisc] = useState({ query: "", country: "US", days: 14 });
  const [groups, setGroups] = useState<DiscoverGroup[] | null>(null);
  const [filter, setFilter] = useState("");
  // 「터진 vs 평소」 서랍을 연 채널
  const [cmpId, setCmpId] = useState<string | null>(null);
  const keyReady = !!d.quotas.youtubeSearch.source;
  const yt = d.quotas.youtubeSearch;

  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of d.channels) if (c.active) m.set(c.country, (m.get(c.country) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [d.channels]);
  const rows = d.channels.filter((c) => !filter || c.country === filter);
  const active = d.channels.filter((c) => c.active).length;
  const autoCount = d.channels.filter(isAuto).length;

  const addChannel = (ref: string, country: string, topics: string) =>
    run(
      `add-${ref}`,
      async () => {
        await scout("watch.add", { ref, country, language: languageOf(country), topics: topics.split(",").map((t) => t.trim()).filter(Boolean) });
        await refresh();
      },
      "감시 채널에 넣었습니다. 「훑기」 를 누르면 바로 평소 조회수와 터진 영상을 찾습니다.",
    );

  const discover = () =>
    run("discover", async () => {
      const r = await scout<{ groups: DiscoverGroup[] }>("watch.discover", { query: disc.query, regionCode: disc.country, language: languageOf(disc.country), days: disc.days });
      setGroups(r.groups);
    });

  const patch = (id: string, p: object) =>
    run(`patch-${id}`, async () => {
      await scout("watch.update", { id, patch: p });
      await refresh();
    });

  const columns: RecordColumn<Watch>[] = [
    {
      key: "channel",
      header: "채널 · 주제",
      mobile: "title",
      className: "w-[28%] min-w-[260px] max-w-0",
      cell: (c) => {
        const topics = c.topics.filter((t) => t !== AUTO_TOPIC);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <ChannelAvatar src={c.thumbnail} />
            <span className="min-w-0">
              <a href={`https://www.youtube.com/channel/${c.channelId}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 font-medium text-nd-fg hover:underline" title={c.title}>
                <span className="truncate">{c.title || c.handle || c.channelId}</span>
                <ExternalLink size={13} className="shrink-0 text-nd-fg-3" aria-hidden />
              </a>
              <span className="block truncate text-[13px] font-normal text-nd-fg-3" title={[c.handle, topics.join(" · ")].filter(Boolean).join(" · ")}>
                {topics.length ? topics.join(" · ") : "주제 없음"}
                {c.handle ? ` · ${c.handle}` : ""}
              </span>
            </span>
          </div>
        );
      },
    },
    {
      key: "country",
      header: "나라 · 언어",
      className: "w-[170px]",
      cell: (c) => (
        <span className="flex flex-col items-end gap-1 md:items-stretch">
          <CountrySelect value={c.country} label={`${c.title} 나라`} onChange={(v) => void patch(c.id, { country: v, language: languageOf(v) })} />
          <span className="text-[13px] text-nd-fg-3">{langLabel(c.language)}</span>
        </span>
      ),
    },
    { key: "subs", header: "구독자", align: "right", cell: (c) => <Count value={c.subscribers} hiddenTitle="구독자 수를 숨겼거나 아직 받지 않았습니다" /> },
    {
      key: "base",
      header: "평소 조회",
      align: "right",
      cell: (c) =>
        c.scan.baseline === null ? (
          <Unknown title={c.scan.at ? "쇼츠가 모자라 평소 조회수를 낼 수 없습니다" : "아직 훑지 않았습니다"} />
        ) : (
          <span title={c.scan.baselineBasis === "young" ? "7일 넘은 쇼츠가 모자라 어린 영상까지 넣은 값" : `최근 쇼츠 ${c.scan.baselineN}편 조회수 중앙값`}>
            <Num value={Math.round(c.scan.baseline)} />
            {c.scan.baselineBasis === "young" && <span className="ml-1 text-[13px] text-nd-fg-3">어림</span>}
          </span>
        ),
    },
    {
      key: "how",
      header: "추가 방식",
      cell: (c) =>
        isAuto(c) ? (
          <span title="매일 아침 자동 수집이 넣은 채널 — 아니다 싶으면 끄거나 빼세요 (뺀 채널은 다시 넣지 않습니다)">
            <Badge tone="info" size="lg">
              자동 추가
            </Badge>
          </span>
        ) : (
          <Badge tone="neutral" size="lg">
            직접 추가
          </Badge>
        ),
    },
    {
      key: "state",
      header: "상태 · 최근 수집",
      className: "min-w-[200px]",
      cell: (c) => (
        <span className="flex flex-col items-end gap-1 md:items-start">
          <Switch checked={c.active} onChange={(v) => void patch(c.id, { active: v })} label={c.active ? "켜짐" : "꺼짐"} aria-label={`${c.title} 훑기 켜기`} />
          {c.scan.error ? (
            <span className="block max-w-[240px] truncate text-[13px] text-nd-danger-text" title={c.scan.error}>
              실패 · {fmtWhen(c.scan.at)} · {c.scan.error}
            </span>
          ) : c.scan.at ? (
            <span className="nd-num text-[13px] text-nd-fg-3">
              {fmtDay(c.scan.at, true)} · 쇼츠 {c.scan.shortsSeen}편 봄
            </span>
          ) : (
            <span className="text-[13px] text-nd-fg-3">아직 안 훑음</span>
          )}
        </span>
      ),
    },
    {
      key: "act",
      header: "작업",
      align: "right",
      cell: (c) => (
        <span className="flex flex-wrap justify-end gap-1">
          <Button
            variant="secondary"
            icon={GitCompareArrows}
            title="같은 채널 안에서 평소의 몇 배로 터진 영상과 평소 영상을 견줍니다"
            onClick={() => setCmpId(c.id)}
          >
            {c.compare ? "비교 보기" : "터진 vs 평소"}
          </Button>
          <Button
            variant="secondary"
            icon={RefreshCw}
            disabled={!keyReady || busy === `scan-${c.id}`}
            onClick={() =>
              void run(`scan-${c.id}`, async () => {
                await scout("watch.scan", { id: c.id });
                await refresh();
              })
            }
          >
            {busy === `scan-${c.id}` ? "훑는 중…" : "훑기"}
          </Button>
          {(c.owner === d.me || d.admin) && (
            <Button
              variant="ghost"
              icon={Trash2}
              aria-label={`${c.title} 감시에서 빼기`}
              title="감시에서 빼기"
              onClick={() =>
                void (async () => {
                  if (!(await ask({ title: "감시에서 뺄까요?", message: "이 채널에서 찾은 터진 영상과 형식 카드는 남습니다.", tone: "danger", confirmLabel: "빼기" }))) return;
                  await run(`del-${c.id}`, () => scout("watch.delete", { id: c.id }));
                  await refresh();
                })()
              }
            />
          )}
        </span>
      ),
    },
  ];

  const discCols: RecordColumn<DiscoverGroup>[] = [
    {
      key: "ch",
      header: "채널",
      mobile: "title",
      className: "w-[34%] max-w-0",
      cell: (g) => (
        <div className="flex min-w-0 items-center gap-3">
          <ChannelAvatar src={g.channel.thumbnail} />
          <span className="min-w-0">
            <a href={`https://www.youtube.com/channel/${g.channel.channelId}`} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline" title={g.channel.title}>
              {g.channel.title}
            </a>
            <span className="block truncate text-[13px] font-normal text-nd-fg-3">
              {g.channel.handle}
              {g.channel.country ? ` · 채널 표기 ${countryLabel(g.channel.country)}` : ""}
            </span>
          </span>
        </div>
      ),
    },
    { key: "subs", header: "구독자", align: "right", cell: (g) => <Count value={g.channel.subscribers} hiddenTitle="구독자 수를 숨긴 채널입니다" /> },
    {
      key: "top",
      header: "표본 속 대표 쇼츠",
      className: "max-w-[360px]",
      cell: (g) => (
        <span className="block min-w-0">
          <a href={g.videos[0].url} target="_blank" rel="noreferrer" className="block truncate hover:underline" title={g.videos[0].title}>
            {g.videos[0].title}
          </a>
          <span className="block text-[13px] text-nd-fg-3">
            조회 {g.videos[0].views === null ? <Unknown /> : fmtCount(g.videos[0].views)} · {fmtAgo(g.videos[0].publishedAt)}
            {g.videos.length > 1 ? ` · 표본에 ${g.videos.length}편` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "act",
      header: "작업",
      align: "right",
      cell: (g) =>
        g.watched ? (
          <Badge tone="success" size="lg">
            감시 중
          </Badge>
        ) : (
          <Button
            variant="secondary"
            icon={Plus}
            disabled={busy === `add-${g.channel.channelId}`}
            onClick={() =>
              void addChannel(g.channel.channelId, disc.country, "").then(() => setGroups((gs) => gs?.map((x) => (x.channel.channelId === g.channel.channelId ? { ...x, watched: true } : x)) ?? null))
            }
          >
            감시에 넣기
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <StudioNotice
        tone="info"
        title="감시 채널의 원본 반응"
        action={
          <Link href="/neander/shorts/accounts" className={buttonClass("secondary", "sm")}>
            내 채널 · 연결
          </Link>
        }
      >
        참고할 채널을 찾는 공간입니다 — 해외 · 국내 원본 영상의 흐름을 보려고 지켜보는 남의 YouTube 채널이며, 여기 숫자는 그 원본 영상의 반응입니다. 우리 게시 계정은 「내 채널 · 연결」 에서 관리합니다.
      </StudioNotice>

      <StudioCard title="채널 찾기" description="그 나라 말로 분야를 검색해, 최근 조회수가 큰 쇼츠를 올린 채널을 묶어 보여 줍니다">
        <FormRow className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto]">
          <Field label="검색어 (그 나라 말로)">
            <Input value={disc.query} onChange={(e) => setDisc({ ...disc, query: e.target.value })} placeholder="예: satisfying product, 開封, 好物分享" onKeyDown={(e) => e.key === "Enter" && keyReady && disc.query.trim() && void discover()} />
          </Field>
          <Field label={`나라 · 언어 (${langLabel(languageOf(disc.country))})`}>
            <CountrySelect size="md" value={disc.country} allowEmpty={false} onChange={(v) => setDisc({ ...disc, country: v })} />
          </Field>
          <Field label="최근">
            <Select value={disc.days} onChange={(e) => setDisc({ ...disc, days: Number(e.target.value) })}>
              {[7, 14, 30].map((x) => (
                <option key={x} value={x}>
                  {x}일
                </option>
              ))}
            </Select>
          </Field>
          <FieldAction size="md">
            <Button icon={Search} onClick={() => void discover()} disabled={!keyReady || busy === "discover" || !disc.query.trim()}>
              {busy === "discover" ? "찾는 중…" : "채널 찾기"}
            </Button>
          </FieldAction>
        </FormRow>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-nd-fg-3">
          <span>
            검색 사용량 · {yt.source === "personal" ? "내 키" : yt.source === "company" ? "회사 키" : "키 없음"} 오늘{" "}
            <b className={`nd-num font-semibold ${yt.used >= yt.limit ? "text-nd-danger-text" : "text-nd-fg-2"}`}>
              {yt.used} / {yt.limit}회
            </b>
          </span>
          <span>한 번 찾을 때 1회 · 소재 발굴 · AI 레이더와 하루 한도를 함께 씁니다</span>
          <span>결과는 그 나라 쪽으로 기울인 표본이지 그 나라 전체 순위가 아닙니다</span>
        </p>
        {groups && (
          <div className="mt-4">
            {groups.length === 0 ? (
              <p className="text-nd-body text-nd-fg-3">표본에서 쇼츠를 찾지 못했습니다. 다른 말로 찾아 보세요.</p>
            ) : (
              <div className="overflow-hidden rounded-nd-md border border-nd-line max-md:border-0">
                <RecordTable rows={groups} columns={discCols} rowKey={(g) => g.channel.channelId} ariaLabel="찾은 채널" />
              </div>
            )}
          </div>
        )}
      </StudioCard>

      <StudioCard
        flush
        title={`감시 채널 · ${active}곳`}
        description={
          byCountry.length
            ? `${byCountry.map(([c, x]) => `${countryLabel(c)} ${x}`).join(" · ")} · 자동 추가 ${autoCount}곳${d.channels.length > active ? ` · 꺼 둔 채널 ${d.channels.length - active}곳` : ""}`
            : d.channels.length
              ? `꺼 둔 채널 ${d.channels.length}곳`
              : undefined
        }
        action={
          <>
            <Select className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="나라 거르기">
              <option value="">모든 나라</option>
              {COUNTRIES.filter((c) => d.channels.some((x) => x.country === c.code)).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              icon={RefreshCw}
              disabled={!keyReady || busy === "scan-all" || !d.channels.length}
              onClick={() =>
                void run("scan-all", async () => {
                  const r = await scout<{ scanned: { created: number }[]; skipped: number; stoppedBy: string | null }>("watch.scan", { force: true });
                  await refresh();
                  const made = r.scanned.reduce((x, y) => x + y.created, 0);
                  return `${r.scanned.length}곳 훑음 · 새로 터진 영상 ${made}편${r.skipped ? ` · 시간이 모자라 ${r.skipped}곳은 다음에` : ""}`;
                }).then((msg) => msg && toast.success(msg))
              }
            >
              {busy === "scan-all" ? "훑는 중…" : "모두 훑기"}
            </Button>
          </>
        }
      >
        <RecordTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          ariaLabel="감시 채널"
          rowClassName={(c) => (c.active ? undefined : "opacity-70")}
          className="pb-1 max-md:px-4 max-md:pb-4"
          empty={
            <p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">
              {d.channels.length ? "이 나라에 감시 중인 채널이 없습니다." : "감시 중인 채널이 없습니다."} 위에서 나라별로 채널을 찾아 넣거나 아래에서 직접 넣으세요. 나라마다 20~30곳이면 흐름이 보이기 시작합니다.
            </p>
          }
        />
      </StudioCard>

      <StudioCard title="감시 채널 직접 추가" description="채널 주소 · @핸들 · 그 채널 영상 주소">
        <FormRow className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_auto]">
          <Field label="채널 주소 · 아이디">
            <Input value={add.ref} onChange={(e) => setAdd({ ...add, ref: e.target.value })} placeholder="https://www.youtube.com/@… 또는 @핸들" />
          </Field>
          <Field label={`나라 · 언어 (${langLabel(languageOf(add.country))})`}>
            <CountrySelect size="md" value={add.country} allowEmpty={false} onChange={(v) => setAdd({ ...add, country: v })} />
          </Field>
          <Field label="주제 (쉼표로)">
            <Input value={add.topics} onChange={(e) => setAdd({ ...add, topics: e.target.value })} placeholder="살림, 수납" />
          </Field>
          <FieldAction size="md">
            <Button icon={Plus} disabled={!keyReady || !add.ref.trim() || busy === `add-${add.ref}`} onClick={() => void addChannel(add.ref, add.country, add.topics).then(() => setAdd({ ...add, ref: "" }))}>
              감시 채널 추가
            </Button>
          </FieldAction>
        </FormRow>
        <p className="mt-2 text-[13px] text-nd-fg-3">넣으면 바로 켜진 상태로 감시합니다 · 나라는 「어느 나라 흐름으로 볼까」 라서 채널의 실제 국적과 달라도 됩니다.</p>
      </StudioCard>

      {onOpenSettings && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-nd-md border border-nd-line bg-nd-content px-4 py-3">
          <p className="min-w-0 flex-1 basis-[260px] text-[14px] text-nd-fg-2">
            터진 영상 기준(평소의 {d.settings.threshold}배 · {fmtCount(d.settings.minViews)}회 이상 · {d.settings.maxAgeDays}일 안)과 자동 분석 하루 {d.settings.autoAnalyzePerDay}편은 자동 수집 「설정」 에서 바꿉니다.
          </p>
          <Button variant="secondary" icon={Settings2} onClick={onOpenSettings}>
            설정 열기
          </Button>
        </div>
      )}

      <CompareSheet channel={d.channels.find((c) => c.id === cmpId) ?? null} d={d} keyReady={keyReady} refresh={refresh} onClose={() => setCmpId(null)} />
    </div>
  );
}

/** 구독자처럼 「만」 단위로 줄여 보이는 숫자 — 숨기거나 모르면 「미확인」 */
function Count({ value, hiddenTitle }: { value: number | null | undefined; hiddenTitle: string }) {
  if (value === null || value === undefined) return <Unknown title={hiddenTitle} />;
  return (
    <span className="nd-num whitespace-nowrap" title={value.toLocaleString("ko-KR")}>
      {fmtCount(value)}
    </span>
  );
}

// ---- 터진 영상 vs 평소 (서랍) ---------------------------------------------------------
//  저장된 비교가 있으면 그것(누가 눌렀든 함께 본다), 없으면 계산만 먼저 받는다(watch.compare.preview — 읽기 · AI 안 부름).
//  AI 는 「비교하기」 를 눌렀을 때만 · 하루 상한은 프로젝트마다.

interface ComparePreview {
  calc: ChannelCompareCalc;
  blocked: string | null;
  used: number;
  limit: number;
}


/** 누르기 전 대략 비용 — 저장된 비교들의 실제 비용 평균, 없으면 실측 1번 값 */
function compareEstimateText(d: ScoutData): string {
  const costs = d.channels.flatMap((c) => (c.compare && c.compare.costUsd > 0 ? [c.compare.costUsd] : []));
  if (costs.length) return `약 ${wonOf(costs.reduce((a, b) => a + b, 0) / costs.length)} (지난 비교 ${costs.length}번 평균)`;
  return `약 ${wonOf(COMPARE_MEASURED_USD)} (실제 호출 2번으로 잰 값)`;
}

function CompareSheet({ channel, d, keyReady, refresh, onClose }: { channel: Watch | null; d: ScoutData; keyReady: boolean; refresh: () => Promise<void>; onClose: () => void }) {
  const { nameOf } = useShorts();
  const { busy, run } = useAction();
  const [preview, setPreview] = useState<{ id: string; res: ComparePreview } | null>(null);
  const [previewErr, setPreviewErr] = useState<{ id: string; msg: string } | null>(null);
  // 방금 비교한 결과 — 다시 받아 오기 전에도 바로 보이게
  const [fresh, setFresh] = useState<{ id: string; compare: ChannelCompare } | null>(null);
  const [usedNow, setUsedNow] = useState<number | null>(null);

  const id = channel?.id ?? null;
  const saved = channel ? (fresh?.id === channel.id ? fresh.compare : channel.compare ?? null) : null;
  const pv = preview && preview.id === id ? preview.res : null;
  const err = previewErr && previewErr.id === id ? previewErr.msg : null;
  const q = d.quotas.channelCompare;
  const used = usedNow ?? q?.used ?? null;
  const limit = q?.limit ?? CHANNEL_COMPARE_DAILY_LIMIT;
  const full = used !== null && used >= limit;

  const loadPreview = (cid: string) => {
    setPreviewErr(null);
    scout<ComparePreview>("watch.compare.preview", { id: cid })
      .then((r) => {
        setPreview({ id: cid, res: r });
        setUsedNow(r.used);
      })
      .catch((e) => setPreviewErr({ id: cid, msg: e instanceof Error ? e.message : "계산하지 못했습니다." }));
  };

  // 저장된 비교가 없는 채널을 열면 계산만 먼저 (YouTube 2단위 · search 한도와 무관)
  const hasSaved = !!saved;
  useEffect(() => {
    if (!id || hasSaved || !keyReady) return;
    loadPreview(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasSaved, keyReady]);

  const compare = (cid: string) =>
    run(`cmp-${cid}`, async () => {
      const r = await scout<{ compare: ChannelCompare; used: number; limit: number }>("watch.compare", { id: cid });
      setFresh({ id: cid, compare: r.compare });
      setUsedNow(r.used);
      await refresh();
    });

  const view: ChannelCompareCalc | null = saved ?? pv?.calc ?? null;
  const blocked = saved ? null : pv?.blocked ?? null;
  const running = !!id && busy === `cmp-${id}`;
  const costLine = <AiCostNote label="AI 비교" estimate={compareEstimateText(d)} used={used === null ? null : `${used}번`} cap={`${limit}번`} />;

  return (
    <Sheet open={!!channel} onClose={onClose} title="터진 영상 vs 평소" width={900} ariaLabel="터진 영상 vs 평소">
      {channel && (
        <div className="space-y-5 px-5 pb-8 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <ChannelAvatar src={channel.thumbnail} />
            <div className="min-w-0">
              <a href={`https://www.youtube.com/channel/${channel.channelId}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-[15px] font-semibold text-nd-fg hover:underline">
                <span className="truncate">{channel.title || channel.handle}</span>
                <ExternalLink size={13} className="shrink-0 text-nd-fg-3" aria-hidden />
              </a>
              <p className="text-[13px] text-nd-fg-3">같은 채널 안에서 견줍니다 — 구독자 · 주제가 같아 차이는 형식(제목 · 썸네일 · 길이 · 올린 때) 쪽에서 나옵니다.</p>
            </div>
          </div>

          {view ? (
            <>
              <CompareBasis c={view} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <VideoColumn title="터진 영상" hint={`평소의 ${view.threshold}배 이상 · 배수 큰 순`} items={view.hits} empty="이 기준을 넘은 영상이 없습니다" hot />
                <VideoColumn title="평소 영상" hint={`평소의 ${COMPARE_USUAL_MIN}~${COMPARE_USUAL_MAX}배 · 1배에 가까운 순`} items={view.usual} empty="평소 수준 영상이 없습니다" />
              </div>
              {/* 양쪽이 다 비면 계산표는 「—」 뿐이라 뺀다 (막힌 이유는 아래 AI 칸에) */}
              {(view.hits.length > 0 || view.usual.length > 0) && <CompareStatsTable hits={view.stats.hits} usual={view.stats.usual} limits={view.stats.limits} />}
            </>
          ) : err ? (
            <StudioNotice tone="danger" title="계산하지 못했습니다" action={<Button size="sm" variant="secondary" onClick={() => id && loadPreview(id)}>다시 시도</Button>}>
              {err}
            </StudioNotice>
          ) : !keyReady ? (
            <StudioNotice tone="warning" title="YouTube 키가 없습니다">
              최근 업로드를 받으려면 「내 채널 · 연결」 에서 개인 키를 넣거나 회사 키를 설정해 주세요.
            </StudioNotice>
          ) : (
            <LoadingState size="block" label="최근 쇼츠를 받아 계산하는 중…" />
          )}

          <section aria-label="AI 비교" className="space-y-3 rounded-nd-md border border-nd-line bg-nd-content p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" size="lg">
                <Sparkles size={13} aria-hidden /> AI 비교 · 가설
              </Badge>
              <span className="text-[13px] text-nd-fg-3">영상은 보지 않고 제목 · 썸네일 · 길이 · 올린 때 · 있는 분석 글로 비교합니다 — 원인을 확인한 것이 아닙니다.</span>
            </div>

            {saved ? (
              <CompareAiResult c={saved} />
            ) : (
              <p className="text-[14px] text-nd-fg-2">
                {blocked ? (
                  <span className="text-nd-warning-text">{blocked}</span>
                ) : (
                  "터진 쪽에만 있는 차이를 AI 가 찾고, 다음에 시험해 볼 것을 적습니다. 결과는 이 채널을 보는 사람 누구나 함께 봅니다."
                )}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-nd-line pt-3">
              <div className="min-w-0 flex-1 basis-[240px]">{costLine}</div>
              <Button
                icon={saved ? RefreshCw : Sparkles}
                variant={saved ? "secondary" : "primary"}
                disabled={!id || running || full || !keyReady || (!saved && (!pv || !!blocked))}
                title={full ? "오늘 상한에 닿았습니다" : blocked ?? undefined}
                onClick={() => id && void compare(id)}
              >
                {running ? "비교하는 중… (보통 15초 안팎)" : saved ? "다시 비교" : "비교하기"}
              </Button>
            </div>
            {saved && (
              <p className="text-[13px] text-nd-fg-3">
                {fmtDay(saved.at, true)} · {saved.by === d.me ? "내가 비교" : `${nameOf(saved.by)} 비교`} · {saved.model} · <AiWon usd={saved.costUsd} className="font-medium" />
                {" "}· 다시 비교하면 그때의 최근 쇼츠로 새로 계산합니다
              </p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

/** 판정 기준 한 줄 — 평소 n회 · 터짐 = 평소의 k배 이상 · 최근 쇼츠 m편 중 */
function CompareBasis({ c }: { c: ChannelCompareCalc }) {
  return (
    <p className="rounded-nd-md bg-nd-sunken px-4 py-3 text-[14px] leading-relaxed text-nd-fg-2">
      <b className="font-semibold text-nd-fg">판정 기준</b>
      <span className="text-nd-fg-3"> · </span>
      평소 {c.baseline === null ? "모름" : <b className="nd-num font-semibold text-nd-fg">{fmtCount(Math.round(c.baseline))}회</b>}
      {c.baselineBasis === "young" ? " (어림)" : ""} · 터짐 = 평소의 <b className="nd-num font-semibold text-nd-fg">{c.threshold}배</b> 이상 · 조회 {fmtCount(c.minViews)}회 이상 · 올린 지 {COMPARE_MIN_AGE_DAYS}일 넘은 최근 쇼츠{" "}
      <b className="nd-num font-semibold text-nd-fg">{c.pool}편</b> 중
      {c.young > 0 && <span className="text-nd-fg-3"> · 올린 지 {COMPARE_MIN_AGE_DAYS}일 안 {c.young}편은 조회수가 차는 중이라 뺐습니다</span>}
    </p>
  );
}

function VideoColumn({ title, hint, items, empty, hot = false }: { title: string; hint: string; items: CompareVideo[]; empty: string; hot?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-nd-md border p-3", hot ? "border-nd-accent/40 bg-nd-accent/[.04]" : "border-nd-line")}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 px-1">
        <h3 className="text-[15px] font-semibold text-nd-fg">
          {title} <span className="nd-num font-normal text-nd-fg-3">· {items.length}편</span>
        </h3>
        <span className="text-[13px] text-nd-fg-3">{hint}</span>
      </div>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((v) => (
            <li key={v.id}>
              <a href={v.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-3 rounded-nd-sm p-1.5 hover:bg-nd-sunken" title={`${v.title} — 유튜브에서 열기`}>
                <VideoThumb src={v.thumbnail} duration={v.duration} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[14px] font-medium leading-snug text-nd-fg">{v.title || "(제목 없음)"}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-nd-fg-3">
                    <Multiple value={v.multiple} className={hot ? undefined : "font-medium text-nd-fg-2"} />
                    <span>· 조회 {fmtCount(v.views)}</span>
                    <span title={fmtDate(v.publishedAt)}>· {fmtAgo(v.publishedAt)}</span>
                    {v.analyzed && <span>· 형식 분석 있음</span>}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 py-3 text-[14px] text-nd-fg-3">{empty}</p>
      )}
    </div>
  );
}

/** k/n편 (p%) — 편수가 0 이면 「—」 */
const share = (k: number, n: number) => (n ? `${k}/${n}편 (${fmtPct(k / n, 0)})` : "—");
const spread = (counts: number[], labels: readonly string[]) => {
  const parts = counts.flatMap((x, i) => (x ? [`${labels[i]} ${x}`] : []));
  return parts.length ? parts.join(" · ") : "—";
};

function CompareStatsTable({ hits, usual, limits }: { hits: CompareGroupStats; usual: CompareGroupStats; limits: string[] }) {
  const rows: [string, (s: CompareGroupStats) => string][] = [
    ["편수", (s) => `${s.n}편`],
    ["조회수 중앙값", (s) => fmtCount(s.medianViews === null ? null : Math.round(s.medianViews))],
    ["길이 중앙값", (s) => fmtSec(s.medianSec)],
    ["제목 글자 수 중앙값", (s) => (s.medianTitleLen === null ? "—" : `${s.medianTitleLen}자`)],
    ["제목에 숫자", (s) => share(s.withNumber, s.n)],
    ["제목에 물음표", (s) => share(s.withQuestion, s.n)],
    ["제목에 해시태그", (s) => share(s.withHashtag, s.n)],
    ["제목에 이모지", (s) => share(s.withEmoji, s.n)],
    ["올린 요일 (한국)", (s) => spread(s.weekdays, WEEKDAYS_KO)],
    ["올린 시간대 (한국)", (s) => spread(s.bands, TIME_BANDS)],
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" size="lg">
          계산
        </Badge>
        <span className="text-[13px] text-nd-fg-3">YouTube 공개 숫자로 그대로 셈한 값 · 시간대 새벽 0~6시 · 오전 6~12시 · 오후 12~18시 · 저녁 18~24시</span>
      </div>
      <div className="overflow-hidden rounded-nd-md border border-nd-line">
        <TableScroll>
          <Table size="md" minWidth={340}>
            <thead>
              <tr>
                <Th>항목</Th>
                <Th>터진 영상</Th>
                <Th>평소 영상</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label}>
                  <Td className="whitespace-nowrap text-nd-fg-2">{label}</Td>
                  <Td className="nd-num">{f(hits)}</Td>
                  <Td className="nd-num">{f(usual)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      {limits.length > 0 && (
        <ul className="space-y-1">
          {limits.map((l) => (
            <li key={l} className="text-[13px] font-medium text-nd-warning-text">
              주의 · {l}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompareAiResult({ c }: { c: ChannelCompare }) {
  const byId = new Map([...c.hits, ...c.usual].map((v) => [v.id, v]));
  const { differences, tryNext, caveat } = c.ai;
  return (
    <div className="space-y-4">
      {differences.length ? (
        <ol className="space-y-2.5">
          {differences.map((x, i) => (
            <li key={i} className="rounded-nd-md border border-nd-line p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="lg">
                  {COMPARE_ASPECT_LABEL[x.aspect] ?? "기타"}
                </Badge>
                <span title={x.strength === "clear" ? "터진 쪽 대부분에 있고 평소 쪽 대부분에 없다고 AI 가 본 차이" : "일부에서만 보이거나 반례가 있는 차이"} className="inline-flex">
                  <Badge tone={x.strength === "clear" ? "success" : "warning"} size="lg">
                    {COMPARE_STRENGTH_LABEL[x.strength] ?? "약함"}
                  </Badge>
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-nd-fg">
                <b className="font-semibold">터진 쪽</b>
                <span className="text-nd-fg-3"> · </span>
                {x.hit}
              </p>
              {x.usual && (
                <p className="mt-1 text-[14px] leading-relaxed text-nd-fg-2">
                  <b className="font-semibold">평소 쪽</b>
                  <span className="text-nd-fg-3"> · </span>
                  {x.usual}
                </p>
              )}
              {(x.hitIds.length > 0 || x.usualIds.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Evidence label="터진" ids={x.hitIds} byId={byId} />
                  <Evidence label="평소" ids={x.usualIds} byId={byId} />
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[14px] text-nd-fg-3">AI 가 뚜렷한 차이를 찾지 못했습니다.</p>
      )}
      {tryNext.length > 0 && (
        <div>
          <h4 className="text-[14px] font-semibold text-nd-fg">다음에 시험할 것</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-nd-fg-2">
            {tryNext.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {caveat && (
        <p className="text-[14px] leading-relaxed text-nd-fg-2">
          <b className="font-semibold text-nd-warning-text">주의</b>
          <span className="text-nd-fg-3"> · </span>
          {caveat}
        </p>
      )}
    </div>
  );
}

/** 근거 영상 썸네일 (작게) — 누르면 유튜브 */
function Evidence({ label, ids, byId }: { label: string; ids: string[]; byId: Map<string, CompareVideo> }) {
  const list = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] text-nd-fg-3">근거 · {label}</span>
      {list.map((v) => (
        <a key={v.id} href={v.url} target="_blank" rel="noreferrer" title={`${v.title} · ${v.multiple}배`} className="rounded-nd-sm outline-offset-2 hover:opacity-80">
          <VideoThumb src={v.thumbnail} className="h-9 w-16" />
        </a>
      ))}
    </span>
  );
}
