// ============================================================
//  2026-07-07 김주연 회의 준비 자료 — 2장. 사업 현황
//  (사주 프로그램 · 제이진옴므 · 스모트 개발 · 스모트 타임라인)
// ------------------------------------------------------------
//  근거 데이터:
//   - 6/21 「악센트 아이디 업무 분담」 회의록 (뿌덕 4탄 = 사주, 마감 7/15)
//   - 6/21 「스모트 업무 분담」 회의록 (영상·링크트리·세미나 7/18·SMS)
//   - 7/1  「스모트 크레딧 정책」 회의록 (환수·소멸시효·얼리버드 문구)
//   - 개발 허브 타임라인 (문제 퀄리티 fable 5 감사 루프 · 성적표 모듈)
// ============================================================
import type { DeckSlide } from "@/components/neander/deck/Deck";
import { DK, Slide, Reveal, Kicker, Title, Chip, Tag, Panel, Line } from "@/components/neander/deck/parts";

// ---- S4. 악센트 아이디 — 사주 프로그램(뿌덕 4탄) --------------
const saju: DeckSlide = {
  id: "saju",
  chapter: "01 · 악센트 아이디",
  render: () => (
    <Slide style={{ flexDirection: "row", gap: 56 }}>
      <div style={{ flex: 1.15, display: "flex", flexDirection: "column", gap: 20 }}>
        <Reveal i={0}>
          <Kicker color={DK.id}>Agenda 01 · 악센트 아이디</Kicker>
        </Reveal>
        <Reveal i={1}>
          <Title size={50}>
            사주 프로그램,
            <br />
            뿌덕 4탄.
          </Title>
        </Reveal>
        <Reveal i={2} style={{ flex: 1 }}>
          <Panel accent={DK.dev} style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Tag color={DK.dev} solid>ON TRACK</Tag>
              <Chip name="김주연" />
              <Chip name="이동주" dim />
              <span style={{ fontSize: 13.5, color: DK.sub }}>초안 개발 진행 중 (6/21 공동 배정)</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
              <span className="dk-mono" style={{ fontSize: 96, fontWeight: 800, color: DK.dev, lineHeight: 1 }}>
                D-8
              </span>
              <span className="dk-mono" style={{ fontSize: 17, color: DK.sub, letterSpacing: ".18em" }}>
                → 2026.07.15 (수)
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 18.5, fontWeight: 700, color: DK.ink, lineHeight: 1.5 }}>
              “7월 15일 전, 원래 계획대로{" "}
              <span style={{ color: DK.dev }}>무조건 가능</span>합니다.”
            </p>
          </Panel>
        </Reveal>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 56 }}>
        <Reveal i={3}>
          <div className="dk-mono" style={{ fontSize: 12, letterSpacing: ".3em", color: DK.faint }}>
            함께 도는 아이디 트랙 — 6/21 배정
          </div>
        </Reveal>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 6 }}>
          <Reveal i={4}>
            <Line
              color={DK.id}
              head="Klook · Fever · TripAdvisor 채널 등록"
              desc={<>김주연 · 사주와 같은 ~7/15 마감</>}
            />
          </Reveal>
          <Reveal i={5}>
            <Line
              color={DK.id}
              head="커플 인플루언서 초청"
              desc={<>유선화 · 매주 금요일 주간보고 · ~7/31</>}
            />
          </Reveal>
          <Reveal i={6}>
            <Line
              color={DK.id}
              head="해외 인플루언서 초청"
              desc={<>유재영 · ~7/31</>}
            />
          </Reveal>
          <Reveal i={7}>
            <Line
              color={DK.id}
              head="키캡 클리커 디퓨저 출시 준비"
              desc={<>유선화 · 이동주 — 기한 6/30 경과, 진행 상황 오늘 확인</>}
            />
          </Reveal>
        </div>
        <Reveal i={8} style={{ marginTop: "auto" }}>
          <div style={{ fontSize: 12.5, color: DK.faint }}>
            출처 — 6/21 「악센트 아이디 업무 분담」 회의록 (ERP 회의록 탭)
          </div>
        </Reveal>
      </div>
    </Slide>
  ),
};

// ---- S5. 제이진옴므 — 최종 계약 완료 --------------------------
const jjinhomme: DeckSlide = {
  id: "jjinhomme",
  chapter: "02 · 제이진옴므",
  render: () => (
    <Slide style={{ gap: 24 }}>
      <Reveal i={0}>
        <Kicker color={DK.jj}>Agenda 02 · 신규 프로젝트</Kicker>
      </Reveal>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 22 }}>
        <Reveal i={1}>
          <Title size={54}>제이진옴므, 최종 계약 완료.</Title>
        </Reveal>
        <Reveal i={2} style={{ paddingBottom: 10 }}>
          <Tag color={DK.jj} solid>SIGNED ✓</Tag>
        </Reveal>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
        {[
          { big: "3개월", label: "러닝타임", desc: "지금 막 시작 — 7월 킥오프" },
          { big: "70%", label: "김제연 전담", desc: "사실상 프로젝트 리드" },
          { big: "서포트", label: "김주연", desc: "스모트·사주와 병행 지원" },
        ].map((s, idx) => (
          <Reveal key={s.label} i={idx + 3}>
            <Panel style={{ textAlign: "center", padding: "22px 18px" }}>
              <div className="dk-serif" style={{ fontSize: 44, fontWeight: 900, color: DK.jj, lineHeight: 1.1 }}>
                {s.big}
              </div>
              <div style={{ fontSize: 16.5, fontWeight: 800, color: DK.ink, marginTop: 6 }}>{s.label}</div>
              <div style={{ fontSize: 13.5, color: DK.sub, marginTop: 3 }}>{s.desc}</div>
            </Panel>
          </Reveal>
        ))}
      </div>

      <Reveal i={6}>
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${DK.danger}`,
            background: "rgba(248,113,113,.07)",
            padding: "16px 22px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Tag color={DK.danger} solid>ASAP</Tag>
          <Chip name="이동주" />
          <div>
            <div style={{ fontSize: 17.5, fontWeight: 800, color: DK.ink }}>
              하드웨어 기획 — 최대한 빠르게 착수
            </div>
            <div style={{ fontSize: 14, color: DK.sub }}>
              구체 착수·초안 일정은 오늘 회의에서 확정.
            </div>
          </div>
        </div>
      </Reveal>

      {/* 러닝타임 마일스톤 바 */}
      <Reveal i={7} style={{ marginTop: "auto" }}>
        <div style={{ position: "relative", paddingTop: 8 }}>
          <div className="dk-grow" style={{ height: 2, background: `linear-gradient(90deg, ${DK.jj}, rgba(232,192,125,.15))` }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", marginTop: 14 }}>
            {[
              { t: "7월", d: "킥오프 · 하드웨어 기획(ASAP)", on: true },
              { t: "8월", d: "본 개발 · 제작 (예정)", on: false },
              { t: "10월 초", d: "3개월 러닝타임 종료 (예상)", on: false },
              { t: "11월", d: "부스 최종 납품", on: false },
            ].map((m) => (
              <div key={m.t}>
                <div className="dk-mono" style={{ fontSize: 14, fontWeight: 700, color: m.on ? DK.jj : DK.sub, letterSpacing: ".12em" }}>
                  {m.t} {m.on && "◉"}
                </div>
                <div style={{ fontSize: 13.5, color: m.on ? DK.ink : DK.faint, marginTop: 4, paddingRight: 18 }}>{m.d}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </Slide>
  ),
};

// ---- S6. 스모트 — 개발 트랙 ----------------------------------
const smoatDev: DeckSlide = {
  id: "smoat-dev",
  chapter: "03 · 스모트 개발",
  render: () => (
    <Slide style={{ gap: 22 }}>
      <Reveal i={0}>
        <Kicker>Agenda 03 · 스모트 — 개발 트랙</Kicker>
      </Reveal>
      <Reveal i={1}>
        <Title size={46}>개발은 디테일 싸움.</Title>
      </Reveal>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 18, flex: 1 }}>
        <Reveal i={2}>
          <Panel accent={CREW_BLUE} style={{ height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Chip name="김주연" />
              <span style={{ fontSize: 13, color: DK.sub }}>제품 코어 — 4개 트랙 동시 진행</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              <Line
                head="문제 생성 퀄리티 — 한 문항씩 정밀 검수·개선"
                desc="AI 품질 감사 루프 가동 중 · 프리미엄 티어 통과율 36.5% → 48.1%"
              />
              <Line head="사설 모의고사 제작" desc="실전 세트 양산 체계" />
              <Line head="학생용 태블릿 학습 툴 개발" />
              <Line
                head="시험지 분석 리포트 (성적표 모듈)"
                desc="DB·생성 파이프라인·학생 열람 페이지 — 골격 완성 단계"
              />
            </div>
          </Panel>
        </Reveal>

        <Reveal i={3}>
          <Panel accent={CREW_PINK} style={{ height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Chip name="이동주" />
              <span style={{ fontSize: 13, color: DK.sub }}>품질 · 심사 — 이어받아 지속</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              <Line color={CREW_PINK} head="QA · UI 다듬기" desc="사용자 경험 완성도 지속 개선" />
              <Line color={CREW_PINK} head="PG(결제) 심사 대응" desc="결제 오픈의 관문 — 최우선 처리" />
              <Line color={CREW_PINK} head="공지사항 + 업데이트 소개 팝업" desc="개발 보드 대기열 (다음 타자)" />
            </div>
          </Panel>
        </Reveal>
      </div>

      <Reveal i={4}>
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${DK.smoat}`,
            background: "rgba(34,211,238,.06)",
            padding: "14px 22px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span style={{ fontSize: 20 }}>🎯</span>
          <span style={{ fontSize: 17.5, fontWeight: 800, color: DK.ink }}>
            올해 목표 — <span style={{ color: DK.smoat }}>크리스마스 전, 유의미한 결과.</span>
          </span>
          <span style={{ fontSize: 14, color: DK.sub }}>모든 개발·마케팅 의사결정의 기준점.</span>
        </div>
      </Reveal>
    </Slide>
  ),
};

const CREW_BLUE = "#60a5fa"; // 김주연
const CREW_PINK = "#f472b6"; // 이동주

// ---- S7. 스모트 — 지금까지의 타임라인 -------------------------
const TIMELINE: { date: string; label: string; desc: string; state: "past" | "today" | "future" }[] = [
  { date: "6/21", label: "업무 분담 회의", desc: "영상·링크트리·세미나·SMS 배정", state: "past" },
  { date: "6/26", label: "링크트리 오픈", desc: "스모트·오픈챗·세미나 신청 입구", state: "past" },
  { date: "7/1", label: "광고 1차 마감 · 크레딧 정책", desc: "META 2건 배정 · 얼리버드 150% 문구", state: "past" },
  { date: "7/7", label: "오늘 — 실행전략 확정", desc: "2차 영상·전단지·오픈챗·세미나", state: "today" },
  { date: "7/15", label: "사주 프로그램 완성", desc: "뿌덕 4탄 (아이디 트랙)", state: "future" },
  { date: "7/18", label: "단체 세미나", desc: "기획·대관·마케팅·리워드", state: "future" },
];

const smoatTimeline: DeckSlide = {
  id: "smoat-timeline",
  chapter: "스모트 — 타임라인",
  render: () => (
    <Slide style={{ gap: 18 }}>
      <Reveal i={0}>
        <Kicker>스모트 — 지금까지 온 길</Kicker>
      </Reveal>
      <Reveal i={1}>
        <Title size={46}>6월 21일부터, 17일간.</Title>
      </Reveal>
      <Reveal i={2}>
        <p style={{ margin: 0, fontSize: 16, color: DK.sub }}>
          업무 분담 → 입구 개설 → 1차 광고·크레딧 정책까지 진행. 오늘은{" "}
          <span style={{ color: DK.smoat, fontWeight: 700 }}>실행전략을 확정</span>하는 날.
        </p>
      </Reveal>

      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
        {/* 레일 */}
        <div
          className="dk-grow"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 2,
            background: `linear-gradient(90deg, ${DK.smoat} 0%, ${DK.smoat} 60%, rgba(148,163,184,.25) 62%)`,
          }}
        />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${TIMELINE.length}, 1fr)`, width: "100%" }}>
          {TIMELINE.map((n, idx) => {
            const isToday = n.state === "today";
            const done = n.state === "past";
            const color = isToday ? DK.amber : done ? DK.smoat : DK.faint;
            const up = idx % 2 === 0; // 지그재그 배치로 라벨 겹침 방지
            return (
              <Reveal key={n.date} i={idx + 2}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: 300, justifyContent: "center" }}>
                  <div style={{ height: 120, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", textAlign: "center" }}>
                    {up && <NodeLabel n={n} color={color} />}
                  </div>
                  <div
                    style={{
                      width: isToday ? 18 : 12,
                      height: isToday ? 18 : 12,
                      borderRadius: 99,
                      margin: "12px 0",
                      background: done || isToday ? color : "#0a0d14",
                      border: `2px solid ${color}`,
                      boxShadow: isToday ? `0 0 0 7px rgba(251,191,36,.16)` : "none",
                    }}
                  />
                  <div style={{ height: 120, display: "flex", flexDirection: "column", justifyContent: "flex-start", alignItems: "center", textAlign: "center" }}>
                    {!up && <NodeLabel n={n} color={color} />}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </Slide>
  ),
};

function NodeLabel({
  n,
  color,
}: {
  n: (typeof TIMELINE)[number];
  color: string;
}) {
  return (
    <div style={{ maxWidth: 168, wordBreak: "keep-all" }}>
      <div className="dk-mono" style={{ fontSize: 15, fontWeight: 800, color, letterSpacing: ".08em" }}>
        {n.date}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: n.state === "future" ? DK.sub : DK.ink, marginTop: 4, lineHeight: 1.3 }}>
        {n.label}
      </div>
      <div style={{ fontSize: 12.5, color: DK.faint, marginTop: 3, lineHeight: 1.4 }}>{n.desc}</div>
    </div>
  );
}

export const SLIDES_STATUS: DeckSlide[] = [saju, jjinhomme, smoatDev, smoatTimeline];
