// ============================================================
//  급여·세무 서류 읽기 — 글자 → 종류 · 귀속 · 숫자
// ------------------------------------------------------------
//  세무사 프로그램(급여대장 · 명세서 · 사업소득 지급대장)과 홈택스 서식(신고서 ·
//  납부서 · 접수증 · 원천징수영수증)은 PDF 에 글자 층이 있다. 표가 글자로 풀리면서
//  칸 순서가 흩어지지만(pdf.js 가 줄 단위로 읽는다), 서식마다 늘 같은 자리에
//  같은 말이 온다 — 그 말을 기준으로 숫자를 줍는다.
//
//  정하는 순서:  글자  →  파일 이름  →  폴더 이름(`3월/`)  →  같이 올린 파일
//  폴더를 마지막에 두는 이유 — 회계 폴더는 신고월로 묶이기도 해서(8월 폴더에
//  7월 귀속 명세서) 폴더 달이 귀속과 다를 때가 많다.
//
//  서버(업로드 완료) · 이관 스크립트 · 점검 스크립트가 같은 함수를 쓴다.
//  글자는 돌려주지 않는다 — 주민등록번호가 섞여 있다 (tax-docs.ts 머리말).
// ============================================================

import {
  cadenceOf,
  isPeriodFor,
  quarterOfMonth,
  type TaxDocData,
  type TaxDocKind,
  type TaxPayLine,
  type TaxPayTotal,
  type TaxVatFigures,
  type TaxWhtLine,
} from "./tax-docs";

export interface TaxDocReadInput {
  name: string;
  /** 쪽마다 글자 — 글자 층이 없는 스캔본이면 빈 글자 */
  pages: string[];
  /** 올린 폴더 경로에서 짐작한 달 `2026-10` (`2026/10월/…`) */
  folderMonth?: string;
}

export interface TaxDocGuess {
  kind: TaxDocKind;
  period?: string;
  entity?: string;
  data?: TaxDocData;
  scanned: boolean;
  reason: string;
  /** 귀속을 어디서 정했나 — 글자에서 읽은 것만 같이 올린 파일에 빌려준다 */
  periodSource: TaxPeriodSource;
}

export type TaxPeriodSource = "text" | "name" | "folder" | "sibling" | "none";

// ---- 숫자 ---------------------------------------------------------

const NUM_TOKEN = /^-?\d{1,3}(,\d{3})+$|^-?\d+$/;
const toNum = (s: string) => Number(s.replace(/[\s,]/g, ""));
/** 줄에서 숫자 낱말만 (날짜 `2024-01-01` · `2026.10` 은 빠진다) */
const numTokens = (line: string) => line.split(/\s+/).filter((t) => NUM_TOKEN.test(t)).map(toNum);
/** 납부서처럼 숫자가 한 자씩 띄어 적힌 금액 `1 3 1 , 1 4 0` */
const spacedNum = (s: string) => {
  const t = s.replace(/[\s,]/g, "");
  return /^-?\d+$/.test(t) ? Number(t) : NaN;
};
const pad2 = (s: string | number) => String(s).padStart(2, "0");
const ymd = (y: string, m: string, d: string) => `${y}-${pad2(m)}-${pad2(d)}`;

function lineSplit(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---- 종류 ---------------------------------------------------------

function kindFromText(sq: string): TaxDocKind | undefined {
  if (sq.includes("사업소득지급대장")) return "biz-ledger";
  if (sq.includes("급여대장") && sq.includes("[귀속:")) return "payroll-ledger";
  if (sq.includes("급여명세서")) return "payslip";
  if (sq.includes("부가가치세신고서접수증")) return "vat-receipt";
  if (sq.includes("원천징수이행상황신고서")) return "wht-return";
  if (sq.includes("접수증") && sq.includes("원천징수")) return "wht-receipt";
  // 서식 번호가 가장 믿을 만하다 — 근로 영수증 글자에도 「지급명세서」 가 있다
  if (sq.includes("별지제24호서식(1)")) return "wage-cert";
  if (sq.includes("별지제23호서식(2)") || sq.includes("사업소득원천징수영수증")) return "biz-cert";
  if (sq.includes("국세징수법")) {
    if (sq.includes("부가가치세")) return "vat-bill";
    if (/근로소득세|사업소득세|퇴직소득세|기타소득세/.test(sq)) return "wht-bill";
  }
  if (sq.includes("부가가치세") && sq.includes("과세표준") && sq.includes("신고")) return "vat-return";
  if (sq.includes("지방소득세") && sq.includes("특별징수")) return "local-bill";
  return undefined;
}

function kindFromName(name: string): TaxDocKind | undefined {
  const n = name.replace(/\s+/g, "");
  if (/사업소득지급대장|사업대장/.test(n)) return "biz-ledger";
  if (/급여대장/.test(n)) return "payroll-ledger";
  if (/급여명세/.test(n)) return "payslip";
  if (/인건비.?신고내역/.test(n)) return "payroll-sent";
  if (/^\d{4}지급/.test(n)) return "pay-sheet";
  if (/근로소득원천징수영수증/.test(n)) return "wage-cert";
  if (/사업소득원천징수영수증/.test(n)) return "biz-cert";
  if (/부가가치세신고|부가세신고/.test(n)) return "vat-return";
  if (/접수증/.test(n)) return /부가/.test(n) ? "vat-receipt" : "wht-receipt";
  if (/지방세|지방소득세/.test(n)) return "local-bill";
  if (/국세신고서|원천.*신고서|^\d{1,2}월신고서/.test(n)) return "wht-return";
  if (/국세|원천세납부/.test(n)) return "wht-bill";
  if (/납부서/.test(n) && /부가/.test(n)) return "vat-bill";
  return undefined;
}

/** 상호 — 글자에서 가장 먼저 나오는 것 (근로 영수증 뒤쪽 「종(전) 근무처」 에 다른 회사가 나온다) */
function entityOf(sq: string, name: string): string | undefined {
  const names: [string, RegExp][] = [
    ["네안데르", /주식회사네안데르|\(주\)네안데르|㈜네안데르|네안데르/],
    ["일해라컴퍼니", /일해라컴퍼니|일컴/],
    ["와작홈즈", /와작홈즈|와작/],
  ];
  const first = (s: string) =>
    names
      .map(([label, re]) => ({ label, at: s.search(re) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)[0]?.label;
  return first(sq) ?? first(name.replace(/\s+/g, ""));
}

// ---- 서식별 숫자 ---------------------------------------------------

/** 급여대장 — 사람마다 세 줄(코드·이름·급여 / 입사일·공제합계 / 지급합계·차인지급액), 끝에 합계 */
function readPayrollLedger(text: string): Pick<TaxDocData, "people" | "total"> {
  const lines = lineSplit(text);
  const people: TaxPayLine[] = [];
  let total: TaxPayTotal | undefined;
  const isStart = (l: string) => {
    const t = l.split(/\s+/);
    return t.length >= 3 && /^\d{1,8}$/.test(t[0]) && !NUM_TOKEN.test(t[1]) && t.slice(2).every((x) => NUM_TOKEN.test(x));
  };
  const close = (block: string[]): { gross: number; deduct: number; net: number } | null => {
    const withNums = block.map(numTokens);
    let last = -1;
    for (let i = withNums.length - 1; i >= 0; i--) {
      if (withNums[i].length >= 2) {
        last = i;
        break;
      }
    }
    if (last < 0) return null;
    const [gross, net] = withNums[last].slice(-2);
    const before = last > 0 ? withNums[last - 1] : [];
    const deduct = before.length ? before[before.length - 1] : gross - net;
    return { gross, net, deduct: gross - deduct === net ? deduct : gross - net };
  };

  for (let i = 0; i < lines.length; i++) {
    const total0 = lines[i].match(/^합계\s*\((\d+)명\)/);
    if (total0) {
      const block = lines.slice(i + 1, i + 6).filter((l) => numTokens(l).length > 0 && numTokens(l).length === l.split(/\s+/).length);
      const sums = block.length ? numTokens(block[0]) : [];
      const c = close(block);
      if (c) {
        total = {
          count: Number(total0[1]),
          ...c,
          ...(sums.length >= 3 ? { incomeTax: sums[sums.length - 2], localTax: sums[sums.length - 1] } : {}),
        };
      }
      break;
    }
    if (!isStart(lines[i])) continue;
    const t = lines[i].split(/\s+/);
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && !isStart(lines[j]) && !/^합계\s*\(/.test(lines[j]); j++) block.push(lines[j]);
    const c = close(block);
    if (c) people.push({ code: t[0], name: t[1], ...c });
  }
  return { people, ...(total ? { total } : {}) };
}

/** 급여명세서 한 쪽 — 이름표가 붙어 있어 대장보다 쉽다 */
function readPayslipPage(text: string): (TaxPayLine & { period?: string; payDate?: string }) | null {
  const name = text.match(/사원명\s*:\s*(\S+)/)?.[1];
  const gross = text.match(/지\s*급\s*액\s*계\s+(-?[\d,]+)/)?.[1];
  const net = text.match(/차\s*인\s*지\s*급\s*액\s+(-?[\d,]+)/)?.[1];
  if (!name || gross === undefined || net === undefined) return null;
  const deduct = text.match(/공\s*제\s*액\s*계\s+(-?[\d,]+)/)?.[1];
  const income = text.match(/(?:^|\s)소득세\s+(-?[\d,]+)/m)?.[1];
  const local = text.match(/(?:^|\s)지방소득세\s+(-?[\d,]+)/m)?.[1];
  const p = text.match(/(20\d\d)년\s*(\d\d)월분\s*급여명세서/);
  const d = text.match(/지급일\s*:\s*(20\d\d)\.(\d\d)\.(\d\d)/);
  const g = toNum(gross);
  const n = toNum(net);
  return {
    code: text.match(/사원코드\s*:\s*(\S+)/)?.[1],
    name,
    gross: g,
    net: n,
    deduct: deduct !== undefined ? toNum(deduct) : g - n,
    ...(income !== undefined ? { incomeTax: toNum(income) } : {}),
    ...(local !== undefined ? { localTax: toNum(local) } : {}),
    ...(p ? { period: `${p[1]}-${p[2]}` } : {}),
    ...(d ? { payDate: ymd(d[1], d[2], d[3]) } : {}),
  };
}

/** 사업소득 지급대장 — 사람마다 (번호 코드 이름) 뒤에 귀속년월·지급액·소득세 / 지급년월·지방소득세·차인지급액 */
function readBizLedger(text: string): Pick<TaxDocData, "people" | "total"> {
  const lines = lineSplit(text);
  const people: TaxPayLine[] = [];
  let total: TaxPayTotal | undefined;
  const isStart = (l: string) => {
    const t = l.split(/\s+/);
    return t.length >= 3 && /^\d{1,3}$/.test(t[0]) && /^\d{3,8}$/.test(t[1]) && !NUM_TOKEN.test(t[2]);
  };
  for (let i = 0; i < lines.length; i++) {
    const tot = lines[i].match(/^총\s*계\s+(.*)$/);
    if (tot) {
      const a = numTokens(tot[1]);
      const b = i + 1 < lines.length ? numTokens(lines[i + 1]) : [];
      if (a.length >= 2 && b.length >= 2) {
        const [gross, incomeTax] = a;
        const localTax = b[0];
        const net = b[b.length - 1];
        total = { count: people.length, gross, incomeTax, localTax, net, deduct: gross - net };
      }
      break;
    }
    if (!isStart(lines[i])) continue;
    const t = lines[i].split(/\s+/);
    const tokens: string[] = [];
    for (let j = i + 1; j < lines.length && !isStart(lines[j]) && !/^총\s*계/.test(lines[j]); j++) tokens.push(...lines[j].split(/\s+/));
    // 두 번째 연월(지급년월) 바로 뒤가 지방소득세
    let months = 0;
    let localTax: number | undefined;
    const nums: number[] = [];
    for (const tok of tokens) {
      if (/^20\d\d\.\d\d$/.test(tok)) {
        months++;
        continue;
      }
      if (!NUM_TOKEN.test(tok)) continue;
      if (months >= 2 && localTax === undefined) localTax = toNum(tok);
      nums.push(toNum(tok));
    }
    if (nums.length < 3) continue;
    const gross = nums[0];
    const net = nums[nums.length - 1];
    people.push({
      code: t[1],
      name: t.slice(2).join(" "),
      gross,
      net,
      deduct: gross - net,
      incomeTax: nums[1],
      ...(localTax !== undefined ? { localTax } : {}),
    });
  }
  if (total) total.count = people.length || total.count;
  return { people, ...(total ? { total } : {}) };
}

/** 원천징수이행상황신고서 — 코드 줄(A01 · A10 · A25 · A30 · A99)의 인원 · 총지급액 · 징수세액 · 납부세액 */
function readWhtReturn(text: string): Pick<TaxDocData, "wage" | "biz" | "all" | "payMonth"> & { period?: string } {
  // 인원 · 총지급액 · 징수세액 [· 당월조정환급세액] · 납부세액 — 환급을 당겨 쓴 달은 다섯 칸
  // (2026-05: A10 6 13,970,640 136,000 50,980 85,020). 납부세액은 늘 마지막 칸이다.
  const line = (code: string): TaxWhtLine | undefined => {
    const m = text.match(new RegExp(`\\b${code}[ \\t]+(\\d+(?:[ \\t]+-?[\\d,]+){2,})`));
    if (!m) return undefined;
    const t = numTokens(m[1]);
    const tax = t[2];
    return {
      count: t[0],
      gross: t[1],
      tax,
      paid: t.length >= 4 ? t[t.length - 1] : tax,
      ...(t.length >= 5 ? { adjust: t[3] } : {}),
    };
  };
  const wage = line("A10") ?? line("A01");
  const biz = line("A30") ?? line("A25");
  const all = line("A99");
  // 「② 귀속연월 ③ 지급연월」 칸이 글자로 풀리면 두 줄 연달아 `2026 10`
  const ym = text.match(/(20\d\d)[ \t]+(0[1-9]|1[0-2])\s*\n\s*(20\d\d)[ \t]+(0[1-9]|1[0-2])/);
  return {
    ...(wage ? { wage } : {}),
    ...(biz ? { biz } : {}),
    ...(all ? { all } : {}),
    ...(ym ? { period: `${ym[1]}-${ym[2]}`, payMonth: `${ym[3]}-${ym[4]}` } : {}),
  };
}

/** 국세 납부서 — 쪽마다 한 장(영수증서 + 납부서가 같은 쪽에 두 번 찍힌다) */
function readTaxBill(pages: string[]): Pick<TaxDocData, "items" | "dueDate"> & { year?: string; month?: string; half?: string } {
  const items: { label: string; amount: number }[] = [];
  let dueDate: string | undefined;
  let year: string | undefined;
  let month: string | undefined;
  let half: string | undefined;
  for (const page of pages) {
    const m = page.match(/세목명\s*납부금액\s*\n\s*([^\n]+)/);
    if (m) {
      const label = m[1].replace(/[\d\s,]+$/, "").trim();
      const amount = spacedNum(m[1].slice(label.length));
      if (label && Number.isFinite(amount)) items.push({ label, amount });
    }
    const d = page.match(/납부기한\s*(20\d\d)년\s*(\d\d)월\s*(\d\d)일/);
    if (d && !dueDate) dueDate = ymd(d[1], d[2], d[3]);
    const p = page.match(/연도\s*\/\s*기분\s*(20\d\d)년\s*(?:(\d\d)월|([12])기)/);
    if (p && !year) {
      year = p[1];
      month = p[2];
      half = p[3];
    }
  }
  return { items, ...(dueDate ? { dueDate } : {}), year, month, half };
}

/** 부가세 납부기한 달 → 분기 (7월 25일 기한 = 1기 확정 = Q2) */
function vatQuarterOfDue(due: string): string {
  const y = Number(due.slice(0, 4));
  const m = Number(due.slice(5, 7));
  if (m === 1) return `${y - 1}-Q4`;
  return `${y}-Q${quarterOfMonth(m - 1)}`;
}

function readVatReturn(text: string, sq: string): { vat: TaxVatFigures; period?: string } {
  const vat: TaxVatFigures = {};
  const p = sq.match(/신고기간(20\d\d)년제([12])기\((\d\d)월(\d\d)일~(\d\d)월(\d\d)일\)/);
  let period: string | undefined;
  if (p) {
    vat.from = ymd(p[1], p[3], p[4]);
    vat.to = ymd(p[1], p[5], p[6]);
    period = `${p[1]}-Q${quarterOfMonth(Number(p[5]))}`;
  }
  const pick = (re: RegExp) => {
    const m = text.match(re);
    return m ? toNum(m[1]) : undefined;
  };
  const base = pick(/합\s*계\s*\(9\)\s*(-?[\d,]+)/);
  const salesTax = pick(/㉮\s*(-?[\d,]+)/);
  const buyTax = pick(/㉯\s*(-?[\d,]+)/);
  const payable = pick(/\(30\)\s*(-?[\d,]+)/);
  if (base !== undefined) vat.base = base;
  if (salesTax !== undefined) vat.salesTax = salesTax;
  if (buyTax !== undefined) vat.buyTax = buyTax;
  if (payable !== undefined) vat.payable = payable;
  return { vat, period };
}

function readVatReceipt(sq: string): { vat: TaxVatFigures; period?: string } {
  const vat: TaxVatFigures = {};
  let period: string | undefined;
  const p = sq.match(/신고기간(20\d\d)-(\d\d)-(\d\d)~(20\d\d)-(\d\d)-(\d\d)/);
  if (p) {
    vat.from = ymd(p[1], p[2], p[3]);
    vat.to = ymd(p[4], p[5], p[6]);
    period = `${p[4]}-Q${quarterOfMonth(Number(p[5]))}`;
  }
  const base = sq.match(/과세표준(-?[\d,]+)/);
  const pay = sq.match(/실제납부할세액(-?[\d,]+)/) ?? sq.match(/차가감납부할세액(-?[\d,]+)/);
  const at = sq.match(/접수일시(20\d\d-\d\d-\d\d)/);
  if (base) vat.base = toNum(base[1]);
  if (pay) vat.payable = toNum(pay[1]);
  if (at) vat.filedAt = at[1];
  return { vat, period };
}

/** 사업소득 원천징수영수증 — 「지급 연월일 · 귀속 연월 · 지급총액 · 세율 · 소득세 · 지방소득세 · 계」 줄 */
function readBizCert(pages: string[], fileName: string): { people: TaxPayLine[]; period?: string; payDate?: string } {
  const text = pages[0] ?? "";
  const re = /(20\d\d)\s+(\d\d)\s+(\d\d)\s+(20\d\d)\s+(\d\d)\s+(-?[\d,]+)\s+[\d.]+%\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)/g;
  const rows = [...text.matchAll(re)];
  if (!rows.length) return { people: [] };
  const lastLine = lineSplit(text).pop() ?? "";
  const name = /^[가-힣]{2,5}$/.test(lastLine) ? lastLine : (fileName.match(/^([가-힣]{2,5})/)?.[1] ?? "이름 모름");
  // 한 해치 지급명세서면 줄이 여럿 — 마지막 줄을 귀속으로, 금액은 더한다
  const sum = (i: number) => rows.reduce((n, r) => n + toNum(r[i]), 0);
  const last = rows[rows.length - 1];
  const gross = sum(6);
  const incomeTax = sum(7);
  const localTax = sum(8);
  return {
    people: [{ name, gross, incomeTax, localTax, deduct: incomeTax + localTax, net: gross - incomeTax - localTax }],
    period: `${last[4]}-${last[5]}`,
    payDate: ymd(last[1], last[2], last[3]),
  };
}

/** 근로소득 원천징수영수증 — 이름 · 총급여 · 귀속연도 */
function readWageCert(text: string, sq: string, fileName: string): { people: TaxPayLine[]; period?: string } {
  const name = sq.match(/⑥성명(.+?)⑦/)?.[1] ?? fileName.match(/_([가-힣]{2,5})님?\./)?.[1];
  const gross = text.match(/⑬\s*급\s*여\s+(-?[\d,]+)/)?.[1];
  const year = text.match(/(20\d\d)\.12\.31/)?.[1] ?? fileName.match(/\((20\d\d)\)/)?.[1] ?? fileName.match(/(20\d\d)년\s*귀속/)?.[1];
  const people = name && gross !== undefined ? [{ name, gross: toNum(gross), deduct: 0, net: toNum(gross) }] : [];
  return { people, ...(year ? { period: year } : {}) };
}

// ---- 이름 · 폴더에서 귀속 -------------------------------------------

/** 파일 이름에서 귀속 — `202607` · `(2604)` · `2026Q1` · `3월` · `(2025)` */
function periodFromName(kind: TaxDocKind, name: string, yearHint?: string): string | undefined {
  const n = name.replace(/\s+/g, "");
  const cad = cadenceOf(kind);
  if (cad === "quarter") {
    const q = n.match(/(20\d\d)Q([1-4])/i);
    if (q) return `${q[1]}-Q${q[2]}`;
    const r = n.match(/(20\d\d)(\d\d)~(20\d\d)(\d\d)/);
    if (r) return `${r[3]}-Q${quarterOfMonth(Number(r[4]))}`;
    return undefined;
  }
  if (cad === "year") {
    return n.match(/\((20\d\d)\)/)?.[1] ?? n.match(/(20\d\d)년귀속/)?.[1];
  }
  // MMDD지급 — 앞 넷이 월일이다 (0101 을 2001년 1월로 읽으면 안 된다)
  if (kind === "pay-sheet") {
    const d = n.match(/^(0[1-9]|1[0-2])\d\d지급/);
    return d && yearHint ? `${yearHint}-${d[1]}` : undefined;
  }
  const full = n.match(/(20\d\d)(0[1-9]|1[0-2])(?!\d)/);
  if (full) return `${full[1]}-${full[2]}`;
  // YYMM — `(2604)` · `2604급여명세서` (해는 20~29 만)
  const short = n.match(/\((2\d)(0[1-9]|1[0-2])\)/) ?? n.match(/^(2\d)(0[1-9]|1[0-2])(?=\(|_|[가-힣])/);
  if (short) return `20${short[1]}-${short[2]}`;
  const m = n.match(/(?:^|[^\d])(1[0-2]|0?[1-9])월/);
  if (m && yearHint) return `${yearHint}-${pad2(m[1])}`;
  return undefined;
}

/** 경로 `2026/10월/급여명세/…` → `2026-10` (해가 없으면 hint 의 해) */
export function folderMonthOf(path: string, yearHint?: string): string | undefined {
  const parts = path.normalize("NFC").split("/").slice(0, -1);
  let year = yearHint;
  let month: string | undefined;
  for (const p of parts) {
    const y = p.match(/(?:^|[^\d])(20\d\d)(?:[^\d]|$)/);
    if (y) year = y[1];
    const m = p.match(/^(1[0-2]|0?[1-9])월/);
    if (m) month = pad2(m[1]);
  }
  return year && month ? `${year}-${month}` : undefined;
}

// ---- 한 파일 ------------------------------------------------------

export function readTaxDoc(raw: TaxDocReadInput): TaxDocGuess {
  // macOS 파일 이름은 자모가 풀린 꼴(NFD)이라 「급여대장」 같은 낱말이 안 맞는다
  const input = { ...raw, name: raw.name.normalize("NFC"), pages: raw.pages.map((p) => p.normalize("NFC")) };
  const text = input.pages.join("\n");
  const sq = text.replace(/\s+/g, "");
  // 글자 층이 없는 PDF — 엑셀 · 사진은 애초에 글자를 안 읽으므로 스캔본이라 부르지 않는다
  const isPdf = /\.pdf$/i.test(input.name);
  const scanned = isPdf && sq.length < 20;
  const byText = scanned || !sq ? undefined : kindFromText(sq);
  const kind = byText ?? kindFromName(input.name) ?? "other";
  const reasons: string[] = [byText ? "글자" : kind !== "other" ? "파일 이름" : "종류 모름"];
  const data: TaxDocData = {};
  let period: string | undefined;

  if (sq && !scanned) {
    switch (kind) {
      case "payroll-ledger": {
        Object.assign(data, readPayrollLedger(text));
        const p = sq.match(/\[귀속:(20\d\d)년(\d\d)월\]/);
        const d = sq.match(/\[지급:(20\d\d)년(\d\d)월(\d\d)일\]/);
        if (p) period = `${p[1]}-${p[2]}`;
        if (d) data.payDate = ymd(d[1], d[2], d[3]);
        break;
      }
      case "payslip": {
        const people = input.pages.map(readPayslipPage).filter((x): x is NonNullable<typeof x> => !!x);
        if (people.length) {
          period = people[0].period;
          if (people[0].payDate) data.payDate = people[0].payDate;
          data.people = people.map(({ period: _p, payDate: _d, ...line }) => line);
        }
        break;
      }
      case "biz-ledger": {
        Object.assign(data, readBizLedger(text));
        const p = sq.match(/\((20\d\d)년(\d\d)월\)사업소득지급대장/);
        if (p) period = `${p[1]}-${p[2]}`;
        break;
      }
      case "wht-return": {
        const r = readWhtReturn(text);
        period = r.period;
        delete r.period;
        Object.assign(data, r);
        break;
      }
      case "wht-bill":
      case "vat-bill":
      case "local-bill": {
        const b = readTaxBill(input.pages);
        if (b.items?.length) data.items = b.items;
        if (b.dueDate) data.dueDate = b.dueDate;
        if (kind === "vat-bill") {
          if (b.dueDate) period = vatQuarterOfDue(b.dueDate);
        } else if (b.year && b.month) period = `${b.year}-${b.month}`;
        break;
      }
      case "vat-return": {
        const r = readVatReturn(text, sq);
        data.vat = r.vat;
        period = r.period;
        break;
      }
      case "vat-receipt": {
        const r = readVatReceipt(sq);
        data.vat = r.vat;
        period = r.period;
        break;
      }
      case "biz-cert": {
        const r = readBizCert(input.pages, input.name);
        if (r.people.length) data.people = r.people;
        if (r.payDate) data.payDate = r.payDate;
        period = r.period;
        break;
      }
      case "wage-cert": {
        const r = readWageCert(text, sq, input.name);
        if (r.people.length) data.people = r.people;
        period = r.period;
        break;
      }
      default:
        break;
    }
  }

  let periodSource: TaxPeriodSource = isPeriodFor(kind, period) ? "text" : "none";
  if (periodSource === "none") {
    period = undefined;
    const yearHint = input.folderMonth?.slice(0, 4) ?? input.name.match(/20\d\d/)?.[0];
    const byName = periodFromName(kind, input.name, yearHint);
    if (isPeriodFor(kind, byName)) {
      period = byName;
      periodSource = "name";
      reasons.push("귀속은 파일 이름");
    } else if (input.folderMonth && cadenceOf(kind) === "month") {
      period = input.folderMonth;
      periodSource = "folder";
      reasons.push("귀속은 폴더");
    } else if (input.folderMonth && cadenceOf(kind) === "year") {
      period = input.folderMonth.slice(0, 4);
      periodSource = "folder";
      reasons.push("귀속은 폴더의 해");
    }
  }
  if (scanned) reasons.push("스캔본이라 숫자는 못 읽음");

  return {
    kind,
    ...(period ? { period } : {}),
    ...((): { entity?: string } => {
      const e = entityOf(sq, input.name);
      return e ? { entity: e } : {};
    })(),
    ...(Object.keys(data).length ? { data } : {}),
    scanned,
    reason: reasons.join(" · "),
    periodSource,
  };
}

/**
 * 같이 올린 파일끼리 귀속 빌려주기 — 글자 없는 지방세 납부서가 같은 묶음의 국세
 * 납부서(글자에 「2026년 06월」)와 같은 달이라고 본다. 폴더 달보다 이것이 맞다
 * (7월 폴더의 국세 · 지방세 납부서는 6월 귀속이었다).
 *
 * 빌려주는 쪽: 글자에서 귀속을 읽은 월별 서류. 빌리는 쪽: 귀속을 폴더로 짐작했거나
 * 못 정한 월별 서류 — 파일 이름에 적힌 달(「2월 지방세 신고서」)은 사람이 붙인
 * 것이라 건드리지 않는다. 빌려줄 귀속이 하나로 모이지 않으면(두 달이 섞인 묶음)
 * 아무것도 바꾸지 않는다.
 */
export function shareSiblingPeriod<T extends { kind: TaxDocKind; period?: string; periodSource: TaxPeriodSource; reason: string }>(
  group: T[],
): T[] {
  const lenders = new Set(group.filter((g) => g.periodSource === "text" && cadenceOf(g.kind) === "month").map((g) => g.period!));
  if (lenders.size !== 1) return group;
  const [period] = [...lenders];
  return group.map((g) =>
    (g.periodSource === "folder" || g.periodSource === "none") && cadenceOf(g.kind) === "month" && g.period !== period
      ? { ...g, period, periodSource: "sibling" as const, reason: `${g.reason.replace(/ · 귀속은 폴더/, "")} · 귀속은 같이 올린 서류` }
      : g,
  );
}
