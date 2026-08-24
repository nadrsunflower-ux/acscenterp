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
  createGutterColumn,
  createSelectColumn,
  ColumnHead,
  type SelectOption,
} from "./sheetCells";
import { useSheetLayout, DEFAULT_ROW_HEIGHT } from "./useSheetLayout";
import { ColumnMenu } from "./ColumnMenu";
import {
  isActiveFilter,
  type ColumnFilter,
  type FilterKey,
  type FilterOption,
  type Filters,
} from "@/lib/neander/finance/sheetFilter";

type Col = Column<FinTransaction, any, any>;

/**
 * 열 기본 폭. 사용자가 경계를 끌면 그 열만 이 값을 벗어나 고정된다
 * (useSheetLayout 이 브라우저에 남긴다). 더블클릭하면 여기로 돌아온다.
 */
const DEFAULT_BASIS: Record<SortKey, number> = {
  date: 112,
  txType: 104,
  last4: 150,
  vendor: 180,
  bizMajor: 104,
  bizMinor: 110,
  acctMajor: 130,
  acctMid: 140,
  acctMinor: 160,
  gross: 110,
  adjust: 100,
  net: 110,
  site: 110,
  note: 200,
  status: 96,
};

/** 남는 폭을 나눠 갖는 열 → 값은 그때 지켜야 할 최소 폭 */
const FLEX_MIN: Partial<Record<SortKey, number>> = { vendor: 140, note: 120 };

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

  const { layout, setWidth, clearWidth, setRowHeight, reset, customized } = useSheetLayout();

  const baseColumns = useMemo<Col[]>(() => {
    const header = (label: string, key: SortKey) => (
      <ColumnHead
        label={label}
        dir={sort?.key === key ? sort.dir : null}
        filtered={isActiveFilter(filters[key])}
        onSort={() => onSort(key)}
        onOpenMenu={(anchor) => setMenu({ key, label, anchor })}
        onResize={(px) => setWidth(key, px)}
        onResetWidth={() => clearWidth(key)}
      />
    );

    /** 기본 폭. 사용자가 정한 폭은 이 memo 밖에서 얹는다 (아래 주석 참고) */
    const size = (key: SortKey) => {
      const min = FLEX_MIN[key];
      return min === undefined
        ? { id: key, basis: DEFAULT_BASIS[key], grow: 0, shrink: 0, minWidth: 0 }
        : { id: key, basis: DEFAULT_BASIS[key], grow: 1, shrink: 1, minWidth: min };
    };

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
        ...size("date"),
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
        ...size("txType"),
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
        ...size("last4"),
      },
      {
        ...keyColumn<FinTransaction, "vendor">("vendor", optionalText),
        title: header("거래처", "vendor"),
        ...size("vendor"),
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
        ...size("bizMajor"),
      },
      {
        ...keyColumn<FinTransaction, "bizMinor">("bizMinor", optionalText),
        title: header("사업소분류", "bizMinor"),
        ...size("bizMinor"),
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
        ...size("acctMajor"),
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
        ...size("acctMid"),
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
        ...size("acctMinor"),
      },
      {
        ...keyColumn<FinTransaction, "gross">("gross", amount),
        ...invalid("gross"),
        title: header("원금액", "gross"),
        ...size("gross"),
      },
      {
        ...keyColumn<FinTransaction, "adjust">("adjust", amount),
        ...invalid("adjust"),
        title: header("조정금액", "adjust"),
        ...size("adjust"),
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
        ...size("net"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.site ?? "",
          set: (t, v) => ({ ...t, site: or(v) }),
          options: () => siteOptions,
          placeholder: "(기본)",
        }),
        title: header("사업장", "site"),
        ...size("site"),
      },
      {
        ...keyColumn<FinTransaction, "note">("note", optionalText),
        title: header("비고", "note"),
        ...size("note"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.status ?? "",
          set: (t, v) => ({ ...t, status: (v || "confirmed") as FinTransaction["status"] }),
          options: () => STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
        }),
        ...invalid("status"),
        title: header("상태", "status"),
        ...size("status"),
      },
    ];
  }, [accounts, paymentMethods, sites, issues, sort, onSort, filters, setWidth, clearWidth]);

  /**
   * 사용자가 정한 폭을 **얹기만** 한다. 폭을 위 memo 안에서 읽으면 드래그
   * 한 프레임마다 열 정의가 통째로 새로 만들어지고, 그러면 셀 component
   * 의 함수 신원이 바뀌어 React 가 화면의 셀 300개를 매 프레임 다시
   * 마운트한다 (편집 중이던 셀도 날아간다). 여기서는 기존 객체를 펼쳐
   * 복사하므로 component 참조가 그대로 유지된다.
   *
   * 폭을 정하면 grow 를 0 으로 고정한다 — 남겨두면 남는 공간을 받아
   * 끈 자리보다 넓어져서, 끌었는데 다른 값이 되는 표가 된다.
   */
  const columns = useMemo<Col[]>(
    () =>
      baseColumns.map((c) => {
        const w = layout.widths[String(c.id)];
        return w === undefined ? c : { ...c, basis: w, grow: 0, shrink: 0, minWidth: w };
      }),
    [baseColumns, layout.widths],
  );

  // 행 번호 칸 — 아래 경계가 행 높이 손잡이, 왼쪽 위 모서리가 초기화 버튼
  const gutterColumn = useMemo(
    () =>
      createGutterColumn<FinTransaction>({
        onResizeRow: setRowHeight,
        onResetRow: () => setRowHeight(DEFAULT_ROW_HEIGHT),
        onResetAll: reset,
        canReset: customized,
      }),
    [setRowHeight, reset, customized],
  );

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
        gutterColumn={gutterColumn}
        stickyRightColumn={detailColumn}
        rowKey="id"
        height={height}
        rowHeight={layout.rowHeight}
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
