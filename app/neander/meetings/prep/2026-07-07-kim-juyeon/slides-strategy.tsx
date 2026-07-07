// ============================================================
//  2026-07-07 김주연 회의 준비 자료 — 3장. 실행 전략
//  (마케팅 4대 축 · 여름방학 골든타임 · 7월 팀별 R&R · 하반기 로드맵)
// ============================================================
import type { DeckSlide } from "@/components/neander/deck/Deck";
import { DK, Slide, Reveal, Kicker, Title, Chip, Tag, Panel } from "@/components/neander/deck/parts";

// ---- S8. 스모트 — 마케팅 실행전략 4대 축 ----------------------
const PILLARS: {
  no: string;
  title: string;
  tag: string;
  tagColor: string;
  body: string;
  crew: string[];
}[] = [
  {
    no: "01",
    title: "2차 마케팅 영상",
    tag: "오늘 일정 확정",
    tagColor: DK.danger,
    body: "1차 광고 2건(7/1 마감 배정)의 후속탄. 1차 집행 결과 확인과 함께 제작 → 집행 스케줄을 오늘 회의에서 못박는다.",
    crew: ["유선화", "유재영"],
  },
  {
    no: "02",
    title: "전단지 홍보",
    tag: "전략 수립",
    tagColor: DK.amber,
    body: "오프라인 침투 — 타깃(학원가·학교 앞), 배포처, 물량, 디자인까지 전략을 세운다.",
    crew: ["유선화", "유재영"],
  },
  {
    no: "03",
    title: "오픈채팅방 운영",
    tag: "정기 운영 설계",
    tagColor: DK.smoat,
    body: "링크트리로 입구는 확보됨. 주기적 콘텐츠·문제 배포 등 정기적·전략적 접근 룰을 설계한다.",
    crew: ["유선화", "유재영"],
  },
  {
    no: "04",
    title: "단체 세미나 — 7/18",
    tag: "D-11 · 기획 담당 배정",
    tagColor: DK.id,
    body: "타임라인을 구체화하고 기획 담당자를 오늘 배정한다. 기획·대관·마케팅·리워드 4파트.",
    crew: ["유재영", "유선화", "이동주"],
  },
];

const marketing: DeckSlide = {
  id: "marketing-pillars",
  chapter: "04 · 스모트 마케팅",
  render: () => (
    <Slide style={{ gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Reveal i={0}>
            <Kicker>Agenda 04 · 스모트 — 마케팅</Kicker>
          </Reveal>
          <Reveal i={1}>
            <Title size={46} style={{ marginTop: 14 }}>
              실행전략, 4대 축.
            </Title>
          </Reveal>
        </div>
        <Reveal i={2}>
          <span style={{ fontSize: 14.5, color: DK.sub }}>
            채널은 열려 있다 — 이제 <b style={{ color: DK.ink }}>주기와 물량</b>의 문제.
          </span>
        </Reveal>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16, flex: 1 }}>
        {PILLARS.map((p, idx) => (
          <Reveal key={p.no} i={idx + 2}>
            <Panel accent={p.tagColor} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 10, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="dk-mono" style={{ fontSize: 17, fontWeight: 800, color: p.tagColor }}>
                  {p.no}
                </span>
                <span style={{ fontSize: 21, fontWeight: 800, color: DK.ink }}>{p.title}</span>
                <span style={{ flex: 1 }} />
                <Tag color={p.tagColor}>{p.tag}</Tag>
              </div>
              <p style={{ margin: 0, fontSize: 15, color: DK.sub, lineHeight: 1.55, flex: 1 }}>{p.body}</p>
              <div style={{ display: "flex", gap: 8 }}>
                {p.crew.map((c) => (
                  <Chip key={c} name={c} />
                ))}
              </div>
            </Panel>
          </Reveal>
        ))}
      </div>
    </Slide>
  ),
};

// ---- S9. 여름방학 골든타임 -----------------------------------
const golden: DeckSlide = {
  id: "golden-time",
  chapter: "여름방학 골든타임",
  render: () => (
    <Slide style={{ gap: 26 }}>
      <Reveal i={0}>
        <Kicker color={DK.amber}>Golden Time — 여름방학</Kicker>
      </Reveal>
      <Reveal i={1}>
        <Title size={62}>
          개학 전에,
          <br />
          <span style={{ color: DK.amber }}>판을 깔아야 한다.</span>
        </Title>
      </Reveal>
      <Reveal i={2}>
        <p style={{ margin: 0, fontSize: 18.5, color: DK.sub, lineHeight: 1.6, maxWidth: 780 }}>
          이번 여름방학은 스모트 유저 인프라를 확보할 <b style={{ color: DK.ink }}>가장 중요한 기회</b>다.
          개학과 동시에 굴러가게 하려면, 방학 동안 콘텐츠와 광고를 쏟아내
          유저 기반을 미리 구축해 둬야 한다.
        </p>
      </Reveal>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginTop: "auto" }}>
        {[
          {
            head: "콘텐츠",
            body: "기능별 콘텐츠 제작 일정을 세우고 방학 내내 양산",
            crew: ["유선화", "유재영"],
            extra: null,
          },
          {
            head: "채널",
            body: "홍보 채널 다각화 — 도달 면적을 넓힌다",
            crew: ["유선화", "유재영"],
            extra: null,
          },
          {
            head: "매뉴얼",
            body: "기존 기능 사용 매뉴얼 — 웹 기반, Claude 협업 제작",
            crew: ["이동주"],
            extra: <Tag color={DK.amber}>이번 주 완료 필수</Tag>,
          },
        ].map((c, idx) => (
          <Reveal key={c.head} i={idx + 3}>
            <Panel accent={DK.amber} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="dk-serif" style={{ fontSize: 26, fontWeight: 900, color: DK.ink }}>
                {c.head}
              </div>
              <p style={{ margin: 0, fontSize: 14.5, color: DK.sub, lineHeight: 1.55, flex: 1 }}>{c.body}</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {c.crew.map((n) => (
                  <Chip key={n} name={n} />
                ))}
                {c.extra}
              </div>
            </Panel>
          </Reveal>
        ))}
      </div>
    </Slide>
  ),
};

// ---- S10. 7월 팀별 R&R ---------------------------------------
const RNR: { name: string; role: string; items: { t: string; hot?: boolean }[] }[] = [
  {
    name: "김주연",
    role: "사업기획 · 개발",
    items: [
      { t: "사주 프로그램 완성 (~7/15)", hot: true },
      { t: "스모트 문제 퀄리티·모의고사" },
      { t: "태블릿 툴 · 분석 리포트" },
      { t: "제이진옴므 서포트" },
    ],
  },
  {
    name: "김제연",
    role: "상품·서비스 개발",
    items: [
      { t: "제이진옴므 70% 전담 리드", hot: true },
      { t: "3개월 러닝타임 일정 관리" },
      { t: "김주연 서포트·이동주 하드웨어 협업" },
    ],
  },
  {
    name: "이동주",
    role: "재무회계 · 서브개발",
    items: [
      { t: "제이진옴므 하드웨어 기획 ASAP", hot: true },
      { t: "기능 매뉴얼 — 이번 주", hot: true },
      { t: "스모트 QA·UI 다듬기" },
      { t: "PG 심사 대응" },
    ],
  },
  {
    name: "유선화",
    role: "마케팅 · 아이디 운영",
    items: [
      { t: "기능별 콘텐츠 제작 일정", hot: true },
      { t: "홍보 채널 다각화" },
      { t: "2차 영상·전단지·오픈챗" },
      { t: "커플 인플루언서 초청" },
    ],
  },
  {
    name: "유재영",
    role: "영업 · 인사관리",
    items: [
      { t: "세미나(7/18) 준비", hot: true },
      { t: "홍보 채널 다각화" },
      { t: "정보성 SMS · 전단지" },
      { t: "해외 인플루언서 초청" },
    ],
  },
];

const rnr: DeckSlide = {
  id: "rnr",
  chapter: "7월 팀별 R&R",
  render: () => (
    <Slide style={{ gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Reveal i={0}>
            <Kicker>July — Roles & Responsibilities</Kicker>
          </Reveal>
          <Reveal i={1}>
            <Title size={46} style={{ marginTop: 14 }}>
              7월, 각자의 전선.
            </Title>
          </Reveal>
        </div>
        <Reveal i={2}>
          <span style={{ fontSize: 14, color: DK.sub }}>
            <span style={{ color: DK.danger }}>●</span> 표시 = 이번 주 최우선
          </span>
        </Reveal>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, flex: 1 }}>
        {RNR.map((m, idx) => (
          <Reveal key={m.name} i={idx + 2}>
            <Panel style={{ height: "100%", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <Chip name={m.name} />
                <div style={{ fontSize: 12, color: DK.faint, marginTop: 8 }}>{m.role}</div>
              </div>
              <div style={{ height: 1, background: DK.line }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {m.items.map((it) => (
                  <div key={it.t} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span
                      style={{
                        marginTop: 7,
                        width: 5,
                        height: 5,
                        borderRadius: 99,
                        background: it.hot ? DK.danger : "rgba(148,163,184,.5)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 13.5, color: it.hot ? DK.ink : DK.sub, fontWeight: it.hot ? 700 : 500, lineHeight: 1.45 }}>
                      {it.t}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </Reveal>
        ))}
      </div>
    </Slide>
  ),
};

// ---- S11. 하반기 로드맵 --------------------------------------
// 현대백화점 팝업은 시점이 아직 확정되지 않아 월 칸이 아닌 "시점 미정" 칸에 둔다.
const ROADMAP: {
  month: string;
  items: { t: string; d?: string; money?: boolean }[];
  hot?: boolean;
  tbd?: boolean;
}[] = [
  { month: "8월", items: [{ t: "여름방학 총력전 마무리", d: "개학 전 유저 인프라 완성" }] },
  { month: "9월", items: [{ t: "제천 행사", d: "현장 운영 투입" }] },
  { month: "10월", items: [{ t: "K웨이브 페스티벌", d: "현장 운영 투입" }] },
  {
    month: "11월",
    hot: true,
    items: [
      { t: "안산 사이언스밸리 축제" },
      { t: "제이진옴므 부스 최종 납품", d: "계약 이행의 피날레" },
    ],
  },
  {
    month: "12월",
    hot: true,
    items: [{ t: "🎯 크리스마스 전 스모트 성과", d: "올해의 북극성 목표" }],
  },
  {
    month: "시점 미정",
    tbd: true,
    items: [{ t: "현대백화점 팝업스토어", d: "일정 확정 필요 · 상시 관리", money: true }],
  },
];

const roadmap: DeckSlide = {
  id: "roadmap",
  chapter: "하반기 로드맵",
  render: () => (
    <Slide style={{ gap: 20 }}>
      <Reveal i={0}>
        <Kicker color={DK.amber}>H2 Roadmap · 2026</Kicker>
      </Reveal>
      <Reveal i={1}>
        <Title size={46}>하반기 — 이벤트 러시.</Title>
      </Reveal>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${ROADMAP.length}, 1fr)`, gap: 14, flex: 1 }}>
        {ROADMAP.map((m, idx) => (
          <Reveal key={m.month} i={idx + 2}>
            <div
              style={{
                height: "100%",
                borderRadius: 14,
                border: m.tbd
                  ? `1px dashed rgba(251,191,36,.55)`
                  : `1px solid ${m.hot ? "rgba(251,191,36,.45)" : DK.line}`,
                background: m.hot ? "rgba(251,191,36,.05)" : DK.panel,
                padding: "16px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                className="dk-serif"
                style={{
                  fontSize: m.tbd ? 22 : 30,
                  lineHeight: m.tbd ? "38px" : undefined,
                  fontWeight: 900,
                  color: m.hot || m.tbd ? DK.amber : DK.ink,
                }}
              >
                {m.month}
              </div>
              <div style={{ height: 1, background: DK.line }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {m.items.map((it) => (
                  <div key={it.t}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: DK.ink, lineHeight: 1.4, wordBreak: "keep-all" }}>
                      {it.t}{" "}
                      {it.money && (
                        <span className="dk-mono" style={{ fontSize: 12, color: DK.amber, border: `1px solid ${DK.amber}`, borderRadius: 5, padding: "1px 6px", marginLeft: 2 }}>
                          ₩100M
                        </span>
                      )}
                    </div>
                    {it.d && <div style={{ fontSize: 12.5, color: DK.sub, marginTop: 3, lineHeight: 1.45 }}>{it.d}</div>}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal i={7}>
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${DK.line}`,
            padding: "13px 22px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 14.5,
            color: DK.sub,
          }}
        >
          <span className="dk-mono" style={{ fontSize: 11.5, letterSpacing: ".26em", color: DK.smoat }}>
            ALWAYS-ON
          </span>
          <span>관광벤처 공모사업 관리</span>
          <span style={{ color: DK.faint }}>·</span>
          <span>스모트 · 악센트 아이디 성장</span>
          <span style={{ color: DK.faint }}>·</span>
          <span>와우 운영</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: DK.faint }}>이 모든 걸 “기본값”으로 굴리면서 위 일정을 소화한다.</span>
        </div>
      </Reveal>
    </Slide>
  ),
};

export const SLIDES_STRATEGY: DeckSlide[] = [marketing, golden, rnr, roadmap];
