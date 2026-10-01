"use client";

// ============================================================
//  엑셀 임포트 퍼즐 조각 — 계좌·카드사 칸 하나
// ------------------------------------------------------------
//  매출 적재의 세 칸 퍼즐과 같은 생김새(neander.css 의 nd-puzzle-piece)를
//  재무에서는 열 칸 남짓으로 늘려 쓴다. 칸이 많으니 한 칸은 작고, 상태는
//  테두리 빛과 머리의 작은 표시로만 말한다.
//
//  화면(import/page)이 데이터와 동작을 주고, 여기는 그리기만 한다 — 그래서
//  로그인 없이도 가짜 데이터로 모양을 확인할 수 있다.
// ============================================================

import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  FileSpreadsheet,
  KeyRound,
  LockOpen,
  Undo2,
  Upload,
} from "lucide-react";
import {
  Button,
  Card,
  cn,
  Icon,
  Input,
  Money,
} from "@/components/neander/ui";
import type {
  FinBank,
  FinImportSlot,
  FinSlotStatus,
  AccountGuess,
} from "@/lib/neander/finance/import-slots";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 칸의 순간 상태 — 적재 결과는 장부에서 오고, 이건 진행·오류·환율 대기만 */
export type PieceActivity =
  | { kind: "idle" }
  | { kind: "busy"; step: string; fileName: string }
  | { kind: "error"; message: string; fileName?: string }
  | { kind: "fx"; fileName: string; currency: string; fxRows: number; rows: number };

export type PieceState = "missing" | "busy" | "error" | "fx" | "done";

export function pieceStateOf(status: FinSlotStatus, activity: PieceActivity): PieceState {
  if (activity.kind === "busy") return "busy";
  if (activity.kind === "error") return "error";
  if (activity.kind === "fx") return "fx";
  return status.filled ? "done" : "missing";
}

/** 은행·카드사 색 점 + 이름 */
export function BankMark({ bank, size = "sm" }: { bank: FinBank; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", size === "sm" ? "text-nd-table" : "text-nd-body")}>
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: bank.color }} aria-hidden />
      <span className="font-medium text-nd-fg-2">{bank.short}</span>
    </span>
  );
}

export function PuzzlePiece({
  status,
  activity,
  onFiles,
  onUndo,
  onNoActivity,
  locked = false,
  onFx,
  fxDefault,
}: {
  status: FinSlotStatus;
  activity: PieceActivity;
  onFiles: (files: File[]) => void;
  onUndo?: () => void;
  /** 「이 달 거래 없음」 — 올릴 파일이 없는 달에 칸을 채운다 (빈 칸에서만 보인다) */
  onNoActivity?: () => void;
  /** 다른 파일을 읽는 중 — 버튼을 감추지 않고 잠근다 (감추면 칸 높이가 출렁인다) */
  locked?: boolean;
  /** 환율을 받아 적재를 이어간다 (국민 법인카드 해외 승인) */
  onFx?: (rate: number) => void;
  fxDefault?: string;
}) {
  const { slot, batch } = status;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rate, setRate] = useState(fxDefault ?? "");
  const state = pieceStateOf(status, activity);
  /** 파일 없이 「거래 없음」으로 채운 칸 — 초록이지만 숫자 대신 그 말을 보여준다 */
  const none = state === "done" && status.noActivity;

  function drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files ?? []));
  }

  return (
    <Card
      padding="none"
      className={cn(
        "nd-puzzle-piece nd-puzzle-tinted flex min-h-[13.5rem] flex-col overflow-hidden rounded-nd-lg",
        over && "cursor-copy",
      )}
      // 은행·카드사 색을 바탕에 옅게 — 채워졌든 비었든 어느 회사 칸인지 색으로 먼저 읽힌다
      style={{ "--nd-piece-tint": slot.bank.tint ?? slot.bank.color } as CSSProperties}
      data-state={state === "fx" ? "busy" : state}
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      aria-label={`${slot.label} — ${
        none ? "거래 없음" : state === "done" ? "적재됨" : state === "busy" ? "진행 중" : state === "error" ? "오류" : state === "fx" ? "환율 필요" : "비어 있음"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* 머리 */}
      {/* 글씨는 ERP 기본 단계보다 한두 단계 크다 — 칸은 이 화면의 본문이고, 큰 모니터에서
          11px 는 읽히지 않는다는 지적을 받았다 (가장 작은 글씨가 13px) */}
      <div className="flex items-start justify-between gap-2 border-b border-nd-line px-3.5 py-2.5">
        <div className="min-w-0">
          <BankMark bank={slot.bank} />
          <p className="truncate text-[16px] font-semibold leading-snug text-nd-fg" title={slot.label}>
            {slot.label}
          </p>
          <p className="nd-num truncate text-nd-table text-nd-fg-3">
            {slot.kind === "account" ? `···${slot.last4s[0]} · ${slot.sub}` : slot.sub}
          </p>
        </div>
        <StateMark state={state} none={none} />
      </div>

      {/* 몸통 */}
      <div className="flex flex-1 flex-col px-3.5 py-3">
        {state === "busy" && activity.kind === "busy" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
            <p className="text-nd-body text-nd-fg">{activity.step}</p>
            <p className="max-w-full truncate text-nd-table text-nd-fg-3" title={activity.fileName}>
              {activity.fileName}
            </p>
          </div>
        )}

        {state === "error" && activity.kind === "error" && (
          <div className="flex flex-1 flex-col gap-1.5">
            <p className="text-nd-table text-nd-danger-text">{activity.message}</p>
            <DropHint bank={slot.bank} onPick={() => inputRef.current?.click()} retry />
            {!status.filled && <NoActivityButton onClick={onNoActivity} disabled={locked} />}
          </div>
        )}

        {state === "fx" && activity.kind === "fx" && (
          <div className="flex flex-1 flex-col gap-1.5">
            <p className="text-nd-table text-nd-fg-2">
              해외 승인 <b className="nd-num">{activity.fxRows}</b>건이 {activity.currency} 로 찍혀 있습니다. 환율을
              넣으면 원화로 환산해 적재합니다.
            </p>
            <p className="max-w-full truncate text-nd-table text-nd-fg-3" title={activity.fileName}>
              {activity.fileName}
            </p>
            <div className="mt-auto flex items-center gap-1.5">
              <Input
                size="sm"
                inputMode="decimal"
                className="nd-num w-24"
                placeholder="예: 1380"
                aria-label={`${activity.currency} 환율`}
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && Number(rate) > 0) onFx?.(Number(rate));
                }}
              />
              <Button size="sm" disabled={!(Number(rate) > 0)} onClick={() => onFx?.(Number(rate))}>
                적재
              </Button>
            </div>
          </div>
        )}

        {state === "missing" && (
          <div className="flex flex-1 flex-col gap-1.5">
            <DropHint bank={slot.bank} onPick={() => inputRef.current?.click()} />
            <NoActivityButton onClick={onNoActivity} disabled={locked} />
          </div>
        )}

        {none && (
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-[15px] font-medium text-nd-fg">이 달은 거래가 없습니다</p>
            <p className="text-nd-table text-nd-fg-3">
              파일 없이 채운 칸입니다. 뒤늦게 거래가 생겼으면 파일을 올리세요 — 표시는 저절로 지워집니다.
            </p>
            <div className="mt-auto flex items-center justify-between gap-1 pt-1">
              <Button size="sm" variant="ghost" icon={Upload} onClick={() => inputRef.current?.click()}>
                파일 올리기
              </Button>
              {onUndo && (
                <Button size="sm" variant="ghost" icon={Undo2} onClick={onUndo}>
                  표시 지우기
                </Button>
              )}
            </div>
          </div>
        )}

        {state === "done" && !none && (
          <div className="flex flex-1 flex-col gap-1">
            {batch ? (
              <p className="flex items-center gap-1 text-nd-table text-nd-fg">
                <Icon icon={FileSpreadsheet} size={14} className="shrink-0 text-nd-fg-3" />
                <span className="truncate" title={batch.fileName}>{batch.fileName}</span>
              </p>
            ) : (
              <p className="text-nd-table text-nd-fg-2">장부에 이미 있음 (통합거래장 적재분)</p>
            )}
            {batch?.from && batch.to && (
              <p className="nd-num text-nd-table text-nd-fg-3">
                {batch.from.slice(5)} ~ {batch.to.slice(5)}
              </p>
            )}
            <p className="nd-num text-[15px] font-semibold text-nd-fg">
              {won(status.count)}건
              {status.otherCount > 0 && (
                <span className="ml-1.5 text-nd-table font-normal text-nd-fg-3">자금·카드대금 {won(status.otherCount)}</span>
              )}
            </p>
            <p className="nd-num flex flex-wrap gap-x-2 text-nd-table">
              {status.income > 0 && (
                <span className="text-nd-fg-2">
                  수입 <Money value={status.income} unit={false} flow="income" />
                </span>
              )}
              {status.expense !== 0 && (
                <span className="text-nd-fg-2">
                  지출 <Money value={status.expense} unit={false} flow="expense" />
                </span>
              )}
            </p>
            <p className="flex flex-wrap gap-x-2 text-nd-table">
              <span className="text-nd-success-text">확정 {won(status.confirmed)}</span>
              <span className="text-nd-warning-text">제안 {won(status.suggested)}</span>
              {status.needsReview > 0 ? (
                <Link href="/neander/finance/review" className="font-medium text-nd-danger-text underline">
                  검토 {won(status.needsReview)}
                </Link>
              ) : (
                <span className="text-nd-fg-3">검토 0</span>
              )}
            </p>
            <div className="mt-auto flex items-center justify-between gap-1 pt-1">
              <Button size="sm" variant="ghost" icon={Upload} onClick={() => inputRef.current?.click()}>
                바꾸기
              </Button>
              {onUndo && batch && (
                <Button size="sm" variant="ghost" icon={Undo2} onClick={onUndo}>
                  되돌리기
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function StateMark({ state, none = false }: { state: PieceState; none?: boolean }) {
  const cls = "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-nd-table font-medium";
  if (none)
    return (
      <span className={cn(cls, "bg-nd-success-soft text-nd-success-text")}>
        <Icon icon={CircleMinus} size={13} /> 거래 없음
      </span>
    );
  if (state === "done")
    return (
      <span className={cn(cls, "bg-nd-success-soft text-nd-success-text")}>
        <Icon icon={CircleCheck} size={13} /> 적재됨
      </span>
    );
  if (state === "busy") return <span className={cn(cls, "bg-nd-accent-soft text-nd-accent-strong")}>진행 중</span>;
  if (state === "fx")
    return (
      <span className={cn(cls, "bg-nd-warning-soft text-nd-warning-text")}>
        <Icon icon={KeyRound} size={13} /> 환율
      </span>
    );
  if (state === "error")
    return (
      <span className={cn(cls, "bg-nd-danger-soft text-nd-danger-text")}>
        <Icon icon={CircleAlert} size={13} /> 오류
      </span>
    );
  return (
    <span className={cn(cls, "bg-nd-danger-soft text-nd-danger-text")}>
      <Icon icon={CircleAlert} size={13} /> 비어 있음
    </span>
  );
}

function DropHint({ bank, onPick, retry = false }: { bank: FinBank; onPick: () => void; retry?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-1 flex-col items-center justify-center gap-1 rounded-nd-md border border-dashed border-nd-border px-2 py-3 text-center transition-colors duration-nd-fast hover:bg-nd-sunken"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-nd-fg/[.06] text-nd-fg-2">
        <Icon icon={bank.encrypted ? LockOpen : Upload} size={16} />
      </span>
      <span className="text-nd-body font-medium text-nd-fg">{retry ? "다른 파일을 놓으세요" : "파일을 놓으세요"}</span>
      <span className="text-nd-table text-nd-fg-3">{bank.encrypted ? "암호는 서버가 풉니다" : bank.source}</span>
    </button>
  );
}

/**
 * 「이 달 거래 없음」 — 빈 칸 아래의 작은 버튼.
 * 파일 놓는 자리보다 눈에 덜 띄어야 한다. 대부분의 달은 파일이 있고,
 * 이 버튼은 빠뜨린 칸을 채운 것처럼 보이게 만들 수 있는 길이기 때문이다.
 */
function NoActivityButton({ onClick, disabled = false }: { onClick?: () => void; disabled?: boolean }) {
  if (!onClick) return null;
  return (
    <Button size="sm" variant="ghost" icon={CircleMinus} className="self-center" disabled={disabled} onClick={onClick}>
      이 달 거래 없음
    </Button>
  );
}

// ============================================================
//  어느 계좌인지 못 정한 파일 — 사람이 고른다
// ============================================================

export function UnassignedCard({
  fileName,
  bank,
  rows,
  period,
  ranked,
  filledKeys,
  onPick,
  onDismiss,
}: {
  fileName: string;
  bank: FinBank;
  rows: number;
  period: { from: string; to: string } | null;
  ranked: AccountGuess[];
  /** 이미 채워진 칸 — 고르면 바꾸기가 된다는 표시 */
  filledKeys: Set<string>;
  onPick: (slot: FinImportSlot) => void;
  onDismiss: () => void;
}) {
  return (
    <Card className="border-nd-warning/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-nd-body font-semibold text-nd-fg">
            <BankMark bank={bank} size="md" />
            <span className="min-w-0 break-all">{fileName}</span>
          </p>
          <p className="mt-0.5 text-nd-body text-nd-fg-2">
            {bank.label} 파일인데 <b>파일 안에 계좌번호가 없어</b> 어느 계좌인지 정하지 못했습니다.
            {period && (
              <span className="nd-num">
                {" "}
                {period.from} ~ {period.to} · {won(rows)}건
              </span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          제외
        </Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map((g) => {
          const filled = filledKeys.has(g.slot.key);
          return (
            <button
              key={g.slot.key}
              type="button"
              onClick={() => onPick(g.slot)}
              className="flex flex-col gap-0.5 rounded-nd-md border border-nd-border bg-nd-content px-3 py-2 text-left transition-colors duration-nd-fast hover:border-nd-accent hover:bg-nd-accent-soft"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-nd-body font-medium text-nd-fg">{g.slot.label}</span>
                <span className="nd-num text-nd-table text-nd-fg-3">···{g.slot.last4s[0]}</span>
              </span>
              <span className="text-nd-table text-nd-fg-2">{g.reason}</span>
              <span className="nd-num text-nd-table text-nd-fg-3">
                거래처 겹침 {Math.round(g.overlap * 100)}%
                {g.balanceMatch && <span className="ml-1 text-nd-success-text">· 잔액 이어짐</span>}
                {filled && <span className="ml-1 text-nd-warning-text">· 이미 채워짐 — 바꾸기</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** 다음 할 일 타일 — 매출 적재와 같은 모양 */
export function NextStep({
  href,
  icon,
  n,
  title,
  sub,
  tone,
}: {
  href: string;
  icon: typeof Upload;
  n: number;
  title: string;
  sub: ReactNode;
  tone?: "warning" | "success";
}) {
  return (
    <Link
      href={href}
      className="nd-surface flex items-center gap-3 rounded-nd-lg p-3 text-left transition-colors duration-nd-fast hover:bg-nd-sunken"
    >
      <span className="nd-num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nd-sunken text-nd-body font-semibold text-nd-fg-2">
        {n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] font-medium text-nd-fg">
          <Icon icon={icon} size={14} className="text-nd-fg-3" />
          {title}
        </span>
        <span
          className={cn(
            "block truncate text-nd-table",
            tone === "warning" ? "text-nd-warning-text" : tone === "success" ? "text-nd-success-text" : "text-nd-fg-3",
          )}
        >
          {sub}
        </span>
      </span>
    </Link>
  );
}
