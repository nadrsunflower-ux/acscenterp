import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { emptyQuote, quoteTotals, sanitizeFinDoc, type FinQuoteInput } from "./docs";
import { splitVat } from "./project";
import { buildQuoteWorkbook } from "./quote-xlsx";
import { findPreset, resolveSeal, sealOwnerFields } from "./supplier";
import { hasBusinessChoice, toggleBusinessChoice } from "./quote-options";
import { todayStrKST } from "@/lib/neander/format";

function saveRoundTrip(q: FinQuoteInput): FinQuoteInput {
  const result = sanitizeFinDoc(JSON.parse(JSON.stringify(q)));
  assert.ok(result.ok);
  if (!result.ok || result.value.kind !== "quote") throw new Error("견적 정규화 실패");
  return result.value;
}

test("새 견적은 프로젝트 정보와 한국 날짜, 기본 디자인을 사용한다", () => {
  const q = emptyQuote("project", { title: "행사", recipient: "발주처" });
  assert.equal(q.projectId, "project");
  assert.equal(q.title, "행사");
  assert.equal(q.recipient, "발주처");
  assert.equal(q.date, todayStrKST());
  assert.equal(q.design, 1);
});

test("모든 새 디자인·분류·수신자 정보를 실제 저장 정규화 후 재열기해도 보존한다", () => {
  const q = emptyQuote("project");
  q.category = "비교견적서";
  q.recipient = "고객사";
  q.receiver = { ceo: "대표", bizNo: "123-45-67890", address: "서울" };
  q.lines = [{ id: "line", name: "운영", spec: "2일", qty: 1.5, unitPrice: 12345, note: "품목 비고" }];
  for (const design of [1, 2, 3, 4, 5] as const) {
    const reopened = saveRoundTrip({ ...q, design });
    assert.equal(reopened.design, design);
    assert.equal(reopened.category, q.category);
    assert.deepEqual(reopened.receiver, q.receiver);
    assert.deepEqual(reopened.lines, q.lines);
  }
});

test("기존 문서에는 새 디자인을 강제로 넣지 않고 이전 판형을 유지한다", () => {
  const legacy = emptyQuote("project");
  delete legacy.design;
  const reopened = saveRoundTrip(legacy);
  assert.equal(reopened.design, undefined);
  assert.equal("design" in reopened, false);
  assert.equal("receiver" in reopened, false);
  const result = saveRoundTrip({ ...legacy, receiver: { ceo: "  ", bizNo: " ", address: "" } });
  assert.equal(result.receiver, undefined);
});

test("VAT 포함·별도 모두 저장·프로젝트 반영·엑셀에서 동일한 금액을 사용한다", () => {
  for (const vatMode of ["included", "excluded"] as const) {
    const q = saveRoundTrip({ ...emptyQuote("project"), vatMode,
      lines: [{ id: "one", name: "소수 수량", qty: 1.5, unitPrice: 110001 }, { id: "two", name: "무료", qty: 0, unitPrice: 100000 }],
    });
    const t = quoteTotals(q);
    assert.equal(t.sum, 165002);
    assert.equal(t.supply + t.vat, t.total);
    const applied = splitVat(t.sum, q.vatMode);
    assert.equal(applied.supply, t.supply);
    assert.equal(applied.vat, t.vat);
    assert.equal(applied.total, t.total);
    const sheet = buildQuoteWorkbook(q).Sheets["견적서"];
    assert.equal(sheet["K13"].v, t.total);
    assert.equal(sheet["M17"].v, 165002);
    assert.equal(sheet["M18"].v, 0);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    assert.ok(rows.flat().some((cell) => typeof cell === "string" && cell.includes(`공급가액 ${t.supply.toLocaleString("ko-KR")}`) && cell.includes(`부가세 ${t.vat.toLocaleString("ko-KR")}`)));
  }
});

test("엑셀에 새 수신자 정보와 기존 납품·결제·메모가 모두 남는다", () => {
  const q = { ...emptyQuote("project"), recipient: "고객사", receiver: { ceo: "받는 대표", bizNo: "123-45-67890", address: "수신 주소" }, delivery: "발주 3주 후", payment: "납품 후 입금", note: "확인 메모" };
  const sheet = buildQuoteWorkbook(q).Sheets["견적서"];
  const text = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]).flat().join(" ");
  for (const s of ["고객사", "받는 대표", "123-45-67890", "수신 주소", "발주 3주 후", "납품 후 입금", "확인 메모"]) assert.ok(text.includes(s), s);
});

test("일해라컴퍼니 프리셋은 자기 인감 주인과 연결되고 기존 회사 인감을 바꾸지 않는다", () => {
  const preset = findPreset("ilhaera");
  assert.equal(preset?.supplier.ceo, "김주연");
  assert.equal(resolveSeal(preset?.sealId)?.owner, "김주연");
  assert.equal(sealOwnerFields("lee-dongju")?.ceo, "이동주");
  assert.equal(findPreset("neander")?.sealId, "yoo-jaeyoung");
  assert.equal(sealOwnerFields("none"), null);
});

test("쉼표가 들어간 업태와 직접 입력값은 선택·해제·재열기에서 손실되지 않는다", () => {
  const option = "사업시설 관리, 사업지원 및 임대 서비스업";
  const selected = toggleBusinessChoice("직접 입력 업태", option);
  assert.ok(hasBusinessChoice(selected, option));
  assert.equal(toggleBusinessChoice(selected, option), "직접 입력 업태");
  assert.equal(toggleBusinessChoice(option, option), "");
  const q = emptyQuote("project");
  q.supplier = { ...q.supplier, bizType: selected };
  assert.ok(hasBusinessChoice(saveRoundTrip(q).supplier.bizType, option));
});
