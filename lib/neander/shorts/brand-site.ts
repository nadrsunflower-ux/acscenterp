// ============================================================
//  업체 홈페이지 · 상세페이지 → 브리프 제안 (순수 함수 — 화면 · 서버가 같이 쓴다)
// ------------------------------------------------------------
//  사람이 주소를 넣고 누를 때만 서버(server/brand-site.ts)가 그 페이지 하나를 읽고,
//  여기서 HTML 을 「읽을 글」 로 바꾼 뒤 AI 가 브리프 칸(요약 · 대상 · 톤 · 핵심 메시지)과
//  제품 후보를 제안한다. 저장은 하지 않는다 — 사람이 결과 창에서 고른 것만 업체 문서에 들어간다.
//
//  지어낸 것을 막는 방법: AI 는 칸마다 페이지 글을 그대로 옮긴 근거(evidence)를 같이 내고,
//  그 근거가 실제로 뽑은 글에 없으면 그 칸 제안을 버린다 (checkSuggestion).
//  비교는 띄어쓰기 · 대소문자 · 따옴표 모양 정도만 느슨하게 본다.
//
//  색 후보는 theme-color 와 HTML 안의 CSS(#hex) 빈도로 코드가 찾은 것이다 — 브랜드 색 확정이 아니다.
//  바깥 CSS 파일은 읽지 않는다 (요청 한 번 · 페이지 하나).
// ============================================================

import { httpUrl, newId } from "./model";
import type { ClientDoc, ClientProduct } from "./types";

/** 전역 하루 상한 — 업체 화면에서 누를 때만이라 크지 않지만 폭주를 막는다 (키에 KST 날짜) */
export const BRAND_SITE_DAILY_LIMIT = 30;
/** AI 에 넘기는 글 상한 (글자) */
export const BRAND_SITE_TEXT_MAX = 12_000;
/** 이보다 글이 적으면 AI 를 부르지 않는다 — 화면을 스크립트로 그리는 사이트는 HTML 에 글이 거의 없다 */
export const BRAND_SITE_MIN_TEXT = 150;
/**
 * 누르기 전 대략 비용 — 2026-11-04 실측 2번 (Gemini 3.7 Flash): 브랜드 홈페이지 글 3,484자 → $0.0104 (약 15원),
 * 제품 상세페이지 글 1,891자 → $0.0077 (약 11원 · 입력 2.2천 · 출력 1.6천 토큰). 큰 쪽을 보인다.
 * 글이 상한(12,000자)까지 차면 이보다 조금 더 든다. 누른 뒤에는 응답의 실제 costUsd 를 보인다.
 */
export const BRAND_SITE_EST_KRW = 15;

// ---- 사설 주소 판정 (SSRF 막기) -------------------------------------------

function v4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? p : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8 (「이 망」 · 0.0.0.0)
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // 링크로컬 (클라우드 메타데이터 169.254.169.254 포함)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF 예약 · 문서용
    (a === 198 && (b === 18 || b === 19)) || // 벤치마크
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // 멀티캐스트 224/4 · 예약 240/4 · 255.255.255.255
  );
}

/** IPv6 글자 → 16비트 8칸 (실패면 null). 끝에 IPv4 가 붙은 꼴(::ffff:1.2.3.4)도 받는다 */
function v6Words(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const p = v4Parts(last);
    if (!p) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    // 「::ffff:」 → 「::ffff」 (끝 콜론 하나만 뗀다) · 「::」 는 그대로
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const read = (h: string) => (h ? h.split(":") : []);
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  const want = 8 - tail.length;
  if (head.some((x) => !/^[0-9a-f]{1,4}$/.test(x)) || rest.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  const fill = halves.length === 2 ? want - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== want)) return null;
  return [...head.map((x) => parseInt(x, 16)), ...Array(fill).fill(0), ...rest.map((x) => parseInt(x, 16)), ...tail];
}

/**
 * 사설 · 루프백 · 링크로컬 · CGNAT · 멀티캐스트 · 예약 주소인가 — 서버가 읽으러 가면 안 되는 곳.
 * 읽지 못하는 글자는 「사설」 로 본다 (모르면 막는다).
 */
export function isPrivateAddress(ip: string): boolean {
  const s = ip.trim().replace(/^\[|\]$/g, "");
  const v4 = v4Parts(s);
  if (v4) return privateV4(v4);
  const w = v6Words(s);
  if (!w || w.length !== 8) return true;
  const embedded = () => [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255];
  if (w.every((x) => x === 0)) return true; // :: (지정 안 함)
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return privateV4(embedded()); // IPv4-mapped ::ffff:a.b.c.d
  if (w.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible(폐기) ::a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return privateV4(embedded()); // NAT64 64:ff9b::/96
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 고유 로컬
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 링크로컬
  if ((w[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 사이트 로컬(폐기)
  if ((w[0] & 0xff00) === 0xff00) return true; // ff00::/8 멀티캐스트
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // 문서용
  return false;
}

/** 글자가 IP 주소 꼴인가 (호스트 이름이 아니라) */
export const isIpLiteral = (host: string) => !!v4Parts(host.replace(/^\[|\]$/g, "")) || (host.includes(":") && !!v6Words(host.replace(/^\[|\]$/g, "")));

/**
 * 읽으러 가도 되는 주소인가 (DNS 전 단계) — http/https · 사용자 정보 없음 · 포트 80/443 ·
 * localhost 류 이름 · 사설 IP 글자 거절. DNS 로 푼 주소 검사는 서버(server/brand-site.ts)가 한다.
 */
export function checkSiteUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "주소를 읽지 못했습니다 — https:// 로 시작하는 홈페이지 주소를 넣어 주세요." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "http · https 주소만 읽습니다." };
  if (u.username || u.password) return { ok: false, reason: "아이디 · 비밀번호가 들어간 주소는 읽지 않습니다." };
  if (u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443"))) return { ok: false, reason: "기본 포트(80 · 443) 주소만 읽습니다." };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host) || (!host.includes(".") && !host.includes(":")))
    return { ok: false, reason: "공개 인터넷 주소만 읽습니다." };
  if (isIpLiteral(host) && isPrivateAddress(host)) return { ok: false, reason: "사내 · 사설 주소는 읽지 않습니다." };
  u.hash = "";
  return { ok: true, url: u };
}

// ---- HTML → 읽을 글 ---------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", bull: "•", copy: "©", reg: "®", trade: "™", times: "×", deg: "°", ensp: " ", emsp: " ", thinsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

// 엔티티를 푼 뒤에 한 번 더 태그를 뗀다 — 글 안에 「&lt;img …&gt;」 처럼 적어 둔 태그가 본문으로 새지 않게
const clean = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/<\/?[a-z][^<>]{0,500}>/gi, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** 태그 하나의 속성들 (소문자 이름) */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

export interface SiteLd {
  type: string;
  name: string;
  description: string;
  /** 「가격 5,000 KRW」 · 「브랜드 X」 처럼 구조화 자료에 적힌 것 */
  extra: string[];
}

export interface SiteText {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  siteName: string;
  themeColor: string;
  headings: string[];
  jsonLd: SiteLd[];
  /** 보이는 본문 (줄 단위 · 겹친 줄 뺌) */
  body: string;
  /** AI 에 넘기고 근거를 대조하는 글 — 위 전부를 이어 붙인 것 (상한 BRAND_SITE_TEXT_MAX) */
  text: string;
  truncated: boolean;
}

const LD_TYPES = /^(Organization|Corporation|Brand|Product|ProductGroup|Store|OnlineStore|LocalBusiness|WebSite|ItemList)$/;

function walkLd(v: unknown, out: SiteLd[], depth = 0) {
  if (depth > 5 || out.length >= 12 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) return v.slice(0, 30).forEach((x) => walkLd(x, out, depth + 1));
  const o = v as Record<string, unknown>;
  const types = (Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]).filter((x): x is string => typeof x === "string");
  const type = types.find((t) => LD_TYPES.test(t));
  if (type && type !== "ItemList" && type !== "WebSite") {
    const s = (x: unknown) => (typeof x === "string" ? clean(x).slice(0, 400) : "");
    const extra: string[] = [];
    const brand = o.brand as Record<string, unknown> | string | undefined;
    const brandName = typeof brand === "string" ? brand : s(brand?.name);
    if (brandName) extra.push(`브랜드 ${clean(brandName)}`);
    const offers = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Record<string, unknown> | undefined;
    const price = offers?.price ?? offers?.lowPrice;
    if (typeof price === "number" || (typeof price === "string" && price.trim())) extra.push(`가격 ${String(price).trim()}${typeof offers?.priceCurrency === "string" ? ` ${offers.priceCurrency}` : ""}`);
    for (const k of ["slogan", "material", "color", "size", "weight", "sku"]) {
      const val = s(o[k]);
      if (val) extra.push(`${k} ${val}`);
    }
    const name = s(o.name);
    if (name || s(o.description)) out.push({ type, name, description: s(o.description), extra });
  }
  for (const k of ["@graph", "itemListElement", "item", "mainEntity", "hasVariant"]) if (k in o) walkLd(o[k], out, depth + 1);
}

/** HTML → 읽을 글. script · style · nav · footer 는 빼고 공백을 정리한다 */
export function extractSite(html: string): SiteText {
  const src = html.slice(0, 3_000_000);
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1] ?? "").slice(0, 200);
  const meta: Record<string, string> = {};
  for (const tag of src.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content.replace(/\s+/g, " ").trim();
  }
  const jsonLd: SiteLd[] = [];
  for (const m of src.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walkLd(JSON.parse(m[1].trim()), jsonLd);
    } catch {
      // 깨진 구조화 자료는 건너뛴다
    }
  }
  const visible = src
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|nav|footer|select|button|form)\b[\s\S]*?<\/\1>/gi, " ");
  const headings: string[] = [];
  for (const m of visible.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = clean(m[2]).slice(0, 160);
    if (t && !headings.includes(t)) headings.push(t);
    if (headings.length >= 30) break;
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  const blocks = visible
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|main|aside|dd|dt|dl|blockquote|figcaption|label)\b[^>]*>/gi, "\n")
    .split("\n");
  for (const b of blocks) {
    const t = clean(b);
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    lines.push(t.slice(0, 600));
  }
  const body = lines.join("\n");
  const head = [
    title && `[제목] ${title}`,
    meta.description && `[설명] ${meta.description}`,
    meta["og:site_name"] && `[사이트 이름] ${meta["og:site_name"]}`,
    meta["og:title"] && meta["og:title"] !== title && `[og 제목] ${meta["og:title"]}`,
    meta["og:description"] && meta["og:description"] !== meta.description && `[og 설명] ${meta["og:description"]}`,
    meta.keywords && `[검색어] ${meta.keywords.slice(0, 300)}`,
    ...jsonLd.map((l) => `[구조화 자료 · ${l.type}] ${[l.name, l.description, ...l.extra].filter(Boolean).join(" — ")}`),
    headings.length > 0 && `[제목 줄] ${headings.join(" / ")}`,
  ].filter((x): x is string => !!x);
  let text = [...head, "[본문]", body].join("\n");
  const truncated = text.length > BRAND_SITE_TEXT_MAX;
  if (truncated) text = text.slice(0, BRAND_SITE_TEXT_MAX);
  return {
    title,
    description: (meta.description ?? "").slice(0, 500),
    ogTitle: (meta["og:title"] ?? "").slice(0, 200),
    ogDescription: (meta["og:description"] ?? "").slice(0, 500),
    siteName: (meta["og:site_name"] ?? "").slice(0, 120),
    themeColor: normHex(meta["theme-color"] ?? "") ?? "",
    headings,
    jsonLd,
    body,
    text,
    truncated,
  };
}

// ---- 색 후보 (코드로 찾은 것 — 확정 아님) --------------------------------------

export interface ColorCandidate {
  hex: string;
  /** HTML 안 CSS 에 나온 횟수 (theme-color 는 0) */
  count: number;
  source: "theme-color" | "css";
}

function normHex(v: string): string | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(v.trim());
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return null;
  const h = m[1].toLowerCase();
  const six = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
  return `#${six}`;
}

/** 무채색(흰 · 검정 · 회색)인가 — 색 후보에서 뺀다 (theme-color 는 그대로 둔다) */
function neutral(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 14;
}

/** theme-color + HTML 안 CSS(<style> · style="") 의 #hex 빈도. 많이 나온 순 최대 n 개 */
export function colorCandidates(html: string, n = 6): ColorCandidate[] {
  const out: ColorCandidate[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    if ((a.name ?? "").toLowerCase() === "theme-color") {
      const h = normHex(a.content ?? "");
      if (h && !out.some((x) => x.hex === h)) out.push({ hex: h, count: 0, source: "theme-color" });
    }
  }
  const css = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
    ...[...html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3] ?? ""),
  ].join("\n");
  const freq = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{3,8})(?![0-9a-z_-])/gi)) {
    const h = normHex(m[1]);
    if (!h || neutral(h)) continue;
    freq.set(h, (freq.get(h) ?? 0) + 1);
  }
  for (const [hex, count] of [...freq].sort((a, b) => b[1] - a[1])) {
    const had = out.find((x) => x.hex === hex);
    if (had) had.count = count;
    else out.push({ hex, count, source: "css" });
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

// ---- AI 제안 · 근거 대조 ------------------------------------------------------

export interface Proposal {
  value: string;
  /** 페이지 글에서 그대로 옮긴 짧은 문장 */
  evidence: string;
}

export interface ProductProposal {
  name: string;
  evidence: string;
  /** 확인할 수 있는 사실 (크기 · 용량 · 소재 · 구성 · 가격 …) */
  facts: Proposal[];
  /** 효능 · 과장 · 비교 표현 — 사실로 옮기지 않고 「업체 주장」 으로 제품 메모에 */
  claims: Proposal[];
}

export interface BrandSiteSuggestion {
  summary: Proposal | null;
  target: Proposal | null;
  tone: Proposal | null;
  keyMessages: Proposal[];
  products: ProductProposal[];
}

/** AI 가 json_schema 로 돌려주는 모양 (다듬기 전) */
export interface RawBrandSuggestion {
  summary: Proposal;
  target: Proposal;
  tone: Proposal;
  keyMessages: Proposal[];
  products: { name: string; nameEvidence: string; facts: (Proposal & { claim: boolean })[] }[];
}

/** 근거 대조용 — 띄어쓰기 · 대소문자 · 따옴표 모양 · 보이지 않는 글자만 무시 */
export function matchKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\s"'`‘’“”「」『』]/g, "");
}

/** 근거 문장이 실제 뽑은 글에 있는가 — 너무 짧은 근거(5자 미만)는 근거로 치지 않는다 */
export function evidenceFound(evidence: string, text: string, minLen = 5): boolean {
  const k = matchKey(evidence);
  return k.length >= minLen && matchKey(text).includes(k);
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * AI 응답 다듬기 + 근거 대조. 값이 있는데 근거가 글에 없으면 버리고 dropped 에 센다.
 * 값이 비어 있으면(페이지에 없음) 버린 것으로 세지 않는다.
 */
export function checkSuggestion(raw: Partial<RawBrandSuggestion> | null | undefined, text: string): { suggestion: BrandSiteSuggestion; dropped: { count: number; labels: string[] } } {
  const labels: string[] = [];
  const hay = matchKey(text);
  const found = (ev: string, min = 5) => {
    const k = matchKey(ev);
    return k.length >= min && hay.includes(k);
  };
  const one = (p: Partial<Proposal> | undefined, label: string, max: number): Proposal | null => {
    const value = clip(p?.value, max);
    if (!value) return null;
    const evidence = clip(p?.evidence, 300);
    if (!found(evidence)) {
      labels.push(label);
      return null;
    }
    return { value, evidence };
  };
  const keyMessages: Proposal[] = [];
  for (const [i, p] of (Array.isArray(raw?.keyMessages) ? raw.keyMessages : []).slice(0, 8).entries()) {
    const ok = one(p, `핵심 메시지 ${i + 1}`, 200);
    if (ok && !keyMessages.some((x) => matchKey(x.value) === matchKey(ok.value))) keyMessages.push(ok);
  }
  const products: ProductProposal[] = [];
  for (const p of (Array.isArray(raw?.products) ? raw.products : []).slice(0, 6)) {
    const name = clip(p?.name, 120);
    if (!name) continue;
    const evidence = clip(p?.nameEvidence, 300);
    // 이름이 글에 그대로 있거나, 이름이 나온 문장이 글에 있어야 한다
    if (!found(name, 2) && !found(evidence)) {
      labels.push(`제품 「${name}」`);
      continue;
    }
    const facts: Proposal[] = [];
    const claims: Proposal[] = [];
    for (const [j, f] of (Array.isArray(p.facts) ? p.facts : []).slice(0, 12).entries()) {
      const ok = one(f, `「${name}」 사실 ${j + 1}`, 300);
      if (!ok) continue;
      const into = f?.claim ? claims : facts;
      if (!into.some((x) => matchKey(x.value) === matchKey(ok.value))) into.push(ok);
    }
    if (products.some((x) => matchKey(x.name) === matchKey(name))) continue;
    products.push({ name, evidence: found(evidence) ? evidence : "", facts: facts.slice(0, 10), claims: claims.slice(0, 6) });
  }
  return {
    suggestion: {
      summary: one(raw?.summary, "요약", 800),
      target: one(raw?.target, "대상", 300),
      tone: one(raw?.tone, "톤 · 말투", 200),
      keyMessages: keyMessages.slice(0, 6),
      products: products.slice(0, 5),
    },
    dropped: { count: labels.length, labels: labels.slice(0, 20) },
  };
}

// ---- 서버 → 화면 응답 ----------------------------------------------------------

export interface BrandSitePreview {
  /** 사람이 넣은 주소 (다듬은 것) */
  url: string;
  /** 리다이렉트 뒤 실제로 읽은 주소 */
  finalUrl: string;
  readAt: number;
  page: { title: string; siteName: string; description: string; chars: number; truncated: boolean };
  colors: ColorCandidate[];
  suggestion: BrandSiteSuggestion;
  dropped: { count: number; labels: string[] };
  costUsd: number;
  costKrw: number;
  model: string;
  quota: { used: number; limit: number };
}

// ---- 고르기 · 넣기 (화면이 update(...) 안에서 부른다) ------------------------------

export interface BrandSitePicks {
  summary: boolean;
  target: boolean;
  tone: boolean;
  keyMessages: boolean[];
  products: { on: boolean; facts: boolean[]; claims: boolean[] }[];
  colors: boolean;
}

type BriefHolder = { brief: ClientDoc["brief"]; products: ClientProduct[] };

/** 이미 있는 핵심 메시지인가 (띄어쓰기 · 대소문자 무시) */
export const hasMessage = (list: string[], v: string) => list.some((x) => matchKey(x) === matchKey(v));
/** 같은 이름의 제품 (있으면 새로 만들지 않고 사실만 덧붙인다) */
export const sameProduct = (list: ClientProduct[], name: string) => list.find((x) => matchKey(x.name) === matchKey(name));

const KEY_MESSAGES_MAX = 15;
const REFERENCES_MAX = 15;
const FACTS_MAX = 20;

/**
 * 기본 고르기 — 비어 있는 칸만 (사람이 이미 쓴 칸은 덮지 않게).
 * 목록(핵심 메시지 · 제품)은 지금 목록이 비어 있을 때만 골라 둔다. 색 후보는 확정이 아니라 기본으로 고르지 않는다.
 */
export function defaultPicks(c: BriefHolder, s: BrandSiteSuggestion): BrandSitePicks {
  const emptyMsgs = c.brief.keyMessages.length === 0;
  const emptyProducts = c.products.length === 0;
  return {
    summary: !!s.summary && !c.brief.summary.trim(),
    target: !!s.target && !c.brief.target.trim(),
    tone: !!s.tone && !c.brief.tone.trim(),
    keyMessages: s.keyMessages.map((m) => emptyMsgs && !hasMessage(c.brief.keyMessages, m.value)),
    products: s.products.map((p) => ({ on: emptyProducts, facts: p.facts.map(() => true), claims: p.claims.map(() => true) })),
    colors: false,
  };
}

/** 고른 것 수 (넣기 단추 · 꼬리표) */
export function pickCount(p: BrandSitePicks): number {
  return (
    Number(p.summary) +
    Number(p.target) +
    Number(p.tone) +
    p.keyMessages.filter(Boolean).length +
    p.products.filter((x) => x.on).length +
    Number(p.colors)
  );
}

/**
 * 고른 것을 업체 문서 사본에 넣는다 (화면의 update(fn) 안에서 — 저장은 그 화면의 자동 저장이).
 * - 요약 · 대상 · 톤: 고른 칸만 바꾼다
 * - 핵심 메시지: 겹치지 않게 덧붙이기 (15개 상한)
 * - 제품: 새 제품(주소 · 메모 「홈페이지 기준 · 확인 필요 · 날짜」) — 같은 이름이 있으면 사실만 덧붙인다
 *   업체 주장(효능 · 과장)은 사실 칸이 아니라 제품 메모에 「업체 주장:」 으로
 * - 주소는 참고 자료에(없으면) · 그 밖의 지시 끝에 「홈페이지에서 읽음 날짜 — 주소」 한 줄
 */
export function applyPicks(x: BriefHolder, pv: Pick<BrandSitePreview, "url" | "finalUrl" | "colors" | "suggestion">, picks: BrandSitePicks, today: string, makeId: () => string = () => newId("pd_")): void {
  const s = pv.suggestion;
  if (picks.summary && s.summary) x.brief.summary = s.summary.value;
  if (picks.target && s.target) x.brief.target = s.target.value;
  if (picks.tone && s.tone) x.brief.tone = s.tone.value;
  s.keyMessages.forEach((m, i) => {
    if (picks.keyMessages[i] && !hasMessage(x.brief.keyMessages, m.value) && x.brief.keyMessages.length < KEY_MESSAGES_MAX) x.brief.keyMessages.push(m.value);
  });
  const url = httpUrl(pv.finalUrl) || httpUrl(pv.url);
  s.products.forEach((p, i) => {
    const pick = picks.products[i];
    if (!pick?.on) return;
    const facts = p.facts.filter((_, j) => pick.facts[j]).map((f) => f.value);
    const claims = p.claims.filter((_, j) => pick.claims[j]).map((f) => `업체 주장: ${f.value}`);
    // 제품 메모 칸은 한 줄 입력이라 줄바꿈 대신 「 / 」 로 잇는다
    const noteLine = [`홈페이지 기준 · 확인 필요 · ${today}`, ...claims].join(" / ");
    const had = sameProduct(x.products, p.name);
    if (had) {
      for (const f of facts) if (!had.facts.some((y) => matchKey(y) === matchKey(f)) && had.facts.length < FACTS_MAX) had.facts.push(f);
      if (!had.url && url) had.url = url;
      had.note = [had.note.trim(), noteLine].filter(Boolean).join(" / ").slice(0, 1000);
      return;
    }
    x.products.push({ id: makeId(), name: p.name, url, facts: facts.slice(0, FACTS_MAX), photoIds: [], note: noteLine.slice(0, 1000) });
  });
  const ref = httpUrl(pv.url) || url;
  if (ref && !x.brief.references.includes(ref) && x.brief.references.length < REFERENCES_MAX) x.brief.references.push(ref);
  const lines = [
    picks.colors && pv.colors.length > 0 && `색 후보(코드로 찾음 · 확인 필요): ${pv.colors.map((c) => c.hex).join(" · ")}`,
    `홈페이지에서 읽음 ${today} — ${url || ref}`,
  ].filter((l): l is string => !!l);
  x.brief.notes = [x.brief.notes.replace(/\s+$/, ""), ...lines].filter(Boolean).join("\n");
}

/** 주소 칸 미리 채우기 — 참고 자료 중 영상 주소가 아닌 것 → 제품 주소 */
export function prefillSiteUrl(c: BriefHolder): string {
  const video = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|vimeo\.com)/i;
  return c.brief.references.find((r) => httpUrl(r) && !video.test(r)) ?? c.products.map((p) => p.url).find((u) => httpUrl(u)) ?? "";
}
