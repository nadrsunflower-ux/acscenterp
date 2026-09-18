// ============================================================
//  팀원 아바타 · 캐릭터·색 고르기 · 분류 선택 (기존 ui.tsx 에서 이동)
//  캐릭터·색 고르기는 팀원 화면과 메일 계정 꾸미기가 함께 쓴다
// ============================================================
import { Check } from "lucide-react";
import { TASK_CATEGORIES, type TaskCategory } from "@/lib/neander/types";
import { cn } from "./cn";
import { Icon } from "./icon";

/** 팀원이 고르는 색 — 데이터에 저장되는 값이라 그대로 둔다 */
export const AVATAR_PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#ca8a04"];

/** 선택 가능한 캐릭터(이모지) 목록 — 사용자가 고르는 데이터 */
export const AVATAR_EMOJIS = [
  "🐱", "🐶", "🦊", "🐰", "🐻", "🐼", "🐨", "🐯",
  "🦁", "🐸", "🐵", "🐧", "🦄", "🐙", "🐢", "🐳",
  "🦉", "🐝", "🐤", "🦋",
];

/** 캐릭터 고르기 — 「없음」이면 빈 값 (이름 첫 글자가 나온다) */
export function AvatarPicker({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <div className="flex max-w-[260px] flex-wrap gap-1.5" role="group" aria-label="캐릭터">
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={value === ""}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border text-nd-micro font-medium transition-colors duration-nd-fast",
          value === ""
            ? "border-nd-fg bg-nd-fg/[.06] text-nd-fg"
            : "border-nd-line text-nd-fg-3 hover:bg-nd-fg/[.06]",
        )}
      >
        없음
      </button>
      {AVATAR_EMOJIS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          aria-pressed={value === a}
          aria-label={`캐릭터 ${a}`}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border text-lg leading-none transition-colors duration-nd-fast",
            value === a ? "border-nd-fg bg-nd-fg/[.06]" : "border-transparent hover:bg-nd-fg/[.06]",
          )}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

/**
 * 색 고르기. `defaultColor` 를 주면 맨 앞에 「기본」 칩이 생기고, 고르면 빈 값이 된다
 * (메일 계정처럼 따로 정하지 않으면 정해진 색을 쓰는 곳).
 */
export function ColorPalette({
  value,
  onChange,
  size = "md",
  defaultColor,
}: {
  value: string;
  onChange: (c: string) => void;
  size?: "sm" | "md";
  defaultColor?: string;
}) {
  const dim = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const ring = "ring-2 ring-nd-fg ring-offset-2 ring-offset-nd-content";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="색상">
      {defaultColor && (
        // 「기본」은 글자로 — 팔레트의 비슷한 색과 헷갈리지 않게
        <button
          type="button"
          onClick={() => onChange("")}
          aria-pressed={value === ""}
          className={cn(
            size === "sm" ? "h-5 px-1.5" : "h-7 px-2.5",
            "flex items-center gap-1.5 rounded-full border text-nd-micro font-medium transition-colors duration-nd-fast",
            value === "" ? "border-nd-fg bg-nd-fg/[.06] text-nd-fg" : "border-nd-line text-nd-fg-3 hover:bg-nd-fg/[.06]",
          )}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: defaultColor }} aria-hidden />
          기본
        </button>
      )}
      {AVATAR_PALETTE.map((c) => {
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-pressed={on}
            aria-label={`색상 ${c}`}
            className={cn(
              dim,
              "flex items-center justify-center rounded-full text-white transition-shadow duration-nd-fast",
              on && ring,
            )}
            style={{ backgroundColor: c }}
          >
            {on && <Icon icon={Check} size={size === "sm" ? 11 : 14} strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}

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
