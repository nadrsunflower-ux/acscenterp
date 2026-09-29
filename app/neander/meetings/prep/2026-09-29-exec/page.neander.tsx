"use client";

// ============================================================
//  0929 임원진회의 발표 장표 — 가정값을 바꿀 수 있는 웹 장표
// ------------------------------------------------------------
//  내용(문구·숫자·매물·학원)은 여기 없다. 저장소가 public 이라 Firestore 의
//  neander_decks/2026-09-29-exec 에 두고 로그인 API 로 받는다
//  (components/neander/deck/strategy/StrategyDeck.tsx).
//  내용 고치기: private/decks/2026-09-29-exec/content.ts → npm run deck:upload -- --apply
// ============================================================
import { StrategyDeck } from "@/components/neander/deck/strategy/StrategyDeck";

export default function ExecDeck20260929() {
  return <StrategyDeck slug="2026-09-29-exec" exitHref="/neander/meetings" />;
}
