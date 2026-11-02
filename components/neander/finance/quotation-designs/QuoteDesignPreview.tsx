"use client";

import { forwardRef } from "react";
import { formatQuoteNo, quoteLineAmount, quoteTotals, type FinQuoteInput } from "@/lib/neander/finance/docs";
import { resolveSeal } from "@/lib/neander/finance/supplier";
import { useSealImage } from "@/lib/neander/finance/seal-image";
import Design1 from "./Design1";
import Design2 from "./Design2";
import Design3 from "./Design3";
import Design4 from "./Design4";
import Design5 from "./Design5";
import type { QuotationDesignData } from "./shared";

export { QUOTE_DESIGN_CSS } from "./styles";

export const QUOTE_DESIGNS = [
  { id: 1, name: "기본", desc: "깔끔한 화이트" },
  { id: 2, name: "다크 헤더", desc: "진한 상단 바" },
  { id: 3, name: "블루 액센트", desc: "파란색 포인트" },
  { id: 4, name: "클래식", desc: "테두리 박스형" },
  { id: 5, name: "심플", desc: "극도의 미니멀" },
] as const;

const designs = [Design1, Design2, Design3, Design4, Design5];

/** Source app's five paper designs, backed by the ERP's single calculation model. */
export const QuoteDesignPreview = forwardRef<HTMLDivElement, { value: FinQuoteInput }>(function QuoteDesignPreview({ value: q }, ref) {
  const totals = quoteTotals(q);
  const seal = resolveSeal(q.sealId);
  const sealImage = useSealImage(seal?.id);
  const Design = designs[(q.design ?? 1) - 1] ?? Design1;
  const data: QuotationDesignData = {
    title: q.title,
    date: q.date,
    quoteNo: formatQuoteNo(q.quoteNo),
    sender: {
      ...q.supplier,
      bizNumber: q.supplier.bizNo,
      stamp: sealImage.src ?? "",
      hasSeal: !!seal,
    },
    receiver: {
      name: q.recipient,
      ceo: q.receiver?.ceo ?? "",
      bizNumber: q.receiver?.bizNo ?? "",
      address: q.receiver?.address ?? "",
    },
    items: q.lines.map((line) => ({
      id: line.id,
      name: line.name,
      spec: line.spec ?? "",
      quantity: line.qty,
      unitPrice: line.unitPrice,
      amount: quoteLineAmount(line),
      note: line.note ?? "",
    })),
    vatType: q.vatMode,
    note: q.note ?? "",
    delivery: q.delivery ?? "",
    payment: q.payment ?? "",
    validity: q.validity ?? "",
  };
  return <Design ref={ref} data={data} subtotal={totals.supply} vat={totals.vat} total={totals.total} />;
});
