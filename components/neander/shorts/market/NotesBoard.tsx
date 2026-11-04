"use client";

// ============================================================
//  트렌드 노트 — 4칸 보드(검토 전 · 지켜보기 · 대본으로 · 끝) + 노트 창
// ------------------------------------------------------------
//  MarketPage 의 「트렌드 노트」 탭. 2026-11-04 레퍼런스로 넓힘:
//  · 노트 창 오른쪽에 참고 영상(공식 재생기로 ERP 안에서 재생 · 넣을 때 숫자) · 사진(장면 모음 · 캡처) — NoteMedia.tsx
//  · 메모는 조사 정리처럼 긴 글도(2만 자) · 공유 범위 「나만 보기 / 팀 공개」(팀 공개는 이 프로젝트 사람들이 읽기만)
//  · 직접 적은 노트에 첫 영상을 넣으면 출처가 「레퍼런스」 가 된다(서버).
//  저장은 지금처럼 칸을 벗어나면 저절로 — 저장 버튼 없음.
// ============================================================

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Bookmark, CalendarDays, ExternalLink, ImageIcon, Lock, MoreHorizontal, PenLine, Pin, Plus, Search, Trash2, Users, Video } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FormRow,
  IconButton,
  Input,
  Menu,
  SegmentedControl,
  Select,
  Textarea,
  cn,
  useConfirm,
  useToast,
  type MenuItem,
} from "@/components/neander/ui";
import { fmtWhen } from "@/components/neander/shorts/parts";
import { SaveIndicator, StudioNotice, VisibilityChip, type StudioSaveState } from "@/components/neander/shorts/studio";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { shortsPost } from "@/lib/neander/shorts/client";
import { NOTE_MEMO_MAX, NOTE_SOURCE_LABEL, NOTE_STATUSES, NOTE_STATUS_LABEL, type NoteStatus, type NoteVisibility, type TrendNoteDoc } from "@/lib/neander/shorts/market";
import { NOTE_IMAGES_MAX, type NoteImage, type NoteVideo } from "@/lib/neander/shorts/note-media";
import { NoteImages, NoteThumb, NoteVideos, blobBase64, imageFilesOf, prepareNoteImage } from "./NoteMedia";

type WithId<T> = T & { id: string };
export type NoteView = WithId<TrendNoteDoc>;
type Editing = NoteView | "new" | null;
type Who = "all" | "mine" | "team";

const searchText = (x: NoteView) => [x.title, x.memo, x.snapshot, x.source.label, ...x.videos.flatMap((v) => [v.label, v.stats]), ...x.images.map((i) => i.caption)].join("\n").toLowerCase();

export function NotesTab({
  notes,
  me,
  setNotes,
  editing,
  setEditing,
}: {
  notes: NoteView[];
  me: string;
  setNotes: (f: (list: NoteView[]) => NoteView[]) => void;
  editing: Editing;
  setEditing: (x: Editing) => void;
}) {
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const { nameOf } = useShorts();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [who, setWho] = useState<Who>("all");
  const tags = [...new Set(notes.flatMap((x) => x.tags))].sort();
  const others = notes.some((x) => x.owner !== me);
  const needle = q.trim().toLowerCase();
  const shown = notes
    .filter((x) => (who === "all" || (who === "mine" ? x.owner === me : x.owner !== me)) && (!tag || x.tags.includes(tag)) && (!needle || searchText(x).includes(needle)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  /** 서버가 돌려준 노트로 목록을 바꾼다 (새 노트면 맨 앞에) */
  const put = (n: NoteView) => setNotes((list) => (list.some((y) => y.id === n.id) ? list.map((y) => (y.id === n.id ? n : y)) : [n, ...list]));
  const save = async (id: string | null, patch: Record<string, unknown>) => {
    try {
      const r = await shortsPost<{ note: NoteView }>("market", { action: "note.save", id, note: patch });
      put(r.note);
      return r.note;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "노트를 저장하지 못했습니다.");
      return null;
    }
  };
  const del = async (x: NoteView) => {
    if (
      !(await ask({
        title: "이 노트를 지울까요?",
        message: `${x.title}${x.images.length ? `\n사진 ${x.images.length}장도 같이 지워집니다.` : ""}`,
        confirmLabel: "지우기",
        tone: "danger",
      }))
    )
      return;
    try {
      await shortsPost("market", { action: "note.delete", id: x.id });
      setNotes((list) => list.filter((z) => z.id !== x.id));
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  };
  const toScript = (x: NoteView) => {
    const params = new URLSearchParams({
      new: "1",
      product: x.product || x.title,
      info: [x.snapshot, x.memo].filter(Boolean).join("\n").slice(0, 1500),
    });
    // 칸 옮기기는 내 노트만 (팀원의 노트는 읽기만)
    if (x.owner === me) void save(x.id, { status: "script" });
    router.push(`/neander/shorts/scripts?${params}`);
  };
  // 지금 열린 노트는 저장 뒤 새 값으로 (상태 · 고정 · 영상 · 사진을 바꿔도 창이 옛 값을 붙들지 않게)
  const current = editing && editing !== "new" ? (notes.find((x) => x.id === editing.id) ?? editing) : editing;

  return (
    <div className="space-y-4">
      <StudioNotice tone="info" title="트렌드 노트 · 레퍼런스" action={<VisibilityChip visibility="private" />}>
        기본은 나만 보기입니다. 노트를 「팀 공개」 로 바꾸면 이 프로젝트를 보는 사람들이 함께 읽습니다(고치기는 쓴 사람만). 노트에 영상 주소를 넣으면 ERP 안에서 바로 재생되고, 장면 모음 · 캡처 사진도 붙일 수 있습니다.
      </StudioNotice>
      {notes.length > 0 && (
        <FormRow className={cn("grid-cols-1", others ? "sm:grid-cols-[minmax(0,1fr)_200px_180px]" : "sm:grid-cols-[minmax(0,1fr)_200px]")}>
          <div className="relative min-w-0">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nd-fg-3" aria-hidden />
            <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 · 메모 · 숫자 · 영상 설명 검색" aria-label="노트 검색" />
          </div>
          {tags.length > 0 ? (
            <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="태그">
              <option value="">모든 태그</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </Select>
          ) : (
            <span />
          )}
          {others && (
            <Select value={who} onChange={(e) => setWho(e.target.value as Who)} aria-label="누구의 노트">
              <option value="all">모든 노트</option>
              <option value="mine">내 노트</option>
              <option value="team">팀원이 공개한 노트</option>
            </Select>
          )}
        </FormRow>
      )}
      {!notes.length ? (
        <EmptyState
          icon={Bookmark}
          title="아직 보관한 노트가 없습니다"
          description="브리핑 · 검색어 추이 · 레이더 상품 · 채널에서 「노트에 보관」 을 누르면 여기 모입니다. 참고할 영상 · 사진을 모으려면 새 노트를 만드세요."
          action={
            <Button icon={Plus} onClick={() => setEditing("new")}>
              새 노트
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {NOTE_STATUSES.map((st) => {
            const col = shown.filter((x) => x.status === st);
            return (
              <section key={st} aria-label={NOTE_STATUS_LABEL[st]} className="nd-surface flex min-w-0 flex-col rounded-nd-lg p-3 xl:min-h-[420px]">
                <div className="mb-2.5 flex items-center justify-between gap-2 px-1.5 pt-1">
                  <h3 className="flex items-center gap-2 text-[15px] font-bold text-nd-fg">
                    <span aria-hidden className={cn("h-2 w-2 rounded-full", { inbox: "bg-nd-accent", watch: "bg-nd-warning", script: "bg-nd-info", done: "bg-nd-success" }[st])} />
                    {NOTE_STATUS_LABEL[st]} <span className="nd-num text-nd-fg-3">· {col.length}</span>
                  </h3>
                  {st === "inbox" && (
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing("new")}>
                      노트 추가
                    </Button>
                  )}
                </div>
                <div className="space-y-2.5">
                  {col.map((x) => (
                    <NoteCard
                      key={x.id}
                      x={x}
                      mine={x.owner === me}
                      ownerName={nameOf(x.owner)}
                      onOpen={() => setEditing(x)}
                      onScript={() => toScript(x)}
                      onPin={() => void save(x.id, { pinned: !x.pinned })}
                      onMove={(s) => void save(x.id, { status: s })}
                      onDelete={() => void del(x)}
                    />
                  ))}
                  {!col.length && <p className="rounded-nd-md border border-dashed border-nd-line px-3 py-6 text-center text-[13px] text-nd-fg-3">{q || tag || who !== "all" ? "찾는 노트가 이 칸에 없습니다" : "이 칸에 노트가 없습니다"}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <NoteDialog
        note={current}
        me={me}
        ownerName={current && current !== "new" ? nameOf(current.owner) : ""}
        onClose={() => setEditing(null)}
        onSave={async (id, patch) => {
          const r = await save(id, patch);
          if (r && !id) setEditing(r);
          return !!r;
        }}
        onNote={put}
        onDelete={(x) => void del(x)}
        onScript={(x) => toScript(x)}
      />
    </div>
  );
}

function NoteCard({
  x,
  mine,
  ownerName,
  onOpen,
  onScript,
  onPin,
  onMove,
  onDelete,
}: {
  x: NoteView;
  mine: boolean;
  ownerName: string;
  onOpen: () => void;
  onScript: () => void;
  onPin: () => void;
  onMove: (s: NoteStatus) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const items: MenuItem[] = mine
    ? [
        { type: "label", key: "l", label: "칸 옮기기" },
        ...NOTE_STATUSES.map((s): MenuItem => ({ key: s, label: NOTE_STATUS_LABEL[s], icon: ArrowRightLeft, checked: x.status === s, disabled: x.status === s, onSelect: () => onMove(s) })),
        { type: "separator", key: "s1" },
        { key: "pin", label: x.pinned ? "고정 풀기" : "위에 고정", icon: Pin, onSelect: onPin },
        { key: "open", label: "노트 열기", icon: PenLine, onSelect: onOpen },
        { key: "del", label: "지우기", icon: Trash2, danger: true, onSelect: onDelete },
      ]
    : [{ key: "open", label: "노트 열기 (읽기 전용)", icon: PenLine, onSelect: onOpen }];
  const cover = x.images[0] ?? null;
  return (
    <article className="min-w-0 overflow-hidden rounded-nd-md border border-nd-line bg-nd-content shadow-nd-card">
      {cover && (
        <button type="button" onClick={onOpen} className="block w-full" aria-label={`「${x.title}」 열기`}>
          <NoteThumb image={cover} className="h-32 w-full" alt={cover.caption || x.title} />
        </button>
      )}
      <div className="p-3.5">
        <div className="flex items-start gap-2">
          <Badge tone={x.source.kind === "reference" ? "accent" : "neutral"} size="lg" className="shrink-0">
            {NOTE_SOURCE_LABEL[x.source.kind]}
          </Badge>
          <span className="flex-1" />
          {mine ? (
            <button
              type="button"
              onClick={onPin}
              aria-pressed={x.pinned}
              aria-label={x.pinned ? "고정 풀기" : "위에 고정"}
              title={x.pinned ? "고정 풀기" : "위에 고정"}
              className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] md:h-7 md:w-7", x.pinned ? "text-nd-accent" : "text-nd-fg-4 hover:bg-nd-sunken hover:text-nd-fg-2")}
            >
              <Pin size={15} fill={x.pinned ? "currentColor" : "none"} />
            </button>
          ) : null}
          <IconButton ref={ref} icon={MoreHorizontal} label={`「${x.title}」 ${mine ? "옮기기 · " : ""}더 보기`} size="sm" className="max-md:h-9 max-md:w-9" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
          <Menu open={menu} onClose={() => setMenu(false)} anchorRef={ref} placement="bottom-end" items={items} />
        </div>
        <button type="button" onClick={onOpen} className="mt-2 block w-full min-w-0 text-left">
          <span className="line-clamp-2 text-[15px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere] hover:underline">{x.title}</span>
          {x.memo && <span className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-nd-fg-2 [overflow-wrap:anywhere]">{x.memo}</span>}
        </button>
        {x.snapshot && <p className="nd-num mt-1.5 text-[13px] font-medium text-nd-accent-strong [overflow-wrap:anywhere]">{x.snapshot}</p>}
        {(x.videos.length > 0 || x.images.length > 0 || x.visibility === "team") && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-nd-fg-2">
            {x.videos.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Video size={13} aria-hidden /> 영상 <span className="nd-num">{x.videos.length}</span>
              </span>
            )}
            {x.images.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon size={13} aria-hidden /> 사진 <span className="nd-num">{x.images.length}</span>
              </span>
            )}
            {x.visibility === "team" && (
              <span className="inline-flex items-center gap-1">
                <Users size={13} aria-hidden /> 팀 공개{mine ? "" : ` · ${ownerName}`}
              </span>
            )}
          </p>
        )}
        {x.tags.length > 0 && <p className="mt-1 text-[13px] text-nd-fg-2">{x.tags.map((t) => `#${t}`).join(" ")}</p>}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-nd-line pt-2.5">
          <span className="min-w-0 truncate text-[13px] text-nd-fg-3" title={x.source.label}>
            {fmtWhen(x.updatedAt)}
            {x.source.label ? ` · ${x.source.label}` : ""}
          </span>
          <Button size="sm" variant="ghost" icon={PenLine} onClick={onScript} title="이 노트로 대본 작성기를 엽니다 (제품 이름 · 숫자 · 메모를 채워서)">
            대본으로
          </Button>
        </div>
      </div>
    </article>
  );
}

type SaveState = { s: StudioSaveState; at: number | null; retry: (() => void) | null };

/**
 * 노트 창 — 왼쪽 글(제목 · 메모 · 태그 · 상태) · 오른쪽 레퍼런스(참고 영상 · 사진).
 * 칸을 벗어나면 저장 (새 노트는 제목을 적고 벗어나면 만든다 — 영상 · 사진은 그다음). 팀원의 노트는 읽기만.
 */
function NoteDialog({
  note,
  me,
  ownerName,
  onClose,
  onSave,
  onNote,
  onDelete,
  onScript,
}: {
  note: Editing;
  me: string;
  ownerName: string;
  onClose: () => void;
  onSave: (id: string | null, patch: Record<string, unknown>) => Promise<boolean>;
  /** 영상 · 사진 동작이 돌려준 노트 */
  onNote: (n: NoteView) => void;
  onDelete: (x: NoteView) => void;
  onScript: (x: NoteView) => void;
}) {
  const toast = useToast();
  const ask = useConfirm();
  const x = note && note !== "new" ? note : null;
  const readOnly = !!x && x.owner !== me;
  const [f, setF] = useState({ title: "", memo: "", tags: "", product: "", visibility: "private" as NoteVisibility });
  const [state, setState] = useState<SaveState>({ s: "saved", at: null, retry: null });
  const [uploading, setUploading] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null | undefined>(undefined);
  // 다른 노트를 열면 칸을 그 노트 값으로 (같은 노트는 저장 뒤에도 쓰던 글을 덮지 않는다)
  if ((x?.id ?? null) !== lastId) {
    setLastId(x?.id ?? null);
    setF({ title: x?.title ?? "", memo: x?.memo ?? "", tags: (x?.tags ?? []).join(" "), product: x?.product ?? "", visibility: x?.visibility ?? "private" });
    setState({ s: "saved", at: x?.updatedAt ?? null, retry: null });
  }
  const push = (id: string | null, patch: Record<string, unknown>): Promise<boolean> =>
    new Promise((resolve) => {
      const go = () => {
        setState((p) => ({ ...p, s: "saving" }));
        void onSave(id, patch).then((ok) => {
          setState(ok ? { s: "saved", at: Date.now(), retry: null } : { s: "error", at: null, retry: go });
          resolve(ok);
        });
      };
      go();
    });
  const commit = (k: "title" | "memo" | "tags" | "product") => {
    if (readOnly) return;
    const v = f[k];
    if (!x) {
      if (k === "title" && v.trim())
        void push(null, { title: v, memo: f.memo, tags: f.tags, product: f.product, visibility: f.visibility, source: { kind: "manual", id: null, url: null, label: "직접 적음" } });
      return;
    }
    const prev = k === "tags" ? x.tags.join(" ") : x[k];
    if (v !== prev) void push(x.id, { [k]: v });
  };
  /** 영상 · 사진 동작 — 서버가 돌려준 노트로 바꾸고 저장 표시를 맞춘다 */
  const act = async (body: Record<string, unknown>, fallback: string): Promise<boolean> => {
    setState((p) => ({ ...p, s: "saving" }));
    try {
      const r = await shortsPost<{ note: NoteView }>("market", body);
      onNote(r.note);
      setState({ s: "saved", at: Date.now(), retry: null });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallback);
      setState((p) => ({ ...p, s: "saved" }));
      return false;
    }
  };
  const addVideo = (url: string) => (x ? act({ action: "note.video.add", id: x.id, url }, "영상을 넣지 못했습니다.") : Promise.resolve(false));
  const editVideos = (videos: NoteVideo[]) => (x ? push(x.id, { videos: videos.map((v) => ({ platform: v.platform, id: v.id, label: v.label, aspect: v.aspect })) }) : Promise.resolve(false));
  const upload = async (files: File[]) => {
    if (!x || readOnly || uploading) return;
    const room = NOTE_IMAGES_MAX - x.images.length;
    if (!files.length) return toast.error("그림 파일(JPG · PNG · WebP)만 넣을 수 있습니다.");
    if (room <= 0) return toast.error(`사진은 노트 하나에 ${NOTE_IMAGES_MAX}장까지 넣습니다.`);
    const list = files.slice(0, room);
    if (files.length > room) toast.info(`${room}장만 올립니다 (노트 하나에 ${NOTE_IMAGES_MAX}장까지).`);
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      setUploading(`${i + 1}/${list.length}`);
      try {
        const p = await prepareNoteImage(list[i]);
        const ok = await act({ action: "note.image.add", id: x.id, image: { name: p.name, w: p.w, h: p.h, base64: await blobBase64(p.full), thumbBase64: await blobBase64(p.thumb) } }, `「${list[i].name}」 을(를) 올리지 못했습니다.`);
        if (ok) added++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `「${list[i].name}」 을(를) 올리지 못했습니다.`);
      }
    }
    setUploading(null);
    if (added) toast.success(`사진 ${added}장을 넣었습니다.`);
  };
  const caption = (id: string, c: string) => x && void push(x.id, { images: x.images.map((i) => ({ id: i.id, caption: i.id === id ? c : i.caption })) });
  const removeImage = async (img: NoteImage) => {
    if (!x) return;
    if (!(await ask({ title: "이 사진을 지울까요?", message: img.caption || img.name, confirmLabel: "지우기", tone: "danger" }))) return;
    await act({ action: "note.image.delete", id: x.id, imageId: img.id }, "사진을 지우지 못했습니다.");
  };

  return (
    <Dialog
      open={!!note}
      onClose={onClose}
      size="full"
      className="relative"
      title={x ? (readOnly ? "트렌드 노트 · 읽기 전용" : "트렌드 노트") : "새 노트"}
      description={x ? `${NOTE_SOURCE_LABEL[x.source.kind]} · ${x.source.label || "직접 적음"}` : "제목을 적고 칸을 벗어나면 만들어집니다"}
      footer={
        <>
          {x && !readOnly && (
            <Button variant="ghost" icon={Trash2} onClick={() => onDelete(x)} className="mr-auto">
              지우기
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          {x && (
            <Button icon={PenLine} onClick={() => onScript(x)}>
              대본 작성기로
            </Button>
          )}
        </>
      }
    >
      <div
        className="grid gap-6 xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]"
        onPaste={(e) => {
          const files = imageFilesOf(e.clipboardData?.files);
          if (!files.length || !x || readOnly) return;
          e.preventDefault();
          void upload(files);
        }}
      >
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-nd-md bg-nd-sunken px-3 py-2">
            {readOnly ? (
              <VisibilityChip visibility="team" readOnly ownerName={ownerName} />
            ) : (
              <SegmentedControl<NoteVisibility>
                size="sm"
                ariaLabel="공유 범위"
                value={f.visibility}
                onChange={(v) => {
                  setF({ ...f, visibility: v });
                  if (x && v !== x.visibility) void push(x.id, { visibility: v });
                }}
                options={[
                  { value: "private", label: "나만 보기", icon: Lock },
                  { value: "team", label: "팀 공개", icon: Users, hint: "이 프로젝트를 보는 사람들이 읽습니다 (고치기는 나만)" },
                ]}
              />
            )}
            {(x || state.s !== "saved") && <SaveIndicator state={state.s} savedAt={state.at} onRetry={state.retry ?? undefined} />}
          </div>
          <Field label="제목">
            <Input value={f.title} maxLength={120} autoFocus={!x} readOnly={readOnly} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => commit("title")} />
          </Field>
          <Field label={`메모 · 조사 정리 (${f.memo.length.toLocaleString("ko-KR")}/${NOTE_MEMO_MAX.toLocaleString("ko-KR")}자)`}>
            <Textarea rows={x ? 16 : 6} value={f.memo} maxLength={NOTE_MEMO_MAX} readOnly={readOnly} onChange={(e) => setF({ ...f, memo: e.target.value })} onBlur={() => commit("memo")} />
          </Field>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="태그 (띄어쓰기로)">
              <Input value={f.tags} readOnly={readOnly} onChange={(e) => setF({ ...f, tags: e.target.value })} onBlur={() => commit("tags")} placeholder="예: 연애 AI영상 협찬" />
            </Field>
            <Field label="상태" hint={x ? undefined : "새 노트는 「검토 전」 에 들어갑니다"}>
              <Select value={x?.status ?? "inbox"} disabled={!x || readOnly} onChange={(e) => x && void push(x.id, { status: e.target.value })}>
                {NOTE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {NOTE_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </FormRow>
          <Field label="대본 작성기에 넘길 제품 이름" hint="비우면 노트 제목을 넘깁니다">
            <Input value={f.product} maxLength={120} readOnly={readOnly} onChange={(e) => setF({ ...f, product: e.target.value })} onBlur={() => commit("product")} />
          </Field>
          {x && (
            <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
              <p className="text-[14px] font-semibold text-nd-fg">원문 근거</p>
              <p className="mt-0.5 text-[14px] text-nd-fg-2 [overflow-wrap:anywhere]">
                {NOTE_SOURCE_LABEL[x.source.kind]} · {x.source.label || "직접 적음"} · 보관 {fmtWhen(x.createdAt)}
              </p>
              {x.snapshot && (
                <p className="nd-num mt-1.5 flex items-start gap-1.5 text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">
                  <CalendarDays size={14} className="mt-[2px] shrink-0" aria-hidden />
                  보관할 때 숫자 · {x.snapshot}
                </p>
              )}
              {x.source.url && (
                <a href={x.source.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-medium text-nd-accent-strong hover:underline">
                  <ExternalLink size={14} aria-hidden /> 근거 열기
                </a>
              )}
            </div>
          )}
          {!readOnly && <p className="text-[13px] text-nd-fg-3">칸을 벗어나면 저절로 저장됩니다.</p>}
        </div>
        <div className="min-w-0 space-y-8">
          {x ? (
            <>
              <NoteVideos videos={x.videos} readOnly={readOnly} onAdd={addVideo} onEdit={editVideos} />
              <NoteImages images={x.images} readOnly={readOnly} uploading={uploading} onFiles={(files) => void upload(files)} onCaption={caption} onDelete={(img) => void removeImage(img)} />
            </>
          ) : (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-nd-lg border border-dashed border-nd-line px-6 text-center">
              <Video size={22} className="text-nd-fg-3" aria-hidden />
              <p className="text-[14px] font-semibold text-nd-fg">참고 영상 · 사진</p>
              <p className="max-w-[420px] text-[13px] text-nd-fg-3">제목을 적고 칸을 벗어나면 노트가 만들어집니다. 그다음 유튜브 · 인스타 · 틱톡 영상 주소를 넣으면 여기서 바로 재생되고, 장면 모음 · 캡처 사진을 붙일 수 있습니다.</p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
