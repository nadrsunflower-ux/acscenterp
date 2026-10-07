// ============================================================
//  회의 준비 자료(웹 발표자료) 레지스트리
// ------------------------------------------------------------
//  /neander/meetings 페이지 상단 "회의 준비 자료" 섹션에 노출되는
//  코드 관리형 발표자료 목록. 발표자료 자체가 코드(슬라이드 페이지)로
//  들어가므로, 새 자료를 만들면:
//    1) app/neander/meetings/prep/<slug>/ 에 슬라이드 페이지 작성
//    2) 여기 PREP_DOCS 에 항목 추가
//  순서만 지키면 회의록 페이지에 자동으로 링크가 걸린다.
// ============================================================

export interface PrepDoc {
  /** URL 슬러그 (라우트 디렉터리명과 일치) */
  slug: string;
  /** 회의 날짜 YYYY-MM-DD */
  date: string;
  title: string;
  /** 발표자(작성자) — 회의록 페이지의 발표자 탭 구분 기준. 팀원 이름과 동일하게 */
  author: string;
  /** 한 줄 요약 (카드에 표시) */
  summary?: string;
  /** 카드 포인트 색 (없으면 기본 인디고) */
  accent?: string;
}

/** 자료 페이지 경로 */
export const prepDocHref = (d: PrepDoc) => `/neander/meetings/prep/${d.slug}`;

/** 등록된 발표자료 (최신순으로 정렬해 사용) */
export const PREP_DOCS: PrepDoc[] = [
  {
    // 내용은 저장소 밖(Firestore neander_decks)에 있다 — 제목만 중립적으로 둔다
    slug: "2026-09-29-exec",
    date: "2026-09-29",
    title: "0929 임원진회의 발표 장표",
    author: "이동주",
    summary: "가정값을 바꾸면 표와 결론 숫자가 다시 계산되는 웹 장표 · 재무 권한자만 열람",
    accent: "#7dd3fc",
  },
  {
    slug: "2026-07-07-kim-juyeon",
    date: "2026-07-07",
    title: "7월, 폭풍 전야 — 전사 전략 브리핑",
    author: "김주연",
    summary:
      "사주 프로그램 D-8 · 제이진옴므 계약 완료 · 스모트 여름방학 총력전 · 하반기 로드맵",
    accent: "#22d3ee",
  },
];

// ---- 매번 쓰는 발표 자료 ------------------------------------
//  팀원마다 회의 때 늘 같은 주소(자기 발표 자료 사이트)를 여는 일이 있다.
//  그 주소는 팀원 문서의 prepUrl 에 둔다 (팀원 관리 → 수정). 저장소가 public
//  이라 여기 코드에 적지 않는다. 회의록 문서 머리와 「준비 자료」 메뉴가 쓴다.

/** "/neander/…" 내부 경로와 프로토콜 있는 URL 은 그대로, 그 외에는 https:// 를 붙인다 */
export function normalizeLinkUrl(u: string): string {
  const t = u.trim();
  if (t.startsWith("/") || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** 주소에서 사람이 알아볼 부분 — "https://a.vercel.app/" → "a.vercel.app" */
export function linkHost(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/** 같은 곳을 가리키는 주소인지 볼 때 쓰는 열쇠 (끝 빗금 · 대소문자 무시) */
export const linkKey = (url: string) => linkHost(url).toLowerCase();

export interface StandingPrep {
  /** 팀원 id */
  id: string;
  name: string;
  color?: string;
  avatar?: string;
  url: string;
}

/** 발표 자료 주소를 적어 둔 팀원들 (팀원 등록 순서) */
export function standingPreps(
  members: { id: string; name: string; color?: string; avatar?: string; prepUrl?: string }[],
): StandingPrep[] {
  return members
    .filter((m) => m.prepUrl?.trim())
    .map((m) => ({ id: m.id, name: m.name, color: m.color, avatar: m.avatar, url: normalizeLinkUrl(m.prepUrl!) }));
}

/** 발표자 탭 목록 — 자료가 있는 발표자만, 등록 순서 유지 */
export function prepDocAuthors(): string[] {
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const d of PREP_DOCS) {
    if (!seen.has(d.author)) {
      seen.add(d.author);
      authors.push(d.author);
    }
  }
  return authors;
}

/** 특정 발표자의 자료 (날짜 최신순) */
export function prepDocsByAuthor(author: string): PrepDoc[] {
  return PREP_DOCS.filter((d) => d.author === author).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}
