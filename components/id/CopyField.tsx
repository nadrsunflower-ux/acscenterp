"use client";

import { useState } from "react";

export interface CopyFieldProps {
  label: string;
  value: string;
  // 비밀번호 등 모노스페이스로 표시할지
  mono?: boolean;
}

// 라벨 + 값 + 복사 버튼. clipboard 미지원 환경에서도 깨지지 않도록 가드.
export default function CopyField({ label, value, mono = false }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // 폴백: 임시 textarea 로 복사
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 복사 실패 시 조용히 무시 (사용자가 직접 선택 가능)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div
          className={
            "mt-0.5 truncate text-sm text-gray-900 " +
            (mono ? "font-mono tracking-wide" : "font-medium")
          }
        >
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
        aria-label={`${label} 복사`}
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}
