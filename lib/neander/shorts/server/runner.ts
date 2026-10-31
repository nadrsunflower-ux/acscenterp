import "server-only";

// ============================================================
//  쇼핑쇼츠 실행기 — 때가 된 작업을 한 단계씩 진행한다
// ------------------------------------------------------------
//  tick() 한 번은 시간 예산(budgetMs) 안에서만 돈다. 예산이 끝나면 다음
//  tick 에 맡긴다. 같은 작업을 두 실행기가 잡지 않는다 (jobs.claimDue 의 임대).
//
//  작업 종류별 단계:
//   ai_video  submit(쓰기·유료) → poll(읽기, 30초마다) → download(읽기) → 장면에 붙임
//   tts       줄마다 synthesize(유료, 작음) → 끝나면 내레이션 · 자막 갱신
//   publish   publishing.ts 의 runPublishStep
//
//  유료 쓰기는 자동으로 다시 하지 않는다. 영상 생성 요청의 응답을 못 받으면
//  uncertain — 사람이 OpenRouter 사용 내역을 보고 판단한다.
// ============================================================

import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { NEANDER_COL } from "@/lib/neander/collections";
import { cuesFromSegments, newId, scriptHash } from "../model";
import type { CostEntry, JobDoc, ProjectDoc } from "../types";
import { downloadVideo, pollVideo, ProviderWriteError, submitVideo, synthesizeSpeech } from "./ai";
import { claimDue, persist, reapExpired } from "./jobs";
import { saveBytes } from "./media";
import { runPublishStep, syncPublicationFromJob, type StepResult } from "./publishing";
import { patchProject } from "./store";

/** 미디어 길이 (초) — 서버에서 mediabunny 로 머리말만 읽는다 */
export async function mediaDuration(bytes: Uint8Array): Promise<number | null> {
  try {
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const d = await input.computeDuration();
    input.dispose();
    return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

const autoCost = (kind: CostEntry["kind"], usd: number | null, note: string): CostEntry => ({
  id: newId("cost_"),
  kind,
  krw: null,
  usd,
  minutes: null,
  note,
  at: Date.now(),
  by: "실행기",
  auto: true,
});

async function runVideoStep(db: Firestore, jobId: string, workerId: string, job: JobDoc): Promise<StepResult> {
  const input = job.input as { sceneId: string; prompt: string; model: string; duration: number; resolution: string; estUsd: number | null };
  const setScene = (fn: (s: NonNullable<ProjectDoc["scenes"][number]["ai"]>) => void) =>
    patchProject(db, job.projectId, "실행기", (p) => {
      const s = p.scenes.find((x) => x.id === input.sceneId);
      if (s?.ai) fn(s.ai);
    });

  if (job.step === "submit") {
    if (job.cancelRequested) {
      await setScene((ai) => {
        ai.status = "draft";
        ai.jobId = null;
      });
      return { patch: { status: "cancelled", logMsg: "생성 요청을 보내기 전에 취소했습니다 (비용 없음)." }, continue: false };
    }
    const ok = await persist(db, jobId, workerId, { stepState: "writing", logMsg: "영상 생성 요청 (유료 · 되돌릴 수 없음)" });
    if (!ok) return { patch: {}, continue: false };
    try {
      const r = await submitVideo(input);
      return {
        patch: { step: "poll", stepState: "idle", status: "waiting", runAt: Date.now() + 30_000, state: { providerJobId: r.id }, progress: { pct: 15, message: "제공사가 만드는 중" }, logMsg: `제공사 작업 ${r.id}` },
        continue: false,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "영상 생성 요청 실패";
      const uncertain = e instanceof ProviderWriteError && e.uncertain;
      await setScene((ai) => {
        ai.status = "failed";
      });
      return { patch: { status: uncertain ? "uncertain" : "failed", stepState: "idle", error: { code: uncertain ? "SUBMIT_UNCERTAIN" : "SUBMIT_FAILED", message: msg }, logMsg: msg }, continue: false };
    }
  }

  const providerId = String(job.state.providerJobId ?? "");
  if (job.step === "poll") {
    if (job.cancelRequested) {
      await setScene((ai) => {
        ai.status = "draft";
        ai.jobId = null;
      });
      return {
        patch: { status: "cancelled", logMsg: "취소했습니다. 제공사는 이미 받은 생성 요청을 계속 처리할 수 있고 비용이 청구될 수 있습니다." },
        continue: false,
      };
    }
    let r;
    try {
      r = await pollVideo(providerId);
    } catch (e) {
      if (job.attempts < 20) return { patch: { status: "waiting", runAt: Date.now() + 60_000, logMsg: `상태 확인 실패 — 1분 뒤 다시: ${e instanceof Error ? e.message : ""}` }, continue: false };
      throw e;
    }
    if (r.status === "pending" || r.status === "in_progress") {
      const elapsed = Date.now() - job.createdAt;
      return { patch: { status: "waiting", runAt: Date.now() + (elapsed > 10 * 60_000 ? 60_000 : 30_000), progress: { pct: Math.min(80, 15 + Math.round(elapsed / 12_000)), message: "제공사가 만드는 중" } }, continue: false };
    }
    if (r.status === "completed") return { patch: { step: "download", state: { ...job.state, costUsd: r.costUsd }, progress: { pct: 85, message: "결과 받는 중" }, logMsg: "생성 완료" }, continue: true };
    await setScene((ai) => {
      ai.status = "failed";
    });
    return { patch: { status: "failed", error: { code: `PROVIDER_${r.status.toUpperCase()}`, message: `제공사 생성이 끝나지 못했습니다 (${r.status})${r.error ? `: ${r.error}` : ""}` } }, continue: false };
  }

  if (job.step === "download") {
    const { bytes, mime } = await downloadVideo(providerId);
    const duration = await mediaDuration(bytes);
    const media = await saveBytes(
      db,
      job.owner,
      { projectId: job.projectId, kind: "ai_scene", name: `AI 장면 ${input.model.split("/")[1] ?? ""}.mp4`, type: mime, duration, width: null, height: null, origin: { jobId, model: input.model }, codecs: null, overlay: null },
      bytes,
    );
    const cost = typeof job.state.costUsd === "number" ? (job.state.costUsd as number) : input.estUsd;
    await patchProject(db, job.projectId, "실행기", (p) => {
      const s = p.scenes.find((x) => x.id === input.sceneId);
      if (s?.ai) {
        s.ai.fileId = media.id;
        // 실제 제품과 다를 수 있다 — 사람이 검토해 승인해야 출력에 쓴다
        s.ai.status = "review";
        s.ai.model = input.model;
        if (duration) s.duration = Math.round(Math.min(duration, s.duration > 0 ? Math.max(s.duration, 0.5) : duration) * 1000) / 1000;
      }
      p.costs.push(autoCost("ai_video", cost, `AI 영상 ${input.model} ${input.duration}초${typeof job.state.costUsd === "number" ? "" : " (추정)"}`));
    });
    return { patch: { status: "succeeded", result: { mediaId: media.id }, progress: { pct: 100, message: "검토를 기다리는 중" }, logMsg: "결과를 저장했습니다 — 사람이 검토해야 출력에 쓰입니다." }, continue: false };
  }
  return { patch: { status: "failed", error: { code: "UNKNOWN_STEP", message: job.step } }, continue: false };
}

async function runTtsStep(db: Firestore, jobId: string, workerId: string, job: JobDoc, deadline: number): Promise<StepResult> {
  const input = job.input as { model: string; voice: string; speed: number; gapSec: number; lines: { lineId: string; text: string }[]; hash: string };
  const done = (job.state.segments as { lineId: string; fileId: string; duration: number }[] | undefined) ?? [];
  let usd = Number(job.state.usd) || 0;
  const segs = [...done];
  for (const line of input.lines.slice(segs.length)) {
    if (Date.now() > deadline) break;
    if (await (async () => ((await db.collection(NEANDER_COL.shortsJobs).doc(jobId).get()).data() as JobDoc | undefined)?.cancelRequested)()) {
      return { patch: { status: "cancelled", state: { ...job.state, segments: segs, usd }, logMsg: `취소 — ${segs.length}/${input.lines.length}줄까지 만들었습니다.` }, continue: false };
    }
    const r = await synthesizeSpeech({ model: input.model, voice: input.voice, text: line.text, speed: input.speed });
    const duration = (await mediaDuration(r.bytes)) ?? Math.max(0.5, line.text.length * 0.12);
    const media = await saveBytes(
      db,
      job.owner,
      { projectId: job.projectId, kind: "voice", name: `음성 ${segs.length + 1}.mp3`, type: r.mime, duration, width: null, height: null, origin: { jobId, model: input.model }, codecs: null, overlay: null },
      r.bytes,
    );
    segs.push({ lineId: line.lineId, fileId: media.id, duration });
    usd += r.estUsd ?? 0;
    const ok = await persist(db, jobId, workerId, {
      state: { ...job.state, segments: segs, usd },
      progress: { pct: Math.round((segs.length / input.lines.length) * 95), message: `${segs.length}/${input.lines.length}줄` },
    });
    if (!ok) return { patch: {}, continue: false };
  }
  if (segs.length < input.lines.length) {
    return { patch: { status: "queued", runAt: Date.now(), state: { ...job.state, segments: segs, usd }, logMsg: `${segs.length}/${input.lines.length}줄 — 이어서 합니다.` }, continue: false };
  }
  await patchProject(db, job.projectId, "실행기", (p) => {
    p.narration = { kind: "ai", fileId: null, duration: null, voice: input.voice, model: input.model, segments: segs, gapSec: input.gapSec, scriptHash: input.hash };
    // 사람이 고친 자막이 있으면 덮지 않는다
    if (!p.subtitles.edited) p.subtitles = { cues: cuesFromSegments(p.script.lines, segs, input.gapSec), edited: false };
    p.costs.push(autoCost("ai_voice", Math.round(usd * 10000) / 10000, `AI 음성 ${input.model} ${input.lines.length}줄 (글자 수 기준 추정)`));
  });
  return { patch: { status: "succeeded", result: { segments: segs.length }, progress: { pct: 100, message: "완료" }, logMsg: "내레이션과 자막을 갱신했습니다." }, continue: false };
}

/**
 * 실행기 한 바퀴. 끝난 · 남은 작업 수와 다음 확인 시각을 돌려준다.
 */
export async function tick(db: Firestore, opts: { budgetMs?: number; max?: number } = {}): Promise<{ ran: number; reaped: number; next: number | null }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const deadline = started + budget;
  const workerId = randomBytes(8).toString("hex");
  const reaped = await reapExpired(db);
  for (const r of reaped) await syncPublicationFromJob(db, r.job);
  const claimed = await claimDue(db, workerId, opts.max ?? 3);
  let ran = 0;
  for (const { id, job: first } of claimed) {
    let job = first;
    for (let guard = 0; guard < 8; guard++) {
      if (Date.now() > deadline) {
        // 예산 끝 — 임대를 풀어 다음 실행기가 이어 받게
        await persist(db, id, workerId, { status: "queued", runAt: Date.now(), logMsg: "시간 예산이 끝나 다음 실행에 넘깁니다." });
        break;
      }
      let res: StepResult;
      try {
        if (job.kind === "publish") res = await runPublishStep(db, id, workerId, job);
        else if (job.kind === "ai_video") res = await runVideoStep(db, id, workerId, job);
        else if (job.kind === "tts") res = await runTtsStep(db, id, workerId, job, deadline - 5_000);
        else res = { patch: { status: "failed", error: { code: "UNSUPPORTED", message: `${job.kind} 는 서버 실행기가 하지 않습니다.` } }, continue: false };
      } catch (e) {
        const message = e instanceof Error ? e.message : "작업 중 오류";
        // TTS 는 줄 단위로 저장하므로 몇 번까지는 남은 줄부터 다시 한다 (비용이 작다)
        const retry = job.kind === "tts" && job.attempts < 3;
        res = { patch: retry ? { status: "queued", runAt: Date.now() + 30_000, logMsg: `오류 — 30초 뒤 남은 줄부터: ${message}` } : { status: "failed", stepState: "idle", error: { code: "STEP_FAILED", message }, logMsg: message }, continue: false };
      }
      if (!Object.keys(res.patch).length) break; // 임대를 잃음
      const saved = await persist(db, id, workerId, { ...res.patch, ...(res.continue ? { status: "running" } : {}) });
      ran++;
      if (!saved || !res.continue) break;
      job = saved;
    }
  }
  // 다음으로 확인할 시각 — 화면 실행기가 그때 다시 부른다
  const active = await db.collection(NEANDER_COL.shortsJobs).where("status", "in", ["queued", "waiting", "running"]).get();
  const times = active.docs.map((d) => d.data() as JobDoc).filter((j) => j.runner === "server").map((j) => (j.status === "running" ? j.leaseUntil : j.runAt));
  return { ran, reaped: reaped.length, next: times.length ? Math.min(...times) : null };
}

export { scriptHash };
