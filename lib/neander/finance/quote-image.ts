"use client";

import { printableQuoteHtml } from "@/components/neander/finance/QuoteSheet";
import { QUOTE_DESIGN_CSS } from "@/components/neander/finance/quotation-designs/styles";
import { quoteFileStem, type FinQuoteInput } from "./docs";
import { QUOTE_CSS } from "./quote-pdf";
import { loadSealImage } from "./seal-image";
import { resolveSeal } from "./supplier";

/** 숨긴 미리보기 탭에서도 같은 출력본을 PNG 로 만든다. */
export async function exportQuotePng(q: FinQuoteInput): Promise<void> {
  const seal = resolveSeal(q.sealId);
  if (seal) await loadSealImage(seal.id);
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-12000px;top:0;width:${q.design ? 794 : 820}px;background:white;padding:${q.design ? 0 : 32}px;`;
  const css = document.createElement("style");
  css.textContent = QUOTE_CSS + QUOTE_DESIGN_CSS;
  host.append(css);
  const body = document.createElement("div");
  body.innerHTML = printableQuoteHtml(q);
  host.append(body);
  document.body.append(host);
  try {
    await Promise.all(Array.from(host.querySelectorAll("img")).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); }),
    ));
    await document.fonts?.ready;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(host, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const link = document.createElement("a");
    link.download = `${quoteFileStem(q)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } finally {
    host.remove();
  }
}
