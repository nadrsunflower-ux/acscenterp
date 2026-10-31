"use client";

// 주간 보고 — 매일 아침 이번 주 것이 새로 고쳐지고, 월요일에 새 주가 시작된다 (KST).
//   해외에서 떠오르는데 국내 표본엔 아직 없는 형식 · 떠오르는 형식 · 포화 조짐 · 이번 주 새로 터진 영상 · 시차
//   숫자는 모두 원본(남의 채널) 영상의 반응이다 — 우리 영상 성과가 아니다.
import { useMemo, useState } from "react";
import { FileText, RefreshCw, Sparkles } from "lucide-react";
import { Badge, Button, Card, EmptyState, InlineNotice, KpiItem, KpiStrip, SectionHeader, Select, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { Num, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import { KOREA_LABEL, countryLabel, type ReportFormatLine } from "@/lib/neander/shorts/scout";
import { Ago, AiBadge, CountryText, KoreaBadge, LangBadge, LifeBadge, Multiple, Note, VideoThumb, fmtDate } from "./bits";
import { scout, type ScoutData } from "./useScout";

export function ReportTab({ d, refresh, onOpenFormat, onOpenHits }: { d: ScoutData; refresh: () => Promise<void>; onOpenFormat: (id: string) => void; onOpenHits?: () => void }) {
  const { busy, run } = useAction();
  const { nameOf } = useShorts();
  const [week, setWeek] = useState<string>(d.reports[0]?.week ?? "");
  const r = d.reports.find((x) => x.week === week) ?? d.reports[0] ?? null;
  const hitById = useMemo(() => new Map(d.hits.map((h) => [h.id, h])), [d.hits]);

  const build = () =>
    run(
      "build",
      async () => {
        const out = await scout<{ week: string }>("report.build");
        await refresh();
        setWeek(out.week);
      },
      "이번 주 보고를 새로 만들었습니다.",
    );

  if (!r) {
    return (
      <EmptyState
        compact
        icon={FileText}
        title="아직 주간 보고가 없습니다"
        description="감시 채널을 넣고 훑은 뒤 영상을 형식 카드에 묶으면 보고에 담깁니다. 매일 아침 자동으로 새로 고쳐집니다."
        action={<Button size="sm" icon={RefreshCw} onClick={() => void build()} disabled={busy === "build"}>지금 만들기</Button>}
      />
    );
  }

  const c = r.counts;
  const lagOf = new Map(r.lags.map((l) => [l.formatId, l.days]));
  const byCountryAll = c.byCountry.map((x) => `${countryLabel(x.country)} ${x.hits}`);
  // 칸이 좁아 앞의 세 나라만 — 전체는 마우스를 올리면
  const byCountry = byCountryAll.length > 3 ? `${byCountryAll.slice(0, 3).join(" · ")} 외 ${byCountryAll.length - 3}` : byCountryAll.join(" · ");

  return (
    <div className="space-y-7">
      {/* 주 고르기 · 다시 만들기 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Select size="md" className="w-auto min-w-[260px]" value={r.week} onChange={(e) => setWeek(e.target.value)} aria-label="주">
            {d.reports.map((x) => (
              <option key={x.week} value={x.week}>{x.week} · {fmtDate(new Date(x.from).toISOString())} ~ {fmtDate(new Date(x.to).toISOString())}</option>
            ))}
          </Select>
          <span className="text-[13px] text-nd-fg-3">{fmtWhen(r.createdAt)} 기준 · {r.createdBy === "company" ? "매일 아침 자동" : nameOf(r.createdBy)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={RefreshCw} onClick={() => void build()} disabled={busy === "build"}>{busy === "build" ? "만드는 중…" : "지금 새로 만들기"}</Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Sparkles}
            disabled={busy === "narrate"}
            onClick={() =>
              void run("narrate", async () => {
                await scout("report.narrate", { week: r.week });
                await refresh();
              }, "AI 요약을 붙였습니다.")
            }
          >
            {busy === "narrate" ? "요약하는 중…" : r.narrative ? "AI 요약 다시" : "AI 요약 붙이기"}
          </Button>
        </div>
      </div>

      {/* 이번 주 숫자 — 보고서에 있는 것만 */}
      <div className="space-y-2">
        <KpiStrip columns={6}>
          <KpiItem label="감시 채널" value={c.channels} unit="곳" hint="훑기를 켜 둔 채널" />
          <KpiItem label="이번 주 훑은 채널" value={c.scanned} unit="곳" hint={`감시 채널 ${c.channels}곳 중`} />
          <KpiItem label="새로 터진 영상" value={c.newHits} unit="편" hint={byCountry ? <span title={byCountryAll.join(" · ")}>{byCountry}</span> : "이번 주 찾은 것"} />
          <KpiItem label="분석 완료" value={c.analyzed} unit="편" hint="새로 터진 영상 중" />
          <KpiItem label="형식 카드" value={c.formats} unit="장" hint="예시가 묶인 카드" />
          <KpiItem
            label="아직 안 묶은 영상"
            value={c.unassigned}
            unit="편"
            hint={
              c.unassigned > 0 && onOpenHits ? (
                <button type="button" className="text-nd-accent hover:underline" onClick={onOpenHits}>터진 영상 탭에서 묶기</button>
              ) : (
                "형식 카드에 묶기 전"
              )
            }
          />
        </KpiStrip>
        <Note>숫자는 모두 감시 채널 · 직접 등록한 원본 영상의 반응입니다 — 우리 영상 성과가 아닙니다.</Note>
      </div>

      {r.narrative && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent" size="lg">
                <Sparkles size={13} aria-hidden /> AI 요약
              </Badge>
              <span className="text-[13px] text-nd-fg-3">보고서 숫자만 근거로 AI 가 쓴 글입니다 · 사실 확인 아님</span>
            </div>
            <span className="text-[13px] text-nd-fg-3">{r.narrative.model} · {fmtUsd(r.narrative.costUsd)} · {fmtWhen(r.narrative.at)}</span>
          </div>
          <Narrative text={r.narrative.text} />
          {r.narrative.at < r.createdAt && (
            <InlineNotice tone="warning" className="mt-3">보고가 요약 뒤에 새로 고쳐졌습니다 — 「AI 요약 다시」 를 누르면 최신 숫자로 다시 씁니다.</InlineNotice>
          )}
        </Card>
      )}

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
      {r.saturating.length > 0 && (
        <FormatSection d={d} title="포화 조짐" hint="편수는 많은데 최근 배수가 떨어지는 형식 — 늦게 타면 손해" lines={r.saturating} lagOf={lagOf} empty="" onOpen={onOpenFormat} />
      )}

      <section>
        <SectionHeader size="lg" title="이번 주 새로 터진 영상" hint="배수 큰 순 · 최대 15편 · 원본 영상의 반응" />
        {r.newHits.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">이번 주에 새로 찾은 영상이 없습니다.</p>
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
                              <a href={l.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline" title={l.title || l.url}>{l.title || l.url}</a>
                              <span className="block truncate text-[13px] text-nd-fg-3" title={l.channel}>{l.channel || "채널 모름"}</span>
                            </span>
                          </div>
                        </Td>
                        <Td><CountryText codes={[l.country]} /></Td>
                        <Td><Ago iso={l.publishedAt} /></Td>
                        <Td num><Num value={l.views} /></Td>
                        <Td num><Multiple value={l.multiple} /></Td>
                        <Td className="max-w-[240px]">
                          {l.formatName ? (
                            fid ? (
                              <button type="button" className="block max-w-full truncate text-left font-medium text-nd-accent hover:underline" title={l.formatName} onClick={() => onOpenFormat(fid)}>{l.formatName}</button>
                            ) : (
                              <span className="block truncate font-medium" title={l.formatName}>{l.formatName}</span>
                            )
                          ) : (
                            <Badge tone={l.analyzed ? "info" : "neutral"} size="lg">{l.analyzed ? "분석됨 · 안 묶음" : "분석 전"}</Badge>
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
                      <Td><button type="button" className="text-left font-medium hover:underline" onClick={() => onOpenFormat(l.formatId)}>{l.name}</button></Td>
                      <Td><CountryText codes={[l.from]} /></Td>
                      <Td className="nd-num">{fmtDate(l.foreignFirst)}</Td>
                      <Td className="nd-num">{fmtDate(l.koreaFirst)}</Td>
                      <Td num>{l.days}<span className="ml-0.5 text-nd-fg-3">일</span></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>
    </div>
  );
}

/** AI 요약 본문 — 「- 」 목록은 목록으로, 나머지는 문단으로 */
function Narrative({ text }: { text: string }) {
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const bullet = /^([-•·*]|\d+[.)])\s+/;
  return (
    <div className="space-y-1.5 text-nd-body leading-relaxed">
      {lines.map((line, i) =>
        bullet.test(line) ? (
          <p key={i} className="flex gap-2">
            <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-nd-accent" />
            <span>{line.replace(bullet, "")}</span>
          </p>
        ) : (
          <p key={i}>{line}</p>
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
                          <span className="block truncate font-semibold hover:underline" title={l.name}>{l.name}</span>
                          {f?.summary && <span className="line-clamp-2 text-[13px] text-nd-fg-3" title={f.summary}>{f.summary}</span>}
                        </button>
                      </Td>
                      <Td><LifeBadge stage={l.stage} basis={l.basis} size="lg" /></Td>
                      <Td className="max-w-[140px]"><CountryText codes={l.countries} className="line-clamp-2" /></Td>
                      <Td num>{l.examples}<span className="ml-0.5 text-nd-fg-3">편</span></Td>
                      <Td num><Multiple value={l.medianMultiple} /></Td>
                      <Td>
                        <KoreaBadge status={l.korea} size="lg" />
                        {lag !== undefined && <span className="mt-1 block text-[13px] text-nd-fg-3">해외 → 한국 <span className="nd-num">{lag}</span>일</span>}
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1"><AiBadge level={l.ai} /><LangBadge dep={l.lang} /></div>
                      </Td>
                      <Td className="max-w-[260px]">
                        {l.top ? (
                          <a href={l.top.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 hover:underline" title={l.top.title}>
                            <VideoThumb src={top?.thumbnail} duration={top?.duration} className="h-10 w-[70px]" />
                            <span className="min-w-0">
                              <span className="block"><Multiple value={l.top.multiple} /></span>
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
