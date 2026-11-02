import { NEANDER_COL } from "@/lib/neander/collections";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { createQuoteAssistHandler, runQuoteAssist } from "@/lib/neander/finance/server/ai-quote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = createQuoteAssistHandler({
  authenticate: requireErpUser,
  accessDenied: accessErrorResponse,
  projectExists: async (id) => (await adminDb().collection(NEANDER_COL.finProjects).doc(id).get()).exists,
  assist: runQuoteAssist,
});
