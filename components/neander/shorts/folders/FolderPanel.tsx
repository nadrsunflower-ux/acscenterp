"use client";

// ============================================================
//  영상 폴더 칸 — 「영상」 화면 왼쪽 (smoat Q 「결과물」 의 폴더 나무를 따른다)
// ------------------------------------------------------------
//  · 맨 위 「전체 영상」 은 시스템 줄(굵게 · 영상 아이콘 · 더보기 없음), 아래가 사용자 폴더(폴더 아이콘 · 들여쓰기).
//  · 폴더 이름 = 그 폴더를 연다 / 화살표 = 펼치기 · 접기만 / 더보기(⋯) = 이 안에 새 폴더 · 이름 바꾸기 · 지우기
//    (마우스를 올리거나 Tab 으로 닿으면 보이고, 터치 화면에서는 늘 보인다).
//  · 「새 폴더」 버튼은 한 곳 — 지금 고른 폴더 안에 만든다 (만들 자리를 버튼 아래에 적는다).
//  · 오른쪽 목록의 영상을 끌어 폴더 줄에 놓으면 옮긴다. 「전체 영상」 에 놓으면 폴더 밖으로.
//    접힌 폴더 위에 잠시 머물면 펼친다.
//  · 중첩 목록 + 링크/버튼으로 만든다 (role=tree 는 화살표 키 탐색을 다 갖추지 않으면 오히려 방해 — Q 와 같다).
// ============================================================

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Clapperboard, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button, IconButton, Menu, cn } from "@/components/neander/ui";
import { folderLabel, type FolderTree } from "@/lib/neander/shorts/folders";
import type { FolderView } from "@/lib/neander/shorts/types";

/** 끌어 옮기는 영상의 자료 종류 (다른 끌기와 섞이지 않게) */
export const VIDEO_DRAG_TYPE = "application/x-neander-shorts-video";

const INDENT = 16;
const MAX_INDENT_DEPTH = 5;
const ROW = "group flex min-h-[40px] min-w-0 items-center rounded-nd-md pr-1 transition-colors";

export interface FolderPanelProps {
  tree: FolderTree;
  counts: { total: Map<string, number>; all: number };
  /** null = 전체 영상 */
  active: string | null;
  expanded: ReadonlySet<string>;
  onOpen: (id: string | null) => void;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
  onCreate: (parentId: string | null) => void;
  onRename: (folder: FolderView) => void;
  onDelete: (folder: FolderView) => void;
  /** 영상을 폴더에 놓았다 (null = 폴더 밖으로) */
  onDropVideos: (ids: string[], folderId: string | null) => void;
  /** 읽기 전용 보기(관리자 몰아보기)면 폴더를 고치지 않는다 */
  readOnly?: boolean;
}

const dragIds = (e: DragEvent): string[] | null => {
  const raw = e.dataTransfer.getData(VIDEO_DRAG_TYPE);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
};
const carriesVideo = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VIDEO_DRAG_TYPE);

export function FolderPanel(props: FolderPanelProps) {
  const { tree, counts, active, expanded, readOnly } = props;
  const [over, setOver] = useState<string | "all" | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (hoverTimer.current && clearTimeout(hoverTimer.current)), []);

  /** 줄 하나를 놓을 곳으로 — key 는 폴더 id 또는 "all" */
  const dropProps = (key: string | "all", collapsedWithKids = false) =>
    readOnly
      ? {}
      : {
          onDragEnter: (e: DragEvent) => {
            if (!carriesVideo(e)) return;
            e.preventDefault();
            setOver(key);
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            if (collapsedWithKids && key !== "all") hoverTimer.current = setTimeout(() => props.onExpand(key), 650);
          },
          onDragOver: (e: DragEvent) => {
            if (!carriesVideo(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== key) setOver(key);
          },
          onDragLeave: (e: DragEvent) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setOver((o) => (o === key ? null : o));
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(null);
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            const ids = dragIds(e);
            if (ids?.length) props.onDropVideos(ids, key === "all" ? null : key);
          },
        };

  const branch = (parent: string | null, depth: number): ReactNode => {
    const kids = props.tree.children.get(parent) ?? [];
    if (!kids.length) return null;
    return (
      <ul className="space-y-0.5" role="group">
        {kids.map((f) => {
          const hasKids = Boolean(tree.children.get(f.id)?.length);
          const open = expanded.has(f.id);
          const selected = active === f.id;
          const n = counts.total.get(f.id) ?? 0;
          return (
            <li key={f.id}>
              <div
                {...dropProps(f.id, hasKids && !open)}
                data-folder-row={f.id}
                className={cn(
                  ROW,
                  selected ? "bg-nd-accent-soft text-nd-accent-strong" : "text-nd-fg hover:bg-nd-fg/[.05]",
                  over === f.id && "bg-nd-accent-soft ring-2 ring-inset ring-nd-accent",
                )}
                style={{ paddingLeft: 4 + Math.min(depth, MAX_INDENT_DEPTH) * INDENT }}
              >
                {hasKids ? (
                  <button
                    type="button"
                    onClick={() => props.onToggle(f.id)}
                    aria-label={`${f.name} ${open ? "접기" : "펼치기"}`}
                    aria-expanded={open}
                    className="flex h-8 w-6 shrink-0 items-center justify-center rounded-nd-sm text-nd-fg-3 hover:bg-nd-fg/[.08] hover:text-nd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
                  >
                    <ChevronRight size={15} aria-hidden className={cn("transition-transform", open && "rotate-90")} />
                  </button>
                ) : (
                  <span className="w-6 shrink-0" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => props.onOpen(f.id)}
                  aria-current={selected ? "page" : undefined}
                  title={folderLabel(tree, f.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-nd-sm py-2 pl-1 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
                >
                  {selected ? <FolderOpen size={17} aria-hidden className="shrink-0" /> : <Folder size={17} aria-hidden className="shrink-0 text-nd-fg-3" />}
                  <span className={cn("min-w-0 flex-1 truncate text-nd-body", selected && "font-semibold")}>{f.name}</span>
                  <span className="nd-num shrink-0 text-[13px] text-nd-fg-3" title={`${n.toLocaleString("ko-KR")}편 · 하위 폴더 포함`}>
                    {n.toLocaleString("ko-KR")}
                  </span>
                </button>
                {!readOnly && <RowMenu folder={f} onCreate={() => props.onCreate(f.id)} onRename={() => props.onRename(f)} onDelete={() => props.onDelete(f)} />}
              </div>
              {hasKids && open && branch(f.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const where = active ? folderLabel(tree, active) : null;
  const hasFolders = tree.byId.size > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-4">
        <h2 className="text-nd-section font-semibold text-nd-fg">영상</h2>
      </div>
      <div className="shrink-0 px-2">
        <div
          {...dropProps("all")}
          className={cn(
            ROW,
            "pl-1",
            active === null ? "bg-nd-accent-soft text-nd-accent-strong" : "text-nd-fg hover:bg-nd-fg/[.05]",
            over === "all" && "bg-nd-accent-soft ring-2 ring-inset ring-nd-accent",
          )}
          title={readOnly ? undefined : "영상을 여기에 놓으면 폴더 밖으로 꺼냅니다"}
        >
          <button
            type="button"
            onClick={() => props.onOpen(null)}
            aria-current={active === null ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-nd-sm py-2 pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
          >
            <Clapperboard size={17} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-nd-body font-semibold">전체 영상</span>
            <span className="nd-num shrink-0 text-[13px] text-nd-fg-3">{counts.all.toLocaleString("ko-KR")}</span>
          </button>
        </div>
      </div>
      {!readOnly && (
        <div className="shrink-0 px-3 pb-2 pt-2">
          <Button variant="secondary" size="sm" icon={FolderPlus} className="w-full" onClick={() => props.onCreate(active)}>
            새 폴더
          </Button>
          <p className="mt-1 truncate px-1 text-[13px] text-nd-fg-3" title={where ?? undefined}>
            {where ? `「${where}」 안에 추가` : "맨 위에 추가"}
          </p>
        </div>
      )}
      <nav aria-label="영상 폴더" className="nd-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {hasFolders ? (
          branch(null, 0)
        ) : (
          <p className="px-3 py-4 text-[13px] leading-relaxed text-nd-fg-3">
            아직 폴더가 없습니다. 「새 폴더」 로 시리즈 · 상품군 · 고객사별로 묶어 보세요. 영상을 끌어 폴더에 놓으면 옮겨집니다.
          </p>
        )}
      </nav>
    </div>
  );
}

function RowMenu({ folder, onCreate, onRename, onDelete }: { folder: FolderView; onCreate: () => void; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={ref}
        icon={MoreHorizontal}
        label={`「${folder.name}」 폴더 더보기`}
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className={cn("shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100", open && "opacity-100")}
      />
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        placement="bottom-end"
        items={[
          { key: "new", label: "이 안에 새 폴더", icon: FolderPlus, onSelect: () => (setOpen(false), onCreate()) },
          { key: "rename", label: "이름 바꾸기", icon: Pencil, onSelect: () => (setOpen(false), onRename()) },
          { type: "separator", key: "s" },
          { key: "delete", label: "폴더 지우기", icon: Trash2, danger: true, onSelect: () => (setOpen(false), onDelete()) },
        ]}
      />
    </>
  );
}
