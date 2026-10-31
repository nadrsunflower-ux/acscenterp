"use client";

// ============================================================
//  바이럴 형식 — 나라별 감시 채널에서 평소보다 크게 터진 쇼츠를 모아 형식 카드로 묶고,
//  해외에서 떠오르는데 국내 표본엔 아직 없는 형식을 주간 보고로 뽑는다.
// ------------------------------------------------------------
//  · 바이럴 판정 = 그 채널 평소(최근 쇼츠 조회수 중앙값)의 몇 배인가 — 조회수 크기가 아니다.
//  · AI 는 YouTube 영상을 직접 보고 형식을 뽑는다 (한 편 약 10원). 결과는 관찰 · 가설이다.
//  · 정찰 자료는 회사 공용이다. 화면 위 「보기」(내 것 · 전체)와 상관없이 모두 보인다.
// ============================================================

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, ErrorState, InlineNotice, LoadingState, PageHeader, PageShell, Tabs, useToast } from "@/components/neander/ui";
import { useAction } from "@/components/neander/shorts/parts";
import { ChannelsTab } from "@/components/neander/shorts/scout/ChannelsTab";
import { FormatsTab } from "@/components/neander/shorts/scout/FormatsTab";
import { HitsTab } from "@/components/neander/shorts/scout/HitsTab";
import { ReportTab } from "@/components/neander/shorts/scout/ReportTab";
import { scout, useScoutData } from "@/components/neander/shorts/scout/useScout";

type Tab = "report" | "hits" | "formats" | "channels";

export default function ScoutPage() {
  const { data: d, error, refresh } = useScoutData();
  const toast = useToast();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>("report");
  const [formatId, setFormatId] = useState<string | null>(null);

  if (!d) return error ? <ErrorState title="정찰 자료를 불러오지 못했습니다" description={error} action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>다시 시도</Button>} /> : <LoadingState label="정찰 자료를 불러오는 중" />;

  const keyReady = !!d.quotas.youtubeSearch.source;
  const openFormat = (id: string) => {
    setFormatId(id);
    setTab("formats");
  };
  const unassigned = d.hits.filter((h) => h.status === "new").length;

  return (
    <PageShell>
      <PageHeader
        title="바이럴 형식"
        description="나라별 감시 채널에서 평소보다 크게 터진 쇼츠를 모아 「어떻게 만들었나」 로 묶고, 해외에서 떠오르는데 한국 표본엔 아직 없는 형식을 주간 보고로 뽑습니다."
        actions={
          <Button
            icon={RefreshCw}
            disabled={!keyReady || busy === "scan" || !d.channels.length}
            onClick={() =>
              void run("scan", async () => {
                const r = await scout<{ scanned: { created: number }[]; skipped: number; stoppedBy: string | null }>("watch.scan");
                await refresh();
                const made = r.scanned.reduce((n, x) => n + x.created, 0);
                toast.success(r.scanned.length ? `${r.scanned.length}곳 훑음 · 새로 터진 영상 ${made}편${r.skipped ? ` · ${r.skipped}곳은 다음에` : ""}` : "6시간 안에 모두 훑었습니다. 감시 채널 탭의 「모두 훑기」 로 다시 훑을 수 있습니다.");
              })
            }
          >
            {busy === "scan" ? "훑는 중…" : "지금 훑기"}
          </Button>
        }
      />

      {!keyReady ? (
        <InlineNotice tone="warning" className="mb-4">
          YouTube 검색 키가 없어 채널을 넣거나 훑을 수 없습니다 — 「내 채널 · 연결」 에서 개인 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정하세요. 키 없이도 틱톡 · 더우인 영상 등록과 형식 카드는 쓸 수 있습니다.
        </InlineNotice>
      ) : !d.companyKey ? (
        <InlineNotice tone="info" className="mb-4">
          회사 YouTube 키(NEANDER_SHORTS_YOUTUBE_API_KEY)가 없어 매일 아침 자동 훑기 · 자동 분석은 돌지 않습니다. 지금은 「지금 훑기」 를 누를 때만 내 키로 훑습니다.
        </InlineNotice>
      ) : null}

      <Tabs
        className="mb-5"
        items={[
          { key: "report", label: "주간 보고" },
          { key: "hits", label: "터진 영상", badge: unassigned || undefined, badgeLabel: "묶기 전 영상" },
          { key: "formats", label: "형식 카드", badge: d.formats.filter((f) => !f.archived).length || undefined },
          { key: "channels", label: "감시 채널", badge: d.channels.filter((c) => c.active).length || undefined },
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        ariaLabel="정찰"
      />

      {tab === "report" && <ReportTab d={d} refresh={refresh} onOpenFormat={openFormat} />}
      {tab === "hits" && <HitsTab d={d} refresh={refresh} onOpenFormat={openFormat} />}
      {tab === "formats" && <FormatsTab d={d} refresh={refresh} openId={formatId} setOpenId={setFormatId} />}
      {tab === "channels" && <ChannelsTab d={d} refresh={refresh} />}
    </PageShell>
  );
}
