"use client";

// ============================================================
//  열 머리글 드롭다운 — 정렬 + 필터 (엑셀 자동필터)
// ------------------------------------------------------------
//  공통 <Popover> 위에 그린다 (포탈·위치 계산·Esc·바깥 클릭은 거기서).
//  머리글은 버튼의 **화면 좌표(DOMRect)** 를 넘긴다 — 시트가 다시 그려지면
//  머리글 요소가 바뀌므로 요소 참조보다 좌표가 안정적이다. Popover 는
//  anchorRef 를 원하므로 좌표를 돌려주는 가상 요소를 만들어 넘긴다.
//
//  ⚠️ 그리드는 mousedown 을 document 에서 듣는다. 메뉴 안의 mousedown 을
//     여기서 끊지 않으면 클릭할 때마다 그리드가 선택을 초기화한다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, EyeOff } from "lucide-react";
import { Button, Checkbox, Icon, Input, Popover, cn } from "@/components/neander/ui";
import {
  isRangeKey,
  type ColumnFilter,
  type FilterKey,
  type FilterOption,
} from "@/lib/neander/finance/sheetFilter";

const MENU_WIDTH = 264;

/**
 * 좌표만 가진 가상 anchor. Popover(useAnchorPosition·useOutsideClick·
 * 포커스 복귀)가 부르는 메서드만 갖춘다.
 */
function virtualAnchor(rect: DOMRect): HTMLElement {
  return {
    getBoundingClientRect: () => rect,
    contains: () => false,
    focus: () => {},
  } as unknown as HTMLElement;
}

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
  onHide,
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
  /** 이 열을 화면에서 감춘다 (값은 그대로). 없으면 항목이 나오지 않는다 */
  onHide?: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const range = rangeProp ?? isRangeKey(columnKey as FilterKey);

  const anchorRef = useMemo(() => ({ current: virtualAnchor(anchor) }), [anchor]);

  // 메뉴 안의 mousedown 은 여기서 끊어 그리드(document 리스너)까지 가지 않게 한다.
  // 바깥 클릭·Esc 는 Popover 가 닫는다.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  // 그리드를 스크롤하면 머리글이 움직이므로 따라가지 않고 닫는다.
  // 메뉴 안(후보 목록)의 스크롤은 예외다.
  useEffect(() => {
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const selected = useMemo(
    () => new Set(filter?.kind === "values" ? filter.values : []),
    [filter],
  );
  // 아무것도 안 고른 상태 = 필터 없음 = 전부 통과. 체크박스는 전부 켜서 보여준다.
  const noFilter = selected.size === 0;
  const isOn = useCallback((v: string) => noFilter || selected.has(v), [noFilter, selected]);

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

  const sortBtn = (dir: "asc" | "desc", text: string) => {
    const on = sortDir === dir;
    return (
      <button
        type="button"
        onClick={() => onSort(on ? null : dir)}
        aria-pressed={on}
        className={cn(
          "flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-nd-table transition-colors duration-nd-fast",
          on ? "bg-nd-accent-soft font-medium text-nd-accent-strong" : "text-nd-fg hover:bg-nd-fg/[.06]",
        )}
      >
        <Icon icon={dir === "asc" ? ArrowUp : ArrowDown} size={13} className={on ? "text-nd-accent" : "text-nd-fg-3"} />
        {text}
        {on && <span className="ml-auto text-nd-micro text-nd-accent">해제</span>}
      </button>
    );
  };

  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-end"
      ariaLabel={`${label} 정렬·필터`}
      autoFocus={false}
      unpadded
      className="flex flex-col"
    >
      <div ref={panelRef} className="flex flex-col text-nd-fg" style={{ width: MENU_WIDTH }}>
        <div className="border-b border-nd-line p-1.5">
          {sortBtn("asc", range ? "작은 값부터" : "오름차순 정렬")}
          {sortBtn("desc", range ? "큰 값부터" : "내림차순 정렬")}
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-nd-table text-nd-fg transition-colors duration-nd-fast hover:bg-nd-fg/[.06]"
            >
              <Icon icon={EyeOff} size={13} className="text-nd-fg-3" />
              이 열 감추기
            </button>
          )}
        </div>

        {range ? (
          <div className="p-2.5">
            <p className="mb-1.5 text-nd-micro text-nd-fg-2">금액 범위</p>
            <div className="flex items-center gap-1.5">
              <Input
                size="sm"
                type="number"
                placeholder="최소"
                aria-label="최소 금액"
                defaultValue={rangeValue?.min ?? ""}
                onChange={(e) => setRange("min", e.target.value)}
                className="nd-num"
              />
              <span className="text-nd-caption text-nd-fg-3">~</span>
              <Input
                size="sm"
                type="number"
                placeholder="최대"
                aria-label="최대 금액"
                defaultValue={rangeValue?.max ?? ""}
                onChange={(e) => setRange("max", e.target.value)}
                className="nd-num"
              />
            </div>
          </div>
        ) : (
          <>
            <div className="p-2 pb-1.5">
              <Input
                size="sm"
                autoFocus
                placeholder="값 검색"
                aria-label="값 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 border-b border-nd-line px-2.5 py-1.5 text-nd-table font-medium hover:bg-nd-fg/[.04]">
              <Checkbox checked={allShownOn} onChange={toggleAllShown} />
              {search ? "검색 결과 전체" : "전체 선택"}
              <span className="nd-num ml-auto text-nd-micro font-normal text-nd-fg-3">{shown.length}</span>
            </label>
            <div className="nd-scroll max-h-[280px] min-h-0 overflow-y-auto py-1">
              {shown.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-nd-caption text-nd-fg-3">일치하는 값이 없습니다</p>
              ) : (
                shown.map((o) => (
                  <div key={o.value} className="group flex items-center gap-2 px-2.5 py-1 text-nd-table hover:bg-nd-fg/[.04]">
                    <Checkbox
                      id={`f-${columnKey}-${o.value}`}
                      checked={isOn(o.value)}
                      onChange={() => toggle(o.value)}
                    />
                    <label
                      htmlFor={`f-${columnKey}-${o.value}`}
                      className={cn("min-w-0 flex-1 cursor-pointer truncate", o.value === "" && "text-nd-fg-3")}
                      title={o.label}
                    >
                      {o.label}
                    </label>
                    <button
                      type="button"
                      onClick={() => onlyThis(o.value)}
                      className="hidden shrink-0 rounded-[6px] px-1 text-nd-micro text-nd-accent-strong hover:bg-nd-accent-soft group-hover:block"
                    >
                      이 값만
                    </button>
                    <span className="nd-num shrink-0 text-nd-micro font-normal text-nd-fg-3 group-hover:hidden">
                      {o.count.toLocaleString("ko-KR")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-between border-t border-nd-line px-1.5 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => onFilterChange(null)}>
            이 열 필터 해제
          </Button>
          <Button variant="soft" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </Popover>
  );
}
