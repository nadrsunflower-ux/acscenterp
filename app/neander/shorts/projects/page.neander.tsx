"use client";

// ============================================================
//  영상 — 왼쪽 폴더 칸 · 오른쪽 그 폴더의 영상 (smoat Q 「결과물」 의 폴더 체계)
// ------------------------------------------------------------
//  사용자 요청(2026-11-02): 「왼쪽 사이드바 오른쪽에 파일이 세로로 쭉 보이고 그에 따라
//  오른쪽 워크스페이스가 바뀌게」. 폴더 나무 · 개수 · 이름 규칙은 shorts/folders.ts.
//
//  · 폴더를 고르면 오른쪽이 그 폴더(하위 포함)의 영상으로 바뀐다. 고른 폴더는 주소(?folder=)와
//    이 브라우저에 기억해 다시 열 때 이어진다 — 지워진 폴더면 전체 영상으로.
//  · 「새 영상」 은 지금 폴더 안에 만든다. 영상은 끌어 폴더에 놓거나 줄의 더보기(⋯)로 옮긴다.
//  · 단계 탭 · 종류 · 검색은 지금 폴더 안에서 거른다.
//  · 쿠팡 제휴 · 고객사 · 일반 영상이 한 표에 섞인다 — 고객사 영상은 「쿠팡 · 고객사」 칸에
//    고객사 이름 · 검토 상태, 일반 영상은 「일반」.
//  · 넓은 화면은 회의록 · 메일처럼 화면 높이를 채운 창(폴더 칸 · 목록이 따로 스크롤),
//    좁은 화면은 폴더 칸이 위 · 목록이 아래로 쌓인다.
// ============================================================

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Clapperboard, FolderInput, FolderMinus, GripVertical, MoreHorizontal, Plug, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
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
  cn,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, SampleTag, StageBadge, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { FolderPanel, VIDEO_DRAG_TYPE } from "@/components/neander/shorts/folders/FolderPanel";
import { FolderNameDialog, MoveVideosDialog } from "@/components/neander/shorts/folders/FolderDialogs";
import { mutate } from "@/lib/neander/shorts/client";
import { folderCounts, folderLabel, folderTree, inFolder } from "@/lib/neander/shorts/folders";
import { REVIEW_LABEL, STAGE_LABEL, confirmedCandidate, projectCost } from "@/lib/neander/shorts/model";
import type { FolderView, ProjectDoc, ProjectKind, ProjectStage } from "@/lib/neander/shorts/types";

const REVIEW_TONE: Record<ProjectDoc["review"]["state"], Tone> = { none: "neutral", waiting: "warning", revision: "danger", approved: "success" };

/** 넓은 화면은 화면 높이를 채운 창 — 폴더 칸 · 목록이 따로 스크롤한다 (회의록과 같다) */
const FRAME = "lg:-mb-7 lg:flex lg:h-[calc(100dvh-var(--nd-topbar-h)-1.5rem)] lg:min-h-[560px] lg:flex-col";

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

/** 탭 이름 + 건수 (13px — 탭 기본 꼬리표보다 크게) */
const tabLabel = (label: string, n: number) => (
  <>
    {label}
    <span className="nd-num text-[13px] font-normal text-nd-fg-3">{n.toLocaleString("ko-KR")}</span>
  </>
);

export default function ProjectsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 경계가 있어야 정적 빌드가 된다
  return (
    <Suspense>
      <ProjectsInner />
    </Suspense>
  );
}

function ProjectsInner() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const ask = useConfirm();

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
  const [stage, setStage] = useState<ProjectStage | "all">("all");
  const [kind, setKind] = useState<ProjectKind | "all">("all");
  const [query, setQuery] = useState("");
  const here = useMemo(() => sc.projects.filter((p) => inFolder(tree, p.folderId, folderId)), [sc.projects, tree, folderId]);
  const hereLive = here.filter((p) => p.stage !== "archived");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return here
      .filter((p) => (stage === "all" ? p.stage !== "archived" : p.stage === stage))
      .filter((p) => kind === "all" || p.kind === kind)
      .filter((p) => !q || [p.title, p.product, p.category, p.clientName].some((s) => s?.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [here, stage, kind, query]);
  const tabs = [
    { key: "all", label: tabLabel("진행 중", hereLive.length) },
    ...(Object.keys(STAGE_LABEL) as ProjectStage[])
      .map((s) => ({ key: s, n: here.filter((p) => p.stage === s).length }))
      .filter((t) => t.n > 0)
      .map((t) => ({ key: t.key, label: tabLabel(STAGE_LABEL[t.key], t.n) })),
  ];
  // 지금 단계 탭에 영상이 없어지면(폴더를 바꿈) 진행 중으로
  useEffect(() => {
    if (stage !== "all" && !here.some((p) => p.stage === stage)) setStage("all");
  }, [here, stage]);
  const kindsHere = (["coupang", "general", "brand"] as ProjectKind[]).filter((k) => hereLive.some((p) => p.kind === k));
  // 게시할 수 있는 연결된 계정이 하나도 없을 때만 알린다 (실제 연결 상태 기준)
  const noPublishAccount = !d.accounts.some((a) => a.canPublish && a.status === "connected");

  // ---- 폴더 · 옮기기 ----
  const [creating, setCreating] = useState(false);
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

  return (
    <PageShell width="full" className={FRAME}>
      <Card padding="none" className="lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        {/* ---- 왼쪽: 폴더 ---- */}
        <aside
          aria-label="영상 폴더"
          className="flex min-h-0 flex-col border-b border-nd-line max-lg:max-h-[46vh] lg:w-[288px] lg:shrink-0 lg:border-b-0 lg:border-r lg:bg-nd-sunken/50"
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
        <section aria-label={folder ? `「${folder.name}」 폴더의 영상` : "전체 영상"} className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          <header className="shrink-0 px-5 pb-3 pt-4">
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
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h1 className="flex min-w-0 items-baseline gap-2 text-nd-title font-semibold text-nd-fg">
                  <span className="truncate">{folder ? folder.name : "전체 영상"}</span>
                  <span className="nd-num shrink-0 text-nd-body font-normal text-nd-fg-3">영상 {hereLive.length.toLocaleString("ko-KR")}편</span>
                </h1>
                <p className="mt-0.5 text-[13px] text-nd-fg-3">
                  {folder
                    ? `하위 폴더의 영상도 함께 보입니다. 영상을 끌어 왼쪽 폴더에 놓으면 옮겨집니다.`
                    : "영상 한 편 = 소스 · 쿠팡 확인(또는 고객사 브리프) · 대본 · 편집 · 검토 · 게시 · 성과. 고객사 영상은 고객사 화면에서 만듭니다."}
                </p>
              </div>
              <Button icon={Plus} onClick={() => setCreating(true)}>
                새 영상
              </Button>
            </div>
          </header>

          {noPublishAccount && (
            <div className="shrink-0 px-5 pb-3">
              <InlineNotice tone="neutral" icon={Plug} action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="secondary">내 채널 · 연결</Button></Link>}>
                SNS 게시 계정이 연결되지 않았습니다 — 게시하려면 계정 연결이 필요합니다. 소스 · 대본 · 편집 · 출력 · 다운로드는 그대로 쓸 수 있습니다.
              </InlineNotice>
            </div>
          )}

          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-nd-line px-5 pb-2">
            <Tabs className="min-w-0 flex-1 border-b-0" items={tabs} value={stage} onChange={(k) => setStage(k as typeof stage)} ariaLabel="단계" />
            <div className="flex shrink-0 items-center gap-2 pb-1">
              {kindsHere.length > 1 && (
                <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="종류" className="w-[9.5rem]">
                  <option value="all">모든 종류</option>
                  {kindsHere.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
              <SearchInput value={query} onValueChange={setQuery} placeholder={folder ? "이 폴더에서 검색" : "영상 검색"} ariaLabel="영상 검색" className="w-[15rem]" />
            </div>
          </div>

          <div className="nd-scroll min-h-0 flex-1 overflow-auto">
            {rows.length === 0 ? (
              <div className="p-5">
                {here.length === 0 ? (
                  <EmptyState
                    icon={Clapperboard}
                    title={folder ? "이 폴더에 영상이 없습니다" : "영상이 없습니다"}
                    description={folder ? "「새 영상」 으로 이 폴더에 만들거나, 다른 폴더의 영상을 끌어 왼쪽의 이 폴더에 놓으세요." : "소재 발굴에서 「영상 만들기」 를 누르거나 「새 영상」 으로 시작하세요."}
                    action={<Button onClick={() => setCreating(true)}>새 영상</Button>}
                  />
                ) : (
                  <p className="py-10 text-center text-nd-body text-nd-fg-3">조건에 맞는 영상이 없습니다.</p>
                )}
              </div>
            ) : (
              <TableScroll>
                <Table size="md" minWidth={1080}>
                  <thead>
                    <tr>
                      <Th>제목 · 상품</Th>
                      {tree.byId.size > 0 && <Th>폴더</Th>}
                      <Th>단계</Th>
                      <Th>쿠팡 · 고객사</Th>
                      <Th align="right">장면</Th>
                      <Th align="right">완성 파일</Th>
                      <Th align="right">AI 비용</Th>
                      <Th>만든 사람 · 공개</Th>
                      <Th align="right">수정</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <VideoRow
                        key={p.id}
                        p={p}
                        me={d.me}
                        ownerName={nameOf(p.owner)}
                        folderText={tree.byId.size > 0 ? folderLabel(tree, p.folderId, folderId) : null}
                        hasFolders={tree.byId.size > 0}
                        onOpen={() => router.push(`/neander/shorts/projects/${p.id}`)}
                        onMove={() => setMoving({ ids: [p.id], current: p.folderId ?? null })}
                        onOut={() => void moveVideos([p.id], null)}
                      />
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </div>
        </section>
      </Card>

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

function VideoRow({
  p,
  me,
  ownerName,
  folderText,
  hasFolders,
  onOpen,
  onMove,
  onOut,
}: {
  p: ProjectDoc & { id: string };
  me: string;
  ownerName: string;
  /** 지금 폴더 기준 상대 경로 (null = 폴더 칸 없음) */
  folderText: string | null;
  hasFolders: boolean;
  onOpen: () => void;
  onMove: () => void;
  onOut: () => void;
}) {
  const readOnly = isReadOnlyFor(p, me);
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const c = confirmedCandidate(p);
  const sub = p.kind === "brand" ? p.product || "제품 미정" : `${p.product || "상품 미정"}${p.category ? ` · ${p.category}` : ""}`;
  return (
    <Tr
      className={cn("group cursor-pointer", dragging && "opacity-50")}
      onClick={onOpen}
      draggable={!readOnly && hasFolders}
      onDragStart={(e) => {
        e.dataTransfer.setData(VIDEO_DRAG_TYPE, JSON.stringify([p.id]));
        e.dataTransfer.setData("text/plain", p.title);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      data-video-row={p.id}
    >
      <Td className="w-full max-w-0">
        <div className="flex min-w-0 items-center gap-3">
          {!readOnly && hasFolders && (
            <GripVertical size={15} aria-hidden className="-ml-1 shrink-0 cursor-grab text-nd-fg-3 opacity-0 group-hover:opacity-100" />
          )}
          <KindTile kind={p.kind} className="h-9 w-9" />
          <div className="min-w-0">
            <Link href={`/neander/shorts/projects/${p.id}`} className="block truncate font-medium hover:underline" title={p.title} onClick={(e) => e.stopPropagation()} draggable={false}>
              {p.title}
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] text-nd-fg-3" title={sub}>
                {sub}
              </span>
              {p.sample && <SampleTag />}
            </div>
          </div>
          {/* 폴더 옮기기 — 표가 옆으로 길어도 늘 보이는 제목 칸 끝에 둔다 */}
          {!readOnly && hasFolders && (
            <span className="ml-auto shrink-0 pl-2" onClick={(e) => e.stopPropagation()}>
              <IconButton
                ref={setAnchor}
                icon={MoreHorizontal}
                label={`「${p.title}」 더보기`}
                size="sm"
                onClick={() => setMenu((v) => !v)}
                className={cn("opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100", menu && "opacity-100")}
              />
              <Menu
                open={menu}
                onClose={() => setMenu(false)}
                anchorRef={{ current: anchor }}
                placement="bottom-end"
                items={[
                  { key: "move", label: "폴더로 옮기기…", icon: FolderInput, onSelect: () => (setMenu(false), onMove()) },
                  ...(p.folderId ? [{ key: "out", label: "폴더 밖으로", icon: FolderMinus, onSelect: () => (setMenu(false), onOut()) }] : []),
                ]}
              />
            </span>
          )}
        </div>
      </Td>
      {folderText !== null && (
        <Td className="whitespace-nowrap">
          {folderText ? (
            <span className="block max-w-[12rem] truncate text-[13px] text-nd-fg-2" title={folderText}>
              {folderText}
            </span>
          ) : (
            <span className="text-nd-fg-3">—</span>
          )}
        </Td>
      )}
      <Td className="whitespace-nowrap">
        <StageBadge stage={p.stage} size="lg" />
      </Td>
      <Td className="whitespace-nowrap">
        {p.kind === "brand" ? (
          <span className="flex items-center gap-2">
            <Link href={`/neander/shorts/clients/${p.clientId}`} className="max-w-[140px] truncate hover:underline" title={p.clientName || "고객사"} onClick={(e) => e.stopPropagation()}>
              {p.clientName || "고객사"}
            </Link>
            <Badge size="lg" tone={REVIEW_TONE[p.review.state]}>
              {REVIEW_LABEL[p.review.state]}
            </Badge>
          </span>
        ) : p.kind === "general" ? (
          <Badge size="lg">일반 · 제휴 없음</Badge>
        ) : c ? (
          <Badge size="lg" tone="success">
            쿠팡 확인함
          </Badge>
        ) : p.coupang.candidates.length ? (
          <Badge size="lg" tone="info">
            쿠팡 후보 {p.coupang.candidates.length}개
          </Badge>
        ) : (
          <span className="text-nd-fg-3" title="아직 쿠팡 후보가 없습니다">
            —
          </span>
        )}
      </Td>
      <Td num>{p.scenes.length}</Td>
      <Td num>{p.renderIds.length}</Td>
      <Td num>{fmtUsd(projectCost(p).aiUsd || null)}</Td>
      <Td className="whitespace-nowrap">
        <span className="text-nd-fg-2">
          {p.owner === me ? "나" : ownerName} · {p.visibility === "team" ? "팀" : "나만"}
        </span>
        {readOnly && <div className="text-[13px] text-nd-fg-3">읽기 전용</div>}
      </Td>
      <Td num muted className="whitespace-nowrap">
        {fmtWhen(p.updatedAt)}
      </Td>
    </Tr>
  );
}

function NewProjectDialog({ folderName, onClose, onCreated }: { folderName: string | null; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  // 새 영상 기본 종류는 지금 프로젝트의 설정에서
  const { currentSpace } = useShorts();
  const [f, setF] = useState<{ kind: string; title: string; product: string; category: string; visibility: string }>({ kind: currentSpace?.defaultKind ?? "coupang", title: "", product: "", category: "", visibility: "private" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="새 영상"
      description={`${folderName ? `「${folderName}」 폴더에 만듭니다. ` : ""}고객사(브랜드) 영상은 고객사 화면의 「영상 추가」 로 만듭니다.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={busy === "c" || !f.product.trim()}
            onClick={() =>
              void run("c", async () => {
                const r = await mutate<{ id: string }>("project.create", f);
                await onCreated(r.id);
              })
            }
          >
            만들기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="종류" hint={f.kind === "general" ? "제휴 링크 · 협찬 · 대가가 없는 영상 — 고지 문구 · 쿠팡 확인이 없습니다. 나중에 바꿀 수 있습니다." : "쿠팡 파트너스 링크를 거는 영상 — 쿠팡 동일 상품 확인 · 고지가 들어갑니다."}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="coupang">쿠팡 제휴 영상</option>
            <option value="general">일반 영상 (제휴 없음)</option>
          </Select>
        </Field>
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
        <Field label="공개 범위" hint="팀 보기는 AI STUDIO 사용자 누구나 읽고 고칩니다. 지우기는 만든 사람만.">
          <Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
            <option value="private">나만 보기</option>
            <option value="team">팀 보기</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
