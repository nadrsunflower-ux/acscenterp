"use client";

// ============================================================
//  매출 › 상품 관리
// ------------------------------------------------------------
//  상품을 만들고·고치고·지우는 곳. 「상품 수익성」은 읽는 화면(1개당 공헌
//  이익 순위와 그 달 실적)이고, 여기는 **쓰는 화면**이다. 둘을 한 페이지에
//  두면 분석하러 온 사람이 실수로 마스터를 고친다.
//
//  행사마다 그 행사만의 품목이 나온다 (뉴진스4주년의 18,000원 품목처럼).
//  그래서 「전용 이벤트」가 있다 — 지정하면 그 행사의 판매에만 후보로 뜨고,
//  다른 행사의 같은 금액을 가져가지 않는다.
//
//  ⚠️ 검토 대기함의 「새 상품 만들기」는 그대로 남는다. 필요를 발견하는 자리는
//     거기이고, 거기서는 만든 뒤 그 묶음까지 바로 확정된다. 이 페이지는 미리
//     등록하거나, 만들어 둔 것을 되짚어 고치고 지우는 자리다.
//
//  ⚠️ 배치를 **목록 + 상세**로 바꿨다 (승인 목업 all-pages/sales-catalog.png).
//     예전에는 열 11개짜리 1,460px 표 안에서 값을 고쳤는데, 390px 에서는
//     저장 버튼까지 가려면 표를 가로로 끝까지 밀어야 했고 어느 상품을 고치는
//     중인지도 잃었다. 지금은 왼쪽에서 고르고 오른쪽에서 고친다.
//
//     고치던 값은 **상품을 옮겨도 남는다** (draft 를 상품코드로 들고 있다).
//     여러 상품을 훑으며 고친 뒤 하나씩 저장할 수 있고, 아직 저장 안 된
//     상품은 목록에 점으로 표시된다.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Package, PackagePlus, Plus, TriangleAlert, Trash2 } from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Checkbox,
  Dialog,
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
  LoadingState,
  MasterDetail,
  PageHeader,
  PageShell,
  SearchInput,
  SectionHeader,
  SegmentedControl,
  Select,
  StatusDot,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useSales } from "@/components/neander/sales/SalesProvider";
import { ProductHero, ProductThumb, Rate } from "@/components/neander/sales/ui";
import { deleteSalesProduct, upsertSalesProduct } from "@/lib/neander/sales/client";
import {
  SALES_KINDS,
  SALES_STORES,
  eventLabelOf,
  feeRateOf,
  kindLabel,
  materialAmount,
  materialTotal,
  storeLabel,
  type SalesAssumptions,
  type SalesEvent,
  type SalesKind,
  type SalesMaterialItem,
  type SalesProduct,
  type SalesStore,
} from "@/lib/neander/sales/types";

/** 어느 매장의 상품을 볼지 */
type StoreFilter = SalesStore | "all";

/** 상품 하나의 결제 경로 — 세트는 네이버예약, 온라인은 자사몰, 나머지는 현장 */
const routeOf = (p: SalesProduct) =>
  p.bottles > 1 ? "naver" : p.store === "online" ? "online" : "payhere";

/** 판매가·재료비에서 1개당 공헌이익률. 판매가가 0 이면 계산할 수 없다(—) */
function rateOf(price: number, material: number, p: SalesProduct, a: SalesAssumptions) {
  const fee = Math.round(price * feeRateOf(routeOf(p), a.fee));
  return { fee, rate: price ? (price - material - fee) / price : null };
}

export default function SalesCatalogPage() {
  const { lines, products, events, assumptions, loading, masterEmpty, error, refresh } = useSales();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [store, setStore] = useState<StoreFilter>("all");
  const [dedicatedOnly, setDedicatedOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 아직 저장하지 않은 값 — 상품코드로 들고 있어 다른 상품을 봐도 남는다 */
  const [draft, setDraft] = useState<Record<string, Partial<SalesProduct>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  /**
   * 상품별 사용 실적 — 그 상품으로 확정된 판매 줄 수·수량.
   *
   * 지우기 전에 이게 보여야 한다. 쓰이고 있는 상품을 지우면 그 줄의 재료비가
   * 0 으로 계산되어 공헌이익이 조용히 부풀기 때문이다.
   */
  const usage = useMemo(() => {
    const m = new Map<string, { rows: number; qty: number; amount: number; lastDate: string }>();
    lines.forEach((l) => {
      if (l.status !== "resolved" || !l.productId) return;
      const cur = m.get(l.productId) ?? { rows: 0, qty: 0, amount: 0, lastDate: "" };
      cur.rows += 1;
      cur.qty += l.qty;
      cur.amount += l.amount;
      if (l.date > cur.lastDate) cur.lastDate = l.date;
      m.set(l.productId, cur);
    });
    return m;
  }, [lines]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => store === "all" || p.store === store)
      .filter((p) => !dedicatedOnly || (p.eventIds?.length ?? 0) > 0)
      .filter((p) =>
        !s
          ? true
          : [p.id, p.name, p.option, ...(p.aliases ?? [])].join(" ").toLowerCase().includes(s),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [products, store, dedicatedOnly, q]);

  const dedicatedCount = products.filter((p) => (p.eventIds?.length ?? 0) > 0).length;
  const unconfirmedCount = products.filter((p) => p.unconfirmed || p.conflict).length;
  const unusedCount = products.filter((p) => !usage.has(p.id)).length;
  const dirtyCount = Object.keys(draft).length;

  const selected = useMemo(
    () => filtered.find((p) => p.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  // 거른 목록에서 고른 상품이 사라지면 (검색어를 바꿨을 때) 선택을 놓는다 —
  // 안 그러면 오른쪽 판이 목록에 없는 상품을 계속 보여준다.
  useEffect(() => {
    if (selectedId && !filtered.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

  const editDraft = (id: string, patch: Partial<SalesProduct>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const dropDraft = (id: string) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  async function save(p: SalesProduct) {
    const patch = draft[p.id];
    if (!patch) return;
    setSaving(p.id);
    try {
      await upsertSalesProduct({ ...p, ...patch });
      dropDraft(p.id);
      toast.success(`${p.name} ${p.option} 저장했습니다.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(null);
    }
  }

  /**
   * 상품을 지운다.
   *
   * ⚠️ 이미 그 상품으로 확정된 판매 줄은 **그대로 남는다** — 상품을 못 찾으면
   *    재료비가 0 으로 계산되어 공헌이익이 과대평가된다. 그래서 쓰인 적이 있는
   *    상품은 몇 줄이 걸려 있는지 알려주고 한 번 더 묻는다.
   */
  async function remove(p: SalesProduct) {
    const used = usage.get(p.id);
    const ok = await confirm({
      title: `「${p.name} ${p.option}」 (${p.id}) 을 지울까요?`,
      message: used
        ? `이 상품으로 확정된 판매가 ${used.rows.toLocaleString("ko-KR")}줄 · ` +
          `${used.amount.toLocaleString("ko-KR")}원 있습니다 (마지막 ${used.lastDate}). ` +
          "지우면 그 줄의 재료비가 0 으로 계산되어 공헌이익이 실제보다 좋게 나옵니다."
        : "이 상품으로 확정된 판매는 아직 없습니다. 지워도 손익에 영향이 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    setSaving(p.id);
    try {
      await deleteSalesProduct(p.id);
      dropDraft(p.id);
      if (selectedId === p.id) setSelectedId(null);
      toast.success(`${p.id} 를 지웠습니다.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <LoadingState label="상품을 불러오는 중…" />;

  // 불러오지 못한 것과 아직 없는 것은 다르다
  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="상품 관리" description="판매가 · 재료비 · 전용 이벤트 · POS 별칭" />
        <ErrorState
          title="상품을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  if (masterEmpty) {
    return (
      <PageShell width="form">
        <PageHeader title="상품 관리" description="판매가 · 재료비 · 전용 이벤트 · POS 별칭" />
        <EmptyState
          icon={Package}
          title="상품 마스터가 비어 있습니다"
          description="마스터에서 한 번 적재하면 엑셀에서 뽑아둔 상품이 들어옵니다. 그 뒤에는 여기서 고치고 더합니다."
          action={
            <Link href="/neander/sales/master">
              <Button>마스터로 이동</Button>
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="상품 관리"
        description="판매가 · 재료비 · 전용 이벤트 · POS 별칭. 모든 공헌이익 계산의 근거입니다."
        className="mb-3"
        meta={
          dirtyCount > 0 ? (
            <StatusDot tone="warning" className="text-nd-body font-medium text-nd-warning-text">
              저장 안 한 상품 {dirtyCount}종
            </StatusDot>
          ) : (
            <span className="text-nd-caption text-nd-fg-2">
              {products.length}종 · 전용 {dedicatedCount}종 · 안 쓰인 것 {unusedCount}종
            </span>
          )
        }
        actions={
          <>
            <Link href="/neander/sales/products">
              <Button variant="ghost" icon={Boxes}>
                상품 수익성
              </Button>
            </Link>
            <Button icon={PackagePlus} onClick={() => setAdding(true)}>
              상품 추가
            </Button>
          </>
        }
      />

      {/* 기준은 한 줄 + 도움말. 상태(미확정 단가)는 아래 경고 띠와 목록 뱃지에 그대로 */}
      <BasisLine
        className="mb-4"
        items={["모든 공헌이익 계산의 근거", "판매가 · 재료비는 날짜별로 기록"]}
      >
        <InfoPopover
          label="열 설명"
          title="상품 관리 열 설명"
          terms={[
            { term: "POS 별칭", desc: "결제 내역 문자열을 이 상품으로 읽는 근거입니다. 검토 대기함에 「모르는 상품명」 이 쌓이면 여기에 별칭을 더하세요. 다음 적재부터 자동으로 잡힙니다." },
            { term: "전용 이벤트", desc: "지정하면 그 행사의 판매에만 후보로 뜹니다. 행사마다 나오는 일회성 품목을 매장 공용으로 두면 마스터가 차오르고 다른 행사의 같은 금액을 가져갑니다. 비워 두면 그 매장 전체에서 씁니다." },
            { term: "공헌이익률", desc: "(판매가 − 재료비 − 결제 수수료) ÷ 판매가. 수수료는 세트는 네이버, 온라인은 온라인, 그 외는 페이히어 요율입니다." },
            { term: "사용", desc: "이 상품으로 확정된 판매 줄 수 · 수량 · 마지막 판매일. 지우기 전에 확인하세요." },
            { term: "상품 사진", desc: "공식 사이트의 상품 유형별 사진입니다. 사쉐 · 피규어 디퓨저 · 입장권처럼 공식 사진이 없는 항목은 중립 아이콘으로 둡니다." },
          ]}
          footer={
            <>
              새 상품은 위 「상품 추가」 로, 또는{" "}
              <Link href="/neander/sales/review" className="font-medium text-nd-accent-strong hover:underline">
                검토 대기함
              </Link>
              에서 묶음을 보다가 「새 상품 만들기」 로도 만듭니다.
            </>
          }
        />
      </BasisLine>

      {unconfirmedCount > 0 && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          단가 근거가 확정되지 않았거나 엑셀 시트끼리 값이 어긋난 상품이{" "}
          <b>{unconfirmedCount}종</b> 있습니다 — 목록에서 뱃지로 표시됩니다.
        </InlineNotice>
      )}

      <FilterBar
        className="mb-3"
        actions={
          <SearchInput
            className="w-56"
            value={q}
            onValueChange={setQ}
            placeholder="상품명 · 코드 · 별칭"
            ariaLabel="상품 검색"
          />
        }
      >
        <FilterField label="매장" as="div">
          <SegmentedControl
            size="sm"
            ariaLabel="매장"
            value={store}
            onChange={(v) => setStore(v as StoreFilter)}
            options={[
              { value: "all", label: "전체" },
              ...SALES_STORES.map((s) => ({ value: s.value, label: s.label })),
            ]}
          />
        </FilterField>
        <Checkbox
          label={`전용 상품만 (${dedicatedCount})`}
          checked={dedicatedOnly}
          onChange={(e) => setDedicatedOnly(e.target.checked)}
          className="text-nd-caption text-nd-fg-2"
        />
      </FilterBar>

      <MasterDetail
        selected={!!selected}
        onBack={() => setSelectedId(null)}
        backLabel="상품 목록으로"
        listWidth={400}
        list={
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
              <h2 className="text-nd-section text-nd-fg">
                상품 목록{" "}
                <span className="nd-num text-nd-caption font-normal text-nd-fg-3">
                  {filtered.length.toLocaleString("ko-KR")}종
                </span>
              </h2>
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                icon={Package}
                title="조건에 맞는 상품이 없습니다"
                description="검색어나 필터를 바꿔보세요."
                className="border-0"
              />
            ) : (
              <ul className="nd-scroll max-h-[68vh] overflow-y-auto border-t border-nd-line">
                {filtered.map((p) => {
                  const d = draft[p.id] ?? {};
                  const price = d.price ?? p.price;
                  const material = d.material ?? p.material;
                  const { rate } = rateOf(price, material, p, assumptions);
                  const dirty = Object.keys(d).length > 0;
                  const used = usage.get(p.id);
                  const active = selectedId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-nd-line px-4 py-2.5 text-left transition-colors duration-nd-fast last:border-b-0",
                          active ? "bg-nd-accent-soft" : "hover:bg-nd-sunken",
                        )}
                      >
                        <ProductThumb product={p} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-nd-body text-nd-fg">{p.name}</span>
                            {dirty && (
                              <span
                                aria-hidden
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-nd-warning"
                              />
                            )}
                            {dirty && <span className="sr-only">저장 안 함</span>}
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-nd-micro text-nd-fg-3">
                            <span className="nd-num">{p.id}</span>
                            <span>· {p.option}</span>
                            {(p.eventIds?.length ?? 0) > 0 && (
                              <Badge tone="accent" size="sm">전용</Badge>
                            )}
                            {p.unconfirmed && <Badge tone="warning" size="sm">단가 미확정</Badge>}
                            {p.conflict && <Badge tone="danger" size="sm">시트 불일치</Badge>}
                            {!used && <span className="text-nd-fg-4">· 안 쓰임</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="nd-num block text-nd-caption text-nd-fg">
                            {price.toLocaleString("ko-KR")}
                          </span>
                          <Rate value={rate} tone="auto" className="block text-nd-micro" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        }
        detail={
          selected ? (
            <ProductDetail
              key={selected.id}
              product={selected}
              draft={draft[selected.id] ?? {}}
              onEdit={(patch) => editDraft(selected.id, patch)}
              onRevert={() => dropDraft(selected.id)}
              onSave={() => save(selected)}
              onDelete={() => remove(selected)}
              saving={saving === selected.id}
              events={events}
              assumptions={assumptions}
              usage={usage.get(selected.id)}
            />
          ) : (
            <Card>
              <EmptyState
                icon={Package}
                title="왼쪽에서 상품을 고르세요"
                description="고른 상품의 판매가 · 재료비 · POS 별칭 · 전용 이벤트를 여기서 고칩니다."
                className="border-0"
              />
            </Card>
          )
        }
      />

      {/* 상품 추가는 창으로 — 예전처럼 화면 위에 끼워 넣으면 목록이 통째로 밀린다 */}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        size="lg"
        title="상품 추가"
        description="행사 전용 품목은 전용 이벤트를 지정하세요 — 그 행사의 판매에만 후보로 뜹니다."
      >
        <ProductForm
          products={products}
          events={events}
          onDone={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      </Dialog>
    </PageShell>
  );
}

// ============================================================
//  상품 상세 — 판매가 · 재료비 · 별칭 · 전용 이벤트를 여기서 고친다
// ------------------------------------------------------------
//  고칠 수 있는 것만 입력칸으로 둔다. 상품명·옵션·매장·유형·시간은 표시만
//  한다 — 예전 표에서도 그랬고, 이것들을 바꾸면 이미 확정된 판매 줄의 해석이
//  달라지기 때문이다 (바꿔야 하면 지우고 다시 만드는 것이 안전하다).
// ============================================================

function ProductDetail({
  product: p,
  draft: d,
  onEdit,
  onRevert,
  onSave,
  onDelete,
  saving,
  events,
  assumptions,
  usage,
}: {
  product: SalesProduct;
  draft: Partial<SalesProduct>;
  onEdit: (patch: Partial<SalesProduct>) => void;
  onRevert: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  events: SalesEvent[];
  assumptions: SalesAssumptions;
  usage?: { rows: number; qty: number; amount: number; lastDate: string };
}) {
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const { products } = useSales();
  const price = d.price ?? p.price;
  const items = d.materialItems ?? p.materialItems ?? [];
  const itemized = items.length > 0;
  const material = itemized ? materialTotal(items) : d.material ?? p.material;
  const { fee, rate } = rateOf(price, material, p, assumptions);
  const dirty = Object.keys(d).length > 0;

  /** 재료 줄을 바꾸면 재료비도 함께 — 저장 때 서버가 같은 계산으로 한 번 더 맞춘다 */
  const setItems = (next: SalesMaterialItem[]) =>
    onEdit({ materialItems: next, ...(next.length > 0 ? { material: materialTotal(next) } : {}) });
  const setItem = (i: number, patch: Partial<SalesMaterialItem>) =>
    setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  /** 복사해 올 수 있는 상품 — 재료 줄이 있는 다른 상품. 같은 매장을 앞에 */
  const copySources = useMemo(
    () =>
      products
        .filter((x) => x.id !== p.id && (x.materialItems?.length ?? 0) > 0)
        .sort((a, b) => Number(b.store === p.store) - Number(a.store === p.store) || a.id.localeCompare(b.id)),
    [products, p.id, p.store],
  );

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <SectionHeader
          className="mb-0"
          title="상품 정보"
          hint={`${storeLabel(p.store)} · ${kindLabel(p.kind)}`}
        />
        {dirty && (
          <StatusDot tone="warning" className="text-nd-caption font-medium text-nd-warning-text">
            변경된 내용이 있습니다
          </StatusDot>
        )}
      </div>

      <div className="grid gap-5 px-5 py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        {/* 좁은 화면에서는 사진이 화면 폭만 한 정사각이 되어 입력칸을 한참
            아래로 민다 — 손바닥만 하게 묶어 둔다 */}
        <div className="w-32 sm:w-auto">
          <ProductHero product={p} />
        </div>
        <div className="min-w-0">
          <p className="text-nd-title text-nd-fg">{p.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-nd-caption text-nd-fg-3">
            <span className="nd-num">{p.id}</span>
            <span>· {p.option}</span>
            {p.bottles > 1 && <Badge size="sm">세트 {p.bottles}병</Badge>}
            {p.unconfirmed && <Badge tone="warning" size="sm">단가 미확정</Badge>}
            {p.conflict && <Badge tone="danger" size="sm">시트 불일치</Badge>}
          </p>
          {p.conflict && (
            <p className="mt-2 text-nd-caption leading-relaxed text-nd-danger-text">{p.conflict}</p>
          )}
          {p.note && <p className="mt-2 text-nd-caption text-nd-fg-2">{p.note}</p>}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-nd-caption">
            <div className="flex justify-between gap-2">
              <dt className="text-nd-fg-3">타임 / 제작</dt>
              <dd className="nd-num text-nd-fg">{p.timeMin} / {p.makeMin}분</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-nd-fg-3">결제 수수료</dt>
              <dd className="nd-num text-nd-fg">{fee.toLocaleString("ko-KR")}원</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-nd-fg-3">공헌이익률</dt>
              <dd><Rate value={rate} tone="auto" className="font-semibold" /></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-nd-fg-3">사용</dt>
              <dd className="nd-num text-nd-fg">
                {usage ? `${usage.rows.toLocaleString("ko-KR")}줄 · ${usage.qty.toLocaleString("ko-KR")}개` : "—"}
              </dd>
            </div>
          </dl>
          {usage && (
            <p className="mt-1 text-nd-micro text-nd-fg-3">
              마지막 판매 {usage.lastDate} · 누적 {usage.amount.toLocaleString("ko-KR")}원
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-nd-line px-5 py-4">
        <FormRow className="grid-cols-2 sm:grid-cols-4">
          <Field label="판매가" required>
            <Input
              size="sm"
              inputMode="numeric"
              className="nd-num text-right"
              aria-label={`${p.name} 판매가`}
              value={String(price)}
              onChange={(e) => onEdit({ price: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
            />
          </Field>
          <Field label="재료비" hint={itemized ? "아래 상세의 합계" : undefined}>
            <Input
              size="sm"
              inputMode="numeric"
              className="nd-num text-right"
              aria-label={`${p.name} 재료비`}
              value={String(material)}
              // 상세 줄이 있으면 합계는 줄에서 나온다 — 여기서 고치면 줄과 어긋난다
              disabled={itemized}
              onChange={(e) => onEdit({ material: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
            />
          </Field>
          <Field label="전용 이벤트" hint="비우면 매장 공용" className="col-span-2">
            <EventScopeCell
              product={p}
              draft={d}
              events={events}
              eventsById={eventsById}
              onChange={(ids) => onEdit({ eventIds: ids })}
            />
          </Field>
          <Field label="POS 별칭" hint="쉼표로 구분" className="col-span-2 sm:col-span-4">
            <Input
              size="sm"
              aria-label={`${p.name} 별칭`}
              placeholder="예) 일반 10ml 향수, 퍼스널센트 10ml"
              value={(d.aliases ?? p.aliases ?? []).join(", ")}
              onChange={(e) =>
                onEdit({
                  aliases: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </FormRow>
      </div>

      {/* ---- 직접재료비 상세 — 엑셀 「직접재료비」 시트의 한 블록 ---- */}
      <div className="border-t border-nd-line">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
          <SectionHeader
            className="mb-0"
            title="직접재료비 상세"
            hint={
              itemized
                ? `${items.length}줄 · 합계 ${material.toLocaleString("ko-KR")}원`
                : "재료를 줄로 적으면 재료비가 그 합계로 잡힙니다"
            }
          />
          <span className="flex flex-wrap items-center gap-2">
            {copySources.length > 0 && (
              <Select
                size="sm"
                // 폭을 두지 않으면 옵션 글자 길이만큼 늘어나 「줄 추가」를 다음 줄로 민다
                className="w-56"
                aria-label="다른 상품의 재료 줄 복사"
                value=""
                onChange={(e) => {
                  const src = copySources.find((x) => x.id === e.target.value);
                  if (src?.materialItems) setItems(src.materialItems.map((i) => ({ ...i })));
                }}
              >
                <option value="">{itemized ? "다른 상품 것으로 바꾸기…" : "다른 상품에서 복사…"}</option>
                {copySources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} {s.name} {s.option} ({s.material.toLocaleString("ko-KR")}원)
                  </option>
                ))}
              </Select>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => setItems([...items, { name: "", unitPrice: 0, qty: 1, unit: "EA" }])}
            >
              줄 추가
            </Button>
          </span>
        </div>
        {itemized && (
          <TableScroll maxHeight="52vh">
            <Table minWidth={720} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">제품명</Th>
                  <Th sticky="top" align="right">단가</Th>
                  <Th sticky="top" align="right">수량</Th>
                  <Th sticky="top">단위</Th>
                  <Th sticky="top" align="right">금액</Th>
                  <Th sticky="top">구입처</Th>
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
                        placeholder="공병(10ml)"
                        aria-label={`재료 ${i + 1} 제품명`}
                        onChange={(e) => setItem(i, { name: e.target.value })}
                      />
                    </Td>
                    <Td num>
                      <DecimalInput
                        className="w-24"
                        ariaLabel={`재료 ${i + 1} 단가`}
                        value={it.unitPrice}
                        onChange={(v) => setItem(i, { unitPrice: v })}
                      />
                    </Td>
                    <Td num>
                      <DecimalInput
                        className="w-16"
                        ariaLabel={`재료 ${i + 1} 수량`}
                        value={it.qty}
                        onChange={(v) => setItem(i, { qty: v })}
                      />
                    </Td>
                    <Td>
                      <Input
                        size="sm"
                        className="w-16"
                        value={it.unit ?? ""}
                        placeholder="EA"
                        aria-label={`재료 ${i + 1} 단위`}
                        onChange={(e) => setItem(i, { unit: e.target.value })}
                      />
                    </Td>
                    <Td num className="nd-num whitespace-nowrap">
                      {materialAmount(it).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}
                    </Td>
                    <Td>
                      <Input
                        size="sm"
                        className="w-28"
                        value={it.supplier ?? ""}
                        placeholder="새로핸즈"
                        aria-label={`재료 ${i + 1} 구입처`}
                        onChange={(e) => setItem(i, { supplier: e.target.value })}
                      />
                    </Td>
                    <Td className="pr-5">
                      <IconButton
                        icon={Trash2}
                        label={`재료 ${i + 1} 줄 삭제`}
                        size="sm"
                        onClick={() => setItems(items.filter((_, k) => k !== i))}
                      />
                    </Td>
                  </Tr>
                ))}
                <TotalRow>
                  <Td className="pl-5">합계</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td num className="nd-num">{material.toLocaleString("ko-KR")}</Td>
                  <Td />
                  <Td className="pr-5" />
                </TotalRow>
              </tbody>
            </Table>
          </TableScroll>
        )}
        <TableNote className="px-5 pb-3 pt-2">
          금액 = 단가 × 수량 (소수 그대로), 합계만 원 단위로 반올림합니다. 바꾼 재료비는 <b>앞으로</b>의
          판매에 쓰이고, 가격 이력에 적힌 과거 구간의 재료비는 그대로입니다.
        </TableNote>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-nd-line px-5 py-3">
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          disabled={saving}
          onClick={onDelete}
        >
          상품 삭제
        </Button>
        <span className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={onRevert}>
            변경 취소
          </Button>
          <Button size="sm" loading={saving} disabled={!dirty} onClick={onSave}>
            변경 저장
          </Button>
        </span>
      </div>

      <TableNote className="border-t border-nd-line px-5 py-2">
        <b>사용</b>은 그 상품으로 확정된 판매 줄 수입니다. 지우기 전에 확인하세요. 열의 뜻은 위 「열
        설명」 에 있습니다.
      </TableNote>
    </Card>
  );
}

/**
 * 소수를 받는 숫자 칸 — 향수베이스 5.5원/g, 풀 장식 0.5g.
 *
 * 값을 숫자로만 들고 있으면 「5.」를 치는 순간 5 로 바뀌어 소수점을 칠 수가
 * 없다. 그래서 친 글자를 따로 들고, 바깥 값이 **다른 숫자로** 바뀔 때만
 * (복사·변경 취소) 글자를 새로 맞춘다.
 */
function DecimalInput({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <Input
      size="sm"
      inputMode="decimal"
      className={cn("nd-num text-right", className)}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
        setText(t);
        onChange(Number(t) || 0);
      }}
    />
  );
}

// ============================================================
//  전용 이벤트 칸
// ------------------------------------------------------------
//  실제로 필요한 건 「공용」이냐 「이 행사 전용」이냐의 선택이다. 그래서
//  한 이벤트를 고르는 Select 로 둔다.
//
//  협업 라인처럼 여러 행사에 걸치는 경우는 배열이 두 개 이상이 되는데, 그건
//  적재 스크립트·마스터 데이터에서 들어온다. 화면에서 하나로 줄여 버리면
//  조용히 범위가 깎이므로, 그럴 때는 **읽기 전용**으로 보여주고 건드리지
//  않는다.
// ============================================================

function EventScopeCell({
  product,
  draft,
  events,
  eventsById,
  onChange,
}: {
  product: SalesProduct;
  draft: Partial<SalesProduct>;
  events: SalesEvent[];
  eventsById: Map<string, SalesEvent>;
  onChange: (ids: string[] | undefined) => void;
}) {
  const ids = draft.eventIds ?? product.eventIds ?? [];

  if (ids.length > 1) {
    return (
      <span className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <Badge key={id} tone="accent" size="sm">
            {eventLabelOf(id, eventsById)}
          </Badge>
        ))}
        <span className="text-nd-micro text-nd-fg-3">여러 행사 — 화면에서 바꾸지 않습니다</span>
      </span>
    );
  }

  // 같은 매장의 이벤트만 — 다른 매장 행사에 묶을 이유가 없다
  const options = events
    .filter((e) => e.store === product.store)
    .sort((a, b) => b.from.localeCompare(a.from));

  return (
    <Select
      size="sm"
      aria-label={`${product.name} 전용 이벤트`}
      className="w-52"
      value={ids[0] ?? ""}
      onChange={(e) => onChange(e.target.value ? [e.target.value] : undefined)}
    >
      <option value="">공용 ({storeLabel(product.store)} 전체)</option>
      {options.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name} ({e.id})
        </option>
      ))}
    </Select>
  );
}

// ============================================================
//  상품 추가
// ------------------------------------------------------------
//  검토 대기함에서도 만들 수 있지만(그 자리에서 묶음까지 확정된다), 미리
//  등록해 두거나 매장 공용 상품을 만들 때는 여기가 맞다.
//
//  코드는 매장·유형에서 접두를 정해 다음 빈 번호를 제안한다. 사람이 코드
//  체계를 외우게 만들 이유가 없다.
// ============================================================

const CODE_PREFIX: Record<SalesStore, Record<SalesKind, string>> = {
  id: { event: "IDE", regular: "IDI" },
  wow: { event: "WOW", regular: "WOW" },
  online: { event: "ONL", regular: "ONL" },
};

function suggestCode(products: SalesProduct[], prefix: string): string {
  const used = products
    .map((p) => p.id)
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n));
  return `${prefix}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
}

function ProductForm({
  products,
  events,
  onDone,
}: {
  products: SalesProduct[];
  events: SalesEvent[];
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [store, setStore] = useState<SalesStore>("id");
  const [kind, setKind] = useState<SalesKind>("event");
  const [code, setCode] = useState(() => suggestCode(products, CODE_PREFIX.id.event));
  const [codeTouched, setCodeTouched] = useState(false);
  const [name, setName] = useState("");
  const [option, setOption] = useState("기본");
  const [price, setPrice] = useState("");
  const [material, setMaterial] = useState("");
  const [bottles, setBottles] = useState("1");
  const [eventId, setEventId] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);

  /** 매장·유형이 바뀌면 코드를 다시 제안한다 (사람이 손댄 뒤에는 그대로 둔다) */
  const retarget = (nextStore: SalesStore, nextKind: SalesKind) => {
    setStore(nextStore);
    setKind(nextKind);
    setEventId("");
    if (!codeTouched) setCode(suggestCode(products, CODE_PREFIX[nextStore][nextKind]));
  };

  const taken = products.some((p) => p.id === code.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = code.trim();
    if (!id) return toast.error("상품코드가 필요합니다.");
    if (taken) return toast.error(`${id} 는 이미 있는 코드입니다.`);
    if (!name.trim()) return toast.error("상품명이 필요합니다.");
    if (!(Number(price) > 0)) return toast.error("판매가를 올바르게 입력하세요.");
    setSaving(true);
    try {
      await upsertSalesProduct({
        id,
        store,
        kind,
        name: name.trim(),
        option: option.trim() || "기본",
        price: Number(price),
        material: Number(material) || 0,
        timeMin: 0,
        makeMin: 0,
        bottles: Number(bottles) || 1,
        ...(eventId ? { eventIds: [eventId] } : {}),
        ...(alias.trim() ? { aliases: [alias.trim()] } : {}),
        note: "마스터에서 직접 만듦",
      });
      toast.success(`${name.trim()} 을 만들었습니다.`);
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "상품을 만들지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const eventOptions = events
    .filter((e) => e.store === store)
    .sort((a, b) => b.from.localeCompare(a.from));

  return (
    <>
      {/* 칸마다 폭이 제각각이면 줄이 삐뚤어진다 — 너비는 격자 열에 맡긴다.
          제목·설명은 창(Dialog)이 이미 그린다. */}
      <FormRow as="form" onSubmit={submit} className="grid-cols-2 sm:grid-cols-4">
        <Field label="매장" required>
          <Select
            size="sm"
            value={store}
            onChange={(e) => retarget(e.target.value as SalesStore, kind)}
          >
            {SALES_STORES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="유형" required>
          <Select
            size="sm"
            value={kind}
            onChange={(e) => retarget(store, e.target.value as SalesKind)}
          >
            {SALES_KINDS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="코드" required error={taken ? "이미 있습니다" : undefined} className="col-span-2 sm:col-span-1">
          <Input
            size="sm"
            className="nd-num"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeTouched(true);
            }}
          />
        </Field>
        <Field label="상품명" required className="col-span-2 sm:col-span-1 xl:col-span-2">
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="옵션">
          <Input size="sm" value={option} onChange={(e) => setOption(e.target.value)} />
        </Field>
        <Field label="판매가" required>
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="재료비" hint="모르면 0">
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num"
            value={material}
            placeholder="0"
            onChange={(e) => setMaterial(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="세트 병수">
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num"
            value={bottles}
            onChange={(e) => setBottles(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="전용 이벤트" hint="비우면 공용" className="col-span-2 xl:col-span-3">
          <Select
            size="sm"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">공용 ({storeLabel(store)} 전체)</option>
            {eventOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.id})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="POS 별칭" hint="여러 뜻인 문구는 넣지 않습니다" className="col-span-2">
          <Input size="sm" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </Field>
        <FieldAction>
          <Button type="submit" size="sm" loading={saving} className="w-full sm:w-auto">
            추가
          </Button>
        </FieldAction>
      </FormRow>
      <TableNote className="pt-2">
        별칭을 넣으면 <b>다음 적재부터</b> 그 문구가 자동으로 이 상품이 됩니다. 「금액 입력」처럼
        여러 뜻인 문구에 넣으면 금액 역산을 자동화하는 셈이니, 문구가 이 상품만을 가리킬 때에만
        적으세요. 타임·제작 분은 0 으로 만들어집니다 — 인건비를 잡아야 하면 적재 후 마스터
        데이터에서 채우세요.
      </TableNote>
    </>
  );
}
