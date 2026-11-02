// 대본 작성기 순수 함수 검증 — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import { BEAT_LABEL } from "./model";
import { cleanFacts, cleanStoryInput, keepLast, sanitizeWriterScript, writerScriptText, writerTimeline, writerTotalSec } from "./script-writer";

const raw = {
  title: "  물막이 하나로 끝  ",
  hook: "싱크대 물튀김, 3초면 끝",
  targetSec: 30,
  description: "설명",
  hashtags: ["#물막이", "다이소", "다이소", ""],
  cta: { type: "comment_keyword", keyword: "물막이", wording: "댓글에 물막이", atSec: 25 },
  scenes: [
    { label: "물 튀는 싱크대", kind: "ai", durationSec: 3, visual: "물이 튄다", aiPrompt: "water splashing", photo: 2 },
    { label: "제품 컷", kind: "image", durationSec: 2.5, visual: "제품", aiPrompt: "x", photo: 1 },
    { label: "없는 사진", kind: "image", durationSec: 99, visual: "", aiPrompt: "", photo: 7 },
  ],
  lines: [
    { beat: "hook", text: "물 튀는 거 지겹죠?", caption: "", scene: 0 },
    { beat: "reveal", text: "이거 하나면 돼요", caption: "다이소 3천원", scene: 1 },
    { beat: "nope", text: "없는 장면", caption: "", scene: 9 },
    { beat: "cta", text: "", caption: "", scene: 0 },
  ],
};

test("대본 다듬기 — 사진 번호 · 장면 번호 · 길이 · 해시태그", () => {
  const s = sanitizeWriterScript(raw, 2);
  assert.equal(s.title, "물막이 하나로 끝");
  assert.deepEqual(s.hashtags, ["물막이", "다이소"]);
  assert.equal(s.scenes[0].photo, null); // AI 장면은 사진 번호를 쓰지 않는다
  assert.equal(s.scenes[0].aiPrompt, "water splashing");
  assert.equal(s.scenes[1].photo, 1);
  assert.equal(s.scenes[1].aiPrompt, ""); // 사진 장면엔 프롬프트를 남기지 않는다
  assert.equal(s.scenes[2].photo, 0); // 없는 사진 번호 → 첫 사진
  assert.equal(s.scenes[2].durationSec, 30); // 장면 길이 상한
  assert.equal(s.lines.length, 3); // 빈 줄은 뺀다
  assert.equal(s.lines[2].beat, "demo"); // 모르는 구간 → 사용 장면
  assert.equal(s.lines[2].scene, 2); // 없는 장면 → 마지막 장면
  assert.equal(s.cta.atSec, 25);

  const noPhoto = sanitizeWriterScript(raw, 0);
  assert.equal(noPhoto.scenes[1].kind, "ai"); // 사진이 없으면 사진 장면을 AI 장면으로
  assert.equal(noPhoto.scenes[1].photo, null);

  const empty = sanitizeWriterScript({}, 0);
  assert.equal(empty.scenes.length, 1);
  assert.equal(empty.title, "제목 없음");
  assert.equal(empty.cta.type, "other");
});

test("장면 시각 · 길이 합 · 복사 글", () => {
  const s = sanitizeWriterScript(raw, 2);
  assert.deepEqual(writerTimeline(s).map((t) => [t.from, t.to]), [[0, 3], [3, 5.5], [5.5, 35.5]]);
  assert.equal(writerTotalSec(s), 35.5);
  const txt = writerScriptText(s, BEAT_LABEL);
  assert.match(txt, /^제목: 물막이 하나로 끝/);
  assert.match(txt, /\[장면 2 · 3~5\.5초 · 제품 사진 2\] 제품 컷/);
  assert.match(txt, /\(후킹\) 물 튀는 거 지겹죠\?/);
  assert.match(txt, /자막: 다이소 3천원/);
  assert.match(txt, /AI 프롬프트: water splashing/);
  assert.match(txt, /#물막이 #다이소/);
  assert.doesNotMatch(txt, /\n\n\n/);
});

test("확인된 사실 · 끝에서 n 개", () => {
  assert.deepEqual(cleanFacts(["  흰색  ", "흰색", "", 3, "용량 350ml"]), ["흰색", "용량 350ml"]);
  assert.equal(cleanFacts(Array.from({ length: 30 }, (_, i) => `사실 ${i}`)).length, 20);
  assert.deepEqual(keepLast([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(keepLast([1], 2), [1]);
});

test("스토리 광고 — 이야기 · 캐릭터 시트 · 막 구조 · 컷 카메라 · 엔드카드", () => {
  const storyRaw = {
    ...raw,
    scenes: raw.scenes.map((x, i) => ({ ...x, camera: i === 0 ? "바닥 높이 · 고정" : "", sound: "미끄러지는 효과음", continuity: i === 1 ? "제품 사진 2 를 참고 이미지로" : "" })),
    story: {
      logline: "털 많은 솜이가 달리기에서 못 멈추다가 발바닥 털을 정리하고 역전한다",
      catchphrase: "브레이크는 발바닥에 있다",
      look: "3D animation, Pixar-like",
      characters: [{ name: "솜이", role: "주인공", look: "흰 몰티즈", lookPrompt: "small white Maltese with long fluffy fur" }, { name: "", role: "", look: "", lookPrompt: "" }],
      acts: [{ name: "설정", fromSec: 0, toSec: 5, summary: "출발선" }, { name: "역전", fromSec: 30, toSec: 20, summary: "끝이 시작보다 앞" }],
      endCard: { visual: "제품 사진 3색", text: "18,900원", cta: "사주세요" },
    },
  };
  const st = sanitizeWriterScript(storyRaw, 2, "story");
  assert.equal(st.story?.catchphrase, "브레이크는 발바닥에 있다");
  assert.equal(st.story?.characters[1].name, "이름 없음");
  assert.equal(st.story?.acts[1].toSec, 30); // 끝이 시작보다 앞이면 시작으로
  assert.equal(st.scenes[0].camera, "바닥 높이 · 고정");
  assert.equal(st.scenes[1].continuity, "제품 사진 2 를 참고 이미지로");
  // 소개 방식이면 스토리 칸을 남기지 않는다
  const intro = sanitizeWriterScript(storyRaw, 2);
  assert.equal(intro.story, undefined);
  assert.equal(intro.scenes[0].camera, undefined);
  const txt = writerScriptText(st, BEAT_LABEL);
  assert.match(txt, /로그라인: 털 많은 솜이가/);
  assert.match(txt, /캐치프레이즈: 브레이크는 발바닥에 있다/);
  assert.match(txt, /영문 고정 묘사: small white Maltese/);
  assert.match(txt, /설정 0~5초: 출발선/);
  assert.match(txt, /카메라: 바닥 높이 · 고정/);
  assert.match(txt, /엔드카드: 제품 사진 3색 · 문구 「18,900원」 · 사주세요/);
  const si = cleanStoryInput({ problem: "  미끄러짐  ", idea: "x".repeat(3000), tone: "코믹", extra: 1 });
  assert.equal(si.problem, "미끄러짐");
  assert.equal(si.idea.length, 1500);
  assert.equal(si.look, "");
});
