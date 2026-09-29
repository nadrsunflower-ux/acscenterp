"use client";

// ============================================================
//  3차 수정에서 더한 시각 요소 — 백억 막대 · 매장 일정 · 성격별 직접비율 · 약정 ·
//  점수판 칸 · 선례 브랜드 · 표준 패키지 카드 · 매장 기회 비교
// ------------------------------------------------------------
//  원칙은 viz.tsx 와 같다: 숫자는 model(v · r), 이름표는 내용(opts).
//  ① 주황 · ② 파랑 · 부족·증가 빨강 · 메움·절감 초록. SVG 글씨 18 이상.
// ============================================================

import * as calc from "@/lib/neander/decks/calc";
import * as F from "@/lib/neander/decks/format";
import { fill, getPath } from "@/lib/neander/decks/template";
import { Md, useSd } from "./context";
import { SvgBox, T } from "./charts";
import { Icon } from "./icons";

type Opts = Record<string, unknown>;
const str = (x: unknown, d = "") => (typeof x === "string" ? x : d);
const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const eokText = (x: number | null | undefined, digits = 1) => (ok(x) ? `${F.num(x, digits)}억원` : F.EMPTY);

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

// ============================================================
//  4장 — 지금 연 매출 → 목표, ① 천장 선
// ============================================================

export function GoalBars() {
  const { r } = useSd().model;
  const g = r.goal;
  const max = Math.max(g.target, g.ceiling, g.annualNow) * 1.04;
  const h = 330;
  const rows = [
    { label: "지금 연 매출", parts: [{ v: g.annualUnit1, c: "var(--sd-a)" }, { v: g.annualSmoat, c: "var(--sd-b)" }], text: eokText(g.annualNow) },
    { label: "① 최대로 돌려도", parts: [{ v: g.ceiling, c: "var(--sd-a)" }], text: eokText(g.ceiling, 0) },
    {
      label: "목표",
      parts: [
        { v: g.ceiling, c: "var(--sd-a)" },
        { v: Math.max(0, g.rest), c: "var(--sd-b)" },
      ],
      text: eokText(g.target, 0),
    },
  ];
  return (
    <SvgBox h={h} minW={640} fallback={1390} label="지금 연 매출과 목표">
      {(w) => {
        const l = 230;
        const rr = 150;
        const X = (x: number) => l + ((w - l - rr) * x) / max;
        const rowH = 86;
        return (
          <>
            <line x1={X(g.ceiling)} x2={X(g.ceiling)} y1={4} y2={rows.length * rowH + 10} stroke="var(--sd-a)" strokeWidth={2} strokeDasharray="7 6" />
            <text x={X(g.ceiling) + 8} y={rows.length * rowH + 34} fontSize={T.label} fontWeight={800} fill="var(--sd-a-text)">
              {`① 천장 ${eokText(g.ceiling, 0)}`}
            </text>
            {rows.map((row, i) => {
              const y = i * rowH + 18;
              let acc = 0;
              return (
                <g key={row.label}>
                  <text x={0} y={y + 28} fontSize={T.label} fontWeight={700} fill="var(--sd-fg)">
                    {row.label}
                  </text>
                  {row.parts.map((p, k) => {
                    const x0 = X(acc);
                    acc += Math.max(0, p.v);
                    return <rect key={k} x={x0} y={y} width={Math.max(p.v > 0 ? 3 : 0, X(acc) - x0 - (k < row.parts.length - 1 ? 2 : 0))} height={42} rx={5} fill={p.c} />;
                  })}
                  <text x={X(acc) + 12} y={y + 30} fontSize={T.value} fontWeight={800} fill="var(--sd-fg)">
                    {row.text}
                  </text>
                </g>
              );
            })}
            <text x={X(g.ceiling) + (X(g.target) - X(g.ceiling)) / 2} y={2 * rowH + 18 + 28} fontSize={T.label} fontWeight={800} fill="#fff" textAnchor="middle">
              {`사람 없이 커지는 사업 ${eokText(g.rest, 0)}`}
            </text>
          </>
        );
      }}
    </SvgBox>
  );
}

// ============================================================
//  5-1 — 이전비 회수 개월 (좁은 칸용 막대)
// ============================================================

export function PaybackBars() {
  const { r } = useSd().model;
  const rows = r.reloc.rows.map((row) => {
    const ms = row.cells.map((c) => c.months).filter(ok);
    return { cost: row.cost, lo: ms.length ? Math.min(...ms) : null, hi: ms.length ? Math.max(...ms) : null };
  });
  const max = Math.max(36, ...rows.map((x) => x.hi ?? 0)) * 1.05;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-box>
      <div className="sd-lbl">이전비를 월 이익 개선으로 갚는 기간</div>
      {rows.map((row) => (
        <div key={row.cost} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span className="sd-lbl">{`이전비 ${F.eok(row.cost)}`}</span>
            <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
              {ok(row.lo) && ok(row.hi) ? `${Math.round(row.lo)}~${Math.round(row.hi)}개월` : F.EMPTY}
            </span>
          </div>
          <div style={{ position: "relative", height: 22, background: "var(--sd-panel)", borderRadius: 6 }}>
            {ok(row.lo) && ok(row.hi) && (
              <div
                style={{
                  position: "absolute",
                  left: `${(row.lo / max) * 100}%`,
                  width: `max(8px, ${((row.hi - row.lo) / max) * 100}%)`,
                  top: 0,
                  bottom: 0,
                  background: "var(--sd-a)",
                  borderRadius: 5,
                }}
              />
            )}
            {/* 12개월(재계약 만료까지) 선 */}
            <div style={{ position: "absolute", left: `${(12 / max) * 100}%`, top: -4, bottom: -4, borderLeft: "2px dashed var(--sd-warn)" }} />
          </div>
        </div>
      ))}
      <div className="sd-lbl-s">점선 = 계약 만료(12개월 뒤)</div>
    </div>
  );
}

// ============================================================
//  일정 줄 — 달마다 칸, 구간 막대와 표시
// ============================================================

type Span = { from: string; to: string; label: string; tone?: "a" | "b" | "muted" | "warn" };
type Mark = { month: string; label: string; tone?: "a" | "b" | "warn" | "bad" };

export function Milestones({ opts }: { opts: Opts }) {
  const { model } = useSd();
  const start = str(opts.start, "2026-10");
  const months = typeof opts.months === "number" ? opts.months : 12;
  const spans = (opts.spans as Span[] | undefined) ?? [];
  const marks = (opts.marks as Mark[] | undefined) ?? [];
  const color = (t?: string) =>
    t === "a" ? "var(--sd-a)" : t === "b" ? "var(--sd-b)" : t === "warn" ? "var(--sd-warn)" : t === "bad" ? "var(--sd-bad)" : "var(--sd-muted-bar)";
  const h = 44 + spans.length * 40 + 60;
  return (
    <SvgBox h={h} minW={900} fallback={1390} label="일정">
      {(w) => {
        const X = (k: number) => (w * k) / months;
        const top = 34;
        return (
          <>
            {Array.from({ length: months }, (_, k) => {
              const m = addMonths(start, k);
              return (
                <g key={m}>
                  <line x1={X(k)} x2={X(k)} y1={top - 4} y2={h - 50} stroke="var(--sd-line2)" />
                  <text x={X(k + 0.5)} y={22} textAnchor="middle" fontSize={T.axis} fill="var(--sd-fg3)">
                    {m.endsWith("-01") || k === 0 ? `${m.slice(2, 4)}.${Number(m.slice(5))}` : F.monthLabel(m)}
                  </text>
                </g>
              );
            })}
            {spans.map((s, i) => {
              const k0 = monthDiff(start, s.from);
              const k1 = monthDiff(start, s.to) + 1;
              const y = top + i * 40 + 6;
              return (
                <g key={i}>
                  <rect x={X(k0) + 3} y={y} width={Math.max(8, X(k1) - X(k0) - 6)} height={28} rx={6} fill={color(s.tone)} opacity={0.9} />
                  <text x={X(k0) + 12} y={y + 21} fontSize={T.axis} fontWeight={700} fill={s.tone === "muted" || !s.tone ? "var(--sd-fg)" : "#fff"}>
                    {fill(s.label, model)}
                  </text>
                </g>
              );
            })}
            {marks.map((mk, i) => {
              const k = monthDiff(start, mk.month);
              const x = X(k + 0.5);
              const anchor = k >= months - 2 ? "end" : k <= 0 ? "start" : "middle";
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={top - 4} y2={h - 42} stroke={color(mk.tone ?? "warn")} strokeWidth={3} />
                  <circle cx={x} cy={h - 40} r={7} fill={color(mk.tone ?? "warn")} />
                  <text x={anchor === "end" ? x + 8 : anchor === "start" ? x - 8 : x} y={h - 12} textAnchor={anchor} fontSize={T.label} fontWeight={800} fill={color(mk.tone ?? "warn")}>
                    {fill(mk.label, model)}
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
//  14장 — 프로젝트 성격별 직접비율 (ERP), 준비 품목 수는 숫자로
// ============================================================

export function ProjectKindBars() {
  const { r } = useSd().model;
  const b = r.b2b;
  if (!b.byKind.length) return null;
  const max = Math.max(0.4, ...b.byKind.map((k) => k.max)) * 1.08;
  const target = b.standardDirectTarget;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-box>
      <div className="sd-lbl">프로젝트 성격별 직접비율 (재료·외주·운송 ÷ 매출, ERP)</div>
      {b.byKind.map((k) => {
        const items = k.projects.filter((p) => p.items).map((p) => `${p.name} ${p.items}개`);
        return (
          <div key={k.kind} style={{ display: "grid", gridTemplateColumns: "minmax(0, 210px) 1fr minmax(0, 110px)", gap: 12, alignItems: "center" }}>
            <div>
              <div className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
                {k.kind}
              </div>
              {items.length > 0 && <div className="sd-lbl-s">{`준비 품목 ${items.join(" · ")}`}</div>}
            </div>
            <div style={{ position: "relative", height: 30 }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${(k.max / max) * 100}%`,
                  background: k.min === k.max ? "var(--sd-a)" : "linear-gradient(90deg, var(--sd-a) 0%, var(--sd-a) 100%)",
                  opacity: 0.35,
                  borderRadius: "0 5px 5px 0",
                }}
              />
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(k.min / max) * 100}%`, background: "var(--sd-a)", borderRadius: "0 5px 5px 0" }} />
              {ok(target) && <div style={{ position: "absolute", left: `${(target / 100 / max) * 100}%`, top: -5, bottom: -5, borderLeft: "2px dashed var(--sd-good)" }} />}
            </div>
            <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)", textAlign: "right" }}>
              {k.min === k.max ? F.ratio(k.min) : `${F.num(k.min * 100)}~${F.ratio(k.max)}`}
            </span>
          </div>
        );
      })}
      {ok(target) && <div className="sd-lbl-s">{`초록 점선 = 표준 패키지 목표 ${F.pct(target)} 이하 · 표본 ${b.projects.length}건이라 경향으로만`}</div>}
    </div>
  );
}

// ============================================================
//  20-2 — 요금제 정가 · 1년 약정가 · 월 크레딧
// ============================================================

export function CommitTable() {
  const { r } = useSd().model;
  const c = r.smoat.commit;
  return (
    <div className="sd-table-wrap" data-box>
      <table className="sd-table">
        <colgroup>
          <col style={{ width: "24%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "32%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>요금제</th>
            <th className="sd-r">정가 (월)</th>
            <th className="sd-r">1년 약정가 (할인)</th>
            <th className="sd-r">월 크레딧</th>
          </tr>
        </thead>
        <tbody>
          {c.map((t, i) => (
            <tr key={t.name}>
              <td>
                <b>{t.name}</b>
              </td>
              <td className="sd-r">{F.won(t.price)}</td>
              <td className="sd-r" style={{ color: "var(--sd-fg)", fontWeight: 700 }}>
                {`${F.won(t.commitPrice)} (${F.ratio(t.discount)})`}
              </td>
              <td className="sd-r">{F.credits(r.smoat.tiers[i]?.credits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
//  21-2 — 약정 vs 무약정 12개월 누적 매출 (베이직 한 곳)
// ============================================================

export function CommitLine() {
  const { r, v } = useSd().model;
  const line = r.smoat.commitLine;
  const b = r.smoat.basic;
  if (!b || !line.length) return null;
  const max = Math.max(...line.map((p) => Math.max(p.noCommit, p.commit, b.econNoExit.commit))) * 1.12;
  const h = 300;
  return (
    <div className="sd-chart">
      <div className="sd-lbl">{`${b.name} 한 곳 12개월 누적 매출 (월 해지율 ${F.pct(v.monthlyChurn as number, 1)})`}</div>
      <SvgBox h={h} minW={480} fallback={640} label="약정과 무약정 12개월 누적 매출">
        {(w) => {
          const l = 10;
          const rr = 16;
          const t = 30;
          const bot = h - 34;
          const X = (i: number) => l + ((w - l - rr) * i) / 11;
          const Y = (x: number) => bot - ((bot - t) * x) / max;
          const path = (f: (p: (typeof line)[number]) => number) => line.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(f(p))}`).join(" ");
          const last = line[line.length - 1];
          return (
            <>
              <line x1={l} x2={w - rr} y1={bot} y2={bot} stroke="var(--sd-line)" />
              <path d={path((p) => p.noCommit)} fill="none" stroke="var(--sd-muted-bar)" strokeWidth={3} />
              <path d={path((p) => p.commit)} fill="none" stroke="var(--sd-b)" strokeWidth={4} />
              <circle cx={X(11)} cy={Y(last.commit)} r={6} fill="var(--sd-b)" />
              <circle cx={X(11)} cy={Y(last.noCommit)} r={6} fill="var(--sd-muted-bar)" />
              {/* 두 선은 왼쪽 아래에서 시작해 오른쪽 위로 가므로 값은 왼쪽 위 빈칸에 둔다 (선과 안 겹침) */}
              <circle cx={l + 8} cy={t + 4} r={7} fill="var(--sd-b)" />
              <text x={l + 24} y={t + 13} fontSize={T.value} fontWeight={800} fill="var(--sd-b-text)">
                {`약정 ${F.wonMan(last.commit)} (${b.econ.lift === null ? F.EMPTY : `${b.econ.lift >= 0 ? "+" : ""}${F.ratio(b.econ.lift)}`})`}
              </text>
              <circle cx={l + 8} cy={t + 44} r={7} fill="var(--sd-muted-bar)" />
              <text x={l + 24} y={t + 53} fontSize={T.value} fontWeight={800} fill="var(--sd-fg2)">
                {`무약정 ${F.wonMan(last.noCommit)} (${F.num(b.econ.months, 1)}개월)`}
              </text>
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
      <div className="sd-lbl-s">
        {`중도 해지 ${F.pct(v.commitEarlyExitRate as number)} 기준 ${F.wonMan(b.econ.commit)} (${F.ratio(b.econ.lift)}) · 0% 기준 ${F.wonMan(b.econNoExit.commit)} (${F.ratio(b.econNoExit.lift)}) · 중도 해지는 받은 할인액을 돌려준다`}
      </div>
    </div>
  );
}

// ============================================================
//  26장 — 점수판 칸 (표 6행 규칙 때문에 칸 격자)
// ============================================================

type ScoreTile = { label: string; current?: string; target: string; unit: string; digits?: number; note?: string; down?: boolean; group?: "a" | "b" | "c" };

export function ScoreTiles({ opts }: { opts: Opts }) {
  const { model } = useSd();
  const items = (opts.items as ScoreTile[] | undefined) ?? [];
  const cols = typeof opts.cols === "number" ? opts.cols : 3;
  const val = (p?: string): number | null => {
    if (!p) return null;
    const x = getPath(model, p);
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const show = (x: number | null, it: ScoreTile) =>
    x === null ? null : it.unit === "만원" ? F.man(x) : it.unit === "%" ? F.pct(x, it.digits ?? 0) : `${F.num(x, it.digits ?? 0)}${it.unit}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }} className="sd-icards">
      {items.map((it, i) => {
        const cur = val(it.current);
        const tgt = val(it.target);
        const p = it.down ? calc.progressDown(cur, tgt) : calc.progress(cur, tgt);
        const bar = it.group === "a" ? "var(--sd-a)" : it.group === "b" ? "var(--sd-b)" : "var(--sd-s3)";
        return (
          <div key={i} className="sd-icard" style={{ gap: 6, padding: "12px 16px", borderTop: `4px solid ${bar}` }} data-box>
            <div className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
              <Md text={it.label} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span className="sd-lbl" style={cur === null ? { color: "var(--sd-fg3)" } : { color: "var(--sd-fg)", fontWeight: 700 }}>
                {cur === null ? "측정 시작 전" : `지금 ${show(cur, it)}`}
              </span>
              <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
                {tgt === null ? "목표 입력 필요" : `목표 ${show(tgt, it)}${it.down ? " 이하" : " 이상"}`}
              </span>
            </div>
            <div className="sd-progress" style={{ height: 14 }}>
              {p !== null && <div style={{ width: `${Math.max(2, p * 100)}%`, background: p >= 1 ? "var(--sd-good)" : bar }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
//  28장 — 선례 브랜드 매출 성장 (출처의 숫자, 억원)
// ============================================================

type Precedent = { name: string; from: { year: string; value: number }; to: { year: string; value: number } };

export function PrecedentBars({ opts }: { opts: Opts }) {
  const items = (opts.items as Precedent[] | undefined) ?? [];
  const max = Math.max(1, ...items.map((x) => x.to.value)) * 1.05;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-box>
      <div className="sd-lbl">{str(opts.title, "선례 브랜드 매출 (억원)")}</div>
      {items.map((x) => (
        <div key={x.name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) 1fr", gap: 12, alignItems: "center" }}>
          <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
            <Md text={x.name} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[x.from, x.to].map((p, k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ height: 22, width: `${(p.value / max) * 100}%`, minWidth: 4, background: k ? "var(--sd-a)" : "var(--sd-muted-bar)", borderRadius: "0 5px 5px 0" }} />
                <span className="sd-lbl-s" style={{ whiteSpace: "nowrap", color: "var(--sd-fg)", fontWeight: 700 }}>{`${p.year} ${F.num(p.value)}억`}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
//  A8 — 표준 패키지 카드 (홈페이지 견적 가격표에서)
// ============================================================

type Pkg = { name: string; price: string; base: string; kit: string; options: string; checklist: string };

export function PackageCards({ opts }: { opts: Opts }) {
  const items = (opts.items as Pkg[] | undefined) ?? [];
  const row = (label: string, text: string) => (
    <div>
      <div className="sd-lbl-s" style={{ fontWeight: 800 }}>
        {label}
      </div>
      <div className="sd-pcard-meta" style={{ color: text === "확정 필요" ? "var(--sd-warn)" : undefined }}>
        <Md text={text} />
      </div>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 14 }} className="sd-icards">
      {items.map((p) => (
        <div key={p.name} className="sd-icard" style={{ gap: 8 }} data-box>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span className="sd-icard-title">{p.name}</span>
            <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-a-text)", whiteSpace: "nowrap" }}>
              {p.price}
            </span>
          </div>
          {row("기본 구성", p.base)}
          {row("장비 키트", p.kit)}
          {row("옵션 범위", p.options)}
          {row("준비 체크리스트", p.checklist)}
        </div>
      ))}
    </div>
  );
}

// ============================================================
//  A7 — 매장 기회 비교 (B)
// ============================================================

export function StoreOpportunity() {
  const { r, v } = useSd().model;
  const s = r.store;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-box>
      <div className="sd-kpi sd-tone-b">
        <div className="sd-kpi-label">매장 인력이 새로 벌어야 할 공헌이익</div>
        <div className="sd-kpi-value">{F.man(s.need)}</div>
        <div className="sd-kpi-sub">{`매장 기여이익 ${F.man(s.contrib)} + 매장발 B2B + 대체 마케팅${s.missingText ? ` · ${s.missingText}` : ""}`}</div>
      </div>
      <div className="sd-lbl">
        <Md text={`스모트로 환산 **구독 약 ${F.num(s.vsSmoat)}곳** (학원당 ${F.wonMan(r.smoat.avgContrib)})`} />
      </div>
      <div className="sd-lbl">
        <Md text={`B2B로 환산 **월 약 ${F.num(s.vsB2B, 1)}건** (건당 ${F.man(v.b2bAvgDeal as number)} × ${F.pct(v.b2bContribRate as number, 1)})`} />
      </div>
    </div>
  );
}

/** 작은 아이콘 줄 — 잃는 것 넷처럼 한 줄 요약 */
export function IconLine({ opts }: { opts: Opts }) {
  const items = (opts.items as { icon: string; text: string }[] | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", alignItems: "center" }} data-box>
      {opts.label ? (
        <span className="sd-lbl" style={{ fontWeight: 800, color: "var(--sd-fg)" }}>
          <Md text={str(opts.label)} />
        </span>
      ) : null}
      {items.map((it) => (
        <span key={it.text} className="sd-pill" style={{ padding: "6px 14px" }}>
          <Icon name={it.icon} size={20} />
          <Md text={it.text} />
        </span>
      ))}
    </div>
  );
}
