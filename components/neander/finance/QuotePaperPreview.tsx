"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/neander/ui";
import { QuoteSheet } from "./QuoteSheet";
import type { FinQuoteInput } from "@/lib/neander/finance/docs";

/** A4 판형은 유지하면서 작은 화면에서는 종이 전체를 볼 수 있게 축소한다. */
export function QuotePaperPreview({ value, onChange }: { value: FinQuoteInput; onChange: (next: FinQuoteInput) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  const [frame, setFrame] = useState({ scale: 1, height: 1000 });

  useLayoutEffect(() => {
    const container = viewport.current;
    const sheet = paper.current;
    if (!container || !sheet) return;
    const measure = () => {
      if (!container.clientWidth || !sheet.offsetWidth) return;
      const scale = fit ? Math.min(1, container.clientWidth / sheet.offsetWidth) : 1;
      const height = Math.ceil(sheet.offsetHeight * scale);
      setFrame((prev) => prev.scale === scale && prev.height === height ? prev : { scale, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [fit, value.design]);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" aria-pressed={!fit} onClick={() => setFit((prev) => !prev)}>
          {fit ? "원본 크기로 보기" : "화면에 맞추기"}
        </Button>
      </div>
      <div className="nd-scroll overflow-x-auto rounded-nd-lg border border-nd-line bg-nd-sunken p-3">
        <div ref={viewport} className="relative w-full" style={{ height: frame.height, overflow: fit ? "hidden" : undefined }} data-quote-preview-viewport>
          <div ref={paper} className="absolute left-0 top-0 bg-white shadow-sm" data-quote-preview-paper
            style={{ width: value.design ? 794 : 820, padding: value.design ? 0 : "28px 32px", transform: `scale(${frame.scale})`, transformOrigin: "top left" }}>
            <QuoteSheet value={value} onChange={onChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
