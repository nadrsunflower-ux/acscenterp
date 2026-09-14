"use client";

// ============================================================
//  오버레이 공통 훅 — Esc · 포커스 가두기 · 스크롤 잠금 · 바깥 클릭 · 위치
// ------------------------------------------------------------
//  Dialog/Popover/Menu/Sheet 가 같은 규칙으로 동작하게 여기서만 구현한다.
// ============================================================
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

/** 열려 있는 동안 본문 스크롤을 막는다 (중첩 대비: 열린 수를 센다) */
let lockCount = 0;
export function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = prev;
    };
  }, [active]);
}

/**
 * 포커스를 컨테이너 안에 가둔다. 열릴 때 initialFocus(없으면 첫 포커스
 * 가능한 요소)로 옮기고, 닫히면 열기 전 요소로 되돌린다.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement>,
) {
  const restoreRef = useRef<HTMLElement | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) {
      // 포탈 자식이 아직 안 붙은 경우 — 한 프레임 뒤 다시
      const id = requestAnimationFrame(() => setRetry((n) => n + 1));
      return () => cancelAnimationFrame(id);
    }
    restoreRef.current = document.activeElement as HTMLElement | null;

    const target =
      initialFocus?.current ?? (root.querySelector<HTMLElement>("[data-autofocus]") || root.querySelector<HTMLElement>(FOCUSABLE));
    // 렌더 직후 포커스 — 애니메이션과 겹쳐도 안전하게 한 프레임 뒤
    const raf = requestAnimationFrame(() => (target ?? root).focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("keydown", onKey);
      const back = restoreRef.current;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [ref, active, initialFocus, retry]);
}

/** refs 바깥을 누르면 onOutside — 팝오버·메뉴 닫기 */
export function useOutsideClick(
  refs: RefObject<HTMLElement | null>[],
  active: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current && r.current.contains(t))) return;
      onOutside();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [refs, active, onOutside]);
}

export type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "bottom" | "top";

/**
 * anchor 아래/위에 팝오버를 놓을 좌표. 화면 밖으로 나가면 안쪽으로
 * 밀고, 아래 공간이 모자라면 위로 뒤집는다. (ColumnMenu 의 방식을 공통화)
 *
 * `ready` 가 false 인 동안 부르는 쪽은 판을 **그리지 않아야 한다.**
 * 판의 크기는 내용이 앉으면서 바뀌고(포탈은 한 프레임 뒤에 붙는다), 위쪽
 * 배치는 그 높이를 빼서 좌표를 잡기 때문에, 첫 프레임 크기로 계산한 자리에
 * 한 번 그려 버리면 판이 왼쪽 위로 튀었다가 제자리로 돌아온다. 그래서 같은
 * 값이 두 번 연달아 나올 때까지 재고 나서야 ready 를 켠다.
 */
export function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  { placement = "bottom-start", offset = 6, matchWidth = false }: { placement?: Placement; offset?: number; matchWidth?: boolean } = {},
) {
  const [style, setStyle] = useState<{
    top: number;
    left: number;
    minWidth?: number;
    maxHeight?: number;
    /** 자리가 굳었는가 — 그려도 되는가 */
    ready: boolean;
  }>({ top: -9999, left: -9999, ready: false });

  useLayoutEffect(() => {
    if (!open) {
      setStyle((s) => (s.ready || s.top !== -9999 ? { top: -9999, left: -9999, ready: false } : s));
      return;
    }
    let raf = 0;
    let ro: ResizeObserver | null = null;

    /** 좌표를 다시 잡는다. 판이 아직 없으면 null — 부른 쪽이 다음 프레임에 다시 부른다 */
    const measure = (reveal: boolean): string | null => {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!a || !p) return null;
      const pw = p.offsetWidth;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;

      // 판의 **자연 높이** 를 잰다 — maxHeight 를 잠깐 풀고 잰 값이다.
      // 눌린 높이(offsetHeight)로 위쪽 좌표를 잡으면 되먹임이 생긴다:
      // top 은 높이에서 나오고 maxHeight 는 top 에서 나오는데, 그 maxHeight 가
      // 다시 높이를 누른다. 실제로 판이 한 프레임에 60px 씩 열 번 기어올랐다.
      const prevMax = p.style.maxHeight;
      p.style.maxHeight = "none";
      const natural = p.offsetHeight;
      p.style.maxHeight = prevMax;

      const spaceAbove = a.top - offset - margin;
      const spaceBelow = vh - a.bottom - offset - margin;
      // 부른 쪽을 먼저 쓰고, 거기 안 들어가는데 반대쪽이 더 넓으면 뒤집는다
      let up = placement.startsWith("top");
      if (up && natural > spaceAbove && spaceBelow > spaceAbove) up = false;
      else if (!up && natural > spaceBelow && spaceAbove > spaceBelow) up = true;

      const maxHeight = Math.max(120, up ? spaceAbove : spaceBelow);
      const ph = Math.min(natural, maxHeight);
      let top = up ? a.top - offset - ph : a.bottom + offset;
      top = Math.max(margin, top);

      let left: number;
      if (placement.endsWith("end")) left = a.right - pw;
      else if (placement === "bottom" || placement === "top") left = a.left + a.width / 2 - pw / 2;
      else left = a.left;
      left = Math.min(Math.max(margin, left), Math.max(margin, vw - pw - margin));

      const minWidth = matchWidth ? a.width : undefined;
      setStyle((prev) => {
        const ready = prev.ready || reveal;
        if (prev.top === top && prev.left === left && prev.minWidth === minWidth && prev.maxHeight === maxHeight && prev.ready === ready) {
          return prev;
        }
        return { top, left, minWidth, maxHeight, ready };
      });

      // 판 크기가 나중에 바뀌어도(내용이 앉으면) 따라가게. 자리만 고쳐 잡고
      // 「보여도 되는가」 는 건드리지 않는다 — 그 판단은 settle 만 한다.
      // 여기서 reveal 하면 크기가 아직 자라는 중인 자리에서 판이 드러난다.
      if (!ro && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => measure(false));
        ro.observe(p);
      }
      return `${top},${left},${pw},${ph}`;
    };

    // 같은 값이 두 번 연달아 나오면 자리가 굳은 것으로 본다.
    // 안 굳어도 열 프레임이면 포기하고 보여 준다 — 안 보이는 판이 더 나쁘다.
    let last = "";
    let tries = 0;
    const settle = () => {
      const key = measure(false);
      if (key !== null && (key === last || ++tries > 10)) {
        setStyle((s) => (s.ready ? s : { ...s, ready: true }));
        return;
      }
      if (key !== null) last = key;
      raf = requestAnimationFrame(settle);
    };
    settle();

    // ready 는 한 번 켜지면 꺼지지 않는다 — 여기서도 자리만 고쳐 잡는다
    const reposition = () => measure(false);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, anchorRef, panelRef, placement, offset, matchWidth]);

  return style;
}

/**
 * 닫힘 애니메이션을 위한 「조금 더 그려 두기」.
 *
 * open 이 false 가 돼도 exitMs 동안은 mounted 를 true 로 두고 closing 을
 * 켠다 — 부르는 쪽은 그동안 퇴장 애니메이션(animate-out)을 입혀 그리다가
 * mounted 가 꺼지면 치운다. 그 사이 다시 열리면 그대로 이어서 연다.
 *
 * 움직임 줄이기가 켜져 있으면 기다리지 않는다 — 애니메이션이 없는데
 * 판이 잠깐 남아 있으면 오히려 굼떠 보인다.
 */
export function usePresence(open: boolean, exitMs = 140) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setMounted(false), reduce ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/** 첫 마운트 이후에만 true — SSR 과 다른 값을 그리는 컴포넌트용 */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** 미디어쿼리 — 반응형 분기(드로어 ↔ 사이드바) */
export function useMediaQuery(query: string, initial = false) {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
