import "server-only";

// ============================================================
//  오래된 회의 자료를 노션으로 옮긴다 (ERP 저장소 비우기)
// ------------------------------------------------------------
//  왜: 첨부와 녹음 음성은 Firebase Storage 가 없어 Firestore 조각으로 쌓인다.
//  무료 1GB 를 장부·매출·메일과 나눠 쓰므로 오래 두면 ERP 전체가 막힌다.
//  회사 노션은 유료라 파일이 넉넉하다 (파일 하나 5GiB) — 90일이 지난 회의의
//  **파일만** 노션으로 옮기고, ERP 에는 이름·크기·올린 사람과 링크만 남긴다.
//
//  ERP 에 그대로 남는 것: 회의록 본문 · 액션플랜 · 받아쓴 글 · AI 초안.
//  모두 글이라 작고, 비서와 검색이 읽어야 한다.
//
//  옮기는 순서 (되돌릴 수 없는 삭제를 마지막에):
//    1) 보관 페이지를 만든다 (회의록 본문 · 액션플랜 · ERP 링크)
//    2) 파일 하나를 노션에 올리고 **바로** 그 페이지에 붙인다
//       (올린 파일은 1시간 안에 붙여야 한다 — archive-client.ts)
//    3) 붙은 블록 id 를 ERP 파일 문서에 적고, 그때서야 조각을 지운다
//  중간에 실패하면 지우지 않는다. 다시 돌리면 남은 것부터 이어서 한다.
// ============================================================

import type { Firestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  appendBlocks,
  bullet,
  createArchivePage,
  fileBlock,
  pageLines,
  heading,
  paragraph,
  parseNotionPageId,
  textBlocks,
  uploadFile,
} from "@/lib/neander/notion/archive-client";
import { formatDurationKo, formatClock, REC_AUDIO_MIME } from "../recording";
import { markMeetingFileArchived, meetingFiles, readWholeMeetingFile } from "./files";
import { getMeetingRecordings, markRecordingArchived, readSegmentAudio } from "./recordings";
import { taskCategoryLabel, type ActionItem } from "@/lib/neander/types";

/** 이보다 오래된 회의의 자료를 옮긴다 — 회의 날짜 기준 */
export const ARCHIVE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const ERP_MEETING_URL = "https://neander-erp.vercel.app/neander/meetings?id=";

/**
 * 보관함은 회사 노션의 「임원진 회의록」 이다 (2026-09-22 사용자 지정). 그 아래에
 * 회의마다 📍 페이지가 「5월 8일」 처럼 하나씩 쌓여 있어, 같은 모양으로 이어 쌓는다.
 * 안건은 상위 회의 페이지 안에 넣는다 (ERP 목록과 같은 모양).
 */
const MEETING_EMOJI = "📍";
const AGENDA_EMOJI = "📄";

interface MeetingDoc {
  date?: string;
  title?: string;
  content?: string;
  actionItems?: ActionItem[];
  parentId?: string;
  notionPageUrl?: string;
}

/** 「6월 21일 [스모트] 업무 분담」 — 기존 페이지(「5월 8일」)와 같은 날짜 모양 */
function pageTitle(m: MeetingDoc) {
  const [, mm, dd] = (m.date ?? "").split("-");
  const day = mm && dd ? `${Number(mm)}월 ${Number(dd)}일` : "";
  return `${day} ${m.title || "제목 없는 회의"}`.trim();
}

export interface ArchiveCandidate {
  meetingId: string;
  date: string;
  title: string;
  /** 아직 ERP 에 내용이 남아 있는 첨부 */
  files: number;
  /** 아직 ERP 에 음성이 남아 있는 녹음 */
  recordings: number;
  bytes: number;
  /** 이미 이 회의를 보관한 적이 있으면 그 페이지 */
  pageUrl?: string;
}

/** 옮길 것이 있는 회의 — 오래된 것부터 */
export async function listArchiveCandidates(db: Firestore, days = ARCHIVE_AFTER_DAYS): Promise<ArchiveCandidate[]> {
  const until = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  const [meetingSnap, fileSnap, recSnap] = await Promise.all([
    db.collection(NEANDER_COL.meetings).get(),
    db.collection(NEANDER_COL.meetingFiles).get(),
    db.collection(NEANDER_COL.meetingRecordings).get(),
  ]);
  const old = new Map(
    meetingSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { date?: string; title?: string }) }))
      .filter((m) => (m.date ?? "") <= until)
      .map((m) => [m.id, m]),
  );
  const out = new Map<string, ArchiveCandidate>();
  const pick = (meetingId: string) => {
    const m = old.get(meetingId);
    if (!m) return null;
    let c = out.get(meetingId);
    if (!c) {
      c = { meetingId, date: m.date ?? "", title: m.title ?? "", files: 0, recordings: 0, bytes: 0 };
      out.set(meetingId, c);
    }
    return c;
  };

  for (const d of fileSnap.docs) {
    const f = d.data() as { meetingId: string; size: number; complete?: boolean; archive?: { pageUrl: string } };
    if (!f.complete) continue;
    const c = pick(f.meetingId);
    if (!c) continue;
    if (f.archive) c.pageUrl ??= f.archive.pageUrl;
    else {
      c.files++;
      c.bytes += f.size ?? 0;
    }
  }
  for (const d of recSnap.docs) {
    const r = d.data() as { meetingId: string; durationSec?: number; audioDeletedAt?: number; archiveUrl?: string };
    const c = pick(r.meetingId);
    if (!c) continue;
    if (r.archiveUrl) c.pageUrl ??= r.archiveUrl;
    else if (!r.audioDeletedAt) {
      c.recordings++;
      // 16kbps opus 기준 어림 — 정확한 크기는 조각 문서에 있지만 목록에서 다 읽지 않는다
      c.bytes += Math.round((r.durationSec ?? 0) * 2000);
    }
  }
  return [...out.values()]
    .filter((c) => c.files > 0 || c.recordings > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 회의 한 건의 노션 페이지 — 있으면 그것, 없으면 만든다.
 * 안건이면 상위 회의 페이지부터 챙겨 그 안에 만든다 (상위 회의에 옮길 자료가
 * 없어도 안건을 담을 페이지는 필요하다 — 그때는 글만 있는 페이지가 된다).
 * 만든 주소는 회의 문서에 적어, 다음에 다시 만들지 않는다.
 */
async function meetingPage(db: Firestore, meetingId: string, m: MeetingDoc): Promise<{ pageId: string; pageUrl: string }> {
  if (m.notionPageUrl) {
    const pageId = parseNotionPageId(m.notionPageUrl);
    if (!pageId) throw new Error("이미 만든 보관 페이지 주소를 읽지 못했습니다.");
    return { pageId, pageUrl: m.notionPageUrl };
  }
  let parentPageId: string | undefined;
  if (m.parentId && m.parentId !== meetingId) {
    const ps = await db.collection(NEANDER_COL.meetings).doc(m.parentId).get();
    const parent = ps.data() as MeetingDoc | undefined;
    // 안건의 안건은 없다 — 상위 회의의 parentId 는 보지 않는다 (무한 되풀이 방지)
    if (parent) parentPageId = (await meetingPage(db, m.parentId, { ...parent, parentId: undefined })).pageId;
  }
  const head = [
    paragraph(`ERP 회의록에서 열기 → ${ERP_MEETING_URL}${meetingId}`, `${ERP_MEETING_URL}${meetingId}`),
    paragraph(
      `회의 날짜 ${m.date ?? ""} · ERP 저장소를 비우려고 ${ARCHIVE_AFTER_DAYS}일이 지난 첨부·녹음을 여기로 옮깁니다. ` +
        `회의록 본문 · 액션플랜 · 받아쓴 글은 ERP 에 그대로 있습니다.`,
    ),
    ...(m.content?.trim() ? [heading("회의 내용"), ...textBlocks(m.content)] : []),
    ...((m.actionItems?.length ?? 0) > 0 ? [heading("액션플랜"), ...(m.actionItems ?? []).map((a) => bullet(actionLine(a)))] : []),
  ];
  const page = await createArchivePage(pageTitle(m), head, {
    parentPageId,
    emoji: parentPageId ? AGENDA_EMOJI : MEETING_EMOJI,
  });
  await db.collection(NEANDER_COL.meetings).doc(meetingId).update({ notionPageUrl: page.url });
  return { pageId: page.id.replace(/-/g, ""), pageUrl: page.url };
}

const actionLine = (a: ActionItem) =>
  [
    a.text,
    a.category ? `[${taskCategoryLabel(a.category)}]` : "",
    a.assigneeNames?.length ? `담당 ${a.assigneeNames.join(", ")}` : "",
    a.dueDate ? `마감 ${a.dueDate}` : "",
    a.detail ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

export interface ArchiveResult {
  pageUrl: string;
  files: number;
  recordings: number;
  bytes: number;
  /** 옮기지 못하고 ERP 에 그대로 둔 것 — 한 파일이 막혀도 나머지는 옮긴다 */
  skipped: { name: string; reason: string }[];
}

/**
 * 회의 하나의 자료를 노션으로 옮긴다. 이미 보관한 회의면 그 페이지에 이어 붙인다.
 * 한 번에 회의 하나씩 — 30MB 파일을 올리는 동안 서버 시간(최대 300초)을 넘기지 않게.
 */
export async function archiveMeeting(db: Firestore, meetingId: string, memberName: (email: string) => string): Promise<ArchiveResult> {
  const snap = await db.collection(NEANDER_COL.meetings).doc(meetingId).get();
  const m = snap.data() as MeetingDoc | undefined;
  if (!m) throw new Error("회의를 찾지 못했습니다.");

  const allFiles = await meetingFiles(db, meetingId);
  const allRecs = await getMeetingRecordings(db, meetingId);
  const files = allFiles.filter((f) => !f.archive);
  const recordings = allRecs.filter((r) => !r.audioDeletedAt && !r.archiveUrl);
  if (files.length === 0 && recordings.length === 0) throw new Error("이 회의에는 옮길 자료가 없습니다.");

  // 이미 만든 보관 페이지가 있으면 거기에 이어 붙인다 (지난번에 중간에 끊긴 경우)
  const already = m.notionPageUrl ?? allFiles.find((f) => f.archive)?.archive?.pageUrl ?? allRecs.find((r) => r.archiveUrl)?.archiveUrl;
  const { pageId, pageUrl } = await meetingPage(db, meetingId, { ...m, notionPageUrl: already });

  let bytes = 0;
  let moved = 0;
  const skipped: { name: string; reason: string }[] = [];
  const why = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류");

  // 지난번에 끊겨 다시 돌리는 경우 — 이미 적힌 소제목·사람 줄은 다시 쓰지 않는다
  const written = already ? await pageLines(pageId) : new Set<string>();
  const writeOnce = async (block: any, line: string) => {
    if (written.has(line)) return;
    await appendBlocks(pageId, [block]);
    written.add(line);
  };

  // ---- 첨부 파일: 올리고 → 붙이고 → 그때서야 ERP 조각을 지운다
  if (files.length > 0) {
    await writeOnce(heading("첨부 파일"), "첨부 파일");
    for (const f of files) {
      try {
        const who = memberName(f.uploadedBy);
        await writeOnce(paragraph(`— ${who}`), `— ${who}`);
        const up = await uploadFile({ name: f.name, contentType: f.type, bytes: await readWholeMeetingFile(db, f.id) });
        const caption = up.gzipped ? `${f.name} (노션이 안 받는 형식이라 압축해 올렸습니다 — 받아서 풀면 됩니다)` : f.name;
        const [block] = (await appendBlocks(pageId, [fileBlock(up.id, caption, up.filename)])).results ?? [];
        if (!block?.id) throw new Error("노션이 블록을 만들지 못했습니다.");
        await markMeetingFileArchived(db, f.id, { pageUrl, blockId: block.id, at: Date.now() });
        bytes += f.size;
        moved++;
      } catch (e) {
        // 한 파일이 막혀도 나머지는 옮긴다 — 막힌 파일은 ERP 에 그대로 남는다
        skipped.push({ name: f.name, reason: why(e) });
      }
    }
  }

  // ---- 녹음 음성: 조각마다 하나씩 (10분 단위 파일). 받아쓴 글은 ERP 에 남는다
  let movedRecs = 0;
  for (const r of recordings) {
    const segs = r.segments.filter((s) => s.uploaded);
    if (segs.length === 0) continue;
    try {
      await writeOnce(heading(`녹음 — ${r.name}`), `녹음 — ${r.name}`);
      await appendBlocks(pageId, [
        paragraph(
          `${formatDurationKo(r.durationSec)} · 조각 ${segs.length}개 · 받아쓴 글과 AI 초안은 ERP 회의록에 남아 있습니다.`,
        ),
      ]);
      for (const s of segs) {
        const { bytes: audio } = await readSegmentAudio(db, r.id, s.n, 0, Math.ceil(s.size / (768 * 1024)));
        const name = `${String(s.n + 1).padStart(2, "0")} ${formatClock(s.startSec)}~${formatClock(s.startSec + s.durationSec)}.${s.format}`;
        const up = await uploadFile({ name, contentType: REC_AUDIO_MIME[s.format], bytes: audio });
        await appendBlocks(pageId, [fileBlock(up.id, name, up.filename)]);
        bytes += s.size;
      }
      // 조각이 다 올라간 뒤에야 ERP 음성을 지운다
      await markRecordingArchived(db, r.id, pageUrl);
      movedRecs++;
    } catch (e) {
      skipped.push({ name: r.name, reason: why(e) });
    }
  }

  if (moved === 0 && movedRecs === 0 && skipped.length > 0) {
    throw new Error(`옮기지 못했습니다 — ${skipped[0].reason}`);
  }
  return { pageUrl, files: moved, recordings: movedRecs, bytes, skipped };
}
