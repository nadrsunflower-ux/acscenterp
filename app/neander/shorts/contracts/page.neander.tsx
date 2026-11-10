"use client";

// ============================================================
//  AI STUDIO 계약 — 업체별 대행 계약 조건 + 재무 계약을 한 표로 (2026-11 새 화면)
// ------------------------------------------------------------
//  새 API 없이 이미 받은 자료만 쓴다:
//    계약 조건 — 업체 문서의 contract (월 금액 · 부가세 · 월 편수 · 수정 상한 · 기간) · delivery(게시 방식)
//    재무 계약 — clientFinance (재무 권한이 있을 때만 서버가 보낸다): 계약 금액 · 받음 · 남음 · 다음 받을 날 · 연체 · 계약서
//  줄을 누르면 업체 상세의 「재무 · 계약서」 탭으로 간다 (재무 권한이 없으면 「계약 · 브리프」 탭).
//  고치기는 업체 상세(계약 조건)와 재무 화면(금액 · 회차 · 계약서)에서 한다 — 여기는 읽기만.
//  대행 접근 제한(관리자 · 그 업체 담당자)은 서버가 거른 data.clients 를 그대로 써서 지킨다.
// ============================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Building2, FileSignature, Lock } from "lucide-react";
import { Badge, EmptyState, FilterBar, FilterField, PageShell, SearchInput, Select, buttonClass } from "@/components/neander/ui";
import { Won } from "@/components/neander/shorts/agency-ui/won";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Unknown } from "@/components/neander/shorts/parts";
import { RecordTable, StudioCard, StudioHeader, StudioMetric, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { fmtDateStr, rollupFinance, vatText, wonText, type FinanceRollup } from "@/components/neander/shorts/agency-ui/finance";
import { CONTRACT_STATUS_TEXT, inContract, type ClientFinanceContract } from "@/lib/neander/shorts/agency";
import { currentMonth } from "@/lib/neander/shorts/model";
import { planText, revisionText } from "@/lib/neander/shorts/plans";
import { splitVat } from "@/lib/neander/finance/project";
import { CLIENT_DELIVERY_LABEL, type ClientStatus, type ClientView } from "@/lib/neander/shorts/types";

const STATUS = { active: ["진행", "success"], paused: ["멈춤", "warning"], ended: ["종료", "neutral"] } as const;
const DOC_ORDER: ClientFinanceContract["status"][] = ["signed", "draft", "done", "cancelled"];

type Row = { c: ClientView; inMonth: boolean; fin: FinanceRollup | null; codes: number };

export default function ContractsPage() {
  const { data, nameOf } = useShorts();
  const d = data!;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | ClientStatus>("");
  const month = currentMonth();
  const rows: Row[] = useMemo(
    () =>
      d.clients.map((c) => {
        const fs = d.financeAccess ? d.clientFinance[c.id] : undefined;
        return { c, inMonth: inContract(c, month), fin: d.financeAccess ? rollupFinance(fs) : null, codes: (fs ?? []).length };
      }),
    [d.clients, d.financeAccess, d.clientFinance, month],
  );
  const shown = rows.filter(({ c }) => {
    if (status && c.status !== status) return false;
    const t = q.trim().toLowerCase();
    return !t || c.name.toLowerCase().includes(t) || c.members.some((m) => m.toLowerCase().includes(t) || nameOf(m).toLowerCase().includes(t));
  });

  // 위 4칸 — 진행 중이고 이 달이 계약 기간 안인 업체
  const live = rows.filter((r) => r.c.status === "active" && r.inMonth);
  const fees = live.filter((r) => r.c.contract.monthlyFeeKrw !== null).map((r) => splitVat(r.c.contract.monthlyFeeKrw!, r.c.contract.vat));
  const supply = fees.reduce((n, x) => n + x.supply, 0);
  const total = fees.reduce((n, x) => n + x.total, 0);
  const fins = rows.map((r) => r.fin).filter((x): x is FinanceRollup => !!x);
  const finContract = fins.reduce((n, x) => n + x.contract, 0);
  const finKnown = fins.filter((x) => x.received !== null);
  const finReceived = finKnown.reduce((n, x) => n + (x.received ?? 0), 0);
  const finVat = new Set(fins.map((x) => x.vat));
  const overdue = fins.reduce((n, x) => n + x.overdue, 0);
  const videos = live.reduce((n, r) => n + r.c.contract.videosPerMonth, 0);

  const columns: RecordColumn<Row>[] = [
    {
      key: "name",
      header: "업체",
      mobile: "title",
      cell: ({ c }) => (
        <span className="block min-w-0 max-w-[220px]">
          <span className="block truncate font-semibold" title={c.name}>
            {c.name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] font-normal text-nd-fg-3">
            <Badge size="lg" dot tone={STATUS[c.status][1]}>
              {STATUS[c.status][0]}
            </Badge>
            <span className="truncate">담당 {c.members.map(nameOf).join(", ") || "없음"}</span>
          </span>
        </span>
      ),
    },
    {
      key: "fee",
      header: "월 금액",
      align: "right",
      cell: ({ c }) => {
        if (c.contract.monthlyFeeKrw === null) return <Unknown title="계약 금액을 아직 적지 않았습니다" />;
        const s = splitVat(c.contract.monthlyFeeKrw, c.contract.vat);
        return (
          <span className="block whitespace-nowrap">
            <Won value={c.contract.monthlyFeeKrw} flow="income" className="font-semibold" />
            <span className="block text-[13px] text-nd-fg-3">{vatText(c.contract.vat)}</span>
            <span className="block text-[13px] text-nd-fg-3">{c.contract.vat === "excluded" ? `받을 돈 ${wonText(s.total)}` : `공급가액 ${wonText(s.supply)}`}</span>
            {c.contract.plan && <span className="block text-[13px] text-nd-fg-3">{planText(c.contract)}</span>}
          </span>
        );
      },
    },
    {
      key: "terms",
      header: "편수 · 수정",
      cell: ({ c }) => (
        <span className="block whitespace-nowrap">
          월 {c.contract.videosPerMonth}편
          <span className="block text-[13px] text-nd-fg-3">수정 {revisionText(c.contract)}</span>
        </span>
      ),
    },
    {
      key: "period",
      header: "기간 · 게시 방식",
      cell: ({ c, inMonth }) => (
        <span className="block">
          <span className="nd-num flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap md:justify-start">
            {c.contract.startMonth} ~ {c.contract.endMonth ?? "계속"}
            {!inMonth && (
              <Badge tone="neutral" size="lg">
                기간 밖
              </Badge>
            )}
          </span>
          <span className="block text-[13px] text-nd-fg-3">{CLIENT_DELIVERY_LABEL[c.delivery ?? "upload"]}</span>
        </span>
      ),
    },
    ...(d.financeAccess
      ? ([
          {
            key: "fin",
            header: "재무 계약 금액",
            align: "right",
            cell: ({ fin, codes }) =>
              !fin ? (
                <span className="text-nd-fg-3">{codes ? "재무에서 못 찾음" : "이은 계약 없음"}</span>
              ) : (
                <span className="block whitespace-nowrap">
                  <Won value={fin.contract} flow="income" className="font-semibold" />
                  <span className="block text-[13px] text-nd-fg-3">{vatText(fin.vat)}</span>
                  <span className="block text-[13px] text-nd-fg-3">계약 {fin.count}건</span>
                </span>
              ),
          },
          {
            key: "got",
            header: "받음 · 남음",
            align: "right",
            cell: ({ fin }) =>
              !fin ? (
                <span className="text-nd-fg-3">—</span>
              ) : fin.received === null ? (
                <Unknown title="회차가 없어 받은 돈을 셀 수 없습니다" />
              ) : (
                <span className="block whitespace-nowrap">
                  <Won value={fin.received} flow="income" />
                  <span className="block text-[13px] text-nd-fg-3">남음 {wonText(fin.remaining ?? 0)}</span>
                </span>
              ),
          },
          {
            key: "next",
            header: "다음 받을 날",
            cell: ({ fin }) =>
              !fin ? (
                <span className="text-nd-fg-3">—</span>
              ) : fin.next ? (
                <span className="block whitespace-nowrap">
                  <span className="nd-num font-medium">{fmtDateStr(fin.next.date)}</span>
                  <span className="block text-[13px] text-nd-fg-3">{wonText(fin.next.amount)}</span>
                  <span className="block text-[13px] text-nd-fg-3">{vatText(fin.next.vat)}</span>
                </span>
              ) : (
                <span className="text-nd-fg-3">잡힌 회차 없음</span>
              ),
          },
          {
            key: "docs",
            header: "연체 · 계약서",
            cell: ({ fin }) => {
              if (!fin) return <span className="text-nd-fg-3">—</span>;
              const counts = DOC_ORDER.map((s) => [s, fin.contracts.filter((k) => k.status === s).length] as const).filter(([, n]) => n > 0);
              return (
                <span className="flex flex-wrap items-center justify-end gap-1.5 md:max-w-[190px] md:justify-start">
                  {fin.overdue > 0 ? (
                    <Badge tone="danger" size="lg">
                      연체 {fin.overdue}건
                    </Badge>
                  ) : (
                    <Badge tone="success" size="lg">
                      연체 없음
                    </Badge>
                  )}
                  {counts.length ? (
                    counts.map(([s, n]) => (
                      <Badge key={s} tone={s === "signed" ? "info" : s === "done" ? "success" : s === "cancelled" ? "neutral" : "warning"} size="lg">
                        {CONTRACT_STATUS_TEXT[s]} {n}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[13px] text-nd-fg-3">계약서 없음</span>
                  )}
                </span>
              );
            },
          },
        ] satisfies RecordColumn<Row>[])
      : []),
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FileSignature}
        title="계약"
        description="업체마다 대행 계약 조건과 재무 계약(입금 · 계약서)을 한 표로 봅니다. 줄을 누르면 업체 상세의 「재무 · 계약서」 로 갑니다 — 계약 조건은 업체 상세에서, 금액 · 회차 · 계약서는 재무 화면에서 고칩니다."
        actions={
          <Link href="/neander/shorts/clients" className={buttonClass("secondary", "md", "gap-1.5")}>
            <Building2 size={16} aria-hidden />
            업체 · 계약 목록
          </Link>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StudioMetric label="진행 중 계약" value={live.length.toLocaleString("ko-KR")} unit="곳" detail={`볼 수 있는 업체 ${rows.length}곳 · ${Number(month.slice(5))}월 기준`} />
        <StudioMetric label="월 계약 금액 (공급가액)" value={fees.length ? <Won value={supply} flow="income" /> : "—"} detail={fees.length ? `부가세 포함 받을 돈 ${wonText(total)} · 월 ${videos}편` : "금액을 적은 진행 중 계약 없음"} />
        {d.financeAccess ? (
          <>
            <StudioMetric
              label="재무 계약 받음 / 계약"
              value={finKnown.length ? <Won value={finReceived} flow="income" /> : fins.length ? <Unknown title="회차가 없어 받은 돈을 셀 수 없습니다" /> : "—"}
              detail={fins.length ? `/ ${wonText(finContract)} · ${finVat.size === 1 ? vatText([...finVat][0]) : vatText("mixed")}` : "이은 재무 계약 없음"}
            />
            <StudioMetric label="연체" value={overdue.toLocaleString("ko-KR")} unit="건" tone={overdue ? "danger" : undefined} detail="기한 지난 미입금 회차 (재무 기준)" />
          </>
        ) : (
          <>
            <StudioMetric label="월 계약 편수" value={videos.toLocaleString("ko-KR")} unit="편" detail="진행 중 계약 합계" />
            <StudioMetric label="재무 계약" value={<span className="text-[18px] text-nd-fg-3">권한 필요</span>} detail="재무 권한이 있는 사람에게만 보입니다" />
          </>
        )}
      </div>
      {!d.financeAccess && (
        <StudioNotice tone="neutral" icon={Lock} title="재무 계약 · 입금 · 계약서는 재무 권한이 있는 사람에게만 보입니다" className="mb-5">
          계약 조건(월 금액 · 편수 · 수정 상한 · 기간 · 게시 방식)만 보여 줍니다. 줄을 누르면 업체 상세의 「계약 · 브리프」 로 갑니다.
        </StudioNotice>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="볼 수 있는 계약이 없습니다"
          description="대행 업체는 AI STUDIO 관리자와 그 업체 담당자에게만 보입니다. 새 업체는 「업체 · 계약」 에서 등록합니다."
          action={
            <Link href="/neander/shorts/clients" className={buttonClass("secondary", "md", "gap-1.5")}>
              <ArrowUpRight size={16} aria-hidden />
              업체 · 계약으로
            </Link>
          }
        />
      ) : (
        <StudioCard
          flush
          title="업체별 계약"
          action={
            <Badge tone="neutral" size="lg">
              {shown.length === rows.length ? `${rows.length}곳` : `${shown.length} / ${rows.length}곳`}
            </Badge>
          }
        >
          <div className="px-5 pb-4 sm:px-6">
            <FilterBar>
              <FilterField label="업체 검색">
                <SearchInput value={q} onValueChange={setQ} placeholder="업체 이름 또는 담당자" ariaLabel="업체 검색" />
              </FilterField>
              <FilterField label="진행 상태">
                <Select size="sm" value={status} onChange={(e) => setStatus(e.target.value as "" | ClientStatus)} aria-label="진행 상태">
                  <option value="">전체 상태</option>
                  <option value="active">진행</option>
                  <option value="paused">멈춤</option>
                  <option value="ended">종료</option>
                </Select>
              </FilterField>
            </FilterBar>
          </div>
          <RecordTable
            rows={shown}
            columns={columns}
            rowKey={(r) => r.c.id}
            rowHref={(r) => `/neander/shorts/clients/${r.c.id}?tab=${d.financeAccess ? "finance" : "brief"}`}
            ariaLabel="업체별 계약"
            className="[&>ul]:px-4 [&>ul]:pb-4"
            empty={<p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">조건에 맞는 업체가 없습니다.</p>}
          />
        </StudioCard>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-[13px] text-nd-fg-3">
        <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
        AI STUDIO 관리자와 그 업체 담당자에게만 보입니다. 계약은 제작 편수 · 수정 횟수까지이며 조회수를 약속하지 않습니다.
      </p>
    </PageShell>
  );
}
