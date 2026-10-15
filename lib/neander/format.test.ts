import { test } from "node:test";
import assert from "node:assert/strict";
import { caretAfterRegroup, caretPastComma, cleanNumberText, groupDigits } from "./format";

test("groupDigits — 숫자 모양에만 쉼표", () => {
  assert.equal(groupDigits("1200000"), "1,200,000");
  assert.equal(groupDigits("-906440"), "-906,440");
  assert.equal(groupDigits("1234.50"), "1,234.50");
  assert.equal(groupDigits("1,2,3,4"), "1,234");
  assert.equal(groupDigits("007"), "7");
  assert.equal(groupDigits(""), "");
  assert.equal(groupDigits("-"), "-");
  assert.equal(groupDigits("1."), "1.");
  assert.equal(groupDigits("△1000"), "△1000");
  assert.equal(groupDigits("(1,000)"), "(1,000)");
});

test("cleanNumberText — 허용한 부호·소수점만", () => {
  assert.equal(cleanNumberText("1,200,000원"), "1200000");
  assert.equal(cleanNumberText("-1,000"), "1000");
  assert.equal(cleanNumberText("-1,000", { negative: true }), "-1000");
  assert.equal(cleanNumberText("1.2.3", { decimal: true }), "1.23");
  assert.equal(cleanNumberText("1.5"), "15");
  assert.equal(cleanNumberText("-", { negative: true }), "-");
});

test("caretAfterRegroup — 쉼표가 늘어도 커서는 친 숫자 뒤에", () => {
  // 「120000|」 에 0 을 하나 더 → 「1200000|」 → 「1,200,000|」
  assert.equal(caretAfterRegroup("1200000", 7, "1,200,000"), 9);
  // 「1,2|00,000」 에서 5 를 끼움 → 「1,25|00,000」 → 「12,5|00,000」
  assert.equal(caretAfterRegroup("1,2500,000", 4, "12,500,000"), 4);
  // 맨 앞
  assert.equal(caretAfterRegroup("91,000", 1, "91,000"), 1);
});

test("caretPastComma — 쉼표 너머의 숫자를 지운다", () => {
  assert.equal(caretPastComma("1,200", 2, 2, "Backspace"), 1);
  assert.equal(caretPastComma("1,200", 1, 1, "Delete"), 2);
  assert.equal(caretPastComma("1,200", 3, 3, "Backspace"), null);
  assert.equal(caretPastComma("1,200", 0, 5, "Backspace"), null);
});

test("caretAfterRegroup — 잘못 친 글자가 빠져도 커서는 제자리", () => {
  assert.equal(caretAfterRegroup("12a3", 3, "123"), 2);
});
