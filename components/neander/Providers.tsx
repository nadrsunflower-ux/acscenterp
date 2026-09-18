"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/components/neander/auth";
import { AppDataProvider, useAppData } from "@/components/neander/app-data";
import { ChatProvider } from "@/components/neander/chat";
import { MailProvider } from "@/components/neander/mail/MailProvider";
import { FinanceProvider } from "@/components/neander/finance/FinanceProvider";
import { SalesProvider } from "@/components/neander/sales/SalesProvider";
import { Shell } from "@/components/neander/Shell";
import { Lock } from "lucide-react";
import { Button, ToastProvider, ConfirmProvider } from "@/components/neander/ui";
import { LoadingScreen, StatusCard, StatusScreen } from "@/components/neander/shell/StatusScreen";

const LOGIN_PATH = "/neander/login";

/** 로그인은 됐지만 허용 목록에 없는 계정 */
function NotAuthorized() {
  const { user, logout } = useAuth();
  return (
    <StatusScreen>
      <StatusCard
        icon={Lock}
        tone="warning"
        title="접근 권한이 없습니다"
        description={
          <>
            <span className="font-medium text-nd-fg">{user?.email}</span> 계정은 등록된 팀원이
            아닙니다. 관리자에게 이메일 등록을 요청하거나 다른 계정으로 로그인하세요.
          </>
        }
      >
        <Button variant="secondary" className="mt-6" onClick={() => logout()}>
          로그아웃
        </Button>
      </StatusCard>
    </StatusScreen>
  );
}

/** members 로드 후 권한 확인 → 통과 시 Shell */
function AuthorizedShell({ children }: { children: ReactNode }) {
  const { loading, authorized } = useAppData();
  if (loading) return <LoadingScreen label="팀원 정보를 불러오는 중…" />;
  if (!authorized) return <NotAuthorized />;
  return (
    <ChatProvider>
      {/* 재무·매출 데이터는 워크스페이스 밖에 둔다 — 홈·매출·재무를 오가도 다시
          받지 않는다. 받기 시작하는 건 그 영역에 처음 들어갈 때다
          (FinanceActivate · SalesActivate). */}
      <FinanceProvider>
        <SalesProvider>
          {/* 메일은 어느 화면에서든 20초마다 확인한다 (사이드바 배지·새 메일 알림) */}
          <MailProvider>
            <Shell>{children}</Shell>
          </MailProvider>
        </SalesProvider>
      </FinanceProvider>
    </ChatProvider>
  );
}

/** 인증 게이트: 미로그인 → /neander/login, 로그인 → 데이터 구독 + 권한 확인 */
function Gate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== LOGIN_PATH && !loading && !user) {
      router.replace(LOGIN_PATH);
    }
  }, [pathname, loading, user, router]);

  // 로그인 페이지는 게이트 없이 통과 (AuthProvider 안이라 useAuth 사용 가능)
  if (pathname === LOGIN_PATH) return <>{children}</>;

  if (loading || !user) {
    return <LoadingScreen label="로그인 확인 중…" />;
  }

  return (
    <AppDataProvider>
      <AuthorizedShell>{children}</AuthorizedShell>
    </AppDataProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <Gate>{children}</Gate>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
