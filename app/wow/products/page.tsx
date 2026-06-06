"use client";

// 악센트 와우 - 상품 및 결제 (운영 상품 + 환불 안내).
import { useEffect, useState } from "react";

import Section from "@/components/ui/Section";
import ProductCard from "@/components/ui/ProductCard";
import RefundMethods from "@/components/id/RefundMethods";
import { listProducts } from "@/lib/db";
import type { Product } from "@/lib/types";
import { defaultProducts } from "@/lib/defaults";
import { refund } from "@/lib/content";

const FALLBACK_PRODUCTS = defaultProducts.filter((p) => p.store === "wow");

export default function WowProductsPage() {
  const [products, setProducts] = useState<Product[]>(FALLBACK_PRODUCTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const prods = await listProducts("wow");
        if (!alive) return;
        if (prods.length > 0) setProducts(prods.filter((p) => p.active));
      } catch {
        // 패칭 실패 시 정적 폴백 유지
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* 운영 상품 */}
      <Section
        title="운영 상품"
        subtitle={`총 ${products.length}종${loaded ? "" : " · 불러오는 중…"}`}
      >
        {products.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">등록된 상품이 없습니다.</p>
        )}
      </Section>

      {/* 환불 안내 */}
      <Section title="환불 안내" subtitle="환불 규정 및 처리 방법">
        <div className="mb-4 rounded-xl bg-brand-light px-4 py-3">
          <div className="mb-1 text-xs font-semibold text-brand-dark">
            환불 규정
          </div>
          <p className="text-sm font-medium text-gray-900">{refund.policy}</p>
        </div>
        <h3 className="mb-2 text-sm font-bold text-gray-900">환불 방법</h3>
        <RefundMethods methods={refund.methods} />
      </Section>
    </div>
  );
}
