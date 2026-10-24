"use client";

// ============================================================
//  지원금 — 목록
// ------------------------------------------------------------
//  지원사업마다 총 지원금 · 받은 돈 · 남은 돈 · 다음 입금 · 쓴 돈을 한 줄로 본다.
//  셈은 lib/neander/finance/grant.ts. 회차 · 비목 입력은 상세 화면에서.
//
//  모양은 프로젝트 목록을 따른다 — 제목 줄 → 상태 탭 → 핵심 지표 → 표.
//  「새 지원사업」 은 Dialog (프로젝트와 같은 이유: 인라인으로 열면 아래 숫자가 밀린다).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Landmark, Plus, SearchX } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  Money,
  NumberInput,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Th,
  type Tone,
  Tr,
  useStickyState,
} from "@/components/neander/ui";
import { AutoCodeBox } from "@/components/neander/finance/AutoCode";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { nextCode, saveWithAutoCode, takenCodes } from "@/lib/neander/finance/codes";
import { saveGrant, useGrants } from "@/lib/neander/finance/grant-client";
import {
  emptyGrant,
  GRANT_KINDS,
  GRANT_STATUSES,
  GRANT_STATUS_LABEL,
  grantDueLabel,
  grantSummary,
  OPEN_GRANT_STATUSES,
  sortGrants,
  type FinGrantInput,
  type GrantKind,
  type GrantStatus,
} from "@/lib/neander/finance/grant";
import { shiftMonth, todayStrKST } from "@/lib/neander/format";

/** 상태 → 의미 색 (상세 화면과 같은 표) */
const GRANT_STATUS_TONE: Record<GrantStatus, Tone> = {
  applying: "neutral",
  active: "accent",
  settling: "warning",
  done: "success",
  dropped: "danger",
};

export default function GrantsPage() {
  const { transactions, loading: finLoading } = useFinance();
  const { grants, loading, error, refresh } = useGrants();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useStickyState<GrantStatus | "all">("finance.grants.status", "all");

  const today = todayStrKST();
  const thisMonth = today.slice(0, 7);
  const nextMonth = shiftMonth(thisMonth, 1);

  const rows = useMemo(
    () =>
      sortGrants(grants)
        .filter((g) => statusFilter === "all" || g.status === statusFilter)
        .map((g) => ({ g, s: grantSummary(g, transactions, today) })),
    [grants, transactions, statusFilter, today],
  );

  // 머리 숫자 — 아직 돈이 오가는 사업만 (끝난 · 탈락한 사업의 남은 돈은 받을 돈이 아니다)
  const head = useMemo(() => {
    const open = rows.filter((r) => OPEN_GRANT_STATUSES.includes(r.g.status));
    const due = (month: string) =>
      open.reduce(
        (n, r) => n + r.s.installments.filter((v) => v.remaining > 0 && v.inst.dueDate?.startsWith(month)).reduce((a, v) => a + v.remaining, 0),
        0,
      );
    return {
      remaining: open.reduce((n, r) => n + r.s.remaining, 0),
      overdue: open.reduce((n, r) => n + r.s.overdue, 0),
      thisMonth: due(thisMonth),
      nextMonth: due(nextMonth),
      received: rows.reduce((n, r) => n + r.s.received, 0),
      budget: rows.reduce((n, r) => n + r.s.budgetTotal, 0),
      spent: rows.reduce((n, r) => n + r.s.spent, 0),
      openCount: open.length,
    };
  }, [rows, thisMonth, nextMonth]);

  const statusTabs = useMemo(() => {
    const counted = GRANT_STATUSES.map((st) => ({ st, n: grants.filter((g) => g.status === st).length })).filter((x) => x.n > 0);
    return [
      { key: "all", label: "전체", hint: grants.length.toLocaleString("ko-KR") },
      ...counted.map((x) => ({ key: x.st, label: GRANT_STATUS_LABEL[x.st], hint: x.n.toLocaleString("ko-KR") })),
    ];
  }, [grants]);

  if (loading || finLoading) return <LoadingState />;

  return (
    <PageShell width="wide">
      <PageHeader
        title="지원금"
        description="창업 · 고용 · R&D 지원사업마다 들어올 돈과, 그 돈을 비목별로 얼마나 썼는지 봅니다."
        className="mb-4"
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)} disabled={creating}>
            새 지원사업
          </Button>
        }
      />

      {creating && (
        <NewGrantDialog
          onCancel={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            router.push(`/neander/finance/grants/${id}`);
          }}
        />
      )}

      {error && (
        <InlineNotice tone="danger" className="mb-4">
          {error}
        </InlineNotice>
      )}

      {grants.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="아직 지원사업이 없습니다"
          description="「새 지원사업」 으로 이름 · 코드 · 총 지원금을 넣고, 다음 화면에서 받을 회차와 비목을 채우세요."
          action={
            <Button icon={Plus} onClick={() => setCreating(true)} disabled={creating}>
              새 지원사업
            </Button>
          }
        />
      ) : (
        <>
          <Tabs
            className="mb-3"
            ariaLabel="지원사업 상태"
            value={statusFilter}
            onChange={(k) => setStatusFilter(k as GrantStatus | "all")}
            items={statusTabs}
          />

          <KpiStrip columns={4} className="mb-4">
            <StatTile
              label="남은 지원금"
              value={head.remaining}
              flow="income"
              tone={head.overdue > 0 ? "danger" : undefined}
              hint={head.overdue > 0 ? `늦은 돈 ${head.overdue.toLocaleString("ko-KR")}원 포함` : `진행 중 ${head.openCount}건 · 아직 안 들어온 돈`}
            />
            <StatTile
              label={`이번 달 (${Number(thisMonth.slice(5))}월) 들어올 돈`}
              value={head.thisMonth}
              flow="income"
              hint={`다음 달 ${head.nextMonth.toLocaleString("ko-KR")}원`}
            />
            <StatTile label="받은 돈" value={head.received} flow="income" hint="원장 입금 − 반납 (표에 남은 사업)" />
            <StatTile
              label="쓴 돈 / 예산"
              value={head.spent}
              flow="expense"
              hint={head.budget > 0 ? `예산 ${head.budget.toLocaleString("ko-KR")}원 · ${Math.round((head.spent / head.budget) * 100)}%` : "비목 예산을 아직 안 적었습니다"}
            />
          </KpiStrip>

          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="지원사업 목록"
                hint={`${rows.length.toLocaleString("ko-KR")}건`}
                action={<TableNote>단위: 원 · 지원금은 면세라 통장에 들어오는 금액 그대로</TableNote>}
              />
            </div>
            {rows.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState
                  compact
                  icon={SearchX}
                  title="이 상태의 지원사업이 없습니다"
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setStatusFilter("all")}>
                      전체 보기
                    </Button>
                  }
                />
              </div>
            ) : (
              <TableScroll>
                <Table minWidth={1100}>
                  <thead>
                    <tr>
                      <Th sticky="left" className="pl-5">지원사업</Th>
                      <Th>상태</Th>
                      <Th>종류</Th>
                      <Th>협약 기간</Th>
                      <Th align="right">총 지원금</Th>
                      <Th align="right">받은 돈</Th>
                      <Th align="right">남은 돈</Th>
                      <Th>다음 입금</Th>
                      <Th align="right" className="pr-5">쓴 돈 / 예산</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ g, s }) => (
                      <Tr
                        key={g.id}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a")) return;
                          router.push(`/neander/finance/grants/${g.id}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") router.push(`/neander/finance/grants/${g.id}`);
                        }}
                        tabIndex={0}
                        role="link"
                        aria-label={`${g.name} 상세`}
                        className="cursor-pointer focus:bg-nd-accent-soft/60 focus:outline-none"
                      >
                        <Td sticky="left" className="pl-5">
                          <Link
                            href={`/neander/finance/grants/${g.id}`}
                            className="block max-w-[24rem] truncate font-medium text-nd-fg hover:text-nd-accent-strong"
                            title={g.name}
                          >
                            {g.name}
                          </Link>
                          <div className="truncate text-nd-caption text-nd-fg-3">
                            <span className="font-mono">{g.code}</span>
                            {g.agency && <span> · {g.agency}</span>}
                          </div>
                        </Td>
                        <Td>
                          <Badge tone={GRANT_STATUS_TONE[g.status]} dot>
                            {GRANT_STATUS_LABEL[g.status]}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap text-nd-fg-2">{g.kind}</Td>
                        <Td className="whitespace-nowrap text-nd-table text-nd-fg-2">
                          {g.startDate || g.endDate ? `${g.startDate ?? "?"} ~ ${g.endDate ?? "?"}` : "—"}
                        </Td>
                        <Td num><Money value={s.total || s.scheduled} unit={false} muted={!s.total} /></Td>
                        <Td num><Money value={s.received} unit={false} flow="income" /></Td>
                        <Td num>
                          {s.remaining === 0 ? (
                            <span className="text-nd-fg-4">—</span>
                          ) : (
                            <span className={s.overdue > 0 ? "font-medium text-nd-danger-text" : undefined}>
                              <Money value={s.remaining} unit={false} className={s.overdue > 0 ? "text-nd-danger-text" : undefined} />
                              {s.overdue > 0 && <span className="ml-1 text-nd-micro">늦음</span>}
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-nd-table">
                          {s.next ? (
                            <>
                              <span className="text-nd-fg">{s.next.dueDate ? grantDueLabel(s.next) : "날짜 미정"}</span>
                              <span className="ml-1.5 text-nd-fg-3">{s.next.amount.toLocaleString("ko-KR")}</span>
                            </>
                          ) : (
                            <span className="text-nd-fg-4">—</span>
                          )}
                        </Td>
                        <Td num className="pr-5">
                          {s.budgetTotal > 0 || s.spent !== 0 ? (
                            <>
                              <Money value={s.spent} unit={false} flow="expense" />
                              <span className="text-nd-fg-3"> / {s.budgetTotal.toLocaleString("ko-KR")}</span>
                            </>
                          ) : (
                            <span className="text-nd-fg-4">—</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

function NewGrantDialog({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => Promise<void> }) {
  const { projects, transactions } = useFinance();
  const { grants } = useGrants();
  const [form, setForm] = useState<FinGrantInput>(emptyGrant());
  // 코드는 저절로 — 협약 시작일의 연월 + 순번 (codes.ts). 프로젝트 · 원장 코드도 피한다
  const taken = useMemo(
    () => takenCodes(grants.map((g) => g.code), projects.map((p) => p.code), transactions.map((t) => t.projectCode)),
    [grants, projects, transactions],
  );
  const autoCode = nextCode("grant", taken, form.startDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FinGrantInput>(k: K, v: FinGrantInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const { result } = await saveWithAutoCode("grant", taken, form.startDate, (code) => saveGrant({ ...form, code }));
      await onCreated(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      closeOnOverlay={false}
      size="lg"
      title="새 지원사업"
      description="이름과 총 지원금만 넣으면 됩니다. 코드는 저절로 붙고, 받을 회차와 비목은 다음 화면에서."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>취소</Button>
          <Button onClick={submit} loading={saving} disabled={!form.name.trim()}>
            만들고 회차 입력으로
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="사업 이름" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="2026 초기창업패키지" autoFocus />
        </Field>
        <Field label="코드" hint="자동 — 협약 시작일의 연월 + 순번. 원장 프로젝트코드로 씁니다">
          <AutoCodeBox code={autoCode} />
        </Field>
        <Field label="종류" hint="원장 계정 「지원금」 의 소분류와 같습니다">
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value as GrantKind)}>
            {GRANT_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
        </Field>
        <Field label="주관 · 전담기관">
          <Input value={form.agency ?? ""} onChange={(e) => set("agency", e.target.value || undefined)} placeholder="중소벤처기업부 · 서울시" />
        </Field>
        <Field label="총 지원금" hint="정부 몫 — 자부담은 다음 화면에서">
          <NumberInput value={form.total || ""} onValueChange={(v) => set("total", Number(v) || 0)} className="text-right" placeholder="0" />
        </Field>
        <Field label="상태">
          <Select value={form.status} onChange={(e) => set("status", e.target.value as GrantStatus)}>
            {GRANT_STATUSES.map((st) => (
              <option key={st} value={st}>{GRANT_STATUS_LABEL[st]}</option>
            ))}
          </Select>
        </Field>
        <Field label="협약 시작일">
          <Input type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || undefined)} />
        </Field>
        <Field label="협약 종료일">
          <Input type="date" value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || undefined)} />
        </Field>
      </div>
      {error && (
        <InlineNotice tone="danger" className="mt-3">
          {error}
        </InlineNotice>
      )}
    </Dialog>
  );
}
