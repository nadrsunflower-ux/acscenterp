// ============================================================
//  AI STUDIO 서버 검증 — 실제 Firestore 에서 (외부 API 는 전부 모의 응답)
// ------------------------------------------------------------
//   npm run shorts:verify-server
//
//  검증용 이메일 두 개(shorts-verify-a/b@test.invalid)로 문서를 만들고 끝나면 지운다.
//  실제 사용자의 쇼츠 작업이 대기 중이면 시작하지 않는다 — 실행기(tick)가 그 작업까지
//  모의 응답으로 돌려 버리면 안 되기 때문이다.
//
//  보는 것: 사람별 데이터 분리 · 출처 위조 막기 · 확인한 사람 찍기 · 동시 편집 409 ·
//  버전 · 파일 조각 저장/복원 · 작업 중복 · 임대 만료(불확실 · 중단) · 게시 중복 방지 ·
//  불확실한 결과 처리 · 예약 · Instagram 처리 대기 · 계정 공유 권한 ·
//  고객사(브랜드 대행) 담당자 권한 · 고객 검토 링크 · 승인한 파일만 게시
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "@/lib/neander/server/admin";
import { NEANDER_COL } from "@/lib/neander/collections";
import { DISCLOSURE, COMPLIANCE_ITEMS, brandDisclosureLine } from "@/lib/neander/shorts/model";
import type { AccountDoc, JobDoc, ProjectDoc, PublicationDoc, TrendDoc } from "@/lib/neander/shorts/types";
// 정적 import — 동적 import() 를 섞으면 모듈이 두 벌 생겨 모의 fetch 가 실행기에 안 닿는다
import * as store from "@/lib/neander/shorts/server/store";
import * as media from "@/lib/neander/shorts/server/media";
import * as jobs from "@/lib/neander/shorts/server/jobs";
import * as pubs from "@/lib/neander/shorts/server/publishing";
import * as accounts from "@/lib/neander/shorts/server/accounts";
import * as runner from "@/lib/neander/shorts/server/runner";
import * as platforms from "@/lib/neander/shorts/server/platforms";
import * as secret from "@/lib/neander/shorts/server/secret";
import * as profiles from "@/lib/neander/shorts/server/profiles";
import * as coupang from "@/lib/neander/shorts/server/coupang";
import * as metrics from "@/lib/neander/shorts/server/metrics";
import * as clients from "@/lib/neander/shorts/server/clients";
import * as reviews from "@/lib/neander/shorts/server/reviews";
import * as radarRun from "@/lib/neander/shorts/server/radar-run";
import { setAiFetch } from "@/lib/neander/shorts/server/ai";
import { setNaverFetch } from "@/lib/neander/shorts/server/naver";
import { setYoutubeDataFetch } from "@/lib/neander/shorts/server/youtube-data";
import { DEFAULT_RADAR_SETTINGS, radarNoteState } from "@/lib/neander/shorts/radar";
import * as scoutAuto from "@/lib/neander/shorts/server/scout-auto-run";
import * as scoutStore from "@/lib/neander/shorts/server/scout-store";
import * as scriptWriter from "@/lib/neander/shorts/server/script-writer";
import { setScoutAiFetch } from "@/lib/neander/shorts/server/scout-ai";
import { DEFAULT_SCOUT_AUTO, type ScoutAutoSummary } from "@/lib/neander/shorts/scout-auto";
import type { HitAnalysis } from "@/lib/neander/shorts/scout";

process.env.NEANDER_SHORTS_TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.NEANDER_SHORTS_GOOGLE_CLIENT_ID = "verify-client";
process.env.NEANDER_SHORTS_GOOGLE_CLIENT_SECRET = "verify-secret";

const A = "shorts-verify-a@test.invalid";
const B = "shorts-verify-b@test.invalid";
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

async function main() {
  const db = adminDb();
  // 모의 fetch 가 꽂히기 전에 진짜 외부로 나가는 일이 없도록 — 처음부터 막아 둔다
  platforms.setPlatformFetch((async (input: RequestInfo | URL) => {
    throw new Error(`검증 중 모의 응답이 없는 외부 호출: ${String(input).split("?")[0]}`);
  }) as typeof fetch);

  // 안전장치 — 실제 사용자의 살아 있는 작업이 있으면 멈춘다
  const live = await db.collection(NEANDER_COL.shortsJobs).where("status", "in", ["queued", "waiting", "running"]).get();
  const foreign = live.docs.filter((d) => ![A, B].includes((d.data() as JobDoc).owner));
  if (foreign.length) throw new Error(`실제 쇼츠 작업 ${foreign.length}건이 대기 중이라 검증을 시작하지 않습니다.`);

  const created = { projects: [] as string[], trends: [] as string[], clients: [] as string[], watch: [] as string[], hits: [] as string[], formats: [] as string[] };
  try {
    // ---- 1. 사람별 분리 ----
    const pid = await store.createProject(db, A, { product: "검증 선반", visibility: "private" });
    created.projects.push(pid);
    ok(!(await store.listProjects(db, B)).some((p) => p.id === pid), "비공개 프로젝트는 B 목록에 없음");
    await rejects(store.getProject(db, B, pid), /비공개/, "B 가 A 의 비공개 프로젝트를 열면 거절");
    await rejects(store.saveProject(db, B, pid, {}, undefined), /비공개/, "B 는 A 의 비공개 프로젝트를 고칠 수 없음");
    let p = await store.getProject(db, A, pid);
    p = await store.saveProject(db, A, pid, { ...p, visibility: "team" }, p.updatedAt);
    ok(p.visibility === "team", "소유자가 팀 공개로 바꿈");
    const asB = await store.getProject(db, B, pid);
    ok(asB.id === pid, "팀 공개 뒤 B 가 읽음");
    const savedByB = await store.saveProject(db, B, pid, { ...asB, title: "B 가 고친 제목", visibility: "private" }, asB.updatedAt);
    ok(savedByB.title === "B 가 고친 제목" && savedByB.visibility === "team", "B 는 내용은 고치되 공개 범위는 못 바꿈");
    await rejects(store.deleteProject(db, B, pid), /소유자만/, "B 는 지울 수 없음 (소유자만)");

    // ---- 2. 동시 편집 ----
    await rejects(store.saveProject(db, A, pid, { ...savedByB, title: "늦은 저장" }, p.updatedAt), /먼저 고쳤습니다/, "옛 기준으로 저장하면 409 (덮어쓰기 방지)");

    // ---- 3. 확인한 사람 · 출처는 서버가 찍는다 ----
    let cur = await store.getProject(db, A, pid);
    const withChecks = {
      ...cur,
      coupang: {
        candidates: [
          { id: "c1", url: "https://www.coupang.com/vp/products/123", name: "검증 선반", match: "identical", confirmedBy: "evil@x.com", confirmedAt: 1, checks: { brand: true }, source: "api" },
        ],
        affiliate: { url: "https://link.coupang.com/a/abc123", candidateId: "c1", subId: "", method: "api", by: "evil@x.com", issuedAt: 1 },
      },
      compliance: Object.fromEntries(COMPLIANCE_ITEMS.map((i) => [i.key, { system: { ok: true, detail: "가짜", at: 1 }, user: { ok: true, by: "evil@x.com", at: 1, note: "" } }])),
    };
    cur = await store.saveProject(db, A, pid, withChecks, cur.updatedAt);
    const c1 = cur.coupang.candidates[0];
    ok(c1.confirmedBy === A, "동일 상품 확인자는 서버가 요청자로 찍음", String(c1.confirmedBy));
    ok(c1.source === "manual", "화면이 「API 검색에서 찾음」 을 주장해도 직접 추가로 기록", c1.source);
    ok(cur.coupang.affiliate?.by === A && cur.coupang.affiliate.method === "manual", "제휴 링크의 만든 사람 · 방식도 서버가 정함");
    ok(
      COMPLIANCE_ITEMS.every((i) => cur.compliance[i.key]?.user?.by === A) && Object.values(cur.compliance).every((c) => c?.system === null),
      "정책 확인: 사람 확인자는 요청자, 프로그램 확인 칸은 브라우저 값을 버림",
    );
    await rejects(store.saveProject(db, A, pid, { ...cur, coupang: { ...cur.coupang, affiliate: { url: "https://bit.ly/x" } } }, cur.updatedAt), /link\.coupang\.com/, "쿠팡 파트너스 주소가 아니면 저장 거절");

    const tid = await store.saveTrend(db, A, null, { url: "https://www.xiaohongshu.com/explore/abc", product: "선반", metrics: { views: { v: 5000, src: "api" }, saves: { v: null, src: "manual" } } });
    created.trends.push(tid);
    const t = (await db.collection(NEANDER_COL.shortsTrends).doc(tid).get()).data() as TrendDoc;
    ok(t.metrics.views.src === "manual" && t.metrics.views.v === 5000, "브라우저가 보낸 「공식 API」 출처는 직접 입력으로 내림");
    ok(t.metrics.saves.v === null, "모르는 저장 수는 null 로 남음 (0 아님)");
    ok(t.platform === "xiaohongshu", "주소로 플랫폼을 알아봄");

    // ---- 4. 버전 ----
    cur = await store.getProject(db, A, pid);
    cur = await store.saveProject(db, A, pid, { ...cur, script: { lines: [{ id: "l1", beat: "hook", text: "첫 대본", caption: "", sceneId: null }] } }, cur.updatedAt);
    cur = await store.saveProject(db, A, pid, { ...cur, script: { lines: [{ id: "l1", beat: "hook", text: "둘째 대본", caption: "", sceneId: null }] } }, cur.updatedAt);
    await store.addVersion(db, pid, "script", cur.script, A, "사람이 저장");
    const vs = await store.listVersions(db, A, pid);
    ok(vs.some((v) => v.kind === "script" && v.note === "사람이 저장"), "버전 저장 · 목록", `${vs.length}건`);
    const v = await store.getVersion(db, A, vs.find((x) => x.note === "사람이 저장")!.id);
    ok((v.data as ProjectDoc["script"]).lines[0].text === "둘째 대본", "버전 내용 복원 가능");

    // ---- 5. 파일 조각 저장 · 복원 ----
    const bytes = randomBytes(2 * 1024 * 1024 + 123);
    const m = await media.createMedia(db, A, { projectId: pid, kind: "source", name: "검증.mp4", type: "video/mp4", size: bytes.length, duration: 3 });
    ok(m.parts === 3, "2MB 파일 → 768KB 조각 3개", String(m.parts));
    await rejects(media.completeMedia(db, A, m.id), /다 올라가지 않았습니다/, "조각이 덜 왔으면 완료 거절");
    for (let n = 0; n < m.parts; n++) await media.putPart(db, A, m.id, n, bytes.subarray(n * media.PART_BYTES, (n + 1) * media.PART_BYTES));
    await rejects(media.putPart(db, B, m.id, 0, Buffer.from("x")), /넣을 수 없습니다/, "올리기 시작한 사람만 조각을 넣음");
    await media.completeMedia(db, A, m.id);
    const back = Buffer.concat([await media.readParts(db, A, m.id, 0, 2), await media.readParts(db, A, m.id, 2, 2)]);
    ok(back.equals(bytes), "조각을 이어 받으면 원본과 같음", `${back.length} bytes`);
    await rejects(media.createMedia(db, A, { projectId: pid, kind: "source", name: "big.mp4", type: "video/mp4", size: 61 * 1024 * 1024 }), /60MB/, "파일 하나 60MB 초과 거절");
    await rejects(media.createMedia(db, A, { projectId: pid, kind: "source", name: "x.exe", type: "application/x-msdownload", size: 10 }), /영상 · 음성 · 이미지/, "영상 · 음성 · 이미지만");
    // 비공개로 돌리면 B 는 파일도 못 읽는다
    cur = await store.getProject(db, A, pid);
    cur = await store.saveProject(db, A, pid, { ...cur, visibility: "private" }, cur.updatedAt);
    await rejects(media.readParts(db, B, m.id, 0, 1), /비공개/, "비공개 프로젝트의 파일은 B 가 못 받음");

    // ---- 6. 작업 큐 ----
    const j1 = await jobs.enqueue(db, jobs.newJob(A, pid, "tts", "server", { lines: [] }, { step: "synthesize", dedupeKey: `verify_${pid}` }));
    await rejects(jobs.enqueue(db, jobs.newJob(A, pid, "tts", "server", {}, { step: "synthesize", dedupeKey: `verify_${pid}` })), /이미 진행 중/, "같은 열쇠의 작업이 살아 있으면 중복 거절");
    const cancelled = await jobs.requestCancel(db, A, j1);
    ok(cancelled.status === "cancelled", "외부로 보내기 전 작업은 바로 취소");
    const jW = await jobs.enqueue(db, { ...jobs.newJob(A, pid, "ai_video", "server", {}, { step: "submit" }), status: "running", stepState: "writing", leaseUntil: Date.now() - 1000, leaseBy: "dead" });
    const jR = await jobs.enqueue(db, { ...jobs.newJob(A, pid, "ai_video", "server", {}, { step: "poll" }), status: "running", stepState: "idle", leaseUntil: Date.now() - 1000, leaseBy: "dead" });
    const jB = await jobs.enqueue(db, { ...jobs.newJob(A, pid, "render", "browser", {}, { step: "render" }), leaseUntil: Date.now() - 1000 }, "tab1");
    await jobs.reapExpired(db);
    const st = async (id: string) => ((await db.collection(NEANDER_COL.shortsJobs).doc(id).get()).data() as JobDoc).status;
    ok((await st(jW)) === "uncertain", "외부 쓰기 도중 임대가 끝나면 uncertain (자동 재시도 안 함)");
    ok((await st(jR)) === "queued", "읽기 단계에서 끊기면 다시 대기열");
    ok((await st(jB)) === "interrupted", "브라우저 출력 창이 끊기면 interrupted");
    await rejects(jobs.updateBrowserRender(db, A, jB, "tab1", { pct: 50 }), /중단된/, "중단된 출력은 진행을 받지 않음");
    await jobs.requestCancel(db, A, jR).catch(() => undefined);
    await db.collection(NEANDER_COL.shortsJobs).doc(jR).update({ status: "cancelled" });

    // ---- 7. 게시 원장 (YouTube 모의) ----
    const accId = accounts.accountId("youtube", "UCverify", A);
    const acc: AccountDoc = {
      owner: A,
      platform: "youtube",
      authMode: "google_oauth",
      externalId: "UCverify",
      externalName: "검증 채널",
      sealed: secret.sealTokens({ refreshToken: "refresh-verify" }, accId),
      scopes: [],
      tokenExpiresAt: null,
      sharedWith: [],
      status: "connected",
      coupangChannel: { registered: true, by: A, at: Date.now(), url: "https://youtube.com/@verify" },
      coupangSubId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.collection(NEANDER_COL.shortsAccounts).doc(accId).set(acc);
    await rejects(accounts.getAccountForPublish(db, B, accId), /권한이 없습니다/, "B 는 A 의 계정으로 게시할 수 없음");
    await rejects(accounts.updateAccount(db, A, accId, { sharedWith: [B] }), /팀원이 아닙니다/, "공유 대상은 등록된 팀원만");
    ok(!(await accounts.listAccounts(db, B)).some((a) => a.id === accId), "B 의 계정 목록에 A 의 계정 없음");
    ok(!JSON.stringify(await accounts.listAccounts(db, A)).includes("refresh-verify") && !JSON.stringify(await accounts.listAccounts(db, A)).includes(acc.sealed), "계정 목록에 토큰 · 암호문이 없음");

    const mkRender = async () => {
      const buf = randomBytes(4000);
      const r = await media.saveBytes(db, A, { projectId: pid, kind: "render", name: "out.mp4", type: "video/mp4", duration: 6, width: 720, height: 1280, origin: null, codecs: { video: "avc", audio: "aac" }, overlay: { disclosure: true, text: "광고" } }, buf);
      await store.patchProject(db, pid, A, (pp) => void pp.renderIds.push(r.id));
      return r.id;
    };
    const r1 = await mkRender();
    cur = await store.getProject(db, A, pid);
    const userOk = Object.fromEntries(COMPLIANCE_ITEMS.map((i) => [i.key, { system: null, user: { ok: true, by: A, at: 1, note: "" } }]));
    cur = await store.saveProject(db, A, pid, { ...cur, publish: { ...cur.publish, title: "검증 영상", synthetic: false }, compliance: { ...userOk, dmConsent: { system: null, user: null } } }, cur.updatedAt);
    const prep = await pubs.preparePublish(db, A, { projectId: pid, accountId: accId, renderId: r1 });
    ok(prep.caption.startsWith(DISCLOSURE), "게시 문구 첫 줄 = 표준 고지");
    ok(prep.blockers.map((b) => b.key).join() === "dmConsent", "사람 확인이 빠진 항목만 막음", prep.blockers.map((b) => b.key).join());
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r1 }), /확인이 남았습니다/, "확인이 남으면 게시 거절");
    cur = await store.getProject(db, A, pid);
    cur = await store.saveProject(db, A, pid, { ...cur, compliance: { ...cur.compliance, dmConsent: { system: null, user: { ok: true } } } }, cur.updatedAt);

    // 모의 YouTube — 실제처럼 재개형 세션: 「bytes */N」 물음에는 받은 만큼(308 Range), 다 받으면 영상
    const calls: string[] = [];
    let mode: "ok" | "drop" | "noid" = "ok";
    let received = 0;
    let dataPuts = 0;
    // Instagram 계정이 미리 있으면 YouTube 에만 올린 파일은 지우지 않는다 (마저 올릴 수 있게)
    const igId = accounts.accountId("instagram", "17841499999999999", A);
    await db.collection(NEANDER_COL.shortsAccounts).doc(igId).set({ ...acc, platform: "instagram", authMode: "facebook_login", externalId: "17841499999999999", externalName: "@verify", sealed: secret.sealTokens({ pageToken: "pt" }, igId) });
    platforms.setPlatformFetch((async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      if (url.includes("uploadType=resumable")) {
        received = 0;
        return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=v" } });
      }
      if (init.method === "PUT") {
        const range = String((init.headers as Record<string, string>)["Content-Range"] ?? "");
        const total = Number(range.split("/")[1]);
        const done = () =>
          mode === "noid"
            ? new Response(JSON.stringify({ status: {} }), { status: 201 })
            : new Response(JSON.stringify({ id: "verifyVid01", status: { uploadStatus: "uploaded", privacyStatus: "private" } }), { status: 201 });
        if (range.startsWith("bytes */")) return received >= total ? done() : new Response(null, { status: 308, headers: received ? { Range: `bytes=0-${received - 1}` } : {} });
        dataPuts++;
        if (mode === "drop") {
          mode = "ok"; // 한 번만 끊긴다
          throw new Error("connection reset");
        }
        const end = Number(range.slice(6).split("/")[0].split("-")[1]);
        received = end + 1;
        return received >= total ? done() : new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch);

    const c1pub = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r1 });
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r1 }), /이미 진행 중|진행 중/, "같은 계정 · 파일 · 플랫폼 두 번째 요청은 중복으로 거절");
    await runner.tick(db, { budgetMs: 30_000 });
    const pub1 = (await db.collection(NEANDER_COL.shortsPublications).doc(c1pub.publicationId).get()).data() as PublicationDoc;
    if (pub1.status !== "published") {
      const jd = (await db.collection(NEANDER_COL.shortsJobs).doc(c1pub.jobId).get()).data() as JobDoc;
      console.log("  ↳ 원장 오류:", pub1.error, "\n  ↳ 작업 기록:", jd.log.map((l) => l.msg).join(" | "), "\n  ↳ 호출:", calls.join(" , "));
    }
    ok(pub1.status === "published" && pub1.result?.externalId === "verifyVid01" && pub1.result.by === "api", "실행기가 업로드 → 게시됨 (실제 id 를 받았을 때만)", pub1.status);
    ok(dataPuts === 1, "영상 바이트는 한 번만 보냄", `${dataPuts}번`);
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r1 }), /이미 이 계정에 게시/, "게시된 파일을 같은 계정에 다시 게시하면 거절");
    ok(!((await db.collection(NEANDER_COL.shortsMedia).doc(r1).get()).data() as { purged?: unknown }).purged, "YouTube 에만 올리고 Instagram 이 연결돼 있으면 파일을 남김 (마저 올릴 수 있게)");

    // 전송 중 끊김 — 다시 물어 받은 곳부터 이어 보낸다 (두 번 올라가지 않는다)
    const r2 = await mkRender();
    mode = "drop";
    const c2 = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2 });
    await runner.tick(db, { budgetMs: 30_000 });
    let pub2 = (await db.collection(NEANDER_COL.shortsPublications).doc(c2.publicationId).get()).data() as PublicationDoc;
    const job2 = (await db.collection(NEANDER_COL.shortsJobs).doc(c2.jobId).get()).data() as JobDoc;
    ok(pub2.status === "uploading" && job2.status === "waiting", "전송 중 연결이 끊기면 잠시 뒤 다시 (uncertain 아님)", `${pub2.status} · 작업 ${job2.status}`);
    await db.collection(NEANDER_COL.shortsJobs).doc(c2.jobId).update({ runAt: Date.now() - 1000 });
    const putsBefore = dataPuts;
    await runner.tick(db, { budgetMs: 30_000 });
    pub2 = (await db.collection(NEANDER_COL.shortsPublications).doc(c2.publicationId).get()).data() as PublicationDoc;
    ok(pub2.status === "published" && dataPuts === putsBefore + 1, "끊긴 업로드는 세션에 물어 이어 보내 게시됨", `${pub2.status} · 바이트 전송 ${dataPuts - putsBefore}번`);

    // 불확실한 결과 — 다 받았다는데 영상 id 가 없다
    const r2b = await mkRender();
    mode = "noid";
    const c2b = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2b });
    await runner.tick(db, { budgetMs: 30_000 });
    await runner.tick(db, { budgetMs: 30_000 });
    const pub2b = (await db.collection(NEANDER_COL.shortsPublications).doc(c2b.publicationId).get()).data() as PublicationDoc;
    ok(pub2b.status === "uncertain", "다 보냈는데 영상 id 가 없으면 uncertain", pub2b.status);
    const putsAfterUncertain = dataPuts;
    await runner.tick(db, { budgetMs: 30_000 });
    ok(dataPuts === putsAfterUncertain, "불확실한 업로드는 실행기가 다시 보내지 않음");
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2b }), /불확실/, "불확실한 게시가 있으면 같은 요청 거절");
    await pubs.resolvePublication(db, A, c2b.publicationId, { outcome: "not_published" });
    mode = "ok";
    const c3 = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2b });
    ok(c3.publicationId === c2b.publicationId, "사람이 「게시 안 됨」 을 확인하면 같은 원장에서 다시 시도");
    await pubs.cancelPublication(db, A, c3.publicationId);
    const pub3 = (await db.collection(NEANDER_COL.shortsPublications).doc(c3.publicationId).get()).data() as PublicationDoc;
    ok(pub3.status === "cancelled" && pub3.attempts === 2, "보내기 전 취소", `${pub3.status} · 시도 ${pub3.attempts}`);

    // 예약 — 시각 전에는 실행기가 건드리지 않는다
    const r3 = await mkRender();
    const at = Date.now() + 10 * 60_000;
    const c4 = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r3, scheduledAt: at });
    await runner.tick(db, { budgetMs: 30_000 });
    let pub4 = (await db.collection(NEANDER_COL.shortsPublications).doc(c4.publicationId).get()).data() as PublicationDoc;
    ok(pub4.status === "scheduled", "예약 시각 전에는 「예약 대기 (게시 전)」 그대로", pub4.status);
    await db.collection(NEANDER_COL.shortsJobs).doc(c4.jobId).update({ runAt: Date.now() - 1000 });
    await runner.tick(db, { budgetMs: 30_000 });
    pub4 = (await db.collection(NEANDER_COL.shortsPublications).doc(c4.publicationId).get()).data() as PublicationDoc;
    ok(pub4.status === "published", "예약 시각이 지나면 실행기가 게시", pub4.status);

    // ---- 8. Instagram 처리 대기 → 게시 ----
    let igStatus = "IN_PROGRESS";
    platforms.setPlatformFetch((async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.includes("content_publishing_limit")) return new Response(JSON.stringify({ data: [{ quota_usage: 1, config: { quota_total: 50 } }] }));
      if (url.endsWith("/media") && init.method === "POST") return new Response(JSON.stringify({ id: "555", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/555" }));
      if (url.startsWith("https://rupload.facebook.com")) return new Response(JSON.stringify({ success: true }));
      if (url.includes("fields=status_code")) return new Response(JSON.stringify({ status_code: igStatus }));
      if (url.endsWith("/media_publish")) return new Response(JSON.stringify({ id: "1799" }));
      if (url.includes("fields=permalink")) return new Response(JSON.stringify({ permalink: "https://www.instagram.com/reel/V/" }));
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
    const c5 = await pubs.createPublication(db, A, { projectId: pid, accountId: igId, renderId: r1 });
    await runner.tick(db, { budgetMs: 30_000 });
    let pub5 = (await db.collection(NEANDER_COL.shortsPublications).doc(c5.publicationId).get()).data() as PublicationDoc;
    ok(pub5.status === "processing", "Instagram 파일 전송 뒤 처리 대기 (게시 요청 전)", pub5.status);
    ok(c5.publicationId !== c1pub.publicationId, "같은 파일이라도 플랫폼 · 계정이 다르면 따로 게시 (부분 성공을 따로 기록)");
    igStatus = "FINISHED";
    await db.collection(NEANDER_COL.shortsJobs).doc(c5.jobId).update({ runAt: Date.now() - 1000 });
    await runner.tick(db, { budgetMs: 30_000 });
    pub5 = (await db.collection(NEANDER_COL.shortsPublications).doc(c5.publicationId).get()).data() as PublicationDoc;
    ok(pub5.status === "published" && pub5.result?.url === "https://www.instagram.com/reel/V/", "처리 완료 뒤 게시 · 주소 보관", pub5.status);
    ok(calls.filter((c) => c.endsWith("/media_publish")).length === 1, "media_publish 는 한 번만");

    // ---- 8-1. 게시 뒤 완성 파일 지우기 ----
    const r1Doc = (await db.collection(NEANDER_COL.shortsMedia).doc(r1).get()).data() as { purged?: { reason: string }; size: number; name: string } | undefined;
    ok(r1Doc?.purged?.reason === "published" && r1Doc.name === "out.mp4", "YouTube · Instagram 에 다 올리자 내용을 지우고 기록(이름 · 크기)은 남김", JSON.stringify(r1Doc?.purged));
    ok((await db.collection(NEANDER_COL.shortsMedia).doc(r1).collection("parts").count().get()).data().count === 0, "지운 파일의 조각이 실제로 없어짐");
    await rejects(media.readParts(db, A, r1, 0, 1), /게시가 끝나/, "지운 파일은 받을 수 없고 링크로 보라고 안내");
    ok((await media.listProjectMedia(db, pid, A)).some((m) => m.id === r1 && m.purged), "목록에는 「지움」 기록으로 남음 (게시 기록이 이 id 를 가리킴)");
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r1 }), /이미 이 계정에 게시/, "지운 파일을 같은 계정에 다시 게시하면 「이미 게시」 로 거절");
    // r3(예약 게시 · YouTube 만) — 하루가 지나면 정리 · 「파일 남기기」 를 켜면 안 지움
    const dayLater = Date.now() + 25 * 3600_000;
    let pDoc = await store.getProject(db, A, pid);
    pDoc = await store.saveProject(db, A, pid, { ...pDoc, publish: { ...pDoc.publish, keepFiles: true } }, pDoc.updatedAt);
    ok((await media.tidyRender(db, r3, dayLater)) === null, "「게시가 끝나도 파일 남기기」 를 켜면 정리하지 않음");
    pDoc = await store.saveProject(db, A, pid, { ...pDoc, publish: { ...pDoc.publish, keepFiles: false } }, pDoc.updatedAt);
    ok((await media.tidyRender(db, r3, Date.now())) === null, "한쪽(YouTube)에만 올린 파일은 하루 동안 남김");
    const heldBefore = await media.heldBytes(db);
    ok((await media.tidyRender(db, r3, dayLater)) === "published", "하루가 지나면 정리");
    ok((await media.heldBytes(db)).firestore === heldBefore.firestore - 4000, "지운 크기만큼 저장 한도가 돌아옴", `${heldBefore.firestore} → ${(await media.heldBytes(db)).firestore}`);
    // 아무 데도 안 올린 파일 — 7일
    const r6 = await mkRender();
    ok((await media.tidyRender(db, r6, Date.now() + 6 * 86_400_000)) === null, "안 올린 파일은 7일 동안 남김");
    ok((await media.tidyRender(db, r6, Date.now() + 8 * 86_400_000)) === "expired", "7일이 지나면 정리 (expired)");
    // 조각 파일에서 바이트 구간 읽기 (YouTube 나눠 보내기가 쓰는 길)
    const bigBuf = randomBytes(2_000_000);
    const big = await media.saveBytes(db, A, { projectId: pid, kind: "render", name: "big.mp4", type: "video/mp4", duration: 6, width: 720, height: 1280, origin: null, codecs: { video: "avc", audio: "aac" }, overlay: null }, bigBuf);
    const bigDoc = (await db.collection(NEANDER_COL.shortsMedia).doc(big.id).get()).data() as Parameters<typeof media.readBytes>[2];
    ok((await media.readBytes(db, big.id, bigDoc, 1000, 1_700_000)).equals(bigBuf.subarray(1000, 1_700_000)), "조각 경계를 넘는 바이트 구간을 정확히 읽음");
    ok((await media.readBytes(db, big.id, bigDoc, 1_999_000, 9_999_999)).equals(bigBuf.subarray(1_999_000)), "끝을 넘는 구간은 파일 끝까지");
    await rejects(
      media.createMedia(db, A, { projectId: pid, kind: "render", direct: true, name: "big.mp4", type: "video/mp4", size: 61 * 1024 * 1024 }),
      /Firebase Storage 를 켜면 500MB/,
      "버킷이 없으면 완성 파일도 60MB 까지 (켜면 500MB 라고 안내)",
    );
    await rejects(media.createMedia(db, A, { projectId: pid, kind: "render", direct: true, name: "x.webm", type: "video/webm", size: 10 }), /MP4/, "직접 올리는 완성 파일은 MP4 · MOV 만");
    // 직접 올린 완성 파일 — 다 오르면 영상의 완성 파일 목록에 들어감
    const dBuf = randomBytes(1500);
    const dm = await media.createMedia(db, A, { projectId: pid, kind: "render", direct: true, name: "made-elsewhere.mp4", type: "video/mp4", size: dBuf.length, codecs: { video: "avc", audio: "aac" } });
    ok(dm.store === "firestore" && !dm.uploadUrl, "버킷이 없으면 조각으로", dm.store);
    await media.putPart(db, A, dm.id, 0, dBuf);
    const dView = await media.completeMedia(db, A, dm.id);
    ok(dView.direct === true && (await store.getProject(db, A, pid)).renderIds.includes(dm.id), "직접 올린 파일이 영상의 완성 파일이 됨");
    ok(!("uploadSession" in dView) && !("object" in dView), "화면용 파일 정보에 세션 주소 · 객체 경로가 없음");

    // ---- 9. 사람별 채널 세트 · 관리자 몰아보기 ----
    const viewA = await profiles.saveCoupangKeys(db, A, { accessKey: "verify-access-AAAA1234", secretKey: "verify-secret-SSSS9999", afCode: "AF0000001" });
    ok(viewA.coupang.configured && viewA.coupang.keyHint === "…1234" && viewA.coupang.status === "unverified", "내 쿠팡 키 저장 → 끝 4자리 · 확인 전");
    const rawProfile = JSON.stringify((await db.collection(NEANDER_COL.shortsProfiles).doc(A).get()).data());
    ok(!rawProfile.includes("verify-secret-SSSS9999") && !rawProfile.includes("verify-access-AAAA1234"), "Firestore 에는 키가 암호문으로만 있음");
    ok(!JSON.stringify(await profiles.listProfiles(db, A, false)).includes("sealed"), "화면용 채널 세트에 암호문 · 키 없음");
    ok((await profiles.listProfiles(db, B, false)).every((x) => x.owner === B), "일반 사용자는 남의 채널 세트를 못 봄");
    ok((await profiles.listProfiles(db, B, true)).some((x) => x.owner === A && x.coupang.configured), "관리자 몰아보기: 남의 쿠팡 키 「상태」 만 봄");
    ok((await store.listProjects(db, B, true)).some((x) => x.id === pid), "관리자 몰아보기: 남의 비공개 프로젝트가 목록에 보임");
    ok((await store.getProject(db, B, pid, true)).id === pid, "관리자 몰아보기: 남의 비공개 프로젝트를 읽음");
    const curA = await store.getProject(db, A, pid);
    await rejects(store.saveProject(db, B, pid, { ...curA, title: "관리자가 고침" }, curA.updatedAt), /비공개/, "관리자라도 남의 비공개 프로젝트는 고치지 못함");
    ok((await media.readParts(db, B, r2, 0, 1, true)).length > 0, "관리자 몰아보기: 남의 완성 영상을 받아 봄");
    await rejects(profiles.coupangOf(db, B), /쿠팡 파트너스 키를 아직 넣지 않았습니다/, "키 없는 사람의 링크는 만들 수 없음 (회사 키로 대신하지 않음)");
    ok((await profiles.coupangOf(db, A)).creds.secretKey === "verify-secret-SSSS9999", "계정 주인의 키를 서버 안에서만 꺼냄");

    await profiles.saveProfileMeta(db, A, { subIds: [{ id: "verifySub01", label: "쇼츠" }] });
    await rejects(profiles.saveProfileMeta(db, A, { subIds: [{ id: "x!" }] }), /8~20자/, "채널 아이디 형식 확인");
    await accounts.updateAccount(db, A, accId, { coupangSubId: "verifySub01" });
    ok((await accounts.listAccounts(db, A)).find((a) => a.id === accId)?.coupangSubId === "verifySub01", "계정에 내 채널 아이디를 붙임");
    await rejects(accounts.updateAccount(db, A, accId, { coupangSubId: "notMine0001" }), /목록에 등록/, "내 목록에 없는 채널 아이디는 못 붙임");
    await profiles.saveProfileMeta(db, A, { subIds: [] });
    ok((await accounts.listAccounts(db, A)).find((a) => a.id === accId)?.coupangSubId === null, "목록에서 지운 채널 아이디는 계정에서도 빠짐");

    // 다른 사람의 쿠팡 링크로는 내 계정에 게시할 수 없다
    const r4 = await mkRender();
    await store.patchProject(db, pid, A, (pp) => {
      if (pp.coupang.affiliate) pp.coupang.affiliate.coupangOwner = B;
    });
    const prepX = await pubs.preparePublish(db, A, { projectId: pid, accountId: accId, renderId: r4 });
    ok(prepX.blockers.some((b) => b.key === "productMatch" && /님의 쿠팡 파트너스 링크/.test(b.reason)), "링크 주인 ≠ 게시 계정 주인 → 게시 전 점검에서 막힘");
    await store.patchProject(db, pid, A, (pp) => {
      if (pp.coupang.affiliate) pp.coupang.affiliate.coupangOwner = A;
    });

    // 각자의 키로 각자의 리포트 — 같은 상품이라도 B 의 링크가 붙은 프로젝트에는 안 붙는다
    const pidB = await store.createProject(db, B, { product: "B 의 같은 선반", visibility: "private" });
    created.projects.push(pidB);
    await store.patchProject(db, pidB, B, (pp) => {
      pp.coupang.candidates = [{ ...cur.coupang.candidates[0], id: "cb" }];
      pp.coupang.affiliate = { url: "https://link.coupang.com/a/bbb222", candidateId: "cb", subId: "", method: "manual", issuedAt: 1, by: B, coupangOwner: B, accountId: null };
    });
    const seenKeys: string[] = [];
    coupang.setCoupangFetch((async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seenKeys.push(String((init.headers as Record<string, string>).Authorization).match(/access-key=([^,]+)/)?.[1] ?? "");
      const u = new URL(String(input));
      if (u.pathname.endsWith("/reports/orders")) return new Response(JSON.stringify({ rCode: "0", data: [{ date: "20261020", subId: "", productId: 123, quantity: 2, gmv: 25800, commission: 774 }] }));
      if (u.pathname.endsWith("/reports/clicks")) return new Response(JSON.stringify({ rCode: "0", data: [] }));
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
    const rep = await metrics.syncCoupangReports(db, A);
    const snapsA = (await db.collection(NEANDER_COL.shortsMetrics).where("projectId", "==", pid).get()).docs.map((x) => x.data());
    const snapsB = (await db.collection(NEANDER_COL.shortsMetrics).where("projectId", "==", pidB).get()).docs.map((x) => x.data());
    ok(seenKeys.length > 0 && seenKeys.every((k) => k === "verify-access-AAAA1234"), "리포트는 A 의 키로만 부름", `${seenKeys.length}회`);
    ok(rep.projects === 1 && snapsA.some((x) => x.source === "coupang_api" && x.values.orders === 6 && x.values.revenue === 2322), "A 의 링크가 붙은 프로젝트에만 주문 · 수익 (90일 = 30일 × 3)", JSON.stringify(snapsA.map((x) => x.values)));
    ok(snapsB.length === 0, "같은 상품이어도 B 의 프로젝트에는 A 의 실적이 안 붙음");
    coupang.setCoupangFetch((async () => new Response(JSON.stringify({ rCode: "429" }), { status: 429 })) as typeof fetch);
    await rejects(metrics.syncCoupangReports(db, A), /24시간/, "쿠팡 429 → 하루 차단 안내");
    await rejects(profiles.coupangOf(db, A), /까지 막았습니다/, "막힌 키는 풀릴 때까지 부르지 않음");
    coupang.setCoupangFetch(null);
    platforms.setPlatformFetch((async (input: RequestInfo | URL) => {
      throw new Error(`검증 중 모의 응답이 없는 외부 호출: ${String(input).split("?")[0]}`);
    }) as typeof fetch);

    // ---- 10. 고객사(브랜드 대행) — 담당자 권한 ----
    await rejects(clients.saveClient(db, A, null, { name: "검증 고객사", members: [B] }), /등록된 팀원이 아닙니다/, "고객사 담당자는 등록된 팀원만");
    const cid = await clients.saveClient(db, A, null, {
      name: "검증 고객사",
      contract: { monthlyFeeKrw: 1_500_000, videosPerMonth: 8, revisionLimit: 1 },
      brief: { summary: "검증용 브리프", banned: ["최저가"] },
      products: [{ name: "검증 크림", facts: ["용량 50ml"] }],
    });
    created.clients.push(cid);
    const cid2 = await clients.saveClient(db, A, null, { name: "검증 다른 고객사" });
    created.clients.push(cid2);
    const cDoc = await clients.getClient(db, A, cid);
    ok(cDoc.members.join() === A && (await clients.listClients(db, A)).some((c) => c.id === cid && c.canEdit), "만든 사람은 담당자 · 고칠 수 있음");
    ok(!(await clients.listClients(db, B)).some((c) => c.id === cid), "담당자가 아닌 B 의 고객사 목록에 없음");
    await rejects(clients.getClient(db, B, cid), /담당자가 아닙니다/, "담당자가 아닌 B 는 고객사를 열 수 없음");
    ok((await clients.listClients(db, B, true)).some((c) => c.id === cid && !c.canEdit), "관리자 몰아보기: 고객사가 보이되 읽기 전용");
    await rejects(clients.saveClient(db, B, cid, { name: "관리자가 고침" }), /담당자만/, "관리자라도 담당자가 아니면 고객사를 못 고침");
    ok(!JSON.stringify(cDoc).match(/views|조회수/), "계약에 조회수 약속 칸이 없음");

    // 고객사 자료 (제품 실사진) — 담당자만
    const photoBytes = randomBytes(900);
    const photo = await media.saveBytes(db, A, { projectId: "", clientId: cid, kind: "image", name: "크림.jpg", type: "image/jpeg", duration: null, width: 10, height: 10, origin: null, codecs: null, overlay: null }, photoBytes);
    ok((await media.listClientMedia(db, cid, A)).some((m) => m.id === photo.id), "고객사 자료 목록에 제품 사진");
    await rejects(media.listClientMedia(db, cid, B), /담당자/, "담당자가 아닌 B 는 고객사 자료 목록을 못 봄");
    await rejects(media.readParts(db, B, photo.id, 0, 1), /담당자/, "담당자가 아닌 B 는 제품 사진을 못 받음");
    ok((await media.readParts(db, B, photo.id, 0, 1, true)).equals(photoBytes), "관리자 몰아보기: 제품 사진을 받아 봄");

    // 고객사 영상 한 편 — 담당자 사본이 영상에 붙는다
    const bp = await clients.createClientProject(db, A, { clientId: cid, month: "2026-11", productId: cDoc.products[0].id, brandTarget: "client" });
    created.projects.push(bp);
    let bpDoc = await store.getProject(db, A, bp);
    ok(bpDoc.kind === "brand" && bpDoc.clientName === "검증 고객사" && bpDoc.facts.join() === "용량 50ml" && bpDoc.members.join() === A, "고객사 영상: 제품 사실 · 담당자 사본이 붙음", bpDoc.title);
    await rejects(store.getProject(db, B, bp), /비공개/, "담당자가 아닌 B 는 고객사 영상을 못 엶");
    await rejects(clients.createClientProject(db, B, { clientId: cid }), /담당자만/, "담당자가 아닌 B 는 고객사 영상을 못 만듦");

    // 고객사 소유 게시 계정 (담당자 사본 clientMembers)
    const clientAccId = accounts.accountId("youtube", "UCclientverify", A);
    await db.collection(NEANDER_COL.shortsAccounts).doc(clientAccId).set({ ...acc, externalId: "UCclientverify", externalName: "검증 고객사 채널", sealed: secret.sealTokens({ refreshToken: "r" }, clientAccId), coupangChannel: null, coupangSubId: null, clientId: cid, clientMembers: [A] });
    const otherAccId = accounts.accountId("youtube", "UCotherverify", A);
    await db.collection(NEANDER_COL.shortsAccounts).doc(otherAccId).set({ ...acc, externalId: "UCotherverify", externalName: "다른 고객사 채널", sealed: secret.sealTokens({ refreshToken: "r" }, otherAccId), coupangChannel: null, coupangSubId: null, clientId: cid2, clientMembers: [A] });
    await rejects(accounts.getAccountForPublish(db, B, clientAccId), /권한이 없습니다/, "담당자가 되기 전 B 는 고객사 계정을 못 씀");

    // B 를 담당자로 (B 는 검증용 주소라 팀원 명단에 없다 — 문서를 직접 고치고 사본 동기화만 본다)
    await db.collection(NEANDER_COL.shortsClients).doc(cid).update({ members: [A, B] });
    await clients.syncClientCopies(db, cid, { members: [A, B], name: "검증 고객사" });
    ok((await store.getProject(db, B, bp)).id === bp, "담당자가 된 B 는 고객사 영상을 엶");
    bpDoc = await store.getProject(db, A, bp);
    bpDoc = await store.saveProject(db, B, bp, { ...bpDoc, notes: "B 가 고침" }, bpDoc.updatedAt);
    ok(bpDoc.notes === "B 가 고침", "담당자 B 는 고객사 영상을 고침");
    ok((await accounts.getAccountForPublish(db, B, clientAccId)).id === clientAccId, "담당자가 된 B 는 고객사 계정으로 게시할 수 있음 (사본 동기화)");
    await rejects(store.deleteProject(db, B, bp), /소유자만/, "고객사 영상 지우기는 만든 사람만");

    // ---- 11. 고객 검토 링크 ----
    const mkBrandRender = async () => {
      const r = await media.saveBytes(db, A, { projectId: bp, kind: "render", name: "brand.mp4", type: "video/mp4", duration: 6, width: 720, height: 1280, origin: null, codecs: { video: "avc", audio: "aac" }, overlay: { disclosure: true, text: brandDisclosureLine("검증 고객사") } }, randomBytes(3000));
      await store.patchProject(db, bp, A, (pp) => void pp.renderIds.push(r.id));
      return r.id;
    };
    const br1 = await mkBrandRender();
    const br2 = await mkBrandRender();
    await rejects(reviews.sendForReview(db, A, pid, r1, "https://erp.test"), /고객사 영상만/, "쿠팡 영상은 고객 검토를 보내지 않음");
    await rejects(reviews.sendForReview(db, A, bp, r1, "https://erp.test"), /완성 파일을 골라/, "다른 영상의 파일로는 검토를 못 보냄");
    const s1 = await reviews.sendForReview(db, A, bp, br1, "https://erp.test");
    const t1 = s1.url.split("/").pop()!;
    ok(s1.url.startsWith("https://erp.test/neander/review/") && s1.round === 1, "검토 링크 1차", s1.url.replace(t1, "<토큰>"));
    const linkDocs = await db.collection(NEANDER_COL.shortsReviewLinks).where("projectId", "==", bp).get();
    ok(!(await db.collection(NEANDER_COL.shortsReviewLinks).doc(t1).get()).exists && linkDocs.docs.some((d) => d.id === createHash("sha256").update(t1).digest("hex")), "토큰 자체는 저장하지 않음 (문서 id = sha256)");
    ok(!linkDocs.docs.some((d) => JSON.stringify(d.data()).includes(t1)), "링크 문서 안에도 토큰이 없음");
    const info1 = await reviews.reviewInfo(db, t1);
    ok(info1.clientName === "검증 고객사" && info1.latest && info1.decision === "pending" && info1.revisionLimit === 1, "링크로 여는 정보 = 그 영상 한 편 · 대기 중");
    ok(!JSON.stringify(info1).includes(A) && !JSON.stringify(info1).includes("검증용 브리프"), "링크 정보에 담당자 주소 · 브리프가 없음");
    const brBytes = await media.readParts(db, A, br1, 0, 10);
    ok((await reviews.reviewMediaParts(db, t1, 0, 10)).equals(brBytes), "링크로 받는 영상 = 그 회차 파일");
    await rejects(reviews.reviewInfo(db, randomBytes(27).toString("base64url")), /찾지 못했습니다/, "모르는 토큰은 404");
    await rejects(reviews.reviewInfo(db, "../../etc"), /올바르지 않습니다/, "형식이 틀린 토큰은 거절");
    await rejects(reviews.decideByLink(db, t1, { decision: "revision", feedback: "", name: "김검토" }), /어떻게 고치면/, "수정 요청은 내용이 있어야 함");
    await rejects(reviews.decideByLink(db, t1, { decision: "approved", name: " " }), /이름/, "검토한 사람 이름이 있어야 함");
    const after1 = await reviews.decideByLink(db, t1, { decision: "revision", feedback: "로고를 크게", name: "김검토" });
    ok(after1.decision === "revision" && after1.revisionsUsed === 1, "고객이 링크에서 수정 요청 (1/1)");
    await rejects(reviews.decideByLink(db, t1, { decision: "approved", name: "김검토" }), /이미 답을/, "같은 회차에 두 번 답할 수 없음");

    const s2 = await reviews.sendForReview(db, A, bp, br2, "https://erp.test");
    const s3 = await reviews.sendForReview(db, A, bp, br2, "https://erp.test");
    const t2 = s2.url.split("/").pop()!;
    const t3 = s3.url.split("/").pop()!;
    await rejects(reviews.decideByLink(db, t2, { decision: "approved", name: "김검토" }), /새 검토 파일/, "새 회차가 나가면 앞 링크로는 답할 수 없음 (거둬들임)");
    ok(!(await reviews.reviewInfo(db, t1)).latest, "지난 링크는 「최신 아님」 으로 보임");
    const after3 = await reviews.decideByLink(db, t3, { decision: "revision", feedback: "자막 오타", name: "김검토" });
    bpDoc = await store.getProject(db, A, bp);
    const r3round = bpDoc.review.rounds.find((r) => r.n === s3.round)!;
    ok(after3.revisionsUsed === 2 && r3round.extra && bpDoc.review.rounds.find((r) => r.n === s2.round)?.decision === "withdrawn", "상한을 넘은 수정 요청도 기록하되 「계약 범위 밖」 표시", `${after3.revisionsUsed}회 · extra ${r3round.extra}`);
    await db.collection(NEANDER_COL.shortsReviewLinks).doc(createHash("sha256").update(t3).digest("hex")).update({ expiresAt: Date.now() - 1000 });
    await rejects(reviews.reviewInfo(db, t3), /만료/, "만료된 링크는 열리지 않음");

    // ---- 12. 승인한 파일만 게시 ----
    bpDoc = await store.getProject(db, A, bp);
    bpDoc = await store.saveProject(db, A, bp, { ...bpDoc, publish: { ...bpDoc.publish, title: "검증 크림 최저가", synthetic: true } }, bpDoc.updatedAt);
    let bprep = await pubs.preparePublish(db, A, { projectId: bp, accountId: clientAccId, renderId: br1 });
    ok(bprep.blockers.some((b) => b.key === "clientApproval"), "승인 전에는 고객사 승인이 게시를 막음");
    await reviews.sendForReview(db, A, bp, br1, "https://erp.test");
    await reviews.recordByStaff(db, B, bp, { decision: "approved", decidedBy: "김검토 (카톡)" });
    bpDoc = await store.getProject(db, A, bp);
    const lastRound = bpDoc.review.rounds[bpDoc.review.rounds.length - 1];
    ok(bpDoc.review.state === "approved" && lastRound.decidedVia === "staff" && lastRound.decidedBy?.includes(`기록: ${B}`), "담당자가 대신 기록한 승인 (누가 기록했는지 남음)", lastRound.decidedBy ?? "");
    await rejects(reviews.sendForReview(db, A, bp, br2, "https://erp.test"), /이미 승인된/, "승인된 영상은 「승인 취소」 없이 다시 보내지 않음");
    bprep = await pubs.preparePublish(db, A, { projectId: bp, accountId: clientAccId, renderId: br2 });
    ok(bprep.blockers.some((b) => b.key === "clientApproval" && /승인한 그 파일만/.test(b.reason)), "승인하지 않은 다른 파일은 게시가 막힘");
    bprep = await pubs.preparePublish(db, A, { projectId: bp, accountId: clientAccId, renderId: br1 });
    ok(!bprep.blockers.some((b) => b.key === "clientApproval"), "승인한 파일은 고객 승인 통과");
    ok(!("disclosure" in bprep.checks) && !("productMatch" in bprep.checks) && !bprep.caption.startsWith(DISCLOSURE) && !bprep.caption.startsWith("광고"), "고객사 자기 계정: 쿠팡 항목 · 광고 고지 없음");
    ok(bprep.checks.claims?.system?.ok === false && /최저가.*금지 표현/.test(bprep.checks.claims.system.detail), "고객사 금지 표현을 찾음", bprep.checks.claims?.system?.detail);
    const ourPrep = await pubs.preparePublish(db, A, { projectId: bp, accountId: accId, renderId: br1 });
    ok(ourPrep.caption.startsWith(brandDisclosureLine("검증 고객사")) && ourPrep.checks.disclosure?.system?.ok === true && ourPrep.checks.videoDisclosure?.system?.ok === true, "우리 채널: 첫 줄 「광고 · 고객사 유료 광고」 + 영상 안 고지 띠", ourPrep.caption.split("\n")[0]);
    ok(!ourPrep.caption.includes(DISCLOSURE), "브랜드 영상에는 쿠팡 파트너스 문구가 붙지 않음");
    const otherPrep = await pubs.preparePublish(db, A, { projectId: bp, accountId: otherAccId, renderId: br1 });
    ok(otherPrep.problems.some((x) => /다른 고객사의 계정/.test(x)), "다른 고객사의 계정에는 게시 못 함");
    const coupangOnClient = await pubs.preparePublish(db, A, { projectId: pid, accountId: clientAccId, renderId: r2 });
    ok(coupangOnClient.problems.some((x) => /쿠팡 제휴 영상을 올리지 않습니다/.test(x)), "고객사 계정에는 쿠팡 제휴 영상을 못 올림");

    bpDoc = await store.getProject(db, A, bp);
    await store.saveProject(db, A, bp, { ...bpDoc, publish: { ...bpDoc.publish, title: "검증 크림" }, compliance: { ...bpDoc.compliance, claims: { system: null, user: { ok: true } } } }, bpDoc.updatedAt);
    const bpub = await pubs.createPublication(db, A, { projectId: bp, accountId: clientAccId, renderId: br1, scheduledAt: Date.now() + 30 * 60_000 });
    ok(true, "승인 · 확인을 마친 고객사 영상은 예약 게시가 잡힘");
    await rejects(reviews.reopenReview(db, A, bp), /게시했거나 게시 중/, "예약 · 게시된 영상은 승인을 되돌릴 수 없음");
    await pubs.cancelPublication(db, A, bpub.publicationId);
    await reviews.reopenReview(db, A, bp);
    bprep = await pubs.preparePublish(db, A, { projectId: bp, accountId: clientAccId, renderId: br1 });
    ok(bprep.blockers.some((b) => b.key === "clientApproval"), "「승인 취소」 뒤에는 다시 게시가 막힘 (기록은 남음)");
    await rejects(clients.deleteClient(db, A, cid), /영상이 있어/, "영상이 남은 고객사는 지울 수 없음");

    await store.deleteProject(db, A, bp);
    ok((await db.collection(NEANDER_COL.shortsReviewLinks).where("projectId", "==", bp).get()).empty, "영상을 지우면 검토 링크도 지워짐");
    await rejects(reviews.reviewInfo(db, t1), /찾지 못했습니다/, "지운 영상의 링크는 열리지 않음");
    await db.collection(NEANDER_COL.shortsAccounts).doc(clientAccId).delete();
    await db.collection(NEANDER_COL.shortsAccounts).doc(otherAccId).delete();
    await clients.deleteClient(db, A, cid);
    ok(!(await db.collection(NEANDER_COL.shortsClients).doc(cid).get()).exists && (await db.collection(NEANDER_COL.shortsMedia).where("clientId", "==", cid).get()).empty, "고객사 지우기: 자료(제품 사진)도 함께");
    // ---- 13. 일반 영상 (제휴 없음) ----
    const gp = await store.createProject(db, A, { product: "검증 정리", kind: "general", visibility: "private" });
    created.projects.push(gp);
    let gDoc = await store.getProject(db, A, gp);
    ok(gDoc.kind === "general", "일반 영상(제휴 없음) 만들기");
    const gr = await media.saveBytes(db, A, { projectId: gp, kind: "render", name: "g.mp4", type: "video/mp4", duration: 6, width: 720, height: 1280, origin: null, codecs: { video: "avc", audio: "aac" }, overlay: null }, randomBytes(2000));
    await store.patchProject(db, gp, A, (pp) => void pp.renderIds.push(gr.id));
    gDoc = await store.getProject(db, A, gp);
    gDoc = await store.saveProject(db, A, gp, { ...gDoc, publish: { ...gDoc.publish, title: "검증 일반 영상", description: "정리 순서 세 가지", synthetic: false } }, gDoc.updatedAt);
    let gprep = await pubs.preparePublish(db, A, { projectId: gp, accountId: accId, renderId: gr.id });
    ok(!gprep.caption.includes(DISCLOSURE) && gprep.caption.startsWith("정리 순서"), "일반 영상: 게시 문구에 쿠팡 고지 · 링크 없음", gprep.caption.split("\n")[0]);
    ok(Object.keys(gprep.checks).sort().join() === "claims,noPaidRelation,sourceRights", "일반 영상: 쿠팡 확인 항목(채널 등록 · 상품 일치 · DM) 없음", Object.keys(gprep.checks).join());
    ok(gprep.blockers.map((b) => b.key).sort().join() === "claims,noPaidRelation" && gprep.problems.length === 0, "사람 확인 전에는 「대가 없음」 · 표현 확인만 남음", gprep.blockers.map((b) => b.key).join() + " / " + gprep.problems.join(" "));
    gDoc = await store.getProject(db, A, gp);
    gDoc = await store.saveProject(db, A, gp, { ...gDoc, compliance: { ...gDoc.compliance, noPaidRelation: { system: null, user: { ok: true } }, claims: { system: null, user: { ok: true } } } }, gDoc.updatedAt);
    gprep = await pubs.preparePublish(db, A, { projectId: gp, accountId: accId, renderId: gr.id });
    ok(gprep.blockers.length === 0, "사람이 확인하면 쿠팡 승인 없이 게시할 수 있음", gprep.blockers.map((b) => b.key).join());
    gDoc = await store.getProject(db, A, gp);
    gDoc = await store.saveProject(db, A, gp, { ...gDoc, publish: { ...gDoc.publish, description: "제품은 https://link.coupang.com/a/zzz" } }, gDoc.updatedAt);
    gprep = await pubs.preparePublish(db, A, { projectId: gp, accountId: accId, renderId: gr.id });
    ok(gprep.checks.noPaidRelation?.system?.ok === false && gprep.blockers.some((b) => b.key === "noPaidRelation"), "일반 영상에 쿠팡 제휴 링크가 있으면 사람 확인이 있어도 막힘", gprep.checks.noPaidRelation?.system?.detail);
    const gClientAcc = accounts.accountId("youtube", "UCgeneralclient", A);
    await db.collection(NEANDER_COL.shortsAccounts).doc(gClientAcc).set({ ...acc, externalId: "UCgeneralclient", externalName: "검증 고객사 계정", sealed: secret.sealTokens({ refreshToken: "r" }, gClientAcc), coupangChannel: null, coupangSubId: null, clientId: "verifyGoneClient", clientMembers: [A] });
    gprep = await pubs.preparePublish(db, A, { projectId: gp, accountId: gClientAcc, renderId: gr.id });
    ok(gprep.problems.some((x) => /일반 영상을 올리지 않습니다/.test(x)), "고객사 소유 계정에는 일반 영상을 못 올림");
    await db.collection(NEANDER_COL.shortsAccounts).doc(gClientAcc).delete();
    gDoc = await store.getProject(db, A, gp);
    await rejects(store.saveProject(db, A, gp, { ...gDoc, kind: "brand" }, gDoc.updatedAt), /고객사 화면/, "일반 → 고객사 영상으로 바꾸기는 거절");
    gDoc = await store.saveProject(db, A, gp, { ...gDoc, kind: "coupang" }, gDoc.updatedAt);
    ok(gDoc.kind === "coupang", "일반 ↔ 쿠팡은 바꿀 수 있음");
    const bp2 = await store.createProject(db, A, { product: "검증 브랜드 흉내" });
    created.projects.push(bp2);
    await store.patchProject(db, bp2, A, (pp) => void (pp.kind = "brand"));
    const bp2Doc = await store.getProject(db, A, bp2);
    await rejects(store.saveProject(db, A, bp2, { ...bp2Doc, kind: "general" }, bp2Doc.updatedAt), /종류를 바꿀 수 없습니다/, "고객사 영상은 종류를 바꿀 수 없음");

    // ---- 14. AI 레이더 (YouTube · AI · 네이버 모두 모의 — 실제 오늘 한도 · 비용 계수기는 건드리지 않음) ----
    process.env.NEANDER_SHORTS_NAVER_CLIENT_ID ||= "verify-naver";
    process.env.NEANDER_SHORTS_NAVER_CLIENT_SECRET ||= "verify-naver";
    const CH_A = "UCvrfyRadarChannelAAAA01";
    const CH_B = "UCvrfyRadarChannelBBBB01";
    const nowR = Date.now();
    const ago = (days: number) => new Date(nowR - days * 86_400_000).toISOString();
    let bump = 0;
    const vids: Record<string, { ch: string; title: string; views: number; days: number; dur: string; comments: number; tags?: string[] }> = {
      vrfyRadar01: { ch: CH_A, title: "자석 양치컵 이거 물건이네", views: 300_000, days: 2, dur: "PT45S", comments: 40, tags: ["양치컵"] },
      vrfyRadar02: { ch: CH_B, title: "욕실 자석 컵 정리", views: 50_000, days: 3, dur: "PT30S", comments: 10 },
      vrfyRadar03: { ch: CH_A, title: "긴 영상 살림 브이로그", views: 80_000, days: 1, dur: "PT10M", comments: 5 },
      vrfyRadar04: { ch: CH_B, title: "조회 적은 살림템", views: 5_000, days: 1, dur: "PT20S", comments: 3 },
      vrfyRadar05: { ch: CH_B, title: "오늘 저녁 먹방", views: 20_000, days: 2, dur: "PT20S", comments: 0 },
      vrfyRadar06: { ch: CH_A, title: "새로 나온 다이소 수납함", views: 40_000, days: 1, dur: "PT25S", comments: 0 },
    };
    for (let n = 1; n <= 6; n++) {
      vids[`vrfyBaseA0${n}`] = { ch: CH_A, title: "평소 영상", views: 10_000, days: 10 + n, dur: "PT30S", comments: 1 };
      vids[`vrfyBaseB0${n}`] = { ch: CH_B, title: "평소 영상", views: 5_000, days: 10 + n, dur: "PT30S", comments: 1 };
    }
    let searchIds = ["vrfyRadar01", "vrfyRadar02", "vrfyRadar03", "vrfyRadar04", "vrfyRadar05"];
    const radarCalls: string[] = [];
    setYoutubeDataFetch((async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      radarCalls.push(u.pathname.split("/").pop()!);
      if (u.pathname.endsWith("/search")) return new Response(JSON.stringify({ items: searchIds.map((videoId) => ({ id: { videoId } })) }));
      if (u.pathname.endsWith("/videos")) {
        const ids = (u.searchParams.get("id") ?? "").split(",");
        return new Response(
          JSON.stringify({
            items: ids.filter((id) => vids[id]).map((id) => {
              const v = vids[id];
              return {
                id,
                snippet: { title: v.title, channelTitle: v.ch === CH_A ? "검증 채널 A" : "검증 채널 B", channelId: v.ch, publishedAt: ago(v.days), description: `${v.title} 설명`, tags: v.tags ?? [] },
                statistics: { viewCount: String(v.views + (id === "vrfyRadar01" ? bump : 0)), likeCount: "100", commentCount: String(v.comments) },
                contentDetails: { duration: v.dur },
              };
            }),
          }),
        );
      }
      if (u.pathname.endsWith("/playlistItems")) {
        const ch = `UC${(u.searchParams.get("playlistId") ?? "").slice(2)}`;
        return new Response(JSON.stringify({ items: Object.entries(vids).filter(([, v]) => v.ch === ch).map(([id, v]) => ({ contentDetails: { videoId: id, videoPublishedAt: ago(v.days) } })) }));
      }
      if (u.pathname.endsWith("/commentThreads")) {
        const texts = u.searchParams.get("videoId") === "vrfyRadar01" ? ["어디서 사요?", "링크 주세요", "좋네요", "와"] : ["좋아요"];
        return new Response(JSON.stringify({ items: texts.map((textDisplay) => ({ snippet: { topLevelComment: { snippet: { textDisplay } } } })) }));
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
    let aiSeen: string[] = [];
    setAiFetch((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      const list = JSON.parse(body.messages[1].content) as { videoId: string; title: string }[];
      aiSeen = [...aiSeen, ...list.map((v) => v.videoId)];
      const items = list.map((v) => {
        const food = v.title.includes("먹방");
        return {
          videoId: v.videoId,
          relevant: !food,
          product: food ? "" : v.title.includes("수납함") ? "다이소 수납함" : "자석 양치컵",
          productKey: food ? "" : v.title.includes("수납함") ? "수납함" : "자석 양치컵",
          category: food ? "기타" : "살림",
          confidence: "likely",
          evidence: "제목",
          why: "문제 → 해결",
          hook: "",
          naverKeywords: food ? [] : ["자석 양치컵"],
          coupangQuery: "자석 양치컵",
          caution: "",
        };
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { cost: 0.001 } }));
    }) as typeof fetch);
    const naverBodies: string[] = [];
    setNaverFetch((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      naverBodies.push(String(init.body));
      const data = [10, 10, 10, 10, 10, 10, 30, 40].map((ratio, i) => ({ period: `2026-01-0${i + 1}`, ratio }));
      return new Response(JSON.stringify({ results: [{ data }] }));
    }) as typeof fetch);
    const rset = { ...DEFAULT_RADAR_SETTINGS, keywords: ["검증살림"], maxSearchesPerRun: 1 };
    const ropt = { by: A, key: "verify-key", day: "verify", quotaPrefix: "verify_" };
    const rs1 = await radarRun.runRadar(db, { ...ropt, deadline: Date.now() + 90_000, settings: rset, now: nowR });
    const rid = (v: string) => `yt_${v}`;
    const rget = async (v: string) => (await db.collection(NEANDER_COL.shortsRadar).doc(rid(v)).get()).data() as import("@/lib/neander/shorts/radar").RadarDoc | undefined;
    const rd1 = await rget("vrfyRadar01");
    ok(rs1.searched === 1 && rs1.found === 3 && rs1.created === 3, "레이더: 검색 1회 → 쇼츠 길이 · 최소 조회로 거른 3편", JSON.stringify({ searched: rs1.searched, found: rs1.found, created: rs1.created }));
    ok(!(await rget("vrfyRadar03")) && !(await rget("vrfyRadar04")), "긴 영상 · 조회 적은 영상은 후보가 아님");
    ok(rd1?.baseline === 10_000 && rd1.multiple === 30, "채널 평소(7일 넘은 쇼츠 중앙값) 대비 배수", `평소 ${rd1?.baseline} · ${rd1?.multiple}배`);
    ok(rd1?.velocityBasis === "since_publish" && (rd1.velocityPerDay ?? 0) > 100_000, "처음 본 영상은 올린 뒤 평균 속도", String(rd1?.velocityPerDay));
    ok(rd1?.info?.sampled === 4 && rd1.info.matched === 2, "댓글 표본에서 정보 요청 2/4");
    ok((rd1?.score ?? 0) > 50, "점수 계산", String(rd1?.score));
    ok(rd1?.ai?.product === "자석 양치컵" && rd1.ai.relevant && (await rget("vrfyRadar02"))?.ai?.productKey === "자석 양치컵", "AI 상품 추정 · 같은 상품 열쇠");
    ok((await rget("vrfyRadar05"))?.ai?.relevant === false, "먹방은 AI 가 무관으로 표시");
    ok(rd1?.naver?.label === "rising" && naverBodies.length === 1, "네이버 추세: 같은 상품 묶음은 한 번만 불러 「상승」", `${rd1?.naver?.label} · 호출 ${naverBodies.length}회`);
    ok(rs1.aiCalls === 1 && Math.abs(rs1.aiUsd - 0.001) < 1e-9, "AI 1회 · 비용 기록", `${rs1.aiCalls}회 $${rs1.aiUsd}`);
    ok((await store.readQuota(db, "verify_ytsearch_verify")) === 1, "검색 계수기(소재 발굴과 같은 이름 · 검증용 접두사)");
    ok(!radarCalls.includes("commentThreads") || radarCalls.filter((c) => c === "commentThreads").length <= 20, "댓글 표본은 상한 안에서만");

    // 두 번째 실행: 하루 뒤 · 조회수 증가 · 새 영상 하나 · AI 상한을 1원으로
    bump = 100_000;
    searchIds = ["vrfyRadar01", "vrfyRadar06"];
    aiSeen = [];
    const rs2 = await radarRun.runRadar(db, { ...ropt, deadline: Date.now() + 90_000, settings: { ...rset, aiBudgetKrw: 1 }, now: nowR + 86_400_000 });
    const rd1b = await rget("vrfyRadar01");
    ok(rd1b?.velocityBasis === "history" && rd1b.velocityPerDay === 100_000 && rd1b.viewHistory.length === 2, "다시 본 영상은 실제 증가로 속도 (하루 +10만)", `${rd1b?.velocityBasis} ${rd1b?.velocityPerDay}`);
    ok(rd1b?.ai?.product === "자석 양치컵" && !aiSeen.includes("vrfyRadar01"), "이미 추정한 영상은 AI 를 다시 부르지 않음");
    ok((await rget("vrfyRadar06"))?.ai === null && rs2.notes.some((n) => /비용 상한/.test(n)), "하루 AI 비용 상한에 닿으면 내일로 미룸", rs2.notes.join(" | "));
    ok(rd1b?.firstSeenAt === rd1?.firstSeenAt, "처음 본 날은 그대로");

    // 사람의 손: 소재로 저장 · 제외
    const tA = await radarRun.saveRadarAsTrend(db, A, rid("vrfyRadar01"), "private");
    const trA = await store.getTrend(db, A, tA);
    ok(trA.product === "자석 양치컵" && trA.identification.status === "likely" && trA.metrics.views.src === "api" && trA.infoSample.sampled === 4 && trA.tags.includes("AI 레이더"), "소재로 저장 — 상품(추정) · API 숫자 · 댓글 표본이 옮겨짐");
    ok(/영상을 보지 않고/.test(trA.identification.evidence) && /단정하지 않음/.test(trA.notes), "저장한 소재에 「AI 추정 · 글 기준」 · 「네이버는 단정 아님」 이 남음");
    ok((await radarRun.saveRadarAsTrend(db, A, rid("vrfyRadar01"), "private")) === tA, "같은 사람이 다시 저장하면 같은 소재");
    const tB = await radarRun.saveRadarAsTrend(db, B, rid("vrfyRadar01"), "private");
    ok(tB !== tA && (await store.getTrend(db, B, tB)).owner === B, "다른 사람은 자기 소재로 따로 저장");
    await rejects(store.getTrend(db, B, tA), /비공개/, "A 의 소재는 B 에게 비공개 그대로");
    await radarRun.setRadarDismissed(db, B, rid("vrfyRadar05"), true);
    ok((await rget("vrfyRadar05"))?.dismissed?.by === B, "제외 — 누가 뺐는지 남음");
    await radarRun.setRadarDismissed(db, B, rid("vrfyRadar05"), false);
    ok((await rget("vrfyRadar05"))?.dismissed === null, "되살리기");
    await rejects(radarRun.saveRadarAsTrend(db, A, "yt_../../x", "private"), /올바르지 않습니다/, "이상한 id 는 거절");

    // 사람 표시 — 메모 · 직접 촬영 → 메모 반영해 다시 분석 (검증용 계수기 · 다음 실행이 덮지 않는지)
    const n1 = await radarRun.setRadarNote(db, A, rid("vrfyRadar02"), "  다이소 실리콘 물막이 — 모음 영상 아님  ");
    ok(n1.length === 1 && n1[0].by === A && n1[0].text === "다이소 실리콘 물막이 — 모음 영상 아님", "메모 저장 — 앞뒤 공백 정리 · 쓴 사람");
    await radarRun.setRadarNote(db, B, rid("vrfyRadar02"), "훅은 물 튀는 장면");
    const fm = await radarRun.setRadarFilmed(db, B, rid("vrfyRadar02"), "self");
    ok(fm?.value === "self" && fm.by === B, "직접 촬영 표시 — 마지막에 고른 사람");
    await rejects(radarRun.setRadarFilmed(db, B, rid("vrfyRadar02"), "maybe"), /self · not_self/, "이상한 촬영 표시는 거절");
    const rd2a = await rget("vrfyRadar02");
    ok(rd2a?.notes?.length === 2 && radarNoteState(rd2a) === "stale", "두 사람 메모 · 분석은 메모 전 것 → 「반영 전」");
    // 다음 아침 실행이 같은 영상을 다시 봐도 사람 표시는 남는다
    searchIds = ["vrfyRadar02"];
    await radarRun.runRadar(db, { ...ropt, deadline: Date.now() + 90_000, settings: rset, now: nowR + 2 * 86_400_000 });
    const rd2r = await rget("vrfyRadar02");
    ok(rd2r?.notes?.length === 2 && rd2r.filmed?.value === "self" && (rd2r.viewHistory.length ?? 0) >= 2, "레이더 실행이 다시 써도 메모 · 촬영 표시는 그대로", `메모 ${rd2r?.notes?.length} · ${rd2r?.filmed?.value}`);
    let aiReq = "";
    setAiFetch((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      aiReq = String(init.body);
      const list = JSON.parse(JSON.parse(aiReq).messages[1].content) as { videoId: string }[];
      const items = list.map((v) => ({ videoId: v.videoId, relevant: true, product: "실리콘 물막이", productKey: "실리콘 물막이", category: "주방", confidence: "likely", evidence: "사람 메모", why: "실사용 장면", hook: "", naverKeywords: ["실리콘 물막이"], coupangQuery: "실리콘 물막이", caution: "" }));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { cost: 0.002 } }));
    }) as typeof fetch);
    const spent0 = await radarRun.readRadarSpendUsd(db, "verify_radarusd_verify");
    const realKey = `radarusd_${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`;
    const real0 = await radarRun.readRadarSpendUsd(db, realKey);
    const nv0 = naverBodies.length;
    const reopt = { quotaPrefix: "verify_", day: "verify", key: "verify-key", settings: rset };
    await radarRun.reanalyzeRadar(db, A, rid("vrfyRadar02"), reopt);
    const sent = JSON.parse(JSON.parse(aiReq).messages[1].content)[0];
    ok(sent.notes?.length === 2 && sent.notes.includes("훅은 물 튀는 장면") && sent.filmed === "직접 촬영", "다시 분석 — 두 사람 메모 · 촬영 표시가 AI 에 들어감");
    const rd2b = await rget("vrfyRadar02");
    ok(rd2b?.ai?.product === "실리콘 물막이" && rd2b.ai.notes === 2 && rd2b.ai.filmed === "self" && rd2b.ai.by === A && radarNoteState(rd2b) === "applied", "결과 저장 · 「사람 표시 반영」", JSON.stringify({ p: rd2b?.ai?.product, n: rd2b?.ai?.notes, f: rd2b?.ai?.filmed }));
    ok(rd2b?.naver?.keywords[0] === "실리콘 물막이" && naverBodies.length === nv0 + 1, "상품 검색어가 바뀌어 네이버 추세를 그 자리에서 다시 봄");
    ok(Math.abs((await radarRun.readRadarSpendUsd(db, "verify_radarusd_verify")) - spent0 - 0.002) < 1e-9 && (await radarRun.readRadarSpendUsd(db, realKey)) === real0, "비용은 검증용 계수기에만 · 실제 「오늘 AI」 는 그대로");
    await radarRun.setRadarNote(db, A, rid("vrfyRadar02"), "고쳐 씀");
    ok(radarNoteState((await rget("vrfyRadar02"))!) === "stale", "메모를 고치면 다시 「반영 전」");
    await radarRun.setRadarNote(db, A, rid("vrfyRadar02"), "   ");
    await radarRun.setRadarFilmed(db, B, rid("vrfyRadar02"), null);
    const rd2c = await rget("vrfyRadar02");
    ok(rd2c?.notes?.length === 1 && rd2c.notes[0].by === B && rd2c.filmed === null, "빈 글은 내 메모만 지움 · 촬영 표시 지움");
    await rejects(radarRun.reanalyzeRadar(db, A, rid("vrfyRadar02"), { ...reopt, settings: { ...rset, aiBudgetKrw: 0 } }), /상한/, "하루 AI 상한에 닿으면 다시 분석하지 않음");
    const cm = await radarRun.radarComments(db, rid("vrfyRadar01"), { order: "time" });
    ok(cm.items.length === 4 && cm.order === "time" && !cm.disabled, "댓글 원문 — 레이더 후보의 댓글을 읽어 옴", String(cm.items.length));
    await rejects(radarRun.radarComments(db, "yt_vrfyNotHer1", {}), /찾지 못했습니다/, "레이더에 없는 영상의 댓글은 읽지 않음");
    setYoutubeDataFetch(null);
    setAiFetch(null);
    setNaverFetch(null);

    // ---- 15. 바이럴 형식 자동화 (YouTube · AI 모의 · 검증용 채널 · 영상 · 카드만) ----
    const SC = (s: string) => `UC${s.padEnd(22, "0").slice(0, 22)}`;
    const CH = { kr1: SC("vrfyAutoKR1"), kr2: SC("vrfyAutoKR2"), kr3: SC("vrfyAutoKR3"), us1: SC("vrfyAutoUS1"), us2: SC("vrfyAutoUS2"), us3: SC("vrfyAutoUS3") };
    created.watch.push(...Object.values(CH));
    const nowA = Date.now();
    const agoA = (days: number) => new Date(nowA - days * 86_400_000).toISOString();
    // 채널마다 평소 영상 6편 (7일 넘음) + 후보 영상
    const avids: Record<string, { ch: string; views: number; days: number; title: string }> = {
      vrfyAutUS1t: { ch: CH.us1, views: 100_000, days: 3, title: "kitchen gadget wow" },
      vrfyAutUS2t: { ch: CH.us2, views: 200_000, days: 3, title: "big channel normal" },
      vrfyAutUS3t: { ch: CH.us3, views: 5_000, days: 3, title: "small view" },
    };
    const basePer: Record<string, number> = { [CH.us1]: 10_000, [CH.us2]: 150_000, [CH.us3]: 1_000 };
    for (const [ch, v] of Object.entries(basePer)) for (let n = 1; n <= 6; n++) avids[`vrfyAB${ch.slice(10, 13)}${n}`.padEnd(11, "x").slice(0, 11)] = { ch, views: v, days: 10 + n, title: "평소" };
    const ytCalls: string[] = [];
    setYoutubeDataFetch((async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      const kind = u.pathname.split("/").pop()!;
      ytCalls.push(kind);
      if (kind === "search") {
        if (u.searchParams.get("regionCode") === "KR") return new Response(JSON.stringify({ items: ["vrfyKorea01", "vrfyKorea02", "vrfyKorea03", "vrfyKorea04"].map((videoId) => ({ id: { videoId }, snippet: { channelId: SC("vrfyKoreaCh") } })) }));
        return new Response(JSON.stringify({ items: ["vrfyAutUS1t", "vrfyAutUS2t", "vrfyAutUS3t"].map((videoId) => ({ id: { videoId }, snippet: { channelId: avids[videoId].ch } })) }));
      }
      if (kind === "videos") {
        const ids = (u.searchParams.get("id") ?? "").split(",");
        return new Response(
          JSON.stringify({
            items: ids.map((id) => {
              const v = avids[id] ?? (id.startsWith("vrfyKorea") ? { ch: SC("vrfyKoreaCh"), views: 30_000, days: 20, title: `국내 ${id}` } : null);
              if (!v) return null;
              return { id, snippet: { title: v.title, channelTitle: "검증", channelId: v.ch, publishedAt: agoA(v.days), description: `${v.title} 설명` }, statistics: { viewCount: String(v.views), likeCount: "1", commentCount: "1" }, contentDetails: { duration: "PT30S" } };
            }).filter(Boolean),
          }),
        );
      }
      if (kind === "playlistItems") {
        const ch = `UC${(u.searchParams.get("playlistId") ?? "").slice(2)}`;
        return new Response(JSON.stringify({ items: Object.entries(avids).filter(([, v]) => v.ch === ch).map(([id, v]) => ({ contentDetails: { videoId: id, videoPublishedAt: agoA(v.days) } })) }));
      }
      if (kind === "channels") {
        const ids = (u.searchParams.get("id") ?? "").split(",");
        return new Response(JSON.stringify({ items: ids.map((id) => ({ id, snippet: { title: `검증 채널 ${id.slice(2, 14)}`, customUrl: "@vrfy" }, statistics: { subscriberCount: "1000" } })) }));
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
    const aiNames: string[] = [];
    setScoutAiFetch((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      const name = body.response_format?.json_schema?.name;
      aiNames.push(name);
      const user = JSON.parse(body.messages[1].content);
      const content =
        name === "cluster_formats"
          ? { groups: [{ name: "전후 비교 반전", hitIds: user.hits.filter((h: { formatName: string }) => h.formatName.includes("전후")).map((h: { id: string }) => h.id), formatId: null, reason: "같은 전후 비교" }] }
          : { matchIds: user.results.slice(0, 3).map((r: { id: string }) => r.id), reason: "제목에 같은 구성" };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.001 } }));
    }) as typeof fetch);

    const sAuto = { ...DEFAULT_SCOUT_AUTO, countries: ["US" as const] };
    const aopt = { by: A, key: "verify-key", prefix: "verify_", skipPipeline: true };
    const radarFix = [
      { channelId: CH.kr1, multiple: 12, views: 50_000, title: "국내 터짐", ai: { relevant: true, category: "주방" }, dismissed: null },
      { channelId: CH.kr2, multiple: 2, views: 50_000, title: "덜 터짐", ai: { relevant: true, category: "살림" }, dismissed: null },
      { channelId: CH.kr3, multiple: 20, views: 50_000, title: "먹방", ai: { relevant: false, category: "기타" }, dismissed: null },
    ] as unknown as import("@/lib/neander/shorts/radar").RadarDoc[];
    const sum0 = (): ScoutAutoSummary => ({ at: 0, by: A, added: [], searches: 0, scanned: 0, newHits: 0, analyzed: 0, assigned: 0, cardsCreated: [], korea: [], narrated: false, aiUsd: 0, notes: [], ms: 0 });
    const sf1 = sum0();
    await scoutAuto.autoFillWatch(db, sAuto, { ...aopt, deadline: Date.now() + 90_000, radar: radarFix }, sf1);
    const w = async (ch: string) => (await db.collection(NEANDER_COL.shortsWatch).doc(`yt_${ch}`).get()).data() as import("@/lib/neander/shorts/scout").WatchChannelDoc | undefined;
    const wk = await w(CH.kr1);
    ok(wk?.country === "KR" && wk.owner === "company" && wk.topics.includes("자동 추가") && /AI 레이더/.test(wk.note), "한국: 레이더에서 평소의 N배 넘게 터진 채널을 자동 추가", wk?.note);
    ok(!(await w(CH.kr2)) && !(await w(CH.kr3)), "배수가 모자라거나 AI 가 무관이라 본 채널은 안 넣음");
    const wu = await w(CH.us1);
    ok(wu?.country === "US" && /평소의 10배/.test(wu.note), "해외: 검색에서 평소의 N배 넘은 영상이 있는 채널만", wu?.note);
    ok(!(await w(CH.us2)) && !(await w(CH.us3)), "평소 대비 낮거나 조회 적은 채널은 안 넣음");
    ok(sf1.searches === 1 && (await store.readQuota(db, `verify_ytsearch_${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`)) === 1, "해외 검색은 나라마다 1회 · 같은 계수기(검증용 접두사)");
    await db.collection(NEANDER_COL.shortsWatch).doc(`yt_${CH.us1}`).delete();
    const sf2 = sum0();
    await scoutAuto.autoFillWatch(db, sAuto, { ...aopt, deadline: Date.now() + 90_000, radar: radarFix }, sf2);
    ok(sf2.added.length === 0 && !(await w(CH.us1)), "사람이 지운 자동 채널은 다시 넣지 않음 · 이미 있는 채널도 그대로");

    // 자동 묶기
    const f1 = await scoutStore.saveFormat(db, A, null, { name: "검증 형식 카드", summary: "검증", koreanQueries: ["검증 국내 검색", "검증 둘째"] });
    created.formats.push(f1);
    const an = (formatName: string, match: string | null): HitAnalysis => ({
      formatName, summary: `${formatName} 요약`, hook: "훅", structure: ["가", "나"], editing: "", sound: "", textOverlay: "", whyItWorks: "", languageDependence: "visual",
      aiFeasibility: { level: "easy", easyParts: "", hardParts: "" }, risks: [], riskNote: "", brandIdeas: [], koreanQueries: ["전후 비교 살림"], totalSec: 20, cutCount: 5,
      match: { formatId: match, reason: "" }, model: "m", costUsd: 0, at: Date.now(), by: "company",
    });
    const hv = ["vrfyAutoH01", "vrfyAutoH02", "vrfyAutoH03", "vrfyAutoH04"];
    for (const v of hv) {
      await scoutStore.upsertHitFromApi(db, A, { videoId: v, url: `https://www.youtube.com/watch?v=${v}`, title: v, channel: "검증", thumbnail: "", publishedAt: agoA(2), duration: 30, views: 50_000, likes: 1, comments: 1, baseline: 5_000, baselineRef: "검증", watchId: null, country: "US", language: "en" }, { create: true, found: "scan" });
      created.hits.push(`yt_${v}`);
    }
    await scoutStore.setHitAnalysis(db, "yt_vrfyAutoH01", an("검증 형식", f1));
    await scoutStore.setHitAnalysis(db, "yt_vrfyAutoH02", an("전후 비교 A", null));
    await scoutStore.setHitAnalysis(db, "yt_vrfyAutoH03", an("전후 비교 B", null));
    await scoutStore.setHitAnalysis(db, "yt_vrfyAutoH04", an("혼자 형식", null));
    const sg = sum0();
    await scoutAuto.autoGroup(db, { ...aopt, deadline: Date.now() + 90_000, onlyHits: hv.map((v) => `yt_${v}`), onlyFormats: [f1] }, sg);
    const hit = async (v: string) => scoutStore.getHit(db, `yt_${v}`);
    ok((await hit("vrfyAutoH01")).formatId === f1, "AI 가 기존 카드와 같다고 본 영상은 바로 묶음");
    const h2 = await hit("vrfyAutoH02");
    const h3 = await hit("vrfyAutoH03");
    ok(!!h2.formatId && h2.formatId === h3.formatId && sg.cardsCreated.includes("전후 비교 반전"), "같은 형식 2편 → 카드를 자동으로 만들고 묶음", JSON.stringify(sg.cardsCreated));
    if (h2.formatId) created.formats.push(h2.formatId);
    const newCard = h2.formatId ? await scoutStore.getFormat(db, h2.formatId) : null;
    ok(newCard?.owner === "company" && /AI 자동 묶음/.test(newCard.note) && newCard.koreanQueries.includes("전후 비교 살림"), "자동 카드: 회사 소유 · 근거 메모 · 한국어 검색어 이어받음");
    ok((await hit("vrfyAutoH04")).status === "new", "혼자인 형식은 그대로 둠");
    ok(sg.assigned === 3 && aiNames.filter((n) => n === "cluster_formats").length === 1, "AI 묶기는 한 번만", `묶음 ${sg.assigned}`);

    // 한국 확인
    const sk = sum0();
    await scoutAuto.autoKoreaCheck(db, { ...sAuto, koreaPerDay: 5 }, { ...aopt, deadline: Date.now() + 90_000, onlyFormats: [f1] }, sk);
    const fk = await scoutStore.getFormat(db, f1);
    ok(fk.korea.status === "spread" && fk.korea.by === "company" && fk.korea.sampleSize === 4 && fk.korea.matches.length === 3 && /영상은 안 봄/.test(fk.korea.note), "한국 확인: 국내 표본 4편 중 AI 가 3편 고름 → 「국내에 퍼짐」 · 근거 메모", fk.korea.note.slice(0, 60));
    const sk2 = sum0();
    await scoutAuto.autoKoreaCheck(db, { ...sAuto, koreaPerDay: 5 }, { ...aopt, deadline: Date.now() + 90_000, onlyFormats: [f1] }, sk2);
    ok(sk2.korea.length === 0, "7일 안에 다시 확인하지 않음");
    await scoutStore.patchFormatKorea(db, A, f1, { ...fk.korea, status: "some", by: A, checkedAt: Date.now() - 10 * 86_400_000 });
    const sk3 = sum0();
    await scoutAuto.autoKoreaCheck(db, { ...sAuto, koreaPerDay: 5 }, { ...aopt, deadline: Date.now() + 90_000, onlyFormats: [f1] }, sk3);
    ok(sk3.korea.length === 0 && (await scoutStore.getFormat(db, f1)).korea.by === A, "사람이 표시한 지 30일 안이면 자동 확인이 덮지 않음");
    setYoutubeDataFetch(null);
    setScoutAiFetch(null);


    // ---- 16. 대본 작성기 (AI 모의 · 검증용 이메일 세션 · 사진 2장) ----
    const tinyJpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
    const wBodies: { photos: number; text: string; history: number }[] = [];
    let wFail = false;
    setAiFetch((async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      const last = body.messages.at(-1).content as { type: string; text?: string }[];
      wBodies.push({ photos: last.filter((c) => c.type === "image_url").length, text: last[0].text ?? "", history: body.messages.length - 2 });
      if (wFail) return new Response(JSON.stringify({ error: { message: "verify fail" } }), { status: 500 });
      const n = wBodies.length;
      const script = {
        title: `검증 대본 ${n}`, hook: "첫 3초", targetSec: 15, description: "설명", hashtags: ["검증"],
        cta: { type: "comment_keyword", keyword: "검증", wording: "댓글에 검증", atSec: null },
        scenes: [
          { label: "사진 장면", kind: "image", durationSec: 3, visual: "제품", aiPrompt: "", photo: 1 },
          { label: "AI 장면", kind: "ai", durationSec: 4, visual: "물", aiPrompt: "water", photo: null },
          { label: "직접", kind: "clip", durationSec: 3, visual: "손", aiPrompt: "", photo: null },
        ],
        lines: [{ beat: "hook", text: `줄 ${n}`, caption: "", scene: 0 }, { beat: "demo", text: "시연", caption: "", scene: 1 }, { beat: "cta", text: "댓글", caption: "", scene: 2 }],
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: `고쳤어요 ${n}`, script, facts: ["흰색(사진)"], basis: { kind: "format", id: f1, name: "검증 형식", why: "구성" }, checks: ["가격 확인"] }) } }], usage: { cost: 0.002 } }));
    }) as typeof fetch);
    const w1 = await scriptWriter.createScriptSession(db, A, {
      productName: "검증 물막이", productInfo: "3천원", kind: "coupang", targetSec: 15, ctaKeyword: "검증", refKind: "auto",
      photos: [{ name: "a.jpg", dataUrl: tinyJpeg, thumb: tinyJpeg }, { name: "b.jpg", dataUrl: tinyJpeg, thumb: tinyJpeg }],
    });
    const ws = w1.session;
    ok(!w1.error && ws.versionCount === 1 && ws.script?.title === "검증 대본 1" && ws.photos.length === 2 && wBodies[0].photos === 2, "대본 작성기: 새 대본 — 사진 2장을 AI 에 보여 주고 v1", JSON.stringify({ e: w1.error, v: ws.versionCount, p: wBodies[0]?.photos }));
    ok(ws.reference.kind === "format" && ws.reference.id === f1 && ws.facts[0] === "흰색(사진)" && ws.checks[0] === "가격 확인", "「AI 가 고르기」 면 고른 형식 카드를 기억 · 확인된 사실 · 확인할 것");
    ok(/검증 형식/.test(wBodies[0].text) || /format id=/.test(wBodies[0].text), "참고 분석 목록이 요청에 들어감");
    const photoDocs = await db.collection(NEANDER_COL.shortsScripts).doc(ws.id).collection("photos").get();
    ok(photoDocs.size === 2, "사진 원본은 하위 photos 에 (세션 문서엔 미리보기만)");
    const w2 = await scriptWriter.scriptSessionTurn(db, A, ws.id, { message: "15초로 줄여 줘" });
    ok(w2.session.versionCount === 2 && wBodies[1].photos === 0 && wBodies[1].history === 2 && /15초로 줄여 줘/.test(wBodies[1].text) && /"currentScript":\{"title":"검증 대본 1"/.test(wBodies[1].text), "두 번째 요청 — 사진은 다시 안 보냄 · 앞 대화 · 지금 대본을 넘김", JSON.stringify(wBodies[1] && { p: wBodies[1].photos, h: wBodies[1].history }));
    const w3 = await scriptWriter.scriptSessionTurn(db, A, ws.id, { message: "새 사진 반영", photos: [{ name: "c.jpg", dataUrl: tinyJpeg, thumb: tinyJpeg }] });
    ok(w3.session.photos.length === 3 && wBodies[2].photos === 1, "새로 붙인 사진만 AI 에 보여 줌");
    await rejects(scriptWriter.scriptSessionTurn(db, A, ws.id, { message: "x", photos: [1, 2].map(() => ({ name: "d.jpg", dataUrl: tinyJpeg, thumb: tinyJpeg })) }), /4장까지/, "사진은 4장까지");
    wFail = true;
    const wf = await scriptWriter.scriptSessionTurn(db, A, ws.id, { message: "실패할 요청" });
    wFail = false;
    ok(!!wf.error && wf.session.versionCount === 3 && wf.session.messages.at(-1)?.error && wf.session.messages.at(-2)?.text === "실패할 요청", "AI 가 실패해도 사람 말은 남고 버전은 그대로");
    const wr = await scriptWriter.revertScriptSession(db, A, ws.id, 1);
    ok(wr.versionCount === 4 && wr.script?.title === "검증 대본 1" && wr.versions.at(-1)?.note === "v1 으로 되돌림", "되돌리기는 새 버전으로 쌓임 (v1 → v4)");
    const wp = await scriptWriter.patchScriptSession(db, A, ws.id, { facts: ["  흰색  ", "흰색", "용량 350ml"], targetSec: 45 });
    ok(wp.facts.join("|") === "흰색|용량 350ml" && wp.targetSec === 45, "사람이 고친 확인된 사실 · 길이");
    await rejects(scriptWriter.scriptSessionTurn(db, B, ws.id, { message: "남의 대본" }), /다른 사람의 대본/, "다른 사람은 고치지 못함");
    await rejects(scriptWriter.getScriptSession(db, B, ws.id), /다른 사람의 대본/, "다른 사람은 열지 못함 (관리자만 읽기)");
    const wl = await scriptWriter.listScriptSessions(db, A);
    ok(wl.some((x) => x.id === ws.id && x.versionCount === 4 && x.product === "검증 물막이" && !!x.cover) && !(await scriptWriter.listScriptSessions(db, B)).some((x) => x.id === ws.id), "목록 — 내 것만 · 버전 수 · 미리보기");
    const wt = await scriptWriter.scriptSessionToProject(db, A, ws.id);
    created.projects.push(wt.projectId);
    const wproj = await store.getProject(db, A, wt.projectId);
    ok(wt.created && wproj.scenes.length === 3 && wproj.scenes[0].kind === "blank" && /제품 사진 2/.test(wproj.scenes[0].label) && wproj.scenes[1].kind === "ai" && wproj.scenes[1].ai?.prompt === "water" && wproj.script.lines.length === 3 && wproj.script.lines[0].sceneId === wproj.scenes[0].id, "이 대본으로 영상 만들기 — 장면 · 줄 · 사진 장면은 빈 장면(사진 번호 표시)", JSON.stringify(wproj.scenes.map((x) => [x.kind, x.label])));
    ok(wproj.publish.title === "검증 대본 1" && wproj.cta.keyword === "검증" && wproj.facts.includes("용량 350ml") && wproj.stage === "scripting", "게시 제목 · CTA · 확인된 사실 · 단계");
    ok((await scriptWriter.scriptSessionToProject(db, A, ws.id)).projectId === wt.projectId, "두 번 눌러도 같은 영상");
    // 스토리 광고 — 재료 저장 · 길이 기본 45초 · 영상 메모에 로그라인 · 등장인물 · 컷 메모
    setAiFetch((async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            reply: "스토리를 썼어요",
            script: {
              title: "공원 그랑프리", hook: "출발선", targetSec: 45, description: "", hashtags: [], cta: { type: "other", keyword: "", wording: "사주세요", atSec: null },
              scenes: [{ label: "출발", kind: "ai", durationSec: 3, visual: "출발선", aiPrompt: "white Maltese, camera does not rotate", photo: null, camera: "정면 고정", sound: "호루라기", continuity: "" }],
              lines: [{ beat: "hook", text: "", caption: "공원 그랑프리", scene: 0 }],
              story: { logline: "털 많은 솜이의 역전", catchphrase: "브레이크는 발바닥에 있다", look: "3D", characters: [{ name: "솜이", role: "주인공", look: "몰티즈", lookPrompt: "white Maltese" }], acts: [{ name: "설정", fromSec: 0, toSec: 3, summary: "출발" }], endCard: { visual: "제품 3색", text: "18,900원", cta: "사주세요" } },
            },
            facts: [], basis: { kind: "none", id: "", name: "", why: "" }, checks: [],
          }) } }],
          usage: { cost: 0.002 },
        }),
      )) as typeof fetch);
    const sw = await scriptWriter.createScriptSession(db, A, { productName: "검증 이발기", kind: "coupang", style: "story", story: { problem: "발바닥 털", idea: "달리기 시합", tone: "코믹" } });
    ok(!sw.error && sw.session.style === "story" && sw.session.targetSec === 45 && sw.session.storyInput?.problem === "발바닥 털" && sw.session.script?.story?.catchphrase === "브레이크는 발바닥에 있다", "스토리 광고 세션 — 재료 · 기본 45초 · 이야기", JSON.stringify({ e: sw.error, st: sw.session.style, t: sw.session.targetSec }));
    ok((await scriptWriter.listScriptSessions(db, A)).find((x) => x.id === sw.session.id)?.style === "story", "목록에 영상 방식");
    const swp = await scriptWriter.scriptSessionToProject(db, A, sw.session.id);
    created.projects.push(swp.projectId);
    const swProj = await store.getProject(db, A, swp.projectId);
    ok(/로그라인: 털 많은 솜이의 역전/.test(swProj.notes) && /white Maltese/.test(swProj.notes) && /카메라 정면 고정/.test(swProj.notes) && /엔드카드: 제품 3색/.test(swProj.notes) && swProj.scenes[0].ai?.prompt.includes("camera does not rotate"), "스토리 → 영상: 메모에 로그라인 · 등장인물 · 컷 메모 · 엔드카드, 장면 프롬프트 그대로");
    await scriptWriter.deleteScriptSession(db, A, sw.session.id);
    await scriptWriter.deleteScriptSession(db, A, ws.id);
    ok(!(await db.collection(NEANDER_COL.shortsScripts).doc(ws.id).get()).exists && (await db.collection(NEANDER_COL.shortsScripts).doc(ws.id).collection("photos").get()).size === 0, "지우기 — 세션과 사진 원본 모두");
    setAiFetch(null);

    platforms.setPlatformFetch(null);
  } finally {
    // ---- 정리 ----
    for (const v of ["vrfyRadar01", "vrfyRadar02", "vrfyRadar03", "vrfyRadar04", "vrfyRadar05", "vrfyRadar06"]) await db.collection(NEANDER_COL.shortsRadar).doc(`yt_${v}`).delete();
    for (const k of ["usage_verify_ytsearch_verify", "usage_verify_radarusd_verify", "verify_radar_lock", "verify_scout_auto_added", "verify_scout_auto_lock", `usage_verify_ytsearch_${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`]) await db.collection(NEANDER_COL.shortsSettings).doc(k).delete();
    for (const ch of created.watch) await db.collection(NEANDER_COL.shortsWatch).doc(`yt_${ch}`).delete();
    for (const id of created.hits) await db.collection(NEANDER_COL.shortsHits).doc(id).delete();
    for (const id of created.formats) await db.collection(NEANDER_COL.shortsFormats).doc(id).delete();
    for (const who of [A, B]) await db.collection(NEANDER_COL.shortsProfiles).doc(who).delete();
    for (const who of [A, B]) for (const d of (await db.collection(NEANDER_COL.shortsScripts).where("owner", "==", who).get()).docs) await db.recursiveDelete(d.ref);
    for (const col of [NEANDER_COL.shortsJobs, NEANDER_COL.shortsPublications, NEANDER_COL.shortsAccounts, NEANDER_COL.shortsMetrics, NEANDER_COL.shortsTemplates, NEANDER_COL.shortsTrends]) {
      for (const who of [A, B]) {
        const snap = await db.collection(col).where("owner", "==", who).get();
        for (const d of snap.docs) await d.ref.delete();
      }
    }
    for (const id of created.projects) {
      const m = await db.collection(NEANDER_COL.shortsMedia).where("projectId", "==", id).get();
      for (const d of m.docs) await db.recursiveDelete(d.ref);
      const v = await db.collection(NEANDER_COL.shortsVersions).where("projectId", "==", id).get();
      for (const d of v.docs) await d.ref.delete();
      await db.collection(NEANDER_COL.shortsProjects).doc(id).delete();
    }
    for (const id of created.clients) {
      const m = await db.collection(NEANDER_COL.shortsMedia).where("clientId", "==", id).get();
      for (const d of m.docs) await db.recursiveDelete(d.ref);
      await db.collection(NEANDER_COL.shortsClients).doc(id).delete();
    }
    for (const id of created.projects) {
      const l = await db.collection(NEANDER_COL.shortsReviewLinks).where("projectId", "==", id).get();
      for (const d of l.docs) await d.ref.delete();
    }
    const leftClients = (await db.collection(NEANDER_COL.shortsClients).where("createdBy", "in", [A, B]).get()).size;
    ok(leftClients === 0, "검증 고객사를 모두 지움");
    const left = await Promise.all(
      [NEANDER_COL.shortsProjects, NEANDER_COL.shortsJobs, NEANDER_COL.shortsPublications, NEANDER_COL.shortsAccounts, NEANDER_COL.shortsMedia].map(async (c) =>
        (await db.collection(c).where("owner", "in", [A, B]).get()).size,
      ),
    );
    ok(left.every((n) => n === 0), "검증 문서를 모두 지움", left.join("/"));
  }
  console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
