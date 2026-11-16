// 프로젝트 워크스페이스 — 브라우저 쪽 요청 (팀원 모두 · 서버는 app/api/neander/projects)
import { getNeanderAuth } from "@/lib/neander/firebase";
import type { ProjectEquipment } from "@/lib/neander/finance/equipment";
import type { OpsPatch, ProjectView } from "./view";

const URL = "/api/neander/projects";

async function authHeaders(): Promise<HeadersInit> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

export async function fetchProjects(): Promise<{ projects: ProjectView[]; financeAccess: boolean }> {
  const res = await fetch(URL, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** 바뀐 운영 칸만 보낸다 — 다른 사람이 고친 다른 칸을 덮지 않는다 */
export async function patchProject(id: string, patch: OpsPatch): Promise<ProjectView> {
  const res = await fetch(URL, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ id, patch }) });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { project: ProjectView }).project;
}

/** 달력에서 장비 대수만 바꿀 때 */
export const patchProjectEquipment = (id: string, equipment: ProjectEquipment) =>
  patchProject(id, { equipment: Object.values(equipment).some((n) => Number(n) > 0) ? equipment : undefined });
