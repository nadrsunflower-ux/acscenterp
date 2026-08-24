"use client";

// ============================================================
//  원장 시트 — 열 너비 · 행 높이 (브라우저에 남는다)
// ------------------------------------------------------------
//  스프레드시트를 쓰는 사람은 자기 화면에 맞춰 열 폭을 조절하고, 그게
//  다음에 열었을 때도 그대로이길 기대한다. 그래서 localStorage 에 남긴다.
//  서버에 두지 않는 이유는 이게 **그 사람의 그 화면** 설정이기 때문이다.
//  27인치에서 넓힌 폭이 노트북에서 그대로 따라오면 오히려 불편하다.
//
//  ⚠️ 행 높이는 전체 공통이다. react-datasheet-grid 는 행마다 다른 높이를
//     줄 수 있지만(rowHeight 가 함수를 받는다) 그렇게 하지 않았다. 원장은
//     정렬·필터로 행 순서가 계속 바뀌는 표라서, 높이를 거래 id 에 묶으면
//     "그 거래를 따라다니는 높이"가 되고 화면 위치에 묶으면 "정렬하면
//     엉뚱한 행이 두꺼워지는" 표가 된다. 둘 다 사람이 기대하는 동작이
//     아니다. 한 번에 다 바뀌는 쪽이 예측 가능하다.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_ROW_HEIGHT = 34;
export const MIN_COL_WIDTH = 48;
export const MAX_COL_WIDTH = 720;
export const MIN_ROW_HEIGHT = 24;
export const MAX_ROW_HEIGHT = 160;

/**
 * 확대/축소 단계. 자유로운 슬라이더 대신 단계로 둔다 — 표는 87% 같은
 * 어중간한 배율에서 글자가 흐려지고, 사람이 다시 100% 로 돌아오기도 어렵다.
 */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const DEFAULT_ZOOM = 1;

/** 열 구성이 바뀌면 v 를 올린다 — 옛 폭이 엉뚱한 열에 붙지 않게 */
const STORAGE_KEY = "neander.finance.ledger.layout.v1";
/** 드래그 중 60fps 로 쓰지 않는다 */
const WRITE_DELAY = 250;

export interface SheetLayout {
  /** 열 id → px. 없는 열은 기본 폭(유동) */
  widths: Record<string, number>;
  rowHeight: number;
  /** 표 전체 배율. 1 = 100% */
  zoom: number;
}

const EMPTY: SheetLayout = { widths: {}, rowHeight: DEFAULT_ROW_HEIGHT, zoom: DEFAULT_ZOOM };

/** 저장된 값이 단계 목록에 없으면 가장 가까운 단계로 (목록을 바꿔도 안 깨진다) */
const nearestZoom = (v: number) =>
  ZOOM_STEPS.reduce((best, z) => (Math.abs(z - v) < Math.abs(best - v) ? z : best), DEFAULT_ZOOM);

const clamp = (v: number, lo: number, hi: number) =>
  Math.round(Math.min(hi, Math.max(lo, v)));

/**
 * 손잡이가 끌리는 동안 화면에 띄우는 수치도 이 함수를 통과한다.
 * 저장할 때만 자르면 한계에 닿았을 때 "300px" 이라고 떠 있는데 실제로는
 * 720px 로 잘리는, 화면과 장부가 다른 상태가 된다.
 */
export const clampColWidth = (px: number) => clamp(px, MIN_COL_WIDTH, MAX_COL_WIDTH);
export const clampRowHeight = (px: number) => clamp(px, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);

function read(): SheetLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<SheetLayout>;
    const widths: Record<string, number> = {};
    Object.entries(p.widths ?? {}).forEach(([k, v]) => {
      const n = Number(v);
      if (Number.isFinite(n)) widths[k] = clamp(n, MIN_COL_WIDTH, MAX_COL_WIDTH);
    });
    const h = Number(p.rowHeight);
    const z = Number(p.zoom);
    return {
      widths,
      rowHeight: Number.isFinite(h) ? clamp(h, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT) : DEFAULT_ROW_HEIGHT,
      zoom: Number.isFinite(z) && z > 0 ? nearestZoom(z) : DEFAULT_ZOOM,
    };
  } catch {
    // 사생활 보호 모드나 저장 공간 초과 — 설정이 없는 것으로 본다
    return EMPTY;
  }
}

export function useSheetLayout() {
  // 시트는 데이터를 받은 뒤에야 그려지므로(페이지가 loading 을 먼저 띄운다)
  // 첫 렌더에 localStorage 를 읽어도 서버 렌더와 어긋나지 않는다.
  const [layout, setLayout] = useState<SheetLayout>(() =>
    typeof window === "undefined" ? EMPTY : read(),
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      } catch {
        // 저장 못 해도 화면은 그대로 동작한다 — 다음에 열면 기본값일 뿐
      }
    }, WRITE_DELAY);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [layout]);

  const setWidth = useCallback((id: string, px: number) => {
    setLayout((l) => {
      const next = clamp(px, MIN_COL_WIDTH, MAX_COL_WIDTH);
      if (l.widths[id] === next) return l;
      return { ...l, widths: { ...l.widths, [id]: next } };
    });
  }, []);

  /** 한 열만 기본 폭으로 (머리글 경계 더블클릭) */
  const clearWidth = useCallback((id: string) => {
    setLayout((l) => {
      if (l.widths[id] === undefined) return l;
      const widths = { ...l.widths };
      delete widths[id];
      return { ...l, widths };
    });
  }, []);

  const setRowHeight = useCallback((px: number) => {
    setLayout((l) => {
      const next = clamp(px, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
      return l.rowHeight === next ? l : { ...l, rowHeight: next };
    });
  }, []);

  /** 단계 목록에서 한 칸 이동. delta 는 +1 / -1 */
  const stepZoom = useCallback((delta: number) => {
    setLayout((l) => {
      const i = ZOOM_STEPS.indexOf(l.zoom as (typeof ZOOM_STEPS)[number]);
      const from = i >= 0 ? i : ZOOM_STEPS.indexOf(DEFAULT_ZOOM);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + delta))];
      return next === l.zoom ? l : { ...l, zoom: next };
    });
  }, []);

  const setZoom = useCallback((z: number) => {
    setLayout((l) => (l.zoom === z ? l : { ...l, zoom: nearestZoom(z) }));
  }, []);

  const reset = useCallback(() => setLayout(EMPTY), []);

  const customized =
    Object.keys(layout.widths).length > 0 ||
    layout.rowHeight !== DEFAULT_ROW_HEIGHT ||
    layout.zoom !== DEFAULT_ZOOM;

  return { layout, setWidth, clearWidth, setRowHeight, stepZoom, setZoom, reset, customized };
}

/** 페이지와 시트가 같은 설정을 나눠 쓴다 */
export type SheetLayoutHandle = ReturnType<typeof useSheetLayout>;
