"use client";

// ============================================================
//  성과 탭 — 게시물별 지표 (자동 조회 · 직접 입력 구분) · 정보 요청 · 클릭 · 주문 · 비용
// ------------------------------------------------------------
//  합계는 게시물마다 출처별 마지막 기록을 쓰고, 같은 지표가 API 와 직접 입력에
//  둘 다 있으면 API 를 쓴다 (model.projectTotals). 모르는 지표는 「—」.
//  DM 요청 수는 API 로 읽지 않는다 — 직접 센 값을 적는다.
// ============================================================

import { useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button, Card, Field, FormRow, InlineNotice, Input, KpiItem, KpiStrip, NumberInput, SectionHeader, Select, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { CTA_LABEL, METRIC_LABEL, PLATFORM_LABEL, fmtCount, fmtPct, newId, perfRates, projectCost, projectTotals } from "@/lib/neander/shorts/model";
import type { CostEntry, MetricSnapshotView, PerfMetricKey } from "@/lib/neander/shorts/types";
import { useShorts } from "../ShortsProvider";
import { fmtUsd, fmtWhen, useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

const KEYS: PerfMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"];
const SOURCE: Record<MetricSnapshotView["source"], string> = { youtube_api: "YouTube API", instagram_api: "Instagram API", coupang_api: "쿠팡 리포트 API", manual: "직접 입력" };

export function PerformanceTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { data, refresh } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const snaps = d.metrics.filter((m) => m.projectId === p.id);
  const pubs = d.publications.filter((x) => x.projectId === p.id && x.status === "published");
  const totals = useMemo(() => projectTotals(snaps), [snaps]);
  const rates = perfRates(totals);
  const cost = projectCost(p);
  const template = d.templates.find((t) => t.id === p.templateId);
  const [form, setForm] = useState<{ publicationId: string; values: Partial<Record<PerfMetricKey, string>>; note: string }>({ publicationId: "", values: {}, note: "" });
  const [costForm, setCostForm] = useState({ kind: "labor" as CostEntry["kind"], minutes: "", krw: "", note: "" });

  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title="합계" hint={`근거: ${[...totals.sources].map((s) => SOURCE[s as MetricSnapshotView["source"]]).join(" · ") || "기록 없음"}`} />
        <KpiStrip columns={6}>
          <KpiItem label="조회" value={fmtCount(totals.views)} />
          <KpiItem label="정보 요청" value={fmtCount(totals.infoRequests)} hint={`요청률 ${fmtPct(rates.infoRate)}`} />
          <KpiItem label="제휴 클릭" value={fmtCount(totals.clicks)} hint={`클릭률 ${fmtPct(rates.ctr)}`} />
          <KpiItem label="주문" value={fmtCount(totals.orders)} hint={`전환율 ${fmtPct(rates.cvr)}`} />
          <KpiItem label="제휴 수익" value={totals.revenue === null ? "—" : `${Math.round(totals.revenue).toLocaleString("ko-KR")}원`} />
          <KpiItem label="제작 비용" value={`${cost.krw.toLocaleString("ko-KR")}원`} hint={`AI ${fmtUsd(cost.aiUsd || null)} · ${cost.minutes}분`} />
        </KpiStrip>
        <p className="mt-2 text-nd-caption text-nd-fg-3">
          쓴 공식: {template?.name ?? "(없음)"} · CTA: {CTA_LABEL[p.cta.type]}{p.cta.keyword ? ` 「${p.cta.keyword}」` : ""}. 클릭 · 전환율 · 수익은 쿠팡 파트너스 기밀정보라 ERP 밖으로 공유하지 않습니다.
        </p>
      </section>

      <section>
        <SectionHeader
          title="자동 조회"
        />
        <div className="mb-3 flex flex-wrap gap-2">
          {pubs.map((x) => (
            <Button key={x.id} size="sm" variant="secondary" icon={RefreshCw} disabled={busy === x.id} onClick={() => void run(x.id, async () => { await shortsPost("research", { action: "metrics.sync", publicationId: x.id }); await refresh(); }, `${PLATFORM_LABEL[x.platform]} 성과를 공식 API 로 읽었습니다.`)}>
              {PLATFORM_LABEL[x.platform]} 가져오기
            </Button>
          ))}
          <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!d.status.coupang.configured || busy === "cp"} onClick={() => void run("cp", async () => { await shortsPost("research", { action: "coupang.reports" }); await refresh(); }, "쿠팡 리포트를 읽었습니다 (최근 90일).")}>
            쿠팡 리포트
          </Button>
        </div>
        <InlineNotice tone="neutral">
          YouTube · Instagram 은 게시한 계정의 토큰으로 조회 · 좋아요 · 댓글(· 저장 · 공유)을 읽고, 최근 댓글에서 정보 요청 낱말이 든 댓글을 셉니다(최소값). 쿠팡 주문 · 수익은 확인한 상품 id 로 묶고, 클릭은 영상 전용 채널 아이디가 있을 때만 붙습니다. 매일 06:30 cron 이 최근 30일 게시물을 다시 읽습니다.
        </InlineNotice>
      </section>

      <section>
        <SectionHeader title="직접 입력" hint="DM 요청 · 저장처럼 API 로 못 읽는 값" />
        <Card className="space-y-3">
          <Field label="게시물">
            <Select size="sm" value={form.publicationId} onChange={(e) => setForm({ ...form, publicationId: e.target.value })}>
              <option value="">(게시물 무관 · 쿠팡 등)</option>
              {d.publications.filter((x) => x.projectId === p.id).map((x) => <option key={x.id} value={x.id}>{PLATFORM_LABEL[x.platform]} · {x.result?.url ?? x.status}</option>)}
            </Select>
          </Field>
          <FormRow className="grid-cols-3 sm:grid-cols-9">
            {KEYS.map((k) => (
              <Field key={k} label={METRIC_LABEL[k]}>
                <NumberInput size="sm" value={form.values[k] ?? ""} placeholder="—" onValueChange={(r) => setForm({ ...form, values: { ...form.values, [k]: r } })} />
              </Field>
            ))}
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-[3fr_auto]">
            <Field label="근거 메모"><Input size="sm" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="예: 10/31 인스타 DM 요청 직접 셈" /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" disabled={busy === "add" || !Object.values(form.values).some((v) => v !== "" && v !== undefined)} onClick={() => void run("add", async () => {
                const values = Object.fromEntries(Object.entries(form.values).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, Number(v)]));
                const pub = d.publications.find((x) => x.id === form.publicationId);
                await mutate("metric.add", { projectId: p.id, publicationId: form.publicationId || null, platform: pub?.platform ?? "other", values, note: form.note });
                setForm({ publicationId: form.publicationId, values: {}, note: "" });
                await refresh();
              }, "기록했습니다.")}>기록</Button>
            </div>
          </FormRow>
        </Card>
      </section>

      {snaps.length > 0 && (
        <section>
          <SectionHeader title="기록" hint={`${snaps.length}건`} />
          <Card padding="none">
            <TableScroll>
              <Table minWidth={1000} dense>
                <thead>
                  <tr>
                    <Th>시각</Th>
                    <Th>출처</Th>
                    {KEYS.map((k) => <Th key={k} align="right">{METRIC_LABEL[k]}</Th>)}
                    <Th>메모</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {[...snaps].reverse().map((s) => (
                    <Tr key={s.id}>
                      <Td muted>{fmtWhen(s.at)}</Td>
                      <Td>{SOURCE[s.source]}</Td>
                      {KEYS.map((k) => <Td key={k} num>{s.values[k] === undefined || s.values[k] === null ? "—" : fmtCount(s.values[k] as number)}</Td>)}
                      <Td muted className="max-w-[260px] truncate" title={s.note}>{s.note}</Td>
                      <Td>{s.source === "manual" && s.by === d.me && <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => void run(s.id, async () => { await mutate("metric.delete", { id: s.id }); await refresh(); })} />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        </section>
      )}

      <section>
        <SectionHeader title="제작 비용 · 시간" hint="AI 비용은 응답의 usage.cost 로 자동 기록 (없으면 추정이라고 적음)" />
        <Card className="space-y-3">
          <ul className="divide-y divide-nd-line">
            {p.costs.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 py-1.5 text-nd-body">
                <span className="w-24 text-nd-caption text-nd-fg-3">{fmtWhen(c.at)}</span>
                <span className="min-w-0 flex-1 truncate">{c.note}</span>
                <span className="nd-num">{c.usd !== null ? fmtUsd(c.usd) : ""}{c.krw !== null ? ` ${c.krw.toLocaleString("ko-KR")}원` : ""}{c.minutes !== null ? ` ${c.minutes}분` : ""}</span>
                <span className="text-nd-caption text-nd-fg-3">{c.auto ? "자동" : c.by.split("@")[0]}</span>
                {!c.auto && <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => update((x) => void x.costs.splice(i, 1))} />}
              </li>
            ))}
          </ul>
          <FormRow className="grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_2fr_auto]">
            <Field label="종류">
              <Select size="sm" value={costForm.kind} onChange={(e) => setCostForm({ ...costForm, kind: e.target.value as CostEntry["kind"] })}>
                <option value="labor">작업 시간</option>
                <option value="material">샘플 · 재료</option>
                <option value="other">기타</option>
              </Select>
            </Field>
            <Field label="분"><NumberInput size="sm" value={costForm.minutes} onValueChange={(r) => setCostForm({ ...costForm, minutes: r })} /></Field>
            <Field label="원"><NumberInput size="sm" value={costForm.krw} onValueChange={(r) => setCostForm({ ...costForm, krw: r })} /></Field>
            <Field label="메모"><Input size="sm" value={costForm.note} onChange={(e) => setCostForm({ ...costForm, note: e.target.value })} /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" variant="secondary" disabled={!costForm.minutes && !costForm.krw} onClick={() => {
                update((x) => void x.costs.push({ id: newId("cost_"), kind: costForm.kind, krw: costForm.krw ? Number(costForm.krw) : null, usd: null, minutes: costForm.minutes ? Number(costForm.minutes) : null, note: costForm.note || (costForm.kind === "labor" ? "작업 시간" : "비용"), at: Date.now(), by: d.me, auto: false }));
                setCostForm({ ...costForm, minutes: "", krw: "", note: "" });
              }}>더하기</Button>
            </div>
          </FormRow>
        </Card>
      </section>
    </div>
  );
}
