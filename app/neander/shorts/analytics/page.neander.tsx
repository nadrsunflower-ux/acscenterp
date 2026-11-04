"use client";

// ============================================================
//  성과 비교 — 어떤 상품 · 구성(공식) · CTA 가 정보 요청 · 클릭 · 구매로 이어졌나
// ------------------------------------------------------------
//  프로젝트마다 출처별 마지막 기록을 합친다 (model.projectTotals). 예시 프로젝트는 뺀다.
//  모르는 지표가 있는 프로젝트는 「일부 미확인」 으로 세어 비율이 과장되지 않게 알린다.
//  우리가 만든 영상의 성과만 다룬다 — 원본(해외) 영상의 반응은 섞지 않는다.
//  2026-11 목업 개편: 미확인 범위 · 비율 계산식(분모)을 맨 위에 → 요약 숫자 4칸 → 묶어 보기(5개 기준) →
//  영상별 조회 변화(한 축 꺾은선 · 선 끝 이름표 · 실선/점선 · 범례 · 수치 표) · 측정 범위 → 영상별 표.
//  차트는 이미 쌓인 성과 기록(스냅숏)만 쓴다 — 날마다 그날까지의 마지막 기록으로 누적 조회를 다시 센다.
// ============================================================

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChartColumn, FolderOpen } from "lucide-react";
import { ChartTooltip, ChartValues, EmptyState, PageShell, Tabs, cn } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, Unknown, fmtUsd } from "@/components/neander/shorts/parts";
import { RecordTable, StudioCard, StudioHeader, StudioMetric, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { CTA_LABEL, compareBy, fmtPct, perfRates, projectCost, projectTotals, type CompareAxis, type CompareRow, type PerfTotals } from "@/lib/neander/shorts/model";
import { USD_KRW, krwOf } from "@/lib/neander/shorts/radar";
import type { MetricSnapshotView, PerfMetricKey, ProjectDoc } from "@/lib/neander/shorts/types";

type Key = "views" | "infoRequests" | "clicks" | "orders" | "revenue";
const KEYS: Key[] = ["views", "infoRequests", "clicks", "orders", "revenue"];
const SOURCE_TEXT: Record<string, string> = { manual: "직접 입력", youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡 API" };
const AXES: { value: CompareAxis; label: string }[] = [
  { value: "cta", label: "CTA" },
  { value: "template", label: "성공 공식" },
  { value: "owner", label: "사용자" },
  { value: "category", label: "상품 분류" },
  { value: "client", label: "고객사" },
];
const AXIS_LABEL: Record<CompareAxis, string> = { cta: "CTA (행동 유도 문구)", template: "성공 공식", owner: "사용자", category: "상품 분류", client: "고객사" };

type Row = { project: ProjectDoc & { id: string }; totals: PerfTotals; templateName: string | null };

/** compareBy 와 같은 묶음 열쇠 — 묶음마다 지표별로 아는 영상 수를 세려고 */
function groupKey(axis: CompareAxis, p: ProjectDoc): string {
  return axis === "category" ? p.category || "(분류 없음)" : axis === "template" ? p.templateId ?? "(공식 없음)" : axis === "owner" ? p.owner : axis === "client" ? p.clientId ?? "(자체 · 쿠팡)" : p.cta.type;
}

/** 지표별 값을 아는 영상 수 */
function knownCount(rows: Row[]): Record<Key, number> {
  const c: Record<Key, number> = { views: 0, infoRequests: 0, clicks: 0, orders: 0, revenue: 0 };
  for (const r of rows) for (const k of KEYS) if (r.totals[k as PerfMetricKey] !== null) c[k] += 1;
  return c;
}

/** 비율 — 분모가 0 이면 「—」(해당 없음) */
const Rate = ({ r }: { r: number | null }) => <span className="nd-num text-[13px] text-nd-fg-3">{r === null ? "—" : fmtPct(r)}</span>;

/** 숫자 + 그 아래 비율 · 모르면 「미확인」 */
function CountRate({ value, known, rate, unit }: { value: number | null; known: boolean; rate?: number | null; unit?: string }) {
  if (!known || value === null) return <Unknown />;
  return (
    <div className="leading-snug">
      <Num value={value} unit={unit} />
      {rate !== undefined && (
        <div>
          <Rate r={rate} />
        </div>
      )}
    </div>
  );
}

/** 들어온 돈(제휴 수익) — 초록 */
const Income = ({ value }: { value: number | null }) =>
  value === null ? (
    <Unknown />
  ) : (
    <span className="nd-num font-medium text-nd-success-text">
      {Math.round(value).toLocaleString("ko-KR")}
      <span className="ml-0.5">원</span>
    </span>
  );

/** 나간 돈(제작 비용) — 빨강 · 「-」 */
const Expense = ({ krw, note }: { krw: number; note?: string }) =>
  krw > 0 ? (
    <span className="nd-num text-nd-danger-text" title={note}>
      -{Math.round(krw).toLocaleString("ko-KR")}
      <span className="ml-0.5">원</span>
    </span>
  ) : (
    <span className="text-nd-fg-3" title="기록된 비용 없음">
      —
    </span>
  );

// ---- 영상별 조회 변화 (한 축 꺾은선) ----------------------------------------

/** 검증한 범주 5색 (시장 트렌드 차트와 같은 값 — dataviz validate_palette · light) */
const LINE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
/** 색 말고도 선 모양으로 구분 — 실선 · 긴 점선 · 짧은 점선 · 1점 쇄선 · 점 */
const LINE_DASH = ["", "7 4", "2 4", "9 3 2 3", "1 5"] as const;
const DASH_NAME = ["실선", "긴 점선", "짧은 점선", "쇄선", "점선"] as const;
const MAX_LINES = 5;

const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const dayEnd = (day: string) => Date.parse(`${day}T00:00:00+09:00`) + 86_400_000 - 1;
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
/** 선 끝 이름 — 앞의 「[다이소]」 같은 머리는 뺀다 */
const shortName = (t: string) => {
  const s = t.replace(/^\s*\[[^\]]*\]\s*/, "").trim() || t;
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
};

interface Series {
  key: string;
  name: string;
  full: string;
  color: string;
  dash: string;
  dashName: string;
  /** 날 → 그날까지의 누적 조회 (기록 전이면 없음) */
  values: Map<string, number>;
}

function buildSeries(rows: Row[], metrics: MetricSnapshotView[]): { days: string[]; series: Series[] } {
  const top = rows
    .filter((r) => r.totals.views !== null)
    .sort((a, b) => (b.totals.views ?? 0) - (a.totals.views ?? 0))
    .slice(0, MAX_LINES);
  const byProject = new Map<string, MetricSnapshotView[]>();
  for (const m of metrics) byProject.set(m.projectId, [...(byProject.get(m.projectId) ?? []), m]);
  const allDays = new Set<string>();
  const series = top.map((r, i) => {
    const snaps = (byProject.get(r.project.id) ?? []).filter((m) => typeof m.values.views === "number");
    const days = [...new Set(snaps.map((m) => kstDay(m.at)))].sort();
    const values = new Map<string, number>();
    for (const day of days) {
      const v = projectTotals(snaps.filter((m) => m.at <= dayEnd(day))).views;
      if (v !== null) values.set(day, v);
      allDays.add(day);
    }
    return { key: r.project.id, name: shortName(r.project.title), full: r.project.title, color: LINE_COLORS[i], dash: LINE_DASH[i], dashName: DASH_NAME[i], values };
  });
  const days = [...allDays].sort().slice(-30);
  // 기록이 띄엄띄엄이면 사이 날은 그 전 마지막 값으로 잇는다 (누적이라 줄지 않는다)
  for (const s of series) {
    let last: number | null = null;
    for (const day of days) {
      const v = s.values.get(day);
      if (v !== undefined) last = v;
      else if (last !== null) s.values.set(day, last);
    }
  }
  return { days, series };
}

function niceStep(max: number) {
  const raw = Math.max(1, max) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const H = 260;
const PAD_T = 14;
const PAD_B = 30;

function ViewsChart({ days, series }: { days: string[]; series: Series[] }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const id = useId();
  const max = Math.max(1, ...series.flatMap((s) => [...s.values.values()]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const padL = Math.max(30, String(top.toLocaleString("ko-KR")).length * 8 + 12);
  // 선 끝 이름표 자리 — 좁은 화면이면 이름표를 빼고 범례 · 표로 읽게 한다
  const showEnds = width >= 420;
  const padR = showEnds ? Math.min(170, Math.max(64, ...series.map((s) => (s.name.length + 7) * 13))) : 16;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number) => padL + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH;
  const tickEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 56))));
  const lastI = days.length - 1;
  const showTick = (i: number) => i === lastI || (i % tickEvery === 0 && x(lastI) - x(i) >= 44);
  // 선 끝 이름표 — 겹치지 않게 16px 씩 민다
  const ends = series
    .map((s) => {
      const lastDay = [...days].reverse().find((d) => s.values.has(d));
      return lastDay ? { s, v: s.values.get(lastDay)!, y: y(s.values.get(lastDay)!) } : null;
    })
    .filter((e): e is { s: Series; v: number; y: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
  if (ends.length && ends[ends.length - 1].y > PAD_T + plotH) {
    ends[ends.length - 1].y = PAD_T + plotH;
    for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < 16) ends[i].y = ends[i + 1].y - 16;
  }
  const cur = hover !== null ? days[hover] : null;
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / Math.max(1, r.width);
    setHover(Math.max(0, Math.min(lastI, Math.round(rel * lastI))));
    setAt({ x: e.clientX, y: e.clientY });
  };

  return (
    <div>
      {/* 범례 — 색과 선 모양을 함께 */}
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="범례">
        {series.map((s) => (
          <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-nd-fg-2" title={s.full}>
            <svg width="26" height="10" aria-hidden className="shrink-0">
              <line x1="1" x2="25" y1="5" y2="5" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinecap="round" />
            </svg>
            <span className="truncate">
              {s.name} · {s.dashName}
            </span>
          </li>
        ))}
      </ul>
      <div ref={wrapRef} className="relative w-full" onMouseLeave={() => (setHover(null), setAt(null))}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-t`} className="block select-none">
            <title id={`${id}-t`}>영상별 누적 조회 변화</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(15,23,42,0.18)" : "rgba(15,23,42,0.07)"} strokeWidth={1} />
                <text x={padL - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="nd-num fill-nd-fg-3 text-[13px]">
                  {t.toLocaleString("ko-KR")}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              showTick(i) ? (
                <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className={cn("nd-num text-[13px]", hover === i ? "fill-nd-fg font-semibold" : "fill-nd-fg-3")}>
                  {dayLabel(d)}
                </text>
              ) : null,
            )}
            {cur && <line x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(15,23,42,0.25)" strokeWidth={1} />}
            {series.map((s) => {
              const pts = days.map((d, i) => ({ i, v: s.values.get(d) })).filter((q): q is { i: number; v: number } => q.v !== undefined);
              return (
                <g key={s.key}>
                  <polyline points={pts.map((q) => `${x(q.i)},${y(q.v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((q) => (
                    <circle key={q.i} cx={x(q.i)} cy={y(q.v)} r={hover === q.i ? 5 : 4} fill="#fff" stroke={s.color} strokeWidth={2} />
                  ))}
                </g>
              );
            })}
            {showEnds &&
              ends.map((e) => (
                <text key={e.s.key} x={padL + plotW + 10} y={e.y} dominantBaseline="middle" className="fill-nd-fg-2 text-[13px] font-medium">
                  {e.s.name} <tspan className="nd-num fill-nd-fg-3 font-normal">{e.v.toLocaleString("ko-KR")}</tspan>
                </text>
              ))}
            <rect x={padL} y={PAD_T} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} aria-hidden />
          </svg>
        )}
      </div>
      <ChartTooltip
        at={at}
        title={cur ? `${dayLabel(cur)}까지 누적 조회` : ""}
        unit="회"
        rows={cur ? series.map((s) => ({ key: s.key, label: s.name, color: s.color, value: s.values.has(cur) ? s.values.get(cur)!.toLocaleString("ko-KR") : "—" })) : []}
      />
      <ChartValues
        className="mt-2"
        label="수치 표로 보기"
        hideLabel="수치 표 닫기"
        rowHeader="날 (그날까지 누적)"
        columns={series.map((s) => ({ key: s.key, label: s.name, color: s.color }))}
        rows={[...days].reverse().map((d) => ({ key: d, label: dayLabel(d), values: Object.fromEntries(series.map((s) => [s.key, s.values.get(d) ?? null])) }))}
        format={(v) => v.toLocaleString("ko-KR")}
        note="단위: 회 · 기록 전 날은 「—」 · 사이 날은 그 전 마지막 기록"
      />
    </div>
  );
}

// ---- 화면 -------------------------------------------------------------------

export default function AnalyticsPage() {
  const { data, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const [axis, setAxis] = useState<CompareAxis>("cta");
  const templateName = useMemo(() => new Map(d.templates.map((t) => [t.id, t.name])), [d.templates]);
  const rows: Row[] = useMemo(
    () =>
      sc.projects
        .filter((p) => !p.sample)
        .map((p) => ({ project: p, totals: projectTotals(sc.metrics.filter((m) => m.projectId === p.id)), templateName: p.templateId ? templateName.get(p.templateId) ?? null : null })),
    [sc.projects, sc.metrics, templateName],
  );
  const groups = useMemo(() => compareBy(axis, rows).map((g) => (axis === "owner" ? { ...g, label: nameOf(g.key) } : g)), [axis, rows, nameOf]);
  // 묶음마다 지표별로 값을 아는 영상 수 — 하나도 모르면 0 이 아니라 「미확인」
  const knownBy = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = groupKey(axis, r.project);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return new Map([...m].map(([k, rs]) => [k, knownCount(rs)]));
  }, [rows, axis]);
  const known = useMemo(() => knownCount(rows), [rows]);
  const withData = rows.filter((r) => r.totals.views !== null);
  // 영상별 표 — 성과 기록이 있거나 게시한 영상 (게시했는데 기록이 없으면 「미확인」 으로 보인다)
  const published = useMemo(() => new Set(sc.publications.filter((p) => p.status === "published").map((p) => p.projectId)), [sc.publications]);
  const listed = rows
    .filter((r) => r.totals.views !== null || published.has(r.project.id))
    .sort((a, b) => (b.totals.views ?? -1) - (a.totals.views ?? -1));
  // 전체 합 — compareBy 와 같은 식 (값을 아는 영상만 더하고, 비율은 합 ÷ 합)
  const sum = (k: Key) => (known[k] ? rows.reduce((n, r) => n + (r.totals[k as PerfMetricKey] ?? 0), 0) : null);
  const total = { views: sum("views"), infoRequests: sum("infoRequests"), clicks: sum("clicks"), orders: sum("orders"), revenue: sum("revenue") };
  const rate = perfRates(total);
  const chart = useMemo(() => buildSeries(rows, sc.metrics), [rows, sc.metrics]);
  const sources = [...new Set(rows.flatMap((r) => [...r.totals.sources]))].map((s) => SOURCE_TEXT[s] ?? s);

  const groupColumns: RecordColumn<CompareRow>[] = [
    {
      key: "label",
      header: AXIS_LABEL[axis],
      mobile: "title",
      className: "w-[26%] max-w-0",
      cell: (g) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={g.label}>
            {g.label}
          </p>
          {g.partial > 0 && (
            <p className="text-[13px] font-normal text-nd-fg-3" title="지표 일부를 모르는 영상 — 그 지표는 합계에서 빠졌습니다">
              일부 미확인 {g.partial}편
            </p>
          )}
        </div>
      ),
    },
    {
      key: "videos",
      header: "영상",
      align: "right",
      cell: (g) => {
        const k = knownBy.get(g.key);
        return (
          <div className="leading-snug">
            <Num value={g.projects} unit="편" />
            <div className="text-[13px] text-nd-fg-3">조회 아는 {k?.views ?? 0}편</div>
          </div>
        );
      },
    },
    { key: "views", header: "조회", align: "right", cell: (g) => ((knownBy.get(g.key)?.views ?? 0) ? <Num value={g.views} /> : <Unknown />) },
    { key: "info", header: "정보 요청 · 비율", mobileLabel: "정보 요청", align: "right", cell: (g) => <CountRate value={g.infoRequests} unit="건" known={(knownBy.get(g.key)?.infoRequests ?? 0) > 0} rate={g.infoRate} /> },
    { key: "clicks", header: "클릭 · 비율", mobileLabel: "클릭", align: "right", cell: (g) => <CountRate value={g.clicks} unit="회" known={(knownBy.get(g.key)?.clicks ?? 0) > 0} rate={g.ctr} /> },
    { key: "orders", header: "주문 · 전환율", mobileLabel: "주문", align: "right", cell: (g) => <CountRate value={g.orders} unit="건" known={(knownBy.get(g.key)?.orders ?? 0) > 0} rate={g.cvr} /> },
    {
      key: "money",
      header: "제휴 수익 · 제작 비용",
      mobileLabel: "수익 · 비용",
      align: "right",
      cell: (g) => (
        <div className="leading-snug">
          {(knownBy.get(g.key)?.revenue ?? 0) ? <Income value={g.revenue} /> : <Unknown />}
          <div className="text-[13px]">
            <Expense krw={g.costKrw} note="영상에 기록된 원화 제작 비용" />
          </div>
        </div>
      ),
    },
  ];

  const videoColumns: RecordColumn<Row>[] = [
    {
      key: "video",
      header: "영상 · 성공 공식",
      mobile: "title",
      className: "w-[26%] max-w-0",
      cell: ({ project: p, templateName: tn, totals: t }) => {
        const who = p.owner !== d.me ? `${nameOf(p.owner)} · ` : "";
        const cta: ReactNode = `${CTA_LABEL[p.cta.type]}${p.cta.keyword ? ` 「${p.cta.keyword}」` : ""}`;
        return (
          <div className="min-w-0">
            <Link href={`/neander/shorts/projects/${p.id}?tab=perf`} className="block truncate font-medium hover:underline" title={p.title}>
              {p.title}
            </Link>
            <p className="truncate text-[13px] font-normal text-nd-fg-3" title={`${tn ?? "(공식 없음)"} · ${CTA_LABEL[p.cta.type]}`}>
              {who}
              {t.views === null ? "아직 성과 기록 없음 · " : ""}
              {tn ?? "(공식 없음)"} · {cta}
            </p>
          </div>
        );
      },
    },
    {
      key: "source",
      header: "기록 출처",
      mobileLabel: "출처",
      className: "max-w-[220px]",
      cell: ({ totals: t }) => <span className="text-[13px] text-nd-fg-2">{[...t.sources].map((s) => SOURCE_TEXT[s] ?? s).join(" · ") || "—"}</span>,
    },
    { key: "views", header: "조회", align: "right", cell: ({ totals: t }) => <Num value={t.views} /> },
    { key: "info", header: "정보 요청 · 비율", mobileLabel: "정보 요청", align: "right", cell: ({ totals: t }) => <CountRate value={t.infoRequests} unit="건" known={t.infoRequests !== null} rate={perfRates(t).infoRate} /> },
    { key: "clicks", header: "클릭 · 비율", mobileLabel: "클릭", align: "right", cell: ({ totals: t }) => <CountRate value={t.clicks} unit="회" known={t.clicks !== null} rate={perfRates(t).ctr} /> },
    { key: "orders", header: "주문 · 전환율", mobileLabel: "주문", align: "right", cell: ({ totals: t }) => <CountRate value={t.orders} unit="건" known={t.orders !== null} rate={t.clicks === null ? undefined : perfRates(t).cvr} /> },
    {
      key: "money",
      header: "제휴 수익 · AI 비용",
      mobileLabel: "수익 · AI 비용",
      align: "right",
      cell: ({ project: p, totals: t }) => {
        const aiUsd = projectCost(p).aiUsd;
        return (
          <div className="leading-snug">
            <Income value={t.revenue} />
            <div className="text-[13px]">
              <Expense krw={aiUsd ? krwOf(aiUsd) : 0} note={aiUsd ? `기록된 AI 비용 ${fmtUsd(aiUsd)} — 1달러 ${USD_KRW.toLocaleString("ko-KR")}원으로 어림` : undefined} />
              {aiUsd > 0 && <span className="ml-1 text-nd-fg-3">어림</span>}
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="성과 비교"
        description="우리 영상의 정보 요청 · 클릭 · 구매를 비교해 다음 제작의 기준을 만드세요. 모두 기록된 값으로만 셉니다 — 추정치를 채워 넣지 않습니다."
      />
      {withData.length === 0 ? (
        <EmptyState icon={ChartColumn} title="아직 성과 기록이 없습니다" description="게시한 영상의 성과를 영상의 「성과」 탭에서 가져오거나 직접 적으면 여기서 비교됩니다." />
      ) : (
        <div className="space-y-6">
          <StudioNotice tone="info" title="모르는 값은 0 으로 계산하지 않아요">
            <span className="block">
              정보 요청률 = 정보 요청 ÷ 조회 · 클릭률 = 제휴 클릭 ÷ 조회 · 전환율 = 주문 ÷ 클릭. 분자 · 분모는 그 묶음에서 값을 아는 영상만 더한 합이라, 분자를 모르는 영상의 조회도 분모에 들어갑니다 — 「일부 미확인」 묶음의 비율은 실제보다 낮게 나올 수 있습니다.
            </span>
            <span className="mt-1 block text-[13px]">
              지금 범위: 영상 <b className="nd-num font-semibold">{rows.length}</b>편 중 조회를 아는 영상 <span className="nd-num">{known.views}</span>편 · 정보 요청 <span className="nd-num">{known.infoRequests}</span>편 · 클릭 <span className="nd-num">{known.clicks}</span>편 · 주문 <span className="nd-num">{known.orders}</span>편 · 수익 <span className="nd-num">{known.revenue}</span>편
            </span>
          </StudioNotice>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StudioMetric label="확인된 조회" value={total.views === null ? <Unknown /> : total.views.toLocaleString("ko-KR")} unit={total.views === null ? undefined : "회"} detail={`성과 기록 영상 ${known.views}편`} />
            <StudioMetric
              label="정보 요청"
              value={total.infoRequests === null ? <Unknown /> : total.infoRequests.toLocaleString("ko-KR")}
              unit={total.infoRequests === null ? undefined : "건"}
              detail={total.infoRequests === null ? `값을 아는 영상 없음` : `조회 대비 ${fmtPct(rate.infoRate)} · 아는 영상 ${known.infoRequests}편`}
            />
            <StudioMetric
              label="제휴 클릭"
              value={total.clicks === null ? <Unknown /> : total.clicks.toLocaleString("ko-KR")}
              unit={total.clicks === null ? undefined : "회"}
              detail={total.clicks === null ? "쿠팡 클릭 기록 없음" : `조회 대비 ${fmtPct(rate.ctr)} · 아는 영상 ${known.clicks}편`}
            />
            <StudioMetric
              label="제휴 수익"
              tone={total.revenue === null ? undefined : "success"}
              value={total.revenue === null ? <Unknown /> : Math.round(total.revenue).toLocaleString("ko-KR")}
              unit={total.revenue === null ? undefined : "원"}
              detail={total.revenue === null ? "쿠팡 수익 기록 없음" : `쿠팡 수수료 보고값 · 주문 ${(total.orders ?? 0).toLocaleString("ko-KR")}건`}
            />
          </div>

          <StudioCard title="묶어 보기" description="우리 영상 성과 · 영상마다 출처별 마지막 기록 · 조회가 많은 묶음부터" flush>
            <Tabs className="px-2 sm:px-3" items={AXES.map((a) => ({ key: a.value, label: a.label }))} value={axis} onChange={(k) => setAxis(k as CompareAxis)} ariaLabel="묶는 기준" />
            <div className="max-md:px-4 max-md:py-4">
              <RecordTable ariaLabel={`${AXIS_LABEL[axis]}별 성과`} rows={groups} columns={groupColumns} rowKey={(g) => g.key} className="md:[&_thead_tr]:border-t-0" />
            </div>
          </StudioCard>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <StudioCard title="영상별 조회 변화" description={`누적 조회 · 공통 축 하나 · 조회가 많은 영상 ${Math.min(MAX_LINES, chart.series.length)}편`}>
              {chart.days.length >= 2 ? (
                <ViewsChart days={chart.days} series={chart.series} />
              ) : (
                <p className="py-6 text-center text-nd-body text-nd-fg-3">성과 기록이 이틀 이상 쌓이면 날마다의 변화가 보입니다. 지금은 아래 표의 마지막 기록을 보세요.</p>
              )}
            </StudioCard>
            <StudioCard title="측정 범위" description="숫자가 어디서 왔는지">
              <dl className="divide-y divide-nd-line text-[14px]">
                <div className="pb-3">
                  <dt className="font-semibold text-nd-fg">조회 · 반응</dt>
                  <dd className="mt-0.5 text-[13px] text-nd-fg-3">YouTube · Instagram 공식 연결의 마지막 기록 (게시물마다 출처별 마지막 값을 더함 · 같은 지표는 API 가 직접 입력보다 먼저)</dd>
                </div>
                <div className="py-3">
                  <dt className="font-semibold text-nd-fg">클릭 · 주문 · 제휴 수익</dt>
                  <dd className="mt-0.5 text-[13px] text-nd-fg-3">내 쿠팡 파트너스 키 · 채널 아이디로 받은 기록 또는 직접 입력 — 클릭은 채널 아이디 단위로만 압니다</dd>
                </div>
                <div className="py-3">
                  <dt className="font-semibold text-nd-fg">지금 범위의 출처</dt>
                  <dd className="mt-0.5 text-[13px] text-nd-fg-3">{sources.length ? sources.join(" · ") : "—"}</dd>
                </div>
                <div className="pt-3">
                  <dt className="font-semibold text-nd-fg">제작 비용</dt>
                  <dd className="mt-0.5 text-[13px] text-nd-fg-3">영상에 기록된 비용만 — 묶음은 원화 기록, 영상별 AI 비용은 달러 기록을 1달러 {USD_KRW.toLocaleString("ko-KR")}원으로 어림</dd>
                </div>
              </dl>
            </StudioCard>
          </div>

          <StudioCard
            flush
            title="영상별 성과"
            description={`${listed.length}편 · 우리가 만든 영상만 — 원본(해외) 영상의 반응은 소재 발굴 · 바이럴 형식에서 따로 봅니다`}
          >
            <div className="max-md:px-4 max-md:pb-4">
              <RecordTable ariaLabel="영상별 성과" rows={listed} columns={videoColumns} rowKey={(r) => r.project.id} />
            </div>
          </StudioCard>

          <div className="space-y-3">
            <p className="text-[13px] text-nd-fg-3">「미확인」 은 기록되지 않았거나 공개되지 않은 값입니다 (0 이 아닙니다). 묶음 합계는 값을 아는 영상만 더합니다 — 「일부 미확인」 이 있는 묶음의 비율은 실제와 다를 수 있습니다.</p>
            <StudioNotice tone="neutral">클릭수 · 클릭률 · 전환율 · 수익금은 쿠팡 파트너스 운영정책상 기밀정보입니다 — 화면을 외부에 공유하지 마세요.</StudioNotice>
          </div>
        </div>
      )}
    </PageShell>
  );
}
