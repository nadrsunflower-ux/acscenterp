"use client";

// ============================================================
//  개발허브 홈 ③ — "최근 변화" (진행 소식 다이제스트)
//  activity 최근 8개를 오늘/어제/이번 주(그 이전)로 그룹핑해 표시.
//  마지막 방문(localStorage) 이후 새 소식 개수 배지도 여기서 관리.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, MemberAvatar, EmptyState } from "@/components/neander/ui";
import { FeatureChip } from "@/components/neander/dev/atoms";
import { formatTimestamp, sameDay, weekKey } from "@/lib/neander/format";
import type { DevActivity, DevFeature } from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";
import { SectionHeader } from "./SectionHeader";

/** 대시보드 '읽지 않음' 팔로업 기준 시각(epoch ms) localStorage 키 */
const LAST_SEEN_KEY = "neander_dev_last_seen";

const DIGEST_SIZE = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

type Bucket = { key: string; label: string; items: DevActivity[] };

export function RecentDigest({
  activity,
  members,
  featureById,
}: {
  activity: DevActivity[];
  members: Member[];
  featureById: (id?: string) => DevFeature | undefined;
}) {
  // ── 오늘/어제/이번 주 그룹핑 (최근 8개만) ──
  const buckets = useMemo<Bucket[]>(() => {
    const now = Date.now();
    const out: Bucket[] = [
      { key: "today", label: "오늘", items: [] },
      { key: "yesterday", label: "어제", items: [] },
      { key: "week", label: "이번 주", items: [] },
      { key: "older", label: "그 이전", items: [] },
    ];
    for (const a of activity.slice(0, DIGEST_SIZE)) {
      if (sameDay(a.createdAt, now)) out[0].items.push(a);
      else if (sameDay(a.createdAt, now - DAY_MS)) out[1].items.push(a);
      else if (weekKey(a.createdAt) === weekKey(now)) out[2].items.push(a);
      else out[3].items.push(a);
    }
    return out.filter((b) => b.items.length > 0);
  }, [activity]);

  // ── 읽지 않음 팔로업: last_seen 이후 생성된 activity 수 ──
  // SSR 안전: 초기값 null(마운트 전엔 세지 않음). 마운트 시 localStorage 의
  // 기준 시각을 고정하고, 잠깐 뒤 now 로 갱신한다.
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [seenLoaded, setSeenLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let baseline: number | null = null;
    try {
      const raw = window.localStorage.getItem(LAST_SEEN_KEY);
      baseline = raw ? Number(raw) : null;
      if (baseline !== null && Number.isNaN(baseline)) baseline = null;
    } catch {
      baseline = null;
    }
    setLastSeen(baseline);
    setSeenLoaded(true);
    // 방문 기록 갱신은 잠깐 뒤에(이번 세션 배지는 위 baseline 으로 유지).
    const now = Date.now();
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(LAST_SEEN_KEY, String(now));
      } catch {
        /* localStorage 접근 불가 시 무시 */
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  const newCount = useMemo(() => {
    if (!seenLoaded || lastSeen === null) return 0;
    return activity.filter((a) => a.createdAt > lastSeen).length;
  }, [activity, lastSeen, seenLoaded]);

  const showNews = seenLoaded && !dismissed && newCount > 0;

  const markSeen = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch {
      /* 무시 */
    }
  };

  return (
    <section>
      <SectionHeader
        icon="📣"
        title="최근 변화"
        description="오늘·어제·이번 주에 올라온 진행 소식을 간추렸어요."
        action={
          <div className="flex items-center gap-2">
            {showNews && (
              <button
                type="button"
                onClick={markSeen}
                aria-label={`새 소식 ${newCount}개 읽음 처리`}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
                </span>
                새 소식 {newCount}개
              </button>
            )}
            <Link
              href="/neander/dev/timeline"
              onClick={markSeen}
              className="text-xs font-medium text-indigo-600 hover:underline"
            >
              전체 보기 →
            </Link>
          </div>
        }
      />

      <Card className="!rounded-2xl">
        {buckets.length === 0 ? (
          <EmptyState
            icon="📣"
            title="아직 올라온 진행 소식이 없어요"
            description="'진행 소식' 탭에서 첫 업데이트를 올리면 팀 전체가 여기서 볼 수 있어요."
          />
        ) : (
          <div className="flex flex-col gap-1">
            {buckets.map((b) => (
              <div key={b.key}>
                <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {b.label}
                </div>
                <ul className="flex flex-col divide-y divide-zinc-100">
                  {b.items.map((a) => (
                    <ActivityRow
                      key={a.id}
                      activity={a}
                      author={members.find((m) => m.id === a.authorId)}
                      feature={featureById(a.featureId)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function ActivityRow({
  activity: a,
  author,
  feature,
}: {
  activity: DevActivity;
  author?: Member;
  feature?: DevFeature;
}) {
  // 연결된 작업이 있으면 보드 상세 모달로(계약: board?task=<id>), 없으면 진행 소식.
  const href = a.taskId ? `/neander/dev/board?task=${a.taskId}` : "/neander/dev/timeline";
  const featureName = feature?.name ?? a.featureName;
  return (
    <li>
      <Link
        href={href}
        aria-label={`${a.title} — ${a.taskId ? "작업 보기" : "진행 소식 보기"}`}
        className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        <MemberAvatar
          name={a.authorName}
          color={author?.color ?? "#71717a"}
          avatar={author?.avatar}
          className="h-7 w-7 text-[11px]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{a.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-[11px] text-zinc-400">{a.authorName}</span>
            {featureName && (
              <FeatureChip feature={feature} name={featureName} className="!py-0" />
            )}
          </div>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
          {formatTimestamp(a.createdAt)}
        </span>
      </Link>
    </li>
  );
}
