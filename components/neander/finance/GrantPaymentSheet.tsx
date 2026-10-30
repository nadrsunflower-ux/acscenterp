"use client";

import "react-datasheet-grid/dist/style.css";
import "./ledger-sheet.css";
import "./grant-payment-sheet.css";

import { memo, useCallback, useMemo } from "react";
import {
  DynamicDataSheetGrid,
  keyColumn,
  type CellProps,
  type Column,
  type SimpleColumn,
} from "react-datasheet-grid";
import { Badge, type Tone } from "@/components/neander/ui";
import type { FinGrantInstallment } from "@/lib/neander/finance/grant";
import { createDerivedColumn, createSheetTextColumn } from "./sheetCells";

export interface GrantPaymentRow {
  id: string;
  kind: "ledger" | "manual" | "planned";
  status: string;
  tone?: Tone;
  date: string;
  label: string;
  account: string;
  payer: string;
  amount: number;
  note: string;
  instId?: string;
}

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 34;
type TextField = "label" | "note";
const canEdit = (row: GrantPaymentRow) => row.kind !== "ledger" && !!row.instId;

const textColumn = createSheetTextColumn<string>({
  parse: (value) => value.trim(),
  parsePasted: (value) => value.replace(/[\r\n]+/g, " ").trim(),
  formatBlurred: (value) => value ?? "",
  formatEditing: (value) => value ?? "",
  deletedValue: "",
});

type KeyTextColumn = ReturnType<typeof keyColumn<GrantPaymentRow, TextField>>;
interface TextCellData {
  field: TextField;
  inner: KeyTextColumn;
}

// 같은 열 안에서 원장 거래는 표시만 한다. disabled 입력칸을 그려 두면
// 셀을 선택할 때 글자를 칠 수 있어 보이므로, 실제 입력칸과 분리한다.
function PaymentTextCellInner(props: CellProps<GrantPaymentRow, TextCellData>) {
  const { rowData, columnData } = props;
  if (!canEdit(rowData)) {
    return (
      <div className="dsg-derived" title={rowData[columnData.field]} data-payment-field={columnData.field}>
        <span className="grant-payment-text">{rowData[columnData.field]}</span>
      </div>
    );
  }
  const Component = columnData.inner.component;
  if (!Component) return <></>;
  return <Component {...props} columnData={columnData.inner.columnData!} />;
}
const PaymentTextCell = memo(PaymentTextCellInner) as typeof PaymentTextCellInner;

function editableColumn(field: TextField, title: string, width: number, flex = false): Column<GrantPaymentRow, TextCellData, string> {
  const inner = keyColumn<GrantPaymentRow, TextField>(field, textColumn);
  return {
    ...inner,
    id: field,
    title,
    basis: width,
    minWidth: width,
    grow: flex ? 1 : 0,
    shrink: 0,
    component: PaymentTextCell,
    columnData: { field, inner },
    disabled: ({ rowData }) => !canEdit(rowData),
  };
}

function readonlyText(field: "date" | "account" | "payer", title: string, width: number): Column<GrantPaymentRow> {
  return {
    ...createDerivedColumn<GrantPaymentRow>({
      render: (row) => <span className="grant-payment-text" title={row[field]} data-payment-field={field}>{row[field]}</span>,
      copy: (row) => row[field],
    }),
    id: field,
    title,
    basis: width,
    minWidth: width,
    grow: 0,
    shrink: 0,
  };
}

interface ActionData {
  onEdit: (instId: string) => void;
  onExclude: (txId: string) => void;
}

function PaymentActionCellInner({ rowData, columnData }: CellProps<GrantPaymentRow, ActionData>) {
  const ledger = rowData.kind === "ledger";
  const action = ledger ? "빼기" : "수정";
  return (
    <button
      type="button"
      className="grant-payment-action"
      aria-label={`${action}: ${rowData.label || rowData.date || "내역"}`}
      title={ledger ? "이 지원사업의 받은 돈에서 제외" : "회차의 금액·예정일·수령 정보 수정"}
      disabled={!ledger && !rowData.instId}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (ledger) columnData.onExclude(rowData.id);
        else if (rowData.instId) columnData.onEdit(rowData.instId);
      }}
    >
      {action}
    </button>
  );
}
const PaymentActionCell = memo(PaymentActionCellInner) as typeof PaymentActionCellInner;

export function GrantPaymentSheet({
  label,
  rows,
  onEdit,
  onExclude,
  onPatchInst,
}: {
  label: string;
  rows: GrantPaymentRow[];
  onEdit: (instId: string) => void;
  onExclude: (txId: string) => void;
  onPatchInst: (id: string, patch: Partial<FinGrantInstallment>) => void;
}) {
  // 열과 셀 컴포넌트의 신원을 유지해 자동 저장 중에도 선택과 입력을 보존한다.
  const columns = useMemo<Column<GrantPaymentRow>[]>(() => [
    {
      ...createDerivedColumn<GrantPaymentRow>({
        render: (row) => <Badge size="sm" tone={row.tone ?? "neutral"}>{row.status}</Badge>,
        copy: (row) => row.status,
      }),
      id: "status", title: "상태", basis: 96, minWidth: 96, grow: 0, shrink: 0,
    },
    readonlyText("date", "날짜", 132),
    editableColumn("label", "내역", 170),
    readonlyText("account", "계좌", 135),
    readonlyText("payer", "입금자", 140),
    {
      ...createDerivedColumn<GrantPaymentRow>({
        render: (row) => <span className={`nd-num ${row.amount < 0 ? "text-nd-expense-text" : row.amount > 0 ? "text-nd-income-text" : "text-nd-fg-3"}`} data-payment-field="amount">{Math.round(row.amount).toLocaleString("ko-KR")}</span>,
        copy: (row) => row.amount,
        alignRight: true,
      }),
      id: "amount", title: "금액 (원)", basis: 130, minWidth: 130, grow: 0, shrink: 0,
    },
    editableColumn("note", "메모", 220, true),
  ], []);

  const management = useMemo<SimpleColumn<GrantPaymentRow, ActionData>>(() => ({
    title: "관리",
    basis: 80,
    minWidth: 80,
    grow: 0,
    shrink: 0,
    component: PaymentActionCell,
    columnData: { onEdit, onExclude },
  }), [onEdit, onExclude]);

  const change = useCallback((next: GrantPaymentRow[]) => {
    const previous = new Map(rows.map((row) => [row.id, row]));
    for (const row of next) {
      const before = previous.get(row.id);
      if (!before || !canEdit(before) || !before.instId) continue;
      const patch: Partial<FinGrantInstallment> = {};
      if (row.label !== before.label) patch.label = row.label;
      if (row.note !== before.note) patch.note = row.note;
      if (Object.keys(patch).length) onPatchInst(before.instId, patch);
    }
  }, [rows, onPatchInst]);

  return (
    <section aria-label={label} data-grant-payment-sheet={label} className="grant-payment-sheet">
      <div className="ledger-sheet">
        <DynamicDataSheetGrid<GrantPaymentRow>
          value={rows}
          onChange={change}
          columns={columns}
          gutterColumn={{ title: "#", basis: 44, minWidth: 44, grow: 0, shrink: 0 }}
          stickyRightColumn={management}
          rowKey="id"
          height={HEADER_HEIGHT + rows.length * ROW_HEIGHT + 24}
          headerRowHeight={HEADER_HEIGHT}
          rowHeight={ROW_HEIGHT}
          lockRows
          autoAddRow={false}
          addRowsComponent={false}
          disableSmartDelete
          rowClassName={({ rowData }) => `grant-payment-row-${rowData.kind}`}
        />
      </div>
      {rows.length === 0 && <p className="grant-payment-empty" role="status">등록된 내역이 없습니다.</p>}
    </section>
  );
}
