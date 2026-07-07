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
    slug: "2026-07-07-kim-juyeon",
    date: "2026-07-07",
    title: "7월, 폭풍 전야 — 전사 전략 브리핑",
    author: "김주연",
    summary:
      "사주 프로그램 D-8 · 제이진옴므 계약 완료 · 스모트 여름방학 총력전 · 하반기 로드맵",
    accent: "#22d3ee",
  },
];

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
