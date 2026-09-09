"use client";

// ============================================================
//  프로젝트(feature/에픽)별 진행률 (홈 '한눈에')
//  - 프로젝트에 속한 작업(featureId 매칭)의 done/total 을 진행 바로.
//  - 작업이 없는 프로젝트도 0/0 으로 노출. 하나도 없으면 안내.
//  ※ UI 라벨은 "프로젝트", 코드 식별자(feature*)는 그대로 둔다.
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Blocks } from "lucide-react";
import { EmptyState, Badge } from "@/components/neander/ui";
import { FeatureChip } from "@/components/neander/dev/atoms";
import { FEATURE_STATUS_TONE } from "@/components/neander/dev/FeatureManager";
import {
  featureColorFor,
  featureStatusLabel,
  type DevFeature,
  type DevTask,
} from "@/lib/neander/dev/types";

type Row = {
  feature: DevFeature;
  done: number;
  total: number;
};

export function FeatureProgress({
  tasks,
  features,
}: {
  tasks: DevTask[];
  features: DevFeature[];
}) {
  const rows = useMemo<Row[]>(() => {
    return features.map((f) => {
      let done = 0;
      let total = 0;
      for (const t of tasks) {
        if (t.featureId === f.id) {
          total += 1;
          if (t.status === "done") done += 1;
        }
      }
      return { feature: f, done, total };
    });
  }, [tasks, features]);

  if (features.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <EmptyState
          icon={Blocks}
          title="프로젝트를 먼저 만들어보세요"
          description="작업을 프로젝트 단위로 묶으면 코드를 몰라도 진행률을 한눈에 볼 수 있어요."
        />
        <Link
          href="/neander/dev/features"
          className="inline-flex items-center gap-1 text-nd-body font-medium text-nd-accent-strong hover:underline"
        >
          프로젝트 관리로 이동
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map(({ feature: f, done, total }) => {
        const color = featureColorFor(f);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <Link
            key={f.id}
            href={`/neander/dev/board?feature=${f.id}`}
            aria-label={`${f.name} 관련 작업 보기 (${done}/${total} 완료)`}
            className="-mx-1 flex flex-col gap-1.5 rounded-nd-md px-1 py-1 transition-colors duration-nd-fast hover:bg-nd-sunken focus:outline-none focus-visible:shadow-nd-focus"
          >
            <div className="flex items-center gap-2">
              <FeatureChip feature={f} className="min-w-0" />
              <Badge tone={FEATURE_STATUS_TONE[f.status]} dot>
                {featureStatusLabel(f.status)}
              </Badge>
              <span className="nd-num ml-auto text-nd-caption font-semibold text-nd-fg-2">
                {done}/{total}
              </span>
            </div>
            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-nd-fg/[.07]"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${f.name} 진행률 ${done}/${total}`}
            >
              <div
                className="h-full rounded-full transition-all duration-nd"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
