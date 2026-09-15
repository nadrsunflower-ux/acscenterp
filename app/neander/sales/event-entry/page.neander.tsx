"use client";

// ============================================================
//  매출 › 이벤트 입력 — 「입력_이벤트마스터 · 입력_이벤트준비물 · 방문자통계」
//  세 시트를 한 화면에서 적는다
// ------------------------------------------------------------
//  엑셀은 이벤트 하나를 세 시트에 나눠 적었다 — 마스터에 기간·스태프,
//  준비물 시트에 품목 줄, 방문자통계에 하루치 구매/미구매. 같은 행사를
//  세 번 찾아다니다 보면 하나가 빠진다 (7/18 원우 방문자 기록이 그랬다).
//  여기서는 왼쪽에서 행사를 고르면 오른쪽에 셋이 한 벌로 뜬다.
//
//  저장하면 서버가 그 기간의 판매 줄을 이 이벤트에 다시 붙이고, 미확정
//  줄을 행사 전용 상품으로 다시 해석한다 (server/attach.ts). 파일을 먼저
//  올리고 이벤트를 나중에 적어도 숫자가 맞는 이유다.
//
//  이 달 실적(매출·공헌이익·전환율)은 읽기 전용으로 아래에 붙인다 —
//  입력하면서 바로 "이 행사가 얼마 남겼나"를 보라고.
//
//  ⚠️ 배치를 승인 목업(all-pages/sales-events.png)에 맞췄다.
//     · 2단을 공통 MasterDetail 로 — 예전 xl 그리드는 1024px 에서 두 판이
//       서로를 눌러 입력칸이 찌그러졌다. 지금은 좁으면 목록↔편집기가 한
//       판씩 바뀐다.
//     · 편집기 안은 **탭**(기본정보·준비물·방문자·실적)이다. Card 4장을
//       세로로 쌓으면 실적을 보려고 준비물 표를 통째로 지나가야 했다.
//     · 미저장 경고를 편집기 맨 위 띠로 올렸다. 버리기 확인(useConfirm)은
//       그대로 두되, 묻기 전에 눈에 보이는 것이 먼저다.
// ============================================================

import {
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChartNoAxesColumn,
  Plus,
  ShoppingBag,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  Field,
  FieldAction,
  FilterBar,
  FilterField,
  FormRow,
  IconButton,
  InfoPopover,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  MasterDetail,
  Menu,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  TotalRow,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useSales } from "@/components/neander/sales/SalesProvider";
import {
  Rate,
  SalesDrill,
  StoreBadge,
} from "@/components/neander/sales/ui";
import { TermLabel } from "@/components/neander/sales/TermHint";
import {
  availableMonths,
  buildEventPerf,
  inMonth,
  type EventPerf,
} from "@/lib/neander/sales/aggregate";
import {
  deleteSalesEvent,
  upsertSalesEvent,
} from "@/lib/neander/sales/client";
import {
  monthOfBatch,
  selectableMonths,
  workingMonth,
} from "@/lib/neander/sales/import-slots";
import {
  SALES_STORES,
  conversionRate,
  eventDates,
  eventDays,
  eventLabor,
  nextEventCode,
  normalizeEvent,
  pct,
  supplyAmount,
  suppliesTotal,
  visitTotals,
  type SalesEvent,
  type SalesEventVisit,
  type SalesStore,
  type SalesSupplyItem,
} from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const digits = (v: string) => v.replace(/[^\d]/g, "");
const STORE_ORDER: SalesStore[] = ["wow", "id", "online"];

/** 편집기 탭 — 기본정보 · 준비물 · 방문자 · 실적 */
type TabKey = "basic" | "supplies" | "visits" | "perf";

/** 편집 중인 사본 — 새 이벤트인지 함께 들고 다닌다 */
interface Draft extends SalesEvent {
  isNew: boolean;
}

function toDraft(e: SalesEvent): Draft {
  return {
    ...e,
    supplyItems: (e.supplyItems ?? []).map((i) => ({ ...i })),
    visits: (e.visits ?? []).map((v) => ({ ...v })),
    isNew: false,
  };
}

/** 저장 대상으로 — 화면 전용 필드를 떼고 정규화 */
function fromDraft(d: Draft): SalesEvent {
  const { isNew: _isNew, ...rest } = d;
  return normalizeEvent(rest);
}

export default function EventEntryPage() {
  const { lines, products, events, assumptions, imports, loading, masterEmpty, error, refresh, labor } =
    useSales();
  const toast = useToast();
  const confirm = useConfirm();

  const months = useMemo(
    () =>
      selectableMonths([
        ...availableMonths(lines, events),
        ...imports.map((b) => monthOfBatch(b)).filter((m): m is string => !!m),
      ]),
    [lines, events, imports],
  );
  const [month, setMonth] = useState("");
  const activeMonth = month || workingMonth(imports);

  const monthEvents = useMemo(
    () =>
      events
        .filter((e) => e.from?.startsWith(activeMonth))
        .sort(
          (a, b) =>
            STORE_ORDER.indexOf(a.store) - STORE_ORDER.indexOf(b.store) || a.from.localeCompare(b.from),
        ),
    [events, activeMonth],
  );
  /**
   * 매장 거르기 — **화면에서만** 거른다. 집계(buildEventPerf)는 늘 그 달
   * 전체를 받는다. 목록에서 와우만 보고 있다고 아이디 실적이 사라지면
   * 안 되기 때문이다.
   */
  /** 목록 머리의 「새 이벤트」 — 누르면 어느 매장인지 고른다 */
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [storeFilter, setStoreFilter] = useState<SalesStore | "all">("all");
  const listEvents = useMemo(
    () => monthEvents.filter((e) => storeFilter === "all" || e.store === storeFilter),
    [monthEvents, storeFilter],
  );

  const perfById = useMemo(() => {
    const m = new Map<string, EventPerf>();
    // 대시보드와 같은 인건비(근무 일지 실측 · 없으면 가정값) — 두 화면 숫자가 갈라지지 않게
    buildEventPerf(activeMonth, lines, products, events, assumptions, { actuals: labor }).forEach((p) =>
      m.set(p.event.id, p),
    );
    return m;
  }, [activeMonth, lines, products, events, assumptions, labor]);

  /** 최근 쓴 준비물 — 이름별 마지막 단가·구분. 빠른 추가 칩의 재료 */
  const recentSupplies = useMemo(() => {
    const m = new Map<string, { name: string; unitPrice: number; category?: string; uses: number }>();
    [...events]
      .sort((a, b) => a.from.localeCompare(b.from))
      .forEach((e) =>
        (e.supplyItems ?? []).forEach((i) => {
          const cur = m.get(i.name);
          m.set(i.name, { name: i.name, unitPrice: i.unitPrice, category: i.category, uses: (cur?.uses ?? 0) + 1 });
        }),
      );
    return [...m.values()].sort((a, b) => b.uses - a.uses).slice(0, 14);
  }, [events]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const original = useMemo(
    () => (draft && !draft.isNew ? events.find((e) => e.id === draft.id) : undefined),
    [draft, events],
  );
  const dirty =
    !!draft && (draft.isNew || JSON.stringify(fromDraft(draft)) !== JSON.stringify(original ? normalizeEvent(original) : null));

  // 달을 바꾸면 편집 중이던 것은 닫는다 (다른 달 행사를 이 달 목록 옆에 두지 않는다)
  useEffect(() => {
    setDraft(null);
  }, [activeMonth]);

  /** 편집 중인 것을 버려도 되는지 — 더럽혀졌을 때만 묻는다 */
  async function discardOk(): Promise<boolean> {
    if (!dirty || !draft) return true;
    return confirm({
      title: "저장하지 않은 변경이 있습니다",
      message: `「${draft.name || draft.id}」에 적던 내용을 버리고 넘어갈까요?`,
      confirmLabel: "버리기",
      tone: "danger",
    });
  }

  async function select(e: SalesEvent) {
    if (!(await discardOk())) return;
    setDraft(toDraft(e));
  }

  async function startNew(store: SalesStore = "wow") {
    if (!(await discardOk())) return;
    const first = `${activeMonth}-01`;
    setDraft({
      id: nextEventCode(store, events),
      store,
      name: "",
      from: first,
      to: first,
      hoursPerDay: store === "wow" ? assumptions.wowOps.hoursPerDay : 0,
      staff: store === "wow" ? 1 : 0,
      supplies: 0,
      supplyItems: [],
      visits: [],
      isNew: true,
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.id.trim() || !draft.name.trim() || !draft.from || !draft.to) {
      toast.error("코드 · 이벤트명 · 기간은 필수입니다.");
      return;
    }
    if (draft.to < draft.from) {
      toast.error("종료일이 시작일보다 앞섭니다.");
      return;
    }
    if (draft.isNew && events.some((e) => e.id === draft.id.trim())) {
      toast.error(`${draft.id} 코드는 이미 있습니다.`);
      return;
    }
    setSaving(true);
    try {
      const res = await upsertSalesEvent(fromDraft(draft));
      const bits = [
        res.lines.attached > 0 ? `판매 ${won(res.lines.attached)}줄 귀속` : null,
        res.lines.detached > 0 ? `${won(res.lines.detached)}줄 해제` : null,
        res.lines.resolved > 0 ? `${won(res.lines.resolved)}줄 상품 확정` : null,
      ].filter(Boolean);
      toast.success(`${draft.name} 저장${bits.length ? ` · ${bits.join(" · ")}` : ""}`);
      await refresh();
      setDraft((d) => (d ? { ...d, isNew: false } : d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft || draft.isNew) {
      setDraft(null);
      return;
    }
    if (
      !(await confirm({
        title: `「${draft.name}」 이벤트를 삭제할까요?`,
        message: "이 이벤트에 귀속된 판매 줄은 지우지 않고 상시로 돌립니다. 준비물·방문자 기록은 사라집니다.",
        confirmLabel: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      const res = await deleteSalesEvent(draft.id);
      toast.success(
        res.detached > 0 ? `삭제했습니다. 판매 ${won(res.detached)}줄이 상시로 돌아갔습니다.` : "삭제했습니다.",
      );
      setDraft(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    }
  }

  if (loading) return <LoadingState label="이벤트를 불러오는 중…" />;

  // 불러오지 못한 것과 아직 없는 것은 다르다 — 예전에는 둘 다 「이 달 이벤트가 없습니다」로 보였다
  if (error) {
    return (
      <PageShell width="wide">
        <PageHeader title="이벤트 입력" description="이벤트명 · 코드 · 일정 · 준비물 · 방문자" />
        <ErrorState
          title="이벤트를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  const sumSupplies = listEvents.reduce((s, e) => s + suppliesTotal(e), 0);
  const sumDays = listEvents.reduce((s, e) => s + eventDays(e), 0);

  return (
    <PageShell width="wide">
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="이벤트 입력"
        description="이벤트명 · 코드 · 일정 · 준비물 · 방문자를 한 곳에서 적습니다. 저장하면 그 기간의 판매가 이 행사에 붙습니다."
        className="mb-3"
        meta={
          <span className="text-nd-caption text-nd-fg-2">
            {monthLabel(activeMonth)} {monthEvents.length}건
          </span>
        }
      />

      {/* 기준 한 줄 + ⓘ — 예전에는 이 설명이 화면 위 InlineNotice 한 장을 차지했다 */}
      <BasisLine
        className="mb-4"
        items={["판매의 이벤트 귀속은 날짜로 정해집니다", "준비물 합계·전환율은 줄에서 자동 계산"]}
      >
        <InfoPopover
          label="귀속 규칙"
          title="저장하면 무엇이 달라지나"
          terms={[
            {
              term: "기간",
              desc: "기간을 넣고 저장하면 그 매장의 그 기간 판매가 자동으로 이 이벤트에 붙습니다. 파일을 먼저 올리고 이벤트를 나중에 적어도 숫자가 맞는 이유입니다.",
            },
            {
              term: "전용 상품",
              desc: "행사 전용 상품이 있으면 미확정 줄을 그 상품으로 다시 해석합니다.",
            },
            {
              term: "준비물",
              desc: "줄을 적으면 합계 칸 대신 줄의 합을 씁니다. 합계는 그 행사의 변동비로 들어갑니다.",
            },
            {
              term: "전환율",
              desc: "구매 ÷ (구매 + 미구매). 하루씩 적으면 며칠째부터 떨어지는지 보입니다 — 와우 팝업만 집계해 왔습니다.",
            },
          ]}
        />
      </BasisLine>

      {/* 상품 마스터가 비어도 이벤트는 적을 수 있다 — 막지 않고 알리기만 한다 */}
      {masterEmpty && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          상품 마스터가 비어 있어 <b>판매 줄이 상품에 붙지 않습니다.</b> 먼저{" "}
          <Link href="/neander/sales/master" className="font-medium underline">
            마스터를 적재
          </Link>
          하세요.
        </InlineNotice>
      )}

      <FilterBar className="mb-3">
        <FilterField label="매장" as="div">
          <SegmentedControl
            size="sm"
            ariaLabel="매장"
            value={storeFilter}
            onChange={(v) => setStoreFilter(v as SalesStore | "all")}
            options={[
              { value: "all", label: "전체" },
              ...SALES_STORES.map((x) => ({ value: x.value, label: x.label })),
            ]}
          />
        </FilterField>
      </FilterBar>

      <MasterDetail
        selected={!!draft}
        onBack={() => void (async () => {
          if (await discardOk()) setDraft(null);
        })()}
        backLabel="이벤트 목록으로"
        listWidth={380}
        list={
          <Card padding="none" className="overflow-hidden">
            <div className="px-4 pt-4">
              <SectionHeader
                className="mb-0"
                title={`${monthLabel(activeMonth)} 이벤트`}
                hint={`${listEvents.length}건 · 운영 ${sumDays}일 · 준비물 ${won(sumSupplies)}원`}
                action={
                  <>
                    {/* 예전에는 헤더에 「새 이벤트」(와우), 여기에 「+ 아이디」 두 개가 있었다.
                        어느 매장 행사가 만들어지는지 버튼만 봐서는 알 수 없었다 —
                        하나로 모으고 누를 때 매장을 고르게 한다. */}
                    <Button
                      ref={newBtnRef}
                      size="sm"
                      icon={Plus}
                      onClick={() => setNewOpen((v) => !v)}
                      aria-haspopup="menu"
                      aria-expanded={newOpen}
                    >
                      새 이벤트
                    </Button>
                    <Menu
                      open={newOpen}
                      onClose={() => setNewOpen(false)}
                      anchorRef={newBtnRef}
                      placement="bottom-end"
                      ariaLabel="어느 매장 행사인가"
                      items={SALES_STORES.map((x) => ({
                        key: x.value,
                        label: `${x.label} 이벤트`,
                        hint: x.hint,
                        onSelect: () => void startNew(x.value),
                      }))}
                    />
                  </>
                }
              />
            </div>
            {listEvents.length === 0 && !draft?.isNew ? (
              <EmptyState
                icon={ShoppingBag}
                title={storeFilter === "all" ? "이 달 이벤트가 없습니다" : "조건에 맞는 이벤트가 없습니다"}
                description={
                  storeFilter === "all"
                    ? "위 「새 이벤트」로 와우 행사를, 「아이디」로 아이디 행사를 추가하세요."
                    : "매장 필터를 「전체」로 바꿔 보세요."
                }
                className="border-0"
              />
            ) : (
              <ul className="nd-scroll max-h-[70vh] overflow-y-auto border-t border-nd-line">
                {draft?.isNew && (
                  <li className="border-b border-nd-line bg-nd-accent-soft/60 px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      <StoreBadge store={draft.store} size="sm" />
                      <span className="text-nd-body font-medium text-nd-fg">{draft.name || "(새 이벤트)"}</span>
                      <Badge tone="accent" size="sm">
                        저장 전
                      </Badge>
                    </span>
                    <span className="nd-num text-nd-micro text-nd-fg-3">{draft.id}</span>
                  </li>
                )}
                {listEvents.map((e) => {
                  const perf = perfById.get(e.id);
                  const conv = conversionRate({ ...e, ...visitTotals(e) } as SalesEvent);
                  const selected = draft?.id === e.id && !draft.isNew;
                  return (
                    <li key={e.id} className="border-b border-nd-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => void select(e)}
                        aria-current={selected || undefined}
                        className={cn(
                          "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-nd-fast hover:bg-nd-fg/[.03]",
                          selected && "bg-nd-accent-soft/60",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <StoreBadge store={e.store} size="sm" />
                          <span className="truncate text-nd-body font-medium text-nd-fg">{e.name}</span>
                        </span>
                        <span className="nd-num flex flex-wrap gap-x-2 text-nd-micro text-nd-fg-3">
                          <span>{e.id}</span>
                          <span>
                            {e.from.slice(5)}~{e.to.slice(5)} · {eventDays(e)}일
                          </span>
                          <span>준비물 {won(suppliesTotal(e))}</span>
                          {conv !== null && <span>전환 {pct(conv, 0)}</span>}
                        </span>
                        {perf && (
                          <span className="nd-num flex flex-wrap gap-x-2 text-nd-micro">
                            <span className="text-nd-fg-2">매출 {won(perf.revenue)}</span>
                            <span className={perf.contribution < 0 ? "text-nd-expense-text" : "text-nd-fg-2"}>
                              공헌 {won(perf.contribution)}
                            </span>
                            {perf.reviewCount > 0 && (
                              <span className="text-nd-warning-text">미확정 {perf.reviewCount}건</span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        }
        detail={
          draft ? (
            <Editor
              draft={draft}
              onChange={setDraft}
              perf={perfById.get(draft.id)}
              month={activeMonth}
              recent={recentSupplies}
              dirty={dirty}
              saving={saving}
              onSave={() => void save()}
              onDelete={() => void remove()}
              onClose={async () => {
                if (await discardOk()) setDraft(null);
              }}
              defaultWage={assumptions.wage.eventStaff}
              laborOf={(d) => eventLabor(fromDraft(d), assumptions)}
            />
          ) : (
            <EmptyState
              icon={CalendarPlus}
              title="이벤트를 고르거나 새로 만드세요"
              description="왼쪽 목록에서 고르면 기간 · 준비물 · 방문자를 여기서 고칩니다. 엑셀 이벤트마스터 · 준비물 · 방문자통계 세 시트가 이 한 장입니다."
              action={
                // 어느 매장 행사가 만들어지는지 버튼에 적는다 — 「새 이벤트」로만
                // 두면 눌러 보고 나서야 와우인 걸 안다 (다른 매장은 왼쪽 목록에서)
                <Button icon={CalendarPlus} onClick={() => void startNew("wow")}>
                  와우 이벤트 만들기
                </Button>
              }
            />
          )
        }
      />
    </PageShell>
  );
}

// ============================================================
//  편집 폼 — 기본 정보 · 준비물 · 방문자 · 이 달 실적
// ============================================================

function Editor({
  draft,
  onChange,
  perf,
  month,
  recent,
  dirty,
  saving,
  onSave,
  onDelete,
  onClose,
  defaultWage,
  laborOf,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  perf?: EventPerf;
  /** perf 를 계산한 달 — 드릴 줄을 buildEventPerf 와 같은 달로 거른다 */
  month: string;
  recent: { name: string; unitPrice: number; category?: string }[];
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
  defaultWage: number;
  laborOf: (d: Draft) => number;
}) {
  /** 편집기 안의 탭 — 화면 상태 하나뿐이고 저장 값과 무관하다 */
  const [tab, setTab] = useState<TabKey>("basic");
  const { lines } = useSales();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const days = eventDays(draft);
  const labor = laborOf(draft);
  const items = draft.supplyItems ?? [];
  const visits = draft.visits ?? [];
  const itemized = items.length > 0;
  const daily = visits.length > 0;
  const total = suppliesTotal(draft);
  const totals = visitTotals(draft);
  const conv = conversionRate({ ...draft, ...totals } as SalesEvent);

  /** 기간을 바꾸면 하루치 방문자 줄을 그 기간에 맞춘다 (있던 값은 지킨다) */
  function setPeriod(from: string, to: string) {
    const patch: Partial<Draft> = { from, to };
    if (daily) {
      const byDate = new Map(visits.map((v) => [v.date, v]));
      patch.visits = eventDates({ from, to }).map(
        (d) => byDate.get(d) ?? { date: d, buyers: 0, nonBuyers: 0 },
      );
    }
    set(patch);
  }

  const setItem = (i: number, patch: Partial<SalesSupplyItem>) =>
    set({ supplyItems: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const addItem = (it?: Partial<SalesSupplyItem>) =>
    set({ supplyItems: [...items, { name: "", qty: 1, unitPrice: 0, ...it }] });
  const removeItem = (i: number) => set({ supplyItems: items.filter((_, k) => k !== i) });

  const setVisit = (i: number, patch: Partial<SalesEventVisit>) =>
    set({ visits: visits.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  const startDaily = () =>
    set({
      visits: eventDates(draft).map((d, i) => ({
        date: d,
        // 합계만 있던 값은 첫날에 몰아 둔다 — 잃어버리지 않게. 사람이 나눠 적는다.
        buyers: i === 0 ? draft.buyers ?? 0 : 0,
        nonBuyers: i === 0 ? draft.nonBuyers ?? 0 : 0,
      })),
    });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* ---- 미저장 띠 ----
          버리기 확인(useConfirm)은 나갈 때에야 뜬다. 그 전에 「아직 저장 안 됐다」가
          눈에 보여야 한다 — 목업의 편집기 맨 위 띠가 그 자리다. */}
      {(dirty || draft.isNew) && (
        <InlineNotice
          tone="warning"
          icon={TriangleAlert}
          action={
            <Button size="sm" loading={saving} onClick={onSave}>
              {draft.isNew ? "추가" : "저장"}
            </Button>
          }
        >
          저장되지 않은 변경사항이 있습니다.
        </InlineNotice>
      )}

      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-4">
          <SectionHeader
            className="mb-3"
            title={draft.isNew ? "새 이벤트" : draft.name || draft.id}
            hint={
              days > 0
                ? `운영 ${days}일 · 총 ${days * draft.hoursPerDay}시간 · 인건비 ${won(labor)}원`
                : "기간을 넣으면 운영일수와 인건비가 계산됩니다"
            }
            action={
              <span className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={onClose}>
                  닫기
                </Button>
                {!draft.isNew && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={onDelete}
                    className="hover:text-nd-danger-text"
                  >
                    삭제
                  </Button>
                )}
                <Button size="sm" loading={saving} disabled={!dirty && !draft.isNew} onClick={onSave}>
                  {draft.isNew ? "추가" : "저장"}
                </Button>
              </span>
            }
          />
        </div>

        {/* 탭 — 예전에는 Card 4장이 세로로 늘어서 실적을 보려면 한참 스크롤했다 */}
        <Tabs
          className="px-5"
          ariaLabel="이벤트 편집"
          value={tab}
          onChange={(k) => setTab(k as TabKey)}
          items={[
            { key: "basic", label: "기본정보" },
            { key: "supplies", label: "준비물", hint: itemized ? `${items.length}줄` : undefined },
            { key: "visits", label: "방문자", hint: conv !== null ? pct(conv, 0) : undefined },
            {
              key: "perf",
              label: "실적",
              badge: perf?.reviewCount,
              badgeLabel: "미확정 건수",
            },
          ]}
        />

        {/* ---- 기본 정보 (이벤트마스터) ---- */}
        {tab === "basic" && (
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="코드" required hint={draft.isNew ? "매장의 다음 번호가 제안됩니다" : "코드는 바꿀 수 없습니다"}>
              <Input
                size="sm"
                className="nd-num"
                value={draft.id}
                disabled={!draft.isNew}
                onChange={(e) => set({ id: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="이벤트명" required className="sm:col-span-2 lg:col-span-2">
              <Input size="sm" value={draft.name} placeholder="세븐틴 원우" onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="매장" required>
              <Select
                size="sm"
                value={draft.store}
                onChange={(e) => {
                  const store = e.target.value as SalesStore;
                  set({
                    store,
                    ...(draft.isNew ? { id: draft.id.replace(/^[A-Z]+-/, `${store === "wow" ? "WE" : store === "id" ? "ID" : "ON"}-`) } : {}),
                  });
                }}
              >
                {SALES_STORES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} — {s.hint}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="시작일" required>
              <Input size="sm" type="date" value={draft.from} onChange={(e) => setPeriod(e.target.value, draft.to < e.target.value ? e.target.value : draft.to)} />
            </Field>
            <Field label="종료일" required>
              <Input size="sm" type="date" value={draft.to} min={draft.from} onChange={(e) => setPeriod(draft.from, e.target.value)} />
            </Field>
            <Field label="일 운영시간" hint="시간">
              <Input
                size="sm"
                inputMode="numeric"
                className="nd-num"
                value={String(draft.hoursPerDay)}
                onChange={(e) => set({ hoursPerDay: Number(digits(e.target.value)) || 0 })}
              />
            </Field>
            <Field label="스태프" hint="아이디 행사는 0 (상시 인건비가 고정비)">
              <Input
                size="sm"
                inputMode="numeric"
                className="nd-num"
                value={String(draft.staff)}
                onChange={(e) => set({ staff: Number(digits(e.target.value)) || 0 })}
              />
            </Field>
            <Field label="시급" hint={`비우면 기본가정 ${won(defaultWage)}원`}>
              <Input
                size="sm"
                inputMode="numeric"
                className="nd-num"
                placeholder={String(defaultWage)}
                value={draft.wage === undefined || draft.wage === null ? "" : String(draft.wage)}
                onChange={(e) => {
                  const v = digits(e.target.value);
                  set({ wage: v ? Number(v) : undefined });
                }}
              />
            </Field>
            <Field label="메모" className="sm:col-span-2 lg:col-span-3">
              <Textarea
                size="sm"
                rows={1}
                value={draft.note ?? ""}
                placeholder="7/18 방문자 기록 없음 · 협업 라인"
                onChange={(e) => set({ note: e.target.value })}
              />
            </Field>
          </div>
        )}

        {/* ---- 준비물 (이벤트준비물) ---- */}
        {tab === "supplies" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <p className="text-nd-caption text-nd-fg-2">
                {itemized
                  ? `${items.length}줄 · 합계 ${won(total)}원 (줄에서 계산)`
                  : "품목을 줄로 적으면 합계가 자동으로 잡힙니다"}
              </p>
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => addItem()}>
                줄 추가
              </Button>
            </div>
            {!itemized && (
              <FormRow className="grid-cols-1 px-5 pb-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
                <Field label="준비물 합계(원)" hint="엑셀에서 옮긴 이벤트는 합계만 있습니다">
                  <Input
                    size="sm"
                    inputMode="numeric"
                    className="nd-num"
                    value={String(draft.supplies || "")}
                    placeholder="0"
                    onChange={(e) => set({ supplies: Number(digits(e.target.value)) || 0 })}
                  />
                </Field>
                <FieldAction center>
                  <TableNote>줄을 추가하면 이 합계 대신 줄의 합을 씁니다.</TableNote>
                </FieldAction>
              </FormRow>
            )}
            {itemized && (
              // 머리글을 붙여 둔다 — 줄이 스무 개를 넘으면 어느 칸이 단가인지 사라진다
              <TableScroll maxHeight="52vh">
                <Table minWidth={640} dense>
                  <thead>
                    <tr>
                      <Th sticky="top" className="pl-5">품목</Th>
                      <Th sticky="top" align="right">수량</Th>
                      <Th sticky="top" align="right">단가</Th>
                      <Th sticky="top" align="right">금액</Th>
                      <Th sticky="top">구분</Th>
                      <Th sticky="top" className="pr-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <Tr key={i} hover={false}>
                        <Td className="pl-5">
                          <Input
                            size="sm"
                            value={it.name}
                            placeholder="배너"
                            aria-label={`준비물 ${i + 1} 품목`}
                            onChange={(e) => setItem(i, { name: e.target.value })}
                          />
                        </Td>
                        <Td num>
                          <Input
                            size="sm"
                            inputMode="numeric"
                            className="nd-num w-16 text-right"
                            value={String(it.qty)}
                            aria-label={`준비물 ${i + 1} 수량`}
                            onChange={(e) => setItem(i, { qty: Number(digits(e.target.value)) || 0 })}
                          />
                        </Td>
                        <Td num>
                          <Input
                            size="sm"
                            inputMode="numeric"
                            className="nd-num w-24 text-right"
                            value={String(it.unitPrice)}
                            aria-label={`준비물 ${i + 1} 단가`}
                            onChange={(e) => setItem(i, { unitPrice: Number(digits(e.target.value)) || 0 })}
                          />
                        </Td>
                        <Td num>
                          <Money value={supplyAmount(it)} unit={false} flow="expense" />
                        </Td>
                        <Td>
                          <Input
                            size="sm"
                            className="w-20"
                            value={it.category ?? ""}
                            placeholder="직생"
                            aria-label={`준비물 ${i + 1} 구분`}
                            onChange={(e) => setItem(i, { category: e.target.value })}
                          />
                        </Td>
                        <Td className="pr-5">
                          <IconButton icon={Trash2} label={`준비물 ${i + 1} 줄 삭제`} size="sm" onClick={() => removeItem(i)} />
                        </Td>
                      </Tr>
                    ))}
                    <TotalRow>
                      <Td className="pl-5">합계</Td>
                      <Td num>{items.reduce((s, i) => s + (Number(i.qty) || 0), 0)}</Td>
                      <Td />
                      <Td num>
                        <Money value={total} unit={false} flow="expense" />
                      </Td>
                      <Td />
                      <Td className="pr-5" />
                    </TotalRow>
                  </tbody>
                </Table>
              </TableScroll>
            )}
            {recent.length > 0 && (
              <div className="border-t border-nd-line px-5 py-3">
                <p className="mb-1.5 text-nd-micro text-nd-fg-3">자주 쓴 준비물 — 누르면 줄이 붙습니다 (엑셀 「준비물 참고 가격」 자리)</p>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() => addItem({ name: r.name, qty: 1, unitPrice: r.unitPrice, category: r.category })}
                      className="rounded-full border border-nd-border bg-nd-content px-2.5 py-1 text-nd-micro text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-sunken"
                    >
                      {r.name} <span className="nd-num text-nd-fg-3">{won(r.unitPrice)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ---- 방문자 (방문자통계) ---- */}
        {tab === "visits" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <p className="text-nd-caption text-nd-fg-2">
                {conv !== null
                  ? `구매 ${totals.buyers ?? 0} · 미구매 ${totals.nonBuyers ?? 0} · 전환율 ${pct(conv)}`
                  : "구매·미구매를 적으면 전환율이 계산됩니다 (와우 팝업만 집계해 왔습니다)"}
              </p>
              {!daily && days > 0 && (
                <Button size="sm" variant="secondary" icon={Plus} onClick={startDaily}>
                  하루씩 적기
                </Button>
              )}
            </div>
            {!daily ? (
              <FormRow className="grid-cols-2 px-5 pb-4 sm:grid-cols-[8rem_8rem_5rem_minmax(0,1fr)]">
                <Field label="구매자수">
                  <Input
                    size="sm"
                    inputMode="numeric"
                    className="nd-num"
                    value={draft.buyers === undefined || draft.buyers === null ? "" : String(draft.buyers)}
                    onChange={(e) => {
                      const v = digits(e.target.value);
                      set({ buyers: v ? Number(v) : undefined });
                    }}
                  />
                </Field>
                <Field label="미구매자수">
                  <Input
                    size="sm"
                    inputMode="numeric"
                    className="nd-num"
                    value={draft.nonBuyers === undefined || draft.nonBuyers === null ? "" : String(draft.nonBuyers)}
                    onChange={(e) => {
                      const v = digits(e.target.value);
                      set({ nonBuyers: v ? Number(v) : undefined });
                    }}
                  />
                </Field>
                <FieldAction center className="col-span-2 sm:col-span-1">
                  <span className="text-nd-body">
                    <Rate value={conv} tone="auto" />
                  </span>
                </FieldAction>
                <FieldAction center className="col-span-2 sm:col-span-1">
                  <TableNote>하루씩 적으면 며칠째부터 전환율이 떨어지는지 보입니다.</TableNote>
                </FieldAction>
              </FormRow>
            ) : (
              <TableScroll maxHeight="52vh">
                <Table minWidth={560} dense>
                  <thead>
                    <tr>
                      <Th sticky="top" className="pl-5">날짜</Th>
                      <Th sticky="top" align="right">구매</Th>
                      <Th sticky="top" align="right">미구매</Th>
                      <Th sticky="top" align="right">전환율</Th>
                      <Th sticky="top" className="pr-5">비고</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v, i) => {
                      const c = v.buyers + v.nonBuyers > 0 ? v.buyers / (v.buyers + v.nonBuyers) : null;
                      return (
                        <Tr key={v.date} hover={false}>
                          <Td className="nd-num whitespace-nowrap pl-5 text-nd-fg-2">{v.date}</Td>
                          <Td num>
                            <Input
                              size="sm"
                              inputMode="numeric"
                              className="nd-num w-16 text-right"
                              value={String(v.buyers)}
                              aria-label={`${v.date} 구매자수`}
                              onChange={(e) => setVisit(i, { buyers: Number(digits(e.target.value)) || 0 })}
                            />
                          </Td>
                          <Td num>
                            <Input
                              size="sm"
                              inputMode="numeric"
                              className="nd-num w-16 text-right"
                              value={String(v.nonBuyers)}
                              aria-label={`${v.date} 미구매자수`}
                              onChange={(e) => setVisit(i, { nonBuyers: Number(digits(e.target.value)) || 0 })}
                            />
                          </Td>
                          <Td num>
                            <Rate value={c} digits={0} tone="auto" />
                          </Td>
                          <Td className="pr-5">
                            <Input
                              size="sm"
                              value={v.note ?? ""}
                              placeholder="당일 · 기록 없음"
                              aria-label={`${v.date} 비고`}
                              onChange={(e) => setVisit(i, { note: e.target.value })}
                            />
                          </Td>
                        </Tr>
                      );
                    })}
                    <TotalRow>
                      <Td className="pl-5">합계</Td>
                      <Td num>{totals.buyers ?? 0}</Td>
                      <Td num>{totals.nonBuyers ?? 0}</Td>
                      <Td num>
                        <Rate value={conv} tone="auto" />
                      </Td>
                      <Td className="pr-5">
                        <Button size="sm" variant="ghost" onClick={() => set({ visits: [], buyers: totals.buyers, nonBuyers: totals.nonBuyers })}>
                          합계만 남기기
                        </Button>
                      </Td>
                    </TotalRow>
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </>
        )}

        {/* ---- 이 달 실적 (읽기 전용) ---- */}
        {tab === "perf" && (
          <div className="px-5 py-4">
            {perf && !draft.isNew ? (
              <>
                <SectionHeader
                  title="이 행사의 실적"
                  hint="적재된 판매에서 계산 — 여기서는 고칠 수 없습니다"
                  action={
                    perf.reviewCount > 0 ? (
                      <Link href="/neander/sales/review" className="text-nd-caption font-medium text-nd-warning-text underline">
                        미확정 {perf.reviewCount}건 검토하기
                      </Link>
                    ) : undefined
                  }
                />
                <KpiStrip columns={4}>
                  <StatTile
                    label="매출"
                    value={perf.revenue}
                    flow="income"
                    hint={perf.pendingRevenue > 0 ? `미확정 ${won(perf.pendingRevenue)}원 포함` : `수량 ${won(perf.qty)}`}
                    wrapValue={(money) => (
                      <SalesDrill
                        title={`${perf.event.name} · 매출`}
                        subtitle={`${monthLabel(month)} · 미확정 포함`}
                        // buildEventPerf 와 같은 거름 — 그 달 줄 중 이 행사에 붙은 것
                        lines={() => lines.filter((l) => inMonth(l.date, month) && l.eventId === perf.event.id)}
                        flow="income"
                      >
                        {money}
                      </SalesDrill>
                    )}
                  />
                  <StatTile
                    label="변동비"
                    value={perf.variable}
                    flow="expense"
                    hint={`재료 ${won(perf.material)} · 인건비 ${won(perf.labor)} · 준비물 ${won(perf.supplies)} · 수수료 ${won(perf.fee)}`}
                    wrapValue={(money) => (
                      <SalesDrill
                        title={`${perf.event.name} · 변동비`}
                        subtitle={monthLabel(month)}
                        detail={() => ({
                          key: "variable",
                          title: "변동비",
                          total: perf.variable,
                          direction: "expense",
                          basis: "재료비·수수료는 확정 줄만",
                          rows: [
                            { key: "material", label: "재료비", value: perf.material },
                            { key: "labor", label: "인건비", value: perf.labor, sub: "행사 인건비 + 제작 인건비" },
                            { key: "supplies", label: "준비물", value: perf.supplies },
                            { key: "fee", label: "수수료", value: perf.fee },
                          ],
                        })}
                      >
                        {money}
                      </SalesDrill>
                    )}
                  />
                  <StatTile
                    label={<TermLabel term="공헌이익" />}
                    value={perf.contribution}
                    flow="net"
                    hint={`확정 매출 기준 ${pct(perf.contributionRate)}`}
                    wrapValue={(money) => (
                      <SalesDrill
                        title={`${perf.event.name} · 공헌이익`}
                        subtitle={monthLabel(month)}
                        detail={() => ({
                          key: "contribution",
                          title: "공헌이익",
                          total: perf.contribution,
                          formula: true,
                          direction: "net",
                          basis: "확정 매출 기준",
                          rows: [
                            { key: "confirmed", label: "확정 매출", value: perf.confirmedRevenue },
                            { key: "material", label: "재료비", value: perf.material, sign: "minus" },
                            { key: "labor", label: "인건비", value: perf.labor, sign: "minus" },
                            { key: "supplies", label: "준비물", value: perf.supplies, sign: "minus" },
                            { key: "fee", label: "수수료", value: perf.fee, sign: "minus" },
                          ],
                          note:
                            perf.pendingRevenue > 0
                              ? `미확정 매출 ${won(perf.pendingRevenue)}원은 빠져 있습니다 — 확정하면 들어갑니다.`
                              : undefined,
                        })}
                      >
                        {money}
                      </SalesDrill>
                    )}
                  />
                  <KpiItem
                    label="일당 공헌이익"
                    value={
                      perf.contributionPerDay === 0 ? (
                        <Money value={0} unit={false} flow="net" />
                      ) : (
                        <SalesDrill
                          title={`${perf.event.name} · 일당 공헌이익`}
                          subtitle={monthLabel(month)}
                          detail={() => ({
                            key: "contributionPerDay",
                            title: "일당 공헌이익",
                            total: perf.contributionPerDay,
                            formula: true,
                            direction: "net",
                            basis: `공헌이익 ÷ 운영 ${perf.days}일 (원 단위 반올림)`,
                            rows: [{ key: "contribution", label: "공헌이익", value: perf.contribution }],
                            note: `운영 ${perf.days}일로 나눔`,
                          })}
                        >
                          <Money value={perf.contributionPerDay} unit={false} flow="net" />
                        </SalesDrill>
                      )
                    }
                    unit="원"
                    hint={`${perf.days}일 운영`}
                    tone={perf.contributionPerDay < 0 ? "danger" : undefined}
                  />
                </KpiStrip>
                <TableNote className="pt-2">
                  이익률의 분모는 <b>확정 매출</b>입니다. 미확정이 남아 있으면 잠정치입니다.
                  준비물·인건비를 고치고 저장하면 바로 반영됩니다.
                </TableNote>
              </>
            ) : (
              <EmptyState
                icon={ChartNoAxesColumn}
                title={draft.isNew ? "저장한 뒤에 실적이 나옵니다" : "이 행사에 붙은 판매가 없습니다"}
                description={
                  draft.isNew
                    ? "기간을 넣고 저장하면 그 기간의 판매가 이 행사에 붙고, 여기에 매출·공헌이익이 나타납니다."
                    : "그 기간에 적재된 판매가 없거나 아직 상품이 확정되지 않았습니다."
                }
                className="border-0"
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
