// ============================================================
//  노션 API — 읽기 전용 클라이언트 (서버 전용)
// ------------------------------------------------------------
//  비서가 회사 노션을 읽을 때 쓴다 (ai/notion-tools.ts). 여기엔 읽는 요청만
//  있다 — 검색 · 페이지 · 본문 마크다운 · 표 조회. 쓰는 요청을 만들지 않는
//  것이 첫 번째 안전장치이고, 두 번째는 노션 쪽 연결(Internal connection)의
//  권한을 「Read content」 하나로만 켜 두는 것이다 (docs/notion-assistant.md).
//
//  토큰은 NOTION_TOKEN. 연결은 **공유받은 페이지만** 본다 — 노션에서 어느
//  페이지를 이 연결에 붙였느냐가 곧 비서가 읽을 수 있는 범위다.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

const NOTION_API = "https://api.notion.com/v1";
/** 2025-09-03 부터 표 조회가 data_sources 로 옮겨갔다. 2026-03-11 은 archived → in_trash */
export const NOTION_VERSION = "2026-03-11";
/** 한 요청이 이보다 오래 걸리면 끊는다 — 비서 한 턴이 노션 때문에 멈추지 않게 */
const TIMEOUT_MS = 20_000;

export class NotionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notionEnabled = () => Boolean(process.env.NOTION_TOKEN?.trim());

async function call<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) throw new NotionError(0, "not_configured", "NOTION_TOKEN 이 설정되지 않았습니다.");

  // 429(요청 한도)·529(노션 과부하)는 Retry-After 만큼 쉬고 두 번까지 다시.
  // 5초 넘게 기다리라면 포기한다 — 사용자가 채팅창 앞에서 기다리는 중이다.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ((res.status === 429 || res.status === 529) && attempt < 2) {
      const wait = Number(res.headers.get("retry-after")) || 1;
      if (wait <= 5) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
    }
    const raw = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      throw new NotionError(res.status, raw?.code ?? "http_error", raw?.message ?? `HTTP ${res.status}`);
    }
    return raw as T;
  }
}

export function searchNotion(args: {
  query?: string;
  kind?: "page" | "database";
  pageSize: number;
}) {
  return call("POST", "/search", {
    ...(args.query ? { query: args.query } : {}),
    ...(args.kind
      ? { filter: { property: "object", value: args.kind === "database" ? "data_source" : "page" } }
      : {}),
    // 검색어가 없으면 "최근에 뭐가 바뀌었나" — 수정 시각 순
    ...(args.query ? {} : { sort: { timestamp: "last_edited_time", direction: "descending" } }),
    page_size: args.pageSize,
  });
}

export const retrievePage = (id: string) => call("GET", `/pages/${id}`);

/** 본문 전체를 마크다운으로 — 블록을 한 겹씩 내려가며 부르지 않아도 된다 */
export const pageMarkdown = (id: string) =>
  call<{ markdown: string; truncated: boolean; unknown_block_ids?: string[] }>(
    "GET",
    `/pages/${id}/markdown`,
  );

/**
 * 표 id → 데이터 소스. 검색 결과는 데이터 소스 id 를 주지만, 사람이 붙여 넣은
 * URL 에는 데이터베이스 id 가 들어 있다. 앞의 것으로 먼저 열어 보고, 안 되면
 * 데이터베이스로 열어 그 안의 첫 소스를 쓴다.
 */
export async function resolveDataSource(
  id: string,
): Promise<{ source: any; others: { id: string; name: string }[] }> {
  try {
    return { source: await call("GET", `/data_sources/${id}`), others: [] };
  } catch (e) {
    if (!(e instanceof NotionError) || (e.status !== 404 && e.status !== 400)) throw e;
    const db = await call("GET", `/databases/${id}`).catch(() => {
      throw e; // 데이터베이스로도 안 열리면 처음 오류가 더 정확하다
    });
    const sources: { id: string; name: string }[] = db?.data_sources ?? [];
    if (sources.length === 0) throw new NotionError(404, "object_not_found", "이 데이터베이스에 표가 없습니다.");
    return {
      source: await call("GET", `/data_sources/${sources[0].id}`),
      others: sources.slice(1),
    };
  }
}

export function queryDataSource(
  id: string,
  body: { filter?: unknown; sorts?: unknown; page_size: number; start_cursor?: string },
) {
  return call("POST", `/data_sources/${id}/query`, body);
}
