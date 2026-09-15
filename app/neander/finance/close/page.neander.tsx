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
//
//  화면 구성은 승인 목업(all-pages/finance-close.png)을 따른다:
//  제목 줄 → 진행 단계 → 그 달의 숫자 → 마감 처리 → 점검 목록.
//  단계는 새로 만든 상태가 아니라 이미 있는 두 사실(막는 점검이 남았나 ·
//  마감했나)에서 그대로 유도한다 — 화면과 데이터가 어긋날 자리를 안 만든다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
  Lock,
  LockOpen,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Icon,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  type LucideIcon,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  SERIES,
  StatTile,
  Stepper,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  type Tone,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { FadeSwap } from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  closeFinMonth,
  reopenFinMonth,
} from "@/lib/neander/finance/client";
import {
  blockingChecks,
  monthSnapshot,
  monthsOf,
  runMonthChecks,
  snapshotDrift,
  type CheckResult,
  type Severity,
} from "@/lib/neander/finance/close";
import {
  monthLabel,
} from "@/lib/neander/format";

/**
 * 심각도는 색 하나로 전하지 않는다 — 톤(색) + 아이콘 + 글자 셋을 같이
 * 붙인다. 색을 못 보는 사람도, 흑백으로 뽑아도 뜻이 남는다.
 */
const SEVERITY: Record<Severity, { label: string; tone: Tone; icon: LucideIcon }> = {
  block: { label: "마감 불가", tone: "danger", icon: CircleAlert },
  warn: { label: "확인 권장", tone: "warning", icon: TriangleAlert },
  info: { label: "참고", tone: "info", icon: Info },
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
      <PageShell>
        <PageHeader title="월 마감" />
        <EmptyState
          icon={CalendarCheck}
          title="마감할 달이 없습니다"
          description="임포트 탭에서 거래를 먼저 올리세요."
        />
      </PageShell>
    );
  }

  const isClosed = (m: string) => closes.some((c) => c.month === m);

  // 단계는 상태에서 유도한다 (새 상태를 만들지 않는다):
  //   막는 점검이 남아 있으면 아직 ①점검, 통과했으면 ②얼릴 숫자 확인,
  //   마감했으면 ③마감. 마감 이후의 변동(drift)은 ②의 힌트로 보인다.
  const step = closed ? 2 : blockers.length > 0 ? 0 : 1;
  const steps = [
    {
      key: "check",
      label: "점검",
      hint:
        blockers.length > 0
          ? `막는 항목 ${blockers.length}가지`
          : checks.length > 0
            ? `${checks.length}개 항목 확인`
            : "걸리는 항목 없음",
    },
    {
      key: "diff",
      label: "차이 확인",
      hint: closed
        ? drift.length > 0
          ? `마감 이후 ${drift.length}개 항목 변동`
          : "마감 이후 변동 없음"
        : "얼릴 숫자 확인",
    },
    {
      key: "close",
      label: "마감",
      hint: closed ? new Date(closed.closedAt).toLocaleDateString("ko-KR") : "이 달 마감 처리",
    },
  ];

  return (
    <PageShell>
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
        className="mb-4"
        meta={
          closed ? (
            <Badge tone="success" dot>{monthLabel(active)} 마감됨</Badge>
          ) : (
            <Badge tone="neutral" dot>{monthLabel(active)} 열림</Badge>
          )
        }
      />

      {/* ---- 진행 단계 ---- */}
      <Card className="mb-4">
        <SectionHeader title={`${monthLabel(active)} 마감 진행`} hint="점검 → 차이 확인 → 마감" />
        <Stepper steps={steps} current={step} ariaLabel="월 마감 진행 단계" />
      </Card>

      {/* ---- 그 달의 숫자 ---- */}
      {current && (
        <KpiStrip columns={4} className="mb-4">
          <StatTile label="수입" value={current.income} flow="income" accent={SERIES.income} />
          <StatTile
            label="지출"
            value={current.expense}
            flow="expense"
            hint={current.refund ? `환급 ${current.refund.toLocaleString("ko-KR")}원 차감 전` : undefined}
            accent={SERIES.expense}
          />
          <StatTile label="순손익" value={current.net} flow="net" tone="accent" />
          <StatTile label="거래 건수" value={current.count} tone="neutral" />
        </KpiStrip>
      )}

      {/* ---- 마감 상태 ----
          마감·해제로 판이 통째로 바뀐다 — 살짝 떠오르며 바뀌어야 방금 상태가
          넘어갔다는 게 보인다 (달을 바꿀 때도 같다) */}
      <Card className="mb-4">
        <FadeSwap swapKey={`${active}|${closed ? "closed" : "open"}`}>
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
              {drift.length === 0 && (
                <p className="mt-3 text-nd-body text-nd-fg-3">
                  마감 이후 이 달의 숫자는 바뀌지 않았습니다.
                </p>
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
        </FadeSwap>
      </Card>

      {/* ---- 마감 이후 변동 ----
          알림 안에 표를 넣으면 표가 알림 색을 뒤집어써 숫자가 안 읽힌다.
          "무슨 일이 있었나"는 알림으로, "얼마가 달라졌나"는 표(Card)로 나눈다. */}
      {closed && drift.length > 0 && (
        <>
          <InlineNotice tone="warning" icon={TriangleAlert} className="mb-2 animate-in fade-in slide-in-from-top-1 duration-nd">
            <p className="font-semibold">마감 이후 숫자가 바뀌었습니다</p>
            <p className="mt-0.5 text-nd-caption">
              보고한 숫자와 달라졌습니다. 의도한 수정이면 마감을 해제하고 다시 마감하세요.
            </p>
          </InlineNotice>
          <Card padding="none" className="mb-4 overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="마감 시점과의 차이"
                hint="얼린 값 → 지금 값"
                action={<TableNote>단위: 원</TableNote>}
              />
            </div>
            <TableScroll>
              <Table minWidth={620} dense>
                <thead>
                  <tr>
                    <Th className="pl-5">항목</Th>
                    <Th align="right">마감 시점</Th>
                    <Th align="center">
                      <span className="sr-only">변화 방향</span>
                    </Th>
                    <Th align="right">지금</Th>
                    <Th align="right" className="pr-5">차이</Th>
                  </tr>
                </thead>
                <tbody>
                  {drift.map((d) => (
                    <Tr key={d.label}>
                      <Td className="pl-5 text-nd-fg-2">{d.label}</Td>
                      <Td num muted>{d.before.toLocaleString("ko-KR")}</Td>
                      <Td align="center" className="px-1 text-nd-fg-4">
                        <Icon icon={ArrowRight} size={14} />
                      </Td>
                      <Td num>{d.after.toLocaleString("ko-KR")}</Td>
                      <Td num className="pr-5"><Money value={d.delta} unit={false} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        </>
      )}

      {/* ---- 점검 목록 ---- */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="데이터 품질 점검"
            hint={checks.length === 0 ? undefined : `${checks.length}개 항목`}
            action={
              blockers.length > 0 ? (
                <Badge tone="danger">
                  <Icon icon={CircleAlert} size={13} />
                  마감 불가 {blockers.length}
                </Badge>
              ) : undefined
            }
          />
        </div>
        {checks.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              compact
              icon={CalendarCheck}
              title="걸리는 항목이 없습니다"
              description="이 달은 깨끗합니다."
              className="border-0"
            />
          </div>
        ) : (
          <ul className="divide-y divide-nd-line border-t border-nd-line">
            {checks.map((c) => (
              <CheckRow
                key={c.id}
                check={c}
                expanded={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}

/** 점검 한 줄 — 누르면 묶음 표가 열린다 */
function CheckRow({
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
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors duration-nd-fast hover:bg-nd-sunken"
      >
        {/* 색 + 아이콘 + 글자 셋으로 심각도를 전한다 (왼쪽 색 막대 대신) */}
        <Badge tone={sev.tone} className="mt-0.5 shrink-0">
          <Icon icon={sev.icon} size={13} />
          {sev.label}
        </Badge>
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
        <div id={panelId} className="border-t border-nd-line bg-nd-sunken/40 px-5 py-3 animate-in fade-in slide-in-from-top-1 duration-nd">
          <TableScroll>
            {/* 머리글이 없으면 낭독기가 「무엇의 건수·금액인지」를 읽지 못한다 */}
            <Table minWidth={520} dense>
              <thead>
                <tr>
                  <Th className="pl-0">묶음</Th>
                  <Th align="right" className="w-20">건수</Th>
                  <Th align="right" className="w-32 pr-0">금액</Th>
                </tr>
              </thead>
              <tbody>
                {check.groups.map((g) => (
                  <Tr key={g.label}>
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
    </li>
  );
}
