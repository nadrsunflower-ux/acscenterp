"use client";

// 성공 공식 — 잘된 영상의 구성 · 타이밍을 비율로 담은 템플릿. 프로젝트의 「공식·대본」 탭에서 고른다.
//  · 구성 비율 · 길이 · 제품 등장 · CTA 는 참고(원본) 영상을 분석한 값이다.
//  · 아래 「우리 영상 성과」 는 이 공식으로 만든 우리 영상의 기록뿐 — 원본 반응과 섞지 않는다.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, FormRow, Input, PageHeader, PageShell, Select, Textarea, buttonClass, useConfirm } from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { Num, Unknown, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { BEAT_LABEL, CTA_LABEL, compareBy, projectTotals, fmtPct, type CompareRow } from "@/lib/neander/shorts/model";
import type { BeatKey, TemplateDoc } from "@/lib/neander/shorts/types";

type TemplateBeat = TemplateDoc["beats"][number];

/** 구간 색 — 흰 글자와 대비가 나는 진한 색. 색만으로 구분하지 않도록 막대 아래 · 목록에 이름을 함께 둔다 */
const BEAT_COLOR: Record<BeatKey, string> = {
  hook: "#e11d48",
  problem: "#b45309",
  empathy: "#a16207",
  reveal: "#7c3aed",
  demo: "#2563eb",
  compare: "#0e7490",
  twist: "#c026d3",
  proof: "#4d7c0f",
  cta: "#15803d",
};

const BASIS_LABEL = { transcript: "대본", timing: "장면 시각" } as const;

/** 초 — 소수 한 자리까지, 끝의 .0 은 뗀다 */
const sec = (n: number) => `${Math.round(n * 10) / 10}`;

export default function TemplatesPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<WithId<TemplateDoc> | null>(null);
  // 공식별 실제 성과 — 이 공식을 쓴 프로젝트들의 정보 요청률 · 클릭률
  const totals = d.projects.map((p) => ({ project: p, totals: projectTotals(d.metrics.filter((m) => m.projectId === p.id)), templateName: null }));
  const perf = new Map(compareBy("template", totals).map((r) => [r.key, r]));
  // compareBy 는 모르는 값을 0 으로 더한다 — 그 공식의 영상 중 하나라도 그 지표를 아는지 따로 본다 (전부 모르면 「미확인」)
  const known = new Map<string, Known>();
  for (const { project: p, totals: x } of totals) {
    if (p.sample || !p.templateId) continue;
    const k = known.get(p.templateId) ?? { views: false, infoRequests: false, clicks: false };
    known.set(p.templateId, { views: k.views || x.views !== null, infoRequests: k.infoRequests || x.infoRequests !== null, clicks: k.clicks || x.clicks !== null });
  }
  const projectName = new Map(d.projects.map((p) => [p.id, p.title || p.product || "(제목 없음)"]));

  return (
    <PageShell>
      <PageHeader title="성공 공식" description="잘된 쇼츠의 후킹 · 문제 제기 · 제품 등장 · CTA 순서와 타이밍을 비율로 저장해 다른 상품에 옮깁니다. 영상의 「공식·대본」 탭에서 구성 분석을 공식으로 저장합니다." />
      {sc.templates.length === 0 ? (
        <EmptyState
          compact
          icon={Sparkles}
          title="저장한 공식이 없습니다"
          description="영상 → 공식·대본 → 참고 대본 · 장면 시각을 넣고 분석한 뒤 「성공 공식으로 저장」 을 누르세요."
          action={
            <Link href="/neander/shorts/projects" className={buttonClass("secondary", "sm")}>
              영상 목록으로
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {sc.templates.map((t) => {
            const fromProject = t.origin.projectId ? projectName.get(t.origin.projectId) : undefined;
            return (
              <Card key={t.id} as="article" className="flex min-w-0 flex-col gap-4">
                <header className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="min-w-0 truncate text-[17px] font-semibold leading-snug text-nd-fg" title={t.name}>
                      {t.name}
                    </h2>
                    <Badge size="lg" tone={t.visibility === "team" ? "info" : "neutral"} className="shrink-0">
                      {t.visibility === "team" ? "팀 공개" : "나만 보기"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px] text-nd-fg-3">
                    <span>근거: {t.origin.basis.map((b) => BASIS_LABEL[b]).join(" + ") || "직접 작성"}</span>
                    {t.origin.projectId && (
                      <span className="min-w-0 max-w-full truncate">
                        뽑은 영상:{" "}
                        {fromProject ? (
                          <Link href={`/neander/shorts/projects/${t.origin.projectId}`} className="text-nd-fg-2 hover:underline" title={fromProject}>
                            {fromProject}
                          </Link>
                        ) : (
                          "지워졌거나 볼 수 없는 영상"
                        )}
                      </span>
                    )}
                    <span className="ml-auto whitespace-nowrap">
                      {t.owner === d.me ? "나" : nameOf(t.owner)} · {fmtWhen(t.updatedAt)}
                    </span>
                  </div>
                </header>

                <BeatBar beats={t.beats} />

                <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-nd-body">
                  <Spec label="길이">
                    <Num value={t.totalSec} unit="초" />
                  </Spec>
                  <Spec label="제품 등장">
                    {t.productRevealRatio !== null ? (
                      <span className="nd-num">
                        {Math.round(t.productRevealRatio * 100)}% 지점
                        <span className="ml-1 text-[13px] font-normal text-nd-fg-3">약 {sec(t.productRevealRatio * t.totalSec)}초</span>
                      </span>
                    ) : (
                      <Unknown />
                    )}
                  </Spec>
                  <Spec label="평균 컷">
                    <Num value={t.avgShotSec} unit="초" digits={1} />
                  </Spec>
                  <Spec label="CTA">
                    {CTA_LABEL[t.cta.type]}
                    {t.cta.keyword && <span className="ml-1">「{t.cta.keyword}」</span>}
                  </Spec>
                </dl>

                {t.hookPattern && (
                  <blockquote className="rounded-nd-md bg-nd-sunken px-4 py-3 text-nd-body leading-relaxed text-nd-fg">
                    <span className="mr-2 text-[13px] font-medium text-nd-fg-3">후킹</span>
                    {t.hookPattern}
                  </blockquote>
                )}

                {t.beats.length > 0 && (
                  <ol className="space-y-2.5">
                    {t.beats.map((b, i) => (
                      <li key={i} className="grid grid-cols-[24px_76px_minmax(0,1fr)] items-start gap-x-2.5 text-nd-body">
                        <span
                          className="nd-num mt-px inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                          style={{ background: BEAT_COLOR[b.key] }}
                          aria-hidden
                        >
                          {i + 1}
                        </span>
                        <span className="nd-num pt-0.5 text-[13px] text-nd-fg-2" title={`${Math.round(b.from * 100)}~${Math.round(b.to * 100)}%`}>
                          {sec(b.from * t.totalSec)}~{sec(b.to * t.totalSec)}초
                        </span>
                        <div className="min-w-0">
                          <p>
                            <span className="font-semibold">{BEAT_LABEL[b.key]}</span>
                            {b.summary && <span className="text-nd-fg-2"> · {b.summary}</span>}
                          </p>
                          {b.pattern && <p className="mt-0.5 text-[13px] text-nd-fg-3">말 틀 「{b.pattern}」</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                <footer className="mt-auto border-t border-nd-line pt-3">
                  <OurPerformance row={perf.get(t.id)} known={known.get(t.id)} />
                  <div className="mt-3 flex items-center justify-end gap-2">
                    {isReadOnlyFor(t, d.me) && t.owner !== d.me && <span className="mr-auto text-[13px] text-nd-fg-3">읽기 전용 — 만든 사람만 고칠 수 있습니다</span>}
                    {!isReadOnlyFor(t, d.me) && (
                      <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEdit(t)}>
                        고치기
                      </Button>
                    )}
                    {t.owner === d.me && (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        disabled={busy === t.id}
                        onClick={async () => {
                          if (!(await ask({ title: "공식을 지울까요?", message: "이 공식을 쓰던 영상은 「지워진 공식」 으로 남습니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                          await run(t.id, async () => {
                            await mutate("template.delete", { id: t.id });
                            await refresh();
                          });
                        }}
                      >
                        지우기
                      </Button>
                    )}
                  </div>
                </footer>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <EditTemplate t={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await refresh(); }} />}
    </PageShell>
  );
}

/** 구간 비율 막대 — 위치는 from · to 그대로 (사이가 비면 빈 채로 보인다). 이름은 막대 아래에 */
function BeatBar({ beats }: { beats: TemplateBeat[] }) {
  if (!beats.length) return <p className="rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] text-nd-fg-3">구간 정보가 없습니다.</p>;
  const seg = beats.map((b) => {
    const left = Math.min(100, Math.max(0, b.from * 100));
    const width = Math.max(1.5, Math.min(100 - left, (b.to - b.from) * 100));
    return { b, left, width, pct: Math.round((b.to - b.from) * 100) };
  });
  return (
    <div>
      <div
        className="relative h-8 overflow-hidden rounded-nd-md bg-nd-fg/[.06]"
        role="img"
        aria-label={`구간 비율: ${seg.map((s) => `${s.b.label || BEAT_LABEL[s.b.key]} ${s.pct}%`).join(", ")}`}
      >
        {seg.map(({ b, left, width, pct }, i) => (
          <div
            key={i}
            className="nd-num absolute inset-y-0 flex items-center justify-center overflow-hidden border-r-2 border-white text-[13px] font-semibold text-white last:border-r-0"
            style={{ left: `${left}%`, width: `${width}%`, background: BEAT_COLOR[b.key] }}
            title={`${b.label || BEAT_LABEL[b.key]} ${Math.round(b.from * 100)}~${Math.round(b.to * 100)}%`}
          >
            {width >= 9 ? `${pct}%` : ""}
          </div>
        ))}
      </div>
      <div className="relative mt-1.5 h-5" aria-hidden>
        {seg.map(({ b, left, width }, i) => (
          <span
            key={i}
            className="absolute top-0 truncate px-0.5 text-center text-[13px] font-medium text-nd-fg-2"
            style={{ left: `${left}%`, width: `${width}%` }}
            title={b.label || BEAT_LABEL[b.key]}
          >
            {width >= 7 ? b.label || BEAT_LABEL[b.key] : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[13px] text-nd-fg-3">{label}</dt>
      <dd className="font-medium text-nd-fg">{children}</dd>
    </div>
  );
}

type Known = { views: boolean; infoRequests: boolean; clicks: boolean };

/** 이 공식으로 만든 우리 영상의 성과 (예시 영상 제외) — 모르는 값은 「미확인」 */
function OurPerformance({ row, known }: { row: CompareRow | undefined; known: Known | undefined }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold text-nd-fg-2">우리 영상 성과</p>
      {!row ? (
        <p className="text-[13px] text-nd-fg-3">아직 이 공식으로 만든 영상의 성과가 없습니다.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <PerfCell label="쓴 영상">
              <Num value={row.projects} unit="개" />
            </PerfCell>
            <PerfCell label="조회">{!known?.views ? <Unknown /> : <Num value={row.views} />}</PerfCell>
            <PerfCell label="정보 요청률">{row.infoRate === null || !known?.infoRequests ? <Unknown /> : <span className="nd-num">{fmtPct(row.infoRate)}</span>}</PerfCell>
            <PerfCell label="클릭률">{row.ctr === null || !known?.clicks ? <Unknown /> : <span className="nd-num">{fmtPct(row.ctr)}</span>}</PerfCell>
          </dl>
          {row.partial > 0 && <p className="mt-1 text-[13px] text-nd-fg-3">영상 {row.partial}개는 일부 지표(클릭 · 주문 등)가 미확인입니다 — 모르는 값은 합계에 넣지 않았습니다.</p>}
        </>
      )}
    </div>
  );
}

function PerfCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-nd-fg-3">{label}</dt>
      <dd className="text-nd-body font-semibold text-nd-fg">{children}</dd>
    </div>
  );
}

function EditTemplate({ t, onClose, onSaved }: { t: WithId<TemplateDoc>; onClose: () => void; onSaved: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [x, setX] = useState(structuredClone(t));
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="공식 고치기"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          <Button disabled={busy === "s"} onClick={() => void run("s", async () => { await mutate("template.save", { id: t.id, template: x }); await onSaved(); }, "저장했습니다.")}>저장</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1fr]">
          <Field label="이름"><Input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} /></Field>
          <Field label="공개 범위">
            <Select value={x.visibility} onChange={(e) => setX({ ...x, visibility: e.target.value as "private" | "team" })}>
              <option value="private">나만 보기</option>
              <option value="team">팀 보기</option>
            </Select>
          </Field>
        </FormRow>
        <Field label="후킹 방식"><Input value={x.hookPattern} onChange={(e) => setX({ ...x, hookPattern: e.target.value })} /></Field>
        {x.beats.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-nd-fg-2">구간별 말 틀 — 다른 상품에 옮길 때 쓰는 문장</p>
            <div className="space-y-2">
              {x.beats.map((b, i) => (
                <div key={i} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <span className="flex items-center gap-2 text-nd-body font-medium">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: BEAT_COLOR[b.key] }} aria-hidden />
                    {BEAT_LABEL[b.key]}
                    <span className="nd-num text-[13px] font-normal text-nd-fg-3">
                      {Math.round(b.from * 100)}~{Math.round(b.to * 100)}%
                    </span>
                  </span>
                  <Input value={b.pattern} aria-label={`${b.label} 말 틀`} onChange={(e) => { const beats = [...x.beats]; beats[i] = { ...b, pattern: e.target.value }; setX({ ...x, beats }); }} />
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label="메모"><Textarea rows={3} value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
