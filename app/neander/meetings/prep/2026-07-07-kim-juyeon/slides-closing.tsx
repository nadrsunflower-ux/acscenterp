// ============================================================
//  2026-07-07 김주연 회의 준비 자료 — 4장. 클로징
//  (왜 7월인가 · 오늘 결정할 것 · 액션 아이템 요약)
// ============================================================
import type { DeckSlide } from "@/components/neander/deck/Deck";
import { DK, Slide, Reveal, Kicker, Title, Chip, Tag } from "@/components/neander/deck/parts";

// ---- S12. 왜 7월인가 — 폭풍 전야 ------------------------------
// 월별 "스모트에 쓸 수 있는 화력" 개념도 — 외부 확정 일정이 늘수록 줄어든다.
const CAPACITY: { month: string; pct: number; note: string }[] = [
  { month: "7월", pct: 100, note: "온전한 집중 가능 — 지금" },
  { month: "8월", pct: 70, note: "방학 마무리 · 개학" },
  { month: "9월", pct: 55, note: "제천" },
  { month: "10월", pct: 45, note: "K웨이브" },
  { month: "11월", pct: 20, note: "안산 + 제이진옴므 납품" },
  { month: "12월", pct: 30, note: "팝업스토어 · 결산" },
];

const whyJuly: DeckSlide = {
  id: "why-july",
  chapter: "왜 7월인가",
  render: () => (
    <Slide style={{ flexDirection: "row", gap: 64, alignItems: "center" }}>
      {/* 좌: 가용 화력 바 차트 (개념도) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, alignSelf: "stretch", justifyContent: "center" }}>
        {CAPACITY.map((c, idx) => (
          <Reveal key={c.month} i={idx + 3}>
            <div style={{ display: "grid", gridTemplateColumns: "52px 1fr", gap: 14, alignItems: "center" }}>
              <span className="dk-mono" style={{ fontSize: 14.5, fontWeight: 700, color: idx === 0 ? DK.smoat : DK.sub }}>
                {c.month}
              </span>
              <div>
                <div
                  className="dk-grow"
                  style={{
                    height: 26,
                    width: `${c.pct}%`,
                    borderRadius: 6,
                    background:
                      idx === 0
                        ? `linear-gradient(90deg, ${DK.smoat}, rgba(34,211,238,.45))`
                        : "rgba(148,163,184,.22)",
                    border: idx === 0 ? "none" : `1px solid ${DK.line}`,
                  }}
                />
                <div style={{ fontSize: 12, color: idx === 0 ? DK.smoat : DK.faint, marginTop: 4 }}>{c.note}</div>
              </div>
            </div>
          </Reveal>
        ))}
        <Reveal i={10}>
          <div style={{ fontSize: 11.5, color: DK.faint, marginTop: 4 }}>
            ※ 스모트에 투입 가능한 팀 화력 — 확정 외부 일정 기준 개념도
          </div>
        </Reveal>
      </div>

      {/* 우: 메시지 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
        <Reveal i={0}>
          <Kicker color={DK.danger}>Why Now</Kicker>
        </Reveal>
        <Reveal i={1}>
          <Title size={60}>
            7월은
            <br />
            <span style={{ color: DK.danger }}>폭풍 전야</span>다.
          </Title>
        </Reveal>
        <Reveal i={2}>
          <p style={{ margin: 0, fontSize: 18, color: DK.sub, lineHeight: 1.65 }}>
            9월부터 행사·납품·팝업이 연달아 몰려온다.
            <br />
            스모트에 온전히 쓸 수 있는 달은 <b style={{ color: DK.ink }}>사실상 7월이 마지막</b>.
            <br />
            <br />
            지금 할 수 있는 모든 스모트 작업을 끝내둬야,
            <br />
            연말에 <b style={{ color: DK.smoat }}>“어찌저찌”가 아니라 “버젓이”</b> 버틴다.
          </p>
        </Reveal>
      </div>
    </Slide>
  ),
};

// ---- S13. 오늘 결정할 것 -------------------------------------
const DECISIONS: { t: string; d: string; crew: string[] }[] = [
  { t: "2차 마케팅 영상 — 제작·집행 일정", d: "콘셉트 방향과 촬영·편집·집행 날짜까지 확정", crew: ["유선화", "유재영"] },
  { t: "전단지 — 타깃·배포처·물량·예산", d: "학원가·학교 앞 오프라인 침투 전략 확정", crew: ["유선화", "유재영"] },
  { t: "오픈채팅방 — 운영 주기·콘텐츠·담당", d: "정기적·전략적 접근 룰 확정 (주 N회 무엇을 뿌릴지)", crew: ["유선화", "유재영"] },
  { t: "세미나(7/18) — 기획 담당자 + 타임라인", d: "기획·대관·마케팅·리워드 파트별 확정", crew: ["유재영", "유선화", "이동주"] },
  { t: "매뉴얼 — 이번 주 완료 재확인", d: "웹 기반 · Claude 협업 제작 · 기존 기능 우선", crew: ["이동주"] },
];

const decisions: DeckSlide = {
  id: "decisions",
  chapter: "오늘 결정할 것",
  render: () => (
    <Slide style={{ gap: 18 }}>
      <Reveal i={0}>
        <Kicker color={DK.danger}>Decision Points</Kicker>
      </Reveal>
      <Reveal i={1}>
        <Title size={46}>오늘, 이 다섯 가지를 확정한다.</Title>
      </Reveal>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {DECISIONS.map((x, idx) => (
          <Reveal key={x.t} i={idx + 2}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "40px 1fr auto",
                gap: 18,
                alignItems: "center",
                padding: "14px 4px",
                borderTop: `1px solid ${DK.line}`,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  border: `2px solid ${DK.danger}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 800,
                  color: DK.danger,
                }}
              >
                {idx + 1}
              </span>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: DK.ink }}>{x.t}</div>
                <div style={{ fontSize: 13.5, color: DK.sub, marginTop: 2 }}>{x.d}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {x.crew.map((c) => (
                  <Chip key={c} name={c} dim />
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal i={7}>
        <div style={{ fontSize: 13.5, color: DK.faint, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: DK.dev }}>✓</span>
          확정 즉시 이 페이지 옆 회의록에 액션플랜으로 등록 → 담당자 일일업무로 자동 생성됩니다.
        </div>
      </Reveal>
    </Slide>
  ),
};

// ---- S14. 액션 아이템 요약 -----------------------------------
const ACTIONS: { t: string; who: string[]; due: string; hot?: boolean }[] = [
  { t: "사주 프로그램(뿌덕 4탄) 완성", who: ["김주연", "이동주"], due: "~ 7/15", hot: true },
  { t: "제이진옴므 하드웨어 기획 착수", who: ["이동주"], due: "ASAP", hot: true },
  { t: "제이진옴므 개발 리드 (70% 전담)", who: ["김제연"], due: "3개월" },
  { t: "문제 퀄리티 · 모의고사 · 태블릿 · 분석 리포트", who: ["김주연"], due: "지속" },
  { t: "스모트 QA·UI 다듬기 / PG 심사", who: ["이동주"], due: "지속" },
  { t: "기존 기능 매뉴얼 (웹 기반 · Claude 협업)", who: ["이동주"], due: "이번 주", hot: true },
  { t: "2차 영상 · 전단지 · 오픈챗 실행안", who: ["유선화", "유재영"], due: "오늘 확정", hot: true },
  { t: "단체 세미나 (기획·대관·마케팅·리워드)", who: ["유재영", "유선화", "이동주"], due: "7/18" },
  { t: "기능별 콘텐츠 제작 · 홍보 채널 다각화", who: ["유선화", "유재영"], due: "방학 내내" },
];

const actions: DeckSlide = {
  id: "actions",
  chapter: "액션 아이템",
  render: () => (
    <Slide style={{ gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Reveal i={0}>
            <Kicker>Action Items</Kicker>
          </Reveal>
          <Reveal i={1}>
            <Title size={44} style={{ marginTop: 12 }}>
              나가서 할 일.
            </Title>
          </Reveal>
        </div>
        <Reveal i={2}>
          <span className="dk-serif" style={{ fontSize: 19, color: DK.smoat, fontWeight: 700 }}>
            “폭풍 전야를 즐기자.” ⚡
          </span>
        </Reveal>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Reveal i={2}>
          <div
            className="dk-mono"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 280px 110px",
              gap: 12,
              padding: "0 4px 6px",
              fontSize: 11,
              letterSpacing: ".24em",
              color: DK.faint,
            }}
          >
            <span>ACTION</span>
            <span>OWNER</span>
            <span style={{ textAlign: "right" }}>DUE</span>
          </div>
        </Reveal>
        {ACTIONS.map((a, idx) => (
          <Reveal key={a.t} i={idx + 3}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 280px 110px",
                gap: 12,
                alignItems: "center",
                padding: "7.5px 4px",
                borderTop: `1px solid ${DK.line}`,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: a.hot ? 800 : 600, color: a.hot ? DK.ink : DK.sub }}>
                {a.t}
              </span>
              <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {a.who.map((w) => (
                  <Chip key={w} name={w} dim sm />
                ))}
              </span>
              <span style={{ textAlign: "right" }}>
                <Tag color={a.hot ? DK.danger : "rgba(238,240,233,.45)"}>{a.due}</Tag>
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </Slide>
  ),
};

export const SLIDES_CLOSING: DeckSlide[] = [whyJuly, decisions, actions];
