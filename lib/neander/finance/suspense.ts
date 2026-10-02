// ============================================================
//  가수금 기록장 — 엑셀 「가수금_기록대장」
// ------------------------------------------------------------
//  임직원과 회사 사이에 오간 돈을 **건별로** 적는다.
//    받은 돈 (in)  — 임직원이 회사에 넣은 돈. 회사가 갚을 돈이다 (가수금)
//    내준 돈 (out) — 회사가 임직원에게 내준 돈. 회사가 받을 돈이다 (가지급 · 대납)
//
//  장부(통합거래장)만으로는 이 기록을 만들 수 없어서 따로 둔다:
//   ① 장부는 2024-12 부터다 — 그 전에 생긴 건은 거래가 없다
//   ② 갚은 방법의 절반이 장부 밖이다 (현금 · 다른 사업자 통장 · 다른 대금과 상계)
//   ③ 통장에 찍힌 사람(명의)과 실제 돈 주인이 다르다 — 한 번의 입금 1,000만원이
//      세 사람 돈일 수 있다. 장부에는 거래처 글자 하나뿐이다
//
//  그래서 건이 정본이고, 장부 거래는 건에 **붙인다** (금액을 나눠 여러 건에 붙일 수
//  있다). 붙인 거래는 금액·날짜를 장부에서 읽는다 — 여기 따로 적지 않는다.
//
//  「회사 돈」 — 회사 돈이 개인 통장을 거쳐 다시 들어온 것 (수기 대장의 「손실처리」).
//  통장에는 가수금 입금으로 찍히지만 갚을 빚이 아니다. 기록은 남기고 잔액에서 뺀다.
//
//  갚음은 하나다. 수기 대장은 「정리 완료」 와 「가정리 완료」 를 나눠 적었는데
//  여기서는 합쳤다 (2026-10-02 사용자 결정).
// ============================================================

import { netAmount, type FinTransaction } from "./types";

/** 받은 돈(회사가 갚을 돈) · 내준 돈(회사가 받을 돈) */
export type SuspenseDirection = "in" | "out";

export const DIRECTION_LABEL: Record<SuspenseDirection, string> = {
  in: "받은 돈",
  out: "내준 돈",
};

/** 갚음을 부르는 말 — 받은 돈은 회사가 갚고, 내준 돈은 회사가 돌려받는다 */
export const SETTLE_LABEL: Record<SuspenseDirection, string> = {
  in: "갚음",
  out: "돌려받음",
};

/** 장부 거래에 붙인 줄 — 그 거래 금액 중 이 건의 몫 */
export interface FinSuspenseLink {
  txId: string;
  amount: number;
}

/** 갚은 기록 한 줄 */
export interface FinSuspenseSettle {
  /** 장부 밖이면 필수. 장부 거래에 붙은 줄은 비워 두면 거래의 날짜를 쓴다 */
  date?: string;
  amount: number;
  /** 「4223 > 유재영」 · 「현금」 · 「C200 구매대금과 상계」 */
  method?: string;
  /** 장부 거래에 붙은 줄이면 그 거래 */
  txId?: string;
}

export interface FinSuspenseDoc {
  id: string;
  /** 대장 번호 — 수기 대장에서 옮긴 건은 그 번호 그대로 */
  no?: number;
  direction: SuspenseDirection;
  /** 발생일 `YYYY-MM-DD`. 모르면 비운다 (수기 대장에도 빈 건이 있다) */
  date?: string;
  amount: number;
  /** 명의 — 통장에 찍힌 사람 */
  nominee?: string;
  /** 실제 돈 주인. 잔액은 이 사람 앞으로 센다. 회사 돈이면 출처(「회사 현금」) */
  owner: string;
  /** 회사 돈이 개인 통장을 거쳐 들어온 것 — 갚을 빚이 아니라 잔액에서 뺀다 */
  companyMoney?: boolean;
  /** 무엇에 쓴 돈인가 (「신촌매장 공사금」) */
  purpose?: string;
  /** 증빙 서류 이름 */
  evidence?: string;
  note?: string;
  /** 이 건이 생긴 장부 거래 */
  origins: FinSuspenseLink[];
  settles: FinSuspenseSettle[];
  createdAt: number;
  updatedAt?: number;
  updatedBy?: string;
}

export type FinSuspenseInput = Omit<FinSuspenseDoc, "id" | "createdAt" | "updatedAt" | "updatedBy">;

// ---- 장부 쪽 ---------------------------------------------------

/** 가수금 계정의 대분류 — 여기 잡힌 자금거래만 건에 붙일 수 있다 */
export const SUSPENSE_MAJOR = "가수금";

export function isSuspenseTx(t: Pick<FinTransaction, "txType" | "acctMajor">): boolean {
  return t.txType === "자금거래" && t.acctMajor === SUSPENSE_MAJOR;
}

/** 회사 통장 기준 들어온 돈 · 나간 돈. 자금거래는 유형에 방향이 없어 계정 이름이 말한다 */
export type MoneyFlowDir = "in" | "out";

export function suspenseFlow(t: Pick<FinTransaction, "acctMinor">): MoneyFlowDir {
  return /입금|회수|수령/.test(t.acctMinor ?? "") ? "in" : "out";
}

export type LinkRole = "origin" | "settle";

/** 그 자리에 붙을 거래의 방향 — 받은 돈은 생길 때 들어오고 갚을 때 나간다. 내준 돈은 반대다 */
export function roleFlow(direction: SuspenseDirection, role: LinkRole): MoneyFlowDir {
  return (direction === "in") === (role === "origin") ? "in" : "out";
}

// ---- 계산 -----------------------------------------------------

/**
 * open    남음
 * done    다 갚음
 * over    적은 금액보다 더 갚음 — 금액이나 갚은 기록 중 하나가 틀렸다
 * company 회사 돈 (갚을 것 없음)
 */
export type SuspenseStatus = "open" | "done" | "over" | "company";

export const STATUS_LABEL: Record<SuspenseStatus, string> = {
  open: "남음",
  done: "다 갚음",
  over: "더 갚음",
  company: "회사 돈",
};

export interface SuspenseView {
  item: FinSuspenseDoc;
  settled: number;
  /** 남은 돈. 회사 돈은 0. 음수면 더 갚은 것 */
  remaining: number;
  status: SuspenseStatus;
  /** 마지막으로 갚은 날 */
  lastSettleDate?: string;
  /** 붙인 장부 거래와 어긋나는 점 — 화면이 그대로 보여 준다 */
  issues: string[];
}

export interface SuspensePerson {
  owner: string;
  /** 받은 돈 — 합계 · 갚음 · 회사가 갚을 돈 */
  received: number;
  repaid: number;
  payable: number;
  /** 내준 돈 — 합계 · 돌려받음 · 회사가 받을 돈 */
  lent: number;
  recovered: number;
  receivable: number;
  /** 갚을 돈 − 받을 돈. 양수면 회사가 이 사람에게 줄 돈이 더 많다 */
  net: number;
  /** 남은 건 수 */
  openCount: number;
}

/** 아직 어느 건에도 다 붙지 않은 가수금 거래 */
export interface UnattachedTx {
  tx: FinTransaction;
  flow: MoneyFlowDir;
  /** 이미 건에 붙인 금액 */
  allocated: number;
  /** 아직 안 붙은 금액 */
  rest: number;
}

export interface SuspenseBook {
  views: SuspenseView[];
  people: SuspensePerson[];
  unattached: UnattachedTx[];
  totals: {
    /** 회사가 갚을 돈 */
    payable: number;
    /** 회사가 받을 돈 */
    receivable: number;
    openCount: number;
    companyCount: number;
    companyAmount: number;
    unattachedAmount: number;
    issueCount: number;
  };
}

export const settledOf = (item: Pick<FinSuspenseDoc, "settles">) =>
  item.settles.reduce((s, x) => s + (x.amount || 0), 0);

/** 건들이 장부 거래마다 붙여 둔 금액 합계 (생긴 거래 + 갚은 거래) */
export function allocatedByTx(items: Pick<FinSuspenseDoc, "origins" | "settles">[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (txId: string | undefined, amount: number) => {
    if (txId) out.set(txId, (out.get(txId) ?? 0) + amount);
  };
  items.forEach((it) => {
    it.origins.forEach((o) => add(o.txId, o.amount));
    it.settles.forEach((s) => add(s.txId, s.amount));
  });
  return out;
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 사람 이름 비교 키 — 앞뒤·사이 공백 차이로 같은 사람이 두 줄이 되지 않게 */
export const personKey = (s: string) => s.replace(/\s+/g, " ").trim();

function linkIssues(
  item: FinSuspenseDoc,
  txById: Map<string, FinTransaction>,
  allocated: Map<string, number>,
): string[] {
  const issues: string[] = [];
  const checkLink = (txId: string, role: LinkRole) => {
    const tx = txById.get(txId);
    if (!tx) {
      issues.push("붙여 둔 장부 거래가 원장에 없습니다 (지워진 거래)");
      return;
    }
    if (!isSuspenseTx(tx)) {
      issues.push(`${tx.date} 거래가 이제 가수금 계정이 아닙니다 (${tx.acctMajor ?? "미분류"})`);
      return;
    }
    if (suspenseFlow(tx) !== roleFlow(item.direction, role)) {
      issues.push(`${tx.date} ${tx.acctMinor} 거래는 이 자리에 맞지 않는 방향입니다`);
    }
    const over = (allocated.get(txId) ?? 0) - netAmount(tx);
    if (over > 0) issues.push(`${tx.date} 거래(${won(netAmount(tx))})에 ${won(over)} 더 붙어 있습니다`);
  };
  item.origins.forEach((o) => checkLink(o.txId, "origin"));
  item.settles.forEach((s) => s.txId && checkLink(s.txId, "settle"));

  const originSum = item.origins.reduce((s, o) => s + o.amount, 0);
  if (originSum > item.amount) {
    issues.push(`생긴 거래에 붙인 금액(${won(originSum)})이 이 건의 금액보다 큽니다`);
  }
  // 같은 문장이 두 번 나오지 않게 (한 거래를 두 줄에 붙였을 때)
  return [...new Set(issues)];
}

function viewOf(
  item: FinSuspenseDoc,
  txById: Map<string, FinTransaction>,
  allocated: Map<string, number>,
): SuspenseView {
  const settled = settledOf(item);
  const remaining = item.companyMoney ? 0 : item.amount - settled;
  const status: SuspenseStatus = item.companyMoney
    ? "company"
    : remaining > 0
      ? "open"
      : remaining < 0
        ? "over"
        : "done";
  const dates = item.settles
    .map((s) => s.date || (s.txId ? txById.get(s.txId)?.date : undefined))
    .filter((d): d is string => !!d)
    .sort();
  const issues = linkIssues(item, txById, allocated);
  if (status === "over") issues.push(`적은 금액보다 ${won(-remaining)} 더 갚았습니다`);
  return { item, settled, remaining, status, lastSettleDate: dates[dates.length - 1], issues };
}

/** 번호 → 발생일 → 만든 순서. 번호 없는 건(새로 적은 것)은 뒤로 간다 */
function byLedgerOrder(a: FinSuspenseDoc, b: FinSuspenseDoc): number {
  const na = a.no ?? Number.MAX_SAFE_INTEGER;
  const nb = b.no ?? Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  const d = (a.date ?? "9999").localeCompare(b.date ?? "9999");
  return d !== 0 ? d : a.createdAt - b.createdAt;
}

export function buildSuspenseBook(items: FinSuspenseDoc[], transactions: FinTransaction[]): SuspenseBook {
  const allocated = allocatedByTx(items);
  // 붙인 거래는 가수금 계정을 벗어났어도 찾아야 한다 (어긋남을 알리려면)
  const linked = new Set(allocated.keys());
  const txById = new Map<string, FinTransaction>();
  const pool: FinTransaction[] = [];
  transactions.forEach((t) => {
    const suspense = isSuspenseTx(t);
    if (suspense) pool.push(t);
    if (suspense || linked.has(t.id)) txById.set(t.id, t);
  });

  const views = [...items].sort(byLedgerOrder).map((it) => viewOf(it, txById, allocated));

  const people = new Map<string, SuspensePerson>();
  let companyCount = 0;
  let companyAmount = 0;
  views.forEach((v) => {
    if (v.status === "company") {
      companyCount += 1;
      companyAmount += v.item.amount;
      return;
    }
    const owner = personKey(v.item.owner) || "(미정)";
    const p =
      people.get(owner) ??
      { owner, received: 0, repaid: 0, payable: 0, lent: 0, recovered: 0, receivable: 0, net: 0, openCount: 0 };
    if (v.item.direction === "in") {
      p.received += v.item.amount;
      p.repaid += v.settled;
      p.payable += v.remaining;
    } else {
      p.lent += v.item.amount;
      p.recovered += v.settled;
      p.receivable += v.remaining;
    }
    if (v.status !== "done") p.openCount += 1;
    p.net = p.payable - p.receivable;
    people.set(owner, p);
  });

  const unattached = pool
    .map((tx) => {
      const done = allocated.get(tx.id) ?? 0;
      return { tx, flow: suspenseFlow(tx), allocated: done, rest: netAmount(tx) - done };
    })
    .filter((u) => u.rest > 0)
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date));

  const peopleRows = [...people.values()].sort(
    (a, b) =>
      b.payable + b.receivable - (a.payable + a.receivable) || a.owner.localeCompare(b.owner, "ko"),
  );

  return {
    views,
    people: peopleRows,
    unattached,
    totals: {
      payable: peopleRows.reduce((s, p) => s + p.payable, 0),
      receivable: peopleRows.reduce((s, p) => s + p.receivable, 0),
      openCount: views.filter((v) => v.status === "open" || v.status === "over").length,
      companyCount,
      companyAmount,
      unattachedAmount: unattached.reduce((s, u) => s + u.rest, 0),
      issueCount: views.filter((v) => v.issues.length > 0).length,
    },
  };
}

/** 새 건에 줄 번호 — 지금 가장 큰 번호 다음 */
export function nextSuspenseNo(items: Pick<FinSuspenseDoc, "no">[]): number {
  return items.reduce((m, it) => Math.max(m, it.no ?? 0), 0) + 1;
}

/**
 * 안 붙은 거래를 붙일 수 있는 건.
 * 들어온 돈은 「받은 돈이 생긴 거래」 이거나 「내준 돈을 돌려받은 거래」 이고, 나간 돈은 그 반대다.
 * 회사 돈도 후보다 — 회사 돈이 나갔다 들어온 거래를 붙여 둬야 안 붙은 목록에서 빠진다.
 */
export function attachCandidates(
  flow: MoneyFlowDir,
  views: SuspenseView[],
): { view: SuspenseView; role: LinkRole }[] {
  const out: { view: SuspenseView; role: LinkRole }[] = [];
  views.forEach((view) => {
    const { item } = view;
    if (roleFlow(item.direction, "settle") === flow) {
      const companyRoom = view.status === "company" && view.settled < item.amount;
      if (view.status === "open" || companyRoom) out.push({ view, role: "settle" });
    } else if (item.origins.reduce((s, o) => s + o.amount, 0) < item.amount) {
      out.push({ view, role: "origin" });
    }
  });
  return out;
}

/** 거래 하나를 건에 붙인 새 입력값 — 금액은 거래의 남은 몫과 건의 빈 자리 중 작은 쪽 */
export function attachTx(
  view: SuspenseView,
  role: LinkRole,
  u: Pick<UnattachedTx, "tx" | "rest">,
): FinSuspenseInput {
  const { item } = view;
  const input = toInput(item);
  // 빈 자리가 없으면(후보가 아닌 건에 억지로 붙일 때) 거래의 남은 몫을 그대로 쓴다
  const fit = (room: number) => (room > 0 ? Math.min(u.rest, room) : u.rest);
  if (role === "origin") {
    const room = item.amount - item.origins.reduce((s, o) => s + o.amount, 0);
    input.origins = [...item.origins, { txId: u.tx.id, amount: fit(room) }];
  } else {
    // 회사 돈은 남은 돈이 0 이라 건의 금액에서 이미 붙인 만큼을 뺀 자리를 쓴다
    const room = item.companyMoney ? item.amount - view.settled : view.remaining;
    input.settles = [...item.settles, { txId: u.tx.id, amount: fit(room) }];
  }
  return input;
}

/** 저장된 건 → 고칠 수 있는 입력값 (서버가 찍는 칸은 뺀다) */
export function toInput(item: FinSuspenseDoc): FinSuspenseInput {
  return {
    no: item.no,
    direction: item.direction,
    date: item.date,
    amount: item.amount,
    nominee: item.nominee,
    owner: item.owner,
    companyMoney: item.companyMoney,
    purpose: item.purpose,
    evidence: item.evidence,
    note: item.note,
    origins: item.origins.map((o) => ({ ...o })),
    settles: item.settles.map((s) => ({ ...s })),
  };
}

// ---- 저장 전 장부 대조 --------------------------------------------

/**
 * 새로 붙인 장부 거래가 말이 되는지 — 서버가 저장 전에 본다. 문제가 있으면 문장을 돌려준다.
 *
 * 이미 저장돼 있던 줄은 다시 따지지 않는다. 붙여 둔 거래가 나중에 다른 계정으로
 * 옮겨졌다고 비고 한 줄 고치는 것까지 막으면 안 된다 — 그 어긋남은 화면이 알린다.
 */
export function checkNewLinks(
  input: Pick<FinSuspenseInput, "direction" | "origins" | "settles">,
  prev: Pick<FinSuspenseDoc, "origins" | "settles"> | null,
  txById: Map<string, Pick<FinTransaction, "id" | "date" | "txType" | "acctMajor" | "acctMinor" | "gross" | "adjust">>,
  /** 다른 건들이 거래마다 붙여 둔 금액 */
  othersAllocated: Map<string, number>,
): string | null {
  const key = (role: LinkRole, txId: string, amount: number) => `${role}|${txId}|${amount}`;
  const kept = new Set<string>();
  prev?.origins.forEach((o) => kept.add(key("origin", o.txId, o.amount)));
  prev?.settles.forEach((x) => x.txId && kept.add(key("settle", x.txId, x.amount)));

  const mine = allocatedByTx([input]);
  const links: { role: LinkRole; txId: string; amount: number }[] = [
    ...input.origins.map((o) => ({ role: "origin" as const, txId: o.txId, amount: o.amount })),
    ...input.settles.flatMap((x) => (x.txId ? [{ role: "settle" as const, txId: x.txId, amount: x.amount }] : [])),
  ];
  for (const link of links) {
    if (kept.has(key(link.role, link.txId, link.amount))) continue;
    const tx = txById.get(link.txId);
    if (!tx) return "붙이려는 장부 거래가 원장에 없습니다. 화면을 새로 고친 뒤 다시 해 주세요.";
    if (!isSuspenseTx(tx)) {
      return `${tx.date} 거래는 가수금 계정이 아닙니다. 원장에서 계정을 가수금으로 고친 뒤 붙여 주세요.`;
    }
    if (suspenseFlow(tx) !== roleFlow(input.direction, link.role)) {
      const where =
        link.role === "origin" ? "이 건이 생긴 거래" : `${SETTLE_LABEL[input.direction]} 거래`;
      return `${tx.date} ${tx.acctMinor} 거래는 ${where} 자리에 붙일 수 없습니다 (돈의 방향이 반대입니다).`;
    }
    const net = netAmount(tx);
    const others = othersAllocated.get(link.txId) ?? 0;
    if (others + (mine.get(link.txId) ?? 0) > net) {
      return `${tx.date} 거래(${won(net)})에는 다른 건이 이미 ${won(others)}을 붙여 두었습니다. 남은 몫은 ${won(Math.max(net - others, 0))}입니다.`;
    }
  }
  return null;
}

// ---- 저장 전 정리 ------------------------------------------------

const str = (v: unknown, max = 200): string | undefined => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const money = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

/**
 * 화면·스크립트가 보낸 건을 저장할 모양으로 다듬는다.
 * 유효성 문제는 문자열로 돌려주고, 없으면 정리된 값을 준다.
 * 금액 0 인 줄(「줄 추가」 만 누른 것)은 버린다.
 */
export function sanitizeSuspense(
  raw: Partial<FinSuspenseInput>,
): { ok: true; value: FinSuspenseInput } | { ok: false; error: string } {
  const direction: SuspenseDirection = raw.direction === "out" ? "out" : "in";
  const amount = money(raw.amount);
  if (amount <= 0) return { ok: false, error: "금액을 적어 주세요." };
  const owner = str(raw.owner, 60);
  if (!owner) return { ok: false, error: "실제 돈 주인을 적어 주세요." };
  const date = str(raw.date, 10);
  if (date && !DATE.test(date)) return { ok: false, error: "발생일은 YYYY-MM-DD 형식이어야 합니다." };
  const no = raw.no === undefined || raw.no === null ? undefined : money(raw.no);

  const origins: FinSuspenseLink[] = [];
  for (const o of Array.isArray(raw.origins) ? raw.origins : []) {
    const txId = str(o?.txId, 80);
    const amt = money(o?.amount);
    if (!txId || amt === 0) continue;
    if (amt < 0) return { ok: false, error: "붙인 금액은 0보다 커야 합니다." };
    const same = origins.find((x) => x.txId === txId);
    if (same) same.amount += amt;
    else origins.push({ txId, amount: amt });
  }

  const settles: FinSuspenseSettle[] = [];
  for (const s of Array.isArray(raw.settles) ? raw.settles : []) {
    const amt = money(s?.amount);
    const txId = str(s?.txId, 80);
    const sDate = str(s?.date, 10);
    const method = str(s?.method, 120);
    if (amt === 0 && !txId && !sDate && !method) continue;
    if (amt <= 0) return { ok: false, error: "갚은 금액은 0보다 커야 합니다." };
    if (sDate && !DATE.test(sDate)) return { ok: false, error: "갚은 날은 YYYY-MM-DD 형식이어야 합니다." };
    if (!txId && !sDate) return { ok: false, error: "장부 밖에서 갚은 줄에는 날짜를 적어 주세요." };
    const line: FinSuspenseSettle = { amount: amt };
    if (sDate) line.date = sDate;
    if (method) line.method = method;
    if (txId) line.txId = txId;
    settles.push(line);
  }

  const value: FinSuspenseInput = { direction, amount, owner, origins, settles };
  if (no && no > 0) value.no = no;
  if (date) value.date = date;
  const nominee = str(raw.nominee, 60);
  if (nominee) value.nominee = nominee;
  if (raw.companyMoney) value.companyMoney = true;
  const purpose = str(raw.purpose, 120);
  if (purpose) value.purpose = purpose;
  const evidence = str(raw.evidence, 200);
  if (evidence) value.evidence = evidence;
  const note = str(raw.note, 500);
  if (note) value.note = note;
  return { ok: true, value };
}
