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
//  「방금 처리한 것」 목록에서 되돌릴 수 있다. 새로고침하면 사라진다 —
//  서버에 쌓는 이력이 아니다.
//
//  ⚠️ 되돌리면 그 사이 다른 곳에서 고친 값도 처리 직전 값으로 덮인다.
// ============================================================

import { useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "./button";
import { Card } from "./surface";
import { useToast } from "./toast";
import { cn } from "./cn";

export interface UndoEntry<T> {
  id: number;
  label: string;
  before: T[];
  /** 처리 때 새로 생긴 행 id — 되돌리면 지운다 (조합으로 나눈 나머지 줄 등) */
  created?: string[];
}

export function useUndoHistory<T extends object>({
  restore,
  onRestored,
  limit = 10,
}: {
  /** 처리 직전의 행들을 되쓰고, 처리 때 새로 생긴 행을 지운다 */
  restore: (before: T[], created: string[]) => Promise<unknown>;
  /** 되쓴 뒤 — 보통 목록 다시 불러오기 */
  onRestored?: () => Promise<unknown> | void;
  limit?: number;
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<UndoEntry<T>[]>([]);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const seq = useRef(0);

  // 알림의 버튼은 만든 시점의 함수를 쥐고 있으므로, 기록을 id 로 찾지 않고
  // 기록 자체를 넘겨받는다 (찾으면 옛 entries 에서 못 찾는다).
  const undo = async (entry: UndoEntry<T>) => {
    setUndoingId(entry.id);
    try {
      await restore(entry.before, entry.created ?? []);
      setEntries((xs) => xs.filter((x) => x.id !== entry.id));
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
  const record = (message: string, label: string, before: T[], created?: string[]) => {
    if (before.length === 0) {
      toast.success(message);
      return;
    }
    const entry: UndoEntry<T> = { id: ++seq.current, label, before: structuredClone(before), created };
    setEntries((xs) => [entry, ...xs].slice(0, limit));
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
  if (entries.length === 0) return null;
  return (
    // 처음 생길 때와 줄이 하나 늘 때 위에서 살짝 내려앉는다 — 방금 처리한 것이
    // 여기로 옮겨 왔다는 걸 눈이 따라가게 (키가 그대로인 줄은 다시 움직이지 않는다)
    <Card className={cn("px-4 py-3 animate-in fade-in duration-nd", className)}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-nd-caption font-semibold text-nd-fg-2">방금 처리한 것</p>
        <span className="text-nd-caption text-nd-fg-3">새로고침하면 사라집니다</span>
      </div>
      <ul className="flex flex-col divide-y divide-nd-border">
        {entries.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 py-1.5 animate-in fade-in slide-in-from-top-1 duration-nd">
            <span className="min-w-0 truncate text-nd-body">{h.label}</span>
            <Button
              size="sm"
              variant="secondary"
              icon={Undo2}
              loading={undoingId === h.id}
              disabled={undoingId !== null}
              onClick={() => onUndo(h)}
            >
              되돌리기
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
