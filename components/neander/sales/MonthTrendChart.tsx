"use client";

// ============================================================
//  월별 추이 — 매장별 그룹 세로 막대
// ------------------------------------------------------------
//  재무 대시보드의 「월별 추이」와 **같은 모양**이다. 축 여백·높이·눈금
//  간격·라벨 축약·hover 동작을 그대로 맞췄다 (TrendChart.tsx 참고).
//  두 화면을 번갈아 보는 사람이 매번 다시 적응할 이유가 없다.
//
//  다른 점은 계열 수뿐이다. 재무는 수입·지출 둘인데 여기는 매장 셋이라
//  계열을 배열로 받는다. 재무 TrendChart 를 고쳐 일반화하지 않은 이유는
//  그쪽이 다른 작업으로 수정 중이라, 지금 건드리면 충돌하기 때문이다.
//
//  ⚠️ 축은 하나만 쓴다. 매장 셋 다 같은 '원' 단위라 한 축에 올려야 크기
//     비교가 성립한다. 음수(영업손실)가 있으면 0 선 아래로 내려간다 —
//     재무 차트는 수입·지출이 늘 양수라 그 처리가 없었다.
// ============================================================

import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ChartTooltip,
  cn,
  Legend,
  useChartHover,
} from "@/components/neander/ui";
import {
  formatSigned,
  monthLabel,
  shortWon,
} from "@/lib/neander/format";

const H = 220;
const PAD_T = 12;
const PAD_B = 28;
const PAD_L = 72;
const PAD_R = 8;
const BAR_MAX = 22;
const BAR_GAP = 3;

/** 눈금 상한 — 1·2·2.5·5 배수로 올림 (재무 차트와 같은 규칙) */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const r = v / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return step * mag;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  /**
   * 다른 계열을 합친 막대 (매장 셋의 합계). 값은 부르는 쪽이 넣는다.
   * hover 합계를 셀 때 이 계열은 **더하지 않고** 그 값을 합계로 쓴다 —
   * 더하면 합계가 두 배가 된다.
   */
  total?: boolean;
}

export interface TrendPoint {
  month: string;
  /** 계열 key → 값 */
  values: Record<string, number>;
}

export function MonthTrendChart({
  points,
  series,
  /** hover 줄에 함께 보여줄 합계 라벨 (없으면 표시 안 함) */
  totalLabel,
  className,
}: {
  points: TrendPoint[];
  series: TrendSeries[];
  totalLabel?: string;
  className?: string;
}) {
  const { index: hover, at, hitProps, clear } = useChartHover();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const id = useId();

  if (points.length === 0 || series.length === 0) return null;

  const all = points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0));
  const hiMax = niceMax(Math.max(...all, 1));
  // 손실이 있으면 0 선 아래 공간을 잡는다
  const lowest = Math.min(...all, 0);
  const loMax = lowest < 0 ? niceMax(-lowest) : 0;
  const span = hiMax + loMax;

  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const groupW = points.length ? plotW / points.length : 0;
  const barW = Math.max(
    2,
    Math.min(
      BAR_MAX,
      (groupW - Math.max(6, groupW * 0.3) - BAR_GAP * (series.length - 1)) / series.length,
    ),
  );
  const y = (v: number) => PAD_T + plotH - ((v + loMax) / span) * plotH;
  const zero = y(0);

  // 0 을 포함해 6칸 — 음수 구간이 있으면 그쪽에도 눈금을 준다
  const step = span / 5;
  const ticks = Array.from({ length: 6 }, (_, i) => -loMax + step * i);

  const labelEvery = groupW >= 36 ? 1 : groupW >= 20 ? 2 : 3;
  const first = points[0].month;
  const last = points[points.length - 1].month;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const xLabel = (m: string) =>
    sameYear ? `${Number(m.slice(5))}월` : m.slice(2).replace("-", ".");

  const cur = hover !== null ? points[hover] : null;
  const totalSeries = series.find((s) => s.total);
  const partSeries = series.filter((s) => !s.total);
  const curTotal = cur
    ? totalSeries
      ? (cur.values[totalSeries.key] ?? 0)
      : partSeries.reduce((a, s) => a + (cur.values[s.key] ?? 0), 0)
    : 0;

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-nd-caption text-nd-fg-3">
          {monthLabel(first)} – {monthLabel(last)}
        </span>
        <div className="flex items-center gap-3">
          <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
          <span className="text-nd-caption text-nd-fg-3">단위: 원</span>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full" onMouseLeave={clear}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-labelledby={`${id}-title`}
            className="block select-none"
          >
            <title id={`${id}-title`}>
              {monthLabel(first)}부터 {monthLabel(last)}까지 매장별 월 추이 막대 그래프
            </title>

            {ticks.map((t) => {
              const isZero = Math.abs(t) < span / 1000;
              return (
                <g key={t}>
                  <line
                    x1={PAD_L}
                    x2={width - PAD_R}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={isZero ? "rgba(15,23,42,0.18)" : "rgba(15,23,42,0.07)"}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 8}
                    y={y(t)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="nd-num fill-nd-fg-3 text-[11px]"
                  >
                    {shortWon(t)}
                  </text>
                </g>
              );
            })}

            {points.map((p, i) => {
              const active = hover === i;
              const dim = hover !== null && !active;
              const gx = PAD_L + i * groupW + groupW / 2;
              const totalW = barW * series.length + BAR_GAP * (series.length - 1);
              const showLabel = i % labelEvery === 0 || i === points.length - 1;
              return (
                <g key={p.month}>
                  {/* 히트 영역 — 막대보다 크게 잡아 hover 가 쉽도록 */}
                  <rect
                    x={PAD_L + i * groupW}
                    y={PAD_T}
                    width={Math.max(0, groupW)}
                    height={plotH + PAD_B}
                    fill={active ? "rgba(15,23,42,0.035)" : "transparent"}
                    {...hitProps(i)}
                    aria-label={`${monthLabel(p.month)} ${series
                      .map((s) => `${s.label} ${formatSigned(p.values[s.key] ?? 0)}원`)
                      .join(", ")}`}
                    rx={6}
                  />
                  {series.map((s, si) => {
                    const v = p.values[s.key] ?? 0;
                    const x = gx - totalW / 2 + si * (barW + BAR_GAP);
                    const top = v >= 0 ? y(v) : zero;
                    const h = Math.abs(zero - y(v));
                    return (
                      <rect
                        key={s.key}
                        x={x}
                        y={top}
                        width={barW}
                        height={Math.max(v === 0 ? 0 : 1, h)}
                        fill={s.color}
                        opacity={dim ? 0.4 : 1}
                        rx={3}
                        pointerEvents="none"
                      />
                    );
                  })}
                  {showLabel && (
                    <text
                      x={gx}
                      y={H - 8}
                      textAnchor="middle"
                      className={cn(
                        "nd-num text-[11px]",
                        active ? "fill-nd-fg font-semibold" : "fill-nd-fg-3",
                      )}
                    >
                      {xLabel(p.month)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* 값은 커서 옆에 띄운다 — 매장이 셋이라 아래 줄로 내려가면 눈이 멀다
          (공통 판: components/neander/ui/chart-tooltip.tsx) */}
      <ChartTooltip
        at={at}
        title={cur ? monthLabel(cur.month) : ""}
        rows={
          cur
            ? [
                ...partSeries.map((s2) => ({
                  key: s2.key,
                  label: s2.label,
                  color: s2.color,
                  value: formatSigned(cur.values[s2.key] ?? 0),
                  negative: (cur.values[s2.key] ?? 0) < 0,
                })),
                // 합계 막대가 있으면 그 막대(회색 점)가 곧 합계 줄이다 — 줄을 둘 두지 않는다
                ...(totalSeries || totalLabel
                  ? [
                      {
                        key: totalSeries?.key ?? "__total",
                        label: totalSeries?.label ?? totalLabel ?? "합계",
                        color: totalSeries?.color,
                        value: formatSigned(curTotal),
                        negative: curTotal < 0,
                        total: true,
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
      {/* 판은 화면 낭독기에 잡히지 않는다(aria-hidden) — 대신 여기로 알린다 */}
      <p className="sr-only" aria-live="polite">
        {cur
          ? `${monthLabel(cur.month)} ${series
              .map((s2) => `${s2.label} ${formatSigned(cur.values[s2.key] ?? 0)}원`)
              .join(", ")}`
          : ""}
      </p>
    </div>
  );
}
