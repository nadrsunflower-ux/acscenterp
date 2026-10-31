"use client";

// ============================================================
//  사용자별 현황 — ERP 사용자마다 채널 세트 · 프로젝트 · 게시 · 성과를 한 줄로
// ------------------------------------------------------------
//  관리자(NEANDER_SHORTS_ADMIN_EMAILS)는 모든 사용자를 본다 (비공개 포함 · 읽기 전용).
//  일반 사용자는 자기 줄만 — 남의 채널 · 쿠팡 키 상태 · 실적은 관리자만 본다.
//  이름을 누르면 위쪽 「보기」 가 그 사람으로 바뀌어 다른 화면도 그 사람의 것만 보인다.
//  쿠팡 키는 상태만 보인다 — 키 값은 서버 밖으로 나오지 않는다.
// ============================================================

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, InlineNotice, PageHeader, PageShell, Table, TableScroll, Td, Th, TotalRow, Tr } from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, Unknown, fmtUsd } from "@/components/neander/shorts/parts";
import { fmtPct, perfRates, projectCost, projectTotals, type PerfTotals } from "@/lib/neander/shorts/model";
import type { AccountView } from "@/lib/neander/shorts/types";

/** 영상별 합계를 더한다 — 지표마다 아는 값만 더하고, 아무 영상도 모르면 null(미확인) */
function sumTotals(list: PerfTotals[]): PerfTotals {
  const out = { sources: new Set<string>() } as PerfTotals;
  const keys = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"] as const;
  for (const k of keys) out[k] = list.some((t) => t[k] !== null) ? list.reduce((n, t) => n + (t[k] ?? 0), 0) : null;
  for (const t of list) for (const s of t.sources) out.sources.add(s);
  return out;
}

const KEY_LABEL = { none: ["키 없음", "neutral"], unverified: ["확인 전", "warning"], ok: ["확인됨", "success"], failed: ["확인 실패", "danger"] } as const;

export default function TeamPage() {
  const { data, viewer, setViewer, nameOf } = useShorts();
  const { members } = useAppData();
  const d = data!;
  const router = useRouter();

  // 관리자는 이 화면에 들어오면 모든 사용자의 것을 받는다
  useEffect(() => {
    if (d.admin && viewer === "mine") setViewer("visible");
  }, [d.admin, viewer, setViewer]);

  const rows = useMemo(() => {
    const emails = new Set<string>([d.me]);
    if (d.admin) {
      for (const m of members) if (m.email) emails.add(m.email.toLowerCase());
      for (const x of [...d.projects, ...d.accounts]) emails.add(x.owner);
      for (const p of d.profiles) emails.add(p.owner);
    }
    return [...emails]
      .map((email) => {
        const projects = d.projects.filter((p) => p.owner === email && !p.sample);
        const ids = new Set(projects.map((p) => p.id));
        const pubs = d.publications.filter((x) => ids.has(x.projectId));
        // projectTotals 는 영상 한 편 단위다 — 게시에 안 묶인 쿠팡 기록은 플랫폼 열쇠 하나로 모이므로
        // 여러 편을 한꺼번에 넣으면 마지막 한 편만 남는다. 영상마다 합친 뒤 더한다 (성과 비교와 같은 방식)
        const totals = sumTotals(projects.map((p) => projectTotals(d.metrics.filter((m) => m.projectId === p.id))));
        const accounts = d.accounts.filter((a) => a.owner === email);
        const profile = d.profiles.find((p) => p.owner === email);
        return {
          email,
          projects,
          published: pubs.filter((x) => x.status === "published").length,
          attention: pubs.filter((x) => x.status === "uncertain" || x.status === "failed").length,
          scheduled: pubs.filter((x) => x.status === "scheduled").length,
          totals,
          rates: perfRates(totals),
          aiUsd: projects.reduce((n, p) => n + projectCost(p).aiUsd, 0),
          youtube: accounts.filter((a) => a.platform === "youtube"),
          instagram: accounts.filter((a) => a.platform === "instagram"),
          profile,
        };
      })
      .sort((a, b) => (a.email === d.me ? -1 : b.email === d.me ? 1 : nameOf(a.email).localeCompare(nameOf(b.email), "ko")));
  }, [d, members, nameOf]);

  // 모르는 지표는 빼고 더한다 — 아무도 모르면 0 이 아니라 「미확인」
  const sum =(k: "views" | "infoRequests" | "clicks" | "orders" | "revenue") =>
    rows.some((r) => r.totals[k] !== null) ? rows.reduce((n, r) => n + (r.totals[k] ?? 0), 0) : null;
  const open = (email: string) => {
    setViewer(email === d.me ? "mine" : email);
    router.push("/neander/shorts/projects");
  };

  return (
    <PageShell width="wide">
      <PageHeader
        title="사용자별 현황"
        description="ERP 사용자마다 자기 채널 세트(YouTube · Instagram · 쿠팡 파트너스)와 영상 · 게시 · 성과를 따로 관리합니다. 이름을 누르면 그 사람의 것만 모아 봅니다."
      />
      {!d.admin ? (
        <InlineNotice tone="neutral" className="mb-4">
          모든 사용자의 현황은 AI STUDIO 관리자만 봅니다 (NEANDER_SHORTS_ADMIN_EMAILS). 지금은 내 줄만 보입니다 — 다른 사람의 팀 공개 영상은 위쪽 「보기」 에서 고를 수 있습니다.
        </InlineNotice>
      ) : (
        <InlineNotice tone="info" className="mb-4">
          관리자 몰아보기 — 다른 사람의 비공개 자료는 읽기만 합니다. 클릭수 · 전환율 · 수익금은 쿠팡 파트너스 기밀정보라 ERP 밖으로 공유하지 마세요.
        </InlineNotice>
      )}
      <Card padding="none" className="overflow-hidden">
        <TableScroll>
          <Table size="md" minWidth={1240}>
            <thead>
              <tr>
                <Th sticky="left">사용자</Th>
                <Th>YouTube</Th>
                <Th>Instagram</Th>
                <Th>쿠팡 파트너스</Th>
                <Th align="right">영상</Th>
                <Th align="right">게시됨</Th>
                <Th align="right">확인 필요</Th>
                <Th align="right">조회</Th>
                <Th align="right">정보 요청 (률)</Th>
                <Th align="right">클릭 (률)</Th>
                <Th align="right">주문</Th>
                <Th align="right">제휴 수익</Th>
                <Th align="right">AI 비용</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const k = r.profile?.coupang.status ?? "none";
                const subs = r.profile?.subIds.length ?? 0;
                const keyMeta = [r.profile?.coupang.afCode, subs ? `채널 아이디 ${subs}개` : ""].filter(Boolean).join(" · ");
                return (
                  <Tr key={r.email} selected={viewer === r.email || (viewer === "mine" && r.email === d.me)}>
                    <Td sticky="left" className="max-w-[240px]">
                      <button type="button" className="block max-w-full text-left" onClick={() => open(r.email)}>
                        <span className="font-medium hover:underline">{nameOf(r.email)}</span>
                        {r.email === d.me && <span className="ml-1 text-[13px] text-nd-fg-3">(나)</span>}
                        <span className="block truncate text-[13px] text-nd-fg-3" title={r.email}>{r.email}</span>
                      </button>
                    </Td>
                    <Td><Channels accounts={r.youtube} /></Td>
                    <Td><Channels accounts={r.instagram} /></Td>
                    <Td className="whitespace-nowrap">
                      <Badge size="lg" tone={KEY_LABEL[k][1]}>{KEY_LABEL[k][0]}</Badge>
                      {keyMeta && <div className="mt-1 max-w-[180px] truncate text-[13px] text-nd-fg-3" title={keyMeta}>{keyMeta}</div>}
                    </Td>
                    <Td num><Num value={r.projects.length} /></Td>
                    <Td num className="whitespace-nowrap">
                      <Num value={r.published} />
                      {r.scheduled ? <div className="text-[13px] text-nd-fg-3">+예약 {r.scheduled}</div> : null}
                    </Td>
                    <Td num className={r.attention ? "font-semibold text-nd-warning-text" : ""}>{r.attention}</Td>
                    <Td num><Num value={r.totals.views} /></Td>
                    <Td num><CountRate value={r.totals.infoRequests} rate={r.rates.infoRate} /></Td>
                    <Td num><CountRate value={r.totals.clicks} rate={r.rates.ctr} /></Td>
                    <Td num><Num value={r.totals.orders} /></Td>
                    <Td num className="whitespace-nowrap"><Num value={r.totals.revenue === null ? null : Math.round(r.totals.revenue)} unit="원" /></Td>
                    <Td num>{fmtUsd(r.aiUsd || null)}</Td>
                  </Tr>
                );
              })}
              {rows.length > 1 && (
                <TotalRow>
                  <Td sticky="left" className="font-semibold">합계 · {rows.length}명</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td num>{rows.reduce((n, r) => n + r.projects.length, 0).toLocaleString("ko-KR")}</Td>
                  <Td num>{rows.reduce((n, r) => n + r.published, 0).toLocaleString("ko-KR")}</Td>
                  <Td num>{rows.reduce((n, r) => n + r.attention, 0).toLocaleString("ko-KR")}</Td>
                  <Td num><Num value={sum("views")} /></Td>
                  <Td num><Num value={sum("infoRequests")} /></Td>
                  <Td num><Num value={sum("clicks")} /></Td>
                  <Td num><Num value={sum("orders")} /></Td>
                  <Td num className="whitespace-nowrap"><Num value={sum("revenue") === null ? null : Math.round(sum("revenue")!)} unit="원" /></Td>
                  <Td num>{fmtUsd(rows.reduce((n, r) => n + r.aiUsd, 0) || null)}</Td>
                </TotalRow>
              )}
            </tbody>
          </Table>
        </TableScroll>
      </Card>
      <p className="mt-2 text-[13px] text-nd-fg-3">
        성과는 영상을 만든 사람 기준으로 묶습니다 (출처별 마지막 기록 · 모르는 지표는 빼고 합 · 아무도 모르는 지표는 「미확인」). 쿠팡 주문 · 수익은 각자의 키로 각자의 리포트만 읽습니다.
      </p>
    </PageShell>
  );
}

/** 게시 계정 — 게시에 꼭 필요하다. 없으면 「연결 필요」 (빨강), 끊긴 것이 있으면 「다시 연결 필요」 */
function Channels({ accounts }: { accounts: AccountView[] }) {
  if (!accounts.length) return <Badge size="lg" tone="danger">연결 필요</Badge>;
  const names = accounts.map((a) => `${a.externalName}${a.coupangSubId ? ` · ${a.coupangSubId}` : ""}`).join(", ");
  const broken = accounts.some((a) => a.status === "needs_reauth");
  return (
    <div className="min-w-0">
      <Badge size="lg" tone={broken ? "danger" : "success"}>{broken ? "다시 연결 필요" : `연결됨 ${accounts.length}`}</Badge>
      <div className="mt-1 max-w-[200px] truncate text-[13px] text-nd-fg-3" title={names}>{names}</div>
    </div>
  );
}

/** 숫자 + 그 아래 비율. 숫자를 모르면 「미확인」, 분모가 0 이면 비율은 「—」 */
function CountRate({ value, rate }: { value: number | null; rate: number | null }) {
  if (value === null) return <Unknown />;
  return (
    <div className="leading-snug">
      <Num value={value} />
      <div className="nd-num text-[13px] text-nd-fg-3">({rate === null ? "—" : fmtPct(rate)})</div>
    </div>
  );
}
