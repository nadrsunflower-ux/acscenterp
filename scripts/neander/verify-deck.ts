// ============================================================
//  발표 장표 검증 (CLI) — 비공개 내용 + 스냅샷(또는 ERP)으로 완료 기준을 재현
// ------------------------------------------------------------
//  단위 테스트(lib/neander/decks/*.test.ts)는 가상 숫자로 식을 본다. 여기서는
//  실제 기본값으로 발표에서 말하는 숫자가 나오는지 본다. 기대값은 장표 내용
//  폴더의 expect.json 에 둔다 — 숫자라서 저장소(public)에 두지 않는다.
//
//    npm run deck:verify -- <slug>           스냅샷으로
//    npm run deck:verify -- <slug> --erp     지금 ERP 값으로 (읽기만)
//
//  expect.json 모양
//    [{ "name": "...", "overrides": { "키": 값 }, "path": "r.reloc.min", "min": 29, "max": 29 }]
// ============================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildModel } from "@/lib/neander/decks/model";
import { getPath } from "@/lib/neander/decks/template";
import type { DeckActuals, DeckContent } from "@/lib/neander/decks/types";
import { localDeckDir } from "@/lib/neander/decks/server/store";
import { loadDeckActuals } from "@/lib/neander/decks/server/load";

interface Expect {
  name: string;
  overrides?: Record<string, number | boolean | null>;
  path: string;
  min?: number;
  max?: number;
  equals?: unknown;
}

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const ERP = args.includes("--erp");

async function main() {
  if (!slug) throw new Error("slug 를 적어 주세요.");
  const dir = localDeckDir(slug);
  const mod = (await import(path.join(dir, "content.ts"))) as { default: DeckContent | { default: DeckContent } };
  const content = ("slug" in mod.default ? mod.default : (mod.default as { default: DeckContent }).default) as DeckContent;
  const file = path.join(dir, "expect.json");
  if (!existsSync(file)) throw new Error(`${file} 가 없습니다.`);
  const expects = JSON.parse(readFileSync(file, "utf8")) as Expect[];

  let live: DeckActuals | null = null;
  if (ERP) {
    if (getApps().length === 0) {
      const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64!, "base64").toString("utf8"));
      initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
    }
    const r = await loadDeckActuals(getFirestore(), content.rules);
    if (r.errors.smoat || r.errors.finance) console.log("ERP 일부를 못 읽었다:", r.errors);
    live = r.actuals;
  }
  console.log(`장표 ${slug} · 실측 ${ERP ? "ERP (지금)" : "스냅샷"}\n`);

  let fail = 0;
  for (const e of expects) {
    const m = buildModel(content, live, (e.overrides ?? {}) as Record<string, number | boolean | null>);
    const got = getPath(m, e.path);
    let ok: boolean;
    if (e.equals !== undefined) ok = JSON.stringify(got) === JSON.stringify(e.equals);
    else ok = typeof got === "number" && (e.min === undefined || got >= e.min) && (e.max === undefined || got <= e.max);
    if (!ok) fail += 1;
    const show = typeof got === "number" ? Math.round(got * 1000) / 1000 : JSON.stringify(got);
    const want = e.equals !== undefined ? JSON.stringify(e.equals) : `${e.min ?? "-∞"} ~ ${e.max ?? "∞"}`;
    console.log(`${ok ? "통과" : "실패"}  ${e.name}: ${show} (기대 ${want})`);
  }
  console.log(`\n${expects.length}건 중 ${expects.length - fail}건 통과`);
  if (fail) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
