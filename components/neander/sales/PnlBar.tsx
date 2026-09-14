"use client";

// ============================================================
//  손익 막대 — 매출 줄 · 비용 줄 두 줄
// ------------------------------------------------------------
//  한 줄에 비용과 영업이익을 겹쳐 쌓으면 **손실이 보이지 않는다** —
//  비용이 매출보다 길어지는 순간 막대가 잘리거나 비율이 눌린다.
//  두 줄로 나누면 비용 줄이 매출 줄보다 길게 뻗은 만큼이 손실이고,
//  각 비용 갈래의 폭은 금액에 정비례한 채로 남는다.
//
//  인건비는 한 칸이다 — 이벤트·제작 인건비와 상시 인건비(고정비)를 막대에서는
//  묶고, 칸을 눌러 창을 열어야 둘로 나뉘어 보인다 (2026-09-15 사용자 결정).
//
//  칸마다 내역을 볼 수 있다 (detailOf 를 넘길 때):
//    커서를 두면   → 그 자리에 요약 판 (상위 다섯 줄 + 합계) — 그래프 팝오버와 같은 판
//    누르면·Enter → 창으로 전체 내역
//  「재료비 58만원」만으로는 무엇을 줄여야 할지 모른다. 어느 상품·이벤트·
//  항목에서 왔는지가 막대 바로 위에서 보여야 한다. 내역 계산은
//  lib/neander/sales/pnl-detail.ts 가 buildPnl 과 같은 규칙으로 한다.
// ============================================================

import { useMemo, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  ChartTooltip,
  cn,
  Dialog,
  Money,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  type ChartTooltipRow,
} from "@/components/neander/ui";
import type {
  PnlDetail,
  PnlDetailRow,
  PnlDetailSection,
  PnlSegmentKey,
} from "@/lib/neander/sales/pnl-detail";
import { COST_LEGEND, COST_SERIES, HATCH, PNL_BAR } from "./series";

/** 손익 막대 범례 항목 — 표시 순서 그대로 */
export const PNL_BAR_LEGEND: { key: string; label: string; color?: string; hatch?: boolean }[] = [
  { key: "confirmed", label: "확정 매출", color: PNL_BAR.confirmed },
  { key: "pending", label: "미확정", hatch: true },
  ...COST_LEGEND.map((c) => ({ key: c.key, label: c.label, color: c.color })),
  { key: "fixed", label: "배부 고정비", color: COST_SERIES.fixed },
  { key: "op", label: "영업이익", color: COST_SERIES.contribution },
  { key: "loss", label: "손실", color: PNL_BAR.loss },
];

export function PnlBarLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {PNL_BAR_LEGEND.map((i) => (
        <span key={i.key} className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={i.hatch ? { backgroundImage: HATCH } : { backgroundColor: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** 손익 막대 한 매장분 — 집계(StorePnl)에서 그대로 뽑는다. 화면이 다시 계산하지 않는다 */
export interface PnlBarInput {
  revenue: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  material: number;
  labor: number;
  supplies: number;
  fee: number;
  /** 배부 고정비 (상시 인건비 제외) */
  fixed: number;
  /**
   * 상시 인건비 — 고정비의 일부지만 막대에서는 「인건비」 칸에 합쳐 그린다.
   * 회색 고정비에 섞으면 아이디만 인건비가 거의 없는 것처럼 보인다.
   * 둘로 나눈 모습은 인건비 칸의 상세 창에서 본다.
   */
  regularLabor?: number;
  operating: number;
}

/** 이 매장 막대가 차지하는 길이 — 매출과 비용 중 긴 쪽 (손실이면 비용이 더 길다) */
export function pnlBarExtent(v: PnlBarInput): number {
  const costs = v.material + v.labor + v.supplies + v.fee + (v.regularLabor ?? 0) + v.fixed;
  return Math.max(v.revenue, costs + Math.max(0, v.operating));
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const num = (r: PnlDetailRow) => `${r.sign === "minus" ? "−" : ""}${Math.round(r.value).toLocaleString("ko-KR")}`;
/** 커서 판에 보일 줄 수 — 넘치면 「외 N개」로 묶는다 */
const TOOLTIP_HEAD = 5;
/** 칸을 누를 수 있을 때의 모습 — 살짝 밝아지고, 키보드로 오면 테두리 */
const HIT_CLS =
  "cursor-pointer outline-none transition-[filter] duration-nd-fast hover:brightness-110 focus-visible:brightness-110 focus-visible:ring-2 focus-visible:ring-nd-accent focus-visible:ring-offset-1";

/** 영업이익·손실은 계산 과정이라 줄을 자르지 않는다 */
const isFormula = (d: PnlDetail) => d.key === "op" || d.key === "loss";

function tooltipRows(d: PnlDetail): ChartTooltipRow[] {
  // 묶음이 있는 칸(인건비)은 커서 요약에 합계만 — 나눠 보는 건 창에서
  if (d.sections) {
    return [
      { key: "__hint", label: "누르면 나눠 봅니다", value: "" },
      { key: "__total", label: "합계", value: Math.round(d.total).toLocaleString("ko-KR"), total: true },
    ];
  }
  const head = isFormula(d) ? d.rows : d.rows.slice(0, TOOLTIP_HEAD);
  const rest = d.rows.slice(head.length);
  const rows: ChartTooltipRow[] = head.map((r) => ({
    key: r.key,
    label: r.label,
    value: num(r),
    negative: r.sign === "minus",
  }));
  if (rest.length > 0) {
    rows.push({
      key: "__rest",
      label: `외 ${rest.length}개`,
      value: Math.round(rest.reduce((s, r) => s + r.value, 0)).toLocaleString("ko-KR"),
    });
  }
  rows.push({
    key: "__total",
    label: isFormula(d) ? `= ${d.title}` : "합계",
    value: Math.round(d.total).toLocaleString("ko-KR"),
    total: true,
    negative: d.total < 0,
  });
  return rows;
}

/**
 * 손익 막대 — 매출 줄과 비용 줄, 두 줄을 같은 축에 놓는다.
 *
 *   매출 줄  [ 확정 매출 ▒▒미확정 ]
 *   비용 줄  [ 재료 | 인건 | 준비물 | 수수료 | 고정비 | 영업이익 ]
 *
 * 미확정은 원가를 모르니 손익으로 쪼갤 수 없다 — 매출 줄에 빗금으로만 둔다.
 * 분모가 0(매출도 비용도 없음)이면 막대 대신 「데이터 없음」 을 쓴다.
 */
export function PnlBar({
  value: v,
  scale,
  label,
  detailOf,
  caption,
}: {
  value: PnlBarInput;
  /** 축의 최대값 — 매장들의 pnlBarExtent 중 최댓값 */
  scale: number;
  /** 낭독기용 이름 (매장) */
  label: string;
  /** 칸의 내역 — 주면 커서 요약·클릭 창이 켜진다 */
  detailOf?: (key: PnlSegmentKey) => PnlDetail;
  /** 창 머리글에 붙는 말 (예: 2026년 8월) */
  caption?: string;
}) {
  const [hover, setHover] = useState<{ key: PnlSegmentKey; x: number; y: number } | null>(null);
  const [openKey, setOpenKey] = useState<PnlSegmentKey | null>(null);
  // 내역은 칸이 바뀔 때만 다시 센다 — 커서가 움직일 때마다 판매 줄을 훑지 않게
  const hoverKey = hover?.key ?? null;
  const hoverDetail = useMemo(
    () => (hoverKey && detailOf ? detailOf(hoverKey) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hoverKey, v],
  );
  const openDetail = useMemo(
    () => (openKey && detailOf ? detailOf(openKey) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openKey, v],
  );

  const costs = v.material + v.labor + v.supplies + v.fee + (v.regularLabor ?? 0) + v.fixed;
  const extent = pnlBarExtent(v);
  if (extent <= 0) {
    return (
      <div className="flex h-[38px] items-center text-nd-caption text-nd-fg-3" role="img" aria-label={`${label}: 데이터 없음`}>
        데이터 없음
      </div>
    );
  }
  const widthPct = scale > 0 ? Math.min(100, (extent / scale) * 100) : 100;
  const w = (n: number) => `${Math.max(0, (n / extent) * 100)}%`;
  const loss = v.operating < 0 ? -v.operating : 0;
  const costSegs: { key: PnlSegmentKey; label: string; value: number; color: string }[] = [
    { key: "material", label: "재료비", value: v.material, color: COST_SERIES.material },
    // 인건비 = 이벤트·제작 인건비 + 상시 인건비 — 창을 열어야 둘로 나뉜다
    { key: "labor", label: "인건비", value: v.labor + (v.regularLabor ?? 0), color: COST_SERIES.labor },
    { key: "supplies", label: "준비물", value: v.supplies, color: COST_SERIES.supplies },
    { key: "fee", label: "수수료", value: v.fee, color: COST_SERIES.fee },
    { key: "fixed", label: "배부 고정비", value: v.fixed, color: COST_SERIES.fixed },
    { key: "op", label: "영업이익", value: Math.max(0, v.operating), color: COST_SERIES.contribution },
  ];
  const interactive = !!detailOf;

  /** 칸 하나의 손놀림 — 커서 요약 · 클릭/Enter 창. detailOf 가 없으면 예전처럼 title 만 */
  const hit = (key: PnlSegmentKey, name: string, amount: number) =>
    interactive
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `${label} ${name} ${won(amount)} — 내역 보기`,
          onMouseEnter: (e: MouseEvent<HTMLElement>) => setHover({ key, x: e.clientX, y: e.clientY }),
          onMouseMove: (e: MouseEvent<HTMLElement>) => setHover({ key, x: e.clientX, y: e.clientY }),
          onMouseLeave: () => setHover(null),
          onFocus: (e: FocusEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover({ key, x: r.left + r.width / 2, y: r.top });
          },
          onBlur: () => setHover(null),
          onClick: () => {
            setHover(null);
            setOpenKey(key);
          },
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setHover(null);
              setOpenKey(key);
            }
          },
        }
      : { title: `${name} ${won(amount)}` };

  const aria = [
    `${label}: 총매출 ${won(v.revenue)}`,
    `확정 ${won(v.confirmedRevenue)}`,
    v.pendingRevenue > 0 ? `미확정 ${won(v.pendingRevenue)}` : null,
    ...costSegs.filter((s) => s.value > 0).map((s) => `${s.label} ${won(s.value)}`),
    loss > 0 ? `손실 ${won(loss)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="w-full" role={interactive ? "group" : "img"} aria-label={aria}>
      <div className="relative flex flex-col gap-1" style={{ width: `${widthPct}%` }}>
        {/* 매출 줄 */}
        <div className="flex h-4 overflow-hidden rounded-[3px] bg-nd-sunken">
          {v.confirmedRevenue > 0 && (
            <div
              className={cn("h-full", interactive && HIT_CLS)}
              style={{ width: w(v.confirmedRevenue), backgroundColor: PNL_BAR.confirmed }}
              {...hit("confirmed", "확정 매출", v.confirmedRevenue)}
            />
          )}
          {v.pendingRevenue > 0 && (
            <div
              className={cn("h-full", interactive && HIT_CLS)}
              style={{ width: w(v.pendingRevenue), backgroundImage: HATCH }}
              {...hit("pending", "미확정", v.pendingRevenue)}
            />
          )}
        </div>
        {/* 비용 줄 — 매출보다 길면 그 초과분이 손실 */}
        <div className="flex h-4 overflow-hidden rounded-[3px] bg-nd-sunken">
          {costSegs
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                className={cn("h-full", interactive && HIT_CLS)}
                style={{ width: w(s.value), backgroundColor: s.color }}
                {...hit(s.key, s.label, s.value)}
              />
            ))}
        </div>
        {/* 확정 매출이 끝나는 자리 — 비용 줄이 이 선을 넘으면 손실 */}
        {v.confirmedRevenue > 0 && costs > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-nd-fg/60"
            style={{ left: w(v.confirmedRevenue) }}
          />
        )}
        {/* 손실 테두리 — 누르면 손실이 어떻게 났는지 (영업이익 계산) */}
        {loss > 0 && (
          <span
            aria-hidden={!interactive}
            className={cn(
              "absolute bottom-0 h-4 rounded-r-[3px] border-y-2 border-r-2",
              interactive ? HIT_CLS : "pointer-events-none",
            )}
            style={{ left: w(v.confirmedRevenue), width: w(loss), borderColor: PNL_BAR.loss }}
            {...(interactive ? hit("loss", "손실", loss) : {})}
          />
        )}
      </div>

      {hover && hoverDetail && (
        <ChartTooltip
          at={{ x: hover.x, y: hover.y }}
          title={`${label} · ${hoverDetail.title}`}
          rows={tooltipRows(hoverDetail)}
        />
      )}

      {openDetail && (
        <Dialog
          open
          onClose={() => setOpenKey(null)}
          size="md"
          title={`${label} · ${openDetail.title}`}
          description={[caption, openDetail.basis].filter(Boolean).join(" · ")}
        >
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-nd-caption text-nd-fg-2">
              {isFormula(openDetail) ? openDetail.title : "합계"}
            </span>
            <span
              className={cn(
                "nd-num text-nd-section font-semibold",
                openDetail.total < 0 ? "text-nd-danger-text" : "text-nd-fg",
              )}
            >
              <Money value={Math.round(openDetail.total)} unit={false} />원
            </span>
          </div>

          {blocksOf(openDetail).map((b) => (
            <DetailBlock key={b.key} detail={openDetail} block={b} titled={!!openDetail.sections} />
          ))}

          {openDetail.note && <p className="mt-3 text-nd-caption text-nd-fg-3">{openDetail.note}</p>}
        </Dialog>
      )}
    </div>
  );
}

/** 창에 그릴 묶음 — 묶음이 없는 칸은 전체를 한 묶음으로 */
function blocksOf(d: PnlDetail): PnlDetailSection[] {
  return (
    d.sections ?? [{ key: "main", title: d.title, total: d.total, rows: d.rows, people: d.people }]
  );
}

/** 묶음 하나 — 소계 머리(묶음이 여럿일 때) · 내역 표 · 직원별 표 */
function DetailBlock({
  detail: d,
  block: b,
  titled,
}: {
  detail: PnlDetail;
  block: PnlDetailSection;
  titled: boolean;
}) {
  const formula = isFormula(d);
  // 비중은 칸 전체 합계 대비 — 묶음 두 개의 비중을 더하면 100%
  const shareOf = (r: PnlDetailRow) =>
    !formula && d.total ? `${((r.value / d.total) * 100).toFixed(1)}%` : "";
  return (
    <section className={cn(titled && "mt-4 first:mt-0")}>
      {titled && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-nd-line pb-1.5">
          <span className="min-w-0">
            <span className="text-nd-body font-semibold text-nd-fg">{b.title}</span>
            {b.basis && <span className="ml-2 text-nd-micro text-nd-fg-3">{b.basis}</span>}
          </span>
          <span className="nd-num text-nd-body font-semibold text-nd-fg">
            <Money value={Math.round(b.total)} unit={false} />원
            {d.total ? (
              <span className="ml-1.5 text-nd-micro font-normal text-nd-fg-3">
                {((b.total / d.total) * 100).toFixed(1)}%
              </span>
            ) : null}
          </span>
        </div>
      )}
      {b.rows.length === 0 ? (
        <p className="py-4 text-center text-nd-caption text-nd-fg-3">이 달에는 내역이 없습니다.</p>
      ) : (
        <TableScroll maxHeight={titled ? 260 : 420}>
          <Table dense minWidth={360}>
            <thead>
              <tr>
                <Th sticky="top">{formula ? "계산" : "항목"}</Th>
                <Th sticky="top" align="right">금액</Th>
                {!formula && (
                  <Th sticky="top" align="right">비중</Th>
                )}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <Tr key={r.key}>
                  <Td>
                    <span className="block text-nd-body text-nd-fg">{r.label}</span>
                    {r.sub && <span className="block text-nd-micro text-nd-fg-3">{r.sub}</span>}
                  </Td>
                  <Td num className={r.sign === "minus" ? "text-nd-fg-2" : undefined}>
                    {num(r)}
                  </Td>
                  {!formula && (
                    <Td num className="text-nd-fg-3">
                      {shareOf(r)}
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      {b.people && b.people.length > 0 && (
        <>
          <p className="mb-1.5 mt-3 text-nd-caption font-semibold text-nd-fg-2">직원별</p>
          <TableScroll maxHeight={200}>
            <Table dense minWidth={360}>
              <tbody>
                {b.people.map((r) => (
                  <Tr key={r.key}>
                    <Td>
                      <span className="block text-nd-body text-nd-fg">{r.label}</span>
                      {r.sub && <span className="block text-nd-micro text-nd-fg-3">{r.sub}</span>}
                    </Td>
                    <Td num>{num(r)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </>
      )}
      {b.note && <p className="mt-2 text-nd-caption text-nd-fg-3">{b.note}</p>}
    </section>
  );
}
