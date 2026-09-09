"use client";

// ============================================================
//  개발 허브 공통 소형 컴포넌트 (뱃지/태그/칩/아바타 스택)
//  color helper 는 lib/neander/dev/types 에서, Badge/MemberAvatar 는
//  기존 components/neander/ui 에서 재사용한다.
// ============================================================

import { Badge, MemberAvatar, cn, type Tone } from "@/components/neander/ui";
import {
  devStatusLabel,
  devPriorityLabel,
  devPriorityColor,
  devPriorityIcon,
  devKindLabel,
  devKindColor,
  devKindIcon,
  featureColorFor,
  type DevStatus,
  type DevPriority,
  type DevKind,
  type DevFeature,
} from "@/lib/neander/dev/types";

/** 작업 상태 → 의미 톤 (hex 딕셔너리 대신) */
export const DEV_STATUS_TONE: Record<DevStatus, Tone> = {
  backlog: "neutral",
  todo: "accent",
  in_progress: "info",
  review: "warning",
  done: "success",
};
export const devStatusTone = (s: DevStatus): Tone => DEV_STATUS_TONE[s] ?? "neutral";

/** 작업 상태 뱃지 */
export function StatusBadge({ status, className }: { status: DevStatus; className?: string }) {
  return (
    <Badge tone={devStatusTone(status)} dot className={className}>
      {devStatusLabel(status)}
    </Badge>
  );
}

/** 우선순위 태그 (아이콘 + 라벨) */
export function PriorityTag({ priority, compact }: { priority: DevPriority; compact?: boolean }) {
  const color = devPriorityColor(priority);
  return (
    <span
      className="inline-flex items-center gap-1 text-nd-caption font-semibold"
      style={{ color }}
      title={`우선순위: ${devPriorityLabel(priority)}`}
    >
      <span className="text-[10px] leading-none">{devPriorityIcon(priority)}</span>
      {!compact && devPriorityLabel(priority)}
    </span>
  );
}

/** 작업 종류 태그 (아이콘 + 라벨) */
export function KindTag({ kind, iconOnly }: { kind: DevKind; iconOnly?: boolean }) {
  if (iconOnly) {
    return (
      <span title={devKindLabel(kind)} className="text-nd-body leading-none">
        {devKindIcon(kind)}
      </span>
    );
  }
  return (
    <Badge color={devKindColor(kind)}>
      <span>{devKindIcon(kind)}</span>
      {devKindLabel(kind)}
    </Badge>
  );
}

/** 프로젝트(구 '기능'/에픽) 칩 — 색 점 + 이름. UI 라벨만 '프로젝트', 식별자는 feature 그대로 */
export function FeatureChip({
  feature,
  name,
  className,
}: {
  /** feature 객체를 주면 색을 자동 계산. 없으면 name 만 회색으로 표시 */
  feature?: Pick<DevFeature, "id" | "color" | "name">;
  name?: string;
  className?: string;
}) {
  const label = feature?.name ?? name;
  if (!label) return null;
  // 프로젝트 색은 데이터가 가진 색 — 없으면 중성 톤
  const color = feature ? featureColorFor(feature) : undefined;
  return (
    <Badge size="sm" tone="neutral" color={color} dot className={cn("max-w-full", className)}>
      <span className="truncate" title={label}>
        {label}
      </span>
    </Badge>
  );
}

/** 담당자 아바타 스택 (겹쳐 표시) */
export function AssigneeStack({
  members,
  size = "sm",
  max = 4,
}: {
  members: { id: string; name: string; color?: string; avatar?: string }[];
  size?: "xs" | "sm" | "md";
  max?: number;
}) {
  if (members.length === 0) {
    return <span className="text-nd-micro text-nd-fg-4">미배정</span>;
  }
  const dim =
    size === "xs" ? "h-5 w-5 text-[9px]" : size === "md" ? "h-8 w-8 text-sm" : "h-6 w-6 text-[11px]";
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        <MemberAvatar
          key={m.id}
          name={m.name}
          color={m.color ?? "#71717a"}
          avatar={m.avatar}
          className={cn(dim, "ring-2 ring-nd-content")}
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "nd-num flex items-center justify-center rounded-full bg-nd-fg/10 font-semibold text-nd-fg-2 ring-2 ring-nd-content",
            dim,
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
