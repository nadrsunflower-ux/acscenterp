"use client";

// 자료를 받기 전 · 권한이 없을 때 · 받다 실패했을 때를 한 곳에서 (화면마다 되풀이하지 않게)
import { Fragment, useEffect, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState } from "@/components/neander/ui";
import { useShorts } from "./ShortsProvider";
import { useShell } from "@/components/neander/shell/context";
import { ShortsScope, ShortsSpaceSwitch } from "./ShortsScope";
import { StudioContextBar, StudioMobileNav } from "./StudioChrome";

/**
 * 창 · 팝업도 13px 이상으로 — 창(Dialog)은 body 로 올라가 레이아웃의 data-nd-text 밖에 그려진다.
 * AI STUDIO 에 있는 동안만 body 에 켜고 떠나면 끈다 (다른 ERP 화면은 그대로).
 */
function useComfortableBody() {
  useEffect(() => {
    const b = document.body;
    const prev = b.dataset.ndText;
    b.dataset.ndText = "comfortable";
    return () => {
      if (prev === undefined) delete b.dataset.ndText;
      else b.dataset.ndText = prev;
    };
  }, []);
}

export function ShortsGate({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh, space } = useShorts();
  const { isMobile } = useShell();
  useComfortableBody();
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
      {/* 데스크톱은 툴바에, 모바일은 프로젝트 띠 안에 (StudioContextBar) */}
      {!isMobile && <ShortsSpaceSwitch />}
      {!isMobile && <ShortsScope />}
      <StudioContextBar />
      {/* 프로젝트를 바꾸면 화면을 새로 그린다 — 화면마다 받은 자료(레이더 · 바이럴 형식 · 시장 트렌드 · 대본)를 그 프로젝트 것으로 다시 받게 */}
      <Fragment key={space}>{children}</Fragment>
      <StudioMobileNav />
    </>
  );
}
