"use client";

// ============================================================
//  상표 — 제품 로고(NEANDER ERP) · 회사 로고(AC'SCENT)
// ------------------------------------------------------------
//  두 상표는 자리가 다르다.
//    ProductWordmark — ERP 자신의 이름. 사이드바 왼쪽 위, 로그인 화면처럼
//                      "여기가 어떤 시스템인가" 를 말하는 자리.
//    Wordmark        — 회사(AC'SCENT) 이름. 매장 브랜드라 바깥으로 나가는
//                      것(문서·안내)에 쓴다. ERP 셸에는 쓰지 않는다.
//
//  ⚠️ 제품 로고 파일이 아직 저장소에 없다. `BRAND_LOGO` 에 경로를 채우면
//     그 순간부터 글자 대신 파일이 그려진다 — 부르는 쪽은 고칠 것이 없다.
//     파일이 없는 동안 다른 브랜드의 로고를 임시로 끼워 넣지 않는다.
//     (한 번 잘못 끼우면 어디에 무엇이 박혔는지 나중에 못 찾는다)
//
//     넣는 법: 파일을 `public/neander/brand/` 에 두고 아래 BRAND_LOGO 의
//     src 와 원본 픽셀 크기(w·h)를 적는다. 어두운 바탕용 벌이 따로 있으면
//     onDark 에 같이 적는다.
// ============================================================

import { cn } from "./cn";

/** 회사 로고 — acscent.co.kr 공식 파일 (manifest.json 의 localUrl 그대로) */
export const WORDMARK_SRC = {
  ink: "/neander/assets/acscent-official/images/e3664875-acscent-wordmark-ink.png",
  cream: "/neander/assets/acscent-official/images/59f1ab7e-acscent-wordmark-cream.png",
} as const;

const ACSCENT_RATIO = 2053 / 285;

/**
 * 제품(NEANDER ERP) 로고 파일. 아직 없다 — 채우면 ProductWordmark 가 파일로 바뀐다.
 * 예: { src: "/neander/brand/neander-wordmark.png", w: 1200, h: 220 }
 */
export const BRAND_LOGO: { src: string; w: number; h: number; onDark?: string } | null = null;

/**
 * 제품 상표. 로고 파일이 있으면 파일을, 없으면 글자를 그린다.
 * 가로세로비를 지키려고 **높이로만** 크기를 준다.
 */
export function ProductWordmark({
  height = 15,
  onDark = false,
  className,
}: {
  height?: number;
  /** 어두운 바탕 위인가 */
  onDark?: boolean;
  className?: string;
}) {
  if (BRAND_LOGO) {
    const src = onDark ? (BRAND_LOGO.onDark ?? BRAND_LOGO.src) : BRAND_LOGO.src;
    return (
      <span className={cn("inline-flex", className)}>
        <img
          src={src}
          alt="NEANDER ERP"
          width={Math.round((height * BRAND_LOGO.w) / BRAND_LOGO.h)}
          height={height}
          style={{ height, width: "auto" }}
          className="block"
        />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)} style={{ lineHeight: 1 }}>
      <span
        className={cn("font-bold tracking-tight", onDark ? "text-white" : "text-nd-fg")}
        style={{ fontSize: height }}
      >
        NEANDER
      </span>
      <span className={cn("text-nd-micro font-semibold tracking-wide", onDark ? "text-white/70" : "text-nd-fg-3")}>
        ERP
      </span>
    </span>
  );
}

/**
 * 좁은 자리(접힌 사이드바 64px)의 표시. 가로로 긴 워드마크는 40px 폭에서
 * 읽히지 않아 머리글자만 남긴다.
 */
export function BrandMark({ className, label = "NEANDER ERP" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[9px] bg-nd-inverse text-[13px] font-bold text-white",
        className,
      )}
      aria-label={label}
    >
      N
    </span>
  );
}

/**
 * 회사(AC'SCENT) 로고. 공식 파일 두 벌 중 바탕에 맞는 것을 쓴다 —
 * ink 는 밝은 바탕, cream 은 어두운 바탕. CSS 로 반전시키지 않는다
 * (세리프 획이 얇아 반전하면 뭉갠 것처럼 보인다).
 */
export function Wordmark({
  variant = "ink",
  height = 16,
  className,
}: {
  variant?: keyof typeof WORDMARK_SRC;
  height?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex", className)}>
      <img
        src={WORDMARK_SRC[variant]}
        alt="AC'SCENT"
        width={Math.round(height * ACSCENT_RATIO)}
        height={height}
        style={{ height, width: "auto" }}
        className="block"
      />
    </span>
  );
}
