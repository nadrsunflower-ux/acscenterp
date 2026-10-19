// ============================================================
//  계약서 비서 실호출 검증 (CLI)
// ------------------------------------------------------------
//  가상의 프로젝트로 용역 계약서를 짓고, 비서에게 실제로 시켜 본다.
//  프롬프트와 도구 정의가 모델과 맞물리는지는 단위 테스트로 알 수 없다 —
//  모델이 조항을 통째로 보내는지, 번호로 부르지 않는지, 모르는 값을
//  지어내지 않는지는 불러 봐야 안다.
//
//  ⚠️ 실제 모델(OpenRouter)을 부른다. 한 번 돌리는 데 몇 센트가 든다.
//     Firestore 는 읽지도 쓰지도 않는다 — 계약서는 이 파일 안에서 짓는다.
//
//  실행:
//    npm run finance:verify-contract                 계약서용 기본 모델로
//    npm run finance:verify-contract -- --model=google/gemini-3.7-flash
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { applyContractChange, checkContract, newContract, type ContractProposal, type FinContractDraft } from "@/lib/neander/finance/contract";
import { runContractChat } from "@/lib/neander/finance/server/ai-contract";
import type { FinProjectDoc } from "@/lib/neander/finance/project";
import type { AgentMessage } from "@/lib/neander/ai/agent";

const MODEL = process.argv.find((a) => a.startsWith("--model="))?.slice("--model=".length);

const PROJECT: FinProjectDoc = {
  id: "verify",
  code: "VERIFY-2601",
  name: "2026 가을 북페스티벌 향기 부스",
  client: "사단법인 가을책문화협회",
  status: "planning",
  startDate: "2026-10-20",
  endDate: "2026-11-10",
  contractAmount: 8_800_000,
  vatMode: "included",
  installments: [],
  revenues: [],
  lines: [],
  createdAt: 0,
};

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures += 1;
};

let costUsd = 0;
const history: AgentMessage[] = [];
let draft: FinContractDraft = newContract("service", PROJECT, []);

/** 한 턴 — 사람이 제안을 전부 「적용」 한 것으로 치고 초안에 입힌다 */
async function turn(question: string): Promise<{ reply: string; proposals: ContractProposal[] }> {
  console.log(`\n▶ ${question}`);
  history.push({ role: "user", content: question });
  const res = await runContractChat({ messages: history, draft, project: PROJECT, quotes: [], model: MODEL });
  history.push({ role: "assistant", content: res.reply });
  costUsd += res.usage.costUsd ?? 0;
  console.log(`  ${res.model} · 입력 ${res.usage.inputTokens} (캐시 ${res.usage.cacheReadTokens}) · 출력 ${res.usage.outputTokens} · $${(res.usage.costUsd ?? 0).toFixed(4)}`);
  res.toolCalls.forEach((t) => console.log(`  · ${t.summary}`));
  console.log(`  답: ${res.reply.replace(/\n+/g, " ").slice(0, 260)}`);
  for (const p of res.proposals) draft = applyContractChange(draft, p.change);
  return { reply: res.reply, proposals: res.proposals };
}

async function main() {
  const lateFee = draft.body.clauses.find((x) => x.title === "지체상금")!;
  const count0 = draft.body.clauses.length;

  // 1) 조항 하나 고치기 — 그 조항만, 전체 글로
  const a = await turn("지체상금 상한을 계약금액의 5%로 낮춰줘.");
  check(a.proposals.length === 1, "제안이 하나다");
  const ea = a.proposals[0]?.change;
  check(ea?.kind === "clause.edit" && ea.clauseId === lateFee.id, "지체상금 조항을 고친다");
  if (ea?.kind === "clause.edit") {
    check(/100분의 5|5%/.test(ea.text) && !/100분의 10/.test(ea.text), "상한이 5% 로 바뀐다");
    check(ea.text.includes("①") && ea.text.includes("③"), "바꾸지 않은 항도 그대로 들어 있다 (조항 전체를 보낸다)");
    check(!ea.text.includes('"'), "따옴표 모양이 계약서와 같다 (곧은 따옴표가 섞이지 않는다)");
    const untouched = lateFee.text.split("\n").filter((l) => !l.startsWith("②"));
    check(untouched.every((l) => ea.text.includes(l)), "손대지 않은 항은 글자 하나 바뀌지 않는다");
  }
  check(!/고쳤습니다|수정했습니다|변경했습니다|반영했습니다/.test(a.reply), "「고쳤습니다」 라고 말하지 않는다");

  // 2) 새 조항 끼우기 — 번호로 부르지 않고, 알맞은 자리에
  const b = await turn("행사 배상책임보험은 발주자가 가입하고, 우리는 가입에 필요한 자료를 제공한다는 조항을 넣어줘.");
  const add = b.proposals.find((p) => p.change.kind === "clause.add")?.change;
  check(!!add, "새 조항을 끼우자고 제안한다");
  if (add?.kind === "clause.add") {
    check(/보험/.test(add.clause.title + add.clause.text), "보험 조항이다");
    check(!/제\s*\d+\s*조/.test(add.clause.text), "다른 조를 번호로 부르지 않는다");
    check(/“갑”/.test(add.clause.text), "당사자를 “갑” “을” 로 적는다");
  }
  check(draft.body.clauses.length === count0 + 1, "조항이 하나 늘었다");
  check(checkContract(draft).dangling.length === 0, "없는 조를 가리키는 번호가 생기지 않았다");

  // 3) 칸 바꾸기 — 금액·기간은 개요에, 조항 본문에 숫자를 되풀이하지 않는다
  const c = await turn("계약금액을 990만원(부가세 포함)으로 올리고, 계약기간 끝을 11월 20일로 바꿔줘.");
  const fields = c.proposals.find((p) => p.change.kind === "fields")?.change;
  check(fields?.kind === "fields" && fields.patch.amount === 9_900_000, "계약금액 9,900,000");
  check(fields?.kind === "fields" && fields.patch.endDate === "2026-11-20", "계약기간 끝 2026-11-20");
  check(!draft.body.clauses.some((x) => /9,900,000/.test(x.text)), "조항 본문에 계약금액을 되풀이하지 않는다");
  check(!/반영했습니다|바꿨습니다|고쳤습니다/.test(c.reply), "칸을 바꿀 때도 「반영했습니다」 라고 말하지 않는다");

  // 4) 모르는 값은 지어내지 않는다
  const d = await turn("상대방 사업자등록번호랑 대표자 이름 채워줘.");
  const made = d.proposals.find((p) => p.change.kind === "fields");
  const inventedBizNo = made?.change.kind === "fields" && /\d{3}-?\d{2}-?\d{5}/.test(made.change.patch.partyA?.bizNo ?? "");
  check(!inventedBizNo, "사업자등록번호를 지어내지 않는다");
  check(/알려|필요|확인|주시|없/.test(d.reply), "모르는 값은 물어본다");

  console.log(`\n합계 $${costUsd.toFixed(4)} (약 ${Math.round(costUsd * 1400)}원)`);
  if (failures > 0) {
    console.error(`\n실패 ${failures}건`);
    process.exit(1);
  }
  console.log("모두 통과");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
