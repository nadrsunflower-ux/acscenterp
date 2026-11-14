// ============================================================
//  세금 고지서 — 전자고지 알림(문자 · 카톡 · 메일) 읽기 · 돈 나가는 날 한 줄로 (계산만)
// ------------------------------------------------------------
//  국세(홈택스 · 손택스)와 지방세(위택스 · 이택스 · 구청)의 전자고지를 받으면 ERP 가 고지서 한 장
//  (neander_fin_tax_notices)으로 남기고, 「돈 나가는 날」 표에 납기 줄을 만들어 3일 전 · 당일에 알린다.
//
//  들어오는 길은 셋이다 (서버: server/tax-notice.ts).
//    · 문자 · 앱 알림 — 회사 전용폰(매크로드로이드)이 은행 문자와 같은 문(api/neander/finance/sms)으로 보낸다.
//      카카오톡 알림톡은 매크로드로이드 「알림 받음」 조건으로 제목 + 내용을 보낸다
//    · 메일 — 위택스 전자송달 메일 등. 재무 아침 점검이 회사 메일함을 훑는다 (pay-mail 과 같은 메일함)
//    · 사람 — ERP 「세금 고지서」 화면에서 직접 넣는다 (알림 문구에 금액 · 납기가 없을 때도 여기서 채운다)
//
//  ⚠️ 국세청 · 위택스 알림 문구는 공개된 양식이 없다. 그래서 문구 하나에 기대지 않고 낱말로 읽는다:
//     「고지 · 납부 · 납기 · 전자송달」 이 있고 국세청 · 홈택스 · 세무서 · 위택스 · 지방세 · 구청 같은
//     보낸 곳이 보이면 고지서로 본다. 금액 · 납기 · 세목 · 사업자를 못 읽어도 고지서는 남긴다 —
//     「고지서가 왔다」 는 사실이 가장 중요하고, 빈 칸은 사람이 채운다(needs).
//  ⚠️ 「납부가 완료되었습니다」 같은 낸 뒤 알림은 고지서가 아니다 — kind: "paid" 로 따로 돌려준다.
// ============================================================

import type { MoneyRule } from "./money-calendar";

export type TaxLevel = "국세" | "지방세";
export type TaxNoticeSource = "sms" | "push" | "mail" | "manual";
export type TaxNoticeState = "open" | "paid" | "dismissed";

export interface TaxNotice {
  id: string;
  level?: TaxLevel;
  /** 세목 (부가가치세 · 종합소득세 · 지방소득세 …) */
  item?: string;
  /** 예정고지 · 중간예납 · 체납 · 독촉 같은 꼬리표 */
  tags?: string[];
  /** 사업장 (네안데르 · 일해라컴퍼니 · 와작홈즈) — 장부의 site 와 같은 글자 */
  site?: string;
  /** 고지서에 적힌 납세자 이름 그대로 */
  payer?: string;
  /** 낼 돈 (원) */
  amount?: number;
  /** 납부기한 (YYYY-MM-DD) */
  dueDate?: string;
  /** 귀속 (2026년 1기 · 2026-07 …) */
  period?: string;
  /** 전자납부번호 */
  payNo?: string;
  /** 세무서 · 구청 */
  office?: string;
  source: TaxNoticeSource;
  /** 받은 문자함 · 메일 문서 id — 같은 알림을 두 번 넣지 않는 열쇠 */
  sourceId?: string;
  /** 보낸 번호 · 주소 · 앱 */
  from?: string;
  /** 알림 원문 (앞 1,500자) */
  raw?: string;
  /** 메모 */
  note?: string;
  receivedAt: number;
  createdAt: number;
  updatedAt?: number;
  updatedBy?: string;
  state: TaxNoticeState;
  /** 사람이 냈음으로 표시한 날 */
  paidDate?: string;
  /** 도착 알림(노션 멘션)을 보냈나 */
  announced?: { at: number; mode: string };
}

export type TaxNoticeInput = Omit<TaxNotice, "id" | "createdAt" | "state"> & { state?: TaxNoticeState };

// ---- 세목 -----------------------------------------------------

interface TaxItemDef {
  name: string;
  level: TaxLevel;
  words: RegExp;
  /** 장부 계정 소분류 — 금액을 모를 때 낸 기록을 찾는 실마리 */
  acctMinor: string[];
}

/** 앞에 있는 것부터 맞춘다 — 「지방소득세」 가 「소득세」 보다, 「종합부동산세」 가 「부동산」 보다 먼저 */
export const TAX_ITEMS: TaxItemDef[] = [
  { name: "지방소득세", level: "지방세", words: /지방\s*소득세/, acctMinor: ["지방소득세(법인)"] },
  { name: "부가가치세", level: "국세", words: /부가\s*가치세|부가세/, acctMinor: ["부가가치세(VAT)"] },
  { name: "종합소득세", level: "국세", words: /종합\s*소득세|종소세/, acctMinor: ["법인세"] },
  { name: "법인세", level: "국세", words: /법인세/, acctMinor: ["법인세"] },
  { name: "원천세", level: "국세", words: /원천\s*(?:세|징수)|근로\s*소득세|사업\s*소득세/, acctMinor: ["원천징수소득세(근로)", "원천징수소득세(사업 3.3%)"] },
  { name: "양도소득세", level: "국세", words: /양도\s*소득세/, acctMinor: [] },
  { name: "종합부동산세", level: "국세", words: /종합\s*부동산세|종부세/, acctMinor: [] },
  { name: "상속·증여세", level: "국세", words: /상속세|증여세/, acctMinor: [] },
  { name: "인지세", level: "국세", words: /인지세/, acctMinor: ["인지세"] },
  { name: "주민세", level: "지방세", words: /주민세/, acctMinor: ["주민세(사업소분)"] },
  { name: "재산세", level: "지방세", words: /재산세/, acctMinor: ["재산세"] },
  { name: "자동차세", level: "지방세", words: /자동차세/, acctMinor: ["자동차세"] },
  { name: "등록면허세", level: "지방세", words: /등록\s*면허세|면허세/, acctMinor: ["등록면허세"] },
  { name: "취득세", level: "지방세", words: /취득세/, acctMinor: ["취득세"] },
];
export const TAX_ITEM_NAMES = TAX_ITEMS.map((t) => t.name);
export const itemDef = (name?: string) => TAX_ITEMS.find((t) => t.name === name);

// ---- 사업자 -----------------------------------------------------

/** 고지서에 나오는 이름 · 사업자번호 앞자리 → 장부의 사업장 이름 */
export const TAX_SITES: { site: string; words: RegExp; bizNo: string }[] = [
  { site: "네안데르", words: /네안데르|neander/i, bizNo: "6838602812" },
  { site: "일해라컴퍼니", words: /일해라/, bizNo: "7151302963" },
  { site: "와작홈즈", words: /와작\s*홈즈/, bizNo: "3261003024" },
];
export const TAX_SITE_NAMES = TAX_SITES.map((s) => s.site);

/** 가린 사업자번호(715130*** · 715-13-*****)도 앞 다섯 자리 이상이 맞으면 그 사업자 */
function siteOfText(text: string): string | undefined {
  const byName = TAX_SITES.find((s) => s.words.test(text));
  if (byName) return byName.site;
  for (const m of text.matchAll(/(\d{3})-?(\d{2})-?([\d*]{5})|\b(\d{5,10})\*+/g)) {
    const digits = (m[4] ?? `${m[1]}${m[2]}${m[3]}`).replace(/\*/g, "");
    if (digits.length < 5) continue;
    const hit = TAX_SITES.filter((s) => s.bizNo.startsWith(digits));
    if (hit.length === 1) return hit[0].site;
  }
  return undefined;
}

// ---- 읽기 -----------------------------------------------------

const ISSUER = /국세청|홈택스|손택스|세무서|위택스|이택스|ETAX|wetax|hometax|지방세|구청|시청|군청|도청|자치구|지방자치단체/i;
const NOTICE_WORD = /고지|납부서|납세서|납기|전자\s*송달|전자\s*고지|독촉|체납|예정\s*고지|중간\s*예납|납부\s*기한|납부\s*하실|납부할\s*세액|부과/;
const PAID_WORD = /납부\s*(?:가\s*)?(?:완료|되었|되셨|처리\s*되)|정상\s*납부|납부\s*결과|납부\s*확인/;
/** 고지서가 아닌 것 — 인증번호 · 신고 안내 · 환급 · 광고 */
const NOT_NOTICE = /인증\s*번호|인증번호|비밀번호|환급금?\s*(?:지급|안내|발생)|신고\s*(?:안내|기간|하세요|하시기)|광고|\(광고\)/;

const KST = 9 * 3600_000;
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;

/** 해가 없는 날짜(11월 27일 · 11.27)는 받은 날 기준 앞쪽 가까운 해 */
function withYear(m: number, d: number, receivedAt: number): string | undefined {
  const base = new Date(receivedAt + KST);
  const y = base.getUTCFullYear();
  if (!validDate(y, m, d)) return undefined;
  const cand = ymd(y, m, d);
  const recv = base.toISOString().slice(0, 10);
  // 받은 날보다 두 달 넘게 앞이면 내년 (12월에 받은 1월 납기)
  return Date.parse(`${cand}T00:00:00Z`) < Date.parse(`${recv}T00:00:00Z`) - 60 * 86_400_000 ? ymd(y + 1, m, d) : cand;
}

const DATE_FULL = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/;
const DATE_SHORT = /(\d{1,2})\s*[.\/월]\s*(\d{1,2})\s*일?/;

function readDue(text: string, receivedAt: number): string | undefined {
  // 「납부기한 · 납기 · 까지」 가까이에 있는 날짜를 먼저
  const near = text.match(/(?:납부\s*기한|납기\s*(?:한|일|내)?|기한)\s*[:：은는]?\s*([^\n]{0,24})/);
  const tries = [near?.[1], text.match(/([^\n]{0,20})\s*까지/)?.[1], text];
  for (const t of tries) {
    if (!t) continue;
    const f = t.match(DATE_FULL);
    if (f && validDate(+f[1], +f[2], +f[3])) return ymd(+f[1], +f[2], +f[3]);
    if (t === text) continue; // 짧은 날짜는 「납기 · 까지」 곁에서만 — 귀속 「7월」 같은 것을 잘못 잡지 않게
    const s = t.match(DATE_SHORT);
    if (s) {
      const d = withYear(+s[1], +s[2], receivedAt);
      if (d) return d;
    }
  }
  return undefined;
}

const toWon = (s: string) => Number(s.replace(/[,\s]/g, ""));

function readAmount(text: string): number | undefined {
  const labelled = text.match(
    /(?:납부\s*(?:할|하실)?\s*(?:세액|금액|총액)|고지\s*(?:세액|금액)|납기\s*내\s*(?:금액|세액)?|합\s*계|총\s*(?:세액|금액)|세\s*액|금\s*액)\s*[:：은는]?\s*(?:금\s*)?(\d[\d,]*)\s*원/,
  );
  if (labelled) return toWon(labelled[1]) || undefined;
  const all = [...text.matchAll(/(\d[\d,]*)\s*원/g)].map((m) => toWon(m[1])).filter((n) => n > 0);
  return all.length ? Math.max(...all) : undefined;
}

export interface TaxNoticeRead {
  kind: "notice" | "paid";
  level?: TaxLevel;
  item?: string;
  tags: string[];
  site?: string;
  payer?: string;
  amount?: number;
  dueDate?: string;
  period?: string;
  payNo?: string;
  office?: string;
}

/**
 * 알림 한 통 → 고지서 (또는 낸 뒤 알림). 세금 알림이 아니면 null.
 * from: 보낸 번호 · 메일 주소 · 앱 이름 (국세청 1588-… · wetax.go.kr · 카카오톡 「국세청」)
 */
export function readTaxNotice(input: { text: string; from?: string; subject?: string; receivedAt: number }): TaxNoticeRead | null {
  const text = [input.subject, input.text].filter(Boolean).join("\n").replace(/\r/g, "").slice(0, 6000);
  const hay = `${input.from ?? ""}\n${text}`;
  if (!ISSUER.test(hay)) return null;
  if (NOT_NOTICE.test(text) && !/고지|독촉|체납/.test(text)) return null;
  const paid = PAID_WORD.test(text);
  if (!paid && !NOTICE_WORD.test(text)) return null;

  const def = TAX_ITEMS.find((t) => t.words.test(text));
  const local = /위택스|이택스|ETAX|지방세|구청|시청|군청|도청/i.test(hay);
  const level: TaxLevel | undefined = def?.level ?? (local ? "지방세" : /국세|홈택스|손택스|세무서/.test(hay) ? "국세" : undefined);
  const tags = [
    /예정\s*고지/.test(text) ? "예정고지" : null,
    /중간\s*예납/.test(text) ? "중간예납" : null,
    /체납/.test(text) ? "체납" : null,
    /독촉/.test(text) ? "독촉" : null,
    /수시\s*(?:부과|고지)/.test(text) ? "수시" : null,
    /정기\s*분?/.test(text) && local ? "정기분" : null,
  ].filter((x): x is string => !!x);
  const payer = text.match(/(?:납세자\s*(?:성명|명|이름)?|성\s*명|상\s*호|납부자)\s*[:：]?\s*([^\n:：]{2,30}?)(?:\s{2,}|\n|$|님)/)?.[1]?.trim();
  const payNo = text.match(/전자\s*납부\s*번호\s*[:：]?\s*([\d-]{8,})/)?.[1];
  const office = text.match(/([가-힣]{1,8}세무서|[가-힣]{1,8}(?:구청|시청|군청|도청))/)?.[1];
  const periodM = text.match(/(20\d{2})\s*년\s*([12])\s*기/) ?? text.match(/귀속\s*(?:연월|년도|연도)?\s*[:：]?\s*(20\d{2})[.\-년\s]*(\d{1,2})?/);
  const period = periodM ? (text.match(/(20\d{2})\s*년\s*([12])\s*기/) ? `${periodM[1]}년 ${periodM[2]}기` : `${periodM[1]}${periodM[2] ? `-${periodM[2].padStart(2, "0")}` : ""}`) : undefined;

  return {
    kind: paid && !/고지서가?\s*(?:도착|발송|송달)/.test(text) ? "paid" : "notice",
    ...(level ? { level } : {}),
    ...(def ? { item: def.name } : {}),
    tags,
    ...(siteOfText(`${payer ?? ""}\n${text}`) ? { site: siteOfText(`${payer ?? ""}\n${text}`) } : {}),
    ...(payer ? { payer } : {}),
    ...(readAmount(text) ? { amount: readAmount(text) } : {}),
    ...(readDue(text, input.receivedAt) ? { dueDate: readDue(text, input.receivedAt) } : {}),
    ...(period ? { period } : {}),
    ...(payNo ? { payNo } : {}),
    ...(office ? { office } : {}),
  };
}

/** 사람이 채워야 할 칸 — 알림 · 화면에 「모름」 으로 보인다 */
export function noticeNeeds(n: Pick<TaxNotice, "amount" | "dueDate" | "site" | "item">): string[] {
  return [!n.dueDate ? "납기" : null, !n.amount ? "금액" : null, !n.site ? "사업자" : null, !n.item ? "세목" : null].filter((x): x is string => !!x);
}

// ---- 이름 · 글 -----------------------------------------------------

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;

/** 「부가가치세 예정고지 (네안데르)」 */
export function noticeLabel(n: Pick<TaxNotice, "item" | "tags" | "site" | "payer" | "level">): string {
  const what = [n.item ?? (n.level ? `${n.level} 고지` : "세금 고지"), ...(n.tags ?? []).filter((t) => t !== "정기분").slice(0, 2)].join(" ");
  return `${what} (${n.site ?? n.payer ?? "사업자 모름"})`;
}

/** 도착 알림 — 노션 멘션 댓글 글 (줄 이름은 따로 보인다) */
export function arrivalText(n: TaxNotice): string {
  const need = noticeNeeds(n).filter((x) => x === "납기" || x === "금액" || x === "사업자");
  return [
    "고지서 도착",
    n.amount ? won(n.amount) : null,
    n.dueDate ? `납기 ${md(n.dueDate)}` : null,
    n.office ?? null,
    need.length ? `${need.join(" · ")} 못 읽음 — ERP 에서 채워 주세요` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---- 돈 나가는 날 한 줄로 -----------------------------------------------------

const DAY = 86_400_000;

/**
 * 고지서 → 돈 나가는 날 규칙(한 번만 오는 날). 납기를 모르면 받은 날에 놓는다(「납기 모름」).
 * 낸 기록 찾기: 금액을 알면 금액 + 사업장(세금이 엉뚱한 계정으로 분류돼도 찾게),
 * 모르면 사업장 + 세목 계정. 찾는 범위는 받은 날부터 납기 뒤 7일까지.
 */
export function noticeRule(n: TaxNotice): MoneyRule | null {
  if (n.state === "dismissed") return null;
  const received = new Date(n.receivedAt + KST).toISOString().slice(0, 10);
  const date = n.dueDate ?? received;
  const def = itemDef(n.item);
  const before = Math.max(3, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${received}T00:00:00Z`)) / DAY) + 3);
  const match = n.amount
    ? { amount: n.amount, ...(n.site ? { site: n.site } : {}) }
    : n.site && def?.acctMinor.length
      ? { site: n.site, acctMinor: def.acctMinor }
      : undefined;
  const note = [
    n.level,
    n.period ? `귀속 ${n.period}` : null,
    n.office,
    n.payNo ? `전자납부번호 ${n.payNo}` : null,
    !n.dueDate ? "납기 모름 — 받은 날에 둠" : null,
    n.note,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: `tax-${n.id.toLowerCase().replace(/[^a-z0-9-]/g, "")}`,
    kind: "세금",
    label: noticeLabel(n),
    day: Number(date.slice(8, 10)),
    once: date,
    // 고지서 납기는 이미 영업일로 적혀 온다. 혹시 휴일이면 법에 따라 다음 날로 밀린다
    shift: "next",
    ...(n.amount ? { amount: n.amount } : {}),
    ...(match ? { match } : {}),
    window: { before, after: 7 },
    ...(note ? { note } : {}),
    ...(n.state === "paid" ? { settled: { date: n.paidDate ?? date, ...(n.amount ? { amount: n.amount } : {}) } } : {}),
  };
}

// ---- 저장 전 다듬기 -----------------------------------------------------

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 화면 · 서버가 받는 고칠 칸 — 모르는 칸은 버린다. null 은 「지움」 */
export function sanitizeNoticePatch(raw: unknown): Partial<Record<keyof TaxNotice, unknown>> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<Record<keyof TaxNotice, unknown>> = {};
  if ("level" in r) out.level = r.level === "국세" || r.level === "지방세" ? r.level : null;
  if ("item" in r) out.item = str(r.item, 40) ?? null;
  if ("site" in r) out.site = TAX_SITE_NAMES.includes(String(r.site)) ? r.site : null;
  if ("payer" in r) out.payer = str(r.payer, 60) ?? null;
  if ("amount" in r) out.amount = Number(r.amount) > 0 ? Math.round(Number(r.amount)) : null;
  if ("dueDate" in r) out.dueDate = isDate(r.dueDate) ? r.dueDate : null;
  if ("period" in r) out.period = str(r.period, 40) ?? null;
  if ("payNo" in r) out.payNo = str(r.payNo, 40) ?? null;
  if ("office" in r) out.office = str(r.office, 40) ?? null;
  if ("note" in r) out.note = str(r.note, 500) ?? null;
  if ("state" in r && (r.state === "open" || r.state === "paid" || r.state === "dismissed")) out.state = r.state;
  if ("paidDate" in r) out.paidDate = isDate(r.paidDate) ? r.paidDate : null;
  if ("tags" in r) out.tags = Array.isArray(r.tags) ? r.tags.map(String).filter(Boolean).slice(0, 5) : null;
  return out;
}
