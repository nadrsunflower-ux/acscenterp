// ============================================================
//  AI 사용료 — 오픈라우터 키마다 쓴 돈을 사람 · 달로 (순수 함수)
// ------------------------------------------------------------
//  영상 만드는 사람들이 한 오픈라우터 계정에서 키를 하나씩 따서 쓴다. 오픈라우터는
//  키마다 「누적 · 이번 달 · 이번 주 · 오늘」 금액을 주지만, 달이 바뀌면 이번 달 값이
//  0 으로 돌아가 지난달 금액이 사라진다. 그래서 하루 한 번(아침 cron · 화면을 열 때)
//  키 목록을 통째로 찍어 둔다 — 문서 하나 = 한국 날짜 하루의 마지막 상태.
//
//  달별 금액 (오픈라우터와 같은 UTC 달 — 한국 시간 매달 1일 오전 9시에 바뀐다):
//    · 그 달 안의 기록은 「이번 달」 값의 마지막 것 (달 안에서는 늘기만 한다)
//    · 달이 바뀐 바로 뒤 기록 b 와 그 앞 기록 a 를 이어 보면 a 이후 그 달에 쓴 돈이 나온다
//        a 이후 지난달 몫 = (b 누적 − a 누적) − b 이번 달
//      그래서 기록이 하루 한 번이어도 달 경계에서 잃는 돈이 없다.
//    · 기록이 두 달 넘게 비면 그 사이를 나누지 않는다 (아는 만큼만).
//
//  키가 만료 · 삭제되면 오픈라우터 목록에서 사라진다. 기록에 남은 마지막 값으로 계속
//  센다. 기록을 시작하기 전에 사라진 키의 돈은 누가 썼는지 알 수 없어 「키에 안 잡힌 돈」
//  (계정 전체 사용액 − 아는 키들의 누적) 한 줄로만 보인다.
//
//  키의 주인(사람 · ERP 서버 · 서비스)은 ERP 에서 정한다 — 키 이름은 제각각이라 추정하지 않는다.
//  사람 이름 · 메일은 코드에 적지 않는다 (공개 저장소).
// ============================================================

export const OWNER_ERP = "erp";
export const OWNER_SERVICE = "service";
/** 사람이 아닌 주인 — 사람(ERP 팀원 메일)은 이름으로 보인다 */
export const OWNER_GROUP_LABEL: Record<string, string> = {
  [OWNER_ERP]: "ERP 서버",
  [OWNER_SERVICE]: "서비스 · 개발",
};
export const OWNER_NONE_LABEL = "주인 없음";

export type LimitReset = "daily" | "weekly" | "monthly";
export const LIMIT_RESET_LABEL: Record<LimitReset, string> = { daily: "매일", weekly: "매주", monthly: "매달" };

export interface UsageKeySnap {
  /** 오픈라우터 키 해시 — 키 값이 아니다 (키 값은 오픈라우터도 다시 보여 주지 않는다) */
  hash: string;
  name: string;
  /** 키를 만든 뒤 쓴 돈 (달러) */
  usage: number;
  /** 이번 UTC 달 · 이번 주(월요일 시작) · 오늘 (UTC 자정 기준) */
  usageMonthly: number;
  usageWeekly: number;
  usageDaily: number;
  /** 한도 (달러) — 없으면 null */
  limit: number | null;
  /** 한도가 다시 채워지는 주기 — 없으면 누적 한도 */
  limitReset: LimitReset | null;
  limitRemaining: number | null;
  disabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

export interface UsageSnapshot {
  at: number;
  /** 계정에 충전한 돈 · 쓴 돈 (달러) */
  totalCredits: number;
  totalUsage: number;
  keys: UsageKeySnap[];
}

export interface KeyAssignment {
  /** ERP 팀원 메일 · OWNER_ERP · OWNER_SERVICE · ""(주인 없음) */
  owner: string;
  /** 용도 — 「영상」 「SMOAT 운영」 … */
  purpose?: string;
  updatedAt?: number;
  updatedBy?: string;
}

const DAY = 86_400_000;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** 오픈라우터 GET /api/v1/keys 의 한 줄 → 기록 모양. 해시가 없으면 null */
export function keySnapFromApi(raw: Record<string, unknown>): UsageKeySnap | null {
  const hash = strOrNull(raw.hash);
  if (!hash) return null;
  const reset = raw.limit_reset;
  return {
    hash,
    name: strOrNull(raw.name) ?? strOrNull(raw.label) ?? hash.slice(0, 8),
    usage: num(raw.usage),
    usageMonthly: num(raw.usage_monthly),
    usageWeekly: num(raw.usage_weekly),
    usageDaily: num(raw.usage_daily),
    limit: numOrNull(raw.limit),
    limitReset: reset === "daily" || reset === "weekly" || reset === "monthly" ? reset : null,
    limitRemaining: numOrNull(raw.limit_remaining),
    disabled: raw.disabled === true,
    expiresAt: strOrNull(raw.expires_at),
    lastUsedAt: strOrNull(raw.last_used_at),
    createdAt: strOrNull(raw.created_at),
  };
}

/** UTC 달 `YYYY-MM` — 오픈라우터 「이번 달」 과 같은 경계 */
export const utcMonth = (ms: number) => new Date(ms).toISOString().slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** 기록 문서 id — 한국 날짜 `YYYY-MM-DD` (하루에 하나, 그날의 마지막 상태로 덮어쓴다) */
export const snapshotId = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 키별 · 달별 사용액 (달러). 맨 위 설명의 방식 — 달 안은 「이번 달」 의 마지막 값,
 * 달 경계는 앞뒤 기록의 누적 차이로 메운다.
 */
export function monthlyByKey(snaps: UsageSnapshot[]): Map<string, Map<string, number>> {
  const sorted = [...snaps].sort((a, b) => a.at - b.at);
  const out = new Map<string, Map<string, number>>();
  const put = (hash: string, month: string, v: number) => {
    let m = out.get(hash);
    if (!m) out.set(hash, (m = new Map()));
    m.set(month, round(Math.max(m.get(month) ?? 0, v)));
  };
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const month = utcMonth(a.at);
    for (const k of a.keys) put(k.hash, month, k.usageMonthly);
    const b = sorted[i + 1];
    if (!b || utcMonth(b.at) !== shiftMonth(month, 1)) continue;
    const before = new Map(a.keys.map((k) => [k.hash, k]));
    for (const k of b.keys) {
      const p = before.get(k.hash);
      // a 에 없던 키는 a 뒤에 만든 것만 0 에서 시작한다 (아니면 모르는 키라 건너뜀)
      const start = p ? p.usage : k.createdAt && Date.parse(k.createdAt) > a.at ? 0 : null;
      if (start === null) continue;
      const tail = k.usage - start - k.usageMonthly;
      if (tail > 1e-9) put(k.hash, month, (p?.usageMonthly ?? 0) + tail);
    }
  }
  return out;
}

// ---- 화면 하나 분량 ----------------------------------------------------------

export interface UsageKeyRow {
  hash: string;
  name: string;
  owner: string;
  purpose: string;
  /** 이번 달 · 지난달(기록이 없으면 null) · 이번 주 · 오늘 · 누적 */
  month: number;
  prevMonth: number | null;
  week: number;
  today: number;
  total: number;
  limit: number | null;
  limitReset: LimitReset | null;
  limitRemaining: number | null;
  /** 한도 중 쓴 몫 0~1 (한도가 없으면 null) */
  limitRatio: number | null;
  disabled: boolean;
  /** 오픈라우터 목록에서 사라졌다 — 만료 · 삭제. 값은 기록의 마지막 것 */
  gone: boolean;
  lastUsedAt: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface UsageOwnerRow {
  owner: string;
  month: number;
  prevMonth: number | null;
  week: number;
  today: number;
  keys: number;
}

export interface UsageMonthRow {
  month: string;
  total: number;
  byOwner: Record<string, number>;
}

export interface UsageWarning {
  tone: "danger" | "warning";
  text: string;
  hash?: string;
}

export interface UsageView {
  at: number;
  /** 지금 UTC 달 · 지난 달 */
  month: string;
  prevMonth: string;
  credits: { total: number; used: number; balance: number };
  /** 하루 평균 사용 — 기록이 3일 넘게 쌓이면 기록으로, 아니면 오픈라우터의 이번 주 · 이번 달 값으로 */
  pace: { perDay: number; basis: "history" | "week" | "month"; days: number };
  /** 이 속도면 충전 잔액이 며칠 가나 (안 쓰면 null) */
  daysLeft: number | null;
  keys: UsageKeyRow[];
  owners: UsageOwnerRow[];
  months: UsageMonthRow[];
  /** 키에 안 잡힌 돈 — 기록 전에 사라진 키 · 오픈라우터 사이트 채팅 (누적) */
  untracked: number;
  /** 첫 기록 시각 */
  since: number;
  warnings: UsageWarning[];
}

const ownerRank = (o: string) => (o === OWNER_ERP ? 1 : o === OWNER_SERVICE ? 2 : o === "" ? 3 : 0);

/** 오픈라우터 주(월요일 00:00 UTC)의 시작 */
const weekStart = (ms: number) => {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
};
const monthStart = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * 지금 상태(live) + 지난 기록(snaps — live 를 포함해도 된다) + 주인 정한 것 → 화면 하나.
 */
export function buildUsageView(input: { live: UsageSnapshot; snaps: UsageSnapshot[]; assign: Record<string, KeyAssignment> }): UsageView {
  const { live, assign } = input;
  const all = [...input.snaps.filter((s) => s.at < live.at), live].sort((a, b) => a.at - b.at);
  const month = utcMonth(live.at);
  const prevMonth = shiftMonth(month, -1);
  const monthly = monthlyByKey(all);
  const prevKnown = all.some((s) => utcMonth(s.at) === prevMonth);

  // 사라진 키 — 기록의 마지막 모습
  const liveHashes = new Set(live.keys.map((k) => k.hash));
  const lastSeen = new Map<string, UsageKeySnap>();
  for (const s of all) for (const k of s.keys) if (!liveHashes.has(k.hash)) lastSeen.set(k.hash, k);

  const row = (k: UsageKeySnap, gone: boolean): UsageKeyRow => {
    const a = assign[k.hash];
    const m = monthly.get(k.hash);
    const thisMonth = gone ? (m?.get(month) ?? 0) : k.usageMonthly;
    const limitRatio = k.limit && k.limit > 0 && k.limitRemaining !== null ? Math.max(0, 1 - k.limitRemaining / k.limit) : null;
    return {
      hash: k.hash,
      name: k.name,
      owner: a?.owner ?? "",
      purpose: a?.purpose ?? "",
      month: round(thisMonth),
      prevMonth: prevKnown ? round(m?.get(prevMonth) ?? 0) : null,
      week: gone ? 0 : k.usageWeekly,
      today: gone ? 0 : k.usageDaily,
      total: k.usage,
      limit: k.limit,
      limitReset: k.limitReset,
      limitRemaining: k.limitRemaining,
      limitRatio,
      disabled: k.disabled,
      gone,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    };
  };
  const keys = [
    ...live.keys.map((k) => row(k, false)),
    // 사라진 키는 이번 달 · 지난달에 쓴 게 있을 때만 줄로 남긴다
    ...[...lastSeen.values()].map((k) => row(k, true)).filter((r) => r.month > 0 || (r.prevMonth ?? 0) > 0),
  ].sort((a, b) => b.month - a.month || b.total - a.total || a.name.localeCompare(b.name));

  // 사람별
  const byOwner = new Map<string, UsageOwnerRow>();
  for (const r of keys) {
    const o = byOwner.get(r.owner) ?? { owner: r.owner, month: 0, prevMonth: prevKnown ? 0 : null, week: 0, today: 0, keys: 0 };
    o.month = round(o.month + r.month);
    if (o.prevMonth !== null) o.prevMonth = round(o.prevMonth + (r.prevMonth ?? 0));
    o.week = round(o.week + r.week);
    o.today = round(o.today + r.today);
    if (!r.gone) o.keys += 1;
    byOwner.set(r.owner, o);
  }
  const owners = [...byOwner.values()]
    .filter((o) => o.keys > 0 || o.month > 0 || (o.prevMonth ?? 0) > 0)
    .sort((a, b) => ownerRank(a.owner) - ownerRank(b.owner) || b.month - a.month);

  // 달별 — 기록이 있는 달만 (첫 달은 그 달의 「이번 달」 값이 처음부터 들어 있다)
  const ownerOf = (hash: string) => assign[hash]?.owner ?? "";
  const monthSet = new Set<string>();
  for (const m of monthly.values()) for (const k of m.keys()) monthSet.add(k);
  const months = [...monthSet]
    .sort()
    .reverse()
    .slice(0, 12)
    .map((mo) => {
      const r: UsageMonthRow = { month: mo, total: 0, byOwner: {} };
      for (const [hash, m] of monthly) {
        const v = m.get(mo) ?? 0;
        if (!v) continue;
        const o = ownerOf(hash);
        r.byOwner[o] = round((r.byOwner[o] ?? 0) + v);
        r.total = round(r.total + v);
      }
      return r;
    })
    .filter((r) => r.total > 0);

  // 키에 안 잡힌 돈
  const known = live.keys.reduce((n, k) => n + k.usage, 0) + [...lastSeen.values()].reduce((n, k) => n + k.usage, 0);
  const untracked = Math.max(0, round(live.totalUsage - known));

  // 하루 평균 · 남은 날
  const balance = round(live.totalCredits - live.totalUsage);
  const ref = all.find((s) => live.at - s.at >= 3 * DAY && live.at - s.at <= 14 * DAY);
  let pace: UsageView["pace"];
  if (ref) {
    const days = (live.at - ref.at) / DAY;
    pace = { perDay: round(Math.max(0, live.totalUsage - ref.totalUsage) / days), basis: "history", days: round(days) };
  } else {
    const wDays = (live.at - weekStart(live.at)) / DAY;
    const mDays = (live.at - monthStart(live.at)) / DAY;
    const useWeek = wDays >= mDays;
    const days = Math.max(1, useWeek ? wDays : mDays);
    const spent = live.keys.reduce((n, k) => n + (useWeek ? k.usageWeekly : k.usageMonthly), 0);
    pace = { perDay: round(spent / days), basis: useWeek ? "week" : "month", days: round(useWeek ? wDays : mDays) };
  }
  const daysLeft = pace.perDay > 0 ? round(Math.max(0, balance) / pace.perDay) : null;

  // 알릴 것
  const warnings: UsageWarning[] = [];
  if (balance <= 0) warnings.push({ tone: "danger", text: `충전 잔액이 없습니다 (${usd(balance)}) — 이 계정의 모든 키가 멈춥니다.` });
  else if (daysLeft !== null && daysLeft < 1) warnings.push({ tone: "danger", text: `충전 잔액 ${usd(balance)} — 지금 쓰는 속도(하루 약 ${usd(pace.perDay)})면 하루 안에 바닥납니다. 바닥나면 이 계정의 모든 키가 멈춥니다.` });
  else if (daysLeft !== null && daysLeft < 3) warnings.push({ tone: "warning", text: `충전 잔액 ${usd(balance)} — 지금 속도로 약 ${Math.floor(daysLeft)}일 남았습니다.` });
  for (const r of keys) {
    if (r.gone || r.disabled) continue;
    const reset = r.limitReset ? `${LIMIT_RESET_LABEL[r.limitReset]} 다시 채워짐` : "누적 한도라 다시 안 채워짐";
    if (r.limit !== null && r.limitRemaining !== null && r.limitRemaining <= 0) warnings.push({ tone: "danger", hash: r.hash, text: `${r.name} — 한도 ${usd(r.limit)} 를 다 써서 막혔습니다 (${reset}).` });
    else if (r.limitRatio !== null && r.limitRatio >= 0.8) warnings.push({ tone: "warning", hash: r.hash, text: `${r.name} — 한도의 ${Math.floor(r.limitRatio * 100)}% 를 썼습니다 (남은 ${usd(r.limitRemaining ?? 0)} · ${reset}).` });
    if (r.limit === null && r.month > 0 && r.owner && !OWNER_GROUP_LABEL[r.owner]) warnings.push({ tone: "warning", hash: r.hash, text: `${r.name} — 사람 키인데 한도가 없습니다 (이번 달 ${usd(r.month)}).` });
  }
  const orphan = keys.filter((r) => !r.gone && !r.owner && r.total > 0);
  if (orphan.length) warnings.push({ tone: "warning", text: `주인을 정하지 않은 키가 ${orphan.length}개 있습니다 — ${orphan.map((r) => r.name).join(", ")}.` });
  warnings.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1));

  return {
    at: live.at,
    month,
    prevMonth,
    credits: { total: live.totalCredits, used: live.totalUsage, balance },
    pace,
    daysLeft,
    keys,
    owners,
    months,
    untracked,
    since: all[0]?.at ?? live.at,
    warnings,
  };
}

/** 주인 값 확인 — 팀원 메일 · 그룹 · 빈 값만 */
export function cleanOwner(v: unknown, memberEmails: string[]): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s || OWNER_GROUP_LABEL[s]) return s;
  return memberEmails.map((e) => e.toLowerCase()).includes(s) ? s : null;
}

export const cleanPurpose = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
