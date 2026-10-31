import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { FIN_HIDDEN_FIELDS, preserveImportDedup, trimTransaction } from "@/lib/neander/finance/payload";
import { fillHidden, moveToTrash, readBases } from "@/lib/neander/server/trash";
import { seedFinanceMasterData } from "@/lib/neander/finance/server/seed";
import { matchMemos, patchFromMemo, type FinCardMemo } from "@/lib/neander/finance/card-memo";
import type { FinTransaction } from "@/lib/neander/finance/types";
import type { FinAccountDoc, FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import { normalizeClassRule, sameCondition, type FinClassRuleDoc } from "@/lib/neander/finance/class-rules";
import { isInstallmentReceived, sanitizeInstallment, sanitizeProject, type FinProjectDoc } from "@/lib/neander/finance/project";
import { sanitizeFinDoc, sanitizeFiles } from "@/lib/neander/finance/docs";
import { allocatedByTx, checkNewLinks, sanitizeSuspense, type FinSuspenseDoc } from "@/lib/neander/finance/suspense";
import { deleteFiles } from "@/lib/neander/server/storage";
import { sanitizeTrust, type FinTrustSettings } from "@/lib/neander/finance/trust";
import { readTrust, remeasureTrust, trustRef } from "@/lib/neander/finance/server/trust";
import { readForLog, writeLog } from "@/lib/neander/finance/server/tx-log";
import { splitVat } from "@/lib/neander/finance/project";
import { isCovered, receiptKey } from "@/lib/neander/finance/receivables";
import { netAmount } from "@/lib/neander/finance/types";

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

/**
 * 쓴 거래를 다시 읽어 돌려준다 — 화면이 전체(거래 1만+ · 7MB)를 다시 받지 않고
 * 바뀐 거래만 바꿔 끼우게 한다 (FinanceProvider.applyTransactions).
 */
async function readTransactions(db: FirebaseFirestore.Firestore, ids: string[]) {
  const col = db.collection(NEANDER_COL.finTransactions);
  const out: Record<string, unknown>[] = [];
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 300) {
    const snaps = await db.getAll(...uniq.slice(i, i + 300).map((id) => col.doc(id)));
    snaps.forEach((snap) => {
      if (snap.exists) out.push(trimTransaction({ id: snap.id, ...snap.data() }));
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
        const before = await readForLog(db, [id]);
        const protectedData = preserveImportDedup(data, before.get(id));
        await db.collection(NEANDER_COL.finTransactions).doc(id).set(protectedData, { merge: true });
        await writeLog(db, user.email, payload.via, [{ txId: id, kind: "edit", before: before.get(id), after: protectedData }]);
        return NextResponse.json({ ok: true, transactions: await readTransactions(db, [id]) });
      }

      case "ledgerColumn.upsert": {
        // 원장에 사람이 덧붙이는 열. 값은 거래 문서의 extra 에 들어가므로
        // 여기서는 이름과 자리만 기억한다.
        const { id, label, before } = payload as { id?: string; label?: string; before?: string };
        const name = String(label ?? "").trim();
        if (!name) return NextResponse.json({ error: "열 이름이 필요합니다." }, { status: 400 });
        const col = db.collection(NEANDER_COL.finLedgerColumns);
        const ref = id ? col.doc(id) : col.doc();
        await ref.set(
          {
            label: name.slice(0, 40),
            before: before ?? null,
            createdAt: id ? undefined : now,
            createdBy: id ? undefined : user.email,
            updatedAt: now,
            updatedBy: user.email,
          },
          { merge: true },
        );
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "ledgerColumn.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        // 거래에 남은 값은 지우지 않는다 — 열을 되살리면 그대로 다시 보인다
        await db.collection(NEANDER_COL.finLedgerColumns).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      case "anomalyIgnore.add": {
        // 형광펜 끄기 — 신뢰 거래처(영구) · 이 달 확인한 계정. 같은 대상은 같은 문서라
        // 여러 번 눌러도 하나만 남는다.
        const { kind, key, label, month } = payload as {
          kind?: string;
          key?: string;
          label?: string;
          month?: string;
        };
        const k = String(key ?? "").trim();
        if ((kind !== "vendor" && kind !== "account") || !k) {
          return NextResponse.json({ error: "끌 대상이 올바르지 않습니다." }, { status: 400 });
        }
        if (kind === "account" && !/^\d{4}-\d{2}$/.test(String(month ?? ""))) {
          return NextResponse.json({ error: "계정은 달(YYYY-MM)이 필요합니다." }, { status: 400 });
        }
        const id = safeId(kind === "vendor" ? `vendor:${k}` : `account:${month}:${k}`);
        await db
          .collection(NEANDER_COL.finAnomalyIgnores)
          .doc(id)
          .set(
            clean({
              kind,
              key: k.slice(0, 300),
              label: label ? String(label).slice(0, 120) : undefined,
              month: kind === "account" ? month : undefined,
              createdAt: now,
              createdBy: user.email,
            }),
          );
        return NextResponse.json({ ok: true, id });
      }

      case "anomalyIgnore.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finAnomalyIgnores).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      case "transaction.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        // 원본을 휴지통에 남긴다 — 되돌리기가 숨긴 필드(dedupHash 등)를 되살린다
        await moveToTrash(db, NEANDER_COL.finTransactions, NEANDER_COL.finTrash, [id], user.email, now);
        await writeLog(db, user.email, payload.via, [{ txId: id, kind: "delete" }]);
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
        const statusBefore = await readForLog(db, ids);
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
        await writeLog(db, user.email, payload.via, ids.map((id) => ({ txId: id, kind: "edit" as const, before: statusBefore.get(id), after: { status } })));
        return NextResponse.json({
          ok: true,
          updated: ids.length,
          transactions: await readTransactions(db, ids),
        });
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
        const patchBefore = await readForLog(db, ids);
        for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ids.slice(i, i + BATCH_LIMIT).forEach((id) => {
            batch.set(db.collection(NEANDER_COL.finTransactions).doc(id), preserveImportDedup(data, patchBefore.get(id)), { merge: true });
          });
          await batch.commit();
        }
        await writeLog(db, user.email, payload.via, ids.map((id) => ({ txId: id, kind: "edit" as const, before: patchBefore.get(id), after: preserveImportDedup(data, patchBefore.get(id)) })));
        return NextResponse.json({
          ok: true,
          updated: ids.length,
          transactions: await readTransactions(db, ids),
        });
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
        const editBefore = await readForLog(db, (updates ?? []).map((u) => u.id));
        const logItems: Parameters<typeof writeLog>[3] = [];
        (updates ?? []).forEach(({ id, patch }) => {
          if (!id) return;
          const data: Record<string, unknown> = { updatedAt: now, updatedBy: user.email };
          Object.keys(patch ?? {}).forEach((k) => {
            data[k] = patch[k] === undefined || patch[k] === null ? null : patch[k];
          });
          const protectedData = preserveImportDedup(data, editBefore.get(id));
          ops.push((b) => b.set(col.doc(id), protectedData, { merge: true }));
          logItems.push({ txId: id, kind: "edit", before: editBefore.get(id), after: protectedData });
        });
        const insertedIds: string[] = [];
        (inserts ?? []).forEach((r) => {
          const ref = col.doc();
          insertedIds.push(ref.id);
          ops.push((b) => b.set(ref, clean({ ...r, createdAt: now, updatedBy: user.email })));
        });
        // 지우는 거래는 원본을 휴지통에 남긴다 (server/trash.ts)
        const delIds = (deletes ?? []).filter(Boolean);
        if (delIds.length > 0) {
          const trash = db.collection(NEANDER_COL.finTrash);
          const delSnaps = await db.getAll(...delIds.map((id) => col.doc(id)));
          delSnaps.forEach((snap) => {
            if (!snap.exists) return;
            const doc = snap.data();
            ops.push((b) => b.set(trash.doc(snap.id), { doc, deletedAt: now, deletedBy: user.email ?? null }));
          });
        }
        delIds.forEach((id) => {
          ops.push((b) => b.delete(col.doc(id)));
        });
        for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
          await batch.commit();
        }
        insertedIds.forEach((id) => logItems.push({ txId: id, kind: "add" }));
        delIds.forEach((id) => logItems.push({ txId: id, kind: "delete" }));
        await writeLog(db, user.email, payload.via, logItems);
        return NextResponse.json({
          ok: true,
          updated: (updates ?? []).length,
          inserted: (inserts ?? []).length,
          deleted: (deletes ?? []).length,
          insertedIds,
          transactions: await readTransactions(db, [
            ...(updates ?? []).map((u) => u.id),
            ...insertedIds,
          ]),
        });
      }

      /**
       * 검토 대기함 되돌리기 — 처리 **직전의 거래 전체**를 그대로 되쓴다.
       * merge 가 아니라 통째로 덮어야 확정 때 채운 계정·사업구분이 사라진다.
       * 삭제한 거래도 같은 id 로 다시 생긴다. (매출 line.restore 와 같은 규칙)
       */
      case "transaction.restore": {
        const { rows } = payload as { rows: Record<string, unknown>[] };
        if (!Array.isArray(rows) || rows.length === 0) {
          return NextResponse.json({ error: "rows 배열이 필요합니다." }, { status: 400 });
        }
        const col = db.collection(NEANDER_COL.finTransactions);
        const trash = db.collection(NEANDER_COL.finTrash);
        // 화면이 들고 있던 거래에는 숨긴 필드(dedupHash·importBatchId 등)가 없다.
        // 지금 문서나 휴지통 원본에서 채워야 되쓰면서 지워지지 않는다 (finance/payload.ts).
        const bases = await readBases(
          db,
          NEANDER_COL.finTransactions,
          NEANDER_COL.finTrash,
          rows.map((r) => String((r as { id?: string }).id ?? "")),
        );
        const restoreBefore = await readForLog(db, rows.map((r) => String((r as { id?: string }).id ?? "")));
        // 한 줄에 쓰기 둘(되쓰기 + 휴지통 비우기) — 배치 상한 500 을 넘지 않게 200 씩
        for (let i = 0; i < rows.length; i += 200) {
          const batch = db.batch();
          rows.slice(i, i + 200).forEach((row) => {
            const { id, ...data } = row as { id?: string } & Record<string, unknown>;
            if (!id) return;
            const full = fillHidden(data, bases.get(String(id)), FIN_HIDDEN_FIELDS);
            batch.set(col.doc(String(id)), clean({ ...full, updatedAt: now, updatedBy: user.email }));
            batch.delete(trash.doc(String(id)));
          });
          await batch.commit();
        }
        await writeLog(
          db,
          user.email,
          payload.via ?? "undo",
          rows.map((r) => {
            const { id, ...data } = r as { id?: string } & Record<string, unknown>;
            const txId = String(id ?? "");
            // 지운 거래가 되살아났다 — 바뀐 칸이 아니라 「되살림」 한 줄
            if (!restoreBefore.has(txId)) return { txId, kind: "add" as const };
            return { txId, kind: "restore" as const, before: restoreBefore.get(txId), after: data };
          }),
        );
        return NextResponse.json({
          ok: true,
          restored: rows.length,
          transactions: await readTransactions(
            db,
            rows.map((r) => String((r as { id?: string }).id ?? "")),
          ),
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
        // 파일 갱신은 이 경로를 쓰지 않는다. 예전 화면의 「바꾸기」 요청이
        // 도착해도 거래를 삭제하지 않도록, 명시적 되돌리기만 허용한다.
        const { id, confirmDelete } = payload as { id: string; confirmDelete?: boolean };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const importRef = db.collection(NEANDER_COL.finImports).doc(id);
        const [snap, original] = await Promise.all([
          db.collection(NEANDER_COL.finTransactions).where("importBatchId", "==", id).get(),
          importRef.get(),
        ]);
        const ids = snap.docs.map((d) => d.id);
        if (ids.length > 0 && confirmDelete !== true) {
          return NextResponse.json({ error: "기존 거래를 삭제하지 않았습니다. 화면을 새로고침한 뒤 「파일 갱신」을 사용하세요. 실제 삭제는 「되돌리기」에서 확인한 경우에만 가능합니다." }, { status: 409 });
        }
        if (original.exists) await db.collection(NEANDER_COL.finTrash).doc(`import_${id}_${now}`).set({
          kind: "import", sourceCollection: NEANDER_COL.finImports, sourceId: id,
          doc: original.data(), deletedAt: now, deletedBy: user.email,
        });
        await moveToTrash(db, NEANDER_COL.finTransactions, NEANDER_COL.finTrash, ids, user.email, now);
        await writeLog(db, user.email, "import", ids.map((txId) => ({ txId, kind: "delete" as const })));
        await importRef.delete();
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

      // ---- 분류 규칙 (finance/class-rules.ts) --------------------
      /**
       * 규칙을 만들거나 고친다. 검사는 비서 도구가 쓰는 것과 **같은 함수**다 —
       * 화면이 보낸 값을 믿지 않고 계정·계좌를 마스터에서 다시 확인한다.
       * 조건이 같은 규칙이 이미 있으면 새로 만들지 않고 그것을 고친다.
       */
      case "classRule.upsert": {
        const { id, rule, source } = payload as { id?: string; rule?: Record<string, unknown>; source?: string };
        const [acctSnap, pmSnap, ruleSnap] = await Promise.all([
          db.collection(NEANDER_COL.finAccounts).get(),
          db.collection(NEANDER_COL.finPaymentMethods).get(),
          db.collection(NEANDER_COL.finClassRules).get(),
        ]);
        const checked = normalizeClassRule(rule ?? {}, {
          accounts: acctSnap.docs.map((d) => d.data()) as FinAccountDoc[],
          paymentMethods: pmSnap.docs.map((d) => d.data()) as FinPaymentMethodDoc[],
        });
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
        const existing = ruleSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FinClassRuleDoc);
        const target = (id && existing.find((r) => r.id === id)) || existing.find((r) => sameCondition(r, checked.rule));
        const col = db.collection(NEANDER_COL.finClassRules);
        if (target) {
          // set 으로 통째 바꾼다 — 조건을 지운 것(계좌·금액)이 옛 값으로 남으면 안 된다
          await col.doc(target.id).set({
            ...checked.rule,
            createdAt: target.createdAt ?? now,
            updatedAt: now,
            byEmail: user.email,
            source: target.source ?? (source === "assistant" ? "assistant" : "manual"),
          });
          return NextResponse.json({ ok: true, id: target.id, replaced: true });
        }
        const ref = await col.add({
          ...checked.rule,
          createdAt: now,
          byEmail: user.email,
          source: source === "assistant" ? "assistant" : "manual",
        });
        return NextResponse.json({ ok: true, id: ref.id, replaced: false });
      }

      case "trust.save": {
        // 믿을 범위 설정 (finance/trust.ts). 켜는데 잰 적이 없으면 먼저 잰다 —
        // 실측 없이 켜면 관문이 비어 아무 일도 안 한다.
        const { settings } = payload as { settings?: Record<string, unknown> };
        const next = sanitizeTrust(settings as Partial<FinTrustSettings>);
        const cur = await readTrust(db);
        if (next.enabled && !cur?.measure) await remeasureTrust(db);
        await trustRef(db).set({ ...next, updatedAt: now, updatedBy: user.email }, { merge: true });
        return NextResponse.json({ ok: true, trust: await readTrust(db) });
      }

      case "trust.measure": {
        const measure = await remeasureTrust(db);
        return NextResponse.json({ ok: true, measure });
      }

      case "classRule.setActive": {
        const { id, active } = payload as { id: string; active: boolean };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db
          .collection(NEANDER_COL.finClassRules)
          .doc(id)
          .set({ active: !!active, updatedAt: now, byEmail: user.email }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "classRule.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finClassRules).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      // ---- 구독 마스터 ------------------------------------------
      /** 계좌·카드 마스터의 은행·월별 적재 대상 — null 이면 필드를 비운다(기본 규칙으로) */
      case "paymentMethod.update": {
        const { id, patch } = payload as { id: string; patch: Record<string, unknown> };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const data: Record<string, unknown> = {};
        if ("bank" in (patch ?? {})) data.bank = patch.bank ?? null;
        if ("monthly" in (patch ?? {})) data.monthly = patch.monthly ?? null;
        if (Object.keys(data).length === 0) {
          return NextResponse.json({ error: "고칠 값이 없습니다." }, { status: 400 });
        }
        await db.collection(NEANDER_COL.finPaymentMethods).doc(safeId(id)).set(data, { merge: true });
        return NextResponse.json({ ok: true });
      }

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

      // ---- 가수금 기록장 ------------------------------------------
      case "suspense.save": {
        // 건을 통째로 갈아치운다 (프로젝트와 같은 방식) — 줄 배열을 merge 하면 지운 줄이 되살아난다.
        const { id, item } = payload as { id?: string; item: Record<string, unknown> };
        const parsed = sanitizeSuspense(item ?? {});
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        const col = db.collection(NEANDER_COL.finSuspense);

        // 한 거래를 두 건이 겹쳐 붙이면 잔액이 조용히 두 번 줄어든다 — 화면이 들고 있는
        // 목록은 낡았을 수 있으니 저장 직전에 서버가 다시 센다.
        const linkedIds = [...allocatedByTx([parsed.value]).keys()];
        const ref = id ? col.doc(id) : col.doc();
        const result = await db.runTransaction(async (tr) => {
          const all = (await tr.get(col)).docs.map((d) => ({ id: d.id, ...d.data() }) as FinSuspenseDoc);
          const prev = id ? (all.find((x) => x.id === id) ?? null) : null;
          if (id && !prev) return { error: "그 건이 없습니다.", status: 404 };
          const txSnaps = linkedIds.length ? await tr.getAll(...linkedIds.map((key) => db.collection(NEANDER_COL.finTransactions).doc(key))) : [];
          const txs = txSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }) as FinTransaction);
          const problem = checkNewLinks(parsed.value, prev, new Map(txs.map((t) => [t.id, t])), allocatedByTx(all.filter((x) => x.id !== id)));
          if (problem) return { error: problem, status: 409 };
          const prevRaw = prev as (FinSuspenseDoc & { createdBy?: string }) | null;
          tr.set(ref, clean({
            ...parsed.value,
            createdAt: prevRaw?.createdAt ?? now,
            createdBy: prevRaw ? prevRaw.createdBy : user.email,
            updatedAt: now,
            updatedBy: user.email,
          }), { merge: false });
          return { ok: true };
        });
        if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "suspense.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        // 손으로 적은 기록이라 다시 만들 수 없다 — 원본을 휴지통에 남기고 지운다
        await moveToTrash(db, NEANDER_COL.finSuspense, NEANDER_COL.finTrash, [id], user.email, now);
        return NextResponse.json({ ok: true });
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

      // ---- 프로젝트 손익 ----------------------------------------
      case "project.markReceived": {
        // 입금 하나를 프로젝트 입금 회차에 짝짓는다 (finance/receivables.ts).
        //   · 입금 거래에 회차 열쇠(receiptOf)와 프로젝트 코드를 남긴다
        //   · 짝지은 입금이 받을 돈(부가세 포함)을 다 채우면 회차를 「받음」 으로 — 입금일은
        //     짝지은 입금 중 마지막 날. 부분 입금이면 회차는 그대로 두고 남은 돈만 줄어든다
        // 프로젝트 문서를 통째로 보내지 않고 서버가 지금 문서를 읽어 그 회차만 바꾼다 (setDue 와 같다).
        const { projectId, installmentIds, txId } = payload as {
          projectId?: string;
          installmentIds?: string[];
          txId?: string;
        };
        const ids = (Array.isArray(installmentIds) ? installmentIds : []).filter((x) => typeof x === "string" && x);
        if (!projectId || !txId || ids.length === 0) {
          return NextResponse.json({ error: "projectId · installmentIds · txId 가 필요합니다." }, { status: 400 });
        }
        const pref = db.collection(NEANDER_COL.finProjects).doc(projectId);
        const tref = db.collection(NEANDER_COL.finTransactions).doc(txId);
        const keys = ids.map((id) => receiptKey(projectId, id));
        const logBefore = await readForLog(db, [txId]);
        const out = await db.runTransaction(async (trx) => {
          const [ps, ts, others] = await Promise.all([
            trx.get(pref),
            trx.get(tref),
            trx.get(db.collection(NEANDER_COL.finTransactions).where("receiptOf", "array-contains-any", keys)),
          ]);
          if (!ps.exists) return { error: "프로젝트가 없습니다.", status: 404 };
          if (!ts.exists) return { error: "입금 거래가 없습니다.", status: 404 };
          const p = ps.data() as FinProjectDoc;
          const t = ts.data() as FinTransaction;
          if (t.txType !== "수입") return { error: "들어온 돈(수입)만 짝지을 수 있습니다.", status: 400 };
          if ((t.receiptOf ?? []).length > 0) return { error: "이미 다른 회차에 짝지은 입금입니다.", status: 409 };
          const list = [...(p.installments ?? [])];
          const base = p.vatMode ?? "excluded";
          const covered: string[] = [];
          for (const id of ids) {
            const k = list.findIndex((i) => i.id === id);
            if (k < 0) return { error: "그 입금 회차가 없습니다 — 프로젝트를 다시 열어 보세요.", status: 404 };
            if (isInstallmentReceived(list[k])) return { error: `${list[k].kind} 회차는 이미 받았습니다.`, status: 409 };
            const key = receiptKey(projectId, id);
            // 이 회차에 앞서 짝지은 입금 (합산 입금이면 회차 수로 나눠 본다)
            const prior = others.docs
              .map((d) => d.data() as FinTransaction)
              .filter((x) => (x.receiptOf ?? []).includes(key));
            const share = (x: FinTransaction) => netAmount(x) / Math.max(1, (x.receiptOf ?? []).length);
            const received = prior.reduce((n, x) => n + share(x), 0) + netAmount(t) / ids.length;
            const due = splitVat(Math.round(Number(list[k].amount) || 0), base).total;
            if (ids.length > 1 || isCovered(due, received)) {
              const last = [t.date, ...prior.map((x) => x.date)].sort().pop();
              list[k] = sanitizeInstallment({ ...list[k], received: true, paidDate: last, paidApprox: undefined } as never);
              covered.push(id);
            }
          }
          trx.update(tref, {
            receiptOf: keys,
            ...(t.projectCode ? {} : { projectCode: p.code }),
            updatedAt: now,
            updatedBy: user.email,
          });
          if (covered.length > 0) {
            trx.update(pref, {
              installments: list.map((i) => clean(i as unknown as Record<string, unknown>)),
              updatedAt: now,
              updatedBy: user.email,
            });
          }
          return { ok: true as const, covered, code: p.code };
        });
        if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
        await writeLog(db, user.email, "receipt", [
          { txId, kind: "edit", before: logBefore.get(txId), after: { projectCode: logBefore.get(txId)?.projectCode || out.code } },
        ]);
        return NextResponse.json({ ...out, transactions: await readTransactions(db, [txId]) });
      }

      case "project.unmatchReceipt": {
        // 짝짓기를 푼다. 그 입금 날짜로 「받음」 이 된 회차는 남은 돈이 다시 생기면 되돌린다 —
        // 사람이 따로 적은 입금일(다른 날짜)은 건드리지 않는다.
        const { txId } = payload as { txId?: string };
        if (!txId) return NextResponse.json({ error: "txId 가 필요합니다." }, { status: 400 });
        const tref = db.collection(NEANDER_COL.finTransactions).doc(txId);
        const out = await db.runTransaction(async (trx) => {
          const ts = await trx.get(tref);
          if (!ts.exists) return { error: "입금 거래가 없습니다.", status: 404 };
          const t = ts.data() as FinTransaction;
          const keys = t.receiptOf ?? [];
          if (keys.length === 0) return { ok: true as const, reopened: [] as string[] };
          const projectIds = [...new Set(keys.map((k) => k.split(":")[0]))];
          const [projects, others] = await Promise.all([
            Promise.all(projectIds.map((id) => trx.get(db.collection(NEANDER_COL.finProjects).doc(id)))),
            trx.get(db.collection(NEANDER_COL.finTransactions).where("receiptOf", "array-contains-any", keys.slice(0, 30))),
          ]);
          const reopened: string[] = [];
          projects.forEach((ps) => {
            if (!ps.exists) return;
            const p = ps.data() as FinProjectDoc;
            const base = p.vatMode ?? "excluded";
            let changed = false;
            const list = (p.installments ?? []).map((i) => {
              const key = receiptKey(ps.id, i.id);
              if (!keys.includes(key) || !isInstallmentReceived(i) || i.paidDate !== t.date) return i;
              const rest = others.docs
                .filter((d) => d.id !== txId)
                .map((d) => d.data() as FinTransaction)
                .filter((x) => (x.receiptOf ?? []).includes(key))
                .reduce((n, x) => n + netAmount(x) / Math.max(1, (x.receiptOf ?? []).length), 0);
              if (isCovered(splitVat(Math.round(Number(i.amount) || 0), base).total, rest)) return i;
              changed = true;
              reopened.push(i.id);
              return sanitizeInstallment({ ...i, received: false, paidDate: undefined, paidApprox: undefined } as never);
            });
            if (changed) {
              trx.update(ps.ref, {
                installments: list.map((i) => clean(i as unknown as Record<string, unknown>)),
                updatedAt: now,
                updatedBy: user.email,
              });
            }
          });
          trx.update(tref, { receiptOf: null, updatedAt: now, updatedBy: user.email });
          return { ok: true as const, reopened };
        });
        if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
        return NextResponse.json({ ...out, transactions: await readTransactions(db, [txId]) });
      }

      case "project.setDue": {
        // 받을 시기 하나만 고친다 — 런웨이 「받을 돈」 에서 「10월 말」 처럼 적을 때.
        // 프로젝트 문서를 통째로 보내면 그 사이 프로젝트 화면에서 고친 줄을 덮으므로,
        // 서버가 지금 문서를 읽어 그 회차만 바꾼다. 회차가 하나도 없는 계약이면
        // 계약금액 전부를 한 번에 받는 「잔금」 회차를 만든다.
        const { id, installmentId, dueDate, dueApprox } = payload as {
          id?: string;
          installmentId?: string;
          dueDate?: string;
          dueApprox?: string;
        };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const due = sanitizeInstallment({ dueDate, dueApprox: dueApprox as never });
        if (!due.dueDate) return NextResponse.json({ error: "받을 날(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
        const ref = db.collection(NEANDER_COL.finProjects).doc(id);
        const out = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { error: "프로젝트가 없습니다.", status: 404 };
          const doc = snap.data() as FinProjectDoc;
          const list = [...(doc.installments ?? [])];
          let created = false;
          if (installmentId) {
            const k = list.findIndex((i) => i.id === installmentId);
            if (k < 0) return { error: "그 입금 회차가 없습니다 — 프로젝트를 다시 열어 보세요.", status: 404 };
            if (isInstallmentReceived(list[k])) return { error: "이미 받은 회차입니다.", status: 409 };
            // 받을 날만 바꾼다 — 받음 표시 · 대략 입금일 등 나머지 칸은 그대로 실린다
            list[k] = sanitizeInstallment({ ...list[k], dueDate: due.dueDate, dueApprox: due.dueApprox });
          } else {
            if (list.length > 0) {
              return { error: "이 프로젝트는 이미 입금 회차가 있습니다 — 회차에서 고르세요.", status: 409 };
            }
            const contract = Math.round(Number(doc.contractAmount) || 0);
            if (contract <= 0) return { error: "계약금액이 없어 회차를 만들 수 없습니다.", status: 400 };
            list.push(
              sanitizeInstallment({
                kind: "잔금",
                amount: contract,
                dueDate: due.dueDate,
                dueApprox: due.dueApprox,
                note: "런웨이에서 받을 시기를 적으며 만든 회차",
              }),
            );
            created = true;
          }
          tx.update(ref, {
            installments: list.map((i) => clean(i as unknown as Record<string, unknown>)),
            updatedAt: now,
            updatedBy: user.email,
          });
          return { ok: true as const, created };
        });
        if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
        return NextResponse.json(out);
      }

      case "project.save": {
        // 문서를 통째로 갈아치운다 (예산과 같은 방식). 줄 배열을 merge 하면
        // 지운 줄이 되살아난다. id 가 없으면 새로 만든다.
        const { id, project } = payload as { id?: string; project: Record<string, unknown> };
        const parsed = sanitizeProject(project ?? {});
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        const col = db.collection(NEANDER_COL.finProjects);

        // 코드는 원장과 잇는 열쇠라 프로젝트 사이에서 유일해야 한다.
        // 대소문자만 다른 코드도 같은 것으로 본다 (원장 매칭이 그렇게 한다).
        const wanted = parsed.value.code.toLowerCase();
        const all = await col.get();
        const clash = all.docs.find(
          (d) => d.id !== id && String(d.data().code ?? "").trim().toLowerCase() === wanted,
        );
        if (clash) {
          return NextResponse.json(
            { error: `코드 ${parsed.value.code} 는 이미 「${clash.data().name}」 이 쓰고 있습니다.` },
            { status: 409 },
          );
        }

        if (id) {
          const prev = await col.doc(id).get();
          if (!prev.exists) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
          const keep = prev.data() ?? {};
          await col.doc(id).set(
            clean({
              ...parsed.value,
              createdAt: keep.createdAt ?? now,
              createdBy: keep.createdBy,
              updatedAt: now,
              updatedBy: user.email,
            }),
            { merge: false },
          );
          return NextResponse.json({ ok: true, id });
        }
        const ref = await col.add(
          clean({ ...parsed.value, createdAt: now, createdBy: user.email, updatedAt: now, updatedBy: user.email }),
        );
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "project.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        await db.collection(NEANDER_COL.finProjects).doc(id).delete();
        return NextResponse.json({ ok: true });
      }

      // ---- 프로젝트 문서 (견적서·계약서) ---------------------------
      case "doc.save": {
        // 프로젝트와 같은 통째 저장. 단 `files` 는 클라이언트가 보내는 값을
        // 무시하고 저장돼 있던 것을 지킨다 — 파일은 파일 라우트가 붙이고
        // 떼며, 화면의 낡은 목록으로 덮어쓰면 방금 올린 파일이 사라진다.
        const { id, doc } = payload as { id?: string; doc: Record<string, unknown> };
        const parsed = sanitizeFinDoc((doc ?? {}) as Parameters<typeof sanitizeFinDoc>[0]);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        const projectRef = db.collection(NEANDER_COL.finProjects).doc(parsed.value.projectId);
        if (!(await projectRef.get()).exists) {
          return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
        }
        const col = db.collection(NEANDER_COL.finDocs);
        if (id) {
          const prev = await col.doc(id).get();
          if (!prev.exists) return NextResponse.json({ error: "문서가 없습니다." }, { status: 404 });
          const keep = prev.data() ?? {};
          await col.doc(id).set(
            clean({
              ...parsed.value,
              files: sanitizeFiles(keep.files),
              createdAt: keep.createdAt ?? now,
              createdBy: keep.createdBy,
              updatedAt: now,
              updatedBy: user.email,
            }),
            { merge: false },
          );
          return NextResponse.json({ ok: true, id });
        }
        const ref = await col.add(
          clean({
            ...parsed.value,
            files: [],
            createdAt: now,
            createdBy: user.email,
            updatedAt: now,
            updatedBy: user.email,
          }),
        );
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "doc.delete": {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
        const ref = db.collection(NEANDER_COL.finDocs).doc(id);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ ok: true });
        const paths = sanitizeFiles(snap.data()?.files).map((f) => f.path);
        if (paths.length) await deleteFiles(paths);
        await ref.delete();
        return NextResponse.json({ ok: true });
      }

      case "doc.removeFile": {
        const { id, path } = payload as { id: string; path: string };
        if (!id || !path) return NextResponse.json({ error: "id 와 path 가 필요합니다." }, { status: 400 });
        const ref = db.collection(NEANDER_COL.finDocs).doc(id);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ error: "문서가 없습니다." }, { status: 404 });
        const files = sanitizeFiles(snap.data()?.files);
        if (!files.some((f) => f.path === path)) {
          return NextResponse.json({ error: "그 문서에 붙은 파일이 아닙니다." }, { status: 404 });
        }
        // 문서를 먼저 고치고 Storage 는 그다음 — 지우기가 반쯤 실패해도
        // 목록에서 사라진 파일이 되살아나는 것보다 고아 파일이 낫다
        const kept = files.filter((f) => f.path !== path);
        await ref.set({ files: kept, updatedAt: now, updatedBy: user.email }, { merge: true });
        await deleteFiles([path]);
        return NextResponse.json({ ok: true, files: kept });
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
