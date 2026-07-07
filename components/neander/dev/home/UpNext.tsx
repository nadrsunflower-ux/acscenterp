"use client";

// ============================================================
//  개발허브 홈 ④ — "다음 할 일"
//  좌: 이번 주 마감(지연=빨강 / 오늘=주황 / 내일·이번 주 구분)
//  우: 리뷰 대기 목록. 행 클릭 → 보드 상세(board?task=<id>).
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { Card, EmptyState } from "@/components/neander/ui";
import { FeatureChip } from "@/components/neander/dev/atoms";
import { devPriorityRank, type DevFeature, type DevTask } from "@/lib/neander/dev/types";
import { SectionHeader } from "./SectionHeader";
import { dueInfo, thisWeekEnd } from "./due";

/** 카드당 최대 노출 행 수 (넘치면 "+N건 — 보드에서 보기") */
const MAX_ROWS = 8;

export function UpNext({
  tasks,
  featureById,
}: {
  tasks: DevTask[];
  featureById: (id?: string) => DevFeature | undefined;
}) {
  // 이번 주 마감 + 지연: 미완료이면서 dueDate ≤ 이번 주 토요일 (지연분 포함)
  const dueSoon = useMemo(() => {
    const weekEnd = thisWeekEnd();
    return tasks
      .filter((t) => t.status !== "done" && !!t.dueDate && t.dueDate <= weekEnd)
      .sort((a, b) =>
        a.dueDate! < b.dueDate!
          ? -1
          : a.dueDate! > b.dueDate!
            ? 1
            : devPriorityRank(a.priority) - devPriorityRank(b.priority),
      );
  }, [tasks]);

  // 리뷰 대기: 최근에 리뷰로 올라온 것부터
  const inReview = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "review")
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks],
  );

  return (
    <section>
      <SectionHeader
        icon="⏰"
        title="다음 할 일"
        description="이번 주 마감과 리뷰 대기 — 지금 챙겨야 할 것들이에요."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 이번 주 마감 */}
        <Card className="!rounded-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800">📅 이번 주 마감</h3>
            <span className="text-xs tabular-nums text-zinc-400">{dueSoon.length}건</span>
          </div>
          {dueSoon.length === 0 ? (
            <EmptyState
              icon="📅"
              title="이번 주 마감 예정 작업이 없어요"
              description="작업에 마감일을 정해두면 지연·오늘·내일 순으로 여기서 미리 챙겨드려요."
            />
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-zinc-100">
                {dueSoon.slice(0, MAX_ROWS).map((t) => (
                  <DueRow key={t.id} task={t} feature={featureById(t.featureId)} />
                ))}
              </ul>
              {dueSoon.length > MAX_ROWS && (
                <Link
                  href="/neander/dev/board"
                  className="mt-2 block text-xs font-medium text-indigo-600 hover:underline"
                >
                  +{dueSoon.length - MAX_ROWS}건 더 — 보드에서 보기 →
                </Link>
              )}
            </>
          )}
        </Card>

        {/* 리뷰 대기 */}
        <Card className="!rounded-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800">👀 리뷰 대기</h3>
            <span className="text-xs tabular-nums text-zinc-400">{inReview.length}건</span>
          </div>
          {inReview.length === 0 ? (
            <EmptyState
              icon="👀"
              title="리뷰를 기다리는 작업이 없어요"
              description="작업 보드에서 카드를 '리뷰'로 옮기면 확인이 필요한 작업이 여기 나타납니다."
            />
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-zinc-100">
                {inReview.slice(0, MAX_ROWS).map((t) => (
                  <ReviewRow key={t.id} task={t} feature={featureById(t.featureId)} />
                ))}
              </ul>
              {inReview.length > MAX_ROWS && (
                <Link
                  href="/neander/dev/board?status=review"
                  className="mt-2 block text-xs font-medium text-indigo-600 hover:underline"
                >
                  +{inReview.length - MAX_ROWS}건 더 — 보드에서 보기 →
                </Link>
              )}
            </>
          )}
        </Card>
      </div>
    </section>
  );
}

/** 마감 행 — 좌측에 지연/오늘/내일/이번 주 배지 */
function DueRow({ task: t, feature }: { task: DevTask; feature?: DevFeature }) {
  const due = dueInfo(t.dueDate!);
  return (
    <li>
      <Link
        href={`/neander/dev/board?task=${t.id}`}
        aria-label={`${t.title} — 작업 상세 보기 (${due.label})`}
        className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <span
          className={`inline-flex w-24 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${due.cls}`}
        >
          {due.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{t.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {(feature || t.featureName) && (
              <FeatureChip feature={feature} name={t.featureName} className="!py-0" />
            )}
            {t.assigneeNames.length > 0 && (
              <span className="text-[11px] text-zinc-400">
                담당 {t.assigneeNames.join(", ")}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

/** 리뷰 대기 행 */
function ReviewRow({ task: t, feature }: { task: DevTask; feature?: DevFeature }) {
  return (
    <li>
      <Link
        href={`/neander/dev/board?task=${t.id}`}
        aria-label={`${t.title} — 작업 상세 보기 (리뷰 대기)`}
        className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{t.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {(feature || t.featureName) && (
              <FeatureChip feature={feature} name={t.featureName} className="!py-0" />
            )}
            {t.assigneeNames.length > 0 && (
              <span className="text-[11px] text-zinc-400">
                담당 {t.assigneeNames.join(", ")}
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
          리뷰 대기
        </span>
      </Link>
    </li>
  );
}
