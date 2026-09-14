"use client";

// ============================================================
//  DropZone — 파일을 끌어다 놓거나 눌러서 고르는 자리
// ------------------------------------------------------------
//  재무 카드 기록과 엑셀 임포트, 매출 적재가 각각 다른 마크업으로 같은
//  것을 만들고 있었다. 하나로 모은다.
//
//  끌어다 놓기만 되면 키보드 사용자는 파일을 못 올린다 — 항상 눌러서
//  고를 수 있는 버튼이고, 숨은 <input type="file"> 이 짝을 이룬다.
// ============================================================
import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { cn } from "./cn";
import { Icon, type LucideIcon } from "./icon";

export function DropZone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  icon = Upload,
  title,
  hint,
  /** 진행 중 표시 */
  busy = false,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  busy?: boolean;
  className?: string;
  /** 기본 안내 대신 직접 그릴 때 */
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  };
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={cn(
        "rounded-nd-lg border-2 border-dashed transition-colors duration-nd-fast",
        over ? "border-nd-accent bg-nd-accent-soft" : "border-nd-border bg-nd-sunken",
        disabled && "opacity-55",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-nd-lg px-4 py-7 text-center disabled:cursor-not-allowed"
      >
        {children ?? (
          <>
            <Icon icon={icon} size={22} className="text-nd-fg-3" />
            <span className="text-nd-body font-medium text-nd-fg">{title}</span>
            {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
