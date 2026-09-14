"use client";

// ============================================================
//  BasisLine · InfoPopover — "이 숫자는 어떤 기준으로 계산됐나"
// ------------------------------------------------------------
//  대시보드 제목 아래 한 줄로 집계 기준을 밝히고, 긴 설명은 ⓘ 도움말
//  판(팝오버)으로 넘긴다. 판단에 필요한 **상태**(미확정 건수 같은 것)는
//  여기에 숨기지 않는다 — 기준은 도움말, 상태는 화면에.
//
//  판은 role="dialog" 유리 팝오버다. 열리면 안으로 포커스가 들어가고,
//  Esc·바깥 클릭으로 닫히며, 닫히면 부른 버튼으로 포커스가 돌아온다
//  (Popover 가 보장한다). 화면 가장자리에서는 안쪽으로 밀리고, 아래
//  공간이 없으면 위로 뒤집힌다.
// ============================================================
import { useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";
import { Popover } from "./popover";

/**
 * 기준 항목을 " · " 로 이어 한 줄에. 항목 사이 구분은 글자(·)라 색만으로
 * 나뉘지 않는다. 오른쪽 끝에는 도움말·링크 같은 부가 요소를 둔다.
 */
export function BasisLine({
  items,
  children,
  className,
}: {
  /** 기준 문구들 — 순서대로 " · " 로 이어진다 */
  items: ReactNode[];
  /** 줄 끝 부가 요소 (InfoPopover · 링크) */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-nd-caption text-nd-fg-2", className)}>
      <span className="flex flex-wrap items-center gap-x-1.5">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-x-1.5">
            {i > 0 && (
              <span aria-hidden className="text-nd-fg-4">
                ·
              </span>
            )}
            <span>{it}</span>
          </span>
        ))}
      </span>
      {children && <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{children}</span>}
    </div>
  );
}

/** 도움말 판의 한 항목 — 용어와 정의 */
export interface InfoTerm {
  term: ReactNode;
  desc: ReactNode;
}

/**
 * ⓘ 도움말 캡슐. 누르면 정의 목록이 담긴 판이 열린다.
 * terms 를 주면 <dl> 로, children 을 주면 그대로 그린다.
 */
export function InfoPopover({
  label,
  title,
  terms,
  children,
  footer,
  className,
}: {
  /** 캡슐 글자 (예: 집계 기준) */
  label: string;
  /** 판 제목 — 없으면 label */
  title?: ReactNode;
  terms?: InfoTerm[];
  children?: ReactNode;
  /** 판 아래 작은 주석·링크 */
  footer?: ReactNode;
  className?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border border-nd-border bg-nd-content px-2 text-nd-caption font-medium text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-sunken hover:text-nd-fg",
          className,
        )}
      >
        <Icon icon={Info} size={13} />
        {label}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        placement="bottom-start"
        role="dialog"
        ariaLabel={typeof title === "string" ? title : label}
        className="w-[22rem] max-w-[calc(100vw-1rem)] p-0"
        unpadded
      >
        <div id={id} className="p-4">
          <p className="text-nd-body font-semibold text-nd-fg">{title ?? label}</p>
          {terms && (
            <dl className="mt-3 flex flex-col gap-2.5">
              {terms.map((t, i) => (
                <div key={i} className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3 text-nd-caption">
                  <dt className="font-medium text-nd-fg">{t.term}</dt>
                  <dd className="leading-relaxed text-nd-fg-2">{t.desc}</dd>
                </div>
              ))}
            </dl>
          )}
          {children && <div className="mt-3 text-nd-caption leading-relaxed text-nd-fg-2">{children}</div>}
          {footer && <div className="mt-3 border-t border-nd-line pt-2.5 text-nd-micro text-nd-fg-3">{footer}</div>}
        </div>
      </Popover>
    </>
  );
}
