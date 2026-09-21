"use client";

// ============================================================
//  회의 녹음 — ERP 전체에서 녹음 한 건과 올리기 대기열을 들고 있는다
// ------------------------------------------------------------
//  회의 화면이 아니라 셸(Providers)에 둔다. 3시간 회의 중에 매출 화면을
//  열어 봐도 녹음이 끊기면 안 되기 때문이다. 상단바의 RecordingIndicator 가
//  어느 화면에서든 「녹음 중」 을 보여 주고, 누르면 그 회의로 간다.
//
//  대기열 — 조각(ERP 녹음 10분 · 파일 변환 10분)이 나오는 대로 올리기 →
//  받아쓰기를 차례로 한다. 받아쓰기가 앞 조각의 끝을 물려받으므로(화자
//  글자) 한 번에 하나씩이다.
//    · 올리기는 될 때까지 다시 한다 (인터넷이 끊기는 회의실). 조각은
//      IndexedDB 에 있으니 잃지 않는다 (pending-store.ts).
//    · 받아쓰기는 세 번 해 보고 안 되면 넘어간다 — 녹음이 막히면 안 된다.
//      못 한 조각은 회의 화면의 「다시 받아쓰기」 로 돌린다.
//    · 창을 닫았다 다시 열면 IndexedDB 에 남은 조각을 찾아 이어서 올린다.
//
//  창이 여럿이면 Web Locks 로 녹음 하나를 한 창만 만진다 — 녹음 중이거나
//  대기열에 조각이 있는 동안 `neander-rec:{id}` 를 쥐고, 다른 창의 복구는
//  쥔 녹음을 건너뛴다.
// ============================================================

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { cn, Icon, useToast } from "@/components/neander/ui";
import {
  createRecording,
  deleteRecording,
  endRecording,
  transcribeSegment,
  uploadSegment,
} from "@/lib/neander/meetings/recording-client";
import { deleteSeg, isDurable, listSegs, putChunk, putSeg, segBlob } from "@/lib/neander/meetings/pending-store";
import { CHUNK_SEC, SegmentedRecorder, openMicrophone, pickRecFormat } from "@/lib/neander/meetings/recorder";
import { openAudioFile, type OpenedAudioFile } from "@/lib/neander/meetings/convert";
import {
  REC_AUDIO_MIME,
  REC_SEGMENT_SEC,
  formatClock,
  type RecAudioFormat,
  type RecordingSource,
} from "@/lib/neander/meetings/recording";

export interface LiveJob {
  kind: "live";
  recId: string;
  meetingId: string;
  /** 상단바에 보일 회의 이름 */
  label: string;
  state: "recording" | "paused" | "stopping";
  format: RecAudioFormat;
}

export interface UploadJob {
  kind: "upload";
  recId: string;
  meetingId: string;
  label: string;
  fileName: string;
  durationSec: number;
  /** 변환 진행 0~1 */
  progress: number;
}

export type RecJob = LiveJob | UploadJob;

interface QueueItem {
  recId: string;
  meetingId: string;
  source: RecordingSource;
  n: number;
  startSec: number;
  durationSec: number;
  format: RecAudioFormat;
  /** 메모리에 있으면 — 없으면 IndexedDB 에서 읽는다 */
  blob?: Blob;
  uploaded?: boolean;
  /** 이 조각까지 올리고 녹음을 끝낸다 (복구한 ERP 녹음) */
  endAfter?: { segCount: number; durationSec: number };
}

export interface PipelineView {
  /** 아직 끝나지 않은 조각 수 (지금 하는 것 포함) */
  waiting: number;
  current: { recId: string; meetingId: string; n: number; step: "upload" | "transcribe"; progress: number } | null;
  /** 올리기가 막혔다 — 사람이 읽을 이유. 저절로 다시 시도한다 */
  blocked: string | null;
}

interface RecordingCtx {
  job: RecJob | null;
  pipeline: PipelineView;
  /** 서버의 녹음이 바뀔 때마다 는다 — 회의 화면이 다시 읽는다 */
  version: number;
  /** 조각을 브라우저에 오래 남길 수 있는가 (IndexedDB) */
  durable: boolean;
  elapsedSec: () => number;
  level: () => number;
  startLive: (m: { id: string; label: string }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  /** 파일을 연다(길이·예상 비용) — 확인을 받은 뒤 startUpload 에 넘긴다 */
  openFile: (file: File) => Promise<OpenedAudioFile>;
  startUpload: (m: { id: string; label: string }, file: File, opened: OpenedAudioFile) => Promise<void>;
  cancelUpload: () => void;
  retryNow: () => void;
  /** 이 회의의 녹음이 이 창에서 진행 중인가 (녹음 · 변환 · 대기열) */
  isBusy: (meetingId: string) => boolean;
  /** 이 창이 쥐고 있는 녹음인가 — 화면이 「중간에 멈춤」 으로 오해하지 않게 */
  isLocal: (recId: string) => boolean;
  bump: () => void;
}

const Ctx = createContext<RecordingCtx | null>(null);
/** 녹음 중 1초마다 느는 값 — 시계를 보여 주는 곳만 구독한다 (회의 화면 전체가 매초 다시 그려지지 않게) */
const ClockCtx = createContext(0);

export function useRecording(): RecordingCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRecording 은 RecordingProvider 안에서만 쓸 수 있습니다.");
  return c;
}

/** 녹음 시계를 보여 주는 부품이 부른다 — 매초 다시 그려진다 */
export const useRecordingClock = () => useContext(ClockCtx);

/** 올리기 재시도 간격 — 다 쓰면 「막힘」 으로 두고 1분마다 · 인터넷이 돌아오면 다시 */
const UPLOAD_BACKOFF_MS = [3_000, 10_000, 30_000];
const BLOCKED_RETRY_MS = 60_000;
const TRANSCRIBE_TRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류");
/** 녹음이나 회의가 지워졌다 — 다시 해도 안 된다 */
const isGone = (e: unknown) => /녹음을 찾지 못했습니다|회의를 찾지 못했습니다|음성을 이미 지워/.test(errText(e));
const lockName = (recId: string) => `neander-rec:${recId}`;

/**
 * 개발 서버 검증용 조각 길이 — 10분을 기다리지 않고 조각 넘김·복구를 본다.
 * localStorage 「neander.rec.devSegmentSec」 에 10 이상을 넣으면 쓴다. 배포본에서는 무시한다.
 */
function devSegmentSec(): number | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  try {
    const v = Number(localStorage.getItem("neander.rec.devSegmentSec"));
    return v >= 10 ? v : undefined;
  } catch {
    return undefined;
  }
}
const hasLocks = () => typeof navigator !== "undefined" && !!navigator.locks;

export function RecordingProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [job, setJobState] = useState<RecJob | null>(null);
  const jobRef = useRef<RecJob | null>(null);
  const setJob = useCallback((next: RecJob | null | ((j: RecJob | null) => RecJob | null)) => {
    const v = typeof next === "function" ? next(jobRef.current) : next;
    jobRef.current = v;
    setJobState(v);
  }, []);
  const recorder = useRef<SegmentedRecorder | null>(null);
  const queue = useRef<QueueItem[]>([]);
  const running = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelUploadRef = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const locks = useRef(new Map<string, () => void>());
  const [pipeline, setPipeline] = useState<PipelineView>({ waiting: 0, current: null, blocked: null });
  const [version, setVersion] = useState(0);
  const [durable, setDurable] = useState(true);
  const [tick, setTick] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const syncWaiting = useCallback(() => setPipeline((p) => ({ ...p, waiting: queue.current.length })), []);

  // ---- Web Locks — 녹음 하나를 한 창만 -------------------------

  const holdLock = useCallback((recId: string) => {
    if (!hasLocks() || locks.current.has(recId)) return;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    locks.current.set(recId, release);
    void navigator.locks.request(lockName(recId), () => held).catch(() => undefined);
  }, []);

  /** 녹음도 끝났고 대기열에도 없으면 놓는다 */
  const maybeRelease = useCallback((recId: string) => {
    const j = jobRef.current;
    if (j?.recId === recId) return;
    if (queue.current.some((q) => q.recId === recId)) return;
    locks.current.get(recId)?.();
    locks.current.delete(recId);
  }, []);

  // ---- 대기열 -------------------------------------------------

  const processItem = useCallback(
    async (item: QueueItem): Promise<boolean> => {
      const cur = (step: "upload" | "transcribe", progress = 0) =>
        setPipeline((p) => ({
          ...p,
          current: { recId: item.recId, meetingId: item.meetingId, n: item.n, step, progress },
        }));

      if (!item.uploaded) {
        let blob = item.blob;
        if (!blob) blob = (await segBlob(item.recId, item.n, REC_AUDIO_MIME[item.format])).blob;
        if (blob.size === 0) {
          // 토막이 하나도 없는 조각 — 올릴 것이 없다
          await deleteSeg(item.recId, item.n);
          return true;
        }
        for (let attempt = 0; ; attempt++) {
          try {
            cur("upload");
            await uploadSegment(item.recId, { ...item, blob }, (p) => cur("upload", p));
            break;
          } catch (e) {
            if (isGone(e)) {
              await deleteSeg(item.recId, item.n);
              return true;
            }
            if (attempt >= UPLOAD_BACKOFF_MS.length) {
              setPipeline((p) => ({
                ...p,
                blocked: `조각을 올리지 못하고 있습니다 — ${errText(e)}. 녹음은 이 브라우저에 저장돼 있고 1분마다 다시 올립니다.`,
              }));
              return false;
            }
            await sleep(UPLOAD_BACKOFF_MS[attempt]);
          }
        }
        item.uploaded = true;
        item.blob = undefined;
        setPipeline((p) => ({ ...p, blocked: null }));
        await deleteSeg(item.recId, item.n);
        bump();
      }

      for (let attempt = 0; attempt < TRANSCRIBE_TRIES; attempt++) {
        try {
          cur("transcribe");
          await transcribeSegment(item.recId, item.n);
          break;
        } catch (e) {
          // 지워졌거나 다른 창이 받아쓰는 중이면 그만. 마지막 실패는 회의 화면이 보여 준다
          if (isGone(e) || /다른 곳에서 받아쓰는 중/.test(errText(e)) || attempt === TRANSCRIBE_TRIES - 1) break;
          await sleep(5_000 * (attempt + 1));
        }
      }
      bump();
      return true;
    },
    [bump],
  );

  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        const ok = await processItem(item).catch(() => false);
        if (!ok) {
          retryTimer.current = setTimeout(() => void runQueue(), BLOCKED_RETRY_MS);
          return;
        }
        queue.current.shift();
        syncWaiting();
        if (item.endAfter) {
          await endRecording(item.recId, item.endAfter.segCount, item.endAfter.durationSec).catch(() => undefined);
          bump();
        }
        maybeRelease(item.recId);
      }
    } finally {
      running.current = false;
      setPipeline((p) => ({ ...p, current: null, waiting: queue.current.length }));
    }
  }, [processItem, syncWaiting, maybeRelease, bump]);

  const enqueue = useCallback(
    (item: QueueItem) => {
      holdLock(item.recId);
      queue.current.push(item);
      syncWaiting();
      void runQueue();
    },
    [holdLock, syncWaiting, runQueue],
  );

  /** 녹음 하나의 대기 조각을 모두 버린다 (올리기 취소 · 실패) */
  const dropQueued = useCallback(
    async (recId: string) => {
      const mine = queue.current.filter((q) => q.recId === recId && q !== queue.current[0]);
      queue.current = queue.current.filter((q) => !mine.includes(q));
      syncWaiting();
      for (const q of mine) await deleteSeg(recId, q.n);
    },
    [syncWaiting],
  );

  const retryNow = useCallback(() => {
    setPipeline((p) => ({ ...p, blocked: null }));
    void runQueue();
  }, [runQueue]);

  // 인터넷이 돌아오면 바로 다시
  useEffect(() => {
    const on = () => void runQueue();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [runQueue]);

  // ---- 복구 — 창이 닫혀 남은 조각 -----------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setDurable(await isDurable());
      const segs = await listSegs();
      if (cancelled || segs.length === 0) return;
      let held = new Set<string>();
      if (hasLocks()) {
        try {
          const q = await navigator.locks.query();
          held = new Set([...(q.held ?? []), ...(q.pending ?? [])].map((l) => l.name ?? ""));
        } catch {
          // 모르면 다 복구한다 — 서버가 이미 올라간 조각은 already 로 건너뛴다
        }
      }
      const byRec = new Map<string, typeof segs>();
      for (const s of segs) {
        if (held.has(lockName(s.recId)) || queue.current.some((q) => q.recId === s.recId)) continue;
        byRec.set(s.recId, [...(byRec.get(s.recId) ?? []), s]);
      }
      let count = 0;
      for (const [recId, list] of byRec) {
        const items: QueueItem[] = [];
        for (const s of list) {
          const { blob, chunks } = await segBlob(recId, s.n, REC_AUDIO_MIME[s.format]);
          if (chunks === 0 || blob.size === 0) {
            await deleteSeg(recId, s.n);
            continue;
          }
          // 녹음 중에 닫힌 조각은 길이를 모른다 — 토막 수로 어림한다 (마지막 토막은 10초보다 짧을 수 있다)
          const durationSec = s.closed ? s.durationSec : Math.min(REC_SEGMENT_SEC, chunks * CHUNK_SEC);
          items.push({ ...s, durationSec, blob });
        }
        if (items.length === 0 || cancelled) continue;
        const last = items[items.length - 1];
        // ERP 녹음은 녹음하던 창이 사라졌으니 여기서 끝낸다. 파일 올리기는 파일이 없어
        // 나머지를 만들 수 없다 — 올라간 데까지는 회의 화면이 「마무리」 로 끝낸다
        if (last.source === "live") last.endAfter = { segCount: last.n + 1, durationSec: last.startSec + last.durationSec };
        items.forEach(enqueue);
        count += items.length;
      }
      if (count > 0) toast.info(`끊긴 녹음 조각 ${count}개를 이어서 올립니다.`);
    })();
    return () => {
      cancelled = true;
    };
    // 처음 한 번만 — 창이 열릴 때 남은 것
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 화면 꺼짐 막기 ------------------------------------------

  const acquireWakeLock = useCallback(async () => {
    try {
      if (!wakeLock.current && navigator.wakeLock) wakeLock.current = await navigator.wakeLock.request("screen");
      wakeLock.current?.addEventListener("release", () => (wakeLock.current = null));
    } catch {
      // 배터리 절약 모드 등 — 녹음은 계속된다
    }
  }, []);
  const releaseWakeLock = useCallback(() => {
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }, []);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && jobRef.current?.kind === "live") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWakeLock]);

  // 녹음 중 시계 — 1초마다 다시 그린다 (이 값을 읽는 곳만)
  const liveOn = job?.kind === "live";
  useEffect(() => {
    if (!liveOn) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [liveOn]);

  // 녹음·올리기 중에 탭을 닫으면 한 번 묻는다
  const busy = job !== null || pipeline.waiting > 0;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // ---- ERP 녹음 -----------------------------------------------

  const stop = useCallback(async () => {
    const j = jobRef.current;
    const r = recorder.current;
    if (!j || j.kind !== "live" || !r || j.state === "stopping") return;
    setJob({ ...j, state: "stopping" });
    const { segments, durationSec } = await r.stop();
    recorder.current = null;
    releaseWakeLock();
    setJob(null);
    try {
      await endRecording(j.recId, segments, durationSec);
    } catch {
      // 인터넷이 끊겼다 — 마지막 조각이 올라갈 때 다시 알린다
      const last = [...queue.current].reverse().find((q) => q.recId === j.recId);
      if (last) last.endAfter = { segCount: segments, durationSec };
    }
    maybeRelease(j.recId);
    bump();
  }, [setJob, releaseWakeLock, maybeRelease, bump]);

  const startLive = useCallback(
    async (m: { id: string; label: string }) => {
      if (jobRef.current) throw new Error("이미 녹음이나 파일 올리기가 진행 중입니다.");
      const choice = pickRecFormat();
      if (!choice) throw new Error("이 브라우저는 녹음을 지원하지 않습니다. 크롬에서 열어 주세요.");
      // 마이크 허락부터 — 거절하면 서버에 빈 녹음을 만들지 않는다
      const stream = await openMicrophone();
      let recId: string;
      try {
        recId = (await createRecording({ meetingId: m.id, source: "live" })).id;
      } catch (e) {
        for (const t of stream.getTracks()) t.stop();
        throw e;
      }
      holdLock(recId);
      const base = { recId, meetingId: m.id, source: "live" as const, format: choice.format };
      recorder.current = new SegmentedRecorder(stream, choice, {
        onChunk: (n, i, blob) => putChunk(recId, n, i, blob),
        onSegmentStart: (n, startSec) =>
          void putSeg({ ...base, n, startSec, durationSec: 0, closed: false, createdAt: Date.now() }),
        onSegmentEnd: async (n, startSec, durationSec) => {
          await putSeg({ ...base, n, startSec, durationSec, closed: true, createdAt: Date.now() });
          enqueue({ ...base, n, startSec, durationSec });
        },
        onSegmentDiscard: (n) => void deleteSeg(recId, n),
        onFatal: (message) => {
          toast.error(message);
          void stop();
        },
      }, devSegmentSec());
      setJob({ kind: "live", recId, meetingId: m.id, label: m.label, state: "recording", format: choice.format });
      void acquireWakeLock();
      bump();
    },
    [setJob, holdLock, enqueue, toast, stop, acquireWakeLock, bump],
  );

  const pause = useCallback(() => {
    const j = jobRef.current;
    if (j?.kind !== "live" || j.state !== "recording") return;
    recorder.current?.pause();
    setJob({ ...j, state: "paused" });
  }, [setJob]);

  const resume = useCallback(() => {
    const j = jobRef.current;
    if (j?.kind !== "live" || j.state !== "paused") return;
    recorder.current?.resume();
    setJob({ ...j, state: "recording" });
  }, [setJob]);

  // ---- 파일 올리기 --------------------------------------------

  const openFile = useCallback((file: File) => openAudioFile(file), []);

  const startUpload = useCallback(
    async (m: { id: string; label: string }, file: File, opened: OpenedAudioFile) => {
      if (jobRef.current) {
        opened.dispose();
        throw new Error("이미 녹음이나 파일 올리기가 진행 중입니다.");
      }
      let recId: string | null = null;
      cancelUploadRef.current = false;
      try {
        recId = (await createRecording({ meetingId: m.id, source: "upload", name: file.name, durationSec: opened.durationSec }))
          .id;
        const rid = recId;
        holdLock(rid);
        setJob({
          kind: "upload",
          recId: rid,
          meetingId: m.id,
          label: m.label,
          fileName: file.name,
          durationSec: opened.durationSec,
          progress: 0,
        });
        bump();
        const made = await opened.convert({
          onSegment: async (seg) => {
            const meta = { recId: rid, meetingId: m.id, source: "upload" as const, ...seg };
            await putSeg({ ...meta, closed: true, createdAt: Date.now() });
            await putChunk(rid, seg.n, 0, seg.blob);
            enqueue(meta);
          },
          onProgress: (p) => setJob((j) => (j?.kind === "upload" ? { ...j, progress: p } : j)),
          isCancelled: () => cancelUploadRef.current,
        });
        if (cancelUploadRef.current) {
          await dropQueued(rid);
          await deleteRecording(rid).catch(() => undefined);
          toast.info("파일 올리기를 취소했습니다.");
        } else {
          await endRecording(rid, made, opened.durationSec);
        }
      } catch (e) {
        if (recId) {
          await dropQueued(recId);
          await deleteRecording(recId).catch(() => undefined);
        }
        throw e;
      } finally {
        opened.dispose();
        const rid = recId;
        setJob(null);
        if (rid) maybeRelease(rid);
        bump();
      }
    },
    [setJob, holdLock, enqueue, dropQueued, maybeRelease, toast, bump],
  );

  const cancelUpload = useCallback(() => {
    cancelUploadRef.current = true;
  }, []);

  const value = useMemo<RecordingCtx>(
    () => ({
      job,
      pipeline,
      version,
      durable,
      elapsedSec: () => recorder.current?.elapsedSec() ?? 0,
      level: () => recorder.current?.level() ?? 0,
      startLive,
      pause,
      resume,
      stop,
      openFile,
      startUpload,
      cancelUpload,
      retryNow,
      isBusy: (meetingId) =>
        jobRef.current?.meetingId === meetingId || queue.current.some((q) => q.meetingId === meetingId),
      isLocal: (recId) => jobRef.current?.recId === recId || queue.current.some((q) => q.recId === recId),
      bump,
    }),
    // version·pipeline 이 바뀌면 isBusy·isLocal 도 새로 읽혀야 한다
    [job, pipeline, version, durable, startLive, pause, resume, stop, openFile, startUpload, cancelUpload, retryNow, bump],
  );

  return (
    <Ctx.Provider value={value}>
      <ClockCtx.Provider value={tick}>{children}</ClockCtx.Provider>
    </Ctx.Provider>
  );
}

// ---- 상단바 표시 ---------------------------------------------

/**
 * 어느 화면에서든 보이는 녹음 알약 — 누르면 그 회의로 간다.
 * 녹음 중 · 변환 중 · 받아쓰는 중 · 올리기 막힘 을 한 줄로.
 */
export function RecordingIndicator() {
  const { job, pipeline, elapsedSec } = useRecording();
  useRecordingClock();
  const meetingId = job?.meetingId ?? pipeline.current?.meetingId;
  if (!meetingId) return null;

  let dot: "live" | "paused" | "busy" | "blocked" = "busy";
  let text: string;
  if (job?.kind === "live") {
    dot = job.state === "paused" ? "paused" : "live";
    text = `${job.state === "paused" ? "일시정지" : job.state === "stopping" ? "마치는 중" : "녹음 중"} ${formatClock(elapsedSec())}`;
  } else if (job?.kind === "upload") {
    text = `변환 ${Math.round(job.progress * 100)}%`;
  } else if (pipeline.blocked) {
    dot = "blocked";
    text = "올리기 대기";
  } else {
    text = pipeline.current?.step === "upload" ? "녹음 올리는 중" : "받아쓰는 중";
  }
  if (pipeline.waiting > 0 && job?.kind !== "live") text += ` · 남은 조각 ${pipeline.waiting}`;

  return (
    <Link
      href={`/neander/meetings?id=${encodeURIComponent(meetingId)}`}
      onClick={(e) => {
        // 이미 회의 화면이면 주소를 바꾸지 않고 그 회의를 연다 (회의 화면은 주소를 마운트 때만 읽는다)
        if (window.location.pathname !== "/neander/meetings") return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("neander:open-meeting", { detail: meetingId }));
      }}
      className={cn(
        "nd-num inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-nd-caption font-medium transition-colors duration-nd-fast",
        dot === "live"
          ? "border-nd-danger/30 bg-nd-danger-soft text-nd-danger-text hover:bg-nd-danger/15"
          : dot === "blocked"
            ? "border-nd-warning/30 bg-nd-warning-soft text-nd-warning-text"
            : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-fg/[.04]",
      )}
      title={`${job?.label ?? "회의"} — 누르면 회의로 갑니다`}
    >
      {dot === "live" ? (
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-nd-danger opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-nd-danger" />
        </span>
      ) : dot === "paused" ? (
        <span className="h-2 w-2 rounded-full bg-nd-fg-3" aria-hidden />
      ) : (
        <Icon icon={Loader2} size={13} className={cn(dot === "busy" && "animate-spin")} />
      )}
      {text}
    </Link>
  );
}
