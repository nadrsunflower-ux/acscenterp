"use client";

// 자료를 받기 전 · 권한이 없을 때 · 받다 실패했을 때를 한 곳에서 (화면마다 되풀이하지 않게)
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState } from "@/components/neander/ui";
import { useShorts } from "./ShortsProvider";
import { ShortsScope } from "./ShortsScope";

export function ShortsGate({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh } = useShorts();
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
      <ShortsScope />
      {children}
    </>
  );
}
