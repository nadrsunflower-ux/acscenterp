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

import * as F from "@/lib/neander/decks/format";
import { ASSUMPTION_GROUPS } from "@/lib/neander/decks/types";
import { Md, academyLabeler, useSd } from "./context";
import { shown } from "./fields";
import { PropertyCards, PropertyOverview, PropertyTable, useAsset } from "./property";
import * as V from "./viz";

type Opts = Record<string, unknown>;

export function Computed({ kind, opts }: { kind: string; opts: Opts }) {
  switch (kind) {
    case "engines":
      return <V.Engines opts={opts} />;
    case "relocTimeline":
      return <V.RelocTimeline opts={opts} />;
    case "relocPayback":
      return <RelocPayback />;
    case "revenueMix":
      return <V.RevenueMix />;
    case "cashWaterfall":
      return <V.CashWaterfall />;
    case "basisCompare":
      return <V.BasisCompare />;
    case "runwayKpi":
      return <V.RunwayKpi />;
    case "smoatMonthly":
      return <V.SmoatMonthly />;
    case "freeDonut":
      return <V.FreeDonut />;
    case "marginPair":
      return <V.MarginPair opts={opts} />;
    case "matrix2x2":
      return <V.Matrix2x2 opts={opts} />;
    case "b2bMonthly":
      return <V.B2bMonthly />;
    case "tierPyramid":
      return <V.TierPyramid opts={opts} />;
    case "dmFunnel":
      return <V.DmFunnel />;
    case "sangkaT1":
      return <SangkaT1 />;
    case "priceRange":
      return <V.PriceRange />;
    case "projectBars":
      return <V.ProjectBars />;
    case "contribBadge":
      return <V.ContribBadge />;
    case "scenarioBars":
      return <V.ScenarioBars opts={opts} />;
    case "leverWaterfall":
      return <V.LeverWaterfall />;
    case "scaleCurves":
      return <V.ScaleCurves opts={opts} />;
    case "optionBars":
      return <V.OptionBars opts={opts} />;
    case "bandBars":
      return <V.BandBars />;
    case "perQuestionCompare":
      return <V.PerQuestionCompare opts={opts} />;
    case "priceLadder":
      return <V.PriceLadder opts={opts} />;
    case "academyDumbbell":
      return <V.AcademyDumbbell />;
    case "tierStack":
      return <V.TierStack />;
    case "subscriptionCompare":
      return <V.SubscriptionCompare />;
    case "churnLine":
      return <V.ChurnLine />;
    case "breakevenProgress":
      return <V.BreakevenProgress />;
    case "smoatPrepay":
      return <SmoatPrepay />;
    case "commonCostBar":
      return <V.CommonCostBar />;
    case "seasonHeatmap":
      return <V.SeasonHeatmap opts={opts} />;
    case "decisionFlow":
      return <V.DecisionFlow />;
    case "gantt":
      return <V.Gantt opts={opts} />;
    case "scoreboard":
      return <V.Scoreboard opts={opts} />;
    case "propertyOverview":
      return <PropertyOverview opts={opts} />;
    case "propertyCards":
      return <PropertyCards opts={opts} />;
    case "propertyTable":
      return <PropertyTable opts={opts} />;
    case "academyTable":
      return <AcademyTable opts={opts} />;
    case "b2bProjects":
      return <B2bProjects />;
    case "smoatTiers":
      return <SmoatTiers />;
    case "assumptionTable":
      return <AssumptionTable opts={opts} />;
    case "sources":
      return <SourceList opts={opts} />;
    case "gallery":
      return <Gallery items={(opts.items as { asset: string; caption: string }[]) ?? []} />;
    default:
      return <div className="sd-callout sd-tone-bad">알 수 없는 계산 블록: {kind}</div>;
  }
}

/** 계산 블록 종류 — upload-deck 검사가 쓴다 */
export const COMPUTED_KINDS = [
  "engines", "relocTimeline", "relocPayback", "revenueMix", "cashWaterfall", "basisCompare", "runwayKpi",
  "smoatMonthly", "freeDonut", "marginPair", "matrix2x2", "b2bMonthly", "tierPyramid", "dmFunnel", "sangkaT1",
  "priceRange", "projectBars", "contribBadge", "scenarioBars", "leverWaterfall", "scaleCurves", "optionBars",
  "bandBars", "perQuestionCompare", "priceLadder", "academyDumbbell", "tierStack", "subscriptionCompare",
  "churnLine", "breakevenProgress", "smoatPrepay", "commonCostBar", "seasonHeatmap", "decisionFlow", "gantt",
  "scoreboard", "propertyOverview", "propertyCards", "propertyTable", "academyTable", "b2bProjects", "smoatTiers",
  "assumptionTable", "sources", "gallery",
];

// ---- 공용 ----------------------------------------------------

function Table({
  head,
  rows,
  align,
  widths,
  strong,
  note,
  hi,
}: {
  head: string[];
  rows: (string | number)[][];
  align?: string;
  widths?: number[];
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
      <table className="sd-table">
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
                  {isHi(r, c) ? (
                    <span className="sd-hl">
                      <Md text={String(cell)} />
                    </span>
                  ) : (
                    <Md text={String(cell)} />
                  )}
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
        <div key={i} className={`sd-kpi${k.tone ? ` sd-tone-${k.tone}` : ""}`} data-box>
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

// ---- 매장 이전 (부록 조합표) -----------------------------------------

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
        ...row.cells.map((c) => (c.months === null ? F.EMPTY : `${F.months(Math.round(c.months))} (약 ${F.num(c.months / 12, 1)}년)`)),
      ])}
      hi={minCell && maxCell ? [[minCell.ri, minCell.ci + 1], [maxCell.ri, maxCell.ci + 1]] : []}
    />
  );
}

// ---- 스모트 표 --------------------------------------------------

function SmoatTiers() {
  const { r, v } = useSd().model;
  const tiers = r.smoat.tiers;
  return (
    <Table
      head={["요금제", "월 가격", "매달 크레딧", "1C당", `사용률 ${F.pct(v.usageRate as number)} 이익률`]}
      align="lrrrr"
      rows={tiers.map((t) => [`**${t.name}**`, F.won(t.price), F.credits(t.credits), `${F.num(t.perCredit, 1)}원`, F.ratio(t.marginSet, 1)])}
    />
  );
}

/** 학원별 표 — 18곳을 두 장에 나눠 싣는다 (opts.from · opts.to, 0부터) */
function AcademyTable({ opts }: { opts: Opts }) {
  const sd = useSd();
  const { r } = sd.model;
  const label = academyLabeler(sd);
  const tiers = r.smoat.tiers;
  const from = typeof opts.from === "number" ? opts.from : 0;
  const to = typeof opts.to === "number" ? opts.to : r.smoat.academies.length;
  const list = r.smoat.academies.map((a, i) => ({ a, i })).slice(from, to);
  return (
    <Table
      head={["학원", "월 지출", "월 크레딧", "추천 요금제", "비용 변화"]}
      align="lrrlr"
      widths={[1.5, 1, 1, 1.1, 1]}
      rows={list.map(({ a, i }) => [
        `${label(a.name, i)} · ${a.payments}건`,
        F.won(a.monthlySpend),
        F.credits(Math.round(a.monthlyCredits)),
        `${tiers[a.compare.index]?.name ?? ""}${a.compare.over ? "+" : ""} ${F.won(a.compare.price)}`,
        a.compare.savingRate === null ? F.EMPTY : a.compare.savingRate >= 0 ? `-${F.ratio(a.compare.savingRate)}` : `+${F.ratio(-a.compare.savingRate)}`,
      ])}
      note={
        r.sm
          ? `내부·테스트 결제와 이름 없는 입금 제외 · 월 지출 = 결제 합계 ÷ 첫 결제 달부터 ${F.monthLabel(r.sm.baseMonth)}까지 개월 수 · 기준일 ${F.dateLabel(r.sm.asOf)}`
          : undefined
      }
    />
  );
}

function SmoatPrepay() {
  const { r, v } = useSd().model;
  return (
    <Table
      head={["요금제", "월 가격", "학기(6개월) 선결제", "연간 선결제", "연간 월 환산"]}
      align="lrrrr"
      rows={r.smoat.prepay.map((p, i) => [`**${p.name}**`, F.won(r.smoat.tiers[i].price), F.won(p.semester), F.won(p.annual), F.won(p.annualPerMonth)])}
      note={`학기 ${F.num(v.semesterFreeMonths as number)}개월 무료 (${F.ratio(r.smoat.prepay[0]?.semesterDiscount ?? null)} 할인), 연간 ${F.num(v.annualFreeMonths as number)}개월 무료 (${F.ratio(r.smoat.prepay[0]?.annualDiscount ?? null)} 할인) · 남은 크레딧 ${F.num(v.rolloverMonths as number)}개월 이월`}
    />
  );
}

// ---- B2B · 생카 --------------------------------------------------

function B2bProjects() {
  const { r } = useSd().model;
  const b = r.b2b;
  const fin = r.fin;
  return (
    <Table
      head={["프로젝트", "매출·계약", "직접비", "직접비율", "기준"]}
      align="lrrrl"
      widths={[1.5, 1, 1, 0.8, 0.8]}
      rows={b.projects.map((p) => [p.name, F.wonMan(p.revenue), F.wonMan(p.direct), F.ratio(p.rate), p.basis])}
      note={`ERP 프로젝트 태그 지출(내부 인건비 제외) ÷ 매출·계약금액 · 가중평균 ${F.ratio(b.projectsRate, 1)} · ${fin ? `${F.dateLabel(fin.asOf)} 장부` : "스냅샷"}`}
    />
  );
}

function SangkaT1() {
  const { r } = useSd().model;
  const s = r.sangka;
  return (
    <Kpis
      cols={2}
      items={[
        { label: "T1 면제 기대 비용 (월)", value: F.man(s.t1.total, 1), tone: "warn", sub: `미달 보전 ${F.man(s.t1.waiver, 1)} + 특전 ${F.man(s.t1.perk, 1)}` },
        {
          label: `외부 +${F.num(s.ext.add, 1)}건 효과 (월)`,
          value: s.ext.gain === null ? "입력 필요" : F.man(s.ext.net),
          tone: s.ext.net === null ? undefined : s.ext.net >= 0 ? "good" : "bad",
          sub: s.ext.gain === null ? "외부 1건 공헌이익을 넣으면 계산" : `증가분 공헌이익 ${F.man(s.ext.gain)} − T1 비용`,
        },
      ]}
    />
  );
}

// ---- 부록: 가정값 · 출처 · 캡처 -----------------------------------------

/**
 * 가정값 전체 — 세 칸씩, 여러 장에 나눠 싣는다 (opts.part 번째 / opts.parts 장).
 * 인쇄본 마지막 장은 opts.dense 로 한 장에 다 싣는다(작은 글씨, 인쇄 전용).
 */
function AssumptionTable({ opts }: { opts: Opts }) {
  const { content, model } = useSd();
  const dense = opts.dense === true;
  const parts = typeof opts.parts === "number" ? opts.parts : 1;
  const part = typeof opts.part === "number" ? opts.part : 1;
  const N = dense ? 4 : 3;
  // 묶음 머리 + 값 줄을 한 줄로 펴고, 장 수 × 칸 수로 고르게 나눈다
  type Line = { head: string } | { key: string };
  const lines: Line[] = ASSUMPTION_GROUPS.flatMap((g) => {
    const defs = content.assumptions.filter((d) => d.group === g);
    return defs.length ? [{ head: g } as Line, ...defs.map((d) => ({ key: d.key }) as Line)] : [];
  });
  const perPage = Math.ceil(lines.length / parts);
  const page = lines.slice((part - 1) * perPage, part * perPage);
  const perCol = Math.ceil(page.length / N);
  const cols = Array.from({ length: N }, (_, i) => page.slice(i * perCol, (i + 1) * perCol));
  const defs = new Map(content.assumptions.map((d) => [d.key, d]));
  return (
    <div className="sd-cols" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`, gap: 26 }} data-box>
      {cols.map((col, ci) => (
        <div key={ci} className="sd-col" style={{ gap: 0 }}>
          {col.map((ln, li) => {
            if ("head" in ln) {
              return (
                <div key={`h${li}`} className="sd-agroup" style={dense ? { fontSize: 12 } : undefined}>
                  {ln.head}
                </div>
              );
            }
            const d = defs.get(ln.key)!;
            const m = model.meta[d.key];
            const mark = m?.overridden ? "변경" : m?.note ? "확인" : m?.origin === "erp" ? "ERP" : m?.origin === "snapshot" ? "스냅샷" : d.kind;
            return (
              <div key={d.key} className={`sd-arow${m?.overridden ? " sd-changed" : ""}`} style={dense ? { fontSize: 11.5 } : undefined} title={d.label}>
                <span>{d.short ?? d.label}</span>
                <span>
                  {shown(d, model.v[d.key])}
                  <span className="sd-amark" style={dense ? { fontSize: 10 } : undefined}>
                    {mark}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SourceList({ opts }: { opts: Opts }) {
  const { content } = useSd();
  const from = typeof opts.from === "number" ? opts.from : 1;
  const to = typeof opts.to === "number" ? opts.to : Infinity;
  const list = content.sources.filter((s) => s.id >= from && s.id <= to);
  return (
    <div data-box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {list.map((s) => (
        <div key={s.id} className="sd-src-row">
          <b style={{ color: "var(--sd-accent)" }}>[{s.id}]</b>
          <div style={{ minWidth: 0 }}>
            <span style={{ color: "var(--sd-fg)" }}>{s.label}</span>
            {s.url && <span style={{ color: "var(--sd-fg3)", overflowWrap: "anywhere" }}> : {decodeSafe(s.url)}</span>}
            {s.checked && <span style={{ color: "var(--sd-fg3)" }}> ({s.checked})</span>}
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
          maxHeight: 440,
          display: "flex",
        }}
      >
        {url ? (
          <img src={url} alt={caption} style={{ width: "100%", height: "auto", display: "block", objectFit: "cover", objectPosition: "top" }} />
        ) : (
          <span className="sd-lbl-s" style={{ margin: "auto" }}>
            {url === null ? "캡처 없음" : ""}
          </span>
        )}
      </div>
      <figcaption className="sd-lbl">
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
