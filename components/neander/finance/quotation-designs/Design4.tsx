"use client";
import { forwardRef } from "react";
import { DesignProps, formatDate, formatNumber, numberToKorean, BASE_STYLE, stampStyle, ReceiverDetails, ContactDetails, DocumentTerms } from "./shared";

/** Design 4: 클래식 보더 — 전통적인 테두리 박스형 견적서, 격식있는 느낌 */
const Design4 = forwardRef<HTMLDivElement, DesignProps>(
  ({ data, subtotal, vat, total }, ref) => {
    const dateFormatted = formatDate(data.date);
    const C = { dark: "#222", muted: "#666", border: "#ccc", light: "#fafafa" };
    return (
      <div ref={ref} className="quotation-design" data-design="4" style={{ ...BASE_STYLE, padding: "44px 52px", color: C.dark }}>
        {/* Outer Border */}
        <div className="qd-classic-frame" style={{ border: `2px solid ${C.dark}`, padding: "36px 40px", minHeight: "0" }}>
          {/* Title */}
          <div className="qd-heading" style={{ textAlign: "center", marginBottom: "28px" }}>
            <h1 style={{ fontSize: "34px", fontWeight: "800", letterSpacing: "16px", margin: "0", color: C.dark }}>견 적 서</h1>
            {data.title && <p style={{ fontSize: "13px", color: C.muted, margin: "8px 0 0" }}>{data.title}</p>}
          </div>

          {/* Info Grid: 2-col */}
          <div style={{ display: "flex", gap: "20px", marginBottom: "24px" }}>
            {/* Receiver Box */}
            <div style={{ flex: 1, border: `1px solid ${C.border}`, padding: "16px" }}>
              <p style={{ margin: "0 0 8px 0", fontSize: "11px", fontWeight: "700", color: C.muted, borderBottom: `1px solid ${C.border}`, paddingBottom: "4px" }}>수 신</p>
              <p style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "700" }}>{data.receiver.name} 귀하</p>
              {data.receiver.ceo && <p style={{ margin: "0", fontSize: "11px", color: C.muted }}>대표자: {data.receiver.ceo}</p>}
            <ReceiverDetails receiver={data.receiver} />
            </div>
            {/* Date & Amount Box */}
            <div style={{ flex: 1, border: `1px solid ${C.border}`, padding: "16px" }}>
              <p style={{ margin: "0 0 8px 0", fontSize: "11px", fontWeight: "700", color: C.muted, borderBottom: `1px solid ${C.border}`, paddingBottom: "4px" }}>견적 정보</p>
              <table style={{ fontSize: "11px", color: C.dark }}>
                <tbody>
                  {data.quoteNo && <tr><td style={{ padding: "2px 10px 2px 0", color: C.muted }}>견적번호</td><td style={{ padding: "2px 0" }}>{data.quoteNo}</td></tr>}
                  <tr><td style={{ padding: "2px 10px 2px 0", color: C.muted }}>견적일</td><td style={{ padding: "2px 0", fontWeight: "500" }}>{dateFormatted}</td></tr>
                  <tr><td style={{ padding: "2px 10px 2px 0", color: C.muted }}>견적 금액</td><td style={{ padding: "2px 0", fontWeight: "700", fontSize: "14px" }}>₩ {formatNumber(data.vatType === "excluded" ? subtotal : total)}</td></tr>
                  <tr><td style={{ padding: "2px 10px 2px 0", color: C.muted }}></td><td style={{ padding: "2px 0", fontSize: "10px", color: C.muted }}>({numberToKorean(data.vatType === "excluded" ? subtotal : total)}원 {data.vatType === "excluded" ? "/ VAT별도" : "/ VAT포함"})</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table */}
          <p className="qd-price-basis">단가·금액: {data.vatType === "included" ? "VAT 포함" : "VAT 별도"}</p>
        <table className="qd-items" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", border: `1px solid ${C.border}` }}>
            <thead>
              <tr style={{ backgroundColor: C.light }}>
                {[["No.", "center", "36px"], ["항목", "left", ""], ["규격", "left", "120px"], ["수량", "center", "46px"], ["단가", "right", "90px"], ["금액", "right", "100px"]].map(([l, a, w]) => (
                  <th key={l as string} style={{ padding: "9px 10px", textAlign: a as never, fontWeight: "600", border: `1px solid ${C.border}`, width: (w as string) || undefined, fontSize: "11px", color: C.dark }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id}>
                  <td style={{ padding: "9px 10px", textAlign: "center", border: `1px solid ${C.border}`, color: C.muted }}>{i + 1}</td>
                  <td style={{ padding: "9px 10px", border: `1px solid ${C.border}`, fontWeight: "500" }}>{item.name}{item.note && <span className="qd-line-note">{item.note}</span>}</td>
                  <td style={{ padding: "9px 10px", border: `1px solid ${C.border}`, color: C.muted, fontSize: "11px" }}>{item.spec || "-"}</td>
                  <td style={{ padding: "9px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>{item.quantity}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", border: `1px solid ${C.border}` }}>{formatNumber(item.unitPrice)}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", border: `1px solid ${C.border}`, fontWeight: "600" }}>{formatNumber(item.amount)}</td>
                </tr>
              ))}
              {/* Summary rows inside table */}
              <tr style={{ backgroundColor: C.light }}>
                <td colSpan={5} style={{ padding: "9px 10px", textAlign: "right", border: `1px solid ${C.border}`, fontWeight: "600", fontSize: "11px" }}>공급가액</td>
                <td style={{ padding: "9px 10px", textAlign: "right", border: `1px solid ${C.border}`, fontWeight: "600" }}>{formatNumber(subtotal)}원</td>
              </tr>
              {(
                <tr style={{ backgroundColor: C.light }}>
                  <td colSpan={5} style={{ padding: "9px 10px", textAlign: "right", border: `1px solid ${C.border}`, fontWeight: "600", fontSize: "11px" }}>부가세 (10%)</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", border: `1px solid ${C.border}`, fontWeight: "600" }}>{formatNumber(vat)}원</td>
                </tr>
              )}
              <tr style={{ backgroundColor: C.dark }}>
                <td colSpan={5} style={{ padding: "10px", textAlign: "right", fontWeight: "700", fontSize: "13px", color: "#fff" }}>합 계</td>
                <td style={{ padding: "10px", textAlign: "right", fontWeight: "800", fontSize: "15px", color: "#fff" }}>{formatNumber(total)}원</td>
              </tr>
            </tbody>
          </table>

          {data.note && (
            <div className="qd-note" style={{ marginTop: "20px", padding: "12px 14px", border: `1px solid ${C.border}`, fontSize: "12px" }}>
              <p style={{ margin: "0 0 4px 0", fontWeight: "600", fontSize: "11px", color: C.muted }}>비고</p>
              <p style={{ margin: "0", whiteSpace: "pre-wrap" }}>{data.note}</p>
            </div>
          )}

          <div className="qd-spacer" style={{ height: "36px" }} />

          {/* Sender */}
          <div className="qd-supplier" style={{ borderTop: `1px solid ${C.border}`, paddingTop: "20px", display: "flex", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: "0 0 4px 0", fontSize: "11px", color: C.muted, fontWeight: "600" }}>공급자</p>
              <p style={{ margin: "0 0 10px 0", fontSize: "17px", fontWeight: "700" }}>{data.sender.name}</p>
              <table style={{ fontSize: "11px", borderCollapse: "collapse", color: "#4a4a4a" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "2px 12px 2px 0", color: C.muted, whiteSpace: "nowrap", verticalAlign: "top" }}>대표자</td>
                    <td style={{ padding: "2px 0", position: "relative" }}>
                      {data.sender.ceo}{data.sender.hasSeal && <span style={{ marginLeft: "8px", color: "#aaa" }}>(인)</span>}
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
          </div>

          <div className="qd-footer" style={{ marginTop: "28px", paddingTop: "10px", borderTop: `1px solid ${C.border}`, textAlign: "center", fontSize: "10px", color: "#aaa" }}>
            <DocumentTerms data={data} />
          </div>
        </div>
      </div>
    );
  }
);
Design4.displayName = "Design4";
export default Design4;
