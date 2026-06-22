"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/components/neander/auth";
import { AppDataProvider, useAppData } from "@/components/neander/app-data";
import { ChatProvider } from "@/components/neander/chat";
import { Shell } from "@/components/neander/Shell";
import { Button } from "@/components/neander/ui";

const LOGIN_PATH = "/neander/login";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      {children}
    </div>
  );
}

/** 로그인은 됐지만 허용 목록에 없는 계정 */
function NotAuthorized() {
  const { user, logout } = useAuth();
  return (
    <FullScreen>
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-3 text-4xl">🔒</div>
        <h1 className="text-xl font-bold text-zinc-900">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-zinc-500">
          <span className="font-medium text-zinc-700">{user?.email}</span> 계정은 등록된
          팀원이 아닙니다. 관리자에게 이메일 등록을 요청하거나 다른 계정으로 로그인하세요.
        </p>
        <Button variant="secondary" className="mt-5" onClick={() => logout()}>
          로그아웃
        </Button>
      </div>
    </FullScreen>
  );
}

/** members 로드 후 권한 확인 → 통과 시 Shell */
function AuthorizedShell({ children }: { children: ReactNode }) {
  const { loading, authorized } = useAppData();
  if (loading) return <FullScreen><span className="text-zinc-400">불러오는 중…</span></FullScreen>;
  if (!authorized) return <NotAuthorized />;
  return (
    <ChatProvider>
      <Shell>{children}</Shell>
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
    return <FullScreen><span className="text-zinc-400">불러오는 중…</span></FullScreen>;
  }

  return (
    <AppDataProvider>
      <AuthorizedShell>{children}</AuthorizedShell>
    </AppDataProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
