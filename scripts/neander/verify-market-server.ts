// ============================================================
//  시장 트렌드 서버 검증 — 실제 Firestore · 외부 호출(네이버 · YouTube · AI)은 모의
// ------------------------------------------------------------
//    npm run shorts:verify-market
//  문서 이름 앞에 verify_ 를 붙여 실제 설정 · 브리핑 · 채널 기록 · 계수기를 건드리지 않는다.
//  감시 채널 하나(검증용)를 만들었다 지운다. 노트는 검증용 이메일 둘로만. 레이더 · 터진 영상 · 형식은 읽기만.
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import { setAiFetch } from "@/lib/neander/shorts/server/ai";
import { setNaverFetch } from "@/lib/neander/shorts/server/naver";
import { setYoutubeDataFetch } from "@/lib/neander/shorts/server/youtube-data";
import * as M from "@/lib/neander/shorts/server/market";
import { DEFAULT_MARKET_SETTINGS, channelDelta } from "@/lib/neander/shorts/market";
import type { WatchChannelDoc } from "@/lib/neander/shorts/scout";

const A = "shorts-verify-a@test.invalid";
const B = "shorts-verify-b@test.invalid";
const P = "verify_";
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
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function main() {
  const db = adminDb();
  process.env.NEANDER_SHORTS_NAVER_CLIENT_ID ||= "verify-naver";
  process.env.NEANDER_SHORTS_NAVER_CLIENT_SECRET ||= "verify-naver";
  process.env.NEANDER_SHORTS_YOUTUBE_API_KEY ||= "verify-yt";
  process.env.OPENROUTER_API_KEY ||= "verify-or";
  const CH = "UCvrfyMarketChannelAAAA1";
  const watchId = `yt_${CH}`;
  const noteIds: string[] = [];
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  // 외부 호출 모의 — 네이버(묶음마다 · 나이 성별) · YouTube(채널 통계) · AI(브리핑)
  const naverBodies: Record<string, unknown>[] = [];
  setNaverFetch((async (_u: RequestInfo | URL, init: RequestInit = {}) => {
    const b = JSON.parse(String(init.body));
    naverBodies.push(b);
    const groups = b.keywordGroups as { groupName: string }[];
    return json({ results: groups.map((g, i) => ({ title: g.groupName, data: [10, 10, 10, 10, 10, 10, 20 + i, 30].map((ratio, k) => ({ period: new Date(Date.parse("2026-09-07") + k * 7 * 86_400_000).toISOString().slice(0, 10), ratio })) })) });
  }) as typeof fetch);
  let subs = 1000;
  setYoutubeDataFetch((async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith("/channels")) {
      const ids = (u.searchParams.get("id") ?? "").split(",");
      return json({ items: ids.filter((id) => id === CH).map((id) => ({ id, snippet: { title: "검증 감시 채널", customUrl: "@vrfy" }, statistics: { subscriberCount: String(subs), viewCount: "50000", videoCount: "40" } })) });
    }
    return json({ items: [] });
  }) as typeof fetch);
  let aiBody = "";
  setAiFetch((async (_u: RequestInfo | URL, init: RequestInit = {}) => {
    aiBody = String(init.body);
    return json({
      choices: [{ message: { content: JSON.stringify({ headline: "검증 브리핑", summary: ["요약 하나"], items: [
        { kind: "keyword", title: "검증 묶음 상승", why: "최근 2주가 올랐다", numbers: "×2.5", action: "지켜보기", refKind: "group", refId: "vg1" },
        { kind: "channel", title: "검증 채널", why: "구독자 증가", numbers: "+50", action: "형식 보기", refKind: "channel", refId: `${P}yt_${CH}` },
        { kind: "product", title: "지어낸 상품", why: "w", numbers: "평소의 99배", action: "a", refKind: "radar", refId: "yt_made_up_00" },
        { kind: "format", title: "근거 없음", why: "w", numbers: "", action: "a", refKind: "none", refId: "" },
      ] }) } }],
      usage: { cost: 0.003 },
    });
  }) as typeof fetch);

  try {
    // ---- 설정 (검증용 문서) ----
    const s0 = await M.getMarketSettings(db, P);
    ok(s0.groups.length === DEFAULT_MARKET_SETTINGS.groups.length, "설정이 없으면 기본 검색어 묶음 5개");
    const s1 = await M.saveMarketSettings(db, A, { groups: [{ id: "vg1", name: "검증 살림", keywords: ["살림템", "살림꿀템"] }, { id: "vg2", name: "검증 주방", keywords: "주방템, 주방용품" }], briefBudgetKrw: 100 }, P);
    ok(s1.groups.length === 2 && s1.groups[1].keywords.length === 2 && s1.briefBudgetKrw === 100, "검색어 묶음 · 브리핑 상한 저장");

    // ---- 검색어 추이 ----
    const notes: string[] = [];
    const calls = await M.refreshGroupSeries(db, s1, { prefix: P, deadline: Date.now() + 60_000 }, notes);
    const series = await M.getGroupSeries(db, P);
    ok(calls === 2 && series.vg1?.points.length === 8 && (naverBodies.at(-1)?.keywordGroups as unknown[]).length === 1, "묶음마다 혼자 1년 주간 추이 (요청 2번)", JSON.stringify({ calls, notes }));
    const n0 = naverBodies.length;
    const cmp = await M.compareTrend(db, { groupIds: ["vg1", "vg2"], range: "6m", unit: "week", mode: "groups" }, { prefix: P });
    ok(!cmp.cached && cmp.series.length === 2 && (naverBodies.at(-1)?.keywordGroups as unknown[]).length === 2, "분야 비교 — 두 묶음을 한 요청에");
    const cmp2 = await M.compareTrend(db, { groupIds: ["vg1", "vg2"], range: "6m", unit: "week", mode: "groups" }, { prefix: P });
    ok(cmp2.cached && naverBodies.length === n0 + 1, "같은 조건은 그날 캐시 (네이버를 다시 안 부름)");
    const seg = await M.compareTrend(db, { groupIds: ["vg2", "vg1"], range: "3m", unit: "month", mode: "segments" }, { prefix: P });
    ok(seg.series.length === 5 && naverBodies.slice(-5).every((b) => b.gender && Array.isArray(b.ages) && (b.keywordGroups as { groupName: string }[])[0].groupName === "검증 주방"), "나이 · 성별 — 첫 묶음 하나를 집단 5개로 따로 부름");
    await rejects(M.compareTrend(db, { groupIds: ["없는묶음"], range: "1y", unit: "week", mode: "groups" }, { prefix: P }), /골라 주세요/, "없는 묶음은 거절");

    // ---- 채널 기록 (검증용 감시 채널 하나 · 계정 없음) ----
    const wd: WatchChannelDoc = {
      owner: "company", createdAt: Date.now(), updatedAt: Date.now(), updatedBy: A,
      platform: "youtube", channelId: CH, handle: "@vrfy", title: "검증 감시 채널", thumbnail: "", country: "US", language: "en", topics: [], subscribers: null, active: true, note: "",
      scan: { at: null, baseline: null, baselineN: 0, baselineBasis: "none", shortsSeen: 0, error: null },
    };
    await db.collection(NEANDER_COL.shortsWatch).doc(watchId).set(wd);
    const opt = { by: A, deadline: Date.now() + 60_000, prefix: P, onlyWatch: [watchId], onlyAccounts: ["__none__"] };
    const r1 = await M.snapshotChannels(db, { ...opt, now: Date.parse("2026-10-20T03:00:00Z") }, []);
    subs = 1050;
    await M.snapshotChannels(db, { ...opt, now: Date.parse("2026-10-28T03:00:00Z") }, []);
    subs = 1080;
    await M.snapshotChannels(db, { ...opt, now: Date.parse("2026-10-28T09:00:00Z") }, []); // 같은 날 다시 → 바꿔 끼움
    const stats = await M.listChannelStats(db, P);
    const st = stats.find((x) => x.externalId === CH);
    ok(r1.youtube === 1 && st?.history.length === 2 && st.history[1].subs === 1080 && st.watchId === watchId && !st.mine, "채널 숫자 — 하루 한 번 · 같은 날은 바꿔 끼움 · 감시 채널 표시", JSON.stringify(st?.history));
    ok(st && channelDelta(st.history, 7, "subs") === 80, "7일 변화 +80");
    ok(!(await M.listChannelStats(db)).some((x) => x.id.startsWith(P)), "실제 목록에는 검증 기록이 섞이지 않음");

    // ---- 브리핑 (검증용 계수기 · 근거 되짚기) ----
    const b = await M.runMarketBrief(db, { by: A, deadline: Date.now() + 60_000, prefix: P, settings: s1 });
    ok(b.headline === "검증 브리핑" && b.items.length === 3, "브리핑 저장 — 지어낸 근거 id 1개는 뺌 (근거 없음은 남김)", JSON.stringify(b.items.map((x) => x.title)));
    ok(b.items[0].ref?.kind === "group" && b.items[1].ref?.url === `https://www.youtube.com/channel/${CH}` && b.items[2].ref === null, "근거 링크 — 묶음 · 채널 주소");
    ok(b.notes.some((x) => /1개를 뺌/.test(x)), "뺀 것을 메모로 남김");
    const aiUser = String(JSON.parse(aiBody).messages[1].content);
    ok(/"groups":\[\{"id":"vg[12]"/.test(aiUser) && aiUser.includes('"name":"검증 살림"') && aiUser.includes('"name":"검증 주방"'), "AI 에 검색어 묶음 추세가 들어감");
    ok((await M.getBrief(db, day, P))?.headline === "검증 브리핑" && (await M.listBriefDays(db, P)).some((x) => x.day === day), "그날 브리핑 · 지난 브리핑 목록");
    await M.saveMarketSettings(db, A, { briefBudgetKrw: 0 }, P);
    await rejects(M.runMarketBrief(db, { by: A, deadline: Date.now() + 60_000, prefix: P }), /상한/, "하루 상한에 닿으면 브리핑을 안 씀");

    // ---- 트렌드 노트 (사람마다 비공개) ----
    const n1 = await M.saveNote(db, A, null, { title: "검증 노트", tags: "주방 다이소", source: { kind: "brief", id: `${day}:0`, url: "https://example.com/x", label: "검증" }, snapshot: "×2.5" });
    noteIds.push(n1.id);
    ok(n1.owner === A && n1.status === "inbox" && n1.tags.length === 2, "노트 보관 — 검토 전 · 태그");
    const n2 = await M.saveNote(db, A, n1.id, { status: "script", memo: "대본으로", source: { kind: "manual" } });
    ok(n2.status === "script" && n2.source.kind === "brief" && n2.snapshot === "×2.5", "고치기 — 상태 · 메모 (출처 · 그때 숫자는 그대로)");
    await rejects(M.saveNote(db, B, n1.id, { title: "남의 것" }), /다른 사람의 노트/, "다른 사람은 고치지 못함");
    ok(!(await M.listNotes(db, B)).some((x) => x.id === n1.id), "다른 사람 목록에 안 보임");
    await rejects(M.deleteNote(db, B, n1.id), /다른 사람의 노트/, "다른 사람은 지우지 못함");
    await M.deleteNote(db, A, n1.id);
    ok(!(await M.listNotes(db, A)).some((x) => x.id === n1.id), "지우기");
  } finally {
    setNaverFetch(null);
    setYoutubeDataFetch(null);
    setAiFetch(null);
    // ---- 정리 ----
    await db.collection(NEANDER_COL.shortsWatch).doc(watchId).delete();
    for (const col of [NEANDER_COL.shortsMarket, NEANDER_COL.shortsChannelStats]) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) if (d.id.startsWith(P)) await d.ref.delete();
    }
    for (const k of [`${P}market`, `${P}market_lock`, `usage_${P}marketusd_${day}`]) await db.collection(NEANDER_COL.shortsSettings).doc(k).delete();
    for (const who of [A, B]) for (const d of (await db.collection(NEANDER_COL.shortsNotes).where("owner", "==", who).get()).docs) await d.ref.delete();
    const left = (await db.collection(NEANDER_COL.shortsMarket).get()).docs.filter((d) => d.id.startsWith(P)).length + (await db.collection(NEANDER_COL.shortsChannelStats).get()).docs.filter((d) => d.id.startsWith(P)).length;
    ok(left === 0 && !(await db.collection(NEANDER_COL.shortsWatch).doc(watchId).get()).exists, "검증 문서를 모두 지움");
  }
  console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
  process.exit(fails ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
