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
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ExternalLink, Pencil, Sparkles, Table2, TriangleAlert, Undo2, X } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  Portal,
  Select,
  Spinner,
  Table,
  TableScroll,
  Td,
  Th,
  TotalRow,
  Tr,
  cn,
  useAnchorPosition,
  useToast,
} from "@/components/neander/ui";
import { AccountPicker, type AccountValue } from "./AccountPicker";
import { useFinance } from "./FinanceProvider";
import { BIZ_SEP, UNSET, matrixDelta } from "@/lib/neander/finance/aggregate";
import {
  bulkPatchFinTransactions,
  updateFinTransaction,
  upsertFinVendorRule,
} from "@/lib/neander/finance/client";
import { BIZ_MAJORS } from "@/lib/neander/finance/sheet";
import type { FinTransaction } from "@/lib/neander/finance/types";
import { formatSigned, lookupKeyOf } from "@/lib/neander/finance/types";
import { Money } from "./ui";

/** 올린 뒤 이만큼 지나야 뜬다 — 표를 훑고 지나갈 때 따라 뜨지 않도록 */
const HOVER_DELAY = 160;
/** 미리보기에 보여줄 줄 수 */
const PREVIEW_ROWS = 6;
/** 손으로 고친 거래에 남기는 근거 — 나중에 "누가 왜" 를 물을 수 있어야 한다 */
const MANUAL_REASON = "사람이 교정 — 재무 대시보드 내역 창";

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
    return <span className="text-nd-fg-4">{emptyText}</span>;
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
          "nd-num -mx-1 w-[calc(100%+0.5rem)] rounded-[6px] px-1 py-0.5 text-right underline-offset-4 transition-colors duration-nd-fast hover:underline hover:decoration-dotted",
          className,
        )}
      >
        {value === 0 ? emptyText : formatSigned(value)}
      </button>

      {/* 미리보기 — 마우스를 받지 않는다 (위 주석 참고) */}
      {hover && (
        <Portal>
          <div
            ref={panelRef}
            data-nd-breakdown
            aria-hidden
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="nd-surface pointer-events-none z-nd-popover w-[22rem] max-w-[calc(100vw-1rem)] rounded-nd-md p-3 shadow-nd-pop animate-in fade-in zoom-in-95 duration-nd-fast"
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
          onEdited={() => setDirty(true)}
        />
      </Dialog>
    </>
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
  onEdited,
}: {
  rows: FinTransaction[];
  value: number;
  subtitle?: string;
  scope?: BreakdownScope;
  amountOf: (t: FinTransaction) => number;
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
  const shownTotal = useMemo(
    () => (movedIds.size === 0 ? value : rows.reduce((s, t) => (movedIds.has(t.id) ? s : s + amountOf(t)), 0)),
    [rows, movedIds, amountOf, value],
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
          <span className="nd-num">{rows.length.toLocaleString("ko-KR")}건</span>
          <span className="font-semibold text-nd-fg">
            합계 <Money value={shownTotal} unit={false} />원
          </span>
          {movedIds.size > 0 && (
            <Badge tone="accent" size="sm">
              {movedIds.size}건 옮김
            </Badge>
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
      ) : (
        <TableScroll maxHeight="min(52vh, 30rem)">
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th sticky="top" className="pl-5 sm:pl-6">거래일</Th>
                <Th sticky="top">거래처</Th>
                <Th sticky="top">계정</Th>
                <Th sticky="top">사업부</Th>
                <Th sticky="top">비고</Th>
                {/* 금액은 가로로 밀려도 늘 보여야 한다 */}
                <Th
                  sticky="top-right"
                  align="right"
                  className="pr-5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] sm:pr-6"
                >
                  금액
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
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
        환급은 지출에서 차감되어 음수(△)로 표시됩니다 · 금액 큰 순 · 계정과 사업부는 눌러서 고칠 수 있습니다
      </p>
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
          />
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
          />
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

      {editing && (
        <tr className="bg-nd-accent-soft/40">
          {/* Esc 는 편집 줄만 닫는다 — 창까지 닫히면 방금 연 것을 다시 찾아야 한다.
              Dialog 의 Esc 는 document 에서 듣고 있어 여기서 전파를 끊는다. */}
          <td
            colSpan={6}
            className="px-5 py-3 sm:px-6"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onCancelEdit();
              }
            }}
          >
            {editing === "acct" ? (
              <AcctEditor
                tx={tx}
                now={now}
                accounts={accounts}
                busy={busy}
                onCancel={onCancelEdit}
                onPick={(v) => onSave(v, "acct")}
              />
            ) : (
              <BizEditor
                now={now}
                bizPairs={bizPairs}
                busy={busy}
                onCancel={onCancelEdit}
                onPick={(v) => onSave(v, "biz")}
              />
            )}
          </td>
        </tr>
      )}

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

/** 표 안의 고칠 수 있는 칸 — 눌러서 아래 편집 줄을 펼친다 */
function PickerCell({
  open,
  busy,
  label,
  text,
  before,
  changed,
  onOpen,
}: {
  open: boolean;
  busy: boolean;
  label: string;
  text: string;
  before?: string;
  changed: boolean;
  onOpen: () => void;
}) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      {changed && before && (
        <span className="block max-w-[11rem] truncate text-nd-micro text-nd-fg-3 line-through" title={before}>
          {before}
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
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
    </span>
  );
}

/**
 * 편집 줄이 열리면 첫 드롭다운으로 포커스를 옮기고, 닫히면 눌렀던 칸으로
 * 되돌린다. 포커스가 줄 안에 있어야 Esc 가 줄만 닫는다(창까지 닫히지 않는다).
 */
function useStripFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector("select")?.focus();
    return () => {
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/**
 * 계정 편집 줄.
 *
 * 팝오버가 아니라 행 아래에 펼친다 — 3단 드롭다운은 좁은 열에 붙이기엔
 * 자리가 모자라고, 창 위에 뜨는 판은 창보다 위 층에 있어야 해서 층 순서가
 * 꼬인다. 펼치는 쪽이 자리도 넉넉하고 키보드로도 자연스럽다.
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
  const ref = useStripFocus();
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-3">
      <span className="shrink-0 text-nd-caption font-medium text-nd-fg-2">계정</span>
      <div className="min-w-[18rem] flex-1">
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
      </div>
      {busy ? (
        <Spinner size={16} />
      ) : (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          취소
        </Button>
      )}
    </div>
  );
}

/** 사업부 편집 줄 — 마스터가 없어 장부에 쓰인 조합에서 고른다 */
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
  const ref = useStripFocus();
  const minors = useMemo(() => {
    const set = new Set(bizPairs.get(major) ?? []);
    if (major === now.bizMajor && now.bizMinor) set.add(now.bizMinor);
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [bizPairs, major, now.bizMajor, now.bizMinor]);

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-3">
      <span className="shrink-0 text-nd-caption font-medium text-nd-fg-2">사업부</span>
      <div className="grid min-w-[18rem] flex-1 grid-cols-2 gap-2">
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
      {busy ? (
        <Spinner size={16} />
      ) : (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          취소
        </Button>
      )}
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
