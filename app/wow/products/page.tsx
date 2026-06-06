"use client";

// 악센트 와우 - 운영 상품.
import { useEffect, useState } from "react";

import Section from "@/components/ui/Section";
import ProductCard from "@/components/ui/ProductCard";
import { listProducts } from "@/lib/db";
import type { Product } from "@/lib/types";
import { defaultProducts } from "@/lib/defaults";

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
    </div>
  );
}
