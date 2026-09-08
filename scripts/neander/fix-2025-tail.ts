// ============================================================
//  2025 연말결산 통합거래장 이관 잔여 정리 — 7월 기준 소급
// ------------------------------------------------------------
//  (0106최종)통합거래장_v9 를 흡수한 뒤 normalize(601건)·fix-accounts
//  (397건)가 처리하지 못한 잔여를 정리한다. 각 매핑의 근거:
//
//   ① 전기수도요금 → 전기수도통신비 (23건, 중분류 유지)
//      와우·아이디·일반운영비 각 중분류에 현행 잎이 있다. 홍대공용은
//      fix-accounts ②가 이미 같은 개명을 적용했다.
//
//   ② 가수금입금 9건(수입 5,290만)·가수금지급 11건(지출 1,973만)
//      → 자금거래|가수금>가수금관리>가수금입금/가수금지급
//      마스터에 **같은 이름** 계정이 자금거래로 있다. 유재영 대표 가수금
//      (회사에 넣었다 뺐다 하는 돈)은 손익이 아니다. 신고 재무제표(매출
//      4.0억)와 장부 수입(9.3억)의 괴리 상당 부분이 이런 자금성 입금이다.
//
//   ③ 예약금입금 수입 11건 → 자금거래|예수금>예수금입금>예약금입금
//      전부 개인 이름 앞 100,000원 — 2026-07 실측의 주최 예약금 패턴
//      (WOW(967) 등 100,000원)과 동일. 예수금은 손익이 아니다.
//
//   ④ 가수금관리>예약금지급 지출 2건 → 기타지출>환불지출>예약금환불
//      fix-accounts ③(자금이체관리>예약금지급)과 같은 성격, 중분류만 다르다.
//
//   ⑤ 거래보증금지급 1건(홍채민(루너스) 1,100만)
//      → 자금거래|보증금>보증금지급>거래보증금지급 — 마스터 동명 계정.
//
//   ⑥ 차량구입비 2건((주)뉴카카 1,066만) → 자산투자비>차량자산투자비>차량
//      마스터의 유일한 차량 자산 계정 (FA-016).
//
//   ⑦ 공증수수료 17건 → 재무비용>회계법무비>공증비
//      전부 법원행정처 제증명·공동인증서 수수료. 2025 장부 스스로
//      「공증」 계열로 분류했고, 현행 마스터의 대응 잎은 공증비뿐이다.
//
//   ⑧ 대출이자 5건 → 재무비용>금융비용>이자비용 (같은 중분류 안의 개명)
//
//   ⑨ 장비대여비 1건 → 기획·전시비>전시설치운영비>장비렌탈비
//      normalize 가 장비렌탈비 3건에 적용한 것과 같은 개편 매핑.
//
//   ⑩ 웹개발비 수입 2건(크래커스 660만) → 매출>B2B매출>웹프로그램제작대행
//      외부 고객(크래커스 스튜디오)의 개발 대금 = B2B 매출.
//
//   ⑪ 급여차액 3건(10/31 차액 지급) → 사람별 급여 계정
//      이동주·유선화는 임원급여, 유다혜는 직원급여 — 장부 전체의
//      사람별 급여 구분을 그대로 따른다.
//
//   ⑫ 날짜 오타로 파서가 버린 1행을 수동 삽입: 2025-12-01 OTP수수료
//      10,000원 (원본 「202512.01」, 지출|재무비용>금융비용>금융수수료).
//
//   ⑬ 근거 없는 것은 검토 대기로 — 사람이 정한다:
//      - 신촌운영비>임차료 9건 2,570만 (씨케이글로벌) — 개편 때 신촌운영비
//        중분류가 마스터에서 통째로 빠졌다. 계정을 되살릴지, 다른 중분류에
//        옮길지 사람 결정 필요.
//      - 일반운영비>인테리어유지비 3건 — 현행 잎은 매장별(아이디·와우·
//        홍대공용)에만 있어 어느 매장인지 알 수 없다.
//      - 수선유지비 1건 (포토프린터 수리) — 대응 잎 없음.
//
//    npx tsx scripts/neander/fix-2025-tail.ts            (미리보기)
//    npx tsx scripts/neander/fix-2025-tail.ts --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { dedupHashOf, type FinTransaction, type TxType } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 2025년(및 2024-12) 행만 건드린다 — 2026년은 이미 정리됐다 */
const inScope = (t: FinTransaction) => (t.date ?? "") < "2026-01-01";

interface GroupMove {
  name: string;
  match: (t: FinTransaction) => boolean;
  to: { txType?: TxType; acctMajor: string; acctMid: string; acctMinor: string };
  why: string;
  expect: number;
}

const MOVES: GroupMove[] = [
  {
    name: "① 전기수도요금(와우)",
    match: (t) => t.acctMid === "와우운영비" && t.acctMinor === "전기수도요금",
    to: { acctMajor: "운영비", acctMid: "와우운영비", acctMinor: "전기수도통신비" },
    why: "중분류 유지 개명 — 홍대공용에 이미 적용된 것과 동일",
    expect: 10,
  },
  {
    name: "① 전기수도요금(일반)",
    match: (t) => t.acctMid === "일반운영비" && t.acctMinor === "전기수도요금",
    to: { acctMajor: "운영비", acctMid: "일반운영비", acctMinor: "전기수도통신비" },
    why: "중분류 유지 개명",
    expect: 10,
  },
  {
    name: "① 전기수도요금(아이디)",
    match: (t) => t.acctMid === "아이디운영비" && t.acctMinor === "전기수도요금",
    to: { acctMajor: "운영비", acctMid: "아이디운영비", acctMinor: "전기수도통신비" },
    why: "중분류 유지 개명",
    expect: 3,
  },
  {
    name: "② 가수금입금",
    match: (t) => t.txType === "수입" && t.acctMinor === "가수금입금",
    to: { txType: "자금거래", acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금입금" },
    why: "마스터 동명 계정이 자금거래 — 가수금은 비손익",
    expect: 9,
  },
  {
    name: "② 가수금지급",
    match: (t) => t.txType === "지출" && t.acctMinor === "가수금지급",
    to: { txType: "자금거래", acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급" },
    why: "마스터 동명 계정이 자금거래 — 가수금은 비손익",
    expect: 11,
  },
  {
    name: "③ 예약금입금(수입)",
    match: (t) => t.txType === "수입" && t.acctMinor === "예약금입금",
    to: { txType: "자금거래", acctMajor: "예수금", acctMid: "예수금입금", acctMinor: "예약금입금" },
    why: "2026-07 주최 예약금 100,000원 패턴과 동일 — 예수금은 비손익",
    expect: 11,
  },
  {
    name: "④ 예약금지급(가수금관리)",
    match: (t) => t.txType === "지출" && t.acctMid === "가수금관리" && t.acctMinor === "예약금지급",
    to: { acctMajor: "기타지출", acctMid: "환불지출", acctMinor: "예약금환불" },
    why: "fix-accounts ③과 같은 성격 (중분류만 다름)",
    expect: 2,
  },
  {
    name: "⑤ 거래보증금지급",
    match: (t) => t.txType === "지출" && t.acctMinor === "거래보증금지급",
    to: { txType: "자금거래", acctMajor: "보증금", acctMid: "보증금지급", acctMinor: "거래보증금지급" },
    why: "마스터 동명 계정이 자금거래 — 보증금은 회수 대상, 비손익",
    expect: 1,
  },
  {
    name: "⑥ 차량구입비",
    match: (t) => t.acctMinor === "차량구입비",
    to: { acctMajor: "자산투자비", acctMid: "차량자산투자비", acctMinor: "차량" },
    why: "마스터의 유일한 차량 자산 계정 (FA-016)",
    expect: 2,
  },
  {
    name: "⑦ 공증수수료",
    match: (t) => t.acctMinor === "공증수수료",
    to: { acctMajor: "재무비용", acctMid: "회계법무비", acctMinor: "공증비" },
    why: "법원행정처 제증명·인증서 수수료 — 현행 대응 잎은 공증비뿐",
    expect: 17,
  },
  {
    name: "⑧ 대출이자",
    match: (t) => t.acctMinor === "대출이자",
    to: { acctMajor: "재무비용", acctMid: "금융비용", acctMinor: "이자비용" },
    why: "같은 중분류 안의 개명",
    expect: 5,
  },
  {
    name: "⑨ 장비대여비",
    match: (t) => t.acctMinor === "장비대여비",
    to: { acctMajor: "기획·전시비", acctMid: "전시설치운영비", acctMinor: "장비렌탈비" },
    why: "normalize 가 장비렌탈비에 적용한 개편 매핑과 동일",
    expect: 1,
  },
  {
    name: "⑩ 웹개발비(수입)",
    match: (t) => t.txType === "수입" && t.acctMinor === "웹개발비",
    to: { acctMajor: "매출", acctMid: "B2B매출", acctMinor: "웹프로그램제작대행" },
    why: "외부 고객 개발 대금 = B2B 매출 (SL-044)",
    expect: 2,
  },
  {
    name: "⑪ 급여차액(임원)",
    match: (t) => t.acctMinor === "급여차액" && ["이동주", "유선화"].includes(t.vendor ?? ""),
    to: { acctMajor: "인건비", acctMid: "급여", acctMinor: "임원급여" },
    why: "장부 전체에서 이동주·유선화는 임원급여",
    expect: 2,
  },
  {
    name: "⑪ 급여차액(직원)",
    match: (t) => t.acctMinor === "급여차액" && t.vendor === "유다혜",
    to: { acctMajor: "인건비", acctMid: "급여", acctMinor: "직원급여" },
    why: "유다혜는 직원급여",
    expect: 1,
  },
];

interface ReviewGroup {
  name: string;
  match: (t: FinTransaction) => boolean;
  reason: string;
  expect: number;
}

const REVIEWS: ReviewGroup[] = [
  {
    name: "신촌운영비>임차료",
    match: (t) => t.acctMid === "신촌운영비" && t.acctMinor === "임차료",
    reason: "개편 때 신촌운영비 중분류가 마스터에서 빠짐 — 계정을 되살릴지 사람이 정해야 함",
    expect: 9,
  },
  {
    name: "일반운영비>인테리어유지비",
    match: (t) => t.acctMid === "일반운영비" && t.acctMinor === "인테리어유지비",
    reason: "현행 잎은 매장별(아이디·와우·홍대공용)뿐 — 어느 매장인지 사람이 정해야 함",
    expect: 3,
  },
  {
    name: "수선유지비",
    match: (t) => t.acctMinor === "수선유지비",
    reason: "현행 마스터에 대응 잎 없음 (포토프린터 수리) — 사람이 정해야 함",
    expect: 1,
  },
];

/** ⑫ 날짜 오타(202512.01)로 파서가 버린 행 — 원본 값 그대로 */
const MANUAL_INSERT = {
  date: "2025-12-01",
  datetime: "2025-12-01 14:28:36",
  last4: "1769",
  txType: "지출" as TxType,
  acctMajor: "재무비용",
  acctMid: "금융비용",
  acctMinor: "금융수수료",
  vendor: "OTP수수료",
  gross: 10000,
  adjust: 0,
  note: "연말결산 v9 7147행 — 거래일시 「202512.01」 오타를 보정해 수동 삽입",
  status: "confirmed",
  classReason: "원본 장부에 분류 완비 (FI-023) — 날짜 오타만 보정",
};

function init() {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  initializeApp({
    credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
  });
}

(async () => {
  init();
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.finTransactions);
  const snap = await col.get();
  const all = (snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[]).filter(inScope);

  const ops: { id: string; data: Record<string, unknown> }[] = [];
  let mismatch = 0;

  console.log("── 이관 ──────────────────────────────────────────");
  for (const m of MOVES) {
    const rows = all.filter(m.match);
    const amt = rows.reduce((s, t) => s + ((t.gross ?? 0) - (t.adjust ?? 0)), 0);
    const flag = rows.length === m.expect ? "✓" : "⚠️";
    if (rows.length !== m.expect) mismatch++;
    console.log(
      `  ${flag} ${m.name.padEnd(24)} ${String(rows.length).padStart(3)}건(기대 ${m.expect}) ${fmt(amt).padStart(12)}  → ${m.to.txType ? m.to.txType + "|" : ""}${m.to.acctMajor}>${m.to.acctMid}>${m.to.acctMinor}`,
    );
    rows.forEach((t) => {
      const data: Record<string, unknown> = {
        acctMajor: m.to.acctMajor,
        acctMid: m.to.acctMid,
        acctMinor: m.to.acctMinor,
        status: "confirmed",
        classReason: `2025 이관 소급 — ${m.why}`,
        updatedAt: Date.now(),
        updatedBy: "fix-2025-tail",
      };
      if (m.to.txType) {
        data.txType = m.to.txType;
        if (m.to.txType === "자금거래") {
          data.bizMajor = "해당없음";
          data.bizMinor = "해당없음";
        }
      }
      ops.push({ id: t.id, data });
    });
  }

  console.log("\n── 검토 대기로 ────────────────────────────────────");
  for (const r of REVIEWS) {
    const rows = all.filter(r.match);
    const amt = rows.reduce((s, t) => s + ((t.gross ?? 0) - (t.adjust ?? 0)), 0);
    const flag = rows.length === r.expect ? "✓" : "⚠️";
    if (rows.length !== r.expect) mismatch++;
    console.log(`  ${flag} ${r.name.padEnd(24)} ${String(rows.length).padStart(3)}건(기대 ${r.expect}) ${fmt(amt).padStart(12)}`);
    rows.forEach((t) =>
      ops.push({
        id: t.id,
        data: {
          status: "needs_review",
          classReason: r.reason,
          updatedAt: Date.now(),
          updatedBy: "fix-2025-tail",
        },
      }),
    );
  }

  // ⑫ 수동 삽입 — 이미 넣었으면 건너뛴다
  const hash = dedupHashOf({
    date: MANUAL_INSERT.date,
    last4: MANUAL_INSERT.last4,
    vendor: MANUAL_INSERT.vendor,
    gross: MANUAL_INSERT.gross,
    txType: MANUAL_INSERT.txType,
  });
  const already = all.some((t) => t.dedupHash === hash);
  console.log(`\n── 수동 삽입 ─────────────────────────────────────`);
  console.log(`  ${already ? "―" : "✓"} 2025-12-01 OTP수수료 10,000 ${already ? "(이미 있음 — 건너뜀)" : "→ 지출|재무비용>금융비용>금융수수료"}`);

  console.log(`\n갱신 ${ops.length}건 · 삽입 ${already ? 0 : 1}건${mismatch ? ` · ⚠️ 기대 건수 불일치 ${mismatch}종` : ""}`);
  if (mismatch > 0) {
    console.log("\n❌ 기대 건수가 어긋나 중단합니다. 조건을 다시 확인하세요.");
    process.exit(1);
  }
  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((o) => b.set(col.doc(o.id), o.data, { merge: true }));
    await b.commit();
    console.log(`  ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
  if (!already) {
    await col.add({ ...MANUAL_INSERT, dedupHash: hash, createdAt: Date.now(), updatedBy: "fix-2025-tail" });
  }
  console.log(`\n✅ 완료 — 갱신 ${ops.length}건, 삽입 ${already ? 0 : 1}건`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
