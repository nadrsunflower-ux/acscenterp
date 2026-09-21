"use client";

// ============================================================
//  회의 녹음 — 도구 막대 단추(RecordingControls) + 문서 속 칸(MeetingRecording)
// ------------------------------------------------------------
//  녹음기와 대기열은 셸의 RecordingProvider 가 들고 있다 — 여기는 그것을
//  보여 주고 조작할 뿐이다. 이 칸이 사라져도(다른 화면으로 가도) 녹음은
//  이어진다.
//
//  시작 단추는 문서 위 도구 막대에 둔다 (음성 메모 앱의 빨간 단추). 문서
//  안에는 실제로 있는 것 — 녹음 중 판 · 변환 중 판 · 녹음 카드 — 만 그린다.
//  녹음이 하나도 없는 회의에서는 이 칸이 아예 없다 (2026-09-19 다듬기:
//  빈 회의마다 큰 파란 「녹음 시작」 이 본문과 다투던 것을 걷어 냈다).
//
//  회의록 초안은 바로 저장하지 않는다. 「회의록에 넣기」 를 누르면 편집
//  폼에 채워지고, 사람이 고쳐 저장해야 회의록이 된다 — 액션플랜은 저장하는
//  순간 담당자의 일일업무로 들어가기 때문이다. 그 저장이 「확정」 이고,
//  확정 30일 뒤 음성만 지운다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  CircleAlert,
  FileAudio,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  RotateCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Disclosure,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  Menu,
  Meter,
  SectionHeader,
  Spinner,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useRecording, useRecordingClock } from "./RecordingProvider";
import {
  deleteRecording,
  deleteRecordingAudio,
  fetchMeetingRecordings,
  fetchSegmentAudio,
  finalizeRecording,
  saveSpeakers,
  summarizeRecording,
  transcribeSegment,
} from "@/lib/neander/meetings/recording-client";
import {
  REC_AUDIO_KEEP_DAYS,
  estimateRecordingUsd,
  formatClock,
  formatDurationKo,
  isFullyTranscribed,
  krwApprox,
  speakerLabel,
  type MeetingMinutesDraft,
  type RecordingDetail,
  type TranscriptLine,
} from "@/lib/neander/meetings/recording";
import { formatDateKo, formatTimestamp } from "@/lib/neander/format";
import { MinutesText } from "./MinutesText";
import { taskCategoryColor, taskCategoryLabel } from "@/lib/neander/types";

type MemberLite = { id: string; name: string; color?: string };

/** 휴대폰 녹음 · 화상회의 녹화 — 브라우저가 소리만 꺼낸다 */
const ACCEPT = "audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.oga,.opus,.webm,.mp4,.mov,.3gp,.flac,.caf";

const errText = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류");

/** 화자 글자마다 구분되는 색 — 이름을 붙이기 전에도 누가 말했는지 한눈에 */
const SPEAKER_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4b5563"];
const speakerColor = (s: string) =>
  /^[A-Z]$/.test(s) ? SPEAKER_COLORS[(s.charCodeAt(0) - 65) % SPEAKER_COLORS.length] : "#71717a";

const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ============================================================
//  도구 막대 단추 — 녹음 · 파일 올리기
// ============================================================

export function RecordingControls({ meetingId, meetingLabel }: { meetingId: string; meetingLabel: string }) {
  const rec = useRecording();
  const toast = useToast();
  const confirm = useConfirm();
  const [opening, setOpening] = useState(false);
  const [starting, setStarting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const job = rec.job;
  // 이 회의를 녹음·변환 중이면 단추 대신 문서 안의 판이 조작을 맡는다
  if (job?.meetingId === meetingId) return null;
  const otherBusy = job !== null;
  const busyTitle = otherBusy ? "다른 회의를 녹음하거나 올리는 중입니다 — 끝난 뒤에 시작할 수 있습니다" : undefined;

  async function start() {
    setStarting(true);
    try {
      await rec.startLive({ id: meetingId, label: meetingLabel });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setStarting(false);
    }
  }

  async function pickFile(file: File) {
    setOpening(true);
    let opened;
    try {
      opened = await rec.openFile(file);
    } catch (e) {
      toast.error(errText(e));
      return;
    } finally {
      setOpening(false);
    }
    const usd = estimateRecordingUsd(opened.durationSec);
    const ok = await confirm({
      title: "이 녹음을 받아쓸까요?",
      message: `「${file.name}」 ${formatDurationKo(opened.durationSec)} — 받아쓰기와 회의록 초안에 ${krwApprox(usd)}(약 $${usd.toFixed(2)})이 듭니다. 원본 파일은 올리지 않고, 브라우저에서 가볍게 바꾼 음성만 올립니다.`,
      confirmLabel: "올리고 받아쓰기",
    });
    if (!ok) return opened.dispose();
    try {
      await rec.startUpload({ id: meetingId, label: meetingLabel }, file, opened);
    } catch (e) {
      toast.error(`「${file.name}」 을 올리지 못했습니다 — ${errText(e)}`);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={otherBusy || starting || opening}
        aria-label="녹음 시작"
        title={busyTitle ?? "회의를 녹음하면 10분마다 받아쓰고, 끝나면 AI 가 회의록 초안을 만듭니다 · 1시간 약 300원"}
        className="inline-flex h-ctl-sm shrink-0 items-center gap-1.5 rounded-full bg-nd-danger pl-2.5 pr-3 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[background-color,opacity] duration-nd-fast hover:bg-nd-danger/90 active:bg-nd-danger/80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {starting ? <Spinner size={12} className="text-white" /> : <span className="h-2 w-2 rounded-full bg-white" aria-hidden />}
        녹음
      </button>
      <IconButton
        icon={Upload}
        label="녹음 파일 올리기"
        size="sm"
        disabled={otherBusy || starting || opening}
        onClick={() => fileRef.current?.click()}
        title={busyTitle ?? "휴대폰 녹음 · 화상회의 녹화를 올려 받아쓰기"}
        className={cn(opening && "[&_svg]:animate-pulse")}
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickFile(f);
        }}
      />
    </>
  );
}

// ============================================================
//  문서 속 칸 — 녹음 중 · 변환 중 · 녹음 카드
// ============================================================

export function MeetingRecording({
  meetingId,
  members,
  onApplyDraft,
  editing = false,
}: {
  meetingId: string;
  members: MemberLite[];
  /** 「회의록에 넣기」 — 편집 폼에 초안을 채운다 */
  onApplyDraft: (draft: MeetingMinutesDraft, recId: string) => void;
  /** 편집 폼 안이면 초안을 한 줄로 접는다 */
  editing?: boolean;
}) {
  const rec = useRecording();
  const confirm = useConfirm();
  const [list, setList] = useState<RecordingDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await fetchMeetingRecordings(meetingId));
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, [meetingId]);

  // 대기열이 조각 하나를 끝낼 때마다(version) · 창으로 돌아올 때 다시 읽는다
  useEffect(() => {
    void load();
  }, [load, rec.version]);
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const job = rec.job;
  const mine = job?.meetingId === meetingId ? job : null;
  const sorted = useMemo(() => [...(list ?? [])].sort((a, b) => b.createdAt - a.createdAt), [list]);
  const blocked = rec.pipeline.blocked && rec.isBusy(meetingId);

  async function stop() {
    const ok = await confirm({
      title: "녹음을 끝낼까요?",
      message: "남은 조각을 받아쓴 뒤 AI 회의록 초안을 만들 수 있습니다. 끝낸 녹음은 이어서 녹음할 수 없습니다 — 쉬는 시간이면 「일시정지」 를 쓰세요.",
      confirmLabel: "녹음 끝내기",
    });
    if (ok) await rec.stop();
  }

  // 보여 줄 것이 없으면 칸을 그리지 않는다 — 부모의 빈 자리도 접힌다(empty:hidden)
  if (!mine && sorted.length === 0 && !blocked && !(list === null && loadError)) return null;

  return (
    <div className="flex flex-col gap-3">
      {mine?.kind === "live" && <LivePanel onStop={() => void stop()} />}
      {mine?.kind === "upload" && <UploadPanel />}

      {!rec.durable && mine && (
        <InlineNotice tone="warning">
          이 브라우저 창은 녹음 조각을 저장해 둘 수 없습니다(사생활 보호 모드 등). 올라가기 전에 창을 닫으면 그 조각은 사라집니다.
        </InlineNotice>
      )}

      {blocked && (
        <InlineNotice
          tone="warning"
          action={
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={rec.retryNow}>
              지금 다시
            </Button>
          }
        >
          {rec.pipeline.blocked}
        </InlineNotice>
      )}

      {list === null && loadError && (
        <InlineNotice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => void load()}>
              다시 읽기
            </Button>
          }
        >
          녹음 목록을 ERP 서버에서 받지 못했습니다.
          <span className="mt-0.5 block text-nd-caption opacity-80">{loadError}</span>
        </InlineNotice>
      )}

      {sorted
        .filter((r) => r.id !== mine?.recId)
        .map((r) => (
        <RecordingCard
          key={r.id}
          rec={r}
          members={members}
          editing={editing}
          onChanged={() => void load()}
          onApplyDraft={onApplyDraft}
        />
      ))}
    </div>
  );
}

// ---- 녹음 중 판 ---------------------------------------------

function LivePanel({ onStop }: { onStop: () => void }) {
  const rec = useRecording();
  useRecordingClock();
  const job = rec.job;
  if (job?.kind !== "live") return null;
  const paused = job.state === "paused";
  const stopping = job.state === "stopping";
  const cur = rec.pipeline.current;
  const working = cur && cur.recId === job.recId;

  return (
    <div className="overflow-hidden rounded-nd-lg border border-nd-line bg-nd-content shadow-nd-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              paused ? "bg-nd-fg/[.06] text-nd-fg-3" : "bg-nd-danger/10 text-nd-danger",
            )}
            aria-hidden
          >
            {paused ? (
              <Icon icon={Pause} size={18} />
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-nd-danger opacity-50" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-nd-danger" />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p className="text-nd-caption font-medium text-nd-fg-3">
              {stopping ? "마치는 중" : paused ? "일시정지" : "녹음 중"}
            </p>
            <p className="nd-num text-[26px] font-semibold leading-none tracking-[-0.02em] text-nd-fg tabular-nums">
              {formatClock(rec.elapsedSec())}
            </p>
          </div>
        </div>
        <Waveform paused={paused || stopping} />
        <div className="ml-auto flex items-center gap-2">
          {paused ? (
            <Button variant="secondary" size="sm" icon={Play} disabled={stopping} onClick={rec.resume}>
              이어서 녹음
            </Button>
          ) : (
            <Button variant="secondary" size="sm" icon={Pause} disabled={stopping} onClick={rec.pause}>
              일시정지
            </Button>
          )}
          <Button variant="danger" size="sm" icon={Square} loading={stopping} onClick={onStop}>
            녹음 끝내기
          </Button>
        </div>
      </div>
      <div className="border-t border-nd-line bg-nd-sunken/50 px-4 py-2.5 text-nd-caption text-nd-fg-3 sm:px-5">
        {working ? (
          <span className="text-nd-fg-2">
            {cur.n + 1}번째 조각 {cur.step === "upload" ? `올리는 중 ${Math.round(cur.progress * 100)}%` : "받아쓰는 중"} ·{" "}
          </span>
        ) : null}
        10분마다 나눠 올리고 바로 받아씁니다. 다른 ERP 화면으로 옮겨도 이어지고, 탭을 닫거나 노트북을 덮으면 멈춥니다 —
        그때까지 녹음한 것은 남습니다.
      </div>
    </div>
  );
}

/** 마이크 소리 — 음성 메모 앱처럼 지나간 소리가 막대로 흘러간다. 움직이면 마이크가 살아 있다 */
function Waveform({ paused }: { paused: boolean }) {
  const rec = useRecording();
  const BARS = 36;
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 80) {
        last = t;
        const v = rec.level();
        setLevels((ls) => [...ls.slice(1), v]);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, rec]);
  return (
    <div className="hidden h-10 min-w-[120px] flex-1 items-center gap-[3px] sm:flex" role="img" aria-label="마이크 소리 크기">
      {levels.map((v, i) => (
        <span
          key={i}
          className={cn("w-[3px] shrink-0 rounded-full transition-[height] duration-75", paused ? "bg-nd-fg/15" : "bg-nd-danger/70")}
          style={{ height: `${Math.max(3, Math.min(40, 3 + v * 44))}px` }}
        />
      ))}
    </div>
  );
}

function UploadPanel() {
  const rec = useRecording();
  const job = rec.job;
  if (job?.kind !== "upload") return null;
  const cur = rec.pipeline.current;
  return (
    <div className="rounded-nd-lg border border-nd-line bg-nd-content px-4 py-4 shadow-nd-card sm:px-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nd-accent-soft text-nd-accent-strong" aria-hidden>
          <Icon icon={FileAudio} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-nd-body font-semibold text-nd-fg" title={job.fileName}>
            {job.fileName}
          </p>
          <p className="nd-num text-nd-caption text-nd-fg-3">
            {formatDurationKo(job.durationSec)} · 브라우저에서 변환 {Math.round(job.progress * 100)}%
            {cur && cur.recId === job.recId ? ` · ${cur.n + 1}번째 조각 ${cur.step === "upload" ? "올리는 중" : "받아쓰는 중"}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={rec.cancelUpload}>
          취소
        </Button>
      </div>
      <div className="mt-3">
        <Meter value={job.progress} width={10_000} className="!w-full" label="변환 진행" />
      </div>
      <p className="mt-2 text-nd-caption text-nd-fg-3">변환이 끝나도 받아쓰기는 조각마다 30초쯤 더 걸립니다. 다른 화면으로 옮겨도 이어집니다.</p>
    </div>
  );
}

// ---- 녹음 한 건 ---------------------------------------------

function RecordingCard({
  rec: r,
  members,
  editing,
  onChanged,
  onApplyDraft,
}: {
  rec: RecordingDetail;
  members: MemberLite[];
  editing: boolean;
  onChanged: () => void;
  onApplyDraft: (draft: MeetingMinutesDraft, recId: string) => void;
}) {
  const ctx = useRecording();
  const toast = useToast();
  const confirm = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<null | "retry" | "finalize" | "summary" | "delete">(null);
  // 초안을 넣어 확정한 녹음은 할 일이 끝났다 — 접어 둔다
  const [open, setOpen] = useState(!r.confirmedAt);

  const local = ctx.isLocal(r.id);
  const lines = useMemo(() => r.segments.flatMap((s) => s.lines ?? []), [r.segments]);
  const done = isFullyTranscribed(r);
  // 받아쓰지 못한 조각 — 이 창의 대기열이 아직 할 조각은 빼고
  const failed = r.segments.filter((s) => s.uploaded && !s.transcribedAt && !local);
  const stale = !r.ended && !local && r.updatedAt < Date.now() - 2 * 60 * 1000;
  const covered = r.segments.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0);
  const partial = r.source === "upload" && r.ended && r.durationSec - covered > 30;
  const needsAttention = stale || (failed.length > 0 && r.ended) || partial;

  async function retryFailed() {
    setBusy("retry");
    let ok = 0;
    for (const s of failed) {
      try {
        await transcribeSegment(r.id, s.n);
        ok++;
      } catch (e) {
        toast.error(`${s.n + 1}번째 조각을 받아쓰지 못했습니다 — ${errText(e)}`);
        break;
      }
    }
    setBusy(null);
    if (ok) ctx.bump();
    onChanged();
  }

  async function finalize() {
    setBusy("finalize");
    try {
      await finalizeRecording(r.id);
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function summarize() {
    setBusy("summary");
    try {
      await summarizeRecording(r.id);
      onChanged();
    } catch (e) {
      toast.error(`회의록 초안을 만들지 못했습니다 — ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function removeAudio() {
    const ok = await confirm({
      title: "음성만 지울까요?",
      message: "받아쓴 글과 회의록 초안은 남습니다. 음성을 지우면 다시 듣거나 다시 받아쓸 수 없습니다.",
      confirmLabel: "음성 지우기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteRecordingAudio(r.id);
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "이 녹음을 지울까요?",
      message: "음성과 받아쓴 글, 회의록 초안이 모두 사라집니다. 이미 회의록에 넣어 저장한 내용은 그대로 남습니다.",
      confirmLabel: "녹음 삭제",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await deleteRecording(r.id);
      onChanged();
    } catch (e) {
      toast.error(errText(e));
      setBusy(null);
    }
  }

  const status = !r.ended
    ? local
      ? { tone: "danger" as const, text: ctx.job?.recId === r.id && ctx.job.kind === "live" ? "녹음 중" : "올리는 중" }
      : { tone: "warning" as const, text: "끊김" }
    : done
      ? r.confirmedAt
        ? { tone: "neutral" as const, text: "회의록에 넣음" }
        : { tone: "success" as const, text: "받아쓰기 끝" }
      : { tone: "info" as const, text: `받아쓰는 중 ${r.transcribed}/${r.segCount}` };

  const audioNote = r.audioDeletedAt
    ? `음성은 ${formatDateKo(ymd(r.audioDeletedAt))}에 지웠습니다 — 받아쓴 글은 남아 있습니다.`
    : r.audioDeleteAt
      ? `음성은 ${formatDateKo(ymd(r.audioDeleteAt))}에 지워집니다 (회의록 확정 ${REC_AUDIO_KEEP_DAYS}일 뒤).`
      : `음성은 초안을 넣은 회의록을 저장하고 ${REC_AUDIO_KEEP_DAYS}일 뒤 지워집니다.`;

  return (
    <div className="overflow-hidden rounded-nd-lg border border-nd-line bg-nd-content">
      {/* 머리 — 무엇을 · 얼마나 · 어디까지. 누르면 접고 편다 */}
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left outline-none focus-visible:shadow-nd-focus"
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              r.source === "live" ? "bg-nd-danger/10 text-nd-danger" : "bg-nd-accent-soft text-nd-accent-strong",
            )}
            aria-hidden
          >
            <Icon icon={r.source === "live" ? Mic : FileAudio} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-nd-body font-semibold text-nd-fg" title={r.name}>
                {r.name}
              </span>
              <Badge size="sm" tone={status.tone}>
                {status.text}
              </Badge>
            </span>
            <span className="nd-num mt-0.5 block truncate text-nd-caption text-nd-fg-3">
              {formatDurationKo(r.durationSec || covered)} · {formatTimestamp(r.createdAt)}
              {r.costUsd > 0 && ` · AI 비용 ${krwApprox(r.costUsd)}`}
            </span>
          </span>
          <Icon
            icon={ChevronDown}
            size={16}
            className={cn("shrink-0 text-nd-fg-3 transition-transform duration-nd-fast", open && "rotate-180")}
          />
        </button>
        <IconButton
          ref={menuBtn}
          icon={MoreHorizontal}
          label="녹음 메뉴"
          size="sm"
          disabled={busy === "delete"}
          onClick={() => setMenuOpen((v) => !v)}
        />
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuBtn}
          placement="bottom-end"
          ariaLabel="녹음 메뉴"
          className="w-52"
          items={[
            ...(r.audioDeletedAt || local
              ? []
              : [{ key: "audio", label: "음성만 지우기", icon: AudioLines, onSelect: () => void removeAudio() }]),
            { key: "delete", label: "녹음 삭제", icon: Trash2, danger: true, disabled: local, onSelect: () => void remove() },
          ]}
        />
      </div>

      {/* 진행 — 접혀 있어도 보인다 */}
      {!done && r.segCount > 0 && (
        <div className="flex items-center gap-3 border-t border-nd-line px-4 py-2.5">
          <Meter value={r.transcribed} max={Math.max(1, r.segCount)} width={140} label="받아쓰기 진행" />
          <span className="nd-num text-nd-caption text-nd-fg-2">
            조각 {r.segCount}개 중 {r.transcribed}개 받아씀{!r.ended && " · 녹음이 끝나면 초안을 만들 수 있습니다"}
          </span>
        </div>
      )}

      {(open || needsAttention) && (
        <div className="flex flex-col gap-4 border-t border-nd-line px-4 pb-4 pt-4">
          {stale && (
            <InlineNotice
              tone="warning"
              action={
                <Button variant="secondary" size="sm" loading={busy === "finalize"} onClick={() => void finalize()}>
                  여기까지로 마치기
                </Button>
              }
            >
              {r.source === "live"
                ? "녹음이 중간에 끊겼습니다 — 녹음하던 창이 닫혔거나 인터넷이 끊겼습니다."
                : "파일 올리기가 중간에 멈췄습니다 — 창이 닫혔을 수 있습니다."}
              <span className="mt-0.5 block text-nd-caption opacity-80">
                녹음한 브라우저를 다시 열면 남은 조각을 이어서 올립니다. 기다리지 않으려면 올라간 데까지로 마치세요.
              </span>
            </InlineNotice>
          )}

          {failed.length > 0 && r.ended && (
            <InlineNotice
              tone="warning"
              icon={CircleAlert}
              action={
                r.audioDeletedAt ? undefined : (
                  <Button variant="secondary" size="sm" icon={RotateCw} loading={busy === "retry"} onClick={() => void retryFailed()}>
                    다시 받아쓰기
                  </Button>
                )
              }
            >
              받아쓰지 못한 조각이 {failed.length}개 있습니다.
              {failed[0].error && <span className="mt-0.5 block text-nd-caption opacity-80">{failed[0].error}</span>}
            </InlineNotice>
          )}

          {partial && (
            <InlineNotice tone="warning">
              파일의 앞 {formatDurationKo(covered)}만 올라갔습니다 (전체 {formatDurationKo(r.durationSec)}). 나머지가 필요하면 이 녹음을 지우고 파일을 다시 올려 주세요.
            </InlineNotice>
          )}

          {open && (
            <>
              {done && (
                <DraftBlock
                  rec={r}
                  editing={editing}
                  busy={busy === "summary"}
                  onSummarize={() => void summarize()}
                  onApply={() => r.summary && onApplyDraft(r.summary, r.id)}
                />
              )}
              {lines.length > 0 && <SpeakerNames rec={r} lines={lines} members={members} onSaved={onChanged} />}
              {lines.length > 0 && <TranscriptView rec={r} lines={lines} />}
              <p className="text-nd-caption text-nd-fg-3">{audioNote}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 화자 이름 ----------------------------------------------

/** 화자 글자에 사람 이름을 붙인다 — 초안이 담당자를 더 잘 고르고, 받아쓴 글도 읽기 쉬워진다 */
function SpeakerNames({
  rec: r,
  lines,
  members,
  onSaved,
}: {
  rec: RecordingDetail;
  lines: TranscriptLine[];
  members: MemberLite[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const speakers = useMemo(() => [...new Set(lines.map((l) => l.s))].sort(), [lines]);
  const [names, setNames] = useState<Record<string, string>>(r.speakers ?? {});
  useEffect(() => setNames(r.speakers ?? {}), [r.speakers]);
  const listId = `speaker-names-${r.id}`;

  async function save(next: Record<string, string>) {
    if (JSON.stringify(next) === JSON.stringify(r.speakers ?? {})) return;
    try {
      await saveSpeakers(r.id, next);
      onSaved();
    } catch (e) {
      toast.error(`화자 이름을 저장하지 못했습니다 — ${errText(e)}`);
    }
  }

  if (speakers.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-nd-caption font-medium text-nd-fg-2">
        화자 이름 <span className="font-normal text-nd-fg-3">— 붙이면 받아쓴 글이 읽기 쉬워지고, 초안이 담당자를 더 잘 고릅니다</span>
      </p>
      <datalist id={listId}>
        {members.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>
      <div className="flex flex-wrap gap-2">
        {speakers.map((s) => (
          <label
            key={s}
            className="flex h-ctl-sm items-center gap-1.5 rounded-full border border-nd-border bg-nd-content pl-1 pr-1.5 focus-within:border-nd-accent"
          >
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: speakerColor(s) }}
              aria-hidden
            >
              {s.slice(0, 1)}
            </span>
            <Input
              size="sm"
              list={listId}
              value={names[s] ?? ""}
              placeholder={`화자 ${s}`}
              aria-label={`화자 ${s} 이름`}
              onChange={(e) => setNames((n) => ({ ...n, [s]: e.target.value }))}
              onBlur={() => void save(Object.fromEntries(Object.entries(names).filter(([, v]) => v.trim())))}
              className="!h-6 !w-24 !border-0 !bg-transparent !px-1 !shadow-none focus:!shadow-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ---- 회의록 초안 --------------------------------------------

function DraftBlock({
  rec: r,
  editing,
  busy,
  onSummarize,
  onApply,
}: {
  rec: RecordingDetail;
  editing: boolean;
  busy: boolean;
  onSummarize: () => void;
  onApply: () => void;
}) {
  const est = krwApprox(estimateRecordingUsd(r.durationSec) * 0.16);
  if (busy) {
    return (
      <div className="flex items-center gap-2.5 rounded-nd-md bg-nd-accent-soft px-4 py-3 text-nd-body text-nd-accent-strong">
        <Spinner size={16} />
        AI 가 회의록 초안을 만드는 중입니다 — 30초에서 1분쯤 걸립니다.
      </div>
    );
  }
  if (!r.summary) {
    return (
      <div className="rounded-nd-md bg-nd-accent-soft/60 px-4 py-3">
        <div className="flex items-start gap-3">
          <Icon icon={Sparkles} size={18} className="mt-0.5 shrink-0 text-nd-accent-strong" />
          <div className="min-w-0 flex-1">
            <p className="text-nd-body font-semibold text-nd-fg">받아쓰기가 끝났습니다</p>
            <p className="text-nd-caption text-nd-fg-2">받아쓴 글 전체로 요약 · 결정 사항 · 액션플랜을 뽑습니다 · {est}</p>
          </div>
          <Button size="sm" icon={Sparkles} className="hidden shrink-0 sm:inline-flex" onClick={onSummarize}>
            AI 회의록 초안 만들기
          </Button>
        </div>
        <Button size="sm" icon={Sparkles} className="mt-2.5 w-full sm:hidden" onClick={onSummarize}>
          AI 회의록 초안 만들기
        </Button>
      </div>
    );
  }
  const d = r.summary;
  const counts = [`액션플랜 ${d.actionItems.length}건`, d.decisions.length ? `결정 ${d.decisions.length}건` : ""]
    .filter(Boolean)
    .join(" · ");
  const head = (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <Icon icon={Sparkles} size={15} className="text-nd-accent-strong" />
      <span className="min-w-0 flex-1 truncate text-nd-body">
        <span className="font-semibold text-nd-fg">AI 회의록 초안</span>
        <span className="text-nd-fg-3">
          {" "}
          · {editing ? `${d.title || "제목 없음"} · ${counts}` : r.summaryAt ? formatTimestamp(r.summaryAt) : ""}
        </span>
      </span>
      <Button variant="ghost" size="sm" icon={RotateCw} onClick={onSummarize}>
        다시 만들기
      </Button>
      <Button size="sm" onClick={onApply}>
        {editing ? "폼에 넣기" : "회의록에 넣기"}
      </Button>
    </div>
  );
  // 편집 폼 안에서는 폼이 주인공이다 — 초안은 한 줄로 접고 넣기 단추만
  if (editing) return <div className="rounded-nd-md border border-nd-accent/25 bg-nd-accent-soft/50">{head}</div>;
  return (
    <div className="overflow-hidden rounded-nd-md border border-nd-accent/25 bg-nd-accent-soft/30">
      <div className="border-b border-nd-accent/15 bg-nd-accent-soft/40">{head}</div>
      <div className="flex flex-col gap-4 px-4 py-4">
        {d.title && <p className="text-[17px] font-semibold tracking-[-0.01em] text-nd-fg">{d.title}</p>}
        {d.content && <MinutesText text={d.content} className="!text-nd-body" />}
        {d.decisions.length > 0 && <BulletBlock title="결정 사항" items={d.decisions} />}
        {d.actionItems.length > 0 && (
          <div>
            <p className="mb-1.5 text-nd-caption font-semibold text-nd-fg-2">액션플랜 {d.actionItems.length}건</p>
            <ul className="flex flex-col gap-1.5">
              {d.actionItems.map((a, i) => (
                <li key={i} className="rounded-nd-md bg-nd-content px-3 py-2">
                  <span className="flex items-start gap-2">
                    <span
                      className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                      style={{ background: taskCategoryColor(a.category) }}
                      title={taskCategoryLabel(a.category)}
                    />
                    <span className="text-nd-body text-nd-fg">{a.text}</span>
                  </span>
                  {(a.detail || a.assignees.length > 0 || a.dueDate) && (
                    <span className="nd-num mt-0.5 block pl-4 text-nd-caption text-nd-fg-2">
                      {[
                        taskCategoryLabel(a.category),
                        a.assignees.length ? `담당 ${a.assignees.join(", ")}` : "",
                        a.dueDate ? `마감 ${formatDateKo(a.dueDate)}` : "",
                        a.detail,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.openQuestions.length > 0 && <BulletBlock title="남은 질문" items={d.openQuestions} />}
        <p className="text-nd-caption text-nd-fg-3">
          「회의록에 넣기」 를 누르면 회의록 편집에 채워집니다. 고쳐서 저장해야 회의록이 되고, 담당자를 고른 액션플랜은 그때 일일업무로 들어갑니다.
        </p>
      </div>
    </div>
  );
}

function BulletBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-nd-caption font-semibold text-nd-fg-2">{title}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-nd-body text-nd-fg marker:text-nd-fg-4">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- 받아쓴 글 · 다시 듣기 ----------------------------------

function TranscriptView({ rec: r, lines }: { rec: RecordingDetail; lines: TranscriptLine[] }) {
  const toast = useToast();
  const audio = useRef<HTMLAudioElement>(null);
  const [loaded, setLoaded] = useState<{ n: number; url: string } | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const canPlay = !r.audioDeletedAt;

  // 받은 음성 주소는 닫힐 때 치운다
  useEffect(() => () => void (loaded && URL.revokeObjectURL(loaded.url)), [loaded]);

  async function playAt(t: number) {
    const seg = r.segments.find((s) => s.uploaded && t >= s.startSec && t < s.startSec + s.durationSec + 1);
    if (!seg) return;
    const offset = Math.max(0, t - seg.startSec - 1);
    const el = audio.current;
    if (!el) return;
    if (loaded?.n === seg.n) {
      el.currentTime = offset;
      void el.play().catch(() => undefined);
      return;
    }
    setLoading(seg.n);
    try {
      const url = URL.createObjectURL(await fetchSegmentAudio(r.id, seg));
      setLoaded({ n: seg.n, url });
      el.src = url;
      el.addEventListener(
        "loadedmetadata",
        () => {
          el.currentTime = offset;
          void el.play().catch(() => undefined);
        },
        { once: true },
      );
    } catch (e) {
      toast.error(`음성을 받지 못했습니다 — ${errText(e)}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <Disclosure
      title="받아쓴 글"
      meta={<span className="nd-num">{lines.length.toLocaleString("ko-KR")}줄</span>}
      description={canPlay ? "시각을 누르면 그 부분 음성을 들을 수 있습니다" : undefined}
    >
      <audio ref={audio} controls className={cn("mb-3 h-9 w-full", !loaded && "hidden")} />
      <ol className="nd-scroll flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
        {lines.map((l, i) => {
          const same = lines[i - 1]?.s === l.s;
          return (
            <li key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 text-nd-body leading-relaxed">
              {canPlay ? (
                <button
                  type="button"
                  onClick={() => void playAt(l.t)}
                  className="nd-num mt-[3px] h-fit rounded-[6px] text-left text-nd-caption text-nd-accent-strong hover:underline"
                  title="이 부분 듣기"
                >
                  {loading !== null &&
                  r.segments.find((s) => s.n === loading && l.t >= s.startSec && l.t < s.startSec + s.durationSec) ? (
                    <Spinner size={12} />
                  ) : (
                    formatClock(l.t)
                  )}
                </button>
              ) : (
                <span className="nd-num mt-[3px] text-nd-caption text-nd-fg-3">{formatClock(l.t)}</span>
              )}
              <span className="min-w-0">
                {/* 같은 사람이 이어 말하면 이름을 되풀이하지 않는다 — 대화처럼 읽힌다 */}
                {!same && (
                  <span className="mr-2 font-semibold" style={{ color: speakerColor(l.s) }}>
                    {speakerLabel(l.s, r.speakers)}
                  </span>
                )}
                <span className="text-nd-fg">{l.x}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Disclosure>
  );
}
