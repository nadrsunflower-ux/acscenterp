"use client";

// ============================================================
//  주간 보고 — 매일 아침 이번 주 것이 새로 고쳐지고, 월요일에 새 주가 시작된다 (KST).
// ------------------------------------------------------------
//  배치 (2026-11-02 목업): 주 고르기 → 숫자 4칸 → 「아직 안 묶은 영상」 다음 할 일 →
//  보고에 오른 형식 카드(겹치면 한 번만) → AI 요약 · 나라 분포 → 새로 찾은 영상 · 시차 · 구간별 표.
//  · 기간은 보고에 저장된 from · to 그대로 — 주 이름(2026-W45)을 다시 풀지 않는다.
//  · 숫자는 모두 원본(남의 채널) 영상의 반응이다 — 우리 영상 성과가 아니다.
//  · 「아직 안 묶은 영상」 은 전체 기간, 「새로 찾은 영상」 은 보고 기간 — 빼기 · 비율로 잇지 않는다.
//  · 형식 카드의 훅 · 구성은 FormatDoc 그대로, 사진은 대표 영상의 실제 썸네일(없으면 아이콘).
// ============================================================

import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, FileText, Info, Layers, PlayCircle, Sparkles } from "lucide-react";
import { Badge, Button, Card, Disclosure, EmptyState, InlineNotice, SectionHeader, Select, Table, TableScroll, Td, Th, Tr, buttonClass, cn } from "@/components/neander/ui";
import { Num, fmtUsd, fmtWhen } from "@/components/neander/shorts/parts";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import {
  KOREA_LABEL,
  REPORT_SECTION_LABEL,
  countryLabel,
  koreaEvidence,
  reportDays,
  reportFormatCards,
  type ReportFormatLine,
  type ScoutReportDoc,
} from "@/lib/neander/shorts/scout";
import { Ago, AiBadge, CountryText, KoreaBadge, LangBadge, LifeBadge, Multiple, Note, VideoThumb, fmtDate } from "./bits";
import type { ScoutRunActions } from "./AutoPanel";
import { HitDialog } from "./HitsTab";
import { ScoutFeed } from "./ScoutFeed";
import type { ScoutData } from "./useScout";

/** 한국 시각 월/일 (10/26) */
const md = (ms: number) => {
  const k = new Date(ms + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
};
const n = (v: number) => v.toLocaleString("ko-KR");

export function ReportTab({
  d,
  refresh,
  report: r,
  setWeek,
  actions,
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
  onOpenFormat: (id: string) => void;
  onOpenFormats: () => void;
  onOpenHits: () => void;
}) {
  const { nameOf } = useShorts();
  const hitById = useMemo(() => new Map(d.hits.map((h) => [h.id, h])), [d.hits]);
  const hitByUrl = useMemo(() => new Map(d.hits.map((h) => [h.url, h])), [d.hits]);
  const formatById = useMemo(() => new Map(d.formats.map((f) => [f.id, f])), [d.formats]);
  const running = actions.busy !== null;
  const [allCards, setAllCards] = useState(false);
  // 쇼츠처럼 보기의 「자세히 · 묶기」 — 영상 창
  const [detail, setDetail] = useState<string | null>(null);

  if (!r) {
    return (
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
    );
  }

  const c = r.counts;
  const days = reportDays(r);
  const lagOf = new Map(r.lags.map((l) => [l.formatId, l.days]));
  const list = reportFormatCards(r, d.formats, d.hits);
  const CARD_MAX = 6;
  const cards = allCards ? list : list.slice(0, CARD_MAX);
  const liveUnassigned = d.hits.filter((h) => h.status === "new").length;
  const byWho = (by: string) => (by === "company" ? "매일 아침 자동" : nameOf(by));

  return (
    <div className="space-y-6 [container-type:inline-size]">
      {/* 주 고르기 · 기준 시각 · 다시 만들기 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Select size="md" className="w-auto min-w-[240px] max-w-full font-medium" value={r.week} onChange={(e) => setWeek(e.target.value)} aria-label="보고 주">
            {d.reports.map((x) => (
              <option key={x.week} value={x.week}>
                {x.week} · {md(x.from)} ~ {md(x.to)}
              </option>
            ))}
          </Select>
          <span className="nd-num text-nd-body text-nd-fg-3" title={`${fmtWhen(r.from)} ~ ${fmtWhen(r.to)} · 보고 만든 때 ${fmtWhen(r.createdAt)} · ${byWho(r.createdBy)}`}>
            최근 {days}일 · {fmtWhen(r.to)} 기준 · {byWho(r.createdBy)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={FileText} loading={actions.busy === "build"} disabled={running} onClick={actions.build} title="지금 자료로 최근 7일 보고를 다시 셉니다 (검색 · AI 없음)">
            보고 새로 만들기
          </Button>
          <Button
            variant="secondary"
            icon={Sparkles}
            loading={actions.busy === "narrate"}
            disabled={running || !!actions.blocked.narrate}
            onClick={actions.narrate}
            title={`${r.week} 보고 숫자로 AI 요약을 씁니다`}
          >
            {r.narrative ? "AI 요약 다시" : "AI 요약 붙이기"}
          </Button>
        </div>
      </div>

      {/* 숫자 4칸 — 보고에 저장된 값만 */}
      <Card padding="none" className="overflow-hidden [container-type:inline-size]">
        <dl className="grid grid-cols-1 gap-px bg-[var(--nd-line)] [@container(min-width:480px)]:grid-cols-2 [@container(min-width:860px)]:grid-cols-4">
          <Kpi label="감시 채널" value={c.channels} unit="곳" sub={`최근 ${days}일 훑은 채널 ${n(c.scanned)}곳`} title="훑기를 켜 둔 채널 (보고 만든 때 기준)" />
          <Kpi label="새로 찾은 영상" value={c.newHits} unit="편" sub={`최근 ${days}일 발견 · 원본 영상`} title="보고 기간에 새로 찾은 터진 영상 (지운 것 제외)" />
          <Kpi label="분석 완료" value={c.analyzed} unit="편" sub={`새로 찾은 ${n(c.newHits)}편 중`} title="새로 찾은 영상 가운데 AI 형식 분석이 붙은 것" />
          <Kpi label="형식 카드" value={c.formats} unit="장" sub="예시가 묶인 카드" title="보관하지 않았고 예시 영상이 하나 이상 묶인 형식 카드" />
        </dl>
        <p className="border-t border-nd-line px-5 py-2.5 text-[13px] text-nd-fg-3">우리 영상 성과가 아닌 원본 영상(감시 채널 · 직접 등록)의 관찰값입니다.</p>
      </Card>

      {/* 다음 할 일 — 아직 형식에 안 묶인 영상 (전체 기간) */}
      <Unassigned count={c.unassigned} live={liveUnassigned} newHits={c.newHits} days={days} onOpenHits={onOpenHits} />

      {/* 보고에 오른 형식 */}
      <section aria-labelledby="scout-report-formats">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="scout-report-formats" className="text-[20px] font-bold text-nd-fg">
              관찰한 형식 <span className="nd-num text-nd-accent">{list.length}개</span>
            </h2>
            <span className="text-[13px] text-nd-fg-3">예시가 묶인 형식 카드 · 보고 구간(해외 먼저 · 떠오름 · 포화 조짐)에 오른 것 먼저 · 겹치면 한 번만</span>
          </div>
          <button type="button" onClick={onOpenFormats} className="inline-flex items-center gap-1 text-nd-body font-medium text-nd-accent hover:underline">
            형식 카드 전체 보기 <ArrowRight size={15} aria-hidden />
          </button>
        </div>
        {list.length === 0 ? (
          <Card>
            <p className="text-nd-body text-nd-fg-2">아직 예시가 묶인 형식 카드가 없습니다.</p>
            <p className="mt-1 text-[13px] text-nd-fg-3">터진 영상을 형식 카드에 묶으면 여기에 오릅니다. 자동 수집이 비슷한 영상끼리 묶어 카드를 만들기도 합니다.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 items-stretch gap-4 [@container(min-width:960px)]:grid-cols-2">
              {cards.map((l) => {
                const top = l.top ? hitByUrl.get(l.top.url) : undefined;
                return <FormatCard key={l.formatId} l={l} f={formatById.get(l.formatId)} thumb={top?.thumbnail} duration={top?.duration} lag={lagOf.get(l.formatId)} onOpen={onOpenFormat} />;
              })}
            </div>
            {list.length > CARD_MAX && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" trailingIcon={ChevronDown} aria-expanded={allCards} onClick={() => setAllCards(!allCards)} className={cn("[&>svg:last-child]:transition-transform", allCards && "[&>svg:last-child]:rotate-180")}>
                  {allCards ? "앞의 6개만 보기" : `나머지 ${list.length - CARD_MAX}개 더 보기`}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* AI 요약 · 나라 분포 */}
      <div className="grid grid-cols-1 gap-4 [@container(min-width:960px)]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Summary r={r} byWho={byWho} actions={actions} />
        <Card>
          <SectionHeader as="h3" size="lg" title="발견 영상의 나라 분포" hint={`최근 ${days}일 새로 찾은 ${n(c.newHits)}편`} />
          {c.byCountry.length ? (
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-2">
              {c.byCountry.map((x) => (
                <li key={x.country || "none"} className="min-w-0 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-2 py-2 text-center">
                  <span className={cn("block truncate text-[13px]", x.country === "KR" ? "font-medium text-nd-accent-strong" : "text-nd-fg-2")} title={countryLabel(x.country)}>
                    {countryLabel(x.country)}
                  </span>
                  <span className="nd-num block text-[20px] font-bold leading-tight text-nd-fg">{n(x.hits)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-nd-body text-nd-fg-3">이 기간에 새로 찾은 영상이 없습니다.</p>
          )}
          <Note className="mt-2.5">나라는 감시 채널에 적은 나라(어느 흐름으로 볼지)입니다 · 원본 영상의 관찰값이지 우리 성과가 아닙니다.</Note>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-nd-fg-3">
        <Info size={14} className="mt-[3px] shrink-0" aria-hidden />
        <span>
          국내 확인은 국내 검색 표본의 제목 · 설명으로 본 것입니다(자동 확인은 AI 판단). 국내 표본에서 못 찾았다고 국내에 없다는 뜻은 아니고, 표본에 있다고 국내에서 유행한다는 뜻도 아닙니다.
        </span>
      </p>

      {/* 아래 — 원본 영상 목록 · 시차 · 구간별 표 (예전 보고 내용 그대로) */}
      <section>
        <SectionHeader
          size="lg"
          title={`최근 ${days}일 새로 찾은 영상`}
          hint="배수 큰 순 · 최대 15편 · 원본 영상의 반응"
          action={
            <ScoutFeed
              d={d}
              hits={r.newHits.map((l) => hitById.get(l.hitId)).filter((h): h is NonNullable<typeof h> => !!h)}
              refresh={refresh}
              onOpenFormat={onOpenFormat}
              onDetail={setDetail}
            />
          }
        />
        {r.newHits.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">이 기간에 새로 찾은 영상이 없습니다.</p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table size="md" minWidth={900}>
                <thead>
                  <tr>
                    <Th>영상</Th>
                    <Th>나라</Th>
                    <Th>올린 지</Th>
                    <Th align="right">원본 조회</Th>
                    <Th align="right" title="조회수 ÷ 그 채널 평소 조회수">배수 (평소 대비)</Th>
                    <Th>형식</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.newHits.map((l) => {
                    const h = hitById.get(l.hitId);
                    const fid = h?.formatId ?? null;
                    return (
                      <Tr key={l.hitId}>
                        <Td className="w-[44%] max-w-0">
                          <div className="flex min-w-0 items-center gap-3">
                            <VideoThumb src={h?.thumbnail} duration={h?.duration} label={h ? PLATFORM_LABEL[h.platform] : undefined} className="h-12 w-[84px]" />
                            <span className="min-w-0">
                              <a href={l.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline" title={l.title || l.url}>
                                {l.title || l.url}
                              </a>
                              <span className="block truncate text-[13px] text-nd-fg-3" title={l.channel}>
                                {l.channel || "채널 모름"}
                              </span>
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <CountryText codes={[l.country]} />
                        </Td>
                        <Td>
                          <Ago iso={l.publishedAt} />
                        </Td>
                        <Td num>
                          <Num value={l.views} />
                        </Td>
                        <Td num>
                          <Multiple value={l.multiple} />
                        </Td>
                        <Td className="max-w-[240px]">
                          {l.formatName ? (
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
                          )}
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

      <section>
        <SectionHeader size="lg" title="시차 — 해외에서 처음 본 날 → 한국에 처음 나타난 날" hint="쌓일수록 어느 나라를 더 자주 볼지가 데이터로 정해집니다" />
        {r.lags.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">
            아직 계산할 형식이 없습니다. 해외 영상과 국내 영상(국내 터진 영상 또는 「한국에 이미 있나」 에서 고른 영상)이 같은 카드에 함께 묶이면 생깁니다.
          </p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table size="md" minWidth={680}>
                <thead>
                  <tr>
                    <Th>형식</Th>
                    <Th>해외 처음 나라</Th>
                    <Th>해외에서 처음 본 날</Th>
                    <Th>한국에 처음 나타난 날</Th>
                    <Th align="right">시차</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.lags.map((l) => (
                    <Tr key={l.formatId}>
                      <Td>
                        <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpenFormat(l.formatId)}>
                          {l.name}
                        </button>
                      </Td>
                      <Td>
                        <CountryText codes={[l.from]} />
                      </Td>
                      <Td className="nd-num">{fmtDate(l.foreignFirst)}</Td>
                      <Td className="nd-num">{fmtDate(l.koreaFirst)}</Td>
                      <Td num>
                        {l.days}
                        <span className="ml-0.5 text-nd-fg-3">일</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

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

function Kpi({ label, value, unit, sub, title }: { label: string; value: number; unit: string; sub: ReactNode; title?: string }) {
  return (
    <div className="min-w-0 bg-nd-content px-5 py-4" title={title}>
      <dt className="text-nd-body font-medium text-nd-fg-2">{label}</dt>
      <dd className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1">
        <span className="nd-num text-[30px] font-bold leading-tight text-nd-fg">{n(value)}</span>
        <span className="text-[15px] font-medium text-nd-fg-2">{unit}</span>
      </dd>
      <dd className="mt-1.5 text-[13px] text-nd-fg-3">{sub}</dd>
    </div>
  );
}

/** 아직 형식에 안 묶인 영상 — 전체 기간 · 보고 시점 값. 지금 값이 다르면 함께 */
function Unassigned({ count, live, newHits, days, onOpenHits }: { count: number; live: number; newHits: number; days: number; onOpenHits: () => void }) {
  const none = count === 0 && live === 0;
  return (
    <section
      aria-label="다음에 할 일 — 형식에 아직 안 묶인 영상"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-nd-lg border px-5 py-4",
        none ? "border-nd-line bg-nd-content" : "border-nd-accent/25 bg-nd-accent-soft/50",
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", none ? "bg-nd-fg/[.06] text-nd-fg-3" : "bg-nd-content text-nd-accent")} aria-hidden>
        <Layers size={20} />
      </span>
      <div className="min-w-0 flex-1 basis-[260px]">
        {none ? (
          <p className="text-[16px] font-semibold text-nd-fg">형식에 아직 안 묶인 영상이 없습니다</p>
        ) : (
          <p className="text-[16px] font-bold text-nd-fg">
            형식에 아직 안 묶인 영상 <span className="nd-num text-[22px] text-nd-accent">{n(count)}편</span>
          </p>
        )}
        <p className="mt-0.5 text-[13px] text-nd-fg-2">
          전체 기간 기준 · 보고 기간({days}일)에 새로 찾은 {n(newHits)}편과 집계 범위가 다릅니다
          {live !== count && <span className="font-medium text-nd-fg"> · 지금은 {n(live)}편</span>}
        </p>
      </div>
      {!none && (
        <Button variant="secondary" trailingIcon={ArrowRight} onClick={onOpenHits} className="border-nd-accent/40 text-nd-accent-strong">
          터진 영상에서 묶기
        </Button>
      )}
    </section>
  );
}

function FormatCard({
  l,
  f,
  thumb,
  duration,
  lag,
  onOpen,
}: {
  l: ReportFormatLine & { sections: (keyof typeof REPORT_SECTION_LABEL)[] };
  f: ScoutData["formats"][number] | undefined;
  thumb: string | null | undefined;
  duration: number | null | undefined;
  lag: number | undefined;
  onOpen: (id: string) => void;
}) {
  const ev = koreaEvidence(l.korea, f?.korea);
  // AI 가 붙인 「1.」 번호는 떼고 우리 번호로 — 짧으면 가로 흐름(→), 길면 세로 번호 목록 (줄이 삐뚤지 않게)
  const steps = (f?.structure ?? []).map((s) => s.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean);
  const shown = steps.slice(0, 4);
  const flow = shown.every((s) => s.length <= 14);
  return (
    <Card data-scout-format padding="none" className="flex min-w-0 flex-col p-4 [container-type:inline-size]">
      <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 [@container(min-width:500px)]:grid-cols-[136px_minmax(0,1fr)] [@container(min-width:500px)]:gap-x-4">
        <figure className="min-w-0">
          <VideoThumb hq src={thumb} duration={duration} className="aspect-[9/16] w-full rounded-nd-md" />
          <figcaption className="mt-1.5 text-[13px] text-nd-fg-3">{l.top ? "대표 영상" : "대표 영상 없음"}</figcaption>
        </figure>

        <div className="min-w-0 space-y-2">
          <h3 className="line-clamp-2 break-words text-[17px] font-bold leading-snug text-nd-fg" title={l.name}>
            {l.name}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <KoreaBadge status={l.korea} />
            {ev.ai && (
              <span className="inline-flex" title="국내 검색 표본의 제목 · 설명을 AI 가 보고 고른 결과입니다 (영상은 보지 않음)">
                <Badge tone="neutral">AI 판단</Badge>
              </span>
            )}
            <LifeBadge stage={l.stage} basis={l.basis} />
            {l.sections.includes("abroadOnly") && (
              <span className="inline-flex" title="해외에서 보이는데 국내 확인 전이거나 국내 검색 표본에서 못 찾은 형식">
                <Badge tone="accent">{REPORT_SECTION_LABEL.abroadOnly}</Badge>
              </span>
            )}
          </div>
          {f?.summary && (
            <p className="line-clamp-2 text-nd-body text-nd-fg-2" title={f.summary}>
              {f.summary}
            </p>
          )}
          {f?.hook && (
            <p className="line-clamp-2 text-[13px] text-nd-fg-3" title={f.hook}>
              <span className="font-medium text-nd-fg-2">첫 장면 </span>
              {f.hook}
            </p>
          )}
          {shown.length > 0 && (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-nd-fg-2">구성</p>
              {flow ? (
                <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5" aria-label="구성 순서">
                  {shown.map((s, i) => (
                    <li key={i} className="flex min-w-0 max-w-full items-center gap-1.5">
                      {i > 0 && <ArrowRight size={13} className="shrink-0 text-nd-fg-4" aria-hidden />}
                      <span className="min-w-0 truncate rounded-nd-sm border border-nd-line bg-nd-sunken px-2.5 py-1 text-[13px] text-nd-fg-2" title={s}>
                        {s}
                      </span>
                    </li>
                  ))}
                  {steps.length > shown.length && <li className="text-[13px] text-nd-fg-3">외 {steps.length - shown.length}단계</li>}
                </ol>
              ) : (
                <ol className="space-y-1" aria-label="구성 순서">
                  {shown.map((s, i) => (
                    <li key={i} className="flex min-w-0 items-center gap-2 text-[13px] text-nd-fg-2">
                      <span className="nd-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-nd-sunken text-[12px] font-semibold text-nd-fg-2 ring-1 ring-nd-line" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="min-w-0 truncate" title={s}>
                        {s}
                      </span>
                    </li>
                  ))}
                  {steps.length > shown.length && <li className="pl-7 text-[13px] text-nd-fg-3">외 {steps.length - shown.length}단계</li>}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[13px] text-nd-fg-3">
        <p>{ev.text}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>예시 {l.examples}편</span>
          <span aria-hidden>·</span>
          <CountryText codes={l.countries} className="min-w-0 break-words" />
          <span aria-hidden>·</span>
          <span>
            배수 중앙값 <Multiple value={l.medianMultiple} />
          </span>
          {lag !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span>
                해외 → 한국 <span className="nd-num">{lag}</span>일
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <AiBadge level={l.ai} size="sm" />
          <LangBadge dep={l.lang} size="sm" />
        </p>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2 pt-3 [@container(min-width:360px)]:grid-cols-2">
        {l.top ? (
          <a href={l.top.url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "w-full gap-1.5")} title={l.top.title || l.top.url}>
            <PlayCircle size={16} aria-hidden />
            대표 영상 보기
          </a>
        ) : (
          <Button variant="secondary" disabled className="w-full">
            대표 영상 없음
          </Button>
        )}
        <Button trailingIcon={ArrowRight} className="w-full" onClick={() => onOpen(l.formatId)}>
          형식 자세히
        </Button>
      </div>
    </Card>
  );
}

/** AI 요약 — 앞 두 줄만, 나머지 · 생성 정보는 「요약 자세히」 */
function Summary({ r, byWho, actions }: { r: ScoutReportDoc; byWho: (by: string) => string; actions: ScoutRunActions }) {
  const [open, setOpen] = useState(false);
  const nar = r.narrative;
  const lines = (nar?.text ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const shown = open ? lines : lines.slice(0, 2);
  return (
    <Card>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone="accent" size="lg">
            <Sparkles size={13} aria-hidden /> AI 요약
          </Badge>
          <span className="text-[13px] text-nd-fg-3">보고 수치 기반 · 사실 확인 아님</span>
        </div>
        {nar && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-[13px] font-medium text-nd-accent hover:underline">
            요약 자세히
            <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {nar ? (
        <>
          <Narrative lines={shown} clamp={!open} />
          {open && (
            <p className="mt-2.5 text-[13px] text-nd-fg-3">
              {nar.model} · {fmtUsd(nar.costUsd)} · {fmtWhen(nar.at)} · {byWho(nar.by)} — 보고서 숫자만 근거로 AI 가 쓴 글입니다
            </p>
          )}
          {nar.at < r.createdAt && (
            <InlineNotice tone="warning" className="mt-3">
              보고가 요약 뒤에 새로 고쳐졌습니다 — 「AI 요약 다시」 를 누르면 최신 숫자로 다시 씁니다.
            </InlineNotice>
          )}
        </>
      ) : (
        <div className="space-y-2.5">
          <p className="text-nd-body text-nd-fg-3">아직 AI 요약이 없습니다. 이 보고의 숫자만 근거로 짧게 씁니다.</p>
          <Button size="sm" variant="secondary" icon={Sparkles} loading={actions.busy === "narrate"} disabled={actions.busy !== null || !!actions.blocked.narrate} onClick={actions.narrate}>
            AI 요약 붙이기
          </Button>
        </div>
      )}
    </Card>
  );
}

/** AI 요약 본문 — 「- 」 목록은 목록으로, 나머지는 문단으로 */
function Narrative({ lines, clamp }: { lines: string[]; clamp: boolean }) {
  const bullet = /^([-•·*]|\d+[.)])\s+/;
  return (
    <div className="space-y-1.5 text-nd-body leading-relaxed">
      {lines.map((line, i) =>
        bullet.test(line) ? (
          <p key={i} className="flex gap-2">
            <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-nd-accent" />
            <span className={cn("min-w-0 break-words", clamp && "line-clamp-2")}>{line.replace(bullet, "")}</span>
          </p>
        ) : (
          <p key={i} className={cn("break-words", clamp && "line-clamp-2")}>
            {line}
          </p>
        ),
      )}
    </div>
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
  return (
    <section>
      <SectionHeader size="lg" title={title} hint={hint} />
      {lines.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">{empty}</p>
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table size="md" minWidth={1040}>
              <thead>
                <tr>
                  <Th>형식</Th>
                  <Th>수명</Th>
                  <Th>나라</Th>
                  <Th align="right">예시</Th>
                  <Th align="right">배수 중앙값</Th>
                  <Th title="국내 검색 표본 · 국내 터진 영상 기준">한국 · 시차</Th>
                  <Th>AI 재현 · 언어</Th>
                  <Th>대표 영상</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const f = formatById.get(l.formatId);
                  const top = l.top ? hitByUrl.get(l.top.url) : undefined;
                  const lag = lagOf.get(l.formatId);
                  return (
                    <Tr key={l.formatId}>
                      <Td className="max-w-[260px]">
                        <button type="button" className="block w-full min-w-0 text-left" onClick={() => onOpen(l.formatId)}>
                          <span className="block truncate font-semibold hover:underline" title={l.name}>
                            {l.name}
                          </span>
                          {f?.summary && (
                            <span className="line-clamp-2 text-[13px] text-nd-fg-3" title={f.summary}>
                              {f.summary}
                            </span>
                          )}
                        </button>
                      </Td>
                      <Td>
                        <LifeBadge stage={l.stage} basis={l.basis} size="lg" />
                      </Td>
                      <Td className="max-w-[140px]">
                        <CountryText codes={l.countries} className="line-clamp-2" />
                      </Td>
                      <Td num>
                        {l.examples}
                        <span className="ml-0.5 text-nd-fg-3">편</span>
                      </Td>
                      <Td num>
                        <Multiple value={l.medianMultiple} />
                      </Td>
                      <Td>
                        <KoreaBadge status={l.korea} size="lg" />
                        {lag !== undefined && (
                          <span className="mt-1 block text-[13px] text-nd-fg-3">
                            해외 → 한국 <span className="nd-num">{lag}</span>일
                          </span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <AiBadge level={l.ai} />
                          <LangBadge dep={l.lang} />
                        </div>
                      </Td>
                      <Td className="max-w-[260px]">
                        {l.top ? (
                          <a href={l.top.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 hover:underline" title={l.top.title}>
                            <VideoThumb src={top?.thumbnail} duration={top?.duration} className="h-10 w-[70px]" />
                            <span className="min-w-0">
                              <span className="block">
                                <Multiple value={l.top.multiple} />
                              </span>
                              <span className="block truncate text-[13px] text-nd-fg-2">{l.top.title || l.top.url}</span>
                            </span>
                          </a>
                        ) : (
                          <span className="text-nd-fg-3">—</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {note && lines.length > 0 && <Note className="mt-2">※ {note}</Note>}
    </section>
  );
}
