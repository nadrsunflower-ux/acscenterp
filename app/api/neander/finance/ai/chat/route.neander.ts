import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { runFinanceChat, type ChatMessage } from "@/lib/neander/finance/server/ai-chat";
import {
  extractAttachmentText,
  type ExtractedAttachment,
} from "@/lib/neander/server/attachments";
import {
  MAX_ATTACH_FILES,
  MAX_ATTACH_TOTAL_BYTES,
} from "@/lib/neander/ai/attachment-limits";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinTransaction } from "@/lib/neander/finance/types";
import {
  titleFrom,
  trimForStore,
  type FinChatDoc,
  type FinChatMessage,
} from "@/lib/neander/finance/chat-log";

// ============================================================
//  재무 채팅 에이전트
// ------------------------------------------------------------
//  대화 기록만 받고, 장부는 서버가 Firestore 에서 직접 읽는다. 도구 루프도
//  서버에서 돈다 — 무엇이 모델에 갔는지 서버가 알고 있어야 한다.
//
//  ⚠️ 이 라우트는 **장부를 쓰지 않는다.** 모델의 변경 요청은 제안으로만
//     돌아가고, 저장은 사용자가 승인했을 때 기존 경로(transaction.applyEdits)
//     로 나간다.

// ============================================================

export const dynamic = "force-dynamic";
/** 도구를 여러 번 돌 수 있어 길어진다 */
export const maxDuration = 300;

/** 대화가 길어지면 비용이 선형으로 늘어난다 — 최근 것만 보낸다 */
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
    // 첨부가 있으면 multipart, 없으면 JSON — 둘 다 받는다
    let rawMessages: unknown;
    let model: string | undefined;
    let conversationId: string | undefined;
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
    } else {
      const body = (await req.json()) as {
        messages?: ChatMessage[];
        model?: string;
        conversationId?: string;
      };
      conversationId = body.conversationId;
      rawMessages = body.messages;
      model = body.model;
    }
    const messages = Array.isArray(rawMessages) ? (rawMessages as ChatMessage[]) : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: "messages 가 필요합니다." }, { status: 400 });
    }
    const trimmed = messages.slice(-MAX_HISTORY).filter(
      (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
    if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") {
      return NextResponse.json({ error: "마지막 메시지는 사용자 발화여야 합니다." }, { status: 400 });
    }

    // 첨부 한도는 서버에서도 강제한다 — 클라이언트 검사는 우회할 수 있다
    if (files.length > MAX_ATTACH_FILES) {
      return NextResponse.json(
        { error: `첨부는 한 번에 ${MAX_ATTACH_FILES}개까지입니다.` },
        { status: 400 },
      );
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
    const [txSnap, acctSnap, pmSnap] = await Promise.all([
      db.collection(NEANDER_COL.finTransactions).get(),
      db.collection(NEANDER_COL.finAccounts).get(),
      db.collection(NEANDER_COL.finPaymentMethods).get(),
    ]);

    const ctx = {
      transactions: txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[],
      accounts: acctSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinAccountDoc[],
      paymentMethods: pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinPaymentMethodDoc[],
    };
    if (ctx.accounts.length === 0) {
      return NextResponse.json(
        { error: "계정 마스터가 비어 있습니다. 마스터 탭에서 먼저 적재해주세요." },
        { status: 400 },
      );
    }

    const result = await runFinanceChat({ messages: trimmed, ctx, model, attachments });

    // 답을 만든 뒤 기록한다. 화면이 저장하게 하면 브라우저가 닫히거나 중간에
    // 끊겼을 때 정작 무엇을 제안받았는지가 사라진다. 서버는 답을 만든 그
    // 자리에서 조회 근거·제안까지 통째로 안다.
    // 기록에 실패해도 답변은 돌려준다 — 로그 때문에 대화가 막히면 안 된다.
    try {
      conversationId = await saveTurn({
        db,
        owner: user.email,
        conversationId,
        question: trimmed[trimmed.length - 1].content,
        result,
      });
    } catch (e) {
      console.error("[finance/ai/chat 기록]", e);
    }
    return NextResponse.json({ ...result, conversationId });
  } catch (e) {
    console.error("[finance/ai/chat]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "채팅에 실패했습니다." },
      { status: 500 },
    );
  }
}

/**
 * 한 턴(질문 + 답)을 대화 문서에 덧붙인다.
 *
 * conversationId 가 없으면 새 대화를 만든다 — 화면의 「새 대화」가 곧 id 를
 * 비워 보내는 것이다. 남의 대화에 덧붙이지 못하도록 소유자를 확인하고,
 * 어긋나면 조용히 새 대화로 만든다(에러를 내면 답변까지 막힌다).
 */
async function saveTurn(args: {
  db: FirebaseFirestore.Firestore;
  owner: string;
  conversationId?: string;
  question: string;
  result: Awaited<ReturnType<typeof runFinanceChat>>;
}): Promise<string> {
  const { db, owner, question, result } = args;
  const now = Date.now();
  const col = db.collection(NEANDER_COL.finChats);

  const turn: FinChatMessage[] = [
    { role: "user", content: question, at: now },
    {
      role: "assistant",
      content: result.reply,
      at: now + 1,
      // 무엇을 보고 답했는지 — 이게 빠지면 감사 추적이 되지 못한다
      ...(result.toolCalls.length
        ? { toolCalls: result.toolCalls.map((t) => ({ name: t.name, args: t.args, summary: t.summary })) }
        : {}),
      ...(result.proposals.length ? { proposals: result.proposals } : {}),
    },
  ];

  if (args.conversationId) {
    const ref = col.doc(args.conversationId);
    const snap = await ref.get();
    const doc = snap.data() as FinChatDoc | undefined;
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
