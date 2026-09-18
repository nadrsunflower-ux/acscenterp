// ============================================================
//  노션 응답 → 비서가 읽을 모양
// ------------------------------------------------------------
//  입출력만 있는 순수 함수다 — fetch 도 토큰도 여기 없다. 그래야 스크립트로
//  값을 찍어 보며 규칙을 확인할 수 있다 (npm run notion:verify).
//
//  노션 API 응답은 그대로 모델에 주기엔 너무 수다스럽다. rich text 한 글자마다
//  주석·색·링크 객체가 붙고, 속성 하나가 수십 줄 JSON 이 된다. 여기서 사람이
//  화면에서 보는 값 — 글자, 선택지 이름, 날짜 — 만 남긴다.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 표 한 칸에 담을 최대 글자 — 긴 메모 한 칸이 결과를 다 먹지 않게 */
export const CELL_CHARS = 300;

const HEX32 = /[0-9a-f]{32}/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const dashed = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();

/**
 * 페이지·데이터베이스 id 를 사람이 붙여 넣은 무엇에서든 뽑는다.
 *   - id 그대로 (대시 있든 없든)
 *   - https://www.notion.so/워크스페이스/제목-<32자리>?v=<뷰 id>
 *   - 표에서 줄을 옆으로 연 URL: …?v=<뷰 id>&p=<줄 id>&pm=s  → 줄(p)이 목적이다
 *
 * ⚠️ `v=` 도 32자리 hex 라서 쿼리를 떼지 않고 마지막 hex 를 고르면 뷰 id 를
 *    잡는다. 경로에서만 찾고, 쿼리에서는 p 만 본다.
 */
export function parseNotionId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  if (!s) return undefined;

  let path = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const peek = u.searchParams.get("p");
      if (peek && /^[0-9a-f]{32}$/i.test(peek)) return dashed(peek);
      path = u.pathname;
    } catch {
      return undefined;
    }
  }

  const uuid = path.match(UUID);
  if (uuid) return uuid[0].toLowerCase();
  const hexes = path.match(HEX32);
  return hexes ? dashed(hexes[hexes.length - 1]) : undefined;
}

export function plainText(rich: unknown): string {
  return Array.isArray(rich) ? rich.map((t: any) => t?.plain_text ?? "").join("") : "";
}

const clip = (s: string, max = CELL_CHARS) => (s.length > max ? `${s.slice(0, max)}…` : s);

const personName = (p: any): string => p?.name ?? p?.person?.email ?? p?.id ?? "?";

function dateText(d: any): string | null {
  if (!d?.start) return null;
  return d.end ? `${d.start} ~ ${d.end}` : d.start;
}

export type CellValue = string | number | boolean | string[] | null;

/**
 * 속성 하나 → 칸 값. 모르는 종류는 null — 모델이 빈칸으로 읽는다.
 * relation 은 상대 페이지 id 만 준다 (제목을 알려면 한 번 더 불러야 하는데,
 * 그걸 줄마다 하면 요청 한도를 금방 쓴다). 필요하면 모델이 notion_read_page 로.
 */
export function flattenProperty(p: any): CellValue {
  if (!p || typeof p !== "object") return null;
  switch (p.type) {
    case "title":
    case "rich_text":
      return clip(plainText(p[p.type]));
    case "number":
      return typeof p.number === "number" ? p.number : null;
    case "select":
    case "status":
      return p[p.type]?.name ?? null;
    case "multi_select":
      return (p.multi_select ?? []).map((o: any) => o?.name ?? "");
    case "date":
      return dateText(p.date);
    case "people":
      return (p.people ?? []).map(personName);
    case "files":
      return (p.files ?? []).map((f: any) => f?.name ?? "파일");
    case "checkbox":
      return Boolean(p.checkbox);
    case "url":
    case "email":
    case "phone_number":
      return p[p.type] ? clip(String(p[p.type])) : null;
    case "formula": {
      const f = p.formula ?? {};
      if (f.type === "date") return dateText(f.date);
      const v = f[f.type];
      return v === undefined || v === null ? null : typeof v === "string" ? clip(v) : v;
    }
    case "relation":
      return (p.relation ?? []).map((r: any) => r?.id ?? "");
    case "rollup": {
      const r = p.rollup ?? {};
      if (r.type === "number") return r.number ?? null;
      if (r.type === "date") return dateText(r.date);
      if (r.type === "array") {
        return (r.array ?? [])
          .map((x: any) => flattenProperty(x))
          .flat()
          .filter((x: CellValue) => x !== null && x !== "")
          .map(String);
      }
      return null;
    }
    case "created_time":
    case "last_edited_time":
      return p[p.type] ?? null;
    case "created_by":
    case "last_edited_by":
      return p[p.type] ? personName(p[p.type]) : null;
    case "unique_id": {
      const u = p.unique_id ?? {};
      return typeof u.number === "number" ? `${u.prefix ? `${u.prefix}-` : ""}${u.number}` : null;
    }
    case "verification":
      return p.verification?.state ?? null;
    default:
      return null;
  }
}

/** 페이지의 제목 — 제목 속성 이름은 워크스페이스마다 다르다 (Name·이름·제목…) */
export function pageTitle(page: any): string {
  const props = page?.properties ?? {};
  for (const v of Object.values<any>(props)) {
    if (v?.type === "title") return plainText(v.title) || "(제목 없음)";
  }
  return "(제목 없음)";
}

/** 데이터베이스·데이터 소스의 제목 */
export function sourceTitle(ds: any): string {
  return plainText(ds?.title) || ds?.name || "(제목 없는 표)";
}

/** 줄의 속성들 — 제목 칸은 따로 주므로 뺀다 */
export function pageProps(page: any): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const [name, v] of Object.entries<any>(page?.properties ?? {})) {
    if (v?.type === "title") continue;
    out[name] = flattenProperty(v);
  }
  return out;
}

/**
 * 표의 열 목록 — "열이름 → 종류(: 선택지)". 모델이 filter 를 짤 때 열 이름과
 * 선택지 철자를 여기서 베낀다. 지어낸 선택지로 거르면 노션이 400 을 준다.
 */
export function schemaOf(ds: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries<any>(ds?.properties ?? {})) {
    const opts = v?.[v?.type]?.options;
    out[name] = Array.isArray(opts) && opts.length
      ? `${v.type}: ${opts.slice(0, 30).map((o: any) => o?.name).join(" / ")}${opts.length > 30 ? " …" : ""}`
      : String(v?.type ?? "?");
  }
  return out;
}

/** 검색 결과 한 건 */
export function searchHit(obj: any) {
  const isSource = obj?.object === "data_source" || obj?.object === "database";
  return {
    id: obj?.id as string,
    kind: isSource ? ("database" as const) : ("page" as const),
    title: isSource ? sourceTitle(obj) : pageTitle(obj),
    url: (obj?.url as string | undefined) ?? undefined,
    lastEdited: typeof obj?.last_edited_time === "string" ? obj.last_edited_time.slice(0, 10) : undefined,
    /** 표 안의 한 줄인가 — 이 경우 notion_query_database 로 형제 줄을 볼 수 있다 */
    inDatabase:
      obj?.parent?.type === "data_source_id" || obj?.parent?.type === "database_id" ? true : undefined,
  };
}

/**
 * 긴 본문을 잘라 한 번에 한 토막씩. 줄 경계에서 자르려 애쓴다 — 표나 목록
 * 한가운데서 끊기면 모델이 뒤 토막을 읽을 때 앞뒤를 잇지 못한다.
 */
export function sliceText(
  text: string,
  offset: number,
  limit: number,
): { text: string; nextOffset?: number } {
  const start = Math.max(0, Math.min(Math.floor(offset) || 0, text.length));
  if (text.length - start <= limit) return { text: text.slice(start) };
  let end = start + limit;
  const nl = text.lastIndexOf("\n", end);
  if (nl > start + limit * 0.8) end = nl + 1;
  return { text: text.slice(start, end), nextOffset: end };
}
