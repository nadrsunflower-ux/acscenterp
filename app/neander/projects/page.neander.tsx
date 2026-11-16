"use client";

// ============================================================
//  프로젝트 워크스페이스 — 목록 (팀원 모두)
// ------------------------------------------------------------
//  행사 · 납품 건을 한곳에서 본다 — 상태 탭 → 검색 → 프로젝트 달력(기간 · 납기 · 장비 겹침) → 표.
//  금액 · 손익 · 수금은 싣지 않는다. 재무 권한이 있으면 「프로젝트 손익」 으로 가는 단추가 보인다.
//  데이터와 권한은 lib/neander/projects/view.ts 머리말.
// ============================================================
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronRight, FolderOpen, SearchX } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterField,
  Icon,
  LoadingState,
  PageHeader,
  PageShell,
  SearchInput,
  Table,
  TableScroll,
  Tabs,
  Td,
  Th,
  type Tone,
  Tr,
  buttonClass,
  cn,
  useStickyState,
} from "@/components/neander/ui";
import { DeliveryDate } from "@/components/neander/finance/DeliveryDate";
import { ProjectCalendar } from "@/components/neander/finance/ProjectCalendar";
import { mdRange } from "@/components/neander/finance/EquipmentFields";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, isDimmedProjectStatus, type ProjectStatus } from "@/lib/neander/finance/project";
import { equipmentText, hasEquipment } from "@/lib/neander/finance/equipment";
import { patchProjectEquipment } from "@/lib/neander/projects/client";
import { useProjects } from "@/lib/neander/projects/useProjects";

/** 상태 → 의미 색 (재무 › 프로젝트 손익과 같음) */
const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: "neutral",
  hold: "neutral",
  active: "accent",
  done: "success",
  cancelled: "danger",
};

export default function ProjectsPage() {
  const router = useRouter();
  const { projects, financeAccess, loading, error, refresh } = useProjects();
  const [status, setStatus] = useStickyState<ProjectStatus | "all">("projects.status", "planning");
  const [q, setQ] = useState("");

  const tabs = useMemo(
    () => [
      { key: "all", label: "전체", badge: projects.length },
      ...PROJECT_STATUSES.map((st) => ({ key: st, label: PROJECT_STATUS_LABEL[st], badge: projects.filter((p) => p.status === st).length })),
    ],
    [projects],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => status === "all" || p.status === status)
      .filter((p) => !needle || [p.name, p.code, p.client ?? ""].some((s) => s.toLowerCase().includes(needle)));
  }, [projects, status, q]);
  const calendarProjects = useMemo(() => rows.filter((p) => p.status !== "cancelled"), [rows]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState description={error} />;

  const open = (id: string) => router.push(`/neander/projects/${id}`);

  return (
    <PageShell width="wide">
      <PageHeader
        title="프로젝트"
        description="행사 · 납품 건의 일정 · 장비 · 남은 일 · 메모를 팀이 함께 봅니다. 금액 · 손익은 재무 › 프로젝트 손익에서 봅니다."
        className="mb-4"
        actions={
          financeAccess ? (
            <Link href="/neander/finance/projects" className={buttonClass("secondary", "md")}>
              프로젝트 손익 <Icon icon={ArrowUpRight} size={15} />
            </Link>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <EmptyState icon={FolderOpen} title="아직 프로젝트가 없습니다" description="프로젝트는 재무 › 프로젝트 손익에서 만듭니다." />
      ) : (
        <>
          <Tabs className="mb-3" ariaLabel="프로젝트 상태" value={status} onChange={(k) => setStatus(k as ProjectStatus | "all")} items={tabs} />
          <FilterBar className="mb-4">
            <FilterField label="검색" htmlFor="projects-q" className="w-full max-w-full basis-full sm:w-auto sm:basis-auto">
              <SearchInput id="projects-q" className="w-full sm:w-64" value={q} onValueChange={setQ} placeholder="프로젝트명 · 코드 · 발주처" ariaLabel="프로젝트 검색" />
            </FilterField>
          </FilterBar>

          <ProjectCalendar
            className="mb-4"
            projects={calendarProjects}
            allProjects={projects}
            onChanged={refresh}
            saveEquipment={patchProjectEquipment}
            detailHref={(id) => `/neander/projects/${id}`}
          />

          <Card as="section" aria-label="프로젝트 목록" padding="none" className="min-w-0">
            {rows.length === 0 ? (
              <EmptyState icon={SearchX} title="조건에 맞는 프로젝트가 없습니다" className="py-10" />
            ) : (
              <TableScroll>
                <Table minWidth={980} aria-label="프로젝트 목록">
                  <thead>
                    <tr>
                      <Th sticky="left" className="pl-5">프로젝트</Th>
                      <Th>발주처</Th>
                      <Th>상태</Th>
                      <Th>진행 기간</Th>
                      <Th>납기</Th>
                      <Th>장비</Th>
                      <Th align="right">남은 일</Th>
                      <Th className="pr-5"><span className="sr-only">상세</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const left = (p.todos ?? []).filter((t) => !t.done).length;
                      return (
                        <Tr
                          key={p.id}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a")) return;
                            open(p.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") open(p.id);
                          }}
                          tabIndex={0}
                          role="link"
                          aria-label={`${p.name} 상세`}
                          className={cn("cursor-pointer focus:bg-nd-accent-soft/60 focus:outline-none", isDimmedProjectStatus(p.status) && "opacity-45 transition-opacity hover:opacity-90 focus:opacity-100")}
                        >
                          <Td sticky="left" className="py-3 pl-5">
                            <Link href={`/neander/projects/${p.id}`} className="block max-w-[28rem] truncate font-medium text-nd-fg hover:underline">
                              {p.name}
                            </Link>
                            <span className="text-nd-caption text-nd-fg-3">{p.code}</span>
                          </Td>
                          <Td className="max-w-[14rem] truncate py-3 text-nd-fg-2">{p.client || "—"}</Td>
                          <Td className="whitespace-nowrap py-3">
                            <Badge tone={PROJECT_STATUS_TONE[p.status]} dot>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                          </Td>
                          <Td className="whitespace-nowrap py-3 text-nd-fg-2">
                            {p.startDate || p.endDate ? mdRange(p.startDate ?? p.endDate!, p.endDate ?? p.startDate!) : "—"}
                          </Td>
                          <Td className="py-3 text-nd-caption text-nd-fg-2">
                            <DeliveryDate project={p} />
                          </Td>
                          <Td className={cn("whitespace-nowrap py-3", hasEquipment(p.equipment) ? "text-nd-fg-2" : "text-nd-fg-4")}>
                            {hasEquipment(p.equipment) ? equipmentText(p.equipment) : "—"}
                          </Td>
                          <Td num className="py-3">{left > 0 ? `${left}건` : <span className="text-nd-fg-4">—</span>}</Td>
                          <Td className="pr-5"><Icon icon={ChevronRight} size={16} className="text-nd-fg-3" /></Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}
