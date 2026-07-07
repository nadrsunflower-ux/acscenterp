"use client";

// ============================================================
//  개발허브 홈 ⑤ — "전체 그림"
//  프로젝트별 진행률(FeatureProgress) + 팀원별 작업 부하(MemberWorkload)
//  2컬럼. (UI 라벨은 "프로젝트", 코드 식별자는 feature 그대로)
// ============================================================

import Link from "next/link";
import { Card } from "@/components/neander/ui";
import { FeatureProgress } from "@/components/neander/dev/FeatureProgress";
import { MemberWorkload } from "@/components/neander/dev/MemberWorkload";
import type { DevFeature, DevTask } from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";
import { SectionHeader } from "./SectionHeader";

export function BigPicture({
  tasks,
  features,
  members,
}: {
  tasks: DevTask[];
  features: DevFeature[];
  members: Member[];
}) {
  return (
    <section>
      <SectionHeader
        icon="🗺️"
        title="전체 그림"
        description="프로젝트별 진행률과 팀원별 작업 부하 — 팀 전체 흐름을 한 번에 봐요."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="!rounded-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800">프로젝트별 진행률</h3>
            <Link
              href="/neander/dev/features"
              className="text-xs font-medium text-zinc-400 hover:text-indigo-600"
            >
              프로젝트 관리 →
            </Link>
          </div>
          <FeatureProgress tasks={tasks} features={features} />
        </Card>

        <Card className="!rounded-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800">팀원별 작업 부하</h3>
            <Link
              href="/neander/dev/board"
              className="text-xs font-medium text-zinc-400 hover:text-indigo-600"
            >
              보드 보기 →
            </Link>
          </div>
          <MemberWorkload tasks={tasks} members={members} />
        </Card>
      </div>
    </section>
  );
}
