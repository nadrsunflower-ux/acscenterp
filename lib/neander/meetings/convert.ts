"use client";

// ============================================================
//  휴대폰 녹음 파일 → 10분 음성 조각 (브라우저 안에서)
// ------------------------------------------------------------
//  원본은 서버로 보내지 않는다. 3시간 휴대폰 녹음은 90~170MB 라 우리
//  저장소(Firestore 조각)에 두기에 너무 크다. 브라우저가 WebCodecs 로
//  16kbps opus 로 다시 담으면 3시간이 약 21MB 가 된다.
//
//  mediabunny 를 쓴 이유 (2026-09-19 실측, M4 맥 크롬, 77분 m4a):
//    mediabunny(WebCodecs) 26초 · ffmpeg.wasm 37초 + 32MB 추가 다운로드.
//  파일을 올릴 때만 불러온다 (import()) — 다른 화면 번들에 안 들어간다.
//
//  opus 인코더가 없는 브라우저는 AAC(m4a)로, 그것도 없으면 크롬을 권한다.
//  영상 파일(줌 녹화 mp4 등)은 소리만 꺼낸다.
// ============================================================

import { REC_AUDIO_MIME, REC_MAX_SEC, REC_SEGMENT_SEC, type RecAudioFormat } from "./recording";

export interface ConvertedSegment {
  n: number;
  startSec: number;
  durationSec: number;
  format: RecAudioFormat;
  blob: Blob;
}

type Mediabunny = typeof import("mediabunny");

interface Target {
  codec: "opus" | "aac";
  format: RecAudioFormat;
  sampleRate?: number;
  bitrate: number;
}

async function pickTarget(MB: Mediabunny): Promise<Target | null> {
  const opus: Target = { codec: "opus", format: "ogg", sampleRate: 16_000, bitrate: 16_000 };
  // Quality 에 숫자만 주면 비트레이트가 아니라 품질 계수다 — 반드시 { bitrate } 로 (2026-09-19 이걸로
  // opus 확인이 실패해 96kbps AAC 로 떨어졌었다)
  if (await MB.canEncodeAudio("opus", { numberOfChannels: 1, sampleRate: 16_000, quality: new MB.Quality({ bitrate: 16_000 }) })) {
    return opus;
  }
  const aac: Target = { codec: "aac", format: "m4a", bitrate: 32_000 };
  if (await MB.canEncodeAudio("aac", { numberOfChannels: 1, quality: new MB.Quality({ bitrate: 32_000 }) })) return aac;
  return null;
}

export interface OpenedAudioFile {
  durationSec: number;
  /** 조각을 차례로 만든다 — onSegment 가 끝나야 다음 조각으로 간다 */
  convert(opts: {
    onSegment: (seg: ConvertedSegment) => Promise<void>;
    onProgress?: (p: number) => void;
    isCancelled?: () => boolean;
  }): Promise<number>;
  dispose(): void;
}

/** 파일을 열어 길이를 읽는다 — 변환 전에 예상 비용을 보여 주려고 */
export async function openAudioFile(file: File): Promise<OpenedAudioFile> {
  const MB = await import("mediabunny");
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("이 파일에서 소리를 찾지 못했습니다.");
    const durationSec = await input.computeDuration();
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("파일의 재생 길이를 읽지 못했습니다.");
    if (durationSec > REC_MAX_SEC) {
      throw new Error(`녹음 하나는 ${REC_MAX_SEC / 3600}시간까지 올릴 수 있습니다. 파일을 나눠 올려 주세요.`);
    }
    const target = await pickTarget(MB);
    if (!target) throw new Error("이 브라우저는 음성 변환을 지원하지 않습니다. 크롬에서 올려 주세요.");

    return {
      durationSec,
      dispose: () => input.dispose(),
      async convert({ onSegment, onProgress, isCancelled }) {
        const count = Math.ceil(durationSec / REC_SEGMENT_SEC);
        let made = 0;
        for (let n = 0; n < count; n++) {
          if (isCancelled?.()) break;
          const start = n * REC_SEGMENT_SEC;
          const end = Math.min(durationSec, start + REC_SEGMENT_SEC);
          // 끝의 1초 미만 자투리는 받아쓸 말이 없다
          if (end - start < 1) break;
          const output = new MB.Output({
            format: target.format === "ogg" ? new MB.OggOutputFormat() : new MB.Mp4OutputFormat(),
            target: new MB.BufferTarget(),
          });
          const conv = await MB.Conversion.init({
            input,
            output,
            tracks: "primary",
            trim: { start, end },
            video: { discard: true },
            audio: {
              codec: target.codec,
              numberOfChannels: 1,
              ...(target.sampleRate ? { sampleRate: target.sampleRate } : {}),
              quality: new MB.Quality({ bitrate: target.bitrate }),
              forceTranscode: true,
            },
            showWarnings: false,
          });
          if (!conv.isValid) {
            throw new Error("이 파일의 소리 형식은 브라우저에서 변환할 수 없습니다. 크롬에서 다시 올리거나 m4a·mp3 로 저장해 주세요.");
          }
          conv.onProgress = (p) => onProgress?.((n + p) / count);
          await conv.execute();
          const buf = output.target.buffer;
          if (!buf) throw new Error(`${n + 1}번째 조각을 만들지 못했습니다.`);
          await onSegment({
            n,
            startSec: start,
            durationSec: end - start,
            format: target.format,
            blob: new Blob([buf], { type: REC_AUDIO_MIME[target.format] }),
          });
          made++;
          onProgress?.((n + 1) / count);
        }
        return made;
      },
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}
