"use client";

// ============================================================
//  업체 계약의 플랜 · 약정 칸 — 새 업체 창과 업체 화면 「계약 · 브리프」 가 같이 쓴다
// ------------------------------------------------------------
//  가격표 · 1편 금액 · 약정 계산은 lib/neander/shorts/plans.ts (GL AI 스튜디오 구독 계약서).
//  플랜 · 약정을 고르면 부르는 쪽이 applyPlan 으로 금액 · 편수를 채운다. 손으로 고친 값이
//  가격표와 다르면 PlanDiffNote 가 알리고 「가격표대로」 로 되돌린다 — 협의한 값이면 그대로 둔다.
// ============================================================

import { Button, Field, FormRow, Select, type ControlSize } from "@/components/neander/ui";
import {
  CLIENT_PLANS,
  CLIENT_PLAN_IDS,
  CLIENT_TERM_IDS,
  EXTRA_REVISION_KRW,
  SEEDING_UNIT_KRW,
  TERM_LABEL,
  commitmentEndMonth,
  planDiff,
  planFee,
  videoUnitKrw,
  type ClientPlan,
  type ClientTerm,
} from "@/lib/neander/shorts/plans";
import type { ClientDoc } from "@/lib/neander/shorts/types";

type Contract = ClientDoc["contract"];

const wonText = (n: number) => `${n.toLocaleString("ko-KR")}원`;
/** 150만 · 142만 처럼 — 가격표 금액은 모두 만 원 단위 */
const manText = (n: number) => (n % 10_000 === 0 ? `${(n / 10_000).toLocaleString("ko-KR")}만 원` : wonText(n));
/** 2027-01 → 2027년 1월 */
export const monthText = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;

export function PlanFields({
  plan,
  term,
  startMonth,
  size,
  disabled,
  onChange,
}: {
  plan: ClientPlan | null;
  term: ClientTerm;
  startMonth: string;
  size?: ControlSize;
  disabled?: boolean;
  onChange: (plan: ClientPlan | null, term: ClientTerm) => void;
}) {
  const end = commitmentEndMonth(startMonth, term);
  const termHint = end ? `${monthText(end)}까지 · 끝나면 같은 금액으로 월 단위로 이어집니다` : "어느 쪽이든 30일 전에 알리면 해지할 수 있습니다";
  return (
    <FormRow className="grid-cols-1 sm:grid-cols-2">
      <Field label="플랜" hint={plan ? CLIENT_PLANS[plan].summary : "가격표 없이 금액 · 편수를 직접 적습니다"}>
        <Select size={size} disabled={disabled} value={plan ?? ""} onChange={(e) => onChange((e.target.value || null) as ClientPlan | null, term)}>
          {CLIENT_PLAN_IDS.map((id) => (
            <option key={id} value={id}>
              {CLIENT_PLANS[id].label}
            </option>
          ))}
          <option value="">플랜 없이 직접 정하기</option>
        </Select>
      </Field>
      <Field label="약정" hint={termHint}>
        <Select size={size} disabled={disabled} value={term} onChange={(e) => onChange(plan, e.target.value as ClientTerm)}>
          {CLIENT_TERM_IDS.map((t) => {
            const fee = planFee(plan, t);
            return (
              <option key={t} value={t}>
                {TERM_LABEL[t]}
                {fee !== null ? ` · 월 ${manText(fee)}` : ""}
              </option>
            );
          })}
        </Select>
      </Field>
    </FormRow>
  );
}

/** 손으로 고친 값이 가격표와 다를 때 — 막지 않고 알린다 */
export function PlanDiffNote({ contract, onApply, disabled }: { contract: Pick<Contract, "monthlyFeeKrw" | "vat" | "videosPerMonth" | "plan" | "term">; onApply: () => void; disabled?: boolean }) {
  const d = planDiff(contract);
  if (!d || !contract.plan) return null;
  const parts = [d.fee !== null ? `가격표 금액 ${wonText(d.fee)}` : "", d.videos !== null ? `가격표 편수 월 ${d.videos}편` : "", d.vat ? "가격표는 부가세 별도" : ""].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-nd-md border border-nd-warning/30 bg-nd-warning-soft px-4 py-2.5">
      <p className="min-w-0 text-[13px] leading-relaxed text-nd-warning-text">
        {CLIENT_PLANS[contract.plan].label} 가격표와 다릅니다 — {parts.join(" · ")}. 협의한 값이면 그대로 두세요.
      </p>
      {!disabled && (
        <Button size="sm" variant="secondary" onClick={onApply}>
          가격표대로
        </Button>
      )}
    </div>
  );
}

/** 표준 계약서가 정한 금액 · 날짜 — 플랜이 있을 때만 */
export function PlanTermsNote({ contract }: { contract: Contract }) {
  if (!contract.plan) return null;
  const term = contract.term ?? "monthly";
  const unit = videoUnitKrw(contract.plan, term);
  const end = commitmentEndMonth(contract.startMonth, term);
  const rows: [string, string][] = [
    ...(unit !== null ? ([["못 채운 편", `1편 ${wonText(unit)} — 다음 달 안에 보충, 못 하면 빼거나 돌려줍니다`]] as [string, string][]) : []),
    ["넘는 수정", `1회 ${wonText(EXTRA_REVISION_KRW)}(부가세 별도) — 미리 알리고 동의를 받습니다`],
    ...(contract.plan === "growth" || contract.plan === "fullGrowth" ? ([["시딩", `월 20명 · 못 채운 1명 ${wonText(SEEDING_UNIT_KRW)}`]] as [string, string][]) : []),
    ...(end ? ([["약정 끝", `${monthText(end)} 말 — 30일 전까지 고객사에 알립니다 (일정에 표시)`]] as [string, string][]) : []),
  ];
  return (
    <dl className="grid gap-x-3 gap-y-1.5 rounded-nd-md bg-nd-sunken/70 px-4 py-3 text-[13px] sm:grid-cols-[auto_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-nd-fg-2">{k}</dt>
          <dd className="text-nd-fg-3">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
