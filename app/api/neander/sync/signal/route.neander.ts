import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { runAllSync, runSync } from "@/lib/neander/sync/server/pull";
import { feedConfigured } from "@/lib/neander/sync/server/feed";
import type { FeedSource } from "@/lib/neander/sync/contract";

// ============================================================
//  "가져가라" 신호 · 주기 실행 — 사람이 아니라 기계가 부른다
// ------------------------------------------------------------
//  두 가지가 같은 문으로 들어온다:
//
//    POST  사이트가 결제를 확정한 직후 보내는 신호
//          Authorization: Bearer <NEANDER_SYNC_SIGNAL_TOKEN>
//          body: { source, reason }
//
//    GET   Vercel Cron 의 주기 실행 (신호를 놓쳤을 때의 그물)
//          Authorization: Bearer <CRON_SECRET>  (Vercel 이 붙여 준다)
//
//  ⚠️ 신호에는 **금액이 없다.** 사이트는 "새 것이 있다"고만 말하고, 무엇이
//     얼마인지는 우리가 피드에서 직접 읽는다. 그래서 이 문으로 들어온 값이
//     장부에 그대로 들어가는 일이 없다 — 토큰이 새도 남이 우리 매출을
//     조작할 수 없고, 기껏해야 동기화를 한 번 더 돌릴 수 있을 뿐이다.
//
//  ⚠️ 응답은 늘 빠르게 돌려준다. 사이트의 결제 흐름이 우리를 기다리면
//     안 되므로 사이트 쪽은 await 하지 않는다 (lib/erp/signal.ts).
// ============================================================

export const dynamic = "force-dynamic";
// 신호는 보통 몇 초지만, 겹친 신호를 이어 도는 「한 번 더」와 주기 실행의 지운
// 주문 찾기는 길어질 수 있다. 끝나지 못하면 결과도 남지 않는다.
export const maxDuration = 300;

const SOURCES: FeedSource[] = ["acscent-online", "smoat"];
const isSource = (s: unknown): s is FeedSource => SOURCES.includes(s as FeedSource);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** 신호용 토큰. 없으면 문을 열지 않는다 */
function checkSignal(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (process.env.NEANDER_SYNC_SIGNAL_TOKEN ?? "").trim();
  if (!expected) {
    return { ok: false, status: 503, error: "NEANDER_SYNC_SIGNAL_TOKEN 이 설정되지 않았습니다." };
  }
  const token = bearer(req);
  if (!token || !safeEqual(token, expected)) {
    return { ok: false, status: 401, error: "신호 토큰이 올바르지 않습니다." };
  }
  return { ok: true };
}

/** 주기 실행용 토큰 — Vercel Cron 이 CRON_SECRET 을 붙여 준다 */
function checkCron(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    return { ok: false, status: 503, error: "CRON_SECRET 이 설정되지 않았습니다." };
  }
  const token = bearer(req);
  if (!token || !safeEqual(token, expected)) {
    return { ok: false, status: 401, error: "주기 실행 토큰이 올바르지 않습니다." };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = checkSignal(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let source: FeedSource | undefined;
  let reason = "";
  let reconcile = false;
  try {
    const body = (await req.json()) as { source?: unknown; reason?: unknown; reconcile?: unknown };
    if (isSource(body.source)) source = body.source;
    reason = String(body.reason ?? "").slice(0, 100);
    // 주문을 지웠을 때 — 지운 주문은 증분에 다시 오지 않아 되물어야 한다
    reconcile = body.reconcile === true;
  } catch {
    /* 본문 없이 부르는 것도 허용 — 그러면 둘 다 돈다 */
  }

  if (source && !feedConfigured(source)) {
    return NextResponse.json({ ok: true, skipped: "피드가 설정되지 않았습니다." });
  }

  try {
    const db = adminDb();
    const runs = source
      ? [await runSync(db, source, { trigger: "signal", reconcile })]
      : await runAllSync(db, { trigger: "signal", reconcile });
    console.log(
      `[sync/signal] ${source ?? "전체"} · ${reason} · ` +
        runs.map((r) => `${r.source} ${r.ok ? "ok" : "실패"} +${r.created}/~${r.updated}/-${r.deleted}`).join(" · "),
    );
    return NextResponse.json({
      ok: true,
      runs: runs.map((r) => ({
        source: r.source,
        ok: r.ok,
        created: r.created,
        updated: r.updated,
        deleted: r.deleted,
        deferred: r.deferred,
        error: r.error,
      })),
    });
  } catch (e) {
    console.error("[sync/signal]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const auth = checkCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    // 하루 한 번의 그물 — 지워진 주문 찾기까지 한다
    const runs = await runAllSync(adminDb(), { trigger: "cron", reconcile: true });
    console.log(
      "[sync/cron] " +
        runs.map((r) => `${r.source} ${r.ok ? "ok" : "실패"} +${r.created}/~${r.updated}/-${r.deleted}`).join(" · "),
    );
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    console.error("[sync/cron]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
