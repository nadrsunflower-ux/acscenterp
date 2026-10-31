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
import { Badge, Button, EmptyState, InlineNotice, PageShell, Select, Tabs, cn, useConfirm } from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { isReadOnlyFor, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { useBlobUrl } from "@/components/neander/shorts/media";
import { useProjectDraft } from "@/components/neander/shorts/useProjectDraft";
import { StageBadge, useAction } from "@/components/neander/shorts/parts";
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
  // 고객사 영상은 「쿠팡 확인」 대신 「고객사」 · 「고객 승인」 · 일반 영상(제휴 없음)은 「쿠팡 확인」 이 없다
  const allowed = (k: string) =>
    (TABS as readonly string[]).includes(k) && (brand ? k !== "coupang" : k !== "client" && k !== "review" && !(p.kind === "general" && k === "coupang"));
  const tab = allowed(wanted) ? (wanted as TabKey) : brand ? "client" : "sources";
  const setTab = (k: string) => router.replace(`/neander/shorts/projects/${p.id}?tab=${k}`, { scroll: false });
  const isOwner = p.owner === d.me;

  const tabs = useMemo(() => {
    const confirmed = !!confirmedCandidate(p);
    const blockers = renderBlockers(p).length;
    const pubs = d.publications.filter((x) => x.projectId === p.id);
    const snaps = d.metrics.filter((m) => m.projectId === p.id).length;
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
      { key: "perf", label: <TabLabel text="성과" hint={snaps ? `기록 ${snaps}` : undefined} tone="muted" /> },
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
  }, [p, d.publications, d.metrics, brand]);

  const saveLabel = state === "saving" ? "저장 중…" : state === "dirty" ? "고친 내용 저장 대기" : state === "saved" ? "저장됨" : state === "conflict" ? "충돌" : "저장 실패";

  return (
    <PageShell>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <Link href="/neander/shorts/projects" className="mb-1 inline-flex items-center gap-1 text-[13px] text-nd-fg-3 hover:text-nd-fg">
            <ChevronLeft size={15} /> {p.kind === "brand" ? `영상 · ${p.clientName}` : "영상"}
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <TitleInput value={p.title} readOnly={readOnly} onChange={(v) => update((x) => void (x.title = v))} />
            <StageBadge stage={p.stage} size="lg" />
            {p.sample && <Badge tone="warning" size="lg">예시 · 실제 수치 아님</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-nd-fg-3">
            <span>{isOwner ? "내 영상" : `${nameOf(p.owner)} 님의 영상`}</span>
            <span aria-hidden>·</span>
            <span>
              마지막 수정 {fmtStamp(p.updatedAt)} {p.updatedBy === d.me ? "나" : p.updatedBy === "실행기" ? "실행기" : nameOf(p.updatedBy)}
            </span>
            <span aria-hidden>·</span>
            <span className={state === "error" || state === "conflict" ? "font-medium text-nd-danger-text" : state === "saved" ? "" : "text-nd-fg-2"} aria-live="polite">
              {readOnly ? "읽기 전용" : saveLabel}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!brand && (
            // 쿠팡 ↔ 일반만 바꾼다 — 제휴 링크 · 협찬이 없으면 일반 영상 (고지 문구 · 쿠팡 확인이 빠진다)
            <Select className="w-44" aria-label="영상 종류" value={p.kind} disabled={readOnly} onChange={(e) => update((x) => void (x.kind = e.target.value as "coupang" | "general"))}>
              <option value="coupang">쿠팡 제휴 영상</option>
              <option value="general">일반 영상 (제휴 없음)</option>
            </Select>
          )}
          <Select className="w-36" aria-label="단계" value={p.stage} onChange={(e) => update((x) => void (x.stage = e.target.value as ProjectStage))}>
            {(Object.keys(STAGE_LABEL) as ProjectStage[]).map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </Select>
          <Select className="w-32" aria-label="공개 범위" value={p.visibility} disabled={!isOwner} onChange={(e) => update((x) => void (x.visibility = e.target.value as "private" | "team"))}>
            <option value="private">나만 보기</option>
            <option value="team">팀 보기</option>
          </Select>
          {isOwner && (
            <Button
              variant="ghost"
              icon={Trash2}
              aria-label="영상 지우기"
              title="영상 지우기"
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
      </header>

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

/** 제목 — 글 길이만큼만 넓어지는 입력칸 (옆에 단계 배지가 붙는다) */
function TitleInput({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange: (v: string) => void }) {
  const cls = "col-start-1 row-start-1 px-2 text-[22px] font-bold leading-snug tracking-[-0.01em]";
  return (
    <span className="-ml-2 inline-grid min-w-0 max-w-full grid-cols-[minmax(0,max-content)]">
      <span aria-hidden className={cn(cls, "invisible overflow-hidden whitespace-pre border border-transparent py-1")}>
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
          "w-full min-w-[8rem] truncate rounded-nd-md border border-transparent bg-transparent py-1 text-nd-fg outline-none transition-colors placeholder:text-nd-fg-3",
          !readOnly && "hover:border-nd-border focus:border-nd-accent focus:bg-nd-content",
        )}
      />
    </span>
  );
}

/** 마지막 수정 시각 — 올해면 「10월 31일 14:20」, 아니면 연도까지 (한국 시간) */
function fmtStamp(ms: number | null | undefined): string {
  if (!ms) return "—";
  const k = new Date(ms + 9 * 3600_000);
  const nowYear = new Date(Date.now() + 9 * 3600_000).getUTCFullYear();
  const hm = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
  return `${k.getUTCFullYear() === nowYear ? "" : `${k.getUTCFullYear()}년 `}${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${hm}`;
}
