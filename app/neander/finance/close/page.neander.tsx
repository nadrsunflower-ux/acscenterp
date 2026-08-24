"use client";

// ============================================================
//  월 마감
// ------------------------------------------------------------
//  한 달을 "끝났다"고 선언하는 화면. 두 가지를 한다.
//
//   ① 마감 전 점검 — 분류가 덜 끝났거나 계정이 비었거나 중복인 거래를
//      전부 세어 보여준다. 각 항목은 누르면 그 거래만 걸린 원장이 열린다.
//      숫자만 보여주고 "가서 찾아라" 하면 아무도 안 고친다.
//
//   ② 마감 — 그 시점의 수입·지출·순손익을 얼려서 저장한다. 이후 그 달의
//      거래가 바뀌면 **얼린 값과 현재 값의 차이**를 이 화면이 드러낸다.
//      마감이 쓰기를 막지는 않는다 (이유는 close.ts 주석 참고).
//
//  ⚠️ block 항목이 남아 있으면 마감 버튼을 잠근다. warn·info 는 막지
//     않는다 — 사업구분 미기입처럼 "알고 넘어가는" 항목이 실제로 있다.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, PageHeader, Badge, Select, EmptyState } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { Money, SectionTitle, StatTile } from "@/components/neander/finance/ui";
import { closeFinMonth, reopenFinMonth } from "@/lib/neander/finance/client";
import {
  blockingChecks,
  monthSnapshot,
  monthsOf,
  runMonthChecks,
  snapshotDrift,
  type CheckResult,
  type Severity,
} from "@/lib/neander/finance/close";

const TONE: Record<Severity, { label: string; color: string; ring: string }> = {
  block: { label: "마감 불가", color: "#e11d48", ring: "border-rose-200 bg-rose-50/40" },
  warn: { label: "확인 권장", color: "#d97706", ring: "border-amber-200 bg-amber-50/40" },
  info: { label: "참고", color: "#0284c7", ring: "border-sky-200 bg-sky-50/40" },
};

export default function ClosePage() {
  const { transactions, accounts, paymentMethods, closes, loading, error, refresh } = useFinance();

  const months = useMemo(() => monthsOf(transactions), [transactions]);
  const [month, setMonth] = useState("");
  const active = month || months[0] || "";

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const checks = useMemo(
    () =>
      active
        ? runMonthChecks({ month: active, transactions, accounts, paymentMethods })
        : [],
    [active, transactions, accounts, paymentMethods],
  );
  const current = useMemo(
    () => (active ? monthSnapshot(transactions, active) : null),
    [active, transactions],
  );
  const closed = useMemo(() => closes.find((c) => c.month === active), [closes, active]);
  const drift = useMemo(
    () => (closed && current ? snapshotDrift(closed.snapshot, current) : []),
    [closed, current],
  );
  const blockers = blockingChecks(checks);

  async function doClose() {
    if (!current || !active) return;
    setBusy(true);
    setFailed(null);
    try {
      await closeFinMonth(active, current, note.trim() || undefined);
      setNote("");
      await refresh();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "마감에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function doReopen() {
    if (!active) return;
    if (!confirm(`${active} 마감을 해제할까요? 얼려둔 숫자도 함께 지워집니다.`)) return;
    setBusy(true);
    setFailed(null);
    try {
      await reopenFinMonth(active);
      await refresh();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "마감 해제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="p-6 text-sm text-zinc-400">불러오는 중…</p>;
  // 불러오기 오류 배너는 레이아웃이 이미 띄운다 — 여기서 또 띄우지 않는다
  if (error) return null;
  if (months.length === 0) {
    return (
      <EmptyState
        icon="🗓️"
        title="마감할 달이 없습니다"
        description="임포트 탭에서 거래를 먼저 올리세요."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <PageHeader
        title="월 마감"
        description="점검을 통과한 달의 숫자를 얼려 둡니다. 이후 그 달이 바뀌면 여기서 차이가 드러납니다."
        actions={
          <Select value={active} onChange={(e) => setMonth(e.target.value)} className="w-36">
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
                {closes.some((c) => c.month === m) ? " · 마감" : ""}
              </option>
            ))}
          </Select>
        }
      />

      {failed && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {failed}
        </p>
      )}

      {/* ---- 그 달의 숫자 ---- */}
      {current && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="수입" value={current.income} accent="#0ea5e9" />
          <StatTile
            label="지출"
            value={current.expense}
            hint={current.refund ? `환급 ${current.refund.toLocaleString("ko-KR")}원 차감 전` : undefined}
            accent="#f97316"
          />
          <StatTile label="순손익" value={current.net} accent="#6366f1" />
          <StatTile label="거래 건수" value={current.count} accent="#a1a1aa" />
        </div>
      )}

      {/* ---- 마감 상태 ---- */}
      <Card className="mb-5">
        {closed ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge color="#16a34a">마감됨</Badge>
                <span className="text-sm text-zinc-600">
                  {new Date(closed.closedAt).toLocaleString("ko-KR")} · {closed.closedBy}
                </span>
              </div>
              {closed.note && <p className="mt-2 text-sm text-zinc-500">{closed.note}</p>}

              {drift.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">
                  마감 이후 이 달의 숫자는 바뀌지 않았습니다.
                </p>
              ) : (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-sm font-semibold text-amber-800">
                    마감 이후 숫자가 바뀌었습니다
                  </p>
                  <table className="mt-2 text-sm">
                    <tbody>
                      {drift.map((d) => (
                        <tr key={d.label}>
                          <td className="py-0.5 pr-4 text-zinc-500">{d.label}</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums text-zinc-400">
                            {d.before.toLocaleString("ko-KR")}
                          </td>
                          <td className="py-0.5 pr-2 text-zinc-300">→</td>
                          <td className="py-0.5 pr-4 text-right tabular-nums text-zinc-700">
                            {d.after.toLocaleString("ko-KR")}
                          </td>
                          <td className="py-0.5 text-right">
                            <Money value={d.delta} unit={false} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-amber-700">
                    보고한 숫자와 달라졌습니다. 의도한 수정이면 마감을 해제하고 다시 마감하세요.
                  </p>
                </div>
              )}
            </div>
            <Button variant="ghost" onClick={doReopen} disabled={busy}>
              마감 해제
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-[16rem] flex-1">
              <p className="text-sm font-semibold text-zinc-700">{active} 마감</p>
              <p className="mt-1 text-sm text-zinc-500">
                {blockers.length > 0
                  ? `마감을 막는 항목이 ${blockers.length}가지 남았습니다.`
                  : "점검을 통과했습니다. 지금 숫자를 얼려 둡니다."}
              </p>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="메모 (선택) — 예: 카드 매입 반영 완료, 부가세 신고분 확인함"
                className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </div>
            <Button onClick={doClose} disabled={busy || blockers.length > 0}>
              {busy ? "저장 중…" : "이 달 마감"}
            </Button>
          </div>
        )}
      </Card>

      {/* ---- 점검 목록 ---- */}
      <SectionTitle hint={checks.length === 0 ? undefined : `${checks.length}개 항목`}>
        데이터 품질 점검
      </SectionTitle>
      {checks.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-zinc-500">
            걸리는 항목이 없습니다. 이 달은 깨끗합니다.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {checks.map((c) => (
            <CheckCard
              key={c.id}
              check={c}
              expanded={open === c.id}
              onToggle={() => setOpen(open === c.id ? null : c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckCard({
  check,
  expanded,
  onToggle,
}: {
  check: CheckResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tone = TONE[check.severity];
  return (
    <div className={`rounded-xl border ${tone.ring}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <Badge color={tone.color}>{tone.label}</Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">{check.title}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{check.why}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-zinc-800">{check.count}건</p>
          <p className="text-xs tabular-nums text-zinc-400">
            {Math.round(check.amount).toLocaleString("ko-KR")}원
          </p>
        </div>
        <span className="ml-1 shrink-0 text-zinc-400">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200/70 px-4 py-3">
          <table className="w-full text-sm">
            <tbody>
              {check.groups.map((g) => (
                <tr key={g.label} className="border-b border-zinc-100 last:border-0">
                  <td className="py-1.5 pr-3 text-zinc-600">
                    {g.href ? (
                      <Link href={g.href} className="text-indigo-600 hover:underline">
                        {g.label}
                      </Link>
                    ) : (
                      g.label
                    )}
                  </td>
                  <td className="w-20 py-1.5 text-right tabular-nums text-zinc-500">{g.count}건</td>
                  <td className="w-32 py-1.5 text-right tabular-nums text-zinc-500">
                    {Math.round(g.amount).toLocaleString("ko-KR")}원
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {check.more > 0 && (
            <p className="mt-2 text-xs text-zinc-400">… 외 {check.more}개 묶음</p>
          )}
          {check.href && (
            <Link
              href={check.href}
              className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
            >
              해당 거래 전체 열기 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
