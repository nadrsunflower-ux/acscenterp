"use client";

// ============================================================
//  내 채널 — 채널 세트 요약 · 게시 계정 표 (메뉴 「내 채널」)
// ------------------------------------------------------------
//  「연결」(/accounts/connect) 과 같은 화면이다 — 목업(17-accounts)이 한 장으로 이어진
//  계정 관리 화면이라 나누지 않았다 (components/neander/shorts/accounts/AccountsScreen).
// ============================================================

import { Suspense } from "react";
import { AccountsScreen } from "@/components/neander/shorts/accounts/AccountsScreen";

export default function AccountsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 경계가 있어야 정적 빌드가 된다
  return (
    <Suspense>
      <AccountsScreen />
    </Suspense>
  );
}
