// ============================================================
//  만든 계약서 — 짓기 · 고치기 · 살피기
// ------------------------------------------------------------
//  본문의 모양은 contract-body.ts, 조항의 글은 contract-templates.ts 에
//  있다. 여기는 그 둘과 프로젝트·견적서를 잇는 계산이다.
//
//   · 짓기    프로젝트에서 상대방·금액·기간·입금 일정을, 최근 견적서에서
//             품목을, 지난 계약서에서 우리 쪽 서명란·도장·계좌를 끌어온다.
//   · 고치기  바뀌는 것 하나하나가 ContractChange 다. 사람이 종이 위에서
//             고치는 것과 별개로, 비서의 제안이 이 꼴로 온다 — 조항 하나,
//             전문 하나, 칸 몇 개. 적용도 되돌리기도 같은 함수를 탄다.
//   · 살피기  남은 빈칸, 비어 있는 칸, 없는 조를 가리키는 「제n조」.
//             뽑기 전에 알려 준다 — 빈칸이 남은 계약서가 나가면 안 된다.
//
//  ⚠️ 비서는 계약서를 직접 바꾸지 못한다. 제안은 화면의 초안에만 닿고,
//     초안은 사람이 「저장」 을 눌러야 남는다. 두 번 확인하는 셈이다 —
//     계약서는 조용히 틀린 한 줄이 가장 비싸다.
// ============================================================

import { koreanNumber, lastSupplier, isContract, isQuote, type FinContractInput, type FinDoc } from "./docs";
import { VAT_LABEL, VAT_MODES, type FinProjectDoc, type VatMode } from "./project";
import {
  contractTemplate,
  ourParty,
  theirParty,
  type ContractBody,
  type ContractClause,
  type ContractItem,
  type ContractParty,
  type ContractTemplateId,
  type ContractTerm,
} from "./contract-body";
import { buildContractBody, longDate, type ContractSeed } from "./contract-templates";

export type { ContractBody, ContractClause, ContractItem, ContractParty, ContractTemplateId, ContractTerm };

/** 본문이 있는 계약서 — 편집창은 이것만 다룬다 */
export type FinContractDraft = FinContractInput & { body: ContractBody };

export const hasContractBody = <T extends { body?: ContractBody }>(d: T): d is T & { body: ContractBody } => !!d.body;

const rid = () => Math.random().toString(36).slice(2, 10);

// ---- 표기 ---------------------------------------------------------

/** 「제8조(지체상금)」 */
export const clauseLabel = (index: number, title: string) => `제${index + 1}조${title.trim() ? `(${title.trim()})` : ""}`;

/** 「일금 일천이백만원정 (₩12,000,000) · 부가세 포함」. 금액이 없으면 빈 글 */
export function amountLine(amount: number, vatMode: VatMode): string {
  const a = Math.round(Number(amount) || 0);
  if (a <= 0) return "";
  return `일금 ${koreanNumber(a)}원정 (₩${a.toLocaleString("ko-KR")}) · ${VAT_LABEL[vatMode]}`;
}

/** 「계약 체결일 ~ 2026년 10월 1일」. 시작일을 비우면 체결일부터다 (JIMFF 계약서의 관행) */
export const periodLine = (start?: string, end?: string) =>
  `${longDate(start) || "계약 체결일"} ~ ${longDate(end) || "____"}`;

/** 서명란 위 날짜. 체결일을 아직 모르면 손으로 적을 자리를 남긴다 */
export function signedLine(signedDate?: string): string {
  return longDate(signedDate) || `${new Date().getFullYear()}년        월        일`;
}

export const itemAmount = (i: Pick<ContractItem, "qty" | "unitPrice">) =>
  Math.round((Number(i.qty) || 0) * (Number(i.unitPrice) || 0));
export const itemsTotal = (items: ContractItem[]) => items.reduce((a, i) => a + itemAmount(i), 0);

/** 파일명 — 「2026 JIMFF OST페어 용역_계약서」 */
export function contractFileStem(c: Pick<FinContractInput, "title">): string {
  const safe = c.title.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return [safe, "계약서"].filter(Boolean).join("_");
}

/** 서명란의 상대 상호가 곧 상대방이다 — 목록과 종이가 같은 이름을 쓰게 맞춘다 */
export function syncCounterparty<T extends FinContractDraft>(c: T): T {
  const name = theirParty(c.body).name;
  return c.counterparty === name ? c : { ...c, counterparty: name };
}

// ---- 짓기 ---------------------------------------------------------

/**
 * 지난 계약서가 쓴 우리 쪽 서명란·도장·계좌. 견적서의 lastSupplier 와 같은
 * 뜻이다 — 지난번에 이동주 대표 이름으로 냈다면 이번에도 거기서 시작한다.
 * 만든 계약서가 아직 없으면 최근 견적서의 공급자 칸에서 가져온다.
 */
export function lastContractOurs(existing: FinDoc[]): { party: ContractParty; sealId: string; bank: string } {
  const made = existing
    .filter(isContract)
    .filter(hasContractBody)
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  const last = made[0];
  // 계좌는 우리가 돈을 받는 계약(우리가 을)에서만 물려받는다 — 위탁 계약의 계좌는 상대 것이다
  const bank =
    made.find((d) => d.body.ourSide === "b" && d.body.terms.some((t) => t.label.replace(/\s/g, "") === "입금계좌" && t.value))
      ?.body.terms.find((t) => t.label.replace(/\s/g, "") === "입금계좌")?.value ?? "";
  const from = lastSupplier(existing);
  if (last) return { party: { ...ourParty(last.body) }, sealId: last.body.sealId ?? from.sealId, bank };
  const s = from.supplier;
  return { party: { name: s.name, bizNo: s.bizNo, address: s.address, ceo: s.ceo }, sealId: from.sealId, bank };
}

/** 프로젝트의 견적서 품목 — 수주한 견적이 있으면 그것, 없으면 가장 최근 것 */
export function projectQuoteLines(existing: FinDoc[], projectId: string): ContractItem[] {
  const quotes = existing
    .filter(isQuote)
    .filter((q) => q.projectId === projectId)
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  const q = quotes.find((x) => x.status === "accepted") ?? quotes[0];
  return (q?.lines ?? []).filter((l) => l.name.trim()).map((l) => ({ ...l }));
}

/**
 * 양식 하나로 새 계약서를 짓는다.
 *
 * 제작 위탁은 프로젝트의 계약금액·발주처를 끌어오지 않는다. 그 값은 우리가
 * **받는** 돈과 우리 고객이고, 위탁 계약은 우리가 **주는** 돈과 공장이다 —
 * 채워 두면 그럴듯한 틀린 숫자가 된다. IP 협업도 금액은 비운다(로열티 계약).
 *
 * 프로젝트의 기간은 대개 **행사 날짜**다(JIMFF 9/4~9/7, 미리내컴 9/5 하루).
 * 계약은 그보다 먼저 시작해 행사 뒤 정리까지 간다. 그래서 받는 계약(용역·
 * 납품)은 시작을 비워 「계약 체결일」 로 두고 끝만 프로젝트의 끝으로 잡는다 —
 * 행사 날짜를 계약 시작으로 적으면 준비 기간이 계약 밖에 놓인다.
 */
export function newContract(
  templateId: ContractTemplateId,
  project: Pick<FinProjectDoc, "id" | "name" | "client" | "contractAmount" | "vatMode" | "startDate" | "endDate" | "installments">,
  existing: FinDoc[],
): FinContractDraft {
  const meta = contractTemplate(templateId);
  const ours = lastContractOurs(existing);
  const paysUs = templateId === "service" || templateId === "supply";
  const seed: ContractSeed = {
    projectName: project.name,
    client: templateId === "outsource" ? "" : (project.client ?? ""),
    amount: paysUs ? (project.contractAmount ?? 0) : 0,
    vatMode: paysUs ? (project.vatMode ?? "excluded") : "excluded",
    startDate: templateId === "collab" ? project.startDate : undefined,
    endDate: templateId === "outsource" ? undefined : project.endDate,
    eventStart: templateId === "service" ? project.startDate : undefined,
    eventEnd: templateId === "service" ? project.endDate : undefined,
    installments: paysUs ? (project.installments ?? []).map((i) => ({ kind: i.kind, amount: i.amount, dueDate: i.dueDate })) : [],
    quoteLines: paysUs ? projectQuoteLines(existing, project.id) : [],
    our: ours.party,
    sealId: ours.sealId,
    bank: paysUs ? ours.bank : "",
  };
  const body = buildContractBody(templateId, seed);
  return {
    projectId: project.id,
    kind: "contract",
    title: [project.name.trim(), meta.kind].filter(Boolean).join(" "),
    counterparty: theirParty(body).name,
    amount: seed.amount,
    vatMode: seed.vatMode,
    startDate: seed.startDate,
    endDate: seed.endDate,
    status: "draft",
    body,
  };
}

// ---- 고치기 -------------------------------------------------------

export const CONTRACT_TEXT_FIELDS = ["heading", "preamble", "closing"] as const;
export type ContractTextField = (typeof CONTRACT_TEXT_FIELDS)[number];
export const CONTRACT_TEXT_LABEL: Record<ContractTextField, string> = {
  heading: "제목",
  preamble: "전문",
  closing: "맺음말",
};

/** 조항이 아닌 칸들. 날짜의 null 은 「비운다」 */
export interface ContractFieldsPatch {
  title?: string;
  amount?: number;
  vatMode?: VatMode;
  startDate?: string | null;
  endDate?: string | null;
  signedDate?: string | null;
  partyA?: Partial<ContractParty>;
  partyB?: Partial<ContractParty>;
  /** 개요 표의 덧붙는 행 — 통째로 바꾼다 */
  terms?: ContractTerm[];
  /** 품목 표 — 통째로 바꾼다 */
  items?: ContractItem[];
}

export type ContractChange =
  | { kind: "clause.edit"; clauseId: string; title: string; text: string }
  /** afterId 뒤에 끼운다. 못 찾으면 index 자리에, 그것도 없으면 맨 끝 */
  | { kind: "clause.add"; afterId: string | null; index?: number; clause: ContractClause }
  | { kind: "clause.remove"; clauseId: string }
  | { kind: "text"; field: ContractTextField; text: string }
  | { kind: "fields"; patch: ContractFieldsPatch };

/** 카드가 보여 줄 전/후 한 줄 */
export interface ContractChangeRow {
  label: string;
  from: string;
  to: string;
}

/** 비서의 제안 하나. 화면의 초안에만 닿는다 — 저장은 사람이 한다 */
export interface ContractProposal {
  id: string;
  /** 카드 머리 — 「제8조(지체상금) 고치기」 */
  label: string;
  reason: string;
  change: ContractChange;
  /** 제안할 때의 원래 글 (조항·전문) */
  before?: { title?: string; text: string };
  /** 칸을 바꾸는 제안의 전/후 */
  rows?: ContractChangeRow[];
}

const date = (v: string | null | undefined, keep: string | undefined) => (v === undefined ? keep : (v ?? undefined));

/** 변경 하나를 초안에 입힌다. 가리키는 조항이 이미 없으면 초안을 그대로 돌려준다 */
export function applyContractChange(c: FinContractDraft, change: ContractChange): FinContractDraft {
  const b = c.body;
  switch (change.kind) {
    case "clause.edit": {
      if (!b.clauses.some((x) => x.id === change.clauseId)) return c;
      return {
        ...c,
        body: {
          ...b,
          clauses: b.clauses.map((x) => (x.id === change.clauseId ? { ...x, title: change.title, text: change.text } : x)),
        },
      };
    }
    case "clause.add": {
      if (b.clauses.some((x) => x.id === change.clause.id)) return c;
      const after = change.afterId ? b.clauses.findIndex((x) => x.id === change.afterId) : -1;
      const at =
        after >= 0
          ? after + 1
          : typeof change.index === "number"
            ? Math.max(0, Math.min(b.clauses.length, change.index))
            : b.clauses.length;
      return { ...c, body: { ...b, clauses: [...b.clauses.slice(0, at), { ...change.clause }, ...b.clauses.slice(at)] } };
    }
    case "clause.remove":
      return { ...c, body: { ...b, clauses: b.clauses.filter((x) => x.id !== change.clauseId) } };
    case "text":
      return { ...c, body: { ...b, [change.field]: change.text } };
    case "fields": {
      const p = change.patch;
      const next: FinContractDraft = {
        ...c,
        title: p.title ?? c.title,
        amount: p.amount ?? c.amount,
        vatMode: p.vatMode ?? c.vatMode,
        startDate: date(p.startDate, c.startDate),
        endDate: date(p.endDate, c.endDate),
        signedDate: date(p.signedDate, c.signedDate),
        body: {
          ...b,
          partyA: { ...b.partyA, ...p.partyA },
          partyB: { ...b.partyB, ...p.partyB },
          terms: p.terms ? p.terms.map((t) => ({ ...t })) : b.terms,
          items: p.items ? p.items.map((i) => ({ ...i })) : b.items,
        },
      };
      return syncCounterparty(next);
    }
  }
}

/**
 * 이 변경을 되돌리는 변경. **적용하기 전의** 초안으로 만든다.
 * 초안을 통째로 되감지 않는 이유 — 그 사이 사람이 다른 조항을 손으로 고쳤을
 * 수 있다. 되돌리기는 그 제안이 건드린 곳만 건드려야 한다.
 */
export function invertContractChange(c: FinContractDraft, change: ContractChange): ContractChange | null {
  const b = c.body;
  switch (change.kind) {
    case "clause.edit": {
      const cur = b.clauses.find((x) => x.id === change.clauseId);
      return cur ? { kind: "clause.edit", clauseId: cur.id, title: cur.title, text: cur.text } : null;
    }
    case "clause.add":
      return { kind: "clause.remove", clauseId: change.clause.id };
    case "clause.remove": {
      const i = b.clauses.findIndex((x) => x.id === change.clauseId);
      if (i < 0) return null;
      return { kind: "clause.add", afterId: i > 0 ? b.clauses[i - 1].id : null, index: i, clause: { ...b.clauses[i] } };
    }
    case "text":
      return { kind: "text", field: change.field, text: b[change.field] };
    case "fields": {
      const p = change.patch;
      const pick = (side: ContractParty, patch?: Partial<ContractParty>) =>
        patch ? (Object.fromEntries(Object.keys(patch).map((k) => [k, side[k as keyof ContractParty]])) as Partial<ContractParty>) : undefined;
      const back: ContractFieldsPatch = {};
      if (p.title !== undefined) back.title = c.title;
      if (p.amount !== undefined) back.amount = c.amount;
      if (p.vatMode !== undefined) back.vatMode = c.vatMode;
      if (p.startDate !== undefined) back.startDate = c.startDate ?? null;
      if (p.endDate !== undefined) back.endDate = c.endDate ?? null;
      if (p.signedDate !== undefined) back.signedDate = c.signedDate ?? null;
      if (p.partyA) back.partyA = pick(b.partyA, p.partyA);
      if (p.partyB) back.partyB = pick(b.partyB, p.partyB);
      if (p.terms) back.terms = b.terms.map((t) => ({ ...t }));
      if (p.items) back.items = b.items.map((i) => ({ ...i }));
      return { kind: "fields", patch: back };
    }
  }
}

const PARTY_LABEL: Record<keyof ContractParty, string> = {
  name: "상호",
  bizNo: "사업자등록번호",
  address: "주소",
  ceo: "대표자",
};

const termsText = (terms: ContractTerm[]) => terms.map((t) => `${t.label}: ${t.value || "(비어 있음)"}`).join("\n") || "(없음)";
const itemsText = (items: ContractItem[]) =>
  items
    .map((i) => `${i.name}${i.spec ? ` (${i.spec})` : ""} — ${i.qty.toLocaleString("ko-KR")} × ${i.unitPrice.toLocaleString("ko-KR")} = ${itemAmount(i).toLocaleString("ko-KR")}`)
    .join("\n") || "(없음)";

/** 칸을 바꾸는 제안이 무엇을 무엇으로 바꾸는지 — 바뀌지 않는 칸은 뺀다 */
export function fieldsChangeRows(c: FinContractDraft, p: ContractFieldsPatch): ContractChangeRow[] {
  const rows: ContractChangeRow[] = [];
  const add = (label: string, from: string, to: string) => {
    if (from !== to) rows.push({ label, from: from || "(비어 있음)", to: to || "(비움)" });
  };
  if (p.title !== undefined) add("계약명", c.title, p.title);
  if (p.amount !== undefined || p.vatMode !== undefined) {
    add("계약금액", amountLine(c.amount, c.vatMode), amountLine(p.amount ?? c.amount, p.vatMode ?? c.vatMode));
  }
  if (p.startDate !== undefined || p.endDate !== undefined) {
    add("계약기간", periodLine(c.startDate, c.endDate), periodLine(date(p.startDate, c.startDate), date(p.endDate, c.endDate)));
  }
  if (p.signedDate !== undefined) add("체결일", longDate(c.signedDate), longDate(p.signedDate ?? undefined));
  (["partyA", "partyB"] as const).forEach((side) => {
    const patch = p[side];
    if (!patch) return;
    const who = side === "partyA" ? "갑" : "을";
    (Object.keys(patch) as (keyof ContractParty)[]).forEach((k) => add(`${who} ${PARTY_LABEL[k]}`, c.body[side][k], String(patch[k] ?? "")));
  });
  if (p.terms) add("계약의 개요 (덧붙는 행)", termsText(c.body.terms), termsText(p.terms));
  if (p.items) add("품목 표", itemsText(c.body.items), itemsText(p.items));
  return rows;
}

/**
 * 따옴표 모양을 계약서에 맞춘다. 양식은 당사자를 둥근 따옴표로 적는데(“갑”),
 * 모델은 같은 글을 곧은 따옴표("갑")로 돌려보내곤 한다. 그대로 받으면 한
 * 계약서에 두 모양이 섞이고, 전/후 비교가 바꾸지도 않은 낱말을 잔뜩 칠한다 —
 * 정작 바뀐 숫자 하나가 그 속에 묻힌다.
 *
 * 계약서가 둥근 따옴표를 쓸 때만 손댄다. 한 줄 안에서 짝이 맞는 것만 바꾼다.
 */
export function matchQuoteStyle(text: string, c: FinContractDraft): string {
  const sample = [c.body.preamble, c.body.closing, ...c.body.clauses.map((x) => x.text)].join("\n");
  if (!sample.includes("“") || !text.includes('"')) return text;
  return text.replace(/"([^"\n]{1,60})"/g, "“$1”");
}

// ---- 살피기 -------------------------------------------------------

const BLANK_RE = /_{3,}/g;

export interface ContractCheck {
  /** 본문에 남은 「____」 의 수 */
  blanks: number;
  /** 비어 있는 칸의 이름 — 뽑기 전에 알린다 */
  missing: string[];
  /** 없는 조를 가리키는 「제n조」 — 조항을 빼고 나면 생긴다 */
  dangling: { clause: string; ref: string }[];
}

/**
 * 뽑기 전에 볼 것. 빈칸과 빈 칸은 **막지 않는다** — 초안을 상대에게 보내며
 * 비워 두는 자리도 있다. 다만 모르고 나가지는 않게 한다.
 */
export function checkContract(c: FinContractDraft): ContractCheck {
  const b = c.body;
  const texts = [b.heading, b.preamble, b.closing, ...b.terms.map((t) => t.value), ...b.clauses.flatMap((x) => [x.title, x.text])];
  const blanks = texts.reduce((n, t) => n + (t.match(BLANK_RE)?.length ?? 0), 0);

  const missing: string[] = [];
  const them = theirParty(b);
  const us = ourParty(b);
  (Object.keys(PARTY_LABEL) as (keyof ContractParty)[]).forEach((k) => {
    if (!them[k].trim()) missing.push(`상대방 ${PARTY_LABEL[k]}`);
  });
  (Object.keys(PARTY_LABEL) as (keyof ContractParty)[]).forEach((k) => {
    if (!us[k].trim()) missing.push(`우리 ${PARTY_LABEL[k]}`);
  });
  if (!c.title.trim()) missing.push("계약명");
  // IP 협업은 로열티 계약이라 계약금액이 없는 게 보통이다
  if (c.amount <= 0 && b.template !== "collab") missing.push("계약금액");
  if (!c.endDate) missing.push("계약기간 끝");
  b.terms.forEach((t) => {
    if (t.label.trim() && !t.value.trim()) missing.push(t.label.trim());
  });
  if (b.items.length > 0 && b.items.every((i) => !i.name.trim())) missing.push("품목");

  const dangling: ContractCheck["dangling"] = [];
  b.clauses.forEach((x, i) => {
    const seen = new Set<string>();
    for (const m of x.text.matchAll(/제\s*(\d+)\s*조/g)) {
      const n = Number(m[1]);
      const ref = `제${n}조`;
      if ((n < 1 || n > b.clauses.length) && !seen.has(ref)) {
        seen.add(ref);
        dangling.push({ clause: clauseLabel(i, x.title), ref });
      }
    }
  });
  return { blanks, missing, dangling };
}

/** 다른 조를 번호로 부르는 조항들 — 조항을 끼우거나 빼면 다시 봐야 하는 곳 */
export function numberedRefs(b: ContractBody): { clauseId: string; clause: string; refs: string[] }[] {
  return b.clauses
    .map((x, i) => ({
      clauseId: x.id,
      clause: clauseLabel(i, x.title),
      refs: [...new Set([...x.text.matchAll(/제\s*(\d+)\s*조/g)].map((m) => `제${Number(m[1])}조`))],
    }))
    .filter((x) => x.refs.length > 0);
}

// ---- 글로 풀기 (비서가 읽는다) -------------------------------------

/**
 * 계약서를 글로 푼다. 비서는 이걸 「지금 계약서」 로 받는다 — 조항마다 id 가
 * 붙어 있어 「이 조항을 이렇게」 라고 가리킬 수 있다.
 */
export function contractOutline(c: FinContractDraft): string {
  const b = c.body;
  const meta = contractTemplate(b.template);
  const party = (who: string, role: string, p: ContractParty) =>
    `${who}(${role}): 상호 ${p.name || "(비어 있음)"} · 사업자등록번호 ${p.bizNo || "(비어 있음)"} · 주소 ${p.address || "(비어 있음)"} · 대표자 ${p.ceo || "(비어 있음)"}`;
  const out: string[] = [
    `[양식] ${meta.label} — 우리는 ${b.ourSide === "a" ? "갑" : "을"}`,
    `[제목] ${b.heading}`,
    `[전문] ${b.preamble}`,
    "",
    "[계약의 개요]",
    party("갑", b.roleA, b.partyA),
    party("을", b.roleB, b.partyB),
    `계약명: ${c.title}`,
    `계약금액: ${amountLine(c.amount, c.vatMode) || "(비어 있음)"}`,
    `계약기간: ${periodLine(c.startDate, c.endDate)}`,
    `체결일: ${longDate(c.signedDate) || "(아직 없음)"}`,
    ...b.terms.map((t) => `${t.label} [행 id ${t.id}]: ${t.value || "(비어 있음)"}`),
  ];
  if (b.items.length > 0) {
    out.push("", `[${meta.itemsTitle ?? "품목"} 표] 합계 ${itemsTotal(b.items).toLocaleString("ko-KR")}원`);
    b.items.forEach((i) => out.push(`- [줄 id ${i.id}] ${itemsText([i])}${i.note ? ` · ${i.note}` : ""}`));
  }
  out.push("", "[조항]");
  b.clauses.forEach((x, i) => {
    out.push(`### ${clauseLabel(i, x.title)} [조항 id ${x.id}]`, x.text, "");
  });
  out.push(`[맺음말] ${b.closing}`);
  return out.join("\n");
}

/** 새 조항 하나 — 종이의 「조항 추가」 와 비서의 제안이 같이 쓴다 */
export const newClause = (title = "", text = ""): ContractClause => ({ id: rid(), title, text });
export const newTerm = (label = "", value = ""): ContractTerm => ({ id: rid(), label, value });
export const newItem = (): ContractItem => ({ id: rid(), name: "", qty: 1, unitPrice: 0 });

export const isVatMode = (v: unknown): v is VatMode => (VAT_MODES as readonly string[]).includes(String(v));
