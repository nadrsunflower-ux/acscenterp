"use client";

// ============================================================
//  종이 미리보기 — 인쇄본 그대로를 칸 폭에 맞춰 보인다
// ------------------------------------------------------------
//  프로젝트 「견적 · 계약 · 자료」 탭에서 최신 견적서 · 계약서를 열지 않고
//  바로 보게 한다. 그림은 인쇄 / PDF 와 같은 HTML 이다(printableQuoteHtml ·
//  printableContractHtml) — 미리보기만 따로 그리면 나가는 종이와 어긋난다.
//
//  iframe 에 그리는 이유: 인쇄본은 입력칸을 글자로 바꾼 정적 HTML 이라
//  편집 시트를 그대로 띄우면 줄 추가 단추 같은 편집 장치까지 보인다. 판형
//  CSS(QUOTE_CSS · CONTRACT_CSS)도 그 안에만 걸려 화면 글자에 새지 않는다.
//  스크립트는 막고(sandbox), 높이를 재려고 같은 출처만 허락한다.
//
//  종이 위를 누르면 편집창이 열린다 — 종이는 보기 전용이다.
// ============================================================

import { useLayoutEffect, useMemo, useRef, useState } from "react";

/** 칸이 종이보다 넓을 때 키우는 한도 — 너무 키우면 한 장이 화면 몇 개를 차지한다 */
const MAX_SCALE = 1.3;
/** A4 세로 비율 — 짧은 견적서도 한 장짜리 종이로 보이게 이 높이는 채운다 */
const A4 = 297 / 210;

export function PaperPreview({
  html,
  css,
  width,
  padding,
  label,
  onOpen,
}: {
  /** 인쇄본 본문. null 이면 아직 만드는 중 */
  html: string | null;
  /** 판형 CSS */
  css: string;
  /** 종이 폭(px) — 편집창의 종이와 같게 */
  width: number;
  /** 종이 여백(CSS padding 값) */
  padding: string;
  /** 무엇의 미리보기인지 — 화면 읽기 프로그램용 이름 */
  label: string;
  onOpen?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [docHeight, setDocHeight] = useState(0);

  const srcDoc = useMemo(
    () =>
      html === null
        ? null
        : `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { width: ${width}px; min-height: ${Math.round(width * A4)}px; padding: ${padding}; display: flow-root; }
${css}
</style></head><body>${html}</body></html>`,
    [html, css, width, padding],
  );

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setBoxWidth(el.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 종이 높이 — body 를 잰다(문서 전체를 재면 iframe 높이보다 작아지지 않는다) */
  const measure = () => {
    const body = frame.current?.contentDocument?.body;
    if (body) setDocHeight(Math.ceil(body.getBoundingClientRect().height));
  };

  const scale = boxWidth ? Math.min(MAX_SCALE, boxWidth / width) : 1;
  const shown = docHeight ? Math.ceil(docHeight * scale) : 0;

  return (
    <div ref={box} className="w-full min-w-0">
      <div
        className="relative mx-auto overflow-hidden rounded-nd-md border border-nd-line bg-white shadow-sm"
        style={{ width: Math.floor(width * scale), height: shown || Math.round(width * scale * A4) }}
      >
        {srcDoc && (
          <iframe
            ref={frame}
            title={label}
            srcDoc={srcDoc}
            sandbox="allow-same-origin"
            tabIndex={-1}
            aria-hidden
            onLoad={measure}
            className="block border-0"
            style={{
              width,
              height: docHeight || Math.round(width * A4),
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          />
        )}
        {(!srcDoc || !docHeight) && (
          <p className="absolute inset-x-0 top-10 text-center text-nd-caption text-nd-fg-3">종이를 그리는 중…</p>
        )}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${label} — 눌러서 엽니다`}
            title="눌러서 엽니다"
            className="absolute inset-0 cursor-pointer rounded-nd-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
          />
        )}
      </div>
    </div>
  );
}
