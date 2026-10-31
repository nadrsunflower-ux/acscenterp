// ============================================================
//  상품코드 — 매장·유형에서 접두를 정하고 다음 빈 번호를 붙인다
// ------------------------------------------------------------
//  검토 대기함 「새 상품 만들기」 · 마스터 「상품 추가」 · 매출 비서의
//  상품 제안이 모두 이 규칙을 쓴다. 사람이 코드 체계를 외우게 만들 이유가
//  없고, 세 곳이 따로 세면 같은 코드를 두 번 내줄 수 있다.
// ============================================================

import type { SalesKind, SalesProduct, SalesStore } from "./types";

export const PRODUCT_CODE_PREFIX: Record<SalesStore, Record<SalesKind, string>> = {
  id: { event: "IDE", regular: "IDI" },
  wow: { event: "WOW", regular: "WOW" },
  online: { event: "ONL", regular: "ONL" },
};

/** 같은 접두(IDI·IDE·WOW·ONL)에서 다음 빈 번호 — IDE-012 */
export function nextProductCode(products: Pick<SalesProduct, "id">[], prefix: string): string {
  const used = products
    .map((p) => p.id)
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n));
  return `${prefix}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
}
