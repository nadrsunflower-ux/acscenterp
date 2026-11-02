"use client";
import { forwardRef } from "react";
import { DesignProps, formatDate, formatNumber, numberToKorean, BASE_STYLE, stampStyle, ReceiverDetails, ContactDetails, DocumentTerms, DocumentNumber } from "./shared";

/** Design 5: 울트라 심플 — 극도로 여백 많고 타이포 중심, 가장 미니멀 */
const Design5 = forwardRef<HTMLDivElement, DesignProps>(
  ({ data, subtotal, vat, total }, ref) => {
    const dateFormatted = formatDate(data.date);
    const C = { dark: "#111", muted: "#999", line: "#e5e5e5" };
    return (
      <div ref={ref} className="quotation-design" data-design="5" style={{ ...BASE_STYLE, padding: "60px 64px", color: C.dark }}>
        {/* Header: minimal */}
        <div className="qd-heading" style={{ marginBottom: "48px" }}>
          <p style={{ margin: "0 0 6px 0", fontSize: "11px", color: C.muted, letterSpacing: "3px" }}>{dateFormatted}</p>
            <DocumentNumber value={data.quoteNo} />
          <h1 style={{ fontSize: "36px", fontWeight: "300", letterSpacing: "2px", margin: "0 0 6px 0", color: C.dark }}>견적서</h1>
          {data.title && <p style={{ fontSize: "14px", color: C.muted, margin: "0", fontWeight: "400" }}>{data.title}</p>}
        </div>

        {/* Big Amount */}
        <div className="qd-hero" style={{ marginBottom: "48px" }}>
          <p style={{ margin: "0", fontSize: "42px", fontWeight: "200", color: C.dark, letterSpacing: "-1px" }}>
            ₩ {formatNumber(data.vatType === "excluded" ? subtotal : total)}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: C.muted }}>
            {numberToKorean(data.vatType === "excluded" ? subtotal : total)}원정 {data.vatType === "excluded" ? "(부가세 별도)" : "(부가세 포함)"}
          </p>
        </div>

        {/* Receiver - single line */}
        <div style={{ marginBottom: "40px", paddingBottom: "20px", borderBottom: `1px solid ${C.line}` }}>
          <p style={{ margin: "0", fontSize: "12px", color: C.muted }}>
            수신: <span style={{ color: C.dark, fontWeight: "600", fontSize: "15px" }}>{data.receiver.name}</span> 귀하
            {data.receiver.ceo && <span style={{ marginLeft: "12px", color: C.muted, fontSize: "12px" }}>({data.receiver.ceo})</span>}
          </p>
          <ReceiverDetails receiver={data.receiver} />
        </div>

        {/* Table - ultra clean */}
        <p className="qd-price-basis">단가·금액: {data.vatType === "included" ? "VAT 포함" : "VAT 별도"}</p>
        <table className="qd-items" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr>
              {[["항목", "left", ""], ["규격", "left", "140px"], ["수량", "center", "50px"], ["단가", "right", "100px"], ["금액", "right", "110px"]].map(([l, a, w]) => (
                <th key={l as string} style={{ padding: "8px 0", textAlign: a as never, fontWeight: "400", borderBottom: `1px solid ${C.dark}`, width: (w as string) || undefined, color: C.muted, fontSize: "11px", letterSpacing: "1px" }}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}`, fontWeight: "500" }}>{item.name}{item.note && <span className="qd-line-note">{item.note}</span>}</td>
                <td style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}`, color: C.muted, fontSize: "11px" }}>{item.spec || "-"}</td>
                <td style={{ padding: "12px 0", textAlign: "center", borderBottom: `1px solid ${C.line}` }}>{item.quantity}</td>
                <td style={{ padding: "12px 0", textAlign: "right", borderBottom: `1px solid ${C.line}` }}>{formatNumber(item.unitPrice)}</td>
                <td style={{ padding: "12px 0", textAlign: "right", borderBottom: `1px solid ${C.line}`, fontWeight: "500" }}>{formatNumber(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div style={{ borderTop: `1px solid ${C.dark}`, marginTop: "0", paddingTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
            <span style={{ color: C.muted, fontSize: "12px", width: "72px" }}>공급가액</span>
            <span style={{ fontWeight: "400", width: "120px", textAlign: "right" }}>{formatNumber(subtotal)}</span>
          </div>
          {(
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
              <span style={{ color: C.muted, fontSize: "12px", width: "72px" }}>부가세</span>
              <span style={{ fontWeight: "400", width: "120px", textAlign: "right" }}>{formatNumber(vat)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "8px", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontWeight: "500", fontSize: "13px", width: "72px" }}>합계</span>
            <span style={{ fontWeight: "600", fontSize: "16px", width: "120px", textAlign: "right" }}>{formatNumber(total)}원</span>
          </div>
        </div>

        {data.note && (
          <div className="qd-note" style={{ marginTop: "32px", fontSize: "12px", color: C.muted }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "11px", letterSpacing: "1px" }}>비고</p>
            <p style={{ margin: "0", whiteSpace: "pre-wrap", color: C.dark }}>{data.note}</p>
          </div>
        )}

        <div className="qd-spacer" style={{ height: "60px" }} />

        {/* Sender */}
        <div className="qd-supplier" style={{ borderTop: `1px solid ${C.line}`, paddingTop: "28px" }}>
          <p style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "600" }}>{data.sender.name}</p>
          <table style={{ fontSize: "11px", borderCollapse: "collapse", color: "#555" }}>
            <tbody>
              <tr>
                <td style={{ padding: "2px 14px 2px 0", color: C.muted, whiteSpace: "nowrap", verticalAlign: "top" }}>대표자</td>
                <td style={{ padding: "2px 0", position: "relative" }}>
                  {data.sender.ceo}{data.sender.hasSeal && <span style={{ marginLeft: "8px", color: "#ccc" }}>(인)</span>}
                  {data.sender.stamp && <img src={data.sender.stamp} alt="인감" style={stampStyle(data.sender.ceo.length)}  />}
                </td>
              </tr>
              <tr><td style={{ padding: "2px 14px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>사업자번호</td><td style={{ padding: "2px 0" }}>{data.sender.bizNumber}</td></tr>
              <tr><td style={{ padding: "2px 14px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>소재지</td><td style={{ padding: "2px 0" }}>{data.sender.address}</td></tr>
              <tr><td style={{ padding: "2px 14px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>업태</td><td style={{ padding: "2px 0" }}>{data.sender.bizType}</td></tr>
              <tr><td style={{ padding: "2px 14px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>종목</td><td style={{ padding: "2px 0" }}>{data.sender.bizItem}</td></tr>
            </tbody>
          </table>
          <ContactDetails sender={data.sender} />
        </div>

        <div className="qd-footer" style={{ marginTop: "36px", textAlign: "center", fontSize: "10px", color: "#ccc" }}>
          <DocumentTerms data={data} />
        </div>
      </div>
    );
  }
);
Design5.displayName = "Design5";
export default Design5;
