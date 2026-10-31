"use client";

// ============================================================
//  성과 비교 — 어떤 상품 · 구성(공식) · CTA 가 정보 요청 · 클릭 · 구매로 이어졌나
// ------------------------------------------------------------
//  프로젝트마다 출처별 마지막 기록을 합친다 (model.projectTotals). 예시 프로젝트는 뺀다.
//  모르는 지표가 있는 프로젝트는 「일부 모름」 으로 세어 비율이 과장되지 않게 알린다.
// ============================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartColumn } from "lucide-react";
import { Card, EmptyState, InlineNotice, PageHeader, PageShell, SegmentedControl, SectionHeader, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { CTA_LABEL, compareBy, fmtCount, fmtPct, perfRates, projectCost, projectTotals, type CompareAxis } from "@/lib/neander/shorts/model";

export default function AnalyticsPage() {
  const { data, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const [axis, setAxis] = useState<CompareAxis>("cta");
  const templateName = useMemo(() => new Map(d.templates.map((t) => [t.id, t.name])), [d.templates]);
  const rows = useMemo(
    () =>
      sc.projects
        .filter((p) => !p.sample)
        .map((p) => ({ project: p, totals: projectTotals(sc.metrics.filter((m) => m.projectId === p.id)), templateName: p.templateId ? templateName.get(p.templateId) ?? null : null })),
    [sc.projects, sc.metrics, templateName],
  );
  const groups = useMemo(() => compareBy(axis, rows).map((g) => (axis === "owner" ? { ...g, label: nameOf(g.key) } : g)), [axis, rows, nameOf]);
  const withData = rows.filter((r) => r.totals.views !== null);

  return (
    <PageShell>
      <PageHeader title="성과 비교" description="정보 요청률 = 정보 요청 ÷ 조회 · 클릭률 = 제휴 클릭 ÷ 조회 · 전환율 = 주문 ÷ 클릭. 모두 기록된 값으로만 셉니다 — 추정치를 채워 넣지 않습니다." />
      {withData.length === 0 ? (
        <EmptyState icon={ChartColumn} title="아직 성과 기록이 없습니다" description="게시한 영상의 성과를 영상의 「성과」 탭에서 가져오거나 직접 적으면 여기서 비교됩니다." />
      ) : (
        <>
          <SectionHeader title="묶어 보기" action={<SegmentedControl size="sm" value={axis} onChange={(v) => setAxis(v as CompareAxis)} options={[{ value: "cta", label: "CTA" }, { value: "template", label: "성공 공식" }, { value: "category", label: "상품 분류" }, { value: "owner", label: "사용자" }]} />} />
          <Card padding="none" className="mb-6">
            <TableScroll>
              <Table minWidth={920}>
                <thead>
                  <tr>
                    <Th>{axis === "cta" ? "CTA" : axis === "template" ? "성공 공식" : axis === "owner" ? "사용자" : "상품 분류"}</Th>
                    <Th align="right">영상</Th>
                    <Th align="right">조회</Th>
                    <Th align="right">정보 요청 (률)</Th>
                    <Th align="right">클릭 (률)</Th>
                    <Th align="right">주문 (전환율)</Th>
                    <Th align="right">제휴 수익</Th>
                    <Th align="right">제작 비용</Th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Tr key={g.key}>
                      <Td className="font-medium">{g.label}{g.partial > 0 && <span className="ml-2 text-nd-caption text-nd-fg-3">일부 모름 {g.partial}</span>}</Td>
                      <Td num>{g.projects}</Td>
                      <Td num>{fmtCount(g.views)}</Td>
                      <Td num>{fmtCount(g.infoRequests)} <span className="text-nd-fg-3">({fmtPct(g.infoRate)})</span></Td>
                      <Td num>{fmtCount(g.clicks)} <span className="text-nd-fg-3">({fmtPct(g.ctr)})</span></Td>
                      <Td num>{fmtCount(g.orders)} <span className="text-nd-fg-3">({fmtPct(g.cvr)})</span></Td>
                      <Td num>{Math.round(g.revenue).toLocaleString("ko-KR")}원</Td>
                      <Td num>{g.costKrw.toLocaleString("ko-KR")}원</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <SectionHeader title="영상별" hint={`${withData.length}개`} />
          <Card padding="none">
            <TableScroll>
              <Table minWidth={1000}>
                <thead>
                  <tr>
                    <Th>영상 · 상품</Th>
                    <Th>공식 · CTA</Th>
                    <Th align="right">조회</Th>
                    <Th align="right">정보 요청률</Th>
                    <Th align="right">클릭률</Th>
                    <Th align="right">전환율</Th>
                    <Th align="right">수익</Th>
                    <Th align="right">AI 비용</Th>
                    <Th>근거</Th>
                  </tr>
                </thead>
                <tbody>
                  {withData
                    .sort((a, b) => (b.totals.views ?? 0) - (a.totals.views ?? 0))
                    .map(({ project: p, totals: t, templateName: tn }) => {
                      const r = perfRates(t);
                      return (
                        <Tr key={p.id}>
                          <Td><Link href={`/neander/shorts/projects/${p.id}?tab=perf`} className="font-medium hover:underline">{p.title}</Link><div className="text-nd-caption text-nd-fg-3">{p.owner !== d.me ? `${nameOf(p.owner)} · ` : ""}{p.product}</div></Td>
                          <Td className="text-nd-caption">{tn ?? "(공식 없음)"} · {CTA_LABEL[p.cta.type]}{p.cta.keyword ? ` 「${p.cta.keyword}」` : ""}</Td>
                          <Td num>{fmtCount(t.views)}</Td>
                          <Td num>{fmtPct(r.infoRate)}</Td>
                          <Td num>{fmtPct(r.ctr)}</Td>
                          <Td num>{fmtPct(r.cvr)}</Td>
                          <Td num>{t.revenue === null ? "—" : `${Math.round(t.revenue).toLocaleString("ko-KR")}원`}</Td>
                          <Td num>${projectCost(p).aiUsd.toFixed(2)}</Td>
                          <Td className="text-nd-caption text-nd-fg-3">{[...t.sources].map((s) => (s === "manual" ? "직접" : s.replace("_api", " API"))).join(" · ")}</Td>
                        </Tr>
                      );
                    })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
          <InlineNotice tone="neutral" className="mt-4">클릭수 · 클릭률 · 전환율 · 수익금은 쿠팡 파트너스 운영정책상 기밀정보입니다 — 화면을 외부에 공유하지 마세요.</InlineNotice>
        </>
      )}
    </PageShell>
  );
}
