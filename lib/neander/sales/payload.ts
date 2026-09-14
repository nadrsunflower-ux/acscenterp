// ============================================================
//  판매 줄 — 화면으로 보낼 모양
// ------------------------------------------------------------
//  화면이 읽지 않는 필드는 보내지 않는다 (finance/payload.ts 와 같은 규칙).
//    importId       적재 되돌리기 전용 — 서버가 where 로 찾는다
//    createdAt · updatedBy   화면이 읽지 않는다
//  updatedAt 은 남긴다 — 동기화가 새 값을 옛 값으로 덮지 않게 비교한다.
//
//  ⚠️ 되돌리기(line.restore)는 빠진 필드를 지금 문서나 휴지통 원본에서 채운다.
// ============================================================

export const LINE_HIDDEN_FIELDS = ["importId", "createdAt", "updatedBy"] as const;

export function trimLine(doc: Record<string, unknown>): Record<string, unknown> {
  const { importId: _i, createdAt: _c, updatedBy: _u, ...rest } = doc;
  return rest;
}
