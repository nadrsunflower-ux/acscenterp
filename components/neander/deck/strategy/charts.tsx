"use client";

// ============================================================
//  차트 공용 — 폭을 재서 그 폭으로 다시 그리는 SVG 상자
// ------------------------------------------------------------
//  SVG 를 viewBox 로 늘리거나 줄이면 글씨도 같이 줄어든다(최소 18px 가 깨진다).
//  그래서 칸의 실제 폭을 재고, 그 폭을 좌표계로 삼아 다시 그린다. 글씨 크기는
//  언제나 설계 px 그대로다. 휴대폰(세로 흘림)에서는 최소 폭(minW)보다 좁으면
//  가로로 밀어 본다 (.sd-scroll-x).
//
//  인쇄본은 화면 밖에서 한 번에 그려져 폭을 재기 전에 찍힐 수 있다 — 그때는
//  부르는 쪽이 준 기본 폭(fallback)으로 그린다.
// ============================================================

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** 이 요소의 레이아웃 폭 (CSS 변환 전) */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: w > 0 ? w : fallback };
}

/**
 * 폭을 재는 SVG — children(width) 가 그 폭의 좌표로 그린다.
 * 높이는 고정(h). minW 보다 좁으면 minW 로 그리고 가로 스크롤.
 */
export function SvgBox({
  h,
  minW = 480,
  fallback = 700,
  label,
  children,
}: {
  h: number;
  minW?: number;
  fallback?: number;
  label: string;
  children: (w: number) => ReactNode;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(fallback);
  const w = Math.max(minW, Math.floor(width));
  return (
    <div className="sd-scroll-x" ref={ref} data-box>
      <svg className="sd-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        {children(w)}
      </svg>
    </div>
  );
}

/** 막대 끝만 둥근 가로 막대 경로 (왼쪽이 기준선) */
export function hbarPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

/** 위만 둥근 세로 막대 경로 (아래가 기준선) */
export function vbarPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** 보기 좋은 눈금 — 0 부터 max 를 덮는 1·2·5 간격 */
export function niceTicks(max: number, count = 5): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** 차트 글씨 크기 (설계 px) — 18 이 최소 */
export const T = { axis: 18, label: 20, value: 22, big: 30 } as const;
