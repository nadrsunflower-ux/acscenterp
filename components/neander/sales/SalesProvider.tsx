"use client";

// ============================================================
//  매출 데이터 컨텍스트
// ------------------------------------------------------------
//  재무(FinanceProvider)와 같은 구조다 — 빨리 뜨게 하는 장치 셋도 같다:
//   ① 워크스페이스 밖(ERP 공통 Providers)에 살고, 매출 영역에 처음 들어올 때
//      받기 시작한다 (SalesActivate).
//   ② 마지막으로 받은 것을 IndexedDB 에서 먼저 띄우고 뒤에서 최신으로 맞춘다.
//   ③ 판매 줄은 그 뒤로 바뀐 것과 id 목록만 받는다. 6시간마다 한 번은 전부.
//      상품·이벤트·기본가정·인건비 집계는 작아서 늘 전부 받는다.
//
//  쓰기 뒤에는 서버가 돌려준 문서만 applyLines() 로 바꿔 끼운다.
//
//  기본가정이 없으면 아무 계산도 못 하므로, 적재 전에는 코드의 기본값을
//  대신 쓴다 — 화면이 "마스터를 적재하세요" 를 띄우면서도 숫자 구조는
//  보여줄 수 있어야 한다.
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
  fetchSalesData,
  fetchSalesLinesByIds,
  type SalesSnapshot,
} from "@/lib/neander/sales/client";
import { mergeById } from "@/lib/neander/merge-by-id";
import { cacheDelete, cacheGet, cacheSet } from "@/lib/neander/browser-cache";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import type {
  SalesAssumptions,
  SalesEvent,
  SalesImportBatch,
  SalesLine,
  SalesProduct,
} from "@/lib/neander/sales/types";
import type { LaborActuals } from "@/lib/neander/sales/labor";
import { useAuth } from "@/components/neander/auth";

interface SalesValue {
  /**
   * 근무 일지 실측 인건비 (월 × 매장 집계). null 이면 못 읽은 것 — 인건비는
   * 전부 가정값이 된다. 집계 함수에 `{ actuals: labor }` 로 넘긴다.
   */
  labor: LaborActuals | null;
  lines: SalesLine[];
  products: SalesProduct[];
  events: SalesEvent[];
  imports: SalesImportBatch[];
  /** 적재 전에는 코드 기본값 */
  assumptions: SalesAssumptions;
  /** 기본가정이 Firestore 에 아직 없다 */
  assumptionsSeeded: boolean;
  loading: boolean;
  /** 캐시로 먼저 띄운 뒤 뒤에서 최신으로 맞추는 중 */
  syncing: boolean;
  /** 마스터가 비었다 → 마스터 화면에서 적재 필요 */
  masterEmpty: boolean;
  error: unknown;
  /** 최신으로 맞추기 — 그 뒤로 바뀐 것만 받는다 (6시간이 지났으면 전부) */
  refresh: () => Promise<void>;
  /**
   * 바뀐 줄만 바꿔 끼운다 — 서버가 돌려준 문서를 그대로 넣는다.
   * 다른 사람이 고친 것은 다음 refresh(화면에 다시 들어올 때)에 온다.
   */
  applyLines: (change: { upsert?: SalesLine[]; remove?: string[] }) => void;
  /** 바뀐 상품만 바꿔 끼운다 (대기함에서 새 상품을 만든 뒤) */
  applyProducts: (change: { upsert?: SalesProduct[] }) => void;
}

const Ctx = createContext<SalesValue | null>(null);
const ActivateCtx = createContext<(() => void) | null>(null);

const EMPTY = {
  lines: [] as SalesLine[],
  products: [] as SalesProduct[],
  events: [] as SalesEvent[],
  imports: [] as SalesImportBatch[],
  assumptions: null as SalesAssumptions | null,
  labor: null as LaborActuals | null,
};
type SalesData = typeof EMPTY;

/** 캐시 모양이 바뀌면 올린다 */
const CACHE_VERSION = 1;
/** 수정 시각 없이 고친 문서를 놓치지 않게 이 간격마다 한 번은 전부 받는다 */
const FULL_EVERY_MS = 6 * 60 * 60 * 1000;
/** 시계가 조금 어긋나도 놓치지 않게 since 를 이만큼 앞당긴다 */
const OVERLAP_MS = 2 * 60 * 1000;
const BY_IDS_CHUNK = 2000;

interface CacheMeta {
  since: number;
  fullAt: number;
}
interface CacheEntry {
  v: number;
  data: SalesData;
  meta: CacheMeta;
}

const byDateDesc = (a: SalesLine, b: SalesLine) =>
  String(b.date ?? "").localeCompare(String(a.date ?? ""));

/** 동기화로 받은 줄을 넣되, 화면이 이미 더 새 값을 들고 있으면 그대로 둔다 */
function mergeNewer(list: SalesLine[], incoming: SalesLine[]): SalesLine[] {
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

const pick = (snap: SalesSnapshot, lines: SalesLine[]): SalesData => ({
  lines,
  products: snap.products ?? [],
  events: snap.events ?? [],
  imports: snap.imports ?? [],
  assumptions: snap.assumptions ?? null,
  labor: snap.labor ?? null,
});

export function SalesProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [active, setActive] = useState(false);
  const [data, setData] = useState<SalesData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dataRef = useRef<SalesData>(EMPTY);
  const metaRef = useRef<CacheMeta | null>(null);
  const saveTimer = useRef<number | null>(null);
  const uid = user?.uid ?? null;
  const cacheKey = uid ? `sales:v${CACHE_VERSION}:${uid}` : null;

  const commit = useCallback((next: SalesData) => {
    dataRef.current = next;
    setData(next);
  }, []);

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
          const snap = await fetchSalesData();
          const cur = new Map(dataRef.current.lines.map((l) => [l.id, l]));
          const lines = (snap.lines ?? []).map((l) => {
            const c = cur.get(l.id);
            return c && (c.updatedAt ?? 0) > (l.updatedAt ?? 0) ? c : l;
          });
          commit(pick(snap, lines));
          metaRef.current = { since: (snap.serverTime ?? Date.now()) - OVERLAP_MS, fullAt: Date.now() };
        } else {
          const snap = await fetchSalesData(meta.since);
          const ids = snap.lineIds ?? [];
          const keep = new Set(ids);
          let lines = mergeNewer(dataRef.current.lines, snap.lines ?? []).filter((l) => keep.has(l.id));
          const have = new Set(lines.map((l) => l.id));
          const missing = ids.filter((id) => !have.has(id));
          for (let i = 0; i < missing.length; i += BY_IDS_CHUNK) {
            lines = mergeById(lines, await fetchSalesLinesByIds(missing.slice(i, i + BY_IDS_CHUNK)));
          }
          lines.sort(byDateDesc);
          commit(pick(snap, lines));
          metaRef.current = { since: (snap.serverTime ?? Date.now()) - OVERLAP_MS, fullAt: meta.fullAt };
        }
        setError(null);
        scheduleSave();
      } catch (e) {
        setError(e);
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

  const applyLines = useCallback(
    (change: { upsert?: SalesLine[]; remove?: string[] }) => {
      commit({ ...dataRef.current, lines: mergeById(dataRef.current.lines, change.upsert, change.remove) });
      scheduleSave();
    },
    [commit, scheduleSave],
  );
  const applyProducts = useCallback(
    (change: { upsert?: SalesProduct[] }) => {
      commit({ ...dataRef.current, products: mergeById(dataRef.current.products, change.upsert) });
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

  // 매출 영역에 처음 들어온 뒤: 캐시로 먼저 띄우고 → 뒤에서 최신으로
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
        commit(cached.data);
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

  const value = useMemo<SalesValue>(
    () => ({
      lines: data.lines,
      products: data.products,
      events: data.events,
      imports: data.imports,
      assumptions: data.assumptions ?? SEED_ASSUMPTIONS,
      assumptionsSeeded: !!data.assumptions,
      labor: data.labor,
      loading: authLoading || !loaded,
      syncing,
      // 오류일 때는 "마스터가 비었다"고 하면 안 된다 — 원인이 다르다
      masterEmpty: !error && loaded && data.products.length === 0,
      error,
      refresh,
      applyLines,
      applyProducts,
    }),
    [data, authLoading, loaded, syncing, error, refresh, applyLines, applyProducts],
  );

  return (
    <ActivateCtx.Provider value={activate}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ActivateCtx.Provider>
  );
}

/** 매출 영역 레이아웃에 둔다 — 여기에 처음 들어올 때 데이터를 받기 시작한다 */
export function SalesActivate() {
  const activate = useContext(ActivateCtx);
  useEffect(() => {
    activate?.();
  }, [activate]);
  return null;
}

export function useSales(): SalesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSales 는 SalesProvider 안에서만 사용할 수 있습니다.");
  return v;
}
