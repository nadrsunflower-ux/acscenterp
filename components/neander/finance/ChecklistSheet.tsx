"use client";

// ============================================================
//  프로젝트 체크리스트 시트 — 원장과 같은 스프레드시트
// ------------------------------------------------------------
//  원장 시트(LedgerSheet)와 같은 부품 위에 세운다. 셀 사이 방향키 이동,
//  엑셀에서 그대로 붙여넣기, 드래그로 채우기, 오른쪽 클릭으로 줄 넣기·
//  지우기·복제, 열 폭 끌기, 행 높이 조절, 배율, 머리글 정렬·필터까지
//  동작이 같다. 재무를 다루는 사람이 두 화면에서 다른 손버릇을 익힐
//  이유가 없다.
//
//  원장에 없는 것이 셋 있다.
//
//   ① 사용자 열 — 행사마다 챙길 것이 달라 고정 열로는 모자란다. 「열 추가」
//      로 고른 열 오른쪽에 새 열이 생기고, 머리글에서 바로 이름을 고친다.
//      값은 줄의 `extra` 에 들어간다.
//
//   ② 「견적금액」은 읽기 전용 파생 셀이다. 엑셀의 `=수량*단가` 자리인데
//      값을 저장하지 않고 매번 계산한다 — 수식이 깨질 일이 없다.
//
//   ③ 되돌리기 — 원장에서 필터는 보기일 뿐이지만, 체크리스트는 줄 순서가
//      곧 문서다. 걸러진 화면에서 고친 결과를 원본 배열에 되돌려 놓아야
//      가려져 있던 줄이 사라지지 않는다 (project-sheet.ts 의 reconcileLines).
//
//  이 컴포넌트는 줄 배열을 value/onChange 로 받는 제어 표다. 정렬·필터는
//  문서가 아니라 보는 사람의 상태라 여기서 들고 있는다.
// ============================================================

import "react-datasheet-grid/dist/style.css";
import "./ledger-sheet.css";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  // StaticDataSheetGrid 함정은 LedgerSheet 머리말 참고 — 열 정의를 매 렌더
  // 반영해야 하므로 Dynamic 을 쓴다.
  DynamicDataSheetGrid,
  keyColumn,
  type Column,
  type DataSheetGridRef,
} from "react-datasheet-grid";
import {
  KoAddRows,
  KoContextMenu,
  ColumnHead,
  ResizeGrip,
  createCheckColumn,
  createDerivedColumn,
  createGutterColumn,
  createSheetTextColumn,
} from "./sheetCells";
import { ColumnMenu } from "./ColumnMenu";
import { DEFAULT_ROW_HEIGHT, clampColWidth, type SheetLayoutHandle } from "./useSheetLayout";
import { parseAmountInput } from "@/lib/neander/finance/sheet";
import {
  extraKey,
  hasActual,
  lineEstimate,
  orderedColumnIds,
  shortId,
  type ChecklistFixedKey,
  type FinProjectColumn,
  type FinProjectLine,
} from "@/lib/neander/finance/project";
import {
  activeChecklistFilterCount,
  applyChecklistFilters,
  checklistOptions,
  isActiveChecklistFilter,
  isChecklistRangeKey,
  reconcileLines,
  sortChecklist,
  type ChecklistFilters,
  type ChecklistSort,
} from "@/lib/neander/finance/project-sheet";
import type { ColumnFilter } from "@/lib/neander/finance/sheetFilter";

/**
 * 시트가 다루는 줄. 사용자 열의 값을 `x:<id>` 키로 **펼쳐서** 넣는다.
 * 그래야 keyColumn 을 그대로 쓸 수 있다 — 중첩 경로를 읽는 셀을 따로 만들면
 * 열이 바뀔 때마다 컴포넌트 신원이 달라져 셀이 통째로 다시 마운트된다.
 */
type SheetLine = FinProjectLine & { [k: `x:${string}`]: string | undefined };

const LABEL: Record<ChecklistFixedKey, string> = {
  done: "준비",
  category: "분류",
  item: "품목",
  qty: "수량",
  unit: "단위",
  unitPrice: "단가",
  estimate: "견적금액",
  actual: "실제금액",
  vendor: "발주처",
  location: "위치",
  preparedQty: "준비수량",
  note: "비고",
};

const DEFAULT_BASIS: Record<ChecklistFixedKey, number> = {
  done: 56,
  category: 130,
  item: 200,
  qty: 70,
  unit: 64,
  unitPrice: 96,
  estimate: 104,
  actual: 104,
  vendor: 110,
  location: 76,
  preparedQty: 84,
  note: 180,
};
const EXTRA_BASIS = 120;

/** 남는 폭을 나눠 갖는 열 → 그때 지켜야 할 최소 폭 */
const FLEX_MIN: Record<string, number> = { item: 140, note: 120 };

const ADD_ROW_BAR = 44;

// ---- 셀 종류 --------------------------------------------------

/** 빈 값이 undefined 인 글자 셀 (단위·발주처·위치·비고·사용자 열) */
const optionalText = createSheetTextColumn<string | undefined>({
  parse: (v) => v.trim() || undefined,
  parsePasted: (v) => v.replace(/[\n\r]+/g, " ").trim() || undefined,
  formatBlurred: (v) => v ?? "",
  formatEditing: (v) => v ?? "",
  deletedValue: undefined,
});

/**
 * 빈 값이 `""` 인 글자 셀 (분류·품목).
 *
 * 이 둘은 줄의 정체라 키를 없애지 않는다. undefined 로 두면 입력칸의 value
 * 가 사라져 React 가 제어를 놓고, 글자를 다 지운 칸이 되돌아오지 않는다.
 */
const requiredText = createSheetTextColumn<string>({
  parse: (v) => v.trim(),
  parsePasted: (v) => v.replace(/[\n\r]+/g, " ").trim(),
  formatBlurred: (v) => v ?? "",
  formatEditing: (v) => v ?? "",
  deletedValue: "",
});

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 수량처럼 언제나 값이 있는 숫자 셀. 지우면 0. */
const requiredNumber = createSheetTextColumn<number>({
  alignRight: true,
  parse: parseAmountInput,
  parsePasted: parseAmountInput,
  formatBlurred: (n) => (Number.isFinite(n) ? fmt(n) : "⚠"),
  formatEditing: (n) => (Number.isFinite(n) ? String(n) : ""),
  deletedValue: 0,
});

/**
 * 비울 수 있는 숫자 셀 (단가·실제금액·준비수량).
 *
 * 빈 칸과 0 은 뜻이 다르다. 단가가 비면 "아직 모른다", 0 이면 "돈이 안 든다"
 * 다. 실제금액이 비면 견적으로 계산하고, 0 이면 실제로 0원을 썼다는 뜻이다.
 * 그래서 지운 값을 0 이 아니라 undefined 로 되돌린다.
 */
const optionalNumber = createSheetTextColumn<number | undefined>({
  alignRight: true,
  parse: (v) => (v.trim() ? parseAmountInput(v) : undefined),
  parsePasted: (v) => (v.trim() ? parseAmountInput(v) : undefined),
  formatBlurred: (n) => (n === undefined ? "" : Number.isFinite(n) ? fmt(n) : "⚠"),
  formatEditing: (n) => (n === undefined || !Number.isFinite(n) ? "" : String(n)),
  deletedValue: undefined,
});

// ---- 줄 ↔ 시트 줄 ----------------------------------------------

function toSheet(l: FinProjectLine): SheetLine {
  const out = { ...l } as SheetLine;
  if (l.extra) {
    Object.entries(l.extra).forEach(([id, v]) => {
      out[extraKey(id) as `x:${string}`] = v;
    });
  }
  return out;
}

/** 펼쳐 둔 `x:` 키를 다시 extra 로 접는다 */
function fromSheet(s: SheetLine): FinProjectLine {
  const out = { ...s } as FinProjectLine & Record<string, unknown>;
  const extra: Record<string, string> = {};
  Object.keys(out).forEach((k) => {
    if (!k.startsWith("x:")) return;
    const v = out[k];
    if (typeof v === "string" && v.trim()) extra[k.slice(2)] = v.trim();
    delete out[k];
  });
  if (Object.keys(extra).length > 0) out.extra = extra;
  else delete out.extra;
  return out as FinProjectLine;
}

export function ChecklistSheet({
  lines,
  onChange,
  columns: userColumns,
  onColumnsChange,
  createRow,
  height = 520,
  sheet,
}: {
  lines: FinProjectLine[];
  onChange: (lines: FinProjectLine[]) => void;
  /** 사용자가 만든 열 */
  columns: FinProjectColumn[];
  onColumnsChange: (columns: FinProjectColumn[]) => void;
  createRow: () => FinProjectLine;
  height?: number;
  sheet: SheetLayoutHandle;
}) {
  const { layout, setWidth, clearWidth, setRowHeight, reset, customized } = sheet;
  const gridRef = useRef<DataSheetGridRef>(null);

  // 정렬·필터는 보는 사람의 상태다 (문서에 저장하지 않는다)
  const [sort, setSort] = useState<ChecklistSort | null>(null);
  const [filters, setFilters] = useState<ChecklistFilters>({});
  const [menu, setMenu] = useState<{ colId: string; label: string; anchor: DOMRect } | null>(null);
  /** 지금 고른 칸 — 「행 추가」·「열 추가」가 어디에 넣을지의 기준 */
  const [picked, setPicked] = useState<{ colId?: string; rowMax: number } | null>(null);

  const zoomRef = useRef(layout.zoom);
  zoomRef.current = layout.zoom;
  const scale = useCallback(() => zoomRef.current, []);

  const colIds = useMemo(() => orderedColumnIds(userColumns), [userColumns]);
  const labelOf = useCallback(
    (colId: string) =>
      colId.startsWith("x:")
        ? (userColumns.find((c) => c.id === colId.slice(2))?.label ?? "새 열")
        : (LABEL[colId as ChecklistFixedKey] ?? colId),
    [userColumns],
  );

  // ---- 보이는 줄 ------------------------------------------------

  const view = useMemo(
    () => sortChecklist(applyChecklistFilters(lines, filters), sort),
    [lines, filters, sort],
  );
  const sheetRows = useMemo(() => view.map(toSheet), [view]);
  /** 화면이 원본과 다른 상태인가 — 되돌리기가 필요한지의 판단 */
  const transformed = sort !== null || activeChecklistFilterCount(filters) > 0;

  const emit = useCallback(
    (nextRows: SheetLine[]) => {
      const next = nextRows.map(fromSheet);
      // 원본 그대로를 보고 있으면 그대로 싣는다 — 중간에 끼워 넣은 줄의 자리가
      // 유지된다. 걸러진 화면일 때만 되돌리기를 거친다.
      onChange(transformed ? reconcileLines(lines, view, next) : next);
    },
    [onChange, transformed, lines, view],
  );

  // ---- 행·열 추가 ------------------------------------------------

  /** 고른 줄 **바로 아래**에 넣는다. 고른 게 없으면 맨 끝. */
  const addRowBelow = useCallback(() => {
    const anchorId = picked ? view[picked.rowMax]?.id : undefined;
    const found = anchorId ? lines.findIndex((l) => l.id === anchorId) : -1;
    const at = found >= 0 ? found + 1 : lines.length;
    const next = [...lines];
    next.splice(at, 0, createRow());
    onChange(next);
    // 새 줄의 품목 칸으로 커서를 옮겨 바로 타자를 칠 수 있게 한다.
    // 목록이 다시 그려진 뒤라야 하므로 한 틱 미룬다. 걸러진 화면에서는
    // 새 줄이 필터에 안 걸릴 수 있어 커서를 옮기지 않는다.
    if (!transformed) setTimeout(() => gridRef.current?.setActiveCell({ col: "item", row: at }), 0);
  }, [picked, view, lines, createRow, onChange, transformed]);

  /** 고른 열 **바로 오른쪽**에 새 열을 만든다 */
  const addColumnRight = useCallback(() => {
    const anchor = picked?.colId ?? colIds[colIds.length - 1];
    const id = shortId();
    onColumnsChange([...userColumns, { id, label: `새 열 ${userColumns.length + 1}`, after: anchor }]);
    setTimeout(
      () => gridRef.current?.setActiveCell({ col: extraKey(id), row: picked?.rowMax ?? 0 }),
      0,
    );
  }, [picked, colIds, userColumns, onColumnsChange]);

  const renameColumn = useCallback(
    (id: string, label: string) =>
      onColumnsChange(userColumns.map((c) => (c.id === id ? { ...c, label } : c))),
    [userColumns, onColumnsChange],
  );

  const removeColumn = useCallback(
    (id: string) => {
      const col = userColumns.find((c) => c.id === id);
      const used = lines.filter((l) => l.extra?.[id]).length;
      const ok = window.confirm(
        used > 0
          ? `「${col?.label ?? "새 열"}」 열을 지웁니다. 이 열에 적힌 ${used}줄의 값도 함께 사라집니다.`
          : `「${col?.label ?? "새 열"}」 열을 지웁니다.`,
      );
      if (!ok) return;
      // 이 열 뒤에 붙어 있던 열은 이 열의 앵커를 물려받는다 (자리 유지)
      onColumnsChange(
        userColumns
          .filter((c) => c.id !== id)
          .map((c) => (c.after === extraKey(id) ? { ...c, after: col?.after } : c)),
      );
      setFilters((f) => {
        const next = { ...f };
        delete next[extraKey(id)];
        return next;
      });
      setSort((s) => (s?.colId === extraKey(id) ? null : s));
    },
    [userColumns, lines, onColumnsChange],
  );

  const cycleSort = useCallback(
    (colId: string) =>
      setSort((s) =>
        s?.colId !== colId
          ? { colId, dir: "asc" }
          : s.dir === "asc"
            ? { colId, dir: "desc" }
            : null,
      ),
    [],
  );

  // ---- 열 정의 --------------------------------------------------

  /**
   * ① 셀 정의. 열 구성이 바뀔 때만 다시 만든다 — 데이터가 바뀔 때마다 새로
   *    만들면 화면의 셀이 통째로 다시 마운트되고 편집 중이던 칸이 날아간다.
   */
  const cellColumns = useMemo<Column<SheetLine, any, any>[]>(() => {
    const size = (key: string) => {
      const min = FLEX_MIN[key];
      const basis = key.startsWith("x:") ? EXTRA_BASIS : DEFAULT_BASIS[key as ChecklistFixedKey];
      return min === undefined
        ? { id: key, basis, grow: 0, shrink: 0, minWidth: 0 }
        : { id: key, basis, grow: 1, shrink: 1, minWidth: min };
    };

    const build = (key: string): Column<SheetLine, any, any> => {
      switch (key) {
        case "done":
          return {
            ...createCheckColumn<SheetLine>({
              get: (l) => !!l.done,
              set: (l, v) => ({ ...l, done: v }),
              label: "준비 완료",
            }),
            ...size(key),
          };
        case "category":
        case "item":
          return { ...keyColumn<SheetLine, "item">(key as "item", requiredText), ...size(key) };
        case "qty":
          return { ...keyColumn<SheetLine, "qty">("qty", requiredNumber), ...size(key) };
        case "unitPrice":
        case "actual":
        case "preparedQty":
          return {
            ...keyColumn<SheetLine, "unitPrice">(key as "unitPrice", optionalNumber),
            ...size(key),
          };
        case "estimate":
          return {
            // 엑셀의 =수량*단가 자리. 저장하지 않고 매번 계산한다.
            ...createDerivedColumn<SheetLine>({
              render: (l) => {
                const v = lineEstimate(l);
                return v === 0 ? <span className="text-zinc-300">—</span> : <span>{fmt(v)}</span>;
              },
              copy: (l) => lineEstimate(l),
              alignRight: true,
            }),
            ...size(key),
          };
        default:
          // 단위·발주처·위치·비고와 사용자 열은 모두 자유 글자다
          return { ...keyColumn<SheetLine, "note">(key as "note", optionalText), ...size(key) };
      }
    };

    return colIds.map(build);
  }, [colIds]);

  /** ② 머리글과 사용자가 정한 폭만 얹는다 (셀 정의 참조는 그대로 유지) */
  const columns = useMemo<Column<SheetLine, any, any>[]>(
    () =>
      cellColumns.map((c) => {
        const colId = String(c.id);
        const label = labelOf(colId);
        const w = layout.widths[colId];
        const dir = sort?.colId === colId ? sort.dir : null;
        const filtered = isActiveChecklistFilter(filters[colId]);
        return {
          ...c,
          title: colId.startsWith("x:") ? (
            <ExtraColumnHead
              id={colId.slice(2)}
              label={label}
              dir={dir}
              filtered={filtered}
              onRename={renameColumn}
              onRemove={removeColumn}
              onSort={() => cycleSort(colId)}
              onOpenMenu={(anchor) => setMenu({ colId, label, anchor })}
              onResize={(px) => setWidth(colId, px)}
              onResetWidth={() => clearWidth(colId)}
              scale={scale}
            />
          ) : (
            <ColumnHead
              label={label}
              dir={dir}
              filtered={filtered}
              onSort={() => cycleSort(colId)}
              onOpenMenu={(anchor) => setMenu({ colId, label, anchor })}
              onResize={(px) => setWidth(colId, px)}
              onResetWidth={() => clearWidth(colId)}
              scale={scale}
            />
          ),
          ...(w === undefined ? null : { basis: w, grow: 0, shrink: 0, minWidth: w }),
        };
      }),
    [
      cellColumns,
      labelOf,
      layout.widths,
      filters,
      sort,
      cycleSort,
      setWidth,
      clearWidth,
      scale,
      renameColumn,
      removeColumn,
    ],
  );

  const gutterColumn = useMemo(
    () =>
      createGutterColumn<SheetLine>({
        onResizeRow: setRowHeight,
        onResetRow: () => setRowHeight(DEFAULT_ROW_HEIGHT),
        onResetAll: reset,
        canReset: customized,
        scale,
      }),
    [setRowHeight, reset, customized, scale],
  );

  // 배율 보정은 원장 시트와 같다 (CSS zoom 은 레이아웃을 축척한다)
  const gridHeight = Math.max(200, height / layout.zoom - ADD_ROW_BAR);
  const filterCount = activeChecklistFilterCount(filters);
  const pickedCol = picked?.colId ? labelOf(picked.colId) : null;

  return (
    <div>
      {/* ---- 툴바 ---- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-xs">
        <button
          type="button"
          onClick={addRowBelow}
          className="rounded border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50"
          title="고른 줄 바로 아래에 새 줄을 넣습니다 (고른 줄이 없으면 맨 끝)"
        >
          + 행 추가
          <span className="ml-1 font-normal text-zinc-400">
            {picked ? `${picked.rowMax + 1}행 아래` : "맨 끝"}
          </span>
        </button>
        <button
          type="button"
          onClick={addColumnRight}
          className="rounded border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50"
          title="고른 열 바로 오른쪽에 새 열을 만듭니다 (고른 열이 없으면 맨 오른쪽)"
        >
          + 열 추가
          <span className="ml-1 font-normal text-zinc-400">
            {pickedCol ? `${pickedCol} 오른쪽` : "맨 오른쪽"}
          </span>
        </button>

        <span className="ml-1 text-zinc-400">머리글을 누르면 정렬, 옆 화살표를 누르면 필터입니다.</span>

        <div className="ml-auto flex items-center gap-2">
          {filterCount > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
              {view.length} / {lines.length}줄 보임
            </span>
          )}
          {(filterCount > 0 || sort) && (
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setSort(null);
              }}
              className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100"
            >
              보기 초기화
              <span className="ml-1 font-normal">
                {filterCount > 0 ? `필터 ${filterCount}` : ""}
                {filterCount > 0 && sort ? " · " : ""}
                {sort ? `정렬 ${labelOf(sort.colId)}` : ""}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="ledger-sheet" style={{ zoom: layout.zoom }}>
        <DynamicDataSheetGrid<SheetLine>
          ref={gridRef}
          value={sheetRows}
          onChange={emit}
          columns={columns}
          gutterColumn={gutterColumn}
          rowKey="id"
          height={gridHeight}
          rowHeight={layout.rowHeight}
          headerRowHeight={36}
          createRow={() => toSheet(createRow())}
          // 복제한 줄은 새 줄이다 — id 를 물려받으면 두 줄이 한 몸으로 움직인다
          duplicateRow={({ rowData }) => ({ ...rowData, id: createRow().id })}
          rowClassName={({ rowData }) =>
            rowData.done ? "checklist-row-done" : hasActual(rowData) ? "checklist-row-actual" : undefined
          }
          // 마지막으로 고른 칸을 **기억한다**. 툴바 버튼을 누르는 순간
          // 그리드는 선택을 놓는데(바깥 클릭), 그때 자리를 잊으면 「행 추가」가
          // 늘 맨 끝에 붙어 버린다 — 버튼을 누르려면 반드시 바깥을 클릭해야
          // 하므로 사실상 위치 지정이 동작하지 않게 된다.
          onSelectionChange={({ selection }) => {
            if (selection) setPicked({ colId: selection.min.colId, rowMax: selection.max.row });
          }}
          addRowsComponent={KoAddRows}
          contextMenuComponent={KoContextMenu}
        />
      </div>

      {menu && (
        <ColumnMenu
          columnKey={menu.colId}
          range={isChecklistRangeKey(menu.colId)}
          label={menu.label}
          anchor={menu.anchor}
          sortDir={sort?.colId === menu.colId ? sort.dir : null}
          onSort={(dir) => setSort(dir === null ? null : { colId: menu.colId, dir })}
          filter={filters[menu.colId]}
          // 후보값은 **다른 열** 필터만 반영한다 (엑셀 자동필터와 같다)
          options={checklistOptions(applyChecklistFilters(lines, filters, menu.colId), menu.colId)}
          onFilterChange={(next: ColumnFilter | null) =>
            setFilters((f) => {
              const copy = { ...f };
              if (next === null) delete copy[menu.colId];
              else copy[menu.colId] = next;
              return copy;
            })
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ---- 사용자 열 머리글 -------------------------------------------

/**
 * 이름 칸이 곧 머리글이다. 따로 「이름 바꾸기」 메뉴를 두면 새로 만든 열의
 * 이름을 어디서 고치는지 찾아야 하는데, 여기서는 보이는 자리에 바로 친다.
 * 정렬은 이름 칸이 아니라 ▲ 버튼이 맡는다 — 이름을 고치려 눌렀다가 표가
 * 정렬되면 놀란다.
 */
function ExtraColumnHead({
  id,
  label,
  dir,
  filtered,
  onRename,
  onRemove,
  onSort,
  onOpenMenu,
  onResize,
  onResetWidth,
  scale,
}: {
  id: string;
  label: string;
  dir: "asc" | "desc" | null;
  filtered: boolean;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onSort: () => void;
  onOpenMenu: (anchor: DOMRect) => void;
  onResize: (px: number) => void;
  onResetWidth: () => void;
  scale: () => number;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="dsg-head">
      <input
        // key 를 이름에 묶어 두면 밖에서 이름이 바뀔 때 칸이 새로 그려진다
        key={label}
        defaultValue={label}
        className="dsg-head-input"
        title="열 이름 — 고쳐서 Enter"
        aria-label="열 이름"
        onMouseDown={stop}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== label) onRename(id, v);
          else e.target.value = label;
        }}
        onKeyDown={(e) => {
          const el = e.target as HTMLInputElement;
          if (e.key === "Enter") el.blur();
          if (e.key === "Escape") {
            el.value = label;
            el.blur();
          }
        }}
      />
      <button
        type="button"
        className="dsg-head-sort"
        title={`${label} 기준 정렬 (오름차순 → 내림차순 → 해제)`}
        aria-label={`${label} 기준 정렬`}
        onMouseDown={stop}
        onClick={onSort}
      >
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
      <button
        type="button"
        className="dsg-head-remove"
        title={`${label} 열 지우기`}
        aria-label={`${label} 열 지우기`}
        onMouseDown={stop}
        onClick={() => onRemove(id)}
      >
        ✕
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
