"use client";

// ============================================================
//  성공 공식 — 잘된 영상의 구성 · 타이밍을 비율로 담은 템플릿. 영상의 「공식·대본」 탭에서 고른다. (2026-11-04 목업 10)
// ------------------------------------------------------------
//  카드: 이름 · 공개 범위 · 근거 → 「참고 영상 구성」(구성 비율 막대 · 초 단위 구간 · 총 길이 · 평균 컷 · 제품 첫 등장 ·
//  내레이션/자막 · 훅 패턴 · 구간별 말 틀 · 행동 유도) → 「우리 영상 성과」(정보 요청률 · 클릭률 · 미확인) → 고치기 · 대본 작성기로.
//  아래 「공식의 실제 성과 비교」 표.
//  · 구성 비율 · 길이 · 제품 등장 · CTA 는 참고(원본) 영상을 분석한 값이다.
//  · 「우리 영상 성과」 는 지금 프로젝트에서 이 공식으로 만든 우리 영상의 기록뿐 — 원본 반응과 섞지 않는다.
//  · 막대는 색만으로 구분하지 않는다 — 칸 안 이름(좁으면 번호) · 아래 초 눈금 · 같은 번호의 구간 목록.
// ============================================================

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { FolderOpen, PenLine, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Field, FormRow, Input, PageShell, Select, Textarea, buttonClass, useConfirm } from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { Num, Unknown, useAction } from "@/components/neander/shorts/parts";
import { RecordTable, StudioCard, StudioHeader, StudioNotice, VisibilityChip, type RecordColumn } from "@/components/neander/shorts/studio";
import { KeywordBar } from "@/components/neander/shorts/KeywordBar";
import { mutate } from "@/lib/neander/shorts/client";
import { BEAT_LABEL, CTA_LABEL, compareBy, projectTotals, fmtPct, type CompareRow } from "@/lib/neander/shorts/model";
import type { BeatKey, PerfSource, TemplateDoc } from "@/lib/neander/shorts/types";

type TemplateBeat = TemplateDoc["beats"][number];
type Template = WithId<TemplateDoc>;

/** 구간 색 — 흰 글자와 대비가 나는 진한 색. 색만으로 구분하지 않도록 칸 안 이름 · 번호 · 목록을 함께 둔다 */
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

const BASIS_LABEL = { transcript: "원본 대본", timing: "장면 시각" } as const;

/** 자막 ↔ 내레이션 (분석의 narrationSubtitle) */
const NARRATION_LABEL: Record<TemplateDoc["narrationSubtitle"], string> = {
  same: "자막 = 내레이션 그대로",
  summary: "자막은 내레이션 요약",
  keywords: "자막은 핵심 낱말만",
  none: "자막 없음",
  unknown: "미확인",
};

const SOURCE_NAME: Record<PerfSource, string> = { youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡", manual: "직접 입력" };

/** 초 — 소수 한 자리까지, 끝의 .0 은 뗀다 */
const sec = (n: number) => `${Math.round(n * 10) / 10}`;

/** 한국 시각 「11/3 (화)」 */
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const day = (ms: number) => {
  const k = new Date(ms + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} (${WEEKDAY[k.getUTCDay()]})`;
};

type Known = { views: boolean; infoRequests: boolean; clicks: boolean };

export default function TemplatesPage() {
  const { data, refresh, nameOf, viewer } = useShorts();
  const d = data!;
  const sc = useScoped();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Template | null>(null);
  // 공식별 실제 성과 — 지금 프로젝트에서 이 공식을 쓴 영상들의 정보 요청률 · 클릭률
  const totals = sc.projects.map((p) => ({ project: p, totals: projectTotals(sc.metrics.filter((m) => m.projectId === p.id)), templateName: null }));
  const perf = new Map(compareBy("template", totals).map((r) => [r.key, r]));
  // compareBy 는 모르는 값을 0 으로 더한다 — 그 공식의 영상 중 하나라도 그 지표를 아는지 따로 본다 (전부 모르면 「미확인」)
  const known = new Map<string, Known>();
  for (const { project: p, totals: x } of totals) {
    if (p.sample || !p.templateId) continue;
    const k = known.get(p.templateId) ?? { views: false, infoRequests: false, clicks: false };
    known.set(p.templateId, { views: k.views || x.views !== null, infoRequests: k.infoRequests || x.infoRequests !== null, clicks: k.clicks || x.clicks !== null });
  }
  // 성과 기록의 출처 (공식마다)
  const sources = new Map<string, Set<PerfSource>>();
  const projectTemplate = new Map(sc.projects.filter((p) => !p.sample && p.templateId).map((p) => [p.id, p.templateId as string]));
  for (const m of sc.metrics) {
    const tid = projectTemplate.get(m.projectId);
    if (!tid) continue;
    const set = sources.get(tid) ?? new Set<PerfSource>();
    set.add(m.source);
    sources.set(tid, set);
  }
  const projectName = new Map(sc.projects.map((p) => [p.id, p.title || p.product || "(제목 없음)"]));

  const remove = async (t: Template) => {
    if (!(await ask({ title: "공식을 지울까요?", message: "이 공식을 쓰던 영상은 「지워진 공식」 으로 남습니다.", tone: "danger", confirmLabel: "지우기" }))) return;
    await run(t.id, async () => {
      await mutate("template.delete", { id: t.id });
      await refresh();
    });
  };

  const compareCols: RecordColumn<Template>[] = [
    { key: "name", header: "공식", mobile: "title", className: "w-[34%]", cell: (t) => <span className="font-medium">{t.name}</span> },
    { key: "n", header: "쓴 영상", align: "right", cell: (t) => <Num value={perf.get(t.id)?.projects ?? 0} unit="편" /> },
    {
      key: "views",
      header: "조회",
      align: "right",
      cell: (t) => {
        const r = perf.get(t.id);
        return r && known.get(t.id)?.views ? <Num value={r.views} /> : <Unknown />;
      },
    },
    {
      key: "info",
      header: "정보 요청률",
      align: "right",
      cell: (t) => {
        const r = perf.get(t.id);
        return r && r.infoRate !== null && known.get(t.id)?.infoRequests ? <span className="nd-num">{fmtPct(r.infoRate)}</span> : <Unknown />;
      },
    },
    {
      key: "ctr",
      header: "클릭률",
      align: "right",
      cell: (t) => {
        const r = perf.get(t.id);
        return r && r.ctr !== null && known.get(t.id)?.clicks ? <span className="nd-num">{fmtPct(r.ctr)}</span> : <Unknown />;
      },
    },
    {
      key: "state",
      header: "확인 상태",
      cell: (t) => {
        const r = perf.get(t.id);
        const k = known.get(t.id);
        if (!r) return <Badge tone="neutral" size="lg">사용 전</Badge>;
        if (r.partial > 0 || !k?.views || !k?.infoRequests || !k?.clicks)
          return (
            <span title={r.partial > 0 ? `영상 ${r.partial}편은 일부 지표가 미확인입니다` : "일부 지표를 아직 모릅니다"}>
              <Badge tone="warning" size="lg">
                일부 미확인
              </Badge>
            </span>
          );
        return <Badge tone="success" size="lg">기록 있음</Badge>;
      },
    },
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스 · 기획"
        kickerIcon={FolderOpen}
        title="성공 공식"
        description="잘된 영상의 구성과 타이밍을 저장해 다른 상품에 적용하세요. 영상의 「공식·대본」 탭에서 구성 분석을 공식으로 저장하고, 새 영상에서 고릅니다."
      />
      <KeywordBar use="성공 공식은 키워드로 조사하지 않고 분석한 레퍼런스에서 만듭니다 — 여기서는 보고 고치기만 합니다." />
      {sc.templates.length === 0 ? (
        <EmptyState
          compact
          icon={Sparkles}
          title="저장한 공식이 없습니다"
          description={`영상 → 공식·대본 → 참고 대본 · 장면 시각을 넣고 분석한 뒤 「성공 공식으로 저장」 을 누르세요.${viewer === "mine" ? " 화면 위 「보기」 를 바꾸면 팀이 공개한 공식도 봅니다." : ""}`}
          action={
            <Link href="/neander/shorts/projects" className={buttonClass("secondary", "sm")}>
              영상 목록으로
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          <StudioNotice tone="info" title="구성과 실제 성과를 나란히">
            카드 위쪽 「참고 영상 구성」 은 원본 대본 · 장면 시각을 분석한 값입니다. 아래 「우리 영상 성과」 는 지금 프로젝트에서 이 공식을 쓴 우리 영상만 집계합니다 — 원본 영상의 반응과 섞지 않습니다.
          </StudioNotice>

          <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
            {sc.templates.map((t) => (
              <TemplateCard
                key={t.id}
                t={t}
                me={d.me}
                ownerName={t.owner === d.me ? "나" : nameOf(t.owner)}
                fromProject={t.origin.projectId ? projectName.get(t.origin.projectId) : undefined}
                row={perf.get(t.id)}
                known={known.get(t.id)}
                sources={sources.get(t.id)}
                busy={busy === t.id}
                onEdit={() => setEdit(t)}
                onDelete={() => void remove(t)}
              />
            ))}
          </div>

          <StudioCard flush title="공식의 실제 성과 비교" description="지금 프로젝트의 우리 영상만 · 예시 영상 제외 · 영상 편수는 플랫폼별 게시 건수와 다릅니다">
            <RecordTable rows={sc.templates} columns={compareCols} rowKey={(t) => t.id} ariaLabel="공식의 실제 성과 비교" className="pb-1 max-md:px-4 max-md:pb-4" />
          </StudioCard>

          <StudioNotice tone="info" title="모르는 수치의 처리">
            미확인은 0 과 다릅니다. 정보 요청 · 클릭을 확인한 영상만 각 비율에 넣고, 공개되지 않은 원본 지표로 우리 성과를 채우지 않습니다.
          </StudioNotice>
        </div>
      )}
      {edit && (
        <EditTemplate
          t={edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            await refresh();
          }}
        />
      )}
    </PageShell>
  );
}

function TemplateCard({
  t,
  me,
  ownerName,
  fromProject,
  row,
  known,
  sources,
  busy,
  onEdit,
  onDelete,
}: {
  t: Template;
  me: string;
  ownerName: string;
  fromProject: string | undefined;
  row: CompareRow | undefined;
  known: Known | undefined;
  sources: Set<PerfSource> | undefined;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const readOnly = isReadOnlyFor(t, me);
  const reveal = t.productRevealRatio;
  return (
    <article className="nd-surface flex min-w-0 flex-col rounded-nd-lg px-5 py-4 sm:px-6 sm:py-5" aria-label={`성공 공식 ${t.name}`}>
      <header className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-[17px] font-semibold leading-snug text-nd-fg">{t.name}</h2>
          {!readOnly && (
            <Button variant="ghost" icon={Pencil} onClick={onEdit} className="shrink-0">
              고치기
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-nd-fg-3">
          <VisibilityChip visibility={t.visibility} ownerName={ownerName} readOnly={readOnly && t.owner !== me} />
          <span className="nd-num">{day(t.updatedAt)}</span>
          {t.sample && (
            <Badge tone="warning" size="lg">
              예시 · 실제 수치 아님
            </Badge>
          )}
        </div>
        <p className="mt-1 text-[13px] text-nd-fg-3">
          근거: {t.origin.basis.map((b) => BASIS_LABEL[b]).join(" + ") || "직접 작성"} · 참고 영상 분석값
          {t.origin.projectId && (
            <>
              {" "}
              · 뽑은 영상{" "}
              {fromProject ? (
                <Link href={`/neander/shorts/projects/${t.origin.projectId}`} className="text-nd-fg-2 hover:underline" title={fromProject}>
                  {fromProject}
                </Link>
              ) : (
                "지워졌거나 볼 수 없는 영상"
              )}
            </>
          )}
        </p>
      </header>

      {/* 참고 영상 구성 */}
      <p className="mt-4 text-[13px] font-semibold text-nd-fg-2">참고 영상 구성</p>
      <div className="mt-1.5">
        <BeatBar beats={t.beats} total={t.totalSec} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-nd-line py-3 sm:grid-cols-4">
        <Spec label="총 길이">
          <Num value={t.totalSec} unit="초" />
        </Spec>
        <Spec label="평균 컷">
          <Num value={t.avgShotSec} unit="초" digits={1} />
        </Spec>
        <Spec label="제품 첫 등장" sub={reveal !== null && t.totalSec ? `${sec(reveal * t.totalSec)}초 지점` : undefined}>
          {reveal !== null ? <span className="nd-num">{Math.round(reveal * 100)}%</span> : <Unknown />}
        </Spec>
        <Spec label="행동 유도 시점" sub={CTA_LABEL[t.cta.type]}>
          <Num value={t.cta.atSec} unit="초" digits={1} />
        </Spec>
      </dl>

      {t.hookPattern && (
        <blockquote className="mt-4 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
          <span className="block text-[13px] font-semibold text-nd-fg-2">훅 패턴</span>
          <span className="mt-0.5 block text-nd-body leading-relaxed text-nd-fg">“{t.hookPattern}”</span>
        </blockquote>
      )}

      <div className="mt-3 divide-y divide-nd-line">
        <Line label="내레이션 · 자막">{NARRATION_LABEL[t.narrationSubtitle] ?? "미확인"}</Line>
        <Line label="행동 유도 (CTA)">
          {CTA_LABEL[t.cta.type]}
          {t.cta.keyword && <> · 「{t.cta.keyword}」</>}
          {t.cta.wording && <> · “{t.cta.wording}”</>}
        </Line>
        {t.notes && <Line label="메모">{t.notes}</Line>}
      </div>

      {t.beats.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="구간별 내용 · 말 틀">
          {t.beats.map((b, i) => (
            <li key={i} className="grid grid-cols-[24px_84px_minmax(0,1fr)] items-start gap-x-2.5 text-nd-body">
              <span className="nd-num mt-px inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: BEAT_COLOR[b.key] }} aria-hidden>
                {i + 1}
              </span>
              <span className="nd-num pt-0.5 text-[13px] text-nd-fg-2" title={`${Math.round(b.from * 100)}~${Math.round(b.to * 100)}%`}>
                {sec(b.from * t.totalSec)}~{sec(b.to * t.totalSec)}초
              </span>
              <div className="min-w-0">
                <p>
                  <span className="font-semibold">{b.label || BEAT_LABEL[b.key]}</span>
                  {b.summary && <span className="text-nd-fg-2"> · {b.summary}</span>}
                </p>
                {b.pattern && <p className="mt-0.5 text-[13px] text-nd-fg-3">말 틀 「{b.pattern}」</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* 우리 영상 성과 */}
      <section className="mt-4 border-t border-nd-line pt-4" aria-label="이 공식을 쓴 우리 영상 성과">
        <p className="text-[14px] font-semibold text-nd-fg">이 공식을 쓴 우리 영상 성과</p>
        <p className="mt-0.5 text-[13px] text-nd-fg-3">
          {row ? (
            <>
              쓴 영상 {row.projects}편 · 조회 {known?.views ? row.views.toLocaleString("ko-KR") : "미확인"}
              {sources?.size ? ` · 출처: ${[...sources].map((s) => SOURCE_NAME[s]).join(" + ")}` : " · 성과 기록 없음"}
            </>
          ) : (
            "아직 이 공식으로 만든 영상이 없습니다."
          )}
        </p>
        <dl className="mt-2.5 grid grid-cols-2 gap-3">
          <PerfTile label="정보 요청률">{row && row.infoRate !== null && known?.infoRequests ? <span className="nd-num">{fmtPct(row.infoRate)}</span> : <Unknown />}</PerfTile>
          <PerfTile label="클릭률">{row && row.ctr !== null && known?.clicks ? <span className="nd-num">{fmtPct(row.ctr)}</span> : <Unknown />}</PerfTile>
        </dl>
        {row && row.partial > 0 && <p className="mt-1.5 text-[13px] text-nd-fg-3">영상 {row.partial}편은 일부 지표(클릭 · 주문 등)가 미확인입니다 — 모르는 값은 합계에 넣지 않았습니다.</p>}
      </section>

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Link href="/neander/shorts/scripts?new=1" className={buttonClass("primary", "md", "gap-1.5")} title="대본 작성기 → 새 대본 → 「참고할 분석」 에서 이 공식을 고르세요">
          <PenLine size={16} aria-hidden />
          대본 작성기로
        </Link>
        {readOnly && t.owner !== me && <span className="text-[13px] text-nd-fg-3">읽기 전용 — 만든 사람만 고칠 수 있습니다</span>}
        {t.owner === me && (
          <Button variant="ghost" icon={Trash2} disabled={busy} onClick={onDelete} className="ml-auto text-nd-danger-text">
            지우기
          </Button>
        )}
      </footer>
    </article>
  );
}

/**
 * 구성 비율 막대 — 위치는 from · to 그대로 (사이가 비면 빈 채로 보인다).
 * 칸 안에 구간 이름(좁으면 번호 — 아래 목록과 같은 번호), 막대 아래에 초 눈금.
 */
function BeatBar({ beats, total }: { beats: TemplateBeat[]; total: number }) {
  if (!beats.length) return <p className="rounded-nd-md bg-nd-sunken px-3 py-2 text-[13px] text-nd-fg-3">구간 정보가 없습니다.</p>;
  const seg = beats.map((b, i) => {
    const left = Math.min(100, Math.max(0, b.from * 100));
    const width = Math.max(1.5, Math.min(100 - left, (b.to - b.from) * 100));
    return { b, i, left, width, name: b.label || BEAT_LABEL[b.key] };
  });
  // 초 눈금 — 구간 경계마다. 가까이 붙은 것은 글자를 빼고 금만
  const marks = [...new Set([...beats.map((b) => b.from), beats[beats.length - 1].to].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000))].sort((a, b) => a - b);
  let lastShown = -1;
  const ticks = marks.map((m, i) => {
    const pct = m * 100;
    const show = i === 0 || i === marks.length - 1 ? true : pct - lastShown >= 8 && 100 - pct >= 8;
    if (show) lastShown = pct;
    return { pct, show, label: total ? `${sec(m * total)}초` : `${Math.round(pct)}%` };
  });
  return (
    <div>
      <div
        className="relative h-10 overflow-hidden rounded-nd-md bg-nd-sunken ring-1 ring-inset ring-nd-line"
        role="img"
        aria-label={`구성 비율: ${seg.map((s) => `${s.i + 1}. ${s.name} ${total ? `${sec(s.b.from * total)}~${sec(s.b.to * total)}초` : `${Math.round(s.b.from * 100)}~${Math.round(s.b.to * 100)}%`}`).join(", ")}`}
      >
        {seg.map(({ b, i, left, width, name }) => (
          <div
            key={i}
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r-2 border-white px-1 text-[13px] font-semibold text-white last:border-r-0"
            style={{ left: `${left}%`, width: `${width}%`, background: BEAT_COLOR[b.key] }}
            title={`${i + 1}. ${name} · ${total ? `${sec(b.from * total)}~${sec(b.to * total)}초` : ""} (${Math.round(b.from * 100)}~${Math.round(b.to * 100)}%)`}
          >
            <span className="truncate">{width >= 9 ? name : width >= 3.5 ? i + 1 : ""}</span>
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-5" aria-hidden>
        {ticks.map((k, i) => (
          <span
            key={i}
            className={`nd-num absolute top-0 whitespace-nowrap text-[13px] text-nd-fg-3 ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${k.pct}%` }}
          >
            {k.show ? k.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function Spec({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-nd-fg-3">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold text-nd-fg">{children}</dd>
      {sub && <dd className="nd-num text-[13px] text-nd-fg-3">{sub}</dd>}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="py-2.5 text-[14px] leading-relaxed first:pt-1">
      <span className="font-semibold text-nd-fg">{label}</span>
      <span className="text-nd-fg-3"> · </span>
      <span className="text-nd-fg-2">{children}</span>
    </p>
  );
}

function PerfTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
      <dt className="text-[13px] text-nd-fg-3">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold text-nd-fg">{children}</dd>
    </div>
  );
}

function EditTemplate({ t, onClose, onSaved }: { t: Template; onClose: () => void; onSaved: () => Promise<void> }) {
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
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button
            disabled={busy === "s"}
            onClick={() =>
              void run(
                "s",
                async () => {
                  await mutate("template.save", { id: t.id, template: x });
                  await onSaved();
                },
                "저장했습니다.",
              )
            }
          >
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1fr]">
          <Field label="이름">
            <Input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} />
          </Field>
          <Field label="공개 범위">
            <Select value={x.visibility} onChange={(e) => setX({ ...x, visibility: e.target.value as "private" | "team" })}>
              <option value="private">나만 보기</option>
              <option value="team">팀 공개</option>
            </Select>
          </Field>
        </FormRow>
        <Field label="훅 패턴 (첫 1~3초)">
          <Input value={x.hookPattern} onChange={(e) => setX({ ...x, hookPattern: e.target.value })} />
        </Field>
        {x.beats.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-nd-fg-2">구간별 말 틀 — 다른 상품에 옮길 때 쓰는 문장</p>
            <div className="space-y-2">
              {x.beats.map((b, i) => (
                <div key={i} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[200px_minmax(0,1fr)]">
                  <span className="flex items-center gap-2 text-nd-body font-medium">
                    <span className="nd-num inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: BEAT_COLOR[b.key] }} aria-hidden>
                      {i + 1}
                    </span>
                    {b.label || BEAT_LABEL[b.key]}
                    <span className="nd-num text-[13px] font-normal text-nd-fg-3">
                      {Math.round(b.from * 100)}~{Math.round(b.to * 100)}%
                    </span>
                  </span>
                  <Input
                    value={b.pattern}
                    aria-label={`${b.label || BEAT_LABEL[b.key]} 말 틀`}
                    onChange={(e) => {
                      const beats = [...x.beats];
                      beats[i] = { ...b, pattern: e.target.value };
                      setX({ ...x, beats });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label="메모">
          <Textarea rows={3} value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
