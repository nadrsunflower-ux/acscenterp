"use client";

// ============================================================
//  장표 핵심 시각 요소 — 장마다 하나, 전부 가정값·실측에서 다시 그린다
// ------------------------------------------------------------
//  숫자는 model(v · r)에서만 온다. 이름표·설명 문구는 내용(opts)에서 온다 —
//  저장소가 public 이라 내부 표현을 코드에 두지 않는다.
//
//  색: 사업부 ① 주황(--sd-a, 따뜻한 색), ② 파랑(--sd-b, 차가운 색). 부족분·증가는
//  빨강, 메우는 쪽·절감은 초록(상태 색, 글자로도 부호를 쓴다). 계열이 둘 이상이면
//  범례를 두고, 값은 막대에 바로 적는다.
//  글씨: SVG 는 18 이상(T), HTML 은 역할 클래스(sd-lbl 20 · td 22 · 본문 26).
// ============================================================

import type { ReactNode } from "react";
import * as calc from "@/lib/neander/decks/calc";
import * as F from "@/lib/neander/decks/format";
import { getPath } from "@/lib/neander/decks/template";
import { Md, academyLabeler, useSd } from "./context";
import { SvgBox, T, hbarPath, niceTicks, vbarPath } from "./charts";
import { Icon } from "./icons";

type Opts = Record<string, unknown>;
const str = (x: unknown, d = "") => (typeof x === "string" ? x : d);
const numOr = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** "2026-10" 에서 "2027-09" 까지 몇 달 뒤인가 */
const monthDiff = (from: string, to: string) => {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};
const addMonths = (m: string, k: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="sd-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i
            style={
              it.dashed
                ? { background: "transparent", border: `2px dashed ${it.color}`, width: 16, height: 0, borderRadius: 0, verticalAlign: 4 }
                : { background: it.color }
            }
          />
          <Md text={it.label} />
        </span>
      ))}
    </div>
  );
}

// ============================================================
//  1. 결론 — 두 엔진 + 매출 비중 막대
// ============================================================

type EngineOpt = { icon?: string; name: string; role: string; how: string };

export function Engines({ opts }: { opts: Opts }) {
  const { r, v } = useSd().model;
  const a = opts.a as EngineOpt;
  const b = opts.b as EngineOpt;
  const shareA = r.mix.unit1Share ?? 0;
  const shareB = r.mix.smoatShare ?? 0;
  const card = (e: EngineOpt, tone: "a" | "b", amount: number, share: number | null) => (
    <div className={`sd-engine sd-tone-${tone}`} data-box>
      <div className="sd-engine-top">
        <span className="sd-engine-icon">
          <Icon name={e.icon} size={32} />
        </span>
        <div className="sd-engine-name">
          <Md text={e.name} />
        </div>
      </div>
      <div className="sd-engine-role">
        <Md text={e.role} />
      </div>
      <div className="sd-engine-how">
        <Md text={e.how} />
      </div>
      <div className="sd-engine-how" style={{ marginTop: "auto" }}>
        지금 월 매출 <b>{F.man(amount)}</b> ({F.ratio(share)})
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sd-engines">
        {card(a, "a", r.mix.unit1Amount, r.mix.unit1Share)}
        <div className="sd-engine-link">
          <Icon name="split" size={36} />
          <span className="sd-lbl" style={{ textAlign: "center" }}>
            <Md text={str(opts.link)} />
          </span>
        </div>
        {card(b, "b", v.revSmoat as number, r.mix.smoatShare)}
      </div>
      <div data-box>
        <div className="sd-lbl" style={{ marginBottom: 8 }}>
          <Md text={str(opts.barLabel, "지금 월 매출 비중")} />
        </div>
        <div className="sd-stack" role="img" aria-label="사업부별 월 매출 비중">
          <div style={{ width: `${shareA * 100}%`, background: "var(--sd-a)" }} />
          <div style={{ width: `${Math.max(0.6, shareB * 100)}%`, background: "var(--sd-b)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, gap: 16 }}>
          <span className="sd-lbl sd-a-text">
            ① {F.man(r.mix.unit1Amount)} · {F.ratio(shareA)}
          </span>
          <span className="sd-lbl sd-b-text">
            ② {F.man(v.revSmoat as number, 1)} · {F.ratio(shareB)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  매장 이전 — 회수 개월 타임라인 + 재계약 선
// ============================================================

export function RelocTimeline({ opts }: { opts: Opts }) {
  const { r } = useSd().model;
  const start = str(opts.start, "2026-10");
  const marks = (opts.marks as { month: string; label: string }[] | undefined) ?? [];
  const labels = (opts.rowLabels as string[] | undefined) ?? ["최소", "중간", "최대"];
  const rows = r.reloc.rows.map((row, i) => {
    const ms = row.cells.map((c) => c.months).filter(ok);
    return { i, cost: row.cost, lo: ms.length ? Math.min(...ms) : null, hi: ms.length ? Math.max(...ms) : null };
  });
  const maxM = Math.max(36, ...rows.map((x) => x.hi ?? 0));
  const span = Math.ceil((maxM + 4) / 12) * 12;
  const top = 78;
  const rowH = 62;
  const h = top + rows.length * rowH + 40;
  return (
    <SvgBox h={h} minW={640} fallback={860} label="이전비 회수 개월과 재계약 시점">
      {(w) => {
        const left = 200;
        const right = 130;
        const x = (m: number) => left + ((w - left - right) * m) / span;
        const years: { m: number; y: number }[] = [];
        for (let k = 0; k <= span; k++) {
          const mm = addMonths(start, k);
          if (mm.endsWith("-01")) years.push({ m: k, y: Number(mm.slice(0, 4)) });
        }
        const bottom = top + rows.length * rowH;
        return (
          <>
            {years.filter((yy) => x(yy.m) - x(0) > 130).map((yy) => (
              <g key={yy.y}>
                <line x1={x(yy.m)} x2={x(yy.m)} y1={top - 8} y2={bottom} stroke="var(--sd-line2)" />
                <text x={x(yy.m)} y={bottom + 28} fontSize={T.axis} fill="var(--sd-fg3)" textAnchor="middle">
                  {yy.y}
                </text>
              </g>
            ))}
            <line x1={x(0)} x2={x(span)} y1={bottom} y2={bottom} stroke="var(--sd-line)" />
            <text x={x(0)} y={bottom + 28} fontSize={T.axis} fill="var(--sd-fg3)" textAnchor="start">
              {`지금 ${F.dateLabel(start)}`}
            </text>
            {marks.map((mk, k) => {
              const m = monthDiff(start, mk.month) + 1;
              const xx = x(m);
              const ly = 22 + k * 26;
              return (
                <g key={mk.month}>
                  <line x1={xx} x2={xx} y1={ly + 6} y2={bottom} stroke="var(--sd-warn)" strokeWidth={2} strokeDasharray="6 5" />
                  <text x={xx + 8} y={ly} fontSize={T.axis} fontWeight={700} fill="var(--sd-warn)">
                    {`${mk.label} ${F.dateLabel(mk.month)}`}
                  </text>
                </g>
              );
            })}
            {rows.map((row) => {
              const y = top + row.i * rowH + 12;
              const bh = 30;
              return (
                <g key={row.i}>
                  <text x={0} y={y + bh / 2 + 7} fontSize={T.label} fill="var(--sd-fg2)">
                    {`${labels[row.i] ?? ""} ${F.eok(row.cost)}`}
                  </text>
                  {ok(row.lo) && ok(row.hi) ? (
                    <>
                      <line x1={x(0)} x2={x(row.lo)} y1={y + bh / 2} y2={y + bh / 2} stroke="var(--sd-a)" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="2 6" />
                      <rect x={x(row.lo)} y={y} width={Math.max(6, x(row.hi) - x(row.lo))} height={bh} rx={6} fill="var(--sd-a)">
                        <title>{`회수 ${F.months(Math.round(row.lo))}~${F.months(Math.round(row.hi))}`}</title>
                      </rect>
                      <text x={x(row.hi) + 10} y={y + bh / 2 + 8} fontSize={T.value} fontWeight={800} fill="var(--sd-fg)">
                        {`${Math.round(row.lo)}~${Math.round(row.hi)}개월`}
                      </text>
                    </>
                  ) : (
                    <text x={x(0)} y={y + bh / 2 + 7} fontSize={T.label} fill="var(--sd-fg3)">
                      {F.EMPTY}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </SvgBox>
  );
}

// ============================================================
//  매출 구성 · 지출 vs 매출 vs 지원금 · 기준 기간
// ============================================================

/** 매출 갈래 색 — ② 는 파랑, 「키우지 않음」 은 회색, 나머지 ① 은 주황 두 단 */
export function mixColor(unit: string, i1: number): string {
  if (unit.includes("②")) return "var(--sd-b)";
  if (unit.includes("키우지")) return "var(--sd-muted-bar)";
  return i1 % 2 === 0 ? "var(--sd-a-text)" : "var(--sd-a)";
}

export function RevenueMix() {
  const { r } = useSd().model;
  const rows = r.mix.rows;
  const total = r.mix.total || 1;
  let k = 0;
  const colors = rows.map((row) => (row.unit.includes("①") && !row.unit.includes("키우지") ? mixColor(row.unit, k++) : mixColor(row.unit, 0)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-box>
      <div className="sd-stack" role="img" aria-label="월 매출 구성">
        {rows.map((row, i) => (
          <div
            key={row.key}
            title={`${row.label} ${F.man(row.amount)} (${F.ratio(row.share)})`}
            style={{ width: `${(Math.max(0, row.amount) / total) * 100}%`, background: colors[i] }}
          />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr) auto 56px 34px", gap: "6px 12px", alignItems: "center" }}>
        {rows.map((row, i) => (
          <div key={row.key} style={{ display: "contents" }}>
            <span aria-hidden style={{ width: 16, height: 16, borderRadius: 4, background: colors[i] }} />
            <span className="sd-lbl" style={{ color: "var(--sd-fg)" }}>
              {row.label}
            </span>
            <span className="sd-lbl" style={{ textAlign: "right", fontWeight: 800, color: "var(--sd-fg)" }}>
              {F.man(row.amount, row.amount < 100 ? 1 : 0)}
            </span>
            <span className="sd-lbl" style={{ textAlign: "right" }}>
              {F.ratio(row.share)}
            </span>
            <span className="sd-lbl" style={{ textAlign: "center" }}>
              <Md text={row.unit.slice(0, 1)} />
            </span>
          </div>
        ))}
        <span />
        <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
          합계
        </span>
        <span className="sd-lbl" style={{ textAlign: "right", fontWeight: 800, color: "var(--sd-fg)" }}>
          {F.man(r.mix.total)}
        </span>
        <span />
        <span />
      </div>
    </div>
  );
}

/** 폭포 막대 하나 */
interface Fall {
  label: string;
  sub?: string;
  from: number;
  to: number;
  color: string;
  /** 막대 위 숫자 */
  text: string;
}

function Waterfall({ bars, h, label, minW = 560, fallback = 640 }: { bars: Fall[]; h: number; label: string; minW?: number; fallback?: number }) {
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  const top = 42;
  const hasSub = bars.some((b) => b.sub);
  const bottomPad = hasSub ? 70 : 44;
  return (
    <SvgBox h={h} minW={minW} fallback={fallback} label={label}>
      {(w) => {
        const plotH = h - top - bottomPad;
        const y = (v: number) => top + ((hi - v) / (hi - lo)) * plotH;
        const pitch = w / bars.length;
        const bw = Math.min(120, pitch * 0.56);
        return (
          <>
            <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="var(--sd-line)" />
            {bars.map((b, i) => {
              const cx = pitch * i + pitch / 2;
              const y1 = y(Math.max(b.from, b.to));
              const y2 = y(Math.min(b.from, b.to));
              const next = bars[i + 1];
              return (
                <g key={i}>
                  <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(2, y2 - y1)} rx={4} fill={b.color}>
                    <title>{`${b.label} ${b.text}`}</title>
                  </rect>
                  {next && (
                    <line
                      x1={cx + bw / 2}
                      x2={cx + pitch - bw / 2}
                      y1={y(b.to)}
                      y2={y(b.to)}
                      stroke="var(--sd-fg3)"
                      strokeDasharray="3 4"
                    />
                  )}
                  <text x={cx} y={y1 - 10} fontSize={T.value} fontWeight={800} fill="var(--sd-fg)" textAnchor="middle">
                    {b.text}
                  </text>
                  <text x={cx} y={h - bottomPad + 28} fontSize={T.label} fill="var(--sd-fg2)" textAnchor="middle" fontWeight={700}>
                    {b.label}
                  </text>
                  {b.sub && (
                    <text x={cx} y={h - bottomPad + 54} fontSize={T.axis} fill="var(--sd-fg3)" textAnchor="middle">
                      {b.sub}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </SvgBox>
  );
}

export function CashWaterfall() {
  const { r } = useSd().model;
  const c = r.cash;
  const bars: Fall[] = [
    { label: "월 지출", from: 0, to: c.cost, color: "var(--sd-muted-bar)", text: F.man(c.cost) },
    { label: "월 매출", from: c.cost, to: c.cost - c.revenue, color: "var(--sd-good)", text: `-${F.man(c.revenue)}` },
    { label: "부족분", from: 0, to: c.gap, color: "var(--sd-bad)", text: F.man(c.gap) },
    { label: "지원금", from: c.gap, to: c.gap - c.subsidy, color: "var(--sd-warn)", text: `-${F.man(c.subsidy)}` },
    { label: "지원금 뒤", from: 0, to: c.gapAfterSubsidy, color: "var(--sd-bad)", text: F.man(c.gapAfterSubsidy) },
  ];
  return <Waterfall bars={bars} h={360} label="월 지출, 매출, 지원금" />;
}

export function BasisCompare() {
  const { r } = useSd().model;
  const [b6, b12] = r.cash.byBasis;
  const head = (b: typeof b6) =>
    `${b.selected ? "**" : ""}최근 ${b.months}개월${b.selected ? " (지금)**" : ""}`;
  const cell = (x: number | null, b: typeof b6) => (b.selected ? `**${F.man(x)}**` : F.man(x));
  const rows: [string, (b: typeof b6) => number | null][] = [
    ["B2B 월 매출", (b) => b.b2b],
    ["월 매출 합", (b) => b.revenue],
    ["월 지출", (b) => b.cost],
    ["부족분 (지원금 제외)", (b) => b.gap],
  ];
  return (
    <div className="sd-table-wrap" data-box>
      <table className="sd-table">
        <colgroup>
          <col style={{ width: "40%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "30%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>기준 기간</th>
            <th className="sd-r">
              <Md text={head(b6)} />
            </th>
            <th className="sd-r">
              <Md text={head(b12)} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f], i) => (
            <tr key={label} className={i === rows.length - 1 ? "sd-strong" : undefined}>
              <td>{label}</td>
              <td className="sd-r">
                <Md text={cell(f(b6), b6)} />
              </td>
              <td className="sd-r">
                <Md text={cell(f(b12), b12)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunwayKpi() {
  const { r } = useSd().model;
  const c = r.cash;
  const tone = c.surplus ? "good" : c.needsBalance ? "muted" : "bad";
  return (
    <div className={`sd-kpi sd-tone-${tone}`} data-box>
      <div className="sd-kpi-label">런웨이 (지원금 {c.subsidyMode})</div>
      <div className="sd-kpi-value">{c.status}</div>
      <div className="sd-kpi-sub">
        {c.needsBalance
          ? `현금 잔고를 가정 패널에 넣으면 계산 · 월 부족 ${F.man(c.burn)}`
          : `잔고 ${F.eok(c.balance)} ÷ 월 부족 ${F.man(c.burn)}`}
      </div>
    </div>
  );
}

// ============================================================
//  스모트 숫자 — 대시보드 vs 실제 결제 · 무료 사용 도넛 · 이익률 두 가지
// ============================================================

export function SmoatMonthly() {
  const { r, v } = useSd().model;
  const sm = r.sm;
  if (!sm) return null;
  // 실제 결제 = 학원 결제 + 이름 없는 입금 (내부·테스트 제외). 기준 달은 가정값 「스모트 월 매출」 —
  // 동기화 전 확인값이나 회의 중 바꾼 값이 1장과 같은 숫자로 보이게
  const base = typeof v.revSmoat === "number" ? v.revSmoat * 1e4 : null;
  // 기준 달에 동기화 전 결제(확인값 − ERP)가 있으면 대시보드 합에도 더한다 — 실제 결제가 대시보드보다 커 보이지 않게
  const months = sm.months
    .filter((m) => m.month >= sm.avgFrom)
    .map((m) => {
      const real = m.month === sm.baseMonth && base !== null ? base : m.academies + m.unnamed;
      return { ...m, real, dashboard: m.dashboard + Math.max(0, real - (m.academies + m.unnamed)) };
    });
  const max = Math.max(1, ...months.map((m) => Math.max(m.dashboard, m.real)));
  const h = 380;
  return (
    <div className="sd-chart">
      <Legend
        items={[
          { color: "var(--sd-muted-bar)", label: "대시보드 (내부·테스트 결제 포함)" },
          { color: "var(--sd-b)", label: "실제 결제 (학원 · 이름 없는 입금)" },
        ]}
      />
      <SvgBox h={h} minW={520} fallback={760} label="스모트 월별 결제">
        {(w) => {
          const base = h - 66;
          const top = 40;
          const gw = w / months.length;
          const bw = Math.min(64, gw / 3.2);
          const y = (val: number) => base - ((base - top) * val) / max;
          return (
            <>
              <line x1={0} x2={w} y1={base} y2={base} stroke="var(--sd-line)" />
              {months.map((m, i) => {
                const cx = gw * i + gw / 2;
                return (
                  <g key={m.month}>
                    <path d={vbarPath(cx - bw - 2, y(m.dashboard), bw, base - y(m.dashboard))} fill="var(--sd-muted-bar)">
                      <title>{`${F.monthLabel(m.month)} 대시보드 ${F.won(m.dashboard)}`}</title>
                    </path>
                    <path d={vbarPath(cx + 2, y(m.real), bw, Math.max(0, base - y(m.real)))} fill="var(--sd-b)">
                      <title>{`${F.monthLabel(m.month)} 실제 결제 ${F.won(m.real)} (학원 ${m.payments}건)`}</title>
                    </path>
                    <text x={cx} y={Math.min(y(m.real), y(m.dashboard)) - 12} textAnchor="middle" fontSize={T.value} fontWeight={800} fill="var(--sd-fg)">
                      {F.wonMan(m.real)}
                    </text>
                    <text x={cx} y={base + 28} textAnchor="middle" fontSize={T.label} fill="var(--sd-fg2)" fontWeight={700}>
                      {F.monthLabel(m.month)}
                    </text>
                    <text x={cx} y={base + 54} textAnchor="middle" fontSize={T.axis} fill="var(--sd-fg3)">
                      {`대시보드 ${F.wonMan(m.dashboard)}`}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </SvgBox>
    </div>
  );
}

export function FreeDonut() {
  const { r } = useSd().model;
  const sm = r.sm;
  if (!sm) return null;
  const share = sm.aiCost.freeShare;
  const used = sm.aiCost.creditsUsed;
  const sold = sm.aiCost.creditsSold;
  const size = 250;
  const R = 104;
  const sw = 34;
  const c = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }} data-box>
      <svg className="sd-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`무료 사용 ${F.ratio(share)}`} style={{ flex: "none" }}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--sd-b)" strokeWidth={sw} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke="var(--sd-warn)"
          strokeWidth={sw}
          strokeDasharray={`${c * share} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x={size / 2} y={size / 2 + 10} textAnchor="middle" fontSize={50} fontWeight={800} fill="var(--sd-fg)">
          {F.ratio(share)}
        </text>
        <text x={size / 2} y={size / 2 + 42} textAnchor="middle" fontSize={T.label} fill="var(--sd-fg2)">
          무료로 쓰임
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <Legend items={[{ color: "var(--sd-warn)", label: `무료 사용 ${F.credits(Math.max(0, used - sold))}` }]} />
        <Legend items={[{ color: "var(--sd-b)", label: `판 크레딧 ${F.credits(sold)}` }]} />
        <div className="sd-lbl-s">{`쓰인 크레딧 ${F.credits(used)} · ${F.monthLabel(sm.aiCost.from)}~${F.monthLabel(sm.aiCost.to)}`}</div>
      </div>
    </div>
  );
}

/** 스모트 이익률 두 가지 — 유료 사용분 기준 · 무료 포함 실제 */
export function MarginPair({ opts }: { opts: Opts }) {
  const { r } = useSd().model;
  const m = r.smoat.margins;
  const cols = opts.stack === true ? 1 : 2;
  return (
    <div className="sd-kpis" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      <div className="sd-kpi sd-tone-b" data-box>
        <div className="sd-kpi-label">유료 사용분 기준 이익률</div>
        <div className="sd-kpi-value">{F.ratio(m.paid)}</div>
        <div className="sd-kpi-sub">{m.paidMonth ? `${F.monthLabel(m.paidMonth)} 매출(이름 없는 입금 포함) − ${F.monthLabel(m.paidMonth)} AI 원가` : F.EMPTY}</div>
      </div>
      <div className="sd-kpi sd-tone-warn" data-box>
        <div className="sd-kpi-label">무료 포함 실제 이익률</div>
        <div className="sd-kpi-value">{F.ratio(m.free)}</div>
        <div className="sd-kpi-sub">
          {m.freeFrom && m.freeTo
            ? `${F.monthLabel(m.freeFrom)}~${F.monthLabel(m.freeTo)} 결제(이름 없는 입금 포함) 공급가 ${F.wonMan(m.freeSupply)} − AI 원가 ${F.wonMan(m.freeAiCost)}`
            : F.EMPTY}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  천장 — 떳떳함 × 사람 없이 커짐, 원 크기 = 월 매출
// ============================================================

type MatrixItem = { key: string; label: string; x: number; y: number; unit: "a" | "b" | "gray"; note?: string; labelPos?: "below" };

export function Matrix2x2({ opts }: { opts: Opts }) {
  const { v } = useSd().model;
  const items = (opts.items as MatrixItem[] | undefined) ?? [];
  const xLabel = str(opts.xLabel, "사람 없이 커지나");
  const yLabel = str(opts.yLabel, "떳떳한가");
  // key 가 없는 칸(아직 매출이 없는 실험)은 0 — 점선 원으로 그린다
  const vals = items.map((it) => (it.key ? Math.max(0, (v[it.key] as number) ?? 0) : 0));
  const maxV = Math.max(1, ...vals);
  const h = 470;
  const color = (u: MatrixItem["unit"]) => (u === "b" ? "var(--sd-b)" : u === "gray" ? "var(--sd-muted-bar)" : "var(--sd-a)");
  return (
    <SvgBox h={h} minW={560} fallback={720} label={`${yLabel} × ${xLabel}, 원 크기는 월 매출`}>
      {(w) => {
        const l = 44;
        const t = 12;
        const pw = w - l - 8;
        const ph = h - t - 44;
        const X = (x: number) => l + pw * x;
        const Y = (y: number) => t + ph * (1 - y);
        return (
          <>
            <rect x={l} y={t} width={pw} height={ph} fill="none" stroke="var(--sd-line)" rx={10} />
            <line x1={l + pw / 2} x2={l + pw / 2} y1={t} y2={t + ph} stroke="var(--sd-line)" strokeDasharray="4 6" />
            <line x1={l} x2={l + pw} y1={t + ph / 2} y2={t + ph / 2} stroke="var(--sd-line)" strokeDasharray="4 6" />
            <text x={l + pw / 2} y={h - 10} textAnchor="middle" fontSize={T.label} fontWeight={700} fill="var(--sd-fg2)">
              {`${xLabel} →`}
            </text>
            <text x={16} y={t + ph / 2} textAnchor="middle" fontSize={T.label} fontWeight={700} fill="var(--sd-fg2)" transform={`rotate(-90 16 ${t + ph / 2})`}>
              {`${yLabel} →`}
            </text>
            {items.map((it, i) => {
              const rad = 16 + 62 * Math.sqrt(vals[i] / maxV);
              const cx = X(it.x);
              const cy = Y(it.y);
              const shownRad = vals[i] > 0 ? rad : 26;
              const below = it.labelPos === "below";
              const rightSide = it.x < 0.62;
              const tx = below ? cx : rightSide ? cx + shownRad + 10 : cx - shownRad - 10;
              const ty = below ? cy + shownRad + 26 : cy - 4;
              const anchor = below ? "middle" : rightSide ? "start" : "end";
              return (
                <g key={it.key}>
                  {vals[i] > 0 ? (
                    <circle cx={cx} cy={cy} r={rad} fill={color(it.unit)} fillOpacity={0.85} stroke="var(--sd-surface)" strokeWidth={2}>
                      <title>{`${it.label} 월 ${F.man(vals[i])}`}</title>
                    </circle>
                  ) : (
                    <circle cx={cx} cy={cy} r={26} fill="none" stroke={color(it.unit)} strokeWidth={3} strokeDasharray="6 5" />
                  )}
                  <text x={tx} y={ty} textAnchor={anchor} fontSize={T.label} fontWeight={800} fill="var(--sd-fg)">
                    {it.label}
                  </text>
                  <text x={tx} y={ty + 24} textAnchor={anchor} fontSize={T.axis} fill="var(--sd-fg2)">
                    {it.note ?? `월 ${F.man(vals[i], vals[i] < 100 ? 1 : 0)}`}
                  </text>
                </g>
              );
            })}
          </>
        );
      }}
    </SvgBox>
  );
}

// ============================================================
//  사업부 ① — B2B 월별 입금 (대목) + 기준 기간 평균선
// ============================================================

export function B2bMonthly() {
  const { r } = useSd().model;
  const fin = r.fin;
  if (!fin) return null;
  const months = fin.b2b.monthly;
  const avg12 = fin.b2b.total / 12;
  const avg6 = fin.b2b.recentAvg;
  // 지금 기준 기간(가정 「기준 기간」)의 평균선은 굵게, 다른 쪽은 가늘게
  const on12 = r.cash.basis === 12;
  const peak = new Set(["09", "10", "11", "12", "01"]);
  const max = Math.max(1, ...months.map((m) => m.amount), avg12);
  const h = 330;
  return (
    <div className="sd-chart">
      <Legend
        items={[
          { color: "var(--sd-a)", label: "9~1월 대목" },
          { color: "var(--sd-a-soft)", label: "그 외" },
          { color: "var(--sd-fg2)", label: `${on12 ? "**" : ""}12개월 평균 ${F.wonMan(avg12)}${on12 ? " (지금 기준)**" : ""}`, dashed: true },
          { color: "var(--sd-warn)", label: `${on12 ? "" : "**"}최근 6개월 평균 ${F.wonMan(avg6)}${on12 ? "" : " (지금 기준)**"}`, dashed: true },
        ]}
      />
      <SvgBox h={h} minW={640} fallback={1300} label="B2B 월별 입금">
        {(w) => {
          const base = h - 36;
          const top = 34;
          const pitch = w / months.length;
          const bw = Math.min(56, pitch * 0.6);
          const y = (v: number) => base - ((base - top) * v) / max;
          return (
            <>
              <line x1={0} x2={w} y1={base} y2={base} stroke="var(--sd-line)" />
              {months.map((m, i) => {
                const cx = pitch * i + pitch / 2;
                const on = peak.has(m.month.slice(5));
                return (
                  <g key={m.month}>
                    <path d={vbarPath(cx - bw / 2, y(m.amount), bw, base - y(m.amount))} fill={on ? "var(--sd-a)" : "var(--sd-a-soft)"} stroke={on ? undefined : "var(--sd-a)"} strokeOpacity={0.5}>
                      <title>{`${F.monthLabel(m.month, true)} ${F.won(m.amount)}`}</title>
                    </path>
                    <text x={cx} y={y(m.amount) - 10} textAnchor="middle" fontSize={T.axis} fontWeight={700} fill="var(--sd-fg2)">
                      {F.num(m.amount / 1e4)}
                    </text>
                    <text x={cx} y={base + 26} textAnchor="middle" fontSize={T.axis} fill="var(--sd-fg3)">
                      {m.month.endsWith("-01") || i === 0 ? F.monthLabel(m.month, true).replace("년 ", ".").replace("월", "") : F.monthLabel(m.month)}
                    </text>
                  </g>
                );
              })}
              <line x1={0} x2={w} y1={y(avg12)} y2={y(avg12)} stroke="var(--sd-fg2)" strokeWidth={on12 ? 3.5 : 1.5} strokeOpacity={on12 ? 1 : 0.6} strokeDasharray="8 6" />
              <line x1={0} x2={w} y1={y(avg6)} y2={y(avg6)} stroke="var(--sd-warn)" strokeWidth={on12 ? 1.5 : 3.5} strokeOpacity={on12 ? 0.6 : 1} strokeDasharray="8 6" />
            </>
          );
        }}
      </SvgBox>
      <div className="sd-lbl-s">만원 · 재무 장부 B2B매출 ({F.dateLabel(fin.asOf)} 기준)</div>
    </div>
  );
}

// ============================================================
//  생카 — 티어 피라미드 · DM 깔때기
// ============================================================

export function TierPyramid({ opts }: { opts: Opts }) {
  const levels = (opts.levels as { name: string; who: string; perk: string }[] | undefined) ?? [];
  const n = levels.length || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-box>
      {levels.map((lv, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 18, alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div
              style={{
                width: `${40 + (60 * i) / Math.max(1, n - 1)}%`,
                minHeight: 74,
                background: i === 0 ? "var(--sd-a)" : i === 1 ? "var(--sd-a-text)" : "var(--sd-a-soft)",
                border: "1px solid var(--sd-a)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: i < 2 ? "#fff" : "var(--sd-fg)",
                fontWeight: 800,
              }}
              className="sd-lbl"
            >
              <Md text={lv.name} />
            </div>
          </div>
          <div>
            <div className="sd-card-title">
              <Md text={lv.perk} />
            </div>
            <div className="sd-lbl">
              <Md text={lv.who} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DmFunnel() {
  const { r, v } = useSd().model;
  const f = r.sangka.funnel;
  const rows = [
    { label: `DM ${F.num(f.dm)}건`, sub: "월 발송", value: f.dm },
    { label: `응답 ${F.num(f.replies, 1)}건`, sub: `응답률 ${F.pct(v.replyRate as number)}`, value: f.replies },
    { label: `예약 ${F.num(f.bookings, 1)}건`, sub: `예약 전환 ${F.pct(v.bookRate as number)}`, value: f.bookings },
  ];
  const max = Math.max(1, f.dm);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }} data-box>
      {rows.map((row, i) => (
        <div key={i} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div
            style={{
              width: `${Math.max(34, (row.value / max) * 100)}%`,
              background: i === 2 ? "var(--sd-a)" : "var(--sd-a-soft)",
              border: "1px solid var(--sd-a)",
              borderRadius: 10,
              padding: "8px 12px",
              textAlign: "center",
              color: i === 2 ? "#fff" : "var(--sd-fg)",
            }}
          >
            <span className="sd-num" style={{ fontSize: "inherit" }}>
              {row.label}
            </span>
          </div>
          <span className="sd-lbl-s">{row.sub}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
//  B2B — 시세 범위 위 우리 시작가 · 프로젝트 직접비율 · 시나리오
// ============================================================

export function PriceRange() {
  const { content } = useSd();
  const items = content.products.filter((p) => p.range);
  const rest = content.products.filter((p) => !p.range);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Legend
        items={[
          { color: "var(--sd-muted-bar)", label: "경쟁 시세 범위" },
          { color: "var(--sd-a)", label: "우리 시작가" },
        ]}
      />
      {items.map((p) => {
        const g = p.range!;
        const max = Math.max(g.max, g.ours) * 1.18;
        const pos = (x: number) => `${(x / max) * 100}%`;
        const point = g.min === g.max;
        return (
          <div key={p.name} data-box>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <span className="sd-card-title">{p.name}</span>
              <span className="sd-lbl">
                <Md text={`${g.unit} · 시세 ${point ? F.num(g.min, 1) : `${F.num(g.min, 1)}~${F.num(g.max, 1)}`}${g.maxPlus ? "+" : ""} · **우리 ${F.num(g.ours, 1)}**`} />
              </span>
            </div>
            <div style={{ position: "relative", height: 30, marginTop: 6 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 14, height: 2, background: "var(--sd-line)" }} />
              <div
                style={{
                  position: "absolute",
                  left: pos(g.min),
                  width: point ? 6 : `calc(${pos(g.max - g.min)})`,
                  marginLeft: point ? -3 : 0,
                  top: 5,
                  height: 20,
                  borderRadius: 5,
                  background: "var(--sd-muted-bar)",
                }}
                title={`시세 ${g.min}~${g.max}`}
              />
              <div
                style={{
                  position: "absolute",
                  left: pos(g.ours),
                  top: 1,
                  width: 28,
                  height: 28,
                  marginLeft: -14,
                  borderRadius: 999,
                  background: "var(--sd-a)",
                  border: "3px solid var(--sd-surface)",
                }}
                title={`우리 ${g.ours}`}
              />
            </div>
            {g.note && (
              <div className="sd-lbl-s" style={{ marginTop: 2 }}>
                <Md text={g.note} />
              </div>
            )}
          </div>
        );
      })}
      {rest.length > 0 && (
        <div className="sd-lbl-s">
          {`공개 시세가 부족한 상품: ${rest.map((p) => `${p.name} ${F.man(p.startPrice)}부터`).join(" · ")}`}
        </div>
      )}
    </div>
  );
}

export function ProjectBars() {
  const { r, v } = useSd().model;
  const b = r.b2b;
  if (!b.projects.length) return null;
  const max = Math.max(0.4, ...b.projects.map((p) => p.rate)) * 1.1;
  const target = b.standardDirectTarget;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-box>
      <div className="sd-lbl">프로젝트 직접비율 (재료·외주·운송 ÷ 매출)</div>
      {b.projects.map((p) => (
        <div key={p.code} style={{ display: "grid", gridTemplateColumns: "minmax(0, 250px) 1fr 70px", gap: 12, alignItems: "center" }}>
          <span className="sd-lbl" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.name}
            {p.kind && <span className="sd-lbl-s">{` · ${p.kind}`}</span>}
          </span>
          <div style={{ position: "relative", height: 24 }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(p.rate / max) * 100}%`, background: "var(--sd-a)", borderRadius: "0 4px 4px 0" }} />
            {ok(b.projectsRate) && (
              <div style={{ position: "absolute", top: -4, bottom: -4, left: `${(b.projectsRate / max) * 100}%`, borderLeft: "2px dashed var(--sd-fg2)" }} />
            )}
            {ok(target) && <div style={{ position: "absolute", top: -4, bottom: -4, left: `${(target / 100 / max) * 100}%`, borderLeft: "2px dashed var(--sd-good)" }} />}
          </div>
          <span className="sd-lbl" style={{ textAlign: "right", fontWeight: 800, color: "var(--sd-fg)" }}>
            {F.ratio(p.rate)}
          </span>
        </div>
      ))}
      <div className="sd-lbl-s">
        {`회색 점선 = 가중평균 ${F.ratio(b.projectsRate, 1)}${ok(target) ? ` · 초록 점선 = 표준 목표 ${F.pct(target)}` : ""} · 현장 인건비 ${F.pct(v.b2bFieldLaborRate as number)} 가정 · 본사 인력 제외`}
      </div>
    </div>
  );
}

/** 공헌이익률 한 줄 — 「본사 인력 투입 제외」 를 항상 붙인다 */
export function contribLabel(v: Record<string, unknown>): string {
  const hq = typeof v.b2bHqLaborRate === "number" ? v.b2bHqLaborRate : 0;
  const rate = F.pct(v.b2bContribRate as number, 1);
  return hq > 0 ? `공헌이익률 ${rate} (본사 인력 투입 ${F.pct(hq)} 반영)` : `공헌이익률 ${rate} (본사 인력 투입 제외)`;
}

export function ContribBadge() {
  const { v } = useSd().model;
  return (
    <span className="sd-pill sd-tone-a" style={{ alignSelf: "flex-start" }} data-box>
      {contribLabel(v)}
    </span>
  );
}

export function ScenarioBars({ opts }: { opts: Opts }) {
  const { r, v } = useSd().model;
  const b = r.b2b;
  const names = (opts.names as string[] | undefined) ?? ["보수", "기본", "목표"];
  const max = Math.max(1, ...b.scenarios.map((s) => s.annualContrib), ...b.web.map((s) => s.annualContrib));
  const bar = (value: number, color: string, text: string) => (
    <div className="sd-scen-bar" style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12, alignItems: "center" }}>
      <div style={{ position: "relative", height: 30 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(Math.max(0, value) / max) * 100}%`, background: color, borderRadius: "0 5px 5px 0" }} />
      </div>
      <span className="sd-num" style={{ fontSize: "inherit" }}>
        {text}
      </span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-box>
      <Legend
        items={[
          { color: "var(--sd-a)", label: `건당 평균 ${F.man(b.current.avg)}` },
          { color: "var(--sd-a-soft)", label: `웹 견적발 소형 건당 ${F.man(v.webDealSize as number)}` },
        ]}
      />
      {b.scenarios.map((s, i) => (
        <div key={i} className="sd-scen" style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 14, alignItems: "center" }}>
          <div>
            <div className="sd-card-title">{names[i] ?? ""}</div>
            <div className="sd-lbl">{`월 +${F.num(s.add, 1)}건`}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bar(s.annualContrib, "var(--sd-a)", `연 ${F.eok(s.annualContrib)}`)}
            {bar(b.web[i]?.annualContrib ?? 0, "var(--sd-a-soft)", `연 ${F.eok(b.web[i]?.annualContrib ?? null)}`)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
//  부족분 레버 폭포 (D-1)
// ============================================================

export function LeverWaterfall() {
  const { r, v } = useSd().model;
  const L = r.levers;
  const sub: Record<string, string> = {
    b2b: `월 +${F.num(L.b2b.deals, 1)}건`,
    std: `직접비율 → ${F.pct(v.standardDirectRateTarget as number)}`,
    ext: `+${F.num(r.sangka.ext.add, 1)}건 − T1`,
    smoat: `구독 ${F.num(L.smoatSubscribers, 0)}곳 − 고정비`,
    cut: "가정 입력",
  };
  const bars: Fall[] = [
    { label: "매달 부족분", sub: "지출 − 매출", from: 0, to: L.gap, color: "var(--sd-bad)", text: F.man(L.gap) },
    ...L.steps.map((s) => ({
      label: s.label,
      sub: sub[s.key],
      from: s.from,
      to: s.to,
      color: s.value === null ? "var(--sd-muted-bar)" : s.value >= 0 ? "var(--sd-good)" : "var(--sd-bad)",
      text: s.value === null ? "입력 필요" : Math.round(s.value) === 0 ? "0만원" : s.value > 0 ? `-${F.man(s.value)}` : `+${F.man(-s.value)}`,
    })),
    {
      label: L.remaining > 0 ? "아직 못 메운 금액" : "남는 돈",
      from: 0,
      to: L.remaining,
      color: L.remaining > 0 ? "var(--sd-bad)" : "var(--sd-good)",
      text: F.man(L.remaining),
    },
  ];
  return <Waterfall bars={bars} h={420} minW={1300} fallback={1390} label="매달 모자라는 돈을 레버로 메우기" />;
}

// ============================================================
//  학원 인수 반대 — 사람에 비례하는 매출 vs 플랫폼 매출
// ============================================================

export function ScaleCurves({ opts }: { opts: Opts }) {
  const { r } = useSd().model;
  const a = str(opts.a, "사람을 늘려야 매출이 는다");
  const b = str(opts.b, "사람과 무관하게 매출이 는다");
  const aNote = str(opts.aNote);
  const m = r.smoat.margins;
  const bNote = `이익률 무료 포함 ${F.ratio(m.free)} → 유료 기준 ${F.ratio(m.paid)}`;
  const bNote2 = `학원 하나마다 월 +${F.wonMan(r.smoat.avgContrib)}`;
  const h = 380;
  return (
    <div className="sd-chart">
      <Legend
        items={[
          { color: "var(--sd-a)", label: a },
          { color: "var(--sd-b)", label: b },
        ]}
      />
      <SvgBox h={h} minW={520} fallback={760} label="사람에 비례하는 매출과 플랫폼 매출">
        {(w) => {
          const l = 34;
          const t = 30;
          const pw = w - l - 20;
          const ph = h - t - 44;
          const X = (x: number) => l + pw * x;
          const Y = (y: number) => t + ph * (1 - y);
          // ① 계단: 사람을 한 명 늘릴 때마다 한 칸, 네 칸에서 천장
          const steps = [0.08, 0.2, 0.32, 0.44, 0.5];
          let dA = `M${X(0)},${Y(0.04)}`;
          steps.forEach((yy, i) => {
            const x0 = i * 0.2;
            dA += ` H${X(x0)} V${Y(yy)}`;
          });
          dA += ` H${X(1)}`;
          // ② 곡선: 처음엔 느리고 가입 학원이 쌓이면 가팔라진다
          const pts = Array.from({ length: 41 }, (_, i) => {
            const x = i / 40;
            return `${i ? "L" : "M"}${X(x)},${Y(0.02 + 0.93 * x ** 2.2)}`;
          }).join(" ");
          return (
            <>
              <line x1={l} x2={l + pw} y1={t + ph} y2={t + ph} stroke="var(--sd-line)" />
              <line x1={l} x2={l} y1={t} y2={t + ph} stroke="var(--sd-line)" />
              <text x={l + pw} y={h - 10} textAnchor="end" fontSize={T.label} fill="var(--sd-fg2)" fontWeight={700}>
                시간 →
              </text>
              <text x={14} y={t + ph / 2} textAnchor="middle" fontSize={T.label} fill="var(--sd-fg2)" fontWeight={700} transform={`rotate(-90 14 ${t + ph / 2})`}>
                월 매출 →
              </text>
              <line x1={l} x2={l + pw} y1={Y(0.52)} y2={Y(0.52)} stroke="var(--sd-a)" strokeDasharray="6 6" strokeOpacity={0.7} />
              <text x={X(0.02)} y={Y(0.52) - 10} fontSize={T.axis} fill="var(--sd-a-text)" fontWeight={700}>
                천장
              </text>
              <path d={dA} fill="none" stroke="var(--sd-a)" strokeWidth={4} strokeLinejoin="round" />
              {steps.slice(1).map((_, i) => (
                <text key={i} x={X((i + 1) * 0.2) + 6} y={Y(steps[i + 1]) + 24} fontSize={T.axis} fill="var(--sd-a-text)">
                  +1명
                </text>
              ))}
              <path d={pts} fill="none" stroke="var(--sd-b)" strokeWidth={4} />
              <text x={X(0.98)} y={Y(0.95) - 12} textAnchor="end" fontSize={T.axis} fill="var(--sd-b-text)" fontWeight={700}>
                {bNote}
              </text>
              <text x={X(0.98)} y={Y(0.3) + 36} textAnchor="end" fontSize={T.axis} fill="var(--sd-b-text)" fontWeight={700}>
                {bNote2}
              </text>
              {aNote && (
                <text x={X(0.02)} y={Y(0.52) + 28} fontSize={T.axis} fill="var(--sd-a-text)" fontWeight={700}>
                  {aNote}
                </text>
              )}
            </>
          );
        }}
      </SvgBox>
    </div>
  );
}

// ============================================================
//  세 가지 안 — 첫 결과까지 개월 · 초기 자금
// ============================================================

export function OptionBars({ opts }: { opts: Opts }) {
  const { v } = useSd().model;
  const names = (opts.names as string[] | undefined) ?? ["① 통합 직영", "② 소형 인수", "③ 파트너"];
  const pick = (k: string) => numOr(v[k]);
  const months = [
    [pick("optDirectMonthsLow"), pick("optDirectMonthsHigh")],
    [pick("optAcquireMonthsLow"), pick("optAcquireMonthsHigh")],
    [pick("optPartnerMonths"), pick("optPartnerMonths")],
  ];
  const capital = [
    [pick("optDirectCapital"), pick("optDirectCapital")],
    [pick("optAcquireCapitalLow"), pick("optAcquireCapitalHigh")],
    [pick("optPartnerCapital"), pick("optPartnerCapital")],
  ];
  const panel = (title: string, rows: (number | null)[][], fmt: (lo: number, hi: number) => string) => {
    const max = Math.max(1, ...rows.flat().filter(ok)) * 1.05;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }} data-box>
        <div className="sd-card-title">{title}</div>
        {rows.map(([lo, hi], i) => {
          const color = i === 2 ? "var(--sd-b)" : "var(--sd-muted-bar)";
          const has = ok(lo) && ok(hi);
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span className="sd-lbl" style={{ fontWeight: i === 2 ? 800 : 600, color: i === 2 ? "var(--sd-b-text)" : undefined }}>
                  <Md text={names[i] ?? ""} />
                </span>
                <span className="sd-lbl" style={{ fontWeight: 800, color: has ? "var(--sd-fg)" : "var(--sd-fg3)" }}>
                  {has ? fmt(lo, hi) : "입력 필요"}
                </span>
              </div>
              <div style={{ position: "relative", height: 26, background: "var(--sd-panel)", borderRadius: 6 }}>
                {has && (
                  <>
                    {lo! > 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(lo! / max) * 100}%`, background: color, borderRadius: 5 }} />}
                    {hi! > lo! && (
                      <div
                        style={{
                          position: "absolute",
                          left: `${(lo! / max) * 100}%`,
                          top: 0,
                          bottom: 0,
                          width: `${((hi! - lo!) / max) * 100}%`,
                          background: color,
                          opacity: 0.5,
                          borderRadius: "0 5px 5px 0",
                        }}
                      />
                    )}
                    {hi === 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: color, borderRadius: 3 }} />}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div className="sd-cols" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 36 }}>
      {panel("첫 결과까지", months, (lo, hi) => (lo === hi ? F.months(lo) : `${F.num(lo)}~${F.months(hi)}`))}
      {panel("초기 자금", capital, (lo, hi) => (hi === 0 ? "거의 0원" : lo === hi ? F.eok(lo) : `${F.eok(lo)}~${F.eok(hi)}`))}
    </div>
  );
}

// ============================================================
//  요금제 — 월 크레딧 구간 · 1문항당 가격 · 시장 가격 사다리
// ============================================================

export function BandBars() {
  const { r } = useSd().model;
  const bands = r.smoat.bands;
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <div className="sd-bars" data-box>
      <div className="sd-lbl">월 크레딧 구간별 결제 학원 수</div>
      {bands.map((b) => (
        <div key={b.label} className="sd-bar-row" style={{ gridTemplateColumns: "minmax(0, 170px) 1fr minmax(0, 250px)" }}>
          <div className="sd-bar-label">{b.label}</div>
          <div className="sd-bar-track">
            <div className="sd-bar-fill" style={{ width: `${(b.count / max) * 100}%`, background: "var(--sd-b)" }} />
          </div>
          <div className="sd-bar-val">
            {`${b.count}곳`}
            <span className="sd-lbl-s" style={{ fontWeight: 500, marginLeft: 8 }}>
              {b.count ? `월 ${F.wonMan(b.spendAvg)}` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PerQuestionCompare({ opts }: { opts: Opts }) {
  const { r, v } = useSd().model;
  const q = v.creditsPerQuestion as number;
  const market = (opts.market as { name: string; min: number; max: number }[] | undefined) ?? [];
  const rows = [
    { name: "스모트 지금 (묶음)", min: r.smoat.packPerQMin, max: r.smoat.packPerQMax, color: "var(--sd-b)" },
    {
      name: "스모트 구독안",
      min: ok(r.smoat.tierPerMin) ? r.smoat.tierPerMin * q : null,
      max: ok(r.smoat.tierPerMax) ? r.smoat.tierPerMax * q : null,
      color: "var(--sd-b-text)",
    },
    ...market.map((m) => ({ name: m.name, min: m.min, max: m.max, color: "var(--sd-muted-bar)" })),
  ];
  const max = Math.max(1, ...rows.map((x) => x.max ?? 0)) * 1.08;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-box>
      <div className="sd-lbl">{`1문항당 가격 (문항당 ${F.num(q)}C · 1C당 ${F.num(r.smoat.packPerMin)}~${F.num(r.smoat.packPerMax)}원)`}</div>
      {rows.map((x) => (
        <div key={x.name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 230px) 1fr minmax(0, 150px)", gap: 12, alignItems: "center" }}>
          <span className="sd-lbl">
            <Md text={x.name} />
          </span>
          <div style={{ position: "relative", height: 26 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 2, background: "var(--sd-line2)" }} />
            {ok(x.min) && ok(x.max) && (
              <div
                style={{
                  position: "absolute",
                  left: `${(x.min / max) * 100}%`,
                  width: `max(8px, ${((x.max - x.min) / max) * 100}%)`,
                  top: 2,
                  height: 22,
                  borderRadius: 6,
                  background: x.color,
                }}
              />
            )}
          </div>
          <span className="sd-lbl" style={{ textAlign: "right", fontWeight: 800, color: "var(--sd-fg)" }}>
            {ok(x.min) && ok(x.max) ? `${F.num(x.min)}~${F.num(x.max)}원` : F.EMPTY}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PriceLadder({ opts }: { opts: Opts }) {
  const { r } = useSd().model;
  const items = (opts.items as { name: string; min: number; max: number; note?: string }[] | undefined) ?? [];
  const tiers = r.smoat.tiers;
  const ours = { name: str(opts.ours, "스모트 구독안"), min: Math.min(...tiers.map((t) => t.price)), max: Math.max(...tiers.map((t) => t.price)) };
  const rows = [...items.map((x) => ({ ...x, ours: false })), { ...ours, ours: true, note: tiers.map((t) => `${t.name} ${F.wonMan(t.price)}`).join(" · ") }];
  const maxV = Math.max(...rows.map((x) => x.max)) * 1.05;
  const ticks = niceTicks(maxV, 5);
  const rowH = 58;
  const h = rows.length * rowH + 50;
  return (
    <SvgBox h={h} minW={640} fallback={1390} label="월 가격 사다리">
      {(w) => {
        const l = 250;
        const rr = 20;
        const X = (x: number) => l + ((w - l - rr) * x) / ticks[ticks.length - 1];
        return (
          <>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={X(t)} x2={X(t)} y1={6} y2={h - 34} stroke="var(--sd-line2)" />
                <text x={X(t)} y={h - 10} textAnchor={t === ticks[ticks.length - 1] ? "end" : "middle"} fontSize={T.axis} fill="var(--sd-fg3)">
                  {t === 0 ? "0" : `${F.num(t / 1e4)}만원`}
                </text>
              </g>
            ))}
            {rows.map((x, i) => {
              const y = i * rowH + 10;
              const color = x.ours ? "var(--sd-b)" : "var(--sd-muted-bar)";
              const x1 = X(x.min);
              const x2 = X(x.max);
              const labelRight = x2 + 10 < w - 260;
              return (
                <g key={x.name}>
                  <text x={0} y={y + 22} fontSize={T.label} fontWeight={x.ours ? 800 : 600} fill={x.ours ? "var(--sd-b-text)" : "var(--sd-fg)"}>
                    {x.name}
                  </text>
                  <rect x={x1} y={y + 4} width={Math.max(8, x2 - x1)} height={24} rx={6} fill={color} />
                  {x.ours &&
                    tiers.map((t) => <circle key={t.name} cx={X(t.price)} cy={y + 16} r={7} fill="var(--sd-surface)" stroke="var(--sd-b)" strokeWidth={3} />)}
                  <text
                    x={labelRight ? x2 + 10 : x1 - 10}
                    y={y + 23}
                    fontSize={T.axis}
                    textAnchor={labelRight ? "start" : "end"}
                    fill="var(--sd-fg2)"
                  >
                    {x.ours && w >= 1000 ? x.note : `${F.wonMan(x.min)}~${F.wonMan(x.max)}${x.note && !x.ours ? ` · ${x.note}` : ""}`}
                  </text>
                </g>
              );
            })}
          </>
        );
      }}
    </SvgBox>
  );
}

// ============================================================
//  고객에게 남나 — 학원별 덤벨 (지금 월 지출 → 구독 가격)
// ============================================================

export function AcademyDumbbell() {
  const sd = useSd();
  const { r, v } = sd.model;
  const label = academyLabeler(sd);
  const list = r.smoat.academies;
  const limit = numOr(v.skipIfCostUpOver);
  const rowH = 25;
  const h = list.length * rowH + 44;
  const maxV = Math.max(1, ...list.map((a) => Math.max(a.monthlySpend, a.compare.price)));
  const ticks = niceTicks(maxV, 5);
  return (
    <div className="sd-chart">
      <Legend
        items={[
          { color: "var(--sd-muted-bar)", label: "지금 월 지출" },
          { color: "var(--sd-b)", label: "추천 요금제 가격" },
          { color: "var(--sd-good)", label: "덜 냄" },
          { color: "var(--sd-bad)", label: "더 냄" },
        ]}
      />
      <SvgBox h={h} minW={600} fallback={860} label="학원별 지금 월 지출과 구독 가격">
        {(w) => {
          const l = 96;
          const rr = 130;
          const X = (x: number) => l + ((w - l - rr) * x) / ticks[ticks.length - 1];
          return (
            <>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={X(t)} x2={X(t)} y1={0} y2={h - 30} stroke="var(--sd-line2)" />
                  <text x={X(t)} y={h - 8} textAnchor="middle" fontSize={T.axis} fill="var(--sd-fg3)">
                    {t === 0 ? "0" : `${F.num(t / 1e4)}만`}
                  </text>
                </g>
              ))}
              {list.map((a, i) => {
                const y = i * rowH + 12;
                const up = a.compare.saving < 0;
                const rate = a.compare.savingRate;
                const skipped = limit !== null && rate !== null && -rate > limit / 100;
                const color = up ? "var(--sd-bad)" : "var(--sd-good)";
                return (
                  <g key={a.id} opacity={skipped ? 0.55 : 1}>
                    <text x={0} y={y + 6} fontSize={T.axis} fill="var(--sd-fg2)">
                      {label(a.name, i)}
                    </text>
                    <line x1={X(a.monthlySpend)} x2={X(a.compare.price)} y1={y} y2={y} stroke={color} strokeWidth={4} />
                    <circle cx={X(a.monthlySpend)} cy={y} r={7} fill="var(--sd-muted-bar)" />
                    <circle cx={X(a.compare.price)} cy={y} r={7} fill="var(--sd-b)" stroke="var(--sd-surface)" strokeWidth={2} />
                    <text x={w - rr + 12} y={y + 6} fontSize={T.axis} fontWeight={700} fill={color}>
                      {rate === null ? F.EMPTY : `${rate >= 0 ? "-" : "+"}${F.ratio(Math.abs(rate))}${skipped ? " 구독 안 함" : ""}`}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </SvgBox>
    </div>
  );
}

// ============================================================
//  우리에게 남나 — 요금제 가격 분해 · 구독 매출 비교 · 12개월 · 손익분기
// ============================================================

export function TierStack({ opts }: { opts?: Opts }) {
  const { r, v } = useSd().model;
  const tiers = r.smoat.tiers;
  const withRefund = opts?.refund === true;
  const refundOf = (i: number) => (withRefund ? (r.smoat.refund[i]?.cost ?? 0) : 0);
  const segs = (t: (typeof tiers)[number], i = 0) => [
    { key: "vat", label: "부가세", value: t.price - t.supply, color: "var(--sd-line)" },
    { key: "fee", label: "결제 수수료", value: t.fee, color: "var(--sd-muted-bar)" },
    { key: "ai", label: `AI 원가 (사용률 ${F.pct(v.usageRate as number)})`, value: t.aiSet, color: "var(--sd-s4)" },
    ...(withRefund ? [{ key: "refund", label: "품질 환불", value: refundOf(i), color: "var(--sd-bad)" }] : []),
    { key: "profit", label: "이익", value: t.profitSet - refundOf(i), color: "var(--sd-b)" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-box>
      <Legend items={segs(tiers[0]).map((s) => ({ color: s.color, label: s.label }))} />
      {tiers.map((t, ti) => (
        <div key={t.name} className="sd-tier-row" style={{ display: "grid", gridTemplateColumns: "minmax(0, 200px) 1fr minmax(0, 110px)", gap: 12, alignItems: "center" }}>
          <div>
            <div className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
              {t.name}
            </div>
            <div className="sd-lbl-s">{`${F.won(t.price)} · ${F.credits(t.credits)}`}</div>
          </div>
          <div style={{ display: "flex", height: 38, gap: 2 }}>
            {segs(t, ti).map((s) => {
              const share = t.price > 0 ? Math.max(0, s.value) / t.price : 0;
              return (
                <div
                  key={s.key}
                  title={`${s.label} ${F.won(s.value)}`}
                  style={{
                    width: `${share * 100}%`,
                    background: s.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: s.key === "profit" ? "#fff" : "var(--sd-fg)",
                    overflow: "hidden",
                    borderRadius: s.key === "vat" ? "4px 0 0 4px" : s.key === "profit" ? "0 4px 4px 0" : 0,
                  }}
                >
                  {share > 0.12 && <span className="sd-lbl-s" style={{ color: "inherit", fontWeight: 700 }}>{F.ratio(share)}</span>}
                </div>
              );
            })}
          </div>
          <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-b-text)", textAlign: "right" }}>
            {`이익 ${F.ratio(withRefund ? r.smoat.refund[ti]?.marginSetAfter ?? null : t.marginSet)}`}
          </span>
        </div>
      ))}
      <div className="sd-lbl-s">{`이익률 = 이익 ÷ 공급가 · 다 써도 ${F.ratio(r.smoat.marginFullMin)}~${F.ratio(r.smoat.marginFullMax)}`}</div>
    </div>
  );
}

export function SubscriptionCompare() {
  const { r, v } = useSd().model;
  const s = r.smoat.sub;
  const sim = r.smoat.sim;
  const change = (x: number) => (s.spendNow > 0 ? ` (${x >= s.spendNow ? "+" : "-"}${F.ratio(Math.abs(x / s.spendNow - 1))})` : "");
  const rows = [
    { label: "지금 결제 학원 월 지출 합", value: s.spendNow, color: "var(--sd-muted-bar)", text: F.wonMan(s.spendNow), strong: true },
    { label: "같은 학원이 모두 구독", value: s.allBase, color: "color-mix(in srgb, var(--sd-b) 50%, transparent)", text: `${F.wonMan(s.allBase)}${change(s.allBase)}` },
    {
      label: `${s.skipped ? `비용 느는 ${s.skipped}곳 빼고 ` : ""}× 전환 ${F.pct(v.subscribeRate as number)}`,
      value: s.existing,
      color: "color-mix(in srgb, var(--sd-b) 50%, transparent)",
      text: `${F.wonMan(s.existing)}${change(s.existing)}`,
    },
    { label: `+ 무료 → 유료 ${F.num(v.extraConversions as number)}곳`, value: s.monthly, color: "var(--sd-b)", text: `${F.wonMan(s.monthly)}${change(s.monthly)}`, strong: true },
    {
      label: `${sim.avgFrom ? `${F.monthLabel(sim.avgFrom)}~${F.monthLabel(r.sm?.baseMonth ?? "")}` : ""} 실제 월평균 (참고)`,
      value: sim.avgMonthly ?? 0,
      color: "transparent",
      text: F.wonMan(sim.avgMonthly),
      dashed: true,
    },
  ];
  const max = Math.max(1, ...rows.map((x) => x.value)) * 1.02;
  const refLeft = `${(s.spendNow / max) * 100}%`;
  return (
    <div className="sd-bars" data-box style={{ gap: 14 }}>
      {rows.map((x, i) => (
        <div key={i} className="sd-bar-row" style={{ gridTemplateColumns: "minmax(0, 300px) 1fr minmax(0, 190px)" }}>
          <div className="sd-bar-label" style={x.strong ? { color: "var(--sd-fg)", fontWeight: 800 } : undefined}>
            {x.label}
          </div>
          <div className="sd-bar-track">
            <div
              className="sd-bar-fill"
              style={{
                width: `${(Math.max(0, x.value) / max) * 100}%`,
                background: x.color,
                border: x.dashed ? "2px dashed var(--sd-fg3)" : undefined,
              }}
            />
            <div style={{ position: "absolute", left: refLeft, top: -8, bottom: -8, borderLeft: "2px dashed var(--sd-fg2)" }} />
          </div>
          <div className="sd-bar-val" style={x.strong ? undefined : { color: "var(--sd-fg2)" }}>
            {x.text}
          </div>
        </div>
      ))}
      <div className="sd-lbl-s">{`점선 = 지금 결제 학원들의 월 지출 합 (${r.sm ? `학원 ${r.sm.totals.academies}곳` : ""})`}</div>
    </div>
  );
}

export function ChurnLine() {
  const { r, v } = useSd().model;
  const sim = r.smoat.sim;
  const series = sim.cumulative;
  const ref = r.smoat.sub.spendNow;
  const max = Math.max(1, ...series, ref) * 1.12;
  const h = 290;
  return (
    <div className="sd-chart">
      <div className="sd-lbl">{`구독 매출 12개월 (월 해지율 ${F.pct(v.monthlyChurn as number, 1)})`}</div>
      <SvgBox h={h} minW={480} fallback={620} label="해지율을 반영한 12개월 반복 매출">
        {(w) => {
          const l = 10;
          const rr = 10;
          const t = 36;
          const b = h - 34;
          const X = (i: number) => l + ((w - l - rr) * i) / Math.max(1, series.length - 1);
          const Y = (val: number) => b - ((b - t) * val) / max;
          const d = series.map((val, i) => `${i ? "L" : "M"}${X(i)},${Y(val)}`).join(" ");
          const area = `${d} L${X(series.length - 1)},${b} L${X(0)},${b} Z`;
          return (
            <>
              <line x1={l} x2={w - rr} y1={b} y2={b} stroke="var(--sd-line)" />
              <line x1={l} x2={w - rr} y1={Y(ref)} y2={Y(ref)} stroke="var(--sd-fg2)" strokeDasharray="8 6" strokeWidth={2} />
              <text x={w - rr} y={Y(ref) - 10} textAnchor="end" fontSize={T.axis} fill="var(--sd-fg2)">
                {`지금 월 지출 합 ${F.wonMan(ref)}`}
              </text>
              <path d={area} fill="var(--sd-b-soft)" />
              <path d={d} fill="none" stroke="var(--sd-b)" strokeWidth={3} />
              {series.length > 0 && (
                <>
                  <circle cx={X(0)} cy={Y(series[0])} r={6} fill="var(--sd-b)" />
                  {/* 기준선(지금 월 지출 합)과 붙으면 점 아래로 내린다 */}
                  <text x={X(0) + 4} y={Math.abs(Y(series[0]) - Y(ref)) < 34 ? Y(series[0]) + 30 : Y(series[0]) - 12} fontSize={T.value} fontWeight={800} fill="var(--sd-fg)">
                    {F.wonMan(series[0])}
                  </text>
                  <circle cx={X(series.length - 1)} cy={Y(series[series.length - 1])} r={6} fill="var(--sd-b)" />
                  <text x={X(series.length - 1)} y={Y(series[series.length - 1]) + 30} textAnchor="end" fontSize={T.value} fontWeight={800} fill="var(--sd-fg)">
                    {`12개월째 ${F.wonMan(series[series.length - 1])}`}
                  </text>
                </>
              )}
              <text x={l} y={h - 8} fontSize={T.axis} fill="var(--sd-fg3)">
                1개월
              </text>
              <text x={w - rr} y={h - 8} textAnchor="end" fontSize={T.axis} fill="var(--sd-fg3)">
                12개월
              </text>
            </>
          );
        }}
      </SvgBox>
      <div className="sd-lbl-s">{`12개월 누적 ${F.wonMan(sim.cumulativeTotal)} (지금 월 지출 합 × 12 = ${F.wonMan(r.smoat.sub.spendNow12)})`}</div>
    </div>
  );
}

export function BreakevenProgress() {
  const { r, v } = useSd().model;
  const b = r.smoat.breakeven;
  const p = b.progress ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-box>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="sd-card-title">
          {`손익분기 구독 학원 ${b.academies === null ? F.EMPTY : `${F.num(b.academies)}곳`}`}
        </span>
        <span className="sd-lbl">{`고정비 ${F.man(b.fixed)} + 공통비 ${F.man(b.commonMonthly)} × ${F.pct(v.commonCostShareSmoat as number)} ÷ 학원당 ${F.wonMan(r.smoat.avgContrib)}`}</span>
      </div>
      <div className="sd-progress" role="img" aria-label={`지금 ${b.now}곳, 손익분기의 ${F.ratio(p)}`}>
        <div style={{ width: `${Math.max(1.5, p * 100)}%`, background: "var(--sd-b)" }} />
      </div>
      <div className="sd-lbl">
        <Md
          text={`지금 결제 학원 ${F.num(b.now)}곳 (${F.ratio(p)}) · 가입 **${b.signups === null ? F.EMPTY : `${F.num(b.signups)}곳`}** 필요 = ${F.num(b.academies)}곳 ÷ 전환율 ${F.pct(v.freeToPaidRate as number, 1)}${b.signupsNow !== null ? ` (지금 가입 ${F.num(b.signupsNow)}곳)` : ""}`}
        />
      </div>
    </div>
  );
}

// ============================================================
//  운영 — 공통비 배분 · 대목 달력 · 금액별 결정 · 로드맵 · 점수판
// ============================================================

export function CommonCostBar() {
  const { r } = useSd().model;
  const o = r.ops;
  const shareB = (o.smoatSharePct ?? 0) / 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-box>
      <div className="sd-lbl">{`공통비 월 ${F.man(o.commonMonthly)} (ERP 공용 사업부, ${r.cash.basisLabel} 평균)`}</div>
      <div className="sd-stack" style={{ height: 60 }}>
        <div style={{ width: `${(1 - shareB) * 100}%`, background: "var(--sd-a)" }} />
        <div style={{ width: `${Math.max(0.8, shareB * 100)}%`, background: "var(--sd-b)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span className="sd-card-title sd-a-text">{`① ${F.man(o.unit1Common)} (${F.pct(100 - (o.smoatSharePct ?? 0))})`}</span>
        <span className="sd-card-title sd-b-text">{`② ${F.man(o.smoatCommon)} (${F.pct(o.smoatSharePct)})`}</span>
      </div>
    </div>
  );
}

export function SeasonHeatmap({ opts }: { opts: Opts }) {
  const { r } = useSd().model;
  const start = str(opts.start, "2026-10");
  const b = (opts.b as Record<string, { level: number; label?: string }> | undefined) ?? {};
  const rowA = str(opts.aLabel, "① B2B 입금");
  const rowB = str(opts.bLabel, "② 스모트 시험");
  // 일정 표시 (월 번호 → 한 줄) — 키트화 완료 · 매장 결정 등
  const marks = (opts.marks as Record<string, string> | undefined) ?? {};
  const hasMarks = Object.keys(marks).length > 0;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
  // ① 은 ERP 12개월 B2B 입금을 같은 달(월 번호)로 옮겨 쓴다
  const byMonthNo = new Map((r.fin?.b2b.monthly ?? []).map((m) => [m.month.slice(5), m.amount]));
  const aMax = Math.max(1, ...byMonthNo.values());
  const cells = months.map((m) => {
    const mo = m.slice(5);
    const a = (byMonthNo.get(mo) ?? 0) / aMax;
    const bb = b[String(Number(mo))];
    const bl = bb ? bb.level / 3 : 0;
    return { m, a, amount: byMonthNo.get(mo) ?? 0, b: bl, bLabel: bb?.label ?? "", both: a >= 0.45 && bl >= 0.66 };
  });
  return (
    <div className="sd-scroll-x">
    <div className="sd-heat" data-box style={{ display: "grid", gridTemplateColumns: `170px repeat(12, minmax(0, 1fr))`, gap: 4, alignItems: "stretch" }}>
      <span />
      {cells.map((c) => (
        <span key={c.m} className="sd-lbl" style={{ textAlign: "center", fontWeight: 700, color: c.both ? "var(--sd-bad)" : undefined }}>
          {F.monthLabel(c.m)}
        </span>
      ))}
      <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-a-text)", alignSelf: "center" }}>
        <Md text={rowA} />
      </span>
      {cells.map((c) => (
        <div
          key={`a${c.m}`}
          title={`${F.monthLabel(c.m)} B2B ${F.won(c.amount)}`}
          style={{
            height: 64,
            borderRadius: 8,
            background: `color-mix(in srgb, var(--sd-a) ${Math.round(12 + 88 * c.a)}%, transparent)`,
            outline: c.both ? "3px solid var(--sd-bad)" : undefined,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="sd-lbl-s" style={{ color: c.a > 0.5 ? "#fff" : "var(--sd-fg2)", fontWeight: 700 }}>
            {F.num(c.amount / 1e4)}
          </span>
        </div>
      ))}
      <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-b-text)", alignSelf: "center" }}>
        <Md text={rowB} />
      </span>
      {cells.map((c) => (
        <div
          key={`b${c.m}`}
          style={{
            height: 64,
            borderRadius: 8,
            background: `color-mix(in srgb, var(--sd-b) ${Math.round(12 + 88 * c.b)}%, transparent)`,
            outline: c.both ? "3px solid var(--sd-bad)" : undefined,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <span className="sd-lbl-s" style={{ color: c.b > 0.5 ? "#fff" : "var(--sd-fg2)", fontWeight: 700 }}>
            {c.bLabel}
          </span>
        </div>
      ))}
      <span />
      {cells.map((c) => (
        <span key={`o${c.m}`} className="sd-lbl-s" style={{ textAlign: "center", color: "var(--sd-bad)", fontWeight: 800 }}>
          {c.both ? "겹침" : ""}
        </span>
      ))}
      {hasMarks && (
        <>
          <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-warn)", alignSelf: "center" }}>
            <Md text={str(opts.marksLabel, "일정")} />
          </span>
          {cells.map((c) => {
            const t = marks[String(Number(c.m.slice(5)))];
            return (
              <div
                key={`k${c.m}`}
                style={{
                  minHeight: 52,
                  borderRadius: 8,
                  border: t ? "2px solid var(--sd-warn)" : "1px dashed var(--sd-line2)",
                  background: t ? "var(--sd-warn-soft)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 2,
                }}
              >
                {t && (
                  <span className="sd-lbl-s" style={{ color: "var(--sd-warn)", fontWeight: 800, lineHeight: 1.2 }}>
                    {t}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
    </div>
  );
}

export function DecisionFlow({ opts }: { opts?: Opts }) {
  const { r } = useSd().model;
  const lo = r.ops.approveLow;
  const hi = r.ops.approveHigh;
  const branches = [
    { range: `${F.man(lo)} 이하`, who: "담당자", how: "쓰고 기록만", tone: "good" },
    { range: `${F.man(lo)}~${F.man(hi)}`, who: "사업부 책임자 + 재무", how: "메신저로 당일", tone: "warn" },
    { range: `${F.man(hi)} 초과`, who: "임원 합의", how: "24시간 안에", tone: "bad" },
  ];
  if (opts?.compact === true) {
    // 좁은 칸용 — 뿌리 없이 세 갈래만 한 줄씩
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-box>
        <div className="sd-lbl">쓰려는 돈이 얼마인가</div>
        {branches.map((b) => (
          <div key={b.range} className={`sd-icard sd-tone-${b.tone}`} style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: "10px 16px" }}>
            <span className="sd-icard-title" style={{ minWidth: 0, flex: "none" }}>
              {b.range}
            </span>
            <span className="sd-lbl" style={{ color: "var(--sd-fg)" }}>{`${b.who} · ${b.how}`}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }} data-box>
      <div className="sd-pill" style={{ fontSize: undefined, padding: "8px 22px" }}>
        <span className="sd-card-title">쓰려는 돈</span>
      </div>
      <div style={{ width: 2, height: 22, background: "var(--sd-line)" }} />
      <div style={{ width: "68%", height: 2, background: "var(--sd-line)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, width: "100%" }}>
        {branches.map((b) => (
          <div key={b.range} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 2, height: 22, background: "var(--sd-line)" }} />
            <div className={`sd-icard sd-tone-${b.tone}`} style={{ width: "100%", alignItems: "center", textAlign: "center" }}>
              <div className="sd-icard-title">{b.range}</div>
              <div className="sd-icard-body" style={{ color: "var(--sd-fg)" }}>
                {b.who}
              </div>
              <span className="sd-icard-tag">{b.how}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type GanttRow = { unit: "a" | "b" | "c"; label: string; from: string; to: string };

export function Gantt({ opts }: { opts: Opts }) {
  const rows = (opts.rows as GanttRow[] | undefined) ?? [];
  const start = str(opts.start, "2026-10");
  const span = numOr(opts.months) ?? 12;
  const mark = opts.mark as { month: string; label: string } | undefined;
  const rowH = 44;
  const top = 40;
  const h = top + rows.length * rowH + 8;
  const color = (u: GanttRow["unit"]) => (u === "a" ? "var(--sd-a)" : u === "b" ? "var(--sd-b)" : "var(--sd-muted-bar)");
  return (
    <SvgBox h={h} minW={1100} fallback={1390} label="로드맵">
      {(w) => {
        const l = 440;
        const X = (k: number) => l + ((w - l) * k) / span;
        return (
          <>
            {Array.from({ length: span }, (_, k) => {
              const m = addMonths(start, k);
              return (
                <g key={m}>
                  <line x1={X(k)} x2={X(k)} y1={top - 6} y2={h} stroke="var(--sd-line2)" />
                  <text x={X(k + 0.5)} y={24} textAnchor="middle" fontSize={T.axis} fill="var(--sd-fg3)">
                    {F.monthLabel(m)}
                  </text>
                </g>
              );
            })}
            {mark && (
              <g>
                <rect x={X(monthDiff(start, mark.month))} y={top - 6} width={X(1) - X(0)} height={h - top + 6} fill="var(--sd-warn)" opacity={0.12} />
                <text x={X(monthDiff(start, mark.month) + 0.5)} y={h - 8} textAnchor="middle" fontSize={T.axis} fontWeight={800} fill="var(--sd-warn)">
                  {mark.label}
                </text>
              </g>
            )}
            {rows.map((row, i) => {
              const y = top + i * rowH;
              const k0 = monthDiff(start, row.from);
              const k1 = monthDiff(start, row.to) + 1;
              return (
                <g key={i}>
                  <rect x={0} y={y + 12} width={10} height={20} rx={3} fill={color(row.unit)} />
                  <text x={20} y={y + 29} fontSize={T.label} fill="var(--sd-fg)">
                    {row.label}
                  </text>
                  <rect x={X(k0) + 3} y={y + 10} width={Math.max(8, X(k1) - X(k0) - 6)} height={24} rx={6} fill={color(row.unit)} />
                </g>
              );
            })}
          </>
        );
      }}
    </SvgBox>
  );
}

type ScoreItem = { label: string; current?: string; target: string; unit: string; digits?: number; note?: string };

export function Scoreboard({ opts }: { opts: Opts }) {
  const { model } = useSd();
  const items = (opts.items as ScoreItem[] | undefined) ?? [];
  const val = (p?: string): number | null => {
    if (!p) return null;
    const x = getPath(model, p);
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const show = (x: number | null, it: ScoreItem) =>
    x === null ? null : it.unit === "만원" ? F.man(x) : `${F.num(x, it.digits ?? 1)}${it.unit}`;
  return (
    <div className="sd-table-wrap" data-box>
      <table className="sd-table">
        <colgroup>
          <col style={{ width: "36%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "33%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>1월에 볼 숫자</th>
            <th className="sd-r">지금</th>
            <th className="sd-r">목표</th>
            <th>진행</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const cur = val(it.current);
            const tgt = val(it.target);
            const p = calc.progress(cur, tgt);
            return (
              <tr key={i}>
                <td>
                  <Md text={it.label} />
                </td>
                <td className="sd-r" style={cur === null ? { color: "var(--sd-fg3)" } : undefined}>
                  {show(cur, it) ?? "측정 시작 전"}
                  {it.note && cur !== null && <div className="sd-lbl-s">{it.note}</div>}
                </td>
                <td className="sd-r" style={{ color: "var(--sd-fg)", fontWeight: 700 }}>
                  {show(tgt, it) ?? "입력 필요"}
                </td>
                <td style={{ verticalAlign: "middle" }}>
                  {p === null ? (
                    <span className="sd-lbl-s">{cur === null ? "1월까지 ERP에 기록" : "목표 입력 필요"}</span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="sd-progress" style={{ flex: 1, height: 18 }}>
                        <div style={{ width: `${Math.max(2, p * 100)}%`, background: p >= 1 ? "var(--sd-good)" : "var(--sd-b)" }} />
                      </div>
                      <span className="sd-lbl-s" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
                        {F.ratio(p)}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 한 줄 요약 KPI 모음이 필요할 때 — 값은 경로로 */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`sd-kpi${tone ? ` sd-tone-${tone}` : ""}`} data-box>
      <div className="sd-kpi-label">{label}</div>
      <div className="sd-kpi-value">{value}</div>
      {sub && <div className="sd-kpi-sub">{sub}</div>}
    </div>
  );
}
