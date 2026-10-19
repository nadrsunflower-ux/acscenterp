"use client";

// ============================================================
//  프로젝트 보고서 — 내부 보고용. 진행 중엔 「중간 보고」, 끝나면 「결산 보고」
// ------------------------------------------------------------
//  양식은 하나다(2026-10-19 사용자 결정). 첫 장은 판단에 필요한 요약 —
//  판정 한 줄 · 손익(계획 · 확정 · 남은 예상 · 예상 최종 · 차이) · 진행 ·
//  큰 차이 · 확인할 것. 둘째 장부터는 근거 자료(아래 원래 표들).
//  요약의 숫자는 lib/neander/finance/project-report.ts 가 낸다.
//
//  상세 화면은 탭 다섯으로 나뉘어 있어 「이 건이 어떻게 끝났나」를 한 번에
//  보려면 탭을 다 눌러야 한다. 회의에 들고 가거나 발주처·세무사에게 넘길 때는
//  한 장이 필요하다 — 개요 숫자 → 수입·입금 → 지출 → 원장 대조 → 문서 → 메모
//  순서로 위에서 아래로 내려 읽게 한다.
//
//  저장된 값으로만 그린다(상세 화면의 고치는 중인 초안은 들어가지 않는다).
//  인쇄는 브라우저 인쇄 → 「PDF로 저장」 — 셸·비서·도구 막대는 인쇄에서 뺀다.
//
//  용지는 세로·가로를 고른다. 가로는 표가 넓어지고 핵심 숫자 6개가 한 줄에
//  선다 — 화면에 띄워 회의에서 보거나 지출 줄이 많은 건을 넘길 때. 고른 방향은
//  주소(?orient=landscape)와 이 브라우저에 남고, 인쇄도 그 방향(@page)으로 나간다.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer, RectangleHorizontal, RectangleVertical, SearchX } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  LoadingState,
  Money,
  SegmentedControl,
  type Tone,
  cn,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useShellFocus } from "@/components/neander/shell/context";
import {
  BlockTitle,
  paperPrintCss,
  ReportPaper,
  RTable,
  type DetailBlock,
  type Orient,
  type SummaryBlock,
} from "@/components/neander/finance/ReportPaper";
import {
  DEDUCTION_TAX_LABEL,
  ENTITY_SHORT,
  INSTALLMENT_STATUS_LABEL,
  PROJECT_STATUS_LABEL,
  VAT_LABEL,
  deductionSplit,
  dueLabel,
  formatMargin,
  groupLines,
  installmentStatus,
  isReceived,
  laborCost,
  laborTotal,
  ledgerRowsOf,
  lineActual,
  lineEstimate,
  projectEntities,
  projectSummary,
  splitVat,
  type InstallmentStatus,
  type ProjectStatus,
} from "@/lib/neander/finance/project";
import {
  CONTRACT_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  docsOfProject,
  formatQuoteNo,
  isQuote,
  quoteTotals,
} from "@/lib/neander/finance/docs";
import { netAmount, txFlow } from "@/lib/neander/finance/types";
import {
  bigVariances,
  checkItems,
  costSplit,
  nextPayment,
  PHASE_LABEL,
  reportPhase,
  scheduleText,
  verdictLine,
  VARIANCE_MIN,
  VARIANCE_RATIO,
  type CheckTone,
} from "@/lib/neander/finance/project-report";
import { todayStrKST } from "@/lib/neander/format";

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: "neutral",
  active: "accent",
  done: "success",
  cancelled: "danger",
};
const INSTALLMENT_TONE: Record<InstallmentStatus, Tone> = {
  paid: "success",
  overdue: "danger",
  planned: "neutral",
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

const ORIENT_KEY = "neander.finance.projectReport.orient";

export default function ProjectReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { projects, transactions, docs, loading } = useFinance();
  // 셸(사이드바·상단바)을 걷어 낸다 — 보고서는 종이 한 장처럼 보여야 한다
  useShellFocus(true);

  // 용지 방향 — 주소가 먼저, 없으면 이 브라우저에서 마지막으로 고른 것
  const [orient, setOrientState] = useState<Orient>("portrait");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("orient");
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(ORIENT_KEY);
    } catch {
      // 저장소를 못 쓰는 창(사생활 보호 등)이면 세로로 둔다
    }
    const next = q ?? saved;
    if (next === "landscape" || next === "portrait") setOrientState(next);
  }, []);
  const setOrient = (o: Orient) => {
    setOrientState(o);
    try {
      window.localStorage.setItem(ORIENT_KEY, o);
    } catch {
      // 기억만 못 할 뿐 화면은 바뀐다
    }
    const url = new URL(window.location.href);
    if (o === "landscape") url.searchParams.set("orient", "landscape");
    else url.searchParams.delete("orient");
    window.history.replaceState(null, "", url.toString());
  };
  const wide = orient === "landscape";

  const p = useMemo(() => projects.find((x) => x.id === id) ?? null, [projects, id]);

  // 인쇄·PDF 파일 이름이 탭 제목을 따른다
  useEffect(() => {
    if (!p) return;
    const prev = document.title;
    document.title = `${p.name} — ${PHASE_LABEL[reportPhase(p.status)]}`;
    return () => {
      document.title = prev;
    };
  }, [p]);

  const view = useMemo(() => {
    if (!p) return null;
    const s = projectSummary(p, transactions);
    const ledger = ledgerRowsOf(transactions, p.code).sort((a, b) => a.date.localeCompare(b.date));
    return {
      s,
      ent: projectEntities(p, transactions),
      groups: groupLines(p.lines ?? []),
      ledger,
      pdocs: docsOfProject(docs, p.id),
      contract: splitVat(p.contractAmount, p.vatMode ?? "excluded"),
    };
  }, [p, transactions, docs]);

  // 첫 장 요약 — 진행 중이면 중간 보고, 끝났으면 결산 (project-report.ts)
  const today = todayStrKST();
  const head = useMemo(() => {
    if (!p || !view) return null;
    const phase = reportPhase(p.status);
    const cost = costSplit(p.lines ?? []);
    const checks = checkItems(p, view.s, cost, phase, today);
    const labor = laborTotal(p.labor);
    const openTodos = (p.todos ?? []).filter((t) => !t.done);
    return {
      phase,
      cost,
      checks,
      labor,
      openTodos,
      verdict: verdictLine(view.s, phase, checks, { labor, openTodos: openTodos.length }),
      variances: bigVariances(p.lines ?? []),
      next: nextPayment(p, today),
      schedule: scheduleText(p.startDate, p.endDate, today),
    };
  }, [p, view, today]);

  if (loading) return <LoadingState />;
  if (!p || !view || !head) {
    return (
      <div className="p-10">
        <EmptyState
          icon={SearchX}
          title="프로젝트를 찾지 못했습니다"
          description="지워졌거나 주소가 잘못되었습니다."
          action={
            <Link href="/neander/finance/projects">
              <Button variant="secondary">프로젝트 목록</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { s, ent, groups, ledger, pdocs, contract } = view;
  const { phase, cost, checks, labor, openTodos, verdict, variances, next, schedule } = head;
  const gm2 = s.profitActual - labor;
  const gm2Margin = s.revenue > 0 ? gm2 / s.revenue : null;
  const doneTodos = (p.todos ?? []).filter((t) => t.done);
  const base = p.vatMode ?? "excluded";
  const period = p.startDate ? (p.endDate && p.endDate !== p.startDate ? `${p.startDate} ~ ${p.endDate}` : p.startDate) : null;
  const finalLabel = phase === "final" ? "최종" : "예상 최종";
  const marginGap = s.marginEstimate !== null && s.marginActual !== null ? Math.round((s.marginActual - s.marginEstimate) * 1000) / 10 : null;

  // ---- 1쪽 머리 · 2쪽부터 머리말 ----
  const firstHead = (
    <div className="pb-4">
      <header className="border-b-2 border-nd-fg pb-3">
        <p className="text-nd-caption font-medium text-nd-fg-3">
          {PHASE_LABEL[phase]} · {today} 기준
        </p>
        <h1 className="mt-1 text-nd-display text-nd-fg">{p.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-nd-caption text-nd-fg-2">
          <Badge tone={STATUS_TONE[p.status]} dot size="sm">
            {PROJECT_STATUS_LABEL[p.status]}
          </Badge>
          <span className="font-mono">{p.code}</span>
          {ent.entities.length > 0 && (
            <span>
              · 사업체 {ent.entities.map((e) => ENTITY_SHORT[e]).join(" · ")}
              {ent.source === "ledger" && <span className="text-nd-fg-3"> (원장 입금 기준)</span>}
            </span>
          )}
          {p.client && <span>· 발주처 {p.client}</span>}
          {period && <span className="nd-num">· {period}</span>}
          {p.bizMinor && <span>· {p.bizMinor}</span>}
        </div>
      </header>
      <div className="mt-4 rounded-nd-md bg-nd-sunken px-4 py-3">
        <p className="text-nd-micro font-medium text-nd-fg-3">{PHASE_LABEL[phase]} · 판정</p>
        <p className="mt-0.5 break-keep text-nd-body font-semibold text-nd-fg">{verdict.join(" · ")}</p>
      </div>
    </div>
  );
  const runningHead = (
    <div className="pb-4">
      <div className="flex items-baseline justify-between gap-4 border-b-2 border-nd-fg pb-1.5 text-nd-caption">
        <span className="min-w-0 truncate font-semibold text-nd-fg">
          {PHASE_LABEL[phase]} · {p.name}
        </span>
        <span className="shrink-0 text-nd-fg-3">근거 자료 · {today} 기준</span>
      </div>
    </div>
  );

  // ---- 1쪽 · 요약 블록 (가로 용지: 0 = 왼쪽 단, 1 = 오른쪽 단) ----
  const summaryBlocks: SummaryBlock[] = [
    {
      key: "pl",
      column: 0,
      node: (
        <section>
          <SubHead title="손익" hint="공급가액 기준 · 원" />
          <RTable
            head={["", "계획(견적)", "확정", "남은 예상", finalLabel, "차이"]}
            align={["l", "r", "r", "r", "r", "r"]}
            rows={[
              ["매출 (공급가액)", won(s.revenue), "—", "—", won(s.revenue), "—"],
              [
                "외부 원가",
                won(cost.plan),
                won(cost.confirmed),
                cost.remaining ? won(cost.remaining) : "—",
                won(cost.forecast),
                <Diff key="c" value={cost.forecast - cost.plan} worseIfUp />,
              ],
              [
                "현장 이익",
                won(s.profitEstimate),
                "—",
                "—",
                <Money key="p" value={s.profitActual} unit={false} flow="net" className="font-semibold" />,
                <Diff key="p" value={s.profitActual - s.profitEstimate} />,
              ],
              [
                "현장 이익률",
                pct(s.marginEstimate),
                "—",
                "—",
                <b key="m" className="font-semibold">{pct(s.marginActual)}</b>,
                marginGap === null || marginGap === 0 ? "—" : (
                  <span key="g" className={marginGap < 0 ? "text-nd-expense-text" : "text-nd-income-text"}>
                    {marginGap > 0 ? "+" : ""}
                    {marginGap}%p
                  </span>
                ),
              ],
              [
                "사내 인력 (추정)",
                "—",
                "—",
                "—",
                labor > 0 ? won(labor) : <span key="l" className="text-nd-warning-text">안 적음</span>,
                "—",
              ],
              ...(labor > 0
                ? [
                    [
                      "인력 반영 이익",
                      "—",
                      "—",
                      "—",
                      <Money key="g" value={gm2} unit={false} flow="net" className="font-semibold" />,
                      "—",
                    ],
                    ["인력 반영 이익률", "—", "—", "—", <b key="gm" className="font-semibold">{pct(gm2Margin)}</b>, "—"],
                  ]
                : []),
            ]}
          />
          <p className="mt-1.5 break-keep text-nd-micro text-nd-fg-3">
            확정 = 실제금액을 적은 줄 · 남은 예상 = 아직 실제금액이 없는 줄의 견적. 이익 = 공급가액 − 원가 (원가는 대개 부가세
            포함이라 매입세액을 공제받으면 실제 부담은 더 적다).{" "}
            {labor > 0
              ? "사내 인력은 적어 둔 날 × 하루 단가(추정)라 외부 원가와 따로 둔다."
              : "사내 인력을 안 적어 현장 이익이 실제보다 크게 보일 수 있다."}
          </p>
        </section>
      ),
    },
    {
      key: "progress",
      column: 1,
      node: (
        <section>
          <SubHead title="진행" />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-nd-md border border-nd-line bg-nd-line">
            <Fact label="일정" value={schedule} hint={period ?? "기간을 안 적었습니다"} />
            <Fact
              label="준비"
              value={s.lineCount ? `${s.doneCount} / ${s.lineCount}줄` : "—"}
              hint={s.lineCount ? `${Math.round((s.doneCount / s.lineCount) * 100)}% 준비 완료` : "지출 줄 없음"}
            />
            <Fact
              label="원가 확정"
              value={s.lineCount ? `${cost.confirmedLines} / ${s.lineCount}줄` : "—"}
              hint={`확정 ${won(cost.confirmed)}원`}
            />
            <Fact
              label="입금"
              value={s.revenueTotal > 0 ? `${Math.round(((s.received - s.returned) / s.revenueTotal) * 100)}%` : "—"}
              hint={`받음 ${won(s.received - s.returned)} / 청구 ${won(s.revenueTotal)}`}
            />
          </dl>
          <p className="mt-2 break-keep text-nd-caption text-nd-fg-2">
            {next ? (
              <>
                다음 입금 · {next.kind} {won(next.amount)}원 · {next.due || "받을 날 미정"}
                {next.overdue && (
                  <Badge tone="danger" size="sm" className="ml-1.5">
                    연체
                  </Badge>
                )}
              </>
            ) : s.unpaid > 0 ? (
              <>남은 {won(s.unpaid)}원의 입금 회차가 없습니다.</>
            ) : (
              <>받을 돈을 다 받았습니다.</>
            )}
          </p>
        </section>
      ),
    },
    ...(variances.length > 0
      ? [
          {
            key: "variance",
            column: 0 as const,
            node: (
              <section>
                <SubHead
                  title="큰 차이"
                  hint={`견적과 ${Math.round(VARIANCE_RATIO * 100)}% 이상 · ${won(VARIANCE_MIN)}원 이상 다른 줄 — 비고가 사유`}
                />
                <RTable
                  head={["분류 · 품목", "견적", "실제", "차이", "사유 (비고)"]}
                  wrap={[0, 4]}
                  align={["l", "r", "r", "r", "l"]}
                  rows={variances.map((v) => [
                    `${v.line.category || "분류 없음"} · ${v.line.item || "—"}`,
                    won(v.estimate),
                    won(v.actual),
                    <Diff key="d" value={v.diff} worseIfUp />,
                    v.line.note ? v.line.note : <span key="n" className="text-nd-warning-text">사유를 비고에 적어 주세요</span>,
                  ])}
                />
              </section>
            ),
          },
        ]
      : []),
    {
      key: "todos",
      column: 1,
      node: (() => {
        const todosEl =
          openTodos.length + doneTodos.length > 0 ? (
            <div key="todo" className="min-w-0">
              <h3 className="mb-1 text-nd-caption font-semibold text-nd-fg-2">남은 일 {openTodos.length > 0 && `${openTodos.length}건`}</h3>
              <ul className="flex flex-col gap-0.5 text-nd-table text-nd-fg-2">
                {openTodos.map((t) => (
                  <li key={t.id} className="break-keep">
                    ☐ {t.text}
                  </li>
                ))}
                {doneTodos.map((t) => (
                  <li key={t.id} className="break-keep text-nd-fg-4 line-through">
                    ☑ {t.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null;
        const lessonsEl = p.lessons ? (
          <div key="lessons" className="min-w-0">
            <h3 className="mb-1 text-nd-caption font-semibold text-nd-fg-2">다음엔</h3>
            <p className="whitespace-pre-wrap break-keep text-nd-table leading-relaxed text-nd-fg-2">{p.lessons}</p>
          </div>
        ) : null;
        // 중간 보고는 남은 일이, 결산은 다음엔이 앞에
        const blocks = (phase === "final" ? [lessonsEl, todosEl] : [todosEl, lessonsEl]).filter(Boolean);
        return (
          <section>
            <SubHead title={phase === "final" ? "다음엔 · 남은 일" : "남은 일 · 다음엔"} />
            {blocks.length === 0 ? (
              <Empty>{phase === "final" ? "다음엔 · 남은 일을" : "남은 일을"} 안 적었습니다 — 프로젝트 개요에서 적습니다.</Empty>
            ) : (
              <div className={cn("grid gap-x-6 gap-y-3", blocks.length > 1 && !wide && "grid-cols-2")}>{blocks}</div>
            )}
          </section>
        );
      })(),
    },
    {
      key: "checks",
      column: 0,
      node: (
        <section>
          <SubHead title="확인할 것" />
          {checks.length === 0 ? (
            <Empty>지금은 없습니다.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {checks.map((c) => (
                <li key={c.text} className="flex items-start gap-2 text-nd-table text-nd-fg-2">
                  <Badge tone={CHECK_TONE[c.tone]} size="sm" className="mt-px shrink-0">
                    {CHECK_LABEL[c.tone]}
                  </Badge>
                  <span className="break-keep">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ),
    },
  ];

  // ---- 2쪽부터 · 근거 자료 블록 ----
  /** 쪼갤 수 있는 표 블록 — 쪽이 갈리면 「(계속)」 제목과 머리글을 다시 단다 */
  const tableBlock = (
    key: string,
    o: {
      title: string;
      hint?: string;
      sub?: boolean;
      note?: React.ReactNode;
      head: string[];
      align: ("l" | "r")[];
      wrap?: number[];
      dense?: boolean;
      rows: React.ReactNode[][];
      foot?: React.ReactNode[];
    },
  ): DetailBlock => ({
    key,
    rows: {
      count: o.rows.length,
      render: (from, to, cont, colWidths) => (
        <div>
          <BlockTitle title={cont ? `${o.title} (계속)` : o.title} hint={cont ? undefined : o.hint} sub={o.sub} />
          {!cont && o.note}
          <RTable
            head={o.head}
            align={o.align}
            wrap={o.wrap}
            dense={o.dense}
            rows={o.rows.slice(from, to)}
            foot={to === o.rows.length ? o.foot : undefined}
            colWidths={colWidths}
          />
        </div>
      ),
    },
  });
  const emptyBlock = (key: string, title: string, text: string, hint?: string): DetailBlock => ({
    key,
    node: (
      <div>
        <BlockTitle title={title} hint={hint} />
        <Empty>{text}</Empty>
      </div>
    ),
  });

  const incomeHint = `계약 ${won(p.contractAmount)} (${VAT_LABEL[base]}) = 공급가액 ${won(contract.supply)} + 부가세 ${won(contract.vat)}`;
  const detailBlocks: DetailBlock[] = [
    (p.installments ?? []).length === 0
      ? emptyBlock("inst", "수입 · 입금", "입금 회차를 적지 않았습니다.", incomeHint)
      : tableBlock("inst", {
          title: "수입 · 입금",
          hint: incomeHint,
          head: ["구분", "금액", "청구액", "받기로 한 날", "입금일", "상태", "비고"],
          wrap: [6],
          align: ["l", "r", "r", "l", "l", "l", "l"],
          rows: (p.installments ?? []).map((i) => {
            const st = installmentStatus(i);
            return [
              i.kind,
              won(i.amount),
              won(splitVat(i.amount, base).total),
              dueLabel(i) || "—",
              i.paidDate ?? "—",
              <Badge key="st" tone={INSTALLMENT_TONE[st]} size="sm">
                {INSTALLMENT_STATUS_LABEL[st]}
              </Badge>,
              i.note ?? "",
            ];
          }),
        }),
    ...((p.revenues ?? []).length > 0
      ? [
          tableBlock("rev", {
            title: "추가 수입",
            sub: true,
            head: ["항목", "금액", "부가세", "받은 날", "비고"],
            wrap: [0, 4],
            align: ["l", "r", "l", "l", "l"],
            rows: p.revenues.map((r) => [
              r.label,
              won(r.amount),
              VAT_LABEL[r.vatMode ?? base],
              r.receivedDate ?? (isReceived(r) ? "받음" : "—"),
              r.note ?? "",
            ]),
          }),
        ]
      : []),
    ...((p.deductions ?? []).length > 0
      ? [
          tableBlock("ded", {
            title: "매출 차감 (돌려준 돈)",
            sub: true,
            head: ["항목", "금액", "공급가액에서", "세금계산서", "돌려준 날", "비고"],
            wrap: [0, 5],
            align: ["l", "r", "r", "l", "l", "l"],
            rows: (p.deductions ?? []).map((d) => [
              d.label,
              won(d.amount),
              won(deductionSplit(d, base).supply),
              DEDUCTION_TAX_LABEL[d.taxMode],
              d.paidDate ?? "아직",
              d.note ?? "",
            ]),
          }),
        ]
      : []),
    ...((p.labor ?? []).length > 0
      ? [
          tableBlock("labor", {
            title: "사내 인력",
            hint: `추정 · ${won(labor)}원 — 실제 지출이 아니라 외부 원가와 따로 둔다`,
            head: ["이름", "일수", "하루 단가", "금액", "메모"],
            wrap: [4],
            align: ["l", "r", "r", "r", "l"],
            rows: (p.labor ?? []).map((l) => [l.name || "—", String(l.days), won(l.dayRate), won(laborCost(l)), l.note ?? ""]),
            foot: ["합계", String((p.labor ?? []).reduce((a, l) => a + (Number(l.days) || 0), 0)), "", won(labor), ""],
          }),
        ]
      : []),
    ...(groups.length === 0
      ? [emptyBlock("exp", "지출", "지출 줄이 없습니다.")]
      : [
          tableBlock("exp", {
            title: "지출",
            hint: `${s.lineCount}줄 · 견적 ${won(s.estimate)} · 실제 ${won(s.actual)}`,
            head: ["분류", "줄", "견적", "실제", "차이", "수입 대비"],
            wrap: [0],
            align: ["l", "r", "r", "r", "r", "r"],
            rows: groups.map((g) => [
              g.category,
              g.lines.length,
              won(g.estimate),
              won(g.actual),
              <Diff key="d" value={g.actual - g.estimate} worseIfUp />,
              s.revenue > 0 ? `${((g.actual / s.revenue) * 100).toFixed(1)}%` : "—",
            ]),
            foot: [
              "합계",
              s.lineCount,
              won(s.estimate),
              won(s.actual),
              <Diff key="d" value={s.actual - s.estimate} worseIfUp />,
              s.revenue > 0 ? `${((s.actual / s.revenue) * 100).toFixed(1)}%` : "—",
            ],
          }),
          tableBlock("lines", {
            title: "지출 · 전체 줄",
            sub: true,
            dense: true,
            head: ["분류", "품목", "수량", "단가", "견적", "실제", "발주처", "비고"],
            wrap: [0, 1, 6, 7],
            align: ["l", "l", "r", "r", "r", "r", "l", "l"],
            rows: groups.flatMap((g) =>
              g.lines.map((l) => [
                g.category,
                l.item || "—",
                `${Number(l.qty).toLocaleString("ko-KR")}${l.unit ? ` ${l.unit}` : ""}`,
                l.unitPrice !== undefined ? won(l.unitPrice) : "—",
                won(lineEstimate(l)),
                l.actual !== undefined && l.actual !== null ? won(lineActual(l)) : <span key="a" className="text-nd-fg-4">견적</span>,
                l.vendor ?? "",
                l.note ?? "",
              ]),
            ),
          }),
        ]),
    ledger.length === 0
      ? emptyBlock("ledger", "원장 대조", "원장에 이 코드로 찍힌 거래가 없습니다.")
      : tableBlock("ledger", {
          title: "원장 대조",
          hint: `${p.code} 코드로 찍힌 거래 ${ledger.length}건 · 수입 ${won(s.ledger.income)} · 지출 ${won(s.ledger.expense)}${s.ledger.refund ? ` · 환급 ${won(s.ledger.refund)}` : ""}`,
          note: (
            <p className="mb-2 text-nd-caption text-nd-fg-2">
              원장 지출 {won(s.ledger.expense - s.ledger.refund)} vs 지출 줄의 확정 원가 {won(cost.confirmed)}
              {cost.remaining > 0 && ` (견적으로 채운 ${won(cost.remaining)}은 빼고)`} —
              {Math.abs(s.ledger.expense - s.ledger.refund - cost.confirmed) < 1
                ? " 같습니다."
                : ` ${won(Math.abs(s.ledger.expense - s.ledger.refund - cost.confirmed))} 차이. 카드 대금은 늦게 찍히고 현금·재고는 원장에 없을 수 있습니다.`}
            </p>
          ),
          dense: true,
          head: ["날짜", "구분", "거래처", "계정", "사업장", "금액"],
          wrap: [2, 3],
          align: ["l", "l", "l", "l", "l", "r"],
          rows: ledger.map((t) => [
            t.date,
            t.txType,
            t.vendor ?? "",
            [t.acctMid, t.acctMinor].filter(Boolean).join(" > "),
            t.site ?? "",
            <Money key="m" value={netAmount(t)} unit={false} flow={txFlow(t.txType)} />,
          ]),
        }),
    pdocs.length === 0
      ? emptyBlock("docs", "견적 · 계약", "ERP 에 붙은 견적서·계약서가 없습니다.")
      : tableBlock("docs", {
          title: "견적 · 계약",
          head: ["종류", "번호 · 제목", "날짜", "상대", "금액", "상태"],
          wrap: [1, 3],
          align: ["l", "l", "l", "l", "r", "l"],
          rows: pdocs.map((d) =>
            isQuote(d)
              ? ["견적서", `${formatQuoteNo(d.quoteNo)} ${d.title}`.trim(), d.date, d.recipient, won(quoteTotals(d).total), QUOTE_STATUS_LABEL[d.status]]
              : ["계약서", d.title, d.signedDate ?? d.startDate ?? "—", d.counterparty, `${won(d.amount)} (${VAT_LABEL[d.vatMode]})`, CONTRACT_STATUS_LABEL[d.status]],
          ),
        }),
    // 메모는 문단마다 쪼갤 수 있게 — 긴 메모가 쪽을 넘쳐 잘리지 않도록
    ...(p.note
      ? [
          ((paras: string[]): DetailBlock => ({
            key: "memo",
            rows: {
              count: paras.length,
              render: (from, to, cont) => (
                <div>
                  <BlockTitle title={cont ? "메모 (계속)" : "메모"} />
                  {paras.slice(from, to).map((t, i) => (
                    <p key={from + i} data-pg="row" className="whitespace-pre-wrap break-keep pb-1 text-nd-table leading-relaxed text-nd-fg-2">
                      {t || " "}
                    </p>
                  ))}
                </div>
              ),
            },
          }))(p.note.split("\n")),
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-nd-sunken print:bg-white">
      <style>{paperPrintCss(orient)}</style>

      {/* ---- 도구 막대 (인쇄에서 빠진다) ---- */}
      <div className="sticky top-0 z-nd-sticky flex items-center justify-between gap-3 border-b border-nd-line bg-nd-content/90 px-4 py-2.5 backdrop-blur-md sm:px-6 print:hidden">
        <Link
          href={`/neander/finance/projects/${p.id}`}
          className="inline-flex items-center gap-1 text-nd-caption text-nd-fg-2 hover:text-nd-accent-strong"
        >
          <Icon icon={ArrowLeft} size={14} />
          프로젝트 상세
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-nd-caption text-nd-fg-3 lg:inline">A4 한 장씩 · 인쇄 창에서 「PDF로 저장」을 고르면 파일로 남습니다</span>
          <SegmentedControl<Orient>
            size="sm"
            ariaLabel="용지 방향"
            value={orient}
            onChange={setOrient}
            options={[
              { value: "portrait", label: "세로", icon: RectangleVertical },
              { value: "landscape", label: "가로", icon: RectangleHorizontal },
            ]}
          />
          <Button icon={Printer} onClick={() => window.print()}>
            인쇄 · PDF 저장
          </Button>
        </div>
      </div>

      <ReportPaper
        orient={orient}
        version={`${p.id}:${p.updatedAt ?? 0}:${transactions.length}:${docs.length}:${today}`}
        first={firstHead}
        runningHead={runningHead}
        footLeft={`NEANDER ERP · ${p.code} · 출력 ${today}`}
        summary={summaryBlocks}
        detail={detailBlocks}
      />
    </div>
  );
}

// ---- 부품 ------------------------------------------------------

const CHECK_TONE: Record<CheckTone, Tone> = { danger: "danger", warning: "warning", info: "neutral" };
const CHECK_LABEL: Record<CheckTone, string> = { danger: "급함", warning: "확인", info: "참고" };

const pct = (m: number | null) => (m === null ? "—" : `${(m * 100).toFixed(1)}%`);

/** 진행 칸 하나 */
function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-nd-content px-3 py-2.5">
      <dt className="text-nd-micro font-medium text-nd-fg-3">{label}</dt>
      <dd className="nd-num mt-0.5 text-nd-body font-semibold text-nd-fg">{value}</dd>
      {/* 종이에서는 「…」 로 잘리면 다시 볼 길이 없다 — 잘라내지 말고 낱말 단위로 줄을 바꾼다 */}
      {hint && <dd className="mt-0.5 break-keep text-nd-micro text-nd-fg-3">{hint}</dd>}
    </div>
  );
}

/** 요약 안의 작은 제목 */
function SubHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
      <h2 className="text-nd-body font-semibold text-nd-fg">{title}</h2>
      {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
    </div>
  );
}

/**
 * 계획 대비 차이 — 부호를 붙인다. 원가는 늘면 나쁘고(worseIfUp), 이익은 줄면 나쁘다.
 * 색만으로 알리지 않도록 +/- 가 늘 붙는다.
 */
function Diff({ value, worseIfUp = false }: { value: number; worseIfUp?: boolean }) {
  const v = Math.round(value);
  if (v === 0) return <span className="text-nd-fg-4">0</span>;
  const worse = worseIfUp ? v > 0 : v < 0;
  return (
    <span className={worse ? "text-nd-expense-text" : "text-nd-income-text"}>
      {v > 0 ? "+" : "-"}
      {won(Math.abs(v))}
    </span>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-nd-caption text-nd-fg-3">{children}</p>;
