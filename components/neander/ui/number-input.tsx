"use client";

// ============================================================
//  숫자 칸 — 치는 동안에도 천 단위 쉼표
// ------------------------------------------------------------
//  `type="number"` 칸은 쉼표를 못 찍어 「1200000」 이 그대로 보였다.
//  120만인지 1,200만인지 자릿수를 세어 봐야 하고, 계약금액처럼 큰 돈에서
//  0 하나 틀리면 그대로 저장된다. 그래서 금액·수량 칸은 모두 이 칸을 쓴다.
//
//  값은 부르는 쪽이 원래 들고 있던 모양(숫자든 글자든) 그대로 받는다.
//  돌려줄 때는 쉼표를 뺀 글자(「1200000」 · 「-3」 · 「1.5」)를 준다 —
//  숫자로 바꾸는 규칙(빈 칸을 0 으로 볼지 undefined 로 볼지)은 칸마다
//  달라서 부르는 쪽이 정한다.
//
//  글자는 칸이 따로 쥔다. 「-」 「1.」 처럼 치는 중인 모양은 숫자로 바꾸면
//  사라지는데, 그걸 부모 값에서 다시 그리면 친 글자가 지워진다. 부모 값이
//  지금 글자와 **다른 수**가 됐을 때만(되돌리기·초기화) 따라간다.
// ============================================================

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { caretAfterRegroup, caretPastComma, cleanNumberText, groupDigits } from "@/lib/neander/format";
import { Input, type InputProps } from "./field";
import { cn } from "./cn";

export type NumberInputProps = Omit<InputProps, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> & {
  value: number | string | null | undefined;
  /** 쉼표를 뺀 글자. 비우면 "" */
  onValueChange: (raw: string) => void;
  /** 음수를 칠 수 있나 (조정·차감 금액) */
  negative?: boolean;
  /** 소수점을 칠 수 있나 (수량·단가) */
  decimal?: boolean;
  /**
   * 공용 입력칸 모양을 입히지 않는다 — 제 스타일시트가 따로 있는 화면(장표
   * 가정값 칸)용. `className` 만 그대로 붙는다.
   */
  unstyled?: boolean;
};

/** 치는 중인 모양은 0 으로 본다 — 「-」 를 쳤다고 칸을 지우지 않으려고 */
const asNumber = (raw: string) => (/^-?\.?$/.test(raw) ? 0 : Number(raw));

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, negative, decimal, unstyled, className, onKeyDown, size, ...props },
  ref,
) {
  const opts = { negative, decimal };
  const fromValue = (v: NumberInputProps["value"]): string =>
    v === null || v === undefined ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : cleanNumberText(v, opts);

  const [raw, setRaw] = useState(() => fromValue(value));
  const inner = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  // 부모 값이 다른 수가 됐을 때만 따라간다 (위 머리말)
  useEffect(() => {
    const next = fromValue(value);
    setRaw((cur) => (cur === next || asNumber(cur) === asNumber(next) ? cur : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const shown = groupDigits(raw);

  // 쉼표가 늘거나 줄어도 커서가 친 자리에 남게
  useLayoutEffect(() => {
    const el = inner.current;
    if (el && caret.current !== null && document.activeElement === el) {
      el.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  }, [shown]);

  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inner.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const shared = {
    ...props,
    ref: setRefs,
    inputMode: decimal ? ("decimal" as const) : ("numeric" as const),
    value: shown,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      const to = caretPastComma(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, e.key);
      if (to !== null) el.setSelectionRange(to, to);
      onKeyDown?.(e);
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const typed = e.target.value;
      const next = cleanNumberText(typed, opts);
      caret.current = caretAfterRegroup(typed, e.target.selectionStart ?? typed.length, groupDigits(next));
      setRaw(next);
      onValueChange(next);
    },
  };
  return unstyled ? <input {...shared} className={className} /> : <Input {...shared} size={size} className={cn("nd-num", className)} />;
});
