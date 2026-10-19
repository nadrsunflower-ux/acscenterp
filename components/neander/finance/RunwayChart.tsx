"use client";

// ============================================================
//  런웨이 — 달마다 남는 현금 꺾은선
// ------------------------------------------------------------
//  재는 것은 하나(기말 현금)라 축도 하나다. 선이 여럿인 건 같은 현금을
//  다른 가정으로 굴렸기 때문이다.
//    예측       잡힌 돈만(실선) · 평소만큼 수주(점선) — 같은 색, 점선은 「아직 아닌 것」
//    줄여 보기  지금(회색) · 시나리오(파랑)
//  범례를 늘 달고, 선 끝에 이름을 직접 적어 색에만 기대지 않는다.
//
//  0 원 아래는 옅게 칠하고 글자로 「현금 바닥 아래」 라 적는다. 바닥나는
//  자리(달 안의 어디쯤)에 점을 찍는다 — 그래프에서 제일 중요한 한 점이다.
//
//  좌표는 실제 픽셀로 계산한다 (TrendChart 와 같은 이유).
// ============================================================

import { useEffect, useId, useRef, useState } from "react";
import { ChartTooltip, cn, Legend, useChartHover, type ChartTooltipRow } from "@/components/neander/ui";
import { formatSigned, monthLabel, shortWon } from "@/lib/neander/format";
import type { RunwayOutcome } from "@/lib/neander/finance/runway";

const H = 260;
const PAD_T = 16;
const PAD_B = 28;
const PAD_L = 76;
const DANGER = "rgb(var(--nd-danger))";

export interface RunwayChartSeries {
  key: string;
  label: string;
  /** 기준 달 말 잔액(실적) + 내다보는 달마다 기말 현금 — months 와 길이가 같다 */
  values: number[];
  /** 선 색 (hex) */
  color: string;
  dashed?: boolean;
  /** 범례 이름 (없으면 label) */
  legend?: string;
  /** 범례·선 끝 이름 없이 그리기만 — 짝이 되는 선의 이름으로 충분할 때 */
  quiet?: boolean;
}

/** 1·2·2.5·5 배수 눈금 간격 */
function niceStep(range: number): number {
  if (range <= 0) return 1;
  const raw = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
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

const sameValues = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.round(v) === Math.round(b[i]));

export function RunwayChart({
  months,
  series,
  zero,
  extraRows,
  className,
}: {
  /** 기준 달 + 내다보는 달 */
  months: string[];
  /** 그리는 순서대로 — 위에 올라와야 할 선을 뒤에 둔다 */
  series: RunwayChartSeries[];
  /** 바닥나는 자리를 찍을 결과 (보통 맨 뒤 선의 것) */
  zero?: RunwayOutcome;
  /** 툴팁 위쪽에 더 보일 줄 (i = months 의 자리) */
  extraRows?: (i: number) => ChartTooltipRow[];
  className?: string;
}) {
  const { index: hover, at, hitProps, clear } = useChartHover();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const id = useId();

  const n = months.length;
  // 앞 선과 숫자가 똑같은 선은 겹쳐 그리지 않는다 (예: B2B 평균이 0 이면 점선 = 실선)
  const drawn = series.filter((s, i) => !series.slice(0, i).some((p) => sameValues(p.values, s.values)));
  const values = series.flatMap((s) => s.values);
  const lo0 = Math.min(0, ...values);
  const hi0 = Math.max(0, ...values);
  const step = niceStep(hi0 - lo0 || 1);
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.max(step, Math.ceil(hi0 / step) * step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));

  // 좁은 화면에서는 선 끝 이름을 접고 범례에만 맡긴다
  const directLabels = width >= 560;
  const PAD_R = directLabels ? 96 : 12;
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * plotH;
  const colW = n <= 1 ? plotW : plotW / (n - 1);
  const labelEvery = colW >= 44 ? 1 : colW >= 24 ? 2 : 3;
  const xLabel = (m: string, i: number) =>
    i === 0 || m.endsWith("-01") ? `${m.slice(2, 4)}.${Number(m.slice(5))}` : `${Number(m.slice(5))}월`;
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // 선 끝 이름 — 아래에서부터 14px 씩 밀어 겹치지 않게
  const endLabels = drawn
    .filter((s) => !s.quiet)
    .map((s) => ({ s, y: y(s.values[n - 1]) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < 14) endLabels[i].y = endLabels[i - 1].y + 14;
  }

  const z = zero && zero.months !== null ? Math.min(zero.months, n - 1) : null;
  const zx = z === null ? null : PAD_L + (n <= 1 ? 0 : (z / (n - 1)) * plotW);
  const y0 = y(0);
  const opening = series[0]?.values[0] ?? 0;
  const top = series[series.length - 1];

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-nd-caption text-nd-fg-3">
          {monthLabel(months[0])} 말 잔액 → {monthLabel(months[n - 1])} 말
        </span>
        <div className="flex items-center gap-3">
          {/* 위에 그리는(주된) 선이 범례 앞에 */}
          <Legend items={[...series].reverse().filter((s) => !s.quiet).map((s) => ({ label: s.legend ?? s.label, color: s.dashed ? `${s.color}99` : s.color }))} />
          <span className="text-nd-caption text-nd-fg-3">기말 현금 · 원</span>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full" onMouseLeave={clear}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-title`} className="block select-none">
            <title id={`${id}-title`}>
              {monthLabel(months[0])} 말 현금 {formatSigned(opening)}원에서 출발한 달마다 기말 현금 꺾은선
            </title>

            {/* 현금 바닥 아래 — 옅게 칠하고 글자로도 적는다 */}
            {lo < 0 && (
              <g>
                <rect x={PAD_L} y={y0} width={plotW} height={Math.max(0, PAD_T + plotH - y0)} fill="rgb(var(--nd-danger-soft))" />
                {/* 오른쪽 끝에 — 왼쪽은 바닥나는 점 표시가 차지한다 */}
                <text x={PAD_L + plotW - 8} y={y0 + 16} textAnchor="end" className="fill-nd-danger-text text-[11px] font-medium">
                  현금 바닥 아래
                </text>
              </g>
            )}

            {/* 눈금 — 배경으로 물러난다. 0 원 선만 진하게 */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={PAD_L + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "rgba(15,23,42,0.35)" : "rgba(15,23,42,0.07)"}
                  strokeWidth={1}
                />
                <text x={PAD_L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="nd-num fill-nd-fg-3 text-[11px]">
                  {shortWon(t)}
                </text>
              </g>
            ))}

            {/* 기준 달과 예상의 경계 */}
            <line x1={x(0)} x2={x(0)} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(15,23,42,0.12)" strokeWidth={1} />

            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(15,23,42,0.25)" strokeWidth={1} pointerEvents="none" />
            )}

            {drawn.map((s) => (
              <path
                key={s.key}
                d={path(s.values)}
                fill="none"
                stroke={s.color}
                strokeOpacity={s.dashed ? 0.6 : 1}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* 지금 — 실적 점 */}
            <circle cx={x(0)} cy={y(opening)} r={4.5} fill={top?.color} stroke="white" strokeWidth={2} />

            {/* 바닥나는 자리 */}
            {zx !== null && zero && (
              <g pointerEvents="none">
                <circle cx={zx} cy={y0} r={5} fill={DANGER} stroke="white" strokeWidth={2} />
                <text
                  x={zx - PAD_L < 40 ? zx + 8 : zx}
                  y={y0 - 10}
                  textAnchor={zx - PAD_L < 40 ? "start" : "middle"}
                  className="fill-nd-danger-text text-[11px] font-semibold"
                >
                  {zero.zeroMonth ? `${Number(zero.zeroMonth.slice(5))}월 바닥` : "바닥"}
                </text>
              </g>
            )}

            {/* 선 끝 이름 */}
            {directLabels &&
              endLabels.map(({ s, y: ly }) => (
                <text
                  key={s.key}
                  x={x(n - 1) + 8}
                  y={ly}
                  dominantBaseline="middle"
                  className={cn("text-[11px]", s === top ? "fill-nd-fg-2 font-medium" : "fill-nd-fg-3")}
                >
                  {s.label}
                </text>
              ))}

            {/* hover 점 */}
            {hover !== null && (
              <g pointerEvents="none">
                {drawn.map((s) => (
                  <circle
                    key={s.key}
                    cx={x(hover)}
                    cy={y(s.values[hover])}
                    r={4.5}
                    fill={s.dashed ? "white" : s.color}
                    stroke={s.dashed ? s.color : "white"}
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}

            {months.map((m, i) => {
              const show = i % labelEvery === 0 || i === n - 1;
              return (
                <g key={m}>
                  <rect
                    x={x(i) - colW / 2}
                    y={PAD_T}
                    width={Math.max(0, colW)}
                    height={plotH + PAD_B}
                    fill="transparent"
                    {...hitProps(i)}
                    aria-label={`${monthLabel(m)} ${i === 0 ? "실제" : "예상"} 기말 현금 ${series
                      .map((s) => `${s.label} ${formatSigned(s.values[i])}원`)
                      .join(", ")}`}
                  />
                  {show && (
                    <text
                      x={x(i)}
                      y={H - 8}
                      textAnchor="middle"
                      className={cn("nd-num text-[11px]", hover === i ? "fill-nd-fg font-semibold" : "fill-nd-fg-3")}
                    >
                      {xLabel(m, i)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <ChartTooltip
        at={at}
        title={hover !== null ? `${monthLabel(months[hover])} 말${hover === 0 ? " · 실제" : ""}` : ""}
        rows={
          hover === null
            ? []
            : hover === 0
              ? [{ key: "cash", label: "통장 잔액", color: top?.color, value: formatSigned(opening), negative: opening < 0, total: true }]
              : [
                  ...(extraRows?.(hover) ?? []),
                  ...[...series].reverse().map((s, k) => ({
                    key: s.key,
                    label: `기말 · ${s.label}`,
                    color: s.dashed ? `${s.color}99` : s.color,
                    value: formatSigned(s.values[hover]),
                    negative: s.values[hover] < 0,
                    total: k === 0,
                  })),
                ]
        }
      />
      <p className="sr-only" aria-live="polite">
        {hover !== null ? `${monthLabel(months[hover])} 말 ${series.map((s) => `${s.label} ${formatSigned(s.values[hover])}원`).join(", ")}` : ""}
      </p>
    </div>
  );
}
