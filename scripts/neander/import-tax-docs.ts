// ============================================================
//  급여·세무 서류 이관 — iCloud 회계 폴더 → 재무 「급여 · 세무 서류」
// ------------------------------------------------------------
//  화면의 「폴더째 올리기」 와 같은 일을 한 번에 한다. 같은 파일(sha256)은 이미
//  있으면 건너뛰므로 몇 번을 돌려도 겹치지 않는다.
//
//    npm run finance:import-tax-docs -- "<회계 폴더>/2026"            미리 보기 (DB 안 건드림)
//    npm run finance:import-tax-docs -- "<회계 폴더>/2026" --apply    넣기
//    npm run finance:import-tax-docs -- --reread --apply             읽기 규칙을 고친 뒤 다시 읽기
//
//  가져오는 것: PDF · zip(안의 PDF). 엑셀(인건비 신고내역 · MMDD지급)은 우리가
//  만든 작업 파일이고 주민번호 · 주소가 들어 있어 기본으로 뺀다 — `--with-sheets`.
//  빼는 것: 통합거래장 인쇄본(장부 사본), 잠금 파일(~$), .DS_Store, 참고자료 폴더.
//
//  넣은 서류는 uploadedBy "cli" 로 남는다 (화면에 「회계 폴더에서 옮김」).
//  되돌리기: 화면에서 지우거나, 같은 폴더로 `--undo --apply` (그 폴더의 파일 해시로 찾아 지운다).
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import JSZip from "jszip";
import { adminDb } from "../../lib/neander/server/admin";
import { NEANDER_COL } from "../../lib/neander/collections";
import { pdfPages, putWholeTaxDoc, rereadTaxDocs, shareTaxDocSiblings } from "../../lib/neander/finance/server/tax-docs";
import { folderMonthOf, readTaxDoc, shareSiblingPeriod } from "../../lib/neander/finance/tax-docs-parse";
import { isTaxFolderPick, periodLabel, taxDocExt, taxKindLabel, TAX_DOC_MAX_BYTES } from "../../lib/neander/finance/tax-docs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REREAD = args.includes("--reread");
const UNDO = args.includes("--undo");
const WITH_SHEETS = args.includes("--with-sheets");
const root = args.find((a) => !a.startsWith("--"));

interface Item {
  rel: string;
  name: string;
  group: string;
  bytes: Buffer;
  sha256: string;
  folderMonth?: string;
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}


const decodeZipName = (bytes: Uint8Array | string[] | string) => {
  if (typeof bytes === "string") return bytes;
  const u8 = Array.isArray(bytes) ? new Uint8Array(bytes.map((c) => c.charCodeAt(0))) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("euc-kr").decode(u8);
  }
};

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function collect(dir: string): Promise<Item[]> {
  const year = basename(dir).match(/20\d\d/)?.[0];
  const items: Item[] = [];
  for (const p of walk(dir)) {
    const rel = relative(dir, p).normalize("NFC");
    if (!isTaxFolderPick(rel, WITH_SHEETS)) continue;
    const ext = taxDocExt(p);
    const pathForMonth = year ? `${year}/${rel}` : rel;
    if (ext === "zip") {
      const zip = await JSZip.loadAsync(readFileSync(p), { decodeFileName: decodeZipName });
      for (const z of Object.values(zip.files)) {
        if (z.dir || z.name.includes("__MACOSX/") || basename(z.name).startsWith(".")) continue;
        const name = basename(z.name).normalize("NFC");
        if (taxDocExt(name) !== "pdf") continue;
        const bytes = await z.async("nodebuffer");
        items.push({ rel: `${rel}!${name}`, name, group: rel, bytes, sha256: sha(bytes), folderMonth: folderMonthOf(pathForMonth, year) });
      }
      continue;
    }
    const bytes = readFileSync(p);
    if (bytes.length > TAX_DOC_MAX_BYTES) {
      console.log(`  건너뜀(너무 큼) ${rel}`);
      continue;
    }
    items.push({ rel, name: basename(rel), group: dirname(rel), bytes, sha256: sha(bytes), folderMonth: folderMonthOf(pathForMonth, year) });
  }
  return items;
}

async function main() {
  const db = adminDb();

  if (REREAD) {
    if (!APPLY) {
      console.log("다시 읽기는 문서를 고쳐 쓴다 — --apply 를 붙여 돌리세요.");
      return;
    }
    const changes = await rereadTaxDocs(db);
    console.log(`다시 읽음 — 바뀐 서류 ${changes.length}건`);
    for (const c of changes) console.log(`  ${c.id}  ${c.before}  →  ${c.after}`);
    return;
  }

  if (!root) {
    console.log('폴더를 주세요: npm run finance:import-tax-docs -- "<회계 폴더>/2026" [--apply]');
    process.exit(1);
  }

  const items = await collect(root);
  const existing = new Map<string, string>();
  const snap = await db.collection(NEANDER_COL.finTaxDocs).select("sha256", "complete", "name").get();
  for (const d of snap.docs) if (d.data().complete) existing.set(String(d.data().sha256), d.id);

  if (UNDO) {
    const targets = items.filter((i) => existing.has(i.sha256));
    console.log(`이 폴더의 파일과 같은 서류 ${targets.length}건${APPLY ? " 을 지웁니다" : " (미리 보기 — --apply 로 지움)"}`);
    for (const t of targets) {
      console.log(`  ${t.rel}`);
      if (APPLY) await db.recursiveDelete(db.collection(NEANDER_COL.finTaxDocs).doc(existing.get(t.sha256)!));
    }
    return;
  }

  // 미리 보기 — 서버가 올릴 때 하는 것과 같은 읽기를 여기서 한다
  const guesses = [];
  for (const it of items) {
    const pages = taxDocExt(it.name) === "pdf" ? await pdfPages(new Uint8Array(it.bytes)) : [];
    guesses.push({ ...it, ...readTaxDoc({ name: it.name, pages, folderMonth: it.folderMonth }) });
  }
  const byGroup = new Map<string, typeof guesses>();
  for (const g of guesses) byGroup.set(g.group, [...(byGroup.get(g.group) ?? []), g]);
  const shared = [...byGroup.values()].flatMap((g) => shareSiblingPeriod(g));

  const seen = new Set<string>();
  let dupInFolder = 0;
  console.log(`\n${root}\n파일 ${items.length}개 · 이미 있는 것 ${items.filter((i) => existing.has(i.sha256)).length}개\n`);
  for (const g of shared.sort((a, b) => (a.period ?? "").localeCompare(b.period ?? "") || a.kind.localeCompare(b.kind))) {
    const tag = existing.has(g.sha256) ? "있음" : seen.has(g.sha256) ? "겹침" : "새로";
    if (seen.has(g.sha256)) dupInFolder++;
    seen.add(g.sha256);
    console.log(`  [${tag}] ${periodLabel(g.period).padEnd(14)} ${taxKindLabel(g.kind).padEnd(16)} ${g.rel}  — ${g.reason}`);
  }
  const fresh = [...new Map(items.filter((i) => !existing.has(i.sha256)).map((i) => [i.sha256, i])).values()];
  console.log(`\n새로 넣을 것 ${fresh.length}개${dupInFolder ? ` (폴더 안에서 같은 파일 ${dupInFolder}개는 한 번만)` : ""}`);
  if (!APPLY) {
    console.log("미리 보기만 했습니다. 넣으려면 --apply 를 붙이세요.");
    return;
  }

  const idsByGroup = new Map<string, string[]>();
  let added = 0;
  for (const it of fresh) {
    const r = await putWholeTaxDoc(db, "cli", { name: it.name, type: MIME[taxDocExt(it.name)] ?? "application/octet-stream", bytes: it.bytes, sha256: it.sha256, folderMonth: it.folderMonth });
    if (!r.duplicate) {
      added++;
      idsByGroup.set(it.group, [...(idsByGroup.get(it.group) ?? []), r.doc.id]);
    }
  }
  let borrowed = 0;
  for (const ids of idsByGroup.values()) if (ids.length > 1) borrowed += (await shareTaxDocSiblings(db, ids)).length;
  console.log(`넣음 ${added}개 · 같이 올린 서류에서 귀속을 빌린 것 ${borrowed}개`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
