import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { getNeanderDb, NEANDER_COL } from "@/lib/neander/firebase";
import { clean, cleanForUpdate } from "./helpers";
import type { Meeting, MeetingInput } from "@/lib/neander/types";
import { sanitizeNoteRich, type NoteRich } from "@/lib/neander/finance/rich-note";

const col = () => collection(getNeanderDb(), NEANDER_COL.meetings);
const ref = (id: string) => doc(getNeanderDb(), NEANDER_COL.meetings, id);

// 회의 내용 서식(contentRich)은 줄마다 조각 배열이라 배열 안의 배열이다.
// 브라우저 SDK 는 그런 값을 저장 직전에 거부한다(「Nested arrays are not supported」).
// 그래서 문서에는 JSON 글자로 넣고, 읽을 때 되돌린다. (프로젝트 메모는 서버 관리자 SDK 로 저장해서 그대로 둔다)
type Stored<T> = Omit<T, "contentRich"> & { contentRich?: string };

function toStored<T extends { contentRich?: NoteRich }>(m: T): Stored<T> {
  if (!("contentRich" in m)) return m as Stored<T>;
  const { contentRich, ...rest } = m;
  return { ...rest, contentRich: contentRich ? JSON.stringify(contentRich) : undefined };
}

function fromStored(raw: unknown): NoteRich | undefined {
  if (typeof raw !== "string") return sanitizeNoteRich(raw);
  try {
    return sanitizeNoteRich(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** 회의 날짜 최신순으로 구독 */
export function subscribeMeetings(cb: (meetings: Meeting[]) => void) {
  const q = query(col(), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data() as Omit<Meeting, "id" | "contentRich"> & { contentRich?: unknown };
        return { ...data, id: d.id, contentRich: fromStored(data.contentRich) } as Meeting;
      }),
    );
  });
}

export async function addMeeting(input: MeetingInput): Promise<string> {
  const now = Date.now();
  const refDoc = await addDoc(col(), clean({ ...toStored(input), createdAt: now, updatedAt: now }));
  return refDoc.id;
}

export async function updateMeeting(id: string, patch: Partial<MeetingInput>) {
  await updateDoc(ref(id), cleanForUpdate({ ...toStored(patch), updatedAt: Date.now() }));
}

export async function deleteMeeting(id: string) {
  await deleteDoc(ref(id));
}
