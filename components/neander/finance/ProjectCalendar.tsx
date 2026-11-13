"use client";

// ============================================================
//  프로젝트 달력 — 프로젝트 목록 맨 위
// ------------------------------------------------------------
//  한 달에 어떤 프로젝트가 언제 돌아가는지, 납기가 언제인지, 그날 장비가
//  모자라지 않는지 한눈에 — 12월처럼 행사가 몰리면 여기서 겹침이 보인다.
//
//  · 진행 기간 = 날짜를 가로지르는 막대. 심사 중은 점선(아직 안 정해짐),
//    진행 중은 파랑, 완료는 초록.
//  · 납기 = 깃발. 기간 안이면 막대 위에, 밖이면(전날 설치 등) 따로 한 칸.
//  · 시작일만 있는 건(월 대행 · 문의 받은 날만 적힌 건)은 「시작」 한 칸.
//  · 장비 — 날짜 옆에 그날 쓰는 포토부스 · 키오스크 대수 / 보유 대수.
//    보유를 넘는 날은 칸이 붉고, 달력 위에 그 날들과 겹친 프로젝트를 적는다.
//  · 막대를 누르면 장비 배정 창 — 대수를 바꾸면 겹침을 미리 보여 주고 저장한다.
//    프로젝트로 가는 길은 그 창 안에.
//
//  무엇을 그릴지는 목록과 같다 — 상태 탭 · 검색 · 열 필터를 그대로 따른다
//  (projects). 장비 겹침은 거름과 상관없이 취소를 뺀 모든 프로젝트로 센다
//  (allProjects) — 「진행 중」 탭만 보고 있어도 심사 중 건과 겹치면 알려야 한다.
//  넓은 화면은 달력 칸, 좁은 화면은 그 달의 일정 목록. 접어 둘 수 있다.
//  계산은 lib/neander/finance/project-calendar.ts · equipment.ts.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronUp, Flag } from "lucide-react";
import { Button, Card, DateStepper, Dialog, Icon, SectionHeader, buttonClass, cn, useStickyState, useToast } from "@/components/neander/ui";
import { EQUIPMENT_ICON, EquipmentConflictList, EquipmentStepper, mdDay, mdRange } from "@/components/neander/finance/EquipmentFields";
import { setFinProjectEquipment } from "@/lib/neander/finance/client";
import { monthLabel, shiftMonth, thisMonthStr, todayStrKST } from "@/lib/neander/format";
import {
  calName,
  itemsBetween,
  layoutWeek,
  monthWeeks,
  projectCalItems,
  type CalItem,
  type CalProject,
  type CalSegment,
} from "@/lib/neander/finance/project-calendar";
import {
  EQUIPMENT_KINDS,
  EQUIPMENT_LABEL,
  EQUIPMENT_OWNED,
  conflictsBetween,
  equipmentByDay,
  equipmentConflicts,
  equipmentRange,
  equipmentText,
  hasEquipment,
  type EquipmentDay,
  type ProjectEquipment,
} from "@/lib/neander/finance/equipment";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const STATUS_LABEL: Record<string, string> = { planning: "심사 중", active: "진행 중", done: "완료" };

/** 상태별 막대 모양 — 같은 계열을 옅게만 깔면 구분이 안 돼 심사 중은 점선으로 */
const BAR_CLS: Record<string, string> = {
  planning: "border border-dashed border-nd-fg-3 bg-nd-content text-nd-fg",
  active: "border border-nd-accent/40 bg-nd-accent-soft text-nd-accent-strong",
  done: "border border-nd-success/40 bg-nd-success-soft text-nd-success-text",
};
const barCls = (status: string) => BAR_CLS[status] ?? "border border-nd-line bg-nd-fg/[.07] text-nd-fg-2";
const DELIVERY_CLS = "border border-nd-warning/50 bg-nd-warning-soft text-nd-warning-text";

const LANE_PX = 26;

function itemTitle(it: CalItem): string {
  const p = it.project;
  const period = p.startDate || p.endDate ? `진행 ${p.startDate ? mdDay(p.startDate) : "?"} ~ ${p.endDate ? mdDay(p.endDate) : "?"}` : "진행 기간 없음";
  return [
    `${p.code} · ${p.name}`,
    `${STATUS_LABEL[p.status] ?? p.status} · ${period}`,
    p.deliveryDate ? `납기 ${mdDay(p.deliveryDate)}` : "납기 없음",
    hasEquipment(p.equipment) ? `장비 ${equipmentText(p.equipment)}` : "장비 배정 없음",
  ].join("\n");
}

function itemLabel(it: CalItem): string {
  const name = calName(it.project.name);
  if (it.kind === "delivery") return `납기 · ${name}`;
  if (it.kind === "start") return `시작 · ${name}`;
  if (it.kind === "end") return `종료 · ${name}`;
  return name;
}

/** 막대 끝의 장비 표시 — 아이콘 + 대수 */
function EquipmentMarks({ equipment }: { equipment?: ProjectEquipment }) {
  if (!hasEquipment(equipment)) return null;
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1.5 opacity-90" aria-label={`장비 ${equipmentText(equipment)}`}>
      {EQUIPMENT_KINDS.filter((k) => (equipment?.[k] ?? 0) > 0).map((k) => (
        <span key={k} className="inline-flex items-center gap-0.5">
          <Icon icon={EQUIPMENT_ICON[k]} size={13} />
          <span className="nd-num">{equipment![k]}</span>
        </span>
      ))}
    </span>
  );
}

/** 주 줄 위의 막대 하나 — 누르면 장비 배정 창 */
function Bar({ seg, onPick }: { seg: CalSegment; onPick: (p: CalProject) => void }) {
  const { item, startCol, endCol, lane, contLeft, contRight, deliveryCol } = seg;
  const span = endCol - startCol + 1;
  const isDelivery = item.kind === "delivery";
  const flagAt = deliveryCol !== undefined ? deliveryCol - startCol : -1;
  return (
    <button
      type="button"
      onClick={() => onPick(item.project)}
      title={itemTitle(item)}
      aria-label={`${itemLabel(item)} — ${itemTitle(item).replace(/\n/g, " · ")}`}
      data-cal-item={item.kind}
      style={{ gridColumn: `${startCol + 1} / span ${span}`, gridRow: lane + 2 }}
      className={cn(
        "relative z-[1] mx-1 my-[2px] flex min-w-0 items-center overflow-hidden whitespace-nowrap px-1.5 text-left text-[13px] font-medium leading-none transition-[filter] duration-nd-fast hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent/50",
        isDelivery ? DELIVERY_CLS : barCls(item.project.status),
        contLeft ? "-ml-px rounded-l-none border-l-0" : "rounded-l-md",
        contRight ? "-mr-px rounded-r-none border-r-0" : "rounded-r-md",
      )}
    >
      {isDelivery && <Icon icon={Flag} size={13} className="mr-1 shrink-0" />}
      {/* 기간 안 납기 — 그 날 자리에 깃발. 첫날이면 이름 앞에 둔다 */}
      {flagAt === 0 && <Icon icon={Flag} size={13} className="mr-1 shrink-0 text-nd-warning-text" aria-label="납기" />}
      <span className="min-w-0 truncate">{contLeft ? `← ${itemLabel(item)}` : itemLabel(item)}</span>
      {!isDelivery && <EquipmentMarks equipment={item.project.equipment} />}
      {flagAt > 0 && (
        <span
          aria-label="납기"
          className="absolute inset-y-0 flex items-center justify-center"
          style={{ left: `calc(${flagAt} * 100% / ${span})`, width: `calc(100% / ${span})` }}
        >
          <span className="rounded-sm bg-nd-warning-soft px-0.5">
            <Icon icon={Flag} size={13} className="text-nd-warning-text" />
          </span>
        </span>
      )}
    </button>
  );
}

/** 날짜 옆 — 그날 쓰는 대수 / 보유 대수. 넘치면 붉게 */
function DayLoad({ day }: { day: EquipmentDay | undefined }) {
  if (!day) return null;
  const kinds = EQUIPMENT_KINDS.filter((k) => day.used[k] > 0);
  if (kinds.length === 0) return null;
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1">
      {kinds.map((k) => {
        const over = day.used[k] > EQUIPMENT_OWNED[k];
        return (
          <span
            key={k}
            data-equip-load={over ? "over" : "ok"}
            title={`${EQUIPMENT_LABEL[k]} ${day.used[k]}대 사용 · 보유 ${EQUIPMENT_OWNED[k]}대\n${day.users[k].map((u) => `${calName(u.name)} ${u.count}`).join("\n")}`}
            aria-label={`${EQUIPMENT_LABEL[k]} ${day.used[k]}대 사용, 보유 ${EQUIPMENT_OWNED[k]}대${over ? " — 모자람" : ""}`}
            className={cn(
              "nd-num inline-flex items-center gap-0.5 rounded px-1 py-px text-[13px] leading-tight",
              over ? "bg-nd-danger font-semibold text-white" : "bg-nd-fg/[.06] text-nd-fg-2",
            )}
          >
            <Icon icon={EQUIPMENT_ICON[k]} size={13} />
            {day.used[k]}/{EQUIPMENT_OWNED[k]}
          </span>
        );
      })}
    </span>
  );
}

/** 막대를 누르면 — 장비 대수를 바꾸고, 바꾼 대수로 겹침을 미리 본다 */
function EquipmentDialog({
  project,
  allProjects,
  onClose,
  onSaved,
}: {
  project: CalProject;
  allProjects: CalProject[];
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ProjectEquipment | undefined>(project.equipment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const range = equipmentRange(project);
  const changed = equipmentText(draft) !== equipmentText(project.equipment);
  const preview = useMemo(() => {
    const list = allProjects.some((p) => p.id === project.id)
      ? allProjects.map((p) => (p.id === project.id ? { ...p, equipment: draft } : p))
      : [...allProjects, { ...project, equipment: draft }];
    return equipmentConflicts(equipmentByDay(list)).filter((c) => c.users.some((u) => u.id === project.id));
  }, [allProjects, project, draft]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setFinProjectEquipment(project.id, draft ?? {});
      await onSaved?.();
      toast.success(hasEquipment(draft) ? `장비 배정을 저장했습니다 — ${equipmentText(draft)}` : "장비 배정을 지웠습니다");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={calName(project.name)}
      description={[
        project.code,
        STATUS_LABEL[project.status] ?? project.status,
        project.startDate || project.endDate ? `진행 ${mdRange(project.startDate ?? project.endDate!, project.endDate ?? project.startDate!)}` : null,
        project.deliveryDate ? `납기 ${mdDay(project.deliveryDate)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      footer={
        <>
          <Link href={`/neander/finance/projects/${project.id}`} className={buttonClass("ghost", "md", "mr-auto")}>
            프로젝트 열기 <Icon icon={ArrowUpRight} size={15} />
          </Link>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            닫기
          </Button>
          <Button onClick={save} loading={saving} disabled={!changed}>
            저장
          </Button>
        </>
      }
    >
      <h3 className="mb-2.5 text-[14px] font-semibold text-nd-fg">장비 배정</h3>
      <EquipmentStepper value={draft} onChange={setDraft} disabled={saving} />
      <p className="mt-3 text-[13px] text-nd-fg-2">
        {range
          ? `쓰는 날 ${mdRange(range.from, range.to)} — 설치 첫날(납기)부터 행사 끝날까지로 셉니다.`
          : "진행 기간 · 납기가 없어 겹침을 셀 수 없습니다."}
      </p>
      <div className="mt-3">
        {preview.length > 0 ? (
          <EquipmentConflictList conflicts={preview} me={project.id} name={calName} />
        ) : hasEquipment(draft) && range ? (
          <p className="text-[14px] text-nd-success-text">겹쳐서 모자라는 날이 없습니다.</p>
        ) : null}
      </div>
      {error && <p className="mt-3 text-[14px] text-nd-danger-text">{error}</p>}
    </Dialog>
  );
}

export function ProjectCalendar({
  projects,
  allProjects,
  onChanged,
  className,
}: {
  /** 그릴 프로젝트 — 목록의 탭 · 검색 · 열 필터를 거친 것 */
  projects: CalProject[];
  /** 장비 겹침을 셀 프로젝트 — 거름과 상관없이 전부(취소는 알아서 뺀다). 없으면 projects */
  allProjects?: CalProject[];
  /** 장비 배정을 저장한 뒤 — 목록을 다시 읽는다 */
  onChanged?: () => Promise<void> | void;
  className?: string;
}) {
  const [open, setOpen] = useStickyState("finance.projects.calendarOpen", true);
  const [month, setMonth] = useState(thisMonthStr);
  const [picked, setPicked] = useState<CalProject | null>(null);
  const today = todayStrKST();
  const everyone = allProjects ?? projects;

  const { items, undated } = useMemo(() => projectCalItems(projects), [projects]);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const rows = useMemo(() => weeks.map((week) => ({ week, ...layoutWeek(week, items) })), [weeks, items]);
  const monthItems = useMemo(
    () => itemsBetween(items, `${month}-01`, `${month}-31`).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    [items, month],
  );

  const byDay = useMemo(() => equipmentByDay(everyone), [everyone]);
  const conflicts = useMemo(() => equipmentConflicts(byDay), [byDay]);
  const viewFrom = weeks[0]?.[0] ?? `${month}-01`;
  const viewTo = weeks.at(-1)?.at(-1) ?? `${month}-31`;
  const viewConflicts = useMemo(() => conflictsBetween(conflicts, viewFrom, viewTo), [conflicts, viewFrom, viewTo]);
  const ahead = useMemo(() => conflicts.filter((c) => c.to >= today), [conflicts, today]);
  /** 다른 달의 겹침도 놓치지 않게 — 지금 보는 달 밖, 오늘 이후 */
  const elsewhere = ahead.filter((c) => !viewConflicts.includes(c));

  return (
    <Card as="section" aria-label="프로젝트 달력" className={cn("min-w-0", className)}>
      <SectionHeader
        title="프로젝트 달력"
        hint={
          <>
            {open ? `${monthLabel(month)} · ${new Set(monthItems.map((i) => i.project.id)).size}건` : "진행 기간 · 납기 · 장비"}
            {ahead.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 font-semibold text-nd-danger-text">
                <Icon icon={AlertTriangle} size={14} />
                장비 겹침 {ahead.length}건
              </span>
            )}
          </>
        }
        className={open ? undefined : "mb-0"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {open && (
              <DateStepper
                size="sm"
                label={monthLabel(month)}
                onPrev={() => setMonth((m) => shiftMonth(m, -1))}
                onNext={() => setMonth((m) => shiftMonth(m, 1))}
                prevLabel="이전 달"
                nextLabel="다음 달"
                onToday={month === thisMonthStr() ? undefined : () => setMonth(thisMonthStr())}
                todayLabel="이번 달"
              />
            )}
            <Button variant="ghost" size="sm" icon={open ? ChevronUp : ChevronDown} onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "접기" : "펼치기"}
            </Button>
          </div>
        }
      />

      {open && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-nd-fg-2" aria-label="달력 보는 법">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("h-3.5 w-6 rounded", BAR_CLS.planning)} />심사 중</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("h-3.5 w-6 rounded", BAR_CLS.active)} />진행 중</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("h-3.5 w-6 rounded", BAR_CLS.done)} />완료</span>
            <span className="inline-flex items-center gap-1.5"><Icon icon={Flag} size={13} className="text-nd-warning-text" />납기</span>
            {EQUIPMENT_KINDS.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <Icon icon={EQUIPMENT_ICON[k]} size={13} />
                {EQUIPMENT_LABEL[k]} 보유 {EQUIPMENT_OWNED[k]}
              </span>
            ))}
            <span className="text-nd-fg-3">날짜 옆 숫자 = 그날 쓰는 대수/보유 · 막대를 누르면 장비 배정</span>
          </div>

          {viewConflicts.length > 0 && (
            <div className="mb-3" role="alert">
              <p className="mb-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-nd-danger-text">
                <Icon icon={AlertTriangle} size={16} />
                {monthLabel(month)} 장비가 모자라는 날 {viewConflicts.length}건
              </p>
              <EquipmentConflictList conflicts={viewConflicts} name={calName} />
            </div>
          )}
          {elsewhere.length > 0 && (
            <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-danger-text">
              <Icon icon={AlertTriangle} size={14} />
              다른 달에도 장비 겹침이 있습니다 —
              {[...new Set(elsewhere.map((c) => c.from.slice(0, 7)))].map((m) => (
                <button key={m} type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setMonth(m)}>
                  {monthLabel(m)}
                </button>
              ))}
            </p>
          )}

          {/* 넓은 화면 — 주마다 한 줄. 날짜 칸은 줄 전체를 덮고, 막대는 그 위 lane 에 */}
          <div className="hidden overflow-hidden rounded-nd-md border border-nd-line md:block">
            <div className="grid grid-cols-7 border-b border-nd-line bg-nd-sunken text-center text-[13px] font-medium text-nd-fg-2">
              {WEEK.map((w, i) => (
                <div key={w} className={cn("py-1.5", i === 0 && "text-nd-danger-text", i === 6 && "text-nd-info-text")}>
                  {w}
                </div>
              ))}
            </div>
            {rows.map(({ week, segments, lanes }) => (
              <div
                key={week[0]}
                className="grid grid-cols-7 border-b border-nd-line last:border-b-0"
                // repeat(0, …) 은 CSS 가 버린다 — 막대 없는 주는 날짜 줄만
                style={{ gridTemplateRows: `30px ${lanes > 0 ? `repeat(${lanes}, ${LANE_PX}px) ` : ""}minmax(10px, 1fr)`, minHeight: 30 + Math.max(lanes, 2) * LANE_PX + 10 }}
              >
                {week.map((date, i) => {
                  const inMonth = date.slice(0, 7) === month;
                  const isToday = date === today;
                  const day = byDay.get(date);
                  const over = !!day && EQUIPMENT_KINDS.some((k) => day.used[k] > EQUIPMENT_OWNED[k]);
                  return (
                    <div
                      key={date}
                      aria-current={isToday ? "date" : undefined}
                      data-cal-day={date}
                      data-equip-over={over ? "true" : undefined}
                      style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                      className={cn(
                        "relative min-w-0 border-r border-nd-line last:border-r-0",
                        !inMonth && "bg-nd-sunken/60",
                        isToday && "bg-nd-accent-soft/40",
                        over && "bg-nd-danger-soft/60",
                      )}
                    >
                      {isToday && <span aria-hidden className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-nd-accent" />}
                      <div className="flex h-[30px] items-center gap-1 px-1.5">
                        <span
                          className={cn(
                            "nd-num inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-[13px] font-semibold",
                            isToday ? "bg-nd-accent text-white" : !inMonth ? "text-nd-fg-4" : i === 0 ? "text-nd-danger-text" : i === 6 ? "text-nd-info-text" : "text-nd-fg",
                          )}
                        >
                          {Number(date.slice(8))}
                        </span>
                        {isToday && <span className="shrink-0 text-[13px] font-semibold text-nd-accent-strong">오늘</span>}
                        <DayLoad day={day} />
                      </div>
                    </div>
                  );
                })}
                {segments.map((seg) => (
                  <Bar key={`${seg.item.key}:${week[0]}`} seg={seg} onPick={setPicked} />
                ))}
              </div>
            ))}
          </div>

          {/* 좁은 화면 — 그 달에 걸친 것만 날짜 순으로 */}
          <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line md:hidden">
            {monthItems.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-nd-fg-3">{monthLabel(month)}에 걸친 프로젝트가 없습니다.</li>}
            {monthItems.map((it) => (
              <li key={it.key}>
                <button type="button" onClick={() => setPicked(it.project)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-nd-sunken">
                  <span aria-hidden className={cn("mt-0.5 h-4 w-1.5 shrink-0 rounded-sm", it.kind === "delivery" ? DELIVERY_CLS : barCls(it.project.status))} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-nd-fg">{itemLabel(it)}</span>
                    <span className="block text-[13px] text-nd-fg-2">
                      {mdRange(it.from, it.to)}
                      {it.delivery ? ` · 납기 ${mdDay(it.delivery)}` : ""} · {STATUS_LABEL[it.project.status] ?? it.project.status}
                      {hasEquipment(it.project.equipment) ? ` · ${equipmentText(it.project.equipment)}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {undated.length > 0 && (
            <p className="mt-2 text-[13px] text-nd-fg-3" title={undated.map((u) => `${u.code} ${u.name}`).join("\n")}>
              진행 기간 · 납기가 비어 있는 {undated.length}건은 달력에 없습니다 — {undated.slice(0, 3).map((u) => calName(u.name)).join(", ")}
              {undated.length > 3 ? ` 외 ${undated.length - 3}건` : ""}
            </p>
          )}
        </>
      )}

      {picked && (
        <EquipmentDialog
          key={picked.id}
          project={everyone.find((p) => p.id === picked.id) ?? picked}
          allProjects={everyone}
          onClose={() => setPicked(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}
