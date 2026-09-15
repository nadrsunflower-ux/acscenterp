import { NextResponse } from "next/server";
import { parsePresentation, type PresentationContext } from "@/lib/neander/ai/presentation";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  extractAttachmentText,
  type ExtractedAttachment,
} from "@/lib/neander/server/attachments";
import { MAX_ATTACH_FILES, MAX_ATTACH_TOTAL_BYTES } from "@/lib/neander/ai/attachment-limits";
import { runSalesChat, type SalesChatResult } from "@/lib/neander/sales/server/ai-chat";
import type { SalesProposal } from "@/lib/neander/sales/server/ai-tools";
import { SEED_ASSUMPTIONS } from "@/lib/neander/sales/master-data";
import { loadLaborActuals } from "@/lib/neander/sales/server/labor";
import type {
  SalesAssumptions,
  SalesEvent,
  SalesLine,
  SalesProduct,
} from "@/lib/neander/sales/types";
import {
  titleFrom,
  trimForStore,
  type AssistantChatDoc,
  type AssistantMessage,
} from "@/lib/neander/ai/chat-log";
import type { AgentMessage } from "@/lib/neander/ai/agent";

// ============================================================
//  매출 비서 채팅
// ------------------------------------------------------------
//  재무 비서 라우트(finance/ai/chat)와 같은 구조다. 대화 기록만 받고,
//  판매 줄·상품·이벤트는 서버가 Firestore 에서 직접 읽는다. 도구 루프도
//  서버에서 돈다.
//
//  ⚠️ 이 라우트는 **판매 줄을 쓰지 않는다.** 모델의 변경 요청은 제안으로만
//     돌아가고, 저장은 사용자가 승인했을 때 기존 경로(line.bulkResolve ·
//     product.upsert)로 나간다.
//
//  인증은 재무와 같은 게이트(NEANDER_FINANCE_EMAILS)를 쓴다 — 매출 데이터
//  라우트 전체가 그 기준이다 (api/neander/sales/data 주석).
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_HISTORY = 20;

export async function POST(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    let rawMessages: unknown;
    let model: string | undefined;
    let conversationId: string | undefined;
    /** 보고 슬라이드 발표 중이면 그 달 — 검사를 통과한 것만 (ai/presentation.ts) */
    let presentation: PresentationContext | undefined;
    const files: File[] = [];
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      try {
        rawMessages = JSON.parse(String(form.get("messages") ?? "[]"));
      } catch {
        rawMessages = [];
      }
      const cid = form.get("conversationId");
      if (typeof cid === "string" && cid) conversationId = cid;
      const m = form.get("model");
      if (typeof m === "string" && m) model = m;
      for (const f of form.getAll("files")) if (f instanceof File) files.push(f);
      presentation = parsePresentation(form.get("context"));
    } else {
      const body = (await req.json()) as {
        messages?: AgentMessage[];
        model?: string;
        conversationId?: string;
        context?: unknown;
      };
      conversationId = body.conversationId;
      rawMessages = body.messages;
      model = body.model;
      presentation = parsePresentation(body.context);
    }
    const messages = Array.isArray(rawMessages) ? (rawMessages as AgentMessage[]) : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: "messages 가 필요합니다." }, { status: 400 });
    }
    const trimmed = messages
      .slice(-MAX_HISTORY)
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") {
      return NextResponse.json({ error: "마지막 메시지는 사용자 발화여야 합니다." }, { status: 400 });
    }

    if (files.length > MAX_ATTACH_FILES) {
      return NextResponse.json({ error: `첨부는 한 번에 ${MAX_ATTACH_FILES}개까지입니다.` }, { status: 400 });
    }
    if (files.reduce((s, f) => s + f.size, 0) > MAX_ATTACH_TOTAL_BYTES) {
      return NextResponse.json(
        { error: "첨부 파일이 너무 큽니다 (합계 4MB 이하). 필요한 부분만 잘라 올려주세요." },
        { status: 400 },
      );
    }
    let attachments: ExtractedAttachment[] = [];
    try {
      attachments = await Promise.all(files.map(extractAttachmentText));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "첨부 파일을 읽지 못했습니다." },
        { status: 400 },
      );
    }

    const db = adminDb();
    const [lineSnap, productSnap, eventSnap, aSnap, labor] = await Promise.all([
      db.collection(NEANDER_COL.salesLines).get(),
      db.collection(NEANDER_COL.salesProducts).get(),
      db.collection(NEANDER_COL.salesEvents).get(),
      db.collection(NEANDER_COL.salesAssumptions).doc("current").get(),
      // 화면과 같은 인건비 — 못 읽으면 가정값으로 (비서가 출처를 함께 말한다)
      loadLaborActuals(db).catch(() => null),
    ]);
    const ctx = {
      lines: lineSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesLine[],
      products: productSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesProduct[],
      events: eventSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as SalesEvent[],
      assumptions: (aSnap.exists ? { id: aSnap.id, ...aSnap.data() } : SEED_ASSUMPTIONS) as SalesAssumptions,
      labor,
    };
    if (ctx.products.length === 0) {
      return NextResponse.json(
        { error: "상품 마스터가 비어 있습니다. 마스터 화면에서 먼저 적재해주세요." },
        { status: 400 },
      );
    }

    const result = await runSalesChat({ messages: trimmed, ctx, model, attachments, presentation });

    // 답을 만든 뒤 기록한다 — 기록에 실패해도 답변은 돌려준다
    try {
      conversationId = await saveTurn({
        db,
        owner: user.email,
        conversationId,
        question: trimmed[trimmed.length - 1].content,
        result,
      });
    } catch (e) {
      console.error("[sales/ai/chat 기록]", e);
    }
    return NextResponse.json({ ...result, conversationId });
  } catch (e) {
    console.error("[sales/ai/chat]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "채팅에 실패했습니다." },
      { status: 500 },
    );
  }
}

async function saveTurn(args: {
  db: FirebaseFirestore.Firestore;
  owner: string;
  conversationId?: string;
  question: string;
  result: SalesChatResult;
}): Promise<string> {
  const { db, owner, question, result } = args;
  const now = Date.now();
  const col = db.collection(NEANDER_COL.salesChats);

  const turn: AssistantMessage<SalesProposal>[] = [
    { role: "user", content: question, at: now },
    {
      role: "assistant",
      content: result.reply,
      at: now + 1,
      ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
      ...(result.proposals.length ? { proposals: result.proposals } : {}),
    },
  ];

  if (args.conversationId) {
    const ref = col.doc(args.conversationId);
    const snap = await ref.get();
    const doc = snap.data() as AssistantChatDoc<SalesProposal> | undefined;
    if (doc && doc.owner === owner) {
      await ref.set(
        {
          messages: trimForStore([...(doc.messages ?? []), ...turn]),
          updatedAt: now,
          costUsd: (doc.costUsd ?? 0) + (result.usage.costUsd ?? 0),
        },
        { merge: true },
      );
      return ref.id;
    }
  }

  const ref = col.doc();
  await ref.set({
    owner,
    title: titleFrom(turn),
    messages: trimForStore(turn),
    createdAt: now,
    updatedAt: now,
    costUsd: result.usage.costUsd ?? 0,
  });
  return ref.id;
}
