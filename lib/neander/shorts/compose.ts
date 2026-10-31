"use client";

// ============================================================
//  한 프레임 그리기 — 미리보기와 출력이 같은 함수를 쓴다
// ------------------------------------------------------------
//  자막 · 고지 띠의 위치와 크기를 두 곳에서 따로 정하면 미리보기와 결과가
//  어긋난다. 그래서 여기 한 벌만 둔다 (render.ts · Preview.tsx).
// ============================================================

import type { Scene, SubtitleCue } from "./types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function sceneAt(scenes: Scene[], t: number): { index: number; scene: Scene; offset: number; start: number } | null {
  let start = 0;
  for (const [index, scene] of scenes.entries()) {
    if (t < start + scene.duration || index === scenes.length - 1) return { index, scene, offset: Math.max(0, t - start), start };
    start += scene.duration;
  }
  return null;
}

export const cueAt = (cues: SubtitleCue[], t: number) => cues.find((c) => t >= c.start && t < c.end) ?? null;

/** 화면을 덮도록 (가운데 기준 잘라내기) — zoom 은 사진 장면의 천천히 다가가기 */
export function drawCover(ctx: Ctx, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, zoom = 1) {
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0, 0, W, H);
  if (!sw || !sh) return;
  const scale = Math.max(W / sw, H / sh) * zoom;
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}

export function drawBlank(ctx: Ctx, label: string, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1f2937");
  g.addColorStop(1, "#0b0b0f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (!label) return;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = `600 ${Math.round(W * 0.04)}px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.slice(0, 30), W / 2, H * 0.45);
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** 자막 — 화면 아래쪽 79% 선 위에, 굵은 흰 글씨 + 검은 테두리 + 반투명 상자 */
export function drawSubtitle(ctx: Ctx, text: string, W: number, H: number) {
  if (!text.trim()) return;
  const fontSize = Math.round(W * 0.056);
  ctx.font = `800 ${fontSize}px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text, W * 0.84);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] = shown[2].slice(0, -1) + "…";
  const lh = fontSize * 1.38;
  const boxH = shown.length * lh + fontSize * 0.7;
  const boxW = Math.min(W * 0.92, Math.max(...shown.map((l) => ctx.measureText(l).width), 0) + fontSize);
  const y0 = H * 0.79 - boxH;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  if ("roundRect" in ctx) ctx.roundRect((W - boxW) / 2, y0, boxW, boxH, fontSize * 0.25);
  else (ctx as CanvasRenderingContext2D).rect((W - boxW) / 2, y0, boxW, boxH);
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = fontSize * 0.13;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.fillStyle = "#ffffff";
  shown.forEach((l, i) => {
    const y = y0 + fontSize * 0.35 + lh * (i + 0.5);
    ctx.strokeText(l, W / 2, y);
    ctx.fillText(l, W / 2, y);
  });
}

/**
 * 영상 안 고지 띠 — 화면 위쪽, 플랫폼 UI(상단 아이콘)에 덜 가리게 6% 아래.
 * 처음부터 끝까지 그린다 (공정위 심사지침: 영상 전체가 추천이면 시작 · 끝 · 중간 반복).
 */
export function drawDisclosure(ctx: Ctx, text: string, W: number, H: number) {
  if (!text) return;
  const fontSize = Math.round(W * 0.032);
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = Math.min(W * 0.94, ctx.measureText(text).width + fontSize * 1.4);
  const h = fontSize * 1.9;
  const y = H * 0.06;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  if ("roundRect" in ctx) ctx.roundRect((W - w) / 2, y, w, h, h / 2);
  else (ctx as CanvasRenderingContext2D).rect((W - w) / 2, y, w, h);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, W / 2, y + h / 2);
}
