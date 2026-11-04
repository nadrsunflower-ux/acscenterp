"use client";

// ============================================================
//  터진 영상 — 감시 채널에서 평소의 몇 배로 터진 쇼츠 + 직접 등록한 해외 영상. (2026-11-04 목업 09-scout-hits)
// ------------------------------------------------------------
//  AI 가 영상을 직접 보고 형식을 뽑으면, 사람이 형식 카드에 묶는다.
//  하위 거르기 4개(묶기 전 · 형식에 묶음 · 제외 · 전체) → 나라 · 정렬 · 영상 등록 · 쇼츠처럼 보기 → 표(모바일 카드)
//  → 분석 비용(한 편 예상 · 오늘 누적 · 자동 분석 하루 상한).
//  숫자는 모두 원본(남의 채널) 영상의 반응이다 — 우리 영상 성과가 아니다.
// ============================================================
import { useMemo, useState } from "react";
import { ExternalLink, Flame, PanelRightOpen, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  InlineNotice,
  Input,
  NumberInput,
  Select,
  Textarea,
  useConfirm,
} from "@/components/neander/ui";
import { Num, SourceTag, Unknown, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, RecordTable, StudioCard, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { CutsButton } from "@/components/neander/shorts/cuts/CutSheet";
import { PLATFORM_LABEL, fmtCount, platformFromUrl } from "@/lib/neander/shorts/model";
import { COUNTRIES, RISK_LABEL, countryLabel, hitNoteState, type HitDoc } from "@/lib/neander/shorts/scout";
import type { ScoutAutoSummary } from "@/lib/neander/shorts/scout-auto";
import { Ago, AiBadge, AiWon, CountrySelect, CountryText, FilterPills, LangBadge, Multiple, VideoThumb, fmtDate, langLabel } from "./bits";
import { analysisEstimateText, todayAi } from "./AutoPanel";
import { ScoutFeed } from "./ScoutFeed";
import { scout, type ScoutData, type WithId } from "./useScout";

type Filter = "new" | "assigned" | "dismissed" | "all";
type Hit = WithId<HitDoc>;

/** 비율 — 0 도 「0%」 로 (fmtPct 는 0 을 빈 글자로 줄인다) */
const pctOf = (k: number, n: number) => `${Math.round((k / n) * 100)}%`;

/** 한 번에 그리는 줄 수 — 많으면 「더 보기」 */
const PAGE = 40;

/** 한글 댓글 — 「2 / 표본 30」 (0 도 0 으로). 아직 안 읽었으면 미확인 */
function KoreanComments({ h }: { h: Hit }) {
  const kc = h.koreanComments;
  if (kc && kc.sampled > 0)
    return (
      <span className="nd-num" title={`댓글 표본 ${kc.sampled}개 중 한글 댓글 ${kc.korean}개 (${pctOf(kc.korean, kc.sampled)}) — 한국 사람이 이미 보고 있나`}>
        한글 댓글 {kc.korean} / 표본 {kc.sampled}
      </span>
    );
  if (kc) return <span className="text-nd-fg-3">한글 댓글 표본 없음</span>;
  if (h.platform !== "youtube") return <span className="text-nd-fg-3" title="YouTube 영상만 댓글 표본을 읽습니다">한글 댓글 —</span>;
  return (
    <span>
      한글 댓글 <Unknown title="댓글 표본을 아직 읽지 않았습니다" />
    </span>
  );
}

export function HitsTab({ d, refresh, onOpenFormat, last }: { d: ScoutData; refresh: () => Promise<void>; onOpenFormat: (id: string) => void; last?: ScoutAutoSummary | null }) {
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<Filter>("new");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<"multiple" | "found" | "published">("multiple");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const formatName = useMemo(() => new Map(d.formats.map((f) => [f.id, f.name])), [d.formats]);

  const rows = useMemo(() => {
    const list = d.hits.filter((h) => (filter === "all" ? true : h.status === filter) && (!country || h.country === country));
    return list.sort((a, b) =>
      sort === "multiple" ? (b.multiple ?? -1) - (a.multiple ?? -1) : sort === "found" ? b.createdAt - a.createdAt : Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"),
    );
  }, [d.hits, filter, country, sort]);
  const count = (f: Filter) => d.hits.filter((h) => (f === "all" ? true : h.status === f)).length;
  const hit = open ? d.hits.find((h) => h.id === open) ?? null : null;
  const estimate = analysisEstimateText(d);
  const today = todayAi(d, last ?? null);
  const shown = rows.slice(0, limit);

  const analyze = (h: Hit) =>
    void run(
      `an-${h.id}`,
      async () => {
        await scout("hit.analyze", { id: h.id });
        await refresh();
      },
      "AI 가 영상을 보고 형식을 뽑았습니다.",
    );

  const columns: RecordColumn<Hit>[] = [
    {
      key: "video",
      header: "영상 · 나라",
      mobile: "title",
      className: "w-[34%] min-w-[300px] max-w-0",
      cell: (h) => (
        <button type="button" className="group flex w-full min-w-0 items-center gap-3 text-left" onClick={() => setOpen(h.id)} title={h.title || h.url}>
          <VideoThumb src={h.thumbnail} duration={h.duration} label={PLATFORM_LABEL[h.platform]} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-nd-fg group-hover:underline">{h.title || h.url}</span>
            <span className="block truncate text-[13px] font-normal text-nd-fg-2">{h.channel || "채널 모름"}</span>
            <span className="block truncate text-[13px] font-normal text-nd-fg-3">
              <CountryText codes={[h.country]} /> · {langLabel(h.language)} · <Ago iso={h.publishedAt} /> · {h.found === "manual" ? "직접 등록" : "감시 채널에서 찾음"}
              {h.platform !== "youtube" ? ` · ${PLATFORM_LABEL[h.platform]}` : ""}
            </span>
          </span>
        </button>
      ),
    },
    {
      key: "views",
      header: "조회 · 평소",
      align: "right",
      cell: (h) => (
        <span className="inline-flex flex-col items-end">
          <Num value={h.views.v} />
          <span className="text-[13px] text-nd-fg-3" title={h.baseline.ref}>
            평소 {h.baseline.v === null ? <Unknown title="그 채널 평소 조회수를 모릅니다" /> : fmtCount(Math.round(h.baseline.v))}
          </span>
        </span>
      ),
    },
    { key: "mult", header: "배수", align: "right", cell: (h) => <Multiple value={h.multiple} className="text-[15px]" /> },
    {
      key: "react",
      header: "반응",
      cell: (h) => (
        <span className="inline-flex flex-col items-end text-[14px] md:items-start">
          <span>
            좋아요 <Num value={h.likes.v} />
          </span>
          <span className="text-[13px] text-nd-fg-3">
            <KoreanComments h={h} />
          </span>
        </span>
      ),
    },
    {
      key: "ai",
      header: "AI 형식 분석",
      className: "min-w-[200px] max-w-[260px]",
      cell: (h) => {
        const suggestion = !h.formatId && h.analysis?.match.formatId ? formatName.get(h.analysis.match.formatId) : null;
        return (
          <span className="flex min-w-0 flex-col items-end gap-1 md:items-start">
            {h.formatId ? (
              <>
                <Badge tone="success" size="lg">
                  형식에 묶음
                </Badge>
                <button type="button" className="block max-w-full truncate text-left text-[13px] font-medium text-nd-accent hover:underline" title={formatName.get(h.formatId) ?? "(지워진 카드)"} onClick={() => onOpenFormat(h.formatId as string)}>
                  {formatName.get(h.formatId) ?? "(지워진 카드)"}
                </button>
              </>
            ) : h.analysis ? (
              <>
                <Badge tone={suggestion ? "info" : "success"} size="lg">
                  {suggestion ? "기존 형식 제안" : "분석 완료"}
                </Badge>
                <span className="block max-w-full truncate text-[13px] text-nd-fg-2" title={h.analysis.summary}>
                  {suggestion ?? `새 형식? ${h.analysis.formatName}`}
                </span>
                <span className="text-[13px] text-nd-fg-3">
                  분석 <AiWon usd={h.analysis.costUsd} className="font-normal" />
                </span>
              </>
            ) : h.platform === "youtube" ? (
              <>
                <Badge tone="neutral" size="lg">
                  분석 대기
                </Badge>
                <span className="text-[13px] text-nd-fg-3">영상 분석 예상 {estimate}</span>
              </>
            ) : (
              <>
                <Badge tone="neutral" size="lg">
                  AI 분석 불가
                </Badge>
                <span className="text-[13px] text-nd-fg-3">YouTube 영상만 · 직접 적어 묶기</span>
              </>
            )}
            {h.status === "dismissed" && (
              <Badge tone="neutral" size="lg">
                제외함
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      key: "act",
      header: "작업",
      align: "right",
      mobileLabel: "작업",
      cell: (h) => (
        <span className="flex flex-wrap justify-end gap-1.5">
          {!h.analysis && h.platform === "youtube" && (
            <Button variant="secondary" icon={Sparkles} loading={busy === `an-${h.id}`} disabled={busy === `an-${h.id}`} onClick={() => analyze(h)} title={`AI 가 영상을 직접 보고 형식을 뽑습니다 · 예상 ${estimate}`}>
              {busy === `an-${h.id}` ? "보는 중…" : "분석"}
            </Button>
          )}
          <Button variant="secondary" icon={PanelRightOpen} onClick={() => setOpen(h.id)}>
            자세히 · 묶기
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterPills
        ariaLabel="상태로 거르기"
        value={filter}
        onChange={(k) => {
          setFilter(k);
          setLimit(PAGE);
        }}
        items={[
          { key: "new", label: "묶기 전", count: count("new") },
          { key: "assigned", label: "형식에 묶음", count: count("assigned") },
          { key: "dismissed", label: "제외", count: count("dismissed") },
          { key: "all", label: "전체", count: count("all") },
        ]}
      />

      <FormRow className="grid-cols-2 sm:grid-cols-[minmax(0,180px)_minmax(0,200px)_auto_auto_minmax(0,1fr)]">
        <Field label="나라">
          <Select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setLimit(PAGE);
            }}
          >
            <option value="">전체</option>
            {COUNTRIES.filter((c) => d.hits.some((h) => h.country === c.code)).map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="정렬">
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="multiple">평소 대비 큰 순</option>
            <option value="found">찾은 순</option>
            <option value="published">올린 순</option>
          </Select>
        </Field>
        <FieldAction size="md">
          <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
            영상 등록
          </Button>
        </FieldAction>
        <FieldAction size="md">
          <ScoutFeed d={d} hits={rows} refresh={refresh} onOpenFormat={onOpenFormat} onDetail={(id) => setOpen(id)} size="md" />
        </FieldAction>
      </FormRow>

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Flame}
          title={filter === "new" ? "묶을 영상이 없습니다" : "영상이 없습니다"}
          description="감시 채널을 훑으면 평소보다 크게 터진 쇼츠가 여기 모입니다. 틱톡 · 더우인 · 인스타에서 본 영상은 「영상 등록」 으로 넣으세요."
          action={
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
              영상 등록
            </Button>
          }
        />
      ) : (
        <StudioCard flush title={`터진 영상 · ${rows.length.toLocaleString("ko-KR")}편`} description="조회 · 배수는 원본 영상(남의 채널)의 공개 반응입니다 — 우리 영상 성과가 아닙니다">
          <RecordTable
            rows={shown}
            columns={columns}
            rowKey={(h) => h.id}
            ariaLabel="터진 영상"
            rowClassName={(h) => (h.status === "dismissed" ? "opacity-70" : undefined)}
            className="max-md:px-4 max-md:pb-4"
          />
          {rows.length > shown.length && (
            <div className="flex justify-center border-t border-nd-line px-5 py-3">
              <Button variant="secondary" onClick={() => setLimit((x) => x + PAGE)}>
                {Math.min(PAGE, rows.length - shown.length)}편 더 보기 · 남은 {rows.length - shown.length}편
              </Button>
            </div>
          )}
        </StudioCard>
      )}

      <StudioNotice tone="info" title="분석 비용">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>영상 분석 한 편 예상 {estimate}</span>
          <span>
            오늘 AI 누적 약 <AiWon usd={today.usd} className="font-medium" /> (기록 기준)
          </span>
          <AiCostNote
            label="자동 분석"
            used={d.settings.autoAnalyzePerDay > 0 ? `${d.quotas.autoAnalyzeToday}편` : null}
            cap={d.settings.autoAnalyzePerDay > 0 ? `${d.settings.autoAnalyzePerDay}편` : "꺼짐"}
          />
        </span>
        <span className="mt-1 block">
          직접 누르는 분석은 하루 상한 없이 돌고, 매일 아침 자동 분석만 하루 편수 상한을 씁니다. 결과는 AI 의 관찰 · 가설이니 직접 확인한 뒤 형식에 묶으세요. 배수 = 조회 ÷ 그 채널 평소 조회수(최근 쇼츠 중앙값) · 직접 등록한 영상의 숫자는 사람이 보고 적은 값입니다.
        </span>
      </StudioNotice>

      {hit && <HitDialog d={d} hit={hit} refresh={refresh} onClose={() => setOpen(null)} onOpenFormat={onOpenFormat} />}
      {adding && <AddHitDialog keyReady={!!d.quotas.youtubeSearch.source} refresh={refresh} onClose={() => setAdding(false)} onAdded={(id) => setOpen(id)} />}
    </div>
  );
}

// ---- 영상 하나 ---------------------------------------------------------------

export function HitDialog({ d, hit: h, refresh, onClose, onOpenFormat }: { d: ScoutData; hit: WithId<HitDoc>; refresh: () => Promise<void>; onClose: () => void; onOpenFormat: (id: string) => void }) {
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [model, setModel] = useState(d.models[0]?.id ?? "");
  const [pick, setPick] = useState(h.formatId ?? h.analysis?.match.formatId ?? "");
  const [note, setNote] = useState(h.note);
  const a = h.analysis;
  const formats = d.formats.filter((f) => !f.archived);
  const suggested = a?.match.formatId ? d.formats.find((f) => f.id === a.match.formatId) : null;

  const act = (key: string, action: string, body: object, ok?: string) =>
    run(key, async () => {
      await scout(action, { id: h.id, ...body });
      await refresh();
    }, ok);
  // 분석 — 고치던 메모가 아직 안 저장됐으면 먼저 저장하고 본다 (AI 가 새 메모를 읽게)
  const analyze = () =>
    run(
      "an",
      async () => {
        if (note !== h.note) await scout("hit.update", { id: h.id, patch: { note } });
        await scout("hit.analyze", { id: h.id, model });
        await refresh();
      },
      note.trim() ? "메모를 참고해 AI 가 영상을 다시 봤습니다." : "AI 가 영상을 보고 형식을 뽑았습니다.",
    );
  const noteState = hitNoteState({ note, analysis: a });

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={h.title || "영상"}
      description={`${PLATFORM_LABEL[h.platform]} · ${h.channel || "채널 모름"} · ${h.found === "scan" ? `감시 채널 훑기 ${fmtWhen(h.createdAt)}` : `직접 등록 ${fmtWhen(h.createdAt)}`}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {h.status === "dismissed" ? (
              <Button size="sm" variant="secondary" onClick={() => void act("st", "hit.update", { patch: { status: "new" } })}>되살리기</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void act("st", "hit.update", { patch: { status: "dismissed" } }).then(onClose)}>제외 (형식 아님)</Button>
            )}
            {(h.owner === d.me || d.admin) && (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={() =>
                  void (async () => {
                    if (!(await ask({ title: "영상을 지울까요?", message: "형식 카드의 근거에서도 빠집니다. 숨기기만 하려면 「제외」 를 쓰세요.", tone: "danger", confirmLabel: "지우기" }))) return;
                    await act("del", "hit.delete", {});
                    onClose();
                  })()
                }
              >
                지우기
              </Button>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>닫기</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <VideoThumb src={h.thumbnail} duration={h.duration} label={PLATFORM_LABEL[h.platform]} className="h-[72px] w-32" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-nd-body">
              <span className="inline-flex items-center gap-1.5">원본 조회 <Num value={h.views.v} /> <SourceTag src={h.views.src} title={h.views.ref} /></span>
              <span className="inline-flex items-center gap-1.5" title={h.baseline.ref}>평소 <Num value={h.baseline.v === null ? null : Math.round(h.baseline.v)} /> <SourceTag src={h.baseline.src} title={h.baseline.ref} /></span>
              <span className="inline-flex items-center gap-1.5">배수 <Multiple value={h.multiple} className="text-[15px]" /></span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-nd-fg-2">
              <span>올린 날 {h.publishedAt ? <>{fmtDate(h.publishedAt)} (<Ago iso={h.publishedAt} />)</> : <Unknown title="게시일을 모릅니다" />}</span>
              {h.duration ? <span>{Math.round(h.duration)}초</span> : null}
              <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-nd-accent hover:underline">원본 열기 <ExternalLink size={13} /></a>
              {/* 컷 전환마다 장면 · 말 · 초 — YouTube 영상만 (아니면 버튼이 그려지지 않는다) */}
              <CutsButton size="sm" variant="secondary" url={h.url} title={h.title} durationSec={h.duration} />
            </div>
            <p className="text-[13px] text-nd-fg-3">원본 영상의 공개 반응입니다 — 우리 영상 성과가 아닙니다.</p>
          </div>
        </div>

        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_2fr]">
          <Field label="나라 (어느 흐름인가)">
            <CountrySelect value={h.country} onChange={(v) => void act("country", "hit.update", { patch: { country: v } })} />
          </Field>
          <Field label="한글 댓글 (한국 사람이 이미 보고 있나)">
            <div className="flex items-center gap-2">
              <span className="text-nd-body">
                {h.koreanComments
                  ? h.koreanComments.sampled
                    ? `댓글 ${h.koreanComments.sampled}개 표본 중 ${h.koreanComments.korean}개 (${pctOf(h.koreanComments.korean, h.koreanComments.sampled)})`
                    : "댓글 표본 없음"
                  : "아직 안 읽음"}
              </span>
              {h.platform === "youtube" && (
                <Button size="sm" variant="ghost" disabled={busy === "kc"} onClick={() => void act("kc", "hit.koreanComments", {})}>댓글 표본 읽기</Button>
              )}
            </div>
          </Field>
        </FormRow>

        {h.found === "manual" && h.platform !== "youtube" && <ManualNumbers hit={h} refresh={refresh} />}

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-nd-section">형식 분석</h3>
            {h.platform === "youtube" ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <AiCostNote compact estimate={analysisEstimateText(d)} />
                <Select size="sm" className="w-auto" value={model} onChange={(e) => setModel(e.target.value)} aria-label="모델">
                  {d.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </Select>
                <Button size="sm" icon={Sparkles} disabled={busy === "an"} onClick={() => void analyze()}>
                  {busy === "an" ? "영상 보는 중…" : !a ? "AI 로 영상 분석" : noteState === "stale" ? "메모 반영해 다시 분석" : "다시 분석"}
                </Button>
              </div>
            ) : null}
          </div>
          <Field label="메모 — AI 가 분석할 때 참고합니다" className="mb-3">
            <Textarea
              value={note}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== h.note && void act("note", "hit.update", { patch: { note } })}
              placeholder="왜 눈여겨봤는지 · 어디가 핵심인지 (예: 「첫 장면 손 클로즈업이 핵심」 「소리 위주로 봐 줘」)"
            />
          </Field>
          {a && noteState === "applied" && <p className="mb-3 text-[13px] text-nd-fg-3">이 분석은 위 메모를 참고했습니다 · {fmtWhen(a.at)}</p>}
          {a && noteState === "stale" && (
            <InlineNotice tone="info" className="mb-3">
              {note.trim() ? "메모가 분석 뒤에 바뀌었습니다 — 「메모 반영해 다시 분석」 을 누르면 AI 가 메모를 참고해 영상을 다시 봅니다." : "분석에 썼던 메모를 지웠습니다 — 다시 분석하면 메모 없이 봅니다."}
            </InlineNotice>
          )}
          {!a ? (
            h.platform === "youtube" ? (
              <p className="text-nd-body text-nd-fg-3">AI 가 영상을 직접 보고(화면 · 소리 · 자막) 훅 · 흐름 · 편집 · 소리 · 먹힌 이유 · AI 재현 난이도를 뽑습니다.</p>
            ) : (
              <InlineNotice tone="info">AI 가 직접 볼 수 있는 것은 YouTube 영상뿐입니다. 같은 영상이 YouTube 에 다시 올라와 있으면 그 주소로 등록하거나, 형식 카드 탭에서 카드를 직접 적어 이 영상을 묶으세요.</InlineNotice>
            )
          ) : (
            <AnalysisView a={a} />
          )}
        </Card>

        <Card>
          <h3 className="mb-3 text-nd-section">형식 카드에 묶기</h3>
          {h.formatId ? (
            <div className="flex flex-wrap items-center gap-2 text-nd-body">
              <span>묶인 형식:</span>
              <button type="button" className="font-medium text-nd-accent hover:underline" onClick={() => { onClose(); onOpenFormat(h.formatId as string); }}>
                {d.formats.find((f) => f.id === h.formatId)?.name ?? "(지워진 카드)"}
              </button>
              <Button size="sm" variant="ghost" disabled={busy === "as"} onClick={() => void act("as", "hit.assign", { formatId: null })}>묶음 풀기</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {suggested && (
                <div className="flex flex-wrap items-center gap-2 text-nd-body">
                  <Badge tone="info">AI 제안</Badge>
                  <span className="font-medium">{suggested.name}</span>
                  <span className="text-nd-fg-3">{a?.match.reason}</span>
                  <Button size="sm" variant="secondary" disabled={busy === "as"} onClick={() => void act("as", "hit.assign", { formatId: suggested.id }, "형식 카드에 묶었습니다.")}>여기에 묶기</Button>
                </div>
              )}
              <FormRow className="grid-cols-1 sm:grid-cols-[2fr_auto_auto]">
                <Field label="기존 형식 카드">
                  <Select size="sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">고르기…</option>
                    {formats.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </Select>
                </Field>
                <FieldAction>
                  <Button size="sm" variant="secondary" disabled={!pick || busy === "as"} onClick={() => void act("as", "hit.assign", { formatId: pick }, "형식 카드에 묶었습니다.")}>묶기</Button>
                </FieldAction>
                <FieldAction>
                  <Button size="sm" disabled={!a || busy === "as"} title={a ? undefined : "먼저 분석해 주세요"} onClick={() => void act("as", "hit.assign", { formatId: "new" }, "분석 내용으로 새 형식 카드를 만들었습니다.")}>
                    새 형식 카드로{a ? ` (「${a.formatName}」)` : ""}
                  </Button>
                </FieldAction>
              </FormRow>
            </div>
          )}
        </Card>

      </div>
    </Dialog>
  );
}

export function AnalysisView({ a }: { a: NonNullable<HitDoc["analysis"]> }) {
  const row = (label: string, v: string | undefined) =>
    v ? (
      <div className="grid grid-cols-[96px_1fr] gap-3 py-1.5 text-nd-body">
        <span className="text-nd-fg-3">{label}</span>
        <span className="whitespace-pre-line">{v}</span>
      </div>
    ) : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-nd-section">{a.formatName}</span>
        <LangBadge dep={a.languageDependence} />
        <AiBadge level={a.aiFeasibility.level} />
        {a.risks.map((r) => (
          <Badge key={r} tone="warning">{RISK_LABEL[r]}</Badge>
        ))}
      </div>
      <div className="divide-y divide-nd-line">
        {row("한 줄", a.summary)}
        {row("훅 (첫 2초)", a.hook)}
        {a.structure.length > 0 && row("흐름", a.structure.map((s, i) => `${i + 1}. ${s}`).join("  "))}
        {row("편집", a.editing)}
        {row("소리", a.sound)}
        {row("화면 글자", a.textOverlay)}
        {row("먹힌 이유 (가설)", a.whyItWorks)}
        {row("AI 로 쉬운 것", a.aiFeasibility.easyParts)}
        {row("AI 로 어려운 것", a.aiFeasibility.hardParts)}
        {row("주의", a.riskNote)}
        {a.brandIdeas.length > 0 && row("제품 접목", a.brandIdeas.map((s) => `· ${s}`).join("\n"))}
        {a.koreanQueries.length > 0 && row("국내 확인 검색어", a.koreanQueries.join(" / "))}
        {row("길이 · 컷", [a.totalSec ? `${a.totalSec}초` : "", a.cutCount ? `${a.cutCount}컷` : ""].filter(Boolean).join(" · ") || undefined)}
      </div>
      <p className="mt-2 text-[13px] text-nd-fg-3">AI 가 영상을 보고 쓴 관찰 · 가설입니다 (사실 확인 아님) · {a.model} · {fmtUsd(a.costUsd)} · {fmtWhen(a.at)}</p>
    </div>
  );
}

function ManualNumbers({ hit: h, refresh }: { hit: WithId<HitDoc>; refresh: () => Promise<void> }) {
  const { run } = useAction();
  const [v, setV] = useState({ title: h.title, channel: h.channel, views: h.views.v === null ? "" : String(h.views.v), baseline: h.baseline.v === null ? "" : String(h.baseline.v) });
  const save = (patch: object) => run("manual", async () => {
    await scout("hit.update", { id: h.id, patch });
    await refresh();
  });
  return (
    <FormRow className="grid-cols-2 sm:grid-cols-4">
      <Field label="제목">
        <Input size="sm" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} onBlur={() => v.title !== h.title && void save({ title: v.title })} />
      </Field>
      <Field label="계정">
        <Input size="sm" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })} onBlur={() => v.channel !== h.channel && void save({ channel: v.channel })} />
      </Field>
      <Field label="조회수 (직접 봄)">
        <NumberInput size="sm" value={v.views} onValueChange={(raw) => setV({ ...v, views: raw })} onBlur={() => void save({ views: v.views === "" ? null : Number(v.views) })} />
      </Field>
      <Field label="그 계정 평소 조회수">
        <NumberInput size="sm" value={v.baseline} onValueChange={(raw) => setV({ ...v, baseline: raw })} onBlur={() => void save({ baseline: v.baseline === "" ? null : Number(v.baseline) })} />
      </Field>
    </FormRow>
  );
}

// ---- 영상 등록 ---------------------------------------------------------------

function AddHitDialog({ keyReady, refresh, onClose, onAdded }: { keyReady: boolean; refresh: () => Promise<void>; onClose: () => void; onAdded: (id: string) => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ url: "", country: "", title: "", channel: "", publishedAt: "", views: "", baseline: "", note: "" });
  const platform = platformFromUrl(f.url);
  const yt = platform === "youtube";
  const submit = () =>
    run(
      "add",
      async () => {
        const r = await scout<{ id: string }>("hit.add", {
          url: f.url,
          country: f.country,
          note: f.note,
          ...(yt ? {} : { title: f.title, channel: f.channel, publishedAt: f.publishedAt, views: f.views === "" ? null : Number(f.views), baseline: f.baseline === "" ? null : Number(f.baseline) }),
        });
        await refresh();
        onClose();
        onAdded(r.id);
      },
      yt ? "공식 API 로 조회수와 그 채널 평소 조회수를 받아 등록했습니다." : "등록했습니다.",
    );
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      closeOnOverlay={false}
      title="영상 등록"
      description="YouTube 주소면 서버가 공식 API 로 숫자와 그 채널의 평소 조회수를 받습니다. 틱톡 · 더우인 · 샤오홍슈 · 인스타는 보고 적은 숫자를 넣으세요 (모르면 비워 두기)."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>취소</Button>
          <Button size="sm" onClick={() => void submit()} disabled={!f.url.trim() || busy === "add" || (yt && !keyReady)}>등록</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={`주소${f.url ? ` · ${PLATFORM_LABEL[platform]}` : ""}`}>
          <Input size="sm" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" autoFocus />
        </Field>
        {yt && !keyReady && <InlineNotice tone="warning">YouTube 검색 키가 없어 YouTube 영상은 등록할 수 없습니다.</InlineNotice>}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="나라 (어느 흐름인가)">
            <CountrySelect value={f.country} onChange={(v) => setF({ ...f, country: v })} />
          </Field>
          {!yt && (
            <Field label="올린 날">
              <Input size="sm" type="date" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} />
            </Field>
          )}
        </FormRow>
        {!yt && f.url && (
          <>
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="제목 · 내용 한 줄">
                <Input size="sm" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </Field>
              <Field label="계정">
                <Input size="sm" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} />
              </Field>
            </FormRow>
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="조회수 · 좋아요 (본 숫자)">
                <NumberInput size="sm" value={f.views} onValueChange={(raw) => setF({ ...f, views: raw })} />
              </Field>
              <Field label="그 계정 평소 조회수 (어림)">
                <NumberInput size="sm" value={f.baseline} onValueChange={(raw) => setF({ ...f, baseline: raw })} />
              </Field>
            </FormRow>
          </>
        )}
        <Field label="메모">
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={`어디서 봤나 · 왜 눈여겨봤나${f.country ? ` (${countryLabel(f.country)})` : ""}`} />
        </Field>
      </div>
    </Dialog>
  );
}
