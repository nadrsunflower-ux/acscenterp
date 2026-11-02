// ============================================================
//  AI STUDIO 프로젝트(채널 단위) 서버 검증 — 실제 Firestore
// ------------------------------------------------------------
//    npm run shorts:verify-spaces
//  검증용 프로젝트 하나를 만들어 분석 자료가 따로 쌓이는지 · 공용 자료에 프로젝트가 찍히는지 ·
//  전역(검색 한도 · 가중치)은 그대로인지 본다. 검증 전용 이메일(shorts-verify-sp-*)의 것만 만들고 모두 지운다.
//  외부 호출은 없다 (YouTube · AI 를 부르는 실행은 하지 않는다).
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import * as S from "@/lib/neander/shorts/server/space-db";
import * as store from "@/lib/neander/shorts/server/store";
import * as folders from "@/lib/neander/shorts/server/folders";
import * as accounts from "@/lib/neander/shorts/server/accounts";
import * as secret from "@/lib/neander/shorts/server/secret";
import * as platforms from "@/lib/neander/shorts/server/platforms";
import { getRadarSettings, saveRadarSettings } from "@/lib/neander/shorts/server/radar-run";
import { getMarketSettings, saveNote, listNotes } from "@/lib/neander/shorts/server/market";
import { getScoutAuto } from "@/lib/neander/shorts/server/scout-auto-run";
import { listWatch } from "@/lib/neander/shorts/server/scout-store";
import { DEFAULT_SPACE_ID, SPACE_HEADER, spaceOf } from "@/lib/neander/shorts/spaces";
import type { AccountDoc, ProjectDoc, TemplateDoc, TrendDoc } from "@/lib/neander/shorts/types";

const A = "shorts-verify-sp-a@test.invalid";
const B = "shorts-verify-sp-b@test.invalid";
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
const req = (space?: string) => new Request("https://x.test/api", { headers: space ? { [SPACE_HEADER]: space } : {} });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function main() {
  const db = adminDb();
  const name = `검증 프로젝트 ${Date.now().toString(36)} (자동 삭제)`;
  let sid = "";
  const made = { projects: [] as string[], templates: [] as string[], trends: [] as string[], folders: [] as string[], accounts: [] as string[], notes: [] as string[] };
  try {
    // ---- 1. 만들기 · 목록 · 머리글 ----
    const sp = await S.createSpace(db, A, { name, description: "반려동물 용품 AI 스토리 광고", production: "ai" });
    sid = sp.id;
    ok(/^sp[a-z0-9]{6,20}$/.test(sid) && sp.writerStyle === "story" && sp.production === "ai", "새 프로젝트 — id · AI 생성이면 대본은 스토리 광고", sid);
    await rejects(S.createSpace(db, B, { name }), /이미 있습니다/, "같은 이름은 거절");
    const list = await S.listSpaces(db);
    ok(list[0].id === DEFAULT_SPACE_ID && list.some((x) => x.id === sid), "목록 — 기본 프로젝트가 맨 위 · 새 프로젝트 있음");
    ok((await S.spaceFromRequest(req(), db)) === DEFAULT_SPACE_ID && (await S.spaceFromRequest(req(sid), db)) === sid, "머리글 없으면 기본 · 있으면 그 프로젝트");
    await rejects(S.spaceFromRequest(req("../etc"), db), /올바르지/, "엉뚱한 id 는 거절");
    await rejects(S.spaceFromRequest(req("spzzzzzzzzzz"), db), /찾지 못했습니다/, "없는 프로젝트는 거절 (아무 컬렉션이나 만들지 않게)");
    await rejects(S.updateSpace(db, B, sid, { archived: true }, false), /관리자만/, "보관은 관리자만");
    await rejects(S.updateSpace(db, A, DEFAULT_SPACE_ID, { archived: true }, true), /보관할 수 없습니다/, "기본 프로젝트는 보관 불가");
    const up = await S.updateSpace(db, B, sid, { description: "반려동물 · 생활 꿀템 AI 스토리 광고", writerStyle: "story" }, false);
    ok(up.writerStyle === "story" && up.updatedBy === B && up.createdBy === A, "팀 공용 — 다른 사람도 고침 (만든 사람은 그대로)");

    const sdb = S.spaceDb(db, sid);
    const ddb = S.spaceDb(db, DEFAULT_SPACE_ID);
    ok(S.currentSpace(sdb) === sid && S.currentSpace(db) === undefined && S.rootDb(sdb) === db, "감싼 db — 지금 프로젝트 · 원래 db");
    ok(sdb.collection(NEANDER_COL.shortsRadar).path === `${NEANDER_COL.shortsRadar}__${sid}` && sdb.collection(NEANDER_COL.shortsProjects).path === NEANDER_COL.shortsProjects && ddb.collection(NEANDER_COL.shortsRadar).path === NEANDER_COL.shortsRadar, "분석 컬렉션만 프로젝트별 이름 (영상 · 기본 프로젝트는 그대로)");
    ok(sdb.doc(`${NEANDER_COL.shortsSettings}/radar`).path === `${NEANDER_COL.shortsSettings}__${sid}/radar`, "doc(경로) 도 바꿈");

    // ---- 2. 분석 설정 — 새 프로젝트는 빈 검색어로, 기본 프로젝트는 그대로 ----
    const rootRadar = await getRadarSettings(db);
    const sr = await getRadarSettings(sdb);
    ok(sr.keywords.length === 0 && rootRadar.keywords.length > 0, "레이더 — 새 프로젝트는 빈 검색어 · 살림은 그대로", `${rootRadar.keywords.length}개`);
    await saveRadarSettings(sdb, A, { ...sr, keywords: ["강아지 미용기", "고양이 장난감"] });
    ok((await getRadarSettings(sdb)).keywords.join() === "강아지 미용기,고양이 장난감" && (await getRadarSettings(db)).keywords.join() === rootRadar.keywords.join(), "레이더 검색어 저장은 그 프로젝트에만");
    ok((await db.collection(`${NEANDER_COL.shortsSettings}__${sid}`).doc("radar").get()).exists, "설정은 프로젝트별 컬렉션에 저장됨");
    ok((await getMarketSettings(sdb)).groups.length === 0 && (await getMarketSettings(db)).groups.length > 0, "시장 트렌드 — 새 프로젝트는 빈 검색어 묶음");
    ok((await getScoutAuto(sdb)).countries.length === 0, "바이럴 형식 자동화 — 새 프로젝트는 해외 찾기 없이");
    ok((await listWatch(sdb)).length === 0, "감시 채널 — 새 프로젝트는 비어 있음");
    const n1 = await saveNote(sdb, A, null, { title: "검증 노트", source: { kind: "manual" } });
    made.notes.push(n1.id);
    ok((await listNotes(sdb, A)).some((x) => x.id === n1.id) && !(await listNotes(db, A)).some((x) => x.id === n1.id), "트렌드 노트도 프로젝트별");

    // ---- 3. 전역은 그대로 — YouTube 검색 한도 · 가중치 ----
    const qkey = `verify_sp_${Date.now().toString(36)}`;
    await store.takeQuota(sdb, qkey, 5);
    ok((await db.collection(NEANDER_COL.shortsSettings).doc(`usage_${qkey}`).get()).exists && !(await db.collection(`${NEANDER_COL.shortsSettings}__${sid}`).doc(`usage_${qkey}`).get()).exists, "검색 한도 계수기는 프로젝트와 상관없이 하나");
    await db.collection(NEANDER_COL.shortsSettings).doc(`usage_${qkey}`).delete();
    await store.saveWeights(sdb, A, { info: 3 });
    ok((await db.collection(NEANDER_COL.shortsSettings).doc(`user_${A}`).get()).exists, "사람별 가중치도 전역");

    // ---- 4. 공용 자료에 프로젝트가 찍히고 목록이 나뉜다 ----
    const pS = await store.createProject(sdb, A, { title: "검증 AI 영상", kind: "coupang" });
    const pD = await store.createProject(db, A, { title: "검증 살림 영상", kind: "general" });
    made.projects.push(pS, pD);
    const docS = (await db.collection(NEANDER_COL.shortsProjects).doc(pS).get()).data() as ProjectDoc;
    const docD = (await db.collection(NEANDER_COL.shortsProjects).doc(pD).get()).data() as ProjectDoc;
    ok(docS.spaceId === sid && docD.spaceId === DEFAULT_SPACE_ID, "영상 — 만든 프로젝트가 찍힘 (감싸지 않으면 기본)");
    const inS = (await store.listProjects(sdb, A)).map((p) => p.id);
    const inD = (await store.listProjects(ddb, A)).map((p) => p.id);
    const all = (await store.listProjects(db, A)).map((p) => p.id);
    ok(inS.includes(pS) && !inS.includes(pD) && inD.includes(pD) && !inD.includes(pS) && all.includes(pS) && all.includes(pD), "영상 목록 — 프로젝트마다 · 감싸지 않으면 전부(대시보드)");
    const saved = await store.saveProject(db, A, pS, { ...(await store.getProject(db, A, pS)), title: "고친 제목" }, docS.updatedAt);
    ok(saved.spaceId === sid, "저장해도 프로젝트는 그대로");
    const tS = await store.saveTemplate(sdb, A, null, { name: "검증 공식" });
    made.templates.push(tS);
    await store.saveTemplate(db, A, tS, { name: "검증 공식 고침" });
    ok(((await db.collection(NEANDER_COL.shortsTemplates).doc(tS).get()).data() as TemplateDoc).spaceId === sid && !(await store.listTemplates(ddb, A)).some((t) => t.id === tS), "성공 공식 — 프로젝트 찍힘 · 고쳐도 그대로 · 다른 프로젝트 목록에 없음");
    const rS = await store.saveTrend(sdb, A, null, { title: "검증 소재", url: "https://www.youtube.com/shorts/aaaaaaaaaaa" });
    made.trends.push(rS);
    ok(((await db.collection(NEANDER_COL.shortsTrends).doc(rS).get()).data() as TrendDoc).spaceId === sid && (await store.listTrends(sdb, A)).some((t) => t.id === rS), "소재 — 프로젝트 찍힘");

    // ---- 5. 폴더 — 프로젝트마다 · 다른 프로젝트 영상은 못 넣음 ----
    const fS = await folders.createFolder(sdb, A, { name: "검증 폴더" });
    made.folders.push(fS.id);
    ok(fS.spaceId === sid && !(await folders.listFolders(ddb)).some((f) => f.id === fS.id) && (await folders.listFolders(db)).some((f) => f.id === fS.id), "폴더 — 프로젝트 찍힘 · 목록 나뉨");
    await rejects(folders.moveProjects(db, A, [pD], fS.id), /다른 프로젝트의 영상/, "살림 영상을 새 프로젝트 폴더에 넣으면 거절");
    ok((await folders.moveProjects(db, A, [pS], fS.id)) === 1, "같은 프로젝트 영상은 옮겨짐");
    await folders.createFolder(ddb, A, { name: "검증 폴더" }).then((f) => made.folders.push(f.id));
    ok(true, "같은 이름 폴더도 프로젝트가 다르면 만들 수 있음");

    // ---- 6. 계정 — 프로젝트 찍기 · 옮기기 · 목록 ----
    const accId = accounts.accountId("youtube", "UCverifySpaceAAAA01", A);
    made.accounts.push(accId);
    await db.collection(NEANDER_COL.shortsAccounts).doc(accId).set({
      owner: A, platform: "youtube", authMode: "google_oauth", externalId: "UCverifySpaceAAAA01", externalName: "검증 AI 채널", sealed: secret.sealTokens({ refreshToken: "r" }, accId),
      scopes: [], tokenExpiresAt: null, sharedWith: [], status: "connected", coupangChannel: null, coupangSubId: null, createdAt: Date.now(), updatedAt: Date.now(),
    } satisfies AccountDoc);
    ok(!(await accounts.listAccounts(sdb, A)).some((a) => a.id === accId) && (await accounts.listAccounts(ddb, A)).some((a) => a.id === accId), "프로젝트가 없던 계정은 살림 것");
    await accounts.updateAccount(db, A, accId, { spaceId: sid });
    ok((await accounts.listAccounts(sdb, A)).some((a) => a.id === accId) && !(await accounts.listAccounts(ddb, A)).some((a) => a.id === accId), "계정을 새 프로젝트로 옮김");
    await rejects(accounts.updateAccount(db, A, accId, { spaceId: "spzzzzzzzzzz" }), /찾지 못했습니다/, "없는 프로젝트로는 못 옮김");
    await rejects(accounts.updateAccount(db, B, accId, { spaceId: DEFAULT_SPACE_ID }), /소유자|권한|주인/, "계정 주인만 옮김");

    // ---- 7. 계정 연결(OAuth) — 연결을 시작한 화면의 프로젝트가 새 계정에 찍힌다 (Google · Meta 는 모의) ----
    // 사용자 제한(NEANDER_SHORTS_EMAILS)이 있으면 검증 이메일을 이 실행 안에서만 더한다 (.env.local 은 그대로)
    if (process.env.NEANDER_SHORTS_EMAILS) process.env.NEANDER_SHORTS_EMAILS += `,${A}`;
    const ytChan = "UCverifySpaceOAuth01";
    const igUser = "17841400000000088";
    platforms.setPlatformFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "at", refresh_token: "rt-verify", scope: platforms.YOUTUBE_SCOPES.join(" ") });
      if (url.includes("/youtube/v3/channels")) return json({ items: [{ id: ytChan, snippet: { title: "검증 뭉치 채널" } }] });
      if (url.includes("graph.facebook.com") && url.includes("/oauth/access_token")) return json({ access_token: url.includes("fb_exchange_token") ? "long-token" : "short-token" });
      if (url.includes("graph.facebook.com") && url.includes("/me/accounts")) return json({ data: [{ id: "990000001", name: "검증 페이지", access_token: "page-token", instagram_business_account: { id: igUser, username: "verify.moongchi" } }] });
      throw new Error(`검증 중 모의 응답이 없는 외부 호출: ${url.split("?")[0]}`);
    }) as typeof fetch);
    const stateOf = (u: string) => new URL(u).searchParams.get("state") ?? "";
    const yState = stateOf(await accounts.startOAuth(sdb, A, "youtube", "https://x.test"));
    const yReq = (await db.collection(NEANDER_COL.shortsOAuth).doc(yState).get()).data() as { spaceId?: string } | undefined;
    ok(yReq?.spaceId === sid, "연결 시작 — 지금 프로젝트가 연결 요청(state)에 실림", yReq?.spaceId);
    const yRes = await accounts.finishOAuth(db, yState, "code-verify-yt");
    const yId = accounts.accountId("youtube", ytChan, A);
    made.accounts.push(yId);
    const yAcc = (await db.collection(NEANDER_COL.shortsAccounts).doc(yId).get()).data() as AccountDoc | undefined;
    ok(yRes.created === 1 && !!yAcc && spaceOf(yAcc) === sid && (await accounts.listAccounts(sdb, A)).some((a) => a.id === yId), "YouTube 연결 → 새 계정에 그 프로젝트가 찍히고 그 프로젝트 목록에 나옴");
    const iState = stateOf(await accounts.startOAuth(sdb, A, "instagram", "https://x.test"));
    await accounts.finishOAuth(db, iState, "code-verify-ig");
    const iId = accounts.accountId("instagram", igUser, A);
    made.accounts.push(iId);
    const iAcc = (await db.collection(NEANDER_COL.shortsAccounts).doc(iId).get()).data() as AccountDoc | undefined;
    ok(!!iAcc && spaceOf(iAcc) === sid && iAcc.externalName === "@verify.moongchi", "Instagram 연결 → 새 계정에 그 프로젝트가 찍힘");
    const again = stateOf(await accounts.startOAuth(ddb, A, "youtube", "https://x.test"));
    await accounts.finishOAuth(db, again, "code-verify-yt2");
    ok(spaceOf((await db.collection(NEANDER_COL.shortsAccounts).doc(yId).get()).data() as AccountDoc) === sid, "살림 화면에서 다시 연결해도 원래 프로젝트 그대로 (옮기려면 「프로젝트」 칸에서)");
    platforms.setPlatformFetch(null);

    // ---- 8. 자동 실행 — 프로젝트마다 남은 시간을 나눠 ----
    const until = Date.now() + 60_000;
    const seen: { name: string; left: number }[] = [];
    const r = await S.forEachSpace(db, until, async (_x, s, deadline) => {
      seen.push({ name: s.name, left: deadline - Date.now() });
      return s.id;
    });
    const n = Object.keys(r).length;
    ok(n >= 2 && Object.values(r).includes(sid) && seen[0].left <= 60_000 / n + 500, "자동 실행 — 보관 안 한 프로젝트마다 · 첫 프로젝트는 몫만큼", JSON.stringify(seen.map((x) => Math.round(x.left / 1000))));
    await S.updateSpace(db, A, sid, { archived: true }, true);
    ok(!(await S.listSpaces(db)).some((x) => x.id === sid) && (await S.listSpaces(db, true)).some((x) => x.id === sid && x.archived), "보관하면 목록 · 자동 실행에서 빠짐 (보관 목록엔 있음)");
  } finally {
    platforms.setPlatformFetch(null);
    // ---- 정리 ----
    for (const id of made.projects) await db.collection(NEANDER_COL.shortsProjects).doc(id).delete();
    for (const id of made.templates) await db.collection(NEANDER_COL.shortsTemplates).doc(id).delete();
    for (const id of made.trends) await db.collection(NEANDER_COL.shortsTrends).doc(id).delete();
    for (const id of made.folders) await db.collection(NEANDER_COL.shortsFolders).doc(id).delete();
    for (const id of made.accounts) await db.collection(NEANDER_COL.shortsAccounts).doc(id).delete();
    for (const who of [A, B]) await db.collection(NEANDER_COL.shortsSettings).doc(`user_${who}`).delete();
    if (sid) {
      for (const base of S.SCOPED_COLLECTIONS) {
        const c = db.collection(`${base}__${sid}`);
        for (const d of (await c.get()).docs) await d.ref.delete();
      }
      await db.collection(NEANDER_COL.shortsSpaces).doc(sid).delete();
    }
    const left = sid ? (await db.collection(NEANDER_COL.shortsSpaces).doc(sid).get()).exists : false;
    ok(!left, "검증 프로젝트와 자료를 모두 지움");
  }
  console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
  process.exit(fails ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
