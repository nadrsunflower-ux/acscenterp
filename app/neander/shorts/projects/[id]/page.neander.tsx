"use client";

// ============================================================
//  제작 프로젝트 — 영상 한 편의 전 과정을 탭으로
// ------------------------------------------------------------
//  소스 → 쿠팡 확인 → 공식·대본 → 편집·출력 → 게시 → 성과. 탭은 흐름 순서다.
//  고친 것은 저절로 저장된다 (useProjectDraft). 서버 동작(AI · 조사 · 작업)은
//  남은 변경을 먼저 저장한 뒤 부르고, 돌아온 최신 프로젝트로 바꿔 끼운다.
//
//  2026-11 목업 개편(12-video · 12-video-sources · 12-video-coupang · 12-video-publish 위쪽):
//  · 머리: 제목(바로 고침) · 탭마다 한 줄 설명 · 「영상 목록」 · 「영상 설정」(종류 · 단계 · 공개 범위 · 지우기).
//  · 꼬리표 줄: 종류 · 만드는 방식 · 단계 · 공개 범위(남의 비공개면 읽기 전용) — 오른쪽에 조용한 자동 저장 표시.
//  · 진행 단계(StageFlow): 소재 → 대본 → 편집 → (고객 승인 · 고객사 영상만) → 게시 → 성과.
//    실제 stage · 고객 검토 · 게시 기록 · 성과 기록으로 끝남/지금/남음을 정한다.
//    단계를 누르면 그 탭만 연다 — stage 는 절대 바꾸지 않는다 (단계는 「영상 설정」 에서만 바꾼다).
// ============================================================

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, Lock, Settings2, Trash2, Users } from "lucide-react";
import { Badge, Button, EmptyState, Field, PageShell, Popover, Select, Tabs, buttonClass, cn, useConfirm } from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { isReadOnlyFor, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { useBlobUrl } from "@/components/neander/shorts/media";
import { useProjectDraft } from "@/components/neander/shorts/useProjectDraft";
import { StageBadge, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { SaveIndicator, StageFlow, StudioHeader, StudioNotice, VisibilityChip, type FlowStep } from "@/components/neander/shorts/studio";
import { SourcesTab } from "@/components/neander/shorts/project/SourcesTab";
import { CoupangTab } from "@/components/neander/shorts/project/CoupangTab";
import { ScriptTab } from "@/components/neander/shorts/project/ScriptTab";
import { EditorTab } from "@/components/neander/shorts/project/EditorTab";
import { PublishTab } from "@/components/neander/shorts/project/PublishTab";
import { PerformanceTab } from "@/components/neander/shorts/project/PerformanceTab";
import { ClientInfoTab, ReviewTab } from "@/components/neander/shorts/project/ClientTabs";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, STAGE_LABEL, confirmedCandidate, renderBlockers } from "@/lib/neander/shorts/model";
import type { MetricSnapshotView, ProductionMode, ProjectDoc, ProjectStage, PublicationView } from "@/lib/neander/shorts/types";

const TABS = ["sources", "coupang", "client", "script", "edit", "review", "publish", "perf"] as const;
type TabKey = (typeof TABS)[number];

/** 탭마다 머리 아래 한 줄 — 이 탭에서 하는 일 */
const TAB_DESC: Record<TabKey, string> = {
  sources: "소스 · 사실을 모으고 사용할 구간을 고르세요.",
  coupang: "같은 상품인지 확인하고 게시 계정의 제휴 링크를 준비하세요.",
  client: "계약 월 · 제품 · 브리프를 확인하세요. 정보 수정은 업체 화면(정본)에서 합니다.",
  script: "확인된 사실로 대본을 만들고 제작 단계별로 이어 가세요.",
  edit: "장면 · 음성 · 자막을 맞추고 이 브라우저에서 MP4 로 출력하세요.",
  review: "고객 검토 링크를 보내고 회차별 결과 · 수정 횟수를 관리하세요.",
  publish: "게시 문구 · 파일 · 계정을 확인하고 지금 게시하거나 예약하세요.",
  perf: "플랫폼 · 쿠팡 성과와 직접 적은 기록을 확인하세요.",
};

/** 만드는 방식 (편집 탭에서 고른다) */
const MODE_LABEL: Record<ProductionMode, string> = { remix: "기존 영상 재편집", hybrid: "소스 + AI 장면", ai: "전체 AI 생성" };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useShorts();
  const project = data!.projects.find((p) => p.id === id);
  if (!project) {
    return (
      <PageShell>
        <EmptyState
          title="영상을 찾지 못했습니다"
          description="지워졌거나, 다른 사람의 비공개 영상이거나, 다른 프로젝트의 영상입니다."
          action={
            <Link href="/neander/shorts/projects" className={buttonClass("secondary", "md")}>
              영상 목록으로
            </Link>
          }
        />
      </PageShell>
    );
  }
  return (
    <Suspense>
      <ProjectWorkspace key={project.id} initial={project} />
    </Suspense>
  );
}

// ---- 진행 단계 ---------------------------------------------------------------

type FlowKey = "material" | "script" | "edit" | "approve" | "publish" | "perf";
const FLOW_RANK: Record<FlowKey, number> = { material: 0, script: 1, edit: 2, approve: 3, publish: 4, perf: 5 };

/**
 * 지금 단계 — 실제 stage 에서 출발해 고객 검토 · 게시 기록으로 보정한다 (화면 계산만, 저장하지 않는다).
 * 보관한 영상은 멈춘 자리(게시 기록 · 완성 파일 · 대본)로 짐작한다.
 */
function flowRank(p: ProjectDoc, published: boolean): number {
  const brand = p.kind === "brand";
  const byStage: Partial<Record<ProjectStage, number>> = { research: 0, sourcing: 0, matching: 0, scripting: 1, editing: 2, ready: 4, published: 5 };
  let r = byStage[p.stage] ?? (published ? 5 : p.renderIds.length ? 4 : p.script.lines.length ? 2 : 0);
  if (brand && r < 5) {
    if (p.review.state === "waiting" || p.review.state === "revision") r = 3;
    else if (p.review.state === "approved") r = Math.max(r, 4);
    else if (r === 4) r = 3; // 게시 준비인데 고객 승인 전 — 승인이 먼저
  }
  if (published) r = 5;
  return r;
}

function buildFlow(p: ProjectDoc, pubs: PublicationView[], snaps: MetricSnapshotView[], open: (k: TabKey) => void): FlowStep[] {
  const brand = p.kind === "brand";
  const done = pubs.filter((x) => x.status === "published").length;
  const waiting = pubs.filter((x) => x.status === "scheduled" || x.status === "queued" || x.status === "uploading" || x.status === "processing").length;
  const rank = flowRank(p, done > 0 || p.stage === "published");
  const state = (k: FlowKey): FlowStep["state"] => {
    const r = FLOW_RANK[k];
    if (k === "perf") return rank >= 5 ? (snaps.length ? "done" : "current") : "todo";
    return r < rank ? "done" : r === rank ? "current" : "todo";
  };
  const steps: FlowStep[] = [
    {
      key: "material",
      label: "소재",
      state: state("material"),
      hint: brand ? `소스 ${p.sources.length}개` : p.kind === "coupang" && confirmedCandidate(p) ? `소스 ${p.sources.length} · 쿠팡 확인` : `소스 ${p.sources.length}개`,
      onSelect: () => open(p.kind === "coupang" && p.stage === "matching" ? "coupang" : brand ? "client" : "sources"),
    },
    { key: "script", label: "대본", state: state("script"), hint: p.script.lines.length ? `${p.script.lines.length}줄` : rank > FLOW_RANK.script ? "줄 없음" : "아직 없음", onSelect: () => open("script") },
    { key: "edit", label: "편집", state: state("edit"), hint: `장면 ${p.scenes.length} · 완성 ${p.renderIds.length}`, onSelect: () => open("edit") },
  ];
  if (brand) steps.push({ key: "approve", label: "고객 승인", state: state("approve"), hint: `${REVIEW_LABEL[p.review.state]} · 수정 ${p.review.revisionsUsed}회`, onSelect: () => open("review") });
  steps.push(
    { key: "publish", label: "게시", state: state("publish"), hint: done ? `게시 ${done}건${waiting ? ` · 대기 ${waiting}` : ""}` : waiting ? `예약 · 대기 ${waiting}건` : "기록 없음", onSelect: () => open("publish") },
    { key: "perf", label: "성과", state: state("perf"), hint: snaps.length ? `기록 ${snaps.length}건` : "기록 없음", onSelect: () => open("perf") },
  );
  return steps;
}

// ---- 화면 ---------------------------------------------------------------------

function ProjectWorkspace({ initial }: { initial: WithId<ProjectDoc> }) {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const router = useRouter();
  const search = useSearchParams();
  const ask = useConfirm();
  const { run } = useAction();
  const readOnly = isReadOnlyFor(initial, d.me);
  const draft = useProjectDraft(initial, readOnly);
  const { p, update, state, error, reloadLatest, flush } = draft;
  useCrumbTail(p.title);
  const brand = initial.kind === "brand";
  const wanted = search.get("tab") ?? "";
  // 고객사 영상은 「쿠팡 확인」 대신 「고객사」 · 「고객 승인」 · 일반 영상(제휴 없음)은 「쿠팡 확인」 이 없다
  const allowed = (k: string) =>
    (TABS as readonly string[]).includes(k) && (brand ? k !== "coupang" : k !== "client" && k !== "review" && !(p.kind === "general" && k === "coupang"));
  const tab = allowed(wanted) ? (wanted as TabKey) : brand ? "client" : "sources";
  // 탭(과 진행 단계)은 보기만 옮긴다 — 영상 단계(stage)는 바꾸지 않는다
  const setTab = (k: string) => router.replace(`/neander/shorts/projects/${p.id}?tab=${k}`, { scroll: false });
  const isOwner = p.owner === d.me;
  const pubs = useMemo(() => d.publications.filter((x) => x.projectId === p.id), [d.publications, p.id]);
  const snaps = useMemo(() => d.metrics.filter((m) => m.projectId === p.id), [d.metrics, p.id]);

  const tabs = useMemo(() => {
    const confirmed = !!confirmedCandidate(p);
    const blockers = renderBlockers(p).length;
    const lines = p.script.lines.length;
    const edit = {
      key: "edit",
      label: p.renderIds.length ? (
        <TabLabel text="편집·출력" hint={`완성 ${p.renderIds.length}`} />
      ) : p.scenes.length ? (
        <TabLabel text="편집·출력" hint={`장면 ${p.scenes.length}${blockers ? " · 확인" : ""}`} tone={blockers ? "warning" : "count"} />
      ) : (
        <TabLabel text="편집·출력" />
      ),
    };
    const rest = [
      { key: "publish", label: <TabLabel text="게시" hint={pubs.length ? String(pubs.length) : undefined} /> },
      { key: "perf", label: <TabLabel text="성과" hint={snaps.length ? `기록 ${snaps.length}` : undefined} tone="muted" /> },
    ];
    const sources = { key: "sources", label: <TabLabel text="소스" hint={p.sources.length || !brand ? String(p.sources.length) : undefined} /> };
    const script = { key: "script", label: <TabLabel text="공식·대본" hint={lines ? `${lines}줄` : undefined} /> };
    if (p.kind === "brand") {
      return [
        { key: "client", label: <TabLabel text="고객사" hint={p.clientName || undefined} tone="muted" /> },
        sources,
        script,
        edit,
        { key: "review", label: <TabLabel text="고객 승인" hint={REVIEW_LABEL[p.review.state]} tone={p.review.state === "approved" ? "success" : p.review.state === "revision" ? "warning" : "muted"} /> },
        ...rest,
      ];
    }
    if (p.kind === "general") return [sources, script, edit, ...rest];
    return [
      sources,
      {
        key: "coupang",
        label: confirmed ? (
          <TabLabel text="쿠팡 확인" hint="동일 상품" tone="success" />
        ) : (
          <TabLabel text="쿠팡 확인" hint={p.coupang.candidates.length ? `후보 ${p.coupang.candidates.length}` : undefined} />
        ),
      },
      script,
      edit,
      ...rest,
    ];
  }, [p, pubs, snaps, brand]);

  const flow = buildFlow(p, pubs, snaps, (k) => (allowed(k) ? setTab(k) : undefined));
  const flowRef = useRef<HTMLDivElement>(null);
  const currentFlow = flow.find((x) => x.state === "current")?.key ?? null;
  useEffect(() => {
    const ol = flowRef.current?.querySelector("ol");
    const li = ol?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!ol || !li || ol.scrollWidth <= ol.clientWidth) return;
    ol.scrollLeft = Math.max(0, li.offsetLeft - ol.offsetLeft - 16);
  }, [currentFlow]);
  const ownerName = isOwner ? "나" : nameOf(p.owner);
  const who = p.updatedBy === d.me ? "나" : p.updatedBy === "실행기" ? "실행기" : nameOf(p.updatedBy);

  const remove = async () => {
    if (!(await ask({ title: "영상을 지울까요?", message: "소스 · 음성 · 완성 파일과 버전 기록, 검토 링크가 함께 지워집니다. 이미 게시한 영상은 플랫폼에 그대로 남습니다.", tone: "danger", confirmLabel: "지우기" }))) return;
    await run("del", async () => {
      await mutate("project.delete", { id: p.id });
      await refresh();
      router.push("/neander/shorts/projects");
    });
  };

  return (
    <PageShell>
      <StudioHeader
        className="mb-3"
        kicker={
          <Link href="/neander/shorts/projects" className="inline-flex items-center gap-1 hover:text-nd-fg hover:underline">
            <ChevronLeft size={15} aria-hidden />
            {brand ? `영상 · ${p.clientName || "고객사"}` : "영상"}
          </Link>
        }
        title={<TitleInput value={p.title} readOnly={readOnly} onChange={(v) => update((x) => void (x.title = v))} />}
        description={TAB_DESC[tab]}
        actions={
          <>
            <Link href="/neander/shorts/projects" className={buttonClass("secondary", "md", "gap-1.5")}>
              <ArrowLeft size={16} aria-hidden />
              영상 목록
            </Link>
            <VideoSettings
              p={p}
              readOnly={readOnly}
              isOwner={isOwner}
              onKind={(k) => update((x) => void (x.kind = k))}
              onStage={(s) => update((x) => void (x.stage = s))}
              onVisibility={(v) => update((x) => void (x.visibility = v))}
              onDelete={() => void remove()}
            />
          </>
        }
      />

      {/* 꼬리표 줄 — 종류 · 만드는 방식 · 단계 · 공개 범위 | 저장 상태 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {p.kind === "brand" ? (
            <Badge tone="info" size="lg">
              고객사 · {p.clientName || "고객사"}
            </Badge>
          ) : p.kind === "general" ? (
            <Badge size="lg">일반 · 제휴 없음</Badge>
          ) : (
            <Badge tone="accent" size="lg">
              쿠팡 제휴
            </Badge>
          )}
          <Badge size="lg">{MODE_LABEL[p.mode]}</Badge>
          <StageBadge stage={p.stage} size="lg" />
          {p.kind === "brand" ? (
            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13px]", readOnly ? "font-medium text-nd-warning-text" : "text-nd-fg-2")}>
              {p.visibility === "team" ? <Users size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
              {readOnly ? `읽기 전용 · ${ownerName} 것` : `${p.visibility === "team" ? "팀 공개" : "업체 담당자 한정"} · ${ownerName}`}
            </span>
          ) : (
            <VisibilityChip visibility={p.visibility} ownerName={ownerName} readOnly={readOnly} />
          )}
          {p.sample && (
            <Badge tone="warning" size="lg">
              예시 · 실제 수치 아님
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {readOnly ? (
            <span className="text-[13px] text-nd-fg-3">읽기 전용 — 저장하지 않습니다 · {fmtWhen(p.updatedAt)}</span>
          ) : (
            <SaveIndicator state={state} savedAt={state === "saved" ? p.updatedAt : null} onRetry={() => void flush().catch(() => undefined)} />
          )}
          <span className="text-[13px] text-nd-fg-3">· 마지막 수정 {who}</span>
        </div>
      </div>

      {(state === "conflict" || state === "error") && error && (
        <StudioNotice
          tone={state === "conflict" ? "warning" : "danger"}
          className="mb-4"
          title={state === "conflict" ? "다른 사람이 먼저 고쳤습니다" : "저장하지 못했습니다"}
          action={
            state === "conflict" ? (
              <Button size="sm" variant="secondary" onClick={() => void reloadLatest()}>
                최신 불러오기
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void flush().catch(() => undefined)}>
                다시 저장
              </Button>
            )
          }
        >
          {error}
        </StudioNotice>
      )}

      {readOnly && (
        <StudioNotice tone="info" className="mb-4" title="관리자 몰아보기 · 읽기 전용">
          {nameOf(p.owner)} 님의 비공개 영상을 보고 있습니다. 고치기 · 생성 · 게시는 소유자만 합니다.
        </StudioNotice>
      )}
      {readOnly && p.renderIds.length > 0 && <RenderStrip ids={p.renderIds} />}

      {/* 좁은 화면은 진행 단계가 옆으로 밀린다 — 지금 단계가 보이게 그 자리로 옮겨 둔다 */}
      <div ref={flowRef} className="mb-4 min-w-0">
        <StageFlow steps={flow} />
      </div>

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

/** 영상 설정 — 종류(쿠팡 ↔ 일반) · 단계 · 공개 범위 · 지우기. 머리를 가볍게 두려고 한 곳에 모았다 */
function VideoSettings({
  p,
  readOnly,
  isOwner,
  onKind,
  onStage,
  onVisibility,
  onDelete,
}: {
  p: ProjectDoc;
  readOnly: boolean;
  isOwner: boolean;
  onKind: (k: "coupang" | "general") => void;
  onStage: (s: ProjectStage) => void;
  onVisibility: (v: "private" | "team") => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} variant="secondary" icon={Settings2} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        영상 설정
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} placement="bottom-end" ariaLabel="영상 설정" className="w-[min(22rem,calc(100vw-2rem))]" unpadded>
        <div className="space-y-4 p-4">
          {p.kind !== "brand" && (
            // 쿠팡 ↔ 일반만 바꾼다 — 제휴 링크 · 협찬이 없으면 일반 영상 (고지 문구 · 쿠팡 확인이 빠진다)
            <Field label="영상 종류" hint="제휴 링크 · 협찬이 없으면 일반 영상 — 고지 문구 · 쿠팡 확인이 빠집니다">
              <Select aria-label="영상 종류" value={p.kind} disabled={readOnly} onChange={(e) => onKind(e.target.value as "coupang" | "general")}>
                <option value="coupang">쿠팡 제휴 영상</option>
                <option value="general">일반 영상 (제휴 없음)</option>
              </Select>
            </Field>
          )}
          <Field label="단계" hint="단계는 여기서만 바뀝니다 — 탭이나 진행 단계를 눌러도 그대로입니다">
            <Select aria-label="단계" value={p.stage} disabled={readOnly} onChange={(e) => onStage(e.target.value as ProjectStage)}>
              {(Object.keys(STAGE_LABEL) as ProjectStage[]).map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="공개 범위" hint={isOwner ? "팀 공개는 AI STUDIO 사용자 누구나 읽고 고칩니다" : "공개 범위는 만든 사람만 바꿉니다"}>
            <Select aria-label="공개 범위" value={p.visibility} disabled={!isOwner} onChange={(e) => onVisibility(e.target.value as "private" | "team")}>
              <option value="private">나만 보기</option>
              <option value="team">팀 공개</option>
            </Select>
          </Field>
          {isOwner && (
            <div className="border-t border-nd-line pt-3">
              <Button
                variant="danger"
                icon={Trash2}
                className="w-full"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                영상 지우기
              </Button>
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}

/** 읽기 전용 보기의 완성 영상 — 잠긴 탭 밖에서 바로 재생 */
function RenderStrip({ ids }: { ids: string[] }) {
  return (
    <div className="mb-5 flex gap-3 overflow-x-auto pb-1">
      {[...ids]
        .reverse()
        .slice(0, 4)
        .map((id) => (
          <RenderVideo key={id} id={id} />
        ))}
    </div>
  );
}

function RenderVideo({ id }: { id: string }) {
  const { url, error, purged } = useBlobUrl(id);
  if (purged) return null; // 게시 뒤 내용을 지운 파일 — 게시 기록의 링크로 본다
  if (error) return <p className="text-[13px] text-nd-danger-text">{error}</p>;
  return url ? <video src={url} controls playsInline className="aspect-[9/16] w-40 shrink-0 rounded-nd-md bg-black" /> : <div className="aspect-[9/16] w-40 shrink-0 animate-pulse rounded-nd-md bg-nd-fg/10" />;
}

/** 탭 이름 + 개수 · 상태 (숫자는 파란색, 상태 글은 13px) */
function TabLabel({ text, hint, tone = "count" }: { text: string; hint?: string; tone?: "count" | "muted" | "warning" | "success" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {text}
      {hint && (
        <span
          className={cn(
            "max-w-[12rem] truncate text-[13px]",
            tone === "count" && "nd-num font-semibold text-nd-accent",
            tone === "muted" && "font-normal text-nd-fg-3",
            tone === "warning" && "font-medium text-nd-warning-text",
            tone === "success" && "font-medium text-nd-success-text",
          )}
        >
          {hint}
        </span>
      )}
    </span>
  );
}

/** 제목 — 글 길이만큼만 넓어지는 입력칸 (화면 제목 크기 그대로 바로 고친다) */
function TitleInput({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange: (v: string) => void }) {
  const cls = "col-start-1 row-start-1 px-2 text-nd-display";
  return (
    <span className="-ml-2 inline-grid min-w-0 max-w-full grid-cols-[minmax(0,max-content)] align-middle">
      <span aria-hidden className={cn(cls, "invisible overflow-hidden whitespace-pre border border-transparent py-0.5")}>
        {value || "제목 없음"}
      </span>
      <input
        aria-label="영상 제목"
        value={value}
        readOnly={readOnly}
        placeholder="제목 없음"
        title={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          cls,
          "w-full min-w-[8rem] truncate rounded-nd-md border border-transparent bg-transparent py-0.5 text-nd-fg outline-none transition-colors placeholder:text-nd-fg-3",
          !readOnly && "hover:border-nd-border focus:border-nd-accent focus:bg-nd-content",
        )}
      />
    </span>
  );
}
