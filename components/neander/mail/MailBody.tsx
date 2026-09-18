"use client";

// ============================================================
//  메일 본문 — 격리된 iframe 에 그린다
// ------------------------------------------------------------
//  받은 HTML 은 남이 쓴 문서다. ERP 화면에 그대로 끼우면 스크립트·폼·
//  스타일이 ERP 를 건드린다. 그래서
//
//    sandbox   allow-scripts 없음 → 메일 안 스크립트는 돌지 않는다
//              allow-same-origin  → 부모가 높이를 재려고 문서를 읽는다
//                                   (스크립트가 없으니 이 권한을 쓸 주체가 없다)
//              allow-popups…      → 링크는 새 탭으로
//    CSP       script·form·frame 을 한 번 더 막는다
//    <base target="_blank">       → 링크가 iframe 안에서 열리지 않게
//
//  글자·배경은 메일이 정한 대로 둔다 (다크 모드여도 메일은 흰 종이 위에).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

const CSP =
  "default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:; media-src *; form-action 'none'; frame-src 'none'; script-src 'none'";

const BASE_STYLE = `
  html,body{margin:0;padding:0;background:#fff;color:#1d1d1f}
  body{padding:16px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Malgun Gothic",sans-serif;word-break:break-word;overflow-wrap:anywhere}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  pre{white-space:pre-wrap}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid #d2d2d7;padding-left:1ex;color:#555}
`;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 평문 메일 — 주소는 누를 수 있게 */
const textToHtml = (s: string) =>
  `<div style="white-space:pre-wrap">${escapeHtml(s).replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u.replace(/"/g, "&quot;")}">${u}</a>`,
  )}</div>`;

export function MailBody({ html, text }: { html?: string; text?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);

  const content = html || textToHtml(text ?? "");
  const srcDoc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<base target="_blank"><style>${BASE_STYLE}</style></head><body>${content}</body></html>`;

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    setHeight(Math.max(120, doc.documentElement.scrollHeight, doc.body.scrollHeight));
  }, []);

  // 이미지가 늦게 도착하면 높이가 바뀐다 — 몇 번 더 잰다
  useEffect(() => {
    const timers = [300, 1000, 2500].map((ms) => setTimeout(measure, ms));
    return () => timers.forEach(clearTimeout);
  }, [srcDoc, measure]);

  return (
    <iframe
      ref={ref}
      title="메일 본문"
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={measure}
      className="block w-full rounded-nd-md border border-nd-line bg-white"
      style={{ height }}
    />
  );
}
