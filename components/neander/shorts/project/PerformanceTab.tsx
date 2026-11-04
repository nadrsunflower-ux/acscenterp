"use client";

// ============================================================
//  성과 탭 — 우리 영상의 게시물별 지표 (자동 조회 · 직접 입력 구분) · 정보 요청 · 클릭 · 주문 · 비용
// ------------------------------------------------------------
//  합계는 게시물마다 출처별 마지막 기록을 쓰고, 같은 지표가 API 와 직접 입력에
//  둘 다 있으면 API 를 쓴다 (model.projectTotals). 모르는 지표는 「미확인」 (0 이 아니다).
//  출처가 애초에 주지 않는 지표(YouTube 의 쿠팡 클릭 등)는 「해당 없음」 으로 따로 쓴다.
//  영상은 한 편이고 게시물은 플랫폼마다 따로다 — 「게시물 n건」 을 「영상 n편」 으로 쓰지 않는다.
//  DM 요청 수는 API 로 읽지 않는다 — 직접 센 값을 적는다.
//  해외 원본 영상의 반응(소재 발굴 기록)은 따로 보이고 합계에 넣지 않는다.
// ============================================================

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Disclosure, Field, FieldAction, FormRow, IconButton, Input, NumberInput, Select, buttonClass, cn, flowTextClass } from "@/components/neander/ui";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { CTA_LABEL, METRIC_LABEL, PLATFORM_LABEL, fmtPct, newId, perfRates, projectCost, projectTotals } from "@/lib/neander/shorts/model";
import type { CostEntry, MetricSnapshotView, PerfMetricKey, PerfSource } from "@/lib/neander/shorts/types";
import { isReadOnlyFor, useShorts } from "../ShortsProvider";
import { Num, SourceTag, Unknown, fmtUsd, fmtWhen, useAction } from "../parts";
import { RecordTable, StudioCard, StudioMetric, StudioNotice, type RecordColumn } from "../studio";
import type { Draft } from "../useProjectDraft";

const KEYS: PerfMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"];
const SOURCE: Record<PerfSource, string> = { youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡 리포트 API", manual: "직접 입력" };
const COST_KIND: Record<CostEntry["kind"], string> = { ai_text: "AI 글", ai_voice: "AI 음성", ai_video: "AI 영상", material: "샘플 · 재료", labor: "작업 시간", other: "기타" };
const num = (n: number) => n.toLocaleString("ko-KR");

/**
 * 출처가 애초에 주는 지표 (server/metrics.ts 가 채우는 칸) — 여기 없는 칸이 비면 「해당 없음」.
 * 직접 입력은 무엇이든 적을 수 있으니 비면 늘 「미확인」.
 */
const PROVIDES: Record<PerfSource, PerfMetricKey[] | null> = {
  youtube_api: ["views", "likes", "comments", "saves", "shares", "infoRequests"],
  instagram_api: ["views", "likes", "comments", "saves", "shares", "infoRequests"],
  coupang_api: ["clicks", "orders", "revenue"],
  manual: null,
};
const notApplicable = (src: PerfSource, k: PerfMetricKey) => PROVIDES[src] !== null && !PROVIDES[src]!.includes(k);

/** 게시물(없으면 플랫폼) × 출처마다 마지막 기록 — projectTotals 가 합에 쓰는 그 기록들 */
function latestBySource(snaps: MetricSnapshotView[]): MetricSnapshotView[] {
  const latest = new Map<string, MetricSnapshotView>();
  for (const s of [...snaps].sort((a, b) => a.at - b.at)) latest.set(`${s.publicationId ?? s.platform}|${s.source}`, s);
  return [...latest.values()].sort((a, b) => b.at - a.at);
}

/** 지표마다 합에 실제로 쓰인 출처 (projectTotals 와 같은 순서 — API 먼저, 직접 입력은 나중) */
function basisOf(rows: MetricSnapshotView[]): Record<PerfMetricKey, Set<PerfSource>> {
  const out = Object.fromEntries(KEYS.map((k) => [k, new Set<PerfSource>()])) as Record<PerfMetricKey, Set<PerfSource>>;
  const byPub = new Map<string, MetricSnapshotView[]>();
  for (const s of rows) byPub.set(s.publicationId ?? s.platform, [...(byPub.get(s.publicationId ?? s.platform) ?? []), s]);
  for (const list of byPub.values()) {
    const ranked = [...list].sort((a, b) => (a.source === "manual" ? 1 : 0) - (b.source === "manual" ? 1 : 0));
    for (const k of KEYS) {
      const hit = ranked.find((s) => typeof s.values[k] === "number");
      if (hit) out[k].add(hit.source);
    }
  }
  return out;
}

const basisText = (set: Set<PerfSource>) => (set.size ? [...set].map((s) => SOURCE[s]).join(" · ") : "기록 없음");

export function PerformanceTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const snaps = useMemo(() => d.metrics.filter((m) => m.projectId === p.id), [d.metrics, p.id]);
  const allPubs = d.publications.filter((x) => x.projectId === p.id);
  const pubs = allPubs.filter((x) => x.status === "published");
  const totals = useMemo(() => projectTotals(snaps), [snaps]);
  const latest = useMemo(() => latestBySource(snaps), [snaps]);
  const basis = useMemo(() => basisOf(latest), [latest]);
  const rates = perfRates(totals);
  const cost = projectCost(p);
  const template = d.templates.find((t) => t.id === p.templateId);
  const trend = p.trendId ? d.trends.find((t) => t.id === p.trendId) ?? null : null;
  // 게시 계정 연결 — 자동 조회는 게시한 계정의 토큰으로 읽는다
  const accounts = d.accounts.filter((a) => a.canPublish && (p.kind === "brand" ? !a.clientId || a.clientId === p.clientId : !a.clientId));
  const connected = accounts.filter((a) => a.status === "connected");
  const [form, setForm] = useState<{ publicationId: string; values: Partial<Record<PerfMetricKey, string>>; note: string }>({ publicationId: "", values: {}, note: "" });
  const [costForm, setCostForm] = useState({ kind: "labor" as CostEntry["kind"], minutes: "", krw: "", note: "" });
  const lastAt = snaps.length ? Math.max(...snaps.map((s) => s.at)) : null;
  const hasApi = latest.some((s) => s.source !== "manual");
  const byPlatform = (["youtube", "instagram"] as const).map((pf) => ({ pf, n: pubs.filter((x) => x.platform === pf).length })).filter((x) => x.n);
  const pubSummary = pubs.length ? `게시물 ${pubs.length}건 (${byPlatform.map((x) => `${PLATFORM_LABEL[x.pf]} ${x.n}건`).join(" · ")})` : "게시된 게시물 없음";

  const syncAll = () =>
    run(
      "all",
      async () => {
        for (const x of pubs) await shortsPost("research", { action: "metrics.sync", publicationId: x.id });
        await refresh();
      },
      `게시물 ${pubs.length}건의 성과를 공식 API 로 읽었습니다.`,
    );

  // 비율은 무엇으로 나눴는지 함께 — 분모를 숫자로
  const rate = (r: number | null, bottom: number | null, bottomName: string, need: string) =>
    r === null ? `${need} · ${bottomName} 기록이 있어야 계산합니다` : `${bottomName} ${num(bottom ?? 0)}회 대비 ${fmtPct(r)}`;

  const recordCols: RecordColumn<MetricSnapshotView>[] = [
    {
      key: "src",
      header: "출처 · 갱신",
      mobile: "title",
      cell: (s) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge tone={s.source === "manual" ? "neutral" : "info"} size="lg">{SOURCE[s.source]}</Badge>
            <span className="text-[14px] font-medium">{s.platform === "other" ? "게시물 무관" : s.platform === "coupang" ? "쿠팡" : PLATFORM_LABEL[s.platform]}</span>
          </span>
          <span className="nd-num text-[13px] font-normal text-nd-fg-3">{s.source === "manual" ? `${nameOf(s.by)} · ` : ""}{fmtWhen(s.at)}</span>
        </span>
      ),
    },
    {
      key: "views",
      header: "조회 · 반응",
      cell: (s) => (
        <span className="flex flex-col gap-0.5">
          <span><Cell s={s} k="views" unit="회" /></span>
          <span className="text-[13px] text-nd-fg-3">
            {(["likes", "comments", "saves", "shares"] as const).map((k, i) => (
              <span key={k}>{i > 0 && " · "}{METRIC_LABEL[k]} <Cell s={s} k={k} /></span>
            ))}
          </span>
        </span>
      ),
    },
    { key: "info", header: "정보 요청", align: "right", cell: (s) => <Cell s={s} k="infoRequests" /> },
    { key: "clicks", header: "클릭", align: "right", cell: (s) => <Cell s={s} k="clicks" /> },
    { key: "orders", header: "주문", align: "right", cell: (s) => <Cell s={s} k="orders" /> },
    { key: "revenue", header: "수익", align: "right", cell: (s) => <Cell s={s} k="revenue" /> },
  ];

  const historyCols: RecordColumn<MetricSnapshotView>[] = [
    { key: "at", header: "기록 시각", mobile: "title", cell: (s) => <span className="nd-num whitespace-nowrap">{fmtWhen(s.at)}</span> },
    {
      key: "src",
      header: "출처 · 대상",
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Badge tone={s.source === "manual" ? "neutral" : "info"}>{SOURCE[s.source]}</Badge>
          {s.platform === "other" ? "게시물 무관" : s.platform === "coupang" ? "쿠팡" : PLATFORM_LABEL[s.platform]}
        </span>
      ),
    },
    ...KEYS.map((k): RecordColumn<MetricSnapshotView> => ({ key: k, header: METRIC_LABEL[k], align: "right", className: "whitespace-nowrap", cell: (s) => <Cell s={s} k={k} /> })),
    { key: "note", header: "메모", className: "max-w-[180px]", cell: (s) => <span className="block truncate text-nd-fg-2" title={s.note}>{s.note || "—"}</span> },
    {
      key: "del",
      header: <span className="sr-only">지우기</span>,
      mobileLabel: "지우기",
      className: "w-12",
      cell: (s) =>
        s.source === "manual" && s.by === d.me ? (
          <IconButton icon={Trash2} size="sm" label="기록 지우기" disabled={busy === s.id} onClick={() => void run(s.id, async () => { await mutate("metric.delete", { id: s.id }); await refresh(); })} />
        ) : (
          <span className="text-nd-fg-3">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 갱신 시각 · 출처 · 지금 가져오기 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="nd-num rounded-nd-sm bg-nd-content px-2.5 py-1 text-[13px] text-nd-fg-2 ring-1 ring-nd-line">갱신 · {lastAt ? fmtWhen(lastAt) : "기록 없음"}</span>
        {hasApi && <Badge tone="info" size="lg">자동 수집</Badge>}
        {latest.some((s) => s.source === "manual") && <Badge size="lg">직접 입력 포함</Badge>}
        <span className="text-[13px] text-nd-fg-3">이 영상 1편 · {pubSummary}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" icon={RefreshCw} disabled={!pubs.length || busy === "all"} title={!pubs.length ? "게시된 게시물이 없어 가져올 대상이 없습니다" : undefined} onClick={() => void syncAll()}>
            지금 가져오기
          </Button>
        </span>
      </div>

      {/* 합계 — 모르는 값은 「미확인」, 비율은 분모와 함께 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StudioMetric label="조회" value={<KpiNum v={totals.views} />} detail={pubs.length ? `${pubSummary} 합 · ${basisText(basis.views)}` : "게시된 게시물 없음"} />
        <StudioMetric label="좋아요" value={<KpiNum v={totals.likes} />} detail={basisText(basis.likes)} />
        <StudioMetric label="댓글" value={<KpiNum v={totals.comments} />} detail={basisText(basis.comments)} />
        <StudioMetric
          label="저장 · 공유"
          value={totals.saves === null && totals.shares === null ? <KpiNum v={null} /> : <span>{totals.saves === null ? "미확인" : num(totals.saves)}<span className="mx-1 text-nd-fg-3">·</span>{totals.shares === null ? "미확인" : num(totals.shares)}</span>}
          detail={`저장 ${basisText(basis.saves)} · 공유 ${basisText(basis.shares)} — 공개되지 않은 게시물은 합에 없음 (0 과 구분)`}
        />
        <StudioMetric label="정보 요청" value={<KpiNum v={totals.infoRequests} />} detail={rate(rates.infoRate, totals.views, "조회", "정보 요청")} />
        <StudioMetric label="제휴 클릭" value={<KpiNum v={totals.clicks} />} detail={rate(rates.ctr, totals.views, "조회", "클릭")} />
        <StudioMetric label="주문" value={<KpiNum v={totals.orders} unit="건" />} detail={rate(rates.cvr, totals.clicks, "클릭", "주문")} />
        <StudioMetric
          label="제휴 수익"
          value={<KpiNum v={totals.revenue === null ? null : Math.round(totals.revenue)} unit="원" flow="income" />}
          detail={`${totals.revenue === null ? "쿠팡 리포트 · 직접 입력" : basisText(basis.revenue)} · 수수료 금액 그대로 (부가세 구분 미확인)${rates.revenuePerKView !== null ? ` · 조회 1,000회당 ${num(Math.round(rates.revenuePerKView))}원` : ""}`}
        />
      </div>

      <StudioCard title="출처별 성과 기록" description="게시물 · 출처마다 마지막 기록입니다. 위 합계는 이 줄들로 계산합니다 (같은 지표가 API 와 직접 입력에 둘 다 있으면 API)." flush>
        <RecordTable
          rows={latest}
          columns={recordCols}
          rowKey={(s) => s.id}
          ariaLabel="출처별 성과 기록"
          empty={<p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">아직 성과 기록이 없습니다. 아래 「자동 조회」 나 「직접 기록하기」 로 남기면 여기에 출처별로 보입니다.</p>}
          className="pb-2 md:pb-0 [&>ul]:px-4 [&>ul]:pb-3"
        />
      </StudioCard>

      {trend && (
        <StudioCard title="원본 반응 (참고)" description="해외 원본 영상의 숫자 — 소재 발굴 기록입니다. 위 「우리 영상 성과」 합계에 넣지 않습니다.">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
                  원본 보기 <ExternalLink size={13} aria-hidden />
                </a>
              )}
            </span>
          </div>
        </StudioCard>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <StudioCard title="자동 조회" description="공식 API 로 읽은 값은 「YouTube API」 · 「Instagram API」 · 「쿠팡 리포트 API」 로 표시됩니다">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {pubs.map((x) => (
                <Button key={x.id} size="sm" variant="secondary" icon={RefreshCw} disabled={busy === x.id} onClick={() => void run(x.id, async () => { await shortsPost("research", { action: "metrics.sync", publicationId: x.id }); await refresh(); }, `${PLATFORM_LABEL[x.platform]} 성과를 공식 API 로 읽었습니다.`)}>
                  {PLATFORM_LABEL[x.platform]} 가져오기
                </Button>
              ))}
              <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!d.status.coupang.configured || busy === "cp"} title={!d.status.coupang.configured ? "쿠팡 파트너스 키가 없어 리포트를 읽을 수 없습니다" : undefined} onClick={() => void run("cp", async () => { await shortsPost("research", { action: "coupang.reports" }); await refresh(); }, "쿠팡 리포트를 읽었습니다 (최근 90일).")}>
                쿠팡 리포트{d.status.coupang.configured ? "" : " (키 없음)"}
              </Button>
            </div>
            {!pubs.length && <p className="text-[13px] text-nd-fg-3">게시된 게시물이 없어 YouTube · Instagram 에서 가져올 대상이 없습니다.</p>}
            {!connected.length && (
              <StudioNotice tone="warning" action={<Link href="/neander/shorts/accounts" className={buttonClass("secondary", "sm")}><Plug size={14} aria-hidden className="mr-1" />계정 연결</Link>}>
                연결된 SNS 계정이 없어 YouTube · Instagram 성과를 자동으로 읽지 못합니다. 「직접 기록하기」 로 남기세요.
              </StudioNotice>
            )}
            <p className="text-[13px] leading-relaxed text-nd-fg-3">
              YouTube · Instagram 은 게시한 계정의 토큰으로 조회 · 좋아요 · 댓글(· 저장 · 공유)을 읽고, 최근 댓글에서 정보 요청 낱말이 든 댓글을 셉니다(최소값). 쿠팡 주문 · 수익은 확인한 상품 id 로 묶고, 클릭은 영상 전용 채널 아이디가 있을 때만 붙습니다. 매일 06:30 cron 이 최근 30일 게시물을 다시 읽습니다.
            </p>
          </div>
        </StudioCard>

        <StudioCard title="직접 기록하기" description="DM 요청 · 저장처럼 API 로 못 읽는 값. 빈 칸은 미확인, 0 을 쓰면 확인한 0 으로 기록합니다.">
          <div className="space-y-4">
            <Field label="게시물">
              <Select value={form.publicationId} onChange={(e) => setForm({ ...form, publicationId: e.target.value })}>
                <option value="">(게시물 무관 · 쿠팡 등)</option>
                {allPubs.map((x) => <option key={x.id} value={x.id}>{PLATFORM_LABEL[x.platform]} · {x.result?.url ?? x.status}</option>)}
              </Select>
            </Field>
            <FormRow className="grid-cols-2 sm:grid-cols-3 2xl:grid-cols-5">
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
          </div>
        </StudioCard>
      </div>

      <Disclosure title="기록 전체" description="자동 조회 · 직접 입력을 남긴 순서대로 (최근 것이 위) · 내가 직접 넣은 기록만 지울 수 있습니다" meta={<Badge size="lg">{snaps.length}건</Badge>} defaultOpen={isReadOnlyFor(p, d.me)}>
        <RecordTable
          rows={[...snaps].sort((a, b) => b.at - a.at)}
          columns={historyCols}
          rowKey={(s) => s.id}
          ariaLabel="성과 기록 전체"
          empty={<p className="text-nd-body text-nd-fg-3">자동 조회나 직접 입력으로 남긴 성과 기록이 여기에 쌓입니다.</p>}
        />
      </Disclosure>

      <StudioCard
        title="제작 비용 · 시간"
        description="AI 비용은 응답의 usage.cost 로 자동 기록 (없으면 추정이라고 적음)"
        action={
          <span className="nd-num text-[14px] font-semibold">
            <span className={cn(cost.krw ? flowTextClass(cost.krw, "expense") : "text-nd-fg")}>{cost.krw ? `-${num(cost.krw)}원` : "0원"}</span>
            <span className="ml-2 text-[13px] font-normal text-nd-fg-3">AI {fmtUsd(cost.aiUsd)} · 작업 {num(cost.minutes)}분</span>
          </span>
        }
      >
        <div className="space-y-4">
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
                  <span className="hidden truncate text-[13px] text-nd-fg-3 sm:block">{c.auto ? "자동 기록" : nameOf(c.by)}</span>
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
            <Field label="원 (실제 낸 금액)"><NumberInput value={costForm.krw} onValueChange={(r) => setCostForm({ ...costForm, krw: r })} /></Field>
            <Field label="메모"><Input value={costForm.note} onChange={(e) => setCostForm({ ...costForm, note: e.target.value })} /></Field>
            <FieldAction size="md">
              <Button variant="secondary" disabled={!costForm.minutes && !costForm.krw} onClick={() => {
                update((x) => void x.costs.push({ id: newId("cost_"), kind: costForm.kind, krw: costForm.krw ? Number(costForm.krw) : null, usd: null, minutes: costForm.minutes ? Number(costForm.minutes) : null, note: costForm.note || (costForm.kind === "labor" ? "작업 시간" : "비용"), at: Date.now(), by: d.me, auto: false }));
                setCostForm({ ...costForm, minutes: "", krw: "", note: "" });
              }}>더하기</Button>
            </FieldAction>
          </FormRow>
        </div>
      </StudioCard>

      <StudioNotice tone="info" title="수치는 출처와 함께 해석하세요">
        플랫폼마다 조회를 세는 기준이 다릅니다. 정보 요청률 · 클릭률의 분모는 합산 조회 {totals.views === null ? "(미확인)" : `${num(totals.views)}회`}, 전환율의 분모는 클릭 {totals.clicks === null ? "(미확인)" : `${num(totals.clicks)}회`}입니다.
        쓴 공식: {template?.name ?? "(없음)"} · CTA: {CTA_LABEL[p.cta.type]}{p.cta.keyword ? ` 「${p.cta.keyword}」` : ""}. 클릭 · 전환율 · 수익은 쿠팡 파트너스 기밀정보라 ERP 밖으로 공유하지 않습니다.
      </StudioNotice>
    </div>
  );
}

/** 기록 한 칸 — 값이 있으면 숫자, 출처가 주지 않는 지표면 「해당 없음」, 아니면 「미확인」 */
function Cell({ s, k, unit }: { s: MetricSnapshotView; k: PerfMetricKey; unit?: string }) {
  const v = s.values[k];
  if (v === undefined || v === null) return notApplicable(s.source, k) ? <span className="text-nd-fg-3" title={`${SOURCE[s.source]} 는 이 지표를 주지 않습니다`}>해당 없음</span> : <Unknown />;
  if (k === "revenue") return <span className="nd-num text-nd-income-text">{num(Math.round(v))}원</span>;
  return (
    <span className="nd-num">
      {num(v)}
      {unit && <span className="ml-0.5 text-nd-fg-3">{unit}</span>}
    </span>
  );
}

/** 합계 칸의 숫자 — 모르면 「미확인」 (0 과 구분). 금액은 수입 초록 */
function KpiNum({ v, unit, flow }: { v: number | null; unit?: string; flow?: "income" | "expense" }): ReactNode {
  if (v === null || !Number.isFinite(v)) return <span className="text-nd-fg-3" title="기록이 없거나 공개되지 않은 값입니다 (0 이 아닙니다)">미확인</span>;
  return (
    <span className={cn(flow && v !== 0 ? flowTextClass(v, flow) : undefined)}>
      {num(v)}
      {unit && <span className="ml-0.5 text-[15px] font-semibold">{unit}</span>}
    </span>
  );
}
