// ============================================================
//  자금 일보 — 화면에서 부르는 API (api/neander/finance/daily-cash)
// ------------------------------------------------------------
//  인증 헤더는 payback-client.ts 와 같은 모양이다.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { CardTx, CashAccount, SmsTx } from "./daily-cash";

export interface DailyCashFetch {
  txs: SmsTx[];
  /** 통장(끝 네 자리) → 마지막 문자 「YYYY-MM-DD HH:mm」 */
  lastSeen: Record<string, string>;
  /** ERP 결제수단의 통장 (이름 · 사업자) */
  accounts: CashAccount[];
  /** ERP 결제수단의 카드 */
  cards: CashAccount[];
  /** 기간 안 카드 승인 · 취소 (문자) */
  cardTxs: CardTx[];
  cardLastSeen: Record<string, string>;
  /** 문자 통지를 신청한 통장 · 카드 (끝 네 자리) */
  linked: { accounts: string[]; cards: string[] };
  total: number;
}

export async function fetchDailyCash(from: string, to: string): Promise<DailyCashFetch> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const res = await fetch(`/api/neander/finance/daily-cash?from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `요청이 실패했습니다 (HTTP ${res.status})`);
  }
  return (await res.json()) as DailyCashFetch;
}
