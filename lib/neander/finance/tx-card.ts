// ============================================================
//  거래 한 건 확인 카드 — 폰 화면(/neander/tx/[id])과 API(api/neander/finance/tx-card)가 같이 쓰는 모양
// ------------------------------------------------------------
//  문자로 들어온 거래를 돈이 움직인 그때 확정하고 프로젝트에 붙이는 화면이다.
//  노션 알림 댓글의 링크로 들어온다 (server/sms-notify.ts 의 txCardUrl).
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { ClassCandidate } from "./classify";
import type { ProjectStatus } from "./project";
import type { ProjectCandidate } from "./sms-classify";
import type { FinTransaction, FinTransactionInput, TxType } from "./types";

export interface TxCardProject {
  id: string;
  code: string;
  name: string;
  client?: string;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  bizMinor?: string;
  /** 그 사업소분류가 장부에서 가장 많이 쓰인 사업대분류 */
  bizMajor?: string;
  /** 거래일이 진행 기간 안 */
  covers: boolean;
}

export interface TxCardInstallment {
  projectId: string;
  installmentId: string;
  code: string;
  name: string;
  kind: string;
  /** 청구액 (부가세 포함 — 통장에 찍히는 돈) */
  billed: number;
  dueDate?: string;
}

export interface TxCardAccount {
  txType: TxType;
  major: string;
  mid: string;
  minor: string;
}

export interface TxCardPending {
  id: string;
  date: string;
  datetime?: string;
  vendor?: string;
  gross: number;
  txType: TxType;
  status: FinTransaction["status"];
  last4?: string;
}

export interface TxCardData {
  tx: FinTransaction;
  /** 통장 · 카드 이름 + 끝자리 */
  where: string;
  kind: "account" | "card";
  candidates: ClassCandidate[];
  candidateBasis?: string;
  /** 입금액과 청구액이 같은 안 받은 회차 */
  receipts: ProjectCandidate[];
  /** 안 받은 회차 전부 (입금일 때) */
  openInstallments: TxCardInstallment[];
  projects: TxCardProject[];
  accounts: TxCardAccount[];
  /** 문자로 들어와 아직 확정 안 한 다른 거래 (최근 순) */
  pending: TxCardPending[];
}

export async function fetchTxCard(id: string): Promise<TxCardData> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const res = await fetch(`/api/neander/finance/tx-card?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as TxCardData & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `불러오지 못했습니다 (HTTP ${res.status})`), { status: res.status });
  return body;
}

/** 이 거래에 쓸 수 있는 계정 — 지출에 수입 계정을 고르지 않게. 자금거래 · 카드대금은 방향을 따진다 */
export function accountsFor(tx: Pick<FinTransaction, "txType" | "gross">, all: TxCardAccount[]): TxCardAccount[] {
  const allowed: TxType[] =
    tx.txType === "수입" || tx.txType === "환급"
      ? ["수입", "환급", "자금거래"]
      : tx.txType === "지출" || tx.txType === "카드대금결제"
        ? ["지출", "카드대금결제", "자금거래"]
        : ["자금거래", "수입", "지출", "환급", "카드대금결제"];
  return all.filter((a) => allowed.includes(a.txType));
}

/** 계정 하나를 고른 패치 — 사람이 정했으니 확정. 사업구분은 후보가 알려 줄 때만 */
export function accountPatch(
  a: { txType: TxType; acctMajor: string; acctMid: string; acctMinor: string; bizMajor?: string; bizMinor?: string },
  how: string,
): Partial<FinTransactionInput> {
  return {
    txType: a.txType,
    acctMajor: a.acctMajor,
    acctMid: a.acctMid,
    acctMinor: a.acctMinor,
    ...(a.bizMajor && a.bizMinor ? { bizMajor: a.bizMajor, bizMinor: a.bizMinor } : {}),
    status: "confirmed",
    classReason: `폰에서 확정 — ${how}`,
  };
}

/**
 * 프로젝트를 붙이는 패치. 프로젝트가 사업부를 말해 주고 거래의 사업구분이 비었거나 「공용」이면
 * 같이 바꾼다 — 그 프로젝트에 쓴 돈이니까 (검토 대기함의 setProject 와 같은 생각, 공용만 더).
 */
export function projectPatch(
  tx: Pick<FinTransaction, "bizMajor">,
  p: Pick<TxCardProject, "code" | "bizMajor" | "bizMinor"> | null,
): Partial<FinTransactionInput> {
  if (!p) return { projectCode: undefined };
  const takeBiz = !!p.bizMajor && !!p.bizMinor && (!tx.bizMajor || tx.bizMajor === "공용");
  return { projectCode: p.code, ...(takeBiz ? { bizMajor: p.bizMajor, bizMinor: p.bizMinor } : {}) };
}
