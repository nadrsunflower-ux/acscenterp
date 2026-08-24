// ============================================================
//  리포트 → 원장 드릴다운 링크
// ------------------------------------------------------------
//  리포트의 숫자를 누르면 "그 숫자를 이루는 거래"가 원장에 그대로 걸린
//  채로 열린다. 엑셀에서는 SUMIFS 를 뜯어야 알 수 있던 것이라, ERP 로
//  옮기면서 가장 크게 남는 이득이다.
//
//  원장의 열 필터(sheetFilter.ts)를 짧은 쿼리스트링으로 직렬화한다.
//  URL 이 사람이 읽을 수 있어야 링크를 주고받을 수 있으므로 값은
//  인코딩만 하고 압축하지 않는다.
// ============================================================

import { NO_ACCOUNT } from "./report";
import type { Filters } from "./sheetFilter";

export interface LedgerQuery {
  /** `YYYY-MM` */
  month?: string;
  txTypes?: string[];
  bizMajor?: string;
  bizMinor?: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  site?: string;
  vendor?: string;
  search?: string;
}

const PARAM = {
  month: "m",
  txTypes: "type",
  bizMajor: "bmaj",
  bizMinor: "bmin",
  acctMajor: "amaj",
  acctMid: "amid",
  acctMinor: "amin",
  site: "site",
  vendor: "vendor",
  search: "q",
} as const;

/** 리포트의 `(미분류)`·`(미정)` 표기는 원장에서 "빈 값"이다 */
const unlabel = (v?: string) =>
  v === undefined ? undefined : v === NO_ACCOUNT || v === "(미정)" ? "" : v;

export function ledgerHref(q: LedgerQuery): string {
  const p = new URLSearchParams();
  const put = (key: string, v?: string) => {
    if (v !== undefined) p.set(key, v);
  };
  put(PARAM.month, q.month);
  if (q.txTypes?.length) p.set(PARAM.txTypes, q.txTypes.join(","));
  put(PARAM.bizMajor, unlabel(q.bizMajor));
  put(PARAM.bizMinor, unlabel(q.bizMinor));
  put(PARAM.acctMajor, unlabel(q.acctMajor));
  put(PARAM.acctMid, unlabel(q.acctMid));
  put(PARAM.acctMinor, unlabel(q.acctMinor));
  put(PARAM.site, unlabel(q.site));
  put(PARAM.vendor, q.vendor);
  put(PARAM.search, q.search);
  const s = p.toString();
  return s ? `/neander/finance/ledger?${s}` : "/neander/finance/ledger";
}

/**
 * 쿼리스트링 → 원장 필터.
 *
 * 값이 빈 문자열이면 "빈 값만 보기"라는 뜻이라 그대로 필터에 넣는다
 * (`amaj=` → 계정대분류가 비어 있는 거래). 파라미터 자체가 없으면 필터 없음.
 */
export function filtersFromQuery(search: string): { filters: Filters; search: string } | null {
  const p = new URLSearchParams(search);
  const filters: Filters = {};
  let any = false;

  const values = (param: string, key: keyof Filters) => {
    const raw = p.get(param);
    if (raw === null) return;
    filters[key] = { kind: "values", values: raw.split(",").filter((v, i, a) => a.indexOf(v) === i) };
    any = true;
  };

  values(PARAM.month, "date");
  values(PARAM.txTypes, "txType");
  values(PARAM.bizMajor, "bizMajor");
  values(PARAM.bizMinor, "bizMinor");
  values(PARAM.acctMajor, "acctMajor");
  values(PARAM.acctMid, "acctMid");
  values(PARAM.acctMinor, "acctMinor");
  values(PARAM.site, "site");

  // 거래처는 전용 필터 열이 없어 전체 검색으로 넘긴다
  const q = p.get(PARAM.search) ?? p.get(PARAM.vendor) ?? "";
  if (q) any = true;

  return any ? { filters, search: q } : null;
}
