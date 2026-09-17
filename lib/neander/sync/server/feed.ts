import "server-only";

// ============================================================
//  피드 부르기 — 사이트의 읽기 전용 창구를 두드린다
// ------------------------------------------------------------
//  주소와 토큰은 환경변수에만 둔다. 없으면 **동기화를 켜지 않는다** —
//  빈 토큰으로 아무 데나 붙어 보는 일이 없어야 한다.
//
//    ACSCENT_FEED_URL   https://www.acscent.co.kr/api/erp/feed
//    ACSCENT_FEED_TOKEN 사이트의 ERP_FEED_TOKEN 과 같은 값
//    SMOAT_FEED_URL     https://www.smoat.co.kr/api/erp/feed
//    SMOAT_FEED_TOKEN   사이트의 ERP_FEED_TOKEN 과 같은 값
//
//  ⚠️ 두 사이트의 토큰은 **서로 다른 값**이어야 한다. 하나가 새면 하나만
//     잠글 수 있어야 한다.
// ============================================================

import { FEED_VERSION, type FeedSource } from "../contract";

const TIMEOUT_MS = 20_000;

export class FeedError extends Error {
  constructor(
    readonly source: FeedSource,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface FeedConfig {
  url: string;
  token: string;
}

function configOf(source: FeedSource): FeedConfig | null {
  const prefix = source === "smoat" ? "SMOAT" : "ACSCENT";
  const url = (process.env[`${prefix}_FEED_URL`] ?? "").trim();
  const token = (process.env[`${prefix}_FEED_TOKEN`] ?? "").trim();
  if (!url || !token) return null;
  return { url, token };
}

/** 이 피드를 부를 수 있게 설정돼 있는가 */
export const feedConfigured = (source: FeedSource) => configOf(source) !== null;

/** 설정이 없을 때 화면에 띄울 말 */
export function feedSetupHint(source: FeedSource): string {
  const prefix = source === "smoat" ? "SMOAT" : "ACSCENT";
  return `${prefix}_FEED_URL · ${prefix}_FEED_TOKEN 환경변수가 없습니다.`;
}

/**
 * 피드를 한 번 부른다.
 *
 * 계약 판이 다르면 **여기서 멈춘다.** 사이트가 먼저 배포돼 모양이 바뀌었는데
 * 우리가 옛 모양으로 읽으면 금액이 조용히 틀린다. 멈추면 화면에 빨간 줄이
 * 뜨고 사람이 안다.
 */
export async function callFeed<T>(
  source: FeedSource,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const cfg = configOf(source);
  if (!cfg) throw new FeedError(source, feedSetupHint(source));

  const url = new URL(cfg.url);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new FeedError(
      source,
      aborted ? `피드가 ${TIMEOUT_MS / 1000}초 안에 답하지 않았습니다.` : `피드에 닿지 못했습니다: ${e instanceof Error ? e.message : e}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* 본문 없음 */
    }
    throw new FeedError(source, detail || `피드가 HTTP ${res.status} 로 답했습니다.`, res.status);
  }

  const body = (await res.json()) as { version?: number; source?: string };
  if (body.version !== FEED_VERSION) {
    throw new FeedError(
      source,
      `피드 계약 판이 다릅니다 (사이트 ${body.version} · ERP ${FEED_VERSION}). ` +
        `양쪽의 contract 를 맞춘 뒤 다시 실행하세요.`,
    );
  }
  if (body.source !== source) {
    throw new FeedError(source, `다른 사이트의 피드입니다 (${body.source}).`);
  }
  return body as T;
}
