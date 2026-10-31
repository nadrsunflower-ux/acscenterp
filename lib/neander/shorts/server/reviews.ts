import "server-only";

// ============================================================
//  고객 검토 — 완성 파일을 고객사에 보내고, 승인 · 수정 요청을 받는다
// ------------------------------------------------------------
//  고객사는 ERP 계정이 없다. 담당자가 「검토 보내기」 를 누르면 그 회차 전용 링크가
//  생긴다 (/neander/review/<토큰>, 30일). 링크로는 **그 영상 한 편만** 보이고, 그 회차에
//  한 번만 「승인」 또는 「수정 요청」 을 남길 수 있다.
//    · 토큰은 저장하지 않는다 — 문서 id 가 토큰의 sha256 이다 (DB 를 읽어도 링크를 못 만든다)
//    · 수정 요청은 계약의 「한 편당 수정 횟수」 로 센다. 넘은 요청도 기록은 하되 「계약 범위
//      밖」 으로 표시한다 (조용히 막지 않고 둘 다 보게)
//    · 카톡 · 메일로 받은 답은 담당자가 대신 기록한다 (누가 기록했는지 남는다)
//  게시는 승인된 그 파일만 된다 (model.brandSystemChecks · clientApproval).
// ============================================================

import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { AccessError } from "@/lib/neander/server/auth";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { MediaDoc, ProjectDoc, ReviewLinkDoc, ReviewRound } from "../types";
import { getClientDoc } from "./clients";
import { getProject, patchProject } from "./store";

const LINK_DAYS = 30;
const links = (db: Firestore) => db.collection(NEANDER_COL.shortsReviewLinks);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const isToken = (t: unknown): t is string => typeof t === "string" && /^[\w-]{30,60}$/.test(t);

/** 검토 보내기 — 새 회차와 링크 (앞 회차가 아직 대기 중이면 거둬들인다) */
export async function sendForReview(db: Firestore, email: string, projectId: unknown, renderId: unknown, origin: string): Promise<{ url: string; round: number; expiresAt: number }> {
  const p = await getProject(db, email, projectId);
  if (p.kind !== "brand" || !p.clientId) throw new Error("고객사 영상만 검토를 보냅니다.");
  if (typeof renderId !== "string" || !p.renderIds.includes(renderId)) throw new Error("이 영상에서 출력한 완성 파일을 골라 주세요.");
  if (p.review.state === "approved") throw new Error("이미 승인된 영상입니다. 새로 고쳤다면 「승인 취소」 뒤에 다시 보내 주세요.");
  const token = randomBytes(27).toString("base64url");
  const now = Date.now();
  const expiresAt = now + LINK_DAYS * 86_400_000;
  let n = 0;
  await patchProject(db, p.id, email, (pp) => {
    for (const r of pp.review.rounds) if (r.decision === "pending") r.decision = "withdrawn";
    n = pp.review.rounds.length + 1;
    pp.review.rounds.push({ n, renderId, sentAt: now, sentBy: email, decision: "pending", feedback: "", decidedBy: null, decidedVia: null, decidedAt: null, extra: false });
    pp.review.state = "waiting";
  });
  const link: ReviewLinkDoc = { projectId: p.id, clientId: p.clientId, round: n, renderId, createdBy: email, createdAt: now, expiresAt };
  await links(db).doc(hash(token)).set(link);
  return { url: `${origin.replace(/\/$/, "")}/neander/review/${token}`, round: n, expiresAt };
}

async function linkOf(db: Firestore, token: unknown): Promise<ReviewLinkDoc> {
  if (!isToken(token)) throw new AccessError(404, "검토 링크가 올바르지 않습니다.");
  const d = (await links(db).doc(hash(token)).get()).data() as ReviewLinkDoc | undefined;
  if (!d) throw new AccessError(404, "검토 링크를 찾지 못했습니다. 담당자에게 새 링크를 요청해 주세요.");
  if (d.expiresAt < Date.now()) throw new AccessError(410, "검토 링크가 만료됐습니다. 담당자에게 새 링크를 요청해 주세요.");
  return d;
}

async function projectRaw(db: Firestore, id: string): Promise<ProjectDoc> {
  const p = (await db.collection(NEANDER_COL.shortsProjects).doc(id).get()).data() as ProjectDoc | undefined;
  if (!p) throw new AccessError(404, "영상을 찾지 못했습니다 (지워졌을 수 있습니다).");
  return p;
}

export interface ReviewInfo {
  clientName: string;
  title: string;
  round: number;
  latest: boolean;
  decision: ReviewRound["decision"];
  feedback: string;
  media: { size: number; type: string; duration: number | null; parts: number };
  revisionLimit: number;
  revisionsUsed: number;
  history: { n: number; decision: ReviewRound["decision"]; feedback: string; decidedAt: number | null }[];
  expiresAt: number;
}

/** 링크로 여는 정보 — 그 영상 하나에 대한 것만 */
export async function reviewInfo(db: Firestore, token: unknown): Promise<ReviewInfo> {
  const l = await linkOf(db, token);
  const p = await projectRaw(db, l.projectId);
  const c = await getClientDoc(db, l.clientId);
  const round = p.review.rounds.find((r) => r.n === l.round);
  if (!round) throw new AccessError(404, "검토 회차를 찾지 못했습니다.");
  const m = (await db.collection(NEANDER_COL.shortsMedia).doc(l.renderId).get()).data() as MediaDoc | undefined;
  if (!m || !m.complete) throw new AccessError(404, "영상 파일을 찾지 못했습니다.");
  return {
    clientName: c.name,
    title: p.publish.title || p.title,
    round: l.round,
    latest: p.review.rounds[p.review.rounds.length - 1]?.n === l.round,
    decision: round.decision,
    feedback: round.feedback,
    media: { size: m.size, type: m.type, duration: m.duration, parts: m.parts },
    revisionLimit: c.contract.revisionLimit,
    revisionsUsed: p.review.revisionsUsed,
    history: p.review.rounds.filter((r) => r.n < l.round && r.decision !== "withdrawn").map((r) => ({ n: r.n, decision: r.decision, feedback: r.feedback, decidedAt: r.decidedAt })),
    expiresAt: l.expiresAt,
  };
}

/** 링크로 영상 조각 받기 — 그 회차의 파일만 */
export async function reviewMediaParts(db: Firestore, token: unknown, from: number, count: number): Promise<Buffer> {
  const l = await linkOf(db, token);
  const m = (await db.collection(NEANDER_COL.shortsMedia).doc(l.renderId).get()).data() as MediaDoc | undefined;
  if (!m || !m.complete) throw new AccessError(404, "영상 파일을 찾지 못했습니다.");
  const refs = [];
  for (let n = from; n < Math.min(m.parts, from + count); n++) refs.push(db.collection(NEANDER_COL.shortsMedia).doc(l.renderId).collection("parts").doc(String(n)));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  return Buffer.concat(snaps.map((s) => Buffer.from((s.data()?.data as Buffer | undefined) ?? Buffer.alloc(0))));
}

function decide(pp: ProjectDoc, round: number, decision: "approved" | "revision", feedback: string, by: string, via: "link" | "staff", limit: number) {
  const r = pp.review.rounds.find((x) => x.n === round);
  if (!r) throw new AccessError(404, "검토 회차를 찾지 못했습니다.");
  if (pp.review.rounds[pp.review.rounds.length - 1]?.n !== round || r.decision === "withdrawn") throw new AccessError(409, "이 링크보다 새 검토 파일이 있습니다. 가장 최근 링크로 확인해 주세요.");
  if (r.decision !== "pending") throw new AccessError(409, "이 회차는 이미 답을 받았습니다.");
  if (decision === "revision" && !feedback.trim()) throw new Error("어떻게 고치면 좋을지 적어 주세요.");
  r.decision = decision;
  r.feedback = feedback.trim().slice(0, 2000);
  r.decidedBy = by.slice(0, 60);
  r.decidedVia = via;
  r.decidedAt = Date.now();
  if (decision === "revision") {
    r.extra = pp.review.revisionsUsed >= limit;
    pp.review.revisionsUsed += 1;
    pp.review.state = "revision";
  } else {
    pp.review.state = "approved";
  }
}

/** 고객이 링크에서 답한다 (로그인 없음 · 회차마다 한 번) */
export async function decideByLink(db: Firestore, token: unknown, input: { decision?: unknown; feedback?: unknown; name?: unknown }): Promise<ReviewInfo> {
  const l = await linkOf(db, token);
  const decision = input.decision === "approved" ? "approved" : input.decision === "revision" ? "revision" : null;
  if (!decision) throw new Error("승인 또는 수정 요청을 골라 주세요.");
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("검토하신 분의 이름을 적어 주세요.");
  const c = await getClientDoc(db, l.clientId);
  await patchProject(db, l.projectId, `고객사 ${c.name}`, (pp) => decide(pp, l.round, decision, String(input.feedback ?? ""), name, "link", c.contract.revisionLimit));
  return reviewInfo(db, token);
}

/** 담당자가 대신 기록 (카톡 · 메일로 받은 답) */
export async function recordByStaff(db: Firestore, email: string, projectId: unknown, input: { decision?: unknown; feedback?: unknown; decidedBy?: unknown }): Promise<void> {
  const p = await getProject(db, email, projectId);
  if (p.kind !== "brand" || !p.clientId) throw new Error("고객사 영상만 기록합니다.");
  const c = await getClientDoc(db, p.clientId);
  const last = p.review.rounds[p.review.rounds.length - 1];
  if (!last) throw new Error("먼저 검토를 보내 주세요.");
  const decision = input.decision === "approved" ? "approved" : input.decision === "revision" ? "revision" : null;
  if (!decision) throw new Error("승인 또는 수정 요청을 골라 주세요.");
  const who = String(input.decidedBy ?? "").trim();
  await patchProject(db, p.id, email, (pp) => decide(pp, last.n, decision, String(input.feedback ?? ""), `${who || "고객사"} (기록: ${email})`, "staff", c.contract.revisionLimit));
}

/** 승인 취소 — 승인 뒤에 영상을 다시 고쳐야 할 때 (기록은 남는다) */
export async function reopenReview(db: Firestore, email: string, projectId: unknown): Promise<void> {
  const p = await getProject(db, email, projectId);
  if (p.review.state !== "approved") throw new Error("승인된 영상이 아닙니다.");
  const pubs = await db.collection(NEANDER_COL.shortsPublications).where("projectId", "==", p.id).get();
  if (pubs.docs.some((d) => ["scheduled", "queued", "uploading", "processing", "published"].includes(String(d.data().status)))) {
    throw new Error("이미 게시했거나 게시 중인 영상은 승인을 되돌릴 수 없습니다.");
  }
  await patchProject(db, p.id, email, (pp) => {
    pp.review.state = "none";
  });
}

/** 지운 프로젝트의 링크 정리 */
export async function deleteReviewLinks(db: Firestore, projectId: string) {
  const snap = await links(db).where("projectId", "==", projectId).get();
  for (const d of snap.docs) await d.ref.delete();
}
