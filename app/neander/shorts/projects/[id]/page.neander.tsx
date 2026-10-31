"use client";

// ============================================================
//  제작 프로젝트 — 영상 한 편의 전 과정을 탭으로
// ------------------------------------------------------------
//  소스 → 쿠팡 확인 → 공식·대본 → 편집·출력 → 게시 → 성과. 탭은 흐름 순서다.
//  고친 것은 저절로 저장된다 (useProjectDraft). 서버 동작(AI · 조사 · 작업)은
//  남은 변경을 먼저 저장한 뒤 부르고, 돌아온 최신 프로젝트로 바꿔 끼운다.
// ============================================================

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, InlineNotice, Input, PageShell, Select, Tabs, useConfirm } from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { isReadOnlyFor, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { useBlobUrl } from "@/components/neander/shorts/media";
import { useProjectDraft } from "@/components/neander/shorts/useProjectDraft";
import { useAction } from "@/components/neander/shorts/parts";
import { SourcesTab } from "@/components/neander/shorts/project/SourcesTab";
import { CoupangTab } from "@/components/neander/shorts/project/CoupangTab";
import { ScriptTab } from "@/components/neander/shorts/project/ScriptTab";
import { EditorTab } from "@/components/neander/shorts/project/EditorTab";
import { PublishTab } from "@/components/neander/shorts/project/PublishTab";
import { PerformanceTab } from "@/components/neander/shorts/project/PerformanceTab";
import { ClientInfoTab, ReviewTab } from "@/components/neander/shorts/project/ClientTabs";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, STAGE_LABEL, confirmedCandidate, renderBlockers } from "@/lib/neander/shorts/model";
import type { ProjectDoc, ProjectStage } from "@/lib/neander/shorts/types";

const TABS = ["sources", "coupang", "client", "script", "edit", "review", "publish", "perf"] as const;
type TabKey = (typeof TABS)[number];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useShorts();
  const project = data!.projects.find((p) => p.id === id);
  if (!project) {
    return (
      <PageShell>
        <EmptyState title="영상을 찾지 못했습니다" description="지워졌거나, 다른 사람의 비공개 영상입니다." action={<Link href="/neander/shorts/projects"><Button variant="secondary">목록으로</Button></Link>} />
      </PageShell>
    );
  }
  return (
    <Suspense>
      <ProjectWorkspace key={project.id} initial={project} />
    </Suspense>
  );
}

function ProjectWorkspace({ initial }: { initial: WithId<ProjectDoc> }) {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const router = useRouter();
  const search = useSearchParams();
  const ask = useConfirm();
  const { run } = useAction();
  const readOnly = isReadOnlyFor(initial, d.me);
  const draft = useProjectDraft(initial, readOnly);
  const { p, update, state, error, reloadLatest } = draft;
  useCrumbTail(p.title);
  const brand = initial.kind === "brand";
  const wanted = search.get("tab") ?? "";
  // 고객사 영상은 「쿠팡 확인」 대신 「고객사」 · 「고객 승인」
  const allowed = (k: string) => (TABS as readonly string[]).includes(k) && (brand ? k !== "coupang" : k !== "client" && k !== "review");
  const tab = allowed(wanted) ? (wanted as TabKey) : brand ? "client" : "sources";
  const setTab = (k: string) => router.replace(`/neander/shorts/projects/${p.id}?tab=${k}`, { scroll: false });
  const isOwner = p.owner === d.me;

  const tabs = useMemo(() => {
    const confirmed = !!confirmedCandidate(p);
    const blockers = renderBlockers(p).length;
    const pubs = d.publications.filter((x) => x.projectId === p.id);
    const edit = { key: "edit", label: "편집·출력", hint: p.renderIds.length ? `완성 ${p.renderIds.length}` : p.scenes.length ? `장면 ${p.scenes.length}${blockers ? " · 확인" : ""}` : undefined };
    const rest = [
      { key: "publish", label: "게시", hint: pubs.length ? String(pubs.length) : undefined },
      { key: "perf", label: "성과" },
    ];
    if (p.kind === "brand") {
      return [
        { key: "client", label: "고객사", hint: p.clientName },
        { key: "sources", label: "소스", hint: p.sources.length ? String(p.sources.length) : undefined },
        { key: "script", label: "공식·대본", hint: p.script.lines.length ? `${p.script.lines.length}줄` : undefined },
        edit,
        { key: "review", label: "고객 승인", hint: REVIEW_LABEL[p.review.state] },
        ...rest,
      ];
    }
    return [
      { key: "sources", label: "소스", hint: String(p.sources.length) },
      { key: "coupang", label: "쿠팡 확인", hint: confirmed ? "확인" : p.coupang.candidates.length ? `후보 ${p.coupang.candidates.length}` : undefined },
      { key: "script", label: "공식·대본", hint: p.script.lines.length ? `${p.script.lines.length}줄` : undefined },
      edit,
      ...rest,
    ];
  }, [p, d.publications]);

  const saveLabel = state === "saving" ? "저장 중…" : state === "dirty" ? "고친 내용 저장 대기" : state === "saved" ? "저장됨" : state === "conflict" ? "충돌" : "저장 실패";

  return (
    <PageShell>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/neander/shorts/projects" className="mb-1 inline-flex items-center gap-1 text-nd-caption text-nd-fg-3 hover:text-nd-fg">
            <ChevronLeft size={14} /> {p.kind === "brand" ? `영상 · ${p.clientName}` : "영상"}
          </Link>
          <Input
            aria-label="영상 제목"
            value={p.title}
            onChange={(e) => update((x) => void (x.title = e.target.value))}
            className="h-auto border-transparent bg-transparent px-0 text-nd-title font-semibold shadow-none focus:border-nd-border"
          />
          <p className="mt-1 text-nd-caption text-nd-fg-3">
            {isOwner ? "내 영상" : `${nameOf(p.owner)} 님의 영상`} · 마지막 수정 {p.updatedBy === d.me ? "나" : p.updatedBy === "실행기" ? "실행기" : nameOf(p.updatedBy)} ·{" "}
            <span className={state === "error" || state === "conflict" ? "text-nd-danger-text" : ""}>{readOnly ? "읽기 전용" : saveLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.sample && <Badge tone="warning">예시</Badge>}
          <Select size="sm" aria-label="단계" value={p.stage} onChange={(e) => update((x) => void (x.stage = e.target.value as ProjectStage))}>
            {(Object.keys(STAGE_LABEL) as ProjectStage[]).map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </Select>
          <Select size="sm" aria-label="공개 범위" value={p.visibility} disabled={!isOwner} onChange={(e) => update((x) => void (x.visibility = e.target.value as "private" | "team"))}>
            <option value="private">나만 보기</option>
            <option value="team">팀 보기</option>
          </Select>
          {isOwner && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label="영상 지우기"
              onClick={async () => {
                if (!(await ask({ title: "영상을 지울까요?", message: "소스 · 음성 · 완성 파일과 버전 기록, 검토 링크가 함께 지워집니다. 이미 게시한 영상은 플랫폼에 그대로 남습니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                await run("del", async () => {
                  await mutate("project.delete", { id: p.id });
                  await refresh();
                  router.push("/neander/shorts/projects");
                });
              }}
            />
          )}
        </div>
      </div>

      {(state === "conflict" || state === "error") && error && (
        <InlineNotice tone={state === "conflict" ? "warning" : "danger"} className="mb-4" action={state === "conflict" ? <Button size="sm" variant="secondary" onClick={() => void reloadLatest()}>최신 불러오기</Button> : undefined}>
          {error}
        </InlineNotice>
      )}

      {readOnly && (
        <InlineNotice tone="info" className="mb-4">
          관리자 몰아보기 — {nameOf(p.owner)} 님의 비공개 영상을 <b>읽기 전용</b>으로 보고 있습니다. 고치기 · 생성 · 게시는 소유자만 합니다.
        </InlineNotice>
      )}
      {readOnly && p.renderIds.length > 0 && <RenderStrip ids={p.renderIds} />}

      <Tabs className="mb-5" items={tabs} value={tab} onChange={setTab} ariaLabel="영상 만드는 단계" />

      {/* 읽기 전용이면 안의 입력칸 · 버튼을 통째로 잠근다 (영상 재생은 그대로) */}
      <fieldset disabled={readOnly} className="min-w-0">
        {tab === "sources" && <SourcesTab draft={draft} />}
        {tab === "coupang" && <CoupangTab draft={draft} />}
        {tab === "client" && <ClientInfoTab draft={draft} />}
        {tab === "review" && <ReviewTab draft={draft} />}
        {tab === "script" && <ScriptTab draft={draft} />}
        {tab === "edit" && <EditorTab draft={draft} />}
        {tab === "publish" && <PublishTab draft={draft} />}
        {tab === "perf" && <PerformanceTab draft={draft} />}
      </fieldset>
    </PageShell>
  );
}

/** 읽기 전용 보기의 완성 영상 — 잠긴 탭 밖에서 바로 재생 */
function RenderStrip({ ids }: { ids: string[] }) {
  return (
    <div className="mb-5 flex gap-3 overflow-x-auto pb-1">
      {[...ids].reverse().slice(0, 4).map((id) => (
        <RenderVideo key={id} id={id} />
      ))}
    </div>
  );
}

function RenderVideo({ id }: { id: string }) {
  const { url, error } = useBlobUrl(id);
  if (error) return <p className="text-nd-caption text-nd-danger-text">{error}</p>;
  return url ? (
    <video src={url} controls playsInline className="aspect-[9/16] w-40 shrink-0 rounded-nd-md bg-black" />
  ) : (
    <div className="aspect-[9/16] w-40 shrink-0 animate-pulse rounded-nd-md bg-nd-fg/10" />
  );
}
