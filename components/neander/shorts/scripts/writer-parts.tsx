"use client";

// ============================================================
//  대본 작성기 공용 조각 — 사진 줄이기 · 사진 고르기 · 모델 고르기 · 비용 어림
// ------------------------------------------------------------
//  사진은 브라우저가 1024px JPEG 로 줄여 보낸다(서버 본문 한도 4.5MB). 미리보기는 160px.
//  비용 어림: 이 대본에서 같은 모델로 실제 쓴 값의 평균이 있으면 그것, 없으면 기본 모델(Gemini Flash)의
//  잰 값(제품 소개 약 15원 · 스토리 약 40원). 대본 작성기는 하루 상한이 없다 — 누를 때마다 한 번 과금.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Select, cn, useToast } from "@/components/neander/ui";
import { krwOf } from "@/lib/neander/shorts/radar";
import { WRITER_MAX_PHOTOS, type ScriptSessionDoc, type WriterStyle } from "@/lib/neander/shorts/script-writer";
import { DEFAULT_FIN_AI_MODEL, FIN_AI_MODELS } from "@/lib/neander/ai/models";

export type Session = ScriptSessionDoc & { id: string };
export type TurnResult = { session: Session; error: string | null; costUsd: number };
export type PhotoDraft = { name: string; dataUrl: string; thumb: string };

export const won = (usd: number) => `${krwOf(usd).toLocaleString("ko-KR")}원`;

/** 쓴 AI 비용 — 나간 돈이라 빨강 「-」 (0 이면 그냥 0원) */
export function Spent({ usd }: { usd: number }) {
  const krw = krwOf(usd);
  return krw > 0 ? <span className="nd-num font-medium text-nd-danger-text">-{krw.toLocaleString("ko-KR")}원</span> : <span className="nd-num">0원</span>;
}
const MODEL_KEY = "neander.shorts.writerModel";
export const STORY_SUGGESTIONS = ["반전을 더 크게", "웃음 포인트 하나 더", "제품 등장을 더 자연스럽게", "45초로 줄여 줘", "엔드카드 문구 바꿔 줘", "AI 로 만들기 쉬운 컷으로"];

/** 기본 모델(Gemini Flash)로 잰 한 번 비용 (원) — 제품 소개 · 스토리 · 콘티 */
const FLASH_KRW: Record<WriterStyle, number> = { intro: 15, story: 40 };

/**
 * 다음 한 번의 예상 비용 — 이 대본에서 같은 모델로 쓴 실제 값 평균 → 없으면 기본 모델 잰 값 →
 * 다른 모델은 「기본 모델보다 비쌈」 (모델별 단가표가 없어 숫자를 지어내지 않는다).
 */
export function estimateCost(model: string, style: WriterStyle, s?: Pick<Session, "messages"> | null): number | string {
  const past = (s?.messages ?? []).filter((m) => m.role === "assistant" && !m.error && m.model === model && typeof m.costUsd === "number" && m.costUsd > 0);
  if (past.length) return krwOf(past.reduce((n, m) => n + (m.costUsd ?? 0), 0) / past.length);
  if (model === DEFAULT_FIN_AI_MODEL) return FLASH_KRW[style];
  return "기본 모델보다 비쌈 (쓴 값은 대화마다 기록)";
}

// ---- 사진 줄이기 (브라우저) -------------------------------------------------------

async function shrink(file: File, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error(`「${file.name}」 은 읽지 못하는 사진입니다 — JPG · PNG 로 다시 저장해 붙여 주세요.`);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d");
  if (!g) throw new Error("사진을 줄이지 못했습니다.");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", quality);
}

async function toPhotoDrafts(files: File[], room: number): Promise<PhotoDraft[]> {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) throw new Error("사진 파일(JPG · PNG · WEBP)만 붙일 수 있습니다.");
  if (imgs.length > room) throw new Error(`사진은 ${WRITER_MAX_PHOTOS}장까지입니다 — 지금 ${room}장 더 붙일 수 있습니다.`);
  return Promise.all(imgs.map(async (f) => ({ name: f.name.slice(0, 80), dataUrl: await shrink(f, 1024, 0.85), thumb: await shrink(f, 160, 0.7) })));
}

// ---- 모델 고르기 --------------------------------------------------------------------

export function ModelSelect({ value, onChange, size = "sm", className }: { value: string; onChange: (v: string) => void; size?: "sm" | "md"; className?: string }) {
  return (
    <Select size={size} value={value} onChange={(e) => onChange(e.target.value)} aria-label="AI 모델" className={className}>
      {FIN_AI_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
          {m.note ? ` — ${m.note}` : ""}
        </option>
      ))}
    </Select>
  );
}

/** 고른 모델 — 이 브라우저에 기억 */
export function useModel(): [string, (v: string) => void] {
  const [m, setM] = useState(DEFAULT_FIN_AI_MODEL);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MODEL_KEY);
      if (v && FIN_AI_MODELS.some((x) => x.id === v)) setM(v);
    } catch {
      /* 기본값 */
    }
  }, []);
  return [
    m,
    (v: string) => {
      setM(v);
      try {
        window.localStorage.setItem(MODEL_KEY, v);
      } catch {
        /* 기억 못 해도 고른 값은 쓴다 */
      }
    },
  ];
}

export const modelLabel = (id: string) => FIN_AI_MODELS.find((x) => x.id === id)?.label ?? id;

// ---- 사진 고르기 --------------------------------------------------------------------

/**
 * 제품 사진 — 끌어 놓기 · 파일 고르기. 큰 칸(새 대본)과 작은 칸(대화에 붙이기) 두 모양.
 * 칸 번호 꼬리표도 13px (작은 글씨 금지).
 */
export function PhotoPicker({ photos, setPhotos, room, compact = false }: { photos: PhotoDraft[]; setPhotos: (p: PhotoDraft[]) => void; room: number; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    setBusy(true);
    try {
      setPhotos([...photos, ...(await toPhotoDrafts(files, room - photos.length))]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "사진을 붙이지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  const tile = compact ? "h-16 w-16" : "aspect-[4/3] w-full";
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add([...e.dataTransfer.files]);
      }}
    >
      <div className={compact ? "flex flex-wrap items-center gap-2" : "grid grid-cols-2 gap-3 sm:grid-cols-4"}>
        {photos.map((p, i) => (
          <span key={i} className={cn("relative block overflow-hidden rounded-nd-md border border-nd-line bg-nd-sunken", tile)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb} alt={p.name} className="h-full w-full object-cover" />
            {compact ? (
              <span className="nd-num absolute left-1 top-1 rounded-[4px] bg-black/60 px-1 text-[13px] leading-tight text-white">{i + 1}</span>
            ) : (
              <span className="absolute inset-x-2 bottom-2 truncate rounded-nd-sm bg-white/90 px-2 py-1 text-[13px] text-nd-fg-2" title={p.name}>
                사진 {i + 1} · {p.name}
              </span>
            )}
            <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => setPhotos(photos.filter((_, k) => k !== i))} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/75">
              <X size={14} aria-hidden />
            </button>
          </span>
        ))}
        {photos.length < room && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-nd-md border border-dashed border-nd-border bg-nd-content text-[13px] font-medium text-nd-fg-2 hover:bg-nd-sunken disabled:opacity-60",
              compact ? "h-16 w-16 flex-col" : "aspect-[4/3] w-full",
            )}
          >
            <ImagePlus size={compact ? 16 : 18} aria-hidden />
            {busy ? "줄이는 중…" : "사진 추가"}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[13px] text-nd-fg-3">
        <span className="nd-num">
          {photos.length} / {room}
        </span>
        장 · 제품 외형 · 구성을 참고합니다 · 끌어 놓아도 됩니다 · 브라우저가 1024px 로 줄여 보냅니다
      </p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
