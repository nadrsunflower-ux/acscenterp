"use client";

// ============================================================
//  메일 본문 편집기 — 에디터 · HTML · TEXT (카페24 웹메일과 같은 세 가지)
// ------------------------------------------------------------
//  contentEditable + document.execCommand 로 만든다. execCommand 는 표준에서
//  「더는 권하지 않음」이지만 모든 브라우저가 여전히 지원하고, 메일 본문에
//  필요한 서식(굵게·색·정렬·목록·링크)에는 이만큼이면 충분하다. 편집기
//  라이브러리(수백 KB)를 들이지 않는다.
//
//  본문 속 이미지는 data: URL 로 넣고, 보낼 때 nodemailer 가 cid 첨부로
//  바꾼다 (attachDataUrls — send.ts). 보내기 요청 한도(4.5MB) 때문에
//  이미지 한 장은 1.5MB 까지만 받는다.
//
//  ⚠️ 편집 영역은 **제어하지 않는다** (value 로 매번 innerHTML 을 쓰면 커서가
//     맨 앞으로 튄다). 바깥 값은 resetKey 가 바뀔 때만 들어온다.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Icon, cn, useConfirm, useToast, type LucideIcon } from "@/components/neander/ui";

export type EditorMode = "rich" | "html" | "text";

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

/**
 * 밖에서 들여오는 HTML(임시저장·서명·HTML 탭)을 편집 영역에 넣기 전에 거른다.
 * innerHTML 로 넣으면 <script> 는 돌지 않지만 onerror 같은 속성은 ERP 화면에서
 * 돈다 — 그런 것만 뗀다 (서식은 그대로).
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || !html) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,form,input,button,textarea,select,link,meta,base").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

const FONTS = [
  { label: "기본 글꼴", value: "" },
  { label: "맑은 고딕", value: "'Malgun Gothic', sans-serif" },
  { label: "나눔고딕", value: "'Nanum Gothic', sans-serif" },
  { label: "돋움", value: "Dotum, sans-serif" },
  { label: "굴림", value: "Gulim, sans-serif" },
  { label: "바탕", value: "Batang, serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier", value: "'Courier New', monospace" },
];

/** execCommand fontSize 는 1~7 단계다 */
const SIZES = [
  { label: "크기", value: "" },
  { label: "8pt", value: "1" },
  { label: "10pt", value: "2" },
  { label: "12pt", value: "3" },
  { label: "14pt", value: "4" },
  { label: "18pt", value: "5" },
  { label: "24pt", value: "6" },
  { label: "36pt", value: "7" },
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const textToEditorHtml = (s: string) => escapeHtml(s).replace(/\r?\n/g, "<br>");

/** HTML 의 글자만 — 보낼 때 평문 본문으로 쓴다 */
export function htmlToText(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]+>/g, "");
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr)>/gi, "$&\n"),
    "text/html",
  );
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function ToolButton({
  icon,
  label,
  onRun,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onRun: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // 누르는 순간 편집 영역의 선택이 풀리지 않게
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

const Sep = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-nd-line" />;

export function RichEditor({
  mode,
  onModeChange,
  html,
  text,
  onChange,
  resetKey,
  minHeight = 320,
  footer,
  maxImageBytes = MAX_IMAGE_BYTES,
}: {
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  html: string;
  text: string;
  onChange: (v: { html?: string; text: string }) => void;
  /** 바뀌면 바깥 값을 다시 들인다 (초안을 새로 열었을 때) */
  resetKey: number | string;
  minHeight?: number;
  /** 편집 영역 아래 (답장 인용 안내 등) */
  footer?: ReactNode;
  /** 본문 속 이미지 한 장 한도 (서명 편집기는 작게) */
  maxImageBytes?: number;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const hiliteRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [, force] = useState(0);

  // 바깥 값 들이기 — 처음 · 초안 교체 · 에디터로 돌아올 때
  useEffect(() => {
    if (mode === "rich" && areaRef.current) areaRef.current.innerHTML = sanitizeHtml(html);
    // html 은 일부러 빼 둔다: 입력할 때마다 innerHTML 을 다시 쓰면 커서가 튄다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, mode]);

  useEffect(() => {
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* 오래된 브라우저 */
    }
  }, []);

  const emit = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    onChange({ html: el.innerHTML, text: el.innerText });
  }, [onChange]);

  /** 드롭다운·색 고르기로 포커스가 나가면 선택이 풀린다 — 들어가기 전 선택을 기억해 둔다 */
  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && areaRef.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const run = (cmd: string, value?: string) => {
    restore();
    document.execCommand(cmd, false, value);
    remember();
    emit();
    force((n) => n + 1);
  };

  const state = (cmd: string) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };

  const insertLink = () => {
    remember();
    const url = window.prompt("연결할 주소 (https://…)", "https://");
    if (!url || url === "https://") return;
    run("createLink", /^[a-z]+:/i.test(url) ? url : `https://${url}`);
  };

  const insertImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > maxImageBytes) {
      const limit = maxImageBytes >= 1024 * 1024 ? `${(maxImageBytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(maxImageBytes / 1024)}KB`;
      toast.error(`이미지는 ${limit} 까지 넣을 수 있어요. 더 작게 줄여 넣거나 파일 첨부로 보내 주세요.`);
      return;
    }
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    run("insertHTML", `<img src="${url}" alt="${escapeHtml(file.name)}" style="max-width:100%">`);
  };

  const switchMode = async (next: EditorMode) => {
    if (next === mode) return;
    if (next === "text" && mode !== "text") {
      const ok = await confirm({
        title: "TEXT 로 바꿀까요?",
        message: "글꼴·색·이미지 같은 서식이 모두 사라지고 글자만 남습니다.",
        confirmLabel: "바꾸기",
      });
      if (!ok) return;
      const t = mode === "rich" ? areaRef.current?.innerText ?? text : htmlToText(html);
      onChange({ text: t });
    } else if (mode === "text") {
      const h = textToEditorHtml(text);
      onChange({ html: h, text });
    } else if (mode === "rich") {
      emit();
    }
    onModeChange(next);
  };

  const tabs: { key: EditorMode; label: string }[] = [
    { key: "rich", label: "에디터" },
    { key: "html", label: "HTML" },
    { key: "text", label: "TEXT" },
  ];

  return (
    <div className="overflow-hidden rounded-nd-md border border-nd-border bg-nd-content">
      <div className="flex items-center gap-0.5 border-b border-nd-line bg-nd-sunken/60 px-1.5 pt-1.5" role="tablist" aria-label="편집 방식">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={mode === t.key}
            onClick={() => void switchMode(t.key)}
            className={cn(
              "-mb-px rounded-t-[8px] border px-3 py-1.5 text-nd-caption font-medium transition-colors duration-nd-fast",
              mode === t.key
                ? "border-nd-line border-b-nd-content bg-nd-content text-nd-fg"
                : "border-transparent text-nd-fg-3 hover:text-nd-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "rich" && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-nd-line px-1.5 py-1">
          <select
            aria-label="글꼴"
            className="h-7 rounded-[6px] border border-nd-border bg-nd-content px-1.5 text-[12px] text-nd-fg-2"
            onMouseDown={remember}
            onChange={(e) => {
              if (e.target.value) run("fontName", e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
          >
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            aria-label="글자 크기"
            className="ml-1 h-7 rounded-[6px] border border-nd-border bg-nd-content px-1.5 text-[12px] text-nd-fg-2"
            onMouseDown={remember}
            onChange={(e) => {
              if (e.target.value) run("fontSize", e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
          >
            {SIZES.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <Sep />
          <ToolButton icon={Bold} label="굵게 (⌘B)" onRun={() => run("bold")} active={state("bold")} />
          <ToolButton icon={Italic} label="기울임 (⌘I)" onRun={() => run("italic")} active={state("italic")} />
          <ToolButton icon={Underline} label="밑줄 (⌘U)" onRun={() => run("underline")} active={state("underline")} />
          <ToolButton icon={Strikethrough} label="취소선" onRun={() => run("strikeThrough")} active={state("strikeThrough")} />
          <ToolButton icon={Type} label="글자색" onRun={() => (remember(), colorRef.current?.click())} />
          <ToolButton icon={Highlighter} label="배경색" onRun={() => (remember(), hiliteRef.current?.click())} />
          <input
            ref={colorRef}
            type="color"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => run("foreColor", e.target.value)}
          />
          <input
            ref={hiliteRef}
            type="color"
            defaultValue="#fff59d"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => run("hiliteColor", e.target.value)}
          />
          <Sep />
          <ToolButton icon={AlignLeft} label="왼쪽 정렬" onRun={() => run("justifyLeft")} />
          <ToolButton icon={AlignCenter} label="가운데 정렬" onRun={() => run("justifyCenter")} />
          <ToolButton icon={AlignRight} label="오른쪽 정렬" onRun={() => run("justifyRight")} />
          <ToolButton icon={AlignJustify} label="양쪽 정렬" onRun={() => run("justifyFull")} />
          <Sep />
          <ToolButton icon={ListOrdered} label="번호 목록" onRun={() => run("insertOrderedList")} />
          <ToolButton icon={List} label="글머리 목록" onRun={() => run("insertUnorderedList")} />
          <ToolButton icon={IndentDecrease} label="내어쓰기" onRun={() => run("outdent")} />
          <ToolButton icon={IndentIncrease} label="들여쓰기" onRun={() => run("indent")} />
          <Sep />
          <ToolButton icon={Link2} label="링크" onRun={insertLink} />
          <ToolButton icon={Link2Off} label="링크 해제" onRun={() => run("unlink")} />
          <ToolButton icon={ImagePlus} label="이미지 넣기" onRun={() => (remember(), imageRef.current?.click())} />
          <ToolButton icon={Minus} label="구분선" onRun={() => run("insertHorizontalRule")} />
          <ToolButton icon={Eraser} label="서식 지우기" onRun={() => run("removeFormat")} />
          <Sep />
          <ToolButton icon={Undo2} label="실행 취소" onRun={() => run("undo")} />
          <ToolButton icon={Redo2} label="다시 실행" onRun={() => run("redo")} />
          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void insertImage(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {mode === "rich" ? (
        <div
          ref={areaRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label="메일 본문"
          onInput={emit}
          onKeyUp={remember}
          onMouseUp={remember}
          onBlur={remember}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (file) {
              e.preventDefault();
              void insertImage(file);
            }
          }}
          className={cn(
            "nd-scroll max-h-[55vh] overflow-y-auto bg-white px-4 py-3 text-[14px] leading-relaxed text-[#1d1d1f] outline-none",
            "[&_a]:text-[#0b57d0] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#d2d2d7] [&_blockquote]:pl-3",
            "[&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_hr]:my-3",
          )}
          style={{ minHeight }}
        />
      ) : mode === "html" ? (
        <textarea
          aria-label="HTML 원문"
          spellCheck={false}
          value={html}
          onChange={(e) => onChange({ html: e.target.value, text: htmlToText(e.target.value) })}
          className="block w-full resize-y bg-white px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#1d1d1f] outline-none"
          style={{ minHeight }}
        />
      ) : (
        <textarea
          aria-label="메일 본문 (텍스트)"
          value={text}
          onChange={(e) => onChange({ text: e.target.value })}
          className="block w-full resize-y bg-white px-4 py-3 text-[14px] leading-relaxed text-[#1d1d1f] outline-none"
          style={{ minHeight }}
        />
      )}
      {footer && <div className="border-t border-nd-line bg-nd-sunken/60 px-3 py-2">{footer}</div>}
    </div>
  );
}
