"use client";

// ============================================================
//  글만큼 자라는 글 칸 — 칸을 접지 않고 높이를 잰다
// ------------------------------------------------------------
//  예전 방식은 높이를 재려고 칸을 잠깐 접었다(height: auto / 0px) 다시 폈다.
//  긴 회의록을 쓰는 중이면 그 한순간 문서 전체가 짧아져, 감싼 패널의 스크롤이
//  끌려 올라갔다가 펴진 뒤에도 돌아오지 않는다 — 글자를 칠 때마다 화면이
//  튀었다(2026-10-19 회의록에서 사용자 보고).
//
//  그래서 화면 밖에 보이지 않는 복제 칸을 하나 두고, 글꼴 · 여백 · 너비를 같게
//  맞춘 뒤 거기서 높이를 잰다. 진짜 칸은 한 번도 접히지 않는다.
// ============================================================

let shadow: HTMLTextAreaElement | null = null;

/** 줄바꿈 · 글자 폭에 영향을 주는 속성 — 복제 칸이 똑같이 줄을 바꾸게 */
const COPY = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "fontVariant",
  "letterSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "wordSpacing",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
] as const;

function shadowArea(): HTMLTextAreaElement {
  if (shadow && shadow.isConnected) return shadow;
  shadow = document.createElement("textarea");
  shadow.setAttribute("aria-hidden", "true");
  shadow.tabIndex = -1;
  shadow.rows = 1;
  const s = shadow.style;
  s.position = "absolute";
  s.top = "0";
  s.left = "-10000px";
  s.height = "0";
  s.minHeight = "0";
  s.maxHeight = "none";
  s.overflow = "hidden";
  s.visibility = "hidden";
  s.pointerEvents = "none";
  s.zIndex = "-1";
  document.body.appendChild(shadow);
  return shadow;
}

/**
 * 이 칸의 글이 다 들어가는 scrollHeight(안 여백 포함 · 테두리 제외) — 칸을 접어서
 * 쟀을 때와 같은 값을 칸을 건드리지 않고 낸다.
 */
export function textareaContentHeight(el: HTMLTextAreaElement): number {
  const sh = shadowArea();
  const cs = window.getComputedStyle(el);
  for (const k of COPY) sh.style[k] = cs[k];
  // 너비는 진짜 칸의 바깥 너비 그대로 (box-sizing 도 같으니 글이 같은 폭에서 접힌다)
  sh.style.width = `${el.getBoundingClientRect().width}px`;
  sh.value = el.value || el.placeholder || " ";
  return sh.scrollHeight;
}

/**
 * 글만큼 높이를 맞춘다.
 * @param min    가장 낮은 높이 (px)
 * @param extra  더할 몫 (px) — 마지막 줄 아래 숨 쉴 틈 등
 * @param border 테두리 두께를 더한다 — 상자 크기에 테두리가 들어가는(border-box) 칸에서
 *               빼먹으면 마지막 줄 아래가 그만큼 잘린다
 */
export function fitTextarea(el: HTMLTextAreaElement, opts: { min?: number; extra?: number; border?: boolean } = {}) {
  const { min = 0, extra = 0, border = false } = opts;
  let h = textareaContentHeight(el) + extra;
  if (border) {
    const cs = window.getComputedStyle(el);
    h += (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  }
  const px = `${Math.max(min, Math.ceil(h))}px`;
  if (el.style.height !== px) el.style.height = px;
}
