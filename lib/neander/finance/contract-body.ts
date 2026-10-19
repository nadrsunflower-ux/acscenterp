// ============================================================
//  계약서 본문 — 우리가 먼저 내미는 초안
// ------------------------------------------------------------
//  계약서는 오래 「보관만」 했다(docs.ts). 상대가 양식을 보내오고 우리는
//  도장 찍힌 PDF 를 붙여 두는 식이었다. 그런데 2026-04 오얼모얼 건을
//  돌아보니 문제의 절반이 거기서 나왔다 — 상대가 쓴 계약서에는 우리 권리를
//  지키는 조항이 없었다(로열티가 별첨에만 있음 · 해지 조건이 한쪽으로 기움 ·
//  관할이 상대 소재지 · 금형 귀속이 없음). 그 회의의 결론이 「다음에는
//  우리가 초안을 먼저 낸다」 였다. 이 파일이 그 초안의 모양이다.
//
//  본문은 **조항의 배열**이다. 통짜 글이 아니라 조항으로 쪼개 두는 이유:
//   - 종이 위에서 조항 하나를 고치고, 끼워 넣고, 뺄 수 있다. 번호는
//     순서에서 나온다(제1조 … 제n조) — 손으로 다시 매기지 않는다.
//   - 비서가 고칠 때 「제8조를 이렇게」 라고 조항 단위로 제안하고, 사람은
//     그 조항의 전/후만 보고 승인한다. 통짜 글이면 어디가 바뀌었는지
//     계약서 전체를 다시 읽어야 한다.
//
//  사실은 **한 곳에만** 적는다. 상대방 이름·계약금액·기간은 「계약의 개요」
//  표에 한 번 나오고, 조항은 「계약의 개요에 적은 계약금액」 이라고 가리킨다.
//  옛 계약서들은 금액을 본문에 서너 번 되풀이했는데, 그러면 금액이 바뀐 날
//  한 군데가 반드시 남는다.
//
//  이 파일은 잎이다 — docs.ts 가 여기를 부르고, 여기는 docs.ts 를 부르지
//  않는다 (서로 부르면 저장 직전 정리가 순환 참조에 걸린다). docs.ts 에
//  기대는 계산은 contract.ts 에 있다.
// ============================================================

import { SEAL_IDS, canonicalSealId } from "./supplier";

// ---- 양식 --------------------------------------------------------

export const CONTRACT_TEMPLATE_IDS = ["service", "supply", "outsource", "collab"] as const;
export type ContractTemplateId = (typeof CONTRACT_TEMPLATE_IDS)[number];

/** 갑(a) · 을(b) */
export type ContractSide = "a" | "b";

export interface ContractTemplateMeta {
  id: ContractTemplateId;
  /** 고르는 자리에 보이는 이름 */
  label: string;
  /** 제목 끝에 붙는 말 — 「○○ 용역 계약서」 의 「용역」 */
  kind: string;
  /** 언제 쓰는가 */
  hint: string;
  /** 우리가 어느 쪽인가. 도장이 찍히는 쪽이다 */
  ourSide: ContractSide;
  roleA: string;
  roleB: string;
  /** 품목 표의 제목. 표를 쓰지 않는 양식이면 없다 */
  itemsTitle?: string;
  /** 어느 옛 계약서에서 왔는가 — 고르는 사람이 근거를 안다 */
  basis: string;
}

export const CONTRACT_TEMPLATES: ContractTemplateMeta[] = [
  {
    id: "service",
    label: "용역 계약서",
    kind: "용역",
    hint: "행사 운영 · 체험 프로그램 개발처럼 일을 해 주고 대금을 받을 때",
    ourSide: "b",
    roleA: "발주자",
    roleB: "수행자",
    basis: "2026 JIMFF OST페어 용역 계약서",
  },
  {
    id: "supply",
    label: "물품 납품 계약서",
    kind: "물품 납품",
    hint: "향수 · 사쉐 · 굿즈를 만들어 납품하고 대금을 받을 때",
    ourSide: "b",
    roleA: "발주자",
    roleB: "공급자",
    itemsTitle: "공급 품목",
    basis: "2026 JIMFF 키캡 키링 물품 납품 계약서",
  },
  {
    id: "outsource",
    label: "제작 위탁 계약서",
    kind: "제작 위탁",
    hint: "공장 · 외주 업체에 제작을 맡기고 우리가 대금을 줄 때",
    ourSide: "a",
    roleA: "위탁자",
    roleB: "수탁자",
    itemsTitle: "위탁 품목",
    basis: "유니비아 표준 계약서 · 2025 사쉐 건별 계약서/발주서",
  },
  {
    id: "collab",
    label: "IP 협업 계약서",
    kind: "IP 협업",
    hint: "캐릭터 · 아티스트 IP 로 상품을 만들어 팔고 로열티를 나눌 때",
    ourSide: "b",
    roleA: "IP 권리자",
    roleB: "제작 · 판매자",
    basis: "2026-04 오얼모얼 계약서 검토 · 「다음 IP 콜라보를 위한 원칙」",
  },
];

export const contractTemplate = (id: ContractTemplateId): ContractTemplateMeta =>
  CONTRACT_TEMPLATES.find((t) => t.id === id) ?? CONTRACT_TEMPLATES[0];

// ---- 본문 --------------------------------------------------------

/** 맺음말 아래 서명란의 한쪽 */
export interface ContractParty {
  /** 상호 */
  name: string;
  bizNo: string;
  address: string;
  /** 대표자 — 「집행위원장 장항준」 처럼 직함이 붙기도 한다 */
  ceo: string;
}

export interface ContractClause {
  id: string;
  /** 「지체상금」 — 「제8조(지체상금)」 의 괄호 안 */
  title: string;
  /** 항(①②)과 호(1. 2.)는 줄바꿈으로 가른 글 그대로 */
  text: string;
}

/** 「계약의 개요」 표에 덧붙는 행 — 납품기한 · 장소 · 입금 계좌 … */
export interface ContractTerm {
  id: string;
  label: string;
  value: string;
}

/** 품목 표의 한 줄 (견적서 줄과 같은 꼴이라 그대로 옮겨 올 수 있다) */
export interface ContractItem {
  id: string;
  name: string;
  spec?: string;
  qty: number;
  unitPrice: number;
  note?: string;
}

export interface ContractBody {
  template: ContractTemplateId;
  ourSide: ContractSide;
  roleA: string;
  roleB: string;
  partyA: ContractParty;
  partyB: ContractParty;
  /** 문서 맨 위 제목 — 「○○ 용역 계약서」 */
  heading: string;
  /** 전문 */
  preamble: string;
  terms: ContractTerm[];
  items: ContractItem[];
  clauses: ContractClause[];
  /** 맺음말 — 「본 계약의 성립을 증명하기 위하여 …」 */
  closing: string;
  /** 우리 쪽 대표자 칸에 찍을 인감 (supplier.ts 의 id). 「none」 은 찍지 않음 */
  sealId?: string;
}

export const emptyParty = (): ContractParty => ({ name: "", bizNo: "", address: "", ceo: "" });

/** 우리 쪽 · 상대 쪽 */
export const ourParty = (b: ContractBody): ContractParty => (b.ourSide === "a" ? b.partyA : b.partyB);
export const theirParty = (b: ContractBody): ContractParty => (b.ourSide === "a" ? b.partyB : b.partyA);

// ---- 정규화 (서버 저장 직전) ---------------------------------------

/** 한도 — 문서 하나가 Firestore 1MB 를 넘지 않게, 그리고 모델에 통째로 실을 수 있게 */
export const CONTRACT_LIMITS = {
  clauses: 80,
  clauseTitle: 120,
  clauseText: 6000,
  longText: 3000,
  heading: 200,
  terms: 30,
  termLabel: 40,
  termValue: 600,
  items: 100,
  partyField: 200,
} as const;

const rid = () => Math.random().toString(36).slice(2, 10);
const text = (v: unknown, max: number): string => String(v ?? "").replace(/\r\n?/g, "\n").slice(0, max);
const line = (v: unknown, max: number): string => text(v, max).replace(/\n+/g, " ").trim();
const idOf = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return /^[\w-]{1,40}$/.test(s) ? s : rid();
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

function sanitizeParty(raw: unknown): ContractParty {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const L = CONTRACT_LIMITS.partyField;
  return { name: line(r.name, L), bizNo: line(r.bizNo, L), address: line(r.address, L), ceo: line(r.ceo, L) };
}

/** 같은 id 가 두 번 나오면 뒤엣것에 새 id 를 준다 — 조항을 id 로 찾기 때문이다 */
function uniqueIds<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.map((x) => {
    if (!seen.has(x.id)) {
      seen.add(x.id);
      return x;
    }
    const id = rid();
    seen.add(id);
    return { ...x, id };
  });
}

/**
 * 저장 직전 정리. 본문이 아예 없으면(받은 계약서를 붙이기만 한 문서) undefined.
 *
 * 제목도 글도 없는 조항은 버린다 — 「조항 추가」 만 누른 빈 칸이 번호를 하나
 * 차지한 채 나가면 안 된다. 품목 줄도 품명이 있는 것만 남긴다(견적서와 같다).
 */
export function sanitizeContractBody(raw: unknown): ContractBody | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const L = CONTRACT_LIMITS;
  const template = (CONTRACT_TEMPLATE_IDS as readonly string[]).includes(String(r.template))
    ? (r.template as ContractTemplateId)
    : "service";
  const meta = contractTemplate(template);
  const sealRaw = canonicalSealId(r.sealId);

  const clauses = uniqueIds(
    arr(r.clauses)
      .map((c) => ({ id: idOf(c.id), title: line(c.title, L.clauseTitle), text: text(c.text, L.clauseText).trimEnd() }))
      .filter((c) => c.title || c.text.trim())
      .slice(0, L.clauses),
  );
  const terms = uniqueIds(
    arr(r.terms)
      .map((t) => ({ id: idOf(t.id), label: line(t.label, L.termLabel), value: text(t.value, L.termValue).trim() }))
      .filter((t) => t.label || t.value)
      .slice(0, L.terms),
  );
  const items = uniqueIds(
    arr(r.items)
      .map((i) => {
        const spec = line(i.spec, 120);
        const note = line(i.note, 120);
        return {
          id: idOf(i.id),
          name: line(i.name, 160),
          ...(spec ? { spec } : {}),
          qty: num(i.qty),
          unitPrice: Math.round(num(i.unitPrice)),
          ...(note ? { note } : {}),
        };
      })
      .filter((i) => i.name)
      .slice(0, L.items),
  );

  return {
    template,
    ourSide: r.ourSide === "a" || r.ourSide === "b" ? r.ourSide : meta.ourSide,
    roleA: line(r.roleA, 40) || meta.roleA,
    roleB: line(r.roleB, 40) || meta.roleB,
    partyA: sanitizeParty(r.partyA),
    partyB: sanitizeParty(r.partyB),
    heading: line(r.heading, L.heading),
    preamble: text(r.preamble, L.longText).trim(),
    terms,
    items,
    clauses,
    closing: text(r.closing, L.longText).trim(),
    ...(sealRaw && (SEAL_IDS as readonly string[]).includes(sealRaw) ? { sealId: sealRaw } : {}),
  };
}
