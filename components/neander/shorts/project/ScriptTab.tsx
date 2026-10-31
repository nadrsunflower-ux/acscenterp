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
import { ArrowDown, ArrowUp, History, Plus, Save, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { Badge, Button, Card, Dialog, Field, FormRow, InlineNotice, Input, NumberInput, SectionHeader, Select, Table, TableScroll, Td, Textarea, Th, Tr, useConfirm } from "@/components/neander/ui";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { BEAT_LABEL, CTA_LABEL, draftFromTemplate, emptyAnalysis, emptyBeat, fmtSec, newId, parseTimingNotes, scanClaims } from "@/lib/neander/shorts/model";
import { FIN_AI_MODELS, DEFAULT_FIN_AI_MODEL } from "@/lib/neander/ai/models";
import type { BeatKey, CtaType, FormulaAnalysis, ProjectDoc, VersionDoc } from "@/lib/neander/shorts/types";
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

  const ai = (action: "analyze" | "script", body: object, ok: string) =>
    run(action, async () => {
      await flush();
      const r = await shortsPost<{ project: WithId<ProjectDoc>; costUsd: number }>("ai", { action, projectId: p.id, model, ...body });
      replace({ ...r.project, id: p.id });
      return r;
    }, ok);

  return (
    <div className="space-y-8">
      {/* ---- 참고 자료 ---- */}
      <section>
        <SectionHeader title="참고 자료" hint="잘된 쇼츠의 대본과 장면 시각" action={<Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryOpen(true)}>버전 기록</Button>} />
        <Card className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1fr]">
            <Field label="참고 영상 URL" hint="링크는 기록일 뿐 — 서버가 열어 보지 않습니다">
              <Input size="sm" value={p.reference.url} onChange={(e) => update((x) => void (x.reference.url = e.target.value))} placeholder="https://www.youtube.com/watch?v=…" />
            </Field>
            <Field label="제목"><Input size="sm" value={p.reference.title} onChange={(e) => update((x) => void (x.reference.title = e.target.value))} /></Field>
          </FormRow>
          <FormRow className="grid-cols-1 lg:grid-cols-2">
            <Field label="대본 · 자막 (붙여 넣기)" hint="영상을 보고 받아 적거나 자막을 복사해 넣으세요">
              <Textarea rows={8} value={p.reference.transcript} onChange={(e) => update((x) => void (x.reference.transcript = e.target.value))} />
            </Field>
            <Field label="장면 시각 메모" hint="한 줄에 하나: 0:00-0:02 후킹 컷 2 / 0:02-0:06 문제 제기 …">
              <Textarea rows={8} value={p.reference.timing} onChange={(e) => update((x) => void (x.reference.timing = e.target.value))} placeholder={"0:00-0:02 후킹 (손으로 휙 펼침) 컷 2\n0:02-0:06 문제 제기 · 좁은 주방\n0:06-0:15 제품 등장 · 사용 장면\n0:15-0:20 댓글 키워드 CTA"} />
            </Field>
          </FormRow>
        </Card>
      </section>

      {/* ---- 구성 분석 ---- */}
      <section>
        <SectionHeader
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
        {a ? <AnalysisEditor a={a} onChange={(fn) => update((x) => { if (x.analysis) fn(x.analysis); })} /> : <p className="text-nd-body text-nd-fg-3">참고 자료를 넣고 분석하면 후킹 · 문제 · 제품 등장 · CTA 의 순서와 타이밍이 표로 나옵니다.</p>}
        {a && a.beats.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SaveTemplate projectId={p.id} defaultName={`${p.product || p.title} 공식`} onSaved={async (id) => { await refresh(); update((x) => void (x.templateId = id)); }} flush={flush} />
            <span className="text-nd-caption text-nd-fg-3">시각을 비율로 바꿔 저장합니다 — 길이가 다른 영상에도 옮겨 쓸 수 있습니다.</span>
          </div>
        )}
      </section>

      {/* ---- 새 대본 ---- */}
      <section>
        <SectionHeader title="새 대본 · 스토리보드" hint={template ? `공식: ${template.name}` : "공식 없이"} />
        <Card className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[1.4fr_1fr_0.7fr_1.6fr]">
            <Field label="적용할 성공 공식">
              <Select size="sm" value={p.templateId ?? ""} onChange={(e) => update((x) => void (x.templateId = e.target.value || null))}>
                <option value="">(공식 없음)</option>
                {d.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="AI 모델">
              <Select size="sm" value={model} onChange={(e) => setModel(e.target.value)}>
                {FIN_AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
              </Select>
            </Field>
            <Field label="길이 (초)"><NumberInput size="sm" value={targetSec} onValueChange={(r) => setTargetSec(Math.min(90, Math.max(10, Number(r) || 30)))} /></Field>
            <Field label="이 상품이 푸는 문제"><Input size="sm" value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="예: 좁은 주방에 둘 곳이 없음" /></Field>
          </FormRow>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!template} onClick={async () => {
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
            <Button size="sm" icon={Sparkles} disabled={!aiReady || busy === "script" || !p.product.trim()} onClick={async () => {
              if (p.script.lines.length && !(await ask({ title: "AI 로 대본을 새로 만들까요?", message: "지금 대본과 장면은 버전 기록에 남고, 새 대본 · 장면으로 바뀝니다. 비용은 보통 $0.01 아래입니다.", confirmLabel: "만들기" }))) return;
              await ai("script", { targetSec, problem }, "AI 대본을 만들었습니다 — 확인된 사실 밖의 말이 없는지 읽어 보세요.");
            }}>
              AI 로 대본 · 스토리보드
            </Button>
          </div>
          <p className="text-nd-caption text-nd-fg-3">
            AI 에는 「확인된 사실」 만 넘기고, 가격 · 할인 · 순위 · 효능 · 후기 · 거짓 품절 표현과 구매와 무관한 클릭 부탁을 금지합니다. 결과에서도 아래 검사가 한 번 더 찾습니다.
          </p>
        </Card>
      </section>

      {/* ---- 대본 줄 ---- */}
      <section>
        <SectionHeader
          title="대본"
          hint={`${p.script.lines.length}줄 · ${p.script.lines.reduce((n, l) => n + l.text.length, 0)}자`}
          action={<Button size="sm" variant="secondary" icon={Plus} onClick={() => update((x) => void x.script.lines.push({ id: newId("ln_"), beat: "demo", text: "", caption: "", sceneId: null }))}>줄 추가</Button>}
        />
        {flags.length > 0 && (
          <InlineNotice tone="warning" className="mb-3">
            확인할 표현: {flags.map((f) => `「${f.phrase}」(${f.message})`).join(" · ")}
          </InlineNotice>
        )}
        {p.script.lines.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">대본이 없습니다. 위에서 초안을 만들거나 줄을 추가하세요.</p>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table minWidth={900}>
                <thead>
                  <tr>
                    <Th className="w-10">#</Th>
                    <Th className="w-32">구간</Th>
                    <Th>읽을 말</Th>
                    <Th>화면 자막 (비우면 같은 말)</Th>
                    <Th className="w-48">연결 장면</Th>
                    <Th className="w-28"> </Th>
                  </tr>
                </thead>
                <tbody>
                  {p.script.lines.map((l, i) => (
                    <Tr key={l.id} hover={false}>
                      <Td muted>{i + 1}</Td>
                      <Td>
                        <Select size="sm" value={l.beat} aria-label="구간" onChange={(e) => update((x) => void (x.script.lines[i].beat = e.target.value as BeatKey))}>
                          {BEAT_KEYS.map((k) => <option key={k} value={k}>{BEAT_LABEL[k]}</option>)}
                        </Select>
                      </Td>
                      <Td><Input size="sm" value={l.text} aria-label="읽을 말" onChange={(e) => update((x) => void (x.script.lines[i].text = e.target.value))} /></Td>
                      <Td><Input size="sm" value={l.caption} aria-label="자막" placeholder={l.text} onChange={(e) => update((x) => void (x.script.lines[i].caption = e.target.value))} /></Td>
                      <Td>
                        <Select size="sm" aria-label="연결 장면" value={l.sceneId ?? ""} onChange={(e) => update((x) => void (x.script.lines[i].sceneId = e.target.value || null))}>
                          <option value="">(연결 안 됨)</option>
                          {p.scenes.map((s, si) => <option key={s.id} value={s.id}>#{si + 1} {s.label || s.kind}</option>)}
                        </Select>
                      </Td>
                      <Td>
                        <div className="flex">
                          <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="위로" disabled={i === 0} onClick={() => update((x) => void x.script.lines.splice(i - 1, 0, x.script.lines.splice(i, 1)[0]))} />
                          <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="아래로" disabled={i === p.script.lines.length - 1} onClick={() => update((x) => void x.script.lines.splice(i + 1, 0, x.script.lines.splice(i, 1)[0]))} />
                          <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => update((x) => void x.script.lines.splice(i, 1))} />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

      {/* ---- CTA ---- */}
      <section>
        <SectionHeader title="CTA (정보 요청 · 클릭)" hint="자발적인 정보 요청과 제휴 링크 클릭을 겨냥합니다" />
        <Card className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[1fr_1fr_3fr]">
            <Field label="방식">
              <Select size="sm" value={p.cta.type} onChange={(e) => update((x) => void (x.cta.type = e.target.value as CtaType))}>
                {(Object.keys(CTA_LABEL) as CtaType[]).map((k) => <option key={k} value={k}>{CTA_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="키워드"><Input size="sm" value={p.cta.keyword} onChange={(e) => update((x) => void (x.cta.keyword = e.target.value))} placeholder="예: 선반" /></Field>
            <Field label="게시 문구에 넣을 CTA"><Input size="sm" value={p.cta.wording} onChange={(e) => update((x) => void (x.cta.wording = e.target.value))} placeholder="제품 정보가 궁금하면 댓글에 「선반」 남겨 주세요" /></Field>
          </FormRow>
          <p className="text-nd-caption text-nd-fg-3">
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
      {d.status.openrouter.configured && <p className="text-nd-caption text-nd-fg-3">이 영상의 AI 글 비용 합: {fmtUsd(p.costs.filter((c) => c.kind === "ai_text").reduce((n, c) => n + (c.usd ?? 0), 0))}</p>}
    </div>
  );
}

function AnalysisEditor({ a, onChange }: { a: FormulaAnalysis; onChange: (fn: (a: FormulaAnalysis) => void) => void }) {
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {a.basis.includes("transcript") && <Badge tone="info" size="sm">근거: 붙여 넣은 대본</Badge>}
        {a.basis.includes("timing") && <Badge tone="info" size="sm">근거: 사람이 적은 장면 시각</Badge>}
        <Badge size="sm">URL 미열람 — 영상을 직접 보지 않았습니다</Badge>
        {!a.basis.includes("timing") && <Badge tone="warning" size="sm">시각 없음 (대본만으로는 타이밍을 알 수 없음)</Badge>}
      </div>
      <FormRow className="grid-cols-2 sm:grid-cols-5">
        <Field label="전체 길이"><NumberInput size="sm" decimal value={a.totalSec} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.totalSec = r === "" ? null : Number(r)))} /></Field>
        <Field label="제품 등장 (초)"><NumberInput size="sm" decimal value={a.productRevealSec} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.productRevealSec = r === "" ? null : Number(r)))} /></Field>
        <Field label="평균 컷 길이"><NumberInput size="sm" decimal value={a.avgShotSec} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.avgShotSec = r === "" ? null : Number(r)))} /></Field>
        <Field label="컷 수"><NumberInput size="sm" value={a.cutCount} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.cutCount = r === "" ? null : Number(r)))} /></Field>
        <Field label="자막 ↔ 내레이션">
          <Select size="sm" value={a.narrationSubtitle} onChange={(e) => onChange((x) => void (x.narrationSubtitle = e.target.value as FormulaAnalysis["narrationSubtitle"]))}>
            <option value="same">같은 말</option>
            <option value="summary">요약</option>
            <option value="keywords">핵심 낱말만</option>
            <option value="none">자막 없음</option>
            <option value="unknown">모름</option>
          </Select>
        </Field>
      </FormRow>
      <Field label="첫 1~3초 후킹 방식"><Input size="sm" value={a.hookPattern} onChange={(e) => onChange((x) => void (x.hookPattern = e.target.value))} /></Field>
      <TableScroll>
        <Table minWidth={820} dense>
          <thead>
            <tr>
              <Th className="w-32">구간</Th>
              <Th className="w-20" align="right">시작</Th>
              <Th className="w-20" align="right">끝</Th>
              <Th>하는 일</Th>
              <Th>옮길 말 틀 ({"{상품} {문제} {특징} {키워드}"})</Th>
              <Th className="w-10"> </Th>
            </tr>
          </thead>
          <tbody>
            {a.beats.map((b, i) => (
              <Tr key={i} hover={false}>
                <Td>
                  <Select size="sm" value={b.key} aria-label="구간" onChange={(e) => onChange((x) => { x.beats[i].key = e.target.value as BeatKey; x.beats[i].label = BEAT_LABEL[e.target.value as BeatKey]; })}>
                    {BEAT_KEYS.map((k) => <option key={k} value={k}>{BEAT_LABEL[k]}</option>)}
                  </Select>
                </Td>
                <Td><NumberInput size="sm" decimal value={b.startSec} placeholder="—" aria-label="시작" onValueChange={(r) => onChange((x) => void (x.beats[i].startSec = r === "" ? null : Number(r)))} /></Td>
                <Td><NumberInput size="sm" decimal value={b.endSec} placeholder="—" aria-label="끝" onValueChange={(r) => onChange((x) => void (x.beats[i].endSec = r === "" ? null : Number(r)))} /></Td>
                <Td><Input size="sm" value={b.summary} aria-label="하는 일" onChange={(e) => onChange((x) => void (x.beats[i].summary = e.target.value))} /></Td>
                <Td><Input size="sm" value={b.pattern} aria-label="말 틀" onChange={(e) => onChange((x) => void (x.beats[i].pattern = e.target.value))} /></Td>
                <Td><Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => onChange((x) => void x.beats.splice(i, 1))} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange((x) => void x.beats.push(emptyBeat("demo")))}>구간 추가</Button>
        <span className="text-nd-caption text-nd-fg-3">
          CTA: {CTA_LABEL[a.cta.type]}{a.cta.keyword ? ` · 「${a.cta.keyword}」` : ""}{a.cta.atSec !== null ? ` · ${fmtSec(a.cta.atSec)}` : ""}
        </span>
      </div>
      <Field label="한계 · 메모"><Textarea rows={2} value={a.notes} onChange={(e) => onChange((x) => void (x.notes = e.target.value))} /></Field>
      {a.by === "ai" && <p className="text-nd-caption text-nd-fg-3">AI 비용 {fmtUsd(a.costUsd ?? null)} · 고치면 「사람이 고침」 으로 바뀝니다.</p>}
    </Card>
  );
}

function SaveTemplate({ projectId, defaultName, onSaved, flush }: { projectId: string; defaultName: string; onSaved: (id: string) => Promise<void>; flush: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [name, setName] = useState(defaultName);
  return (
    <div className="flex items-center gap-2">
      <Input size="sm" className="w-56" value={name} onChange={(e) => setName(e.target.value)} aria-label="공식 이름" />
      <Button size="sm" icon={Save} disabled={busy === "t" || !name.trim()} onClick={() => void run("t", async () => { await flush(); const r = await mutate<{ id: string }>("template.fromAnalysis", { projectId, name }); await onSaved(r.id); }, "성공 공식으로 저장했습니다.")}>
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

