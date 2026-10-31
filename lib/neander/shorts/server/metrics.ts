import "server-only";

// ============================================================
//  성과 가져오기 — 공식 API 로 읽기만 한다
// ------------------------------------------------------------
//  YouTube : videos.list statistics (조회 · 좋아요 · 댓글) — 연결한 계정 토큰
//            + 공개 영상이면 최근 댓글 100개에서 정보 요청 낱말을 센다 (서버 키)
//  Instagram: 릴스 insights (views · likes · comments · saved · shares)
//            + 최근 댓글 50개에서 정보 요청 낱말
//  쿠팡     : **사람마다 자기 키로 자기 실적만** 읽는다. 주문 리포트를 상품 id 로 묶어
//            그 사람의 링크(affiliate.coupangOwner)가 붙은 프로젝트에 붙인다.
//            클릭 리포트에는 상품 id 가 없다 — 프로젝트 전용 채널 아이디(subId)가
//            있을 때만 클릭을 붙이고, 아니면 클릭은 직접 입력으로 남는다.
//
//  정보 요청 수는 댓글 표본에서 센 「최소값」 이다 (DM 은 API 로 읽지 않는다).
//  기록마다 무엇을 근거로 했는지 note 에 남긴다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { confirmedCandidate, countInfoRequests, INFO_REQUEST_KEYWORDS } from "../model";
import type { MetricSnapshotDoc, ProjectDoc, PublicationDoc } from "../types";
import { accountTokens } from "./accounts";
import { coupangClicks, coupangOrders } from "./coupang";
import { coupangOf, noteCoupangResult } from "./profiles";
import { instagramComments, instagramInsights, youtubeVideoStats } from "./platforms";
import { getProject, listProjects } from "./store";
import { youtubeCommentSample } from "./youtube-data";
import { youtubeKeyFor } from "./profiles";

const metrics = (db: Firestore) => db.collection(NEANDER_COL.shortsMetrics);

async function write(db: Firestore, doc: MetricSnapshotDoc) {
  await metrics(db).add(doc);
}

export async function syncPublicationMetrics(db: Firestore, email: string, publicationId: string): Promise<{ note: string }> {
  const p = (await db.collection(NEANDER_COL.shortsPublications).doc(publicationId).get()).data() as PublicationDoc | undefined;
  if (!p) throw new Error("게시 기록을 찾지 못했습니다.");
  const project = await getProject(db, email, p.projectId);
  if (p.status !== "published" || !p.result?.externalId) throw new Error("게시가 끝난 영상만 성과를 가져옵니다.");
  const { accessToken } = await accountTokens(db, p.accountId);
  const keywords = [...INFO_REQUEST_KEYWORDS, ...(project.cta.keyword ? [project.cta.keyword] : [])];
  const now = Date.now();
  if (p.platform === "youtube") {
    const [s] = await youtubeVideoStats(accessToken, [p.result.externalId]);
    if (!s) throw new Error("YouTube 에서 영상을 찾지 못했습니다 (지워졌거나 권한이 바뀜).");
    let info: number | null = null;
    let note = "YouTube Data API videos.list";
    const yk = await youtubeKeyFor(db, p.owner);
    if (yk.key && s.privacyStatus === "public" && (s.comments ?? 0) > 0) {
      const sample = await youtubeCommentSample(p.result.externalId, 100, yk.key).catch(() => null);
      if (sample) {
        info = countInfoRequests(sample, keywords).matched;
        note += ` · 정보 요청은 최근 댓글 ${sample.length}개 중 낱말이 든 댓글 수(최소값)`;
      }
    }
    await write(db, {
      owner: project.owner,
      projectId: project.id,
      publicationId,
      platform: "youtube",
      at: now,
      source: "youtube_api",
      values: { views: s.views, likes: s.likes, comments: s.comments, ...(info !== null ? { infoRequests: info } : {}) },
      note,
      by: email,
    });
    return { note };
  }
  const ins = await instagramInsights(accessToken, p.result.externalId);
  const comments = await instagramComments(accessToken, p.result.externalId).catch(() => null);
  const info = comments ? countInfoRequests(comments, keywords).matched : null;
  const note = `Instagram 릴스 insights${comments ? ` · 정보 요청은 최근 댓글 ${comments.length}개 중 낱말이 든 댓글 수(최소값)` : ""}`;
  await write(db, {
    owner: project.owner,
    projectId: project.id,
    publicationId,
    platform: "instagram",
    at: now,
    source: "instagram_api",
    values: { views: ins.views, likes: ins.likes, comments: ins.comments, saves: ins.saves, shares: ins.shares, ...(info !== null ? { infoRequests: info } : {}) },
    note,
    by: email,
  });
  return { note };
}

const ymd = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");

/**
 * 쿠팡 리포트 → 프로젝트별 주문 · 수익. 최근 90일(30일씩 세 번)을 다시 세어 「지금까지 합」
 * 으로 적는다 — 성과 합계는 출처별 마지막 기록을 쓰므로 겹쳐 세지 않는다.
 */
export async function syncCoupangReports(db: Firestore, email: string): Promise<{ projects: number; note: string }> {
  const { creds } = await coupangOf(db, email);
  // 내 파트너스 링크가 붙은 쿠팡 영상만 (링크 주인이 기록되기 전 영상은 소유자로 본다 · 일반 · 고객사 영상은 제외)
  const mine = (await listProjects(db, email)).filter((p) => !p.sample && (p.kind ?? "coupang") === "coupang" && (p.coupang.affiliate?.coupangOwner ?? p.owner) === email);
  const byProduct = new Map<string, (ProjectDoc & { id: string })[]>();
  for (const p of mine) {
    const c = confirmedCandidate(p);
    if (c?.productId) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), p]);
  }
  const subIdOwners = new Map<string, string[]>();
  for (const p of mine) {
    const s = p.coupang.affiliate?.subId;
    if (s) subIdOwners.set(s, [...(subIdOwners.get(s) ?? []), p.id]);
  }
  const end = Date.now() - 86_400_000;
  const windows: [string, string][] = [];
  for (let i = 0; i < 3; i++) {
    const e = end - i * 30 * 86_400_000;
    windows.push([ymd(e - 29 * 86_400_000), ymd(e)]);
  }
  let orders: Awaited<ReturnType<typeof coupangOrders>>;
  let clicks: Awaited<ReturnType<typeof coupangClicks>>;
  try {
    orders = (await Promise.all(windows.map(([s, e]) => coupangOrders(creds, s, e)))).flat();
    clicks = (await Promise.all(windows.map(([s, e]) => coupangClicks(creds, s, e)))).flat();
    await noteCoupangResult(db, email, null);
  } catch (e) {
    await noteCoupangResult(db, email, e);
    throw e;
  }
  const period = `${windows[2][0]}~${windows[0][1]}`;
  const now = Date.now();
  let n = 0;
  for (const p of mine) {
    const c = confirmedCandidate(p);
    const sharing = c?.productId ? (byProduct.get(c.productId) ?? []).length : 0;
    const rows = c?.productId ? orders.filter((o) => o.productId === c.productId) : [];
    const subId = p.coupang.affiliate?.subId;
    const ownSub = subId && (subIdOwners.get(subId) ?? []).length === 1;
    const clickSum = ownSub ? clicks.filter((x) => x.subId === subId).reduce((a, x) => a + x.click, 0) : null;
    if (!rows.length && clickSum === null) continue;
    const values: MetricSnapshotDoc["values"] = {};
    if (sharing === 1) {
      values.orders = rows.reduce((a, r) => a + r.quantity, 0);
      values.revenue = Math.round(rows.reduce((a, r) => a + r.commission, 0));
    }
    if (clickSum !== null) values.clicks = clickSum;
    if (!Object.keys(values).length) continue;
    await write(db, {
      owner: p.owner,
      projectId: p.id,
      publicationId: null,
      platform: "coupang",
      at: now,
      source: "coupang_api",
      values,
      note: `${email} 님의 쿠팡 파트너스 리포트 ${period} · 주문은 확인한 상품 id ${c?.productId ?? "-"}${sharing > 1 ? " (같은 상품의 영상이 여럿이라 주문은 나누지 않음)" : ""}${clickSum === null ? " · 클릭은 영상 전용 채널 아이디가 없어 제외" : ` · 클릭은 채널 아이디 ${subId}`}`,
      by: email,
    });
    n++;
  }
  return { projects: n, note: `쿠팡 리포트 ${period} 기준` };
}
