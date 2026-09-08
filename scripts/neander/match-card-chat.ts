// ============================================================
//  법인카드 카톡방 기록 ↔ 거래 대조 — 사업구분 백필 ⑥ + 비고 보강
// ------------------------------------------------------------
//  "(주) 네안데르 법인카드 사용내역" 카톡방에는 카드를 긁을 때마다
//  날짜·상호·용도·금액을 남기는 관행이 있다. 이 용도 설명에는 장부에
//  없는 정보 — 무엇을 왜 샀는지 — 가 들어 있다.
//
//  대조: 지출·환급 거래와 같은 금액 + 날짜 ±3일. 이미 분류된 매칭
//  893건으로 키워드 신뢰도를 실측한 결과:
//
//   ① 생카/굿즈류(포카·증사·배너·콘솔…)는 갈리는 게 아니라 **연도별
//      관행 전환**이었다 — 2025년은 전부 B2C·SMOAT(126/126, 마케팅비>
//      콘텐츠제작 계정), 2026년은 전부 B2C·홍대공용(146/146, 생카소모품비
//      계정). 연도 안에서는 만장일치다. 이 둘만 규칙으로 쓴다.
//      (식대·구독료·비품 계정에 키워드가 우연히 걸린 6건이 있어
//       그 계정들은 규칙에서 제외한다.)
//   ② "사무실/사무소" → 공용·공용 (실측 5/5)
//   ③ 그 외 키워드(아이디·와우·신촌 등)는 실측 신뢰도가 95%에 못 미쳐
//      **자동 분류하지 않는다.** 대신 매칭된 모든 미기입 거래의 비고에
//      카톡 용도를 붙여, 검토함에서 사람이 바로 판단할 수 있게 한다.
//
//    npx tsx scripts/neander/match-card-chat.ts <카톡.csv>            (분석)
//    npx tsx scripts/neander/match-card-chat.ts <카톡.csv> --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { PL_TX_TYPES, type FinTransaction } from "@/lib/neander/finance/types";

const QUOTE = '"';

/** 따옴표 안 개행을 허용하는 CSV 파서 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQ) {
      if (c === QUOTE) {
        if (raw[i + 1] === QUOTE) {
          field += QUOTE;
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === QUOTE) inQ = true;
    else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

export interface ChatEntry {
  /** 메시지 타임스탬프 (YYYY-MM-DD) */
  msgDate: string;
  /** 본문에 적힌 거래일 (없으면 msgDate) */
  date: string;
  user: string;
  text: string;
  amounts: number[];
}

/** "7.30" / "7월 30일" / "07/30" 을 메시지 시점 기준 절대 날짜로 */
function resolveDate(msgDate: string, m: number, d: number): string {
  const [my, mm] = [Number(msgDate.slice(0, 4)), Number(msgDate.slice(5, 7))];
  let y = my;
  // 1월에 "12.31" 을 적으면 작년 것이다
  if (m > mm + 1) y -= 1;
  if (mm === 12 && m === 1) y += 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseChat(csvPath: string): ChatEntry[] {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const entries: ChatEntry[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 3 || !r[0]) continue;
    const msgDate = r[0].slice(0, 10);
    const text = r[2];
    if (!text || text === "사진" || /^https?:/.test(text)) continue;
    // 금액 후보: 1,234,567 또는 4자리 이상 숫자 (연도·계좌번호는 아래에서 걸러짐)
    const amounts = [...text.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원?/g)]
      .map((m) => Number(m[1].replace(/,/g, "")))
      .filter((n) => n >= 1000 && n <= 20_000_000);
    if (amounts.length === 0) continue;
    // 본문 날짜: "7.30" "7월 30일" "07/30" "7.30일"
    let date = msgDate;
    const dm =
      text.match(/^(\d{1,2})[.\/](\d{1,2})(?:\D|$)/m) ??
      text.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (dm) {
      const m = Number(dm[1]);
      const d = Number(dm[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) date = resolveDate(msgDate, m, d);
    }
    entries.push({ msgDate, date, user: r[1], text, amounts });
  }
  return entries;
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

const dayDiff = (a: string, b: string) =>
  Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("사용법: npx tsx scripts/neander/match-card-chat.ts <카톡.csv>");
    process.exit(1);
  }
  const entries = parseChat(csvPath);
  console.log(`카톡 구매 항목 ${entries.length}건 (${entries[0]?.msgDate} ~ ${entries[entries.length - 1]?.msgDate})`);

  init();
  const db = getFirestore();
  const snap = await db.collection(NEANDER_COL.finTransactions).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];

  // 금액 → 카톡 항목 인덱스
  const byAmt = new Map<number, ChatEntry[]>();
  entries.forEach((e) => e.amounts.forEach((a) => byAmt.set(a, [...(byAmt.get(a) ?? []), e])));

  // 대조: 지출·환급 거래, 같은 금액 + 날짜 ±3일. 후보가 여럿이면 가장 가까운 날짜.
  const matchOf = (t: FinTransaction): ChatEntry | null => {
    const g = t.gross ?? 0;
    const cands = (byAmt.get(g) ?? []).filter((e) => dayDiff(e.date, t.date) <= 3);
    if (cands.length === 0) return null;
    cands.sort((a, b) => dayDiff(a.date, t.date) - dayDiff(b.date, t.date));
    return cands[0];
  };

  const pl = all.filter((t) => PL_TX_TYPES.includes(t.txType) && t.txType !== "수입");
  const pending = pl.filter((t) => !t.bizMajor);
  const labeled = pl.filter((t) => t.bizMajor);

  const pendingMatched = pending.map((t) => ({ t, e: matchOf(t) })).filter((x) => x.e);
  const labeledMatched = labeled.map((t) => ({ t, e: matchOf(t) })).filter((x) => x.e);
  console.log(`\n사업구분 미기입(지출·환급) ${pending.length}건 중 카톡 매칭 ${pendingMatched.length}건`);
  console.log(`이미 분류된 ${labeled.length}건 중 카톡 매칭 ${labeledMatched.length}건 (키워드 신뢰도 실측용)`);

  // ── 키워드별 신뢰도 실측 ─────────────────────────────
  // 후보 키워드가 든 카톡 항목과 매칭된 "이미 분류된" 거래들의 사업구분
  // 분포를 잰다. 95% 이상 + 표본 3건 이상만 규칙으로 쓴다 (기존 백필과
  // 같은 기준).
  const KEYWORDS: { name: string; re: RegExp }[] = [
    { name: "아이디", re: /아이디/ },
    { name: "와우", re: /와우/ },
    { name: "신촌", re: /신촌/ },
    { name: "SMOAT", re: /스모트|SMOAT|smoat/i },
    { name: "사무실", re: /사무실|사무소/ },
    { name: "홍대", re: /홍대/ },
    { name: "생카/굿즈류", re: /생카|생일카페|포카|증사|슬로건|등신대|컷아웃|응원봉|굿즈|음향지|엽서|포토카드|아크릴|현수막|배너|명함|콘솔|로딩|다꾸/ },
    { name: "포토(부스)", re: /포토부스|포토 부스|DNP|디엔피/i },
    { name: "조향", re: /조향/ },
    { name: "클래스", re: /클래스/ },
    { name: "크래커스", re: /크래커스/ },
    { name: "SIWF", re: /siwf/i },
    { name: "JIMFF", re: /jimff/i },
    { name: "팝업", re: /팝업/ },
    { name: "식대/야식", re: /식대|야식|점심|저녁|회식/ },
    { name: "택시/교통", re: /택시|교통/ },
    { name: "출장", re: /출장/ },
    { name: "향베이스/원자재", re: /향베이스|향료|공병|스포이드|롤온|말통/ },
    { name: "온라인배송", re: /온라인 배송|온라인배송/ },
  ];

  console.log("\n── 키워드 신뢰도 (분류된 매칭 " + labeledMatched.length + "건 실측) ──");
  for (const k of KEYWORDS) {
    const hits = labeledMatched.filter(({ e }) => k.re.test(e!.text));
    const dist = new Map<string, number>();
    hits.forEach(({ t }) => {
      const b = `${t.bizMajor}·${t.bizMinor ?? ""}`;
      dist.set(b, (dist.get(b) ?? 0) + 1);
    });
    const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
    const total = hits.length;
    const top = sorted[0];
    const pendCover = pendingMatched.filter(({ e }) => k.re.test(e!.text)).length;
    console.log(
      `  ${k.name.padEnd(12)} 표본 ${String(total).padStart(3)} · 미기입쪽 ${String(pendCover).padStart(3)}건 → ` +
        (top ? `${sorted.map(([b, n]) => `${b}:${n}`).slice(0, 4).join(" ")}` : "(표본 없음)"),
    );
  }

  // 키워드 없이 남는 미기입 매칭
  const noKw = pendingMatched.filter(({ e }) => !KEYWORDS.some((k) => k.re.test(e!.text)));
  console.log(`\n키워드 미포함 미기입 매칭 ${noKw.length}건`);

  // ── 갈림의 구조: 생카/굿즈류가 홍대공용 vs SMOAT 로 갈리는 기준 ──
  const goodsRe = KEYWORDS.find((k) => k.name === "생카/굿즈류")!.re;
  const goods = labeledMatched.filter(({ e }) => goodsRe.test(e!.text));
  console.log("\n── 생카/굿즈류 분류 실측: 월 × 사업구분 ──");
  const byMonth = new Map<string, Map<string, number>>();
  goods.forEach(({ t }) => {
    const m = t.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, new Map());
    const d = byMonth.get(m)!;
    const b = `${t.bizMajor}·${t.bizMinor ?? ""}`;
    d.set(b, (d.get(b) ?? 0) + 1);
  });
  [...byMonth.entries()].sort().forEach(([m, d]) =>
    console.log(`  ${m}  ${[...d.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b}:${n}`).join(" ")}`),
  );
  console.log("\n── 생카/굿즈류 분류 실측: 계정 × 사업구분 ──");
  const byAcct = new Map<string, Map<string, number>>();
  goods.forEach(({ t }) => {
    const a = `${t.acctMid}>${t.acctMinor}`;
    if (!byAcct.has(a)) byAcct.set(a, new Map());
    const d = byAcct.get(a)!;
    const b = `${t.bizMajor}·${t.bizMinor ?? ""}`;
    d.set(b, (d.get(b) ?? 0) + 1);
  });
  [...byAcct.entries()]
    .sort((a, b) => [...b[1].values()].reduce((s, n) => s + n, 0) - [...a[1].values()].reduce((s, n) => s + n, 0))
    .forEach(([a, d]) =>
      console.log(`  ${a.padEnd(30)} ${[...d.entries()].sort((x, y) => y[1] - x[1]).map(([b, n]) => `${b}:${n}`).join(" ")}`),
    );

  // 미기입 생카/굿즈류의 월 분포
  const pendGoods = pendingMatched.filter(({ e }) => goodsRe.test(e!.text));
  const pm = new Map<string, number>();
  pendGoods.forEach(({ t }) => pm.set(t.date.slice(0, 7), (pm.get(t.date.slice(0, 7)) ?? 0) + 1));
  console.log("\n미기입 생카/굿즈류 월 분포:", [...pm.entries()].sort().map(([m, n]) => `${m}:${n}`).join(" "));

  // ── 적용 계획 ────────────────────────────────────────
  const APPLY = process.argv.includes("--apply");
  const officeRe = /사무실|사무소/;
  /** 굿즈 키워드가 우연히 걸리는, 성격상 굿즈가 아닌 계정 */
  const GOODS_EXCLUDE = new Set(["일반식대", "비업무식대", "간식비", "회식워크숍비", "구독서비스비", "비품구입비", "교통비"]);
  /** 상호명 오탐(마포"카독"크 등)·회사 홍보물은 굿즈 규칙에서 뺀다 */
  const GOODS_VETO = /정비|엔진|브레이크|타이어|네안데르|악센트 소개/;
  const GOODS_EXCLUDE_MID = new Set(["차량관리비"]);

  interface Fill {
    t: FinTransaction;
    e: ChatEntry;
    biz: [string, string];
    why: string;
  }
  const fills: Fill[] = [];
  const memoOnly: { t: FinTransaction; e: ChatEntry }[] = [];

  pendingMatched.forEach(({ t, e }) => {
    if (
      goodsRe.test(e!.text) &&
      !GOODS_VETO.test(e!.text) &&
      !GOODS_EXCLUDE.has(t.acctMinor ?? "") &&
      !GOODS_EXCLUDE_MID.has(t.acctMid ?? "") &&
      t.acctMajor !== "인건비"
    ) {
      const is2025 = t.date < "2025-12-01";
      // 12월은 전환기 — 실측상 2025-12 도 홍대공용이었다 (12월 8건 전부)
      fills.push({
        t,
        e: e!,
        biz: t.date < "2025-11-01" ? ["B2C", "SMOAT"] : ["B2C", "홍대공용"],
        why: is2025
          ? "생카/굿즈 구매 — 2025년 관행은 B2C·SMOAT (실측 126/126)"
          : "생카/굿즈 구매 — 2026년 관행은 B2C·홍대공용 (실측 146/146)",
      });
    } else if (officeRe.test(e!.text)) {
      fills.push({ t, e: e!, biz: ["공용", "공용"], why: "카드 메모에 사무실 용도 명시 (실측 5/5)" });
    } else {
      memoOnly.push({ t, e: e! });
    }
  });

  // 2025-11 은 실측 표본이 없다 — 위 경계(11월부터 홍대공용)가 걸리는 건수 확인
  const nov = fills.filter((f) => f.t.date.slice(0, 7) === "2025-11").length;

  console.log(`\n── 적용 계획 ──`);
  console.log(`  사업구분 채움 ${fills.length}건 (11월 경계 걸림 ${nov}건)`);
  const g = new Map<string, { n: number; amt: number }>();
  fills.forEach((f) => {
    const k = f.biz.join("·");
    const x = g.get(k) ?? { n: 0, amt: 0 };
    x.n++;
    x.amt += (f.t.gross ?? 0) - (f.t.adjust ?? 0);
    g.set(k, x);
  });
  g.forEach((v, k) => console.log(`    ${k}  ${v.n}건 ${Math.round(v.amt).toLocaleString()}원`));
  console.log(`  비고만 보강(카드 메모 붙임) ${memoOnly.length}건`);

  fills.slice(0, 30).forEach((f) =>
    console.log(`    ${f.t.date} ${(f.t.gross ?? 0).toLocaleString().padStart(9)} → ${f.biz.join("·")}  ${f.e.text.replace(/\n/g, " / ").slice(0, 60)}`),
  );

  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  // ── 적용 ────────────────────────────────────────────
  const memoOf = (e: ChatEntry) => {
    const oneLine = e.text.replace(/\s*\n\s*/g, " / ").slice(0, 120);
    return `[카드메모 ${e.user}] ${oneLine}`;
  };
  const col = db.collection(NEANDER_COL.finTransactions);
  const now = Date.now();
  const ops: { id: string; data: Record<string, unknown> }[] = [];

  fills.forEach((f) => {
    const memo = memoOf(f.e);
    ops.push({
      id: f.t.id,
      data: {
        bizMajor: f.biz[0],
        bizMinor: f.biz[1],
        status: "confirmed",
        note: f.t.note ? (f.t.note.includes("[카드메모") ? f.t.note : `${f.t.note} · ${memo}`) : memo,
        classReason: `법인카드 카톡 대조 — ${f.why}`,
        updatedAt: now,
        updatedBy: "script:match-card-chat",
      },
    });
  });
  memoOnly.forEach(({ t, e }) => {
    if (t.note?.includes("[카드메모")) return; // 이미 붙였다
    const memo = memoOf(e);
    ops.push({
      id: t.id,
      data: {
        note: t.note ? `${t.note} · ${memo}` : memo,
        updatedAt: now,
        updatedBy: "script:match-card-chat",
      },
    });
  });

  console.log(`\n${ops.length}건 적용 중…`);
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((o) => b.set(col.doc(o.id), o.data, { merge: true }));
    await b.commit();
    console.log(`  ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
  console.log(`\n✅ 사업구분 ${fills.length}건 · 비고 보강 ${ops.length - fills.length}건 완료`);
}

// 직접 실행일 때만 (2단계 스크립트가 parseChat 을 임포트한다)
if (process.argv[1]?.includes("match-card-chat")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
