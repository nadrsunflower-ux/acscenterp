import { adminDb } from "@/lib/neander/server/admin";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { requestDb } from "@/lib/neander/shorts/server/space-db";
import { loadShortsAssistantContext } from "@/lib/neander/shorts/server/assistant-tools";
import { runShortsChat, saveShortsChatTurn } from "@/lib/neander/shorts/server/assistant";
import { extractAttachmentText, type ExtractedAttachment } from "@/lib/neander/server/attachments";
import { ATTACH_EXTS, MAX_ATTACH_FILES, fileExt } from "@/lib/neander/ai/attachment-limits";
import type { AgentMessage } from "@/lib/neander/ai/agent";

// ============================================================
//  AI STUDIO 비서 채팅 — POST { messages, model?, conversationId?, video?, files? }
// ------------------------------------------------------------
//  매출 비서 라우트(sales/ai/chat)와 같은 구조다. 대화 기록만 받고, 자료는 서버가 Firestore 에서
//  직접 읽는다 (그 사람이 평소 보는 범위 — 데이터 API 와 같은 규칙 · server/assistant-tools.ts).
//  도구 루프도 서버에서 돈다.
//
//  ⚠️ 이 라우트는 AI STUDIO 자료를 쓰지 않는다. 쓰는 것은 대화 기록(neander_shorts_chats)뿐이다.
//     노트 보관 제안은 사람이 카드를 누를 때 시장 route 의 note.save 로 나간다.
//
//  video = 영상 상세에서 열었을 때 그 영상 id — 내용은 서버가 읽는다 (브라우저 글은 프롬프트에 넣지 않는다).
//
//  첨부: 화면 → 서버 호출은 JSON 하나(lib/neander/shorts/client.ts 의 shortsPost — 프로젝트 머리글 · 토큰)라
//  파일을 base64 로 싣는다. base64 는 1.33배로 불어나므로 원본 합계 3MB 까지 — Vercel 요청 본문
//  한도 4.5MB 안에 대화 기록 몫을 남긴다 (공용 패널의 4MB 선검사보다 작다 · 넘으면 화면이 먼저 막는다).
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_HISTORY = 20;
/** 원본 합계 — base64 로 불어나도 4.5MB 안 (화면 ShortsChat.tsx 의 선검사와 같은 값 · route 파일은 이름 있는 export 를 못 한다) */
const SHORTS_ATTACH_MAX_BYTES = 3 * 1024 * 1024;

interface FileIn {
  name?: unknown;
  type?: unknown;
  data?: unknown;
}

function toFiles(raw: unknown): File[] {
  const list = Array.isArray(raw) ? (raw as FileIn[]) : [];
  if (list.length > MAX_ATTACH_FILES) throw new Error(`첨부는 한 번에 ${MAX_ATTACH_FILES}개까지입니다.`);
  const files: File[] = [];
  let total = 0;
  for (const f of list) {
    const name = typeof f.name === "string" ? f.name.slice(0, 200) : "";
    if (!name || !ATTACH_EXTS.includes(fileExt(name))) throw new Error(`${name || "이름 없는 파일"}: 지원하지 않는 형식입니다 (PDF · docx · 엑셀 · hwpx · txt 만).`);
    if (typeof f.data !== "string") throw new Error(`${name}: 파일 내용이 비었습니다.`);
    const buf = Buffer.from(f.data, "base64");
    total += buf.length;
    if (total > SHORTS_ATTACH_MAX_BYTES) throw new Error("AI STUDIO 비서의 첨부는 합계 3MB 까지입니다. 필요한 부분만 잘라 올려 주세요.");
    files.push(new File([buf], name, { type: typeof f.type === "string" ? f.type : "" }));
  }
  return files;
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    // 지금 고른 프로젝트 — 대행 프로젝트면 관리자 · 그 업체 담당자인지 여기서 본다
    const db = await requestDb(req, adminDb(), email);
    const body = (await req.json()) as { messages?: unknown; model?: unknown; conversationId?: unknown; video?: unknown; files?: unknown };
    const messages = (Array.isArray(body.messages) ? (body.messages as AgentMessage[]) : [])
      .slice(-MAX_HISTORY)
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string");
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") throw new Error("마지막 메시지는 사용자 발화여야 합니다.");

    let attachments: ExtractedAttachment[] = [];
    const files = toFiles(body.files);
    if (files.length) attachments = await Promise.all(files.map(extractAttachmentText));

    const ctx = await loadShortsAssistantContext(db, email);
    const videoId = typeof body.video === "string" && /^[\w-]{3,120}$/.test(body.video) ? body.video : undefined;
    const result = await runShortsChat({ messages, ctx, model: typeof body.model === "string" ? body.model : undefined, attachments, videoId });

    // 답을 만든 뒤 기록한다 — 기록에 실패해도 답은 돌려준다
    let conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
    try {
      conversationId = await saveShortsChatTurn({ db, owner: email, spaceId: ctx.current, conversationId, question: messages[messages.length - 1].content, result });
    } catch (e) {
      console.error("[shorts/assistant 기록]", e);
    }
    return json({ ...result, conversationId });
  } catch (e) {
    console.error("[shorts/assistant]", e);
    return fail(e);
  }
}
