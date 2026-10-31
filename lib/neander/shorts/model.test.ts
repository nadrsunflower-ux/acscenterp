// 쇼핑쇼츠 계산·규칙 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCLOSURE,
  VIRTUAL_HUMAN_TAG,
  analysisToTemplate,
  buildCaption,
  captionLength,
  complianceBlockers,
  compareBy,
  countInfoRequests,
  cuesFromSegments,
  domesticLabel,
  draftFromTemplate,
  emptyAnalysis,
  emptyDomestic,
  emptyMetrics,
  emptyProject,
  fitScenesToCues,
  isCoupangAffiliateUrl,
  isCoupangProductUrl,
  coupangProductId,
  narrationLength,
  parseTimingNotes,
  platformFromUrl,
  projectTotals,
  publicationKey,
  renderBlockers,
  scanClaims,
  scoreTrend,
  startsWithDisclosure,
  systemChecks,
  timeSubtitles,
  toSrt,
  viewVelocity,
  youtubeVideoId,
} from "./model";
import type { MetricSnapshotView, ProjectDoc, ScriptLine, TrendDoc } from "./types";

const trend = (patch: Partial<TrendDoc["metrics"]> = {}, info?: Partial<TrendDoc["infoSample"]>) =>
  ({
    metrics: { ...emptyMetrics(), ...patch },
    infoSample: { sampled: null, matched: null, keywords: [], src: "manual", ...info },
  }) as Pick<TrendDoc, "metrics" | "infoSample">;

test("반응 점수: 모르는 지표는 0 이 아니라 빠지고, 빠진 것을 알린다", () => {
  const t = trend({ views: { v: 100_000, src: "api" }, likes: { v: 5_000, src: "api" }, comments: { v: 300, src: "api" } });
  const s = scoreTrend(t, { likes: 1, comments: 3, saves: 4, shares: 3, infoRequests: 6 });
  // 좋아요 50/천회 ×1 + 댓글 3/천회 ×3 = 59 ÷ 4 = 14.75
  assert.equal(s.score, 14.75);
  assert.deepEqual(s.missing.sort(), ["infoRequests", "saves", "shares"]);
  assert.match(s.formula, /1×좋아요\/천회 \+ 3×댓글\/천회/);
});

test("반응 점수: 조회수가 없으면 점수 없음 (0 이 아님)", () => {
  const s = scoreTrend(trend({ likes: { v: 10, src: "manual" } }));
  assert.equal(s.score, null);
});

test("반응 점수: 정보 요청은 댓글 표본 비율로 추정하고 출처를 추정으로 표시", () => {
  const t = trend(
    { views: { v: 10_000, src: "api" }, comments: { v: 200, src: "api" } },
    { sampled: 100, matched: 25 },
  );
  const s = scoreTrend(t, { likes: 0, comments: 0, saves: 0, shares: 0, infoRequests: 1 });
  const info = s.used.find((u) => u.key === "infoRequests");
  assert.equal(info?.src, "estimate");
  assert.equal(info?.perK, 5); // 200 × 25% = 50 / 10,000 × 1000
  assert.equal(s.score, 5);
});

test("정보 요청 댓글 세기 — 한·영·중", () => {
  const r = countInfoRequests(["이거 어디서 사요?", "좋네요", "link pls", "求链接", "제품명 알려주세요"]);
  assert.deepEqual(r, { sampled: 5, matched: 4 });
});

test("증가 속도: 두 번 모았으면 실제 증가, 아니면 누적 평균이라고 밝힌다", () => {
  const day = 86_400_000;
  const base = { publishedAt: null, collectedAt: 10 * day, metrics: emptyMetrics() };
  const h = viewVelocity({ ...base, viewHistory: [{ at: 0, views: 1000, src: "api" }, { at: 2 * day, views: 5000, src: "api" }] });
  assert.equal(h.basis, "history");
  assert.equal(Math.round(h.perDay!), 2000);
  const p = viewVelocity({
    ...base,
    viewHistory: [],
    publishedAt: new Date(0).toISOString(),
    metrics: { ...emptyMetrics(), views: { v: 10_000, src: "api" } },
  });
  assert.equal(p.basis, "since_publish");
  assert.match(p.label, /누적 평균/);
});

test("국내 확산 문구는 「미확산」 으로 단정하지 않는다", () => {
  const d = { ...emptyDomestic(), status: "none_in_sample" as const, method: "api" as const, sampleSize: 16 };
  const l = domesticLabel(d);
  assert.match(l.text, /찾지 못함/);
  assert.match(l.text, /뜻하지는 않습니다/);
  assert.doesNotMatch(l.text, /유행하지 않/);
});

test("쿠팡 주소 판별", () => {
  assert.ok(isCoupangProductUrl("https://www.coupang.com/vp/products/123456?itemId=1"));
  assert.ok(!isCoupangProductUrl("https://coupang.com.evil.example/vp/products/1"));
  assert.ok(!isCoupangProductUrl("https://user:pw@www.coupang.com/vp/products/1"));
  assert.ok(isCoupangAffiliateUrl("https://link.coupang.com/a/bXyZ12"));
  assert.ok(!isCoupangAffiliateUrl("https://link.coupang.com.evil.example/a/bXyZ12"));
  assert.equal(coupangProductId("https://www.coupang.com/vp/products/987654321"), "987654321");
});

test("플랫폼·YouTube id 판별", () => {
  assert.equal(platformFromUrl("https://www.xiaohongshu.com/explore/abc"), "xiaohongshu");
  assert.equal(platformFromUrl("https://xhslink.com/a/x"), "xiaohongshu");
  assert.equal(youtubeVideoId("https://www.youtube.com/shorts/jnD00wWWhqo"), "jnD00wWWhqo");
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=jnD00wWWhqo"), "jnD00wWWhqo");
  assert.equal(youtubeVideoId("https://youtu.be/jnD00wWWhqo"), "jnD00wWWhqo");
});

test("확인되지 않은 주장 찾기 — 사실 목록에 있는 말은 넘어간다", () => {
  const flags = scanClaims("오늘만 50% 할인! 품절 임박, 내돈내산 후기, 링크 눌러주시면 도움돼요. 쿠팡 미쳤다", []);
  const kinds = new Set(flags.map((f) => f.kind));
  for (const k of ["discount", "scarcity", "review", "invalid_click"]) assert.ok(kinds.has(k as never), k);
  assert.ok(flags.some((f) => f.phrase.includes("쿠팡 미쳤")));
  const ok = scanClaims("확인 가격 12,900원", ["2026-10-31 쿠팡 확인 가격 12,900원"]);
  assert.equal(ok.length, 0);
});

function project(): ProjectDoc {
  const p = emptyProject("a@x.com", { product: "접이식 선반" });
  p.publish.description = "좁은 주방 정리";
  p.publish.hashtags = ["주방정리", "#살림템"];
  p.cta = { type: "comment_keyword", keyword: "선반", wording: "제품 정보는 댓글에 「선반」 남겨 주세요", atSec: null };
  p.coupang.candidates = [
    {
      id: "c1",
      url: "https://www.coupang.com/vp/products/1",
      productId: "1",
      name: "접이식 선반",
      brand: "",
      model: "",
      size: "",
      material: "",
      spec: "",
      options: "",
      price: null,
      saleStatus: "unknown",
      checkedAt: 1,
      source: "manual",
      comparison: "",
      match: "identical",
      checks: { brand: true, model: true, size: true, material: null, options: null, appearance: true },
      confirmedBy: "a@x.com",
      confirmedAt: 2,
    },
  ];
  p.coupang.affiliate = { url: "https://link.coupang.com/a/abc123", candidateId: "c1", subId: "", method: "manual", issuedAt: 3, by: "a@x.com", coupangOwner: "a@x.com", accountId: null };
  return p;
}

test("게시 문구: 고지가 항상 첫 줄 · YouTube 만 링크 · 해시태그 정리", () => {
  const p = project();
  p.publish.description = `${DISCLOSURE}\n좁은 주방 정리`;
  const yt = buildCaption(p, "youtube");
  const ig = buildCaption(p, "instagram");
  assert.ok(yt.startsWith(DISCLOSURE));
  assert.equal(yt.split(DISCLOSURE).length, 2, "고지가 두 번 들어가지 않는다");
  assert.match(yt, /제품 정보: https:\/\/link\.coupang\.com\/a\/abc123/);
  assert.doesNotMatch(ig, /link\.coupang\.com/);
  assert.match(ig, /#주방정리 #살림템/);
  assert.ok(startsWithDisclosure(ig));
  p.virtualHuman = true;
  assert.ok(buildCaption(p, "instagram").startsWith(`${VIRTUAL_HUMAN_TAG} ${DISCLOSURE}`));
  assert.ok(captionLength("가".repeat(10), "youtube") === 30);
});

test("정책 확인: 프로그램 확인과 사람 확인을 나누고, 사람 확인 없이는 막는다", () => {
  const p = project();
  const caption = buildCaption(p, "youtube");
  const sys = systemChecks(p, caption, { coupangChannel: null, owner: "a@x.com" }, { overlay: { disclosure: true, text: "광고" } }, 100);
  assert.equal(sys.disclosure?.ok, true);
  assert.equal(sys.videoDisclosure?.ok, true);
  assert.equal(sys.productMatch?.ok, true);
  assert.equal(sys.channelRegistered?.ok, false);
  const checks = Object.fromEntries(Object.entries(sys).map(([k, v]) => [k, { system: v, user: null }]));
  const blockers = complianceBlockers(checks);
  assert.ok(blockers.some((b) => b.key === "channelRegistered"));
  assert.ok(blockers.every((b) => b.key !== "sourceRights"), "출처·이용 조건은 선택 항목이라 막지 않는다");
  // 사람이 모두 확인해도 프로그램이 실패한 필수 항목(채널 등록 기록 없음)은 여전히 막는다
  const userOk = { ok: true, by: "a@x.com", at: 1, note: "" };
  const all = Object.fromEntries(Object.entries(sys).map(([k, v]) => [k, { system: v, user: userOk }]));
  // DM 운영은 프로그램이 볼 수 없어 사람 확인만 있다 — 빠지면 막힌다
  assert.deepEqual(complianceBlockers(all).map((b) => b.key), ["channelRegistered", "dmConsent"]);
  assert.deepEqual(complianceBlockers({ ...all, dmConsent: { system: null, user: userOk } }).map((b) => b.key), ["channelRegistered"]);
});

test("정책 확인: 제휴 링크가 확인한 상품이 아니면 일치 실패", () => {
  const p = project();
  p.coupang.affiliate!.candidateId = "other";
  const sys = systemChecks(p, buildCaption(p, "youtube"), null, null);
  assert.equal(sys.productMatch?.ok, false);
  assert.equal(sys.videoDisclosure?.ok, false);
});

test("자막: 글자 수 비례 · 끝은 전체 길이 · SRT 형식", () => {
  const lines: ScriptLine[] = [
    { id: "a", beat: "hook", text: "짧은 말", caption: "", sceneId: null },
    { id: "b", beat: "demo", text: "조금 더 긴 문장입니다 여기", caption: "자막은 따로", sceneId: null },
  ];
  const cues = timeSubtitles(lines, 10);
  assert.equal(cues.length, 2);
  assert.equal(cues[1].end, 10);
  assert.equal(cues[1].text, "자막은 따로");
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\n짧은 말\n\n2\n/);
  assert.match(srt, /00:00:10,000\n자막은 따로\n$/);
});

test("AI 음성 줄 길이로 자막·장면 맞추기", () => {
  const lines: ScriptLine[] = [
    { id: "a", beat: "hook", text: "하나", caption: "", sceneId: "s1" },
    { id: "b", beat: "demo", text: "둘", caption: "", sceneId: "s2" },
  ];
  const cues = cuesFromSegments(lines, [{ lineId: "a", duration: 1.5 }, { lineId: "b", duration: 2 }], 0.2);
  assert.deepEqual(cues.map((c) => [c.start, c.end]), [[0, 1.5], [1.7, 3.7]]);
  assert.equal(narrationLength({ kind: "ai", duration: null, gapSec: 0.2, segments: [{ duration: 1.5 }, { duration: 2 }] as never }), 3.7);
  const scenes = fitScenesToCues(
    [
      { id: "s1", kind: "clip", label: "", duration: 5, clip: { fileId: "f", start: 1, end: 6, sourceId: null, segmentId: null }, ai: null, image: null, keepAudio: false },
      { id: "s2", kind: "blank", label: "", duration: 9, clip: null, ai: null, image: null, keepAudio: false },
    ],
    lines,
    cues,
    () => 2.2,
  );
  assert.equal(scenes[0].clip!.end, 2.2, "원본 길이를 넘기지 않는다");
  assert.equal(scenes[1].duration, 2.15);
});

test("출력 막기: 승인 안 된 AI 장면 · 파일 없는 클립", () => {
  const p = emptyProject("a@x.com");
  p.scenes = [
    { id: "1", kind: "ai", label: "AI", duration: 3, clip: null, image: null, keepAudio: false, ai: { prompt: "", status: "review", jobId: null, fileId: "f", model: null, reviewNote: "" } },
    { id: "2", kind: "clip", label: "원본", duration: 2, clip: null, ai: null, image: null, keepAudio: false },
  ];
  const b = renderBlockers(p);
  assert.ok(b.some((x) => /승인/.test(x)));
  assert.ok(b.some((x) => /원본 파일/.test(x)));
});

test("구성 시각 메모 → 구간, 분석 → 템플릿 → 다른 상품 초안", () => {
  const { beats, cuts } = parseTimingNotes("0:00-0:02 후킹 컷 2\n0:02-0:06 문제 제기\n6-12 제품 등장 사용 장면\n12-15 댓글 CTA");
  assert.deepEqual(beats.map((b) => b.key), ["hook", "problem", "reveal", "cta"]);
  assert.equal(cuts, 2);
  const a = { ...emptyAnalysis(), beats: beats.map((b) => ({ ...b, pattern: b.key === "reveal" ? "{상품} 하나면 {특징}" : "{문제}" })), totalSec: 15 };
  const t = analysisToTemplate(a);
  assert.equal(t.beats[0].from, 0);
  assert.equal(t.beats[3].to, 1);
  const d = draftFromTemplate({ ...t, cta: a.cta }, { product: "미니 청소기", problem: "틈새 먼지", facts: ["무선으로 쓴다"], keyword: "청소", targetSec: 30 });
  assert.equal(d.lines.length, 4);
  assert.equal(d.lines[2].text, "미니 청소기 하나면 무선으로 쓴다");
  assert.equal(d.lines[0].sceneId, d.scenes[0].id);
  assert.equal(Math.round(d.scenes.reduce((n, s) => n + s.duration, 0)), 30);
});

test("게시 중복 열쇠: 같은 계정·파일·플랫폼은 같고, 하나라도 다르면 다르다", () => {
  const k = publicationKey("acc1", "render1", "youtube");
  assert.equal(k, publicationKey("acc1", "render1", "youtube"));
  assert.notEqual(k, publicationKey("acc1", "render1", "instagram"));
  assert.notEqual(k, publicationKey("acc2", "render1", "youtube"));
  assert.notEqual(k, publicationKey("acc1", "render2", "youtube"));
  assert.match(k, /^[\w-]+$/);
});

test("성과 합계: 게시물별 최신값 · API 우선 · 게시물끼리 합산 · 모르면 null", () => {
  const s = (id: string, at: number, source: MetricSnapshotView["source"], pub: string | null, values: MetricSnapshotView["values"]) =>
    ({ id, owner: "a", projectId: "p", publicationId: pub, platform: "youtube", at, source, values, note: "", by: "a" }) as MetricSnapshotView;
  const t = projectTotals([
    s("1", 1, "youtube_api", "pubY", { views: 100, likes: 5 }),
    s("2", 2, "youtube_api", "pubY", { views: 150, likes: 6 }),
    s("3", 3, "manual", "pubY", { views: 999, infoRequests: 4 }),
    s("4", 1, "manual", "pubI", { views: 50 }),
  ]);
  assert.equal(t.views, 200, "API 150 + 인스타 50 (직접 입력 999 는 API 가 있어 안 씀)");
  assert.equal(t.infoRequests, 4);
  assert.equal(t.clicks, null);
  const rows = compareBy("cta", [{ project: emptyProject("a"), totals: t, templateName: null }]);
  assert.equal(rows[0].infoRate, 0.02);
  assert.equal(rows[0].partial, 1);
});

test("정책 확인: 다른 사람의 쿠팡 링크를 내 계정에 올리면 상품 일치 실패 (사람 확인으로 못 넘김)", () => {
  const p = project();
  p.coupang.affiliate!.coupangOwner = "b@x.com";
  const sys = systemChecks(p, buildCaption(p, "youtube"), { coupangChannel: { registered: true, by: "a@x.com", at: 1, url: "" }, owner: "a@x.com" }, { overlay: { disclosure: true, text: "광고" } });
  assert.equal(sys.productMatch?.ok, false);
  assert.match(sys.productMatch!.detail, /b@x\.com 님의 쿠팡 파트너스 링크/);
  const userOk = { ok: true, by: "a@x.com", at: 1, note: "" };
  const all = Object.fromEntries(Object.entries(sys).map(([k, v]) => [k, { system: v, user: userOk }]));
  assert.ok(complianceBlockers({ ...all, dmConsent: { system: null, user: userOk } }).some((b) => b.key === "productMatch"));
  p.coupang.affiliate!.coupangOwner = "a@x.com";
  assert.equal(systemChecks(p, buildCaption(p, "youtube"), { coupangChannel: null, owner: "a@x.com" }, null).productMatch?.ok, true);
});

test("성과 비교: 사람별로 묶기", () => {
  const a = emptyProject("a@x.com");
  const b = emptyProject("b@x.com");
  const t = projectTotals([]);
  const rows = compareBy("owner", [
    { project: a, totals: { ...t, views: 100 }, templateName: null },
    { project: b, totals: { ...t, views: 50 }, templateName: null },
    { project: emptyProject("a@x.com"), totals: { ...t, views: 10 }, templateName: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.key, r.projects, r.views]), [["a@x.com", 2, 110], ["b@x.com", 1, 50]]);
});

// ---- 브랜드 대행 ----
import { brandComplianceItems, brandDisclosureLine, monthProgress, overlayFor } from "./model";

function brandProject(): ProjectDoc {
  const p = emptyProject("a@x.com", { product: "바디 오일" });
  p.kind = "brand";
  p.clientId = "cl1";
  p.clientName = "그린브랜드";
  p.publish.description = "건조한 겨울 피부";
  p.script.lines = [{ id: "l1", beat: "hook", text: "피부가 당길 때", caption: "", sceneId: null }];
  return p;
}

test("브랜드: 우리 채널이면 첫 줄 「광고 · 브랜드 유료 광고」, 고객사 계정이면 고지 없음 · 쿠팡 문구 없음", () => {
  const p = brandProject();
  const ownChannel = buildCaption(p, "instagram", { ownBrandAccount: false });
  assert.ok(ownChannel.startsWith(brandDisclosureLine("그린브랜드")));
  assert.doesNotMatch(ownChannel, /쿠팡/);
  const clientAccount = buildCaption(p, "instagram", { ownBrandAccount: true });
  assert.ok(clientAccount.startsWith("건조한 겨울 피부"));
  assert.equal(overlayFor({ ...p, brandTarget: "client" }), "");
  assert.match(overlayFor({ ...p, brandTarget: "own" }), /^광고 · 그린브랜드 유료 광고/);
});

test("브랜드: 고객 승인한 그 파일만 · 금지 표현은 사실 목록에 있어도 걸림 · 쿠팡 항목 없음", () => {
  const p = brandProject();
  p.facts = ["무조건 촉촉"];
  p.script.lines[0].text = "무조건 촉촉, 1위 오일";
  const items = brandComplianceItems(true);
  assert.deepEqual(items.map((i) => i.key), ["clientApproval", "claims", "sourceRights"]);
  let sys = systemChecks(p, buildCaption(p, "instagram", { ownBrandAccount: true }), { coupangChannel: null, owner: "a@x.com", clientId: "cl1" }, { id: "r2", overlay: null }, 1, ["1위"]);
  assert.equal(sys.clientApproval?.ok, false);
  assert.match(sys.claims!.detail, /「1위」\(금지 표현\)/);
  assert.equal(sys.disclosure, undefined, "고객사 계정이면 고지 항목 자체가 없다");
  p.review = {
    state: "approved",
    revisionsUsed: 1,
    rounds: [
      { n: 1, renderId: "r1", sentAt: 1, sentBy: "a", decision: "revision", feedback: "색 바꿔 주세요", decidedBy: "김담당", decidedVia: "link", decidedAt: 2, extra: false },
      { n: 2, renderId: "r2", sentAt: 3, sentBy: "a", decision: "approved", feedback: "", decidedBy: "김담당", decidedVia: "link", decidedAt: 4, extra: false },
    ],
  };
  sys = systemChecks(p, "x", { coupangChannel: null, owner: "a@x.com", clientId: "cl1" }, { id: "r1", overlay: null }, 1, []);
  assert.equal(sys.clientApproval?.ok, false, "승인 전 파일(1차)은 게시 못 함");
  sys = systemChecks(p, "x", { coupangChannel: null, owner: "a@x.com", clientId: "cl1" }, { id: "r2", overlay: null }, 1, []);
  assert.equal(sys.clientApproval?.ok, true);
  // 사람 확인 없이도 승인은 통과, 없으면 사람 확인으로 못 넘긴다
  const userOk = { ok: true, by: "a", at: 1, note: "" };
  const checks = Object.fromEntries(Object.entries(sys).map(([k, v]) => [k, { system: v, user: k === "clientApproval" ? null : userOk }]));
  assert.deepEqual(complianceBlockers(checks, items), []);
  const failed = { ...checks, clientApproval: { system: { ok: false, detail: "x", at: 1 }, user: userOk } };
  assert.deepEqual(complianceBlockers(failed, items).map((b) => b.key), ["clientApproval"]);
});

test("브랜드: 우리 채널이면 고지 · 영상 안 고지 확인", () => {
  const p = brandProject();
  p.brandTarget = "own";
  const sys = systemChecks(p, buildCaption(p, "youtube", { ownBrandAccount: false }), { coupangChannel: null, owner: "a@x.com", clientId: null }, { id: "r1", overlay: { disclosure: true, text: overlayFor(p) } }, 1, []);
  assert.equal(sys.disclosure?.ok, true);
  assert.equal(sys.videoDisclosure?.ok, true);
  assert.deepEqual(brandComplianceItems(false).map((i) => i.key), ["disclosure", "videoDisclosure", "clientApproval", "claims", "sourceRights"]);
});

test("고객사 월 진행 집계", () => {
  const mk = (state: ProjectDoc["review"]["state"], stage: ProjectDoc["stage"]) => ({ review: { state, rounds: [], revisionsUsed: 0 }, stage });
  assert.deepEqual(monthProgress([mk("approved", "published"), mk("waiting", "ready"), mk("revision", "editing")], 8), { planned: 8, made: 3, approved: 1, published: 1, waiting: 1, revision: 1 });
});
