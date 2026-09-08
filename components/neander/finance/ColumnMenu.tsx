"use client";

// ============================================================
//  열 머리글 드롭다운 — 정렬 + 필터 (엑셀 자동필터)
// ------------------------------------------------------------
//  시트 안에 그리면 머리글 칸(overflow:hidden)과 그리드 스크롤에 잘리므로
//  document.body 로 포털을 띄우고 버튼 위치에 맞춰 고정 배치한다.
//
//  ⚠️ 그리드는 mousedown 을 document 에서 듣는다. 메뉴 안의 mousedown 을
//     여기서 끊지 않으면 클릭할 때마다 그리드가 선택을 초기화한다.
//     같은 리스너로 "바깥 클릭 = 닫기" 도 함께 처리한다.
// ============================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  isRangeKey,
  type ColumnFilter,
  type FilterKey,
  type FilterOption,
} from "@/lib/neander/finance/sheetFilter";

const MENU_WIDTH = 264;
const GAP = 4;

export function ColumnMenu({
  columnKey,
  range: rangeProp,
  label,
  anchor,
  sortDir,
  onSort,
  filter,
  options,
  onFilterChange,
  onClose,
}: {
  /** 열 id. 원장은 FilterKey, 체크리스트는 `x:<id>` 같은 자유 문자열도 온다 */
  columnKey: string;
  /** 숫자 범위로 거르는 열인가. 안 주면 원장 규칙으로 판단한다 */
  range?: boolean;
  label: string;
  /** 머리글 버튼의 화면 좌표 */
  anchor: DOMRect;
  sortDir: "asc" | "desc" | null;
  onSort: (dir: "asc" | "desc" | null) => void;
  filter: ColumnFilter | undefined;
  /** 다른 열 필터를 반영한 이 열의 후보값 */
  options: FilterOption[];
  onFilterChange: (next: ColumnFilter | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const range = rangeProp ?? isRangeKey(columnKey as FilterKey);

  // 바깥 클릭·Esc·스크롤로 닫는다. 메뉴 안의 mousedown 은 여기서 끊어
  // 그리드(document 리스너)까지 가지 않게 한다.
  useEffect(() => {
    const el = ref.current;
    const stop = (e: Event) => e.stopPropagation();
    el?.addEventListener("mousedown", stop);
    const onDocDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    // 그리드를 스크롤하면 머리글이 움직이므로 따라가지 않고 닫는다
    window.addEventListener("scroll", onClose, true);
    return () => {
      el?.removeEventListener("mousedown", stop);
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  // 화면 밖으로 나가지 않게 맞춘다
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + GAP, maxHeight: 420 });
  useLayoutEffect(() => {
    const left = Math.max(8, Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const top = anchor.bottom + GAP;
    setPos({ left, top, maxHeight: Math.max(220, window.innerHeight - top - 12) });
  }, [anchor]);

  const selected = useMemo(
    () => new Set(filter?.kind === "values" ? filter.values : []),
    [filter],
  );
  // 아무것도 안 고른 상태 = 필터 없음 = 전부 통과. 체크박스는 전부 켜서 보여준다.
  const noFilter = selected.size === 0;
  const isOn = (v: string) => noFilter || selected.has(v);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const allShownOn = shown.length > 0 && shown.every((o) => isOn(o.value));

  /** 현재 켜진 값 집합을 실제 배열로 (필터가 없으면 전체가 켜진 것) */
  const currentOn = () => new Set(noFilter ? options.map((o) => o.value) : selected);

  const commitValues = (next: Set<string>) => {
    // 전부 켜졌으면 필터를 없앤다 (필터 표시가 계속 켜져 있으면 헷갈린다)
    if (next.size === 0 || next.size === options.length) onFilterChange(null);
    else onFilterChange({ kind: "values", values: [...next] });
  };

  const toggle = (v: string) => {
    const next = currentOn();
    if (next.has(v)) next.delete(v);
    else next.add(v);
    commitValues(next);
  };
  const toggleAllShown = () => {
    const next = currentOn();
    if (allShownOn) shown.forEach((o) => next.delete(o.value));
    else shown.forEach((o) => next.add(o.value));
    commitValues(next);
  };
  const onlyThis = (v: string) => onFilterChange({ kind: "values", values: [v] });

  const rangeValue = filter?.kind === "range" ? filter : undefined;
  const setRange = (part: "min" | "max", raw: string) => {
    const n = raw.trim() === "" ? undefined : Number(raw.replace(/[^\d.-]/g, ""));
    const next = {
      kind: "range" as const,
      min: part === "min" ? n : rangeValue?.min,
      max: part === "max" ? n : rangeValue?.max,
    };
    if (next.min === undefined && next.max === undefined) onFilterChange(null);
    else onFilterChange(next);
  };

  const sortBtn = (dir: "asc" | "desc", text: string) => (
    <button
      type="button"
      onClick={() => onSort(sortDir === dir ? null : dir)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        sortDir === dir ? "bg-indigo-50 font-medium text-indigo-700" : "text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      <span className="w-3 text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>
      {text}
      {sortDir === dir && <span className="ml-auto text-[10px] text-indigo-500">해제</span>}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${label} 정렬·필터`}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-800 shadow-lg"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH, maxHeight: pos.maxHeight }}
    >
      <div className="border-b border-zinc-100 p-1.5">
        {sortBtn("asc", range ? "작은 값부터" : "오름차순 정렬")}
        {sortBtn("desc", range ? "큰 값부터" : "내림차순 정렬")}
      </div>

      {range ? (
        <div className="p-2.5">
          <p className="mb-1.5 text-[11px] font-medium text-zinc-500">금액 범위</p>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              placeholder="최소"
              defaultValue={rangeValue?.min ?? ""}
              onChange={(e) => setRange("min", e.target.value)}
              className="h-8 w-full rounded-md border border-zinc-300 px-2 text-xs tabular-nums outline-none focus:border-indigo-500"
            />
            <span className="text-xs text-zinc-400">~</span>
            <input
              type="number"
              placeholder="최대"
              defaultValue={rangeValue?.max ?? ""}
              onChange={(e) => setRange("max", e.target.value)}
              className="h-8 w-full rounded-md border border-zinc-300 px-2 text-xs tabular-nums outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="p-2 pb-1.5">
            <input
              autoFocus
              placeholder="값 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-indigo-500"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 border-b border-zinc-100 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50">
            <input type="checkbox" checked={allShownOn} onChange={toggleAllShown} className="accent-indigo-600" />
            {search ? "검색 결과 전체" : "전체 선택"}
            <span className="ml-auto text-[11px] font-normal text-zinc-400">{shown.length}</span>
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-xs text-zinc-400">일치하는 값이 없습니다</p>
            ) : (
              shown.map((o) => (
                <div key={o.value} className="group flex items-center gap-2 px-2.5 py-1 text-xs hover:bg-zinc-50">
                  <input
                    id={`f-${columnKey}-${o.value}`}
                    type="checkbox"
                    checked={isOn(o.value)}
                    onChange={() => toggle(o.value)}
                    className="accent-indigo-600"
                  />
                  <label
                    htmlFor={`f-${columnKey}-${o.value}`}
                    className={`min-w-0 flex-1 cursor-pointer truncate ${o.value === "" ? "text-zinc-400" : ""}`}
                    title={o.label}
                  >
                    {o.label}
                  </label>
                  <button
                    type="button"
                    onClick={() => onlyThis(o.value)}
                    className="hidden shrink-0 rounded px-1 text-[10px] text-indigo-600 hover:bg-indigo-50 group-hover:block"
                  >
                    이 값만
                  </button>
                  <span className="shrink-0 tabular-nums text-[11px] text-zinc-400 group-hover:hidden">
                    {o.count.toLocaleString("ko-KR")}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-between border-t border-zinc-100 px-2 py-1.5">
        <button
          type="button"
          onClick={() => onFilterChange(null)}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          이 열 필터 해제
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          닫기
        </button>
      </div>
    </div>,
    document.body,
  );
}
