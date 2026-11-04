"use client";

// ============================================================
//  영상 — 왼쪽 폴더 칸 · 오른쪽 그 폴더의 영상 (smoat Q 「결과물」 의 폴더 체계)
// ------------------------------------------------------------
//  사용자 요청(2026-11-02): 「왼쪽 사이드바 오른쪽에 파일이 세로로 쭉 보이고 그에 따라
//  오른쪽 워크스페이스가 바뀌게」. 폴더 나무 · 개수 · 이름 규칙은 shorts/folders.ts.
//  2026-11 목업 개편(11-videos · 11-videos-mobile · 11-videos-agency · 11-video-new*):
//
//  · 위: 화면 제목 「영상」 · 한 줄 설명 · 「새 영상」. 대행 프로젝트면 그 아래에 업체 계약
//    (이번 달 계약분 편수 · 고객 승인 편수 · 월 계약 편수 · 편당 수정 상한 · 담당)을 함께.
//  · 왼쪽 폴더 칸은 흰 카드로 고정(넓은 화면은 스크롤해도 붙어 있다), 모바일은 위로.
//  · 폴더를 고르면 오른쪽이 그 폴더(하위 포함)의 영상으로 바뀐다. 고른 폴더는 주소(?folder=)와
//    이 브라우저에 기억해 다시 열 때 이어진다 — 지워진 폴더면 전체 영상으로.
//  · 「새 영상」 은 지금 폴더 안에 만든다. 영상은 끌어 폴더에 놓거나 줄의 더보기(⋯)로 옮긴다.
//  · 상태 탭(전체 · 진행 중 · 게시됨 · 보관함) + 단계 고르기 하나 — 예전 단계별 가로 탭을
//    「모든 단계」 고르기로 모았다 (탭이 상태와 겹치지 않게). 종류 · 계약 월 · 공개 범위 · 검색도 같은 줄.
//  · 영상 편수와 플랫폼별 게시 건수는 다른 숫자다 — 따로 센다.
//  · 쿠팡 제휴 · 고객사 · 일반 영상이 한 표에 섞인다 — 고객사 영상은 「쿠팡 · 고객사」 칸에
//    고객사 이름 · 검토 상태 · 수정 횟수/상한, 일반 영상은 「제휴 없음」.
//  · 모바일(768px 미만)은 표 대신 이름이 붙은 카드 목록.
// ============================================================

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronRight, Clapperboard, Folder, FolderInput, FolderMinus, FolderOpen, GripVertical, Lock, MoreHorizontal, Plug, Plus, Users } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FormRow,
  IconButton,
  InlineNotice,
  Input,
  Menu,
  PageShell,
  SearchInput,
  Select,
  Table,
  TableScroll,
  Tabs,
  Td,
  Th,
  Tr,
  buttonClass,
  cn,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, SampleTag, StageBadge, fmtUsd, useAction } from "@/components/neander/shorts/parts";
import { StudioHeader, StudioNotice, VisibilityChip } from "@/components/neander/shorts/studio";
import { FolderPanel, VIDEO_DRAG_TYPE } from "@/components/neander/shorts/folders/FolderPanel";
import { FolderNameDialog, MoveVideosDialog } from "@/components/neander/shorts/folders/FolderDialogs";
import { mutate, shortsGet } from "@/lib/neander/shorts/client";
import { folderCounts, folderLabel, folderTree, inFolder, type FolderTree } from "@/lib/neander/shorts/folders";
import { currentMonth, REVIEW_LABEL, STAGE_LABEL, confirmedCandidate, projectCost } from "@/lib/neander/shorts/model";
import { CLIENT_DELIVERY_LABEL, type ClientView, type FolderView, type ProjectDoc, type ProjectKind, type ProjectStage, type PublicationView } from "@/lib/neander/shorts/types";
import { PRODUCTION_LABEL, spaceKind, spaceOf } from "@/lib/neander/shorts/spaces";

const REVIEW_TONE: Record<ProjectDoc["review"]["state"], Tone> = { none: "neutral", waiting: "warning", revision: "danger", approved: "success" };

/** 이 브라우저에 기억 — 마지막 폴더 · 펼친 폴더 */
const MEMORY_KEY = "neander.shorts.videoFolders";
type Memory = { last: string | null; expanded: string[] };
const readMemory = (): Memory => {
  try {
    const v = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "null");
    return { last: typeof v?.last === "string" ? v.last : null, expanded: Array.isArray(v?.expanded) ? v.expanded.filter((x: unknown) => typeof x === "string") : [] };
  } catch {
    return { last: null, expanded: [] };
  }
};

const KIND_LABEL: Record<ProjectKind, string> = { coupang: "쿠팡 제휴", general: "일반 영상", brand: "고객사 영상" };
/** 표 · 카드 안의 짧은 종류 이름 */
const KIND_SHORT: Record<ProjectKind, string> = { coupang: "쿠팡 제휴", general: "일반", brand: "고객사" };
const WRITER_STYLE_LABEL = { intro: "제품 소개 대본", story: "스토리 대본" } as const;

/** 상태 탭 — 단계는 따로 「단계」 고르기로 */
type StatusTab = "all" | "active" | "published" | "archived";
const STATUS_OK: Record<StatusTab, (p: ProjectDoc) => boolean> = {
  all: (p) => p.stage !== "archived",
  active: (p) => p.stage !== "archived" && p.stage !== "published",
  published: (p) => p.stage === "published",
  archived: (p) => p.stage === "archived",
};
/** 「단계」 고르기에 나오는 단계 (보관은 보관함 탭) */
const STAGE_OPTIONS = (Object.keys(STAGE_LABEL) as ProjectStage[]).filter((s) => s !== "archived");

/** 고르기 줄 칸 — 검색(넓게) + 고르기 n개. Tailwind 가 읽도록 글자 그대로 둔다 */
const FILTER_COLS: Record<number, string> = {
  1: "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  2: "lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]",
  3: "lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]",
  4: "lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]",
};

/** 넓은 화면(1400px 이상)에서만 따로 보이는 표 칸 — 좁으면 완성 파일 칸 아래 줄로 접힌다 */
const WIDE_ONLY = "hidden min-[1400px]:table-cell";

/** 게시 결과를 사람이 봐야 하는 게시 (결과 확인 필요 · 실패) */
const pubNeedsCheck = (x: PublicationView) => x.status === "uncertain" || x.status === "failed";

/** 탭 이름 + 건수 (13px — 탭 기본 꼬리표보다 크게) */
const tabLabel = (label: string, n: number) => (
  <>
    {label}
    <span className="nd-num text-[13px] font-normal text-nd-fg-3">{n.toLocaleString("ko-KR")}</span>
  </>
);

/** 수정 시각 — 「11/3 (화)」 와 「18:24」 (한국 시간) */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function whenParts(ms: number | null | undefined): { day: string; time: string } | null {
  if (!ms) return null;
  const k = new Date(ms + 9 * 3600_000);
  return { day: `${k.getUTCMonth() + 1}/${k.getUTCDate()} (${DOW[k.getUTCDay()]})`, time: `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}` };
}

export default function ProjectsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 경계가 있어야 정적 빌드가 된다
  return (
    <Suspense>
      <ProjectsInner />
    </Suspense>
  );
}

function ProjectsInner() {
  const { data, refresh, nameOf, currentSpace, setSpace } = useShorts();
  const d = data!;
  const sc = useScoped();
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const ask = useConfirm();
  const agency = !!currentSpace && spaceKind(currentSpace) === "agency";
  const client = agency ? d.clients.find((c) => c.id === currentSpace?.clientId) ?? null : null;

  // 폴더도 프로젝트마다 따로 (useScoped)
  const tree = useMemo(() => folderTree(sc.folders), [sc.folders]);
  const [memory, setMemory] = useState<Memory>({ last: null, expanded: [] });
  const [memoryReady, setMemoryReady] = useState(false);
  useEffect(() => {
    setMemory(readMemory());
    setMemoryReady(true);
  }, []);
  const remember = useCallback((next: (m: Memory) => Memory) => {
    setMemory((m) => {
      const v = next(m);
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(v));
      } catch {
        /* 사생활 보호 창 등 — 기억 없이도 쓸 수 있다 */
      }
      return v;
    });
  }, []);

  // 고른 폴더 — 주소가 먼저, 없으면 기억한 폴더. 지워진 폴더면 전체로
  const param = search.get("folder");
  const wanted = param ?? (memoryReady ? memory.last : null);
  const folderId = wanted && tree.byId.has(wanted) ? wanted : null;
  const folder = folderId ? tree.byId.get(folderId)! : null;
  const path = tree.pathTo(folderId);

  const openFolder = useCallback(
    (id: string | null) => {
      remember((m) => ({ ...m, last: id }));
      router.replace(id ? `/neander/shorts/projects?folder=${encodeURIComponent(id)}` : "/neander/shorts/projects", { scroll: false });
    },
    [remember, router],
  );
  // 기억한 폴더로 열렸으면 주소도 맞춘다 (새로 고침 · 링크 공유가 같은 곳을 가리키게)
  useEffect(() => {
    if (memoryReady && !param && folderId) router.replace(`/neander/shorts/projects?folder=${encodeURIComponent(folderId)}`, { scroll: false });
  }, [memoryReady, param, folderId, router]);

  // 펼침 = 사용자가 편 것 + 지금 폴더까지의 길
  const expanded = useMemo(() => new Set([...memory.expanded, ...path.slice(0, -1).map((f) => f.id)]), [memory.expanded, path]);
  const toggle = (id: string) => remember((m) => ({ ...m, expanded: expanded.has(id) ? m.expanded.filter((x) => x !== id) : [...m.expanded, id] }));
  const expand = (id: string) => remember((m) => (m.expanded.includes(id) ? m : { ...m, expanded: [...m.expanded, id] }));

  const live = useMemo(() => sc.projects.filter((p) => p.stage !== "archived"), [sc.projects]);
  const counts = useMemo(() => folderCounts(tree, live), [tree, live]);

  // ---- 오른쪽: 지금 폴더의 영상 ----
  const [status, setStatus] = useState<StatusTab>("all");
  const [stage, setStage] = useState<ProjectStage | "all">("all");
  const [kind, setKind] = useState<ProjectKind | "all">("all");
  const [vis, setVis] = useState<"all" | "private" | "team">("all");
  const [month, setMonth] = useState<string>("all");
  const [query, setQuery] = useState("");
  const here = useMemo(() => sc.projects.filter((p) => inFolder(tree, p.folderId, folderId)), [sc.projects, tree, folderId]);
  const hereLive = useMemo(() => here.filter((p) => p.stage !== "archived"), [here]);
  const stageUsable = status === "all" || status === "active";
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return here
      .filter(STATUS_OK[status])
      .filter((p) => !stageUsable || stage === "all" || p.stage === stage)
      .filter((p) => kind === "all" || p.kind === kind)
      .filter((p) => vis === "all" || p.kind === "brand" || p.visibility === vis)
      .filter((p) => month === "all" || p.month === month)
      .filter((p) => !q || [p.title, p.product, p.category, p.clientName].some((s) => s?.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [here, status, stageUsable, stage, kind, vis, month, query]);
  const filtered = stage !== "all" || kind !== "all" || vis !== "all" || month !== "all" || !!query.trim();
  const clearFilters = () => {
    setStage("all");
    setKind("all");
    setVis("all");
    setMonth("all");
    setQuery("");
  };
  const tabs = (["all", "active", "published", "archived"] as StatusTab[]).map((k) => ({
    key: k,
    label: tabLabel({ all: "전체", active: "진행 중", published: "게시됨", archived: "보관함" }[k], here.filter(STATUS_OK[k]).length),
  }));
  const kindsHere = (["coupang", "general", "brand"] as ProjectKind[]).filter((k) => hereLive.some((p) => p.kind === k));
  const monthsHere = useMemo(() => [...new Set(here.map((p) => p.month).filter((m): m is string => !!m))].sort().reverse(), [here]);
  const anyOwn = here.some((p) => p.kind !== "brand");

  // 숫자 줄 — 영상 편수와 플랫폼별 게시 건수는 다른 숫자다
  const hereIds = useMemo(() => new Set(hereLive.map((p) => p.id)), [hereLive]);
  const pubsHere = useMemo(() => sc.publications.filter((x) => hereIds.has(x.projectId)), [sc.publications, hereIds]);
  const pubCount = pubsHere.filter((x) => x.status === "published").length;
  const pubCheck = pubsHere.filter(pubNeedsCheck).length;
  const reviewWaiting = hereLive.filter((p) => p.kind === "brand" && p.review.state === "waiting").length;
  const reviewRevision = hereLive.filter((p) => p.kind === "brand" && p.review.state === "revision").length;
  // 게시할 수 있는 연결된 계정이 하나도 없을 때만 알린다 (실제 연결 상태 기준)
  const noPublishAccount = !d.accounts.some((a) => a.canPublish && a.status === "connected");

  // ---- 폴더 · 옮기기 ----
  const [creating, setCreating] = useState(false);
  // 다른 화면(대시보드 「새 영상」)에서 `?new=1` 로 오면 새 영상 창을 바로 연다 — 열고 나면 주소에서 뺀다
  const wantsNew = search.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    setCreating(true);
    router.replace(param ? `/neander/shorts/projects?folder=${encodeURIComponent(param)}` : "/neander/shorts/projects", { scroll: false });
  }, [wantsNew, param, router]);
  const [naming, setNaming] = useState<{ mode: "create"; parentId: string | null } | { mode: "rename"; folder: FolderView } | null>(null);
  const [moving, setMoving] = useState<{ ids: string[]; current: string | null } | null>(null);

  const moveVideos = async (ids: string[], target: string | null) => {
    const editable = ids.filter((id) => {
      const p = sc.projects.find((x) => x.id === id);
      return p && !isReadOnlyFor(p, d.me) && (p.folderId ?? null) !== target;
    });
    if (!editable.length) return;
    try {
      await mutate("project.move", { ids: editable, folderId: target });
      await refresh();
      const where = target ? `「${folderLabel(tree, target)}」` : "폴더 밖(전체 영상)";
      toast.success(editable.length > 1 ? `영상 ${editable.length}편을 ${where}으로 옮겼습니다.` : `${where}으로 옮겼습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "옮기지 못했습니다.");
    }
  };

  const deleteFolder = async (f: FolderView) => {
    const subs = tree.subtree(f.id).size - 1;
    const n = counts.total.get(f.id) ?? 0;
    const ok = await ask({
      title: `「${f.name}」 폴더를 지울까요?`,
      message: `${subs ? `하위 폴더 ${subs}개도 함께 지워집니다. ` : ""}안에 든 영상${n ? ` ${n}편` : ""}은 지워지지 않고 폴더 밖(전체 영상)으로 나옵니다.`,
      tone: "danger",
      confirmLabel: "폴더 지우기",
    });
    if (!ok) return;
    try {
      const r = await mutate<{ folders: number; videos: number }>("folder.delete", { id: f.id });
      if (folderId && tree.subtree(f.id).has(folderId)) openFolder(tree.parentOf(f.id));
      await refresh();
      toast.success(`폴더 ${r.folders}개를 지웠습니다${r.videos ? ` — 영상 ${r.videos}편은 폴더 밖으로` : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  };

  // 대행 — 같은 업체의 다른 프로젝트에서 수정 요청을 받은 영상 (프로젝트를 옮겨야 보인다)
  const siblings = useMemo(() => {
    if (!agency || !client) return [];
    return d.spaces
      .filter((s) => !s.archived && s.id !== currentSpace?.id && spaceKind(s) === "agency" && s.clientId === client.id)
      .map((s) => ({ space: s, revision: d.projects.filter((p) => p.kind === "brand" && spaceOf(p) === s.id && p.review.state === "revision" && p.stage !== "archived") }))
      .filter((x) => x.revision.length > 0);
  }, [agency, client, d.spaces, d.projects, currentSpace?.id]);

  const ctx: RowCtx = {
    me: d.me,
    tree,
    folderId,
    hasFolders: tree.byId.size > 0,
    revisionLimit: (p) => d.clients.find((c) => c.id === p.clientId)?.contract.revisionLimit ?? null,
    ownerName: (p) => (p.owner === d.me ? "나" : nameOf(p.owner)),
    pubCheck: (p) => sc.publications.filter((x) => x.projectId === p.id && pubNeedsCheck(x)).length,
    onMove: (p) => setMoving({ ids: [p.id], current: p.folderId ?? null }),
    onOut: (p) => void moveVideos([p.id], null),
  };

  return (
    <PageShell width="full">
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="영상"
        description={agency ? "계약 월별 제작 · 고객 승인 · 수정 상태를 확인하세요. 고객사 영상은 고객 승인을 받은 파일만 게시합니다." : "이 프로젝트의 제작 흐름과 완성 파일을 한곳에서 관리하세요. 영상 한 편 = 소스 · 쿠팡 확인 · 대본 · 편집 · 게시 · 성과."}
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            새 영상
          </Button>
        }
      />

      {agency && <AgencySummary client={client} />}
      {siblings.map(({ space, revision }) => (
        <StudioNotice
          key={space.id}
          tone="warning"
          className="mb-4"
          title={`다른 프로젝트 · ${space.name} — 수정 요청 ${revision.length}편`}
          action={
            <Button size="sm" variant="secondary" icon={ArrowUpRight} onClick={() => setSpace(space.id)}>
              그 프로젝트로 옮기기
            </Button>
          }
        >
          {revision
            .slice(0, 3)
            .map((p) => `${p.title} · 수정 ${p.review.revisionsUsed}/${ctx.revisionLimit(p) ?? "?"}회`)
            .join(" / ")}
          {revision.length > 3 ? ` 외 ${revision.length - 3}편` : ""}
        </StudioNotice>
      ))}

      {noPublishAccount && (
        <InlineNotice
          tone="neutral"
          icon={Plug}
          className="mb-4"
          action={
            <Link href="/neander/shorts/accounts" className={buttonClass("secondary", "sm")}>
              내 채널 · 연결
            </Link>
          }
        >
          SNS 게시 계정이 연결되지 않았습니다 — 게시하려면 계정 연결이 필요합니다. 소스 · 대본 · 편집 · 출력 · 다운로드는 그대로 쓸 수 있습니다.
        </InlineNotice>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[248px_minmax(0,1fr)] min-[1400px]:grid-cols-[288px_minmax(0,1fr)]">
        {/* ---- 왼쪽(모바일은 위): 폴더 ---- */}
        <aside
          aria-label="영상 폴더"
          className="nd-surface flex min-h-0 flex-col overflow-hidden rounded-nd-lg max-lg:max-h-[52vh] lg:sticky lg:top-[calc(var(--nd-topbar-h)+16px)] lg:max-h-[calc(100dvh-var(--nd-topbar-h)-32px)] lg:self-start"
        >
          <FolderPanel
            tree={tree}
            counts={counts}
            active={folderId}
            expanded={expanded}
            onOpen={openFolder}
            onToggle={toggle}
            onExpand={expand}
            onCreate={(parentId) => setNaming({ mode: "create", parentId })}
            onRename={(f) => setNaming({ mode: "rename", folder: f })}
            onDelete={(f) => void deleteFolder(f)}
            onDropVideos={(ids, target) => void moveVideos(ids, target)}
          />
        </aside>

        {/* ---- 오른쪽: 그 폴더의 영상 ---- */}
        <section aria-label={folder ? `「${folder.name}」 폴더의 영상` : "전체 영상"} className="min-w-0">
          <div className="mb-1 min-w-0">
            {path.length > 0 && (
              <nav aria-label="폴더 경로" className="mb-1 flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-nd-fg-3">
                <button type="button" className="rounded-nd-sm hover:text-nd-fg hover:underline" onClick={() => openFolder(null)}>
                  전체 영상
                </button>
                {path.slice(0, -1).map((f) => (
                  <span key={f.id} className="flex min-w-0 items-center gap-1">
                    <ChevronRight size={13} aria-hidden />
                    <button type="button" className="max-w-[14rem] truncate rounded-nd-sm hover:text-nd-fg hover:underline" onClick={() => openFolder(f.id)}>
                      {f.name}
                    </button>
                  </span>
                ))}
                <ChevronRight size={13} aria-hidden />
              </nav>
            )}
            <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[17px] font-semibold leading-snug text-nd-fg">
              <span className="min-w-0 truncate">{folder ? folder.name : "전체 영상"}</span>
              <span className="nd-num shrink-0 text-nd-body font-normal text-nd-fg-3">· {hereLive.length.toLocaleString("ko-KR")}편</span>
            </h2>
            {folder && <p className="mt-0.5 text-[13px] text-nd-fg-3">하위 폴더의 영상도 함께 보입니다. 영상을 끌어 왼쪽 폴더에 놓으면 옮겨집니다.</p>}
          </div>

          <Tabs className="mb-3" items={tabs} value={status} onChange={(k) => setStatus(k as StatusTab)} ariaLabel="영상 상태" />

          {/* 숫자 줄 — 버튼이 아니라 지금 폴더의 집계 */}
          <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="지금 폴더 집계">
            <Badge size="lg">영상 {hereLive.length.toLocaleString("ko-KR")}편</Badge>
            <Badge size="lg" tone="info">
              플랫폼별 게시 {pubCount.toLocaleString("ko-KR")}건
            </Badge>
            {pubCheck > 0 && (
              <Badge size="lg" tone="warning">
                게시 결과 확인 필요 {pubCheck}건
              </Badge>
            )}
            {reviewWaiting > 0 && (
              <Badge size="lg" tone="warning">
                고객 검토 중 {reviewWaiting}편
              </Badge>
            )}
            {reviewRevision > 0 && (
              <Badge size="lg" tone="danger">
                수정 요청 {reviewRevision}편
              </Badge>
            )}
          </div>

          <FormRow className={cn("mb-4 grid-cols-2", FILTER_COLS[1 + (kindsHere.length > 1 ? 1 : 0) + (monthsHere.length > 0 ? 1 : 0) + (anyOwn ? 1 : 0)])}>
            <Field label="영상 검색" className="col-span-2 lg:col-span-1">
              <SearchInput size="md" value={query} onValueChange={setQuery} placeholder={folder ? "이 폴더에서 제목 · 상품으로 찾기" : "제목 · 상품 · 고객사로 찾기"} ariaLabel="영상 검색" />
            </Field>
            <Field label="단계">
              <Select value={stageUsable ? stage : "all"} disabled={!stageUsable} onChange={(e) => setStage(e.target.value as typeof stage)} title={stageUsable ? undefined : "게시됨 · 보관함 탭에서는 단계를 고르지 않습니다"}>
                <option value="all">모든 단계</option>
                {STAGE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]} · {here.filter((p) => p.stage === s).length}
                  </option>
                ))}
              </Select>
            </Field>
            {kindsHere.length > 1 && (
              <Field label="종류">
                <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="all">모든 종류</option>
                  {kindsHere.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {monthsHere.length > 0 && (
              <Field label="계약 월">
                <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="all">모든 달</option>
                  {monthsHere.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {anyOwn && (
              <Field label="공개 범위">
                <Select value={vis} onChange={(e) => setVis(e.target.value as typeof vis)}>
                  <option value="all">모두</option>
                  <option value="private">나만 보기</option>
                  <option value="team">팀 공개</option>
                </Select>
              </Field>
            )}
          </FormRow>

          {rows.length === 0 ? (
            <div className="nd-surface rounded-nd-lg p-5">
              {here.length === 0 ? (
                <EmptyState
                  icon={Clapperboard}
                  title={folder ? "이 폴더에 영상이 없습니다" : "영상이 없습니다"}
                  description={folder ? "「새 영상」 으로 이 폴더에 만들거나, 다른 폴더의 영상을 끌어 왼쪽의 이 폴더에 놓으세요." : "소재 발굴에서 「영상 만들기」 를 누르거나 「새 영상」 으로 시작하세요."}
                  action={
                    <Button icon={Plus} onClick={() => setCreating(true)}>
                      새 영상
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon={Clapperboard}
                  title={status === "archived" && !filtered ? "보관한 영상이 없습니다" : "조건에 맞는 영상이 없습니다"}
                  description={filtered ? "검색어 · 단계 · 종류 고르기를 풀면 다시 보입니다." : "다른 상태 탭을 골라 보세요."}
                  action={
                    filtered ? (
                      <Button variant="secondary" onClick={clearFilters}>
                        고르기 모두 풀기
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </div>
          ) : (
            <>
              {/* 데스크톱 표 */}
              <div className="nd-surface hidden overflow-hidden rounded-nd-lg md:block">
                <TableScroll>
                  {/* 1400px 아래(폴더 칸 옆이 좁을 때)는 장면 · AI 비용을 완성 파일 칸 아래 줄로 접는다 */}
                  <Table size="md" className="min-w-[640px] min-[1400px]:min-w-[800px]">
                    <thead>
                      <tr>
                        <Th className="pl-5">제목 · 상품</Th>
                        <Th>{agency ? "단계 · 고객 검토" : "단계 · 쿠팡/고객사"}</Th>
                        <Th align="right" className={WIDE_ONLY}>
                          장면
                        </Th>
                        <Th align="right">
                          완성 파일<span className="min-[1400px]:hidden"> · 장면 · AI</span>
                        </Th>
                        <Th align="right" className={WIDE_ONLY} title="OpenRouter AI 사용료 합 (달러)">
                          AI 비용 ($)
                        </Th>
                        <Th>만든 사람 · 공개</Th>
                        <Th className="pr-5">수정</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <VideoRow key={p.id} p={p} ctx={ctx} onOpen={() => router.push(`/neander/shorts/projects/${p.id}`)} />
                      ))}
                    </tbody>
                  </Table>
                </TableScroll>
              </div>
              {/* 모바일 카드 */}
              <ul className="flex flex-col gap-2.5 md:hidden" aria-label="영상 목록">
                {rows.map((p) => (
                  <VideoCard key={p.id} p={p} ctx={ctx} onOpen={() => router.push(`/neander/shorts/projects/${p.id}`)} />
                ))}
              </ul>
            </>
          )}

          {sc.readOnlyMix && (
            <StudioNotice tone="info" className="mt-4" title="내 영상과 다른 사람의 영상">
              새 영상은 기본이 「나만 보기」 입니다. 관리자 보기에서 다른 사람의 비공개 영상은 <b>읽기 전용</b>으로 열립니다 — 고치기 · 생성 · 게시 · 폴더 옮기기는 소유자만 합니다.
            </StudioNotice>
          )}
          <p className="mt-3 text-[13px] text-nd-fg-3">
            {rows.length.toLocaleString("ko-KR")}편 표시 · 이 프로젝트({currentSpace?.name ?? "프로젝트"})에 속한 영상만 보입니다.
          </p>
        </section>
      </div>

      {creating && (
        <NewProjectDialog
          folderName={folder ? folderLabel(tree, folder.id) : null}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            if (folderId) await mutate("project.move", { ids: [id], folderId }).catch(() => undefined);
            await refresh();
            router.push(`/neander/shorts/projects/${id}`);
          }}
        />
      )}
      {naming?.mode === "create" && (
        <FolderNameDialog
          title="새 폴더"
          description={naming.parentId ? `「${folderLabel(tree, naming.parentId)}」 안에 만듭니다.` : "맨 위에 만듭니다."}
          initial=""
          confirmLabel="만들기"
          onClose={() => setNaming(null)}
          onSubmit={async (name) => {
            const r = await mutate<{ folder: FolderView }>("folder.create", { name, parentId: naming.parentId });
            if (naming.parentId) expand(naming.parentId);
            await refresh();
            setNaming(null);
            openFolder(r.folder.id);
          }}
        />
      )}
      {naming?.mode === "rename" && (
        <FolderNameDialog
          title="폴더 이름 바꾸기"
          initial={naming.folder.name}
          confirmLabel="바꾸기"
          onClose={() => setNaming(null)}
          onSubmit={async (name) => {
            await mutate("folder.rename", { id: naming.folder.id, name });
            await refresh();
            setNaming(null);
          }}
        />
      )}
      {moving && (
        <MoveVideosDialog
          tree={tree}
          count={moving.ids.length}
          current={moving.current}
          onClose={() => setMoving(null)}
          onMove={async (target) => {
            await moveVideos(moving.ids, target);
            setMoving(null);
          }}
        />
      )}
    </PageShell>
  );
}

// ---- 대행 계약 요약 ---------------------------------------------------

/** 대행 프로젝트 위 — 업체 계약(이번 달 계약분 · 고객 승인 · 월 계약 편수 · 수정 상한 · 담당 · 게시 방식) */
function AgencySummary({ client }: { client: ClientView | null }) {
  const { data, nameOf } = useShorts();
  const d = data!;
  if (!client) {
    return (
      <StudioNotice tone="warning" className="mb-4" title="이 대행 프로젝트의 업체를 찾지 못했습니다">
        업체가 지워졌거나 담당자에서 빠졌을 수 있습니다. 프로젝트 화면에서 업체 연결을 확인하세요.
      </StudioNotice>
    );
  }
  const m = currentMonth();
  const thisMonth = d.projects.filter((p) => p.kind === "brand" && p.clientId === client.id && p.month === m);
  const approved = thisMonth.filter((p) => p.review.state === "approved").length;
  const members = client.members.map((e) => (e === d.me ? "나" : nameOf(e))).join(" · ");
  return (
    <StudioNotice
      tone="info"
      className="mb-4"
      title={`대행 · ${client.name}`}
      action={
        <Link href={`/neander/shorts/clients/${client.id}`} className={buttonClass("secondary", "sm", "gap-1.5")}>
          <ArrowUpRight size={15} aria-hidden />
          업체 화면
        </Link>
      }
    >
      업체 전체 {Number(m.slice(5))}월 계약분 영상 <b className="nd-num">{thisMonth.length}</b>편 (고객 승인 <span className="nd-num">{approved}</span>편) / 월 <span className="nd-num">{client.contract.videosPerMonth}</span>편 계약 · 편당 수정 {client.contract.revisionLimit}회 · {CLIENT_DELIVERY_LABEL[client.delivery ?? "upload"]}
      {members ? ` · 담당 ${members}` : ""} · 관리자와 업체 담당자만 볼 수 있습니다.
    </StudioNotice>
  );
}

// ---- 영상 한 줄 · 카드 -------------------------------------------------

interface RowCtx {
  me: string;
  tree: FolderTree;
  folderId: string | null;
  hasFolders: boolean;
  revisionLimit: (p: ProjectDoc) => number | null;
  ownerName: (p: ProjectDoc) => string;
  pubCheck: (p: WithId<ProjectDoc>) => number;
  onMove: (p: WithId<ProjectDoc>) => void;
  onOut: (p: WithId<ProjectDoc>) => void;
}

const subLine = (p: ProjectDoc) =>
  p.kind === "brand" ? `${p.product || "제품 미정"}${p.month ? ` · ${Number(p.month.slice(5))}월 계약분` : ""}` : `${p.product || "상품 미정"}${p.category ? ` · ${p.category}` : ""}`;

/** 쿠팡 확인 · 고객사 검토 상태 — 글 한 줄과 색 (모바일 카드 · 표가 같이 쓴다) */
function partnerText(p: WithId<ProjectDoc>, ctx: RowCtx): { text: string; cls: string } {
  if (p.kind === "brand") {
    // 고객사는 프로젝트 띠에 이미 있다 — 마지막 검토 회차와 수정 횟수/상한만
    const limit = ctx.revisionLimit(p);
    const over = limit !== null && p.review.revisionsUsed > limit;
    const last = p.review.rounds[p.review.rounds.length - 1];
    const round = last ? `${last.n}차 ${{ pending: "검토 중", approved: "승인", revision: "수정 요청", withdrawn: "거둬들임" }[last.decision]} · ` : "";
    return { text: `${round}수정 ${p.review.revisionsUsed}/${limit ?? "?"}회${over ? " (상한 넘음)" : ""}`, cls: over ? "font-medium text-nd-danger-text" : "text-nd-fg-3" };
  }
  if (p.kind === "general") return { text: "일반 · 제휴 없음", cls: "text-nd-fg-3" };
  if (confirmedCandidate(p)) return { text: "쿠팡 제휴 · 동일 상품 확인함", cls: "font-medium text-nd-success-text" };
  if (p.coupang.candidates.length) return { text: `쿠팡 제휴 · 후보 ${p.coupang.candidates.length}개 (확인 전)`, cls: "text-nd-info-text" };
  return { text: "쿠팡 제휴 · 후보 없음", cls: "text-nd-fg-3" };
}

/** 표의 「단계 · 쿠팡/고객사」 칸 */
function StatusCell({ p, ctx }: { p: WithId<ProjectDoc>; ctx: RowCtx }) {
  const check = ctx.pubCheck(p);
  const pt = partnerText(p, ctx);
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <StageBadge stage={p.stage} size="lg" />
        {p.kind === "brand" && (
          <Badge size="lg" tone={REVIEW_TONE[p.review.state]}>
            {REVIEW_LABEL[p.review.state]}
          </Badge>
        )}
      </span>
      <span className={cn("whitespace-nowrap text-[13px]", pt.cls)}>{pt.text}</span>
      {check > 0 && <span className="whitespace-nowrap text-[13px] font-medium text-nd-warning-text">게시 결과 확인 필요 {check}건</span>}
    </span>
  );
}

/** 모바일 카드의 「단계」 · 「쿠팡 · 고객사」 */
function StageCell({ p, ctx }: { p: WithId<ProjectDoc>; ctx: RowCtx }) {
  const check = ctx.pubCheck(p);
  return (
    <span className="flex min-w-0 flex-col items-end gap-1">
      <StageBadge stage={p.stage} size="lg" />
      <span className={cn("text-[13px]", check ? "font-medium text-nd-warning-text" : "text-nd-fg-3")}>{check ? `게시 결과 확인 필요 ${check}건` : KIND_SHORT[p.kind]}</span>
    </span>
  );
}
function PartnerCell({ p, ctx }: { p: WithId<ProjectDoc>; ctx: RowCtx }) {
  const pt = partnerText(p, ctx);
  return (
    <span className="flex min-w-0 flex-col items-end gap-1">
      {p.kind === "brand" && (
        <Badge size="lg" tone={REVIEW_TONE[p.review.state]}>
          {REVIEW_LABEL[p.review.state]}
        </Badge>
      )}
      <span className={cn("text-[13px]", pt.cls)}>{pt.text}</span>
    </span>
  );
}

function FilesCell({ p }: { p: ProjectDoc }) {
  return p.renderIds.length ? (
    <span className="nd-num">{p.renderIds.length}개</span>
  ) : (
    <Badge size="lg">아직 없음</Badge>
  );
}

function CostCell({ p }: { p: ProjectDoc }) {
  const usd = projectCost(p).aiUsd;
  // 나가는 돈 — 빨강 · 「-」. 쓴 적 없으면 「—」
  return usd > 0 ? <span className="nd-num text-nd-danger-text">-{fmtUsd(usd)}</span> : <span className="text-nd-fg-3" title="AI 를 쓰지 않았습니다">—</span>;
}

function OwnerCell({ p, ctx }: { p: WithId<ProjectDoc>; ctx: RowCtx }) {
  const readOnly = isReadOnlyFor(p, ctx.me);
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5 max-md:items-end">
      <span className="whitespace-nowrap text-nd-fg">{ctx.ownerName(p)}</span>
      {p.kind === "brand" ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] text-nd-fg-2">
          {p.visibility === "team" ? <Users size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
          {p.visibility === "team" ? "팀 공개" : "업체 담당자 한정"}
        </span>
      ) : (
        <VisibilityChip visibility={p.visibility} readOnly={readOnly} />
      )}
    </span>
  );
}

function WhenCell({ p }: { p: ProjectDoc }) {
  const w = whenParts(p.updatedAt);
  if (!w) return <span className="text-nd-fg-3">—</span>;
  return (
    <span className="flex flex-col items-start whitespace-nowrap max-md:items-end">
      <span className="nd-num text-nd-fg">{w.day}</span>
      <span className="nd-num text-[13px] text-nd-fg-3">{w.time}</span>
    </span>
  );
}

/** 지금 폴더 기준 상대 경로 — 하위 폴더에 든 영상만 (지금 폴더 자신이면 빈 글) */
const folderText = (p: ProjectDoc, ctx: RowCtx) => (ctx.hasFolders ? folderLabel(ctx.tree, p.folderId, ctx.folderId) : "");

/** 폴더 옮기기 더보기(⋯) — 표 · 카드가 같이 쓴다 */
function MoveMenu({ p, ctx, className, hoverOnly = false }: { p: WithId<ProjectDoc>; ctx: RowCtx; className?: string; hoverOnly?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <span
      className={cn("shrink-0", hoverOnly && !menu && "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <IconButton ref={setAnchor} icon={MoreHorizontal} label={`「${p.title}」 더보기`} size="sm" onClick={() => setMenu((v) => !v)} />
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        anchorRef={{ current: anchor }}
        placement="bottom-end"
        items={[
          { key: "move", label: "폴더로 옮기기…", icon: FolderInput, onSelect: () => (setMenu(false), ctx.onMove(p)) },
          ...(p.folderId ? [{ key: "out", label: "폴더 밖으로", icon: FolderMinus, onSelect: () => (setMenu(false), ctx.onOut(p)) }] : []),
        ]}
      />
    </span>
  );
}

function VideoRow({ p, ctx, onOpen }: { p: WithId<ProjectDoc>; ctx: RowCtx; onOpen: () => void }) {
  const readOnly = isReadOnlyFor(p, ctx.me);
  const [dragging, setDragging] = useState(false);
  const sub = subLine(p);
  const where = folderText(p, ctx);
  const canMove = !readOnly && ctx.hasFolders;
  return (
    <Tr
      className={cn("group cursor-pointer", dragging && "opacity-50")}
      onClick={onOpen}
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData(VIDEO_DRAG_TYPE, JSON.stringify([p.id]));
        e.dataTransfer.setData("text/plain", p.title);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      data-video-row={p.id}
    >
      <Td className="w-full max-w-0 py-3 pl-5">
        <div className="flex min-w-0 items-center gap-3">
          {canMove && <GripVertical size={15} aria-hidden className="-ml-2 shrink-0 cursor-grab text-nd-fg-3 opacity-0 group-hover:opacity-100" />}
          <KindTile kind={p.kind} className="h-9 w-9" />
          <div className="min-w-0">
            <Link href={`/neander/shorts/projects/${p.id}`} className="block truncate font-semibold hover:underline" title={p.title} onClick={(e) => e.stopPropagation()} draggable={false}>
              {p.title}
            </Link>
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-nd-fg-3">
              <span className="truncate" title={sub}>
                {sub}
              </span>
              {where && (
                <span className="inline-flex min-w-0 shrink items-center gap-1" title={`폴더 · ${where}`}>
                  <Folder size={13} aria-hidden className="shrink-0" />
                  <span className="max-w-[10rem] truncate">{where}</span>
                </span>
              )}
              {p.sample && <SampleTag />}
            </div>
          </div>
          {/* 폴더 옮기기 — 표가 옆으로 길어도 늘 보이는 제목 칸 끝에 둔다 */}
          {canMove && <MoveMenu p={p} ctx={ctx} hoverOnly className="ml-auto pl-2" />}
        </div>
      </Td>
      <Td className="whitespace-nowrap">
        <StatusCell p={p} ctx={ctx} />
      </Td>
      <Td num className={cn("whitespace-nowrap", WIDE_ONLY)}>
        {p.scenes.length}개
      </Td>
      <Td num className="whitespace-nowrap">
        <span className="flex flex-col items-end gap-0.5">
          <FilesCell p={p} />
          <span className="text-[13px] text-nd-fg-3 min-[1400px]:hidden">
            장면 {p.scenes.length}개 · AI <CostCell p={p} />
          </span>
        </span>
      </Td>
      <Td num className={cn("whitespace-nowrap", WIDE_ONLY)}>
        <CostCell p={p} />
      </Td>
      <Td className="whitespace-nowrap">
        <OwnerCell p={p} ctx={ctx} />
      </Td>
      <Td className="whitespace-nowrap pr-5">
        <WhenCell p={p} />
      </Td>
    </Tr>
  );
}

/** 모바일 카드 — 단계 · 종류 · 파일 · 비용 · 소유자 · 공개 · 수정 시각을 이름과 함께 */
function VideoCard({ p, ctx, onOpen }: { p: WithId<ProjectDoc>; ctx: RowCtx; onOpen: () => void }) {
  const readOnly = isReadOnlyFor(p, ctx.me);
  const where = folderText(p, ctx);
  const field = (label: string, value: ReactNode) => (
    <>
      <dt className="whitespace-nowrap pt-0.5 text-nd-fg-3">{label}</dt>
      <dd className="min-w-0 text-right text-nd-fg">{value}</dd>
    </>
  );
  return (
    <li className="rounded-nd-lg border border-nd-line bg-nd-content px-4 py-3.5 active:bg-nd-sunken" onClick={onOpen}>
      <div className="flex min-w-0 items-start gap-3">
        <KindTile kind={p.kind} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <Link href={`/neander/shorts/projects/${p.id}`} className="block break-keep text-[15px] font-semibold leading-snug text-nd-fg" onClick={(e) => e.stopPropagation()}>
            {p.title}
          </Link>
          <p className="mt-0.5 text-[13px] text-nd-fg-3">
            {subLine(p)}
            {where ? ` · 폴더 ${where}` : ""}
          </p>
          {p.sample && (
            <span className="mt-1 inline-block">
              <SampleTag />
            </span>
          )}
        </div>
        {!readOnly && ctx.hasFolders && <MoveMenu p={p} ctx={ctx} className="-mr-1.5 -mt-1" />}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
        {field("단계 · 종류", <StageCell p={p} ctx={ctx} />)}
        {field(p.kind === "brand" ? "고객 검토" : "쿠팡 · 고객사", <PartnerCell p={p} ctx={ctx} />)}
        {field("장면", <span className="nd-num">{p.scenes.length}개</span>)}
        {field("완성 파일", <FilesCell p={p} />)}
        {field("AI 비용", <CostCell p={p} />)}
        {field("만든 사람 · 공개", <OwnerCell p={p} ctx={ctx} />)}
        {field("수정", <WhenCell p={p} />)}
      </dl>
    </li>
  );
}

// ---- 새 영상 창 ---------------------------------------------------------

function NewProjectDialog({ folderName, onClose, onCreated }: { folderName: string | null; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { currentSpace } = useShorts();
  // 대행 프로젝트면 그 업체의 브랜드 영상 (계약 월 · 제품)
  if (currentSpace && spaceKind(currentSpace) === "agency") return <NewAgencyVideo folderName={folderName} onClose={onClose} onCreated={onCreated} />;
  return <NewOwnVideo folderName={folderName} onClose={onClose} onCreated={onCreated} />;
}

interface FormatLite {
  id: string;
  name: string;
  archived?: boolean;
  korea: { status: string };
}
const KOREA: Record<string, string> = { unchecked: "국내 미확인", none_in_sample: "국내 표본에 없음", some: "국내에 조금", spread: "국내에 퍼짐" };

function NewAgencyVideo({ folderName, onClose, onCreated }: { folderName: string | null; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  const { data, currentSpace } = useShorts();
  const d = data!;
  const client = d.clients.find((c) => c.id === currentSpace?.clientId) ?? null;
  const [f, setF] = useState({ month: currentMonth(), productId: client?.products[0]?.id ?? "", title: "", formatId: "", brandTarget: "client" as "client" | "own" });
  // 바탕 형식(바이럴 형식 정찰 카드) — 업체 화면의 「영상 추가」 와 같은 목록
  const [formats, setFormats] = useState<FormatLite[] | null>(null);
  useEffect(() => {
    shortsGet<{ formats: FormatLite[] }>("scout").then(
      (r) => setFormats(r.formats.filter((x) => !x.archived)),
      () => setFormats([]),
    );
  }, []);
  // 그 달 계약분 — 업체 전체(이 업체의 대행 프로젝트 모두)
  const made = client ? d.projects.filter((p) => p.kind === "brand" && p.clientId === client.id && p.month === f.month).length : 0;
  const quota = client?.contract.videosPerMonth ?? 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title="고객사 영상 추가"
      description={`대행 · ${client?.name ?? "업체"} · ${currentSpace?.name ?? ""}${folderName ? ` — 「${folderName}」 폴더에 만듭니다` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            icon={Plus}
            loading={busy === "c"}
            disabled={busy === "c" || !client?.canEdit}
            onClick={() =>
              void run("c", async () => {
                const r = await mutate<{ id: string }>("client.createProject", { clientId: client!.id, spaceId: currentSpace!.id, month: f.month, productId: f.productId, formatId: f.formatId, brandTarget: f.brandTarget, title: f.title });
                await onCreated(r.id);
              })
            }
          >
            고객사 영상 만들기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!client ? (
          <InlineNotice tone="warning">이 대행 프로젝트의 업체를 찾지 못했습니다.</InlineNotice>
        ) : !client.canEdit ? (
          <InlineNotice tone="neutral">「{client.name}」 의 담당자만 영상을 만듭니다 — 업체 화면에서 담당자로 넣어 달라고 요청하세요.</InlineNotice>
        ) : null}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="계약 월">
            <Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value || currentMonth() })} />
          </Field>
          <Field label="제품" hint="제품의 확인된 사실이 대본 재료가 됩니다">
            <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
              <option value="">(제품 미정)</option>
              {(client?.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · 사실 {p.facts.length}개 · 사진 {p.photoIds.length}장
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <Field label="제목 (비우면 자동)">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="바탕 형식 (바이럴 형식 정찰)" hint={formats === null ? "불러오는 중…" : formats.length ? "형식의 훅 · 구성 · 편집이 참고 자료로 들어갑니다" : "정찰 형식 카드가 아직 없습니다"}>
            <Select value={f.formatId} onChange={(e) => setF({ ...f, formatId: e.target.value })}>
              <option value="">(형식 없이)</option>
              {(formats ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {KOREA[x.korea.status] ?? x.korea.status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="올릴 곳" hint="고객사 계정이면 자기 광고 · 우리 채널이면 「광고」 고지">
            <Select value={f.brandTarget} onChange={(e) => setF({ ...f, brandTarget: e.target.value as "client" | "own" })}>
              <option value="client">고객사 계정</option>
              <option value="own">우리 채널</option>
            </Select>
          </Field>
        </FormRow>
        {client && (
          <StudioNotice tone={quota > 0 && made >= quota ? "warning" : "info"} title={`${Number(f.month.slice(5))}월 계약분 ${made} / ${quota}편${quota > 0 && made >= quota ? " — 계약 편수를 채웠습니다" : ""}`}>
            편당 수정 {client.contract.revisionLimit}회 · {CLIENT_DELIVERY_LABEL[client.delivery ?? "upload"]} · 관리자와 업체 담당자만 봅니다. 이 영상을 만들면 {made + 1}편째입니다.
          </StudioNotice>
        )}
      </div>
    </Dialog>
  );
}

function NewOwnVideo({ folderName, onClose, onCreated }: { folderName: string | null; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  // 새 영상 기본 종류는 지금 프로젝트의 설정에서
  const { currentSpace } = useShorts();
  const [f, setF] = useState<{ kind: string; title: string; product: string; category: string; visibility: string }>({ kind: currentSpace?.defaultKind ?? "coupang", title: "", product: "", category: "", visibility: "private" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="새 영상"
      description={`자체 운영 · ${currentSpace?.name ?? "프로젝트"}${folderName ? ` — 「${folderName}」 폴더에 만듭니다` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            icon={Plus}
            loading={busy === "c"}
            disabled={busy === "c" || !f.product.trim()}
            onClick={() =>
              void run("c", async () => {
                const r = await mutate<{ id: string }>("project.create", f);
                await onCreated(r.id);
              })
            }
          >
            영상 만들기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="영상 종류">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="coupang">쿠팡 제휴 영상</option>
              <option value="general">일반 영상 (제휴 없음)</option>
            </Select>
          </Field>
          <Field label="공개 범위">
            <Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
              <option value="private">나만 보기</option>
              <option value="team">팀 공개</option>
            </Select>
          </Field>
        </FormRow>
        <p className="-mt-1 text-[13px] leading-relaxed text-nd-fg-3">
          {f.kind === "general" ? "제휴 링크 · 협찬 · 대가가 없는 영상 — 고지 문구 · 쿠팡 확인이 없습니다. 나중에 바꿀 수 있습니다." : "쿠팡 파트너스 링크를 거는 영상 — 쿠팡 동일 상품 확인 · 고지가 들어갑니다."}{" "}
          {f.visibility === "team" ? "팀 공개는 AI STUDIO 사용자 누구나 읽고 고칩니다. 지우기는 만든 사람만." : "나만 보기는 나와 관리자(읽기 전용)만 봅니다."}
        </p>
        <Field label={f.kind === "general" ? "다루는 것" : "상품"} required>
          <Input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="예: 접이식 주방 선반" autoFocus />
        </Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="제목 (비우면 상품명)">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="카테고리">
            <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="주방 · 수납 …" />
          </Field>
        </FormRow>
        {currentSpace && (
          <StudioNotice tone="info" title="프로젝트 기본값">
            {PRODUCTION_LABEL[currentSpace.production] ?? "직접 촬영"} · {WRITER_STYLE_LABEL[currentSpace.writerStyle] ?? "제품 소개 대본"} · 새 영상 기본 종류 {currentSpace.defaultKind === "general" ? "일반" : "쿠팡 제휴"}
            {folderName ? ` · 「${folderName}」 폴더` : " · 폴더 밖(전체 영상)"}. 업체(브랜드) 영상은 그 업체의 대행 프로젝트에서 만듭니다.
          </StudioNotice>
        )}
      </div>
    </Dialog>
  );
}
