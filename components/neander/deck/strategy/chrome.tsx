"use client";

// ============================================================
//  장표 위에 얹는 것 — 그 장에 쓰인 가정 칩 · 「가정 변경됨」 배지 · 칩 편집 창
// ------------------------------------------------------------
//  캔버스(1600×900) 안에 그려서 화면 크기와 함께 줄고 는다. 칩을 누르면
//  바로 위에 편집 창이 뜨고, 슬라이더를 끄는 대로 표가 다시 계산된다.
//  칩이 한 줄을 넘치면 「+N」 이 가정 패널을 그 값에 맞춰 연다.
// ============================================================

import type { Model } from "@/lib/neander/decks/model";
import { slideDeps } from "@/lib/neander/decks/model";
import { tokenPaths } from "@/lib/neander/decks/template";
import type { AssumptionValue, DeckContent, SlideSpec } from "@/lib/neander/decks/types";
import { slideTexts } from "@/lib/neander/decks/model";
import { ValueEditor, kindLabel, shown } from "./fields";

const MAX_CHIPS = 6;

const SMOAT_KINDS = new Set(["smoatMonthly", "smoatBands", "academyCompare", "academyTable", "smoatSimulation", "smoatBreakeven"]);
const FIN_KINDS = new Set(["b2bProjects", "commonCost", "runway"]);

/** 이 장이 기대는 실측 부분 — 스냅샷 배지를 달지 정한다 */
export function slideActualParts(s: SlideSpec): { smoat: boolean; finance: boolean } {
  const kinds = s.blocks.flatMap(function walk(b): string[] {
    if (b.type === "computed") return [b.kind];
    if (b.type === "cols") return b.cols.flat().flatMap(walk);
    if (b.type === "card") return b.blocks.flatMap(walk);
    return [];
  });
  const paths = slideTexts(s).flatMap(tokenPaths);
  return {
    smoat: kinds.some((k) => SMOAT_KINDS.has(k)) || paths.some((p) => p.startsWith("r.sm.") || p.startsWith("r.smoat.sim")),
    finance: kinds.some((k) => FIN_KINDS.has(k)) || paths.some((p) => p.startsWith("r.fin.")),
  };
}

export function SlideChrome({
  spec,
  content,
  model,
  openKey,
  onOpen,
  onChange,
  onReset,
  onMore,
  showChips,
}: {
  spec: SlideSpec;
  content: DeckContent;
  model: Model;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  onChange: (key: string, v: AssumptionValue) => void;
  onReset: (key: string) => void;
  onMore: (key: string) => void;
  showChips: boolean;
}) {
  const deps = slideDeps(spec, content.assumptions);
  const defs = new Map(content.assumptions.map((d) => [d.key, d]));
  const changed = deps.filter((k) => model.meta[k]?.overridden);
  const parts = slideActualParts(spec);
  const snapKeys = deps.filter((k) => model.meta[k]?.origin === "snapshot");
  const usesSnapshot =
    snapKeys.length > 0 || (parts.smoat && model.eff.snapshot.smoat) || (parts.finance && model.eff.snapshot.finance);
  const shownKeys = deps.slice(0, MAX_CHIPS);
  const rest = deps.slice(MAX_CHIPS);
  const open = openKey && deps.includes(openKey) ? defs.get(openKey) : undefined;

  return (
    <>
      {(changed.length > 0 || usesSnapshot) && (
        <div className="sd-badge">
          {usesSnapshot && <span className="sd-b-snap">스냅샷 값 사용 중</span>}
          {changed.length > 0 && <span className="sd-b-changed">가정 변경됨 {changed.length}</span>}
        </div>
      )}
      {showChips && deps.length > 0 && (
        <div className="sd-chips" data-chips>
          <span className="sd-chips-label">이 장의 가정</span>
          {shownKeys.map((k) => {
            const d = defs.get(k)!;
            const on = model.meta[k]?.overridden;
            const label = d.short ?? d.label;
            return (
              <button
                key={k}
                type="button"
                className={`sd-chip${on ? " sd-chip-on" : ""}`}
                onClick={() => onOpen(openKey === k ? null : k)}
                title={`${d.label} · ${d.source}`}
              >
                <span>{label.length > 14 ? `${label.slice(0, 13)}…` : label}</span>
                <b>{shown(d, model.v[k])}</b>
              </button>
            );
          })}
          {rest.length > 0 && (
            <button type="button" className="sd-chip sd-chip-more" onClick={() => onMore(rest[0])}>
              +{rest.length}
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="sd-pop" style={{ left: 72 }} role="dialog" aria-label={`${open.label} 바꾸기`}>
          <button type="button" className="sd-pop-close" onClick={() => onOpen(null)} aria-label="닫기">
            ✕
          </button>
          <div className="sd-pop-title">{open.label}</div>
          <div className="sd-pop-src">{open.source}</div>
          <div className="sd-pop-row">
            <ValueEditor def={open} value={model.v[open.key]} onChange={(v) => onChange(open.key, v)} autoFocus />
          </div>
          <div className="sd-pop-row" style={{ justifyContent: "space-between" }}>
            <span className="sd-pop-meta">
              {kindLabel(open, model.meta[open.key]).text} · 기본값 {shown(open, model.meta[open.key]?.base ?? null)}
            </span>
            <button type="button" onClick={() => onReset(open.key)} disabled={!model.meta[open.key]?.overridden}>
              기본값으로
            </button>
          </div>
        </div>
      )}
    </>
  );
}
