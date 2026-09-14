import { NextResponse } from "next/server";
import { adminDb } from "@/lib/neander/server/admin";
import { requireErpUser, accessErrorResponse } from "@/lib/neander/server/auth";
import { uploadReceipt, signedUrl, deleteReceipts } from "@/lib/neander/server/storage";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { FinCardMemo, FinCardMemoView } from "@/lib/neander/finance/card-memo";

// ============================================================
//  법인카드 사용 메모 — 목록 / 등록 / 삭제
// ------------------------------------------------------------
//  사진이 붙으므로 등록만 multipart 다. 나머지 재무 쓰기는 mutate 라우트에
//  모여 있지만, 거기에 파일을 태우면 JSON 본문 규약이 깨진다.
//
//  ⚠️ 사진은 Storage 객체 경로로만 저장한다. 서명 URL 은 목록을 줄 때마다
//     새로 만든다 — 저장해 두면 만료된 링크가 장부에 남는다.
// ============================================================

export const dynamic = "force-dynamic";
/** 사진 여러 장이 올라올 수 있다 */
export const maxDuration = 120;

const MAX_PHOTOS = 5;
const MAX_BYTES = 12 * 1024 * 1024;

export async function GET(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }
  try {
    const snap = await adminDb().collection(NEANDER_COL.finCardMemos).get();
    const memos = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinCardMemo[];
    memos.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt - a.createdAt);

    const views: FinCardMemoView[] = await Promise.all(
      memos.map(async ({ photoPaths, ...rest }) => ({
        ...rest,
        // 서명 URL 을 못 만들어도 목록 자체는 나와야 한다
        photos: photoPaths?.length
          ? (
              await Promise.all(
                photoPaths.map(async (p) => {
                  try {
                    return { path: p, url: await signedUrl(p) };
                  } catch {
                    return null;
                  }
                }),
              )
            ).filter((x): x is { path: string; url: string } => x !== null)
          : undefined,
      })),
    );
    return NextResponse.json({ memos: views, me: user.email });
  } catch (e) {
    console.error("[finance/card-memo GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "메모를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }

  try {
    const form = await req.formData();
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };

    const date = str("date");
    const last4 = str("last4");
    const note = str("note");
    const amount = Math.round(Number(form.get("amount")));

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "사용일이 필요합니다." }, { status: 400 });
    }
    if (!last4) return NextResponse.json({ error: "카드를 골라주세요." }, { status: 400 });
    if (!note) return NextResponse.json({ error: "무엇에 썼는지 적어주세요." }, { status: 400 });
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "금액이 필요합니다." }, { status: 400 });
    }

    const db = adminDb();
    const ref = db.collection(NEANDER_COL.finCardMemos).doc();

    // 사진은 문서 id 아래에 모은다 — 메모를 지울 때 같이 지우기 쉽다
    const files = form
      .getAll("photos")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .slice(0, MAX_PHOTOS);
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      return NextResponse.json(
        { error: `사진 한 장은 ${MAX_BYTES / 1024 / 1024}MB 를 넘을 수 없습니다 (${tooBig.name}).` },
        { status: 400 },
      );
    }
    const memo: Omit<FinCardMemo, "id"> = {
      date,
      last4,
      note,
      amount: Math.abs(amount),
      vendor: str("vendor"),
      bizMajor: str("bizMajor"),
      bizMinor: str("bizMinor"),
      acctMajor: str("acctMajor"),
      acctMid: str("acctMid"),
      acctMinor: str("acctMinor"),
      createdAt: Date.now(),
      createdBy: user.email,
    };
    // Firestore 는 undefined 를 거부한다
    const clean = Object.fromEntries(Object.entries(memo).filter(([, v]) => v !== undefined));

    // ⚠️ 메모를 **먼저** 저장하고 사진은 그다음에 붙인다.
    //    사진 업로드가 실패했다고 기록 전체를 잃으면 안 된다 — 계산대
    //    앞에서 방금 적은 걸 다시 적으라고 할 수는 없다. 메모가 이 기록의
    //    본체이고 사진은 곁들이다.
    await ref.set(clean);

    let warning: string | undefined;
    if (files.length > 0) {
      try {
        const photoPaths: string[] = [];
        for (const f of files) {
          photoPaths.push(
            await uploadReceipt(ref.id, {
              name: f.name,
              type: f.type,
              bytes: Buffer.from(await f.arrayBuffer()),
            }),
          );
        }
        await ref.set({ photoPaths }, { merge: true });
      } catch (e) {
        console.error("[finance/card-memo 사진]", e);
        const msg = e instanceof Error ? e.message : "";
        warning = /bucket does not exist|No such bucket/i.test(msg)
          ? "메모는 저장했습니다. 다만 사진 저장소(Firebase Storage)가 아직 켜져 있지 않아 사진은 올리지 못했습니다."
          : `메모는 저장했습니다. 사진만 올리지 못했습니다 — ${msg}`;
      }
    }
    return NextResponse.json({ ok: true, id: ref.id, ...(warning ? { warning } : {}) });
  } catch (e) {
    console.error("[finance/card-memo POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장에 실패했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    await requireErpUser(req);
  } catch (e) {
    const denied = accessErrorResponse(e);
    if (denied) return denied;
    throw e;
  }
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const ref = adminDb().collection(NEANDER_COL.finCardMemos).doc(id);
    const doc = await ref.get();
    const paths = (doc.data()?.photoPaths ?? []) as string[];
    if (paths.length) await deleteReceipts(paths);
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[finance/card-memo DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제에 실패했습니다." },
      { status: 500 },
    );
  }
}
