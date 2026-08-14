import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/finance/server/admin";
import { requireFinanceUser, accessErrorResponse } from "@/lib/neander/finance/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  FIN_ACCOUNTS,
  FIN_PAYMENT_METHODS,
  FIN_VENDOR_RULES,
} from "@/lib/neander/finance/master-data";

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
        const writeAll = async <T>(col: string, rows: readonly T[], idOf: (r: T) => string) => {
          for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
            const batch = db.batch();
            rows.slice(i, i + BATCH_LIMIT).forEach((r) => {
              batch.set(
                db.collection(col).doc(safeId(idOf(r))),
                clean(r as Record<string, unknown>),
              );
            });
            await batch.commit();
          }
        };
        await writeAll(NEANDER_COL.finAccounts, FIN_ACCOUNTS, (a) => a.lookupKey);
        await writeAll(NEANDER_COL.finPaymentMethods, FIN_PAYMENT_METHODS, (p) => p.last4);
        await writeAll(NEANDER_COL.finVendorRules, FIN_VENDOR_RULES, (v) => v.keyword);
        return NextResponse.json({
          ok: true,
          accounts: FIN_ACCOUNTS.length,
          paymentMethods: FIN_PAYMENT_METHODS.length,
          vendorRules: FIN_VENDOR_RULES.length,
        });
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
