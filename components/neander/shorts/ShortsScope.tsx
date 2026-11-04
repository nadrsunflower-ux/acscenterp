"use client";

// 쇼츠 화면 위쪽 툴바 —
//  「프로젝트」: 어느 채널(AI STUDIO 프로젝트 · spaces.ts)의 기획 · 영상 · 게시 · 성과를 볼지 (ShortsProvider 의 space)
//  「보기」: 누구의 것을 볼지 (viewer) — 내 것 · 볼 수 있는 전체(관리자는 모든 사용자) · 사람별. 관리자가 아니면 남의 것은 팀 공개만 보인다.

import { useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, Users } from "lucide-react";
import { Select } from "@/components/neander/ui";
import { ToolbarPortal, useShellOptional } from "@/components/neander/shell/context";
import { useAppData } from "@/components/neander/app-data";
import { isSpaceRunning, spaceKind } from "@/lib/neander/shorts/spaces";
import { useShorts } from "./ShortsProvider";

const MANAGE = "__manage";

/**
 * 오른쪽에 비서(AI STUDIO 비서 · 공용 AssistantChat)를 도킹하면 셸이 그 폭을 내줘 툴바가 좁아진다 —
 * 그때는 「프로젝트」 · 「보기」 글자를 숨기고(아이콘 · 읽기 프로그램용 이름은 남긴다) 고르기 칸을 줄여
 * 툴바 맨 끝의 비서 단추가 밀려나지 않게 한다.
 */
const useDocked = () => (useShellOptional()?.dockWidth ?? 0) > 0;

/** 툴바 자리(데스크톱) 또는 띠 안(모바일 · inline — 라벨을 위에 두고 칸을 꽉 채운다) */
function Slot({ inline, order, label, icon: I, children }: { inline?: boolean; order: number; label: string; icon: typeof Users; children: ReactNode }) {
  const docked = useDocked();
  if (inline)
    return (
      <label className="flex min-w-0 flex-col gap-1 text-[13px] text-nd-fg-3">
        <span className="flex items-center gap-1">
          <I size={14} aria-hidden />
          {label}
        </span>
        {children}
      </label>
    );
  return (
    <ToolbarPortal order={order}>
      <label className="flex items-center gap-1.5 text-[13px] text-nd-fg-2">
        <I size={14} aria-hidden />
        <span className={docked ? "sr-only" : "sr-only sm:not-sr-only"}>{label}</span>
        {children}
      </label>
    </ToolbarPortal>
  );
}

/** 프로젝트 고르기 — 맨 아래 「프로젝트 관리 · 새 프로젝트」 */
export function ShortsSpaceSwitch({ inline = false }: { inline?: boolean } = {}) {
  const { data, space, setSpace } = useShorts();
  const router = useRouter();
  const docked = useDocked();
  const list = (data?.spaces ?? []).filter((x) => !x.archived);
  // 채널이 아직 없는 프로젝트는 이름 뒤에 「준비 중」 — 실제로 돌고 있는 채널과 섞여 보이지 않게 (spaces.ts)
  const accounts = data?.accounts ?? [];
  const label = (x: (typeof list)[number]) => (isSpaceRunning(x, accounts) ? x.name : `${x.name} · 준비 중`);
  // 대행은 업체마다 묶어서 (업체 이름순)
  const agencyGroups = [...new Set(list.filter((x) => spaceKind(x) === "agency").map((x) => x.clientId ?? ""))]
    .map((clientId) => ({ clientId, name: data?.clients.find((c) => c.id === clientId)?.name ?? "업체", spaces: list.filter((x) => spaceKind(x) === "agency" && (x.clientId ?? "") === clientId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <Slot inline={inline} order={3} label="프로젝트" icon={FolderKanban}>
        <Select
          size="sm"
          aria-label="AI STUDIO 프로젝트"
          value={space}
          onChange={(e) => (e.target.value === MANAGE ? router.push("/neander/shorts/spaces") : setSpace(e.target.value))}
          className={inline ? "w-full min-w-0 font-medium" : docked ? "w-auto max-w-[160px] font-medium" : "w-auto max-w-[200px] font-medium lg:max-w-[240px]"}
        >
          <optgroup label="자체 운영">
            {list
              .filter((x) => spaceKind(x) === "own")
              .sort((a, b) => Number(isSpaceRunning(b, accounts)) - Number(isSpaceRunning(a, accounts)))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {label(x)}
                </option>
              ))}
          </optgroup>
          {agencyGroups.map((g) => (
            <optgroup key={g.clientId} label={`대행 · ${g.name}`}>
              {g.spaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {label(x)}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={MANAGE}>프로젝트 관리 · 새 프로젝트…</option>
        </Select>
    </Slot>
  );
}

export function ShortsScope({ inline = false }: { inline?: boolean } = {}) {
  const { data, viewer, setViewer, nameOf } = useShorts();
  const { members } = useAppData();
  const docked = useDocked();
  const d = data!;
  const people = useMemo(() => {
    const emails = new Set<string>(members.map((m) => (m.email ?? "").toLowerCase()).filter(Boolean));
    for (const x of [...d.projects, ...d.trends, ...d.accounts]) emails.add(x.owner);
    emails.delete(d.me);
    return [...emails].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko"));
  }, [members, d, nameOf]);
  return (
    <Slot inline={inline} order={4} label="보기" icon={Users}>
        <Select size="sm" aria-label="누구의 것을 볼지" value={viewer} onChange={(e) => setViewer(e.target.value)} className={inline ? "w-full min-w-0" : docked ? "w-auto max-w-[140px]" : "w-auto max-w-[200px]"}>
          <option value="mine">내 것 ({nameOf(d.me)})</option>
          <option value="visible">{d.admin ? "모든 사용자 (관리자)" : "볼 수 있는 전체 (팀 공개 포함)"}</option>
          {people.map((e) => (
            <option key={e} value={e}>
              {nameOf(e)}
              {d.admin ? "" : " (팀 공개만)"}
            </option>
          ))}
        </Select>
    </Slot>
  );
}
