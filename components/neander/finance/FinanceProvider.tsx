"use client";

// ============================================================
//  재무 데이터 컨텍스트
// ------------------------------------------------------------
//  거래·계정·계좌·규칙·임포트이력을 재무 영역에서 한 번만 구독해
//  하위 페이지들이 공유한다. 전역(app-data)에 넣지 않은 이유는
//  재무를 안 보는 사람이 거래 수천 건을 내려받을 이유가 없어서다.
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  subscribeFinTransactions,
  subscribeFinAccounts,
  subscribeFinPaymentMethods,
  subscribeFinVendorRules,
  subscribeFinImports,
  type FinAccountDoc,
  type FinPaymentMethodDoc,
  type FinVendorRuleDoc,
} from "@/lib/neander/finance/db";
import type { FinTransaction, FinImportBatch } from "@/lib/neander/finance/types";
import { buildVendorIndex, type VendorStat } from "@/lib/neander/finance/classify";

interface FinanceValue {
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  vendorRules: FinVendorRuleDoc[];
  imports: FinImportBatch[];
  /** 확정 거래로 만든 거래처 색인 (자동분류·검토함에서 사용) */
  vendorIndex: Map<string, VendorStat>;
  loading: boolean;
  /** 마스터가 아직 적재되지 않음 → 마스터 관리에서 seed 필요 */
  masterEmpty: boolean;
  /**
   * 구독이 실패했다. 대부분 보안 규칙 미게시다.
   * 이걸 노출하지 않으면 화면이 "데이터 없음"처럼 보여서 원인을 못 찾는다.
   */
  error: unknown;
}

const Ctx = createContext<FinanceValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<FinTransaction[]>([]);
  const [accounts, setAccounts] = useState<FinAccountDoc[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<FinPaymentMethodDoc[]>([]);
  const [vendorRules, setVendorRules] = useState<FinVendorRuleDoc[]>([]);
  const [imports, setImports] = useState<FinImportBatch[]>([]);
  const [txLoaded, setTxLoaded] = useState(false);
  const [acctLoaded, setAcctLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    // 첫 오류만 붙잡는다. 규칙이 없으면 5개 구독이 동시에 실패하는데
    // 원인은 하나라 같은 메시지를 다섯 번 보여줄 이유가 없다.
    const fail = (e: unknown) => {
      setError((prev: unknown) => prev ?? e);
      // 로딩 상태에 갇히지 않게 — 오류도 "다 불러온" 것이다
      setTxLoaded(true);
      setAcctLoaded(true);
    };
    const unsubs = [
      subscribeFinTransactions((r) => {
        setTransactions(r);
        setTxLoaded(true);
      }, fail),
      subscribeFinAccounts((r) => {
        setAccounts(r);
        setAcctLoaded(true);
      }, fail),
      subscribeFinPaymentMethods(setPaymentMethods, fail),
      subscribeFinVendorRules(setVendorRules, fail),
      subscribeFinImports(setImports, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const vendorIndex = useMemo(() => buildVendorIndex(transactions), [transactions]);

  const value = useMemo<FinanceValue>(
    () => ({
      transactions,
      accounts,
      paymentMethods,
      vendorRules,
      imports,
      vendorIndex,
      loading: !txLoaded || !acctLoaded,
      // 오류일 때는 "마스터가 비었다"고 하면 안 된다 — 원인이 다르다
      masterEmpty: !error && acctLoaded && accounts.length === 0,
      error,
    }),
    [transactions, accounts, paymentMethods, vendorRules, imports, vendorIndex, txLoaded, acctLoaded, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFinance(): FinanceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance 는 FinanceProvider 안에서만 사용할 수 있습니다.");
  return v;
}
