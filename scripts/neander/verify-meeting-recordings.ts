// ============================================================
//  회의 녹음 저장소 · 받아쓰기 확인 — 실제 Firestore (+ 선택: 실제 AI)
// ------------------------------------------------------------
//  npm run meetings:verify-recordings                     저장소만 (AI 비용 없음)
//  npm run meetings:verify-recordings -- a.ogg b.ogg      + 받아쓰기·초안 (몇십 원)
//
//  (server-only 를 통과하려면 react-server 조건이 필요하다 — package.json)
//
//  1999-12-31 날짜의 검증용 회의를 잠깐 만들어(팀 목록 맨 아래에 몇 초
//  보인다) 녹음을 붙이고, 조각이 그대로 돌아오는지 · 수가 맞는지 · 음성만
//  지우면 받아쓴 글은 남는지 · 회의와 함께 지워지는지 본다. 끝나면 모두 지운다.
//
//  음성 파일을 주면 조각마다 실제로 받아쓰고(앞 조각 끝을 물려받는지)
//  회의록 초안까지 만든다. 파일은 10분 이하 ogg·webm·m4a 조각이어야 한다.
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { adminDb } from "../../lib/neander/server/admin";
import { NEANDER_COL } from "../../lib/neander/collections";
import {
  REC_PART_BYTES,
  formatClock,
  isFullyTranscribed,
  isRecAudioFormat,
  minutesToContent,
  normalizeSpeaker,
  parseTranscriptLines,
  type RecAudioFormat,
} from "../../lib/neander/meetings/recording";
import {
  completeSegment,
  confirmRecording,
  createRecording,
  createSegment,
  deleteRecordingAudio,
  deleteRecordingsOfMeeting,
  endRecording,
  finalizeRecording,
  getMeetingRecordings,
  isSameAction,
  listRecordings,
  putSegmentPart,
  readSegmentAudio,
  summarizeRecording,
  transcribeSegment,
} from "../../lib/neander/meetings/server/recordings";

const ME = "verify@neander.local";
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
};
const rejects = async (p: Promise<unknown>) => p.then(() => false, () => true);

function pureChecks() {
  const lines = parseTranscriptLines(["00:03|화자B|네, 그렇게 하죠.", "xx|a|시각이 깨진 줄", "01:10|C|세|로|줄", "99:99|A|범위 밖 시각"], 600, 600);
  check(lines.length === 4, "받아쓴 줄 4개를 모두 살린다");
  check(lines[0].t === 603 && lines[0].s === "B", "시각에 조각 시작을 더하고 「화자B」 를 B 로");
  check(lines[1].t === 603 && lines[1].s === "A", "시각이 깨진 줄은 앞 줄 시각을 물려받는다");
  check(lines[2].x === "세|로|줄", "내용 안의 | 는 그대로");
  check(lines[3].t === 670, "조각 길이를 넘는 시각은 앞 줄에 붙인다");
  check(normalizeSpeaker(" speaker c ") === "C", "speaker c → C");
  check(formatClock(4625) === "1:17:05" && formatClock(65) === "1:05", "시각 표시");
  const text = minutesToContent({ title: "t", content: "■ 주제\n- 내용", decisions: ["정함"], actionItems: [], openQuestions: ["남음"] });
  check(text.includes("■ 결정 사항\n- 정함") && text.includes("■ 남은 질문\n- 남음"), "초안 → 회의록 본문");

  // 초안 합치기 — 같은 일을 말만 바꿔 적은 액션은 한 줄로 (2026-09-22 실제 초안 문구)
  check(
    isSameAction("굿즈 모먼트 IP 캐릭터 향수 샘플 제작 및 ID 매장 비치", "굿즈모먼트 IP 향수 샘플 제작 및 매장 비치"),
    "말만 바꾼 같은 액션은 같은 것으로 본다",
  );
  check(
    isSameAction("엔플라잉 룸 스프레이 재제작 부자재 수량 파악 및 발주 준비", "엔플라잉 룸 스프레이 재제작 발주 준비"),
    "줄여 쓴 같은 액션도 같은 것으로 본다",
  );
  check(
    !isSameAction("클룩 플랫폼 상품 연동 세팅 및 샤오홍슈 마케팅 전략 수립", "AI 학원 1호점 인수 매물 분석 및 외부 파트너십 투자 방안 검토"),
    "다른 액션은 합치지 않는다",
  );
  check(!isSameAction("트로트 팬덤 대상 향수 콜라보 기획", "악센트 아이디 매장 업무 자동화 설계"), "주제가 다르면 합치지 않는다");
}

async function main() {
  pureChecks();

  const audioFiles = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const db = adminDb();
  const recDoc = (id: string) => db.collection(NEANDER_COL.meetingRecordings).doc(id);
  const partsLeft = async (id: string, n: number) =>
    (await recDoc(id).collection("segments").doc(String(n)).collection("parts").count().get()).data().count;

  const now = Date.now();
  const meeting = await db.collection(NEANDER_COL.meetings).add({
    date: "1999-12-31",
    title: "[검증용 — 곧 지워짐]",
    content: "",
    actionItems: [],
    createdAt: now,
    updatedAt: now,
  });

  /** 조각 하나를 끝까지 올린다 */
  const put = async (id: string, n: number, bytes: Buffer, format: RecAudioFormat, startSec: number, durationSec: number) => {
    const { parts, partBytes, already } = await createSegment(db, ME, { id, n, startSec, durationSec, format, size: bytes.length });
    if (already) return;
    for (let k = 0; k < parts; k++) await putSegmentPart(db, ME, id, n, k, bytes.subarray(k * partBytes, (k + 1) * partBytes));
    await completeSegment(db, ME, id, n);
  };

  try {
    check(await rejects(createRecording(db, ME, { meetingId: "없는회의아이디입니다", source: "live" })), "없는 회의에는 녹음을 못 붙인다");

    // ---- 저장소 --------------------------------------------------
    const r = await createRecording(db, ME, { meetingId: meeting.id, source: "live" });
    check(r.name === "ERP 녹음" && !r.ended && r.segCount === 0, "새 ERP 녹음");
    const bytes = randomBytes(REC_PART_BYTES + 4321);
    check(await rejects(createSegment(db, "other@neander.local", { id: r.id, n: 0, startSec: 0, durationSec: 600, format: "webm", size: 10 })), "녹음한 사람만 조각을 올린다");
    check(await rejects(createSegment(db, ME, { id: r.id, n: 0, startSec: 0, durationSec: 600, format: "mp3", size: 10 })), "모르는 형식은 거절");
    const seg = await createSegment(db, ME, { id: r.id, n: 0, startSec: 0, durationSec: 600, format: "webm", size: bytes.length });
    check(seg.parts === 2 && !seg.already, `조각 0 — 음성 조각 2개 (받은 값 ${seg.parts})`);
    await putSegmentPart(db, ME, r.id, 0, 0, bytes.subarray(0, seg.partBytes));
    check(await rejects(completeSegment(db, ME, r.id, 0)), "음성 조각이 덜 왔으면 마치지 못한다");
    await putSegmentPart(db, ME, r.id, 0, 1, bytes.subarray(seg.partBytes));
    await completeSegment(db, ME, r.id, 0);
    await completeSegment(db, ME, r.id, 0); // 두 번 불러도 수가 두 번 늘지 않는다
    const again = await createSegment(db, ME, { id: r.id, n: 0, startSec: 0, durationSec: 600, format: "webm", size: bytes.length });
    check(again.already, "다 올라간 조각을 다시 올리면 already");
    await put(r.id, 1, randomBytes(1000), "webm", 600, 42.5);
    let [d] = await getMeetingRecordings(db, meeting.id);
    check(d.segCount === 2 && d.uploaded === 2 && d.transcribed === 0, `수: 조각 2 · 올림 2 · 받아씀 0 (받은 값 ${d.segCount}·${d.uploaded}·${d.transcribed})`);
    check(d.durationSec === 642.5, `녹음 길이 = 마지막 조각 끝 (받은 값 ${d.durationSec})`);
    const back = Buffer.concat([
      (await readSegmentAudio(db, r.id, 0, 0, 1)).bytes,
      (await readSegmentAudio(db, r.id, 0, 1, 5)).bytes,
    ]);
    check(back.equals(bytes), "나눠 받은 음성이 원본과 같다");
    check(!isFullyTranscribed(d), "끝나지 않은 녹음은 초안을 못 만든다");
    await endRecording(db, ME, { id: r.id, segCount: 2, durationSec: 642.5 });
    check(await rejects(summarizeRecording(db, r.id)), "받아쓰지 않은 녹음은 초안을 못 만든다");

    // 덜 올라간 조각 3 을 두고 마무리하면 조각 자리를 지우고 수를 맞춘다
    await createSegment(db, ME, { id: r.id, n: 2, startSec: 1200, durationSec: 600, format: "webm", size: 100 });
    await finalizeRecording(db, ME, r.id);
    [d] = await getMeetingRecordings(db, meeting.id);
    check(d.ended && d.segCount === 2 && d.segments.length === 2, "마무리 — 덜 올라간 조각은 빠지고 조각 수 2");

    const c = await confirmRecording(db, r.id);
    const days = ((c.audioDeleteAt ?? 0) - Date.now()) / 86_400_000;
    check(days > 29.9 && days < 30.1, `확정하면 30일 뒤 음성 삭제 예정 (${days.toFixed(2)}일)`);
    await deleteRecordingAudio(db, r.id);
    [d] = await getMeetingRecordings(db, meeting.id);
    check((await partsLeft(r.id, 0)) === 0 && d.segments.length === 2 && !!d.audioDeletedAt, "음성만 지우면 조각 자리(받아쓴 줄)는 남는다");
    check(await rejects(readSegmentAudio(db, r.id, 0, 0, 1)), "지운 음성은 못 읽는다");

    // 30일이 지난 녹음은 목록을 읽을 때 음성을 치운다
    const old = await createRecording(db, ME, { meetingId: meeting.id, source: "upload", name: "검증.m4a", durationSec: 60 });
    await put(old.id, 0, randomBytes(2000), "ogg", 0, 60);
    await recDoc(old.id).update({ audioDeleteAt: Date.now() - 1000, ended: true });
    await listRecordings(db);
    check((await partsLeft(old.id, 0)) === 0, "기한이 지난 음성은 목록을 읽을 때 지운다");

    // ---- 실제 받아쓰기 · 초안 (파일을 준 경우) ---------------------
    if (audioFiles.length) {
      const ai = await createRecording(db, ME, { meetingId: meeting.id, source: "upload", name: "검증 받아쓰기" });
      let start = 0;
      for (const [n, file] of audioFiles.entries()) {
        const ext = path.extname(file).slice(1).toLowerCase();
        const format = ext === "mp4" ? "m4a" : ext;
        if (!isRecAudioFormat(format)) throw new Error(`${file}: ogg·webm·m4a 만 됩니다`);
        const buf = fs.readFileSync(file);
        const dur = Number(process.env.SEG_SEC ?? 60);
        await put(ai.id, n, buf, format, start, dur);
        const t0 = Date.now();
        const s = await transcribeSegment(db, ai.id, n);
        const who = [...new Set(s.lines?.map((l) => l.s))].join("·");
        check((s.lines?.length ?? 0) > 0, `${path.basename(file)} 받아쓰기 ${s.lines?.length}줄 · 화자 ${who} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
        check((s.lines ?? []).every((l) => l.t >= start && l.t <= start + dur + 5), "줄 시각이 조각 안에 있다 (녹음 기준)");
        for (const l of (s.lines ?? []).slice(0, 3)) console.log(`    [${formatClock(l.t)}] ${l.s}: ${l.x.slice(0, 70)}`);
        start += dur;
      }
      await endRecording(db, ME, { id: ai.id, segCount: audioFiles.length, durationSec: start });
      const t0 = Date.now();
      const sum = await summarizeRecording(db, ai.id);
      check(!!sum.summary.content || sum.summary.actionItems.length > 0, `회의록 초안 — 제목 「${sum.summary.title}」 · 액션 ${sum.summary.actionItems.length}건 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
      const [done] = (await getMeetingRecordings(db, meeting.id)).filter((x) => x.id === ai.id);
      check(done.transcribed === audioFiles.length && !!done.summary, "받아씀 수와 초안이 녹음에 남는다");
      console.log(`    AI 비용 $${done.costUsd.toFixed(4)} (받아쓰기 ${audioFiles.length}조각 + 초안)`);
    }

    // ---- 회의와 함께 지우기 ----------------------------------------
    await deleteRecordingsOfMeeting(db, meeting.id);
    check((await getMeetingRecordings(db, meeting.id)).length === 0, "회의를 지우기 전에 녹음을 모두 지운다");

    // 화면 밖에서 회의만 지워진 녹음은 목록을 읽을 때 치운다
    const orphan = await createRecording(db, ME, { meetingId: meeting.id, source: "live" });
    await meeting.delete();
    await listRecordings(db);
    check(!(await recDoc(orphan.id).get()).exists, "회의가 사라진 녹음은 목록을 읽을 때 지운다");
  } finally {
    await deleteRecordingsOfMeeting(db, meeting.id).catch(() => undefined);
    await meeting.delete().catch(() => undefined);
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n모두 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
