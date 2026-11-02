"use client";

// ============================================================
//  시장 트렌드 차트 — 검색어 추이 꺾은선 · 작은 추이선(스파크라인)
// ------------------------------------------------------------
//  색은 계열마다 고정(검증한 5색 · light surface 대비가 3:1 아래인 색이 있어 선 끝 이름표 · 범례 · 표 보기를 늘 붙인다).
//  값은 네이버 데이터랩 상대값(0~100) — 단위가 없다. 축은 하나(0~100).
//  hover: 가까운 구간에 세로선 + 커서 옆 값 (chart-tooltip). 표 보기는 ChartValues.
// ============================================================

import { useEffect, useId, useRef, useState } from "react";
import { ChartTooltip, ChartValues, Legend, cn } from "@/components/neander/ui";

/** 검증한 범주 5색 (dataviz validate_palette · light · CVD 최악 ΔE 9.1 · 정상 시각 19.6) */
export const TREND_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;

export interface TrendLine {
  key: string;
  name: string;
  color: string;
  points: { period: string; ratio: number }[];
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

const H = 280;
const PAD_T = 14;
const PAD_B = 28;
const PAD_L = 34;

/** 구간 이름 — 주 · 날은 M/D, 달은 YY.M */
export const periodLabel = (p: string, unit: "week" | "month" | "date") => (unit === "month" ? `${p.slice(2, 4)}.${Number(p.slice(5, 7))}` : `${Number(p.slice(5, 7))}/${Number(p.slice(8, 10))}`);

export function TrendLines({ lines, unit, title, className }: { lines: TrendLine[]; unit: "week" | "month"; title: string; className?: string }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const id = useId();
  const periods = [...new Set(lines.flatMap((l) => l.points.map((p) => p.period)))].sort();
  // 선 끝 이름표 자리 — 가장 긴 이름에 맞춰 오른쪽을 비운다
  const padR = Math.min(140, Math.max(48, ...lines.map((l) => l.name.length * 13 + 16)));
  if (!periods.length) return <p className="py-8 text-center text-nd-body text-nd-fg-3">표시할 값이 없습니다.</p>;
  const plotW = Math.max(0, width - PAD_L - padR);
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (periods.length === 1 ? plotW / 2 : (i / (periods.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const valueAt = (l: TrendLine, p: string) => l.points.find((q) => q.period === p)?.ratio ?? null;
  const step = Math.max(1, Math.ceil(periods.length / Math.max(2, Math.floor(plotW / 64))));
  // 선 끝 이름표 — 겹치지 않게 아래로 민다 (최소 15px) · 바닥 밖으로 나가면 바닥부터 위로 되민다
  const ends = lines
    .map((l) => {
      const last = [...l.points].reverse().find((p) => periods.includes(p.period));
      return last ? { l, y: y(last.ratio) } : null;
    })
    .filter((e): e is { l: TrendLine; y: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  if (ends.length && ends[ends.length - 1].y > PAD_T + plotH) {
    ends[ends.length - 1].y = PAD_T + plotH;
    for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < 15) ends[i].y = ends[i + 1].y - 15;
  }
  // 마지막 구간 이름은 늘 쓰고, 그 바로 앞 눈금이 너무 가까우면 뺀다
  const lastI = periods.length - 1;
  const showTick = (i: number) => i === lastI || (i % step === 0 && x(lastI) - x(i) >= 44);
  const cur = hover !== null ? periods[hover] : null;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / Math.max(1, r.width);
    setHover(Math.max(0, Math.min(periods.length - 1, Math.round(rel * (periods.length - 1)))));
    setAt({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Legend items={lines.map((l) => ({ label: l.name, color: l.color }))} />
        <span className="text-nd-caption text-nd-fg-3">값: 네이버 상대값 (가장 높은 구간 = 100)</span>
      </div>
      <div ref={wrapRef} className="relative w-full" onMouseLeave={() => (setHover(null), setAt(null))}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-t`} className="block select-none">
            <title id={`${id}-t`}>{title}</title>
            {[0, 25, 50, 75, 100].map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(15,23,42,0.18)" : "rgba(15,23,42,0.07)"} strokeWidth={1} />
                <text x={PAD_L - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="nd-num fill-nd-fg-3 text-[11px]">
                  {t}
                </text>
              </g>
            ))}
            {periods.map((p, i) =>
              showTick(i) ? (
                <text key={p} x={x(i)} y={H - 8} textAnchor="middle" className={cn("nd-num text-[11px]", hover === i ? "fill-nd-fg font-semibold" : "fill-nd-fg-3")}>
                  {periodLabel(p, unit)}
                </text>
              ) : null,
            )}
            {cur && <line x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(15,23,42,0.25)" strokeWidth={1} />}
            {lines.map((l) => {
              const pts = periods.map((p, i) => ({ i, v: valueAt(l, p) })).filter((q): q is { i: number; v: number } => q.v !== null);
              return (
                <g key={l.key}>
                  <polyline points={pts.map((q) => `${x(q.i)},${y(q.v)}`).join(" ")} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {cur && valueAt(l, cur) !== null && <circle cx={x(hover!)} cy={y(valueAt(l, cur)!)} r={4.5} fill={l.color} stroke="#fff" strokeWidth={2} />}
                </g>
              );
            })}
            {ends.map((e) => (
              <text key={e.l.key} x={PAD_L + plotW + 8} y={e.y} dominantBaseline="middle" className="fill-nd-fg-2 text-[12px] font-medium">
                <tspan fill={e.l.color}>●</tspan> {e.l.name}
              </text>
            ))}
            <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} aria-hidden />
          </svg>
        )}
      </div>
      <ChartTooltip
        at={at}
        title={cur ? (unit === "month" ? `${cur.slice(0, 4)}년 ${Number(cur.slice(5, 7))}월` : `${cur} 주`) : ""}
        unit=""
        rows={cur ? lines.map((l) => ({ key: l.key, label: l.name, color: l.color, value: valueAt(l, cur) === null ? "—" : String(valueAt(l, cur)) })) : []}
      />
      <ChartValues
        className="mt-2"
        label="수치 표로 보기"
        hideLabel="수치 표 닫기"
        rowHeader={unit === "month" ? "달" : "주(시작일)"}
        columns={lines.map((l) => ({ key: l.key, label: l.name, color: l.color }))}
        rows={[...periods].reverse().map((p) => ({ key: p, label: p, values: Object.fromEntries(lines.map((l) => [l.key, valueAt(l, p)])) }))}
        format={(v) => String(v)}
        note="네이버 데이터랩 상대값 — 이 그래프 안에서 가장 높은 구간이 100"
      />
    </div>
  );
}

/** 작은 추이선 — 카드 · 표 칸 (축 없음, 끝 점만) */
export function Sparkline({ values, color = TREND_COLORS[0], width = 120, height = 32, className }: { values: (number | null)[]; color?: string; width?: number; height?: number; className?: string }) {
  const v = values.map((x, i) => ({ i, x })).filter((q): q is { i: number; x: number } => q.x !== null);
  if (v.length < 2) return <span className={cn("inline-block text-[12px] text-nd-fg-3", className)}>기록 쌓는 중</span>;
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
