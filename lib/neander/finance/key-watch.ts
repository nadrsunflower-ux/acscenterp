// ============================================================
//  예고 없이 생긴 오픈라우터 키 살피기 — 무엇이 새 키이고 무엇을 알릴까 (순수 함수)
// ------------------------------------------------------------
//  오픈라우터는 키가 생겨도 알려 주지 않는다(웹훅 없음). 그래서 키 목록을 볼 때마다
//  처음 보는 키를 찾는다 (server/key-watch.ts — 재무 cron · 문자 받기 · API 비용 화면).
//
//  「예고된 키」 = 만들 때 ERP 에 등록한 키 — API 비용 화면의 붙일 곳(neander_fin_api_alloc)이나
//  AI 사용료 화면의 키 주인(neander_shorts_settings/ai-usage-keys). 2026-11-10 규칙이 「키를 만들면
//  ERP 붙일 곳 · 주인을 같이 정한다」 라서, 등록 없이 생긴 키가 곧 예고되지 않은 키다.
//  만들고 등록하기까지 몇 초~몇 분이 걸리므로 만든 지 GRACE 안의 키는 다음 번까지 기다린다.
//
//  처음 한 번은 지금 있는 키를 모두 「본 키」 로 적고 알리지 않는다(기준선).
//  알림이 실패한 키는 다음 번에 다시 보낸다 (TRIES 번까지).
// ============================================================

/** 키 목록의 한 줄 — UsageKeySnap 중 여기서 쓰는 칸 */
export interface WatchKey {
  hash: string;
  name: string;
  limit: number | null;
  limitReset: "daily" | "weekly" | "monthly" | null;
  disabled: boolean;
  createdAt: string | null;
}

export type SeenState = "baseline" | "registered" | "alerted" | "pending";
export interface SeenKey {
  name: string;
  createdAt: string | null;
  firstSeen: number;
  state: SeenState;
  /** 노션 알림 줄 */
  pageId?: string;
  tries?: number;
  error?: string;
}

/** 만든 뒤 ERP 에 등록할 때까지 기다리는 시간 */
export const KEY_WATCH_GRACE_MS = 15 * 60_000;
/** 알림 실패를 다시 보내는 횟수 */
export const KEY_WATCH_TRIES = 5;

export interface KeySort {
  /** ERP 에 등록돼 있다 — 알리지 않고 본 키로 적는다 */
  registered: WatchKey[];
  /** 예고 없이 생겼다 — 알린다 (지난번 알림이 실패한 키 포함) */
  alert: WatchKey[];
  /** 만든 지 얼마 안 됐다 — 다음 번에 다시 본다 */
  wait: WatchKey[];
}

/**
 * 지금 키 목록에서 새 키를 가른다. seen 에 없거나 알림이 실패해 pending 인 키만 본다.
 * 꺼진 채로 처음 보이는 키는 쓸 수 없으니 알리지 않는다.
 */
export function sortNewKeys(keys: WatchKey[], seen: Record<string, SeenKey>, registered: Set<string>, now: number): KeySort {
  const out: KeySort = { registered: [], alert: [], wait: [] };
  for (const k of keys) {
    const s = seen[k.hash];
    if (s && s.state !== "pending") continue;
    if (s?.state === "pending" && (s.tries ?? 0) >= KEY_WATCH_TRIES) continue;
    if (registered.has(k.hash) || k.disabled) {
      out.registered.push(k);
      continue;
    }
    const made = k.createdAt ? Date.parse(k.createdAt) : NaN;
    if (!s && Number.isFinite(made) && now - made < KEY_WATCH_GRACE_MS) out.wait.push(k);
    else out.alert.push(k);
  }
  return out;
}

/** `$250 · 매달 다시 참` · `$250 누적` · `한도 없음` */
export function limitText(k: Pick<WatchKey, "limit" | "limitReset">): string {
  if (k.limit === null) return "한도 없음";
  const usd = `$${Number.isInteger(k.limit) ? k.limit : k.limit.toFixed(2)}`;
  const reset = { daily: "매일 다시 참", weekly: "매주 다시 참", monthly: "매달 다시 참" } as const;
  return k.limitReset ? `${usd} · ${reset[k.limitReset]}` : `${usd} 누적`;
}

/** ISO 시각 → `11/10 20:04` (한국 시각). 없으면 「모름」 */
export function kstStamp(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "모름";
  const d = new Date(t + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 폰 알림 글 — 미리보기에 키 이름부터 보이게 */
export function keyAlertMessage(k: WatchKey, test = false): string {
  const head = test ? "[테스트] " : "";
  const warn = k.limit === null ? " 한도가 없어 쓰는 만큼 나갑니다." : "";
  return (
    `${head}🔑 예고 없는 오픈라우터 키 「${k.name}」 — ${kstStamp(k.createdAt)} 생성 · ${limitText(k)}.${warn} ` +
    "ERP에 붙일 곳이 없는 키입니다. 예고한 키면 API 비용 화면에서 붙일 곳을 정하고, 모르는 키면 오픈라우터에서 끄세요."
  );
}
