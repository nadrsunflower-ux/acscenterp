"use client";

// ============================================================
//  프로젝트 메모 편집기 — 워드처럼 굵게 · 기울임 · 밑줄 · 취소선 · 글자색 ·
//  형광펜 · 글꼴 · 크기를 칠한다.
// ------------------------------------------------------------
//  메일 편집기(mail/RichEditor)와 같이 contentEditable + execCommand 로 만든다
//  (편집기 라이브러리 없이). 다른 점:
//  · 저장은 HTML 이 아니라 rich-note.ts 의 「줄 → 글자 조각 + 서식 이름」 이다.
//    편집 칸을 읽을 때(readEditor) 정해진 서식만 알아보고 나머지는 버린다.
//  · 붙여넣기는 글자만 — 다른 곳의 서식 · 이미지가 섞이지 않는다.
//  · 글자는 평문 `note` 로 함께 내보낸다 (줄 = 줄).
//
//  ⚠️ 편집 칸은 **제어하지 않는다** — 칠 때마다 innerHTML 을 다시 쓰면 커서가
//     튄다. 내가 내보낸 값이 아닌 값이 들어올 때(화면 되돌리기 · 다른 사람
//     저장)만 다시 그린다.
// ============================================================

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bold, ChevronDown, Eraser, Highlighter, Italic, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { Icon, cn, useEscape, useOutsideClick, type LucideIcon } from "@/components/neander/ui";
import {
  NOTE_COLORS,
  NOTE_FONTS,
  NOTE_HILITES,
  NOTE_SIZES,
  colorKeyOf,
  fontKeyOf,
  hasFormatting,
  hiliteKeyOf,
  normalizeLine,
  plainToRich,
  reconcileNoteRich,
  richText,
  richToHtml,
  sizeKeyOf,
  type NoteFont,
  type NoteRich,
  type NoteRun,
  type NoteSize,
} from "@/lib/neander/finance/rich-note";

// ---- 편집 칸 → 서식 메모 -----------------------------------------

const BLOCK = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "TABLE", "TR"]);

/** 조상에게서 물려받는 서식 — 가까운 조상이 정한 값이 이긴다 (밑줄 · 취소선은 쌓인다) */
interface Fmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  c?: string | null;
  h?: string | null;
  f?: string | null;
  z?: string | null;
}

const boldWeight = (w: string) => w === "bold" || w === "bolder" || (Number(w) >= 600 && Number.isFinite(Number(w)));

function fmtOf(el: HTMLElement, up: Fmt): Fmt {
  const tag = el.tagName;
  const st = el.style;
  const deco = `${st.textDecorationLine || ""} ${st.textDecoration || ""}`;
  const next: Fmt = { ...up };
  if (tag === "B" || tag === "STRONG") next.b = true;
  if (st.fontWeight) next.b = boldWeight(st.fontWeight);
  if (tag === "I" || tag === "EM") next.i = true;
  if (st.fontStyle) next.i = st.fontStyle === "italic" || st.fontStyle === "oblique";
  if (tag === "U" || deco.includes("underline")) next.u = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL" || deco.includes("line-through")) next.s = true;
  const color = st.color || (tag === "FONT" ? el.getAttribute("color") : null);
  if (color) next.c = color;
  if (st.backgroundColor) next.h = st.backgroundColor;
  const face = st.fontFamily || (tag === "FONT" ? el.getAttribute("face") : null);
  if (face) next.f = face;
  if (st.fontSize) next.z = st.fontSize;
  return next;
}

function runOf(t: string, f: Fmt): NoteRun {
  const r: NoteRun = { t };
  if (f.b) r.b = true;
  if (f.i) r.i = true;
  if (f.u) r.u = true;
  if (f.s) r.s = true;
  const c = f.c ? colorKeyOf(f.c) : undefined;
  if (c) r.c = c;
  const h = f.h ? hiliteKeyOf(f.h) : undefined;
  if (h) r.h = h;
  const ff = f.f ? fontKeyOf(f.f) : undefined;
  if (ff) r.f = ff;
  const z = f.z ? sizeKeyOf(f.z) : undefined;
  if (z) r.z = z;
  return r;
}

/** 줄 끝에 남는 <br> 은 빈 줄을 보이게 하는 자리표라 줄로 세지 않는다 */
function isLastInBlock(br: Node, root: HTMLElement): boolean {
  let n: Node = br;
  for (;;) {
    let sib = n.nextSibling;
    while (sib && sib.nodeType === Node.TEXT_NODE && !sib.nodeValue) sib = sib.nextSibling;
    if (sib) return false;
    const p = n.parentNode;
    if (!p || p === root || BLOCK.has((p as HTMLElement).tagName)) return true;
    n = p;
  }
}

export function readEditor(root: HTMLElement): NoteRich {
  const lines: NoteRun[][] = [[]];
  let pending = false;
  const cur = () => lines[lines.length - 1];
  const flush = () => {
    if (pending) {
      lines.push([]);
      pending = false;
    }
  };
  const visit = (node: Node, up: Fmt) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.nodeValue ?? "").replace(/ /g, " ").replace(/​/g, "");
        if (!text) return;
        flush();
        text.split("\n").forEach((part, k) => {
          if (k > 0) lines.push([]);
          if (part) cur().push(runOf(part, up));
        });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as HTMLElement;
      if (el.tagName === "BR") {
        if (isLastInBlock(el, root)) return;
        flush();
        lines.push([]);
        return;
      }
      const fmt = fmtOf(el, up);
      if (BLOCK.has(el.tagName)) {
        if (cur().length > 0 || pending) lines.push([]);
        pending = false;
        visit(el, fmt);
        pending = true;
      } else {
        visit(el, fmt);
      }
    });
  };
  visit(root, {});
  return { v: 1, lines: lines.map(normalizeLine) };
}

// ---- 도구 막대 ---------------------------------------------------

function ToolButton({ icon, label, onRun, active }: { icon: LucideIcon; label: string; onRun: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // 누르는 순간 편집 칸의 선택이 풀리지 않게
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.07] hover:text-nd-fg",
        active && "bg-nd-accent-soft text-nd-accent-strong",
      )}
    >
      <Icon icon={icon} size={15} />
    </button>
  );
}

/** 선택을 놓치지 않는 작은 펼침 — 안의 버튼도 mousedown 을 막는다 */
function Drop({ label, button, children, wide }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClick([box], open, close);
  useEscape(open, close);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[6px] px-1.5 text-[13px] text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.07] hover:text-nd-fg"
      >
        {button}
        <Icon icon={ChevronDown} size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute left-0 top-full z-30 mt-1 rounded-nd-md border border-nd-border bg-nd-content p-1.5 shadow-lg",
            wide ? "min-w-[9rem]" : "",
          )}
          onMouseDown={(e) => e.preventDefault()}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-nd-line" />;

/** execCommand 로 칠한 「크기 7」 을 정해진 px 로 바꾼다 (빈 값 = 기본 크기) */
function settleFontSize(root: HTMLElement, px: number | null) {
  const marks = root.querySelectorAll<HTMLElement>('font[size="7"], [style*="xxx-large"]');
  marks.forEach((el) => {
    let target = el;
    if (el.tagName === "FONT") {
      const span = document.createElement("span");
      while (el.firstChild) span.appendChild(el.firstChild);
      el.replaceWith(span);
      target = span;
    }
    target.style.fontSize = px ? `${px}px` : "";
    // 안쪽에 남은 다른 크기는 지운다 — 고른 크기가 덮어야 한다
    target.querySelectorAll<HTMLElement>("[style]").forEach((inner) => {
      if (inner.style.fontSize) inner.style.fontSize = "";
    });
    if (!target.getAttribute("style")) target.removeAttribute("style");
  });
}

// ---- 편집기 -----------------------------------------------------

const keyOf = (note: string | undefined, rich: NoteRich | undefined) => `${note ?? ""}\u0000${rich ? JSON.stringify(rich) : ""}`;

export function RichNoteEditor({
  note,
  rich,
  onChange,
  label = "메모",
  placeholder,
}: {
  note: string | undefined;
  rich: NoteRich | undefined;
  onChange: (note: string | undefined, rich: NoteRich | undefined) => void;
  label?: string;
  placeholder?: string;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const labelId = useId();
  const [empty, setEmpty] = useState(!note);
  const [, force] = useState(0);

  // 밖에서 들어온 값만 다시 그린다 — 내가 내보낸 값이면 그대로 둔다
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const key = keyOf(note, rich);
    if (shown.current === key) return;
    shown.current = key;
    const model = reconcileNoteRich(note, rich) ?? plainToRich(note ?? "");
    el.innerHTML = richToHtml(model);
    setEmpty(!note);
  }, [note, rich]);

  const emit = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    const model = readEditor(el);
    const text = richText(model);
    const nextNote = text.trim() ? text : undefined;
    const nextRich = nextNote && hasFormatting(model) ? model : undefined;
    shown.current = keyOf(nextNote, nextRich);
    setEmpty(!text.trim());
    onChange(nextNote, nextRich);
  }, [onChange]);

  // 굵게 등 눌린 상태를 커서를 따라 보여 준다
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (sel?.anchorNode && areaRef.current?.contains(sel.anchorNode)) force((n) => n + 1);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  /** 편집 칸에 커서가 없으면(도구를 먼저 누름) 끝에 둔다 */
  const ensureFocus = () => {
    const el = areaRef.current;
    if (!el) return;
    const sel = document.getSelection();
    if (sel && sel.rangeCount && el.contains(sel.anchorNode)) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  const run = (cmd: string, value?: string) => {
    ensureFocus();
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* 오래된 브라우저 */
    }
    document.execCommand(cmd, false, value);
    emit();
    force((n) => n + 1);
  };

  const setSize = (z: NoteSize | null) => {
    run("fontSize", "7");
    const el = areaRef.current;
    if (el) settleFontSize(el, z ? NOTE_SIZES[z].px : null);
    emit();
  };

  const baseFont = () => (areaRef.current ? getComputedStyle(areaRef.current).fontFamily : "inherit");
  const baseColor = () => (areaRef.current ? getComputedStyle(areaRef.current).color : "#1d1d1f");

  const state = (cmd: string) => {
    try {
      const sel = document.getSelection();
      if (!sel?.anchorNode || !areaRef.current?.contains(sel.anchorNode)) return false;
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="nd-field-label text-nd-caption font-medium text-nd-fg-2">
        {label}
      </span>
      <div className="overflow-hidden rounded-nd-md border border-nd-border bg-nd-content focus-within:border-nd-accent">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-nd-line bg-nd-sunken/60 px-1.5 py-1" role="toolbar" aria-label={`${label} 서식`}>
          <Drop label="글꼴" button={<span>글꼴</span>} wide>
            {(close) => (
              <div className="flex flex-col">
                {[{ key: null as NoteFont | null, label: "기본", css: "" }, ...(Object.keys(NOTE_FONTS) as NoteFont[]).map((k) => ({ key: k, label: NOTE_FONTS[k].label, css: NOTE_FONTS[k].css }))].map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      run("fontName", f.key ? NOTE_FONTS[f.key].css : baseFont());
                      close();
                    }}
                    className="rounded-[6px] px-2.5 py-1.5 text-left text-[14px] text-nd-fg hover:bg-nd-fg/[.07]"
                    style={f.css ? { fontFamily: f.css } : undefined}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </Drop>
          <Drop label="글자 크기" button={<span>크기</span>} wide>
            {(close) => (
              <div className="flex flex-col">
                {[{ key: null as NoteSize | null, label: "보통", px: 14 }, ...(Object.keys(NOTE_SIZES) as NoteSize[]).map((k) => ({ key: k, label: NOTE_SIZES[k].label, px: NOTE_SIZES[k].px }))].map((z) => (
                  <button
                    key={z.label}
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSize(z.key);
                      close();
                    }}
                    className="rounded-[6px] px-2.5 py-1 text-left text-nd-fg hover:bg-nd-fg/[.07]"
                    style={{ fontSize: z.px }}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
            )}
          </Drop>
          <Sep />
          <ToolButton icon={Bold} label="굵게 (⌘B)" onRun={() => run("bold")} active={state("bold")} />
          <ToolButton icon={Italic} label="기울임 (⌘I)" onRun={() => run("italic")} active={state("italic")} />
          <ToolButton icon={Underline} label="밑줄 (⌘U)" onRun={() => run("underline")} active={state("underline")} />
          <ToolButton icon={Strikethrough} label="취소선" onRun={() => run("strikeThrough")} active={state("strikeThrough")} />
          <Sep />
          <Drop
            label="글자색"
            button={
              <span className="flex flex-col items-center leading-none">
                <span className="text-[13px] font-semibold">가</span>
                <span className="mt-0.5 h-[3px] w-3.5 rounded-full" style={{ background: NOTE_COLORS.red.css }} />
              </span>
            }
          >
            {(close) => (
              <div className="flex items-center gap-1" aria-label="글자색">
                <Swatch label="기본 색" color="currentColor" text onPick={() => (run("foreColor", baseColor()), close())} />
                {(Object.keys(NOTE_COLORS) as (keyof typeof NOTE_COLORS)[]).map((k) => (
                  <Swatch key={k} label={`글자색 ${NOTE_COLORS[k].label}`} color={NOTE_COLORS[k].css} text onPick={() => (run("foreColor", NOTE_COLORS[k].css), close())} />
                ))}
              </div>
            )}
          </Drop>
          <Drop label="형광펜" button={<Icon icon={Highlighter} size={15} />}>
            {(close) => (
              <div className="flex items-center gap-1" aria-label="형광펜">
                <Swatch label="형광펜 없음" color={null} onPick={() => (run("hiliteColor", "transparent"), close())} />
                {(Object.keys(NOTE_HILITES) as (keyof typeof NOTE_HILITES)[]).map((k) => (
                  <Swatch key={k} label={`형광펜 ${NOTE_HILITES[k].label}`} color={NOTE_HILITES[k].css} onPick={() => (run("hiliteColor", NOTE_HILITES[k].css), close())} />
                ))}
              </div>
            )}
          </Drop>
          <Sep />
          <ToolButton icon={Eraser} label="서식 지우기" onRun={() => run("removeFormat")} />
          <ToolButton icon={Undo2} label="실행 취소 (⌘Z)" onRun={() => run("undo")} />
          <ToolButton icon={Redo2} label="다시 실행 (⌘⇧Z)" onRun={() => run("redo")} />
        </div>
        <div className="relative">
          {empty && placeholder && (
            <div aria-hidden className="pointer-events-none absolute left-3 top-2.5 text-[14px] text-nd-fg-3">
              {placeholder}
            </div>
          )}
          <div
            ref={areaRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline
            aria-labelledby={labelId}
            spellCheck={false}
            onInput={emit}
            onPaste={(e) => {
              // 글자만 붙인다 — 다른 곳의 서식 · 이미지는 버린다
              e.preventDefault();
              const t = e.clipboardData.getData("text/plain");
              if (t) document.execCommand("insertText", false, t.replace(/\r\n?/g, "\n"));
            }}
            onDrop={(e) => e.preventDefault()}
            className="nd-scroll max-h-[60vh] min-h-[5.5rem] overflow-y-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[14px] leading-relaxed text-nd-fg outline-none"
          />
        </div>
      </div>
    </div>
  );
}

function Swatch({ label, color, onPick, text }: { label: string; color: string | null; onPick: () => void; text?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-nd-line text-[13px] font-semibold hover:ring-2 hover:ring-nd-accent/40"
      style={color && !text ? { background: color } : color && text ? { color } : undefined}
    >
      {color === null ? <span className="text-nd-fg-3">✕</span> : text ? "가" : null}
    </button>
  );
}
