// ============================================================
//  월간 재무 보고 슬라이드 — 임원 회의용 16:9
// ------------------------------------------------------------
//  1 커버 · 2 이번 달 한 장 · 3 핵심 요약 · 4 월별 추이 · 5 수입 구성 ·
//  6 지출 구성 · 7 전월 대비 변동 · 8 사업부별 손익 · 9 지출 상위 거래처 ·
//  10 확인할 것 · 11 집계 기준
//  (인사이트 장·장별 한 줄은 deck/insight-slides — 리포트 화면에서 만든 해설)
//
//  숫자는 lib/neander/finance/monthlyDeck.ts 가 리포트 표와 같은 엔진으로
//  만든다. 여기서는 그리기만 한다. 음수는 - (색만으로 부호를 전하지 않는다).
// ============================================================
import type { DeckSlide } from "@/components/neander/deck/Deck";
import { DK, Kicker, Panel, Reveal, Slide, Tag } from "@/components/neander/deck/parts";
import { BarRows, C, Delta, Header, monthNum, won } from "@/components/neander/deck/report-parts";
import type { MonthlyDeckData } from "@/lib/neander/finance/monthlyDeck";
import { InsightComment, insightOnePager, insightRisks } from "@/components/neander/deck/insight-slides";
import type { InsightDoc } from "@/lib/neander/insights/types";
import { BASIS_HINT, BASIS_LABEL, type Basis } from "@/lib/neander/finance/report";
import { monthLabel, shortWon } from "@/lib/neander/format";
import {
  FinAccountLineDrill,
  FinTotalDrill,
  FinUnitDrill,
  FinVendorDrill,
  type FinDeckScope,
  type FinTotalCol,
} from "@/components/neander/finance/DeckDrills";

export function buildSlides(
  d: MonthlyDeckData,
  ctx: { basis: Basis; siteLabel: string; site?: string },
  insight: InsightDoc | null = null,
  /** 인사이트 만들기·고치기·지우기 창을 연다 — 없으면 인사이트 장은 읽기만 */
  onManageInsight?: () => void,
): DeckSlide[] {
  const t = d.total;
  const p = d.prevTotal;
  const label = monthLabel(d.month);
  const scopeLine = `${BASIS_LABEL[ctx.basis]} · ${ctx.siteLabel}`;
  // 숫자 드릴의 조건 — buildMonthlyDeck 에 넘긴 것과 같아야 창 합계가 슬라이드 숫자와 맞는다
  const scope: FinDeckScope = { month: d.month, basis: ctx.basis, site: ctx.site };

  // ---- 1. 커버 ----
  const cover: DeckSlide = {
    id: "cover",
    chapter: "커버",
    render: () => (
      <Slide style={{ justifyContent: "space-between" }}>
        <div aria-hidden className="dk-mono" style={{ position: "absolute", right: 40, top: 30, fontSize: 320, fontWeight: 800, lineHeight: 1, color: "transparent", WebkitTextStroke: "1.5px rgba(148,163,184,.14)", userSelect: "none" }}>
          {d.month.slice(5, 7)}
        </div>
        <Reveal i={0}>
          <Kicker>NEANDER · Monthly Finance Report</Kicker>
        </Reveal>
        <div>
          <Reveal i={1}>
            <h1 className="dk-serif" style={{ margin: 0, fontSize: 96, lineHeight: 1.1, fontWeight: 900, letterSpacing: "-0.015em" }}>
              {label}
              <br />
              <span style={{ background: `linear-gradient(92deg, ${DK.smoat}, #7c5cff)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                재무 보고
              </span>
            </h1>
          </Reveal>
          <Reveal i={2}>
            <p style={{ margin: "26px 0 0", fontSize: 22, color: DK.sub, lineHeight: 1.55 }}>
              수입 {shortWon(t.income)}원 · 순수지출 {shortWon(t.expensePure)}원 · 순금액{" "}
              <b style={{ color: t.net < 0 ? C.bad : C.net }}>{shortWon(t.net)}원</b>
            </p>
          </Reveal>
        </div>
        <Reveal i={3}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Tag>{BASIS_LABEL[ctx.basis]}</Tag>
            <Tag color="rgba(238,240,233,.5)">{ctx.siteLabel}</Tag>
            <Tag color="rgba(238,240,233,.4)">{d.usedCount.toLocaleString("ko-KR")}건 집계</Tag>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: DK.faint }}>← → 넘기기 · F 전체화면 · [ ] 다른 달 · Esc 나가기</span>
          </div>
        </Reveal>
      </Slide>
    ),
  };

  // ---- 2. 핵심 요약 ----
  const kpi = (name: string, value: number, prev: number, good: boolean, color: string, hint: string, col: FinTotalCol) => (
    <Panel accent={color} style={{ flex: 1, padding: "28px 30px" }}>
      <div style={{ fontSize: 16, color: DK.sub, fontWeight: 600 }}>{name}</div>
      <div style={{ marginTop: 14, fontSize: 50, fontWeight: 800, color: value < 0 ? C.bad : DK.ink, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        <FinTotalDrill scope={scope} col={col}>
          {shortWon(value)}<span style={{ fontSize: 22, color: DK.sub, marginLeft: 4 }}>원</span>
        </FinTotalDrill>
      </div>
      <div style={{ marginTop: 6, fontSize: 15, color: DK.faint, fontVariantNumeric: "tabular-nums" }}>{won(value)}원 · {hint}</div>
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${DK.line}` }}>
        <div style={{ fontSize: 12, color: DK.faint, marginBottom: 4 }}>전월({monthNum(d.prevMonth)}) 대비</div>
        <Delta cur={value} prev={prev} good={good} hasPrev={d.hasPrev} size={16} />
      </div>
    </Panel>
  );
  const summary: DeckSlide = {
    id: "summary",
    chapter: "핵심 요약",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="01 · Summary" title={`${label} 한눈에`} aside={scopeLine} />
        <InsightComment doc={insight} chapter="핵심 요약" />
        <Reveal i={1}>
          <div style={{ display: "flex", gap: 20 }}>
            {kpi("수입", t.income, p.income, true, C.income, `${t.count.toLocaleString("ko-KR")}건`, "income")}
            {kpi("순수지출", t.expensePure, p.expensePure, false, C.expense, "개인사용·환급 차감", "expensePure")}
            {kpi("순금액", t.net, p.net, true, t.net < 0 ? C.bad : C.net, "수입 − 순수지출", "net")}
          </div>
        </Reveal>
        <Reveal i={2}>
          <div style={{ display: "flex", gap: 36, marginTop: 28, fontSize: 15, color: DK.sub }}>
            <span>지출 총액 <b style={{ color: DK.ink }}><FinTotalDrill scope={scope} col="expense">{won(t.expense)}원</FinTotalDrill></b></span>
            <span>개인사용 <b style={{ color: t.personal ? DK.amber : DK.ink }}>{won(t.personal)}원</b></span>
            <span>환급 <b style={{ color: DK.ink }}>{won(t.refund)}원</b></span>
          </div>
        </Reveal>
        {/* 이 달의 숫자를 읽기 전에 알아야 할 것 — 발표마다 달라지는 기준·범위만 여기로.
            고정된 용어 정의는 부록(집계 기준)에 둔다 (2026-09-15 사용자 결정) */}
        <Reveal i={3}>
          <div
            style={{
              marginTop: 22,
              paddingTop: 14,
              borderTop: `1px solid ${DK.line}`,
              display: "flex",
              flexWrap: "wrap",
              gap: "6px 28px",
              fontSize: 13,
              color: DK.faint,
            }}
          >
            <span>
              <b style={{ color: DK.sub, fontWeight: 600 }}>집계 기준</b> {BASIS_LABEL[ctx.basis]} — {BASIS_HINT[ctx.basis]}
            </span>
            <span>
              <b style={{ color: DK.sub, fontWeight: 600 }}>범위</b> {label} ·{" "}
              <span style={{ color: ctx.site ? DK.amber : DK.faint }}>{ctx.siteLabel}</span> · 자금거래(계좌 간 이동) 제외
            </span>
          </div>
        </Reveal>
      </Slide>
    ),
  };

  // ---- 3. 월별 추이 ----
  const trendTop = Math.max(1, ...d.trend.flatMap((m) => [m.income, m.expense]));
  const CH = 300;
  const trend: DeckSlide = {
    id: "trend",
    chapter: "월별 추이",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header
          kicker="02 · Trend"
          title={`최근 ${d.trend.length}개월 수입·지출`}
          aside={
            <span style={{ display: "inline-flex", gap: 18 }}>
              <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: C.income, marginRight: 6 }} />수입</span>
              <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: C.expense, marginRight: 6 }} />순수지출</span>
            </span>
          }
        />
        <InsightComment doc={insight} chapter="월별 추이" />
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "flex-end", flex: 1, borderBottom: `1px solid ${DK.line}`, paddingBottom: 0 }}>
          {d.trend.map((m, i) => {
            const on = m.month === d.month;
            const bar = (v: number, color: string, col: FinTotalCol) => (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: on ? DK.ink : DK.sub, fontVariantNumeric: "tabular-nums" }}>
                  <FinTotalDrill scope={scope} col={col} month={m.month}>{shortWon(v)}</FinTotalDrill>
                </span>
                <div
                  className="dk-rise"
                  style={{ "--i": i, width: 46, height: Math.max(2, (Math.max(0, v) / trendTop) * CH), background: color, opacity: on ? 1 : 0.45, borderRadius: "6px 6px 0 0" } as React.CSSProperties}
                />
              </div>
            );
            return (
              <div key={m.month} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                {bar(m.income, C.income, "income")}
                {bar(m.expense, C.expense, "expensePure")}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 12 }}>
          {d.trend.map((m) => {
            const on = m.month === d.month;
            return (
              <div key={m.month} style={{ width: 100, textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: on ? 800 : 600, color: on ? DK.smoat : DK.sub }}>{monthNum(m.month)}</div>
                <div style={{ fontSize: 13, marginTop: 3, color: m.net < 0 ? C.bad : DK.sub, fontVariantNumeric: "tabular-nums" }}>
                  순 <FinTotalDrill scope={scope} col="net" month={m.month}>{shortWon(m.net)}</FinTotalDrill>
                </div>
              </div>
            );
          })}
        </div>
      </Slide>
    ),
  };

  // ---- 4. 수입 구성 ----
  const income: DeckSlide = {
    id: "income",
    chapter: "수입 구성",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="03 · Income" color={C.income} title={<>수입 <span style={{ color: C.income }}>{won(t.income)}원</span></>} aside={scopeLine} />
        <InsightComment doc={insight} chapter="수입 구성" />
        <BarRows
          lines={d.income}
          total={t.income}
          color={C.income}
          good
          hasPrev={d.hasPrev}
          renderValue={(line, node) => (
            <FinAccountLineDrill scope={scope} line={line} col="income">
              {node}
            </FinAccountLineDrill>
          )}
        />
      </Slide>
    ),
  };

  // ---- 5. 지출 구성 ----
  const expense: DeckSlide = {
    id: "expense",
    chapter: "지출 구성",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="04 · Expense" color={C.expense} title={<>순수지출 <span style={{ color: C.expense }}>{won(t.expensePure)}원</span></>} aside={<>계정 대분류 · 개인사용·환급 차감<br />{scopeLine}</>} />
        <InsightComment doc={insight} chapter="지출 구성" />
        <BarRows
          lines={d.expenseMajors}
          total={t.expensePure}
          color={C.expense}
          good={false}
          hasPrev={d.hasPrev}
          renderValue={(line, node) => (
            <FinAccountLineDrill scope={scope} line={line} col="expensePure">
              {node}
            </FinAccountLineDrill>
          )}
        />
      </Slide>
    ),
  };

  // ---- 6. 전월 대비 변동 ----
  const movers = d.movers.slice(0, 8).map((l) => ({ ...l, diff: l.value - l.prev }));
  const moverTop = Math.max(1, ...movers.map((m) => Math.abs(m.diff)));
  const changes: DeckSlide = {
    id: "changes",
    chapter: "전월 대비 변동",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="05 · Movers" color={DK.amber} title={`${monthNum(d.prevMonth)}보다 크게 달라진 지출`} aside={<>계정 중분류 · 순수지출 기준<br />변동폭 큰 순</>} />
        <InsightComment doc={insight} chapter="전월 대비 변동" />
        {!d.hasPrev || movers.length === 0 ? (
          <div style={{ fontSize: 18, color: DK.faint, padding: "80px 0", textAlign: "center" }}>
            {d.hasPrev ? "전월과 달라진 계정이 없습니다." : "전월 자료가 없어 비교할 수 없습니다."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {movers.map((m, i) => {
              const up = m.diff > 0;
              const w = (Math.abs(m.diff) / moverTop) * 50;
              return (
                <Reveal key={m.label + i} i={i + 1}>
                  <div style={{ display: "grid", gridTemplateColumns: "230px 1fr 240px", gap: 20, alignItems: "center", height: 40 }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ fontSize: 17, fontWeight: 700 }}>{m.label}</span>
                      <span style={{ fontSize: 12, color: DK.faint, marginLeft: 8 }}>{m.parent}</span>
                    </div>
                    <div style={{ position: "relative", height: 16 }}>
                      <div style={{ position: "absolute", left: "50%", top: -6, bottom: -6, width: 1, background: DK.line }} />
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          height: 16,
                          borderRadius: 4,
                          width: `${w}%`,
                          left: up ? "50%" : `${50 - w}%`,
                          background: up ? C.bad : C.income,
                        }}
                      />
                    </div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: up ? C.bad : C.income }}>
                        {up ? "+" : "−"}{Math.abs(m.diff).toLocaleString("ko-KR")}원
                      </div>
                      <div style={{ fontSize: 12, color: DK.faint }}>
                        {won(m.prev)} →{" "}
                        <FinAccountLineDrill scope={scope} line={m} col="expensePure">{won(m.value)}</FinAccountLineDrill>
                      </div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: DK.faint, margin: "4px 250px 0 250px" }}>
              <span>◀ 줄어듦</span><span>늘어남 ▶</span>
            </div>
          </div>
        )}
      </Slide>
    ),
  };

  // ---- 7. 사업부별 손익 ----
  const unitRows = d.units.slice(0, 9);
  const units: DeckSlide = {
    id: "units",
    chapter: "사업부별 손익",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="06 · Business Units" title="사업부별 손익" aside={<>공용비 배분 전 · 순수지출 기준<br />{scopeLine}</>} />
        <InsightComment doc={insight} chapter="사업부별 손익" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 190px 190px 210px", fontSize: 12.5, color: DK.faint, padding: "0 20px 8px", borderBottom: `1px solid ${DK.line}` }}>
          <span>사업부</span><span style={{ textAlign: "right" }}>수입(원)</span><span style={{ textAlign: "right" }}>순수지출(원)</span><span style={{ textAlign: "right" }}>순금액(원)</span>
        </div>
        {unitRows.map((u, i) => (
          <Reveal key={u.label} i={i + 1}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 190px 190px 210px", alignItems: "center", height: 44, padding: "0 20px", borderBottom: `1px solid ${DK.line}`, fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ fontWeight: 700 }}>{u.label}</span>
              <span style={{ textAlign: "right", color: u.income ? DK.ink : DK.faint }}>
                {u.income ? <FinUnitDrill scope={scope} label={u.label} col="income">{won(u.income)}</FinUnitDrill> : "—"}
              </span>
              <span style={{ textAlign: "right", color: u.expense ? DK.ink : DK.faint }}>
                {u.expense ? <FinUnitDrill scope={scope} label={u.label} col="expensePure">{won(u.expense)}</FinUnitDrill> : "—"}
              </span>
              <span style={{ textAlign: "right", fontWeight: 800, color: u.net < 0 ? C.bad : C.net }}>
                <FinUnitDrill scope={scope} label={u.label} col="net">{won(u.net)}</FinUnitDrill>
              </span>
            </div>
          </Reveal>
        ))}
        <Reveal i={unitRows.length + 1}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 190px 190px 210px", alignItems: "center", height: 48, padding: "0 20px", background: DK.panel, borderRadius: 10, marginTop: 8, fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            <span>합계{d.units.length > unitRows.length ? ` (외 ${d.units.length - unitRows.length}개 포함)` : ""}</span>
            <span style={{ textAlign: "right" }}><FinTotalDrill scope={scope} col="income">{won(t.income)}</FinTotalDrill></span>
            <span style={{ textAlign: "right" }}><FinTotalDrill scope={scope} col="expensePure">{won(t.expensePure)}</FinTotalDrill></span>
            <span style={{ textAlign: "right", color: t.net < 0 ? C.bad : C.net }}><FinTotalDrill scope={scope} col="net">{won(t.net)}</FinTotalDrill></span>
          </div>
        </Reveal>
      </Slide>
    ),
  };

  // ---- 8. 거래처 ----
  const vTop = Math.max(1, ...d.vendors.map((v) => v.amount));
  const vendors: DeckSlide = {
    id: "vendors",
    chapter: "지출 상위 거래처",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="07 · Vendors" color={C.expense} title="지출 상위 거래처 10" aside={<>인건비·개인사용 제외 · 환급 차감<br />{scopeLine}</>} />
        <InsightComment doc={insight} chapter="지출 상위 거래처" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 48, rowGap: 14 }}>
          {d.vendors.map((v, i) => (
            <Reveal key={v.vendor} i={i + 1}>
              <div style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", gap: 12, alignItems: "center" }}>
                <span className="dk-mono" style={{ fontSize: 14, color: i < 3 ? C.expense : DK.faint }}>{String(i + 1).padStart(2, "0")}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.vendor}</div>
                  <div style={{ height: 6, marginTop: 7, borderRadius: 99, background: "rgba(148,163,184,.08)" }}>
                    <div className="dk-grow" style={{ "--i": i, height: "100%", width: `${(v.amount / vTop) * 100}%`, background: C.expense, borderRadius: 99, opacity: i < 3 ? 1 : 0.6 } as React.CSSProperties} />
                  </div>
                </div>
                <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>
                    <FinVendorDrill scope={scope} vendor={v.vendor}>{won(v.amount)}</FinVendorDrill>
                  </div>
                  <div style={{ fontSize: 12, color: DK.faint }}>{v.count}건</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        {d.vendors.length === 0 && <div style={{ fontSize: 18, color: DK.faint, padding: "80px 0", textAlign: "center" }}>이 달에 잡힌 지출이 없습니다.</div>}
      </Slide>
    ),
  };

  // ---- 9. 집계 기준 ----
  const basisSlide: DeckSlide = {
    id: "basis",
    chapter: "집계 기준",
    render: () => (
      <Slide>
        <Header kicker="Appendix" title="이 자료의 숫자를 읽는 법" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {[
            // 발표마다 달라지는 「집계 기준」·「범위」는 핵심 요약 장 아래로 옮겼다
            ["순수지출", "지출 총액에서 임직원 개인사용분과 환급을 뺀 값"],
            ["순금액", "수입 − 순수지출. 리포트 › 지출상세 표와 같은 계산"],
            ["대시보드 순손익과 차이", "대시보드는 개인사용을 비용으로 둔다. 그래서 개인사용분만큼 낮다"],
            ["사업부 손익", "공용·홍대공용 비용은 배분 전 숫자. 배분 후는 리포트 › 사업부에서 본다"],
          ].map(([h, body], i) => (
            <Reveal key={h} i={i + 1}>
              <Panel style={{ height: "100%" }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: DK.ink }}>{h}</div>
                <div style={{ fontSize: 15, color: DK.sub, marginTop: 6, lineHeight: 1.55 }}>{body}</div>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Slide>
    ),
  };

  // ---- 인사이트 — 리포트 화면에서 만든 해설 (커버 뒤 한 장 · 집계 기준 앞 확인할 것) ----
  const insightCtx = { label, accent: DK.smoat, kicker: "Insight", onManage: onManageInsight };

  return [
    cover,
    insightOnePager(insight, insightCtx),
    summary,
    trend,
    income,
    expense,
    changes,
    units,
    vendors,
    insightRisks(insight, { ...insightCtx, kicker: "Watch" }),
    basisSlide,
  ];
}
