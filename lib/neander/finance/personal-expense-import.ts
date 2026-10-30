import * as XLSX from "xlsx";
import type { WorkBook, WorkSheet } from "xlsx";
import type { FinAccountDoc } from "./db-types";
import type { FinProjectDoc } from "./project";
import type { FinTransaction } from "./types";
import type { ExpenseClaimRow } from "./expense-claims";

export interface PersonalExpenseParseResult {
  rows: ExpenseClaimRow[];
  warnings: string[];
  errors: { rowNo: number; message: string }[];
  declaredCount?: number;
  declaredTotal?: number;
  actualTotal: number;
  from?: string;
  to?: string;
}

export interface SuggestedPersonalExpenseRow extends ExpenseClaimRow {
  duplicateCandidates?: { id: string; date: string; vendor?: string; gross: number; reason?: string }[];
  warnings?: string[];
}

const text = (v: unknown) => v === null || v === undefined ? "" : String(v).trim();
const norm = (v: unknown) => text(v).normalize("NFC").toLowerCase().replace(/[\s_()[\]·:：-]/g, "");
const moneyText = (n: number) => n.toLocaleString("ko-KR");
const aliases = {
  date: ["이용일자", "이용일", "사용일자", "사용일", "거래일자", "거래일", "승인일자", "날짜"],
  vendor: ["이용가맹점", "이용가맹점명", "가맹점명", "사용처", "거래처", "가맹점"],
  gross: ["이용금액", "사용금액", "승인금액", "결제금액", "금액", "원금액", "청구금액"],
  payment: ["이용카드", "카드명", "결제수단", "카드번호", "카드"],
  account: ["계정", "계정과목", "계정분류", "계정소분류"],
  project: ["프로젝트명", "프로젝트", "프로젝트코드"],
  note: ["메모", "비고", "사용목적"],
  major: ["사업대분류", "사업구분"],
  minor: ["사업소분류"],
  type: ["거래유형", "유형", "취소구분"],
  principal: ["원금"],
  fee: ["수수료", "해외이용수수료"],
  payer: ["결제자", "대납자", "직원"],
} as const;
type Column = keyof typeof aliases;
type Header = { sheet: WorkSheet; name: string; data: unknown[][]; row: number; columns: Partial<Record<Column, number>> };

function findHeaders(wb: WorkBook): Header[] {
  const found: Header[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r > 100_000 || range.e.c > 300) continue;
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    for (let row = 0; row < Math.min(data.length, 60); row++) {
      const labels = data[row].map((v) => norm(v).replace(/원$/, ""));
      const columns: Header["columns"] = {};
      for (const key of Object.keys(aliases) as Column[]) {
        const index = labels.findIndex((label) => aliases[key].some((a) => label === norm(a)));
        if (index >= 0) columns[key] = index;
      }
      if (columns.date === undefined || columns.vendor === undefined || columns.gross === undefined) continue;
      // 카드 명세서의 두 줄 머리글(이번 달 결제금액 / 원금·수수료).
      for (let next = row; next <= Math.min(row + 2, data.length - 1); next++) {
        for (const key of ["principal", "fee"] as const) {
          const index = data[next].findIndex((v) => aliases[key].some((a) => norm(v) === norm(a)));
          if (index >= 0) columns[key] = index;
        }
      }
      found.push({ sheet, name, data, row, columns });
      break;
    }
  }
  return found;
}

/** 자동 법인카드 적재로 보내면 안 되는, 용도 메모가 있는 개인 경비 양식. */
export function looksLikePersonalExpenseWorkbook(wb: WorkBook): boolean {
  return findHeaders(wb).some(({ columns }) =>
    columns.payer !== undefined || (columns.account !== undefined && columns.project !== undefined));
}

function parseDate(value: unknown): string | null {
  let year: number, month: number, day: number;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    year = value.getFullYear(); month = value.getMonth() + 1; day = value.getDate();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const p = XLSX.SSF.parse_date_code(value);
    if (!p) return null;
    year = p.y; month = p.m; day = p.d;
  } else {
    const m = text(value).match(/^(\d{2}|\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|$)/);
    if (!m) return null;
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2199 || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function amount(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  let s = text(value);
  if (!s || /[$€¥A-Za-z]/.test(s)) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[₩원,\s()]/g, "");
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s) * (negative ? -1 : 1);
  return Number.isSafeInteger(n) ? n : null;
}

function paymentLabel(value: unknown): string | undefined {
  const s = text(value);
  if (!s) return undefined;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 12 ? `개인카드 …${digits.slice(-4)}` : s.slice(0, 100);
}

/** 명세서에 실제 기재된 거래만 읽는다. 합계·소계로 누락된 거래를 만들지 않는다. */
export function parsePersonalExpenseWorkbook(wb: WorkBook): PersonalExpenseParseResult {
  const out: PersonalExpenseParseResult = { rows: [], warnings: [], errors: [], actualTotal: 0 };
  const headers = findHeaders(wb);
  const header = headers[0];
  if (!header) {
    out.errors.push({ rowNo: 0, message: "사용일·사용처·금액 열을 찾지 못했습니다. 개인카드 명세서 또는 사용일/사용처/금액 양식을 올려 주세요." });
    return out;
  }
  if (headers.length > 1) out.warnings.push(`여러 내역 시트 중 「${header.name}」를 읽었습니다. 다른 시트는 별도로 올려 주세요.`);
  const get = (row: unknown[], key: Column) => header.columns[key] === undefined ? undefined : row[header.columns[key]!];
  for (let i = header.row + 1; i < header.data.length; i++) {
    const raw = header.data[i];
    if (!raw.some((v) => text(v))) continue;
    const date = parseDate(get(raw, "date"));
    const label = raw.map(text).join(" ");
    if (!date && /합\s*계|소\s*계/.test(label)) {
      const count = label.match(/(\d[\d,]*)\s*건/);
      if (count) out.declaredCount = Number(count[1].replace(/,/g, ""));
      const principal = amount(get(raw, "principal"));
      const fee = amount(get(raw, "fee"));
      const gross = amount(get(raw, "gross"));
      if (principal !== null) out.declaredTotal = principal + (fee ?? 0);
      else if (gross !== null) out.declaredTotal = gross;
      continue;
    }
    const vendor = text(get(raw, "vendor"));
    const gross = amount(get(raw, "gross"));
    // 두 번째 머리글이나 안내문은 거래가 아니다.
    if (!date && !vendor && gross === null) continue;
    if (!date) { out.errors.push({ rowNo: i + 1, message: "사용일을 읽지 못했습니다." }); continue; }
    if (!vendor) { out.errors.push({ rowNo: i + 1, message: "사용처가 없습니다." }); continue; }
    if (gross === null || gross === 0) { out.errors.push({ rowNo: i + 1, message: "0원이 아닌 원화 정수 금액이 필요합니다. 외화 승인액은 원화 청구액을 확인해 주세요." }); continue; }
    const accountText = text(get(raw, "account"));
    const projectText = text(get(raw, "project"));
    const rawType = text(get(raw, "type"));
    const isRefund = gross < 0 || /취소|환급|환불/.test(rawType);
    const fee = amount(get(raw, "fee"));
    const memo = [text(get(raw, "note")), fee !== null && fee !== 0 && `이용금액에 포함된 수수료 ${moneyText(Math.abs(fee))}원`].filter(Boolean).join(" · ");
    out.rows.push({
      rowNo: i + 1, date, vendor, gross: Math.abs(gross), txType: isRefund ? "환급" : "지출",
      paymentLabel: paymentLabel(get(raw, "payment")), accountText: accountText || undefined,
      projectText: projectText || undefined, bizMajor: text(get(raw, "major")) || undefined,
      bizMinor: text(get(raw, "minor")) || undefined, note: memo || undefined,
    });
  }
  out.actualTotal = out.rows.reduce((sum, r) => sum + (r.txType === "환급" ? -r.gross : r.gross), 0);
  const dates = out.rows.map((r) => r.date).sort();
  out.from = dates[0]; out.to = dates[dates.length - 1];
  if (out.declaredCount !== undefined && out.declaredCount !== out.rows.length)
    out.warnings.push(`명세서에는 ${out.declaredCount}건으로 적혀 있지만 실제로 읽힌 내역은 ${out.rows.length}건입니다. 누락된 거래를 임의로 추가하지 않습니다.`);
  if (out.declaredTotal !== undefined && out.declaredTotal !== out.actualTotal)
    out.warnings.push(`명세서 합계 ${moneyText(out.declaredTotal)}원과 내역 합계 ${moneyText(out.actualTotal)}원이 ${moneyText(Math.abs(out.declaredTotal - out.actualTotal))}원 다릅니다. 거래별 증빙을 확인해 주세요.`);
  if (new Set(out.rows.map((r) => r.date.slice(0, 7))).size > 1)
    out.warnings.push("여러 달의 사용 내역입니다. 명세서 발행월이 아니라 각 사용일의 비용으로 등록합니다.");
  return out;
}

function vendorKey(v: string | undefined): string {
  return norm(v).replace(/주식회사|사단법인|결제대행|kcp|㈜/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}
function projectKeys(p: FinProjectDoc): string[] {
  return [p.code, p.name, p.client].filter((x): x is string => !!x).map((x) => norm(x).replace(/^20\d{2}년?/, ""));
}
function matchesProject(raw: string, p: FinProjectDoc): boolean {
  const key = norm(raw).replace(/^신규프로젝트/, "").replace(/^20\d{2}년?/, "");
  return !!key && projectKeys(p).includes(key);
}

/** 원본 메모를 우선하고, 비어 있는 계정은 확정 원장 이력으로 제안한다. */
export function suggestPersonalExpenseRows(
  rows: ExpenseClaimRow[], accounts: FinAccountDoc[], projects: FinProjectDoc[], transactions: FinTransaction[],
): { rows: SuggestedPersonalExpenseRow[] } {
  const expenseAccounts = accounts.filter((a) => a.txType === "지출" && a.active !== false);
  const byDateAmount = new Map<string, FinTransaction[]>();
  for (const t of transactions) {
    if (!['지출', '환급'].includes(t.txType) || t.personalUse) continue;
    const key = `${t.date}|${t.txType}|${t.gross - (t.adjust || 0)}`;
    byDateAmount.set(key, [...(byDateAmount.get(key) ?? []), t]);
  }
  return { rows: rows.map((original) => {
    const row: SuggestedPersonalExpenseRow = { ...original };
    const warnings: string[] = [];
    const memo = norm(row.accountText);
    if (!row.bizMajor) row.bizMajor = memo.startsWith("공용") ? "공용" : memo.startsWith("b2b") ? "B2B" : memo.startsWith("b2c") ? "B2C" : "공용";
    if (!row.bizMinor && row.bizMajor === "공용") row.bizMinor = "공용";
    const projectMatches = row.projectText ? projects.filter((p) => p.status !== "cancelled" && matchesProject(row.projectText!, p)) : [];
    if (projectMatches.length === 1) {
      row.projectCode = projectMatches[0].code;
      if (!row.bizMinor) row.bizMinor = projectMatches[0].bizMinor;
    } else if (row.projectText) warnings.push(`원본 프로젝트 「${row.projectText}」와 일치하는 프로젝트를 하나로 정하지 못했습니다. 메모는 보관하며 프로젝트 선택은 비워 둡니다.`);
    let chosen = expenseAccounts.filter((a) => memo && memo.endsWith(norm(a.minor)));
    if (chosen.length !== 1) {
      const history = transactions.filter((t) => t.txType === "지출" && t.status === "confirmed" && !t.personalUse && vendorKey(t.vendor) === vendorKey(row.vendor))
        .sort((a, b) => b.date.localeCompare(a.date));
      const recent = history.find((t) => expenseAccounts.some((a) => a.major === t.acctMajor && a.mid === t.acctMid && a.minor === t.acctMinor));
      if (recent) chosen = expenseAccounts.filter((a) => a.major === recent.acctMajor && a.mid === recent.acctMid && a.minor === recent.acctMinor);
    }
    if (chosen.length === 1) Object.assign(row, { acctMajor: chosen[0].major, acctMid: chosen[0].mid, acctMinor: chosen[0].minor });
    else warnings.push("비용 계정을 선택해 주세요.");
    if (!row.bizMinor) row.bizMinor = row.bizMajor === "공용" ? "공용" : "기타";
    const candidates = (byDateAmount.get(`${row.date}|${row.txType}|${row.gross}`) ?? []).filter((t) => {
      const a = vendorKey(row.vendor), b = vendorKey(t.vendor);
      const vendorMatch = !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))));
      const projectMatch = !!row.projectCode && t.projectCode === row.projectCode;
      const namedPurpose = !!row.projectCode && norm(`${t.vendor ?? ""} ${t.note ?? ""}`).includes(norm(row.projectCode));
      return vendorMatch || ((projectMatch || namedPurpose) && (t.acctMinor === row.acctMinor || /도메인/.test(`${t.vendor ?? ""} ${t.note ?? ""}`)));
    });
    if (candidates.length) row.duplicateCandidates = candidates.map((t) => ({ id: t.id, date: t.date, vendor: t.vendor, gross: t.gross - (t.adjust || 0), reason: "같은 사용일·금액의 사용처 또는 프로젝트 비용이 원장에 있습니다." }));
    if (warnings.length) row.warnings = warnings;
    return row;
  }) };
}
