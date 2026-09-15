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
//
//  화면 구성은 승인 목업(all-pages/finance-projects.png)을 따른다:
//  제목 줄 → 상태 탭 → 검색 → 핵심 지표 → 표 → 쪽 넘김.
//  「새 프로젝트」는 Dialog 다 — 인라인 카드로 열면 그 아래 지표와 표가
//  통째로 밀려서, 폼을 쓰는 동안 방금 보던 숫자를 잃는다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  Plus,
  SearchX,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  FilterField,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  Pagination,
  SearchInput,
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
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
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
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // 검색은 이미 받아온 목록 안에서만 한다 — 프로젝트는 많아야 수백 건이라
  // 서버를 한 번 더 부를 이유가 없고, 글자를 칠 때마다 표가 즉시 좁혀진다.
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sortProjects(projects)
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => !s || [p.name, p.code, p.client ?? ""].join(" ").toLowerCase().includes(s))
      .map((p) => ({ p, s: projectSummary(p, transactions) }));
  }, [projects, transactions, statusFilter, q]);

  // 쪽을 넘긴 채로 조건을 바꾸면 빈 쪽이 보인다 — 조건이 바뀌면 첫 쪽으로
  const resetPage = () => setPage(1);
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
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

  // 탭은 「전체 + 실제로 있는 상태」만 — 0건짜리 탭은 누를 곳만 늘린다
  const statusTabs = useMemo(() => {
    const counted = PROJECT_STATUSES.map((st) => ({
      st,
      n: projects.filter((p) => p.status === st).length,
    })).filter((x) => x.n > 0);
    return [
      { key: "all", label: "전체", hint: projects.length.toLocaleString("ko-KR") },
      ...counted.map((x) => ({
        key: x.st,
        label: PROJECT_STATUS_LABEL[x.st],
        hint: x.n.toLocaleString("ko-KR"),
      })),
    ];
  }, [projects]);

  if (loading) return <LoadingState />;

  return (
    <PageShell width="wide">
      <PageHeader
        title="프로젝트 손익"
        description="행사·납품 건마다 계약금액과 지출(물품·식대·인건비 …)을 대조해 실제로 남는 돈을 봅니다."
        className="mb-4"
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)} disabled={creating}>
            새 프로젝트
          </Button>
        }
      />

      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            router.push(`/neander/finance/projects/${id}`);
          }}
        />
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
        <>
          {/* 상태는 「다른 목록을 본다」라 탭 — 건수가 붙어 어디에 몇 건인지 먼저 보인다 */}
          <Tabs
            className="mb-3"
            ariaLabel="프로젝트 상태"
            value={statusFilter}
            onChange={(k) => {
              setStatusFilter(k as ProjectStatus | "all");
              resetPage();
            }}
            items={statusTabs}
          />

          <FilterBar className="mb-4">
            <FilterField label="검색" htmlFor="proj-q">
              <SearchInput
                id="proj-q"
                className="w-64"
                value={q}
                onValueChange={(v) => {
                  setQ(v);
                  resetPage();
                }}
                placeholder="프로젝트명 · 코드 · 거래처"
                ariaLabel="프로젝트 검색"
              />
            </FilterField>
          </FilterBar>

          <KpiStrip columns={4} className="mb-4">
            <StatTile label="수입 합계" value={head.revenue} flow="income" hint={`취소 제외 ${head.count}건 · 공급가액(부가세 제외)`} />
            <StatTile label="실제 원가 합계" value={head.actual} flow="expense" hint="실제금액 없는 줄은 견적으로" />
            <StatTile
              label="실질 이익 합계"
              value={head.profit}
              flow="net"
              hint={head.revenue > 0 ? `이익률 ${formatMargin(head.profit / head.revenue)}` : undefined}
            />
            <StatTile
              label="미수금 합계"
              value={head.unpaid}
              tone={head.overdue > 0 ? "danger" : undefined}
              hint={head.overdue > 0 ? `연체 ${head.overdue.toLocaleString("ko-KR")}원 포함` : "아직 안 들어온 돈"}
            />
          </KpiStrip>

          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="프로젝트 목록"
                hint={`${rows.length.toLocaleString("ko-KR")}건`}
                action={<TableNote>단위: 원 · 수입은 공급가액, 미수금은 부가세 포함</TableNote>}
              />
            </div>

            {rows.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState
                  compact
                  icon={SearchX}
                  title="조건에 맞는 프로젝트가 없습니다"
                  description="상태 탭을 「전체」로 되돌리거나 검색어를 지워 보세요."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setStatusFilter("all");
                        setQ("");
                        resetPage();
                      }}
                    >
                      조건 지우기
                    </Button>
                  }
                />
              </div>
            ) : (
              // 12열이라 좁은 화면에서는 반드시 가로로 밀린다. 프로젝트명 열을
              // 고정해 두지 않으면 오른쪽 숫자를 볼 때 「어느 프로젝트의 값인지」를
              // 잃는다. 가로 스크롤은 TableScroll 안에서만 일어난다.
              <TableScroll>
                <Table minWidth={1120}>
                  <thead>
                    <tr>
                      <Th sticky="left" className="pl-5">프로젝트</Th>
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
                    {pageRows.map(({ p, s }) => (
                      // 행 전체가 상세로 간다 — 이름 글자만 링크면 숫자를 눌러본
                      // 사람이 아무 반응 없는 표를 보게 된다. 이름은 진짜 <a> 로
                      // 남겨 둬 낭독기가 링크로 읽고 새 탭 열기(⌘·Ctrl 클릭)도 된다.
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
                        <Td sticky="left" className="pl-5">
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
                        <Td num><Money value={s.revenue} unit={false} flow="income" /></Td>
                        <Td num><Money value={s.estimate} unit={false} muted /></Td>
                        <Td num><Money value={s.actual} unit={false} flow="expense" /></Td>
                        <Td num className="font-medium"><Money value={s.profitActual} unit={false} flow="net" /></Td>
                        <Td num className={s.marginActual !== null && s.marginActual < 0 ? "text-nd-expense-text" : "text-nd-fg-2"}>
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
                            // 바깥 검색어 q 와 이름이 겹치지 않게 quote/contract 로 둔다
                            const quote = docs.filter((d) => d.projectId === p.id && d.kind === "quote").length;
                            const contract = docs.filter((d) => d.projectId === p.id && d.kind === "contract").length;
                            return quote + contract === 0 ? "—" : `견 ${quote} · 계 ${contract}`;
                          })()}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}

            <div className="border-t border-nd-line px-5 py-2.5">
              <Pagination
                total={rows.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  resetPage();
                }}
              />
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}

/** 새 프로젝트 — 이름·코드·계약금액만 받고 나머지는 상세에서 채운다 */
function NewProjectDialog({
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
    <Dialog
      open
      onClose={onCancel}
      // 몇 칸 채우다 바깥을 잘못 누르면 입력이 사라진다 — 스크림 닫기는 막는다
      closeOnOverlay={false}
      size="lg"
      title="새 프로젝트"
      description="이름·코드·계약금액만 넣으면 됩니다. 지출은 다음 화면에서."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>취소</Button>
          <Button onClick={submit} loading={saving} disabled={!form.name.trim() || !form.code.trim()}>
            만들고 지출 입력으로
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
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
    </Dialog>
  );
}
