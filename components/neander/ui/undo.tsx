"use client";

// ============================================================
//  되돌리기 기록 — 검토 대기함(매출·재무) 공용
// ------------------------------------------------------------
//  확정·일괄 지정·삭제처럼 한 번 누르면 목록에서 사라지는 처리는, 잘못
//  눌렀을 때 되짚을 길이 있어야 한다. 처리 **직전의 행 전체**를 사본으로
//  쌓아 두었다가 통째로 되쓴다 (서버: 매출 line.restore · 재무
//  transaction.restore).
//
//  알림에 「되돌리기」가 붙고(10초), 알림이 사라진 뒤에도 화면의
//  「방금 처리한 것」 줄에서 되돌릴 수 있다. 새로고침하면 사라진다 —
//  서버에 쌓는 이력이 아니다.
//
//  ── 자리를 늘리지 않는다 ──
//  예전에는 처리할 때마다 목록이 한 줄씩 자라, 그 아래의 대기 목록이 계속
//  밀려 내려갔다 (열 건을 처리하면 열 줄). 지금은 **늘 한 줄**이다 — 가장
//  최근 것과 그 되돌리기만 보이고, 앞선 것은 눌러서 여는 판에 뜬다. 판은
//  화면 위에 떠서 아래 내용을 밀지 않는다.
//
//  같은 행을 이어서 고친 것은 **한 건으로 묶는다** (계정 → 사업구분 →
//  프로젝트). 되돌리기는 어차피 행을 통째로 처음 값으로 되쓰므로, 칸마다
//  한 줄씩 쌓아 두면 줄 수만 늘고 어느 줄을 눌러도 결과가 같다.
//
//  ⚠️ 되돌리면 그 사이 다른 곳에서 고친 값도 처리 직전 값으로 덮인다.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { ChevronDown, History, Undo2 } from "lucide-react";
import { Button } from "./button";
import { Card } from "./surface";
import { Icon } from "./icon";
import { Popover } from "./popover";
import { useToast } from "./toast";
import { cn } from "./cn";

export interface UndoEntry<T> {
  id: number;
  label: string;
  before: T[];
  /** 처리 때 새로 생긴 행 id — 되돌리면 지운다 (조합으로 나눈 나머지 줄 등) */
  created?: string[];
  /**
   * 사람이 누른 게 아니라 프로그램이 스스로 한 처리 (자동분류가 다시 배운 것 등).
   * 막대의 「되돌리기」 는 사람이 **마지막으로 누른 것**을 가리켜야 하므로, 이런 기록은
   * 막대 앞자리를 차지하지 않고 펼친 판에만 나온다.
   */
  auto?: boolean;
  /** 한 행을 이어서 고친 기록일 때 — 그 행의 열쇠와 고친 것들 */
  rowKey?: string;
  subject?: string;
  changes?: string[];
}

/**
 * 한 행을 칸 하나씩 고칠 때의 기록 이름. 같은 행을 이어서 고치면 한 건으로 묶인다 —
 * `subject` 는 그 행(「쿠팡 15,800원」), `change` 는 이번에 고친 것(「계정 → 소모품비」).
 */
export interface UndoRowLabel {
  subject: string;
  change: string;
}

/** 「계정 → 비움」 뒤에 「계정 → 소모품비」 가 오면 앞의 것을 갈아 끼운다 (같은 칸) */
function mergeChange(changes: string[], change: string): string[] {
  const field = change.split(" → ")[0];
  const at = changes.findIndex((c) => c.split(" → ")[0] === field);
  if (at < 0) return [...changes, change];
  return changes.map((c, i) => (i === at ? change : c));
}

export function useUndoHistory<T extends object>({
  restore,
  onRestored,
  limit = 10,
  keyOf,
}: {
  /** 처리 직전의 행들을 되쓰고, 처리 때 새로 생긴 행을 지운다 */
  restore: (before: T[], created: string[]) => Promise<unknown>;
  /** 되쓴 뒤 — 보통 목록 다시 불러오기 */
  onRestored?: () => Promise<unknown> | void;
  limit?: number;
  /** 행의 열쇠 — 주면 같은 행을 이어서 고친 기록을 한 건으로 묶는다 (UndoRowLabel) */
  keyOf?: (row: T) => string;
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<UndoEntry<T>[]>([]);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const seq = useRef(0);
  // 묶을 기록을 찾으려면 지금 목록을 바로 알아야 한다 (record 는 렌더 사이에도 불린다)
  const entriesRef = useRef<UndoEntry<T>[]>([]);
  const commit = (next: UndoEntry<T>[]) => {
    entriesRef.current = next;
    setEntries(next);
  };

  // 알림의 버튼은 만든 시점의 함수를 쥐고 있으므로, 기록을 id 로 찾지 않고
  // 기록 자체를 넘겨받는다 (찾으면 옛 entries 에서 못 찾는다).
  const undo = async (entry: UndoEntry<T>) => {
    setUndoingId(entry.id);
    try {
      await restore(entry.before, entry.created ?? []);
      commit(entriesRef.current.filter((x) => x.id !== entry.id));
      toast.success(`되돌렸습니다 — ${entry.label}`);
      await onRestored?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "되돌리지 못했습니다.");
    } finally {
      setUndoingId(null);
    }
  };

  /**
   * 처리가 **성공한 뒤** 부른다. before 는 처리 직전 값이어야 한다.
   * 사본으로 남긴다 — 목록을 다시 불러와도 그 시점 값이어야 한다.
   */
  const record = (
    message: string,
    label: string | UndoRowLabel,
    before: T[],
    created?: string[],
    opts?: { auto?: boolean },
  ) => {
    if (before.length === 0) {
      toast.success(message);
      return;
    }
    const row = typeof label === "string" ? null : label;
    const rowKey = row && keyOf && before.length === 1 && !created?.length ? keyOf(before[0]) : undefined;
    // 같은 행을 이어서 고쳤다 — 처음 값(before)과 번호는 그대로 두고 이름만 늘린다.
    // 번호가 같아야 앞서 뜬 알림의 「되돌리기」 가 이 기록을 계속 가리킨다.
    const earlier = rowKey ? entriesRef.current.find((x) => x.rowKey === rowKey) : undefined;
    const changes = row ? mergeChange(earlier?.changes ?? [], row.change) : undefined;
    const entry: UndoEntry<T> = earlier
      ? { ...earlier, changes, label: `${row!.subject} — ${changes!.join(" · ")}` }
      : {
          id: ++seq.current,
          label: row ? `${row.subject} — ${row.change}` : (label as string),
          before: structuredClone(before),
          created,
          ...(opts?.auto ? { auto: true } : {}),
          ...(rowKey ? { rowKey, subject: row!.subject, changes } : {}),
        };
    commit([entry, ...entriesRef.current.filter((x) => x.id !== entry.id)].slice(0, limit));
    toast.success(message, {
      duration: 10000,
      action: { label: "되돌리기", onClick: () => void undo(entry) },
    });
  };

  return { entries, undoingId, record, undo };
}

export function UndoHistory<T>({
  entries,
  undoingId,
  onUndo,
  className,
}: {
  entries: UndoEntry<T>[];
  undoingId: number | null;
  onUndo: (entry: UndoEntry<T>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  // 막대에는 사람이 마지막으로 누른 것 — 프로그램이 스스로 한 처리만 있으면 그것
  const latest = entries.find((e) => !e.auto) ?? entries[0];
  const older = entries.filter((e) => e !== latest);
  // 앞선 기록이 다 없어지면 판을 붙일 단추도 사라진다
  useEffect(() => {
    if (older.length === 0) setOpen(false);
  }, [older.length]);

  if (entries.length === 0) return null;
  return (
    // 늘 한 줄 — 처리할 때마다 자라면 아래 목록이 밀린다 (파일 머리 주석)
    <Card className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 animate-in fade-in duration-nd", className)}>
      <span className="flex shrink-0 items-center gap-1.5 text-nd-table font-semibold text-nd-fg-2">
        <Icon icon={History} size={15} />
        방금 처리한 것
      </span>
      {/* 이름이 바뀔 때마다 살짝 다시 나타난다 — 방금 누른 것이 여기 적혔다는 걸 눈이 따라가게 */}
      <span
        key={`${latest.id}:${latest.label}`}
        className="min-w-0 flex-1 basis-[14rem] truncate text-[15px] text-nd-fg animate-in fade-in duration-nd"
        title={latest.label}
      >
        {latest.label}
      </span>
      <Button
        size="sm"
        variant="secondary"
        icon={Undo2}
        loading={undoingId === latest.id}
        disabled={undoingId !== null}
        onClick={() => onUndo(latest)}
      >
        되돌리기
      </Button>
      {older.length > 0 && (
        <Button
          ref={moreRef}
          size="sm"
          variant="ghost"
          trailingIcon={ChevronDown}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          이전 {older.length}건
        </Button>
      )}
      <Popover
        open={open && older.length > 0}
        onClose={() => setOpen(false)}
        anchorRef={moreRef}
        placement="bottom-end"
        ariaLabel="앞서 처리한 것"
        unpadded
        className="w-[min(44rem,calc(100vw-2rem))]"
      >
        <ul className="flex max-h-[min(22rem,60vh)] flex-col divide-y divide-nd-border overflow-y-auto px-4 py-1">
          {older.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-nd-body leading-snug text-nd-fg">{h.label}</span>
              <Button
                size="sm"
                variant="secondary"
                icon={Undo2}
                className="shrink-0"
                loading={undoingId === h.id}
                disabled={undoingId !== null}
                onClick={() => onUndo(h)}
              >
                되돌리기
              </Button>
            </li>
          ))}
        </ul>
        <p className="border-t border-nd-border px-4 py-2 text-nd-table text-nd-fg-3">
          최근 {entries.length}건까지 남습니다 · 새로고침하면 사라집니다
        </p>
      </Popover>
    </Card>
  );
}
