"use client";

// ============================================================
//  ERP 녹음기 — 마이크를 10분 조각으로 끊어 녹음한다
// ------------------------------------------------------------
//  MediaRecorder 하나로 3시간을 녹음하면 끝날 때 한 덩어리만 나온다 —
//  중간에 창이 닫히면 전부 잃고, 한 번에 보내기에도 너무 크다. 그래서
//  10분마다 새 MediaRecorder 를 **먼저 켜고** 옛것을 끈다 (끊기는 틈 대신
//  몇 ms 겹친다). 조각 하나하나가 온전한 파일이라 따로 받아쓸 수 있다.
//
//  조각 안에서는 10초마다 토막(chunk)을 내보낸다. 부르는 쪽이 토막을 바로
//  IndexedDB 에 써 두면 창이 닫혀도 잃는 건 마지막 10초다. 토막을 차례로
//  이어 붙이면 그대로 온전한 webm·ogg·mp4 다.
//
//  시간은 일시정지를 뺀 「녹음된 시간」으로 센다 — 조각 경계도 그 기준이다.
// ============================================================

import { REC_SEGMENT_SEC, type RecAudioFormat } from "./recording";

export interface RecFormatChoice {
  mimeType: string;
  format: RecAudioFormat;
  bitsPerSecond: number;
}

/**
 * 크롬·엣지 webm/opus, 파이어폭스 ogg/opus, 사파리 mp4/aac.
 * opus 는 16kbps 로 충분했다 (24kbps 와 받아쓰기 차이 없음, 2026-09-19 실측).
 * AAC 는 낮은 비트레이트에서 음질이 빨리 무너져 32kbps.
 */
const CANDIDATES: RecFormatChoice[] = [
  { mimeType: "audio/webm;codecs=opus", format: "webm", bitsPerSecond: 16_000 },
  { mimeType: "audio/ogg;codecs=opus", format: "ogg", bitsPerSecond: 16_000 },
  { mimeType: "audio/mp4;codecs=mp4a.40.2", format: "m4a", bitsPerSecond: 32_000 },
  { mimeType: "audio/mp4", format: "m4a", bitsPerSecond: 32_000 },
];

export function pickRecFormat(): RecFormatChoice | null {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

/** 토막 길이 — 창이 닫히면 이만큼까지 잃는다 */
export const CHUNK_SEC = 10;

/** 끝낼 때 이보다 짧은 마지막 조각은 버린다 (앞 조각이 있을 때만) */
const DISCARD_MS = 1500;

/** 마이크를 연다. 실패 이유를 사람이 할 일로 바꿔 던진다 */
export async function openMicrophone(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("이 브라우저에서는 녹음할 수 없습니다. 크롬에서 https 주소로 열어 주세요.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // 회의실에는 스피커 소리가 없다 — 에코 제거는 먼 목소리를 뭉개기만 한다
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error("마이크 사용이 막혀 있습니다. 주소창 왼쪽 아이콘을 눌러 마이크를 허용해 주세요.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new Error("연결된 마이크를 찾지 못했습니다.");
    if (name === "NotReadableError") throw new Error("다른 프로그램이 마이크를 쓰고 있습니다. 화상회의 앱 등을 닫고 다시 시도해 주세요.");
    throw new Error(`마이크를 열지 못했습니다${e instanceof Error ? ` — ${e.message}` : ""}`);
  }
}

export interface SegmentedRecorderEvents {
  /** 10초 토막 — 돌려준 약속을 조각이 닫히기 전에 기다린다 (IndexedDB 쓰기) */
  onChunk: (n: number, i: number, blob: Blob) => Promise<void> | void;
  onSegmentStart: (n: number, startSec: number) => void;
  /** 조각이 닫혔다 — 그 조각의 토막은 모두 onChunk 로 나간 뒤다. 돌려준 약속을 stop() 이 기다린다 */
  onSegmentEnd: (n: number, startSec: number, durationSec: number) => Promise<void> | void;
  /** 끝낼 때 막 시작한(1초 남짓) 마지막 조각을 버렸다 — 부르는 쪽이 써 둔 토막을 지운다 */
  onSegmentDiscard: (n: number) => void;
  /** 마이크가 빠지는 등 더 녹음할 수 없다 — 지금까지는 저장된다 */
  onFatal: (message: string) => void;
}

export type RecorderState = "recording" | "paused" | "stopped";

export class SegmentedRecorder {
  state: RecorderState = "recording";
  private mr: MediaRecorder | null = null;
  private n = -1;
  private segStartMs = 0;
  /** 일시정지 전까지 쌓인 녹음 시간 */
  private activeMs = 0;
  /** 마지막으로 녹음을 (다시) 시작한 때 — 일시정지 중에는 0 */
  private resumedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array | null = null;
  private chunkWrites = new Map<number, Promise<void>[]>();

  constructor(
    private readonly stream: MediaStream,
    private readonly choice: RecFormatChoice,
    private readonly events: SegmentedRecorderEvents,
    private readonly segmentSec = REC_SEGMENT_SEC,
  ) {
    this.resumedAt = performance.now();
    this.startSegment(0, 0);
    this.timer = setInterval(() => this.tick(), 1000);
    for (const t of stream.getAudioTracks()) {
      t.addEventListener("ended", () => {
        if (this.state !== "stopped") this.events.onFatal("마이크 연결이 끊겨 녹음을 멈췄습니다. 여기까지는 저장됩니다.");
      });
    }
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.levelBuf = new Float32Array(this.analyser.fftSize);
    } catch {
      // 소리 크기 표시는 없어도 녹음은 된다
    }
  }

  get format(): RecAudioFormat {
    return this.choice.format;
  }

  get segmentIndex(): number {
    return this.n;
  }

  private nowMs(): number {
    return this.activeMs + (this.resumedAt ? performance.now() - this.resumedAt : 0);
  }

  /** 녹음된 시간 (일시정지 뺌) */
  elapsedSec(): number {
    return this.nowMs() / 1000;
  }

  /** 마이크 소리 크기 0~1 — 화면의 막대가 초당 몇 번 읽는다 */
  level(): number {
    if (!this.analyser || !this.levelBuf || this.state !== "recording") return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 5);
  }

  private startSegment(n: number, startMs: number) {
    const mr = new MediaRecorder(this.stream, {
      mimeType: this.choice.mimeType,
      audioBitsPerSecond: this.choice.bitsPerSecond,
    });
    let i = 0;
    const writes: Promise<void>[] = [];
    this.chunkWrites.set(n, writes);
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) writes.push(Promise.resolve(this.events.onChunk(n, i++, e.data)).catch(() => undefined));
    };
    this.mr = mr;
    this.n = n;
    this.segStartMs = startMs;
    mr.start(CHUNK_SEC * 1000);
    this.events.onSegmentStart(n, startMs / 1000);
  }

  private closeSegment(mr: MediaRecorder, n: number, startMs: number, endMs: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = async () => {
        await Promise.all(this.chunkWrites.get(n) ?? []);
        this.chunkWrites.delete(n);
        await Promise.resolve(this.events.onSegmentEnd(n, startMs / 1000, Math.max(0, endMs - startMs) / 1000)).catch(
          () => undefined,
        );
        resolve();
      };
      if (mr.state === "inactive") return void finish();
      mr.onstop = () => void finish();
      mr.stop();
    });
  }

  private tick() {
    if (this.state !== "recording" || !this.mr) return;
    const now = this.nowMs();
    if (now - this.segStartMs < this.segmentSec * 1000) return;
    // 새 녹음기를 먼저 켜고 옛것을 끈다 — 틈 대신 몇 ms 겹친다
    const old = this.mr;
    const oldN = this.n;
    const oldStart = this.segStartMs;
    this.startSegment(oldN + 1, now);
    void this.closeSegment(old, oldN, oldStart, now);
  }

  pause() {
    if (this.state !== "recording" || !this.mr) return;
    this.mr.pause();
    this.activeMs = this.nowMs();
    this.resumedAt = 0;
    this.state = "paused";
  }

  resume() {
    if (this.state !== "paused" || !this.mr) return;
    this.mr.resume();
    this.resumedAt = performance.now();
    this.state = "recording";
  }

  /** 녹음을 끝낸다 — 마지막 조각이 닫힐 때까지 기다린다 */
  async stop(): Promise<{ segments: number; durationSec: number }> {
    if (this.state === "stopped") return { segments: this.n + 1, durationSec: this.activeMs / 1000 };
    if (this.timer) clearInterval(this.timer);
    const end = this.nowMs();
    this.activeMs = end;
    this.resumedAt = 0;
    this.state = "stopped";
    let segments = this.n + 1;
    if (this.mr && this.n > 0 && end - this.segStartMs < DISCARD_MS) {
      // 10분 경계 직후에 끝냈다 — 말이 없는 1초짜리 조각을 받아쓰는 데 돈을 쓰지 않는다
      const mr = this.mr;
      mr.ondataavailable = null;
      if (mr.state !== "inactive") mr.stop();
      this.events.onSegmentDiscard(this.n);
      segments = this.n;
    } else if (this.mr) {
      await this.closeSegment(this.mr, this.n, this.segStartMs, end);
    }
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx?.close().catch(() => undefined);
    return { segments, durationSec: end / 1000 };
  }
}
