"use client";

// ============================================================
//  2026-07-07 김주연 회의 준비 자료 — "7월, 폭풍 전야"
// ------------------------------------------------------------
//  /neander/meetings 의 「회의 준비 자료」 섹션에서 링크되는
//  웹 기반 16:9 발표자료 (총 14장).
//
//  구성:
//   1장 인트로   — 커버 · 오늘의 안건 · 세 줄 요약        (slides-intro)
//   2장 사업현황 — 사주 · 제이진옴므 · 스모트 개발 · 타임라인 (slides-status)
//   3장 실행전략 — 마케팅 4대 축 · 골든타임 · R&R · 로드맵   (slides-strategy)
//   4장 클로징   — 왜 7월인가 · 결정사항 5 · 액션 아이템      (slides-closing)
//
//  조작: ←/→/Space 이동 · F 전체화면 · Esc 회의록으로 복귀
// ============================================================
import { Deck } from "@/components/neander/deck/Deck";
import { SLIDES_INTRO } from "./slides-intro";
import { SLIDES_STATUS } from "./slides-status";
import { SLIDES_STRATEGY } from "./slides-strategy";
import { SLIDES_CLOSING } from "./slides-closing";

export default function KimJuyeonBriefing20260707() {
  return (
    <Deck
      meta={{
        title: "7월, 폭풍 전야 — 전사 전략 브리핑",
        dateLabel: "2026.07.07 화",
        presenter: "김주연",
        presenterEmoji: "🦊",
        accent: "#22d3ee",
        exitHref: "/neander/meetings",
      }}
      slides={[...SLIDES_INTRO, ...SLIDES_STATUS, ...SLIDES_STRATEGY, ...SLIDES_CLOSING]}
    />
  );
}
