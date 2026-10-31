"use client";

// ============================================================
//  고객사 월간 보고 — 인쇄용 (브라우저 인쇄 → PDF 로 고객사에 보낸다)
// ------------------------------------------------------------
//  그 달 계약분 영상: 진행 · 승인 · 수정 사용 · 게시 링크 · 성과(출처 표시) · 다음 달 제안.
//  성과는 기록된 값만 (모르면 「—」) — 조회수는 계약상 약속 사항이 아니라고 적는다.
//  다음 달 제안은 바이럴 형식 정찰의 최근 주간 보고에서 「해외에만 있는 형식」 · 「떠오름」.
// ============================================================

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, Printer } from "lucide-react";
import { Button, EmptyState, PageShell } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { shortsGet } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, REVIEW_LABEL, currentMonth, fmtCount, monthProgress, projectTotals } from "@/lib/neander/shorts/model";
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

function Report() {
  const { id } = useParams<{ id: string }>();
  const month = useSearchParams().get("month") ?? currentMonth();
  const { data, nameOf } = useShorts();
  const d = data!;
  const c = d.clients.find((x) => x.id === id);
  const [scout, setScout] = useState<ScoutReportDoc | null>(null);
  useEffect(() => {
    shortsGet<{ reports: ScoutReportDoc[] }>("scout").then((r) => setScout(r.reports[0] ?? null), () => setScout(null));
  }, []);
  const projects = useMemo(() => d.projects.filter((p) => p.clientId === id && p.month === month), [d.projects, id, month]);
  if (!c) return <PageShell><EmptyState title="고객사를 찾지 못했습니다" /></PageShell>;
  const prog = monthProgress(projects, c.contract.videosPerMonth);
  const [y, m] = month.split("-");
  const suggestions: ReportFormatLine[] = scout ? [...scout.abroadOnly, ...scout.rising.filter((r) => !scout.abroadOnly.some((a) => a.formatId === r.formatId))].slice(0, 5) : [];

  return (
    <PageShell width="form" className="print:max-w-none">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/neander/shorts/clients/${c.id}`} className="inline-flex items-center gap-1 text-nd-caption text-nd-fg-3 hover:text-nd-fg"><ChevronLeft size={14} /> {c.name}</Link>
        <Button icon={Printer} onClick={() => window.print()}>인쇄 · PDF 저장</Button>
      </div>
      <article className="space-y-6 rounded-nd-lg bg-white p-8 text-[14px] leading-relaxed text-neutral-900 shadow-sm print:p-0 print:shadow-none">
        <header>
          <p className="text-[12px] text-neutral-500">AI STUDIO · 월간 영상 보고</p>
          <h1 className="mt-1 text-[24px] font-bold">{c.name} · {y}년 {Number(m)}월</h1>
          <p className="text-[13px] text-neutral-500">작성 {new Date().toLocaleDateString("ko-KR")} · 담당 {c.members.map(nameOf).join(", ")}</p>
        </header>

        <section>
          <h2 className="mb-2 text-[16px] font-semibold">이 달 진행</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["제작 / 계약", `${prog.made} / ${prog.planned}편`],
              ["고객 승인", `${prog.approved}편`],
              ["게시", `${prog.published}편`],
              ["수정 요청", `${projects.reduce((n, p) => n + p.review.revisionsUsed, 0)}회`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-neutral-200 p-3">
                <p className="text-[12px] text-neutral-500">{k}</p>
                <p className="text-[18px] font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-neutral-500">계약: 월 {c.contract.videosPerMonth}편 · 한 편당 수정 {c.contract.revisionLimit}회.</p>
        </section>

        <section>
          <h2 className="mb-2 text-[16px] font-semibold">영상</h2>
          {projects.length === 0 ? (
            <p className="text-neutral-500">이 달 영상이 없습니다.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-neutral-300 text-left text-neutral-500">
                  <th className="py-1.5 pr-2 font-medium">영상</th>
                  <th className="py-1.5 pr-2 font-medium">검토</th>
                  <th className="py-1.5 pr-2 text-right font-medium">수정</th>
                  <th className="py-1.5 font-medium">게시</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const approved = [...p.review.rounds].reverse().find((r) => r.decision === "approved");
                  const pubs = d.publications.filter((x) => x.projectId === p.id && x.status === "published");
                  return (
                    <tr key={p.id} className="border-b border-neutral-100 align-top">
                      <td className="py-1.5 pr-2">{p.publish.title || p.title}<div className="text-[12px] text-neutral-500">{c.products.find((x) => x.id === p.clientProductId)?.name ?? ""}</div></td>
                      <td className="py-1.5 pr-2">{REVIEW_LABEL[p.review.state]}{approved?.decidedAt ? ` (${new Date(approved.decidedAt).toLocaleDateString("ko-KR")})` : ""}</td>
                      <td className="py-1.5 pr-2 text-right">{p.review.revisionsUsed}/{c.contract.revisionLimit}</td>
                      <td className="py-1.5">{pubs.length ? pubs.map((x) => <div key={x.id}>{PLATFORM_LABEL[x.platform]} {x.result?.url ? <a href={x.result.url} className="text-blue-700 underline">{x.result.url}</a> : ""}</div>) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[16px] font-semibold">게시 성과</h2>
          {(() => {
            const rows = projects
              .map((p) => ({ p, t: projectTotals(d.metrics.filter((x) => x.projectId === p.id && x.source !== "coupang_api")) }))
              .filter((r) => r.t.views !== null || r.t.likes !== null);
            if (!rows.length) return <p className="text-neutral-500">아직 기록된 성과가 없습니다.</p>;
            return (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-neutral-300 text-right text-neutral-500">
                    <th className="py-1.5 pr-2 text-left font-medium">영상</th>
                    {["조회", "좋아요", "댓글", "저장", "공유"].map((h) => <th key={h} className="py-1.5 pr-2 font-medium">{h}</th>)}
                    <th className="py-1.5 text-left font-medium">근거</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, t }) => (
                    <tr key={p.id} className="border-b border-neutral-100 text-right">
                      <td className="py-1.5 pr-2 text-left">{p.publish.title || p.title}</td>
                      {[t.views, t.likes, t.comments, t.saves, t.shares].map((v, i) => <td key={i} className="py-1.5 pr-2">{fmtCount(v)}</td>)}
                      <td className="py-1.5 text-left text-[12px] text-neutral-500">{[...t.sources].map((s) => (s === "manual" ? "직접 확인" : s.replace("_api", " API"))).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
          <p className="mt-2 text-[12px] text-neutral-500">조회수 등 성과는 계약상 약속 사항이 아닙니다. 수치는 플랫폼 API 또는 직접 확인한 값이며, 모르는 값은 「—」 로 둡니다.</p>
        </section>

        <section>
          <h2 className="mb-2 text-[16px] font-semibold">다음 달 제안 · 해외에서 먹히는 형식</h2>
          {suggestions.length === 0 ? (
            <p className="text-neutral-500">{scout ? "이번 주 정찰 보고에 제안할 형식이 없습니다." : "정찰 보고를 불러오지 못했거나 아직 없습니다."}</p>
          ) : (
            <ul className="space-y-1.5">
              {suggestions.map((f) => (
                <li key={f.formatId}>
                  <b>{f.name}</b> — {STAGE[f.stage] ?? f.stage} · {f.countries.join("·")} · {KOREA[f.korea] ?? f.korea}
                  {f.top?.url && <span className="text-[12px] text-neutral-500"> · 예: <a href={f.top.url} className="underline">{f.top.title.slice(0, 40)}</a></span>}
                </li>
              ))}
            </ul>
          )}
          {scout && <p className="mt-2 text-[12px] text-neutral-500">바이럴 형식 정찰 {scout.week} 보고 기준. 「국내 표본에 없음」 은 검색 표본에서 못 찾았다는 뜻이지 국내에 없다는 단정이 아닙니다.</p>}
        </section>
      </article>
    </PageShell>
  );
}
