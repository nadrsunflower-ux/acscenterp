import "server-only";

// ============================================================
//  쇼핑쇼츠 작업 큐 — Firestore 문서 + 임대(lease)
// ------------------------------------------------------------
//  Vercel 요청 하나에서 긴 일을 끝까지 하지 않는다. 작업은 「단계」 로 쪼개고,
//  실행기(runner.ts)가 한 번에 한 단계씩 임대를 잡고 진행한다. 실행기를
//  부르는 곳은 셋이다:
//    1) 열린 ERP 화면 (쇼츠 실행기 훅이 주기적으로 tick)
//    2) Vercel Cron (api/neander/shorts/cron, CRON_SECRET)
//    3) 사람이 「지금 실행」 을 누를 때
//
//  임대가 끝났는데 작업이 running 이면 (함수가 죽음 · 창을 닫음):
//    · 브라우저 출력       → interrupted (같은 설계도로 다시 출력하면 된다)
//    · 서버 · 쓰기 아님    → queued (그 단계를 다시 한다 — 읽기라 안전)
//    · 서버 · 쓰기 도중    → uncertain (외부에 들어갔는지 모른다 · 자동 재시도 금지)
//
//  복합 색인 없이 돈다 — status 하나로만 질의하고 runAt 은 메모리에서 거른다
//  (색인 게시 권한이 없다 · 살아 있는 작업은 많아야 수십 개).
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { JobDoc, JobKind, JobView, ProjectDoc } from "../types";
import { assertRead } from "./access";

export const LEASE_MS = 90_000;
const ACTIVE = ["queued", "running", "waiting"] as const;

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsJobs);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,60}$/.test(v);

export const toView = (id: string, j: JobDoc): JobView => {
  const { leaseBy: _l, state: _s, ...rest } = j;
  // 입력에는 토큰이 없지만, 큰 값(대본 전체 등)은 화면에 필요 없다
  const input = Object.fromEntries(Object.entries(j.input).filter(([k]) => !["lines", "caption"].includes(k)));
  return { ...rest, id, input };
};

export function newJob(owner: string, projectId: string, kind: JobKind, runner: JobDoc["runner"], input: Record<string, unknown>, opts: { runAt?: number; dedupeKey?: string | null; step: string }): JobDoc {
  const now = Date.now();
  return {
    owner,
    projectId,
    kind,
    runner,
    status: runner === "browser" ? "running" : "queued",
    step: opts.step,
    stepState: "idle",
    runAt: opts.runAt ?? now,
    leaseUntil: runner === "browser" ? now + LEASE_MS : 0,
    leaseBy: null,
    attempts: 0,
    progress: { pct: 0, message: runner === "browser" ? "브라우저에서 출력 중" : "실행기를 기다리는 중" },
    input,
    state: {},
    result: null,
    error: null,
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    log: [{ at: now, msg: "작업을 만들었습니다." }],
    dedupeKey: opts.dedupeKey ?? null,
  };
}

/** 같은 열쇠의 작업이 살아 있으면 막는다 (같은 장면 생성 두 번 · 같은 프로젝트 출력 두 번) */
export async function enqueue(db: Firestore, job: JobDoc, leaseBy?: string): Promise<string> {
  if (job.dedupeKey) {
    const same = await col(db).where("dedupeKey", "==", job.dedupeKey).get();
    const live = same.docs.find((d) => (ACTIVE as readonly string[]).includes((d.data() as JobDoc).status));
    if (live) throw new AccessError(409, "같은 작업이 이미 진행 중입니다. 끝나거나 취소된 뒤에 다시 시작해 주세요.");
  }
  const id = randomBytes(12).toString("base64url");
  await col(db).doc(id).set({ ...job, leaseBy: leaseBy ?? null });
  return id;
}

export async function getJob(db: Firestore, id: string): Promise<JobDoc | undefined> {
  return (await col(db).doc(id).get()).data() as JobDoc | undefined;
}

async function projectOf(db: Firestore, projectId: string, email: string, admin = false) {
  return assertRead((await db.collection(NEANDER_COL.shortsProjects).doc(projectId).get()).data() as ProjectDoc | undefined, email, "영상", admin);
}

/** 내가 볼 수 있는 작업 — 프로젝트 하나 또는 내 것 전부 (최근 것부터). admin = 관리자 몰아보기(읽기) */
export async function listJobs(db: Firestore, email: string, projectId?: string, admin = false): Promise<JobView[]> {
  await reapExpired(db);
  if (projectId) {
    await projectOf(db, projectId, email, admin);
    const snap = await col(db).where("projectId", "==", projectId).get();
    return snap.docs.map((d) => toView(d.id, d.data() as JobDoc)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }
  const snap = await col(db).where("owner", "==", email).get();
  return snap.docs.map((d) => toView(d.id, d.data() as JobDoc)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

function pushLog(j: JobDoc, msg: string, at = Date.now()) {
  return [...j.log, { at, msg: msg.slice(0, 300) }].slice(-30);
}

/**
 * 취소 요청. 아직 외부에 보내기 전(queued · 예약)이면 바로 취소되고, 진행 중이면
 * 실행기가 다음 단계 경계에서 멈춘다. 쓰기 도중이면 그 쓰기는 이미 나갔다.
 */
export async function requestCancel(db: Firestore, email: string, id: unknown): Promise<JobView> {
  if (!isId(id)) throw new Error("작업 id 가 올바르지 않습니다.");
  const ref = col(db).doc(id);
  let out!: JobDoc;
  await db.runTransaction(async (tx) => {
    const j = (await tx.get(ref)).data() as JobDoc | undefined;
    if (!j) throw new Error("작업을 찾지 못했습니다.");
    await projectOf(db, j.projectId, email);
    if (!(ACTIVE as readonly string[]).includes(j.status)) throw new Error("이미 끝난 작업입니다.");
    const now = Date.now();
    if (j.status === "queued" && j.stepState === "idle" && j.attempts === 0) {
      out = { ...j, status: "cancelled", cancelRequested: true, finishedAt: now, updatedAt: now, log: pushLog(j, `${email} 님이 취소했습니다 (외부로 보내기 전).`) };
    } else if (j.runner === "browser") {
      out = { ...j, status: "cancelled", cancelRequested: true, finishedAt: now, updatedAt: now, log: pushLog(j, `${email} 님이 출력을 취소했습니다.`) };
    } else {
      out = { ...j, cancelRequested: true, updatedAt: now, log: pushLog(j, `${email} 님이 취소를 요청했습니다 — 다음 단계 경계에서 멈춥니다.`) };
    }
    tx.set(ref, out);
  });
  return toView(id, out);
}

/** 임대가 끝난 running 작업 정리 (읽을 때마다 · tick 마다) */
export async function reapExpired(db: Firestore, now = Date.now()): Promise<{ id: string; job: JobDoc }[]> {
  const snap = await col(db).where("status", "==", "running").get();
  const out: { id: string; job: JobDoc }[] = [];
  for (const d of snap.docs) {
    const j = d.data() as JobDoc;
    if (j.leaseUntil > now) continue;
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(d.ref)).data() as JobDoc | undefined;
      if (!cur || cur.status !== "running" || cur.leaseUntil > now) return;
      let next: JobDoc;
      if (cur.runner === "browser") {
        next = { ...cur, status: "interrupted", finishedAt: now, updatedAt: now, error: { code: "BROWSER_GONE", message: "출력하던 창이 닫혔거나 응답이 끊겼습니다. 같은 설계도로 다시 출력해 주세요." }, log: pushLog(cur, "브라우저 응답이 90초 넘게 없어 중단으로 표시했습니다.") };
      } else if (cur.stepState === "writing") {
        next = {
          ...cur,
          status: "uncertain",
          finishedAt: now,
          updatedAt: now,
          error: { code: "LEASE_LOST_DURING_WRITE", message: `「${cur.step}」 외부 요청 도중 실행이 끊겨 결과를 알 수 없습니다. 플랫폼에서 직접 확인해 주세요. 자동으로 다시 하지 않습니다.` },
          log: pushLog(cur, "외부 쓰기 도중 임대가 끝났습니다 → 결과 확인 필요."),
        };
      } else {
        next = { ...cur, status: "queued", leaseBy: null, leaseUntil: 0, runAt: now, updatedAt: now, log: pushLog(cur, "실행이 끊겨 같은 단계를 다시 대기열에 넣었습니다 (읽기 단계라 안전).") };
      }
      tx.set(d.ref, next);
      out.push({ id: d.id, job: next });
    });
  }
  return out;
}

/** 때가 된 서버 작업을 임대한다 */
export async function claimDue(db: Firestore, workerId: string, limit: number, now = Date.now()): Promise<{ id: string; job: JobDoc }[]> {
  const snap = await col(db).where("status", "in", ["queued", "waiting"]).get();
  const due = snap.docs
    .map((d) => ({ id: d.id, job: d.data() as JobDoc }))
    .filter((x) => x.job.runner === "server" && x.job.runAt <= now)
    .sort((a, b) => a.job.runAt - b.job.runAt)
    .slice(0, limit);
  const claimed: { id: string; job: JobDoc }[] = [];
  for (const x of due) {
    const ref = col(db).doc(x.id);
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as JobDoc | undefined;
      if (!cur || !["queued", "waiting"].includes(cur.status) || cur.runAt > now) return;
      const next: JobDoc = { ...cur, status: "running", leaseBy: workerId, leaseUntil: now + LEASE_MS, attempts: cur.attempts + 1, updatedAt: now };
      tx.set(ref, next);
      claimed.push({ id: x.id, job: next });
    });
  }
  return claimed;
}

/**
 * 임대를 쥔 실행기만 고친다. 임대를 잃었으면(다른 실행기 · 정리됨) false — 그 뒤의
 * 일을 하면 안 된다.
 */
export async function persist(db: Firestore, id: string, workerId: string, patch: Partial<JobDoc> & { logMsg?: string }): Promise<JobDoc | null> {
  const ref = col(db).doc(id);
  let out: JobDoc | null = null;
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as JobDoc | undefined;
    if (!cur || cur.leaseBy !== workerId || cur.status !== "running") return;
    const { logMsg, ...rest } = patch;
    const now = Date.now();
    const done = rest.status && !["running", "queued", "waiting"].includes(rest.status);
    out = {
      ...cur,
      ...rest,
      updatedAt: now,
      ...(rest.status && rest.status !== "running" ? { leaseBy: null, leaseUntil: 0 } : { leaseUntil: now + LEASE_MS }),
      ...(done ? { finishedAt: now } : {}),
      log: logMsg ? pushLog(cur, logMsg, now) : cur.log,
    };
    tx.set(ref, out);
  });
  return out;
}

export async function isCancelRequested(db: Firestore, id: string): Promise<boolean> {
  return ((await col(db).doc(id).get()).data() as JobDoc | undefined)?.cancelRequested === true;
}

// ---- 브라우저 출력 작업 ---------------------------------------------------

/** 출력 시작 — 프로젝트마다 출력은 하나씩 */
export async function startBrowserRender(db: Firestore, email: string, projectId: string, specHash: string, sessionId: string): Promise<string> {
  await projectOf(db, projectId, email);
  const job = newJob(email, projectId, "render", "browser", { specHash: specHash.slice(0, 40) }, { step: "render", dedupeKey: `render_${projectId}` });
  return enqueue(db, job, sessionId);
}

/** 진행 · 끝 · 실패 — 출력을 시작한 창(sessionId)만 */
export async function updateBrowserRender(
  db: Firestore,
  email: string,
  id: unknown,
  sessionId: string,
  patch: { pct?: number; message?: string; done?: { mediaId: string }; error?: string },
): Promise<JobView> {
  if (!isId(id)) throw new Error("작업 id 가 올바르지 않습니다.");
  const ref = col(db).doc(id);
  let out!: JobDoc;
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as JobDoc | undefined;
    if (!cur || cur.runner !== "browser") throw new Error("출력 작업을 찾지 못했습니다.");
    if (cur.owner !== email || cur.leaseBy !== sessionId) throw new AccessError(403, "이 출력을 시작한 창에서만 고칠 수 있습니다.");
    if (cur.status !== "running") throw new AccessError(409, cur.status === "cancelled" ? "취소된 출력입니다." : "이미 끝났거나 중단된 출력입니다.");
    const now = Date.now();
    if (patch.done) {
      out = { ...cur, status: "succeeded", progress: { pct: 100, message: "출력 완료" }, result: { mediaId: patch.done.mediaId }, finishedAt: now, updatedAt: now, leaseUntil: 0, log: pushLog(cur, "출력을 마치고 파일을 서버에 저장했습니다.") };
    } else if (patch.error) {
      out = { ...cur, status: "failed", error: { code: "RENDER_FAILED", message: patch.error.slice(0, 300) }, finishedAt: now, updatedAt: now, leaseUntil: 0, log: pushLog(cur, `출력 실패: ${patch.error}`) };
    } else {
      out = { ...cur, progress: { pct: Math.max(0, Math.min(99, Math.round(patch.pct ?? cur.progress.pct))), message: (patch.message ?? cur.progress.message).slice(0, 120) }, leaseUntil: now + LEASE_MS, updatedAt: now };
    }
    tx.set(ref, out);
  });
  return toView(id, out);
}
