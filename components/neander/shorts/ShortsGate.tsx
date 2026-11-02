"use client";

// 자료를 받기 전 · 권한이 없을 때 · 받다 실패했을 때를 한 곳에서 (화면마다 되풀이하지 않게)
import { Fragment, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState } from "@/components/neander/ui";
import { useShorts } from "./ShortsProvider";
import { ShortsScope, ShortsSpaceSwitch } from "./ShortsScope";

export function ShortsGate({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh, space } = useShorts();
  if (loading && !data) return <LoadingState label="AI STUDIO 자료를 불러오는 중…" />;
  if (!data && error && /권한/.test(error)) {
    return <EmptyState icon={Lock} title="AI STUDIO 사용 권한이 없습니다" description={error} />;
  }
  if (!data) {
    return (
      <ErrorState
        title="AI STUDIO 자료를 불러오지 못했습니다"
        description={error ?? "잠시 뒤 다시 시도해 주세요."}
        action={<Button variant="secondary" onClick={() => void refresh()}>다시 불러오기</Button>}
      />
    );
  }
  return (
    <>
      <ShortsSpaceSwitch />
      <ShortsScope />
      {/* 프로젝트를 바꾸면 화면을 새로 그린다 — 화면마다 받은 자료(레이더 · 바이럴 형식 · 시장 트렌드 · 대본)를 그 프로젝트 것으로 다시 받게 */}
      <Fragment key={space}>{children}</Fragment>
    </>
  );
}
