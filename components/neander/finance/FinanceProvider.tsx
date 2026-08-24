"use client";

// ============================================================
//  재무 데이터 컨텍스트
// ------------------------------------------------------------
//  다른 NEANDER 모듈과 달리 Firestore 를 직접 구독하지 않고 서버 API 에서
//  한 번에 받아온다 (이유는 lib/neander/finance/client.ts 주석 참고).
//
//  실시간 구독이 아니므로 쓰기 후에는 refresh() 를 불러야 화면이 맞는다.
//  재무는 여러 명이 동시에 고치는 데이터가 아니라 이 정도로 충분하다.
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
import { fetchFinanceData } from "@/lib/neander/finance/client";
import type {
  FinAccountDoc,
  FinAllocationDoc,
  FinBudgetDoc,
  FinPaymentMethodDoc,
  FinSubscriptionDoc,
  FinVendorRuleDoc,
} from "@/lib/neander/finance/db-types";
import type { FinTransaction, FinImportBatch } from "@/lib/neander/finance/types";
import type { MonthCloseDoc } from "@/lib/neander/finance/close";
import { buildVendorIndex, type VendorStat } from "@/lib/neander/finance/classify";
import { useAuth } from "@/components/neander/auth";

interface FinanceValue {
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  vendorRules: FinVendorRuleDoc[];
  subscriptions: FinSubscriptionDoc[];
  allocations: FinAllocationDoc[];
  budgets: FinBudgetDoc[];
  imports: FinImportBatch[];
  /** 마감된 달 (문서 id = YYYY-MM) */
  closes: MonthCloseDoc[];
  /** 확정 거래로 만든 거래처 색인 (자동분류·검토함에서 사용) */
  vendorIndex: Map<string, VendorStat>;
  loading: boolean;
  /** 마스터가 아직 적재되지 않음 → 마스터 탭에서 seed 필요 */
  masterEmpty: boolean;
  /** 불러오기 실패 (권한 없음 등) */
  error: unknown;
  /** 쓰기 후 다시 불러오기 */
  refresh: () => Promise<void>;
}

const Ctx = createContext<FinanceValue | null>(null);

const EMPTY = {
  transactions: [] as FinTransaction[],
  accounts: [] as FinAccountDoc[],
  paymentMethods: [] as FinPaymentMethodDoc[],
  vendorRules: [] as FinVendorRuleDoc[],
  subscriptions: [] as FinSubscriptionDoc[],
  allocations: [] as FinAllocationDoc[],
  budgets: [] as FinBudgetDoc[],
  imports: [] as FinImportBatch[],
  closes: [] as MonthCloseDoc[],
};

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    // 로그인 전에는 부를 수 없다 — ID 토큰이 있어야 서버가 신원을 확인한다
    if (!user) return;
    try {
      const snap = await fetchFinanceData();
      setData({
        transactions: snap.transactions ?? [],
        accounts: snap.accounts ?? [],
        paymentMethods: snap.paymentMethods ?? [],
        vendorRules: snap.vendorRules ?? [],
        subscriptions: snap.subscriptions ?? [],
        allocations: snap.allocations ?? [],
        budgets: snap.budgets ?? [],
        imports: snap.imports ?? [],
        closes: snap.closes ?? [],
      });
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  const vendorIndex = useMemo(
    () => buildVendorIndex(data.transactions),
    [data.transactions],
  );

  const value = useMemo<FinanceValue>(
    () => ({
      ...data,
      vendorIndex,
      loading: authLoading || !loaded,
      // 오류일 때는 "마스터가 비었다"고 하면 안 된다 — 원인이 다르다
      masterEmpty: !error && loaded && data.accounts.length === 0,
      error,
      refresh,
    }),
    [data, vendorIndex, authLoading, loaded, error, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFinance(): FinanceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance 는 FinanceProvider 안에서만 사용할 수 있습니다.");
  return v;
}
