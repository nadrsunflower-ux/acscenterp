"use client";

// ============================================================
//  그래프 팝오버 — 막대 위에 커서를 두면 그 자리에 값이 뜬다
// ------------------------------------------------------------
//  그래프 **아래** 줄에 값을 적으면, 막대를 보던 눈이 아래로 내려갔다가
//  다시 올라와야 한다. 달을 여럿 훑을 때마다 그 왕복이 쌓인다. 값을
//  커서 옆에 띄우면 눈이 막대를 떠나지 않는다.
//
//  ⚠️ 커서를 **가리면 안 된다**. 그래서
//     - 포인터 이벤트를 받지 않고 (pointer-events: none),
//     - 커서 위쪽에 띄우되 위가 좁으면 아래로 접고,
//     - 화면 좌우 끝에서는 안으로 밀어 넣는다.
//
//  ⚠️ 자리에 전환(transition)을 걸지 않는다. 커서를 따라다니는 판이
//     뒤늦게 따라오면 손과 어긋나 보인다. 처음 뜰 때만 살짝 밝아진다.
//
//  판은 떠 있는 조작 층이라 유리(nd-glass-strong)를 쓴다 — 팝오버·메뉴와
//  같은 층이다. 데이터 면(표·시트)에는 유리를 쓰지 않는 규칙 그대로다.
// ============================================================

import { useCallback, useLayoutEffect, useState, type FocusEvent, type MouseEvent } from "react";
import { cn } from "./cn";
import { Portal } from "./portal";

/** 커서에서 판까지 띄우는 거리. 손가락으로 짚어도 가리지 않을 만큼. */
const GAP = 16;
/** 화면 가장자리에서 남겨 둘 여백 */
const EDGE = 8;

export interface ChartTooltipRow {
  key: string;
  label: string;
  /** 계열 색 — 있으면 점으로 찍어 막대와 잇는다 */
  color?: string;
  /** 이미 서식을 입힌 값 (천 단위 쉼표·음수 - 까지) */
  value: string;
  /** 음수 — 빨강으로 */
  negative?: boolean;
  /** 합계처럼 굵게, 위에 실선을 긋는다 */
  total?: boolean;
}

/**
 * 막대 그래프의 hover 상태 — 어느 칸인지와 커서가 어디인지.
 *
 * 두 그래프(재무·매출)가 같은 손놀림을 갖도록 여기 한 군데 둔다.
 * `hitProps(i)` 를 히트 영역 rect 에 펼쳐 주면 끝이다.
 */
export function useChartHover() {
  const [at, setAt] = useState<{ i: number; x: number; y: number } | null>(null);
  const clear = useCallback(() => setAt(null), []);

  const hitProps = useCallback(
    (i: number) => ({
      onMouseEnter: (e: MouseEvent<SVGRectElement>) => setAt({ i, x: e.clientX, y: e.clientY }),
      onMouseMove: (e: MouseEvent<SVGRectElement>) => setAt({ i, x: e.clientX, y: e.clientY }),
      // 키보드로 왔을 때는 커서가 없다 — 그 칸의 위쪽 가운데를 가리킨다
      onFocus: (e: FocusEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ i, x: r.left + r.width / 2, y: r.top + 6 });
      },
      onBlur: clear,
      tabIndex: 0,
    }),
    [clear],
  );

  return { index: at?.i ?? null, at: at ? { x: at.x, y: at.y } : null, hitProps, clear };
}

/**
 * 커서 옆에 뜨는 값 판.
 *
 * 판 크기를 재야 자리를 정할 수 있어(가운데 맞춤·접기), 재기 전에는
 * 투명하게 둔다. 0,0 에 한 번 번쩍이는 걸 막는다.
 */
export function ChartTooltip({
  at,
  title,
  rows,
  unit = "원",
  className,
}: {
  /** 화면 좌표 (clientX/clientY). null 이면 그리지 않는다 */
  at: { x: number; y: number } | null;
  title: string;
  rows: ChartTooltipRow[];
  /** 머리글 오른쪽에 붙는 단위. 빈 문자열이면 안 붙는다 */
  unit?: string;
  className?: string;
}) {
  // ⚠️ ref 가 아니라 **상태**로 잡는다. 포탈은 첫 렌더에 아무것도 그리지 않고
  //    다음 렌더에 뿌리를 붙이므로(portal.tsx), ref 만 보면 첫 판은 영영 크기를
  //    못 재고 높이 0 인 채로 자리를 잡는다 — 그러면 판이 커서를 덮는다.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // 내용이 바뀌면 크기도 바뀐다 — 줄 수와 글자가 달라지므로 매번 다시 잰다
  const shape = `${title}|${rows.map((r) => r.label + r.value).join("|")}`;
  useLayoutEffect(() => {
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    setBox((prev) => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
  }, [panel, shape]);

  if (!at) return null;

  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const w = box?.w ?? 0;
  const h = box?.h ?? 0;

  // 커서 위가 좁으면 아래로 접는다. 위아래 어디에도 안 들어가면(작은 화면)
  // 넘치지 않게 끌어당긴다 — 판이 화면 밖으로 나가면 아무 쓸모가 없다.
  const above = at.y - GAP - h >= EDGE || at.y + GAP + h > vh - EDGE;
  const wanted = above ? at.y - GAP - h : at.y + GAP;
  const top = Math.min(Math.max(wanted, EDGE), Math.max(EDGE, vh - h - EDGE));
  const left = Math.min(Math.max(at.x - w / 2, EDGE), Math.max(EDGE, vw - w - EDGE));

  return (
    <Portal>
      <div
        ref={setPanel}
        role="tooltip"
        aria-hidden
        style={{ position: "fixed", top, left }}
        className={cn(
          "nd-glass-strong pointer-events-none z-nd-popover min-w-[9.5rem] max-w-[18rem] rounded-nd-md px-3 py-2",
          box ? "animate-in fade-in duration-nd-fast" : "opacity-0",
          className,
        )}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-nd-caption font-semibold text-nd-fg">{title}</span>
          {unit && <span className="text-nd-micro text-nd-fg-3">단위: {unit}</span>}
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1">
          {rows.map((r) => (
            <div key={r.key} className="contents">
              {/* 칸마다 윗선을 그으면 칸 사이 여백에서 끊겨 점선처럼 보인다.
                  한 줄짜리 칸을 따로 놓아 판 폭을 가로지르게 한다. */}
              {r.total && <span className="col-span-3 mt-0.5 h-px bg-nd-line" aria-hidden />}
              <span
                className={cn("h-2 w-2 rounded-full", !r.color && "opacity-0")}
                style={r.color ? { backgroundColor: r.color } : undefined}
                aria-hidden
              />
              <span className={cn("text-nd-caption", r.total ? "font-medium text-nd-fg" : "text-nd-fg-2")}>
                {r.label}
              </span>
              <span
                className={cn(
                  "nd-num text-nd-caption tabular-nums",
                  r.total ? "font-semibold" : "font-medium",
                  r.negative ? "text-nd-danger-text" : "text-nd-fg",
                )}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Portal>
  );
}
