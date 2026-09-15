// ============================================================
//  금액 표시 — Money · StatTile
// ------------------------------------------------------------
//  금액의 부호는 색에만 맡기지 않는다. 음수는 「-」 를 함께 단다.
//  숫자는 tabular-nums(nd-num)라 자릿수가 위아래로 맞는다.
//
//  색 규칙 (ERP 전체 공통) — flow 로 준다:
//    income  수입(들어온 돈)   → 초록
//    expense 지출(나간 돈)     → 빨강
//    net     순손익·차액       → 0 이상 초록, 음수 빨강
//    (없음)  단가·예산 같은 그냥 금액 → 기본 글자색, 음수만 빨강
//
//  ⚠️ 재무 폴더에 있던 것을 여기로 옮겼다. 같은 회사의 같은 성격의
//     숫자를 매출도 찍는데, 두 모듈이 다른 서체·다른 음수 표기를 쓰면
//     같은 화면을 번갈아 보는 사람이 매번 다시 적응해야 한다.
// ============================================================
import type { ReactNode } from "react";
import { formatSigned } from "@/lib/neander/format";
import { cn } from "./cn";
import { KpiItem } from "./metric";
import type { Tone } from "./badge";

/** 돈의 방향 — 글자색을 정한다 (위 주석) */
export type MoneyFlow = "income" | "expense" | "net";

/** 금액 글자색 클래스 — Money 를 못 쓰는 자리(시트 셀·차트 툴팁)도 같은 색을 쓰게 */
export function flowTextClass(value: number, flow?: MoneyFlow): string | undefined {
  if (flow === "income") return "text-nd-income-text";
  if (flow === "expense") return "text-nd-expense-text";
  if (flow === "net") return Math.round(value) < 0 ? "text-nd-expense-text" : "text-nd-income-text";
  return Math.round(value) < 0 ? "text-nd-expense-text" : undefined;
}

/** 금액 표시. 음수는 「-」 + 색(색 단독에 의존하지 않음). */
export function Money({
  value,
  className,
  unit = true,
  muted = false,
  flow,
}: {
  value: number;
  className?: string;
  unit?: boolean;
  muted?: boolean;
  flow?: MoneyFlow;
}) {
  // 0 은 들어오지도 나가지도 않았다 — 색을 입히지 않는다
  const tone = Math.round(value) === 0 ? undefined : flowTextClass(value, flow);
  return (
    <span
      className={cn(
        "nd-num",
        tone ?? (muted ? "text-nd-fg-3" : "text-nd-fg"),
        className,
      )}
    >
      {formatSigned(value)}
      {unit && <span className="ml-0.5 text-[0.85em] font-normal text-nd-fg-3">원</span>}
    </span>
  );
}

/**
 * 금액 KPI 타일 — 헤드라인 숫자 몇 개를 나란히 놓을 때.
 * KpiStrip 안에 놓으면 한 표면에 얇은 선으로 나뉜다.
 * (비율은 RatioTile, 건수는 KpiItem)
 */
export function StatTile({
  label,
  value,
  hint,
  accent,
  tone,
  size = "md",
  tag,
  flow,
  wrapValue,
}: {
  /** 보통 글자. 용어 풀이(물음표)를 붙일 때는 노드 */
  label: ReactNode;
  value: number;
  /** 돈의 방향 — 숫자 색 (Money 와 같은 규칙) */
  flow?: MoneyFlow;
  /** 숫자를 감싼다 — 눌러서 내역을 여는 드릴 등 */
  wrapValue?: (money: ReactNode) => ReactNode;
  hint?: ReactNode;
  /** 계열 식별 점 색 (hex) */
  accent?: string;
  tone?: Tone;
  size?: "md" | "lg";
  /** 숫자 옆 작은 태그 (예: 손실) */
  tag?: ReactNode;
}) {
  const money = <Money value={value} unit={false} flow={flow} />;
  return (
    <KpiItem
      tag={tag}
      label={label}
      value={wrapValue && value !== 0 ? wrapValue(money) : money}
      unit="원"
      hint={hint}
      marker={accent}
      tone={tone}
      size={size}
    />
  );
}

/** 계열 범례 — 계열이 2개 이상이면 항상 표시한다 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: i.color }}
            aria-hidden
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}
