"use client";

// ============================================================
//  AI STUDIO — 대시보드 (2026-11 목업 01 개편)
// ------------------------------------------------------------
//  「지금 무엇을 해야 하나」 가 먼저다 — 맨 위 「오늘 먼저 확인하세요」 에 결과 확인이 필요한 게시 ·
//  검토할 AI 장면 · 고객 승인 대기 · 실패한 게시 / 작업 · 받을 돈 연체(재무 권한) · 수정 요청을 모으고
//  건마다 바로 가기를 붙인다. 그다음 지표 4칸 · 프로젝트별 현황(자체 운영 / 대행 · 업체별) ·
//  제작 흐름(단계를 누르면 그 단계 영상 목록) · 최근 영상 · 예약 게시 · 연결 상태.
//  「오늘 먼저 확인하세요」 아래에 오늘 아침 브리핑(프로젝트마다 · 메일로 받기 — market/BriefMail.tsx).
//  숫자는 전부 실제 기록에서 센다 — 예시 수치를 보여 주지 않는다. 모르는 값은 「미확인」.
//  AI STUDIO 프로젝트(채널)를 모두 본다 — 다른 화면은 위 툴바의 「프로젝트」 로 거른다.
// ============================================================

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarDays,
  CircleHelp,
  CircleX,
  Clapperboard,
  FileClock,
  FolderOpen,
  MessageSquareWarning,
  OctagonAlert,
  Plug,
  Plus,
  Radar,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { Badge, Button, EmptyState, PageShell, buttonClass, cn, type Tone } from "@/components/neander/ui";
import { Won } from "@/components/neander/shorts/agency-ui/won";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { JOB_LABEL, KindTile, PubBadge, StageBadge, Unknown, fmtWhen } from "@/components/neander/shorts/parts";
import { AttentionList, ProgressLine, RecordTable, SpaceKindBadge, StatusTile, StudioCard, StudioHeader, StudioMetric, StudioNotice, StudioSection, type AttentionItem, type RecordColumn } from "@/components/neander/shorts/studio";
import { SpaceSummaryCard, type SpaceCardStat } from "@/components/neander/shorts/agency-ui/space-card";
import { MorningBriefCard } from "@/components/neander/shorts/market/BriefMail";
import { fmtDateStr, fmtDayKst, overdueLines, rollupFinance, vatText, wonText } from "@/components/neander/shorts/agency-ui/finance";
import { PLATFORM_LABEL, REVIEW_LABEL, STAGE_LABEL, currentMonth, latestRound, monthProgress, projectTotals } from "@/lib/neander/shorts/model";
import { inContract } from "@/lib/neander/shorts/agency";
import { spaceKind, spaceOf, type SpaceView } from "@/lib/neander/shorts/spaces";
import { todayStrKST } from "@/lib/neander/format";
import type { AccountView, JobKind, MetricSnapshotView, ProjectDoc, ProjectStage, PublicationView, PublishPlatform } from "@/lib/neander/shorts/types";
import type { WithId } from "@/components/neander/shorts/ShortsProvider";

const FLOW: ProjectStage[] = ["research", "sourcing", "matching", "scripting", "editing", "ready"];
const MODE_LABEL = { remix: "기존 영상 재편집", hybrid: "소스 + AI 장면", ai: "전체 AI 생성" } as const;
const KEY_STATUS = { none: ["키 없음", "neutral"], unverified: ["넣음 · 확인 전", "warning"], ok: ["확인됨", "success"], failed: ["확인 실패", "danger"] } as const;
const REVIEW_TONE: Record<ProjectDoc["review"]["state"], Tone> = { approved: "success", waiting: "warning", revision: "danger", none: "neutral" };
const JOB_KIND: Record<JobKind, string> = { ai_video: "AI 장면", tts: "AI 음성", render: "출력", publish: "게시", metrics: "성과 수집" };
/** 확인할 일이 이보다 많으면 처음엔 이만큼만 펼친다 (「모두 보기」 로 나머지) */
const ATTENTION_FOLD = 8;

type Project = WithId<ProjectDoc>;
type SpaceStat = SpaceCardStat & { waiting: number };

export default function ShortsDashboard() {
  const { data, viewer, nameOf, space, setSpace, currentSpace } = useShorts();
  const d = data!;
  // 대시보드만 모든 프로젝트
  const sc = useScoped({ allSpaces: true });
  const router = useRouter();
  const [stageOpen, setStageOpen] = useState<ProjectStage | null>(null);
  const [allAttention, setAllAttention] = useState(false);
  const thisMonth = currentMonth();
  const today = todayStrKST();

  const live = useMemo(() => d.spaces.filter((x) => !x.archived), [d.spaces]);
  const spaceById = useMemo(() => new Map(d.spaces.map((x) => [x.id, x])), [d.spaces]);
  const clientById = useMemo(() => new Map(d.clients.map((c) => [c.id, c])), [d.clients]);
  const real = useMemo(() => sc.projects.filter((p) => !p.sample), [sc.projects]);
  const projectById = useMemo(() => new Map(sc.projects.map((p) => [p.id, p])), [sc.projects]);
  const accountById = useMemo(() => new Map(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const snapsBy = useMemo(() => {
    const m = new Map<string, MetricSnapshotView[]>();
    for (const x of sc.metrics) m.set(x.projectId, [...(m.get(x.projectId) ?? []), x]);
    return m;
  }, [sc.metrics]);
  const viewsOf = (id: string): number | null => projectTotals(snapsBy.get(id) ?? []).views;
  const whose = viewer === "mine" ? "내" : viewer === "visible" ? (d.admin ? "모든 사용자의" : "볼 수 있는") : `${nameOf(viewer)} 님의`;

  // ---- 프로젝트별 한눈에 — 영상 · 만드는 중 · 게시 · 조회(출처별 마지막 기록 합) · 계정 · 확인할 일
  const stats = useMemo(() => {
    const m = new Map<string, SpaceStat>();
    for (const x of live) {
      const agency = spaceKind(x) === "agency";
      const ps = real.filter((p) => spaceOf(p) === x.id);
      const ids = new Set(ps.map((p) => p.id));
      const pubs = sc.publications.filter((p) => ids.has(p.projectId));
      const views = ps.map((p) => projectTotals(snapsBy.get(p.id) ?? []).views).filter((v): v is number => v !== null);
      const review = ps.reduce((n, p) => n + p.scenes.filter((s) => s.kind === "ai" && s.ai?.status === "review").length, 0);
      const making = ps.filter((p) => p.stage !== "published" && p.stage !== "archived");
      const latest = [...making].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      m.set(x.id, {
        videos: ps.length,
        inProgress: making.length,
        published: pubs.filter((p) => p.status === "published").length,
        views: views.length ? views.reduce((a, b) => a + b, 0) : null,
        attention: pubs.filter((p) => p.status === "uncertain" || p.status === "failed").length + review,
        // 자체 운영은 우리 계정만, 대행은 그 프로젝트에 붙은 고객사 계정까지
        accounts: d.accounts.filter((a) => spaceOf(a) === x.id && (agency || !a.clientId)).map((a) => ({ name: a.externalName, platform: a.platform, reauth: a.status === "needs_reauth" })),
        latest: latest ? { id: latest.id, title: latest.title, stage: latest.stage } : null,
        waiting: ps.filter((p) => p.review?.state === "waiting").length,
      });
    }
    return m;
  }, [live, real, sc.publications, snapsBy, d.accounts]);
  const ownSpaces = live.filter((x) => spaceKind(x) === "own");

  // ---- 대행은 업체마다 — 이번 달 제작 · 승인 대기 · 재무 계약(권한이 있을 때) · 그 아래 프로젝트
  const agencyGroups = useMemo(() => {
    const agencySpaces = live.filter((x) => spaceKind(x) === "agency");
    const ids = [...new Set([...agencySpaces.map((x) => x.clientId ?? ""), ...d.clients.filter((c) => c.status === "active").map((c) => c.id)])].filter(Boolean);
    return ids
      .map((id) => {
        const client = clientById.get(id) ?? null;
        const vids = real.filter((p) => p.kind === "brand" && p.clientId === id && p.month === thisMonth);
        return {
          id,
          client,
          name: client?.name ?? "(볼 수 없는 업체)",
          spaces: agencySpaces.filter((x) => x.clientId === id),
          prog: monthProgress(vids, client?.contract.videosPerMonth ?? 0),
          inContract: client ? inContract(client, thisMonth) && client.status === "active" : false,
          fin: d.financeAccess ? rollupFinance(d.clientFinance[id]) : null,
          overdue: d.financeAccess ? overdueLines(d.clientFinance[id], today) : [],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [live, d.clients, d.financeAccess, d.clientFinance, clientById, real, thisMonth, today]);

  // ---- 오늘 먼저 확인하세요 — 지금 기록에 있는 것만, 건마다 바로 가기
  const attention = useMemo(() => {
    const items: AttentionItem[] = [];
    const where = (pid: string) => {
      const p = projectById.get(pid);
      return p ? (spaceById.get(spaceOf(p))?.name ?? "") : "";
    };
    const titleOf = (pid: string) => projectById.get(pid)?.title ?? "영상";
    for (const p of sc.publications.filter((x) => x.status === "uncertain")) {
      items.push({
        key: `pub-${p.id}`,
        label: "결과 확인 필요",
        tone: "warning",
        icon: CircleHelp,
        title: `${titleOf(p.projectId)} · ${PLATFORM_LABEL[p.platform]}`,
        detail: `${p.error?.message ?? `${PLATFORM_LABEL[p.platform]}에서 게시 결과를 아직 확인하지 못했습니다 — 플랫폼에서 확인해 기록해 주세요.`}${where(p.projectId) ? ` · ${where(p.projectId)}` : ""}`,
        href: "/neander/shorts/publish",
        actionLabel: "확인하기",
      });
    }
    for (const p of real) {
      const n = p.scenes.filter((s) => s.kind === "ai" && s.ai?.status === "review").length;
      if (!n)
        continue;
      items.push({
        key: `rev-${p.id}`,
        label: "AI 장면 검토",
        tone: "info",
        icon: Sparkles,
        title: `${p.title} · 장면 ${n}개`,
        detail: `생성된 장면이 제품 사실과 맞는지 검토해 주세요 — 사람이 승인해야 출력에 쓰입니다.${where(p.id) ? ` · ${where(p.id)}` : ""}`,
        href: `/neander/shorts/projects/${p.id}?tab=edit`,
        actionLabel: "장면 검토",
      });
    }
    for (const p of real.filter((x) => x.kind === "brand" && x.review.state === "waiting")) {
      const r = latestRound(p.review);
      items.push({
        key: `wait-${p.id}`,
        label: "고객 승인 대기",
        tone: "neutral",
        icon: FileClock,
        title: `${p.title} · ${p.clientName || "고객사"}`,
        detail: r ? `${fmtDayKst(r.sentAt)}에 보낸 ${r.n}차 검토 답변을 기다리고 있습니다.` : "고객 검토 답변을 기다리고 있습니다.",
        href: `/neander/shorts/projects/${p.id}?tab=review`,
        actionLabel: "검토 보기",
      });
    }
    for (const p of sc.publications.filter((x) => x.status === "failed")) {
      items.push({
        key: `pubf-${p.id}`,
        label: "게시 실패",
        tone: "danger",
        icon: CircleX,
        title: `${titleOf(p.projectId)} · ${PLATFORM_LABEL[p.platform]}`,
        detail: p.error?.message ?? "게시하지 못했습니다 — 원인을 확인하고 다시 게시하세요.",
        href: `/neander/shorts/projects/${p.projectId}?tab=publish`,
        actionLabel: "게시 보기",
      });
    }
    for (const j of d.jobs.filter((x) => projectById.has(x.projectId) && ["failed", "uncertain", "interrupted"].includes(x.status) && (x.finishedAt ?? 0) > Date.now() - 3 * 86_400_000)) {
      items.push({
        key: `job-${j.id}`,
        label: `${JOB_KIND[j.kind] ?? "작업"} ${j.status === "failed" ? "실패" : JOB_LABEL[j.status]}`,
        tone: j.status === "failed" ? "danger" : "warning",
        icon: OctagonAlert,
        title: titleOf(j.projectId),
        detail: j.error?.message || (j.status === "interrupted" ? "작업이 중단됐습니다 — 마지막 상태부터 다시 시작할 수 있습니다." : "결과를 확인해 주세요."),
        href: `/neander/shorts/projects/${j.projectId}?tab=${j.kind === "publish" ? "publish" : "edit"}`,
        actionLabel: j.kind === "render" ? "출력 보기" : "작업 보기",
      });
    }
    for (const g of agencyGroups) {
      for (const o of g.overdue) {
        items.push({
          key: `due-${o.key}`,
          label: "받을 돈 연체",
          tone: "danger",
          icon: Banknote,
          title: `${g.name} · ${o.kind || "회차"}`,
          detail: `${o.dueDate} 예정 · ${wonText(o.amount)}(${vatText(o.vat)}) · ${o.days}일 지남 — 재무에서 입금 기록을 확인하세요.`,
          href: `/neander/shorts/clients/${g.id}?tab=finance`,
          actionLabel: "재무 보기",
        });
      }
    }
    for (const p of real.filter((x) => x.kind === "brand" && x.review.state === "revision")) {
      const limit = clientById.get(p.clientId ?? "")?.contract.revisionLimit;
      const over = limit !== undefined && p.review.revisionsUsed > limit;
      const r = latestRound(p.review);
      items.push({
        key: `fix-${p.id}`,
        label: "수정 요청",
        tone: over ? "danger" : "warning",
        icon: MessageSquareWarning,
        title: `${p.title} · ${p.clientName || "고객사"}`,
        detail: `${r?.feedback ? `고객 메모: “${r.feedback}” · ` : ""}수정 ${p.review.revisionsUsed}${limit !== undefined ? ` / ${limit}회` : "회"}${over ? " · 상한 초과 — 추가 수정은 고객사와 범위를 협의하세요" : ""}`,
        href: `/neander/shorts/projects/${p.id}?tab=review`,
        actionLabel: "수정 내용",
      });
    }
    return items;
  }, [sc.publications, real, d.jobs, projectById, spaceById, agencyGroups, clientById]);

  // ---- 지표
  const making = real.filter((p) => p.stage !== "published" && p.stage !== "archived");
  const makingAgency = making.filter((p) => spaceKind(spaceById.get(spaceOf(p))) === "agency").length;
  const activeGroups = agencyGroups.filter((g) => g.inContract);
  const agencyMade = agencyGroups.reduce((n, g) => n + g.prog.made, 0);
  const agencyPlanned = activeGroups.reduce((n, g) => n + (g.client?.contract.videosPerMonth ?? 0), 0);
  const knownViews = real.map((p) => viewsOf(p.id)).filter((v): v is number => v !== null);

  // ---- 제작 흐름 — 단계별 영상 수 (쿠팡 · 고객사 · 일반)
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FLOW.map((s) => {
          const ps = real.filter((p) => p.stage === s);
          return [s, { all: ps.length, coupang: ps.filter((p) => p.kind === "coupang").length, brand: ps.filter((p) => p.kind === "brand").length, general: ps.filter((p) => p.kind === "general").length }];
        }),
      ) as Record<ProjectStage, { all: number; coupang: number; brand: number; general: number }>,
    [real],
  );
  const stageRows = stageOpen ? [...real.filter((p) => p.stage === stageOpen)].sort((a, b) => b.updatedAt - a.updatedAt) : [];

  const scheduled = sc.publications.filter((p) => p.status === "scheduled").sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const scheduledBlocked = scheduled.filter((p) => accountById.get(p.accountId)?.status === "needs_reauth").length;
  const s = d.status;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const keyStatus = KEY_STATUS[profile?.coupang.status ?? "none"];
  const searchKey = profile?.youtubeKey.configured ? "내 키 사용" : s.youtubeSearch.configured ? "회사 키 사용" : null;
  const openSpace = (id: string) => {
    setSpace(id);
    router.push("/neander/shorts/projects");
  };
  // 브리핑 카드의 「시장 트렌드에서 보기」 — 그 프로젝트로 바꿔 시장 트렌드로
  const openMarket = (id: string) => {
    setSpace(id);
    router.push("/neander/shorts/market");
  };
  const many = attention.length > 3;
  const shownAttention = allAttention || attention.length <= ATTENTION_FOLD ? attention : attention.slice(0, ATTENTION_FOLD);
  const dateText = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" });

  const videoColumns: RecordColumn<Project>[] = [
    {
      key: "title",
      header: "제목 · 프로젝트",
      mobile: "title",
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <KindTile kind={p.kind} className="hidden h-9 w-9 md:inline-flex" />
          <div className="min-w-0">
            <span className="block truncate font-medium" title={p.title}>
              {p.title}
            </span>
            <span className="block truncate text-[13px] font-normal text-nd-fg-3">
              {spaceById.get(spaceOf(p))?.name ?? "?"} · {p.kind === "brand" ? `대행 · ${p.clientName || "고객사"}` : p.product || (p.kind === "general" ? "일반 영상" : "상품 미정")}
              {p.visibility === "team" ? " · 팀 공개" : ""}
            </span>
          </div>
        </div>
      ),
    },
    { key: "owner", header: "만든 사람", cell: (p) => <span className="whitespace-nowrap text-nd-fg-2">{nameOf(p.owner)}</span> },
    {
      key: "stage",
      header: "현재 단계",
      cell: (p) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <StageBadge stage={p.stage} size="lg" />
          {p.kind === "brand" && p.review.state !== "none" && (
            <Badge tone={REVIEW_TONE[p.review.state]} size="lg">
              {REVIEW_LABEL[p.review.state]}
              {p.review.revisionsUsed > (clientById.get(p.clientId ?? "")?.contract.revisionLimit ?? Infinity) ? " · 상한 초과" : ""}
            </Badge>
          )}
        </span>
      ),
    },
    { key: "mode", header: "제작 방식", cell: (p) => <span className="whitespace-nowrap text-nd-fg-2">{MODE_LABEL[p.mode] ?? MODE_LABEL.ai}</span> },
    { key: "at", header: "수정 시각", align: "right", cell: (p) => <span className="whitespace-nowrap text-nd-fg-2">{fmtWhen(p.updatedAt)}</span> },
  ];

  const scheduleColumns: RecordColumn<PublicationView>[] = [
    { key: "at", header: "예정 시각", mobile: "title", cell: (p) => <span className="nd-num whitespace-nowrap font-medium">{fmtWhen(p.scheduledAt)} 이후</span> },
    {
      key: "video",
      header: "영상 · 프로젝트",
      cell: (p) => {
        const project = projectById.get(p.projectId);
        return (
          <span className="block min-w-0">
            <span className="block truncate font-medium" title={project?.title}>
              {project?.title ?? "영상"}
            </span>
            <span className="block truncate text-[13px] text-nd-fg-3">{project ? (spaceById.get(spaceOf(project))?.name ?? "") : ""}</span>
          </span>
        );
      },
    },
    {
      key: "where",
      header: "플랫폼 · 계정",
      cell: (p) => {
        const acc = accountById.get(p.accountId);
        return (
          <span className="whitespace-nowrap text-nd-fg-2">
            {PLATFORM_LABEL[p.platform]}
            {acc ? ` · ${acc.externalName}` : " · 계정 확인 필요"}
          </span>
        );
      },
    },
    {
      key: "state",
      header: "준비 상태",
      cell: (p) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <PubBadge status={p.status} size="lg" />
          {accountById.get(p.accountId)?.status === "needs_reauth" && (
            <Badge tone="danger" size="lg">
              다시 연결 필요
            </Badge>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker={dateText}
        kickerIcon={Sun}
        title={many ? `확인할 일 ${attention.length}건` : "오늘의 작업을 한눈에"}
        description={
          many
            ? `${whose} 영상 기준 — 게시 결과, 고객 수정, 실패한 작업과 연체를 한곳에서 처리하세요. 모든 프로젝트를 합쳐 봅니다.`
            : `${whose} 영상 기준 — 확인이 필요한 일부터, 자체 채널과 대행 프로젝트의 진행 상황까지 모든 프로젝트를 합쳐 봅니다.`
        }
        actions={
          <>
            <Link href="/neander/shorts/trends" className={buttonClass("secondary", "md", "gap-1.5")}>
              <Radar size={16} aria-hidden />
              소재 발굴
            </Link>
            {/* 새 영상은 지금 프로젝트(위 띠 · 툴바)에 만들어진다 — 영상 목록에서 창이 바로 열린다 */}
            <Link href="/neander/shorts/projects?new=1" className={buttonClass("primary", "md", "gap-1.5")} title={currentSpace ? `「${currentSpace.name}」 에 새 영상` : undefined}>
              <Plus size={16} aria-hidden />
              새 영상
            </Link>
          </>
        }
      />

      {/* 지표 4칸 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StudioMetric label="확인할 일" value={attention.length.toLocaleString("ko-KR")} unit="건" tone={attention.length ? "accent" : undefined} detail="게시 결과 · AI 장면 · 고객 검토" href="#today" />
        <StudioMetric label="진행 중 영상" value={making.length.toLocaleString("ko-KR")} unit="편" detail={`자체 운영 ${making.length - makingAgency} · 대행 ${makingAgency}`} />
        <StudioMetric
          label="이번 달 대행 제작"
          value={agencyGroups.length ? agencyMade.toLocaleString("ko-KR") : "—"}
          unit={agencyGroups.length ? `/ ${agencyPlanned.toLocaleString("ko-KR")}편` : undefined}
          detail={agencyGroups.length ? activeGroups.map((g) => g.name).join(" · ") || "계약 기간 안인 업체 없음" : "볼 수 있는 대행 업체 없음"}
        />
        <StudioMetric
          label="누적 조회"
          value={knownViews.length ? knownViews.reduce((a, b) => a + b, 0).toLocaleString("ko-KR") : <Unknown />}
          unit={knownViews.length ? "회" : undefined}
          detail={knownViews.length ? `확인된 플랫폼 기록 합계 · ${knownViews.length}편` : "아직 확인한 조회 기록이 없습니다"}
        />
      </div>

      {/* 오늘 먼저 확인하세요 */}
      <StudioCard
        id="today"
        className="mb-8 scroll-mt-24"
        title={
          <span className="inline-flex items-center gap-2">
            오늘 먼저 확인하세요
            {attention.length > 0 && (
              <Badge tone="warning" size="lg">
                {attention.length}건
              </Badge>
            )}
          </span>
        }
        description={attention.length ? "결과 확인 → AI 장면 → 고객 승인 → 실패 → 연체 → 수정 요청 순서입니다." : undefined}
      >
        {attention.length === 0 ? (
          <p className="flex items-center gap-2.5 py-1 text-nd-body text-nd-fg-3">
            <CircleHelp size={18} aria-hidden className="shrink-0" />
            지금 확인할 일이 없습니다 — 결과가 불확실한 게시 · 실패한 작업 · 검토할 AI 장면 · 고객 승인 · 연체가 생기면 여기에 모입니다.
          </p>
        ) : (
          <>
            <AttentionList items={shownAttention} />
            {attention.length > ATTENTION_FOLD && (
              <div className="mt-2 border-t border-nd-line pt-3">
                <Button size="sm" variant="ghost" onClick={() => setAllAttention((v) => !v)}>
                  {allAttention ? "처음 " + ATTENTION_FOLD + "건만 보기" : `나머지 ${attention.length - ATTENTION_FOLD}건 더 보기`}
                </Button>
              </div>
            )}
          </>
        )}
      </StudioCard>

      {/* 오늘 아침 브리핑 — 프로젝트마다 (시장 트렌드 · 07:30) · 메일로 받기 */}
      <MorningBriefCard className="mb-8" onOpen={openMarket} />

      {/* 프로젝트별 현황 */}
      <StudioSection
        className="mb-8"
        title="프로젝트별 현황"
        description="대시보드에서는 모든 프로젝트를 한 번에 봅니다. 「이 프로젝트로」 를 누르면 그 프로젝트의 영상 화면으로 갑니다."
        action={
          <Link href="/neander/shorts/spaces" className={buttonClass("ghost", "sm", "gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            프로젝트 관리
          </Link>
        }
      >
        <h3 className="mb-2.5 flex items-center gap-1.5 text-[14px] font-semibold text-nd-fg-2">
          <FolderOpen size={16} aria-hidden />
          자체 운영
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {ownSpaces.map((x) => (
            <SpaceSummaryCard key={x.id} s={x} stat={stats.get(x.id)!} current={x.id === space} onOpen={() => openSpace(x.id)} editHref={`/neander/shorts/spaces?edit=${x.id}`} />
          ))}
        </div>

        <h3 className="mb-2.5 mt-6 flex items-center gap-1.5 text-[14px] font-semibold text-nd-fg-2">
          <Building2 size={16} aria-hidden />
          대행 · 업체별
        </h3>
        {agencyGroups.length === 0 ? (
          <p className="rounded-nd-md border border-dashed border-nd-line px-4 py-3 text-nd-body text-nd-fg-3">
            볼 수 있는 대행 업체가 없습니다 — 업체는 관리자와 그 업체 담당자에게만 보입니다. <Link href="/neander/shorts/clients" className="font-medium text-nd-accent hover:underline">업체 · 계약</Link>
          </p>
        ) : (
          <div className="space-y-4">
            {agencyGroups.map((g) => (
              <AgencyGroupCard key={g.id} g={g} month={thisMonth} financeAccess={d.financeAccess} stats={stats} current={space} onOpen={openSpace} />
            ))}
          </div>
        )}
      </StudioSection>

      {/* 제작 흐름 */}
      <StudioSection className="mb-8" title="제작 흐름" description="단계를 누르면 그 단계의 영상 목록이 아래에 열립니다 (모든 프로젝트).">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {FLOW.map((st) => {
            const c = counts[st];
            const parts = [c.coupang || st === "ready" ? `쿠팡 ${c.coupang}` : "", c.brand || st === "ready" ? `고객사 ${c.brand}` : "", c.general ? `일반 ${c.general}` : ""].filter(Boolean);
            const on = stageOpen === st;
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                disabled={c.all === 0}
                onClick={() => setStageOpen(on ? null : st)}
                className={cn(
                  "nd-surface min-w-0 rounded-nd-lg px-5 py-4 text-left transition-colors enabled:hover:bg-nd-sunken disabled:cursor-default",
                  on && "ring-2 ring-nd-accent/50",
                )}
              >
                <span className="block truncate text-[13px] font-medium text-nd-fg-3">{STAGE_LABEL[st]}</span>
                <span className="nd-num mt-2 block text-[26px] font-bold leading-tight text-nd-fg">
                  {c.all.toLocaleString("ko-KR")}
                  <span className="ml-1 text-[14px] font-medium text-nd-fg-2">편</span>
                </span>
                <span className="mt-1.5 block min-h-[1.25rem] text-[13px] text-nd-fg-3">{c.all || st === "ready" ? parts.join(" · ") : ""}</span>
              </button>
            );
          })}
        </div>
        {stageOpen && (
          <StudioCard
            className="mt-3"
            flush
            title={`${STAGE_LABEL[stageOpen]} · ${stageRows.length}편`}
            action={
              <Button size="sm" variant="ghost" icon={X} onClick={() => setStageOpen(null)}>
                닫기
              </Button>
            }
          >
            <RecordTable rows={stageRows} columns={videoColumns} rowKey={(p) => p.id} rowHref={(p) => `/neander/shorts/projects/${p.id}`} ariaLabel={`${STAGE_LABEL[stageOpen]} 영상`} className="px-0 pb-2 md:pb-0 [&>ul]:px-4 [&>ul]:pb-2" />
          </StudioCard>
        )}
      </StudioSection>

      {/* 최근 영상 */}
      <StudioCard
        className="mb-8"
        flush
        title="최근 영상"
        action={
          <Link href="/neander/shorts/projects" className={buttonClass("ghost", "sm", "gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            전체 영상
          </Link>
        }
      >
        <RecordTable
          rows={sc.projects.slice(0, 8)}
          columns={videoColumns}
          rowKey={(p) => p.id}
          rowHref={(p) => `/neander/shorts/projects/${p.id}`}
          ariaLabel="최근 영상"
          className="[&>ul]:px-4 [&>ul]:pb-4"
          empty={
            <div className="px-5 pb-5 sm:px-6">
              <EmptyState compact icon={Clapperboard} title="아직 영상이 없습니다" description="소재 발굴에서 후보를 저장한 뒤 「영상 만들기」 를 누르거나, 영상 화면에서 바로 만드세요. 고객사 영상은 업체 화면에서 만듭니다." />
            </div>
          }
        />
      </StudioCard>

      {/* 예약 게시 */}
      <StudioCard
        className="mb-8"
        flush
        title="예약 게시"
        description="실행기가 예약 시각 이후에 처리합니다"
        action={
          <Link href="/neander/shorts/calendar" className={buttonClass("ghost", "sm", "gap-1.5")}>
            <CalendarDays size={15} aria-hidden />
            일정에서 보기
          </Link>
        }
      >
        <RecordTable
          rows={scheduled}
          columns={scheduleColumns}
          rowKey={(p) => p.id}
          rowHref={(p) => `/neander/shorts/projects/${p.projectId}?tab=publish`}
          ariaLabel="예약 게시"
          className="[&>ul]:px-4"
          empty={<p className="px-5 pb-1 text-nd-body text-nd-fg-3 sm:px-6">잡힌 예약이 없습니다.</p>}
        />
        <div className="space-y-3 px-5 pb-5 pt-4 sm:px-6">
          {scheduledBlocked > 0 && (
            <StudioNotice
              tone="danger"
              title={`예약 ${scheduledBlocked}건의 게시 계정이 끊겨 있습니다`}
              action={
                <Link href="/neander/shorts/accounts/connect" className={buttonClass("secondary", "sm", "gap-1.5")}>
                  <Plug size={15} aria-hidden />
                  다시 연결
                </Link>
              }
            >
              다시 연결해야 예약 시각 이후에 게시됩니다.
            </StudioNotice>
          )}
          <p className="text-[13px] leading-relaxed text-nd-fg-3">
            예약은 <b className="font-semibold text-nd-fg-2">예약 시각 이후 실행기가 돌 때</b> 게시됩니다. 실행기는 ERP 화면이 열려 있을 때와 매일 06:30 cron 에 돕니다 — 정시 게시를 보장하려면 내 채널 · 연결의 안내를 보세요.
          </p>
        </div>
      </StudioCard>

      {/* 연결 상태 */}
      <StudioCard title="연결 상태">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatusTile label="AI (OpenRouter)" status={s.openrouter.configured ? "연결됨" : "설정 필요"} tone={s.openrouter.configured ? "success" : "danger"} detail={s.openrouter.configured ? undefined : "서버에 AI 키가 없어 생성 · 분석을 쓸 수 없습니다"} />
          <StatusTile
            label="YouTube 검색 키"
            status={searchKey ?? "키 없음"}
            tone={searchKey ? "success" : "warning"}
            detail={`오늘 검색 ${d.quotas.youtubeSearch.used.toLocaleString("ko-KR")} / ${d.quotas.youtubeSearch.limit.toLocaleString("ko-KR")}회`}
          />
          <PublishTile label="YouTube 게시" platform="youtube" serverOk={s.youtubeOAuth.configured && s.tokenKey.configured} accounts={d.accounts} />
          <PublishTile label="Instagram 게시" platform="instagram" serverOk={s.meta.configured && s.tokenKey.configured} accounts={d.accounts} />
          <StatusTile label="내 쿠팡 파트너스 키" status={keyStatus[0]} tone={keyStatus[1]} detail={s.companyCoupang.configured && profile?.coupang.status !== "ok" ? "회사 공용 키 있음 (검색만)" : undefined} />
          <StorageTile usedMb={s.storage.usedMb} quotaMb={s.storage.quotaMb} bucket={s.storage.bucket} />
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-nd-line pt-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] leading-relaxed text-nd-fg-3">
            매일 아침 자동 실행 — 06:30 예약 게시 · 레이더 · 성과 수집 · 07:00 바이럴 형식 수집 · 07:30 시장 브리핑
            {!s.cron.configured && <b className="ml-1.5 font-semibold text-nd-warning-text">· 서버에 cron 설정이 없어 자동 실행이 돌지 않습니다</b>}
          </p>
          <Link href="/neander/shorts/accounts/connect" className={buttonClass("ghost", "sm", "shrink-0 gap-1.5 self-start sm:self-auto")}>
            <Plug size={15} aria-hidden />
            연결 관리
          </Link>
        </div>
      </StudioCard>
    </PageShell>
  );
}

// ---- 대행 업체 한 묶음 -------------------------------------------------------

type Group = {
  id: string;
  client: { name: string; contract: { videosPerMonth: number; revisionLimit: number } } | null;
  name: string;
  spaces: SpaceView[];
  prog: ReturnType<typeof monthProgress>;
  inContract: boolean;
  fin: ReturnType<typeof rollupFinance>;
  overdue: ReturnType<typeof overdueLines>;
};

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-medium text-nd-fg-3">{children}</div>;
}

function AgencyGroupCard({ g, month, financeAccess, stats, current, onOpen }: { g: Group; month: string; financeAccess: boolean; stats: Map<string, SpaceStat>; current: string; onOpen: (id: string) => void }) {
  const planned = g.client?.contract.videosPerMonth ?? 0;
  return (
    <StudioCard
      title={
        <Link href={`/neander/shorts/clients/${g.id}`} className="hover:underline">
          {g.name}
        </Link>
      }
      action={
        <>
          <SpaceKindBadge kind="agency" />
          <Link href={`/neander/shorts/clients/${g.id}`} className={buttonClass("ghost", "sm", "gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            업체 · 계약 보기
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-5 xl:grid-cols-4 xl:gap-x-6">
        <div className="min-w-0">
          <Label>이번 달 제작 / 계약</Label>
          <div className="nd-num mt-1 text-[20px] font-bold text-nd-fg">
            {g.prog.made} <span className="text-nd-fg-3">/</span> {g.inContract ? `${planned}편` : <span className="text-[15px] font-medium text-nd-fg-3">계약 기간 밖</span>}
          </div>
          {g.inContract && <ProgressLine className="mt-2" value={g.prog.made} total={planned} />}
          <p className="mt-1.5 text-[13px] text-nd-fg-3">
            승인 대기 {g.prog.waiting}편 · 고객 승인 {g.prog.approved}편 · {Number(month.slice(5))}월 계약
          </p>
        </div>
        {!financeAccess ? (
          <div className="min-w-0 xl:col-span-2">
            <Label>입금 · 다음 받을 날</Label>
            <p className="mt-1 text-[14px] text-nd-fg-3">재무 계약 · 입금은 재무 권한이 있는 사람에게만 보입니다.</p>
          </div>
        ) : !g.fin ? (
          <div className="min-w-0 xl:col-span-2">
            <Label>입금 · 다음 받을 날</Label>
            <p className="mt-1 text-[14px] text-nd-fg-3">
              이은 재무 계약이 없습니다 —{" "}
              <Link href={`/neander/shorts/clients/${g.id}?tab=finance`} className="font-medium text-nd-accent hover:underline">
                재무 · 계약서
              </Link>
              에서 잇습니다.
            </p>
          </div>
        ) : (
          <>
            <div className="min-w-0">
              <Label>누적 입금 / 계약</Label>
              <div className="mt-1 text-[20px] font-bold">{g.fin.received === null ? <Unknown title="회차가 없어 받은 돈을 셀 수 없습니다" /> : <Won value={g.fin.received} flow="income" />}</div>
              <p className="mt-1.5 text-[13px] text-nd-fg-3">
                / {wonText(g.fin.contract)} 계약 · {vatText(g.fin.vat)}
              </p>
            </div>
            <div className="min-w-0">
              <Label>다음 받을 날</Label>
              <div className="nd-num mt-1 text-[20px] font-bold text-nd-fg">{g.fin.next ? fmtDateStr(g.fin.next.date) : "—"}</div>
              <p className="mt-1.5 text-[13px] text-nd-fg-3">{g.fin.next ? `${wonText(g.fin.next.amount)} · ${vatText(g.fin.next.vat)}` : "잡힌 회차 없음"}</p>
            </div>
          </>
        )}
        <div className="min-w-0">
          <Label>관리할 일</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {g.overdue.length > 0 && (
              <Badge tone="danger" size="lg">
                연체 {g.overdue.length}건
              </Badge>
            )}
            {g.prog.revision > 0 && (
              <Badge tone="warning" size="lg">
                수정 요청 {g.prog.revision}편
              </Badge>
            )}
            {g.prog.waiting > 0 && (
              <Badge tone="neutral" size="lg">
                승인 대기 {g.prog.waiting}편
              </Badge>
            )}
            {!g.overdue.length && !g.prog.revision && !g.prog.waiting && <span className="text-[14px] text-nd-fg-3">없음</span>}
          </div>
          {g.overdue.length > 0 && <p className="mt-1.5 text-[13px] text-nd-fg-3">미수 내역 확인 필요</p>}
        </div>
      </div>
      <div className="mt-5 border-t border-nd-line pt-4">
        {g.spaces.length === 0 ? (
          <p className="text-[14px] text-nd-fg-3">
            이 업체의 프로젝트가 아직 없습니다 —{" "}
            <Link href={`/neander/shorts/clients/${g.id}?tab=spaces`} className="font-medium text-nd-accent hover:underline">
              업체 화면
            </Link>
            에서 브랜드(채널)마다 만듭니다.
          </p>
        ) : (
          <ul className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
            {g.spaces.map((x) => {
              const st = stats.get(x.id);
              return (
                <li key={x.id} className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-nd-fg">{x.name}</span>
                      {x.id === current && (
                        <Badge tone="accent" size="lg">
                          지금 프로젝트
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-[13px] text-nd-fg-3">
                      영상 {st?.videos ?? 0}편 · 게시 {st?.published ?? 0}건 · 계정 {st?.accounts.length ?? 0}개{st?.attention ? ` · 확인할 일 ${st.attention}건` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" icon={ArrowUpRight} onClick={() => onOpen(x.id)}>
                    프로젝트로
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </StudioCard>
  );
}

// ---- 연결 칸 -----------------------------------------------------------------

/** 게시 계정 — 게시에 꼭 필요하다. 없거나 끊기면 「연결 필요」 (빨강) */
function PublishTile({ label, platform, serverOk, accounts }: { label: string; platform: PublishPlatform; serverOk: boolean; accounts: AccountView[] }) {
  const mine = accounts.filter((a) => a.mine && a.platform === platform);
  const connected = mine.filter((a) => a.status === "connected").length;
  const [text, tone]: [string, Tone] = !serverOk
    ? ["연결 필요", "danger"]
    : mine.some((a) => a.status === "needs_reauth")
      ? ["다시 연결 필요", "danger"]
      : connected
        ? ["연결됨", "success"]
        : ["연결 필요", "danger"];
  return <StatusTile label={label} status={text} tone={tone} detail={serverOk ? `내 계정 ${mine.length}개 · 연결됨 ${connected}` : "서버 설정 없음"} />;
}

/** 파일 저장 용량 — Firestore 조각 (Storage 버킷이 켜지면 함께) */
function StorageTile({ usedMb, quotaMb, bucket }: { usedMb: number; quotaMb: number; bucket: { ready: boolean; quotaMb: number; usedMb: number } }) {
  const ratio = quotaMb > 0 ? usedMb / quotaMb : null;
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const high = ratio !== null && ratio >= 0.9;
  return (
    <StatusTile
      label="파일 저장 용량"
      status={`${usedMb.toLocaleString("ko-KR")}MB / ${quotaMb.toLocaleString("ko-KR")}MB`}
      tone={high ? "danger" : "neutral"}
      detail={
        <>
          <ProgressLine value={usedMb} total={quotaMb} tone={high ? "danger" : "accent"} className="mb-1.5 mt-1" />
          {pct !== null ? `${pct}% · ` : ""}
          {bucket.ready ? `Storage 버킷 ${bucket.usedMb.toLocaleString("ko-KR")}MB / ${bucket.quotaMb.toLocaleString("ko-KR")}MB` : "Firestore 조각 — Storage 버킷 없음"}
          {high ? " · 용량이 거의 찼습니다" : ""}
        </>
      }
    />
  );
}
