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
import { fmtUsd } from "@/components/neander/shorts/parts";
import { fmtCount, fmtPct, perfRates, projectCost, projectTotals } from "@/lib/neander/shorts/model";

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
        const totals = projectTotals(d.metrics.filter((m) => ids.has(m.projectId)));
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

  const sum = (k: "views" | "infoRequests" | "clicks" | "orders" | "revenue") => rows.reduce((n, r) => n + (r.totals[k] ?? 0), 0);
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
      <Card padding="none">
        <TableScroll>
          <Table minWidth={1240}>
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
                return (
                  <Tr key={r.email} selected={viewer === r.email || (viewer === "mine" && r.email === d.me)}>
                    <Td sticky="left">
                      <button type="button" className="text-left" onClick={() => open(r.email)}>
                        <span className="font-medium hover:underline">{nameOf(r.email)}</span>
                        {r.email === d.me && <span className="ml-1 text-nd-caption text-nd-fg-3">(나)</span>}
                        <div className="text-nd-caption text-nd-fg-3">{r.email}</div>
                      </button>
                    </Td>
                    <Td className="text-nd-caption">{r.youtube.length ? r.youtube.map((a) => `${a.externalName}${a.coupangSubId ? ` · ${a.coupangSubId}` : ""}`).join(", ") : <span className="text-nd-fg-3">미연결</span>}</Td>
                    <Td className="text-nd-caption">{r.instagram.length ? r.instagram.map((a) => `${a.externalName}${a.coupangSubId ? ` · ${a.coupangSubId}` : ""}`).join(", ") : <span className="text-nd-fg-3">미연결</span>}</Td>
                    <Td>
                      <Badge size="sm" tone={KEY_LABEL[k][1]}>{KEY_LABEL[k][0]}</Badge>
                      <div className="text-nd-caption text-nd-fg-3">
                        {r.profile?.coupang.afCode || ""}
                        {r.profile?.subIds.length ? ` 채널 아이디 ${r.profile.subIds.length}개` : ""}
                      </div>
                    </Td>
                    <Td num>{r.projects.length}</Td>
                    <Td num>{r.published}{r.scheduled ? <span className="ml-1 text-nd-caption text-nd-fg-3">+예약 {r.scheduled}</span> : null}</Td>
                    <Td num className={r.attention ? "text-nd-warning-text" : ""}>{r.attention}</Td>
                    <Td num>{fmtCount(r.totals.views)}</Td>
                    <Td num>{fmtCount(r.totals.infoRequests)} <span className="text-nd-fg-3">({fmtPct(r.rates.infoRate)})</span></Td>
                    <Td num>{fmtCount(r.totals.clicks)} <span className="text-nd-fg-3">({fmtPct(r.rates.ctr)})</span></Td>
                    <Td num>{fmtCount(r.totals.orders)}</Td>
                    <Td num>{r.totals.revenue === null ? "—" : `${Math.round(r.totals.revenue).toLocaleString("ko-KR")}원`}</Td>
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
                  <Td num>{rows.reduce((n, r) => n + r.projects.length, 0)}</Td>
                  <Td num>{rows.reduce((n, r) => n + r.published, 0)}</Td>
                  <Td num>{rows.reduce((n, r) => n + r.attention, 0)}</Td>
                  <Td num>{fmtCount(sum("views"))}</Td>
                  <Td num>{fmtCount(sum("infoRequests"))}</Td>
                  <Td num>{fmtCount(sum("clicks"))}</Td>
                  <Td num>{fmtCount(sum("orders"))}</Td>
                  <Td num>{Math.round(sum("revenue")).toLocaleString("ko-KR")}원</Td>
                  <Td num>{fmtUsd(rows.reduce((n, r) => n + r.aiUsd, 0) || null)}</Td>
                </TotalRow>
              )}
            </tbody>
          </Table>
        </TableScroll>
      </Card>
      <p className="mt-2 text-nd-caption text-nd-fg-3">
        성과는 영상을 만든 사람 기준으로 묶습니다 (출처별 마지막 기록 · 모르는 지표는 빼고 합). 쿠팡 주문 · 수익은 각자의 키로 각자의 리포트만 읽습니다.
      </p>
    </PageShell>
  );
}
