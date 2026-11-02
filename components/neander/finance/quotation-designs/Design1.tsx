"use client";
import { forwardRef } from "react";
import { DesignProps, formatDate, formatNumber, numberToKorean, BASE_STYLE, stampStyle, ReceiverDetails, ContactDetails, DocumentTerms, DocumentNumber } from "./shared";

const Design1 = forwardRef<HTMLDivElement, DesignProps>(
  ({ data, subtotal, vat, total }, ref) => {
    const dateFormatted = formatDate(data.date);
    return (
      <div ref={ref} className="quotation-design" data-design="1" style={{ ...BASE_STYLE, padding: "48px 56px", color: "#1a1a2e" }}>
        <div className="qd-heading" style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "38px", fontWeight: "700", letterSpacing: "4px", margin: "0 0 8px 0", color: "#1a1a2e" }}>견 적 서</h1>
          {data.title && <p style={{ fontSize: "15px", color: "#636e72", margin: "0" }}>{data.title}</p>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
          <div>
            <p style={{ margin: "0 0 12px 0", fontSize: "13px" }}>{dateFormatted}</p>
            <DocumentNumber value={data.quoteNo} />
            <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginBottom: "8px" }}>
              <span style={{ fontSize: "22px", fontWeight: "700" }}>{data.receiver.name}</span>
              <span style={{ fontSize: "15px", color: "#636e72" }}> 귀하</span>
            </div>
            {data.receiver.ceo && <p style={{ margin: "0", fontSize: "12px", color: "#636e72" }}>대표자: {data.receiver.ceo}</p>}
            <ReceiverDetails receiver={data.receiver} />
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#636e72" }}>견적 금액</p>
            <p style={{ margin: "0 0 2px 0", fontSize: "28px", fontWeight: "800", color: "#1a1a2e" }}>₩ {formatNumber(data.vatType === "excluded" ? subtotal : total)}</p>
            <p style={{ margin: "0", fontSize: "11px", color: "#636e72" }}>({numberToKorean(data.vatType === "excluded" ? subtotal : total)}원 {data.vatType === "excluded" ? "/ 부가세 별도" : "/ 부가세 포함"})</p>
          </div>
        </div>
        <div style={{ height: "2px", backgroundColor: "#1a1a2e", marginBottom: "24px" }} />
        <p className="qd-price-basis">단가·금액: {data.vatType === "included" ? "VAT 포함" : "VAT 별도"}</p>
        <table className="qd-items" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0", fontSize: "12px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f8f9fa" }}>
              {[["No.", "center", "40px"], ["항목", "left", ""], ["규격", "left", "140px"], ["수량", "center", "50px"], ["단가", "right", "100px"], ["금액", "right", "110px"]].map(([label, align, w]) => (
                <th key={label} style={{ padding: "10px 12px", textAlign: align as never, fontWeight: "600", borderTop: "1px solid #dfe6e9", borderBottom: "1px solid #dfe6e9", width: w || undefined, color: "#636e72", fontSize: "11px" }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={item.id}>
                <td style={{ padding: "10px 12px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: "#636e72" }}>{i + 1}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", fontWeight: "500" }}>{item.name}{item.note && <span className="qd-line-note">{item.note}</span>}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", color: "#636e72", fontSize: "11px" }}>{item.spec || "-"}</td>
                <td style={{ padding: "10px 12px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{item.quantity}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{formatNumber(item.unitPrice)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", borderBottom: "1px solid #f0f0f0", fontWeight: "600" }}>{formatNumber(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ borderTop: "2px solid #1a1a2e", paddingTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
            <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
              <span style={{ color: "#636e72", fontSize: "12px" }}>공급가액</span>
              <span style={{ fontWeight: "600", minWidth: "100px", textAlign: "right" }}>{formatNumber(subtotal)}원</span>
            </div>
          </div>
          {(
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
                <span style={{ color: "#636e72", fontSize: "12px" }}>부가세 (10%)</span>
                <span style={{ fontWeight: "600", minWidth: "100px", textAlign: "right" }}>{formatNumber(vat)}원</span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #dfe6e9", paddingTop: "8px" }}>
            <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
              <span style={{ fontWeight: "700", fontSize: "13px" }}>합계</span>
              <span style={{ fontWeight: "800", fontSize: "16px", minWidth: "100px", textAlign: "right" }}>{formatNumber(total)}원</span>
            </div>
          </div>
        </div>
        {data.note && (
          <div className="qd-note" style={{ marginTop: "24px", padding: "16px", backgroundColor: "#f8f9fa", borderRadius: "8px", fontSize: "12px" }}>
            <p style={{ margin: "0 0 4px 0", fontWeight: "600", color: "#636e72", fontSize: "11px" }}>비고</p>
            <p style={{ margin: "0", whiteSpace: "pre-wrap" }}>{data.note}</p>
          </div>
        )}
        <div className="qd-spacer" style={{ height: "40px" }} />
        <div style={{ borderTop: "1px solid #dfe6e9", paddingTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 4px 0", fontSize: "11px", color: "#636e72", fontWeight: "600" }}>공급자</p>
              <p style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: "700" }}>{data.sender.name}</p>
              <table style={{ fontSize: "11px", borderCollapse: "collapse", color: "#4a4a4a" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "2px 12px 2px 0", color: "#636e72", whiteSpace: "nowrap", verticalAlign: "top" }}>대표자</td>
                    <td style={{ padding: "2px 0", position: "relative" }}>
                      {data.sender.ceo}{data.sender.hasSeal && <span style={{ marginLeft: "8px", color: "#999" }}>(인)</span>}
                      {data.sender.stamp && <img src={data.sender.stamp} alt="인감" style={stampStyle(data.sender.ceo.length)}  />}
                    </td>
                  </tr>
                  <tr><td style={{ padding: "2px 12px 2px 0", color: "#636e72", whiteSpace: "nowrap", verticalAlign: "top" }}>사업자번호</td><td style={{ padding: "2px 0" }}>{data.sender.bizNumber}</td></tr>
                  <tr><td style={{ padding: "2px 12px 2px 0", color: "#636e72", whiteSpace: "nowrap", verticalAlign: "top" }}>소재지</td><td style={{ padding: "2px 0" }}>{data.sender.address}</td></tr>
                  <tr><td style={{ padding: "2px 12px 2px 0", color: "#636e72", whiteSpace: "nowrap", verticalAlign: "top" }}>업태</td><td style={{ padding: "2px 0" }}>{data.sender.bizType}</td></tr>
                  <tr><td style={{ padding: "2px 12px 2px 0", color: "#636e72", whiteSpace: "nowrap", verticalAlign: "top" }}>종목</td><td style={{ padding: "2px 0" }}>{data.sender.bizItem}</td></tr>
                </tbody>
              </table>
          <ContactDetails sender={data.sender} />
            </div>
          </div>
        </div>
        <div className="qd-footer" style={{ marginTop: "32px", paddingTop: "12px", borderTop: "1px solid #f0f0f0", textAlign: "center", fontSize: "10px", color: "#b2bec3" }}>
          <DocumentTerms data={data} />
        </div>
      </div>
    );
  }
);
Design1.displayName = "Design1";
export default Design1;
