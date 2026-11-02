// ============================================================
//  밖에서 올린 게시물 자동 연결 — 서버 검증 (실제 Firestore · YouTube · Instagram 은 모의)
// ------------------------------------------------------------
//    npm run shorts:verify-external
//  검증 전용 이메일 둘(shorts-verify-ext-*)의 계정 · 영상 · 게시 기록 · 성과만 만들고 지운다. 장부 문서는 verify_ 를 붙인다.
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import * as accounts from "@/lib/neander/shorts/server/accounts";
import * as secret from "@/lib/neander/shorts/server/secret";
import * as platforms from "@/lib/neander/shorts/server/platforms";
import * as store from "@/lib/neander/shorts/server/store";
import { setYoutubeDataFetch } from "@/lib/neander/shorts/server/youtube-data";
import { attachExternal, externalStatus, syncExternalPosts } from "@/lib/neander/shorts/server/external";
import { listPublications } from "@/lib/neander/shorts/server/publishing";
import type { AccountDoc, MetricSnapshotDoc, PublicationDoc } from "@/lib/neander/shorts/types";

const A = "shorts-verify-ext-a@test.invalid";
const B = "shorts-verify-ext-b@test.invalid";
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

const H = 3600_000;
const T0 = Date.parse("2026-11-02T13:00:00Z");
const iso = (t: number) => new Date(t).toISOString();
const igTime = (t: number) => iso(t).replace(/\.\d{3}Z$/, "+0000");

async function main() {
  const db = adminDb();
  process.env.NEANDER_SHORTS_GOOGLE_CLIENT_ID ||= "verify-google";
  process.env.NEANDER_SHORTS_GOOGLE_CLIENT_SECRET ||= "verify-google";
  const CH = "UCvrfyExternalAAAAAA01";
  const IG = "17841400000000077";
  const ytAcc = accounts.accountId("youtube", CH, A);
  const igAcc = accounts.accountId("instagram", IG, A);
  const base: Omit<AccountDoc, "platform" | "authMode" | "externalId" | "externalName" | "sealed"> = {
    owner: A,
    scopes: [],
    tokenExpiresAt: null,
    sharedWith: [],
    status: "connected",
    coupangChannel: null,
    coupangSubId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 유튜브: 1화(공개) · 2화(공개 · 다른 영상) · 비공개 · ERP 가 올린 것 / 인스타: 1화 릴스(2시간 뒤) · 사진
  const YT1 = { id: "vrfyExtYt01", title: "다이소 신발 정리대를 책상에 걸었더니｜정리템 4가지 8천 원", desc: "섹션케이스 2분할 · 실리콘 타이 18cm · 5라인 케이블 홀더 · 걸이형 신발 정리대 #다이소", at: T0, privacy: "public" };
  const YT2 = { id: "vrfyExtYt02", title: "차 안 비상템 3가지 — 무선 핸디 청소기 · 세차타월", desc: "#다이소 #차량용품", at: T0 + 30 * H, privacy: "public" };
  const YTP = { id: "vrfyExtYt03", title: "비공개 테스트", desc: "", at: T0 + 40 * H, privacy: "private" };
  const YTE = { id: "vrfyErpVid1", title: "ERP 로 올린 것", desc: "", at: T0 - 50 * H, privacy: "public" };
  const ytVideos = [YT1, YT2, YTP, YTE];
  const IG1 = { id: "18000000000000771", caption: "다이소 4가지, 다 합쳐 8천 원 🏠\n신발 정리대는 신발 말고 책상에 걸어 보세요\n① 섹션케이스 2분할 ② 실리콘 타이 18cm ③ 5라인 케이블 홀더 ④ 걸이형 신발 정리대\n#다이소 #정리템", at: T0 + 2 * H, type: "VIDEO", product: "REELS" };
  const IGI = { id: "18000000000000772", caption: "프로필 사진 바꿨어요", at: T0 + 3 * H, type: "IMAGE", product: "FEED" };
  const igPosts = [IG1, IGI];
  let igFail = false;
  const calls: string[] = [];
  platforms.setPlatformFetch((async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "at" });
    const u = new URL(url);
    if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/channels")) return json({ items: [{ id: CH, contentDetails: { relatedPlaylists: { uploads: "UUvrfy" } } }] });
    if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/playlistItems")) return json({ items: ytVideos.map((v) => ({ contentDetails: { videoId: v.id } })) });
    if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/videos")) {
      const ids = (u.searchParams.get("id") ?? "").split(",");
      if (u.searchParams.get("part") === "statistics,status")
        return json({ items: ids.map((id) => ({ id, statistics: { viewCount: "1200", likeCount: "40", commentCount: "0" }, status: { uploadStatus: "processed", privacyStatus: "public" } })) });
      return json({
        items: ytVideos
          .filter((v) => ids.includes(v.id))
          .map((v) => ({ id: v.id, snippet: { title: v.title, description: v.desc, publishedAt: iso(v.at), thumbnails: { medium: { url: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` } } }, status: { privacyStatus: v.privacy, uploadStatus: "processed" }, contentDetails: { duration: "PT1M19S" } })),
      });
    }
    if (u.hostname === "graph.facebook.com" && u.pathname.endsWith(`/${IG}/media`)) {
      if (igFail) return json({ error: { code: 190, message: "token expired" } }, 400);
      return json({ data: igPosts.map((m) => ({ id: m.id, caption: m.caption, media_type: m.type, media_product_type: m.product, permalink: `https://www.instagram.com/reel/${m.id}/`, timestamp: igTime(m.at), thumbnail_url: "https://scontent.cdninstagram.com/x.jpg" })) });
    }
    if (u.hostname === "graph.facebook.com" && u.pathname.endsWith("/insights")) return json({ data: ["views", "likes", "comments", "saved", "shares"].map((name, i) => ({ name, values: [{ value: [900, 30, 2, 5, 1][i] }] })) });
    if (u.hostname === "graph.facebook.com" && u.pathname.endsWith("/comments")) return json({ data: [{ text: "정보 주세요" }] });
    throw new Error(`검증 중 모의 응답이 없는 외부 호출: ${url.split("?")[0]}`);
  }) as typeof fetch);
  setYoutubeDataFetch((async (input: RequestInfo | URL) => {
    throw new Error(`검증 중 모의 응답이 없는 YouTube 데이터 호출: ${String(input).split("?")[0]}`);
  }) as typeof fetch);

  const cleanup = async () => {
    for (const who of [A, B]) {
      for (const d of (await db.collection(NEANDER_COL.shortsPublications).where("owner", "==", who).get()).docs) await d.ref.delete();
      for (const d of (await db.collection(NEANDER_COL.shortsMetrics).where("owner", "==", who).get()).docs) await d.ref.delete();
      for (const d of (await db.collection(NEANDER_COL.shortsProjects).where("owner", "==", who).get()).docs) await d.ref.delete();
    }
    for (const id of [ytAcc, igAcc]) {
      await db.collection(NEANDER_COL.shortsAccounts).doc(id).delete();
      await db.collection(NEANDER_COL.shortsSettings).doc(`${P}extseen_${id}`).delete();
    }
  };

  try {
    await cleanup();
    await db.collection(NEANDER_COL.shortsAccounts).doc(ytAcc).set({ ...base, platform: "youtube", authMode: "google_oauth", externalId: CH, externalName: "검증 살림 채널", sealed: secret.sealTokens({ refreshToken: "r" }, ytAcc) } satisfies AccountDoc);
    await db.collection(NEANDER_COL.shortsAccounts).doc(igAcc).set({ ...base, platform: "instagram", authMode: "facebook_login", externalId: IG, externalName: "@verify.salim", sealed: secret.sealTokens({ pageToken: "pt" }, igAcc) } satisfies AccountDoc);
    // ERP 로 이미 올린 게시 (같은 계정 · 같은 영상 id) — 다시 붙이면 안 된다
    const erpProject = await store.createProject(db, A, { title: "ERP 영상", kind: "general" });
    await db.collection(NEANDER_COL.shortsPublications).doc("verifyErpPub01").set({
      owner: A, projectId: erpProject, accountId: ytAcc, platform: "youtube", renderId: "verifyRender", status: "published", scheduledAt: null, jobId: null,
      meta: { title: "ERP 로 올린 것", caption: "", privacy: "public", madeForKids: false, synthetic: false }, compliance: {},
      result: { externalId: YTE.id, url: `https://www.youtube.com/shorts/${YTE.id}`, at: YTE.at, by: "api" }, error: null, history: [], attempts: 1, createdAt: Date.now(), updatedAt: Date.now(),
    } satisfies PublicationDoc);

    // ---- 1. 처음 확인 ----
    const r1 = await syncExternalPosts(db, { by: A, owner: A, prefix: P, now: T0 + 50 * H });
    const yt = r1.accounts.find((a) => a.accountId === ytAcc);
    const ig = r1.accounts.find((a) => a.accountId === igAcc);
    ok(yt?.found === 4 && yt.imported === 2 && ig?.found === 2 && ig.imported === 1 && r1.imported === 3, "유튜브 공개 2편 · 인스타 릴스 1편만 (비공개 · ERP 가 올린 것 · 사진 빼고)", JSON.stringify(r1.accounts));
    const pubs = (await db.collection(NEANDER_COL.shortsPublications).where("owner", "==", A).get()).docs.map((d) => ({ ...(d.data() as PublicationDoc), id: d.id }));
    const p1 = pubs.find((p) => p.result?.externalId === YT1.id)!;
    const p2 = pubs.find((p) => p.result?.externalId === YT2.id)!;
    const pi = pubs.find((p) => p.result?.externalId === IG1.id)!;
    ok(p1 && p2 && pi && !pubs.some((p) => p.result?.externalId === YTP.id || p.result?.externalId === IGI.id), "게시 기록 셋 — 비공개 · 사진은 없음");
    ok(pi.projectId === p1.projectId && pi.external?.matched === "paired" && p1.external?.matched === "new" && pi.external.autoProject === false, "인스타 1화는 유튜브 1화와 같은 영상에 붙음");
    ok(p2.projectId !== p1.projectId, "2화(글이 다르고 30시간 뒤)는 따로");
    ok(p1.origin === "external" && p1.renderId === "" && p1.status === "published" && p1.result?.url === `https://www.youtube.com/shorts/${YT1.id}` && p1.result.at === YT1.at, "유튜브 게시 기록 — 밖에서 · 완성 파일 없음 · 쇼츠 주소 · 올린 시각");
    ok(pi.result?.url === `https://www.instagram.com/reel/${IG1.id}/` && pi.result.at === IG1.at, "인스타 게시 기록 — 주소 · 시각(+0000 읽기)");
    const pj1 = await store.getProject(db, A, p1.projectId);
    ok(pj1.kind === "general" && pj1.stage === "published" && pj1.title === YT1.title && pj1.owner === A && pj1.visibility === "private", "새 영상 — 일반 영상 · 게시됨 · 제목 · 비공개(계정 주인)", JSON.stringify({ k: pj1.kind, s: pj1.stage, v: pj1.visibility }));
    const ms = (await db.collection(NEANDER_COL.shortsMetrics).where("owner", "==", A).get()).docs.map((d) => d.data() as MetricSnapshotDoc);
    ok(ms.some((m) => m.publicationId === p1.id && m.source === "youtube_api" && m.values.views === 1200) && ms.some((m) => m.publicationId === pi.id && m.source === "instagram_api" && m.values.views === 900 && m.values.saves === 5), "붙이자마자 성과 한 번 (유튜브 조회 · 인스타 조회 · 저장)");
    ok((await listPublications(db, A, [p1.projectId])).length === 2, "게시 현황 목록에 1화 영상의 두 게시가 나옴");
    await rejects(store.getProject(db, B, p1.projectId), /비공개/, "다른 사람은 그 영상을 볼 수 없음");

    // ---- 2. 다시 확인 — 이미 본 것은 그대로 ----
    const r2 = await syncExternalPosts(db, { by: A, owner: A, prefix: P, now: T0 + 51 * H });
    ok(r2.imported === 0, "다시 확인해도 새로 붙는 것 없음");
    const st = await externalStatus(db, A, false, P);
    ok(st.length === 2 && st.find((s) => s.accountId === ytAcc)?.linked === 2 && st.find((s) => s.accountId === igAcc)?.linked === 1 && st.every((s) => s.checkedAt === T0 + 51 * H && !s.error), "계정별 상태 — 마지막 확인 · 연결 수", JSON.stringify(st.map((s) => [s.name, s.linked, s.checkedAt])));

    // ---- 3. 옮기기 ----
    await rejects(attachExternal(db, B, { publicationId: pi.id, projectId: "new" }), /주인만/, "다른 사람은 옮길 수 없음");
    await rejects(attachExternal(db, A, { publicationId: "verifyErpPub01", projectId: "new" }), /밖에서 올린 게시물만/, "ERP 로 올린 게시는 옮길 수 없음");
    // 2화(자동으로 만든 영상)를 1화 영상에 붙이면 빈 2화 영상은 지워지고 성과도 따라간다
    const old2 = p2.projectId;
    await attachExternal(db, A, { publicationId: p2.id, projectId: p1.projectId });
    const moved = (await db.collection(NEANDER_COL.shortsPublications).doc(p2.id).get()).data() as PublicationDoc;
    ok(moved.projectId === p1.projectId && moved.external?.matched === "moved", "2화 게시를 1화 영상으로 옮김");
    ok(!(await db.collection(NEANDER_COL.shortsProjects).doc(old2).get()).exists, "비게 된 자동 영상은 지움");
    ok((await db.collection(NEANDER_COL.shortsMetrics).where("publicationId", "==", p2.id).get()).docs.every((d) => (d.data() as MetricSnapshotDoc).projectId === p1.projectId), "성과 기록도 옮겨짐");
    // 다시 새 영상으로 떼어 내기
    const back = await attachExternal(db, A, { publicationId: p2.id, projectId: "new" });
    const pjBack = await store.getProject(db, A, back.projectId);
    ok(back.projectId !== p1.projectId && pjBack.title === YT2.title && pjBack.stage === "published", "새 영상으로 떼어 냄 (제목은 게시 제목)");
    ok((await db.collection(NEANDER_COL.shortsProjects).doc(p1.projectId).get()).exists, "다른 게시가 남은 영상은 지우지 않음");

    // ---- 4. 사람이 지운 연결은 되살리지 않는다 ----
    await store.deleteProject(db, A, back.projectId);
    const r3 = await syncExternalPosts(db, { by: A, owner: A, prefix: P, now: T0 + 52 * H });
    ok(r3.imported === 0 && !(await db.collection(NEANDER_COL.shortsPublications).doc(p2.id).get()).exists, "지운 영상의 게시물은 다음 확인에도 다시 붙지 않음");

    // ---- 5. 비공개가 공개되면 그때 붙는다 · 한 계정이 실패해도 다른 계정은 돈다 ----
    YTP.privacy = "public";
    igFail = true;
    const r4 = await syncExternalPosts(db, { by: A, owner: A, prefix: P, now: T0 + 53 * H, metrics: false });
    ok(r4.accounts.find((a) => a.accountId === ytAcc)?.imported === 1 && /Instagram 게시물 목록/.test(r4.accounts.find((a) => a.accountId === igAcc)?.error ?? ""), "비공개였던 영상이 공개되자 붙음 · 인스타 실패는 그 계정에만 기록", JSON.stringify(r4.accounts.map((a) => a.error)));
    ok((await externalStatus(db, A, false, P)).find((s) => s.accountId === igAcc)?.error, "실패 사유가 상태에 보임");

    // ---- 6. 인스타를 먼저 올리고 유튜브를 나중에 — 영상 이름은 유튜브 제목으로 ----
    igFail = false;
    const IG3 = { id: "18000000000000773", caption: "#다이소\n다이소 욕실 정리템 3가지 — 흡착 칫솔 걸이 · 샤워기 거치대 · 배수구 거름망\n#욕실정리", at: T0 + 60 * H, type: "VIDEO", product: "REELS" };
    const YT3 = { id: "vrfyExtYt04", title: "다이소 욕실 정리템 3가지｜칫솔 걸이 · 샤워기 거치대 · 배수구 거름망", desc: "", at: T0 + 63 * H, privacy: "public" };
    igPosts.push(IG3);
    ytVideos.push(YT3);
    await syncExternalPosts(db, { by: A, owner: A, prefix: P, now: T0 + 64 * H, metrics: false });
    const q3 = (await db.collection(NEANDER_COL.shortsPublications).where("owner", "==", A).get()).docs.map((d) => d.data() as PublicationDoc);
    const i3 = q3.find((p) => p.result?.externalId === IG3.id);
    const y3 = q3.find((p) => p.result?.externalId === YT3.id);
    ok(i3 && y3 && i3.projectId === y3.projectId && i3.external?.matched === "new" && y3.external?.matched === "paired", "인스타(먼저) · 유튜브(3시간 뒤)가 한 영상에");
    ok(i3 && (await store.getProject(db, A, i3.projectId)).title === YT3.title, "자동으로 지은 인스타 이름은 유튜브 제목으로 바뀜");
    ok(!calls.some((c) => c.startsWith("POST https://www.googleapis.com/upload") || c.includes("media_publish")), "읽기만 함 (업로드 · 게시 호출 없음)");
  } finally {
    platforms.setPlatformFetch(null);
    setYoutubeDataFetch(null);
    await cleanup();
    const left = (await db.collection(NEANDER_COL.shortsPublications).where("owner", "==", A).get()).size + (await db.collection(NEANDER_COL.shortsProjects).where("owner", "==", A).get()).size;
    ok(left === 0, "검증 문서를 모두 지움");
  }
  console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
  process.exit(fails ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
