"use client";

// ============================================================
//  개발 협업 허브 — 한눈에 (/neander/dev)
//  인지 순서로 조립만 한다 (섹션 구현은 components/neander/dev/home/):
//   ① 인사 + 상태 문장 + 요약 타일   (HomeGreeting)
//   ② 지금 — 진행중인 작업(팀원별)   (NowInProgress)
//   ③ 최근 변화 — 진행 소식 다이제스트 (RecentDigest)
//   ④ 다음 할 일 — 이번 주 마감·리뷰 대기 (UpNext)
//   ⑤ 전체 그림 — 프로젝트 진행률·팀원 부하 (BigPicture)
//  데이터는 DevDataProvider(useDevData) + useAppData 만 소비 — 신규 구독 없음.
// ============================================================

import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import { HomeGreeting } from "@/components/neander/dev/home/HomeGreeting";
import { NowInProgress } from "@/components/neander/dev/home/NowInProgress";
import { RecentDigest } from "@/components/neander/dev/home/RecentDigest";
import { UpNext } from "@/components/neander/dev/home/UpNext";
import { BigPicture } from "@/components/neander/dev/home/BigPicture";

export default function DevDashboardPage() {
  const { members, currentMember } = useAppData();
  const { tasks, features, activity, loading, featureById } = useDevData();

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-12 w-72 animate-pulse rounded-xl bg-zinc-100" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-zinc-100" />
        <div className="h-48 animate-pulse rounded-2xl bg-zinc-100" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ① 인사 + 상태 문장 + 요약 타일 */}
      <HomeGreeting memberName={currentMember?.name} tasks={tasks} />

      {/* ② 지금 — 진행중인 작업 (내 것 먼저) */}
      <NowInProgress
        tasks={tasks}
        members={members}
        currentMemberId={currentMember?.id}
        featureById={featureById}
      />

      {/* ③ 최근 변화 — 진행 소식 다이제스트 */}
      <RecentDigest activity={activity} members={members} featureById={featureById} />

      {/* ④ 다음 할 일 — 이번 주 마감 + 리뷰 대기 */}
      <UpNext tasks={tasks} featureById={featureById} />

      {/* ⑤ 전체 그림 — 프로젝트 진행률 + 팀원 부하 */}
      <BigPicture tasks={tasks} features={features} members={members} />
    </div>
  );
}
