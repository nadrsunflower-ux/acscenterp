// 쇼츠 출력기 검증 — 로그인 · 서버 · 외부 API 없이 브라우저 출력만 본다.
//   npm run shorts:verify-render  [저장할 mp4 경로]
// 1) e2e/shorts-render-entry.ts 를 esbuild 로 묶어 임시 정적 서버에 올린다
// 2) Chrome(channel: chrome — H.264/AAC 인코더가 있다)에서 출력 → 코덱 · 길이 · 픽셀 · 소리 확인
// 3) 결과 MP4 를 Node 의 mediabunny 로 다시 열어 트랙 · 코덱 · 길이를 한 번 더 확인
// 4) 출력 도중 취소가 AbortError 로 끝나는지
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";

const dir = mkdtempSync(join(tmpdir(), "shorts-render-"));
const saveTo = process.argv[2] ? resolve(process.argv[2]) : null;
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

await build({
  entryPoints: ["e2e/shorts-render-entry.ts"],
  bundle: true,
  format: "esm",
  outfile: join(dir, "entry.js"),
  platform: "browser",
  target: "chrome110",
  logLevel: "error",
});
writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><script type="module" src="/entry.js"></script>`);
const server = createServer((req, res) => {
  const f = req.url === "/" ? "index.html" : req.url.slice(1);
  try {
    const body = readFileSync(join(dir, f));
    res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.runShortsRenderCheck === "function");
  const r = await page.evaluate(() => window.runShortsRenderCheck());
  if (!r.support?.ok) {
    check(false, "H.264/AAC 인코더", r.support?.reason ?? "");
  } else {
    check(true, "H.264/AAC 인코더 있음 (Chrome)");
    check(r.codecs.video === "avc" && r.codecs.audio === "aac", "출력 코덱 H.264 + AAC", JSON.stringify(r.codecs));
    check(Math.abs(r.duration - 6) < 0.15, "출력 길이 = 장면 합 6초", `${r.duration.toFixed(3)}초`);
    check(r.first.w === 720 && r.first.h === 1280, "9:16 720×1280", `${r.first.w}×${r.first.h}`);
    check(r.first.center[0] > 150 && r.first.center[2] < 90, "1장면: 빨간 원본 구간이 화면을 채움", JSON.stringify(r.first.center));
    check(r.third.center[2] > 150 && r.third.center[0] < 90, "3장면: 파란 AI 장면", JSON.stringify(r.third.center));
    check(r.first.plainRow.dark === 0 && r.first.plainRow.white === 0, "대조: 자막·띠가 없는 줄은 원본 색뿐", JSON.stringify(r.first.plainRow));
    check(r.first.subtitleRow.dark > 100 && r.first.subtitleRow.white > 5, "자막: 어두운 상자 + 흰 글자", JSON.stringify(r.first.subtitleRow));
    check(r.first.bannerRow.dark > 100 && r.first.bannerRow.white > 5, "영상 안 고지 띠: 어두운 띠 + 흰 글자", JSON.stringify(r.first.bannerRow));
    check(r.overlay.disclosure && /광고/.test(r.overlay.text), "고지 띠 기록", r.overlay.text);
    check(r.audio.rmsFirst > 0.05, "소리: 내레이션 + 원본 소리가 섞임 (앞부분)", r.audio.rmsFirst.toFixed(3));
    check(r.audio.rmsLast < r.audio.rmsFirst, "소리: 내레이션이 끝난 뒤 조용해짐", r.audio.rmsLast.toFixed(3));
    check(r.progressMonotonic && r.lastProgress >= 96, "진행률이 거꾸로 가지 않음", `마지막 ${r.lastProgress}%`);
    console.log(`  출력 ${(r.size / 1024).toFixed(0)}KB · ${r.ms}ms (6초 영상)`);
    const bytes = Buffer.from(r.mp4Base64, "base64");
    if (saveTo) writeFileSync(saveTo, bytes);
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    const fmt = await input.getFormat();
    check(fmt.name === "MP4" && (await v?.getCodec()) === "avc" && (await a?.getCodec()) === "aac", "Node 에서 다시 열어도 MP4 · avc · aac", `${fmt.name} ${await v?.getCodec()} ${await a?.getCodec()}`);
    check(v?.displayWidth === 720 && v?.displayHeight === 1280, "Node: 영상 트랙 720×1280");
    input.dispose();
    const c = await page.evaluate(() => window.runShortsCancelCheck());
    check(c.abortedWith === "AbortError", "출력 도중 취소 → AbortError", c.abortedWith);
  }
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `\n실패 ${failures}건` : "\n모두 통과");
process.exit(failures ? 1 : 0);
