"use client";

// ============================================================
//  AI STUDIO 일정 — 달력 (calendar.ts)
// ------------------------------------------------------------
//  손으로 적는 일정(촬영 · 미팅 · 마감·납품 · 기타)과 자료에서 저절로 모이는 일정을 한 달력에:
//  게시 예약 · 게시됨 · 고객 검토 · 승인 · 수정 요청 · 업체 계약 시작/끝 · 재무 회차(받을 날 · 받은 날) · 계약서 체결.
//  「지금 프로젝트」 / 「모든 프로젝트」 — 대행 프로젝트는 볼 수 있는 사람(관리자 · 담당자)에게만 온다.
//  재무 일정은 재무 권한이 있을 때만 · ERP 팀 일정은 고르면 겹쳐 본다(읽기만).
//  좁은 화면에서는 달력 대신 날짜별 목록.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, FormRow, Input, PageHeader, PageShell, SectionHeader, SegmentedControl, Select, Textarea, cn, toneCls, useConfirm, type Tone } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { useAction } from "@/components/neander/shorts/parts";
import { subscribeSchedules } from "@/lib/neander/db/schedules";
import { monthGrid, monthLabel, shiftMonth, thisMonthStr } from "@/lib/neander/format";
import { mutate } from "@/lib/neander/shorts/client";
import { CAL_SOURCE_LABEL, EVENT_KIND_LABEL, EVENT_KINDS, autoItems, eventItem, itemsByDate, kstDate, type CalItem, type CalSource, type EventKind, type ShortsEventView } from "@/lib/neander/shorts/calendar";
import { spaceKind, spaceOf } from "@/lib/neander/shorts/spaces";
import type { Schedule } from "@/lib/neander/types";

const KIND_TONE: Record<EventKind, Tone> = { shoot: "accent", meeting: "info", deadline: "warning", etc: "neutral" };
const SOURCE_TONE: Record<Exclude<CalSource, "manual">, Tone> = {
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
const toneOf = (it: CalItem): Tone => (it.source === "manual" && it.event ? KIND_TONE[it.event.kind] : it.source === "manual" ? "neutral" : SOURCE_TONE[it.source]);

/** 고를 수 있는 묶음 */
const GROUPS = [
  { key: "manual", label: "직접 적은 일정", sources: ["manual"] },
  { key: "publish", label: "게시", sources: ["publish", "published"] },
  { key: "review", label: "고객 검토", sources: ["review", "approved", "revision"] },
  { key: "contract", label: "업체 계약", sources: ["contract", "finance-contract"] },
  { key: "money", label: "받을 돈 · 받은 돈", sources: ["finance-due", "finance-overdue", "finance-paid"] },
  { key: "team", label: "ERP 팀 일정", sources: ["team"] },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export default function CalendarPage() {
  const { data, space, currentSpace, nameOf } = useShorts();
  const d = data!;
  const [month, setMonth] = useState(thisMonthStr());
  const [scope, setScope] = useState<"here" | "all">("here");
  const [on, setOn] = useState<Record<GroupKey, boolean>>({ manual: true, publish: true, review: true, contract: true, money: true, team: false });
  const [team, setTeam] = useState<Schedule[]>([]);
  const [open, setOpen] = useState<CalItem | null>(null);
  const [editing, setEditing] = useState<{ event: ShortsEventView | null; date: string } | null>(null);
  const today = kstDate(Date.now());

  // ERP 팀 일정 — 고를 때만 받는다 (읽기만)
  useEffect(() => {
    if (!on.team) return;
    return subscribeSchedules(setTeam);
  }, [on.team]);

  const items = useMemo(() => {
    const here = (x: { spaceId?: string | null }) => scope === "all" || spaceOf(x) === space;
    const projects = d.projects.filter(here);
    const ids = new Set(projects.map((p) => p.id));
    // 업체 일정은 「지금 프로젝트」 가 그 업체의 대행 프로젝트일 때만 (모든 프로젝트면 볼 수 있는 업체 전부)
    const clients = scope === "all" ? d.clients : currentSpace && spaceKind(currentSpace) === "agency" ? d.clients.filter((c) => c.id === currentSpace.clientId) : [];
    const auto = autoItems({ projects, publications: d.publications.filter((p) => ids.has(p.projectId)), clients, clientFinance: d.clientFinance, today });
    const manual = d.events.filter(here).map(eventItem);
    const teamItems: CalItem[] = team.map((s) => ({ key: `team-${s.id}`, date: s.date, title: s.title, chip: `팀 · ${s.title}`, detail: s.targetIds?.length ? `팀 일정 · ${s.targetIds.length}명` : "팀 일정", source: "team", href: "/neander/schedule" }));
    const allowed = new Set<CalSource>(GROUPS.filter((g) => on[g.key]).flatMap((g) => [...g.sources]));
    return [...manual, ...auto, ...teamItems].filter((it) => allowed.has(it.source));
  }, [d, scope, space, currentSpace, on, team, today]);

  const cells = monthGrid(month);
  const first = `${month}-01`;
  const last = cells.filter(Boolean).at(-1) ?? first;
  const byDate = useMemo(() => itemsByDate(items, first, last as string), [items, first, last]);
  const upcoming = useMemo(() => {
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
    return [...itemsByDate(items, today, until).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, today]);
  const spaceName = (id?: string | null) => (id ? (d.spaces.find((s) => s.id === id)?.name ?? "") : "");
  const monthItems = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <PageShell>
      <PageHeader
        title="일정"
        description="촬영 · 미팅 · 마감을 적고, 게시 예약 · 고객 검토 · 업체 계약 · 받을 돈 같은 일정은 자료에서 저절로 모입니다. 대행 프로젝트 일정은 관리자와 그 업체 담당자에게만 보입니다."
        actions={
          <Button icon={Plus} onClick={() => setEditing({ event: null, date: today })}>
            일정 적기
          </Button>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="지난달" onClick={() => setMonth(shiftMonth(month, -1))} />
          <span className="min-w-[110px] text-center text-[17px] font-semibold">{monthLabel(month)}</span>
          <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))} />
          <Button size="sm" variant="secondary" onClick={() => setMonth(thisMonthStr())}>
            오늘
          </Button>
        </div>
        <SegmentedControl
          size="sm"
          ariaLabel="어느 프로젝트"
          value={scope}
          onChange={(v) => setScope(v as "here" | "all")}
          options={[
            { value: "here", label: `지금 프로젝트 · ${currentSpace?.name ?? ""}` },
            { value: "all", label: "모든 프로젝트" },
          ]}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {GROUPS.filter((g) => g.key !== "money" || d.financeAccess).map((g) => (
            <Checkbox key={g.key} checked={on[g.key]} onChange={(e) => setOn({ ...on, [g.key]: e.target.checked })} label={<span className="text-[13px]">{g.label}</span>} />
          ))}
        </div>
      </Card>

      {/* 넓은 화면 — 달력 */}
      <Card padding="none" className="mb-6 hidden overflow-hidden sm:block">
        <div className="grid grid-cols-7 border-b border-nd-line bg-nd-sunken text-center text-[13px] font-medium text-nd-fg-2">
          {WEEK.map((w, i) => (
            <div key={w} className={cn("py-2", i === 0 && "text-nd-danger-text", i === 6 && "text-nd-info-text")}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            const list = date ? (byDate.get(date) ?? []) : [];
            return (
              <div
                key={i}
                className={cn("group min-h-[118px] border-b border-r border-nd-line p-1.5 [&:nth-child(7n)]:border-r-0", !date && "bg-nd-sunken/50", date === today && "bg-nd-accent-soft/40")}
              >
                {date && (
                  <>
                    <div className="mb-1 flex items-center justify-between px-0.5">
                      <span className={cn("nd-num text-[13px]", date === today ? "rounded-full bg-nd-accent px-1.5 font-semibold text-white" : i % 7 === 0 ? "text-nd-danger-text" : i % 7 === 6 ? "text-nd-info-text" : "text-nd-fg-2")}>{Number(date.slice(8))}</span>
                      <button type="button" aria-label={`${date} 일정 적기`} onClick={() => setEditing({ event: null, date })} className="rounded p-0.5 text-nd-fg-3 opacity-0 hover:bg-nd-sunken hover:text-nd-fg group-hover:opacity-100 focus-visible:opacity-100">
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {list.slice(0, 4).map((it) => (
                        <Chip key={`${it.key}-${date}`} it={it} onClick={() => setOpen(it)} />
                      ))}
                      {list.length > 4 && (
                        <button type="button" className="px-1 text-[13px] text-nd-fg-3 hover:text-nd-fg" onClick={() => setOpen({ ...list[4], key: `more-${date}` })}>
                          +{list.length - 4}개 더
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 좁은 화면 — 날짜별 목록 */}
      <div className="mb-6 sm:hidden">
        {monthItems.length === 0 ? (
          <EmptyState compact icon={CalendarDays} title={`${monthLabel(month)} 일정이 없습니다`} description="「일정 적기」 로 촬영 · 미팅 · 마감을 적어 두세요." />
        ) : (
          <DayList entries={monthItems} today={today} onOpen={setOpen} />
        )}
      </div>

      <section>
        <SectionHeader size="lg" title="다가오는 2주" hint="오늘부터 14일" />
        {upcoming.length === 0 ? <p className="text-nd-body text-nd-fg-3">다가오는 일정이 없습니다.</p> : <DayList entries={upcoming} today={today} onOpen={setOpen} spaceName={scope === "all" ? spaceName : undefined} />}
      </section>

      {open && <ItemDialog it={open} items={open.key.startsWith("more-") ? (byDate.get(open.date) ?? []) : null} spaceName={spaceName} nameOf={nameOf} onClose={() => setOpen(null)} onEdit={(e) => { setOpen(null); setEditing({ event: e, date: e.date }); }} onPick={setOpen} />}
      {editing && <EventDialog initial={editing.event} date={editing.date} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}

function Chip({ it, onClick }: { it: CalItem; onClick: () => void }) {
  const t = toneCls[toneOf(it)];
  return (
    <button type="button" onClick={onClick} title={`${it.title} — ${it.detail}`} className={cn("flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[13px] leading-snug hover:brightness-95", t.soft, t.text)}>
      {it.time && <span className="nd-num shrink-0 opacity-80">{it.time}</span>}
      <span className="truncate">{it.chip}</span>
    </button>
  );
}

function DayList({ entries, today, onOpen, spaceName }: { entries: [string, CalItem[]][]; today: string; onOpen: (it: CalItem) => void; spaceName?: (id?: string | null) => string }) {
  return (
    <Card padding="none" className="divide-y divide-nd-line overflow-hidden">
      {entries.map(([date, list]) => (
        <div key={date} className="flex gap-3 px-4 py-3">
          <div className={cn("w-[76px] shrink-0 text-[13px]", date === today ? "font-semibold text-nd-accent" : "text-nd-fg-2")}>
            {Number(date.slice(5, 7))}/{Number(date.slice(8))} ({WEEK[new Date(`${date}T00:00:00`).getDay()]})
            {date === today && <div>오늘</div>}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {list.map((it) => (
              <button key={it.key} type="button" onClick={() => onOpen(it)} className="flex w-full min-w-0 items-start gap-2 text-left hover:opacity-80">
                <Badge tone={toneOf(it)} size="md">{it.source === "manual" && it.event ? EVENT_KIND_LABEL[it.event.kind] : CAL_SOURCE_LABEL[it.source]}</Badge>
                <span className="min-w-0">
                  <span className="block truncate text-nd-body font-medium">
                    {it.time && <span className="nd-num mr-1 text-nd-fg-3">{it.time}</span>}
                    {it.title}
                  </span>
                  <span className="block truncate text-[13px] text-nd-fg-3">
                    {it.detail}
                    {spaceName && it.spaceId ? ` · ${spaceName(it.spaceId)}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

/** 일정 하나 보기 — 손으로 적은 것은 고치기, 저절로 모인 것은 그 화면으로 */
function ItemDialog({ it, items, spaceName, nameOf, onClose, onEdit, onPick }: { it: CalItem; items: CalItem[] | null; spaceName: (id?: string | null) => string; nameOf: (e: string) => string; onClose: () => void; onEdit: (e: ShortsEventView) => void; onPick: (it: CalItem) => void }) {
  if (items) {
    return (
      <Dialog open onClose={onClose} title={`${Number(it.date.slice(5, 7))}월 ${Number(it.date.slice(8))}일 일정`}>
        <div className="space-y-1.5">
          {items.map((x) => (
            <Chip key={x.key} it={x} onClick={() => onPick(x)} />
          ))}
        </div>
      </Dialog>
    );
  }
  const e = it.event;
  return (
    <Dialog
      open
      onClose={onClose}
      title={it.title}
      description={`${it.date}${it.endDate ? ` ~ ${it.endDate}` : ""}${it.time ? ` ${it.time}` : ""}`}
      footer={
        <>
          {it.href && (
            <Link href={it.href} className="inline-flex h-9 items-center gap-1 rounded-nd-md px-3 text-nd-body font-medium text-nd-accent hover:bg-nd-accent-soft">
              열기 <ExternalLink size={14} aria-hidden />
            </Link>
          )}
          {e && (
            <Button variant="secondary" onClick={() => onEdit(e)}>
              고치기
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-nd-body">
        <Badge tone={toneOf(it)} size="md">{e ? EVENT_KIND_LABEL[e.kind] : CAL_SOURCE_LABEL[it.source]}</Badge>
        <p>{it.detail}</p>
        {it.spaceId && <p className="text-[13px] text-nd-fg-3">프로젝트 · {spaceName(it.spaceId)}</p>}
        {e?.note && <p className="whitespace-pre-wrap text-nd-fg-2">{e.note}</p>}
        {e && <p className="text-[13px] text-nd-fg-3">적은 사람 {nameOf(e.createdBy)}</p>}
      </div>
    </Dialog>
  );
}

/** 일정 적기 · 고치기 — 프로젝트는 지금 프로젝트가 기본 */
function EventDialog({ initial, date, onClose }: { initial: ShortsEventView | null; date: string; onClose: () => void }) {
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
  const save = () =>
    void run(
      "save",
      async () => {
        await mutate("event.save", { id: initial?.id ?? null, event: { ...f, endDate: f.endDate || null, time: f.time || null } });
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
      title={initial ? "일정 고치기" : "일정 적기"}
      footer={
        <>
          {initial && (
            <Button variant="ghost" icon={Trash2} onClick={() => void del()}>
              지우기
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button loading={busy === "save"} disabled={!f.title.trim() || !f.date} onClick={save}>
            {initial ? "저장" : "적기"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label="제목">
            <Input value={f.title} maxLength={100} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예: 3화 촬영 · 업체 미팅 · 11월분 납품" />
          </Field>
          <Field label="종류">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EventKind })}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-3">
          <Field label="날짜">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="끝 날 (여러 날이면)">
            <Input type="date" value={f.endDate} min={f.date} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Field label="시각 (비우면 종일)">
            <Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </Field>
        </FormRow>
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
        <Field label="메모">
          <Textarea rows={3} value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
