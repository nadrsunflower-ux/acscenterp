"use client";

// ============================================================
//  프로젝트 꼬리표 — 이 돈이 어느 프로젝트에 쓰였나
// ------------------------------------------------------------
//  거래의 projectCode 를 프로젝트 마스터(neander_fin_projects)의 code 와
//  맞춰(대소문자·앞뒤 공백 무시 — project.ts ledgerRowsOf 와 같은 규칙)
//  이름으로 보여 준다. 누르면 그 프로젝트 화면으로 간다.
//
//  내역이 나오는 곳(미리보기·전체 내역 창·검토 대기함)마다 붙인다 — "이 지출은
//  행사 건이었다"가 금액 옆에 없으면 사람은 원장을 다시 뒤진다.
//  코드는 있는데 마스터에 없는 프로젝트도 숨기지 않는다 (오타·미등록 신호).
// ============================================================

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { cn, Icon } from "@/components/neander/ui";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import { useFinance } from "./FinanceProvider";

const codeKey = (c?: string) => (c ?? "").trim().toLowerCase();

/** 프로젝트 코드 → 프로젝트 (없으면 undefined) */
export function useProjectOf(): (code?: string) => FinProjectDoc | undefined {
  const { projects } = useFinance();
  const byCode = useMemo(
    () => new Map((projects ?? []).map((p) => [codeKey(p.code), p])),
    [projects],
  );
  return useCallback((code?: string) => byCode.get(codeKey(code)), [byCode]);
}

export function ProjectTag({ code, className }: { code?: string; className?: string }) {
  const projectOf = useProjectOf();
  if (!codeKey(code)) return null;
  const p = projectOf(code);
  const base =
    "inline-flex max-w-[14rem] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-nd-micro font-medium leading-5";

  if (!p) {
    return (
      <span
        title={`프로젝트 코드 ${code} — 프로젝트 목록에 없습니다 (오타이거나 아직 등록 전)`}
        className={cn(base, "border border-dashed border-nd-border text-nd-fg-3", className)}
      >
        <Icon icon={FolderOpen} size={11} />
        <span className="truncate">{code} · 미등록</span>
      </span>
    );
  }

  return (
    <Link
      href={`/neander/finance/projects/${p.id}`}
      // 표 줄·드릴 버튼의 클릭(창 열기·줄 선택)으로 번지지 않게
      onClick={(e) => e.stopPropagation()}
      title={[`프로젝트 ${p.name}`, p.code, p.client].filter(Boolean).join(" · ")}
      className={cn(
        base,
        "bg-nd-accent-soft text-nd-accent-strong transition-colors duration-nd-fast hover:bg-nd-accent/15 hover:underline",
        className,
      )}
    >
      <Icon icon={FolderOpen} size={11} />
      <span className="truncate">{p.name}</span>
    </Link>
  );
}
