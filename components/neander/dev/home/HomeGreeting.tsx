"use client";

// ============================================================
//  개발허브 홈 ① — 인사 + 상태 문장 + 요약 타일
//  "안녕하세요, {이름}님" 아래에 오늘 기준 자동 요약 한 줄
//  ("지금 진행중 N건 · 오늘 마감 N건 · 리뷰 대기 N건")을 보여주고,
//  요약 타일 4개(클릭 → 보드 필터 딥링크)를 유지한다.
// ============================================================

import { useMemo } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Eye, Zap, type LucideIcon } from "lucide-react";
import { Icon, cn, toneCls, type Tone } from "@/components/neander/ui";
import { todayStr, weekKey } from "@/lib/neander/format";
import { type DevTask } from "@/lib/neander/dev/types";

type Tile = {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
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
    { key: "in_progress", label: "진행중", icon: Zap, tone: "info", value: stats.inProgress, href: "/neander/dev/board?status=in_progress" },
    { key: "review", label: "리뷰 대기", icon: Eye, tone: "warning", value: stats.review, href: "/neander/dev/board?status=review" },
    { key: "done_week", label: "이번주 완료", icon: CircleCheck, tone: "success", value: stats.doneThisWeek, href: "/neander/dev/board?status=done" },
    { key: "urgent", label: "긴급 미완료", icon: CircleAlert, tone: "danger", value: stats.urgentOpen, href: "/neander/dev/board?priority=urgent" },
  ];

  return (
    <section>
      <h2 className="text-nd-title text-nd-fg">
        안녕하세요{memberName ? `, ${memberName}님` : ""}
      </h2>
      <p className="mt-1 text-nd-body text-nd-fg-2">
        지금 진행중{" "}
        <b className="nd-num font-semibold text-nd-info-text">{stats.inProgress}건</b>
        {" · "}오늘 마감{" "}
        <b className="nd-num font-semibold text-nd-warning-text">{stats.dueToday}건</b>
        {" · "}리뷰 대기{" "}
        <b className="nd-num font-semibold text-nd-warning-text">{stats.review}건</b>
        이에요.
      </p>

      {/* 요약 타일 — 클릭 시 보드 필터 프리셋으로 이동 */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-label={`${t.label} ${t.value}건 — 보드에서 보기`}
            className="nd-surface flex items-center gap-3 rounded-nd-lg p-4 transition-colors duration-nd-fast hover:bg-nd-sunken focus:outline-none focus-visible:shadow-nd-focus"
          >
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-nd-md",
                toneCls[t.tone].soft,
                toneCls[t.tone].text,
              )}
            >
              <Icon icon={t.icon} size={20} />
            </span>
            <div className="min-w-0">
              <div className="nd-num text-[22px] font-bold leading-none tracking-[-0.02em] text-nd-fg">{t.value}</div>
              <div className="mt-1 truncate text-nd-caption font-medium text-nd-fg-2">{t.label}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
