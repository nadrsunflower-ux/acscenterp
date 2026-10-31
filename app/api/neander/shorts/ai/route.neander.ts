import { adminDb } from "@/lib/neander/server/admin";
import { newId } from "@/lib/neander/shorts/model";
import { requireShortsUser } from "@/lib/neander/shorts/server/access";
import { analyzeReference, chineseTerms, generateScript } from "@/lib/neander/shorts/server/ai";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { addVersion, getProject, listTemplates, patchProject } from "@/lib/neander/shorts/server/store";
import { getClientDoc } from "@/lib/neander/shorts/server/clients";
import type { CostEntry, Scene, ScriptLine } from "@/lib/neander/shorts/types";

// 쇼츠 AI (글) — 구성 분석 · 대본 · 중국어 검색어. 결과는 프로젝트에 바로 적고, 바뀌기 전 모습을 버전으로 남긴다.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const cost = (kind: CostEntry["kind"], usd: number, note: string, by: string): CostEntry => ({
  id: newId("cost_"),
  kind,
  krw: null,
  usd: usd || null,
  minutes: null,
  note,
  at: Date.now(),
  by,
  auto: true,
});

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Record<string, unknown>;
    const p = await getProject(db, email, b.projectId);

    if (b.action === "analyze") {
      const r = await analyzeReference({
        model: b.model,
        product: p.product,
        transcript: p.reference.transcript,
        timing: p.reference.timing,
        refs: p.reference.url ? [{ url: p.reference.url, title: p.reference.title }] : [],
      });
      if (p.analysis) await addVersion(db, p.id, "analysis", p.analysis, email, "AI 분석 전 모습");
      const saved = await patchProject(db, p.id, email, (pp) => {
        pp.analysis = r.analysis;
        if (!pp.cta.wording && r.analysis.cta.wording) pp.cta = r.analysis.cta;
        pp.costs.push(cost("ai_text", r.costUsd, `구성 분석 ${r.model}`, email));
      });
      await addVersion(db, p.id, "analysis", r.analysis, email, `AI 분석 (${r.model})`);
      return json({ project: { ...saved, id: p.id }, costUsd: r.costUsd });
    }

    if (b.action === "script") {
      const templates = await listTemplates(db, email);
      const t = p.templateId ? templates.find((x) => x.id === p.templateId) ?? null : null;
      const client = p.kind === "brand" && p.clientId ? await getClientDoc(db, p.clientId) : null;
      const r = await generateScript({
        model: b.model,
        product: p.product,
        problem: String(b.problem ?? "").slice(0, 500),
        facts: p.facts,
        mode: p.mode,
        targetSec: Math.min(90, Math.max(10, Number(b.targetSec) || t?.totalSec || 30)),
        template: t
          ? { beats: t.beats, hookPattern: t.hookPattern, cta: t.cta, narrationSubtitle: t.narrationSubtitle, avgShotSec: t.avgShotSec, productRevealRatio: t.productRevealRatio }
          : null,
        sources: p.sources.map((s) => ({ title: s.title || s.url, segments: s.segments.map((g) => ({ purpose: g.purpose, start: g.start, end: g.end, note: g.note })) })),
        ctaKeyword: p.cta.keyword,
        brand: client
          ? { name: client.name, summary: client.brief.summary, target: client.brief.target, tone: client.brief.tone, keyMessages: client.brief.keyMessages, mustInclude: client.brief.mustInclude, banned: client.brief.banned }
          : null,
        general: p.kind === "general",
      });
      if (p.script.lines.length) await addVersion(db, p.id, "script", { script: p.script, scenes: p.scenes }, email, "AI 대본 전 모습");
      const scenes: Scene[] = r.draft.scenes.map((s) => ({
        id: newId("sc_"),
        kind: s.kind === "ai" ? "ai" : s.kind === "image" ? "image" : "clip",
        label: s.label.slice(0, 100),
        duration: Math.min(30, Math.max(0.5, Number(s.durationSec) || 3)),
        clip: null,
        ai: s.kind === "ai" ? { prompt: s.aiPrompt.slice(0, 4000), status: "draft", jobId: null, fileId: null, model: null, reviewNote: "" } : null,
        image: null,
        keepAudio: false,
      }));
      // clip 장면은 파일이 붙기 전까지 빈 장면으로 둔다 (출력 막기가 알려 준다)
      for (const s of scenes) if (s.kind === "clip") s.kind = "blank";
      const lines: ScriptLine[] = r.draft.lines.map((l) => ({
        id: newId("ln_"),
        beat: l.beat,
        text: l.text.slice(0, 400),
        caption: l.caption.slice(0, 200),
        sceneId: scenes[l.scene]?.id ?? null,
      }));
      const saved = await patchProject(db, p.id, email, (pp) => {
        pp.script = { lines };
        pp.scenes = scenes.map((s, i) => ({ ...s, label: s.label || `장면 ${i + 1}` }));
        pp.subtitles = { cues: [], edited: false };
        pp.publish = {
          ...pp.publish,
          title: pp.publish.title || r.draft.title.slice(0, 100),
          description: pp.publish.description || r.draft.description.slice(0, 4500),
          hashtags: pp.publish.hashtags.length ? pp.publish.hashtags : r.draft.hashtags.slice(0, 15),
        };
        pp.cta = { ...r.draft.cta, keyword: pp.cta.keyword || r.draft.cta.keyword };
        if (pp.stage === "research" || pp.stage === "sourcing" || pp.stage === "matching") pp.stage = "scripting";
        pp.costs.push(cost("ai_text", r.costUsd, `대본·스토리보드 ${r.model}`, email));
      });
      await addVersion(db, p.id, "script", { script: { lines }, scenes, hints: r.draft.scenes.map((s) => s.sourceHint) }, email, `AI 대본 (${r.model})`);
      return json({ project: { ...saved, id: p.id }, costUsd: r.costUsd, hints: r.draft.scenes.map((s) => s.sourceHint) });
    }

    if (b.action === "chinese") {
      const r = await chineseTerms({ model: b.model, product: p.product, category: p.category, facts: p.facts });
      const saved = await patchProject(db, p.id, email, (pp) => {
        const have = new Set(pp.chinese.terms.map((t) => t.text));
        for (const t of r.terms) if (t.text.trim() && !have.has(t.text.trim())) pp.chinese.terms.push({ id: newId("zh_"), text: t.text.trim().slice(0, 60), kind: t.kind, meaning: t.meaning.slice(0, 120), by: "ai" });
        pp.chinese.generatedAt = Date.now();
        pp.costs.push(cost("ai_text", r.costUsd, `중국어 검색어 ${r.model}`, email));
      });
      return json({ project: { ...saved, id: p.id }, costUsd: r.costUsd });
    }
    throw new Error("알 수 없는 동작입니다.");
  } catch (e) {
    return fail(e);
  }
}
