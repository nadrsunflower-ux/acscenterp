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
//
//  열 머리글을 누르면 원장과 같은 정렬·필터 메뉴(ColumnMenu)가 열린다.
//  위의 핵심 지표는 지금 표에 남은 프로젝트(취소 제외)로 다시 센다 —
//  사업체를 「와작홈즈」로 거르면 그 숫자가 곧 와작홈즈의 프로젝트 성과다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FilterX,
  FolderOpen,
  Funnel,
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
  FormRow,
  Icon,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  Money,
  NumberInput,
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
  cn,
  useStickyState,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ColumnMenu } from "@/components/neander/finance/ColumnMenu";
import { AutoCodeBox } from "@/components/neander/finance/AutoCode";
import { saveFinProject } from "@/lib/neander/finance/client";
import { nextCode, saveWithAutoCode, takenCodes } from "@/lib/neander/finance/codes";
import { useGrants } from "@/lib/neander/finance/grant-client";
import {
  ENTITY_SHORT,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  VAT_HINT,
  VAT_LABEL,
  VAT_MODES,
  emptyProject,
  formatMargin,
  projectEntities,
  projectSummary,
  sortProjects,
  splitVat,
  type FinProjectInput,
  type ProjectStatus,
  type VatMode,
} from "@/lib/neander/finance/project";
import {
  activeProjectFilterCount,
  applyProjectFilters,
  isProjectRangeKey,
  projectOptions,
  sortProjectRows,
  type ProjectListFilters,
  type ProjectListKey,
  type ProjectListRow,
  type ProjectListSort,
} from "@/lib/neander/finance/project-list";

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
  const [statusFilter, setStatusFilter] = useStickyState<ProjectStatus | "all">("finance.projects.status", "all");
  const [q, setQ] = useStickyState("finance.projects.q", "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useStickyState("finance.projects.pageSize", 50);
  const [filters, setFilters] = useStickyState<ProjectListFilters>("finance.projects.filters", {});
  const [sort, setSort] = useStickyState<ProjectListSort | null>("finance.projects.sort", null);
  const [menu, setMenu] = useState<{ key: ProjectListKey; label: string; anchor: DOMRect } | null>(null);

  // 검색은 이미 받아온 목록 안에서만 한다 — 프로젝트는 많아야 수백 건이라
  // 서버를 한 번 더 부를 이유가 없고, 글자를 칠 때마다 표가 즉시 좁혀진다.
  // 탭·검색을 먼저 걸고, 열 필터는 그 위에 건다 (드롭다운 후보도 이 안에서).
  const baseRows = useMemo<ProjectListRow[]>(() => {
    const s = q.trim().toLowerCase();
    return sortProjects(projects)
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => !s || [p.name, p.code, p.client ?? ""].join(" ").toLowerCase().includes(s))
      .map((p) => ({
        p,
        s: projectSummary(p, transactions),
        quotes: docs.filter((d) => d.projectId === p.id && d.kind === "quote").length,
        contracts: docs.filter((d) => d.projectId === p.id && d.kind === "contract").length,
        entities: projectEntities(p, transactions).entities,
      }));
  }, [projects, transactions, docs, statusFilter, q]);
  const rows = useMemo(
    () => sortProjectRows(applyProjectFilters(baseRows, filters), sort),
    [baseRows, filters, sort],
  );
  const filterCount = activeProjectFilterCount(filters);

  // 쪽을 넘긴 채로 조건을 바꾸면 빈 쪽이 보인다 — 조건이 바뀌면 첫 쪽으로
  const resetPage = () => setPage(1);
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  // 머리 숫자는 지금 표에 남은 프로젝트 중 취소를 뺀 것 — 취소된 계약금액이
  // 합계에 섞이면 안 된다. 탭·검색·열 필터를 따라가야 거른 묶음의 성과가 된다.
  const head = useMemo(() => {
    const live = rows.filter((r) => r.p.status !== "cancelled").map((r) => r.s);
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
  }, [rows]);

  const clearAll = () => {
    setStatusFilter("all");
    setQ("");
    setFilters({});
    setSort(null);
    resetPage();
  };

  /** 열 머리글 — 누르면 정렬·필터 메뉴. 걸려 있으면 깔때기·화살표로 알린다 */
  const columnHead = (key: ProjectListKey, label: string, opts: { align?: "right"; title?: string; sticky?: "left"; className?: string } = {}) => {
    const filtered = !!filters[key];
    const dir = sort?.key === key ? sort.dir : null;
    return (
      <Th
        align={opts.align}
        sticky={opts.sticky}
        className={opts.className}
        title={opts.title}
        aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}
      >
        <button
          type="button"
          onClick={(e) => setMenu({ key, label, anchor: e.currentTarget.getBoundingClientRect() })}
          aria-label={`${label} 정렬·필터${filtered ? " (걸러짐)" : ""}`}
          aria-haspopup="dialog"
          className={cn(
            "group inline-flex items-center gap-1 rounded-[4px] outline-none transition-colors duration-nd-fast hover:text-nd-fg focus-visible:ring-2 focus-visible:ring-nd-accent/50",
            // 숫자 열은 글자 끝을 숫자 끝에 맞추려고 표시를 왼쪽에 둔다
            opts.align === "right" && "flex-row-reverse",
            (filtered || dir) && "text-nd-accent-strong",
          )}
        >
          <span>{label}</span>
          {dir && <Icon icon={dir === "asc" ? ArrowUp : ArrowDown} size={12} />}
          {filtered ? (
            <Icon icon={Funnel} size={12} className="fill-current" />
          ) : (
            !dir && <Icon icon={ChevronDown} size={12} className="opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
          )}
        </button>
      </Th>
    );
  };

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
            {(filterCount > 0 || sort) && (
              <Button
                variant="ghost"
                size="sm"
                icon={FilterX}
                onClick={() => {
                  setFilters({});
                  setSort(null);
                  resetPage();
                }}
              >
                {[filterCount > 0 && `열 필터 ${filterCount}개`, sort && "정렬"].filter(Boolean).join(" · ")} 해제
              </Button>
            )}
          </FilterBar>

          <KpiStrip columns={4} className="mb-4">
            <StatTile
              label="수입 합계"
              value={head.revenue}
              flow="income"
              hint={`${rows.length < projects.length ? "표에 남은 " : ""}취소 제외 ${head.count}건 · 공급가액(부가세 제외)`}
            />
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
                  description="상태 탭을 「전체」로 되돌리거나 검색어·열 필터를 지워 보세요."
                  action={
                    <Button variant="secondary" size="sm" onClick={clearAll}>
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
                <Table minWidth={1220}>
                  <thead>
                    <tr>
                      {columnHead("name", "프로젝트", { sticky: "left", className: "pl-5" })}
                      {columnHead("status", "상태")}
                      {columnHead("entity", "사업체", { title: "매출을 낸 사업체 — 흐린 글자는 고르지 않아 원장 입금 사업장으로 추정한 것" })}
                      {columnHead("period", "기간")}
                      {columnHead("revenue", "수입", { align: "right", title: "공급가액 기준 — 부가세를 뺀 값입니다" })}
                      {columnHead("estimate", "견적 원가", { align: "right" })}
                      {columnHead("actual", "실제 원가", { align: "right" })}
                      {columnHead("profit", "실질 이익", { align: "right" })}
                      {columnHead("margin", "이익률", { align: "right" })}
                      {columnHead("unpaid", "미수금", { align: "right", title: "청구 총액에서 아직 안 들어온 돈 (부가세 포함)" })}
                      {columnHead("ledger", "원장 지출", { align: "right", title: "원장에 같은 프로젝트코드가 찍힌 지출 합계 (참고)" })}
                      {columnHead("ready", "준비", { align: "right" })}
                      {columnHead("docs", "문서", { align: "right", className: "pr-5", title: "견적서 · 계약서 수" })}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ p, s, quotes, contracts }) => (
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
                        <Td className="whitespace-nowrap">
                          <EntityCell entities={projectEntities(p, transactions)} />
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
                          {quotes + contracts === 0 ? "—" : `견 ${quotes} · 계 ${contracts}`}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}

            {menu && (
              <ColumnMenu
                columnKey={`p-${menu.key}`}
                range={isProjectRangeKey(menu.key)}
                rangeLabel={menu.key === "margin" ? "이익률(%)" : "금액"}
                label={menu.label}
                anchor={menu.anchor}
                sortDir={sort?.key === menu.key ? sort.dir : null}
                onSort={(dir) => {
                  setSort(dir === null ? null : { key: menu.key, dir });
                  resetPage();
                }}
                filter={filters[menu.key]}
                // 후보는 다른 열 필터를 통과한 줄에서 — 고를 값이 사라지지 않게
                options={isProjectRangeKey(menu.key) ? [] : projectOptions(applyProjectFilters(baseRows, filters, menu.key), menu.key)}
                onFilterChange={(next) => {
                  setFilters((f) => {
                    const copy = { ...f };
                    if (next === null) delete copy[menu.key];
                    else copy[menu.key] = next;
                    return copy;
                  });
                  resetPage();
                }}
                onClose={() => setMenu(null)}
              />
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

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * 사업체 칸. 고른 값은 배지로, 고르지 않아 원장 입금으로 추정한 값은 흐린
 * 글자로 — 둘이 같아 보이면 확정된 값인지 알 수 없다.
 */
function EntityCell({ entities: e }: { entities: ReturnType<typeof projectEntities> }) {
  if (e.source === "none") return <span className="text-nd-fg-4">—</span>;
  if (e.source === "ledger") {
    return (
      <span className="text-nd-caption text-nd-fg-3" title="고르지 않아 원장 입금의 사업장으로 추정했습니다 — 상세 화면에서 고르면 확정됩니다">
        {e.entities.map((x) => ENTITY_SHORT[x]).join(" · ")}
      </span>
    );
  }
  return (
    <span className="flex gap-1">
      {e.entities.map((x) => (
        <Badge key={x} size="sm">{ENTITY_SHORT[x]}</Badge>
      ))}
    </span>
  );
}

/** 계약금액 칸 아래 줄 — 적은 금액을 기준대로 풀어 「받을 돈」 까지 보여 준다 */
function contractHint(amount: number, mode: VatMode): string {
  if (!amount) return VAT_HINT[mode];
  const s = splitVat(amount, mode);
  if (mode === "exempt") return `면세 — 받을 돈 ${won(s.total)}`;
  if (mode === "included") return `받을 돈 ${won(s.total)} = 공급가액 ${won(s.supply)} + 부가세 ${won(s.vat)}`;
  return `공급가액 ${won(s.supply)} + 부가세 ${won(s.vat)} = 받을 돈 ${won(s.total)}`;
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
  const { grants } = useGrants();
  const [form, setForm] = useState<FinProjectInput>(emptyProject());
  /** 원장에만 있는 코드에 이을 때 고른 코드 — 비어 있으면 새 코드를 저절로 붙인다 */
  const [linkCode, setLinkCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 원장에 이미 찍혀 있는데 프로젝트로 안 만들어진 코드 — 고르면 바로 이어진다
  const orphanCodes = useMemo(() => {
    // 지원사업 코드도 원장 프로젝트코드 칸을 같이 쓴다 — 그건 고아가 아니다
    const have = takenCodes(projects.map((p) => p.code), grants.map((g) => g.code));
    const counts = new Map<string, number>();
    transactions.forEach((t) => {
      const c = (t.projectCode ?? "").trim();
      if (!c || have.has(c.toLowerCase())) return;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [transactions, projects, grants]);

  // 새 코드 — 시작일의 연월 + 순번 (codes.ts). 원장 · 지원사업에 있는 코드는 피한다
  const taken = useMemo(
    () => takenCodes(projects.map((p) => p.code), grants.map((g) => g.code), transactions.map((t) => t.projectCode)),
    [projects, grants, transactions],
  );
  const autoCode = nextCode("project", taken, form.startDate);

  const set = <K extends keyof FinProjectInput>(k: K, v: FinProjectInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = linkCode
        ? await saveFinProject({ ...form, code: linkCode })
        : (await saveWithAutoCode("project", taken, form.startDate, (code) => saveFinProject({ ...form, code }))).result;
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
      description="이름과 계약금액만 넣으면 됩니다. 코드는 저절로 붙고, 지출은 다음 화면에서."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>취소</Button>
          <Button onClick={submit} loading={saving} disabled={!form.name.trim()}>
            만들고 지출 입력으로
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="이름" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="2026 JIMFF 행사" autoFocus />
        </Field>
        {/* 코드는 저절로 붙는다. 원장에 이미 찍혀 있는데 프로젝트가 없는 코드가 있으면
            그 코드에 이을 수만 있다 — 고르면 그 거래들이 바로 이 프로젝트로 이어진다 */}
        {orphanCodes.length > 0 ? (
          <Field
            label="코드"
            hint={linkCode ? "원장에 이미 찍힌 거래가 이 프로젝트로 이어집니다" : "자동 — 시작일의 연월 + 순번. 원장 프로젝트코드로 씁니다"}
          >
            <Select value={linkCode} onChange={(e) => setLinkCode(e.target.value)} className="font-mono">
              <option value="">{`${autoCode} (새 코드 · 자동)`}</option>
              {orphanCodes.map(([c, n]) => (
                <option key={c} value={c}>{`${c} — 원장 ${n}건에 잇기`}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="코드" hint="자동 — 시작일의 연월 + 순번. 원장 프로젝트코드로 씁니다">
            <AutoCodeBox code={autoCode} />
          </Field>
        )}
        <Field label="발주처 · 주최">
          <Input value={form.client ?? ""} onChange={(e) => set("client", e.target.value || undefined)} />
        </Field>
        {/* 계약금액만 덩그러니 있으면 공급가액인지 부가세 포함인지 알 수 없다 —
            기준을 옆에서 고르게 하고, 아래 줄에 공급가액·부가세·받을 돈을 바로 푼다 */}
        <FormRow className="grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)]">
          <Field label="계약금액" hint={contractHint(form.contractAmount, form.vatMode ?? "excluded")}>
            <NumberInput
              value={form.contractAmount || ""}
              onValueChange={(v) => set("contractAmount", Number(v) || 0)}
              className="text-right"
              placeholder="0"
            />
          </Field>
          <Field label="부가세">
            <Select value={form.vatMode ?? "excluded"} onChange={(e) => set("vatMode", e.target.value as VatMode)}>
              {VAT_MODES.map((m) => (
                <option key={m} value={m}>{VAT_LABEL[m]}</option>
              ))}
            </Select>
          </Field>
        </FormRow>
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
