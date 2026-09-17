import "server-only";

// ============================================================
//  동기화 엔진 — 사이트에서 끌어와 우리 것으로 만든다
// ------------------------------------------------------------
//  두 사이트가 같은 엔진을 쓴다. 다른 것은 "받은 줄을 무엇으로 바꾸나"
//  뿐이라, 그 부분만 갈라 둔다 (syncOnline · syncSmoat).
//
//  ── 지키는 것 ────────────────────────────────────────────
//  ① 멱등 — 문서 id 가 사이트의 id 로 정해진다. 같은 것을 두 번 받아도
//     문서는 하나다. 바뀐 것이 없으면 쓰지도 않는다.
//
//  ② 한 번에 하나 — 신호와 주기 실행이 겹치면 늦게 읽은 쪽이 먼저 읽은
//     옛 값으로 되쓸 수 있다 (결제됨을 읽은 실행이, 취소를 읽고 지운 실행
//     뒤에 줄을 되살린다). 사이트마다 **임대(lease)**를 잡고 돈다. 잡혀
//     있으면 이번 실행은 건너뛰되 「한 번 더」 표시를 남긴다 — 도는 실행이
//     이미 피드를 읽은 뒤라면 그 사이 결제를 못 봤기 때문이다. 도는 쪽이
//     끝나면 표시를 보고 한 번 더 돈다.
//
//  ③ 사람이 이긴다 — 사람이 고친 줄(updatedBy 가 사람)과 **사람이 지운 줄**
//     (휴지통에 deletedBy 가 사람)은 건드리지 않는다. 대기함에서 판단한
//     것을 기계가 조용히 되돌리면, 그 사람은 다시는 이 화면을 믿지 않는다.
//
//  ④ 잃지 않는다 — 적재하지 못한 주문·어긋난 줄은 **풀릴 때까지** 따로
//     남긴다 (neander_sync_issues). 실행 결과에만 적으면 다음 실행이 덮어
//     사라지고, 커서는 이미 지나가 그 주문은 다시 오지 않는다.
//
//  ⑤ 커서는 성공한 실행만 민다 — 실패하면 커서를 그대로 두어 다음 실행이
//     같은 자리에서 다시 받는다. 커서는 (수정 시각, id) 짝이라 같은 ms 에
//     바뀐 줄이 아무리 많아도 늘 앞으로 간다 (contract.ts FeedEnvelope).
//
//  ⑥ 사람의 설정을 덮지 않는다 — 실행 결과는 커서·마지막 결과만 쓴다.
//     도는 동안 사람이 「멈춤」이나 시작일을 바꿔도 그대로 남는다.
// ============================================================

import { FieldPath, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { moveToTrash } from "@/lib/neander/server/trash";
import { dateStrKST } from "@/lib/neander/format";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import type {
  SalesAssumptions,
  SalesEvent,
  SalesLine,
  SalesProduct,
} from "@/lib/neander/sales/types";
import type { ResolveContext } from "@/lib/neander/sales/resolve";
import { parseSmoatPayMethod, type SmoatSale } from "@/lib/neander/smoat/types";
import {
  type FeedEnvelope,
  type FeedSource,
  type OnlineOrderRow,
  type SmoatFeedEnvelope,
  type SmoatSaleRow,
} from "../contract";
import { mapOnlineOrder, onlineLinePrefix, SYNC_ACTOR } from "../online";
import {
  DEFAULT_ONLINE_START,
  EMPTY_RUN,
  type SyncIssue,
  type SyncNote,
  type SyncRun,
  type SyncState,
  type SyncTrigger,
} from "../types";
import { callFeed, feedConfigured, feedSetupHint, FeedError } from "./feed";

const BATCH_LIMIT = 400;
const PAGE_SIZE = 300;
/** 기간 모드(과거 달)는 품목까지 읽어 무겁다 — 쪽을 작게 */
const WINDOW_PAGE_SIZE = 200;
/** 한 번 실행에 부를 수 있는 최대 페이지 — 폭주 방지 */
const MAX_PAGES = 20;
/** 신호가 겹쳐 「한 번 더」가 이어질 때 한 번의 부름이 도는 최대 차례 */
const MAX_ROUNDS = 3;
/** 지운 주문 찾기 — ids 모드 한 번에 물을 주문 수 (사이트의 MAX_IDS) */
const RECONCILE_CHUNK = 100;
/** 임대 길이 — 이보다 오래 도는 실행은 없다 (라우트 maxDuration 300초) */
const LEASE_MS = 5 * 60 * 1000;

export interface SyncOptions {
  trigger: SyncTrigger;
  by?: string;
  /** 커서를 무시하고 이 기간을 통째로 다시 받는다 (온라인만) */
  window?: { from: string; to: string };
  /**
   * 사이트에서 **지워진** 주문도 찾는다 (온라인만). 지운 주문은 증분에 다시
   * 오지 않아 ERP 에 줄이 남는다. 가진 주문 id 를 모두 되물으므로 무겁다 —
   * 주기 실행·사람의 「지금 동기화」·주문 삭제 신호에서만 켠다.
   */
  reconcile?: boolean;
}

/** Firestore 는 undefined 를 거부한다 */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

// ============================================================
//  상태 문서 · 임대
// ============================================================

export async function readSyncState(db: Firestore, source: FeedSource): Promise<SyncState> {
  const snap = await db.collection(NEANDER_COL.syncState).doc(source).get();
  const base: SyncState = {
    id: source,
    cursor: 0,
    ...(source === "acscent-online" ? { startFrom: DEFAULT_ONLINE_START } : {}),
  };
  return snap.exists ? ({ ...base, ...snap.data(), id: source } as SyncState) : base;
}

export async function readAllSyncStates(db: Firestore): Promise<SyncState[]> {
  const sources: FeedSource[] = ["acscent-online", "smoat"];
  return Promise.all(sources.map((s) => readSyncState(db, s)));
}

/**
 * 임대를 잡는다. 이미 누가 잡고 있으면(만료 전) 「한 번 더」 표시만 남기고 false.
 * 트랜잭션이라 신호와 주기 실행이 동시에 와도 한쪽만 잡는다.
 */
async function acquireLease(
  db: Firestore,
  source: FeedSource,
  now: number,
  reconcile: boolean,
): Promise<boolean> {
  const ref = db.collection(NEANDER_COL.syncState).doc(source);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const until = Number(snap.data()?.leaseUntil ?? 0);
    if (until > now) {
      tx.set(
        ref,
        { rerunRequested: true, ...(reconcile ? { rerunReconcile: true } : {}) },
        { merge: true },
      );
      return false;
    }
    tx.set(ref, { leaseUntil: now + LEASE_MS, rerunRequested: false, rerunReconcile: false }, { merge: true });
    return true;
  });
}

/** 상태 문서에 남기는 결과 — 주의할 것 스무 줄까지만 */
function trimRun(run: SyncRun): SyncRun {
  const warn = run.notes.filter((n) => n.level === "warn");
  const info = run.notes.filter((n) => n.level === "info");
  const notes: SyncNote[] = [...warn, ...info].slice(0, 20);
  if (run.notes.length > notes.length) {
    notes.push({
      key: "…",
      note: `그 밖에 ${run.notes.length - notes.length}건 더 있습니다.`,
      level: "info",
    });
  }
  // Firestore 는 undefined 를 거부한다 — 선택 필드는 값이 있을 때만 싣는다
  return clean({ ...run, notes }) as unknown as SyncRun;
}

/** 실행이 끝난 자리 */
interface RunCursor {
  /** 화면 표시용 시각 (ms) */
  cursor: number;
  /** 사이트에 돌려줄 열쇠 */
  cursorKey: string;
}

/**
 * 실행 결과를 남긴다.
 *
 * 「한 번 더」 표시가 있으면 임대를 **쥔 채로** 표시를 지우고 rerun 을 돌려준다
 * — 풀었다가 다시 잡는 사이에 다른 실행이 끼어들지 않게. 마지막 차례(last)
 * 에는 표시를 **남긴 채** 푼다: 다음 신호나 주기 실행이 이어받는다.
 */
async function finishRun(
  db: Firestore,
  source: FeedSource,
  run: SyncRun,
  at: RunCursor | null,
  last: boolean,
): Promise<{ rerun: boolean; reconcile: boolean }> {
  const ref = db.collection(NEANDER_COL.syncState).doc(source);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const requested = !!data.rerunRequested;
    const rerun = requested && !last;
    const patch: Record<string, unknown> = {
      lastRunAt: run.at,
      lastRun: trimRun(run),
      leaseUntil: rerun ? Date.now() + LEASE_MS : 0,
    };
    if (rerun) {
      patch.rerunRequested = false;
      patch.rerunReconcile = false;
    }
    // 임대가 한 번에 하나만 돌게 하므로 받은 커서가 곧 가장 뒤다. 그래도
    // 커서 시각이 뒤로 가는 쓰기는 막는다.
    if (run.ok) {
      patch.lastOkAt = run.at;
      if (at && at.cursorKey && at.cursor >= Number(data.cursor ?? 0)) {
        patch.cursor = at.cursor;
        patch.cursorKey = at.cursorKey;
      }
    }
    tx.set(ref, patch, { merge: true });
    return { rerun, reconcile: rerun && !!data.rerunReconcile };
  });
}

// ============================================================
//  풀릴 때까지 남기는 것 (neander_sync_issues)
// ============================================================

const issueId = (source: FeedSource, key: string) =>
  `${source}_${key}`.replace(/\//g, "／").slice(0, 400);

/** 한 배치에 쓰기를 모아 두다 한도에 닿으면 내보낸다 */
class Batcher {
  private batch: WriteBatch;
  private ops = 0;
  constructor(private readonly db: Firestore) {
    this.batch = db.batch();
  }
  async use(fn: (b: WriteBatch) => void): Promise<void> {
    fn(this.batch);
    this.ops += 1;
    if (this.ops >= BATCH_LIMIT) await this.flush();
  }
  async flush(): Promise<void> {
    if (this.ops === 0) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.ops = 0;
  }
}

/** 한 실행이 들고 다니는 것 */
interface RunContext {
  db: Firestore;
  source: FeedSource;
  run: SyncRun;
  now: number;
  issues: Batcher;
  /**
   * 이 실행이 시작할 때 열려 있던 issue id. 풀 것이 있을 때만 지운다 —
   * 없는 문서를 지우는 것도 Firestore 는 쓰기로 세고, 받는 줄마다 보내면
   * 하루 수백 번의 쓸데없는 쓰기가 된다.
   */
  openIssues: Set<string>;
}

async function newRunContext(db: Firestore, source: FeedSource, run: SyncRun): Promise<RunContext> {
  const snap = await db.collection(NEANDER_COL.syncIssues).where("source", "==", source).select().get();
  return {
    db,
    source,
    run,
    now: Date.now(),
    issues: new Batcher(db),
    openIssues: new Set(snap.docs.map((d) => d.id)),
  };
}

async function putIssue(
  rc: RunContext,
  key: string,
  issue: Omit<SyncIssue, "id" | "source" | "at">,
): Promise<void> {
  const id = issueId(rc.source, key);
  rc.openIssues.add(id);
  await rc.issues.use((b) =>
    b.set(rc.db.collection(NEANDER_COL.syncIssues).doc(id), clean({ ...issue, source: rc.source, at: rc.now })),
  );
}

async function resolveIssue(rc: RunContext, key: string): Promise<void> {
  const id = issueId(rc.source, key);
  if (!rc.openIssues.has(id)) return;
  rc.openIssues.delete(id);
  await rc.issues.use((b) => b.delete(rc.db.collection(NEANDER_COL.syncIssues).doc(id)));
}

export async function readSyncIssues(db: Firestore): Promise<SyncIssue[]> {
  const snap = await db.collection(NEANDER_COL.syncIssues).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as SyncIssue)
    .sort((a, b) => b.at - a.at);
}

/** 사람이 확인한 것을 지운다 (화면의 「확인」) */
export async function dismissSyncIssue(db: Firestore, id: string): Promise<void> {
  await db.collection(NEANDER_COL.syncIssues).doc(id).delete();
}

// ============================================================
//  ① 온라인 (acscent.co.kr) → 판매 줄
// ============================================================

/** 사람이 고친 줄인가 — 동기화가 마지막 주인이 아니면 사람 것이다 */
const humanOwned = (doc: Record<string, unknown> | undefined) =>
  !!doc && doc.updatedBy !== undefined && doc.updatedBy !== SYNC_ACTOR;

async function loadSalesContext(db: Firestore): Promise<ResolveContext> {
  const [products, events, assumptions] = await Promise.all([
    db.collection(NEANDER_COL.salesProducts).get(),
    db.collection(NEANDER_COL.salesEvents).get(),
    db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
  ]);
  return {
    products: products.docs.map((d) => ({ id: d.id, ...d.data() }) as SalesProduct),
    // 이벤트는 **최근 시작순**으로 — 이벤트 저장 뒤 다시 붙이기(attach.ts)와 같은
    // 순서여야 기간이 겹칠 때 해석기(resolve.ts)와 귀속이 같은 이벤트를 고른다
    events: events.docs
      .map((d) => ({ id: d.id, ...d.data() }) as SalesEvent)
      .sort((a, b) => String(b.from).localeCompare(String(a.from))),
    store: "online",
    route: "online",
    assumptions: (assumptions.exists
      ? { id: "current", ...assumptions.data() }
      : SEED_ASSUMPTIONS) as SalesAssumptions,
  };
}

/**
 * 상품 마스터에 자사몰 상품 키가 등록돼 있는가.
 *
 * 키(`image_analysis/50ml` 꼴)는 상품의 별칭으로 들어간다 (master-data.ts).
 * 마스터를 옛 판으로 두면 **모든 주문이 조용히 검토 대기함으로 간다** —
 * 동기화는 멀쩡히 성공했다고 말하면서 확정 매출이 0 이 되는 상태다.
 */
function warnIfNoSiteKeys(ctx: ResolveContext, run: SyncRun): void {
  const has = ctx.products.some(
    (p) => p.store === "online" && (p.aliases ?? []).some((a) => a.includes("/")),
  );
  if (has) return;
  run.notes.push({
    key: "상품 마스터",
    note:
      "온라인 상품에 자사몰 상품 키(별칭)가 없습니다. 이대로면 모든 주문이 검토 대기함으로 갑니다. " +
      "`npm run sync:site-keys -- --apply` 로 키를 더하세요. 「마스터 적재」는 화면에서 고친 판매가·재료비를 덮어쓰니 쓰지 마세요.",
    level: "warn",
  });
}

/** 문서 id 앞부분으로 줄을 모은다 — 그 주문이 만든 줄만 정확히 집는다 */
async function linesWithPrefix(
  db: Firestore,
  prefix: string,
): Promise<Map<string, Record<string, unknown>>> {
  const snap = await db
    .collection(NEANDER_COL.salesLines)
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}`)
    .get();
  return new Map(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
}

/**
 * 동기화가 쓰는 필드가 지금 문서와 같은가 — 같으면 쓰지 않는다.
 * 만든·고친·맞춘 시각은 비교하지 않는다 (매번 달라서).
 */
const LINE_KEYS = [
  "date", "store", "route", "amount", "qty", "status", "reason", "productId", "raw",
  "memo", "eventId", "payMethod", "shippingFee", "syncSource", "syncOrderId",
] as const;

function sameLine(next: Record<string, unknown>, cur: Record<string, unknown> | undefined): boolean {
  if (!cur) return false;
  for (const k of LINE_KEYS) {
    if ((next[k] ?? null) !== (cur[k] ?? null)) return false;
  }
  const a = next.discount as { list?: number; rate?: number } | undefined;
  const b = cur.discount as { list?: number; rate?: number } | null | undefined;
  if (!a !== !b) return false;
  if (a && b && (a.list !== b.list || a.rate !== b.rate)) return false;
  return true;
}

/**
 * 매출이 아니게 된(취소·전액환불·삭제) 주문의 줄을 치운다.
 * 동기화가 만든 줄만 휴지통으로 — 사람이 고친 줄은 두고 알린다.
 */
async function dropOrderLines(
  rc: RunContext,
  orderId: string,
  key: string,
  why: string,
): Promise<void> {
  const docs = await linesWithPrefix(rc.db, onlineLinePrefix(orderId));
  if (docs.size === 0) return;
  const mine: string[] = [];
  for (const [id, doc] of docs) {
    if (humanOwned(doc)) {
      rc.run.skipped += 1;
      const note = `${why} 주문인데 사람이 고친 줄이라 지우지 않았습니다. 검토 대기함에서 확인하세요.`;
      rc.run.notes.push({ key, note, level: "warn" });
      await putIssue(rc, id, { key, note, kind: "conflict" });
    } else {
      mine.push(id);
    }
  }
  if (mine.length > 0) {
    await moveToTrash(rc.db, NEANDER_COL.salesLines, NEANDER_COL.salesTrash, mine, SYNC_ACTOR, rc.now);
    rc.run.deleted += mine.length;
  }
}

async function applyOnlinePage(
  rc: RunContext,
  orders: OnlineOrderRow[],
  ctx: ResolveContext,
  startFrom: string | undefined,
): Promise<void> {
  const { db, run, now } = rc;
  const col = db.collection(NEANDER_COL.salesLines);
  const trashCol = db.collection(NEANDER_COL.salesTrash);

  const wanted: { order: OnlineOrderRow; lines: (SalesLine & { id: string })[] }[] = [];
  const dropOrders: OnlineOrderRow[] = [];

  for (const order of orders) {
    // 시작일 앞의 주문은 손대지 않는다 — 그 구간은 엑셀이 정본이다
    const at = Date.parse(order.paidAt ?? order.createdAt);
    const date = Number.isFinite(at) ? dateStrKST(at) : "";
    if (startFrom && date && date < startFrom) continue;

    const mapped = mapOnlineOrder(order, ctx, now);
    const key = order.orderNumber || order.id;

    if (mapped.drop) {
      dropOrders.push(order);
      if (mapped.note) run.notes.push({ key, note: mapped.note, level: "info" });
      await resolveIssue(rc, order.id);
      continue;
    }

    if (mapped.lines.length === 0) {
      // 적재하지 못했다 — 풀릴 때까지 남긴다 (위 ④)
      const note = mapped.note ?? "적재하지 못했습니다";
      run.notes.push({ key, note, level: "warn" });
      await putIssue(rc, order.id, { key, note, kind: "not_loaded", ...(date ? { date } : {}) });
      continue;
    }

    await resolveIssue(rc, order.id);
    if (mapped.note) run.notes.push({ key, note: mapped.note, level: "info" });
    wanted.push({ order, lines: mapped.lines as (SalesLine & { id: string })[] });
  }

  const upserts = wanted.flatMap((w) => w.lines);

  // ---- 지금 있는 것 · 사람이 지운 것 ------------------------------
  const existing = new Map<string, Record<string, unknown>>();
  const humanDeleted = new Set<string>();
  for (let i = 0; i < upserts.length; i += 200) {
    const slice = upserts.slice(i, i + 200).map((l) => l.id);
    const [live, trash] = await Promise.all([
      db.getAll(...slice.map((id) => col.doc(id))),
      db.getAll(...slice.map((id) => trashCol.doc(id))),
    ]);
    live.forEach((s) => {
      if (s.exists) existing.set(s.id, s.data() as Record<string, unknown>);
    });
    trash.forEach((s) => {
      // 사람이 지운 줄은 되살리지 않는다. 동기화가 지운 줄(취소됐다가 되살아난
      // 주문 등)은 다시 만들어도 된다.
      if (s.exists && !existing.has(s.id) && s.data()?.deletedBy !== SYNC_ACTOR) {
        humanDeleted.add(s.id);
      }
    });
  }

  // ---- 덮어쓰기 ------------------------------------------------
  const writable: (SalesLine & { id: string })[] = [];
  for (const l of upserts) {
    if (humanDeleted.has(l.id)) {
      run.skipped += 1;
      // 사람이 지웠으면 그 줄에 걸려 있던 어긋남도 끝났다
      await resolveIssue(rc, l.id);
      continue;
    }
    const cur = existing.get(l.id);
    if (humanOwned(cur)) {
      run.skipped += 1;
      const key = String(l.memo ?? l.id);
      if (Number(cur?.amount) !== l.amount) {
        const note = `사람이 고친 줄이라 두었습니다. 사이트 금액 ${l.amount.toLocaleString("ko-KR")}원 · ERP ${Number(cur?.amount ?? 0).toLocaleString("ko-KR")}원`;
        run.notes.push({ key, note, level: "warn" });
        await putIssue(rc, l.id, { key, note, kind: "conflict", date: l.date });
      } else {
        await resolveIssue(rc, l.id);
      }
      continue;
    }
    if (sameLine(l as unknown as Record<string, unknown>, cur)) continue;
    writable.push(l);
  }

  for (let i = 0; i < writable.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    writable.slice(i, i + BATCH_LIMIT).forEach((l) => {
      const { id, ...rest } = l;
      const isNew = !existing.has(id);
      if (isNew) run.created += 1;
      else run.updated += 1;
      if (rest.status === "needs_review") run.needsReview += 1;
      batch.set(
        col.doc(id),
        clean({
          ...rest,
          // 새 줄이 아니면 만든 시각은 그대로 둔다
          createdAt: isNew ? now : (existing.get(id)?.createdAt ?? now),
          updatedAt: now,
          updatedBy: SYNC_ACTOR,
        }),
      );
    });
    await batch.commit();
  }

  // ---- 남은 옛 줄 정리 (품목 구성이 바뀐 주문) ---------------------
  // 새 줄만 덮으면 옛 품목의 줄이 남아 매출이 두 번 잡힌다. 줄이 이미 있던
  // 주문만 본다 — 처음 들어온 주문에 옛 줄은 없다. (acscent 는 결제 뒤에 품목을
  // 바꾸지 않으므로 드문 경우지만, 품목 없는 옛 주문의 합성 줄이 진짜 품목 줄로
  // 바뀌는 길은 막아 둔다.)
  const seen = wanted.filter((w) => w.lines.some((l) => existing.has(l.id) || humanDeleted.has(l.id)));
  const stale: string[] = [];
  for (let i = 0; i < seen.length; i += 20) {
    const chunk = seen.slice(i, i + 20);
    const found = await Promise.all(chunk.map((w) => linesWithPrefix(db, onlineLinePrefix(w.order.id))));
    found.forEach((docs, j) => {
      const keep = new Set(chunk[j].lines.map((l) => l.id));
      docs.forEach((doc, id) => {
        if (!keep.has(id) && !humanOwned(doc)) stale.push(id);
      });
    });
  }
  if (stale.length > 0) {
    await moveToTrash(db, NEANDER_COL.salesLines, NEANDER_COL.salesTrash, stale, SYNC_ACTOR, now);
    run.deleted += stale.length;
  }

  // ---- 지우기 (매출이 아니게 된 주문) ---------------------------
  for (const order of dropOrders) {
    await dropOrderLines(rc, order.id, order.orderNumber || order.id, "매출이 아니게 된(취소·전액환불)");
  }
}

/**
 * 사이트에서 **지워진** 주문 찾기.
 *
 * 관리자 화면에서 주문을 지우면 그 주문은 피드에 다시 나타나지 않는다 —
 * 바뀐 것이 아니라 없어졌으니까. 그래서 ERP 가 가진 주문 id 를 모아 사이트에
 * "아직 있나"를 되묻고(ids 모드), 돌아오지 않은 주문의 줄을 치운다.
 * 돌아온 주문은 그대로 다시 맞춘다 (바뀐 것이 없으면 쓰지 않는다).
 */
async function reconcileOnline(
  rc: RunContext,
  ctx: ResolveContext,
  startFrom: string | undefined,
): Promise<void> {
  const snap = await rc.db
    .collection(NEANDER_COL.salesLines)
    .where("syncSource", "==", "acscent-online")
    .select("syncOrderId", "memo")
    .get();
  const keyOf = new Map<string, string>();
  snap.docs.forEach((d) => {
    const orderId = String(d.get("syncOrderId") ?? "");
    if (orderId && !keyOf.has(orderId)) keyOf.set(orderId, String(d.get("memo") ?? orderId));
  });
  const ids = [...keyOf.keys()];
  let gone = 0;

  for (let i = 0; i < ids.length; i += RECONCILE_CHUNK) {
    const chunk = ids.slice(i, i + RECONCILE_CHUNK);
    const res = await callFeed<FeedEnvelope<OnlineOrderRow>>("acscent-online", { ids: chunk.join(",") });
    rc.run.pages += 1;
    const back = new Set(res.rows.map((r) => r.id));
    await applyOnlinePage(rc, res.rows, ctx, startFrom);
    for (const id of chunk) {
      if (back.has(id)) continue;
      gone += 1;
      await dropOrderLines(rc, id, keyOf.get(id) ?? id, "사이트에서 지워진");
    }
  }
  if (gone > 0) {
    rc.run.notes.push({
      key: "지운 주문",
      note: `사이트에서 지워진 주문 ${gone}건의 매출 줄을 치웠습니다 (휴지통에서 되돌릴 수 있습니다).`,
      level: "info",
    });
  }
}

async function syncOnline(
  rc: RunContext,
  state: SyncState,
  opts: SyncOptions,
): Promise<RunCursor | null> {
  const ctx = await loadSalesContext(rc.db);
  warnIfNoSiteKeys(ctx, rc.run);

  if (opts.window) {
    // 기간 모드 — 커서를 옮기지 않는다 (null). 그 기간을 통째로 다시 맞춘다.
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await callFeed<FeedEnvelope<OnlineOrderRow>>("acscent-online", {
        from: opts.window.from,
        to: opts.window.to,
        offset,
        limit: WINDOW_PAGE_SIZE,
      });
      rc.run.pages += 1;
      rc.run.fetched += res.rows.length;
      await applyOnlinePage(rc, res.rows, ctx, state.startFrom);
      if (res.complete) return null;
      offset += res.rows.length;
    }
    rc.run.notes.push({
      key: "기간",
      note: `한 번에 ${MAX_PAGES * WINDOW_PAGE_SIZE}건까지만 받습니다. 기간을 좁혀 다시 실행하세요.`,
      level: "warn",
    });
    return null;
  }

  let key = state.cursorKey ?? "";
  let at = state.cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await callFeed<FeedEnvelope<OnlineOrderRow>>("acscent-online", {
      after: key || undefined,
      limit: PAGE_SIZE,
    });
    rc.run.pages += 1;
    rc.run.fetched += page.rows.length;
    if (page.rows.length > 0) await applyOnlinePage(rc, page.rows, ctx, state.startFrom);

    // 줄을 받았는데 열쇠가 그대로면 사이트의 커서가 고장 났다 — 같은 쪽만
    // 되풀이하게 되므로 멈추고 알린다 (짝 커서라 정상이면 일어나지 않는다)
    if (!page.complete && page.cursorKey === key) {
      throw new FeedError("acscent-online", "피드의 커서가 앞으로 가지 않습니다. 사이트의 피드 라우트를 확인하세요.");
    }
    if (page.cursorKey) {
      key = page.cursorKey;
      at = Math.max(at, page.cursor);
    }
    if (page.complete) break;
    if (i === MAX_PAGES - 1) {
      rc.run.notes.push({
        key: "페이지",
        note: `한 번에 ${MAX_PAGES}쪽까지만 받습니다. 남은 것은 다음 실행이 이어 받습니다.`,
        level: "info",
      });
    }
  }

  if (opts.reconcile) await reconcileOnline(rc, ctx, state.startFrom);
  return key ? { cursor: at, cursorKey: key } : null;
}

// ============================================================
//  ② SMOAT (smoat.co.kr) → SMOAT 결제·원가
// ============================================================

function toSmoatSale(row: SmoatSaleRow, now: number): SmoatSale | null {
  const at = row.paidAt ? Date.parse(row.paidAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const sale: SmoatSale = {
    id: `${row.kind}_${row.id}`,
    kind: row.kind,
    date: dateStrKST(at),
    gross: row.amount,
    refund: row.refundAmount,
    amount: Math.max(0, row.amount - row.refundAmount),
    status: row.status,
    accountId: row.accountId,
    accountName: row.accountName,
    syncedAt: now,
    updatedAt: now,
  };
  const method = parseSmoatPayMethod(row.paymentMethod);
  if (method) sale.payMethod = method;
  if (row.packLabel) sale.packLabel = row.packLabel;
  if (row.credits !== undefined) sale.credits = row.credits;
  if (row.planTier) sale.planTier = row.planTier;
  if (row.pgTxId) sale.pgTxId = row.pgTxId;
  return sale;
}

const SALE_KEYS = [
  "kind", "date", "gross", "refund", "amount", "status", "payMethod", "accountId",
  "accountName", "packLabel", "credits", "planTier", "pgTxId",
] as const;

function sameSale(next: SmoatSale, cur: Record<string, unknown> | undefined): boolean {
  if (!cur) return false;
  const n = next as unknown as Record<string, unknown>;
  return SALE_KEYS.every((k) => (n[k] ?? null) === (cur[k] ?? null));
}

/** 결제 줄을 넣고 매출이 아닌 것은 지운다. 매출로 남은 id 를 돌려준다 */
async function applySmoatRows(rc: RunContext, rows: SmoatSaleRow[]): Promise<Set<string>> {
  const { db, run, now } = rc;
  const salesCol = db.collection(NEANDER_COL.smoatSales);
  const keep: SmoatSale[] = [];
  const drop: string[] = [];

  for (const row of rows) {
    const id = `${row.kind}_${row.id}`;
    const key = row.accountName || id;
    if (!row.revenue) {
      drop.push(id);
      await resolveIssue(rc, id);
      continue;
    }
    const sale = toSmoatSale(row, now);
    if (sale) {
      keep.push(sale);
      await resolveIssue(rc, id);
    } else {
      const note = "결제 확정 시각이 없어 넣지 않았습니다.";
      run.notes.push({ key, note, level: "warn" });
      await putIssue(rc, id, { key, note, kind: "not_loaded" });
    }
  }

  // ---- 넣기 (바뀐 것만) -----------------------------------------
  const current = new Map<string, Record<string, unknown>>();
  for (let j = 0; j < keep.length; j += 200) {
    const snaps = await db.getAll(...keep.slice(j, j + 200).map((s) => salesCol.doc(s.id)));
    snaps.forEach((s) => {
      if (s.exists) current.set(s.id, s.data() as Record<string, unknown>);
    });
  }
  const changed = keep.filter((s) => !sameSale(s, current.get(s.id)));
  for (let j = 0; j < changed.length; j += BATCH_LIMIT) {
    const batch = db.batch();
    changed.slice(j, j + BATCH_LIMIT).forEach((s) => {
      const { id, ...rest } = s;
      if (current.has(id)) run.updated += 1;
      else run.created += 1;
      batch.set(salesCol.doc(id), clean(rest as unknown as Record<string, unknown>));
    });
    await batch.commit();
  }

  // ---- 빼기 (매출이 아니게 된 것) ---------------------------------
  // SMOAT 줄에는 사람이 고칠 것이 없다(해석도 확정도 없다) — 휴지통을 거치지 않는다
  for (let j = 0; j < drop.length; j += 200) {
    const slice = drop.slice(j, j + 200);
    const snaps = await db.getAll(...slice.map((id) => salesCol.doc(id)));
    const gone = snaps.filter((s) => s.exists);
    if (gone.length === 0) continue;
    const batch = db.batch();
    gone.forEach((s) => {
      batch.delete(salesCol.doc(s.id));
      const row = rows.find((r) => `${r.kind}_${r.id}` === s.id);
      if (row && (row.excluded === "refunded" || row.excluded === "cancelled")) {
        run.notes.push({
          key: row.accountName || s.id,
          note: `${row.excluded === "refunded" ? "환불" : "취소"} — ${row.amount.toLocaleString("ko-KR")}원을 뺐습니다`,
          level: "info",
        });
      }
    });
    await batch.commit();
    run.deleted += gone.length;
  }

  return new Set(keep.map((s) => s.id));
}

async function syncSmoat(rc: RunContext, state: SyncState): Promise<RunCursor | null> {
  const { db, run, now } = rc;
  const salesCol = db.collection(NEANDER_COL.smoatSales);
  const costCol = db.collection(NEANDER_COL.smoatCosts);
  let key = state.cursorKey ?? "";
  let at = state.cursor;
  let depositsDone = false;

  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await callFeed<SmoatFeedEnvelope>("smoat", {
      after: key || undefined,
      limit: PAGE_SIZE,
    });
    run.pages += 1;
    const { sales, costs, deposits, depositsComplete } = page.payload;
    run.fetched += sales.length;

    await applySmoatRows(rc, sales);

    // ---- 무통장 — 통째로 받은 것으로 맞춘다 (실행마다 한 번) ------------
    // 충전에 연결되거나 무시로 바뀐 수기 지급은 revenue=false 로 오거나 아예
    // 오지 않는다. 여기 없는 deposit_ 줄을 지워야 같은 돈이 충전 줄로 한 번
    // 더 잡히지 않는다. 한도에 닿아 전부가 아니면 지우지 않는다.
    if (!depositsDone) {
      depositsDone = true;
      const kept = await applySmoatRows(rc, deposits ?? []);
      if (depositsComplete) {
        const existing = await salesCol
          .orderBy(FieldPath.documentId())
          .startAt("deposit_")
          .endAt("deposit_")
          .select()
          .get();
        const gone = existing.docs.map((d) => d.id).filter((id) => !kept.has(id));
        for (let j = 0; j < gone.length; j += BATCH_LIMIT) {
          const batch = db.batch();
          gone.slice(j, j + BATCH_LIMIT).forEach((id) => batch.delete(salesCol.doc(id)));
          await batch.commit();
        }
        if (gone.length > 0) {
          run.deleted += gone.length;
          run.notes.push({
            key: "무통장",
            note: `충전에 연결됐거나 무시된 수기 지급 ${gone.length}건을 뺐습니다.`,
            level: "info",
          });
        }
      } else {
        run.notes.push({
          key: "무통장",
          note: "무통장 알림이 한도를 넘어 전부 받지 못했습니다. 없어진 수기 지급을 지우지 않았습니다.",
          level: "warn",
        });
      }
    }

    // ---- 월별 원가 (작아서 늘 통째로 덮는다) ---------------------
    if (costs.length > 0) {
      const batch = db.batch();
      costs.forEach((c) => {
        batch.set(
          costCol.doc(c.month),
          clean({
            aiUsd: c.aiUsd,
            aiKrw: c.aiKrw,
            fxRate: c.fxRate,
            creditsSold: c.creditsSold,
            creditsUsed: c.creditsUsed,
            syncedAt: now,
          }),
        );
      });
      await batch.commit();
    }

    if (!page.complete && page.cursorKey === key) {
      throw new FeedError("smoat", "피드의 커서가 앞으로 가지 않습니다. 사이트의 피드 라우트를 확인하세요.");
    }
    if (page.cursorKey) {
      key = page.cursorKey;
      at = Math.max(at, page.cursor);
    }
    if (page.complete) break;
  }
  return key ? { cursor: at, cursorKey: key } : null;
}

// ============================================================
//  바깥에서 부르는 문
// ============================================================

/**
 * 한 사이트를 동기화한다.
 *
 * 실패해도 던지지 않는다 — 결과 문서에 실패로 남기고 화면이 그것을 읽는다.
 * 자동으로 도는 일은 예외로 사라지면 안 된다.
 *
 * 도는 사이 신호가 또 오면(「한 번 더」) 임대를 쥔 채로 최대 MAX_ROUNDS 차례까지
 * 이어 돈다. 돌려주는 결과는 마지막 차례의 것이고, 새로 생기고 고쳐지고
 * 지워진 수는 모든 차례를 더한 값이다.
 */
export async function runSync(
  db: Firestore,
  source: FeedSource,
  opts: SyncOptions,
): Promise<SyncRun> {
  const started = Date.now();
  const skipRun = EMPTY_RUN(source, opts.trigger);
  if (opts.by) skipRun.by = opts.by;

  if (!feedConfigured(source)) {
    skipRun.error = feedSetupHint(source);
    skipRun.durationMs = Date.now() - started;
    return skipRun;
  }

  const first = await readSyncState(db, source);
  if (first.paused && opts.trigger !== "manual") {
    skipRun.ok = true;
    skipRun.notes.push({ key: "멈춤", note: "자동 동기화를 멈춰 두었습니다.", level: "info" });
    skipRun.durationMs = Date.now() - started;
    return skipRun;
  }

  if (!(await acquireLease(db, source, started, !!opts.reconcile))) {
    // 도는 실행이 끝나면 한 번 더 돈다 — 실패가 아니라 「곧 반영」이다
    skipRun.ok = true;
    skipRun.deferred = true;
    skipRun.notes.push({
      key: "겹침",
      note: "이미 동기화가 돌고 있습니다. 그 실행이 끝나면 한 번 더 돌아 반영합니다.",
      level: "info",
    });
    skipRun.durationMs = Date.now() - started;
    return skipRun;
  }

  const total = { created: 0, updated: 0, deleted: 0, skipped: 0, needsReview: 0, fetched: 0, pages: 0 };
  let reconcile = !!opts.reconcile;
  let last: SyncRun = skipRun;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const run = EMPTY_RUN(source, opts.trigger);
    if (opts.by) run.by = opts.by;
    const state = round === 1 ? first : await readSyncState(db, source);
    let at: RunCursor | null = null;

    try {
      const rc = await newRunContext(db, source, run);
      at =
        source === "smoat"
          ? await syncSmoat(rc, state)
          : await syncOnline(rc, state, { ...opts, reconcile });
      await rc.issues.flush();
      run.ok = true;
    } catch (e) {
      run.ok = false;
      run.error = e instanceof Error ? e.message : String(e);
      console.error(`[sync/${source}]`, e);
    }

    total.created += run.created;
    total.updated += run.updated;
    total.deleted += run.deleted;
    total.skipped += run.skipped;
    total.needsReview += run.needsReview;
    total.fetched += run.fetched;
    total.pages += run.pages;
    Object.assign(run, total);
    run.durationMs = Date.now() - started;
    last = run;

    // 실패해도 결과는 남기고 임대는 푼다. 커서는 성공했을 때만 민다 (위 ⑤).
    // 실패한 차례 뒤로는 이어 돌지 않는다 — 같은 실패를 되풀이할 뿐이다.
    let next = { rerun: false, reconcile: false };
    try {
      next = await finishRun(db, source, run, at, round === MAX_ROUNDS || !run.ok);
    } catch (err) {
      console.error(`[sync/${source}] 결과를 남기지 못했습니다`, err);
      break;
    }
    if (!next.rerun) break;
    reconcile = reconcile || next.reconcile;
  }
  return last;
}

/** 두 사이트를 차례로 — 주기 실행과 신호가 쓴다 */
export async function runAllSync(db: Firestore, opts: SyncOptions): Promise<SyncRun[]> {
  const sources: FeedSource[] = ["acscent-online", "smoat"];
  const out: SyncRun[] = [];
  for (const s of sources) {
    if (!feedConfigured(s)) continue;
    out.push(await runSync(db, s, opts));
  }
  return out;
}

/** 동기화 설정 고치기 — 시작일·멈춤 (화면에서). 결과·커서는 건드리지 않는다 */
export async function patchSyncState(
  db: Firestore,
  source: FeedSource,
  patch: Pick<Partial<SyncState>, "startFrom" | "paused">,
): Promise<SyncState> {
  await db
    .collection(NEANDER_COL.syncState)
    .doc(source)
    .set(clean(patch as Record<string, unknown>), { merge: true });
  return readSyncState(db, source);
}
