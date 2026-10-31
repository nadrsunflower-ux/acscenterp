import "server-only";

// ============================================================
//  쿠팡 파트너스 Open API — 상품 검색 · 딥링크 · 리포트 (서버 전용)
// ------------------------------------------------------------
//  공식 자료 (2026-10-31 확인, partners.coupang.com 의 OPEN_API_GUIDE · SPEC · FAQ):
//    기본 주소  https://api-gateway.coupang.com
//    경로       /v2/providers/affiliate_open_api/apis/openapi/v1/…
//    서명       Authorization: CEA algorithm=HmacSHA256, access-key=AK, signed-date=DT, signature=SIG
//               DT  = GMT yyMMdd'T'HHmmss'Z'
//               SIG = hex(HMAC-SHA256(secret, DT + METHOD + path + query))   (query 는 ? 없이)
//    한도       검색 분당 50회 · 리포트 시간당 500회 — 넘으면 24시간 차단(429)
//    권한       최종 승인된 회원만 키 발급
//
//  ⚠️ Open API 이용약관 제5조: API 로 받은 데이터를 복제·저장·전송하지 않는다.
//     그래서 검색 결과는 화면에만 보여 주고 저장하지 않는다. 사람이 후보로
//     고르면 상품 주소 · 이름(무엇인지 알아볼 만큼)만 남기고, 가격·판매 상태는
//     사람이 쿠팡에서 직접 보고 적는다 (출처 「직접 입력」).
//  ⚠️ 한도를 넘으면 하루 동안 막힌다 — 자동 반복 호출을 만들지 않는다.
//     검색은 분당 30회에서 서버가 먼저 멈춘다 (키 주인마다 센다).
//
//  키는 사람마다 따로다 (profiles.ts — 파트너스 키는 1개 · 공유 불가). 모든 호출은
//  누구의 키로 부를지(CoupangCreds)를 받는다. 서버 환경변수의 키는 「회사 공용」 으로,
//  검색에만 대신 쓴다 — 딥링크 · 리포트는 수수료 · 실적이 키 주인에게 붙기 때문이다.
// ============================================================

import { createHmac } from "node:crypto";
import type { Fetcher } from "./platforms";

const HOST = "https://api-gateway.coupang.com";
const BASE = "/v2/providers/affiliate_open_api/apis/openapi/v1";

let fetcher: Fetcher = (...a) => fetch(...a);
export const setCoupangFetch = (f: Fetcher | null) => {
  fetcher = f ?? ((...a) => fetch(...a));
};

export interface CoupangCreds {
  accessKey: string;
  secretKey: string;
}

/** 회사 공용 키 (서버 환경변수) */
export function coupangConfig() {
  const accessKey = process.env.NEANDER_SHORTS_COUPANG_ACCESS_KEY?.trim() ?? "";
  const secretKey = process.env.NEANDER_SHORTS_COUPANG_SECRET_KEY?.trim() ?? "";
  const missing = [!accessKey && "NEANDER_SHORTS_COUPANG_ACCESS_KEY", !secretKey && "NEANDER_SHORTS_COUPANG_SECRET_KEY"].filter(Boolean) as string[];
  return { accessKey, secretKey, configured: missing.length === 0, missing };
}

/** GMT yyMMdd'T'HHmmss'Z' */
export function signedDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function authorization(method: string, path: string, query: string, accessKey: string, secretKey: string, now = new Date()): string {
  const dt = signedDate(now);
  const sig = createHmac("sha256", secretKey).update(dt + method + path + query).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${dt}, signature=${sig}`;
}

export class CoupangApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const companyCreds = (): CoupangCreds | null => {
  const c = coupangConfig();
  return c.configured ? { accessKey: c.accessKey, secretKey: c.secretKey } : null;
};

async function call<T>(creds: CoupangCreds, method: "GET" | "POST", path: string, params: Record<string, string>, body?: unknown): Promise<T> {
  const { accessKey, secretKey } = creds;
  if (!accessKey || !secretKey) throw new CoupangApiError("쿠팡 파트너스 API 키가 없습니다. 직접 검색·확인으로 진행해 주세요.", 503);
  const query = new URLSearchParams(params).toString();
  const full = BASE + path;
  let res: Response;
  try {
    res = await fetcher(`${HOST}${full}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        Authorization: authorization(method, full, query, accessKey, secretKey),
        "Content-Type": "application/json;charset=UTF-8",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new CoupangApiError("쿠팡 파트너스 API 에 연결하지 못했습니다.", 502);
  }
  const payload = (await res.json().catch(() => null)) as { rCode?: string; rMessage?: string; data?: unknown } | null;
  if (res.status === 429) throw new CoupangApiError("쿠팡 파트너스 API 호출 한도를 넘었습니다. 24시간 동안 막힐 수 있습니다 — 직접 검색으로 진행해 주세요.", 429);
  if (res.status === 401 || res.status === 403) throw new CoupangApiError("쿠팡 파트너스 API 인증에 실패했습니다. 키와 최종 승인 상태를 확인해 주세요.", 401);
  if (!res.ok || (payload?.rCode && payload.rCode !== "0")) {
    throw new CoupangApiError(`쿠팡 파트너스 API 요청이 실패했습니다 (HTTP ${res.status}${payload?.rCode ? ` · ${String(payload.rCode).slice(0, 20)}` : ""}).`, 502);
  }
  return payload?.data as T;
}

export interface CoupangSearchItem {
  rank: number | null;
  productId: string;
  productName: string;
  productPrice: number | null;
  productImage: string;
  productUrl: string;
  isRocket: boolean;
  isFreeShipping: boolean;
}

/** 상품 검색 (분당 50회 한도 — 부르는 쪽이 계수기로 30회에서 멈춘다) */
export async function coupangSearch(creds: CoupangCreds, keyword: string, subId?: string, limit = 10): Promise<{ items: CoupangSearchItem[]; landingUrl: string | null }> {
  const k = keyword.trim();
  if (!k || k.length > 100) throw new CoupangApiError("검색어는 1~100자로 입력해 주세요.", 400);
  const params: Record<string, string> = { keyword: k, limit: String(Math.min(10, Math.max(1, limit))) };
  if (subId && /^[A-Za-z0-9]{8,20}$/.test(subId)) params.subId = subId;
  const data = await call<{ landingUrl?: string; productData?: Record<string, unknown>[] }>(creds, "GET", "/products/search", params);
  return {
    landingUrl: typeof data?.landingUrl === "string" ? data.landingUrl : null,
    items: (data?.productData ?? []).map((p) => ({
      rank: typeof p.rank === "number" ? p.rank : null,
      productId: String(p.productId ?? ""),
      productName: String(p.productName ?? ""),
      productPrice: typeof p.productPrice === "number" ? p.productPrice : null,
      productImage: String(p.productImage ?? ""),
      productUrl: String(p.productUrl ?? ""),
      isRocket: p.isRocket === true,
      isFreeShipping: p.isFreeShipping === true,
    })),
  };
}

/** 상품 상세 주소 → 파트너스 딥링크 (shortenUrl) */
export async function coupangDeeplink(creds: CoupangCreds, productUrl: string, subId?: string): Promise<{ shortenUrl: string; landingUrl: string }> {
  const body: Record<string, unknown> = { coupangUrls: [productUrl] };
  if (subId && /^[A-Za-z0-9]{8,20}$/.test(subId)) body.subId = subId;
  const data = await call<{ originalUrl?: string; shortenUrl?: string; landingUrl?: string }[]>(creds, "POST", "/deeplink", {}, body);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.shortenUrl) throw new CoupangApiError("딥링크를 받지 못했습니다. 지원하는 쿠팡 주소인지 확인해 주세요.", 502);
  return { shortenUrl: row.shortenUrl, landingUrl: String(row.landingUrl ?? "") };
}

const ymd = (s: string) => {
  if (!/^\d{8}$/.test(s)) throw new CoupangApiError("날짜는 yyyyMMdd 로 넣어 주세요.", 400);
  return s;
};

/**
 * 주문 리포트 (기간 30일 이내 · 매일 15시 갱신). 상품 id 별로 묶어 프로젝트에
 * 붙인다 — 클릭 리포트에는 상품 id 가 없어 클릭은 채널 아이디(subId) 단위로만 안다.
 */
export async function coupangOrders(creds: CoupangCreds, startDate: string, endDate: string, subId?: string) {
  const params: Record<string, string> = { startDate: ymd(startDate), endDate: ymd(endDate), page: "0" };
  if (subId) params.subId = subId;
  const rows = await call<Record<string, unknown>[]>(creds, "GET", "/reports/orders", params);
  return (rows ?? []).map((r) => ({
    date: String(r.date ?? ""),
    subId: String(r.subId ?? ""),
    productId: String(r.productId ?? ""),
    quantity: Number(r.quantity) || 0,
    gmv: Number(r.gmv) || 0,
    commission: Number(r.commission) || 0,
  }));
}

export async function coupangClicks(creds: CoupangCreds, startDate: string, endDate: string, subId?: string) {
  const params: Record<string, string> = { startDate: ymd(startDate), endDate: ymd(endDate), page: "0" };
  if (subId) params.subId = subId;
  const rows = await call<Record<string, unknown>[]>(creds, "GET", "/reports/clicks", params);
  return (rows ?? []).map((r) => ({ date: String(r.date ?? ""), subId: String(r.subId ?? ""), click: Number(r.click) || 0 }));
}
