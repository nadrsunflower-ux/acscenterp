// ============================================================
//  월간 매출 보고 슬라이드 — 임원 회의용 16:9
// ------------------------------------------------------------
//  1 커버 · 2 이번 달 한 장 · 3 핵심 요약 · 4 월별 추이 · 5 매장별 손익 ·
//  6 비용 구조 · 7 공헌이익 상위 상품 · 8 이벤트별 손익 · 9 확인할 것 · 10 집계 기준
//  (인사이트 장·장별 한 줄은 deck/insight-slides — 리포트 화면에서 만든 해설)
//
//  숫자는 lib/neander/sales/monthlyDeck.ts 가 매장 대시보드와 같은 집계로
//  만든다. 여기서는 그리기만 한다. 공용 표기는 deck/report-parts.
// ============================================================
import { useState, type CSSProperties, type ReactNode } from "react";
import type { PnlExplain } from "@/lib/neander/sales/pnl-explain";
import { CostDrill, EventDrill, EventTotalDrill, ProductDrill, StoreDrill } from "@/components/neander/sales/DeckDrills";
import type { DeckSlide } from "@/components/neander/deck/Deck";
import { DK, Kicker, Panel, Reveal, Slide, Tag } from "@/components/neander/deck/parts";
import { BarRows, C, Delta, Header, monthNum, won } from "@/components/neander/deck/report-parts";
import type { SalesDeckData } from "@/lib/neander/sales/monthlyDeck";
import { InsightComment, insightOnePager, insightRisks } from "@/components/neander/deck/insight-slides";
import type { InsightDoc } from "@/lib/neander/insights/types";
import { pct, storeLabel, type SalesStore } from "@/lib/neander/sales/types";
import { monthLabel, shortWon } from "@/lib/neander/format";

/** 어두운 캔버스용 매장 색 */
const STORE_DK: Record<SalesStore, string> = { id: DK.id, wow: DK.wow, online: DK.smoat };

const num: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

function Grid({ cols, children, head = false, total = false }: { cols: string; children: ReactNode; head?: boolean; total?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols,
        gap: 14,
        alignItems: "center",
        padding: "0 18px",
        ...(head
          ? { fontSize: 12.5, color: DK.faint, paddingBottom: 8, borderBottom: `1px solid ${DK.line}` }
          : total
            ? { height: 50, background: DK.panel, borderRadius: 10, marginTop: 8, fontSize: 17, fontWeight: 800 }
            : { minHeight: 48, borderBottom: `1px solid ${DK.line}`, fontSize: 17 }),
      }}
    >
      {children}
    </div>
  );
}

const StoreName = ({ store }: { store: SalesStore }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
    <i style={{ width: 9, height: 9, borderRadius: 99, background: STORE_DK[store] }} />
    {storeLabel(store)}
  </span>
);

/**
 * 월별 추이 막대 — 달 한 칸이 커서 영역이다. 커서를 두면 그 달의 영업이익이
 * 전월 대비 왜 바뀌었는지(pnl-explain) 판이 뜬다. 판은 캔버스(1280×720) 안
 * 절대 좌표라 Deck 의 scale 을 따라 함께 줄고 는다.
 */
function TrendBars({
  d,
  op,
  posTop,
  negTop,
  posH,
  negH,
}: {
  d: SalesDeckData;
  op: string;
  posTop: number;
  negTop: number;
  posH: number;
  negH: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = d.trend.length;
  const hovered = hover === null ? null : d.trend[hover];
  const ex = hovered ? d.explains[hovered.month] : undefined;

  return (
    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      {/* 안내 글자는 커서를 받지 않는다 — 오른쪽 끝 달(이번 달) 칸 위에 겹쳐서 커서를 가로챘다 */}
      <div style={{ position: "absolute", right: 0, top: -4, fontSize: 12, color: DK.faint, pointerEvents: "none" }}>
        막대에 커서를 두면 전월 대비 변화 이유
      </div>
      {/* 달 칸은 차트 영역 전체 높이를 차지한다 — 막대 위 빈 공간에 커서를 둬도 그 달이다.
          칸이 막대 높이만큼만 있으면 짧은 달·높은 달 위쪽에서 판이 뜨지 않았다 */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }} onMouseLeave={() => setHover(null)}>
        {d.trend.map((m, i) => {
          const on = m.month === d.month;
          const lit = hover === null ? on : hover === i;
          const up = Math.max(0, m.operating);
          const down = Math.max(0, -m.operating);
          return (
            <div
              key={m.month}
              onMouseEnter={() => setHover(i)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                cursor: "help",
                borderRadius: 12,
                background: hover === i ? "rgba(148,163,184,.08)" : "transparent",
                transition: "background .15s",
              }}
            >
              {/* 기준선 위 — 매출(옅게) · 영업이익(굵게) */}
              <div style={{ height: posH, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 6, borderBottom: `1px solid ${DK.line}` }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, color: DK.faint, fontVariantNumeric: "tabular-nums" }}>{shortWon(m.revenue)}</span>
                  <div
                    className="dk-rise"
                    style={{ "--i": i, width: 22, height: Math.max(2, (Math.max(0, m.revenue) / posTop) * posH * 0.92), background: C.income, opacity: lit ? 0.4 : 0.22, borderRadius: "4px 4px 0 0" } as CSSProperties}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  {m.operating >= 0 && (
                    <span style={{ fontSize: lit ? 19 : 16, fontWeight: 800, color: lit ? DK.ink : DK.sub, fontVariantNumeric: "tabular-nums" }}>
                      {shortWon(m.operating)}
                    </span>
                  )}
                  <div
                    className="dk-rise"
                    style={{ "--i": i, width: 58, height: up ? Math.max(2, (up / posTop) * posH * 0.92) : 0, background: op, opacity: lit ? 1 : 0.55, borderRadius: "7px 7px 0 0" } as CSSProperties}
                  />
                </div>
              </div>
              {/* 기준선 아래 — 손실 달의 영업이익 */}
              {negH > 0 && (
                <div style={{ height: negH, display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 6 }}>
                  <div style={{ width: 22 }} />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 58, height: down ? Math.max(2, (down / negTop) * negH * 0.8) : 0, background: C.bad, opacity: lit ? 1 : 0.6, borderRadius: "0 0 7px 7px" }} />
                    {down > 0 && (
                      <span style={{ fontSize: lit ? 19 : 16, fontWeight: 800, color: C.bad, fontVariantNumeric: "tabular-nums" }}>
                        {shortWon(m.operating)}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div style={{ textAlign: "center", paddingTop: 12, paddingBottom: 4 }}>
                <div style={{ fontSize: 16, fontWeight: on ? 800 : 600, color: on ? DK.wow : DK.sub }}>{monthNum(m.month)}</div>
                <div style={{ fontSize: 12, marginTop: 3, color: DK.faint, fontVariantNumeric: "tabular-nums" }}>
                  공헌 {shortWon(m.contribution)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hover !== null && ex && (
        <ExplainCard
          ex={ex}
          // 왼쪽 절반의 달은 오른쪽에, 오른쪽 절반의 달은 왼쪽에 — 막대를 가리지 않게
          style={
            hover < n / 2
              ? { left: `calc(${((hover + 1) / n) * 100}% + 8px)` }
              : { right: `calc(${((n - hover) / n) * 100}% + 8px)` }
          }
        />
      )}
    </div>
  );
}

/** 변화 이유 판 — 한 문장 요약 → 갈래별 영향(막대) → 무엇이 움직였나 */
function ExplainCard({ ex, style }: { ex: PnlExplain; style: CSSProperties }) {
  const dOp = ex.operating.cur - ex.operating.prev;
  const maxImpact = Math.max(1, ...ex.items.map((x) => Math.abs(x.impact)));
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        width: 470,
        maxHeight: "100%",
        overflowY: "auto",
        padding: "18px 20px",
        borderRadius: 14,
        background: "rgba(15,18,28,.97)",
        border: `1px solid ${DK.line}`,
        boxShadow: "0 24px 60px rgba(0,0,0,.55)",
        pointerEvents: "none",
        zIndex: 5,
        ...style,
      }}
    >
      <div style={{ fontSize: 12.5, color: DK.faint }}>
        {monthNum(ex.prevMonth)} → {monthNum(ex.month)} 영업이익
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        <span style={{ fontSize: 16, color: DK.sub }}>
          {shortWon(ex.operating.prev)} → {shortWon(ex.operating.cur)}원
        </span>
        {ex.hasPrev && (
          <span style={{ fontSize: 20, fontWeight: 800, color: dOp < 0 ? C.bad : C.income }}>
            {dOp >= 0 ? "+" : "−"}
            {shortWon(Math.abs(dOp))}원
          </span>
        )}
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.6, color: DK.ink }}>{ex.headline}</p>

      {ex.hasPrev && ex.items.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${DK.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
          {ex.items.map((x) => {
            const good = x.impact >= 0;
            return (
              <div key={x.key}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 92px", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: DK.ink }}>{x.label}</span>
                  {/* 가운데 기준선에서 좌(−)·우(+)로 뻗는 막대 */}
                  <span style={{ position: "relative", height: 8 }}>
                    <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: DK.line }} />
                    <span
                      style={{
                        position: "absolute",
                        top: 0,
                        height: 8,
                        borderRadius: 4,
                        background: good ? C.income : C.bad,
                        width: `${(Math.abs(x.impact) / maxImpact) * 50}%`,
                        ...(good ? { left: "50%" } : { right: "50%" }),
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, textAlign: "right", color: good ? C.income : C.bad, fontVariantNumeric: "tabular-nums" }}>
                    {good ? "+" : "−"}
                    {shortWon(Math.abs(x.impact))}
                  </span>
                </div>
                <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.55, color: DK.faint }}>
                  {x.label} {shortWon(x.prev)} → {shortWon(x.cur)}원
                  {x.details.slice(0, 3).map((t) => (
                    <div key={t}>· {t}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {ex.notes.map((t) => (
        <div key={t} style={{ marginTop: 10, fontSize: 11.5, color: DK.faint }}>{t}</div>
      ))}
      <div style={{ marginTop: 10, fontSize: 11, color: DK.faint }}>
        +는 영업이익을 올린 쪽, −는 내린 쪽 · 비용이 줄면 +
      </div>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 18, color: DK.faint, padding: "80px 0", textAlign: "center" }}>{children}</div>
);

export function buildSalesSlides(
  d: SalesDeckData,
  insight: InsightDoc | null = null,
  /** 인사이트 만들기·고치기·지우기 창을 연다 — 없으면 인사이트 장은 읽기만 */
  onManageInsight?: () => void,
): DeckSlide[] {
  const t = d.pnl.total;
  const p = d.prev.total;
  const label = monthLabel(d.month);
  const scopeLine = "판매 실적 기준 · 확정 매출이 이익률의 분모";

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
          <Kicker color={DK.wow}>NEANDER · Monthly Sales Report</Kicker>
        </Reveal>
        <div>
          <Reveal i={1}>
            <h1 className="dk-serif" style={{ margin: 0, fontSize: 96, lineHeight: 1.1, fontWeight: 900, letterSpacing: "-0.015em" }}>
              {label}
              <br />
              <span style={{ background: `linear-gradient(92deg, ${DK.wow}, #f472b6)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                매출 보고
              </span>
            </h1>
          </Reveal>
          <Reveal i={2}>
            <p style={{ margin: "26px 0 0", fontSize: 22, color: DK.sub, lineHeight: 1.55 }}>
              매출 {shortWon(t.revenue)}원 · 공헌이익 {shortWon(t.contribution)}원 · 영업이익{" "}
              <b style={{ color: t.operating < 0 ? C.bad : C.net }}>{shortWon(t.operating)}원</b>
            </p>
          </Reveal>
        </div>
        <Reveal i={3}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Tag color={DK.wow}>판매 실적 기준</Tag>
            <Tag color="rgba(238,240,233,.5)">아이디 · 와우 · 온라인</Tag>
            {t.reviewCount > 0 && <Tag color={DK.amber}>미확정 {t.reviewCount.toLocaleString("ko-KR")}건</Tag>}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: DK.faint }}>← → 넘기기 · F 전체화면 · [ ] 다른 달 · Esc 나가기</span>
          </div>
        </Reveal>
      </Slide>
    ),
  };

  // ---- 2. 핵심 요약 ----
  const kpi = (
    name: string,
    value: number,
    prev: number,
    color: string,
    hint: string,
    cell: "revenue" | "contribution" | "operating",
  ) => (
    <Panel accent={color} style={{ flex: 1, padding: "28px 30px" }}>
      <div style={{ fontSize: 16, color: DK.sub, fontWeight: 600 }}>{name}</div>
      <div style={{ marginTop: 14, fontSize: 50, fontWeight: 800, color: value < 0 ? C.bad : DK.ink, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        <StoreDrill month={d.month} pnl={d.pnl} cell={cell}>
          {shortWon(value)}<span style={{ fontSize: 22, color: DK.sub, marginLeft: 4 }}>원</span>
        </StoreDrill>
      </div>
      <div style={{ marginTop: 6, fontSize: 15, color: DK.faint, fontVariantNumeric: "tabular-nums" }}>{won(value)}원 · {hint}</div>
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${DK.line}` }}>
        <div style={{ fontSize: 12, color: DK.faint, marginBottom: 4 }}>전월({monthNum(d.prevMonth)}) 대비</div>
        <Delta cur={value} prev={prev} good hasPrev={d.hasPrev} size={16} />
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
        <Header kicker="01 · Summary" color={DK.wow} title={`${label} 한눈에`} aside={scopeLine} />
        <InsightComment doc={insight} chapter="핵심 요약" />
        <Reveal i={1}>
          <div style={{ display: "flex", gap: 20 }}>
            {kpi("매출", t.revenue, p.revenue, C.income, "적재된 판매 전부", "revenue")}
            {kpi("공헌이익", t.contribution, p.contribution, C.net, `이익률 ${pct(t.contributionRate)}`, "contribution")}
            {kpi("영업이익", t.operating, p.operating, t.operating < 0 ? C.bad : DK.id, `고정비 차감 후 · ${pct(t.operatingRate)}`, "operating")}
          </div>
        </Reveal>
        <Reveal i={2}>
          <div style={{ display: "flex", gap: 36, marginTop: 28, fontSize: 15, color: DK.sub }}>
            <span>확정 매출 <b style={{ color: DK.ink }}>{won(t.confirmedRevenue)}원</b></span>
            <span>
              미확정 <b style={{ color: t.pendingRevenue ? DK.amber : DK.ink }}>{won(t.pendingRevenue)}원</b>
              {t.reviewCount > 0 && ` · ${t.reviewCount.toLocaleString("ko-KR")}건`}
            </span>
            <span>손익분기 달성 <b style={{ color: DK.ink }}>{pct(t.bepAchieved)}</b></span>
          </div>
        </Reveal>
        {/* 이 달의 숫자를 읽기 전에 알아야 할 것 — 달마다 달라지는 두 가지만 여기로.
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
              <b style={{ color: DK.sub, fontWeight: 600 }}>이익률의 분모</b> 확정 매출만 ·{" "}
              <span style={{ color: t.pendingRevenue ? DK.amber : DK.faint }}>
                {t.pendingRevenue ? `미확정 ${won(t.pendingRevenue)}원은 이익률 계산에서 뺐다` : "미확정 없음"}
              </span>
            </span>
            <span>
              <b style={{ color: DK.sub, fontWeight: 600 }}>인건비 출처</b>{" "}
              <span style={{ color: laborLine.includes("가정값") ? DK.amber : DK.faint }}>
                {laborLine || "이 달에 잡힌 인건비가 없다"}
              </span>
            </span>
          </div>
        </Reveal>
      </Slide>
    ),
  };

  // ---- 3. 월별 추이 ----
  //  주인공은 영업이익이다 — 결국 현금으로 얼마 남았나가 판단의 기준이라서
  //  (2026-09-15 사용자 결정). 영업이익은 굵고 밝은 막대 + 큰 숫자, 매출은 규모를
  //  가늠하는 옅고 가는 막대로 곁에 두고, 공헌이익은 달 이름 아래 작은 글자로 내린다.
  //  손실 달은 기준선 아래로 붉게 내려가야 "남기지 못한 달"이 한눈에 보인다.
  const OP = DK.id;
  const posTop = Math.max(1, ...d.trend.flatMap((m) => [m.revenue, m.operating]));
  const negTop = Math.max(0, ...d.trend.map((m) => -m.operating));
  const CH = 300;
  const posH = (CH * posTop) / (posTop + negTop);
  const negH = CH - posH;
  const cur = d.trend.find((m) => m.month === d.month);
  const prevOp = d.trend.find((m) => m.month === d.prevMonth)?.operating ?? p.operating;
  const trend: DeckSlide = {
    id: "trend",
    chapter: "월별 추이",
    // 막대에 커서를 두면 변화 이유가 뜬다 — 가장자리 클릭존이 3월·8월 막대를 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header
          kicker="02 · Trend"
          color={DK.wow}
          title={`최근 ${d.trend.length}개월 영업이익`}
          aside={
            <span style={{ display: "inline-flex", gap: 18 }}>
              <span><i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: OP, marginRight: 6 }} />영업이익</span>
              <span style={{ opacity: 0.7 }}><i style={{ display: "inline-block", width: 8, height: 12, borderRadius: 2, background: C.income, opacity: 0.35, marginRight: 6 }} />매출 (규모)</span>
            </span>
          }
        />
        <InsightComment doc={insight} chapter="월별 추이" />

        {/* 이번 달 영업이익 — 막대를 읽기 전에 답부터 */}
        {cur && (
          <Reveal i={1}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 22, marginBottom: 6 }}>
              <span style={{ fontSize: 15, color: DK.sub, fontWeight: 600 }}>{monthNum(d.month)} 영업이익</span>
              <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em", color: cur.operating < 0 ? C.bad : OP, fontVariantNumeric: "tabular-nums" }}>
                {shortWon(cur.operating)}<span style={{ fontSize: 20, color: DK.sub, marginLeft: 4 }}>원</span>
              </span>
              <span style={{ fontSize: 15, color: DK.faint, fontVariantNumeric: "tabular-nums" }}>
                영업이익률 {pct(t.operatingRate)} · 매출 {shortWon(cur.revenue)}원
              </span>
              <span style={{ fontSize: 15 }}>
                <Delta cur={cur.operating} prev={prevOp} good hasPrev={d.hasPrev} size={15} />
              </span>
            </div>
          </Reveal>
        )}

        <TrendBars d={d} op={OP} posTop={posTop} negTop={negTop} posH={posH} negH={negH} />
      </Slide>
    ),
  };

  // ---- 4. 매장별 손익 ----
  const STORE_COLS = "150px 1fr 1fr 1fr 84px 1fr 1fr 96px";
  const storeRows = d.pnl.stores.filter((s) => s.revenue !== 0 || s.fixedTotal !== 0 || s.variable.total !== 0);
  const stores: DeckSlide = {
    id: "stores",
    chapter: "매장별 손익",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="03 · Stores" color={DK.wow} title="매장별 손익" aside={<>단위: 원 · 이익률은 확정 매출 기준<br />고정비 = 공통비 배부 + 상시 인건비</>} />
        <InsightComment doc={insight} chapter="매장별 손익" />
        <Grid cols={STORE_COLS} head>
          <span>매장</span><span style={num}>매출</span><span style={num}>변동비</span><span style={num}>공헌이익</span>
          <span style={num}>이익률</span><span style={num}>고정비</span><span style={num}>영업이익</span><span style={num}>BEP 달성</span>
        </Grid>
        {storeRows.map((s, i) => (
          <Reveal key={s.store} i={i + 1}>
            <Grid cols={STORE_COLS}>
              <div style={{ padding: "8px 0" }}>
                <StoreName store={s.store} />
                <div style={{ fontSize: 12, color: s.reviewCount ? DK.amber : DK.faint, marginTop: 2 }}>
                  {s.reviewCount ? `미확정 ${s.reviewCount.toLocaleString("ko-KR")}건` : `인건비 ${s.labor.source === "actual" ? "실측" : "가정값"}`}
                </div>
              </div>
              <span style={num}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="revenue">{won(s.revenue)}</StoreDrill></span>
              <span style={{ ...num, color: DK.sub }}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="variable">{won(s.variable.total)}</StoreDrill></span>
              <span style={{ ...num, fontWeight: 700 }}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="contribution">{won(s.contribution)}</StoreDrill></span>
              <span style={{ ...num, color: DK.sub }}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="rate">{pct(s.contributionRate)}</StoreDrill></span>
              <span style={{ ...num, color: DK.sub }}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="fixed">{won(s.fixedTotal)}</StoreDrill></span>
              <span style={{ ...num, fontWeight: 800, color: s.operating < 0 ? C.bad : C.net }}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="operating">{won(s.operating)}</StoreDrill></span>
              <span style={{ ...num, color: DK.sub }}><StoreDrill month={d.month} pnl={d.pnl} store={s.store} cell="bep">{pct(s.bepAchieved)}</StoreDrill></span>
            </Grid>
          </Reveal>
        ))}
        {storeRows.length === 0 && <Empty>이 달에 잡힌 판매가 없습니다.</Empty>}
        <Reveal i={storeRows.length + 1}>
          <Grid cols={STORE_COLS} total>
            <span>합계</span>
            <span style={num}><StoreDrill month={d.month} pnl={d.pnl} cell="revenue">{won(t.revenue)}</StoreDrill></span>
            <span style={num}><StoreDrill month={d.month} pnl={d.pnl} cell="variable">{won(t.variable.total)}</StoreDrill></span>
            <span style={num}><StoreDrill month={d.month} pnl={d.pnl} cell="contribution">{won(t.contribution)}</StoreDrill></span>
            <span style={num}><StoreDrill month={d.month} pnl={d.pnl} cell="rate">{pct(t.contributionRate)}</StoreDrill></span>
            <span style={num}><StoreDrill month={d.month} pnl={d.pnl} cell="fixed">{won(t.fixedTotal)}</StoreDrill></span>
            <span style={{ ...num, color: t.operating < 0 ? C.bad : C.net }}><StoreDrill month={d.month} pnl={d.pnl} cell="operating">{won(t.operating)}</StoreDrill></span>
            <span style={num}><StoreDrill month={d.month} pnl={d.pnl} cell="bep">{pct(t.bepAchieved)}</StoreDrill></span>
          </Grid>
        </Reveal>
      </Slide>
    ),
  };

  // ---- 5. 비용 구조 ----
  const costTotal = t.variable.total + t.fixedTotal;
  const costs: DeckSlide = {
    id: "costs",
    chapter: "비용 구조",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="04 · Costs" color={C.expense} title={<>비용 <span style={{ color: C.expense }}>{won(costTotal)}원</span></>} aside={<>변동비 {won(t.variable.total)} + 고정비 {won(t.fixedTotal)}<br />매출 대비 {pct(t.revenue ? costTotal / t.revenue : null)}</>} />
        <InsightComment doc={insight} chapter="비용 구조" />
        <BarRows
          lines={d.costs}
          total={costTotal}
          color={C.expense}
          good={false}
          hasPrev={d.hasPrev}
          head="비용 항목"
          renderValue={(line, node) => (
            <CostDrill month={d.month} pnl={d.pnl} label={line.label}>
              {node}
            </CostDrill>
          )}
        />
      </Slide>
    ),
  };

  // ---- 6. 상위 상품 ----
  const PROD_COLS = "1fr 84px 70px 140px 140px 80px 120px";
  const topProducts = d.products.slice(0, 8);
  const products: DeckSlide = {
    id: "products",
    chapter: "상위 상품",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="05 · Products" color={DK.wow} title="공헌이익 상위 상품" aside={<>확정 판매 {d.products.length.toLocaleString("ko-KR")}개 상품 중 상위 {topProducts.length}<br />수량과 금액이 같은 모집단</>} />
        <InsightComment doc={insight} chapter="상위 상품" />
        {topProducts.length === 0 ? (
          <Empty>확정된 판매가 없습니다.</Empty>
        ) : (
          <>
            <Grid cols={PROD_COLS} head>
              <span>상품</span><span>매장</span><span style={num}>수량</span><span style={num}>매출(원)</span>
              <span style={num}>공헌이익(원)</span><span style={num}>이익률</span><span style={num}>개당 공헌</span>
            </Grid>
            {topProducts.map((x, i) => (
              <Reveal key={x.product.id} i={i + 1}>
                <Grid cols={PROD_COLS}>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {x.product.name} <span style={{ color: DK.sub, fontWeight: 500 }}>{x.product.option}</span>
                  </span>
                  <span style={{ fontSize: 14, color: STORE_DK[x.product.store] }}>{storeLabel(x.product.store)}</span>
                  <span style={{ ...num, color: DK.sub }}><ProductDrill month={d.month} perf={x} cell="qty">{x.qty.toLocaleString("ko-KR")}</ProductDrill></span>
                  <span style={num}><ProductDrill month={d.month} perf={x} cell="revenue">{won(x.revenue)}</ProductDrill></span>
                  <span style={{ ...num, fontWeight: 800, color: x.contribution < 0 ? C.bad : C.net }}><ProductDrill month={d.month} perf={x} cell="contribution">{won(x.contribution)}</ProductDrill></span>
                  <span style={{ ...num, color: DK.sub }}><ProductDrill month={d.month} perf={x} cell="rate">{pct(x.contributionRate)}</ProductDrill></span>
                  <span style={{ ...num, color: DK.sub }}><ProductDrill month={d.month} perf={x} cell="unit">{won(x.unitContribution)}</ProductDrill></span>
                </Grid>
              </Reveal>
            ))}
          </>
        )}
      </Slide>
    ),
  };

  // ---- 7. 이벤트별 손익 ----
  const EV_COLS = "1fr 84px 56px 140px 140px 80px 130px";
  const evRows = [...d.events].sort((a, b) => b.contribution - a.contribution);
  const evShown = evRows.slice(0, 7);
  const evRevenue = d.events.reduce((s, e) => s + e.revenue, 0);
  const evContribution = d.events.reduce((s, e) => s + e.contribution, 0);
  const eventsSlide: DeckSlide = {
    id: "events",
    chapter: "이벤트별 손익",
    // 숫자에 커서를 두면 내역이 뜬다 — 가장자리 클릭존이 표 끝 칸을 덮지 않게
    interactive: true,
    render: () => (
      <Slide>
        <Header kicker="06 · Events" color={DK.wow} title={`${monthNum(d.month)} 이벤트 ${d.events.length}건`} aside={<>이 달에 시작한 이벤트 · 공헌이익 순<br />고정비는 매장 단위라 나누지 않음</>} />
        <InsightComment doc={insight} chapter="이벤트별 손익" />
        {evRows.length === 0 ? (
          <Empty>이 달에 시작한 이벤트가 없습니다.</Empty>
        ) : (
          <>
            <Grid cols={EV_COLS} head>
              <span>이벤트</span><span>매장</span><span style={num}>일수</span><span style={num}>매출(원)</span>
              <span style={num}>공헌이익(원)</span><span style={num}>이익률</span><span style={num}>일당 공헌</span>
            </Grid>
            {evShown.map((e, i) => (
              <Reveal key={e.event.id} i={i + 1}>
                <Grid cols={EV_COLS}>
                  <div style={{ minWidth: 0, padding: "6px 0" }}>
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.event.name}</div>
                    <div style={{ fontSize: 12, color: DK.faint }}>{e.event.from.slice(5).replace("-", ".")} ~ {e.event.to.slice(5).replace("-", ".")}</div>
                  </div>
                  <span style={{ fontSize: 14, color: STORE_DK[e.event.store] }}>{storeLabel(e.event.store)}</span>
                  <span style={{ ...num, color: DK.sub }}>{e.days}</span>
                  <span style={num}><EventDrill month={d.month} perf={e} cell="revenue">{won(e.revenue)}</EventDrill></span>
                  <span style={{ ...num, fontWeight: 800, color: e.contribution < 0 ? C.bad : C.net }}><EventDrill month={d.month} perf={e} cell="contribution">{won(e.contribution)}</EventDrill></span>
                  <span style={{ ...num, color: DK.sub }}><EventDrill month={d.month} perf={e} cell="rate">{pct(e.contributionRate)}</EventDrill></span>
                  <span style={{ ...num, color: DK.sub }}><EventDrill month={d.month} perf={e} cell="perDay">{won(e.contributionPerDay)}</EventDrill></span>
                </Grid>
              </Reveal>
            ))}
            <Reveal i={evShown.length + 1}>
              <Grid cols={EV_COLS} total>
                <span>이벤트 합계{evRows.length > evShown.length ? ` (외 ${evRows.length - evShown.length}건 포함)` : ""}</span>
                <span /><span />
                <span style={num}><EventTotalDrill month={d.month} events={d.events} cell="revenue">{won(evRevenue)}</EventTotalDrill></span>
                <span style={{ ...num, color: evContribution < 0 ? C.bad : C.net }}><EventTotalDrill month={d.month} events={d.events} cell="contribution">{won(evContribution)}</EventTotalDrill></span>
                <span /><span />
              </Grid>
            </Reveal>
          </>
        )}
      </Slide>
    ),
  };

  // ---- 8. 집계 기준 ----
  const laborLine = d.pnl.stores
    .filter((s) => s.revenue !== 0 || s.fixedTotal !== 0)
    .map((s) => `${storeLabel(s.store)} ${s.labor.source === "actual" ? "근무 일지 실측" : "가정값"}`)
    .join(" · ");
  const basis: DeckSlide = {
    id: "basis",
    chapter: "집계 기준",
    render: () => (
      <Slide>
        <Header kicker="Appendix" color={DK.wow} title="이 자료의 숫자를 읽는 법" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {[
            // 달마다 달라지는 「이익률의 분모(미확정 금액)」·「인건비 출처」는 핵심 요약 장 아래로 옮겼다
            ["매출", "판매 실적(POS·네이버·온라인) 기준. 재무 장부의 수입(정산 입금)과는 시점·금액이 다르다"],
            ["공헌이익", "확정 매출 − 변동비(재료비·이벤트·제작 인건비·준비물·결제 수수료)"],
            ["영업이익", "공헌이익 − 고정비(공통비 배부 + 상시 인건비)"],
            ["이벤트", "시작한 달에 잡힌다. 월말에 걸친 행사도 시작한 달의 실적이다"],
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
  const insightCtx = { label, accent: DK.wow, kicker: "Insight", onManage: onManageInsight };

  return [
    cover,
    insightOnePager(insight, insightCtx),
    summary,
    trend,
    stores,
    costs,
    products,
    eventsSlide,
    insightRisks(insight, { ...insightCtx, kicker: "Watch" }),
    basis,
  ];
}
