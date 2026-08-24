// ============================================================
//  법인카드 사용 메모 — 현장 기록과 카드 명세서를 잇는다
// ------------------------------------------------------------
//  카드 명세서에는 가맹점과 금액밖에 없다. 「쿠팡 20,290원」이 무엇을 산
//  것인지는 결제한 사람만 안다. 그래서 지금은 결제할 때마다 단톡방에
//  캡처와 메모를 올리고, 나중에 사람이 그걸 보며 원장에 옮겨 적는다.
//
//  카카오는 그 단톡방을 읽어올 방법이 없다(공식 API 는 보내기만 있고,
//  그마저 기존 단체방으로는 못 보낸다). 그래서 기록하는 자리를 ERP 안으로
//  옮기고, **옮겨 적는 일 자체를 없앤다** —
//
//    현장:  결제 → 모바일에서 카드·금액·내용 기록 (+사진)
//    나중:  카드 명세서 엑셀 업로드
//           → 뒷4자리 + 금액 + 날짜로 메모를 자동으로 붙임
//           → 비고·계정이 채워진 채로 검토 대기함에 도착
//
//  ⚠️ 대조는 **확실할 때만** 붙인다. 같은 카드로 같은 날 같은 금액을 두 번
//     썼다면(커피 두 잔) 어느 쪽이 어느 메모인지 알 수 없다. 그런 건
//     자동으로 붙이지 않고 사람에게 넘긴다. 재무에서 조용히 틀린 연결이
//     아무 연결도 없는 것보다 나쁘다.
// ============================================================

import { netAmount, type FinTransaction } from "./types";

export interface FinCardMemo {
  id: string;
  /** 사용일 `YYYY-MM-DD` */
  date: string;
  /** 카드 뒷 4자리 */
  last4: string;
  /** 가맹점 — 아는 대로. 대조는 금액·날짜로 하므로 필수는 아니다 */
  vendor?: string;
  /** 무엇에 썼는지. 이게 이 기록의 전부다 */
  note: string;
  /** 금액(원). 부호 없이 사용액 */
  amount: number;
  /** 알면 미리 지정 — 대조될 때 거래에 함께 실린다 */
  bizMajor?: string;
  bizMinor?: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  /** 첨부 사진 (Storage 객체 경로. 화면에 줄 때만 서명 URL 로 바꾼다) */
  photoPaths?: string[];
  /** 대조된 거래 */
  matchedTxId?: string;
  matchedAt?: number;
  createdAt: number;
  createdBy: string;
}

/**
 * 결제 캡처에서 읽어낸 값.
 *
 * 이 타입은 서버(비전 모델 호출)와 화면(입력칸 채우기)이 함께 쓴다. 그래서
 * server-only 인 ai-receipt.ts 가 아니라 여기 둔다 — 저쪽에 두면 화면 코드가
 * 타입 하나 때문에 서버 전용 모듈을 물고 들어간다.
 */
export interface ReceiptRead {
  /** 가맹점 이름. 화면에 보이는 그대로 */
  vendor?: string;
  /** 실제로 결제된 금액(원). 상품금액·배송비가 아니라 최종 결제액 */
  amount?: number;
  /** `YYYY-MM-DD`. 화면에 연도가 없으면 비운다 — 추측하지 않는다 */
  date?: string;
  /** 무엇을 샀는지 한 줄로 */
  items?: string;
  /** 카드 뒷 4자리 (보이면) */
  last4?: string;
  /** 얼마나 확신하는지. high 가 아니면 화면이 눈에 띄게 알린다 */
  confidence: "high" | "medium" | "low";
  /** 못 읽었거나 애매한 것. 화면에 그대로 보여준다 */
  uncertain?: string;
  /** 어느 모델이 읽었는지 */
  model?: string;
  costUsd?: number;
}

/** 화면으로 나갈 때의 모습 — 사진은 짧게 사는 서명 URL 로 바뀐다 */
export interface FinCardMemoView extends Omit<FinCardMemo, "photoPaths"> {
  photos?: { path: string; url: string }[];
}

/** 카드 명세서에 찍히는 날짜가 사용일과 하루 어긋나는 일이 있다 */
const DAY_SLACK = 1;

const dayDiff = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export interface MemoMatch {
  memo: FinCardMemo;
  tx: FinTransaction;
  /** 날짜가 정확히 같은가 (아니면 ±1일) */
  exactDate: boolean;
}

export interface MatchResult {
  /** 하나로 확정된 짝 — 이것만 자동으로 붙인다 */
  matched: MemoMatch[];
  /** 후보가 둘 이상이라 사람이 정해야 하는 메모 */
  ambiguous: { memo: FinCardMemo; candidates: FinTransaction[] }[];
  /** 짝을 못 찾은 메모 (아직 명세서가 안 올라왔거나 금액이 다르다) */
  unmatched: FinCardMemo[];
}

/**
 * 메모 ↔ 거래 대조.
 *
 * 짝짓는 기준은 **카드 뒷4자리 + 금액 + 날짜(±1일)** 다. 가맹점 이름은
 * 쓰지 않는다 — 사람이 「쿠팡」이라 적고 명세서에는 「쿠팡(주)」로 찍히는
 * 식이라 오히려 맞는 짝을 놓친다.
 *
 * 이미 다른 메모가 가져간 거래는 후보에서 뺀다. 그래서 같은 금액이 여러
 * 건이어도 메모가 그만큼 있으면 차례로 하나씩 붙는다 — 다만 그 배정은
 * 임의라, 후보가 여럿인 상황 자체를 ambiguous 로 남겨 사람이 보게 한다.
 */
export function matchMemos(memos: FinCardMemo[], transactions: FinTransaction[]): MatchResult {
  const open = memos.filter((m) => !m.matchedTxId);
  // 카드 거래만, 그리고 아직 메모가 붙지 않은 것만
  const taken = new Set(memos.map((m) => m.matchedTxId).filter(Boolean) as string[]);
  const byLast4 = new Map<string, FinTransaction[]>();
  transactions.forEach((t) => {
    if (!t.last4 || taken.has(t.id)) return;
    byLast4.set(t.last4, [...(byLast4.get(t.last4) ?? []), t]);
  });

  const matched: MemoMatch[] = [];
  const ambiguous: MatchResult["ambiguous"] = [];
  const unmatched: FinCardMemo[] = [];
  const used = new Set<string>();

  // 날짜가 정확히 맞는 짝을 먼저 처리한다 — ±1일 후보에 밀려나면 안 된다
  const ordered = [...open].sort((a, b) => a.date.localeCompare(b.date));

  ordered.forEach((memo) => {
    const pool = (byLast4.get(memo.last4) ?? []).filter(
      (t) =>
        !used.has(t.id) &&
        Math.round(Math.abs(netAmount(t))) === Math.round(Math.abs(memo.amount)) &&
        dayDiff(t.date, memo.date) <= DAY_SLACK,
    );
    if (pool.length === 0) {
      unmatched.push(memo);
      return;
    }
    const exact = pool.filter((t) => t.date === memo.date);
    const pick = exact.length > 0 ? exact : pool;
    if (pick.length > 1) {
      ambiguous.push({ memo, candidates: pick });
      return;
    }
    used.add(pick[0].id);
    matched.push({ memo, tx: pick[0], exactDate: pick[0].date === memo.date });
  });

  return { matched, ambiguous, unmatched };
}

/** 대조된 메모가 거래에 실어 줄 값. 이미 채워진 칸은 건드리지 않는다. */
export function patchFromMemo(memo: FinCardMemo, tx: FinTransaction) {
  const patch: Record<string, unknown> = {};
  // 비고는 이 기록의 핵심이라 항상 남긴다. 기존 비고가 있으면 뒤에 붙인다.
  patch.note = tx.note ? `${tx.note} / ${memo.note}` : memo.note;
  if (!tx.vendor && memo.vendor) patch.vendor = memo.vendor;
  if (!tx.bizMajor && memo.bizMajor) {
    patch.bizMajor = memo.bizMajor;
    patch.bizMinor = memo.bizMinor ?? memo.bizMajor;
  }
  if (!tx.acctMinor && memo.acctMinor) {
    patch.acctMajor = memo.acctMajor;
    patch.acctMid = memo.acctMid;
    patch.acctMinor = memo.acctMinor;
  }
  return patch;
}
