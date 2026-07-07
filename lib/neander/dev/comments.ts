import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean } from "@/lib/neander/db/helpers";
import type { DevComment, DevCommentInput, CommentTarget } from "@/lib/neander/dev/types";

const col = () => collection(getNeanderDb(), NEANDER_COL.devComments);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.devComments, id);

/**
 * 특정 대상(task/activity)의 댓글 구독.
 * ⚠️ 복합 색인을 피하려고 where(등호) 두 개만 걸고 정렬은 클라이언트에서 한다.
 */
export function subscribeComments(
  targetType: CommentTarget,
  targetId: string,
  cb: (rows: DevComment[]) => void,
) {
  const q = query(
    col(),
    where("targetType", "==", targetType),
    where("targetId", "==", targetId),
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DevComment, "id">) }));
    rows.sort((a, b) => a.createdAt - b.createdAt);
    cb(rows);
  });
}

export async function addComment(input: DevCommentInput): Promise<string> {
  const r = await addDoc(col(), clean({ ...input, createdAt: Date.now() }));
  return r.id;
}

export async function deleteComment(id: string) {
  await deleteDoc(ref(id));
}
