"use client";

// ============================================================
//  Disclosure — 화면 아래에 접어 두는 보조 영역
// ------------------------------------------------------------
//  목업 19장에서 가장 자주 나온 패턴이다. "계산식 안내", "보기 설정",
//  "배분 기준", "적재 이력", "첨부 파일", "고급 설정" 처럼 **자주 쓰지는
//  않지만 없으면 안 되는 것**을 화면 위쪽에서 걷어내 여기에 둔다.
//
//  숨기는 것과 없애는 것은 다르다 — 접힌 상태에서도 제목과 한 줄 설명이
//  남아 무엇이 들어 있는지 보이고, 키보드로 펼칠 수 있다. 경고·미저장
//  상태·단위처럼 판단에 필요한 것은 절대 여기 넣지 않는다.
//
//  내용은 펼칠 때 처음 그린다(기본값). 무거운 표를 접힌 채로 계산하지
//  않기 위해서다. 접었다 펴도 상태가 남아야 하면 `keepMounted` 를 켠다.
// ============================================================
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";
import { useExpandMotion } from "./motion";

export function Disclosure({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  /** 오른쪽 끝에 항상 보이는 요소 (건수·합계처럼 접힌 채로도 알아야 하는 값) */
  meta,
  keepMounted = false,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  meta?: ReactNode;
  keepMounted?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    setUncontrolled(v);
    onOpenChange?.(v);
  };
  const id = useId();
  // 접을 때도 높이를 줄이며 닫는다 — 그동안은 내용을 그려 두고, 다 접히면
  // hidden 을 켜고 내용을 치운다(접힌 상태의 약속은 예전과 같다). 처음 그릴
  // 때는 움직이지 않는다 — 기본으로 펼친 블록이 열 때마다 펼쳐질 이유가 없다.
  const { mounted, motion } = useExpandMotion(open);
  return (
    <section className={cn("nd-surface overflow-hidden rounded-nd-lg", className)}>
      <h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-nd-fast hover:bg-nd-sunken"
        >
          {icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-nd-md bg-nd-sunken text-nd-fg-2">
              <Icon icon={icon} size={17} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-nd-section text-nd-fg">{title}</span>
            {description && <span className="text-nd-caption text-nd-fg-3">{description}</span>}
          </span>
          {meta && <span className="shrink-0 text-nd-caption text-nd-fg-2">{meta}</span>}
          <Icon
            icon={ChevronDown}
            size={17}
            className={cn("shrink-0 text-nd-fg-3 transition-transform duration-nd", open && "rotate-180")}
          />
        </button>
      </h3>
      {/* 껍데기에는 display 유틸을 두지 않는다 — hidden 을 이긴다 (grid 는 CSS 가 :not([hidden]) 에서만 켠다) */}
      <div id={id} hidden={!mounted} className={cn("nd-expand-body", motion)}>
        <div className="nd-expand-clip">
          <div className={cn("border-t border-nd-line px-5 py-4", bodyClassName)}>
            {(mounted || keepMounted) && children}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 여러 Disclosure 를 세로로 이어 붙일 때 — 사이 간격을 한 곳에서 정한다 */
export function DisclosureGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2", className)}>{children}</div>;
}
