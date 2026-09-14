// ============================================================
//  2026-08 이벤트 — 노션 행사 체크리스트를 이벤트 입력에 옮긴다
// ------------------------------------------------------------
//  이벤트 입력 화면의 「저장」과 같은 길을 간다 (api/neander/sales/mutate
//  의 event.upsert): normalizeEvent → 문서 쓰기 → reattachEventLines 로
//  그 기간의 판매 줄을 다시 붙인다. 그래서 **판매 파일을 먼저 적재한 뒤**
//  돌려야 귀속 수가 의미가 있다.
//
//  노션에는 준비물 **이름**만 있고 금액이 없다. 체크된 품목을 단가 0 줄로
//  넣어 두고, 단가는 사람이 이벤트 입력 › 준비물 탭에서 채운다. 체크 안 된
//  품목(주로 배너)은 메모에 남긴다.
//
//  운영시간·스태프·시급은 기존 이벤트의 값을 따른다
//  (와우 8시간·1명 · 아이디 7시간·0명 · 시급 10,000).
//
//    npx tsx scripts/neander/seed-2608-events.ts          # 미리보기
//    npx tsx scripts/neander/seed-2608-events.ts --apply  # 반영
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NEANDER_COL } from "@/lib/neander/collections";
import { reattachEventLines } from "@/lib/neander/sales/server/attach";
import { normalizeEvent, type SalesEvent, type SalesStore } from "@/lib/neander/sales/types";

const APPLY = process.argv.includes("--apply");
const BY = "seed-2608-events";

interface Src {
  id: string;
  store: SalesStore;
  name: string;
  from: string;
  to: string;
  /** 체크된 준비물 */
  done: string[];
  /** 체크 안 된 준비물 */
  todo?: string[];
  note?: string;
}

const EVENTS: Src[] = [
  {
    id: "WE-062", store: "wow", name: "크래비티 성민", from: "2026-07-31", to: "2026-08-01",
    done: ["향스 & 사스", "엽서", "포카", "초대장", "스티커", "하트뱃지", "문고리", "키링", "아이디카드", "[인화] 디피용 인화사진", "[인화] 맥배경 A3"],
    todo: ["배너"],
    note: "시그니처 9번",
  },
  {
    id: "WE-063", store: "wow", name: "VERIVERY 동한", from: "2026-08-03", to: "2026-08-04",
    done: ["배너", "시향지", "향스&사스", "맥 배경화면(인화로 대체)", "시향존 png"],
    todo: ["미디어아트 활용 자료"],
    note: "주최 전용 · 최소 기준 · 시그니처 9번 · 오픈채팅: VERIVERY 동한8/4",
  },
  {
    id: "ID-028", store: "id", name: "세븐틴 에스쿱스", from: "2026-08-07", to: "2026-08-08",
    done: ["사스", "엽서", "포카", "네임택", "자석스티커", "슬로건", "피규어디퓨저용 피규어(22)", "피규어디퓨저용 후지", "피규어디퓨저용 스쿱 팻말(22)", "팻말용 하트모양 스티커", "말랑이포카홀더", "네컷사진", "아크릴집게", "[인화] 디피용 인화사진", "리무버블스티커"],
    todo: ["배너"],
    note: "시그니처 23번",
  },
  {
    id: "WE-064", store: "wow", name: "인디가수 미래", from: "2026-08-07", to: "2026-08-08",
    done: ["시향지", "향스/사스"],
    todo: ["배너"],
    note: "주최 전용 · 최소 기준 · 시그니처 2번 · 오픈채팅: 8/7~8/8",
  },
  {
    id: "WE-065", store: "wow", name: "보이넥스트도어 태산", from: "2026-08-09", to: "2026-08-11",
    done: ["향스 & 사스", "엽서", "포카", "명함", "증사", "투명포카", "피규어디퓨저용 피규어", "피규어디퓨저용 후지", "티셔츠모양키링용 사진", "탯냥이 팻말(22)", "종이부채", "거울버튼", "아크릴 마그넷", "[인화] 디피용 인화사진", "맥 A3", "폴라팩",
      "[럭키드로우] 반팔티셔츠(2장)", "[럭키드로우] 핀버튼 2종(원형·하트 각 10)", "[럭키드로우] 카드스티커(6세트 12장)", "[럭키드로우] 떡메모지", "[럭키드로우] 폴라팩(5세트)"],
    todo: ["배너", "[럭키드로우] 시그니처 퍼퓸 10ml(29번 5 · 9번 5)", "[럭키드로우] 거울 버튼(선착 6 + 추가 14)"],
    note: "시그니처 25번 · 럭키드로우 진행",
  },
  {
    id: "ID-029", store: "id", name: "황민현", from: "2026-08-09", to: "2026-08-10",
    done: ["향스 사스", "배너", "엽서", "포카", "시향지", "북마크", "통자석스티커", "띠부스티커", "핀버튼", "아크릴뱃지", "문고리", "회원증카드", "[인화] 디피용 사진", "디피용 현수막"],
    note: "시그니처 23번 · 황민현픽 19번(50ml)",
  },
  {
    id: "WE-066", store: "wow", name: "NCT DREAM 재민", from: "2026-08-12", to: "2026-08-13",
    done: ["구슬줄", "사스", "엽서", "포카", "네컷사진", "티켓", "피규어디퓨저용 피규어(32)", "피규어디퓨저용 후지", "키링용 사진", "피규어디퓨저용 팝콘 팟(8)", "틴케이스", "열쇠키링(9)", "열쇠키링용 구슬줄(9)", "디피사진"],
    todo: ["배너"],
    note: "시그니처 18번",
  },
  {
    id: "WE-067", store: "wow", name: "LUCY 조원상", from: "2026-08-14", to: "2026-08-15",
    done: ["사스 향스", "엽서", "포카", "떡메", "책갈피", "스티커", "계란형버튼뱃지", "피규어디퓨저용 피규어", "피규어디퓨저용 후지", "키링", "발바닥말랑이", "opp봉투", "말랑이용 헤더택", "증사봉투 + 증명사진", "[인화] 디피용 인화사진", "맥"],
    todo: ["배너"],
    note: "시그니처 4번",
  },
  {
    id: "WE-068", store: "wow", name: "배우 정수빈", from: "2026-08-16", to: "2026-08-17",
    done: ["시향지", "향스"],
    todo: ["배너", "피규어디퓨저", "[미디어아트] 편지존&메시지", "[미디어아트] AI 시향존", "[미디어아트] 미디어아트존", "맥"],
    note: "주최 전용 · 최소 기준 · 오픈채팅: 생일이벤트",
  },
  {
    id: "ID-030", store: "id", name: "지드래곤", from: "2026-08-16", to: "2026-08-18",
    done: ["시향지", "포토카드", "스티커 2종", "향스", "데코 사진", "누피포카"],
    todo: ["배너", "사이니지", "벽 쪽 현수막"],
    note: "포도알 협업",
  },
  {
    id: "WE-069", store: "wow", name: "트레저 아사히", from: "2026-08-19", to: "2026-08-20",
    done: ["향스 사스", "엽서", "포카", "증사", "네컷사진", "아크릴집게", "아이디카드", "아크릴코롯토", "[인화] 디피사진", "[인화] A3 맥배경"],
    todo: ["배너"],
    note: "시그니처 18번",
  },
  {
    id: "WE-070", store: "wow", name: "DAY6 도운", from: "2026-08-23", to: "2026-08-25",
    done: ["사스", "엽서", "포카", "스티커 2종", "명함", "만화책키링(50)", "만화책키링용 스티커(50)", "피규어디퓨저용 피규어(50)", "피규어디퓨저용 후지(50)", "거울버튼", "말랑키링", "샤카뱃지", "모양쿠션", "[인화] 디피사진", "[인화] A3 맥배경"],
    todo: ["배너"],
    note: "시그니처 12번",
  },
];

function toEvent(s: Src): SalesEvent {
  const note = [s.note, s.todo?.length ? `노션 미완료: ${s.todo.join(", ")}` : "", "준비물 단가 미입력(노션에 금액 없음)"]
    .filter(Boolean)
    .join(" · ");
  return normalizeEvent({
    id: s.id,
    store: s.store,
    name: s.name,
    from: s.from,
    to: s.to,
    hoursPerDay: s.store === "wow" ? 8 : 7,
    staff: s.store === "wow" ? 1 : 0,
    wage: 10000,
    supplies: 0,
    supplyItems: s.done.map((name) => ({ name, qty: 1, unitPrice: 0 })),
    note,
  });
}

async function main() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("FIREBASE_SERVICE_ACCOUNT_B64 가 없습니다 (.env.local 확인).");
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
  }
  const db = getFirestore();
  const col = db.collection(NEANDER_COL.salesEvents);

  // 코드 충돌·같은 이벤트 중복을 먼저 본다 — 덮어쓰면 사람이 적은 것이 사라진다
  const existing = (await col.get()).docs.map((d) => ({ id: d.id, ...d.data() }) as SalesEvent);
  const clash = EVENTS.filter((s) =>
    existing.some((e) => e.id === s.id || (e.store === s.store && e.from === s.from && e.name.replace(/\s/g, "") === s.name.replace(/\s/g, ""))),
  );
  if (clash.length) {
    throw new Error(`이미 있는 코드·이벤트: ${clash.map((c) => `${c.id} ${c.name}`).join(", ")} — 중단`);
  }

  for (const s of EVENTS) {
    const ev = toEvent(s);
    console.log(`${ev.id} [${ev.store}] ${ev.name} ${ev.from}~${ev.to} · 준비물 ${ev.supplyItems?.length ?? 0}줄 · ${ev.note}`);
    if (!APPLY) continue;
    const now = Date.now();
    await col.doc(ev.id).set({
      ...ev,
      visits: null,
      buyers: null,
      nonBuyers: null,
      createdAt: now,
      updatedAt: now,
      updatedBy: BY,
    });
    const r = await reattachEventLines(db, ev, null, now);
    console.log(`   → 판매 ${r.attached}줄 귀속 · ${r.detached}줄 해제 · ${r.resolved}줄 상품 확정`);
  }
  if (!APPLY) console.log("\n미리보기입니다. --apply 를 붙이면 반영합니다.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
