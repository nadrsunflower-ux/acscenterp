// ============================================================
//  중요한 메일 가려내기 — 규칙만 (AI 없음)
// ------------------------------------------------------------
//  안 읽은 받은 메일 중 「사람이 먼저 봐야 할 것」을 고른다. 목록에서 그
//  줄이 빨갛게 천천히 빛난다 (mail/page MailRow). 판정마다 **이유 한 줄**을
//  돌려준다 — 잘못 빛나면 왜 그랬는지 바로 보여야 규칙을 고칠 수 있다.
//
//  순서가 곧 우선순위다:
//    1. 우리가 보낸 메일에 온 답장                       → 중요 (대량 메일 표시가 있어도)
//    2. 대량 발송(수신 거부 머리) · (광고) 제목 · noreply → 제외
//    3. 팀원 · 우리가 예전에 메일을 보낸 사람             → 중요
//
//  **제목 낱말·「중요」 머리는 쓰지 않는다** (2026-09-23 실제 메일 ~480통으로
//  돌려 본 결과). 「계약·견적·마감·긴급·청구」가 들어간 모르는 사람의 메일 10통이
//  거의 전부 광고·청구서였고, 둘은 **피싱**(「긴급」「확인 요청」)이었다 — 피싱을
//  빨갛게 빛내면 오히려 누르게 만든다. 보낸 사람이 붙이는 중요 표시(X-Priority)도
//  피싱이 똑같이 붙일 수 있다. 모르는 사람의 메일은 빛나지 않는다.
//
//  「아는 사람」은 계정의 보낸메일함에서 만든다 (server/known.ts). 팀 공용
//  계정은 팀원 누가 보냈든 같은 보낸메일함이므로 팀 전체 기준이 된다.
//  서버에서만 부르지만 Firestore 를 타지 않는 순수 함수라 검증 스크립트가
//  그대로 부른다 (scripts/neander/verify-mail-importance.ts).
// ============================================================

import type { MailAddr } from "./types";

export interface ImportanceInput {
  from: MailAddr;
  subject: string;
  inReplyTo?: string | null;
  references?: string[];
  /** 수신 거부(List-Unsubscribe) · Precedence: bulk 같은 대량 발송 머리가 있다 */
  bulk?: boolean;
}

export interface ImportanceContext {
  /** 이 메일 계정의 주소들 (본 계정 + 외부 계정) — 소문자 */
  mine: Set<string>;
  /** 우리가 메일을 보낸 적 있는 주소 — 소문자 */
  known: Set<string>;
  /** 우리가 보낸 메일의 Message-ID */
  sentIds: Set<string>;
  /** 팀원 주소 — 소문자 */
  team: Set<string>;
}

/** 사람이 답장을 받지 않는 발신 주소 (로컬 부분) — no-reply-ecosupport · account_noreply · sendonly … */
const ROBOT = /(^|[-_.])(no[-_.]?reply|do[-_.]?not[-_.]?reply|no[-_.]?return|send[-_.]?only)([-_.]|$)|^(notifications?|mailer[-_.]?daemon|postmaster|bounces?|newsletters?)$/i;

/** 광고 표시 제목 — 정보통신망법이 광고 메일 제목 앞에 붙이게 한다 */
const AD_SUBJECT = /^\s*[(\[]\s*광고\s*[)\]]/;

const norm = (a: string | undefined) => (a ?? "").trim().toLowerCase();

/** 중요하면 그 이유, 아니면 null */
export function judgeImportance(m: ImportanceInput, ctx: ImportanceContext): string | null {
  const from = norm(m.from.address);
  if (!from || ctx.mine.has(from)) return null;

  const thread = [m.inReplyTo, ...(m.references ?? [])].filter((x): x is string => !!x);
  if (thread.some((id) => ctx.sentIds.has(id))) return "우리가 보낸 메일에 온 답장";

  const local = from.split("@")[0] ?? "";
  if (m.bulk || ROBOT.test(local) || AD_SUBJECT.test(m.subject)) return null;

  if (ctx.team.has(from)) return "팀원이 보낸 메일";
  if (ctx.known.has(from)) return "예전에 메일을 보낸 적 있는 사람";
  return null;
}
