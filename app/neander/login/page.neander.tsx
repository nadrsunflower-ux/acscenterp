"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/neander/auth";
import { Button } from "@/components/neander/ui";

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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg font-bold tracking-tight text-zinc-900">NEANDER</div>
        <div className="text-xs font-medium text-indigo-500">ERP</div>

        <h1 className="mt-6 text-xl font-bold text-zinc-900">로그인</h1>
        <p className="mt-2 text-sm text-zinc-500">
          등록된 팀원 Google 계정으로만 접근할 수 있습니다.
        </p>

        <Button className="mt-6 w-full" onClick={handleLogin} disabled={busy}>
          {busy ? "로그인 중…" : "Google 계정으로 로그인"}
        </Button>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}
