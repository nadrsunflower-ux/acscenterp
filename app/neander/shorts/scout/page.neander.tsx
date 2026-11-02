"use client";

// ============================================================
//  바이럴 형식 — 나라별 감시 채널에서 평소보다 크게 터진 쇼츠를 모아 형식 카드로 묶고,
//  해외에서 떠오르는데 국내 표본엔 아직 없는 형식을 주간 보고로 뽑는다.
// ------------------------------------------------------------
//  · 바이럴 판정 = 그 채널 평소(최근 쇼츠 조회수 중앙값)의 몇 배인가 — 조회수 크기가 아니다.
//  · AI 는 YouTube 영상을 직접 보고 형식을 뽑는다 (한 편 약 10원). 결과는 관찰 · 가설이다.
//  · 정찰 자료는 회사 공용이다. 화면 위 「보기」(내 것 · 전체)와 상관없이 모두 보인다.
//  · 실행 네 가지(전체 자동화 · 채널만 훑기 · 보고 새로 만들기 · AI 요약 다시)는 여기서 한 번에 돌린다 —
//    도는 동안 서로 막고, 상태 바와 주간 보고가 같은 동작을 쓴다.
// ============================================================

import { useState } from "react";
import { Info } from "lucide-react";
import { Badge, Button, CountBadge, ErrorState, InlineNotice, LoadingState, PageHeader, PageShell, Tabs, useToast } from "@/components/neander/ui";
import { useAction } from "@/components/neander/shorts/parts";
import { AutoPanel, useScoutAuto, type ScoutRunActions } from "@/components/neander/shorts/scout/AutoPanel";
import { ChannelsTab } from "@/components/neander/shorts/scout/ChannelsTab";
import { FormatsTab } from "@/components/neander/shorts/scout/FormatsTab";
import { HitsTab } from "@/components/neander/shorts/scout/HitsTab";
import { ReportTab } from "@/components/neander/shorts/scout/ReportTab";
import { scout, useScoutData } from "@/components/neander/shorts/scout/useScout";
import { shortsPost } from "@/lib/neander/shorts/client";
import { krwOf } from "@/lib/neander/shorts/radar";
import type { ScoutAutoSummary } from "@/lib/neander/shorts/scout-auto";

type Tab = "report" | "hits" | "formats" | "channels";

const DESCRIPTION = "반응이 큰 원본 영상에서 재사용할 구성을 찾으세요.";

const SharedBadge = () => (
  <span className="inline-flex" title="정찰 자료는 회사 공용입니다 — 화면 위 「보기」(내 것 · 전체)와 상관없이 모두 보입니다">
    <Badge tone="accent" size="lg">
      회사 공용
    </Badge>
  </span>
);

export default function ScoutPage() {
  const { data: d, error, refresh } = useScoutData();
  const auto = useScoutAuto();
  const toast = useToast();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>("report");
  const [formatId, setFormatId] = useState<string | null>(null);
  // 고른 보고 주 — null 이면 가장 최근
  const [week, setWeek] = useState<string | null>(null);

  if (!d) {
    return (
      <PageShell>
        <PageHeader title="바이럴 형식" titleSuffix={<SharedBadge />} description={DESCRIPTION} />
        {error ? (
          <ErrorState title="정찰 자료를 불러오지 못했습니다" description={error} action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>다시 시도</Button>} />
        ) : (
          <LoadingState label="정찰 자료를 불러오는 중" />
        )}
      </PageShell>
    );
  }

  const keyReady = !!d.quotas.youtubeSearch.source;
  const report = d.reports.find((x) => x.week === week) ?? d.reports[0] ?? null;
  const openFormat = (id: string) => {
    setFormatId(id);
    setTab("formats");
  };
  const unassigned = d.hits.filter((h) => h.status === "new").length;

  const actions: ScoutRunActions = {
    busy,
    runAll: () =>
      void run("auto", async () => {
        const { summary: s } = await shortsPost<{ summary: ScoutAutoSummary }>("scout-auto", { action: "run" });
        await Promise.all([auto.reload(), refresh()]);
        setWeek(null);
        toast.success(
          `전체 자동화를 돌렸습니다 — 채널 +${s.added.length} · 새로 찾은 영상 ${s.newHits}편 · 자동 묶음 ${s.assigned}편 · AI ${krwOf(s.aiUsd).toLocaleString("ko-KR")}원${s.notes.length ? ` · 메모 ${s.notes.length}건(실행 상세)` : ""}`,
        );
      }),
    scan: () =>
      void run("scan", async () => {
        const r = await scout<{ scanned: { created: number }[]; skipped: number; stoppedBy: string | null }>("watch.scan");
        await refresh();
        const made = r.scanned.reduce((n, x) => n + x.created, 0);
        toast.success(r.scanned.length ? `${r.scanned.length}곳 훑음 · 새로 터진 영상 ${made}편${r.skipped ? ` · ${r.skipped}곳은 다음에` : ""}` : "6시간 안에 모두 훑었습니다. 감시 채널 탭의 「모두 훑기」 로 다시 훑을 수 있습니다.");
      }),
    build: () =>
      void run(
        "build",
        async () => {
          const out = await scout<{ week: string }>("report.build");
          await refresh();
          setWeek(out.week);
        },
        "보고를 새로 만들었습니다.",
      ),
    narrate: () => {
      if (!report) return;
      void run(
        "narrate",
        async () => {
          await scout("report.narrate", { week: report.week });
          await refresh();
        },
        "AI 요약을 붙였습니다.",
      );
    },
    blocked: {
      scan: !keyReady ? "YouTube 검색 키가 없어 훑을 수 없습니다" : !d.channels.length ? "감시 채널이 없습니다 — 감시 채널 탭에서 넣으세요" : null,
      narrate: report ? null : "보고가 없어 요약할 것이 없습니다 — 보고를 먼저 만드세요",
    },
    narrateWeek: report?.week ?? null,
    hasNarrative: !!report?.narrative,
  };

  return (
    <PageShell>
      <PageHeader title="바이럴 형식" titleSuffix={<SharedBadge />} description={DESCRIPTION} />

      {!keyReady ? (
        <InlineNotice tone="warning" className="mb-4">
          YouTube 검색 키가 없어 채널을 넣거나 훑을 수 없습니다 — 「내 채널 · 연결」 에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정하세요. 키 없이도 틱톡 · 더우인 영상 등록과 형식 카드는 쓸 수 있습니다.
        </InlineNotice>
      ) : !d.companyKey ? (
        <InlineNotice tone="info" className="mb-4">
          회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없어 매일 아침 자동 훑기 · 자동 분석은 돌지 않습니다. 지금은 「채널만 훑기」 를 누를 때만 내 키로 훑습니다.
        </InlineNotice>
      ) : null}

      <AutoPanel auto={auto} actions={actions} companyKey={d.companyKey} />

      <Tabs
        className="mb-5"
        items={[
          { key: "report", label: "주간 보고" },
          {
            key: "hits",
            label: (
              <span className="inline-flex items-center gap-1.5">
                터진 영상
                {unassigned > 0 && (
                  <>
                    <CountBadge count={unassigned} max={999} tone={tab === "hits" ? "accent" : "neutral"} label={`형식에 묶기 전 ${unassigned}편`} />
                    <span aria-hidden className="inline-flex items-center gap-0.5 text-[13px] font-medium text-nd-accent" title="형식 카드에 아직 묶지 않은 영상 수 — 전체 기간 · 지금 기준">
                      묶기 전
                      <Info size={13} className="text-nd-fg-3" />
                    </span>
                  </>
                )}
              </span>
            ),
          },
          { key: "formats", label: "형식 카드", badge: d.formats.filter((f) => !f.archived).length || undefined },
          { key: "channels", label: "감시 채널", badge: d.channels.filter((c) => c.active).length || undefined },
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        ariaLabel="정찰"
      />

      {tab === "report" && (
        <ReportTab
          d={d}
          report={report}
          setWeek={setWeek}
          actions={actions}
          onOpenFormat={openFormat}
          onOpenFormats={() => {
            setFormatId(null);
            setTab("formats");
          }}
          onOpenHits={() => setTab("hits")}
        />
      )}
      {tab === "hits" && <HitsTab d={d} refresh={refresh} onOpenFormat={openFormat} />}
      {tab === "formats" && <FormatsTab d={d} refresh={refresh} openId={formatId} setOpenId={setFormatId} onOpenHits={() => setTab("hits")} />}
      {tab === "channels" && <ChannelsTab d={d} refresh={refresh} />}
    </PageShell>
  );
}
