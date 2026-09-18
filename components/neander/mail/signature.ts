"use client";

// ============================================================
//  본문 속 서명 칸 — 넣기 · 바꾸기 · 빼기
// ------------------------------------------------------------
//  서명은 본문 끝의 표시된 칸(<div data-nd-signature>) 하나에 들어간다. 쓰기 창에서
//  서명을 바꾸면 이 칸만 갈아 끼운다 — 쓰던 글은 건드리지 않는다. 답장·전달의
//  원문 인용은 서버가 본문 뒤에 붙이므로(send.ts) 서명은 인용문 위에 선다.
//
//  TEXT 모드에는 표시를 둘 곳이 없다. 마지막으로 넣은 서명 글자를 기억해 두고,
//  본문에 그대로 남아 있으면 그것을 바꾼다 (지웠거나 고쳤으면 끝에 새로 붙인다).
// ============================================================

import type { MailSignature } from "@/lib/neander/mail/types";
import { htmlToText } from "./RichEditor";

const ATTR = "data-nd-signature";

/** 편집기 HTML 의 서명 칸을 바꾼다 (sig 가 null 이면 뺀다) */
export function withSignatureHtml(html: string, sig: MailSignature | null): string {
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const old = doc.body.querySelector(`[${ATTR}]`);
  if (!sig) {
    old?.remove();
    return doc.body.innerHTML;
  }
  const block = doc.createElement("div");
  block.setAttribute(ATTR, sig.id);
  block.innerHTML = sig.html;
  if (old) old.replaceWith(block);
  else {
    // 새 메일이면 쓸 자리(빈 줄 둘)를 서명 위에 둔다
    if (!doc.body.textContent?.trim() && !doc.body.querySelector("img")) doc.body.innerHTML = "<br><br>";
    doc.body.appendChild(block);
  }
  return doc.body.innerHTML;
}

/** TEXT 모드 — 지난번에 넣은 서명 글자(prev)를 새 서명으로 바꾼다 */
export function withSignatureText(text: string, prev: string | null, sig: MailSignature | null): { text: string; sigText: string | null } {
  const next = sig ? htmlToText(sig.html) : null;
  let body = text;
  if (prev && body.includes(prev)) {
    const at = body.lastIndexOf(prev);
    body = (body.slice(0, at) + body.slice(at + prev.length)).replace(/\n+$/, "");
  }
  if (!next) return { text: body, sigText: null };
  return { text: `${body || "\n"}\n\n${next}`, sigText: next };
}
