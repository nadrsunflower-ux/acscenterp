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

import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Funnel, Grid2x2 } from "lucide-react";
import { Icon, Portal, type LucideIcon } from "@/components/neander/ui";
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

// ---- 글자 셀 (한글 조합 안전) ----------------------------------
//
//  내장 textColumn 은 셀이 **편집 상태로 바뀌는 순간** 입력칸에 포커스를
//  옮긴다. 알파벳은 이 방식으로 괜찮지만 한글은 깨진다.
//
//    ㄱ 입력 → (포커스가 아직 표에 있다) → 그리드가 편집 상태로 전환
//            → 입력칸으로 포커스 이동 → 조합이 끊긴다
//    ㅏ 입력 → 입력칸에서 **새 조합**이 시작 → 「ㄱㅏ」
//
//  IME 의 조합은 조합이 시작된 그 요소에 묶여 있어서, 도중에 포커스가
//  옮겨가면 이어지지 않는다. 그래서 **셀이 선택되는 순간** 미리 입력칸에
//  포커스를 준다. 첫 자음부터 입력칸 안에서 조합되므로 옮길 일이 없다.
//
//  선택만 된 칸에서 커서가 깜빡이거나 글자가 파랗게 잡혀 보이면 안 되므로
//  (엑셀은 그러지 않는다) 편집 전에는 커서와 선택 표시를 CSS 로 감춘다.
//  글자를 미리 전체 선택해 두는 이유는 엑셀처럼 **타자를 치면 기존 값이
//  덮어써지게** 하기 위해서다.

interface TextColumnData<V> {
  parse: (raw: string) => V;
  /** 읽을 때 보이는 글자 (천 단위 콤마 등) */
  formatBlurred: (value: V) => string;
  /** 편집할 때 보이는 글자 (맨 숫자 등) */
  formatEditing: (value: V) => string;
  alignRight?: boolean;
  placeholder?: string;
}

function TextCellInner<V>({
  rowData,
  setRowData,
  active,
  focus,
  columnData,
}: CellProps<V, TextColumnData<V>>) {
  const ref = useRef<HTMLInputElement>(null);
  // 비동기 접근용 — 효과의 의존성 목록을 늘리지 않으려고 ref 에 담는다
  const async = useRef({ rowData, columnData, setRowData, composing: false, esc: false });
  async.current.rowData = rowData;
  async.current.columnData = columnData;
  async.current.setRowData = setRowData;

  /** 값이 밖에서 바뀌면 화면 글자를 맞춘다. 조합·편집 중에는 건드리지 않는다. */
  useEffect(() => {
    if (!focus && !async.current.composing && ref.current) {
      ref.current.value = columnData.formatBlurred(rowData);
    }
  }, [focus, rowData, columnData]);

  /**
   * 선택된 칸이면 입력칸에 포커스를 준다.
   *
   * 그리드는 활성 셀이 처음 생길 때 `document.activeElement.blur()` 를
   * 부른다(DataSheetGrid.js). 그 뒤에 포커스를 잡아야 하므로 한 틱 미룬다.
   */
  useEffect(() => {
    if (!active) {
      if (ref.current && document.activeElement === ref.current) ref.current.blur();
      return;
    }
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el || document.activeElement === el) return;
      el.focus({ preventScroll: true });
      // 타자를 치면 기존 값이 덮어써지도록 미리 전체 선택 (엑셀과 같다)
      el.select();
    }, 0);
    return () => clearTimeout(t);
  }, [active]);

  /** 편집 상태 전환 — 시작할 때 편집용 글자로, 끝날 때 값을 확정한다 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { formatEditing, formatBlurred, parse } = async.current.columnData;
    if (focus) {
      // 이미 사용자가 치기 시작했거나 조합 중이면 건드리지 않는다.
      // (키를 누른 뒤 이 효과가 실행되는 순서는 브라우저마다 다르다)
      const untouched = el.value === formatBlurred(async.current.rowData);
      if (untouched && !async.current.composing) {
        el.value = formatEditing(async.current.rowData);
        el.select();
      }
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      async.current.esc = false;
    } else {
      // 편집을 마쳤다. 글자가 달라졌으면 값을 확정한다.
      //
      // onChange 가 불렸는지로 판단하면 안 된다 — React 는 IME 조합 중의
      // input 이벤트를 눌러 두었다가 조합이 끝나야 흘려보내는데, 조합 도중
      // 다른 칸으로 옮기면 그 이벤트가 오지 않는다. 그러면 방금 친 한글이
      // 조용히 사라진다. 그래서 **글자를 직접 비교**한다.
      //
      // Esc 로 나갔으면 되돌린다 — 편집을 취소한 것이다.
      if (!async.current.esc && el.value !== formatEditing(async.current.rowData)) {
        async.current.setRowData(parse(el.value));
      }
      el.value = formatBlurred(async.current.rowData);
      if (document.activeElement === el && !active) el.blur();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return (
    <input
      ref={ref}
      // 값을 직접 들고 있지 않는다 (제어 컴포넌트로 만들면 조합 중 값이
      // 되돌아가면서 한글이 깨진다). 성능상으로도 이쪽이 가볍다.
      defaultValue={columnData.formatBlurred(rowData)}
      className={`dsg-input${columnData.alignRight ? " dsg-input-align-right" : ""}${focus ? "" : " dsg-input-idle"}`}
      placeholder={active ? columnData.placeholder : undefined}
      tabIndex={-1}
      // 편집 중이 아니면 클릭이 통과해 그리드가 셀 선택을 처리한다
      style={{ pointerEvents: focus ? "auto" : "none" }}
      onCompositionStart={() => {
        async.current.composing = true;
      }}
      onCompositionEnd={() => {
        async.current.composing = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") async.current.esc = true;
      }}
    />
  );
}
const TextCell = memo(TextCellInner) as typeof TextCellInner;

/**
 * 한글 조합이 끊기지 않는 글자·숫자 셀. 내장 createTextColumn 을 대신한다.
 * keyColumn 으로 감싸 쓰는 것은 같다.
 */
export function createSheetTextColumn<V>({
  parse,
  formatBlurred,
  formatEditing,
  formatForCopy,
  parsePasted,
  deletedValue,
  alignRight,
  placeholder,
}: {
  parse: (raw: string) => V;
  formatBlurred: (value: V) => string;
  formatEditing: (value: V) => string;
  formatForCopy?: (value: V) => string;
  parsePasted?: (raw: string) => V;
  deletedValue: V;
  alignRight?: boolean;
  placeholder?: string;
}): Column<V, TextColumnData<V>, string> {
  const copy = formatForCopy ?? formatEditing;
  const paste = parsePasted ?? ((raw: string) => parse(raw.replace(/[\n\r]+/g, " ")));
  return {
    component: TextCell as Column<V, TextColumnData<V>, string>["component"],
    columnData: { parse, formatBlurred, formatEditing, alignRight, placeholder },
    deleteValue: () => deletedValue,
    copyValue: ({ rowData }) => copy(rowData),
    pasteValue: ({ value }) => paste(value),
    isCellEmpty: ({ rowData }) => rowData === null || rowData === undefined || rowData === "",
  };
}

// ---- 사람이 덧붙인 열 ------------------------------------------

/**
 * 덧붙인 열의 값은 거래의 `extra[열id]` 에 들어간다.
 *
 * 라이브러리의 keyColumn 은 최상위 키만 묶어 준다. 한 단계 안쪽을 보려면
 * 같은 방식으로 직접 감싸야 한다 — 셀에는 그 칸의 값만 넘겨서, 같은 행의
 * 다른 칸이 바뀌었다고 이 칸까지 다시 그리지 않게 한다.
 */
type ExtraRow = { extra?: Record<string, string> };

const ExtraCell = ({
  columnData,
  rowData,
  setRowData,
  ...rest
}: {
  columnData: { key: string; original: Column<string, unknown, string> };
  rowData: ExtraRow;
  setRowData: (row: ExtraRow) => void;
}) => {
  const { key, original } = columnData;
  // ref 로 두어야 행이 바뀔 때마다 setter 가 새로 만들어지지 않는다
  const rowRef = useRef(rowData);
  rowRef.current = rowData;
  const setValue = useCallback(
    (value: string) =>
      setRowData({ ...rowRef.current, extra: { ...(rowRef.current.extra ?? {}), [key]: value ?? "" } }),
    [key, setRowData],
  );
  // 원래 셀은 CellProps 전체를 요구한다. 나머지(rest)는 그리드가 넘겨준 것을
  // 그대로 흘려보내면 되므로 한 번 느슨하게 받는다.
  const Cell = original.component as unknown as React.ComponentType<Record<string, unknown>>;
  if (!Cell) return <></>;
  return (
    <Cell
      {...(rest as Record<string, unknown>)}
      columnData={original.columnData}
      setRowData={setValue}
      rowData={rowData.extra?.[key] ?? ""}
    />
  );
};

/** 덧붙인 열 하나 → 그리드 열. `id` 는 `x:<열id>` 로 고정 열과 겹치지 않게 */
export function createExtraColumn<T extends ExtraRow>(
  key: string,
  column: Column<string, unknown, string>,
): Column<T, unknown, string> {
  const val = (rowData: T) => rowData.extra?.[key] ?? "";
  const put = (rowData: T, value: string): T => ({
    ...rowData,
    extra: { ...(rowData.extra ?? {}), [key]: value ?? "" },
  });
  return {
    ...(column as unknown as Column<T, unknown, string>),
    id: `x:${key}`,
    columnData: { key, original: column },
    component: ExtraCell as unknown as Column<T, unknown, string>["component"],
    copyValue: ({ rowData, rowIndex }) => column.copyValue?.({ rowData: val(rowData), rowIndex }) ?? null,
    deleteValue: ({ rowData, rowIndex }) =>
      put(rowData, String(column.deleteValue?.({ rowData: val(rowData), rowIndex }) ?? "")),
    pasteValue: ({ rowData, value, rowIndex }) =>
      put(rowData, String(column.pasteValue?.({ rowData: val(rowData), value, rowIndex }) ?? "")),
    isCellEmpty: ({ rowData }) => !val(rowData),
  };
}

// ---- 체크 셀 --------------------------------------------------

interface CheckColumnData<T> {
  get: (row: T) => boolean;
  set: (row: T, value: boolean) => T;
  /** 스크린리더가 읽을 이름 */
  label?: string;
}

function CheckCellInner<T>({ rowData, setRowData, columnData, active }: CellProps<T, CheckColumnData<T>>) {
  const checked = columnData.get(rowData);
  return (
    <div className="dsg-check">
      <input
        type="checkbox"
        checked={checked}
        aria-label={columnData.label ?? "체크"}
        // 셀을 고르는 것과 값을 바꾸는 것은 다른 동작이라, 클릭이 셀 선택으로
        // 새어 나가지 않게 막는다. 스페이스바로도 바뀐다(브라우저 기본).
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => setRowData(columnData.set(rowData, e.target.checked))}
        tabIndex={active ? 0 : -1}
      />
    </div>
  );
}
const CheckCell = memo(CheckCellInner) as typeof CheckCellInner;

/**
 * 참/거짓 체크 칸.
 *
 * 내장 checkboxColumn 을 쓰지 않는 이유는 그쪽이 `boolean` 만 다루기
 * 때문이다. 우리 모델의 체크는 **선택 항목**(`done?: boolean`)이라 값이
 * 없을 수 있고, 없는 것과 false 를 같게 봐야 한다. 붙여넣기는 엑셀에서
 * 오는 여러 표기(TRUE·O·Y·1·예)를 받아 준다.
 */
export function createCheckColumn<T>(data: CheckColumnData<T>): Column<T, CheckColumnData<T>, string> {
  const TRUTHY = new Set(["true", "1", "o", "y", "yes", "예", "완료", "v", "✓"]);
  return {
    component: CheckCell as Column<T, CheckColumnData<T>, string>["component"],
    columnData: data,
    deleteValue: ({ rowData }) => data.set(rowData, false),
    copyValue: ({ rowData }) => (data.get(rowData) ? "TRUE" : ""),
    pasteValue: ({ rowData, value }) => data.set(rowData, TRUTHY.has(value.trim().toLowerCase())),
    isCellEmpty: ({ rowData }) => !data.get(rowData),
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
  /** 글자 라벨. icon 이 있으면 접근 가능한 이름으로만 쓰인다 */
  label: string;
  title?: string;
  /** 선형 아이콘 — 있으면 글자 대신 그린다 */
  icon?: LucideIcon;
}

function ActionCellInner<T>({ rowData, columnData }: CellProps<T, ActionColumnData<T>>) {
  return (
    <button
      type="button"
      className="dsg-action-btn"
      title={columnData.title}
      aria-label={columnData.title ?? columnData.label}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        columnData.onClick(rowData);
      }}
    >
      {columnData.icon ? <Icon icon={columnData.icon} size={16} /> : columnData.label}
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
 *
 * ⚠️ 표가 확대/축소(CSS zoom)돼 있으면 두 좌표계가 갈린다. 커서 좌표와
 *    getBoundingClientRect 는 **화면 픽셀**인데 우리가 저장할 폭·높이는
 *    표 안쪽의 **본래 픽셀**이다. 배율로 나눠야 80% 로 줄여 놓고 끌었을 때
 *    끈 만큼만 움직인다. 나누지 않으면 커서보다 표가 덜 따라온다.
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
  scale,
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
  /** 현재 표 배율. 드래그 시작 시점에 읽는다 */
  scale: () => number;
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
      // 화면 픽셀 → 표 안쪽 픽셀
      const z = scale() || 1;
      const start = (axis === "x" ? cellBox.width : cellBox.height) / z;

      grip.setPointerCapture(e.pointerId);
      document.body.classList.add(axis === "x" ? "dsg-resizing-col" : "dsg-resizing-row");
      setLive({ px: clamp(start), x: e.clientX, y: e.clientY, box });

      const move = (ev: PointerEvent) => {
        pending.current = {
          px: clamp(start + ((axis === "x" ? ev.clientX : ev.clientY) - from) / z),
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
    [axis, clamp, scale, flush],
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
      {live && (
        // 공통 포탈 뿌리(data-app="neander")에 그려야 토큰 색이 닿는다
        <Portal>
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
        </Portal>
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
  scale: () => number;
}

const GutterCell = <T,>({ rowIndex, columnData }: CellProps<T, GutterData>) => (
  <div className="dsg-gutter">
    <span className="dsg-gutter-no">{rowIndex + 1}</span>
    <ResizeGrip
      axis="y"
      className="dsg-row-grip"
      title="끌어서 행 높이 조절 · 더블클릭 기본값"
      clamp={clampRowHeight}
      scale={columnData.scale}
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
  scale,
}: {
  onResizeRow: (px: number) => void;
  onResetRow: () => void;
  onResetAll: () => void;
  canReset: boolean;
  scale: () => number;
}): SimpleColumn<T, GutterData> {
  return {
    basis: 46,
    grow: 0,
    shrink: 0,
    minWidth: 0,
    columnData: { onResizeRow, onResetRow, scale },
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
        <Icon icon={Grid2x2} size={12} />
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
  scale,
  sortable,
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
  /** 현재 표 배율 */
  scale: () => number;
  /**
   * 정렬·필터를 쓰지 않는 표(프로젝트 체크리스트)는 false.
   * 눌러도 아무 일 없는 화살표와 깔때기를 띄우지 않는다 — 폭 조절은 그대로.
   */
  sortable?: boolean;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (sortable === false) {
    return (
      <div className="dsg-head">
        <span className="dsg-head-label dsg-head-static">
          <span className="dsg-head-text">{label}</span>
        </span>
        <ResizeGrip
          axis="x"
          className="dsg-col-grip"
          title={`끌어서 ${label} 너비 조절 · 더블클릭 기본값`}
          clamp={clampColWidth}
          scale={scale}
          label="너비"
          onResize={onResize}
          onReset={onResetWidth}
        />
      </div>
    );
  }
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
          <Icon icon={dir === "desc" ? ArrowDown : ArrowUp} size={11} strokeWidth={2.25} />
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
          <Icon icon={Funnel} size={12} fill="currentColor" />
        ) : (
          <Icon icon={ChevronDown} size={13} strokeWidth={2.5} />
        )}
      </button>
      <ResizeGrip
        axis="x"
        className="dsg-col-grip"
        title={`끌어서 ${label} 너비 조절 · 더블클릭 기본값`}
        clamp={clampColWidth}
        scale={scale}
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
