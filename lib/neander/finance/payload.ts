// ============================================================
//  재무 거래 — 화면으로 보낼 모양
// ------------------------------------------------------------
//  화면이 읽지 않는 필드는 보내지 않는다 (7.1MB 중 약 2할).
//    dedupHash      적재 중복 검사 전용 — 적재 화면은 /api/neander/finance/dedup
//                   에서 개수만 받는다
//    importBatchId  적재 되돌리기 전용 — 서버가 where 로 찾는다
//    createdAt · updatedBy   화면이 읽지 않는다
//  남기는 것:
//    updatedAt      동기화 중 늦게 도착한 옛 값이 새 값을 덮지 않게 비교한다
//    classReason    확정 거래에서도 뺄 수 없다 — 거래 편집기가 「근거」로 보여주고,
//                   금액 나누기(AmountBreakdown)가 되돌리기용으로 들고 있다가
//                   되쓴다. 비어 있으면 서버의 근거 문구가 지워진다.
//
//  ⚠️ 그래서 화면이 들고 있는 거래는 **온전한 문서가 아니다.** 그대로 되쓰면
//     (되돌리기) 위 필드가 지워진다 — transaction.restore 는 빠진 필드를
//     지금 문서(지워졌으면 휴지통 원본)에서 채운다. FIN_HIDDEN_FIELDS 가 그 목록이다.
//     타입(FinTransaction)은 온전한 문서 기준이라 dedupHash 가 필수로 적혀 있지만,
//     화면에서는 비어 있다.
// ============================================================

export const FIN_HIDDEN_FIELDS = ["dedupHash", "importBatchId", "createdAt", "updatedBy"] as const;

export function trimTransaction(doc: Record<string, unknown>): Record<string, unknown> {
  const { dedupHash: _d, importBatchId: _i, createdAt: _c, updatedBy: _u, ...rest } = doc;
  return rest;
}
