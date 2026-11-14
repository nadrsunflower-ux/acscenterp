import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { saveBankSms, smsTokenOk } from "@/lib/neander/finance/server/bank-sms";
import { notifyNewSms } from "@/lib/neander/finance/server/sms-notify";
import { watchNewKeys } from "@/lib/neander/finance/server/key-watch";
import { ingestTaxText } from "@/lib/neander/finance/server/tax-notice";

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
//  받은 문자는 받은 편지함에 원문 그대로 남고(finance/server/bank-sms.ts), 거래 문자면
//    · ERP 에 있는 통장 · 카드의 것은 장부에 바로 한 줄 — 엑셀과 같은 자동분류, 잠정(smsOpen) 표시.
//      월말 엑셀이 짝을 맞추면 잠정이 빠진다 (finance/sms-ledger.ts · server/import-append.ts)
//    · 노션 「입출금알림」 · 「카드사용알림」에 한 줄 + @멘션 댓글(폰 알림) · ERP 확인 링크
//  (finance/server/sms-notify.ts). 노션이 실패해도 응답은 200 — 저장은 끝났고, 다음 문자 때 다시 보낸다.
//
//  은행 · 카드 문자가 아니면 세금 고지서인지 본다 (finance/tax-notice.ts) — 국세 · 지방세 전자고지
//  문자와 카카오톡 알림(매크로드로이드 「알림 받음」 → ?from=push:카카오톡, 본문 = 제목 + 내용).
//  고지서면 neander_fin_tax_notices 에 한 장 + 「돈 나가는 날」 줄 + 도착 멘션 (server/tax-notice.ts)
//  ⚠️ 열쇠가 새면 가짜 거래가 잠정으로 들어올 수 있다 — 월말 엑셀에 없으면 「문자에만 있음」으로 남는다.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  const notion = !r.duplicate && r.parsed.ok ? await notifyNewSms(db, r.id) : null;
  if (notion?.error) console.error("[finance/sms] 노션 알림", notion.error);
  // 은행 · 카드 문자가 아니면 — 세금 고지서인가 (문자 · 카톡 알림)
  const tax =
    !r.duplicate && !r.parsed.ok
      ? await ingestTaxText(db, {
          text,
          from,
          receivedAt,
          source: /[a-z가-힣]/i.test(from) ? "push" : "sms",
          sourceId: `sms:${r.id}`,
        }).catch((e) => {
          console.error("[finance/sms] 세금 고지서", e);
          return null;
        })
      : null;
  if (tax?.announce?.error) console.error("[finance/sms] 고지서 노션", tax.announce.error);
  // 예고 없이 생긴 오픈라우터 키 — cron 은 하루 한 번이라, 낮에 자주 오는 문자를 신호로 30분에 한 번까지 살핀다
  const keyWatch = await watchNewKeys(db, { source: "sms", minIntervalMs: 30 * 60_000 });
  if (keyWatch.failed?.length) console.error("[finance/sms] 키 알림", keyWatch.failed);
  return NextResponse.json({
    ok: true,
    id: r.id,
    duplicate: r.duplicate,
    read: r.parsed.ok,
    kind: r.parsed.kind ?? r.parsed.card?.approval ?? null,
    amount: r.parsed.amount ?? null,
    notion: notion?.state ?? notion?.skipped ?? null,
    tax: tax?.kind ? { kind: tax.kind, id: tax.id ?? tax.settled ?? null, created: tax.created ?? false, mention: tax.announce?.mention ?? null } : null,
  });
}
