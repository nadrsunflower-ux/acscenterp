"use client";

// ============================================================
//  편집·출력 탭 — 장면 타임라인 · 내레이션 · 자막 · 9:16 미리보기 · MP4 출력
// ------------------------------------------------------------
//  제작 방식 A 기존 영상 재편집 · B 소스 + AI 장면 · C 전체 AI.
//  AI 장면은 실제 제품과 다를 수 있다 — 「검토 → 사용 승인」 을 거쳐야 출력에 쓰이고,
//  언제든 다시 만들거나 원본 클립으로 바꿀 수 있다.
//  출력은 이 브라우저가 한다(render.ts). 출력 작업은 서버에 기록되어 창을 닫으면
//  「중단」 으로 남고, 같은 설계도로 다시 출력하면 같은 결과가 나온다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Captions, CheckCircle2, Download, Film, ImageIcon, Mic, Plus, Square, Trash2, Type, Video, WandSparkles, XCircle } from "lucide-react";
import { Badge, Button, Card, Checkbox, Divider, Field, FieldAction, FormRow, InlineNotice, Input, NumberInput, SectionHeader, Select, Switch, Table, TableScroll, Td, Textarea, Th, type Tone, useConfirm, useToast } from "@/components/neander/ui";
import { JOBS_EVENT } from "../ShortsRunner";
import { deleteMedia, downloadBlob, loadMedia, notePendingJobs, safeFileName, shortsGet, shortsPost, uploadMedia } from "@/lib/neander/shorts/client";
import { fitScenesToCues, fmtSec, narrationLength, newId, overlayFor, renderBlockers, scriptHash, scriptText, timeSubtitles, timelineSec, toSrt, unlinkedLines } from "@/lib/neander/shorts/model";
import { canRenderMp4, effectiveCues, probeMedia, renderProject, specHash } from "@/lib/neander/shorts/render";
import type { AiSceneStatus, JobView, MediaView, ProductionMode, ProjectDoc, Scene, SceneKind } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { MediaThumb, MediaUpload, mediaLabel, useBlobUrl, useProjectMedia } from "../media";
import { JobBadge, fmtUsd, fmtWhen, useAction } from "../parts";
import { Preview } from "../Preview";
import type { Draft } from "../useProjectDraft";

const MODE_LABEL: Record<ProductionMode, string> = { remix: "A · 기존 영상 재편집", hybrid: "B · 소스 + AI 장면", ai: "C · 전체 AI 생성" };
const KIND_LABEL: Record<SceneKind, string> = { clip: "원본 클립", ai: "AI 생성", image: "사진", blank: "빈 화면" };
const KIND_TONE: Record<SceneKind, Tone> = { clip: "neutral", ai: "accent", image: "info", blank: "neutral" };
const AI_STATUS: Record<AiSceneStatus, string> = { draft: "프롬프트 작성", generating: "생성 중", review: "검토 필요", approved: "사용 승인됨", rejected: "반려", failed: "실패" };
const AI_TONE: Record<AiSceneStatus, Tone> = { draft: "neutral", generating: "accent", review: "warning", approved: "success", rejected: "danger", failed: "danger" };

export function EditorTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { media, refresh: refreshMedia } = useProjectMedia(p.id);
  const jobs = useProjectJobs(p.id);
  const total = timelineSec(p.scenes);
  const blockers = renderBlockers(p);
  const unlinked = unlinkedLines(p);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-8">
        <section>
          <SectionHeader size="lg" title="제작 방식" />
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MODE_LABEL) as ProductionMode[]).map((m) => (
              <Button key={m} size="sm" variant={p.mode === m ? "primary" : "secondary"} onClick={() => update((x) => void (x.mode = m))}>{MODE_LABEL[m]}</Button>
            ))}
          </div>
        </section>

        <section>
          <SectionHeader
            size="lg"
            title="장면 (타임라인 순서)"
            hint={`${p.scenes.length}개 · ${fmtSec(total)}`}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => update((x) => void x.scenes.push(blankScene("clip")))}>원본 장면</Button>
                <Button size="sm" variant="secondary" icon={WandSparkles} onClick={() => update((x) => void x.scenes.push(blankScene("ai")))}>AI 장면</Button>
              </div>
            }
          />
          {unlinked.length > 0 && p.scenes.length > 0 && <InlineNotice tone="neutral" className="mb-3">장면에 이어지지 않은 대본 {unlinked.length}줄 — 「공식·대본」 탭에서 줄마다 장면을 고르세요.</InlineNotice>}
          <div className="space-y-3">
            {p.scenes.map((s, i) => (
              <SceneCard key={s.id} draft={draft} index={i} scene={s} media={media} job={jobs.find((j) => j.id === s.ai?.jobId) ?? null} onMediaChanged={refreshMedia} />
            ))}
            {p.scenes.length === 0 && <p className="rounded-nd-lg border border-dashed border-nd-strong px-4 py-6 text-center text-nd-body text-nd-fg-3">장면이 없습니다. 소스 탭의 구간을 「장면으로」 보내거나, 대본 초안을 만들면 장면이 생깁니다.</p>}
          </div>
        </section>

        <NarrationPanel draft={draft} media={media} onMediaChanged={refreshMedia} />
        <SubtitlePanel draft={draft} media={media} />
        <OutputPanel draft={draft} media={media} blockers={blockers} onMediaChanged={refreshMedia} />
        <JobsPanel jobs={jobs} />
      </div>
      <aside className="xl:sticky xl:top-4 xl:self-start">
        <Card>
          <SectionHeader as="h3" title="9:16 미리보기" hint={`장면 ${p.scenes.length}개 · ${fmtSec(total)}`} />
          <Preview p={p} />
          <Divider className="my-4" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-nd-fg-2">출력 준비</span>
            {blockers.length ? <Badge tone="warning">고칠 것 {blockers.length}개</Badge> : <Badge tone="success">막는 문제 없음</Badge>}
          </div>
          {blockers.length > 0 && <p className="mt-1.5 text-[13px] text-nd-fg-3">아래 「출력」 의 확인 목록을 보세요.</p>}
        </Card>
      </aside>
    </div>
  );
}

function blankScene(kind: SceneKind): Scene {
  return {
    id: newId("sc_"),
    kind,
    label: kind === "ai" ? "AI 장면" : "장면",
    duration: 3,
    clip: null,
    ai: kind === "ai" ? { prompt: "", status: "draft", jobId: null, fileId: null, model: null, reviewNote: "" } : null,
    image: null,
    keepAudio: false,
  };
}

/** 프로젝트의 작업 — 팀 프로젝트면 다른 사람이 만든 작업도 보인다 */
function useProjectJobs(projectId: string) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const load = useCallback(() => shortsGet<{ jobs: JobView[] }>(`jobs?projectId=${encodeURIComponent(projectId)}`).then((r) => setJobs(r.jobs)).catch(() => undefined), [projectId]);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(JOBS_EVENT, on);
    return () => window.removeEventListener(JOBS_EVENT, on);
  }, [load]);
  return jobs;
}

// ---- 장면 하나 ---------------------------------------------------------

function SceneCard({ draft, index: i, scene: s, media, job, onMediaChanged }: { draft: Draft; index: number; scene: Scene; media: MediaView[]; job: JobView | null; onMediaChanged: () => Promise<void> }) {
  const { p, update } = draft;
  const ask = useConfirm();
  const fileMedia = media.filter((m) => m.kind === "source" || m.kind === "ai_scene");
  const clipMedia = s.clip ? media.find((m) => m.id === s.clip!.fileId) : null;
  const lines = p.script.lines.filter((l) => l.sceneId === s.id);
  const set = (fn: (x: Scene) => void) => update((x) => fn(x.scenes[i]));
  const lengthLocked = s.kind === "clip" && !!s.clip;
  return (
    <Card padding="sm" className="flex gap-4">
      <SceneThumb scene={s} index={i} media={media} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="nd-num text-[15px] font-semibold text-nd-fg">#{i + 1}</span>
          <Badge size="lg" tone={KIND_TONE[s.kind]}>{KIND_LABEL[s.kind]}</Badge>
          {s.kind === "ai" && s.ai && <Badge size="lg" tone={AI_TONE[s.ai.status]}>{AI_STATUS[s.ai.status]}</Badge>}
          <span className="ml-auto flex items-center gap-0.5">
            <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="앞으로" disabled={i === 0} onClick={() => update((x) => void x.scenes.splice(i - 1, 0, x.scenes.splice(i, 1)[0]))} />
            <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="뒤로" disabled={i === p.scenes.length - 1} onClick={() => update((x) => void x.scenes.splice(i + 1, 0, x.scenes.splice(i, 1)[0]))} />
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="장면 지우기" onClick={async () => {
              if (s.ai?.status === "generating" && !(await ask({ title: "생성 중인 장면입니다", message: "장면을 지워도 생성 작업은 계속되고 비용이 청구될 수 있습니다. 먼저 작업을 취소하세요.", confirmLabel: "그래도 지우기", tone: "danger" }))) return;
              update((x) => { x.scenes.splice(i, 1); x.script.lines.forEach((l) => { if (l.sceneId === s.id) l.sceneId = null; }); });
            }} />
          </span>
        </div>

        <FormRow className="grid-cols-1 sm:grid-cols-[150px_minmax(0,1fr)_120px]">
          <Field label="종류">
            <Select size="sm" aria-label="장면 종류" value={s.kind} onChange={(e) => set((x) => {
              const k = e.target.value as SceneKind;
              x.kind = k;
              if (k === "ai" && !x.ai) x.ai = { prompt: "", status: "draft", jobId: null, fileId: null, model: null, reviewNote: "" };
            })}>
              <option value="clip">원본 클립</option>
              <option value="ai">AI 생성</option>
              <option value="image">사진</option>
              <option value="blank">빈 화면 (글자만)</option>
            </Select>
          </Field>
          <Field label="장면 이름">
            <Input size="sm" aria-label="장면 이름" value={s.label} onChange={(e) => set((x) => void (x.label = e.target.value))} />
          </Field>
          <Field label="길이 (초)" hint={lengthLocked ? "구간 길이" : undefined}>
            <NumberInput size="sm" decimal aria-label="장면 길이" value={s.duration} disabled={lengthLocked} onValueChange={(r) => set((x) => void (x.duration = Math.max(0.1, Number(r) || 0.1)))} />
          </Field>
        </FormRow>

        <div className="rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] leading-relaxed">
          <span className="mr-1.5 font-medium text-nd-fg-3">대본</span>
          {lines.length > 0 ? <span className="text-nd-fg-2">{lines.map((l) => `「${l.text}」`).join(" ")}</span> : <span className="text-nd-fg-3">이 장면에 이어진 대본 줄이 없습니다</span>}
        </div>

        {s.kind === "clip" && (
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label="원본 파일">
              <Select size="sm" value={s.clip?.fileId ?? ""} onChange={(e) => set((x) => {
                const m = media.find((mm) => mm.id === e.target.value);
                x.clip = e.target.value ? { fileId: e.target.value, start: 0, end: Math.min(m?.duration ?? x.duration, x.duration || 3), sourceId: null, segmentId: null } : null;
                if (x.clip) x.duration = Math.round((x.clip.end - x.clip.start) * 1000) / 1000;
              })}>
                <option value="">(고르기)</option>
                {fileMedia.map((m) => <option key={m.id} value={m.id}>{mediaLabel(m)}</option>)}
              </Select>
            </Field>
            <Field label="구간 시작 (초)"><NumberInput size="sm" decimal value={s.clip?.start ?? 0} disabled={!s.clip} onValueChange={(r) => set((x) => { if (!x.clip) return; x.clip.start = Math.max(0, Number(r) || 0); x.duration = Math.max(0.1, Math.round((x.clip.end - x.clip.start) * 1000) / 1000); })} /></Field>
            <Field label="구간 끝 (초)" error={clipMedia?.duration && s.clip && s.clip.end > clipMedia.duration + 0.01 ? `원본 ${clipMedia.duration.toFixed(1)}초` : undefined}>
              <NumberInput size="sm" decimal value={s.clip?.end ?? 0} disabled={!s.clip} onValueChange={(r) => set((x) => { if (!x.clip) return; x.clip.end = Math.max(x.clip.start + 0.1, Number(r) || 0); x.duration = Math.round((x.clip.end - x.clip.start) * 1000) / 1000; })} />
            </Field>
            <FieldAction center>
              <Checkbox label="원본 소리" checked={s.keepAudio} onChange={(e) => set((x) => void (x.keepAudio = e.target.checked))} />
            </FieldAction>
          </FormRow>
        )}
        {s.kind === "clip" && fileMedia.length === 0 && <MediaUpload compact projectId={p.id} kind="source" title="원본 영상 올리기" multiple={false} onUploaded={async (ms) => { await onMediaChanged(); set((x) => { x.clip = { fileId: ms[0].id, start: 0, end: Math.min(ms[0].duration ?? 3, 5), sourceId: null, segmentId: null }; x.duration = x.clip.end; }); }} />}

        {s.kind === "image" && (
          <div className="space-y-2">
            {s.image && (
              <p className="truncate text-[13px] text-nd-fg-3" title={media.find((m) => m.id === s.image!.fileId)?.name}>
                사진 파일 <span className="text-nd-body text-nd-fg">{media.find((m) => m.id === s.image!.fileId)?.name ?? "등록됨"}</span>
              </p>
            )}
            <MediaUpload compact projectId={p.id} kind="image" title={s.image ? "사진 바꾸기" : "사진 올리기"} multiple={false} onUploaded={async (ms) => { await onMediaChanged(); set((x) => void (x.image = { fileId: ms[0].id })); }} />
            <p className="text-[13px] text-nd-fg-3">쿠팡 상품 이미지(API 응답)를 내려받아 쓰지 마세요 — 파트너스 Open API 약관은 받은 데이터의 복제를 금지합니다. 직접 찍은 사진 · 이용 허락을 받은 사진을 쓰세요.</p>
          </div>
        )}

        {s.kind === "ai" && s.ai && <AiScene draft={draft} index={i} scene={s} job={job} onMediaChanged={onMediaChanged} />}
      </div>
    </Card>
  );
}

/** 장면 썸네일 — 붙은 파일이 있으면 실제 장면(영상은 장면 길이 표시), 없으면 종류 아이콘 상자 */
function SceneThumb({ scene: s, index: i, media }: { scene: Scene; index: number; media: MediaView[] }) {
  const id = s.kind === "clip" ? s.clip?.fileId : s.kind === "ai" ? s.ai?.fileId : s.kind === "image" ? s.image?.fileId : null;
  const m = id ? media.find((x) => x.id === id) : null;
  const type = m?.type ?? (s.kind === "image" ? "image/*" : "video/mp4");
  const box = "aspect-[9/16] w-[88px] rounded-nd-md";
  if (s.kind === "blank") {
    return (
      <div className={`${box} flex shrink-0 flex-col items-center justify-center gap-1 bg-gradient-to-b from-[#1f2937] to-[#0b0b0f] text-white/70`} aria-label={`#${i + 1} 빈 화면`}>
        <Type size={20} aria-hidden />
        <span className="text-[12px]">글자만</span>
      </div>
    );
  }
  return (
    <div className="shrink-0">
      <MediaThumb
        id={id ?? null}
        type={type}
        duration={id ? s.duration : null}
        alt={`#${i + 1} ${s.label}`}
        icon={s.kind === "ai" ? WandSparkles : s.kind === "image" ? ImageIcon : Film}
        className={box}
      />
      {!id && <p className="mt-1 w-[88px] text-center text-[12px] text-nd-fg-3">파일 없음</p>}
    </div>
  );
}

function AiScene({ draft, index: i, scene: s, job, onMediaChanged }: { draft: Draft; index: number; scene: Scene; job: JobView | null; onMediaChanged: () => Promise<void> }) {
  const { p, update, flush, replace } = draft;
  const { data } = useShorts();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const models = data!.models.video;
  const [model, setModel] = useState(models[0]?.id ?? "");
  const m = models.find((x) => x.id === model) ?? models[0];
  const [duration, setDuration] = useState(m?.durations.find((dd) => dd >= s.duration) ?? m?.durations[0] ?? 4);
  const [resolution, setResolution] = useState(m?.resolutions[m.resolutions.length - 1] ?? "720p");
  const est = m ? (m.usdPerSec !== null ? m.usdPerSec * duration : (((resolution === "480p" ? 480 * 854 : 720 * 1280) * 24 * duration) / 1024) * 0.0000107) : null;
  const ai = s.ai!;
  const { url } = useBlobUrl(ai.fileId);
  const [watch, setWatch] = useState(false);
  // 검토가 필요한 장면은 바로 펼쳐 보여 준다 — 승인 · 반려 뒤에는 「영상 보기」 로 다시 연다
  const showVideo = ai.status === "review" || watch;
  const set = (fn: (x: NonNullable<Scene["ai"]>) => void) => update((x) => { const a = x.scenes[i].ai; if (a) fn(a); });

  const generate = async () => {
    if (!(await ask({ title: "AI 영상을 만들까요?", message: `${m.label} · ${duration}초 · ${resolution} · 예상 비용 약 ${fmtUsd(est)}. 요청을 보낸 뒤에는 취소해도 비용이 청구될 수 있습니다.`, confirmLabel: "만들기" }))) return;
    await run("gen", async () => {
      await flush();
      await shortsPost("jobs", { action: "video.start", projectId: p.id, sceneId: s.id, model: m.id, duration, resolution, confirmed: true });
      notePendingJobs();
      const { project } = await shortsPost<{ project: WithId<ProjectDoc> }>("mutate", { action: "project.get", id: p.id });
      replace(project);
    }, "생성 요청을 대기열에 넣었습니다. 실행기가 처리합니다.");
  };

  return (
    <div className="space-y-3">
      {(ai.model || job) && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-nd-fg-3">
          {ai.model && <span>모델 {ai.model}</span>}
          {job && <JobBadge status={job.status} />}
          {job && ["queued", "running", "waiting"].includes(job.status) && <span>{job.progress.message} · {job.progress.pct}%</span>}
          {job && ["queued", "running", "waiting"].includes(job.status) && (
            <Button size="sm" variant="ghost" onClick={() => void run("cancel", () => shortsPost("jobs", { action: "cancel", id: job.id }), "취소를 요청했습니다.")}>취소</Button>
          )}
        </div>
      )}
      <Field label="영상 프롬프트 (영어 권장 · 확인된 특징만)">
        <Textarea rows={3} value={ai.prompt} disabled={ai.status === "generating"} onChange={(e) => set((a) => void (a.prompt = e.target.value))} placeholder="Vertical 9:16, realistic proportions, a hand unfolds a white metal kitchen rack on a narrow counter, natural light, no text, no logos" />
      </Field>
      {ai.status !== "generating" && (
        <FormRow className="grid-cols-1 sm:grid-cols-[1.4fr_0.8fr_0.8fr_auto]">
          <Field label="모델">
            <Select size="sm" value={model} onChange={(e) => { setModel(e.target.value); const mm = models.find((x) => x.id === e.target.value); if (mm) { setDuration(mm.durations[0]); setResolution(mm.resolutions[mm.resolutions.length - 1]); } }}>
              {models.map((x) => <option key={x.id} value={x.id}>{x.label}{x.usdPerSec ? ` · 초당 $${x.usdPerSec}` : " · 토큰 과금"}</option>)}
            </Select>
          </Field>
          <Field label="길이">
            <Select size="sm" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {m?.durations.map((dd) => <option key={dd} value={dd}>{dd}초</option>)}
            </Select>
          </Field>
          <Field label="해상도">
            <Select size="sm" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {m?.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <FieldAction>
            <Button size="sm" icon={WandSparkles} disabled={!data!.status.openrouter.configured || busy === "gen" || !ai.prompt.trim()} onClick={() => void generate()}>
              {ai.fileId ? "다시 만들기" : "생성"} (약 {fmtUsd(est)})
            </Button>
          </FieldAction>
        </FormRow>
      )}
      {url && (
        <div className="space-y-3 rounded-nd-md border border-nd-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-nd-body font-medium">AI 장면 검토</span>
            {ai.status !== "review" && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setWatch((v) => !v)}>{showVideo ? "영상 닫기" : "영상 보기"}</Button>}
          </div>
          <div className={showVideo ? "grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]" : ""}>
            {showVideo && <video src={url} controls muted playsInline className="aspect-[9/16] w-full max-w-[160px] rounded bg-black object-cover" />}
            <div className="min-w-0 space-y-3">
              {ai.status !== "approved" && <InlineNotice tone="warning">AI 가 만든 장면은 실제 제품의 외형 · 크기 · 기능과 다를 수 있습니다. 쿠팡 상품과 비교해 보고 쓰세요. 다르면 반려하고 다시 만들거나 원본 클립으로 바꾸세요.</InlineNotice>}
              <Field label="검토 메모"><Input size="sm" value={ai.reviewNote} onChange={(e) => set((a) => void (a.reviewNote = e.target.value))} placeholder="예: 손잡이 모양이 실제와 다름" /></Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={ai.status === "approved" ? "primary" : "secondary"} onClick={() => set((a) => void (a.status = "approved"))}>사용 (승인)</Button>
                <Button size="sm" variant="secondary" onClick={() => set((a) => void (a.status = "rejected"))}>반려</Button>
                <Button size="sm" variant="ghost" onClick={() => update((x) => { const sc = x.scenes[i]; sc.kind = "clip"; sc.clip = null; })}>원본 클립으로 바꾸기</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {!data!.status.openrouter.configured && <p className="text-[13px] text-nd-fg-3">OPENROUTER_API_KEY 가 없어 AI 영상을 만들 수 없습니다. 다른 도구로 만든 영상을 「AI 장면 파일 올리기」 로 붙일 수 있습니다.</p>}
      {ai.status !== "generating" && (
        <MediaUpload compact projectId={p.id} kind="ai_scene" title="AI 장면 파일 직접 올리기" multiple={false} onUploaded={async (ms) => { await onMediaChanged(); set((a) => { a.fileId = ms[0].id; a.status = "review"; a.model = null; }); }} />
      )}
    </div>
  );
}

// ---- 내레이션 -----------------------------------------------------------

function NarrationPanel({ draft, media, onMediaChanged }: { draft: Draft; media: MediaView[]; onMediaChanged: () => Promise<void> }) {
  const { p, update, flush } = draft;
  const { data } = useShorts();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const tts = data!.models.tts;
  const [model, setModel] = useState(p.narration.model ?? tts[0]?.id ?? "");
  const mm = tts.find((x) => x.id === model) ?? tts[0];
  const [voice, setVoice] = useState(p.narration.voice ?? mm?.voices[0]?.id ?? "");
  const [speed, setSpeed] = useState(1);
  const chars = p.script.lines.reduce((n, l) => n + l.text.trim().length, 0);
  const stale = p.narration.kind !== "none" && p.narration.scriptHash && p.narration.scriptHash !== scriptHash(p.script.lines);
  const len = narrationLength(p.narration);
  const rec = useRecorder();

  const NARR_KIND = { none: "없음", ai: `AI 음성 ${p.narration.segments.length}줄`, recording: "직접 녹음", file: "음성 파일" } as const;
  const narrFile = media.find((m) => m.id === p.narration.fileId)?.name;

  return (
    <section>
      <SectionHeader size="lg" title="내레이션" hint={p.narration.kind === "none" ? "없음" : `${NARR_KIND[p.narration.kind]} · ${fmtSec(len)}`} />
      <Card className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-nd-md bg-nd-sunken px-3 py-2.5">
          <span className="text-[13px] text-nd-fg-3">지금 쓰는 내레이션</span>
          <Badge size="lg" tone={p.narration.kind === "none" ? "neutral" : "info"}>{NARR_KIND[p.narration.kind]}</Badge>
          {p.narration.kind === "none" ? (
            <span className="text-[13px] text-nd-fg-3">아래에서 AI 음성 · 직접 녹음 · 음성 파일 중 하나를 고르세요</span>
          ) : (
            <>
              {narrFile && <span className="min-w-0 max-w-[280px] truncate text-nd-body" title={narrFile}>{narrFile}</span>}
              <span className="nd-num text-[13px] text-nd-fg-2">{fmtSec(len)}</span>
              {p.narration.kind === "ai" && (
                <span className="flex items-center gap-1.5 text-[13px] text-nd-fg-3">
                  줄 사이 쉼 <NumberInput size="sm" decimal className="w-16" value={p.narration.gapSec} onValueChange={(r) => update((x) => void (x.narration.gapSec = Math.min(1, Math.max(0, Number(r) || 0))))} /> 초
                </span>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => update((x) => void (x.narration = { kind: "none", fileId: null, duration: null, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: null }))}>내레이션 빼기</Button>
            </>
          )}
        </div>
        {stale && <InlineNotice tone="warning">대본이 바뀌었습니다 — 내레이션을 다시 만들거나 녹음해야 자막과 맞습니다.</InlineNotice>}

        <div>
          <h3 className="text-nd-body font-semibold text-nd-fg">AI 음성</h3>
          <p className="mb-3 text-[13px] text-nd-fg-3">대본 한 줄 = 파일 하나 · 자막이 줄 길이에 정확히 맞습니다</p>
          <FormRow className="grid-cols-1 sm:grid-cols-[1.3fr_1fr_0.7fr_auto]">
            <Field label="모델">
              <Select size="sm" value={model} onChange={(e) => { setModel(e.target.value); setVoice(tts.find((x) => x.id === e.target.value)?.voices[0]?.id ?? ""); }}>
                {tts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </Select>
            </Field>
            <Field label="목소리">
              <Select size="sm" value={voice} onChange={(e) => setVoice(e.target.value)}>
                {mm?.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
            </Field>
            <Field label="속도">
              <Select size="sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[0.9, 1, 1.1, 1.2].map((x) => <option key={x} value={x}>{x}배</option>)}
              </Select>
            </Field>
            <FieldAction>
              <Button size="sm" icon={WandSparkles} disabled={!data!.status.openrouter.configured || !chars || busy === "tts"} onClick={async () => {
                const est = mm ? mm.usdPerChar * chars : 0;
                if (!(await ask({ title: "AI 음성을 만들까요?", message: `${p.script.lines.length}줄 · ${chars}자 · 예상 ${fmtUsd(est)} (글자 수 기준). 끝나면 내레이션과 자막이 바뀝니다.`, confirmLabel: "만들기" }))) return;
                await run("tts", async () => {
                  await flush();
                  await shortsPost("jobs", { action: "tts.start", projectId: p.id, model, voice, speed, gapSec: p.narration.gapSec || 0.15, confirmed: true });
                  notePendingJobs();
                }, "음성 생성을 대기열에 넣었습니다.");
              }}>
                줄마다 만들기 (약 {fmtUsd(mm ? mm.usdPerChar * chars : null)})
              </Button>
            </FieldAction>
          </FormRow>
          <p className="mt-1.5 text-[13px] text-nd-fg-3">한국어 목소리가 공식 문서로 확인된 모델만 둡니다 (OpenRouter /audio/speech · 2026-10-31).</p>
        </div>

        <Divider />

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-nd-body font-semibold text-nd-fg">직접 녹음</h3>
            {rec.state === "recording" ? (
              <Button size="sm" variant="danger" icon={Square} onClick={() => void rec.stop()}>녹음 끝 ({fmtSec(rec.elapsed)})</Button>
            ) : (
              <Button size="sm" variant="secondary" icon={Mic} disabled={busy === "rec"} onClick={() => void rec.start()}>녹음 시작</Button>
            )}
            {rec.blob && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <audio src={rec.url ?? undefined} controls className="h-8 max-w-full" />
                <Button size="sm" disabled={busy === "rec"} onClick={() => void run("rec", async () => {
                  const probe = await probeMedia(rec.blob!);
                  const up = await uploadMedia(rec.blob!, { projectId: p.id, kind: "recording", name: `녹음 ${new Date().toLocaleTimeString("ko-KR")}.${rec.blob!.type.includes("mp4") ? "m4a" : "webm"}`, type: rec.blob!.type || "audio/webm", duration: probe.duration });
                  await onMediaChanged();
                  update((x) => { x.narration = { kind: "recording", fileId: up.id, duration: probe.duration, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: scriptHash(x.script.lines) }; x.subtitles = { cues: [], edited: false }; });
                  rec.clear();
                }, "녹음을 내레이션으로 썼습니다.")}>내레이션으로 쓰기</Button>
              </div>
            )}
            {rec.error && <p className="mt-1.5 text-[13px] text-nd-danger-text">{rec.error}</p>}
          </div>
          <div>
            <h3 className="mb-2 text-nd-body font-semibold text-nd-fg">음성 파일</h3>
            <MediaUpload compact projectId={p.id} kind="audio" title="MP3 · WAV · M4A 올리기" multiple={false} onUploaded={async (ms) => {
              await onMediaChanged();
              update((x) => { x.narration = { kind: "file", fileId: ms[0].id, duration: ms[0].duration, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: scriptHash(x.script.lines) }; x.subtitles = { cues: [], edited: false }; });
            }} />
          </div>
        </div>
      </Card>
    </section>
  );
}

function useRecorder() {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const b = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        setBlob(b);
        setUrl(URL.createObjectURL(b));
      };
      r.start(500);
      recRef.current = r;
      const t0 = Date.now();
      timer.current = window.setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
      setState("recording");
    } catch {
      setError("마이크를 쓸 수 없습니다. 브라우저의 마이크 권한을 확인해 주세요.");
    }
  };
  const stop = async () => {
    recRef.current?.stop();
    if (timer.current) window.clearInterval(timer.current);
    setState("idle");
  };
  const clear = () => {
    if (url) URL.revokeObjectURL(url);
    setBlob(null);
    setUrl(null);
    setElapsed(0);
  };
  return { state, blob, url, error, elapsed, start, stop, clear };
}

// ---- 자막 --------------------------------------------------------------

function SubtitlePanel({ draft, media }: { draft: Draft; media: MediaView[] }) {
  const { p, update } = draft;
  const cues = effectiveCues(p);
  const total = timelineSec(p.scenes);
  return (
    <section>
      <SectionHeader
        size="lg"
        title="자막 · 타이밍"
        hint={`${cues.length}줄 · ${p.subtitles.edited ? "사람이 고친 자막" : p.narration.kind === "ai" ? "AI 음성 줄 길이에 맞춤" : "글자 수 비례"}`}
        action={
          <>
            <Button size="sm" variant="secondary" disabled={!cues.length} onClick={() => update((x) => void (x.scenes = fitScenesToCues(x.scenes, x.script.lines, cues, (id) => media.find((m) => m.id === id)?.duration ?? null)))}>
              장면 길이를 내레이션에 맞추기
            </Button>
            <Button size="sm" variant="secondary" icon={Captions} onClick={() => update((x) => void (x.subtitles = { cues: cues.map((c) => ({ ...c })), edited: true }))}>직접 고치기</Button>
            {p.subtitles.edited && (
              <Button size="sm" variant="ghost" onClick={() => update((x) => void (x.subtitles = { cues: x.narration.kind === "ai" ? [] : timeSubtitles(x.script.lines, narrationLength(x.narration) ?? total), edited: false }))}>자동으로 되돌리기</Button>
            )}
          </>
        }
      />
      {cues.length === 0 ? (
        <p className="rounded-nd-lg border border-dashed border-nd-strong px-4 py-5 text-center text-nd-body text-nd-fg-3">대본이 없어 자막이 없습니다.</p>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table size="md">
              <thead>
                <tr>
                  <Th align="right" className="w-[110px]">시작 (초)</Th>
                  <Th align="right" className="w-[110px]">끝 (초)</Th>
                  <Th>자막</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-nd-line">
                {cues.map((c, i) =>
                  p.subtitles.edited ? (
                    <tr key={i}>
                      <Td className="!py-1.5"><NumberInput size="sm" decimal aria-label="시작" value={c.start} onValueChange={(r) => update((x) => void (x.subtitles.cues[i].start = Math.max(0, Number(r) || 0)))} /></Td>
                      <Td className="!py-1.5"><NumberInput size="sm" decimal aria-label="끝" value={c.end} onValueChange={(r) => update((x) => void (x.subtitles.cues[i].end = Math.max(0, Number(r) || 0)))} /></Td>
                      <Td className="!py-1.5"><Input size="sm" aria-label="자막" value={c.text} onChange={(e) => update((x) => void (x.subtitles.cues[i].text = e.target.value))} /></Td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <Td num muted>{c.start.toFixed(2)}</Td>
                      <Td num muted>{c.end.toFixed(2)}</Td>
                      <Td>{c.text}</Td>
                    </tr>
                  ),
                )}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {cues.length > 0 && cues[cues.length - 1].end > total + 0.05 && <InlineNotice tone="warning" className="mt-2">자막({fmtSec(cues[cues.length - 1].end)})이 영상({fmtSec(total)})보다 깁니다 — 넘치는 자막은 잘립니다. 「장면 길이를 내레이션에 맞추기」 를 눌러 보세요.</InlineNotice>}
    </section>
  );
}

// ---- 출력 --------------------------------------------------------------

function OutputPanel({ draft, media, blockers, onMediaChanged }: { draft: Draft; media: MediaView[]; blockers: string[]; onMediaChanged: () => Promise<void> }) {
  const { p, update, flush, replace } = draft;
  const toast = useToast();
  const ask = useConfirm();
  const [progress, setProgress] = useState<{ pct: number; message: string } | null>(null);
  const [support, setSupport] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const renders = media.filter((m) => m.kind === "render").sort((a, b) => b.createdAt - a.createdAt);
  useEffect(() => {
    void canRenderMp4().then(setSupport);
  }, []);

  const start = async () => {
    try {
      await flush();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
      return;
    }
    const sessionId = newId("rs_");
    let jobId: string;
    try {
      jobId = (await shortsPost<{ id: string }>("jobs", { action: "render.start", projectId: p.id, specHash: specHash(p), sessionId })).id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "출력을 시작하지 못했습니다.");
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    let last = 0;
    const beat = (pct: number, message: string) => {
      setProgress({ pct, message });
      if (Date.now() - last > 15_000) {
        last = Date.now();
        void shortsPost("jobs", { action: "render.update", id: jobId, sessionId, pct, message }).catch(() => undefined);
      }
    };
    try {
      const r = await renderProject(p, (id) => loadMedia(id), (pct, message) => beat(Math.round(pct * 0.8), message), ac.signal);
      const up = await uploadMedia(
        r.blob,
        { projectId: p.id, kind: "render", name: `${safeFileName(p.title)}.mp4`, type: "video/mp4", duration: r.duration, width: p.output.width, height: p.output.height, codecs: r.codecs, overlay: r.overlay },
        (f) => beat(80 + Math.round(f * 19), "서버에 올리는 중"),
        ac.signal,
      );
      await shortsPost("jobs", { action: "render.update", id: jobId, sessionId, mediaId: up.id });
      await onMediaChanged();
      const { project } = await shortsPost<{ project: WithId<ProjectDoc> }>("mutate", { action: "project.get", id: p.id });
      replace(project);
      toast.success(`출력 완료 — ${r.codecs.video === "avc" ? "H.264" : r.codecs.video}/${r.codecs.audio === "aac" ? "AAC" : r.codecs.audio} · ${fmtSec(r.duration)}`);
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "AbortError";
      if (cancelled) await shortsPost("jobs", { action: "cancel", id: jobId }).catch(() => undefined);
      else await shortsPost("jobs", { action: "render.update", id: jobId, sessionId, error: e instanceof Error ? e.message : "출력 실패" }).catch(() => undefined);
      if (cancelled) toast.info("출력을 취소했습니다.");
      else toast.error(e instanceof Error ? e.message : "출력하지 못했습니다.");
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const ready = blockers.length === 0 && !!support?.ok;
  return (
    <section>
      <SectionHeader size="lg" title="출력" hint={`H.264/AAC MP4 · ${p.output.width}×${p.output.height} · 완성 파일 ${renders.length}개`} />
      <Card className="space-y-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-nd-body font-semibold text-nd-fg">출력 전 확인</h3>
              {ready ? <Badge tone="success">준비됨</Badge> : support === null && blockers.length === 0 ? <Badge>확인 중</Badge> : <Badge tone="warning">고칠 것 {blockers.length + (support && !support.ok ? 1 : 0)}개</Badge>}
            </div>
            <ul className="space-y-1.5">
              {support && !support.ok && (
                <li className="flex items-start gap-2 text-nd-body text-nd-danger-text"><XCircle size={16} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0">{support.reason}</span></li>
              )}
              {blockers.map((b) => (
                <li key={b} className="flex items-start gap-2 text-nd-body text-nd-warning-text"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0">{b}</span></li>
              ))}
              {blockers.length === 0 && !(support && !support.ok) && (
                <li className="flex items-start gap-2 text-nd-body text-nd-success-text"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0">장면 {p.scenes.length}개 · {fmtSec(timelineSec(p.scenes))} — 출력을 막는 문제가 없습니다.</span></li>
              )}
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="text-nd-body font-semibold text-nd-fg">설정</h3>
            {overlayFor(p) ? (
              <Switch checked={p.output.disclosureOverlay} onChange={(v) => update((x) => void (x.output.disclosureOverlay = v))} label={`영상 안 고지 띠 「${overlayFor(p)}」`} />
            ) : p.kind === "general" ? (
              <p className="text-[13px] text-nd-fg-3">일반 영상(제휴 없음) — 광고가 아니라 영상 안 「광고」 띠가 없습니다. 제휴 링크 · 협찬이 생기면 영상 종류를 바꿔 주세요.</p>
            ) : (
              <p className="text-[13px] text-nd-fg-3">고객사 자기 계정에 올리는 브랜드 영상 — 자기 광고라 영상 안 「광고」 띠가 필요 없습니다. 우리 채널에 올리려면 「고객사」 탭에서 올릴 곳을 바꾸세요.</p>
            )}
            <Switch checked={p.virtualHuman} onChange={(v) => update((x) => void (x.virtualHuman = v))} label={p.kind === "general" ? "AI 가상인물이 나옴 (「가상인물 포함」 표기)" : "AI 가상인물이 나옴 ([가상인물 포함] 표기)"} />
            <div>
              <p className="mb-1 text-[13px] text-nd-fg-2">내레이션이 있을 때 원본 소리</p>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={1} step={0.05} value={p.output.sourceVolume} onChange={(e) => update((x) => void (x.output.sourceVolume = Number(e.target.value)))} className="w-40 accent-nd-accent" aria-label="원본 소리 크기" />
                <span className="nd-num text-[13px] text-nd-fg-2">{Math.round(p.output.sourceVolume * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
        {p.kind === "coupang" && !p.output.disclosureOverlay && <InlineNotice tone="warning">쿠팡 파트너스는 쇼츠에 대해 영상 안 · 유료광고 배너 · 제목 중 하나에 더해 설명란 첫 부분 고지를 요구합니다(공지 160). 띠를 끄면 다른 방법으로 넣었는지 게시 탭에서 직접 확인해야 합니다.</InlineNotice>}

        <Divider />

        {progress ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-nd-fg/10"><div className="h-full bg-nd-accent transition-[width]" style={{ width: `${progress.pct}%` }} /></div>
            <div className="flex items-center justify-between text-[13px] text-nd-fg-2">
              <span>{progress.message} · {progress.pct}%</span>
              <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>취소</Button>
            </div>
            <p className="text-[13px] text-nd-fg-3">출력은 이 창이 합니다. 창을 닫으면 작업이 「중단」 으로 남고, 다시 출력하면 같은 결과가 나옵니다.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={Video} disabled={blockers.length > 0 || !support?.ok} onClick={() => void start()}>MP4 출력</Button>
            <Button variant="secondary" icon={Download} disabled={!p.script.lines.length} onClick={() => downloadBlob(new Blob([scriptText(p)], { type: "text/plain;charset=utf-8" }), `${safeFileName(p.title)} 대본.txt`)}>대본 (.txt)</Button>
            <Button variant="secondary" icon={Captions} disabled={!effectiveCues(p).length} onClick={() => downloadBlob(new Blob([toSrt(effectiveCues(p))], { type: "application/x-subrip;charset=utf-8" }), `${safeFileName(p.title)}.srt`)}>자막 (.srt)</Button>
            {blockers.length > 0 && <span className="text-[13px] text-nd-fg-3">위 확인 목록을 고치면 MP4 출력이 켜집니다</span>}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-nd-body font-semibold text-nd-fg">완성 파일</h3>
          {renders.length > 0 ? (
            <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
              {renders.map((r) => (
                <RenderRow key={r.id} r={r} title={p.title} onDelete={async () => {
                  if (!(await ask({ title: "완성 파일을 지울까요?", message: "이미 게시한 영상은 플랫폼에 그대로 남습니다. 게시 기록의 파일 연결만 끊깁니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                  await deleteMedia(r.id);
                  await onMediaChanged();
                  update((x) => void (x.renderIds = x.renderIds.filter((id) => id !== r.id)));
                }} />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-nd-fg-3">아직 출력한 파일이 없습니다.</p>
          )}
        </div>
      </Card>
    </section>
  );
}

function RenderRow({ r, title, onDelete }: { r: MediaView; title: string; onDelete: () => Promise<void> }) {
  const [show, setShow] = useState(false);
  const { url } = useBlobUrl(show ? r.id : null);
  const { busy, run } = useAction();
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-nd-sm bg-nd-sunken text-nd-fg-3"><Film size={16} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-nd-body font-medium" title={r.name}>{r.name}</p>
          <p className="nd-num text-[13px] text-nd-fg-3">
            {fmtWhen(r.createdAt)} · {fmtSec(r.duration)}{r.width && r.height ? ` · ${r.width}×${r.height}` : ""} · {(r.size / 1024 / 1024).toFixed(1)}MB
          </p>
        </div>
        <Badge tone={r.codecs?.video === "avc" && r.codecs?.audio === "aac" ? "success" : "warning"}>{r.codecs ? `${r.codecs.video ?? "?"}/${r.codecs.audio ?? "?"}` : "코덱 미확인"}</Badge>
        <Badge tone={r.overlay?.disclosure ? "success" : "warning"}>{r.overlay?.disclosure ? "영상 안 고지 있음" : "영상 안 고지 없음"}</Badge>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>{show ? "닫기" : "보기"}</Button>
          <Button size="sm" variant="secondary" icon={Download} disabled={busy === "d"} onClick={() => void run("d", async () => downloadBlob(await loadMedia(r.id), `${safeFileName(title)}.mp4`))}>MP4</Button>
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => void onDelete()} />
        </span>
      </div>
      {show && url && <video src={url} controls playsInline className="mt-2 aspect-[9/16] w-full max-w-[220px] rounded bg-black" />}
    </li>
  );
}

// ---- 작업 -------------------------------------------------------------

function JobsPanel({ jobs }: { jobs: JobView[] }) {
  const { busy, run } = useAction();
  if (!jobs.length) return null;
  const KIND = { ai_video: "AI 영상", tts: "AI 음성", render: "출력", publish: "게시", metrics: "성과" } as const;
  return (
    <section>
      <SectionHeader size="lg" title="작업 기록" hint="생성 · 출력 · 게시의 진행과 결과" />
      <Card padding="none">
        <ul className="divide-y divide-nd-line">
          {jobs.slice(0, 15).map((j) => (
            <li key={j.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-nd-body font-medium">{KIND[j.kind]}</span>
                <JobBadge status={j.status} />
                <span className="min-w-0 text-[13px] text-nd-fg-3">{j.progress.message} · {fmtWhen(j.createdAt)}{j.owner ? ` · ${j.owner.split("@")[0]}` : ""}</span>
                {["queued", "running", "waiting"].includes(j.status) && j.runner === "server" && (
                  <Button size="sm" variant="ghost" className="ml-auto" disabled={busy === j.id} onClick={() => void run(j.id, () => shortsPost("jobs", { action: "cancel", id: j.id }), "취소를 요청했습니다.")}>취소</Button>
                )}
              </div>
              {j.error && <p className="mt-0.5 text-[13px] text-nd-danger-text">{j.error.message}</p>}
              {j.status === "uncertain" && <p className="mt-0.5 text-[13px] text-nd-warning-text">결과를 알 수 없어 자동으로 다시 하지 않았습니다. {j.kind === "ai_video" ? "OpenRouter 사용 내역을 확인하세요." : "플랫폼에서 확인한 뒤 게시 탭에서 기록하세요."}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
