"use client";

// ============================================================
//  원장 시트 — 거래를 스프레드시트처럼 셀 단위로 고친다
// ------------------------------------------------------------
//  react-datasheet-grid(MIT) 위에 원장 열을 정의한다. 여기서는 "어떤
//  열이 어떤 값을 어떻게 읽고 쓰는가"만 다루고, 초안(draft)·저장은
//  페이지가 가진다 — 이 컴포넌트는 value/onChange 로 제어되는 표다.
//
//  열 규칙은 TransactionEditor(모달)와 같다:
//   - 거래유형을 바꾸면 계정 3단을 비운다 (후보가 통째로 달라진다)
//   - 계정 상위를 바꾸면 하위를 비운다
//   - 순금액은 입력받지 않는다 (원금액 − 조정금액)
// ============================================================

import "react-datasheet-grid/dist/style.css";
import "./ledger-sheet.css";

import { useCallback, useMemo, useState, type Ref } from "react";
import {
  DataSheetGrid,
  createTextColumn,
  keyColumn,
  type Column,
  type DataSheetGridRef,
} from "react-datasheet-grid";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import {
  STATUS_LABEL,
  TX_TYPES,
  formatSigned,
  netAmount,
  type FinTransaction,
  type TxType,
} from "@/lib/neander/finance/types";
import {
  BIZ_MAJORS,
  STATUSES,
  isNewRow,
  normalizeDateInput,
  parseAmountInput,
  type RowIssue,
  type SortKey,
  type SortSpec,
} from "@/lib/neander/finance/sheet";
import {
  KoAddRows,
  KoContextMenu,
  createActionColumn,
  createDerivedColumn,
  createSelectColumn,
  ColumnHead,
  type SelectOption,
} from "./sheetCells";
import { ColumnMenu } from "./ColumnMenu";
import {
  isActiveFilter,
  type ColumnFilter,
  type FilterKey,
  type FilterOption,
  type Filters,
} from "@/lib/neander/finance/sheetFilter";

type Col = Column<FinTransaction, any, any>;

const uniq = (xs: (string | undefined)[]) =>
  [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko"));
const asOptions = (xs: string[]): SelectOption[] => xs.map((v) => ({ value: v, label: v }));

// ---- 값 하나짜리 열 (keyColumn 으로 감싼다) ---------------------

/**
 * 빈 문자열은 undefined 로 — 저장 규칙(빈 값 = 필드 비우기)과 맞춘다.
 *
 * continuousUpdates:false — 타자 한 글자마다가 아니라 셀을 떠날 때 값이
 * 확정된다. 실행취소가 "글자 단위"가 아니라 "셀 단위"가 되고, 편집 중
 * Esc 를 누르면 그 셀의 수정이 취소된다 (엑셀·구글 시트와 같다).
 */
const optionalText = createTextColumn<string | undefined>({
  continuousUpdates: false,
  parseUserInput: (v) => v.trim() || undefined,
  parsePastedValue: (v) => v.replace(/[\n\r]+/g, " ").trim() || undefined,
  formatBlurredInput: (v) => v ?? "",
  formatInputOnFocus: (v) => v ?? "",
  formatForCopy: (v) => v ?? "",
  deletedValue: undefined,
});

const dateText = createTextColumn<string>({
  continuousUpdates: false,
  placeholder: "YYYY-MM-DD",
  parseUserInput: normalizeDateInput,
  parsePastedValue: normalizeDateInput,
  formatBlurredInput: (v) => v ?? "",
  formatInputOnFocus: (v) => v ?? "",
  formatForCopy: (v) => v ?? "",
  deletedValue: "",
});

const amount = createTextColumn<number>({
  continuousUpdates: false,
  alignRight: true,
  parseUserInput: parseAmountInput,
  parsePastedValue: parseAmountInput,
  // 읽을 때는 천 단위 콤마, 편집할 때는 맨 숫자 — 엑셀과 같은 느낌
  formatBlurredInput: (n) => (Number.isFinite(n) ? formatSigned(n) : "⚠"),
  formatInputOnFocus: (n) => (Number.isFinite(n) ? String(n) : ""),
  formatForCopy: (n) => (Number.isFinite(n) ? String(n) : ""),
  deletedValue: 0,
});

export function LedgerSheet({
  rows,
  onChange,
  accounts,
  paymentMethods,
  sites,
  issues,
  dirtyIds,
  createRow,
  onDetail,
  sort,
  onSort,
  filters,
  onFilterChange,
  optionsFor,
  height = 640,
  gridRef,
}: {
  rows: FinTransaction[];
  onChange: (rows: FinTransaction[]) => void;
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  /** 사업장 후보 (거래에 등장한 값 + 계좌 마스터 기본값) */
  sites: string[];
  /** 행 id → 검증 문제 (초안 행만 들어 있다) */
  issues: Map<string, RowIssue[]>;
  /** 원본과 달라진 행 id */
  dirtyIds: Set<string>;
  createRow: () => FinTransaction;
  onDetail: (row: FinTransaction) => void;
  /** 현재 정렬 기준 (null = 서버 순서 = 거래일 내림차순) */
  sort: SortSpec | null;
  /** dir 생략 = 순환(오름→내림→해제), 지정 = 그 방향으로 고정 */
  onSort: (key: SortKey, dir?: "asc" | "desc" | null) => void;
  /** 열별 필터 */
  filters: Filters;
  onFilterChange: (key: FilterKey, next: ColumnFilter | null) => void;
  /** 드롭다운에 띄울 후보값 — 다른 열 필터를 반영한다 (페이지가 계산) */
  optionsFor: (key: FilterKey) => FilterOption[];
  height?: number;
  gridRef?: Ref<DataSheetGridRef>;
}) {
  // 열린 드롭다운. anchor 는 머리글 버튼의 화면 좌표.
  const [menu, setMenu] = useState<{ key: FilterKey; label: string; anchor: DOMRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const columns = useMemo<Col[]>(() => {
    const header = (label: string, key: SortKey) => (
      <ColumnHead
        label={label}
        dir={sort?.key === key ? sort.dir : null}
        filtered={isActiveFilter(filters[key])}
        onSort={() => onSort(key)}
        onOpenMenu={(anchor) => setMenu({ key, label, anchor })}
      />
    );

    const invalid = (field: RowIssue["field"]) => ({
      cellClassName: ({ rowData }: { rowData: FinTransaction }) =>
        issues.get(rowData.id)?.some((i) => i.field === field) ? "ledger-cell-invalid" : undefined,
    });

    const pmOptions: SelectOption[] = paymentMethods.map((p) => ({
      value: p.last4,
      label: `${p.last4} · ${p.alias}`,
    }));
    const siteOptions = asOptions(uniq([...sites, ...paymentMethods.map((p) => p.site)]));

    // 계정 후보 — 거래유형 → 대 → 중 → 소 순으로 좁힌다
    const pool = (t: FinTransaction) => accounts.filter((a) => a.txType === t.txType);
    const majors = (t: FinTransaction) => asOptions(uniq(pool(t).map((a) => a.major)));
    const mids = (t: FinTransaction) =>
      asOptions(uniq(pool(t).filter((a) => a.major === t.acctMajor).map((a) => a.mid)));
    const minors = (t: FinTransaction) =>
      asOptions(
        uniq(
          pool(t)
            .filter((a) => a.major === t.acctMajor && a.mid === t.acctMid)
            .map((a) => a.minor),
        ),
      );
    const or = (v: string) => v || undefined;

    return [
      {
        ...keyColumn<FinTransaction, "date">("date", dateText),
        ...invalid("date"),
        title: header("거래일", "date"),
        basis: 112,
        grow: 0,
        shrink: 0,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.txType ?? "",
          set: (t, v) =>
            v === t.txType
              ? t
              : { ...t, txType: v as TxType, acctMajor: undefined, acctMid: undefined, acctMinor: undefined },
          options: () => asOptions([...TX_TYPES]),
        }),
        ...invalid("txType"),
        title: header("유형", "txType"),
        basis: 104,
        grow: 0,
        shrink: 0,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.last4 ?? "",
          set: (t, v) => ({ ...t, last4: or(v) }),
          options: () => pmOptions,
          placeholder: "(없음)",
        }),
        ...invalid("last4"),
        title: header("계좌/카번", "last4"),
        basis: 150,
        grow: 0,
        shrink: 0,
      },
      {
        ...keyColumn<FinTransaction, "vendor">("vendor", optionalText),
        title: header("거래처", "vendor"),
        basis: 180,
        grow: 1,
        minWidth: 140,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.bizMajor ?? "",
          set: (t, v) => ({ ...t, bizMajor: or(v) }),
          options: () => asOptions([...BIZ_MAJORS]),
          placeholder: "(미정)",
        }),
        ...invalid("bizMajor"),
        title: header("사업대분류", "bizMajor"),
        basis: 104,
        grow: 0,
        shrink: 0,
      },
      {
        ...keyColumn<FinTransaction, "bizMinor">("bizMinor", optionalText),
        title: header("사업소분류", "bizMinor"),
        basis: 110,
        grow: 0,
        shrink: 0,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.acctMajor ?? "",
          set: (t, v) =>
            v === (t.acctMajor ?? "")
              ? t
              : { ...t, acctMajor: or(v), acctMid: undefined, acctMinor: undefined },
          options: majors,
          placeholder: "대분류",
        }),
        ...invalid("acctMajor"),
        title: header("계정대분류", "acctMajor"),
        basis: 130,
        grow: 0,
        shrink: 0,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.acctMid ?? "",
          set: (t, v) =>
            v === (t.acctMid ?? "") ? t : { ...t, acctMid: or(v), acctMinor: undefined },
          options: mids,
          placeholder: "중분류",
        }),
        ...invalid("acctMid"),
        title: header("계정중분류", "acctMid"),
        basis: 140,
        grow: 0,
        shrink: 0,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.acctMinor ?? "",
          set: (t, v) => ({ ...t, acctMinor: or(v) }),
          options: minors,
          placeholder: "소분류",
        }),
        ...invalid("acctMinor"),
        title: header("계정소분류", "acctMinor"),
        basis: 160,
        grow: 0,
        shrink: 0,
      },
      {
        ...keyColumn<FinTransaction, "gross">("gross", amount),
        ...invalid("gross"),
        title: header("원금액", "gross"),
        basis: 110,
        grow: 0,
        shrink: 0,
      },
      {
        ...keyColumn<FinTransaction, "adjust">("adjust", amount),
        ...invalid("adjust"),
        title: header("조정금액", "adjust"),
        basis: 100,
        grow: 0,
        shrink: 0,
      },
      {
        ...createDerivedColumn<FinTransaction>({
          render: (t) => {
            const n = netAmount(t);
            return <span className={n < 0 ? "text-rose-600" : undefined}>{formatSigned(n)}</span>;
          },
          copy: (t) => netAmount(t),
          alignRight: true,
        }),
        title: header("순금액", "net"),
        basis: 110,
        grow: 0,
        shrink: 0,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.site ?? "",
          set: (t, v) => ({ ...t, site: or(v) }),
          options: () => siteOptions,
          placeholder: "(기본)",
        }),
        title: header("사업장", "site"),
        basis: 110,
        grow: 0,
        shrink: 0,
      },
      {
        ...keyColumn<FinTransaction, "note">("note", optionalText),
        title: header("비고", "note"),
        basis: 200,
        grow: 1,
        minWidth: 120,
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.status ?? "",
          set: (t, v) => ({ ...t, status: (v || "confirmed") as FinTransaction["status"] }),
          options: () => STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
        }),
        ...invalid("status"),
        title: header("상태", "status"),
        basis: 96,
        grow: 0,
        shrink: 0,
      },
    ];
  }, [accounts, paymentMethods, sites, issues, sort, onSort, filters]);

  const detailColumn = useMemo(
    () =>
      createActionColumn<FinTransaction>({
        label: "⋯",
        title: "전체 항목 보기",
        onClick: onDetail,
      }),
    [onDetail],
  );

  return (
    <div className="ledger-sheet">
      <DataSheetGrid<FinTransaction>
        ref={gridRef}
        value={rows}
        onChange={(next) => onChange(next)}
        columns={columns}
        stickyRightColumn={detailColumn}
        rowKey="id"
        height={height}
        rowHeight={34}
        headerRowHeight={36}
        createRow={createRow}
        // 복제한 행은 새 거래다 — 원본 id·적재 이력을 물려받으면 안 된다
        duplicateRow={({ rowData }) => ({
          ...rowData,
          id: createRow().id,
          createdAt: 0,
          importBatchId: undefined,
          dedupHash: "",
        })}
        rowClassName={({ rowData }) =>
          isNewRow(rowData)
            ? "ledger-row-new"
            : dirtyIds.has(rowData.id)
              ? "ledger-row-dirty"
              : undefined
        }
        addRowsComponent={KoAddRows}
        contextMenuComponent={KoContextMenu}
      />

      {menu && (
        <ColumnMenu
          columnKey={menu.key}
          label={menu.label}
          anchor={menu.anchor}
          sortDir={sort?.key === menu.key ? sort.dir : null}
          onSort={(dir) => {
            // 메뉴에서는 방향을 직접 고른다 (머리글 이름 클릭의 순환과 다르다)
            const current = sort?.key === menu.key ? sort.dir : null;
            if (dir === null || dir === current) onSort(menu.key, null);
            else onSort(menu.key, dir);
          }}
          filter={filters[menu.key]}
          options={optionsFor(menu.key)}
          onFilterChange={(next) => onFilterChange(menu.key, next)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
