"use client";

import { useState } from "react";
import { describeFirestoreError } from "@/lib/neander/finance/errors";
import { useFinance } from "./FinanceProvider";

/**
 * 재무 영역 상단 오류 배너.
 * 규칙 미게시처럼 "화면은 멀쩡한데 데이터만 안 오는" 상황을 드러낸다.
 */
export function ErrorBanner() {
  const { error } = useFinance();
  const [copied, setCopied] = useState(false);
  if (!error) return null;

  const { title, detail, command } = describeFirestoreError(error);

  return (
    <div className="border-b border-rose-200 bg-rose-50">
      <div className="mx-auto w-full max-w-7xl px-5 py-4">
        <div className="flex gap-3">
          <span className="text-lg leading-none">⚠️</span>
          <div className="min-w-0">
            <p className="font-semibold text-rose-900">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-rose-800">{detail}</p>
            {command && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded bg-white px-2 py-1 font-mono text-sm text-rose-900 ring-1 ring-rose-200">
                  {command}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(command);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  {copied ? "복사됨" : "복사"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
