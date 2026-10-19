"use client";

// ============================================================
//  런웨이 — 달마다 남는 현금 꺾은선
// ------------------------------------------------------------
//  재는 것은 하나(기말 현금)라 축도 하나다. 선이 둘인 건 같은 현금을 두
//  가정으로 굴렸기 때문이다 — 같은 색으로 두고 실선(잡힌 돈만)과
//  점선(평소만큼 수주)으로 가른다. 점선은 「아직 아닌 것」으로 읽힌다.
//  범례를 늘 달고, 선 끝에 이름을 직접 적어 색에만 기대지 않는다.
//
//  0 원 아래는 옅게 칠하고 글자로 「현금 바닥」 이라 적는다. 바닥나는
//  자리(달 안의 어디쯤)에 점을 찍는다 — 그래프에서 제일 중요한 한 점이다.
//
//  좌표는 실제 픽셀로 계산한다 (TrendChart 와 같은 이유).
// ============================================================

import { useEffect, useId, useRef, useState } from "react";
import { ChartTooltip, cn, Legend, SERIES, useChartHover } from "@/components/neander/ui";
import { formatSigned, monthLabel, shortWon } from "@/lib/neander/format";
import type { RunwayMonth, RunwayOutcome } from "@/lib/neander/finance/runway";

const H = 260;
const PAD_T = 16;
const PAD_B = 28;
const PAD_L = 76;
const LINE = SERIES.income;
const DANGER = "rgb(var(--nd-danger))";

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

interface Point {
  month: string;
  value: number;
  alt: number;
  /** 실적(기준 달 말 잔액) — 예상이 아니다 */
  actual?: boolean;
  row?: RunwayMonth;
}

export function RunwayChart({
  asOf,
  openingCash,
  rows,
  outcome,
  outcomeAlt,
  className,
}: {
  asOf: string;
  openingCash: number;
  rows: RunwayMonth[];
  outcome: RunwayOutcome;
  outcomeAlt: RunwayOutcome;
  className?: string;
}) {
  const { index: hover, at, hitProps, clear } = useChartHover();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const id = useId();

  const points: Point[] = [
    { month: asOf, value: openingCash, alt: openingCash, actual: true },
    ...rows.map((r) => ({ month: r.month, value: r.closing, alt: r.closingAlt, row: r })),
  ];
  const values = points.flatMap((p) => [p.value, p.alt]);
  const lo0 = Math.min(0, ...values);
  const hi0 = Math.max(0, ...values);
  const step = niceStep(hi0 - lo0 || 1);
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.max(step, Math.ceil(hi0 / step) * step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));

  // 좁은 화면에서는 선 끝 이름을 접고 범례에만 맡긴다
  const directLabels = width >= 560;
  const PAD_R = directLabels ? 92 : 12;
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const n = points.length;
  const x = (i: number) => PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * plotH;
  const colW = n <= 1 ? plotW : plotW / (n - 1);
  const labelEvery = colW >= 44 ? 1 : colW >= 24 ? 2 : 3;
  const xLabel = (m: string, i: number) =>
    i === 0 || m.endsWith("-01") ? `${m.slice(2, 4)}.${Number(m.slice(5))}` : `${Number(m.slice(5))}월`;

  const path = (pick: (p: Point) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const sameLines = points.every((p) => p.value === p.alt);

  /** 바닥나는 자리 — 0번 점이 기준 달 말이므로 months 그대로가 x 위치다 */
  const zeroAt = (o: RunwayOutcome) => (o.months === null ? null : Math.min(o.months, n - 1));
  const z = zeroAt(outcome);
  const zx = z === null ? null : PAD_L + (n <= 1 ? 0 : (z / (n - 1)) * plotW);

  const cur = hover !== null ? points[hover] : null;
  const y0 = y(0);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-nd-caption text-nd-fg-3">
          {monthLabel(asOf)} 말 잔액 → {monthLabel(points[n - 1].month)} 말
        </span>
        <div className="flex items-center gap-3">
          <Legend
            items={[
              { label: "잡힌 돈만", color: LINE },
              { label: "평소만큼 수주 (점선)", color: `${LINE}99` },
            ]}
          />
          <span className="text-nd-caption text-nd-fg-3">기말 현금 · 원</span>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full" onMouseLeave={clear}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-title`} className="block select-none">
            <title id={`${id}-title`}>
              {monthLabel(asOf)} 말 현금 {formatSigned(openingCash)}원에서 출발한 달마다 기말 현금 꺾은선
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

            {!sameLines && (
              <path d={path((p) => p.alt)} fill="none" stroke={LINE} strokeOpacity={0.6} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />
            )}
            <path d={path((p) => p.value)} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {/* 지금 — 실적 점 */}
            <circle cx={x(0)} cy={y(openingCash)} r={4.5} fill={LINE} stroke="white" strokeWidth={2} />

            {/* 바닥나는 자리 */}
            {zx !== null && (
              <g pointerEvents="none">
                <circle cx={zx} cy={y0} r={5} fill={DANGER} stroke="white" strokeWidth={2} />
                <text
                  x={zx - PAD_L < 40 ? zx + 8 : zx}
                  y={y0 - 10}
                  textAnchor={zx - PAD_L < 40 ? "start" : "middle"}
                  className="fill-nd-danger-text text-[11px] font-semibold"
                >
                  {outcome.zeroMonth ? `${Number(outcome.zeroMonth.slice(5))}월 바닥` : "바닥"}
                </text>
              </g>
            )}

            {/* 선 끝 이름 */}
            {directLabels && (
              <g className="text-[11px]">
                <text x={x(n - 1) + 8} y={y(points[n - 1].value)} dominantBaseline="middle" className="fill-nd-fg-2 font-medium">
                  잡힌 돈만
                </text>
                {!sameLines && (
                  <text
                    x={x(n - 1) + 8}
                    y={y(points[n - 1].alt) + (Math.abs(y(points[n - 1].alt) - y(points[n - 1].value)) < 14 ? -14 : 0)}
                    dominantBaseline="middle"
                    className="fill-nd-fg-3"
                  >
                    평소 수주
                  </text>
                )}
              </g>
            )}

            {/* hover 점 */}
            {cur && hover !== null && (
              <g pointerEvents="none">
                {!sameLines && <circle cx={x(hover)} cy={y(cur.alt)} r={4} fill="white" stroke={LINE} strokeWidth={2} />}
                <circle cx={x(hover)} cy={y(cur.value)} r={4.5} fill={LINE} stroke="white" strokeWidth={2} />
              </g>
            )}

            {points.map((p, i) => {
              const show = i % labelEvery === 0 || i === n - 1;
              return (
                <g key={p.month}>
                  <rect
                    x={x(i) - colW / 2}
                    y={PAD_T}
                    width={Math.max(0, colW)}
                    height={plotH + PAD_B}
                    fill="transparent"
                    {...hitProps(i)}
                    aria-label={`${monthLabel(p.month)} ${p.actual ? "실제" : "예상"} 기말 현금 ${formatSigned(p.value)}원`}
                  />
                  {show && (
                    <text
                      x={x(i)}
                      y={H - 8}
                      textAnchor="middle"
                      className={cn("nd-num text-[11px]", hover === i ? "fill-nd-fg font-semibold" : "fill-nd-fg-3")}
                    >
                      {xLabel(p.month, i)}
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
        title={cur ? `${monthLabel(cur.month)} 말${cur.actual ? " · 실제" : ""}` : ""}
        rows={
          !cur
            ? []
            : cur.actual
              ? [{ key: "cash", label: "통장 잔액", color: LINE, value: formatSigned(cur.value), negative: cur.value < 0, total: true }]
              : [
                  { key: "in", label: "들어올 돈", value: formatSigned(cur.row!.income) },
                  { key: "out", label: "나갈 돈", value: formatSigned(-cur.row!.expense), negative: true },
                  { key: "cash", label: "기말 · 잡힌 돈만", color: LINE, value: formatSigned(cur.value), negative: cur.value < 0, total: true },
                  ...(sameLines
                    ? []
                    : [{ key: "alt", label: "기말 · 평소 수주", color: `${LINE}99`, value: formatSigned(cur.alt), negative: cur.alt < 0 }]),
                ]
        }
      />
      <p className="sr-only" aria-live="polite">
        {cur ? `${monthLabel(cur.month)} 말 기말 현금 ${formatSigned(cur.value)}원` : ""}
      </p>
      {outcomeAlt.months !== outcome.months && <span className="sr-only">평소만큼 수주하면 바닥나는 달 {outcomeAlt.zeroMonth ?? "없음"}</span>}
    </div>
  );
}
