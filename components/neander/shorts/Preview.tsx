"use client";

// ============================================================
//  9:16 미리보기 — 장면 · 자막 · 고지 띠 · 내레이션을 실시간으로 재생
// ------------------------------------------------------------
//  출력과 같은 그리기 함수(compose.ts)를 캔버스에 쓴다. 영상은 <video> 를 장면마다
//  하나씩 두고 시계에 맞춰 위치를 맞춘다(0.25초 넘게 어긋날 때만 이동). 미리보기는
//  재생 속도에 따라 프레임이 빠질 수 있다 — 결과물은 출력(render.ts)이 프레임마다 만든다.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/neander/ui";
import { cueAt, drawBlank, drawCover, drawDisclosure, drawSubtitle, sceneAt } from "@/lib/neander/shorts/compose";
import { fmtSec, overlayFor, timelineSec } from "@/lib/neander/shorts/model";
import { effectiveCues } from "@/lib/neander/shorts/render";
import type { ProjectDoc } from "@/lib/neander/shorts/types";
import { useBlobUrl } from "./media";

function SceneVideo({ id, register }: { id: string | null; register: (el: HTMLVideoElement | null) => void }) {
  const { url } = useBlobUrl(id);
  return url ? <video ref={register} src={url} muted playsInline preload="auto" className="hidden" /> : null;
}
function SceneImage({ id, register }: { id: string | null; register: (el: HTMLImageElement | null) => void }) {
  const { url } = useBlobUrl(id);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img ref={register} src={url} alt="" className="hidden" /> : null;
}
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
    } else drawBlank(ctx, s.kind === "blank" ? "" : `${s.label} (불러오는 중 · 파일 없음)`, W, H);
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

  const seek = (time: number) => {
    clock.current.t = Math.max(0, Math.min(total, time));
    setT(clock.current.t);
    syncAudio(clock.current.t, false);
    draw(clock.current.t, false);
    if (playing) setPlaying(false);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvas} width={W} height={H} className="aspect-[9/16] w-full max-w-[300px] rounded-nd-lg bg-black shadow-sm" aria-label="9:16 미리보기" />
      <div className="flex w-full max-w-[300px] items-center gap-2">
        <Button size="sm" variant="secondary" icon={playing ? Pause : Play} aria-label={playing ? "멈춤" : "재생"} onClick={() => { if (t >= total) seek(0); setPlaying((v) => !v); }} disabled={!total} />
        <input type="range" min={0} max={total || 1} step={0.05} value={t} onChange={(e) => seek(Number(e.target.value))} className="min-w-0 flex-1 accent-nd-accent" aria-label="재생 위치" />
        <Button size="sm" variant="ghost" icon={RotateCcw} aria-label="처음으로" onClick={() => seek(0)} />
      </div>
      <p className="text-nd-caption text-nd-fg-3">{fmtSec(t)} / {fmtSec(total)} · 미리보기는 프레임이 빠질 수 있습니다</p>
      <div className="hidden">
        {p.scenes.map((s) =>
          s.kind === "image" ? (
            <SceneImage key={s.id} id={s.image?.fileId ?? null} register={(el) => (el ? images.current.set(s.id, el) : images.current.delete(s.id))} />
          ) : (
            <SceneVideo key={s.id} id={s.kind === "clip" ? s.clip?.fileId ?? null : s.kind === "ai" ? s.ai?.fileId ?? null : null} register={(el) => (el ? videos.current.set(s.id, el) : videos.current.delete(s.id))} />
          ),
        )}
        {p.narration.kind === "ai"
          ? p.narration.segments.map((s) => <NarrationAudio key={s.fileId} id={s.fileId} register={(el) => (el ? audios.current.set(s.fileId, el) : audios.current.delete(s.fileId))} />)
          : p.narration.fileId && <NarrationAudio id={p.narration.fileId} register={(el) => (el ? audios.current.set(p.narration.fileId!, el) : audios.current.delete(p.narration.fileId!))} />}
      </div>
    </div>
  );
}
