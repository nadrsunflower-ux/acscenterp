import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { LINE_HIDDEN_FIELDS, trimLine } from "@/lib/neander/sales/payload";
import { fillHidden, moveToTrash, readBases } from "@/lib/neander/server/trash";
import { seedSalesMasterData } from "@/lib/neander/sales/server/seed";
import { reattachEventLines } from "@/lib/neander/sales/server/attach";
import { FieldValue } from "firebase-admin/firestore";
import {
  coversDate,
  normalizeEvent,
  normalizeProduct,
  type SalesEvent,
  type SalesProduct,
} from "@/lib/neander/sales/types";

// 매출 모듈 쓰기 전체. 액션 하나로 모아둔 이유는 인증 게이트를 한 곳에서만
// 통과시키기 위해서다 — 라우트가 흩어지면 한 군데 빠뜨리기 쉽다
// (재무 mutate 라우트와 같은 구조).
export const dynamic = "force-dynamic";

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

/**
 * 쓴 판매 줄을 다시 읽어 돌려준다 — 화면이 전체(판매 줄 6천+ · 1.6MB)를 다시
 * 받지 않고 바뀐 줄만 바꿔 끼우게 한다 (SalesProvider.applyLines).
 */
async function readLines(db: FirebaseFirestore.Firestore, ids: string[]) {
  const col = db.collection(NEANDER_COL.salesLines);
  const out: Record<string, unknown>[] = [];
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 300) {
    const snaps = await db.getAll(...uniq.slice(i, i + 300).map((id) => col.doc(id)));
    snaps.forEach((snap) => {
      if (snap.exists) out.push(trimLine({ id: snap.id, ...snap.data() }));
    });
  }
  return out;
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
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
      // ---- 마스터 ---------------------------------------------
      case "master.seed": {
        const result = await seedSalesMasterData(db);
        return NextResponse.json({ ok: true, result });
      }

      case "product.upsert": {
        const { product } = payload as { product: SalesProduct };
        const id = String(product?.id ?? "").trim();
        if (!id) return NextResponse.json({ error: "상품코드가 필요합니다." }, { status: 400 });
        // 재료 줄이 있으면 재료비를 줄에서 다시 계산한다 (types.ts normalizeProduct)
        const saved = normalizeProduct({ ...product, id });
        await db
          .collection(NEANDER_COL.salesProducts)
          .doc(safeId(id))
          .set(
            clean({
              ...saved,
              // 줄을 모두 지우면 문서에서도 지운다 (merge 로는 안 지워진다).
              // ⚠️ **빈 배열을 보냈을 때만** 지운다. 검토 대기함의 「새 상품 만들기」나
              //    비서처럼 materialItems 를 모르는 호출이 저장하면서 사람이 적어 둔
              //    재료 줄을 조용히 날리면 안 된다 — 필드가 없으면 건드리지 않는다.
              materialItems:
                saved.materialItems ??
                (Array.isArray(product.materialItems) ? FieldValue.delete() : undefined),
              updatedAt: now,
              updatedBy: user.email,
            }),
            { merge: true },
          );
        return NextResponse.json({ ok: true, id, material: saved.material });
      }

      case "product.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.salesProducts).doc(safeId(id)).delete();
        return NextResponse.json({ ok: true });
      }

      case "assumptions.save": {
        const { assumptions } = payload as { assumptions: Record<string, unknown> };
        if (!assumptions) {
          return NextResponse.json({ error: "assumptions 가 필요합니다." }, { status: 400 });
        }
        await db
          .collection(NEANDER_COL.salesAssumptions)
          .doc("current")
          .set(
            clean({ ...assumptions, id: "current", updatedAt: now, updatedBy: user.email }),
            { merge: true },
          );
        return NextResponse.json({ ok: true });
      }

      // ---- 이벤트 ---------------------------------------------
      /**
       * 이벤트 저장 — 합계를 줄에서 다시 계산하고, 그 기간의 판매 줄을
       * 다시 붙인다 (server/attach.ts). 파일을 먼저 올리고 이벤트를 나중에
       * 적는 흐름이 이 한 줄에 달려 있다.
       */
      case "event.upsert": {
        const { event } = payload as { event: SalesEvent };
        const id = String(event?.id ?? "").trim();
        if (!id) return NextResponse.json({ error: "이벤트코드가 필요합니다." }, { status: 400 });
        if (!String(event.name ?? "").trim()) {
          return NextResponse.json({ error: "이벤트명이 필요합니다." }, { status: 400 });
        }
        if (!event.from || !event.to || event.to < event.from) {
          return NextResponse.json({ error: "기간(시작일 ≤ 종료일)이 필요합니다." }, { status: 400 });
        }
        const ref = db.collection(NEANDER_COL.salesEvents).doc(safeId(id));
        const before = await ref.get();
        const previous = before.exists ? ({ id: before.id, ...before.data() } as SalesEvent) : null;
        const saved = normalizeEvent({ ...event, id });
        // 줄이 비면 supplyItems·visits 필드를 문서에서도 지운다 (merge 로는 안 지워진다)
        await ref.set(
          clean({
            ...saved,
            supplyItems: saved.supplyItems ?? null,
            visits: saved.visits ?? null,
            buyers: saved.buyers ?? null,
            nonBuyers: saved.nonBuyers ?? null,
            wage: saved.wage ?? null,
            note: saved.note ?? null,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
            updatedBy: user.email,
          }),
          { merge: true },
        );
        const lines = await reattachEventLines(db, saved, previous, now);
        return NextResponse.json({ ok: true, id, lines });
      }

      case "event.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        // 이벤트를 지우면 귀속된 줄은 상시로 돌아간다 (줄 자체는 남긴다)
        const attached = await db
          .collection(NEANDER_COL.salesLines)
          .where("eventId", "==", id)
          .get();
        for (let i = 0; i < attached.docs.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          attached.docs.slice(i, i + BATCH_LIMIT).forEach((d) => {
            batch.set(d.ref, { eventId: null, updatedAt: now }, { merge: true });
          });
          await batch.commit();
        }
        await db.collection(NEANDER_COL.salesEvents).doc(safeId(id)).delete();
        return NextResponse.json({ ok: true, detached: attached.size });
      }

      // ---- 판매 줄 -------------------------------------------
      case "line.add": {
        const ref = await db
          .collection(NEANDER_COL.salesLines)
          .add(clean({ ...payload, createdAt: now, updatedBy: user.email }));
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "line.update": {
        const { id, patch } = payload as { id: string; patch: Record<string, unknown> };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const data: Record<string, unknown> = { updatedAt: now, updatedBy: user.email };
        Object.keys(patch ?? {}).forEach((k) => {
          // undefined·null 은 '필드 비우기' 의도
          data[k] = patch[k] === undefined || patch[k] === null ? null : patch[k];
        });
        // 상태가 확정되면 검토 이유는 남아 있을 이유가 없다. JSON 은
        // undefined 를 실어 보내지 못하므로 클라이언트에 맡기면 안 된다.
        if (data.status === "resolved" || data.status === "manual") data.reason = null;
        await db.collection(NEANDER_COL.salesLines).doc(id).set(data, { merge: true });
        return NextResponse.json({ ok: true, lines: await readLines(db, [id]) });
      }

      case "line.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        // 원본을 휴지통에 남긴다 — 되돌리기가 숨긴 필드(importId 등)를 되살린다
        await moveToTrash(db, NEANDER_COL.salesLines, NEANDER_COL.salesTrash, [id], user.email, now);
        return NextResponse.json({ ok: true });
      }

      /** 대기함에서 여러 줄을 같은 상품으로 한 번에 확정 */
      case "line.bulkResolve": {
        const { ids, productId, qty, discount } = payload as {
          ids: string[];
          productId: string;
          qty?: number;
          discount?: { list: number; rate: number };
        };
        if (discount && !(Number(discount.list) > 0 && Number(discount.rate) > 0 && Number(discount.rate) < 1)) {
          return NextResponse.json({ error: "할인은 정가 합계와 0~100% 사이 할인율이 필요합니다." }, { status: 400 });
        }
        if (!Array.isArray(ids) || ids.length === 0) {
          return NextResponse.json({ error: "ids 배열이 필요합니다." }, { status: 400 });
        }
        if (!productId) {
          return NextResponse.json({ error: "productId 가 필요합니다." }, { status: 400 });
        }
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ids.slice(i, i + BATCH_LIMIT).forEach((id) => {
            batch.set(
              db.collection(NEANDER_COL.salesLines).doc(id),
              clean({
                productId,
                qty: qty ?? 1,
                status: "resolved",
                reason: null,
                // 할인 없이 확정하면 예전 기록을 지운다 (같은 줄을 다시 확정할 때)
                discount: discount ? { list: Number(discount.list), rate: Number(discount.rate) } : null,
                updatedAt: now,
                updatedBy: user.email,
              }),
              { merge: true },
            );
          });
          await batch.commit();
        }
        return NextResponse.json({ ok: true, count: ids.length, lines: await readLines(db, ids) });
      }

      /**
       * 대기함 되돌리기 — 확정·직접입력·삭제 **직전의 줄 전체**를 그대로 되쓴다.
       * merge 가 아니라 통째로 덮어야 확정 때 붙은 productId·manualMaterial 이
       * 사라진다. 삭제된 줄도 같은 id 로 다시 생긴다.
       */
      case "line.restore": {
        // deleteIds — 처리 때 새로 생긴 줄(조합으로 나눈 나머지 상품). 되돌리면
        // 원래 결제 한 줄만 남아야 매출이 두 번 잡히지 않는다.
        const { lines, deleteIds } = payload as { lines: Record<string, unknown>[]; deleteIds?: string[] };
        if (!Array.isArray(lines) || lines.length === 0) {
          return NextResponse.json({ error: "lines 배열이 필요합니다." }, { status: 400 });
        }
        const col = db.collection(NEANDER_COL.salesLines);
        const trash = db.collection(NEANDER_COL.salesTrash);
        // 화면이 들고 있던 줄에는 숨긴 필드(importId 등)가 없다 — 지금 문서나
        // 휴지통 원본에서 채워야 되쓰면서 지워지지 않는다 (sales/payload.ts)
        const bases = await readBases(
          db,
          NEANDER_COL.salesLines,
          NEANDER_COL.salesTrash,
          lines.map((l) => String((l as { id?: string }).id ?? "")),
        );
        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
        lines.forEach((line) => {
          const { id, ...data } = line as { id?: string } & Record<string, unknown>;
          if (!id) return;
          const full = fillHidden(data, bases.get(String(id)), LINE_HIDDEN_FIELDS);
          ops.push((b) => b.set(col.doc(String(id)), clean({ ...full, updatedAt: now, updatedBy: user.email })));
          ops.push((b) => b.delete(trash.doc(String(id))));
        });
        (deleteIds ?? []).forEach((id) => {
          if (id) ops.push((b) => b.delete(col.doc(String(id))));
        });
        for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
          await batch.commit();
        }
        const restored = await readLines(
          db,
          lines.map((l) => String((l as { id?: string }).id ?? "")),
        );
        return NextResponse.json({
          ok: true,
          count: lines.length,
          deleted: (deleteIds ?? []).length,
          lines: restored,
        });
      }

      /**
       * 한 결제를 여러 상품으로 나눠 확정한다 — 「샤쉐 외 1건」 53,000 = 사쉐
       * 15,000 + 50ml 38,000. POS 가 첫 품목 이름과 합계만 주는 결제다.
       *
       * 원래 줄은 첫 상품이 되고, 나머지 상품은 **같은 결제에서 나온 새 줄**로
       * 붙는다 (splitFrom = 원래 줄 id). 적재 때 해석기가 나누는 방식과 같다.
       * 줄 금액의 합은 늘 원래 결제액과 같아야 한다 — 다르면 거절한다.
       * 이미 확정된 줄은 나누지 않는다 (두 번 나누면 매출이 불어난다).
       */
      case "line.split": {
        const { ids, parts } = payload as {
          ids: string[];
          parts: { productId: string; qty: number; amount: number }[];
        };
        if (!Array.isArray(ids) || ids.length === 0) {
          return NextResponse.json({ error: "ids 배열이 필요합니다." }, { status: 400 });
        }
        if (
          !Array.isArray(parts) ||
          parts.length === 0 ||
          parts.some((p) => !p.productId || !(p.qty > 0) || !(p.amount > 0))
        ) {
          return NextResponse.json({ error: "상품·수량·금액이 모두 있어야 합니다." }, { status: 400 });
        }
        const sum = parts.reduce((s2, p) => s2 + p.amount, 0);
        const col = db.collection(NEANDER_COL.salesLines);
        const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
        for (const snap of snaps) {
          const d = snap.data();
          if (!d) return NextResponse.json({ error: `줄 ${snap.id} 가 없습니다.` }, { status: 404 });
          if (d.status !== "needs_review") {
            return NextResponse.json({ error: "이미 처리된 줄이 섞여 있습니다. 새로고침 후 다시 해 주세요." }, { status: 409 });
          }
          if (Number(d.amount) !== sum) {
            return NextResponse.json(
              { error: `조합 합계 ${sum.toLocaleString("ko-KR")}원이 결제액 ${Number(d.amount).toLocaleString("ko-KR")}원과 다릅니다.` },
              { status: 400 },
            );
          }
        }
        const created: string[] = [];
        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
        snaps.forEach((snap) => {
          const d = snap.data()!;
          const base = clean({
            date: d.date,
            store: d.store,
            route: d.route,
            raw: d.raw,
            eventId: d.eventId,
            importId: d.importId,
            payMethod: d.payMethod,
            createdAt: d.createdAt,
          });
          parts.forEach((p, i) => {
            const data = {
              ...base,
              productId: p.productId,
              qty: p.qty,
              amount: p.amount,
              status: "resolved",
              updatedAt: now,
              updatedBy: user.email,
            };
            if (i === 0) {
              ops.push((b) => b.set(col.doc(snap.id), { ...data, reason: null }, { merge: true }));
            } else {
              const ref = col.doc();
              created.push(ref.id);
              ops.push((b) => b.set(ref, { ...data, splitFrom: snap.id }));
            }
          });
        });
        for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
          await batch.commit();
        }
        return NextResponse.json({
          ok: true,
          count: ids.length,
          created,
          lines: await readLines(db, [...ids, ...created]),
        });
      }

      /**
       * 이벤트 기간에 온 **일반 손님** — 이벤트 매출에서 떼어 상시 매출로 둔다.
       *
       * eventId 만 지우면 이벤트를 저장할 때(reattachEventLines) 날짜로 다시
       * 붙으므로 eventOptOut 표시를 남긴다. optOut=false 면 표시를 지우고
       * 날짜로 다시 붙인다 (그 기간에 이벤트가 없으면 상시 그대로).
       */
      case "line.setEventOptOut": {
        const { ids, optOut } = payload as { ids: string[]; optOut: boolean };
        if (!Array.isArray(ids) || ids.length === 0) {
          return NextResponse.json({ error: "ids 배열이 필요합니다." }, { status: 400 });
        }
        const col = db.collection(NEANDER_COL.salesLines);
        const patches: { id: string; data: Record<string, unknown> }[] = [];
        if (optOut) {
          ids.forEach((id) => patches.push({ id, data: { eventOptOut: true, eventId: null } }));
        } else {
          // 겹치는 기간이면 먼저 찾힌 것이 이긴다 — attach.ts 와 같은 순서(최근 시작순)
          const events = (await db.collection(NEANDER_COL.salesEvents).get()).docs
            .map((d) => ({ id: d.id, ...d.data() }) as SalesEvent)
            .sort((a, b) => String(b.from).localeCompare(String(a.from)));
          const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
          snaps.forEach((snap) => {
            const d = snap.data();
            if (!d) return;
            const match = events.find((e) => e.store === d.store && coversDate(e, String(d.date)));
            patches.push({ id: snap.id, data: { eventOptOut: null, eventId: match?.id ?? null } });
          });
        }
        for (let i = 0; i < patches.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          patches.slice(i, i + BATCH_LIMIT).forEach(({ id, data }) => {
            batch.set(col.doc(id), { ...data, updatedAt: now, updatedBy: user.email }, { merge: true });
          });
          await batch.commit();
        }
        return NextResponse.json({
          ok: true,
          count: patches.length,
          lines: await readLines(db, patches.map((x) => x.id)),
        });
      }

      // ---- 적재 ----------------------------------------------
      case "import.commit": {
        const { batch: meta, rows } = payload as {
          batch: Record<string, unknown>;
          rows: Record<string, unknown>[];
        };
        if (!Array.isArray(rows)) {
          return NextResponse.json({ error: "rows 배열이 필요합니다." }, { status: 400 });
        }
        const importRef = await db
          .collection(NEANDER_COL.salesImports)
          .add(clean({ ...meta, createdAt: now, createdBy: user.email }));

        let written = 0;
        for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
          const wb = db.batch();
          rows.slice(i, i + BATCH_LIMIT).forEach((r) => {
            wb.set(
              db.collection(NEANDER_COL.salesLines).doc(),
              clean({ ...r, importId: importRef.id, createdAt: now }),
            );
          });
          await wb.commit();
          written += Math.min(BATCH_LIMIT, rows.length - i);
        }
        return NextResponse.json({ ok: true, importId: importRef.id, written });
      }

      /** 되돌리기는 **그 파일만** 이어야 쓸모가 있다 */
      case "import.undo": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const snap = await db
          .collection(NEANDER_COL.salesLines)
          .where("importId", "==", id)
          .get();
        let removed = 0;
        for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
          const wb = db.batch();
          snap.docs.slice(i, i + BATCH_LIMIT).forEach((d) => wb.delete(d.ref));
          await wb.commit();
          removed += Math.min(BATCH_LIMIT, snap.docs.length - i);
        }
        await db
          .collection(NEANDER_COL.salesImports)
          .doc(id)
          .set({ undone: true, undoneAt: now, undoneBy: user.email }, { merge: true });
        return NextResponse.json({ ok: true, removed });
      }

      default:
        return NextResponse.json({ error: `알 수 없는 동작: ${action}` }, { status: 400 });
    }
  } catch (e) {
    console.error("[sales/mutate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
