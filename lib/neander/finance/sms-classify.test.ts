// 문자 거래 → 어디에 쓴 돈 (`npm run finance:test-sms-classify`) — 이름 · 금액은 가짜
import { test } from "node:test";
import assert from "node:assert/strict";
import { classSuffix, normParty, projectCandidates, projectCellText, projectShort, smsClassResult } from "./sms-classify";
import type { ClassifySuggestion } from "./classify";

const P = (code: string, name: string, client: string, installments: { kind: string; amount: number; paidDate?: string; received?: boolean }[], status = "active") =>
  ({ code, name, client, status, installments: installments.map((i, k) => ({ id: String(k), ...i })) }) as never;

const projects = [
  P("PJ-1", "2026 가나 (11/3)", "가나", [{ kind: "잔금", amount: 600_000 }]),
  P("PJ-2", "2026 다라마 사주 포토부스 (11/7)", "바사협동조합 (BASA)", [{ kind: "잔금", amount: 1_500_000 }]),
  P("PJ-3", "2026 받은 건", "가나", [{ kind: "선금", amount: 600_000, paidDate: "2026-10-01" }]),
  P("PJ-4", "2026 취소 건", "가나", [{ kind: "잔금", amount: 600_000 }], "cancelled"),
];

test("입금액 = 안 받은 회차의 청구액(부가세 포함) · 이름이 닮으면 앞에", () => {
  const a = projectCandidates({ amount: 660_000, party: "(주)가나" }, projects);
  assert.deepEqual(a.map((c) => [c.code, c.kind, c.billed, c.nameMatch]), [["PJ-1", "잔금", 660_000, true]]);
  const b = projectCandidates({ amount: 1_650_000, party: "주식회사사아" }, projects);
  assert.deepEqual(b.map((c) => [c.code, c.nameMatch]), [["PJ-2", false]]);
  // 괄호 속 영문 이름도 발주처로 본다
  assert.equal(projectCandidates({ amount: 1_650_000, party: "BASA" }, projects)[0].nameMatch, true);
  assert.equal(projectCandidates({ amount: 1_234, party: "가나" }, projects).length, 0);
});

test("이름 다듬기 · 프로젝트 짧은 이름", () => {
  assert.equal(normParty("(주)가나 다"), "가나다");
  assert.equal(normParty("주식회사 가나"), "가나");
  assert.equal(projectShort("2026 다라마 사주 포토부스 (11/7)"), "다라마 사주 포토부스");
  assert.equal(projectShort("2026 다라마바사아자 사주 포토부스"), "다라마바사아자 사주");
  assert.equal(projectShort("2026 가나 (11/3)"), "가나");
});

const sug = (status: ClassifySuggestion["status"], minor?: string): ClassifySuggestion =>
  ({ status, acctMajor: minor ? "매출" : undefined, acctMid: minor ? "B2C매출" : undefined, acctMinor: minor, bizMajor: minor ? "B2C" : undefined, bizMinor: minor ? "와우" : undefined, classReason: "근거" }) as ClassifySuggestion;

test("알림 끝 「→ 어디」 — 확정은 그대로 · 제안은 ? · 모르면 없음 · 회차 후보가 먼저", () => {
  assert.equal(classSuffix(smsClassResult(sug("confirmed", "와우판매"))), " → 와우판매");
  assert.equal(classSuffix(smsClassResult(sug("suggested", "비품구입비"))), " → 비품구입비?");
  assert.equal(classSuffix(smsClassResult(sug("needs_review"))), "");
  const cand = projectCandidates({ amount: 660_000, party: "(주)가나" }, projects);
  const r = smsClassResult(sug("needs_review"), cand);
  assert.equal(classSuffix(r), " → 가나 잔금?");
  assert.equal(projectCellText(r), "PJ-1 가나 · 잔금");
  assert.equal(smsClassResult(sug("confirmed", "와우판매")).account, "매출 › B2C매출 › 와우판매");
});
