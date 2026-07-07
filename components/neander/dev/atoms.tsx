"use client";

// ============================================================
//  개발 허브 공통 소형 컴포넌트 (뱃지/태그/칩/아바타 스택)
//  color helper 는 lib/neander/dev/types 에서, Badge/MemberAvatar 는
//  기존 components/neander/ui 에서 재사용한다.
// ============================================================

import { Badge, MemberAvatar, cn } from "@/components/neander/ui";
import {
  devStatusLabel,
  devStatusColor,
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

/** 작업 상태 뱃지 */
export function StatusBadge({ status, className }: { status: DevStatus; className?: string }) {
  return (
    <Badge color={devStatusColor(status)} className={className}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: devStatusColor(status) }} />
      {devStatusLabel(status)}
    </Badge>
  );
}

/** 우선순위 태그 (아이콘 + 라벨) */
export function PriorityTag({ priority, compact }: { priority: DevPriority; compact?: boolean }) {
  const color = devPriorityColor(priority);
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold"
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
      <span title={devKindLabel(kind)} className="text-sm leading-none">
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
  const color = feature ? featureColorFor(feature) : "#94a3b8";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
      style={{ backgroundColor: `${color}14`, color }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
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
    return <span className="text-[11px] text-zinc-300">미배정</span>;
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
          className={cn(dim, "ring-2 ring-white")}
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-600 ring-2 ring-white",
            dim,
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
