"use client";

// ============================================================
//  리포트 › 런웨이 — 달마다 얼마가 들어오고 나가서, 언제 현금이 바닥나나
// ------------------------------------------------------------
//  계산은 lib/neander/finance/runway.ts 한 곳에 있다. 이 화면은 답만 크게 보이고,
//  그 답을 만든 값(가정 · 받을 돈 · 시작 잔액)은 접어 둔다.
//
//    답          바닥나는 날 · 가장 낮을 때 · 시작 잔액이 언제 것인가
//    달마다      들어올 돈 · 나갈 돈 · 말일 현금 · 그 달 가장 낮을 때 — 누르면 무엇이 얼마
//    가정        평균 한 줄을 어느 달부터 바꾸기 · 돈 한 덩이를 그 날에 더하기
//    받을 돈     프로젝트 회차 — 받을 날은 프로젝트에 저장된다(정본은 하나)
//    시작 잔액   통장마다 언제까지 아는가 · 오늘 잔액을 날짜와 함께 적기
//
//  가정은 팀이 함께 쓰는 문서 하나라 초안 → 「가정 저장」 이다.
//  예전의 「13주 자금」 탭과 「줄여 보기」 는 이 화면 하나로 합쳤다(2026-10-24).
// ============================================================

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calculator, ChevronDown, ChevronRight, ExternalLink, Hourglass, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Disclosure,
  DisclosureGroup,
  EmptyState,
  ErrorState,
  Field,
  FieldAction,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  Money,
  NumberInput,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { fetchRunwaySettings, saveRunwaySettings, setFinProjectDue } from "@/lib/neander/finance/client";
import { approxDueDate, DUE_PART_LABEL, DUE_PARTS, dueLabel, partOfDate, type DuePart } from "@/lib/neander/finance/project";
import { dueMonthText } from "@/components/neander/finance/DueInput";
import {
  buildRunway,
  DEFAULT_RUNWAY,
  defaultAsOf,
  newItem,
  runwayPayload,
  type InflowStatus,
  type ProjectInflow,
  type RunwayMonth,
  type RunwaySettings,
} from "@/lib/neander/finance/runway";
import { monthLabel, shortWon, todayStrKST } from "@/lib/neander/format";

const shortMonth = (m: string) => `${m.slice(2, 4)}.${Number(m.slice(5))}`;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** `2026-11-01` → 「11월 1일 (일)」 */
const dayText = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 (${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const fullDayText = (d: string) => `${d.slice(0, 4)}년 ${dayText(d)}`;

const INFLOW_LABEL: Record<InflowStatus, string> = { scheduled: "예정", overdue: "연체", undated: "날짜 미정" };
const INFLOW_TONE: Record<InflowStatus, Tone> = { scheduled: "info", overdue: "danger", undated: "neutral" };

/**
 * 받을 시기를 「10월 말」 처럼 바로 적는다 — 프로젝트의 그 회차에 저장된다(정본은 프로젝트).
 * 회차가 없는 계약이면 서버가 계약금액 전부를 「잔금」 회차로 만든다.
 */
function DueQuickPick({ inflow, months, onSaved }: { inflow: ProjectInflow; months: string[]; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(inflow.status === "undated");
  const current = inflow.dueDate?.slice(0, 7);
  const [month, setMonth] = useState(current ?? months[0]);
  const [part, setPart] = useState<DuePart>(inflow.dueApprox ?? (inflow.dueDate ? partOfDate(inflow.dueDate) : "late"));
  const [busy, setBusy] = useState(false);
  const options = current && !months.includes(current) ? [current, ...months] : months;

  const save = async () => {
    setBusy(true);
    try {
      const res = await setFinProjectDue(inflow.projectId, {
        installmentId: inflow.id.startsWith("project:") ? undefined : inflow.id,
        dueDate: approxDueDate(month, part),
        dueApprox: part,
      });
      toast.success(
        `${inflow.projectName} — ${dueMonthText(month)} ${DUE_PART_LABEL[part]}에 받는 것으로 적었습니다${
          res.created ? " (계약금액 전부를 잔금 회차로 만들었습니다)" : ""
        }.`,
      );
      setOpen(false);
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "받을 시기를 적지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="ml-1.5 text-nd-table text-nd-accent hover:underline" onClick={() => setOpen(true)}>
        바꾸기
      </button>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <Select size="sm" className="w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={`${inflow.projectName} 받을 달`}>
        {options.map((m) => (
          <option key={m} value={m}>
            {dueMonthText(m)}
          </option>
        ))}
      </Select>
      <Select size="sm" className="w-auto" value={part} onChange={(e) => setPart(e.target.value as DuePart)} aria-label={`${inflow.projectName} 초·중·말`}>
        {DUE_PARTS.map((p) => (
          <option key={p} value={p}>
            {DUE_PART_LABEL[p]}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" loading={busy} onClick={save}>
        적기
      </Button>
      {inflow.status !== "undated" && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          취소
        </Button>
      )}
    </div>
  );
}

/** 한 달을 펼치면 — 무엇이 얼마 들어오고 나가는가 */
function MonthParts({ m }: { m: RunwayMonth }) {
  const ins = m.parts.filter((p) => p.flow === "in");
  const outs = m.parts.filter((p) => p.flow === "out");
  const list = (title: string, rows: typeof m.parts, flow: "income" | "expense") => (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-nd-table font-medium text-nd-fg-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-nd-table text-nd-fg-3">없음</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((p) => (
            <li key={p.key} className="flex items-baseline justify-between gap-3 text-nd-table">
              <span className="min-w-0 truncate">
                {p.label}
                {p.date && <span className="ml-1.5 text-nd-fg-3">{Number(p.date.slice(8))}일</span>}
                {p.overridden && <span className="ml-1.5 text-nd-fg-3">· 가정</span>}
              </span>
              <Money value={Math.round(p.amount)} unit={false} flow={flow} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-4 px-2 py-3 sm:flex-row sm:gap-8">
      {list("들어올 돈", ins, "income")}
      {list("나갈 돈", outs, "expense")}
    </div>
  );
}

export default function RunwayReport() {
  const { transactions, paymentMethods, projects, imports, loading, refresh } = useFinance();
  const toast = useToast();

  const [saved, setSaved] = useState<RunwaySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RunwaySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  // 재무 데이터가 뜬 뒤(= 로그인 확인 뒤)에 가정을 받는다
  useEffect(() => {
    if (loading || saved || loadError) return;
    fetchRunwaySettings()
      .then((s) => setSaved(s ?? DEFAULT_RUNWAY))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "가정을 불러오지 못했습니다."));
  }, [loading, saved, loadError]);

  const today = todayStrKST();
  const asOf = useMemo(() => defaultAsOf(transactions, today.slice(0, 7)), [transactions, today]);

  const base = saved ?? DEFAULT_RUNWAY;
  const settings = draft ?? base;
  const update = (fn: (s: RunwaySettings) => RunwaySettings) => setDraft((prev) => fn(prev ?? base));

  const dirty = useMemo(
    () => draft !== null && JSON.stringify(runwayPayload(draft)) !== JSON.stringify(runwayPayload(base)),
    [draft, base],
  );

  const r = useMemo(
    () => buildRunway({ transactions, paymentMethods, projects, settings, asOf, today, imports }),
    [transactions, paymentMethods, projects, settings, asOf, today, imports],
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await saveRunwaySettings(runwayPayload(draft));
      setSaved(next);
      setDraft(null);
      toast.success("런웨이 가정을 저장했습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || (!saved && !loadError)) return <LoadingState label="런웨이를 계산하는 중…" />;
  if (transactions.length === 0) {
    return (
      <PageShell>
        <PageHeader title="리포트" description="달마다 얼마가 들어오고 나가서, 언제 현금이 바닥나나" />
        <ReportTabs className="mb-6" />
        <EmptyState
          icon={Hourglass}
          title="아직 거래가 없습니다"
          description="엑셀 임포트에서 통장·카드 내역을 올리면 잔액과 최근 수입·지출로 런웨이를 계산합니다."
        />
      </PageShell>
    );
  }

  const o = r.outcome;
  const alt = r.outcomeAlt;
  const baseLabel = `${Number(r.baseMonths[0].slice(5))}~${Number(asOf.slice(5))}월`;
  const limiting = r.cash.filter((c) => c.limiting);
  const undated = r.inflows.filter((f) => f.status === "undated");
  const firstMonth = r.months[0];
  const lineByKey = new Map(r.lines.map((l) => [l.key, l]));
  // 바닥나는 날이 그 달 1일이면 — 급여·월세가 한꺼번에 나가는 날이다
  const zeroOnFirst = o.zeroDate?.endsWith("-01") ?? false;
  // 가정이 다 반영된 뒤의 한 달 — 내다본 마지막 달 (부가세 같은 덩이가 없는 달이면 그대로 매달의 모습이다)
  const lastRow = r.rows[r.rows.length - 1];

  // ---- 고치기 ----
  const setCash = (last4: string, raw: string) =>
    update((s) => {
      const cash = { ...s.cash };
      const cashDates = { ...s.cashDates };
      if (raw === "" || raw === "-") {
        delete cash[last4];
        delete cashDates[last4];
      } else {
        cash[last4] = Math.round(Number(raw));
        // 처음 적을 땐 오늘 본 숫자로 — 다른 날 잔액이면 옆 칸에서 고친다
        if (!cashDates[last4]) cashDates[last4] = today;
      }
      return { ...s, cash, cashDates };
    });

  const setCashDate = (last4: string, date: string) =>
    update((s) => {
      const cashDates = { ...s.cashDates };
      if (date) cashDates[last4] = date;
      else delete cashDates[last4];
      return { ...s, cashDates };
    });

  const toggleInflow = (id: string, include: boolean) =>
    update((s) => ({
      ...s,
      skipInflows: include ? s.skipInflows.filter((x) => x !== id) : [...new Set([...s.skipInflows, id])],
    }));

  return (
    <PageShell>
      <PageHeader
        title="리포트"
        description="달마다 얼마가 들어오고 나가서, 언제 현금이 바닥나나"
        className="mb-4"
        meta={
          dirty ? (
            <Badge tone="warning">
              <Icon icon={TriangleAlert} size={13} />
              저장 안 한 가정
            </Badge>
          ) : base.updatedAt ? (
            <span className="text-nd-table text-nd-fg-3">
              가정 저장 {new Date(base.updatedAt).toLocaleDateString("ko-KR")}
              {base.updatedBy ? ` · ${base.updatedBy.split("@")[0]}` : ""}
            </span>
          ) : undefined
        }
        actions={
          dirty ? (
            <>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
                변경 취소
              </Button>
              <Button size="sm" loading={saving} onClick={save}>
                가정 저장
              </Button>
            </>
          ) : undefined
        }
      />

      <ReportTabs className="mb-4" />

      {loadError && (
        <ErrorState
          className="mb-4"
          title="저장된 가정을 불러오지 못했습니다"
          description={`${loadError} — 아래 숫자는 기본 가정(최근 3개월 평균)으로 계산한 것입니다.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => setLoadError(null)}>
              다시 불러오기
            </Button>
          }
        />
      )}

      {/* ---- 답 ---- */}
      <Card className="mb-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-nd-body text-nd-fg-2">{o.zeroDate ? "현금이 바닥나는 날" : `${r.months.length}개월 안에는`}</div>
            <div className={cn("mt-1 text-nd-display", o.zeroDate ? "text-nd-danger-text" : "text-nd-success-text")}>
              {o.zeroDate ? fullDayText(o.zeroDate) : "바닥나지 않습니다"}
            </div>
            <div className="mt-1.5 text-nd-body text-nd-fg-2">
              {o.zeroDate ? (
                o.zeroDate === r.start ? (
                  "시작 잔액이 이미 0 아래입니다."
                ) : (
                  <>
                    그날 현금 <Money value={o.zeroClosing ?? 0} flow="net" /> · 시작 잔액({dayText(r.start)})에서 약 {(o.months ?? 0).toFixed(1)}개월
                    {zeroOnFirst && " · 급여·월세가 한꺼번에 나가는 날"}
                  </>
                )
              ) : (
                <>
                  가장 낮을 때 {fullDayText(o.lowestDate)} <Money value={o.lowest} flow="net" />
                </>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-nd-body sm:grid-cols-3">
            <div>
              <dt className="text-nd-table text-nd-fg-3">시작 잔액 · {dayText(r.start)}</dt>
              <dd>
                <Money value={r.openingCash} flow="net" className="font-semibold" />
              </dd>
            </div>
            <div title={`${monthLabel(lastRow.month)} — 가정이 다 반영된 뒤의 한 달 (B2B 새 일 없이)`}>
              <dt className="text-nd-table text-nd-fg-3">가정이 다 반영된 뒤 매달</dt>
              <dd>
                <Money value={lastRow.net} flow="net" className="font-semibold" />
              </dd>
            </div>
            <div title={`최근 ${r.baseMonths.length}개월 B2B 입금 평균 ${shortWon(r.b2bAvg)} 만큼 매달 새 일이 들어온다고 볼 때`}>
              <dt className="text-nd-table text-nd-fg-3">평소만큼 새 일을 따면</dt>
              <dd className="font-semibold">
                {alt.zeroDate ? `${dayText(alt.zeroDate)} 바닥` : `${r.months.length}개월 버팀`}
              </dd>
            </div>
          </dl>
        </div>

        {(limiting.length > 0 || undated.length > 0) && (
          <div className="mt-4 flex flex-col gap-2">
            {limiting.length > 0 && (
              <InlineNotice tone="warning" icon={TriangleAlert}>
                {limiting.map((c) => c.alias).join(" · ")} 통장은 {dayText(r.start)} 잔액까지만 알아서, 다른 통장도 그날 잔액에서 출발합니다.
                그 통장들의 최근 파일을 엑셀 임포트에 올리거나, 아래 「시작 잔액」 에 오늘 잔액을 적으면 오늘부터 계산합니다.
              </InlineNotice>
            )}
            {undated.length > 0 && (
              <InlineNotice tone="warning" icon={TriangleAlert}>
                받을 날이 없는 B2B 받을 돈 {undated.length}건 · {shortWon(undated.reduce((s, f) => s + f.amount, 0))}원은 넣지 못했습니다. 아래
                「받을 돈」 에서 「12월 말」 처럼 대략으로 적으면 들어갑니다.
              </InlineNotice>
            )}
          </div>
        )}
      </Card>

      {/* ---- 달마다 ---- */}
      <Card padding="none" className="mb-3 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="달마다"
            hint="줄을 누르면 무엇이 얼마 들어오고 나가는지 보입니다 · 「가장 낮을 때」 는 그 달 안에서 현금이 가장 적은 날"
            action={<TableNote>원 · 잡힌 돈만</TableNote>}
          />
        </div>
        <TableScroll>
          <Table dense minWidth={760}>
            <thead>
              <tr>
                <Th className="pl-5">달</Th>
                <Th align="right">들어올 돈</Th>
                <Th align="right">나갈 돈</Th>
                <Th align="right">남는 돈</Th>
                <Th align="right">말일 현금</Th>
                <Th align="right" className="pr-5">
                  가장 낮을 때
                </Th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((m) => {
                const isOpen = openMonth === m.month;
                const danger = m.low < 0;
                const partial = !m.from.endsWith("-01");
                return (
                  <Fragment key={m.month}>
                    <tr
                      className={cn("cursor-pointer border-b border-nd-line hover:bg-nd-sunken/60", danger && "bg-nd-danger-soft/40")}
                      onClick={() => setOpenMonth(isOpen ? null : m.month)}
                      aria-expanded={isOpen}
                    >
                      <Td className="whitespace-nowrap pl-5 font-medium">
                        <Icon icon={isOpen ? ChevronDown : ChevronRight} size={14} className="mr-1 inline text-nd-fg-3" />
                        {monthLabel(m.month)}
                        {partial && <span className="ml-1.5 font-normal text-nd-fg-3">{Number(m.from.slice(8))}일부터</span>}
                        {o.zeroMonth === m.month && (
                          <Badge tone="danger" size="sm" className="ml-2">
                            바닥
                          </Badge>
                        )}
                      </Td>
                      <Td num>
                        <Money value={Math.round(m.income)} unit={false} flow="income" />
                      </Td>
                      <Td num>
                        <Money value={Math.round(m.expense)} unit={false} flow="expense" />
                      </Td>
                      <Td num>
                        <Money value={Math.round(m.net)} unit={false} flow="net" />
                      </Td>
                      <Td num className="font-semibold">
                        <Money value={Math.round(m.closing)} unit={false} flow="net" />
                      </Td>
                      <Td num className="pr-5">
                        <Money value={Math.round(m.low)} unit={false} flow="net" />
                        <span className="ml-1.5 text-nd-table text-nd-fg-3">{Number(m.lowDate.slice(8))}일</span>
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-nd-line bg-nd-sunken/40">
                        <td colSpan={6} className="px-5">
                          <MonthParts m={m} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <DisclosureGroup className="mb-3">
        {/* ---- 가정 ---- */}
        <Disclosure
          title="가정"
          description="평균 한 줄을 어느 달부터 바꾸거나, 돈 한 덩이를 그 날에 더합니다 — 팀이 같이 보는 값"
          meta={<span className="text-nd-table text-nd-fg-3">바꾼 줄 {settings.overrides.length} · 더한 돈 {settings.items.length}</span>}
        >
          <div className="mb-4 flex justify-end">
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => update((s) => ({ ...s, items: [...s.items, newItem(firstMonth)] }))}>
              돈 더하기
            </Button>
          </div>

          {settings.overrides.length > 0 && (
            <div className="mb-5 flex flex-col gap-3">
              <h3 className="text-nd-table font-medium text-nd-fg-2">바꾼 줄 (평균 대신 이 금액)</h3>
              {settings.overrides.map((ov) => {
                const line = lineByKey.get(ov.lineKey);
                const patch = (p: Partial<typeof ov>) =>
                  update((s) => ({ ...s, overrides: s.overrides.map((x) => (x.id === ov.id ? { ...x, ...p } : x)) }));
                return (
                  <FormRow key={ov.id} className="grid-cols-2 sm:grid-cols-[minmax(9rem,1fr)_6.5rem_8.5rem_minmax(10rem,2fr)_auto]">
                    <Field label="줄" className="col-span-2 sm:col-span-1">
                      <Select size="sm" value={ov.lineKey} onChange={(e) => patch({ lineKey: e.target.value })}>
                        {!line && <option value={ov.lineKey}>{ov.lineKey} (지금 범위에 없음)</option>}
                        {r.lines.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.flow === "in" ? "수입" : "지출"} · {l.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="부터">
                      <Select size="sm" value={ov.from} onChange={(e) => patch({ from: e.target.value })}>
                        {!r.months.includes(ov.from) && <option value={ov.from}>{shortMonth(ov.from)}</option>}
                        {r.months.map((m) => (
                          <option key={m} value={m}>
                            {shortMonth(m)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={line ? `월 금액 · 평균 ${shortWon(line.avg)}` : "월 금액"}>
                      <NumberInput size="sm" value={ov.amount} onValueChange={(v) => patch({ amount: Math.abs(Number(v) || 0) })} className="text-right" />
                    </Field>
                    <Field label="근거">
                      <Input size="sm" value={ov.note ?? ""} placeholder="와우 폐점" onChange={(e) => patch({ note: e.target.value })} title={ov.note} />
                    </Field>
                    <FieldAction>
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        label="이 가정 지우기"
                        onClick={() => update((s) => ({ ...s, overrides: s.overrides.filter((x) => x.id !== ov.id) }))}
                      />
                    </FieldAction>
                  </FormRow>
                );
              })}
            </div>
          )}

          {settings.items.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-nd-table font-medium text-nd-fg-2">더한 돈</h3>
              {settings.items.map((it) => {
                const patch = (p: Partial<typeof it>) =>
                  update((s) => ({ ...s, items: s.items.map((x) => (x.id === it.id ? { ...x, ...p } : x)) }));
                return (
                  <FormRow key={it.id} className="grid-cols-2 sm:grid-cols-[minmax(9rem,1.4fr)_5.5rem_6.5rem_6.5rem_4.5rem_8.5rem_auto]">
                    <Field label="이름" className="col-span-2 sm:col-span-1">
                      <Input size="sm" value={it.label} placeholder="권리금" onChange={(e) => patch({ label: e.target.value })} title={it.note} />
                    </Field>
                    <Field label="방향">
                      <Select size="sm" value={it.flow} onChange={(e) => patch({ flow: e.target.value === "in" ? "in" : "out" })}>
                        <option value="in">들어옴</option>
                        <option value="out">나감</option>
                      </Select>
                    </Field>
                    <Field label="부터">
                      <Select
                        size="sm"
                        value={it.from}
                        onChange={(e) => {
                          const from = e.target.value;
                          // 한 번짜리였으면 끝 달도 같이 옮긴다
                          patch({ from, to: it.to === it.from ? from : it.to && it.to < from ? from : it.to });
                        }}
                      >
                        {!r.months.includes(it.from) && <option value={it.from}>{shortMonth(it.from)}</option>}
                        {r.months.map((m) => (
                          <option key={m} value={m}>
                            {shortMonth(m)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="까지">
                      <Select size="sm" value={it.to ?? ""} onChange={(e) => patch({ to: e.target.value || undefined })}>
                        <option value="">끝까지</option>
                        {it.to && !r.months.includes(it.to) && <option value={it.to}>{shortMonth(it.to)}</option>}
                        {r.months
                          .filter((m) => m >= it.from)
                          .map((m) => (
                            <option key={m} value={m}>
                              {m === it.from ? `${shortMonth(m)} (한 번)` : shortMonth(m)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="며칠">
                      <NumberInput
                        size="sm"
                        value={it.day ?? ""}
                        placeholder={it.flow === "out" ? "1" : "말일"}
                        onValueChange={(v) => {
                          const d = Math.round(Number(v));
                          patch({ day: d >= 1 && d <= 31 ? d : undefined });
                        }}
                        className="text-right"
                        aria-label={`${it.label || "더한 돈"} 며칠`}
                      />
                    </Field>
                    <Field label={it.to === it.from ? "금액" : "월 금액"}>
                      <NumberInput size="sm" value={it.amount} onValueChange={(v) => patch({ amount: Math.abs(Number(v) || 0) })} className="text-right" />
                    </Field>
                    <FieldAction>
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        label="이 가정 지우기"
                        onClick={() => update((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) }))}
                      />
                    </FieldAction>
                  </FormRow>
                );
              })}
            </div>
          )}

          {settings.overrides.length === 0 && settings.items.length === 0 && (
            <p className="text-nd-body text-nd-fg-3">아직 가정이 없습니다. 「돈 더하기」 → 11월 권리금 500만원 들어옴 처럼 적습니다.</p>
          )}

          <div className="mt-5 border-t border-nd-line pt-4">
            <h3 className="mb-2 text-nd-table font-medium text-nd-fg-2">평균 낸 값 ({baseLabel} · 월)</h3>
            <ul className="grid gap-x-8 gap-y-1 text-nd-table sm:grid-cols-2 xl:grid-cols-3">
              {r.lines
                .filter((l) => l.on)
                .map((l) => (
                  <li key={l.key} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">
                      {l.label}
                      {l.early >= 0.2 && <span className="ml-1.5 text-nd-fg-3">1일에 {Math.round(l.early * 100)}%</span>}
                    </span>
                    <Money value={l.avg} unit={false} flow={l.flow === "in" ? "income" : "expense"} />
                  </li>
                ))}
            </ul>
          </div>
        </Disclosure>

        {/* ---- 받을 돈 ---- */}
        <Disclosure
          title="받을 돈 (B2B 프로젝트)"
          description="받을 날은 프로젝트의 입금 회차에 저장됩니다 · 「10월 말」 처럼 대략도 됩니다"
          meta={
            <span className="text-nd-table text-nd-fg-3">
              {r.inflows.filter((f) => f.included).length}건 · {shortWon(r.inflows.filter((f) => f.included).reduce((s, f) => s + f.amount, 0))}원
            </span>
          }
        >
          {r.inflows.length === 0 ? (
            <p className="text-nd-body text-nd-fg-3">아직 받을 돈이 남은 프로젝트가 없습니다.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-nd-line">
              {r.inflows.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2">
                  <Checkbox
                    checked={f.included}
                    disabled={f.status === "undated"}
                    onChange={(e) => toggleInflow(f.id, e.target.checked)}
                    aria-label={`${f.projectName} ${f.kind} 넣기`}
                    title={f.status === "undated" ? "받을 날이 없어 넣을 날을 모릅니다" : "끄면 런웨이에서 뺍니다 (떼일 것 같은 돈)"}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/neander/finance/projects/${f.projectId}`}
                      className="inline-flex max-w-full items-center gap-1 truncate text-nd-body text-nd-fg hover:underline"
                    >
                      <span className="truncate">{f.projectName}</span>
                      <Icon icon={ExternalLink} size={12} className="shrink-0 text-nd-fg-3" />
                    </Link>
                    <div className="text-nd-table text-nd-fg-3">
                      {f.code} · {f.kind} · {f.dueDate ? `받을 날 ${dueLabel(f)}` : "언제쯤 들어올까요?"}
                      {f.dueDate && <DueQuickPick inflow={f} months={r.months} onSaved={refresh} />}
                    </div>
                    {!f.dueDate && <DueQuickPick inflow={f} months={r.months} onSaved={refresh} />}
                  </div>
                  <Badge tone={INFLOW_TONE[f.status]} size="sm">
                    {INFLOW_LABEL[f.status]}
                  </Badge>
                  <span className="w-28 shrink-0 text-right">
                    <Money value={f.amount} unit={false} flow={f.included ? "income" : undefined} muted={!f.included} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>

        {/* ---- 시작 잔액 ---- */}
        <Disclosure
          title="시작 잔액"
          description={`${fullDayText(r.start)} 잔액에서 출발 — 통장마다 장부가 언제까지 맞는지 보고, 모두 아는 가장 늦은 날을 씁니다`}
          meta={<Money value={r.openingCash} flow="net" className="text-nd-body font-semibold" />}
          defaultOpen={limiting.length > 0}
        >
          <TableScroll>
            <Table dense minWidth={820}>
              <thead>
                <tr>
                  <Th>통장</Th>
                  <Th align="right">장부 잔액</Th>
                  <Th>장부가 맞는 날</Th>
                  <Th align="right">직접 적기</Th>
                  <Th>그 잔액의 날</Th>
                  <Th align="right">쓴 값</Th>
                </tr>
              </thead>
              <tbody>
                {r.cash.map((c) => (
                  <tr key={c.last4} className={cn("border-b border-nd-line last:border-b-0", c.limiting && "bg-nd-warning-soft/40")}>
                    <Td>
                      {c.alias} <span className="text-nd-table text-nd-fg-3">{c.last4}</span>
                      {c.site && c.site !== "네안데르" && <span className="ml-1.5 text-nd-table text-nd-fg-3">· {c.site}</span>}
                    </Td>
                    <Td num>
                      {c.ledger === null ? (
                        <span className="text-nd-fg-3">잔액 없음</span>
                      ) : (
                        <>
                          <Money value={c.ledger} unit={false} muted={c.source !== "ledger"} />
                          <div className="text-nd-table text-nd-fg-3">{c.ledgerDate} 거래 뒤</div>
                        </>
                      )}
                    </Td>
                    <Td className={cn("whitespace-nowrap text-nd-table", c.limiting ? "font-medium text-nd-warning-text" : "text-nd-fg-2")}>
                      {c.knownThrough ? `${c.knownThrough}까지` : "–"}
                      {c.limiting && <div>이 통장 때문에 시작일이 앞당겨짐</div>}
                    </Td>
                    <Td num className="w-40">
                      <NumberInput
                        size="sm"
                        negative
                        value={c.manual ?? ""}
                        placeholder={c.ledger === null ? "0" : "장부 그대로"}
                        onValueChange={(v) => setCash(c.last4, v)}
                        className="text-right"
                        aria-label={`${c.alias} 잔액 직접 적기`}
                      />
                    </Td>
                    <Td className="w-44">
                      {c.manual !== null && (
                        <>
                          <Input
                            type="date"
                            size="sm"
                            value={c.manualDate ?? ""}
                            max={today}
                            onChange={(e) => setCashDate(c.last4, e.target.value)}
                            aria-label={`${c.alias} 잔액의 날`}
                          />
                          {!c.manualDate && <div className="mt-0.5 text-nd-table text-nd-warning-text">날짜가 없어 장부를 씁니다</div>}
                          {c.manualDate && c.source !== "manual" && (
                            <div className="mt-0.5 text-nd-table text-nd-fg-3">장부가 더 최근이라 안 씀</div>
                          )}
                        </>
                      )}
                    </Td>
                    <Td num>
                      <Money value={c.used} unit={false} />
                      <div className="text-nd-table text-nd-fg-3">{c.source === "manual" ? "적은 값" : c.source === "ledger" ? "장부" : "모름 → 0"}</div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Disclosure>

        {/* ---- 계산 방법 ---- */}
        <Disclosure icon={Calculator} title="계산 방법" description="숫자를 어디서 가져오는가">
          <dl className="flex flex-col gap-2.5 text-nd-table leading-relaxed">
            {[
              ["시작 잔액", "통장마다 장부가 언제까지 맞는지(그 달 파일을 올린 날, 그 달 말일까지) 또는 직접 적은 잔액의 날을 보고, 모든 통장을 아는 가장 늦은 날에서 출발합니다. 그날이 달 중간이면 그 달은 남은 날만 셉니다. 카드와 대출 계좌는 넣지 않습니다."],
              ["반복 수입·지출", `${baseLabel} 실적의 월평균입니다(발생주의 — 카드는 쓴 날). 개인사용은 빼고 환급은 차감합니다. 기타수입(지원금·환불수입 등)은 매달 반복되지 않아 뺍니다. 자금거래(계좌 간 이동·가수금·보증금)와 카드대금은 세지 않습니다.`],
              ["달 안의 날짜", "줄마다 최근 실적에서 월초(1~5일)에 나간 몫을 재서 1일에 놓고, 나머지는 그 달에 고르게 펼칩니다 — 급여·월세가 1일에 한꺼번에 나가는 것을 반영합니다. 「더한 돈」 은 적은 날에, 날을 안 적으면 나가는 돈은 1일 · 들어오는 돈은 말일에 둡니다."],
              ["B2B 받을 돈", "평균을 내지 않습니다. 프로젝트 입금 회차 중 아직 안 받은 것을 받을 날에 넣습니다(부가세 포함 청구액). 날짜가 지났으면 첫날에 넣고 「연체」 로 표시합니다."],
              ["평소만큼 새 일을 따면", `B2B 입금이 최근 평균(월 ${shortWon(r.b2bAvg)})보다 적은 달은 평균만큼 들어온다고 봅니다. 아직 따내지 않은 일까지 넣은 낙관선입니다.`],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <dt className="font-medium text-nd-fg-2">{k}</dt>
                <dd className="text-nd-fg-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      </DisclosureGroup>
    </PageShell>
  );
}
