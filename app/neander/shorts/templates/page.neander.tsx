"use client";

// 성공 공식 — 잘된 영상의 구성 · 타이밍을 비율로 담은 템플릿. 프로젝트의 「공식·대본」 탭에서 고른다.

import { useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, FormRow, Input, PageHeader, PageShell, Select, Textarea, useConfirm } from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { BEAT_LABEL, CTA_LABEL, compareBy, projectTotals, fmtPct } from "@/lib/neander/shorts/model";
import type { TemplateDoc } from "@/lib/neander/shorts/types";

export default function TemplatesPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<WithId<TemplateDoc> | null>(null);
  // 공식별 실제 성과 — 이 공식을 쓴 프로젝트들의 정보 요청률 · 클릭률
  const perf = new Map(
    compareBy(
      "template",
      d.projects.map((p) => ({ project: p, totals: projectTotals(d.metrics.filter((m) => m.projectId === p.id)), templateName: null })),
    ).map((r) => [r.key, r]),
  );

  return (
    <PageShell>
      <PageHeader title="성공 공식" description="잘된 쇼츠의 후킹 · 문제 제기 · 제품 등장 · CTA 순서와 타이밍을 비율로 저장해 다른 상품에 옮깁니다. 영상의 「공식·대본」 탭에서 구성 분석을 공식으로 저장합니다." />
      {sc.templates.length === 0 ? (
        <EmptyState icon={Sparkles} title="저장한 공식이 없습니다" description="영상 → 공식·대본 → 참고 대본 · 장면 시각을 넣고 분석한 뒤 「성공 공식으로 저장」 을 누르세요." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sc.templates.map((t) => {
            const pr = perf.get(t.id);
            return (
              <Card key={t.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-nd-section">{t.name}</h2>
                  <Badge size="sm">{t.visibility === "team" ? "팀" : "나만"}</Badge>
                  <Badge size="sm" tone="info">근거: {t.origin.basis.map((b) => (b === "transcript" ? "대본" : "장면 시각")).join(" + ") || "직접 작성"}</Badge>
                  <span className="ml-auto text-nd-caption text-nd-fg-3">{t.owner === d.me ? "나" : nameOf(t.owner)} · {fmtWhen(t.updatedAt)}</span>
                </div>
                <div className="flex h-7 overflow-hidden rounded-nd-md">
                  {t.beats.map((b, i) => (
                    <div key={i} className="flex items-center justify-center overflow-hidden border-r border-white/40 text-nd-micro text-white" style={{ width: `${Math.max(4, (b.to - b.from) * 100)}%`, background: `hsl(${(i * 47) % 360} 55% 48%)` }} title={`${b.label} ${Math.round(b.from * 100)}~${Math.round(b.to * 100)}%`}>
                      {b.label}
                    </div>
                  ))}
                </div>
                <p className="text-nd-caption text-nd-fg-2">
                  기준 길이 {t.totalSec}초 · 제품 등장 {t.productRevealRatio !== null ? `${Math.round(t.productRevealRatio * 100)}% 지점` : "모름"} · 평균 컷 {t.avgShotSec ?? "—"}초 · CTA {CTA_LABEL[t.cta.type]}{t.cta.keyword ? ` 「${t.cta.keyword}」` : ""}
                </p>
                {t.hookPattern && <p className="text-nd-body">후킹: {t.hookPattern}</p>}
                <ol className="list-decimal space-y-0.5 pl-5 text-nd-caption text-nd-fg-2">
                  {t.beats.map((b, i) => <li key={i}><b>{BEAT_LABEL[b.key]}</b> {b.summary}{b.pattern ? ` — 「${b.pattern}」` : ""}</li>)}
                </ol>
                <p className="text-nd-caption text-nd-fg-3">
                  {pr ? `쓴 영상 ${pr.projects}개 · 조회 ${pr.views.toLocaleString("ko-KR")} · 정보 요청률 ${fmtPct(pr.infoRate)} · 클릭률 ${fmtPct(pr.ctr)}${pr.partial ? ` · 지표 일부 모름 ${pr.partial}개` : ""}` : "아직 이 공식으로 만든 영상의 성과가 없습니다."}
                </p>
                <div className="flex gap-2">
                  {!isReadOnlyFor(t, d.me) && <Button size="sm" variant="secondary" onClick={() => setEdit(t)}>고치기</Button>}
                  {t.owner === d.me && (
                    <Button size="sm" variant="ghost" icon={Trash2} disabled={busy === t.id} onClick={async () => {
                      if (!(await ask({ title: "공식을 지울까요?", message: "이 공식을 쓰던 영상은 「지워진 공식」 으로 남습니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                      await run(t.id, async () => { await mutate("template.delete", { id: t.id }); await refresh(); });
                    }}>지우기</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <EditTemplate t={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await refresh(); }} />}
    </PageShell>
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
      <div className="space-y-3">
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
        {x.beats.map((b, i) => (
          <FormRow key={i} className="grid-cols-1 sm:grid-cols-[1fr_3fr]">
            <span className="pt-2 text-nd-body font-medium">{BEAT_LABEL[b.key]} {Math.round(b.from * 100)}~{Math.round(b.to * 100)}%</span>
            <Input value={b.pattern} aria-label={`${b.label} 말 틀`} onChange={(e) => { const beats = [...x.beats]; beats[i] = { ...b, pattern: e.target.value }; setX({ ...x, beats }); }} />
          </FormRow>
        ))}
        <Field label="메모"><Textarea rows={3} value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
