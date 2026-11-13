// ============================================================
//  프로젝트 메모 서식 — 굵게 · 기울임 · 밑줄 · 취소선 · 글자색 · 형광펜 · 글꼴 · 크기
// ------------------------------------------------------------
//  메모의 **글자는 언제나 평문 `note`** 에 있다. 재무 비서 · 보고서 · 검색 ·
//  스크립트는 지금처럼 `note` 만 읽고 쓴다. 서식은 옆 칸 `noteRich` 에 줄마다
//  「글자 조각 + 서식 이름」 으로 담는다.
//
//  · HTML 을 저장하지 않는다 — 조각마다 정해진 서식 이름(빨강 · 노랑 형광 …)만
//    받으니 서버에서 거르기 쉽고, 화면에 그릴 때 글자는 늘 escape 된다.
//  · 서식은 `note` 를 따라간다 — 누가 평문만 고쳐도(스크립트 · 비서) 그대로인
//    줄의 서식은 남고, 바뀐 줄 · 새 줄만 서식 없이 들어간다 (reconcileNoteRich).
//  · 서식이 하나도 없으면 `noteRich` 를 두지 않는다.
// ============================================================

export const NOTE_COLORS = {
  red: { label: "빨강", css: "#d93025" },
  orange: { label: "주황", css: "#e8710a" },
  green: { label: "초록", css: "#188038" },
  blue: { label: "파랑", css: "#1a73e8" },
  purple: { label: "보라", css: "#9334e6" },
  gray: { label: "회색", css: "#6b7280" },
} as const;

/** 형광펜 — 옅은 같은 계열은 구분이 안 된다(사용자 지적) · 서로 다른 색으로 */
export const NOTE_HILITES = {
  yellow: { label: "노랑", css: "#fff176" },
  green: { label: "연두", css: "#c5f0a4" },
  blue: { label: "하늘", css: "#b3e0ff" },
  pink: { label: "분홍", css: "#ffc4dd" },
  orange: { label: "주황", css: "#ffd08a" },
} as const;

/** 글꼴 — 기본은 앱 글꼴(Pretendard). 뒤의 이름들은 그 글꼴이 없을 때 쓴다 */
export const NOTE_FONTS = {
  serif: { label: "명조", css: "'Nanum Myeongjo', AppleMyungjo, Batang, 'Noto Serif KR', serif", marker: "nanum myeongjo" },
  mono: { label: "고정폭", css: "D2Coding, 'SF Mono', Menlo, Consolas, monospace", marker: "d2coding" },
} as const;

/** 글자 크기 — 기본은 편집기 글자(14px). 작은 글씨는 읽기 힘들다고 해서 키우는 쪽만 */
export const NOTE_SIZES = {
  l: { label: "크게", px: 17 },
  xl: { label: "아주 크게", px: 21 },
} as const;

export type NoteColor = keyof typeof NOTE_COLORS;
export type NoteHilite = keyof typeof NOTE_HILITES;
export type NoteFont = keyof typeof NOTE_FONTS;
export type NoteSize = keyof typeof NOTE_SIZES;

export interface NoteRun {
  t: string;
  /** 굵게 */
  b?: true;
  /** 기울임 */
  i?: true;
  /** 밑줄 */
  u?: true;
  /** 취소선 */
  s?: true;
  /** 글자색 */
  c?: NoteColor;
  /** 형광펜 */
  h?: NoteHilite;
  /** 글꼴 */
  f?: NoteFont;
  /** 크기 */
  z?: NoteSize;
}

export interface NoteRich {
  v: 1;
  /** 줄마다 글자 조각 — 빈 줄은 [] */
  lines: NoteRun[][];
}

const LIMITS = { lines: 5_000, runsPerLine: 500, chars: 200_000 };

const has = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

const STYLE_KEYS = ["b", "i", "u", "s", "c", "h", "f", "z"] as const;

function sameStyle(a: NoteRun, b: NoteRun): boolean {
  return STYLE_KEYS.every((k) => a[k] === b[k]);
}

export const isPlainRun = (r: NoteRun) => STYLE_KEYS.every((k) => r[k] === undefined);

/** 빈 조각을 버리고 서식이 같은 이웃을 합친다 */
export function normalizeLine(runs: NoteRun[]): NoteRun[] {
  const out: NoteRun[] = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) out[out.length - 1] = { ...last, t: last.t + r.t };
    else out.push({ ...r });
  }
  return out;
}

export const lineText = (runs: NoteRun[]) => runs.map((r) => r.t).join("");

/** 서식 메모의 평문 — `note` 와 같아야 한다 */
export const richText = (rich: NoteRich) => rich.lines.map(lineText).join("\n");

export const hasFormatting = (rich: NoteRich) => rich.lines.some((l) => l.some((r) => !isPlainRun(r)));

const splitLines = (note: string) => note.replace(/\r\n?/g, "\n").split("\n");

export const plainToRich = (note: string): NoteRich => ({
  v: 1,
  lines: splitLines(note).map((l) => (l ? [{ t: l }] : [])),
});

/** 저장 직전 — 모르는 서식 이름 · 이상한 모양은 버린다. 쓸 게 없으면 undefined */
export function sanitizeNoteRich(raw: unknown): NoteRich | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { v?: unknown; lines?: unknown };
  if (r.v !== 1 || !Array.isArray(r.lines)) return undefined;
  let chars = 0;
  const lines: NoteRun[][] = [];
  for (const line of r.lines.slice(0, LIMITS.lines)) {
    if (!Array.isArray(line)) {
      lines.push([]);
      continue;
    }
    const runs: NoteRun[] = [];
    for (const x of line.slice(0, LIMITS.runsPerLine)) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      // 줄바꿈은 줄 사이에만 있다 — 조각 속 줄바꿈은 띄어쓰기로
      const t = String(o.t ?? "").replace(/[\r\n]+/g, " ");
      if (!t) continue;
      chars += t.length;
      if (chars > LIMITS.chars) return undefined;
      const run: NoteRun = { t };
      if (o.b === true) run.b = true;
      if (o.i === true) run.i = true;
      if (o.u === true) run.u = true;
      if (o.s === true) run.s = true;
      if (has(NOTE_COLORS, o.c)) run.c = o.c;
      if (has(NOTE_HILITES, o.h)) run.h = o.h;
      if (has(NOTE_FONTS, o.f)) run.f = o.f;
      if (has(NOTE_SIZES, o.z)) run.z = o.z;
      runs.push(run);
    }
    lines.push(normalizeLine(runs));
  }
  return { v: 1, lines };
}

/**
 * 서식을 평문 메모에 맞춘다. 같은 글자의 줄은 서식을 그대로 가져오고
 * (줄 순서를 지키는 LCS), 바뀐 줄 · 새 줄은 서식 없이 넣는다.
 * 메모가 비었거나 남는 서식이 없으면 undefined.
 */
export function reconcileNoteRich(note: string | undefined, rich: NoteRich | undefined): NoteRich | undefined {
  if (!note || !rich) return undefined;
  const target = splitLines(note);
  const src = rich.lines.map(normalizeLine);
  const srcText = src.map(lineText);
  let lines: NoteRun[][];
  if (srcText.length === target.length && srcText.every((t, k) => t === target[k])) {
    lines = src;
  } else {
    const match = matchLines(srcText, target);
    lines = target.map((t, k) => (match[k] >= 0 ? src[match[k]] : t ? [{ t }] : []));
  }
  const out: NoteRich = { v: 1, lines };
  return hasFormatting(out) ? out : undefined;
}

/** target[k] 에 짝지은 src 의 줄 번호 (없으면 -1) — 순서를 지키는 최장 공통 줄 */
function matchLines(src: string[], target: string[]): number[] {
  const n = src.length;
  const m = target.length;
  const match = new Array<number>(m).fill(-1);
  if (n * m > 4_000_000) {
    // 아주 긴 메모 — 같은 글자의 줄을 앞에서부터 차례로 짝짓는다
    let j = 0;
    for (let k = 0; k < m && j < n; k++) {
      const at = src.indexOf(target[k], j);
      if (at >= 0) {
        match[k] = at;
        j = at + 1;
      }
    }
    return match;
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) {
      dp[a][b] = src[a] === target[b] ? dp[a + 1][b + 1] + 1 : Math.max(dp[a + 1][b], dp[a][b + 1]);
    }
  }
  let a = 0;
  let b = 0;
  while (a < n && b < m) {
    if (src[a] === target[b]) {
      match[b] = a;
      a++;
      b++;
    } else if (dp[a + 1][b] >= dp[a][b + 1]) a++;
    else b++;
  }
  return match;
}

// ---- 화면에 그리기 ----------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 조각 하나의 CSS — 편집기가 다시 읽을 때도 이 모양으로 알아본다 */
export function runStyle(r: NoteRun): string {
  const css: string[] = [];
  if (r.b) css.push("font-weight:700");
  if (r.i) css.push("font-style:italic");
  const deco = [r.u && "underline", r.s && "line-through"].filter(Boolean).join(" ");
  if (deco) css.push(`text-decoration-line:${deco}`);
  if (r.c) css.push(`color:${NOTE_COLORS[r.c].css}`);
  if (r.h) css.push(`background-color:${NOTE_HILITES[r.h].css}`);
  if (r.f) css.push(`font-family:${NOTE_FONTS[r.f].css}`);
  if (r.z) css.push(`font-size:${NOTE_SIZES[r.z].px}px`);
  return css.join(";");
}

/** 줄마다 <div> — 편집기(contentEditable)와 읽기 화면이 같이 쓴다 */
export function richToHtml(rich: NoteRich): string {
  return rich.lines
    .map((runs) => {
      const inner = runs
        .map((r) => {
          const text = escapeHtml(r.t);
          const style = runStyle(r);
          return style ? `<span style="${escapeHtml(style)}">${text}</span>` : text;
        })
        .join("");
      return `<div>${inner || "<br>"}</div>`;
    })
    .join("");
}

// ---- 편집기가 읽은 CSS 값을 서식 이름으로 ---------------------------

function rgbOf(css: string): [number, number, number] | null {
  const s = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null; // 투명
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

function findColor<T extends Record<string, { css: string }>>(table: T, css: string): keyof T | undefined {
  const v = rgbOf(css);
  if (!v) return undefined;
  return (Object.keys(table) as (keyof T)[]).find((k) => {
    const p = rgbOf(table[k].css);
    return !!p && p[0] === v[0] && p[1] === v[1] && p[2] === v[2];
  });
}

export const colorKeyOf = (css: string): NoteColor | undefined => findColor(NOTE_COLORS, css);
export const hiliteKeyOf = (css: string): NoteHilite | undefined => findColor(NOTE_HILITES, css);
export function fontKeyOf(css: string): NoteFont | undefined {
  const s = css.toLowerCase().replace(/["']/g, "");
  return (Object.keys(NOTE_FONTS) as NoteFont[]).find((k) => s.includes(NOTE_FONTS[k].marker));
}
export function sizeKeyOf(css: string): NoteSize | undefined {
  const px = parseFloat(css);
  if (!/px$/i.test(css.trim()) || !Number.isFinite(px)) return undefined;
  return (Object.keys(NOTE_SIZES) as NoteSize[]).find((k) => Math.abs(NOTE_SIZES[k].px - px) < 0.5);
}
