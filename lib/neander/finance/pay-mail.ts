// ============================================================
//  결제 알림 메일 → 카드 거래 메모 — 명세서가 말해 주지 않는 「무엇을 샀나」
// ------------------------------------------------------------
//  카드 명세서의 거래처는 결제대행사(KCP · 토스페이먼츠 · 헥토파이낸셜 · 이지페이)일 때가
//  많다. 그래서 자동분류가 「무엇을 샀나」 를 모른 채 대기함에 넘긴다. 그런데 같은 결제의
//  알림 메일이 ERP 메일함에 이미 들어와 있다 — 상점 · 품목 · 금액 · 승인 시각 · 카드사가
//  본문에 그대로 있다 (2026-09-22 받은메일함의 결제 알림 KCP 32 · 쿠팡 25 · 토스페이먼츠 16).
//
//  이 파일은 그 메일을 읽고(parsePayMail) 카드 거래에 짝짓는다(matchPayMails).
//    · 같은 금액 · 승인일 ±1일 · 카드사가 맞는 카드 거래가 **하나뿐일 때만**
//    · 해외 결제(달러 영수증)는 금액 대신 카드 뒷자리 · 상점 이름 · ±2일로
//    · 이미 카드 메모가 붙은 거래는 건드리지 않는다 (단톡방 기록이 먼저다)
//  붙이는 메모는 단톡방 카드 기록과 같은 모양이라(`[메일] 상점 / 품목`, card-chat.ts)
//  자동분류가 그대로 근거로 쓴다 — 제안까지만 (classify.ts 의 카드 메모 근거).
//
//  메일 본문은 서버만 읽는다 (server/pay-mail.ts). 여기는 글자를 받아 읽는 일만 한다.
//  형식은 정규식으로 읽는다 — 정해진 양식이라 모델을 부를 필요가 없고, 메일 본문을
//  밖으로 보내지도 않는다.
// ============================================================

import { netAmount, type FinTransaction } from "./types";
import type { FinPaymentMethodDoc } from "./db-types";
import { bankOfMethod } from "./import-slots";

export interface PayMailInput {
  id: string;
  fromAddress: string;
  fromName?: string;
  subject: string;
  /** 본문 글자 (html 이면 태그를 걷어낸 것) */
  text: string;
  /** 받은 시각 (ms) */
  date: number;
}

export interface PayMailRead {
  mailId: string;
  /** 결제를 처리한 곳 — KCP · 토스페이먼츠 · 이지페이 · 헥토 · 쿠팡 · 해외 영수증 */
  pg: string;
  /** 산 곳 */
  merchant: string;
  /** 산 것 (있으면) */
  item?: string;
  amount: number;
  currency: "KRW" | "USD";
  /** 승인일 `YYYY-MM-DD` */
  date: string;
  approvalNo?: string;
  /** 카드사 — 신한 · 국민 … */
  issuer?: string;
  /** 주문한 사람 (가려지지 않았을 때) */
  buyer?: string;
  /** 카드 뒷 4자리 (해외 영수증에만) */
  cardLast4?: string;
}

const num = (s?: string) => (s ? Number(s.replace(/[^\d.]/g, "")) : NaN);
const pad = (n: string | number) => String(n).padStart(2, "0");
const ymd = (y: string, m: string, d: string) => `${y}-${pad(m)}-${pad(d)}`;
const clean = (s?: string) => (s ?? "").replace(/\s+/g, " ").replace(/\[https?:[^\]]*\]/g, "").trim();
/**
 * 다음 칸의 이름에서 자른다 — 양식이 조금씩 달라 「상품명 … 사이트주소 …」 처럼 다음 칸이
 * 이어 붙는다. 품목 · 상점 글자에만 쓴다.
 */
const LABELS = /\s*(?:사이트\s?주소|고객\s?문의|결제일시|결제수단|결제금액|결제카드|승인번호|상품금액|연락처|할부|구매자명|주문번호|https?:\/\/|www\.).*$/;
const cut = (s?: string) => clean(s).replace(LABELS, "").trim();
const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

const ISSUERS = ["신한", "국민", "KB", "삼성", "현대", "롯데", "하나", "우리", "비씨", "BC", "농협", "NH", "씨티", "카카오", "토스"];
const issuerOf = (s?: string) => {
  if (!s) return undefined;
  const hit = ISSUERS.find((x) => s.toUpperCase().includes(x.toUpperCase()));
  if (!hit) return undefined;
  return hit === "KB" ? "국민" : hit === "BC" ? "비씨" : hit === "NH" ? "농협" : hit;
};
/** 가려진 이름(유*영)은 쓰지 않는다 */
const buyerOf = (s?: string) => (s && !s.includes("*") ? s.replace(/님$/, "").trim() : undefined);

const MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

/** 결제 알림이면 읽고, 아니면 null */
export function parsePayMail(m: PayMailInput): PayMailRead | null {
  const from = m.fromAddress.toLowerCase();
  const t = m.text.replace(/\s+/g, " ");
  const base = { mailId: m.id, currency: "KRW" as const };

  // NHN KCP — 「47dc사진도매에서 2026년 10월 07일 15시 49분 결제하신 내역 … 결제금액 31,500 원 카드종류 신한카드 … 승인번호 37381619」
  if (from.endsWith("kcp.co.kr")) {
    const head = t.match(/(.+?)에서 (\d{4})년 (\d{1,2})월 (\d{1,2})일 \d{1,2}시 \d{1,2}분 결제하신/);
    const amount = num(t.match(/결제금액\s*([\d,]+)\s*원/)?.[1]);
    if (!head || !Number.isFinite(amount)) return null;
    const merchant = clean(m.subject.match(/NHN KCP - (.+?)의 결제/)?.[1] ?? head[1].split(" ").pop());
    return {
      ...base,
      pg: "KCP",
      merchant,
      item: cut(t.match(/상품명\s*(.+?)\s*(?:결제|주문|구매|할부|$)/)?.[1]) || undefined,
      amount,
      date: ymd(head[2], head[3], head[4]),
      approvalNo: t.match(/승인번호\s*(\d+)/)?.[1],
      issuer: issuerOf(t.match(/카드종류\s*(\S+)/)?.[1]),
      buyer: buyerOf(t.match(/주문자명\s*(\S+)/)?.[1]),
    };
  }

  // 토스페이먼츠 — 「구매상품고급지명함 외 1건결제금액17,900원 … 결제카드신한MASTER … 결제일시2026/10/07 15:47:48승인번호37356811 … 판매자(주)성원애드피아」
  if (from.endsWith("tosspayments.com")) {
    const amount = num(t.match(/결제금액\s*([\d,]+)\s*원/)?.[1]);
    const when = t.match(/결제일시\s*(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
    if (!when || !Number.isFinite(amount)) return null;
    const merchant = clean(m.subject.match(/님, (.+?)에서 결제한/)?.[1] ?? t.match(/판매자\s*([^\[]+?)\s*(?:\[|상품문의|$)/)?.[1]);
    return {
      ...base,
      pg: "토스페이먼츠",
      merchant,
      item: cut(t.match(/구매상품\s*(.+?)\s*결제금액/)?.[1]) || undefined,
      amount,
      date: ymd(when[1], when[2], when[3]),
      approvalNo: t.match(/승인번호\s*(\d+)/)?.[1],
      issuer: issuerOf(t.match(/결제카드\s*(\S+?)(?:할부|$)/)?.[1]),
    };
  }

  // 한국정보통신 이지페이 — 「상품명 아오란 캠핑웨건 … 결제일시 2026/10/07 22:47 … 승인번호 42414404 결제기관 신한 상품금액 29,800원 … 상호 쿠팡(주)」
  if (from.endsWith("easypay.co.kr")) {
    const amount = num(t.match(/(?:상품금액|결제금액|승인금액)\s*([\d,]+)\s*원/)?.[1]);
    const when = t.match(/결제일시\s*(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
    if (!when || !Number.isFinite(amount)) return null;
    return {
      ...base,
      pg: "이지페이",
      merchant: cut(t.match(/상호\s*(.+?)\s*(?:사이트|연락처|$)/)?.[1] ?? m.subject.match(/님, (.+?)에서/)?.[1]),
      item: cut(t.match(/상품명\s*(.+?)\s*결제일시/)?.[1]) || undefined,
      amount,
      date: ymd(when[1], when[2], when[3]),
      approvalNo: t.match(/승인번호\s*(\d+)/)?.[1],
      issuer: issuerOf(t.match(/결제기관\s*(\S+)/)?.[1]),
      buyer: buyerOf(t.match(/구매자명\s*(\S+)/)?.[1]),
    };
  }

  // 헥토파이낸셜 — 제목 「드림애드컴(배너공장닷컴)에서 결제하신 내역입니다.」, 본문은 표라 글자를 넓게 본다
  if (from.endsWith("hecto.co.kr")) {
    const amount = num(t.match(/(?:결제금액|승인금액|거래금액)\s*:?\s*([\d,]+)\s*원/)?.[1]);
    const when = t.match(/(?:결제일시|승인일시|거래일시)\s*:?\s*(\d{4})[/.-년 ]+(\d{1,2})[/.-월 ]+(\d{1,2})/);
    if (!Number.isFinite(amount)) return null;
    return {
      ...base,
      pg: "헥토",
      merchant: clean(m.subject.match(/^(.+?)에서 결제하신/)?.[1] ?? m.fromName),
      item: cut(t.match(/(?:상품명|상품정보)\s*:?\s*(.+?)\s*(?:결제|승인|거래|구매|$)/)?.[1]) || undefined,
      amount,
      date: when ? ymd(when[1], when[2], when[3]) : kstDate(m.date),
      approvalNo: t.match(/승인번호\s*:?\s*(\d+)/)?.[1],
      issuer: issuerOf(t.match(/(?:카드사|카드종류|결제카드)\s*:?\s*(\S+)/)?.[1]),
    };
  }

  // 쿠팡 주문 — 「구매상세내역 … 판매자 아오란 캠핑웨건 …, 1개 37,700원 1 37,700원 … 신한카드카드 / 일시불 29,800원 총 결제금액 29,800원」
  if (from.endsWith("coupang.com") && /주문/.test(m.subject)) {
    const amount = num(t.match(/총 결제금액\s*([\d,]+)\s*원/)?.[1]);
    if (!Number.isFinite(amount)) return null;
    const item = cut(t.match(/구매금액\s*판매자\s*(.+?)\s+[\d,]+원\s+\d+\s+[\d,]+원/)?.[1]);
    return {
      ...base,
      pg: "쿠팡",
      merchant: "쿠팡",
      item: item || undefined,
      amount,
      date: kstDate(m.date),
      issuer: issuerOf(t.match(/(\S+)카드\s*\/\s*(?:일시불|\d+개월)/)?.[1]),
    };
  }

  // 해외 영수증 (Stripe 양식) — 「Receipt from OpenRouter, Inc … Amount paid $105.50 Date paid October 19, 2026 … Payment method - 3513」
  const usd = t.match(/Amount paid\s*\$\s*([\d,.]+)/i);
  if (usd) {
    const when = t.match(/Date paid\s*([A-Za-z]+) (\d{1,2}), (\d{4})/);
    const month = when ? MONTHS[when[1].toLowerCase()] : undefined;
    return {
      ...base,
      pg: "해외 영수증",
      currency: "USD",
      // 보낸 사람 이름이 곧 상점이다 (OpenRouter, Inc · Grok xAI). 없을 때만 본문의 「Receipt from …」
      merchant: clean(m.fromName) || clean(t.match(/Receipt from\s*(.{2,40}?)\s*Receipt\s*#/i)?.[1]) || "해외 결제",
      amount: num(usd[1]),
      date: when && month ? ymd(when[3], month, when[2]) : kstDate(m.date),
      cardLast4: t.match(/Payment method\s*[-–]?\s*(\d{4})/i)?.[1],
    };
  }
  return null;
}

/** 같은 결제의 알림이 두 통(이지페이 + 쿠팡 주문) 오면 하나로 — 품목이 있는 쪽을 남긴다 */
export function dedupeReads(reads: PayMailRead[]): PayMailRead[] {
  const by = new Map<string, PayMailRead>();
  reads.forEach((r) => {
    const k = r.approvalNo ? `a:${r.approvalNo}` : `${r.currency}:${r.amount}:${r.date}`;
    const cur = by.get(k);
    if (!cur || (!cur.item && r.item)) by.set(k, r);
  });
  // 승인번호가 있는 것과 없는 것(쿠팡 주문)이 같은 결제면 한 번만 쓰이게 금액 · 날짜로 한 번 더
  const out = new Map<string, PayMailRead>();
  [...by.values()].forEach((r) => {
    const k = `${r.currency}:${r.amount}:${r.date}:${r.merchant.replace(/\(주\)|㈜|\s/g, "")}`;
    const cur = out.get(k);
    if (!cur || (!cur.item && r.item) || (!cur.approvalNo && r.approvalNo)) out.set(k, { ...(cur ?? {}), ...r, item: r.item ?? cur?.item });
  });
  return [...out.values()];
}

/** 카드 거래에 남길 한 줄 — 단톡방 기록과 같은 모양 */
export const memoOfRead = (r: PayMailRead) =>
  `[메일] ${r.merchant}${r.item ? ` / ${r.item.length > 60 ? `${r.item.slice(0, 60)}…` : r.item}` : ""}`;

export interface PayMailMatch {
  txId: string;
  read: PayMailRead;
  memo: string;
}

/** 카드사 이름 — 결제수단 마스터의 카드사 (import-slots.ts) */
const issuerOfMethod = (p: FinPaymentMethodDoc) => {
  const bank = bankOfMethod(p);
  return bank === "shinhan-card" ? "신한" : bank === "kb-card" ? "국민" : undefined;
};

const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const squash = (s?: string) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * 읽은 알림을 카드 거래에 짝짓는다 — 맞는 거래가 하나뿐일 때만. 한 거래에 알림 둘이
 * 맞으면(같은 날 같은 금액 두 번) 둘 다 버린다.
 */
export function matchPayMails(reads: PayMailRead[], transactions: FinTransaction[], paymentMethods: FinPaymentMethodDoc[]): PayMailMatch[] {
  const cards = new Map(paymentMethods.filter((p) => p.kind === "card").map((p) => [p.last4, p]));
  const pool = transactions.filter((t) => t.txType === "지출" && t.last4 && cards.has(t.last4) && !t.cardMemo);
  const picks = new Map<string, PayMailMatch[]>();
  reads.forEach((r) => {
    const hits = pool.filter((t) => {
      const pm = cards.get(t.last4!)!;
      if (r.currency === "USD") {
        if (r.cardLast4 && r.cardLast4 !== t.last4) return false;
        const word = squash(r.merchant).slice(0, 6);
        return dayGap(t.date, r.date) <= 2 && word.length >= 3 && squash(t.vendor).includes(word);
      }
      if (netAmount(t) !== r.amount && t.gross !== r.amount) return false;
      if (dayGap(t.date, r.date) > 1) return false;
      const iss = issuerOfMethod(pm);
      if (r.issuer && iss && r.issuer !== iss) return false;
      if (r.buyer && !(pm.alias ?? "").includes(r.buyer) && pool.some((x) => x !== t && (cards.get(x.last4!)?.alias ?? "").includes(r.buyer!))) return false;
      return true;
    });
    if (hits.length !== 1) return;
    const m = { txId: hits[0].id, read: r, memo: memoOfRead(r) };
    picks.set(hits[0].id, [...(picks.get(hits[0].id) ?? []), m]);
  });
  return [...picks.values()].filter((list) => list.length === 1).map((list) => list[0]);
}

/** html 메일을 글자로 — 태그 · 스타일을 걷어낸다 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|tr|td|th|li|h\d)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
