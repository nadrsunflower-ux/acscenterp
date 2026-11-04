"use client";

// ============================================================
//  주간 보고 — 매일 아침 이번 주 것이 새로 고쳐지고, 월요일에 새 주가 시작된다 (KST).
// ------------------------------------------------------------
//  배치 (2026-11-04 목업 09-scout): 보고 기간 · 쇼츠처럼 보기 → 숫자 4칸 → 이번 주 AI 요약 + 이번 주 할 일
//  → 이번 주 뜨는 형식(표) → 필요한 작업만 실행(네 가지) → 새로 찾은 영상 · 나라 분포 → 시차 → 구간별 표.
//  · 기간은 보고에 저장된 from · to 그대로 — 주 이름(2026-W45)을 다시 풀지 않는다.
//  · 숫자는 모두 원본(남의 채널) 영상의 반응이다 — 우리 영상 성과가 아니다.
//  · 「아직 안 묶은 영상」 은 전체 기간, 「새로 찾은 영상」 은 보고 기간 — 빼기 · 비율로 잇지 않는다.
//  · 「이번 주 할 일」 은 보고 숫자에서 뽑는다 (AI 글을 쪼개 지어내지 않는다).
// ============================================================

import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, FileText, Globe2, Info, Layers, PlayCircle, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button, Disclosure, EmptyState, Field, FieldAction, FormRow, Select, cn } from "@/components/neander/ui";
import { Num, fmtWhen } from "@/components/neander/shorts/parts";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { AiCostNote, AttentionList, RecordTable, StudioCard, StudioMetric, StudioNotice, type AttentionItem, type RecordColumn } from "@/components/neander/shorts/studio";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import {
  KOREA_LABEL,
  REPORT_SECTION_LABEL,
  countryLabel,
  koreaEvidence,
  reportDays,
  reportFormatCards,
  type ReportFormatLine,
  type ReportHitLine,
  type ReportSection,
  type LagLine,
  type ScoutReportDoc,
} from "@/lib/neander/shorts/scout";
import type { ScoutAutoSummary } from "@/lib/neander/shorts/scout-auto";
import { Ago, AiBadge, AiWon, CountryText, KoreaBadge, LangBadge, LifeBadge, Multiple, Note, VideoThumb, fmtDate, fmtDay } from "./bits";
import { RunCards, narrateEstimateText, type ScoutRunActions } from "./AutoPanel";
import { HitDialog } from "./HitsTab";
import { ScoutFeed } from "./ScoutFeed";
import type { ScoutData } from "./useScout";

const n = (v: number) => v.toLocaleString("ko-KR");
type Line = ReportFormatLine & { sections: ReportSection[] };

export function ReportTab({
  d,
  refresh,
  report: r,
  setWeek,
  actions,
  last,
  onOpenFormat,
  onOpenFormats,
  onOpenHits,
}: {
  d: ScoutData;
  refresh: () => Promise<void>;
  /** 고른 주의 보고 (없으면 null) — 페이지가 고른다 */
  report: ScoutReportDoc | null;
  setWeek: (week: string) => void;
  actions: ScoutRunActions;
  /** 자동 수집 마지막 실행 (실행 카드의 최근 금액) */
  last: ScoutAutoSummary | null;
  onOpenFormat: (id: string) => void;
  onOpenFormats: () => void;
  onOpenHits: () => void;
}) {
  const { nameOf } = useShorts();
  const hitById = useMemo(() => new Map(d.hits.map((h) => [h.id, h])), [d.hits]);
  const hitByUrl = useMemo(() => new Map(d.hits.map((h) => [h.url, h])), [d.hits]);
  const formatById = useMemo(() => new Map(d.formats.map((f) => [f.id, f])), [d.formats]);
  const running = actions.busy !== null;
  // 쇼츠처럼 보기의 「자세히 · 묶기」 — 영상 창
  const [detail, setDetail] = useState<string | null>(null);

  if (!r) {
    return (
      <div className="space-y-6">
        <EmptyState
          compact
          icon={FileText}
          title="아직 주간 보고가 없습니다"
          description="감시 채널을 넣고 훑은 뒤 영상을 형식 카드에 묶으면 보고에 담깁니다. 매일 아침 자동 수집이 돌 때마다 새로 고쳐집니다."
          action={
            <Button size="sm" icon={FileText} loading={actions.busy === "build"} disabled={running} onClick={actions.build}>
              보고 새로 만들기
            </Button>
          }
        />
        <StudioCard title="필요한 작업만 실행" description="네 가지를 따로 돌릴 수 있습니다 — 도는 동안에는 서로 막습니다">
          <RunCards actions={actions} d={d} last={last} />
        </StudioCard>
      </div>
    );
  }

  const c = r.counts;
  const days = reportDays(r);
  const lagOf = new Map(r.lags.map((l) => [l.formatId, l.days]));
  const list = reportFormatCards(r, d.formats, d.hits);
  const liveUnassigned = d.hits.filter((h) => h.status === "new").length;
  const byWho = (by: string) => (by === "company" ? "매일 아침 자동" : nameOf(by));
  const newHitDocs = r.newHits.map((l) => hitById.get(l.hitId)).filter((h): h is NonNullable<typeof h> => !!h);

  // 지난 보고 (한 주 앞) — 새로 찾은 영상 증감
  const idx = d.reports.findIndex((x) => x.week === r.week);
  const prev = idx >= 0 ? d.reports.slice(idx + 1).find((x) => x.week < r.week) ?? null : null;
  const diff = prev ? c.newHits - prev.counts.newHits : null;
  const topCountries = [...c.byCountry].sort((a, b) => b.hits - a.hits).slice(0, 3).map((x) => countryLabel(x.country));

  // 이번 주 할 일 — 보고 숫자에서만
  const todo: AttentionItem[] = [];
  if (liveUnassigned > 0)
    todo.push({
      key: "unassigned",
      label: "묶기 전",
      tone: "accent",
      icon: Layers,
      title: `형식에 아직 안 묶인 영상 ${n(liveUnassigned)}편`,
      detail: `전체 기간 기준 · 보고 기간(${days}일)에 새로 찾은 ${n(c.newHits)}편과 집계 범위가 다릅니다${liveUnassigned !== c.unassigned ? ` · 보고 만든 때는 ${n(c.unassigned)}편` : ""}`,
      actionLabel: "터진 영상에서 묶기",
      onAction: onOpenHits,
    });
  const seen = new Set<string>();
  const push = (l: ReportFormatLine, item: Omit<AttentionItem, "key" | "title" | "onAction" | "actionLabel">) => {
    if (seen.has(l.formatId)) return;
    seen.add(l.formatId);
    todo.push({ ...item, key: `${item.label}-${l.formatId}`, title: `「${l.name}」`, actionLabel: "형식 카드 보기", onAction: () => onOpenFormat(l.formatId) });
  };
  for (const l of r.abroadOnly.slice(0, 2))
    push(l, {
      label: "해외 먼저 · 들여올 후보",
      tone: "info",
      icon: Globe2,
      detail: `${l.countries.map(countryLabel).join(" · ") || "나라 모름"} · 예시 ${l.examples}편 · ${koreaEvidence(l.korea, formatById.get(l.formatId)?.korea).text}`,
    });
  for (const l of r.rising.slice(0, 1))
    push(l, { label: "떠오름", tone: "success", icon: TrendingUp, detail: `최근 2주 여러 채널에서 터짐 · 예시 ${l.examples}편 · ${l.basis}` });
  for (const l of r.saturating.slice(0, 1))
    push(l, { label: "포화 조짐", tone: "warning", icon: TrendingDown, detail: `편수는 많은데 최근 배수가 떨어짐 — 늦게 타면 손해 · ${l.basis}` });

  // 이번 주 뜨는 형식 표
  const fmtCols: RecordColumn<Line>[] = [
    {
      key: "name",
      header: "형식 · 흐름",
      mobile: "title",
      className: "w-[36%] min-w-[320px]",
      cell: (l) => {
        const f = formatById.get(l.formatId);
        const top = l.top ? hitByUrl.get(l.top.url) : undefined;
        const steps = (f?.structure ?? []).map((s) => s.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean);
        return (
          <div className="flex min-w-0 items-start gap-3">
            <VideoThumb src={top?.thumbnail} duration={top?.duration} className="hidden h-12 w-[68px] sm:inline-flex" />
            <div className="min-w-0">
              <button type="button" className="block max-w-full truncate text-left text-[15px] font-semibold text-nd-fg hover:underline" title={l.name} onClick={() => onOpenFormat(l.formatId)}>
                {l.name}
              </button>
              <p className="mt-0.5 line-clamp-1 text-[13px] font-normal text-nd-fg-2" title={steps.join(" → ")}>
                {steps.length ? steps.join(" → ") : f?.summary || "흐름 미입력"}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] font-normal text-nd-fg-3">
                <CountryText codes={l.countries} />
                {l.sections.map((s) => (
                  <Badge key={s} tone={s === "abroadOnly" ? "accent" : s === "rising" ? "success" : "warning"} size="lg">
                    {REPORT_SECTION_LABEL[s]}
                  </Badge>
                ))}
              </p>
            </div>
          </div>
        );
      },
    },
    { key: "examples", header: "예시 영상", align: "right", cell: (l) => <span className="nd-num">{l.examples}편</span> },
    { key: "mult", header: "평소 대비", align: "right", cell: (l) => <Multiple value={l.medianMultiple} /> },
    {
      key: "korea",
      header: "국내 확인",
      className: "min-w-[200px]",
      cell: (l) => {
        const ev = koreaEvidence(l.korea, formatById.get(l.formatId)?.korea);
        const lag = lagOf.get(l.formatId);
        return (
          <div className="min-w-0 space-y-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <KoreaBadge status={l.korea} size="lg" />
              {ev.ai && (
                <span className="inline-flex" title="국내 검색 표본의 제목 · 설명을 AI 가 보고 고른 결과입니다 (영상은 보지 않음)">
                  <Badge tone="neutral" size="lg">
                    AI 판단
                  </Badge>
                </span>
              )}
            </span>
            <span className="block text-[13px] text-nd-fg-3">
              {ev.text}
              {lag !== undefined && ` · 해외 → 한국 ${lag}일`}
            </span>
          </div>
        );
      },
    },
    {
      key: "ai",
      header: "AI 제작 · 수명",
      cell: (l) => (
        <span className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <AiBadge level={l.ai} size="lg" />
          <LangBadge dep={l.lang} size="lg" />
          <LifeBadge stage={l.stage} basis={l.basis} size="lg" />
        </span>
      ),
    },
    {
      key: "act",
      header: "다음 행동",
      align: "right",
      cell: (l) => (
        <span className="flex flex-wrap items-center justify-end gap-1.5 md:flex-nowrap">
          {l.top && (
            <a href={l.top.url} target="_blank" rel="noreferrer" className="inline-flex h-ctl-md items-center gap-1 rounded-nd-md px-2 text-[13px] font-medium text-nd-fg-2 hover:bg-nd-sunken hover:text-nd-fg" title={l.top.title || l.top.url}>
              <PlayCircle size={15} aria-hidden />
              대표 영상
            </a>
          )}
          <Button variant="secondary" icon={ArrowUpRight} onClick={() => onOpenFormat(l.formatId)}>
            형식 카드 보기
          </Button>
        </span>
      ),
    },
  ];

  const hitCols: RecordColumn<ReportHitLine>[] = [
    {
      key: "video",
      header: "영상",
      mobile: "title",
      className: "w-[42%] min-w-[300px]",
      cell: (l) => {
        const h = hitById.get(l.hitId);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <VideoThumb src={h?.thumbnail} duration={h?.duration} label={h ? PLATFORM_LABEL[h.platform] : undefined} className="h-12 w-[84px]" />
            <span className="min-w-0">
              <a href={l.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline" title={l.title || l.url}>
                {l.title || l.url}
              </a>
              <span className="block truncate text-[13px] font-normal text-nd-fg-3" title={l.channel}>
                {l.channel || "채널 모름"}
              </span>
            </span>
          </div>
        );
      },
    },
    { key: "country", header: "나라", cell: (l) => <CountryText codes={[l.country]} /> },
    { key: "age", header: "올린 지", cell: (l) => <Ago iso={l.publishedAt} /> },
    { key: "views", header: "원본 조회", align: "right", cell: (l) => <Num value={l.views} /> },
    { key: "mult", header: "평소 대비", align: "right", cell: (l) => <Multiple value={l.multiple} /> },
    {
      key: "format",
      header: "형식",
      className: "max-w-[240px]",
      cell: (l) => {
        const fid = hitById.get(l.hitId)?.formatId ?? null;
        return l.formatName ? (
          fid ? (
            <button type="button" className="block max-w-full truncate text-left font-medium text-nd-accent hover:underline" title={l.formatName} onClick={() => onOpenFormat(fid)}>
              {l.formatName}
            </button>
          ) : (
            <span className="block truncate font-medium" title={l.formatName}>
              {l.formatName}
            </span>
          )
        ) : (
          <Badge tone={l.analyzed ? "info" : "neutral"} size="lg">
            {l.analyzed ? "분석됨 · 안 묶음" : "분석 전"}
          </Badge>
        );
      },
    },
  ];

  const lagCols: RecordColumn<LagLine>[] = [
    {
      key: "name",
      header: "형식",
      mobile: "title",
      cell: (l) => (
        <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpenFormat(l.formatId)}>
          {l.name}
        </button>
      ),
    },
    { key: "from", header: "해외 처음 나라", cell: (l) => <CountryText codes={[l.from]} /> },
    { key: "foreign", header: "해외에서 처음 본 날", cell: (l) => <span className="nd-num">{fmtDate(l.foreignFirst)}</span> },
    { key: "korea", header: "한국에 처음 나타난 날", cell: (l) => <span className="nd-num">{fmtDate(l.koreaFirst)}</span> },
    { key: "days", header: "시차", align: "right", cell: (l) => <span className="nd-num">{l.days}일</span> },
  ];

  return (
    <div className="space-y-6">
      {/* 보고 기간 · 쇼츠처럼 보기 · 기준 */}
      <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,340px)_auto] lg:grid-cols-[minmax(0,340px)_auto_minmax(0,1fr)]">
        <Field label="보고 기간">
          <Select value={r.week} onChange={(e) => setWeek(e.target.value)} className="font-medium">
            {d.reports.map((x) => (
              <option key={x.week} value={x.week}>
                {fmtDay(x.from)} ~ {fmtDay(x.to)} · {x.week}
              </option>
            ))}
          </Select>
        </Field>
        <FieldAction size="md">
          <ScoutFeed d={d} hits={newHitDocs} refresh={refresh} onOpenFormat={onOpenFormat} onDetail={setDetail} size="md" />
        </FieldAction>
        <FieldAction size="md" center className="min-w-0">
          <span className="nd-num min-w-0 text-[13px] text-nd-fg-3" title={`${fmtWhen(r.from)} ~ ${fmtWhen(r.to)} · 보고 만든 때 ${fmtWhen(r.createdAt)} · ${byWho(r.createdBy)}`}>
            최근 {days}일 · {fmtDay(r.to, true)} 기준 · {byWho(r.createdBy)}
          </span>
        </FieldAction>
      </FormRow>

      {/* 숫자 4칸 — 보고에 저장된 값만 */}
      <div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StudioMetric
            label="새로 찾은 영상"
            value={n(c.newHits)}
            unit="편"
            detail={diff === null ? `최근 ${days}일 발견 · 원본 영상` : diff === 0 ? "지난 보고와 같음" : `지난 보고보다 ${n(Math.abs(diff))}편 ${diff > 0 ? "증가" : "감소"}`}
          />
          <StudioMetric label="뜨는 형식" value={n(r.rising.length)} unit="개" detail={`해외 먼저 ${r.abroadOnly.length}개 · 포화 조짐 ${r.saturating.length}개`} />
          <StudioMetric label="살펴본 채널" value={n(c.scanned)} unit="곳" detail={`감시 채널 ${n(c.channels)}곳${topCountries.length ? ` · ${topCountries.join(" · ")}` : ""}`} />
          <StudioMetric label="분석 완료" value={n(c.analyzed)} unit="편" detail={`새로 찾은 ${n(c.newHits)}편 중 · 형식 카드 ${n(c.formats)}장`} />
        </div>
        <Note className="mt-2">우리 영상 성과가 아닌 원본 영상(감시 채널 · 직접 등록)의 관찰값입니다.</Note>
      </div>

      {/* 이번 주 AI 요약 + 이번 주 할 일 */}
      <Summary r={r} d={d} byWho={byWho} actions={actions} todo={todo} />

      {/* 이번 주 뜨는 형식 */}
      <StudioCard
        flush
        title={`이번 주 뜨는 형식 · ${list.length}개`}
        description="보고 구간(해외 먼저 · 떠오름 · 포화 조짐)에 오른 것 먼저 · 예시가 묶인 형식 카드 · 겹치면 한 번만"
        action={
          <Button variant="ghost" trailingIcon={ArrowUpRight} onClick={onOpenFormats}>
            형식 카드 전체
          </Button>
        }
      >
        <RecordTable
          rows={list}
          columns={fmtCols}
          rowKey={(l) => l.formatId}
          ariaLabel="이번 주 뜨는 형식"
          className="pb-1 max-md:px-4 max-md:pb-4"
          empty={
            <p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">
              아직 예시가 묶인 형식 카드가 없습니다 — 터진 영상을 형식 카드에 묶으면 여기에 오릅니다. 자동 수집이 비슷한 영상끼리 묶어 카드를 만들기도 합니다.
            </p>
          }
        />
      </StudioCard>

      {/* 실행 네 가지 */}
      <StudioCard title="필요한 작업만 실행" description="네 가지를 따로 돌릴 수 있습니다 — 도는 동안에는 서로 막습니다">
        <RunCards actions={actions} d={d} last={last} />
      </StudioCard>

      {/* 새로 찾은 영상 · 나라 분포 */}
      <StudioCard
        flush
        title={`최근 ${days}일 새로 찾은 영상`}
        description="배수 큰 순 · 최대 15편 · 원본 영상의 반응"
        action={<ScoutFeed d={d} hits={newHitDocs} refresh={refresh} onOpenFormat={onOpenFormat} onDetail={setDetail} size="md" />}
      >
        <div className="px-5 pb-3 sm:px-6">
          <p className="mb-2 text-[13px] font-medium text-nd-fg-2">나라 분포 · 새로 찾은 {n(c.newHits)}편</p>
          {c.byCountry.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="발견 영상의 나라 분포">
              {[...c.byCountry]
                .sort((a, b) => b.hits - a.hits)
                .map((x) => (
                  <li key={x.country || "none"} className="inline-flex items-baseline gap-1.5 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-3 py-1.5">
                    <span className={cn("text-[13px]", x.country === "KR" ? "font-semibold text-nd-accent-strong" : "text-nd-fg-2")}>{countryLabel(x.country)}</span>
                    <span className="nd-num text-[15px] font-bold text-nd-fg">{n(x.hits)}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-nd-body text-nd-fg-3">이 기간에 새로 찾은 영상이 없습니다.</p>
          )}
          <Note className="mt-2">나라는 감시 채널에 적은 나라(어느 흐름으로 볼지)입니다.</Note>
        </div>
        {r.newHits.length > 0 && <RecordTable rows={r.newHits} columns={hitCols} rowKey={(l) => l.hitId} ariaLabel="새로 찾은 영상" className="pb-1 max-md:px-4 max-md:pb-4" />}
      </StudioCard>

      {/* 시차 */}
      <StudioCard flush title="시차 — 해외에서 처음 본 날 → 한국에 처음 나타난 날" description="쌓일수록 어느 나라를 더 자주 볼지가 데이터로 정해집니다">
        <RecordTable
          rows={r.lags}
          columns={lagCols}
          rowKey={(l) => l.formatId}
          ariaLabel="시차"
          className="pb-1 max-md:px-4 max-md:pb-4"
          empty={
            <p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">
              아직 계산할 형식이 없습니다. 해외 영상과 국내 영상(국내 터진 영상 또는 「한국에 이미 있나」 에서 고른 영상)이 같은 카드에 함께 묶이면 생깁니다.
            </p>
          }
        />
      </StudioCard>

      <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-nd-fg-3">
        <Info size={14} className="mt-[3px] shrink-0" aria-hidden />
        <span>
          국내 확인은 국내 검색 표본의 제목 · 설명으로 본 것입니다(자동 확인은 AI 판단). 국내 표본에서 못 찾았다고 국내에 없다는 뜻은 아니고, 표본에 있다고 국내에서 유행한다는 뜻도 아닙니다.
        </span>
      </p>

      {detail && hitById.get(detail) && <HitDialog d={d} hit={hitById.get(detail)!} refresh={refresh} onClose={() => setDetail(null)} onOpenFormat={onOpenFormat} />}

      <Disclosure
        title="구간별 표 — 해외 먼저 · 떠오름 · 포화 조짐"
        meta={
          <span className="nd-num text-[13px]">
            {r.abroadOnly.length} · {r.rising.length} · {r.saturating.length}
          </span>
        }
      >
        <div className="space-y-7">
          <FormatSection
            d={d}
            title="해외에서 보이는데 국내 표본엔 아직 없는 형식"
            hint="들여올 후보 — 국내 확인 전이거나, 국내 검색 표본에서 못 찾은 것"
            lines={r.abroadOnly}
            lagOf={lagOf}
            empty="해당하는 형식이 없습니다. 해외 감시 채널을 늘리거나 형식 카드의 「한국에 이미 있나」 를 확인해 보세요."
            note={`「${KOREA_LABEL.none_in_sample}」 은 국내 검색 표본에서 못 찾았다는 뜻일 뿐 — 국내 미유행이 확정된 것이 아닙니다. 「${KOREA_LABEL.unchecked}」 은 아직 국내 검색을 하지 않은 것입니다.`}
            onOpen={onOpenFormat}
          />
          <FormatSection d={d} title="떠오르는 형식" hint="최근 2주에 여러 채널에서 터진 형식 · 씨앗(한 편)" lines={r.rising} lagOf={lagOf} empty="떠오르는 형식이 없습니다." onOpen={onOpenFormat} />
          <FormatSection d={d} title="포화 조짐" hint="편수는 많은데 최근 배수가 떨어지는 형식 — 늦게 타면 손해" lines={r.saturating} lagOf={lagOf} empty="포화 조짐이 보이는 형식이 없습니다." onOpen={onOpenFormat} />
        </div>
      </Disclosure>
    </div>
  );
}

/** 이번 주 AI 요약 — 첫 줄을 제목처럼, 나머지는 「요약 자세히」. 아래에 보고 숫자로 뽑은 이번 주 할 일 */
function Summary({ r, d, byWho, actions, todo }: { r: ScoutReportDoc; d: ScoutData; byWho: (by: string) => string; actions: ScoutRunActions; todo: AttentionItem[] }) {
  const [open, setOpen] = useState(false);
  const nar = r.narrative;
  const bullet = /^([-•·*]|\d+[.)])\s+/;
  const lines = (nar?.text ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const head = lines[0]?.replace(bullet, "") ?? "";
  const rest = lines.slice(1);
  const shown = open ? rest : rest.slice(0, 2);
  const running = actions.busy !== null;
  const narrateBtn = (label: string) => (
    <Button variant="secondary" icon={Sparkles} loading={actions.busy === "narrate"} disabled={running || !!actions.blocked.narrate} onClick={actions.narrate}>
      {label}
    </Button>
  );

  return (
    <StudioCard
      title="이번 주 AI 요약"
      action={
        <span className="flex flex-wrap items-center gap-2">
          <AiCostNote compact estimate={narrateEstimateText(d)} />
          {narrateBtn(nar ? "AI 요약 다시" : "AI 요약 붙이기")}
        </span>
      }
    >
      {nar ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent" size="lg">
              숫자 기반 해설 · 사실 확인 아님
            </Badge>
            <Badge tone="neutral" size="lg">
              생성 {fmtDay(nar.at, true)}
            </Badge>
          </div>
          {head && <p className="break-keep text-[20px] font-bold leading-snug text-nd-fg">{head}</p>}
          {shown.length > 0 && (
            <div className="mt-2 space-y-1.5 text-nd-body leading-relaxed text-nd-fg-2">
              {shown.map((line, i) =>
                bullet.test(line) ? (
                  <p key={i} className="flex gap-2">
                    <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-nd-accent" />
                    <span className="min-w-0 break-words">{line.replace(bullet, "")}</span>
                  </p>
                ) : (
                  <p key={i} className="break-words">
                    {line}
                  </p>
                ),
              )}
            </div>
          )}
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-nd-accent hover:underline">
            {open ? "접기" : rest.length > 2 ? `요약 자세히 · ${rest.length - 2}줄 더 · 생성 정보` : "생성 정보 보기"}
            <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <p className="mt-2 text-[13px] text-nd-fg-3">
              {nar.model} · <AiWon usd={nar.costUsd} className="font-medium" /> · {fmtWhen(nar.at)} · {byWho(nar.by)} — 보고서 숫자만 근거로 AI 가 쓴 글입니다
            </p>
          )}
          {nar.at < r.createdAt && (
            <StudioNotice tone="warning" className="mt-3" action={narrateBtn("AI 요약 다시")}>
              보고가 요약 뒤에 새로 고쳐졌습니다 — 최신 숫자로 다시 쓰려면 「AI 요약 다시」 를 누르세요.
            </StudioNotice>
          )}
        </div>
      ) : (
        <p className="text-nd-body text-nd-fg-3">아직 AI 요약이 없습니다. 이 보고의 숫자만 근거로 짧게 씁니다 — 아래 할 일은 요약 없이도 보고 숫자에서 바로 뽑습니다.</p>
      )}

      <div className="mt-4 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
        <p className="text-[14px] font-semibold text-nd-fg">이번 주 할 일</p>
        <p className="mb-2 text-[13px] text-nd-fg-3">보고 숫자에서 뽑았습니다 — 무엇을 들여올지 · 무엇을 묶을지</p>
        {todo.length ? <AttentionList items={todo} /> : <p className="py-1 text-nd-body text-nd-fg-3">이번 주 보고에 따로 챙길 형식이 없습니다. 감시 채널을 늘리거나 터진 영상을 형식에 묶어 보세요.</p>}
      </div>
    </StudioCard>
  );
}

function FormatSection({
  d,
  title,
  hint,
  lines,
  lagOf,
  empty,
  note,
  onOpen,
}: {
  d: ScoutData;
  title: string;
  hint: string;
  lines: ReportFormatLine[];
  lagOf: Map<string, number>;
  empty: string;
  note?: string;
  onOpen: (id: string) => void;
}) {
  const formatById = new Map(d.formats.map((f) => [f.id, f]));
  const hitByUrl = new Map(d.hits.map((h) => [h.url, h]));
  const cols: RecordColumn<ReportFormatLine>[] = [
    {
      key: "name",
      header: "형식",
      mobile: "title",
      className: "max-w-[280px]",
      cell: (l) => {
        const f = formatById.get(l.formatId);
        return (
          <button type="button" className="block w-full min-w-0 text-left" onClick={() => onOpen(l.formatId)}>
            <span className="block truncate font-semibold hover:underline" title={l.name}>
              {l.name}
            </span>
            {f?.summary && (
              <span className="line-clamp-2 text-[13px] font-normal text-nd-fg-3" title={f.summary}>
                {f.summary}
              </span>
            )}
          </button>
        );
      },
    },
    { key: "life", header: "수명", cell: (l) => <LifeBadge stage={l.stage} basis={l.basis} size="lg" /> },
    { key: "country", header: "나라", className: "max-w-[140px]", cell: (l) => <CountryText codes={l.countries} className="line-clamp-2" /> },
    { key: "ex", header: "예시", align: "right", cell: (l) => <span className="nd-num">{l.examples}편</span> },
    { key: "mult", header: "배수 중앙값", align: "right", cell: (l) => <Multiple value={l.medianMultiple} /> },
    {
      key: "korea",
      header: "국내 · 시차",
      cell: (l) => {
        const lag = lagOf.get(l.formatId);
        return (
          <span className="inline-flex flex-col items-end gap-1 md:items-start">
            <KoreaBadge status={l.korea} size="lg" />
            {lag !== undefined && <span className="text-[13px] text-nd-fg-3">해외 → 한국 {lag}일</span>}
          </span>
        );
      },
    },
    {
      key: "ai",
      header: "AI 제작 · 언어",
      cell: (l) => (
        <span className="flex flex-wrap items-center justify-end gap-1 md:flex-col md:items-start">
          <AiBadge level={l.ai} size="lg" />
          <LangBadge dep={l.lang} size="lg" />
        </span>
      ),
    },
    {
      key: "top",
      header: "대표 영상",
      className: "max-w-[260px]",
      cell: (l) => {
        const top = l.top ? hitByUrl.get(l.top.url) : undefined;
        return l.top ? (
          <a href={l.top.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center justify-end gap-2.5 hover:underline md:justify-start" title={l.top.title}>
            <VideoThumb src={top?.thumbnail} duration={top?.duration} className="hidden h-10 w-[70px] md:inline-flex" />
            <span className="min-w-0">
              <span className="block">
                <Multiple value={l.top.multiple} />
              </span>
              <span className="block truncate text-[13px] text-nd-fg-2">{l.top.title || l.top.url}</span>
            </span>
          </a>
        ) : (
          <span className="text-nd-fg-3">—</span>
        );
      },
    },
  ];
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-[16px] font-semibold text-nd-fg">{title}</h3>
        <p className="text-[13px] text-nd-fg-3">{hint}</p>
      </div>
      {lines.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">{empty}</p>
      ) : (
        <div className="nd-surface overflow-hidden rounded-nd-lg max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <RecordTable rows={lines} columns={cols} rowKey={(l) => l.formatId} ariaLabel={title} />
        </div>
      )}
      {note && lines.length > 0 && <Note className="mt-2">※ {note}</Note>}
    </section>
  );
}
