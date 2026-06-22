"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";

// AC'SCENT 매장 영역과 NEANDER 상위 ERP 영역의 "크롬(공통 골격)"을 분기한다.
//  - 매장 영역(기본): 상단 <Nav/> + 가운데 정렬된 <main> 래퍼 (기존 동작 유지)
//  - NEANDER 영역(/neander/*): 자체 사이드바 Shell 을 쓰므로 매장 Nav/래퍼를 숨기고
//    children 을 전체 화면(full-bleed)으로 그대로 렌더한다.
export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isNeander = pathname === "/neander" || pathname?.startsWith("/neander/");

  if (isNeander) {
    return <>{children}</>;
  }

  return (
    <>
      <Nav />
      <main className="mx-auto w-full px-2 py-4 sm:px-4">{children}</main>
    </>
  );
}
