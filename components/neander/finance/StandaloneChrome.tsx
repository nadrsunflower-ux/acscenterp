"use client";

import { useEffect } from "react";

/**
 * 홈 화면 앱으로 열렸을 때만 <html> 에 표시를 남긴다.
 *
 * 브라우저에서 볼 때는 사이드바·탭이 있어야 다른 화면으로 갈 수 있다.
 * 하지만 홈 화면 아이콘으로 연 사람은 **카드 기록만 하러 온 것**이라,
 * 그 두 줄이 입력칸을 아래로 밀어낼 뿐이다. globals.css 가 이 표시를 보고
 * 감춘다.
 *
 * CSS 미디어쿼리(display-mode: standalone)만으로는 안 된다 — 그건 이
 * 화면인지 다른 화면인지 구분하지 못해서, 앱으로 연 상태로 다른 메뉴에
 * 들어가면 길을 잃는다.
 */
export function StandaloneChrome() {
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS 는 표준 display-mode 대신 이 값을 쓴다
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (!standalone) return;
    const el = document.documentElement;
    el.dataset.pwaCard = "1";
    return () => {
      delete el.dataset.pwaCard;
    };
  }, []);
  return null;
}
