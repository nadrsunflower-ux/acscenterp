"use client";

// 주간 보고 — 매일 아침 이번 주 것이 새로 고쳐지고, 월요일에 새 주가 시작된다 (KST).
//   해외에서 떠오르는데 국내 표본엔 아직 없는 형식 · 떠오르는 형식 · 포화 조짐 · 이번 주 새로 터진 영상 · 시차
import { useState } from "react";
import { FileText, RefreshCw, Sparkles } from "lucide-react";
import { Button, Card, EmptyState, SectionHeader, Select, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtCount } from "@/lib/neander/shorts/model";
import { countryLabel, fmtMultiple, type ReportFormatLine } from "@/lib/neander/shorts/scout";
import { AiBadge, CountryTag, KoreaBadge, LangBadge, LifeBadge, fmtAgo, fmtDate } from "./bits";
import { scout, type ScoutData } from "./useScout";

export function ReportTab({ d, refresh, onOpenFormat }: { d: ScoutData; refresh: () => Promise<void>; onOpenFormat: (id: string) => void }) {
  const { busy, run } = useAction();
  const { nameOf } = useShorts();
  const [week, setWeek] = useState<string>(d.reports[0]?.week ?? "");
  const r = d.reports.find((x) => x.week === week) ?? d.reports[0] ?? null;

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
        icon={FileText}
        title="아직 주간 보고가 없습니다"
        description="감시 채널을 넣고 훑은 뒤 영상을 형식 카드에 묶으면 보고에 담깁니다. 매일 아침 자동으로 새로 고쳐집니다."
        action={<Button size="sm" icon={RefreshCw} onClick={() => void build()} disabled={busy === "build"}>지금 만들기</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select size="sm" value={r.week} onChange={(e) => setWeek(e.target.value)} aria-label="주">
            {d.reports.map((x) => (
              <option key={x.week} value={x.week}>{x.week} ({fmtDate(new Date(x.from).toISOString())} ~ {fmtDate(new Date(x.to).toISOString())})</option>
            ))}
          </Select>
          <span className="text-nd-body text-nd-fg-3">{fmtWhen(r.createdAt)} 기준 · {r.createdBy === "company" ? "매일 아침 자동" : nameOf(r.createdBy)}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void build()} disabled={busy === "build"}>지금 새로 만들기</Button>
          <Button
            size="sm"
            icon={Sparkles}
            disabled={busy === "narrate"}
            onClick={() =>
              void run("narrate", async () => {
                await scout("report.narrate", { week: r.week });
                await refresh();
              }, "AI 요약을 붙였습니다.")
            }
          >
            {r.narrative ? "AI 요약 다시" : "AI 요약 붙이기"}
          </Button>
        </div>
      </div>

      <Card>
        <p className="text-nd-body">
          감시 채널 <b>{r.counts.channels}곳</b>(이번 주 훑은 곳 {r.counts.scanned}) · 이번 주 새로 터진 영상 <b>{r.counts.newHits}편</b>
          {r.counts.byCountry.length > 0 && <> ({r.counts.byCountry.map((c) => `${countryLabel(c.country)} ${c.hits}`).join(" · ")})</>}
          {" "}· 그중 분석 {r.counts.analyzed}편 · 형식 카드 {r.counts.formats}장 · 아직 안 묶은 영상 {r.counts.unassigned}편
        </p>
        {r.narrative && (
          <div className="mt-4 border-t border-nd-line pt-4">
            <p className="whitespace-pre-line text-nd-body leading-relaxed">{r.narrative.text}</p>
            <p className="mt-2 text-nd-caption text-nd-fg-3">
              AI 요약 (보고서 숫자만 근거) · {r.narrative.model} · {fmtUsd(r.narrative.costUsd)} · {fmtWhen(r.narrative.at)}
              {r.narrative.at < r.createdAt ? " · 보고가 그 뒤에 새로 고쳐졌습니다 — 다시 요약하면 최신이 됩니다" : ""}
            </p>
          </div>
        )}
      </Card>

      <FormatSection
        title="해외에서 보이는데 국내 표본엔 아직 없는 형식"
        hint="들여올 후보 — 국내 확인 전이거나, 국내 검색 표본에서 못 찾은 것"
        lines={r.abroadOnly}
        empty="해당하는 형식이 없습니다. 해외 감시 채널을 늘리거나 형식 카드의 「한국에 이미 있나」 를 확인해 보세요."
        onOpen={onOpenFormat}
      />
      <FormatSection title="떠오르는 형식" hint="최근 2주에 여러 채널에서 터진 형식 · 씨앗(한 편)" lines={r.rising} empty="떠오르는 형식이 없습니다." onOpen={onOpenFormat} />
      {r.saturating.length > 0 && <FormatSection title="포화 조짐" hint="편수는 많은데 최근 배수가 떨어지는 형식 — 늦게 타면 손해" lines={r.saturating} empty="" onOpen={onOpenFormat} />}

      <div>
        <SectionHeader title="이번 주 새로 터진 영상" hint="배수 큰 순 · 최대 15편" />
        {r.newHits.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">이번 주에 새로 찾은 영상이 없습니다.</p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table minWidth={860}>
                <thead>
                  <tr>
                    <Th>영상</Th>
                    <Th>나라</Th>
                    <Th>올린 지</Th>
                    <Th align="right">조회</Th>
                    <Th align="right">배수</Th>
                    <Th>형식</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.newHits.map((h) => (
                    <Tr key={h.hitId}>
                      <Td className="max-w-[380px]">
                        <a href={h.url} target="_blank" rel="noreferrer" className="line-clamp-1 font-medium hover:underline">{h.title}</a>
                        <span className="text-nd-caption text-nd-fg-3">{h.channel}</span>
                      </Td>
                      <Td>{h.country ? <CountryTag code={h.country} /> : "—"}</Td>
                      <Td className="text-nd-table">{fmtAgo(h.publishedAt)}</Td>
                      <Td num>{fmtCount(h.views)}</Td>
                      <Td num>{fmtMultiple(h.multiple)}</Td>
                      <Td className="text-nd-table">{h.formatName ?? (h.analyzed ? "분석됨 · 안 묶음" : "분석 전")}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </div>

      <div>
        <SectionHeader title="시차 — 해외에서 처음 본 날 → 한국에 처음 나타난 날" hint="쌓일수록 어느 나라를 더 자주 볼지가 데이터로 정해집니다" />
        {r.lags.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">
            아직 계산할 형식이 없습니다. 해외 영상과 국내 영상(국내 터진 영상 또는 「한국에 이미 있나」 에서 고른 영상)이 같은 카드에 함께 묶이면 생깁니다.
          </p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table minWidth={640}>
                <thead>
                  <tr>
                    <Th>형식</Th>
                    <Th>처음 본 나라</Th>
                    <Th>해외 처음</Th>
                    <Th>한국 처음</Th>
                    <Th align="right">시차</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.lags.map((l) => (
                    <Tr key={l.formatId}>
                      <Td><button type="button" className="font-medium hover:underline" onClick={() => onOpenFormat(l.formatId)}>{l.name}</button></Td>
                      <Td><CountryTag code={l.from} /></Td>
                      <Td className="text-nd-table">{fmtDate(l.foreignFirst)}</Td>
                      <Td className="text-nd-table">{fmtDate(l.koreaFirst)}</Td>
                      <Td num>{l.days}일</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </div>
    </div>
  );
}

function FormatSection({ title, hint, lines, empty, onOpen }: { title: string; hint: string; lines: ReportFormatLine[]; empty: string; onOpen: (id: string) => void }) {
  return (
    <div>
      <SectionHeader title={title} hint={hint} />
      {lines.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">{empty}</p>
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={980}>
              <thead>
                <tr>
                  <Th>형식</Th>
                  <Th>수명</Th>
                  <Th>나라</Th>
                  <Th align="right">예시</Th>
                  <Th align="right">배수 중앙값</Th>
                  <Th>한국</Th>
                  <Th>AI 재현 · 언어</Th>
                  <Th>대표 영상</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.formatId}>
                    <Td><button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen(l.formatId)}>{l.name}</button></Td>
                    <Td><LifeBadge stage={l.stage} basis={l.basis} /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">{l.countries.map((c) => <CountryTag key={c} code={c} />)}</div>
                    </Td>
                    <Td num>{l.examples}</Td>
                    <Td num>{fmtMultiple(l.medianMultiple)}</Td>
                    <Td><KoreaBadge status={l.korea} /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1"><AiBadge level={l.ai} /><LangBadge dep={l.lang} /></div>
                    </Td>
                    <Td className="max-w-[260px]">
                      {l.top ? (
                        <a href={l.top.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-nd-table hover:underline" title={l.top.title}>
                          {fmtMultiple(l.top.multiple)} · {l.top.title}
                        </a>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}

