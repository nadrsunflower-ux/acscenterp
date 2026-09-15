// ============================================================
//  인사이트 슬라이드 — 재무·매출 월간 보고 덱이 같이 쓴다
// ------------------------------------------------------------
//  리포트 화면(InsightPanel)에서 만들고 고친 해설(InsightDoc)을 그대로 그린다.
//  발표 중에 AI 를 부르지 않는다 — 문서가 없으면 조용한 자리 표시만 둔다.
//  승인 전이면 「초안」, AI 없이 규칙으로 만든 문서면 「규칙 초안」 태그를 단다.
//  문장에 커서를 두면 인용한 신호의 제목·숫자가 캔버스 안 판으로 뜬다.
//  1280×720 캔버스 기준 px 고정.
// ============================================================
import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import type { DeckSlide } from "./Deck";
import { DK, Panel, Reveal, Slide, Tag } from "./parts";
import { C, Header } from "./report-parts";
import type { InsightDoc, InsightItem, Signal, SignalMetric } from "@/lib/neander/insights/types";

export interface InsightSlideCtx {
  /** 달 이름 (예: 「2026년 8월」) */
  label: string;
  accent: string;
  kicker: string;
  /**
   * 발표 화면에서 인사이트를 만들고·고치고·지우는 창을 연다 (덱 페이지가 넘긴다).
   * 없으면 슬라이드는 읽기만 한다.
   */
  onManage?: () => void;
}

/** 관리 버튼 — 어두운 캔버스용 캡슐 */
function ManageButton({ onClick, children, primary = false }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // 슬라이드 클릭존·다른 손놀림으로 번지지 않게
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: primary ? 40 : 28,
        padding: primary ? "0 20px" : "0 12px",
        borderRadius: 999,
        border: `1px solid ${primary ? "var(--dk-accent)" : "rgba(148,163,184,.32)"}`,
        background: primary ? "var(--dk-accent)" : "rgba(15,18,28,.6)",
        color: primary ? "#04060a" : DK.sub,
        fontSize: primary ? 15 : 12.5,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const metricText = (m: SignalMetric) => {
  const v = m.unit === "%" || m.unit === "배" ? m.value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : Math.round(m.value).toLocaleString("ko-KR");
  return `${m.label} ${v}${m.unit}`;
};

const cited = (doc: InsightDoc, ids: string[]) =>
  ids.map((id) => doc.signals.find((s) => s.id === id)).filter((s): s is Signal => !!s);

/** 초안·규칙 초안 태그 — 승인된 문서는 아무것도 달지 않는다 */
function DraftTags({ doc }: { doc: InsightDoc }) {
  return (
    <>
      {doc.fallback && <Tag color={DK.amber}>규칙 초안</Tag>}
      {doc.status !== "approved" && <Tag color="rgba(238,240,233,.5)">초안</Tag>}
    </>
  );
}

/** 근거 판 — 인용한 신호의 제목·숫자 (커서를 받지 않는다) */
function EvidenceCard({ signals, style }: { signals: Signal[]; style: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        padding: "16px 20px",
        borderRadius: 12,
        // 불투명 — 밑에 깔린 카드 글자가 비쳐 겹쳐 읽혔다
        background: "#0f121c",
        border: `1px solid rgba(148,163,184,.32)`,
        boxShadow: "0 24px 60px rgba(0,0,0,.6)",
        pointerEvents: "none",
        zIndex: 20,
        ...style,
      }}
    >
      <div style={{ fontSize: 11.5, color: DK.faint, letterSpacing: ".04em" }}>근거 신호 {signals.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {signals.slice(0, 4).map((s) => (
          <div key={s.id}>
            <div style={{ fontSize: 14, fontWeight: 600, color: DK.ink, lineHeight: 1.45 }}>{s.title}</div>
            {s.metrics.length > 0 && (
              <div style={{ fontSize: 12, color: DK.sub, marginTop: 2, lineHeight: 1.5, fontVariantNumeric: "tabular-nums" }}>
                {s.metrics.map(metricText).join(" · ")}
              </div>
            )}
          </div>
        ))}
        {signals.length > 4 && <div style={{ fontSize: 11.5, color: DK.faint }}>외 {signals.length - 4}개</div>}
      </div>
    </div>
  );
}

/**
 * 근거 판을 띄우는 자리 — 두 칸 격자를 통째로 감싼다.
 *
 * ⚠️ 판을 문장(HoverEvidence) 안에 그리면 안 된다. 문장마다 Reveal 등장 애니메이션이
 *    transform 을 걸어 쌓임 맥락이 따로 생기는데, 그 안의 판은 z-index 를 올려도 뒤에
 *    그려지는 옆 칸 카드 밑으로 깔렸다 (2026-09-15 겹쳐 읽히던 문제). 그래서 커서가 간
 *    문장은 상태만 알리고, 판은 이 자리의 **마지막 자식**으로 한 장만 그린다.
 *    판은 반대편 칸 자리를 불투명하게 덮는다 — 커서를 둔 문장은 가리지 않는다.
 */
type Hovered = { signals: Signal[]; side: "left" | "right" } | null;
const EvidenceCtx = createContext<(h: Hovered) => void>(() => {});

function EvidenceScope({ leftWidth, children, style }: { leftWidth: string; children: ReactNode; style?: CSSProperties }) {
  const [hovered, setHovered] = useState<Hovered>(null);
  return (
    <EvidenceCtx.Provider value={setHovered}>
      <div style={{ position: "relative", ...style }}>
        {children}
        {hovered && hovered.signals.length > 0 && (
          <EvidenceCard
            signals={hovered.signals}
            style={
              // 높이는 자르지 않는다 — 확인할 것 장은 줄이 적으면 자리가 낮아 판이 잘렸다
              hovered.side === "left"
                ? { top: 0, right: 0, width: `calc(100% - ${leftWidth} - 24px)` }
                : { top: 0, left: 0, width: `calc(${leftWidth} - 16px)` }
            }
          />
        )}
      </div>
    </EvidenceCtx.Provider>
  );
}

/** 커서를 두면 근거 판이 뜨는 문장 — side 는 문장이 있는 칸 (판은 반대편에 뜬다) */
function HoverEvidence({
  doc,
  item,
  side,
  children,
}: {
  doc: InsightDoc;
  item: InsightItem;
  side: "left" | "right";
  children: ReactNode;
}) {
  const setHovered = useContext(EvidenceCtx);
  const signals = cited(doc, item.signalIds);
  return (
    <div
      style={{ cursor: signals.length ? "help" : undefined }}
      onMouseEnter={() => setHovered(signals.length ? { signals, side } : null)}
      onMouseLeave={() => setHovered(null)}
    >
      {children}
    </div>
  );
}

function Placeholder({ children, onManage }: { children: ReactNode; onManage?: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Reveal i={1}>
        <Panel style={{ padding: "36px 48px", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: DK.sub }}>아직 이 달의 인사이트가 없습니다</div>
          <div style={{ fontSize: 15, color: DK.faint, marginTop: 10, lineHeight: 1.6 }}>{children}</div>
          {onManage && (
            <div style={{ marginTop: 22 }}>
              <ManageButton primary onClick={onManage}>
                ✦ 인사이트 만들기
              </ManageButton>
            </div>
          )}
        </Panel>
      </Reveal>
    </div>
  );
}

/** 머리글 오른쪽 — 초안 태그 · 관리 버튼 · 안내 */
function HeaderAside({ doc, ctx, hint }: { doc: InsightDoc | null; ctx: InsightSlideCtx; hint?: string }) {
  if (!doc && !ctx.onManage) return null;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      {doc && <DraftTags doc={doc} />}
      {doc && hint && <span>{hint}</span>}
      {doc && ctx.onManage && <ManageButton onClick={ctx.onManage}>고치기 · 승인 · 삭제</ManageButton>}
    </span>
  );
}

// ---- 이번 달 한 장 ------------------------------------------------------

export function insightOnePager(doc: InsightDoc | null, ctx: InsightSlideCtx): DeckSlide {
  return {
    id: "insight-one-pager",
    chapter: "이번 달 한 장",
    interactive: true,
    render: () => (
      <Slide>
        <Header
          kicker={ctx.kicker}
          color={ctx.accent}
          title={`${ctx.label} 한 장`}
          aside={<HeaderAside doc={doc} ctx={ctx} hint="문장에 커서를 두면 근거" />}
        />
        {!doc ? (
          <Placeholder onManage={ctx.onManage}>
            {ctx.onManage
              ? "이 달의 신호를 읽고 핵심 · 할 일 · 확인할 것을 정리합니다 · 수십 초"
              : "리포트 화면에서 인사이트를 만들면 여기에 나옵니다."}
          </Placeholder>
        ) : (
          <EvidenceScope leftWidth="53.5%" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 40, height: "100%" }}>
            <div>
              <Reveal i={1}>
                <div style={{ fontSize: 13, color: ctx.accent, fontWeight: 700, letterSpacing: ".08em", marginBottom: 16 }}>핵심</div>
              </Reveal>
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                {doc.summary.slice(0, 3).map((x, i) => (
                  <Reveal key={x.id} i={i + 2}>
                    <HoverEvidence doc={doc} item={x} side="left">
                      <div style={{ display: "flex", gap: 16 }}>
                        <span className="dk-mono" style={{ fontSize: 15, color: ctx.accent, marginTop: 7 }}>{String(i + 1).padStart(2, "0")}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: DK.ink, lineHeight: 1.38, letterSpacing: "-0.01em" }}>{x.text}</div>
                          {x.detail && (
                            <div style={{ fontSize: 14.5, color: DK.sub, marginTop: 6, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {x.detail}
                            </div>
                          )}
                        </div>
                      </div>
                    </HoverEvidence>
                  </Reveal>
                ))}
                {doc.summary.length === 0 && <div style={{ fontSize: 16, color: DK.faint }}>핵심으로 꼽은 내용이 없습니다.</div>}
              </div>
            </div>
            <div>
              <Reveal i={1}>
                <div style={{ fontSize: 13, color: C.income, fontWeight: 700, letterSpacing: ".08em", marginBottom: 16 }}>다음 달 할 일</div>
              </Reveal>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {doc.actions.slice(0, 3).map((x, i) => (
                  <Reveal key={x.id} i={i + 5}>
                    <HoverEvidence doc={doc} item={x} side="right">
                      <Panel accent={C.income} style={{ padding: "16px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: DK.ink, lineHeight: 1.45 }}>{x.text}</div>
                          {x.impact && <Tag color={C.income}>{x.impact}</Tag>}
                        </div>
                        {x.detail && (
                          <div style={{ fontSize: 13.5, color: DK.sub, marginTop: 5, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {x.detail}
                          </div>
                        )}
                      </Panel>
                    </HoverEvidence>
                  </Reveal>
                ))}
                {doc.actions.length === 0 && <div style={{ fontSize: 16, color: DK.faint }}>정한 할 일이 없습니다.</div>}
              </div>
            </div>
          </div>
          </EvidenceScope>
        )}
      </Slide>
    ),
  };
}

// ---- 확인할 것 ----------------------------------------------------------

/** 데이터 신뢰도 신호 — topic 에 데이터·미확정·누락 류가 들어간 것 */
const isReliability = (s: Signal) => /data|reliab|quality|pending|missing|review|unclassified|coverage/i.test(s.topic);

export function insightRisks(doc: InsightDoc | null, ctx: InsightSlideCtx): DeckSlide {
  return {
    id: "insight-risks",
    chapter: "확인할 것",
    interactive: true,
    render: () => {
      const risks = doc ? doc.risks.slice(0, 5) : [];
      const citedIds = new Set(risks.flatMap((r) => r.signalIds));
      const reliability = doc ? doc.signals.filter((s) => isReliability(s) && !citedIds.has(s.id)).slice(0, 4) : [];
      return (
        <Slide>
          <Header
            kicker={ctx.kicker}
            color={DK.amber}
            title="확인이 필요한 것"
            aside={<HeaderAside doc={doc} ctx={ctx} />}
          />
          {!doc ? (
            <Placeholder onManage={ctx.onManage}>
              {ctx.onManage
                ? "이 달의 신호를 읽고 핵심 · 할 일 · 확인할 것을 정리합니다 · 수십 초"
                : "리포트 화면에서 인사이트를 만들면 여기에 나옵니다."}
            </Placeholder>
          ) : (
            <EvidenceScope leftWidth={reliability.length ? "58%" : "50%"}>
            <div style={{ display: "grid", gridTemplateColumns: reliability.length ? "1.4fr 1fr" : "1fr", gap: 36 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {risks.map((x, i) => (
                  <Reveal key={x.id} i={i + 1}>
                    <HoverEvidence doc={doc} item={x} side="left">
                      <Panel accent={DK.amber} style={{ padding: "14px 20px" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: DK.ink, lineHeight: 1.45 }}>{x.text}</div>
                        {x.detail && (
                          <div style={{ fontSize: 13.5, color: DK.sub, marginTop: 4, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {x.detail}
                          </div>
                        )}
                      </Panel>
                    </HoverEvidence>
                  </Reveal>
                ))}
                {risks.length === 0 && <div style={{ fontSize: 18, color: DK.faint, padding: "40px 0" }}>이번 달에 따로 확인할 것이 없습니다.</div>}
              </div>
              {reliability.length > 0 && (
                <div>
                  <Reveal i={1}>
                    <div style={{ fontSize: 13, color: DK.faint, fontWeight: 700, letterSpacing: ".08em", marginBottom: 12 }}>데이터 신뢰도</div>
                  </Reveal>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {reliability.map((s, i) => (
                      <Reveal key={s.id} i={i + 2}>
                        <div style={{ borderLeft: `2px solid ${s.severity === "high" ? C.bad : DK.line}`, paddingLeft: 14 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: DK.ink, lineHeight: 1.45 }}>{s.title}</div>
                          {s.metrics.length > 0 && (
                            <div style={{ fontSize: 12, color: DK.sub, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                              {s.metrics.map(metricText).join(" · ")}
                            </div>
                          )}
                        </div>
                      </Reveal>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </EvidenceScope>
          )}
        </Slide>
      );
    },
  };
}

// ---- 장별 한 줄 ---------------------------------------------------------

/**
 * 슬라이드 머리글 아래 한 줄 코멘트. Header 의 아래 여백(30px) 안으로 끌어올려
 * 그 장의 레이아웃 높이를 바꾸지 않는다 — 캔버스가 고정이라 한 줄만 늘어도 넘친다.
 */
export function InsightComment({ doc, chapter }: { doc: InsightDoc | null; chapter: string }) {
  const text = doc?.comments[chapter]?.trim();
  if (!text) return null;
  return (
    <Reveal i={1}>
      <div
        style={{
          marginTop: -24,
          marginBottom: 4,
          height: 20,
          lineHeight: "20px",
          fontSize: 14,
          color: DK.sub,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        💡 {text}
        {doc && doc.status !== "approved" && <span style={{ marginLeft: 8, fontSize: 11, color: DK.faint }}>초안</span>}
      </div>
    </Reveal>
  );
}
