"use client";

// ============================================================
//  성과 탭 — 우리 영상의 게시물별 지표 (자동 조회 · 직접 입력 구분) · 정보 요청 · 클릭 · 주문 · 비용
// ------------------------------------------------------------
//  합계는 게시물마다 출처별 마지막 기록을 쓰고, 같은 지표가 API 와 직접 입력에
//  둘 다 있으면 API 를 쓴다 (model.projectTotals). 모르는 지표는 「미확인」 (0 이 아니다).
//  DM 요청 수는 API 로 읽지 않는다 — 직접 센 값을 적는다.
//  해외 원본 영상의 반응(소재 발굴 기록)은 따로 보이고 합계에 넣지 않는다.
// ============================================================

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, Field, FieldAction, FormRow, IconButton, InlineNotice, Input, KpiItem, KpiStrip, NumberInput, SectionHeader, Select, Table, TableScroll, Td, Th, Tr, buttonClass, cn, flowTextClass } from "@/components/neander/ui";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { CTA_LABEL, METRIC_LABEL, PLATFORM_LABEL, fmtPct, newId, perfRates, projectCost, projectTotals } from "@/lib/neander/shorts/model";
import type { CostEntry, MetricSnapshotView, PerfMetricKey } from "@/lib/neander/shorts/types";
import { useShorts } from "../ShortsProvider";
import { Num, SourceTag, Unknown, fmtUsd, fmtWhen, useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

const KEYS: PerfMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"];
const SOURCE: Record<MetricSnapshotView["source"], string> = { youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡 리포트 API", manual: "직접 입력" };
const COST_KIND: Record<CostEntry["kind"], string> = { ai_text: "AI 글", ai_voice: "AI 음성", ai_video: "AI 영상", material: "샘플 · 재료", labor: "작업 시간", other: "기타" };
const num = (n: number) => n.toLocaleString("ko-KR");

export function PerformanceTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { data, refresh } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const snaps = d.metrics.filter((m) => m.projectId === p.id);
  const pubs = d.publications.filter((x) => x.projectId === p.id && x.status === "published");
  const totals = useMemo(() => projectTotals(snaps), [snaps]);
  const rates = perfRates(totals);
  const cost = projectCost(p);
  const template = d.templates.find((t) => t.id === p.templateId);
  const trend = p.trendId ? d.trends.find((t) => t.id === p.trendId) ?? null : null;
  // 게시 계정 연결 — 자동 조회는 게시한 계정의 토큰으로 읽는다
  const accounts = d.accounts.filter((a) => a.canPublish && (p.kind === "brand" ? !a.clientId || a.clientId === p.clientId : !a.clientId));
  const connected = accounts.filter((a) => a.status === "connected");
  const [form, setForm] = useState<{ publicationId: string; values: Partial<Record<PerfMetricKey, string>>; note: string }>({ publicationId: "", values: {}, note: "" });
  const [costForm, setCostForm] = useState({ kind: "labor" as CostEntry["kind"], minutes: "", krw: "", note: "" });

  // 비율은 무엇으로 나눴는지 함께 (전체 계산은 마우스를 올리면)
  const rateHint = (label: string, rate: number | null, top: number | null, bottom: number | null, topName: string, bottomName: string) =>
    rate === null ? (
      <span title={`${topName} · ${bottomName} 기록이 있어야 계산합니다`}>{label} 미확인</span>
    ) : (
      <span title={`${topName} ${num(top ?? 0)} ÷ ${bottomName} ${num(bottom ?? 0)}`}>
        {label} <b className="nd-num font-semibold text-nd-fg-2">{fmtPct(rate)}</b> · {bottomName} 대비
      </span>
    );

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader
          size="lg"
          title="우리 영상 성과 · 합계"
          hint={`근거: ${[...totals.sources].map((s) => SOURCE[s as MetricSnapshotView["source"]]).join(" · ") || "기록 없음"} · 게시물마다 마지막 기록 기준`}
        />
        <KpiStrip columns={6}>
          <KpiItem label="조회" value={<KpiNum v={totals.views} />} hint={pubs.length ? `게시물 ${pubs.length}개 합` : "게시된 게시물 없음"} />
          <KpiItem label="정보 요청" value={<KpiNum v={totals.infoRequests} />} hint={rateHint("요청률", rates.infoRate, totals.infoRequests, totals.views, "정보 요청", "조회")} />
          <KpiItem label="제휴 클릭" value={<KpiNum v={totals.clicks} />} hint={rateHint("클릭률", rates.ctr, totals.clicks, totals.views, "클릭", "조회")} />
          <KpiItem label="주문" value={<KpiNum v={totals.orders} />} hint={rateHint("전환율", rates.cvr, totals.orders, totals.clicks, "주문", "클릭")} />
          <KpiItem label="제휴 수익" value={<KpiNum v={totals.revenue === null ? null : Math.round(totals.revenue)} unit="원" flow="income" />} hint={rates.revenuePerKView !== null ? `조회 1,000회당 ${num(Math.round(rates.revenuePerKView))}원` : "쿠팡 리포트 · 직접 입력"} />
          <KpiItem label="제작 비용" value={<KpiNum v={cost.krw} unit="원" flow="expense" />} hint={`AI ${fmtUsd(cost.aiUsd || null)} · 작업 ${num(cost.minutes)}분`} />
        </KpiStrip>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-nd-md bg-nd-fg/[.03] px-4 py-2.5">
          <span className="text-[13px] font-medium text-nd-fg-2">반응</span>
          {(["likes", "comments", "saves", "shares"] as const).map((k) => (
            <span key={k} className="inline-flex items-baseline gap-1.5 text-nd-body">
              <span className="text-[13px] text-nd-fg-3">{METRIC_LABEL[k]}</span>
              <Num value={totals[k]} />
            </span>
          ))}
          <span className="text-[13px] text-nd-fg-3">공개되지 않은 저장 · 공유는 「미확인」 으로 둡니다 (0 이 아닙니다)</span>
        </div>
        <p className="mt-2 text-[13px] text-nd-fg-3">
          쓴 공식: {template?.name ?? "(없음)"} · CTA: {CTA_LABEL[p.cta.type]}{p.cta.keyword ? ` 「${p.cta.keyword}」` : ""}. 클릭 · 전환율 · 수익은 쿠팡 파트너스 기밀정보라 ERP 밖으로 공유하지 않습니다.
        </p>
      </section>

      {trend && (
        <section>
          <SectionHeader size="lg" title="원본 반응 (참고)" hint="해외 원본 영상의 숫자 — 소재 발굴 기록입니다. 위 「우리 영상 성과」 합계에 넣지 않습니다." />
          <Card padding="sm" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="min-w-0 max-w-full truncate text-nd-body font-medium sm:max-w-[24rem]" title={trend.title}>
              {PLATFORM_LABEL[trend.platform]} · {trend.title || trend.channel || "제목 없음"}
            </span>
            {(["views", "likes", "comments", "saves", "shares"] as const).map((k) => (
              <span key={k} className="inline-flex items-baseline gap-1.5 text-nd-body">
                <span className="text-[13px] text-nd-fg-3">원본 {METRIC_LABEL[k]}</span>
                <Num value={trend.metrics[k].v} />
              </span>
            ))}
            <span className="ml-auto inline-flex items-center gap-2 text-[13px] text-nd-fg-3">
              <SourceTag src={trend.metrics.views.src} />
              {fmtWhen(trend.collectedAt)} 기록
              {/^https?:\/\//.test(trend.url) && (
                <a href={trend.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-nd-accent hover:underline">
                  원본 보기 <ExternalLink size={12} aria-hidden />
                </a>
              )}
            </span>
          </Card>
        </section>
      )}

      <section>
        <SectionHeader size="lg" title="자동 조회" hint="공식 API 로 읽은 값은 「YouTube API」 · 「Instagram API」 · 「쿠팡 리포트 API」 로 표시됩니다" />
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {pubs.map((x) => (
              <Button key={x.id} size="sm" variant="secondary" icon={RefreshCw} disabled={busy === x.id} onClick={() => void run(x.id, async () => { await shortsPost("research", { action: "metrics.sync", publicationId: x.id }); await refresh(); }, `${PLATFORM_LABEL[x.platform]} 성과를 공식 API 로 읽었습니다.`)}>
                {PLATFORM_LABEL[x.platform]} 가져오기
              </Button>
            ))}
            <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!d.status.coupang.configured || busy === "cp"} title={!d.status.coupang.configured ? "쿠팡 파트너스 키가 없어 리포트를 읽을 수 없습니다" : undefined} onClick={() => void run("cp", async () => { await shortsPost("research", { action: "coupang.reports" }); await refresh(); }, "쿠팡 리포트를 읽었습니다 (최근 90일).")}>
              쿠팡 리포트{d.status.coupang.configured ? "" : " (키 없음)"}
            </Button>
            {!pubs.length && <span className="text-[13px] text-nd-fg-3">게시된 게시물이 없어 YouTube · Instagram 에서 가져올 대상이 없습니다.</span>}
          </div>
          {!connected.length && (
            <InlineNotice tone="warning" action={<Link href="/neander/shorts/accounts" className={buttonClass("secondary", "sm")}><Plug size={14} aria-hidden className="mr-1" />계정 연결</Link>}>
              연결된 SNS 계정이 없어 YouTube · Instagram 성과를 자동으로 읽지 못합니다. 아래 「직접 입력」 으로 기록하세요.
            </InlineNotice>
          )}
          <p className="text-[13px] leading-relaxed text-nd-fg-3">
            YouTube · Instagram 은 게시한 계정의 토큰으로 조회 · 좋아요 · 댓글(· 저장 · 공유)을 읽고, 최근 댓글에서 정보 요청 낱말이 든 댓글을 셉니다(최소값). 쿠팡 주문 · 수익은 확인한 상품 id 로 묶고, 클릭은 영상 전용 채널 아이디가 있을 때만 붙습니다. 매일 06:30 cron 이 최근 30일 게시물을 다시 읽습니다.
          </p>
        </Card>
      </section>

      <section>
        <SectionHeader size="lg" title="직접 입력" hint="DM 요청 · 저장처럼 API 로 못 읽는 값 · 비워 둔 칸은 「미확인」 으로 남습니다 (0 과 다릅니다)" />
        <Card className="space-y-4">
          <Field label="게시물">
            <Select value={form.publicationId} onChange={(e) => setForm({ ...form, publicationId: e.target.value })}>
              <option value="">(게시물 무관 · 쿠팡 등)</option>
              {d.publications.filter((x) => x.projectId === p.id).map((x) => <option key={x.id} value={x.id}>{PLATFORM_LABEL[x.platform]} · {x.result?.url ?? x.status}</option>)}
            </Select>
          </Field>
          <FormRow className="grid-cols-3 sm:grid-cols-5 xl:grid-cols-9">
            {KEYS.map((k) => (
              <Field key={k} label={k === "revenue" ? `${METRIC_LABEL[k]} (원)` : METRIC_LABEL[k]}>
                <NumberInput value={form.values[k] ?? ""} placeholder="미확인" onValueChange={(r) => setForm({ ...form, values: { ...form.values, [k]: r } })} />
              </Field>
            ))}
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="근거 메모"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="예: 10/31 인스타 DM 요청 직접 셈" /></Field>
            <FieldAction size="md">
              <Button disabled={busy === "add" || !Object.values(form.values).some((v) => v !== "" && v !== undefined)} onClick={() => void run("add", async () => {
                const values = Object.fromEntries(Object.entries(form.values).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, Number(v)]));
                const pub = d.publications.find((x) => x.id === form.publicationId);
                await mutate("metric.add", { projectId: p.id, publicationId: form.publicationId || null, platform: pub?.platform ?? "other", values, note: form.note });
                setForm({ publicationId: form.publicationId, values: {}, note: "" });
                await refresh();
              }, "기록했습니다.")}>기록</Button>
            </FieldAction>
          </FormRow>
        </Card>
      </section>

      <section>
        <SectionHeader size="lg" title="기록" hint={snaps.length ? `${snaps.length}건 · 최근 것이 위` : "아직 기록이 없습니다"} />
        {snaps.length === 0 ? (
          <p className="rounded-nd-md border border-dashed border-nd-strong px-4 py-4 text-nd-body text-nd-fg-3">자동 조회나 직접 입력으로 남긴 성과 기록이 여기에 쌓입니다.</p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table size="md" minWidth={1080}>
                <thead>
                  <tr>
                    <Th className="whitespace-nowrap">기록 시각</Th>
                    <Th>출처 · 대상</Th>
                    {KEYS.map((k) => <Th key={k} align="right" className="whitespace-nowrap">{METRIC_LABEL[k]}</Th>)}
                    <Th>메모</Th>
                    <Th className="w-12"> </Th>
                  </tr>
                </thead>
                <tbody>
                  {[...snaps].sort((a, b) => b.at - a.at).map((s) => (
                    <Tr key={s.id}>
                      <Td muted className="whitespace-nowrap">{fmtWhen(s.at)}</Td>
                      <Td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone={s.source === "manual" ? "neutral" : "info"}>{SOURCE[s.source]}</Badge>
                          {s.platform === "other" ? "게시물 무관" : PLATFORM_LABEL[s.platform]}
                        </span>
                      </Td>
                      {KEYS.map((k) => {
                        const v = s.values[k];
                        return <Td key={k} num className="whitespace-nowrap">{v === undefined || v === null ? <Unknown /> : k === "revenue" ? `${num(Math.round(v))}원` : num(v)}</Td>;
                      })}
                      <Td muted className="max-w-[180px] truncate" title={s.note}>{s.note}</Td>
                      <Td>{s.source === "manual" && s.by === d.me && <IconButton icon={Trash2} size="sm" label="기록 지우기" disabled={busy === s.id} onClick={() => void run(s.id, async () => { await mutate("metric.delete", { id: s.id }); await refresh(); })} />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

      <section>
        <SectionHeader size="lg" title="제작 비용 · 시간" hint="AI 비용은 응답의 usage.cost 로 자동 기록 (없으면 추정이라고 적음)" />
        <Card className="space-y-4">
          {p.costs.length === 0 ? (
            <p className="text-nd-body text-nd-fg-3">아직 기록한 비용 · 시간이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
              {p.costs.map((c, i) => (
                <li key={c.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-nd-body sm:grid-cols-[6.5rem_6.5rem_minmax(0,1fr)_auto_6rem_2rem]">
                  <span className="nd-num text-[13px] text-nd-fg-3">{fmtWhen(c.at)}</span>
                  <span className="hidden text-[13px] text-nd-fg-2 sm:block">{COST_KIND[c.kind]}</span>
                  <span className="min-w-0 truncate" title={c.note}>{c.note}</span>
                  <span className="nd-num whitespace-nowrap text-right">
                    {[c.usd !== null ? fmtUsd(c.usd) : null, c.krw !== null ? `${num(c.krw)}원` : null, c.minutes !== null ? `${num(c.minutes)}분` : null].filter(Boolean).join(" · ") || "—"}
                  </span>
                  <span className="hidden truncate text-[13px] text-nd-fg-3 sm:block">{c.auto ? "자동 기록" : c.by.split("@")[0]}</span>
                  <span>{!c.auto && <IconButton icon={Trash2} size="sm" label="비용 지우기" onClick={() => update((x) => void x.costs.splice(i, 1))} />}</span>
                </li>
              ))}
            </ul>
          )}
          <FormRow className="grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
            <Field label="종류">
              <Select value={costForm.kind} onChange={(e) => setCostForm({ ...costForm, kind: e.target.value as CostEntry["kind"] })}>
                <option value="labor">작업 시간</option>
                <option value="material">샘플 · 재료</option>
                <option value="other">기타</option>
              </Select>
            </Field>
            <Field label="분"><NumberInput value={costForm.minutes} onValueChange={(r) => setCostForm({ ...costForm, minutes: r })} /></Field>
            <Field label="원"><NumberInput value={costForm.krw} onValueChange={(r) => setCostForm({ ...costForm, krw: r })} /></Field>
            <Field label="메모"><Input value={costForm.note} onChange={(e) => setCostForm({ ...costForm, note: e.target.value })} /></Field>
            <FieldAction size="md">
              <Button variant="secondary" disabled={!costForm.minutes && !costForm.krw} onClick={() => {
                update((x) => void x.costs.push({ id: newId("cost_"), kind: costForm.kind, krw: costForm.krw ? Number(costForm.krw) : null, usd: null, minutes: costForm.minutes ? Number(costForm.minutes) : null, note: costForm.note || (costForm.kind === "labor" ? "작업 시간" : "비용"), at: Date.now(), by: d.me, auto: false }));
                setCostForm({ ...costForm, minutes: "", krw: "", note: "" });
              }}>더하기</Button>
            </FieldAction>
          </FormRow>
        </Card>
      </section>
    </div>
  );
}

/** 합계 칸의 숫자 — 모르면 「미확인」 (0 과 구분). 금액은 수입 초록 · 지출 빨강 */
function KpiNum({ v, unit, flow }: { v: number | null; unit?: string; flow?: "income" | "expense" }): ReactNode {
  if (v === null || !Number.isFinite(v)) return <span className="text-[17px] font-semibold text-nd-fg-3" title="기록이 없거나 공개되지 않은 값입니다 (0 이 아닙니다)">미확인</span>;
  return (
    <span className={cn(flow && v !== 0 ? flowTextClass(v, flow) : undefined)}>
      {num(v)}
      {unit && <span className="ml-0.5 text-[15px] font-semibold">{unit}</span>}
    </span>
  );
}
