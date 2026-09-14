"use client";

// ============================================================
//  움직임 부품 — 떠나기 · 펼치기 · 보기 바꾸기
// ------------------------------------------------------------
//  화면에서 무엇이 **사라지거나 바뀌는 순간**을 눈이 따라갈 수 있게 한다.
//  꾸밈이 아니라 「방금 무슨 일이 있었나」를 전하는 장치다. 순간 사라지면
//  아래 줄이 한 번에 튀어 올라와, 어느 줄이 처리됐는지 놓친다.
//
//  · LeavingItem + useLeaving — 처리된 줄이 떠나는 모습
//      done     가운데에 결과(「확정했습니다」)가 떠오르고 내용은 흐려진다
//      fade     전체가 흐려진다
//      collapse 높이와 아래 틈을 접는다 → 아래 줄이 자연스럽게 올라온다
//    **다 접힌 뒤에** 목록을 새로 읽는다(after). 먼저 읽으면 줄이 빠지는
//    순간 화면이 튄다. 여러 줄을 한 번에 처리하면(일괄 확정) 가운데 표시 없이
//    흐려지고 접히기만 한다 — 줄마다 글자가 뜨면 오히려 읽을 수 없다.
//    처음 매출 검토 대기함에 만들었던 것을 재무에도 쓰려고 여기로 옮겼다.
//
//  · Collapse — 높이를 몰라도 부드럽게 펼치고 접는다 (Disclosure 와 같은 CSS)
//  · FadeSwap — 달·매장·탭이 바뀌면 아래 내용이 살짝 떠오르며 바뀐다
//
//  CSS 는 app/neander/neander.css 의 nd-leave · nd-expand · nd-swap.
//  움직임 줄이기가 켜져 있으면 CSS 가 전환을 끄고, 여기서도 기다리지 않는다.
// ============================================================
import {
  createElement,
  forwardRef,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { CircleCheck, Trash2 } from "lucide-react";
import { cn } from "./cn";
import { usePresence } from "./hooks";

// ---- 떠나기 ----------------------------------------------------

export type LeavePhase = "done" | "fade" | "collapse";
export interface LeaveState {
  phase: LeavePhase;
  /** 가운데에 띄울 결과 — 없으면 흐려지고 접히기만 한다 */
  message?: string;
  tone: "success" | "neutral";
}

/** 떠나는 시간표 (ms) — neander.css 의 nd-leave 전환 시간과 맞춘다 */
export const LEAVE_MS = { hold: 750, fade: 250, collapse: 300 };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * `const leaving = useLeaving();`
 * `await leaving.run([id], { message: "확정했습니다" }, refresh);`
 * 목록에서는 `<LeavingItem state={leaving.state[id]}>` 로 감싼다.
 */
export function useLeaving() {
  const [state, setState] = useState<Record<string, LeaveState>>({});

  const run = useCallback(
    async (
      keys: string[],
      { message, tone = "success" }: { message?: string; tone?: LeaveState["tone"] } = {},
      /** 다 접힌 뒤 — 보통 목록 다시 불러오기 */
      after?: () => Promise<unknown> | void,
    ) => {
      if (keys.length === 0) {
        await after?.();
        return;
      }
      const reduce = reducedMotion();
      const set = (phase: LeavePhase) =>
        setState((m) => {
          const next = { ...m };
          keys.forEach((k) => (next[k] = { phase, message, tone }));
          return next;
        });
      // 결과 글자는 한 줄을 처리할 때만 — 여러 줄에 똑같은 글자가 뜨면 소음이다
      if (message && keys.length === 1) {
        set("done");
        await wait(reduce ? 400 : LEAVE_MS.hold);
      }
      set("fade");
      await wait(reduce ? 0 : LEAVE_MS.fade);
      set("collapse");
      await wait(reduce ? 0 : LEAVE_MS.collapse);
      try {
        await after?.();
      } finally {
        // 새로 읽은 뒤에도 남아 있는 줄(일부만 처리됐거나 실패)은 다시 보이게
        setState((m) => {
          const next = { ...m };
          keys.forEach((k) => delete next[k]);
          return next;
        });
      }
    },
    [],
  );

  return { state, run };
}

type LeavingItemProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  state?: LeaveState;
  children: ReactNode;
  /** 바깥 요소 — 목록이면 "li" */
  as?: "div" | "li";
  /**
   * 목록의 줄 사이 틈 (gap-3 = "0.75rem", space-y-2 = "0.5rem", divide-y = "0").
   * 접을 때 이만큼을 함께 접어야 다 올라온 뒤 목록을 새로 읽어도 튀지 않는다.
   */
  gap?: string;
  /** 줄 안쪽 여백은 여기에 — 바깥에 두면 접혀도 여백만큼 남는다 */
  bodyClassName?: string;
};

/** 줄 하나를 감싸 떠나는 동안의 모습을 입힌다. 줄 자체의 모양은 건드리지 않는다 */
export const LeavingItem = forwardRef<HTMLElement, LeavingItemProps>(function LeavingItem(
  { state, children, as = "div", gap = "0.75rem", className, bodyClassName, style, ...rest },
  ref,
) {
  const mark =
    state?.message && state.phase === "done" ? (
      <div className="nd-leave-mark" role="status" aria-live="polite">
        <span
          className={cn(
            "nd-surface inline-flex items-center gap-2 rounded-full px-4 py-2 text-nd-body font-semibold shadow-lg",
            state.tone === "success" ? "text-nd-success-text" : "text-nd-fg",
          )}
        >
          {state.tone === "success" ? <CircleCheck size={18} /> : <Trash2 size={18} />}
          {state.message}
        </span>
      </div>
    ) : null;

  return createElement(
    as,
    {
      ...rest,
      ref,
      className: cn("nd-leave", className),
      "data-phase": state?.phase,
      "aria-hidden": state?.phase === "collapse" || undefined,
      style: { ...style, "--nd-leave-gap": gap } as CSSProperties,
    },
    <div className="nd-leave-inner">
      <div className={cn("nd-leave-body", bodyClassName)}>{children}</div>
      {mark}
    </div>,
  );
});

// ---- 펼치기 ----------------------------------------------------

/** 펼침·접힘 높이 전환 (ms) — neander.css 의 nd-expand/nd-collapse 와 맞춘다 */
export const EXPAND_MS = 220;

/**
 * 처음 그릴 때는 움직이지 않고, **사람이 연 뒤부터** 움직인다.
 * 기본으로 펼쳐 둔 블록이 페이지를 열 때마다 펼쳐지는 모습을 보일 이유가 없다.
 */
export function useExpandMotion(open: boolean) {
  const { mounted, closing } = usePresence(open, EXPAND_MS);
  const initial = useRef(open);
  const touched = useRef(false);
  if (open !== initial.current) touched.current = true;
  const motion = !touched.current ? undefined : closing ? "nd-collapse" : "nd-expand";
  return { mounted, closing, motion };
}

/** `{open && ...}` 대신 — 높이를 몰라도 부드럽게 펼치고 접는다 */
export function Collapse({
  open,
  children,
  className,
  id,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const { mounted, motion } = useExpandMotion(open);
  return (
    <div id={id} hidden={!mounted} className={cn("nd-expand-body", motion)}>
      <div className="nd-expand-clip">
        <div className={className}>{mounted && children}</div>
      </div>
    </div>
  );
}

// ---- 보기 바꾸기 ------------------------------------------------

/**
 * swapKey(달·매장·탭)가 바뀔 때마다 안의 내용이 살짝 떠오르며 새로 그려진다.
 * 같은 자리의 숫자가 통째로 바뀌었다는 걸 알린다. key 로 다시 그리므로 안쪽
 * 입력 상태는 그때 초기화된다 — 편집 중인 폼에는 쓰지 않는다.
 */
export function FadeSwap({
  swapKey,
  children,
  className,
}: {
  swapKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div key={swapKey} className={cn("nd-swap", className)}>
      {children}
    </div>
  );
}
