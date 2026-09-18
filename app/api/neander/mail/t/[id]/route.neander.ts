import { adminDb } from "@/lib/neander/server/admin";
import { isTrackId, recordOpen } from "@/lib/neander/mail/server/track";

// 수신확인 이미지 — 받는 사람의 메일 프로그램이 부른다. 로그인 없이 열려
// 있어야 하는 유일한 메일 라우트다. id 는 추측할 수 없는 무작위 값이고,
// 이 라우트는 열람 수만 올릴 뿐 아무것도 내주지 않는다 (track.ts).
export const dynamic = "force-dynamic";

/** 1×1 투명 GIF */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id ?? "");
  if (isTrackId(id)) await recordOpen(adminDb(), id).catch(() => undefined);
  return new Response(new Uint8Array(GIF), {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
