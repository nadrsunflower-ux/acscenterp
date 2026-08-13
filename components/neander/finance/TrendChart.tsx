"use client";

// ============================================================
//  월별 수입·지출 추이 — 그룹 막대
// ------------------------------------------------------------
//  계열이 2개(수입·지출)라 categorical 색을 쓰고 범례를 항상 단다.
//  값은 모든 막대에 찍지 않고 hover 시에만 보여준다 — 숫자를 전부
//  찍으면 읽을 수 없다.
//
//  ⚠️ 축은 하나만 쓴다. 수입과 지출은 같은 '원' 단위라 한 축에
//     올려야 크기 비교가 성립한다.
// ============================================================

import { useState } from "react";
import type { MonthPoint } from "@/lib/neander/finance/aggregate";
import { formatSigned } from "@/lib/neander/finance/types";
import { Legend, SERIES } from "./ui";

const H = 190; // 플롯 높이
const PAD_L = 8;
const PAD_B = 26;
const BAR_GAP = 2; // 인접 막대 사이 표면 간격

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

/** 축 눈금용 축약 표기 — 1,234,567 → 123만 */
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 100_000_000) return `${Math.round(n / 100_000_000)}억`;
  if (a >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return String(Math.round(n));
}

export function TrendChart({ points }: { points: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) return null;

  const max = niceMax(Math.max(...points.map((p) => Math.max(p.income, p.expense)), 1));
  const groupW = 100 / points.length;
  const barW = (groupW - 4) / 2;

  const y = (v: number) => H - (v / max) * H;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Legend
          items={[
            { label: "수입", color: SERIES.income },
            { label: "지출", color: SERIES.expense },
          ]}
        />
        <span className="text-xs text-zinc-400">단위: 원</span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 100 ${H + PAD_B}`}
          preserveAspectRatio="none"
          className="h-[220px] w-full"
          role="img"
          aria-label="월별 수입·지출 추이"
        >
          {/* 눈금선 — 배경으로 물러나 있어야 한다 */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={0}
              x2={100}
              y1={y(max * t)}
              y2={y(max * t)}
              stroke="#e4e4e7"
              strokeWidth={t === 0 ? 0.6 : 0.3}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {points.map((p, i) => {
            const gx = i * groupW + 2;
            const active = hover === i;
            return (
              <g key={p.month}>
                {/* 히트 영역 — 막대보다 크게 잡아 hover 가 쉽도록 */}
                <rect
                  x={i * groupW}
                  y={0}
                  width={groupW}
                  height={H + PAD_B}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                <rect
                  x={gx}
                  y={y(p.income)}
                  width={barW - BAR_GAP / 2}
                  height={Math.max(0, H - y(p.income))}
                  fill={SERIES.income}
                  opacity={hover === null || active ? 1 : 0.45}
                  rx={0.8}
                  pointerEvents="none"
                />
                <rect
                  x={gx + barW + BAR_GAP / 2}
                  y={y(p.expense)}
                  width={barW - BAR_GAP / 2}
                  height={Math.max(0, H - y(p.expense))}
                  fill={SERIES.expense}
                  opacity={hover === null || active ? 1 : 0.45}
                  rx={0.8}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </svg>

        {/* 축 라벨은 SVG 밖에서 — viewBox 비균등 스케일에 글자가 늘어나지 않도록 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex">
          {points.map((p, i) => (
            <span
              key={p.month}
              className={
                hover === i
                  ? "flex-1 text-center text-[11px] font-semibold text-zinc-700"
                  : "flex-1 text-center text-[11px] text-zinc-400"
              }
            >
              {p.month.slice(2).replace("-", ".")}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute left-0 top-0 text-[10px] text-zinc-400">
          {short(max)}
        </div>
      </div>

      {/* 값은 hover 했을 때만 */}
      <div className="mt-2 h-9">
        {hover !== null && (
          <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs shadow-sm">
            <span className="font-semibold text-zinc-800">
              {points[hover].month.replace("-", "년 ")}월
            </span>
            <span className="text-zinc-600">
              수입 <span className="tabular-nums font-medium text-zinc-900">
                {formatSigned(points[hover].income)}
              </span>
            </span>
            <span className="text-zinc-600">
              지출 <span className="tabular-nums font-medium text-zinc-900">
                {formatSigned(points[hover].expense)}
              </span>
            </span>
            <span className="text-zinc-600">
              순손익{" "}
              <span
                className={
                  points[hover].net < 0
                    ? "tabular-nums font-medium text-rose-600"
                    : "tabular-nums font-medium text-zinc-900"
                }
              >
                {formatSigned(points[hover].net)}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
