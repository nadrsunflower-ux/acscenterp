"use client";
import { forwardRef } from "react";
import { DesignProps, formatDate, formatNumber, numberToKorean, BASE_STYLE, stampStyle, ReceiverDetails, ContactDetails, DocumentTerms, DocumentNumber } from "./shared";

/** Design 2: 다크 헤더 — 상단에 진한 네이비 바, 모던한 대비감 */
const Design2 = forwardRef<HTMLDivElement, DesignProps>(
  ({ data, subtotal, vat, total }, ref) => {
    const dateFormatted = formatDate(data.date);
    const C = { bg: "#1a1a2e", accent: "#1a1a2e", muted: "#8395a7", light: "#f1f2f6" };
    return (
      <div ref={ref} className="quotation-design" data-design="2" style={{ ...BASE_STYLE, padding: "0", color: "#2d3436" }}>
        {/* Dark Header */}
        <div className="qd-dark-header" style={{ backgroundColor: C.bg, padding: "40px 56px 32px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <p style={{ margin: "0 0 4px 0", fontSize: "11px", opacity: 0.6, letterSpacing: "2px", textTransform: "uppercase" }}>QUOTATION</p>
              <h1 style={{ fontSize: "38px", fontWeight: "700", letterSpacing: "4px", margin: "0 0 16px 0" }}>견 적 서</h1>
              {data.title && <p style={{ fontSize: "14px", opacity: 0.7, margin: "0" }}>{data.title}</p>}
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: "0 0 4px 0", fontSize: "11px", opacity: 0.5 }}>{dateFormatted}</p>
            <DocumentNumber value={data.quoteNo} />
              <p style={{ margin: "0", fontSize: "32px", fontWeight: "800" }}>₩ {formatNumber(data.vatType === "excluded" ? subtotal : total)}</p>
              <p style={{ margin: "4px 0 0", fontSize: "11px", opacity: 0.5 }}>({numberToKorean(data.vatType === "excluded" ? subtotal : total)}원 {data.vatType === "excluded" ? "/ VAT 별도" : "/ VAT 포함"})</p>
            </div>
          </div>
        </div>

        <div className="qd-body" style={{ padding: "32px 56px 48px" }}>
          {/* Receiver */}
          <div style={{ marginBottom: "28px", paddingBottom: "20px", borderBottom: `1px solid ${C.light}` }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "11px", color: C.muted, fontWeight: "600", letterSpacing: "1px" }}>수신</p>
            <p style={{ margin: "0", fontSize: "20px", fontWeight: "700" }}>{data.receiver.name} <span style={{ fontSize: "14px", fontWeight: "400", color: C.muted }}>귀하</span></p>
            {data.receiver.ceo && <p style={{ margin: "4px 0 0", fontSize: "12px", color: C.muted }}>대표자: {data.receiver.ceo}</p>}
            <ReceiverDetails receiver={data.receiver} />
          </div>

          {/* Table */}
          <p className="qd-price-basis">단가·금액: {data.vatType === "included" ? "VAT 포함" : "VAT 별도"}</p>
        <table className="qd-items" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr>
                {[["No.", "center", "36px"], ["항목", "left", ""], ["규격", "left", "130px"], ["수량", "center", "48px"], ["단가", "right", "96px"], ["금액", "right", "108px"]].map(([l, a, w]) => (
                  <th key={l as string} style={{ padding: "10px 10px", textAlign: a as never, fontWeight: "600", borderBottom: `2px solid ${C.bg}`, width: (w as string) || undefined, color: C.bg, fontSize: "11px" }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} style={{ backgroundColor: i % 2 === 0 ? "#fff" : C.light }}>
                  <td style={{ padding: "10px", textAlign: "center", color: C.muted, fontSize: "11px" }}>{i + 1}</td>
                  <td style={{ padding: "10px", fontWeight: "500" }}>{item.name}{item.note && <span className="qd-line-note">{item.note}</span>}</td>
                  <td style={{ padding: "10px", color: C.muted, fontSize: "11px" }}>{item.spec || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "center" }}>{item.quantity}</td>
                  <td style={{ padding: "10px", textAlign: "right" }}>{formatNumber(item.unitPrice)}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontWeight: "600" }}>{formatNumber(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary */}
          <div style={{ marginTop: "16px", borderTop: `2px solid ${C.bg}`, paddingTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
              <span style={{ color: C.muted, fontSize: "12px", width: "80px" }}>공급가액</span>
              <span style={{ fontWeight: "600", width: "120px", textAlign: "right" }}>{formatNumber(subtotal)}원</span>
            </div>
            {(
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
                <span style={{ color: C.muted, fontSize: "12px", width: "80px" }}>부가세</span>
                <span style={{ fontWeight: "600", width: "120px", textAlign: "right" }}>{formatNumber(vat)}원</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: `1px solid #ddd`, paddingTop: "8px", marginTop: "4px" }}>
              <span style={{ fontWeight: "700", fontSize: "13px", width: "80px" }}>합계</span>
              <span style={{ fontWeight: "800", fontSize: "16px", width: "120px", textAlign: "right" }}>{formatNumber(total)}원</span>
            </div>
          </div>

          {data.note && (
            <div className="qd-note" style={{ marginTop: "24px", padding: "14px 16px", backgroundColor: C.light, borderRadius: "6px", fontSize: "12px", borderLeft: `3px solid ${C.bg}` }}>
              <p style={{ margin: "0 0 4px 0", fontWeight: "600", color: C.muted, fontSize: "11px" }}>비고</p>
              <p style={{ margin: "0", whiteSpace: "pre-wrap" }}>{data.note}</p>
            </div>
          )}

          <div className="qd-spacer" style={{ height: "40px" }} />

          {/* Sender */}
          <div className="qd-supplier" style={{ borderTop: "1px solid #eee", paddingTop: "24px" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "11px", color: C.muted, fontWeight: "600", letterSpacing: "1px" }}>공급자</p>
            <p style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: "700" }}>{data.sender.name}</p>
            <table style={{ fontSize: "11px", borderCollapse: "collapse", color: "#4a4a4a" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "2px 12px 2px 0", color: C.muted, whiteSpace: "nowrap", verticalAlign: "top" }}>대표자</td>
                  <td style={{ padding: "2px 0", position: "relative" }}>
                    {data.sender.ceo}{data.sender.hasSeal && <span style={{ marginLeft: "8px", color: "#bbb" }}>(인)</span>}
                    {data.sender.stamp && <img src={data.sender.stamp} alt="인감" style={stampStyle(data.sender.ceo.length)}  />}
                  </td>
                </tr>
                <tr><td style={{ padding: "2px 12px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>사업자번호</td><td style={{ padding: "2px 0" }}>{data.sender.bizNumber}</td></tr>
                <tr><td style={{ padding: "2px 12px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>소재지</td><td style={{ padding: "2px 0" }}>{data.sender.address}</td></tr>
                <tr><td style={{ padding: "2px 12px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>업태</td><td style={{ padding: "2px 0" }}>{data.sender.bizType}</td></tr>
                <tr><td style={{ padding: "2px 12px 2px 0", color: C.muted, whiteSpace: "nowrap" }}>종목</td><td style={{ padding: "2px 0" }}>{data.sender.bizItem}</td></tr>
              </tbody>
            </table>
          <ContactDetails sender={data.sender} />
          </div>
          <div className="qd-footer" style={{ marginTop: "32px", paddingTop: "12px", borderTop: "1px solid #f0f0f0", textAlign: "center", fontSize: "10px", color: "#b2bec3" }}>
            <DocumentTerms data={data} />
          </div>
        </div>
      </div>
    );
  }
);
Design2.displayName = "Design2";
export default Design2;
