import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { sanitizeNoticePatch, type TaxNotice } from "@/lib/neander/finance/tax-notice";
import { announceTaxNotice, saveTaxNotice } from "@/lib/neander/finance/server/tax-notice";

// ============================================================
//  세금 고지서 — ERP 화면(/neander/tax · /neander/tax/[id])이 부른다
// ------------------------------------------------------------
//  GET            최근 고지서 목록 (열린 것 먼저, 납기 순)
//  GET ?id=       한 장 (원문 포함)
//  POST           사람이 넣는 고지서 { level, item, site, amount, dueDate, … }
//  PATCH ?id=     고치기 · 냈음 · 무시 — 고친 뒤 「돈 나가는 날」 줄도 바로 맞춘다
//  알림 문구에서 못 읽은 금액 · 납기를 여기서 채운다. 원문(raw)은 고치지 않는다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const col = () => adminDb().collection(NEANDER_COL.finTaxNotices);
const pub = (id: string, d: Record<string, unknown>, withRaw: boolean) => {
  const { raw, ...rest } = d as TaxNotice & Record<string, unknown>;
  return { ...rest, id, ...(withRaw && raw ? { raw } : {}) };
};

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!/^[\w-]{1,40}$/.test(id)) return NextResponse.json({ error: "고지서 id 가 올바르지 않습니다." }, { status: 400 });
      const snap = await col().doc(id).get();
      if (!snap.exists) return NextResponse.json({ error: "고지서가 없습니다." }, { status: 404 });
      return NextResponse.json({ notice: pub(snap.id, snap.data()!, true) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const since = Date.now() - 400 * 86_400_000;
    const snap = await col().where("receivedAt", ">=", since).get();
    const order = { open: 0, paid: 1, dismissed: 2 } as const;
    const notices = snap.docs
      .map((d) => pub(d.id, d.data(), false) as TaxNotice)
      .sort((a, b) => order[a.state] - order[b.state] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || b.receivedAt - a.receivedAt);
    return NextResponse.json({ notices }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/tax-notices GET]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireErpUser(req);
    const body = sanitizeNoticePatch(await req.json().catch(() => ({})));
    if (!body.dueDate && !body.amount) return NextResponse.json({ error: "납기나 금액 가운데 하나는 넣어 주세요." }, { status: 400 });
    const defined = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));
    const { id } = await saveTaxNotice(adminDb(), {
      ...(defined as Partial<TaxNotice>),
      source: "manual",
      receivedAt: Date.now(),
      updatedBy: user.email,
    });
    const notion = await announceTaxNotice(adminDb(), id, { mention: false });
    return NextResponse.json({ id, notion });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/tax-notices POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[\w-]{1,40}$/.test(id)) return NextResponse.json({ error: "고지서 id 가 올바르지 않습니다." }, { status: 400 });
    const ref = col().doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "고지서가 없습니다." }, { status: 404 });
    const patch = sanitizeNoticePatch(await req.json().catch(() => ({})));
    if (!Object.keys(patch).length) return NextResponse.json({ error: "고칠 칸이 없습니다." }, { status: 400 });
    const { FieldValue } = await import("firebase-admin/firestore");
    const write: Record<string, unknown> = { updatedAt: Date.now(), updatedBy: user.email };
    for (const [k, v] of Object.entries(patch)) write[k] = v === null ? FieldValue.delete() : v;
    // 냈음인데 낸 날을 안 적었으면 오늘
    if (patch.state === "paid" && !patch.paidDate && !snap.get("paidDate")) write.paidDate = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    await ref.update(write);
    const notion = await announceTaxNotice(adminDb(), id, { mention: false });
    const fresh = await ref.get();
    return NextResponse.json({ notice: pub(fresh.id, fresh.data()!, true), notion });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/tax-notices PATCH]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
