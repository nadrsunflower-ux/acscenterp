// ============================================================
//  상품 → 공식 사진
// ------------------------------------------------------------
//  사진은 acscent.co.kr 공개 페이지에서 받아 저장소에 넣어 둔 원본이다
//  (public/neander/assets/acscent-official/, manifest.json 에 출처·해시).
//  외부 URL 로 핫링크하지 않고, 새로 만들지도 않는다.
//
//  ⚠️ 유형을 섞지 않는다. 10ml 는 투명 병, 50ml 는 검은 병, 세트는 병 두
//     개짜리 사진이다. 세트 사진을 낱개 자리에 쓰면 "두 병 주는 상품"으로
//     읽힌다. 그래서 판정을 이름·옵션·병 수로만 하고, 애매하면 사진을
//     주지 않는다(중립 아이콘으로 내려간다).
//
//  ⚠️ 사진이 없는 유형은 **비워 둔다.** 공식 페이지에 사진이 없는 것들이다:
//       뿌디 / 이벤트피규어디퓨저 — figure 페이지에 상품 사진이 없었다.
//         (사주 클리커 키링 사진이 있지만 **다른 상품**이라 쓰지 않는다)
//       사쉐 — 조사한 공식 상품 페이지에서 찾지 못했다.
//       입장권 · 쿠폰 추가결제 — 물건이 아니다.
//     비슷해 보이는 다른 상품 사진으로 채우면 마스터를 잘못 읽게 된다.
//
//  목록용(thumb)과 상세용(hero)을 나눈 이유: 목록은 40~48px 이라 물건
//  하나만 크게 찍힌 컷이라야 알아보고, 상세는 구성품이 함께 보이는 컷이
//  낫다. 둘 다 같은 공식 원본이며 같은 상품 유형이다.
// ============================================================

import type { SalesProduct } from "./types";

/** 원본 폴더 — 출처·해시의 근거. 화면은 아래 파생본을 쓴다 */
export const ORIGINAL_DIR = "/neander/assets/acscent-official/images";
/**
 * 화면 크기로 줄여 둔 파생본. 원본은 장당 1.5~2.4MB 라 40px 썸네일에 그대로
 * 쓰면 상품 목록 한 번에 40MB 를 받는다 (next/image 는 이 저장소에서
 * unoptimized 다). 원본은 출처·해시의 근거라 그대로 두고, 줄인 것만 화면에
 * 내보낸다 — `scripts/neander/make-official-derivatives.py` 가 만든다.
 *   -128  목록 썸네일 (40~64px 을 2배 화면에서)
 *   -320  카드·상세 (128~160px 을 2배 화면에서)
 */
const DERIVED = "/neander/assets/acscent-official/derived";
const thumb = (stem: string) => `${DERIVED}/${stem}-128.webp`;
const hero = (stem: string) => `${DERIVED}/${stem}-320.webp`;

/** 상품 유형 — 사진과 중립 아이콘을 고르는 축 */
export type ProductKindKey =
  | "perfume10"
  | "perfume50"
  | "set10"
  | "set50"
  | "scentPaper"
  | "diffuser"
  | "sachet"
  | "ticket"
  | "etc";

export interface ProductImage {
  /** 목록·선택 후보용 (40~48px). 없으면 중립 아이콘 */
  thumb?: string;
  /** 상세·큰 카드용 (160~240px) */
  hero?: string;
  /** 사진 설명. 상품명이 바로 옆에 있으면 화면은 alt="" 로 덮어쓴다 */
  alt: string;
  kind: ProductKindKey;
  /** 사진이 없는 이유 — 화면이 중립 아이콘 옆 툴팁에 쓸 수 있다 */
  reason?: string;
}

const IMAGES: Record<ProductKindKey, ProductImage> = {
  perfume10: {
    // /products/perfume-10ml 의 단품 컷 · selection.json 의 10ml 개봉 구성
    thumb: thumb("0e527b2b-perfume-10ml-01"),
    hero: hero("83c34def-1780674676242_5yl7hc"),
    alt: "10ml 향수",
    kind: "perfume10",
  },
  perfume50: {
    thumb: thumb("16f8a5b1-perfume-50ml-01"),
    hero: hero("3b88fae5-1780671700412_aet6f6"),
    alt: "50ml 향수",
    kind: "perfume50",
  },
  set10: {
    // 병 두 개가 함께 찍힌 컷 — 낱개와 구분된다
    thumb: thumb("2a6bdff1-chemistry-10ml-set-square"),
    hero: hero("4097994a-1777901298869_cp1pkk"),
    alt: "10ml 두 병 세트",
    kind: "set10",
  },
  set50: {
    thumb: thumb("983c045e-chemistry-50ml-set-square"),
    hero: hero("983c045e-chemistry-50ml-set-square"),
    alt: "50ml 두 병 세트",
    kind: "set50",
  },
  scentPaper: {
    thumb: thumb("7909492f-1780672690139_c69j01"),
    hero: hero("65e03a8a-scent-paper-hand-light-01"),
    alt: "시향지",
    kind: "scentPaper",
  },
  diffuser: {
    alt: "피규어 디퓨저",
    kind: "diffuser",
    reason: "공식 페이지에 피규어 디퓨저 사진이 없습니다",
  },
  sachet: { alt: "사쉐", kind: "sachet", reason: "공식 페이지에서 사쉐 사진을 찾지 못했습니다" },
  ticket: { alt: "입장권", kind: "ticket", reason: "물건이 아닌 항목입니다" },
  etc: { alt: "", kind: "etc" },
};

const has = (s: string, ...keys: string[]) => keys.some((k) => s.includes(k));

/** 이름·옵션·병 수로 유형을 정한다. 금액은 보지 않는다 — 같은 값의 다른 상품이 많다 */
export function productKindKey(p: Pick<SalesProduct, "name" | "option" | "bottles">): ProductKindKey {
  const name = p.name ?? "";
  const option = p.option ?? "";

  // 물건이 아닌 것부터 걸러낸다 (이름에 「향수」가 없어도 옵션이 「기본」이라 헷갈린다)
  if (has(name, "입장권", "쿠폰")) return "ticket";
  if (has(name, "사쉐", "샤쉐")) return "sachet";
  if (has(name, "뿌디", "피규어")) return "diffuser";
  if (has(name, "시향지")) return "scentPaper";

  // 세트 — 병이 둘 이상이거나 옵션에 ×2 가 붙는다
  const isSet = (p.bottles ?? 1) > 1 || /[×x]\s*[2-9]/.test(option);
  if (isSet) return option.startsWith("50") ? "set50" : "set10";

  if (option.startsWith("50")) return "perfume50";
  if (option.startsWith("10")) return "perfume10";
  return "etc";
}

/**
 * 이 상품에 쓸 사진. SKU 에 등록된 실제 사진(imageUrl)이 있으면 그것이 먼저다.
 * 사진이 없는 유형이면 thumb·hero 가 비어 있고, 화면은 중립 아이콘으로 내려간다.
 */
export function productImage(p: SalesProduct): ProductImage {
  const key = productKindKey(p);
  const base = IMAGES[key];
  if (p.imageUrl) return { ...base, thumb: p.imageUrl, hero: p.imageUrl, alt: `${p.name} ${p.option}`.trim() };
  return base;
}

/** 유형만 알 때 (아직 상품이 정해지지 않은 자리) */
export const imageForKind = (k: ProductKindKey): ProductImage => IMAGES[k];
