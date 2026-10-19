"use client";

// ============================================================
//  런웨이 › 줄여 보기 — 어디를 얼마나 줄이면 몇 달을 더 버티나
// ------------------------------------------------------------
//  예측과 같은 화면에 있다(2026-10-19 사용자 요청 — 토글로 오가지 말고 한 화면).
//  고른 시나리오가 화면 전체에 얹힌다: 지표는 「줄이기 전 → 후」, 그래프는
//  회색(전) 위에 파랑(후), 월별 표에는 「줄이기」 줄이 생긴다. 「줄이지 않음」 을
//  고르면 순수 예측이다.
//
//    시나리오   이름 붙인 줄이기 묶음 — 「매장 축소안」 「임원급여 동결안」 을
//               나란히 견준다. 팀 공유 가정 문서에 함께 저장된다.
//    줄이기     지출 계정 트리(대 ▸ 중 ▸ 소) 어느 단계든 몇 % · 언제부터.
//               아래 단계에 따로 적으면 그게 이긴다 — 「운영비 20%, 임차료는 빼고(0%)」
//    목표 역산  「6개월 버티려면 매달 얼마를 더 줄여야 하나」
//
//  이 파일은 화면 조각과 그 상태(useCutScenarios)만 갖는다.
//  계산은 lib/neander/finance/runway.ts 의 simulateRunway · requiredSaving.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Copy, Plus, RotateCcw, Scissors, Target, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Money,
  NumberInput,
  SectionHeader,
  SegmentedControl,
  Select,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
} from "@/components/neander/ui";
import {
  defaultCutFrom,
  newScenario,
  requiredSaving,
  simulateRunway,
  type B2BBasis,
  type ExpenseNode,
  type RunwayCut,
  type RunwayOutcome,
  type RunwayResult,
  type RunwayScenario,
  type RunwaySettings,
  type SimResult,
} from "@/lib/neander/finance/runway";
import { monthLabel, shortWon } from "@/lib/neander/format";

const BASIS_LABEL: Record<B2BBasis, string> = { booked: "잡힌 돈만", usual: "평소만큼 수주" };
const shortMonth = (m: string) => `${m.slice(2, 4)}.${Number(m.slice(5))}`;
const man = (v: number) => Math.round(v / 10_000).toLocaleString("ko-KR");

/** 런웨이 개월 글자 — 내다본 기간 안에 안 바닥나면 「12+」 */
export function runwayMonths(o: RunwayOutcome, horizon: number): string {
  return o.months === null ? `${horizon}+` : o.months.toFixed(1);
}

// ---- 상태 ----------------------------------------------------------------

export type CutEditor = ReturnType<typeof useCutScenarios>;

/**
 * 시나리오 고르기 · 줄이기 고치기. 고른 시나리오는 주소(?scenario=)에 남긴다 —
 * 새로고침하거나 링크를 건네도 같은 그림을 본다. 비어 있으면 「줄이지 않음」.
 */
export function useCutScenarios({
  result: r,
  settings,
  update,
  thisMonth,
}: {
  result: RunwayResult;
  settings: RunwaySettings;
  update: (fn: (s: RunwaySettings) => RunwaySettings) => void;
  thisMonth: string;
}) {
  const scenarios = settings.scenarios;
  const [selectedId, setSelectedState] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("scenario");
    if (id) setSelectedState(id);
  }, []);

  const select = (id: string | null) => {
    setSelectedState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("scenario", id);
    else url.searchParams.delete("scenario");
    url.searchParams.delete("view"); // 예전 토글 주소
    window.history.replaceState(null, "", url.toString());
  };

  const scenario = scenarios.find((s) => s.id === selectedId) ?? null;
  const cuts = useMemo(() => new Map((scenario?.cuts ?? []).map((c) => [c.path, c])), [scenario]);
  const fromDefault = defaultCutFrom(r.months, thisMonth);

  const base = useMemo(() => simulateRunway(r, null), [r]);
  const sim = useMemo(() => simulateRunway(r, scenario), [r, scenario]);
  const all = useMemo(() => scenarios.map((sc) => ({ sc, sim: simulateRunway(r, sc) })), [r, scenarios]);
  /** 화면에 줄이기가 실제로 걸려 있나 — 없으면 지표·그래프는 예측 그대로 */
  const active = sim.rows.some((x) => x.saving > 0);

  /** 고른 시나리오가 없으면 하나 만들어 그 안에서 고친다 */
  const editCuts = (fn: (cuts: RunwayCut[]) => RunwayCut[]) => {
    const sc = scenario ?? newScenario(`시나리오 ${scenarios.length + 1}`);
    if (!scenario) select(sc.id);
    update((s) => {
      const list = s.scenarios.some((x) => x.id === sc.id) ? s.scenarios : [...s.scenarios, sc];
      return { ...s, scenarios: list.map((x) => (x.id === sc.id ? { ...x, cuts: fn(x.cuts) } : x)) };
    });
  };

  /** 위 단계에 걸린 줄이기 (이 경로 자신은 빼고) */
  const inherited = (path: string): RunwayCut | undefined => {
    const parts = path.split("|");
    for (let d = parts.length - 1; d >= 1; d--) {
      const c = cuts.get(parts.slice(0, d).join("|"));
      if (c) return c;
    }
    return undefined;
  };

  return {
    r,
    scenarios,
    scenario,
    selectedId: scenario?.id ?? null,
    select,
    cuts,
    fromDefault,
    base,
    sim,
    all,
    active,
    inherited,
    addScenario: (copyOf?: RunwayScenario) => {
      const sc = newScenario(copyOf ? `${copyOf.name} 사본` : `시나리오 ${scenarios.length + 1}`);
      if (copyOf) sc.cuts = copyOf.cuts.map((c) => ({ ...c }));
      update((s) => ({ ...s, scenarios: [...s.scenarios, sc] }));
      select(sc.id);
    },
    patchScenario: (id: string, p: Partial<RunwayScenario>) =>
      update((s) => ({ ...s, scenarios: s.scenarios.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
    removeScenario: (id: string) => {
      update((s) => ({ ...s, scenarios: s.scenarios.filter((x) => x.id !== id) }));
      select(null);
    },
    setPct: (path: string, pct: number) =>
      editCuts((list) => {
        const rest = list.filter((c) => c.path !== path);
        const prev = list.find((c) => c.path === path);
        // 위에서 줄이는 게 없으면 0% 는 「안 줄임」 이라 적어 둘 까닭이 없다
        if (pct <= 0 && !inherited(path)) return rest;
        return [
          ...rest,
          { path, pct: Math.min(100, Math.max(0, Math.round(pct))), from: prev?.from ?? inherited(path)?.from ?? fromDefault },
        ];
      }),
    setFrom: (path: string, from: string) => editCuts((list) => list.map((c) => (c.path === path ? { ...c, from } : c))),
    clearCut: (path: string) => editCuts((list) => list.filter((c) => c.path !== path)),
  };
}

// ---- 시나리오 고르기 ------------------------------------------------------

export function ScenarioBar({ ed, className }: { ed: CutEditor; className?: string }) {
  const horizon = ed.r.months.length;
  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-nd-body transition-colors duration-nd-fast",
      selected
        ? "border-nd-accent bg-nd-accent-soft font-medium text-nd-fg"
        : "border-nd-line bg-nd-content text-nd-fg-2 hover:border-nd-border",
    );
  return (
    <Card className={className}>
      <SectionHeader
        title="비용 줄여 보기"
        hint="시나리오를 고르면 지표 · 그래프 · 월별 표에 그 줄이기가 얹힙니다 · 아래 「어디를 줄일까」 에서 고칩니다"
        action={
          <div className="flex gap-2">
            {ed.scenario && (
              <Button variant="ghost" size="sm" icon={Copy} onClick={() => ed.addScenario(ed.scenario!)}>
                복제
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => ed.addScenario()}>
              새 시나리오
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="줄이기 시나리오">
        <button type="button" role="tab" aria-selected={!ed.scenario} onClick={() => ed.select(null)} className={chip(!ed.scenario)}>
          줄이지 않음
          <span className="ml-1.5 nd-num text-nd-caption text-nd-fg-3">{runwayMonths(ed.base.outcome, horizon)}개월</span>
        </button>
        {ed.all.map(({ sc, sim }) => (
          <button
            key={sc.id}
            type="button"
            role="tab"
            aria-selected={sc.id === ed.selectedId}
            onClick={() => ed.select(sc.id)}
            className={chip(sc.id === ed.selectedId)}
          >
            {sc.name || "(이름 없음)"}
            <span className="ml-1.5 nd-num text-nd-caption text-nd-fg-3">{runwayMonths(sim.outcome, horizon)}개월</span>
          </button>
        ))}
        {ed.scenario && (
          <div className="ml-auto flex items-center gap-1">
            <Input
              size="sm"
              className="w-48"
              value={ed.scenario.name}
              onChange={(e) => ed.patchScenario(ed.scenario!.id, { name: e.target.value })}
              aria-label="시나리오 이름"
            />
            <IconButton
              icon={RotateCcw}
              size="sm"
              label="이 시나리오의 줄이기를 모두 지우기"
              disabled={ed.scenario.cuts.length === 0}
              onClick={() => ed.patchScenario(ed.scenario!.id, { cuts: [] })}
            />
            <IconButton icon={Trash2} size="sm" label="이 시나리오 지우기" onClick={() => ed.removeScenario(ed.scenario!.id)} />
          </div>
        )}
      </div>
      <p className="mt-2 text-nd-caption text-nd-fg-3">칩의 개월 수는 「잡힌 돈만」 기준입니다.</p>
    </Card>
  );
}

// ---- 목표 역산 ------------------------------------------------------------

export function GoalSeek({ ed, className }: { ed: CutEditor; className?: string }) {
  const { r, sim, scenario } = ed;
  const [basis, setBasis] = useState<B2BBasis>("booked");
  const [target, setTarget] = useState(6);
  const [goalFrom, setGoalFrom] = useState<string | null>(null);
  const startAt = goalFrom && r.months.includes(goalFrom) ? goalFrom : ed.fromDefault;
  const need = useMemo(() => requiredSaving(r, sim, target, basis, startAt), [r, sim, target, basis, startAt]);
  /** 역산이 안 될 때 — 줄이기를 시작하기도 전에 바닥나는 달 */
  const sunkBefore = useMemo(() => {
    if (need !== null) return null;
    const hit = sim.rows.find((x) => x.month < startAt && (basis === "usual" ? x.closingAlt : x.closing) < 0);
    return hit?.month ?? null;
  }, [need, sim, startAt, basis]);
  const remainingExpense = r.baseExpense - sim.savingFull;

  return (
    <div className={cn("rounded-nd-md bg-nd-sunken/60 px-4 py-3", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-nd-body font-medium text-nd-fg">
          <Icon icon={Target} size={16} className="text-nd-fg-3" />
          목표에서 거꾸로
        </span>
        <SegmentedControl<B2BBasis>
          size="sm"
          ariaLabel="목표 역산의 B2B 기준"
          value={basis}
          onChange={setBasis}
          options={(["booked", "usual"] as B2BBasis[]).map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-nd-body">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-16">
            <NumberInput
              size="sm"
              value={target}
              onValueChange={(v) => setTarget(Math.max(1, Math.min(r.months.length, Math.round(Number(v) || 1))))}
              className="text-right"
              aria-label="목표 런웨이 개월"
            />
          </span>
          개월을 버티려면
        </span>
        <span className="inline-flex items-center gap-2">
          <Select size="sm" className="w-auto" value={startAt} onChange={(e) => setGoalFrom(e.target.value)} aria-label="더 줄이기 시작 달">
            {r.months.map((m) => (
              <option key={m} value={m}>
                {shortMonth(m)}
              </option>
            ))}
          </Select>
          부터
        </span>
        <span className="text-nd-fg">
          {need === null ? (
            sunkBefore ? (
              <>
                줄이기 전인 <b className="font-semibold text-nd-expense-text">{monthLabel(sunkBefore)}</b>에 이미 바닥납니다 — 시작 달을
                앞당기거나, 그 전에 들어올 돈(B2B 받을 날 · 가정)이 있어야 합니다.
              </>
            ) : (
              <>시작 현금이 이미 0 아래라 줄이기만으로는 안 됩니다.</>
            )
          ) : need === 0 ? (
            <>{scenario ? `「${scenario.name}」` : "지금"} 그대로 이미 버팁니다.</>
          ) : (
            <>
              {scenario && scenario.cuts.length > 0 ? "이 시나리오에서 " : ""}매달{" "}
              <b className="font-semibold text-nd-expense-text">{shortWon(need)}원</b>을 더 줄여야 합니다
              {remainingExpense > 0 && (
                <span className="text-nd-fg-2">
                  {" "}
                  — 남은 지출(월 {shortWon(remainingExpense)})의 {((need / remainingExpense) * 100).toFixed(0)}%
                </span>
              )}
              {need > remainingExpense && (
                <Badge tone="danger" className="ml-2">
                  지출을 다 없애도 모자람 — 수입을 늘려야 합니다
                </Badge>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ---- 어디를 줄일까 --------------------------------------------------------

export function CutTable({ ed, className }: { ed: CutEditor; className?: string }) {
  const { r, sim, cuts } = ed;
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const lineOn = (major: string) => r.lines.find((l) => l.key === `out:${major}`)?.on ?? false;
  const rows: ExpenseNode[] = [];
  const walk = (list: ExpenseNode[]) =>
    list.forEach((nd) => {
      rows.push(nd);
      if (nd.children.length && open.has(nd.path)) walk(nd.children);
    });
  walk(r.expenseTree);
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Card id="runway-cuts" padding="none" className={cn("overflow-hidden", className)}>
      <div className="px-5 pt-5">
        <SectionHeader
          title="어디를 줄일까"
          hint={
            ed.scenario
              ? `「${ed.scenario.name}」 을 고치는 중 · 계정을 펼쳐 대·중·소 어느 단계에서든 줄입니다 · 아래 단계에 따로 적으면 그게 이깁니다`
              : "줄이면 새 시나리오가 만들어집니다 · 계정을 펼쳐 대·중·소 어느 단계에서든 줄입니다"
          }
          action={
            <span className="text-nd-body">
              매달 아끼는 돈{" "}
              <Money value={sim.savingFull} flow={sim.savingFull > 0 ? "income" : undefined} className="font-semibold" />
            </span>
          }
        />
        <GoalSeek ed={ed} className="mb-4" />
      </div>
      {r.expenseTree.length === 0 ? (
        <EmptyState compact icon={Scissors} title="최근 지출이 없습니다" className="mb-5" />
      ) : (
        <TableScroll>
          <Table dense minWidth={760}>
            <thead>
              <tr>
                <Th sticky="left" className="min-w-[14rem] pl-5">
                  계정
                </Th>
                <Th align="right">월 평균</Th>
                <Th className="min-w-[15rem]">줄이기</Th>
                <Th>언제부터</Th>
                <Th align="right" className="pr-5">
                  매달 아끼는 돈
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((nd) => {
                const own = cuts.get(nd.path);
                const up = ed.inherited(nd.path);
                const major = nd.path.split("|")[0];
                const disabled = nd.avg <= 0 || !lineOn(major);
                const pct = own?.pct ?? up?.pct ?? 0;
                const saving = sim.savingByPath.get(nd.path) ?? 0;
                // 「임차료」 는 일반운영비에도 홍대공용운영비에도 있다 — 단추 이름은 경로 전체로
                const name = nd.path.split("|").join(" › ");
                return (
                  <tr key={nd.path} className={cn("border-b border-nd-line", nd.level === 0 && "bg-nd-sunken", disabled && "text-nd-fg-3")}>
                    <Td sticky="left" className={cn("pl-5", nd.level === 0 && "bg-nd-sunken font-medium")}>
                      <div className="flex items-center gap-1" style={{ paddingLeft: nd.level * 16 }}>
                        {nd.children.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggle(nd.path)}
                            aria-expanded={open.has(nd.path)}
                            aria-label={`${name} ${open.has(nd.path) ? "접기" : "펼치기"}`}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-nd-fg-3 hover:bg-nd-fg/[.06]"
                          >
                            <Icon icon={ChevronRight} size={14} className={cn("transition-transform", open.has(nd.path) && "rotate-90")} />
                          </button>
                        ) : (
                          <span className="w-6 shrink-0" />
                        )}
                        <span className="truncate">{nd.label}</span>
                        {disabled && nd.avg > 0 && <span className="ml-1 text-nd-caption">(예측에서 끈 줄)</span>}
                      </div>
                    </Td>
                    <Td num muted>
                      {man(nd.avg)}
                    </Td>
                    <Td>
                      {disabled ? (
                        <span className="text-nd-caption">–</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={pct}
                            onChange={(e) => ed.setPct(nd.path, Number(e.target.value))}
                            aria-label={`${name} 줄이는 비율`}
                            className={cn("h-1.5 w-28 cursor-pointer accent-nd-accent", !own && "opacity-50")}
                          />
                          <span className="inline-block w-14">
                            <NumberInput
                              size="sm"
                              value={own ? own.pct : ""}
                              placeholder={up ? String(up.pct) : "0"}
                              onValueChange={(v) => (v === "" ? ed.clearCut(nd.path) : ed.setPct(nd.path, Number(v)))}
                              className="text-right"
                              aria-label={`${name} 줄이는 %`}
                            />
                          </span>
                          <span className="text-nd-caption text-nd-fg-3">%</span>
                          {own ? (
                            <IconButton icon={RotateCcw} size="sm" label={`${name} 줄이기 지우기`} onClick={() => ed.clearCut(nd.path)} />
                          ) : up ? (
                            <span className="text-nd-caption text-nd-fg-3">위에서</span>
                          ) : null}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {own ? (
                        <Select size="sm" className="w-auto" value={own.from} onChange={(e) => ed.setFrom(nd.path, e.target.value)} aria-label={`${name} 언제부터`}>
                          {!r.months.includes(own.from) && <option value={own.from}>{shortMonth(own.from)}</option>}
                          {r.months.map((m) => (
                            <option key={m} value={m}>
                              {shortMonth(m)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-nd-caption text-nd-fg-3">{up ? shortMonth(up.from) : "–"}</span>
                      )}
                    </Td>
                    <Td num className="pr-5">
                      {Math.round(saving / 10_000) === 0 ? (
                        <span className="text-nd-fg-4">–</span>
                      ) : (
                        <Money value={Math.round(saving / 10_000)} unit={false} flow="income" className={cn(nd.level === 0 && "font-semibold")} />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}
      <TableNote className="border-t border-nd-line px-5 py-2.5">
        단위: 만원 · 월. 아끼는 돈은 줄이기가 모두 시작된 마지막 달 기준입니다. 예측의 가정(예: 와우 철수로 운영비가 줄어든 달)이 있으면 그
        달 금액에서 줄입니다. 4대보험처럼 급여를 따라 움직이는 돈은 따로 줄여야 합니다.
      </TableNote>
    </Card>
  );
}

// ---- 시나리오 견주기 ------------------------------------------------------

export function ScenarioCompare({ ed, className }: { ed: CutEditor; className?: string }) {
  const { r, base, all } = ed;
  if (all.length === 0) return null;
  const h = r.months.length;
  const cell = (o: RunwayOutcome) => (
    <>
      {runwayMonths(o, h)}개월
      <div className="text-nd-caption text-nd-fg-3">{o.zeroMonth ? `${shortMonth(o.zeroMonth)} 바닥` : "안 바닥남"}</div>
    </>
  );
  const row = (key: string, name: string, s: SimResult, count: number | null, selected: boolean, onClick: () => void) => (
    <tr
      key={key}
      onClick={onClick}
      className={cn("cursor-pointer border-b border-nd-line last:border-b-0 hover:bg-nd-fg/[.03]", selected && "bg-nd-accent-soft/60")}
    >
      <Td className="pl-5 font-medium">{name}</Td>
      <Td num muted>
        {count ?? "–"}
      </Td>
      <Td num>
        {s.savingFull > 0 ? <Money value={s.savingFull} unit={false} flow="income" /> : <span className="text-nd-fg-4">–</span>}
      </Td>
      <Td num>{cell(s.outcome)}</Td>
      <Td num className="pr-5">
        {cell(s.outcomeAlt)}
      </Td>
    </tr>
  );
  return (
    <Card padding="none" className={cn("overflow-hidden", className)}>
      <div className="px-5 pt-5">
        <SectionHeader title="시나리오 견주기" hint="줄을 누르면 그 시나리오가 화면에 얹힙니다" />
      </div>
      <TableScroll>
        <Table dense minWidth={640}>
          <thead>
            <tr>
              <Th className="pl-5">시나리오</Th>
              <Th align="right">줄인 계정</Th>
              <Th align="right">매달 아끼는 돈</Th>
              <Th align="right">잡힌 돈만</Th>
              <Th align="right" className="pr-5">
                평소만큼 수주
              </Th>
            </tr>
          </thead>
          <tbody>
            {row("none", "줄이지 않음", base, null, !ed.scenario, () => ed.select(null))}
            {all.map(({ sc, sim }) =>
              row(sc.id, sc.name || "(이름 없음)", sim, sc.cuts.filter((c) => c.pct > 0).length, sc.id === ed.selectedId, () => ed.select(sc.id)),
            )}
          </tbody>
        </Table>
      </TableScroll>
    </Card>
  );
}
