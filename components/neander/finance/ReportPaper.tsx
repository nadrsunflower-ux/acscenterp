"use client";

// ============================================================
//  보고서 종이 — A4 한 장씩 나눠 보여 주고, 인쇄도 그 모양 그대로
// ------------------------------------------------------------
//  「A4 용지를 가정하고 잘 나눠지게 페이지별로」(2026-10-19 사용자 요청).
//  브라우저 인쇄에 쪽 나눔을 맡기면 화면에서는 한 장짜리 긴 종이로 보이고,
//  인쇄하면 표가 아무 데서나 끊긴다. 그래서 쪽을 우리가 나눈다.
//
//    1) 화면 밖 「재는 칸」 에 블록을 실제 너비로 그려 높이를 잰다.
//       쪼갤 수 있는 블록(표 · 글)은 줄마다 잰다.
//    2) A4 한 장 높이(여백 · 머리말 · 꼬리말을 뺀 것)에 맞춰 채운다.
//       - 1쪽은 요약. 가로 용지는 두 단(왼쪽 · 오른쪽 단을 블록이 고른다).
//         넘치는 블록은 2쪽으로 간다.
//       - 2쪽부터는 근거 자료. 표가 넘치면 그 줄에서 끊고 다음 쪽에
//         「(계속)」 제목과 머리글을 다시 단다. 제목만 쪽 끝에 홀로 남지
//         않게, 첫 두 줄이 들어갈 자리가 없으면 통째로 다음 쪽으로 넘긴다.
//       - 쪽이 갈려도 열 폭이 같게, 재는 칸의 열 폭을 그대로 쓴다.
//    3) 종이는 실제 mm 크기로 그린다. 인쇄는 @page 여백 0 에 종이 한 장 =
//       인쇄 한 장이라, 화면에 보인 쪽 나눔과 쪽 번호가 그대로 나온다.
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/neander/ui";

export type Orient = "portrait" | "landscape";

/** A4 (mm) */
const SIZE: Record<Orient, { w: number; h: number }> = {
  portrait: { w: 210, h: 297 },
  landscape: { w: 297, h: 210 },
};
/** 종이 여백 (mm) — 예전 @page 여백과 같다 */
const MARGIN = { y: 12, x: 11 };
/** 블록 사이 (px) */
const GAP = 16;
/** 두 단 사이 (px) */
const COL_GAP = 24;
/** 가로 용지 1쪽의 두 단 비율 */
const COL_RATIO = [3, 2] as const;
/** 반올림 오차로 마지막 줄이 잘리지 않게 남겨 두는 여유 (px) */
const SLACK = 4;
const PX_PER_MM = 96 / 25.4;

/** 1쪽 요약 블록 — 가로 용지에서 어느 단에 둘지 */
export interface SummaryBlock {
  key: string;
  node: ReactNode;
  column: 0 | 1;
}

/**
 * 근거 자료 블록. rows 가 있으면 줄 단위로 쪼갤 수 있다 — render 가 그린 것 안에서
 * 줄은 `data-pg="row"`, 합계 줄은 `data-pg="foot"` 을 달아야 잴 수 있다 (RTable 이 단다).
 */
export interface DetailBlock {
  key: string;
  node?: ReactNode;
  rows?: {
    count: number;
    render: (from: number, to: number, cont: boolean, colWidths?: number[]) => ReactNode;
  };
}

type Slice =
  | { kind: "node"; key: string; node: ReactNode }
  | { kind: "rows"; key: string; block: DetailBlock; from: number; to: number; cont: boolean; widths?: number[] };

interface Layout {
  /** 1쪽 — 단마다 블록 key */
  first: string[][];
  /** 2쪽부터 */
  rest: Slice[][];
}

interface Measured {
  total: number;
  rows?: number[];
  foot?: number;
  head?: number;
  widths?: number[];
}

export function ReportPaper({
  orient,
  version,
  first,
  runningHead,
  footLeft,
  summary,
  detail,
}: {
  orient: Orient;
  /** 내용이 바뀌면 바뀌는 값 — 다시 잰다 */
  version: string;
  /** 1쪽 머리 (제목 · 판정) */
  first: ReactNode;
  /** 2쪽부터의 머리말 */
  runningHead: ReactNode;
  footLeft: ReactNode;
  summary: SummaryBlock[];
  detail: DetailBlock[];
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [fontTick, setFontTick] = useState(0);
  const size = SIZE[orient];
  const wide = orient === "landscape";
  const contentW = (size.w - MARGIN.x * 2) * PX_PER_MM;
  const colW = [
    ((contentW - COL_GAP) * COL_RATIO[0]) / (COL_RATIO[0] + COL_RATIO[1]),
    ((contentW - COL_GAP) * COL_RATIO[1]) / (COL_RATIO[0] + COL_RATIO[1]),
  ];

  // 글꼴이 늦게 뜨면 높이가 달라진다 — 다 뜬 뒤 한 번 더 잰다
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontTick((t) => t + 1));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const h = (el: Element | null) => (el ? el.getBoundingClientRect().height : 0);
    const pick = (m: string, key?: string) =>
      root.querySelector(key === undefined ? `[data-m="${m}"]` : `[data-m="${m}"][data-k="${key}"]`);

    const firstH = h(pick("first"));
    const runH = h(pick("run"));
    const footH = h(pick("foot"));
    const pageBody = size.h * PX_PER_MM - MARGIN.y * 2 * PX_PER_MM - footH - SLACK;
    const firstBody = pageBody - firstH;
    const restBody = pageBody - runH;

    const sumH = new Map(summary.map((b) => [b.key, h(pick("sum", b.key))]));
    const det = new Map<string, Measured>(
      detail.map((b) => {
        const el = pick("det", b.key);
        const total = h(el);
        if (!b.rows || !el) return [b.key, { total }];
        const rows = [...el.querySelectorAll('[data-pg="row"]')].map(h);
        const foot = h(el.querySelector('[data-pg="foot"]'));
        const widths = [...el.querySelectorAll("thead th")].map((th) => th.getBoundingClientRect().width);
        const head = total - rows.reduce((a, b) => a + b, 0) - foot;
        return [b.key, { total, rows, foot, head, widths: widths.length ? widths : undefined }];
      }),
    );

    // ---- 1쪽 ----
    const cols = wide ? 2 : 1;
    const firstCols: string[][] = Array.from({ length: cols }, () => []);
    const used = Array.from({ length: cols }, () => 0);
    const closed = Array.from({ length: cols }, () => false);
    const overflow: DetailBlock[] = [];
    for (const b of summary) {
      const c = wide ? b.column : 0;
      const need = (used[c] > 0 ? GAP : 0) + (sumH.get(b.key) ?? 0);
      if (!closed[c] && used[c] + need <= firstBody) {
        firstCols[c].push(b.key);
        used[c] += need;
      } else {
        // 한 블록이 넘치면 그 단의 뒤 블록도 순서를 지켜 2쪽으로
        closed[c] = true;
        overflow.push({ key: b.key, node: b.node });
        det.set(b.key, { total: sumH.get(b.key) ?? 0 });
      }
    }

    // ---- 2쪽부터 ----
    const rest: Slice[][] = [];
    let page: Slice[] = [];
    let fill = 0;
    const turn = () => {
      if (page.length) rest.push(page);
      page = [];
      fill = 0;
    };
    for (const b of [...overflow, ...detail]) {
      const m = det.get(b.key) ?? { total: 0 };
      if (!b.rows || !m.rows) {
        const need = (fill > 0 ? GAP : 0) + m.total;
        if (fill > 0 && fill + need > restBody) turn();
        page.push({ kind: "node", key: b.key, node: b.node });
        fill += (fill > 0 ? GAP : 0) + m.total;
        continue;
      }
      const rows = m.rows;
      const n = rows.length;
      const head = m.head ?? 0;
      const foot = m.foot ?? 0;
      let i = 0;
      let cont = false;
      do {
        const gap = fill > 0 ? GAP : 0;
        const avail = restBody - fill - gap;
        // 제목 + 머리글 + 첫 두 줄이 안 들어가면 다음 쪽에서 시작한다
        const minRows = Math.min(2, n - i);
        const minNeed = head + rows.slice(i, i + minRows).reduce((a, r) => a + r, 0) + (i + minRows === n ? foot : 0);
        if (fill > 0 && minNeed > avail) {
          turn();
          continue;
        }
        let take = head;
        let j = i;
        while (j < n) {
          const extra = rows[j] + (j + 1 === n ? foot : 0);
          if (take + extra > avail && j > i) break;
          take += rows[j];
          j += 1;
          if (take > avail) break;
        }
        if (j === n) take += foot;
        page.push({ kind: "rows", key: `${b.key}:${i}`, block: b, from: i, to: j, cont, widths: m.widths });
        fill += gap + take;
        i = j;
        cont = true;
        if (i < n) turn();
      } while (i < n);
    }
    turn();

    const next: Layout = { first: firstCols, rest };
    setLayout((prev) => (prev && JSON.stringify(shape(prev)) === JSON.stringify(shape(next)) ? prev : next));
    // version 이 내용을 대신한다 — 블록 배열은 렌더마다 새로 만들어진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, orient, fontTick]);

  const sheet = (n: number, total: number, head: ReactNode, body: ReactNode) => (
    <section
      key={n}
      className="nd-sheet flex shrink-0 flex-col overflow-hidden bg-white text-nd-fg shadow-nd-card"
      style={{ width: `${size.w}mm`, height: `${size.h}mm`, padding: `${MARGIN.y}mm ${MARGIN.x}mm` }}
      aria-label={`${n + 1}쪽`}
    >
      {head}
      <div className="min-h-0 flex-1">{body}</div>
      <Foot left={footLeft} right={`${n + 1} / ${total}`} />
    </section>
  );

  const stack = (children: ReactNode[]) => (
    <div className="flex flex-col" style={{ gap: GAP }}>
      {children}
    </div>
  );

  const byKey = new Map(summary.map((b) => [b.key, b.node]));
  const pages: ReactNode[] = [];
  if (layout) {
    const total = 1 + layout.rest.length;
    const firstBody = wide ? (
      <div className="grid" style={{ gridTemplateColumns: `${COL_RATIO[0]}fr ${COL_RATIO[1]}fr`, columnGap: COL_GAP }}>
        {layout.first.map((col, c) => (
          <div key={c} className="min-w-0">
            {stack(col.map((k) => <div key={k}>{byKey.get(k)}</div>))}
          </div>
        ))}
      </div>
    ) : (
      stack(layout.first[0].map((k) => <div key={k}>{byKey.get(k)}</div>))
    );
    pages.push(sheet(0, total, first, firstBody));
    layout.rest.forEach((pg, i) => {
      pages.push(
        sheet(
          i + 1,
          total,
          runningHead,
          stack(
            pg.map((sl) =>
              sl.kind === "node" ? (
                <div key={sl.key}>{sl.node}</div>
              ) : (
                <div key={sl.key}>{sl.block.rows!.render(sl.from, sl.to, sl.cont, sl.widths)}</div>
              ),
            ),
          ),
        ),
      );
    });
  }

  return (
    <>
      {/* 재는 칸 — 화면 밖, 실제 너비로 */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible fixed left-[-20000px] top-0 print:hidden">
        <div style={{ width: contentW }}>
          <div data-m="first">{first}</div>
          <div data-m="run">{runningHead}</div>
          <div data-m="foot">
            <Foot left={footLeft} right="0 / 0" />
          </div>
          {!wide &&
            summary.map((b) => (
              <div key={b.key} data-m="sum" data-k={b.key}>
                {b.node}
              </div>
            ))}
          {detail.map((b) => (
            <div key={b.key} data-m="det" data-k={b.key}>
              {b.rows ? b.rows.render(0, b.rows.count, false) : b.node}
            </div>
          ))}
        </div>
        {wide &&
          summary.map((b) => (
            <div key={b.key} style={{ width: colW[b.column] }} data-m="sum" data-k={b.key}>
              {b.node}
            </div>
          ))}
      </div>

      <div className="nd-paper overflow-x-auto py-6 print:overflow-visible print:p-0">
        <div className="mx-auto flex w-max flex-col items-center gap-6 px-4 print:block print:p-0">
          {layout ? pages : <p className="py-20 text-nd-caption text-nd-fg-3">쪽을 나누는 중…</p>}
        </div>
      </div>
    </>
  );
}

/** 쪽 나눔이 같은지 견줄 모양 — 노드는 빼고 key 와 줄 범위만 */
const shape = (l: Layout) => ({
  first: l.first,
  rest: l.rest.map((pg) => pg.map((s) => (s.kind === "node" ? s.key : `${s.key}:${s.from}-${s.to}`))),
});

function Foot({ left, right }: { left: ReactNode; right: string }) {
  return (
    <footer className="mt-auto flex items-end justify-between gap-4 border-t border-nd-line pt-2 text-nd-micro text-nd-fg-3">
      <span className="min-w-0 truncate">{left}</span>
      <span className="nd-num shrink-0">{right}</span>
    </footer>
  );
}

/** 인쇄 — 종이 한 장 = 인쇄 한 장. 여백은 종이가 갖고 있다 */
export const paperPrintCss = (orient: Orient) => {
  const { h } = SIZE[orient];
  return `
@media print {
  @page { size: A4 ${orient}; margin: 0; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .nd-paper, .nd-paper * { visibility: visible; }
  .nd-paper { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; margin: 0 !important; }
  .nd-paper * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .nd-sheet { box-shadow: none !important; margin: 0 !important; height: calc(${h}mm - 0.6mm) !important; break-after: page; }
  .nd-sheet:last-child { break-after: auto; }
}
`;
};

// ---- 보고서 표 ----------------------------------------------------

/**
 * 보고서 표 — 화면용 Table 은 가로 스크롤·고정 열을 전제로 해서 종이에
 * 맞지 않는다. 글자를 줄이고, `wrap` 으로 고른 긴 글 칸(비고·품목 …)만
 * 줄을 바꾼다 — 나머지까지 접히면 「구분」이 「구/분」, 날짜가 두 줄이 된다.
 * 쪽이 갈린 표는 colWidths 로 첫 쪽과 같은 열 폭을 쓴다.
 */
export function RTable({
  head,
  align,
  rows,
  foot,
  wrap = [],
  dense = false,
  colWidths,
}: {
  head: string[];
  align: ("l" | "r")[];
  /** 줄을 바꿔도 되는 칸 번호 */
  wrap?: number[];
  rows: ReactNode[][];
  foot?: ReactNode[];
  dense?: boolean;
  colWidths?: number[];
}) {
  const cell = (i: number) =>
    cn(
      dense ? "px-1.5 py-1" : "px-2 py-1.5",
      align[i] === "r" ? "nd-num text-right" : "text-left",
      wrap.includes(i) ? "break-words" : "whitespace-nowrap",
    );
  return (
    <table
      className={cn("w-full border-collapse", dense ? "text-nd-micro" : "text-nd-caption")}
      style={colWidths ? { tableLayout: "fixed" } : undefined}
    >
      {colWidths && (
        <colgroup>
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
      )}
      <thead>
        <tr className="border-b border-nd-line bg-nd-sunken text-nd-fg-2">
          {head.map((h, i) => (
            <th key={`${h}-${i}`} scope="col" className={cn(cell(i), "font-medium")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} data-pg="row" className="border-b border-nd-line/70 align-top">
            {r.map((c, i) => (
              <td key={i} className={cell(i)}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr data-pg="foot" className="border-t-2 border-nd-line font-semibold">
            {foot.map((c, i) => (
              <td key={i} className={cell(i)}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** 근거 자료 블록의 제목 — 큰 제목(구획)과 작은 제목(같은 구획 안의 다음 표) */
export function BlockTitle({ title, hint, sub = false }: { title: string; hint?: ReactNode; sub?: boolean }) {
  if (sub) return <h3 className="mb-1.5 text-nd-caption font-semibold text-nd-fg-2">{title}</h3>;
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 border-b border-nd-line pb-1.5">
      <h2 className="text-nd-body font-semibold text-nd-fg">{title}</h2>
      {hint && <span className="text-nd-caption text-nd-fg-3">{hint}</span>}
    </div>
  );
}
