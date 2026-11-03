// ============================================================
//  대행(업체별) — 재무 계약 요약 모양 · 계약 코드 · 계약 기간 (순수 함수 · 화면 · 서버 공용)
// ------------------------------------------------------------
//  업체 하나(ClientDoc)에 대행 프로젝트(space · kind agency) 여러 개. 브랜드 영상(kind brand)은
//  계약 달(month)을 갖는다 — 이번 달 납품은 model.monthProgress 로 센다.
//  재무 계약 요약의 계산은 서버(client-finance.ts)가 하고, 모양은 여기서 정한다.
// ============================================================

import type { ClientDoc } from "./types";

export interface ClientFinanceContract {
  id: string;
  title: string;
  status: "draft" | "signed" | "done" | "cancelled";
  signedDate: string | null;
  startDate: string | null;
  endDate: string | null;
  amount: number;
  vatMode: "excluded" | "included";
}

export interface ClientFinanceSummary {
  code: string;
  /** 재무 프로젝트 문서 id — 재무 화면으로 가는 주소 (재무에 없는 코드면 null) */
  projectId: string | null;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  /** 계약 금액 (계약의 부가세 기준 그대로) */
  contractAmount: number;
  vatMode: "excluded" | "included";
  /** 회차 기준 — 회차가 없으면 null (이 화면에서 받은 돈을 셀 수 없다) */
  received: number | null;
  remaining: number | null;
  next: { date: string; label: string; amount: number } | null;
  overdue: number;
  contracts: ClientFinanceContract[];
  /** 회차 — 일정(캘린더)에 받을 날 · 받은 날로 */
  installments: { id: string; kind: string; amount: number; dueDate: string | null; dueLabel: string; paidDate: string | null; received: boolean }[];
}

export const CONTRACT_STATUS_TEXT: Record<ClientFinanceContract["status"], string> = { draft: "초안 · 검토 중", signed: "체결", done: "이행 완료", cancelled: "해지 · 무산" };

/** 업체의 재무 계약 코드 (예전 한 칸 포함) */
export const clientFinanceCodes = (c: Pick<ClientDoc, "contract">): string[] =>
  [...new Set([...(c.contract.financeCodes ?? []), ...(c.contract.financeCode ? [c.contract.financeCode] : [])].map((x) => x.trim().toUpperCase()).filter(Boolean))];

/** 계약 기간 안인가 (시작 월 ≤ 이 달 ≤ 끝 월) */
export const inContract = (c: Pick<ClientDoc, "contract">, month: string) => c.contract.startMonth <= month && (!c.contract.endMonth || month <= c.contract.endMonth);
