"use client";

// ============================================================
//  재무 데이터 컨텍스트
// ------------------------------------------------------------
//  다른 NEANDER 모듈과 달리 Firestore 를 직접 구독하지 않고 서버 API 에서
//  받아온다 (이유는 lib/neander/finance/client.ts 주석 참고).
//
//  빨리 뜨게 하는 장치 셋 (2026-09-15):
//   ① 워크스페이스 밖에 산다 — ERP 공통 Providers 에 걸려 있어 매출·홈을 오가도
//      다시 받지 않는다. 실제로 받기 시작하는 건 재무 영역에 **처음 들어올 때**다
//      (FinanceActivate). 재무에 들어오지 않는 사람은 받지 않는다.
//   ② 브라우저 캐시 — 마지막으로 받은 것을 IndexedDB 에 두고, 들어오면 그걸 먼저
//      띄운 뒤 뒤에서 최신으로 맞춘다 (lib/neander/browser-cache.ts).
//   ③ 바뀐 것만 받기 — 캐시가 있으면 서버에 「그 뒤로 바뀐 거래」와 id 목록만
//      묻는다. 지운 거래는 id 목록에서 빠진 것으로 안다. 수정 시각을 남기지 않고
//      고치는 스크립트가 있어서 6시간마다 한 번은 전체를 받는다.
//
//  쓰기 뒤에는 서버가 돌려준 거래만 applyTransactions() 로 바꿔 끼운다.
//  refresh() 는 ③ 의 동기화다 — 전체를 다시 받는 게 아니다.
//  재무는 여러 명이 동시에 고치는 데이터가 아니라 이 정도로 충분하다.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchFinanceData,
  fetchFinanceTransactionsByIds,
  type FinanceSnapshot,
} from "@/lib/neander/finance/client";
import { mergeById } from "@/lib/neander/merge-by-id";
import { cacheDelete, cacheGet, cacheSet } from "@/lib/neander/browser-cache";
import type {
  FinAccountDoc,
  FinAllocationDoc,
  FinBudgetDoc,
  FinPaymentMethodDoc,
  FinSubscriptionDoc,
  FinLedgerColumnDoc,
  FinAnomalyIgnoreDoc,
  FinVendorRuleDoc,
} from "@/lib/neander/finance/db-types";
import type { FinTransaction, FinImportBatch } from "@/lib/neander/finance/types";
import type { MonthCloseDoc } from "@/lib/neander/finance/close";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import type { FinDoc } from "@/lib/neander/finance/docs";
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
  /** 원장에 사람이 덧붙인 열 */
  ledgerColumns: FinLedgerColumnDoc[];
  /** 형광펜 끄기 — 신뢰 거래처 · 이 달 확인한 계정 */
  anomalyIgnores: FinAnomalyIgnoreDoc[];
  /** 마감된 달 (문서 id = YYYY-MM) */
  closes: MonthCloseDoc[];
  /** 프로젝트 손익 (행사·납품 건별 체크리스트 + 계약금액) */
  projects: FinProjectDoc[];
  /** 프로젝트 문서 — 견적서·계약서 (projectId 로 프로젝트에 붙는다) */
  docs: FinDoc[];
  /** 확정 거래로 만든 거래처 색인 (자동분류·검토함에서 사용) */
  vendorIndex: Map<string, VendorStat>;
  loading: boolean;
  /** 캐시로 먼저 띄운 뒤 뒤에서 최신으로 맞추는 중 */
  syncing: boolean;
  /** 마스터가 아직 적재되지 않음 → 마스터 탭에서 seed 필요 */
  masterEmpty: boolean;
  /** 불러오기 실패 (권한 없음 등) */
  error: unknown;
  /** 최신으로 맞추기 — 그 뒤로 바뀐 것만 받는다 (6시간이 지났으면 전부) */
  refresh: () => Promise<void>;
  /**
   * 바뀐 거래만 바꿔 끼운다 — 서버가 돌려준 문서를 그대로 넣는다.
   * 다른 사람이 고친 것은 다음 refresh(화면에 다시 들어올 때)에 온다.
   */
  applyTransactions: (change: { upsert?: FinTransaction[]; remove?: string[] }) => void;
}

const Ctx = createContext<FinanceValue | null>(null);
const ActivateCtx = createContext<(() => void) | null>(null);

const EMPTY = {
  transactions: [] as FinTransaction[],
  accounts: [] as FinAccountDoc[],
  paymentMethods: [] as FinPaymentMethodDoc[],
  vendorRules: [] as FinVendorRuleDoc[],
  subscriptions: [] as FinSubscriptionDoc[],
  allocations: [] as FinAllocationDoc[],
  budgets: [] as FinBudgetDoc[],
  imports: [] as FinImportBatch[],
  ledgerColumns: [] as FinLedgerColumnDoc[],
  anomalyIgnores: [] as FinAnomalyIgnoreDoc[],
  closes: [] as MonthCloseDoc[],
  projects: [] as FinProjectDoc[],
  docs: [] as FinDoc[],
};
type FinanceData = typeof EMPTY;

/** 캐시 모양이 바뀌면 올린다 — 옛 캐시는 읽지 않고 전부 다시 받는다 */
const CACHE_VERSION = 1;
/** 수정 시각 없이 고친 문서를 놓치지 않게 이 간격마다 한 번은 전부 받는다 */
const FULL_EVERY_MS = 6 * 60 * 60 * 1000;
/** 서버·스크립트 시계가 조금 어긋나도 놓치지 않게 since 를 이만큼 앞당긴다 */
const OVERLAP_MS = 2 * 60 * 1000;
/** 캐시에 없는 거래를 한 번에 받을 수 */
const BY_IDS_CHUNK = 2000;

interface CacheMeta {
  /** 다음 동기화의 since */
  since: number;
  /** 마지막으로 전부 받은 시각 */
  fullAt: number;
}
interface CacheEntry {
  v: number;
  data: FinanceData;
  meta: CacheMeta;
}

const byDateDesc = (a: FinTransaction, b: FinTransaction) =>
  String(b.date ?? "").localeCompare(String(a.date ?? ""));

/** 동기화로 받은 문서를 넣되, 화면이 이미 더 새 값을 들고 있으면(방금 확정 등) 그대로 둔다 */
function mergeNewer(list: FinTransaction[], incoming: FinTransaction[]): FinTransaction[] {
  const cur = new Map(list.map((x) => [x.id, x]));
  return mergeById(
    list,
    incoming.filter((x) => (x.updatedAt ?? 0) >= (cur.get(x.id)?.updatedAt ?? 0)),
  );
}

const isDenied = (e: unknown) => {
  const status = Number((e as { status?: number } | null)?.status);
  return status === 401 || status === 403;
};

const pick = (snap: FinanceSnapshot, transactions: FinTransaction[]): FinanceData => ({
  transactions,
  accounts: snap.accounts ?? [],
  paymentMethods: snap.paymentMethods ?? [],
  vendorRules: snap.vendorRules ?? [],
  subscriptions: snap.subscriptions ?? [],
  allocations: snap.allocations ?? [],
  budgets: snap.budgets ?? [],
  imports: snap.imports ?? [],
  ledgerColumns: snap.ledgerColumns ?? [],
  anomalyIgnores: snap.anomalyIgnores ?? [],
  closes: snap.closes ?? [],
  projects: snap.projects ?? [],
  docs: snap.docs ?? [],
});

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [active, setActive] = useState(false);
  const [data, setData] = useState<FinanceData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** 비동기 동기화가 **지금** 값을 보고 합치게 — 기다리는 사이 확정한 거래를 잃지 않는다 */
  const dataRef = useRef<FinanceData>(EMPTY);
  const metaRef = useRef<CacheMeta | null>(null);
  const saveTimer = useRef<number | null>(null);
  const uid = user?.uid ?? null;
  const cacheKey = uid ? `finance:v${CACHE_VERSION}:${uid}` : null;

  const commit = useCallback((next: FinanceData) => {
    dataRef.current = next;
    setData(next);
  }, []);

  /** 캐시에 쓰기 — 연달아 바뀌면 마지막 것만 (1만 건을 매번 쓰지 않게) */
  const scheduleSave = useCallback(() => {
    if (!cacheKey) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const key = cacheKey;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const meta = metaRef.current;
      if (!meta) return;
      const entry: CacheEntry = { v: CACHE_VERSION, data: dataRef.current, meta };
      void cacheSet(key, entry);
    }, 800);
  }, [cacheKey]);

  const sync = useCallback(
    async (opts: { full?: boolean } = {}) => {
      if (!user) return;
      setSyncing(true);
      try {
        const meta = metaRef.current;
        const full = opts.full || !meta || Date.now() - meta.fullAt > FULL_EVERY_MS;
        if (full) {
          const snap = await fetchFinanceData();
          // 받는 사이 화면에서 확정한 거래가 더 새 값이면 그것을 남긴다
          const cur = new Map(dataRef.current.transactions.map((t) => [t.id, t]));
          const tx = (snap.transactions ?? []).map((t) => {
            const c = cur.get(t.id);
            return c && (c.updatedAt ?? 0) > (t.updatedAt ?? 0) ? c : t;
          });
          commit(pick(snap, tx));
          metaRef.current = { since: (snap.serverTime ?? Date.now()) - OVERLAP_MS, fullAt: Date.now() };
        } else {
          const snap = await fetchFinanceData(meta.since);
          const ids = snap.transactionIds ?? [];
          const keep = new Set(ids);
          let tx = mergeNewer(dataRef.current.transactions, snap.transactions ?? []).filter((t) =>
            keep.has(t.id),
          );
          // 캐시에 없던 거래(수정 시각 없이 새로 생긴 것 등)는 id 로 채운다
          const have = new Set(tx.map((t) => t.id));
          const missing = ids.filter((id) => !have.has(id));
          for (let i = 0; i < missing.length; i += BY_IDS_CHUNK) {
            tx = mergeById(tx, await fetchFinanceTransactionsByIds(missing.slice(i, i + BY_IDS_CHUNK)));
          }
          tx.sort(byDateDesc);
          commit(pick(snap, tx));
          metaRef.current = { since: (snap.serverTime ?? Date.now()) - OVERLAP_MS, fullAt: meta.fullAt };
        }
        setError(null);
        scheduleSave();
      } catch (e) {
        setError(e);
        // 권한이 없어졌으면 이 브라우저에 남긴 재무 데이터를 지운다
        if (cacheKey && isDenied(e)) {
          metaRef.current = null;
          commit(EMPTY);
          void cacheDelete(cacheKey);
        }
      } finally {
        setLoaded(true);
        setSyncing(false);
      }
    },
    [user, cacheKey, commit, scheduleSave],
  );

  const refresh = useCallback(() => sync(), [sync]);

  const applyTransactions = useCallback(
    (change: { upsert?: FinTransaction[]; remove?: string[] }) => {
      commit({
        ...dataRef.current,
        transactions: mergeById(dataRef.current.transactions, change.upsert, change.remove),
      });
      scheduleSave();
    },
    [commit, scheduleSave],
  );

  const activate = useCallback(() => setActive(true), []);

  // 계정이 바뀌면 앞 사람의 데이터를 들고 있으면 안 된다
  useEffect(() => {
    metaRef.current = null;
    commit(EMPTY);
    setLoaded(false);
    setError(null);
  }, [uid, commit]);

  // 재무 영역에 처음 들어온 뒤: 캐시로 먼저 띄우고 → 뒤에서 최신으로
  useEffect(() => {
    if (!active || authLoading) return;
    if (!user || !cacheKey) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const cached = await cacheGet<CacheEntry>(cacheKey);
      if (cancelled) return;
      if (cached && cached.v === CACHE_VERSION && cached.data && cached.meta) {
        // 캐시가 만들어진 뒤에 새로 생긴 칸(anomalyIgnores 등)은 빈 값으로 채운다 —
        // 없는 칸을 그대로 넘기면 화면이 undefined 를 읽다 멈춘다
        commit({ ...EMPTY, ...cached.data });
        metaRef.current = cached.meta;
        setLoaded(true);
      }
      await sync();
    })();
    return () => {
      cancelled = true;
    };
    // sync 는 user·cacheKey 로만 바뀐다 — 그때만 다시 시작한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, authLoading, user, cacheKey]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const vendorIndex = useMemo(
    () => buildVendorIndex(data.transactions),
    [data.transactions],
  );

  const value = useMemo<FinanceValue>(
    () => ({
      ...data,
      vendorIndex,
      loading: authLoading || !loaded,
      syncing,
      // 오류일 때는 "마스터가 비었다"고 하면 안 된다 — 원인이 다르다
      masterEmpty: !error && loaded && data.accounts.length === 0,
      error,
      refresh,
      applyTransactions,
    }),
    [data, vendorIndex, authLoading, loaded, syncing, error, refresh, applyTransactions],
  );

  return (
    <ActivateCtx.Provider value={activate}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ActivateCtx.Provider>
  );
}

/** 재무 영역 레이아웃에 둔다 — 여기에 처음 들어올 때 데이터를 받기 시작한다 */
export function FinanceActivate() {
  const activate = useContext(ActivateCtx);
  useEffect(() => {
    activate?.();
  }, [activate]);
  return null;
}

export function useFinance(): FinanceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance 는 FinanceProvider 안에서만 사용할 수 있습니다.");
  return v;
}
