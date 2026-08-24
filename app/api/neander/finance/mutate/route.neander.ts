import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/finance/server/admin";
import { requireFinanceUser, accessErrorResponse } from "@/lib/neander/finance/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { seedFinanceMasterData } from "@/lib/neander/finance/server/seed";
import { matchMemos, patchFromMemo, type FinCardMemo } from "@/lib/neander/finance/card-memo";
import type { FinTransaction } from "@/lib/neander/finance/types";

// 재무 쓰기 전체. 액션 하나로 모아둔 이유는 인증 게이트를 한 곳에서만
// 통과시키기 위해서다 — 라우트가 흩어지면 한 군데 빠뜨리기 쉽다.
export const dynamic = "force-dynamic";

// Firestore writeBatch 1회 상한(500)보다 넉넉히 아래로
const BATCH_LIMIT = 450;

/** Firestore 는 undefined 를 거부한다 */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

/** Firestore 문서 id 제약: `/` 불가, `__...__` 예약 */
function safeId(s: string): string {
  const t = s.replace(/\//g, "／").slice(0, 400);
  return /^__.*__$/.test(t) ? `_${t}` : t;
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireFinanceUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const body = (await req.json()) as { action?: string; payload?: unknown };
    const action = body.action ?? "";
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const db = adminDb();
    const now = Date.now();

    switch (action) {
      // ---- 거래 ----------------------------------------------
      case "transaction.add": {
        const ref = await db
          .collection(NEANDER_COL.finTransactions)
          .add(clean({ ...(payload as Record<string, unknown>), createdAt: now }));
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "transaction.update": {
        const { id, patch } = payload as { id: string; patch: Record<string, unknown> };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        // undefined 는 '필드 비우기' 의도이므로 삭제로 바꾼다
        const data: Record<string, unknown> = { updatedAt: now, updatedBy: user.email };
        Object.keys(patch ?? {}).forEach((k) => {
          data[k] = patch[k] === undefined || patch[k] === null ? null : patch[k];
        });
        await db.collection(NEANDER_COL.finTransactions).doc(id).set(data, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "transaction.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finTransactions).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      case "transaction.bulkAdd": {
        const { rows } = payload as { rows: Record<string, unknown>[] };
        if (!Array.isArray(rows)) {
          return NextResponse.json({ error: "rows 배열이 필요합니다." }, { status: 400 });
        }
        let written = 0;
        for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          rows.slice(i, i + BATCH_LIMIT).forEach((r) => {
            batch.set(
              db.collection(NEANDER_COL.finTransactions).doc(),
              clean({ ...r, createdAt: now }),
            );
          });
          await batch.commit();
          written += Math.min(BATCH_LIMIT, rows.length - i);
        }
        return NextResponse.json({ ok: true, written });
      }

      case "transaction.bulkStatus": {
        const { ids, status } = payload as { ids: string[]; status: string };
        if (!Array.isArray(ids) || !status) {
          return NextResponse.json({ error: "ids 와 status 가 필요합니다." }, { status: 400 });
        }
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ids.slice(i, i + BATCH_LIMIT).forEach((id) => {
            batch.set(
              db.collection(NEANDER_COL.finTransactions).doc(id),
              { status, updatedAt: now, updatedBy: user.email },
              { merge: true },
            );
          });
          await batch.commit();
        }
        return NextResponse.json({ ok: true, updated: ids.length });
      }

      case "transaction.bulkPatch": {
        // 여러 거래에 같은 값을 한 번에 적용한다 (계정 일괄 교정 등).
        // 상태만 바꾸는 bulkStatus 와 달리 임의 필드를 받는다.
        const { ids, patch } = payload as { ids: string[]; patch: Record<string, unknown> };
        if (!Array.isArray(ids) || !patch) {
          return NextResponse.json({ error: "ids 와 patch 가 필요합니다." }, { status: 400 });
        }
        const data: Record<string, unknown> = {
          ...clean(patch),
          updatedAt: now,
          updatedBy: user.email,
        };
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ids.slice(i, i + BATCH_LIMIT).forEach((id) => {
            batch.set(db.collection(NEANDER_COL.finTransactions).doc(id), data, { merge: true });
          });
          await batch.commit();
        }
        return NextResponse.json({ ok: true, updated: ids.length });
      }

      case "transaction.applyEdits": {
        // 원장 시트의 일괄 저장. 행마다 다른 패치·신규·삭제가 한 번에 온다.
        // 셀 단위로 호출을 쪼개면 중간에 실패했을 때 장부가 반쯤 바뀐 채
        // 남으므로, 가능한 한 writeBatch 로 묶는다 (상한을 넘으면 나눠 커밋).
        const { updates, inserts, deletes } = payload as {
          updates?: { id: string; patch: Record<string, unknown> }[];
          inserts?: Record<string, unknown>[];
          deletes?: string[];
        };
        const col = db.collection(NEANDER_COL.finTransactions);
        type Op = (b: FirebaseFirestore.WriteBatch) => void;
        const ops: Op[] = [];
        (updates ?? []).forEach(({ id, patch }) => {
          if (!id) return;
          const data: Record<string, unknown> = { updatedAt: now, updatedBy: user.email };
          Object.keys(patch ?? {}).forEach((k) => {
            data[k] = patch[k] === undefined || patch[k] === null ? null : patch[k];
          });
          ops.push((b) => b.set(col.doc(id), data, { merge: true }));
        });
        (inserts ?? []).forEach((r) => {
          ops.push((b) => b.set(col.doc(), clean({ ...r, createdAt: now, updatedBy: user.email })));
        });
        (deletes ?? []).forEach((id) => {
          if (id) ops.push((b) => b.delete(col.doc(id)));
        });
        for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
          await batch.commit();
        }
        return NextResponse.json({
          ok: true,
          updated: (updates ?? []).length,
          inserted: (inserts ?? []).length,
          deleted: (deletes ?? []).length,
        });
      }

      // ---- 임포트 배치 ---------------------------------------
      case "import.create": {
        const ref = await db
          .collection(NEANDER_COL.finImports)
          .add(clean({ ...(payload as Record<string, unknown>), byEmail: user.email, createdAt: now }));
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "import.update": {
        const { id, patch } = payload as { id: string; patch: Record<string, unknown> };
        await db.collection(NEANDER_COL.finImports).doc(id).set(clean(patch ?? {}), { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "import.undo": {
        // 이 배치로 들어온 거래를 전부 지우고 이력도 삭제한다.
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const snap = await db
          .collection(NEANDER_COL.finTransactions)
          .where("importBatchId", "==", id)
          .get();
        const ids = snap.docs.map((d) => d.id);
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ids.slice(i, i + BATCH_LIMIT).forEach((tid) =>
            batch.delete(db.collection(NEANDER_COL.finTransactions).doc(tid)),
          );
          await batch.commit();
        }
        await db.collection(NEANDER_COL.finImports).doc(id).delete();
        return NextResponse.json({ ok: true, deleted: ids.length });
      }

      // ---- 마스터 --------------------------------------------
      case "master.seed": {
        // 적재 규칙은 server/seed.ts 한 곳에 있다 (CLI 스크립트와 공용)
        const r = await seedFinanceMasterData(db);
        return NextResponse.json({ ok: true, ...r });
      }

      case "vendorRule.upsert": {
        const { keyword, service, lookupKey } = payload as {
          keyword: string;
          service: string;
          lookupKey?: string;
        };
        if (!keyword || !service) {
          return NextResponse.json({ error: "keyword 와 service 가 필요합니다." }, { status: 400 });
        }
        await db
          .collection(NEANDER_COL.finVendorRules)
          .doc(safeId(keyword))
          .set(clean({ keyword, service, lookupKey }));
        return NextResponse.json({ ok: true });
      }

      // ---- 구독 마스터 ------------------------------------------
      case "subscription.upsert": {
        const input = payload as Record<string, unknown>;
        const service = String(input.service ?? "").trim();
        if (!service) {
          return NextResponse.json({ error: "service 가 필요합니다." }, { status: 400 });
        }
        // 문서 id 를 서비스명으로 두면 같은 이름이 두 번 생기지 않는다
        await db
          .collection(NEANDER_COL.finSubscriptions)
          .doc(safeId(service))
          .set(clean({ ...input, service }), { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "subscription.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finSubscriptions).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      // ---- 예산 ------------------------------------------------
      case "budget.save": {
        // 한 달치를 통째로 저장한다. 0 인 줄은 넣지 않아 문서가 커지지 않게 한다.
        const { month, lines, note } = payload as {
          month: string;
          lines: Record<string, number>;
          note?: string;
        };
        if (!/^\d{4}-\d{2}$/.test(month ?? "")) {
          return NextResponse.json({ error: "month 는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
        }
        const kept: Record<string, number> = {};
        Object.entries(lines ?? {}).forEach(([k, v]) => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n !== 0) kept[k] = n;
        });
        await db
          .collection(NEANDER_COL.finBudgets)
          .doc(month)
          .set(
            clean({ month, lines: kept, note, updatedAt: now, updatedBy: user.email }),
            // lines 는 통째로 갈아치운다 — merge 하면 지운 줄이 남는다
            { merge: false },
          );
        return NextResponse.json({ ok: true, saved: Object.keys(kept).length });
      }

      // ---- 법인카드 사용 메모 대조 ---------------------------------
      case "cardMemo.match": {
        // 서버에서 짝을 짓고 **확실한 것만** 거래에 싣는다. 클라이언트가
        // 짝을 계산해 보내면, 그 사이 다른 사람이 올린 명세서 때문에
        // 이미 남이 가져간 거래에 덮어쓸 수 있다.
        const memoSnap = await db.collection(NEANDER_COL.finCardMemos).get();
        const memos = memoSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinCardMemo[];
        const txSnap = await db.collection(NEANDER_COL.finTransactions).get();
        const txs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

        const result = matchMemos(memos, txs);
        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
        result.matched.forEach(({ memo, tx }) => {
          ops.push((b) =>
            b.set(
              db.collection(NEANDER_COL.finTransactions).doc(tx.id),
              {
                ...patchFromMemo(memo, tx),
                cardMemoId: memo.id,
                updatedAt: now,
                updatedBy: user.email,
                classReason: `법인카드 메모 대조 — ${memo.date} ${memo.note}`,
              },
              { merge: true },
            ),
          );
          ops.push((b) =>
            b.set(
              db.collection(NEANDER_COL.finCardMemos).doc(memo.id),
              { matchedTxId: tx.id, matchedAt: now },
              { merge: true },
            ),
          );
        });
        for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
          await batch.commit();
        }
        return NextResponse.json({
          ok: true,
          matched: result.matched.length,
          ambiguous: result.ambiguous.length,
          unmatched: result.unmatched.length,
        });
      }

      // ---- 월 마감 ----------------------------------------------
      case "close.set": {
        // 마감 시점의 숫자를 그대로 얼려 둔다. 이후 그 달의 거래가 바뀌면
        // 화면이 스냅샷과 현재를 비교해 차이를 드러낸다 (close.ts 주석 참고).
        // 스냅샷을 클라이언트가 계산해 보내는 게 마음에 걸릴 수 있지만,
        // 어차피 같은 데이터를 같은 함수(monthSnapshot)로 만든다. 서버에서
        // 다시 세려면 그 달 거래를 통째로 다시 읽어야 한다.
        const { month, snapshot, note } = payload as {
          month: string;
          snapshot: Record<string, number>;
          note?: string;
        };
        if (!/^\d{4}-\d{2}$/.test(month ?? "")) {
          return NextResponse.json({ error: "month 는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
        }
        const nums = ["count", "income", "expense", "refund", "net"] as const;
        const frozen: Record<string, number> = {};
        nums.forEach((k) => {
          const v = Number(snapshot?.[k]);
          frozen[k] = Number.isFinite(v) ? v : 0;
        });
        await db
          .collection(NEANDER_COL.finCloses)
          .doc(month)
          .set(
            clean({ month, snapshot: frozen, note, closedAt: now, closedBy: user.email }),
            { merge: false },
          );
        return NextResponse.json({ ok: true });
      }

      case "close.reopen": {
        const { month } = payload as { month: string };
        if (!month) return NextResponse.json({ error: "month 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finCloses).doc(month).delete();
        return NextResponse.json({ ok: true });
      }

      // ---- 배분 규칙 --------------------------------------------
      case "allocation.upsert": {
        const input = payload as Record<string, unknown>;
        const name = String(input.name ?? "").trim();
        if (!name) return NextResponse.json({ error: "name 이 필요합니다." }, { status: 400 });
        await db
          .collection(NEANDER_COL.finAllocations)
          .doc(safeId(name))
          .set(clean({ ...input, name }), { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "allocation.setActive": {
        const { id, active } = payload as { id: string; active: boolean };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db
          .collection(NEANDER_COL.finAllocations)
          .doc(id)
          .set({ active: Boolean(active) }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "allocation.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finAllocations).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      case "vendorRule.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finVendorRules).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    console.error("[finance/mutate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
