// ============================================================
//  프로젝트 적재 — 2026 JIMFF 클리커 (수기 장부 옮김)
// ------------------------------------------------------------
//  손으로 적은 비용 장부 한 장을 옮긴다. 사진으로 받은 것이라 글씨가
//  확실한 것과 아닌 것이 섞여 있다. **확실한 것만 품목 칸에 넣고, 못 읽은
//  것은 비워 둔다.** 금액·날짜·수량은 숫자라 대체로 또렷해 그대로 넣는다.
//
//  못 읽은 줄도 금액과 날짜는 남긴다 — 품목만 비어 있을 뿐 돈은 실제로
//  나갔고, 합계에서 빠지면 원가가 그만큼 적어 보인다. 짐작되는 이름은
//  비고에 `판독?` 을 붙여 적어 두었다. 확인해서 품목 칸으로 옮기면 된다.
//
//  금액은 **총액**이다. 630,000/35kg 과 252,000/14kg 이 둘 다 kg당 18,000원
//  으로 맞아떨어져서 확인했다. 그래서 단가에는 총액÷수량을 넣고 실제금액에
//  총액을 그대로 넣는다 — 나눗셈이 딱 떨어지지 않아도 실제 원가는 정확하다.
//
//  분류는 장부에 없다. 품목을 보고 묶은 것이라 언제든 고치면 된다.
//
//    npx tsx scripts/neander/seed-project-jimff-clicker.ts          # 미리보기
//    npx tsx scripts/neander/seed-project-jimff-clicker.ts --apply  # 적재
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import {
  groupLines,
  projectSummary,
  sanitizeProject,
  shortId,
  type FinProjectLine,
} from "@/lib/neander/finance/project";

const APPLY = process.argv.includes("--apply");
const CODE = "JIMFF-CLICKER";
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/**
 * 수기 장부 한 줄.
 *  date   — 적힌 날짜 (`?` 는 자릿수가 흐릿한 것)
 *  total  — 그 줄의 총액. undefined 면 금액을 못 읽었거나 취소된 줄
 *  qty/unit — 수량과 단위
 *  item   — **확실히 읽은 것만.** 못 읽었으면 빈 문자열
 *  guess  — 짐작되는 이름 (비고에 `판독?` 로 남는다)
 *  memo   — 그 밖에 남길 말
 */
interface Handwritten {
  date: string;
  total?: number;
  qty?: number;
  unit?: string;
  item?: string;
  category?: string;
  guess?: string;
  memo?: string;
}

const ROWS: Handwritten[] = [
  // USD 로 적혀 있어 원화 환산은 하지 않았다 — 환율을 지어내면 원가가 틀린다
  { date: "26.07.30?", qty: 2100, unit: "EA", category: "자재", guess: "초음파 발진기 기판", memo: "USD 263.31 — 원화 환산 필요" },
  { date: "26.08.05", total: 99_000, qty: 2000, unit: "EA" },
  { date: "26.08.07", total: 143_200, qty: 2000, unit: "EA" },
  // 빨간 줄로 그어 지운 줄. 금액을 넣지 않고 기록만 남긴다
  { date: "26.08.10", qty: 19, unit: "EA", memo: "장부에서 취소 (원래 170,828)" },
  { date: "26.08.10", total: 630_000, qty: 35, unit: "kg", item: "Purple Rhamma", category: "자재" },
  { date: "26.08.10", total: 252_000, qty: 14, unit: "kg", item: "Lilac Purple", category: "자재" },
  { date: "26.08.10", total: 3_000, qty: 1, unit: "식", guess: "도색비" },
  { date: "26.08.13", total: 17_910, qty: 2000, unit: "EA", guess: "라벨지" },
  { date: "26.08.19?", total: 303_000, qty: 2100, unit: "EA", item: "투명본체 (40×40×120)", category: "자재", memo: "수정 전 838,000" },
  { date: "26.08.14", total: 420_000, qty: 2100, unit: "EA", item: "EVA 폼 (40×40×70)", category: "자재" },
  { date: "26.08.14", total: 3_000, qty: 1, unit: "식", guess: "부착비" },
  { date: "26.08.15?", total: 29_780, qty: 2000, unit: "EA", item: "스티커 (66×15)", category: "인쇄물" },
  { date: "26.08.15", total: 31_210, qty: 2000, unit: "EA", item: "스티커 (20×70)", category: "인쇄물" },
  { date: "26.08.15", total: -2_000, qty: 1, unit: "식", guess: "필름", memo: "장부에 −2,000 (차감으로 보임)" },
  { date: "26.08.19", total: 29_520, qty: 18, unit: "EA" },
  { date: "26.08.20", total: 54_000, qty: 3, unit: "EA", guess: "카드 리더기 추가" },
  { date: "26.08.25", total: 44_000, qty: 2, unit: "EA" },
  { date: "26.08.30?", total: 74_900, qty: 4, unit: "EA" },
];

function toLine(r: Handwritten): FinProjectLine {
  const notes = [`수기 ${r.date}`];
  if (r.guess) notes.push(`판독? ${r.guess}`);
  if (r.memo) notes.push(r.memo);
  const qty = r.qty ?? 1;
  return {
    id: shortId(),
    category: r.category ?? "",
    item: r.item ?? "",
    qty,
    ...(r.unit ? { unit: r.unit } : null),
    // 단가 = 총액 ÷ 수량. 실제금액에 총액을 그대로 두어 반올림 오차가 원가에
    // 스며들지 않게 한다.
    ...(r.total === undefined ? null : { unitPrice: r.total / qty, actual: r.total }),
    note: notes.join(" · "),
  };
}

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

(async () => {
  const draft = sanitizeProject({
    code: CODE,
    name: "2026 JIMFF 클리커",
    client: "제천국제음악영화제",
    status: "active",
    bizMinor: "조향",
    // 「견적한 수입 부가세 포함 800만원」 — 적은 값이 총액이라 included
    contractAmount: 8_000_000,
    vatMode: "included",
    revenues: [],
    lines: ROWS.map(toLine),
    note:
      "수기 비용 장부(사진)를 옮긴 것입니다. 품목 칸이 빈 줄은 글씨를 확실히 읽지 못한 것이고, " +
      "짐작되는 이름은 비고에 「판독?」 으로 적어 두었습니다 — 확인해서 품목으로 옮기세요. " +
      "금액은 장부의 총액이고 단가는 총액÷수량으로 넣었습니다. " +
      "첫 줄(USD 263.31)은 원화 환산을 하지 않아 금액이 비어 있습니다. " +
      "분류는 장부에 없던 것이라 품목을 보고 묶었습니다.",
  });
  if (!draft.ok) throw new Error(draft.error);
  const value = draft.value;
  const s = projectSummary(value);

  console.log(`\n[${value.name}] 코드 ${value.code}`);
  console.log(`  줄 ${s.lineCount}개 · 금액을 넣은 줄 ${s.actualFilled}개 · 품목 비운 줄 ${value.lines.filter((l) => !l.item).length}개`);
  console.log(`  계약 ${fmt(value.contractAmount)} (부가세 포함) → 공급가액 ${fmt(s.revenue)} · 부가세 ${fmt(s.revenueVat)}`);
  console.log(`  실제 원가 ${fmt(s.actual)} · 실질 이익 ${fmt(s.profitActual)} (이익률 ${((s.marginActual ?? 0) * 100).toFixed(1)}%)`);
  console.log("\n  분류별");
  groupLines(value.lines).forEach((g) =>
    console.log(`   · ${g.category.padEnd(12)} ${String(g.lines.length).padStart(2)}줄  ${fmt(g.actual).padStart(10)}`),
  );
  console.log("\n  줄 목록");
  value.lines.forEach((l) =>
    console.log(
      `   ${(l.item || "(품목 미판독)").padEnd(22)} ${String(l.qty).padStart(5)}${(l.unit ?? "").padEnd(3)} ${
        l.actual === undefined ? "(금액 없음)".padStart(11) : fmt(l.actual).padStart(11)
      }  ${l.note ?? ""}`,
    ),
  );

  if (!APPLY) {
    console.log("\n미리보기입니다. 적재하려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finProjects);
  const now = Date.now();
  const existing = (await col.get()).docs.find(
    (d) => String(d.data().code ?? "").trim().toLowerCase() === CODE.toLowerCase(),
  );
  if (existing) {
    await col.doc(existing.id).set(
      { ...value, createdAt: existing.data().createdAt ?? now, updatedAt: now, updatedBy: "seed-jimff-clicker" },
      { merge: false },
    );
    console.log(`\n덮어썼습니다 → /neander/finance/projects/${existing.id}`);
  } else {
    const ref = await col.add({ ...value, createdAt: now, createdBy: "seed-jimff-clicker", updatedAt: now, updatedBy: "seed-jimff-clicker" });
    console.log(`\n만들었습니다 → /neander/finance/projects/${ref.id}`);
  }
  process.exit(0);
})();
