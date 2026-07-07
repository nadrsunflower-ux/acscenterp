// ============================================================
//  2026-07-07 김주연 회의 준비 자료 — 1장. 인트로
//  (커버 · 오늘의 안건 · 세 줄 요약)
// ------------------------------------------------------------
//  회의 맥락 요약:
//   - 악센트 아이디: 사주 프로그램(뿌덕 4탄) 초안 개발 중, 7/15 이전 완성 확정
//   - 제이진옴므: 최종 계약 완료. 3개월 러닝타임, 김제연 70% 전담
//   - 스모트: 여름방학 = 유저 인프라 확보 골든타임 → 콘텐츠·광고 총력전
//   - 하반기: 9월 제천 → 10월 K웨이브 → 11월 안산·제이진옴므 납품 →
//     현대백화점 팝업(1억) 등 이벤트 러시 → "7월은 폭풍 전야"
// ============================================================
import type { DeckSlide } from "@/components/neander/deck/Deck";
import { DK, Slide, Reveal, Kicker, Title, Chip, Tag } from "@/components/neander/deck/parts";

// ---- S1. 커버 ------------------------------------------------
const cover: DeckSlide = {
  id: "cover",
  chapter: "커버",
  render: () => (
    <Slide style={{ justifyContent: "space-between" }}>
      {/* 배경 워터마크 숫자 */}
      <div
        aria-hidden
        className="dk-mono"
        style={{
          position: "absolute",
          right: 24,
          top: 40,
          fontSize: 300,
          fontWeight: 800,
          lineHeight: 1,
          color: "transparent",
          WebkitTextStroke: "1.5px rgba(148,163,184,.14)",
          userSelect: "none",
        }}
      >
        07
      </div>

      <Reveal i={0}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Kicker>NEANDER · Weekly Strategy Briefing</Kicker>
          <span className="dk-mono" style={{ fontSize: 14, color: DK.sub, letterSpacing: ".22em" }}>
            2026.07.07 TUE
          </span>
        </div>
      </Reveal>

      <div>
        <Reveal i={1}>
          <h1
            className="dk-serif"
            style={{ margin: 0, fontSize: 104, lineHeight: 1.08, fontWeight: 900, letterSpacing: "-0.015em" }}
          >
            7월,
            <br />
            <span
              style={{
                background: `linear-gradient(92deg, ${DK.smoat}, #7c5cff)`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              폭풍 전야.
            </span>
          </h1>
        </Reveal>
        <Reveal i={2}>
          <p style={{ margin: "26px 0 0", fontSize: 21, color: DK.sub, lineHeight: 1.55 }}>
            여름방학 골든타임 — 개학 전, 스모트 유저 인프라 총력전.
            <br />
            그리고 하반기 이벤트 러시를 버티기 위한 7월의 준비.
          </p>
        </Reveal>
      </div>

      <Reveal i={3}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Chip name="김주연" />
          <Tag color={DK.smoat}>회의 준비 자료</Tag>
          <Tag color="rgba(238,240,233,.4)">내부 공유용</Tag>
          <span style={{ flex: 1 }} />
          <span className="dk-mono" style={{ fontSize: 11.5, color: DK.faint, letterSpacing: ".3em" }}>
            THE CALM BEFORE THE STORM
          </span>
        </div>
      </Reveal>
    </Slide>
  ),
};

// ---- S2. 오늘의 안건 ----------------------------------------
const AGENDA: { title: string; sub: string; tag: string; color: string }[] = [
  { title: "악센트 아이디 — 사주 프로그램(뿌덕 4탄)", sub: "7/15 이전 완성 확정 · 초안 개발 진행 중", tag: "아이디", color: DK.id },
  { title: "제이진옴므 — 최종 계약 완료", sub: "3개월 러닝타임 · 김제연 70% 전담 체제 가동", tag: "신규", color: DK.jj },
  { title: "스모트 — 개발 트랙 현황", sub: "문제 퀄리티 · 모의고사 · 태블릿 툴 · 분석 리포트 · QA/PG", tag: "스모트", color: DK.smoat },
  { title: "스모트 — 마케팅 실행전략 4대 축", sub: "2차 영상 · 전단지 · 오픈채팅방 · 세미나(7/18)", tag: "스모트", color: DK.smoat },
  { title: "매뉴얼 · 콘텐츠 · 채널 다각화", sub: "이번 주 매뉴얼(이동주) · 기능별 콘텐츠 일정(유선화·유재영)", tag: "운영", color: DK.dev },
  { title: "하반기 로드맵 — 그리고 오늘 결정할 것", sub: "9월 제천부터 12월까지 · 결정사항 5가지", tag: "전사", color: DK.amber },
];

const agenda: DeckSlide = {
  id: "agenda",
  chapter: "오늘의 안건",
  render: () => (
    <Slide style={{ flexDirection: "row", gap: 64 }}>
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 22, paddingTop: 8 }}>
        <Reveal i={0}>
          <Kicker>Agenda</Kicker>
        </Reveal>
        <Reveal i={1}>
          <Title size={56}>
            오늘의
            <br />
            안건.
          </Title>
        </Reveal>
        <Reveal i={2}>
          <p style={{ margin: 0, fontSize: 15, color: DK.sub, lineHeight: 1.6 }}>
            여섯 가지. 마지막 안건에서
            <br />
            실행 일정과 담당자를 확정하고,
            <br />
            액션플랜은 회의록을 통해
            <br />
            일일업무로 자동 등록됩니다.
          </p>
        </Reveal>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {AGENDA.map((a, idx) => (
          <Reveal key={a.title} i={idx + 1}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "64px 1fr auto",
                alignItems: "center",
                gap: 18,
                padding: "17px 4px",
                borderTop: `1px solid ${DK.line}`,
              }}
            >
              <span className="dk-mono" style={{ fontSize: 20, color: a.color, fontWeight: 700 }}>
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: DK.ink }}>{a.title}</div>
                <div style={{ fontSize: 13.5, color: DK.sub, marginTop: 3 }}>{a.sub}</div>
              </div>
              <Tag color={a.color}>{a.tag}</Tag>
            </div>
          </Reveal>
        ))}
      </div>
    </Slide>
  ),
};

// ---- S3. 세 줄 요약 ------------------------------------------
const SUMMARY: { key: string; rest: string; sub: string; color: string }[] = [
  {
    key: "제이진옴므 최종 계약 완료.",
    rest: "3개월 러닝타임이 지금 시작됐다.",
    sub: "김제연 70% 전담 · 김주연 서포트 · 이동주 하드웨어 기획 최우선(ASAP)",
    color: DK.jj,
  },
  {
    key: "사주 프로그램, 7/15 이전 완성 확정.",
    rest: "계획대로 간다.",
    sub: "악센트 아이디 뿌덕 4탄 — 김주연 초안 개발 진행 중",
    color: DK.id,
  },
  {
    key: "여름방학 = 스모트 골든타임.",
    rest: "개학 전에 유저 인프라를 깐다.",
    sub: "콘텐츠·광고를 쏟아내는 총력전 — 2차 영상 · 전단지 · 오픈챗 · 세미나(7/18)",
    color: DK.smoat,
  },
];

const summary: DeckSlide = {
  id: "summary",
  chapter: "세 줄 요약",
  render: () => (
    <Slide style={{ gap: 0 }}>
      <Reveal i={0}>
        <Kicker>TL;DR</Kicker>
      </Reveal>
      <Reveal i={1}>
        <Title size={44} style={{ marginTop: 18 }}>
          오늘 회의, 세 줄이면 됩니다.
        </Title>
      </Reveal>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 30 }}>
        {SUMMARY.map((s, idx) => (
          <Reveal key={s.key} i={idx + 2}>
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
              <span
                className="dk-mono"
                style={{
                  fontSize: 15,
                  color: s.color,
                  border: `1px solid ${s.color}`,
                  borderRadius: 8,
                  padding: "5px 11px",
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                {idx + 1}
              </span>
              <div>
                <div style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.35 }}>
                  <span style={{ color: s.color }}>{s.key}</span>{" "}
                  <span style={{ color: DK.ink }}>{s.rest}</span>
                </div>
                <div style={{ fontSize: 15.5, color: DK.sub, marginTop: 6 }}>{s.sub}</div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal i={5}>
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${DK.amber}`,
            background: "rgba(251,191,36,.07)",
            padding: "14px 22px",
            fontSize: 17,
            fontWeight: 700,
            color: DK.amber,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>⚡</span>
          9월부터는 이벤트 러시 — 7월에 모든 기반을 깔아야 연말을 버틴다.
        </div>
      </Reveal>
    </Slide>
  ),
};

export const SLIDES_INTRO: DeckSlide[] = [cover, agenda, summary];
