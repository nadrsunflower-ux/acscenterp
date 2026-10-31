// ============================================================
//  바이럴 형식 정찰 서버 검증 — 실제 Firestore 에서 (YouTube · AI 는 전부 모의 응답)
// ------------------------------------------------------------
//   npm run shorts:verify-scout
//
//  검증용 채널 · 영상 id(UCscoutverify… · sv…)와 검증용 이메일로 문서를 만들고 끝나면 지운다.
//  실제 주간 보고 문서는 건드리지 않는다 (보고 저장은 1999-W01 로 시험하고 지운다).
//
//  보는 것: 훑기(평소 조회수 · 배수 · 터짐 판정 · 다시 훑기의 숫자 갱신 · 사람 필드 지키기) ·
//  영상 분석 요청 모양(YouTube 주소를 video_url 로) · 지어낸 카드 id 버리기 · 한글 댓글 ·
//  새 형식 카드 · 국내 확인 · 지우기 권한 · 카드 지우면 묶음 풀림 · 보고 저장(요약 남기기)
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import { DEFAULT_SCOUT_SETTINGS, buildReport, formatStats } from "@/lib/neander/shorts/scout";
import * as Y from "@/lib/neander/shorts/server/youtube-data";
import * as AI from "@/lib/neander/shorts/server/scout-ai";
import * as SS from "@/lib/neander/shorts/server/scout-store";
import * as SR from "@/lib/neander/shorts/server/scout-run";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "verify-key";

const ME = "scout-verify-a@test.invalid";
const CH = "UCscoutverify00000000000"; // 24자
const DAY = 86_400_000;
let fails = 0;
const ok = (cond: unknown, label: string, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};
const rejects = async (p: Promise<unknown>, re: RegExp, label: string) => {
  try {
    await p;
    ok(false, label, "오류가 나야 하는데 통과함");
  } catch (e) {
    ok(re.test(e instanceof Error ? e.message : String(e)), label, e instanceof Error ? e.message.slice(0, 90) : "");
  }
};

const vid = (n: number) => `sv${String(n).padStart(9, "0")}`; // 11자
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// 채널의 영상: 0~9 = 10~40일 전 · 조회 2만(평소) · 10 = 2일 전 30만(15배) · 11 = 3일 전 5만(2.5배) · 12 = 긴 영상
const views = new Map<string, number>([...Array.from({ length: 10 }, (_, i) => [vid(i), 20_000] as const), [vid(10), 300_000], [vid(11), 50_000], [vid(12), 900_000]]);
const published = new Map<string, string>([...Array.from({ length: 10 }, (_, i) => [vid(i), iso(10 + i * 3)] as const), [vid(10), iso(2)], [vid(11), iso(3)], [vid(12), iso(1)]]);
const calls: string[] = [];
let aiBody: Record<string, unknown> | null = null;

const fakeFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  calls.push(url.split("?")[0]);
  const u = new URL(url);
  if (u.pathname.endsWith("/playlistItems")) {
    ok(u.searchParams.get("playlistId") === `UU${CH.slice(2)}`, "업로드 목록은 UC → UU 재생목록으로 읽는다");
    return json({ items: [...views.keys()].map((id) => ({ contentDetails: { videoId: id, videoPublishedAt: published.get(id) } })) });
  }
  if (u.pathname.endsWith("/videos")) {
    const ids = (u.searchParams.get("id") ?? "").split(",");
    return json({
      items: ids.filter((id) => views.has(id)).map((id) => ({
        id,
        snippet: { title: `검증 영상 ${id}`, channelTitle: "검증 채널", publishedAt: published.get(id), channelId: CH },
        statistics: { viewCount: String(views.get(id)), likeCount: "10", commentCount: "5" },
        contentDetails: { duration: id === vid(12) ? "PT10M" : "PT30S" },
      })),
    });
  }
  if (u.pathname.endsWith("/channels")) return json({ items: [{ id: CH, snippet: { title: "검증 채널", customUrl: "@scoutverify" }, statistics: { hiddenSubscriberCount: true } }] });
  if (u.pathname.endsWith("/commentThreads")) {
    const texts = ["wow", "이거 어디서 사요", "amazing", "ㅋㅋ 대박"];
    return json({ items: texts.map((t) => ({ snippet: { topLevelComment: { snippet: { textDisplay: t } } } })) });
  }
  if (url.includes("openrouter.ai/api/v1/chat/completions")) {
    aiBody = JSON.parse(String(init.body));
    return json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              formatName: "검증 형식",
              summary: "거대한 제품이 도시에 나타난다",
              hook: "첫 프레임에 빌딩만 한 병",
              structure: ["도심 전경", "제품 등장", "사람들 반응"],
              editing: "드론 샷 하나",
              sound: "효과음",
              textOverlay: "없음",
              whyItWorks: "비현실적 크기",
              languageDependence: "visual",
              aiFeasibility: { level: "easy", easyParts: "도시 · 카메라", hardParts: "라벨 글자" },
              risks: ["music", "nonsense"],
              riskNote: "",
              brandIdeas: ["향수병이 남산타워 옆에"],
              koreanQueries: ["거대 제품 광고"],
              totalSec: 12,
              cutCount: 1,
              match: { formatId: "invented-id-123", reason: "비슷함" },
            }),
          },
        },
      ],
      usage: { cost: 0.003 },
    });
  }
  throw new Error(`모의 응답 없는 외부 호출: ${url.split("?")[0]}`);
}) as typeof fetch;

async function main() {
  const db = adminDb();
  Y.setYoutubeDataFetch(fakeFetch);
  AI.setScoutAiFetch(fakeFetch);
  const made = { watch: [] as string[], hits: [] as string[], formats: [] as string[] };
  try {
    // ---- 1. 감시 채널 ----
    const info = await Y.youtubeChannelOf({ kind: "handle", value: "@scoutverify" }, "k");
    ok(info?.channelId === CH && info.subscribers === null, "구독자 수를 숨긴 채널은 0 이 아니라 모름(null)");
    const wid = await SS.addWatch(db, ME, info!, { country: "US", topics: ["검증"] });
    made.watch.push(wid);
    await rejects(SS.addWatch(db, ME, info!, { country: "US" }), /이미 감시 중/, "같은 채널은 두 번 넣지 못한다");

    // ---- 2. 훑기 ----
    const w = await SS.getWatch(db, wid);
    const r1 = await SR.scanChannel(db, w, "k", DEFAULT_SCOUT_SETTINGS, "company");
    const hitId = SS.hitIdOf(vid(10));
    made.hits.push(hitId, SS.hitIdOf(vid(11)), SS.hitIdOf(vid(12)));
    ok(r1.shorts === 12 && r1.baseline === 20_000, "3분 넘는 영상은 빼고 평소 조회수 = 7일 넘은 쇼츠 중앙값", `쇼츠 ${r1.shorts} · 평소 ${r1.baseline}`);
    ok(r1.created === 1, "평소의 3배 넘는 영상만 터진 영상으로 적는다", `${r1.created}편`);
    const h1 = await SS.getHit(db, hitId);
    ok(h1.multiple === 15 && h1.views.src === "api" && h1.baseline.src === "api", "배수 15 · 숫자 출처는 공식 API");
    ok(h1.country === "US" && h1.owner === "company" && h1.watchId === wid, "나라는 감시 채널에서 · 자동 수집은 회사 소유");
    const w1 = await SS.getWatch(db, wid);
    ok(w1.scan.baseline === 20_000 && w1.scan.baselineBasis === "mature" && w1.scan.error === null, "채널에 훑기 결과가 남는다");

    // 사람이 나라를 고치고, 조회수가 늘고, 다른 영상이 새로 터진다
    await SS.updateHit(db, ME, hitId, { country: "JP", note: "사람 메모" });
    views.set(vid(10), 600_000);
    views.set(vid(11), 100_000);
    const r2 = await SR.scanChannel(db, await SS.getWatch(db, wid), "k", DEFAULT_SCOUT_SETTINGS, "company");
    const h2 = await SS.getHit(db, hitId);
    ok(r2.created === 1 && r2.updated === 1, "다시 훑으면 있던 것은 고치고 새로 터진 것은 만든다", `만듦 ${r2.created} · 고침 ${r2.updated}`);
    ok(h2.views.v === 600_000 && h2.multiple === 30 && h2.viewHistory.length === 2, "조회수 기록이 쌓이고 배수가 바뀐다");
    ok(h2.country === "JP" && h2.note === "사람 메모", "다시 훑어도 사람이 고친 나라 · 메모는 지킨다");

    // ---- 3. 영상 분석 ----
    const r3 = await SR.analyzeHit(db, ME, hitId, { key: "k" });
    const content = (aiBody?.messages as { content: unknown }[] | undefined)?.[1]?.content as { type: string; video_url?: { url: string } }[] | undefined;
    ok(content?.some((c) => c.type === "video_url" && c.video_url?.url === `https://www.youtube.com/watch?v=${vid(10)}`), "AI 에 YouTube 주소를 video_url 로 보낸다");
    ok(r3.analysis.match.formatId === null, "목록에 없는 카드 id 를 지어내면 버린다");
    ok(r3.analysis.risks.length === 1 && r3.analysis.risks[0] === "music", "모르는 위험 항목은 버린다");
    const h3 = await SS.getHit(db, hitId);
    ok(h3.analysis?.costUsd === 0.003 && h3.analysis.by === ME, "분석 비용 · 누가 돌렸나가 남는다");
    ok(h3.koreanComments?.sampled === 4 && h3.koreanComments.korean === 2, "해외 영상은 한글 댓글 비율도 잰다");
    await rejects(SR.analyzeHit(db, ME, "notadocid!", {}), /올바르지 않습니다/, "잘못된 id 는 막는다");

    const manual = await SS.addManualHit(db, ME, { url: "https://www.douyin.com/video/7000000000000000000", country: "CN", views: 2_000_000, baseline: 100_000, title: "더우인 검증" });
    made.hits.push(manual);
    const m = await SS.getHit(db, manual);
    ok(m.platform === "douyin" && m.multiple === 20 && m.views.src === "manual", "직접 등록은 사람이 본 숫자(출처 직접 입력)로 배수");
    await rejects(SS.addManualHit(db, ME, { url: "https://www.douyin.com/video/7000000000000000000" }), /이미 등록/, "같은 주소는 두 번 등록하지 못한다");
    await rejects(SR.analyzeHit(db, ME, manual, {}), /YouTube 영상뿐/, "YouTube 밖 영상은 AI 분석을 막는다 (돈 안 씀)");

    // ---- 4. 형식 카드 ----
    const fid = await SS.formatFromAnalysis(db, ME, h3.analysis!);
    made.formats.push(fid);
    await SS.assignHit(db, ME, hitId, fid);
    await SS.assignHit(db, ME, manual, fid);
    const f = await SS.getFormat(db, fid);
    ok(f.name === "검증 형식" && f.korea.status === "unchecked" && f.koreanQueries[0] === "거대 제품 광고", "분석으로 새 카드 (국내 확인 전)");
    const linked = (await SS.listHits(db)).filter((h) => h.formatId === fid);
    const st = formatStats(f, linked, Date.now());
    const codes = st.countries.map((c) => c.code).join();
    ok(st.examples === 2 && (codes === "JP,CN" || codes === "CN,JP"), "카드에 나라별 처음 본 날이 모인다", codes);
    await SS.patchFormatKorea(db, ME, fid, { ...f.korea, status: "some", matches: [{ url: "https://youtu.be/x", title: "국내", views: 1, publishedAt: iso(0.5) }], checkedAt: Date.now(), by: ME });
    const st2 = formatStats(await SS.getFormat(db, fid), linked, Date.now());
    ok(st2.korea === "some" && st2.lagDays !== null && st2.lagDays >= 1, "국내 사례를 고르면 시차가 생긴다", `${st2.lagDays}일`);
    await SS.saveFormat(db, ME, fid, { name: "검증 형식 고침", korea: { status: "spread" } });
    ok((await SS.getFormat(db, fid)).korea.status === "some", "카드 저장으로 국내 확인 값을 바꾸지 못한다 (검색 · 표시로만)");

    // ---- 5. 권한 ----
    await rejects(SS.deleteHit(db, ME, hitId), /관리자만/, "자동 수집 영상은 관리자만 지운다");
    await rejects(SS.deleteFormat(db, "someone-else@test.invalid", fid), /만든 사람이나 관리자/, "남이 만든 카드는 못 지운다");

    // ---- 6. 보고 ----
    const all = { formats: (await SS.listFormats(db)).filter((x) => x.id === fid), hits: (await SS.listHits(db)).filter((x) => made.hits.includes(x.id)), channels: [await SS.getWatch(db, wid)] };
    const rep = buildReport({ ...all, now: Date.now() });
    ok(rep.counts.newHits === 3 && rep.counts.channels === 1, "보고 집계", `새 영상 ${rep.counts.newHits}`);
    await SS.saveReport(db, { ...rep, week: "1999-W01", createdAt: Date.now(), createdBy: ME });
    await SS.setReportNarrative(db, "1999-W01", { text: "요약", model: "m", costUsd: 0, at: Date.now(), by: ME });
    await SS.saveReport(db, { ...rep, week: "1999-W01", createdAt: Date.now(), createdBy: ME });
    ok((await SS.getReport(db, "1999-W01")).narrative?.text === "요약", "같은 주를 다시 만들어도 AI 요약은 남는다");
    await db.collection(NEANDER_COL.shortsReports).doc("1999-W01").delete();

    // ---- 7. 카드 지우기 ----
    await SS.deleteFormat(db, ME, fid);
    made.formats = [];
    const after = await SS.getHit(db, hitId);
    ok(after.formatId === null && after.status === "new", "카드를 지우면 묶인 영상은 「묶기 전」 으로 돌아간다");
    ok(!calls.some((c) => c.includes("/search")), "훑기 · 분석은 search.list(하루 100회)를 쓰지 않는다");
  } finally {
    for (const id of made.formats) await db.collection(NEANDER_COL.shortsFormats).doc(id).delete().catch(() => undefined);
    for (const id of made.hits) await db.collection(NEANDER_COL.shortsHits).doc(id).delete().catch(() => undefined);
    for (const id of made.watch) await db.collection(NEANDER_COL.shortsWatch).doc(id).delete().catch(() => undefined);
    Y.setYoutubeDataFetch(null);
    AI.setScoutAiFetch(null);
  }
  console.log(fails ? `\n✗ ${fails}건 실패` : "\n✓ 모두 통과");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
