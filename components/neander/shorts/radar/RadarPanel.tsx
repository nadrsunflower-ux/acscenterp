"use client";

// ============================================================
//  AI 레이더 — 소재 발굴 맨 위. 매일 아침 키워드로 훑은 「반응 큰 상품 후보」
// ------------------------------------------------------------
//  회사 공용 목록이다. 숫자는 YouTube API(출처 「API」), 상품은 AI 추정(영상을 보지 않고 글로),
//  국내 추세는 네이버 데이터랩 상대값. 「소재로 저장」 하면 내 소재(비공개)가 된다.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, ChevronDown, Clapperboard, ExternalLink, EyeOff, Radar, RotateCcw } from "lucide-react";
import { Badge, Button, Card, Disclosure, EmptyState, Field, FormRow, InlineNotice, NumberInput, SectionHeader, Switch, Tabs, Textarea, cn, type Tone } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, SourceTag, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { Ago, Multiple, VideoThumb } from "@/components/neander/shorts/scout/bits";
import { mutate, shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { NAVER_LABEL, groupRadar, krwOf, type NaverTrend, type RadarDoc, type RadarRunSummary, type RadarSettings } from "@/lib/neander/shorts/radar";

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

export function RadarPanel() {
  const { refresh: refreshShorts } = useShorts();
  const router = useRouter();
  const { busy, run } = useAction();
  const [data, setData] = useState<RadarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "saved" | "out">("new");
  const [limit, setLimit] = useState(12);

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
  const groups = useMemo(() => groupRadar(lists[tab]), [lists, tab]);

  const save = async (i: Item) => {
    const r = await shortsPost<{ trendId: string }>("radar", { action: "save", id: i.id });
    await Promise.all([load(), refreshShorts()]);
    return r.trendId;
  };

  if (error) return <InlineNotice tone="danger" className="mb-8">{error}</InlineNotice>;
  if (!data) return <p className="mb-8 text-nd-body text-nd-fg-3">AI 레이더를 불러오는 중…</p>;
  const { last, today, ready, settings } = data;

  return (
    <section className="mb-10">
      <SectionHeader
        size="lg"
        title="AI 레이더"
        hint={`매일 아침 ${settings.keywords.length}개 검색어로 최근 ${settings.days}일 쇼츠를 훑어, 반응이 큰 상품 후보를 모읍니다`}
        action={
          <Button
            size="sm"
            icon={Radar}
            disabled={!ready.youtube || busy === "run"}
            onClick={() =>
              void run(
                "run",
                async () => {
                  const r = await shortsPost<{ summary: RadarRunSummary }>("radar", { action: "run" });
                  await load();
                  return r;
                },
                "레이더를 돌렸습니다.",
              )
            }
          >
            {busy === "run" ? "훑는 중… (1~2분)" : "지금 돌리기"}
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-nd-fg-2">
        <span>
          마지막 실행 {last ? fmtWhen(last.at) : "없음"}
          {last && ` · 검색 ${last.searched}회 · 후보 ${last.found}편(새로 ${last.created}) · AI ${last.aiCalls}번 ${krwOf(last.aiUsd).toLocaleString("ko-KR")}원 · 네이버 ${last.naverCalls}회`}
        </span>
        <span>
          오늘 AI {today.spentKrw.toLocaleString("ko-KR")} / {today.budgetKrw.toLocaleString("ko-KR")}원 · 오늘 YouTube 검색 {today.searchUsed} / {today.searchLimit}회 (소재 발굴과 함께)
        </span>
      </div>
      {!ready.youtube && <InlineNotice tone="warning" className="mb-3">회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없어 레이더를 돌릴 수 없습니다.</InlineNotice>}
      {ready.youtube && !ready.ai && <InlineNotice tone="warning" className="mb-3">OPENROUTER_API_KEY 가 없어 AI 상품 추정 없이 숫자만 모읍니다.</InlineNotice>}
      {ready.youtube && !ready.naver && (
        <InlineNotice tone="info" className="mb-3">네이버 데이터랩 키(NAVER API HUB 의 Client ID · Secret → NEANDER_SHORTS_NAVER_CLIENT_ID · _SECRET)를 넣으면 후보마다 국내 검색 추세가 붙습니다.</InlineNotice>
      )}
      {last && last.notes.some((n) => !/키가 없어/.test(n)) && (
        <ul className="mb-3 space-y-0.5 text-[13px] text-nd-warning-text">
          {last.notes.filter((n) => !/키가 없어/.test(n)).map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}

      <Tabs
        className="mb-4"
        ariaLabel="레이더 목록"
        value={tab}
        onChange={(k) => {
          setTab(k as typeof tab);
          setLimit(12);
        }}
        items={[
          { key: "new", label: "새 후보", hint: String(lists.new.length) },
          { key: "saved", label: "내가 저장한 것", hint: String(lists.saved.length) },
          { key: "out", label: "제외 · 무관", hint: String(lists.out.length) },
        ]}
      />

      {groups.length === 0 ? (
        <EmptyState
          compact
          icon={Radar}
          title={tab === "new" ? (last ? "새 후보가 없습니다" : "아직 돌린 적이 없습니다") : "없습니다"}
          description={
            tab === "new"
              ? last
                ? "내일 아침 다시 훑습니다. 검색어를 바꾸려면 아래 설정을 여세요."
                : `「지금 돌리기」 를 누르면 YouTube 검색 ${settings.maxSearchesPerRun}회와 AI 수십 원 안쪽으로 첫 후보를 모읍니다. 매일 아침에는 저절로 돕니다.`
              : undefined
          }
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {groups.slice(0, limit).map((g) => (
            <RadarCard
              key={g.key}
              items={g.items}
              me={data.me}
              busy={busy}
              onSave={(i) => void run(`save-${i.id}`, () => save(i), "내 소재로 저장했습니다 — 아래 「저장한 소재」 에 있습니다.")}
              onMake={(i) =>
                void run(`make-${i.id}`, async () => {
                  const trendId = await save(i);
                  const r = await mutate<{ id: string }>("trend.toProject", { id: trendId, visibility: "private" });
                  await refreshShorts();
                  router.push(`/neander/shorts/projects/${r.id}`);
                })
              }
              onDismiss={(i, dismissed) =>
                void run(`dis-${i.id}`, async () => {
                  await shortsPost("radar", { action: "dismiss", id: i.id, dismissed });
                  await load();
                })
              }
            />
          ))}
        </div>
      )}
      {groups.length > limit && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" icon={ChevronDown} onClick={() => setLimit(limit + 12)}>
            {groups.length - limit}묶음 더 보기
          </Button>
        </div>
      )}

      <Disclosure className="mt-6" title="레이더 설정 · 점수 산식" meta={<span className="text-[13px]">{settings.enabled ? "매일 아침 자동" : "자동 꺼짐"} · AI 하루 {settings.aiBudgetKrw.toLocaleString("ko-KR")}원까지</span>}>
        <RadarSettingsForm settings={settings} admin={data.admin} onSaved={load} />
      </Disclosure>
    </section>
  );
}

function RadarCard({
  items,
  me,
  busy,
  onSave,
  onMake,
  onDismiss,
}: {
  items: Item[];
  me: string;
  busy: string | null;
  onSave: (i: Item) => void;
  onMake: (i: Item) => void;
  onDismiss: (i: Item, dismissed: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const i = items[0];
  const ai = i.ai;
  const saved = i.saved.some((s) => s.by === me);
  const rate = i.info && i.info.sampled > 0 ? i.info.matched / i.info.sampled : null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex gap-3">
        <a href={i.url} target="_blank" rel="noreferrer" className="shrink-0">
          <VideoThumb src={i.thumbnail} duration={i.duration} className="h-[90px] w-40" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {ai?.product ? (
              <>
                <span className="text-[15px] font-semibold">{ai.product}</span>
                <Badge size="sm" tone="accent">
                  <span title={`AI 추정 — 영상을 보지 않고 제목 · 설명 · 태그 · 댓글 글로 추정했습니다. 근거: ${ai.evidence}`}>AI 추정{ai.confidence === "unclear" ? " · 확실치 않음" : ""}</span>
                </Badge>
              </>
            ) : (
              <span className="text-[15px] font-semibold text-nd-fg-2" title={ai ? `AI 근거: ${ai.evidence}` : undefined}>
                {ai ? (/여러 상품/.test(ai.evidence) ? "여러 상품 모음 — 영상에서 직접 확인" : "상품을 글로는 알 수 없음 — 영상에서 직접 확인") : "AI 추정 전"}
              </span>
            )}
            {ai && ai.category !== "기타" && <Badge size="sm">{ai.category}</Badge>}
            {i.naver && (
              <Badge size="sm" tone={NAVER_TONE[i.naver.label]}>
                <span title={`네이버 데이터랩 검색어 트렌드 (${i.naver.keywords.join(", ")}) — 최근 2주 평균 ÷ 그 전 6주 평균 (상대값). 「검색 적음」 은 데이터랩 기준이며 국내에 없다는 뜻이 아닙니다.`}>
                  {NAVER_LABEL[i.naver.label]}
                  {i.naver.change !== null && i.naver.label !== "steady" ? ` ×${i.naver.change}` : ""}
                </span>
              </Badge>
            )}
            <span className="ml-auto text-[13px] text-nd-fg-3" title="점수 = 평소 대비 배수 40 + 하루 조회 속도 40 + 정보 요청 댓글 20 (모르면 0)">
              점수 <b className="nd-num text-nd-fg">{i.score}</b>
            </span>
          </div>
          <a href={i.url} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-2 text-nd-body hover:underline">
            {i.title} <ExternalLink size={12} className="inline align-[-1px] text-nd-fg-3" />
          </a>
          <p className="text-[13px] text-nd-fg-3">
            {i.channel} · <Ago iso={i.publishedAt} />
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-nd-fg-2">
        <span className="inline-flex items-center gap-1">
          조회 <b className="nd-num text-nd-fg"><Num value={i.views} /></b> <SourceTag src="api" title={`YouTube Data API · ${fmtWhen(i.viewsAt)}`} />
        </span>
        <span title={i.baseline !== null ? `채널 평소 = 최근 쇼츠 조회수 중앙값 ${i.baseline.toLocaleString("ko-KR")}회` : "채널 평소 조회수를 못 봤습니다"}>
          평소의 <Multiple value={i.multiple} />
        </span>
        <span title={i.velocityBasis === "history" ? "두 번 본 사이의 실제 증가" : "올린 뒤 평균 (최근 속도가 아님)"}>
          하루 {i.velocityPerDay === null ? <Unknown /> : <b className="nd-num text-nd-fg">+{i.velocityPerDay.toLocaleString("ko-KR")}</b>}
          {i.velocityBasis === "since_publish" && <span className="text-nd-fg-3"> (평균)</span>}
        </span>
        <span title={i.info ? `댓글 ${i.info.sampled}개 중 「어디서 사요 · 링크 · 정보」 류 ${i.info.matched}개` : "댓글 표본을 아직 안 읽었습니다"}>
          정보 요청 {rate === null ? <Unknown /> : <b className="nd-num text-nd-fg">{Math.round(rate * 100)}%</b>}
        </span>
      </div>

      {ai && (ai.why || ai.caution) && (
        <div className="space-y-0.5 text-[13px] leading-relaxed">
          {ai.why && <p className="text-nd-fg-2">왜 먹혔나 (추정): {ai.why}</p>}
          {ai.hook && <p className="text-nd-fg-3">훅 (추정): {ai.hook}</p>}
          {ai.caution && <p className="text-nd-warning-text">주의: {ai.caution}</p>}
        </div>
      )}

      {items.length > 1 && (
        <div className="text-[13px]">
          <button type="button" className="text-nd-accent hover:underline" onClick={() => setOpen(!open)}>
            같은 상품 영상 {items.length}편 {open ? "접기" : "보기"}
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-nd-fg-2">
              {items.slice(1).map((x) => (
                <li key={x.id} className="truncate">
                  <a href={x.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {x.title}
                  </a>{" "}
                  <span className="text-nd-fg-3">· {x.channel} · 조회 {x.views?.toLocaleString("ko-KR") ?? "—"} · 평소의 {x.multiple ?? "?"}배</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={cn("flex flex-wrap gap-2", "border-t border-nd-line pt-3")}>
        {saved ? (
          <Badge tone="success">내 소재로 저장함</Badge>
        ) : (
          <Button size="sm" variant="secondary" icon={BookmarkPlus} disabled={busy === `save-${i.id}`} onClick={() => onSave(i)}>
            소재로 저장
          </Button>
        )}
        <Button size="sm" icon={Clapperboard} disabled={busy === `make-${i.id}`} onClick={() => onMake(i)}>
          영상 만들기
        </Button>
        {i.dismissed ? (
          <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy === `dis-${i.id}`} onClick={() => onDismiss(i, false)}>
            되살리기
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={EyeOff} disabled={busy === `dis-${i.id}`} onClick={() => onDismiss(i, true)}>
            제외
          </Button>
        )}
        {i.dismissed && <span className="self-center text-[13px] text-nd-fg-3">제외함 · {fmtWhen(i.dismissed.at)}</span>}
        {!i.dismissed && ai?.relevant === false && <span className="self-center text-[13px] text-nd-fg-3">AI 가 살림 상품 영상이 아니라고 봄</span>}
      </div>
    </Card>
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
