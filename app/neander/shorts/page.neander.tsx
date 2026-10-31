"use client";

// ============================================================
//  AI STUDIO — 대시보드
// ------------------------------------------------------------
//  「지금 무엇을 해야 하나」 가 먼저다: 결과 확인이 필요한 게시 · 검토할 AI 장면 ·
//  끊긴 출력. 그다음 단계별 영상 수와 최근 영상, 연결 상태.
//  숫자는 전부 실제 기록에서 센다 — 예시 수치를 보여 주지 않는다.
// ============================================================

import Link from "next/link";
import { useMemo } from "react";
import { CircleAlert, Clapperboard, Plug, Radar } from "lucide-react";
import { Button, Card, EmptyState, InlineNotice, KpiItem, KpiStrip, PageHeader, PageShell, SectionHeader, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { ConnBadge, JobBadge, PubBadge, StageBadge, fmtWhen } from "@/components/neander/shorts/parts";
import { PLATFORM_LABEL, STAGE_LABEL } from "@/lib/neander/shorts/model";
import type { ProjectStage } from "@/lib/neander/shorts/types";

const FLOW: ProjectStage[] = ["research", "sourcing", "matching", "scripting", "editing", "ready", "published"];

export default function ShortsDashboard() {
  const { data, viewer, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const projectName = useMemo(() => new Map(sc.projects.map((p) => [p.id, p.title])), [sc.projects]);
  const whose = viewer === "mine" ? "내" : viewer === "visible" ? (d.admin ? "모든 사용자의" : "볼 수 있는") : `${nameOf(viewer)} 님의`;

  const attention = useMemo(() => {
    const items: { key: string; href: string; title: string; detail: string; badge: React.ReactNode }[] = [];
    for (const p of sc.publications.filter((x) => x.status === "uncertain")) {
      items.push({ key: `pub-${p.id}`, href: "/neander/shorts/publish", title: `${projectName.get(p.projectId) ?? "영상"} · ${PLATFORM_LABEL[p.platform]}`, detail: p.error?.message ?? "플랫폼에서 게시 여부를 확인해 기록해 주세요.", badge: <PubBadge status={p.status} /> });
    }
    for (const j of d.jobs.filter((x) => projectName.has(x.projectId) && ["failed", "uncertain", "interrupted"].includes(x.status) && (x.finishedAt ?? 0) > Date.now() - 3 * 86_400_000)) {
      items.push({ key: `job-${j.id}`, href: `/neander/shorts/projects/${j.projectId}`, title: `${projectName.get(j.projectId) ?? "영상"} · ${j.kind === "ai_video" ? "AI 장면" : j.kind === "tts" ? "AI 음성" : j.kind === "render" ? "출력" : "게시"}`, detail: j.error?.message ?? "", badge: <JobBadge status={j.status} /> });
    }
    for (const p of sc.projects) {
      const n = p.scenes.filter((s) => s.kind === "ai" && s.ai?.status === "review").length;
      if (n) items.push({ key: `rev-${p.id}`, href: `/neander/shorts/projects/${p.id}?tab=edit`, title: p.title, detail: `AI 장면 ${n}개가 검토를 기다립니다 — 실제 제품과 다를 수 있어 사람이 승인해야 출력에 쓰입니다.`, badge: <StageBadge stage={p.stage} /> });
    }
    return items;
  }, [d, sc, projectName]);

  const counts = useMemo(() => Object.fromEntries(FLOW.map((s) => [s, sc.projects.filter((p) => p.stage === s && !p.sample).length])) as Record<ProjectStage, number>, [sc.projects]);
  const scheduled = sc.publications.filter((p) => p.status === "scheduled").sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const s = d.status;

  return (
    <PageShell>
      <PageHeader
        title="AI STUDIO"
        description={`${whose} 영상 — 쿠팡 제휴 영상과 고객사(브랜드) 영상을 한 곳에서: 기획 → 소스 · 대본 → 편집 · 출력 → 검토 · 게시 → 성과. 누구의 것을 볼지는 위쪽 「보기」 에서 고릅니다.`}
        actions={
          <>
            <Link href="/neander/shorts/trends"><Button variant="secondary" icon={Radar}>소재 발굴</Button></Link>
            <Link href="/neander/shorts/projects"><Button icon={Clapperboard}>영상</Button></Link>
          </>
        }
      />

      <KpiStrip columns={6} className="mb-6">
        {FLOW.slice(0, 6).map((st) => (
          <KpiItem key={st} label={STAGE_LABEL[st]} value={counts[st].toLocaleString("ko-KR")} unit="건" />
        ))}
      </KpiStrip>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section>
          <SectionHeader title="확인할 일" hint={attention.length ? `${attention.length}건` : undefined} />
          {attention.length === 0 ? (
            <EmptyState compact icon={CircleAlert} title="확인할 일이 없습니다" description="결과가 불확실한 게시 · 실패한 작업 · 검토할 AI 장면이 생기면 여기에 모입니다." />
          ) : (
            <Card padding="none" className="divide-y divide-nd-line">
              {attention.map((a) => (
                <Link key={a.key} href={a.href} className="flex items-start gap-3 px-4 py-3 hover:bg-nd-fg/[.03]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-nd-body font-medium">{a.title}</p>
                    {a.detail && <p className="mt-0.5 line-clamp-2 text-nd-caption text-nd-fg-3">{a.detail}</p>}
                  </div>
                  {a.badge}
                </Link>
              ))}
            </Card>
          )}

          <SectionHeader className="mt-8" title="최근 영상" action={<Link href="/neander/shorts/projects" className="text-nd-caption text-nd-accent">전체 보기</Link>} />
          {sc.projects.length === 0 ? (
            <EmptyState compact icon={Clapperboard} title="아직 영상이 없습니다" description="소재 발굴에서 후보를 저장한 뒤 「영상 만들기」 를 누르거나, 영상 화면에서 바로 만드세요. 고객사 영상은 고객사 화면에서 만듭니다." />
          ) : (
            <Card padding="none">
              <TableScroll>
                <Table minWidth={560}>
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
                        <Td>
                          <Link href={`/neander/shorts/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                          {p.visibility === "team" && <span className="ml-2 text-nd-caption text-nd-fg-3">팀</span>}
                        </Td>
                        <Td muted>{nameOf(p.owner)}</Td>
                        <Td><StageBadge stage={p.stage} /></Td>
                        <Td muted>{p.mode === "remix" ? "기존 영상 재편집" : p.mode === "hybrid" ? "소스 + AI 장면" : "전체 AI 생성"}</Td>
                        <Td align="right" muted>{fmtWhen(p.updatedAt)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </Card>
          )}
        </section>

        <aside className="space-y-6">
          <section>
            <SectionHeader title="예약 게시" hint="실행기가 그 시각 이후에 처리합니다" />
            {scheduled.length === 0 ? (
              <p className="text-nd-body text-nd-fg-3">잡힌 예약이 없습니다.</p>
            ) : (
              <Card padding="none" className="divide-y divide-nd-line">
                {scheduled.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-nd-body">{projectName.get(p.projectId) ?? "영상"} · {PLATFORM_LABEL[p.platform]}</p>
                      <p className="text-nd-caption text-nd-fg-3">{fmtWhen(p.scheduledAt)} 이후 · 아직 게시 전</p>
                    </div>
                    <PubBadge status={p.status} />
                  </div>
                ))}
              </Card>
            )}
            <InlineNotice tone="info" className="mt-3">
              예약은 <b>예약 시각 이후 실행기가 돌 때</b> 게시됩니다. 실행기는 ERP 화면이 열려 있을 때와 매일 06:30 cron 에 돕니다 — 정시 게시를 보장하려면 내 채널·연결의 안내를 보세요.
            </InlineNotice>
          </section>

          <section>
            <SectionHeader title="연결 상태" action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="ghost" icon={Plug}>내 채널·연결</Button></Link>} />
            <Card className="space-y-2 text-nd-body">
              <Row label="AI (OpenRouter)" ok={s.openrouter.configured} />
              <Row label="YouTube 검색 키" ok={s.youtubeSearch.configured} />
              <Row label="YouTube 게시 (OAuth)" ok={s.youtubeOAuth.configured} extra={`내 계정 ${d.accounts.filter((a) => a.mine && a.platform === "youtube").length}`} />
              <Row label="Instagram 게시 (Meta)" ok={s.meta.configured} extra={`내 계정 ${d.accounts.filter((a) => a.mine && a.platform === "instagram").length}`} />
              <Row label="내 쿠팡 파트너스 키" ok={!!d.profiles.find((x) => x.owner === d.me)?.coupang.configured} extra={s.companyCoupang.configured ? "회사 공용 키 있음 (검색만)" : undefined} />
              <p className="pt-1 text-nd-caption text-nd-fg-3">
                파일 저장 {s.storage.usedMb}MB / {s.storage.quotaMb}MB (Firestore 조각 — Storage 버킷 없음)
              </p>
            </Card>
          </section>
        </aside>
      </div>
    </PageShell>
  );
}

function Row({ label, ok, extra }: { label: string; ok: boolean; extra?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-nd-fg-2">{label}</span>
      <span className="flex items-center gap-2">
        {extra && <span className="text-nd-caption text-nd-fg-3">{extra}</span>}
        <ConnBadge ok={ok} />
      </span>
    </div>
  );
}
