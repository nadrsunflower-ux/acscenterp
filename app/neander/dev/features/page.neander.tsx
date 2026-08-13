"use client";

// ============================================================
//  프로젝트(구 '기능') 관리 (/neander/dev/features)
//  프로젝트는 작업을 묶는 단위 — 비개발자가 개발 진행을 이해하는 축.
//  전체폭 2패널: 좌측 새 프로젝트 생성 폼 / 우측 프로젝트 카드 그리드.
//  H1 은 dev layout 이 담당 — 여기서는 한 줄 설명만.
// ============================================================

import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import {
  FeatureCreatePanel,
  FeatureCardGrid,
} from "@/components/neander/dev/FeatureManager";

export default function FeaturesPage() {
  const { currentMember } = useAppData();
  const { features, loading } = useDevData();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        프로젝트 — 작업을 묶는 단위예요. 카드를 누르면 작업 보드에서 해당 프로젝트의
        작업만 모아 볼 수 있어요.
      </p>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:gap-6">
          <div className="h-72 animate-pulse rounded-2xl bg-zinc-100" />
          <div className="grid content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:gap-6">
          <FeatureCreatePanel features={features} currentMember={currentMember} />
          <FeatureCardGrid features={features} currentMember={currentMember} />
        </div>
      )}
    </div>
  );
}
