"use client";

// ============================================================
//  트렌드 노트의 참고 영상 · 사진 (레퍼런스) — NotesBoard 의 노트 창 오른쪽
// ------------------------------------------------------------
//  · 영상: 주소를 붙여 넣으면 서버가 공식 재생기 주소 · 그때 숫자를 남긴다(note.video.add). 유튜브 · 틱톡은 공식
//    삽입 iframe. 인스타는 공식 재생기가 4:3 · 16:9 릴스를 4:5 칸으로 틀어 깨지므로(note-media.ts 머리말) 볼 때
//    영상 파일 주소를 받아 우리 <video> 로 실제 비율대로 튼다. 못 받거나 재생이 안 되면 공식 재생기(높이 알림 MEASURE).
//  · 사진: 브라우저가 긴 변 2400px · 850KB 안으로 줄이고 작은 그림(480px)을 따로 만들어 보낸다(note.image.add).
//    <img> 는 로그인 머리글을 못 붙여서 Blob 으로 받아 주소를 만들고, 한 번 받은 것은 이 탭이 들고 있는다.
//  · 사진을 누르면 창 안에서 크게 본다(겹친 창을 띄우지 않는다 — Esc 가 노트 창까지 닫지 않게).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, ImagePlus, Link2, Loader2, Play, Plus, Trash2, Video, X } from "lucide-react";
import { Badge, Button, DropZone, FieldAction, FormRow, IconButton, Input, cn, useConfirm } from "@/components/neander/ui";
import { fmtWhen } from "@/components/neander/shorts/parts";
import { shortsBlob, shortsGet } from "@/lib/neander/shorts/client";
import {
  INSTAGRAM_ORIGIN,
  NOTE_IMAGES_MAX,
  NOTE_IMAGE_LONG_SIDE,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_IMAGE_TYPES,
  NOTE_THUMB_LONG_SIDE,
  NOTE_THUMB_MAX_BYTES,
  NOTE_VIDEOS_MAX,
  NOTE_VIDEO_PLATFORM_LABEL,
  aspectRatio,
  instagramMeasure,
  noteVideoEmbedUrl,
  noteVideoKey,
  playerBoxRatio,
  type InstagramMedia,
  type NoteImage,
  type NoteVideo,
} from "@/lib/neander/shorts/note-media";

// ---- 영상 ----------------------------------------------------------------------

/** 재생기 하나 — 유튜브 · 틱톡은 공식 재생기를 비율 틀에, 인스타는 우리 재생기(안 되면 공식 재생기) */
export function VideoFrame({ video, className }: { video: NoteVideo; className?: string }) {
  const title = `${NOTE_VIDEO_PLATFORM_LABEL[video.platform]} 영상${video.label ? ` — ${video.label}` : ""}`;
  if (video.platform === "instagram") return <InstagramPlayer video={video} title={title} className={className} />;
  return (
    <div className={cn("relative w-full overflow-hidden bg-black", className)} style={{ paddingBottom: `${aspectRatio(video.aspect) * 100}%` }}>
      <iframe
        src={noteVideoEmbedUrl(video)}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}

// ---- 인스타 — 볼 때 영상 파일 주소를 받는다 (만료 5분 전까지 이 탭이 들고 있음) ------------------------

const igMedia = new Map<string, { until: number; p: Promise<InstagramMedia> }>();

function instagramMediaOf(code: string): Promise<InstagramMedia> {
  const hit = igMedia.get(code);
  if (hit && hit.until > Date.now()) return hit.p;
  const entry = { until: Date.now() + 60_000, p: shortsGet<{ media: InstagramMedia }>(`market?igMedia=${encodeURIComponent(code)}`).then((r) => r.media) };
  entry.p.then(
    (m) => (entry.until = m.expiresAt - 5 * 60_000),
    () => igMedia.delete(code),
  );
  igMedia.set(code, entry);
  return entry.p;
}

/** 한 영상을 틀면 다른 노트 영상은 멈춘다 */
const PLAY_EVENT = "neander:note-video-play";

/**
 * 인스타 영상 — 칸은 영상의 실제 비율 (세로는 4:5 까지 · 양옆 검게). 틀기 전에는 표지 + 재생 단추.
 * 파일이 없으면(인스타가 ERP 안 재생을 막은 게시물) 표지 + 「인스타에서 보기」. 받기 · 재생이 안 되면 공식 재생기.
 */
function InstagramPlayer({ video, title, className }: { video: NoteVideo; title: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [media, setMedia] = useState<InstagramMedia | null>(null);
  const [official, setOfficial] = useState(false);
  const [ratio, setRatio] = useState(5 / 4);
  const [started, setStarted] = useState(false);
  const [posterOk, setPosterOk] = useState(true);

  // 화면 가까이 와야 받는다 (노트 하나에 영상 12개까지)
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    instagramMediaOf(video.id).then(
      (m) => {
        if (!live) return;
        if (m.src || m.poster) setMedia(m);
        else setOfficial(true);
      },
      () => live && setOfficial(true),
    );
    return () => {
      live = false;
    };
  }, [near, video.id]);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<HTMLVideoElement>).detail !== player.current) player.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, on);
    return () => window.removeEventListener(PLAY_EVENT, on);
  }, []);

  if (official) return <OfficialInstagramFrame video={video} title={title} className={className} />;

  const start = () => {
    setStarted(true);
    void player.current?.play().catch(() => {});
  };
  const poster =
    media?.poster && posterOk ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={media.poster} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setPosterOk(false)} className="absolute inset-0 h-full w-full object-cover" />
    ) : null;

  return (
    <div ref={box} className={cn("relative w-full overflow-hidden bg-black", className)} style={{ paddingBottom: `${ratio * 100}%` }}>
      {media?.src && (
        <video
          ref={player}
          src={media.src}
          title={title}
          preload="metadata"
          playsInline
          controls={started}
          className="absolute inset-0 h-full w-full object-contain"
          onLoadedMetadata={(e) => setRatio(playerBoxRatio(e.currentTarget.videoWidth, e.currentTarget.videoHeight))}
          onPlay={(e) => {
            setStarted(true);
            window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: e.currentTarget }));
          }}
          onError={() => setOfficial(true)}
        />
      )}
      {!media ? (
        <span className="absolute inset-0 flex items-center justify-center text-white/70">
          <Loader2 size={20} className="animate-spin" aria-label="영상을 불러오는 중" />
        </span>
      ) : media.src ? (
        !started && (
          <button type="button" onClick={start} aria-label={`${title} 재생`} className="group absolute inset-0 flex items-center justify-center">
            {poster}
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white transition-colors group-hover:bg-black/75">
              <Play size={26} fill="currentColor" className="translate-x-0.5" aria-hidden />
            </span>
          </button>
        )
      ) : (
        <div className="absolute inset-0">
          {poster}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-4 text-center">
            <p className="text-[14px] font-medium leading-relaxed text-white">
              인스타가 ERP 안 재생을 막은 영상입니다
              <br />
              <span className="text-[13px] font-normal text-white/80">(주로 음악 저작권)</span>
            </p>
            <a
              href={video.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-semibold text-black hover:bg-white/90"
            >
              <ExternalLink size={14} aria-hidden /> 인스타에서 보기
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** 공식 인스타 재생기 — 우리 재생기가 안 될 때만. 높이는 재생기가 보내는 알림(MEASURE)대로 */
function OfficialInstagramFrame({ video, title, className }: { video: NoteVideo; title: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(620);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== INSTAGRAM_ORIGIN || e.source !== ref.current?.contentWindow) return;
      const h = instagramMeasure(e.data);
      if (h) setHeight(h);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  return (
    <iframe
      ref={ref}
      src={noteVideoEmbedUrl(video)}
      title={title}
      loading="lazy"
      scrolling="no"
      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen"
      allowFullScreen
      className={cn("block w-full border-0 bg-white", className)}
      style={{ height }}
    />
  );
}

/** 참고 영상 칸 — 주소 넣기 · 재생기 격자 · 설명 고치기 · 빼기 */
export function NoteVideos({
  videos,
  readOnly,
  onAdd,
  onEdit,
}: {
  videos: NoteVideo[];
  readOnly: boolean;
  /** 성공하면 true (칸을 비운다) */
  onAdd: (url: string) => Promise<boolean>;
  onEdit: (next: NoteVideo[]) => Promise<boolean>;
}) {
  const ask = useConfirm();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const full = videos.length >= NOTE_VIDEOS_MAX;
  const add = async () => {
    const v = url.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onAdd(v);
    setBusy(false);
    if (ok) setUrl("");
  };
  const remove = async (v: NoteVideo) => {
    if (!(await ask({ title: "이 영상을 노트에서 뺄까요?", message: `${v.label || v.url}\n넣을 때 남긴 숫자도 같이 빠집니다. 원본 영상은 그대로입니다.`, confirmLabel: "빼기", tone: "danger" }))) return;
    await onEdit(videos.filter((x) => noteVideoKey(x) !== noteVideoKey(v)));
  };
  return (
    <section aria-label="참고 영상" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-nd-fg">
          <Video size={16} aria-hidden /> 참고 영상 <span className="nd-num font-medium text-nd-fg-3">· {videos.length}</span>
        </h3>
        <span className="text-[13px] text-nd-fg-3">ERP 안에서 바로 재생됩니다</span>
      </div>
      {!readOnly && (
        <FormRow className="grid-cols-[minmax(0,1fr)_auto]">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">유튜브 · 인스타 · 틱톡 영상 주소</span>
            <Input
              value={url}
              disabled={busy || full}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder={full ? `${NOTE_VIDEOS_MAX}개까지 넣었습니다` : "https://www.instagram.com/reel/… · youtube.com/shorts/… · tiktok.com/@…/video/…"}
              aria-label="영상 주소"
            />
          </label>
          <FieldAction>
            <Button icon={Plus} loading={busy} disabled={!url.trim() || full} onClick={() => void add()}>
              넣기
            </Button>
          </FieldAction>
        </FormRow>
      )}
      {!readOnly && busy && <p className="text-[13px] text-nd-fg-3" role="status">영상 정보를 읽는 중… (조회 · 좋아요 숫자를 그때 값으로 남깁니다)</p>}
      {videos.length === 0 ? (
        <p className="flex items-center gap-2 rounded-nd-md border border-dashed border-nd-line px-4 py-6 text-[13px] text-nd-fg-3">
          <Link2 size={15} aria-hidden />
          {readOnly ? "넣은 영상이 없습니다." : "영상 주소를 붙여 넣으면 여기서 바로 재생됩니다. 채널 · 계정 주소가 아니라 영상 하나의 주소여야 합니다."}
        </p>
      ) : (
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {videos.map((v) => (
            <VideoCard key={noteVideoKey(v)} v={v} readOnly={readOnly} onLabel={(label) => void onEdit(videos.map((x) => (noteVideoKey(x) === noteVideoKey(v) ? { ...x, label } : x)))} onRemove={() => void remove(v)} />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoCard({ v, readOnly, onLabel, onRemove }: { v: NoteVideo; readOnly: boolean; onLabel: (label: string) => void; onRemove: () => void }) {
  const [label, setLabel] = useState(v.label);
  useEffect(() => setLabel(v.label), [v.label]);
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-nd-md border border-nd-line bg-nd-content shadow-nd-card">
      <VideoFrame video={v} />
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Badge tone="neutral" size="lg">
            {NOTE_VIDEO_PLATFORM_LABEL[v.platform]}
          </Badge>
          <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-nd-accent-strong hover:underline">
            <ExternalLink size={13} aria-hidden /> 원본 열기
          </a>
          <span className="flex-1" />
          {!readOnly && <IconButton icon={Trash2} label={`「${v.label || "영상"}」 빼기`} size="sm" variant="ghost" className="text-nd-fg-3 hover:text-nd-danger-text" onClick={onRemove} />}
        </div>
        {readOnly ? (
          v.label && <p className="text-[14px] font-semibold text-nd-fg [overflow-wrap:anywhere]">{v.label}</p>
        ) : (
          <Input
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() !== v.label && onLabel(label.trim())}
            placeholder="짧은 설명 (예: 화해 — 협찬 편 최고 조회)"
            aria-label="영상 설명"
          />
        )}
        {v.stats ? (
          <p className="nd-num text-[13px] leading-relaxed text-nd-fg-2 [overflow-wrap:anywhere]">
            <span className="text-nd-fg-3">넣을 때 · </span>
            {v.stats}
          </p>
        ) : (
          <p className="text-[13px] text-nd-fg-3">숫자를 읽지 못했습니다 (플랫폼이 막았거나 비공개). 원본에서 확인하세요.</p>
        )}
        <p className="text-[13px] text-nd-fg-3">넣은 날 {fmtWhen(v.addedAt)}</p>
      </div>
    </article>
  );
}

// ---- 사진 받기 (로그인 머리글 → Blob 주소 · 탭이 들고 있음) ------------------------------------

const imageUrls = new Map<string, Promise<string>>();

function noteImageUrl(id: string, size: "thumb" | "full"): Promise<string> {
  const key = `${id}:${size}`;
  let p = imageUrls.get(key);
  if (!p) {
    p = shortsBlob(`market?noteImage=${encodeURIComponent(id)}&size=${size}`).then((b) => URL.createObjectURL(b));
    p.catch(() => imageUrls.delete(key));
    imageUrls.set(key, p);
  }
  return p;
}

export function useNoteImage(id: string | null, size: "thumb" | "full"): { url: string | null; error: boolean } {
  const [s, setS] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    if (!id) return setS({ url: null, error: false });
    let live = true;
    setS({ url: null, error: false });
    noteImageUrl(id, size).then(
      (url) => live && setS({ url, error: false }),
      () => live && setS({ url: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [id, size]);
  return s;
}

/** 작은 그림 한 장 — 카드 · 격자용 */
export function NoteThumb({ image, className, alt }: { image: NoteImage; className?: string; alt?: string }) {
  const { url, error } = useNoteImage(image.id, "thumb");
  return (
    <div className={cn("relative overflow-hidden bg-nd-sunken", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt ?? (image.caption || image.name)} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[13px] text-nd-fg-3">{error ? "사진을 못 읽음" : <Loader2 size={16} className="animate-spin" aria-label="사진을 받는 중" />}</span>
      )}
    </div>
  );
}

// ---- 사진 줄이기 (브라우저) ---------------------------------------------------------------

export interface PreparedImage {
  name: string;
  w: number;
  h: number;
  full: Blob;
  thumb: Blob;
}

async function decodeFile(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(`「${file.name}」 은(는) 이 브라우저가 열 수 없는 그림입니다 (JPG · PNG · WebP 로 바꿔 주세요).`);
    }
  }
}

function encode(src: CanvasImageSource, w: number, h: number, quality: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return Promise.reject(new Error("그림을 줄이지 못했습니다."));
  // 투명한 PNG 가 JPG 로 바뀌며 검게 되지 않게
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("그림을 줄이지 못했습니다."))), "image/jpeg", quality));
}

/** 상한 안에 들 때까지 품질 → 크기 순으로 낮춘다 */
async function shrink(src: CanvasImageSource, w: number, h: number, longSide: number, maxBytes: number, q0: number): Promise<{ blob: Blob; w: number; h: number }> {
  let scale = Math.min(1, longSide / Math.max(w, h));
  for (let round = 0; round < 8; round++) {
    const W = Math.max(1, Math.round(w * scale));
    const H = Math.max(1, Math.round(h * scale));
    for (const q of [q0, q0 - 0.1, q0 - 0.2]) {
      const blob = await encode(src, W, H, q);
      if (blob.size <= maxBytes) return { blob, w: W, h: H };
    }
    scale *= 0.8;
  }
  throw new Error("그림을 상한 크기 안으로 줄이지 못했습니다.");
}

/** 원본이 이미 작으면(형식 · 크기 · 긴 변 모두 안) 그대로 — 글자 많은 캡처가 뭉개지지 않게 */
export async function prepareNoteImage(file: File): Promise<PreparedImage> {
  const d = await decodeFile(file);
  try {
    const keep = NOTE_IMAGE_TYPES.includes(file.type as (typeof NOTE_IMAGE_TYPES)[number]) && file.size <= NOTE_IMAGE_MAX_BYTES && Math.max(d.w, d.h) <= NOTE_IMAGE_LONG_SIDE;
    const full = keep ? { blob: file as Blob, w: d.w, h: d.h } : await shrink(d.src, d.w, d.h, NOTE_IMAGE_LONG_SIDE, NOTE_IMAGE_MAX_BYTES, 0.88);
    const thumb = await shrink(d.src, d.w, d.h, NOTE_THUMB_LONG_SIDE, NOTE_THUMB_MAX_BYTES, 0.82);
    return { name: file.name, w: full.w, h: full.h, full: full.blob, thumb: thumb.blob };
  } finally {
    d.close();
  }
}

export async function blobBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 붙여 넣기 · 끌어다 놓기에서 그림 파일만 */
export const imageFilesOf = (list: FileList | File[] | null | undefined) => Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

// ---- 사진 칸 -------------------------------------------------------------------------

export function NoteImages({
  images,
  readOnly,
  uploading,
  onFiles,
  onCaption,
  onDelete,
}: {
  images: NoteImage[];
  readOnly: boolean;
  /** 올리는 중이면 「2/5」 같은 글 */
  uploading: string | null;
  onFiles: (files: File[]) => void;
  onCaption: (id: string, caption: string) => void;
  onDelete: (img: NoteImage) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const full = images.length >= NOTE_IMAGES_MAX;
  return (
    <section aria-label="사진" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-nd-fg">
          <ImagePlus size={16} aria-hidden /> 사진{" "}
          <span className="nd-num font-medium text-nd-fg-3">
            · {images.length}/{NOTE_IMAGES_MAX}
          </span>
        </h3>
        {!readOnly && <span className="text-[13px] text-nd-fg-3">장면 모음 · 캡처 · 표지 — 붙여 넣기(⌘V)도 됩니다</span>}
      </div>
      {images.length > 0 && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {images.map((img, i) => (
            <ImageTile key={img.id} img={img} readOnly={readOnly} onOpen={() => setOpen(i)} onCaption={(c) => onCaption(img.id, c)} onDelete={() => onDelete(img)} />
          ))}
        </div>
      )}
      {!readOnly && (
        <DropZone
          multiple
          compact={images.length > 0}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
          disabled={full || !!uploading}
          busy={!!uploading}
          icon={ImagePlus}
          onFiles={(files) => onFiles(imageFilesOf(files))}
          title={uploading ? `사진을 올리는 중… ${uploading}` : full ? `${NOTE_IMAGES_MAX}장까지 넣었습니다` : "사진을 끌어다 놓거나 눌러서 고르세요"}
          hint={uploading || full ? undefined : "큰 사진은 긴 변 2,400px · 850KB 안으로 줄여서 올립니다"}
        />
      )}
      {readOnly && images.length === 0 && <p className="rounded-nd-md border border-dashed border-nd-line px-4 py-6 text-[13px] text-nd-fg-3">넣은 사진이 없습니다.</p>}
      {open !== null && images[open] && <ImageViewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ImageTile({ img, readOnly, onOpen, onCaption, onDelete }: { img: NoteImage; readOnly: boolean; onOpen: () => void; onCaption: (c: string) => void; onDelete: () => void }) {
  const [caption, setCaption] = useState(img.caption);
  useEffect(() => setCaption(img.caption), [img.caption]);
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-nd-md border border-nd-line bg-nd-content shadow-nd-card">
      <button type="button" onClick={onOpen} className="group relative block" aria-label={`「${img.caption || img.name}」 크게 보기`}>
        <NoteThumb image={img} className="aspect-[4/3] w-full transition-opacity group-hover:opacity-90" />
      </button>
      <figcaption className="space-y-1.5 p-2">
        {readOnly ? (
          <p className="text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">{img.caption || img.name}</p>
        ) : (
          <Input size="sm" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} onBlur={() => caption.trim() !== img.caption && onCaption(caption.trim())} placeholder="설명" aria-label="사진 설명" />
        )}
        <div className="flex items-center gap-1">
          <span className="nd-num min-w-0 flex-1 truncate text-[13px] text-nd-fg-3" title={img.name}>
            {img.w.toLocaleString("ko-KR")}×{img.h.toLocaleString("ko-KR")}
          </span>
          {!readOnly && <IconButton icon={Trash2} label={`「${img.caption || img.name}」 지우기`} size="sm" variant="ghost" className="text-nd-fg-3 hover:text-nd-danger-text" onClick={onDelete} />}
        </div>
      </figcaption>
    </figure>
  );
}

/** 창 안에서 크게 보기 — ← → 로 넘기고 Esc 로 닫는다 (노트 창은 그대로) */
function ImageViewer({ images, index, onIndex, onClose }: { images: NoteImage[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const img = images[index];
  const { url, error } = useNoteImage(img.id, "full");
  const go = useCallback((d: number) => onIndex((index + d + images.length) % images.length), [index, images.length, onIndex]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    // 창 맨 바깥(캡처 단계)에서 먼저 받아 노트 창의 Esc 닫기까지 가지 않게
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.stopPropagation();
        e.preventDefault();
        go(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [go, onClose]);
  const save = async () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = img.name || "사진.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <div ref={box} tabIndex={-1} role="group" aria-label="사진 크게 보기" className="absolute inset-0 z-20 flex flex-col rounded-[inherit] bg-[#111]/95 text-white outline-none">
      <div className="flex items-center gap-3 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          <span className="nd-num text-white/60">
            {index + 1}/{images.length}
          </span>{" "}
          {img.caption || img.name}
        </p>
        <Button size="sm" variant="secondary" icon={Download} disabled={!url} onClick={() => void save()}>
          받기
        </Button>
        <IconButton icon={X} label="크게 보기 닫기" onClick={onClose} className="text-white hover:bg-white/10" />
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={img.caption || img.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[14px] text-white/70">{error ? "사진을 받지 못했습니다." : <Loader2 className="animate-spin" aria-label="사진을 받는 중" />}</span>
        )}
        {images.length > 1 && (
          <>
            <IconButton icon={ChevronLeft} label="이전 사진" onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/10" />
            <IconButton icon={ChevronRight} label="다음 사진" onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/10" />
          </>
        )}
      </div>
    </div>
  );
}
