"use client";

// ============================================================
//  9:16 미리보기 — 장면 · 자막 · 고지 띠 · 내레이션을 실시간으로 재생
// ------------------------------------------------------------
//  출력과 같은 그리기 함수(compose.ts)를 캔버스에 쓴다. 영상은 <video> 를 장면마다
//  하나씩 두고 시계에 맞춰 위치를 맞춘다(0.25초 넘게 어긋날 때만 이동). 미리보기는
//  재생 속도에 따라 프레임이 빠질 수 있다 — 결과물은 출력(render.ts)이 프레임마다 만든다.
//  파일이 없는 장면은 캔버스를 비워 두고 그 위에 「파일 없음」 을 글자로 띄운다 (가짜 화면 없음).
// ============================================================

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { FileX2, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/neander/ui";
import { cueAt, drawBlank, drawCover, drawDisclosure, drawSubtitle, sceneAt } from "@/lib/neander/shorts/compose";
import { fmtSec, overlayFor, timelineSec } from "@/lib/neander/shorts/model";
import { effectiveCues } from "@/lib/neander/shorts/render";
import type { ProjectDoc, Scene } from "@/lib/neander/shorts/types";
import { useBlobUrl } from "./media";

// onReady — 파일이 늦게 도착하면 멈춘 화면을 다시 그린다 (재생 중에는 매 프레임 그리므로 필요 없음)
function SceneVideo({ id, register, onReady }: { id: string | null; register: (el: HTMLVideoElement | null) => void; onReady: () => void }) {
  const { url } = useBlobUrl(id);
  // 같은 위치로 거듭 옮겨지는 경우(구간 끝이 원본보다 길 때)에 다시 그리기가 되풀이되지 않게
  const lastSeek = useRef<number | null>(null);
  const onSeeked = (e: SyntheticEvent<HTMLVideoElement>) => {
    const at = e.currentTarget.currentTime;
    if (lastSeek.current !== null && Math.abs(lastSeek.current - at) < 0.01) return;
    lastSeek.current = at;
    onReady();
  };
  return url ? <video ref={register} src={url} muted playsInline preload="auto" className="hidden" onLoadedData={onReady} onSeeked={onSeeked} /> : null;
}
function SceneImage({ id, register, onReady }: { id: string | null; register: (el: HTMLImageElement | null) => void; onReady: () => void }) {
  const { url } = useBlobUrl(id);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img ref={register} src={url} alt="" className="hidden" onLoad={onReady} /> : null;
}
const KIND_LABEL = { clip: "원본 클립", ai: "AI 생성", image: "사진", blank: "빈 화면" } as const;

/** 장면에 붙은 파일 id — 빈 화면(글자만)은 파일이 필요 없다 */
const sceneFileId = (s: Scene) => (s.kind === "clip" ? s.clip?.fileId : s.kind === "ai" ? s.ai?.fileId : s.kind === "image" ? s.image?.fileId : null) ?? null;
const MISSING = { clip: "원본 파일이 없습니다", ai: "AI 장면 파일이 아직 없습니다", image: "사진이 없습니다", blank: "" } as const;

function NarrationAudio({ id, register }: { id: string; register: (el: HTMLAudioElement | null) => void }) {
  const { url } = useBlobUrl(id);
  return url ? <audio ref={register} src={url} preload="auto" /> : null;
}

export function Preview({ p }: { p: ProjectDoc }) {
  const W = 360;
  const H = 640;
  const canvas = useRef<HTMLCanvasElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef({ t: 0, last: 0, raf: 0 });
  const playingRef = useRef(false);
  playingRef.current = playing;
  const total = timelineSec(p.scenes);
  const cues = useMemo(() => effectiveCues(p), [p]);
  const overlay = p.output.disclosureOverlay ? overlayFor(p) : "";
  const segStarts = useMemo(() => {
    let acc = 0;
    return p.narration.segments.map((s) => {
      const at = acc;
      acc += s.duration + p.narration.gapSec;
      return { ...s, at };
    });
  }, [p.narration]);

  const draw = (time: number, play: boolean) => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const at = sceneAt(p.scenes, time);
    if (!at) return drawBlank(ctx, "장면 없음", W, H);
    const s = at.scene;
    const fileId = s.kind === "clip" ? s.clip?.fileId : s.kind === "ai" ? s.ai?.fileId : null;
    const v = fileId ? videos.current.get(s.id) : undefined;
    videos.current.forEach((el, id) => id !== s.id && !el.paused && el.pause());
    if (v && v.readyState >= 2) {
      const want = (s.clip?.start ?? 0) + at.offset;
      if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = Math.min(want, (v.duration || want) - 0.05);
      v.muted = !s.keepAudio;
      v.volume = p.narration.kind !== "none" ? p.output.sourceVolume : 1;
      if (play && v.paused) void v.play().catch(() => undefined);
      if (!play && !v.paused) v.pause();
      drawCover(ctx, v, v.videoWidth, v.videoHeight, W, H);
    } else if (s.kind === "image" && images.current.get(s.id)?.complete) {
      const img = images.current.get(s.id)!;
      drawCover(ctx, img, img.naturalWidth, img.naturalHeight, W, H, 1 + 0.06 * (at.offset / Math.max(0.1, s.duration)));
    } else drawBlank(ctx, s.kind === "blank" || !sceneFileId(s) ? "" : "불러오는 중", W, H);
    drawSubtitle(ctx, cueAt(cues, time)?.text ?? "", W, H);
    drawDisclosure(ctx, overlay, W, H);
  };

  const syncAudio = (time: number, play: boolean) => {
    if (p.narration.kind === "ai") {
      for (const s of segStarts) {
        const a = audios.current.get(s.fileId);
        if (!a) continue;
        const inside = time >= s.at && time < s.at + s.duration;
        if (play && inside) {
          if (a.paused) {
            a.currentTime = time - s.at;
            void a.play().catch(() => undefined);
          }
        } else if (!a.paused) a.pause();
      }
    } else if (p.narration.fileId) {
      const a = audios.current.get(p.narration.fileId);
      if (!a) return;
      if (play) {
        if (Math.abs(a.currentTime - time) > 0.3) a.currentTime = time;
        if (a.paused) void a.play().catch(() => undefined);
      } else if (!a.paused) a.pause();
    }
  };

  useEffect(() => {
    draw(clock.current.t, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(clock.current.raf);
      syncAudio(clock.current.t, false);
      draw(clock.current.t, false);
      return;
    }
    clock.current.last = performance.now();
    const tick = (now: number) => {
      const c = clock.current;
      c.t = Math.min(total, c.t + (now - c.last) / 1000);
      c.last = now;
      draw(c.t, true);
      syncAudio(c.t, true);
      setT(c.t);
      if (c.t >= total) return setPlaying(false);
      c.raf = requestAnimationFrame(tick);
    };
    clock.current.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(clock.current.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const onReady = () => {
    if (!playingRef.current) draw(clock.current.t, false);
  };

  const seek = (time: number) => {
    clock.current.t = Math.max(0, Math.min(total, time));
    setT(clock.current.t);
    syncAudio(clock.current.t, false);
    draw(clock.current.t, false);
    if (playing) setPlaying(false);
  };

  const cur = sceneAt(p.scenes, t);
  const missing = cur && cur.scene.kind !== "blank" && !sceneFileId(cur.scene) ? MISSING[cur.scene.kind] : "";

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative w-full max-w-[300px]">
        <canvas ref={canvas} width={W} height={H} className="block aspect-[9/16] w-full rounded-nd-lg bg-black shadow-sm" aria-label="9:16 미리보기" />
        {missing && (
          <div className="pointer-events-none absolute inset-x-4 top-[38%] flex flex-col items-center gap-1.5 text-center text-white/80" role="status">
            <FileX2 size={22} aria-hidden />
            <span className="text-[13px] font-medium">#{cur!.index + 1} {missing}</span>
            <span className="text-[13px] text-white/55">장면 카드에서 파일을 붙이면 여기에 보입니다</span>
          </div>
        )}
      </div>
      <div className="flex w-full max-w-[300px] items-center gap-2">
        <Button size="sm" variant="secondary" icon={playing ? Pause : Play} aria-label={playing ? "멈춤" : "재생"} onClick={() => { if (t >= total) seek(0); setPlaying((v) => !v); }} disabled={!total} />
        <input type="range" min={0} max={total || 1} step={0.05} value={t} onChange={(e) => seek(Number(e.target.value))} className="min-w-0 flex-1 accent-nd-accent" aria-label="재생 위치" />
        <Button size="sm" variant="ghost" icon={RotateCcw} aria-label="처음으로" onClick={() => seek(0)} />
      </div>
      <div className="w-full max-w-[300px] space-y-0.5 text-center">
        <p className="nd-num text-[13px] text-nd-fg-2">{fmtSec(t)} / {fmtSec(total)}</p>
        {cur && (
          <p className="truncate text-[13px] text-nd-fg-3" title={cur.scene.label}>
            #{cur.index + 1} {KIND_LABEL[cur.scene.kind]}{cur.scene.label ? ` · ${cur.scene.label}` : ""}
          </p>
        )}
        <p className="text-[13px] text-nd-fg-3">미리보기는 프레임이 빠질 수 있습니다</p>
      </div>
      <div className="hidden">
        {p.scenes.map((s) =>
          s.kind === "image" ? (
            <SceneImage key={s.id} id={s.image?.fileId ?? null} onReady={onReady} register={(el) => (el ? images.current.set(s.id, el) : images.current.delete(s.id))} />
          ) : (
            <SceneVideo key={s.id} id={s.kind === "clip" ? s.clip?.fileId ?? null : s.kind === "ai" ? s.ai?.fileId ?? null : null} onReady={onReady} register={(el) => (el ? videos.current.set(s.id, el) : videos.current.delete(s.id))} />
          ),
        )}
        {p.narration.kind === "ai"
          ? p.narration.segments.map((s) => <NarrationAudio key={s.fileId} id={s.fileId} register={(el) => (el ? audios.current.set(s.fileId, el) : audios.current.delete(s.fileId))} />)
          : p.narration.fileId && <NarrationAudio id={p.narration.fileId} register={(el) => (el ? audios.current.set(p.narration.fileId!, el) : audios.current.delete(p.narration.fileId!))} />}
      </div>
    </div>
  );
}
