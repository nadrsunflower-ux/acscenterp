"use client";

// ============================================================
//  출력기 — 장면 · 내레이션 · 자막 → H.264/AAC MP4 (브라우저 WebCodecs)
// ------------------------------------------------------------
//  프로토타입은 MediaRecorder 로 「실시간」 녹화했다 (30초 영상 = 30초, 탭을
//  가리면 실패, 브라우저마다 WebM 으로 떨어짐). 여기서는 ERP 가 이미 쓰는
//  mediabunny(회의 녹음 변환)로 프레임을 하나씩 그려 인코딩한다:
//    · 실시간보다 빠르고, 탭이 뒤로 가도 멈추지 않는다
//    · 코덱을 고른다 — H.264(avc) + AAC 가 안 되는 브라우저면 출력하지 않고 알린다
//      (Instagram 이 이 형식만 받는다)
//    · 결과를 다시 열어 코덱을 확인한 뒤 서버에 올린다
//
//  소리는 OfflineAudioContext 로 한 번에 섞는다 — 줄마다 만든 AI 음성을 자막 시각에,
//  원본 소리를 살린 장면은 그 자리에 (내레이션이 있으면 sourceVolume 만큼 줄여서).
//
//  긴 작업이 끊기면(창 닫힘) 서버의 출력 작업이 90초 뒤 「중단」 이 된다.
//  설계도(프로젝트)가 서버에 있으니 다시 출력하면 같은 결과가 나온다.
// ============================================================

import { cuesFromSegments, overlayFor, timelineSec, timeSubtitles } from "./model";
import { cueAt, drawBlank, drawCover, drawDisclosure, drawSubtitle } from "./compose";
import type { ProjectDoc, Scene, SubtitleCue } from "./types";

type MB = typeof import("mediabunny");

export interface RenderResult {
  blob: Blob;
  duration: number;
  codecs: { video: string | null; audio: string | null };
  overlay: { disclosure: boolean; text: string };
}

export class RenderError extends Error {}

/** 이 브라우저가 H.264/AAC 를 만들 수 있는가 */
export async function canRenderMp4(width = 720, height = 1280): Promise<{ ok: boolean; reason: string | null }> {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") {
    return { ok: false, reason: "이 브라우저는 영상 인코딩(WebCodecs)을 지원하지 않습니다. 최신 Chrome · Edge · Safari 를 써 주세요." };
  }
  const MB = await import("mediabunny");
  const v = await MB.canEncodeVideo("avc", { width, height, bitrate: 5_000_000 });
  const a = await MB.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 });
  if (!v) return { ok: false, reason: "이 브라우저는 H.264 영상 인코더가 없습니다. Chrome 또는 Edge 를 써 주세요." };
  if (!a) return { ok: false, reason: "이 브라우저는 AAC 음성 인코더가 없습니다 (리눅스 Chrome 등). macOS · Windows 의 Chrome · Edge 를 써 주세요." };
  return { ok: true, reason: null };
}

/** 출력에 쓸 자막 — 사람이 고친 자막 → AI 음성 줄 길이 → 글자 수 비례 순 */
export function effectiveCues(p: ProjectDoc): SubtitleCue[] {
  const total = timelineSec(p.scenes);
  if (p.subtitles.cues.length && p.subtitles.edited) return p.subtitles.cues;
  if (p.narration.kind === "ai" && p.narration.segments.length) return cuesFromSegments(p.script.lines, p.narration.segments, p.narration.gapSec);
  if (p.subtitles.cues.length) return p.subtitles.cues;
  const narr = p.narration.kind !== "none" && p.narration.duration ? Math.min(total, p.narration.duration) : total;
  return timeSubtitles(p.script.lines, narr);
}

/** 설계도 지문 — 같은 지문이면 같은 결과 (출력 작업에 남긴다) */
export function specHash(p: ProjectDoc): string {
  const s = JSON.stringify([p.scenes, p.narration, effectiveCues(p), p.output, p.virtualHuman]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const SR = 48_000;

async function mixAudio(
  MB: MB,
  p: ProjectDoc,
  total: number,
  load: (id: string) => Promise<Blob>,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * SR)), SR);
  const narrated = p.narration.kind !== "none";
  // 1) 내레이션
  if (p.narration.kind === "ai") {
    let t = 0;
    for (const seg of p.narration.segments) {
      const buf = await ctx.decodeAudioData(await (await load(seg.fileId)).arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      if (t < total) src.start(t);
      t += seg.duration + p.narration.gapSec;
      if (signal?.aborted) throw new DOMException("출력을 취소했습니다.", "AbortError");
    }
  } else if (narrated && p.narration.fileId) {
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(await (await load(p.narration.fileId)).arrayBuffer());
    } catch {
      throw new RenderError("내레이션 파일을 읽지 못했습니다. MP3 · WAV · M4A 로 올려 주세요.");
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }
  // 2) 원본 소리를 살린 장면
  let start = 0;
  for (const s of p.scenes) {
    const fileId = s.kind === "clip" ? s.clip?.fileId : s.kind === "ai" ? s.ai?.fileId : null;
    if (s.keepAudio && fileId) {
      const input = new MB.Input({ source: new MB.BlobSource(await load(fileId)), formats: MB.ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack();
        if (track && (await track.canDecode())) {
          const gain = ctx.createGain();
          gain.gain.value = narrated ? p.output.sourceVolume : 1;
          gain.connect(ctx.destination);
          const from = s.kind === "clip" && s.clip ? s.clip.start : 0;
          const to = from + s.duration;
          const sink = new MB.AudioBufferSink(track);
          for await (const w of sink.buffers(from, to)) {
            const node = ctx.createBufferSource();
            node.buffer = w.buffer;
            node.connect(gain);
            const when = start + Math.max(0, w.timestamp - from);
            const offset = Math.max(0, from - w.timestamp);
            const dur = Math.min(w.duration - offset, start + s.duration - when);
            if (dur > 0) node.start(when, offset, dur);
          }
        }
      } finally {
        input.dispose();
      }
    }
    start += s.duration;
  }
  return ctx.startRendering();
}

interface Prepared {
  /** 다음 프레임 (장면 안 시각은 prepare 때 받은 순서대로) */
  next: () => Promise<CanvasImageSource | null>;
  size: [number, number];
  dispose: () => void;
}

/** 장면 하나를 연다. offsets = 이 장면에서 그릴 프레임들의 장면 안 시각 (오름차순) */
async function prepareScene(MB: MB, scene: Scene, offsets: number[], W: number, H: number, load: (id: string) => Promise<Blob>): Promise<Prepared> {
  const fileId = scene.kind === "clip" ? scene.clip?.fileId : scene.kind === "ai" ? scene.ai?.fileId : null;
  if (fileId) {
    const input = new MB.Input({ source: new MB.BlobSource(await load(fileId)), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new RenderError(`「${scene.label}」 파일에 영상이 없습니다.`);
    if (!(await track.canDecode())) throw new RenderError(`「${scene.label}」 영상 형식을 이 브라우저가 읽지 못합니다. H.264 MP4 로 바꿔 올려 주세요.`);
    // 풀(pool)을 쓰지 않는다 — 앞서 디코딩한 캔버스가 그리기 전에 덮이지 않게
    const sink = new MB.CanvasSink(track, { width: W, height: H, fit: "cover" });
    const base = scene.kind === "clip" && scene.clip ? scene.clip.start : 0;
    // 시각을 미리 다 알려 주면 디코딩은 한 번씩만 일어난다. 원본보다 길면 마지막 프레임을 잡는다
    const it = sink.canvasesAtTimestamps(offsets.map((o) => base + o))[Symbol.asyncIterator]();
    let last: CanvasImageSource | null = null;
    return {
      size: [W, H],
      next: async () => {
        const r = await it.next();
        if (!r.done && r.value) last = r.value.canvas as CanvasImageSource;
        return last;
      },
      dispose: () => {
        void it.return?.(undefined);
        input.dispose();
      },
    };
  }
  if (scene.kind === "image" && scene.image) {
    const bmp = await createImageBitmap(await load(scene.image.fileId));
    return { size: [bmp.width, bmp.height], next: async () => bmp, dispose: () => bmp.close() };
  }
  return { size: [0, 0], next: async () => null, dispose: () => undefined };
}

export async function renderProject(
  p: ProjectDoc,
  load: (id: string) => Promise<Blob>,
  onProgress: (pct: number, message: string) => void,
  signal?: AbortSignal,
): Promise<RenderResult> {
  const { width: W, height: H, fps } = p.output;
  const total = timelineSec(p.scenes);
  if (!(total > 0)) throw new RenderError("장면이 없습니다.");
  const support = await canRenderMp4(W, H);
  if (!support.ok) throw new RenderError(support.reason ?? "이 브라우저에서 출력할 수 없습니다.");
  const MB = await import("mediabunny");
  const abort = () => {
    if (signal?.aborted) throw new DOMException("출력을 취소했습니다.", "AbortError");
  };

  onProgress(1, "소리 섞는 중");
  const audio = await mixAudio(MB, p, total, load, signal);
  abort();

  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RenderError("캔버스를 준비하지 못했습니다.");
  const videoSource = new MB.CanvasSource(canvas, { codec: "avc", bitrate: 5_000_000, keyFrameInterval: 2 });
  const audioSource = new MB.AudioBufferSource({ codec: "aac", bitrate: 128_000 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);
  await output.start();

  const cues = effectiveCues(p);
  const overlay = p.output.disclosureOverlay ? overlayFor(p) : "";
  let open: Prepared | null = null;
  try {
    await audioSource.add(audio);
    const frames = Math.max(1, Math.round(total * fps));
    let f = 0;
    let sceneStart = 0;
    let lastReport = 0;
    for (const [i, scene] of p.scenes.entries()) {
      const isLast = i === p.scenes.length - 1;
      const sceneEnd = sceneStart + scene.duration;
      const mine: number[] = [];
      while (f < frames && (isLast || f / fps < sceneEnd - 1e-6)) mine.push(f++);
      if (mine.length) {
        onProgress(Math.round(5 + (mine[0] / frames) * 90), `장면 ${i + 1}/${p.scenes.length} 준비`);
        open = await prepareScene(MB, scene, mine.map((fr) => Math.max(0, fr / fps - sceneStart)), W, H, load);
        for (const fr of mine) {
          abort();
          const t = fr / fps;
          const offset = Math.max(0, t - sceneStart);
          const src = await open.next();
          if (scene.kind === "blank" || !src) drawBlank(ctx, scene.kind === "blank" ? "" : scene.label, W, H);
          else if (scene.kind === "image") drawCover(ctx, src, open.size[0], open.size[1], W, H, 1 + 0.06 * (offset / Math.max(0.1, scene.duration)));
          else drawCover(ctx, src, W, H, W, H);
          drawSubtitle(ctx, cueAt(cues, t)?.text ?? "", W, H);
          drawDisclosure(ctx, overlay, W, H);
          await videoSource.add(t, 1 / fps);
          const pct = Math.round(5 + ((fr + 1) / frames) * 90);
          if (pct !== lastReport) {
            lastReport = pct;
            onProgress(pct, `프레임 ${fr + 1}/${frames}`);
          }
        }
        open.dispose();
        open = null;
      }
      sceneStart = sceneEnd;
    }
    onProgress(96, "파일 마무리");
    await output.finalize();
  } catch (e) {
    open?.dispose();
    await output.cancel().catch(() => undefined);
    throw e;
  }
  const buf = (output.target as InstanceType<MB["BufferTarget"]>).buffer;
  if (!buf || !buf.byteLength) throw new RenderError("영상 파일이 만들어지지 않았습니다.");
  const blob = new Blob([buf], { type: "video/mp4" });
  // 만든 파일을 다시 열어 코덱을 확인한다 — 이 값이 게시 점검(Instagram H.264/AAC)의 근거가 된다
  const check = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
  const v = await check.getPrimaryVideoTrack();
  const a = await check.getPrimaryAudioTrack();
  const codecs = { video: (await v?.getCodec()) ?? null, audio: (await a?.getCodec()) ?? null };
  const duration = await check.computeDuration();
  check.dispose();
  onProgress(99, "확인 완료");
  return { blob, duration, codecs, overlay: { disclosure: !!overlay, text: overlay } };
}

/** 올린 원본의 길이 · 크기 (소스 등록 때) */
export async function probeMedia(blob: Blob): Promise<{ duration: number | null; width: number | null; height: number | null; video: string | null; audio: string | null }> {
  const MB = await import("mediabunny");
  const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    const d = await input.computeDuration();
    return {
      duration: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null,
      width: v ? v.displayWidth : null,
      height: v ? v.displayHeight : null,
      video: (await v?.getCodec()) ?? null,
      audio: (await a?.getCodec()) ?? null,
    };
  } catch {
    return { duration: null, width: null, height: null, video: null, audio: null };
  } finally {
    input.dispose();
  }
}
