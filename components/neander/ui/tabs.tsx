"use client";

// ============================================================
//  Tabs (탐색) · SegmentedControl (보기 전환)
// ------------------------------------------------------------
//  Tabs 는 "다른 화면으로 간다" — 링크(aria-current)이거나 화면 단위
//  전환. SegmentedControl 은 "같은 데이터를 다르게 본다" — 필터·기준·
//  주/월. HIG: 탭은 탐색용이지 동작용이 아니다.
// ============================================================
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";
import { CountBadge } from "./badge";

export interface TabItem {
  key: string;
  label: ReactNode;
  href?: string;
  icon?: LucideIcon;
  hint?: string;
  badge?: number;
  /** 스크린리더용 배지 설명 */
  badgeLabel?: string;
  disabled?: boolean;
}

export function Tabs({
  items,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
  fill = false,
}: {
  items: TabItem[];
  value: string;
  onChange?: (key: string) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  /** 가로로 꽉 채운다 (모바일 상단) */
  fill?: boolean;
}) {
  const isNav = items.some((t) => t.href);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (isNav || !onChange) return;
    const enabled = items.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.key === value);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      const next = enabled[(i + d + enabled.length) % enabled.length];
      onChange(next.key);
      (e.currentTarget.querySelector(`[data-key="${next.key}"]`) as HTMLElement | null)?.focus();
    }
  };

  const itemCls = (active: boolean, disabled?: boolean) =>
    cn(
      "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium outline-none transition-colors duration-nd-fast",
      size === "sm" ? "h-9 px-2.5 text-[13px]" : "h-11 px-3 text-nd-body",
      fill && "flex-1 justify-center",
      active ? "text-nd-fg" : "text-nd-fg-2 hover:text-nd-fg",
      disabled && "pointer-events-none opacity-40",
      // 활성 표시선 — 텍스트 폭에 맞춘 얇은 선
      "after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-nd-accent after:transition-opacity after:duration-nd-fast",
      active ? "after:opacity-100" : "after:opacity-0",
    );

  const Wrapper = isNav ? "nav" : "div";
  return (
    <Wrapper
      role={isNav ? undefined : "tablist"}
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={cn("nd-scroll flex items-stretch gap-0.5 overflow-x-auto border-b border-nd-line", className)}
    >
      {items.map((t) => {
        const active = t.key === value;
        const inner = (
          <>
            {t.icon && <Icon icon={t.icon} size={15} className={active ? "text-nd-accent" : "text-nd-fg-3"} />}
            {t.label}
            {t.hint && <span className="text-nd-caption font-normal text-nd-fg-3">{t.hint}</span>}
            {t.badge !== undefined && t.badge > 0 && (
              <CountBadge count={t.badge} tone={active ? "accent" : "neutral"} label={t.badgeLabel} />
            )}
          </>
        );
        if (t.href) {
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              aria-disabled={t.disabled || undefined}
              className={itemCls(active, t.disabled)}
            >
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-key={t.key}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange?.(t.key)}
            className={itemCls(active, t.disabled)}
          >
            {inner}
          </button>
        );
      })}
    </Wrapper>
  );
}

// ---- SegmentedControl ------------------------------------------
export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: LucideIcon;
  hint?: string;
  disabled?: boolean;
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
  glass = false,
  fill = false,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  /** 툴바(유리) 위에 놓일 때 */
  glass?: boolean;
  fill?: boolean;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      const next = enabled[(i + d + enabled.length) % enabled.length];
      onChange(next.value);
      (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
    }
  };

  // ---- 미끄러지는 선택 표시 ----
  // 흰 알약이 고른 칸으로 옮겨 간다. 칸마다 배경을 켜고 끄면 알약이 순간
  // 이동해서, 무엇이 무엇으로 바뀌었는지 눈이 좇지 못한다.
  // 자리를 재기 전(서버 렌더·첫 프레임)에는 예전처럼 버튼이 직접 배경을 칠한다.
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [glide, setGlide] = useState(false);
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const measure = () => {
      const el = g.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
      setThumb((prev) => {
        const next = el ? { x: el.offsetLeft, w: el.offsetWidth } : null;
        return prev && next && prev.x === next.x && prev.w === next.w ? prev : next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(g);
    return () => ro.disconnect();
  }, [value, options.length]);
  // 첫 자리에는 미끄러지지 않고 바로 앉는다 — 다음 프레임부터 전환을 켠다
  useEffect(() => {
    if (!thumb || glide) return;
    const r = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(r);
  }, [thumb, glide]);

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={cn(
        "relative inline-flex items-center rounded-full p-0.5",
        glass ? "nd-glass" : "bg-nd-fg/[.07]",
        fill && "flex w-full",
        className,
      )}
    >
      {thumb && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0.5 left-0 rounded-full bg-nd-content shadow-nd-card",
            glide && "transition-[transform,width] duration-nd ease-nd",
          )}
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium outline-none transition-colors duration-nd-fast ease-nd disabled:opacity-40",
              size === "sm" ? "h-6 px-2.5 text-[12px]" : "h-7 px-3 text-[13px]",
              fill && "flex-1",
              active
                ? cn("text-nd-fg", !thumb && "bg-nd-content shadow-nd-card")
                : "text-nd-fg-2 hover:text-nd-fg",
            )}
          >
            {o.icon && <Icon icon={o.icon} size={14} />}
            {o.label}
            {o.hint && <span className={cn("font-normal", active ? "text-nd-fg-3" : "text-nd-fg-3/80")}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
