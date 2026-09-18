"use client";

// ============================================================
//  SMOAT · 동기화 데이터 컨텍스트
// ------------------------------------------------------------
//  두 화면(SMOAT 매출 · 자동 동기화)이 같은 것을 읽는다. 각자 받으면
//  들어갈 때마다 두 번 부르고, 한쪽에서 「지금 동기화」를 누른 뒤 다른
//  화면이 옛 숫자를 보여준다.
//
//  SalesProvider 와 달리 증분 동기화도 IndexedDB 캐시도 두지 않는다 —
//  SMOAT 결제는 월 수십 건이라 통째로 받아도 작다. 구조를 늘리는 값이
//  아직 없다 (lib/neander/smoat/client.ts 주석).
//
//  받기 시작하는 시점은 SalesProvider 와 같은 규칙이다 — 매출 워크스페이스에
//  들어가기만 해도 부르면 안 되고, **이 데이터를 쓰는 화면**에 들어올 때
//  부른다 (useSmoatActivate). 매장 대시보드만 보고 나가는 사람이 SMOAT 을 받을
//  이유는 없다.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchSyncSnapshot, type SyncSnapshot, type SyncStateView } from "@/lib/neander/smoat/client";
import type { SmoatMonthlyCost, SmoatSale } from "@/lib/neander/smoat/types";
import type { SyncIssue } from "@/lib/neander/sync/types";
import { useAuth } from "@/components/neander/auth";

interface SmoatValue {
  sales: SmoatSale[];
  costs: SmoatMonthlyCost[];
  states: SyncStateView[];
  issues: SyncIssue[];
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SmoatValue | null>(null);
const ActivateCtx = createContext<(() => void) | null>(null);

const EMPTY: Pick<SmoatValue, "sales" | "costs" | "states" | "issues"> = {
  sales: [],
  costs: [],
  states: [],
  issues: [],
};

export function SmoatProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [active, setActive] = useState(false);
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const snap: SyncSnapshot = await fetchSyncSnapshot();
      setData({
        sales: snap.smoat.sales ?? [],
        costs: snap.smoat.costs ?? [],
        states: snap.states ?? [],
        issues: snap.issues ?? [],
      });
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, [user]);

  const activate = useCallback(() => setActive(true), []);

  // 계정이 바뀌면 앞 사람의 데이터를 들고 있으면 안 된다
  useEffect(() => {
    setData(EMPTY);
    setLoaded(false);
    setError(null);
  }, [user?.uid]);

  useEffect(() => {
    if (!active || authLoading) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    void load();
  }, [active, authLoading, user, load]);

  const value = useMemo<SmoatValue>(
    () => ({
      ...data,
      loading: authLoading || !loaded,
      refreshing,
      error,
      refresh: load,
    }),
    [data, authLoading, loaded, refreshing, error, load],
  );

  return (
    <ActivateCtx.Provider value={activate}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ActivateCtx.Provider>
  );
}

/**
 * SMOAT·동기화 데이터를 쓰는 화면에서 **맨 위에** 부른다 — 여기에 들어올 때
 * 받기 시작한다.
 *
 * ⚠️ 부품(<SmoatActivate />)이 아니라 훅인 이유: 화면은 로딩·오류·빈 상태에서
 *    일찍 반환한다. 부품을 본문 JSX 에 두면 **로딩 중에는 그려지지 않아**
 *    받기 시작하지 못하고, 그래서 영영 로딩에 머문다 (실제로 그랬다).
 *    훅은 이른 반환보다 먼저 돌아 그 고리를 끊는다.
 *
 *    판매 줄 쪽(SalesActivate)은 레이아웃에 있어 늘 그려지므로 같은 문제가
 *    없다 — 부품으로 둘 거라면 레이아웃에 둬야 한다.
 */
export function useSmoatActivate(): void {
  const activate = useContext(ActivateCtx);
  useEffect(() => {
    activate?.();
  }, [activate]);
}

export function useSmoat(): SmoatValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSmoat 은 SmoatProvider 안에서만 사용할 수 있습니다.");
  return v;
}
