import "server-only";

// ============================================================
//  네이버 데이터랩 검색어 트렌드 — AI 레이더의 「국내 검색 추세」
// ------------------------------------------------------------
//  POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search  (NAVER API HUB)
//    헤더 X-NCP-APIGW-API-KEY-ID · X-NCP-APIGW-API-KEY (네이버 클라우드 콘솔 › NAVER API HUB ›
//    Application › 인증 정보). 개발자센터(openapi.naver.com/v1/datalab/search)는 2026-07-31 부터
//    새 신청을 받지 않는다 — 본문·응답 형식은 같고 주소·헤더만 다르다.
//    본문 { startDate, endDate, timeUnit: "week", keywordGroups: [{ groupName, keywords }] }
//  월 50,000건 · 키당 50 RPS (한시 무료). 값은 그 요청 안에서 가장 높은 구간을 100 으로 둔 상대값이라, 상품마다
//  따로 부른다 (묶음 하나 = 요청 하나) — 상품끼리 크기를 견주지 않고 그 상품의 추세만 본다.
//  키: NEANDER_SHORTS_NAVER_CLIENT_ID · NEANDER_SHORTS_NAVER_CLIENT_SECRET (서버에만)
// ============================================================

import type { Fetcher } from "./platforms";

let fetcher: Fetcher = (...a) => fetch(...a);
export const setNaverFetch = (f: Fetcher | null) => {
  fetcher = f ?? ((...a) => fetch(...a));
};

export function naverConfig() {
  const id = process.env.NEANDER_SHORTS_NAVER_CLIENT_ID?.trim() ?? "";
  const secret = process.env.NEANDER_SHORTS_NAVER_CLIENT_SECRET?.trim() ?? "";
  return { id, secret, configured: !!id && !!secret };
}

const ymd = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 검색어 묶음 하나의 주간 상대값 (오래된 주 → 최근 주). 값이 없는 주는 0.
 * weeks 주를 본다 (기본 8주 — 최근 2주 vs 그 전 6주).
 */
export async function naverWeeklySeries(keywords: string[], weeks = 8, now = Date.now()): Promise<number[]> {
  const { id, secret, configured } = naverConfig();
  if (!configured) throw new Error("네이버 데이터랩 키(NEANDER_SHORTS_NAVER_CLIENT_ID · _SECRET)가 없습니다.");
  const words = [...new Set(keywords.map((k) => k.trim().slice(0, 40)).filter(Boolean))].slice(0, 5);
  if (!words.length) throw new Error("네이버에 넣을 검색어가 없습니다.");
  // 이번 주는 아직 덜 찼다 — 지난 일요일까지 끊는다 (데이터랩 주 단위는 월요일 시작)
  const end = new Date(now + 9 * 3600_000);
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) - 1);
  const endT = end.getTime() - 9 * 3600_000;
  const startT = endT - (weeks * 7 - 1) * 86_400_000;
  let res: Response;
  try {
    res = await fetcher("https://naverapihub.apigw.ntruss.com/search-trend/v1/search", {
      method: "POST",
      headers: { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: ymd(startT), endDate: ymd(endT), timeUnit: "week", keywordGroups: [{ groupName: words[0], keywords: words }] }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("네이버 데이터랩에 연결하지 못했습니다.");
  }
  const data = (await res.json().catch(() => null)) as {
    results?: { data?: { period?: string; ratio?: number }[] }[];
    errorMessage?: string;
    errMsg?: string;
    error?: { errorCode?: string; message?: string; details?: string }; // API HUB(게이트웨이) 오류 모양
  } | null;
  if (!res.ok) {
    const msg = data?.error ? [data.error.message, data.error.details].filter(Boolean).join(" — ") : (data?.errorMessage ?? data?.errMsg);
    throw new Error(`네이버 데이터랩: ${String(msg || `HTTP ${res.status}`).slice(0, 120)}`);
  }
  const raw = (data?.results?.[0]?.data ?? []).map((p) => ({ period: String(p.period ?? ""), ratio: Number(p.ratio) || 0 })).sort((a, b) => a.period.localeCompare(b.period));
  const points = new Map(raw.map((p) => [p.period, p.ratio]));
  // 빈 주는 응답에서 빠진다 — 주마다 자리를 만들어 0 으로 채운다
  const out: number[] = [];
  let hit = 0;
  for (let i = 0; i < weeks; i++) {
    const v = points.get(ymd(startT + i * 7 * 86_400_000));
    if (v !== undefined) hit++;
    out.push(v ?? 0);
  }
  // 주 시작 요일이 예상과 달라 하나도 안 맞으면, 받은 순서대로 뒤에 붙인다 (앞은 0)
  if (!hit && raw.length) return [...Array(Math.max(0, weeks - raw.length)).fill(0), ...raw.slice(-weeks).map((p) => p.ratio)];
  return out;
}
