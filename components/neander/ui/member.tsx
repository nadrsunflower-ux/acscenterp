// ============================================================
//  팀원 아바타 · 분류 선택 (기존 ui.tsx 에서 이동)
// ============================================================
import { TASK_CATEGORIES, type TaskCategory } from "@/lib/neander/types";
import { cn } from "./cn";

// 캐릭터(이모지)가 있으면 이모지를, 없으면 이름 첫 글자를 색상 원 안에 표시.
// className 으로 크기/글자크기 지정 (예: "h-10 w-10 text-lg").
export function MemberAvatar({
  name,
  color = "#71717a",
  avatar,
  className,
}: {
  name: string;
  color?: string;
  avatar?: string;
  className?: string;
}) {
  const initial = name.trim().charAt(0) || "?";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white",
        className ?? "h-10 w-10 text-lg",
      )}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {avatar || initial}
    </span>
  );
}

// 분류(스모트/아이디/와우/기타)를 칸(박스)으로 선택. 선택 시 분류 색상으로 채워짐.
export function CategoryPicker({
  value,
  onChange,
}: {
  /** undefined 면 어떤 칸도 선택되지 않은 '미분류' 상태 */
  value?: TaskCategory;
  onChange: (c: TaskCategory) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="분류">
      {TASK_CATEGORIES.map((c) => {
        const active = value === c.value;
        return (
          <button
            type="button"
            key={c.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.value)}
            className={cn(
              "h-ctl-md rounded-nd-md border text-[13px] font-medium transition-colors duration-nd-fast",
              active ? "text-white" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
            )}
            style={active ? { backgroundColor: c.color, borderColor: c.color } : undefined}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
