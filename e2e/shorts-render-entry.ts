// 쇼츠 출력기 검증용 브라우저 진입점 — e2e/shorts-render.mjs 가 esbuild 로 묶어 Chrome 에서 돌린다.
// 로그인 · 서버 없이 출력기(render.ts)만 검증한다: 원본 영상 · 사진 · 내레이션을 브라우저에서
// 직접 만들고 → 출력 → 코덱 · 길이 · 화면 픽셀(자막 · 고지 띠) · 소리를 확인한다.
import { canRenderMp4, renderProject } from "../lib/neander/shorts/render";
import { emptyProject } from "../lib/neander/shorts/model";
import type { ProjectDoc } from "../lib/neander/shorts/types";

declare global {
  interface Window {
    runShortsRenderCheck: () => Promise<Record<string, unknown>>;
    runShortsCancelCheck: () => Promise<Record<string, unknown>>;
  }
}

async function makeClip(seconds: number, color: string, toneHz: number): Promise<Blob> {
  const MB = await import("mediabunny");
  const W = 640;
  const H = 360; // 가로 원본 — 세로 9:16 으로 잘라 넣는 것까지 본다
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const out = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
  const vs = new MB.CanvasSource(canvas, { codec: "avc", bitrate: 1_000_000 });
  const as = new MB.AudioBufferSource({ codec: "aac", bitrate: 96_000 });
  out.addVideoTrack(vs, { frameRate: 30 });
  out.addAudioTrack(as);
  await out.start();
  const sr = 48_000;
  const ab = new AudioBuffer({ numberOfChannels: 2, length: sr * seconds, sampleRate: sr });
  for (let c = 0; c < 2; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin((2 * Math.PI * toneHz * i) / sr);
  }
  await as.add(ab);
  for (let f = 0; f < seconds * 30; f++) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.font = "bold 80px sans-serif";
    ctx.fillText(String(f), 40, 200);
    await vs.add(f / 30, 1 / 30);
  }
  await out.finalize();
  return new Blob([(out.target as InstanceType<typeof MB.BufferTarget>).buffer!], { type: "video/mp4" });
}

function wav(seconds: number, hz: number): Blob {
  const sr = 24_000;
  const n = sr * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(9000 * Math.sin((2 * Math.PI * hz * i) / sr)), true);
  return new Blob([buf], { type: "audio/wav" });
}

async function png(): Promise<Blob> {
  const c = new OffscreenCanvas(800, 800);
  const x = c.getContext("2d")!;
  x.fillStyle = "#16a34a";
  x.fillRect(0, 0, 800, 800);
  return c.convertToBlob({ type: "image/png" });
}

async function fixture(): Promise<{ p: ProjectDoc; files: Map<string, Blob> }> {
  const files = new Map<string, Blob>([
    ["clipRed000001", await makeClip(3, "#dc2626", 440)],
    ["clipBlue00001", await makeClip(2, "#2563eb", 660)],
    ["photo00000001", await png()],
    ["narration0001", wav(6, 220)],
  ]);
  const p = emptyProject("test@example.com", { product: "검증 상품" });
  p.scenes = [
    { id: "s1", kind: "clip", label: "원본 구간", duration: 2, clip: { fileId: "clipRed000001", start: 0.5, end: 2.5, sourceId: null, segmentId: null }, ai: null, image: null, keepAudio: true },
    { id: "s2", kind: "image", label: "사진", duration: 1.5, clip: null, ai: null, image: { fileId: "photo00000001" }, keepAudio: false },
    { id: "s3", kind: "ai", label: "AI 장면(승인)", duration: 1.5, clip: null, image: null, keepAudio: false, ai: { prompt: "x", status: "approved", jobId: null, fileId: "clipBlue00001", model: "test", reviewNote: "" } },
    { id: "s4", kind: "blank", label: "", duration: 1, clip: null, ai: null, image: null, keepAudio: false },
  ];
  p.script.lines = [
    { id: "l1", beat: "hook", text: "첫 줄 자막입니다", caption: "", sceneId: "s1" },
    { id: "l2", beat: "demo", text: "두 번째 줄", caption: "", sceneId: "s3" },
  ];
  p.subtitles = { cues: [{ start: 0, end: 3, text: "첫 줄 자막입니다", lineId: "l1" }, { start: 3, end: 6, text: "두 번째 줄", lineId: "l2" }], edited: true };
  p.narration = { kind: "file", fileId: "narration0001", duration: 6, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: null };
  return { p, files };
}

async function pixels(blob: Blob, at: number) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true;
  v.src = url;
  await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
  v.currentTime = at;
  await new Promise((r) => (v.onseeked = r));
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  const x = c.getContext("2d")!;
  x.drawImage(v, 0, 0);
  const px = (fx: number, fy: number) => Array.from(x.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3));
  // 가로 한 줄을 훑어 어두운 상자 픽셀과 흰 글자 픽셀을 센다 (글자 폭에 따라 상자 위치가 바뀌므로)
  const row = (fy: number) => {
    const d = x.getImageData(0, Math.round(c.height * fy), c.width, 1).data;
    let dark = 0;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] < 200) dark++;
      if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225) white++;
    }
    return { dark, white };
  };
  const out = { w: v.videoWidth, h: v.videoHeight, duration: v.duration, center: px(0.5, 0.45), subtitleRow: row(0.757), bannerRow: row(0.077), plainRow: row(0.3) };
  URL.revokeObjectURL(url);
  return out;
}

async function audioEnergy(blob: Blob) {
  const ctx = new OfflineAudioContext(2, 48_000, 48_000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const d = buf.getChannelData(0);
  const rms = (a: number, b: number) => {
    let s = 0;
    const i0 = Math.floor(a * buf.sampleRate);
    const i1 = Math.min(d.length, Math.floor(b * buf.sampleRate));
    for (let i = i0; i < i1; i++) s += d[i] * d[i];
    return Math.sqrt(s / Math.max(1, i1 - i0));
  };
  return { seconds: buf.duration, rmsFirst: rms(0.2, 1.8), rmsLast: rms(6.2, 6.8), channels: buf.numberOfChannels };
}

window.runShortsRenderCheck = async () => {
  const support = await canRenderMp4();
  if (!support.ok) return { support };
  const { p, files } = await fixture();
  const progress: number[] = [];
  const t0 = performance.now();
  const r = await renderProject(p, async (id) => files.get(id)!, (pct) => progress.push(pct));
  const ms = Math.round(performance.now() - t0);
  const first = await pixels(r.blob, 0.5);
  const third = await pixels(r.blob, 4.2);
  const audio = await audioEnergy(r.blob);
  const bytes = new Uint8Array(await r.blob.arrayBuffer());
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { support, ms, size: r.blob.size, duration: r.duration, codecs: r.codecs, overlay: r.overlay, progressMonotonic: progress.every((x, i) => i === 0 || x >= progress[i - 1]), lastProgress: progress[progress.length - 1], first, third, audio, mp4Base64: btoa(b64) };
};

window.runShortsCancelCheck = async () => {
  const { p, files } = await fixture();
  const ac = new AbortController();
  let name = "";
  try {
    await renderProject(p, async (id) => files.get(id)!, (pct) => {
      if (pct > 30) ac.abort();
    }, ac.signal);
  } catch (e) {
    name = (e as Error).name;
  }
  return { abortedWith: name };
};
