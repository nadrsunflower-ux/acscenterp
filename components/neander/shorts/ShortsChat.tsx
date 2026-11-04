"use client";

// ============================================================
//  AI STUDIO 비서 — 공용 패널(assistant/AssistantChat)에 AI STUDIO 어댑터를 얹는다
// ------------------------------------------------------------
//  재무 · 매출 비서와 같은 원리다: 서버가 도구로 자료를 조회하고(server/assistant-tools.ts),
//  바꿀 것은 **제안**만 한다. 제안은 둘이다:
//    · 「트렌드 노트로 보관」 — 「노트에 보관」 을 누르면 시장 트렌드 화면과 같은 저장 경로
//      (market · note.save)로 나간다. 비서만의 뒷길은 없다.
//    · 「대본 작성기에서 열기」 — 저장 없는 링크. 참고(형식 · 공식 · 레이더)를 골라 둔 채로 연다.
//
//  보고 있는 영상: 영상 상세(/neander/shorts/projects/[id])에서 열면 그 영상 id 를 함께 보낸다.
//  내용은 서버가 읽는다 — 화면이 아는 제목은 머리 줄에 보여 주는 데만 쓴다. 공용 패널의 「보고 있는
//  거래」 칸(ai/focus.ts)은 재무 전용이라 쓰지 않고, 머리 줄(subtitle)에 「보고 있는 영상」 을 적는다.
//
//  화면 → 서버는 shortsGet · shortsPost(프로젝트 머리글 · 토큰)로. 대화 지우기만 DELETE 라 직접 부른다.
// ============================================================

import { useMemo, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, BookmarkPlus } from "lucide-react";
import { Badge, Button, cn } from "@/components/neander/ui";
import { AssistantChat, proposalLook, type AssistantAdapter, type AssistantResult } from "@/components/neander/assistant/AssistantChat";
import { callAssistant } from "@/components/neander/assistant/events";
import { getNeanderAuth } from "@/lib/neander/firebase";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { NOTE_SOURCE_LABEL, NOTE_STATUS_LABEL } from "@/lib/neander/shorts/market";
import { spaceKind } from "@/lib/neander/shorts/spaces";
import type { AgentMessage } from "@/lib/neander/ai/agent";
import type { AssistantChatDoc, AssistantChatSummary } from "@/lib/neander/ai/chat-log";
import type { ShortsProposal } from "@/lib/neander/shorts/server/assistant-tools";
import { useShorts } from "./ShortsProvider";

/** 첨부 원본 합계 — 서버(api/neander/shorts/assistant)와 같은 값. base64 로 실어 보내 1.33배로 불어난다 */
const ATTACH_MAX_BYTES = 3 * 1024 * 1024;
const CHAT_PATH = "assistant";
const VIDEO_PATH = /^\/neander\/shorts\/projects\/([^/?#]+)\/?$/;

function base64Of(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error(`${f.name} 을(를) 읽지 못했습니다.`));
    r.readAsDataURL(f);
  });
}

async function sendShortsChat(messages: AgentMessage[], model: string, files: File[], conversationId?: string, video?: string): Promise<AssistantResult<ShortsProposal>> {
  if (files.reduce((n, f) => n + f.size, 0) > ATTACH_MAX_BYTES) throw new Error("AI STUDIO 비서의 첨부는 합계 3MB 까지입니다. 필요한 부분만 잘라 올려 주세요.");
  const payload = files.length ? await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await base64Of(f) }))) : undefined;
  return shortsPost<AssistantResult<ShortsProposal>>(CHAT_PATH, { messages, model, conversationId, video, files: payload });
}

async function deleteShortsChat(id: string): Promise<void> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const res = await fetch(`/api/neander/shorts/${CHAT_PATH}/chats?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(b?.error || `삭제에 실패했습니다 (HTTP ${res.status})`);
  }
}

export function ShortsChat() {
  const { data, space, currentSpace } = useShorts();
  const router = useRouter();
  const pathname = usePathname();
  // 적용은 누른 그때의 프로젝트로 나간다 — 어댑터를 다시 만들지 않고 최신 값을 읽는다
  const spaceRef = useRef(space);
  spaceRef.current = space;

  // 영상 상세면 그 영상 — 볼 수 있는 목록에 있을 때만 (제목은 머리 줄 표시용)
  const videoId = useMemo(() => {
    const m = VIDEO_PATH.exec(pathname ?? "");
    return m ? decodeURIComponent(m[1]) : null;
  }, [pathname]);
  const video = videoId ? (data?.projects.find((p) => p.id === videoId) ?? null) : null;
  const videoRef = useRef<string | undefined>(undefined);
  videoRef.current = video?.id;

  const ownNames = (data?.spaces ?? []).filter((x) => !x.archived && spaceKind(x) === "own").map((x) => x.name);

  const adapter = useMemo<AssistantAdapter<ShortsProposal>>(() => {
    const here = currentSpace?.name ?? "지금 프로젝트";
    const examples = video
      ? ["이 영상 성과를 플랫폼별로 정리해 줘", "이 영상 진행 상황 — 남은 단계와 빠진 것", "이 영상과 비슷한 바이럴 형식 카드가 있어?", "이 영상 게시 문구를 같은 프로젝트의 잘된 영상과 비교해 줘"]
      : [
          "이번 달 게시한 영상 성과를 플랫폼별로",
          "요즘 떠오르는 바이럴 형식 3개와 우리가 만들기 쉬운 것",
          ownNames.length >= 2 ? `「${ownNames[0]}」 와 「${ownNames[1]}」 성과 비교` : "프로젝트별 성과 비교",
          "지금 프로젝트 영상 몇 편이고 단계별로 몇 편?",
          "레이더에서 정보 요청 댓글이 많은 후보 — 노트로 보관할 만한 것",
        ];
    return {
      name: "AI STUDIO 비서",
      subtitle: video ? `보고 있는 영상 · 「${video.title || "제목 없음"}」` : `${here} 기준 · 노트 보관 · 대본 열기는 제안만`,
      storagePrefix: "neander.shorts.chat",
      intro: (
        <>
          영상 · 게시 · 성과, 바이럴 형식 · 터진 영상 · AI 레이더 · 시장 브리핑에 대해 물어보세요. 기본은 지금 고른 프로젝트(
          <b className="text-nd-fg">{here}</b>)이고, 다른 프로젝트도 이름을 대면 견줘 드립니다. 내가 볼 수 있는 자료만 봅니다.
          {video && (
            <>
              {" "}
              지금 보고 있는 영상 <b className="text-nd-fg">「{video.title || "제목 없음"}」</b> 은 「이 영상」 이라고만 해도 알아듣습니다.
            </>
          )}{" "}
          노트 보관 · 대본 작성기 열기는 카드로 제안만 합니다 — <b className="text-nd-fg">카드에서 누르기 전에는 아무것도 저장되지 않습니다.</b> 질문 한 번에 보통 10원
          안쪽입니다(기본 모델 · 답 아래에 실제 비용).
        </>
      ),
      examples,
      inputPlaceholder: "영상 · 성과 · 형식 · 트렌드에 대해 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)",
      busyLabel: "AI STUDIO 자료를 보고 있습니다…",

      send: (messages, model, files, conversationId) => sendShortsChat(messages, model, files, conversationId, videoRef.current),
      listChats: async () => (await shortsGet<{ chats: AssistantChatSummary[] }>(`${CHAT_PATH}/chats`)).chats,
      loadChat: async (id) => (await shortsGet<{ chat: AssistantChatDoc<ShortsProposal> }>(`${CHAT_PATH}/chats?id=${encodeURIComponent(id)}`)).chat,
      deleteChat: deleteShortsChat,

      apply: async (p) => {
        // 노트는 프로젝트마다 따로 쌓인다 — 제안한 프로젝트와 지금 프로젝트가 다르면 엉뚱한 곳에 보관된다
        if (p.space !== spaceRef.current) throw new Error(`이 제안은 「${p.spaceName}」 프로젝트의 것입니다 — 위에서 그 프로젝트를 고른 뒤 다시 눌러 주세요.`);
        if (p.kind === "note") {
          await shortsPost("market", { action: "note.save", note: p.note });
          return;
        }
        router.push(p.href);
        // 모바일은 비서가 화면 전체를 덮는다 — 열어 준 대본 작성기가 보이게 닫는다
        if (window.matchMedia("(max-width: 767px)").matches) callAssistant("close");
      },
      proposalKey: (p) => p.id,
      renderProposal: (props) => <ShortsProposalCard {...props} />,
    };
  }, [currentSpace?.name, video, router, ownNames.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // 권한 없음 · 처음 받는 중에는 비서도 없다 (ShortsGate 가 그 화면을 그린다)
  if (!data) return null;
  return <AssistantChat adapter={adapter} />;
}

// ============================================================
//  제안 카드 — 무엇이 저장되는지(노트) · 어디로 가는지(대본) 보여 준다
// ============================================================

type Look = ReturnType<typeof proposalLook>;

function Chip({ look, label, children, className }: { look: Look; label: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("max-w-full rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-caption ring-1", look.ring, className)}>
      <span className="text-nd-fg-2">{label}</span> <b className="break-words text-nd-fg">{children}</b>
    </span>
  );
}

const REF_LABEL: Record<Extract<ShortsProposal, { kind: "script" }>["ref"]["kind"], string> = {
  format: "바이럴 형식 카드",
  template: "성공 공식",
  radar: "AI 레이더 후보",
  cut: "컷 표",
};

function ShortsProposalCard({
  proposal,
  applied,
  dismissed,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: ShortsProposal;
  applied: boolean;
  dismissed: boolean;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  // 누르면 초록, 무시하면 회색 — 저장됐는지(노트) · 열었는지(대본)가 색으로 보인다
  const look = proposalLook(applied, dismissed, "accent");
  const note = proposal.kind === "note";
  const actions = applied ? (
    <Badge tone="success">{note ? "보관함" : "열었음"}</Badge>
  ) : dismissed ? (
    <Badge>무시함</Badge>
  ) : (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
        무시
      </Button>
      <Button size="sm" icon={note ? BookmarkPlus : ArrowUpRight} onClick={onApply} disabled={busy}>
        {note ? "노트에 보관" : "대본 작성기 열기"}
      </Button>
    </div>
  );

  return (
    <div className={cn("rounded-nd-lg border p-3 transition-colors duration-nd", look.card)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-nd-body font-semibold text-nd-fg">
          <Badge tone={look.badge} size="sm" className="mr-1.5 align-middle">
            제안
          </Badge>
          {note ? "트렌드 노트로 보관" : "대본 작성기에서 열기"}
        </p>
        {actions}
      </div>
      {proposal.reason && <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>}

      {proposal.kind === "note" ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip look={look} label="제목">
              「{proposal.note.title}」
            </Chip>
            <Chip look={look} label="상태">
              {NOTE_STATUS_LABEL[proposal.note.status]}
            </Chip>
            <Chip look={look} label="출처">
              {proposal.note.source.label || NOTE_SOURCE_LABEL[proposal.note.source.kind]}
            </Chip>
            {proposal.note.snapshot && (
              <Chip look={look} label="그때 숫자">
                <span className="nd-num">{proposal.note.snapshot}</span>
              </Chip>
            )}
            {proposal.note.product && (
              <Chip look={look} label={proposal.productAi ? "제품 (AI 추정)" : "제품"}>
                {proposal.note.product}
              </Chip>
            )}
            {proposal.note.tags.length > 0 && (
              <Chip look={look} label="태그">
                {proposal.note.tags.map((t) => `#${t}`).join(" ")}
              </Chip>
            )}
          </div>
          {proposal.note.memo && (
            <p className={cn("mt-2 whitespace-pre-wrap break-words rounded-[6px] bg-nd-content px-2 py-1.5 text-nd-caption leading-relaxed text-nd-fg ring-1", look.ring)}>{proposal.note.memo}</p>
          )}
          <p className="mt-2 text-nd-caption leading-relaxed text-nd-fg-2">
            누르면 「{proposal.spaceName}」 의 <b className="text-nd-fg">시장 트렌드 › 트렌드 노트</b>에 보관합니다 (나만 보는 노트). 그때 숫자는 비서가 아니라 원본 자료에서 옮겼습니다.
            {proposal.note.source.url && (
              <>
                {" "}
                <a href={proposal.note.source.url} target="_blank" rel="noreferrer" className="font-medium text-nd-accent-strong underline-offset-2 hover:underline">
                  원본 보기
                </a>
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip look={look} label={REF_LABEL[proposal.ref.kind]}>
              「{proposal.ref.label}」
            </Chip>
            <Chip look={look} label="프로젝트">
              {proposal.spaceName}
            </Chip>
          </div>
          <p className="mt-2 text-nd-caption leading-relaxed text-nd-fg-2">저장하지 않습니다 — 대본 작성기가 이 참고를 골라 둔 채로 열립니다. 대본은 거기서 「대본 만들기」 를 눌러야 만들어집니다(AI 비용은 그때).</p>
        </>
      )}
    </div>
  );
}
