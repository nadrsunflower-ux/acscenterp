import { projectFiles } from "@/lib/neander/finance/server/attached-files";
import { attachedFileRoute } from "@/lib/neander/finance/server/attached-files-route";

// 프로젝트 자료(제안서 등) — 목록 · 조각 올리기 · 읽기 · 삭제 (본체는 attached-files-route)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const route = attachedFileRoute(projectFiles, "finance/projects/files");
export const GET = route.GET;
export const POST = route.POST;
