// ============================================================
//  중요 메일 판정 검증 (lib/neander/mail/importance.ts)
// ------------------------------------------------------------
//  Firestore 를 타지 않는다. 특히 **광고·알림·피싱이 빛나지 않는지**를
//  못 박는다 — 빨간 줄이 흔해지면 아무도 안 보고, 피싱이 빛나면 누르게 된다.
//  아래 「빛나지 않는다」 사례 상당수는 2026-09-23 실제 받은메일함에서 온 것이다.
//
//    npm run mail:verify-importance
// ============================================================

import { judgeImportance, type ImportanceContext, type ImportanceInput } from "@/lib/neander/mail/importance";

let bad = 0;
const ok = (c: boolean, m: string, extra = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${extra ? `  ${extra}` : ""}`);
  if (!c) bad++;
};

const ME = "hello@acscent.co.kr";
const ctx: ImportanceContext = {
  mine: new Set([ME]),
  known: new Set(["partner@vendor.com", "info@shop.kr"]),
  sentIds: new Set(["<sent-1@acscent.co.kr>"]),
  team: new Set(["teammate@acscent.co.kr"]),
};
const mail = (o: Partial<ImportanceInput>): ImportanceInput => ({
  from: { address: "stranger@else.com" },
  subject: "안녕하세요",
  ...o,
});
const judge = (o: Partial<ImportanceInput>) => judgeImportance(mail(o), ctx);

console.log("=== 중요로 본다 ===");
ok(!!judge({ inReplyTo: "<sent-1@acscent.co.kr>" }), "우리가 보낸 메일에 온 답장");
ok(!!judge({ references: ["<x@y>", "<sent-1@acscent.co.kr>"] }), "스레드 중간 어딘가가 우리 메일이어도 답장");
ok(!!judge({ inReplyTo: "<sent-1@acscent.co.kr>", bulk: true }), "답장이면 대량 발송 머리가 있어도 중요");
ok(!!judge({ from: { address: "Partner@Vendor.com" } }), "예전에 보낸 사람 (대소문자 무시)");
ok(!!judge({ from: { address: "teammate@acscent.co.kr" } }), "팀원");
ok(judge({ from: { address: "info@shop.kr" } }) === "예전에 메일을 보낸 적 있는 사람", "info@ 라도 우리가 보낸 적 있으면 중요 — 이유가 붙는다");

console.log("=== 빛나지 않는다 ===");
ok(judge({}) === null, "모르는 사람의 평범한 메일");
ok(judge({ subject: "CHANEL이 당신을 찾습니다 – 긴급 확인 요청" }) === null, "모르는 사람의 「긴급」 — 피싱이 쓰는 말이라 보지 않는다");
ok(judge({ subject: "[오늘 자정 마감] 혜택이 절반이 됩니다" }) === null, "모르는 사람의 「마감」 — 광고");
ok(judge({ subject: "[2026년 8월] 사용분 청구서" }) === null, "모르는 사람의 「청구」 — 청구서 알림");
for (const a of ["noreply@hecto.co.kr", "no-reply@accounts.google.com", "no-reply-ecosupport@navercorp.com",
  "account_noreply@navercorp.com", "noreply_kakaopay@kakaocorp.com", "comments-noreply@docs.google.com",
  "no_reply@trip11.co.kr", "sendonly@eyagi.co.kr", "easypay_noreturn@easypay.co.kr", "notifications@github.com",
  "MAILER-DAEMON@localhost.localdomain", "postmaster@webmail-086.cafe24.com", "newsletter@08liter.com"]) {
  ok(judgeImportance(mail({ from: { address: a } }), { ...ctx, known: new Set([...ctx.known, a.toLowerCase()]) }) === null, `기계 주소는 아는 주소여도 제외 — ${a}`);
}
ok(judge({ from: { address: "partner@vendor.com" }, bulk: true }) === null, "아는 사람이라도 뉴스레터(수신 거부 머리)는 제외");
ok(judge({ from: { address: "partner@vendor.com" }, subject: "(광고) 추석 특가" }) === null, "아는 사람이라도 (광고) 제목은 제외");
ok(judge({ from: { address: "partner@vendor.com" }, subject: "[ 광고 ] 신제품" }) === null, "[ 광고 ] 띄어 쓴 표시도");
ok(judge({ from: { address: "partner@vendor.com" }, subject: "광고 시안 확인 부탁드립니다" }) === "예전에 메일을 보낸 적 있는 사람", "제목 속 「광고」 낱말은 광고 표시가 아니다");
ok(judge({ from: { address: ME }, inReplyTo: "<sent-1@acscent.co.kr>" }) === null, "내가 나에게 보낸 메일");
ok(judge({ from: { address: "" } }) === null, "보낸 사람 주소 없음");

console.log(bad ? `\n${bad}건 실패` : "\n모두 통과");
process.exit(bad ? 1 : 0);
