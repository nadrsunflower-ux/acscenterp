// ============================================================
//  프로젝트 적재 — 2026 평택 미리내컴
// ------------------------------------------------------------
//  「(0908)미리내컴_평택아트센터_물품체크리스트.xlsx」 를 그대로 읽어
//  프로젝트 손익 화면에 올린다. 화면의 「엑셀에서 줄 가져오기」 와 같은
//  파서를 쓰므로, 사람이 화면에서 올린 것과 결과가 같다.
//
//  엑셀에서 손댄 곳은 두 군데뿐이다.
//
//   ① 용달 상행·하행의 분류를 「기타」 에서 「교통·운송」 으로 옮겼다.
//      원가 구조를 볼 때 195,000원이 「기타」 에 묻히면 읽히지 않고,
//      JIMFF 프로젝트도 용달을 운송으로 두어 행사끼리 견줄 수 있다.
//
//   ② 준비수량이 수량 이상인 줄에 준비 완료 체크를 켰다. 엑셀에는
//      체크 칸이 없고 준비수량으로만 표시했기 때문이다. 튜브·깔대기·
//      일진팩처럼 500개 중 1 로 적힌 줄은 켜지 않는다 — 애매하면
//      꺼 두는 쪽이 안전하다(안 챙긴 걸 챙겼다고 보는 것보다 낫다).
//
//  **없는 것을 지어내지 않았다.** JIMFF 적재와 달리 식대·인건비 예시를
//  더하지 않는다. 이건 실제로 굴리는 행사라 가짜 숫자가 섞이면 이익이
//  거짓말을 한다.
//
//  숙박은 묵지 않는 행사로 확인돼(2026-09-08) 줄을 두지 않는다. 식대와
//  인건비는 아직 확정 금액을 받지 못해 비워 둔다 — 원가가 물품값뿐이라
//  실제보다 적게 잡히므로, 메모에 그렇게 적어 둔다.
//
//  실제금액은 한 줄도 채우지 않는다. 원장은 2026-07 까지만 적재돼 있어
//  9월 구매가 아직 없다. 결제가 원장에 들어오면 화면에서 줄마다 채우거나,
//  거래에 프로젝트코드 MRNC-2609 를 찍어 참고값으로 본다.
//
//  같은 코드의 프로젝트가 이미 있으면 새로 만들지 않고 덮어쓴다.
//
//    npx tsx scripts/neander/seed-project-mirinaecom.ts            # 미리보기
//    npx tsx scripts/neander/seed-project-mirinaecom.ts --apply    # 적재
//    ... --contract 8000000 --vat included                         # 계약금액 지정
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { parseChecklistXlsx } from "@/lib/neander/finance/project-xlsx";
import {
  VAT_LABEL,
  VAT_MODES,
  groupLines,
  lineEstimate,
  projectSummary,
  sanitizeProject,
  splitVat,
  type VatMode,
} from "@/lib/neander/finance/project";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const XLSX_PATH = join(homedir(), "Downloads", "(0908)미리내컴_평택아트센터_물품체크리스트.xlsx");
const CODE = "MRNC-2609";

/** 계약금액 — 알려주기 전까지 0. 화면에서도 고칠 수 있다 */
const CONTRACT = Number(flag("contract") ?? 0) || 0;
const VAT: VatMode = (VAT_MODES as readonly string[]).includes(String(flag("vat")))
  ? (flag("vat") as VatMode)
  : "excluded";

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

const NOTE = [
  "「(0908)미리내컴_평택아트센터_물품체크리스트.xlsx」 에서 그대로 가져왔습니다 (물품 46줄).",
  CONTRACT > 0
    ? ""
    : "⚠️ 계약금액이 아직 0 입니다 — 주최측 계약서 금액을 넣어야 이익이 나옵니다.",
  "숙박: 없음 — 묵지 않는 행사로 확인됐습니다(2026-09-08). 숙박비 줄은 두지 않습니다.",
  "⚠️ 식대·인건비는 아직 안 들어갔습니다. 체크리스트에 칸이 없었고 확정된 금액도 받지 못했습니다 — 지금 원가는 물품값뿐이라 실제보다 적고, 이익은 그만큼 좋아 보입니다.",
  "행사 시작일·종료일도 확정되면 채우세요.",
  "실제금액은 비어 있습니다(= 견적으로 계산). 카드 결제가 원장에 들어오면 줄마다 채우거나, 거래에 프로젝트코드 MRNC-2609 를 찍으면 원장 참고값으로 보입니다.",
  "엑셀에서 바꾼 것: 용달 상행·하행 분류를 「기타」→「교통·운송」, 준비수량이 수량 이상인 줄에 준비 완료 체크.",
]
  .filter(Boolean)
  .join(" ");

(async () => {
  // ---- 엑셀 → 줄 ---------------------------------------------
  const file = readFileSync(XLSX_PATH);
  const parsed = parseChecklistXlsx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  if (parsed.error) throw new Error(parsed.error);

  const lines = parsed.lines.map((l) => {
    const out = { ...l };
    // ① 용달은 운송이다 — 「기타」 에 묻히면 원가 구조가 안 읽힌다
    if (/^용달/.test(out.item)) out.category = "교통·운송";
    // ② 준비수량이 수량을 채웠으면 준비 완료로 본다
    if (out.preparedQty !== undefined && out.qty > 0 && out.preparedQty >= out.qty) out.done = true;
    return out;
  });

  const draft = sanitizeProject({
    code: CODE,
    name: "2026 평택 미리내컴",
    client: "평택아트센터",
    status: "planning",
    bizMinor: "조향",
    contractAmount: CONTRACT,
    vatMode: VAT,
    revenues: [],
    lines,
    note: NOTE,
  });
  if (!draft.ok) throw new Error(draft.error);
  const value = draft.value;

  // ---- 미리보기 -----------------------------------------------
  const s = projectSummary(value);
  console.log(`\n[${value.name}] 코드 ${value.code} · ${value.client} · 사업소 ${value.bizMinor}`);
  console.log(`  엑셀에서 읽은 줄 ${parsed.lines.length}개, 건너뛴 줄 ${parsed.skipped}개 → 저장 ${s.lineCount}줄\n`);
  groupLines(value.lines).forEach((g) =>
    console.log(
      `   · ${g.category.padEnd(14)} ${String(g.lines.length).padStart(2)}줄  견적 ${fmt(g.estimate).padStart(11)}` +
        `   준비완료 ${g.doneCount}/${g.lines.length}`,
    ),
  );
  console.log(`\n  견적 원가 합계 ${fmt(s.estimate)}   (엑셀 합계 2,400,073 과 같아야 합니다)`);
  const v = splitVat(s.contract, VAT);
  console.log(`  계약금액 ${fmt(s.contract)} (${VAT_LABEL[VAT]}) → 공급가액 ${fmt(v.supply)} · 부가세 ${fmt(v.vat)}`);
  console.log(`  예상 이익 ${fmt(s.profitEstimate)}`);
  const zero = value.lines.filter((l) => lineEstimate(l) === 0).length;
  console.log(`  단가 0/미입력 ${zero}줄 (주최측 마련·이미 보유한 물품)`);
  console.log(`  준비 완료 ${s.doneCount}/${s.lineCount}줄`);

  if (!APPLY) {
    console.log("\n미리보기입니다. 적재하려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  // ---- 적재 ---------------------------------------------------
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finProjects);
  const now = Date.now();
  const existing = (await col.get()).docs.find(
    (d) => String(d.data().code ?? "").trim().toLowerCase() === CODE.toLowerCase(),
  );

  if (existing) {
    const prev = existing.data();
    await col.doc(existing.id).set(
      { ...value, createdAt: prev.createdAt ?? now, createdBy: prev.createdBy, updatedAt: now, updatedBy: "seed-project-mirinaecom" },
      { merge: false },
    );
    console.log(`\n덮어썼습니다 → /neander/finance/projects/${existing.id}`);
  } else {
    const ref = await col.add({
      ...value,
      createdAt: now,
      createdBy: "seed-project-mirinaecom",
      updatedAt: now,
      updatedBy: "seed-project-mirinaecom",
    });
    console.log(`\n만들었습니다 → /neander/finance/projects/${ref.id}`);
  }
  process.exit(0);
})();
