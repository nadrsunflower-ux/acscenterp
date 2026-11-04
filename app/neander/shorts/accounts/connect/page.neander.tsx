"use client";

// ============================================================
//  연결 — 키 · 토큰 · 쿠팡 키 · 계정 준비 순서 · 서버 연결 상태 (메뉴 「연결」)
// ------------------------------------------------------------
//  「내 채널」(/accounts) 과 같은 화면을 그리고 연결 구간으로 바로 내려간다.
// ============================================================

import { Suspense } from "react";
import { AccountsScreen } from "@/components/neander/shorts/accounts/AccountsScreen";

export default function AccountsConnectPage() {
  return (
    <Suspense>
      <AccountsScreen focus="connect" />
    </Suspense>
  );
}
