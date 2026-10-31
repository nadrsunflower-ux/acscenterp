"use client";

// 「보기」 — 쇼츠 화면 위쪽 툴바에서 누구의 것을 볼지 고른다 (ShortsProvider 의 viewer)
//  내 것 · 볼 수 있는 전체(관리자는 모든 사용자) · 사람별. 관리자가 아니면 남의 것은 팀 공개만 보인다.

import { useMemo } from "react";
import { Users } from "lucide-react";
import { Select } from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useAppData } from "@/components/neander/app-data";
import { useShorts } from "./ShortsProvider";

export function ShortsScope() {
  const { data, viewer, setViewer, nameOf } = useShorts();
  const { members } = useAppData();
  const d = data!;
  const people = useMemo(() => {
    const emails = new Set<string>(members.map((m) => (m.email ?? "").toLowerCase()).filter(Boolean));
    for (const x of [...d.projects, ...d.trends, ...d.accounts]) emails.add(x.owner);
    emails.delete(d.me);
    return [...emails].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko"));
  }, [members, d, nameOf]);
  return (
    <ToolbarPortal order={4}>
      <label className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
        <Users size={14} aria-hidden />
        <span className="sr-only sm:not-sr-only">보기</span>
        <Select size="sm" aria-label="누구의 것을 볼지" value={viewer} onChange={(e) => setViewer(e.target.value)} className="w-auto max-w-[180px]">
          <option value="mine">내 것 ({nameOf(d.me)})</option>
          <option value="visible">{d.admin ? "모든 사용자 (관리자)" : "볼 수 있는 전체 (팀 공개 포함)"}</option>
          {people.map((e) => (
            <option key={e} value={e}>
              {nameOf(e)}
              {d.admin ? "" : " (팀 공개만)"}
            </option>
          ))}
        </Select>
      </label>
    </ToolbarPortal>
  );
}
