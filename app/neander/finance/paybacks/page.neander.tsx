"use client";

// ============================================================
//  돌려줄 돈 — 거래처에 부가세와 우리 몫을 떼고 돌려줄 돈
// ------------------------------------------------------------
//  돌려줄 돈 = 받은 돈 − 부가세 − 우리 몫 (lib/neander/finance/payback.ts 머리말).
//  사람이 적는 칸은 「우리 몫」 이고, 돌려줄 돈은 적는 동안 계산 줄로 바로 보인다.
//
//  한 표에 두 출처가 섞인다.
//    · 프로젝트 「매출 차감」 — 정본은 프로젝트 문서다. 여기서 고치면 그 프로젝트를
//      다시 저장한다(sanitizeProject → saveFinProject). 이익 계산이 그 줄을 읽기
//      때문에 같은 돈을 이 화면에 따로 적으면 두 번 빠진다.
//    · 따로 적은 건 — 계약 없이 생긴 돌려줄 돈 (neander_fin_paybacks).
//  「+ 돌려줄 돈」 에서 프로젝트를 고르면 앞쪽, 안 고르면 뒤쪽으로 저장된다.
//
//  화면 구성은 프로젝트 목록을 따른다: 제목 줄 → 상태 탭 → 검색 → 핵심 지표 → 표.
//  행을 누르면 그 자리에서 고치는 창이 열린다.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { HandCoins, Plus, SearchX, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  FilterBar,
  FilterField,
  FormRow,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  Money,
  NumberInput,
  PageHeader,
  PageShell,
  SearchInput,
  SectionHeader,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  type Tone,
  Tr,
  cn,
  useConfirm,
  useStickyState,
  useToast,
} from "@/components/neander/ui";
import { AutoCodeBox } from "@/components/neander/finance/AutoCode";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { DueInput, type DueValue } from "@/components/neander/finance/DueInput";
import { saveFinProject } from "@/lib/neander/finance/client";
import { nextCode, saveWithAutoCode, takenCodes } from "@/lib/neander/finance/codes";
import {
  DEDUCTION_TAX_LABEL,
  PROJECT_ENTITIES,
  VAT_LABEL,
  VAT_MODES,
  dueLabel,
  isInstallmentReceived,
  isReceived,
  paidLabel,
  projectSummary,
  sanitizeProject,
  shortId,
  splitVat,
  type FinProjectDeduction,
  type FinProjectDoc,
  type ProjectEntity,
  type VatMode,
} from "@/lib/neander/finance/project";
import {
  PAYBACK_STATUS_LABEL,
  deductionAmountForKeep,
  emptyPayback,
  paybackCalc,
  paybackRows,
  paybackTotals,
  projectGross,
  txCandidates,
  type FinPaybackDoc,
  type FinPaybackInput,
  type PaybackRow,
  type PaybackStatus,
} from "@/lib/neander/finance/payback";
import { deletePayback, fetchPaybacks, savePayback } from "@/lib/neander/finance/payback-client";
import { netAmount } from "@/lib/neander/finance/types";
import { todayStrKST } from "@/lib/neander/format";

const STATUS_TONE: Record<PaybackStatus, Tone> = {
  open: "warning",
  late: "danger",
  paid: "success",
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 「11,000,000 − 부가세 1,000,000 − 우리 몫 3,000,000 = 돌려줄 돈 7,000,000원」 */
function CalcLine({ total, vat, keep, amount, totalLabel = "받은 돈" }: { total: number; vat: number; keep: number; amount: number; totalLabel?: string }) {
  return (
    <p className="nd-num rounded-nd-md bg-nd-sunken px-3 py-2 text-nd-table text-nd-fg-2">
      {totalLabel} {won(total)} − 부가세 {won(vat)} − 우리 몫 {won(keep)} ={" "}
      <b className={cn("font-semibold", amount < 0 ? "text-nd-danger-text" : "text-nd-fg")}>돌려줄 돈 {won(amount)}원</b>
    </p>
  );
}

/** 돈이 오간 순서대로 읽는 세 구역. 입력과 기록을 같은 구역 안에 둔다. */
function PaybackSection({ step, title, description, children }: { step: number; title: string; description: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-nd-lg border border-nd-line">
      <div className="flex items-start gap-3 border-b border-nd-line bg-nd-sunken/60 px-4 py-3">
        <span aria-hidden="true" className="nd-num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nd-content text-nd-table font-semibold text-nd-fg-2">{step}</span>
        <div className="min-w-0">
          <h3 id={id} className="text-nd-body font-semibold text-nd-fg">{title}</h3>
          <p className="mt-0.5 text-nd-caption text-nd-fg-3">{description}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

function ProjectReceiptRecords({ project }: { project: FinProjectDoc }) {
  const summary = projectSummary(project);
  const entity = project.entities?.join(" · ") || "—";
  const records = [
    ...(project.installments ?? []).map((i) => {
      const received = isInstallmentReceived(i);
      return {
        key: `installment:${i.id}`, label: i.kind, entity: i.entity || entity, received,
        date: received ? paidLabel(i) || "날짜 미확인" : dueLabel(i) || "날짜 미정",
        amount: splitVat(i.amount, project.vatMode).total,
      };
    }),
    ...(project.revenues ?? []).map((r) => ({
      key: `revenue:${r.id}`, label: r.label || "추가 수입", entity, received: isReceived(r),
      date: r.receivedDate || (isReceived(r) ? "날짜 미확인" : "날짜 미정"),
      amount: splitVat(r.amount, r.vatMode ?? project.vatMode).total,
    })),
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FieldBox label="받은 금액">
          <span className="nd-num text-nd-body font-semibold text-nd-fg">{won(summary.received)}원</span>
        </FieldBox>
        <FieldBox label="계약·청구 금액" hint="부가세 포함">
          <span className="nd-num text-nd-body text-nd-fg-2">{won(summary.grossTotal)}원</span>
        </FieldBox>
        <FieldBox label="부가세">
          <span className="nd-num text-nd-body text-nd-fg-2">{won(projectGross(project).vat)}원</span>
        </FieldBox>
      </div>
      {records.length > 0 ? (
        <div className="overflow-hidden rounded-nd-md border border-nd-line">
          <TableScroll>
            <Table minWidth={450} dense>
              <thead>
                <tr>
                  <Th>입금 내역</Th>
                  <Th>받는 사업체</Th>
                  <Th>받은 날·예정일</Th>
                  <Th align="right">금액</Th>
                  <Th>상태</Th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <Tr key={r.key}>
                    <Td>{r.label}</Td>
                    <Td>{r.entity}</Td>
                    <Td className="whitespace-nowrap">{r.date}</Td>
                    <Td num>{won(r.amount)}원</Td>
                    <Td><Badge tone={r.received ? "success" : "warning"}>{r.received ? "받음" : "입금 예정"}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </div>
      ) : (
        <TableNote>입금 기록이 아직 없습니다. 프로젝트에서 받은 날짜와 금액을 기록할 수 있습니다.</TableNote>
      )}
      <Link href={`/neander/finance/projects/${project.id}#revenue`} className="self-start text-nd-table text-nd-accent-strong hover:underline">프로젝트에서 입금 기록 보기</Link>
    </>
  );
}

/** Field 와 같은 모양의 칸 — 안에 단추가 있는 입력(DueInput)은 <label> 로 감싸면 누를 때 엉뚱한 데로 간다 */
function FieldBox({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-nd-caption font-medium text-nd-fg-2">{label}</span>
      {children}
      {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
    </div>
  );
}

export default function PaybacksPage() {
  const { projects, transactions, loading, refresh } = useFinance();
  const toast = useToast();
  const [paybacks, setPaybacks] = useState<FinPaybackDoc[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useStickyState<PaybackStatus | "all">("finance.paybacks.status", "all");
  const [q, setQ] = useStickyState("finance.paybacks.q", "");
  /** 열린 창 — 새로 적기 · 따로 적은 건 · 프로젝트 차감 */
  const [editing, setEditing] = useState<{ kind: "new" } | { kind: "row"; row: PaybackRow } | null>(null);

  const reload = useCallback(async () => {
    try {
      setPaybacks(await fetchPaybacks());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "돌려줄 돈을 읽지 못했습니다.");
    }
  }, []);
  // 재무 데이터가 다 온 뒤에 읽는다 — 그때는 로그인이 끝나 있다
  useEffect(() => {
    if (!loading) void reload();
  }, [loading, reload]);

  const today = todayStrKST();
  const allRows = useMemo(() => paybackRows(paybacks ?? [], projects, today), [paybacks, projects, today]);
  // 따로 적는 건의 코드는 저절로 (codes.ts) — 다른 건 · 프로젝트 · 원장에 있는 코드는 피한다
  const codeTaken = useMemo(
    () => takenCodes((paybacks ?? []).map((p) => p.projectCode), projects.map((p) => p.code), transactions.map((t) => t.projectCode)),
    [paybacks, projects, transactions],
  );
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return allRows
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => !s || [r.vendor, r.label, r.projectName ?? "", r.projectCode ?? "", r.note ?? ""].join(" ").toLowerCase().includes(s));
  }, [allRows, statusFilter, q]);
  const totals = useMemo(() => paybackTotals(allRows, today), [allRows, today]);

  const statusTabs = useMemo(() => {
    const n = (st: PaybackStatus) => allRows.filter((r) => r.status === st).length;
    return [
      { key: "all", label: "전체", hint: won(allRows.length) },
      ...(["open", "late", "paid"] as PaybackStatus[])
        .filter((st) => n(st) > 0)
        .map((st) => ({ key: st, label: PAYBACK_STATUS_LABEL[st], hint: won(n(st)) })),
    ];
  }, [allRows]);

  if (loading || (paybacks === null && !loadError)) return <LoadingState />;

  const afterSave = async (text: string) => {
    setEditing(null);
    await Promise.all([reload(), refresh()]);
    toast.success(text);
  };

  return (
    <PageShell width="wide">
      <PageHeader
        title="돌려줄 돈"
        description="받은 돈에서 부가세와 우리 몫을 떼고 거래처에 돌려줄 돈입니다. 프로젝트의 「매출 차감」 과 따로 적은 건을 한곳에서 봅니다."
        className="mb-4"
        actions={
          <Button icon={Plus} onClick={() => setEditing({ kind: "new" })}>
            돌려줄 돈
          </Button>
        }
      />

      {loadError && (
        <InlineNotice tone="danger" className="mb-4">
          따로 적은 건을 읽지 못했습니다 — {loadError}. 프로젝트 차감만 보입니다.
        </InlineNotice>
      )}

      {allRows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="돌려줄 돈이 없습니다"
          description="「+ 돌려줄 돈」 으로 거래처 · 받은 돈 · 우리 몫을 적으면 돌려줄 돈이 계산됩니다. 계약에 묶인 돈이면 프로젝트를 고르세요."
          action={
            <Button icon={Plus} onClick={() => setEditing({ kind: "new" })}>
              돌려줄 돈
            </Button>
          }
        />
      ) : (
        <>
          <Tabs className="mb-3" ariaLabel="돌려줄 돈 상태" value={statusFilter} onChange={(k) => setStatusFilter(k as PaybackStatus | "all")} items={statusTabs} />
          <FilterBar className="mb-4">
            <FilterField label="검색" htmlFor="payback-q">
              <SearchInput
                id="payback-q"
                className="w-64"
                value={q}
                onValueChange={setQ}
                placeholder="거래처 · 무엇 · 프로젝트"
                ariaLabel="돌려줄 돈 검색"
              />
            </FilterField>
          </FilterBar>

          <KpiStrip columns={4} className="mb-4">
            <StatTile
              label="남은 돈"
              value={totals.open}
              flow="expense"
              tone={totals.late > 0 ? "danger" : undefined}
              hint={
                totals.late > 0
                  ? `늦음 ${totals.lateCount}건 · ${won(totals.late)}원 포함`
                  : `${totals.openCount}건${totals.undated > 0 ? ` · 날짜 미정 ${won(totals.undated)}원` : ""}`
              }
            />
            <StatTile label="이번 달 돌려줄 돈" value={totals.thisMonth} flow="expense" hint={`${today.slice(0, 7)} 예정 · 안 돌려준 것만`} />
            <StatTile label="다음 달 돌려줄 돈" value={totals.nextMonth} flow="expense" hint="예정일 기준" />
            <StatTile label="올해 돌려준 돈" value={totals.paidThisYear} hint={`${totals.paidThisYearCount}건`} />
          </KpiStrip>

          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="돌려줄 돈 목록"
                hint={`${won(rows.length)}건`}
                action={<TableNote>단위: 원 · 받은 돈은 부가세 포함 · 프로젝트 행은 그 프로젝트의 매출 차감</TableNote>}
              />
            </div>
            {rows.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState
                  compact
                  icon={SearchX}
                  title="조건에 맞는 건이 없습니다"
                  description="상태 탭을 「전체」 로 되돌리거나 검색어를 지워 보세요."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setStatusFilter("all");
                        setQ("");
                      }}
                    >
                      조건 지우기
                    </Button>
                  }
                />
              </div>
            ) : (
              <TableScroll>
                <Table minWidth={1180}>
                  <thead>
                    <tr>
                      <Th sticky="left" className="pl-5">거래처</Th>
                      <Th>무엇</Th>
                      <Th>프로젝트</Th>
                      <Th align="right" title="부가세 포함">받은 돈</Th>
                      <Th align="right">부가세</Th>
                      <Th align="right" title="공급가액 중 회사에 남는 돈">우리 몫</Th>
                      <Th align="right">돌려줄 돈</Th>
                      <Th>예정일</Th>
                      <Th>돌려준 날</Th>
                      <Th className="pr-5">상태</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Tr
                        key={r.key}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a")) return;
                          setEditing({ kind: "row", row: r });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setEditing({ kind: "row", row: r });
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`${r.vendor} ${r.label} 고치기`}
                        className="cursor-pointer focus:bg-nd-accent-soft/60 focus:outline-none"
                      >
                        <Td sticky="left" className="pl-5">
                          <span className="block max-w-[14rem] truncate font-medium text-nd-fg" title={r.vendor}>
                            {r.vendor}
                          </span>
                          {(r.entity || r.method) && (
                            <span className="text-nd-caption text-nd-fg-3">{[r.entity, r.method].filter(Boolean).join(" · ")}</span>
                          )}
                        </Td>
                        <Td className="max-w-[16rem]">
                          <span className="block truncate" title={r.note ? `${r.label} — ${r.note}` : r.label}>
                            {r.label || <span className="text-nd-fg-4">—</span>}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">
                          {r.projectId ? (
                            <Link
                              href={`/neander/finance/projects/${r.projectId}#revenue`}
                              className="block max-w-[14rem] truncate text-nd-fg-2 hover:text-nd-accent-strong"
                              title={r.projectName}
                            >
                              <span className="font-mono text-nd-caption">{r.projectCode}</span> {r.projectName}
                            </Link>
                          ) : r.projectCode ? (
                            <span className="font-mono text-nd-caption text-nd-fg-3">{r.projectCode}</span>
                          ) : (
                            <span className="text-nd-fg-4">따로 적음</span>
                          )}
                        </Td>
                        <Td num><Money value={r.received} unit={false} muted /></Td>
                        <Td num><Money value={r.vat} unit={false} muted /></Td>
                        <Td num title={r.sharedKeep ? "이 프로젝트의 차감을 모두 뺀 값" : undefined}>
                          <Money value={r.keep} unit={false} />
                        </Td>
                        <Td num className="font-medium">
                          <Money value={r.amount} unit={false} flow="expense" />
                        </Td>
                        <Td className="whitespace-nowrap text-nd-table text-nd-fg-2">
                          {r.dueText || <span className="text-nd-fg-4">—</span>}
                        </Td>
                        <Td className="whitespace-nowrap text-nd-table text-nd-fg-2">
                          {r.paidDate ?? <span className="text-nd-fg-4">—</span>}
                        </Td>
                        <Td className="pr-5">
                          <Badge tone={STATUS_TONE[r.status]} dot>
                            {PAYBACK_STATUS_LABEL[r.status]}
                          </Badge>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </>
      )}

      {editing?.kind === "new" && (
        <NewPaybackDialog
          projects={projects}
          taken={codeTaken}
          onCancel={() => setEditing(null)}
          onSaved={afterSave}
        />
      )}
      {editing?.kind === "row" && editing.row.source === "standalone" && editing.row.doc && (
        <StandaloneDialog doc={editing.row.doc} taken={codeTaken} onCancel={() => setEditing(null)} onSaved={afterSave} />
      )}
      {editing?.kind === "row" && editing.row.source === "project" && (() => {
        const p = projects.find((x) => x.id === editing.row.projectId);
        const d = p?.deductions?.find((x) => x.id === editing.row.deductionId);
        return p && d ? <ProjectDeductionDialog project={p} deduction={d} onCancel={() => setEditing(null)} onSaved={afterSave} /> : null;
      })()}
    </PageShell>
  );
}

// ---- 프로젝트 차감 저장 ---------------------------------------------

/**
 * 프로젝트 문서의 차감 한 줄을 바꾸거나 더한다. 문서를 sanitizeProject 로 정리한
 * 값(서버가 저장하는 정본과 같은 모양)에 그 줄만 끼워 통째로 저장한다 —
 * 칸을 손으로 골라 옮기면 빠뜨린 칸이 저장 때 사라진다.
 */
async function saveProjectDeduction(p: FinProjectDoc, next: FinProjectDeduction) {
  const base = sanitizeProject(p);
  if (!base.ok) throw new Error(base.error);
  const list = base.value.deductions ?? [];
  const deductions = list.some((d) => d.id === next.id)
    ? list.map((d) => (d.id === next.id ? next : d))
    : [...list, next];
  await saveFinProject({ ...base.value, deductions }, p.id);
}

// ---- 새로 적기 ------------------------------------------------------

function NewPaybackDialog({
  projects,
  taken,
  onCancel,
  onSaved,
}: {
  projects: FinProjectDoc[];
  taken: Set<string>;
  onCancel: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState("");
  const live = useMemo(
    () => projects.filter((p) => p.status !== "cancelled").sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [projects],
  );
  const project = live.find((p) => p.id === projectId) ?? null;

  return project ? (
    <ProjectDeductionDialog
      project={project}
      deduction={null}
      onCancel={onCancel}
      onSaved={onSaved}
      picker={<ProjectPicker projects={live} value={projectId} onChange={setProjectId} />}
    />
  ) : (
    <StandaloneDialog
      doc={null}
      taken={taken}
      onCancel={onCancel}
      onSaved={onSaved}
      picker={<ProjectPicker projects={live} value={projectId} onChange={setProjectId} />}
    />
  );
}

function ProjectPicker({ projects, value, onChange }: { projects: FinProjectDoc[]; value: string; onChange: (id: string) => void }) {
  return (
    <Field label="프로젝트" hint="계약에 묶인 돈이면 고르세요 — 그 프로젝트의 매출 차감으로 들어가 이익에도 반영됩니다">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">고르지 않음 — 따로 적기</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{`${p.name} (${p.code})`}</option>
        ))}
      </Select>
    </Field>
  );
}

// ---- 프로젝트 차감 ----------------------------------------------------

function ProjectDeductionDialog({
  project,
  deduction,
  onCancel,
  onSaved,
  picker,
}: {
  project: FinProjectDoc;
  /** null 이면 새 줄 */
  deduction: FinProjectDeduction | null;
  onCancel: () => void;
  onSaved: (text: string) => Promise<void>;
  picker?: ReactNode;
}) {
  const g = projectGross(project);
  const taxMode = deduction?.taxMode ?? "none";
  const others = (project.deductions ?? []).filter((d) => d.id !== deduction?.id);
  // 지금 이 줄을 뺀 우리 몫 — 새 줄이면 지금의 차감 후 공급가액에서 시작한다
  const [label, setLabel] = useState(deduction?.label ?? "매출 환급");
  const [keep, setKeep] = useState<number>(g.keep);
  const computed = deductionAmountForKeep(project, keep, deduction?.id ?? null, taxMode);
  // 저장된 금액이 계산과 다르면(직접 적은 값) 그 값을 지킨다
  const [amount, setAmount] = useState<number | null>(deduction && deduction.amount !== computed ? deduction.amount : null);
  const [paidDate, setPaidDate] = useState(deduction?.paidDate ?? "");
  const [returned, setReturned] = useState(Boolean(deduction?.returned));
  const [due, setDue] = useState<DueValue>({ dueDate: deduction?.dueDate, dueApprox: deduction?.dueApprox });
  const [method, setMethod] = useState(deduction?.method ?? "");
  const [entity, setEntity] = useState<ProjectEntity | undefined>(deduction?.entity);
  const [note, setNote] = useState(deduction?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalAmount = amount ?? computed;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveProjectDeduction(project, {
        id: deduction?.id ?? shortId(),
        label: label.trim(),
        amount: Math.abs(Math.round(finalAmount)),
        taxMode,
        entity,
        method: method.trim() || undefined,
        dueDate: due.dueDate,
        dueApprox: due.dueApprox,
        paidDate: paidDate || undefined,
        returned: returned && !paidDate ? true : undefined,
        note: note.trim() || undefined,
      });
      await onSaved(`${project.name} — 돌려줄 돈 ${won(finalAmount)}원을 ${deduction ? "고쳤습니다" : "매출 차감으로 넣었습니다"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      closeOnOverlay={false}
      size="xl"
      title={deduction ? `${project.client ?? project.name} — 돌려줄 돈` : "돌려줄 돈"}
      description={
        <>
          <Link href={`/neander/finance/projects/${project.id}#revenue`} className="text-nd-accent-strong hover:underline">
            {project.name}
          </Link>
          의 받은 돈과 반환 내역을 확인합니다.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>취소</Button>
          <Button onClick={submit} loading={saving} disabled={finalAmount <= 0}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PaybackSection step={1} title="기본정보" description="누구와 어떤 내용으로 정산하는지 적습니다.">
          {picker}
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <FieldBox label="거래처">
              <span className="text-nd-body text-nd-fg">{project.client || project.name}</span>
            </FieldBox>
            <FieldBox label="프로젝트 코드">
              <AutoCodeBox code={project.code} tag="프로젝트" />
            </FieldBox>
          </FormRow>
          <Field label="내용">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="매출 환급 · 개발비 정산" />
          </Field>
          <Field label="메모">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="정산할 때 함께 확인할 내용" className="!min-h-0" />
          </Field>
        </PaybackSection>

        <PaybackSection step={2} title="받은 돈의 기록" description="실제 받은 금액과 앞으로 받을 회차를 구분해서 봅니다.">
          <ProjectReceiptRecords project={project} />
        </PaybackSection>

        <PaybackSection step={3} title="나간·나갈 돈의 기록" description="반환할 금액과 예정일, 실제 지급 내역을 적습니다.">
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="우리 몫" hint="공급가액 중 회사에 남길 돈">
              <NumberInput value={keep || ""} onValueChange={(v) => setKeep(Number(v) || 0)} className="text-right" placeholder="0" />
            </Field>
            <Field
              label="돌려줄 돈"
              hint={amount !== null && amount !== computed ? `직접 적은 금액 — 계산값은 ${won(computed)}` : "우리 몫을 적으면 계산됩니다"}
            >
              <NumberInput
                value={finalAmount || ""}
                onValueChange={(v) => setAmount(v === "" ? null : Number(v) || 0)}
                className="text-right"
                placeholder="0"
              />
            </Field>
          </FormRow>
          {taxMode === "none" ? (
            <CalcLine total={g.total} vat={g.vat} keep={keep} amount={amount ?? computed} totalLabel="청구 금액" />
          ) : (
            <InlineNotice tone="info">
              이 줄은 「{DEDUCTION_TAX_LABEL[taxMode]}」 — 돌려준 돈 안에 부가세가 들어 있어, 우리 몫을 맞추려면 공급가액 몫에 부가세를 더해 돌려줍니다.
            </InlineNotice>
          )}
          {others.length > 0 && (
            <TableNote>
              이 프로젝트에 다른 차감 {others.length}건({won(others.reduce((s, d) => s + d.amount, 0))}원)이 더 있습니다 — 우리 몫은 그것까지 뺀 값입니다.
            </TableNote>
          )}
          {finalAmount <= 0 && <InlineNotice tone="danger">우리 몫이 공급가액보다 크거나 같습니다 — 돌려줄 돈이 없습니다.</InlineNotice>}
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <FieldBox label="나갈 예정일" hint="모르면 「10월 말」처럼 대략으로">
              <DueInput label="나갈 예정일" value={due} onChange={setDue} />
            </FieldBox>
            <Field label="실제로 나간 날" hint="지급했으면 날짜를 적습니다">
              <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </Field>
          </FormRow>
          {!paidDate && (
            <Checkbox checked={returned} onChange={(e) => setReturned(e.target.checked)} label="이미 지급했지만 날짜는 모름" />
          )}
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="돈이 나가는 사업체">
              <Select value={entity ?? ""} onChange={(e) => setEntity((e.target.value || undefined) as ProjectEntity | undefined)}>
                <option value="">—</option>
                {PROJECT_ENTITIES.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </Select>
            </Field>
            <Field label="출금 통장·방법">
              <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="통장 뒷자리 · 계좌이체 · 현금" />
            </Field>
          </FormRow>
          <div className="flex items-center justify-between gap-3 rounded-nd-md bg-nd-sunken px-3 py-2.5">
            <span className="text-nd-table text-nd-fg-2">현재 상태</span>
            <Badge tone={paidDate || returned ? "success" : "warning"}>{paidDate || returned ? "반환 완료" : "반환 예정"}</Badge>
          </div>
        </PaybackSection>
      </div>
      {error && (
        <InlineNotice tone="danger" className="mt-3">
          {error}
        </InlineNotice>
      )}
    </Dialog>
  );
}

// ---- 따로 적은 건 -----------------------------------------------------

function StandaloneDialog({
  doc,
  taken,
  onCancel,
  onSaved,
  picker,
}: {
  /** null 이면 새 건 */
  doc: FinPaybackDoc | null;
  /** 쓰고 있는 코드 — 새 코드를 붙일 때 피한다 */
  taken: Set<string>;
  onCancel: () => void;
  onSaved: (text: string) => Promise<void>;
  picker?: ReactNode;
}) {
  const { transactions } = useFinance();
  const confirm = useConfirm();
  const [form, setForm] = useState<FinPaybackInput>(() => {
    if (!doc) return emptyPayback();
    const rest: Partial<FinPaybackDoc> = { ...doc };
    delete rest.id;
    delete rest.createdAt;
    delete rest.updatedAt;
    delete rest.updatedBy;
    return rest as FinPaybackInput;
  });
  const calc = paybackCalc(form.received, form.vatMode, form.keep);
  // 돌려줄 돈을 손으로 고쳤는가 — 처음 열 때 저장값이 계산과 다르면 고친 것이다
  const [manual, setManual] = useState(() => !!doc && doc.amount !== calc.amount);
  const amount = manual ? form.amount : calc.amount;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FinPaybackInput>(k: K, v: FinPaybackInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const candidates = useMemo(
    () => (form.vendor.trim() || amount ? txCandidates({ ...form, amount }, transactions) : []),
    [form, amount, transactions],
  );
  const toggleTx = (txId: string, date: string, txAmount: number, on: boolean) =>
    setForm((f) => {
      const ids = new Set(f.txIds ?? []);
      if (on) ids.add(txId);
      else ids.delete(txId);
      const next = { ...f, txIds: ids.size > 0 ? [...ids] : undefined };
      // 처음 붙인 거래의 날짜 · 금액을 돌려준 날 · 돌려준 돈으로 — 이미 적어 둔 값은 두고
      if (on && !f.paidDate) next.paidDate = date;
      if (on && f.paidAmount === undefined && txAmount !== amount) next.paidAmount = txAmount;
      return next;
    });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      // 코드가 없으면(새 건) 저절로 붙인다 — 겹치면 다음 번호로 다시 보낸다
      if (form.projectCode) await savePayback({ ...form, amount }, doc?.id);
      else await saveWithAutoCode("payback", taken, undefined, (code) => savePayback({ ...form, amount, projectCode: code }, doc?.id));
      await onSaved(`${form.vendor} — 돌려줄 돈 ${won(amount)}원을 ${doc ? "고쳤습니다" : "적었습니다"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!doc) return;
    const ok = await confirm({
      title: `「${doc.vendor}」 돌려줄 돈을 지울까요?`,
      message: "이 기록만 사라집니다. 원장 거래는 그대로 남습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deletePayback(doc.id);
      await onSaved(`${doc.vendor} 기록을 지웠습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우지 못했습니다.");
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      closeOnOverlay={false}
      size="xl"
      title={doc ? `${doc.vendor} — 돌려줄 돈` : "돌려줄 돈"}
      description="기본정보, 받은 돈, 나간·나갈 돈을 순서대로 기록합니다."
      footer={
        <>
          {doc && (
            <Button variant="ghost" icon={Trash2} onClick={remove} disabled={saving} className="mr-auto text-nd-danger-text">
              삭제
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={saving}>취소</Button>
          <Button onClick={submit} loading={saving} disabled={!form.vendor.trim()}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PaybackSection step={1} title="기본정보" description="누구와 어떤 내용으로 정산하는지 적습니다.">
          {picker}
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="거래처" required>
              <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="돌려받을 거래처" autoFocus={!picker} />
            </Field>
            <Field label="내용">
              <Input value={form.label ?? ""} onChange={(e) => set("label", e.target.value || undefined)} placeholder="무엇을 돌려주나" />
            </Field>
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <FieldBox label="관리 코드" hint={form.projectCode ? "이 기록을 찾는 번호입니다" : "저장할 때 자동으로 정해집니다"}>
              {form.projectCode ? <AutoCodeBox code={form.projectCode} tag="고정" /> : <AutoCodeBox code={nextCode("payback", taken)} />}
            </FieldBox>
            <Field label="메모">
              <Textarea rows={2} value={form.note ?? ""} onChange={(e) => set("note", e.target.value || undefined)} className="!min-h-0" placeholder="정산할 때 함께 확인할 내용" />
            </Field>
          </FormRow>
        </PaybackSection>

        <PaybackSection step={2} title="받은 돈의 기록" description="받은 금액과 돈을 받은 사업체를 기록합니다.">
          <FormRow className="grid-cols-1 sm:grid-cols-3">
            <Field label="받은 금액">
              <NumberInput value={form.received || ""} onValueChange={(v) => set("received", Number(v) || 0)} className="text-right" placeholder="0" />
            </Field>
            <Field label="부가세 기준">
              <Select value={form.vatMode} onChange={(e) => set("vatMode", e.target.value as VatMode)}>
                {VAT_MODES.map((m) => (
                  <option key={m} value={m}>{VAT_LABEL[m]}</option>
                ))}
              </Select>
            </Field>
            <Field label="돈을 받은 사업체">
              <Select value={form.entity ?? ""} onChange={(e) => set("entity", (e.target.value || undefined) as ProjectEntity | undefined)}>
                <option value="">—</option>
                {PROJECT_ENTITIES.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </Select>
            </Field>
          </FormRow>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-nd-table text-nd-fg-2">
            <span>부가세 <b className="nd-num font-medium text-nd-fg">{won(calc.vat)}원</b></span>
            <span>공급가액 <b className="nd-num font-medium text-nd-fg">{won(calc.supply)}원</b></span>
          </div>
        </PaybackSection>

        <PaybackSection step={3} title="나간·나갈 돈의 기록" description="반환할 금액과 예정일, 실제 지급 내역을 적습니다.">
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="우리 몫" hint="공급가액 중 회사에 남길 돈">
              <NumberInput value={form.keep || ""} onValueChange={(v) => set("keep", Number(v) || 0)} className="text-right" placeholder="0" />
            </Field>
            <Field label="돌려줄 돈" hint={manual ? `직접 적은 금액 — 계산값은 ${won(calc.amount)}` : "계산값"}>
              <NumberInput
                value={amount || ""}
                onValueChange={(v) => {
                  if (v === "") {
                    setManual(false);
                    return;
                  }
                  setManual(true);
                  set("amount", Number(v) || 0);
                }}
                className="text-right"
                placeholder="0"
              />
            </Field>
          </FormRow>
          <CalcLine total={calc.total} vat={calc.vat} keep={form.keep} amount={amount} />
          {amount < 0 && <InlineNotice tone="danger">우리 몫이 공급가액보다 큽니다 — 금액을 확인하세요.</InlineNotice>}

          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <FieldBox label="나갈 예정일" hint="모르면 「10월 말」처럼 대략으로">
              <DueInput
                label="나갈 예정일"
                value={{ dueDate: form.dueDate, dueApprox: form.dueApprox }}
                onChange={(v) => setForm((f) => ({ ...f, dueDate: v.dueDate, dueApprox: v.dueApprox }))}
              />
            </FieldBox>
            <Field label="실제로 나간 날" hint="지급했으면 날짜를 적습니다">
              <Input type="date" value={form.paidDate ?? ""} onChange={(e) => set("paidDate", e.target.value || undefined)} />
            </Field>
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="실제로 나간 금액" hint="예정 금액과 다를 때만 적습니다">
              <NumberInput
                value={form.paidAmount ?? ""}
                onValueChange={(v) => set("paidAmount", v === "" ? undefined : Number(v) || 0)}
                className="text-right"
                placeholder={won(amount)}
              />
            </Field>
            <Field label="출금 통장·방법">
              <Input value={form.method ?? ""} onChange={(e) => set("method", e.target.value || undefined)} placeholder="통장 뒷자리 · 계좌이체 · 현금" />
            </Field>
          </FormRow>
          <div className="flex items-center justify-between gap-3 rounded-nd-md bg-nd-sunken px-3 py-2.5">
            <span className="text-nd-table text-nd-fg-2">현재 상태</span>
            <Badge tone={form.paidDate ? "success" : "warning"}>{form.paidDate ? "반환 완료" : "반환 예정"}</Badge>
          </div>

          {/* 장부에서 돌려준 거래 — 붙이면 돌려준 날 · 돈이 그 거래 것으로 채워진다 */}
          <Disclosure
            title="원장에서 나간 거래 연결"
            description="거래를 고르면 지급 날짜와 금액을 채웁니다"
            meta={(form.txIds?.length ?? 0) > 0 ? `${form.txIds!.length}건 연결` : "선택사항"}
            defaultOpen={(doc?.txIds?.length ?? 0) > 0}
            className="border border-nd-line"
            bodyClassName="!p-3"
          >
            {candidates.length === 0 ? (
              <p className="text-nd-table text-nd-fg-3">
                금액이 같거나 거래처 이름이 겹치는 나간 돈이 없습니다. 거래처 · 돌려줄 돈을 적으면 후보가 나옵니다.
              </p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-nd-md border border-nd-line p-2">
                {candidates.map(({ tx, sameAmount, sameVendor }) => {
                  const on = (form.txIds ?? []).includes(tx.id);
                  const n = Math.abs(netAmount(tx));
                  return (
                    <li key={tx.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1 text-nd-table hover:bg-nd-fg/[.04]">
                        <Checkbox checked={on} onChange={(e) => toggleTx(tx.id, tx.date, n, e.target.checked)} />
                        <span className="nd-num w-[5.5rem] shrink-0 text-nd-fg-2">{tx.date}</span>
                        <span className="min-w-0 flex-1 truncate" title={[tx.vendor, tx.note].filter(Boolean).join(" · ")}>
                          {tx.vendor || "—"}
                          <span className="ml-1.5 text-nd-caption text-nd-fg-3">
                            {[tx.last4, tx.acctMinor].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="nd-num shrink-0 font-medium">{won(n)}</span>
                        <span className="hidden w-[6.5rem] shrink-0 text-right text-nd-caption text-nd-fg-3 sm:inline">
                          {[sameAmount && "금액 같음", sameVendor && "거래처"].filter(Boolean).join(" · ")}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Disclosure>
        </PaybackSection>
      </div>
      {error && (
        <InlineNotice tone="danger" className="mt-3">
          {error}
        </InlineNotice>
      )}
    </Dialog>
  );
}
