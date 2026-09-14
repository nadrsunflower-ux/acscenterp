"use client";

// ============================================================
//  인증 컨텍스트 (Google 로그인) — NEANDER ERP
// ------------------------------------------------------------
//  AC'SCENT와 동일한 Firebase 프로젝트의 Auth 를 사용한다.
//  auth 인스턴스는 import 시점이 아니라 호출 시점(useEffect/handler)에
//  getNeanderAuth() 로 얻는다 (빌드/프리렌더 안전).
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getNeanderAuth } from "@/lib/neander/firebase";
import { cacheClearAll } from "@/lib/neander/browser-cache";

interface AuthValue {
  user: User | null;
  /** 최초 인증 상태 확인 중 */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(getNeanderAuth(), (u) => {
      // 로그아웃·세션 만료 — 이 브라우저에 남긴 매출·재무 캐시를 지운다
      if (!u) void cacheClearAll();
      setUser(u);
      setLoading(false);
    });
  }, []);

  async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(getNeanderAuth(), provider);
  }

  async function logout() {
    // 로그아웃 전에 지운다 — 공용 PC 에 회사 재무·매출 데이터를 남기지 않는다
    await cacheClearAll();
    await signOut(getNeanderAuth());
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
