// quotation-neander 의 분류와 공급자 업종 선택지. 저장된 공급자 정보는 그대로 사용한다.
export const QUOTE_CATEGORIES = [
  "AI 체험형 컨텐츠", "개발", "향수 판매", "마케팅", "행사", "컨설팅", "강의", "비교견적서",
] as const;

export const QUOTE_BUSINESS_OPTIONS: Record<string, { types: string[]; items: string[] }> = {
  neander: {
    types: ["도매 및 소매업", "정보통신업", "서비스업", "사업시설 관리, 사업지원 및 임대 서비스업"],
    items: ["화장품 도소매업", "전자상거래 소매 중개업", "포털 및 기타 인터넷 정보 매개 서비스업", "응용 소프트웨어 개발 및 공급업", "광고 기획 및 제작, 판매업", "광고물 디자인업", "사진 촬영 및 처리업", "전시, 컨벤션 및 행사 대행업", "제품 디자인업"],
  },
  ilhaera: {
    types: ["도매 및 소매업", "정보통신업", "서비스업"],
    items: ["전자상거래 소매 중개업", "컴퓨터 프로그래밍 서비스업", "경영 컨설팅업"],
  },
  wajakhomes: {
    types: ["소매업", "서비스업"],
    items: ["전자상거래 소매업", "광고 대행업", "시각 디자인업"],
  },
};

/** 항목 자체의 쉼표를 유지한다. 사용자가 직접 적은 업종도 선택 전환 시 잃지 않는다. */
export const hasBusinessChoice = (current: string, option: string): boolean =>
  `, ${current}, `.includes(`, ${option}, `);

export function toggleBusinessChoice(current: string, option: string): string {
  if (!hasBusinessChoice(current, option)) return [current.trim(), option].filter(Boolean).join(", ");
  return `, ${current}, `.replace(`, ${option}, `, ", ").slice(2, -2).trim();
}
