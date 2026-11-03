"use client";

// 쇼츠 화면 위쪽 툴바 —
//  「프로젝트」: 어느 채널(AI STUDIO 프로젝트 · spaces.ts)의 기획 · 영상 · 게시 · 성과를 볼지 (ShortsProvider 의 space)
//  「보기」: 누구의 것을 볼지 (viewer) — 내 것 · 볼 수 있는 전체(관리자는 모든 사용자) · 사람별. 관리자가 아니면 남의 것은 팀 공개만 보인다.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, Users } from "lucide-react";
import { Select } from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useAppData } from "@/components/neander/app-data";
import { spaceKind } from "@/lib/neander/shorts/spaces";
import { useShorts } from "./ShortsProvider";

const MANAGE = "__manage";

/** 프로젝트 고르기 — 맨 아래 「프로젝트 관리 · 새 프로젝트」 */
export function ShortsSpaceSwitch() {
  const { data, space, setSpace } = useShorts();
  const router = useRouter();
  const list = (data?.spaces ?? []).filter((x) => !x.archived);
  // 대행은 업체마다 묶어서 (업체 이름순)
  const agencyGroups = [...new Set(list.filter((x) => spaceKind(x) === "agency").map((x) => x.clientId ?? ""))]
    .map((clientId) => ({ clientId, name: data?.clients.find((c) => c.id === clientId)?.name ?? "업체", spaces: list.filter((x) => spaceKind(x) === "agency" && (x.clientId ?? "") === clientId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <ToolbarPortal order={3}>
      <label className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
        <FolderKanban size={14} aria-hidden />
        <span className="sr-only sm:not-sr-only">프로젝트</span>
        <Select
          size="sm"
          aria-label="AI STUDIO 프로젝트"
          value={space}
          onChange={(e) => (e.target.value === MANAGE ? router.push("/neander/shorts/spaces") : setSpace(e.target.value))}
          className="w-auto max-w-[118px] font-medium sm:max-w-[200px]"
        >
          <optgroup label="자체 운영">
            {list
              .filter((x) => spaceKind(x) === "own")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </optgroup>
          {agencyGroups.map((g) => (
            <optgroup key={g.clientId} label={`대행 · ${g.name}`}>
              {g.spaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={MANAGE}>프로젝트 관리 · 새 프로젝트…</option>
        </Select>
      </label>
    </ToolbarPortal>
  );
}

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
        <Select size="sm" aria-label="누구의 것을 볼지" value={viewer} onChange={(e) => setViewer(e.target.value)} className="w-auto max-w-[104px] sm:max-w-[180px]">
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
