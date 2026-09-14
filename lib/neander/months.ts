// ============================================================
//  달(YYYY-MM) 도우미 — 매출·재무 적재 퍼즐이 함께 쓴다
// ------------------------------------------------------------
//  "데이터가 있는 달" 만 고를 수 있으면 아직 아무것도 안 올린 새 달을
//  고를 수 없다. 적재 화면은 그 달이 필요하므로, 가장 이른 달부터 이번
//  달까지 빠짐없이 채운 목록을 만든다.
// ============================================================

export const todayMonth = () => new Date().toISOString().slice(0, 7);

export const isMonth = (m: string) => /^\d{4}-\d{2}$/.test(m);

export function addMonth(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
}

/**
 * 고를 수 있는 달 — 알려진 가장 이른 달부터 이번 달까지 빠짐없이, 미래에
 * 잡힌 것이 있으면 그 달까지. 최신순.
 */
export function selectableMonths(known: string[], upTo = todayMonth()): string[] {
  const set = new Set(known.filter(isMonth));
  const sorted = [...set].sort();
  const first = sorted[0] ?? upTo;
  const last = sorted[sorted.length - 1] ?? upTo;
  const end = last > upTo ? last : upTo;
  for (let m = first; m <= end; m = addMonth(m, 1)) set.add(m);
  return [...set].sort().reverse();
}

/**
 * 처음 열 때 보여줄 달 — 할 일이 있는 달.
 *
 *   ① 무언가 들어왔는데 아직 다 안 찬 달 중 **가장 최근**
 *   ② 없으면 마지막으로 채운 달의 **다음 달** (이번 달까지)
 *   ③ 아무것도 없으면 지난달 (이번 달 파일은 다음 달에 나온다)
 *
 * 과거의 어떤 달이 한 칸 비어 있다고 매번 그 달을 먼저 보여주면 새 달
 * 작업을 할 때마다 넘겨야 한다 — 그래서 ①은 "있는 것 중 최근"이다.
 */
export function workingMonthOf(
  months: string[],
  statusOf: (month: string) => { filled: number; complete: boolean },
): string {
  const asc = [...months].sort();
  const loaded = asc.filter((m) => statusOf(m).filled > 0);
  if (loaded.length === 0) {
    const prev = addMonth(todayMonth(), -1);
    return asc.includes(prev) ? prev : asc[0] ?? todayMonth();
  }
  const partial = loaded.filter((m) => !statusOf(m).complete);
  if (partial.length > 0) return partial[partial.length - 1];
  const next = addMonth(loaded[loaded.length - 1], 1);
  return next <= todayMonth() ? next : loaded[loaded.length - 1];
}
