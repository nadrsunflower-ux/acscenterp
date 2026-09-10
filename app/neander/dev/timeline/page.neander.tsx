"use client";

// ============================================================
//  진행 소식 — 개발 진행 피드 (/neander/dev/timeline)
//  좌측 고정 컬럼(작성기+필터) + 우측 피드의 전체폭 2패널.
//  피드는 날짜 그룹(오늘/어제/이번 주/그 이전)으로 묶고,
//  고정(핀) 항목은 별도 그룹으로 항상 맨 위에 노출한다.
// ============================================================

import { useMemo, useState } from "react";
import { Archive, CalendarDays, Megaphone, Moon, Pin, Search, Sun, type LucideIcon } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useDevData } from "@/components/neander/dev/dev-data";
import { ActivityComposer } from "@/components/neander/dev/ActivityComposer";
import { ActivityItem } from "@/components/neander/dev/ActivityItem";
import { Card, Icon, Input, LoadingState, SectionHeader, Select, EmptyState } from "@/components/neander/ui";
import { todayStr, addDays, weekKey, formatDateKo } from "@/lib/neander/format";
import type { DevActivity } from "@/lib/neander/dev/types";

/** epoch(ms) -> 로컬 "YYYY-MM-DD" (todayStr 과 동일한 로컬 기준) */
function localDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type GroupKey = "pinned" | "today" | "yesterday" | "thisWeek" | "earlier";
const GROUP_ORDER: GroupKey[] = ["pinned", "today", "yesterday", "thisWeek", "earlier"];

export default function TimelinePage() {
  const { members } = useAppData();
  const { activity, features, featureById, loading } = useDevData();

  const [featureFilter, setFeatureFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activity.filter((a) => {
      if (featureFilter !== "all" && a.featureId !== featureFilter) return false;
      if (authorFilter !== "all" && a.authorId !== authorFilter) return false;
      // 제목/본문 텍스트 검색 (AND)
      if (q) {
        const hay = `${a.title} ${a.body ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activity, featureFilter, authorFilter, search]);

  // 날짜 그룹핑 — 구독이 이미 createdAt desc 라 그룹 내부는 최신순 유지
  const today = todayStr();
  const yesterday = addDays(today, -1);
  const groups = useMemo(() => {
    const thisWeek = weekKey(Date.now());
    const map: Record<GroupKey, DevActivity[]> = {
      pinned: [],
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: [],
    };
    for (const a of filtered) {
      if (a.pinned) {
        map.pinned.push(a);
        continue;
      }
      const d = localDateStr(a.createdAt);
      if (d === today) map.today.push(a);
      else if (d === yesterday) map.yesterday.push(a);
      else if (weekKey(a.createdAt) === thisWeek) map.thisWeek.push(a);
      else map.earlier.push(a);
    }
    return map;
  }, [filtered, today, yesterday]);

  const groupMeta: Record<GroupKey, { icon: LucideIcon; label: string; sub?: string }> = {
    pinned: { icon: Pin, label: "고정된 소식" },
    today: { icon: Sun, label: "오늘", sub: formatDateKo(today) },
    yesterday: { icon: Moon, label: "어제", sub: formatDateKo(yesterday) },
    thisWeek: { icon: CalendarDays, label: "이번 주" },
    earlier: { icon: Archive, label: "그 이전" },
  };

  const hasAny = activity.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 화면 한 줄 설명 (H1 은 dev layout 이 담당) */}
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={Megaphone} size={16} className="text-nd-fg-3" />
            진행 소식
          </span>
        }
        hint="팀이 무엇을 진행했는지 시간순으로 — 소식을 게시하면 팀 메신저에도 전달됩니다."
      />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr] lg:gap-6 [&>*]:min-w-0">
        {/* 좌측 고정 컬럼: 작성기 + 필터 */}
        <div className="flex flex-col gap-4 self-start lg:sticky lg:top-4">
          <ActivityComposer />

          <Card padding="sm">
            <SectionHeader
              as="h3"
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Icon icon={Search} size={14} className="text-nd-fg-3" />
                  필터
                </span>
              }
            />
            <div className="flex flex-col gap-2">
              <Input
                size="sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="제목·본문 검색…"
                aria-label="진행 소식 검색"
              />
              <Select
                size="sm"
                value={featureFilter}
                onChange={(e) => setFeatureFilter(e.target.value)}
                aria-label="프로젝트 필터"
              >
                <option value="all">전체 프로젝트</option>
                {features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Select
                size="sm"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                aria-label="작성자 필터"
              >
                <option value="all">전체 작성자</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
              <p className="flex justify-end text-nd-caption text-nd-fg-3">
                {loading ? <LoadingState size="inline" /> : <span className="nd-num">{filtered.length}개 표시 중</span>}
              </p>
            </div>
          </Card>
        </div>

        {/* 우측: 피드 (날짜 그룹) */}
        <div className="flex min-w-0 flex-col gap-5">
          {!loading && !hasAny ? (
            <EmptyState
              icon={Megaphone}
              title="아직 올라온 진행 소식이 없어요"
              description="왼쪽 작성기에서 오늘 진행한 일을 첫 소식으로 올려보세요. 게시하면 팀 메신저에도 함께 전달됩니다."
            />
          ) : !loading && filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="조건에 맞는 소식이 없어요"
              description="검색어를 지우거나 프로젝트·작성자 필터를 '전체'로 되돌려 보세요."
            />
          ) : (
            GROUP_ORDER.map((key) => {
              const rows = groups[key];
              if (rows.length === 0) return null;
              const meta = groupMeta[key];
              return (
                <section key={key}>
                  {/* sticky 그룹 헤더 */}
                  <div className="nd-glass sticky top-0 z-nd-sticky -mx-1 mb-2 flex items-center gap-2 rounded-nd-md px-2 py-1.5">
                    <Icon icon={meta.icon} size={14} className="text-nd-fg-3" />
                    <h2 className="text-nd-body font-semibold text-nd-fg">{meta.label}</h2>
                    {meta.sub && <span className="text-nd-micro text-nd-fg-3">{meta.sub}</span>}
                    <span className="nd-num ml-auto text-nd-micro text-nd-fg-3">{rows.length}건</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {rows.map((a) => (
                      <ActivityItem key={a.id} activity={a} feature={featureById(a.featureId)} />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
