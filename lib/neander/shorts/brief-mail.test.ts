// 아침 브리핑 「메일로 받기」 — 설정 · 결과 적기 · 메일 본문 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_MAIL_MAX_FAILURES,
  DEFAULT_BRIEF_MAIL_PREF,
  applyBriefMailOutcome,
  briefDayLabel,
  briefMailDue,
  buildBriefMail,
  escapeHtml,
  marketUrl,
  readBriefMailPref,
  sanitizeBriefMailPref,
  type BriefMailPref,
  type BriefMailSection,
} from "./brief-mail";
import type { MarketBriefItem } from "./market";

const NOW = Date.parse("2026-11-04T00:00:00Z");
const item = (title: string, o: Partial<MarketBriefItem> = {}): MarketBriefItem => ({ kind: "product", title, why: "왜", numbers: "조회 12만 · 평소의 8배", action: "해 볼 것", ref: null, ...o });
const section = (o: Partial<BriefMailSection> = {}): BriefMailSection => ({
  spaceId: "salim",
  spaceName: "살림설계사무소",
  kind: "own",
  status: "ready",
  brief: { headline: "다이소 수납 영상이 이틀째 뜹니다", summary: ["주방 정리 형식이 일본에서 먼저 터졌습니다", "검색어 「수납」 이 오릅니다"], items: [item("슬라이딩 수납함"), item("무타공 선반"), item("욕실 선반"), item("넷째는 메일에 안 나온다")], at: NOW, by: "company" },
  ...o,
});

test("설정 — 기본 꺼짐 · 사람이 고치는 칸만 · 다시 켜면 저절로 끈 이유를 지운다", () => {
  assert.equal(readBriefMailPref(undefined).enabled, false);
  assert.deepEqual(readBriefMailPref({ enabled: true }), { ...DEFAULT_BRIEF_MAIL_PREF, enabled: true });
  const off = { ...DEFAULT_BRIEF_MAIL_PREF, failures: 3, autoOff: "3번 이어 …", lastSentDay: "2026-11-01" };
  const on = sanitizeBriefMailPref({ enabled: true, spaces: ["salim", "salim", "<script>"], all: false, lastSentDay: "가짜", failures: 0 }, off, NOW);
  assert.equal(on.enabled, true);
  assert.equal(on.all, false);
  assert.deepEqual(on.spaces, ["salim"]); // 겹침 · 이상한 id 는 뺀다
  assert.equal(on.failures, 0);
  assert.equal(on.autoOff, null);
  assert.equal(on.lastSentDay, "2026-11-01"); // 보낸 기록은 서버만 쓴다
  // 켜진 채 고치면 실패 횟수는 그대로
  assert.equal(sanitizeBriefMailPref({ spaces: [] }, { ...DEFAULT_BRIEF_MAIL_PREF, enabled: true, failures: 2 }, NOW).failures, 2);
});

test("결과 적기 — 보내면 실패 0 · 3번 이어 실패하면 저절로 끈다 · 건너뜀은 실패가 아니다", () => {
  let p: BriefMailPref = { ...DEFAULT_BRIEF_MAIL_PREF, enabled: true, sending: { day: "2026-11-04", until: NOW + 60_000 } };
  p = applyBriefMailOutcome(p, { kind: "failed", day: "2026-11-04", at: NOW, error: "SMTP 거절" });
  assert.equal(p.failures, 1);
  assert.equal(p.enabled, true);
  assert.equal(p.sending, null);
  p = applyBriefMailOutcome(p, { kind: "skipped", day: "2026-11-05", at: NOW, note: "오늘 브리핑 없음" });
  assert.equal(p.failures, 1);
  assert.equal(p.lastNote, "오늘 브리핑 없음");
  p = applyBriefMailOutcome(p, { kind: "failed", day: "2026-11-06", at: NOW, error: "SMTP 거절" });
  p = applyBriefMailOutcome(p, { kind: "failed", day: "2026-11-07", at: NOW, error: "비밀번호" });
  assert.equal(p.failures, BRIEF_MAIL_MAX_FAILURES);
  assert.equal(p.enabled, false);
  assert.match(p.autoOff ?? "", /3번 이어 보내지 못해 저절로 껐습니다 — 마지막 오류: 비밀번호/);
  const sent = applyBriefMailOutcome({ ...p, enabled: true, failures: 2 }, { kind: "sent", day: "2026-11-08", at: NOW });
  assert.equal(sent.failures, 0);
  assert.equal(sent.lastSentDay, "2026-11-08");
  assert.equal(sent.lastError, null);
});

test("같은 날 두 번 보내지 않는다", () => {
  const p = { ...DEFAULT_BRIEF_MAIL_PREF, enabled: true };
  assert.equal(briefMailDue(p, "2026-11-04", NOW), true);
  assert.equal(briefMailDue({ ...p, lastSentDay: "2026-11-04" }, "2026-11-04", NOW), false);
  assert.equal(briefMailDue({ ...p, lastSentDay: "2026-11-03" }, "2026-11-04", NOW), true);
  // 다른 실행이 보내는 중 (잡은 시간 안)
  assert.equal(briefMailDue({ ...p, sending: { day: "2026-11-04", until: NOW + 1 } }, "2026-11-04", NOW), false);
  assert.equal(briefMailDue({ ...p, sending: { day: "2026-11-04", until: NOW - 1 } }, "2026-11-04", NOW), true);
  assert.equal(briefMailDue({ ...p, enabled: false }, "2026-11-04", NOW), false);
});

test("메일 본문 — 헤드라인 · 특기 사항 3개 · ERP 에서 보기 · 브리핑 없는 프로젝트", () => {
  const m = buildBriefMail({
    day: "2026-11-04",
    origin: "https://erp.example.com/",
    to: "me@example.com",
    sections: [section(), section({ spaceId: "spabc", spaceName: "예시브랜드 주방", kind: "agency", status: "none", brief: null }), section({ spaceId: "spoff", spaceName: "꺼진 곳", status: "off", brief: null })],
  })!;
  assert.equal(m.subject, "[AI STUDIO] 11/4 (수) 아침 브리핑 · 살림설계사무소 — 다이소 수납 영상이 이틀째 뜹니다");
  assert.match(m.html, /다이소 수납 영상이 이틀째 뜹니다/);
  assert.match(m.html, /특기 사항 3개 \(AI\)/);
  assert.match(m.html, /무타공 선반/);
  assert.doesNotMatch(m.html, /넷째는 메일에 안 나온다/);
  assert.match(m.html, /나머지 1개는 ERP 에서 봅니다/);
  assert.match(m.html, /href="https:\/\/erp\.example\.com\/neander\/shorts\/market\?space=salim"/);
  assert.match(m.html, /예시브랜드 주방 — 오늘 브리핑 없음/);
  assert.match(m.html, /꺼진 곳 — 시장 트렌드 자동 실행이 꺼져 있음/);
  assert.match(m.text, /ERP 에서 보기: https:\/\/erp\.example\.com\/neander\/shorts\/market\?space=salim/);
  assert.match(m.text, /- \[뜨는 상품\] 슬라이딩 수납함 — 조회 12만 · 평소의 8배/);
  // 여러 프로젝트면 제목에 「외 n곳」
  const two = buildBriefMail({ day: "2026-11-04", origin: "https://e.com", to: "me", sections: [section(), section({ spaceId: "sp2", spaceName: "뭉치의 쇼핑인생" })] })!;
  assert.match(two.subject, /살림설계사무소 외 1곳/);
});

test("메일 본문 — AI 가 쓴 글은 HTML 로 믿지 않는다 (이스케이프)", () => {
  const evil = section({ spaceName: "<b>곳</b>", brief: { headline: '<img src=x onerror="alert(1)">', summary: ["<script>alert(1)</script>"], items: [item("a & b", { numbers: '"따옴표"' })], at: NOW, by: "me@x.com" } });
  const m = buildBriefMail({ day: "2026-11-04", origin: 'https://e.com/"><script>', to: "<me>", sections: [evil] })!;
  assert.doesNotMatch(m.html, /<script>/);
  assert.doesNotMatch(m.html, /<img/);
  assert.doesNotMatch(m.html, /<b>곳/);
  assert.match(m.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(m.html, /a &amp; b/);
  assert.match(m.html, /직접 만든 브리핑/);
  assert.equal(escapeHtml(`<'&">`), "&lt;&#39;&amp;&quot;&gt;");
  // 프로젝트 id 는 주소에 넣을 때 다시 감싼다
  assert.equal(marketUrl("https://e.com/", "a b"), "https://e.com/neander/shorts/market?space=a%20b");
});

test("브리핑이 하나도 없으면 보내지 않는다", () => {
  assert.equal(buildBriefMail({ day: "2026-11-04", origin: "https://e.com", to: "me", sections: [section({ status: "none", brief: null })] }), null);
  assert.equal(buildBriefMail({ day: "2026-11-04", origin: "https://e.com", to: "me", sections: [] }), null);
  assert.equal(briefDayLabel("2026-11-08"), "11/8 (일)");
});
