"use client";

// ============================================================
//  장표 블록 그리기 — 내용(JSON)의 블록 하나를 화면 조각으로
// ------------------------------------------------------------
//  글자는 전부 Md 를 거친다 — 숫자 자리표시·굵게·각주·학원 익명이 한 곳에서
//  처리된다. 계산 블록(computed)은 computed.tsx 가 종류별로 그린다.
// ============================================================

import type { Block, SlideSpec } from "@/lib/neander/decks/types";
import { slideTexts } from "@/lib/neander/decks/model";
import { fill } from "@/lib/neander/decks/template";
import { Computed } from "./computed";
import { CircText, Md, footnoteIds, useSd } from "./context";

const alignClass = (a?: string) => (a === "r" ? "sd-r" : a === "c" ? "sd-c" : undefined);

export function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "text":
      return (
        <div className={`sd-text sd-size-${b.size ?? "md"}${b.muted ? " sd-muted" : ""}`}>
          <Md text={b.md} />
        </div>
      );
    case "bullets":
      return (
        <ul className={`sd-bul sd-size-${b.size ?? "md"}${b.numbered ? " sd-num" : ""}`}>
          {b.items.map((it, i) =>
            typeof it === "string" ? (
              <li key={i}>
                <Md text={it} />
              </li>
            ) : (
              <li key={i}>
                <Md text={it.t} />
                {it.sub && (
                  <ul>
                    {it.sub.map((s, j) => (
                      <li key={j}>
                        <Md text={s} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ),
          )}
        </ul>
      );
    case "table":
      return <TableView b={b} />;
    case "kpis":
      return (
        <div className="sd-kpis" style={{ gridTemplateColumns: `repeat(${b.cols ?? b.items.length}, minmax(0, 1fr))` }}>
          {b.items.map((k, i) => (
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
    case "callout":
      return (
        <div className={`sd-callout${b.tone ? ` sd-tone-${b.tone}` : ""}`}>
          {b.label && <div className="sd-callout-label">{b.label}</div>}
          <Md text={b.md} />
        </div>
      );
    case "cols":
      return (
        <div
          className="sd-cols"
          style={{
            gridTemplateColumns: (b.widths ?? b.cols.map(() => 1)).map((w) => `minmax(0, ${w}fr)`).join(" "),
            gap: b.gap ?? 22,
          }}
        >
          {b.cols.map((col, i) => (
            <div key={i} className="sd-col">
              {col.map((x, j) => (
                <BlockView key={j} b={x} />
              ))}
            </div>
          ))}
        </div>
      );
    case "card":
      return (
        <div className={`sd-card${b.tone ? ` sd-tone-${b.tone}` : ""}`} data-box>
          {b.title && (
            <div className="sd-card-title">
              <Md text={b.title} />
            </div>
          )}
          {b.blocks.map((x, j) => (
            <BlockView key={j} b={x} />
          ))}
        </div>
      );
    case "steps":
      return (
        <div className={`sd-steps${b.dir === "col" ? " sd-col-dir" : ""}`}>
          {b.items.map((s, i) => (
            <div key={i} className="sd-step" data-box>
              <div className="sd-step-n">{String(i + 1).padStart(2, "0")}</div>
              <div className="sd-step-t">
                <Md text={s.title} />
              </div>
              {s.body && (
                <div className="sd-step-b">
                  <Md text={s.body} />
                </div>
              )}
            </div>
          ))}
        </div>
      );
    case "spacer":
      return <div style={{ height: b.h ?? 8, flexShrink: 0 }} />;
    case "computed":
      return <Computed kind={b.kind} opts={b.opts ?? {}} />;
    default:
      return null;
  }
}

function TableView({ b }: { b: Extract<Block, { type: "table" }> }) {
  const align = (i: number) => alignClass(b.align?.[i]);
  const total = (b.widths ?? []).reduce((s, w) => s + w, 0);
  return (
    <div className="sd-table-wrap" data-box>
      <table className={`sd-table${b.size && b.size !== "md" ? ` sd-${b.size}` : ""}`}>
        {b.widths && (
          <colgroup>
            {b.widths.map((w, i) => (
              <col key={i} style={{ width: `${(w / total) * 100}%` }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {b.head.map((h, i) => (
              <th key={i} className={align(i)}>
                <Md text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row, r) => (
            <tr key={r} className={b.strong?.includes(r) ? "sd-strong" : undefined}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={[align(c), b.strongCols?.includes(c) ? "sd-strongcol" : ""].filter(Boolean).join(" ") || undefined}
                >
                  <Md text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {b.note && (
        <div className="sd-table-note">
          <Md text={b.note} />
        </div>
      )}
    </div>
  );
}

/** 장표 한 장 — 머리(장 번호·챕터)·제목·이끄는 말·본문·각주 */
export function SlideView({ s, index, total }: { s: SlideSpec; index: number; total: number }) {
  const sd = useSd();
  const filledTexts = slideTexts(s).map((t) => fill(t, sd.model));
  const fns = footnoteIds(filledTexts);
  const sources = sd.content.sources.filter((x) => fns.includes(x.id));
  const hero = s.layout === "hero";
  return (
    <div className={`sd-slide${hero ? " sd-hero" : ""}`} data-slide={s.no} data-index={index} data-total={total}>
      <div className="sd-head">
        <span className="sd-no">{s.appendix ? s.no : String(s.no).padStart(2, "0")}</span>
        <span className="sd-sep" />
        <span>
          <CircText text={s.chapter} />
        </span>
        {s.kicker && (
          <>
            <span className="sd-sep" />
            <span>
              <Md text={s.kicker} />
            </span>
          </>
        )}
      </div>
      <div className="sd-title" data-box>
        <Md text={s.title} />
      </div>
      {s.lead && (
        <div className="sd-lead" data-box>
          <Md text={s.lead} />
        </div>
      )}
      <div className="sd-body" data-box="body">
        {s.blocks.map((b, i) => (
          <BlockView key={i} b={b} />
        ))}
        {sources.length > 0 && (
          <div className="sd-foot">
            {sources.map((x) => (
              <span key={x.id}>
                <b>[{x.id}]</b> {x.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
