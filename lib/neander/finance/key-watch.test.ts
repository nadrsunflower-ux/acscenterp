// 예고 없이 생긴 오픈라우터 키 — 무엇을 알리나
// 실행: npx tsx --test lib/neander/finance/key-watch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_WATCH_GRACE_MS, KEY_WATCH_TRIES, keyAlertMessage, kstStamp, limitText, sortNewKeys, type SeenKey, type WatchKey } from "./key-watch";

const NOW = Date.parse("2026-11-10T11:00:00Z");
const key = (hash: string, over: Partial<WatchKey> = {}): WatchKey => ({ hash, name: hash.toUpperCase(), limit: 250, limitReset: "monthly", disabled: false, createdAt: "2026-11-10T09:00:00Z", ...over });
const seenKey = (state: SeenKey["state"], over: Partial<SeenKey> = {}): SeenKey => ({ name: "x", createdAt: null, firstSeen: 0, state, ...over });
const names = (ks: WatchKey[]) => ks.map((k) => k.hash);

test("본 키는 건너뛰고, 처음 보는 키만 가른다", () => {
  const r = sortNewKeys([key("old"), key("new")], { old: seenKey("baseline") }, new Set(), NOW);
  assert.deepEqual(names(r.alert), ["new"]);
  assert.deepEqual(names(r.registered), []);
});

test("ERP 에 등록된 새 키는 예고된 키 — 알리지 않는다", () => {
  const r = sortNewKeys([key("studio")], {}, new Set(["studio"]), NOW);
  assert.deepEqual(names(r.registered), ["studio"]);
  assert.deepEqual(names(r.alert), []);
});

test("만든 지 15분 안의 등록 안 된 키는 기다린다 · 지나면 알린다", () => {
  const fresh = key("fresh", { createdAt: new Date(NOW - KEY_WATCH_GRACE_MS + 60_000).toISOString() });
  const late = key("late", { createdAt: new Date(NOW - KEY_WATCH_GRACE_MS - 60_000).toISOString() });
  const nodate = key("nodate", { createdAt: null });
  const r = sortNewKeys([fresh, late, nodate], {}, new Set(), NOW);
  assert.deepEqual(names(r.wait), ["fresh"]);
  assert.deepEqual(names(r.alert), ["late", "nodate"]);
});

test("꺼진 채로 처음 보이는 키는 알리지 않는다", () => {
  const r = sortNewKeys([key("off", { disabled: true })], {}, new Set(), NOW);
  assert.deepEqual(names(r.registered), ["off"]);
  assert.deepEqual(names(r.alert), []);
});

test("알림이 실패한 키는 다시 보낸다 — 기다림 없이, 정해진 횟수까지", () => {
  const justMade = new Date(NOW - 60_000).toISOString();
  const r = sortNewKeys(
    [key("retry", { createdAt: justMade }), key("gaveup")],
    { retry: seenKey("pending", { tries: 1 }), gaveup: seenKey("pending", { tries: KEY_WATCH_TRIES }) },
    new Set(),
    NOW,
  );
  assert.deepEqual(names(r.alert), ["retry"]);
  // 실패한 뒤 ERP 에 등록되면 더 알리지 않는다
  const r2 = sortNewKeys([key("retry")], { retry: seenKey("pending", { tries: 1 }) }, new Set(["retry"]), NOW);
  assert.deepEqual(names(r2.registered), ["retry"]);
});

test("알림 글 — 키 이름 · 한국 시각 · 한도, 한도 없으면 경고", () => {
  assert.equal(limitText({ limit: 250, limitReset: "monthly" }), "$250 · 매달 다시 참");
  assert.equal(limitText({ limit: 12.5, limitReset: null }), "$12.50 누적");
  assert.equal(limitText({ limit: null, limitReset: null }), "한도 없음");
  assert.equal(kstStamp("2026-11-10T11:04:00Z"), "11/10 20:04");
  assert.equal(kstStamp(null), "모름");
  const m = keyAlertMessage(key("x", { name: "MYSTERY", limit: null, limitReset: null, createdAt: "2026-11-10T11:04:00Z" }));
  assert.match(m, /^🔑 예고 없는 오픈라우터 키 「MYSTERY」 — 11\/10 20:04 생성 · 한도 없음\. 한도가 없어 쓰는 만큼 나갑니다\./);
  assert.match(keyAlertMessage(key("y"), true), /^\[테스트\] /);
});
