// 업체 홈페이지 → 브리프 제안 검증 (추출 · 사설 주소 판정 · 근거 대조 · 고르기/넣기) — npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPicks,
  checkSiteUrl,
  checkSuggestion,
  colorCandidates,
  defaultPicks,
  evidenceFound,
  extractSite,
  isPrivateAddress,
  pickCount,
  prefillSiteUrl,
  type BrandSitePreview,
  type RawBrandSuggestion,
} from "./brand-site";
import type { ClientDoc, ClientProduct } from "./types";

// ---- 사설 주소 판정 ----

test("사설 · 루프백 · 링크로컬 · CGNAT · 멀티캐스트 IPv4 는 막는다", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "127.255.0.9", "0.0.0.0", "0.1.2.3", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.10", "100.64.0.1", "100.127.255.254", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255", "192.0.2.5", "198.18.0.1"])
    assert.equal(isPrivateAddress(ip), true, ip);
});

test("공개 IPv4 는 통과 — 경계 바로 바깥 포함", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.1.1", "223.255.255.254", "211.249.220.24"])
    assert.equal(isPrivateAddress(ip), false, ip);
});

test("IPv6 — ::1 · :: · fc00::/7 · fe80::/10 · 멀티캐스트 · IPv4-mapped 사설은 막는다", () => {
  for (const ip of ["::1", "::", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "febf::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::10.0.0.1", "2001:db8::1"])
    assert.equal(isPrivateAddress(ip), true, ip);
});

test("공개 IPv6 · 공개 IPv4-mapped 는 통과 · 읽지 못하는 글자는 막는다", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8", "2404:6800:4004:80a::200e"]) assert.equal(isPrivateAddress(ip), false, ip);
  for (const ip of ["", "abc", "1.2.3", "300.1.1.1", "1:2:3:4:5:6:7:8:9", "fe80:::1"]) assert.equal(isPrivateAddress(ip), true, `읽지 못함 ${ip}`);
});

test("주소 검사 — http/https · 사용자 정보 · 포트 · localhost · 사설 IP 글자", () => {
  assert.equal(checkSiteUrl("https://www.daisomall.co.kr/").ok, true);
  assert.equal(checkSiteUrl("http://example.com:80/a").ok, true);
  assert.equal(checkSiteUrl("https://example.com:443").ok, true);
  const bad = ["ftp://example.com", "file:///etc/passwd", "https://user:pw@example.com", "https://example.com:8080", "http://example.com:443", "http://localhost/", "http://foo.localhost", "http://printer.local", "http://intranet", "http://127.0.0.1", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://2130706433/", "http://0x7f.0.0.1/", "http://10.1.1.1", "http://[::ffff:127.0.0.1]/", "아무 글자"];
  for (const u of bad) assert.equal(checkSiteUrl(u).ok, false, u);
  const ok = checkSiteUrl("https://example.com/p#section");
  assert.ok(ok.ok && ok.url.hash === "", "주소의 # 뒤는 뗀다");
});

// ---- HTML → 읽을 글 ----

const HTML = `<!doctype html><html><head>
<title>예시브랜드 | 주방을 가볍게</title>
<meta name="description" content="정리가 쉬운 주방 선반 &amp; 수납">
<meta property="og:site_name" content="예시브랜드">
<meta property="og:title" content="예시브랜드 공식몰">
<meta name="theme-color" content="#E60012">
<style>.btn{background:#e60012;color:#fff}.tag{color:#1A73E8}.x{border-color:#e60012}.g{color:#333333}</style>
<script>var secret = "스크립트 글은 빼야 한다";</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"예시브랜드","slogan":"주방을 가볍게"},{"@type":"Product","name":"스텐 2단 선반","description":"녹이 잘 슬지 않는 스테인리스","offers":{"@type":"Offer","price":"19900","priceCurrency":"KRW"}}]}</script>
</head><body>
<nav><a>로그인</a><a>장바구니</a></nav>
<header><h1>주방을 가볍게, 예시브랜드</h1></header>
<main>
<h2>스텐 2단 선반</h2>
<p>폭 40cm · 높이 35cm 로 싱크대 옆 좁은 틈에도 들어갑니다.</p>
<p>폭 40cm · 높이 35cm 로 싱크대 옆 좁은 틈에도 들어갑니다.</p>
<div style="color:#1a73e8">혼자 사는 1인 가구를 위한 작은 주방 정리템</div>
<p>국내 1위 주방 선반!&nbsp;지금&#32;만나보세요</p>
<noscript>자바스크립트를 켜 주세요</noscript>
</main>
<footer>사업자등록번호 123-45-67890 · 서울시 어딘가</footer>
</body></html>`;

test("추출 — 제목 · 설명 · og · JSON-LD · 제목 줄 · 본문(nav/footer/script 빼고 · 겹친 줄 한 번)", () => {
  const s = extractSite(HTML);
  assert.equal(s.title, "예시브랜드 | 주방을 가볍게");
  assert.equal(s.description, "정리가 쉬운 주방 선반 & 수납");
  assert.equal(s.siteName, "예시브랜드");
  assert.equal(s.themeColor, "#e60012");
  assert.deepEqual(s.headings, ["주방을 가볍게, 예시브랜드", "스텐 2단 선반"]);
  assert.equal(s.jsonLd.length, 2);
  assert.equal(s.jsonLd[1].name, "스텐 2단 선반");
  assert.ok(s.jsonLd[1].extra.includes("가격 19900 KRW"));
  assert.ok(s.body.includes("폭 40cm · 높이 35cm"));
  assert.equal(s.body.split("폭 40cm").length - 1, 1, "같은 줄은 한 번만");
  assert.ok(s.body.includes("국내 1위 주방 선반! 지금 만나보세요"), "엔티티 · nbsp 정리");
  for (const gone of ["로그인", "장바구니", "사업자등록번호", "스크립트 글은", "자바스크립트를 켜"]) assert.ok(!s.text.includes(gone), `빠져야 함: ${gone}`);
  assert.ok(s.text.startsWith("[제목] 예시브랜드"));
  assert.equal(s.truncated, false);
});

test("추출 — 12,000자 상한에서 자르고 표시", () => {
  const long = `<html><body>${Array.from({ length: 800 }, (_, i) => `<p>줄 ${i} — 이 문장은 상한 시험용으로 길게 늘어놓은 본문입니다.</p>`).join("")}</body></html>`;
  const s = extractSite(long);
  assert.equal(s.text.length, 12_000);
  assert.equal(s.truncated, true);
});

test("색 후보 — theme-color 먼저 · CSS #hex 빈도순 · 무채색은 뺀다 · 3자리 펼침", () => {
  const c = colorCandidates(HTML);
  assert.deepEqual(c[0], { hex: "#e60012", count: 2, source: "theme-color" });
  assert.deepEqual(c[1], { hex: "#1a73e8", count: 2, source: "css" });
  assert.ok(!c.some((x) => x.hex === "#ffffff" || x.hex === "#333333"), "무채색 제외");
  assert.deepEqual(colorCandidates(`<style>a{color:#f80}</style>`), [{ hex: "#ff8800", count: 1, source: "css" }]);
});

// ---- 근거 대조 ----

test("근거 — 띄어쓰기 · 대소문자 · 따옴표만 느슨하게, 지어낸 문장은 없음", () => {
  const text = extractSite(HTML).text;
  assert.equal(evidenceFound("폭 40cm · 높이 35cm 로 싱크대 옆", text), true);
  assert.equal(evidenceFound("폭40CM·높이35cm로 싱크대옆", text), true);
  assert.equal(evidenceFound("「혼자 사는 1인 가구를 위한」", text), true);
  assert.equal(evidenceFound("폭 45cm · 높이 35cm", text), false, "숫자가 다르면 없음");
  assert.equal(evidenceFound("주방", text), false, "너무 짧은 근거는 근거가 아니다");
});

test("checkSuggestion — 근거 없는 칸은 버리고 세며, 업체 주장은 사실과 따로", () => {
  const text = extractSite(HTML).text;
  const raw: RawBrandSuggestion = {
    summary: { value: "예시브랜드는 좁은 주방용 선반을 판다.", evidence: "정리가 쉬운 주방 선반 & 수납" },
    target: { value: "1인 가구", evidence: "혼자 사는 1인 가구를 위한 작은 주방 정리템" },
    tone: { value: "과장 섞인 판매 말투", evidence: "지금 바로 구매하세요 특가!" }, // 페이지에 없는 문장
    keyMessages: [
      { value: "주방을 가볍게", evidence: "주방을 가볍게, 예시브랜드" },
      { value: "주방을  가볍게", evidence: "주방을 가볍게, 예시브랜드" }, // 겹침
      { value: "평생 보증", evidence: "평생 무상 보증" }, // 지어냄
      { value: "", evidence: "" }, // 페이지에 없음 — 버린 것으로 세지 않는다
    ],
    products: [
      {
        name: "스텐 2단 선반",
        nameEvidence: "스텐 2단 선반",
        facts: [
          { value: "폭 40cm · 높이 35cm", evidence: "폭 40cm · 높이 35cm 로 싱크대 옆 좁은 틈에도 들어갑니다.", claim: false },
          { value: "가격 19,900원", evidence: "가격 19900 KRW", claim: false },
          { value: "국내 1위라고 함", evidence: "국내 1위 주방 선반!", claim: true },
          { value: "무게 1.2kg", evidence: "무게 1.2kg", claim: false }, // 지어냄
        ],
      },
      { name: "없는 제품", nameEvidence: "어디에도 없는 문장입니다", facts: [] },
    ],
  };
  const { suggestion: s, dropped } = checkSuggestion(raw, text);
  assert.equal(s.summary?.value, "예시브랜드는 좁은 주방용 선반을 판다.");
  assert.equal(s.target?.value, "1인 가구");
  assert.equal(s.tone, null);
  assert.deepEqual(s.keyMessages.map((m) => m.value), ["주방을 가볍게"]);
  assert.equal(s.products.length, 1);
  assert.deepEqual(s.products[0].facts.map((f) => f.value), ["폭 40cm · 높이 35cm", "가격 19,900원"]);
  assert.deepEqual(s.products[0].claims.map((f) => f.value), ["국내 1위라고 함"]);
  assert.equal(dropped.count, 4);
  assert.deepEqual(dropped.labels, ["핵심 메시지 3", "「스텐 2단 선반」 사실 4", "제품 「없는 제품」", "톤 · 말투"]);
});

test("checkSuggestion — 빈 응답 · 깨진 모양도 견딘다", () => {
  const r = checkSuggestion(null, "아무 글");
  assert.deepEqual(r.suggestion, { summary: null, target: null, tone: null, keyMessages: [], products: [] });
  assert.equal(r.dropped.count, 0);
  const r2 = checkSuggestion({ keyMessages: "문자열" as unknown as [], products: [{ name: 3 } as never] }, "아무 글");
  assert.equal(r2.suggestion.products.length, 0);
});

// ---- 고르기 · 넣기 ----

const brief = (o: Partial<ClientDoc["brief"]> = {}): ClientDoc["brief"] => ({ summary: "", target: "", tone: "", keyMessages: [], mustInclude: [], banned: [], references: [], notes: "", ...o });
const product = (o: Partial<ClientProduct> = {}): ClientProduct => ({ id: "pd_1", name: "스텐 2단 선반", url: "", facts: ["폭 40cm · 높이 35cm"], photoIds: [], note: "", ...o });

function preview(): Pick<BrandSitePreview, "url" | "finalUrl" | "colors" | "suggestion"> {
  return {
    url: "https://example.com/",
    finalUrl: "https://www.example.com/",
    colors: [{ hex: "#e60012", count: 2, source: "theme-color" }, { hex: "#1a73e8", count: 2, source: "css" }],
    suggestion: {
      summary: { value: "새 요약", evidence: "e" },
      target: { value: "1인 가구", evidence: "e" },
      tone: { value: "담백하게", evidence: "e" },
      keyMessages: [{ value: "주방을 가볍게", evidence: "e" }, { value: "좁은 틈에도", evidence: "e" }],
      products: [
        { name: "스텐 2단 선반", evidence: "e", facts: [{ value: "폭 40cm · 높이 35cm", evidence: "e" }, { value: "가격 19,900원", evidence: "e" }], claims: [{ value: "국내 1위라고 함", evidence: "e" }] },
        { name: "도마 거치대", evidence: "e", facts: [{ value: "도마 3개 수납", evidence: "e" }], claims: [] },
      ],
    },
  };
}

test("기본 고르기 — 비어 있는 칸만, 목록은 비어 있을 때만, 색은 고르지 않음", () => {
  const pv = preview();
  const empty = defaultPicks({ brief: brief(), products: [] }, pv.suggestion);
  assert.deepEqual([empty.summary, empty.target, empty.tone, empty.colors], [true, true, true, false]);
  assert.deepEqual(empty.keyMessages, [true, true]);
  assert.deepEqual(empty.products.map((p) => p.on), [true, true]);
  assert.equal(pickCount(empty), 7);
  const filled = defaultPicks({ brief: brief({ summary: "사람이 쓴 요약", keyMessages: ["사람 메시지"] }), products: [product()] }, pv.suggestion);
  assert.deepEqual([filled.summary, filled.target, filled.tone], [false, true, true]);
  assert.deepEqual(filled.keyMessages, [false, false]);
  assert.deepEqual(filled.products.map((p) => p.on), [false, false]);
});

test("넣기 — 고른 칸만 바꾸고 · 메시지는 겹치지 않게 덧붙이고 · 제품은 새로/같은 이름엔 덧붙이고 · 주소 · 읽은 날 한 줄", () => {
  const pv = preview();
  const x = { brief: brief({ summary: "사람이 쓴 요약", keyMessages: ["주방을  가볍게"], references: ["https://youtu.be/abc"], notes: "기존 지시\n" }), products: [product()] };
  const picks = defaultPicks(x, pv.suggestion);
  picks.keyMessages = [true, true];
  picks.products = [{ on: true, facts: [true, true], claims: [true] }, { on: true, facts: [true], claims: [] }];
  picks.colors = true;
  applyPicks(x, pv, picks, "2026-11-04", () => "pd_new");
  assert.equal(x.brief.summary, "사람이 쓴 요약", "고르지 않은 칸은 그대로");
  assert.equal(x.brief.target, "1인 가구");
  assert.deepEqual(x.brief.keyMessages, ["주방을  가볍게", "좁은 틈에도"], "띄어쓰기만 다른 메시지는 겹친 것");
  assert.equal(x.products.length, 2);
  assert.deepEqual(x.products[0].facts, ["폭 40cm · 높이 35cm", "가격 19,900원"], "같은 이름 제품엔 새 사실만 덧붙임");
  assert.equal(x.products[0].url, "https://www.example.com/");
  assert.equal(x.products[0].note, "홈페이지 기준 · 확인 필요 · 2026-11-04 / 업체 주장: 국내 1위라고 함", "업체 주장은 사실이 아니라 메모로");
  assert.deepEqual(x.products[1], { id: "pd_new", name: "도마 거치대", url: "https://www.example.com/", facts: ["도마 3개 수납"], photoIds: [], note: "홈페이지 기준 · 확인 필요 · 2026-11-04" });
  assert.deepEqual(x.brief.references, ["https://youtu.be/abc", "https://example.com/"]);
  assert.equal(x.brief.notes, "기존 지시\n색 후보(코드로 찾음 · 확인 필요): #e60012 · #1a73e8\n홈페이지에서 읽음 2026-11-04 — https://www.example.com/");
  // 두 번 넣어도 주소는 한 번
  applyPicks(x, pv, { ...picks, products: [], colors: false }, "2026-11-04");
  assert.equal(x.brief.references.filter((r) => r === "https://example.com/").length, 1);
});

test("주소 미리 채우기 — 영상 주소가 아닌 참고 자료 → 제품 주소 → 빈칸", () => {
  assert.equal(prefillSiteUrl({ brief: brief({ references: ["https://www.youtube.com/watch?v=x", "https://brand.co.kr/about"] }), products: [] }), "https://brand.co.kr/about");
  assert.equal(prefillSiteUrl({ brief: brief({ references: ["https://youtu.be/x"] }), products: [product({ url: "https://smartstore.naver.com/a/products/1" })] }), "https://smartstore.naver.com/a/products/1");
  assert.equal(prefillSiteUrl({ brief: brief(), products: [product()] }), "");
});
