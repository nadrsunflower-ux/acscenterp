"use client";

// ============================================================
//  개발허브 홈 ① — 인사 + 상태 문장 + 요약 타일
//  "안녕하세요, {이름}님" 아래에 오늘 기준 자동 요약 한 줄
//  ("지금 진행중 N건 · 오늘 마감 N건 · 리뷰 대기 N건")을 보여주고,
//  요약 타일 4개(클릭 → 보드 필터 딥링크)를 유지한다.
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { todayStr, weekKey } from "@/lib/neander/format";
import {
  devStatusColor,
  devPriorityColor,
  type DevTask,
} from "@/lib/neander/dev/types";

type Tile = {
  key: string;
  label: string;
  icon: string;
  color: string;
  value: number;
  /** 클릭 시 보드로 이동(필터 프리셋). 계약: board 가 이 쿼리를 읽음. */
  href: string;
};

export function HomeGreeting({
  memberName,
  tasks,
}: {
  /** 로그인 팀원 이름 (매칭 안 되면 생략) */
  memberName?: string;
  tasks: DevTask[];
}) {
  const stats = useMemo(() => {
    const today = todayStr();
    const thisWeek = weekKey(Date.now());
    let inProgress = 0;
    let review = 0;
    let dueToday = 0;
    let doneThisWeek = 0;
    let urgentOpen = 0;
    for (const t of tasks) {
      if (t.status === "in_progress") inProgress += 1;
      if (t.status === "review") review += 1;
      if (t.status !== "done" && t.dueDate === today) dueToday += 1;
      if (t.status === "done" && t.doneAt && weekKey(t.doneAt) === thisWeek) doneThisWeek += 1;
      if (t.priority === "urgent" && t.status !== "done") urgentOpen += 1;
    }
    return { inProgress, review, dueToday, doneThisWeek, urgentOpen };
  }, [tasks]);

  const tiles: Tile[] = [
    { key: "in_progress", label: "진행중", icon: "⚡", color: devStatusColor("in_progress"), value: stats.inProgress, href: "/neander/dev/board?status=in_progress" },
    { key: "review", label: "리뷰 대기", icon: "👀", color: devStatusColor("review"), value: stats.review, href: "/neander/dev/board?status=review" },
    { key: "done_week", label: "이번주 완료", icon: "✅", color: devStatusColor("done"), value: stats.doneThisWeek, href: "/neander/dev/board?status=done" },
    { key: "urgent", label: "긴급 미완료", icon: "🔴", color: devPriorityColor("urgent"), value: stats.urgentOpen, href: "/neander/dev/board?priority=urgent" },
  ];

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight text-zinc-900">
        안녕하세요{memberName ? `, ${memberName}님` : ""} 👋
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        지금 진행중{" "}
        <b className="font-semibold tabular-nums text-sky-600">{stats.inProgress}건</b>
        {" · "}오늘 마감{" "}
        <b className="font-semibold tabular-nums text-orange-600">{stats.dueToday}건</b>
        {" · "}리뷰 대기{" "}
        <b className="font-semibold tabular-nums text-amber-600">{stats.review}건</b>
        이에요.
      </p>

      {/* 요약 타일 — 클릭 시 보드 필터 프리셋으로 이동 */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-label={`${t.label} ${t.value}건 — 보드에서 보기`}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
              style={{ backgroundColor: `${t.color}1a` }}
            >
              {t.icon}
            </span>
            <div className="min-w-0">
              <div
                className="text-2xl font-bold leading-none tabular-nums"
                style={{ color: t.color }}
              >
                {t.value}
              </div>
              <div className="mt-1 truncate text-xs font-medium text-zinc-500">{t.label}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
