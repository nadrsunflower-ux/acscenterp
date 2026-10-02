"use client";

// ============================================================
//  가수금 기록장 — 건 하나를 적고 고치는 창
// ------------------------------------------------------------
//  한 건은 세 덩어리다: 누구 돈이 얼마 (위) · 이 건이 생긴 장부 거래 (가운데) ·
//  갚은 기록 (아래). 수기 대장의 한 줄을 그대로 옮긴 모양이다.
//
//  갚은 기록은 두 가지가 한 목록에 선다 —
//    장부      가수금 계정으로 잡힌 거래를 골라 붙인다. 날짜는 거래의 것을 읽는다
//    장부 밖   현금 · 다른 사업자 통장 · 다른 대금과 상계. 날짜·금액·방법을 손으로 적는다
//  한 거래를 여러 건이 나눠 가질 수 있어 금액은 「이 건의 몫」 을 적는다.
//
//  저장은 「저장」 한 번에 건을 통째로 보낸다. 붙인 거래가 말이 되는지(겹쳐 붙임 ·
//  방향)는 서버가 다시 본다 — 화면이 들고 있는 목록은 낡았을 수 있다.
// ============================================================

import { useId, useMemo, useRef, useState } from "react";
import { Link2, Plus, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  FormRow,
  IconButton,
  Input,
  Menu,
  type MenuItem,
  Money,
  SegmentedControl,
  Textarea,
} from "@/components/neander/ui";
import {
  allocatedByTx,
  DIRECTION_LABEL,
  isSuspenseTx,
  roleFlow,
  SETTLE_LABEL,
  suspenseFlow,
  type FinSuspenseDoc,
  type FinSuspenseInput,
  type LinkRole,
  type SuspenseDirection,
} from "@/lib/neander/finance/suspense";
import { netAmount, type FinTransaction } from "@/lib/neander/finance/types";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 금액 칸 — 천 단위 쉼표를 찍어 보여 주고 숫자만 받는다 */
function AmountInput({
  value,
  onChange,
  ariaLabel,
  size = "md",
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel?: string;
  size?: "sm" | "md";
}) {
  return (
    <Input
      size={size}
      inputMode="numeric"
      value={value ? won(value) : ""}
      placeholder="0"
      onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
      className="nd-num text-right"
      aria-label={ariaLabel}
    />
  );
}

export interface SuspenseEditorProps {
  open: boolean;
  /** 고치는 건의 id. 없으면 새 건 */
  id?: string;
  /** 처음 채울 값 — 창이 열릴 때 한 번 읽는다 (부르는 쪽이 key 로 다시 만든다) */
  initial: FinSuspenseInput;
  /** 다른 건이 거래마다 얼마를 붙였는지 세는 데 쓴다 */
  items: FinSuspenseDoc[];
  transactions: FinTransaction[];
  /** 계좌 뒷 4자리 → 별칭 */
  aliasOf: (last4?: string) => string;
  /** 이름 고르기 후보 */
  people: string[];
  saving: boolean;
  onSave: (input: FinSuspenseInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function SuspenseEditor({
  open,
  id,
  initial,
  items,
  transactions,
  aliasOf,
  people,
  saving,
  onSave,
  onDelete,
  onClose,
}: SuspenseEditorProps) {
  const [draft, setDraft] = useState<FinSuspenseInput>(initial);
  const [picker, setPicker] = useState<LinkRole | null>(null);
  const originBtn = useRef<HTMLButtonElement>(null);
  const settleBtn = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const set = <K extends keyof FinSuspenseInput>(key: K, value: FinSuspenseInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  /** 붙일 수 있는 것은 가수금 계정의 거래뿐이다 — 장부 1만 건을 누를 때마다 훑지 않게 미리 추린다 */
  const pool = useMemo(() => transactions.filter(isSuspenseTx), [transactions]);
  /** 다른 건들이 붙여 둔 금액 — 이 건이 쓸 수 있는 몫은 그만큼 줄어든다 */
  const others = useMemo(() => allocatedByTx(items.filter((x) => x.id !== id)), [items, id]);
  const mine = useMemo(() => allocatedByTx([draft]), [draft]);

  /** 그 자리에 붙일 수 있는 거래 — 방향이 맞고 아직 몫이 남은 가수금 거래 */
  const candidates = (role: LinkRole) => {
    const flow = roleFlow(draft.direction, role);
    return pool
      .filter((t) => suspenseFlow(t) === flow)
      .map((t) => ({ tx: t, rest: netAmount(t) - (others.get(t.id) ?? 0) - (mine.get(t.id) ?? 0) }))
      .filter((c) => c.rest > 0)
      .sort((a, b) => b.tx.date.localeCompare(a.tx.date));
  };

  const settled = draft.settles.reduce((s, x) => s + (x.amount || 0), 0);
  const originSum = draft.origins.reduce((s, o) => s + (o.amount || 0), 0);
  const remaining = draft.companyMoney ? 0 : draft.amount - settled;
  const settleWord = SETTLE_LABEL[draft.direction];

  const addLink = (role: LinkRole, tx: FinTransaction, rest: number) => {
    if (role === "origin") {
      const room = draft.amount - originSum;
      set("origins", [...draft.origins, { txId: tx.id, amount: room > 0 ? Math.min(rest, room) : rest }]);
      // 비어 있는 건은 거래에서 채운다 — 대개 그 거래가 곧 이 건이다
      if (!draft.amount) set("amount", rest);
      if (!draft.date) set("date", tx.date);
    } else {
      const room = draft.amount - settled;
      set("settles", [...draft.settles, { txId: tx.id, amount: room > 0 ? Math.min(rest, room) : rest }]);
    }
  };

  const menuItems = (role: LinkRole): MenuItem[] => {
    const list = candidates(role);
    if (list.length === 0) {
      return [{ type: "label", key: "none", label: "붙일 수 있는 가수금 거래가 없습니다" }];
    }
    return list.map(({ tx, rest }) => ({
      key: tx.id,
      label: `${tx.date} · ${aliasOf(tx.last4)} · ${tx.vendor ?? "거래처 없음"}`,
      hint: rest === netAmount(tx) ? won(rest) : `${won(rest)} 남음`,
      onSelect: () => addLink(role, tx, rest),
    }));
  };

  const txLabel = (txId: string) => {
    const tx = txById.get(txId);
    if (!tx) return <span className="text-nd-danger-text">원장에 없는 거래</span>;
    return (
      <span className="min-w-0 truncate">
        <span className="nd-num">{tx.date}</span> · {aliasOf(tx.last4)} · {tx.vendor ?? "거래처 없음"}
        <span className="ml-1.5 text-nd-fg-3">거래 금액 {won(netAmount(tx))}</span>
      </span>
    );
  };

  const directionOptions = (Object.keys(DIRECTION_LABEL) as SuspenseDirection[]).map((d) => ({
    value: d,
    label: DIRECTION_LABEL[d],
  }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      closeOnOverlay={false}
      title={id ? `${draft.no ? `${draft.no}번 ` : ""}건 고치기` : "새 건 적기"}
      description={
        draft.direction === "in"
          ? "임직원이 회사에 넣은 돈 — 회사가 갚을 돈입니다."
          : "회사가 임직원에게 내준 돈 (가지급 · 대납) — 회사가 받을 돈입니다."
      }
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" icon={Trash2} onClick={onDelete} disabled={saving} className="mr-auto text-nd-danger-text">
              이 건 지우기
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => onSave(draft)} loading={saving}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* ---- 누구 돈이 얼마 ---- */}
        <FormRow className="grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_96px]">
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">구분</span>
            <SegmentedControl
              ariaLabel="구분"
              options={directionOptions}
              value={draft.direction}
              onChange={(v) => {
                // 방향을 바꾸면 붙여 둔 거래의 방향이 다 어긋난다 — 같이 비운다
                setDraft((d) => ({
                  ...d,
                  direction: v,
                  companyMoney: v === "in" ? d.companyMoney : undefined,
                  origins: [],
                  settles: d.settles.filter((s) => !s.txId),
                }));
              }}
            />
          </div>
          <Field label="금액" required>
            <AmountInput value={draft.amount} onChange={(n) => set("amount", n)} />
          </Field>
          <Field label="발생일" hint="모르면 비워 둡니다">
            <Input type="date" value={draft.date ?? ""} onChange={(e) => set("date", e.target.value || undefined)} />
          </Field>
          <Field label="번호">
            <Input
              inputMode="numeric"
              value={draft.no ?? ""}
              onChange={(e) => set("no", Number(e.target.value.replace(/[^\d]/g, "")) || undefined)}
              className="nd-num text-right"
            />
          </Field>
        </FormRow>

        <FormRow className="grid-cols-1 sm:grid-cols-3">
          <Field label="실제 돈 주인" required hint="잔액은 이 사람 앞으로 셉니다">
            <Input list={listId} value={draft.owner} onChange={(e) => set("owner", e.target.value)} />
          </Field>
          <Field label="명의" hint="통장에 찍힌 사람 — 돈 주인과 같으면 비워 둡니다">
            <Input list={listId} value={draft.nominee ?? ""} onChange={(e) => set("nominee", e.target.value || undefined)} />
          </Field>
          <Field label="목적" hint="무엇에 쓴 돈인가">
            <Input value={draft.purpose ?? ""} onChange={(e) => set("purpose", e.target.value || undefined)} />
          </Field>
          <datalist id={listId}>
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </FormRow>

        {draft.direction === "in" && (
          <Checkbox
            checked={!!draft.companyMoney}
            onChange={(e) => set("companyMoney", e.target.checked || undefined)}
            label={
              <>
                회사 돈
                <span className="ml-2 text-nd-table text-nd-fg-3">
                  회사 돈이 개인 통장을 거쳐 다시 들어온 것 — 갚을 빚이 아니라 잔액에서 뺍니다. 돈 주인 칸에는 출처를 적습니다.
                </span>
              </>
            }
          />
        )}

        <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="증빙 서류">
            <Input value={draft.evidence ?? ""} onChange={(e) => set("evidence", e.target.value || undefined)} />
          </Field>
          <Field label="비고">
            <Textarea
              rows={2}
              value={draft.note ?? ""}
              onChange={(e) => set("note", e.target.value || undefined)}
              className="min-h-[2.25rem] w-full"
            />
          </Field>
        </FormRow>

        {/* ---- 이 건이 생긴 장부 거래 ---- */}
        <section className="border-t border-nd-line pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-nd-section text-nd-fg">
              이 건이 생긴 장부 거래
              <span className="ml-2 text-nd-table font-normal text-nd-fg-3">
                장부에 없으면(2024-12 이전 · 현금) 비워 둡니다
              </span>
            </h3>
            <Button ref={originBtn} variant="secondary" size="sm" icon={Link2} onClick={() => setPicker("origin")}>
              장부 거래 붙이기
            </Button>
          </div>
          {draft.origins.length > 0 && (
            <ul className="flex flex-col gap-2">
              {draft.origins.map((o, i) => (
                <li key={`${o.txId}-${i}`} className="grid grid-cols-[minmax(0,1fr)_150px_auto] items-center gap-2 text-nd-table">
                  {txLabel(o.txId)}
                  <AmountInput
                    size="sm"
                    value={o.amount}
                    ariaLabel="이 건의 몫"
                    onChange={(n) => set("origins", draft.origins.map((x, j) => (j === i ? { ...x, amount: n } : x)))}
                  />
                  <IconButton
                    icon={X}
                    size="sm"
                    label="떼기"
                    onClick={() => set("origins", draft.origins.filter((_, j) => j !== i))}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- 갚은 기록 ---- */}
        <section className="border-t border-nd-line pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-nd-section text-nd-fg">
              {draft.direction === "in" ? "갚은 기록" : "돌려받은 기록"}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button ref={settleBtn} variant="secondary" size="sm" icon={Link2} onClick={() => setPicker("settle")}>
                장부 거래에서 고르기
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => set("settles", [...draft.settles, { amount: Math.max(remaining, 0) }])}
              >
                장부 밖에서 {draft.direction === "in" ? "갚은" : "돌려받은"} 것 적기
              </Button>
            </div>
          </div>
          {draft.settles.length > 0 && (
            <ul className="flex flex-col gap-2">
              {draft.settles.map((s, i) => {
                const patch = (p: Partial<typeof s>) =>
                  set("settles", draft.settles.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <li
                    key={`${s.txId ?? "manual"}-${i}`}
                    className="grid grid-cols-[72px_minmax(0,1.2fr)_150px_minmax(0,1fr)_auto] items-center gap-2 text-nd-table"
                  >
                    <Badge tone={s.txId ? "info" : "neutral"}>{s.txId ? "장부" : "장부 밖"}</Badge>
                    {s.txId ? (
                      txLabel(s.txId)
                    ) : (
                      <Input
                        size="sm"
                        type="date"
                        value={s.date ?? ""}
                        aria-label={`${settleWord} 날짜`}
                        onChange={(e) => patch({ date: e.target.value || undefined })}
                      />
                    )}
                    <AmountInput size="sm" value={s.amount} ariaLabel={`${settleWord} 금액`} onChange={(n) => patch({ amount: n })} />
                    <Input
                      size="sm"
                      value={s.method ?? ""}
                      placeholder={s.txId ? "메모" : "방법 — 현금 · 7773 > 이름 · 상계"}
                      aria-label="방법"
                      onChange={(e) => patch({ method: e.target.value || undefined })}
                    />
                    <IconButton
                      icon={X}
                      size="sm"
                      label="이 줄 지우기"
                      onClick={() => set("settles", draft.settles.filter((_, j) => j !== i))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-nd-body text-nd-fg-2">
            <span>
              금액 <Money value={draft.amount} unit={false} />
            </span>
            <span>
              {settleWord} <Money value={settled} unit={false} />
            </span>
            <span className="font-semibold text-nd-fg">
              남음 <Money value={remaining} />
            </span>
            {draft.companyMoney && <Badge tone="neutral">회사 돈 — 잔액에서 뺌</Badge>}
            {!draft.companyMoney && remaining < 0 && <Badge tone="danger">금액보다 더 {draft.direction === "in" ? "갚았습니다" : "돌려받았습니다"}</Badge>}
          </p>
        </section>
      </div>

      <Menu
        open={picker === "origin"}
        onClose={() => setPicker(null)}
        anchorRef={originBtn}
        placement="bottom-end"
        overDialog
        ariaLabel="이 건이 생긴 장부 거래 고르기"
        className="max-h-[320px] min-w-[420px] overflow-y-auto"
        items={picker === "origin" ? menuItems("origin") : []}
      />
      <Menu
        open={picker === "settle"}
        onClose={() => setPicker(null)}
        anchorRef={settleBtn}
        placement="bottom-end"
        overDialog
        ariaLabel={`${settleWord} 장부 거래 고르기`}
        className="max-h-[320px] min-w-[420px] overflow-y-auto"
        items={picker === "settle" ? menuItems("settle") : []}
      />
    </Dialog>
  );
}
