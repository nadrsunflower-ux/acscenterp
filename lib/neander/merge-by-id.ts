// ============================================================
//  id 로 바꿔 끼우기 — 쓰기 뒤 전체를 다시 받지 않고 바뀐 것만 반영
// ------------------------------------------------------------
//  재무 거래는 1만 건(7MB), 매출 판매 줄은 6천 건(1.6MB)이라 확정 한 번마다
//  전체를 다시 받으면 누를 때마다 굼뜨다. 서버가 쓴 문서를 돌려주면
//  Provider 가 이 함수로 그 문서만 바꿔 끼운다.
// ============================================================

/** 있으면 교체, 없으면 뒤에 붙이고, remove 에 든 id 는 뺀다. 바뀐 게 없으면 같은 배열 */
export function mergeById<T extends { id: string }>(
  list: T[],
  upsert: readonly T[] = [],
  remove: readonly string[] = [],
): T[] {
  if (upsert.length === 0 && remove.length === 0) return list;
  const drop = new Set(remove);
  const next = new Map(upsert.map((x) => [x.id, x]));
  const out: T[] = [];
  list.forEach((x) => {
    if (drop.has(x.id)) return;
    const replaced = next.get(x.id);
    if (replaced) next.delete(x.id);
    out.push(replaced ?? x);
  });
  next.forEach((x) => {
    if (!drop.has(x.id)) out.push(x);
  });
  return out;
}
