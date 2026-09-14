"use client";

// ============================================================
//  Dialog · Sheet · ConfirmDialog · useConfirm
// ------------------------------------------------------------
//  포탈 + 포커스 가두기 + Esc + 스크롤 잠금 + 닫힌 뒤 포커스 복귀를
//  한 곳에서 보장한다. 좁은 화면에서는 아래에서 올라오는 시트가 된다.
//  window.confirm 을 대체할 때는 useConfirm() 의 Promise 를 쓴다.
// ============================================================
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { Button, IconButton, type ButtonVariant } from "./button";
import { Portal } from "./portal";
import { useEscape, useFocusTrap, useLockScroll, usePresence } from "./hooks";

/**
 * 닫힐 때 흐려지며 사라지는 시간 (ms) — duration-nd-fast(120ms)보다 조금 길게.
 * 창이 순간 사라지면 방금 무엇이 닫혔는지 눈이 놓친다.
 */
const EXIT_MS = 140;

type Size = "sm" | "md" | "lg" | "xl" | "full";
const sizeCls: Record<Size, string> = {
  sm: "sm:max-w-[420px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[760px]",
  xl: "sm:max-w-[980px]",
  full: "sm:max-w-[calc(100vw-3rem)]",
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: Size;
  children?: ReactNode;
  footer?: ReactNode;
  /** 열릴 때 포커스할 요소 (없으면 첫 포커스 가능한 요소) */
  initialFocus?: RefObject<HTMLElement>;
  /** 바깥(스크림)을 눌러 닫기 — 편집 중 내용을 잃기 쉬우면 false */
  closeOnOverlay?: boolean;
  hideClose?: boolean;
  className?: string;
  bodyClassName?: string;
  /** 헤더 없이 본문만 그릴 때 aria-label 로 이름을 준다 */
  ariaLabel?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  initialFocus,
  closeOnOverlay = true,
  hideClose = false,
  className,
  bodyClassName,
  ariaLabel,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`nd-dlg-${Math.random().toString(36).slice(2, 8)}`).current;
  useEscape(open, onClose);
  useLockScroll(open);
  useFocusTrap(panelRef, open, initialFocus);

  // 닫히는 동안에는 마지막으로 열려 있던 내용을 그린다 — 부르는 쪽이 닫으며
  // 제목·본문 값을 비워도 빈 창이 흐려지며 사라지지 않게
  const { mounted, closing } = usePresence(open, EXIT_MS);
  const shown = useRef({ title, description, children, footer });
  if (open) shown.current = { title, description, children, footer };
  if (!mounted) return null;
  const v = shown.current;
  return (
    <Portal>
      <div
        className={cn(
          "fixed inset-0 z-nd-dialog flex items-end justify-center bg-nd-inverse/35 p-0 sm:items-center sm:p-4",
          closing ? "pointer-events-none animate-out fade-out fill-mode-forwards duration-nd-fast" : "animate-in fade-in duration-nd",
        )}
        onMouseDown={(e) => {
          if (closeOnOverlay && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={v.title ? titleId : undefined}
          aria-label={!v.title ? ariaLabel : undefined}
          tabIndex={-1}
          className={cn(
            "nd-surface flex max-h-[92vh] w-full flex-col rounded-t-nd-xl shadow-nd-dialog outline-none sm:max-h-[88vh] sm:rounded-nd-xl",
            closing
              ? "animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards duration-nd-fast sm:zoom-out-95 sm:slide-out-to-bottom-0"
              : "animate-in slide-in-from-bottom-4 duration-nd sm:zoom-in-95 sm:slide-in-from-bottom-0",
            sizeCls[size],
            className,
          )}
        >
          {(v.title || !hideClose) && (
            <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                {v.title && (
                  <h2 id={titleId} className="text-nd-title text-nd-fg">
                    {v.title}
                  </h2>
                )}
                {v.description && <p className="mt-1 text-nd-body text-nd-fg-2">{v.description}</p>}
              </div>
              {!hideClose && <IconButton icon={X} label="닫기" onClick={onClose} className="-mr-2 -mt-1" />}
            </div>
          )}
          <div className={cn("nd-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6", !v.title && "pt-5", bodyClassName)}>
            {v.children}
          </div>
          {v.footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-nd-line px-5 py-3 sm:px-6">
              {v.footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/** 옆/아래에서 나오는 시트 — 긴 편집 폼, 모바일 탐색 드로어 */
export function Sheet({
  open,
  onClose,
  side = "right",
  title,
  children,
  className,
  ariaLabel,
  width = 420,
  initialFocus,
  hideClose = false,
}: {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right" | "bottom";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
  width?: number;
  initialFocus?: RefObject<HTMLElement>;
  hideClose?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`nd-sheet-${Math.random().toString(36).slice(2, 8)}`).current;
  useEscape(open, onClose);
  useLockScroll(open);
  useFocusTrap(panelRef, open, initialFocus);
  // 닫힐 때도 들어온 쪽으로 미끄러져 나간다 (Dialog 와 같은 원칙 — 마지막 내용을 그린다)
  const { mounted, closing } = usePresence(open, EXIT_MS);
  const shown = useRef({ title, children });
  if (open) shown.current = { title, children };
  if (!mounted) return null;
  const v = shown.current;

  const pos =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[92vh] rounded-t-nd-xl"
      : side === "left"
        ? "inset-y-0 left-0 h-full"
        : "inset-y-0 right-0 h-full";
  const motion = closing
    ? cn(
        "animate-out fill-mode-forwards duration-nd-fast",
        side === "bottom" ? "slide-out-to-bottom-6" : side === "left" ? "slide-out-to-left-6" : "slide-out-to-right-6",
        "fade-out",
      )
    : cn(
        "animate-in duration-nd",
        side === "bottom" ? "slide-in-from-bottom-6" : side === "left" ? "slide-in-from-left-6" : "slide-in-from-right-6",
      );

  return (
    <Portal>
      <div
        className={cn(
          "fixed inset-0 z-nd-dialog bg-nd-inverse/35",
          closing ? "pointer-events-none animate-out fade-out fill-mode-forwards duration-nd-fast" : "animate-in fade-in duration-nd",
        )}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={v.title ? titleId : undefined}
          aria-label={!v.title ? ariaLabel : undefined}
          tabIndex={-1}
          style={side !== "bottom" ? { width: `min(100vw, ${width}px)` } : undefined}
          className={cn("nd-surface absolute flex flex-col shadow-nd-dialog outline-none", pos, motion, className)}
        >
          {(v.title || !hideClose) && (
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              {v.title ? (
                <h2 id={titleId} className="text-nd-section text-nd-fg">
                  {v.title}
                </h2>
              ) : (
                <span />
              )}
              {!hideClose && <IconButton icon={X} label="닫기" onClick={onClose} className="-mr-2" />}
            </div>
          )}
          <div className="nd-scroll min-h-0 flex-1 overflow-y-auto">{v.children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ---- ConfirmDialog -------------------------------------------
export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 파괴적 동작이면 danger */
  tone?: "primary" | "danger";
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  busy = false,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  tone = "primary",
}: ConfirmOptions & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  // 안전한 쪽(취소)에 먼저 포커스 — Enter 를 습관적으로 눌러도 지워지지 않는다
  const cancelRef = useRef<HTMLButtonElement>(null);
  const variant: ButtonVariant = tone === "danger" ? "danger" : "primary";
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      hideClose
      initialFocus={cancelRef}
      closeOnOverlay={!busy}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <div className="text-nd-body leading-relaxed text-nd-fg-2">{message}</div>}
    </Dialog>
  );
}

// ---- useConfirm ----------------------------------------------
type Ask = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback<Ask>(
    (opts) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  );
  const finish = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  // 닫히며 흐려지는 동안 제목·버튼 문구가 비지 않게 마지막 질문을 쥐고 있는다
  const last = useRef(state);
  if (state) last.current = state;
  const shown = state ?? last.current;
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmDialog
        open={!!state}
        title={shown?.title ?? ""}
        message={shown?.message}
        confirmLabel={shown?.confirmLabel}
        cancelLabel={shown?.cancelLabel}
        tone={shown?.tone}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      />
    </ConfirmContext.Provider>
  );
}

/** `if (await confirm({ title: "삭제할까요?", tone: "danger" })) …` */
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
