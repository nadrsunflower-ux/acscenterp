"use client";

// ============================================================
//  형광펜 — 이번 달에 튄 지출 표시 (판정은 lib/neander/finance/anomaly.ts)
// ------------------------------------------------------------
//  표 칸마다·거래 줄마다 판정을 다시 돌리면 11,000건을 수백 번 훑는다.
//  장부 배열(transactions)이 같으면 달·범위·끈 목록별로 한 번만 세어 둔다.
//
//  사람이 끌 수 있다:
//    거래 줄의 「신뢰」  → 그 거래처는 앞으로 칠하지 않는다 (영구)
//    계정 줄의 끄기      → 그 달 그 계정 줄만 (다음 달에 또 튀면 다시 칠한다)
//  둘 다 서버(neander_fin_anomaly_ignores)에 남아 모두에게 같이 적용되고,
//  표 위 「형광펜 관리」에서 다시 켤 수 있다.
// ============================================================

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { EyeOff, ShieldCheck, SlidersHorizontal, Undo2 } from "lucide-react";
import { cn, Icon, Popover, useToast } from "@/components/neander/ui";
import {
  accountSpikes,
  flaggedTxCounts,
  ignoredAccountKey,
  txFlags,
  vendorKey,
  type AccountSpike,
  type AnomalyIgnores,
  type TxFlag,
} from "@/lib/neander/finance/anomaly";
import { addFinAnomalyIgnore, deleteFinAnomalyIgnore } from "@/lib/neander/finance/client";
import type { ReportScope } from "@/lib/neander/finance/report";
import type { FinTransaction } from "@/lib/neander/finance/types";
import { monthLabel } from "@/lib/neander/format";
import { useFinance } from "./FinanceProvider";

const cache = new WeakMap<FinTransaction[], Map<string, unknown>>();

function remember<T>(txs: FinTransaction[], key: string, make: () => T): T {
  let bucket = cache.get(txs);
  if (!bucket) {
    bucket = new Map();
    cache.set(txs, bucket);
  }
  if (!bucket.has(key)) bucket.set(key, make());
  return bucket.get(key) as T;
}

/** 끈 목록을 판정 입력으로 — 목록이 바뀌면 캐시 키(sig)도 바뀐다 */
function useIgnores(): { ignores: AnomalyIgnores; sig: string } {
  const { anomalyIgnores } = useFinance();
  return useMemo(() => {
    const vendors = new Set<string>();
    const accounts = new Set<string>();
    const list = anomalyIgnores ?? [];
    list.forEach((d) => {
      if (d.kind === "vendor") vendors.add(d.key);
      else if (d.month) accounts.add(ignoredAccountKey(d.month, d.key));
    });
    return {
      ignores: { vendors, accounts },
      sig: list.map((d) => d.id).sort().join("|"),
    };
  }, [anomalyIgnores]);
}

export interface HighlightScope {
  /** `YYYY-MM` */
  month: string;
  /** 사업부·사업장으로 좁힌 표면 그 안의 평소와 비교한다 */
  scope?: Omit<ReportScope, "month">;
}

const NO_SPIKES = new Map<string, AccountSpike>();

/** 계정 경로 → 급증 판정 */
export function useAccountSpikes(h?: HighlightScope): Map<string, AccountSpike> {
  const { transactions } = useFinance();
  const { ignores, sig } = useIgnores();
  const scopeKey = JSON.stringify(h?.scope ?? {});
  return useMemo(
    () =>
      h?.month
        ? remember(transactions, `acct:${h.month}:${scopeKey}:${sig}`, () =>
            accountSpikes(transactions, h.month, h.scope, ignores),
          )
        : NO_SPIKES,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, h?.month, scopeKey, sig],
  );
}

const NO_COUNTS = new Map<string, number>();

/** 계정 경로 → 안에 튄 거래 건수 (계정은 안 튀었어도 표에서 찾아 들어가게) */
export function useFlaggedCounts(h?: HighlightScope): Map<string, number> {
  const { transactions } = useFinance();
  const { ignores, sig } = useIgnores();
  const scopeKey = JSON.stringify(h?.scope ?? {});
  return useMemo(
    () =>
      h?.month
        ? remember(transactions, `flagged:${h.month}:${scopeKey}:${sig}`, () =>
            flaggedTxCounts(transactions, h.month, h.scope, ignores),
          )
        : NO_COUNTS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, h?.month, scopeKey, sig],
  );
}

/**
 * 거래 한 줄의 튄 이유 — 건별 판정에, 튄 계정 안에서 증가를 이끈 거래처(driver)를 더한다.
 * spike 를 주면 그 계정의 원인 거래처 거래도 칠한다 (환급 줄은 원인이 아니라 뺀다).
 */
export function useRowFlags(spike?: AccountSpike): (t: FinTransaction) => TxFlag[] | undefined {
  const flagsOf = useTxFlags();
  return useCallback(
    (t: FinTransaction) => {
      const own = flagsOf(t);
      const driver = spike && t.txType === "지출" ? spike.drivers.get(vendorKey(t.vendor)) : undefined;
      if (!driver) return own;
      return [...(own ?? []), { kind: "driver", reason: driver.reason }];
    },
    [flagsOf, spike],
  );
}

/** 계정 줄의 점 — 계정은 안 튀었지만 안에 튄 거래가 있다 */
export function FlagDot({ count }: { count: number }) {
  return (
    <span
      title={`안에 튄 거래 ${count.toLocaleString("ko-KR")}건 — 지출 숫자에 커서를 두면 형광펜으로 보입니다`}
      aria-label={`튄 거래 ${count}건`}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-nd-fg"
      style={{ backgroundColor: "rgb(var(--nd-marker) / 0.75)" }}
    >
      {count}
    </span>
  );
}

/** 튄 계정의 창·판 맨 위 — 계정이 왜 튀었고, 무엇이 끌어올렸나 */
export function SpikeBanner({ spike, compact = false }: { spike: AccountSpike; compact?: boolean }) {
  const drivers = [...spike.drivers.values()];
  return (
    <div
      className={cn(
        "shrink-0 border-b border-nd-line text-nd-caption leading-relaxed",
        compact ? "px-3.5 py-2" : "mb-3 rounded-nd-md border px-3 py-2.5",
      )}
      style={{ backgroundColor: "rgb(var(--nd-marker) / 0.18)" }}
    >
      <p className="font-semibold text-nd-fg">
        <mark className="nd-marker">이 계정이 튄 이유</mark> {spike.reason}
      </p>
      <p className="mt-0.5 text-nd-fg-2">
        {drivers.length === 0
          ? "뚜렷한 거래처 없이 여러 곳이 고르게 늘었습니다."
          : `끌어올린 거래처: ${drivers
              .slice(0, compact ? 3 : 5)
              .map((d) => `${d.vendor} (${Math.round(d.baseline).toLocaleString("ko-KR")} → ${Math.round(d.current).toLocaleString("ko-KR")}원)`)
              .join(" · ")} — 아래에서 형광펜으로 보입니다`}
      </p>
    </div>
  );
}

/** 거래 → 튄 이유 (없으면 undefined). 달은 거래 날짜에서 읽는다 */
export function useTxFlags(): (t: FinTransaction) => TxFlag[] | undefined {
  const { transactions } = useFinance();
  const { ignores, sig } = useIgnores();
  return useCallback(
    (t: FinTransaction) => {
      const m = t.date?.slice(0, 7);
      if (!m) return undefined;
      return remember(transactions, `tx:${m}:${sig}`, () => txFlags(transactions, m, ignores)).get(t.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, sig],
  );
}

/** 끄기·다시 켜기 — 끝나면 목록을 다시 받고, 알림에서 바로 되돌릴 수 있다 */
export function useAnomalyActions() {
  const { refresh } = useFinance();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (work: () => Promise<{ id?: string } | unknown>, done: (id?: string) => void) => {
      setBusy(true);
      try {
        const r = (await work()) as { id?: string } | undefined;
        await refresh();
        done(r?.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  const restore = useCallback(
    (id: string) => run(() => deleteFinAnomalyIgnore(id), () => toast.info("형광펜을 다시 켰습니다.")),
    [run, toast],
  );

  const trustVendor = useCallback(
    (vendor: string) =>
      run(
        () => addFinAnomalyIgnore({ kind: "vendor", key: vendorKey(vendor), label: vendor.trim() }),
        (id) =>
          toast.success(`「${vendor.trim()}」 을(를) 신뢰 거래처로 두었습니다. 앞으로 칠하지 않습니다.`, {
            action: id ? { label: "되돌리기", onClick: () => void restore(id) } : undefined,
          }),
      ),
    [run, toast, restore],
  );

  const dismissAccount = useCallback(
    (month: string, path: string, label: string) =>
      run(
        () => addFinAnomalyIgnore({ kind: "account", key: path, label, month }),
        (id) =>
          toast.success(`${monthLabel(month)} 「${label}」 형광펜을 껐습니다.`, {
            action: id ? { label: "되돌리기", onClick: () => void restore(id) } : undefined,
          }),
      ),
    [run, toast, restore],
  );

  return { busy, trustVendor, dismissAccount, restore };
}

/** 형광펜 — 커서를 두면 이유 */
export function Marker({ reason, children, className }: { reason: string; children: ReactNode; className?: string }) {
  return (
    <mark title={reason} className={cn("nd-marker", className)}>
      {children}
    </mark>
  );
}

/** 튄 이유 한 줄 + 「신뢰」 — 형광펜 칠한 거래 줄 아래 */
export function FlagLine({ flags, tx }: { flags: TxFlag[]; tx: FinTransaction }) {
  const { busy, trustVendor } = useAnomalyActions();
  const vendor = tx.vendor?.trim();
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-nd-micro">
      <span className="truncate font-medium text-nd-warning-text">{flags.map((f) => f.reason).join(" · ")}</span>
      {vendor && (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            // 줄·표 칸의 클릭(창 열기·줄 선택)으로 번지지 않게
            e.stopPropagation();
            void trustVendor(vendor);
          }}
          title={`「${vendor}」 은(는) 앞으로 형광펜을 칠하지 않습니다`}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-[5px] px-1 text-nd-fg-3 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg disabled:opacity-50"
        >
          <Icon icon={ShieldCheck} size={11} />
          신뢰
        </button>
      )}
    </span>
  );
}

/** 계정 줄 끄기 — 줄에 커서가 있을 때만 보인다 (Tr 에 group 이 있어야 한다) */
export function DismissAccountButton({ month, path, label }: { month: string; path: string; label: string }) {
  const { busy, dismissAccount } = useAnomalyActions();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void dismissAccount(month, path, label);
      }}
      aria-label={`${label} — 이 달 형광펜 끄기`}
      title="이 달 이 계정은 확인했음 — 형광펜 끄기"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-nd-fg-3 opacity-0 transition-opacity duration-nd-fast hover:bg-nd-fg/[.08] hover:text-nd-fg focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
    >
      <Icon icon={EyeOff} size={13} />
    </button>
  );
}

/** 표 위 안내 + 「형광펜 관리」 — 끈 것을 보고 다시 켠다 */
export function HighlightLegend({ month, count }: { month: string; count: number }) {
  const { anomalyIgnores } = useFinance();
  const { busy, restore } = useAnomalyActions();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const vendors = (anomalyIgnores ?? []).filter((d) => d.kind === "vendor");
  const accounts = (anomalyIgnores ?? []).filter((d) => d.kind === "account" && d.month === month);
  if (count === 0 && vendors.length === 0 && accounts.length === 0) return null;

  const row = (id: string, label: string, sub?: string) => (
    <li key={id} className="flex items-center gap-2 px-3 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-nd-body text-nd-fg">{label}</span>
        {sub && <span className="block truncate text-nd-micro text-nd-fg-3">{sub}</span>}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void restore(id)}
        className="inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-nd-caption text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg disabled:opacity-50"
      >
        <Icon icon={Undo2} size={12} />
        다시 켜기
      </button>
    </li>
  );

  return (
    <span className="mr-auto flex min-w-0 items-center gap-2 pl-1 text-nd-caption text-nd-fg-3">
      {count > 0 && (
        <span className="truncate">
          <mark className="nd-marker text-nd-fg-2">형광펜</mark> 직전 6개월보다 튄 지출
        </span>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg"
      >
        <Icon icon={SlidersHorizontal} size={12} />
        형광펜 관리
        {vendors.length + accounts.length > 0 && (
          <span className="nd-num text-nd-fg-3">{vendors.length + accounts.length}</span>
        )}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        placement="bottom-start"
        ariaLabel="형광펜 관리"
        unpadded
        className="w-[22rem] max-w-[calc(100vw-1rem)]"
      >
        <div className="py-2">
          <p className="px-3 pb-1 text-nd-caption font-semibold text-nd-fg-2">
            신뢰한 거래처 <span className="font-normal text-nd-fg-3">· 늘 칠하지 않음</span>
          </p>
          {vendors.length === 0 ? (
            <p className="px-3 py-1.5 text-nd-caption text-nd-fg-3">
              없음 — 형광펜 거래 줄의 「신뢰」 로 추가합니다.
            </p>
          ) : (
            <ul>{vendors.map((d) => row(d.id, d.label || d.key, d.createdBy ? `${d.createdBy} 가 추가` : undefined))}</ul>
          )}
          <p className="mt-2 border-t border-nd-line px-3 pb-1 pt-2 text-nd-caption font-semibold text-nd-fg-2">
            {monthLabel(month)} 확인한 계정
          </p>
          {accounts.length === 0 ? (
            <p className="px-3 py-1.5 text-nd-caption text-nd-fg-3">
              없음 — 계정 줄에 커서를 두면 나오는 눈 모양 버튼으로 끕니다.
            </p>
          ) : (
            <ul>{accounts.map((d) => row(d.id, d.label || d.key, d.key.split("|").join(" › ")))}</ul>
          )}
        </div>
      </Popover>
    </span>
  );
}
