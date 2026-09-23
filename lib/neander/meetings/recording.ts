// ============================================================
//  회의 녹음 — 브라우저와 서버가 같이 쓰는 모양 · 한도 · 계산
// ------------------------------------------------------------
//  녹음 하나 = 10분 조각 여러 개. 조각마다 음성(768KB 씩 Firestore 에)과
//  받아쓴 줄이 붙는다. 조각이 다 받아써지면 녹음 전체로 회의록 초안을 만들고,
//  사람이 고쳐 저장하면(확정) 30일 뒤 음성만 지운다 — 받아쓴 글은 남는다.
//
//  두 입구가 같은 길을 탄다:
//    ERP 녹음     MediaRecorder 가 10분마다 끊어 낸 webm·ogg·m4a (recorder.ts)
//    파일 올리기   휴대폰 녹음을 브라우저에서 16kbps opus 10분 조각으로 바꾼 것 (convert.ts)
//  원본 파일은 올리지 않는다 — 3시간이면 90~170MB 라 Firestore 무료 1GB 를
//  ERP 전체와 나눠 쓰는 우리에게 너무 크다 (Storage 버킷은 없다).
//
//  실측 (2026-09-19, 77분 회의 · gemini-3.8-flash): 받아쓰기 $0.228 + 요약
//  $0.042 = 시간당 약 $0.21. 음성 1분이 1,500토큰이고, 비용의 절반은 받아쓴
//  글(출력)이다. 16kbps 와 24kbps 받아쓰기 차이는 없었다.
// ============================================================

import type { TaskCategory } from "@/lib/neander/types";

/** 조각 길이 — Vercel 요청 4.5MB · Gemini 인라인 20MB 안에 여유 있게, 끊겨도 잃는 게 적게 */
export const REC_SEGMENT_SEC = 600;
/** 녹음 하나의 최대 길이 (5시간 = 조각 30개, 비용 약 1,500원) */
export const REC_MAX_SEC = 5 * 60 * 60;
/** Firestore 조각 — 문서 1MB 한도 아래, base64 로 부풀어도 요청 4.5MB 아래 */
export const REC_PART_BYTES = 768 * 1024;
/** 10분 조각 하나의 한도 — 사파리 AAC 128kbps 도 10MB 가 안 된다 */
export const REC_SEGMENT_MAX_BYTES = 12 * 1024 * 1024;
/** 회의록을 확정하고 음성을 지우기까지 */
export const REC_AUDIO_KEEP_DAYS = 30;

/** 실측 단가 (시간당) — 올리기 전 예상 비용 표시용 */
export const REC_USD_PER_HOUR = 0.21;
/** 원화 어림 — 화면에 「약 ○○원」 으로만 쓴다. 장부 환율이 아니다 */
export const REC_KRW_PER_USD = 1400;

export type RecordingSource = "live" | "upload";
export type RecAudioFormat = "webm" | "ogg" | "m4a";

export const REC_AUDIO_MIME: Record<RecAudioFormat, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

export const isRecAudioFormat = (v: unknown): v is RecAudioFormat => v === "webm" || v === "ogg" || v === "m4a";

/** 받아쓴 한 줄 — t 는 녹음 처음부터의 초, s 는 화자 글자(A·B·C…) */
export interface TranscriptLine {
  t: number;
  s: string;
  x: string;
}

export interface RecordingSegment {
  n: number;
  /** 녹음 안에서 이 조각이 시작하는 초 */
  startSec: number;
  durationSec: number;
  format: RecAudioFormat;
  size: number;
  /** 음성 조각이 다 올라왔는가 */
  uploaded: boolean;
  lines?: TranscriptLine[];
  transcribedAt?: number;
  /** 마지막 받아쓰기 실패 이유 — 성공하면 지운다 */
  error?: string;
}

/** 녹음 — 목록에는 이것만 온다 (받아쓴 줄은 회의를 열 때 따로) */
export interface MeetingRecording {
  id: string;
  meetingId: string;
  source: RecordingSource;
  /** 올린 파일 이름, ERP 녹음이면 「ERP 녹음」 */
  name: string;
  createdBy: string;
  createdAt: number;
  /** 마지막으로 조각이 오간 때 — 끊긴 녹음을 알아본다 */
  updatedAt: number;
  /** 더 올라올 조각이 없다 (녹음을 끝냈거나 파일을 다 나눴다) */
  ended: boolean;
  /** 조각 수 — 끝나기 전에는 지금까지 만든 수 */
  segCount: number;
  uploaded: number;
  transcribed: number;
  durationSec: number;
  /** 사람이 붙인 화자 이름 { A: "이동주" } */
  speakers?: Record<string, string>;
  summary?: MeetingMinutesDraft;
  summaryAt?: number;
  /** 받아쓰기 + 요약에 든 AI 비용 */
  costUsd: number;
  /** 초안을 넣은 회의록을 저장한 때 — 이때부터 음성 삭제를 센다 */
  confirmedAt?: number;
  audioDeleteAt?: number;
  audioDeletedAt?: number;
  /** 합치면서 이 녹음 안으로 들여온 녹음들 — 두 번 옮기지 않으려고 적어 둔다 */
  mergedFrom?: string[];
  /** 노션으로 옮긴 음성 — 그 회의 보관 페이지 주소 (받아쓴 글·초안은 ERP 에 그대로) */
  archiveUrl?: string;
  archivedAt?: number;
}

export interface RecordingDetail extends MeetingRecording {
  segments: RecordingSegment[];
}

export interface MinutesActionDraft {
  text: string;
  category: TaskCategory;
  detail: string;
  /** 팀원 이름 — 화면이 팀원 id 로 바꾼다 */
  assignees: string[];
  /** YYYY-MM-DD 또는 "" */
  dueDate: string;
}

export interface MeetingMinutesDraft {
  title: string;
  content: string;
  decisions: string[];
  actionItems: MinutesActionDraft[];
  openQuestions: string[];
}

// ---- 상태 ---------------------------------------------------

/** 모든 조각이 받아써졌는가 — 요약을 만들 수 있는가 */
export const isFullyTranscribed = (r: MeetingRecording) =>
  r.ended && r.segCount > 0 && r.transcribed >= r.segCount;

/** 녹음이 무엇을 기다리는가 — 목록 한 줄 문구 */
export function recordingStatusText(r: MeetingRecording): string {
  if (!r.ended) return "녹음·올리는 중";
  if (r.segCount === 0) return "빈 녹음";
  if (r.uploaded < r.segCount) return `올리는 중 ${r.uploaded}/${r.segCount}`;
  if (r.transcribed < r.segCount) return `받아쓰는 중 ${r.transcribed}/${r.segCount}`;
  return r.summary ? "초안 만듦" : "받아쓰기 끝";
}

// ---- 시간 · 돈 ----------------------------------------------

/** 1:02:03 · 12:05 */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 1시간 17분 · 12분 */
export function formatDurationKo(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return "1분 미만";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`;
}

export const estimateRecordingUsd = (sec: number) => (sec / 3600) * REC_USD_PER_HOUR;

/** 약 380원 — 10원 단위로 반올림. 몇 원짜리는 「10원 미만」 (「약 0원」 은 공짜처럼 읽힌다) */
export function krwApprox(usd: number): string {
  const krw = Math.round((usd * REC_KRW_PER_USD) / 10) * 10;
  return krw < 10 ? "10원 미만" : `약 ${krw.toLocaleString("ko-KR")}원`;
}

// ---- 받아쓰기 줄 --------------------------------------------

/** "mm:ss" · "h:mm:ss" → 초. 못 읽으면 null */
function parseClock(v: string): number | null {
  const m = v.trim().match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 모델이 「화자B」·「b」·「B 」 처럼 보내도 B 로 */
export function normalizeSpeaker(v: string): string {
  const t = v.replace(/화자|speaker/gi, "").trim();
  if (/^[a-z]$/i.test(t)) return t.toUpperCase();
  return t.slice(0, 12) || "?";
}

/**
 * 모델이 돌려준 "mm:ss|화자|내용" 줄들 → 녹음 기준 줄.
 * 시각을 못 읽은 줄은 앞 줄 시각을 물려받는다 (내용은 버리지 않는다).
 */
export function parseTranscriptLines(raw: string[], offsetSec: number, maxSec: number): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let last = 0;
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const [clock = "", who = "", ...rest] = r.split("|");
    const x = rest.join("|").trim();
    const t = parseClock(clock);
    if (!x) continue;
    // 조각 길이를 넘는 시각은 모델이 잘못 센 것 — 앞 줄 시각에 붙인다
    if (t !== null && t <= maxSec + 5) last = t;
    out.push({ t: offsetSec + last, s: normalizeSpeaker(who), x });
  }
  return out;
}

/** 화자 표시 — 이름을 붙였으면 이름, 아니면 「화자 A」 */
export const speakerLabel = (s: string, names?: Record<string, string>) =>
  names?.[s]?.trim() || (/^[A-Z]$/.test(s) ? `화자 ${s}` : s);

// ---- 회의록 초안 → 회의록 본문 ------------------------------

/** 초안의 결정 사항 · 남은 질문을 본문 끝에 붙인 글 */
export function minutesToContent(d: MeetingMinutesDraft): string {
  const parts = [d.content.trim()];
  if (d.decisions.length) parts.push(`■ 결정 사항\n${d.decisions.map((x) => `- ${x}`).join("\n")}`);
  if (d.openQuestions.length) parts.push(`■ 남은 질문\n${d.openQuestions.map((x) => `- ${x}`).join("\n")}`);
  return parts.filter(Boolean).join("\n\n");
}
