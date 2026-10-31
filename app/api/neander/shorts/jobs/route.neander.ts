import { adminDb } from "@/lib/neander/server/admin";
import { scriptHash } from "@/lib/neander/shorts/model";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { estimateTtsUsd, estimateVideoUsd, openrouterConfigured, TTS_MODELS, VIDEO_MODELS } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { enqueue, getJob, listJobs, newJob, requestCancel, startBrowserRender, toView, updateBrowserRender } from "@/lib/neander/shorts/server/jobs";
import { tick } from "@/lib/neander/shorts/server/runner";
import { getProject, patchProject } from "@/lib/neander/shorts/server/store";

// 작업 큐 — 만들기 · 취소 · 진행 · 실행기 한 바퀴(tick)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
    return json({ jobs: await listJobs(adminDb(), email, projectId, !!projectId && isShortsAdmin(email)) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Record<string, unknown>;
    switch (b.action) {
      case "tick": {
        // 열린 화면이 부르는 실행기 — 예산 40초. 남의 작업도 진행하지만 내용은 돌려주지 않는다
        const r = await tick(db, { budgetMs: 40_000, max: 3 });
        return json({ ran: r.ran, next: r.next, jobs: await listJobs(db, email) });
      }
      case "cancel":
        return json({ job: await requestCancel(db, email, b.id) });
      case "get": {
        const j = await getJob(db, String(b.id));
        if (!j) throw new Error("작업을 찾지 못했습니다.");
        await getProject(db, email, j.projectId);
        return json({ job: toView(String(b.id), j) });
      }

      case "render.start":
        return json({ id: await startBrowserRender(db, email, String(b.projectId), String(b.specHash ?? ""), String(b.sessionId ?? "")) });
      case "render.update": {
        const job = await updateBrowserRender(db, email, b.id, String(b.sessionId ?? ""), {
          pct: typeof b.pct === "number" ? b.pct : undefined,
          message: typeof b.message === "string" ? b.message : undefined,
          done: b.mediaId ? { mediaId: String(b.mediaId) } : undefined,
          error: typeof b.error === "string" ? b.error : undefined,
        });
        if (job.status === "succeeded" && b.mediaId) {
          const mediaId = String(b.mediaId);
          await patchProject(db, job.projectId, email, (p) => {
            if (!p.renderIds.includes(mediaId)) p.renderIds.push(mediaId);
            if (["research", "sourcing", "matching", "scripting", "editing"].includes(p.stage)) p.stage = "ready";
          });
        }
        return json({ job });
      }

      case "video.start": {
        if (!openrouterConfigured()) throw new Error("OPENROUTER_API_KEY 가 없어 AI 영상을 만들 수 없습니다.");
        if (b.confirmed !== true) throw new Error("예상 비용을 확인한 뒤 시작해 주세요.");
        const p = await getProject(db, email, b.projectId);
        const scene = p.scenes.find((s) => s.id === b.sceneId);
        if (!scene || scene.kind !== "ai" || !scene.ai) throw new Error("AI 장면을 골라 주세요.");
        if (!scene.ai.prompt.trim()) throw new Error("장면 프롬프트를 먼저 적어 주세요.");
        const model = VIDEO_MODELS.find((m) => m.id === b.model) ?? VIDEO_MODELS[0];
        const duration = Number(b.duration);
        const resolution = String(b.resolution ?? model.resolutions[0]);
        const estUsd = estimateVideoUsd(model.id, duration, resolution);
        const id = await enqueue(
          db,
          newJob(email, p.id, "ai_video", "server", { sceneId: scene.id, prompt: scene.ai.prompt, model: model.id, duration, resolution, estUsd }, { step: "submit", dedupeKey: `video_${p.id}_${scene.id}` }),
        );
        await patchProject(db, p.id, email, (pp) => {
          const s = pp.scenes.find((x) => x.id === scene.id);
          if (s?.ai) {
            s.ai.status = "generating";
            s.ai.jobId = id;
          }
        });
        return json({ id, estUsd });
      }

      case "tts.start": {
        if (!openrouterConfigured()) throw new Error("OPENROUTER_API_KEY 가 없어 AI 음성을 만들 수 없습니다.");
        if (b.confirmed !== true) throw new Error("예상 비용을 확인한 뒤 시작해 주세요.");
        const p = await getProject(db, email, b.projectId);
        const lines = p.script.lines.filter((l) => l.text.trim()).map((l) => ({ lineId: l.id, text: l.text.trim() }));
        if (!lines.length) throw new Error("읽을 대본이 없습니다.");
        const chars = lines.reduce((n, l) => n + l.text.length, 0);
        if (chars > 4000) throw new Error("내레이션은 4,000자 이하로 줄여 주세요.");
        const model = TTS_MODELS.find((m) => m.id === b.model) ?? TTS_MODELS[0];
        const voice = model.voices.find((v) => v.id === b.voice)?.id ?? model.voices[0].id;
        const id = await enqueue(
          db,
          newJob(
            email,
            p.id,
            "tts",
            "server",
            {
              model: model.id,
              voice,
              speed: Math.min(1.5, Math.max(0.7, Number(b.speed) || 1)),
              gapSec: Math.min(1, Math.max(0, Number(b.gapSec) || 0.15)),
              lines,
              hash: scriptHash(p.script.lines),
            },
            { step: "synthesize", dedupeKey: `tts_${p.id}` },
          ),
        );
        return json({ id, estUsd: estimateTtsUsd(model.id, chars) });
      }
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
