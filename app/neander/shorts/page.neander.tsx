"use client";

// ============================================================
//  AI STUDIO — 대시보드
// ------------------------------------------------------------
//  「지금 무엇을 해야 하나」 가 먼저다: 결과 확인이 필요한 게시 · 검토할 AI 장면 ·
//  끊긴 출력. 그다음 단계별 영상 수와 최근 영상, 연결 상태.
//  숫자는 전부 실제 기록에서 센다 — 예시 수치를 보여 주지 않는다.
//  AI STUDIO 프로젝트(채널)를 모두 본다 — 다른 화면은 위 툴바의 「프로젝트」 로 거른다.
// ============================================================

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CalendarClock, CircleAlert, Clapperboard, FolderKanban, Plug, Radar } from "lucide-react";
import { Badge, Button, Card, EmptyState, InlineNotice, KpiItem, KpiStrip, PageHeader, PageShell, SectionHeader, Table, TableScroll, Td, Th, Tr, cn, type Tone } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { ConnBadge, JobBadge, KindTile, PubBadge, StageBadge, fmtWhen } from "@/components/neander/shorts/parts";
import { PLATFORM_LABEL, STAGE_LABEL, currentMonth, projectTotals } from "@/lib/neander/shorts/model";
import { PRODUCTION_LABEL, spaceKind, spaceOf, type SpaceView } from "@/lib/neander/shorts/spaces";
import type { AccountView, ProjectStage, PublishPlatform } from "@/lib/neander/shorts/types";

const FLOW: ProjectStage[] = ["research", "sourcing", "matching", "scripting", "editing", "ready", "published"];
const MODE_LABEL = { remix: "기존 영상 재편집", hybrid: "소스 + AI 장면", ai: "전체 AI 생성" } as const;
const KEY_STATUS = { none: ["키 없음", "neutral"], unverified: ["넣음 · 확인 전", "warning"], ok: ["확인됨", "success"], failed: ["확인 실패", "danger"] } as const;

export default function ShortsDashboard() {
  const { data, viewer, nameOf, space, setSpace } = useShorts();
  const d = data!;
  // 대시보드만 모든 프로젝트
  const sc = useScoped({ allSpaces: true });
  const router = useRouter();
  const spaceName = useMemo(() => new Map(d.spaces.map((x) => [x.id, x.name])), [d.spaces]);
  // 프로젝트별 한눈에 — 영상 · 게시 · 조회(출처별 마지막 기록 합) · 확인할 일
  const bySpace = useMemo(
    () =>
      d.spaces
        .filter((x) => !x.archived)
        .map((x) => {
          const ps = sc.projects.filter((p) => spaceOf(p) === x.id && !p.sample);
          const ids = new Set(ps.map((p) => p.id));
          const pubs = sc.publications.filter((p) => ids.has(p.projectId));
          const views = ps.map((p) => projectTotals(sc.metrics.filter((m) => m.projectId === p.id)).views).filter((v): v is number => v !== null);
          const review = ps.reduce((n, p) => n + p.scenes.filter((sc2) => sc2.kind === "ai" && sc2.ai?.status === "review").length, 0);
          const thisMonth = currentMonth();
          return {
            space: x,
            agency: spaceKind(x) === "agency",
            waiting: ps.filter((p) => p.review?.state === "waiting").length,
            monthMade: ps.filter((p) => p.kind === "brand" && p.month === thisMonth).length,
            videos: ps.length,
            inProgress: ps.filter((p) => p.stage !== "published" && p.stage !== "archived").length,
            published: pubs.filter((p) => p.status === "published").length,
            views: views.length ? views.reduce((a, b) => a + b, 0) : null,
            attention: pubs.filter((p) => p.status === "uncertain" || p.status === "failed").length + review,
            accounts: d.accounts.filter((a) => !a.clientId && spaceOf(a) === x.id).length,
          };
        }),
    [d.spaces, d.accounts, sc],
  );
  // 대행은 업체마다 — 이번 달 납품 · 승인 대기 · 재무 계약(권한이 있을 때)
  const agencyClients = useMemo(() => {
    const rows = bySpace.filter((r) => r.agency);
    return [...new Set(rows.map((r) => r.space.clientId ?? ""))]
      .map((id) => {
        const client = d.clients.find((c) => c.id === id) ?? null;
        const mine = rows.filter((r) => (r.space.clientId ?? "") === id);
        const fs = (d.clientFinance[id] ?? []).filter((x) => x.projectId);
        const known = fs.filter((x) => x.received !== null);
        const next = fs.map((x) => x.next).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.date.localeCompare(b.date))[0];
        return {
          id,
          client,
          name: client?.name ?? "업체",
          rows: mine,
          made: mine.reduce((n, r) => n + r.monthMade, 0),
          waiting: mine.reduce((n, r) => n + r.waiting, 0),
          finance: fs.length
            ? { contract: fs.reduce((n, x) => n + x.contractAmount, 0), received: known.length ? known.reduce((n, x) => n + (x.received ?? 0), 0) : null, overdue: fs.reduce((n, x) => n + x.overdue, 0), next: next?.label ?? null }
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [bySpace, d.clients, d.clientFinance]);
  const projectById = useMemo(() => new Map(sc.projects.map((p) => [p.id, p])), [sc.projects]);
  const accountById = useMemo(() => new Map(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const whose = viewer === "mine" ? "내" : viewer === "visible" ? (d.admin ? "모든 사용자의" : "볼 수 있는") : `${nameOf(viewer)} 님의`;

  const attention = useMemo(() => {
    const items: { key: string; href: string; kind: "coupang" | "brand"; title: string; detail: string; badge: ReactNode; at: number | null }[] = [];
    const kindOf = (id: string) => (projectById.get(id)?.kind === "brand" ? "brand" : "coupang");
    for (const p of sc.publications.filter((x) => x.status === "uncertain")) {
      items.push({ key: `pub-${p.id}`, href: "/neander/shorts/publish", kind: kindOf(p.projectId), title: `${projectById.get(p.projectId)?.title ?? "영상"} · ${PLATFORM_LABEL[p.platform]}`, detail: p.error?.message ?? "플랫폼에서 게시 여부를 확인해 기록해 주세요.", badge: <PubBadge status={p.status} size="lg" />, at: p.updatedAt });
    }
    for (const j of d.jobs.filter((x) => projectById.has(x.projectId) && ["failed", "uncertain", "interrupted"].includes(x.status) && (x.finishedAt ?? 0) > Date.now() - 3 * 86_400_000)) {
      items.push({ key: `job-${j.id}`, href: `/neander/shorts/projects/${j.projectId}`, kind: kindOf(j.projectId), title: `${projectById.get(j.projectId)?.title ?? "영상"} · ${j.kind === "ai_video" ? "AI 장면" : j.kind === "tts" ? "AI 음성" : j.kind === "render" ? "출력" : "게시"}`, detail: j.error?.message ?? "", badge: <JobBadge status={j.status} size="lg" />, at: j.finishedAt ?? null });
    }
    for (const p of sc.projects) {
      const n = p.scenes.filter((s) => s.kind === "ai" && s.ai?.status === "review").length;
      if (n) items.push({ key: `rev-${p.id}`, href: `/neander/shorts/projects/${p.id}?tab=edit`, kind: p.kind === "brand" ? "brand" : "coupang", title: p.title, detail: `AI 장면 ${n}개가 검토를 기다립니다 — 실제 제품과 다를 수 있어 사람이 승인해야 출력에 쓰입니다.`, badge: <StageBadge stage={p.stage} size="lg" />, at: p.updatedAt });
    }
    return items;
  }, [d, sc, projectById]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FLOW.map((s) => {
          const ps = sc.projects.filter((p) => p.stage === s && !p.sample);
          return [s, { all: ps.length, brand: ps.filter((p) => p.kind === "brand").length }];
        }),
      ) as Record<ProjectStage, { all: number; brand: number }>,
    [sc.projects],
  );
  const scheduled = sc.publications.filter((p) => p.status === "scheduled").sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const scheduledBlocked = scheduled.filter((p) => accountById.get(p.accountId)?.status === "needs_reauth").length;
  const s = d.status;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const keyStatus = KEY_STATUS[profile?.coupang.status ?? "none"];
  const searchKey = profile?.youtubeKey.configured ? "내 키" : s.youtubeSearch.configured ? "회사 키" : null;

  return (
    <PageShell>
      <PageHeader
        title="AI STUDIO"
        description={`${whose} 영상 — 모든 프로젝트(채널)를 한 곳에서: 기획 → 소스 · 대본 → 편집 · 출력 → 검토 · 게시 → 성과. 기획 · 영상 화면은 위쪽 「프로젝트」 로, 누구의 것은 「보기」 로 고릅니다.`}
        actions={
          <>
            <Link href="/neander/shorts/trends"><Button variant="secondary" icon={Radar}>소재 발굴</Button></Link>
            <Link href="/neander/shorts/projects"><Button icon={Clapperboard}>영상</Button></Link>
          </>
        }
      />

      <section className="mb-8 space-y-5">
        <SectionHeader size="lg" title="프로젝트별" hint="채널 하나 = 프로젝트 · 누르면 그 프로젝트로" action={<Link href="/neander/shorts/spaces" className="text-[13px] font-medium text-nd-accent hover:underline">프로젝트 관리</Link>} />
        <div>
          <p className="mb-2 text-[13px] font-semibold text-nd-fg-2">자체 운영</p>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {bySpace.filter((r) => !r.agency).map((r) => (
              <SpaceTile key={r.space.id} r={r} current={r.space.id === space} onOpen={() => { setSpace(r.space.id); router.push("/neander/shorts/projects"); }} />
            ))}
          </div>
        </div>
        {agencyClients.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-nd-fg-2">대행 · 업체별</p>
            <div className="space-y-3">
              {agencyClients.map((g) => (
                <div key={g.id} className="rounded-nd-lg border border-nd-border bg-nd-sunken/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                    <Briefcase size={16} aria-hidden className="text-nd-warning-text" />
                    <Link href={`/neander/shorts/clients/${g.id}`} className="text-[15px] font-semibold hover:underline">{g.name}</Link>
                    {g.client && (
                      <span className="text-[13px] text-nd-fg-2">
                        이번 달 <b className="nd-num">{g.made}</b> / {g.client.contract.videosPerMonth}편 · 승인 대기 <b className={cn("nd-num", g.waiting > 0 && "text-nd-warning-text")}>{g.waiting}</b>
                      </span>
                    )}
                    {g.finance && (
                      <span className="text-[13px] text-nd-fg-2">
                        입금 <b className="nd-num">{g.finance.received === null ? "—" : g.finance.received.toLocaleString("ko-KR")}</b> / {g.finance.contract.toLocaleString("ko-KR")}원
                        {g.finance.next && <> · 다음 {g.finance.next}</>}
                        {g.finance.overdue > 0 && <b className="ml-1 text-nd-danger-text">연체 {g.finance.overdue}건</b>}
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
                    {g.rows.map((r) => (
                      <SpaceTile key={r.space.id} r={r} current={r.space.id === space} onOpen={() => { setSpace(r.space.id); router.push("/neander/shorts/projects"); }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <KpiStrip columns={6} className="mb-8">
        {FLOW.slice(0, 6).map((st) => {
          const c = counts[st];
          return (
            <KpiItem
              key={st}
              size="lg"
              label={<span className="text-[13px]">{STAGE_LABEL[st]}</span>}
              value={c.all.toLocaleString("ko-KR")}
              unit="건"
              hint={c.all ? <span className="text-[13px]">쿠팡 {c.all - c.brand} · 고객사 {c.brand}</span> : undefined}
            />
          );
        })}
      </KpiStrip>

      <div className="grid gap-x-6 gap-y-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <SectionHeader size="lg" title="확인할 일" hint={attention.length ? `${attention.length}건` : undefined} />
          {attention.length === 0 ? (
            <EmptyState compact icon={CircleAlert} title="확인할 일이 없습니다" description="결과가 불확실한 게시 · 실패한 작업 · 검토할 AI 장면이 생기면 여기에 모입니다." />
          ) : (
            <Card padding="none" className="divide-y divide-nd-line overflow-hidden">
              {attention.map((a) => (
                <Link key={a.key} href={a.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-nd-fg/[.03]">
                  <KindTile kind={a.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-nd-body font-medium" title={a.title}>{a.title}</p>
                    {a.detail && <p className="mt-0.5 line-clamp-2 text-[13px] text-nd-fg-3" title={a.detail}>{a.detail}</p>}
                  </div>
                  <span className="shrink-0">{a.badge}</span>
                  <span className="nd-num hidden w-[88px] shrink-0 text-right text-[13px] text-nd-fg-3 sm:block">{fmtWhen(a.at)}</span>
                </Link>
              ))}
            </Card>
          )}

          <SectionHeader size="lg" className="mt-8" title="최근 영상" action={<Link href="/neander/shorts/projects" className="text-[13px] font-medium text-nd-accent hover:underline">전체 보기</Link>} />
          {sc.projects.length === 0 ? (
            <EmptyState compact icon={Clapperboard} title="아직 영상이 없습니다" description="소재 발굴에서 후보를 저장한 뒤 「영상 만들기」 를 누르거나, 영상 화면에서 바로 만드세요. 고객사 영상은 고객사 화면에서 만듭니다." />
          ) : (
            <Card padding="none" className="overflow-hidden">
              <TableScroll>
                <Table size="md" minWidth={640}>
                  <thead>
                    <tr>
                      <Th>제목</Th>
                      <Th>만든 사람</Th>
                      <Th>단계</Th>
                      <Th>제작 방식</Th>
                      <Th align="right">수정</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sc.projects.slice(0, 8).map((p) => (
                      <Tr key={p.id}>
                        <Td className="w-full max-w-0">
                          <div className="flex min-w-0 items-center gap-3">
                            <KindTile kind={p.kind} className="h-9 w-9" />
                            <div className="min-w-0">
                              <Link href={`/neander/shorts/projects/${p.id}`} className="block truncate font-medium hover:underline" title={p.title}>{p.title}</Link>
                              <p className="truncate text-[13px] text-nd-fg-3">
                                {spaceName.get(spaceOf(p)) ?? "?"} · {p.kind === "brand" ? p.clientName || "고객사" : p.product || (p.kind === "general" ? "일반 영상" : "상품 미정")}
                                {p.visibility === "team" ? " · 팀" : ""}
                              </p>
                            </div>
                          </div>
                        </Td>
                        <Td muted className="whitespace-nowrap">{nameOf(p.owner)}</Td>
                        <Td className="whitespace-nowrap"><StageBadge stage={p.stage} size="lg" /></Td>
                        <Td muted className="whitespace-nowrap">{MODE_LABEL[p.mode] ?? MODE_LABEL.ai}</Td>
                        <Td num muted className="whitespace-nowrap">{fmtWhen(p.updatedAt)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </Card>
          )}
        </section>

        <aside className="min-w-0 space-y-8">
          <section>
            <SectionHeader size="lg" title="예약 게시" hint="실행기가 그 시각 이후에 처리합니다" />
            {scheduled.length === 0 ? (
              <Card padding="none" className="flex items-center gap-3 px-4 py-3.5 text-nd-body text-nd-fg-3">
                <CalendarClock size={18} aria-hidden className="shrink-0" />
                잡힌 예약이 없습니다.
              </Card>
            ) : (
              <Card padding="none" className="divide-y divide-nd-line overflow-hidden">
                {scheduled.map((p) => {
                  const project = projectById.get(p.projectId);
                  const acc = accountById.get(p.accountId);
                  return (
                    <Link key={p.id} href={`/neander/shorts/projects/${p.projectId}?tab=publish`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-nd-fg/[.03]">
                      <KindTile kind={project?.kind ?? "coupang"} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-nd-body font-medium" title={project?.title}>{project?.title ?? "영상"}</p>
                        <p className="truncate text-[13px] text-nd-fg-3">
                          {PLATFORM_LABEL[p.platform]} · <span className="nd-num">{fmtWhen(p.scheduledAt)}</span> 이후{acc ? ` · ${acc.externalName}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <PubBadge status={p.status} size="lg" />
                        {acc?.status === "needs_reauth" && <Badge tone="danger" size="lg">다시 연결 필요</Badge>}
                      </div>
                    </Link>
                  );
                })}
              </Card>
            )}
            {scheduledBlocked > 0 && (
              <InlineNotice tone="danger" className="mt-3">
                예약 {scheduledBlocked}건의 게시 계정이 끊겨 있습니다 — <Link href="/neander/shorts/accounts" className="font-medium underline">내 채널 · 연결</Link>에서 다시 연결해야 예약 시각 이후에 게시됩니다.
              </InlineNotice>
            )}
            <InlineNotice tone="info" className="mt-3">
              예약은 <b>예약 시각 이후 실행기가 돌 때</b> 게시됩니다. 실행기는 ERP 화면이 열려 있을 때와 매일 06:30 cron 에 돕니다 — 정시 게시를 보장하려면 내 채널·연결의 안내를 보세요.
            </InlineNotice>
          </section>

          <section>
            <SectionHeader size="lg" title="연결 상태" action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="ghost" icon={Plug}>내 채널·연결</Button></Link>} />
            <Card padding="none" className="overflow-hidden">
              <ul className="divide-y divide-nd-line">
                <ConnRow label="AI (OpenRouter)" badge={<ConnBadge ok={s.openrouter.configured} size="lg" />} />
                <ConnRow label="YouTube 검색 키" extra={searchKey ?? undefined} badge={<ConnBadge ok={!!searchKey} size="lg" />} />
                <PublishRow label="YouTube 게시 (OAuth)" platform="youtube" serverOk={s.youtubeOAuth.configured && s.tokenKey.configured} accounts={d.accounts} />
                <PublishRow label="Instagram 게시 (Meta)" platform="instagram" serverOk={s.meta.configured && s.tokenKey.configured} accounts={d.accounts} />
                <ConnRow
                  label="내 쿠팡 파트너스 키"
                  extra={s.companyCoupang.configured && profile?.coupang.status !== "ok" ? "회사 공용 키 있음 (검색만)" : undefined}
                  badge={<Badge tone={keyStatus[1]} size="lg">{keyStatus[0]}</Badge>}
                />
              </ul>
              <StorageUsage usedMb={s.storage.usedMb} quotaMb={s.storage.quotaMb} />
            </Card>
          </section>
        </aside>
      </div>
    </PageShell>
  );
}

function ConnRow({ label, extra, badge }: { label: string; extra?: string; badge: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 truncate text-nd-body text-nd-fg">{label}</span>
      <span className="flex shrink-0 items-center gap-2.5">
        {extra && <span className="text-[13px] text-nd-fg-3">{extra}</span>}
        {badge}
      </span>
    </li>
  );
}

/** 게시 계정 — 게시에 꼭 필요하다. 없거나 끊기면 「연결 필요」 (빨강) */
function PublishRow({ label, platform, serverOk, accounts }: { label: string; platform: PublishPlatform; serverOk: boolean; accounts: AccountView[] }) {
  const mine = accounts.filter((a) => a.mine && a.platform === platform);
  const connected = mine.filter((a) => a.status === "connected").length;
  const [text, tone]: [string, Tone] = !serverOk
    ? ["연결 필요", "danger"]
    : mine.some((a) => a.status === "needs_reauth")
      ? ["다시 연결 필요", "danger"]
      : connected
        ? ["연결됨", "success"]
        : ["연결 필요", "danger"];
  return (
    <ConnRow
      label={label}
      extra={serverOk ? `내 계정 ${mine.length}` : "서버 설정 없음"}
      badge={<Badge tone={tone} size="lg">{text}</Badge>}
    />
  );
}

/** 파일 저장 용량 — Firestore 조각 (Storage 버킷 없음) */
function StorageUsage({ usedMb, quotaMb }: { usedMb: number; quotaMb: number }) {
  const ratio = quotaMb > 0 ? usedMb / quotaMb : null;
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const high = ratio !== null && ratio >= 0.9;
  return (
    <div className="border-t border-nd-line px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-nd-body text-nd-fg">파일 저장</span>
        <span className="nd-num text-[13px] text-nd-fg-2">
          {usedMb.toLocaleString("ko-KR")}MB / {quotaMb.toLocaleString("ko-KR")}MB
          {pct !== null && <b className={cn("ml-2 font-semibold", high ? "text-nd-danger-text" : "text-nd-fg")}>{pct}%</b>}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-nd-fg/[.08]"
        role="meter"
        aria-label="파일 저장 사용량"
        aria-valuemin={0}
        aria-valuemax={quotaMb}
        aria-valuenow={usedMb}
      >
        <div className={cn("h-full rounded-full", high ? "bg-nd-danger" : "bg-nd-accent")} style={{ width: `${Math.max(0, Math.min(100, (ratio ?? 0) * 100))}%` }} />
      </div>
      <p className="mt-2 text-[13px] text-nd-fg-3">
        Firestore 조각 — Storage 버킷 없음{high ? " · 용량이 거의 찼습니다" : ""}
      </p>
    </div>
  );
}

type SpaceRow = { space: SpaceView; agency: boolean; videos: number; inProgress: number; published: number; views: number | null; attention: number; accounts: number; waiting: number; monthMade: number };

/** 프로젝트 한 칸 — 누르면 그 프로젝트의 영상 화면으로 */
function SpaceTile({ r, current, onOpen }: { r: SpaceRow; current: boolean; onOpen: () => void }) {
  const cells: [string, number | null, string][] = r.agency
    ? [
        ["영상", r.videos, `이번 달 ${r.monthMade}`],
        ["승인 대기", r.waiting, ""],
        ["게시", r.published, `계정 ${r.accounts}`],
        ["확인할 일", r.attention, ""],
      ]
    : [
        ["영상", r.videos, `만드는 중 ${r.inProgress}`],
        ["게시", r.published, `계정 ${r.accounts}`],
        ["조회", r.views, "최근 기록 합"],
        ["확인할 일", r.attention, ""],
      ];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("rounded-nd-lg border bg-nd-content p-4 text-left transition-colors hover:bg-nd-sunken", current ? "border-nd-accent/50 ring-1 ring-nd-accent/30" : "border-nd-border")}
    >
      <div className="flex items-center gap-2">
        {r.agency ? <Briefcase size={18} aria-hidden className="shrink-0 text-nd-warning-text" /> : <FolderKanban size={18} aria-hidden className="shrink-0 text-nd-accent" />}
        <span className="truncate text-[16px] font-semibold">{r.space.name}</span>
        <span className="ml-auto shrink-0 text-[13px] text-nd-fg-3">{PRODUCTION_LABEL[r.space.production]}</span>
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        {cells.map(([label, v, hint]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13px] text-nd-fg-3">{label}</dt>
            <dd className={cn("nd-num text-[18px] font-semibold", (label === "확인할 일" || label === "승인 대기") && Number(v) > 0 && (label === "확인할 일" ? "text-nd-danger-text" : "text-nd-warning-text"))}>{v === null ? "—" : Number(v).toLocaleString("ko-KR")}</dd>
            {hint && <dd className="truncate text-[13px] text-nd-fg-3" title={hint}>{hint}</dd>}
          </div>
        ))}
      </dl>
    </button>
  );
}
