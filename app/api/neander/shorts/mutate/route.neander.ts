import { adminDb } from "@/lib/neander/server/admin";
import { analysisToTemplate } from "@/lib/neander/shorts/model";
import { isShortsAdmin, requireShortsUser } from "@/lib/neander/shorts/server/access";
import { deleteCoupangKeys, saveCoupangKeys, saveProfileMeta, saveYoutubeKey, verifyCoupang } from "@/lib/neander/shorts/server/profiles";
import { createClientProject, deleteClient, getClient, saveClient } from "@/lib/neander/shorts/server/clients";
import { recordByStaff, reopenReview, sendForReview } from "@/lib/neander/shorts/server/reviews";
import { addManualInstagram, deleteAccount, updateAccount } from "@/lib/neander/shorts/server/accounts";
import { fail, json } from "@/lib/neander/shorts/server/http";
import { cancelPublication, resolvePublication } from "@/lib/neander/shorts/server/publishing";
import {
  addMetricSnapshot,
  addVersion,
  createProject,
  deleteMetric,
  deleteProject,
  deleteTemplate,
  deleteTrend,
  getProject,
  getVersion,
  listVersions,
  saveProject,
  saveTemplate,
  saveTrend,
  saveWeights,
} from "@/lib/neander/shorts/server/store";

// 쇼핑쇼츠 저장 — 한 문으로 받고 action 으로 나눈다 (재무 mutate 와 같은 모양)
export const dynamic = "force-dynamic";

type Body = Record<string, unknown> & { action?: string };

export async function POST(req: Request) {
  try {
    const { email } = await requireShortsUser(req);
    const db = adminDb();
    const b = (await req.json()) as Body;
    switch (b.action) {
      // ---- 소재
      case "trend.save":
        return json({ id: await saveTrend(db, email, b.id, b.trend) });
      case "trend.delete":
        await deleteTrend(db, email, b.id);
        return json({ ok: true });
      case "trend.toProject":
        return json({ id: await createProject(db, email, { trendId: b.id, visibility: b.visibility }) });

      // ---- 프로젝트
      case "project.create":
        return json({ id: await createProject(db, email, b as never) });
      case "project.get":
        // 읽기 — 관리자는 남의 비공개도 본다 (고치기는 project.save 가 따로 막는다)
        return json({ project: await getProject(db, email, b.id, isShortsAdmin(email)) });
      case "project.save":
        return json({ project: await saveProject(db, email, b.id, b.project, b.baseUpdatedAt) });
      case "project.delete":
        await deleteProject(db, email, b.id);
        return json({ ok: true });

      // ---- 버전
      case "version.list":
        return json({ versions: await listVersions(db, email, b.projectId, isShortsAdmin(email)) });
      case "version.get":
        return json({ version: await getVersion(db, email, b.id, isShortsAdmin(email)) });
      case "version.save": {
        const p = await getProject(db, email, b.projectId);
        const kind = b.kind === "reference" || b.kind === "analysis" ? b.kind : "script";
        const data = kind === "reference" ? p.reference : kind === "analysis" ? p.analysis : p.script;
        return json({ id: await addVersion(db, p.id, kind, data, email, String(b.note ?? "사람이 저장").slice(0, 200)) });
      }

      // ---- 성공 공식
      case "template.save":
        return json({ id: await saveTemplate(db, email, b.id, b.template) });
      case "template.delete":
        await deleteTemplate(db, email, b.id);
        return json({ ok: true });
      case "template.fromAnalysis": {
        const p = await getProject(db, email, b.projectId);
        if (!p.analysis || !p.analysis.beats.length) throw new Error("먼저 구성 분석을 만들어 주세요.");
        const versionId = await addVersion(db, p.id, "analysis", p.analysis, email, "공식으로 저장할 때의 분석");
        const id = await saveTemplate(db, email, null, {
          ...analysisToTemplate(p.analysis),
          name: String(b.name ?? "").trim() || `${p.product || p.title} 공식`,
          notes: p.analysis.notes,
          visibility: b.visibility,
          origin: { projectId: p.id, versionId, basis: p.analysis.basis },
        });
        return json({ id });
      }

      // ---- 설정 · 성과
      case "weights.save":
        return json({ weights: await saveWeights(db, email, b.weights) });
      case "metric.add":
        return json({ id: await addMetricSnapshot(db, email, b as never) });
      case "metric.delete":
        await deleteMetric(db, email, b.id);
        return json({ ok: true });

      // ---- 게시 계정
      case "account.update":
        return json({ account: await updateAccount(db, email, b.id, b as never) });
      case "account.delete":
        await deleteAccount(db, email, b.id);
        return json({ ok: true });
      case "account.manualInstagram":
        return json({ id: await addManualInstagram(db, email, b as never) });

      // ---- 내 채널 세트 (쿠팡 키 · 채널 아이디 · 개인 검색 키) — 언제나 요청한 사람 자신의 것
      case "profile.saveCoupangKeys":
        return json({ profile: await saveCoupangKeys(db, email, b as never) });
      case "profile.deleteCoupangKeys":
        return json({ profile: await deleteCoupangKeys(db, email) });
      case "profile.saveMeta":
        return json({ profile: await saveProfileMeta(db, email, b as never) });
      case "profile.saveYoutubeKey":
        return json({ profile: await saveYoutubeKey(db, email, b.key) });
      case "profile.verifyCoupang":
        return json({ profile: await verifyCoupang(db, email) });

      // ---- 고객사 (브랜드 대행) — 담당자만 고친다
      case "client.get":
        return json({ client: await getClient(db, email, b.id, isShortsAdmin(email)) });
      case "client.save":
        return json({ id: await saveClient(db, email, b.id, b.client) });
      case "client.delete":
        await deleteClient(db, email, b.id);
        return json({ ok: true });
      case "client.createProject":
        return json({ id: await createClientProject(db, email, b as never) });

      // ---- 고객 검토 · 수정 횟수
      case "review.send":
        return json(await sendForReview(db, email, b.projectId, b.renderId, new URL(req.url).origin));
      case "review.record":
        await recordByStaff(db, email, b.projectId, b as never);
        return json({ ok: true });
      case "review.reopen":
        await reopenReview(db, email, b.projectId);
        return json({ ok: true });

      // ---- 게시 원장
      case "publication.cancel":
        await cancelPublication(db, email, b.id);
        return json({ ok: true });
      case "publication.resolve":
        await resolvePublication(db, email, b.id, b as never);
        return json({ ok: true });
      default:
        throw new Error("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return fail(e);
  }
}
