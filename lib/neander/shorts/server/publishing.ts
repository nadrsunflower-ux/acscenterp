import "server-only";

// ============================================================
//  게시 원장 — 중복 방지 · 정책 확인 · 불확실한 결과 처리
// ------------------------------------------------------------
//  원장 문서 id = publicationKey(계정, 완성 파일, 플랫폼). create() 로 만들기
//  때문에 같은 조합의 요청이 동시에 두 번 와도 하나만 통과한다.
//
//    scheduled  예약 — 실행기가 그 시각 이후에 처리한다. 아직 게시 전이다.
//    queued     대기열
//    uploading  전송 중 (외부 쓰기)
//    processing Instagram 처리 대기 (읽기만 반복)
//    published  플랫폼이 준 실제 id 를 받았다
//    failed     확실히 안 올라갔다 → 사람이 다시 시도할 수 있다
//    uncertain  쓰기 도중 끊김 → 사람이 플랫폼에서 확인하고 「게시됨 / 안 됨」 을 기록한다
//    cancelled  보내기 전에 취소
//
//  게시 직전에 서버가 정책 확인을 **다시** 계산한다 (브라우저가 보낸 결과를 믿지 않는다).
//  사람의 확인(user)은 프로젝트에 적힌 것을 쓰고, 둘을 원장에 함께 남긴다.
//
//  YouTube 는 48MB 씩 나눠 보낸다 (yt_session → yt_chunk 반복). 조각마다 먼저 세션에
//  「어디까지 받았나」 를 묻고 거기서부터 보내므로, 끊겨도 이어 가고 마지막 응답을
//  놓쳐도 다음 물음에 영상 id 가 온다. Instagram 은 버킷 파일이면 서명 URL 을 넘긴다.
//  게시가 끝나면 그 완성 파일의 게시가 모두 끝났는지 보고 내용을 지운다 (media.ts).
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  buildCaption,
  CAPTION_LIMIT,
  captionLength,
  complianceBlockers,
  complianceItemsFor,
  INSTAGRAM_MAX_BYTES,
  publicationKey,
  systemChecks,
  TITLE_LIMIT,
} from "../model";
import type { ComplianceCheck, ComplianceKey, JobDoc, MediaDoc, ProjectDoc, PublicationDoc, PublicationView, PublishPlatform } from "../types";
import { accountTokens, getAccountForPublish, markNeedsReauth, toAccountView } from "./accounts";
import { enqueue, newJob, persist } from "./jobs";
import { publishUrl, purgeAfterPublish, readBytes, readWhole } from "./media";
import {
  instagramContainerStatus,
  instagramCreateContainer,
  instagramPermalink,
  instagramPublish,
  instagramPublishingLimit,
  instagramUploadBytes,
  PublishingError,
  YT_CHUNK_BYTES,
  YT_RETRY,
  youtubePutChunk,
  youtubeStartSession,
  youtubeUploadStatus,
} from "./platforms";
import { getProject, patchProject } from "./store";
import { getClientDoc } from "./clients";

const col = (db: Firestore) => db.collection(NEANDER_COL.shortsPublications);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{6,120}$/.test(v);

export async function listPublications(db: Firestore, email: string, projectIds: string[]): Promise<PublicationView[]> {
  if (!projectIds.length) return [];
  const out: PublicationView[] = [];
  for (let i = 0; i < projectIds.length; i += 30) {
    const snap = await col(db).where("projectId", "in", projectIds.slice(i, i + 30)).get();
    out.push(...snap.docs.map((d) => ({ ...(d.data() as PublicationDoc), id: d.id })));
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function renderOf(db: Firestore, project: ProjectDoc & { id: string }, renderId: unknown, platform?: PublishPlatform, accountId?: string): Promise<MediaDoc & { id: string }> {
  if (!isId(renderId) || !project.renderIds.includes(renderId)) throw new Error("이 영상에서 출력한 완성 파일을 골라 주세요.");
  const d = (await db.collection(NEANDER_COL.shortsMedia).doc(renderId).get()).data() as MediaDoc | undefined;
  if (!d || !d.complete || d.kind !== "render") throw new Error("완성 파일을 찾지 못했습니다.");
  if (d.purged) {
    // 같은 계정에 이미 올린 것이면 그 말을 먼저 한다 (중복 게시 안내와 같게)
    const prev = platform && accountId ? ((await col(db).doc(publicationKey(accountId, renderId, platform)).get()).data() as PublicationDoc | undefined) : undefined;
    if (prev?.status === "published") throw new AccessError(409, "이 완성 파일은 이미 이 계정에 게시됐습니다 (게시가 끝나 파일도 지웠습니다).");
    throw new Error("게시가 끝나 내용을 지운 완성 파일입니다. 다른 채널에 올리려면 완성 파일을 다시 올려 주세요.");
  }
  return { ...d, id: renderId };
}

/** 실행기가 보낼 파일 — 그 사이 지워졌으면 확실한 실패 */
async function sendable(db: Firestore, renderId: string): Promise<MediaDoc> {
  const d = (await db.collection(NEANDER_COL.shortsMedia).doc(renderId).get()).data() as MediaDoc | undefined;
  if (!d || !d.complete) throw new PublishingError("RENDER_GONE", "완성 파일이 지워져 보낼 수 없습니다.", 410);
  if (d.purged) throw new PublishingError("RENDER_GONE", "완성 파일의 내용을 이미 지워 보낼 수 없습니다.", 410);
  return d;
}

const mbOf = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB`;

export interface PrepareResult {
  platform: PublishPlatform;
  title: string;
  caption: string;
  captionLength: number;
  captionLimit: number;
  checks: Partial<Record<ComplianceKey, ComplianceCheck>>;
  blockers: { key: ComplianceKey; label: string; reason: string }[];
  problems: string[];
  existing: PublicationView | null;
}

/** 게시 전 점검 — 저장하지 않고 결과만 (프로젝트의 system 칸은 갱신) */
export async function preparePublish(db: Firestore, email: string, input: { projectId?: unknown; accountId?: unknown; renderId?: unknown }): Promise<PrepareResult> {
  const project = await getProject(db, email, input.projectId);
  const account = await getAccountForPublish(db, email, input.accountId);
  const render = await renderOf(db, project, input.renderId, account.platform, account.id);
  const platform = account.platform;
  // 브랜드 영상: 고객사 자기 계정이면 자기 광고(고지 불필요), 아니면 우리 채널의 대가 받은 광고
  const ownBrandAccount = project.kind === "brand" && !!account.clientId && account.clientId === project.clientId;
  const banned = project.kind === "brand" && project.clientId ? (await getClientDoc(db, project.clientId)).brief.banned : [];
  const caption = buildCaption(project, platform, { ownBrandAccount });
  const sys = systemChecks(project, caption, toAccountView(account.id, account, email), { id: render.id, overlay: render.overlay }, Date.now(), banned);
  const items = complianceItemsFor(project, ownBrandAccount);
  const checks: Partial<Record<ComplianceKey, ComplianceCheck>> = {};
  for (const k of items.map((i) => i.key)) {
    checks[k] = { system: sys[k] ?? null, user: project.compliance[k]?.user ?? null };
  }
  // 프로그램 확인 결과를 프로젝트에도 적어 둔다 (화면이 다음에 열 때 보이게)
  await patchProject(db, project.id, email, (p) => {
    for (const k of Object.keys(sys) as ComplianceKey[]) p.compliance[k] = { system: sys[k] ?? null, user: p.compliance[k]?.user ?? null };
  });
  const problems: string[] = [];
  if (account.clientId && account.clientId !== project.clientId) {
    problems.push(
      project.kind === "brand"
        ? "다른 고객사의 계정입니다 — 이 고객사 계정이나 우리 채널을 골라 주세요."
        : project.kind === "general"
          ? "고객사 소유 계정에는 일반 영상을 올리지 않습니다."
          : "고객사 소유 계정에는 쿠팡 제휴 영상을 올리지 않습니다.",
    );
  }
  const title = project.publish.title.trim() || project.title;
  if ([...title].length > TITLE_LIMIT) problems.push(`제목은 ${TITLE_LIMIT}자 이하여야 합니다.`);
  const len = captionLength(caption, platform);
  if (len > CAPTION_LIMIT[platform]) problems.push(`게시 문구가 너무 깁니다 (${len.toLocaleString()} / ${CAPTION_LIMIT[platform].toLocaleString()}${platform === "youtube" ? "바이트" : "자"}).`);
  if (project.publish.synthetic === null) problems.push("AI 합성 콘텐츠 여부(실제처럼 보이는 합성 장면이 있는가)를 골라 주세요.");
  if (account.status !== "connected") problems.push("계정 연결이 만료됐습니다. 계정 화면에서 다시 연결해 주세요.");
  if (platform === "instagram" && (render.type !== "video/mp4" || render.codecs?.video !== "avc" || render.codecs?.audio !== "aac")) {
    problems.push("Instagram 에는 H.264/AAC MP4 완성 파일이 필요합니다. 이 파일은 그 형식으로 확인되지 않았습니다.");
  }
  if (platform === "instagram" && render.size > INSTAGRAM_MAX_BYTES) {
    problems.push(`Instagram 은 릴스 한 편 ${mbOf(INSTAGRAM_MAX_BYTES)} 까지 받습니다 (이 파일 ${mbOf(render.size)}). YouTube 에만 올리거나 용량을 줄여 다시 올려 주세요.`);
  }
  const existingSnap = await col(db).doc(publicationKey(account.id, render.id, platform)).get();
  const existing = existingSnap.exists ? ({ ...(existingSnap.data() as PublicationDoc), id: existingSnap.id } as PublicationView) : null;
  return {
    platform,
    title,
    caption,
    captionLength: len,
    captionLimit: CAPTION_LIMIT[platform],
    checks,
    blockers: complianceBlockers(checks, items),
    problems,
    existing,
  };
}

/** 게시 (지금 또는 예약). 정책 확인 · 중복 확인을 통과해야 원장에 들어간다 */
export async function createPublication(
  db: Firestore,
  email: string,
  input: { projectId?: unknown; accountId?: unknown; renderId?: unknown; scheduledAt?: unknown },
): Promise<{ publicationId: string; jobId: string }> {
  const prep = await preparePublish(db, email, input);
  if (prep.problems.length) throw new AccessError(422, prep.problems.join(" "));
  if (prep.blockers.length) throw new AccessError(422, `게시 전 확인이 남았습니다: ${prep.blockers.map((b) => b.label).join(" · ")}`);
  const project = await getProject(db, email, input.projectId);
  const account = await getAccountForPublish(db, email, input.accountId);
  const render = await renderOf(db, project, input.renderId);
  const now = Date.now();
  const scheduledAt = typeof input.scheduledAt === "number" && input.scheduledAt > now + 60_000 ? input.scheduledAt : null;
  if (scheduledAt && scheduledAt > now + 60 * 86_400_000) throw new Error("예약은 60일 안으로만 잡을 수 있습니다.");
  const id = publicationKey(account.id, render.id, account.platform);
  const ref = col(db).doc(id);
  const doc: PublicationDoc = {
    owner: email,
    projectId: project.id,
    accountId: account.id,
    platform: account.platform,
    renderId: render.id,
    status: scheduledAt ? "scheduled" : "queued",
    scheduledAt,
    jobId: null,
    meta: {
      title: prep.title,
      caption: prep.caption,
      privacy: project.publish.privacy,
      madeForKids: project.publish.madeForKids,
      synthetic: project.publish.synthetic === true,
    },
    compliance: prep.checks,
    result: null,
    error: null,
    history: [{ at: now, status: scheduledAt ? "scheduled" : "queued", msg: scheduledAt ? `예약 ${new Date(scheduledAt).toISOString()}` : "게시 요청", by: email }],
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as PublicationDoc | undefined;
    if (prev) {
      // 확실히 실패했거나 취소된 것만 같은 원장에서 다시 — 나머지는 중복이다
      if (prev.status !== "failed" && prev.status !== "cancelled") {
        throw new AccessError(
          409,
          prev.status === "published"
            ? "이 완성 파일은 이미 이 계정에 게시됐습니다. 같은 영상을 다시 올리려면 새로 출력해 주세요."
            : prev.status === "uncertain"
              ? "이전 게시의 결과가 불확실합니다. 플랫폼에서 확인한 뒤 「게시됨 / 안 됨」 을 먼저 기록해 주세요."
              : "같은 계정 · 같은 파일의 게시가 이미 진행 중입니다.",
        );
      }
      tx.set(ref, { ...doc, createdAt: prev.createdAt, attempts: prev.attempts + 1, history: [...prev.history, ...doc.history].slice(-40) });
    } else {
      tx.create(ref, doc);
    }
  });
  const jobId = await enqueue(
    db,
    newJob(email, project.id, "publish", "server", { publicationId: id, platform: account.platform }, { step: "check", runAt: scheduledAt ?? now, dedupeKey: `publish_${id}` }),
  );
  await ref.update({ jobId });
  return { publicationId: id, jobId };
}

export async function cancelPublication(db: Firestore, email: string, id: unknown): Promise<void> {
  if (!isId(id)) throw new Error("게시 id 가 올바르지 않습니다.");
  const ref = col(db).doc(id);
  const p = (await ref.get()).data() as PublicationDoc | undefined;
  if (!p) throw new Error("게시 기록을 찾지 못했습니다.");
  await getProject(db, email, p.projectId);
  if (p.status !== "scheduled" && p.status !== "queued") throw new Error("전송을 시작한 게시는 취소할 수 없습니다.");
  const { requestCancel } = await import("./jobs");
  if (p.jobId) await requestCancel(db, email, p.jobId).catch(() => undefined);
  await ref.update({
    status: "cancelled",
    updatedAt: Date.now(),
    history: [...p.history, { at: Date.now(), status: "cancelled", msg: "보내기 전에 취소", by: email }].slice(-40),
  });
  // 다른 채널은 이미 게시됐고 이것만 남아 있었다면 이제 파일을 지운다
  await purgeAfterPublish(db, p.renderId).catch(() => false);
}

/** 결과가 불확실한 게시를 사람이 확인해 기록한다 */
export async function resolvePublication(
  db: Firestore,
  email: string,
  id: unknown,
  input: { outcome?: unknown; url?: unknown; externalId?: unknown },
): Promise<void> {
  if (!isId(id)) throw new Error("게시 id 가 올바르지 않습니다.");
  const ref = col(db).doc(id);
  const p = (await ref.get()).data() as PublicationDoc | undefined;
  if (!p) throw new Error("게시 기록을 찾지 못했습니다.");
  await getProject(db, email, p.projectId);
  if (p.status !== "uncertain") throw new Error("결과 확인이 필요한 게시가 아닙니다.");
  const now = Date.now();
  if (input.outcome === "published") {
    const url = String(input.url ?? "").trim();
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === "https:" && (p.platform === "youtube" ? /(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname) : /(^|\.)instagram\.com$/.test(u.hostname));
    } catch {
      ok = false;
    }
    if (!ok) throw new Error("플랫폼에서 확인한 게시물 주소를 넣어 주세요.");
    await ref.update({
      status: "published",
      result: { externalId: String(input.externalId ?? "").slice(0, 60), url, at: now, by: "manual" },
      updatedAt: now,
      history: [...p.history, { at: now, status: "published", msg: "사람이 플랫폼에서 게시를 확인함", by: email }].slice(-40),
    });
    await patchProject(db, p.projectId, email, (pr) => {
      pr.stage = "published";
    });
    await purgeAfterPublish(db, p.renderId).catch(() => false);
  } else if (input.outcome === "not_published") {
    await ref.update({
      status: "failed",
      error: { code: "CONFIRMED_NOT_PUBLISHED", message: "사람이 플랫폼에서 게시되지 않았음을 확인했습니다. 다시 시도할 수 있습니다." },
      updatedAt: now,
      history: [...p.history, { at: now, status: "failed", msg: "사람이 미게시를 확인함 → 다시 시도 가능", by: email }].slice(-40),
    });
  } else throw new Error("확인 결과를 골라 주세요.");
}

// ---- 실행기 단계 -------------------------------------------------------

async function setPub(db: Firestore, id: string, patch: Partial<PublicationDoc>, msg: string, by = "실행기") {
  const ref = col(db).doc(id);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data() as PublicationDoc | undefined;
    if (!p) return;
    const status = patch.status ?? p.status;
    tx.set(ref, { ...p, ...patch, updatedAt: Date.now(), history: [...p.history, { at: Date.now(), status, msg: msg.slice(0, 300), by }].slice(-40) });
  });
}

export interface StepResult {
  /** 작업 문서에 쓸 것 */
  patch: Partial<JobDoc> & { logMsg?: string };
  /** 같은 실행에서 바로 다음 단계를 이어도 되는가 */
  continue: boolean;
}

/**
 * 게시 작업 한 단계. 쓰기 단계는 시작 전에 stepState=writing 을 먼저 저장한다 —
 * 그 사이에 함수가 죽으면 정리기가 uncertain 으로 바꾼다.
 */
export async function runPublishStep(db: Firestore, jobId: string, workerId: string, job: JobDoc): Promise<StepResult> {
  const pubId = String(job.input.publicationId);
  const pub = (await col(db).doc(pubId).get()).data() as PublicationDoc | undefined;
  if (!pub) return { patch: { status: "failed", error: { code: "NO_PUBLICATION", message: "게시 기록이 지워졌습니다." }, logMsg: "게시 기록 없음" }, continue: false };

  const writing = async (msg: string) => {
    const ok = await persist(db, jobId, workerId, { stepState: "writing", logMsg: msg });
    if (!ok) throw new Error("LEASE_LOST");
  };

  try {
    if (job.cancelRequested && job.step === "check") {
      await setPub(db, pubId, { status: "cancelled" }, "보내기 전에 취소");
      return { patch: { status: "cancelled", logMsg: "보내기 전에 취소했습니다." }, continue: false };
    }
    const { account, accessToken } = await accountTokens(db, pub.accountId);

    if (job.step === "check") {
      if (pub.status === "cancelled") return { patch: { status: "cancelled", logMsg: "게시가 취소돼 있습니다." }, continue: false };
      if (pub.platform === "instagram") {
        const lim = await instagramPublishingLimit(accessToken, account.externalId);
        if (lim.total !== null && lim.used !== null && lim.used >= lim.total) {
          await setPub(db, pubId, { status: "failed", error: { code: "IG_LIMIT", message: `Instagram 24시간 게시 한도(${lim.total}건)에 닿았습니다.` } }, "게시 한도");
          return { patch: { status: "failed", error: { code: "IG_LIMIT", message: "Instagram 24시간 게시 한도에 닿았습니다. 나중에 다시 시도해 주세요." } }, continue: false };
        }
      }
      await setPub(db, pubId, { status: "uploading" }, "전송 시작");
      return { patch: { step: pub.platform === "youtube" ? "yt_session" : "ig_container", stepState: "idle", progress: { pct: 10, message: "전송 준비 완료" }, logMsg: "점검 통과" }, continue: true };
    }

    // yt_upload 는 예전 이름 (한 번에 보내던 때) — 남은 작업은 새 길로
    if (job.step === "yt_session" || job.step === "yt_upload") {
      const m = await sendable(db, pub.renderId);
      const session = await youtubeStartSession(accessToken, {
        mime: m.type,
        size: m.size,
        title: pub.meta.title,
        description: pub.meta.caption,
        privacy: pub.meta.privacy,
        madeForKids: pub.meta.madeForKids,
        containsSyntheticMedia: pub.meta.synthetic,
      });
      return {
        patch: {
          step: "yt_chunk",
          stepState: "idle",
          state: { ...job.state, ytSession: session, ytErrors: 0 },
          progress: { pct: 12, message: "YouTube 로 보내는 중 0%" },
          logMsg: `YouTube 업로드 세션 열림 (${mbOf(m.size)} · ${Math.max(1, Math.ceil(m.size / YT_CHUNK_BYTES))}번에 나눠 보냄)`,
        },
        continue: true,
      };
    }

    if (job.step === "yt_chunk") {
      const m = await sendable(db, pub.renderId);
      const session = String(job.state.ytSession ?? "");
      const errors = Number(job.state.ytErrors) || 0;
      try {
        // 늘 먼저 묻는다 — 지난 실행이 어디까지 보냈는지는 우리 기록보다 YouTube 가 정확하다
        let st = await youtubeUploadStatus(accessToken, session, m.size);
        if (!st.done) {
          const bytes = await readBytes(db, pub.renderId, m, st.offset, st.offset + YT_CHUNK_BYTES);
          st = await youtubePutChunk(accessToken, session, st.offset, bytes, m.size, m.type);
        }
        if (st.done) {
          await setPub(db, pubId, { status: "published", result: { externalId: st.id, url: st.url, at: Date.now(), by: "api" }, error: null }, `YouTube 업로드 완료 (${st.uploadStatus} · ${st.privacyStatus}). 처리 상태는 YouTube Studio 에서 확인`);
          await patchProject(db, pub.projectId, "실행기", (p) => {
            p.stage = "published";
          });
          const purged = await purgeAfterPublish(db, pub.renderId).catch(() => false);
          return {
            patch: { status: "succeeded", stepState: "idle", result: { externalId: st.id, url: st.url }, progress: { pct: 100, message: "게시됨" }, logMsg: `YouTube 영상 ${st.id}${purged ? " · 게시가 다 끝나 완성 파일을 지웠습니다" : ""}` },
            continue: false,
          };
        }
        const pct = Math.round((st.offset / m.size) * 100);
        return { patch: { state: { ...job.state, ytErrors: 0 }, progress: { pct: 12 + Math.round(pct * 0.85), message: `YouTube 로 보내는 중 ${pct}%` }, logMsg: `${mbOf(st.offset)} / ${mbOf(m.size)} 보냄` }, continue: true };
      } catch (e) {
        // 확실한 거절(세션 만료 · 권한 · 영상 거절 · 결과 불명)이 아니면 잠시 뒤 다시 묻는다 — 두 번 올라가지 않는다
        const retry = !(e instanceof PublishingError) || e.code === YT_RETRY;
        if (!retry) throw e;
        if (errors >= 8) {
          const message = "YouTube 에 계속 연결되지 않아 끝까지 갔는지 알 수 없습니다. YouTube Studio 에서 확인한 뒤 결과를 기록해 주세요.";
          await setPub(db, pubId, { status: "uncertain", error: { code: "YOUTUBE_UNREACHABLE", message } }, message);
          return { patch: { status: "uncertain", stepState: "idle", error: { code: "YOUTUBE_UNREACHABLE", message }, logMsg: message }, continue: false };
        }
        const wait = Math.min(300_000, 20_000 * 2 ** errors);
        return {
          patch: { status: "waiting", stepState: "idle", runAt: Date.now() + wait, state: { ...job.state, ytErrors: errors + 1 }, logMsg: `${e instanceof Error ? e.message : "전송 오류"} — ${Math.round(wait / 1000)}초 뒤 받은 곳부터 이어 보냄` },
          continue: false,
        };
      }
    }

    if (job.step === "ig_container") {
      const m = await sendable(db, pub.renderId);
      // 버킷 파일 — Meta 가 서명 URL 에서 직접 가져간다 (rupload 를 거치지 않아 큰 파일도 서버 시간에 안 걸린다)
      const videoUrl = await publishUrl(m);
      await writing("Instagram 컨테이너 만들기 (쓰기)");
      const c = await instagramCreateContainer(accessToken, account.externalId, { caption: pub.meta.caption, isAiGenerated: pub.meta.synthetic, ...(videoUrl ? { videoUrl } : {}) });
      if (videoUrl) {
        await setPub(db, pubId, { status: "processing" }, "Instagram 이 저장소에서 파일을 가져가는 중");
        return {
          patch: { step: "ig_wait", stepState: "idle", status: "waiting", state: { ...job.state, containerId: c.containerId }, runAt: Date.now() + 30_000, progress: { pct: 50, message: "Instagram 처리 중" }, logMsg: `컨테이너 ${c.containerId} (Instagram 이 주소로 가져감)` },
          continue: false,
        };
      }
      return { patch: { step: "ig_upload", stepState: "idle", state: { ...job.state, containerId: c.containerId, uploadUri: c.uploadUri }, progress: { pct: 25, message: "파일 전송 준비" }, logMsg: `컨테이너 ${c.containerId}` }, continue: true };
    }

    if (job.step === "ig_upload") {
      const { doc, bytes } = await readWhole(db, pub.renderId);
      await writing("Instagram 파일 전송 (쓰기)");
      await instagramUploadBytes(accessToken, String(job.state.uploadUri), bytes, doc.type);
      await setPub(db, pubId, { status: "processing" }, "파일 전송 완료 · Instagram 처리 대기");
      return { patch: { step: "ig_wait", stepState: "idle", status: "waiting", runAt: Date.now() + 30_000, progress: { pct: 50, message: "Instagram 처리 중" }, logMsg: "파일 전송 완료" }, continue: false };
    }

    if (job.step === "ig_wait") {
      const st = await instagramContainerStatus(accessToken, String(job.state.containerId));
      if (st === "IN_PROGRESS") {
        const waited = Date.now() - job.createdAt;
        return { patch: { status: "waiting", runAt: Date.now() + (waited > 10 * 60_000 ? 300_000 : 60_000), progress: { pct: 60, message: "Instagram 처리 중" } }, continue: false };
      }
      if (st === "FINISHED") return { patch: { step: "ig_publish", progress: { pct: 80, message: "게시 직전" }, logMsg: "처리 완료" }, continue: true };
      if (st === "PUBLISHED") {
        // 다른 경로로 이미 게시됨 — 다시 게시하지 않는다
        await setPub(db, pubId, { status: "uncertain", error: { code: "IG_ALREADY_PUBLISHED", message: "컨테이너가 이미 게시 상태입니다. 계정에서 확인해 주세요." } }, "이미 게시된 컨테이너");
        return { patch: { status: "uncertain", error: { code: "IG_ALREADY_PUBLISHED", message: "컨테이너가 이미 게시 상태입니다." } }, continue: false };
      }
      await setPub(db, pubId, { status: "failed", error: { code: `IG_${st}`, message: "Instagram 영상 처리가 실패했거나 만료됐습니다. 파일 형식을 확인해 주세요." } }, `처리 ${st}`);
      return { patch: { status: "failed", error: { code: `IG_${st}`, message: "Instagram 영상 처리 실패" } }, continue: false };
    }

    if (job.step === "ig_publish") {
      await writing("Instagram 게시 (쓰기)");
      const r = await instagramPublish(accessToken, account.externalId, String(job.state.containerId));
      const url = await instagramPermalink(accessToken, r.id);
      await setPub(db, pubId, { status: "published", result: { externalId: r.id, url, at: Date.now(), by: "api" }, error: null }, "Instagram 게시 완료");
      await patchProject(db, pub.projectId, "실행기", (p) => {
        p.stage = "published";
      });
      const purged = await purgeAfterPublish(db, pub.renderId).catch(() => false);
      return { patch: { status: "succeeded", stepState: "idle", result: { externalId: r.id, url }, progress: { pct: 100, message: "게시됨" }, logMsg: `Instagram 미디어 ${r.id}${purged ? " · 게시가 다 끝나 완성 파일을 지웠습니다" : ""}` }, continue: false };
    }

    return { patch: { status: "failed", error: { code: "UNKNOWN_STEP", message: `알 수 없는 단계 ${job.step}` } }, continue: false };
  } catch (e) {
    if (e instanceof Error && e.message === "LEASE_LOST") return { patch: {}, continue: false };
    const err = e instanceof PublishingError ? e : null;
    const message = e instanceof Error ? e.message : "게시 중 오류";
    if (err?.status === 401) await markNeedsReauth(db, pub.accountId);
    // 쓰기 도중의 불확실한 오류 — 다시 하지 않는다
    const current = (await db.collection(NEANDER_COL.shortsJobs).doc(jobId).get()).data() as JobDoc | undefined;
    const uncertain = err?.uncertain === true || (current?.stepState === "writing" && !err);
    if (uncertain) {
      await setPub(db, pubId, { status: "uncertain", error: { code: err?.code ?? "UNCERTAIN", message } }, `결과 불확실: ${message}`);
      return { patch: { status: "uncertain", stepState: "idle", error: { code: err?.code ?? "UNCERTAIN", message }, logMsg: message }, continue: false };
    }
    // 읽기 단계의 일시 오류 (Instagram 처리 상태 확인 등)는 몇 번 다시 본다
    if ((job.step === "ig_wait" || job.step === "check") && job.attempts < 5 && (!err || err.status >= 500 || err.status === 429)) {
      return { patch: { status: "waiting", stepState: "idle", runAt: Date.now() + 120_000, logMsg: `일시 오류 — 2분 뒤 다시 확인: ${message}` }, continue: false };
    }
    await setPub(db, pubId, { status: "failed", error: { code: err?.code ?? "FAILED", message } }, `실패: ${message}`);
    return { patch: { status: "failed", stepState: "idle", error: { code: err?.code ?? "FAILED", message }, logMsg: message }, continue: false };
  }
}

/** 정리기가 작업을 uncertain 으로 바꿨을 때 원장도 맞춘다 */
export async function syncPublicationFromJob(db: Firestore, job: JobDoc) {
  if (job.kind !== "publish") return;
  const pubId = String(job.input.publicationId);
  if (job.status === "uncertain") {
    await setPub(db, pubId, { status: "uncertain", error: job.error }, job.error?.message ?? "결과 불확실");
  } else if (job.status === "queued") {
    // 읽기 단계에서 끊겨 다시 대기 — 원장은 그대로
  }
}
