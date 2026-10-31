"use client";

// 게시 현황 — 모든 프로젝트의 게시를 플랫폼별 상태로. 결과 확인이 필요한 것을 맨 위에.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Camera, Plug, Send, SquarePlay } from "lucide-react";
import { Badge, Button, Card, EmptyState, InlineNotice, PageHeader, PageShell, Table, TableScroll, Tabs, Td, Th, Tr } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, PubBadge, fmtWhen } from "@/components/neander/shorts/parts";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import type { PublicationStatus } from "@/lib/neander/shorts/types";

const ORDER: PublicationStatus[] = ["uncertain", "failed", "uploading", "processing", "queued", "scheduled", "published", "cancelled"];
const TAB_LABEL: Record<PublicationStatus, string> = {
  uncertain: "확인 필요",
  failed: "실패",
  uploading: "전송 중",
  processing: "처리 중",
  queued: "대기",
  scheduled: "예약",
  published: "게시됨",
  cancelled: "취소",
};

/** 탭 이름 + 건수 (13px — 탭 기본 꼬리표보다 크게) */
const tabLabel = (label: string, n: number) => (
  <>
    {label}
    <span className="nd-num text-[13px] font-normal text-nd-fg-3">{n.toLocaleString("ko-KR")}</span>
  </>
);

export default function PublishStatusPage() {
  const { data, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const [filter, setFilter] = useState<"all" | PublicationStatus>("all");
  const projectById = useMemo(() => new Map(sc.projects.map((p) => [p.id, p])), [sc.projects]);
  const accountById = useMemo(() => new Map(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const rows = [...sc.publications]
    .filter((p) => filter === "all" || p.status === filter)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt);
  const tabs = [
    { key: "all", label: tabLabel("전체", sc.publications.length) },
    ...ORDER.map((s) => ({ key: s, n: sc.publications.filter((p) => p.status === s).length }))
      .filter((t) => t.n > 0)
      .map((t) => ({ key: t.key, label: tabLabel(TAB_LABEL[t.key], t.n) })),
  ];
  // 게시할 수 있는 연결된 계정이 하나도 없을 때만 알린다 (실제 연결 상태 기준)
  const noPublishAccount = !d.accounts.some((a) => a.canPublish && a.status === "connected");

  return (
    <PageShell>
      <PageHeader title="게시 현황" description="플랫폼별 게시 결과. 같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 게시되고, 결과가 불확실한 게시는 자동으로 다시 올리지 않습니다." />
      {sc.publications.some((p) => p.status === "uncertain") && (
        <InlineNotice tone="warning" className="mb-4">결과 확인이 필요한 게시가 있습니다. 플랫폼(YouTube Studio · Instagram)에서 올라갔는지 보고, 그 영상의 게시 탭에서 「결과 기록」 을 눌러 주세요.</InlineNotice>
      )}
      {noPublishAccount && (
        <InlineNotice
          tone="neutral"
          icon={Plug}
          className="mb-4"
          action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="secondary">내 채널 · 연결</Button></Link>}
        >
          연결된 SNS 게시 계정이 없습니다 — 새 게시와 예약 실행에는 계정 연결이 필요합니다.
        </InlineNotice>
      )}
      <Tabs className="mb-4" items={tabs} value={filter} onChange={(k) => setFilter(k as typeof filter)} ariaLabel="상태" />
      {rows.length === 0 ? (
        <EmptyState icon={Send} title="게시 기록이 없습니다" description="영상의 게시 탭에서 정책 확인을 마치고 게시하면 여기에 쌓입니다." />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table size="md" minWidth={1040}>
              <thead>
                <tr>
                  <Th>영상</Th>
                  <Th>플랫폼 · 계정</Th>
                  <Th>상태</Th>
                  <Th>결과</Th>
                  <Th align="right">예약 · 갱신</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const project = projectById.get(p.projectId);
                  const acc = accountById.get(p.accountId);
                  const title = project?.title ?? "(볼 수 없는 영상)";
                  const sub = project ? (project.kind === "brand" ? project.clientName || "고객사" : project.product || "상품 미정") : "";
                  const PlatformIcon = p.platform === "youtube" ? SquarePlay : Camera;
                  return (
                    <Tr key={p.id}>
                      <Td className="w-[30%] max-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <KindTile kind={project?.kind ?? "coupang"} className="h-9 w-9" />
                          <div className="min-w-0">
                            <Link href={`/neander/shorts/projects/${p.projectId}?tab=publish`} className="block truncate font-medium hover:underline" title={title}>{title}</Link>
                            {sub && <p className="truncate text-[13px] text-nd-fg-3" title={sub}>{sub}</p>}
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <PlatformIcon size={18} aria-hidden className="shrink-0 text-nd-fg-3" />
                          <div className="min-w-0">
                            <p>{PLATFORM_LABEL[p.platform]}</p>
                            <p className="max-w-[220px] truncate text-[13px] text-nd-fg-3" title={acc ? `${acc.externalName} (${nameOf(acc.owner)})` : undefined}>
                              {acc ? `${acc.externalName} (${nameOf(acc.owner)})` : "(공유 끊김)"}
                            </p>
                          </div>
                          {acc?.status === "needs_reauth" && <Badge tone="danger" size="lg">다시 연결 필요</Badge>}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap"><PubBadge status={p.status} size="lg" /></Td>
                      <Td className="w-[34%] max-w-0">
                        {p.result ? (
                          <>
                            {p.result.url ? (
                              <a href={p.result.url} target="_blank" rel="noreferrer" className="block truncate text-nd-accent hover:underline" title={p.result.url}>{p.result.url}</a>
                            ) : (
                              <p className="text-nd-fg-3">주소 기록 없음</p>
                            )}
                            <p className="text-[13px] text-nd-fg-3">{p.result.by === "manual" ? "직접 기록" : "API 확인"} · <span className="nd-num">{fmtWhen(p.result.at)}</span></p>
                          </>
                        ) : p.error?.message ? (
                          <p className="line-clamp-2 text-[13px] text-nd-fg-2" title={p.error.message}>{p.error.message}</p>
                        ) : (
                          <span className="text-nd-fg-3">—</span>
                        )}
                      </Td>
                      <Td num className="whitespace-nowrap">
                        {p.status === "scheduled" ? (
                          <>
                            {fmtWhen(p.scheduledAt)}
                            <span className="ml-1 text-[13px] text-nd-fg-3">이후</span>
                          </>
                        ) : (
                          <span className="text-nd-fg-2">{fmtWhen(p.updatedAt)}</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
    </PageShell>
  );
}
