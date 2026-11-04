"use client";

// ============================================================
//  시장 트렌드 차트 — 검색어 추이 꺾은선 · 작은 추이선(스파크라인)
// ------------------------------------------------------------
//  색은 계열마다 고정(검증한 5색 · light surface 대비가 3:1 아래인 색이 있어 선 끝 이름표 · 범례 · 표 보기를 늘 붙인다).
//  색만으로 구분하지 않게 선 모양(실선 · 점선 …)도 색 자리마다 고정 — 범례에 「수납 · 실선」 처럼 글로도 쓴다.
//  값은 네이버 데이터랩 상대값(0~100) — 단위가 없다. 축은 하나(0~100). 축 · 이름표 글자는 13px.
//  hover: 가까운 구간에 세로선 + 커서 옆 값 (chart-tooltip). 표 보기는 ChartValues.
//  scale 을 주면 0~100 대신 다른 값(제목 키워드의 채널 수 등)을 같은 모양으로 그린다 — 축은 여전히 하나.
//  값이 null 인 구간(자료 없는 주)은 점을 찍지 않고 선을 끊는다 (0 과 다르다).
// ============================================================

import { useEffect, useId, useState } from "react";
import { ChartTooltip, ChartValues, cn } from "@/components/neander/ui";

/** 검증한 범주 5색 (dataviz validate_palette · light · CVD 최악 ΔE 9.1 · 정상 시각 19.6) */
export const TREND_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
/** 색 자리마다 고정한 선 모양 — 색을 못 가려도 모양으로 (CVD · 흑백 인쇄) */
export const TREND_DASHES = ["", "7 4", "2 3", "10 3 2 3", "4 4"] as const;
export const TREND_DASH_LABEL = ["실선", "긴 점선", "짧은 점선", "점·선", "점선"] as const;
/** 색 → 그 자리의 선 모양 번호 (모르는 색이면 0 = 실선) */
export const dashSlot = (color: string) => Math.max(0, (TREND_COLORS as readonly string[]).indexOf(color));

export interface TrendLine {
  key: string;
  name: string;
  color: string;
  points: { period: string; ratio: number | null }[];
  /** 선 모양 자리 (없으면 색 자리를 따른다) */
  dash?: number;
}

/**
 * 너비 재기 — 콜백 ref 라 상자가 나중에 생겨도(처음엔 「표시할 값이 없습니다」 였다가 값이 온 경우) 잰다.
 * (예전 useRef + 빈 의존성은 첫 그리기에 상자가 없으면 끝내 0 이었다)
 */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

const H = 300;
const PAD_T = 16;
const PAD_B = 32;
const PAD_L = 40;
const LABEL_GAP = 18;

/** 구간 이름 — 주 · 날은 M/D, 달은 YY.M */
export const periodLabel = (p: string, unit: "week" | "month" | "date") => (unit === "month" ? `${p.slice(2, 4)}.${Number(p.slice(5, 7))}` : `${Number(p.slice(5, 7))}/${Number(p.slice(8, 10))}`);
const fmtV = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const slotOf = (l: TrendLine) => l.dash ?? dashSlot(l.color);

/** 0 부터 max 를 덮는 보기 좋은 눈금 (정수 · 4~5칸) */
export function niceTicks(max: number): number[] {
  const top = Math.max(1, max);
  const raw = top / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const out: number[] = [];
  for (let t = 0; t < top + step; t += step) out.push(Math.round(t));
  return out;
}

/** 다른 값 범위 — 눈금 · 단위 · 표 머리 (없으면 네이버 상대값 0~100) */
export interface TrendScale {
  ticks: number[];
  /** 툴팁 · 표의 단위 (예: 「곳」) */
  unit?: string;
  tableNote?: string;
  rowHeader?: string;
}

/** 범례 한 칸 — 선 모양 견본 + 이름 + (모양 이름) */
function LineSwatch({ color, slot, width = 26 }: { color: string; slot: number; width?: number }) {
  return (
    <svg width={width} height={10} aria-hidden className="shrink-0">
      <line x1={1} x2={width - 1} y1={5} y2={5} stroke={color} strokeWidth={2.5} strokeDasharray={TREND_DASHES[slot % TREND_DASHES.length] || undefined} strokeLinecap="round" />
    </svg>
  );
}

export function TrendLines({ lines, unit, title, className, note, scale }: { lines: TrendLine[]; unit: "week" | "month"; title: string; className?: string; note?: string; scale?: TrendScale }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const id = useId();
  const periods = [...new Set(lines.flatMap((l) => l.points.map((p) => p.period)))].sort();
  const lastOf = (l: TrendLine) => ([...l.points].reverse().find((p) => periods.includes(p.period) && p.ratio !== null) as { period: string; ratio: number } | undefined) ?? null;
  const ticks = scale?.ticks ?? [0, 25, 50, 75, 100];
  const yMax = ticks[ticks.length - 1] || 100;
  // 선 끝 이름표 자리 — 「이름 값」 중 가장 긴 것에 맞춰 오른쪽을 비운다 (좁은 화면에서는 줄여서)
  const labelW = Math.max(56, ...lines.map((l) => l.name.length * 13.5 + String(fmtV(lastOf(l)?.ratio ?? 0)).length * 8.5 + 22));
  const padR = Math.min(width < 480 ? 110 : 190, labelW);
  if (!periods.length) return <p className="py-8 text-center text-nd-body text-nd-fg-3">표시할 값이 없습니다.</p>;
  const plotW = Math.max(0, width - PAD_L - padR);
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (periods.length === 1 ? plotW / 2 : (i / (periods.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (Math.max(0, Math.min(yMax, v)) / yMax) * plotH;
  const valueAt = (l: TrendLine, p: string) => l.points.find((q) => q.period === p)?.ratio ?? null;
  const step = Math.max(1, Math.ceil(periods.length / Math.max(2, Math.floor(plotW / 72))));
  // 선 끝 이름표 — 겹치지 않게 아래로 민다 · 바닥 밖으로 나가면 바닥부터 위로 되민다
  const ends = lines
    .map((l) => {
      const last = lastOf(l);
      return last ? { l, v: last.ratio, y: y(last.ratio) } : null;
    })
    .filter((e): e is { l: TrendLine; v: number; y: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < LABEL_GAP) ends[i].y = ends[i - 1].y + LABEL_GAP;
  if (ends.length && ends[ends.length - 1].y > PAD_T + plotH) {
    ends[ends.length - 1].y = PAD_T + plotH;
    for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < LABEL_GAP) ends[i].y = ends[i + 1].y - LABEL_GAP;
  }
  // 마지막 구간 이름은 늘 쓰고, 그 바로 앞 눈금이 너무 가까우면 뺀다
  const lastI = periods.length - 1;
  const showTick = (i: number) => i === lastI || (i % step === 0 && x(lastI) - x(i) >= 52);
  const cur = hover !== null ? periods[hover] : null;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / Math.max(1, r.width);
    setHover(Math.max(0, Math.min(periods.length - 1, Math.round(rel * (periods.length - 1)))));
    setAt({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span className="text-[13px] font-medium text-nd-fg-2">{note ?? "검색 지수 · 공통 축 (가장 높은 구간 = 100)"}</span>
      </div>
      <div ref={wrapRef} className="relative w-full" onMouseLeave={() => (setHover(null), setAt(null))}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-t`} className="block select-none">
            <title id={`${id}-t`}>{title}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(15,23,42,0.18)" : "rgba(15,23,42,0.07)"} strokeWidth={1} />
                <text x={PAD_L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="nd-num fill-nd-fg-3 text-[13px]">
                  {t}
                </text>
              </g>
            ))}
            {periods.map((p, i) =>
              showTick(i) ? (
                <text key={p} x={x(i)} y={H - 9} textAnchor={i === lastI && periods.length > 1 ? "end" : i === 0 ? "start" : "middle"} className={cn("nd-num text-[13px]", hover === i ? "fill-nd-fg font-semibold" : "fill-nd-fg-3")}>
                  {periodLabel(p, unit)}
                </text>
              ) : null,
            )}
            {cur && <line x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(15,23,42,0.25)" strokeWidth={1} />}
            {lines.map((l) => {
              const all = periods.map((p, i) => ({ i, v: valueAt(l, p) }));
              const pts = all.filter((q): q is { i: number; v: number } => q.v !== null);
              // 값이 없는 구간에서 선을 끊는다 — 자료 없는 주를 0 으로 잇지 않게
              const runs: { i: number; v: number }[][] = [];
              for (const q of all) {
                if (q.v === null) runs.push([]);
                else (runs.at(-1) ?? runs[runs.push([]) - 1]).push(q as { i: number; v: number });
              }
              const last = pts.at(-1);
              return (
                <g key={l.key}>
                  {runs
                    .filter((r) => r.length > 0)
                    .map((r, ri) =>
                      r.length === 1 ? (
                        <circle key={ri} cx={x(r[0].i)} cy={y(r[0].v)} r={3} fill={l.color} />
                      ) : (
                        <polyline
                          key={ri}
                          points={r.map((q) => `${x(q.i)},${y(q.v)}`).join(" ")}
                          fill="none"
                          stroke={l.color}
                          strokeWidth={2}
                          strokeDasharray={TREND_DASHES[slotOf(l) % TREND_DASHES.length] || undefined}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      ),
                    )}
                  {last && <circle cx={x(last.i)} cy={y(last.v)} r={4} fill="#fff" stroke={l.color} strokeWidth={2} />}
                  {cur && valueAt(l, cur) !== null && <circle cx={x(hover!)} cy={y(valueAt(l, cur)!)} r={5} fill={l.color} stroke="#fff" strokeWidth={2} />}
                </g>
              );
            })}
            {ends.map((e) => (
              <text key={e.l.key} x={PAD_L + plotW + 10} y={e.y} dominantBaseline="middle" className="fill-nd-fg-2 text-[13px] font-semibold">
                {e.l.name.length > 9 && width < 480 ? `${e.l.name.slice(0, 8)}…` : e.l.name} <tspan className="nd-num fill-nd-fg">{fmtV(e.v)}</tspan>
              </text>
            ))}
            <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} aria-hidden />
          </svg>
        )}
      </div>
      {/* 범례 — 색 + 선 모양 + 글 (색만으로 말하지 않는다) */}
      <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5" aria-label="범례">
        {lines.map((l) => (
          <li key={l.key} className="inline-flex items-center gap-2 text-[13px] text-nd-fg-2">
            <LineSwatch color={l.color} slot={slotOf(l)} />
            <span>
              {l.name} <span className="text-nd-fg-3">· {TREND_DASH_LABEL[slotOf(l) % TREND_DASH_LABEL.length]}</span>
            </span>
          </li>
        ))}
      </ul>
      <ChartTooltip
        at={at}
        title={cur ? (unit === "month" ? `${cur.slice(0, 4)}년 ${Number(cur.slice(5, 7))}월` : `${cur} 주`) : ""}
        unit={scale?.unit ?? ""}
        rows={cur ? lines.map((l) => ({ key: l.key, label: l.name, color: l.color, value: valueAt(l, cur) === null ? "—" : fmtV(valueAt(l, cur)!) })) : []}
      />
      <ChartValues
        className="mt-2"
        label="수치 표로 보기"
        hideLabel="수치 표 닫기"
        rowHeader={scale?.rowHeader ?? (unit === "month" ? "달" : "주(시작일)")}
        columns={lines.map((l) => ({ key: l.key, label: l.name, color: l.color }))}
        rows={[...periods].reverse().map((p) => ({ key: p, label: p, values: Object.fromEntries(lines.map((l) => [l.key, valueAt(l, p)])) }))}
        format={(v) => fmtV(v)}
        note={scale?.tableNote ?? "네이버 데이터랩 상대값 — 이 그래프 안에서 가장 높은 구간이 100"}
      />
    </div>
  );
}

/** 작은 추이선 — 카드 · 표 칸 (축 없음, 끝 점만) */
export function Sparkline({ values, color = TREND_COLORS[0], width = 120, height = 32, className }: { values: (number | null)[]; color?: string; width?: number; height?: number; className?: string }) {
  const v = values.map((x, i) => ({ i, x })).filter((q): q is { i: number; x: number } => q.x !== null);
  if (v.length < 2) return <span className={cn("inline-block text-[13px] text-nd-fg-3", className)}>기록 쌓는 중</span>;
  const min = Math.min(...v.map((q) => q.x));
  const max = Math.max(...v.map((q) => q.x));
  const sx = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (width - 4);
  const sy = (x: number) => (max === min ? height / 2 : 2 + (1 - (x - min) / (max - min)) * (height - 4));
  const last = v[v.length - 1];
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={v.map((q) => `${sx(q.i)},${sy(q.x)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(last.i)} cy={sy(last.x)} r={3} fill={color} />
    </svg>
  );
}
