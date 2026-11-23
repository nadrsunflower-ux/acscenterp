// ============================================================
//  회의록 본문 읽기 — 손으로 쓴 글머리표를 문서처럼 보여 준다
// ------------------------------------------------------------
//  회의록은 편집칸(textarea)에 평문으로 쓴다. 사람도 AI 초안도 같은
//  버릇으로 쓴다 — 「■ 소제목」, 「- 항목」, 「1) 항목」, 들여 쓴 「· 항목」.
//  그대로 pre-wrap 으로 찍으면 기호와 공백이 글을 덮어 읽기 어렵다.
//  줄마다 그 버릇만 알아보고 제목 · 글머리 목록 · 문단으로 바꿔 그린다.
//  모르는 줄은 문단으로 둔다 — 글자는 하나도 버리지 않는다.
//
//  마크다운 전체를 받아들이지 않는 이유: 회의록에는 「*」·「_」·「#」 가 뜻 없이
//  들어간다(상품 코드 #1234 등). 우리가 실제로 쓰는 몇 가지만 알아본다.
//  다만 주소(http…)는 뜻이 헷갈릴 일이 없어서 눌러 열 수 있게 해 둔다.
//
//  서식(굵게 · 형광펜 …)은 프로젝트 메모와 같은 `NoteRich` 로 따로 온다.
//  줄마다 글머리 기호를 뗀 자리부터 같은 글자 구간의 조각을 잘라 그린다.
// ============================================================

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/components/neander/ui";
import {
  NOTE_COLORS,
  NOTE_FONTS,
  NOTE_HILITES,
  NOTE_SIZES,
  reconcileNoteRich,
  type NoteRich,
  type NoteRun,
} from "@/lib/neander/finance/rich-note";

/** 글자가 원문 몇째 줄의 몇째 글자부터인지 — 서식 조각을 잘라 올 자리 */
interface Src {
  line: number;
  start: number;
}

type Block =
  | ({ kind: "h"; text: string } & Src)
  | ({ kind: "li"; text: string; depth: number; marker: string | null } & Src)
  | ({ kind: "p"; text: string; depth: number } & Src)
  | { kind: "gap" };

// 「#1234 상품」 같은 코드는 제목이 아니다 — # 뒤에는 빈칸이 있어야 한다.
// 「[결제·택스리펀]」 처럼 줄 전체가 대괄호인 것도 우리 회의록의 소제목 버릇이다
const HEADING = /^(?:[■□▶▣]\s*|#{1,3}\s+)(.+)$/;
const BRACKET_HEADING = /^\[([^\]]{1,40})\]$/;
const BULLET = /^[-•·*∙◦▪]\s+(.+)$/;
// 「네. 알겠습니다」 가 번호가 되지 않게 — 숫자 1. 1) · 영문 a) · 가) 나) 만
const NUMBERED = /^(\d{1,2}[.)]|[a-zA-Z]\)|[가나다라마바사아자차카타파하]\))\s+(.+)$/;
const CIRCLED = /^([①-⑳])\s*(.+)$/;

/** 앞 공백 → 들여쓰기 단계 (공백 두 칸 또는 탭 하나가 한 단계) */
function depthOf(raw: string): number {
  const lead = raw.match(/^[\t 　]*/)?.[0] ?? "";
  let w = 0;
  for (const ch of lead) w += ch === "\t" ? 2 : ch === "　" ? 2 : 1;
  return Math.min(3, Math.floor(w / 2));
}

export function parseMinutes(text: string): Block[] {
  const out: Block[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, n) => {
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1].kind !== "gap") out.push({ kind: "gap" });
      return;
    }
    const depth = depthOf(raw);
    const lead = raw.length - raw.trimStart().length;
    // 글머리 뒤 글자는 언제나 줄의 끝부분이다 — 원문에서의 시작 자리
    const src = (t: string): Src => ({ line: n, start: lead + line.length - t.length });
    let m: RegExpMatchArray | null;
    if (depth === 0 && (m = line.match(HEADING))) out.push({ kind: "h", text: m[1], ...src(m[1]) });
    else if (depth === 0 && (m = line.match(BRACKET_HEADING))) out.push({ kind: "h", text: m[1], line: n, start: lead + 1 });
    else if ((m = line.match(BULLET))) out.push({ kind: "li", text: m[1], depth, marker: null, ...src(m[1]) });
    else if ((m = line.match(NUMBERED)) || (m = line.match(CIRCLED))) out.push({ kind: "li", text: m[2], depth, marker: m[1], ...src(m[2]) });
    else out.push({ kind: "p", text: line, depth, ...src(line) });
  });
  while (out[out.length - 1]?.kind === "gap") out.pop();
  return out;
}

/** 들여쓰기 한 단계의 폭 */
const INDENT = 18;

// 주소에 쓰이는 글자만 받는다 — 「…co.kr입니다」 처럼 뒤에 붙은 한글을 삼키지 않게.
// 그러고도 남는 문장부호(문장 끝 마침표, 괄호 닫기)는 주소에서 뗀다
const URL = /(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;
const TRAIL = /[.,;:!?)\]}'"]+$/;

/** 글줄 안의 주소만 링크로 바꾼다 — 나머지 글자는 그대로 둔다 */
function withLinks(text: string): ReactNode {
  const parts = text.split(URL);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0 || !part) return part;
    const tail = part.match(TRAIL)?.[0] ?? "";
    const href = tail ? part.slice(0, -tail.length) : part;
    return (
      <span key={i}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-nd-accent-strong underline decoration-nd-accent/40 underline-offset-2 hover:decoration-nd-accent-strong"
        >
          {href}
        </a>
        {tail}
      </span>
    );
  });
}

function runCss(r: NoteRun): CSSProperties | undefined {
  const st: CSSProperties = {};
  if (r.b) st.fontWeight = 700;
  if (r.i) st.fontStyle = "italic";
  const deco = [r.u && "underline", r.s && "line-through"].filter(Boolean).join(" ");
  if (deco) st.textDecorationLine = deco;
  if (r.c) st.color = NOTE_COLORS[r.c].css;
  if (r.h) {
    st.backgroundColor = NOTE_HILITES[r.h].css;
    // 형광펜 위 글자는 밝은 배경 위라 언제나 짙게
    if (!r.c) st.color = "#1d1d1f";
  }
  if (r.f) st.fontFamily = NOTE_FONTS[r.f].css;
  if (r.z) st.fontSize = NOTE_SIZES[r.z].px;
  return Object.keys(st).length ? st : undefined;
}

/** 한 줄의 조각에서 [start, start+len) 글자 구간만 잘라 온다 */
function sliceRuns(runs: NoteRun[], start: number, len: number): NoteRun[] {
  const out: NoteRun[] = [];
  let at = 0;
  const end = start + len;
  for (const r of runs) {
    const a = Math.max(start, at);
    const b = Math.min(end, at + r.t.length);
    if (b > a) out.push({ ...r, t: r.t.slice(a - at, b - at) });
    at += r.t.length;
    if (at >= end) break;
  }
  return out;
}

/** 글줄 그리기 — 서식이 있으면 조각마다 모양을 입히고, 주소는 링크로 */
function inline(text: string, runs: NoteRun[] | undefined, start: number): ReactNode {
  if (!runs || runs.every((r) => !runCss(r))) return withLinks(text);
  const part = sliceRuns(runs, start, text.length);
  if (part.map((r) => r.t).join("") !== text) return withLinks(text); // 어긋나면 글자를 지킨다
  return part.map((r, k) => {
    const st = runCss(r);
    return st ? (
      <span key={k} style={st}>
        {withLinks(r.t)}
      </span>
    ) : (
      <span key={k}>{withLinks(r.t)}</span>
    );
  });
}

export function MinutesText({ text, rich, className }: { text: string; rich?: NoteRich; className?: string }) {
  const blocks = parseMinutes(text);
  // 평문만 바뀐 경우(MCP · 스크립트)에도 그대로인 줄의 서식은 살린다
  const lines = reconcileNoteRich(text, rich)?.lines;
  const fmt = (b: Extract<Block, Src>) => inline(b.text, lines?.[b.line], b.start);
  const nodes: ReactNode[] = [];
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    if (b.kind === "gap") return;
    // 빈 줄 뒤에는 한 박자 쉰다 — 제목 앞은 제목이 스스로 띄운다
    const afterGap = prev?.kind === "gap" && b.kind !== "h";
    if (b.kind === "h") {
      nodes.push(
        <h3
          key={i}
          className="mb-1.5 mt-7 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-nd-fg first:mt-0"
        >
          {fmt(b)}
        </h3>,
      );
    } else if (b.kind === "li") {
      nodes.push(
        <div
          key={i}
          className={cn("flex gap-2", afterGap ? "mt-3" : "mt-1")}
          style={{ paddingLeft: b.depth * INDENT }}
        >
          <span
            // 번호는 읽어 준다 — 순서가 뜻이다. 점만 감춘다
            aria-hidden={!b.marker}
            className={cn(
              "shrink-0 text-right text-nd-fg-3",
              b.marker ? "nd-num min-w-[1.4em] font-medium" : "w-[1.4em] text-center",
            )}
          >
            {b.marker ?? (b.depth > 0 ? "◦" : "•")}
          </span>
          <span className="min-w-0 break-words">{fmt(b)}</span>
        </div>,
      );
    } else {
      nodes.push(
        <p key={i} className={cn("break-words", afterGap ? "mt-3" : "mt-1", "first:mt-0")} style={{ paddingLeft: b.depth * INDENT }}>
          {fmt(b)}
        </p>,
      );
    }
  });
  return <div className={cn("text-[15px] leading-[1.7] text-nd-fg", className)}>{nodes}</div>;
}
