"use client";

// ============================================================
//  매출 › SMOAT — 향수가 아닌 사업의 월 손익
// ------------------------------------------------------------
//  ⚠️ 이 화면은 매장 손익 표에 SMOAT 을 끼워 넣지 않는다. 같은 워크스페이스
//     안의 **다른 사업**이다 (lib/neander/smoat/types.ts 주석에 왜 그런지
//     적어 두었다). 향수의 축(상품·수량·재료비·접객 시간·이벤트)이 여기에는
//     하나도 없다.
//
//  ⚠️ 여기 금액도 **회사 매출의 정본이 아니다.** 장부에는 다날 정산 입금과
//     계좌이체가 「SMOAT매출」로 이미 들어와 있다. 매장 모듈이 POS 를 거래로
//     적재하지 않는 것과 같은 이유다. 이 화면이 답하는 것은 "누가 어떤 팩을
//     샀나"이고, 장부와는 맨 아래 대사 줄에서 만난다.
//
//  화면 순서는 매출 월 손익과 한 벌이다:
//    제목 + 계산 기준 → 핵심 지표 → 선수금 띠 → 팩별·결제수단별 → 학원별
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Server, TriangleAlert } from "lucide-react";
import {
  BasisLine,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InfoPopover,
  InlineNotice,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { SmoatActivate, useSmoat } from "@/components/neander/smoat/SmoatProvider";
import {
  buildSmoatPnl,
  smoatAccounts,
  smoatKindLabel,
  smoatMonths,
  smoatPayMethodLabel,
  type SmoatPayMethod,
} from "@/lib/neander/smoat/types";
import { monthLabel } from "@/lib/neander/format";
import { selectableMonths } from "@/lib/neander/months";

/** 장부에서 같은 조건으로 보기 — 매장 대사 화면과 같은 방식 */
function ledgerHref(month: string): string {
  const params = new URLSearchParams({
    month,
    bizMinor: "SMOAT",
    txTypes: "수입",
  });
  return `/neander/finance/ledger?${params.toString()}`;
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (n: number) => n.toLocaleString("ko-KR");

export default function SmoatPage() {
  const { sales, costs, states, loading, refreshing, error, refresh } = useSmoat();
  const [month, setMonth] = useState("");

  const known = useMemo(() => smoatMonths(sales), [sales]);
  const months = useMemo(() => selectableMonths(known), [known]);
  const activeMonth = month || known[0] || months[0] || "";

  const pnl = useMemo(
    () => buildSmoatPnl(activeMonth, sales, costs),
    [activeMonth, sales, costs],
  );
  const accounts = useMemo(() => smoatAccounts(sales, activeMonth), [sales, activeMonth]);

  const state = states.find((s) => s.id === "smoat");
  const notConfigured = state && !state.configured;

  if (loading) return <LoadingState label="SMOAT 매출을 불러오는 중…" />;

  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="SMOAT" description="영어 내신 문제·시험 생성 서비스의 매출입니다." />
        <ErrorState
          title="SMOAT 매출을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  if (sales.length === 0) {
    return (
      <PageShell width="form">
        <PageHeader title="SMOAT" description="영어 내신 문제·시험 생성 서비스의 매출입니다." />
        <EmptyState
          icon={Server}
          title="아직 받아 온 결제가 없습니다"
          description={
            notConfigured ? (
              <>
                smoat.co.kr 피드가 아직 연결되지 않았습니다.{" "}
                <Link
                  href="/neander/sales/sync"
                  className="font-medium text-nd-accent-strong hover:underline"
                >
                  자동 동기화
                </Link>
                에서 설정 상태를 확인하세요.
              </>
            ) : (
              <>
                <Link
                  href="/neander/sales/sync"
                  className="font-medium text-nd-accent-strong hover:underline"
                >
                  자동 동기화
                </Link>
                에서 「지금 동기화」를 눌러 첫 적재를 시작하세요.
              </>
            )
          }
        />
      </PageShell>
    );
  }

  const sub = monthLabel(activeMonth);
  const hasSubscription = sales.some((s) => s.kind === "subscription");

  return (
    <PageShell>
      <SmoatActivate />
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="SMOAT"
        description="영어 내신 문제·시험 생성 서비스 (smoat.co.kr) 의 결제 실적입니다."
        className="mb-3"
        actions={
          <>
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? "받는 중…" : "새로고침"}
            </Button>
            <Link href={ledgerHref(activeMonth)}>
              <Button variant="secondary" icon={ExternalLink}>
                원장 열기
              </Button>
            </Link>
          </>
        }
      />

      <BasisLine
        className="mb-4"
        items={[
          "결제일 기준",
          `${sub} 확정 결제`,
          "환불은 뺀 순매출",
          "장부는 고치지 않습니다",
        ]}
      >
        <InfoPopover
          label="계산 기준"
          title="SMOAT 매출 계산 기준"
          terms={[
            {
              term: "결제일 기준",
              desc: "돈이 들어온 날로 답니다. 크레딧이 실제로 쓰인 달이 아닙니다 — 장부의 입금과 맞춰 보려면 결제일이어야 합니다.",
            },
            {
              term: "순매출",
              desc: "결제액에서 취소·환불액을 뺀 값입니다. 사이트의 /admin/costs 화면은 환불을 상태로만 걸러 부분취소가 남아 있습니다. 두 숫자가 다르면 이쪽이 맞습니다.",
            },
            {
              term: "AI 원가",
              desc: "그 달의 AI 호출 비용입니다. 향수의 직접재료비에 해당하는 자리입니다. 달러로 기록된 값을 사이트가 쓴 환율로 환산해 받습니다.",
            },
            {
              term: "공헌이익",
              desc: "순매출 − AI 원가. 원가를 아직 못 받은 달은 0 이 아니라 「—」로 둡니다 — 0 으로 두면 이익이 부풀려 보입니다.",
            },
            {
              term: "미소진 크레딧",
              desc: "판 크레딧에서 쓰인 크레딧을 뺀 누계로, 선수금의 근사치입니다. 쓰인 크레딧에 무료 체험·프로모션 크레딧의 사용분이 섞여 있어 실제보다 작게 나옵니다. 음수가 되면 근사가 깨졌다는 뜻입니다.",
            },
            {
              term: "신규 학원",
              desc: "그 학원의 첫 결제가 이 달인 경우입니다. 무통장 수기 지급은 어느 학원인지 모를 수 있어 세지 않습니다.",
            },
          ]}
        />
      </BasisLine>

      {!hasSubscription && (
        <InlineNotice tone="info" className="mb-4">
          지금 SMOAT 의 매출은 <b>크레딧 팩 선결제</b>가 거의 전부입니다. 정기구독은 다날 정기결제
          심사가 끝나지 않아 사이트에서 꺼져 있어 결제 건수가 0 입니다. 심사가 끝나면 이 화면에
          구독 줄이 저절로 들어옵니다.
        </InlineNotice>
      )}

      {pnl.aiCost === null && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          {sub} 의 AI 원가를 아직 받지 못했습니다. 공헌이익을 계산할 수 없어 「—」로 둡니다.
        </InlineNotice>
      )}

      <KpiStrip columns={4} className="mb-5">
        <StatTile
          label={`${sub} 순매출`}
          value={pnl.revenue}
          flow="income"
          hint={pnl.refund > 0 ? `환불 ${num(pnl.refund)}원 뺀 값` : `결제 ${pnl.count}건`}
        />
        <StatTile
          label="AI 원가"
          value={pnl.aiCost ?? 0}
          flow="expense"
          hint={pnl.aiCost === null ? "아직 받지 못했습니다" : "그 달 호출 비용"}
        />
        <StatTile
          label="공헌이익"
          value={pnl.contribution ?? 0}
          flow="income"
          hint={pnl.contribution === null ? "원가를 모릅니다" : `이익률 ${pct(pnl.contributionRate)}`}
          tag={pnl.contribution !== null && pnl.contribution < 0 ? "손실" : undefined}
        />
        <StatTile
          label="결제 학원"
          value={pnl.accounts}
          hint={`신규 ${pnl.newAccounts} · 학원당 ${pnl.arpa === null ? "—" : `${num(pnl.arpa)}원`}`}
        />
      </KpiStrip>

      {/* 선수금 — 매출과 나란히 두어야 "번 것"과 "갚아야 할 것"이 갈린다 */}
      <Card className="mb-5">
        <SectionHeader
          title="크레딧"
          hint="판 것과 쓰인 것의 차이가 아직 갚지 않은 몫입니다"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-nd-sm text-nd-fg-3">이 달 판 크레딧</div>
            <div className="nd-num text-nd-lg font-semibold">{num(pnl.creditsSold)}</div>
          </div>
          <div>
            <div className="text-nd-sm text-nd-fg-3">이 달 쓰인 크레딧</div>
            <div className="nd-num text-nd-lg font-semibold">{num(pnl.creditsUsed)}</div>
          </div>
          <div>
            <div className="text-nd-sm text-nd-fg-3">판 것 − 쓰인 것 누계 (선수금 근사)</div>
            <div
              className={`nd-num text-nd-lg font-semibold ${pnl.unusedCredits < 0 ? "text-nd-danger" : ""}`}
            >
              {num(pnl.unusedCredits)}
            </div>
            <div className="mt-0.5 text-nd-micro text-nd-fg-3">
              무료 크레딧 사용분이 섞여 실제보다 작게 나옵니다
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader title="팩별" />
          </div>
          <TableScroll>
            <Table minWidth={420} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">팩</Th>
                  <Th sticky="top" align="right">건수</Th>
                  <Th sticky="top" align="right">크레딧</Th>
                  <Th sticky="top" align="right" className="pr-5">순매출</Th>
                </tr>
              </thead>
              <tbody>
                {pnl.byPack.map((p) => (
                  <Tr key={p.label}>
                    <Td className="pl-5">{p.label}</Td>
                    <Td num>{p.count}</Td>
                    <Td num>{num(p.credits)}</Td>
                    <Td num className="pr-5 font-semibold">
                      <Money value={p.amount} unit={false} flow="income" />
                    </Td>
                  </Tr>
                ))}
                <TotalRow>
                  <Td className="pl-5">합계</Td>
                  <Td num>{pnl.count}</Td>
                  <Td num>{num(pnl.byPack.reduce((s, p) => s + p.credits, 0))}</Td>
                  <Td num className="pr-5">
                    <Money value={pnl.revenue} unit={false} flow="income" />
                  </Td>
                </TotalRow>
              </tbody>
            </Table>
          </TableScroll>
        </Card>

        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader title="결제수단별" hint="PG 수수료의 근거" />
          </div>
          <TableScroll>
            <Table minWidth={420} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">수단</Th>
                  <Th sticky="top" align="right">건수</Th>
                  <Th sticky="top" align="right" className="pr-5">순매출</Th>
                </tr>
              </thead>
              <tbody>
                {pnl.byMethod.map((m) => (
                  <Tr key={m.method}>
                    <Td className="pl-5">
                      {m.method === "unknown"
                        ? "알 수 없음"
                        : smoatPayMethodLabel(m.method as SmoatPayMethod)}
                    </Td>
                    <Td num>{m.count}</Td>
                    <Td num className="pr-5 font-semibold">
                      <Money value={m.amount} unit={false} flow="income" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <TableNote>
            요율은 아직 넣지 않았습니다 — 다날 정산 내역이 정본이고, 그 값을 받기 전까지
            추정하지 않습니다.
          </TableNote>
        </Card>
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader title="학원별" hint={`${sub} 에 결제한 학원 ${accounts.length}곳`} />
        </div>
        <TableScroll>
          <Table minWidth={620} dense>
            <thead>
              <tr>
                <Th sticky="top" className="pl-5">학원</Th>
                <Th sticky="top" align="right">건수</Th>
                <Th sticky="top" align="right">순매출</Th>
                <Th sticky="top" className="pr-5">첫 결제</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const isNew = a.firstDate.slice(0, 7) === activeMonth;
                return (
                  <Tr key={a.accountId}>
                    <Td className="pl-5">{a.accountName}</Td>
                    <Td num>{a.count}</Td>
                    <Td num className="font-semibold">
                      <Money value={a.amount} unit={false} flow="income" />
                    </Td>
                    <Td className="pr-5 text-nd-sm text-nd-fg-3">
                      {a.firstDate}
                      {isNew && <span className="ml-1 text-nd-accent-strong">신규</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
        <TableNote>
          무통장 수기 지급({smoatKindLabel("deposit")})은 어느 학원인지 모를 수 있어 이 표에
          나오지 않습니다. 위 순매출에는 들어갑니다.
        </TableNote>
      </Card>
    </PageShell>
  );
}
