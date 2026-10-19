import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { extractAttachmentText, type ExtractedAttachment } from "@/lib/neander/server/attachments";
import { MAX_ATTACH_FILES, MAX_ATTACH_TOTAL_BYTES } from "@/lib/neander/ai/attachment-limits";
import { summaryOf, titleFrom, trimForStore, type AssistantChatDoc, type AssistantMessage } from "@/lib/neander/ai/chat-log";
import type { AgentMessage } from "@/lib/neander/ai/agent";
import { isQuote, sanitizeFinDoc, type FinDoc } from "@/lib/neander/finance/docs";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import { hasContractBody, type ContractProposal, type FinContractDraft } from "@/lib/neander/finance/contract";
import { runContractChat, type ContractChatResult } from "@/lib/neander/finance/server/ai-contract";

// ============================================================
//  계약서 비서
// ------------------------------------------------------------
//  POST    대화 한 턴. 화면의 계약서 초안을 **함께** 받는다 — 사람이 방금
//          손으로 고친 것, 아직 저장하지 않은 것까지가 「지금 계약서」 다.
//          프로젝트와 견적서는 서버가 Firestore 에서 직접 읽는다.
//  GET     ?docId= 그 계약서를 두고 나눈 대화 목록 · ?id= 대화 하나
//  DELETE  ?id= 내가 시작한 대화를 지운다
//
//  ⚠️ 이 라우트는 **계약서를 쓰지 않는다.** 비서의 변경은 제안으로만
//     돌아가고, 사람이 「적용」 을 눌러야 화면의 초안에 닿으며, 초안은 다시
//     「저장」 을 눌러야 기존 경로(doc.save)로 남는다.
//
//  대화는 계약서에 묶어 남긴다. 재무 비서의 대화는 사람마다 따로지만(장부
//  조회 이력이 들어 있다) 여기는 계약서를 볼 수 있는 사람이면 누구든 본다 —
//  「이 조항이 왜 이렇게 됐나」 를 나중에 다른 사람이 물을 수 있어야 한다.
//  아직 한 번도 저장하지 않은 계약서의 대화는 문서 id 가 없어 목록에 뜨지
//  않다가, 저장한 뒤 한 턴이 더 오가면 그때 그 계약서에 붙는다.
// ============================================================

export const dynamic = "force-dynamic";
/** 도구를 여러 번 돌 수 있어 길어진다 */
export const maxDuration = 300;

/** 대화가 길어지면 비용이 선형으로 늘어난다 — 최근 것만 보낸다 */
const MAX_HISTORY = 20;

type ContractChatDoc = AssistantChatDoc<ContractProposal> & { projectId?: string; docId?: string };

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
    let rawContract: unknown;
    let model: string | undefined;
    let conversationId: string | undefined;
    let docId: string | undefined;
    const files: File[] = [];
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const json = (k: string): unknown => {
        try {
          return JSON.parse(String(form.get(k) ?? "null"));
        } catch {
          return null;
        }
      };
      rawMessages = json("messages");
      rawContract = json("contract");
      const one = (k: string) => {
        const v = form.get(k);
        return typeof v === "string" && v ? v : undefined;
      };
      model = one("model");
      conversationId = one("conversationId");
      docId = one("docId");
      for (const f of form.getAll("files")) if (f instanceof File) files.push(f);
    } else {
      const body = (await req.json()) as {
        messages?: unknown;
        contract?: unknown;
        model?: string;
        conversationId?: string;
        docId?: string;
      };
      rawMessages = body.messages;
      rawContract = body.contract;
      model = body.model;
      conversationId = body.conversationId;
      docId = body.docId;
    }

    const messages = Array.isArray(rawMessages) ? (rawMessages as AgentMessage[]) : [];
    const trimmed = messages
      .slice(-MAX_HISTORY)
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") {
      return NextResponse.json({ error: "마지막 메시지는 사용자 발화여야 합니다." }, { status: 400 });
    }

    // 화면이 보낸 초안은 저장할 때와 같은 정리를 거친다 — 꼴이 어긋난 것은 여기서 걸린다
    const parsed = sanitizeFinDoc((rawContract ?? {}) as Parameters<typeof sanitizeFinDoc>[0]);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (parsed.value.kind !== "contract" || !hasContractBody(parsed.value)) {
      return NextResponse.json({ error: "본문이 있는 계약서가 필요합니다." }, { status: 400 });
    }
    const draft: FinContractDraft = parsed.value;

    // 첨부 한도는 서버에서도 강제한다 — 클라이언트 검사는 우회할 수 있다
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
    const [projectSnap, docsSnap] = await Promise.all([
      db.collection(NEANDER_COL.finProjects).doc(draft.projectId).get(),
      db.collection(NEANDER_COL.finDocs).where("projectId", "==", draft.projectId).get(),
    ]);
    if (!projectSnap.exists) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
    const project = { id: projectSnap.id, ...projectSnap.data() } as FinProjectDoc;
    const quotes = docsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as FinDoc)
      .filter(isQuote)
      .sort((a, b) => Number(b.status === "accepted") - Number(a.status === "accepted") || (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));

    const result = await runContractChat({ messages: trimmed, draft, project, quotes, model, attachments });

    // 답을 만든 그 자리에서 기록한다 — 무엇을 제안받았는지가 브라우저와 함께 사라지지 않게.
    // 기록에 실패해도 답변은 돌려준다.
    try {
      conversationId = await saveTurn({
        db,
        owner: user.email,
        conversationId,
        projectId: draft.projectId,
        // 남의 프로젝트 문서 id 를 끼워 넣지 못하게 — 이 프로젝트의 문서일 때만 묶는다
        docId: docId && docsSnap.docs.some((d) => d.id === docId) ? docId : undefined,
        question: trimmed[trimmed.length - 1].content,
        result,
      });
    } catch (e) {
      console.error("[finance/ai/contract 기록]", e);
    }
    return NextResponse.json({ ...result, conversationId });
  } catch (e) {
    console.error("[finance/ai/contract]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "계약서 비서가 답하지 못했습니다." },
      { status: 500 },
    );
  }
}

/** 한 턴(질문 + 답)을 대화 문서에 덧붙인다. 남의 대화에는 덧붙이지 않고 새 대화로 만든다 */
async function saveTurn(args: {
  db: FirebaseFirestore.Firestore;
  owner: string;
  conversationId?: string;
  projectId: string;
  docId?: string;
  question: string;
  result: ContractChatResult;
}): Promise<string> {
  const { db, owner, question, result } = args;
  const now = Date.now();
  const col = db.collection(NEANDER_COL.finContractChats);
  const turn: AssistantMessage<ContractProposal>[] = [
    { role: "user", content: question, at: now },
    {
      role: "assistant",
      content: result.reply,
      at: now + 1,
      ...(result.toolCalls.length
        ? { toolCalls: result.toolCalls.map((t) => ({ name: t.name, args: t.args, summary: t.summary })) }
        : {}),
      ...(result.proposals.length ? { proposals: result.proposals } : {}),
    },
  ];

  if (args.conversationId) {
    const ref = col.doc(args.conversationId);
    const doc = (await ref.get()).data() as ContractChatDoc | undefined;
    if (doc && doc.owner === owner) {
      await ref.set(
        {
          messages: trimForStore([...(doc.messages ?? []), ...turn]),
          updatedAt: now,
          costUsd: (doc.costUsd ?? 0) + (result.usage.costUsd ?? 0),
          // 대화를 시작한 뒤에 계약서를 처음 저장했다면 이제 문서 id 가 생겼다
          ...(args.docId ? { docId: args.docId } : {}),
        },
        { merge: true },
      );
      return ref.id;
    }
  }

  const ref = col.doc();
  await ref.set({
    owner,
    projectId: args.projectId,
    ...(args.docId ? { docId: args.docId } : {}),
    title: titleFrom(turn),
    messages: trimForStore(turn),
    createdAt: now,
    updatedAt: now,
    costUsd: result.usage.costUsd ?? 0,
  });
  return ref.id;
}

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const params = new URL(req.url).searchParams;
    const col = adminDb().collection(NEANDER_COL.finContractChats);
    const id = params.get("id");
    if (id) {
      const snap = await col.doc(id).get();
      if (!snap.exists) return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
      return NextResponse.json({ chat: { id: snap.id, ...snap.data() } as ContractChatDoc });
    }
    const docId = params.get("docId");
    if (!docId) return NextResponse.json({ chats: [] });
    // 계약서 하나에 대화는 많아야 몇 개다 — 색인 없이 돌고, 정렬은 여기서 한다
    const snap = await col.where("docId", "==", docId).get();
    const chats = snap.docs
      .map((d) => summaryOf({ id: d.id, ...d.data() } as ContractChatDoc))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ chats });
  } catch (e) {
    console.error("[finance/ai/contract GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "대화를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const ref = adminDb().collection(NEANDER_COL.finContractChats).doc(id);
    const snap = await ref.get();
    const doc = snap.data() as ContractChatDoc | undefined;
    // 보는 것은 누구나, 지우는 것은 시작한 사람만
    if (!snap.exists || doc?.owner !== user.email) {
      return NextResponse.json({ error: "내가 시작한 대화만 지울 수 있습니다." }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[finance/ai/contract DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제에 실패했습니다." },
      { status: 500 },
    );
  }
}
