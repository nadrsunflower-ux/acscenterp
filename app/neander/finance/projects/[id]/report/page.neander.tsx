"use client";

// ============================================================
//  프로젝트 보고서 — 한 프로젝트의 모든 것을 한 장(A4)에
// ------------------------------------------------------------
//  상세 화면은 탭 다섯으로 나뉘어 있어 「이 건이 어떻게 끝났나」를 한 번에
//  보려면 탭을 다 눌러야 한다. 회의에 들고 가거나 발주처·세무사에게 넘길 때는
//  한 장이 필요하다 — 개요 숫자 → 수입·입금 → 지출 → 원장 대조 → 문서 → 메모
//  순서로 위에서 아래로 내려 읽게 한다.
//
//  저장된 값으로만 그린다(상세 화면의 고치는 중인 초안은 들어가지 않는다).
//  인쇄는 브라우저 인쇄 → 「PDF로 저장」 — 셸·비서·도구 막대는 인쇄에서 뺀다.
// ============================================================

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer, SearchX } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  LoadingState,
  Money,
  type Tone,
  cn,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useShellFocus } from "@/components/neander/shell/context";
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

/**
 * 인쇄할 때는 보고서 한 장만 남긴다. 셸·비서·토스트를 하나하나 숨기는 대신
 * 전부 보이지 않게 하고 보고서만 다시 보이게 한다(전략 덱 인쇄와 같은 방식).
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm 11mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .nd-report, .nd-report * { visibility: visible; }
  .nd-report { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border: 0 !important; }
  .nd-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .nd-report section { break-inside: auto; }
  .nd-report tr, .nd-report .nd-report-keep { break-inside: avoid; }
  .nd-report thead { display: table-header-group; }
}
`;

export default function ProjectReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { projects, transactions, docs, loading } = useFinance();
  // 셸(사이드바·상단바)을 걷어 낸다 — 보고서는 종이 한 장처럼 보여야 한다
  useShellFocus(true);

  const p = useMemo(() => projects.find((x) => x.id === id) ?? null, [projects, id]);

  // 인쇄·PDF 파일 이름이 탭 제목을 따른다
  useEffect(() => {
    if (!p) return;
    const prev = document.title;
    document.title = `${p.name} — 프로젝트 보고서`;
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

  if (loading) return <LoadingState />;
  if (!p || !view) {
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
  const base = p.vatMode ?? "excluded";
  const period = p.startDate ? (p.endDate && p.endDate !== p.startDate ? `${p.startDate} ~ ${p.endDate}` : p.startDate) : null;
  const unfilled = s.lineCount - s.actualFilled;

  return (
    <div className="min-h-screen bg-nd-sunken pb-10 print:bg-white print:pb-0">
      <style>{PRINT_CSS}</style>

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
          <span className="hidden text-nd-caption text-nd-fg-3 sm:inline">인쇄 창에서 「PDF로 저장」을 고르면 파일로 남습니다</span>
          <Button icon={Printer} onClick={() => window.print()}>
            인쇄 · PDF 저장
          </Button>
        </div>
      </div>

      {/* ---- 보고서 한 장 ---- */}
      <article className="nd-report mx-auto mt-6 w-full max-w-[210mm] bg-nd-content px-6 py-8 text-nd-fg shadow-nd-card sm:px-[13mm] sm:py-[12mm]">
        <header className="nd-report-keep border-b-2 border-nd-fg pb-4">
          <p className="text-nd-caption font-medium text-nd-fg-3">프로젝트 보고서 · {todayStrKST()} 기준</p>
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

        {/* ---- 핵심 숫자 ---- */}
        <section className="nd-report-keep mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-nd-md border border-nd-line bg-nd-line sm:grid-cols-3">
          <Kpi label="청구 총액" value={<Money value={s.grossTotal} unit={false} />} hint={`계약 ${won(p.contractAmount)} · ${VAT_LABEL[base]}`} />
          <Kpi
            label="수입 (공급가액)"
            value={<Money value={s.revenue} unit={false} flow="income" />}
            hint={s.deduction > 0 ? `매출 차감 ${won(s.deduction)} 반영` : `부가세 ${won(s.revenueVat)} 별도`}
          />
          <Kpi
            label="실제 원가"
            value={<Money value={s.actual} unit={false} flow="expense" />}
            hint={s.lineCount === 0 ? "지출 줄 없음" : unfilled > 0 ? `${s.lineCount}줄 · 실제금액 없는 ${unfilled}줄은 견적으로` : `${s.lineCount}줄`}
          />
          <Kpi
            label="실질 이익"
            value={<Money value={s.profitActual} unit={false} flow="net" />}
            hint={`이익률 ${formatMargin(s.marginActual)}`}
          />
          <Kpi label="받은 돈" value={<Money value={s.received - s.returned} unit={false} />} hint={s.returned > 0 ? `돌려준 ${won(s.returned)} 뺀 값` : "부가세 포함"} />
          <Kpi
            label="미수금"
            value={<Money value={s.unpaid} unit={false} className={s.overdue > 0 ? "text-nd-danger-text" : undefined} />}
            hint={
              s.overdue > 0
                ? `연체 ${s.overdueCount}건 ${won(s.overdue)}`
                : s.deductionPending > 0
                  ? `돌려줄 돈 ${won(s.deductionPending)} 남음`
                  : s.unpaid === 0
                    ? "다 받았습니다"
                    : "아직 안 들어온 돈"
            }
          />
        </section>
        <p className="mt-1.5 text-nd-micro text-nd-fg-3">
          이익 = 공급가액 − 원가. 원가는 실제로 지불한 금액(대개 부가세 포함)이라 매입세액을 공제받으면 실제 부담은 이보다 적습니다.
        </p>

        {/* ---- 수입 · 입금 ---- */}
        <Section title="수입 · 입금" hint={`계약 ${won(p.contractAmount)} (${VAT_LABEL[base]}) = 공급가액 ${won(contract.supply)} + 부가세 ${won(contract.vat)}`}>
          {(p.installments ?? []).length === 0 ? (
            <Empty>입금 회차를 적지 않았습니다.</Empty>
          ) : (
            <RTable
              head={["구분", "금액", "청구액", "받기로 한 날", "입금일", "상태", "비고"]}
              wrap={[6]}
              align={["l", "r", "r", "l", "l", "l", "l"]}
              rows={(p.installments ?? []).map((i) => {
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
              })}
            />
          )}

          {(p.revenues ?? []).length > 0 && (
            <>
              <Sub>추가 수입</Sub>
              <RTable
                head={["항목", "금액", "부가세", "받은 날", "비고"]}
                wrap={[0, 4]}
                align={["l", "r", "l", "l", "l"]}
                rows={p.revenues.map((r) => [
                  r.label,
                  won(r.amount),
                  VAT_LABEL[r.vatMode ?? base],
                  r.receivedDate ?? (isReceived(r) ? "받음" : "—"),
                  r.note ?? "",
                ])}
              />
            </>
          )}

          {(p.deductions ?? []).length > 0 && (
            <>
              <Sub>매출 차감 (돌려준 돈)</Sub>
              <RTable
                head={["항목", "금액", "공급가액에서", "세금계산서", "돌려준 날", "비고"]}
                wrap={[0, 5]}
                align={["l", "r", "r", "l", "l", "l"]}
                rows={(p.deductions ?? []).map((d) => [
                  d.label,
                  won(d.amount),
                  won(deductionSplit(d, base).supply),
                  DEDUCTION_TAX_LABEL[d.taxMode],
                  d.paidDate ?? "아직",
                  d.note ?? "",
                ])}
              />
            </>
          )}
        </Section>

        {/* ---- 지출 ---- */}
        <Section title="지출" hint={s.lineCount > 0 ? `${s.lineCount}줄 · 견적 ${won(s.estimate)} · 실제 ${won(s.actual)}` : undefined}>
          {groups.length === 0 ? (
            <Empty>지출 줄이 없습니다.</Empty>
          ) : (
            <>
              <RTable
                head={["분류", "줄", "견적", "실제", "수입 대비"]}
                wrap={[0]}
                align={["l", "r", "r", "r", "r"]}
                rows={groups.map((g) => [
                  g.category,
                  g.lines.length,
                  won(g.estimate),
                  won(g.actual),
                  s.revenue > 0 ? `${((g.actual / s.revenue) * 100).toFixed(1)}%` : "—",
                ])}
                foot={["합계", s.lineCount, won(s.estimate), won(s.actual), s.revenue > 0 ? `${((s.actual / s.revenue) * 100).toFixed(1)}%` : "—"]}
              />
              <Sub>전체 줄</Sub>
              <RTable
                dense
                head={["분류", "품목", "수량", "단가", "견적", "실제", "발주처", "비고"]}
                wrap={[0, 1, 6, 7]}
                align={["l", "l", "r", "r", "r", "r", "l", "l"]}
                rows={groups.flatMap((g) =>
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
                )}
              />
            </>
          )}
        </Section>

        {/* ---- 원장 대조 ---- */}
        <Section
          title="원장 대조"
          hint={
            ledger.length > 0
              ? `${p.code} 코드로 찍힌 거래 ${ledger.length}건 · 수입 ${won(s.ledger.income)} · 지출 ${won(s.ledger.expense)}${s.ledger.refund ? ` · 환급 ${won(s.ledger.refund)}` : ""}`
              : undefined
          }
        >
          {ledger.length === 0 ? (
            <Empty>원장에 이 코드로 찍힌 거래가 없습니다.</Empty>
          ) : (
            <>
              <p className="mb-2 text-nd-caption text-nd-fg-2">
                원장 지출 {won(s.ledger.expense - s.ledger.refund)} vs 지출 줄의 실제 원가 {won(s.actual)} —
                {Math.abs(s.ledger.expense - s.ledger.refund - s.actual) < 1
                  ? " 같습니다."
                  : ` ${won(Math.abs(s.ledger.expense - s.ledger.refund - s.actual))} 차이. 카드 대금은 늦게 찍히고 현금·재고는 원장에 없을 수 있습니다.`}
              </p>
              <RTable
                dense
                head={["날짜", "구분", "거래처", "계정", "사업장", "금액"]}
                wrap={[2, 3]}
                align={["l", "l", "l", "l", "l", "r"]}
                rows={ledger.map((t) => [
                  t.date,
                  t.txType,
                  t.vendor ?? "",
                  [t.acctMid, t.acctMinor].filter(Boolean).join(" > "),
                  t.site ?? "",
                  <Money key="m" value={netAmount(t)} unit={false} flow={txFlow(t.txType)} />,
                ])}
              />
            </>
          )}
        </Section>

        {/* ---- 견적 · 계약 ---- */}
        <Section title="견적 · 계약">
          {pdocs.length === 0 ? (
            <Empty>ERP 에 붙은 견적서·계약서가 없습니다.</Empty>
          ) : (
            <RTable
              head={["종류", "번호 · 제목", "날짜", "상대", "금액", "상태"]}
              wrap={[1, 3]}
              align={["l", "l", "l", "l", "r", "l"]}
              rows={pdocs.map((d) =>
                isQuote(d)
                  ? ["견적서", `${formatQuoteNo(d.quoteNo)} ${d.title}`.trim(), d.date, d.recipient, won(quoteTotals(d).total), QUOTE_STATUS_LABEL[d.status]]
                  : ["계약서", d.title, d.signedDate ?? d.startDate ?? "—", d.counterparty, `${won(d.amount)} (${VAT_LABEL[d.vatMode]})`, CONTRACT_STATUS_LABEL[d.status]],
              )}
            />
          )}
        </Section>

        {/* ---- 메모 ---- */}
        {p.note && (
          <Section title="메모">
            <p className="whitespace-pre-wrap text-nd-table leading-relaxed text-nd-fg-2">{p.note}</p>
          </Section>
        )}

        <footer className="mt-8 flex justify-between border-t border-nd-line pt-2 text-nd-micro text-nd-fg-3">
          <span>NEANDER ERP · 재무 프로젝트</span>
          <span>출력 {todayStrKST()}</span>
        </footer>
      </article>
    </div>
  );
}

// ---- 부품 ------------------------------------------------------

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-nd-content px-3.5 py-3">
      <p className="text-nd-micro font-medium text-nd-fg-3">{label}</p>
      <p className="nd-num mt-0.5 text-nd-title font-semibold">{value}</p>
      {hint && <p className="mt-0.5 truncate text-nd-micro text-nd-fg-3" title={hint}>{hint}</p>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="nd-report-keep mb-2 flex flex-wrap items-baseline gap-x-2 border-b border-nd-line pb-1.5">
        <h2 className="text-nd-body font-semibold text-nd-fg">{title}</h2>
        {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-1.5 mt-4 text-nd-caption font-semibold text-nd-fg-2">{children}</h3>
);

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-nd-caption text-nd-fg-3">{children}</p>;

/**
 * 보고서 표 — 화면용 Table 은 가로 스크롤·고정 열을 전제로 해서 종이에
 * 맞지 않는다. 글자를 줄이고, `wrap` 으로 고른 긴 글 칸(비고·품목 …)만
 * 줄을 바꾼다 — 나머지까지 접히면 「구분」이 「구/분」, 날짜가 두 줄이 된다.
 */
function RTable({
  head,
  align,
  rows,
  foot,
  wrap = [],
  dense = false,
}: {
  head: string[];
  align: ("l" | "r")[];
  /** 줄을 바꿔도 되는 칸 번호 */
  wrap?: number[];
  rows: React.ReactNode[][];
  foot?: React.ReactNode[];
  dense?: boolean;
}) {
  const cell = (i: number) =>
    cn(
      dense ? "px-1.5 py-1" : "px-2 py-1.5",
      align[i] === "r" ? "nd-num text-right" : "text-left",
      wrap.includes(i) ? "break-words" : "whitespace-nowrap",
    );
  return (
    <table className={cn("w-full border-collapse", dense ? "text-nd-micro" : "text-nd-caption")}>
      <thead>
        <tr className="border-b border-nd-line bg-nd-sunken text-nd-fg-2">
          {head.map((h, i) => (
            <th key={h} scope="col" className={cn(cell(i), "font-medium")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-nd-line/70 align-top">
            {r.map((c, i) => (
              <td key={i} className={cell(i)}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="border-t-2 border-nd-line font-semibold">
            {foot.map((c, i) => (
              <td key={i} className={cell(i)}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
