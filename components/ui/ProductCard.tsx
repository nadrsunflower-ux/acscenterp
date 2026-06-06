import Image from "next/image";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/date";

export interface ProductCardProps {
  product: Product;
  className?: string;
}

// Product 한 건을 카드로 표시.
export default function ProductCard({ product, className = "" }: ProductCardProps) {
  const { name, tagline, prices, composition, note, imageUrl } = product;

  return (
    <article
      className={`card flex flex-col overflow-hidden ${className}`}
    >
      {imageUrl ? (
        <div className="relative aspect-[4/3] w-full bg-gray-100">
          <Image
            src={imageUrl}
            alt={name}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2">
          <h3 className="text-base font-bold text-gray-900">{name}</h3>
          {tagline ? (
            <p className="mt-0.5 text-sm text-gray-500">{tagline}</p>
          ) : null}
        </div>

        {prices.length > 0 ? (
          <ul className="mb-3 space-y-1">
            {prices.map((p) => (
              <li
                key={p.label}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-gray-600">{p.label}</span>
                <span className="font-semibold text-gray-900">
                  {formatPrice(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-gray-500">가격: 이벤트별 상이</p>
        )}

        <div className="mt-auto space-y-1 border-t border-gray-100 pt-3 text-sm">
          <p className="text-gray-800">{composition}</p>
          {note ? (
            <p className="text-xs text-orange-600">* {note}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
