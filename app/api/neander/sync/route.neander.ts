import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  dismissSyncIssue,
  patchSyncState,
  readAllSyncStates,
  readSyncIssues,
  runAllSync,
  runSync,
} from "@/lib/neander/sync/server/pull";
import { feedConfigured } from "@/lib/neander/sync/server/feed";
import type { FeedSource } from "@/lib/neander/sync/contract";
import type { SmoatMonthlyCost, SmoatSale } from "@/lib/neander/smoat/types";

// 사이트 매출 자동 동기화 — 상태 보기 · 지금 실행 · 설정 고치기.
//
// 주기 실행(cron)과 사이트 신호는 옆의 signal 라우트가 받는다. 이 라우트는
// **사람**이 부르는 문이라 재무·매출과 같은 인증 게이트를 쓴다.
//
// ⚠️ 파일명이 route.neander.ts 인 이유: next.config.mjs 의 pageExtensions
//    분기로 매장(ACSCENT) 빌드에서 제외하기 위해서다.
export const dynamic = "force-dynamic";
// 「지금 동기화」·「과거 달 다시 받기」는 수백 건을 받아 쓴다. 이 시간 안에
// 끝나지 못하면 함수가 죽어 결과도 남지 않는다 — 임대는 5분 뒤 풀린다.
export const maxDuration = 300;

const SOURCES: FeedSource[] = ["acscent-online", "smoat"];
const isSource = (s: string): s is FeedSource => SOURCES.includes(s as FeedSource);

function failure(e: unknown) {
  const denied = accessErrorResponse(e);
  if (denied) return denied;
  console.error("[sync]", e);
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "알 수 없는 오류" },
    { status: 500 },
  );
}

/** 상태 + SMOAT 데이터. 화면 하나가 쓰는 것을 한 번에 준다 */
export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const db = adminDb();
    const [states, issues, salesSnap, costSnap] = await Promise.all([
      readAllSyncStates(db),
      readSyncIssues(db),
      db.collection(NEANDER_COL.smoatSales).get(),
      db.collection(NEANDER_COL.smoatCosts).get(),
    ]);
    return NextResponse.json({
      states: states.map((s) => ({ ...s, configured: feedConfigured(s.id) })),
      issues,
      smoat: {
        sales: salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as SmoatSale),
        costs: costSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as SmoatMonthlyCost),
      },
      serverTime: Date.now(),
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    return failure(e);
  }

  try {
    const body = (await req.json()) as {
      action?: string;
      source?: string;
      window?: { from: string; to: string };
      patch?: { startFrom?: string; paused?: boolean };
      id?: string;
    };
    const db = adminDb();

    switch (body.action ?? "run") {
      // 「지금 동기화」 — source 를 주면 그것만, 없으면 둘 다
      case "run": {
        // 사람이 누른 「지금 동기화」는 지워진 주문 찾기까지 한다
        const opts = { trigger: "manual" as const, by: user.email, reconcile: true };
        const runs =
          body.source && isSource(body.source)
            ? [await runSync(db, body.source, opts)]
            : await runAllSync(db, opts);
        return NextResponse.json({ ok: true, runs });
      }

      // 「이 기간 다시 받기」 — 엑셀 적재를 되돌린 뒤 그 달을 자동으로 채울 때
      case "backfill": {
        if (!body.source || !isSource(body.source)) {
          return NextResponse.json({ error: "source 가 필요합니다." }, { status: 400 });
        }
        if (body.source !== "acscent-online") {
          return NextResponse.json(
            { error: "기간 다시 받기는 온라인 피드만 지원합니다." },
            { status: 400 },
          );
        }
        const w = body.window;
        if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w.from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(w.to ?? "")) {
          return NextResponse.json(
            { error: "window 는 { from: YYYY-MM-DD, to: YYYY-MM-DD } 여야 합니다." },
            { status: 400 },
          );
        }
        const run = await runSync(db, body.source, {
          trigger: "manual",
          by: user.email,
          window: w,
        });
        return NextResponse.json({ ok: true, runs: [run] });
      }

      case "patch": {
        if (!body.source || !isSource(body.source)) {
          return NextResponse.json({ error: "source 가 필요합니다." }, { status: 400 });
        }
        const patch = body.patch ?? {};
        if (patch.startFrom !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.startFrom)) {
          return NextResponse.json({ error: "시작일은 YYYY-MM-DD 여야 합니다." }, { status: 400 });
        }
        // 커서는 여기서 고치지 않는다 — 사람이 커서를 되돌리면 이미 받은 것을
        // 다시 받을 뿐이지만, 앞으로 밀면 그 사이 결제가 영영 빠진다.
        const state = await patchSyncState(db, body.source, {
          ...(patch.startFrom !== undefined ? { startFrom: patch.startFrom } : {}),
          ...(patch.paused !== undefined ? { paused: !!patch.paused } : {}),
        });
        return NextResponse.json({ ok: true, state });
      }

      // 「확인」 — 사람이 본 것을 목록에서 내린다
      case "dismissIssue": {
        if (!body.id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await dismissSyncIssue(db, body.id);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `알 수 없는 action: ${body.action}` }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}
