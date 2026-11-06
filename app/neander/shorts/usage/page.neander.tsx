"use client";

// ============================================================
//  AI 사용료 — 오픈라우터 키마다 쓴 돈을 사람 · 달로 (shorts/ai-usage.ts)
// ------------------------------------------------------------
//  영상 만드는 사람들이 한 오픈라우터 계정에서 키를 하나씩 따서 쓴다. 이 화면은
//    · 충전 잔액 · 하루 평균 · 남은 날 — 바닥나면 이 계정의 모든 키(운영 서비스 포함)가 멈춘다
//    · 사람별 이번 달 · 지난달 · 이번 주 · 오늘
//    · 키별 — 주인 · 용도를 여기서 정한다(키 이름은 제각각이라 추정하지 않는다) · 한도
//    · 달별 — 아침마다 찍어 둔 기록으로 지난 달 금액을 되살린다
//  계정 전체의 돈이라 AI STUDIO 관리자만 본다. 열 때마다 서버가 오픈라우터를 다시 읽는다.
//  금액은 달러 그대로 (오픈라우터와 맞춰 보기 쉽게) · 원화는 1달러 1,450원 어림.
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarRange, CircleDollarSign, KeyRound, RefreshCw, Users } from "lucide-react";
import { Badge, Button, Input, PageShell, SegmentedControl, Select, cn } from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { ProgressLine, RecordTable, StudioCard, StudioHeader, StudioMetric, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { krwOf } from "@/lib/neander/shorts/radar";
import {
  LIMIT_RESET_LABEL,
  OWNER_ERP,
  OWNER_GROUP_LABEL,
  OWNER_NONE_LABEL,
  OWNER_SERVICE,
  usd,
  type UsageKeyRow,
  type UsageMonthRow,
  type UsageOwnerRow,
  type UsageView,
} from "@/lib/neander/shorts/ai-usage";

type Resp = { configured: false } | { configured: true; view: UsageView };

const krw = (u: number) => {
  const w = krwOf(u);
  return w >= 100_000 ? `약 ${Math.round(w / 10_000).toLocaleString("ko-KR")}만 원` : `약 ${w.toLocaleString("ko-KR")}원`;
};
const monthName = (m: string) => `${Number(m.slice(5, 7))}월`;
const ymName = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const dateOf = (iso: string | null) => (iso ? fmtWhen(Date.parse(iso)) : "—");
const Muted = ({ children }: { children: ReactNode }) => <span className="text-nd-fg-3">{children}</span>;

export default function UsagePage() {
  const { data, nameOf } = useShorts();
  const { members } = useAppData();
  const admin = !!data?.admin;
  const [resp, setResp] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"month" | "all">("month");
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResp(await shortsGet<Resp>("usage"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "오픈라우터 사용액을 읽지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  const view = resp?.configured ? resp.view : null;
  const ownerName = useCallback((o: string) => OWNER_GROUP_LABEL[o] ?? (o ? nameOf(o) : OWNER_NONE_LABEL), [nameOf]);
  const people = useMemo(
    () => members.filter((m) => m.email).map((m) => ({ email: (m.email ?? "").toLowerCase(), name: m.name })).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [members],
  );

  const save = useCallback(
    async (row: UsageKeyRow, patch: { owner?: string; purpose?: string }) => {
      const next = { owner: patch.owner ?? row.owner, purpose: patch.purpose ?? row.purpose };
      if (next.owner === row.owner && next.purpose === row.purpose) return;
      const ok = await run(row.hash, () => shortsPost("usage", { hash: row.hash, ...next }), patch.owner !== undefined ? `${row.name} — ${ownerName(next.owner)}` : undefined);
      // 사람별 합계 · 알림은 서버가 다시 묶는다
      if (ok) await load();
    },
    [run, load, ownerName],
  );

  if (!admin) {
    return (
      <PageShell>
        <StudioHeader kicker="사람별" kickerIcon={Users} title="AI 사용료" />
        <StudioNotice tone="info" title="AI STUDIO 관리자만 봅니다">
          오픈라우터 계정 전체의 돈이라 관리자에게만 보입니다.
        </StudioNotice>
      </PageShell>
    );
  }

  const monthTotal = view ? view.owners.reduce((n, o) => n + o.month, 0) : 0;
  const prevKnown = !!view && view.owners.some((o) => o.prevMonth !== null);
  const dangers = view?.warnings.filter((w) => w.tone === "danger") ?? [];
  const cautions = view?.warnings.filter((w) => w.tone === "warning") ?? [];
  const balanceTone = view ? (view.credits.balance <= 0 || (view.daysLeft !== null && view.daysLeft < 1) ? "danger" : view.daysLeft !== null && view.daysLeft < 3 ? "warning" : undefined) : undefined;
  const keys = view ? (scope === "month" ? view.keys.filter((k) => k.month > 0 || (k.prevMonth ?? 0) > 0) : view.keys) : [];

  const ownerCols: RecordColumn<UsageOwnerRow>[] = [
    { key: "who", header: "누구", mobile: "title", cell: (o) => <span className={cn("font-medium", !o.owner && "text-nd-warning-text")}>{ownerName(o.owner)}</span> },
    {
      key: "month",
      header: `이번 달 (${view ? monthName(view.month) : ""})`,
      align: "right",
      cell: (o) => (
        <span>
          <span className="font-semibold">{usd(o.month)}</span>
          <span className="ml-1.5 text-[13px] text-nd-fg-3">{krw(o.month)}</span>
        </span>
      ),
    },
    ...(prevKnown ? [{ key: "prev", header: `지난달 (${view ? monthName(view.prevMonth) : ""})`, align: "right" as const, cell: (o: UsageOwnerRow) => (o.prevMonth === null ? <Muted>기록 전</Muted> : usd(o.prevMonth)) }] : []),
    { key: "week", header: "이번 주", align: "right", cell: (o) => usd(o.week) },
    { key: "today", header: "오늘", align: "right", cell: (o) => usd(o.today) },
    { key: "keys", header: "키", align: "right", className: "w-[72px] whitespace-nowrap", cell: (o) => `${o.keys}개` },
  ];

  const limitCell = (k: UsageKeyRow) => {
    if (k.limit === null) {
      const person = !!k.owner && !OWNER_GROUP_LABEL[k.owner];
      return (
        <Badge tone={person && k.month > 0 ? "warning" : "neutral"} size="md">
          한도 없음
        </Badge>
      );
    }
    const used = Math.max(0, k.limit - (k.limitRemaining ?? k.limit));
    const r = k.limitRatio ?? 0;
    return (
      <div className="ml-auto w-[150px] text-right">
        <div className="text-[13px]">
          <span className={cn("font-medium", r >= 1 ? "text-nd-danger-text" : r >= 0.8 ? "text-nd-warning-text" : "text-nd-fg")}>{usd(used)}</span>
          <span className="text-nd-fg-3"> / {usd(k.limit)}</span>
        </div>
        <ProgressLine value={Math.min(used, k.limit)} total={k.limit} tone={r >= 1 ? "danger" : r >= 0.8 ? "warning" : "accent"} className="mt-1" />
        <div className="mt-0.5 text-[13px] text-nd-fg-3">{k.limitReset ? `${LIMIT_RESET_LABEL[k.limitReset]} 다시 채워짐` : "누적 · 안 채워짐"}</div>
      </div>
    );
  };

  const keyCols: RecordColumn<UsageKeyRow>[] = [
    {
      key: "name",
      header: "키",
      mobile: "title",
      cell: (k) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("break-all font-medium", k.gone && "text-nd-fg-3 line-through")}>{k.name}</span>
            {k.gone && <Badge size="sm">만료 · 삭제</Badge>}
            {k.disabled && <Badge size="sm">꺼짐</Badge>}
            {!k.gone && !k.disabled && k.limit !== null && (k.limitRemaining ?? 1) <= 0 && (
              <Badge tone="danger" size="sm">
                막힘
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[13px] text-nd-fg-3">
            마지막 사용 {dateOf(k.lastUsedAt)} · 만든 날 {k.createdAt ? k.createdAt.slice(0, 10) : "—"}
          </div>
        </div>
      ),
    },
    {
      key: "owner",
      header: "주인",
      className: "w-[150px]",
      cell: (k) => (
        <Select
          size="sm"
          aria-label={`${k.name} 주인`}
          value={k.owner}
          disabled={busy === k.hash || k.gone}
          onChange={(e) => void save(k, { owner: e.target.value })}
          className={cn("w-full min-w-[120px]", !k.owner && "text-nd-warning-text")}
        >
          <option value="">{OWNER_NONE_LABEL}</option>
          {people.map((p) => (
            <option key={p.email} value={p.email}>
              {p.name}
            </option>
          ))}
          <option value={OWNER_ERP}>{OWNER_GROUP_LABEL[OWNER_ERP]}</option>
          <option value={OWNER_SERVICE}>{OWNER_GROUP_LABEL[OWNER_SERVICE]}</option>
        </Select>
      ),
    },
    {
      key: "purpose",
      header: "용도",
      className: "w-[170px]",
      cell: (k) => (
        <Input
          key={`${k.hash}:${k.purpose}`}
          size="sm"
          aria-label={`${k.name} 용도`}
          defaultValue={k.purpose}
          placeholder="영상 · 개발 …"
          maxLength={60}
          disabled={busy === k.hash || k.gone}
          onBlur={(e) => void save(k, { purpose: e.target.value.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-full min-w-[120px]"
        />
      ),
    },
    { key: "month", header: "이번 달", align: "right", cell: (k) => (k.month > 0 ? <span className="font-semibold">{usd(k.month)}</span> : <Muted>$0</Muted>) },
    ...(prevKnown ? [{ key: "prev", header: "지난달", align: "right" as const, cell: (k: UsageKeyRow) => (k.prevMonth ? usd(k.prevMonth) : <Muted>$0</Muted>) }] : []),
    { key: "total", header: "만든 뒤 누적", align: "right", cell: (k) => usd(k.total) },
    { key: "limit", header: "한도", align: "right", className: "w-[170px]", cell: limitCell },
  ];

  const monthOwners = view ? view.owners.map((o) => o.owner) : [];
  const monthCols: RecordColumn<UsageMonthRow>[] = [
    { key: "m", header: "달", mobile: "title", cell: (r) => <span className="font-medium">{ymName(r.month)}</span> },
    { key: "total", header: "합계", align: "right", cell: (r) => <span className="font-semibold">{usd(r.total)}</span> },
    ...monthOwners.map((o) => ({ key: `o:${o}`, header: ownerName(o), align: "right" as const, cell: (r: UsageMonthRow) => (r.byOwner[o] ? usd(r.byOwner[o]) : <Muted>—</Muted>) })),
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="사람별"
        kickerIcon={Users}
        title="AI 사용료"
        description="오픈라우터 키마다 쓴 돈을 사람 · 달로 묶습니다. 달은 오픈라우터 기준이라 한국 시간 매달 1일 오전 9시에 바뀝니다. 원화는 1달러 1,450원 어림입니다."
        meta={view ? <span className="text-[13px] text-nd-fg-3">읽은 때 {fmtWhen(view.at)}</span> : undefined}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} aria-hidden className={cn(loading && "animate-spin")} />
            다시 읽기
          </Button>
        }
      />

      {error && (
        <StudioNotice tone="danger" title="오픈라우터를 읽지 못했습니다" className="mb-4">
          {error}
        </StudioNotice>
      )}
      {resp && !resp.configured && (
        <StudioNotice tone="warning" title="오픈라우터 관리 키가 없습니다">
          배포 설정(Vercel 환경변수)에 <code>OPENROUTER_MANAGEMENT_KEY</code> 를 넣어 주세요. 오픈라우터 설정의 Management keys 에서 만듭니다.
        </StudioNotice>
      )}
      {!resp && !error && <p className="py-10 text-center text-nd-body text-nd-fg-3">오픈라우터에서 읽는 중…</p>}

      {view && (
        <div className="flex flex-col gap-5">
          {(dangers.length > 0 || cautions.length > 0) && (
            <div className="flex flex-col gap-2">
              {dangers.map((w, i) => (
                <StudioNotice key={`d${i}`} tone="danger">
                  {w.text}
                </StudioNotice>
              ))}
              {cautions.length > 0 && (
                <StudioNotice tone="warning" title={`확인할 것 ${cautions.length}개`}>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {cautions.map((w, i) => (
                      <li key={i}>{w.text}</li>
                    ))}
                  </ul>
                </StudioNotice>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StudioMetric label="충전 잔액" value={usd(view.credits.balance)} tone={balanceTone} detail={`충전 ${usd(view.credits.total)} · 사용 ${usd(view.credits.used)}`} />
            <StudioMetric label={`이번 달 (${monthName(view.month)})`} value={usd(monthTotal)} detail={krw(monthTotal)} />
            <StudioMetric
              label="하루 평균"
              value={usd(view.pace.perDay)}
              detail={view.pace.basis === "history" ? `최근 ${view.pace.days.toFixed(1)}일 기록으로` : `${view.pace.basis === "week" ? "이번 주" : "이번 달"} ${view.pace.days.toFixed(1)}일 평균`}
            />
            <StudioMetric
              label="잔액이 버티는 시간"
              value={view.daysLeft === null ? "—" : view.daysLeft < 1 ? `${Math.max(0, Math.round(view.daysLeft * 24))}시간` : `${view.daysLeft.toFixed(1)}일`}
              tone={balanceTone}
              detail={view.daysLeft === null ? "요즘 쓴 돈이 없습니다" : "지금 쓰는 속도 그대로라면"}
            />
          </div>

          <StudioCard title="사람별" description={`이번 달 합계 ${usd(monthTotal)} (${krw(monthTotal)}) · 키의 주인은 아래 키 표에서 정합니다.`} flush>
            <RecordTable rows={view.owners} columns={ownerCols} rowKey={(o) => o.owner || "none"} ariaLabel="사람별 AI 사용료" />
          </StudioCard>

          <StudioCard
            title={
              <span className="inline-flex items-center gap-2">
                <KeyRound size={16} aria-hidden className="text-nd-fg-3" />
                키별
              </span>
            }
            description="주인 · 용도는 고르면 바로 저장됩니다. 한도는 오픈라우터에서 바꿉니다."
            action={
              <SegmentedControl
                size="sm"
                ariaLabel="키 범위"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "month", label: prevKnown ? "이번 달 · 지난달 쓴 키" : "이번 달 쓴 키" },
                  { value: "all", label: `모든 키 (${view.keys.length})` },
                ]}
              />
            }
            flush
          >
            <RecordTable rows={keys} columns={keyCols} rowKey={(k) => k.hash} ariaLabel="키별 AI 사용료" empty={<p className="px-6 pb-5 text-nd-body text-nd-fg-3">이번 달 쓴 키가 없습니다.</p>} />
          </StudioCard>

          {view.months.length > 0 && (
            <StudioCard
              title={
                <span className="inline-flex items-center gap-2">
                  <CalendarRange size={16} aria-hidden className="text-nd-fg-3" />
                  달별
                </span>
              }
              description={`아침마다 찍어 둔 기록으로 냅니다 (${fmtWhen(view.since)} 부터). 기록을 시작하기 전에 만료된 키는 빠져 있습니다.`}
              flush
            >
              <RecordTable rows={view.months} columns={monthCols} rowKey={(r) => r.month} ariaLabel="달별 AI 사용료" />
            </StudioCard>
          )}

          {view.untracked > 0.01 && (
            <StudioNotice tone="info" icon={CircleDollarSign} title={`키에 안 잡힌 돈 ${usd(view.untracked)} (누적)`}>
              계정 전체 사용액에서 지금 아는 키들의 누적을 뺀 돈입니다. 기록을 시작하기 전에 만료 · 삭제된 키와 오픈라우터 사이트 채팅에서 쓴 돈이라, 누가 썼는지는 알 수 없습니다.
            </StudioNotice>
          )}
        </div>
      )}
    </PageShell>
  );
}
