import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { accessErrorResponse, requireErpUser } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import { classCandidates } from "@/lib/neander/finance/classify";
import { trimTransaction } from "@/lib/neander/finance/payload";
import { installmentSplit, isInstallmentReceived } from "@/lib/neander/finance/project";
import { projectCandidates } from "@/lib/neander/finance/sms-classify";
import { netAmount, type FinTransaction, type TxType } from "@/lib/neander/finance/types";
import { classifyData } from "@/lib/neander/finance/server/classify-context";
import type { TxCardData } from "@/lib/neander/finance/tx-card";

// ============================================================
//  거래 한 건 확인 카드 — 폰 화면(/neander/tx/[id])이 부른다
// ------------------------------------------------------------
//  노션 「입출금알림」 · 「카드사용알림」 댓글의 링크로 들어온다. 재무 화면처럼 장부 전체를
//  받지 않고 이 거래와 고를 것만 준다 — 그래서 폰에서 바로 열린다.
//    · 계정 후보: 이 거래처가 과거에 쓰인 분류 (classCandidates — 검토 대기함과 같은 이력)
//    · 받을 돈: 입금이면 금액(청구액)이 같은 안 받은 회차 + 나머지 안 받은 회차
//    · 프로젝트: 그날 진행 중인 것이 먼저 (지출을 프로젝트 원가로 붙일 때)
//    · 다음 확인: 문자로 들어와 아직 확정 안 한 거래
//  고치는 것은 기존 재무 쓰기(mutate)로 한다 — transaction.update · project.markReceived.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export async function GET(req: Request) {
  try {
    await requireErpUser(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[\w¦-]{1,80}$/.test(id)) return NextResponse.json({ error: "거래 id 가 올바르지 않습니다." }, { status: 400 });
    const db = adminDb();
    const [snap, pmSnap, openSnap] = await Promise.all([
      db.collection(NEANDER_COL.finTransactions).doc(id).get(),
      db.collection(NEANDER_COL.finPaymentMethods).get(),
      db.collection(NEANDER_COL.finTransactions).where("smsOpen", "==", true).get(),
    ]);
    if (!snap.exists) return NextResponse.json({ error: "거래가 없습니다 — 지워졌거나 합쳐졌을 수 있습니다." }, { status: 404 });
    const tx = { id: snap.id, ...snap.data() } as FinTransaction;
    const pms = pmSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as { id: string; last4: string; alias?: string; kind?: string }[];
    const pm = pms.find((p) => p.last4 === tx.last4);
    const data = await classifyData(db);

    const cand = classCandidates({ vendor: tx.vendor, last4: tx.last4, txType: tx.txType }, data.engine);
    const income = tx.txType === "수입";
    const live = data.projects.filter((p) => p.status !== "cancelled");
    const receipts = income && !(tx.receiptOf ?? []).length ? projectCandidates({ amount: netAmount(tx), party: tx.vendor }, live) : [];
    const openInstallments = income
      ? live
          .flatMap((p) =>
            (p.installments ?? [])
              .filter((i) => !isInstallmentReceived(i))
              .map((i) => ({
                projectId: p.id,
                installmentId: i.id,
                code: p.code,
                name: p.name,
                kind: i.kind,
                billed: installmentSplit(i, p.vatMode).total,
                ...(i.dueDate ? { dueDate: i.dueDate } : {}),
              })),
          )
          .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
      : [];
    const projects = live
      .filter((p) => p.status !== "done" || !p.endDate || daysBetween(p.endDate, tx.date) <= 45)
      .map((p) => {
        const covers = (!p.startDate || p.startDate <= tx.date) && (!p.endDate || tx.date <= p.endDate);
        const near = Math.min(...[p.startDate, p.endDate, p.deliveryDate].filter((d): d is string => !!d).map((d) => daysBetween(d, tx.date)), 999);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          ...(p.client ? { client: p.client } : {}),
          status: p.status,
          ...(p.startDate ? { startDate: p.startDate } : {}),
          ...(p.endDate ? { endDate: p.endDate } : {}),
          ...(p.bizMinor ? { bizMinor: p.bizMinor, bizMajor: data.bizMajorOf.get(p.bizMinor) } : {}),
          covers,
          near,
        };
      })
      .sort((a, b) => Number(b.covers) - Number(a.covers) || a.near - b.near)
      .slice(0, 40)
      .map(({ near: _n, ...p }) => p);
    const accounts = data.accounts
      .filter((a) => (a as { active?: boolean }).active !== false)
      .map((a) => ({ txType: a.txType as TxType, major: a.major, mid: a.mid, minor: a.minor }));
    const pending = openSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as FinTransaction)
      .filter((t) => t.id !== id && t.status !== "confirmed")
      .sort((a, b) => (b.datetime ?? b.date).localeCompare(a.datetime ?? a.date))
      .slice(0, 30)
      .map((t) => ({ id: t.id, date: t.date, datetime: t.datetime, vendor: t.vendor, gross: t.gross, txType: t.txType, status: t.status, last4: t.last4 }));

    const out: TxCardData = {
      tx: trimTransaction(tx as unknown as Record<string, unknown>) as unknown as FinTransaction,
      where: pm?.alias ? `${pm.alias} ${tx.last4 ?? ""}`.trim() : tx.last4 ?? "",
      kind: pm?.kind === "card" ? "card" : "account",
      candidates: cand?.items ?? [],
      candidateBasis: cand?.basis,
      receipts,
      openInstallments,
      projects,
      accounts,
      pending,
    };
    return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    console.error("[finance/tx-card]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "알 수 없는 오류" }, { status: 500 });
  }
}
