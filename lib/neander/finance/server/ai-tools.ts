// ============================================================
//  재무 채팅 에이전트의 도구
// ------------------------------------------------------------
//  ⚠️ 이 파일의 유일한 원칙: **모델은 장부를 쓰지 못한다.**
//
//  읽기 도구는 바로 실행한다 (조회는 되돌릴 게 없다).
//  쓰기는 도구가 아니라 **제안**이다 — `propose_update` 는 Firestore 를
//  건드리지 않고 "이렇게 바꾸자"는 목록만 만든다. 사람이 화면에서 바뀔
//  내용을 보고 「적용」을 눌러야 그때 기존 저장 경로로 나간다.
//
//  재무에서 조용한 변경이 가장 나쁘다. 모델이 그럴싸하게 틀릴 때 특히
//  그렇고, 채팅은 그런 실수가 대화의 흐름에 묻히기 쉬운 자리다.
// ============================================================

import type { FinAccountDoc } from "../db-types";
import { netAmount, TX_TYPES, type FinTransaction, type TxType } from "../types";
import { buildReport, makeIsCard, type Basis } from "../report";
import type { FinPaymentMethodDoc } from "../db-types";
import {
  describeRuleCondition,
  describeRuleResult,
  normalizeClassRule,
  previewClassRule,
  sameCondition,
  type FinClassRuleDoc,
  type RuleProposal,
} from "../class-rules";

/** 한 번에 돌려줄 거래 행 수 상한 — 모델 컨텍스트를 지키기 위해 */
const ROW_LIMIT = 50;
const GROUP_LIMIT = 30;

export interface ToolContext {
  transactions: FinTransaction[];
  accounts: FinAccountDoc[];
  paymentMethods: FinPaymentMethodDoc[];
  /** 지금 저장돼 있는 분류 규칙 (class-rules.ts). 없으면 빈 것으로 본다 */
  classRules?: FinClassRuleDoc[];
}

/** 사람이 승인해야 반영되는 변경 제안 */
export interface ChangeProposal {
  id: string;
  ids: string[];
  patch: Record<string, unknown>;
  reason: string;
  /** 바뀌기 전 값 — 화면에서 전/후를 보여주기 위해 */
  before: {
    id: string;
    date: string;
    vendor?: string;
    txType: string;
    acct: string;
    biz: string;
    amount: number;
    status: string;
  }[];
  /**
   * 분류 규칙 제안이면 여기에 — 그때 ids·patch·before 는 비어 있다.
   * 거래 변경과 **같은 길**(제안 → 사람이 적용)을 타게 하려고 같은 모양에 싣는다.
   */
  rule?: RuleProposal;
}

// ---- 도구 정의 (OpenAI function calling 형식) -------------------

const FILTERS = {
  month: { type: "string", description: "YYYY-MM. 그 달만" },
  dateFrom: { type: "string", description: "YYYY-MM-DD 이상" },
  dateTo: { type: "string", description: "YYYY-MM-DD 이하" },
  vendor: { type: "string", description: "거래처명에 이 문자열이 포함된 것 (대소문자 무시)" },
  acctMajor: { type: "string" },
  acctMid: { type: "string" },
  acctMinor: { type: "string" },
  bizMajor: { type: "string", description: "B2C · B2B · 공용" },
  bizMinor: { type: "string", description: "와우·아이디·홍대공용·온라인·SMOAT·조향·개발·기타·공용" },
  txType: { type: "string", enum: [...TX_TYPES] },
  status: { type: "string", enum: ["confirmed", "suggested", "needs_review"] },
  site: { type: "string", description: "사업장 (네안데르·안다르·일해라컴퍼니·와작홈즈)" },
  last4: { type: "string", description: "계좌·카드 뒷 4자리" },
  minAmount: { type: "number", description: "순금액 이상" },
  maxAmount: { type: "number", description: "순금액 이하" },
  noAccount: { type: "boolean", description: "true 면 계정이 비어 있는 것만" },
} as const;

export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_transactions",
      description:
        `조건에 맞는 거래를 찾는다. 최대 ${ROW_LIMIT}건까지 내용을 돌려주고, 전체 건수와 합계는 항상 정확하게 알려준다. ` +
        "건수가 많으면 summarize_transactions 로 먼저 큰 그림을 보는 게 낫다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { ...FILTERS, limit: { type: "number", description: `최대 ${ROW_LIMIT}` } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "summarize_transactions",
      description: "조건에 맞는 거래를 축으로 묶어 건수·합계를 낸다. '무엇에 얼마 썼나' 같은 질문에 먼저 쓴다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["groupBy"],
        properties: {
          groupBy: {
            type: "string",
            enum: ["month", "txType", "acctMajor", "acctMid", "acctMinor", "bizMajor", "bizMinor", "site", "vendor", "status", "last4"],
          },
          ...FILTERS,
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_monthly_report",
      description:
        "그 달의 손익 요약(수입·지출·순금액)과 계정대분류별 지출을 낸다. basis 로 발생주의/현금흐름을 고른다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["month"],
        properties: {
          month: { type: "string", description: "YYYY-MM" },
          basis: { type: "string", enum: ["accrual", "cash"], description: "기본 accrual(발생주의)" },
          bizMajor: { type: "string" },
          bizMinor: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_accounts",
      description:
        "계정 마스터에서 계정을 찾는다. 변경을 제안하기 전에 **반드시** 이걸로 실재하는 계정인지 확인한다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", description: "계정명이나 용례의 일부" },
          txType: { type: "string", enum: [...TX_TYPES], description: "이 거래유형의 계정만" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_update",
      description:
        "거래를 이렇게 고치자고 **제안**한다. 저장되지 않는다 — 사용자가 화면에서 확인하고 승인해야 반영된다. " +
        "제안 전에 search_transactions 로 대상을 확인하고 find_accounts 로 계정이 실재하는지 확인할 것.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ids", "patch", "reason"],
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "거래 id 들" },
          patch: {
            type: "object",
            additionalProperties: false,
            properties: {
              acctMajor: { type: "string" },
              acctMid: { type: "string" },
              acctMinor: { type: "string" },
              bizMajor: { type: "string" },
              bizMinor: { type: "string" },
              txType: { type: "string", enum: [...TX_TYPES] },
              status: { type: "string", enum: ["confirmed", "suggested", "needs_review"] },
              site: { type: "string" },
              note: { type: "string" },
            },
          },
          reason: { type: "string", description: "왜 이렇게 바꾸는지 한 문장. 사용자가 이걸 보고 승인한다" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_class_rules",
      description:
        "지금 저장돼 있는 **분류 규칙**(사람이 정해 둔 「이 거래처는 이 계정」)을 본다. " +
        "규칙을 새로 제안하기 전에 겹치는 것이 있는지 확인하고, 고치거나 지울 때 ruleId 를 여기서 얻는다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { keyword: { type: "string", description: "키워드에 이 글자가 든 규칙만" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_class_rule",
      description:
        "앞으로 들어올 거래를 자동으로 분류할 **규칙을 제안**한다. 저장되지 않는다 — 사용자가 화면에서 승인해야 저장된다. " +
        "저장되면 엑셀 임포트 자동분류와 검토 대기함 AI 분류가 과거 이력보다 **먼저** 이 규칙을 따른다. " +
        "이미 확정된 거래는 바뀌지 않는다 — 지금 장부에 있는 거래를 바꾸려면 propose_update 를 따로 쓴다. " +
        "제안 전에 find_accounts 로 계정이 실재하는지 확인할 것. 결과로 「지금 장부에서 이 규칙에 걸리는 거래」 가 돌아온다 — " +
        "다른 계정으로 확정된 거래가 많으면 키워드가 너무 넓은 것이니 사용자에게 알리고 조건을 좁힌다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["keyword", "acctMajor", "acctMid", "acctMinor", "reason"],
        properties: {
          keyword: {
            type: "string",
            description: "거래처명에 이 글자가 들어 있으면 적용 (대소문자·띄어쓰기 무시, 두 글자 이상). 가능한 한 구체적으로",
          },
          last4: { type: "string", description: "이 계좌·카드에서만 (뒷 4자리). 계좌마다 뜻이 다른 거래처일 때 쓴다" },
          minAmount: { type: "number", description: "순금액 이상일 때만" },
          maxAmount: { type: "number", description: "순금액 이하일 때만" },
          flow: {
            type: "string",
            enum: ["in", "out"],
            description: "자금거래 계정일 때만: 들어온 돈(in) / 나간 돈(out). 수입·지출 계정은 계정이 정한다",
          },
          acctMajor: { type: "string" },
          acctMid: { type: "string" },
          acctMinor: { type: "string" },
          bizMajor: { type: "string", description: "B2C · B2B · 공용 · 해당없음" },
          bizMinor: { type: "string", description: "와우·아이디·홍대공용·온라인·SMOAT·조향·개발·기타·공용" },
          mode: {
            type: "string",
            enum: ["confirm", "suggest"],
            description:
              "confirm = 걸리면 바로 확정 (기본). suggest = 제안으로 올려 사람이 확인. 키워드가 넓거나 예외가 있을 수 있으면 suggest. " +
              "수입·지출 규칙은 사업구분까지 적어야 실제로 확정된다 — 없으면 제안으로 올라간다",
          },
          replaceRuleId: { type: "string", description: "기존 규칙을 고치는 것이면 그 규칙의 id (list_class_rules)" },
          reason: { type: "string", description: "왜 이 규칙인지 한 문장 — 사용자의 말을 살려서. 규칙에 메모로 남는다" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_class_rule_delete",
      description: "분류 규칙을 지우자고 **제안**한다. 저장되지 않는다 — 사용자가 승인해야 지워진다.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ruleId", "reason"],
        properties: {
          ruleId: { type: "string", description: "list_class_rules 로 얻은 id" },
          reason: { type: "string" },
        },
      },
    },
  },
];

// ---- 실행 ----------------------------------------------------

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function applyFilters(rows: FinTransaction[], a: Args): FinTransaction[] {
  const vendor = s(a.vendor)?.toLowerCase();
  return rows.filter((t) => {
    if (s(a.month) && !(t.date ?? "").startsWith(s(a.month)!)) return false;
    if (s(a.dateFrom) && (t.date ?? "") < s(a.dateFrom)!) return false;
    if (s(a.dateTo) && (t.date ?? "") > s(a.dateTo)!) return false;
    if (vendor && !(t.vendor ?? "").toLowerCase().includes(vendor)) return false;
    if (s(a.acctMajor) && t.acctMajor !== s(a.acctMajor)) return false;
    if (s(a.acctMid) && t.acctMid !== s(a.acctMid)) return false;
    if (s(a.acctMinor) && t.acctMinor !== s(a.acctMinor)) return false;
    if (s(a.bizMajor) && t.bizMajor !== s(a.bizMajor)) return false;
    if (s(a.bizMinor) && t.bizMinor !== s(a.bizMinor)) return false;
    if (s(a.txType) && t.txType !== s(a.txType)) return false;
    if (s(a.status) && t.status !== s(a.status)) return false;
    if (s(a.site) && t.site !== s(a.site)) return false;
    if (s(a.last4) && t.last4 !== s(a.last4)) return false;
    if (a.noAccount === true && t.acctMinor) return false;
    const net = netAmount(t);
    if (n(a.minAmount) !== undefined && net < n(a.minAmount)!) return false;
    if (n(a.maxAmount) !== undefined && net > n(a.maxAmount)!) return false;
    return true;
  });
}

const acctOf = (t: FinTransaction) =>
  [t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(">") || "(미분류)";
const bizOf = (t: FinTransaction) =>
  [t.bizMajor, t.bizMinor].filter(Boolean).join("·") || "(미정)";

function rowView(t: FinTransaction) {
  return {
    id: t.id,
    date: t.date,
    vendor: t.vendor,
    txType: t.txType,
    acct: acctOf(t),
    biz: bizOf(t),
    amount: netAmount(t),
    status: t.status,
    last4: t.last4,
    note: t.note ? t.note.slice(0, 60) : undefined,
  };
}

export interface ToolOutcome {
  /** 모델에게 돌려줄 결과 (JSON 문자열로 직렬화된다) */
  result: unknown;
  /** 이번 호출이 만든 변경 제안 */
  proposal?: ChangeProposal;
}

let proposalSeq = 0;

export function runTool(name: string, args: Args, ctx: ToolContext): ToolOutcome {
  switch (name) {
    case "search_transactions": {
      const hits = applyFilters(ctx.transactions, args).sort((a, b) =>
        (b.date ?? "").localeCompare(a.date ?? ""),
      );
      const limit = Math.min(n(args.limit) ?? ROW_LIMIT, ROW_LIMIT);
      return {
        result: {
          count: hits.length,
          totalNet: Math.round(hits.reduce((x, t) => x + netAmount(t), 0)),
          shown: Math.min(hits.length, limit),
          truncated: hits.length > limit,
          rows: hits.slice(0, limit).map(rowView),
        },
      };
    }

    case "summarize_transactions": {
      const hits = applyFilters(ctx.transactions, args);
      const key = String(args.groupBy);
      const pick = (t: FinTransaction): string => {
        switch (key) {
          case "month": return (t.date ?? "").slice(0, 7) || "(없음)";
          case "acctMajor": return t.acctMajor ?? "(미분류)";
          case "acctMid": return t.acctMid ?? "(미분류)";
          case "acctMinor": return t.acctMinor ?? "(미분류)";
          case "bizMajor": return t.bizMajor ?? "(미정)";
          case "bizMinor": return t.bizMinor ?? "(미정)";
          case "vendor": return t.vendor ?? "(거래처 없음)";
          case "site": return t.site ?? "(없음)";
          case "last4": return t.last4 ?? "(없음)";
          case "status": return t.status;
          default: return t.txType;
        }
      };
      const map = new Map<string, { count: number; net: number }>();
      hits.forEach((t) => {
        const k = pick(t);
        if (!map.has(k)) map.set(k, { count: 0, net: 0 });
        const g = map.get(k)!;
        g.count += 1;
        g.net += netAmount(t);
      });
      const groups = [...map.entries()]
        .map(([k, v]) => ({ key: k, count: v.count, net: Math.round(v.net) }))
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
      return {
        result: {
          totalCount: hits.length,
          totalNet: Math.round(hits.reduce((x, t) => x + netAmount(t), 0)),
          groupCount: groups.length,
          shown: Math.min(groups.length, GROUP_LIMIT),
          groups: groups.slice(0, GROUP_LIMIT),
        },
      };
    }

    case "get_monthly_report": {
      const basis = (s(args.basis) as Basis) ?? "accrual";
      const isCard = makeIsCard(ctx.paymentMethods);
      const rep = buildReport(ctx.transactions, {
        basis,
        isCard,
        scope: {
          month: s(args.month),
          bizMajor: s(args.bizMajor),
          bizMinor: s(args.bizMinor),
        },
      });
      return {
        result: {
          month: s(args.month),
          basis,
          basisMeaning:
            basis === "accrual"
              ? "카드사용내역 포함, 카드대금결제 제외 (비용 발생 시점)"
              : "카드대금결제 포함, 카드사용내역 제외 (통장 출금 시점)",
          income: Math.round(rep.total.income),
          expense: Math.round(rep.total.expense),
          personalUse: Math.round(rep.total.personal),
          refund: Math.round(rep.total.refund),
          expensePure: Math.round(rep.total.expensePure),
          net: Math.round(rep.total.net),
          count: rep.total.count,
          byMajor: rep.roots
            .filter((r) => r.value.expense !== 0 || r.value.income !== 0)
            .map((r) => ({
              major: r.major,
              income: Math.round(r.value.income),
              expense: Math.round(r.value.expense),
              count: r.value.count,
            })),
        },
      };
    }

    case "find_accounts": {
      const q = (s(args.query) ?? "").toLowerCase();
      const txType = s(args.txType);
      const hits = ctx.accounts.filter((a) => {
        if (txType && a.txType !== txType) return false;
        return [a.major, a.mid, a.minor, a.example, a.code]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
      return {
        result: {
          count: hits.length,
          accounts: hits.slice(0, 20).map((a) => ({
            txType: a.txType,
            acctMajor: a.major,
            acctMid: a.mid,
            acctMinor: a.minor,
            example: a.example,
            code: a.code,
          })),
          truncated: hits.length > 20,
        },
      };
    }

    case "propose_update": {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      const reason = s(args.reason) ?? "";
      const byId = new Map(ctx.transactions.map((t) => [t.id, t]));
      const targets = ids.map((id) => byId.get(id)).filter(Boolean) as FinTransaction[];
      const missing = ids.filter((id) => !byId.has(id));

      if (targets.length === 0) {
        return {
          result: {
            ok: false,
            error: "해당 id 의 거래를 찾지 못했습니다. search_transactions 로 먼저 확인하세요.",
            missing,
          },
        };
      }

      // 계정을 바꾸려면 마스터에 실재해야 한다. 없는 계정을 넣으면 조인이 깨진다.
      const wantsAccount = patch.acctMajor || patch.acctMid || patch.acctMinor;
      if (wantsAccount) {
        const major = s(patch.acctMajor);
        const mid = s(patch.acctMid);
        const minor = s(patch.acctMinor);
        if (!major || !mid || !minor) {
          return {
            result: {
              ok: false,
              error: "계정은 대·중·소 세 단계를 모두 지정해야 합니다.",
            },
          };
        }
        // 대상들의 거래유형(변경 후 기준)마다 검증
        const badFor: string[] = [];
        targets.forEach((t) => {
          const tx = (s(patch.txType) as TxType) ?? t.txType;
          const exists = ctx.accounts.some(
            (a) => a.txType === tx && a.major === major && a.mid === mid && a.minor === minor,
          );
          // 카드대금결제는 계정이 지출 계열이라 예외 (기존 장부의 관행)
          const allowed = tx === "카드대금결제" && minor === "카드대금결제";
          if (!exists && !allowed) badFor.push(tx);
        });
        if (badFor.length > 0) {
          return {
            result: {
              ok: false,
              error: `계정 마스터에 「${major}>${mid}>${minor}」 (거래유형 ${[...new Set(badFor)].join(",")}) 조합이 없습니다. find_accounts 로 실재하는 계정을 확인하세요.`,
            },
          };
        }
      }

      if (!reason) {
        return { result: { ok: false, error: "reason 이 필요합니다. 사용자가 이걸 보고 승인합니다." } };
      }

      const proposal: ChangeProposal = {
        id: `p${++proposalSeq}-${Date.now()}`,
        ids: targets.map((t) => t.id),
        patch: Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== ""),
        ),
        reason,
        before: targets.map((t) => ({
          id: t.id,
          date: t.date,
          vendor: t.vendor,
          txType: t.txType,
          acct: acctOf(t),
          biz: bizOf(t),
          amount: netAmount(t),
          status: t.status,
        })),
      };

      return {
        proposal,
        result: {
          ok: true,
          proposed: targets.length,
          missing: missing.length ? missing : undefined,
          note:
            "제안을 사용자 화면에 올렸습니다. **아직 저장되지 않았습니다** — 사용자가 승인해야 반영됩니다. " +
            "같은 내용을 다시 제안하지 마세요.",
        },
      };
    }

    case "list_class_rules": {
      const kw = (s(args.keyword) ?? "").toLowerCase().replace(/\s+/g, "");
      const rules = (ctx.classRules ?? []).filter(
        (r) => !kw || r.keyword.toLowerCase().replace(/\s+/g, "").includes(kw),
      );
      return {
        result: {
          count: rules.length,
          rules: rules.slice(0, 40).map((r) => ({
            ruleId: r.id,
            active: r.active,
            condition: describeRuleCondition(r, ctx.paymentMethods),
            result: describeRuleResult(r),
            mode: r.mode,
            note: r.note,
          })),
          truncated: rules.length > 40,
        },
      };
    }

    case "propose_class_rule": {
      const reason = s(args.reason) ?? "";
      if (!reason) {
        return { result: { ok: false, error: "reason 이 필요합니다. 사용자가 이걸 보고 승인합니다." } };
      }
      const checked = normalizeClassRule(
        { ...args, note: reason },
        { accounts: ctx.accounts, paymentMethods: ctx.paymentMethods },
      );
      if (!checked.ok) {
        return {
          result: { ok: false, error: `${checked.error} find_accounts 로 실재하는 계정을 확인하세요.` },
        };
      }
      const rule = checked.rule;
      const existing = ctx.classRules ?? [];
      const replaceId = s(args.replaceRuleId);
      if (replaceId && !existing.some((r) => r.id === replaceId)) {
        return { result: { ok: false, error: "replaceRuleId 의 규칙을 찾지 못했습니다. list_class_rules 로 확인하세요." } };
      }
      // 조건이 같은 규칙이 이미 있으면 서버가 그것을 고친다 — 사용자에게도 그렇게 알린다
      const twin = existing.find((r) => (replaceId ? r.id === replaceId : sameCondition(r, rule)));
      const { preview, pendingIds } = previewClassRule(rule, ctx.transactions);

      const proposal: ChangeProposal = {
        id: `r${++proposalSeq}-${Date.now()}`,
        ids: [],
        patch: {},
        reason,
        before: [],
        rule: {
          action: "save",
          ...(twin ? { ruleId: twin.id } : {}),
          rule,
          condition: describeRuleCondition(rule, ctx.paymentMethods),
          result: describeRuleResult(rule),
          preview,
        },
      };
      const pl = rule.txType === "수입" || rule.txType === "지출";
      return {
        proposal,
        result: {
          ok: true,
          replaces: twin ? `같은 조건의 기존 규칙(${describeRuleResult(twin)})을 고칩니다` : undefined,
          willConfirm: rule.mode === "confirm" && (!pl || (!!rule.bizMajor && !!rule.bizMinor)),
          matchesNow: {
            total: preview.total,
            alreadyThisAccount: preview.same,
            confirmedAsOtherAccount: preview.conflict,
            notYetConfirmed: preview.pending,
            byAccount: preview.byClass,
          },
          pendingIds: pendingIds.slice(0, ROW_LIMIT),
          note:
            "규칙 제안을 사용자 화면에 올렸습니다. **아직 저장되지 않았습니다** — 사용자가 승인해야 저장됩니다. " +
            "이 규칙은 앞으로 들어올 거래에 적용되고, 이미 확정된 거래는 바꾸지 않습니다. 지금 장부에 있는 미확정 거래(pendingIds)도 바로 바꾸길 원하면 " +
            "사용자에게 묻고 propose_update 로 따로 제안하세요. confirmedAsOtherAccount 가 많으면 키워드가 너무 넓다고 알리세요.",
        },
      };
    }

    case "propose_class_rule_delete": {
      const ruleId = s(args.ruleId);
      const reason = s(args.reason) ?? "";
      const target = (ctx.classRules ?? []).find((r) => r.id === ruleId);
      if (!target) {
        return { result: { ok: false, error: "그 id 의 규칙을 찾지 못했습니다. list_class_rules 로 확인하세요." } };
      }
      if (!reason) return { result: { ok: false, error: "reason 이 필요합니다." } };
      const proposal: ChangeProposal = {
        id: `r${++proposalSeq}-${Date.now()}`,
        ids: [],
        patch: {},
        reason,
        before: [],
        rule: {
          action: "delete",
          ruleId: target.id,
          rule: target,
          condition: describeRuleCondition(target, ctx.paymentMethods),
          result: describeRuleResult(target),
          preview: previewClassRule(target, ctx.transactions).preview,
        },
      };
      return {
        proposal,
        result: {
          ok: true,
          note: "규칙 삭제 제안을 사용자 화면에 올렸습니다. **아직 지워지지 않았습니다** — 사용자가 승인해야 지워집니다.",
        },
      };
    }

    default:
      return { result: { ok: false, error: `알 수 없는 도구: ${name}` } };
  }
}
