// ============================================================
//  시장 트렌드 서버 검증 — 실제 Firestore · 외부 호출(네이버 · YouTube · AI)은 모의
// ------------------------------------------------------------
//    npm run shorts:verify-market
//  문서 이름 앞에 verify_ 를 붙여 실제 설정 · 브리핑 · 채널 기록 · 계수기를 건드리지 않는다.
//  감시 채널 하나(검증용)를 만들었다 지운다. 노트 · 노트 사진은 검증용 이메일 둘로만. 레이더 · 터진 영상 · 형식은 읽기만.
//  노트 영상 숫자 읽기(인스타 삽입 화면 · 틱톡 oEmbed)도 모의.
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

    // ---- 트렌드 노트 레퍼런스 — 팀 공개 · 참고 영상 · 사진 ----
    const igInner = JSON.stringify({ x: { shortcode_media: { shortcode: "DeOxg-opuO0", video_view_count: 2382125, video_duration: 91.972, owner: { username: "swayroom_studio" }, edge_liked_by: { count: 90788 }, edge_media_to_comment: { count: 310 }, edge_media_to_caption: { edges: [{ node: { text: "화해 #광고" } }] } } } });
    const metaCalls: string[] = [];
    M.setNoteMetaFetch((async (input: RequestInfo | URL) => {
      const u = String(input);
      metaCalls.push(u);
      if (u.includes("instagram.com/p/DeOxg-opuO0/embed")) return new Response(`<script>s.handle({"r":[[${JSON.stringify(igInner)}]]})</script>`, { status: 200 });
      if (u.includes("instagram.com/p/")) return new Response("<html><title>Login • Instagram</title></html>", { status: 200 });
      if (u.startsWith("https://www.tiktok.com/oembed")) return json({ title: "틱톡 검증 #태그", author_unique_id: "verify.tt" });
      return new Response("no", { status: 404 });
    }) as typeof fetch);
    const ref1 = await M.saveNote(db, A, null, { title: "검증 레퍼런스", source: { kind: "manual", id: null, url: null, label: "직접 적음" } });
    noteIds.push(ref1.id);
    ok(ref1.visibility === "private" && ref1.videos.length === 0 && ref1.images.length === 0, "새 노트 — 나만 보기 · 영상 · 사진 없음");
    const v1 = await M.addNoteVideo(db, A, ref1.id, "https://www.instagram.com/reel/DeOxg-opuO0/?igsh=abc");
    ok(v1.videos.length === 1 && v1.videos[0].stats === "조회 2,382,125 · 좋아요 90,788 · 댓글 310 · 1분 32초 · @swayroom_studio" && v1.videos[0].label === "화해", "인스타 영상 넣기 — 그때 숫자 · 캡션 첫 줄", v1.videos[0]?.stats);
    ok(v1.source.kind === "reference" && v1.source.label === "인스타 @swayroom_studio", "직접 적은 노트에 첫 영상 → 출처 「레퍼런스」", JSON.stringify(v1.source));
    const v2 = await M.addNoteVideo(db, A, ref1.id, "https://www.instagram.com/p/DfRtuwxpDTw/");
    ok(v2.videos.length === 2 && v2.videos[1].stats === "" && v2.videos[1].label === "", "숫자를 못 읽어도 영상은 넣는다 (빈 값 — 지어내지 않음)");
    const v3 = await M.addNoteVideo(db, A, ref1.id, "https://www.tiktok.com/@verify.tt/video/7301234567890123456");
    ok(v3.videos[2]?.label === "틱톡 검증" && v3.videos[2]?.stats === "@verify.tt", "틱톡 — oEmbed 제목 · 계정", JSON.stringify(v3.videos[2]));
    await rejects(M.addNoteVideo(db, A, ref1.id, "https://www.instagram.com/p/DeOxg-opuO0/"), /이미 넣은 영상/, "같은 영상 두 번 안 됨 (reel · p 주소가 달라도)");
    await rejects(M.addNoteVideo(db, A, ref1.id, "https://www.instagram.com/swayroom_studio/"), /영상 하나 주소만/, "계정 주소는 안 됨");
    await rejects(M.addNoteVideo(db, B, ref1.id, "https://www.instagram.com/p/DdfkfFsJGGB/"), /다른 사람의 노트/, "남의 노트에 영상 못 넣음");
    const e1 = await M.saveNote(db, A, ref1.id, { videos: [{ platform: "tiktok", id: "7301234567890123456", label: "틱톡 고침" }, { platform: "instagram", id: "DeOxg-opuO0" }] });
    ok(e1.videos.length === 2 && e1.videos[0].label === "틱톡 고침" && e1.videos[1].stats.startsWith("조회 2,382,125"), "영상 목록 고치기 — 순서 · 설명 · 빼기 (숫자는 그대로)");

    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
    const thumb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 3)]);
    const i1 = await M.addNoteImage(db, A, ref1.id, { name: "장면 모음.jpg", w: 2000, h: 2025, base64: jpg.toString("base64"), thumbBase64: thumb.toString("base64") });
    const img = i1.images[0];
    ok(i1.images.length === 1 && img.size === jpg.length && img.type === "image/jpeg" && img.by === A && img.name === "장면 모음.jpg", "사진 넣기 — 목록에 크기 · 형식 · 올린 사람");
    const full = await M.readNoteImage(db, A, img.id, "full");
    const small = await M.readNoteImage(db, A, img.id, "thumb");
    ok(full.bytes.equals(jpg) && small.bytes.equals(thumb) && full.type === "image/jpeg", "사진 원본 · 작은 그림을 그대로 돌려줌");
    await rejects(M.addNoteImage(db, A, ref1.id, { name: "가짜.png", w: 1, h: 1, base64: Buffer.from("<svg/>").toString("base64"), thumbBase64: thumb.toString("base64") }), /그림이 아닙니다/, "그림이 아닌 바이트는 거절");
    await rejects(M.addNoteImage(db, A, ref1.id, { name: "큰.jpg", w: 1, h: 1, base64: Buffer.concat([jpg, Buffer.alloc(900 * 1024)]).toString("base64"), thumbBase64: thumb.toString("base64") }), /너무 큽니다/, "850KB 넘는 원본은 거절");
    await rejects(M.readNoteImage(db, B, img.id, "full"), /찾지 못했습니다/, "나만 보기 노트의 사진은 남이 못 읽음");
    ok(!(await M.listNotes(db, B, { withTeam: true })).some((x) => x.id === ref1.id), "나만 보기 노트는 팀 목록에도 안 보임");
    const t1 = await M.saveNote(db, A, ref1.id, { visibility: "team", images: [{ id: img.id, caption: "첫 만남 3초 간격" }] });
    ok(t1.visibility === "team" && t1.images[0].caption === "첫 만남 3초 간격" && t1.videos.length === 2, "팀 공개로 바꾸기 · 사진 설명");
    const seen = (await M.listNotes(db, B, { withTeam: true })).find((x) => x.id === ref1.id);
    ok(!!seen && seen.videos.length === 2 && seen.images.length === 1, "팀 공개 노트는 팀원 목록에 보임 (영상 · 사진 포함)");
    ok(!(await M.listNotes(db, B)).some((x) => x.id === ref1.id), "비서 · 중복 확인(내 것만)에는 안 섞임");
    ok((await M.readNoteImage(db, B, img.id, "thumb")).bytes.equals(thumb), "팀 공개 노트의 사진은 팀원이 읽음");
    await rejects(M.saveNote(db, B, ref1.id, { title: "남이 고침" }), /다른 사람의 노트/, "팀 공개여도 고치기는 쓴 사람만");
    await rejects(M.deleteNoteImage(db, B, ref1.id, img.id), /다른 사람의 노트/, "팀원은 사진을 못 지움");
    const i2 = await M.addNoteImage(db, A, ref1.id, { name: "두번째.jpg", w: 10, h: 10, base64: jpg.toString("base64"), thumbBase64: thumb.toString("base64") });
    const d1 = await M.deleteNoteImage(db, A, ref1.id, img.id);
    ok(d1.images.length === 1 && d1.images[0].id === i2.images[1].id && !(await db.collection(NEANDER_COL.shortsNoteImages).doc(img.id).get()).exists, "사진 지우기 — 목록 · 원본 같이");
    await M.deleteNote(db, A, ref1.id);
    const leftImgs = await db.collection(NEANDER_COL.shortsNoteImages).where("noteId", "==", ref1.id).get();
    ok(leftImgs.empty && !(await db.collection(NEANDER_COL.shortsNotes).doc(ref1.id).get()).exists, "노트를 지우면 남은 사진 원본도 같이 지움");
    ok(metaCalls.some((u) => u.includes("/embed/captioned/")), "인스타 숫자는 공개 삽입 화면에서 읽음");
  } finally {
    M.setNoteMetaFetch(null);
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
    for (const who of [A, B]) for (const d of (await db.collection(NEANDER_COL.shortsNoteImages).where("owner", "==", who).get()).docs) await d.ref.delete();
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
