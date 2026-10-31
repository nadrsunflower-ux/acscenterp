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

  const created = { projects: [] as string[], trends: [] as string[], clients: [] as string[] };
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

    const calls: string[] = [];
    let mode: "ok" | "drop" = "ok";
    platforms.setPlatformFetch((async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      if (url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=v" } });
      if (init.method === "PUT") {
        if (mode === "drop") throw new Error("connection reset");
        return new Response(JSON.stringify({ id: "verifyVid01", status: { uploadStatus: "uploaded", privacyStatus: "private" } }), { status: 201 });
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
    ok(calls.filter((c) => c.startsWith("PUT")).length === 1, "영상 바이트는 한 번만 보냄");
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r1 }), /이미 이 계정에 게시/, "게시된 파일을 같은 계정에 다시 게시하면 거절");

    // 불확실한 결과
    const r2 = await mkRender();
    mode = "drop";
    const c2 = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2 });
    const putsBefore = calls.filter((c) => c.startsWith("PUT")).length;
    await runner.tick(db, { budgetMs: 30_000 });
    await runner.tick(db, { budgetMs: 30_000 });
    const pub2 = (await db.collection(NEANDER_COL.shortsPublications).doc(c2.publicationId).get()).data() as PublicationDoc;
    ok(pub2.status === "uncertain", "전송 중 연결이 끊기면 uncertain", pub2.status);
    ok(calls.filter((c) => c.startsWith("PUT")).length === putsBefore + 1, "불확실한 업로드는 실행기가 다시 보내지 않음");
    await rejects(pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2 }), /불확실/, "불확실한 게시가 있으면 같은 요청 거절");
    await pubs.resolvePublication(db, A, c2.publicationId, { outcome: "not_published" });
    mode = "ok";
    const c3 = await pubs.createPublication(db, A, { projectId: pid, accountId: accId, renderId: r2 });
    ok(c3.publicationId === c2.publicationId, "사람이 「게시 안 됨」 을 확인하면 같은 원장에서 다시 시도");
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
    const igId = accounts.accountId("instagram", "17841499999999999", A);
    await db.collection(NEANDER_COL.shortsAccounts).doc(igId).set({ ...acc, platform: "instagram", authMode: "facebook_login", externalId: "17841499999999999", externalName: "@verify", sealed: secret.sealTokens({ pageToken: "pt" }, igId) });
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
    ok((await media.readParts(db, B, r1, 0, 1, true)).length > 0, "관리자 몰아보기: 남의 완성 영상을 받아 봄");
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
    const coupangOnClient = await pubs.preparePublish(db, A, { projectId: pid, accountId: clientAccId, renderId: r1 });
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

    platforms.setPlatformFetch(null);
  } finally {
    // ---- 정리 ----
    for (const who of [A, B]) await db.collection(NEANDER_COL.shortsProfiles).doc(who).delete();
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
