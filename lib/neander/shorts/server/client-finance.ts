import "server-only";

// ============================================================
//  대행 업체 ↔ 재무 계약 — 계약서 · 입금 상태를 AI STUDIO 에서 본다 (읽기만)
// ------------------------------------------------------------
//  업체(고객사)의 contract.financeCodes(PJ-…)로 재무 프로젝트(neander_fin_projects)와
//  그 계약서(neander_fin_docs · kind contract)를 찾아 요약한다. 고치기는 재무 화면에서.
//  재무 접근 권한(NEANDER_FINANCE_EMAILS)이 있는 사람에게만 보낸다 — 부르는 쪽이 hasFinanceAccess 로 거른다.
//  받았는지는 재무와 같은 판단(isInstallmentReceived · installmentStatus)을 쓴다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { FinContractDoc } from "@/lib/neander/finance/docs";
import { dueLabel, installmentStatus, isInstallmentReceived, type FinProjectDoc } from "@/lib/neander/finance/project";
import { todayStrKST } from "@/lib/neander/format";
import type { ClientFinanceContract, ClientFinanceSummary } from "../agency";
import { rootDb } from "./space-db";

export type { ClientFinanceContract, ClientFinanceSummary };

const norm = (c: string) => c.trim().toUpperCase();

/** 코드마다 요약 — 재무에 없는 코드는 「찾지 못함」 으로 (projectId null) */
export async function clientFinance(dbIn: Firestore, codes: string[]): Promise<ClientFinanceSummary[]> {
  const want = [...new Set(codes.map(norm).filter(Boolean))];
  if (!want.length) return [];
  const db = rootDb(dbIn);
  const projects = (await db.collection(NEANDER_COL.finProjects).get()).docs.map((d) => ({ ...(d.data() as FinProjectDoc), id: d.id }));
  const found = new Map(projects.filter((p) => p.code && want.includes(norm(p.code))).map((p) => [norm(p.code), p]));
  const ids = [...found.values()].map((p) => p.id);
  const contracts = new Map<string, ClientFinanceContract[]>();
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection(NEANDER_COL.finDocs).where("projectId", "in", ids.slice(i, i + 30)).get();
    for (const d of snap.docs) {
      const c = d.data() as FinContractDoc;
      if (c.kind !== "contract") continue;
      const row: ClientFinanceContract = { id: d.id, title: c.title, status: c.status, signedDate: c.signedDate ?? null, startDate: c.startDate ?? null, endDate: c.endDate ?? null, amount: Number(c.amount) || 0, vatMode: c.vatMode === "included" ? "included" : "excluded" };
      contracts.set(c.projectId, [...(contracts.get(c.projectId) ?? []), row]);
    }
  }
  const today = todayStrKST();
  return want.map((code) => {
    const p = found.get(code);
    if (!p) return { code, projectId: null, name: "재무에서 찾지 못한 코드", status: "", startDate: null, endDate: null, contractAmount: 0, vatMode: "excluded", received: null, remaining: null, next: null, overdue: 0, contracts: [], installments: [] };
    const inst = p.installments ?? [];
    const amount = (x: { amount?: number }) => Math.round(Number(x.amount) || 0);
    const open = inst.filter((i) => !isInstallmentReceived(i));
    const next = open.filter((i) => i.dueDate).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
    const received = inst.length ? inst.filter(isInstallmentReceived).reduce((n, i) => n + amount(i), 0) : null;
    return {
      code: p.code,
      projectId: p.id,
      name: p.name,
      status: p.status,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      contractAmount: Math.round(Number(p.contractAmount) || 0),
      vatMode: p.vatMode === "included" ? "included" : "excluded",
      received,
      remaining: received === null ? null : Math.max(0, Math.round(Number(p.contractAmount) || 0) - received),
      next: next ? { date: next.dueDate!, label: dueLabel(next), amount: amount(next) } : null,
      overdue: open.filter((i) => installmentStatus(i, today) === "overdue").length,
      contracts: (contracts.get(p.id) ?? []).sort((a, b) => (b.signedDate ?? b.startDate ?? "").localeCompare(a.signedDate ?? a.startDate ?? "")),
      installments: inst.map((i) => ({ id: i.id, kind: i.kind, amount: amount(i), dueDate: i.dueDate ?? null, dueLabel: dueLabel(i), paidDate: i.paidDate ?? null, received: isInstallmentReceived(i) })),
    };
  });
}

/** 연결할 재무 프로젝트 고르기 — 최근 것부터 (코드 · 이름 · 발주처) */
export async function financeProjectOptions(dbIn: Firestore): Promise<{ code: string; name: string; client: string; status: string; startDate: string | null }[]> {
  const snap = await rootDb(dbIn).collection(NEANDER_COL.finProjects).get();
  return snap.docs
    .map((d) => d.data() as FinProjectDoc)
    .filter((p) => p.code)
    .map((p) => ({ code: p.code, name: p.name, client: p.client ?? "", status: p.status, startDate: p.startDate ?? null }))
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || b.code.localeCompare(a.code));
}
