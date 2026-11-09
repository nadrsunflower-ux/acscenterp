// ============================================================
//  은행 입출금 문자 — 원문에서 날짜 · 입출금 · 금액 · 잔액 · 계좌를 읽는다
// ------------------------------------------------------------
//  회사 전용폰(매크로드로이드)이 은행 문자를 그대로 ERP 로 보낸다
//  (api/neander/finance/sms). 처음 4주는 **장부에 넣지 않는다** — 원문과 읽은 값만
//  쌓아 두고, 월말 엑셀과 맞춰 몇 건이 오고 몇 건이 빠지는지 잰다.
//
//  은행 문구는 은행이 바꾸면 그만이다. 그래서 정해진 틀 하나로 자르지 않고,
//  문장 안의 낱말(입금 · 출금 · 잔액 · 원 · 날짜 꼴)로 읽는다. 못 읽은 칸은 비워 두고
//  원문은 늘 남긴다 — 나중에 고친 읽기로 다시 읽으면 된다(parsedWith).
//
//  잔액이 있으면 앞뒤 문자로 빠진 거래를 찾는다:
//    직전 잔액 ± 이번 금액 = 이번 잔액  → 맞으면 사이에 빠진 것이 없다
// ============================================================

/** 읽기 규칙이 바뀌면 올린다 — 예전 판으로 읽은 문자를 다시 읽을 때 쓴다 */
export const BANK_SMS_PARSER = 2;

export interface BankSmsParsed {
  bank?: "신한" | "국민" | "우리" | "카카오뱅크" | "토스" | "기타";
  /** 계좌 끝 네 자리 (문자에 보이는 숫자 끝에서) */
  last4?: string;
  kind?: "입금" | "출금";
  amount?: number;
  /** 거래 후 잔액 */
  balance?: number;
  /** 문자 속 날짜 · 시각 (MM-DD HH:mm) — 연도는 받은 날로 채운다 */
  when?: string;
  /** 보낸 분 · 받는 분 · 적요로 보이는 나머지 글 */
  memo?: string;
  /** 은행 거래 문자로 볼 만한가 (금액과 입출금이 둘 다 읽혔나) */
  ok: boolean;
}

const BANKS: [RegExp, NonNullable<BankSmsParsed["bank"]>][] = [
  [/신한/, "신한"],
  [/국민|KB/i, "국민"],
  [/우리/, "우리"],
  [/카카오뱅크|카뱅/, "카카오뱅크"],
  [/토스/, "토스"],
];

const toNum = (s: string) => Number(s.replace(/[,\s]/g, ""));

/** 문자 한 통을 읽는다. 못 읽은 칸은 비운다 */
export function parseBankSms(text: string): BankSmsParsed {
  const t = text.replace(/\r/g, "").replace(/\[Web발신\]|\(광고\)/g, " ").trim();
  const out: BankSmsParsed = { ok: false };

  // 은행 — 문자 머리(「우리 11/10」「신한11/10」)에 오는 이름. 받는 분 · 보낸 분 이름에도 은행 이름이
  // 붙을 수 있어서(「신한（주）네안」) 목록 순서가 아니라 **가장 앞에 나온** 은행으로 정한다
  const firstBank = BANKS.map(([re, name]) => ({ name, at: t.search(re) }))
    .filter((b) => b.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  out.bank = firstBank?.name ?? (t ? "기타" : undefined);

  // 입금 · 출금 — 「입금」「출금」「지급」「이체입금」…  둘 다 있으면 먼저 나온 쪽
  const inAt = t.search(/입금/);
  const outAt = t.search(/출금|지급|인출/);
  if (inAt >= 0 && (outAt < 0 || inAt < outAt)) out.kind = "입금";
  else if (outAt >= 0) out.kind = "출금";

  // 잔액 — 「잔액 1,234원」「잔액1,234」
  const bal = t.match(/잔액\s*:?\s*(-?[\d,]+)\s*원?/);
  if (bal) out.balance = toNum(bal[1]);

  // 금액 — 입금/출금 낱말 바로 뒤의 숫자, 없으면 잔액이 아닌 「…원」 첫 숫자
  const near = t.match(/(?:입금|출금|지급|인출)\s*:?\s*([\d,]{1,15})\s*원?/);
  if (near && toNum(near[1]) > 0) out.amount = toNum(near[1]);
  else {
    const wons = [...t.matchAll(/([\d,]{2,15})\s*원/g)].filter((m) => !bal || m.index !== t.indexOf(bal[1]));
    const first = wons.find((m) => !/잔액\s*:?\s*$/.test(t.slice(0, m.index)));
    if (first) out.amount = toNum(first[1]);
  }

  // 날짜 · 시각 — 11/10 09:12 · 11-10 09:12 · 11.10 09:12
  const dt = t.match(/(\d{1,2})[/.-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (dt) out.when = `${dt[1].padStart(2, "0")}-${dt[2].padStart(2, "0")} ${dt[3].padStart(2, "0")}:${dt[4]}`;

  // 계좌 — 가린 번호(100-***-123456 · 110***23456 · *3456)의 끝 네 자리
  //   우리은행은 「*123456」처럼 별표 뒤에 끝 여섯 자리를 찍는다 → 그중 끝 네 자리
  const acct = t.match(/\d{2,6}[-*]+[\d*-]*?(\d{4})(?!\d)/) ?? t.match(/\*+(\d{4,8})(?!\d)/);
  if (acct) out.last4 = acct[1].slice(-4);

  // 나머지 글 — 숫자 · 낱말을 걷어 내고 남은 이름 (보낸 분 · 받는 분 · 적요로 보이는 것)
  const memo = t
    .replace(/\[.*?\]/g, " ")
    .replace(/(\d{1,2})[/.-](\d{1,2})\s+\d{1,2}:\d{2}/g, " ")
    .replace(/잔액\s*:?\s*-?[\d,]+\s*원?/g, " ")
    .replace(/(입금|출금|지급|인출)\s*:?\s*[\d,]+\s*원?/g, " ")
    .replace(/[\d*,-]{4,}/g, " ")
    .replace(/신한|국민|우리|카카오뱅크|토스|은행|입금|출금|지급|인출|원/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (memo) out.memo = memo.slice(0, 80);

  out.ok = Boolean(out.kind && out.amount && out.amount > 0);
  return out;
}

export interface BalanceLink {
  /** 이 문자 앞뒤로 빠진 것이 없나 — 잔액이 이어지면 true, 모르면 null */
  continuous: boolean | null;
  /** 이어지지 않을 때, 사이에 빠진 돈 (+ 들어온 것 · − 나간 것) */
  gap?: number;
}

/** 같은 계좌의 바로 앞 문자와 잔액이 이어지나 — 직전 잔액 ± 이번 금액 = 이번 잔액 */
export function balanceLink(prev: BankSmsParsed | undefined, cur: BankSmsParsed): BalanceLink {
  if (!prev || prev.balance === undefined || cur.balance === undefined || !cur.amount || !cur.kind) return { continuous: null };
  const expect = prev.balance + (cur.kind === "입금" ? cur.amount : -cur.amount);
  const gap = cur.balance - expect;
  return gap === 0 ? { continuous: true } : { continuous: false, gap };
}
