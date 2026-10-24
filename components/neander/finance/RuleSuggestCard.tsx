"use client";

// ============================================================
//  규칙 제안 카드 — 검토 대기함에서 같은 답을 세 번 하면 뜬다
// ------------------------------------------------------------
//  무엇을 · 어디에 · 얼마나 닿는지를 한 장에 보여 주고 저장은 사람이 누른다
//  (finance/rule-suggest.ts). 「이번엔 아니오」 는 이 조건을 다시 묻지 않는다.
// ============================================================

import { Sparkles, X } from "lucide-react";
import { Badge, Button, Card, Icon } from "@/components/neander/ui";
import type { RuleSuggestion } from "@/lib/neander/finance/rule-suggest";

const won = (n: number) => n.toLocaleString("ko-KR");

export function RuleSuggestCard({
  suggestion,
  busy,
  onSave,
  onDismiss,
  className,
}: {
  suggestion: RuleSuggestion;
  busy?: boolean;
  onSave: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const { rule, preview } = suggestion;
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start gap-3">
        <Icon icon={Sparkles} size={18} className="mt-0.5 shrink-0 text-nd-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-nd-section text-nd-fg">
            규칙으로 만들까요? — 최근 확정 {suggestion.streak}건이 모두 같은 분류였습니다
          </p>
          <p className="mt-1.5 text-[16px] leading-snug text-nd-fg">
            <span className="text-nd-fg-2">{suggestion.condition}</span>
            <span className="mx-2 text-nd-fg-3" aria-hidden>→</span>
            <b className="font-semibold">{suggestion.result}</b>
            <Badge tone={rule.mode === "confirm" ? "success" : "info"} className="ml-2 align-middle">
              {rule.mode === "confirm" ? "바로 확정" : "제안으로 (사업구분이 갈림)"}
            </Badge>
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-nd-body text-nd-fg-2">
            <li>
              지금 장부에서 <b className="nd-num font-semibold text-nd-fg">{won(preview.total)}건</b>에 닿습니다
              {preview.conflict > 0 && <> (오래전 다른 계정으로 확정된 {won(preview.conflict)}건은 그대로 둡니다)</>}
            </li>
            {suggestion.follow > 0 && (
              <li>
                대기함의 <b className="nd-num font-semibold text-nd-fg">{won(suggestion.follow)}건</b>이 바로 따라옵니다
              </li>
            )}
            <li>이미 확정된 거래는 바꾸지 않습니다</li>
          </ul>
          {suggestion.overlaps.length > 0 && (
            <p className="mt-2 text-nd-body text-nd-warning-text">
              겹치는 규칙이 있습니다 — {suggestion.overlaps.map((o) => `「${o.keyword}」 → ${o.result}`).join(", ")}.
              {rule.last4 ? " 계좌를 정한 이 규칙이 더 구체적이라 이깁니다." : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onSave} loading={busy}>
            규칙으로 저장
          </Button>
          <Button size="sm" variant="ghost" icon={X} onClick={onDismiss} disabled={busy}>
            이번엔 아니오
          </Button>
        </div>
      </div>
    </Card>
  );
}
