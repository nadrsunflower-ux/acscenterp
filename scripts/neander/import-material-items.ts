// ============================================================
//  직접재료비 상세 — 원가계산 엑셀의 「직접재료비」 시트를 상품에 옮긴다
// ------------------------------------------------------------
//  시트는 「[ 향수 10ml ]」 같은 블록마다 제품명·단가·수량·단위·금액·비고
//  줄이 있고 「… 합계」 행으로 끝난다. 「상품마스터」의 재료비 열이
//  `=직접재료비!E17` 처럼 블록 합계를 참조하므로, 어느 블록이 어느 상품인지는
//  그 수식에서 그대로 옮겼다 (BLOCKS).
//
//  안전장치: 블록의 엑셀 합계 · 줄로 다시 계산한 합계 · 지금 DB 재료비가
//  **셋 다 같을 때만** 줄을 넣는다. 하나라도 다르면 건너뛰고 알린다 — 줄을
//  넣는 순간 재료비가 줄 합계로 바뀌기 때문이다.
//
//  엑셀이 연결하지 않은 상품(오행 퍼퓸·한가위 퍼퓸 — 일반AI 원가를 가정한 값,
//  포도알 50ml — 포장이 다른 협업 라인)은 넣지 않는다. 가정을 사실처럼 보이게
//  하지 않으려고. 화면의 「다른 상품에서 복사」로 사람이 정한다.
//
//    npx tsx scripts/neander/import-material-items.ts <엑셀>          # 미리보기
//    npx tsx scripts/neander/import-material-items.ts <엑셀> --apply  # 반영
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { materialTotal, type SalesMaterialItem } from "@/lib/neander/sales/types";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const BY = "import-material-items";

/** 블록 제목 → 상품코드. 상품마스터 재료비 수식(=직접재료비!E…)에서 옮김 + 같은 블록 합계의 온라인 매장 상품 */
const BLOCKS: Record<string, string[]> = {
  "향수 10ml": ["IDI-001", "IDI-003"],
  "향수 50ml": ["IDI-002", "IDI-004"],
  "사쉐": ["IDE-003", "WOW-002"],
  "뿌디 - 오프라인용": ["IDI-005"],
  "향수 10ml - 이벤트용": ["IDE-001", "WOW-004"],
  "향수 50ml - 이벤트용": ["IDE-002", "WOW-001"],
  "뿌디 - 온라인용": ["IDI-006", "ONL-003"],
  "향수 10ml - 온라인용": ["IDI-007", "IDI-009", "ONL-001"],
  "향수 50ml - 온라인용": ["IDI-008", "IDI-010", "ONL-002"],
  "시향지 - 온라인용": ["ONL-004"],
  "뿌디 - 이벤트용": ["IDE-004", "WOW-003"],
  "커플센트 10ml 세트": ["IDI-011"],
  "커플센트 50ml 세트": ["IDI-012"],
  "레이어링 퍼퓸 세트 10ml": ["IDI-013"],
  "레이어링 퍼퓸 세트 50ml": ["IDI-014"],
};

interface Block {
  title: string;
  items: SalesMaterialItem[];
  excelTotal: number;
}

function readBlocks(path: string): Block[] {
  const wb = XLSX.read(fs.readFileSync(path));
  const ws = wb.Sheets["직접재료비"];
  if (!ws) throw new Error("「직접재료비」 시트가 없습니다.");
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  const v = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })]?.v;
  const s = (r: number, c: number) => String(v(r, c) ?? "").trim();

  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = s(r, 0);
    const title = a.match(/^\[\s*(.+?)\s*\]$/);
    if (title) {
      cur = { title: title[1], items: [], excelTotal: 0 };
      continue;
    }
    if (!cur || !a || a === "제품명") continue;
    if (/합계$/.test(a)) {
      cur.excelTotal = Math.round(Number(v(r, 4)) || 0);
      blocks.push(cur);
      cur = null;
      continue;
    }
    cur.items.push({
      name: a,
      unitPrice: Number(v(r, 1)) || 0,
      qty: Number(v(r, 2)) || 0,
      ...(s(r, 3) ? { unit: s(r, 3) } : {}),
      ...(s(r, 5) ? { supplier: s(r, 5) } : {}),
    });
  }
  return blocks;
}

async function main() {
  if (!file) throw new Error("사용법: import-material-items.ts <원가계산 엑셀> [--apply]");
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
  }
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.salesProducts);

  const blocks = readBlocks(file);
  const now = Date.now();
  let applied = 0;
  let skipped = 0;
  for (const b of blocks) {
    const ids = BLOCKS[b.title];
    const computed = materialTotal(b.items);
    console.log(`\n[${b.title}] ${b.items.length}줄 · 엑셀 합계 ${b.excelTotal} · 줄 합계 ${computed}${ids ? "" : " — 연결된 상품 없음"}`);
    if (!ids) continue;
    for (const id of ids) {
      const snap = await col.doc(id).get();
      const p = snap.data();
      if (!p) {
        console.log(`  ✗ ${id} 상품이 없습니다 — 건너뜀`);
        skipped++;
        continue;
      }
      if (computed !== b.excelTotal || p.material !== computed) {
        console.log(`  ✗ ${id} ${p.name} ${p.option}: DB 재료비 ${p.material} ≠ ${computed} — 건너뜀`);
        skipped++;
        continue;
      }
      if (p.materialItems?.length) {
        console.log(`  · ${id} ${p.name} ${p.option}: 이미 상세 ${p.materialItems.length}줄이 있어 두고 넘어감`);
        skipped++;
        continue;
      }
      console.log(`  ✓ ${id} ${p.name} ${p.option}: 재료비 ${p.material} 그대로 · 상세 ${b.items.length}줄`);
      if (APPLY) {
        await col.doc(id).set({ materialItems: b.items, material: computed, updatedAt: now, updatedBy: BY }, { merge: true });
      }
      applied++;
    }
  }
  console.log(`\n${APPLY ? "반영" : "미리보기"}: 넣음 ${applied} · 건너뜀 ${skipped}`);
  if (!APPLY) console.log("--apply 를 붙이면 반영합니다.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
