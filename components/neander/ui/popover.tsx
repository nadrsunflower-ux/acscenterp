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
import { useAnchorPosition, useEscape, useOutsideClick, type Placement } from "./hooks";

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
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useAnchorPosition(anchorRef, panelRef, open, { placement, matchWidth });
  useEscape(open, onClose);
  useOutsideClick([panelRef, anchorRef], open, onClose);

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
      anchorRef.current?.focus({ preventScroll: true });
    }
  }, [open, autoFocus, anchorRef]);

  if (!open) return null;
  return (
    <Portal>
      <div
        ref={panelRef}
        role={role}
        aria-label={ariaLabel}
        tabIndex={-1}
        style={{ position: "fixed", top: style.top, left: style.left, minWidth: style.minWidth, maxHeight: style.maxHeight }}
        className={cn(
          "nd-glass-strong nd-scroll z-nd-popover overflow-y-auto rounded-nd-md outline-none animate-in fade-in zoom-in-95 duration-nd-fast",
          !unpadded && "p-1",
          className,
        )}
      >
        {children}
      </div>
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
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  delay?: number;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useId();
  const style = useAnchorPosition(anchorRef, panelRef, open, { placement: side, offset: 6 });

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEscape(open, hide);

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
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
            className="pointer-events-none z-nd-popover max-w-[260px] rounded-[8px] bg-nd-inverse px-2.5 py-1.5 text-nd-caption text-white shadow-nd-pop animate-in fade-in duration-nd-fast"
          >
            {label}
          </div>
        </Portal>
      )}
    </>
  );
}
