"use client";

// ============================================================
//  월별 수입·지출 추이 — 그룹 막대
// ------------------------------------------------------------
//  계열이 2개(수입·지출)라 categorical 색을 쓰고 범례를 항상 단다.
//  값은 모든 막대에 찍지 않고 hover/포커스 시에만 보여준다.
//
//  ⚠️ 축은 하나만 쓴다. 수입과 지출은 같은 '원' 단위라 한 축에
//     올려야 크기 비교가 성립한다. 눈금은 "6,000만" 처럼 축약해 단다.
//
//  좌표는 실제 픽셀로 계산한다 (컨테이너 폭을 재서). viewBox 비균등
//  스케일은 글자와 모서리를 늘려 놓았고, 달이 많아지면 막대 폭이
//  음수가 되는 문제가 있었다.
// ============================================================

import { useEffect, useId, useRef, useState } from "react";
import type { MonthPoint } from "@/lib/neander/finance/aggregate";
import { formatSigned } from "@/lib/neander/finance/types";
import { cn } from "@/components/neander/ui";
import { Legend, SERIES, monthLabel } from "./ui";

const H = 220; // 전체 높이
const PAD_T = 12;
const PAD_B = 28; // x 라벨
const PAD_L = 72; // y 라벨 ("1억 5,000만")
const PAD_R = 8;
const BAR_MAX = 26;
const BAR_GAP = 3; // 수입·지출 막대 사이

/** 눈금 상한 — 1·2·2.5·5 배수로 올림 */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const r = v / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return step * mag;
}

/** 축 눈금용 축약 표기 — 60,000,000 → "6,000만", 150,000,000 → "1억 5,000만" */
export function shortWon(n: number): string {
  const a = Math.round(Math.abs(n));
  if (a === 0) return "0";
  const eok = Math.floor(a / 100_000_000);
  const man = Math.round((a % 100_000_000) / 10_000);
  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man > 0) parts.push(`${man.toLocaleString("ko-KR")}만`);
  if (parts.length === 0) return a.toLocaleString("ko-KR");
  return (n < 0 ? "△" : "") + parts.join(" ");
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

export function TrendChart({ points, className }: { points: MonthPoint[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const id = useId();

  if (points.length === 0) return null;

  const max = niceMax(Math.max(...points.map((p) => Math.max(p.income, p.expense)), 1));
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const groupW = points.length ? plotW / points.length : 0;
  const barW = Math.max(2, Math.min(BAR_MAX, (groupW - Math.max(6, groupW * 0.3) - BAR_GAP) / 2));
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => max * t);
  // 달이 많으면 x 라벨을 건너뛴다 (겹치지 않게)
  const labelEvery = groupW >= 36 ? 1 : groupW >= 20 ? 2 : 3;
  const first = points[0].month;
  const last = points[points.length - 1].month;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const xLabel = (m: string) => (sameYear ? `${Number(m.slice(5))}월` : m.slice(2).replace("-", "."));

  const cur = hover !== null ? points[hover] : null;

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-nd-caption text-nd-fg-3">
          {monthLabel(first)} – {monthLabel(last)}
        </span>
        <div className="flex items-center gap-3">
          <Legend
            items={[
              { label: "수입", color: SERIES.income },
              { label: "지출", color: SERIES.expense },
            ]}
          />
          <span className="text-nd-caption text-nd-fg-3">단위: 원</span>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-labelledby={`${id}-title`}
            className="block select-none"
          >
            <title id={`${id}-title`}>
              {monthLabel(first)}부터 {monthLabel(last)}까지 월별 수입·지출 막대 그래프
            </title>
            {/* 눈금선 + 라벨 — 배경으로 물러나 있어야 한다 */}
            {ticks.map((t, i) => (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={width - PAD_R}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={i === 0 ? "rgba(15,23,42,0.18)" : "rgba(15,23,42,0.07)"}
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
            ))}

            {points.map((p, i) => {
              const gx = PAD_L + i * groupW + groupW / 2;
              const active = hover === i;
              const dim = hover !== null && !active;
              const x1 = gx - BAR_GAP / 2 - barW;
              const x2 = gx + BAR_GAP / 2;
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
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    tabIndex={0}
                    aria-label={`${monthLabel(p.month)} 수입 ${formatSigned(p.income)}원, 지출 ${formatSigned(p.expense)}원`}
                    rx={6}
                  />
                  <rect
                    x={x1}
                    y={y(p.income)}
                    width={barW}
                    height={Math.max(0, plotH + PAD_T - y(p.income))}
                    fill={SERIES.income}
                    opacity={dim ? 0.4 : 1}
                    rx={3}
                    pointerEvents="none"
                  />
                  <rect
                    x={x2}
                    y={y(p.expense)}
                    width={barW}
                    height={Math.max(0, plotH + PAD_T - y(p.expense))}
                    fill={SERIES.expense}
                    opacity={dim ? 0.4 : 1}
                    rx={3}
                    pointerEvents="none"
                  />
                  {showLabel && (
                    <text
                      x={gx}
                      y={H - 8}
                      textAnchor="middle"
                      className={cn("nd-num text-[11px]", active ? "fill-nd-fg font-semibold" : "fill-nd-fg-3")}
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

      {/* 값은 hover/포커스 했을 때만 */}
      <div className="mt-1 min-h-[2.25rem]" aria-live="polite">
        {cur && (
          <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 rounded-nd-md bg-nd-sunken px-3 py-1.5 text-nd-caption">
            <span className="font-semibold text-nd-fg">{monthLabel(cur.month)}</span>
            <span className="text-nd-fg-2">
              수입 <span className="nd-num font-medium text-nd-fg">{formatSigned(cur.income)}</span>
            </span>
            <span className="text-nd-fg-2">
              지출 <span className="nd-num font-medium text-nd-fg">{formatSigned(cur.expense)}</span>
            </span>
            <span className="text-nd-fg-2">
              순손익{" "}
              <span className={cn("nd-num font-medium", cur.net < 0 ? "text-nd-danger-text" : "text-nd-fg")}>
                {formatSigned(cur.net)}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
