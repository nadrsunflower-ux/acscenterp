// ============================================================
//  2601~2604 이관 잔여 26건 정리 — 7월 기준 소급
// ------------------------------------------------------------
//  1~4월 장부를 흡수한 뒤 normalize(128건)·fix-accounts(135건)가 처리하지
//  못한 26건이 남았다 (카드대금결제 18건은 비손익이라 계정 불필요, 7월
//  환급 4건은 이전에 「그대로 두기」로 결정된 것 — 둘 다 대상 아님).
//
//  7월 실측과 정확히 같은 패턴이 있는 8건만 옮기고, 나머지 18건은
//  검토 대기함으로 보낸다. 각 매핑의 근거:
//
//   ① 캐시백 (1건 1,262원)
//      「프렌즈 체크카드 캐시백」 — 7월에 **같은 거래처**가
//      기타수입>기타잡수입>기타 로 들어가 있다 (7/10, 1,646원).
//
//   ② 부가세 → 부가가치세(VAT) (1건 4,386,580원)
//      재무비용>국세 → 세금공과>국세 이동은 이미 normalize 가 부가가치세
//      (VAT) 2건에 적용한 것과 동일한 개편 매핑. 잎 이름만 준말이다.
//
//   ③ 식대·복리후생 성격의 되돌아온 돈 (3건)
//      장부 전체에서 사람·배달앱의 식대 반환은 일관되게
//      수입|기타수입>환불수입>인건비환급 을 쓴다 (쿠팡이츠 6/10 10,900원,
//      「식대」 6/5 12,750원, 김주희 2/1 1,487,950원 등 40여 건).
//       - 복리후생비환급 (김주연 50,000 「5만원 식대 반환」)
//       - 일반식대 결제취소 (쿠팡이츠 17,000 — 6/10 쿠팡이츠와 동일 사례)
//       - 직원급여 수입 (유재영 6,650,000 「고려대환급」 — 사람 앞으로
//         들어온 인건비 환급은 전부 이 계정이다)
//
//   ④ 카카오모빌리티 택시 (1건 8,000원)
//      7월에 (주)카카오모빌리티 는 전부 기타비용>개인업무지원비>교통비
//      (7/16 22,000 · 7/22 40,000 · 7/27 6,500).
//
//   ⑤ 주최 예약금 입금 (1건 100,000원) — 거래유형 수입 → 자금거래
//      7월의 WOW(967)·WOW(630) 100,000원 「주최 예약금」 이 정확히
//      자금거래|예수금>예수금입금>예약금입금 이다. 같은 WOW(833) 채널,
//      같은 금액, 같은 메모(「주최예약금입금」). 예수금은 손익이 아니다.
//
//   ⑥ 가수금지급 (1건 5,000,000원) — 거래유형 지출 → 자금거래
//      마스터에 **같은 이름** 계정이 자금거래|가수금>가수금관리>가수금지급
//      으로 있다. 가수금(신촌매장 운영자금 가지급)은 성격상 손익이 아닌데
//      지출로 두면 3월 비용이 500만원 부풀려진다.
//
//   ⑦ 나머지 18건은 옮길 근거가 없다 → needs_review 로 올려 사람이 정한다.
//      - 인건비환급 지출 4건 (이우빈·유혜윤, 1·2월 초, 계 4,372,064원)
//        급여일 패턴이라 연말정산 환급 지급으로 보이지만 지출측 계정이 없다
//      - 출장비 4건 (제주항공×2·에이비제트·빌텍, 계 986,500원)
//        마스터의 유일한 출장 계정은 영업비>B2B출장비인데 B2B 출장이었는지
//        알 수 없다 (카카오모빌리티 1건만 7월 근거가 있어 ④로 처리)
//      - 자산투자비환급 지출 1건 (김주희 1,899,310원) — 지출인데 수입 계정
//      - 공과금 4건 (법원행정처 3·식약청 1, 계 16,259원)
//      - 와우판매 지출 1건 (이동주 500,000 「와현매」 — 매출 환불로 보이나 불확실)
//      - 복지비 1건 (150,000 — 비고가 「미상」)
//      - 기타 1건 (김주연 300,000 「센스애드 반환」)
//      - 개인지출 1건 (카카오페이 53,900 개인사용)
//      - 수수료 1건 (이지원고객님취소수수료 63,000)
//
//    npx tsx scripts/neander/fix-2601-2604-tail.ts            (미리보기)
//    npx tsx scripts/neander/fix-2601-2604-tail.ts --apply
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import type { FinTransaction } from "@/lib/neander/finance/types";

const APPLY = process.argv.includes("--apply");
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

interface Move {
  /** 거래 식별: 날짜 | 유형 | 계정경로 | 거래처 | 원금액 */
  key: [string, string, string, string, number];
  to: { txType?: string; acctMajor: string; acctMid: string; acctMinor: string };
  why: string;
}

const keyOf = (t: FinTransaction) =>
  [t.date, t.txType, `${t.acctMajor}>${t.acctMid}>${t.acctMinor}`, t.vendor ?? "", t.gross ?? 0].join("|");

const MOVES: Move[] = [
  {
    key: ["2026-01-12", "수입", "기타수입>이자수입>캐시백", "프렌즈 체크카드 캐시백", 1262],
    to: { acctMajor: "기타수입", acctMid: "기타잡수입", acctMinor: "기타" },
    why: "7월 같은 거래처(프렌즈 체크카드 캐시백)가 기타잡수입>기타",
  },
  {
    key: ["2026-01-26", "지출", "재무비용>국세>부가세", "I-지로국세청 서울지방국세부가세", 4386580],
    to: { acctMajor: "세금공과", acctMid: "국세", acctMinor: "부가가치세(VAT)" },
    why: "개편 매핑(재무비용>국세 → 세금공과>국세)은 기존 정규화와 동일, 잎은 준말",
  },
  {
    key: ["2026-01-06", "수입", "기타수입>환불수입>복리후생비환급", "김주연", 50000],
    to: { acctMajor: "기타수입", acctMid: "환불수입", acctMinor: "인건비환급" },
    why: "식대 반환은 장부 전체에서 환불수입>인건비환급 (동일 관행 40여 건)",
  },
  {
    key: ["2026-01-31", "수입", "인건비>복리후생비>일반식대", "쿠팡이츠", 17000],
    to: { acctMajor: "기타수입", acctMid: "환불수입", acctMinor: "인건비환급" },
    why: "6/10 쿠팡이츠 결제취소 수입과 동일 사례 (환불수입>인건비환급)",
  },
  {
    key: ["2026-02-28", "수입", "인건비>급여>직원급여", "유재영", 6650000],
    to: { acctMajor: "기타수입", acctMid: "환불수입", acctMinor: "인건비환급" },
    why: "사람 앞 인건비 환급 수입은 일관되게 환불수입>인건비환급 (김주희 2/1 1,487,950 등)",
  },
  {
    key: ["2026-04-20", "지출", "운영비>일반운영비>출장비", "(주)카카오모빌리티", 8000],
    to: { acctMajor: "기타비용", acctMid: "개인업무지원비", acctMinor: "교통비" },
    why: "7월 (주)카카오모빌리티 3건 전부 개인업무지원비>교통비",
  },
  {
    key: ["2026-03-23", "수입", "기타지출>환불지출>예약금환불", "WOW(833)", 100000],
    to: { txType: "자금거래", acctMajor: "예수금", acctMid: "예수금입금", acctMinor: "예약금입금" },
    why: "7월 WOW(967)·WOW(630) 주최 예약금 100,000 과 동일 패턴 — 예수금 입금 (비손익)",
  },
  {
    key: ["2026-03-22", "지출", "재무비용>자금이체관리>가수금지급", "유재영신촌매장가수금", 5000000],
    to: { txType: "자금거래", acctMajor: "가수금", acctMid: "가수금관리", acctMinor: "가수금지급" },
    why: "마스터의 동명 계정이 자금거래|가수금>가수금관리>가수금지급 — 가수금은 비손익",
  },
];

/** 검토 대기로 보낼 것: 날짜|유형|경로|거래처|원금액 */
const REVIEW: [string, string, string, string, number][] = [
  ["2026-01-01", "지출", "인건비>인건비환급(차감)>인건비환급", "이우빈", 998041],
  ["2026-01-01", "지출", "인건비>인건비환급(차감)>인건비환급", "유혜윤", 986340],
  ["2026-02-01", "지출", "인건비>인건비환급(차감)>인건비환급", "이우빈", 952825],
  ["2026-02-01", "지출", "인건비>인건비환급(차감)>인건비환급", "유혜윤", 1434858],
  ["2026-01-02", "지출", "기타수입>환불수입>자산투자비환급", "김주희", 1899310],
  ["2026-03-12", "지출", "운영비>일반운영비>출장비", "(주)제주항공  BSP", 477800],
  ["2026-03-12", "지출", "운영비>일반운영비>출장비", "(주)제주항공  BSP", 477800],
  ["2026-03-13", "지출", "운영비>일반운영비>출장비", "에이비제트 주식회사", 18900],
  ["2026-03-17", "지출", "운영비>일반운영비>출장비", "(주)빌텍 중소벤처기업 연수원점", 12000],
  ["2026-03-09", "지출", "재무비용>회계세무관리비>공과금", "법원행정처", 1000],
  ["2026-03-09", "지출", "재무비용>회계세무관리비>공과금", "법원행정처", 3000],
  ["2026-03-09", "지출", "재무비용>회계세무관리비>공과금", "법원행정처", 3000],
  ["2026-04-10", "지출", "재무비용>회계세무관리비>공과금", "식품의약품안전청", 9259],
  ["2026-03-22", "지출", "매출>B2C매출>와우판매", "이동주", 500000],
  ["2026-02-11", "지출", "인건비>복리후생비>복지비", "복지", 150000],
  ["2026-02-04", "지출", "기타비용>개인업무지원비>기타", "김주연", 300000],
  ["2026-01-28", "지출", "기타비용>개인업무지원비>개인지출", "카카오페이", 53900],
  ["2026-01-19", "지출", "재무비용>금융비용>수수료", "이지원고객님취소수수료", 63000],
];
// 법원행정처 3,000원이 같은 날 2건이라 키가 겹친다 — 아래에서 건수로 처리한다.

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
  const snap = await db.collection(NEANDER_COL.finTransactions).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FinTransaction[];
  const byKey = new Map<string, FinTransaction[]>();
  all.forEach((t) => {
    const k = keyOf(t);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  });

  const ops: { id: string; data: Record<string, unknown>; label: string }[] = [];
  let missing = 0;

  console.log("── 이관 (7월 실측 근거) ──────────────────────────");
  for (const m of MOVES) {
    const k = m.key.join("|");
    const hits = byKey.get(k) ?? [];
    if (hits.length !== 1) {
      console.log(`  ⚠️  ${hits.length}건 매칭 (1건이어야 함): ${k}`);
      missing++;
      continue;
    }
    const t = hits[0];
    const data: Record<string, unknown> = {
      acctMajor: m.to.acctMajor,
      acctMid: m.to.acctMid,
      acctMinor: m.to.acctMinor,
      status: "confirmed",
      classReason: `2601~2604 이관 소급 — ${m.why}`,
      updatedAt: Date.now(),
      updatedBy: "fix-2601-2604-tail",
    };
    if (m.to.txType) {
      data.txType = m.to.txType;
      // 비손익으로 옮기면 사업구분은 백필 규칙이 다시 정한다
      if (m.to.txType === "자금거래") {
        data.bizMajor = "해당없음";
        data.bizMinor = "해당없음";
      }
    }
    ops.push({ id: t.id, data, label: `${t.date} ${t.vendor} ${fmt(t.gross ?? 0)}` });
    console.log(`  ✓ ${t.date} ${String(t.vendor).slice(0, 20).padEnd(20)} ${fmt(t.gross ?? 0).padStart(10)}  → ${m.to.txType ? m.to.txType + "|" : ""}${m.to.acctMajor}>${m.to.acctMid}>${m.to.acctMinor}`);
  }

  console.log("\n── 검토 대기로 (근거 없음 — 사람이 정함) ─────────");
  // 같은 키가 REVIEW 에 n번 나오면 매칭 거래 n건까지 처리한다 (법원행정처 3,000 × 2)
  const wanted = new Map<string, number>();
  REVIEW.forEach((r) => wanted.set(r.join("|"), (wanted.get(r.join("|")) ?? 0) + 1));
  for (const [k, n] of wanted) {
    const hits = byKey.get(k) ?? [];
    if (hits.length < n) {
      console.log(`  ⚠️  ${hits.length}건 매칭 (${n}건 기대): ${k}`);
      missing++;
    }
    hits.slice(0, n).forEach((t) => {
      ops.push({
        id: t.id,
        data: {
          status: "needs_review",
          classReason: `개편 전 계정 「${t.acctMajor}>${t.acctMid}>${t.acctMinor}」 — 7월 기준에 대응 근거가 없어 사람이 정해야 함`,
          updatedAt: Date.now(),
          updatedBy: "fix-2601-2604-tail",
        },
        label: `${t.date} ${t.vendor}`,
      });
      console.log(`  → ${t.date} ${String(t.vendor).slice(0, 24).padEnd(24)} ${fmt(t.gross ?? 0).padStart(10)}  ${t.acctMajor}>${t.acctMid}>${t.acctMinor}`);
    });
  }

  console.log(`\n이관 ${MOVES.length - missing >= 0 ? ops.filter((o) => o.data.acctMajor).length : 0}건 · 검토 대기 ${ops.filter((o) => !o.data.acctMajor).length}건 · 매칭 실패 ${missing}건`);

  if (missing > 0) {
    console.log("\n❌ 매칭이 어긋나서 중단합니다. 키를 다시 확인하세요.");
    process.exit(1);
  }
  if (!APPLY) {
    console.log("\n※ 미리보기입니다. 실제로 쓰려면 --apply 를 붙이세요.");
    process.exit(0);
  }

  const batch = db.batch();
  ops.forEach((o) => batch.set(db.collection(NEANDER_COL.finTransactions).doc(o.id), o.data, { merge: true }));
  await batch.commit();
  console.log(`\n✅ ${ops.length}건 갱신 완료`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
