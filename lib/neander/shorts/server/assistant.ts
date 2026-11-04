import "server-only";

// ============================================================
//  AI STUDIO 비서 — 프롬프트 · 「지금 화면」 안내 · 실행 · 대화 기록
// ------------------------------------------------------------
//  도구 루프는 공용(lib/neander/ai/agent.ts)이다. 여기에는 AI STUDIO 가 아는 것 —
//  프로젝트(채널) · 영상 · 게시 · 성과 · 정찰 · 레이더 · 시장 트렌드의 뜻과 원칙 — 만 적는다.
//
//  「보고 있는 영상」: 영상 상세에서 비서를 열면 화면은 **영상 id 만** 보낸다. 내용은 서버가
//  볼 수 있는 영상 목록(데이터 API 와 같은 규칙)에서 직접 읽어 안내문을 만든다 — 브라우저가
//  보낸 글은 프롬프트에 넣지 않는다 (ai/focus.ts 와 같은 원칙. focus.ts 의 타입은 재무 전용이라
//  요청 본문의 video 칸으로 따로 받는다).
//
//  대화 기록은 사람마다 비공개 · 전역 컬렉션(neander_shorts_chats · rootDb)에 쌓는다 — 프로젝트를
//  오가며 이어 묻는 대화가 끊기지 않게. 문서에 어느 프로젝트에서 물었는지(spaceId · spaceIds)를 남긴다.
// ============================================================

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { runAgent, type AgentMessage, type AgentResult } from "@/lib/neander/ai/agent";
import { titleFrom, trimForStore, type AssistantChatDoc, type AssistantMessage } from "@/lib/neander/ai/chat-log";
import type { ExtractedAttachment } from "@/lib/neander/server/attachments";
import { KIND_LABEL, STAGE_LABEL } from "../model";
import { PRODUCTION_LABEL, SPACE_KIND_LABEL, spaceKind, spaceOf } from "../spaces";
import { SHORTS_TOOL_DEFS, runShortsTool, summarizeShortsTool, visibleVideos, ymd, type ShortsProposal, type ShortsToolContext } from "./assistant-tools";
import { rootDb } from "./space-db";

export type ShortsChatResult = AgentResult<ShortsProposal>;

const SYSTEM = `당신은 (주)네안데르 ERP 의 **AI STUDIO 비서**입니다. AI STUDIO 는 쇼츠 · 릴스 채널을 기획 · 제작 · 게시 · 분석하는 모듈이고, 이 비서는 그 자료를 **조회해 정리**합니다.

자료의 단위
- 「프로젝트」 = 채널 하나의 기획 단위 (도구의 space). 자체 운영(우리 채널)과 대행(계약 업체의 브랜드)이 있습니다. 대행 프로젝트는 AI STUDIO 관리자와 그 업체 담당자만 봅니다.
- 「영상」 = 한 편의 제작 기록 (도구의 video). 종류: 쿠팡 제휴 · 고객사 · 일반. 단계: 소재 조사 → 소스 수집 → 쿠팡 확인 → 대본·장면 → 편집·출력 → 게시 준비 → 게시됨 (보관).
- 「게시」 = 영상 한 편을 플랫폼 하나에 올린 기록. 한 영상이 YouTube 와 Instagram 에 올라가면 게시는 2건입니다. 플랫폼에서 직접 올린 것도 자동으로 연결돼 게시로 잡힙니다.
- 「성과」 = 게시물마다 받아 둔 숫자(공식 API 또는 직접 입력)입니다. 누적값이라 마지막 기록을 씁니다. 쿠팡 클릭 · 주문 · 수익은 게시물이 아니라 영상 단위입니다.
- 바이럴 형식 카드 · 터진 영상(정찰) · AI 레이더 후보 · 레퍼런스 컷 표 · 시장 트렌드 브리핑 · 트렌드 노트 · 대본 작성기 세션은 프로젝트마다 따로 쌓입니다. 트렌드 노트 · 대본은 사람마다 비공개라 이 사람 것만 보입니다.

할 수 있는 일
- 도구로 조회해 답하고 표로 정리합니다.
- \`propose_note\` 로 「트렌드 노트로 보관」 을 **제안**합니다 — 사람이 카드의 「노트에 보관」 을 눌러야 저장됩니다.
- \`propose_script\` 로 「대본 작성기에서 열기」 링크를 **제안**합니다 — 저장은 없습니다. 대본은 대본 작성기에서 사람이 만듭니다.

절대 규칙
1. 당신은 데이터를 바꿀 수 없습니다. 「저장했습니다 · 보관했습니다 · 바꿨습니다」 라고 말하지 말고 「보관하자고 제안했습니다 — 카드에서 누르면 저장됩니다」 라고 말하세요.
2. 숫자는 도구 결과에 있는 것만 씁니다. 합 · 비율을 직접 계산했다면 도구 숫자로 계산했다고 밝힙니다.
3. **모르는 값과 0 을 구분합니다.** 도구 결과에 없거나 null 인 숫자는 「—」(기록 없음)입니다. 0 으로 더하거나 「0회」 라고 쓰지 않습니다. 성과 합계는 숫자가 있는 게시만의 합이고, 숫자 없는 게시가 몇 건인지 함께 말합니다.
4. **AI 추정 칸을 사실처럼 말하지 않습니다.** 레이더의 ai_product · ai_category · ai_why, 바이럴 형식 카드의 ai_ 칸(설명 · 훅 · 구조 · AI 난이도 · 언어 의존 · 위험 — AI 가 영상을 보고 쓴 분석), 컷 표(초 · 장면 · 말 — AI 가 영상을 보고 적은 대략값), 브리핑 문장은 「AI 추정」 「AI 분석」 이라고 붙여 말합니다. 제목 키워드(title_trends)는 AI 가 아니라 제목 낱말을 센 것입니다 — 단위는 채널 수입니다. 조회수 · 배수 · 게시일 · 국내 상태(사람이 확인)는 사실 자료입니다.
5. **「영상 편수」 와 「게시 건수」 를 섞지 않습니다.** 영상 1편이 두 플랫폼에 올라가면 영상 1편 · 게시 2건입니다. 표에는 둘을 다른 열로 둡니다.
6. 고객사(대행) 영상은 「제작 완료」(완성 파일이 있음 · renders ≥ 1) · 「고객 승인」(고객이 검토 링크에서 승인했거나 담당자가 대신 기록) · 「납품」 을 구분합니다. 업체 화면은 고객 승인을 납품 기준으로 셉니다. 「완성 파일만 납품」 계약은 게시를 고객사가 하고, 파일을 실제로 넘겼다는 기록은 ERP 에 따로 없습니다 — 넘겼다고 단정하지 마세요. 「게시됨」 은 우리가 올린 게시 기록입니다.
7. 어느 프로젝트의 자료인지 밝힙니다. 기간을 정하지 않은 집계는 「전체 기간」 이라고 밝힙니다.
8. id 는 도구가 돌려준 것만 씁니다. 지어내지 않습니다.

도구 쓰는 법
- 기본은 지금 고른 프로젝트입니다(아래 「지금 화면」). 다른 프로젝트를 물으면 \`list_projects\` 로 id 를 찾아 space 에 넣습니다. 여러 프로젝트를 견줄 때는 \`performance\` 의 by=project 를 먼저 씁니다.
- 「이번 달」 「지난주」 같은 기간은 아래의 오늘 날짜로 정해 넣습니다 (month=YYYY-MM 또는 from/to). 성과의 기간은 **게시일** 기준이고, 숫자는 그 기간에 늘어난 양이 아니라 지금까지의 누적입니다 — 그렇게 말해 주세요.
- 영상 수 · 단계별 수는 \`list_videos\` 의 total · byStage 를 씁니다 (목록은 limit 만큼만 오지만 세는 것은 전체입니다).
- 결과가 잘렸으면(truncated) 일부만 보였다고 말합니다. 도구가 ok:false 를 돌려주면 그 이유를 사람에게 그대로 전합니다.
- 「우리가 만들기 쉬운 것」 은 형식 카드의 AI 난이도 · 언어 의존(AI 분석)과 프로젝트의 만드는 방식(직접 촬영 · AI 생성)을 함께 보고 판단하되, 판단 근거를 밝힙니다.

제안
- 사람이 원하거나 다음 행동을 물었을 때만 제안합니다. 한 답에 제안은 3개까지입니다.
- 노트는 근거 자료(레이더 후보 · 터진 영상 · 형식 카드 · 브리핑 날짜 · 검색어 묶음)의 id 를 source 로 답니다. 그때 숫자(snapshot)는 서버가 원본에서 다시 만듭니다.
- 노트 · 대본 제안은 **지금 고른 프로젝트** 자료로만 합니다. 다른 프로젝트 것이면 위에서 그 프로젝트를 고른 뒤 다시 물어 달라고 말합니다.

대화 태도
- 한국어로, 짧게. 견줄 때는 마크다운 표. 숫자는 천 단위 쉼표(조회 12,345).
- 화면은 마크다운 **표와 굵게만** 그립니다 — 제목(#) · 기울임(*) · 인용(>)은 기호가 그대로 보이니 쓰지 마세요. 목록은 「- 」 로 시작하는 줄로 씁니다.
- 근거가 된 조회 조건(프로젝트 · 기간 · 묶음)을 한 줄로 밝힙니다.
- 영상 · 형식은 제목으로 부르고, 사람이 묻지 않으면 id 를 쓰지 않습니다.

첨부 파일
- 사용자가 파일을 첨부하면 메시지 안에 "=== 첨부 파일: 이름 ===" 블록으로 추출된 텍스트가 들어옵니다. 첨부에만 있는 내용은 출처가 첨부임을 밝힙니다.`;

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 요청마다 달라지는 짧은 안내 — 오늘 · 지금 고른 프로젝트 · 보고 있는 영상.
 * 영상은 id 만 받아 서버가 볼 수 있는 목록에서 찾는다 (못 보는 영상이면 그렇다고만 적는다).
 */
export async function shortsFocusNote(ctx: ShortsToolContext, videoId?: string): Promise<{ note: string; video: { id: string; title: string } | null }> {
  const today = ymd(ctx.now)!;
  const cur = ctx.spaces.find((x) => x.id === ctx.current);
  const client = cur && spaceKind(cur) === "agency" ? ctx.clients.find((c) => c.id === cur.clientId) : undefined;
  const lines = [
    "== 지금 화면 ==",
    `오늘(한국 시간) ${today} (${DOW[new Date(`${today}T00:00:00Z`).getUTCDay()]})`,
    cur
      ? `지금 고른 프로젝트: ${cur.name} (id ${cur.id} · ${SPACE_KIND_LABEL[spaceKind(cur)]}${client ? ` · 업체 ${client.name}` : ""} · ${PRODUCTION_LABEL[cur.production]})`
      : "지금 고른 프로젝트: 알 수 없음",
    `볼 수 있는 프로젝트 ${ctx.spaces.filter((x) => !x.archived).length}개 — 목록은 list_projects`,
  ];
  let video: { id: string; title: string } | null = null;
  if (videoId) {
    const v = (await visibleVideos(ctx)).find((x) => x.id === videoId);
    if (v) {
      const sp = ctx.spaces.find((x) => x.id === spaceOf(v));
      video = { id: v.id, title: v.title };
      lines.push(
        `보고 있는 영상: 「${v.title.slice(0, 80) || "제목 없음"}」 (id ${v.id} · 프로젝트 ${sp?.name ?? spaceOf(v)} · ${KIND_LABEL[v.kind]} · ${STAGE_LABEL[v.stage]}). 사람이 「이 영상」 「이거」 라고 하면 이 영상입니다. 내용은 get_video 로 읽으세요.`,
      );
    } else {
      lines.push("보고 있는 영상: 비서가 읽을 수 없는 영상입니다 (다른 사람의 비공개 · 볼 수 없는 프로젝트 · 지워짐). 그 영상에 대해 물으면 읽을 수 없다고 말하세요.");
    }
  }
  return { note: lines.join("\n"), video };
}

/** AI 만 부르는 부분 — 대화를 저장하지 않는다 (검증 스크립트가 이것만 부른다) */
export async function runShortsChat(args: {
  messages: AgentMessage[];
  ctx: ShortsToolContext;
  model?: string;
  attachments?: ExtractedAttachment[];
  /** 보고 있는 영상 id (영상 상세에서 열었을 때) */
  videoId?: string;
}): Promise<ShortsChatResult & { focusVideo: { id: string; title: string } | null }> {
  const { note, video } = await shortsFocusNote(args.ctx, args.videoId);
  const result = await runAgent<ShortsProposal>(
    {
      system: SYSTEM,
      // 지금 화면은 캐시 뒤에 따로 — 영상 · 프로젝트가 바뀌어도 앞의 긴 부분 캐시가 깨지지 않는다
      note,
      tools: SHORTS_TOOL_DEFS,
      runTool: (name, a) => runShortsTool(name, a, args.ctx),
      summarize: summarizeShortsTool,
      referer: "https://neander-erp.local/shorts",
      title: "NEANDER ERP AI STUDIO Assistant",
    },
    { messages: args.messages, model: args.model, attachments: args.attachments },
  );
  return { ...result, focusVideo: video };
}

/** 대화 문서 — 공용 모양에 어느 프로젝트에서 물었는지를 더한다 */
export type ShortsChatDoc = AssistantChatDoc<ShortsProposal> & { spaceId?: string; spaceIds?: string[] };

const chatsCol = (db: Firestore) => rootDb(db).collection(NEANDER_COL.shortsChats);

/** 답을 만든 뒤 한 턴을 기록한다 — 남의 대화 id 를 보내면 새 대화로 */
export async function saveShortsChatTurn(args: { db: Firestore; owner: string; spaceId: string; conversationId?: string; question: string; result: ShortsChatResult }): Promise<string> {
  const { db, owner, question, result, spaceId } = args;
  const now = Date.now();
  const col = chatsCol(db);
  const turn: AssistantMessage<ShortsProposal>[] = [
    { role: "user", content: question, at: now },
    {
      role: "assistant",
      content: result.reply,
      at: now + 1,
      ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
      ...(result.proposals.length ? { proposals: result.proposals } : {}),
    },
  ];
  if (args.conversationId && /^[\w-]{6,60}$/.test(args.conversationId)) {
    const ref = col.doc(args.conversationId);
    const doc = (await ref.get()).data() as ShortsChatDoc | undefined;
    if (doc && doc.owner === owner) {
      await ref.set(
        {
          messages: trimForStore([...(doc.messages ?? []), ...turn]),
          updatedAt: now,
          costUsd: (doc.costUsd ?? 0) + (result.usage.costUsd ?? 0),
          spaceIds: FieldValue.arrayUnion(spaceId),
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
    spaceId,
    spaceIds: [spaceId],
  });
  return ref.id;
}

/** 내 대화 하나 — 소유자를 서버에서 확인한다 (id 만 알면 남의 대화가 열리면 안 된다) */
export async function getShortsChat(db: Firestore, owner: string, id: string): Promise<ShortsChatDoc | null> {
  if (!/^[\w-]{6,60}$/.test(id)) return null;
  const snap = await chatsCol(db).doc(id).get();
  const doc = snap.exists ? ({ ...(snap.data() as ShortsChatDoc), id: snap.id } as ShortsChatDoc) : null;
  return doc && doc.owner === owner ? doc : null;
}

export async function listShortsChats(db: Firestore, owner: string): Promise<ShortsChatDoc[]> {
  const snap = await chatsCol(db).where("owner", "==", owner).get();
  return snap.docs.map((d) => ({ ...(d.data() as ShortsChatDoc), id: d.id }));
}

export async function deleteShortsChat(db: Firestore, owner: string, id: string): Promise<boolean> {
  const doc = await getShortsChat(db, owner, id);
  if (!doc) return false;
  await chatsCol(db).doc(id).delete();
  return true;
}
