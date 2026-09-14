"use client";

// ============================================================
//  상품 사진 — 썸네일 · 상세 · 표 칸
// ------------------------------------------------------------
//  세 화면(상품 관리 · 상품 수익성 · 검토 대기함)이 「이름 + 옵션 2줄」을
//  각자 복제하고 있었다. 한 부품으로 모으고 그 왼쪽에 사진을 붙인다.
//
//  사진은 acscent.co.kr 공식 원본을 화면 크기로 줄인 것이다
//  (lib/neander/sales/product-image.ts). 유형에 사진이 없거나 로드에
//  실패하면 **중립 아이콘**으로 내려간다 — 비슷한 다른 상품 사진으로
//  메우지 않는다.
//
//  next/image 를 쓰지 않는 이유: 이 저장소는 images.unoptimized 라
//  최적화가 꺼져 있어 얻는 것이 없고, 표 칸 안에서 크기를 정확히 잡는
//  쪽이 낫다. 대신 표시 크기를 픽셀로 고정하고 lazy 로 받는다.
// ============================================================

import { useState, type ReactNode } from "react";
import { Boxes as BoxesIcon, FileText, Flower2, Package, SprayCan, Ticket } from "lucide-react";
import { Icon, cn, type LucideIcon } from "@/components/neander/ui";
import { productImage, type ProductKindKey } from "@/lib/neander/sales/product-image";
import type { SalesProduct } from "@/lib/neander/sales/types";
// ============================================================
//  상품 사진
// ------------------------------------------------------------
//  세 화면(상품 관리 · 상품 수익성 · 검토 대기함)이 「이름 + 옵션 2줄」을
//  각자 복제하고 있었다. 한 부품으로 모으고 그 왼쪽에 사진을 붙인다.
//
//  사진은 acscent.co.kr 공식 원본이다 (product-image.ts). 유형에 사진이
//  없거나 로드에 실패하면 **중립 아이콘**으로 내려간다 — 비슷한 다른
//  상품 사진으로 메우지 않는다.
//
//  next/image 를 쓰지 않는 이유: 이 저장소는 images.unoptimized 라
//  최적화가 꺼져 있어 얻는 것이 없고, 표 칸 안에서 크기를 정확히 잡는
//  쪽이 낫다. 대신 표시 크기를 픽셀로 고정하고 lazy 로 받는다.
// ============================================================


/** 사진이 없는 유형의 중립 아이콘 — 기존 앱의 lucide 체계를 그대로 쓴다 */
const FALLBACK_ICON: Record<ProductKindKey, LucideIcon> = {
  perfume10: SprayCan,
  perfume50: SprayCan,
  set10: BoxesIcon,
  set50: BoxesIcon,
  scentPaper: FileText,
  diffuser: Flower2,
  sachet: Package,
  ticket: Ticket,
  etc: Package,
};

const THUMB_PX = { sm: 40, md: 48, lg: 64 } as const;

/**
 * 상품 썸네일. 옆에 상품명이 함께 있으면 alt="" (낭독기가 두 번 읽지 않게).
 * 이름 없이 사진만 두는 자리에서는 `labelled={false}` 로 alt 를 살린다.
 */
export function ProductThumb({
  product,
  size = "sm",
  labelled = true,
  className,
}: {
  product: SalesProduct;
  size?: keyof typeof THUMB_PX;
  /** 옆에 상품명이 이미 있는가 */
  labelled?: boolean;
  className?: string;
}) {
  const img = productImage(product);
  const [failed, setFailed] = useState(false);
  const px = THUMB_PX[size];
  const src = failed ? undefined : img.thumb;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-nd-sm border border-nd-line bg-white",
        className,
      )}
      style={{ width: px, height: px }}
      title={!src ? img.reason : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={labelled ? "" : img.alt}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Icon
          icon={FALLBACK_ICON[img.kind]}
          size={Math.round(px * 0.45)}
          className="text-nd-fg-3"
          label={labelled ? undefined : img.alt}
        />
      )}
    </span>
  );
}

/** 상세 패널용 큰 사진 — 가용 폭에 맞추고 잘라내지 않는다 */
export function ProductHero({ product, className }: { product: SalesProduct; className?: string }) {
  const img = productImage(product);
  const [failed, setFailed] = useState(false);
  const src = failed ? undefined : img.hero ?? img.thumb;
  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center overflow-hidden rounded-nd-lg border border-nd-line bg-white",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="flex flex-col items-center gap-1.5 px-4 text-center">
          <Icon icon={FALLBACK_ICON[img.kind]} size={30} className="text-nd-fg-4" />
          <span className="text-nd-micro text-nd-fg-3">{img.reason ?? "사진 없음"}</span>
        </span>
      )}
    </div>
  );
}

/**
 * 표 안의 상품 한 칸 — 사진 + 이름 + (옵션 · 코드) + 뱃지.
 * 세 화면이 같은 모양이라 여기서 한 번만 그린다.
 */
export function ProductCell({
  product,
  /** 이름 오른쪽 뱃지 (세트 · 단가 미확정 등) */
  badges,
  /** 둘째 줄 뒤에 덧붙일 것 */
  sub,
  size = "sm",
  showThumb = true,
  className,
}: {
  product: SalesProduct;
  badges?: ReactNode;
  sub?: ReactNode;
  size?: keyof typeof THUMB_PX;
  showThumb?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {showThumb && <ProductThumb product={product} size={size} />}
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="truncate text-nd-fg" title={product.name}>
            {product.name}
          </span>
          {badges}
        </span>
        <span className="block truncate text-nd-micro text-nd-fg-3">
          {product.option} · {product.id}
          {sub}
        </span>
      </span>
    </span>
  );
}
