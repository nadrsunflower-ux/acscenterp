// ============================================================
//  Deck 공용 부품 — 슬라이드 안에서 쓰는 작은 빌딩블록
//  (1280×720 캔버스 기준 px 고정 크기)
// ============================================================
import type { CSSProperties, ReactNode } from "react";

/** 딥 네이비 캔버스 위 공용 팔레트 (다크 배경용으로 밝게 보정) */
export const DK = {
  ink: "#eef0e9", // 본문
  sub: "rgba(238,240,233,.62)", // 보조 텍스트
  faint: "rgba(238,240,233,.38)", // 흐린 텍스트
  line: "rgba(148,163,184,.18)", // 헤어라인
  panel: "rgba(148,163,184,.07)", // 카드 바탕
  smoat: "#22d3ee", // 스모트 (시안)
  id: "#a78bfa", // 악센트 아이디 (바이올렛)
  wow: "#fb923c", // 와우 (오렌지)
  dev: "#34d399", // 개발 (에메랄드)
  jj: "#e8c07d", // 제이진옴므 (샴페인 골드)
  danger: "#f87171", // 긴급/결정 필요
  amber: "#fbbf24", // 주의/데드라인
} as const;

/** 팀원 표시 정보 — ERP 팀원 색을 다크 배경용으로 밝게 보정 */
export const CREW: Record<string, { emoji: string; color: string }> = {
  김주연: { emoji: "🦊", color: "#60a5fa" },
  김제연: { emoji: "🦄", color: "#c084fc" },
  이동주: { emoji: "🐯", color: "#f472b6" },
  유재영: { emoji: "🐼", color: "#22d3ee" },
  유선화: { emoji: "🐤", color: "#4ade80" },
};

/** 슬라이드 본문 컨테이너 — 공통 여백(하단은 푸터 크롬 회피) */
export function Slide({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "64px 84px 84px",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** 스태거 등장 래퍼 — i 순서대로 아래에서 떠오른다 */
export function Reveal({
  i = 0,
  children,
  className = "",
  style,
}: {
  i?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`dk-rise ${className}`}
      style={{ "--i": i, ...style } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** 모노 대문자 킥커 (섹션 라벨) */
export function Kicker({
  children,
  color = DK.smoat,
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <div
      className="dk-mono"
      style={{
        fontSize: 12,
        letterSpacing: ".38em",
        color,
        display: "flex",
        alignItems: "center",
        gap: 14,
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 28, height: 1, background: color, opacity: 0.7 }} />
      {children}
    </div>
  );
}

/** 세리프 대제목 */
export function Title({
  children,
  size = 52,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <h2
      className="dk-serif"
      style={{
        margin: 0,
        fontSize: size,
        lineHeight: 1.18,
        fontWeight: 900,
        letterSpacing: "-0.01em",
        color: DK.ink,
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

/** 팀원 칩 (sm: 표/밀집 레이아웃용 축소판) */
export function Chip({
  name,
  dim = false,
  sm = false,
}: {
  name: string;
  dim?: boolean;
  sm?: boolean;
}) {
  const c = CREW[name];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sm ? 4 : 6,
        padding: sm ? "2px 9px 2px 6px" : "4px 12px 4px 8px",
        borderRadius: 999,
        border: `1px solid ${c ? c.color : DK.line}`,
        background: dim ? "transparent" : "rgba(10,13,20,.5)",
        color: c ? c.color : DK.ink,
        fontSize: sm ? 12 : 14,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: sm ? 12 : 15 }}>{c?.emoji}</span>
      {name}
    </span>
  );
}

/** 상태/분류 태그 */
export function Tag({
  children,
  color = DK.smoat,
  solid = false,
}: {
  children: ReactNode;
  color?: string;
  solid?: boolean;
}) {
  return (
    <span
      className="dk-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: 11.5,
        letterSpacing: ".14em",
        fontWeight: 700,
        color: solid ? "#0a0d14" : color,
        background: solid ? color : "transparent",
        border: solid ? "none" : `1px solid ${color}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** 카드 패널 */
export function Panel({
  children,
  accent,
  style,
}: {
  children: ReactNode;
  /** 좌측 포인트 보더 색 */
  accent?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: DK.panel,
        border: `1px solid ${DK.line}`,
        borderLeft: accent ? `3px solid ${accent}` : `1px solid ${DK.line}`,
        borderRadius: 14,
        padding: "20px 24px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** 불릿 한 줄 (제목 + 보조설명) */
export function Line({
  head,
  desc,
  color = DK.smoat,
}: {
  head: ReactNode;
  desc?: ReactNode;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span
        style={{
          marginTop: 9,
          width: 6,
          height: 6,
          borderRadius: 99,
          background: color,
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: DK.ink, lineHeight: 1.45 }}>
          {head}
        </div>
        {desc && (
          <div style={{ fontSize: 14, color: DK.sub, lineHeight: 1.5, marginTop: 2 }}>
            {desc}
          </div>
        )}
      </div>
    </div>
  );
}
