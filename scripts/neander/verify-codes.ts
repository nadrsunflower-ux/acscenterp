// ============================================================
//  자동 코드 검사 (lib/neander/finance/codes.ts) — DB 를 쓰지 않는다
//    npx tsx scripts/neander/verify-codes.ts
// ============================================================
import { codeMonth, isCodeClash, nextCode, saveWithAutoCode, takenCodes } from "@/lib/neander/finance/codes";

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
};

(async () => {
  const today = "2026-10-25";
  check("연월 — 시작일", codeMonth("2026-09-03", today) === "2609");
  check("연월 — 없으면 오늘", codeMonth(undefined, today) === "2610" && codeMonth("이상한값", today) === "2610");

  const taken = takenCodes(["MRNC-2609", "pj-2610-01", "PJ-2610-03"], [undefined, " ", "GR-2610-01"], ["PJ-2609-07"]);
  check("대소문자 · 빈 값", taken.has("pj-2610-03") && !taken.has("") && taken.size === 5, [...taken]);
  check("가장 큰 번호 + 1 (빈 번호를 메우지 않는다)", nextCode("project", taken, undefined, today) === "PJ-2610-04");
  check("달마다 따로", nextCode("project", taken, "2609-01" as string, today) === "PJ-2610-04" && nextCode("project", taken, "2026-09-15", today) === "PJ-2609-08");
  check("머리글마다 따로", nextCode("grant", taken, undefined, today) === "GR-2610-02" && nextCode("payback", taken, undefined, today) === "PB-2610-01");
  check("두 자리", nextCode("grant", new Set(), "2027-01-01", today) === "GR-2701-01");

  const clash = new Error("코드 PJ-2610-04 는 이미 「누구」 이 쓰고 있습니다.");
  check("겹침 문구 알아보기", isCodeClash(clash) && !isCodeClash(new Error("저장 실패")));

  // 앞의 두 번호를 다른 사람이 먼저 가져갔다
  const busy = new Set(["PJ-2610-04", "PJ-2610-05"]);
  const tried: string[] = [];
  const r = await saveWithAutoCode("project", taken, undefined, async (code) => {
    tried.push(code);
    if (busy.has(code)) throw new Error(`코드 ${code} 는 이미 「다른 프로젝트」 이 쓰고 있습니다.`);
    return { id: "new" };
  }, today);
  check("겹치면 다음 번호로 다시", r.code === "PJ-2610-06" && tried.join(",") === "PJ-2610-04,PJ-2610-05,PJ-2610-06", tried);
  let other = false;
  try {
    await saveWithAutoCode("project", taken, undefined, async () => {
      throw new Error("네트워크");
    }, today);
  } catch {
    other = true;
  }
  check("다른 오류는 그대로 던진다", other);

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})();
