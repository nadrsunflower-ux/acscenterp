"use client";

// ============================================================
//  프로젝트 손익 — 목록
// ------------------------------------------------------------
//  행사·납품 건마다 계약금액과 원가(체크리스트 합계)를 나란히 놓고
//  이익을 본다. 줄 단위 입력은 상세 화면에서 한다 (project.ts 머리말).
//
//  「원장 지출」 열은 참고값이다. 원장에 같은 프로젝트코드가 찍힌 지출의
//  합인데, 체크리스트의 실제 원가와 다를 수 있다 — 카드 대금은 늦게
//  찍히고 현금은 원장에 없을 수 있다. 두 숫자가 크게 다르면 어느 쪽이
//  빠졌는지 살펴보라는 신호다.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  InlineNotice,
  KpiStrip,
  LoadingState,
  PageHeader,
  Select,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
  cn,
  type Tone,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { Money, SectionTitle, StatTile } from "@/components/neander/finance/ui";
import { saveFinProject } from "@/lib/neander/finance/client";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  emptyProject,
  formatMargin,
  projectSummary,
  sortProjects,
  type FinProjectInput,
  type ProjectStatus,
} from "@/lib/neander/finance/project";

/** 상태 → 의미 색. 데이터가 가진 색이 아니라 상태의 뜻이라 tone 으로 */
const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: "neutral",
  active: "accent",
  done: "success",
  cancelled: "danger",
};

export default function ProjectsPage() {
  const { projects, transactions, docs, loading, refresh } = useFinance();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");

  const rows = useMemo(
    () =>
      sortProjects(projects)
        .filter((p) => statusFilter === "all" || p.status === statusFilter)
        .map((p) => ({ p, s: projectSummary(p, transactions) })),
    [projects, transactions, statusFilter],
  );

  // 머리 숫자는 취소를 뺀 프로젝트만 — 취소된 계약금액이 합계에 섞이면 안 된다
  const head = useMemo(() => {
    const live = projects.filter((p) => p.status !== "cancelled").map((p) => projectSummary(p, transactions));
    return live.reduce(
      (a, s) => ({
        revenue: a.revenue + s.revenue,
        actual: a.actual + s.actual,
        profit: a.profit + s.profitActual,
        unpaid: a.unpaid + s.unpaid,
        overdue: a.overdue + s.overdue,
        count: a.count + 1,
      }),
      { revenue: 0, actual: 0, profit: 0, unpaid: 0, overdue: 0, count: 0 },
    );
  }, [projects, transactions]);

  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader
        title="프로젝트 손익"
        description="행사·납품 건마다 계약금액과 지출(물품·식대·인건비 …)을 대조해 실제로 남는 돈을 봅니다."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)} disabled={creating}>
            새 프로젝트
          </Button>
        }
      />

      {creating && (
        <NewProjectForm
          onCancel={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            router.push(`/neander/finance/projects/${id}`);
          }}
        />
      )}

      {projects.length > 0 && (
        <>
          <KpiStrip columns={4} className="mb-4">
            <StatTile label="수입 합계" value={head.revenue} hint={`취소 제외 ${head.count}건 · 공급가액(부가세 제외)`} />
            <StatTile label="실제 원가 합계" value={head.actual} hint="실제금액 없는 줄은 견적으로" />
            <StatTile
              label="실질 이익 합계"
              value={head.profit}
              hint={head.revenue > 0 ? `이익률 ${formatMargin(head.profit / head.revenue)}` : undefined}
            />
            <StatTile
              label="미수금 합계"
              value={head.unpaid}
              tone={head.overdue > 0 ? "danger" : undefined}
              hint={head.overdue > 0 ? `연체 ${head.overdue.toLocaleString("ko-KR")}원 포함` : "아직 안 들어온 돈"}
            />
          </KpiStrip>

          {/* 상태별 건수 — 누르면 그 상태만 본다 */}
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-nd-caption font-medium text-nd-fg-2">상태별</span>
            {PROJECT_STATUSES.map((st) => {
              const n = projects.filter((p) => p.status === st).length;
              if (n === 0) return null;
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(active ? "all" : st)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-nd-caption font-medium transition-colors duration-nd-fast",
                    active
                      ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                      : "border-nd-border text-nd-fg-2 hover:bg-nd-fg/[.06]",
                  )}
                >
                  {PROJECT_STATUS_LABEL[st]}
                  <span className="nd-num text-nd-fg-3">{n}</span>
                </button>
              );
            })}
            {statusFilter !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => setStatusFilter("all")}>
                전체 보기
              </Button>
            )}
          </div>
        </>
      )}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="아직 프로젝트가 없습니다"
          description="「새 프로젝트」로 이름·코드·계약금액을 넣고 지출을 채우세요. 코드는 원장의 프로젝트코드와 같은 값을 씁니다."
          action={
            <Button icon={Plus} onClick={() => setCreating(true)} disabled={creating}>
              새 프로젝트
            </Button>
          }
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table minWidth={960}>
              <thead>
                <tr>
                  <Th className="pl-5">프로젝트</Th>
                  <Th>상태</Th>
                  <Th>기간</Th>
                  <Th align="right" title="공급가액 기준 — 부가세를 뺀 값입니다">
                    수입
                  </Th>
                  <Th align="right">견적 원가</Th>
                  <Th align="right">실제 원가</Th>
                  <Th align="right">실질 이익</Th>
                  <Th align="right">이익률</Th>
                  <Th align="right" title="청구 총액에서 아직 안 들어온 돈 (부가세 포함)">
                    미수금
                  </Th>
                  <Th align="right" title="원장에 같은 프로젝트코드가 찍힌 지출 합계 (참고)">
                    원장 지출
                  </Th>
                  <Th align="right">준비</Th>
                  <Th align="right" className="pr-5" title="견적서 · 계약서 수">
                    문서
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, s }) => (
                  // 행 전체가 상세로 간다 — 이름 글자만 링크면 숫자를 눌러본
                  // 사람이 아무 반응 없는 표를 보게 된다. 이름은 진짜 <a> 로
                  // 남겨 둬 새 탭 열기(⌘·Ctrl 클릭)도 그대로 된다.
                  <Tr
                    key={p.id}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a")) return;
                      router.push(`/neander/finance/projects/${p.id}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(`/neander/finance/projects/${p.id}`);
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`${p.name} 상세`}
                    className="cursor-pointer focus:bg-nd-accent-soft/60 focus:outline-none"
                  >
                    <Td className="pl-5">
                      <Link
                        href={`/neander/finance/projects/${p.id}`}
                        className="block max-w-[24rem] truncate font-medium text-nd-fg hover:text-nd-accent-strong"
                        title={p.name}
                      >
                        {p.name}
                      </Link>
                      <div className="truncate text-nd-caption text-nd-fg-3" title={[p.code, p.client].filter(Boolean).join(" · ")}>
                        <span className="font-mono">{p.code}</span>
                        {p.client && <span> · {p.client}</span>}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={PROJECT_STATUS_TONE[p.status]} dot>
                        {PROJECT_STATUS_LABEL[p.status]}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-nd-caption text-nd-fg-2">
                      {p.startDate ?? "—"}
                      {p.endDate && p.endDate !== p.startDate ? ` ~ ${p.endDate}` : ""}
                    </Td>
                    <Td num><Money value={s.revenue} unit={false} /></Td>
                    <Td num><Money value={s.estimate} unit={false} muted /></Td>
                    <Td num><Money value={s.actual} unit={false} /></Td>
                    <Td num className="font-medium"><Money value={s.profitActual} unit={false} /></Td>
                    <Td num className={s.marginActual !== null && s.marginActual < 0 ? "text-nd-danger-text" : "text-nd-fg-2"}>
                      {formatMargin(s.marginActual)}
                    </Td>
                    <Td num>
                      {s.unpaid === 0 ? (
                        <span className="text-nd-fg-4">—</span>
                      ) : (
                        <span className={s.overdue > 0 ? "font-medium text-nd-danger-text" : undefined}>
                          <Money value={s.unpaid} unit={false} className={s.overdue > 0 ? "text-nd-danger-text" : undefined} />
                          {s.overdue > 0 && <span className="ml-1 text-nd-micro">연체</span>}
                        </span>
                      )}
                    </Td>
                    <Td num>
                      {s.ledger.count > 0 ? (
                        <Money value={s.ledger.expense - s.ledger.refund} unit={false} muted />
                      ) : (
                        <span className="text-nd-fg-4">—</span>
                      )}
                    </Td>
                    <Td num muted className="text-nd-caption">
                      {s.lineCount > 0 ? `${s.doneCount}/${s.lineCount}` : "—"}
                    </Td>
                    <Td num muted className="pr-5 text-nd-caption">
                      {(() => {
                        const q = docs.filter((d) => d.projectId === p.id && d.kind === "quote").length;
                        const c = docs.filter((d) => d.projectId === p.id && d.kind === "contract").length;
                        return q + c === 0 ? "—" : `견 ${q} · 계 ${c}`;
                      })()}
                    </Td>
                  </Tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-nd-body text-nd-fg-3">
                      이 상태의 프로젝트가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableScroll>
          <div className="border-t border-nd-line px-5 py-2">
            <TableNote>단위: 원 · 수입은 공급가액, 미수금은 부가세 포함</TableNote>
          </div>
        </Card>
      )}
    </div>
  );
}

/** 새 프로젝트 — 이름·코드·계약금액만 받고 나머지는 상세에서 채운다 */
function NewProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const { transactions, projects } = useFinance();
  const [form, setForm] = useState<FinProjectInput>(emptyProject());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 원장에 이미 찍혀 있는데 프로젝트로 안 만들어진 코드 — 고르면 바로 이어진다
  const orphanCodes = useMemo(() => {
    const have = new Set(projects.map((p) => p.code.toLowerCase()));
    const counts = new Map<string, number>();
    transactions.forEach((t) => {
      const c = (t.projectCode ?? "").trim();
      if (!c || have.has(c.toLowerCase())) return;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [transactions, projects]);

  const set = <K extends keyof FinProjectInput>(k: K, v: FinProjectInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await saveFinProject(form);
      await onCreated(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
      setSaving(false);
    }
  };

  return (
    <Card className="mb-5 border border-nd-accent/40">
      <SectionTitle hint="이름·코드·계약금액만 넣으면 됩니다. 지출은 다음 화면에서.">새 프로젝트</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="이름" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="2026 JIMFF 행사" autoFocus />
        </Field>
        <Field label="코드" required hint="원장 프로젝트코드와 같은 값">
          <Input
            value={form.code}
            onChange={(e) => set("code", e.target.value.trim())}
            placeholder="JIMFF"
            list="orphan-project-codes"
            className="font-mono"
          />
          <datalist id="orphan-project-codes">
            {orphanCodes.map(([c, n]) => (
              <option key={c} value={c}>{`원장 ${n}건`}</option>
            ))}
          </datalist>
        </Field>
        <Field label="발주처 · 주최">
          <Input value={form.client ?? ""} onChange={(e) => set("client", e.target.value || undefined)} />
        </Field>
        <Field label="계약금액">
          <Input
            type="number"
            inputMode="numeric"
            value={form.contractAmount || ""}
            onChange={(e) => set("contractAmount", Number(e.target.value) || 0)}
            className="nd-num text-right"
            placeholder="0"
          />
        </Field>
        <Field label="상태">
          <Select value={form.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((st) => (
              <option key={st} value={st}>{PROJECT_STATUS_LABEL[st]}</option>
            ))}
          </Select>
        </Field>
        <Field label="시작일">
          <Input type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || undefined)} />
        </Field>
        <Field label="종료일">
          <Input type="date" value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || undefined)} />
        </Field>
      </div>
      {error && (
        <InlineNotice tone="danger" className="mt-3">
          {error}
        </InlineNotice>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>취소</Button>
        <Button onClick={submit} loading={saving} disabled={!form.name.trim() || !form.code.trim()}>
          만들고 지출 입력으로
        </Button>
      </div>
    </Card>
  );
}
