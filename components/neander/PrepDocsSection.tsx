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
import { Play } from "lucide-react";
import {
  Badge,
  Card,
  Icon,
  MemberAvatar,
  SectionHeader,
  SegmentedControl,
  type SegmentOption,
} from "@/components/neander/ui";
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

  // 발표자 탭 — 같은 목록을 발표자별로 보는 전환
  const options: SegmentOption<string>[] = authors.map((name) => {
    const m = members.find((x) => x.name === name);
    return {
      value: name,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <MemberAvatar name={name} color={m?.color} avatar={m?.avatar} className="h-4 w-4 text-[9px]" />
          {name}
        </span>
      ),
    };
  });

  return (
    <Card className="mb-6">
      <SectionHeader
        title="회의 준비 자료"
        hint="웹 기반 16:9 발표자료 — 회의 전 브리핑용"
        action={<SegmentedControl options={options} value={author} onChange={setAuthor} size="sm" ariaLabel="발표자" />}
      />

      <ul className="flex flex-col divide-y divide-nd-line">
        {docs.map((d) => (
          <li key={d.slug}>
            <Link
              href={prepDocHref(d)}
              className="group -mx-2 flex items-center gap-3 rounded-nd-md px-2 py-2.5 transition-colors duration-nd-fast hover:bg-nd-sunken focus:outline-none focus-visible:shadow-nd-focus"
            >
              {/* 자료 포인트 색은 데이터(accent) — 없으면 accent 톤 */}
              <Badge tone="accent" color={d.accent} className="nd-num shrink-0">
                {formatDateKo(d.date)}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-nd-body font-semibold text-nd-fg" title={d.title}>
                  {d.title}
                </div>
                {d.summary && (
                  <div className="mt-0.5 truncate text-nd-caption text-nd-fg-3" title={d.summary}>
                    {d.summary}
                  </div>
                )}
              </div>
              <span className="inline-flex h-ctl-sm shrink-0 items-center gap-1 rounded-[8px] bg-nd-inverse px-2.5 text-[13px] font-semibold text-white transition-colors duration-nd-fast group-hover:bg-nd-fg-2">
                <Icon icon={Play} size={12} />
                <span className="hidden sm:inline">발표 보기</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
