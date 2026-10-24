import "server-only";

// 거래 변경 이력 저장소 — neander_fin_tx_log (finance/tx-log.ts)
//
//  쓰기 전에 지금 문서를 읽어 두고(readForLog), 쓴 뒤에 바뀐 칸만 남긴다(writeLog).
//  기록은 화면을 막지 않는다 — 기록이 실패해도 거래 쓰기는 이미 끝났다. 실패는
//  서버 기록(console)에만 남긴다.

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { diffFields, isVia, LOGGED_FIELDS, type TxLogEntry, type TxLogKind } from "../tx-log";

const col = (db: Firestore) => db.collection(NEANDER_COL.finTxLog);

/** 한 거래에서 보여 주는 최대 줄 수 */
const MAX_SHOWN = 100;

/** 쓰기 전의 문서들 (id → 데이터). 없는 id 는 빠진다 */
export async function readForLog(db: Firestore, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const uniq = [...new Set(ids.filter(Boolean))];
  const c = db.collection(NEANDER_COL.finTransactions);
  for (let i = 0; i < uniq.length; i += 300) {
    const snaps = await db.getAll(...uniq.slice(i, i + 300).map((id) => c.doc(id)));
    snaps.forEach((s) => {
      if (s.exists) out.set(s.id, s.data() as Record<string, unknown>);
    });
  }
  return out;
}

export interface LogItem {
  txId: string;
  kind: TxLogKind;
  /** 바꾸기 전 · 바꾼 값 (edit · restore) */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** 바뀐 칸이 있는 것만 남긴다. 실패해도 던지지 않는다 */
export async function writeLog(db: Firestore, by: string, via: unknown, items: LogItem[]): Promise<void> {
  try {
    const at = Date.now();
    const rows: Omit<TxLogEntry, "id">[] = [];
    items.forEach((it) => {
      if (it.kind === "delete" || it.kind === "add") {
        rows.push({ txId: it.txId, at, by, kind: it.kind, ...(isVia(via) ? { via } : {}) });
        return;
      }
      // 되돌리기는 문서를 통째로 덮는다 — 되쓴 문서에 없는 칸은 비워진 것이다
      const after =
        it.kind === "restore"
          ? Object.fromEntries(LOGGED_FIELDS.map((f) => [f, it.after?.[f] ?? null]))
          : (it.after ?? {});
      const changes = diffFields(it.before, after);
      if (changes.length === 0) return;
      rows.push({ txId: it.txId, at, by, kind: it.kind, changes, ...(isVia(via) ? { via } : {}) });
    });
    for (let i = 0; i < rows.length; i += 450) {
      const batch = db.batch();
      rows.slice(i, i + 450).forEach((r) => batch.set(col(db).doc(), r));
      await batch.commit();
    }
  } catch (e) {
    console.error("[finance/tx-log]", e);
  }
}

/** 한 거래의 기록 — 최근 것이 위 */
export async function listTxLog(db: Firestore, txId: string): Promise<TxLogEntry[]> {
  if (!txId) return [];
  // txId 하나로만 거른다 — 정렬까지 서버에 맡기면 복합 색인이 필요하다
  const snap = await col(db).where("txId", "==", txId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<TxLogEntry, "id">) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SHOWN);
}
