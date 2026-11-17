import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanContactName, displayNumber, kstCallStamp, missedCallMessage, missedCallTitle, normalizeNumber } from "./missed-call";

test("normalizeNumber — 숫자만 · +82 는 0", () => {
  assert.equal(normalizeNumber("010-1234-5678"), "01012345678");
  assert.equal(normalizeNumber("+82 10-1234-5678"), "01012345678");
  assert.equal(normalizeNumber("+82 010 1234 5678"), "01012345678");
  assert.equal(normalizeNumber("02) 123-4567"), "021234567");
  assert.equal(normalizeNumber(" 82 10-1234-5678"), "01012345678"); // 폼에서 + 가 빈칸이 된 것
  assert.equal(normalizeNumber("15881234"), "15881234");
  assert.equal(normalizeNumber(""), "");
  assert.equal(normalizeNumber("Private"), "");
  assert.equal(normalizeNumber(undefined), "");
});

test("displayNumber — 휴대폰 · 서울 · 대표번호", () => {
  assert.equal(displayNumber("01012345678"), "010-1234-5678");
  assert.equal(displayNumber("0311234567"), "031-123-4567");
  assert.equal(displayNumber("0212345678"), "02-1234-5678");
  assert.equal(displayNumber("021234567"), "02-123-4567");
  assert.equal(displayNumber("15881234"), "1588-1234");
  assert.equal(displayNumber(""), "발신번호 없음");
});

test("cleanContactName — 저장 안 된 번호 · 매직 텍스트 그대로는 빈칸", () => {
  assert.equal(cleanContactName("미리내컴 김과장", "01012345678"), "미리내컴 김과장");
  assert.equal(cleanContactName("010-1234-5678", "01012345678"), "");
  assert.equal(cleanContactName("Unknown", "01012345678"), "");
  assert.equal(cleanContactName("알 수 없음", ""), "");
  assert.equal(cleanContactName("[call_name]", "01012345678"), "");
  assert.equal(cleanContactName("", "01012345678"), "");
});

test("알림 글 — 줄 이름은 누가 먼저 · 댓글은 종류 먼저", () => {
  const at = Date.UTC(2026, 10, 17, 5, 32); // 14:32 KST
  assert.equal(kstCallStamp(at), "11/17(화) 14:32");
  assert.equal(missedCallTitle({ number: "01012345678", name: "김과장" }), "📞 김과장 · 010-1234-5678");
  assert.equal(missedCallTitle({ number: "01012345678", name: "" }), "📞 010-1234-5678");
  assert.equal(missedCallMessage({ number: "01012345678", name: "김과장", at, recent: 1 }), "부재중 전화 · 11/17(화) 14:32");
  assert.equal(
    missedCallMessage({ number: "01012345678", name: "", at, recent: 3 }),
    "부재중 전화 · 11/17(화) 14:32 · 이 번호 30일 안 3번째 · 폰에 저장 안 된 번호",
  );
});
