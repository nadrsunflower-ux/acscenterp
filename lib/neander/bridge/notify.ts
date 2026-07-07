// ============================================================
//  브릿지 — 메신저 자동 알림
//  개발허브(및 다른 모듈)의 이벤트를 '전체 팀 채팅'(team)으로 쏜다.
//  actor(행위자)가 없으면 조용히 스킵 — 알림은 항상 사람 명의로만 보낸다.
// ============================================================
import { sendMessage, TEAM_CONVERSATION } from "@/lib/neander/db/chat";

/** 알림 명의자 — useAppData().currentMember 에서 { id, name } 만 넘기면 된다 */
export interface NotifyActor {
  id: string;
  name: string;
}

/** 팀 전체방으로 한 줄 알림. 실패해도 원 작업을 막지 않는다(알림은 부가 효과). */
export async function notifyTeam(actor: NotifyActor | null | undefined, text: string) {
  if (!actor?.id || !text.trim()) return;
  try {
    await sendMessage({
      conversationId: TEAM_CONVERSATION,
      senderId: actor.id,
      senderName: actor.name,
      text,
    });
  } catch {
    // 알림 실패는 무시 — 본 작업(작업 생성/상태 변경 등)의 성공을 깨지 않는다
  }
}
