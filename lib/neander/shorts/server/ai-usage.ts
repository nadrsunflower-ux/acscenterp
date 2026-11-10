import "server-only";

// ============================================================
//  AI 사용료 — 오픈라우터 관리 키로 키 목록 · 충전 잔액을 읽어 기록한다
// ------------------------------------------------------------
//  OPENROUTER_MANAGEMENT_KEY — 오픈라우터 설정의 Management key. 키 목록 · 사용액을 읽고
//  키 한도를 바꿀 수 있지만 영상 · 글 생성은 못 하는 키다. 여기서는 읽기만 한다.
//  키 값은 서버 밖으로 나가지 않는다 (화면에는 해시 · 이름 · 금액만).
//
//  기록: neander_shorts_ai_usage/{한국 날짜} — 그날의 마지막 상태로 덮어쓴다. 아침 cron 과
//  화면을 열 때 찍는다. 주인(누구 키인가)은 neander_shorts_settings/ai-usage-keys 하나에
//  해시별로 — 프로젝트(space)와 상관없는 계정 단위라 늘 원래 컬렉션을 쓴다 (access 문서와 같다).
// ============================================================

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  buildUsageView,
  cleanOwner,
  cleanPurpose,
  keySnapFromApi,
  snapshotId,
  type KeyAssignment,
  type UsageKeySnap,
  type UsageSnapshot,
  type UsageView,
} from "../ai-usage";

const BASE = "https://openrouter.ai/api/v1";
/** 달별 금액에 쓰는 기록 — 13달이면 지난 1년이 다 나온다 */
const HISTORY_DAYS = 400;

export const managementKey = () => (process.env.OPENROUTER_MANAGEMENT_KEY ?? "").trim();

async function orGet<T>(path: string): Promise<T> {
  const key = managementKey();
  if (!key) throw new Error("OPENROUTER_MANAGEMENT_KEY 가 설정되지 않았습니다.");
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`오픈라우터 ${path.split("?")[0]} 응답 ${res.status}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** 꺼 둔 키까지 모든 키 (여러 쪽) — 새 키 살피기(finance/server/key-watch.ts)도 쓴다 */
export async function fetchKeySnaps(): Promise<UsageKeySnap[]> {
  const seen = new Map<string, UsageKeySnap>();
  for (let offset = 0, page = 0; page < 20; page++) {
    const r = await orGet<{ data?: Record<string, unknown>[] }>(`/keys?include_disabled=true&offset=${offset}`);
    const rows = (r.data ?? []).map(keySnapFromApi).filter((k): k is UsageKeySnap => !!k);
    const fresh = rows.filter((k) => !seen.has(k.hash));
    for (const k of fresh) seen.set(k.hash, k);
    if (!fresh.length) break;
    offset += rows.length;
  }
  return [...seen.values()];
}

/** 지금 상태 — 꺼 둔 키까지 모든 키 + 계정 충전 · 사용 */
export async function fetchUsageSnapshot(): Promise<UsageSnapshot> {
  const keys = await fetchKeySnaps();
  const c = await orGet<{ data?: { total_credits?: number; total_usage?: number } }>("/credits");
  return { at: Date.now(), totalCredits: c.data?.total_credits ?? 0, totalUsage: c.data?.total_usage ?? 0, keys };
}

const snapsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsAiUsage);
const assignRef = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings).doc("ai-usage-keys");

export async function recordSnapshot(db: Firestore, s: UsageSnapshot): Promise<void> {
  await snapsCol(db).doc(snapshotId(s.at)).set(s);
}

async function loadSnapshots(db: Firestore): Promise<UsageSnapshot[]> {
  const from = snapshotId(Date.now() - HISTORY_DAYS * 86_400_000);
  const snap = await snapsCol(db).where(FieldPath.documentId(), ">=", from).get();
  return snap.docs.map((d) => d.data() as UsageSnapshot).filter((s) => typeof s.at === "number" && Array.isArray(s.keys));
}

async function loadAssignments(db: Firestore): Promise<Record<string, KeyAssignment>> {
  const d = (await assignRef(db).get()).data() as { keys?: Record<string, KeyAssignment> } | undefined;
  return d?.keys ?? {};
}

/** 아침 cron — 지금 상태를 찍어 두기만 한다 */
export async function recordUsageNow(db: Firestore): Promise<{ keys: number; balance: number }> {
  const s = await fetchUsageSnapshot();
  await recordSnapshot(db, s);
  return { keys: s.keys.length, balance: Math.round((s.totalCredits - s.totalUsage) * 100) / 100 };
}

/** 화면 — 지금 상태를 읽어 기록하고, 지난 기록과 주인을 붙여 화면 하나로 */
export async function usageView(db: Firestore): Promise<UsageView> {
  const live = await fetchUsageSnapshot();
  await recordSnapshot(db, live);
  const [snaps, assign] = await Promise.all([loadSnapshots(db), loadAssignments(db)]);
  return buildUsageView({ live, snaps, assign });
}

/** 키 주인 · 용도 정하기 — 주인은 ERP 팀원 메일이거나 ERP 서버 · 서비스 · 빈 값 */
export async function saveAssignment(db: Firestore, by: string, input: { hash?: unknown; owner?: unknown; purpose?: unknown }): Promise<KeyAssignment> {
  const hash = typeof input.hash === "string" ? input.hash.trim() : "";
  if (!/^[a-f0-9]{16,128}$/i.test(hash)) throw new Error("키를 알아볼 수 없습니다.");
  const members = (await db.collection(NEANDER_COL.members).get()).docs.map((d) => String((d.data() as { email?: string }).email ?? "")).filter(Boolean);
  const owner = cleanOwner(input.owner, members);
  if (owner === null) throw new Error("주인은 ERP 팀원이거나 「ERP 서버」 · 「서비스 · 개발」 이어야 합니다.");
  const next: KeyAssignment = { owner, purpose: cleanPurpose(input.purpose), updatedAt: Date.now(), updatedBy: by };
  await assignRef(db).set({ keys: { [hash]: next }, updatedAt: next.updatedAt, updatedBy: by }, { merge: true });
  return next;
}
