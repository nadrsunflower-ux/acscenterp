// AI STUDIO 비서 — 성과 묶기 (순수 함수)
// 실행: npx tsx --conditions react-server --test lib/neander/shorts/server/assistant-tools.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatePerformance, weekOf, ymd } from "./assistant-tools";
import type { MetricSnapshotView, PublicationView } from "../types";

const KST = (d: string) => Date.parse(`${d}T03:00:00Z`); // 한국 낮 12시

const videos = [
  { id: "v1", title: "물막이 1편", kind: "coupang" as const, spaceId: "salim" },
  { id: "v2", title: "선반 2편", kind: "general" as const, spaceId: "salim" },
  { id: "v3", title: "뭉치 1화", kind: "coupang" as const, spaceId: "spmoong01" },
];

const pub = (id: string, projectId: string, platform: "youtube" | "instagram", day: string, status: PublicationView["status"] = "published") =>
  ({ id, projectId, platform, status, result: status === "published" ? { externalId: id, url: null, at: KST(day), by: "api" } : null, updatedAt: KST(day) }) as Pick<PublicationView, "id" | "projectId" | "platform" | "status" | "result" | "updatedAt">;

const snap = (projectId: string, publicationId: string | null, platform: MetricSnapshotView["platform"], at: string, values: MetricSnapshotView["values"], source: MetricSnapshotView["source"] = "youtube_api"): MetricSnapshotView =>
  ({ id: `${projectId}-${publicationId}-${at}`, owner: "a@x", projectId, publicationId, platform, at: KST(at), source, values, note: "", by: "a@x" }) as MetricSnapshotView;

const pubs = [
  pub("p1", "v1", "youtube", "2026-11-02"),
  pub("p2", "v1", "instagram", "2026-11-03"),
  pub("p3", "v2", "youtube", "2026-11-03"),
  pub("p4", "v3", "youtube", "2026-10-20"),
  pub("p5", "v2", "instagram", "2026-11-04", "scheduled"),
];
const metrics = [
  snap("v1", "p1", "youtube", "2026-11-03", { views: 1000, likes: 10 }),
  snap("v1", "p1", "youtube", "2026-11-04", { views: 1500, likes: 12 }),
  snap("v1", "p2", "instagram", "2026-11-04", { views: 300 }, "instagram_api"),
  // v2 유튜브 — 숫자 없음 (모름)
  snap("v1", null, "coupang", "2026-11-04", { clicks: 40, orders: 2, revenue: 3000 }, "coupang_api"),
  snap("v3", "p4", "youtube", "2026-10-25", { views: 9000 }),
  // 게시 기록 없이 적힌 숫자
  snap("v2", null, "instagram", "2026-11-01", { views: 50 }, "manual"),
];

test("weekOf — 그 주 월요일", () => {
  assert.equal(weekOf("2026-11-04"), "2026-11-02"); // 수 → 월
  assert.equal(weekOf("2026-11-02"), "2026-11-02");
  assert.equal(weekOf("2026-11-08"), "2026-11-02"); // 일
  assert.equal(ymd(Date.parse("2026-11-03T16:00:00Z")), "2026-11-04"); // 한국 새벽 1시
});

test("플랫폼별 — 마지막 누적 기록 · 숫자 없는 게시는 따로 · 쿠팡은 영상 단위", () => {
  const r = aggregatePerformance({ videos, pubs, metrics, from: "2026-11-01", to: "2026-11-30", by: "platform" });
  const yt = r.rows.find((x) => x.key === "youtube")!;
  assert.equal(yt.posts, 2);
  assert.equal(yt.videos, 2);
  assert.equal(yt.postsWithNumbers, 1);
  assert.equal(yt.postsWithoutNumbers, 1);
  assert.equal(yt.totals.views, 1500); // 1000 + 1500 이 아니라 마지막 1500
  const ig = r.rows.find((x) => x.key === "instagram")!;
  assert.equal(ig.posts, 1); // 예약은 게시가 아니다
  assert.equal(ig.totals.views, 300);
  const cp = r.rows.find((x) => x.key === "coupang")!;
  assert.equal(cp.posts, 0);
  assert.deepEqual(cp.totals, { clicks: 40, orders: 2, revenue: 3000 });
  assert.equal(r.total.posts, 3);
  assert.equal(r.total.videos, 2); // 영상 편수 ≠ 게시 건수
  assert.equal(r.total.totals.views, 1800);
  assert.equal(r.unattributed, 1);
  assert.deepEqual(r.rows.map((x) => x.key), ["youtube", "instagram", "coupang"]);
});

test("숫자가 하나도 없으면 null 이 아니라 칸이 없다 (0 으로 채우지 않는다)", () => {
  const r = aggregatePerformance({ videos, pubs, metrics, from: "2026-11-03", to: "2026-11-03", by: "video" });
  const v2 = r.rows.find((x) => x.key === "v2")!;
  assert.equal(v2.posts, 1);
  assert.equal(v2.postsWithoutNumbers, 1);
  assert.equal(v2.totals.views, undefined);
});

test("프로젝트별 · 기간 밖은 빠진다", () => {
  const r = aggregatePerformance({ videos, pubs, metrics, by: "project", projectLabel: (id) => (id === "salim" ? "살림" : "뭉치") });
  assert.equal(r.rows.find((x) => x.key === "spmoong01")?.totals.views, 9000);
  const nov = aggregatePerformance({ videos, pubs, metrics, from: "2026-11-01", by: "project" });
  assert.equal(nov.rows.some((x) => x.key === "spmoong01"), false);
});

test("주별 — 월요일 열쇠 · 시간 순", () => {
  const r = aggregatePerformance({ videos, pubs, metrics, by: "week" });
  assert.deepEqual(r.rows.map((x) => x.key), ["2026-10-19", "2026-11-02"]);
});
