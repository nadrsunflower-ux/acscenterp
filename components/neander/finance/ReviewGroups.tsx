"use client";

// ============================================================
//  검토 대기함 — 묶음으로 보기
// ------------------------------------------------------------
//  같은 답으로 풀리는 거래를 한 번에 묻는다 (finance/review-groups.ts).
//  후보를 누르면 묶음 전체가 그 분류로 확정된다. 손으로 고를 것이 있으면
//  「목록에서 보기」 로 그 묶음만 남긴 목록으로 간다.
// ============================================================

import { CreditCard, Landmark, ListFilter } from "lucide-react";
import { Badge, Button, Card, EmptyState, Icon, Money } from "@/components/neander/ui";
import type { ClassCandidate } from "@/lib/neander/finance/classify";
import type { FinPaymentMethodDoc } from "@/lib/neander/finance/db-types";
import type { ReviewGroup } from "@/lib/neander/finance/review-groups";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

const candLabel = (c: ClassCandidate) =>
  `${c.acctMid} › ${c.acctMinor}${c.bizMinor ? ` · ${c.bizMinor}` : ""}`;

export function ReviewGroups({
  groups,
  pmIndex,
  busy,
  onApply,
  onFocus,
}: {
  groups: ReviewGroup[];
  pmIndex: Map<string, FinPaymentMethodDoc>;
  busy?: boolean;
  onApply: (group: ReviewGroup, candidate: ClassCandidate) => void;
  onFocus: (group: ReviewGroup) => void;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={ListFilter}
        title="묶을 거래가 없습니다"
        description="같은 거래처 · 같은 계좌 · 비슷한 금액이 두 건 이상인 묶음이 없습니다. 목록에서 한 건씩 보세요."
      />
    );
  }
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div>
      <p className="mb-3 text-nd-body text-nd-fg-2">
        묶음 <b className="nd-num font-semibold text-nd-fg">{won(groups.length)}개</b>에{" "}
        <b className="nd-num font-semibold text-nd-fg">{won(total)}건</b> — 같은 답으로 풀리는 건수가 많은 것부터.
        후보를 누르면 묶음 전체가 그 분류로 확정됩니다.
      </p>
      <ul className="space-y-2">
        {groups.map((g) => {
          const pm = g.last4 ? pmIndex.get(g.last4) : undefined;
          const options = [...(g.proposal ? [{ c: g.proposal, from: "제안" as const }] : []), ...g.candidates.map((c) => ({ c, from: "이력" as const }))];
          return (
            <li key={g.key}>
              <Card className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2.5 text-[18px] font-semibold leading-snug text-nd-fg">
                      <span className="min-w-0 truncate">{g.vendor}</span>
                      {g.names > 1 && <span className="text-nd-body font-normal text-nd-fg-3">외 이름 {g.names - 1}가지</span>}
                      <Badge tone="warning">{won(g.rows.length)}건</Badge>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-nd-body text-nd-fg-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon icon={pm?.kind === "card" ? CreditCard : Landmark} size={15} className="text-nd-fg-3" />
                        {pm ? `${pm.alias} (${g.last4})` : g.last4 || "계좌 미지정"}
                      </span>
                      <span>{g.flow === "in" ? "들어온 돈" : "나간 돈"} · {g.band}</span>
                      <span className="nd-num">{g.from === g.to ? g.from : `${g.from} ~ ${g.to}`}</span>
                      <span>
                        합계 <Money value={g.amount} flow={g.flow === "in" ? "income" : "expense"} />
                      </span>
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" icon={ListFilter} onClick={() => onFocus(g)}>
                    목록에서 보기
                  </Button>
                </div>
                {options.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-nd-line pt-3">
                    <span className="text-nd-table text-nd-fg-3">{g.basis ? `${g.basis} 기준` : "후보"}</span>
                    {options.map(({ c, from }, i) => (
                      <Button
                        key={`${from}-${c.txType}-${c.acctMajor}-${c.acctMid}-${c.acctMinor}`}
                        size="sm"
                        // 이력이 갈리는 묶음은 어느 후보도 앞세우지 않는다 — 한 번에 수십 건이 그 분류가 된다
                        variant={i === 0 && (from === "제안" || options.length === 1) ? "primary" : "secondary"}
                        disabled={busy}
                        onClick={() => onApply(g, c)}
                        title={`${c.acctMajor} › ${c.acctMid} › ${c.acctMinor}`}
                      >
                        {from === "제안" ? "제안대로" : `이력 ${won(c.count)}건`} — {candLabel(c)} · {won(g.rows.length)}건 확정
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 border-t border-nd-line pt-3 text-nd-body text-nd-fg-3">
                    이력이 없어 후보가 없습니다 — 「목록에서 보기」 로 가서 고른 뒤 한 번에 적용하세요.
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
