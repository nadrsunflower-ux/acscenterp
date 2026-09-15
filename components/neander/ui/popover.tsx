"use client";

// ============================================================
//  Popover · Menu · Tooltip
// ------------------------------------------------------------
//  호출한 컨트롤에 붙어서 나타난다(anchor 기준 위치, 화면 밖이면 안으로).
//  표면은 유리(strong) — 탐색·조작 레이어이므로. 메뉴는 화살표 키로
//  옮기고 Esc/바깥 클릭으로 닫힌다. 닫히면 포커스가 호출 컨트롤로 돌아간다.
// ============================================================
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";
import { Portal } from "./portal";
import { useAnchorPosition, useEscape, useOutsideClick, usePresence, type Placement } from "./hooks";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  /** anchor 폭에 맞춘다 (선택 목록) */
  matchWidth?: boolean;
  role?: "dialog" | "menu" | "listbox";
  ariaLabel?: string;
  /** 열릴 때 안으로 포커스를 옮길지 */
  autoFocus?: boolean;
  /** 안쪽 여백 없이 (직접 그릴 때) */
  unpadded?: boolean;
  /**
   * 대화상자 안에서 열리는 팝오버. 기본 층(50)은 창(60) 아래라 창 뒤로
   * 숨는다 — 이 값을 켜면 창 위(65), 토스트 아래로 올라온다.
   */
  overDialog?: boolean;
  /** 부른 칸을 가리키는 꼬리 (말풍선) */
  arrow?: boolean;
  /**
   * 닫힐 때 부른 컨트롤로 포커스를 돌려줄지. 마우스를 올려 연 미리보기는
   * 끄는 게 맞다 — 커서가 지나갔을 뿐인데 포커스가 옮겨 오면 안 된다.
   */
  returnFocus?: boolean;
}

export function Popover({
  open,
  onClose,
  anchorRef,
  placement = "bottom-start",
  children,
  className,
  matchWidth = false,
  role = "dialog",
  ariaLabel,
  autoFocus = true,
  unpadded = false,
  overDialog = false,
  arrow = false,
  returnFocus = true,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 닫힐 때 제자리에서 흐려지며 사라진다. 그동안 자리(style)는 붙잡아 둬야
  // 판이 화면 밖 대기 좌표로 튀지 않으므로, 위치 훅에는 mounted 를 넘긴다.
  const { mounted, closing } = usePresence(open, 130);
  const shownChildren = useRef(children);
  if (open) shownChildren.current = children;
  const style = useAnchorPosition(anchorRef, panelRef, mounted, { placement, matchWidth });
  useOutsideClick([panelRef, anchorRef], open, onClose);

  // Esc 는 이 판만 닫는다. 창 안에서 열렸을 때 창까지 닫히면 방금 연 자리를
  // 다시 찾아야 한다. Dialog 도 document 에 리스너를 걸어 두는데, 같은 노드에
  // 붙은 리스너는 stopPropagation 으로 못 막는다 — 캡처 단계에서 먼저 잡고
  // stopImmediatePropagation 으로 끊는다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // 꼬리 좌표 — 판의 어느 변에 달지, 가로로 어디를 가리킬지.
  //
  // 판의 위치는 getBoundingClientRect 가 아니라 style(위치 훅이 정한 값)과
  // offset 크기로 잰다. 열릴 때 zoom-in 애니메이션이 판에 transform 을 걸어
  // 두는데, rect 는 그 변형을 함께 재기 때문에 자리 잡는 도중의 값을 물어
  // 꼬리가 엉뚱한 데 붙었다.
  //
  // 판 높이는 내용이 앉으면서 바뀐다(계정을 고르면 회계코드 줄이 늘어난다).
  // ResizeObserver 로 따라간다 — 한 번 재고 마는 것으로는 모자란다.
  const [tail, setTail] = useState<{ x: number; y: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open || !arrow) {
      setTail(null);
      return;
    }
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const el = panelRef.current;
      // 아직 대기 좌표에 있으면 (포탈이 한 프레임 뒤에 붙는다) 다음 기회에
      if (!a || !el || style.top < -1000) return;
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      const up = style.top >= a.top; // 판이 칸 아래 → 꼬리는 위를 가리킨다
      // 칸 한가운데를 가리키되 판 모서리를 넘지 않게
      const x = Math.min(Math.max(style.left + 16, a.left + a.width / 2), style.left + pw - 16);
      setTail({ x, y: up ? style.top : style.top + ph, up });
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, arrow, anchorRef, style.top, style.left, style.ready]);

  // 닫힐 때 호출 컨트롤로 포커스 복귀
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      if (autoFocus) {
        const raf = requestAnimationFrame(() => {
          const first = panelRef.current?.querySelector<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
          );
          (first ?? panelRef.current)?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(raf);
      }
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (returnFocus) anchorRef.current?.focus({ preventScroll: true });
    }
  }, [open, autoFocus, anchorRef, returnFocus]);

  if (!mounted) return null;
  const layer = overDialog ? "z-nd-popover-over" : "z-nd-popover";
  return (
    <Portal>
      <div
        ref={panelRef}
        role={role}
        aria-label={ariaLabel}
        tabIndex={-1}
        style={{ position: "fixed", top: style.top, left: style.left, minWidth: style.minWidth, maxHeight: style.maxHeight }}
        className={cn(
          "nd-glass-strong nd-scroll overflow-y-auto rounded-nd-md outline-none",
          layer,
          // 자리가 굳고 나서 그린다. 첫 프레임 크기로 잡은 좌표에 한 번 그려지면
          // 판이 왼쪽 위로 튀었다 돌아온다. display 가 아니라 opacity 로 감추는
          // 것은 그동안에도 크기를 잴 수 있어야 하기 때문이다.
          !style.ready
            ? "pointer-events-none opacity-0"
            : closing
              ? "pointer-events-none animate-out fade-out zoom-out-95 fill-mode-forwards duration-nd-fast"
              : "animate-in fade-in zoom-in-95 duration-nd-fast",
          !unpadded && "p-1",
          className,
        )}
      >
        {shownChildren.current}
      </div>
      {tail && style.ready && !closing && (
        <span
          aria-hidden
          className={cn("nd-pop-tail", tail.up ? "nd-pop-tail-up" : "nd-pop-tail-down", layer)}
          style={{ left: tail.x, top: tail.y }}
        />
      )}
    </Portal>
  );
}

// ---- Menu ------------------------------------------------------
export type MenuItem =
  | {
      type?: "item";
      key: string;
      label: ReactNode;
      icon?: LucideIcon;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** 체크 표시 (선택형 메뉴) */
      checked?: boolean;
      hint?: string;
    }
  | { type: "separator"; key: string }
  | { type: "label"; key: string; label: ReactNode };

export function Menu({
  items,
  onClose,
  className,
  ...popover
}: Omit<PopoverProps, "children" | "role" | "autoFocus"> & { items: MenuItem[] }) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusAt = (dir: 1 | -1 | "first" | "last") => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (els.length === 0) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (dir === "first") next = 0;
    else if (dir === "last") next = els.length - 1;
    else next = i < 0 ? (dir === 1 ? 0 : els.length - 1) : (i + dir + els.length) % els.length;
    els[next].focus();
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt("first");
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt("last");
    } else if (e.key === "Tab") {
      // 메뉴 밖으로 나가면 닫는다
      onClose();
    }
  };

  return (
    <Popover {...popover} onClose={onClose} role="menu" className={cn("min-w-[180px]", className)}>
      <div ref={listRef} onKeyDown={onKey}>
        {items.map((it) => {
          if (it.type === "separator") return <div key={it.key} role="separator" className="my-1 h-px bg-nd-fg/10" />;
          if (it.type === "label")
            return (
              <div key={it.key} className="px-2.5 pb-1 pt-2 text-nd-micro uppercase tracking-wide text-nd-fg-3">
                {it.label}
              </div>
            );
          return (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                it.onSelect();
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-nd-body outline-none transition-colors duration-nd-fast",
                it.danger ? "text-nd-danger-text hover:bg-nd-danger-soft focus-visible:bg-nd-danger-soft" : "text-nd-fg hover:bg-nd-fg/[.06] focus-visible:bg-nd-fg/[.06]",
                it.disabled && "cursor-not-allowed opacity-45",
              )}
            >
              {it.icon && <Icon icon={it.icon} size={15} className={it.danger ? "" : "text-nd-fg-2"} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="text-nd-caption text-nd-fg-3">{it.hint}</span>}
              {it.checked && <Icon icon={Check} size={14} className="text-nd-accent" />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

// ---- Tooltip ---------------------------------------------------
/** 짧은 설명. 마우스를 올리거나 키보드 포커스가 오면 잠깐 뒤 나타난다. */
export function Tooltip({
  label,
  children,
  side = "top",
  delay = 350,
  disabled = false,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  delay?: number;
  /** 감싼 요소는 그대로 두고 설명만 끈다 — 조건마다 감쌌다 풀면 안쪽이 다시 그려진다 */
  disabled?: boolean;
  /** 앵커 span 의 클래스 (기본 inline-flex) */
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useId();
  const style = useAnchorPosition(anchorRef, panelRef, open, { placement: side, offset: 6 });

  const show = () => {
    if (disabled) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEscape(open, hide);
  useEffect(() => {
    if (!disabled) return;
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }, [disabled]);

  return (
    <>
      <span
        ref={anchorRef}
        className={className ?? "inline-flex"}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open && (
        <Portal>
          <div
            ref={panelRef}
            id={id}
            role="tooltip"
            style={{ position: "fixed", top: style.top, left: style.left }}
            className={cn(
              "pointer-events-none z-nd-popover max-w-[260px] rounded-[8px] bg-nd-inverse px-2.5 py-1.5 text-nd-caption text-white shadow-nd-pop",
              style.ready ? "animate-in fade-in duration-nd-fast" : "opacity-0",
            )}
          >
            {label}
          </div>
        </Portal>
      )}
    </>
  );
}
