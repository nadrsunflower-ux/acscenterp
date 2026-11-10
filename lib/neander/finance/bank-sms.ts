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
export const BANK_SMS_PARSER = 5;

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
  /** 문자 종류 — 없으면 은행 입출금 (판 2 까지 읽은 문자) */
  channel?: "bank" | "card";
  /** 카드 승인 · 취소 문자일 때 */
  card?: CardSmsParsed;
}

export interface CardSmsParsed {
  /** 신한카드 · KB국민카드 … */
  company?: string;
  /** 카드 끝 네 자리 — 카드사가 가려 보내면 「3*0*」처럼 별표가 섞인다 (matchCardLast4 로 맞춘다) */
  last4?: string;
  approval: "승인" | "취소";
  amount?: number;
  /** 일시불 · 3개월 … */
  installment?: string;
  merchant?: string;
  /** 이 달 누적 사용액 (카드사가 알려 주면) */
  cumulative?: number;
  /** 문자 끝의 「잔액」 — 신한 법인카드 문자가 붙인다. 남은 한도로 보이나 카드사 설명은 확인 전 */
  remaining?: number;
  /** 소지자 (가린 이름, 예: 이*주) */
  holder?: string;
}

const BANKS: [RegExp, NonNullable<BankSmsParsed["bank"]>][] = [
  [/신한/, "신한"],
  [/국민|KB/i, "국민"],
  [/우리/, "우리"],
  [/카카오뱅크|카뱅/, "카카오뱅크"],
  [/토스/, "토스"],
];

const toNum = (s: string) => Number(s.replace(/[,\s]/g, ""));

const CARD_COMPANY = /(신한카드|KB국민카드|국민카드|KB카드|우리카드|하나카드|삼성카드|현대카드|롯데카드|BC카드|비씨카드|NH카드|농협카드)/;

/**
 * 카드사 이름 바로 뒤에 승인 · 취소가 붙는 머리 — 「신한법인승인 1234」「신한카드(1234)승인」
 * 「KB국민카드3*0*승인」「신한체크승인」. 은행 문자(「신한11/10」)는 승인 · 취소가 붙지 않아 걸리지 않는다
 */
const CARD_HEAD =
  /(신한|KB국민|국민|KB|우리|하나|삼성|현대|롯데|BC|비씨|NH농협|NH|농협)\s*(?:카드)?\s*(?:법인|기업|체크|개인)?\s*(?:카드)?\s*[(（]?\s*([\d*]{4})?\s*[)）]?\s*(승인\s*취소|승인|취소)/;

const companyName = (s: string) => (/KB|국민/.test(s) ? "KB국민카드" : /카드$/.test(s) ? s : `${s.replace(/^NH$|^NH농협$/, "농협")}카드`);

/**
 * 카드 승인 · 취소 문자.
 *  · 신한 법인카드(2026-11-10 받은 실제 꼴): 「신한법인승인 1234 11/10 17:18 12,340원 가맹점 잔액1,000,000원」 — 한 줄
 *  · 국민 법인카드(2026-11-10 받은 실제 꼴): 「KB국민카드 ⏎ 1234(기업) ⏎ 11/10 17:28 ⏎ 4,560원 ⏎ 가맹점 사용」 — 「승인」 대신 「사용」
 *  · 흔한 꼴(못 받음 — 다른 카드사 대비): 「KB국민카드3*0*승인 ⏎ 가*나님 ⏎ 12,000원 일시불 ⏎ 11/10 13:22 ⏎ 가맹점 ⏎ 누적…」
 * 가맹점은 위치로 자르지 않고, 알아본 칸(머리 · 이름 · 금액 · 할부 · 날짜 · 잔액 · 누적)을 걷어 내고 남은 글로 본다.
 * 광고 문자와 「카드사용알림서비스 변경 완료」 같은 안내는 금액 · 시각이 없어 카드 거래로 보지 않는다.
 */
export function parseCardSms(text: string): CardSmsParsed | null {
  if (/\(광고\)/.test(text)) return null;
  const t = text.replace(/\r/g, "").replace(/\[Web발신\]/g, " ").trim();
  const head = t.match(CARD_HEAD);
  // 머리가 안 맞으면 「…카드」 + 승인 · 취소 · 사용이 따로 있고 금액 · 시각이 있는 꼴
  //   — 단, 은행 입출금 문자(적요가 「신한카드」인 카드값 출금 등)는 빼고
  const co = head ? null : t.match(CARD_COMPANY);
  const looksTx = /[\d,]+\s*원/.test(t) && /\d{1,2}[/.-]\d{1,2}\s+\d{1,2}:\d{2}/.test(t);
  if (!head && !(co && /승인|취소|사용/.test(t) && looksTx && !/입금|출금/.test(t))) return null;
  const out: CardSmsParsed = {
    company: companyName(head ? head[1] : co![1]),
    approval: /취소/.test(head ? head[3] : t) ? "취소" : "승인",
  };
  let rest = t;
  if (head) {
    // 끝자리 — 머리 안(「카드(1234)승인」) 또는 바로 뒤(「법인승인 1234」)
    const after = t.slice((head.index ?? 0) + head[0].length);
    const behind = head[2] ? null : after.match(/^\s*([\d*]{4})(?![\d*])/);
    out.last4 = head[2] ?? behind?.[1];
    rest = t.slice(0, head.index) + " " + after.slice(behind ? behind[0].length : 0);
  } else {
    const tail = t.slice((co!.index ?? 0) + co![1].length);
    const l4 = tail.match(/^\s*[(（]?\s*([\d*]{4})(?![\d*])/);
    if (l4) out.last4 = l4[1];
    rest = t.slice(0, co!.index) + " " + tail.slice(l4 ? l4[0].length : 0);
  }
  if (out.last4 && !/\d/.test(out.last4)) delete out.last4;

  const cum = rest.match(/누적\s*:?\s*([\d,]+)\s*원?/);
  if (cum) out.cumulative = toNum(cum[1]);
  const rem = rest.match(/잔액\s*:?\s*([\d,]+)\s*원?/);
  if (rem) out.remaining = toNum(rem[1]);
  // 금액 — 누적 · 잔액이 아닌 첫 「…원」
  const amt = [...rest.matchAll(/([\d,]{1,15})\s*원/g)].find((m) => !/(누적|잔액)\s*:?\s*$/.test(rest.slice(0, m.index)));
  if (amt) out.amount = toNum(amt[1]);
  const inst = rest.match(/(일시불|\d{1,2}\s*개월)/);
  if (inst) out.installment = inst[1].replace(/\s+/g, "");
  const holder = rest.match(/([가-힣]\*[가-힣]{1,2}|[가-힣]{1,2}\*[가-힣])\s*님?/);
  if (holder) out.holder = holder[1].replace(/님$/, "");

  const merchant = rest
    .replace(/(누적|잔액)\s*:?\s*[\d,]+\s*원?/g, " ")
    .replace(/[(（]?\s*(일시불|\d{1,2}\s*개월)\s*[)）]?/g, " ")
    .replace(/[\d,]{1,15}\s*원/g, " ")
    .replace(/\d{1,2}[/.-]\d{1,2}\s+\d{1,2}:\d{2}/g, " ")
    .replace(holder ? holder[0] : /$^/, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[(（]\s*(기업|법인|개인|체크|가족)\s*[)）]/g, " ")
    .replace(/승인|취소/g, " ")
    .replace(/(^|\s)사용(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (merchant) out.merchant = merchant.slice(0, 60);
  return out;
}

/** 가린 끝자리(「3*0*」)를 카드 목록에서 하나로 맞춘다 — 하나만 맞을 때만. 안 가렸으면 그대로 */
export function matchCardLast4(pattern: string, candidates: string[]): string | undefined {
  if (!pattern.includes("*")) return pattern;
  const re = new RegExp(`^${pattern.replace(/\*/g, "\\d")}$`);
  const hit = [...new Set(candidates)].filter((c) => re.test(c));
  return hit.length === 1 ? hit[0] : undefined;
}

/** 문자 한 통을 읽는다. 못 읽은 칸은 비운다 */
export function parseBankSms(text: string): BankSmsParsed {
  const t = text.replace(/\r/g, "").replace(/\[Web발신\]|\(광고\)/g, " ").trim();
  const out: BankSmsParsed = { ok: false };

  // 카드 승인 · 취소 문자면 은행 입출금으로 읽지 않는다
  const card = parseCardSms(text);
  if (card) {
    const dt = t.match(/(\d{1,2})[/.-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
    return {
      ok: Boolean(card.amount && card.last4),
      channel: "card",
      card,
      ...(card.amount ? { amount: card.amount } : {}),
      ...(dt ? { when: `${dt[1].padStart(2, "0")}-${dt[2].padStart(2, "0")} ${dt[3].padStart(2, "0")}:${dt[4]}` } : {}),
    };
  }
  out.channel = "bank";

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

  // 나머지 글 — 보낸 분 · 받는 분 · 적요. 장부(엑셀)의 거래처와 **같은 글자**여야 자동분류가 이력을 찾는다
  //   (「KB12345678」의 가맹점 번호가 와우 · 아이디 매장을 가르고, 「2610국민건강」의 앞머리는 귀속월이다).
  //   여러 줄 꼴(신한 · 우리)은 머리 · 계좌 · 금액 · 잔액 줄을 빼고 남은 줄을 그대로 쓴다.
  //   한 줄 꼴만 낱말을 걷어 내는데, 이름 **안**의 숫자 · 은행 낱말은 건드리지 않는다
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const memo =
    lines.length >= 3
      ? lines
          .filter(
            (l) =>
              !/^\S{0,8}\s*\d{1,2}[/.-]\d{1,2}\s+\d{1,2}:\d{2}$/.test(l) &&
              !/^[\d*-]{5,}$/.test(l) &&
              !/^(입금|출금|지급|인출)\s*:?\s*[\d,]+\s*원?$/.test(l) &&
              !/^잔액\s*:?\s*-?[\d,]+\s*원?$/.test(l),
          )
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      : t
          .replace(/\[.*?\]/g, " ")
          .replace(/(\d{1,2})[/.-](\d{1,2})\s+\d{1,2}:\d{2}/g, " ")
          .replace(/잔액\s*:?\s*-?[\d,]+\s*원?/g, " ")
          .replace(/(입금|출금|지급|인출)\s*:?\s*[\d,]+\s*원?/g, " ")
          .replace(/(^|\s)[\d*,-]{4,}(?=\s|$)/g, " ")
          .replace(/(^|\s)(신한|국민|우리|카카오뱅크|토스|은행|입금|출금|지급|인출)(?=\s|$)/g, " ")
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
