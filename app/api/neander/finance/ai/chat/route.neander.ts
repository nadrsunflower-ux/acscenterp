import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/finance/server/admin";
import { requireFinanceUser, accessErrorResponse } from "@/lib/neander/finance/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { runFinanceChat, type ChatMessage } from "@/lib/neander/finance/server/ai-chat";
import {
  extractAttachmentText,
  type ExtractedAttachment,
} from "@/lib/neander/finance/server/attachments";
import {
  MAX_ATTACH_FILES,
  MAX_ATTACH_TOTAL_BYTES,
} from "@/lib/neander/finance/attachment-limits";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { FinTransaction } from "@/lib/neander/finance/types";

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
  try {
    await requireFinanceUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    // 첨부가 있으면 multipart, 없으면 JSON — 둘 다 받는다
    let rawMessages: unknown;
    let model: string | undefined;
    const files: File[] = [];
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      try {
        rawMessages = JSON.parse(String(form.get("messages") ?? "[]"));
      } catch {
        rawMessages = [];
      }
      const m = form.get("model");
      if (typeof m === "string" && m) model = m;
      for (const f of form.getAll("files")) if (f instanceof File) files.push(f);
    } else {
      const body = (await req.json()) as { messages?: ChatMessage[]; model?: string };
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
    return NextResponse.json(result);
  } catch (e) {
    console.error("[finance/ai/chat]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "채팅에 실패했습니다." },
      { status: 500 },
    );
  }
}
