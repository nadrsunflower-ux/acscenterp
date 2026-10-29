"use client";

// ============================================================
//  급여·세무 서류 — 세무사가 보낸 PDF 를 달마다 모아 보고, 서로 · 장부와 맞춘다
// ------------------------------------------------------------
//  PDF · zip · 폴더를 끌어다 놓으면 서버가 글자를 읽어 종류와 귀속을 정한다
//  (lib/neander/finance/tax-docs-parse.ts). 표는 귀속월마다 한 줄 — 어느 서류가
//  왔고, 숫자가 서로 맞고, 낼 세금이 장부에서 나갔는지 (tax-docs-check.ts).
//
//  모양은 지원금 목록을 따른다 — 제목 줄 → 올리기 → 핵심 지표 → 탭 → 표.
//  한 달을 누르면 오른쪽 판(Sheet)에 확인할 것 · 사람별 · 서류 목록.
// ============================================================

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FolderUp,
  Info,
  Pencil,
  ScanLine,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  DropZone,
  EmptyState,
  Field,
  Icon,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  Sheet,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Th,
  Tr,
  useConfirm,
  useStickyState,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { todayStrKST } from "@/lib/neander/format";
import {
  cadenceOf,
  MONTH_COLUMNS,
  periodLabel,
  periodYear,
  QUARTER_COLUMNS,
  TAX_DOC_KINDS,
  TAX_ENTITIES,
  taxKindLabel,
  taxKindMeta,
  type TaxDoc,
  type TaxDocKind,
} from "@/lib/neander/finance/tax-docs";
import {
  buildTaxMonths,
  buildVatQuarters,
  worstState,
  type TaxCheck,
  type TaxCheckState,
  type TaxMonthView,
  type TaxVatView,
} from "@/lib/neander/finance/tax-docs-check";
import {
  deleteTaxDoc,
  downloadTaxDoc,
  openTaxDoc,
  updateTaxDoc,
  uploadTaxFiles,
  useTaxDocs,
  type TaxUploadReport,
} from "@/lib/neander/finance/tax-docs-client";

type TabKey = "month" | "vat" | "year" | "inbox";

const STATE_META: Record<TaxCheckState, { icon: typeof CircleCheck; cls: string; label: string; tone: Tone }> = {
  ok: { icon: CircleCheck, cls: "text-nd-success-text", label: "맞음", tone: "success" },
  warn: { icon: TriangleAlert, cls: "text-nd-warning-text", label: "확인", tone: "warning" },
  bad: { icon: CircleAlert, cls: "text-nd-danger-text", label: "안 맞음", tone: "danger" },
  wait: { icon: Clock, cls: "text-nd-info-text", label: "납부 전", tone: "info" },
  info: { icon: Info, cls: "text-nd-fg-3", label: "참고", tone: "neutral" },
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const md = (d?: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const monthsOf = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

export default function TaxDocsPage() {
  const { transactions, loading: finLoading } = useFinance();
  const { docs, loading, error } = useTaxDocs();
  const today = todayStrKST();
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useStickyState<string>("finance.taxDocs.year", thisYear);
  const [tab, setTab] = useStickyState<TabKey>("finance.taxDocs.tab", "month");
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [openVat, setOpenVat] = useState<string | null>(null);

  const months = useMemo(() => buildTaxMonths(docs, transactions, today), [docs, transactions, today]);
  const vats = useMemo(() => buildVatQuarters(docs, transactions, today), [docs, transactions, today]);
  const monthBy = useMemo(() => new Map(months.map((m) => [m.period, m])), [months]);

  const years = useMemo(() => {
    const set = new Set([thisYear, ...docs.map((d) => periodYear(d.period)).filter((y): y is string => !!y)]);
    return [...set].sort().reverse();
  }, [docs, thisYear]);

  // 월별 표 — 그 해의 첫 서류 달부터 (올해면 이번 달까지, 지난해면 12월까지). 빈 달도 보여 빠진 달이 드러나게
  const monthRows = useMemo(() => {
    const all = monthsOf(year);
    const have = all.filter((p) => monthBy.has(p));
    if (!have.length) return [];
    const last = year === thisYear ? (have[have.length - 1] > today.slice(0, 7) ? have[have.length - 1] : today.slice(0, 7)) : `${year}-12`;
    return all.filter((p) => p >= have[0] && p <= last).reverse();
  }, [year, monthBy, thisYear, today]);

  const yearMonths = useMemo(() => months.filter((m) => m.period.startsWith(year)), [months, year]);
  const yearVats = useMemo(() => vats.filter((v) => v.period.startsWith(year)), [vats, year]);
  const yearCerts = useMemo(() => docs.filter((d) => cadenceOf(d.kind) === "year" && d.period && Number(d.period) >= Number(year) - 1 && Number(d.period) <= Number(year)), [docs, year]);
  const inbox = useMemo(() => docs.filter((d) => d.kind === "other" || !d.period), [docs]);

  const head = useMemo(() => {
    const all = [...yearMonths.flatMap((m) => [...m.checks, ...m.ledgerChecks]), ...yearVats.flatMap((v) => v.checks)];
    return {
      wage: yearMonths.reduce((n, m) => n + (m.wage?.gross ?? 0), 0),
      biz: yearMonths.reduce((n, m) => n + (m.biz?.gross ?? 0), 0),
      wht: yearMonths.reduce((n, m) => n + m.whtWage + m.whtBiz + m.localDue, 0),
      bad: all.filter((c) => c.state === "bad").length,
      warn: all.filter((c) => c.state === "warn").length,
      months: yearMonths.length,
    };
  }, [yearMonths, yearVats]);

  if (loading || finLoading) return <LoadingState />;

  const tabs = [
    { key: "month", label: "원천세 · 급여", hint: String(yearMonths.length) },
    { key: "vat", label: "부가세", hint: String(yearVats.length) },
    { key: "year", label: "연말정산", hint: String(yearCerts.length) },
    { key: "inbox", label: "분류 필요", hint: String(inbox.length) },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        title="급여 · 세무 서류"
        description="세무사가 보낸 급여대장 · 명세서 · 사업대장 · 신고서 · 납부서를 귀속월마다 모아 두고, 숫자가 서로 맞는지와 장부에서 세금이 나갔는지 봅니다."
        className="mb-4"
        actions={
          years.length > 1 ? (
            <Select value={year} onChange={(e) => setYear(e.target.value)} aria-label="해" className="w-28">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      <UploadBar />

      {error && (
        <InlineNotice tone="danger" className="mb-4">
          {error}
        </InlineNotice>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="아직 올린 서류가 없습니다"
          description="세무사가 보낸 PDF · zip 을 위에 끌어다 놓거나, 회계 폴더의 해 폴더(예: 2026)를 「폴더째 올리기」 로 고르세요. 같은 파일은 두 번 들어가지 않습니다."
        />
      ) : (
        <>
          <KpiStrip columns={4} className="mb-4">
            <StatTile label={`근로소득 지급 (${year})`} value={head.wage} flow="expense" hint={`${head.months}개월 · 급여대장 · 명세서 기준`} />
            <StatTile label="사업소득 지급 (3.3%)" value={head.biz} flow="expense" hint="사업소득 지급대장 기준" />
            <StatTile label="원천세 · 지방소득세" value={head.wht} flow="expense" hint="납부서 → 신고서 → 대장 순으로 고른 낼 돈" />
            <KpiItem
              label="확인할 것"
              value={head.bad + head.warn}
              unit="건"
              tone={head.bad ? "danger" : head.warn ? "warning" : "success"}
              hint={head.bad + head.warn ? `안 맞음 ${head.bad} · 확인 ${head.warn}` : "서류끼리 · 장부와 모두 맞습니다"}
            />
          </KpiStrip>

          <Tabs className="mb-3" ariaLabel="서류 묶음" value={tab} onChange={(k) => setTab(k as TabKey)} items={tabs} />

          {tab === "month" && <MonthTable rows={monthRows} monthBy={monthBy} onOpen={setOpenMonth} year={year} />}
          {tab === "vat" && <VatTable rows={yearVats} onOpen={setOpenVat} />}
          {tab === "year" && <YearCerts docs={yearCerts} />}
          {tab === "inbox" && <Inbox docs={inbox} />}
        </>
      )}

      <Sheet open={!!openMonth} onClose={() => setOpenMonth(null)} width={820} title={openMonth ? `${periodLabel(openMonth)} 귀속` : ""}>
        {openMonth && <MonthDetail period={openMonth} view={monthBy.get(openMonth)} />}
      </Sheet>
      <Sheet open={!!openVat} onClose={() => setOpenVat(null)} width={720} title={openVat ? `부가세 · ${periodLabel(openVat.split("|")[0])} · ${openVat.split("|")[1]}` : ""}>
        {openVat && <VatDetail view={vats.find((v) => `${v.period}|${v.entity}` === openVat)} />}
      </Sheet>
    </PageShell>
  );
}

// ---- 올리기 --------------------------------------------------------

function UploadBar() {
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ p: number; name: string } | null>(null);
  const [report, setReport] = useState<TaxUploadReport | null>(null);
  const toast = useToast();

  const run = async (files: File[]) => {
    if (!files.length) return;
    setReport(null);
    setBusy({ p: 0, name: "" });
    try {
      const r = await uploadTaxFiles(files, (p, name) => setBusy({ p, name }));
      setReport(r);
      if (r.added.length && !r.failed.length) toast.success(`서류 ${r.added.length}개를 올렸습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "올리지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const unsorted = report?.added.filter((d) => d.kind === "other" || !d.period) ?? [];

  return (
    <div className="mb-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <DropZone
          className="flex-1"
          compact
          multiple
          accept=".pdf,.zip,.xlsx,.xls,.jpg,.jpeg,.png,.docx,.hwp,.hwpx"
          busy={!!busy}
          disabled={!!busy}
          icon={Upload}
          title={busy ? `올리는 중 ${Math.round(busy.p * 100)}% · ${busy.name}` : "PDF · zip 을 끌어다 놓거나 눌러서 고르기"}
          hint="종류와 귀속월은 파일 안 글자로 정합니다 · 같은 파일은 두 번 들어가지 않습니다"
          onFiles={run}
        />
        <Button variant="secondary" icon={FolderUp} disabled={!!busy} onClick={() => folderRef.current?.click()} className="sm:self-stretch">
          폴더째 올리기
        </Button>
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void run(files);
          }}
        />
      </div>
      {report && (
        <InlineNotice tone={report.failed.length ? "danger" : unsorted.length ? "warning" : "success"} className="mt-2">
          <span className="text-nd-body">
            {report.added.length}개 올림
            {report.duplicates.length > 0 && ` · ${report.duplicates.length}개는 이미 있어 건너뜀`}
            {report.skipped.length > 0 && ` · 서류가 아닌 파일 ${report.skipped.length}개 뺌`}
            {unsorted.length > 0 && ` · ${unsorted.length}개는 종류나 귀속을 못 정해 「분류 필요」 에 있습니다`}
          </span>
          {report.failed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-nd-table">
              {report.failed.map((f) => (
                <li key={f.name}>
                  {f.name} — {f.error}
                </li>
              ))}
            </ul>
          )}
        </InlineNotice>
      )}
    </div>
  );
}

// ---- 월별 표 -------------------------------------------------------

function StateBadge({ checks }: { checks: TaxCheck[] }) {
  const worst = worstState(checks.filter((c) => c.state !== "info"));
  if (!worst) return <span className="text-nd-fg-4">—</span>;
  const meta = STATE_META[worst];
  const n = checks.filter((c) => c.state === worst).length;
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
      {worst !== "ok" && n > 1 ? ` ${n}` : ""}
    </Badge>
  );
}

function HaveCell({ list, of }: { list?: TaxDoc[]; of?: number }) {
  if (!list?.length) return <span className="text-nd-fg-4">—</span>;
  const scanned = list.every((d) => d.scanned);
  const count = list.reduce((n, d) => n + Math.max(1, d.data?.people?.length ?? 1), 0);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-nd-table text-nd-fg">
      <Icon icon={scanned ? ScanLine : CircleCheck} size={15} className={scanned ? "text-nd-fg-3" : "text-nd-success-text"} />
      {of !== undefined ? `${count}/${of}` : list.length > 1 ? `${list.length}판` : ""}
    </span>
  );
}

function MonthTable({ rows, monthBy, onOpen, year }: { rows: string[]; monthBy: Map<string, TaxMonthView>; onOpen: (p: string) => void; year: string }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState compact icon={FileText} title={`${year}년 귀속 급여 · 원천세 서류가 없습니다`} />
      </Card>
    );
  }
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 pt-5">
        <SectionHeader
          title="귀속월별"
          hint="누르면 확인할 것 · 사람별 · 서류"
          action={<TableNote>단위: 원 · ✓ 글자로 읽음 · 스캔 아이콘은 글자 없는 스캔본</TableNote>}
        />
      </div>
      <TableScroll>
        <Table minWidth={1240}>
          <thead>
            <tr>
              <Th sticky="left" className="pl-5">귀속월</Th>
              {MONTH_COLUMNS.map((k) => (
                <Th key={k} title={taxKindMeta(k).hint}>{taxKindMeta(k).short}</Th>
              ))}
              <Th align="right">근로 지급</Th>
              <Th align="right">사업 지급</Th>
              <Th align="right">낼 원천세</Th>
              <Th>기한</Th>
              <Th className="pr-5">확인</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = monthBy.get(p);
              if (!v) {
                return (
                  <Tr key={p}>
                    <Td sticky="left" className="pl-5 font-medium text-nd-fg-3">{Number(p.slice(5))}월</Td>
                    <Td colSpan={MONTH_COLUMNS.length + 5} className="pr-5 text-nd-table text-nd-fg-4">
                      서류 없음 — 세무사에게 받았다면 올려 주세요
                    </Td>
                  </Tr>
                );
              }
              const due = v.whtWage + v.whtBiz + v.localDue;
              return (
                <Tr
                  key={p}
                  onClick={() => onOpen(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpen(p);
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${periodLabel(p)} 상세`}
                  className="cursor-pointer focus:bg-nd-accent-soft/60 focus:outline-none"
                >
                  <Td sticky="left" className="pl-5 text-nd-body font-medium text-nd-fg">{Number(p.slice(5))}월</Td>
                  {MONTH_COLUMNS.map((k) => (
                    <Td key={k}>
                      <HaveCell list={v.byKind[k]} of={k === "payslip" && v.wage?.count ? v.wage.count : undefined} />
                    </Td>
                  ))}
                  <Td num>{v.wage ? <Money value={v.wage.gross} unit={false} /> : <span className="text-nd-fg-4">—</span>}</Td>
                  <Td num>{v.biz ? <Money value={v.biz.gross} unit={false} /> : <span className="text-nd-fg-4">—</span>}</Td>
                  <Td num>{due ? <Money value={due} unit={false} /> : <span className="text-nd-fg-4">—</span>}</Td>
                  <Td className="whitespace-nowrap text-nd-table text-nd-fg-2">{md(v.dueDate)}</Td>
                  <Td className="pr-5">
                    <StateBadge checks={[...v.checks, ...v.ledgerChecks]} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </Card>
  );
}

// ---- 한 달 상세 ----------------------------------------------------

function CheckList({ checks, empty }: { checks: TaxCheck[]; empty: string }) {
  if (!checks.length) return <p className="text-nd-table text-nd-fg-3">{empty}</p>;
  const order: TaxCheckState[] = ["bad", "warn", "wait", "info", "ok"];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return (
    <ul className="space-y-2">
      {sorted.map((c) => {
        const m = STATE_META[c.state];
        return (
          <li key={c.key} className="flex gap-2">
            <Icon icon={m.icon} size={17} className={cn("mt-0.5 shrink-0", m.cls)} />
            <div className="min-w-0">
              <div className="text-nd-body font-medium text-nd-fg">{c.title}</div>
              {c.detail && <div className="text-nd-table text-nd-fg-2">{c.detail}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-nd-border px-5 py-4 first:border-t-0">
      <SectionHeader as="h3" title={title} hint={hint} />
      {children}
    </section>
  );
}

function MonthDetail({ period, view }: { period: string; view?: TaxMonthView }) {
  if (!view) return <p className="px-5 py-4 text-nd-body text-nd-fg-3">이 달 서류가 없습니다.</p>;
  const wageRows = view.people.filter((p) => p.type === "wage");
  const bizRows = view.people.filter((p) => p.type === "biz");
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-4">
        <Figure label="근로 지급" value={view.wage?.gross} hint={view.wage ? `${view.wage.count}명 · 소득세 ${won(view.wage.tax)}` : undefined} />
        <Figure label="사업 지급" value={view.biz?.gross} hint={view.biz ? `${view.biz.count}명 · 소득세 ${won(view.biz.tax)}` : undefined} />
        <Figure label="낼 원천세 (국세)" value={view.whtWage + view.whtBiz || undefined} hint={`근로 ${won(view.whtWage)} · 사업 ${won(view.whtBiz)}`} />
        <Figure label="낼 지방소득세" value={view.localDue || undefined} hint={`기한 ${md(view.dueDate)}`} />
      </div>
      <Section title="장부와" hint="낼 세금이 원장에서 나갔는가">
        <CheckList checks={view.ledgerChecks} empty="낼 세금을 서류에서 읽지 못했습니다." />
      </Section>
      <Section title="서류끼리" hint="같은 숫자가 다른 장에서도 같은가">
        <CheckList checks={view.checks} empty="맞춰 볼 서류가 아직 한 장뿐입니다." />
      </Section>
      {view.people.length > 0 && (
        <Section title="사람별" hint="장부 지급은 이름이 같은 인건비 지출 중 가장 가까운 것 (참고)">
          <TableScroll>
            <Table minWidth={680}>
              <thead>
                <tr>
                  <Th>이름</Th>
                  <Th align="right">지급</Th>
                  <Th align="right">공제</Th>
                  <Th align="right">차인지급액</Th>
                  <Th>{wageRows.length ? "명세서" : "영수증"}</Th>
                  <Th>장부 지급</Th>
                </tr>
              </thead>
              <tbody>
                {[["근로소득", wageRows], ["사업소득 (3.3%)", bizRows]].map(([label, rows]) =>
                  (rows as typeof wageRows).length ? (
                    <PersonGroup key={label as string} label={label as string} rows={rows as typeof wageRows} />
                  ) : null,
                )}
              </tbody>
            </Table>
          </TableScroll>
        </Section>
      )}
      <Section title="서류" hint={`${view.docs.length}장`}>
        <DocList docs={view.docs} order={MONTH_COLUMNS} />
      </Section>
    </div>
  );
}

function PersonGroup({ label, rows }: { label: string; rows: TaxMonthView["people"] }) {
  return (
    <>
      <tr>
        <td colSpan={6} className="pt-3 pb-1 text-nd-table font-medium text-nd-fg-3">
          {label} · {rows.length}명
        </td>
      </tr>
      {rows.map((p) => (
        <Tr key={`${p.type}-${p.key}`}>
          <Td className="whitespace-nowrap font-medium text-nd-fg">{p.name}</Td>
          <Td num><Money value={p.gross} unit={false} /></Td>
          <Td num><Money value={p.deduct} unit={false} muted /></Td>
          <Td num><Money value={p.net} unit={false} /></Td>
          <Td className="whitespace-nowrap text-nd-table">
            {p.slipNet === undefined ? (
              <span className="text-nd-fg-4">—</span>
            ) : p.slipNet === p.net ? (
              <span className="text-nd-success-text">같음</span>
            ) : (
              <span className="text-nd-danger-text">{won(p.slipNet)}</span>
            )}
          </Td>
          <Td className="whitespace-nowrap text-nd-table">
            {p.paid ? (
              <>
                <span className="text-nd-fg-2">{md(p.paid.tx.date)}</span>{" "}
                <span className={p.paid.diff === 0 ? "text-nd-success-text" : Math.abs(p.paid.diff) <= 1000 ? "text-nd-fg-2" : "text-nd-warning-text"}>
                  {p.paid.diff === 0 ? "같음" : `${p.paid.diff > 0 ? "+" : ""}${won(p.paid.diff)}`}
                </span>
                {Math.abs(p.paid.diff) === 500 && <span className="text-nd-fg-3"> (이체 수수료로 보임)</span>}
              </>
            ) : (
              <span className="text-nd-fg-4">못 찾음</span>
            )}
          </Td>
        </Tr>
      ))}
    </>
  );
}

function Figure({ label, value, text, hint }: { label: string; value?: number; text?: string; hint?: string }) {
  return (
    <div className="rounded-nd-lg bg-nd-sunken px-3 py-2.5">
      <div className="text-nd-table text-nd-fg-3">{label}</div>
      <div className="text-nd-section text-nd-fg">
        {value !== undefined ? <Money value={value} /> : text ? <span className="nd-num">{text}</span> : <span className="text-nd-fg-4">—</span>}
      </div>
      {hint && <div className="text-nd-table text-nd-fg-3">{hint}</div>}
    </div>
  );
}

// ---- 서류 목록 · 고치기 ----------------------------------------------

function DocList({ docs, order }: { docs: TaxDoc[]; order?: TaxDocKind[] }) {
  const rank = (k: TaxDocKind) => {
    const i = order?.indexOf(k) ?? -1;
    return i < 0 ? 99 : i;
  };
  const sorted = [...docs].sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name, "ko"));
  return (
    <ul className="divide-y divide-nd-border">
      {sorted.map((d) => (
        <DocRow key={d.id} doc={d} />
      ))}
    </ul>
  );
}

function DocRow({ doc }: { doc: TaxDoc }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={doc.kind === "other" ? "warning" : "neutral"}>{taxKindLabel(doc.kind)}</Badge>
            {doc.scanned && (
              <Badge tone="neutral">
                <Icon icon={ScanLine} size={12} className="mr-0.5" />
                스캔본
              </Badge>
            )}
            {doc.entity && doc.entity !== "네안데르" && <Badge tone="info">{doc.entity}</Badge>}
            <span className="truncate text-nd-body text-nd-fg" title={doc.name}>
              {doc.name}
            </span>
          </div>
          {doc.data?.people?.length === 1 && (doc.kind === "wage-cert" || doc.kind === "biz-cert") && (
            <div className="text-nd-table text-nd-fg-2">
              {doc.data.people[0].name} · {doc.kind === "wage-cert" ? "총급여" : "지급액"} {won(doc.data.people[0].gross)}원
            </div>
          )}
          <div className="text-nd-table text-nd-fg-3">
            {periodLabel(doc.period)} · {doc.reason ?? ""} · {doc.uploadedBy === "cli" ? "회계 폴더에서 옮김" : doc.uploadedBy.split("@")[0]} ·{" "}
            {new Date(doc.createdAt).toLocaleDateString("ko-KR")}
            {doc.note && ` · ${doc.note}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" icon={ExternalLink} disabled={busy} onClick={() => act(() => openTaxDoc(doc))}>
            열기
          </Button>
          <Button size="sm" variant="ghost" icon={Download} disabled={busy} onClick={() => act(() => downloadTaxDoc(doc))} aria-label={`${doc.name} 내려받기`} />
          <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={() => setEditing((v) => !v)} aria-label={`${doc.name} 종류 · 귀속 고치기`} />
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            disabled={busy}
            aria-label={`${doc.name} 지우기`}
            onClick={async () => {
              if (!(await confirm({ title: "이 서류를 지울까요?", message: `「${doc.name}」 — 원본이 회계 폴더에 있는지 확인하세요.`, confirmLabel: "지우기", tone: "danger" }))) return;
              await act(() => deleteTaxDoc(doc.id));
            }}
          />
        </div>
      </div>
      {editing && <DocEditor doc={doc} onDone={() => setEditing(false)} />}
    </li>
  );
}

function DocEditor({ doc, onDone }: { doc: TaxDoc; onDone: () => void }) {
  const [kind, setKind] = useState<TaxDocKind>(doc.kind);
  const [period, setPeriod] = useState(doc.period ?? "");
  const [entity, setEntity] = useState(doc.entity ?? "");
  const [note, setNote] = useState(doc.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cad = cadenceOf(kind);
  const placeholder = cad === "quarter" ? "2026-Q2" : cad === "year" ? "2025" : "2026-10";
  return (
    <div className="mt-2 rounded-nd-lg bg-nd-sunken p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="종류">
          <Select value={kind} onChange={(e) => setKind(e.target.value as TaxDocKind)}>
            {TAX_DOC_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="귀속" hint={cad === "quarter" ? "분기 — 2026-Q2" : cad === "year" ? "해 — 2025" : "달 — 2026-10"}>
          <Input value={period} onChange={(e) => setPeriod(e.target.value.trim())} placeholder={placeholder} />
        </Field>
        <Field label="사업자">
          <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">모름</option>
            {TAX_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="메모">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="정정본 · 세무사 확인 필요 …" />
        </Field>
      </div>
      {error && (
        <InlineNotice tone="danger" className="mt-2">
          {error}
        </InlineNotice>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={saving}>
          취소
        </Button>
        <Button
          size="sm"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await updateTaxDoc(doc.id, {
                ...(kind !== doc.kind || period !== (doc.period ?? "") ? { kind, period } : {}),
                entity,
                note,
              });
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
              setSaving(false);
            }
          }}
        >
          저장
        </Button>
      </div>
    </div>
  );
}

// ---- 부가세 --------------------------------------------------------

function VatTable({ rows, onOpen }: { rows: TaxVatView[]; onOpen: (key: string) => void }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState compact icon={FileText} title="이 해의 부가세 서류가 없습니다" description="신고서 · 접수증 · 납부서를 올리면 분기마다 모입니다." />
      </Card>
    );
  }
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 pt-5">
        <SectionHeader title="분기별" hint="사업자마다 한 줄" action={<TableNote>단위: 원 · 납부할 세액이 음수면 환급</TableNote>} />
      </div>
      <TableScroll>
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th sticky="left" className="pl-5">분기</Th>
              <Th>사업자</Th>
              {QUARTER_COLUMNS.map((k) => (
                <Th key={k}>{taxKindMeta(k).short}</Th>
              ))}
              <Th align="right">과세표준</Th>
              <Th align="right">납부할 세액</Th>
              <Th>기한</Th>
              <Th className="pr-5">확인</Th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((v) => {
              const key = `${v.period}|${v.entity}`;
              return (
                <Tr
                  key={key}
                  onClick={() => onOpen(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpen(key);
                  }}
                  tabIndex={0}
                  role="button"
                  className="cursor-pointer focus:bg-nd-accent-soft/60 focus:outline-none"
                >
                  <Td sticky="left" className="whitespace-nowrap pl-5 font-medium text-nd-fg">{periodLabel(v.period).replace(/^\d+년 /, "")}</Td>
                  <Td className="whitespace-nowrap text-nd-fg-2">{v.entity}</Td>
                  {QUARTER_COLUMNS.map((k) => (
                    <Td key={k}>
                      <HaveCell list={v.byKind[k]} />
                    </Td>
                  ))}
                  <Td num>{v.base !== undefined ? <Money value={v.base} unit={false} /> : <span className="text-nd-fg-4">—</span>}</Td>
                  <Td num>{v.payable !== undefined ? <Money value={v.payable} unit={false} /> : <span className="text-nd-fg-4">—</span>}</Td>
                  <Td className="whitespace-nowrap text-nd-table text-nd-fg-2">{md(v.dueDate)}</Td>
                  <Td className="pr-5">
                    <StateBadge checks={v.checks} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </Card>
  );
}

function VatDetail({ view }: { view?: TaxVatView }) {
  if (!view) return <p className="px-5 py-4 text-nd-body text-nd-fg-3">서류가 없습니다.</p>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-3">
        <Figure label="과세표준" value={view.base} />
        <Figure label="납부할 세액" value={view.payable} hint={view.billed !== undefined ? `납부서 ${won(view.billed)}` : undefined} />
        <Figure label="납부기한" text={view.dueDate} hint="토 · 일이면 다음 월요일" />
      </div>
      <Section title="확인할 것">
        <CheckList checks={view.checks} empty="맞춰 볼 숫자가 아직 없습니다." />
      </Section>
      <Section title="서류" hint={`${view.docs.length}장`}>
        <DocList docs={view.docs} order={QUARTER_COLUMNS} />
      </Section>
    </div>
  );
}

// ---- 연말정산 · 분류 필요 --------------------------------------------

function YearCerts({ docs }: { docs: TaxDoc[] }) {
  if (!docs.length) {
    return (
      <Card>
        <EmptyState compact icon={FileText} title="근로소득 원천징수영수증이 없습니다" description="연말정산이 끝나면 세무사가 사람마다 한 장씩 보내 줍니다." />
      </Card>
    );
  }
  const byYear = new Map<string, TaxDoc[]>();
  for (const d of docs) byYear.set(d.period!, [...(byYear.get(d.period!) ?? []), d]);
  return (
    <div className="space-y-4">
      {[...byYear.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([y, list]) => {
          const total = list.reduce((n, d) => n + (d.data?.people?.[0]?.gross ?? 0), 0);
          return (
            <Card key={y}>
              <SectionHeader title={`${y}년 귀속 근로소득`} hint={`${list.length}명 · 총급여 ${won(total)}원`} action={<TableNote>파일에 주민등록번호가 있습니다 — 재무 권한자만 열 수 있습니다</TableNote>} />
              <DocList docs={list} />
            </Card>
          );
        })}
    </div>
  );
}

function Inbox({ docs }: { docs: TaxDoc[] }) {
  if (!docs.length) {
    return (
      <Card>
        <EmptyState compact icon={CircleCheck} title="분류가 필요한 서류가 없습니다" />
      </Card>
    );
  }
  return (
    <Card>
      <SectionHeader title="종류나 귀속을 못 정한 서류" hint={`${docs.length}장 · 연필을 눌러 고르세요`} />
      <DocList docs={docs} />
    </Card>
  );
}
