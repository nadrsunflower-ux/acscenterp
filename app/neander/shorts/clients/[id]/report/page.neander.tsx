"use client";

// ============================================================
//  고객사 월간 보고 — 인쇄용 한 장 (2026-11 목업 05 개편 · 브라우저 인쇄 → PDF 로 고객사에 보낸다)
// ------------------------------------------------------------
//  그 달 계약분 영상: 제작 / 계약 · 고객 승인(납품 기준) · 게시 · 수정 요청 · 영상마다 승인일 · 게시 링크 ·
//  조회 · 반응(출처 표시) · 수정 사용 · 남은 계획과 다음 달 제안.
//  성과는 기록된 값만 — 게시했는데 모르는 값은 「미확인」, 게시 전이라 해당 없으면 「해당 없음」.
//  조회수는 계약상 약속 사항이 아니라고 적는다. 쿠팡 지표(클릭 · 주문)는 브랜드 보고에 넣지 않는다.
//  다음 달 제안은 바이럴 형식 정찰의 최근 주간 보고에서 「해외에만 있는 형식」 · 「떠오름」.
// ------------------------------------------------------------
//  화면용과 인쇄용 배치를 나눈다 — 화면은 위 막대(돌아가기 · 달 · 인쇄)와 넉넉한 카드,
//  인쇄는 보고서(article)만 A4 가로 한 장. 셸 · 버튼은 display:none 으로 아예 빼서
//  (보이지 않게만 하면 자리를 차지해 빈 쪽이 생긴다) 쪽수가 늘지 않게 한다.
//  영상이 많으면 줄 간격을 줄이고, 더 많으면 인쇄 배율을 낮춰 한 장에 담는다.
// ============================================================

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, EmptyState, MonthStepper, PageShell, ProductWordmark, buttonClass, cn } from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { ProgressLine } from "@/components/neander/shorts/studio";
import { fmtDayKst, vatText } from "@/components/neander/shorts/agency-ui/finance";
import { shortsGet } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, REVIEW_LABEL, currentMonth, latestRound, monthProgress, projectTotals } from "@/lib/neander/shorts/model";
import type { ReportFormatLine, ScoutReportDoc } from "@/lib/neander/shorts/scout";
import type { ProjectDoc } from "@/lib/neander/shorts/types";
import { planText, revisionText } from "@/lib/neander/shorts/plans";

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}

const KOREA: Record<string, string> = { unchecked: "국내 미확인", none_in_sample: "국내 표본에 없음", some: "국내에 조금", spread: "국내에 퍼짐" };
const STAGE: Record<string, string> = { seed: "씨앗", rising: "떠오름", steady: "유지", saturating: "포화 조짐", faded: "식음", unknown: "모름" };
/** 검토 상태 — 색 + 글자 (인쇄에서도 색이 나오게 print-color-adjust) */
const REVIEW_CHIP: Record<ProjectDoc["review"]["state"], string> = {
  approved: "bg-emerald-50 text-emerald-700",
  waiting: "bg-amber-50 text-amber-700",
  revision: "bg-red-50 text-red-700",
  none: "bg-neutral-100 text-neutral-600",
};

/**
 * 인쇄 — 보고서만 A4 가로 한 장.
 * :has() 로 보고서를 품은 조상만 남기고 나머지는 display:none (빈 쪽이 생기지 않게),
 * 조상의 여백 · 높이 · 넘침 잘림을 풀어 보고서가 종이 맨 위에서 시작하게 한다.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  html, body { background: #fff !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body *:not(:has(.shorts-report)):not(.shorts-report):not(.shorts-report *) { display: none !important; }
  *:has(.shorts-report) {
    display: block !important; position: static !important; inset: auto !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important; gap: 0 !important;
    width: auto !important; max-width: none !important; min-width: 0 !important;
    height: auto !important; min-height: 0 !important; max-height: none !important;
    overflow: visible !important; background: #fff !important; box-shadow: none !important;
    transform: none !important; filter: none !important; backdrop-filter: none !important;
  }
  .shorts-report { margin: 0 !important; width: 100% !important; box-shadow: none !important; border: 0 !important; zoom: var(--report-zoom, 1); }
  .shorts-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .shorts-report tr, .shorts-report .report-keep { break-inside: avoid; }
}
`;

const fmtN = (n: number) => n.toLocaleString("ko-KR");

/** 성과 칸 — 게시 전이면 「해당 없음」, 게시했는데 기록이 없으면 「미확인」 (0 이 아니다) */
function Perf({ v, applicable }: { v: number | null; applicable: boolean }) {
  if (!applicable) return <span className="text-neutral-400">해당 없음</span>;
  if (v === null)
    return (
      <span className="text-neutral-500" title="공개되지 않았거나 아직 확인하지 않은 값입니다 (0 이 아닙니다)">
        미확인
      </span>
    );
  return <>{fmtN(v)}</>;
}

function Kpi({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "accent" | "success" | "danger" }) {
  return (
    <div className="report-keep rounded-lg border border-neutral-200 px-4 py-3 print:py-2.5">
      <p className="text-[13px] text-neutral-500">{label}</p>
      <p className={cn("mt-1 text-[26px] font-bold leading-tight tabular-nums print:text-[22px]", tone === "accent" ? "text-[#2570CC]" : tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-700" : "text-neutral-900")}>{value}</p>
      {detail && <p className="mt-0.5 text-[13px] text-neutral-500">{detail}</p>}
    </div>
  );
}

function H2({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[17px] font-bold text-neutral-900 print:text-[15px]">{children}</h2>
      {note && <span className="text-[13px] text-neutral-500">{note}</span>}
    </div>
  );
}

const th = "px-3 py-2.5 text-[13px] font-medium text-neutral-500 print:py-1.5";

function Report() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const month = useSearchParams().get("month") ?? currentMonth();
  const { data, nameOf } = useShorts();
  const d = data!;
  const c = d.clients.find((x) => x.id === id);
  const [scout, setScout] = useState<ScoutReportDoc | null>(null);
  const [scoutLoaded, setScoutLoaded] = useState(false);
  useCrumbTail(c ? `${c.name} · 월간 보고` : null);
  useEffect(() => {
    shortsGet<{ reports: ScoutReportDoc[] }>("scout")
      .then(
        (r) => setScout(r.reports[0] ?? null),
        () => setScout(null),
      )
      .finally(() => setScoutLoaded(true));
  }, []);
  const projects = useMemo(() => d.projects.filter((p) => p.clientId === id && p.month === month), [d.projects, id, month]);
  // 달 넘기기 — 계약 시작 달부터 이번 달까지
  const months = useMemo(() => {
    if (!c) return [month];
    const out: string[] = [];
    const from = c.contract.startMonth < month ? c.contract.startMonth : month;
    const to = currentMonth() > month ? currentMonth() : month;
    let [y, m] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    while ((y < ty || (y === ty && m <= tm)) && out.length < 60) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) (m = 1), y++;
    }
    return out.reverse();
  }, [c, month]);
  if (!c) {
    return (
      <PageShell>
        <EmptyState
          title="고객사를 찾지 못했습니다"
          description="지워졌거나 내가 담당자가 아닌 고객사입니다."
          action={
            <Link href="/neander/shorts/clients" className={buttonClass("secondary")}>
              목록으로
            </Link>
          }
        />
      </PageShell>
    );
  }
  const prog = monthProgress(projects, c.contract.videosPerMonth);
  const revisionsTotal = projects.reduce((n, p) => n + p.review.revisionsUsed, 0);
  const overCap = projects.filter((p) => p.review.revisionsUsed > c.contract.revisionLimit);
  const [y, m] = month.split("-");
  const M = Number(m);
  const left = Math.max(0, prog.planned - prog.made);
  const pct = prog.planned > 0 ? Math.round((prog.made / prog.planned) * 100) : 0;
  const fileOnly = c.delivery === "file";
  const thisMonth = month === currentMonth();
  const suggestions: ReportFormatLine[] = scout ? [...scout.abroadOnly, ...scout.rising.filter((r) => !scout.abroadOnly.some((a) => a.formatId === r.formatId))].slice(0, 5) : [];

  // 영상마다 — 게시 · 성과(쿠팡 지표 빼고). 게시했거나 기록이 있으면 성과 칸이 「해당」
  const rows = projects.map((p) => {
    const pubs = d.publications.filter((x) => x.projectId === p.id && x.status === "published");
    const snaps = d.metrics.filter((x) => x.projectId === p.id && x.source !== "coupang_api");
    return { p, pubs, recorded: snaps.length > 0, t: projectTotals(snaps) };
  });
  const viewsKnown = rows.filter((r) => (r.pubs.length || r.recorded) && r.t.views !== null);
  const viewsSum = viewsKnown.reduce((n, r) => n + (r.t.views ?? 0), 0);

  // 영상이 많으면 인쇄에서 줄을 한 줄로 접고(dense), 그래도 넘치면 배율을 낮춰 한 장에 담는다.
  // 한 장(A4 가로 · 여백 10mm)의 높이는 약 718px. 실측(2026-11-04): 머리 · 4칸 · 계약 · 계획 · 꼬리 약 545px,
  // 영상 한 줄은 접으면 약 31px · 펼치면 약 55px, 다음 달 제안은 형식 하나에 두 줄(약 36px).
  const n = rows.length;
  const dense = n > 3;
  const shownSuggestions = Math.min(3, suggestions.length);
  const fixedPx = 545 + (shownSuggestions ? shownSuggestions * 36 : 0);
  const zoom = Math.max(0.55, Math.min(1, Math.floor((710 / (fixedPx + (dense ? 31 : 55) * n)) * 100) / 100));
  const td = cn("px-3 align-top", dense ? "py-2.5 print:overflow-hidden print:text-ellipsis print:whitespace-nowrap print:py-1" : "py-3 print:py-1.5");
  /** 접은 인쇄에서 빼는 둘째 줄 */
  const sub = dense ? "print:hidden" : "";

  const plan: string[] = [
    prog.waiting ? `고객 검토 회신 대기 ${prog.waiting}편` : "",
    prog.revision ? `수정 요청 반영 ${prog.revision}편` : "",
    overCap.length ? `수정 상한을 넘은 ${overCap.length}편은 범위 협의` : "",
    left ? `남은 제작 ${left}편` : "",
    !fileOnly && prog.approved > prog.published ? `승인된 ${prog.approved - prog.published}편 게시` : "",
    fileOnly && prog.approved ? `승인된 ${prog.approved}편 완성 파일 전달` : "",
  ].filter(Boolean);

  return (
    <PageShell>
      <style>{PRINT_CSS}</style>
      <div className="mb-5 flex flex-col gap-3 print:hidden md:flex-row md:items-center md:justify-between">
        <p className="text-[14px] text-nd-fg-2">인쇄용 미리보기 · A4 가로 1장 — 셸과 버튼은 찍히지 않습니다</p>
        <div className="flex flex-wrap items-center gap-2">
          <MonthStepper months={months} value={month} onChange={(v) => router.replace(`/neander/shorts/clients/${c.id}/report?month=${v}`, { scroll: false })} />
          <Link href={`/neander/shorts/clients/${c.id}`} className={buttonClass("secondary", "md", "gap-1.5")}>
            <ArrowLeft size={16} aria-hidden />
            업체로 돌아가기
          </Link>
          <Button icon={Printer} onClick={() => window.print()}>
            인쇄 · PDF 저장
          </Button>
        </div>
      </div>
      <article
        className="shorts-report rounded-nd-lg border border-nd-line bg-white p-6 text-[14px] leading-relaxed text-neutral-900 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:text-[13px] print:leading-snug print:shadow-none"
        style={{ ["--report-zoom" as string]: String(zoom) }}
      >
        <header className="flex flex-col gap-4 border-b-2 border-neutral-900 pb-5 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between print:pb-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#2570CC]">
              {y}년 {M}월 · 월간 영상 보고{thisMonth ? " (진행 중인 달)" : ""}
            </p>
            <h1 className="mt-1 break-words text-[30px] font-bold leading-tight print:text-[24px]">{c.name}</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              작성 {new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })} · 담당 {c.members.map(nameOf).join(", ")}
              {c.contactName ? ` · 고객사 담당 ${c.contactName}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right print:text-right">
            <ProductWordmark height={20} />
            <p className="mt-1.5 text-[13px] text-neutral-500">AI STUDIO · 브랜드 영상 대행</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 print:mt-3 print:grid-cols-4 print:gap-2.5">
          <Kpi label="제작 / 계약" value={`${prog.made} / ${prog.planned}편`} detail={`월 계약 ${c.contract.videosPerMonth}편`} tone="accent" />
          <Kpi label="고객 승인 (납품 기준)" value={`${prog.approved}편`} detail={`검토 대기 ${prog.waiting}편`} tone="success" />
          <Kpi label={fileOnly ? "게시 (고객사가 게시)" : "게시 완료"} value={`${prog.published}편`} detail={fileOnly ? "완성 파일만 납품하는 계약" : "승인 후 순차 게시"} />
          <Kpi label="수정 요청 중" value={`${prog.revision}편`} detail={`누적 수정 요청 ${revisionsTotal}회`} tone={prog.revision ? "danger" : undefined} />
        </section>

        <section className="report-keep mt-6 print:mt-3">
          <H2>계약과 납품</H2>
          <p className="text-[13px] text-neutral-600">
            {c.contract.plan ? `${planText(c.contract)} · ` : ""}
            {c.contract.monthlyFeeKrw !== null ? `월 ${fmtN(c.contract.monthlyFeeKrw)}원(${vatText(c.contract.vat)}) · ` : ""}영상당 수정 {revisionText(c.contract)} · 계약 {c.contract.startMonth} ~ {c.contract.endMonth ?? "끝 월 없음"}
          </p>
          <ProgressLine className="mt-2" value={prog.made} total={prog.planned} />
          <p className="mt-2 text-[13px] text-neutral-600">
            제작 진행률 {pct}% · 고객 승인 기준 납품 {prog.approved}편 · 이번 달 남은 제작 {left}편
          </p>
        </section>

        <section className="mt-5 print:mt-3">
          <H2 note={viewsKnown.length ? `조회 기록 ${viewsKnown.length}편 · 기록된 조회 합계 ${fmtN(viewsSum)}회` : `${projects.length}편`}>영상</H2>
          {projects.length === 0 ? (
            <p className="text-neutral-500">이 달 영상이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[760px] border-collapse print:min-w-0 print:table-fixed">
                <thead>
                  <tr className="bg-neutral-50 text-left">
                    <th className={cn(th, "w-[25%]")}>영상</th>
                    <th className={cn(th, "w-[17%]")}>검토 · 승인일</th>
                    <th className={cn(th, "w-[20%]")}>게시 링크</th>
                    <th className={cn(th, "w-[9%] text-right")}>조회</th>
                    <th className={cn(th, "w-[19%]")}>반응</th>
                    <th className={cn(th, "w-[10%] text-right")}>수정</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, pubs, recorded, t }) => {
                    const approved = [...p.review.rounds].reverse().find((r) => r.decision === "approved");
                    const round = latestRound(p.review);
                    const product = c.products.find((x) => x.id === p.clientProductId)?.name ?? "";
                    const rounds = p.review.rounds.filter((r) => r.decision !== "withdrawn").length;
                    const applicable = pubs.length > 0 || recorded;
                    const over = p.review.revisionsUsed > c.contract.revisionLimit;
                    const reactions: [string, number | null][] = [
                      ["좋아요", t.likes],
                      ["댓글", t.comments],
                      ["저장", t.saves],
                      ["공유", t.shares],
                    ];
                    const source = recorded ? [...t.sources].map((s) => (s === "manual" ? "직접 확인" : s.replace("_api", " API"))).join(" · ") || "기록 있음 · 값 없음" : "";
                    return (
                      <tr key={p.id} className="border-b border-neutral-100">
                        <td className={td}>
                          <span className="break-words font-semibold">{p.publish.title || p.title}</span>
                          {product && <div className={cn("text-[13px] text-neutral-500", sub)}>{product}</div>}
                        </td>
                        <td className={td}>
                          <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium", REVIEW_CHIP[p.review.state])}>{REVIEW_LABEL[p.review.state]}</span>
                          <div className={cn("mt-0.5 text-[13px] text-neutral-500", dense && "print:ml-1.5 print:mt-0 print:inline")}>
                            {approved?.decidedAt ? fmtDayKst(approved.decidedAt) : p.review.state === "revision" && round?.feedback ? <span className={dense ? "" : "line-clamp-1 break-all"}>“{round.feedback}”</span> : rounds > 1 ? `${rounds}차` : round ? `보냄 ${fmtDayKst(round.sentAt)}` : ""}
                          </div>
                        </td>
                        <td className={td}>
                          {pubs.length ? (
                            pubs.map((x) => (
                              <div key={x.id} className={cn("break-all text-[13px]", dense && "print:truncate print:break-normal")}>
                                <b className="font-medium">{PLATFORM_LABEL[x.platform]}</b>
                                {x.result?.at ? <span className="text-neutral-500"> {fmtDayKst(x.result.at)}</span> : null}
                                {x.result?.url ? (
                                  <>
                                    {" "}
                                    ·{" "}
                                    <a href={x.result.url} className="text-blue-700 underline">
                                      {x.result.url}
                                    </a>
                                  </>
                                ) : (
                                  ""
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="text-neutral-400">{fileOnly && p.review.state === "approved" ? "완성 파일 납품 · 게시는 고객사" : "게시 전"}</span>
                          )}
                        </td>
                        <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                          <Perf v={t.views} applicable={applicable} />
                          {source && <div className={cn("text-[13px] text-neutral-500", sub)}>{source}</div>}
                        </td>
                        <td className={cn(td, "text-[13px] tabular-nums")}>
                          {applicable ? (
                            <span className={cn("flex flex-wrap gap-x-2.5", dense && "print:block print:truncate")}>
                              {reactions.map(([k, v]) => (
                                <span key={k} className={cn("whitespace-nowrap", dense && "print:mr-2")}>
                                  {k} <Perf v={v} applicable />
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-neutral-400">해당 없음</span>
                          )}
                        </td>
                        <td className={cn(td, "whitespace-nowrap text-right tabular-nums", over && "font-semibold text-red-700")}>
                          {p.review.revisionsUsed} / {c.contract.revisionLimit}회{over ? " · 협의" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[13px] text-neutral-500">
            성과는 YouTube · Instagram 의 기록만 표시합니다 (플랫폼 API 또는 직접 확인한 값). 게시 후 확인되지 않은 값은 「미확인」 (0 이 아닙니다), 게시 전 영상은 「해당 없음」 으로 구분하며 조회수는 계약상 보장 사항이 아닙니다.
          </p>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 print:mt-3 print:grid-cols-2 print:gap-2.5">
          <div className="report-keep rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 print:py-2.5">
            <h3 className="text-[15px] font-bold">1. 제작 · 승인 {thisMonth ? `— 남은 ${M}월 계획` : "— 정리"}</h3>
            <p className="mt-1 text-[13px] text-neutral-700">{plan.length ? plan.join(" · ") : `${M}월 계약분을 모두 마쳤습니다.`}</p>
          </div>
          <div className="report-keep rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 print:py-2.5">
            <h3 className="text-[15px] font-bold">
              2. 다음 달 제안 <span className="text-[13px] font-normal text-neutral-500">{scout ? `· 바이럴 형식 정찰 ${scout.week} 보고 기준` : ""}</span>
            </h3>
            {!scoutLoaded ? (
              <p className="mt-1 text-[13px] text-neutral-500">정찰 보고를 불러오는 중…</p>
            ) : suggestions.length === 0 ? (
              <p className="mt-1 text-[13px] text-neutral-500">{scout ? "이번 주 정찰 보고에 제안할 형식이 없습니다." : "정찰 보고를 불러오지 못했거나 아직 없습니다."}</p>
            ) : (
              <ol className="mt-1 space-y-1">
                {suggestions.map((f, i) => (
                  <li key={f.formatId} className={cn("text-[13px] text-neutral-700", i >= 3 && "print:hidden")}>
                    <b className="font-semibold text-neutral-900">
                      {i + 1}. {f.name}
                    </b>{" "}
                    <span className="text-neutral-500">
                      · {STAGE[f.stage] ?? f.stage} · {f.countries.join("·")} · {KOREA[f.korea] ?? f.korea}
                    </span>
                    {f.basis && <span className="block text-neutral-500 print:line-clamp-1">{f.basis}</span>}
                    {f.top?.url && (
                      <span className="block truncate text-neutral-500 print:hidden">
                        예:{" "}
                        <a href={f.top.url} className="underline" title={f.top.title}>
                          {f.top.title.slice(0, 40)}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {scout && suggestions.length > 0 && <p className="mt-1.5 text-[13px] text-neutral-500">「국내 표본에 없음」 은 검색 표본에서 못 찾았다는 뜻이지 국내에 없다는 단정이 아닙니다.</p>}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3 text-[13px] text-neutral-500 print:mt-3 print:pt-2">
          <span>
            AI STUDIO 월간 영상 보고 · {c.name} · {y}년 {M}월
          </span>
          <span>계약은 제작 편수 · 수정 횟수 기준이며 조회수를 약속하지 않습니다</span>
        </footer>
      </article>
    </PageShell>
  );
}
