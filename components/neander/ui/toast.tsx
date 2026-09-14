"use client";

// ============================================================
//  Toast — 잠깐 떠 있는 알림
// ------------------------------------------------------------
//  "저장됨", "복사됨", "업로드 실패" 처럼 흐름을 끊지 않아야 하는 소식.
//  alert() 를 대신한다. 결정을 요구하는 것은 ConfirmDialog 로.
// ============================================================
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "./cn";
import { Icon } from "./icon";
import { IconButton } from "./button";
import { Portal } from "./portal";
import type { Tone } from "./badge";

export interface ToastOptions {
  message: ReactNode;
  title?: ReactNode;
  tone?: Extract<Tone, "neutral" | "success" | "warning" | "danger" | "info">;
  /** ms. 0 이면 닫을 때까지 */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  /** 닫히는 중 — 흐려지며 오른쪽으로 빠진 뒤 목록에서 지운다 */
  leaving?: boolean;
}

/** 알림이 빠져나가는 시간 (ms) — duration-nd(200ms)와 맞춘다 */
const TOAST_EXIT_MS = 200;

interface ToastApi {
  toast: (opts: ToastOptions | string) => number;
  success: (message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">) => number;
  error: (message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">) => number;
  info: (message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneIcon = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;
const toneText = {
  neutral: "text-nd-fg-2",
  info: "text-nd-info",
  success: "text-nd-success",
  warning: "text-nd-warning",
  danger: "text-nd-danger",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    // 바로 지우면 알림이 순간 사라진다 — 먼저 빠져나가게 하고 나서 지운다
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), TOAST_EXIT_MS);
  }, []);

  const toast = useCallback(
    (opts: ToastOptions | string) => {
      const o: ToastOptions = typeof opts === "string" ? { message: opts } : opts;
      const id = ++seq.current;
      const duration = o.duration ?? (o.tone === "danger" ? 6000 : 3500);
      setItems((xs) => [...xs.slice(-4), { ...o, id }]);
      if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (message, o) => toast({ ...o, message, tone: "success" }),
      error: (message, o) => toast({ ...o, message, tone: "danger" }),
      info: (message, o) => toast({ ...o, message, tone: "info" }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Portal>
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-nd-toast flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5"
        >
          {items.map((t) => {
            const tone = t.tone ?? "neutral";
            return (
              <div
                key={t.id}
                className={cn(
                  "nd-glass-strong pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-nd-md px-3.5 py-2.5 text-nd-body text-nd-fg duration-nd sm:w-auto sm:min-w-[280px]",
                  t.leaving
                    ? "animate-out fade-out slide-out-to-right-4 fill-mode-forwards"
                    : "animate-in fade-in slide-in-from-bottom-2",
                )}
              >
                <Icon icon={toneIcon[tone]} size={18} className={cn("mt-0.5", toneText[tone])} />
                <div className="min-w-0 flex-1">
                  {t.title && <p className="font-semibold">{t.title}</p>}
                  <p className={cn("leading-snug", !!t.title && "text-nd-fg-2")}>{t.message}</p>
                  {t.action && (
                    <button
                      type="button"
                      className="mt-1.5 text-nd-caption font-semibold text-nd-accent-strong hover:underline"
                      onClick={() => {
                        t.action?.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>
                <IconButton icon={X} label="알림 닫기" size="sm" onClick={() => dismiss(t.id)} className="-mr-1.5 -mt-1" />
              </div>
            );
          })}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
