// ============================================================
//  법인카드 카톡 기록 — 단톡방 내보내기를 거래에 잇는다
// ------------------------------------------------------------
//  카드 명세서에는 결제대행사 이름과 금액밖에 없다 (`KCP_1 10,600원`).
//  무엇을 어디서 샀는지는 결제한 사람이 단톡방에 남긴 한마디에 있다 —
//
//      8.4
//      배너공장
//      아사히 지디 배너
//      17,860
//
//  이 파일은 그 내보내기(csv)를 읽어 거래에 붙인다. 붙은 메모는 거래의
//  `cardMemo` 에 「구매처 / 품목」 한 줄로 남고, 자동분류(classify.ts)가
//  그것을 근거로 삼는다 — 「배너공장 + 배너」 는 46건 중 45건이 같은 계정이었다.
//
//  카카오는 단톡방을 읽어올 방법이 없어서 **사람이 내보내기 파일을 올린다.**
//  내보내기는 늘 방 전체라, 같은 파일을 몇 번 올려도 결과가 같아야 한다 —
//  이미 메모가 붙은 거래는 건드리지 않는다.
//
//  ── 대조 ──
//  **금액이 같고 날짜가 이틀 안.** 카드 거래는 가맹점 이름을 보지 않는다 (명세서에는
//  결제대행사가 찍힌다). 실측 1,365쌍 중 91% 가 같은 날, 9% 가 하루 차이였다.
//  사흘 차이는 절반이 우연이라 받지 않는다.
//
//  통장 거래는 **이름까지 맞아야** 붙인다 (`국세납부` ↔ 「국세 / 원천세」). 카드 명세서가
//  아직 안 올라온 달에는 같은 금액의 이체가 대신 걸린다 — 직원에게 보낸 15,800원에
//  「쿠팡 / 카메라 마운트」 가 붙으면, 나중에 올라온 진짜 카드 결제는 메모를 못 받는다.
//
//  ⚠️ 금액이 우연히 같은 다른 결제에 붙을 수 있다 (쿠팡이츠 46,000원에
//     알리 부품 메모가 붙은 적이 있다). 그래서 메모 근거는 **제안까지만**
//     만들고, 붙은 메모는 검토 대기함에 그대로 보여 사람이 본다.
// ============================================================

import type { FinPaymentMethodDoc } from "./db-types";
import type { FinProjectDoc } from "./project";
import type { FinTransaction } from "./types";

/** 날짜가 이만큼 어긋나도 같은 결제로 본다 (명세서 날짜는 승인일·매입일로 갈린다) */
const MAX_DAY_GAP = 2;
/** 금액으로 보는 범위 — 이보다 작으면 수량·규격일 가능성이 크다 */
const MIN_AMOUNT = 1_000;
const MAX_AMOUNT = 20_000_000;

export interface CardChatEntry {
  /** 메시지마다 같은 값이 나오는 열쇠 — 같은 파일을 다시 올려도 같다 */
  id: string;
  /** 메시지 시각 `YYYY-MM-DD HH:mm:ss` */
  at: string;
  /** 결제일 `YYYY-MM-DD` — 본문에 적힌 날짜, 없으면 메시지 날짜 */
  date: string;
  user: string;
  /** 날짜보다 앞에 적은 꼬리표 — 행사·프로젝트 이름인 경우가 많다 (`Siwf`, `흑석`) */
  tag?: string;
  /** 구매처 (쿠팡 · 배너공장 · 애즈랜드 …) */
  store: string;
  /** 품목 · 용도 */
  item: string;
  /** 본문에 적힌 금액들 — 한 메시지에 결제가 둘인 경우가 있다 */
  amounts: number[];
}

// ---- 읽기 ----------------------------------------------------

/** 따옴표 안의 줄바꿈을 허용하는 CSV 읽기 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuote) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuote = false;
      } else field += c;
    } else if (c === '"') inQuote = true;
    else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

/** 카카오톡 대화 내보내기인가 — 머리글이 `Date,User,Message` 다 */
export const looksLikeKakaoChat = (head: string) => /^﻿?Date,User,Message/.test(head);

/** "7.30" · "7월 30일" 을 메시지 시점 기준 절대 날짜로 */
function resolveDate(msgDate: string, m: number, d: number): string {
  const msgYear = Number(msgDate.slice(0, 4));
  const msgMonth = Number(msgDate.slice(5, 7));
  let y = msgYear;
  // 1월에 "12.31" 을 적으면 작년 것이다
  if (m > msgMonth + 1) y -= 1;
  if (msgMonth === 12 && m === 1) y += 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DATE_LINE = /^(\d{1,2})[./](\d{1,2})\.?(\s*일)?$/;
const DATE_KO = /^(\d{1,2})\s*월\s*(\d{1,2})\s*일$/;
const AMOUNT_ONLY = /^[\d,\s]+원?(\s*\(.*\))?$/;
const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원?/g;

/** 문자 승인 알림의 틀 — 가맹점만 남긴다 (`신한법인승인 4306 09/04 13:32 12,760원 파슬미디어 잔액…`) */
function stripSms(line: string): string {
  return line
    .replace(/\[Web발신\]/g, "")
    .replace(/(신한|국민|KB국민)(법인|카드)?(해외)?승인/g, "")
    .replace(/\b\d{4}\b(?=\s+\d{2}\/\d{2})/g, "")
    .replace(/\d{2}\/\d{2}\s+\d{2}:\d{2}/g, "")
    .replace(/잔액[\d,]+원?/g, "")
    .trim();
}

/** 금액을 걷어낸 글 */
const dropAmounts = (line: string) => line.replace(AMOUNT, " ").replace(/\s+/g, " ").trim();

/** 짧고 고른 글자열 열쇠 (FNV-1a) */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 내보내기(csv) → 구매 기록.
 *
 * 금액이 없는 메시지(사진 · 잡담 · 링크)는 버린다. 한 줄에 `/` 로 이어 쓴
 * 옛 양식(`6월21일/네이버스마트스토어/프린터잉크/44,400원`)도 같은 모양으로 읽는다.
 */
export function parseCardChat(csv: string): CardChatEntry[] {
  const rows = parseCsv(csv);
  const out: CardChatEntry[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 3 || !r[0]) continue;
    const at = r[0];
    const msgDate = at.slice(0, 10);
    const text = (r[2] ?? "").replace(/￼/g, "").trim();
    if (!text || text === "사진" || /^사진 \d+장$/.test(text) || /^https?:/.test(text)) continue;

    const raw = text.includes("\n") || !text.includes("/") ? text.split("\n") : text.split("/");
    const lines = raw.map((l) => stripSms(l.trim())).filter(Boolean);

    // 금액은 문자 알림의 틀을 걷어낸 뒤에 찾는다 — 카드 끝자리(4306)와 잔액이 금액으로 읽히면
    // 엉뚱한 거래에 붙는다
    const amounts = [...lines.join("\n").matchAll(AMOUNT)]
      .map((m) => Number(m[1].replace(/,/g, "")))
      .filter((n) => n >= MIN_AMOUNT && n <= MAX_AMOUNT);
    if (amounts.length === 0) continue;

    // 날짜 줄을 찾는다. 그 앞에 적힌 줄은 꼬리표다 (행사 이름)
    let date = msgDate;
    let dateAt = -1;
    lines.some((l, i) => {
      const m = l.match(DATE_LINE) ?? l.match(DATE_KO);
      if (!m) return false;
      const mo = Number(m[1]);
      const d = Number(m[2]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
      date = resolveDate(msgDate, mo, d);
      dateAt = i;
      return true;
    });
    const tag = dateAt > 0 ? dropAmounts(lines.slice(0, dateAt).join(" ")) : "";
    const body = lines
      .slice(dateAt + 1)
      .filter((l) => !AMOUNT_ONLY.test(l))
      .map(dropAmounts)
      .filter(Boolean);
    if (body.length === 0) continue;

    out.push({
      id: `${at.replace(/\D/g, "")}-${hash(`${r[1]}|${text}`)}`,
      at,
      date,
      user: r[1] ?? "",
      ...(tag ? { tag } : {}),
      store: body[0].slice(0, 40),
      item: body.slice(1).join(" · ").slice(0, 160),
      amounts: [...new Set(amounts)],
    });
  }
  return out;
}

// ---- 메모 한 줄 ----------------------------------------------

/** 거래에 남기는 한 줄 — `[꼬리표] 구매처 / 품목` */
export function memoLineOf(e: Pick<CardChatEntry, "tag" | "store" | "item">): string {
  return `${e.tag ? `[${e.tag}] ` : ""}${e.store}${e.item ? ` / ${e.item}` : ""}`;
}

/** 구매처 이름을 견주기 좋게 — `네이버스마트스토어 플떡랜드` · `네이버페이` 는 모두 `네이버` */
function normStore(s: string): string {
  const t = s.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^네이버|네이버\s*(스마트\s*스토어|스토어|페이)/.test(t)) return "네이버";
  return t.slice(0, 20);
}

/** 한 줄 메모 → 구매처와 품목 낱말 (자동분류가 근거로 쓴다) */
export function memoParts(memo?: string): { store: string; words: string[] } | null {
  if (!memo) return null;
  const text = memo.replace(/^\[[^\]]*\]\s*/, "");
  const cut = text.indexOf(" / ");
  const store = normStore(cut < 0 ? text : text.slice(0, cut));
  if (!store) return null;
  const item = cut < 0 ? "" : text.slice(cut + 3);
  // 품목은 띄어쓰기 없이 이어 쓴다 (`오해원배너` · `박한빈시향지`) — 2~4글자 조각으로 쪼갠다.
  // 조각이 사람 이름이면 한두 달만 나오고 사라진다. 그건 색인 쪽에서 「여러 달에 걸쳐
  // 나온 낱말만」 쓰는 것으로 걸러진다.
  const words = new Set<string>();
  (item.toLowerCase().match(/[가-힣a-z]+/g) ?? []).forEach((w) => {
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= w.length; i++) words.add(w.slice(i, i + n));
  });
  return { store, words: [...words] };
}

// ---- 대조 ----------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export interface CardChatMatch {
  entry: CardChatEntry;
  tx: FinTransaction;
}

export interface CardChatResult {
  /** 새로 짝지은 것 */
  matched: CardChatMatch[];
  /** 이미 메모가 붙어 있던 거래 수 (같은 파일을 다시 올린 경우) */
  already: number;
  /** 짝이 없는 기록 — 명세서가 아직 안 올라왔거나 장부에 없는 결제 */
  unmatched: CardChatEntry[];
}

/**
 * 기록 ↔ 거래 대조. 나간 돈(지출 · 환급)만 본다.
 *
 * 한 기록은 한 거래에만, 한 거래는 한 기록에만 붙는다. 후보가 여럿이면
 * 날짜가 가까운 쪽 → 카드 거래 → 구매처 이름이 거래처에 들어 있는 쪽 순이다.
 * 카드가 아닌 거래는 이름이 맞을 때만 후보가 된다 (파일 머리 주석).
 */
export function matchCardChat(
  entries: CardChatEntry[],
  transactions: FinTransaction[],
  paymentMethods: Pick<FinPaymentMethodDoc, "last4" | "kind">[] = [],
): CardChatResult {
  const isCard = new Set(paymentMethods.filter((p) => p.kind === "card").map((p) => p.last4));
  const taken = new Set(transactions.map((t) => t.cardChatId).filter(Boolean) as string[]);
  const open = entries.filter((e) => !taken.has(e.id));

  const byAmount = new Map<number, CardChatEntry[]>();
  open.forEach((e) =>
    e.amounts.forEach((a) => {
      const list = byAmount.get(a);
      if (list) list.push(e);
      else byAmount.set(a, [e]);
    }),
  );

  const cands: { gap: number; card: number; named: number; tx: FinTransaction; entry: CardChatEntry }[] = [];
  transactions.forEach((t) => {
    if (t.cardMemo || t.cardChatId) return;
    if (t.txType !== "지출" && t.txType !== "환급") return;
    const amount = Math.round(Math.abs(t.gross ?? 0));
    (byAmount.get(amount) ?? []).forEach((entry) => {
      const gap = dayGap(entry.date, t.date);
      if (!(gap <= MAX_DAY_GAP)) return;
      const vendor = squash(t.vendor ?? "");
      const store = squash(entry.store);
      const card = isCard.has(t.last4 ?? "") ? 0 : 1;
      const named = store.length >= 2 && vendor.length >= 2 && (vendor.includes(store) || store.includes(vendor)) ? 0 : 1;
      if (card === 1 && named === 1) return;
      cands.push({ gap, card, named, tx: t, entry });
    });
  });
  cands.sort((a, b) => a.gap - b.gap || a.card - b.card || a.named - b.named);

  const usedTx = new Set<string>();
  const usedEntry = new Set<string>();
  const matched: CardChatMatch[] = [];
  cands.forEach((c) => {
    if (usedTx.has(c.tx.id) || usedEntry.has(c.entry.id)) return;
    usedTx.add(c.tx.id);
    usedEntry.add(c.entry.id);
    matched.push({ entry: c.entry, tx: c.tx });
  });

  return {
    matched,
    already: entries.length - open.length,
    unmatched: open.filter((e) => !usedEntry.has(e.id)),
  };
}

// ---- 프로젝트 ------------------------------------------------

/**
 * 메모가 가리키는 프로젝트. 꼬리표나 품목에 **프로젝트 코드**(`JIMFF` · `FNC` · `금연`)
 * 또는 **이름**(연도를 뗀 `와우 리모델링`)이 적혀 있을 때만 찾는다.
 *
 * 둘 이상 걸리면 더 길게 맞은 쪽이다 — `JIMFF 클리커 스티커` 는 JIMFF 가 아니라
 * JIMFF-CLICKER 다. 취소된 프로젝트는 보지 않는다.
 */
export function projectOfMemo(
  entry: Pick<CardChatEntry, "tag" | "store" | "item">,
  projects: Pick<FinProjectDoc, "code" | "name" | "status">[],
): string | undefined {
  const text = `${entry.tag ?? ""} ${entry.item}`;
  const flat = squash(text);
  let best: { code: string; len: number } | undefined;
  const offer = (code: string, len: number) => {
    if (!best || len > best.len) best = { code, len };
  };
  projects.forEach((p) => {
    if (p.status === "cancelled" || !p.code) return;
    // 이름 — 앞머리 연도를 떼고 통째로 들어 있을 때만 (`와우` 한 낱말로는 걸지 않는다)
    const name = squash(p.name.replace(/^\d{4}\s*/, ""));
    if (name.length >= 4 && flat.includes(name)) offer(p.code, name.length + 1);
    // 코드 — 영문은 낱말 경계를 본다 (`BL` 이 다른 영어 낱말 속에 걸리지 않게)
    const code = p.code.toLowerCase();
    const hit = /^[a-z0-9-]+$/.test(code)
      ? new RegExp(`(^|[^a-z0-9])${code.replace(/[-]/g, "\\-")}([^a-z0-9]|$)`).test(text.toLowerCase())
      : code.length >= 2 && flat.includes(squash(code));
    if (hit) offer(p.code, code.length);
  });
  return best?.code;
}

// ---- 저장 계획 -----------------------------------------------

/** 서버에 보낼 한 줄 — 지울 값은 null (applyFinEdits) */
export interface CardChatPatch {
  id: string;
  patch: Record<string, string | null>;
}

export interface CardChatPlan {
  /** 붙일 것 */
  updates: CardChatPatch[];
  /** 그대로 되돌리는 패치 — 메모를 떼고, 이번에 붙인 프로젝트만 지운다 */
  undo: CardChatPatch[];
  /** 메모를 보고 프로젝트를 새로 지정한 거래 */
  projects: { tx: FinTransaction; code: string; memo: string }[];
}

/**
 * 대조 결과 → 저장할 패치.
 *
 * 분류(계정 · 사업구분 · 상태)는 건드리지 않는다. 메모와, 프로젝트가 **비어 있던**
 * 거래의 프로젝트만 쓴다 — 사람이 정해 둔 프로젝트는 메모와 달라도 그대로 둔다.
 *
 * `engineSigOf` — 자동분류가 붙인 채 아무도 안 고친 거래는 지문을 같이 남겨야 한다.
 * 저장하면 수정 시각이 찍혀서, 지문이 없으면 「사람이 고친 행」 으로 보여 다시 배우지
 * 못한다 (relearn.ts). 그런 거래일 때만 지문을 돌려주는 함수를 받는다.
 */
export function planCardChat(
  matched: CardChatMatch[],
  projects: Pick<FinProjectDoc, "code" | "name" | "status">[],
  engineSigOf: (t: FinTransaction) => string | undefined = () => undefined,
): CardChatPlan {
  const plan: CardChatPlan = { updates: [], undo: [], projects: [] };
  matched.forEach(({ entry, tx }) => {
    const memo = memoLineOf(entry);
    const code = tx.projectCode ? undefined : projectOfMemo(entry, projects);
    const sig = engineSigOf(tx);
    plan.updates.push({
      id: tx.id,
      patch: {
        cardMemo: memo,
        cardChatId: entry.id,
        ...(code ? { projectCode: code } : {}),
        ...(sig ? { engineSig: sig } : {}),
      },
    });
    plan.undo.push({
      id: tx.id,
      patch: { cardMemo: null, cardChatId: null, ...(code ? { projectCode: null } : {}) },
    });
    if (code) plan.projects.push({ tx, code, memo });
  });
  return plan;
}

/** 「명세서를 기다린다」 고 볼 범위 — 가장 최근 기록에서 이만큼 전 달까지 */
const WAITING_MONTHS = 2;

/**
 * 짝 없는 기록 중 **명세서를 기다리는 것** — 그 달 카드 거래가 장부에 한 건도 없다.
 * 카드 명세서를 올린 뒤 같은 파일을 다시 올리면 붙는다. (달 → 건수, 최근 달부터)
 *
 * 최근 두세 달만 본다. 2024-12 · 2025-11 처럼 오래전에 카드 거래 없이 지나간 달은
 * 이제 와서 명세서를 올릴 일이 없다 — 그걸 「기다린다」 고 하면 할 일로 읽힌다.
 */
export function waitingForStatement(
  unmatched: CardChatEntry[],
  transactions: FinTransaction[],
  paymentMethods: Pick<FinPaymentMethodDoc, "last4" | "kind">[],
): { month: string; count: number }[] {
  const isCard = new Set(paymentMethods.filter((p) => p.kind === "card").map((p) => p.last4));
  const loaded = new Set<string>();
  transactions.forEach((t) => {
    if (isCard.has(t.last4 ?? "")) loaded.add((t.date ?? "").slice(0, 7));
  });
  const latest = unmatched.reduce((m, e) => (e.date > m ? e.date : m), "");
  if (!latest) return [];
  const d = new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1 - WAITING_MONTHS, 1));
  const from = d.toISOString().slice(0, 7);
  const count = new Map<string, number>();
  unmatched.forEach((e) => {
    const m = e.date.slice(0, 7);
    if (m < from || loaded.has(m)) return;
    count.set(m, (count.get(m) ?? 0) + 1);
  });
  return [...count.entries()].map(([month, n]) => ({ month, count: n })).sort((a, b) => (a.month < b.month ? 1 : -1));
}
