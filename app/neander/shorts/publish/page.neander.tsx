"use client";

// 게시 현황 — 모든 프로젝트의 게시를 플랫폼별 상태로. 결과 확인이 필요한 것을 맨 위에.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { Card, EmptyState, InlineNotice, PageHeader, PageShell, Table, TableScroll, Tabs, Td, Th, Tr } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { PubBadge, fmtWhen } from "@/components/neander/shorts/parts";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import type { PublicationStatus } from "@/lib/neander/shorts/types";

const ORDER: PublicationStatus[] = ["uncertain", "failed", "uploading", "processing", "queued", "scheduled", "published", "cancelled"];

export default function PublishStatusPage() {
  const { data, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const [filter, setFilter] = useState<"all" | PublicationStatus>("all");
  const title = useMemo(() => new Map(sc.projects.map((p) => [p.id, p.title])), [sc.projects]);
  const account = useMemo(() => new Map(d.accounts.map((a) => [a.id, `${a.externalName} (${nameOf(a.owner)})`])), [d.accounts, nameOf]);
  const rows = [...sc.publications]
    .filter((p) => filter === "all" || p.status === filter)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt);
  const tabs = [{ key: "all", label: "전체", hint: String(sc.publications.length) }, ...ORDER.map((s) => ({ key: s, label: s === "uncertain" ? "확인 필요" : s === "scheduled" ? "예약" : s === "published" ? "게시됨" : s === "failed" ? "실패" : s === "cancelled" ? "취소" : s === "queued" ? "대기" : s === "uploading" ? "전송 중" : "처리 중", hint: String(sc.publications.filter((p) => p.status === s).length) })).filter((t) => t.hint !== "0")];

  return (
    <PageShell>
      <PageHeader title="게시 현황" description="플랫폼별 게시 결과. 같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 게시되고, 결과가 불확실한 게시는 자동으로 다시 올리지 않습니다." />
      {sc.publications.some((p) => p.status === "uncertain") && (
        <InlineNotice tone="warning" className="mb-4">결과 확인이 필요한 게시가 있습니다. 플랫폼(YouTube Studio · Instagram)에서 올라갔는지 보고, 그 영상의 게시 탭에서 「결과 기록」 을 눌러 주세요.</InlineNotice>
      )}
      <Tabs className="mb-4" items={tabs} value={filter} onChange={(k) => setFilter(k as typeof filter)} ariaLabel="상태" />
      {rows.length === 0 ? (
        <EmptyState icon={Send} title="게시 기록이 없습니다" description="영상의 게시 탭에서 정책 확인을 마치고 게시하면 여기에 쌓입니다." />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={900}>
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
                {rows.map((p) => (
                  <Tr key={p.id}>
                    <Td><Link href={`/neander/shorts/projects/${p.projectId}?tab=publish`} className="font-medium hover:underline">{title.get(p.projectId) ?? "(볼 수 없는 영상)"}</Link></Td>
                    <Td>{PLATFORM_LABEL[p.platform]} · {account.get(p.accountId) ?? "(공유 끊김)"}</Td>
                    <Td><PubBadge status={p.status} /></Td>
                    <Td className="max-w-[320px]">
                      {p.result?.url ? <a href={p.result.url} target="_blank" rel="noreferrer" className="truncate text-nd-accent">{p.result.url}</a> : <span className="line-clamp-2 text-nd-caption text-nd-fg-3">{p.error?.message ?? "—"}</span>}
                    </Td>
                    <Td align="right" muted>{p.status === "scheduled" ? `${fmtWhen(p.scheduledAt)} 이후` : fmtWhen(p.updatedAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
    </PageShell>
  );
}
