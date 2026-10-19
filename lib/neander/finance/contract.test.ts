// 만든 계약서 단위 테스트 — 양식 짓기 · 변경 적용/되돌리기 · 살피기 (`npm run finance:test-contract`)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountLine,
  applyContractChange,
  checkContract,
  clauseLabel,
  contractOutline,
  fieldsChangeRows,
  invertContractChange,
  matchQuoteStyle,
  newClause,
  newContract,
  periodLine,
  type ContractChange,
  type FinContractDraft,
} from "./contract";
import { CONTRACT_TEMPLATES, sanitizeContractBody, theirParty, ourParty } from "./contract-body";
import { formalName } from "./contract-templates";
import { sanitizeFinDoc, type FinDoc } from "./docs";
import { diffWords, hasWordChange } from "./text-diff";

const PROJECT = {
  id: "p1",
  name: "2026 JIMFF OST페어",
  client: "사단법인 제천국제음악영화제",
  contractAmount: 12_000_000,
  vatMode: "included" as const,
  startDate: "2026-08-04",
  endDate: "2026-10-01",
  installments: [
    { id: "i1", kind: "선금" as const, amount: 3_600_000, dueDate: "2026-08-11" },
    { id: "i2", kind: "잔금" as const, amount: 8_400_000 },
  ],
};

const QUOTE: FinDoc = {
  id: "q1",
  projectId: "p1",
  kind: "quote",
  title: "OST페어의 건",
  files: [],
  createdAt: 1,
  quoteNo: "26-201",
  date: "2026-07-20",
  recipient: "제천국제음악영화제",
  supplier: {
    bizNo: "683-86-02812",
    name: "(주)네안데르",
    ceo: "이동주",
    address: "서울시 마포구 독막로36길 10-6, 1층",
    bizType: "도매 및 소매업",
    bizItem: "화장품 도소매업",
    contact: "이동주",
    phone: "010-0000-0000",
  },
  vatMode: "included",
  lines: [
    { id: "l1", name: "AI 조향사 프로그램 개발·운영", qty: 1, unitPrice: 7_000_000 },
    { id: "l2", name: "체험용 향수", spec: "10ml", qty: 500, unitPrice: 10_000 },
  ],
  sealId: "lee-dongju",
  status: "accepted",
};

const service = () => newContract("service", PROJECT, [QUOTE]);

test("양식 넷 모두 조항이 서로를 번호로 부르지 않는다", () => {
  for (const t of CONTRACT_TEMPLATES) {
    const c = newContract(t.id, PROJECT, [QUOTE]);
    assert.ok(c.body.clauses.length >= 12, `${t.label} 조항 수`);
    for (const x of c.body.clauses) {
      assert.ok(x.title.trim(), `${t.label} 제목 없는 조항`);
      assert.ok(x.text.trim(), `${t.label} ${x.title} 글 없음`);
      assert.doesNotMatch(x.text, /제\s*\d+\s*조/, `${t.label} ${x.title} 이 다른 조를 번호로 부른다`);
      assert.doesNotMatch(x.text, /undefined|NaN|\[object/, `${t.label} ${x.title} 에 깨진 값`);
    }
    // 조항 id 는 문서 안에서 유일하다 — 비서가 id 로 조항을 가리킨다
    assert.equal(new Set(c.body.clauses.map((x) => x.id)).size, c.body.clauses.length);
    assert.deepEqual(checkContract(c).dangling, []);
    assert.equal(c.body.ourSide, t.ourSide);
  }
});

test("용역 — 프로젝트의 상대방·금액·기간·입금 일정과 견적서 품목을 끌어온다", () => {
  const c = service();
  assert.equal(c.title, "2026 JIMFF OST페어 용역");
  assert.equal(c.body.heading, "2026 JIMFF OST페어 용역 계약서");
  assert.equal(c.counterparty, "사단법인 제천국제음악영화제");
  assert.equal(theirParty(c.body).name, "사단법인 제천국제음악영화제");
  // 우리 쪽은 최근 견적서의 공급자 — 줄이지 않은 상호로
  assert.equal(ourParty(c.body).name, "주식회사 네안데르");
  assert.equal(ourParty(c.body).ceo, "이동주");
  assert.equal(c.body.sealId, "lee-dongju");
  assert.equal(c.amount, 12_000_000);
  assert.equal(c.vatMode, "included");
  // 프로젝트 기간은 행사 날짜다 — 계약은 체결일부터 시작하고, 행사 날짜는 개요의 「행사 기간」 으로 간다
  assert.equal(c.startDate, undefined);
  assert.equal(c.endDate, "2026-10-01");
  assert.equal(c.body.terms.find((t) => t.label === "행사 기간")?.value, "2026년 8월 4일 ~ 2026년 10월 1일");
  assert.equal(newContract("service", { ...PROJECT, startDate: "2026-10-31", endDate: "2026-10-31" }, []).body.terms[0].value, "2026년 10월 31일");

  const pay = c.body.clauses.find((x) => x.title === "계약금액 및 지급")!;
  assert.match(pay.text, /1\. 선금: 금 3,600,000원 — 2026년 8월 11일까지/);
  assert.match(pay.text, /2\. 잔금: 금 8,400,000원/);
  // 금액은 본문에 되풀이하지 않는다 — 개요 표 한 곳에만 있다
  assert.doesNotMatch(c.body.clauses.map((x) => x.text).join("\n"), /12,000,000/);

  const scope = c.body.clauses.find((x) => x.title === "용역의 범위")!;
  assert.match(scope.text, /1\. AI 조향사 프로그램 개발·운영/);
  assert.match(scope.text, /2\. 체험용 향수 \(10ml\)/);
});

test("입금 일정이 없으면 선금 50 · 잔금 50 으로 시작한다", () => {
  const c = newContract("supply", { ...PROJECT, installments: [] }, []);
  const pay = c.body.clauses.find((x) => x.title === "대금의 지급")!;
  assert.match(pay.text, /선금: 계약금액의 50%/);
  assert.match(pay.text, /잔금: 계약금액의 50% — 검수 완료일로부터 14일 이내/);
  // 견적서가 없어도 품목 표는 빈 줄 하나로 열려 있다
  assert.equal(c.body.items.length, 1);
});

test("제작 위탁 — 우리가 갑이고, 프로젝트의 받는 돈·고객을 끌어오지 않는다", () => {
  const c = newContract("outsource", PROJECT, [QUOTE]);
  assert.equal(c.body.ourSide, "a");
  assert.equal(c.body.partyA.name, "주식회사 네안데르");
  assert.equal(c.body.partyB.name, "");
  assert.equal(c.counterparty, "");
  assert.equal(c.amount, 0);
  assert.equal(c.startDate, undefined);
  // 우리가 주는 돈이라 프로젝트 입금 일정이 아니라 기본 비율을 쓴다
  const pay = c.body.clauses.find((x) => x.title === "대금의 지급")!;
  assert.doesNotMatch(pay.text, /3,600,000/);
  // 관할은 우리(갑) 본점
  assert.match(c.body.clauses[c.body.clauses.length - 1].text, /“갑”의 본점 소재지/);
});

test("IP 협업 — 로열티가 본문에 있고 판매 기준이며, 계약금액이 없어도 빠진 것으로 치지 않는다", () => {
  const c = newContract("collab", PROJECT, []);
  const royalty = c.body.clauses.find((x) => x.title === "로열티")!;
  assert.match(royalty.text, /순매출액/);
  assert.match(royalty.text, /생산 수량이나 재고는 로열티 산정의 기준으로 삼지 않는다/);
  assert.ok(c.body.clauses.some((x) => x.title === "홍보" && /매월 1회 이상/.test(x.text)));
  assert.ok(c.body.clauses.some((x) => /금형/.test(x.text)));
  const check = checkContract(c);
  assert.ok(!check.missing.includes("계약금액"));
  // 요율 두 곳(개요의 로열티율 · 홍보 미이행 감액)이 빈칸이다
  assert.equal(check.blanks, 2);
});

test("지난 계약서의 우리 쪽 서명란 · 도장 · 계좌를 물려받는다", () => {
  const first = service();
  first.body.partyB = { ...first.body.partyB, ceo: "유재영" };
  first.body.sealId = "yoo-jaeyoung";
  first.body.terms = first.body.terms.map((t) => (t.label === "입금 계좌" ? { ...t, value: "신한 000-000-000000" } : t));
  const saved = { ...first, id: "c1", files: [], createdAt: 5, updatedAt: 9 } as FinDoc;
  const next = newContract("supply", PROJECT, [QUOTE, saved]);
  assert.equal(ourParty(next.body).ceo, "유재영");
  assert.equal(next.body.sealId, "yoo-jaeyoung");
  assert.equal(next.body.terms.find((t) => t.label === "입금 계좌")?.value, "신한 000-000-000000");
  // 위탁 계약의 계좌는 상대 것이다 — 우리 계좌를 채워 넣지 않는다
  const out = newContract("outsource", PROJECT, [QUOTE, saved]);
  assert.equal(out.body.terms.find((t) => t.label === "입금 계좌")?.value, "");
});

test("변경을 입히고, 그 변경만 되돌린다", () => {
  const c0 = service();
  const target = c0.body.clauses[7];
  assert.equal(target.title, "지체상금");

  const edit: ContractChange = { kind: "clause.edit", clauseId: target.id, title: "지체상금", text: target.text.replace("100분의 10", "100분의 5") };
  const undoEdit = invertContractChange(c0, edit)!;
  const c1 = applyContractChange(c0, edit);
  assert.match(c1.body.clauses[7].text, /100분의 5/);

  // 그 사이 사람이 다른 조항을 손으로 고친다
  const c2 = applyContractChange(c1, { kind: "clause.edit", clauseId: c1.body.clauses[0].id, title: "목적", text: "손으로 고친 목적" });
  const c3 = applyContractChange(c2, undoEdit);
  assert.equal(c3.body.clauses[7].text, target.text);
  assert.equal(c3.body.clauses[0].text, "손으로 고친 목적", "되돌리기가 다른 조항을 건드리면 안 된다");

  // 끼우기 ↔ 빼기
  const added = newClause("보험", "① “을”은 행사 배상책임보험에 가입한다.");
  const add: ContractChange = { kind: "clause.add", afterId: target.id, clause: added };
  const c4 = applyContractChange(c0, add);
  assert.equal(c4.body.clauses[8].id, added.id);
  assert.equal(clauseLabel(8, c4.body.clauses[8].title), "제9조(보험)");
  assert.equal(applyContractChange(c4, invertContractChange(c0, add)!).body.clauses.length, c0.body.clauses.length);

  const remove: ContractChange = { kind: "clause.remove", clauseId: c0.body.clauses[0].id };
  const back = invertContractChange(c0, remove)!;
  const c5 = applyContractChange(c0, remove);
  assert.equal(c5.body.clauses.length, c0.body.clauses.length - 1);
  // 맨 앞 조항을 뺐다가 되돌리면 맨 앞으로 돌아온다
  assert.deepEqual(applyContractChange(c5, back).body.clauses.map((x) => x.id), c0.body.clauses.map((x) => x.id));

  // 없는 조항을 가리키면 아무것도 바꾸지 않는다
  assert.equal(applyContractChange(c0, { kind: "clause.edit", clauseId: "nope", title: "x", text: "y" }), c0);
});

test("칸을 바꾸면 상대방 이름이 따라오고, 전/후 줄은 바뀐 것만 나온다", () => {
  const c0 = service();
  const patch = { amount: 13_200_000, endDate: "2026-10-15", partyA: { name: "(사)제천국제음악영화제", bizNo: "304-82-05636" } };
  const rows = fieldsChangeRows(c0, patch);
  assert.deepEqual(rows.map((r) => r.label), ["계약금액", "계약기간", "갑 상호", "갑 사업자등록번호"]);
  assert.match(rows[0].to, /일금 일천삼백이십만원정 \(₩13,200,000\) · 부가세 포함/);

  const change: ContractChange = { kind: "fields", patch };
  const undo = invertContractChange(c0, change)!;
  const c1 = applyContractChange(c0, change);
  assert.equal(c1.counterparty, "(사)제천국제음악영화제");
  assert.equal(c1.endDate, "2026-10-15");
  const c2 = applyContractChange(c1, undo);
  assert.equal(c2.amount, 12_000_000);
  assert.equal(c2.counterparty, "사단법인 제천국제음악영화제");
  assert.equal(c2.body.partyA.bizNo, "");

  // 날짜의 null 은 비운다
  assert.equal(applyContractChange(c0, { kind: "fields", patch: { startDate: null } }).startDate, undefined);
  assert.equal(periodLine(undefined, "2026-10-01"), "계약 체결일 ~ 2026년 10월 1일");
  assert.equal(amountLine(0, "included"), "");
});

test("살피기 — 빈칸 · 빈 칸 · 없는 조를 가리키는 번호", () => {
  const c0 = service();
  const check = checkContract(c0);
  assert.equal(check.blanks, 0);
  assert.ok(check.missing.includes("상대방 사업자등록번호"));
  assert.ok(check.missing.includes("행사 장소"));
  assert.ok(!check.missing.includes("행사 기간"));
  assert.ok(!check.missing.includes("계약금액"));

  const first = c0.body.clauses[0];
  const c1 = applyContractChange(c0, { kind: "clause.edit", clauseId: first.id, title: "목적", text: "제3조와 제40조에 따른다. 금액은 ____원." });
  const again = checkContract(c1);
  assert.equal(again.blanks, 1);
  assert.deepEqual(again.dangling, [{ clause: "제1조(목적)", ref: "제40조" }]);
});

test("저장 직전 정리 — 빈 조항은 버리고, 상대방은 서명란을 따른다", () => {
  const c = service();
  c.counterparty = "옛 이름";
  c.body.clauses.push({ id: c.body.clauses[0].id, title: "덧붙임", text: "같은 id 로 들어온 조항" }, { id: "x", title: "  ", text: "  " });
  const parsed = sanitizeFinDoc(c);
  assert.ok(parsed.ok);
  if (!parsed.ok || parsed.value.kind !== "contract") return;
  const body = parsed.value.body!;
  assert.equal(parsed.value.counterparty, "사단법인 제천국제음악영화제");
  assert.equal(body.clauses.length, c.body.clauses.length - 1, "제목도 글도 없는 조항은 버린다");
  assert.equal(new Set(body.clauses.map((x) => x.id)).size, body.clauses.length, "겹친 id 는 새로 준다");

  // 받은 계약서를 붙이기만 한 문서 — 본문이 없어도 저장된다
  const fileOnly = sanitizeFinDoc({ projectId: "p1", kind: "contract", title: "받은 계약서", counterparty: "주최사", amount: 100, vatMode: "included", status: "signed" });
  assert.ok(fileOnly.ok && fileOnly.value.kind === "contract" && fileOnly.value.body === undefined);
  assert.equal(sanitizeContractBody(null), undefined);
  // 모르는 도장 id 는 남기지 않는다
  assert.equal(sanitizeContractBody({ ...c.body, sealId: "아무거나" })?.sealId, undefined);
});

test("비서가 읽는 글 — 조항마다 id 가 붙는다", () => {
  const c = service();
  const outline = contractOutline(c);
  assert.match(outline, /\[양식\] 용역 계약서 — 우리는 을/);
  assert.match(outline, /계약금액: 일금 일천이백만원정 \(₩12,000,000\) · 부가세 포함/);
  for (const x of c.body.clauses) assert.ok(outline.includes(`[조항 id ${x.id}]`));
  assert.equal(formalName("(주)네안데르"), "주식회사 네안데르");
  assert.equal(formalName("와작홈즈"), "와작홈즈");
});

test("따옴표 모양 — 모델이 곧은 따옴표로 돌려보낸 글을 계약서에 맞춘다", () => {
  const c = service();
  const late = c.body.clauses.find((x) => x.title === "지체상금")!;
  const fromModel = late.text.replace(/[“”]/g, '"').replace("100분의 10", "100분의 5");
  const fixed = matchQuoteStyle(fromModel, c);
  assert.ok(!fixed.includes('"'));
  // 맞추고 나면 전/후 비교에 바뀐 낱말만 남는다
  assert.deepEqual(diffWords(late.text, fixed).filter((p) => p.op !== "same"), [
    { op: "del", text: "10을" },
    { op: "ins", text: "5을" },
  ]);
  // 곧은 따옴표를 쓰는 계약서는 건드리지 않는다
  const plain = { ...c, body: { ...c.body, preamble: "갑과 을은", closing: "", clauses: [{ id: "a", title: "목적", text: '"갑"은 한다.' }] } };
  assert.equal(matchQuoteStyle('"을"은 한다.', plain), '"을"은 한다.');
});

test("낱말 차이 — 바뀐 숫자 하나를 짚는다", () => {
  const before = "① 지체일수 1일마다 계약금액의 1,000분의 1에 해당하는 지체상금을 지급한다.\n② 총액은 100분의 10을 넘지 않는다.";
  const after = "① 지체일수 1일마다 계약금액의 1,000분의 0.5에 해당하는 지체상금을 지급한다.\n② 총액은 100분의 10을 넘지 않는다.";
  const parts = diffWords(before, after);
  assert.deepEqual(parts.filter((p) => p.op !== "same"), [
    { op: "del", text: "1에" },
    { op: "ins", text: "0.5에" },
  ]);
  // 이어 붙이면 양쪽 글이 그대로 나온다
  assert.equal(parts.filter((p) => p.op !== "ins").map((p) => p.text).join(""), before);
  assert.equal(parts.filter((p) => p.op !== "del").map((p) => p.text).join(""), after);
  assert.ok(hasWordChange(parts));
  assert.ok(!hasWordChange(diffWords("같은 글", "같은 글")));
  assert.deepEqual(diffWords("", "새 글"), [{ op: "ins", text: "새 글" }]);
});
