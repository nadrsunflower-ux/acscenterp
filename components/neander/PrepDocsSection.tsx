"use client";

// ============================================================
//  회의 준비 자료 섹션 — /neander/meetings 상단
// ------------------------------------------------------------
//  lib/neander/prep-docs.ts 에 등록된 웹 발표자료(16:9 브리핑)를
//  발표자별 탭으로 보여준다. 자료 자체가 코드(슬라이드 페이지)라
//  배포와 함께 자동으로 이 목록에 나타난다.
// ============================================================
import { useState } from "react";
import Link from "next/link";
import { Card, Badge, MemberAvatar, cn } from "@/components/neander/ui";
import {
  prepDocAuthors,
  prepDocsByAuthor,
  prepDocHref,
} from "@/lib/neander/prep-docs";
import { formatDateKo } from "@/lib/neander/format";

export function PrepDocsSection({
  members,
}: {
  members: { id: string; name: string; color?: string; avatar?: string }[];
}) {
  const authors = prepDocAuthors();
  const [author, setAuthor] = useState(authors[0] ?? "");

  if (authors.length === 0) return null;
  const docs = prepDocsByAuthor(author);

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">회의 준비 자료</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            웹 기반 16:9 발표자료 — 회의 전 브리핑용. 코드로 관리되어 팀 전체가 열람할 수 있습니다.
          </p>
        </div>

        {/* 발표자 탭 */}
        <div className="flex flex-wrap gap-1.5">
          {authors.map((name) => {
            const m = members.find((x) => x.name === name);
            const on = name === author;
            return (
              <button
                key={name}
                onClick={() => setAuthor(name)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                  on
                    ? "border-zinc-800 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                <MemberAvatar
                  name={name}
                  color={m?.color}
                  avatar={m?.avatar}
                  className="h-5 w-5 text-[10px]"
                />
                {name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {docs.map((d) => (
          <Link
            key={d.slug}
            href={prepDocHref(d)}
            className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 transition hover:border-zinc-400 hover:bg-white"
          >
            <Badge color={d.accent ?? "#6366f1"}>{formatDateKo(d.date)}</Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-zinc-900">{d.title}</div>
              {d.summary && (
                <div className="mt-0.5 truncate text-xs text-zinc-400">{d.summary}</div>
              )}
            </div>
            <span className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition group-hover:bg-zinc-700">
              발표 보기 →
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
