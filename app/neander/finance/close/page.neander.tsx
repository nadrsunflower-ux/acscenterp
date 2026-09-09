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
import { ArrowRight, CalendarCheck, ChevronDown, ChevronRight, Lock, LockOpen, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  PageHeader,
  SectionHeader,
  Table,
  TableScroll,
  Td,
  Tr,
  cn,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { MonthStepper } from "@/components/neander/finance/ReportTabs";
import { Money, SERIES, StatTile, monthLabel } from "@/components/neander/finance/ui";
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

const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  block: { label: "마감 불가", tone: "danger" },
  warn: { label: "확인 권장", tone: "warning" },
  info: { label: "참고", tone: "info" },
};

export default function ClosePage() {
  const { transactions, accounts, paymentMethods, closes, loading, error, refresh } = useFinance();
  const confirm = useConfirm();
  const toast = useToast();

  const months = useMemo(() => monthsOf(transactions), [transactions]);
  const [month, setMonth] = useState("");
  const active = month || months[0] || "";

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
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
    try {
      await closeFinMonth(active, current, note.trim() || undefined);
      setNote("");
      await refresh();
      toast.success(`${monthLabel(active)}을 마감했습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "마감에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function doReopen() {
    if (!active) return;
    if (
      !(await confirm({
        title: `${monthLabel(active)} 마감을 해제할까요?`,
        message: "얼려둔 숫자도 함께 지워집니다.",
        confirmLabel: "마감 해제",
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    try {
      await reopenFinMonth(active);
      await refresh();
      toast.success(`${monthLabel(active)} 마감을 해제했습니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "마감 해제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="장부를 불러오는 중…" />;
  // 불러오기 오류 배너는 레이아웃이 이미 띄운다 — 여기서 또 띄우지 않는다
  if (error) return null;
  if (months.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="월 마감" />
        <EmptyState
          icon={CalendarCheck}
          title="마감할 달이 없습니다"
          description="임포트 탭에서 거래를 먼저 올리세요."
        />
      </div>
    );
  }

  const isClosed = (m: string) => closes.some((c) => c.month === m);

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <ToolbarPortal order={0}>
        <MonthStepper
          glass
          months={months}
          value={active}
          onChange={setMonth}
          labelFor={(m) => (isClosed(m) ? "마감" : undefined)}
        />
      </ToolbarPortal>

      <PageHeader
        title="월 마감"
        description="점검을 통과한 달의 숫자를 얼려 둡니다. 이후 그 달이 바뀌면 여기서 차이가 드러납니다."
        meta={
          closed ? (
            <Badge tone="success" dot>{monthLabel(active)} 마감됨</Badge>
          ) : (
            <Badge tone="neutral" dot>{monthLabel(active)} 열림</Badge>
          )
        }
      />

      {/* ---- 그 달의 숫자 ---- */}
      {current && (
        <KpiStrip columns={4} className="mb-5">
          <StatTile label="수입" value={current.income} accent={SERIES.income} />
          <StatTile
            label="지출"
            value={current.expense}
            hint={current.refund ? `환급 ${current.refund.toLocaleString("ko-KR")}원 차감 전` : undefined}
            accent={SERIES.expense}
          />
          <StatTile label="순손익" value={current.net} tone="accent" />
          <StatTile label="거래 건수" value={current.count} tone="neutral" />
        </KpiStrip>
      )}

      {/* ---- 마감 상태 ---- */}
      <Card className="mb-5">
        {closed ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="success" dot>마감됨</Badge>
                <span className="text-nd-body text-nd-fg-2">
                  {new Date(closed.closedAt).toLocaleString("ko-KR")} · {closed.closedBy}
                </span>
              </div>
              {closed.note && <p className="mt-2 text-nd-body text-nd-fg-2">{closed.note}</p>}

              {drift.length === 0 ? (
                <p className="mt-3 text-nd-body text-nd-fg-3">
                  마감 이후 이 달의 숫자는 바뀌지 않았습니다.
                </p>
              ) : (
                <InlineNotice tone="warning" icon={TriangleAlert} className="mt-3">
                  <p className="font-semibold">마감 이후 숫자가 바뀌었습니다</p>
                  <TableScroll className="mt-2">
                    <Table dense>
                      <tbody>
                        {drift.map((d) => (
                          <Tr key={d.label} hover={false}>
                            <Td className="pl-0 text-nd-fg-2">{d.label}</Td>
                            <Td num muted>{d.before.toLocaleString("ko-KR")}</Td>
                            <Td className="px-1 text-nd-fg-4"><Icon icon={ArrowRight} size={14} /></Td>
                            <Td num>{d.after.toLocaleString("ko-KR")}</Td>
                            <Td num className="pr-0"><Money value={d.delta} unit={false} /></Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableScroll>
                  <p className="mt-2 text-nd-caption">
                    보고한 숫자와 달라졌습니다. 의도한 수정이면 마감을 해제하고 다시 마감하세요.
                  </p>
                </InlineNotice>
              )}
            </div>
            <Button variant="danger" icon={LockOpen} onClick={doReopen} disabled={busy}>
              마감 해제
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-[16rem] flex-1">
              <p className="text-nd-body font-semibold text-nd-fg">{monthLabel(active)} 마감</p>
              <p className={cn("mt-1 text-nd-body", blockers.length > 0 ? "text-nd-danger-text" : "text-nd-fg-2")}>
                {blockers.length > 0
                  ? `마감을 막는 항목이 ${blockers.length}가지 남았습니다.`
                  : "점검을 통과했습니다. 지금 숫자를 얼려 둡니다."}
              </p>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="메모 (선택) — 예: 카드 매입 반영 완료, 부가세 신고분 확인함"
                aria-label="마감 메모"
                className="mt-3"
              />
            </div>
            <Button icon={Lock} onClick={doClose} loading={busy} disabled={blockers.length > 0}>
              이 달 마감
            </Button>
          </div>
        )}
      </Card>

      {/* ---- 점검 목록 ---- */}
      <SectionHeader
        title="데이터 품질 점검"
        hint={checks.length === 0 ? undefined : `${checks.length}개 항목`}
      />
      {checks.length === 0 ? (
        <EmptyState
          compact
          icon={CalendarCheck}
          title="걸리는 항목이 없습니다"
          description="이 달은 깨끗합니다."
        />
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
  const sev = SEVERITY[check.severity];
  const panelId = `check-${check.id}`;
  return (
    <Card
      padding="none"
      className={cn(
        "overflow-hidden border-l-4",
        check.severity === "block" && "border-l-nd-danger",
        check.severity === "warn" && "border-l-nd-warning",
        check.severity === "info" && "border-l-nd-info",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-nd-fast hover:bg-nd-sunken"
      >
        <Badge tone={sev.tone} className="mt-0.5 shrink-0">{sev.label}</Badge>
        <div className="min-w-0 flex-1">
          <p className="text-nd-body font-semibold text-nd-fg">{check.title}</p>
          <p className="mt-0.5 text-nd-body text-nd-fg-2">{check.why}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="nd-num text-nd-body font-semibold text-nd-fg">{check.count}건</p>
          <p className="nd-num text-nd-caption text-nd-fg-3">
            {Math.round(check.amount).toLocaleString("ko-KR")}원
          </p>
        </div>
        <Icon
          icon={expanded ? ChevronDown : ChevronRight}
          size={16}
          className="ml-1 mt-1 shrink-0 text-nd-fg-3"
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-nd-line px-4 py-3">
          <TableScroll>
            <Table dense>
              <tbody>
                {check.groups.map((g) => (
                  <Tr key={g.label} hover={false}>
                    <Td className="pl-0 text-nd-fg-2">
                      {g.href ? (
                        <Link href={g.href} className="font-medium text-nd-accent-strong hover:underline">
                          {g.label}
                        </Link>
                      ) : (
                        g.label
                      )}
                    </Td>
                    <Td num muted className="w-20">{g.count}건</Td>
                    <Td num muted className="w-32 pr-0">
                      {Math.round(g.amount).toLocaleString("ko-KR")}원
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          {check.more > 0 && (
            <p className="mt-2 text-nd-caption text-nd-fg-3">… 외 {check.more}개 묶음</p>
          )}
          {check.href && (
            <Link
              href={check.href}
              className="mt-3 inline-flex items-center gap-1 text-nd-body font-medium text-nd-accent-strong hover:underline"
            >
              해당 거래 전체 열기 <Icon icon={ArrowRight} size={14} />
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
