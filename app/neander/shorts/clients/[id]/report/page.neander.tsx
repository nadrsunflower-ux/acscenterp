"use client";

// ============================================================
//  고객사 월간 보고 — 인쇄용 (브라우저 인쇄 → PDF 로 고객사에 보낸다)
// ------------------------------------------------------------
//  그 달 계약분 영상: 진행 · 승인 · 수정 사용 · 게시 링크 · 성과(출처 표시) · 다음 달 제안.
//  성과는 기록된 값만 — 게시했는데 모르는 값은 「미확인」, 게시 전이라 해당 없으면 「—」.
//  조회수는 계약상 약속 사항이 아니라고 적는다.
//  다음 달 제안은 바이럴 형식 정찰의 최근 주간 보고에서 「해외에만 있는 형식」 · 「떠오름」.
//  인쇄할 때는 보고서(article)만 A4 세로로 찍는다 — 셸 · 버튼은 감춘다.
// ============================================================

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, Printer } from "lucide-react";
import { Button, EmptyState, PageShell, buttonClass, cn } from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { shortsGet } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, REVIEW_LABEL, currentMonth, monthProgress, projectTotals } from "@/lib/neander/shorts/model";
import type { ReportFormatLine, ScoutReportDoc } from "@/lib/neander/shorts/scout";

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}

const KOREA: Record<string, string> = { unchecked: "국내 미확인", none_in_sample: "국내 표본에 없음", some: "국내에 조금", spread: "국내에 퍼짐" };
const STAGE: Record<string, string> = { seed: "씨앗", rising: "떠오름", steady: "유지", saturating: "포화 조짐", faded: "식음", unknown: "모름" };
const REVIEW_TEXT: Record<string, string> = { approved: "text-emerald-700", revision: "text-red-700", waiting: "text-amber-700", none: "text-neutral-500" };

/** 인쇄 — 보고서만 A4 세로로. 셸(사이드바 · 상단바)은 보이지 않게 하고 보고서를 맨 위로 */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 14mm 12mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .shorts-report, .shorts-report * { visibility: visible; }
  .shorts-report { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; }
  .shorts-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .shorts-report section, .shorts-report tr { break-inside: avoid; }
}
`;

const fmtN = (n: number) => n.toLocaleString("ko-KR");
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

/** 성과 칸 — 기록이 없으면 「미확인」 (0 이 아니다) */
const Perf = ({ v }: { v: number | null }) =>
  v === null ? <span className="text-neutral-400" title="공개되지 않았거나 아직 확인하지 않은 값입니다 (0 이 아닙니다)">미확인</span> : <>{fmtN(v)}</>;

function H2({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-neutral-900 pb-1.5">
      <h2 className="text-[17px] font-semibold">{children}</h2>
      {note && <span className="text-[13px] text-neutral-500">{note}</span>}
    </div>
  );
}

const th = "py-2 pr-3 font-medium";
const td = "py-2 pr-3 align-top";

function Report() {
  const { id } = useParams<{ id: string }>();
  const month = useSearchParams().get("month") ?? currentMonth();
  const { data, nameOf } = useShorts();
  const d = data!;
  const c = d.clients.find((x) => x.id === id);
  const [scout, setScout] = useState<ScoutReportDoc | null>(null);
  const [scoutLoaded, setScoutLoaded] = useState(false);
  useCrumbTail(c ? `${c.name} · 월간 보고` : null);
  useEffect(() => {
    shortsGet<{ reports: ScoutReportDoc[] }>("scout").then(
      (r) => setScout(r.reports[0] ?? null),
      () => setScout(null),
    ).finally(() => setScoutLoaded(true));
  }, []);
  const projects = useMemo(() => d.projects.filter((p) => p.clientId === id && p.month === month), [d.projects, id, month]);
  if (!c) {
    return (
      <PageShell>
        <EmptyState title="고객사를 찾지 못했습니다" description="지워졌거나 내가 담당자가 아닌 고객사입니다." action={<Link href="/neander/shorts/clients" className={buttonClass("secondary")}>목록으로</Link>} />
      </PageShell>
    );
  }
  const prog = monthProgress(projects, c.contract.videosPerMonth);
  const revisionsTotal = projects.reduce((n, p) => n + p.review.revisionsUsed, 0);
  const [y, m] = month.split("-");
  const suggestions: ReportFormatLine[] = scout ? [...scout.abroadOnly, ...scout.rising.filter((r) => !scout.abroadOnly.some((a) => a.formatId === r.formatId))].slice(0, 5) : [];

  // 성과 — 게시했거나 기록이 있는 영상만. 쿠팡 지표(클릭 · 주문)는 브랜드 보고에 넣지 않는다
  const perfRows = projects
    .map((p) => {
      const published = d.publications.some((x) => x.projectId === p.id && x.status === "published");
      const snaps = d.metrics.filter((x) => x.projectId === p.id && x.source !== "coupang_api");
      return { p, published, recorded: snaps.length > 0, t: projectTotals(snaps) };
    })
    .filter((r) => r.published || r.recorded);
  const viewsKnown = perfRows.filter((r) => r.t.views !== null);
  const viewsSum = viewsKnown.reduce((n, r) => n + (r.t.views ?? 0), 0);

  return (
    <PageShell>
      <style>{PRINT_CSS}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/neander/shorts/clients/${c.id}`} className="inline-flex items-center gap-1 text-nd-body text-nd-fg-2 hover:text-nd-fg">
          <ChevronLeft size={16} /> {c.name}
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-[13px] text-nd-fg-3 sm:inline">브라우저 인쇄로 A4 세로 PDF 를 만듭니다 — 셸과 버튼은 찍히지 않습니다</span>
          <Button icon={Printer} onClick={() => window.print()}>인쇄 · PDF 저장</Button>
        </div>
      </div>
      <article className="shorts-report space-y-7 rounded-nd-lg bg-white p-6 text-[14px] leading-relaxed text-neutral-900 shadow-sm sm:p-10 print:rounded-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="text-[13px] text-neutral-500">AI STUDIO · 월간 영상 보고</p>
            <h1 className="mt-1 break-words text-[26px] font-bold leading-tight">{c.name} · {y}년 {Number(m)}월</h1>
            <p className="mt-1 text-[13px] text-neutral-500">작성 {new Date().toLocaleDateString("ko-KR")} · 담당 {c.members.map(nameOf).join(", ")}{c.contactName ? ` · 고객사 담당 ${c.contactName}` : ""}</p>
          </div>
        </header>

        <section>
          <H2 note={`계약: 월 ${c.contract.videosPerMonth}편 · 한 편당 수정 ${c.contract.revisionLimit}회`}>이 달 진행</H2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 print:grid-cols-4">
            {[
              ["제작 / 계약", `${prog.made} / ${prog.planned}편`],
              ["고객 승인", `${prog.approved}편`],
              ["게시", `${prog.published}편`],
              ["수정 요청", `${revisionsTotal}회`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-neutral-200 px-4 py-3">
                <p className="text-[13px] text-neutral-500">{k}</p>
                <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-neutral-500">
            지금 검토 대기 {prog.waiting}편 · 수정 요청 중 {prog.revision}편. 「수정 요청」 은 이 달 영상들이 받은 수정 요청의 누적 횟수입니다.
          </p>
        </section>

        <section>
          <H2 note={`${projects.length}편`}>영상</H2>
          {projects.length === 0 ? (
            <p className="text-neutral-500">이 달 영상이 없습니다.</p>
          ) : (
            <table className="w-full border-collapse">
              <colgroup>
                <col className="w-[42%]" />
                <col className="w-[20%]" />
                <col className="w-[8%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-neutral-300 bg-neutral-50 text-left text-[13px] text-neutral-600">
                  <th className={cn(th, "pl-2")}>영상</th>
                  <th className={th}>검토</th>
                  <th className={cn(th, "text-right")}>수정</th>
                  <th className={cn(th, "pl-4 pr-2")}>게시</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const approved = [...p.review.rounds].reverse().find((r) => r.decision === "approved");
                  const pubs = d.publications.filter((x) => x.projectId === p.id && x.status === "published");
                  const product = c.products.find((x) => x.id === p.clientProductId)?.name ?? "";
                  const rounds = p.review.rounds.filter((r) => r.decision !== "withdrawn").length;
                  return (
                    <tr key={p.id} className="border-b border-neutral-100">
                      <td className={cn(td, "pl-2")}>
                        <span className="break-words font-medium">{p.publish.title || p.title}</span>
                        {product && <div className="text-[13px] text-neutral-500">{product}</div>}
                      </td>
                      <td className={cn(td, "whitespace-nowrap")}>
                        <span className={REVIEW_TEXT[p.review.state]}>{REVIEW_LABEL[p.review.state]}</span>
                        {approved?.decidedAt ? <span className="text-neutral-500"> ({fmtDay(approved.decidedAt)})</span> : rounds > 1 ? <span className="text-neutral-500"> ({rounds}차)</span> : null}
                      </td>
                      <td className={cn(td, "whitespace-nowrap text-right tabular-nums", p.review.revisionsUsed > c.contract.revisionLimit && "text-red-700")}>
                        {p.review.revisionsUsed}/{c.contract.revisionLimit}
                      </td>
                      <td className={cn(td, "pl-4 pr-2")}>
                        {pubs.length
                          ? pubs.map((x) => (
                              <div key={x.id} className="break-all">
                                {PLATFORM_LABEL[x.platform]}
                                {x.result?.at ? <span className="text-neutral-500"> {fmtDay(x.result.at)}</span> : null}
                                {x.result?.url ? <> · <a href={x.result.url} className="text-blue-700 underline">{x.result.url}</a></> : ""}
                              </div>
                            ))
                          : <span className="text-neutral-400" title="아직 게시하지 않았습니다">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <H2 note={viewsKnown.length ? `조회 기록 ${viewsKnown.length}편 · 기록된 조회 합계 ${fmtN(viewsSum)}회` : undefined}>게시 성과</H2>
          {perfRows.length === 0 ? (
            <p className="text-neutral-500">아직 게시했거나 성과를 기록한 영상이 없습니다.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-300 bg-neutral-50 text-right text-[13px] text-neutral-600">
                  <th className={cn(th, "pl-2 text-left")}>영상</th>
                  {["조회", "좋아요", "댓글", "저장", "공유"].map((h) => <th key={h} className={th}>{h}</th>)}
                  <th className={cn(th, "pl-4 pr-2 text-left")}>근거</th>
                </tr>
              </thead>
              <tbody>
                {perfRows.map(({ p, recorded, t }) => (
                  <tr key={p.id} className="border-b border-neutral-100 text-right tabular-nums">
                    <td className={cn(td, "pl-2 text-left")}><span className="break-words">{p.publish.title || p.title}</span></td>
                    {[t.views, t.likes, t.comments, t.saves, t.shares].map((v, i) => <td key={i} className={cn(td, "whitespace-nowrap")}><Perf v={v} /></td>)}
                    <td className={cn(td, "pl-4 pr-2 text-left text-[13px] text-neutral-500")}>
                      {recorded ? [...t.sources].map((s) => (s === "manual" ? "직접 확인" : s.replace("_api", " API"))).join(" · ") || "기록 있음 · 값 없음" : "아직 기록 없음"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[13px] text-neutral-500">
            조회수 등 성과는 계약상 약속 사항이 아닙니다. 수치는 플랫폼 API 또는 직접 확인한 값이며, 공개되지 않았거나 아직 확인하지 않은 값은 「미확인」 으로 둡니다 (0 이 아닙니다). 게시 전 영상은 이 표에 넣지 않습니다.
          </p>
        </section>

        <section>
          <H2 note={scout ? `바이럴 형식 정찰 ${scout.week} 보고 기준` : undefined}>다음 달 제안 · 해외에서 먹히는 형식</H2>
          {!scoutLoaded ? (
            <p className="text-neutral-500">정찰 보고를 불러오는 중…</p>
          ) : suggestions.length === 0 ? (
            <p className="text-neutral-500">{scout ? "이번 주 정찰 보고에 제안할 형식이 없습니다." : "정찰 보고를 불러오지 못했거나 아직 없습니다."}</p>
          ) : (
            <ol className="divide-y divide-neutral-100 border-y border-neutral-200">
              {suggestions.map((f, i) => (
                <li key={f.formatId} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-2.5 sm:grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] print:grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="pt-px text-center text-[13px] font-semibold tabular-nums text-neutral-500">{i + 1}</span>
                  <div className="min-w-0">
                    <b>{f.name}</b>
                    <div className="text-[13px] text-neutral-600">{STAGE[f.stage] ?? f.stage} · {f.countries.join("·")} · {KOREA[f.korea] ?? f.korea}</div>
                  </div>
                  <div className="col-start-2 min-w-0 text-[13px] text-neutral-500 sm:col-start-auto print:col-start-auto">
                    {f.basis}
                    {f.top?.url && <div className="truncate">예: <a href={f.top.url} className="underline" title={f.top.title}>{f.top.title.slice(0, 40)}</a></div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {scout && <p className="mt-2 text-[13px] text-neutral-500">「국내 표본에 없음」 은 검색 표본에서 못 찾았다는 뜻이지 국내에 없다는 단정이 아닙니다.</p>}
        </section>
      </article>
    </PageShell>
  );
}
