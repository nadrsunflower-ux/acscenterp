"use client";

// ============================================================
//  금액 드릴다운 — 올리면 미리보기, 누르면 창, 창에서 바로 교정
// ------------------------------------------------------------
//  합계 숫자는 언제나 "왜 이만큼인지"를 묻게 만든다. 엑셀에서는 SUMIFS 를
//  뜯어야 알 수 있었고, 그래서 아무도 확인하지 않았다. 여기서는 세 단계다.
//
//    올리면 → 큰 것부터 몇 줄
//    누르면 → 전체 내역 창
//    창에서 → 잘못 분류된 계정·사업부를 그 자리에서 고친다
//
//  ⚠️ 미리보기 판은 pointer-events:none 이다. 포인터가 판을 통과해 아래
//     숫자에 계속 닿아야 판이 꺼지지 않는다 — 판에 마우스가 얹히는 순간
//     숫자에서 벗어나 깜빡이는 문제를 이렇게 막는다. 그래서 미리보기 안에는
//     누를 것을 두지 않는다(누를 것은 전부 창에 있다).
//
//  ⚠️ 고친 행은 이 숫자에서 빠진다 — 마케팅비를 운영비로 바꾸면 더 이상
//     「마케팅비 × …」 가 아니다. 그런데 눈앞에서 사라지면 방금 무엇을 했는지
//     확인할 수 없다. 그래서 행은 자리를 지키고 「옮김」 으로 표시되며, 금액에
//     취소선이 그어져 합계에서 빠지는 것이 그대로 보인다. 매트릭스 본체는
//     창을 닫을 때 한 번만 다시 그린다 — 편집마다 장부 11,000건을 다시
//     받아오지 않기 위해서이기도 하다.
// ============================================================

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Filter,
  Pencil,
  Sparkles,
  Table2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  cn,
  Dialog,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  Money,
  Popover,
  Portal,
  Select,
  Spinner,
  Table,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
  useAnchorPosition,
  useToast,
} from "@/components/neander/ui";
import {
  AccountPicker,
  type AccountValue,
} from "./AccountPicker";
import { ColumnMenu } from "./ColumnMenu";
import {
  isActiveFilter,
  type ColumnFilter,
} from "@/lib/neander/finance/sheetFilter";
import { useFinance } from "./FinanceProvider";
import {
  BIZ_SEP,
  UNSET,
  matrixDelta,
} from "@/lib/neander/finance/aggregate";
import {
  bulkPatchFinTransactions,
  updateFinTransaction,
  upsertFinVendorRule,
} from "@/lib/neander/finance/client";
import { BIZ_MAJORS } from "@/lib/neander/finance/sheet";
import type { FinTransaction } from "@/lib/neander/finance/types";
import { lookupKeyOf } from "@/lib/neander/finance/types";
import {
  formatSigned,
} from "@/lib/neander/format";

/** 올린 뒤 이만큼 지나야 뜬다 — 표를 훑고 지나갈 때 따라 뜨지 않도록 */
const HOVER_DELAY = 160;
/** 미리보기에 보여줄 줄 수 */
const PREVIEW_ROWS = 6;
/** 손으로 고친 거래에 남기는 근거 — 나중에 "누가 왜" 를 물을 수 있어야 한다 */
const MANUAL_REASON = "사람이 교정 — 재무 대시보드 내역 창";
/** 창 아래 설명의 부호 규칙 — 기본은 매트릭스(환급을 지출에서 뺀다) */
const DEFAULT_AMOUNT_NOTE = "환급은 지출에서 차감되어 음수(△)로 표시됩니다";

const shortDate = (d: string) => (d?.length >= 10 ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d);

const acctTail = (v: { acctMid?: string; acctMinor?: string }) =>
  [v.acctMid, v.acctMinor].filter(Boolean).join(" › ");
const acctFull = (v: AccountValue) => [v.acctMajor, v.acctMid, v.acctMinor].filter(Boolean).join(" › ");

export interface BizValue {
  bizMajor?: string;
  bizMinor?: string;
}
type Classification = AccountValue & BizValue;

const bizText = (v: BizValue) => [v.bizMajor, v.bizMinor].filter(Boolean).join(" · ");
const bizKeyOf = (v: BizValue) => `${v.bizMajor || UNSET}${BIZ_SEP}${v.bizMinor || UNSET}`;

/** 이 숫자가 어떤 조건으로 걸러진 것인지 — 고친 행이 빠졌는지 판단한다 */
export interface BreakdownScope {
  /** 줄(계정대분류) */
  acctMajor?: string;
  /** 열(`사업대분류 · 소분류`) */
  bizKey?: string;
  /** `YYYY-MM` — 마감된 달인지 확인 */
  month?: string;
}

interface RowEdit {
  /** 처음 값 — 되돌리기용. 여러 번 고쳐도 처음 것을 지킨다 */
  before: Classification & { classReason?: string };
  after: Classification;
  /** 이 숫자에서 빠졌는가 */
  movedOut: boolean;
}
type EditMap = Record<string, RowEdit>;

export interface AmountBreakdownProps {
  /** 화면에 찍힌 합계 */
  value: number;
  /** 이 합계를 이루는 거래 */
  rows: FinTransaction[];
  /** 무엇의 합계인지 — 미리보기·창 제목 */
  title: string;
  /** 기준 설명 (예: `2026년 8월 · 환급 차감 반영`) */
  subtitle?: string;
  /** 원장에서 같은 조건으로 열기 */
  ledgerHref?: string;
  /** 숫자에 입힐 색 (히트맵 대비) */
  className?: string;
  /** 합계가 0 일 때 찍을 글자 */
  emptyText?: string;
  /** 고친 행이 이 숫자에서 빠지는지 판단할 조건 */
  scope?: BreakdownScope;
  /** 거래 → 이 합계에 더해진 값. 기본은 지출 기준(환급은 음수) */
  amountOf?: (t: FinTransaction) => number;
  /**
   * 숫자 대신 이것을 눌러 연다 — 표의 행 이름처럼 "이 줄 전체"를 여는 자리.
   * 주면 버튼이 왼쪽 정렬 글자가 되고, 미리보기·창 내용은 그대로다.
   */
  label?: ReactNode;
  /**
   * 창 아래 설명의 첫 마디 — 부호 규칙이 `amountOf` 마다 다르기 때문이다.
   * 기본은 매트릭스 기준(환급이 음수). 빈 문자열이면 그 마디를 뺀다.
   */
  amountNote?: string;
}

export function AmountBreakdown({
  value,
  rows,
  title,
  subtitle,
  ledgerHref,
  className,
  emptyText = "—",
  scope,
  amountOf = matrixDelta,
  label,
  amountNote = DEFAULT_AMOUNT_NOTE,
}: AmountBreakdownProps) {
  // 큰 것부터 — 호출부는 정렬하지 않은 배열을 그대로 넘겨도 된다
  const sorted = useMemo(() => [...rows].sort((a, b) => amountOf(b) - amountOf(a)), [rows, amountOf]);

  const { refresh } = useFinance();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pos = useAnchorPosition(btnRef, panelRef, hover, { placement: "bottom-start", offset: 8 });

  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => setHover(true), HOVER_DELAY);
  }, []);
  const hide = useCallback(() => {
    clearTimer();
    setHover(false);
  }, []);
  useEffect(() => clearTimer, []);

  // 고친 것이 있으면 닫을 때 한 번만 다시 그린다 (위 주석 참고)
  const closeDialog = useCallback(() => {
    setOpen(false);
    if (dirty) {
      setDirty(false);
      void refresh();
    }
  }, [dirty, refresh]);

  // 값이 0 이면 볼 내역도 없다 — 그냥 글자
  if (value === 0 && rows.length === 0) {
    return label ? <span>{label}</span> : <span className="text-nd-fg-4">{emptyText}</span>;
  }

  const preview = sorted.slice(0, PREVIEW_ROWS);
  const rest = sorted.length - preview.length;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          hide();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={`${title} ${formatSigned(value)}원, ${sorted.length}건. 세부 내역 열기`}
        className={cn(
          "-mx-1 rounded-[6px] px-1 py-0.5 underline-offset-4 transition-colors duration-nd-fast hover:bg-nd-accent-soft/70 hover:underline hover:decoration-dotted",
          label
            ? // 줄 이름 — 글자색은 그대로 두고 점선 밑줄로 "누를 수 있음" 을 표시한다
              "max-w-full truncate text-left underline decoration-dotted decoration-nd-fg-4"
            : "nd-num w-[calc(100%+0.5rem)] text-right",
          // 색을 따로 받지 않은 숫자는 링크 색 — 표 안에서 누를 수 있는 금액이 한눈에 드러난다.
          // 히트맵 칸(램프 위 글자색)·음수(△ 붉은 글자)·0 은 부르는 쪽이 색을 준다.
          !label && !className && "text-nd-accent-strong",
          className,
        )}
      >
        {label ?? (value === 0 ? emptyText : formatSigned(value))}
      </button>

      {/* 미리보기 — 마우스를 받지 않는다 (위 주석 참고) */}
      {hover && (
        <Portal>
          <div
            ref={panelRef}
            data-nd-breakdown
            aria-hidden
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className={cn(
              "nd-surface pointer-events-none z-nd-popover w-[22rem] max-w-[calc(100vw-1rem)] rounded-nd-md p-3 shadow-nd-pop",
              // 미리보기도 자리가 굳고 나서 그린다 (위로 뒤집힐 때 튀지 않도록)
              pos.ready ? "animate-in fade-in zoom-in-95 duration-nd-fast" : "opacity-0",
            )}
          >
            <p className="truncate text-nd-caption font-semibold text-nd-fg">{title}</p>
            {subtitle && <p className="mt-0.5 truncate text-nd-micro text-nd-fg-3">{subtitle}</p>}

            <ul className="mt-2 flex flex-col gap-1 border-t border-nd-line pt-2">
              {preview.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 text-nd-caption">
                  <span className="nd-num w-9 shrink-0 text-nd-fg-3">{shortDate(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-nd-fg">
                    {t.vendor || acctTail(t) || "(거래처 없음)"}
                  </span>
                  <Money value={amountOf(t)} unit={false} className="shrink-0" />
                </li>
              ))}
            </ul>

            <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-nd-line pt-2 text-nd-caption">
              <span className="text-nd-fg-3">
                {rest > 0
                  ? `외 ${rest.toLocaleString("ko-KR")}건 · 모두 ${sorted.length.toLocaleString("ko-KR")}건`
                  : `모두 ${sorted.length.toLocaleString("ko-KR")}건`}
              </span>
              <span className="font-semibold">
                <Money value={value} unit={false} />원
              </span>
            </div>
            <p className="mt-1.5 text-nd-micro text-nd-fg-3">누르면 창이 열리고, 거기서 분류를 고칠 수 있습니다</p>
          </div>
        </Portal>
      )}

      {/* Dialog 는 닫혀 있으면 children 을 렌더하지 않는다. 본문을 자식으로
          둬서 무거운 계산이 칸 수(수백 개)만큼 돌지 않게 한다. */}
      <Dialog
        open={open}
        onClose={closeDialog}
        size="xl"
        title={title}
        bodyClassName="px-0 sm:px-0"
        footer={
          <>
            {ledgerHref && (
              <Link href={ledgerHref}>
                <Button variant="secondary" icon={ExternalLink}>
                  원장에서 보기
                </Button>
              </Link>
            )}
            <Button onClick={closeDialog}>닫기</Button>
          </>
        }
      >
        <BreakdownBody
          rows={sorted}
          value={value}
          subtitle={subtitle}
          scope={scope}
          amountOf={amountOf}
          amountNote={amountNote}
          onEdited={() => setDirty(true)}
        />
      </Dialog>
    </>
  );
}

// ============================================================
//  창 안 표의 열 — 머리글을 누르면 정렬·필터
// ------------------------------------------------------------
//  원장의 열 메뉴(ColumnMenu)를 그대로 쓴다. 다만 거를 값은 원장의
//  FilterKey(장부 필드)가 아니라 **이 표가 보여 주는 값** 이다 — 계정은
//  세 단을 이은 한 줄이고, 사업부도 대·소분류를 이은 한 줄이며, 비고는
//  두 칸을 합친 것이다. 보이는 글자로 걸러야 "지금 뭘 거른 건지" 가 맞는다.
//
//  계정·사업부는 창 안에서 고칠 수 있으므로 고친 뒤 값(effective)으로
//  거른다. 방금 옮긴 줄이 필터 때문에 사라지지 않으려면 그래야 한다.
// ============================================================

type ColKey = "date" | "vendor" | "acct" | "biz" | "memo" | "amount";

const COLS: { key: ColKey; label: string }[] = [
  { key: "date", label: "거래일" },
  { key: "vendor", label: "거래처" },
  { key: "acct", label: "계정" },
  { key: "biz", label: "사업부" },
  { key: "memo", label: "비고" },
  { key: "amount", label: "금액" },
];

const memoOf = (t: FinTransaction) => [t.acctNote, t.note].filter(Boolean).join(" · ");

/** 머리글 한 칸 — 누르면 그 열의 정렬·필터 메뉴가 열린다 */
function HeadCell({
  label,
  filtered,
  sortDir,
  align,
  onOpen,
}: {
  label: string;
  filtered: boolean;
  sortDir: "asc" | "desc" | null;
  align?: "right";
  onOpen: (rect: DOMRect) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      aria-label={`${label} 정렬·필터`}
      className={cn(
        "-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1 rounded-[6px] px-1 py-0.5 text-inherit transition-colors duration-nd-fast hover:bg-nd-fg/[.08]",
        align === "right" && "justify-end",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {filtered && <Icon icon={Filter} size={11} className="shrink-0 text-nd-accent" />}
      {sortDir && <Icon icon={sortDir === "asc" ? ArrowUp : ArrowDown} size={11} className="shrink-0 text-nd-accent" />}
    </button>
  );
}

// ============================================================
//  창 본문 — 표 + 그 자리 교정
// ============================================================

function BreakdownBody({
  rows,
  value,
  subtitle,
  scope,
  amountOf,
  amountNote,
  onEdited,
}: {
  rows: FinTransaction[];
  value: number;
  subtitle?: string;
  scope?: BreakdownScope;
  amountOf: (t: FinTransaction) => number;
  amountNote: string;
  onEdited: () => void;
}) {
  const { accounts, transactions, closes } = useFinance();
  const toast = useToast();

  const [edits, setEdits] = useState<EditMap>({});
  /** 지금 펼쳐 놓은 편집 줄 */
  const [editing, setEditing] = useState<{ id: string; field: "acct" | "biz" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** 방금 고친 뒤 띄우는 제안 */
  const [suggest, setSuggest] = useState<Suggestion | null>(null);

  const closed = !!scope?.month && closes.some((c) => c.month === scope.month);

  /** 사업소분류 후보 — 마스터가 없어 장부에 실제로 쓰인 조합에서 모은다 */
  const bizPairs = useMemo(() => {
    const m = new Map<string, Set<string>>();
    transactions.forEach((t) => {
      if (!t.bizMajor) return;
      const set = m.get(t.bizMajor) ?? new Set<string>();
      if (t.bizMinor) set.add(t.bizMinor);
      m.set(t.bizMajor, set);
    });
    return m;
  }, [transactions]);

  const effective = useCallback(
    (t: FinTransaction): Classification =>
      edits[t.id]?.after ?? {
        acctMajor: t.acctMajor,
        acctMid: t.acctMid,
        acctMinor: t.acctMinor,
        bizMajor: t.bizMajor,
        bizMinor: t.bizMinor,
      },
    [edits],
  );

  const isOut = useCallback(
    (v: Classification) =>
      (!!scope?.acctMajor && (v.acctMajor || UNSET) !== scope.acctMajor) ||
      (!!scope?.bizKey && bizKeyOf(v) !== scope.bizKey),
    [scope],
  );

  const movedIds = useMemo(
    () => new Set(rows.filter((t) => edits[t.id]?.movedOut).map((t) => t.id)),
    [rows, edits],
  );

  // ---- 열 필터·정렬 -------------------------------------------------
  const [filters, setFilters] = useState<Partial<Record<ColKey, ColumnFilter>>>({});
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" } | null>(null);
  const [menu, setMenu] = useState<{ key: ColKey; anchor: DOMRect } | null>(null);

  /** 이 표가 그 칸에 실제로 찍는 글자 — 거르는 기준도 이것이어야 한다 */
  const cellText = useCallback(
    (t: FinTransaction, key: ColKey): string => {
      switch (key) {
        case "date":
          return t.date ?? "";
        case "vendor":
          return t.vendor ?? "";
        case "acct":
          return acctFull(effective(t));
        case "biz":
          return bizText(effective(t));
        case "memo":
          return memoOf(t);
        default:
          return "";
      }
    },
    [effective],
  );

  const activeKeys = useMemo(
    () => (Object.keys(filters) as ColKey[]).filter((k) => isActiveFilter(filters[k])),
    [filters],
  );

  /**
   * `except` 열은 건너뛴다 — 그 열의 후보를 만들 때 쓴다. 엑셀과 같다:
   * 어떤 열의 선택지는 다른 열의 필터를 반영하되 자기 선택 때문에 줄어들지
   * 않는다. 안 그러면 체크를 한 번 풀면 그 값이 목록에서 사라져 되돌릴 수 없다.
   */
  const applyLocal = useCallback(
    (list: FinTransaction[], except?: ColKey) => {
      const keys = activeKeys.filter((k) => k !== except);
      if (keys.length === 0) return list;
      const sets = new Map<ColKey, Set<string>>();
      keys.forEach((k) => {
        const f = filters[k]!;
        if (f.kind === "values") sets.set(k, new Set(f.values));
      });
      return list.filter((t) =>
        keys.every((k) => {
          const f = filters[k]!;
          if (f.kind === "range") {
            const v = amountOf(t);
            return (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max);
          }
          return sets.get(k)!.has(cellText(t, k));
        }),
      );
    },
    [activeKeys, filters, amountOf, cellText],
  );

  const optionsFor = useCallback(
    (key: ColKey) => {
      if (key === "amount") return [];
      const counts = new Map<string, number>();
      applyLocal(rows, key).forEach((t) => {
        const v = cellText(t, key);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      });
      return [...counts.entries()]
        .map(([value, count]) => ({ value, label: value === "" ? "(비어 있음)" : value, count }))
        .sort((a, b) => {
          if (a.value === "") return 1;
          if (b.value === "") return -1;
          // 날짜는 최근이 위 — 거래를 볼 때 최근부터 본다
          if (key === "date") return b.value.localeCompare(a.value);
          return a.label.localeCompare(b.label, "ko");
        });
    },
    [rows, applyLocal, cellText],
  );

  /** 실제로 그리는 줄. 정렬을 안 고르면 부른 쪽이 준 순서(금액 큰 순) 그대로 */
  const visible = useMemo(() => {
    const list = applyLocal(rows);
    if (!sort) return list;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) =>
      sort.key === "amount"
        ? (amountOf(a) - amountOf(b)) * dir
        : cellText(a, sort.key).localeCompare(cellText(b, sort.key), "ko") * dir,
    );
  }, [rows, applyLocal, sort, amountOf, cellText]);

  // 거르지도 옮기지도 않았으면 부른 쪽이 준 값을 그대로 쓴다 (재더하며 어긋나지 않게)
  const shownTotal = useMemo(
    () =>
      activeKeys.length === 0 && movedIds.size === 0
        ? value
        : visible.reduce((s, t) => (movedIds.has(t.id) ? s : s + amountOf(t)), 0),
    [activeKeys, visible, movedIds, amountOf, value],
  );

  /** 한 건 저장 — 로컬에만 반영하고 매트릭스는 창을 닫을 때 다시 그린다 */
  const save = async (t: FinTransaction, patch: Partial<Classification>, field: "acct" | "biz") => {
    setBusy(t.id);
    try {
      await updateFinTransaction(t.id, { ...patch, classReason: MANUAL_REASON });
      const before =
        edits[t.id]?.before ?? {
          acctMajor: t.acctMajor,
          acctMid: t.acctMid,
          acctMinor: t.acctMinor,
          bizMajor: t.bizMajor,
          bizMinor: t.bizMinor,
          classReason: t.classReason,
        };
      const after = { ...effective(t), ...patch };
      setEdits((m) => ({ ...m, [t.id]: { before, after, movedOut: isOut(after) } }));
      setEditing(null);
      onEdited();
      setSuggest(field === "acct" ? buildSuggestion(t, after, rows, edits) : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const undo = async (t: FinTransaction) => {
    const e = edits[t.id];
    if (!e) return;
    setBusy(t.id);
    try {
      await updateFinTransaction(t.id, { ...e.before });
      setEdits((m) => {
        const next = { ...m };
        delete next[t.id];
        return next;
      });
      setSuggest((s) => (s?.txId === t.id ? null : s));
      onEdited();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "되돌리지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="px-5 pb-3 sm:px-6">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-nd-body text-nd-fg-2">
          {subtitle && <span>{subtitle}</span>}
          <span className="nd-num">
            {activeKeys.length > 0
              ? `${rows.length.toLocaleString("ko-KR")}건 중 ${visible.length.toLocaleString("ko-KR")}건`
              : `${rows.length.toLocaleString("ko-KR")}건`}
          </span>
          <span className="font-semibold text-nd-fg">
            합계 <Money value={shownTotal} unit={false} />원
          </span>
          {movedIds.size > 0 && (
            <Badge tone="accent" size="sm">
              {movedIds.size}건 옮김
            </Badge>
          )}
          {activeKeys.length > 0 && (
            <Button variant="ghost" size="sm" icon={X} onClick={() => setFilters({})}>
              필터 {activeKeys.length}개 해제
            </Button>
          )}
        </p>
      </div>

      {closed && (
        <div className="px-5 pb-3 sm:px-6">
          <InlineNotice tone="warning" icon={TriangleAlert}>
            이 달은 이미 마감됐습니다. 지금 고치면 마감할 때 얼려 둔 숫자와 달라집니다. 월 마감 화면이 그 차이를
            드러내 주니 고친 뒤 확인하세요.
          </InlineNotice>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-nd-body text-nd-fg-3 sm:px-6">
          이 조건에 해당하는 거래가 없습니다.
        </p>
      ) : visible.length === 0 ? (
        <div className="px-5 py-8 text-center sm:px-6">
          <p className="text-nd-body text-nd-fg-3">지금 걸린 필터에 맞는 거래가 없습니다.</p>
          <Button variant="secondary" size="sm" className="mt-3" icon={X} onClick={() => setFilters({})}>
            필터 해제
          </Button>
        </div>
      ) : (
        <TableScroll maxHeight="min(52vh, 30rem)">
          <Table minWidth={760}>
            <thead>
              <tr>
                {COLS.map((c) =>
                  c.key === "amount" ? (
                    // 금액은 가로로 밀려도 늘 보여야 한다
                    <Th
                      key={c.key}
                      sticky="top-right"
                      align="right"
                      className="pr-5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6"
                    >
                      <HeadCell
                        label={c.label}
                        align="right"
                        filtered={isActiveFilter(filters[c.key])}
                        sortDir={sort?.key === c.key ? sort.dir : null}
                        onOpen={(anchor) => setMenu({ key: c.key, anchor })}
                      />
                    </Th>
                  ) : (
                    <Th key={c.key} sticky="top" className={c.key === "date" ? "pl-5 sm:pl-6" : undefined}>
                      <HeadCell
                        label={c.label}
                        filtered={isActiveFilter(filters[c.key])}
                        sortDir={sort?.key === c.key ? sort.dir : null}
                        onOpen={(anchor) => setMenu({ key: c.key, anchor })}
                      />
                    </Th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <ItemRows
                  key={t.id}
                  tx={t}
                  now={effective(t)}
                  edit={edits[t.id]}
                  memo={[t.acctNote, t.note].filter(Boolean).join(" · ")}
                  amount={amountOf(t)}
                  busy={busy === t.id}
                  editing={editing?.id === t.id ? editing.field : null}
                  onOpenEdit={(field) => setEditing({ id: t.id, field })}
                  onCancelEdit={() => setEditing(null)}
                  onSave={(patch, field) => save(t, patch, field)}
                  onUndo={() => undo(t)}
                  accounts={accounts}
                  bizPairs={bizPairs}
                  suggest={suggest?.txId === t.id ? suggest : null}
                  onDismissSuggest={() => setSuggest(null)}
                  onEdited={onEdited}
                  setEdits={setEdits}
                  isOut={isOut}
                  rows={rows}
                />
              ))}
            </tbody>
            <tfoot>
              <TotalRow>
                <Td className="pl-5 sm:pl-6" colSpan={5}>
                  합계
                  {movedIds.size > 0 && (
                    <span className="ml-2 text-nd-caption font-normal text-nd-fg-3">
                      옮긴 {movedIds.size}건 제외
                    </span>
                  )}
                </Td>
                <Td
                  num
                  sticky="right"
                  className="!bg-nd-sunken pr-5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6"
                >
                  <Money value={shownTotal} unit={false} />
                </Td>
              </TotalRow>
            </tfoot>
          </Table>
        </TableScroll>
      )}

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-nd-line px-5 pt-3 text-nd-caption text-nd-fg-3 sm:px-6">
        <Icon icon={Table2} size={14} />
        {amountNote && `${amountNote} · `}
        {sort
          ? `${COLS.find((c) => c.key === sort.key)?.label} ${sort.dir === "asc" ? "오름차순" : "내림차순"}`
          : "금액 큰 순"}{" "}
        · 머리글을 누르면 정렬·필터, 계정과 사업부는 눌러서 고칠 수 있습니다
      </p>

      {menu && (
        <ColumnMenu
          columnKey={menu.key}
          range={menu.key === "amount"}
          label={COLS.find((c) => c.key === menu.key)!.label}
          anchor={menu.anchor}
          overDialog
          sortDir={sort?.key === menu.key ? sort.dir : null}
          onSort={(dir) => setSort(dir ? { key: menu.key, dir } : null)}
          filter={filters[menu.key]}
          options={optionsFor(menu.key)}
          onFilterChange={(next) =>
            setFilters((f) => {
              const n = { ...f };
              if (next) n[menu.key] = next;
              else delete n[menu.key];
              return n;
            })
          }
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

// ============================================================
//  한 거래 = 표 행 + (펼쳤을 때) 편집 줄 + (고친 뒤) 제안 줄
// ============================================================

function ItemRows({
  tx,
  now,
  edit,
  memo,
  amount,
  busy,
  editing,
  onOpenEdit,
  onCancelEdit,
  onSave,
  onUndo,
  accounts,
  bizPairs,
  suggest,
  onDismissSuggest,
  onEdited,
  setEdits,
  isOut,
  rows,
}: {
  tx: FinTransaction;
  now: Classification;
  edit?: RowEdit;
  memo: string;
  amount: number;
  busy: boolean;
  editing: "acct" | "biz" | null;
  onOpenEdit: (f: "acct" | "biz") => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<Classification>, field: "acct" | "biz") => void;
  onUndo: () => void;
  accounts: ReturnType<typeof useFinance>["accounts"];
  bizPairs: Map<string, Set<string>>;
  suggest: Suggestion | null;
  onDismissSuggest: () => void;
  onEdited: () => void;
  setEdits: Dispatch<SetStateAction<EditMap>>;
  isOut: (v: Classification) => boolean;
  rows: FinTransaction[];
}) {
  const out = !!edit?.movedOut;
  return (
    <>
      <Tr className={cn(edit && "bg-nd-accent-soft/50")}>
        <Td className="nd-num whitespace-nowrap pl-5 text-nd-fg-2 sm:pl-6">{tx.date}</Td>
        <Td>
          <span className="flex items-center gap-1.5">
            <span className="max-w-[9rem] truncate" title={tx.vendor}>
              {tx.vendor || "—"}
            </span>
            {tx.txType === "환급" && (
              <Badge tone="info" size="sm">
                환급
              </Badge>
            )}
            {tx.personalUse && (
              <Badge tone="warning" size="sm">
                개인사용
              </Badge>
            )}
          </span>
        </Td>
        <Td>
          <PickerCell
            open={editing === "acct"}
            busy={busy}
            label="계정"
            text={acctFull(now) || "미분류"}
            before={edit ? acctFull(edit.before) : undefined}
            changed={!!edit && acctFull(edit.before) !== acctFull(now)}
            onOpen={() => onOpenEdit("acct")}
            onClose={onCancelEdit}
            panelClassName="w-[min(30rem,calc(100vw-2rem))]"
          >
            <AcctEditor
              tx={tx}
              now={now}
              accounts={accounts}
              busy={busy}
              onCancel={onCancelEdit}
              onPick={(v) => onSave(v, "acct")}
            />
          </PickerCell>
        </Td>
        <Td>
          <PickerCell
            open={editing === "biz"}
            busy={busy}
            label="사업부"
            text={bizText(now) || "미정"}
            before={edit ? bizText(edit.before) : undefined}
            changed={!!edit && bizText(edit.before) !== bizText(now)}
            onOpen={() => onOpenEdit("biz")}
            onClose={onCancelEdit}
            panelClassName="w-[min(21rem,calc(100vw-2rem))]"
          >
            <BizEditor
              now={now}
              bizPairs={bizPairs}
              busy={busy}
              onCancel={onCancelEdit}
              onPick={(v) => onSave(v, "biz")}
            />
          </PickerCell>
        </Td>
        <Td className="text-nd-fg-3">
          <span className="block max-w-[10rem] truncate" title={memo}>
            {memo || "—"}
          </span>
        </Td>
        <Td
          num
          sticky="right"
          className={cn(
            "pr-5 font-medium shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6",
            edit && "!bg-nd-accent-soft/50",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            {out && (
              <Badge tone="accent" size="sm">
                옮김
              </Badge>
            )}
            <span className={cn(out && "line-through")}>
              <Money value={amount} unit={false} muted={out} />
            </span>
            {edit && (
              <IconButton icon={Undo2} label="되돌리기" size="sm" onClick={onUndo} disabled={busy} className="-mr-1" />
            )}
          </span>
        </Td>
      </Tr>

      {suggest && (
        <tr>
          <td colSpan={6} className="px-5 pb-3 sm:px-6">
            <SuggestStrip
              suggest={suggest}
              rows={rows}
              onDismiss={onDismissSuggest}
              onEdited={onEdited}
              setEdits={setEdits}
              isOut={isOut}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * 표 안의 고칠 수 있는 칸 — 눌러서 그 칸 위에 말풍선을 띄운다.
 *
 * 판은 포탈로 띄우므로 좁은 열 너비에 갇히지 않는다. 표 행을 밀어내지도
 * 않아, 고치는 동안에도 위아래 줄이 제자리에 있다 — 「이 줄만 왜 이러지」
 * 를 견주려면 이웃 줄이 안 움직여야 한다.
 */
function PickerCell({
  open,
  busy,
  label,
  text,
  before,
  changed,
  onOpen,
  onClose,
  panelClassName,
  children,
}: {
  open: boolean;
  busy: boolean;
  label: string;
  text: string;
  before?: string;
  changed: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** 말풍선 너비 — 계정은 3단, 사업부는 2단이라 필요한 자리가 다르다 */
  panelClassName: string;
  children: ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      {changed && before && (
        <span className="block max-w-[11rem] truncate text-nd-micro text-nd-fg-3 line-through" title={before}>
          {before}
        </span>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        aria-expanded={open}
        aria-label={`${label} 고치기: 지금 ${text}`}
        disabled={busy}
        className={cn(
          "group -mx-1 flex max-w-[12rem] items-center gap-1 rounded-[6px] px-1 py-0.5 text-left transition-colors duration-nd-fast hover:bg-nd-fg/[.06]",
          changed ? "font-medium text-nd-accent-strong" : "text-nd-fg-2",
          open && "bg-nd-fg/[.06]",
        )}
        title={text}
      >
        <span className="min-w-0 truncate">{text}</span>
        {busy ? (
          <Spinner size={12} />
        ) : (
          <Icon
            icon={Pencil}
            size={12}
            className={cn(
              "shrink-0 text-nd-fg-4 transition-opacity duration-nd-fast",
              open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          />
        )}
      </button>

      {/* 칸 위에 띄운다 — 자리가 모자라면 훅이 아래로 뒤집는다.
          overDialog 가 없으면 창(z 60) 뒤로 숨는다. */}
      <Popover
        open={open}
        onClose={onClose}
        anchorRef={btnRef}
        placement="top-start"
        overDialog
        arrow
        unpadded
        ariaLabel={`${label} 고치기`}
        className={cn("p-3", panelClassName)}
      >
        {children}
      </Popover>
    </span>
  );
}

/**
 * 계정 편집 말풍선.
 *
 * 한때 행 아래에 펼쳤다. 3단 드롭다운을 좁은 열에 붙일 자리가 없고, 창 위에
 * 뜨는 판을 놓을 층이 없어서였다. 둘 다 풀렸다 — 판은 포탈로 띄워 열 너비와
 * 무관하게 넓힐 수 있고(30rem), z 층에 창과 토스트 사이 자리를 하나 냈다
 * (nd-popover-over). 이제 고치는 동안 표가 밀리지 않는다.
 *
 * 세 단이 다 채워졌을 때만 저장한다 — 반쪽짜리 계정을 저장하면 매트릭스에
 * 「(미정)」 줄이 생긴다.
 */
function AcctEditor({
  tx,
  now,
  accounts,
  busy,
  onCancel,
  onPick,
}: {
  tx: FinTransaction;
  now: Classification;
  accounts: ReturnType<typeof useFinance>["accounts"];
  busy: boolean;
  onCancel: () => void;
  onPick: (v: AccountValue) => void;
}) {
  const [draft, setDraft] = useState<AccountValue>({
    acctMajor: now.acctMajor,
    acctMid: now.acctMid,
    acctMinor: now.acctMinor,
  });
  return (
    // 취소는 맨 뒤에 둔다 — 팝오버가 첫 포커스 가능한 요소로 커서를 옮기므로,
    // 앞에 두면 대분류 드롭다운 대신 취소 단추에 커서가 앉는다.
    <div className="flex flex-col gap-2.5">
      <span className="text-nd-caption font-medium text-nd-fg-2">계정 고치기</span>
      <AccountPicker
        accounts={accounts}
        txType={tx.txType}
        compact
        value={draft}
        onChange={(v) => {
          setDraft(v);
          // 3단이 다 차면 그때 저장한다
          if (v.acctMajor && v.acctMid && v.acctMinor) onPick(v);
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-nd-micro text-nd-fg-3">세 단을 다 고르면 바로 저장됩니다</span>
        {busy ? (
          <Spinner size={16} />
        ) : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            취소
          </Button>
        )}
      </div>
    </div>
  );
}

/** 사업부 편집 말풍선 — 마스터가 없어 장부에 쓰인 조합에서 고른다 */
function BizEditor({
  now,
  bizPairs,
  busy,
  onCancel,
  onPick,
}: {
  now: Classification;
  bizPairs: Map<string, Set<string>>;
  busy: boolean;
  onCancel: () => void;
  onPick: (v: BizValue) => void;
}) {
  const [major, setMajor] = useState(now.bizMajor ?? "");
  const [minor, setMinor] = useState(now.bizMinor ?? "");
  const minors = useMemo(() => {
    const set = new Set(bizPairs.get(major) ?? []);
    if (major === now.bizMajor && now.bizMinor) set.add(now.bizMinor);
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [bizPairs, major, now.bizMajor, now.bizMinor]);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-nd-caption font-medium text-nd-fg-2">사업부 고치기</span>
      <div className="grid grid-cols-2 gap-2">
        <Select
          size="sm"
          aria-label="사업대분류"
          value={major}
          onChange={(e) => {
            setMajor(e.target.value);
            setMinor("");
          }}
        >
          <option value="">대분류</option>
          {BIZ_MAJORS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label="사업소분류"
          value={minor}
          disabled={!major}
          onChange={(e) => {
            const v = e.target.value;
            setMinor(v);
            if (major && v) onPick({ bizMajor: major, bizMinor: v });
          }}
        >
          <option value="">소분류</option>
          {minors.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-nd-micro text-nd-fg-3">둘 다 고르면 바로 저장됩니다</span>
        {busy ? (
          <Spinner size={16} />
        ) : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            취소
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  제안 — 한 건을 고쳤으면 형제도, 그리고 다음번부터도
// ------------------------------------------------------------
//  FACEBK 처럼 카드 승인번호만 다른 거래는 한 건이 틀렸으면 나머지도
//  틀렸다. 한 줄 교정을 원인 교정으로 잇는다.
// ============================================================

interface Suggestion {
  txId: string;
  txType: FinTransaction["txType"];
  /** 거래처에서 뽑은 매칭 키워드 (사람이 고칠 수 있다) */
  keyword: string;
  acct: AccountValue;
  /** 같은 키워드인데 아직 다른 계정인 형제들 */
  siblingIds: string[];
}

/**
 * 카드 승인번호처럼 뒤에 붙는 임의 문자열을 떼어 거래처의 몸통만 남긴다.
 * `FACEBK *MR78MZHJJ2` → `FACEBK`
 */
export function vendorKeyword(vendor: string): string {
  const s = vendor.trim();
  const cut = s.split(/[*#|(]/)[0].trim();
  const head = cut.replace(/[\s_-]*\d[\d\s\-.]*$/, "").trim();
  return (head || cut || s).slice(0, 24);
}

function buildSuggestion(
  tx: FinTransaction,
  after: Classification,
  rows: FinTransaction[],
  edits: EditMap,
): Suggestion | null {
  if (!tx.vendor || !after.acctMajor || !after.acctMid || !after.acctMinor) return null;
  const keyword = vendorKeyword(tx.vendor);
  if (keyword.length < 2) return null;
  const k = keyword.toLowerCase();
  const same = (v: AccountValue) =>
    v.acctMajor === after.acctMajor && v.acctMid === after.acctMid && v.acctMinor === after.acctMinor;
  const siblingIds = rows
    .filter((r) => {
      if (r.id === tx.id || r.txType !== tx.txType) return false;
      if (!r.vendor?.toLowerCase().includes(k)) return false;
      const cur = edits[r.id]?.after ?? { acctMajor: r.acctMajor, acctMid: r.acctMid, acctMinor: r.acctMinor };
      return !same(cur);
    })
    .map((r) => r.id);
  return { txId: tx.id, txType: tx.txType, keyword, acct: after, siblingIds };
}

function SuggestStrip({
  suggest,
  rows,
  onDismiss,
  onEdited,
  setEdits,
  isOut,
}: {
  suggest: Suggestion;
  rows: FinTransaction[];
  onDismiss: () => void;
  onEdited: () => void;
  setEdits: Dispatch<SetStateAction<EditMap>>;
  isOut: (v: Classification) => boolean;
}) {
  const toast = useToast();
  const [keyword, setKeyword] = useState(suggest.keyword);
  const [busy, setBusy] = useState<"bulk" | "rule" | null>(null);
  const [bulkDone, setBulkDone] = useState(false);
  const [ruleDone, setRuleDone] = useState(false);

  const applySiblings = async () => {
    setBusy("bulk");
    try {
      await bulkPatchFinTransactions(suggest.siblingIds, { ...suggest.acct, classReason: MANUAL_REASON });
      setEdits((m) => {
        const next = { ...m };
        suggest.siblingIds.forEach((id) => {
          const r = rows.find((x) => x.id === id);
          if (!r) return;
          const before =
            next[id]?.before ?? {
              acctMajor: r.acctMajor,
              acctMid: r.acctMid,
              acctMinor: r.acctMinor,
              bizMajor: r.bizMajor,
              bizMinor: r.bizMinor,
              classReason: r.classReason,
            };
          const after: Classification = { ...(next[id]?.after ?? before), ...suggest.acct };
          next[id] = { before, after, movedOut: isOut(after) };
        });
        return next;
      });
      setBulkDone(true);
      onEdited();
      toast.success(`${suggest.siblingIds.length}건을 같은 계정으로 바꿨습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "일괄 적용에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const makeRule = async () => {
    const kw = keyword.trim();
    if (kw.length < 2) {
      toast.error("규칙 키워드는 두 글자 이상이어야 합니다.");
      return;
    }
    setBusy("rule");
    try {
      await upsertFinVendorRule({
        keyword: kw,
        service: kw,
        lookupKey: lookupKeyOf({ txType: suggest.txType, ...suggest.acct }),
      });
      setRuleDone(true);
      toast.success(`앞으로 ${kw} 는 이 계정으로 자동분류됩니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "규칙을 만들지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const nothingLeft = (suggest.siblingIds.length === 0 || bulkDone) && ruleDone;
  if (nothingLeft) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-nd-md bg-nd-accent-soft/70 px-3 py-2.5 text-nd-caption text-nd-fg">
      <Icon icon={Sparkles} size={15} className="shrink-0 text-nd-accent" />

      {suggest.siblingIds.length > 0 && !bulkDone && (
        <span className="flex flex-wrap items-center gap-2">
          <span>
            이 목록에 <b>{suggest.keyword}</b> 가 {suggest.siblingIds.length}건 더 있습니다
          </span>
          <Button size="sm" variant="soft" onClick={applySiblings} loading={busy === "bulk"}>
            {suggest.siblingIds.length}건도 같이 바꾸기
          </Button>
        </span>
      )}

      {ruleDone ? (
        <span className="font-medium text-nd-accent-strong">규칙을 만들었습니다. 다음 임포트부터 적용됩니다.</span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span>앞으로</span>
          <Input
            size="sm"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="자동분류 키워드"
            className="w-28"
          />
          <span>는 이 계정으로</span>
          <Button size="sm" variant="secondary" onClick={makeRule} loading={busy === "rule"}>
            규칙 만들기
          </Button>
        </span>
      )}

      <IconButton icon={X} label="제안 닫기" size="sm" onClick={onDismiss} className="ml-auto shrink-0" />
    </div>
  );
}
