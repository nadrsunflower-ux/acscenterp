"use client";

// ============================================================
//  종이 위의 칸 — 견적서 · 계약서 시트가 같이 쓴다
// ------------------------------------------------------------
//  시트는 나가는 종이 그 자체이고, 그 위에서 바로 고친다 (QuoteSheet ·
//  ContractSheet). 칸은 입력칸이지만 글꼴·정렬·색을 전부 종이에서 물려받아
//  타이핑하는 글자와 인쇄될 글자가 같은 글자다. 인쇄할 때는 칸을 그 값의
//  글자로 바꿔 친다 (quote-pdf.ts 의 sheetPrintHtml).
//
//  원래 QuoteSheet 안에 있던 것을 계약서 시트가 생기며 꺼냈다 — 두 벌로
//  두면 한쪽만 고쳐지는 날이 온다.
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/components/neander/ui";
import { caretAfterRegroup, caretPastComma, cleanNumberText, groupDigits } from "@/lib/neander/format";
import "./quote-sheet.css";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 종이 위의 글자처럼 보이는 입력칸. 글꼴·정렬·색은 칸에서 물려받는다 */
export function Cell({
  value,
  onChange,
  placeholder,
  label,
  className,
  auto,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  /** 문장 안에 박히는 칸 — 「제 26-001 호」 처럼 뒤에 글자가 붙는다. 내용만큼만 넓힌다 */
  auto?: boolean;
}) {
  return (
    <input
      className={cn("q-cell", auto && "q-auto", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      // field-sizing 이 없는 브라우저는 size 로 대강 맞춘다 (칸 자체가 안 보이는 게 더 나쁘다)
      size={auto ? Math.max((value || placeholder || "").length, 4) : undefined}
    />
  );
}

/**
 * 숫자 칸. 볼 때는 「12,000」, 커서가 들어가면 「12000」.
 * 인쇄본에는 보이는 그대로(쉼표 붙은 값)가 박히므로 평소 표기가 곧 결과다.
 */
export function NumCell({
  value,
  onChange,
  label,
  placeholder = "0",
  auto,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  placeholder?: string;
  /** 문장 안에 박히는 칸 — 「(₩ 12,000,000)」 처럼 앞뒤에 글자가 붙는다 */
  auto?: boolean;
}) {
  const [text, setText] = useState(() => (value ? won(value) : ""));
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  // 밖에서 값이 바뀌었을 때 (줄 복사 등) 따라간다 — 고치는 중에는 건드리지 않는다
  useEffect(() => {
    if (!editing) setText(value ? won(value) : "");
  }, [value, editing]);

  // 치는 동안 쉼표가 늘고 줄어도 커서는 친 자리에
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  return (
    <input
      ref={ref}
      className={cn("q-cell", auto && "q-auto")}
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      size={auto ? Math.max((text || placeholder).length, 4) : undefined}
      onFocus={() => {
        setEditing(true);
        setText(value ? groupDigits(String(value)) : "");
      }}
      onBlur={() => {
        setEditing(false);
        setText(value ? won(value) : "");
      }}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        const to = caretPastComma(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, e.key);
        if (to !== null) el.setSelectionRange(to, to);
      }}
      onChange={(e) => {
        // 고치는 동안에도 천 단위 쉼표 — 「80000」 을 세지 않고 읽게
        const typed = e.target.value;
        const next = groupDigits(cleanNumberText(typed, { negative: true, decimal: true }));
        caret.current = caretAfterRegroup(typed, e.target.selectionStart ?? typed.length, next);
        setText(next);
        const n = Number(next.replace(/,/g, ""));
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

/**
 * 여러 줄 글 칸 — 적은 만큼 늘어난다. 종이 위에 스크롤바가 생기면 안 된다.
 *
 * 높이는 글이 바뀔 때와 **칸의 너비가 바뀔 때** 다시 잰다. 창을 줄이면 줄이
 * 더 접혀 글이 길어지는데, 글만 보고 재면 아랫줄이 잘린 채로 남는다.
 */
export function AutoText({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    // 테두리 몫을 더한다 — 상자 크기에 테두리가 들어가는(border-box) 칸이라, 빼먹으면 마지막 줄 아래가 그만큼 잘린다
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      // 높이를 고치면 관찰이 다시 불린다 — 너비가 바뀐 때에만 잰다
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={cn("q-text", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
    />
  );
}
