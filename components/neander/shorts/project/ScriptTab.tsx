"use client";

// ============================================================
//  공식·대본 탭 — 잘된 영상의 구성을 뽑아 다른 상품에 옮긴다
// ------------------------------------------------------------
//   참고 자료(붙여 넣은 대본 · 사람이 적은 장면 시각) → 구성 분석 → 성공 공식(템플릿)
//   → 새 대본 · 스토리보드 → 줄마다 장면 연결 → 버전 기록
//
//  URL 은 읽지 않는다. 분석의 근거는 화면에 그대로 적는다 — 「붙여 넣은 대본」 ·
//  「사람이 적은 장면 시각」 · 「URL 미열람」. 대본만 붙여 넣었으면 시각 칸은 비어 있다.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileText, History, Plus, Save, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { BLUE_RAMP, Badge, Button, Card, Dialog, EmptyState, Field, FormRow, IconButton, InlineNotice, Input, NumberInput, SectionHeader, Select, Table, TableScroll, Td, Textarea, Th, Tr, useConfirm } from "@/components/neander/ui";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { BEAT_LABEL, CTA_LABEL, draftFromTemplate, emptyAnalysis, emptyBeat, fmtSec, newId, parseTimingNotes, scanClaims } from "@/lib/neander/shorts/model";
import { FIN_AI_MODELS, DEFAULT_FIN_AI_MODEL } from "@/lib/neander/ai/models";
import type { BeatKey, CtaType, FormulaAnalysis, ProjectDoc, TemplateDoc, VersionDoc } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { fmtUsd, fmtWhen, useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

const BEAT_KEYS = Object.keys(BEAT_LABEL) as BeatKey[];

export function ScriptTab({ draft }: { draft: Draft }) {
  const { p, update, flush, replace } = draft;
  const { data, refresh } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const [model, setModel] = useState(DEFAULT_FIN_AI_MODEL);
  const [targetSec, setTargetSec] = useState(30);
  const [problem, setProblem] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const ask = useConfirm();
  const aiReady = d.status.openrouter.configured;
  const template = d.templates.find((t) => t.id === p.templateId) ?? null;
  const a = p.analysis;
  const flags = useMemo(() => scanClaims(p.script.lines.map((l) => `${l.text}\n${l.caption}`).join("\n"), p.facts), [p.script.lines, p.facts]);
  // 줄마다 화면 시각 — 자막 시각이 있으면 그것, 없으면 연결한 장면의 타임라인 위치
  const lineTimes = useMemo(() => {
    const scenes = new Map<string, { start: number; end: number }>();
    let t = 0;
    for (const sc of p.scenes) {
      scenes.set(sc.id, { start: t, end: t + Math.max(0, sc.duration) });
      t += Math.max(0, sc.duration);
    }
    const cues = new Map(p.subtitles.cues.filter((c) => c.lineId).map((c) => [c.lineId as string, c]));
    return new Map(
      p.script.lines.map((l) => {
        const cue = cues.get(l.id);
        if (cue) return [l.id, { start: cue.start, end: cue.end, by: "자막 시각" }] as const;
        const sc = l.sceneId ? scenes.get(l.sceneId) : undefined;
        return [l.id, sc ? { ...sc, by: "연결한 장면의 타임라인 위치" } : null] as const;
      }),
    );
  }, [p.scenes, p.subtitles.cues, p.script.lines]);

  const ai = (action: "analyze" | "script", body: object, ok: string) =>
    run(action, async () => {
      await flush();
      const r = await shortsPost<{ project: WithId<ProjectDoc>; costUsd: number }>("ai", { action, projectId: p.id, model, ...body });
      replace({ ...r.project, id: p.id });
      return r;
    }, ok);

  const addLine = () => update((x) => void x.script.lines.push({ id: newId("ln_"), beat: "demo", text: "", caption: "", sceneId: null }));

  return (
    <div className="space-y-10">
      {/* ---- 참고 자료 ---- */}
      <section>
        <SectionHeader size="lg" title="참고 자료" hint="잘된 쇼츠의 대본과 장면 시각" action={<Button size="sm" variant="secondary" icon={History} onClick={() => setHistoryOpen(true)}>버전 기록</Button>} />
        <Card className="space-y-4">
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="참고 영상 URL" hint="링크는 기록일 뿐 — 서버가 열어 보지 않습니다">
              <Input value={p.reference.url} onChange={(e) => update((x) => void (x.reference.url = e.target.value))} placeholder="https://www.youtube.com/watch?v=…" />
            </Field>
            <Field label="제목"><Input value={p.reference.title} onChange={(e) => update((x) => void (x.reference.title = e.target.value))} /></Field>
          </FormRow>
          <FormRow className="grid-cols-1 lg:grid-cols-2">
            <Field label="대본 · 자막 (붙여 넣기)" hint="영상을 보고 받아 적거나 자막을 복사해 넣으세요">
              <Textarea rows={7} value={p.reference.transcript} onChange={(e) => update((x) => void (x.reference.transcript = e.target.value))} />
            </Field>
            <Field label="장면 시각 메모" hint="한 줄에 하나: 0:00-0:02 후킹 컷 2 / 0:02-0:06 문제 제기 …">
              <Textarea rows={7} value={p.reference.timing} onChange={(e) => update((x) => void (x.reference.timing = e.target.value))} placeholder={"0:00-0:02 후킹 (손으로 휙 펼침) 컷 2\n0:02-0:06 문제 제기 · 좁은 주방\n0:06-0:15 제품 등장 · 사용 장면\n0:15-0:20 댓글 키워드 CTA"} />
            </Field>
          </FormRow>
        </Card>
      </section>

      {/* ---- 구성 분석 ---- */}
      <section>
        <SectionHeader
          size="lg"
          title="구성 분석"
          hint={a ? (a.by === "ai" ? `AI 분석 · ${a.model ?? ""}` : a.model ? `AI 초안을 사람이 고침 · ${a.model}` : "사람이 작성") : "아직 없음"}
        />
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!p.reference.timing.trim()} onClick={() => {
            const { beats, cuts } = parseTimingNotes(p.reference.timing);
            if (!beats.length) return;
            update((x) => {
              const total = Math.max(...beats.map((b) => b.endSec ?? 0));
              x.analysis = {
                ...(x.analysis ?? emptyAnalysis()),
                basis: [...new Set([...(x.analysis?.basis ?? []), "timing" as const])],
                urlRead: false,
                refs: x.reference.url ? [{ url: x.reference.url, title: x.reference.title }] : [],
                beats,
                totalSec: total,
                cutCount: cuts || beats.length,
                avgShotSec: Math.round((total / Math.max(1, cuts || beats.length)) * 10) / 10,
                productRevealSec: beats.find((b) => b.key === "reveal")?.startSec ?? null,
                by: "manual",
              };
            });
          }}>
            시각 메모로 표 만들기 (AI 없이)
          </Button>
          <Button size="sm" icon={WandSparkles} disabled={!aiReady || busy === "analyze" || !(p.reference.transcript.trim() || p.reference.timing.trim())} onClick={() => void ai("analyze", {}, "구성을 분석했습니다 (붙여 넣은 글 기준).")}>
            AI 로 분석
          </Button>
        </div>
        {!aiReady && <InlineNotice tone="neutral" className="mb-3">OPENROUTER_API_KEY 가 없어 AI 분석 · 대본은 쓸 수 없습니다. 시각 메모로 표를 만들고 직접 채울 수 있습니다.</InlineNotice>}
        {a ? <AnalysisEditor a={a} onChange={(fn) => update((x) => { if (x.analysis) fn(x.analysis); })} /> : <p className="rounded-nd-md border border-dashed border-nd-strong px-4 py-4 text-nd-body text-nd-fg-3">참고 자료를 넣고 분석하면 후킹 · 문제 · 제품 등장 · CTA 의 순서와 타이밍이 표로 나옵니다.</p>}
        {a && a.beats.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SaveTemplate projectId={p.id} defaultName={`${p.product || p.title} 공식`} onSaved={async (id) => { await refresh(); update((x) => void (x.templateId = id)); }} flush={flush} />
            <span className="text-[13px] text-nd-fg-3">시각을 비율로 바꿔 저장합니다 — 길이가 다른 영상에도 옮겨 쓸 수 있습니다.</span>
          </div>
        )}
      </section>

      {/* ---- 새 대본 ---- */}
      <section>
        <SectionHeader size="lg" title="새 대본 · 스토리보드" hint={template ? `공식: ${template.name}` : "공식 없이"} />
        <Card className="space-y-4">
          <FormRow className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.5fr)_minmax(0,1.5fr)]">
            <Field label="적용할 성공 공식">
              <Select value={p.templateId ?? ""} onChange={(e) => update((x) => void (x.templateId = e.target.value || null))}>
                <option value="">(공식 없음)</option>
                {d.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="AI 모델">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {FIN_AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
              </Select>
            </Field>
            <Field label="길이 (초)"><NumberInput value={targetSec} onValueChange={(r) => setTargetSec(Math.min(90, Math.max(10, Number(r) || 30)))} /></Field>
            <Field label="이 상품이 푸는 문제"><Input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="예: 좁은 주방에 둘 곳이 없음" /></Field>
          </FormRow>
          {template && <TemplateTimeline t={template} targetSec={targetSec} />}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!template} onClick={async () => {
              if (p.script.lines.length && !(await ask({ title: "대본을 새로 만들까요?", message: "지금 대본과 장면을 공식 초안으로 바꿉니다. 지금 것은 버전 기록에 남습니다.", confirmLabel: "바꾸기" }))) return;
              await run("tpl", async () => {
                await flush();
                if (p.script.lines.length) await mutate("version.save", { projectId: p.id, kind: "script", note: "공식 초안 전 모습" });
                const draftOut = draftFromTemplate(template!, { product: p.product, problem, facts: p.facts, keyword: p.cta.keyword, targetSec });
                update((x) => {
                  x.script.lines = draftOut.lines;
                  x.scenes = draftOut.scenes;
                  x.subtitles = { cues: [], edited: false };
                  x.cta = { ...template!.cta, keyword: x.cta.keyword || template!.cta.keyword };
                });
              });
            }}>
              공식으로 초안 (AI 없이 · 확인된 사실만)
            </Button>
            <Button icon={Sparkles} disabled={!aiReady || busy === "script" || !p.product.trim()} onClick={async () => {
              if (p.script.lines.length && !(await ask({ title: "AI 로 대본을 새로 만들까요?", message: "지금 대본과 장면은 버전 기록에 남고, 새 대본 · 장면으로 바뀝니다. 비용은 보통 $0.01 아래입니다.", confirmLabel: "만들기" }))) return;
              await ai("script", { targetSec, problem }, "AI 대본을 만들었습니다 — 확인된 사실 밖의 말이 없는지 읽어 보세요.");
            }}>
              AI 로 대본 · 스토리보드
            </Button>
          </div>
          <p className="text-[13px] text-nd-fg-3">
            AI 에는 「확인된 사실」 만 넘기고, 가격 · 할인 · 순위 · 효능 · 후기 · 거짓 품절 표현과 구매와 무관한 클릭 부탁을 금지합니다. 결과에서도 아래 검사가 한 번 더 찾습니다.
          </p>
        </Card>
      </section>

      {/* ---- 대본 줄 ---- */}
      <section>
        <SectionHeader
          size="lg"
          title="대본"
          hint={`${p.script.lines.length}줄 · ${p.script.lines.reduce((n, l) => n + l.text.length, 0)}자${p.scenes.length ? ` · 장면 ${p.scenes.length}개` : ""}`}
          action={<Button size="sm" variant="secondary" icon={Plus} onClick={addLine}>줄 추가</Button>}
        />
        {flags.length > 0 && (
          <InlineNotice tone="warning" className="mb-3">
            확인할 표현: {flags.map((f) => `「${f.phrase}」(${f.message})`).join(" · ")}
          </InlineNotice>
        )}
        {p.script.lines.length === 0 ? (
          <EmptyState compact icon={FileText} title="대본이 없습니다" description="위에서 공식 초안이나 AI 대본을 만들거나, 줄을 직접 추가하세요." action={<Button size="sm" variant="secondary" icon={Plus} onClick={addLine}>줄 추가</Button>} />
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table size="md" minWidth={1000}>
                <thead>
                  <tr>
                    <Th className="w-10" align="right">#</Th>
                    <Th className="w-[8.5rem]">구간</Th>
                    <Th className="w-24" align="right">시각</Th>
                    <Th className="min-w-[14rem]">읽을 말 (내레이션)</Th>
                    <Th className="min-w-[14rem]">화면 자막 (비우면 같은 말)</Th>
                    <Th className="w-44">연결 장면</Th>
                    <Th className="w-[7.5rem]">작업</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.script.lines.map((l, i) => {
                    const tm = lineTimes.get(l.id) ?? null;
                    return (
                      <Tr key={l.id} hover={false}>
                        <Td num muted>{i + 1}</Td>
                        <Td>
                          <Select value={l.beat} aria-label="구간" onChange={(e) => update((x) => void (x.script.lines[i].beat = e.target.value as BeatKey))}>
                            {BEAT_KEYS.map((k) => <option key={k} value={k}>{BEAT_LABEL[k]}</option>)}
                          </Select>
                        </Td>
                        <Td num className="whitespace-nowrap">
                          {tm ? (
                            <span title={tm.by}>{fmtClock(tm.start)}–{fmtClock(tm.end)}</span>
                          ) : (
                            <span className="text-nd-fg-3" title="장면에 연결하면 시각이 나옵니다">—</span>
                          )}
                        </Td>
                        <Td><Input value={l.text} aria-label="읽을 말" title={l.text} onChange={(e) => update((x) => void (x.script.lines[i].text = e.target.value))} /></Td>
                        <Td><Input value={l.caption} aria-label="자막" title={l.caption || l.text} placeholder={l.text} onChange={(e) => update((x) => void (x.script.lines[i].caption = e.target.value))} /></Td>
                        <Td>
                          <Select aria-label="연결 장면" value={l.sceneId ?? ""} onChange={(e) => update((x) => void (x.script.lines[i].sceneId = e.target.value || null))}>
                            <option value="">(연결 안 됨)</option>
                            {p.scenes.map((s, si) => <option key={s.id} value={s.id}>#{si + 1} {s.label || s.kind}</option>)}
                          </Select>
                        </Td>
                        <Td>
                          <div className="flex">
                            <IconButton icon={ArrowUp} label="위로" disabled={i === 0} onClick={() => update((x) => void x.script.lines.splice(i - 1, 0, x.script.lines.splice(i, 1)[0]))} />
                            <IconButton icon={ArrowDown} label="아래로" disabled={i === p.script.lines.length - 1} onClick={() => update((x) => void x.script.lines.splice(i + 1, 0, x.script.lines.splice(i, 1)[0]))} />
                            <IconButton icon={Trash2} label="줄 지우기" onClick={() => update((x) => void x.script.lines.splice(i, 1))} />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
        {p.script.lines.length > 0 && (
          <p className="mt-2 text-[13px] text-nd-fg-3">시각은 자막 시각이 있으면 그것을, 없으면 연결한 장면의 타임라인 위치를 보여 줍니다 (편집·출력 탭에서 맞춥니다).</p>
        )}
      </section>

      {/* ---- CTA ---- */}
      <section>
        <SectionHeader size="lg" title="CTA (정보 요청 · 클릭)" hint="자발적인 정보 요청과 제휴 링크 클릭을 겨냥합니다" />
        <Card className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,3fr)]">
            <Field label="방식">
              <Select value={p.cta.type} onChange={(e) => update((x) => void (x.cta.type = e.target.value as CtaType))}>
                {(Object.keys(CTA_LABEL) as CtaType[]).map((k) => <option key={k} value={k}>{CTA_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="키워드"><Input value={p.cta.keyword} onChange={(e) => update((x) => void (x.cta.keyword = e.target.value))} placeholder="예: 선반" /></Field>
            <Field label="게시 문구에 넣을 CTA"><Input value={p.cta.wording} onChange={(e) => update((x) => void (x.cta.wording = e.target.value))} placeholder="제품 정보가 궁금하면 댓글에 「선반」 남겨 주세요" /></Field>
          </FormRow>
          <p className="text-[13px] text-nd-fg-3">
            DM 은 먼저 요청한 사람에게만 보내고, 답장 첫 줄에도 고지 문구를 넣습니다 (쿠팡 운영정책 — 동의 없는 DM 금지). 자동 클릭 · 무차별 광고 DM 기능은 없습니다.
          </p>
        </Card>
      </section>

      {historyOpen && <VersionHistory projectId={p.id} onClose={() => setHistoryOpen(false)} onRestore={(v) => {
        update((x) => {
          if (v.kind === "reference") x.reference = v.data as ProjectDoc["reference"];
          if (v.kind === "analysis") x.analysis = v.data as FormulaAnalysis | null;
          if (v.kind === "script") {
            const s = v.data as { lines?: ProjectDoc["script"]["lines"]; script?: ProjectDoc["script"]; scenes?: ProjectDoc["scenes"] };
            x.script = s.script ?? { lines: s.lines ?? [] };
            if (s.scenes) x.scenes = s.scenes;
          }
        });
        setHistoryOpen(false);
      }} flush={flush} />}
      {d.status.openrouter.configured && <p className="text-[13px] text-nd-fg-3">이 영상의 AI 글 비용 합: {fmtUsd(p.costs.filter((c) => c.kind === "ai_text").reduce((n, c) => n + (c.usd ?? 0), 0))}</p>}
    </div>
  );
}

function AnalysisEditor({ a, onChange }: { a: FormulaAnalysis; onChange: (fn: (a: FormulaAnalysis) => void) => void }) {
  const timed = a.beats.filter((b) => b.startSec !== null && b.endSec !== null && b.endSec > b.startSec);
  const total = a.totalSec ?? Math.max(0, ...timed.map((b) => b.endSec ?? 0));
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {a.basis.includes("transcript") && <Badge tone="info">근거: 붙여 넣은 대본</Badge>}
        {a.basis.includes("timing") && <Badge tone="info">근거: 사람이 적은 장면 시각</Badge>}
        <Badge>URL 미열람 — 영상을 직접 보지 않았습니다</Badge>
        {!a.basis.includes("timing") && <Badge tone="warning">시각 없음 (대본만으로는 타이밍을 알 수 없음)</Badge>}
      </div>
      {timed.length > 0 && total > 0 ? (
        <BeatBar
          title="구성 타임라인"
          note={`참고 영상 기준 · 전체 ${fmtSec(total)}${a.productRevealSec !== null ? ` · 제품 등장 ${fmtSec(a.productRevealSec)}` : ""}`}
          total={total}
          segs={timed.map((b) => ({ key: b.key, label: b.label || BEAT_LABEL[b.key], from: b.startSec as number, to: b.endSec as number }))}
          marker={a.productRevealSec}
        />
      ) : (
        <p className="text-[13px] text-nd-fg-3">시작 · 끝 시각이 있는 구간이 없어 타임라인을 그리지 않았습니다. 아래 표에 시각을 적으면 막대로 보입니다.</p>
      )}
      <FormRow className="grid-cols-2 sm:grid-cols-5">
        <Field label="전체 길이 (초)"><NumberInput decimal value={a.totalSec} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.totalSec = r === "" ? null : Number(r)))} /></Field>
        <Field label="제품 등장 (초)"><NumberInput decimal value={a.productRevealSec} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.productRevealSec = r === "" ? null : Number(r)))} /></Field>
        <Field label="평균 컷 길이 (초)"><NumberInput decimal value={a.avgShotSec} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.avgShotSec = r === "" ? null : Number(r)))} /></Field>
        <Field label="컷 수"><NumberInput value={a.cutCount} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.cutCount = r === "" ? null : Number(r)))} /></Field>
        <Field label="자막 ↔ 내레이션">
          <Select value={a.narrationSubtitle} onChange={(e) => onChange((x) => void (x.narrationSubtitle = e.target.value as FormulaAnalysis["narrationSubtitle"]))}>
            <option value="same">같은 말</option>
            <option value="summary">요약</option>
            <option value="keywords">핵심 낱말만</option>
            <option value="none">자막 없음</option>
            <option value="unknown">모름</option>
          </Select>
        </Field>
      </FormRow>
      <Field label="첫 1~3초 후킹 방식"><Input value={a.hookPattern} onChange={(e) => onChange((x) => void (x.hookPattern = e.target.value))} /></Field>
      <TableScroll>
        <Table size="md" minWidth={900}>
          <thead>
            <tr>
              <Th className="w-36">구간</Th>
              <Th className="w-24" align="right">시작 (초)</Th>
              <Th className="w-24" align="right">끝 (초)</Th>
              <Th>하는 일</Th>
              <Th>옮길 말 틀 ({"{상품} {문제} {특징} {키워드}"})</Th>
              <Th className="w-12"> </Th>
            </tr>
          </thead>
          <tbody>
            {a.beats.map((b, i) => (
              <Tr key={i} hover={false}>
                <Td>
                  <Select value={b.key} aria-label="구간" onChange={(e) => onChange((x) => { x.beats[i].key = e.target.value as BeatKey; x.beats[i].label = BEAT_LABEL[e.target.value as BeatKey]; })}>
                    {BEAT_KEYS.map((k) => <option key={k} value={k}>{BEAT_LABEL[k]}</option>)}
                  </Select>
                </Td>
                <Td><NumberInput decimal value={b.startSec} placeholder="—" aria-label="시작" onValueChange={(r) => onChange((x) => void (x.beats[i].startSec = r === "" ? null : Number(r)))} /></Td>
                <Td><NumberInput decimal value={b.endSec} placeholder="—" aria-label="끝" onValueChange={(r) => onChange((x) => void (x.beats[i].endSec = r === "" ? null : Number(r)))} /></Td>
                <Td><Input value={b.summary} aria-label="하는 일" title={b.summary} onChange={(e) => onChange((x) => void (x.beats[i].summary = e.target.value))} /></Td>
                <Td><Input value={b.pattern} aria-label="말 틀" title={b.pattern} onChange={(e) => onChange((x) => void (x.beats[i].pattern = e.target.value))} /></Td>
                <Td><IconButton icon={Trash2} label="구간 지우기" onClick={() => onChange((x) => void x.beats.splice(i, 1))} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange((x) => void x.beats.push(emptyBeat("demo")))}>구간 추가</Button>
        <span className="text-[13px] text-nd-fg-2">
          CTA: {CTA_LABEL[a.cta.type]}{a.cta.keyword ? ` · 「${a.cta.keyword}」` : ""}{a.cta.atSec !== null ? ` · ${fmtSec(a.cta.atSec)}` : ""}
        </span>
      </div>
      <Field label="한계 · 메모"><Textarea rows={2} value={a.notes} onChange={(e) => onChange((x) => void (x.notes = e.target.value))} /></Field>
      {a.by === "ai" && <p className="text-[13px] text-nd-fg-3">AI 비용 {fmtUsd(a.costUsd ?? null)} · 고치면 「사람이 고침」 으로 바뀝니다.</p>}
    </Card>
  );
}

/** 공식(비율)을 목표 길이에 펼쳐 본 구성 — 「공식으로 초안」 이 만들 순서 */
function TemplateTimeline({ t, targetSec }: { t: TemplateDoc; targetSec: number }) {
  const segs = t.beats.filter((b) => b.to > b.from).map((b) => ({ key: b.key, label: b.label || BEAT_LABEL[b.key], from: b.from * targetSec, to: b.to * targetSec }));
  if (!segs.length) return null;
  return (
    <BeatBar
      title={`공식 구성 · ${t.name}`}
      note={`목표 길이 ${targetSec}초 기준 (공식은 비율로 저장됨)${t.productRevealRatio !== null ? ` · 제품 등장 ${fmtSec(t.productRevealRatio * targetSec)}` : ""}`}
      total={targetSec}
      segs={segs}
      marker={t.productRevealRatio !== null ? t.productRevealRatio * targetSec : null}
    />
  );
}

/** 구간 막대 — 길이에 비례한 칸 + 구간 이름 · 시각. 색은 칸 구분용이고 뜻은 글자가 전한다 */
function BeatBar({ title, note, total, segs, marker }: { title: string; note: string; total: number; segs: { key: BeatKey; label: string; from: number; to: number }[]; marker?: number | null }) {
  const sorted = [...segs].sort((x, y) => x.from - y.from);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13px] font-medium text-nd-fg-2">{title}</span>
        <span className="text-[13px] text-nd-fg-3">{note}</span>
      </div>
      <div className="relative">
        <div className="relative h-14 overflow-hidden rounded-nd-md bg-nd-fg/[.04]">
          {sorted.map((b, i) => {
            const left = Math.max(0, Math.min(100, (b.from / total) * 100));
            const width = Math.max(0, Math.min(100 - left, ((b.to - b.from) / total) * 100));
            return (
              <div
                key={`${b.key}-${i}`}
                className="absolute inset-y-0 flex min-w-0 flex-col justify-center overflow-hidden border-r-2 border-nd-content px-2 text-nd-fg"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: BLUE_RAMP[i % 2 === 0 ? 1 : 2] }}
                title={`${b.label} · ${fmtClock(b.from)}–${fmtClock(b.to)}`}
              >
                <span className="truncate text-[13px] font-semibold">{b.label}</span>
                <span className="nd-num truncate text-[12px] text-nd-fg-2">{fmtClock(b.from)}–{fmtClock(b.to)}</span>
              </div>
            );
          })}
        </div>
        {marker !== null && marker !== undefined && marker >= 0 && marker <= total && (
          <span aria-hidden className="absolute -bottom-1 -top-1 w-0.5 rounded bg-nd-accent" style={{ left: `${(marker / total) * 100}%` }} title={`제품 등장 ${fmtSec(marker)}`} />
        )}
      </div>
      <div className="nd-num mt-1 flex justify-between text-[12px] text-nd-fg-3">
        <span>0:00</span>
        <span>{fmtClock(total)}</span>
      </div>
    </div>
  );
}

/** 0:04 · 1:05 — 표 안의 짧은 시각 */
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec * 10) / 10);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Number.isInteger(r);
  return `${m}:${(whole ? String(r) : r.toFixed(1)).padStart(whole ? 2 : 4, "0")}`;
}

function SaveTemplate({ projectId, defaultName, onSaved, flush }: { projectId: string; defaultName: string; onSaved: (id: string) => Promise<void>; flush: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [name, setName] = useState(defaultName);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input className="w-80 max-w-full" value={name} onChange={(e) => setName(e.target.value)} aria-label="공식 이름" title={name} />
      <Button icon={Save} disabled={busy === "t" || !name.trim()} onClick={() => void run("t", async () => { await flush(); const r = await mutate<{ id: string }>("template.fromAnalysis", { projectId, name }); await onSaved(r.id); }, "성공 공식으로 저장했습니다.")}>
        성공 공식으로 저장
      </Button>
    </div>
  );
}

function VersionHistory({ projectId, onClose, onRestore, flush }: { projectId: string; onClose: () => void; onRestore: (v: VersionDoc & { id: string }) => void; flush: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [list, setList] = useState<(VersionDoc & { id: string })[] | null>(null);
  const [view, setView] = useState<(VersionDoc & { id: string }) | null>(null);
  const load = () => run("l", async () => setList((await mutate<{ versions: (VersionDoc & { id: string })[] }>("version.list", { projectId })).versions));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const KIND = { reference: "참고 자료", analysis: "구성 분석", script: "대본" } as const;
  return (
    <Dialog open onClose={onClose} size="lg" title="버전 기록" description="참고 자료 · 구성 분석 · 대본이 바뀔 때 10분에 한 벌씩, AI 결과와 「지금 저장」 은 그때마다 남습니다.">
      <div className="mb-3 flex flex-wrap gap-2">
        {(["reference", "analysis", "script"] as const).map((k) => (
          <Button key={k} size="sm" variant="secondary" disabled={busy === k} onClick={() => void run(k, async () => { await flush(); await mutate("version.save", { projectId, kind: k, note: "사람이 저장" }); await load(); }, `${KIND[k]} 지금 모습을 저장했습니다.`)}>
            {KIND[k]} 지금 저장
          </Button>
        ))}
      </div>
      {!list ? (
        <p className="text-nd-body text-nd-fg-3">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">기록이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
          {list.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-3 py-2">
              <Badge size="sm">{KIND[v.kind]}</Badge>
              <span className="min-w-0 flex-1 truncate text-nd-body">{v.note}</span>
              <span className="text-nd-caption text-nd-fg-3">{v.by.split("@")[0]} · {fmtWhen(v.at)}</span>
              <Button size="sm" variant="ghost" onClick={() => setView(v)}>보기</Button>
              <Button size="sm" variant="secondary" onClick={() => onRestore(v)}>되돌리기</Button>
            </li>
          ))}
        </ul>
      )}
      {view && (
        <pre className="nd-scroll mt-3 max-h-72 overflow-auto rounded-nd-md bg-nd-fg/[.04] p-3 text-nd-caption">{JSON.stringify(view.data, null, 2)}</pre>
      )}
    </Dialog>
  );
}

