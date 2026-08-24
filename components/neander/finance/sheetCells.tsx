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

import React, { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampColWidth, clampRowHeight } from "./useSheetLayout";
import {
  createAddRowsComponent,
  createContextMenuComponent,
  type AddRowsComponentProps,
  type CellProps,
  type Column,
  type ContextMenuComponentProps,
  type SimpleColumn,
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
// ---- 크기 조절 손잡이 -------------------------------------------

/**
 * 셀 경계를 끌어 크기를 바꾸는 손잡이.
 *
 * 시작 크기를 인자로 받지 않고 **DOM 에서 잰다.** 유동 폭 열(거래처·비고)은
 * 남는 공간을 나눠 갖기 때문에 "지금 몇 px 인지"를 상태만 보고는 알 수
 * 없다. 화면에 그려진 값을 재야 잡은 자리에서 그대로 이어진다.
 *
 * 끄는 동안 **표가 실시간으로 바뀌고**, 그 위에 두 가지를 더 띄운다:
 *   · 표 전체를 가로지르는 안내선 — 경계가 어디에 놓이는지
 *   · 커서를 따라다니는 수치 — 지금 몇 px 인지
 * 표만 움직이면 손잡이를 놓칠 때가 있고, 무엇보다 값을 맞출 수가 없다.
 * 이것들은 시트 밖(포털)에 그린다 — 머리글 칸은 overflow:hidden 이라
 * 안에 그리면 잘린다.
 *
 * 포인터 캡처를 쓰므로 커서가 시트 밖으로 나가도 드래그가 끊기지 않는다.
 * 갱신은 프레임당 한 번으로 묶는다 — 안 그러면 열 정의가 초당 수백 번
 * 새로 만들어져 표 전체가 다시 그려진다.
 */
interface LiveDrag {
  px: number;
  x: number;
  y: number;
  /** 안내선을 그릴 표의 화면 좌표 */
  box: { top: number; left: number; width: number; height: number };
}

export function ResizeGrip({
  axis,
  onResize,
  onReset,
  clamp,
  label,
  title,
  className,
}: {
  axis: "x" | "y";
  onResize: (next: number) => void;
  /** 더블클릭 시 기본값으로 (엑셀의 자동맞춤 자리) */
  onReset?: () => void;
  /** 화면 수치와 실제 저장값을 같게 만든다 */
  clamp: (px: number) => number;
  /** 수치 앞에 붙는 말 — "너비" / "높이" */
  label: string;
  title: string;
  className: string;
}) {
  const frame = useRef<number | null>(null);
  const pending = useRef<LiveDrag | null>(null);
  const [live, setLive] = useState<LiveDrag | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    onResize(next.px);
    setLive(next);
  }, [onResize]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // 시트가 셀 선택을 시작하지 않도록 여기서 끊는다
      e.preventDefault();
      e.stopPropagation();

      const grip = e.currentTarget;
      const cell = grip.closest(".dsg-cell") as HTMLElement | null;
      if (!cell) return;
      const cellBox = cell.getBoundingClientRect();
      const container = (grip.closest(".dsg-container") ??
        grip.closest(".ledger-sheet")) as HTMLElement | null;
      const cb = container?.getBoundingClientRect();
      const box = {
        top: cb?.top ?? cellBox.top,
        left: cb?.left ?? cellBox.left,
        width: cb?.width ?? cellBox.width,
        height: cb?.height ?? cellBox.height,
      };

      const from = axis === "x" ? e.clientX : e.clientY;
      const start = axis === "x" ? cellBox.width : cellBox.height;

      grip.setPointerCapture(e.pointerId);
      document.body.classList.add(axis === "x" ? "dsg-resizing-col" : "dsg-resizing-row");
      setLive({ px: clamp(start), x: e.clientX, y: e.clientY, box });

      const move = (ev: PointerEvent) => {
        pending.current = {
          px: clamp(start + ((axis === "x" ? ev.clientX : ev.clientY) - from)),
          x: ev.clientX,
          y: ev.clientY,
          box,
        };
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
        document.body.classList.remove("dsg-resizing-col", "dsg-resizing-row");
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }
        flush();
        setLive(null);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    },
    [axis, clamp, flush],
  );

  return (
    <>
      <div
        className={live ? `${className} dsg-grip-on` : className}
        role="separator"
        aria-orientation={axis === "x" ? "vertical" : "horizontal"}
        title={title}
        onPointerDown={onPointerDown}
        onDoubleClick={
          onReset
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onReset();
              }
            : undefined
        }
        // 머리글 정렬 버튼이나 행 선택이 같이 반응하지 않게
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
      {live &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className={axis === "x" ? "dsg-guide-v" : "dsg-guide-h"}
              style={
                axis === "x"
                  ? { left: live.x, top: live.box.top, height: live.box.height }
                  : { top: live.y, left: live.box.left, width: live.box.width }
              }
              aria-hidden
            />
            <div
              className="dsg-size-badge"
              style={{ left: live.x, top: live.y }}
              role="status"
              aria-live="polite"
            >
              {label} {live.px}px
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/**
 * 행 번호 칸. 기본 거터는 번호만 그리는데, 아래 경계에 행 높이 손잡이를
 * 얹는다. 행 선택은 셀 껍데기가 처리하므로 여기를 바꿔도 그대로 동작한다.
 *
 * ⚠️ 이 컴포넌트는 **모듈 수준에 있어야 한다.** 안에서 만들면 렌더마다
 *    새 함수가 되고, React 는 타입이 달라진 것으로 보아 셀을 통째로
 *    다시 마운트한다. 그러면 행 높이를 끄는 순간 — 초기화 버튼이 켜지며
 *    거터가 새로 그려질 때 — 잡고 있던 손잡이가 사라져 드래그가 끊긴다.
 *    바뀌는 값은 columnData 로 흘려보낸다 (프로퍼티는 다시 마운트하지
 *    않는다).
 */
interface GutterData {
  onResizeRow: (px: number) => void;
  onResetRow: () => void;
}

const GutterCell = <T,>({ rowIndex, columnData }: CellProps<T, GutterData>) => (
  <div className="dsg-gutter">
    <span className="dsg-gutter-no">{rowIndex + 1}</span>
    <ResizeGrip
      axis="y"
      className="dsg-row-grip"
      title="끌어서 행 높이 조절 · 더블클릭 기본값"
      clamp={clampRowHeight}
      label="높이"
      onResize={columnData.onResizeRow}
      onReset={columnData.onResetRow}
    />
  </div>
);

export function createGutterColumn<T>({
  onResizeRow,
  onResetRow,
  onResetAll,
  canReset,
}: {
  onResizeRow: (px: number) => void;
  onResetRow: () => void;
  onResetAll: () => void;
  canReset: boolean;
}): SimpleColumn<T, GutterData> {
  return {
    basis: 46,
    grow: 0,
    shrink: 0,
    minWidth: 0,
    columnData: { onResizeRow, onResetRow },
    // title 은 머리글 한 칸에만 쓰이므로 매번 바뀌어도 셀을 건드리지 않는다
    title: (
      <button
        type="button"
        className="dsg-layout-reset"
        title={canReset ? "열 너비·행 높이를 기본값으로" : "열 너비·행 높이가 기본값입니다"}
        aria-label="열 너비·행 높이 초기화"
        disabled={!canReset}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onResetAll}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3 w-3" aria-hidden>
          <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
        </svg>
      </button>
    ),
    component: GutterCell,
  };
}

export function ColumnHead({
  label,
  dir,
  filtered,
  onSort,
  onOpenMenu,
  onResize,
  onResetWidth,
}: {
  label: string;
  /** 이 열이 현재 정렬 기준일 때의 방향. 아니면 null */
  dir: "asc" | "desc" | null;
  /** 이 열에 필터가 걸려 있는가 */
  filtered: boolean;
  onSort: () => void;
  onOpenMenu: (anchor: DOMRect) => void;
  /** 오른쪽 경계를 끌었을 때의 새 폭 */
  onResize: (px: number) => void;
  onResetWidth: () => void;
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
      <ResizeGrip
        axis="x"
        className="dsg-col-grip"
        title={`끌어서 ${label} 너비 조절 · 더블클릭 기본값`}
        clamp={clampColWidth}
        label="너비"
        onResize={onResize}
        onReset={onResetWidth}
      />
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
