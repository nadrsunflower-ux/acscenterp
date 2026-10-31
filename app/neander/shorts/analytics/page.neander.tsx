"use client";

// ============================================================
//  성과 비교 — 어떤 상품 · 구성(공식) · CTA 가 정보 요청 · 클릭 · 구매로 이어졌나
// ------------------------------------------------------------
//  프로젝트마다 출처별 마지막 기록을 합친다 (model.projectTotals). 예시 프로젝트는 뺀다.
//  모르는 지표가 있는 프로젝트는 「일부 미확인」 으로 세어 비율이 과장되지 않게 알린다.
//  우리가 만든 영상의 성과만 다룬다 — 원본(해외) 영상의 반응은 섞지 않는다.
// ============================================================

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ChartColumn } from "lucide-react";
import { Card, EmptyState, InlineNotice, PageHeader, PageShell, SegmentedControl, SectionHeader, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, Unknown, fmtUsd } from "@/components/neander/shorts/parts";
import { CTA_LABEL, compareBy, fmtPct, perfRates, projectCost, projectTotals, type CompareAxis } from "@/lib/neander/shorts/model";
import type { PerfMetricKey, ProjectDoc } from "@/lib/neander/shorts/types";

type Key = "views" | "infoRequests" | "clicks" | "orders" | "revenue";
const KEYS: Key[] = ["views", "infoRequests", "clicks", "orders", "revenue"];
const SOURCE_TEXT: Record<string, string> = { manual: "직접 입력", youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡 API" };

/** compareBy 와 같은 묶음 열쇠 — 묶음마다 지표별로 아는 영상 수를 세려고 */
function groupKey(axis: CompareAxis, p: ProjectDoc): string {
  return axis === "category" ? p.category || "(분류 없음)" : axis === "template" ? p.templateId ?? "(공식 없음)" : axis === "owner" ? p.owner : axis === "client" ? p.clientId ?? "(자체 · 쿠팡)" : p.cta.type;
}

/**
 * 비율 — 분자를 모르면 「미확인」, 분모가 0 이면 「—」(해당 없음).
 * 숫자 칸 아래 줄에 13px 로 붙인다.
 */
function Rate({ r, known }: { r: number | null; known: boolean }) {
  if (!known) return null;
  return <span className="nd-num text-[13px] text-nd-fg-3">({r === null ? "—" : fmtPct(r)})</span>;
}

/** 숫자 + 그 아래 비율 */
function CountRate({ value, known, rate }: { value: number | null; known: boolean; rate?: number | null }) {
  if (!known || value === null) return <Unknown />;
  return (
    <div className="leading-snug">
      <Num value={value} />
      {rate !== undefined && <div><Rate r={rate} known /></div>}
    </div>
  );
}

const Won = ({ value }: { value: number | null }) => (value === null ? <Unknown /> : <Num value={Math.round(value)} unit="원" />);

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
  // 묶음마다 지표별로 값을 아는 영상 수 — 하나도 모르면 0 이 아니라 「미확인」
  const knownBy = useMemo(() => {
    const m = new Map<string, Record<Key, number>>();
    for (const r of rows) {
      const k = groupKey(axis, r.project);
      const c = m.get(k) ?? { views: 0, infoRequests: 0, clicks: 0, orders: 0, revenue: 0 };
      for (const key of KEYS) if (r.totals[key as PerfMetricKey] !== null) c[key] += 1;
      m.set(k, c);
    }
    return m;
  }, [rows, axis]);
  const withData = rows.filter((r) => r.totals.views !== null);
  const axisLabel = axis === "cta" ? "CTA" : axis === "template" ? "성공 공식" : axis === "owner" ? "사용자" : "상품 분류";

  return (
    <PageShell>
      <PageHeader title="성과 비교" description="정보 요청률 = 정보 요청 ÷ 조회 · 클릭률 = 제휴 클릭 ÷ 조회 · 전환율 = 주문 ÷ 클릭. 모두 기록된 값으로만 셉니다 — 추정치를 채워 넣지 않습니다." />
      {withData.length === 0 ? (
        <EmptyState icon={ChartColumn} title="아직 성과 기록이 없습니다" description="게시한 영상의 성과를 영상의 「성과」 탭에서 가져오거나 직접 적으면 여기서 비교됩니다." />
      ) : (
        <>
          <SectionHeader
            size="lg"
            title="묶어 보기"
            hint="우리 영상 성과 · 영상마다 출처별 마지막 기록"
            action={<SegmentedControl value={axis} onChange={(v) => setAxis(v as CompareAxis)} options={[{ value: "cta", label: "CTA" }, { value: "template", label: "성공 공식" }, { value: "category", label: "상품 분류" }, { value: "owner", label: "사용자" }]} />}
          />
          <Card padding="none" className="mb-8 overflow-hidden">
            <TableScroll>
              <Table size="md" minWidth={980}>
                <thead>
                  <tr>
                    <Th>{axisLabel}</Th>
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
                  {groups.map((g) => {
                    const k = knownBy.get(g.key) ?? { views: 0, infoRequests: 0, clicks: 0, orders: 0, revenue: 0 };
                    return (
                      <Tr key={g.key}>
                        <Td className="w-full max-w-0">
                          <p className="truncate font-medium" title={g.label}>{g.label}</p>
                          {g.partial > 0 && <p className="text-[13px] text-nd-fg-3" title="지표 일부를 모르는 영상 — 그 지표는 합계에서 빠졌습니다">일부 미확인 {g.partial}개</p>}
                        </Td>
                        <Td num className="whitespace-nowrap"><Num value={g.projects} unit="개" /></Td>
                        <Td num className="whitespace-nowrap">{k.views ? <Num value={g.views} /> : <Unknown />}</Td>
                        <Td num className="whitespace-nowrap"><CountRate value={g.infoRequests} known={k.infoRequests > 0} rate={g.infoRate} /></Td>
                        <Td num className="whitespace-nowrap"><CountRate value={g.clicks} known={k.clicks > 0} rate={g.ctr} /></Td>
                        <Td num className="whitespace-nowrap"><CountRate value={g.orders} known={k.orders > 0} rate={g.cvr} /></Td>
                        <Td num className="whitespace-nowrap">{k.revenue ? <Won value={g.revenue} /> : <Unknown />}</Td>
                        <Td num className="whitespace-nowrap">{g.costKrw ? <Num value={g.costKrw} unit="원" /> : <span className="text-nd-fg-3" title="원화 제작 비용 기록 없음">—</span>}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <SectionHeader size="lg" title="영상별" hint={`${withData.length}개 · 우리가 만든 영상만 — 원본(해외) 영상의 반응은 소재 발굴 · 바이럴 형식에서 따로 봅니다`} />
          <Card padding="none" className="overflow-hidden">
            <TableScroll>
              <Table size="md" minWidth={1120}>
                <thead>
                  <tr>
                    <Th>영상 · 상품</Th>
                    <Th>공식 · CTA</Th>
                    <Th align="right">조회</Th>
                    <Th align="right">정보 요청 (률)</Th>
                    <Th align="right">클릭 (률)</Th>
                    <Th align="right">주문 (전환율)</Th>
                    <Th align="right">제휴 수익</Th>
                    <Th align="right">AI 비용</Th>
                    <Th>기록 출처</Th>
                  </tr>
                </thead>
                <tbody>
                  {withData
                    .sort((a, b) => (b.totals.views ?? 0) - (a.totals.views ?? 0))
                    .map(({ project: p, totals: t, templateName: tn }) => {
                      const r = perfRates(t);
                      const sub = `${p.owner !== d.me ? `${nameOf(p.owner)} · ` : ""}${p.kind === "brand" ? p.clientName || p.product : p.product}`;
                      const cta: ReactNode = `${CTA_LABEL[p.cta.type]}${p.cta.keyword ? ` 「${p.cta.keyword}」` : ""}`;
                      const sources = [...t.sources].map((s) => SOURCE_TEXT[s] ?? s).join(" · ");
                      const aiUsd = projectCost(p).aiUsd;
                      return (
                        <Tr key={p.id}>
                          <Td className="w-[26%] max-w-0">
                            <Link href={`/neander/shorts/projects/${p.id}?tab=perf`} className="block truncate font-medium hover:underline" title={p.title}>{p.title}</Link>
                            {sub && <p className="truncate text-[13px] text-nd-fg-3" title={sub}>{sub}</p>}
                          </Td>
                          <Td className="w-[18%] max-w-0">
                            <p className="truncate text-[13px] text-nd-fg-2" title={tn ?? "(공식 없음)"}>{tn ?? "(공식 없음)"}</p>
                            <p className="truncate text-[13px] text-nd-fg-3">{cta}</p>
                          </Td>
                          <Td num className="whitespace-nowrap"><Num value={t.views} /></Td>
                          <Td num className="whitespace-nowrap"><CountRate value={t.infoRequests} known={t.infoRequests !== null} rate={r.infoRate} /></Td>
                          <Td num className="whitespace-nowrap"><CountRate value={t.clicks} known={t.clicks !== null} rate={r.ctr} /></Td>
                          <Td num className="whitespace-nowrap"><CountRate value={t.orders} known={t.orders !== null} rate={t.clicks === null ? undefined : r.cvr} /></Td>
                          <Td num className="whitespace-nowrap"><Won value={t.revenue} /></Td>
                          <Td num className="whitespace-nowrap">{fmtUsd(aiUsd || null)}</Td>
                          <Td className="whitespace-nowrap text-[13px] text-nd-fg-3">{sources || "—"}</Td>
                        </Tr>
                      );
                    })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
          <p className="mt-2 text-[13px] text-nd-fg-3">「미확인」 은 기록되지 않았거나 공개되지 않은 값입니다 (0 이 아닙니다). 묶음 합계는 값을 아는 영상만 더합니다 — 「일부 미확인」 이 있는 묶음의 비율은 실제와 다를 수 있습니다.</p>
          <InlineNotice tone="neutral" className="mt-4">클릭수 · 클릭률 · 전환율 · 수익금은 쿠팡 파트너스 운영정책상 기밀정보입니다 — 화면을 외부에 공유하지 마세요.</InlineNotice>
        </>
      )}
    </PageShell>
  );
}
