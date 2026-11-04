"use client";

// ============================================================
//  AI STUDIO 일정 — 달력 (calendar.ts)
// ------------------------------------------------------------
//  손으로 적는 일정(촬영 · 미팅 · 마감·납품 · 기타)과 자료에서 저절로 모이는 일정을 한 달력에:
//  게시 예약 · 게시됨 · 고객 검토 · 승인 · 수정 요청 · 업체 계약 시작/끝 · 재무 회차(받을 날 · 받은 날) · 계약서 체결.
//  「지금 프로젝트」 / 「모든 프로젝트」 — 대행 프로젝트는 볼 수 있는 사람(관리자 · 담당자)에게만 온다.
//  재무 일정은 재무 권한이 있을 때만 · ERP 팀 일정은 고르면 겹쳐 본다(읽기만).
//  칩 앞에 무슨 일인지(「촬영 · 3화」 「게시 예약 · 선반 1편」) · 오늘은 테두리 + 「오늘」 글자.
//  넓은 화면은 달력 칸, 좁은 화면(모바일)은 날짜별 카드 목록. 아래 「다가오는 2주」 는 표(모바일은 카드).
//  손으로 적은 일정만 여기서 고치고 지운다(적은 사람 · 관리자 — 서버와 같은 규칙). 저절로 모인 일정은 원본에서.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, FolderOpen, PenLine, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, FormRow, Input, PageShell, SegmentedControl, Select, Textarea, buttonClass, cn, toneCls, useConfirm, type Tone } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { RecordTable, StudioCard, StudioHeader, StudioNotice, StudioSection, type RecordColumn } from "@/components/neander/shorts/studio";
import { subscribeSchedules } from "@/lib/neander/db/schedules";
import { monthGrid, monthLabel, shiftMonth, thisMonthStr } from "@/lib/neander/format";
import { mutate } from "@/lib/neander/shorts/client";
import { CAL_SOURCE_LABEL, EVENT_KIND_LABEL, EVENT_KINDS, autoItems, eventItem, itemsByDate, kstDate, type CalItem, type CalSource, type EventKind, type ShortsEventView } from "@/lib/neander/shorts/calendar";
import { spaceKind, spaceOf } from "@/lib/neander/shorts/spaces";
import type { Schedule } from "@/lib/neander/types";

type AutoSource = Exclude<CalSource, "manual">;

const KIND_TONE: Record<EventKind, Tone> = { shoot: "accent", meeting: "info", deadline: "warning", etc: "neutral" };
const SOURCE_TONE: Record<AutoSource, Tone> = {
  publish: "info",
  published: "success",
  review: "warning",
  approved: "success",
  revision: "danger",
  contract: "neutral",
  "finance-due": "warning",
  "finance-overdue": "danger",
  "finance-paid": "success",
  "finance-contract": "info",
  team: "neutral",
};
/** 칩 왼쪽 선 — 색만으로 말하지 않게 칩 글 앞에 종류가 늘 붙는다 */
const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-nd-fg-3",
  accent: "border-nd-accent",
  info: "border-nd-info",
  success: "border-nd-success",
  warning: "border-nd-warning",
  danger: "border-nd-danger",
};
const toneOf = (it: CalItem): Tone => (it.source === "manual" && it.event ? KIND_TONE[it.event.kind] : it.source === "manual" ? "neutral" : SOURCE_TONE[it.source]);
/** 무슨 일인지 — 손으로 적은 것은 종류(촬영 · 미팅 …), 저절로 모인 것은 출처(게시 예약 · 받을 돈 …) */
const kindLabel = (it: CalItem) => (it.source === "manual" && it.event ? EVENT_KIND_LABEL[it.event.kind] : CAL_SOURCE_LABEL[it.source]);
/** 칩 글 — 앞에 무슨 일인지. 저절로 모인 것은 calendar.ts 의 chip 이 이미 그렇게 생겼다 */
const chipText = (it: CalItem) => (it.source === "manual" && it.event ? `${EVENT_KIND_LABEL[it.event.kind]} · ${it.title}` : it.chip);

/** 저절로 모인 일정은 어디서 왔고 어디서 바꾸는가 — 자세히 창의 안내 · 원본 버튼 */
const ORIGIN: Record<AutoSource, { from: string; open: string; how: string }> = {
  publish: { from: "게시 기록", open: "게시 화면 열기", how: "예약 시각 · 올릴 계정은 영상의 게시 화면에서 바꿉니다. 원본에서 바꾸면 달력에도 그대로 반영됩니다." },
  published: { from: "게시 기록", open: "게시 화면 열기", how: "올라간 게시물 기록에서 모인 일정입니다. 게시 결과는 영상의 게시 화면에서 확인합니다." },
  review: { from: "고객 검토 기록", open: "고객 검토 열기", how: "검토를 보낸 기록입니다. 다시 보내기 · 답 확인은 영상의 고객 검토 화면에서 합니다." },
  approved: { from: "고객 검토 기록", open: "고객 검토 열기", how: "고객사가 승인한 기록입니다. 승인 내용은 영상의 고객 검토 화면에 남아 있습니다." },
  revision: { from: "고객 검토 기록", open: "고객 검토 열기", how: "고객사가 수정을 요청한 기록입니다. 요청 내용 확인 · 다음 검토는 영상의 고객 검토 화면에서 합니다." },
  contract: { from: "업체 계약", open: "업체 열기", how: "계약 시작 · 끝 달은 업체 화면의 계약에서 바꿉니다." },
  "finance-due": { from: "재무 입금 회차", open: "재무 프로젝트 열기", how: "받을 날 · 금액은 재무 프로젝트의 입금 회차에서 바꿉니다." },
  "finance-overdue": { from: "재무 입금 회차", open: "재무 프로젝트 열기", how: "받을 날이 지났는데 아직 받음으로 표시되지 않았습니다. 입금을 확인하면 재무 프로젝트의 입금 회차에서 받음으로 바꿉니다." },
  "finance-paid": { from: "재무 입금 회차", open: "재무 프로젝트 열기", how: "받음으로 표시된 입금 회차입니다. 고칠 것이 있으면 재무 프로젝트에서 바꿉니다." },
  "finance-contract": { from: "재무 계약서", open: "재무 프로젝트 열기", how: "계약서 체결일은 재무 프로젝트의 계약서에서 바꿉니다." },
  team: { from: "ERP 팀 일정", open: "팀 일정 열기", how: "ERP 팀 일정은 여기서 겹쳐 보기만 합니다. 바꾸려면 ERP 일정 화면에서 바꿉니다." },
};

/** 고를 수 있는 묶음 */
const GROUPS = [
  { key: "manual", label: "직접 적은 일정", sources: ["manual"] },
  { key: "publish", label: "게시 · 예약", sources: ["publish", "published"] },
  { key: "review", label: "고객 검토 · 승인", sources: ["review", "approved", "revision"] },
  { key: "contract", label: "업체 계약", sources: ["contract", "finance-contract"] },
  { key: "money", label: "받을 돈 · 받은 돈", sources: ["finance-due", "finance-overdue", "finance-paid"] },
  { key: "team", label: "ERP 팀 일정", sources: ["team"] },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 달력 칸에 바로 보이는 칩 수 — 넘치면 「+n개 더」 */
const CELL_MAX = 3;

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** 11/4 (수) */
const fmtDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))} (${weekdayOf(date)})`;
/** 11/4 (수) 10:00 · 11/4 (수) ~ 11/6 (금) 종일 */
const fmtWhenItem = (it: CalItem, date = it.date) => `${fmtDay(date)}${it.endDate && it.endDate > it.date ? ` ~ ${fmtDay(it.endDate)}` : ""} ${it.time ?? "종일"}`;

export default function CalendarPage() {
  const { data, space, currentSpace, nameOf } = useShorts();
  const d = data!;
  const [month, setMonth] = useState(thisMonthStr());
  const [scope, setScope] = useState<"here" | "all">("here");
  const [on, setOn] = useState<Record<GroupKey, boolean>>({ manual: true, publish: true, review: true, contract: true, money: true, team: false });
  const [team, setTeam] = useState<Schedule[]>([]);
  const [open, setOpen] = useState<CalItem | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ event: ShortsEventView | null; date: string } | null>(null);
  const today = kstDate(Date.now());

  // ERP 팀 일정 — 고를 때만 받는다 (읽기만)
  useEffect(() => {
    if (!on.team) return;
    return subscribeSchedules(setTeam);
  }, [on.team]);

  const groups = GROUPS.filter((g) => g.key !== "money" || d.financeAccess);
  const items = useMemo(() => {
    const here = (x: { spaceId?: string | null }) => scope === "all" || spaceOf(x) === space;
    const projects = d.projects.filter(here);
    const ids = new Set(projects.map((p) => p.id));
    // 업체 일정은 「지금 프로젝트」 가 그 업체의 대행 프로젝트일 때만 (모든 프로젝트면 볼 수 있는 업체 전부)
    const clients = scope === "all" ? d.clients : currentSpace && spaceKind(currentSpace) === "agency" ? d.clients.filter((c) => c.id === currentSpace.clientId) : [];
    // 받을 돈 · 받은 돈 금액 옆에 부가세 기준(재무 계약 그대로)을 붙인다 — calendar.ts 의 설명은 금액만 쓴다
    const vat = new Map<string, string>();
    for (const list of Object.values(d.clientFinance ?? {}))
      for (const f of list) for (const i of f.installments ?? []) for (const k of [`fp-${f.code}-${i.id}`, `fd-${f.code}-${i.id}`]) vat.set(k, f.vatMode === "included" ? "부가세 포함" : "부가세 별도");
    const auto = autoItems({ projects, publications: d.publications.filter((p) => ids.has(p.projectId)), clients, clientFinance: d.clientFinance, today }).map((it) => (vat.has(it.key) ? { ...it, detail: `${it.detail} · ${vat.get(it.key)}` } : it));
    const manual = d.events.filter(here).map(eventItem);
    const teamItems: CalItem[] = team.map((s) => ({
      key: `team-${s.id}`,
      date: s.date,
      title: s.title,
      chip: `팀 · ${s.title}`,
      detail: s.targetIds?.length ? `팀 일정 · ${s.targetIds.length}명` : "팀 일정",
      source: "team",
      href: "/neander/schedule",
    }));
    // 재무 일정(받을 돈 · 받은 돈)은 재무 권한이 있을 때만
    const allowed = new Set<CalSource>(GROUPS.filter((g) => on[g.key] && (g.key !== "money" || d.financeAccess)).flatMap((g) => [...g.sources]));
    return [...manual, ...auto, ...teamItems].filter((it) => allowed.has(it.source));
  }, [d, scope, space, currentSpace, on, team, today]);

  const cells = monthGrid(month);
  const first = `${month}-01`;
  const last = cells.filter(Boolean).at(-1) ?? first;
  const byDate = useMemo(() => itemsByDate(items, first, last as string), [items, first, last]);
  const monthItems = useMemo(() => [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])), [byDate]);
  const until = addDays(today, 14);
  // 다가오는 2주 — 일정 하나는 한 줄(여러 날 일정은 처음 걸친 날에). 지난 받을 돈(연체)은 맨 위에.
  const upcoming = useMemo(() => {
    const seen = new Set<string>();
    const out: { date: string; it: CalItem }[] = [];
    for (const it of items.filter((x) => x.source === "finance-overdue" && x.date < today).sort((a, b) => a.date.localeCompare(b.date))) {
      seen.add(it.key);
      out.push({ date: it.date, it });
    }
    for (const [date, list] of [...itemsByDate(items, today, until).entries()].sort((a, b) => a[0].localeCompare(b[0])))
      for (const it of list)
        if (!seen.has(it.key)) {
          seen.add(it.key);
          out.push({ date, it });
        }
    return out;
  }, [items, today, until]);

  const spaceName = (id?: string | null) => (id ? (d.spaces.find((s) => s.id === id)?.name ?? "") : "");
  const clientName = (id?: string | null) => (id ? (d.clients.find((c) => c.id === id)?.name ?? "") : "");
  /** 프로젝트 · 업체 칸 */
  const whereOf = (it: CalItem) => {
    if (it.source === "team") return "ERP 팀 일정";
    const parts = [it.spaceId ? spaceName(it.spaceId) : "", it.clientId ? clientName(it.clientId) : ""].filter(Boolean);
    return [...new Set(parts)].join(" · ") || "—";
  };
  const canEdit = (e: ShortsEventView) => e.createdBy === d.me || d.admin;
  const scopeText = scope === "all" ? "모든 프로젝트" : (currentSpace?.name ?? "지금 프로젝트");

  const columns: RecordColumn<{ date: string; it: CalItem }>[] = [
    {
      key: "when",
      header: "날짜 · 시각",
      mobile: "title",
      className: "w-[210px] whitespace-nowrap",
      cell: ({ date, it }) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="nd-num">{fmtWhenItem(it, date)}</span>
          {date === today && (
            <Badge tone="accent" size="lg">
              오늘
            </Badge>
          )}
          {it.source === "finance-overdue" && date < today && (
            <Badge tone="danger" size="lg">
              지남
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "what",
      header: "일정",
      cell: ({ it }) => (
        <span className="block min-w-0">
          <span className={cn("block font-semibold [overflow-wrap:anywhere]", it.source === "finance-overdue" ? "text-nd-danger-text" : "text-nd-fg")}>{it.source === "manual" ? it.title : it.chip}</span>
          {detailOf(it) && <span className="mt-0.5 block text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">{detailOf(it)}</span>}
        </span>
      ),
    },
    { key: "where", header: "프로젝트 · 업체", mobileLabel: "프로젝트 · 업체", cell: ({ it }) => <span className="[overflow-wrap:anywhere]">{whereOf(it)}</span> },
    {
      key: "kind",
      header: "종류",
      className: "w-[150px]",
      cell: ({ it }) => (
        <Badge tone={toneOf(it)} size="lg">
          {kindLabel(it)}
        </Badge>
      ),
    },
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="일정"
        description="촬영 · 미팅 · 마감을 적고, 게시 예약 · 고객 검토 · 업체 계약 · 받을 돈 같은 일정은 자료에서 저절로 모아 함께 봅니다. 대행 프로젝트 일정은 관리자와 그 업체 담당자에게만 보입니다."
        actions={
          <Button icon={Plus} onClick={() => setEditing({ event: null, date: today })}>
            일정 적기
          </Button>
        }
      />

      {/* 달 · 범위 · 종류 */}
      <StudioCard className="mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>
              <span className="hidden sm:inline">이전 달</span>
            </Button>
            <h2 className="min-w-[120px] flex-1 text-center text-[19px] font-bold text-nd-fg sm:flex-none" aria-live="polite">
              {monthLabel(month)}
            </h2>
            <Button size="sm" variant="ghost" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>
              <span className="hidden sm:inline">다음 달</span>
              <ChevronRight size={15} aria-hidden />
            </Button>
            <Button size="sm" variant="secondary" className="ml-1" onClick={() => setMonth(thisMonthStr())}>
              오늘
            </Button>
          </div>
          <SegmentedControl
            ariaLabel="어느 프로젝트"
            value={scope}
            onChange={(v) => setScope(v as "here" | "all")}
            className="self-start md:self-auto"
            options={[
              { value: "here", label: "지금 프로젝트" },
              { value: "all", label: "모든 프로젝트" },
            ]}
          />
        </div>
        <div className="mt-4 border-t border-nd-line pt-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2.5" role="group" aria-label="보일 일정 종류">
            {groups.map((g) => (
              <Checkbox key={g.key} checked={on[g.key]} onChange={(e) => setOn({ ...on, [g.key]: e.target.checked })} label={<span className="text-[14px]">{g.label}</span>} />
            ))}
          </div>
          <p className="mt-2 text-[13px] text-nd-fg-3">
            직접 적는 일정 · 촬영 / 미팅 / 마감·납품 / 기타{" "}
            <span aria-hidden className="mx-1.5 text-nd-fg-4">
              |
            </span>{" "}
            저절로 모이는 일정은 원본 기록이 바뀌면 함께 바뀝니다.
            {!d.financeAccess && " 받을 돈 · 받은 돈은 재무 권한이 있는 사람에게만 보입니다."}
          </p>
        </div>
      </StudioCard>

      {/* 넓은 화면 — 달력 */}
      <StudioCard className="mb-8 hidden md:block" bodyClassName="!p-4 sm:!p-5">
        <div className="overflow-hidden rounded-nd-md border border-nd-line">
          <div className="grid grid-cols-7 border-b border-nd-line bg-nd-sunken text-center text-[13px] font-medium text-nd-fg-2">
            {WEEK.map((w, i) => (
              <div key={w} className={cn("py-2.5", i === 0 && "text-nd-danger-text", i === 6 && "text-nd-info-text")}>
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              const list = date ? (byDate.get(date) ?? []) : [];
              const isToday = date === today;
              return (
                <div
                  key={i}
                  aria-current={isToday ? "date" : undefined}
                  className={cn("group relative min-h-[132px] min-w-0 border-b border-r border-nd-line p-2 [&:nth-child(7n)]:border-r-0", !date && "bg-nd-sunken/50", isToday && "bg-nd-accent-soft/30")}
                >
                  {isToday && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[2px] ring-2 ring-inset ring-nd-accent" />}
                  {date && (
                    <>
                      <div className="mb-1.5 flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "nd-num inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[14px] font-semibold",
                            isToday ? "bg-nd-accent text-white" : i % 7 === 0 ? "text-nd-danger-text" : i % 7 === 6 ? "text-nd-info-text" : "text-nd-fg",
                          )}
                        >
                          {Number(date.slice(8))}
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`${fmtDay(date)} 일정 적기`}
                            onClick={() => setEditing({ event: null, date })}
                            className="rounded p-1 text-nd-fg-3 opacity-0 hover:bg-nd-sunken hover:text-nd-fg focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <Plus size={15} />
                          </button>
                          {isToday && <span className="text-[13px] font-semibold text-nd-accent-strong">오늘</span>}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {list.slice(0, CELL_MAX).map((it) => (
                          <Chip key={`${it.key}-${date}`} it={it} onClick={() => setOpen(it)} />
                        ))}
                        {list.length > CELL_MAX && (
                          <button type="button" className="rounded px-1.5 py-0.5 text-[13px] font-medium text-nd-fg-2 hover:bg-nd-sunken hover:text-nd-fg" onClick={() => setMore(date)}>
                            +{list.length - CELL_MAX}개 더
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </StudioCard>

      {/* 좁은 화면 — 날짜별 카드 목록 */}
      <StudioCard className="mb-8 md:hidden" bodyClassName="!px-4 !pb-4 !pt-4">
        <StudioNotice tone="info" title={`${monthLabel(month)} · 날짜별 일정`} className="mb-3">
          {scopeText} · 직접 적은 일정과 저절로 모인 일정을 함께 보여 줍니다.
        </StudioNotice>
        {monthItems.length === 0 ? (
          <EmptyState compact icon={CalendarDays} title={`${monthLabel(month)} 일정이 없습니다`} description="「일정 적기」 로 촬영 · 미팅 · 마감을 적어 두세요." />
        ) : (
          <ol className="divide-y divide-nd-line">
            {monthItems.map(([date, list]) => (
              <li key={date} className="py-3.5 first:pt-1 last:pb-1" aria-current={date === today ? "date" : undefined}>
                <h3 className={cn("mb-2 flex items-center gap-2 text-[15px] font-bold", date === today ? "text-nd-accent-strong" : "text-nd-fg")}>
                  {fmtDay(date)}
                  {date === today && (
                    <Badge tone="accent" size="lg">
                      오늘
                    </Badge>
                  )}
                </h3>
                <div className="space-y-1.5">
                  {list.map((it) => (
                    <Chip key={`${it.key}-${date}`} it={it} onClick={() => setOpen(it)} roomy />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </StudioCard>

      <StudioSection title="다가오는 2주" icon={CalendarDays} description={`${fmtDay(today)} ~ ${fmtDay(until)} · ${scopeText} · 게시 · 고객 검토 · 계약과 받을 돈까지 함께 (지난 받을 돈은 맨 위)`} className="mb-6">
        <StudioCard flush bodyClassName="p-3 md:p-0">
          <RecordTable
            rows={upcoming}
            columns={columns}
            rowKey={({ date, it }) => `${it.key}-${date}`}
            onRowClick={({ it }) => setOpen(it)}
            ariaLabel="다가오는 2주 일정"
            empty={
              <EmptyState compact icon={CalendarDays} title="다가오는 2주에 일정이 없습니다" description={scope === "here" ? "「모든 프로젝트」 로 바꾸면 다른 프로젝트 일정도 함께 봅니다." : "「일정 적기」 로 촬영 · 미팅 · 마감을 적어 두세요."} />
            }
          />
        </StudioCard>
      </StudioSection>

      <StudioNotice tone="info" title="저절로 모이는 일정">
        게시 예약 · 게시됨 · 고객 검토 보냄 · 승인 · 수정 요청 · 업체 계약 시작/끝{d.financeAccess ? " · 받을 돈(연체는 빨강) · 받은 돈" : ""} · 계약서 체결. 바꾸려면 원본 화면에서 바꿉니다. ERP 팀 일정은 겹쳐 보기만 합니다.
      </StudioNotice>

      {more && <DayDialog date={more} items={byDate.get(more) ?? []} onClose={() => setMore(null)} onPick={(it) => (setMore(null), setOpen(it))} />}
      {open && (
        <ItemDialog
          it={open}
          where={whereOf(open)}
          spaceName={spaceName}
          clientName={clientName}
          nameOf={nameOf}
          canEdit={!!open.event && canEdit(open.event)}
          onClose={() => setOpen(null)}
          onEdit={(e) => {
            setOpen(null);
            setEditing({ event: e, date: e.date });
          }}
        />
      )}
      {editing && <EventDialog initial={editing.event} date={editing.date} canDelete={!!editing.event && canEdit(editing.event)} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}

/** 표 · 자세히 창의 한 줄 더 — 손으로 적은 것은 메모, 저절로 모인 것은 calendar.ts 의 설명 */
function detailOf(it: CalItem): string {
  if (it.source === "manual") return it.event?.note ? it.event.note.replace(/\s+/g, " ").slice(0, 80) : "";
  return it.detail;
}

function Chip({ it, onClick, roomy = false }: { it: CalItem; onClick: () => void; roomy?: boolean }) {
  const tone = toneOf(it);
  const t = toneCls[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${chipText(it)} — ${it.detail}`}
      className={cn("flex w-full min-w-0 rounded-[6px] border-l-[3px] text-left text-[13px] leading-snug transition-[filter] hover:brightness-95", roomy ? "px-2.5 py-2 text-[14px]" : "px-2 py-1", t.soft, t.text, TONE_BORDER[tone])}
    >
      <span className={cn("min-w-0 [overflow-wrap:anywhere]", !roomy && "line-clamp-2")}>
        {it.time && <span className="nd-num mr-1 font-semibold">{it.time}</span>}
        {chipText(it)}
        {/* 모바일 카드에는 한 줄 더 — 같은 영상의 YouTube · Instagram 게시가 나란히 있어도 구분되게 */}
        {roomy && detailOf(it) && <span className="mt-0.5 block text-[13px] text-nd-fg-3">{detailOf(it)}</span>}
      </span>
    </button>
  );
}

/** 같은 날 일정이 많을 때 — 「+n개 더」 */
function DayDialog({ date, items, onClose, onPick }: { date: string; items: CalItem[]; onClose: () => void; onPick: (it: CalItem) => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${fmtDay(date)} 일정 · ${items.length}개`}
      description="누르면 자세히 봅니다. 저절로 모인 일정은 자세히 창에서 원본으로 갑니다."
      footer={
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <ul className="divide-y divide-nd-line">
        {items.map((x) => (
          <li key={x.key}>
            <button type="button" onClick={() => onPick(x)} className="flex w-full min-w-0 items-start gap-3 rounded-nd-md px-1 py-2.5 text-left hover:bg-nd-sunken">
              <Badge tone={toneOf(x)} size="lg" className="shrink-0">
                {kindLabel(x)}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-nd-body font-semibold text-nd-fg [overflow-wrap:anywhere]">
                  {x.time && <span className="nd-num mr-1.5 text-nd-fg-2">{x.time}</span>}
                  {x.source === "manual" ? x.title : x.chip}
                </span>
                {detailOf(x) && <span className="block text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">{detailOf(x)}</span>}
              </span>
              <ChevronRight size={16} aria-hidden className="mt-1 shrink-0 text-nd-fg-4" />
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** 일정 자세히 — 손으로 적은 것은 고치기 · 지우기(적은 사람 · 관리자), 저절로 모인 것은 원본으로 */
function ItemDialog({
  it,
  where,
  spaceName,
  clientName,
  nameOf,
  canEdit,
  onClose,
  onEdit,
}: {
  it: CalItem;
  where: string;
  spaceName: (id?: string | null) => string;
  clientName: (id?: string | null) => string;
  nameOf: (e: string) => string;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (e: ShortsEventView) => void;
}) {
  const { refresh } = useShorts();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const e = it.event;
  const origin = it.source === "manual" ? null : ORIGIN[it.source];
  const del = async () => {
    if (!e || !(await ask({ title: "이 일정을 지울까요?", message: e.title, tone: "danger", confirmLabel: "지우기" }))) return;
    await run(
      "del",
      async () => {
        await mutate("event.delete", { id: e.id });
        await refresh();
        onClose();
      },
      "일정을 지웠습니다.",
    );
  };
  const rows: [string, string][] = [
    [it.time ? "날짜 · 시각" : "날짜", fmtWhenItem(it)],
    ["종류", kindLabel(it)],
    ...(it.spaceId ? ([["프로젝트", spaceName(it.spaceId)]] as [string, string][]) : []),
    ...(it.clientId ? ([["업체", clientName(it.clientId)]] as [string, string][]) : []),
    ...(!it.spaceId && !it.clientId ? ([["어디", where]] as [string, string][]) : []),
    ...(origin ? ([["내용", it.detail]] as [string, string][]) : []),
    ...(e ? ([["적은 사람", nameOf(e.createdBy)]] as [string, string][]) : []),
    ...(e && e.updatedAt && e.updatedAt !== e.createdAt ? ([["마지막 고침", `${nameOf(e.updatedBy)} · ${fmtWhen(e.updatedAt)}`]] as [string, string][]) : []),
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title="일정 자세히"
      description={origin ? `${kindLabel(it)} · ${origin.from}에서 저절로 모인 일정` : `직접 적은 일정 · ${kindLabel(it)}`}
      footer={
        <>
          {e && canEdit && (
            <Button variant="ghost" icon={Trash2} loading={busy === "del"} onClick={() => void del()} className="mr-auto text-nd-danger-text">
              지우기
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          {e && canEdit && (
            <Button icon={PenLine} onClick={() => onEdit(e)}>
              고치기
            </Button>
          )}
          {origin && it.href && (
            <Link href={it.href} className={buttonClass("primary", "md", "gap-1.5")}>
              <ArrowUpRight size={16} aria-hidden />
              {origin.open}
            </Link>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <h3 className={cn("text-[19px] font-bold leading-snug [overflow-wrap:anywhere]", it.source === "finance-overdue" ? "text-nd-danger-text" : "text-nd-fg")}>{it.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={toneOf(it)} size="lg">
              {kindLabel(it)}
            </Badge>
            <Badge tone="neutral" size="lg">
              {origin ? "저절로 모인 일정" : "직접 적은 일정"}
            </Badge>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3.5 text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="whitespace-nowrap text-nd-fg-3">{k}</dt>
              <dd className="min-w-0 text-right font-medium text-nd-fg [overflow-wrap:anywhere]">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        {e?.note && (
          <div>
            <p className="mb-1 text-[13px] font-medium text-nd-fg-2">메모</p>
            <p className="whitespace-pre-wrap text-nd-body text-nd-fg [overflow-wrap:anywhere]">{e.note}</p>
          </div>
        )}
        {origin ? (
          <StudioNotice tone={it.source === "finance-overdue" ? "danger" : "info"} title={`바꾸려면 원본(${origin.from})에서`}>
            {origin.how}
          </StudioNotice>
        ) : (
          e &&
          !canEdit && (
            <StudioNotice tone="neutral" title="읽기만 할 수 있습니다">
              이 일정은 {nameOf(e.createdBy)} 님이 적었습니다. 적은 사람이나 AI STUDIO 관리자만 고치고 지웁니다.
            </StudioNotice>
          )
        )}
      </div>
    </Dialog>
  );
}

/** 일정 적기 · 고치기 — 프로젝트는 지금 프로젝트가 기본 */
function EventDialog({ initial, date, canDelete, onClose }: { initial: ShortsEventView | null; date: string; canDelete: boolean; onClose: () => void }) {
  const { data, space, refresh } = useShorts();
  const d = data!;
  const ask = useConfirm();
  const { busy, run } = useAction();
  const spaces = d.spaces.filter((s) => !s.archived);
  const [f, setF] = useState({
    title: initial?.title ?? "",
    date: initial?.date ?? date,
    endDate: initial?.endDate ?? "",
    time: initial?.time ?? "",
    kind: (initial?.kind ?? "shoot") as EventKind,
    spaceId: initial?.spaceId ?? space,
    note: initial?.note ?? "",
  });
  // 종일이면 시각을 비워 저장한다 (calendar.ts — 시각 null = 종일)
  const [allDay, setAllDay] = useState(!initial?.time);
  const save = () =>
    void run(
      "save",
      async () => {
        await mutate("event.save", { id: initial?.id ?? null, event: { ...f, endDate: f.endDate || null, time: allDay ? null : f.time || null } });
        await refresh();
        onClose();
      },
      initial ? "일정을 고쳤습니다." : "일정을 적었습니다.",
    );
  const del = async () => {
    if (!initial || !(await ask({ title: "이 일정을 지울까요?", message: initial.title, tone: "danger", confirmLabel: "지우기" }))) return;
    await run("del", async () => {
      await mutate("event.delete", { id: initial.id });
      await refresh();
      onClose();
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={initial ? "일정 고치기" : "일정 적기"}
      description="직접 적는 일정 · 고른 프로젝트를 볼 수 있는 사람과 함께 봅니다."
      footer={
        <>
          {initial && canDelete && (
            <Button variant="ghost" icon={Trash2} loading={busy === "del"} onClick={() => void del()} className="mr-auto text-nd-danger-text">
              지우기
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button icon={initial ? undefined : CalendarPlus} loading={busy === "save"} disabled={!f.title.trim() || !f.date} onClick={save}>
            {initial ? "저장" : "일정 추가"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="제목">
          <Input value={f.title} maxLength={100} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예: 3화 촬영 · 업체 미팅 · 11월분 납품" />
        </Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="종류" hint="촬영 / 미팅 / 마감·납품 / 기타">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EventKind })}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="프로젝트" hint="대행 프로젝트 일정은 관리자와 그 업체 담당자만 봅니다">
            <Select value={f.spaceId} onChange={(e) => setF({ ...f, spaceId: e.target.value })}>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {spaceKind(s) === "agency" ? `대행 · ${d.clients.find((c) => c.id === s.clientId)?.name ?? "업체"} · ` : ""}
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="날짜">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="끝 날 (여러 날이면)" hint="여러 날 일정이면 마지막 날을 고릅니다 (90일까지)">
            <Input type="date" value={f.endDate} min={f.date} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="종일 여부">
            <Select value={allDay ? "allday" : "time"} onChange={(e) => setAllDay(e.target.value === "allday")}>
              <option value="allday">종일</option>
              <option value="time">시각 지정</option>
            </Select>
          </Field>
          <Field label="시각" hint={allDay ? "종일 일정은 시각 없이 적습니다" : "비우면 종일로 적습니다"}>
            <Input type="time" value={allDay ? "" : f.time} disabled={allDay} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </Field>
        </FormRow>
        <Field label="메모">
          <Textarea rows={3} value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="장소 · 함께하는 사람 · 준비물" />
        </Field>
      </div>
    </Dialog>
  );
}
