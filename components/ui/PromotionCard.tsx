import Image from "next/image";
import type { Promotion } from "@/lib/types";
import { formatKoreanDate } from "@/lib/date";
import Badge from "./Badge";

export interface PromotionCardProps {
  promotion: Promotion;
  className?: string;
}

// Promotion 한 건을 카드로 표시 (할인/증정 뱃지 + 기간 + 대상 + 주의사항).
export default function PromotionCard({
  promotion,
  className = "",
}: PromotionCardProps) {
  const { type, title, startDate, endDate, target, caution, imageUrl } =
    promotion;

  const isDiscount = type === "discount";

  return (
    <article className={`card overflow-hidden ${className}`}>
      {imageUrl ? (
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Badge color={isDiscount ? "red" : "green"}>
            {isDiscount ? "할인" : "증정"}
          </Badge>
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
        </div>

        <p className="mb-2 text-sm text-gray-600">
          <span className="font-medium text-gray-500">기간</span>{" "}
          {formatKoreanDate(startDate)} ~ {formatKoreanDate(endDate)}
        </p>

        {target ? (
          <p className="mb-1 text-sm text-gray-700">
            <span className="font-medium text-gray-500">대상</span> {target}
          </p>
        ) : null}

        {caution ? (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            주의: {caution}
          </p>
        ) : null}
      </div>
    </article>
  );
}
