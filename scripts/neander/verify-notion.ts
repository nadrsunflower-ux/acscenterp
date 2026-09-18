// ============================================================
//  노션 읽기 도구 검증
// ------------------------------------------------------------
//  비서가 노션을 읽는 길(lib/neander/ai/notion-tools.ts)을 확인한다.
//
//    ① 오프라인 — 네트워크 없이 순수 함수만.
//       id 뽑기 · 속성 → 칸 값 · 본문 자르기 · 토큰 없을 때 비서가 그대로인가
//    ② 실제 노션 — .env.local 에 NOTION_TOKEN 이 있을 때만.
//       검색 → 첫 페이지 본문 → 첫 표 몇 줄을 비서가 받을 모양 그대로 찍는다.
//
//  실행: npm run notion:verify
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "dotenv";
config({ path: ".env.local" });

import type { AgentSpec } from "../../lib/neander/ai/agent";
import { runNotionTool, summarizeNotionTool, withNotion } from "../../lib/neander/ai/notion-tools";
import {
  flattenProperty,
  pageTitle,
  parseNotionId,
  schemaOf,
  sliceText,
} from "../../lib/neander/notion/format";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const HEX = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const DASHED = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";
const VIEW = "ffffffffffffffffffffffffffffffff";
const PEEK = "0123456789abcdef0123456789abcdef";
const rt = (text: string) => [{ plain_text: text, annotations: { bold: false } }];

async function offline() {
  console.log("\n① id 뽑기");
  check("32자리 그대로", parseNotionId(HEX) === DASHED);
  check("대시 붙은 id", parseNotionId(DASHED.toUpperCase()) === DASHED);
  check("페이지 URL", parseNotionId(`https://www.notion.so/acscent/9-${HEX}?pvs=4`) === DASHED);
  check(
    "표 URL — 뷰 id(v=)가 아니라 표 id",
    parseNotionId(`https://www.notion.so/acscent/${HEX}?v=${VIEW}`) === DASHED,
  );
  check(
    "표에서 줄을 옆으로 연 URL — 줄 id(p=)",
    parseNotionId(`https://www.notion.so/acscent/${HEX}?v=${VIEW}&p=${PEEK}&pm=s`) ===
      "01234567-89ab-cdef-0123-456789abcdef",
  );
  check("id 아닌 글자", parseNotionId("평택 행사") === undefined);
  check("문자열 아님", parseNotionId(42) === undefined);

  console.log("\n② 속성 → 칸 값");
  check("제목", flattenProperty({ type: "title", title: rt("평택 미리내") }) === "평택 미리내");
  const long = flattenProperty({ type: "rich_text", rich_text: rt("가".repeat(400)) });
  check("긴 글은 자른다", typeof long === "string" && long.length === 301 && long.endsWith("…"));
  check("숫자", flattenProperty({ type: "number", number: 11_000_000 }) === 11_000_000);
  check("빈 숫자는 null", flattenProperty({ type: "number", number: null }) === null);
  check("선택", flattenProperty({ type: "select", select: { name: "확정" } }) === "확정");
  check("상태", flattenProperty({ type: "status", status: { name: "진행 중" } }) === "진행 중");
  check(
    "다중 선택",
    same(flattenProperty({ type: "multi_select", multi_select: [{ name: "와우" }, { name: "아이디" }] }), [
      "와우",
      "아이디",
    ]),
  );
  check(
    "기간",
    flattenProperty({ type: "date", date: { start: "2026-09-26", end: "2026-09-27" } }) === "2026-09-26 ~ 2026-09-27",
  );
  check("사람", same(flattenProperty({ type: "people", people: [{ name: "이동주" }, { id: "u1" }] }), ["이동주", "u1"]));
  check("체크", flattenProperty({ type: "checkbox", checkbox: true }) === true);
  check("수식(숫자)", flattenProperty({ type: "formula", formula: { type: "number", number: 0.4 } }) === 0.4);
  check(
    "수식(날짜)",
    flattenProperty({ type: "formula", formula: { type: "date", date: { start: "2026-10-01" } } }) === "2026-10-01",
  );
  check("관계는 id 만", same(flattenProperty({ type: "relation", relation: [{ id: "p1" }] }), ["p1"]));
  check(
    "롤업(배열)",
    same(
      flattenProperty({
        type: "rollup",
        rollup: { type: "array", array: [{ type: "rich_text", rich_text: rt("A") }, { type: "number", number: 3 }] },
      }),
      ["A", "3"],
    ),
  );
  check("고유 번호", flattenProperty({ type: "unique_id", unique_id: { prefix: "EV", number: 12 } }) === "EV-12");
  check("모르는 종류는 null", flattenProperty({ type: "button", button: {} }) === null);
  check(
    "제목 속성 이름이 '이름'이어도",
    pageTitle({ properties: { 상태: { type: "status" }, 이름: { type: "title", title: rt("9월 회의") } } }) ===
      "9월 회의",
  );
  const schema = schemaOf({
    properties: {
      이름: { type: "title", title: {} },
      상태: { type: "status", status: { options: [{ name: "예정" }, { name: "완료" }] } },
    },
  });
  check("열 목록에 선택지", schema["상태"] === "status: 예정 / 완료" && schema["이름"] === "title");

  console.log("\n③ 본문 자르기");
  const text = Array.from({ length: 300 }, (_, i) => `${i}번째 줄 — 행사 준비물 메모`).join("\n");
  const pieces: string[] = [];
  let offset: number | undefined = 0;
  let guard = 0;
  while (offset !== undefined && guard++ < 50) {
    const p = sliceText(text, offset, 1_000);
    pieces.push(p.text);
    offset = p.nextOffset;
  }
  check("이어 붙이면 원문과 같다", pieces.join("") === text, `${pieces.length}토막`);
  check("줄 경계에서 끊는다", pieces.slice(0, -1).every((p) => p.endsWith("\n")));
  check("짧으면 nextOffset 없음", sliceText("짧다", 0, 1_000).nextOffset === undefined);
  check("범위 밖 offset 은 빈 토막", sliceText("짧다", 99, 10).text === "");

  console.log("\n④ 비서에 얹기");
  const saved = process.env.NOTION_TOKEN;
  const base: AgentSpec<string> = {
    system: "S",
    tools: [{ type: "function", function: { name: "search_sales" } }],
    runTool: () => ({ result: { from: "module" } }),
    summarize: () => "module",
    referer: "r",
    title: "t",
  };
  delete process.env.NOTION_TOKEN;
  check("토큰이 없으면 비서가 그대로", withNotion(base) === base);
  process.env.NOTION_TOKEN = "secret_test";
  const wrapped = withNotion(base);
  check("토큰이 있으면 도구 셋이 붙는다", wrapped.tools.length === 4);
  check("프롬프트에 노션 규칙", wrapped.system.startsWith("S\n\n회사 노션"));
  check("모듈 도구는 모듈로", same(await wrapped.runTool("search_sales", {}), { result: { from: "module" } }));
  const bad = await wrapped.runTool("notion_read_page", { page: "평택 행사" });
  check("알아볼 수 없는 id 는 노션에 묻지 않고 거절", (bad.result as { ok: boolean }).ok === false);
  check(
    "실패 요약",
    wrapped.summarize("notion_read_page", {}, bad.result).startsWith("노션 read_page 실패"),
  );
  if (saved === undefined) delete process.env.NOTION_TOKEN;
  else process.env.NOTION_TOKEN = saved;
}

async function live() {
  console.log("\n⑤ 실제 노션");
  if (!process.env.NOTION_TOKEN?.trim()) {
    console.log("  – NOTION_TOKEN 이 없어 건너뜀 (docs/notion-assistant.md 참고)");
    return;
  }
  const search = (await runNotionTool("notion_search", { limit: 10 })).result as any;
  check("검색", search.ok === true, search.ok ? `${search.count}건` : search.error);
  if (!search.ok) return;
  if (search.count === 0) {
    console.log("  – 연결에 공유된 페이지가 없습니다. 노션에서 페이지 ••• → 연결 → ERP 연결 추가.");
    return;
  }
  for (const r of search.results) console.log(`     · [${r.kind === "database" ? "표" : "쪽"}] ${r.title}  (${r.lastEdited ?? "-"})`);

  const firstPage = search.results.find((r: any) => r.kind === "page");
  if (firstPage) {
    const args = { page: firstPage.id };
    const page = (await runNotionTool("notion_read_page", args)).result as any;
    check("페이지 본문", page.ok === true, summarizeNotionTool("notion_read_page", args, page));
    if (page.ok) {
      console.log(`     ${page.totalChars.toLocaleString("ko-KR")}자 중 앞부분:`);
      console.log(page.markdown.slice(0, 300).replace(/^/gm, "     │ "));
    }
  }

  const firstDb = search.results.find((r: any) => r.kind === "database");
  if (firstDb) {
    const args = { database: firstDb.id, limit: 3 };
    const db = (await runNotionTool("notion_query_database", args)).result as any;
    check("표 조회", db.ok === true, summarizeNotionTool("notion_query_database", args, db));
    if (db.ok) {
      console.log(`     열: ${Object.entries(db.schema).map(([k, v]) => `${k}(${v})`).join(" · ")}`);
      for (const row of db.rows) console.log(`     · ${row.title}  ${JSON.stringify(row.props).slice(0, 160)}`);
    }
  }
}

(async () => {
  console.log("\n══ 노션 읽기 도구 검증 ══");
  await offline();
  await live();
  console.log(failures === 0 ? "\n모두 통과\n" : `\n✗ ${failures}개 실패\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
