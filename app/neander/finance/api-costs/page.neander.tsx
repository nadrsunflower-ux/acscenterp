"use client";

// ============================================================
//  API 비용 — 오픈라우터 키마다 쓴 돈을 어느 프로젝트에 썼는지 정한다
// ------------------------------------------------------------
//  정하는 방법은 두 겹이다 (lib/neander/finance/api-cost.ts 머리말).
//    · 키의 기본 — 표의 칸에서 고르면 바로 저장된다
//    · 시간 구간 — 키를 펼쳐 날 · 시간을 고르거나 시작 · 끝을 적는다. 겹치면 새로 정한 쪽이 이긴다
//  붙일 곳은 재무 프로젝트 · AI STUDIO 채널 · 공통.
//
//  재무 프로젝트에 붙인 돈은 「원가로 보내기」 를 눌러야 그 프로젝트의 지출 줄이 된다 —
//  누르기 전에는 프로젝트 이익이 바뀌지 않는다. 숫자는 서버가 다시 세어 쓴다.
//
//  금액은 달러가 정본이다 (오픈라우터와 맞춰 보기 쉽게) · 원화는 위쪽 환율로 어림.
//  하루는 한국 날짜 0시~24시 — 오픈라우터의 시간별 기록을 한국 날짜로 모았다.
//  EXACT_FROM 앞의 날은 시간별 기록이 없어 오전 9시에 끊긴 하루다 (「9시 기준」 표시).
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Cpu, RefreshCw, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  FieldAction,
  FormRow,
  IconButton,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
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
  Tr,
  cn,
  useToast,
} from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  addDays,
  API_COST_LINE_ID,
  API_TARGET_KIND_LABEL,
  COMMON_LABEL,
  costRows,
  dayLabel,
  EXACT_FROM,
  isManualApiLine,
  keyDay,
  krwOf,
  modelsLine,
  parseTargetKey,
  projectApiCost,
  rangeLabel,
  shortDate,
  spansFromSlots,
  sumByKey,
  sumByTarget,
  targetKey,
  usdText,
  type ApiCostRow,
  type ApiDayDoc,
  type ApiHourRow,
  type ApiKeyAlloc,
  type ApiKeyDay,
  type ApiKeySum,
  type ApiTarget,
  type ApiTargetSum,
} from "@/lib/neander/finance/api-cost";
import {
  deleteApiKeyRange,
  fetchApiCosts,
  pushApiCostToProject,
  saveApiCostRate,
  setApiKeyDefault,
  setApiKeyRange,
  setApiKeySpans,
  syncApiCosts,
  type ApiCostResponse,
} from "@/lib/neander/finance/api-cost-client";
import type { ApiCostView, ApiKeyMeta } from "@/lib/neander/finance/server/api-cost";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import { OWNER_GROUP_LABEL } from "@/lib/neander/shorts/ai-usage";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const errText = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류");

// ---- 붙일 곳 고르기 ---------------------------------------------------

interface TargetBook {
  active: FinProjectDoc[];
  done: FinProjectDoc[];
  spaces: ApiCostView["spaces"];
  /** 재무 데이터(거래 포함)를 처음 받는 중 — 프로젝트 목록이 아직 비어 있다 */
  loading: boolean;
  label: (t: ApiTarget | null) => string;
}

const projectOption = (p: FinProjectDoc) => `${p.name} · ${p.code}`;

function TargetSelect({
  book,
  value,
  onChange,
  none = "안 정함",
  disabled,
  className,
  ariaLabel,
  size = "sm",
}: {
  book: TargetBook;
  value: string;
  onChange: (key: string) => void;
  none?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  // 지운 프로젝트 · 보관한 채널을 가리키고 있어도 칸이 비어 보이지 않게
  const known =
    !value ||
    value === "common:" ||
    book.active.some((p) => `fin:${p.id}` === value) ||
    book.done.some((p) => `fin:${p.id}` === value) ||
    book.spaces.some((s) => `studio:${s.id}` === value);
  return (
    <Select size={size} value={value} disabled={disabled} aria-label={ariaLabel} className={className} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {!known && <option value={value}>{book.label(parseTargetKey(value))}</option>}
      <optgroup label="AI STUDIO 채널">
        {book.spaces
          .filter((s) => !s.archived || `studio:${s.id}` === value)
          .map((s) => (
            <option key={s.id} value={`studio:${s.id}`}>
              {s.name}
            </option>
          ))}
      </optgroup>
      <optgroup label="재무 프로젝트 · 진행 중">
        {book.loading && <option disabled>불러오는 중…</option>}
        {book.active.map((p) => (
          <option key={p.id} value={`fin:${p.id}`}>
            {projectOption(p)}
          </option>
        ))}
      </optgroup>
      <optgroup label="재무 프로젝트 · 끝남">
        {book.done.map((p) => (
          <option key={p.id} value={`fin:${p.id}`}>
            {projectOption(p)}
          </option>
        ))}
      </optgroup>
      <option value="common:">{COMMON_LABEL}</option>
    </Select>
  );
}

// ---- 키 펼친 칸 ------------------------------------------------------

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));

/** 날 줄이 대표하는 시간 칸 — 시간별 금액이 없는 날은 0시 칸 하나로 하루 전체를 대신한다 */
const daySlots = (kd: ApiKeyDay) => (kd.hours.length ? kd.hours.map((h) => h.slot) : [`${kd.date}T00`]);

type VisibleRow = { kind: "day"; kd: ApiKeyDay } | { kind: "hour"; kd: ApiKeyDay; h: ApiHourRow };
const rowSlots = (row: VisibleRow) => (row.kind === "day" ? daySlots(row.kd) : [row.h.slot]);

/** 붙은 곳 한 칸 — 이름 + 어떻게 정해졌는지 */
function Place({ target, via, book }: { target: ApiTarget | null; via: "range" | "default" | null; book: TargetBook }) {
  if (!target) {
    return (
      <Badge tone="warning" size="sm">
        안 정함
      </Badge>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className="min-w-0 truncate text-nd-fg">{book.label(target)}</span>
      <span className={cn("shrink-0 text-nd-table", via === "range" ? "font-medium text-nd-accent-strong" : "text-nd-fg-3")}>{via === "range" ? "구간" : "기본"}</span>
    </span>
  );
}

function KeyDetail({
  meta,
  days,
  alloc,
  book,
  year,
  onAlloc,
}: {
  meta: { hash: string; name: string };
  /** 이 기간의 날들 */
  days: ApiDayDoc[];
  alloc: ApiKeyAlloc | undefined;
  book: TargetBook;
  year: string;
  onAlloc: (a: ApiKeyAlloc) => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ from: "", fromHour: "00", to: "", toHour: "23", target: "", note: "" });

  const keyDays = useMemo(
    () =>
      days
        .flatMap((d) => {
          const k = d.keys.find((x) => x.hash === meta.hash);
          return k && k.usd > 0 ? [keyDay(d, k, alloc)] : [];
        })
        .sort((a, b) => b.date.localeCompare(a.date)),
    [days, meta.hash, alloc],
  );
  // 화면에 보이는 줄 — 날 줄 아래에 펼친 시간 줄 (Shift 범위 고르기가 이 순서를 따른다)
  const visible = useMemo<VisibleRow[]>(
    () =>
      keyDays.flatMap((kd) => [
        { kind: "day" as const, kd },
        ...(openDays.has(kd.date) ? kd.hours.map((h) => ({ kind: "hour" as const, kd, h })) : []),
      ]),
    [keyDays, openDays],
  );
  const spans = useMemo(() => {
    const used: Record<string, string[]> = {};
    for (const kd of keyDays) used[kd.date] = kd.hours.map((h) => h.hour);
    return spansFromSlots(selected, used);
  }, [selected, keyDays]);
  const pickedUsd = useMemo(
    () =>
      keyDays.reduce(
        (n, kd) => n + (kd.hours.length ? kd.hours.reduce((m, h) => m + (selected.has(h.slot) ? h.usd : 0), 0) : selected.has(`${kd.date}T00`) ? kd.usd : 0),
        0,
      ),
    [keyDays, selected],
  );
  const allSlots = keyDays.flatMap(daySlots);
  const allPicked = allSlots.length > 0 && allSlots.every((s) => selected.has(s));

  const toggle = (i: number, shift: boolean) => {
    const on = !rowSlots(visible[i]).every((s) => selected.has(s));
    const [a, b] = shift && anchor !== null ? (anchor < i ? [anchor, i] : [i, anchor]) : [i, i];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let k = a; k <= b; k++) {
        for (const s of rowSlots(visible[k])) {
          if (on) next.add(s);
          else next.delete(s);
        }
      }
      return next;
    });
    setAnchor(i);
  };

  const toggleDayOpen = (date: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    // 줄 순서가 바뀌므로 Shift 기준을 잊는다
    setAnchor(null);
  };

  const run = async (fn: () => Promise<ApiKeyAlloc>, done: string) => {
    setBusy(true);
    try {
      onAlloc(await fn());
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const applySpans = async (key: string) => {
    const target = key ? parseTargetKey(key) : null;
    const label = spans.length === 1 ? rangeLabel(spans[0], year) : `${spans.length}개 구간`;
    const ok = await run(
      () => setApiKeySpans(meta.hash, meta.name, spans, target),
      target ? `${label} → 「${book.label(target)}」 에 붙였습니다.` : `${label} — 키의 기본으로 되돌렸습니다.`,
    );
    if (ok) {
      setSelected(new Set());
      setAnchor(null);
    }
  };

  const addRange = async () => {
    const target = parseTargetKey(form.target);
    if (!form.from) return toast.error("시작일을 적어 주세요.");
    if (!target) return toast.error("붙일 곳을 골라 주세요.");
    const span = { from: `${form.from}T${form.fromHour}`, to: form.to ? `${form.to}T${form.toHour}` : undefined };
    const ok = await run(() => setApiKeyRange(meta.hash, meta.name, span, target, form.note), `${rangeLabel(span, year)} → 「${book.label(target)}」 에 붙였습니다.`);
    if (ok) setForm({ from: "", fromHour: "00", to: "", toHour: "23", target: "", note: "" });
  };

  const ranges = alloc?.ranges ?? [];

  return (
    <div className="flex flex-col gap-4 bg-nd-sunken/50 px-4 py-4">
      {/* 날짜별 · 시간별 */}
      {keyDays.length === 0 ? (
        <p className="text-nd-table text-nd-fg-3">이 기간에 쓴 날이 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-nd-md border border-nd-line bg-nd-content">
          <TableScroll maxHeight={460}>
            <Table size="sm" minWidth={860}>
              <thead>
                <tr>
                  <Th sticky="top" className="w-9">
                    <Checkbox aria-label="모든 날 고르기" checked={allPicked} onChange={() => setSelected(allPicked ? new Set() : new Set(allSlots))} />
                  </Th>
                  <Th sticky="top">날 · 시간</Th>
                  <Th sticky="top" align="right">
                    쓴 돈
                  </Th>
                  <Th sticky="top" align="right">
                    요청
                  </Th>
                  <Th sticky="top">모델</Th>
                  <Th sticky="top">붙은 곳</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  if (row.kind === "hour") {
                    const on = selected.has(row.h.slot);
                    return (
                      <Tr key={row.h.slot} selected={on} className={cn("cursor-pointer", !on && "bg-nd-sunken/40")} onClick={(e: MouseEvent) => toggle(i, e.shiftKey)}>
                        <Td className="w-9">
                          <Checkbox aria-label={`${dayLabel(row.kd.date)} ${Number(row.h.hour)}시 고르기`} checked={on} readOnly tabIndex={-1} className="pointer-events-none" />
                        </Td>
                        <Td className="whitespace-nowrap pl-7 text-nd-fg-2">{Number(row.h.hour)}시</Td>
                        <Td num>{usdText(row.h.usd)}</Td>
                        <Td num muted>
                          {row.h.requests.toLocaleString("ko-KR")}
                        </Td>
                        <Td muted className="max-w-[380px] truncate" title={row.h.models.join(" · ")}>
                          {row.h.models.join(" · ")}
                        </Td>
                        <Td className="max-w-[360px]">
                          <Place target={row.h.target} via={row.h.via} book={book} />
                        </Td>
                      </Tr>
                    );
                  }
                  const { kd } = row;
                  const slots = daySlots(kd);
                  const pickedHours = slots.filter((s) => selected.has(s)).length;
                  const whole = pickedHours === slots.length;
                  const open = openDays.has(kd.date);
                  const splitText = kd.splits.map((g) => `${book.label(g.target)} ${usdText(g.usd)}`).join(" · ");
                  return (
                    <Tr key={kd.date} selected={whole} className="cursor-pointer" onClick={(e: MouseEvent) => toggle(i, e.shiftKey)}>
                      <Td className="w-9">
                        <Checkbox aria-label={`${dayLabel(kd.date)} 고르기`} checked={whole} readOnly tabIndex={-1} className="pointer-events-none" />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {dayLabel(kd.date)}
                        {kd.partial && (
                          <Badge tone="info" size="sm" className="ml-2">
                            진행 중
                          </Badge>
                        )}
                        {kd.legacy && (
                          <span className="ml-2 text-nd-fg-3" title={`이 날은 시간별 기록이 없어 ${dayLabel(kd.date)} 오전 9시부터 다음 날 오전 9시까지입니다. 하루 통째로만 붙일 수 있습니다.`}>
                            9시 기준
                          </span>
                        )}
                        {kd.hours.length > 0 && (
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`${dayLabel(kd.date)} 시간별 보기`}
                            className="ml-2 inline-flex items-center gap-0.5 rounded-nd-sm px-1 text-nd-table font-medium text-nd-accent-strong hover:bg-nd-accent-soft"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDayOpen(kd.date);
                            }}
                          >
                            시간별
                            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                          </button>
                        )}
                        {pickedHours > 0 && !whole && <span className="ml-2 text-nd-accent-strong">{pickedHours}시간 고름</span>}
                      </Td>
                      <Td num>{usdText(kd.usd)}</Td>
                      <Td num muted>
                        {kd.requests.toLocaleString("ko-KR")}
                      </Td>
                      <Td muted className="max-w-[380px] truncate" title={kd.models.map((m) => `${m.model} ${usdText(m.usd)} (${m.requests}건)`).join("\n")}>
                        {modelsLine(kd.models)}
                      </Td>
                      <Td className="max-w-[360px]">
                        {kd.splits.length > 1 ? (
                          <span className="inline-flex max-w-full items-center gap-2" title={splitText}>
                            <Badge tone="info" size="sm" className="shrink-0">
                              나뉨
                            </Badge>
                            <span className="min-w-0 truncate text-nd-fg">{splitText}</span>
                          </span>
                        ) : (
                          <Place target={kd.splits[0]?.target ?? null} via={kd.splits[0]?.via ?? null} book={book} />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </div>
      )}

      {/* 고른 날 · 시간 붙이기 */}
      {spans.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-nd-md border border-nd-accent/30 bg-nd-accent-soft/50 px-3 py-2.5">
          <span className="nd-num text-nd-table font-medium text-nd-fg">
            {spans.length === 1 ? rangeLabel(spans[0], year) : `${spans.length}개 구간`} · {usdText(pickedUsd)}
          </span>
          <TargetSelect book={book} value="" none="어디에 붙일까요" onChange={(k) => k && applySpans(k)} disabled={busy} ariaLabel="고른 시간을 붙일 곳" className="w-full sm:w-80" />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => applySpans("")}>
            기본으로 되돌리기
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            선택 풀기
          </Button>
        </div>
      )}

      {/* 따로 정한 구간 */}
      <div className="flex flex-col gap-2">
        <h4 className="text-nd-table font-semibold text-nd-fg">따로 정한 구간</h4>
        {ranges.length === 0 ? (
          <p className="text-nd-table text-nd-fg-3">없습니다 — 모든 시간이 키의 기본을 따릅니다.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {ranges.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-nd-table">
                <span className="nd-num w-48 shrink-0 text-nd-fg-2">{rangeLabel(r, year)}</span>
                <span className="min-w-0 truncate text-nd-fg">{book.label(r.target)}</span>
                {r.note && <span className="min-w-0 truncate text-nd-fg-3">{r.note}</span>}
                <IconButton
                  icon={Trash2}
                  size="sm"
                  label="이 구간 지우기"
                  disabled={busy}
                  onClick={() => run(() => deleteApiKeyRange(meta.hash, r.id), "구간을 지웠습니다 — 그 시간들은 키의 기본을 따릅니다.")}
                />
              </li>
            ))}
          </ul>
        )}
        <FormRow className="mt-2 grid-cols-2 lg:grid-cols-[150px_84px_150px_84px_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
          <Field label="시작일">
            <Input size="sm" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </Field>
          <Field label="시작 시각">
            <Select size="sm" value={form.fromHour} onChange={(e) => setForm({ ...form, fromHour: e.target.value })}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {Number(h)}시
                </option>
              ))}
            </Select>
          </Field>
          <Field label="끝날 (비우면 계속)">
            <Input size="sm" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </Field>
          <Field label="끝 시각">
            <Select size="sm" value={form.toHour} disabled={!form.to} onChange={(e) => setForm({ ...form, toHour: e.target.value })}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {Number(h)}시
                </option>
              ))}
            </Select>
          </Field>
          <Field label="붙일 곳">
            <TargetSelect book={book} value={form.target} none="고르세요" onChange={(k) => setForm({ ...form, target: k })} ariaLabel="구간을 붙일 곳" />
          </Field>
          <Field label="메모 (없어도 됨)">
            <Input size="sm" value={form.note} maxLength={120} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <FieldAction>
            <Button size="sm" variant="secondary" loading={busy} onClick={addRange}>
              구간 넣기
            </Button>
          </FieldAction>
        </FormRow>
      </div>
    </div>
  );
}

// ---- 키 표 ----------------------------------------------------------

function KeyTable({
  items,
  days,
  allocs,
  book,
  year,
  ownerName,
  openKey,
  setOpenKey,
  onDefault,
  onAlloc,
}: {
  items: { meta: ApiKeyMeta; sum: ApiKeySum | null }[];
  days: ApiDayDoc[];
  allocs: Record<string, ApiKeyAlloc>;
  book: TargetBook;
  year: string;
  ownerName: (owner: string) => string;
  openKey: string | null;
  setOpenKey: (h: string | null) => void;
  onDefault: (meta: ApiKeyMeta, key: string) => void;
  onAlloc: (a: ApiKeyAlloc) => void;
}) {
  return (
    <TableScroll>
      <Table size="sm" minWidth={860}>
        <thead>
          <tr>
            <Th className="w-8" />
            <Th>키</Th>
            <Th className="w-[360px]">기본으로 붙일 곳</Th>
            <Th align="right">이 기간</Th>
            <Th align="right">안 정함</Th>
            <Th align="right">쓴 날</Th>
            <Th align="right">따로 정한 구간</Th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ meta, sum }) => {
            const open = openKey === meta.hash;
            const alloc = allocs[meta.hash];
            return (
              <Fragment key={meta.hash}>
                <Tr className="cursor-pointer" selected={open} onClick={() => setOpenKey(open ? null : meta.hash)}>
                  <Td className="w-8 text-nd-fg-3">{open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <button type="button" aria-expanded={open} className="text-left font-medium text-nd-fg">
                        {meta.name}
                      </button>
                      {meta.gone ? (
                        <Badge size="sm">만료 · 삭제</Badge>
                      ) : meta.disabled ? (
                        <Badge size="sm">꺼짐</Badge>
                      ) : null}
                    </div>
                    <div className="text-nd-table text-nd-fg-3">{ownerName(meta.owner)}</div>
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <TargetSelect book={book} value={targetKey(alloc?.default)} onChange={(k) => onDefault(meta, k)} ariaLabel={`${meta.name} 기본으로 붙일 곳`} className="w-full" />
                  </Td>
                  <Td num>{usdText(sum?.usd ?? 0)}</Td>
                  <Td num className={cn((sum?.unassigned ?? 0) > 0 ? "text-nd-warning-text" : "text-nd-fg-3")}>
                    {usdText(sum?.unassigned ?? 0)}
                  </Td>
                  <Td num muted>
                    {sum?.days ?? 0}
                  </Td>
                  <Td num muted>
                    {alloc?.ranges.length ? `${alloc.ranges.length}개` : "—"}
                  </Td>
                </Tr>
                {open && (
                  <tr>
                    <td colSpan={7} className="border-b border-nd-line p-0">
                      <KeyDetail meta={meta} days={days} alloc={alloc} book={book} year={year} onAlloc={onAlloc} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}

// ---- 원가로 보내기 ------------------------------------------------------

function PushDialog({
  project,
  allRows,
  rate,
  onClose,
  onDone,
}: {
  project: FinProjectDoc;
  allRows: ApiCostRow[];
  rate: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const cost = useMemo(() => projectApiCost(allRows, project.id), [allRows, project.id]);
  const manual = (project.lines ?? []).filter(isManualApiLine);
  const current = (project.lines ?? []).find((l) => l.id === API_COST_LINE_ID);
  const krw = krwOf(cost.usd, rate);
  const year = new Date().getUTCFullYear().toString();

  const send = async () => {
    setBusy(true);
    try {
      const r = await pushApiCostToProject(project.id, [...remove]);
      toast.success(r.usd > 0 ? `「${project.name}」 원가에 ${won(r.krw)} 를 넣었습니다.` : `「${project.name}」 의 API 비용 줄을 지웠습니다.`);
      await onDone();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="프로젝트 원가로 보내기"
      description={project.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button loading={busy} onClick={send}>
            {cost.usd > 0 ? (current ? "줄 고치기" : "지출 줄 넣기") : "줄 지우기"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="nd-num rounded-nd-md bg-nd-sunken px-3 py-2.5 text-nd-body text-nd-fg">
          {usdText(cost.usd)} × {rate.toLocaleString("ko-KR")}원 = <b className="font-semibold">{won(krw)}</b>
          {current?.actual !== undefined && <span className="ml-2 text-nd-table text-nd-fg-3">지금 줄 {won(current.actual)}</span>}
        </p>
        <p className="text-nd-table text-nd-fg-2">
          프로젝트 지출에 분류 「AI API」 줄 하나로 들어가 이익이 그만큼 줄어듭니다. 끝난 날까지만 셉니다{cost.through ? ` (${dayLabel(cost.through)}까지)` : ""}. 다시 보내면 이 줄을 고칩니다.
        </p>
        {cost.parts.length > 0 && (
          <div className="overflow-hidden rounded-nd-md border border-nd-line">
            <TableScroll maxHeight={220}>
              <Table size="sm">
                <thead>
                  <tr>
                    <Th sticky="top">키</Th>
                    <Th sticky="top">날</Th>
                    <Th sticky="top" align="right">
                      쓴 돈
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {cost.parts.map((p) => (
                    <Tr key={`${p.hash}-${p.from}`}>
                      <Td>{p.name}</Td>
                      <Td muted className="nd-num">
                        {rangeLabel(p, year)}
                      </Td>
                      <Td num>{usdText(p.usd)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </div>
        )}
        {manual.length > 0 && (
          <div className="flex flex-col gap-2">
            <InlineNotice tone="warning">
              이 프로젝트에 손으로 적은 API 비용 줄이 {manual.length}개 있습니다. 같은 돈이면 두 번 잡히니, 겹치는 줄을 골라 지우세요.
            </InlineNotice>
            {manual.map((l) => (
              <Checkbox
                key={l.id}
                className="text-nd-table"
                checked={remove.has(l.id)}
                onChange={() =>
                  setRemove((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.id)) next.delete(l.id);
                    else next.add(l.id);
                    return next;
                  })
                }
                label={`지우기 — ${l.item || l.category} (${won(l.actual ?? (l.unitPrice ?? 0) * (l.qty ?? 0))})`}
              />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---- 화면 ------------------------------------------------------------

const Kpi = ({ children }: { children: ReactNode }) => <span className="nd-num">{children}</span>;

export default function ApiCostsPage() {
  const { projects, loading: financeLoading, refresh } = useFinance();
  const { members } = useAppData();
  const toast = useToast();
  const [resp, setResp] = useState<ApiCostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pushFor, setPushFor] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchApiCosts();
      setResp(r);
      if (r.configured) setRateDraft(String(r.view.settings.krwPerUsd));
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const view = resp?.configured ? resp.view : null;
  const rate = view?.settings.krwPerUsd ?? 0;

  const allRows = useMemo(() => (view ? costRows(view.days, view.allocs) : []), [view]);
  // 달 고르기 — 쓴 돈이 있는 달만, 최근 달부터
  const months = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) m.set(r.date.slice(0, 7), (m.get(r.date.slice(0, 7)) ?? 0) + r.usd);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, usd]) => ({ month, usd }));
  }, [allRows]);
  const activePeriod = period || months[0]?.month || "all";
  const inPeriod = useCallback((date: string) => activePeriod === "all" || date.startsWith(activePeriod), [activePeriod]);
  const rows = useMemo(() => allRows.filter((r) => inPeriod(r.date)), [allRows, inPeriod]);
  const periodDays = useMemo(() => (view?.days ?? []).filter((d) => inPeriod(d.date)), [view, inPeriod]);

  const book = useMemo<TargetBook>(() => {
    const byStart = (a: FinProjectDoc, b: FinProjectDoc) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")) || a.name.localeCompare(b.name);
    const open = (p: FinProjectDoc) => p.status === "active" || p.status === "planning";
    const spaces = view?.spaces ?? [];
    return {
      active: projects.filter(open).sort(byStart),
      done: projects.filter((p) => !open(p)).sort(byStart),
      spaces,
      loading: financeLoading && projects.length === 0,
      label: (t) => {
        if (!t) return "안 정함";
        if (t.kind === "common") return "공통 · 내부";
        if (t.kind === "studio") return spaces.find((s) => s.id === t.id)?.name ?? "(없는 채널)";
        return projects.find((p) => p.id === t.id)?.name ?? (financeLoading && projects.length === 0 ? "불러오는 중…" : "(지운 프로젝트)");
      },
    };
  }, [projects, financeLoading, view]);

  const ownerName = useCallback(
    (owner: string) => {
      if (!owner) return "주인 없음";
      return OWNER_GROUP_LABEL[owner] ?? members.find((m) => m.email?.toLowerCase() === owner)?.name ?? owner;
    },
    [members],
  );

  // 키 표 — 이 기간에 쓴 키가 위, 안 쓴 키는 접어 둔다
  const { usedKeys, idleKeys } = useMemo(() => {
    const sums = new Map(sumByKey(rows).map((s) => [s.hash, s]));
    const metas = view?.keys ?? [];
    const used = metas.filter((m) => sums.has(m.hash)).map((meta) => ({ meta, sum: sums.get(meta.hash) ?? null }));
    used.sort((a, b) => (b.sum?.usd ?? 0) - (a.sum?.usd ?? 0));
    const idle = metas.filter((m) => !sums.has(m.hash)).map((meta) => ({ meta, sum: null }));
    idle.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    return { usedKeys: used, idleKeys: idle };
  }, [rows, view]);

  // 붙일 곳 표 — 이 기간에 없어도, 보낸 줄과 지금 숫자가 어긋난 프로젝트는 보여 준다
  const targets = useMemo(() => {
    const list: ApiTargetSum[] = sumByTarget(rows);
    for (const [id, pushed] of Object.entries(view?.settings.pushed ?? {})) {
      if (list.some((t) => t.key === `fin:${id}`)) continue;
      if (Math.abs(projectApiCost(allRows, id).usd - pushed.usd) >= 0.005) {
        const none = list.findIndex((t) => t.key === "");
        const row: ApiTargetSum = { key: `fin:${id}`, target: { kind: "fin", id }, usd: 0, partialUsd: 0, keys: [] };
        if (none < 0) list.push(row);
        else list.splice(none, 0, row);
      }
    }
    return list;
  }, [rows, allRows, view]);

  const totals = useMemo(() => {
    const usd = rows.reduce((n, r) => n + r.usd, 0);
    const unassigned = rows.reduce((n, r) => n + (r.target ? 0 : r.usd), 0);
    return { usd, unassigned, assigned: usd - unassigned };
  }, [rows]);

  const patchAlloc = useCallback((a: ApiKeyAlloc) => {
    setResp((prev) => (prev?.configured ? { ...prev, view: { ...prev.view, allocs: { ...prev.view.allocs, [a.hash]: a } } } : prev));
  }, []);

  const onDefault = async (meta: ApiKeyMeta, key: string) => {
    const target = key ? parseTargetKey(key) : null;
    try {
      patchAlloc(await setApiKeyDefault(meta.hash, meta.name, target));
      toast.success(target ? `${meta.name} → ${book.label(target)}` : `${meta.name} 의 기본을 지웠습니다.`);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const saveRate = async () => {
    if (!view || Number(rateDraft) === rate) return;
    try {
      const settings = await saveApiCostRate(Number(rateDraft));
      setResp((prev) => (prev?.configured ? { ...prev, view: { ...prev.view, settings } } : prev));
      setRateDraft(String(settings.krwPerUsd));
      toast.success(`환율을 1달러 ${settings.krwPerUsd.toLocaleString("ko-KR")}원으로 저장했습니다.`);
    } catch (e) {
      setRateDraft(String(rate));
      toast.error(errText(e));
    }
  };

  const resync = async () => {
    setSyncing(true);
    try {
      const r = await syncApiCosts(3, true);
      await load();
      toast.success(`오픈라우터에서 ${r.dates.length}일치를 다시 받았습니다.`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSyncing(false);
    }
  };

  const header = (
    <PageHeader
      title="API 비용"
      description="오픈라우터 키마다 쓴 돈을 어느 프로젝트에 썼는지 정합니다. 키의 기본을 고르고, 다른 일에 쓴 날이나 시간은 키를 펼쳐 따로 붙입니다."
      actions={
        view && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-nd-table text-nd-fg-2">
              1달러 =
              <NumberInput size="sm" className="w-24" value={rateDraft} onValueChange={setRateDraft} onBlur={saveRate} aria-label="원화 환율" />
              원
            </label>
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={syncing} onClick={resync}>
              다시 받기
            </Button>
          </div>
        )
      }
    />
  );

  if (error && !resp) {
    return (
      <PageShell>
        {header}
        <ErrorState
          description={error}
          action={
            <Button size="sm" variant="secondary" onClick={load}>
              다시 시도
            </Button>
          }
        />
      </PageShell>
    );
  }
  if (!resp) {
    return (
      <PageShell>
        {header}
        <LoadingState />
      </PageShell>
    );
  }
  if (!view) {
    return (
      <PageShell>
        {header}
        <EmptyState icon={Cpu} title="오픈라우터 관리 키가 없습니다" description="서버 환경변수 OPENROUTER_MANAGEMENT_KEY 를 넣으면 키별 사용액을 읽어 옵니다." />
      </PageShell>
    );
  }

  const year = activePeriod === "all" ? "" : activePeriod.slice(0, 4);
  const first = view.days.find((d) => d.keys.length > 0)?.date;
  const hasToday = view.days.some((d) => d.partial && inPeriod(d.date));
  const pushProject = pushFor ? projects.find((p) => p.id === pushFor) : undefined;

  return (
    <PageShell>
      {header}

      <div className="flex flex-col gap-5">
        {view.synced.error && <InlineNotice tone="warning">오픈라우터에서 새 기록을 받지 못했습니다 — {view.synced.error}</InlineNotice>}

        <Select
          aria-label="기간"
          className="w-full self-start sm:w-64"
          value={activePeriod}
          onChange={(e) => {
            setPeriod(e.target.value);
            setOpenKey(null);
          }}
        >
          {months.map(({ month, usd }) => (
            <option key={month} value={month}>
              {`${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 · ${usdText(usd)}`}
            </option>
          ))}
          <option value="all">쌓인 기록 전체</option>
        </Select>

        <KpiStrip columns={4}>
          <KpiItem label="이 기간 쓴 돈" value={<Kpi>{usdText(totals.usd)}</Kpi>} hint={`약 ${won(krwOf(totals.usd, rate))}${hasToday ? " · 오늘 진행 중 포함" : ""}`} />
          <KpiItem label="붙일 곳을 정한 돈" value={<Kpi>{usdText(totals.assigned)}</Kpi>} hint={totals.usd > 0 ? `${Math.round((totals.assigned / totals.usd) * 100)}%` : undefined} />
          <KpiItem label="안 정한 돈" tone={totals.unassigned > 0 ? "warning" : undefined} value={<Kpi>{usdText(totals.unassigned)}</Kpi>} hint={`약 ${won(krwOf(totals.unassigned, rate))}`} />
          <KpiItem label="충전 잔액 (지금)" tone={view.credits.balance < 50 ? "danger" : undefined} value={<Kpi>{usdText(view.credits.balance)}</Kpi>} hint={`쓴 돈 ${usdText(view.credits.used)} / 충전 ${usdText(view.credits.total)}`} />
        </KpiStrip>

        <Card>
          <SectionHeader size="lg" title="키별" hint="줄을 누르면 날짜별로 펼쳐집니다. 날을 고르거나 「시간별」 을 눌러 시간을 골라 다른 곳에 붙이세요. 고르면 바로 저장됩니다." />
          {usedKeys.length === 0 ? (
            <EmptyState compact icon={Cpu} title="이 기간에 쓴 키가 없습니다" />
          ) : (
            <KeyTable items={usedKeys} days={periodDays} allocs={view.allocs} book={book} year={year} ownerName={ownerName} openKey={openKey} setOpenKey={setOpenKey} onDefault={onDefault} onAlloc={patchAlloc} />
          )}
          <TableNote>
            날짜와 시간은 한국 시각입니다 (19시는 19:00~19:59). {shortDate(addDays(EXACT_FROM, -1))}까지는 오픈라우터에 시간별 기록이 남아 있지 않아, 그날 오전 9시부터 다음 날 오전 9시까지를 하루로 보고 하루 통째로만 붙일 수 있습니다 (「9시 기준」).
            {first ? ` 기록은 ${first}부터 있습니다.` : ""}
          </TableNote>
        </Card>

        {idleKeys.length > 0 && (
          <Disclosure title={`이 기간에 안 쓴 키 ${idleKeys.length}개`} description="기본 붙일 곳을 미리 정해 둘 수 있습니다.">
            <KeyTable items={idleKeys} days={periodDays} allocs={view.allocs} book={book} year={year} ownerName={ownerName} openKey={openKey} setOpenKey={setOpenKey} onDefault={onDefault} onAlloc={patchAlloc} />
          </Disclosure>
        )}

        <Card>
          <SectionHeader size="lg" title="붙일 곳별" hint="재무 프로젝트는 「원가로 보내기」 를 눌러야 그 프로젝트의 이익에 들어갑니다." />
          {targets.length === 0 ? (
            <EmptyState compact icon={Cpu} title="이 기간에 쓴 돈이 없습니다" />
          ) : (
            <TableScroll>
              <Table size="sm" minWidth={900}>
                <thead>
                  <tr>
                    <Th>붙일 곳</Th>
                    <Th>종류</Th>
                    <Th align="right">이 기간</Th>
                    <Th align="right">원화 (어림)</Th>
                    <Th>어떤 키</Th>
                    <Th className="w-[210px]">프로젝트 원가</Th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => {
                    const pushed = t.target?.kind === "fin" ? view.settings.pushed[t.target.id] : undefined;
                    const now = t.target?.kind === "fin" ? projectApiCost(allRows, t.target.id).usd : 0;
                    const stale = pushed ? Math.abs(pushed.usd - now) >= 0.005 : false;
                    const exists = t.target?.kind === "fin" && projects.some((p) => p.id === t.target?.id);
                    return (
                      <Tr key={t.key || "none"}>
                        <Td className="font-medium">
                          {t.target?.kind === "fin" && exists ? (
                            <Link href={`/neander/finance/projects/${t.target.id}`} className="text-nd-fg hover:underline">
                              {book.label(t.target)}
                            </Link>
                          ) : t.target ? (
                            book.label(t.target)
                          ) : (
                            <Badge tone="warning">안 정함</Badge>
                          )}
                        </Td>
                        <Td muted>{t.target && t.target.kind !== "common" ? API_TARGET_KIND_LABEL[t.target.kind] : "—"}</Td>
                        <Td num>{usdText(t.usd)}</Td>
                        <Td num muted>
                          {won(krwOf(t.usd, rate))}
                        </Td>
                        <Td muted className="max-w-[360px] truncate" title={t.keys.map((k) => `${k.name} ${usdText(k.usd)}`).join("\n")}>
                          {t.keys.slice(0, 3).map((k) => `${k.name} ${usdText(k.usd)}`).join(" · ")}
                          {t.keys.length > 3 ? ` 외 ${t.keys.length - 3}` : ""}
                        </Td>
                        <Td>
                          {t.target?.kind === "fin" && exists ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {pushed && !stale ? (
                                <span className="nd-num text-nd-table text-nd-fg-2">보냄 · {won(pushed.krw)}</span>
                              ) : (
                                <Button size="sm" variant={pushed ? "soft" : "secondary"} onClick={() => setPushFor(t.target?.id ?? null)}>
                                  {pushed ? "바뀜 · 다시 보내기" : "원가로 보내기"}
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="text-nd-table text-nd-fg-4">—</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      </div>

      {pushProject && (
        <PushDialog
          project={pushProject}
          allRows={allRows}
          rate={rate}
          onClose={() => setPushFor(null)}
          onDone={async () => {
            await Promise.all([refresh(), load()]);
          }}
        />
      )}
    </PageShell>
  );
}
