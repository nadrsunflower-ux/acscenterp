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

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { Ellipsis } from "lucide-react";
import {
  // ⚠️ 이 라이브러리에서 `DataSheetGrid` 라는 이름으로 나오는 것은 실제로는
  //    StaticDataSheetGrid 다. 그 안은 이렇게 생겼다:
  //
  //      const [staticProps] = useState({ columns, gutterColumn, rowClassName, … })
  //
  //    useState 의 초기값이라 **첫 렌더의 값을 영원히 붙잡는다.** 그래서
  //    나중에 columns 를 바꿔도 표에 닿지 않는다. rowHeight 만 숫자일 때
  //    통과시키는 예외가 있어서, 행 높이는 되는데 열 폭은 안 되는 기묘한
  //    증상이 나왔다.
  //
  //    이걸 모르고 쓰는 동안 조용히 멈춰 있던 것들 — 정렬 화살표, 필터
  //    깔때기, 오류 셀 빨간 표시(cellClassName), 저장 전 행 색칠
  //    (rowClassName) — 이 전부 마운트 시점 값에 묶여 있었다.
  //    DynamicDataSheetGrid 가 매 렌더 값을 그대로 쓰는 쪽이다.
  DynamicDataSheetGrid,
  keyColumn,
  type Column,
  type DataSheetGridRef,
} from "react-datasheet-grid";
import type {
  FinAccountDoc,
  FinLedgerColumnDoc,
  FinPaymentMethodDoc,
} from "@/lib/neander/finance/db-types";
import {
  STATUS_LABEL,
  TX_TYPES,
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
  createExtraColumn,
  createDerivedColumn,
  createGutterColumn,
  createSelectColumn,
  createSheetTextColumn,
  ColumnHead,
  type SelectOption,
} from "./sheetCells";
import {
  DEFAULT_ROW_HEIGHT,
  type SheetLayoutHandle,
} from "./useSheetLayout";
import { ColumnMenu } from "./ColumnMenu";
import {
  isActiveFilter,
  type ColumnFilter,
  type FilterKey,
  type FilterOption,
  type Filters,
} from "@/lib/neander/finance/sheetFilter";
import {
  formatSigned,
} from "@/lib/neander/format";

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

/** 머리글 이름 — 머리글은 셀 정의와 따로 만든다 (아래 두 층 구조 참고) */
const LABEL: Record<SortKey, string> = {
  date: "거래일",
  txType: "유형",
  last4: "계좌/카번",
  vendor: "거래처",
  bizMajor: "사업대분류",
  bizMinor: "사업소분류",
  acctMajor: "계정대분류",
  acctMid: "계정중분류",
  acctMinor: "계정소분류",
  gross: "원금액",
  adjust: "조정금액",
  net: "순금액",
  site: "사업장",
  note: "비고",
  status: "상태",
};

/**
 * 열 관리(툴바)가 쓰는 순서 있는 목록 — 위 LABEL 의 나열 순서가 화면 순서다.
 */
export const LEDGER_COLUMNS: { key: SortKey; label: string }[] = (Object.keys(LABEL) as SortKey[]).map(
  (key) => ({ key, label: LABEL[key] }),
);

/** 검증 오류를 빨갛게 칠하는 열. 오류 필드 이름이 열 키와 같다. */
const INVALID_KEYS = new Set<SortKey>(["date", "txType", "last4", "bizMajor", "acctMajor", "acctMid", "acctMinor", "gross", "adjust", "status"]);

/** 아래 "행 추가" 바 높이 — 시트 높이에서 빼야 화면을 넘지 않는다 */
const ADD_ROW_BAR = 44;

/** 남는 폭을 나눠 갖는 열 → 값은 그때 지켜야 할 최소 폭 */
const FLEX_MIN: Partial<Record<SortKey, number>> = { vendor: 140, note: 120 };

const uniq = (xs: (string | undefined)[]) =>
  [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko"));
const asOptions = (xs: string[]): SelectOption[] => xs.map((v) => ({ value: v, label: v }));

// ---- 값 하나짜리 열 (keyColumn 으로 감싼다) ---------------------

/**
 * 빈 문자열은 undefined 로 — 저장 규칙(빈 값 = 필드 비우기)과 맞춘다.
 *
 * 값은 셀을 떠날 때 확정된다(타자 한 글자마다가 아니라). 실행취소가
 * "글자 단위"가 아니라 "셀 단위"가 되고, 편집 중 Esc 를 누르면 그 셀의
 * 수정이 취소된다 — 엑셀·구글 시트와 같다.
 *
 * 내장 createTextColumn 이 아니라 우리 팩토리를 쓰는 이유는 한글 때문이다.
 * 내장 셀은 편집이 시작되는 순간 입력칸으로 포커스를 옮기는데, 그 사이에
 * IME 조합이 끊겨 「가」가 「ㄱㅏ」로 들어간다 (sheetCells 주석 참고).
 */
const optionalText = createSheetTextColumn<string | undefined>({
  parse: (v) => v.trim() || undefined,
  parsePasted: (v) => v.replace(/[\n\r]+/g, " ").trim() || undefined,
  formatBlurred: (v) => v ?? "",
  formatEditing: (v) => v ?? "",
  deletedValue: undefined,
});

const dateText = createSheetTextColumn<string>({
  placeholder: "YYYY-MM-DD",
  parse: normalizeDateInput,
  parsePasted: normalizeDateInput,
  formatBlurred: (v) => v ?? "",
  formatEditing: (v) => v ?? "",
  deletedValue: "",
});

const amount = createSheetTextColumn<number>({
  alignRight: true,
  parse: parseAmountInput,
  parsePasted: parseAmountInput,
  // 읽을 때는 천 단위 콤마, 편집할 때는 맨 숫자 — 엑셀과 같은 느낌
  formatBlurred: (n) => (Number.isFinite(n) ? formatSigned(n) : "⚠"),
  formatEditing: (n) => (Number.isFinite(n) ? String(n) : ""),
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
  sheet,
  ledgerColumns,
  onSelectionChange,
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
  /** 시트에 쓸 수 있는 세로 공간(화면 픽셀). 배율·행추가바 보정은 여기서 한다 */
  height?: number;
  gridRef?: Ref<DataSheetGridRef>;
  /** 열 너비·행 높이·배율·감춘 열. 툴바가 만지므로 페이지가 들고 있다 */
  sheet: SheetLayoutHandle;
  /** 사람이 덧붙인 열 */
  ledgerColumns?: FinLedgerColumnDoc[];
  /**
   * 고른 범위 — 툴바의 행·열 추가/삭제가 이걸 보고 동작한다.
   *
   * `allColumns` 는 그 사각형이 **모든 열**을 덮는지다. 행 선택인지 열
   * 선택인지를 가르는 유일한 단서라 반드시 함께 넘긴다 (아래 notifySelection).
   */
  onSelectionChange?: (
    sel: { from: number; to: number; colId?: string; allColumns: boolean } | null,
  ) => void;
}) {
  // 열린 드롭다운. anchor 는 머리글 버튼의 화면 좌표.
  const [menu, setMenu] = useState<{ key: FilterKey; label: string; anchor: DOMRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const { layout, setWidth, clearWidth, setRowHeight, setColumnHidden, reset, customized } = sheet;

  // 배율은 드래그가 시작될 때의 값을 읽어야 한다. 값으로 넘기면 손잡이가
  // 배율이 바뀔 때마다 새로 만들어진다.
  const zoomRef = useRef(layout.zoom);
  zoomRef.current = layout.zoom;
  const scale = useCallback(() => zoomRef.current, []);

  /**
   * ① 셀 정의. 마스터가 바뀔 때만 다시 만든다.
   *
   * 여기서 머리글(정렬·필터 상태)이나 오류 표시(issues)를 함께 만들면,
   * 글자 하나 고칠 때마다 issues 가 새로 생기면서 열 정의가 통째로 다시
   * 만들어지고 — component 의 함수 신원이 바뀌어 — 화면의 셀 수백 개가
   * 다시 마운트된다. 편집 중이던 셀도 날아간다. 그래서 층을 가른다.
   */
  const cellColumns = useMemo<Col[]>(() => {
    /** 기본 폭. 사용자가 정한 폭은 이 memo 밖에서 얹는다 (아래 주석 참고) */
    const size = (key: SortKey) => {
      const min = FLEX_MIN[key];
      return min === undefined
        ? { id: key, basis: DEFAULT_BASIS[key], grow: 0, shrink: 0, minWidth: 0 }
        : { id: key, basis: DEFAULT_BASIS[key], grow: 1, shrink: 1, minWidth: min };
    };

    const pmOptions: SelectOption[] = paymentMethods.map((p) => ({
      value: p.last4,
      label: `${p.last4} · ${p.alias}`,
    }));
    const siteOptions = asOptions(uniq([...sites, ...paymentMethods.map((p) => p.site)]));

    // 계정 후보 — 거래유형 → 대 → 중 → 소 순으로 좁힌다.
    // 은퇴 계정(active:false)은 빼되, 그 행이 이미 들고 있는 계정은 남긴다.
    const pool = (t: FinTransaction) =>
      accounts.filter(
        (a) =>
          a.txType === t.txType &&
          (a.active !== false ||
            (a.major === t.acctMajor && a.mid === t.acctMid && a.minor === t.acctMinor)),
      );
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
        ...size("txType"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.last4 ?? "",
          set: (t, v) => ({ ...t, last4: or(v) }),
          options: () => pmOptions,
          placeholder: "(없음)",
        }),
        ...size("last4"),
      },
      {
        ...keyColumn<FinTransaction, "vendor">("vendor", optionalText),
        ...size("vendor"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.bizMajor ?? "",
          set: (t, v) => ({ ...t, bizMajor: or(v) }),
          options: () => asOptions([...BIZ_MAJORS]),
          placeholder: "(미정)",
        }),
        ...size("bizMajor"),
      },
      {
        ...keyColumn<FinTransaction, "bizMinor">("bizMinor", optionalText),
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
        ...size("acctMid"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.acctMinor ?? "",
          set: (t, v) => ({ ...t, acctMinor: or(v) }),
          options: minors,
          placeholder: "소분류",
        }),
        ...size("acctMinor"),
      },
      {
        ...keyColumn<FinTransaction, "gross">("gross", amount),
        ...size("gross"),
      },
      {
        ...keyColumn<FinTransaction, "adjust">("adjust", amount),
        ...size("adjust"),
      },
      {
        ...createDerivedColumn<FinTransaction>({
          render: (t) => {
            const n = netAmount(t);
            return <span className={n < 0 ? "text-nd-danger-text" : undefined}>{formatSigned(n)}</span>;
          },
          copy: (t) => netAmount(t),
          alignRight: true,
        }),
        ...size("net"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.site ?? "",
          set: (t, v) => ({ ...t, site: or(v) }),
          options: () => siteOptions,
          placeholder: "(기본)",
        }),
        ...size("site"),
      },
      {
        ...keyColumn<FinTransaction, "note">("note", optionalText),
        ...size("note"),
      },
      {
        ...createSelectColumn<FinTransaction>({
          get: (t) => t.status ?? "",
          set: (t, v) => ({ ...t, status: (v || "confirmed") as FinTransaction["status"] }),
          options: () => STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
        }),
        ...size("status"),
      },
    ];
  }, [accounts, paymentMethods, sites]);

  /**
   * ② 머리글 · 오류 표시 · 사용자가 정한 폭을 **얹기만** 한다.
   *
   * 기존 객체를 펼쳐 복사하므로 component 참조가 그대로 유지된다 — 위
   * 주석의 재마운트가 일어나지 않는다.
   *
   * 폭을 정하면 grow 를 0 으로 고정한다. 남겨두면 남는 공간을 받아 끈
   * 자리보다 넓어져서, 끌었는데 다른 값이 되는 표가 된다.
   */
  const hiddenSet = useMemo(() => new Set(layout.hidden), [layout.hidden]);

  const fixedColumns = useMemo<Col[]>(
    () =>
      // 감춘 열은 그리지 않는다. 값은 그대로 남아 있고 저장·집계에도 영향이 없다.
      cellColumns
        .filter((c) => !hiddenSet.has(String(c.id)))
        .map((c) => {
        const key = String(c.id) as SortKey;
        const label = LABEL[key] ?? key;
        const w = layout.widths[key];
        return {
          ...c,
          title: (
            <ColumnHead
              label={label}
              dir={sort?.key === key ? sort.dir : null}
              filtered={isActiveFilter(filters[key])}
              onSort={() => onSort(key)}
              onOpenMenu={(anchor) => setMenu({ key, label, anchor })}
              onResize={(px) => setWidth(key, px)}
              onResetWidth={() => clearWidth(key)}
              scale={scale}
            />
          ),
          ...(INVALID_KEYS.has(key)
            ? {
                cellClassName: ({ rowData }: { rowData: FinTransaction }) =>
                  issues.get(rowData.id)?.some((i) => i.field === key)
                    ? "ledger-cell-invalid"
                    : undefined,
              }
            : null),
          ...(w === undefined ? null : { basis: w, grow: 0, shrink: 0, minWidth: w }),
        };
      }),
    [cellColumns, hiddenSet, layout.widths, sort, filters, issues, onSort, setWidth, clearWidth, scale],
  );

  /**
   * 사람이 덧붙인 열을 제자리에 꽂는다.
   *
   * `before` 가 가리키는 고정 열 **바로 왼쪽**에 들어간다. 그 열이 감춰졌거나
   * 없으면 맨 오른쪽으로 간다 — 열이 통째로 사라지는 것보다 낫다.
   * 정렬·필터는 걸지 않는다(집계가 보지 않는 메모 칸이다).
   */
  const columns = useMemo<Col[]>(() => {
    const list = ledgerColumns ?? [];
    if (list.length === 0) return fixedColumns;

    const build = (lc: FinLedgerColumnDoc): Col => {
      const id = `x:${lc.id}`;
      const w = layout.widths[id];
      return {
        ...(createExtraColumn<FinTransaction>(lc.id, optionalText as never) as Col),
        title: (
          <ColumnHead
            label={lc.label}
            dir={null}
            filtered={false}
            sortable={false}
            onSort={() => undefined}
            onOpenMenu={() => undefined}
            onResize={(px) => setWidth(id, px)}
            onResetWidth={() => clearWidth(id)}
            scale={scale}
          />
        ),
        ...(w === undefined
          ? { basis: 150, grow: 0, shrink: 0, minWidth: 110 }
          : { basis: w, grow: 0, shrink: 0, minWidth: w }),
      };
    };

    const byBefore = new Map<string, Col[]>();
    const tail: Col[] = [];
    const shown = new Set(fixedColumns.map((c) => String(c.id)));
    list.forEach((lc) => {
      const col = build(lc);
      if (lc.before && shown.has(lc.before)) {
        const arr = byBefore.get(lc.before) ?? [];
        arr.push(col);
        byBefore.set(lc.before, arr);
      } else tail.push(col);
    });

    const out: Col[] = [];
    fixedColumns.forEach((c) => {
      byBefore.get(String(c.id))?.forEach((x) => out.push(x));
      out.push(c);
    });
    return out.concat(tail);
  }, [fixedColumns, ledgerColumns, layout.widths, setWidth, clearWidth, scale]);

  // 행 번호 칸 — 아래 경계가 행 높이 손잡이, 왼쪽 위 모서리가 초기화 버튼
  const gutterColumn = useMemo(
    () =>
      createGutterColumn<FinTransaction>({
        onResizeRow: setRowHeight,
        onResetRow: () => setRowHeight(DEFAULT_ROW_HEIGHT),
        onResetAll: reset,
        canReset: customized,
        scale,
      }),
    [setRowHeight, reset, customized, scale],
  );

  const detailColumn = useMemo(
    () =>
      createActionColumn<FinTransaction>({
        label: "전체 항목",
        title: "전체 항목 보기",
        icon: Ellipsis,
        onClick: onDetail,
      }),
    [onDetail],
  );

  /**
   * 확대/축소는 transform 이 아니라 CSS `zoom` 이다. transform 은 레이아웃을
   * 바꾸지 않아서, 줄여도 열이 더 보이지 않고 rdg 가 재는 컨테이너 폭도
   * 그대로다(가상 스크롤이 어긋난다). zoom 은 자식이 본래 픽셀로 배치된
   * 뒤 전체가 축척되므로, 80% 로 줄이면 같은 자리에 열이 25% 더 들어온다.
   *
   * 대신 세로 공간을 직접 보정해야 한다. 부모가 준 높이는 화면 픽셀이고
   * 시트 안쪽은 본래 픽셀이라, 나누지 않으면 80% 에서 아래 20% 가 빈다.
   */
  /**
   * 열 개수를 콜백 안에서 읽기 위한 통로.
   *
   * notifySelection 의 의존성에 넣으면 열을 하나 감추거나 더할 때마다 콜백
   * 정체성이 바뀌어 아래 경고에 걸린다. 렌더 중에 넣어 두면 통지가 오는
   * 시점에는 언제나 최신이다.
   */
  const colCountRef = useRef(columns.length);
  colCountRef.current = columns.length;

  /**
   * 선택 통지. 콜백 정체성이 매 렌더 바뀌면 그리드가 그때마다 다시 알려 오고,
   * 받는 쪽이 새 객체로 상태를 바꾸면 렌더 → 통지 → 렌더 로 끝없이 돈다.
   * (실제로 그렇게 화면이 멎었다.) 그래서 여기서 한 번 고정한다.
   *
   * ⚠️ 열 범위(allColumns)를 반드시 함께 넘긴다. 시트는 **머리글을 눌러 열을
   *    통째로 고른 것**도 "1행부터 끝행까지" 라는 똑같은 사각형으로 알려 준다.
   *    행만 보면 「－ 행」 이 장부 전체를 고른 것으로 읽어, 열 하나 지우려다
   *    11,320행 삭제가 오클릭 한 번 거리에 놓였다 — 실제로 그랬다.
   *    행번호를 눌러·끌어 고른 행 선택은 언제나 모든 열을 덮으므로 이것으로 가른다.
   */
  const notifySelection = useCallback(
    ({
      selection,
    }: {
      selection: {
        min: { row: number; col: number; colId?: string };
        max: { row: number; col: number };
      } | null;
    }) =>
      onSelectionChange?.(
        selection
          ? {
              from: selection.min.row,
              to: selection.max.row,
              colId: selection.min.colId,
              allColumns:
                selection.min.col === 0 && selection.max.col >= colCountRef.current - 1,
            }
          : null,
      ),
    [onSelectionChange],
  );

  const gridHeight = Math.max(200, height / layout.zoom - ADD_ROW_BAR);

  return (
    <div className="ledger-sheet" style={{ zoom: layout.zoom }}>
      <DynamicDataSheetGrid<FinTransaction>
        ref={gridRef}
        value={rows}
        onChange={(next) => onChange(next)}
        columns={columns}
        gutterColumn={gutterColumn}
        stickyRightColumn={detailColumn}
        rowKey="id"
        height={gridHeight}
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
        onSelectionChange={notifySelection}
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
          onHide={() => {
            setColumnHidden(menu.key, true);
            closeMenu();
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
