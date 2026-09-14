"use client";

// ============================================================
//  매출 › 상품 수익성 — 엑셀 「매출시뮬레이션 › 상품별 수익성 비교」
// ------------------------------------------------------------
//  두 가지를 나눠 본다.
//
//   ① 구조  — 실제로 몇 개 팔렸는지와 무관한 "1개당" 수익성.
//             무엇을 더 팔아야 하는지의 기준.
//   ② 실적  — 이 달에 실제로 무엇이 얼마를 남겼는지.
//
//  엑셀은 ① 을 갖고 있었지만 볼 자리가 없었다. 그래서 온라인 시향지가
//  4,000원에 원가 3,597원(공헌이익률 10.1%)인 채로 계속 팔렸다.
//  정렬해 보이면 이런 건 만들자마자 눈에 걸린다.
//
//  상품 이름 왼쪽에 **공식 상품 사진**을 붙인다 (product-image.ts).
//  「일반AI 10ml」와 「일반AI 50ml」는 이름이 한 글자 차이라 표를 훑을 때
//  자주 헷갈린다 — 투명 병과 검은 병은 안 헷갈린다. 사진이 없는 유형
//  (사쉐·뿌디·입장권)은 중립 아이콘으로 내려간다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  Boxes,
  Info,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Card,
  Disclosure,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterField,
  InlineNotice,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useSales } from "@/components/neander/sales/SalesProvider";
import {
  ProductCell,
  Rate,
  StoreBadge,
} from "@/components/neander/sales/ui";
import {
  availableMonths,
  buildProductPerf,
  productEconomics,
} from "@/lib/neander/sales/aggregate";
import {
  SALES_STORES,
  kindLabel,
  type SalesStore,
} from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";

type View = "structure" | "actual";

/** 이 밑이면 사실상 남지 않는다 — 경고로 띄울 기준 */
const THIN_MARGIN = 0.3;

/** 매장 고르기 — 목록은 SALES_STORES 하나만 본다 (화면마다 베끼면 매장이 늘 때 빠진다) */
const STORE_OPTIONS = [
  { value: "all" as const, label: "전체" },
  ...SALES_STORES.map((s) => ({ value: s.value, label: s.label })),
];

export default function SalesProductsPage() {
  const { lines, products, events, assumptions, loading, masterEmpty, error } = useSales();
  const months = useMemo(() => availableMonths(lines, events), [lines, events]);
  const [month, setMonth] = useState<string>("");
  const activeMonth = month || months[0] || "";
  const [view, setView] = useState<View>("structure");
  const [store, setStore] = useState<SalesStore | "all">("all");

  const econ = useMemo(
    () =>
      productEconomics(
        products.filter((p) => store === "all" || p.store === store),
        assumptions,
      ),
    [products, assumptions, store],
  );
  const perf = useMemo(
    () =>
      buildProductPerf(
        activeMonth,
        lines,
        products,
        assumptions,
        store === "all" ? undefined : { store },
      ),
    [activeMonth, lines, products, assumptions, store],
  );

  if (loading) return <LoadingState label="상품을 불러오는 중…" />;

  // 불러오지 못한 것과 아직 없는 것은 다르다 — 예전에는 둘 다 「상품이 없다」로 보였다
  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="상품 수익성" description="1개당 공헌이익과 이 달의 실적" />
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
        <PageHeader title="상품 수익성" description="1개당 공헌이익과 이 달의 실적" />
        <EmptyState
          icon={Boxes}
          title="상품 마스터가 없습니다"
          description="마스터를 적재하면 상품별 수익성이 나타납니다. 판매가·재료비를 고치는 곳은 상품 관리입니다."
          action={
            <Link
              href="/neander/sales/catalog"
              className="text-nd-body font-medium text-nd-accent-strong hover:underline"
            >
              상품 관리로 이동 →
            </Link>
          }
        />
      </PageShell>
    );
  }

  const thin = econ.filter((e) => (e.contributionRate ?? 1) < THIN_MARGIN);
  const laborNote =
    assumptions.laborMode === "fixed"
      ? "접객 인건비는 고정비로 처리해 제외(제작 인건비만 포함)"
      : "엑셀 재현 모드 — 접객 인건비 포함";

  return (
    <PageShell>
      <ToolbarPortal order={0}>
        <MonthStepper glass months={months} value={activeMonth} onChange={setMonth} />
      </ToolbarPortal>

      <PageHeader
        title="상품 수익성"
        description="무엇을 더 팔아야 하는지 — 1개당 공헌이익과 이 달의 실적."
        className="mb-3"
        meta={
          <span className="text-nd-caption text-nd-fg-2">
            상품 {econ.length.toLocaleString("ko-KR")}종
            {store !== "all" && ` · ${SALES_STORES.find((s) => s.value === store)?.label}`}
          </span>
        }
        actions={
          <Link href="/neander/sales/catalog">
            <span className="text-nd-body font-medium text-nd-accent-strong hover:underline">
              상품 관리 →
            </span>
          </Link>
        }
      />

      <BasisLine
        className="mb-4"
        items={[
          view === "structure" ? "판매 실적과 무관한 1개당 구조" : `${monthLabel(activeMonth)} 확정 판매만`,
          laborNote,
        ]}
      />

      <FilterBar className="mb-3">
        <FilterField label="보기" as="div">
          <SegmentedControl
            size="sm"
            ariaLabel="보기"
            value={view}
            onChange={(v) => setView(v as View)}
            options={[
              { value: "structure", label: "구조", hint: "1개당 수익성" },
              { value: "actual", label: "실적", hint: monthLabel(activeMonth) },
            ]}
          />
        </FilterField>
        <FilterField label="매장" as="div">
          <SegmentedControl
            size="sm"
            ariaLabel="매장"
            value={store}
            onChange={(v) => setStore(v as SalesStore | "all")}
            options={STORE_OPTIONS}
          />
        </FilterField>
      </FilterBar>

      {thin.length > 0 && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          공헌이익률이 {(THIN_MARGIN * 100).toFixed(0)}% 미만인 상품이 <b>{thin.length}종</b> 있습니다 —{" "}
          {thin
            .slice(0, 3)
            .map((e) => `${e.product.name} ${e.product.option} ${((e.contributionRate ?? 0) * 100).toFixed(1)}%`)
            .join(" · ")}
          {thin.length > 3 && ` 외 ${thin.length - 3}종`}. 팔아도 남지 않는 상품은 가격이나 원가를 고쳐야 합니다.
        </InlineNotice>
      )}

      {view === "structure" ? (
        <Card padding="none" className="mb-3 overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader
              title="1개당 수익성"
              hint="판매 실적과 무관한 구조 비교 · 공헌이익률 높은 순"
              action={<TableNote>단위: 원</TableNote>}
            />
          </div>
          <TableScroll maxHeight="70vh">
            <Table minWidth={1020} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">순위</Th>
                  <Th sticky="top">상품</Th>
                  <Th sticky="top">매장·유형</Th>
                  <Th sticky="top" align="right">판매가</Th>
                  <Th sticky="top" align="right">재료비</Th>
                  <Th sticky="top" align="right">인건비</Th>
                  <Th sticky="top" align="right">수수료</Th>
                  <Th sticky="top" align="right">공헌이익</Th>
                  <Th sticky="top" align="right" className="pr-5">공헌이익률</Th>
                </tr>
              </thead>
              <tbody>
                {econ.map((e, i) => (
                  <Tr key={e.product.id}>
                    <Td className="nd-num pl-5 text-nd-fg-3">{i + 1}</Td>
                    <Td>
                      <ProductCell product={e.product} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <StoreBadge store={e.product.store} size="sm" />
                        <span className="text-nd-micro text-nd-fg-3">{kindLabel(e.product.kind)}</span>
                      </span>
                    </Td>
                    <Td num><Money value={e.price} unit={false} /></Td>
                    <Td num muted><Money value={e.material} unit={false} muted /></Td>
                    <Td num muted><Money value={Math.round(e.labor)} unit={false} muted /></Td>
                    <Td num muted><Money value={e.fee} unit={false} muted /></Td>
                    <Td num className="font-semibold"><Money value={e.contribution} unit={false} /></Td>
                    <Td num className="pr-5">
                      <Rate value={e.contributionRate} tone="auto" />
                      {(e.contributionRate ?? 1) < THIN_MARGIN && (
                        <Badge tone="danger" size="sm" className="ml-1.5">
                          박함
                        </Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      ) : (
        <Card padding="none" className="mb-3 overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader
              title={`${monthLabel(activeMonth)} 실적`}
              hint="수량과 금액이 같은 모집단 · 공헌이익 큰 순"
              action={<TableNote>단위: 원</TableNote>}
            />
          </div>
          {perf.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="확정된 판매가 없습니다"
              description={
                <>
                  적재는 됐지만 상품이 정해지지 않았을 수 있습니다.{" "}
                  <Link
                    href="/neander/sales/review"
                    className="font-medium text-nd-accent-strong hover:underline"
                  >
                    검토 대기함 보기
                  </Link>
                </>
              }
              className="border-0"
            />
          ) : (
            <TableScroll maxHeight="70vh">
              <Table minWidth={980} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">상품</Th>
                    <Th sticky="top">매장</Th>
                    <Th sticky="top" align="right">수량</Th>
                    <Th sticky="top" align="right">매출</Th>
                    <Th sticky="top" align="right">재료비</Th>
                    <Th sticky="top" align="right">수수료</Th>
                    <Th sticky="top" align="right">공헌이익</Th>
                    <Th sticky="top" align="right">1개당</Th>
                    <Th sticky="top" align="right" className="pr-5">이익률</Th>
                  </tr>
                </thead>
                <tbody>
                  {perf.map((p) => (
                    <Tr key={p.product.id}>
                      <Td className="pl-5">
                        <ProductCell product={p.product} />
                      </Td>
                      <Td><StoreBadge store={p.product.store} size="sm" /></Td>
                      <Td num>{p.qty.toLocaleString("ko-KR")}</Td>
                      <Td num><Money value={p.revenue} unit={false} /></Td>
                      <Td num><Money value={p.material} unit={false} muted /></Td>
                      <Td num><Money value={p.fee} unit={false} muted /></Td>
                      <Td num className="font-semibold"><Money value={p.contribution} unit={false} /></Td>
                      <Td num><Money value={p.unitContribution} unit={false} /></Td>
                      <Td num className="pr-5"><Rate value={p.contributionRate} tone="auto" /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      )}

      {/* 계산 기준 — 매번 읽을 것은 아니지만 숫자를 의심할 때 반드시 필요하다 */}
      <Disclosure icon={Info} title="유의사항 및 계산 기준" description="공헌이익에 무엇이 들어가고 무엇이 빠지는가">
        <dl className="flex flex-col gap-2.5 text-nd-caption leading-relaxed">
          <div className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">구조</dt>
            <dd className="text-nd-fg-2">
              상품 마스터의 판매가·재료비로 계산한 1개당 값입니다. 이 달에 한 개도 안 팔린 상품도 나옵니다.
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">실적</dt>
            <dd className="text-nd-fg-2">
              상품이 정해진 판매 줄만 들어갑니다. 미확정 줄은{" "}
              <Link href="/neander/sales/review" className="font-medium text-nd-accent-strong hover:underline">
                검토 대기함
              </Link>
              에 있고, 확정할수록 이 표가 실제에 가까워집니다.
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">수수료</dt>
            <dd className="text-nd-fg-2">
              결제 경로 기준입니다 — 세트는 네이버예약 {(assumptions.fee.naverBooking * 100).toFixed(2)}%,
              나머지는 카드 {(assumptions.fee.card * 100).toFixed(2)}%.
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">인건비</dt>
            <dd className="text-nd-fg-2">{laborNote}.</dd>
          </div>
          <div className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3">
            <dt className="font-medium text-nd-fg">상품 사진</dt>
            <dd className="text-nd-fg-2">
              공식 사이트의 상품 유형별 사진입니다. 사쉐·피규어 디퓨저·입장권처럼 공식 사진이 없는 항목은
              중립 아이콘으로 둡니다 — 비슷한 다른 상품 사진으로 메우지 않습니다.
            </dd>
          </div>
        </dl>
      </Disclosure>
    </PageShell>
  );
}
