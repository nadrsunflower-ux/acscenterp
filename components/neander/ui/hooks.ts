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
 */
export function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  { placement = "bottom-start", offset = 6, matchWidth = false }: { placement?: Placement; offset?: number; matchWidth?: boolean } = {},
) {
  const [style, setStyle] = useState<{ top: number; left: number; minWidth?: number; maxHeight?: number }>({
    top: -9999,
    left: -9999,
  });

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!a || !p) {
        // 패널이 아직 안 붙었으면 다음 프레임에 한 번 더
        raf = requestAnimationFrame(compute);
        return;
      }
      const pw = p.offsetWidth;
      const ph = p.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;

      let top = placement.startsWith("top") ? a.top - ph - offset : a.bottom + offset;
      // 아래로 넘치면 위로, 위로 넘치면 아래로
      if (placement.startsWith("bottom") && top + ph > vh - margin && a.top - ph - offset >= margin) {
        top = a.top - ph - offset;
      } else if (placement.startsWith("top") && top < margin && a.bottom + offset + ph <= vh - margin) {
        top = a.bottom + offset;
      }
      const maxHeight = Math.max(120, vh - Math.max(top, margin) - margin);

      let left: number;
      if (placement.endsWith("end")) left = a.right - pw;
      else if (placement === "bottom" || placement === "top") left = a.left + a.width / 2 - pw / 2;
      else left = a.left;
      left = Math.min(Math.max(margin, left), Math.max(margin, vw - pw - margin));
      top = Math.max(margin, top);

      setStyle({ top, left, minWidth: matchWidth ? a.width : undefined, maxHeight });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, panelRef, placement, offset, matchWidth]);

  return style;
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
