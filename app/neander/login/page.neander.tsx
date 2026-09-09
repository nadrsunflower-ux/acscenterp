"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/neander/auth";
import { Button, InlineNotice } from "@/components/neander/ui";
import { StatusCard, StatusScreen } from "@/components/neander/shell/StatusScreen";

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 이미 로그인돼 있으면 홈으로
  useEffect(() => {
    if (!loading && user) router.replace("/neander");
  }, [user, loading, router]);

  async function handleLogin() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      router.replace("/neander");
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // 사용자가 팝업을 닫음 — 조용히 무시
      } else if (code === "auth/operation-not-allowed") {
        setError("Firebase 콘솔에서 Google 로그인이 아직 활성화되지 않았습니다.");
      } else {
        setError(`로그인 실패: ${code || (e as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <StatusScreen>
      <StatusCard title="로그인" description="등록된 팀원 Google 계정으로만 접근할 수 있습니다.">
        <Button className="mt-6 w-full" size="lg" onClick={handleLogin} loading={busy}>
          Google 계정으로 로그인
        </Button>
        {error && (
          <InlineNotice tone="danger" className="mt-4 text-left">
            {error}
          </InlineNotice>
        )}
      </StatusCard>
    </StatusScreen>
  );
}
