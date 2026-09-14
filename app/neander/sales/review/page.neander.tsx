"use client";

// ============================================================
//  매출 › 검토 대기함 — 엑셀에는 없던 화면
// ------------------------------------------------------------
//  엑셀은 상품을 못 알아낸 매출을 「기타·미분류」로 묶고 원가를 **평균
//  원가율로 추정**했다. 2026-07 에 그 금액이 3,715,300원 — 전체 매출의
//  15.2% 다. 추정하면 공헌이익이 실제보다 좋아 보이고, 무엇을 고쳐야
//  하는지도 영원히 모른다.
//
//  그래서 이 화면이 존재한다. 재무 검토 대기함(현재 1,130건)과 같은
//  성격이다 — 기계가 판단을 미루고 사람에게 넘기는 자리.
//
//  같은 원본 문구가 여러 번 나오므로 **문구별로 묶어** 한 번에 확정한다.
//  350건을 한 줄씩 고르게 만들면 아무도 안 쓴다.
//
//  ⚠️ 상품 후보를 **금액으로 미리 골라 두지 않는다.** 아이디 48,000원은
//     정수배로 맞는 상품이 13종이다 (50ml 5종 ×1 · 10ml 5종 ×2 · 뿌디 2종
//     ×1 · 입장권 ×8). 그중 하나를 기본값으로 띄우면 「×2 딱 맞음」이 근거처럼
//     읽혀서, 엑셀이 하던 금액 역산을 화면이 더 그럴싸하게 되풀이한다.
//
//     그래서 후보가 둘 이상이면 빈 칸으로 두고 사람이 고르게 한다. 순서는
//     산술이 아니라 **근거** — 같은 이벤트에서 이미 확정된 상품이 위로 온다.
//     그 근거를 카드에 숫자로 함께 보여준다.
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CheckCheck,
  CircleCheck,
  Inbox,
  Info,
  Layers,
  PackagePlus,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Checkbox,
  cn,
  Dialog,
  EmptyState,
  Field,
  FieldAction,
  FilterBar,
  FilterField,
  IconButton,
  InfoPopover,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  Pagination,
  SegmentedControl,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
  UndoHistory,
  useConfirm,
  useToast,
  useUndoHistory,
} from "@/components/neander/ui";
import { useSales } from "@/components/neander/sales/SalesProvider";
import {
  ProductThumb,
  StoreBadge,
} from "@/components/neander/sales/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import {
  availableMonths,
  inMonth,
} from "@/lib/neander/sales/aggregate";
import {
  bulkResolveSalesLines,
  deleteSalesLine,
  restoreSalesLines,
  setSalesEventOptOut,
  splitSalesLines,
  updateSalesLine,
  upsertSalesProduct,
} from "@/lib/neander/sales/client";
import {
  REASON_HINT,
  REASON_LABEL,
  SALES_STORES,
  storeLabel,
  eventLabelOf,
  kindLabel,
  productInScope,
  shippingFeeAt,
  valueAt,
  type SalesAssumptions,
  type SalesEvent,
  type SalesKind,
  type SalesLine,
  type PayRoute,
  type SalesLineReason,
  type SalesProduct,
  type SalesStore,
} from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";

/**
 * 같은 원본 문구 · 같은 금액 · 같은 매장 · **같은 이벤트**를 한 묶음으로.
 *
 * 이벤트를 키에 넣는 이유가 둘이다:
 *  ① 행사 전용 상품은 그 행사의 줄에만 쓸 수 있다. 한 묶음이 두 행사에
 *     걸쳐 있으면 한 번에 확정할 수 없다.
 *  ② 추정의 근거(같은 행사에서 팔린 상품)가 행사마다 다르다. 섞어 놓으면
 *     근거도 섞인다.
 */
/** 조합으로 나눌 때 한 상품 몫 */
interface ComboPart {
  productId: string;
  qty: number;
  amount: number;
}

interface Bucket {
  key: string;
  raw: string;
  amount: number;
  store: SalesStore;
  /** 이 묶음이 속한 이벤트. 없으면 상시 */
  eventId?: string;
  reason?: SalesLineReason;
  lines: SalesLine[];
  total: number;
}

function bucketize(lines: SalesLine[]): Bucket[] {
  const map = new Map<string, Bucket>();
  lines.forEach((l) => {
    const key = `${l.store}|${l.eventId ?? ""}|${l.raw}|${l.amount}`;
    const b =
      map.get(key) ??
      ({
        key,
        raw: l.raw,
        amount: l.amount,
        store: l.store,
        eventId: l.eventId,
        reason: l.reason,
        lines: [],
        total: 0,
      } as Bucket);
    b.lines.push(l);
    b.total += l.amount;
    map.set(key, b);
  });
  // 금액이 큰 묶음부터 — 손익에 미치는 영향이 큰 것을 먼저 없앤다
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/**
 * 어느 원본 파일에서 온 줄인가 — 적재 퍼즐의 칸 이름과 같게 부른다.
 * routeLabel(현장결제·네이버예약)이 아니라 원본 이름을 쓰는 이유: 미확정
 * 줄을 확인하러 되돌아가 여는 곳이 네이버 예약자관리냐 페이히어냐이기 때문이다.
 */
const SOURCE_LABEL: Record<PayRoute, string> = {
  naver: "네이버 예약",
  payhere: "페이히어",
  online: "온라인",
};

/**
 * 묶음 안의 출처별 건수. 묶음 키에 경로가 없어 한 묶음에 네이버와
 * 페이히어가 섞일 수 있다 — 섞였으면 둘 다 건수와 함께 보인다.
 */
function routesOf(lines: SalesLine[]): { route: PayRoute; count: number }[] {
  const m = new Map<PayRoute, number>();
  lines.forEach((l) => m.set(l.route, (m.get(l.route) ?? 0) + 1));
  return [...m.entries()].map(([route, count]) => ({ route, count }));
}

// ---- 처리된 묶음이 떠나는 모습 --------------------------------------

type LeavePhase = "done" | "fade" | "collapse";
interface Leaving {
  phase: LeavePhase;
  message: string;
  tone: "success" | "neutral";
}

/** 떠나는 시간표 (ms) — neander.css 의 nd-leave 전환 시간과 맞춘다 */
const LEAVE_MS = { hold: 750, fade: 250, collapse: 300 };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 묶음 카드를 감싸 떠나는 동안의 모습을 입힌다. 카드 자체는 건드리지 않는다 —
 * 가운데 결과 표시와 흐려짐·높이 접기는 전부 이 껍데기와 CSS(nd-leave)가 한다.
 */
function LeavingItem({ state, children }: { state?: Leaving; children: ReactNode }) {
  return (
    <div className="nd-leave" data-phase={state?.phase} aria-hidden={state?.phase === "collapse" || undefined}>
      <div className="nd-leave-inner">
        <div className="nd-leave-body">{children}</div>
        {state && (
          <div className="nd-leave-mark" role="status" aria-live="polite">
            <span
              className={cn(
                "nd-surface inline-flex items-center gap-2 rounded-full px-4 py-2 text-nd-body font-semibold shadow-lg",
                state.tone === "success" ? "text-nd-success-text" : "text-nd-fg",
              )}
            >
              {state.tone === "success" ? <CircleCheck size={18} /> : <Trash2 size={18} />}
              {state.message}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SalesReviewPage() {
  const { lines, products, events, assumptions, loading, applyLines } = useSales();
  const toast = useToast();
  const confirm = useConfirm();
  const months = useMemo(() => availableMonths(lines, events), [lines, events]);
  const [month, setMonth] = useState<string>("");
  const activeMonth = month || months[0] || "";
  const [storeFilter, setStoreFilter] = useState<SalesStore | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * 떠나는 묶음 — 처리가 끝난 묶음을 곧바로 지우지 않는다. 가운데에 결과를
   * 띄우고(done) → 흐려지고(fade) → 높이를 접은(collapse) 뒤에야 바뀐 줄을
   * 바꿔 끼운다(apply). 다 접힌 뒤 바꾸므로 카드가 빠져도 화면이 튀지 않는다.
   * 전체를 다시 받지 않는다 — 판매 줄 6천+ · 1.6MB 라 누를 때마다 굼떴다.
   */
  const [leaving, setLeaving] = useState<Record<string, Leaving>>({});
  async function leaveThenApply(
    key: string,
    message: string,
    apply: () => void,
    tone: Leaving["tone"] = "success",
  ) {
    const set = (phase: LeavePhase) => setLeaving((m) => ({ ...m, [key]: { phase, message, tone } }));
    set("done");
    await wait(LEAVE_MS.hold);
    set("fade");
    await wait(LEAVE_MS.fade);
    set("collapse");
    await wait(LEAVE_MS.collapse);
    try {
      apply();
    } finally {
      // 바꾼 뒤에도 묶음이 남아 있으면(일부만 처리됐거나 되돌림) 다시 보이게
      setLeaving((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    }
  }
  /** 되돌리기 — 처리 직전의 줄을 쌓아 두었다가 통째로 되쓴다 (재무 대기함과 같은 부품) */
  const undoLog = useUndoHistory<SalesLine>({
    // 되쓴 줄만 바꿔 끼우고, 조합으로 나눌 때 생긴 줄은 뺀다
    restore: async (before, created) => {
      const res = await restoreSalesLines(before, created);
      applyLines({ upsert: res.lines, remove: created });
    },
  });

  const productName = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? [p.name, p.option].filter(Boolean).join(" ") : id;
  };

  const pending = useMemo(
    () =>
      lines.filter(
        (l) =>
          l.status === "needs_review" &&
          inMonth(l.date, activeMonth) &&
          (storeFilter === "all" || l.store === storeFilter),
      ),
    [lines, activeMonth, storeFilter],
  );

  const buckets = useMemo(() => bucketize(pending), [pending]);
  /**
   * 묶음을 한 쪽씩 본다. 41묶음을 한 장에 쌓으면 페이지가 1만 7천 px 이 되어
   * 아래쪽 묶음은 아무도 못 본다 (재무 검토 대기함도 같은 이유로 쪽을 나눈다).
   */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageBuckets = useMemo(
    () => buckets.slice((page - 1) * pageSize, page * pageSize),
    [buckets, page, pageSize],
  );
  /** 이벤트 코드 → 이름. 표에 코드만 찍으면 어느 행사인지 알 수 없다 */
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  /**
   * 근거 색인 — **이미 확정된 줄**로 만든다. 추정의 유일한 정당한 근거다:
   * 같은 이벤트에서 실제로 팔린 상품이면 그 이벤트의 다른 줄도 그것일 가능성이
   * 높고, 한 번도 안 팔린 상품이면 금액이 맞아도 근거가 없다.
   */
  const evidence = useMemo(() => {
    const byEvent = new Map<string, Map<string, { rows: number; qty: number }>>();
    const byStoreMonth = new Map<string, Map<string, { rows: number; qty: number }>>();
    const bump = (
      m: Map<string, Map<string, { rows: number; qty: number }>>,
      k: string,
      pid: string,
      qty: number,
    ) => {
      const inner = m.get(k) ?? new Map<string, { rows: number; qty: number }>();
      const cur = inner.get(pid) ?? { rows: 0, qty: 0 };
      cur.rows += 1;
      cur.qty += qty;
      inner.set(pid, cur);
      m.set(k, inner);
    };
    lines.forEach((l) => {
      if (l.status !== "resolved" || !l.productId) return;
      if (l.eventId) bump(byEvent, l.eventId, l.productId, l.qty);
      bump(byStoreMonth, `${l.store}|${l.date.slice(0, 7)}`, l.productId, l.qty);
    });
    return { byEvent, byStoreMonth };
  }, [lines]);

  /** 이 묶음의 근거 범위 — 이벤트가 있으면 그 이벤트, 없으면 같은 매장·달 */
  const evidenceFor = (b: Bucket): { rows: Map<string, { rows: number; qty: number }>; scope: string } => {
    const eventId = b.eventId;
    if (eventId) {
      return {
        rows: evidence.byEvent.get(eventId) ?? new Map(),
        scope: eventLabelOf(eventId, eventsById),
      };
    }
    const month = b.lines[0]?.date.slice(0, 7) ?? activeMonth;
    return {
      rows: evidence.byStoreMonth.get(`${b.store}|${month}`) ?? new Map(),
      scope: `${storeLabel(b.store)} ${monthLabel(month)} 전체`,
    };
  };
  useEffect(() => {
    setPage(1);
  }, [activeMonth, storeFilter, pageSize]);

  const total = pending.reduce((s, l) => s + l.amount, 0);
  const monthRevenue = useMemo(
    () => lines.filter((l) => inMonth(l.date, activeMonth)).reduce((s, l) => s + l.amount, 0),
    [lines, activeMonth],
  );

  async function resolveBucket(b: Bucket, productId: string, qty: number) {
    setBusy(b.key);
    try {
      const res = await bulkResolveSalesLines(
        b.lines.map((l) => l.id),
        productId,
        qty,
      );
      undoLog.record(`${b.lines.length.toLocaleString("ko-KR")}건을 확정했습니다.`, `「${b.raw}」 ${b.lines.length.toLocaleString("ko-KR")}건 → ${productName(productId)} 확정`, b.lines);
      await leaveThenApply(b.key, "확정되었습니다", () => applyLines({ upsert: res.lines }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "확정에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * 한 결제를 여러 상품으로 나눠 확정 — 「샤쉐 외 1건」 53,000 = 사쉐 + 50ml.
   * 되돌리면 원래 줄을 되쓰고, 나누면서 새로 생긴 줄은 지운다.
   */
  async function splitBucket(b: Bucket, parts: ComboPart[]) {
    setBusy(b.key);
    try {
      const res = await splitSalesLines(
        b.lines.map((l) => l.id),
        parts,
      );
      const desc = parts.map((p) => `${productName(p.productId)} ×${p.qty}`).join(" + ");
      undoLog.record(
        `${b.lines.length.toLocaleString("ko-KR")}건을 ${desc} 로 나눠 확정했습니다.`,
        `「${b.raw}」 ${b.lines.length.toLocaleString("ko-KR")}건 → ${desc}`,
        b.lines,
        res.created,
      );
      await leaveThenApply(b.key, "나눠서 확정되었습니다", () => applyLines({ upsert: res.lines }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "나누지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * 이벤트 기간에 온 일반 손님 — 이 묶음을 이벤트 매출에서 떼어 일반 매출로.
   * 떼고 나면 묶음이 상시 쪽으로 옮겨 가고, 후보도 매장 공용 상품이 먼저 뜬다.
   * optOut=false 는 그 반대 — 뗀 줄만 날짜로 다시 이벤트에 붙인다.
   */
  async function setEventOptOut(b: Bucket, optOut: boolean) {
    const target = optOut ? b.lines : b.lines.filter((l) => l.eventOptOut);
    if (target.length === 0) return;
    setBusy(b.key);
    try {
      const res = await setSalesEventOptOut(
        target.map((l) => l.id),
        optOut,
      );
      const n = target.length.toLocaleString("ko-KR");
      undoLog.record(
        optOut ? `${n}건을 일반 매출로 옮겼습니다.` : `${n}건을 이벤트 매출로 되돌렸습니다.`,
        optOut
          ? `「${b.raw}」 ${n}건 → ${eventLabelOf(b.eventId, eventsById)} 에서 떼어 일반 매출`
          : `「${b.raw}」 ${n}건 → 이벤트 매출로`,
        target,
      );
      // 옮긴 줄은 이 묶음을 떠난다 — 확정과 같은 모습으로 (남는 줄이 있으면 다시 보인다)
      await leaveThenApply(b.key, optOut ? "일반 매출로 옮겼습니다" : "이벤트 매출로 되돌렸습니다", () =>
        applyLines({ upsert: res.lines }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "옮기지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  /** 상품으로 나눌 수 없는 건 — 금액만 남기고 원가 없음을 명시한다 */
  async function keepAsManual(b: Bucket, material: number) {
    setBusy(b.key);
    try {
      const results = await Promise.all(
        b.lines.map((l) =>
          updateSalesLine(l.id, {
            status: "manual",
            manualMaterial: material,
            reason: undefined,
          }),
        ),
      );
      undoLog.record(`${b.lines.length.toLocaleString("ko-KR")}건을 직접입력으로 남겼습니다.`, `「${b.raw}」 ${b.lines.length.toLocaleString("ko-KR")}건 → 직접입력`, b.lines);
      await leaveThenApply(b.key, "직접입력으로 남겼습니다", () =>
        applyLines({ upsert: results.flatMap((r) => r.lines) }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function removeBucket(b: Bucket) {
    if (
      !(await confirm({
        title: `${b.lines.length}건을 삭제할까요?`,
        message: "환불처럼 매출이 아닌 건만 지우세요. 지우면 매출 합계가 줄어듭니다.",
        confirmLabel: "삭제",
        tone: "danger",
      }))
    )
      return;
    setBusy(b.key);
    try {
      await Promise.all(b.lines.map((l) => deleteSalesLine(l.id)));
      undoLog.record(`${b.lines.length}건을 지웠습니다.`, `「${b.raw}」 ${b.lines.length}건 삭제`, b.lines);
      await leaveThenApply(
        b.key,
        "삭제되었습니다",
        () => applyLines({ remove: b.lines.map((l) => l.id) }),
        "neutral",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingState label="매출을 불러오는 중…" />;

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="검토 대기함"
        description="상품을 정하지 못한 판매입니다. 여기가 비면 손익이 확정됩니다."
        meta={
          pending.length > 0 ? (
            <Badge tone="warning">{pending.length.toLocaleString("ko-KR")}건</Badge>
          ) : undefined
        }
      />

      {/* 기준은 한 줄 + 도움말. 상태(건수·금액)는 아래 지표 띠에 그대로 */}
      <BasisLine
        className="mb-5"
        items={["미확정 금액은 이익률 계산에서 제외", "추정하지 않고 사람이 정합니다"]}
      >
        <InfoPopover
          label="왜 제외하나"
          title="미확정 판매를 이익률에서 빼는 이유"
          terms={[
            { term: "매출에만 넣으면", desc: "원가가 0 으로 잡혀 이익률이 부풀려집니다." },
            { term: "평균원가율로 메우면", desc: "엑셀 방식입니다. 원가가 사실과 달라지고, 수량과 금액이 다른 모집단에서 오게 됩니다." },
            { term: "그래서", desc: "상품이 정해질 때까지 매출과 원가를 함께 뺍니다. 여기서 상품을 정하는 순간 그 달 손익에 들어갑니다." },
            { term: "매출 비서", desc: "오른쪽 위 비서에게 묶음을 어떻게 나눌지 물어볼 수 있습니다. 제안은 「적용」 을 눌러야 저장됩니다." },
          ]}
        />
      </BasisLine>

      <KpiStrip columns={3} className="mb-5">
        <KpiItem
          label={`${monthLabel(activeMonth)} 미확정`}
          value={<span className="nd-num">{pending.length.toLocaleString("ko-KR")}</span>}
          unit="건"
          tone={pending.length > 0 ? "warning" : "success"}
        />
        <StatTile label="미확정 금액" value={total} hint={`묶음 ${buckets.length.toLocaleString("ko-KR")}개`} />
        <KpiItem
          label="매출 대비"
          value={
            <span className="nd-num">
              {monthRevenue ? `${((total / monthRevenue) * 100).toFixed(1)}%` : "—"}
            </span>
          }
          hint="엑셀은 이 비중이 15.2% 였습니다"
        />
      </KpiStrip>

      <UndoHistory
        className="mb-4"
        entries={undoLog.entries}
        undoingId={undoLog.undoingId}
        onUndo={(e) => void undoLog.undo(e)}
      />

      {/* 매장 목록은 SALES_STORES 하나만 본다 — 화면마다 베끼면 매장이 늘 때 빠진다 */}
      <FilterBar
        className="mb-4"
        actions={
          <span className="text-nd-caption text-nd-fg-2">
            같은 원본 문구·금액을 한 묶음으로 묶어 한 번에 확정합니다
          </span>
        }
      >
        <FilterField label="매장" as="div">
          <SegmentedControl
            size="sm"
            ariaLabel="매장"
            value={storeFilter}
            onChange={(v) => setStoreFilter(v as SalesStore | "all")}
            options={[
              { value: "all", label: "전체" },
              ...SALES_STORES.map((x) => ({ value: x.value, label: x.label })),
            ]}
          />
        </FilterField>
      </FilterBar>

      {buckets.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="확정할 것이 없습니다"
          description={
            <>
              {monthLabel(activeMonth)} 판매는 모두 상품이 정해졌습니다.{" "}
              <Link href="/neander/sales" className="font-medium text-nd-accent-strong hover:underline">
                월 손익 보기
              </Link>
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {pageBuckets.map((b) => (
            <LeavingItem key={b.key} state={leaving[b.key]}>
              <BucketCard
                bucket={b}
                products={products}
                eventsById={eventsById}
                assumptions={assumptions}
                evidence={evidenceFor(b)}
                busy={busy === b.key}
                onResolve={(pid, qty) => void resolveBucket(b, pid, qty)}
                onManual={(m) => void keepAsManual(b, m)}
                onSplit={(parts) => void splitBucket(b, parts)}
              onEventOptOut={(v) => void setEventOptOut(b, v)}
                onDelete={() => void removeBucket(b)}
              />
            </LeavingItem>
          ))}
          <Pagination
            className="pt-1"
            total={buckets.length}
            unit="묶음"
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      )}
    </PageShell>
  );
}

/** 금액이 맞는 상품 한 후보 */
interface Candidate {
  product: SalesProduct;
  /** 이 후보로 볼 때의 수량 */
  qty: number;
  /** 적용한 단가 (그 시점 정가 또는 쿠폰가) */
  unit: number;
  coupon: boolean;
  /** 배송비를 뺀 금액으로 맞춘 경우 그 배송비 */
  shippingFee?: number;
  /** 같은 이벤트(또는 매장·달)에서 이 상품으로 확정된 줄 수 — 유일한 근거 */
  rows: number;
}

function BucketCard({
  bucket,
  products,
  eventsById,
  assumptions,
  evidence,
  busy,
  onResolve,
  onManual,
  onSplit,
  onEventOptOut,
  onDelete,
}: {
  bucket: Bucket;
  products: SalesProduct[];
  eventsById: Map<string, SalesEvent>;
  assumptions: SalesAssumptions;
  /** 같은 이벤트·매장에서 이미 확정된 상품 분포 */
  evidence: { rows: Map<string, { rows: number; qty: number }>; scope: string };
  busy: boolean;
  onResolve: (productId: string, qty: number) => void;
  onManual: (material: number) => void;
  onSplit: (parts: ComboPart[]) => void;
  /** true = 이벤트 매출에서 떼어 일반 매출로 · false = 이벤트로 되돌리기 */
  onEventOptOut: (optOut: boolean) => void;
  onDelete: () => void;
}) {
  /**
   * 후보 풀 — 같은 매장이고, **이 이벤트에서 쓸 수 있는** 상품만.
   * 다른 행사 전용 상품은 금액이 맞아도 뜨지 않는다.
   */
  const pool = useMemo(
    () => products.filter((p) => p.store === bucket.store && productInScope(p, bucket.eventId)),
    [products, bucket.store, bucket.eventId],
  );
  /** 이벤트 기간이지만 일반 손님으로 뗀 줄 */
  const optOutCount = bucket.lines.filter((l) => l.eventOptOut).length;

  /**
   * 금액이 맞는 후보들.
   *
   * 단가는 **그 줄의 날짜에 유효했던 값**을 쓴다 (p.price 를 바로 쓰면 과거
   * 달에서 어긋난다 — 2025-12 는 50ml 이 58,000 이었다). 쿠폰가도 인정한다:
   * 해석기가 그렇게 하므로 화면도 같아야 한다.
   *
   * 순서는 **근거 우선**이다 — 같은 이벤트에서 실제로 팔린 상품이 위로 온다.
   * 그다음 수량이 적은 쪽(단품이 더 단순한 설명), 마지막이 코드순.
   */
  const candidates = useMemo<Candidate[]>(() => {
    const date = bucket.lines[0]?.date ?? "";
    // 배송비가 붙던 시기의 온라인 주문은 배송비를 뺀 금액으로도 맞춰 본다
    const shipping = shippingFeeAt(assumptions, bucket.store, date);
    const out: Candidate[] = [];
    pool.forEach((p) => {
      const base = valueAt(p, date).price;
      const tries: { v: number; coupon: boolean }[] = [{ v: base, coupon: false }];
      if (p.discountRate && p.discountRate > 0 && p.discountRate < 1) {
        const d = Math.round(base * (1 - p.discountRate));
        if (d > 0 && d !== base) tries.push({ v: d, coupon: true });
      }
      // 배송비 없는 해석을 먼저 — 복수 구매는 배송비가 0 이었다
      const amounts: { net: number; ship?: number }[] = [{ net: bucket.amount }];
      if (shipping > 0 && bucket.amount > shipping) {
        amounts.push({ net: bucket.amount - shipping, ship: shipping });
      }
      outer: for (const a of amounts) {
        for (const t of tries) {
          if (t.v > 0 && a.net % t.v === 0) {
            out.push({
              product: p,
              qty: a.net / t.v,
              unit: t.v,
              coupon: t.coupon,
              shippingFee: a.ship,
              rows: evidence.rows.get(p.id)?.rows ?? 0,
            });
            break outer;
          }
        }
      }
    });
    return out.sort(
      (a, b) => b.rows - a.rows || a.qty - b.qty || a.product.id.localeCompare(b.product.id),
    );
  }, [pool, bucket.amount, bucket.store, bucket.lines, evidence, assumptions]);

  /** 금액이 안 맞는 상품도 고를 수 있어야 한다 (할인·수기) — 후보 뒤에 붙인다 */
  const others = useMemo(
    () => pool.filter((p) => !candidates.some((c) => c.product.id === p.id)),
    [pool, candidates],
  );

  /**
   * 미리 고르는 것은 **후보가 하나이고 그 상품이 이 범위에서 실제로 팔렸을
   * 때만**이다. 그 밖에는 빈 칸으로 두고 사람이 고르게 한다 — 금액만으로
   * 단정하지 않는 것이 이 화면의 존재 이유다.
   */
  const autoPick = candidates.length === 1 && candidates[0].rows > 0 ? candidates[0] : null;
  const [productId, setProductId] = useState(autoPick?.product.id ?? "");
  /**
   * 후보를 전부 펼치지 않는다. 아이디 48,000원처럼 정수배로 맞는 상품이 13종인
   * 묶음이 있어서, 다 펼치면 묶음 하나가 화면 한 장을 먹는다 (41묶음 = 2만 px).
   * 순서가 **근거 순**이라 위 네 개가 실제로 볼 값어치가 있는 것들이고,
   * 나머지는 눌러서 편다.
   */
  const [allCandidates, setAllCandidates] = useState(false);
  const CANDIDATE_HEAD = 4;
  // 고른 것이 접힌 쪽에 있으면 그것만은 함께 보여준다 — 무엇을 골랐는지 사라지면 안 된다
  const shownCandidates =
    allCandidates || candidates.length <= CANDIDATE_HEAD
      ? candidates
      : [
          ...candidates.slice(0, CANDIDATE_HEAD),
          ...candidates.slice(CANDIDATE_HEAD).filter((c) => c.product.id === productId),
        ];
  const hiddenCount = candidates.length - shownCandidates.length;
  const picked = candidates.find((c) => c.product.id === productId);
  const suggestedQty = picked?.qty ?? 1;
  const [qty, setQty] = useState<string>("");
  const [material, setMaterial] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const effQty = Number(qty || suggestedQty) || 1;

  /**
   * 조합으로 나누기 — 한 결제에 상품이 여러 개 들어 있을 때. 상품·수량을 고르면
   * 그 줄 날짜의 단가로 금액을 계산하고, **합계가 결제액과 같을 때만** 확정한다.
   * 금액이 맞는다고 조합을 미리 골라 두지 않는다 — 38,000 은 와우에서 50ml 과
   * 뿌디가 같아 금액만으로는 정할 수 없다. 사람이 고른다.
   */
  const [combo, setCombo] = useState<{ productId: string; qty: string }[] | null>(null);
  const comboDate = bucket.lines[0]?.date ?? "";
  const comboParts = (combo ?? []).map((r) => {
    const p = pool.find((x) => x.id === r.productId);
    const n = Number(r.qty) || 0;
    const unit = p ? valueAt(p, comboDate).price : 0;
    return { productId: r.productId, qty: n, unit, amount: unit * n };
  });
  const comboSum = comboParts.reduce((s, x) => s + x.amount, 0);
  const comboOk =
    comboParts.length > 0 &&
    comboParts.every((x) => x.productId && x.qty > 0 && x.unit > 0) &&
    comboSum === bucket.amount;
  const setComboRow = (i: number, patch: Partial<{ productId: string; qty: string }>) =>
    setCombo((rows) => (rows ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** 근거 요약 — 많이 팔린 순 상위 3종 */
  const topEvidence = useMemo(
    () =>
      [...evidence.rows.entries()]
        .map(([pid, v]) => ({ p: pool.find((x) => x.id === pid), ...v }))
        .filter((x) => x.p)
        .sort((a, b) => b.rows - a.rows)
        .slice(0, 3),
    [evidence, pool],
  );

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StoreBadge store={bucket.store} size="sm" />
            {routesOf(bucket.lines).map(({ route, count }, _i, all) => (
              <Badge key={route} size="sm">
                {SOURCE_LABEL[route]}
                {all.length > 1 && ` ${count.toLocaleString("ko-KR")}`}
              </Badge>
            ))}
            {bucket.reason && (
              <Badge tone="warning" size="sm">
                {REASON_LABEL[bucket.reason]}
              </Badge>
            )}
            <Badge size="sm">{bucket.lines.length.toLocaleString("ko-KR")}건</Badge>
            {/* 이 묶음은 한 이벤트에 속한다 (묶음 키에 이벤트가 들어간다) */}
            <Badge tone={bucket.eventId ? "accent" : "neutral"} size="sm">
              {eventLabelOf(bucket.eventId, eventsById)}
            </Badge>
            {optOutCount > 0 && (
              <Badge size="sm">이벤트 기간 · 일반 손님 {optOutCount.toLocaleString("ko-KR")}건</Badge>
            )}
            {/* 이벤트 날에도 일반 손님을 받는다 — 그 판매는 이벤트 실적이 아니다 */}
            {bucket.eventId ? (
              <Button
                size="sm"
                variant="secondary"
                icon={UserRound}
                disabled={busy}
                title="이벤트 기간에 온 일반 손님의 판매 — 이벤트 매출에서 빼고 일반 매출로 잡습니다"
                onClick={() => onEventOptOut(true)}
              >
                일반 손님으로
              </Button>
            ) : optOutCount > 0 ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onEventOptOut(false)}>
                이벤트로 되돌리기
              </Button>
            ) : null}
          </div>
          <p className="mt-1.5 break-words text-nd-body font-medium text-nd-fg">{bucket.raw}</p>
          <p className="text-nd-caption text-nd-fg-3">
            {bucket.reason ? REASON_HINT[bucket.reason] : "상품이 정해지지 않았습니다."}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-nd-caption text-nd-fg-3">건당 / 합계</div>
          <div className="nd-num text-nd-body text-nd-fg">
            <Money value={bucket.amount} unit={false} /> /{" "}
            <span className="font-semibold">
              <Money value={bucket.total} unit={false} />
            </span>
          </div>
        </div>
      </div>

      {/* 칸의 위쪽을 맞춘다 — 아래 끝으로 맞추면 힌트 길이에 따라 입력칸이 들쭉날쭉해진다.
          버튼은 FieldAction 으로 감싸 라벨 높이만큼 내려 입력칸과 같은 줄에 세운다. */}
      <div className="flex flex-wrap items-start gap-3 border-t border-nd-line pt-3">
        <Field
          label="상품"
          className="min-w-[16rem] flex-1"
          hint={
            candidates.length === 0
              ? "금액이 맞는 상품이 없습니다 — 아래 목록에서 직접 고르세요"
              : candidates.length === 1
                ? autoPick
                  ? "후보 1종 — 이 이벤트에서 팔린 상품이라 미리 골라 뒀습니다"
                  : "후보 1종 — 이 범위에서 팔린 적이 없어 직접 확인이 필요합니다"
                : `금액이 맞는 상품 ${candidates.length}종 — 금액만으로는 정할 수 없습니다`
          }
        >
          {/*
            후보를 **사진이 붙은 카드**로 편다. 예전에는 네이티브 <option> 한 줄에
            「이름 옵션 · 단가 ×수량 · n줄 확정」을 다 적었는데, 목록을 펼치기 전에는
            후보가 몇인지도 안 보였고 10ml·50ml 은 글자 두 자 차이라 잘못 고르기 쉬웠다.
            투명 병과 검은 병은 잘못 고르기 어렵다.

            진짜 <input type="radio"> 를 쓴다 — 화살표 키 이동과 낭독기 읽기를
            브라우저가 해 준다. 카드는 그 라디오의 라벨이다.
          */}
          {/* 금액이 맞는 후보가 하나도 없으면 라디오그룹을 만들지 않는다 —
              고를 것이 없는 빈 그룹은 낭독기에 「선택 항목 0개」로 읽힌다.
              그럴 때는 아래 목록(others)만 남는다. */}
          <div
            {...(candidates.length > 0
              ? { role: "radiogroup" as const, "aria-label": "상품 후보" }
              : {})}
            className="flex flex-col gap-1.5"
          >
            {shownCandidates.map((c) => {
              const on = productId === c.product.id;
              return (
                <label
                  key={c.product.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-nd-md border px-2.5 py-2 transition-colors duration-nd-fast",
                    on
                      ? "border-nd-accent bg-nd-accent-soft"
                      : "border-nd-border bg-nd-content hover:bg-nd-sunken",
                    "focus-within:shadow-nd-focus",
                  )}
                >
                  <input
                    type="radio"
                    name={`bucket-${bucket.key}`}
                    value={c.product.id}
                    checked={on}
                    onChange={() => {
                      setProductId(c.product.id);
                      setQty("");
                    }}
                    className="sr-only"
                  />
                  <ProductThumb product={c.product} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                      <span className="truncate text-nd-body text-nd-fg">{c.product.name}</span>
                      <span className="text-nd-caption text-nd-fg-2">{c.product.option}</span>
                      {c.rows > 0 ? (
                        <Badge tone="success" size="sm">
                          이 범위에서 {c.rows}줄 확정
                        </Badge>
                      ) : (
                        <Badge size="sm">근거 없음</Badge>
                      )}
                    </span>
                    <span className="nd-num block text-nd-micro text-nd-fg-3">
                      {c.unit.toLocaleString("ko-KR")}원{c.coupon ? "(쿠폰가)" : ""} × {c.qty}
                      {c.shippingFee ? ` + 배송비 ${c.shippingFee.toLocaleString("ko-KR")}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setAllCandidates(true)}
                className="h-8 rounded-nd-md border border-dashed border-nd-border text-nd-caption font-medium text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-sunken hover:text-nd-fg"
              >
                금액이 맞는 상품 {hiddenCount}종 더 보기
              </button>
            )}

            {/* 금액이 안 맞는 상품도 고를 수 있어야 한다 (할인·수기). 후보와
                섞으면 「금액이 맞는다」는 근거가 흐려지므로 목록으로 따로 둔다. */}
            {others.length > 0 && (
              <Select
                size="sm"
                aria-label="금액이 맞지 않는 상품에서 고르기"
                value={others.some((p) => p.id === productId) ? productId : ""}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setQty("");
                }}
              >
                <option value="">
                  {candidates.length > 0 ? "금액이 맞지 않는 상품에서 고르기…" : "— 상품을 고르세요 —"}
                </option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.option} · {p.price.toLocaleString("ko-KR")}원
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Field>
        <Field label="수량" hint={picked ? `${picked.unit.toLocaleString("ko-KR")}원 × ${picked.qty}` : "상품을 먼저"}>
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num w-20"
            value={qty}
            placeholder={String(suggestedQty)}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <FieldAction>
          <Button
            size="sm"
            icon={CheckCheck}
            loading={busy}
            disabled={!productId}
            onClick={() => onResolve(productId, effQty)}
          >
            {bucket.lines.length}건 확정
          </Button>
        </FieldAction>
        <FieldAction>
          <Button
            size="sm"
            variant="secondary"
            icon={Layers}
            disabled={busy}
            aria-expanded={combo !== null}
            onClick={() =>
              setCombo((c) =>
                c
                  ? null
                  : [
                      { productId: "", qty: "1" },
                      { productId: "", qty: "1" },
                    ],
              )
            }
          >
            {combo ? "조합 닫기" : "조합으로 나누기"}
          </Button>
        </FieldAction>

        <FieldAction className="mx-1">
          <div className="h-ctl-sm w-px bg-nd-line" aria-hidden />
        </FieldAction>

        <Field label="원가 직접입력" hint="상품으로 못 나눌 때">
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num w-24"
            value={material}
            placeholder="0"
            onChange={(e) => setMaterial(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <FieldAction>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => onManual(Number(material || 0))}
          >
            직접입력으로
          </Button>
        </FieldAction>
        {/* 맞는 상품이 아예 없을 때의 길 — 행사마다 그 행사만의 품목이 나온다 */}
        <FieldAction>
          <Button
            size="sm"
            variant="secondary"
            icon={PackagePlus}
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            새 상품 만들기
          </Button>
        </FieldAction>
        <FieldAction>
          <IconButton
            icon={Trash2}
            label="삭제"
            size="sm"
            onClick={onDelete}
            className="hover:text-nd-danger-text"
          />
        </FieldAction>
      </div>

      {combo && (
        <div className="mt-3 rounded-nd-md border border-nd-border bg-nd-sunken px-3 py-3">
          <p className="mb-2 text-nd-caption text-nd-fg-2">
            한 결제에 들어 있던 상품을 모두 고르세요. 합계가 결제액과 같아지면 확정할 수 있고, 결제 한
            건이 상품 수만큼의 줄로 나뉩니다. 단가는 {comboDate} 기준입니다.
          </p>
          <div className="flex flex-col gap-2">
            {combo.map((row, i) => {
              const part = comboParts[i];
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    size="sm"
                    className="min-w-[16rem] flex-1"
                    aria-label={`조합 상품 ${i + 1}`}
                    value={row.productId}
                    onChange={(e) => setComboRow(i, { productId: e.target.value })}
                  >
                    <option value="">— 상품을 고르세요 —</option>
                    {pool.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.option} · {valueAt(p, comboDate).price.toLocaleString("ko-KR")}원
                      </option>
                    ))}
                  </Select>
                  <span className="text-nd-caption text-nd-fg-3" aria-hidden>
                    ×
                  </span>
                  <Input
                    size="sm"
                    inputMode="numeric"
                    className="nd-num w-16"
                    aria-label={`조합 상품 ${i + 1} 수량`}
                    value={row.qty}
                    onChange={(e) => setComboRow(i, { qty: e.target.value.replace(/[^\d]/g, "") })}
                  />
                  <span className="nd-num w-24 text-right text-nd-body text-nd-fg-2">
                    <Money value={part?.amount ?? 0} unit={false} />
                  </span>
                  <IconButton
                    icon={X}
                    label="이 상품 빼기"
                    size="sm"
                    disabled={combo.length <= 1}
                    onClick={() => setCombo((rows) => (rows ?? []).filter((_, j) => j !== i))}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => setCombo((rows) => [...(rows ?? []), { productId: "", qty: "1" }])}
            >
              상품 추가
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("nd-num text-nd-body", comboOk ? "text-nd-success" : "text-nd-fg-2")}>
                합계 <Money value={comboSum} unit={false} /> / 결제 <Money value={bucket.amount} unit={false} />
                {!comboOk && comboSum > 0 && comboSum !== bucket.amount
                  ? ` · ${Math.abs(bucket.amount - comboSum).toLocaleString("ko-KR")}원 ${comboSum < bucket.amount ? "모자람" : "넘침"}`
                  : ""}
              </span>
              <Button
                size="sm"
                icon={CheckCheck}
                loading={busy}
                disabled={!comboOk}
                onClick={() =>
                  onSplit(comboParts.map(({ productId, qty, amount }) => ({ productId, qty, amount })))
                }
              >
                {bucket.lines.length}건 조합 확정
              </Button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <NewProductDialog
          bucket={bucket}
          products={products}
          eventLabel={eventLabelOf(bucket.eventId, eventsById)}
          onClose={() => setCreating(false)}
          onCreated={(productId, qty) => {
            setCreating(false);
            onResolve(productId, qty);
          }}
        />
      )}

      {/* 대상 줄은 **한 건이라도 표로** 보여준다. 건수에 따라 카드 모양이
          달라지면 같은 종류의 카드가 다르게 읽히고, 1건짜리는 무엇을 확정하는
          것인지 확인할 자리가 아예 없어진다. */}
      <TableScroll maxHeight={180} className="mt-3">
        <Table minWidth={420} dense>
          <thead>
            <tr>
              <Th sticky="top">날짜</Th>
              <Th sticky="top">결제</Th>
              <Th sticky="top">이벤트</Th>
              <Th sticky="top" align="right">금액</Th>
            </tr>
          </thead>
          <tbody>
            {bucket.lines.map((l) => (
              <Tr key={l.id}>
                <Td className="nd-num whitespace-nowrap text-nd-fg-2">{l.date}</Td>
                <Td className="whitespace-nowrap text-nd-fg-2">{SOURCE_LABEL[l.route] ?? l.route}</Td>
                <Td className="text-nd-fg-2">{eventLabelOf(l.eventId, eventsById)}</Td>
                <Td num>
                  <Money value={l.amount} unit={false} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableNote className="pt-2">
        <span className="block">
          <b>근거 ({evidence.scope})</b>{" "}
          {topEvidence.length === 0
            ? "— 이 범위에서 확정된 상품이 아직 없습니다. 금액만으로는 짐작할 수 없으니 직접 확인해 주세요."
            : topEvidence
                .map((x) => `${x.p!.name} ${x.p!.option} ${x.rows}줄(수량 ${x.qty})`)
                .join(" · ")}
        </span>
        <span className="mt-1 block">
          {storeLabel(bucket.store)} 상품만 후보로 보여줍니다. 별칭을 추가하면 다음 적재부터 자동으로
          잡힙니다 —{" "}
          <Link href="/neander/sales/catalog" className="font-medium text-nd-accent-strong hover:underline">
            상품 관리에서 별칭 추가
          </Link>
        </span>
      </TableNote>
    </Card>
  );
}

// ============================================================
//  새 상품 만들기 — 이 묶음에서 바로
// ------------------------------------------------------------
//  행사마다 그 행사만의 품목이 나온다 (뉴진스4주년의 18,000원 품목처럼).
//  그럴 때 마스터 화면으로 건너가 코드를 짜고 돌아오게 만들면 아무도 안
//  쓴다. 그래서 지금 보고 있는 묶음에서 바로 만들고, 만든 상품으로 그
//  묶음을 곧바로 확정한다.
//
//  기본값은 **전용 이벤트**다. 일회성 품목을 매장 공용으로 넣으면 마스터가
//  일회성 SKU 로 차오르고, 다른 행사의 같은 금액이 그 상품으로 잘못 잡힌다.
//  공용으로 쓰려면 체크를 풀어야 한다 — 그 반대가 아니다.
//
//  ⚠️ 별칭은 **비워 둔다.** 별칭을 넣으면 다음 적재부터 그 문구가 자동으로
//     이 상품이 되는데, 「금액 입력」처럼 여러 뜻인 문구에 넣으면 금액 역산을
//     자동화하는 셈이다. 문구가 그 상품만을 가리킬 때에만 사람이 적는다.
// ============================================================

/** 같은 접두(IDI·IDE·WOW·ONL)에서 다음 빈 번호 */
function nextCode(products: SalesProduct[], prefix: string): string {
  const used = products
    .map((p) => p.id)
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

const PREFIX: Record<SalesStore, { event: string; regular: string }> = {
  id: { event: "IDE", regular: "IDI" },
  wow: { event: "WOW", regular: "WOW" },
  online: { event: "ONL", regular: "ONL" },
};

function NewProductDialog({
  bucket,
  products,
  eventLabel,
  onClose,
  onCreated,
}: {
  bucket: Bucket;
  products: SalesProduct[];
  eventLabel: string;
  onClose: () => void;
  /** 만든 뒤 그 상품으로 이 묶음을 확정한다 */
  onCreated: (productId: string, qty: number) => void;
}) {
  const toast = useToast();
  const { applyProducts } = useSales();
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // 전용 이벤트가 기본 — 이벤트 묶음일 때만 고를 수 있다
  const [dedicated, setDedicated] = useState(!!bucket.eventId);
  const kind: SalesKind = dedicated || bucket.eventId ? "event" : "regular";
  const [code, setCode] = useState(() =>
    nextCode(products, PREFIX[bucket.store][kind === "event" ? "event" : "regular"]),
  );
  const [name, setName] = useState("");
  const [option, setOption] = useState("기본");
  // 건당 금액을 단가로 본다 (수량 1). 단가를 고치면 수량이 따라 계산된다.
  const [price, setPrice] = useState(String(bucket.amount));
  const [material, setMaterial] = useState("");
  const [alias, setAlias] = useState("");

  const priceNum = Number(price) || 0;
  const qty = priceNum > 0 && bucket.amount % priceNum === 0 ? bucket.amount / priceNum : 0;
  const codeTaken = products.some((p) => p.id === code.trim());

  async function submit() {
    const id = code.trim();
    if (!id) return toast.error("상품코드가 필요합니다.");
    if (codeTaken) return toast.error(`${id} 는 이미 있는 코드입니다.`);
    if (!name.trim()) return toast.error("상품명이 필요합니다.");
    if (priceNum <= 0) return toast.error("판매가를 올바르게 입력하세요.");
    if (qty === 0) {
      return toast.error(
        `건당 ${bucket.amount.toLocaleString("ko-KR")}원이 판매가 ${priceNum.toLocaleString("ko-KR")}원으로 나눠지지 않습니다.`,
      );
    }
    setSaving(true);
    try {
      const product: SalesProduct = {
        id,
        store: bucket.store,
        kind,
        name: name.trim(),
        option: option.trim() || "기본",
        price: priceNum,
        material: Number(material) || 0,
        timeMin: 0,
        makeMin: 0,
        bottles: 1,
        ...(dedicated && bucket.eventId ? { eventIds: [bucket.eventId] } : {}),
        ...(alias.trim() ? { aliases: [alias.trim()] } : {}),
        note: dedicated && bucket.eventId ? `${eventLabel} 전용 — 검토 대기함에서 만듦` : "검토 대기함에서 만듦",
      };
      await upsertSalesProduct(product);
      // 확정 뒤 전체를 다시 받지 않으므로 새 상품을 목록에 직접 넣는다
      applyProducts({ upsert: [product] });
      toast.success(`${name.trim()} 을 만들었습니다.`);
      onCreated(id, qty);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "상품을 만들지 못했습니다.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="새 상품 만들기"
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            만들고 {bucket.lines.length}건 확정
          </Button>
        </>
      }
    >
      <InlineNotice tone="info" icon={Info} className="mb-3">
        건당 <b className="nd-num">{bucket.amount.toLocaleString("ko-KR")}원</b> ·{" "}
        {bucket.lines.length}건 · {storeLabel(bucket.store)} · {eventLabel}
        <br />
        원본 내역 「{bucket.raw}」
      </InlineNotice>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="상품명" required>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 뉴진스4주년 한정 세트"
          />
        </Field>
        <Field label="옵션" hint="용량·구성">
          <Input value={option} onChange={(e) => setOption(e.target.value)} placeholder="기본" />
        </Field>
        <Field
          label="판매가(원)"
          required
          hint={
            qty === 0
              ? "건당 금액이 이 값으로 나눠지지 않습니다"
              : `건당 ${bucket.amount.toLocaleString("ko-KR")}원 → 수량 ${qty}`
          }
          error={qty === 0 ? " " : undefined}
        >
          <Input
            inputMode="numeric"
            className="nd-num"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="재료비(원)" hint="모르면 비워 둡니다 — 공헌이익이 과대평가됩니다">
          <Input
            inputMode="numeric"
            className="nd-num"
            value={material}
            placeholder="0"
            onChange={(e) => setMaterial(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="상품코드" required error={codeTaken ? "이미 있는 코드입니다" : undefined}>
          <Input className="nd-num" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="POS 별칭" hint="비워 두는 것이 기본 — 아래 설명 참고">
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="(비움)" />
        </Field>
      </div>

      {bucket.eventId ? (
        <label className="mt-3 flex items-start gap-2">
          <Checkbox checked={dedicated} onChange={(e) => setDedicated(e.target.checked)} />
          <span className="text-nd-caption leading-relaxed text-nd-fg-2">
            <b className="text-nd-fg">{eventLabel} 전용으로 만듭니다.</b> 이 행사의 판매에만 후보로
            뜨고, 다른 행사의 같은 금액을 가져가지 않습니다. 체크를 풀면{" "}
            {storeLabel(bucket.store)} 매장 전체에서 쓰는 상품이 됩니다.
          </span>
        </label>
      ) : (
        <p className="mt-3 text-nd-caption text-nd-fg-3">
          이 묶음은 상시 판매라 전용 이벤트를 지정할 수 없습니다 —{" "}
          {storeLabel(bucket.store)} 매장 전체 상품으로 만들어집니다.
        </p>
      )}

      <p className="mt-3 text-nd-caption leading-relaxed text-nd-fg-3">
        <b>별칭을 비워 두는 이유:</b> 별칭을 넣으면 다음 적재부터 그 문구가 자동으로 이 상품이
        됩니다. 「금액 입력」처럼 여러 뜻인 문구에 넣으면 금액 역산을 자동화하는 셈입니다 — 문구가
        이 상품만을 가리킬 때에만 적으세요. 유형은 <b>{kindLabel(kind)}</b>, 매장은{" "}
        <b>{storeLabel(bucket.store)}</b> 로 고정됩니다 (묶음에서 정해집니다).
      </p>
    </Dialog>
  );
}
