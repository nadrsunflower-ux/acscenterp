"use client";

// ============================================================
//  거래 원장 — 스프레드시트처럼 셀 단위로 조회·수정
// ------------------------------------------------------------
//  구글 시트처럼 쓴다: 필터·동작 버튼은 위에 한 줄, 그 아래 얇은 상태
//  줄, 나머지는 전부 시트다. 페이지 높이를 뷰포트에 맞춰 잡고 시트가
//  남는 공간을 다 차지하게 한다 (본문 스크롤이 아니라 시트 스크롤).
//  합계는 **필터 결과 전체** 기준이다 (화면에 보이는 부분의 합이 아니다
//  — 그건 재무에서 오해를 부른다).
//
//  필터는 엑셀 자동필터처럼 **열 머리글 드롭다운**에 있다. 툴바에는
//  전체 검색만 남긴다 (열 하나에 매이지 않는 검색이라 성격이 다르다).
//
//  편집 모델: 셀을 고치면 서버에 바로 쓰지 않고 초안(edits)에 쌓는다.
//  "저장" 을 누르면 수정·추가·삭제를 한 요청으로 보낸다. 필터는 **원본
//  값** 기준으로 건다 — 거래유형 필터를 걸어둔 채 유형을 바꿔도 행이
//  눈앞에서 사라지지 않게 하기 위해서다. 초안이 있는 동안 필터를 바꿔도
//  초안은 id 로 따라다닌다.
//
//  화면 구성 (HIG 툴바: 기능별로 묶는다)
//    왼쪽  = 제목·건수 → 검색 → 연/월 → 필터 표시·해제
//    오른쪽 = [실행취소·다시실행] [배율] ＋행·－행 · ＋열·－열 · 열 · 내보내기
//             · 변경 취소 · 저장
//  행·열 버튼은 「＋ 행」처럼 부호와 대상만 쓴다 — 엑셀 툴바가 그렇듯 네 개가
//  나란히 설 때는 「행 추가/행 삭제/열 추가/열 삭제」 라고 다 적는 쪽이 오히려
//  읽기 느리다. 무슨 일이 일어나는지는 툴팁과 접근성 이름에 그대로 남긴다.
//  시트는 불투명 콘텐츠 표면이다 — 유리를 쓰지 않는다.
// ============================================================

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DataSheetGridRef } from "react-datasheet-grid";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Columns3,
  FileDown,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Redo2,
  SearchX,
  SlidersHorizontal,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  cn,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Money,
  Popover,
  SearchInput,
  Select,
  Tabs,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useShellFocus } from "@/components/neander/shell/context";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import {
  LedgerSheet,
  LEDGER_COLUMNS,
} from "@/components/neander/finance/LedgerSheet";
import { isTypingInto } from "@/components/neander/finance/sheetCells";
import {
  useSheetLayout,
  ZOOM_STEPS,
  DEFAULT_ZOOM,
  type SheetLayoutHandle,
} from "@/components/neander/finance/useSheetLayout";
import {
  applyFinEdits,
  deleteFinLedgerColumn,
  upsertFinLedgerColumn,
} from "@/lib/neander/finance/client";
import { exportLedgerXlsx } from "@/lib/neander/finance/export";
import type { FinTransaction } from "@/lib/neander/finance/types";
import {
  NEW_ID_PREFIX,
  accountIndex,
  blankRow,
  isBlankRow,
  isNewRow,
  rowsEqual,
  sortRows,
  toInput,
  toPatch,
  validateRow,
  type RowIssue,
  type SortKey,
  type SortSpec,
} from "@/lib/neander/finance/sheet";
import {
  activeFilterKeys,
  applyFilters,
  columnOptions,
  type ColumnFilter,
  type FilterKey,
  type Filters,
  monthsOfYear,
  periodOf,
  periodFilter,
} from "@/lib/neander/finance/sheetFilter";
import { filtersFromQuery } from "@/lib/neander/finance/ledgerLink";
import {
  SCOPE_TABS,
  inScope,
  paymentIndex,
  scopeCounts,
  type ScopeKey,
} from "@/lib/neander/finance/sheetScope";
import { todayStr } from "@/lib/neander/format";
import {
  totals,
  plOnly,
} from "@/lib/neander/finance/aggregate";

/** 연/월로 표현할 수 없는 선택 — 선택기에 그대로 드러낸다 */
const CUSTOM_PERIOD = "__custom__";

/**
 * 전체화면 상태 저장 키. sessionStorage 다 — 새로고침해도 유지되지만 탭을
 * 닫으면 잊는다. 다음 날 원장을 열었을 때 사이드바가 없이 시작하면 놀란다.
 */
const FOCUS_KEY = "neander.finance.ledger.focus";

/** 내보내기 파일명에 붙일 범위 이름 */
function anyFilterLabel(filterCount: number, search: string): string {
  return filterCount > 0 || search.trim() ? "필터결과" : "전체";
}

/** 초안 — 원본 위에 얹히는 변경분 */
interface Edits {
  /** 수정된 기존 행 (id → 바뀐 행 전체) */
  draft: Map<string, FinTransaction>;
  /** 아직 서버 id 가 없는 새 행 (표시 순서대로) */
  newRows: FinTransaction[];
  /** 삭제 표시된 기존 행 id */
  deleted: Set<string>;
  /**
   * 새 행 id → 그 바로 위에 끼울 기준 행 id.
   *
   * 새 행을 늘 맨 아래에 두면 "고른 행 위에 추가" 를 할 수 없고, 그렇다고
   * 정렬 결과 한가운데에 그냥 꽂으면 정렬이 바뀔 때 빈 행이 어디로 갔는지
   * 잃는다. 그래서 위치를 **기준 행 id** 로 기억한다 — 정렬·필터가 바뀌어도
   * 그 행 위에 붙고, 기준 행이 화면에서 사라지면 맨 아래로 내려간다.
   */
  anchors: Map<string, string>;
}
const EMPTY_EDITS: Edits = { draft: new Map(), newRows: [], deleted: new Set(), anchors: new Map() };

/**
 * 두 초안이 실질적으로 같은가.
 *
 * ⚠️ 정체성(===)으로 보면 안 된다. 시트는 값이 하나도 안 바뀌어도 onChange 를
 *    부르고, 그때마다 새 Map·Set·배열이 만들어진다. 그것을 되돌리기 스택에
 *    쌓으면 한 번 고친 것을 되돌리는 데 ⌘Z 를 세 번 눌러야 하고, 화면을 열자마자
 *    되돌릴 것이 있다고 나온다 — 실제로 그랬다.
 */
function editsEqual(a: Edits, b: Edits): boolean {
  if (a === b) return true;
  if (a.draft.size !== b.draft.size) return false;
  if (a.deleted.size !== b.deleted.size) return false;
  if (a.newRows.length !== b.newRows.length) return false;
  if (a.anchors.size !== b.anchors.size) return false;
  for (const [id, anchor] of a.anchors) if (b.anchors.get(id) !== anchor) return false;
  for (const [id, row] of a.draft) {
    const other = b.draft.get(id);
    if (!other || !rowsEqual(row, other)) return false;
  }
  for (const id of a.deleted) if (!b.deleted.has(id)) return false;
  for (let i = 0; i < a.newRows.length; i += 1) {
    if (a.newRows[i].id !== b.newRows[i].id || !rowsEqual(a.newRows[i], b.newRows[i])) return false;
  }
  return true;
}

/**
 * 실행취소 스택. 저장 **전** 초안에만 적용된다 — 이미 서버에 쓴 것을
 * 되돌리는 기능이 아니다 (그건 임포트 되돌리기처럼 별개 개념이다).
 * 한 단계 = 셀 하나 확정 / 붙여넣기 한 번 / 행 추가·삭제 한 번.
 */
interface History {
  past: Edits[];
  present: Edits;
  future: Edits[];
}
const EMPTY_HISTORY: History = { past: [], present: EMPTY_EDITS, future: [] };

const HISTORY_LIMIT = 100;

/**
 * 요소가 뷰포트 바닥까지 차지하도록 높이를 잰다. 상단에 무엇이 있든
 * (셸 헤더·재무 탭) 요소의 화면 위치로 계산하므로 레이아웃에 의존하지 않는다.
 *
 * ⚠️ `signal` 은 **창 크기 말고** 요소의 화면 위치를 바꾸는 것을 넘긴다
 *    (전체화면 토글 → 상단바·본문 여백이 사라진다). 이게 없으면 전체화면을
 *    켠 직후 옛 높이가 그대로 남아 바닥에 상단바+여백만큼(96px) 흰 자리가
 *    생긴다 — 창 크기를 한 번 건드려야 사라졌다.
 */
function useFillViewport<T extends HTMLElement>(enabled: boolean, signal?: unknown) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  // 로딩 중엔 요소가 없으므로 enabled 가 바뀔 때 다시 잰다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => {
      // 셸의 <main> 이 아래쪽 패딩을 갖고 있어 그만큼 빼야 본문 스크롤이 안 생긴다.
      // 바로 위 부모만 보면 안 된다 — 재무 레이아웃이 비서 패널 때문에 래퍼를
      // 한 겹 더 끼워서, 그 여백이 안 빠진 채 페이지가 40px 스크롤됐다.
      let pad = 0;
      for (let p = el.parentElement; p; p = p.parentElement) {
        pad += parseFloat(getComputedStyle(p).paddingBottom) || 0;
        if (p.tagName === "MAIN" || p === document.body) break;
      }
      setHeight(Math.max(320, window.innerHeight - el.getBoundingClientRect().top - pad));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, signal]);
  return { ref, height };
}

/** 자식이 실제로 받은 높이 — 시트에 넘겨 남는 공간을 꽉 채운다 */
function useMeasuredHeight<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return { ref, height };
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="text-nd-fg-3">
      {label} <span className="nd-num font-medium text-nd-fg">{children}</span>
    </span>
  );
}

export default function LedgerPage() {
  const { transactions, accounts, paymentMethods, ledgerColumns, loading, refresh } = useFinance();
  const confirm = useConfirm();
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>({});
  /** 결제수단 탭. 열 필터와 다른 축이라 필터가 아니라 보기로 둔다 */
  const [scope, setScope] = useState<ScopeKey>("all");
  const [search, setSearch] = useState("");

  /**
   * 리포트에서 넘어온 드릴다운 조건을 건다 (`?m=2026-07&amaj=운영비…`).
   *
   * useSearchParams 대신 마운트 후 window.location 을 읽는다 — 서버에서
   * 렌더할 때는 쿼리를 모르므로 초기 렌더를 양쪽 다 "필터 없음"으로 맞춰야
   * 하이드레이션이 어긋나지 않는다. 데이터 로딩 중이라 깜빡임도 없다.
   */
  useEffect(() => {
    const parsed = filtersFromQuery(window.location.search);
    if (!parsed) return;
    setFilters(parsed.filters);
    setSearch(parsed.search);
  }, []);

  /**
   * 전체화면 — 사이드바·상단바·여백을 걷어내고 원장이 창 전체가 된다
   * (엑셀을 켜 놓은 느낌). 셸이 실제로 감추는 건 useShellFocus 가 한다.
   * 브라우저 전체화면 API 는 쓰지 않는다 — 그러면 Esc 한 번에 셀 편집
   * 취소와 전체화면 해제가 같이 일어난다.
   */
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(FOCUS_KEY) === "1") setFocus(true);
    } catch {
      /* 저장소 접근 불가 — 기본값 유지 */
    }
  }, []);
  const toggleFocus = useCallback(() => {
    setFocus((v) => {
      try {
        sessionStorage.setItem(FOCUS_KEY, v ? "0" : "1");
      } catch {
        /* noop */
      }
      return !v;
    });
  }, []);
  useShellFocus(focus);

  // ⌘⇧F (윈도우: Ctrl+Shift+F) = 전체화면 켜고 끄기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      toggleFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus]);

  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const edits = history.present;
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** 상세(모달)로 열어둔 행 — 시트 초안에 적용만 하고 서버엔 쓰지 않는다 */
  const [detail, setDetail] = useState<FinTransaction | null>(null);

  const gridRef = useRef<DataSheetGridRef>(null);
  const newSeq = useRef(0);
  const createRow = useCallback(
    () => blankRow(`${NEW_ID_PREFIX}${++newSeq.current}`, todayStr()),
    [],
  );

  /** 초안을 바꾸는 유일한 통로 — 여기를 지나야 실행취소 스택에 쌓인다 */
  const commit = useCallback((next: (prev: Edits) => Edits) => {
    setHistory((h) => {
      const value = next(h.present);
      if (editsEqual(value, h.present)) return h;
      return {
        past: [...h.past, h.present].slice(-HISTORY_LIMIT),
        present: value,
        future: [],
      };
    });
  }, []);
  /** 저장·전체취소 후 — 되돌릴 대상이 사라졌으므로 스택도 비운다 */
  const resetEdits = useCallback(() => setHistory(EMPTY_HISTORY), []);

  const undo = useCallback(
    () =>
      setHistory((h) =>
        h.past.length === 0
          ? h
          : {
              past: h.past.slice(0, -1),
              present: h.past[h.past.length - 1],
              future: [h.present, ...h.future].slice(0, HISTORY_LIMIT),
            },
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        h.future.length === 0
          ? h
          : {
              past: [...h.past, h.present].slice(-HISTORY_LIMIT),
              present: h.future[0],
              future: h.future.slice(1),
            },
      ),
    [],
  );
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // ⌘Z / ⌘⇧Z (윈도우: Ctrl+Z / Ctrl+Y).
  // 셀·검색창에 **글자를 치고 있을 때만** 브라우저 기본 되돌리기에 맡긴다 —
  // 그게 "방금 친 글자"를 되돌리는 자연스러운 동작이다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (isTypingInto(e.target as HTMLElement | null)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /**
   * 머리글 이름 클릭은 순환(오름 → 내림 → 해제), 드롭다운은 방향 직접 지정.
   */
  const toggleSort = useCallback((key: SortKey, dir?: "asc" | "desc" | null) => {
    if (dir !== undefined) {
      setSort(dir === null ? null : { key, dir });
      return;
    }
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
  }, []);

  const setColumnFilter = useCallback((key: FilterKey, next: ColumnFilter | null) => {
    setFilters((f) => {
      const copy = { ...f };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  }, []);

  const byId = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const opts = useMemo(() => {
    const pick = (f: (t: FinTransaction) => string | undefined) =>
      [...new Set(transactions.map(f).filter(Boolean) as string[])].sort((a, b) =>
        a.localeCompare(b, "ko"),
      );
    return {
      bizMajors: pick((t) => t.bizMajor),
      bizMinors: pick((t) => t.bizMinor),
      acctMajors: pick((t) => t.acctMajor),
      sites: pick((t) => t.site),
    };
  }, [transactions]);

  // 필터는 원본 값 기준 (위 머리말 참고).
  // 전체 검색은 열에 매이지 않으므로 열 필터와 따로 건다.
  const searchMatch = useCallback(
    (t: FinTransaction) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [t.vendor, t.acctMinor, t.note, t.acctNote, t.last4, t.projectCode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    },
    [search],
  );

  const pmIndex = useMemo(() => paymentIndex(paymentMethods), [paymentMethods]);

  // 탭을 적용하기 **전**. 탭 건수는 여기서 센다 — 그래야 「법인카드 1,623」
  // 을 보고 누르면 정말 그만큼 나온다.
  const beforeScope = useMemo(
    () => applyFilters(transactions, filters).filter(searchMatch),
    [transactions, filters, searchMatch],
  );
  const counts = useMemo(() => scopeCounts(beforeScope, pmIndex), [beforeScope, pmIndex]);
  const filtered = useMemo(
    () => beforeScope.filter((t) => inScope(t, scope, pmIndex)),
    [beforeScope, scope, pmIndex],
  );

  /**
   * 드롭다운 후보값. 그 열 자신의 선택은 빼고 계산한다 — 안 그러면 체크를
   * 하나 풀 때마다 그 값이 목록에서 사라져 되돌릴 수 없다.
   */
  const optionsFor = useCallback(
    (key: FilterKey) =>
      columnOptions(
        applyFilters(transactions, filters, key)
          .filter(searchMatch)
          .filter((t) => inScope(t, scope, pmIndex)),
        key,
      ),
    [transactions, filters, searchMatch, scope, pmIndex],
  );

  // 시트에 보이는 행 = 필터 결과(삭제 제외, 초안 덮어쓰기) + 새 행.
  // 아직 저장 안 된 새 행은 정렬과 무관하게 항상 맨 아래에 둔다 —
  // 빈 행이 정렬 결과 한가운데로 끼어들면 어디에 입력 중이었는지 잃는다.
  const rows = useMemo(() => {
    const base = sortRows(
      filtered.filter((t) => !edits.deleted.has(t.id)).map((t) => edits.draft.get(t.id) ?? t),
      sort,
    );
    // 새 행은 기준 행 바로 위에. 기준이 없거나 지금 화면에 없으면 맨 아래.
    const out = [...base];
    edits.newRows.forEach((r) => {
      const anchor = edits.anchors.get(r.id);
      const at = anchor ? out.findIndex((x) => x.id === anchor) : -1;
      if (at >= 0) out.splice(at, 0, r);
      else out.push(r);
    });
    return out;
  }, [filtered, edits, sort]);

  /**
   * 시트가 돌려준 전체 행을 원본과 대조해 초안을 다시 만든다.
   * 원본과 같아졌으면 초안에서 빼고, 화면에 있던 행이 없어졌으면 삭제다.
   */
  const onSheetChange = useCallback(
    (next: FinTransaction[]) => {
      commit((prev) => {
        const draft = new Map(prev.draft);
        const deleted = new Set(prev.deleted);
        const newRows: FinTransaction[] = [];
        const seen = new Set<string>();
        next.forEach((r) => {
          seen.add(r.id);
          if (isNewRow(r)) {
            newRows.push(r);
            return;
          }
          const orig = byId.get(r.id);
          if (!orig) return;
          if (rowsEqual(orig, r)) draft.delete(r.id);
          else draft.set(r.id, r);
        });
        /**
         * 새 행의 순서는 **만든 순서**로 고정한다.
         *
         * 시트는 화면 순서대로 돌려주는데, 기준 행 위에 꽂은 새 행은 화면에서
         * 앞으로 올라간다. 그 순서를 그대로 받으면 값이 하나도 안 바뀌었는데도
         * 배열 순서만 달라져 되돌리기 단계가 하나 더 생긴다 — 행을 두 번 넣고
         * ⌘Z 를 세 번 눌러야 했던 이유다. 화면 순서는 rows 조립이 정한다.
         */
        const order = new Map(prev.newRows.map((r, i) => [r.id, i]));
        newRows.sort(
          (a, b) =>
            (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );

        // 없어진 새 행의 기준은 같이 버린다 (안 그러면 영영 남는다)
        const anchors = new Map<string, string>();
        newRows.forEach((r) => {
          const a = prev.anchors.get(r.id);
          if (a) anchors.set(r.id, a);
        });
        filtered.forEach((t) => {
          if (!deleted.has(t.id) && !seen.has(t.id)) {
            deleted.add(t.id);
            draft.delete(t.id);
          }
        });
        return { draft, newRows, deleted, anchors };
      });
    },
    [byId, filtered, commit],
  );

  // ---- 검증 ----------------------------------------------------
  const acctIndex = useMemo(() => accountIndex(accounts), [accounts]);
  const issues = useMemo(() => {
    const m = new Map<string, RowIssue[]>();
    const check = (t: FinTransaction) => {
      if (isNewRow(t) && isBlankRow(t)) return; // 빈 새 행은 저장 대상이 아니다
      const found = validateRow(t, { accounts: acctIndex, paymentMethods });
      if (found.length) m.set(t.id, found);
    };
    edits.draft.forEach(check);
    edits.newRows.forEach(check);
    return m;
  }, [edits, acctIndex, paymentMethods]);

  const dirtyIds = useMemo(() => new Set(edits.draft.keys()), [edits.draft]);
  const blankNew = edits.newRows.filter(isBlankRow).length;
  const insertCount = edits.newRows.length - blankNew;
  const dirtyCount = edits.draft.size + insertCount + edits.deleted.size;

  // 초안이 있으면 탭을 닫기 전에 묻는다
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  // 합계는 필터 결과 전체 기준 — 초안을 반영해서 보여준다
  const sum = useMemo(() => totals(plOnly(rows)), [rows]);

  // ---- 저장 / 취소 ---------------------------------------------
  const save = async () => {
    if (issues.size > 0 || dirtyCount === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await applyFinEdits({
        updates: [...edits.draft.values()].map((t) => ({ id: t.id, patch: toPatch(t) })),
        inserts: edits.newRows.filter((t) => !isBlankRow(t)).map(toInput),
        deletes: [...edits.deleted],
      });
      resetEdits();
      setNotice({
        kind: "ok",
        text:
          `저장했습니다 — 수정 ${res.updated}건 · 추가 ${res.inserted}건 · 삭제 ${res.deleted}건` +
          (blankNew ? ` (빈 행 ${blankNew}개는 저장하지 않음)` : ""),
      });
      await refresh();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (dirtyCount > 0) {
      const ok = await confirm({
        title: `변경 ${dirtyCount.toLocaleString("ko-KR")}건을 모두 버릴까요?`,
        message: "저장하지 않은 수정·추가·삭제가 전부 사라집니다. 되돌릴 수 없습니다.",
        confirmLabel: "모두 버리기",
        tone: "danger",
      });
      if (!ok) return;
    }
    resetEdits();
    setNotice(null);
  };

  // ---- 선택 --------------------------------------------------
  /**
   * 시트가 알려준 선택 범위. 「행 삭제」 가 이걸 보고 동작한다.
   *
   * 오른쪽 클릭 메뉴에도 삭제가 있지만 그것만으로는 아무도 찾지 못했다.
   * 행을 고르고 Delete 를 누르면 스프레드시트 관례대로 **셀 값만** 지워져서,
   * 지운 것 같은데 행은 그대로 남는다 — 그게 "삭제가 안 된다" 의 정체였다.
   * 그래서 「행 추가」 옆에 같은 무게의 버튼을 두고 고른 수를 함께 보여준다.
   */
  const [selRange, setSelRange] = useState<{
    from: number;
    to: number;
    colId?: string;
    /** 고른 사각형이 모든 열을 덮는가 — 행 선택과 열 선택을 가른다 */
    allColumns: boolean;
  } | null>(null);

  /**
   * 시트가 알려주는 선택을 받는다. 두 가지를 막아야 한다.
   *
   * ① null 무시 — 버튼을 누르는 순간 시트가 포커스를 잃으며 null 이 온다.
   *    그대로 받으면 「행 삭제」 는 언제나 빈 선택으로 돌아 아무 일도 안 한다.
   * ② 같은 범위면 상태를 그대로 둔다 — 시트는 매번 새 객체를 주므로, 값이
   *    같아도 갱신하면 렌더 → 통지 → 렌더 로 끝없이 돈다.
   */
  const setSelection = useCallback(
    (r: { from: number; to: number; colId?: string; allColumns: boolean } | null) => {
      if (!r) return;
      setSelRange((prev) =>
        prev &&
        prev.from === r.from &&
        prev.to === r.to &&
        prev.colId === r.colId &&
        prev.allColumns === r.allColumns
          ? prev
          : r,
      );
    },
    [],
  );

  /**
   * 열만 고른 상태인가.
   *
   * 시트는 머리글을 눌러 **열을 통째로** 고른 것도 "1행부터 끝행까지" 라는
   * 사각형으로 알려 준다. 그래서 행만 세면 열 하나를 고른 사람이 「－ 행
   * (11,320)」 을 보게 되고, 열 지우려다 한 번 잘못 누르면 장부 전체가
   * 삭제 대상이 됐다.
   *
   * 가르는 기준은 **열 범위**다. 행번호를 눌러·끌어 고른 행 선택과 ⌘A 는
   * 언제나 모든 열을 덮지만, 머리글로 고른 열 선택은 그 열만 덮는다.
   * 행이 한 줄뿐이면 어떤 선택이든 "모든 행" 이라 이 판단을 쓰지 않는다.
   */
  const columnPicked =
    !!selRange &&
    !selRange.allColumns &&
    rows.length > 1 &&
    selRange.from === 0 &&
    selRange.to >= rows.length - 1;

  /** 행 동작(＋행·－행·⌘⌫)이 볼 선택. 열만 고른 상태면 없다 */
  const rowPick = columnPicked ? null : selRange;

  const selectedRows = useMemo(
    () => (rowPick ? rows.slice(rowPick.from, rowPick.to + 1) : []),
    [rowPick, rows],
  );

  /** 고른 행이 있으면 그 **바로 위**에, 없으면 맨 아래에 새 행을 넣는다 */
  const addRow = () => {
    const row = createRow();
    const anchor = rowPick ? rows[rowPick.from]?.id : undefined;
    const at = anchor ? rows.findIndex((r) => r.id === anchor) : -1;
    const index = at >= 0 ? at : rows.length;
    commit((prev) => ({
      ...prev,
      newRows: [...prev.newRows, row],
      anchors: anchor ? new Map(prev.anchors).set(row.id, anchor) : prev.anchors,
    }));
    // 새 행이 그려진 뒤 첫 셀로 커서를 옮긴다
    requestAnimationFrame(() => gridRef.current?.setActiveCell({ col: 0, row: index }));
  };

  // ---- 행 삭제 --------------------------------------------------
  const deleteSelected = useCallback(async () => {
    if (selectedRows.length === 0) return;
    // 저장된 행이 하나라도 섞였으면 묻는다. 새 행만이면 되돌리기 쉬우니 그냥 지운다.
    if (selectedRows.some((r) => !isNewRow(r))) {
      const ok = await confirm({
        title: `${selectedRows.length.toLocaleString("ko-KR")}행을 삭제할까요?`,
        message:
          "「저장」 을 눌러야 장부에서 실제로 지워집니다. 그 전까지는 「변경 취소」 로 되돌릴 수 있습니다.",
        confirmLabel: "삭제",
        tone: "danger",
      });
      if (!ok) return;
    }
    const ids = new Set(selectedRows.map((r) => r.id));
    onSheetChange(rows.filter((r) => !ids.has(r.id)));
    setSelRange(null);
    gridRef.current?.setSelection(null);
  }, [selectedRows, rows, onSheetChange, confirm]);

  // ⌘⌫ (Ctrl+Backspace) = 고른 행 삭제. 맨 Delete 는 셀 값 지우기로 남겨 둔다 —
  // 스프레드시트에서 그게 관례라 바꾸면 다른 것이 깨진다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Backspace") return;
      if (isTypingInto(e.target as HTMLElement | null)) return;
      e.preventDefault();
      void deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected]);

  // ---- 열 추가·삭제 ----------------------------------------------
  /**
   * 고른 열. `x:` 로 시작하면 사람이 덧붙인 열, 아니면 회계 고정 열이다.
   *
   * 고정 열은 지울 수 없다 — 거래일·금액·계정은 집계·검증·내보내기가 전부
   * 의존한다. 그래서 「열 삭제」 는 고정 열이면 **감추고**, 덧붙인 열이면
   * 정의를 지운다(거래에 남은 값은 그대로 둔다. 되살리면 다시 보인다).
   */
  const selColId = selRange?.colId;
  const selCustom = selColId?.startsWith("x:") ? ledgerColumns.find((c) => `x:${c.id}` === selColId) : undefined;
  const selFixedLabel = selColId && !selColId.startsWith("x:")
    ? LEDGER_COLUMNS.find((c) => c.key === selColId)?.label
    : undefined;

  const [addingCol, setAddingCol] = useState(false);
  /** 표 편집 도구 줄을 폈는가 — 매번 쓰는 컨트롤과 가끔 쓰는 것을 갈라 둔다 */
  const [tools, setTools] = useState(false);
  const [colBusy, setColBusy] = useState(false);

  const addColumn = async (label: string) => {
    setColBusy(true);
    try {
      // 고른 열 바로 왼쪽에. 고른 열이 없으면 맨 오른쪽.
      await upsertFinLedgerColumn({
        label,
        before: selColId && !selColId.startsWith("x:") ? selColId : undefined,
      });
      setAddingCol(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "열을 만들지 못했습니다.");
    } finally {
      setColBusy(false);
    }
  };

  const removeColumn = async () => {
    if (selCustom) {
      const ok = await confirm({
        title: `「${selCustom.label}」 열을 지울까요?`,
        message: "적어 둔 값은 지우지 않습니다. 같은 이름으로 다시 만들면 그대로 다시 보입니다.",
        confirmLabel: "열 지우기",
        tone: "danger",
      });
      if (!ok) return;
      setColBusy(true);
      try {
        await deleteFinLedgerColumn(selCustom.id);
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "열을 지우지 못했습니다.");
      } finally {
        setColBusy(false);
      }
      return;
    }
    if (selColId) {
      // 회계 고정 열 — 지우지 않고 감춘다
      sheet.setColumnHidden(selColId, true);
      toast.info(`「${selFixedLabel ?? selColId}」 열을 감췄습니다. 「열」 에서 다시 보일 수 있습니다.`);
    }
  };

  // ---- 상세 모달 → 초안에 적용 -----------------------------------
  const applyDetail = async (patch: Partial<FinTransaction>) => {
    if (!detail) return;
    const merged: FinTransaction = { ...detail, ...patch };
    commit((prev) => {
      if (isNewRow(detail)) {
        return { ...prev, newRows: prev.newRows.map((r) => (r.id === detail.id ? merged : r)) };
      }
      const draft = new Map(prev.draft);
      const orig = byId.get(detail.id);
      if (orig && rowsEqual(orig, merged)) draft.delete(detail.id);
      else draft.set(detail.id, merged);
      return { ...prev, draft };
    });
  };
  const deleteDetail = async () => {
    if (!detail) return;
    commit((prev) => {
      if (isNewRow(detail)) {
        return { ...prev, newRows: prev.newRows.filter((r) => r.id !== detail.id) };
      }
      const draft = new Map(prev.draft);
      draft.delete(detail.id);
      return { ...prev, draft, deleted: new Set(prev.deleted).add(detail.id) };
    });
  };

  // 장부에 있는 달·해. **필터를 걸기 전** 전체 기준이어야 선택지가 줄지 않는다
  //  — 7월을 고르는 순간 목록에 7월만 남으면 다른 달로 옮겨갈 수가 없다.
  const allMonths = useMemo(
    () =>
      [
        ...new Set(
          transactions
            .map((t) => (t.date ?? "").slice(0, 7))
            .filter((m) => /^\d{4}-\d{2}$/.test(m)),
        ),
      ]
        .sort()
        .reverse(),
    [transactions],
  );
  const years = useMemo(() => [...new Set(allMonths.map((m) => m.slice(0, 4)))], [allMonths]);
  const period = periodOf(filters.date, allMonths);

  const filterCount = activeFilterKeys(filters).length;
  // 파일명에 쓸 범위 이름 — 거래일 필터로 한 달만 골랐으면 그 달을 쓴다
  const dateFilter = filters.date;
  const periodLabel =
    dateFilter?.kind === "values" && dateFilter.values.length === 1
      ? dateFilter.values[0]
      : period.year && !period.month && !period.custom && filterCount === 1 && !search.trim()
        ? `${period.year}년`
        : anyFilterLabel(filterCount, search);
  // 탭을 좁혀 놓고 내보냈는데 파일명이 「전체」면 나중에 그 파일이 뭔지 모른다
  const scopeLabel = SCOPE_TABS.find((t) => t.key === scope)?.label ?? "";
  const exportScope = scope === "all" ? periodLabel : `${scopeLabel}_${periodLabel}`;
  const anyFilter = filterCount > 0 || search.trim() !== "";
  /** 필터든 탭이든 범위를 좁힌 상태인가 — 빈 표 안내 문구를 가른다 */
  const narrowed = anyFilter || scope !== "all";
  const resetFilters = () => {
    setFilters({});
    setSearch("");
  };

  const page = useFillViewport<HTMLDivElement>(!loading, focus);
  const slot = useMeasuredHeight<HTMLDivElement>(!loading);
  // 열 너비·행 높이·배율. 배율 조절이 툴바에 있어서 페이지가 들고 있다.
  const sheet = useSheetLayout();

  if (loading) {
    return <LoadingState label="장부를 불러오는 중…" />;
  }

  const firstIssues = [...issues.entries()].slice(0, 3);

  // 「미지정」은 있을 때만 보인다 — 0건짜리 탭은 누를 이유가 없고,
  // 반대로 1건이라도 있으면 반드시 보여야 한다. 계좌·카드만 두면
  // 마스터에 없는 결제수단이 어느 탭에도 안 나오면서 전체 건수와만
  // 어긋나기 때문이다.
  const scopeTabs = SCOPE_TABS.filter((t) => t.key !== "unknown" || counts.unknown > 0).map((t) => ({
    key: t.key,
    label: t.label,
    badge: counts[t.key],
    badgeLabel: `${t.label} ${counts[t.key].toLocaleString("ko-KR")}건`,
  }));

  return (
    <div
      ref={page.ref}
      className="flex min-h-0 flex-col"
      style={{ height: page.height || undefined }}
    >
      <Card
        padding="none"
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          // 전체화면: 창 가장자리까지 — 모서리·그림자가 있으면 창 안의 창처럼 보인다
          focus && "rounded-none shadow-none",
        )}
      >
        {/* ---- 툴바: 검색 + 동작 버튼 (열 필터는 머리글 드롭다운에) ------ */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-nd-line px-3 py-2">
          <h1 className="mr-1 flex items-baseline gap-1.5 text-nd-section text-nd-fg">
            거래 원장
            <span className="nd-num text-nd-caption font-normal text-nd-fg-3">
              {transactions.length.toLocaleString("ko-KR")}건
            </span>
          </h1>
          <SearchInput
            className="w-52"
            value={search}
            onValueChange={setSearch}
            placeholder="거래처·계정·비고 검색"
            ariaLabel="거래 검색"
          />
          {/* 기간 — 거래일 열 필터와 같은 값을 읽고 쓴다.
              따로 상태를 두면 툴바엔 「2026년」인데 실제로는 7월만 걸린 표가 된다. */}
          <Select
            size="sm"
            aria-label="연도로 거르기"
            title="연도로 거르기"
            className="w-auto"
            value={period.custom ? CUSTOM_PERIOD : period.year}
            onChange={(e) => {
              const y = e.target.value;
              if (y === CUSTOM_PERIOD) return; // 표시 전용
              setColumnFilter("date", periodFilter(allMonths, y, ""));
            }}
          >
            <option value="">전체 기간</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
            {period.custom && <option value={CUSTOM_PERIOD}>직접 선택</option>}
          </Select>
          <Select
            size="sm"
            aria-label="월로 거르기"
            className="w-auto"
            value={period.month}
            disabled={!period.year || period.custom}
            onChange={(e) => setColumnFilter("date", periodFilter(allMonths, period.year, e.target.value))}
            title={period.custom ? "머리글에서 달을 직접 고른 상태입니다" : "월로 거르기"}
          >
            <option value="">연 전체</option>
            {/* allMonths 는 최신순이라 뒤집어 1월 → 12월 로 보여준다 */}
            {[...monthsOfYear(allMonths, period.year)].reverse().map((m) => (
              <option key={m} value={m.slice(5, 7)}>
                {Number(m.slice(5, 7))}월
              </option>
            ))}
          </Select>
          {filterCount > 0 && <Badge tone="accent">열 필터 {filterCount}개</Badge>}
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              필터 해제
            </Button>
          )}
          {sort && (
            <Button variant="ghost" size="sm" onClick={() => setSort(null)}>
              정렬 해제
            </Button>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <IconButton
              icon={focus ? Minimize2 : Maximize2}
              label={focus ? "전체화면 끝내기 (⌘⇧F)" : "전체화면 (⌘⇧F)"}
              size="sm"
              pill
              active={focus}
              onClick={toggleFocus}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={addRow}
              aria-label="행 추가"
              title={
                selectedRows.length > 0
                  ? "고른 행 바로 위에 새 행"
                  : "맨 아래에 새 행 (행을 고르면 그 위에 들어갑니다)"
              }
            >
              행
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Minus}
              onClick={() => void deleteSelected()}
              disabled={selectedRows.length === 0}
              aria-label="행 삭제"
              title={
                columnPicked
                  ? "열을 고른 상태입니다. 지울 행은 행 번호를 클릭하거나 끌어서 고르세요"
                  : selectedRows.length === 0
                    ? "지울 행을 먼저 고르세요 (행 번호를 클릭하거나 끌어서 여러 행)"
                    : "고른 행 삭제 (⌘⌫)"
              }
            >
              행
              {selectedRows.length > 0 && (
                <span className="nd-num">({selectedRows.length.toLocaleString("ko-KR")})</span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={saving || dirtyCount === 0}
            >
              변경 취소
            </Button>
            <Button
              size="sm"
              onClick={save}
              loading={saving}
              disabled={dirtyCount === 0 || issues.size > 0}
            >
              {dirtyCount > 0 ? `저장 (${dirtyCount.toLocaleString("ko-KR")})` : "저장"}
            </Button>
            {/*
              표를 고치는 도구(되돌리기 · 배율 · 열 · 내보내기)는 접어 둔다.
              한 줄에 열다섯 개를 늘어놓으면 매번 쓰는 검색·저장이 그 사이에
              묻힌다 (승인 목업의 「상세 분석 도구」와 같은 처리). 접혀 있어도
              ⌘Z · ⌘⇧Z · ⌘⌫ 단축키는 그대로 듣는다.
            */}
            <Button
              variant={tools ? "soft" : "secondary"}
              size="sm"
              icon={SlidersHorizontal}
              trailingIcon={tools ? ChevronUp : ChevronDown}
              onClick={() => setTools((v) => !v)}
              aria-expanded={tools}
              aria-controls="ledger-tools"
              title="되돌리기 · 표 배율 · 열 관리 · 엑셀 내보내기"
            >
              표 도구
            </Button>
          </div>
        </div>

        {/* ---- 표 편집 도구 (접힘) -------------------------------------- */}
        {/* hidden 속성은 UA 기본값(display:none)이라 flex 유틸이 붙으면 이긴다.
            그래서 감추는 껍데기에는 display 클래스를 두지 않고 안쪽에서 편다. */}
        <div
          id="ledger-tools"
          hidden={!tools}
          className="shrink-0 border-b border-nd-line bg-nd-sunken px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ButtonGroup label="실행취소">
              <IconButton
                icon={Undo2}
                label="실행취소 (⌘Z)"
                size="sm"
                pill
                onClick={undo}
                disabled={!canUndo}
              />
              <IconButton
                icon={Redo2}
                label="다시 실행 (⌘⇧Z)"
                size="sm"
                pill
                onClick={redo}
                disabled={!canRedo}
              />
            </ButtonGroup>
            {/* 표 배율 — 구글 스프레드시트처럼 단계로 */}
            <ButtonGroup label="표 배율">
              <IconButton
                icon={ZoomOut}
                label="표 축소"
                size="sm"
                pill
                onClick={() => sheet.stepZoom(-1)}
                disabled={sheet.layout.zoom <= ZOOM_STEPS[0]}
              />
              <button
                type="button"
                onClick={() => sheet.setZoom(DEFAULT_ZOOM)}
                title="100% 로"
                aria-label={`표 배율 ${Math.round(sheet.layout.zoom * 100)}% — 누르면 100% 로`}
                className="nd-num h-ctl-sm min-w-[3rem] rounded-full px-1.5 text-nd-caption font-medium text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg"
              >
                {Math.round(sheet.layout.zoom * 100)}%
              </button>
              <IconButton
                icon={ZoomIn}
                label="표 확대"
                size="sm"
                pill
                onClick={() => sheet.stepZoom(1)}
                disabled={sheet.layout.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              />
            </ButtonGroup>
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setAddingCol(true)}
              disabled={colBusy}
              aria-label="열 추가"
              title={
                selColId && !selColId.startsWith("x:")
                  ? `「${selFixedLabel}」 왼쪽에 새 열`
                  : "맨 오른쪽에 새 열 (열을 고르면 그 왼쪽에 들어갑니다)"
              }
            >
              열
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Minus}
              onClick={() => void removeColumn()}
              disabled={!selColId || colBusy}
              aria-label="열 삭제"
              title={
                selCustom
                  ? `「${selCustom.label}」 열 지우기`
                  : selFixedLabel
                    ? `「${selFixedLabel}」 감추기 (회계 열이라 지울 수 없습니다)`
                    : "지울 열을 먼저 고르세요 (머리글 아래 칸을 클릭)"
              }
            >
              열
            </Button>
            <ColumnsButton sheet={sheet} />
            <Button
              variant="secondary"
              size="sm"
              icon={FileDown}
              disabled={rows.length === 0}
              onClick={() =>
                exportLedgerXlsx(
                  rows,
                  accounts,
                  paymentMethods,
                  `통합거래장_${exportScope}.xlsx`,
                )
              }
            >
              엑셀 내보내기
            </Button>
          </div>
        </div>

        {/* ---- 결제수단 탭 --------------------------------------------- */}
        <Tabs
          size="sm"
          ariaLabel="결제수단"
          className="shrink-0 px-3"
          items={scopeTabs}
          value={scope}
          onChange={(k) => setScope(k as ScopeKey)}
        />

        {/* ---- 상태 줄: 합계 + 초안 상태 ------------------------------- */}
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b px-3 py-1.5 text-nd-caption",
            dirtyCount > 0 ? "border-nd-warning/30 bg-nd-warning-soft" : "border-nd-line bg-nd-sunken",
          )}
        >
          <Stat label="검색 결과">{rows.length.toLocaleString("ko-KR")}건</Stat>
          <Stat label="수입"><Money value={sum.income} unit={false} /></Stat>
          <Stat label="지출"><Money value={sum.expense} unit={false} /></Stat>
          <Stat label="환급"><Money value={sum.refund} unit={false} /></Stat>
          <Stat label="순손익"><Money value={sum.net} unit={false} className="font-semibold" /></Stat>

          <span className="ml-auto flex flex-wrap items-center gap-x-3" role="status" aria-live="polite">
            {dirtyCount > 0 ? (
              <>
                <span className="font-medium text-nd-fg">
                  저장 안 된 변경 {dirtyCount.toLocaleString("ko-KR")}건
                  <span className="ml-1.5 font-normal text-nd-fg-2">
                    (수정 {edits.draft.size} · 추가 {insertCount} · 삭제 {edits.deleted.size}
                    {blankNew > 0 && ` · 빈 행 ${blankNew} 저장 안 함`})
                  </span>
                </span>
                {issues.size > 0 && (
                  <span className="text-nd-danger-text">
                    오류 {issues.size}행 — 빨간 셀을 고쳐야 저장됩니다
                    {firstIssues.length > 0 &&
                      ` (${firstIssues.map(([, is]) => is[0].message).join(", ")}${issues.size > firstIssues.length ? " …" : ""})`}
                  </span>
                )}
                {notice?.kind === "error" && <span className="text-nd-danger-text">{notice.text}</span>}
              </>
            ) : notice ? (
              <span className={notice.kind === "ok" ? "text-nd-success-text" : "text-nd-danger-text"}>
                {notice.text}
              </span>
            ) : null}
          </span>
        </div>

        {/* ---- 시트: 남는 공간 전부 ------------------------------------ */}
        <div ref={slot.ref} className="min-h-0 flex-1 overflow-hidden bg-nd-content">
          {rows.length === 0 ? (
            <div className="p-8">
              {narrowed ? (
                <EmptyState
                  icon={SearchX}
                  title="조건에 맞는 거래가 없습니다"
                  description={
                    scope === "all"
                      ? "필터를 풀거나 검색어를 바꿔보세요."
                      : `「${scopeLabel}」 탭에는 없습니다. 다른 탭을 보거나 필터를 풀어보세요.`
                  }
                  action={
                    anyFilter && (
                      <Button variant="secondary" size="sm" onClick={resetFilters}>
                        필터 해제
                      </Button>
                    )
                  }
                />
              ) : (
                <EmptyState
                  icon={BookOpen}
                  title="거래가 없습니다"
                  description="행 추가를 누르거나 엑셀 임포트로 장부를 올리세요."
                  action={
                    <Button variant="secondary" size="sm" icon={Plus} onClick={addRow}>
                      행 추가
                    </Button>
                  }
                />
              )}
            </div>
          ) : slot.height > 0 ? (
            <LedgerSheet
              gridRef={gridRef}
              rows={rows}
              onChange={onSheetChange}
              accounts={accounts}
              paymentMethods={paymentMethods}
              sites={opts.sites}
              issues={issues}
              dirtyIds={dirtyIds}
              createRow={createRow}
              onDetail={setDetail}
              sort={sort}
              onSort={toggleSort}
              filters={filters}
              onFilterChange={setColumnFilter}
              optionsFor={optionsFor}
              height={slot.height}
              sheet={sheet}
              ledgerColumns={ledgerColumns}
              onSelectionChange={setSelection}
            />
          ) : null}
        </div>
      </Card>

      <AddColumnDialog
        open={addingCol}
        busy={colBusy}
        beside={selFixedLabel}
        onClose={() => setAddingCol(false)}
        onAdd={addColumn}
      />

      {detail && (
        <TransactionEditor
          tx={detail}
          isNew={isNewRow(detail)}
          saveLabel="시트에 적용"
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={opts.bizMinors}
          onSave={applyDetail}
          onDelete={isNewRow(detail) ? undefined : deleteDetail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * 열 관리 — 어떤 열을 볼지 고른다.
 *
 * ⚠️ 「삭제」 가 아니라 「감추기」 다. 원장의 열은 집계·검증·엑셀 내보내기가
 *    전부 의존하는 회계 항목이라 값을 지울 수 없다. 사람이 실제로 원하는 것은
 *    "이 화면에서 안 보이게" 이고, 그래서 열 너비처럼 이 기기에만 남는다.
 */
function ColumnsButton({ sheet }: { sheet: SheetLayoutHandle }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const hidden = useMemo(() => new Set(sheet.layout.hidden), [sheet.layout.hidden]);
  const shown = LEDGER_COLUMNS.length - hidden.size;

  return (
    <>
      <Button
        ref={btnRef}
        variant="secondary"
        size="sm"
        icon={Columns3}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="볼 열 고르기"
        title="볼 열 고르기"
      >
        {hidden.size > 0 && (
          <span className="nd-num text-nd-fg-3">
            {shown}/{LEDGER_COLUMNS.length}
          </span>
        )}
      </Button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        placement="bottom-end"
        ariaLabel="열 관리"
        autoFocus={false}
        unpadded
        className="w-56"
      >
        <div className="nd-scroll max-h-[60vh] overflow-y-auto p-1.5">
          {LEDGER_COLUMNS.map((c) => (
            <Checkbox
              key={c.key}
              label={c.label}
              checked={!hidden.has(c.key)}
              onChange={(e) => sheet.setColumnHidden(c.key, !e.target.checked)}
              className="w-full rounded-[7px] px-2 py-1.5 text-nd-table transition-colors duration-nd-fast hover:bg-nd-fg/[.06]"
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-nd-line px-2 py-1.5">
          <span className="text-nd-micro text-nd-fg-3">값은 지워지지 않습니다</span>
          <Button variant="ghost" size="sm" onClick={sheet.showAllColumns} disabled={hidden.size === 0}>
            모두 보이기
          </Button>
        </div>
      </Popover>
    </>
  );
}

/** 새 열 이름 묻기 — 고른 열이 있으면 그 왼쪽에 들어간다고 알려 준다 */
function AddColumnDialog({
  open,
  busy,
  beside,
  onClose,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  beside?: string;
  onClose: () => void;
  onAdd: (label: string) => void;
}) {
  const [label, setLabel] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setLabel("");
  }, [open]);
  const submit = () => {
    const v = label.trim();
    if (v) onAdd(v);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="새 열"
      description={beside ? `「${beside}」 바로 왼쪽에 들어갑니다.` : "표 맨 오른쪽에 들어갑니다."}
      initialFocus={ref}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} loading={busy} disabled={!label.trim()}>
            만들기
          </Button>
        </>
      }
    >
      <Field label="열 이름" hint="집계·엑셀 내보내기에는 들어가지 않는 메모 칸입니다.">
        <Input
          ref={ref}
          value={label}
          maxLength={40}
          placeholder="예: 확인함, 담당자"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>
    </Dialog>
  );
}
