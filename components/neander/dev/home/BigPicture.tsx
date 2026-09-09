"use client";

// ============================================================
//  개발허브 홈 ⑤ — "전체 그림"
//  프로젝트별 진행률(FeatureProgress) + 팀원별 작업 부하(MemberWorkload)
//  2컬럼. (UI 라벨은 "프로젝트", 코드 식별자는 feature 그대로)
// ============================================================

import Link from "next/link";
import { ArrowRight, Map } from "lucide-react";
import { Card, SectionHeader as CardHeader } from "@/components/neander/ui";
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
        icon={Map}
        title="전체 그림"
        description="프로젝트별 진행률과 팀원별 작업 부하 — 팀 전체 흐름을 한 번에 봐요."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            as="h3"
            title="프로젝트별 진행률"
            className="mb-4"
            action={
              <Link
                href="/neander/dev/features"
                className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-fg-3 hover:text-nd-accent-strong"
              >
                프로젝트 관리
                <ArrowRight size={12} aria-hidden />
              </Link>
            }
          />
          <FeatureProgress tasks={tasks} features={features} />
        </Card>

        <Card>
          <CardHeader
            as="h3"
            title="팀원별 작업 부하"
            className="mb-4"
            action={
              <Link
                href="/neander/dev/board"
                className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-fg-3 hover:text-nd-accent-strong"
              >
                보드 보기
                <ArrowRight size={12} aria-hidden />
              </Link>
            }
          />
          <MemberWorkload tasks={tasks} members={members} />
        </Card>
      </div>
    </section>
  );
}
