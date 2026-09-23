"use client";

// ============================================================
//  회의록 — 회의 하나가 파일 하나
// ------------------------------------------------------------
//  「+ 새 회의」 를 누르면 오늘 날짜의 회의가 바로 만들어지고 편집이
//  열린다. 회의 안에 회의록(본문·액션플랜·자료 링크)과 첨부 파일이 같이
//  들어간다.
//
//  배치는 메일과 같은 「창 하나」 다 (2026-09-19 다듬기 — 애플 메모 앱 결).
//  넓은 화면: 왼쪽 목록 · 오른쪽 문서가 한 카드 안에서 따로 스크롤하고,
//  문서 위에는 도구 막대(녹음 · 수정 · 삭제 / 편집 중에는 취소 · 저장)가
//  늘 붙어 있다. 저장 단추를 찾아 긴 폼 끝까지 내려가지 않아도 된다.
//  좁은 화면: 목록 ↔ 문서를 한 판씩 (MasterDetail 처럼 CSS 로 감춘다).
//
//  바로 만들기 때문에 아무것도 안 쓰고 떠나면 빈 회의가 남는다 — 메모 앱처럼
//  비어 있으면 떠날 때 지운다 (fresh). 첨부는 회의 id 에 매이고 올리는 즉시
//  저장된다 (components/neander/meetings/MeetingFiles.tsx).
//
//  회의 전에 팀원이 미리 올려 두는 「안건」 은 상위 회의(parentId)에 매단다.
//  목록에서 상위 회의 아래에 들여쓰고, 그날 녹음·AI 회의록·액션플랜은 상위
//  회의에 남긴다 (lib/neander/types.ts 의 Meeting.parentId 주석).
//
//  회의 녹음(MeetingRecording)도 회의에 매인다. 녹음기는 셸의 RecordingProvider
//  가 들고 있어 화면을 옮겨도 이어진다. AI 회의록 초안은 편집 폼에 채워질
//  뿐이고, 사람이 저장해야 회의록이 된다 — 그 저장이 녹음의 「확정」 이다.
//
//  회의록 저장 로직(액션플랜 ↔ 일일업무 동기화)은 그대로.
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  FileText,
  Link2,
  ListChecks,
  ListTree,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import {
  subscribeMeetings,
  addMeeting,
  updateMeeting,
  deleteMeeting,
} from "@/lib/neander/db/meetings";
import { addTask, updateTask, deleteTask } from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  CategoryPicker,
  Dialog,
  EmptyState,
  FormRow,
  Icon,
  IconButton,
  Input,
  MemberAvatar,
  Menu,
  PageHeader,
  PageShell,
  SearchInput,
  SectionHeader,
  Textarea,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import {
  type Meeting,
  type MeetingLink,
  type ActionItem,
  type TaskCategory,
  taskCategoryLabel,
  taskCategoryColor,
} from "@/lib/neander/types";
import type { MeetingFile } from "@/lib/neander/meetings/types";
import { todayStr, formatDateKo, formatTimestamp, isOverdue } from "@/lib/neander/format";
import { PrepDocsButton } from "@/components/neander/PrepDocsSection";
import { deleteMeetingLog, logMeetingEvent } from "@/lib/neander/meetings/log-client";
import { MeetingLog, useMeetingLog } from "@/components/neander/meetings/MeetingLog";
import { describeMeetingEdit, type MeetingEvent } from "@/lib/neander/meetings/log";
import { ArchiveDialog } from "@/components/neander/meetings/ArchiveDialog";
import { MeetingAttachments, useMeetingFiles } from "@/components/neander/meetings/MeetingFiles";
import { MeetingRecording, RecordingControls } from "@/components/neander/meetings/MeetingRecording";
import { MinutesText } from "@/components/neander/meetings/MinutesText";
import { UnlinkZone, useMeetingDrag } from "@/components/neander/meetings/MeetingDrag";
import { useRecording } from "@/components/neander/meetings/RecordingProvider";
import { MailChip } from "@/components/neander/mail/MailChip";
import {
  confirmRecording,
  deleteRecordingsOfMeeting,
  fetchRecordings,
} from "@/lib/neander/meetings/recording-client";
import {
  minutesToContent,
  type MeetingMinutesDraft,
  type MeetingRecording as MeetingRecordingMeta,
} from "@/lib/neander/meetings/recording";

const DEFAULT_CATEGORY: TaskCategory = "etc";

/** 넓은 화면은 메일처럼 화면 높이를 꽉 채운 창 — 목록·문서가 따로 스크롤한다 */
const FRAME = "lg:-mb-7 lg:flex lg:h-[calc(100dvh-var(--nd-topbar-h)-1.5rem)] lg:min-h-[560px] lg:flex-col";

/** 편집 폼 id — 도구 막대의 「저장」 이 폼 밖에서 제출한다 */
const EDIT_FORM_ID = "meeting-edit-form";

/** 읽기 화면 머리의 「첨부 N개」 가 내려가는 자리 */
const ATTACHMENTS_ID = "meeting-attachments";

interface ActionDraft {
  key: string;
  id?: string; // 기존 액션플랜 id (수정 시)
  taskIds: Record<string, string>; // assigneeId → 연결된 일일업무 id
  text: string;
  category: TaskCategory;
  detail: string;
  assigneeIds: string[]; // 복수 담당자
  dueDate: string;
}

/** 자료 링크 입력 행 */
interface LinkDraft {
  key: string;
  label: string;
  url: string;
}

type MemberLite = { id: string; name: string; color?: string; avatar?: string };

/** "/neander/…" 내부 경로와 프로토콜 있는 URL 은 그대로, 그 외에는 https:// 를 붙인다 */
function normalizeLinkUrl(u: string): string {
  const t = u.trim();
  if (t.startsWith("/") || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** 아무것도 안 쓴 회의 — 「+ 새 회의」 로 만들고 그대로 떠나면 지운다 */
const isBlankMeeting = (m: Meeting) =>
  !m.title?.trim() && !m.content.trim() && m.actionItems.length === 0 && !m.links?.length;

const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

/** 2026년 9월 18일 금요일 */
function longDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 ${w}요일`;
}

/** 목록 둘째 줄 — 본문 첫 줄에서 글머리 기호를 걷어 낸 것 */
function previewOf(content: string): string {
  for (const raw of content.split("\n")) {
    const t = raw
      .trim()
      .replace(/^(?:[■□▶▣]|#{1,3}\s|[-•·*∙◦▪]\s|\d{1,2}[.)]\s|[①-⑳])\s*/, "")
      .trim();
    if (t) return t;
  }
  return "";
}

let _seq = 0;
function newDraft(): ActionDraft {
  _seq += 1;
  return {
    key: `d${_seq}`,
    text: "",
    category: DEFAULT_CATEGORY,
    detail: "",
    assigneeIds: [],
    taskIds: {},
    dueDate: "",
  };
}
function draftsFromMeeting(m: Meeting): ActionDraft[] {
  const ds = m.actionItems.map((a) => {
    _seq += 1;
    // 복수(신규) 우선, 없으면 단수(레거시)에서 정규화
    const assigneeIds = a.assigneeIds ?? (a.assigneeId ? [a.assigneeId] : []);
    const taskIds =
      a.taskIds ?? (a.taskId && a.assigneeId ? { [a.assigneeId]: a.taskId } : {});
    return {
      key: `e${_seq}`,
      id: a.id,
      taskIds,
      text: a.text,
      category: a.category ?? DEFAULT_CATEGORY,
      detail: a.detail ?? "",
      assigneeIds,
      dueDate: a.dueDate ?? "",
    };
  });
  return ds.length ? ds : [newDraft()];
}

type Mode = { kind: "idle" } | { kind: "read"; id: string } | { kind: "edit"; id: string };

export default function MeetingsPage() {
  const { members } = useAppData();
  const confirm = useConfirm();
  const toast = useToast();
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  /** 「+ 새 회의」 로 막 만든 회의 — 아무것도 안 쓰고 떠나면 지운다 */
  const fresh = useRef(new Set<string>());
  const mf = useMeetingFiles();
  const rec = useRecording();
  /** 모든 녹음 (조각 없이) — 목록의 녹음 표시 · 빈 회의 판단 · 삭제 안내 */
  const [recIndex, setRecIndex] = useState<MeetingRecordingMeta[] | null>(null);
  /** 「회의록에 넣기」 로 편집 폼에 채울 AI 초안 */
  const [incoming, setIncoming] = useState<{ meetingId: string; recId: string; draft: MeetingMinutesDraft } | null>(null);
  /** 주소의 ?id= 또는 상단바 녹음 알약이 연 회의 — 목록을 받은 뒤 연다 */
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  /** 처음 한 번 — 넓은 화면이면 가장 최근 회의를 연다 (메모 앱처럼 빈 판을 보이지 않게) */
  const autoOpened = useRef(false);
  /** 「다른 회의의 안건으로 묶기」 창에 올려 둔 회의 */
  const [linking, setLinking] = useState<Meeting | null>(null);
  /** 오래된 자료를 노션으로 옮기는 창 */
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => subscribeMeetings(setMeetings), []);

  // 녹음 목록 — 대기열이 조각을 끝낼 때마다 · 창으로 돌아올 때
  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetchRecordings()
        .then((r) => alive && setRecIndex(r))
        .catch(() => undefined);
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [rec.version]);

  // 딥링크 — useSearchParams 는 정적 생성에서 Suspense 없이 build 를 깨므로 마운트 뒤 주소를 읽는다
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      autoOpened.current = true;
      setPendingOpen(id);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const onOpen = (e: Event) => setPendingOpen((e as CustomEvent<string>).detail);
    window.addEventListener("neander:open-meeting", onOpen);
    return () => window.removeEventListener("neander:open-meeting", onOpen);
  }, []);
  useEffect(() => {
    if (!pendingOpen || !meetings) return;
    if (meetings.some((m) => m.id === pendingOpen)) {
      setMode((cur) => (cur.kind !== "idle" && cur.id === pendingOpen ? cur : { kind: "read", id: pendingOpen }));
    }
    setPendingOpen(null);
  }, [pendingOpen, meetings]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  /** 올린 사람 이메일 → 팀원 (팀원 목록에 없으면 이메일 앞부분을 이름으로) */
  const memberOf = useMemo(() => {
    const map = new Map<string, MemberLite>();
    members.forEach((m) => m.email && map.set(m.email.trim().toLowerCase(), m));
    return (email: string) => map.get(email.trim().toLowerCase()) ?? { id: email, name: email.split("@")[0] };
  }, [members]);

  const openId = mode.kind === "idle" ? null : mode.id;

  const recordingsOf = useMemo(() => {
    const map = new Map<string, number>();
    recIndex?.forEach((r) => map.set(r.meetingId, (map.get(r.meetingId) ?? 0) + 1));
    return (id: string) => map.get(id) ?? 0;
  }, [recIndex]);

  const filesOf = useMemo(() => {
    const map = new Map<string, MeetingFile[]>();
    mf.files?.forEach((f) => {
      const list = map.get(f.meetingId);
      if (list) list.push(f);
      else map.set(f.meetingId, [f]);
    });
    return (id: string) => map.get(id) ?? [];
  }, [mf.files]);

  // 연 회의의 기록 — 문서를 고쳤거나(updatedAt) 첨부·녹음 수가 달라지면 다시 읽는다
  const openMeetingDoc = openId ? meetings?.find((m) => m.id === openId) ?? null : null;
  const log = useMeetingLog(
    openId,
    `${openMeetingDoc?.updatedAt ?? 0}-${openId ? filesOf(openId).length : 0}-${openId ? recordingsOf(openId) : 0}`,
  );

  const sorted = useMemo(
    () => [...(meetings ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [meetings],
  );

  /** 상위 회의 id → 그 회의의 안건 (먼저 쓴 것이 위) */
  const agendaOf = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    const alive = new Set((meetings ?? []).map((m) => m.id));
    for (const m of sorted) {
      if (!m.parentId || !alive.has(m.parentId)) continue;
      const list = map.get(m.parentId);
      if (list) list.push(m);
      else map.set(m.parentId, [m]);
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    return map;
  }, [sorted, meetings]);

  /** 목록에 한 줄로 서는 회의 — 안건은 상위 회의 아래에 들어간다 (상위가 사라졌으면 홀로 선다) */
  const roots = useMemo(() => {
    const alive = new Set((meetings ?? []).map((m) => m.id));
    return sorted.filter((m) => !m.parentId || !alive.has(m.parentId));
  }, [sorted, meetings]);

  // 달별로 묶는다 — 최신 날짜가 위, 같은 날이면 나중에 만든 회의가 위.
  // 검색 중에는 안건까지 한 줄씩 평평하게 (안건만 맞았는데 상위 회의에 접혀 안 보이면 안 된다)
  const months = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (m: Meeting) =>
      !q ||
      [m.title ?? "", m.content, ...m.actionItems.map((a) => a.text), m.date].some((s) => s.toLowerCase().includes(q));
    const base = q ? sorted : roots;
    const out: { month: string; items: Meeting[] }[] = [];
    for (const m of base) {
      if (!hit(m)) continue;
      const month = m.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last?.month === month) last.items.push(m);
      else out.push({ month, items: [m] });
    }
    return out;
  }, [sorted, roots, query]);

  /** 좁은 화면에서 판을 바꿀 때는 맨 위부터 읽는다 — 목록에서 내려온 자리를 물려받지 않게 */
  const openMeeting = (id: string) => {
    setMode({ kind: "read", id });
    if (!window.matchMedia("(min-width: 1024px)").matches) window.scrollTo({ top: 0 });
  };

  const meetingName = (m: Meeting) => m.title || `${formatDateKo(m.date)} 회의`;

  /**
   * source 를 target 의 안건으로 옮긴다 — 딸린 안건도 함께 (안건의 안건은 없다).
   * 끌어다 놓기와 「다른 회의의 안건으로 묶기」 창이 같이 쓴다. 되돌리기를 알림에 붙인다.
   */
  async function linkUnder(source: Meeting, target: Meeting) {
    const parentId = target.parentId ?? target.id;
    const parent = meetings?.find((m) => m.id === parentId) ?? target;
    const prevParent = source.parentId;
    const kids = agendaOf.get(source.id) ?? [];
    try {
      for (const k of kids) await updateMeeting(k.id, { parentId });
      await updateMeeting(source.id, { parentId });
    } catch (e) {
      toast.error(`옮기지 못했습니다 — ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      throw e;
    }
    logMeetingEvent(source.id, "agenda-linked", meetingName(parent));
    toast.success(`「${meetingName(source)}」${objectParticle(meetingName(source))} 「${meetingName(parent)}」의 안건으로 옮겼습니다`, {
      action: {
        label: "되돌리기",
        onClick: () =>
          void (async () => {
            await updateMeeting(source.id, { parentId: prevParent });
            for (const k of kids) await updateMeeting(k.id, { parentId: source.id });
            logMeetingEvent(source.id, prevParent ? "agenda-linked" : "agenda-unlinked");
          })(),
      },
    });
  }

  /** 안건을 따로 선 회의로 */
  async function unlinkAgenda(source: Meeting) {
    const prevParent = source.parentId;
    try {
      await updateMeeting(source.id, { parentId: undefined });
    } catch (e) {
      toast.error(`옮기지 못했습니다 — ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      throw e;
    }
    logMeetingEvent(source.id, "agenda-unlinked");
    toast.success(`「${meetingName(source)}」${objectParticle(meetingName(source))} 따로 선 회의로 뺐습니다`, {
      action: {
        label: "되돌리기",
        onClick: () => void updateMeeting(source.id, { parentId: prevParent }),
      },
    });
  }

  const byId = useMemo(() => new Map((meetings ?? []).map((m) => [m.id, m])), [meetings]);

  // 목록에서 회의를 끌어 다른 회의 위에 놓으면 그 회의의 안건이 된다 (MeetingDrag.tsx)
  const drag = useMeetingDrag({
    describe: (id) => {
      const m = byId.get(id);
      if (!m) return null;
      return {
        title: m.title ?? "",
        date: m.date,
        isAgenda: !!m.parentId && byId.has(m.parentId),
        agendaCount: (agendaOf.get(id) ?? []).length,
      };
    },
    canLinkTo: (sourceId, targetId) => {
      const src = byId.get(sourceId);
      const tgt = byId.get(targetId);
      if (!src || !tgt) return false;
      const parentId = tgt.parentId ?? tgt.id;
      // 자기 안건 밑으로는 못 간다 · 이미 그 회의의 안건이면 할 일이 없다
      return parentId !== sourceId && src.parentId !== parentId;
    },
    onLink: async (sourceId, targetId) => {
      const src = byId.get(sourceId);
      const tgt = byId.get(targetId);
      if (src && tgt) await linkUnder(src, tgt);
    },
    onUnlink: async (sourceId) => {
      const src = byId.get(sourceId);
      if (src) await unlinkAgenda(src);
    },
  });

  const selectedId = mode.kind === "idle" ? null : mode.id;
  const selected = selectedId ? meetings?.find((m) => m.id === selectedId) ?? null : null;

  const hasAttachments = (id: string) =>
    filesOf(id).length > 0 || mf.uploads.some((u) => u.meetingId === id) || recordingsOf(id) > 0 || rec.isBusy(id);

  // 넓은 화면에서 처음 열면 가장 최근 회의를 펼친다. 좁은 화면은 목록부터
  useEffect(() => {
    if (autoOpened.current || !meetings) return;
    autoOpened.current = true;
    if (mode.kind === "idle" && sorted[0] && window.matchMedia("(min-width: 1024px)").matches) {
      setMode({ kind: "read", id: sorted[0].id });
    }
  }, [meetings, sorted, mode.kind]);

  // 연 회의가 (다른 곳에서) 지워지면 목록으로
  useEffect(() => {
    if (meetings && selectedId && !meetings.some((m) => m.id === selectedId)) setMode({ kind: "idle" });
  }, [meetings, selectedId]);

  // 막 만든 회의를 비워 둔 채 떠나면 지운다. 첨부·녹음 목록을 아직 못 받았으면
  // 붙은 것이 있는지 모르니 판단을 미룬다. 녹음 중인 회의는 비어 있어도 두지 않는다.
  useEffect(() => {
    if (!meetings || !mf.files || !recIndex) return;
    for (const id of [...fresh.current]) {
      if (id === selectedId) continue;
      fresh.current.delete(id);
      const m = meetings.find((x) => x.id === id);
      const attached =
        filesOf(id).length > 0 || mf.uploads.some((u) => u.meetingId === id) || recordingsOf(id) > 0 || rec.isBusy(id);
      if (m && isBlankMeeting(m) && !attached) {
        void deleteMeeting(id).catch(() => undefined);
        deleteMeetingLog(id); // 없던 일이 된 회의 — 「만들었습니다」 기록도 지운다
      }
    }
  }, [selectedId, meetings, mf.files, mf.uploads, filesOf, recIndex, recordingsOf, rec]);

  async function createMeeting(opts?: { parentId?: string; date?: string }) {
    setCreating(true);
    try {
      const id = await addMeeting({
        date: opts?.date ?? todayStr(),
        content: "",
        actionItems: [],
        ...(opts?.parentId ? { parentId: opts.parentId } : {}),
      });
      fresh.current.add(id);
      logMeetingEvent(id, "created", opts?.parentId ? "안건" : undefined);
      setQuery("");
      setMode({ kind: "edit", id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "회의를 만들지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  async function remove(m: Meeting) {
    if (rec.isBusy(m.id)) {
      toast.error("녹음하거나 올리는 중인 회의는 지울 수 없습니다. 녹음을 먼저 끝내 주세요.");
      return;
    }
    const n = filesOf(m.id).length;
    const r = recordingsOf(m.id);
    const kids = agendaOf.get(m.id) ?? [];
    const also = [n ? `첨부 파일 ${n}개` : "", r ? `녹음 ${r}개(받아쓴 글 포함)` : ""].filter(Boolean).join("와 ");
    const ok = await confirm({
      title: m.parentId ? "이 안건을 삭제할까요?" : "이 회의를 삭제할까요?",
      message: `이미 등록된 일일업무는 그대로 유지됩니다.${also ? ` ${also}는 함께 지워집니다.` : ""}${
        kids.length ? ` 안건 ${kids.length}건은 지워지지 않고 회의 목록에 따로 섭니다.` : ""
      }`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    // 안건은 고아로 두지 않는다 — 상위를 지우면 각자 회의로 풀어 준다
    for (const k of kids) await updateMeeting(k.id, { parentId: undefined }).catch(() => undefined);
    // 첨부·녹음을 먼저 지운다. 실패해도 회의는 지운다 — 남은 조각은 서버가 목록을 읽을 때 치운다
    await mf.removeAllOf(m.id).catch(() => undefined);
    if (r) await deleteRecordingsOfMeeting(m.id).catch(() => undefined);
    await deleteMeeting(m.id);
    deleteMeetingLog(m.id);
    fresh.current.delete(m.id);
    // 메모 앱처럼 다음 회의를 연다 (넓은 화면). 좁은 화면은 목록으로
    const next = sorted.find((x) => x.id !== m.id);
    setMode(next && window.matchMedia("(min-width: 1024px)").matches ? { kind: "read", id: next.id } : { kind: "idle" });
  }

  const attachments = (id: string) => (
    <MeetingAttachments
      meetingId={id}
      files={filesOf(id)}
      uploads={mf.uploads}
      loaded={mf.files !== null}
      error={mf.error}
      onRetry={() => void mf.refresh()}
      onUpload={(files) => void mf.upload(id, files).then(() => log.refresh())}
      onRemove={(f) => mf.removeFile(f).then(() => void log.refresh())}
      memberOf={memberOf}
      compact
    />
  );

  const meetingLabel = (m: Meeting) => m.title || `${formatDateKo(m.date)} 회의`;

  const recording = (m: Meeting, editing: boolean) => (
    <MeetingRecording
      meetingId={m.id}
      members={members}
      editing={editing}
      onApplyDraft={(draft, recId) => {
        setIncoming({ meetingId: m.id, recId, draft });
        if (!editing) setMode({ kind: "edit", id: m.id });
      }}
    />
  );

  const recordingControls = (m: Meeting) => <RecordingControls meetingId={m.id} meetingLabel={meetingLabel(m)} />;

  // 좁은 화면: 회의가 열려 있으면 목록을 숨긴다
  const showDoc = mode.kind !== "idle" && !!selected;
  const total = meetings?.length ?? 0;
  const shown = months.reduce((s, g) => s + g.items.length, 0);

  return (
    <PageShell width="full" className={FRAME}>
      <PageHeader
        title="회의록"
        compact
        description="회의마다 회의록 · 액션플랜 · 녹음 · 첨부를 한곳에"
        actions={
          <>
            <IconButton
              icon={Archive}
              label="오래된 회의 자료 보관"
              variant="secondary"
              title="90일이 지난 회의의 첨부·녹음 음성을 회사 노션으로 옮깁니다"
              onClick={() => setArchiveOpen(true)}
            />
            <PrepDocsButton />
            <Button icon={Plus} loading={creating} disabled={creating} onClick={() => void createMeeting()}>
              새 회의
            </Button>
          </>
        }
        className="mb-4 shrink-0"
      />

      <Card padding="none" className="lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        {/* ---- 왼쪽: 회의 목록 ---- */}
        <aside
          aria-label="회의 목록"
          className={cn(
            "flex min-h-0 flex-col lg:w-[300px] lg:shrink-0 lg:border-r lg:border-nd-line lg:bg-nd-sunken/50",
            showDoc && "max-lg:hidden",
          )}
        >
          <div className="shrink-0 px-3 pb-2 pt-3">
            <SearchInput size="sm" value={query} onValueChange={setQuery} placeholder="회의 검색" ariaLabel="회의 검색" />
          </div>
          {/* 안건을 끌 때만 펼쳐진다 — 목록 스크롤 밖이라 아래쪽 안건을 끌어도 바로 보인다
              (휴대폰은 화면 전체가 흐르니 윗줄 아래에 붙어 따라온다) */}
          <div className="shrink-0 px-1 max-lg:sticky max-lg:top-[var(--nd-topbar-h)] max-lg:z-10 max-lg:bg-nd-content">
            <UnlinkZone open={drag.draggingAgenda} active={drag.over?.kind === "unlink"} />
          </div>
          <div className="nd-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {meetings && total === 0 ? (
              <EmptyState compact icon={FileText} title="아직 회의가 없습니다" description="‘새 회의’로 첫 회의를 만드세요." />
            ) : meetings && shown === 0 ? (
              <p className="px-3 py-8 text-center text-nd-caption text-nd-fg-3">「{query}」 이(가) 들어간 회의가 없습니다.</p>
            ) : (
              months.map((g) => (
                <section key={g.month} aria-label={monthLabel(g.month)}>
                  <h2 className="nd-num px-3 pb-1 pt-3 text-nd-micro font-semibold text-nd-fg-3">{monthLabel(g.month)}</h2>
                  <ul className="flex flex-col gap-0.5">
                    {g.items.map((m) => {
                      const kids = query.trim() ? [] : agendaOf.get(m.id) ?? [];
                      const row = (x: Meeting, agenda: boolean) => (
                        <MeetingListItem
                          key={x.id}
                          meeting={x}
                          active={x.id === selectedId}
                          agenda={agenda}
                          agendaCount={agenda ? 0 : (agendaOf.get(x.id) ?? []).length}
                          files={filesOf(x.id).length}
                          uploading={mf.uploads.some((u) => u.meetingId === x.id)}
                          recordings={recordingsOf(x.id)}
                          recording={rec.job?.meetingId === x.id ? rec.job.kind : null}
                          onOpen={() => openMeeting(x.id)}
                          dragProps={drag.bind(x.id)}
                          dragState={
                            drag.dragId === x.id
                              ? "source"
                              : drag.over?.kind === "link" && drag.over.id === x.id
                                ? "target"
                                : drag.landedId === x.id
                                  ? "landed"
                                  : null
                          }
                        />
                      );
                      return (
                        <li key={m.id}>
                          <ul>{row(m, false)}</ul>
                          {kids.length > 0 && (
                            <ul className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-nd-line pl-2">
                              {kids.map((k) => row(k, true))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
          {total > 0 && (
            <p className="nd-num shrink-0 border-t border-nd-line py-2 text-center text-nd-micro text-nd-fg-3">
              {query.trim()
                ? `회의 ${total}개 중 ${shown}개`
                : `회의 ${roots.length}개${total > roots.length ? ` · 안건 ${total - roots.length}개` : ""}`}
            </p>
          )}
        </aside>

        {/* ---- 오른쪽: 문서 ---- */}
        <section
          aria-label="회의록"
          className={cn("flex min-w-0 flex-1 flex-col bg-nd-content lg:min-h-0", !showDoc && "max-lg:hidden")}
        >
          {mode.kind === "edit" && selected ? (
            <MeetingEditor
              key={selected.id}
              members={members}
              initial={selected}
              fresh={fresh.current.has(selected.id)}
              attachments={attachments(selected.id)}
              recording={recording(selected, true)}
              recordingControls={recordingControls(selected)}
              incomingDraft={incoming?.meetingId === selected.id ? incoming : null}
              onDraftTaken={() => setIncoming(null)}
              onDone={() => {
                // 저장했으면 더는 「막 만든 회의」 가 아니다
                fresh.current.delete(selected.id);
                setMode({ kind: "read", id: selected.id });
                void log.refresh();
              }}
              onBack={() =>
                // 막 만든 빈 회의를 취소하면 목록으로 (위 effect 가 지운다)
                setMode(
                  fresh.current.has(selected.id) && isBlankMeeting(selected) && !hasAttachments(selected.id)
                    ? { kind: "idle" }
                    : { kind: "read", id: selected.id },
                )
              }
            />
          ) : mode.kind === "read" && selected ? (
            <MeetingReader
              key={selected.id}
              meeting={selected}
              memberById={memberById}
              log={<MeetingLog events={log.events} loaded={log.loaded} memberOf={memberOf} />}
              lastEdit={log.lastEdit}
              memberOf={memberOf}
              files={filesOf(selected.id).length}
              recordings={recordingsOf(selected.id)}
              agenda={agendaOf.get(selected.id) ?? []}
              parent={selected.parentId ? meetings?.find((m) => m.id === selected.parentId) ?? null : null}
              attachmentsOf={(id) => filesOf(id).length}
              attachments={attachments(selected.id)}
              recording={recording(selected, false)}
              recordingControls={recordingControls(selected)}
              onOpen={openMeeting}
              onAddAgenda={() => void createMeeting({ parentId: selected.id, date: selected.date })}
              onLink={() => setLinking(selected)}
              onUnlink={() => {
                void updateMeeting(selected.id, { parentId: undefined });
                logMeetingEvent(selected.id, "agenda-unlinked");
              }}
              onEdit={() => setMode({ kind: "edit", id: selected.id })}
              onRemove={() => void remove(selected)}
              onBack={() => setMode({ kind: "idle" })}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-10">
              <EmptyState
                icon={FileText}
                title={total ? "회의를 고르세요" : "첫 회의를 만드세요"}
                description={
                  total
                    ? "왼쪽 목록에서 회의를 고르면 회의록과 녹음 · 첨부가 여기에 펼쳐집니다."
                    : "‘새 회의’를 누르면 오늘 날짜의 회의가 만들어집니다. 녹음을 켜 두면 AI 가 회의록 초안을 만듭니다."
                }
              />
            </div>
          )}
        </section>
      </Card>

      <ArchiveDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onDone={() => {
          void mf.refresh();
          rec.bump();
        }}
      />

      <LinkAgendaDialog
        meeting={linking}
        candidates={roots.filter((m) => m.id !== linking?.id && m.parentId === undefined)}
        agendaCount={(id) => (agendaOf.get(id) ?? []).length}
        onClose={() => setLinking(null)}
        onPick={async (parent) => {
          if (!linking) return;
          // 끌어다 놓기와 같은 길 — 딸린 안건 함께 · 되돌리기 알림
          await linkUnder(linking, parent).catch(() => undefined);
          setLinking(null);
        }}
      />

      {/* 끌고 있는 카드 — 손가락을 따라 떠다닌다 */}
      {drag.ghost}
    </PageShell>
  );
}

/** 「…」 뒤에 붙는 을/를 — 끝 글자가 한글이 아니면 을(를) */
function objectParticle(name: string) {
  const last = name.trim().at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "을(를)";
  return code % 28 ? "을" : "를";
}

// ---- 안건으로 묶기 창 ----------------------------------------
function LinkAgendaDialog({
  meeting,
  candidates,
  agendaCount,
  onClose,
  onPick,
}: {
  /** 묶을 문서 — null 이면 창이 닫혀 있다 */
  meeting: Meeting | null;
  candidates: Meeting[];
  agendaCount: (id: string) => number;
  onClose: () => void;
  onPick: (parent: Meeting) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setQ(""), [meeting?.id]);
  const list = candidates.filter(
    (m) => !q.trim() || `${m.title ?? ""} ${m.date}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <Dialog
      open={meeting !== null}
      onClose={onClose}
      title="어느 회의의 안건인가요?"
      description={`「${meeting?.title || (meeting ? formatDateKo(meeting.date) : "")}」 을(를) 고른 회의 아래로 옮깁니다. 이 문서의 첨부·액션플랜은 그대로 따라갑니다.`}
      size="md"
    >
      <SearchInput value={q} onValueChange={setQ} placeholder="회의 검색" ariaLabel="회의 검색" className="mb-3" />
      {list.length === 0 ? (
        <p className="py-8 text-center text-nd-body text-nd-fg-3">묶을 회의가 없습니다. 먼저 회의를 만들어 주세요.</p>
      ) : (
        <ul className="nd-scroll flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto">
          {list.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onPick(m);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex w-full items-center gap-3 rounded-nd-md px-3 py-2.5 text-left transition-colors duration-nd-fast hover:bg-nd-accent-soft disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-nd-body font-medium text-nd-fg">{m.title || "제목 없는 회의"}</span>
                  <span className="nd-num block text-nd-caption text-nd-fg-3">
                    {formatDateKo(m.date)}
                    {agendaCount(m.id) > 0 && ` · 안건 ${agendaCount(m.id)}건`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ---- 목록 한 칸 ---------------------------------------------
function MeetingListItem({
  meeting: m,
  active,
  agenda,
  agendaCount,
  files,
  uploading,
  recordings,
  recording,
  onOpen,
  dragProps,
  dragState,
}: {
  meeting: Meeting;
  active: boolean;
  /** 상위 회의 아래에 들여쓴 안건인가 */
  agenda: boolean;
  /** 이 회의에 달린 안건 수 */
  agendaCount: number;
  files: number;
  uploading: boolean;
  /** 붙은 녹음 수 */
  recordings: number;
  /** 이 창에서 지금 녹음 중(live) · 파일 올리는 중(upload) */
  recording: "live" | "upload" | null;
  onOpen: () => void;
  /** 끌어다 놓기 (MeetingDrag.tsx) — data-meeting-row · onPointerDown · 놓은 뒤 클릭 삼키기 */
  dragProps: ReturnType<ReturnType<typeof useMeetingDrag>["bind"]>;
  /** 끌고 있는 줄 · 놓을 곳 · 방금 내려앉은 줄 */
  dragState: "source" | "target" | "landed" | null;
}) {
  const preview = previewOf(m.content);
  const hasMeta = recordings > 0 || recording || files > 0 || uploading || m.actionItems.length > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        title="끌어서 다른 회의 위에 놓으면 그 회의의 안건이 됩니다"
        {...dragProps}
        className={cn(
          "relative flex w-full select-none flex-col rounded-nd-md text-left outline-none [-webkit-touch-callout:none] focus-visible:shadow-nd-focus",
          "transition-[background-color,box-shadow,opacity,transform] duration-nd ease-nd",
          agenda ? "px-2.5 py-2" : "px-3 py-2.5",
          // 끌려 나간 자리는 흐릿하게 남는다 — 어디서 왔는지 보이게
          dragState === "source" && "scale-[0.98] opacity-40",
          // 놓을 곳 — 푸르게 빛나며 살짝 커진다 (끌어당기는 느낌)
          dragState === "target" && "scale-[1.015] bg-nd-accent-soft shadow-[0_0_0_2px_rgb(var(--nd-accent)/0.55)]",
          dragState === "landed" && "nd-drop-in",
          dragState !== "target" && (active ? "bg-nd-accent-soft" : "hover:bg-nd-fg/[.05]"),
        )}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              agenda ? "text-nd-caption font-medium" : "text-nd-body font-semibold",
              active ? "text-nd-accent-strong" : m.title ? "text-nd-fg" : "text-nd-fg-3",
            )}
            title={m.title || undefined}
          >
            {m.title || (agenda ? "제목 없는 안건" : "제목 없는 회의")}
          </span>
          {agendaCount > 0 && (
            <span
              className="nd-num inline-flex shrink-0 items-center gap-0.5 rounded-full bg-nd-fg/[.06] px-1.5 text-nd-micro font-medium text-nd-fg-3"
              title={`안건 ${agendaCount}건`}
            >
              <Icon icon={ListTree} size={10} />
              {agendaCount}
            </span>
          )}
          <span
            aria-hidden
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-nd-accent px-1.5 text-nd-micro font-semibold text-white transition-[opacity,transform] duration-nd ease-nd",
              dragState === "target" ? "translate-x-0 opacity-100" : "pointer-events-none absolute right-2 translate-x-1 opacity-0",
            )}
          >
            <Icon icon={ListTree} size={10} />
            안건으로
          </span>
          {recording === "live" && (
            <span className="relative flex h-2 w-2 shrink-0" title="녹음 중">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-nd-danger opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-nd-danger" />
            </span>
          )}
        </span>
        <span className={cn("mt-0.5 flex min-w-0 gap-1.5", agenda ? "text-nd-micro" : "text-nd-caption")}>
          <span className={cn("nd-num shrink-0", active ? "text-nd-accent-strong/80" : "text-nd-fg-2")}>{formatDateKo(m.date)}</span>
          <span className="min-w-0 truncate text-nd-fg-3">{preview || "내용 없음"}</span>
        </span>
        {hasMeta && (
          <span className="nd-num mt-1 flex items-center gap-2.5 text-nd-micro font-normal text-nd-fg-3">
            {(recordings > 0 || recording) && (
              <span
                className={cn("inline-flex items-center gap-0.5", recording === "live" && "text-nd-danger-text")}
                title={recording === "live" ? "녹음 중" : recording ? "녹음 파일 올리는 중" : `녹음 ${recordings}개`}
              >
                <Icon icon={Mic} size={11} />
                {recording === "live" ? "녹음 중" : recording ? "올리는 중" : recordings > 1 ? recordings : "녹음"}
              </span>
            )}
            {(files > 0 || uploading) && (
              <span className="inline-flex items-center gap-0.5" title={uploading ? "파일을 올리는 중" : `첨부 파일 ${files}개`}>
                <Icon icon={Paperclip} size={11} />
                {files}
                {uploading && "…"}
              </span>
            )}
            {m.actionItems.length > 0 && (
              <span className="inline-flex items-center gap-0.5" title={`액션플랜 ${m.actionItems.length}건`}>
                <Icon icon={ListChecks} size={11} />
                {m.actionItems.length}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

// ---- 문서 판 공통 --------------------------------------------

/** 문서 위 도구 막대 — 넓은 화면은 판 맨 위에 붙고, 좁은 화면은 상단바 밑에 붙어 따라온다 */
function PaneBar({ children }: { children: ReactNode }) {
  return (
    <div className="z-[5] flex h-14 shrink-0 items-center gap-2 border-b border-nd-line bg-nd-content/90 px-3 backdrop-blur-md max-lg:sticky max-lg:top-[var(--nd-topbar-h)] sm:px-4">
      {children}
    </div>
  );
}

function BackToList({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 inline-flex h-ctl-md shrink-0 items-center gap-0.5 rounded-nd-md pr-2 text-nd-body font-medium text-nd-accent-strong hover:bg-nd-accent-soft lg:hidden"
    >
      <Icon icon={ChevronLeft} size={18} />
      회의
    </button>
  );
}

/** 문서 본문 — 한 줄이 너무 길어지지 않는 읽기 폭 */
function DocBody({ children }: { children: ReactNode }) {
  return (
    <div className="nd-scroll min-h-0 flex-1 lg:overflow-y-auto">
      <div className="mx-auto w-full max-w-[780px] px-5 pb-16 pt-7 sm:px-10 sm:pt-9">{children}</div>
    </div>
  );
}

// ---- 읽기 ---------------------------------------------------
function MeetingReader({
  meeting,
  memberById,
  log,
  lastEdit,
  memberOf,
  files,
  recordings,
  agenda,
  parent,
  attachmentsOf,
  attachments,
  recording,
  recordingControls,
  onOpen,
  onAddAgenda,
  onLink,
  onUnlink,
  onEdit,
  onRemove,
  onBack,
}: {
  meeting: Meeting;
  memberById: Map<string, MemberLite>;
  /** 기록 칸 (MeetingLog) */
  log: ReactNode;
  /** 문서를 마지막으로 고친 일 — 머리에 「누가 고쳤는지」 를 적는다 */
  lastEdit: MeetingEvent | null;
  memberOf: (email: string) => MemberLite;
  files: number;
  recordings: number;
  /** 이 회의에 달린 안건 */
  agenda: Meeting[];
  /** 이 문서가 안건이면 그 상위 회의 */
  parent: Meeting | null;
  attachmentsOf: (id: string) => number;
  /** 첨부 파일 칸 (MeetingAttachments) */
  attachments: ReactNode;
  /** 녹음 · AI 회의록 칸 (MeetingRecording) */
  recording: ReactNode;
  /** 도구 막대의 녹음 · 파일 올리기 단추 */
  recordingControls: ReactNode;
  onOpen: (id: string) => void;
  onAddAgenda: () => void;
  onLink: () => void;
  onUnlink: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onBack: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  // 마지막으로 문서를 고친 사람 — 기록이 있으면 이름을 붙인다 (기록 전에 쓴 회의는 시각만)
  const editedBy = lastEdit ? memberOf(lastEdit.by).name : "";
  const editedAt = lastEdit?.at ?? meeting.updatedAt;
  const facts = [
    meeting.actionItems.length ? `액션플랜 ${meeting.actionItems.length}건` : "",
    recordings ? `녹음 ${recordings}개` : "",
    editedAt ? `${editedBy ? `${editedBy}가 ` : ""}${formatTimestamp(editedAt)} 고침` : "",
  ].filter(Boolean);

  return (
    <>
      <PaneBar>
        <BackToList onBack={onBack} />
        <span className="nd-num hidden min-w-0 truncate text-nd-caption font-medium text-nd-fg-3 sm:block">
          {longDate(meeting.date)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {recordingControls}
          <span className="mx-1 hidden h-5 w-px bg-nd-line sm:block" aria-hidden />
          <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>
            수정
          </Button>
          <IconButton ref={menuBtn} icon={MoreHorizontal} label="회의 메뉴" size="sm" onClick={() => setMenuOpen((v) => !v)} />
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={menuBtn}
            placement="bottom-end"
            ariaLabel="회의 메뉴"
            className="w-60"
            items={[
              ...(parent
                ? [{ key: "unlink", label: "안건에서 빼기", icon: ListTree, hint: "따로 선 회의로", onSelect: onUnlink }]
                : [
                    {
                      key: "link",
                      label: "다른 회의의 안건으로 묶기",
                      icon: ListTree,
                      hint: agenda.length ? `안건 ${agenda.length}건도 함께 옮깁니다` : undefined,
                      onSelect: onLink,
                    },
                  ]),
              ...(parent ? [] : [{ key: "add", label: "안건 추가", icon: Plus, hint: "이 회의 아래 새 문서", onSelect: onAddAgenda }]),
              { type: "separator" as const, key: "s1" },
              { key: "del", label: parent ? "안건 삭제" : "회의 삭제", icon: Trash2, danger: true, onSelect: onRemove },
            ]}
          />
        </span>
      </PaneBar>

      <DocBody>
        <article>
          {parent && (
            <button
              type="button"
              onClick={() => onOpen(parent.id)}
              className="mb-2 inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-nd-accent-soft px-3 text-nd-caption font-medium text-nd-accent-strong transition-colors duration-nd-fast hover:bg-nd-accent/20"
              title="상위 회의로 가기"
            >
              <Icon icon={ListTree} size={12} className="shrink-0" />
              <span className="truncate">{parent.title || formatDateKo(parent.date)}</span>
              <span className="shrink-0">의 안건</span>
            </button>
          )}
          {/* 메일에서 옮겨 온 회의(안건)면 원본 메일로 가는 길 */}
          {meeting.mail && <MailChip mail={meeting.mail} className="mb-2 ml-1" />}
          <p className="nd-num mb-1 text-nd-caption font-medium text-nd-fg-3 sm:hidden">{longDate(meeting.date)}</p>
          <h1
            className={cn(
              "text-[28px] font-bold leading-[1.25] tracking-[-0.02em]",
              meeting.title ? "text-nd-fg" : "text-nd-fg-3",
            )}
          >
            {meeting.title || "제목 없는 회의"}
          </h1>
          <p className="nd-num mt-2 flex flex-wrap items-center gap-x-1.5 text-nd-caption text-nd-fg-3">
            {facts.join(" · ")}
            {files > 0 && (
              <>
                {facts.length > 0 && <span aria-hidden>·</span>}
                {/* 첨부는 문서 맨 아래에 있다 — 몇 개인지 보이면 바로 내려갈 수 있게 */}
                <button
                  type="button"
                  onClick={() => document.getElementById(ATTACHMENTS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="rounded-[6px] text-nd-accent-strong hover:underline"
                >
                  첨부 {files}개
                </button>
              </>
            )}
          </p>

          {(meeting.links?.length ?? 0) > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {meeting.links!.map((l, i) => (
                <MeetingLinkChip key={`${l.url}-${i}`} link={l} />
              ))}
            </div>
          )}

          {/* 안건이 있을 때만 — 없는 회의에 빈 칸을 두지 않는다 (「안건 추가」 는 ⋯ 메뉴에 있다) */}
          {agenda.length > 0 && (
            <section className="mt-7">
              <SectionHeader
                as="h3"
                title="안건"
                hint={`${agenda.length}건 · 회의 전에 팀원이 미리 올린 문서`}
                action={
                  <Button variant="ghost" size="sm" icon={Plus} onClick={onAddAgenda}>
                    안건 추가
                  </Button>
                }
              />
              {(
                <ol className="divide-y divide-nd-line overflow-hidden rounded-nd-lg border border-nd-line">
                  {agenda.map((a, i) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(a.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-nd-fast hover:bg-nd-accent-soft/50"
                      >
                        <span className="nd-num w-5 shrink-0 text-right text-nd-body font-semibold text-nd-fg-4">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-nd-body font-medium text-nd-fg">
                            {a.title || "제목 없는 안건"}
                          </span>
                          <span className="nd-num block truncate text-nd-caption text-nd-fg-3">
                            {formatDateKo(a.date)}
                            {previewOf(a.content) ? ` · ${previewOf(a.content)}` : ""}
                          </span>
                        </span>
                        <span className="nd-num flex shrink-0 items-center gap-2.5 text-nd-caption text-nd-fg-3">
                          {attachmentsOf(a.id) > 0 && (
                            <span className="inline-flex items-center gap-0.5" title={`첨부 ${attachmentsOf(a.id)}개`}>
                              <Icon icon={Paperclip} size={12} />
                              {attachmentsOf(a.id)}
                            </span>
                          )}
                          {a.actionItems.length > 0 && (
                            <span className="inline-flex items-center gap-0.5" title={`액션플랜 ${a.actionItems.length}건`}>
                              <Icon icon={ListChecks} size={12} />
                              {a.actionItems.length}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <div className="mt-7 empty:hidden">{recording}</div>

          <div className="mt-8">
            {meeting.content ? (
              <MinutesText text={meeting.content} />
            ) : (
              <div className="rounded-nd-lg border border-dashed border-nd-border px-5 py-8 text-center">
                <p className="text-nd-body font-medium text-nd-fg-2">아직 회의 내용이 없습니다</p>
                <p className="mt-1 text-nd-caption text-nd-fg-3">
                  위의 「녹음」 으로 회의를 녹음하면 AI 가 초안을 만들고, 「수정」 으로 직접 쓸 수도 있습니다.
                </p>
              </div>
            )}
          </div>

          {meeting.actionItems.length > 0 && (
            <section className="mt-12">
              <SectionHeader as="h3" title="액션플랜" hint={`${meeting.actionItems.length}건 · 위에서부터 우선순위`} />
              <ActionList items={meeting.actionItems} memberById={memberById} />
            </section>
          )}

          <section id={ATTACHMENTS_ID} className="mt-12 scroll-mt-4">
            {attachments}
          </section>

          <section className="mt-12">{log}</section>
        </article>
      </DocBody>
    </>
  );
}

/** 읽기용 액션플랜 — 표 대신 목록. 번호 · 할 일 · 세부 · 분류 · 담당 · 마감 · 일일업무 연결 */
function ActionList({ items, memberById }: { items: ActionItem[]; memberById: Map<string, MemberLite> }) {
  return (
    <ol className="divide-y divide-nd-line overflow-hidden rounded-nd-lg border border-nd-line">
      {items.map((a, i) => {
        const ids = a.assigneeIds ?? (a.assigneeId ? [a.assigneeId] : []);
        const names = a.assigneeNames ?? (a.assigneeName ? [a.assigneeName] : []);
        const linked = (a.taskIds && Object.keys(a.taskIds).length > 0) || !!a.taskId;
        const late = !!a.dueDate && isOverdue(a.dueDate);
        return (
          <li key={a.id} className="flex gap-3 px-4 py-3.5">
            <span className="nd-num w-5 shrink-0 pt-px text-right text-nd-body font-semibold text-nd-fg-4">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-nd-body font-medium leading-snug text-nd-fg">{a.text}</p>
              {a.detail && <p className="mt-1 whitespace-pre-wrap text-nd-caption leading-relaxed text-nd-fg-2">{a.detail}</p>}
              <div className="nd-num mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-nd-caption text-nd-fg-3">
                {a.category && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: taskCategoryColor(a.category) }} aria-hidden />
                    {taskCategoryLabel(a.category)}
                  </span>
                )}
                {ids.length > 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {ids.map((id, k) => {
                      const m = memberById.get(id);
                      const name = m?.name ?? names[k] ?? "";
                      return (
                        <span key={id} className="inline-flex items-center gap-1 text-nd-fg-2">
                          <MemberAvatar name={name} color={m?.color} avatar={m?.avatar} className="h-[18px] w-[18px] text-[9px]" />
                          {name}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span>담당 미정</span>
                )}
                {a.dueDate && (
                  <span className={cn("inline-flex items-center gap-1", late && "text-nd-danger-text")}>
                    <Icon icon={CalendarDays} size={12} />
                    {formatDateKo(a.dueDate)}
                  </span>
                )}
                {linked && (
                  <span className="inline-flex items-center gap-1 text-nd-success-text" title="담당자의 일일업무에 들어가 있습니다">
                    <Icon icon={CalendarCheck} size={12} />
                    일일업무
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** 회의록 자료 링크 — 내부 경로("/…")는 같은 탭, 외부 URL은 새 탭 */
function MeetingLinkChip({ link }: { link: MeetingLink }) {
  const internal = link.url.startsWith("/");
  const className =
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-nd-fg/[.05] px-3 text-nd-caption font-medium text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-accent-soft hover:text-nd-accent-strong";
  const label = (
    <>
      <Icon icon={internal ? Link2 : ExternalLink} size={12} className="shrink-0" />
      <span className="max-w-[220px] truncate">{link.label}</span>
    </>
  );
  return internal ? (
    <Link href={link.url} className={className} title={link.label}>
      {label}
    </Link>
  ) : (
    <a href={link.url} target="_blank" rel="noreferrer" className={className} title={link.label}>
      {label}
    </a>
  );
}

// ---- 편집 ---------------------------------------------------
function MeetingEditor({
  members,
  initial,
  fresh = false,
  attachments,
  recording,
  recordingControls,
  incomingDraft,
  onDraftTaken,
  onDone,
  onBack,
}: {
  members: MemberLite[];
  /** 「+ 새 회의」 가 이미 만들어 둔 회의도 여기로 온다 — 편집은 늘 있는 회의를 고친다 */
  initial: Meeting;
  /** 막 만든 회의 (제목·버튼 문구만 다르다) */
  fresh?: boolean;
  /** 첨부 파일 칸 — 올리는 즉시 저장되어 아래 「저장」 과 상관없다 */
  attachments?: ReactNode;
  /** 녹음 · AI 회의록 칸 — 녹음은 저장과 상관없이 이어진다 */
  recording?: ReactNode;
  /** 도구 막대의 녹음 · 파일 올리기 단추 */
  recordingControls?: ReactNode;
  /** 「회의록에 넣기」 로 들어온 AI 초안 — 폼에 한 번 채우고 onDraftTaken */
  incomingDraft?: { recId: string; draft: MeetingMinutesDraft } | null;
  onDraftTaken?: () => void;
  onDone?: () => void;
  onBack?: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(initial.date);
  const [title, setTitle] = useState(initial.title ?? "");
  const [content, setContent] = useState(initial.content);
  const [drafts, setDrafts] = useState<ActionDraft[]>(() => draftsFromMeeting(initial));
  const [linkDrafts, setLinkDrafts] = useState<LinkDraft[]>(
    () =>
      initial.links?.map((l) => {
        _seq += 1;
        return { key: `l${_seq}`, label: l.label, url: l.url };
      }) ?? [],
  );
  const [saving, setSaving] = useState(false);
  /** 초안을 넣은 녹음 — 저장하면 확정(30일 뒤 음성 삭제)한다 */
  const draftedFrom = useRef(new Set<string>());
  /** 이미 채운 초안 — 같은 초안을 두 번 채우지 않는다 (개발 모드는 effect 를 두 번 돌린다) */
  const takenDraft = useRef<object | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // 제목·본문 칸은 글만큼 자란다 — 긴 제목이 잘리지 않고, 본문은 칸 안에서
  // 따로 스크롤하지 않아 문서처럼 이어서 읽힌다
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(220, el.scrollHeight + 2)}px`;
  }, [content]);

  // AI 초안을 폼에 채운다. 이미 쓴 내용은 지우지 않고 뒤에 붙인다 — 회의 중에
  // 손으로 적어 둔 메모가 사라지면 안 된다.
  useEffect(() => {
    if (!incomingDraft || takenDraft.current === incomingDraft) return;
    takenDraft.current = incomingDraft;
    const { draft, recId } = incomingDraft;
    const text = minutesToContent(draft);
    setTitle((t) => t.trim() || draft.title);
    setContent((c) => (c.trim() ? `${c.trimEnd()}\n\n${text}` : text));
    const byName = new Map(members.map((m) => [m.name.trim(), m.id]));
    const added: ActionDraft[] = draft.actionItems.map((a) => ({
      ...newDraft(),
      text: a.text,
      category: a.category,
      detail: a.detail,
      assigneeIds: a.assignees.map((n) => byName.get(n.trim())).filter((id): id is string => Boolean(id)),
      dueDate: a.dueDate,
    }));
    // 비어 있는 첫 줄(새 회의의 빈 액션)은 초안 줄로 바꾼다
    setDrafts((ds) => {
      const next = [...ds.filter((d) => d.text.trim() || d.id), ...added];
      return next.length ? next : [newDraft()];
    });
    draftedFrom.current.add(recId);
    onDraftTaken?.();
    toast.success(`AI 초안을 넣었습니다 — 액션플랜 ${added.length}건. 확인하고 저장하세요.`);
    // 초안 한 건에 한 번만 — members·toast 가 바뀌어 다시 채우면 안 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingDraft]);

  function updateLink(key: string, patch: Partial<LinkDraft>) {
    setLinkDrafts((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLinkRow() {
    _seq += 1;
    setLinkDrafts((ls) => [...ls, { key: `l${_seq}`, label: "", url: "" }]);
  }
  function removeLinkRow(key: string) {
    setLinkDrafts((ls) => ls.filter((l) => l.key !== key));
  }

  function updateDraft(key: string, patch: Partial<ActionDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function toggleAssignee(key: string, id: string) {
    setDrafts((ds) =>
      ds.map((d) =>
        d.key === key
          ? {
              ...d,
              assigneeIds: d.assigneeIds.includes(id)
                ? d.assigneeIds.filter((x) => x !== id)
                : [...d.assigneeIds, id],
            }
          : d,
      ),
    );
  }
  function addRow() {
    setDrafts((ds) => [...ds, newDraft()]);
  }
  function removeRow(key: string) {
    setDrafts((ds) => (ds.length === 1 ? ds : ds.filter((d) => d.key !== key)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() && !content.trim() && drafts.every((d) => !d.text.trim())) {
      toast.error("제목, 회의 내용, 액션플랜 중 하나는 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const items: ActionItem[] = [];
      let idx = 0;
      for (const d of drafts) {
        if (!d.text.trim()) continue;
        idx += 1;
        const dueDate = emptyToUndef(d.dueDate);
        const text = d.text.trim();
        const detail = emptyToUndef(d.detail);

        // 일일업무에 들어갈 상세: 사용자 세부사항 + 회의록 출처 표기
        const taskDetail = detail
          ? `${detail}\n(회의록 ${date} 액션플랜)`
          : `회의록(${date}) 액션플랜`;

        // 선택된 담당자(현존 팀원만)
        const assignees = d.assigneeIds
          .map((id) => members.find((m) => m.id === id))
          .filter((m): m is { id: string; name: string } => Boolean(m));

        // 담당자별 일일업무 동기화: 기존 연결은 갱신, 신규는 추가, 빠진 담당자는 삭제
        const prevTaskIds = d.taskIds ?? {};
        const nextTaskIds: Record<string, string> = {};
        for (const a of assignees) {
          const existing = prevTaskIds[a.id];
          if (existing) {
            await updateTask(existing, {
              memberId: a.id,
              memberName: a.name,
              date: dueDate || date,
              category: d.category,
              title: text,
              detail: taskDetail,
            });
            nextTaskIds[a.id] = existing;
          } else {
            nextTaskIds[a.id] = await addTask({
              memberId: a.id,
              memberName: a.name,
              date: dueDate || date,
              category: d.category,
              title: text,
              detail: taskDetail,
              status: "todo",
            });
          }
        }
        // 담당자에서 빠진 사람의 일일업무는 제거
        for (const [aid, tid] of Object.entries(prevTaskIds)) {
          if (!nextTaskIds[aid]) await deleteTask(tid).catch(() => {});
        }

        // undefined 필드는 넣지 않는다 (Firestore는 배열 내부 undefined 거부)
        const item: ActionItem = {
          id: d.id ?? `${Date.now().toString(36)}-${idx}`,
          text,
          category: d.category,
          assigneeIds: assignees.map((a) => a.id),
          assigneeNames: assignees.map((a) => a.name),
        };
        if (detail) item.detail = detail;
        if (dueDate) item.dueDate = dueDate;
        if (Object.keys(nextTaskIds).length) item.taskIds = nextTaskIds;
        items.push(item);
      }

      // 자료 링크: URL 이 있는 행만 저장, 라벨 비면 URL 로 대체
      const links: MeetingLink[] = linkDrafts
        .filter((l) => l.url.trim())
        .map((l) => ({
          label: l.label.trim() || l.url.trim(),
          url: normalizeLinkUrl(l.url),
        }));

      const payload = {
        date,
        title: emptyToUndef(title),
        content: content.trim(),
        actionItems: items,
        links: links.length ? links : undefined,
      };

      await updateMeeting(initial.id, payload);
      // 누가 무엇을 고쳤는지 남긴다. 새 회의의 첫 저장은 「만들었습니다」 로 이미 남아 있다
      const changed = describeMeetingEdit(initial, { ...payload, actionItems: items, links });
      if (draftedFrom.current.size > 0) logMeetingEvent(initial.id, "minutes-ai", changed ?? undefined);
      else if (changed && !fresh) logMeetingEvent(initial.id, "edited", changed);
      // 초안을 넣은 녹음은 이제 확정 — 30일 뒤 음성을 지운다. 실패해도 회의록 저장은 된 것이다
      for (const recId of draftedFrom.current) await confirmRecording(recId).catch(() => undefined);
      draftedFrom.current.clear();
      toast.success(fresh ? "회의록을 저장했습니다" : "회의록을 수정했습니다");
      onDone?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PaneBar>
        {onBack && <BackToList onBack={onBack} />}
        <span className="hidden min-w-0 truncate text-nd-caption font-medium text-nd-fg-3 sm:block">
          {fresh ? "새 회의" : "회의록 편집"}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {recordingControls}
          <span className="mx-1 hidden h-5 w-px bg-nd-line sm:block" aria-hidden />
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>
              취소
            </Button>
          )}
          <Button type="submit" form={EDIT_FORM_ID} size="sm" loading={saving} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </Button>
        </span>
      </PaneBar>

      <DocBody>
        <form id={EDIT_FORM_ID} onSubmit={submit} className="flex flex-col">
          {/* 제목 — 읽기 화면의 제목과 같은 자리 · 같은 크기 */}
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
            placeholder="제목 없는 회의"
            aria-label="제목"
            className="w-full resize-none overflow-hidden bg-transparent text-[28px] font-bold leading-[1.25] tracking-[-0.02em] text-nd-fg outline-none placeholder:text-nd-fg-4"
          />
          <label className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-[8px] text-nd-caption font-medium text-nd-fg-3">
            <Icon icon={CalendarDays} size={14} />
            <span className="sr-only">회의 날짜</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="nd-num rounded-[6px] bg-transparent px-1 py-0.5 text-nd-fg-2 outline-none hover:bg-nd-fg/[.05] focus-visible:shadow-nd-focus"
            />
          </label>

          {recording && <div className="mt-7 empty:hidden">{recording}</div>}

          {/* 본문 */}
          <div className="mt-8">
            <label htmlFor="meeting-content" className="sr-only">
              회의 내용
            </label>
            <Textarea
              id="meeting-content"
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"회의 내용을 적으세요.\n■ 소제목 · - 항목 · 1) 번호 로 쓰면 읽기 화면에서 목록으로 정리됩니다."}
              className="min-h-[220px] w-full resize-none overflow-hidden !rounded-nd-lg !px-4 !py-3 !text-[15px] !leading-[1.7]"
            />
          </div>

          {/* 액션플랜 */}
          <section className="mt-12">
            <SectionHeader
              as="h3"
              title="액션플랜"
              hint="위에서부터 우선순위 · 담당자를 고르면 저장할 때 그 사람의 일일업무로 들어갑니다"
            />
            <ol className="flex flex-col gap-3">
              {drafts.map((d, i) => (
                <ActionDraftRow
                  key={d.key}
                  index={i}
                  draft={d}
                  members={members}
                  removable={drafts.length > 1}
                  onChange={(patch) => updateDraft(d.key, patch)}
                  onToggleAssignee={(id) => toggleAssignee(d.key, id)}
                  onRemove={() => removeRow(d.key)}
                />
              ))}
            </ol>
            <Button type="button" variant="ghost" size="sm" icon={Plus} className="mt-2 self-start" onClick={addRow}>
              액션플랜 추가
            </Button>
          </section>

          {/* 자료 링크 */}
          <section className="mt-12">
            <SectionHeader as="h3" title="자료 링크" hint="발표자료·문서를 회의록에 바로 연결" />
            {linkDrafts.length > 0 && (
              <div className="flex flex-col gap-2">
                {linkDrafts.map((l) => (
                  <FormRow key={l.key} className="grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2">
                    <Input
                      size="sm"
                      value={l.label}
                      onChange={(e) => updateLink(l.key, { label: e.target.value })}
                      placeholder="이름 (예: 발표자료)"
                      aria-label="링크 이름"
                    />
                    <Input
                      size="sm"
                      value={l.url}
                      onChange={(e) => updateLink(l.key, { url: e.target.value })}
                      placeholder="https://… 또는 /neander/…"
                      aria-label="링크 주소"
                    />
                    <IconButton
                      icon={X}
                      label="링크 삭제"
                      size="sm"
                      onClick={() => removeLinkRow(l.key)}
                      className="text-nd-fg-3 hover:text-nd-danger"
                    />
                  </FormRow>
                ))}
              </div>
            )}
            <Button type="button" variant="ghost" size="sm" icon={Plus} className="mt-2 self-start" onClick={addLinkRow}>
              링크 추가
            </Button>
          </section>

          {attachments && <section className="mt-12">{attachments}</section>}
        </form>
      </DocBody>
    </>
  );
}

/** 편집 중인 액션플랜 한 줄 — 할 일 · 세부 · 분류 · 마감 · 담당 */
function ActionDraftRow({
  index,
  draft: d,
  members,
  removable,
  onChange,
  onToggleAssignee,
  onRemove,
}: {
  index: number;
  draft: ActionDraft;
  members: MemberLite[];
  removable: boolean;
  onChange: (patch: Partial<ActionDraft>) => void;
  onToggleAssignee: (id: string) => void;
  onRemove: () => void;
}) {
  const linkedCount = Object.keys(d.taskIds).length;
  return (
    <li className="flex gap-3 rounded-nd-lg border border-nd-line bg-nd-sunken/40 p-3 sm:p-4">
      <span className="nd-num w-5 shrink-0 pt-[7px] text-right text-nd-body font-semibold text-nd-fg-4">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            value={d.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="할 일 (예: 신상품 입고 일정 확정)"
            aria-label={`${index + 1}번 액션 내용`}
            className="min-w-0 flex-1 font-medium"
          />
          {removable && (
            <IconButton icon={X} label="액션플랜 삭제" size="sm" onClick={onRemove} className="shrink-0 text-nd-fg-3 hover:text-nd-danger" />
          )}
        </div>
        <Textarea
          rows={2}
          value={d.detail}
          onChange={(e) => onChange({ detail: e.target.value })}
          placeholder="세부사항 (선택)"
          aria-label={`${index + 1}번 액션 세부사항`}
          className="w-full"
        />
        <FormRow className="sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">분류</span>
            <CategoryPicker value={d.category} onChange={(c) => onChange({ category: c })} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">마감일</span>
            <Input type="date" value={d.dueDate} onChange={(e) => onChange({ dueDate: e.target.value })} />
          </label>
        </FormRow>
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between gap-2 text-nd-caption font-medium text-nd-fg-2">
            <span>
              담당자 <span className="font-normal text-nd-fg-3">(여럿 고를 수 있습니다)</span>
            </span>
            {linkedCount > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-nd-success-text">
                <Icon icon={CalendarCheck} size={13} />
                일일업무 연결됨{linkedCount > 1 ? ` ${linkedCount}` : ""}
              </span>
            )}
          </span>
          {members.length === 0 ? (
            <p className="text-nd-caption text-nd-fg-3">등록된 팀원이 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => {
                const on = d.assigneeIds.includes(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => onToggleAssignee(m.id)}
                    aria-pressed={on}
                    className={cn(
                      "flex h-ctl-sm items-center gap-1.5 rounded-full border pl-1 pr-3 text-[13px] transition-colors duration-nd-fast",
                      on
                        ? "border-nd-accent bg-nd-accent-soft font-medium text-nd-accent-strong"
                        : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-fg/[.04]",
                    )}
                  >
                    <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-5 w-5 text-[10px]" />
                    {m.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
