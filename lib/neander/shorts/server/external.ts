import "server-only";

// ============================================================
//  밖에서 올린 게시물 자동 연결 — 서버 (규칙은 ../external.ts)
// ------------------------------------------------------------
//  연결한 계정(내 채널 · 고객사 계정 제외)마다 최근 게시물을 읽어
//    · ERP 가 올린 것(같은 계정 · 같은 게시물 id 의 게시 기록) → 건너뜀
//    · 이미 본 것(계정별 장부 extseen_<계정>) → 건너뜀 — 사람이 지운 연결은 되살리지 않는다
//    · 같은 영상의 다른 플랫폼 게시가 있으면 그 영상에, 없으면 「일반 영상」 을 새로 만들어
//      게시 기록(origin: "external" · 완성 파일 없음)을 남기고 바로 성과를 한 번 읽는다
//  매일 아침 cron(쇼츠 cron ③ 앞) · 게시 현황 「지금 확인」 에서 돈다. 읽기 API 만 쓴다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  externalProjectTitle,
  externalPublicationId,
  isImportablePost,
  pickPartner,
  type ExternalAccountStatus,
  type ExternalPost,
  type ExternalSeenDoc,
  type PairCandidate,
} from "../external";
import { PLATFORM_LABEL } from "../model";
import type { AccountDoc, ProjectDoc, PublicationDoc, PublishPlatform } from "../types";
import { accountTokens } from "./accounts";
import { syncPublicationMetrics } from "./metrics";
import { instagramRecentMedia, youtubeChannelUploads } from "./platforms";
import { DEFAULT_SPACE_ID, spaceOf } from "../spaces";
import { rootDb, spaceDb } from "./space-db";
import { createProject, deleteProject, getProject, patchProject } from "./store";

const pubsCol = (db: Firestore) => db.collection(NEANDER_COL.shortsPublications);
const settings = (db: Firestore) => db.collection(NEANDER_COL.shortsSettings);
const seenKey = (accountId: string, prefix = "") => `${prefix}extseen_${accountId}`;
const SEEN_MAX = 2000;

export interface ExternalSyncOptions {
  by: string;
  /** 이 사람이 연결한 계정만 (화면의 「지금 확인」) — 없으면 모든 계정 (cron) */
  owner?: string;
  accountIds?: string[];
  /** 새로 붙인 게시물의 성과를 바로 한 번 읽을지 (cron 은 뒤의 ③ 이 읽으므로 false) */
  metrics?: boolean;
  deadline?: number;
  now?: number;
  /** 검증용 — 장부 문서 이름 앞에 붙인다 */
  prefix?: string;
}

export interface ExternalSyncResult {
  accounts: { accountId: string; platform: PublishPlatform; name: string; found: number; imported: number; paired: number; error: string | null }[];
  imported: number;
  publicationIds: string[];
}

/**
 * 이 사람(소유자)의 다른 플랫폼 게시 중 짝이 될 수 있는 것 — 그 영상에 이 플랫폼 게시가 아직 없고,
 * 같은 AI STUDIO 프로젝트의 영상일 때만 (다른 채널의 영상과 묶지 않는다)
 */
async function pairCandidates(db: Firestore, owner: string, platform: PublishPlatform, space: string): Promise<PairCandidate[]> {
  const snap = await pubsCol(db).where("owner", "==", owner).get();
  const pubs = snap.docs.map((d) => ({ id: d.id, p: d.data() as PublicationDoc }));
  const hasThis = new Set(pubs.filter((x) => x.p.platform === platform && !["failed", "cancelled"].includes(x.p.status)).map((x) => x.p.projectId));
  const open = pubs.filter((x) => x.p.platform !== platform && x.p.status === "published" && x.p.result && !hasThis.has(x.p.projectId));
  const ids = [...new Set(open.map((x) => x.p.projectId))];
  const projSpace = new Map<string, string>();
  if (ids.length) for (const d of await db.getAll(...ids.map((id) => db.collection(NEANDER_COL.shortsProjects).doc(id)))) if (d.exists) projSpace.set(d.id, spaceOf(d.data() as ProjectDoc));
  return open
    .filter((x) => projSpace.get(x.p.projectId) === space)
    .map((x) => ({ publicationId: x.id, projectId: x.p.projectId, platform: x.p.platform, at: x.p.result!.at, text: `${x.p.meta?.title ?? ""}\n${x.p.meta?.caption ?? ""}` }));
}

async function newExternalProject(db: Firestore, owner: string, by: string, platform: PublishPlatform, post: Pick<ExternalPost, "title" | "caption" | "publishedAt" | "url">, accountName: string, space: string): Promise<string> {
  // 계정이 붙은 프로젝트의 영상으로 만든다
  const id = await createProject(spaceDb(db, space), owner, {
    title: externalProjectTitle(platform, post),
    kind: "general",
    notes: `밖에서 올린 게시물을 찾아 자동으로 만든 영상입니다.\n${PLATFORM_LABEL[platform]} · ${accountName}${post.url ? ` · ${post.url}` : ""}`,
  });
  await patchProject(db, id, by, (p) => {
    p.stage = "published";
  });
  return id;
}

interface AccountRun {
  id: string;
  a: AccountDoc;
  ids: Record<string, number>;
  prevFound: number;
  row: ExternalSyncResult["accounts"][number];
  posts: ExternalPost[] | null;
}

/** 한 계정의 최근 게시물 읽기 — 실패는 그 계정에만 남긴다 */
async function readAccount(db: Firestore, id: string, a: AccountDoc, o: ExternalSyncOptions): Promise<AccountRun> {
  const prev = (await settings(db).doc(seenKey(id, o.prefix)).get()).data() as ExternalSeenDoc | undefined;
  const run: AccountRun = { id, a, ids: { ...(prev?.ids ?? {}) }, prevFound: prev?.found ?? 0, row: { accountId: id, platform: a.platform, name: a.externalName, found: 0, imported: 0, paired: 0, error: null }, posts: null };
  try {
    const { accessToken } = await accountTokens(db, id);
    run.posts = a.platform === "youtube" ? await youtubeChannelUploads(accessToken, a.externalId) : await instagramRecentMedia(accessToken, a.externalId);
    run.row.found = run.posts.length;
  } catch (e) {
    run.row.error = (e instanceof Error ? e.message : "게시물 목록을 읽지 못했습니다.").slice(0, 200);
  }
  return run;
}

/** 붙이기 하나 — 같은 영상의 다른 플랫폼 게시가 있으면 거기에, 없으면 새 영상 */
async function importPost(db: Firestore, run: AccountRun, post: ExternalPost, pending: PairCandidate[], o: ExternalSyncOptions, now: number, out: ExternalSyncResult) {
  const { id, a } = run;
  const picked = pickPartner(a.platform, post, [...(await pairCandidates(db, a.owner, a.platform, spaceOf(a))), ...pending]);
  // 짝이 아직 붙이지 않은 게시물이면 이것이 영상을 만들고, 그쪽이 차례가 오면 여기에 붙는다
  const partner = picked && !picked.candidate.pending ? picked : null;
  const projectId = partner ? partner.candidate.projectId : await newExternalProject(db, a.owner, o.by, a.platform, post, a.externalName, spaceOf(a));
  const pubId = externalPublicationId(id, post.externalId);
  const doc: PublicationDoc = {
    owner: a.owner,
    projectId,
    accountId: id,
    platform: a.platform,
    renderId: "",
    status: "published",
    scheduledAt: null,
    jobId: null,
    meta: {
      title: post.title.slice(0, 100),
      caption: post.caption.slice(0, 2200),
      privacy: post.privacy === "unlisted" || post.privacy === "private" ? post.privacy : "public",
      madeForKids: false,
      synthetic: false,
    },
    compliance: {},
    result: { externalId: post.externalId, url: post.url || null, at: post.publishedAt, by: "api" },
    origin: "external",
    external: { importedAt: now, autoProject: !partner, thumbnail: post.thumbnail.slice(0, 1000), durationSec: post.durationSec, matched: partner ? "paired" : "new" },
    error: null,
    history: [
      {
        at: now,
        status: "published",
        msg: partner
          ? `밖에서 올린 게시물을 찾아 같은 영상의 ${PLATFORM_LABEL[partner.candidate.platform]} 게시에 붙임 (글 겹침 ${Math.round(partner.similarity * 100)}%)`
          : "밖에서 올린 게시물을 찾아 새 영상으로 연결",
        by: o.by,
      },
    ],
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await pubsCol(db).doc(pubId).create(doc);
  } catch {
    // 다른 실행(cron · 다른 창)이 먼저 붙였다 — 방금 만든 빈 영상은 치운다
    if (!partner) await deleteProject(db, a.owner, projectId).catch(() => undefined);
    run.ids[post.externalId] = now;
    return;
  }
  run.ids[post.externalId] = now;
  run.row.imported++;
  if (partner) {
    run.row.paired++;
    // 인스타 캡션 첫 줄로 자동으로 지은 이름이면 유튜브 제목으로 바꾼다 (사람이 고친 이름은 그대로)
    if (a.platform === "youtube" && post.title.trim()) {
      const other = (await pubsCol(db).doc(partner.candidate.publicationId).get()).data() as PublicationDoc | undefined;
      if (other?.external?.autoProject && other.platform === "instagram") {
        const auto = externalProjectTitle("instagram", { title: "", caption: other.meta.caption, publishedAt: other.result?.at ?? 0 });
        await patchProject(db, projectId, o.by, (pr) => {
          if (pr.title === auto) pr.title = externalProjectTitle("youtube", post);
        }).catch(() => undefined);
      }
    }
  }
  out.imported++;
  out.publicationIds.push(pubId);
  if (o.metrics !== false) await syncPublicationMetrics(db, a.owner, pubId).catch(() => undefined);
}

/**
 * 연결한 계정들의 밖에서 올린 게시물 찾기 · 붙이기.
 * 모든 계정의 새 게시물을 **올린 시각 순서로** 붙인다 — 같은 영상을 두 플랫폼에 올렸을 때
 * 먼저 올린 쪽이 영상을 만들고 나중 것이 거기에 붙는다 (계정을 읽는 순서와 상관없이).
 */
export async function syncExternalPosts(dbIn: Firestore, o: ExternalSyncOptions): Promise<ExternalSyncResult> {
  // 계정 · 게시 · 장부는 프로젝트와 상관없이 하나 — 새 영상만 계정의 프로젝트에 만든다
  const db = rootDb(dbIn);
  const now = o.now ?? Date.now();
  const snap = o.owner ? await db.collection(NEANDER_COL.shortsAccounts).where("owner", "==", o.owner).get() : await db.collection(NEANDER_COL.shortsAccounts).get();
  const out: ExternalSyncResult = { accounts: [], imported: 0, publicationIds: [] };
  const runs: AccountRun[] = [];
  for (const d of snap.docs) {
    const a = d.data() as AccountDoc;
    if (o.accountIds && !o.accountIds.includes(d.id)) continue;
    // 고객사 계정은 승인한 파일만 ERP 로 올린다 — 밖에서 올린 것을 섞지 않는다
    if (a.clientId || a.status !== "connected") continue;
    const run = await readAccount(db, d.id, a, o);
    runs.push(run);
    out.accounts.push(run.row);
  }
  const queue: { run: AccountRun; post: ExternalPost }[] = [];
  for (const run of runs) {
    if (!run.posts) continue;
    // ERP 가 이 계정으로 올린 게시물 (결과 id) — 다시 붙이지 않는다
    const known = new Set((await pubsCol(db).where("accountId", "==", run.id).get()).docs.map((d) => (d.data() as PublicationDoc).result?.externalId).filter(Boolean) as string[]);
    for (const post of run.posts) if (isImportablePost(run.a.platform, post) && !run.ids[post.externalId] && !known.has(post.externalId)) queue.push({ run, post });
  }
  queue.sort((x, y) => x.post.publishedAt - y.post.publishedAt);
  for (let i = 0; i < queue.length; i++) {
    const { run, post } = queue[i];
    if (o.deadline && Date.now() > o.deadline) {
      for (const r of runs) if (r.posts && !r.row.error) r.row.error = "시간이 모자라 일부만 확인했습니다 — 다음 확인 때 이어서 합니다.";
      break;
    }
    // 같은 사람의 · 아직 차례가 안 온 다른 플랫폼 게시물 (올린 시각 순이라 뒤에 있는 것)
    const pending: PairCandidate[] = queue
      .slice(i + 1)
      .filter((q) => q.run.a.owner === run.a.owner && q.run.a.platform !== run.a.platform && spaceOf(q.run.a) === spaceOf(run.a))
      .map((q) => ({ publicationId: "", projectId: "", platform: q.run.a.platform, at: q.post.publishedAt, text: `${q.post.title}\n${q.post.caption}`, pending: true }));
    await importPost(db, run, post, pending, o, now, out);
  }
  // 장부 — 이번에 본 것 중 연결 대상이 아닌 것(사진 · 비공개)은 넣지 않는다 (공개되면 그때 붙인다). 최근 것만 남긴다
  for (const r of runs) {
    const keep = Object.entries(r.ids)
      .sort((x, y) => y[1] - x[1])
      .slice(0, SEEN_MAX);
    await settings(db)
      .doc(seenKey(r.id, o.prefix))
      .set({ accountId: r.id, ids: Object.fromEntries(keep), checkedAt: now, found: r.posts ? r.posts.length : r.prevFound, imported: r.row.imported, error: r.row.error } satisfies ExternalSeenDoc);
  }
  return out;
}

/** 게시 현황 위 상태 — 내가 연결한 계정마다 (관리자는 모든 계정) */
export async function externalStatus(dbIn: Firestore, email: string, all = false, prefix = ""): Promise<ExternalAccountStatus[]> {
  const db = rootDb(dbIn);
  const snap = all ? await db.collection(NEANDER_COL.shortsAccounts).get() : await db.collection(NEANDER_COL.shortsAccounts).where("owner", "==", email).get();
  const out: ExternalAccountStatus[] = [];
  for (const d of snap.docs) {
    const a = d.data() as AccountDoc;
    if (a.clientId) continue;
    const seen = (await settings(db).doc(seenKey(d.id, prefix)).get()).data() as ExternalSeenDoc | undefined;
    const linked = (await pubsCol(db).where("accountId", "==", d.id).get()).docs.filter((x) => (x.data() as PublicationDoc).origin === "external").length;
    out.push({
      accountId: d.id,
      platform: a.platform,
      name: a.externalName,
      owner: a.owner,
      checkedAt: seen?.checkedAt ?? null,
      found: seen?.found ?? 0,
      imported: seen?.imported ?? 0,
      linked,
      error: a.status === "needs_reauth" ? "계정을 다시 연결해야 합니다." : (seen?.error ?? null),
    });
  }
  return out.sort((x, y) => x.platform.localeCompare(y.platform) || x.name.localeCompare(y.name));
}

/**
 * 밖에서 올린 게시를 다른 영상으로 옮기기 (자동으로 잘못 붙었을 때 · ERP 에서 기획한 영상에 붙일 때).
 * projectId = "new" 면 새 영상으로 떼어 낸다. 성과 기록도 함께 옮기고, 자동으로 만든 빈 영상은 지운다.
 */
export async function attachExternal(dbIn: Firestore, email: string, input: { publicationId?: unknown; projectId?: unknown }): Promise<{ projectId: string }> {
  const db = rootDb(dbIn);
  const pid = typeof input.publicationId === "string" && /^[\w-]{6,160}$/.test(input.publicationId) ? input.publicationId : "";
  if (!pid) throw new Error("게시 기록 id 가 올바르지 않습니다.");
  const ref = pubsCol(db).doc(pid);
  const p = (await ref.get()).data() as PublicationDoc | undefined;
  if (!p) throw new AccessError(404, "게시 기록을 찾지 못했습니다.");
  if (p.origin !== "external") throw new Error("밖에서 올린 게시물만 옮길 수 있습니다 — ERP 로 올린 게시는 그 영상의 기록입니다.");
  if (p.owner !== email) throw new AccessError(403, "그 게시물을 올린 계정의 주인만 옮길 수 있습니다.");
  const now = Date.now();
  const from = p.projectId;
  let target: string;
  if (input.projectId === "new") {
    const acc = (await db.collection(NEANDER_COL.shortsAccounts).doc(p.accountId).get()).data() as AccountDoc | undefined;
    const fromProject = (await db.collection(NEANDER_COL.shortsProjects).doc(from).get()).data() as ProjectDoc | undefined;
    target = await newExternalProject(db, email, email, p.platform, { title: p.meta.title, caption: p.meta.caption, publishedAt: p.result?.at ?? now, url: p.result?.url ?? "" }, acc?.externalName ?? "", fromProject ? spaceOf(fromProject) : acc ? spaceOf(acc) : DEFAULT_SPACE_ID);
  } else {
    const t = await getProject(db, email, input.projectId);
    if (t.owner !== email) throw new AccessError(403, "내 영상에만 붙일 수 있습니다.");
    target = t.id;
  }
  if (target === from) return { projectId: target };
  await ref.update({
    projectId: target,
    external: { ...(p.external ?? { importedAt: now, thumbnail: "", durationSec: null }), autoProject: input.projectId === "new", matched: "moved" },
    updatedAt: now,
    history: [...p.history, { at: now, status: p.status, msg: input.projectId === "new" ? "새 영상으로 떼어 냄" : "다른 영상으로 옮김", by: email }].slice(-40),
  });
  const ms = await db.collection(NEANDER_COL.shortsMetrics).where("publicationId", "==", pid).get();
  for (const m of ms.docs) await m.ref.update({ projectId: target });
  await patchProject(db, target, email, (pr) => {
    pr.stage = "published";
  });
  // 자동으로 만든 영상이 비었으면 지운다 (완성 파일 · 다른 게시가 없을 때만)
  if (p.external?.autoProject) {
    const rest = await pubsCol(db).where("projectId", "==", from).get();
    const old = (await db.collection(NEANDER_COL.shortsProjects).doc(from).get()).data() as ProjectDoc | undefined;
    if (!rest.size && old && !(old.renderIds ?? []).length && old.owner === email) await deleteProject(db, email, from).catch(() => undefined);
  }
  return { projectId: target };
}
