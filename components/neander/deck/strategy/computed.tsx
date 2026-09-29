"use client";

// ============================================================
//  계산 블록 — 가정값과 실측으로 그 자리에서 다시 계산되는 표·차트
// ------------------------------------------------------------
//  숫자를 코드에 적지 않는다. 표의 모든 칸은 model(v · r)과 내용의 이름표에서
//  온다. 장표 문구가 같은 결과를 `{{r.…}}` 로 다시 쓰므로, 여기와 문구가
//  같은 숫자를 보인다.
//
//  차트 색은 styles.ts 머리말의 검증된 범주 색. 값이 둘 이상 계열이면 범례를
//  두고, 막대에는 직접 라벨을 붙인다(색만으로 구분하지 않는다).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { loadDeckAsset } from "@/lib/neander/decks/client";
import * as F from "@/lib/neander/decks/format";
import { MAP_H, MAP_W, distanceM, fitMap, place, spreadPins, tilesFor } from "@/lib/neander/decks/map";
import { ASSUMPTION_GROUPS, type DeckProperty } from "@/lib/neander/decks/types";
import { CircText, Md, academyLabeler, useSd } from "./context";

type Opts = Record<string, unknown>;

export function Computed({ kind, opts }: { kind: string; opts: Opts }) {
  switch (kind) {
    case "relocPayback":
      return <RelocPayback />;
    case "revenueMix":
      return <RevenueMix />;
    case "runway":
      return <Runway />;
    case "smoatMonthly":
      return <SmoatMonthly />;
    case "smoatTiers":
      return <SmoatTiers compact={opts.compact === true} />;
    case "smoatBands":
      return <SmoatBands />;
    case "academyCompare":
      return <AcademyCompare />;
    case "academyTable":
      return <AcademyTable />;
    case "smoatSimulation":
      return <SmoatSimulation />;
    case "smoatBreakeven":
      return <SmoatBreakeven />;
    case "smoatPrepay":
      return <SmoatPrepay />;
    case "b2bScenarios":
      return <B2bScenarios web={opts.web !== false} />;
    case "b2bProducts":
      return <B2bProducts />;
    case "b2bProjects":
      return <B2bProjects />;
    case "sangkaT1":
      return <SangkaT1 />;
    case "sangkaFunnel":
      return <SangkaFunnel />;
    case "approval":
      return <Approval />;
    case "commonCost":
      return <CommonCost />;
    case "propertyRegion":
      return <PropertyRegion region={String(opts.region ?? "")} />;
    case "propertyTable":
      return <PropertyTable />;
    case "assumptionTable":
      return <AssumptionTable />;
    case "sources":
      return <SourceList />;
    case "gallery":
      return <Gallery items={(opts.items as { asset: string; caption: string }[]) ?? []} />;
    default:
      return <div className="sd-callout sd-tone-bad">알 수 없는 계산 블록: {kind}</div>;
  }
}

// ---- 공용 ----------------------------------------------------

function Table({
  head,
  rows,
  align,
  widths,
  size,
  strong,
  note,
  hi,
}: {
  head: string[];
  rows: (string | number)[][];
  align?: string;
  widths?: number[];
  size?: "xs" | "sm" | "md";
  strong?: number[];
  note?: string;
  /** 강조할 칸 [행, 열] */
  hi?: [number, number][];
}) {
  const a = (i: number) => (align?.[i] === "r" ? "sd-r" : align?.[i] === "c" ? "sd-c" : undefined);
  const total = (widths ?? []).reduce((s, w) => s + w, 0);
  const isHi = (r: number, c: number) => hi?.some(([hr, hc]) => hr === r && hc === c);
  return (
    <div className="sd-table-wrap" data-box>
      <table className={`sd-table${size && size !== "md" ? ` sd-${size}` : ""}`}>
        {widths && (
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: `${(w / total) * 100}%` }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={a(i)}>
                <Md text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={strong?.includes(r) ? "sd-strong" : undefined}>
              {row.map((cell, c) => (
                <td key={c} className={[a(c), isHi(r, c) ? "sd-strongcol" : ""].filter(Boolean).join(" ") || undefined}>
                  {isHi(r, c) ? <span className="sd-hl"><Md text={String(cell)} /></span> : <Md text={String(cell)} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && (
        <div className="sd-table-note">
          <Md text={note} />
        </div>
      )}
    </div>
  );
}

function Kpis({ items, cols }: { items: { label: string; value: string; sub?: string; tone?: string }[]; cols?: number }) {
  return (
    <div className="sd-kpis" style={{ gridTemplateColumns: `repeat(${cols ?? items.length}, minmax(0, 1fr))` }}>
      {items.map((k, i) => (
        <div key={i} className={`sd-kpi${k.tone ? ` sd-tone-${k.tone}` : ""}`}>
          <div className="sd-kpi-label">
            <Md text={k.label} />
          </div>
          <div className="sd-kpi-value">
            <Md text={k.value} />
          </div>
          {k.sub && (
            <div className="sd-kpi-sub">
              <Md text={k.sub} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 사진·타일 — 로그인 fetch 로 받은 blob URL */
function useAsset(id: string | null | undefined): string | null | undefined {
  const { slug } = useSd();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    loadDeckAsset(slug, id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [slug, id]);
  return url;
}

// ---- 매장 이전 -------------------------------------------------

function RelocPayback() {
  const { r } = useSd().model;
  const labels = ["최소", "중간", "최대"];
  const rows = r.reloc.rows;
  if (rows.length === 0) return null;
  const all = rows.flatMap((row, ri) => row.cells.map((c, ci) => ({ ri, ci, m: c.months })));
  const valid = all.filter((x) => x.m !== null) as { ri: number; ci: number; m: number }[];
  const minCell = valid.reduce((a, b) => (b.m < a.m ? b : a), valid[0]);
  const maxCell = valid.reduce((a, b) => (b.m > a.m ? b : a), valid[0]);
  return (
    <Table
      head={["이전 일회성 비용", ...rows[0].cells.map((c) => `월 이익 개선 +${F.man(c.gain)}`)]}
      align="lrr"
      widths={[1.3, 1, 1]}
      rows={rows.map((row, i) => [
        `${labels[i] ?? ""} ${F.eok(row.cost)}`,
        ...row.cells.map((c) =>
          c.months === null ? F.EMPTY : `${F.months(Math.round(c.months))} (약 ${F.num(c.months / 12, 1)}년)`,
        ),
      ])}
      hi={minCell && maxCell ? [[minCell.ri, minCell.ci + 1], [maxCell.ri, maxCell.ci + 1]] : []}
    />
  );
}

// ---- 매출 구성과 현금 --------------------------------------------

const MIX_COLORS = ["var(--sd-s4)", "var(--sd-s3)", "var(--sd-s2)", "var(--sd-s1)"];

function RevenueMix() {
  const { r } = useSd().model;
  const rows = r.mix.rows;
  const total = r.mix.total || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-box>
      <div className="sd-stack" role="img" aria-label="월 매출 구성">
        {rows.map((row, i) => (
          <div
            key={row.key}
            title={`${row.label} ${F.man(row.amount)} (${F.ratio(row.share)})`}
            style={{ width: `${(Math.max(0, row.amount) / total) * 100}%`, background: MIX_COLORS[i] }}
          />
        ))}
      </div>
      <div className="sd-table-wrap">
        <table className="sd-table sd-sm">
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "24%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>구분</th>
              <th className="sd-r">월 매출</th>
              <th className="sd-r">비중</th>
              <th>사업부</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key}>
                <td>
                  <span
                    aria-hidden
                    style={{ display: "inline-block", width: 11, height: 11, borderRadius: 2, marginRight: 8, background: MIX_COLORS[i] }}
                  />
                  {row.label}
                </td>
                <td className="sd-r">{F.man(row.amount)}</td>
                <td className="sd-r">{F.ratio(row.share)}</td>
                <td>
                  <CircText text={row.unit} />
                </td>
              </tr>
            ))}
            <tr className="sd-strong">
              <td>합계</td>
              <td className="sd-r">{F.man(r.mix.total)}</td>
              <td className="sd-r">100%</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Runway() {
  const { r, v, meta } = useSd().model;
  const c = r.cash;
  const fin = r.fin;
  const costSub =
    meta.costMonthly?.origin === "erp" || meta.costMonthly?.origin === "snapshot"
      ? `${fin ? `${F.monthLabel(fin.cost.from, true)}~${F.monthLabel(fin.cost.to)}` : ""} 평균, 부가세 납부 제외${(v.vatInFinance as number) ? ` · 금융비용 속 부가세 ${F.man(v.vatInFinance as number)} 뺌` : ""}`
      : "가정";
  return (
    <Kpis
      cols={3}
      items={[
        { label: "월 지출", value: F.man(c.cost), sub: costSub },
        { label: `월 매출 (${r.mix.rows.length}갈래 합)`, value: F.man(c.revenue), sub: r.mix.rows.map((x) => x.label).join(" · ") },
        { label: "매달 모자라는 돈", value: F.man(c.gap), tone: c.gap > 0 ? "bad" : "good", sub: "지원금을 빼고 본 값" },
        {
          label: "지원금·환급 월평균",
          value: F.man(c.subsidy),
          sub: `부족분의 ${F.ratio(c.subsidyCover)}를 가려 왔다 · 런웨이에 ${c.includeSubsidy ? "넣음" : "안 넣음"}`,
        },
        { label: "현금 잔고", value: F.eok(c.balance), sub: "가정 (입력)" },
        {
          label: "런웨이",
          value: c.surplus ? "흑자" : F.months(c.months),
          tone: c.surplus ? "good" : "bad",
          sub: `지원금 제외 ${c.monthsNoSubsidy === null ? "흑자" : F.months(c.monthsNoSubsidy)} · 포함 ${c.monthsWithSubsidy === null ? "흑자" : F.months(c.monthsWithSubsidy)}`,
        },
      ]}
    />
  );
}

// ---- 스모트 ----------------------------------------------------

function SmoatMonthly() {
  const { r } = useSd().model;
  const sm = r.sm;
  if (!sm) return null;
  const months = sm.months.filter((m) => m.month >= sm.avgFrom);
  const max = Math.max(1, ...months.map((m) => m.dashboard));
  const W = 700;
  const H = 370;
  const base = 290;
  const top = 34;
  const gw = W / months.length;
  const bw = Math.min(52, gw / 3.4);
  const y = (val: number) => base - ((base - top) * val) / max;
  const unnamed = months.filter((m) => m.unnamed > 0);
  return (
    <div data-box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sd-legend">
        <span>
          <i style={{ background: "var(--sd-muted-bar)" }} />
          대시보드 (내부·테스트 결제 포함)
        </span>
        <span>
          <i style={{ background: "var(--sd-s1)" }} />
          실제 학원 결제
        </span>
      </div>
      <svg className="sd-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="스모트 월별 결제">
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--sd-line)" strokeWidth={1} />
        {months.map((m, i) => {
          const cx = gw * i + gw / 2;
          const x1 = cx - bw - 2;
          const x2 = cx + 2;
          return (
            <g key={m.month}>
              <rect x={x1} y={y(m.dashboard)} width={bw} height={base - y(m.dashboard)} rx={4} fill="var(--sd-muted-bar)">
                <title>{`${F.monthLabel(m.month)} 대시보드 ${F.won(m.dashboard)}`}</title>
              </rect>
              <rect x={x2} y={y(m.academies)} width={bw} height={Math.max(0, base - y(m.academies))} rx={4} fill="var(--sd-s1)">
                <title>{`${F.monthLabel(m.month)} 실제 학원 결제 ${F.won(m.academies)} (${m.payments}건)`}</title>
              </rect>
              {/* 실제 결제만 막대 위에, 대시보드 값은 달 이름 아래에 — 두 라벨이 붙지 않게 */}
              <text x={cx} y={Math.min(y(m.academies), y(m.dashboard)) - 10} textAnchor="middle" fontSize={17} fontWeight={700} fill="var(--sd-fg)">
                {F.wonMan(m.academies)}
              </text>
              <text x={cx} y={base + 27} textAnchor="middle" fontSize={17} fill="var(--sd-fg2)">
                {F.monthLabel(m.month)}
              </text>
              <text x={cx} y={base + 50} textAnchor="middle" fontSize={13.5} fill="var(--sd-fg3)">
                대시보드 {F.wonMan(m.dashboard)}
              </text>
            </g>
          );
        })}
      </svg>
      {unnamed.length > 0 && (
        <div className="sd-table-note">
          이름 없는 입금은 학원 결제에서 빼고 따로 둔다:{" "}
          {unnamed.map((m) => `${F.monthLabel(m.month)} ${F.wonMan(m.unnamed)}`).join(", ")} · 기준일 {F.dateLabel(sm.asOf)} 동기화
        </div>
      )}
    </div>
  );
}

function SmoatTiers({ compact }: { compact: boolean }) {
  const { r, v } = useSd().model;
  const tiers = r.smoat.tiers;
  const usage = F.pct(v.usageRate as number);
  if (compact) {
    return (
      <Table
        head={["요금제", "월 가격", "매달 크레딧", "약 문항", "1C당"]}
        align="lrrrr"
        rows={tiers.map((t) => [
          `**${t.name}**`,
          F.won(t.price),
          F.credits(t.credits),
          `${F.num(t.questions)}문항`,
          `${F.num(t.perCredit, 1)}원`,
        ])}
      />
    );
  }
  return (
    <Table
      head={["요금제", "월 가격", "매달 크레딧", "약 문항", "1C당", "공급가", "전부 사용 이익률", `사용률 ${usage} 이익률`]}
      align="lrrrrrrr"
      widths={[1, 1, 1, 0.9, 0.8, 1, 1.1, 1.1]}
      size="sm"
      rows={tiers.map((t) => [
        `**${t.name}**`,
        F.won(t.price),
        F.credits(t.credits),
        `${F.num(t.questions)}`,
        `${F.num(t.perCredit, 1)}원`,
        F.won(t.supply),
        F.ratio(t.marginFull, 1),
        F.ratio(t.marginSet, 1),
      ])}
      note={`공급가 = 가격 ÷ (1 + 부가세 ${F.pct(v.vatRate as number)}) · 결제 수수료 ${F.pct(v.pgFeeRate as number, 1)} · AI 원가 ${F.num(v.aiCostPerCredit as number, 2)}원/C · 문항당 ${F.num(v.creditsPerQuestion as number)}C`}
    />
  );
}

function SmoatBands() {
  const { r } = useSd().model;
  const bands = r.smoat.bands;
  const range = (a: number | null, b: number | null, f: (x: number) => string) =>
    a === null || b === null ? F.EMPTY : Math.round(a) === Math.round(b) ? f(a) : `${f(a)}~${f(b)}`;
  return (
    <Table
      head={["월 크레딧 (구매량)", "학원 수", "월 지출", "1C당 낸 가격"]}
      align="lrrr"
      widths={[1.1, 0.6, 1.6, 1]}
      rows={bands.map((b) => [
        b.label,
        `${b.count}곳`,
        b.count ? `${range(b.spendMin, b.spendMax, F.wonMan)} (평균 ${F.wonMan(b.spendAvg)})` : F.EMPTY,
        b.count ? range(b.perCreditMin, b.perCreditMax, (x) => `${F.num(x)}원`) : F.EMPTY,
      ])}
      note={r.sm ? `구매량을 필요량 대신 썼다: 학원별 산 크레딧 ÷ 첫 결제 달부터 ${F.monthLabel(r.sm.baseMonth)}까지 개월 수` : undefined}
    />
  );
}

function AcademyCompare() {
  const { r } = useSd().model;
  const tiers = r.smoat.tiers;
  const groups = r.smoat.bands.map((band) => {
    const list = r.smoat.academies.filter((a) =>
      band.from === 0 ? a.monthlyCredits <= (band.to ?? Infinity) : a.monthlyCredits > band.from && (band.to === null || a.monthlyCredits <= band.to),
    );
    const n = list.length;
    const avg = (f: (a: (typeof list)[number]) => number | null) => {
      const xs = list.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
      return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
    };
    const spend = avg((a) => a.monthlySpend);
    const price = avg((a) => a.compare.price);
    const saving = spend !== null && price !== null && spend > 0 ? (spend - price) / spend : null;
    const counts = tiers.map((t, i) => ({ name: t.name, n: list.filter((a) => a.compare.index === i).length })).filter((x) => x.n > 0);
    return { band, n, spend, price, saving, multiple: avg((a) => a.compare.multiple), counts, over: list.some((a) => a.compare.over) };
  });
  const totalNow = r.smoat.academies.reduce((s, a) => s + a.monthlySpend, 0);
  const totalSub = r.smoat.academies.reduce((s, a) => s + a.compare.price, 0);
  return (
    <Table
      head={["구간 (월 크레딧)", "학원", "지금 월 지출 → 구독", "비용 변화", "받는 크레딧", "추천 요금제"]}
      align="lrrrrl"
      widths={[1.05, 0.5, 1.5, 0.9, 0.9, 1.3]}
      size="sm"
      rows={[
        ...groups.map((g) => [
          g.band.label,
          `${g.n}곳`,
          g.n ? `${F.wonMan(g.spend)} → ${F.wonMan(g.price)}` : F.EMPTY,
          g.saving === null ? F.EMPTY : g.saving >= 0 ? `${F.ratio(g.saving)} 절감` : `${F.ratio(-g.saving)} 더 냄`,
          g.n ? `약 ${F.times(g.multiple)}` : F.EMPTY,
          g.counts.map((c) => `${c.name} ${c.n}`).join(", ") + (g.over ? " (추가 묶음)" : ""),
        ]),
        [
          "**합계**",
          `${r.smoat.academies.length}곳`,
          `${F.wonMan(totalNow)} → ${F.wonMan(totalSub)}`,
          totalNow > 0 ? (totalNow >= totalSub ? `${F.ratio((totalNow - totalSub) / totalNow)} 절감` : `${F.ratio((totalSub - totalNow) / totalNow)} 더 냄`) : F.EMPTY,
          "",
          "",
        ],
      ]}
      strong={[groups.length]}
      note="구간마다 평균. 추천 = 월 크레딧이 필요량 × (1 + 추천 여유율) 이상인 가장 싼 요금제"
    />
  );
}

function AcademyTable() {
  const sd = useSd();
  const { r } = sd.model;
  const label = academyLabeler(sd);
  const tiers = r.smoat.tiers;
  return (
    <Table
      head={["학원", "결제", "첫 결제", "월 지출", "월 크레딧", "추천", "구독가", "비용 변화", "크레딧 배수"]}
      align="lrrrrlrrr"
      widths={[1.5, 0.5, 0.7, 0.9, 0.8, 0.8, 0.9, 0.9, 0.8]}
      size="xs"
      rows={r.smoat.academies.map((a, i) => [
        label(a.name, i),
        `${a.payments}건`,
        F.monthLabel(a.firstMonth),
        F.won(a.monthlySpend),
        F.credits(Math.round(a.monthlyCredits)),
        tiers[a.compare.index]?.name + (a.compare.over ? "+" : ""),
        F.won(a.compare.price),
        a.compare.savingRate === null ? F.EMPTY : a.compare.savingRate >= 0 ? `-${F.ratio(a.compare.savingRate)}` : `+${F.ratio(-a.compare.savingRate)}`,
        F.times(a.compare.multiple),
      ])}
      note={
        r.sm
          ? `내부·테스트 결제와 이름 없는 입금 제외 · 월 지출 = 결제 합계 ÷ 첫 결제 달부터 ${F.monthLabel(r.sm.baseMonth)}까지 개월 수 · 기준일 ${F.dateLabel(r.sm.asOf)}`
          : undefined
      }
    />
  );
}

function HBars({ rows, max }: { rows: { label: string; value: number | null; color: string; strong?: boolean; text?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <div className="sd-bars" data-box>
      {rows.map((row, i) => (
        <div key={i} className="sd-bar-row">
          <div className="sd-bar-label">
            <Md text={row.label} />
          </div>
          <div className="sd-bar-track">
            <div
              className="sd-bar-fill"
              title={`${row.label} ${row.text ?? ""}`}
              style={{ width: `${(Math.max(0, row.value ?? 0) / m) * 100}%`, background: row.color }}
            />
          </div>
          <div className="sd-bar-val" style={row.strong ? { color: "var(--sd-fg)" } : { color: "var(--sd-fg2)", fontWeight: 600 }}>
            {row.text ?? F.EMPTY}
          </div>
        </div>
      ))}
    </div>
  );
}

function SmoatSimulation() {
  const { r, v } = useSd().model;
  const s = r.smoat.sim;
  const tiers = r.smoat.tiers;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <HBars
        rows={[
          { label: "**구독 후 매달** (추가 전환 포함)", value: s.monthly, color: "var(--sd-s1)", strong: true, text: F.wonMan(s.monthly) },
          { label: `지금 결제 학원만 구독`, value: s.existing, color: "var(--sd-s1)", strong: true, text: F.wonMan(s.existing) },
          {
            label: `${s.avgFrom ? `${F.monthLabel(s.avgFrom)}~${F.monthLabel(r.sm?.baseMonth ?? "")}` : ""} 실제 월평균`,
            value: s.avgMonthly,
            color: "var(--sd-muted-bar)",
            text: F.wonMan(s.avgMonthly),
          },
          {
            label: `최고 월 (${s.peak ? F.monthLabel(s.peak.month) : ""})`,
            value: s.peak?.amount ?? null,
            color: "var(--sd-muted-bar)",
            text: F.wonMan(s.peak?.amount ?? null),
          },
        ]}
      />
      <div className="sd-table-note" style={{ fontSize: 14 }}>
        <Md
          text={`요금제 구성: ${tiers.map((t, i) => `${t.name} ${s.counts[i]}곳`).join(", ")} · 구독 전환 비율 ${F.pct(v.subscribeRate as number)} · 추가 전환 ${F.num(v.extraConversions as number)}곳(${tiers[0]?.name}) ${F.wonMan(s.extra)} · 월 해지율 ${F.pct(v.monthlyChurn as number, 1)}를 적용한 12개월 누적 **${F.wonMan(s.cumulativeTotal)}**`}
        />
      </div>
    </div>
  );
}

function SmoatBreakeven() {
  const { r, v } = useSd().model;
  const b = r.smoat.breakeven;
  return (
    <Kpis
      cols={3}
      items={[
        {
          label: "학원당 평균 공헌이익 (월)",
          value: F.wonMan(r.smoat.avgContrib),
          sub: `추천 요금제 구성으로 가중평균, 사용률 ${F.pct(v.usageRate as number)}`,
        },
        {
          label: "사업부 고정비 + 공통비 부담 (월)",
          value: F.man(b.total),
          sub: `고정비 ${F.man(b.fixed)} + 공통비 ${F.man(b.commonMonthly)} × ${F.pct(v.commonCostShareSmoat as number)}`,
        },
        {
          label: "손익분기 구독 학원 수",
          value: b.academies === null ? F.EMPTY : `${F.num(b.academies)}곳`,
          tone: "b",
          sub: r.sm ? `지금 결제 학원 ${r.sm.totals.academies}곳의 약 ${F.times(b.academies === null ? null : b.academies / Math.max(1, r.sm.totals.academies))}` : undefined,
        },
      ]}
    />
  );
}

function SmoatPrepay() {
  const { r, v } = useSd().model;
  return (
    <Table
      head={["요금제", "월 가격", `학기(6개월) 선결제`, "연간 선결제", "연간일 때 월 환산"]}
      align="lrrrr"
      size="sm"
      rows={r.smoat.prepay.map((p, i) => [
        `**${p.name}**`,
        F.won(r.smoat.tiers[i].price),
        F.won(p.semester),
        F.won(p.annual),
        F.won(p.annualPerMonth),
      ])}
      note={`학기 ${F.num(v.semesterFreeMonths as number)}개월 무료 (${F.ratio(r.smoat.prepay[0]?.semesterDiscount ?? null)} 할인), 연간 ${F.num(v.annualFreeMonths as number)}개월 무료 (${F.ratio(r.smoat.prepay[0]?.annualDiscount ?? null)} 할인) · 남은 크레딧 ${F.num(v.rolloverMonths as number)}개월 이월`}
    />
  );
}

// ---- B2B -------------------------------------------------------

function B2bScenarios({ web }: { web: boolean }) {
  const { r } = useSd().model;
  const b = r.b2b;
  const names = ["보수", "기본", "목표"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Table
        head={["시나리오", "월 추가 계약", "연 추가 매출", "연 추가 공헌이익"]}
        align="lrrr"
        rows={b.scenarios.map((s, i) => [
          `**${names[i] ?? ""}**`,
          `+${F.num(s.add, 1)}건 (월 ${F.num(b.current.deals + s.add, 1)}건)`,
          F.eok(s.annualRevenue),
          F.eok(s.annualContrib),
        ])}
        note={`건당 ${F.man(b.current.avg)} · 공헌이익률 ${F.pct(b.contrib, 1)} · 지금 월 ${F.num(b.current.deals, 1)}건`}
      />
      {web && (
        <Table
          head={["웹 견적발 소형 계약", "월 추가 계약", "연 추가 매출", "연 추가 공헌이익"]}
          align="lrrr"
          size="sm"
          rows={b.web.map((s, i) => [
            `${names[i] ?? ""} (건당 ${F.man(s.dealSize)})`,
            `+${F.num(s.add, 1)}건`,
            F.eok(s.annualRevenue),
            F.eok(s.annualContrib),
          ])}
        />
      )}
    </div>
  );
}

function B2bProducts() {
  const { r, v } = useSd().model;
  return (
    <Table
      head={["상품", "우리 시작가", "경쟁 시세", "우리의 이점", "직접비율", "예상 이익"]}
      align="lrllrr"
      widths={[0.95, 0.8, 2.15, 1.75, 0.6, 0.95]}
      size="sm"
      rows={r.b2b.products.map((p) => [
        `**${p.name}**`,
        `${F.man(p.startPrice)}부터`,
        p.market,
        p.edge,
        p.direct === null ? "견적" : F.pct(p.direct),
        p.profit === null ? "견적" : `${F.man(p.profit, 1)} (${F.ratio(p.profitRate)})`,
      ])}
      note={`예상 이익 = 시작가 × (1 − 상품별 직접비율 − 현장 인건비율 ${F.pct(v.b2bFieldLaborRate as number)}). 직접비율은 상품별 가정`}
    />
  );
}

function B2bProjects() {
  const { r } = useSd().model;
  const b = r.b2b;
  const fin = r.fin;
  return (
    <Table
      head={["프로젝트", "매출·계약", "직접비", "직접비율", "기준"]}
      align="lrrrl"
      widths={[1.4, 1, 1, 0.8, 0.8]}
      size="xs"
      rows={b.projects.map((p) => [p.name, F.wonMan(p.revenue), F.wonMan(p.direct), F.ratio(p.rate), p.basis])}
      note={`ERP 프로젝트 태그 지출(내부 인건비 제외) ÷ 매출·계약금액 · 가중평균 ${F.ratio(b.projectsRate, 1)} · ${fin ? `${F.dateLabel(fin.asOf)} 장부` : "스냅샷"}`}
    />
  );
}

// ---- 생카 ------------------------------------------------------

function SangkaT1() {
  const { r, v } = useSd().model;
  const s = r.sangka;
  return (
    <Kpis
      cols={3}
      items={[
        {
          label: "T1 면제 기대 비용 (월)",
          value: F.man(s.t1.total, 1),
          tone: "warn",
          sub: `미달 보전 ${F.man(s.t1.waiver, 1)} (${F.num(v.t1CountPerMonth as number, 1)}건 × ${F.pct(v.t1WaiverShortfallProb as number)} × 하루 ${F.man(v.t1AvgShortfall as number)} × ${F.num(v.eventDays as number)}일) + 특전 ${F.man(s.t1.perk, 1)}`,
        },
        {
          label: "외부 주최 증가분",
          value: `+${F.num(s.ext.add, 1)}건/월`,
          sub: `지금 ${F.num(s.ext.now, 1)}건 → 목표 ${F.num(s.ext.target, 1)}건 (월 ${F.num(v.eventsPerMonth as number)}건 중)`,
        },
        {
          label: "증가분 공헌이익 − T1 비용",
          value: s.ext.gain === null ? "입력 필요" : F.man(s.ext.net),
          tone: s.ext.net === null ? undefined : s.ext.net >= 0 ? "good" : "bad",
          sub: s.ext.gain === null ? "외부 이벤트 1건의 공헌이익을 가정 패널에 넣으면 계산된다" : `증가분 공헌이익 ${F.man(s.ext.gain)}`,
        },
      ]}
    />
  );
}

function SangkaFunnel() {
  const { r, v } = useSd().model;
  const f = r.sangka.funnel;
  return (
    <div className="sd-steps" data-box>
      {[
        { t: `DM ${F.num(f.dm)}건`, b: "월 발송 (하루 소량, 사람이 검수)" },
        { t: `응답 ${F.num(f.replies, 1)}건`, b: `응답률 ${F.pct(v.replyRate as number)}` },
        { t: `예약 ${F.num(f.bookings, 1)}건`, b: `예약 전환율 ${F.pct(v.bookRate as number)}` },
        { t: `목표 +${F.num(r.sangka.ext.add, 1)}건`, b: "외부 주최 증가 목표와 비교" },
      ].map((s, i) => (
        <div key={i} className="sd-step">
          <div className="sd-step-n">{String(i + 1).padStart(2, "0")}</div>
          <div className="sd-step-t">{s.t}</div>
          <div className="sd-step-b">{s.b}</div>
        </div>
      ))}
    </div>
  );
}

// ---- 운영 ------------------------------------------------------

function Approval() {
  const { r } = useSd().model;
  const lo = r.ops.approveLow;
  const hi = r.ops.approveHigh;
  return (
    <Table
      head={["금액", "누가 결정", "방식"]}
      align="lll"
      widths={[1, 1.3, 1.3]}
      rows={[
        [`${F.man(lo)} 이하`, "담당자", "쓰고 기록만 남김"],
        [`${F.man(lo)}~${F.man(hi)}`, "사업부 책임자 + 재무", "메신저로 당일 결정"],
        [`${F.man(hi)} 초과`, "임원 합의", "24시간 안에 결정"],
      ]}
      note={`사업부별 월 기회 예산 한도: ① ${r.ops.budget1 === null ? "입력 필요" : F.man(r.ops.budget1)} · ② ${r.ops.budget2 === null ? "입력 필요" : F.man(r.ops.budget2)}`}
    />
  );
}

function CommonCost() {
  const { r } = useSd().model;
  const o = r.ops;
  return (
    <Kpis
      cols={3}
      items={[
        { label: "공통비 월평균 (ERP 공용)", value: F.man(o.commonMonthly), sub: r.fin ? `${F.monthLabel(r.fin.cost.from, true)}~${F.monthLabel(r.fin.cost.to)} 평균` : "스냅샷" },
        { label: `② 스모트 부담 (${F.pct(o.smoatSharePct)})`, value: F.man(o.smoatCommon), tone: "b" },
        { label: "① 악센트+B2B 부담", value: F.man(o.unit1Common), tone: "a" },
      ]}
    />
  );
}

// ---- 매물 ------------------------------------------------------

function Photo({ p }: { p: DeckProperty }) {
  const url = useAsset(p.photo ?? null);
  return (
    <div className="sd-pcard-photo">
      {url ? <img src={url} alt="" /> : <div className="sd-nophoto">{url === null ? "사진 없음" : ""}</div>}
      <div className="sd-pcard-no">{p.no}</div>
    </div>
  );
}

function Tile({ id, left, top }: { id: string; left: number; top: number }) {
  const url = useAsset(id);
  return url ? <img src={url} alt="" style={{ left, top }} /> : null;
}

function PropertyRegion({ region }: { region: string }) {
  const { content } = useSd();
  const reg = content.regions.find((r) => r.id === region);
  const props = content.properties.filter((p) => p.region === region).sort((a, b) => a.no - b.no);
  const store = content.currentStore;
  const points = useMemo(
    () => [...props.map((p) => ({ lat: p.lat, lng: p.lng })), ...(reg?.includeStore ? [store] : [])],
    [props, reg?.includeStore, store],
  );
  if (!reg || props.length === 0) return null;
  const view = fitMap(points);
  const tiles = tilesFor(view);
  const pins = spreadPins([
    ...props.map((p) => ({ ...place(p, view), label: String(p.no), home: false, approx: !!p.approx })),
    ...(reg.includeStore ? [{ ...place(store, view), label: "현", home: true, approx: false }] : []),
  ]);
  const far = !reg.includeStore ? distanceM(store, props[0]) : 0;
  return (
    <div className="sd-prop">
      <div className="sd-map" style={{ width: MAP_W, height: MAP_H }} data-box>
        <div className="sd-map-tiles">
          {tiles.map((t) => (
            <Tile key={t.id} id={t.id} left={t.left} top={t.top} />
          ))}
        </div>
        <div className="sd-map-dim" />
        {pins.map((pin, i) => (
          <div
            key={i}
            className={`sd-pin${pin.home ? " sd-pin-home" : ""}${pin.approx ? " sd-pin-approx" : ""}`}
            style={{ left: pin.left, top: pin.top }}
          >
            <div className="sd-pin-dot">{pin.label}</div>
            <div className="sd-pin-stem" />
          </div>
        ))}
        <div className="sd-map-key">
          {reg.includeStore ? `현 = ${store.label}` : `지금 매장에서 약 ${F.num(far / 1000, 1)}km`}
          {props.some((p) => p.approx) && <div>점선 핀 = 위치 근사</div>}
        </div>
        <div className="sd-map-attr">© OpenStreetMap contributors</div>
      </div>
      <div className="sd-cards4">
        {props.map((p) => (
          <div key={p.id} className="sd-pcard" data-box>
            <Photo p={p} />
            <div className="sd-pcard-body">
              <div className="sd-pcard-loc">{p.location}</div>
              <div className="sd-pcard-meta">
                {p.layout}
                {p.walk ? ` · ${p.walk}` : ""}
              </div>
              <div className="sd-pcard-money">
                {p.money} <span style={{ fontWeight: 500, color: "var(--sd-fg3)" }}>만원</span>
              </div>
              <div className="sd-pcard-feat">{p.feature}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertyTable() {
  const { content } = useSd();
  const name = new Map(content.regions.map((r) => [r.id, r.name]));
  return (
    <Table
      head={["지역", "#", "위치", "구성", "보증금/월세 (월 고정)", "매물번호", "특징"]}
      align="lclllll"
      widths={[0.62, 0.22, 1.45, 1.75, 1.6, 1.45, 2.25]}
      size="xs"
      rows={content.properties.map((p) => [
        name.get(p.region) ?? p.region,
        p.no,
        p.location,
        p.layout,
        p.money,
        p.articleNos.join(", "),
        p.feature,
      ])}
    />
  );
}

// ---- 부록: 가정값 · 출처 -----------------------------------------

function AssumptionTable() {
  const { content, model } = useSd();
  const groups = ASSUMPTION_GROUPS.map((g) => ({ g, defs: content.assumptions.filter((d) => d.group === g) })).filter((x) => x.defs.length);
  // 묶음을 순서대로 네 칸에 나눠 담는다 — 칸 높이가 고르도록 줄 수로 가른다
  const N = 4;
  const cols: (typeof groups)[] = Array.from({ length: N }, () => []);
  const weight = (x: (typeof groups)[number]) => x.defs.length + 1.5;
  const per = groups.reduce((s, g) => s + weight(g), 0) / N;
  let ci = 0;
  let acc = 0;
  for (const g of groups) {
    if (acc > 0 && acc + weight(g) / 2 > per * (ci + 1) && ci < N - 1) ci += 1;
    cols[ci].push(g);
    acc += weight(g);
  }
  return (
    <div className="sd-cols" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`, gap: 18 }} data-box>
      {cols.map((col, ci) => (
        <div key={ci} className="sd-col" style={{ gap: 8 }}>
          {col.map(({ g, defs }) => (
            <div key={g}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sd-accent)", marginBottom: 2 }}>{g}</div>
              {defs.map((d) => {
                const m = model.meta[d.key];
                const val = model.v[d.key];
                const mark = m?.overridden ? "변경" : m?.origin === "erp" ? "ERP" : m?.origin === "snapshot" ? "스냅샷" : d.kind;
                return (
                  <div
                    key={d.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 6,
                      fontSize: 12,
                      lineHeight: 1.5,
                      borderBottom: "1px solid var(--sd-line2)",
                      color: m?.overridden ? "var(--sd-warn)" : "var(--sd-fg2)",
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
                    <span style={{ whiteSpace: "nowrap", fontWeight: 700, color: m?.overridden ? "var(--sd-warn)" : "var(--sd-fg)" }}>
                      {F.formatAssumption(val, d.unit)}
                      <span style={{ fontWeight: 600, color: "var(--sd-fg4)", marginLeft: 5, fontSize: 11 }}>{mark}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SourceList() {
  const { content } = useSd();
  return (
    <div className="sd-table-wrap" data-box style={{ fontSize: 13.5, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 5 }}>
      {content.sources.map((s) => (
        <div key={s.id} style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: 6 }}>
          <b style={{ color: "var(--sd-accent)" }}>[{s.id}]</b>
          <div style={{ minWidth: 0 }}>
            <span style={{ color: "var(--sd-fg)" }}>{s.label}</span>
            {s.url && <span style={{ color: "var(--sd-fg3)", overflowWrap: "anywhere" }}> : {decodeSafe(s.url)}</span>}
            {s.checked && <span style={{ color: "var(--sd-fg4)" }}> ({s.checked})</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 캡처 몇 장 — 사진처럼 로그인 fetch 로 받는다 */
function Gallery({ items }: { items: { asset: string; caption: string }[] }) {
  if (items.length === 0) {
    return <div className="sd-callout sd-tone-muted">캡처가 아직 올라가 있지 않습니다.</div>;
  }
  return (
    <div
      className="sd-cols"
      // 마지막 캡처(세로로 긴 표지 등)는 좁게 — 앞의 화면 캡처가 크게 보이도록
      style={{
        gridTemplateColumns: items.map((_, i) => (items.length > 2 && i === items.length - 1 ? "minmax(0, .7fr)" : "minmax(0, 1fr)")).join(" "),
        gap: 18,
        alignItems: "start",
      }}
      data-box
    >
      {items.map((it) => (
        <GalleryItem key={it.asset} asset={it.asset} caption={it.caption} />
      ))}
    </div>
  );
}

function GalleryItem({ asset, caption }: { asset: string; caption: string }) {
  const url = useAsset(asset);
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div
        style={{
          borderRadius: 12,
          border: "1px solid var(--sd-line)",
          background: "var(--sd-panel)",
          overflow: "hidden",
          minHeight: url ? undefined : 200,
          display: "flex",
        }}
      >
        {url ? (
          <img src={url} alt={caption} style={{ width: "100%", height: "auto", display: "block" }} />
        ) : (
          <span style={{ margin: "auto", color: "var(--sd-fg3)", fontSize: 14 }}>{url === null ? "캡처 없음" : ""}</span>
        )}
      </div>
      <figcaption style={{ fontSize: 14, color: "var(--sd-fg2)" }}>
        <Md text={caption} />
      </figcaption>
    </figure>
  );
}

const decodeSafe = (u: string) => {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
};
