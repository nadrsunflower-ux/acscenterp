"use client";

// ============================================================
//  앱 셸 — 사이드바(유리) + 상단바 + 본문
// ------------------------------------------------------------
//  본문은 셸이 좌우 여백을 준다. 페이지는 자기 컨테이너를 다시 만들지
//  않는다 (표·원장은 넓게, 문서는 읽기 폭 — 각 페이지가 안에서 정한다).
// ============================================================
import { useEffect, useState, type ReactNode } from "react";
import { Hand } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useAuth } from "@/components/neander/auth";
import { useChat } from "@/components/neander/chat";
import { seedDefaultMembers } from "@/lib/neander/db/members";
import { Button } from "@/components/neander/ui";
import { ShellProvider, useShell } from "./shell/context";
import { Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { StatusCard, StatusScreen } from "./shell/StatusScreen";

/** 전역 배지(요청·메신저)를 셸에 밀어 넣는다 */
function GlobalBadges() {
  const { requests, currentMember } = useAppData();
  const { totalUnread } = useChat();
  const { setBadge } = useShell();
  const myPendingReqs = currentMember
    ? requests.filter((r) => r.toId === currentMember.id && !r.acknowledged).length
    : 0;
  useEffect(() => setBadge("requests", myPendingReqs), [setBadge, myPendingReqs]);
  useEffect(() => setBadge("messenger", totalUnread), [setBadge, totalUnread]);
  return null;
}

function SetupScreen() {
  const { logout } = useAuth();
  const [seeding, setSeeding] = useState(false);
  return (
    <StatusScreen>
      <StatusCard
        icon={Hand}
        tone="accent"
        title="NEANDER ERP 시작하기"
        description="먼저 팀원을 등록해야 합니다. 기본 5명을 만든 뒤 팀원 메뉴에서 실제 이름과 Google 이메일을 입력하세요."
      >
        <Button
          className="mt-6 w-full"
          size="lg"
          loading={seeding}
          onClick={async () => {
            setSeeding(true);
            try {
              await seedDefaultMembers();
            } finally {
              setSeeding(false);
            }
          }}
        >
          기본 팀원 5명 생성
        </Button>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => logout()}>
          로그아웃
        </Button>
      </StatusCard>
    </StatusScreen>
  );
}

/** 상단바 + 본문 열. 도킹 패널이 있으면 그 폭만큼 오른쪽을 비운다 */
function ContentColumn({ children }: { children: ReactNode }) {
  const { dockWidth } = useShell();
  return (
    <div
      className="flex min-w-0 flex-1 flex-col transition-[padding] duration-nd ease-nd"
      style={dockWidth > 0 ? { paddingRight: dockWidth } : undefined}
    >
      <Topbar />
      <main data-nd-main className="w-full min-w-0 flex-1 px-4 pb-10 pt-3 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { members } = useAppData();

  // 팀원이 한 명도 없으면 셋업 화면
  if (members.length === 0) return <SetupScreen />;

  return (
    <ShellProvider>
      <GlobalBadges />
      <div className="nd-page-bg flex min-h-screen">
        <Sidebar />
        <ContentColumn>{children}</ContentColumn>
      </div>
    </ShellProvider>
  );
}
