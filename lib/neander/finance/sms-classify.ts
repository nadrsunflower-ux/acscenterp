// ============================================================
//  받은 문자 거래 → 어디에 쓴 돈인가 (자동분류 엔진 + 프로젝트 회차 후보) — 계산만
// ------------------------------------------------------------
//  문자가 오면 장부(엑셀)와 **같은 자동분류 엔진**(classify.ts)에 그대로 넣는다.
//  거래처 이름이 엑셀과 같은 글자로 온다(「KB12345678」 · 「2610국민건강」) — 그래서
//  장부 이력이 그대로 통한다. 가맹점 번호가 와우 · 아이디 매장을 가른다.
//
//  처음 보는 거래처의 입금은 아직 안 받은 프로젝트 회차와 맞춰 본다 — 청구액(부가세 포함,
//  installmentSplit)이 입금액과 같은 회차. 발주처 이름까지 닮으면 앞에 둔다.
//  회차를 「받음」으로 바꾸지는 않는다 — 후보만 보인다(사람이 확인).
//
//  4주 시험 동안 이 결과는 장부에 들어가지 않는다 — 노션 알림 · 표와 받은 문자함에만.
// ============================================================

import type { ClassifyInput, ClassifySuggestion } from "./classify";
import { installmentSplit, isInstallmentReceived, type FinProjectDoc } from "./project";
import type { SmsNotice } from "./sms-notify";
import type { TxType } from "./types";

/** 알림 한 줄 → 엔진 입력. 은행은 방향만 안다(입금=수입 · 출금=지출) — 엔진이 이력으로 고친다 */
export function smsClassInput(n: Pick<SmsNotice, "channel" | "kind" | "party" | "amount" | "last4">): ClassifyInput {
  const txType: TxType = n.channel === "card" ? (n.kind === "취소" ? "환급" : "지출") : n.kind === "입금" ? "수입" : "지출";
  return { vendor: n.party, last4: n.last4, txType, gross: n.amount, adjust: 0 };
}

export interface ProjectCandidate {
  /** 프로젝트 문서 id · 회차 id — 「받음」 처리(project.markReceived)에 쓴다 */
  projectId?: string;
  installmentId?: string;
  code: string;
  name: string;
  /** 선금 · 중도금 · 잔금 */
  kind: string;
  /** 청구액 (통장에 찍히는 돈) */
  billed: number;
  /** 발주처 이름이 입금자 이름과 닮았나 */
  nameMatch: boolean;
}

/** 이름 견주기 — (주) · 주식회사 · 괄호 속 · 빈칸을 걷어 낸다 */
export const normParty = (s: string) =>
  s
    .replace(/[(（][^)）]*[)）]/g, (m) => (/^[(（]\s*주\s*[)）]$/.test(m) ? "" : m))
    .replace(/주식회사|유한회사|사단법인|재단법인|협동조합|\(주\)|（주）|㈜/g, "")
    .replace(/[\s()（）·.,-]/g, "")
    .toLowerCase();

const namesMeet = (party: string, client: string) => {
  const a = normParty(party);
  if (a.length < 2) return false;
  // 발주처 칸은 「가나」 「바사협동조합 (BASA)」 「다라대학교 (입금 마바기획사)」 꼴 — 괄호 속도 이름으로 본다
  const names = [client, ...[...client.matchAll(/[(（]([^)）]+)[)）]/g)].map((m) => m[1].replace(/^입금\s*/, ""))]
    .map(normParty)
    .filter((x) => x.length >= 2);
  return names.some((b) => a.includes(b) || b.includes(a));
};

/**
 * 입금 → 아직 안 받은 프로젝트 회차 후보. 금액(청구액)이 같아야 하고, 이름이 닮은 것을 앞에.
 * 금액만 같은 후보가 셋 이상이면 우연일 수 있어 이름이 닮은 것만 남긴다.
 */
export function projectCandidates(
  deposit: { amount: number; party?: string },
  projects: (Pick<FinProjectDoc, "code" | "name" | "client" | "status" | "vatMode" | "installments"> & { id?: string })[],
): ProjectCandidate[] {
  const out: ProjectCandidate[] = [];
  for (const p of projects) {
    if (p.status === "cancelled") continue;
    for (const i of p.installments ?? []) {
      if (isInstallmentReceived(i)) continue;
      const billed = installmentSplit(i, p.vatMode).total;
      if (Math.round(billed) !== Math.round(deposit.amount)) continue;
      out.push({
        ...(p.id ? { projectId: p.id } : {}),
        installmentId: i.id,
        code: p.code,
        name: p.name,
        kind: i.kind,
        billed,
        nameMatch: !!deposit.party && !!p.client && namesMeet(deposit.party, p.client),
      });
    }
  }
  out.sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch));
  const named = out.filter((c) => c.nameMatch);
  return out.length >= 3 ? named : out;
}

/** 프로젝트 이름을 알림에 맞게 — 앞의 연도 · 뒤의 괄호를 떼고, 낱말 단위로 12자 안에서 자른다 */
export function projectShort(name: string): string {
  const words = name
    .replace(/^\s*20\d{2}\s+/, "")
    .replace(/\s*[(（][^)）]*[)）]\s*$/, "")
    .trim()
    .split(/\s+/);
  let out = words[0] ?? "";
  for (const w of words.slice(1)) {
    if ((out + " " + w).length > 12) break;
    out += " " + w;
  }
  return out.slice(0, 16);
}

export interface SmsClassResult {
  status: ClassifySuggestion["status"];
  /** 계정 대 › 중 › 소 */
  account?: string;
  /** 사업구분 대 › 소 */
  biz?: string;
  /** 알림에 붙는 짧은 이름 — 소분류 */
  label?: string;
  reason: string;
  txType?: TxType;
  projects?: ProjectCandidate[];
}

export function smsClassResult(sug: ClassifySuggestion, projects: ProjectCandidate[] = []): SmsClassResult {
  const account = [sug.acctMajor, sug.acctMid, sug.acctMinor].filter(Boolean).join(" › ") || undefined;
  const biz = [sug.bizMajor, sug.bizMinor].filter(Boolean).join(" › ") || undefined;
  return {
    status: sug.status,
    ...(account ? { account } : {}),
    ...(biz ? { biz } : {}),
    ...(sug.acctMinor ? { label: sug.acctMinor } : {}),
    reason: sug.classReason,
    ...(sug.txType ? { txType: sug.txType } : {}),
    ...(projects.length ? { projects } : {}),
  };
}

/** 확실도 — 노션 칸 */
export const certaintyOf = (r: SmsClassResult) => (r.status === "confirmed" ? "확정" : r.status === "suggested" && r.label ? "제안" : "모름");

/**
 * 알림 끝에 붙는 「→ 어디」. 확정은 그대로, 제안은 「?」.
 * 프로젝트 회차 후보가 있으면 그쪽이 먼저다 — 계정(정산입금)보다 「어느 건의 돈」이 더 쓸모 있다.
 * 모르면 붙이지 않는다(군말 없이).
 */
export function classSuffix(r: SmsClassResult | null | undefined): string {
  if (!r) return "";
  const p = r.projects?.[0];
  if (p && (p.nameMatch || r.status !== "confirmed")) return ` → ${projectShort(p.name)} ${p.kind}?`;
  if (r.label && r.status === "confirmed") return ` → ${r.label}`;
  if (r.label && r.status === "suggested") return ` → ${r.label}?`;
  return "";
}

/** 노션 「프로젝트 후보」 칸 */
export const projectCellText = (r: SmsClassResult | null | undefined) =>
  (r?.projects ?? [])
    .slice(0, 2)
    .map((p) => `${p.code} ${projectShort(p.name)} · ${p.kind}${p.nameMatch ? "" : " (금액만 같음)"}`)
    .join(" / ");
