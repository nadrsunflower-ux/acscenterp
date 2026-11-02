"use client";

// 대본 작성기 — 제품 사진 · 정보 + 분석으로 소개 영상 대본을 쓰고 대화로 고친다 (components/neander/shorts/scripts)
import { Suspense } from "react";
import { LoadingState } from "@/components/neander/ui";
import { ScriptWriter } from "@/components/neander/shorts/scripts/ScriptWriter";

export default function ScriptsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 안에서 그린다 (빌드 때 정적 생성 경고)
  return (
    <Suspense fallback={<LoadingState label="대본 작성기를 여는 중" />}>
      <ScriptWriter />
    </Suspense>
  );
}
