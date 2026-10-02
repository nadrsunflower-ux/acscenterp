"use client";

// ============================================================
//  거래 나누기 창 — 한 번에 결제한 것을 조각으로 가른다
// ------------------------------------------------------------
//  조각마다 금액 · 프로젝트 · 사업구분 · 계정을 따로 정한다 (finance/split.ts).
//  합이 원래 금액과 같아야 저장된다 — 남은 금액을 늘 보여 주고, 앞 조각의 금액을
//  고치면 마지막 조각이 나머지를 받는다.
//
//  금액을 일일이 치지 않아도 되게 두 가지 길을 둔다:
//    · 비율 (`2:4`) — 수량대로 나눌 때
//    · 메모의 수량 — 카드 메모가 「JIMFF 배너2, 평택배너4」 처럼 수량으로 끝나면 그대로
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Plus, Split, Trash2, TriangleAlert } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  IconButton,
  InlineNotice,
  Input,
  Money,
  Select,
} from "@/components/neander/ui";
import { AccountPicker } from "./AccountPicker";
import {
  parseRatio,
  quantitiesInMemo,
  SPLIT_MAX_PARTS,
  splitByRatio,
  validateSplit,
  type SplitPart,
} from "@/lib/neander/finance/split";
import { BIZ_MAJORS } from "@/lib/neander/finance/sheet";
import type { FinAccountDoc } from "@/lib/neander/finance/db-types";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import type { FinTransaction } from "@/lib/neander/finance/types";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
/** 금액 칸에 친 글자 → 숫자 (쉼표 · 빈칸은 걷어낸다) */
const toAmount = (text: string) => {
  const n = Number(text.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

type Row = Omit<SplitPart, "gross"> & { amount: string };

export function SplitDialog({
  tx,
  accounts,
  projects,
  bizMinorsOf,
  onClose,
  onSplit,
}: {
  /** 나눌 거래 — null 이면 창이 닫혀 있다 */
  tx: FinTransaction | null;
  accounts: FinAccountDoc[];
  projects: FinProjectDoc[];
  bizMinorsOf: (major?: string) => string[];
  onClose: () => void;
  /** 저장 — 실패하면 던진다 (창이 메시지를 보여 준다) */
  onSplit: (tx: FinTransaction, parts: SplitPart[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [ratio, setRatio] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const total = Math.abs(Math.round(tx?.gross ?? 0));
  const sign = Math.sign(tx?.gross ?? 1) || 1;
  const memoQty = useMemo(() => quantitiesInMemo(tx?.cardMemo), [tx?.cardMemo]);

  // 열 때마다 두 조각에서 시작한다 — 둘 다 원래 분류를 물려받고, 금액은 첫 조각이 전부 든다
  useEffect(() => {
    if (!tx) return;
    const base = {
      projectCode: tx.projectCode,
      bizMajor: tx.bizMajor,
      bizMinor: tx.bizMinor,
      acctMajor: tx.acctMajor,
      acctMid: tx.acctMid,
      acctMinor: tx.acctMinor,
    };
    // 메모에 수량이 적혀 있으면 그 비율로 미리 나눠 둔다 (JIMFF 배너2, 평택배너4 → 2:4)
    const preset = memoQty ? splitByRatio(Math.abs(Math.round(tx.gross)), memoQty.weights) : [];
    setRows(
      preset.length >= 2
        ? preset.map((amt) => ({ ...base, amount: String(amt) }))
        : [
            { ...base, amount: String(Math.abs(Math.round(tx.gross))) },
            { ...base, amount: "" },
          ],
    );
    setRatio(memoQty ? memoQty.weights.join(":") : "");
    setFailed(null);
  }, [tx, memoQty]);

  const amounts = rows.map((r) => toAmount(r.amount));
  const left = total - amounts.reduce((s, n) => s + n, 0);
  const parts: SplitPart[] = rows.map(({ amount, ...rest }) => ({ ...rest, gross: toAmount(amount) * sign }));
  const problem = tx ? validateSplit(tx, parts) : null;

  /** 앞 조각의 금액을 고치면 마지막 조각이 나머지를 받는다 (마지막 조각을 직접 고칠 때는 그대로 둔다) */
  const setAmount = (i: number, text: string) =>
    setRows((prev) => {
      const next = prev.map((r, j) => (j === i ? { ...r, amount: text.replace(/[^\d,]/g, "") } : r));
      const last = next.length - 1;
      if (i !== last) {
        const others = next.slice(0, last).reduce((s, r) => s + toAmount(r.amount), 0);
        next[last] = { ...next[last], amount: total - others > 0 ? String(total - others) : "" };
      }
      return next;
    });
  const setRow = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** 비율대로 — 조각 수가 비율의 수와 다르면 맞춘다 (새 조각은 첫 조각의 분류를 물려받는다) */
  const applyRatio = (weights: number[]) => {
    const split = splitByRatio(total, weights);
    if (split.length === 0) return;
    setRows((prev) => split.map((amt, i) => ({ ...(prev[i] ?? { ...prev[0] }), amount: String(amt) })));
  };
  const ratioWeights = parseRatio(ratio);

  /** 프로젝트를 고르면 — 사업구분이 비어 있고 프로젝트가 사업부를 말해 주면 같이 채운다 */
  const pickProject = (i: number, code: string) => {
    const project = projects.find((p) => p.code === code);
    const row = rows[i];
    const major =
      !row.bizMajor && project?.bizMinor
        ? BIZ_MAJORS.find((m) => bizMinorsOf(m).includes(project.bizMinor as string))
        : undefined;
    setRow(i, { projectCode: code || undefined, ...(major ? { bizMajor: major, bizMinor: project?.bizMinor } : {}) });
  };

  const save = async () => {
    if (!tx || problem) return;
    setSaving(true);
    setFailed(null);
    try {
      await onSplit(tx, parts);
      onClose();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "나누지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!tx}
      onClose={onClose}
      size="xl"
      closeOnOverlay={false}
      title="거래 나누기"
      description="한 번에 결제한 것을 프로젝트 · 사업부별로 가릅니다. 조각의 합은 원래 금액과 같아야 합니다."
      footer={
        <>
          <span
            className={cn(
              "mr-auto text-[15px] font-medium",
              left === 0 && !problem ? "text-nd-success-text" : "text-nd-danger-text",
            )}
          >
            {left !== 0
              ? left > 0
                ? `남은 금액 ${won(left)}원`
                : `${won(-left)}원 넘쳤습니다`
              : problem
                ? "조각마다 금액을 적어 주세요"
                : "합이 맞습니다"}
          </span>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button icon={Split} onClick={() => void save()} loading={saving} disabled={!!problem}>
            {rows.length}조각으로 나누기
          </Button>
        </>
      }
    >
      {tx && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-nd-md bg-nd-sunken px-3 py-2">
            <span className="text-[16px] font-semibold text-nd-fg">{tx.vendor || "(거래처 없음)"}</span>
            <Money value={total} className="text-[16px] font-semibold" />
            <span className="nd-num text-nd-body text-nd-fg-2">{tx.date}</span>
            {tx.cardMemo && <span className="min-w-0 break-words text-nd-body text-nd-fg">{tx.cardMemo}</span>}
          </div>

          {/* 금액을 일일이 치지 않는 길 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-nd-body font-medium text-nd-fg">비율로 나누기</span>
            <Input
              aria-label="비율"
              className="w-[9rem]"
              placeholder="예: 2:4"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ratioWeights) applyRatio(ratioWeights);
              }}
            />
            <Button variant="secondary" disabled={!ratioWeights} onClick={() => ratioWeights && applyRatio(ratioWeights)}>
              적용
            </Button>
            <Button variant="ghost" onClick={() => applyRatio(rows.map(() => 1))}>
              똑같이
            </Button>
            {memoQty && (
              <span className="text-nd-table text-nd-fg-2">
                메모의 수량 {memoQty.labels.map((l, i) => `${l || "항목"} ${memoQty.weights[i]}`).join(" · ")}
              </span>
            )}
          </div>

          <ul className="mt-3 space-y-2.5">
            {rows.map((r, i) => (
              <li key={i} className="rounded-nd-lg border border-nd-border p-3">
                <div className="grid grid-cols-2 items-center gap-2 lg:grid-cols-[2.25rem_9.5rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <span className="nd-num hidden text-center text-[15px] font-semibold text-nd-fg-2 lg:block">{i + 1}</span>
                  <Input
                    aria-label={`조각 ${i + 1} 금액`}
                    inputMode="numeric"
                    className="nd-num text-right font-semibold"
                    placeholder="금액"
                    value={r.amount ? won(toAmount(r.amount)) : ""}
                    onChange={(e) => setAmount(i, e.target.value)}
                  />
                  <Select aria-label={`조각 ${i + 1} 프로젝트`} value={r.projectCode ?? ""} onChange={(e) => pickProject(i, e.target.value)}>
                    <option value="">프로젝트 없음</option>
                    {r.projectCode && !projects.some((p) => p.code === r.projectCode) && (
                      <option value={r.projectCode}>{r.projectCode} · 미등록</option>
                    )}
                    {projects.map((p) => (
                      <option key={p.id} value={p.code}>
                        {p.name === p.code ? p.code : `${p.name} (${p.code})`}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={`조각 ${i + 1} 사업대분류`}
                    value={r.bizMajor ?? ""}
                    onChange={(e) => {
                      const major = e.target.value || undefined;
                      const minors = bizMinorsOf(major);
                      setRow(i, { bizMajor: major, bizMinor: minors.length === 1 ? minors[0] : undefined });
                    }}
                  >
                    <option value="">사업대분류</option>
                    {BIZ_MAJORS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={`조각 ${i + 1} 사업소분류`}
                    value={r.bizMinor ?? ""}
                    disabled={!r.bizMajor}
                    onChange={(e) => setRow(i, { bizMinor: e.target.value || undefined })}
                  >
                    <option value="">사업소분류</option>
                    {[...new Set([...(r.bizMinor ? [r.bizMinor] : []), ...bizMinorsOf(r.bizMajor)])].map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                  <IconButton
                    icon={Trash2}
                    label={`조각 ${i + 1} 빼기`}
                    variant="ghost"
                    disabled={rows.length <= 2}
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  />
                </div>
                <div className="mt-2 lg:pl-[2.75rem]">
                  <AccountPicker
                    accounts={accounts}
                    txType={tx.txType}
                    compact
                    controlSize="md"
                    info="example"
                    value={{ acctMajor: r.acctMajor, acctMid: r.acctMid, acctMinor: r.acctMinor }}
                    onChange={(v) => setRow(i, v)}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            icon={Plus}
            disabled={rows.length >= SPLIT_MAX_PARTS}
            onClick={() => setRows((prev) => [...prev, { ...prev[0], amount: left > 0 ? String(left) : "" }])}
          >
            조각 추가
          </Button>

          {failed && (
            <InlineNotice tone="danger" icon={TriangleAlert} className="mt-3">
              {failed}
            </InlineNotice>
          )}
          <p className="mt-3 text-nd-table text-nd-fg-3">
            나눈 조각은 각각 한 줄의 거래가 되어 검토 대기함에 남습니다 (확정은 조각마다 따로). 「합치기」 로 다시 한 줄로
            돌릴 수 있습니다.
          </p>
        </>
      )}
    </Dialog>
  );
}
