import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import { loadLaborActuals } from "@/lib/neander/sales/server/labor";
import { buildSalesSignals, type SalesSignalInput } from "@/lib/neander/sales/signals";
import { buildFinanceSignals, type FinanceSignalInput } from "@/lib/neander/finance/signals";
import { generateInsightNarrative } from "@/lib/neander/insights/server/generate";
import { runInsightDiscussion, type InsightDiscussResult } from "@/lib/neander/insights/server/discuss";
import type { SalesToolContext } from "@/lib/neander/sales/server/ai-tools";
import type { AgentMessage } from "@/lib/neander/ai/agent";
import { trimForStore } from "@/lib/neander/ai/chat-log";
import {
  insightDocId,
  type InsightDiscussionMessage,
  type InsightDoc,
  type InsightDraft,
  type InsightItem,
  type InsightModule,
  type InsightPatch,
  type Signal,
} from "@/lib/neander/insights/types";

// ============================================================
//  월간 인사이트 — 해설 읽기 · 만들기 · 고치기
// ------------------------------------------------------------
//    GET  ?module=sales|finance&month=YYYY-MM[&scope=]   → { doc | null }
//    POST { action: "generate", module, month, scope?, model? } → { doc }
//         서버가 데이터를 직접 읽어 신호를 뽑고(signals.ts) AI 해설을 붙여
//         초안(draft)으로 **덮어쓴다**. 사람이 고친 것도 사라진다 — 화면이 먼저 묻는다.
//    POST { action: "save", module, month, scope?, patch } → { doc }
//         사람이 고친 문장·승인. 근거 신호 id 는 저장된 신호 스냅샷에 있는 것만 남긴다.
//    POST { action: "discuss", module, month, scope?, messages, draft?, model? }
//         → { result: AgentResult<InsightEditProposal>, discussion }
//         「AI 와 고치기」 — 편집 중인 초안을 두고 묻고 답한다. 수정안은 저장하지
//         않고 돌려주기만 한다 (insights/server/discuss.ts). 대화는 문서에 덧붙인다.
//    POST { action: "clear-discussion", module, month, scope? } → 대화 기록 비우기
//
//  scope: 재무는 사업장(site). 매출은 아직 쓰지 않는다 (문서 id 만 갈린다).
//  인증은 재무·매출 데이터 라우트와 같은 게이트.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_SCOPE = 40;
const MAX_ITEMS = 8;
const MAX_TEXT = 300;
const MAX_COMMENT = 200;
const MAX_COMMENT_KEYS = 20;

class BadRequest extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[insights]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
}

function parseTarget(raw: { module?: unknown; month?: unknown; scope?: unknown }) {
  const { module, month, scope } = raw;
  if (module !== "sales" && module !== "finance") throw new BadRequest("module 은 sales 또는 finance 여야 합니다.");
  if (typeof month !== "string" || !MONTH_RE.test(month)) throw new BadRequest("month 는 YYYY-MM 이어야 합니다.");
  let s: string | undefined;
  if (scope !== undefined && scope !== null && scope !== "") {
    if (typeof scope !== "string" || scope.trim().length > MAX_SCOPE) {
      throw new BadRequest(`scope 는 ${MAX_SCOPE}자 이하 문자열이어야 합니다.`);
    }
    s = scope.trim() || undefined;
  }
  return { module: module as InsightModule, month, scope: s };
}

/** Firestore 는 undefined 를 거부한다 — JSON 왕복으로 undefined 칸을 지운다 */
const stripUndefined = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const docRef = (module: InsightModule, month: string, scope?: string) =>
  adminDb().collection(NEANDER_COL.insights).doc(insightDocId(module, month, scope));

// ── GET ──────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const q = new URL(req.url).searchParams;
    const { module, month, scope } = parseTarget({
      module: q.get("module"),
      month: q.get("month"),
      scope: q.get("scope") ?? undefined,
    });
    const snap = await docRef(module, month, scope).get();
    const doc = snap.exists ? ({ ...snap.data(), id: snap.id } as InsightDoc) : null;
    return NextResponse.json({ doc });
  } catch (e) {
    return failure(e);
  }
}

// ── POST ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      throw new BadRequest("요청 본문을 JSON 으로 읽지 못했습니다.");
    }
    if (!body || typeof body !== "object") throw new BadRequest("요청 본문이 비어 있습니다.");
    const target = parseTarget(body);

    if (body.action === "generate") {
      const model = typeof body.model === "string" ? body.model : undefined;
      return NextResponse.json({ doc: await generate(target, model, user.email) });
    }
    if (body.action === "save") {
      return NextResponse.json({ doc: await save(target, body.patch, user.email) });
    }
    if (body.action === "discuss") {
      return NextResponse.json(await discuss(target, body));
    }
    if (body.action === "clear-discussion") {
      await docRef(target.module, target.month, target.scope).update({ discussion: [] });
      return NextResponse.json({ discussion: [] });
    }
    if (body.action === "delete") {
      // 그 달 해설을 통째로 지운다 — 신호는 데이터에서 다시 뽑히므로 다시 만들면 된다.
      // 누가 지웠는지는 서버 로그로만 남긴다 (문서 자체가 없어지므로)
      await docRef(target.module, target.month, target.scope).delete();
      console.info(`[insights] ${user.email} 가 ${target.module} ${target.month}${target.scope ? ` ${target.scope}` : ""} 해설을 지웠습니다.`);
      return NextResponse.json({ ok: true });
    }
    throw new BadRequest("action 은 generate · save · discuss · clear-discussion · delete 중 하나여야 합니다.");
  } catch (e) {
    return failure(e);
  }
}

// ── 만들기 ───────────────────────────────────────────────────

/** 매출 원 데이터 — 신호 뽑기와 「AI 와 고치기」의 조회 도구가 같이 쓴다 */
async function loadSalesData(): Promise<Omit<SalesSignalInput, "month" | "labor"> & { labor: SalesToolContext["labor"] }> {
  const db = adminDb();
  const [lineSnap, productSnap, eventSnap, aSnap, labor] = await Promise.all([
    db.collection(NEANDER_COL.salesLines).get(),
    db.collection(NEANDER_COL.salesProducts).get(),
    db.collection(NEANDER_COL.salesEvents).get(),
    db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
    // 화면(sales/page)과 같은 인건비 — 못 읽으면 가정값으로
    loadLaborActuals(db).catch(() => null),
  ]);
  const products = productSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesSignalInput["products"];
  if (products.length === 0) {
    throw new BadRequest("상품 마스터가 비어 있습니다. 마스터 화면에서 먼저 적재해주세요.");
  }
  return {
    lines: lineSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesSignalInput["lines"],
    products,
    events: eventSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesSignalInput["events"],
    assumptions: (aSnap.exists ? { id: aSnap.id, ...aSnap.data() } : SEED_ASSUMPTIONS) as SalesSignalInput["assumptions"],
    labor,
  };
}

async function loadSalesSignals(month: string): Promise<Signal[]> {
  const { labor, ...data } = await loadSalesData();
  return buildSalesSignals({ month, ...data, labor: { actuals: labor ?? null } });
}

/** 재무 원 데이터 — 신호 뽑기와 「AI 와 고치기」의 조회 도구가 같이 쓴다 */
async function loadFinanceData(): Promise<Omit<FinanceSignalInput, "month" | "basis" | "site">> {
  const db = adminDb();
  const readAll = async (col: string) => {
    const snap = await db.collection(col).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };
  const [transactions, accounts, paymentMethods, vendorRules, subscriptions, allocations, budgets, anomalyIgnores] =
    await Promise.all([
      readAll(NEANDER_COL.finTransactions),
      readAll(NEANDER_COL.finAccounts),
      readAll(NEANDER_COL.finPaymentMethods),
      readAll(NEANDER_COL.finVendorRules),
      readAll(NEANDER_COL.finSubscriptions),
      readAll(NEANDER_COL.finAllocations),
      readAll(NEANDER_COL.finBudgets),
      readAll(NEANDER_COL.finAnomalyIgnores),
    ]);
  return {
    transactions: transactions as unknown as FinanceSignalInput["transactions"],
    accounts: accounts as unknown as FinanceSignalInput["accounts"],
    paymentMethods: paymentMethods as unknown as FinanceSignalInput["paymentMethods"],
    allocations: allocations as unknown as FinanceSignalInput["allocations"],
    budgets: budgets as unknown as FinanceSignalInput["budgets"],
    subscriptions: subscriptions as unknown as FinanceSignalInput["subscriptions"],
    vendorRules: vendorRules as unknown as FinanceSignalInput["vendorRules"],
    anomalyIgnores: anomalyIgnores as unknown as FinanceSignalInput["anomalyIgnores"],
  };
}

async function loadFinanceSignals(month: string, site?: string): Promise<Signal[]> {
  return buildFinanceSignals({
    month,
    ...(await loadFinanceData()),
    ...(site ? { site: site as FinanceSignalInput["site"] } : {}),
  });
}

async function generate(
  target: { module: InsightModule; month: string; scope?: string },
  model: string | undefined,
  email: string,
): Promise<InsightDoc> {
  const { module, month, scope } = target;
  const signals =
    module === "sales" ? await loadSalesSignals(month) : await loadFinanceSignals(month, scope);

  const narrative = await generateInsightNarrative({ module, month, signals, model });
  const now = Date.now();
  const doc: InsightDoc = stripUndefined({
    id: insightDocId(module, month, scope),
    module,
    month,
    scope,
    status: "draft",
    summary: narrative.summary,
    actions: narrative.actions,
    risks: narrative.risks,
    comments: narrative.comments,
    signals,
    fallback: narrative.fallback,
    model: narrative.model,
    costUsd: narrative.costUsd,
    generatedAt: now,
    generatedBy: email,
    updatedAt: now,
    updatedBy: email,
  });
  await docRef(module, month, scope).set(doc);
  return doc;
}

// ── 고치기 ───────────────────────────────────────────────────

function cleanItems(raw: unknown, field: string, known: Set<string>): InsightItem[] {
  if (!Array.isArray(raw)) throw new BadRequest(`${field} 는 배열이어야 합니다.`);
  const out: InsightItem[] = [];
  raw.forEach((r, idx) => {
    if (out.length >= MAX_ITEMS || !r || typeof r !== "object") return;
    const o = r as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim().slice(0, MAX_TEXT) : "";
    if (!text) return;
    const detail = typeof o.detail === "string" ? o.detail.trim().slice(0, MAX_TEXT) : "";
    const impact = typeof o.impact === "string" ? o.impact.trim().slice(0, MAX_TEXT) : "";
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 40) : `${field[0]}${idx + 1}`;
    const ids = Array.isArray(o.signalIds) ? o.signalIds : [];
    out.push({
      id,
      text,
      ...(detail ? { detail } : {}),
      ...(impact ? { impact } : {}),
      signalIds: [...new Set(ids.filter((s): s is string => typeof s === "string" && known.has(s)))],
    });
  });
  return out;
}

function cleanComments(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("comments 는 객체여야 합니다.");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().slice(0, 80);
    if (!key || typeof v !== "string") continue;
    const line = v.trim().slice(0, MAX_COMMENT);
    if (!line) continue;
    if (Object.keys(out).length >= MAX_COMMENT_KEYS) break;
    out[key] = line;
  }
  return out;
}

async function save(
  target: { module: InsightModule; month: string; scope?: string },
  rawPatch: unknown,
  email: string,
): Promise<InsightDoc> {
  if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
    throw new BadRequest("patch 가 필요합니다.");
  }
  const patch = rawPatch as Record<string, unknown>;
  const ref = docRef(target.module, target.month, target.scope);
  const snap = await ref.get();
  if (!snap.exists) throw new BadRequest("저장된 해설이 없습니다. 먼저 만들어주세요.", 404);
  const current = { ...snap.data(), id: snap.id } as InsightDoc;
  const known = new Set((current.signals ?? []).map((s) => s.id));

  const update: InsightPatch = {};
  if (patch.summary !== undefined) update.summary = cleanItems(patch.summary, "summary", known);
  if (patch.actions !== undefined) update.actions = cleanItems(patch.actions, "actions", known);
  if (patch.risks !== undefined) update.risks = cleanItems(patch.risks, "risks", known);
  if (patch.comments !== undefined) update.comments = cleanComments(patch.comments);
  if (patch.status !== undefined) {
    if (patch.status !== "draft" && patch.status !== "approved") {
      throw new BadRequest("status 는 draft 또는 approved 여야 합니다.");
    }
    update.status = patch.status;
  }

  const now = Date.now();
  // comments 는 통째로 바꾼다 — merge 로 두면 지운 장 코멘트가 남는다
  await ref.update(stripUndefined({ ...update, updatedAt: now, updatedBy: email }));
  return { ...current, ...update, updatedAt: now, updatedBy: email };
}

// ── AI 와 고치기 ─────────────────────────────────────────────

/** 대화가 길어지면 비용이 선형으로 는다 — 최근 것만 모델에 보낸다 */
const MAX_HISTORY = 20;
/** 인사이트 문서에 함께 담는다 — 신호 스냅샷과 합쳐 1MB 를 넘지 않게 */
const MAX_DISCUSSION_BYTES = 300_000;

function trimDiscussion(messages: InsightDiscussionMessage[]): InsightDiscussionMessage[] {
  let out = trimForStore(messages);
  const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
  while (out.length > 2 && size(out) > MAX_DISCUSSION_BYTES) out = out.slice(2);
  return out;
}

async function discuss(
  target: { module: InsightModule; month: string; scope?: string },
  body: Record<string, unknown>,
): Promise<{ result: InsightDiscussResult; discussion: InsightDiscussionMessage[] }> {
  const { module, month, scope } = target;
  const ref = docRef(module, month, scope);
  const snap = await ref.get();
  if (!snap.exists) throw new BadRequest("저장된 해설이 없습니다. 먼저 만들어주세요.", 404);
  const current = { ...snap.data(), id: snap.id } as InsightDoc;
  const known = new Set((current.signals ?? []).map((s) => s.id));

  const raw = Array.isArray(body.messages) ? (body.messages as AgentMessage[]) : [];
  const messages = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new BadRequest("마지막 메시지는 사용자 발화여야 합니다.");
  }

  // 화면의 편집 중인 초안 (저장 전일 수 있다) — 없으면 저장된 문장
  const d = body.draft && typeof body.draft === "object" ? (body.draft as Record<string, unknown>) : {};
  const draft: InsightDraft = {
    summary: d.summary !== undefined ? cleanItems(d.summary, "summary", known) : current.summary,
    actions: d.actions !== undefined ? cleanItems(d.actions, "actions", known) : current.actions,
    risks: d.risks !== undefined ? cleanItems(d.risks, "risks", known) : current.risks,
    comments: d.comments !== undefined ? cleanComments(d.comments) : current.comments,
  };

  const model = typeof body.model === "string" ? body.model : undefined;
  const result = await runInsightDiscussion({
    month,
    scope,
    signals: current.signals ?? [],
    draft,
    messages,
    model,
    data:
      module === "sales"
        ? { module, ctx: await loadSalesData() }
        : { module, ctx: await loadFinanceData() },
  });

  const now = Date.now();
  const discussion = trimDiscussion([
    ...(current.discussion ?? []),
    { role: "user", content: messages[messages.length - 1].content, at: now },
    {
      role: "assistant",
      content: result.reply,
      at: now + 1,
      ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
      ...(result.proposals.length ? { proposals: result.proposals } : {}),
      model: result.model,
      ...(result.usage.costUsd !== undefined ? { costUsd: result.usage.costUsd } : {}),
    },
  ]);
  // 기록에 실패해도 답은 돌려준다 — 로그 때문에 대화가 막히면 안 된다
  try {
    await ref.update({ discussion: stripUndefined(discussion) });
  } catch (e) {
    console.error("[insights/discuss 기록]", e);
  }
  return { result, discussion };
}
