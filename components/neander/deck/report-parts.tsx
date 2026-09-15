// ============================================================
//  월간 보고 슬라이드 공용 부품 — 재무·매출 리포트 덱이 같이 쓴다
// ------------------------------------------------------------
//  두 덱이 증감 표기(▲▼ · 좋은 방향이면 초록)와 막대 표를 따로 그리면
//  같은 회의에서 넘겨 보는 두 자료의 읽는 법이 달라진다. 그래서 한 곳에 둔다.
//  1280×720 캔버스 기준 px 고정. 음수는 △ (색만으로 부호를 전하지 않는다).
// ============================================================
import type { CSSProperties, ReactNode } from "react";
import { DK, Kicker, Reveal, Title } from "./parts";
import { formatSigned } from "@/lib/neander/format";

export const C = {
  income: DK.dev,
  expense: DK.wow,
  net: DK.smoat,
  bad: DK.danger,
} as const;

export const won = (n: number) => formatSigned(n);
export const monthNum = (m: string) => `${Number(m.slice(5, 7))}월`;

/** 막대 표 한 줄 — 이번 달 값과 전월 값 */
export interface BarLine {
  label: string;
  /** 상위 분류 (이름 옆 흐린 글씨) */
  parent?: string;
  value: number;
  prev: number;
}

/** 전월 대비 — good: 늘어난 게 좋은 값인가 (수입 true, 지출 false) */
export function Delta({ cur, prev, good, hasPrev, size = 14 }: { cur: number; prev: number; good: boolean; hasPrev: boolean; size?: number }) {
  if (!hasPrev) return <span style={{ fontSize: size, color: DK.faint }}>전월 자료 없음</span>;
  const d = cur - prev;
  if (d === 0) return <span style={{ fontSize: size, color: DK.faint }}>전월과 같음</span>;
  const up = d > 0;
  const color = up === good ? C.income : C.bad;
  const pct = prev !== 0 ? `${((d / Math.abs(prev)) * 100).toFixed(1)}%` : "신규";
  return (
    <span style={{ fontSize: size, color, fontWeight: 600, whiteSpace: "nowrap" }}>
      {up ? "▲" : "▼"} {pct.replace("-", "")}
      <span style={{ color: DK.sub, fontWeight: 500 }}> · {up ? "+" : "−"}{Math.abs(d).toLocaleString("ko-KR")}원</span>
    </span>
  );
}

export function Header({ kicker, title, aside, color }: { kicker: string; title: ReactNode; aside?: ReactNode; color?: string }) {
  return (
    <Reveal i={0}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 30 }}>
        <div>
          <Kicker color={color}>{kicker}</Kicker>
          <Title size={40} style={{ marginTop: 14 }}>{title}</Title>
        </div>
        {aside && <div style={{ fontSize: 13, color: DK.faint, textAlign: "right", lineHeight: 1.6 }}>{aside}</div>}
      </div>
    </Reveal>
  );
}

/** 가로 막대 표 — 줄이 많으면 뒤를 「기타」로 묶는다 */
export function BarRows({
  lines,
  total,
  color,
  good,
  hasPrev,
  max = 8,
  head = "계정",
  restLabel = (n: number) => `기타 ${n}개 계정`,
  renderValue,
}: {
  /** 금액 칸을 감싼다 — 커서를 두면 내역이 뜨는 드릴 등 (「기타」 묶음 줄에도 불린다) */
  renderValue?: (line: BarLine, node: ReactNode) => ReactNode;
  lines: BarLine[];
  total: number;
  color: string;
  good: boolean;
  hasPrev: boolean;
  max?: number;
  head?: string;
  restLabel?: (n: number) => string;
}) {
  let rows = lines;
  if (lines.length > max) {
    const rest = lines.slice(max - 1);
    rows = [
      ...lines.slice(0, max - 1),
      {
        label: restLabel(rest.length),
        value: rest.reduce((s, l) => s + l.value, 0),
        prev: rest.reduce((s, l) => s + l.prev, 0),
      },
    ];
  }
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (rows.length === 0) {
    return <div style={{ fontSize: 18, color: DK.faint, padding: "60px 0", textAlign: "center" }}>이 달에 잡힌 금액이 없습니다.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 150px 64px 250px", gap: 16, fontSize: 12, color: DK.faint, letterSpacing: ".04em", paddingBottom: 4, borderBottom: `1px solid ${DK.line}` }}>
        <span>{head}</span><span /><span style={{ textAlign: "right" }}>금액(원)</span><span style={{ textAlign: "right" }}>비중</span><span style={{ textAlign: "right" }}>전월 대비</span>
      </div>
      {rows.map((r, i) => (
        <Reveal key={r.label + i} i={i + 1}>
          <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 150px 64px 250px", gap: 16, alignItems: "center", height: 38 }}>
            <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: DK.ink }}>{r.label}</span>
              {r.parent && <span style={{ fontSize: 12, color: DK.faint, marginLeft: 8 }}>{r.parent}</span>}
            </div>
            <div style={{ height: 14, borderRadius: 99, background: "rgba(148,163,184,.08)", overflow: "hidden" }}>
              <div className="dk-grow" style={{ "--i": i, height: "100%", width: `${(Math.abs(r.value) / top) * 100}%`, background: r.value < 0 ? C.bad : color, borderRadius: 99 } as CSSProperties} />
            </div>
            <span style={{ textAlign: "right", fontSize: 17, fontWeight: 700, color: DK.ink, fontVariantNumeric: "tabular-nums" }}>
              {renderValue ? renderValue(r, won(r.value)) : won(r.value)}
            </span>
            <span style={{ textAlign: "right", fontSize: 14, color: DK.sub, fontVariantNumeric: "tabular-nums" }}>
              {total ? `${((r.value / total) * 100).toFixed(1)}%` : "—"}
            </span>
            <span style={{ textAlign: "right" }}><Delta cur={r.value} prev={r.prev} good={good} hasPrev={hasPrev} size={13} /></span>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
