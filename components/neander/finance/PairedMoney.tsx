import { cn } from "@/components/neander/ui/cn";
import { Money, type MoneyFlow } from "@/components/neander/ui/money";

type AmountSize = "sm" | "lg";

interface AmountProps {
  flow?: MoneyFlow;
  /** 표에서는 열 머리의 단위를 따르고, 요약 카드에서는 true로 준다. */
  unit?: boolean;
  size?: AmountSize;
  className?: string;
}

export interface PairedMoneyProps extends AmountProps {
  supply: number;
  total: number;
  emphasize?: "supply" | "total";
}

const labelClass = (size: AmountSize) => size === "lg" ? "text-nd-caption" : "text-nd-micro";
const valueClass = (size: AmountSize, emphasized: boolean) => cn(
  "whitespace-nowrap",
  emphasized
    ? size === "lg" ? "text-[clamp(18px,1.6vw,28px)] font-bold leading-tight tracking-[-0.02em]" : "text-nd-table font-semibold"
    : size === "lg" ? "text-[clamp(15px,1.25vw,20px)] font-semibold leading-tight" : "text-nd-caption",
);

/** 화면 용도에 따라 강조만 바꾸고, 공급가액 → 부가세 포함 순서는 고정한다. */
export function PairedMoney({
  supply,
  total,
  emphasize = "supply",
  flow,
  unit = false,
  size = "sm",
  className,
}: PairedMoneyProps) {
  return (
    <dl className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 whitespace-nowrap", className)}>
      <dt className={cn("text-left font-normal text-nd-fg-3", labelClass(size))}>공급가액</dt>
      <dd className="min-w-0 text-right">
        <Money value={supply} unit={unit} flow={emphasize === "supply" ? flow : undefined} muted={emphasize !== "supply"} className={valueClass(size, emphasize === "supply")} />
      </dd>
      <dt className={cn("text-left font-normal text-nd-fg-3", labelClass(size))}>부가세 포함</dt>
      <dd className="min-w-0 text-right">
        <Money value={total} unit={unit} flow={emphasize === "total" ? flow : undefined} muted={emphasize !== "total"} className={valueClass(size, emphasize === "total")} />
      </dd>
    </dl>
  );
}

export interface UnsplitMoneyProps extends AmountProps {
  value: number;
  kind?: "cost" | "receivable";
}

/** 세액 정보가 없으면 원본 금액을 보존하고, 대응 공급가액을 추정하지 않는다. */
export function UnsplitMoney({
  value,
  kind = "cost",
  flow,
  unit = false,
  size = "sm",
  className,
}: UnsplitMoneyProps) {
  return (
    <dl className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 whitespace-nowrap", className)}>
      <dt className={cn("text-left font-normal text-nd-fg-3", labelClass(size))}>공급가액</dt>
      <dd className={cn("flex items-center justify-end gap-1.5 text-nd-fg-3", labelClass(size))}>
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-nd-warning" />
        {kind === "receivable" ? "미분리" : "미확인"}
      </dd>
      <dt className={cn("text-left font-normal text-nd-fg-3", labelClass(size))}>{kind === "receivable" ? "부가세 포함" : "입력액"}</dt>
      <dd className="min-w-0 text-right">
        <Money value={value} unit={unit} flow={flow} className={valueClass(size, true)} />
      </dd>
    </dl>
  );
}
