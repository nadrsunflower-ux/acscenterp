// ============================================================
//  발표 장표 내용 올리기 (CLI)
// ------------------------------------------------------------
//  장표 내용은 저장소 밖(private/decks/<slug>/content.ts)에 쓴다 — 저장소가
//  public 이다. 이 스크립트가 내용을 검사하고, 로컬 사본(content.json)을
//  만들고, --apply 면 Firestore(neander_decks/<slug>)에 올린다.
//
//  검사
//    · 문구의 {{v.키}} · {{r.경로}} 가 모두 가정·계산 결과에 닿는가 (스냅샷으로 계산)
//    · 없는 형식 이름, 없는 계산 블록, 없는 각주 번호, 모르는 @{학원}
//    · 장표 문구에 긴 줄표(—)가 없는가
//    · 매물 사진·지도 타일·캡처 파일이 있는가
//
//  실행
//    npm run deck:upload -- <slug>                  검사 + 로컬 사본
//    npm run deck:upload -- <slug> --fetch-tiles    빠진 지도 타일을 OSM 에서 받는다 (한 번만)
//    npm run deck:upload -- <slug> --apply          Firestore 에 올린다 (같은 해시는 건너뜀)
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildModel, KIND_DEPS, slideTexts } from "@/lib/neander/decks/model";
import { FORMATTERS } from "@/lib/neander/decks/format";
import { getPath, tokenFormats, tokenPaths } from "@/lib/neander/decks/template";
import { fitMap, tilesFor } from "@/lib/neander/decks/map";
import type { Block, DeckContent } from "@/lib/neander/decks/types";
import { localDeckDir, mimeOf, writeDeckAsset, writeDeckContent } from "@/lib/neander/decks/server/store";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FETCH_TILES = args.includes("--fetch-tiles");
const slugArg = args.find((a) => !a.startsWith("--"));

function pickSlug(): string {
  if (slugArg) return slugArg;
  const root = path.join(process.cwd(), "private", "decks");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => existsSync(path.join(root, d, "content.ts"))) : [];
  if (dirs.length === 1) return dirs[0];
  throw new Error(`slug 를 적어 주세요. 후보: ${dirs.join(", ") || "(없음)"}`);
}

function walkBlocks(blocks: Block[], f: (b: Block) => void) {
  for (const b of blocks) {
    f(b);
    if (b.type === "cols") b.cols.forEach((c) => walkBlocks(c, f));
    if (b.type === "card") walkBlocks(b.blocks, f);
  }
}

/** 장표가 쓰는 자산 — 사진 · 타일 · 캡처 */
export function deckAssetIds(content: DeckContent): string[] {
  const ids = new Set<string>();
  content.properties.forEach((p) => p.photo && ids.add(p.photo));
  for (const r of content.regions) {
    const pts = [
      ...content.properties.filter((p) => p.region === r.id).map((p) => ({ lat: p.lat, lng: p.lng })),
      ...(r.includeStore ? [content.currentStore] : []),
    ];
    if (pts.length) tilesFor(fitMap(pts)).forEach((t) => ids.add(t.id));
  }
  for (const s of content.slides) {
    walkBlocks(s.blocks, (b) => {
      if (b.type === "computed" && b.kind === "gallery") {
        ((b.opts?.items as { asset: string }[]) ?? []).forEach((it) => ids.add(it.asset));
      }
    });
  }
  return [...ids];
}

function validate(content: DeckContent): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const d of content.assumptions) {
    if (keys.has(d.key)) problems.push(`가정 키 중복: ${d.key}`);
    keys.add(d.key);
  }
  const model = buildModel(content, null, {});
  const sourceIds = new Set(content.sources.map((s) => s.id));
  const academyNames = new Set((content.snapshot.smoat?.academies ?? []).map((a) => a.name.trim()));
  const slideIds = new Set<string>();

  for (const s of content.slides) {
    if (slideIds.has(s.id)) problems.push(`장표 id 중복: ${s.id}`);
    slideIds.add(s.id);
    const texts = [...slideTexts(s), ...(s.notes ? [s.notes] : [])];
    for (const t of texts) {
      if (t.includes("—")) problems.push(`[${s.no}] 긴 줄표: ${t.slice(0, 60)}`);
      for (const p of tokenPaths(t)) {
        if (p.startsWith("v.")) {
          if (!keys.has(p.slice(2))) problems.push(`[${s.no}] 없는 가정: ${p}`);
        } else if (getPath(model, p) === undefined) {
          problems.push(`[${s.no}] 닿지 않는 경로: ${p}`);
        }
      }
      for (const f of tokenFormats(t)) if (!FORMATTERS[f]) problems.push(`[${s.no}] 없는 형식: ${f}`);
      for (const m of t.matchAll(/\[\^(\d+)\]/g)) {
        if (!sourceIds.has(Number(m[1]))) problems.push(`[${s.no}] 없는 각주: ${m[1]}`);
      }
      for (const m of t.matchAll(/@\{([^}]+)\}/g)) {
        if (!academyNames.has(m[1].trim())) problems.push(`[${s.no}] 모르는 학원: ${m[1]}`);
      }
    }
    walkBlocks(s.blocks, (b) => {
      if (b.type === "computed" && !(b.kind in KIND_DEPS)) problems.push(`[${s.no}] 없는 계산 블록: ${b.kind}`);
    });
    for (const k of s.keys ?? []) if (!keys.has(k)) problems.push(`[${s.no}] 칩에 없는 가정: ${k}`);
  }
  for (const p of content.products) {
    for (const m of `${p.market} ${p.edge}`.matchAll(/\[\^(\d+)\]/g)) {
      if (!sourceIds.has(Number(m[1]))) problems.push(`[상품 ${p.name}] 없는 각주: ${m[1]}`);
    }
  }
  for (const d of content.assumptions) {
    for (const t of [d.label, d.source, d.note ?? ""]) if (t.includes("—")) problems.push(`[가정 ${d.key}] 긴 줄표`);
  }
  return problems;
}

function localAssetFile(slug: string, id: string): string | null {
  const dir = path.join(localDeckDir(slug), "assets");
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((f) => path.parse(f).name === id);
  return name ? path.join(dir, name) : null;
}

async function fetchTile(slug: string, id: string) {
  const m = /^tile-(\d+)-(\d+)-(\d+)$/.exec(id);
  if (!m) return;
  const url = `https://tile.openstreetmap.org/${m[1]}/${m[2]}/${m[3]}.png`;
  const res = await fetch(url, { headers: { "User-Agent": "neander-erp-deck/1.0 (internal meeting slide, one-time fetch)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path.join(localDeckDir(slug), "assets", `${id}.png`), buf);
  console.log(`  받음 ${id} (${buf.length} bytes)`);
}

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
}

async function main() {
  const slug = pickSlug();
  const dir = localDeckDir(slug);
  const mod = (await import(path.join(dir, "content.ts"))) as { default: DeckContent | { default: DeckContent } };
  const content = ("slug" in mod.default ? mod.default : (mod.default as { default: DeckContent }).default) as DeckContent;
  if (content.slug !== slug) throw new Error(`content.slug(${content.slug}) 와 폴더(${slug})가 다릅니다.`);

  console.log(`장표 ${slug}: ${content.slides.length}장 · 가정 ${content.assumptions.length}개 · 매물 ${content.properties.length}곳`);
  const problems = validate(content);
  if (problems.length) {
    console.log(`\n검사 문제 ${problems.length}건:`);
    problems.forEach((p) => console.log(`  ! ${p}`));
    process.exitCode = 1;
    if (APPLY) throw new Error("검사를 통과하지 못해 올리지 않았습니다.");
  } else {
    console.log("검사 통과");
  }

  const assets = deckAssetIds(content);
  const missing = assets.filter((id) => !localAssetFile(slug, id));
  if (missing.length && FETCH_TILES) {
    console.log(`\n빠진 타일 ${missing.filter((i) => i.startsWith("tile-")).length}장을 받습니다 (1초 간격)`);
    for (const id of missing.filter((i) => i.startsWith("tile-"))) {
      await fetchTile(slug, id);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const stillMissing = assets.filter((id) => !localAssetFile(slug, id));
  console.log(`자산 ${assets.length}개${stillMissing.length ? ` · 없음 ${stillMissing.length}: ${stillMissing.join(", ")}` : " · 모두 있음"}`);

  const json = JSON.stringify(content);
  writeFileSync(path.join(dir, "content.json"), json);
  console.log(`로컬 사본 content.json (${(json.length / 1024).toFixed(0)}KB) — 개발 서버가 바로 읽는다`);

  if (!APPLY) {
    console.log("\n(미리보기) Firestore 에 올리려면 -- --apply");
    return;
  }
  init();
  const db = getFirestore();
  const r = await writeDeckContent(db, content, "script:upload-deck");
  console.log(`\n내용 ${r.changed ? "올림" : "이미 같음"} (${r.bytes} bytes, 조각 ${r.parts})`);
  let up = 0;
  for (const id of assets) {
    const file = localAssetFile(slug, id);
    if (!file) continue;
    if (await writeDeckAsset(db, slug, id, readFileSync(file), mimeOf(file))) up += 1;
  }
  console.log(`자산 ${up}개 올림 (${assets.length - up}개는 이미 같거나 없음)`);
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
