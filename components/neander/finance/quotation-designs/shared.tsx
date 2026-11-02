import type { CSSProperties } from "react";
import { koreanDate, koreanNumber } from "@/lib/neander/finance/docs";

export interface QuotationDesignData {
  title: string;
  date: string;
  quoteNo: string;
  sender: {
    name: string;
    ceo: string;
    bizNumber: string;
    address: string;
    bizType: string;
    bizItem: string;
    contact: string;
    phone: string;
    stamp: string;
    hasSeal: boolean;
  };
  receiver: { name: string; ceo: string; bizNumber: string; address: string };
  items: { id: string; name: string; spec: string; quantity: number; unitPrice: number; amount: number; note: string }[];
  vatType: "included" | "excluded";
  note: string;
  delivery: string;
  payment: string;
  validity: string;
}

export interface DesignProps {
  data: QuotationDesignData;
  subtotal: number;
  vat: number;
  total: number;
}

export const formatDate = koreanDate;
export const formatNumber = (n: number): string => n.toLocaleString("ko-KR");
export const numberToKorean = koreanNumber;

export const BASE_STYLE: CSSProperties = {
  width: "100%",
  minHeight: "1000px",
  backgroundColor: "#fff",
  fontFamily: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  fontSize: "13px",
  lineHeight: 1.6,
  boxSizing: "border-box",
};

export function stampStyle(ceoLength: number): CSSProperties {
  return {
    position: "absolute",
    width: "68px",
    height: "68px",
    objectFit: "contain",
    top: "-22px",
    left: `${ceoLength * 11 + 16}px`,
    opacity: 0.9,
    pointerEvents: "none",
    mixBlendMode: "multiply",
  };
}

export function DocumentNumber({ value }: { value: string }) {
  return value ? <p className="qd-number" style={{ margin: "4px 0 0", fontSize: "11px", opacity: 0.75 }}>견적번호: {value}</p> : null;
}

export function ReceiverDetails({ receiver }: { receiver: QuotationDesignData["receiver"] }) {
  if (!receiver.bizNumber && !receiver.address) return null;
  return (
    <div className="qd-receiver-details" style={{ marginTop: "6px", fontSize: "11px", lineHeight: 1.6, color: "#636e72" }}>
      {receiver.bizNumber && <p style={{ margin: 0 }}>사업자번호: {receiver.bizNumber}</p>}
      {receiver.address && <p style={{ margin: 0 }}>{receiver.address}</p>}
    </div>
  );
}

export function ContactDetails({ sender }: { sender: QuotationDesignData["sender"] }) {
  return sender.contact || sender.phone ? (
    <p className="qd-contact" style={{ margin: "8px 0 0", fontSize: "11px", color: "#636e72" }}>
      {sender.contact && <>담당자: {sender.contact}</>}
      {sender.contact && sender.phone && " · "}
      {sender.phone && <>연락처: {sender.phone}</>}
    </p>
  ) : null;
}

export function DocumentTerms({ data }: { data: QuotationDesignData }) {
  const rows = [["납품기한", data.delivery], ["대금 지불방식", data.payment], ["견적 유효기간", data.validity]].filter(([, value]) => value);
  if (!rows.length) return null;
  return (
    <dl className="qd-terms" style={{ margin: 0, textAlign: "left", color: "#636e72", fontSize: "11px" }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", gap: "12px", margin: "3px 0" }}>
          <dt style={{ flex: "0 0 90px", fontWeight: 500 }}>{label}</dt>
          <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

