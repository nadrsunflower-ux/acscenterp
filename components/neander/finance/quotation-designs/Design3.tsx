"use client";
import { forwardRef } from "react";
import { DesignProps, formatDate, formatNumber, numberToKorean, BASE_STYLE, stampStyle, ReceiverDetails, ContactDetails, DocumentTerms, DocumentNumber } from "./shared";

/** Design 3: 블루 액센트 — 파란색 포인트와 좌측 수직 라인 */
const Design3 = forwardRef<HTMLDivElement, DesignProps>(
  ({ data, subtotal, vat, total }, ref) => {
    const dateFormatted = formatDate(data.date);
    const C = { blue: "#0984e3", dark: "#2d3436", muted: "#636e72", light: "#f0f6ff" };
    return (
      <div ref={ref} className="quotation-design" data-design="3" style={{ ...BASE_STYLE, padding: "48px 56px", color: C.dark }}>
        {/* Left blue accent bar */}
        <div className="qd-heading" style={{ display: "flex", gap: "24px" }}>
          <div style={{ width: "4px", backgroundColor: C.blue, borderRadius: "2px", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "11px", color: C.blue, fontWeight: "700", letterSpacing: "2px" }}>QUOTATION</p>
            <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "6px", margin: "0", color: C.dark }}>견적서</h1>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ margin: "0", fontSize: "12px", color: C.muted }}>{dateFormatted}</p>
            <DocumentNumber value={data.quoteNo} />
          </div>
        </div>

        {data.title && <p style={{ margin: "12px 0 0 28px", fontSize: "14px", color: C.muted }}>{data.title}</p>}

        {/* Amount Banner */}
        <div className="qd-hero" style={{ margin: "28px 0 24px", padding: "20px 24px", backgroundColor: C.light, borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", borderLeft: `4px solid ${C.blue}` }}>
          <div>
            <p style={{ margin: "0 0 2px 0", fontSize: "11px", color: C.blue, fontWeight: "600" }}>견적 금액</p>
            <p style={{ margin: "0", fontSize: "11px", color: C.muted }}>({numberToKorean(data.vatType === "excluded" ? subtotal : total)}원 {data.vatType === "excluded" ? "/ 부가세 별도" : "/ 부가세 포함"})</p>
          </div>
          <p style={{ margin: "0", fontSize: "30px", fontWeight: "800", color: C.dark }}>₩ {formatNumber(data.vatType === "excluded" ? subtotal : total)}</p>
        </div>

        {/* Receiver */}
        <div style={{ marginBottom: "24px" }}>
          <p style={{ margin: "0 0 6px 0", fontSize: "11px", color: C.blue, fontWeight: "600" }}>수신</p>
          <p style={{ margin: "0", fontSize: "18px", fontWeight: "700" }}>{data.receiver.name} <span style={{ fontSize: "13px", color: C.muted, fontWeight: "400" }}>귀하</span></p>
          {data.receiver.ceo && <p style={{ margin: "2px 0 0", fontSize: "12px", color: C.muted }}>대표자: {data.receiver.ceo}</p>}
            <ReceiverDetails receiver={data.receiver} />
        </div>

        {/* Table */}
        <p className="qd-price-basis">단가·금액: {data.vatType === "included" ? "VAT 포함" : "VAT 별도"}</p>
        <table className="qd-items" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr>
              {[["No.", "center", "36px"], ["항목", "left", ""], ["규격", "left", "130px"], ["수량", "center", "48px"], ["단가", "right", "96px"], ["금액", "right", "108px"]].map(([l, a, w]) => (
                <th key={l as string} style={{ padding: "10px", textAlign: a as never, fontWeight: "600", borderTop: `2px solid ${C.blue}`, borderBottom: `1px solid #ddd`, width: (w as string) || undefined, color: C.blue, fontSize: "11px" }}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={item.id}>
                <td style={{ padding: "10px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: C.muted }}>{i + 1}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0", fontWeight: "500" }}>{item.name}{item.note && <span className="qd-line-note">{item.note}</span>}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0", color: C.muted, fontSize: "11px" }}>{item.spec || "-"}</td>
                <td style={{ padding: "10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{item.quantity}</td>
                <td style={{ padding: "10px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{formatNumber(item.unitPrice)}</td>
                <td style={{ padding: "10px", textAlign: "right", borderBottom: "1px solid #f0f0f0", fontWeight: "600" }}>{formatNumber(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div style={{ borderTop: `2px solid ${C.blue}`, paddingTop: "12px" }}>
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
          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #ddd", paddingTop: "8px" }}>
            <span style={{ fontWeight: "700", fontSize: "13px", width: "80px", color: C.blue }}>합계</span>
            <span style={{ fontWeight: "800", fontSize: "16px", width: "120px", textAlign: "right" }}>{formatNumber(total)}원</span>
          </div>
        </div>

        {data.note && (
          <div className="qd-note" style={{ marginTop: "24px", padding: "14px 16px", backgroundColor: C.light, borderRadius: "6px", fontSize: "12px" }}>
            <p style={{ margin: "0 0 4px 0", fontWeight: "600", color: C.blue, fontSize: "11px" }}>비고</p>
            <p style={{ margin: "0", whiteSpace: "pre-wrap" }}>{data.note}</p>
          </div>
        )}

        <div className="qd-spacer" style={{ height: "40px" }} />

        {/* Sender */}
        <div className="qd-supplier" style={{ borderTop: "1px solid #e0e0e0", paddingTop: "24px" }}>
          <p style={{ margin: "0 0 4px 0", fontSize: "11px", color: C.blue, fontWeight: "600" }}>공급자</p>
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
    );
  }
);
Design3.displayName = "Design3";
export default Design3;
