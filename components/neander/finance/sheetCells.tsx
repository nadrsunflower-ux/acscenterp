"use client";

// ============================================================
//  원장 시트 셀 부품 — react-datasheet-grid 용 컬럼 팩토리
// ------------------------------------------------------------
//  내장 textColumn 은 "값 하나"만 다룬다. 그런데 계정 3단은 상위 값에
//  따라 후보가 달라지고, 거래유형을 바꾸면 계정을 비워야 한다 — 행
//  전체를 보고 읽고/써야 하는 셀이다. 그래서 select 계열은 행 단위로
//  get/set/options 를 받는 팩토리로 만든다.
//
//  select 는 네이티브 <select> 다. 캔버스·커스텀 드롭다운이 아니라
//  실제 DOM 요소라 한글 IME·접근성·모바일이 공짜로 해결된다.
// ============================================================

import React, { memo, useLayoutEffect, useRef } from "react";
import {
  createAddRowsComponent,
  createContextMenuComponent,
  type AddRowsComponentProps,
  type CellProps,
  type Column,
  type ContextMenuComponentProps,
  type ContextMenuItem,
} from "react-datasheet-grid";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectColumnData<T> {
  get: (row: T) => string;
  set: (row: T, value: string) => T;
  options: (row: T) => SelectOption[];
  placeholder?: string;
}

function SelectCellInner<T>({
  rowData,
  setRowData,
  focus,
  columnData,
  stopEditing,
}: CellProps<T, SelectColumnData<T>>) {
  const ref = useRef<HTMLSelectElement>(null);
  const value = columnData.get(rowData);
  const opts = columnData.options(rowData);
  // 붙여넣기로 후보에 없는 값이 들어올 수 있다. 지우지 않고 그대로
  // 보여준다 — 검증이 빨갛게 표시하고, 사용자가 고른다.
  const unknown = value !== "" && !opts.some((o) => o.value === value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focus) {
      el.focus();
      // 크롬 121+ 는 포커스 직후 사용자 제스처 안에서 드롭다운을 열 수 있다.
      // 안 되는 브라우저는 Space 로 연다 — 치명적이지 않으니 조용히 넘긴다.
      try {
        (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
      } catch {
        /* noop */
      }
    } else {
      el.blur();
    }
  }, [focus]);

  return (
    <select
      ref={ref}
      className="dsg-input dsg-select"
      value={value}
      tabIndex={-1}
      style={{ pointerEvents: focus ? "auto" : "none" }}
      onChange={(e) => setRowData(columnData.set(rowData, e.target.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          stopEditing({ nextRow: true });
        } else if (e.key === "Tab") {
          e.preventDefault();
          stopEditing({ nextRow: false });
        }
      }}
    >
      <option value="">{columnData.placeholder ?? ""}</option>
      {unknown && <option value={value}>{value} ⚠</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const SelectCell = memo(SelectCellInner) as typeof SelectCellInner;

/** 행 단위 select 컬럼. 복사는 값, 붙여넣기는 원문 그대로(검증이 잡는다). */
export function createSelectColumn<T>(data: SelectColumnData<T>): Column<T, SelectColumnData<T>, string> {
  return {
    component: SelectCell as Column<T, SelectColumnData<T>, string>["component"],
    columnData: data,
    // 편집 중 방향키는 옵션 이동에 쓴다 (셀 이동이 아니라)
    disableKeys: true,
    deleteValue: ({ rowData }) => data.set(rowData, ""),
    copyValue: ({ rowData }) => data.get(rowData),
    pasteValue: ({ rowData, value }) => data.set(rowData, value.trim()),
    isCellEmpty: ({ rowData }) => data.get(rowData) === "",
  };
}

// ---- 읽기 전용 파생 셀 --------------------------------------

interface DerivedColumnData<T> {
  render: (row: T) => React.ReactNode;
  copy: (row: T) => string | number;
  alignRight?: boolean;
}

function DerivedCellInner<T>({ rowData, columnData }: CellProps<T, DerivedColumnData<T>>) {
  return (
    <div className={`dsg-derived${columnData.alignRight ? " dsg-derived-right" : ""}`}>
      {columnData.render(rowData)}
    </div>
  );
}
const DerivedCell = memo(DerivedCellInner) as typeof DerivedCellInner;

/** 계산값 표시 전용. 편집·삭제·붙여넣기는 막고 복사만 허용한다. */
export function createDerivedColumn<T>(data: DerivedColumnData<T>): Column<T, DerivedColumnData<T>, string> {
  return {
    component: DerivedCell as Column<T, DerivedColumnData<T>, string>["component"],
    columnData: data,
    disabled: true,
    copyValue: ({ rowData }) => data.copy(rowData),
    pasteValue: ({ rowData }) => rowData,
    deleteValue: ({ rowData }) => rowData,
    isCellEmpty: () => false,
  };
}

// ---- 행 동작 버튼 (오른쪽 고정 열) -----------------------------

interface ActionColumnData<T> {
  onClick: (row: T) => void;
  label: string;
  title?: string;
}

function ActionCellInner<T>({ rowData, columnData }: CellProps<T, ActionColumnData<T>>) {
  return (
    <button
      type="button"
      className="dsg-action-btn"
      title={columnData.title}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        columnData.onClick(rowData);
      }}
    >
      {columnData.label}
    </button>
  );
}
const ActionCell = memo(ActionCellInner) as typeof ActionCellInner;

export function createActionColumn<T>(data: ActionColumnData<T>) {
  return {
    component: ActionCell as Column<T, ActionColumnData<T>, string>["component"],
    columnData: data,
    basis: 44,
    grow: 0,
    shrink: 0,
    minWidth: 44,
  };
}

// ---- 열 머리글 (정렬 + 필터 드롭다운) ---------------------------

/**
 * 머리글은 두 부분이다: 이름을 누르면 정렬이 순환하고, 오른쪽 버튼을
 * 누르면 정렬·필터 드롭다운이 열린다 (엑셀 자동필터와 같은 자리).
 *
 * 그리드는 mousedown 을 **document 에서** 듣는다 (열 전체 선택용).
 * stopPropagation 으로 끊지 않으면 이 클릭이 열 선택으로 먹힌다.
 */
export function ColumnHead({
  label,
  dir,
  filtered,
  onSort,
  onOpenMenu,
}: {
  label: string;
  /** 이 열이 현재 정렬 기준일 때의 방향. 아니면 null */
  dir: "asc" | "desc" | null;
  /** 이 열에 필터가 걸려 있는가 */
  filtered: boolean;
  onSort: () => void;
  onOpenMenu: (anchor: DOMRect) => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="dsg-head">
      <button
        type="button"
        className="dsg-head-label"
        title={`${label} 기준 정렬 (오름차순 → 내림차순 → 해제)`}
        onMouseDown={stop}
        onClick={onSort}
      >
        <span className="dsg-head-text">{label}</span>
        <span className={`dsg-head-arrow${dir ? " dsg-head-arrow-on" : ""}`} aria-hidden>
          {dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
      <button
        type="button"
        className={`dsg-head-menu${filtered ? " dsg-head-menu-on" : ""}`}
        title={`${label} 정렬·필터`}
        aria-label={`${label} 정렬·필터`}
        onMouseDown={stop}
        onClick={(e) => onOpenMenu(e.currentTarget.getBoundingClientRect())}
      >
        {filtered ? (
          // 깔때기 — 필터가 걸린 열임을 이름 옆에서 바로 알 수 있게
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden>
            <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ---- 한국어 부속 컴포넌트 -------------------------------------

const MENU_LABEL: Record<ContextMenuItem["type"], string> = {
  INSERT_ROW_BELLOW: "아래에 행 추가",
  DELETE_ROW: "행 삭제",
  DUPLICATE_ROW: "행 복제",
  COPY: "복사",
  CUT: "잘라내기",
  PASTE: "붙여넣기",
  DELETE_ROWS: "행 삭제",
  DUPLICATE_ROWS: "행 복제",
};

const KoContextMenuBase = createContextMenuComponent((item) => {
  const range =
    item.type === "DELETE_ROWS" || item.type === "DUPLICATE_ROWS"
      ? ` (${item.fromRow + 1}–${item.toRow + 1}행)`
      : "";
  return (
    <>
      {MENU_LABEL[item.type]}
      {range}
    </>
  );
});

const KoAddRowsBase = createAddRowsComponent({ button: "행 추가", unit: "행" });

// React 18 의 FC 는 ReactNode 를 돌려주는데 그리드 prop 은 ReactElement|null
// 을 요구한다 — 한 겹 감싸서 타입을 맞춘다 (동작 차이는 없다).
export const KoContextMenu = (props: ContextMenuComponentProps) => <KoContextMenuBase {...props} />;
export const KoAddRows = (props: AddRowsComponentProps) => <KoAddRowsBase {...props} />;
