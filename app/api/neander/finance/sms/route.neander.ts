import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { saveBankSms, smsTokenOk } from "@/lib/neander/finance/server/bank-sms";

// ============================================================
//  은행 입출금 문자 받기 — 회사 전용폰(매크로드로이드)이 부른다
// ------------------------------------------------------------
//  POST /api/neander/finance/sms?from=<보낸 번호>
//    Authorization: Bearer <열쇠>
//    본문: 문자 원문 그대로 (Content-Type: text/plain)
//          또는 JSON { from, text, receivedAt } · 폼 from=…&text=…
//
//  원문에 따옴표 · 줄바꿈이 섞여도 깨지지 않게 text/plain 을 기본으로 둔다
//  (매크로드로이드의 [sms_message] 를 본문에 그대로 넣으면 된다).
//
//  ⚠️ 이 문으로 들어온 값은 **장부에 들어가지 않는다** — 받은 편지함에만 쌓인다
//     (finance/server/bank-sms.ts). 열쇠가 새도 장부를 고칠 수 없다.
// ============================================================

export const dynamic = "force-dynamic";

const bearer = (req: Request) => {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

export async function POST(req: Request) {
  const db = adminDb();
  if (!(await smsTokenOk(db, bearer(req)))) {
    return NextResponse.json({ error: "열쇠가 올바르지 않습니다." }, { status: 401 });
  }
  const url = new URL(req.url);
  const type = req.headers.get("content-type") ?? "";
  let from = url.searchParams.get("from") ?? "";
  let text = "";
  let receivedAt: number | undefined;
  try {
    if (type.includes("application/json")) {
      const j = (await req.json()) as { from?: unknown; text?: unknown; body?: unknown; receivedAt?: unknown };
      from = String(j.from ?? from);
      text = String(j.text ?? j.body ?? "");
      receivedAt = Number(j.receivedAt) || undefined;
    } else if (type.includes("application/x-www-form-urlencoded")) {
      const f = new URLSearchParams(await req.text());
      from = f.get("from") ?? from;
      text = f.get("text") ?? f.get("body") ?? "";
      receivedAt = Number(f.get("receivedAt")) || undefined;
    } else {
      text = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다." }, { status: 400 });
  }
  const at = Number(url.searchParams.get("at"));
  if (!receivedAt && at > 0) receivedAt = at < 1e12 ? at * 1000 : at;

  const r = await saveBankSms(db, { from, text, receivedAt });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id, duplicate: r.duplicate, read: r.parsed.ok, kind: r.parsed.kind ?? null, amount: r.parsed.amount ?? null });
}
