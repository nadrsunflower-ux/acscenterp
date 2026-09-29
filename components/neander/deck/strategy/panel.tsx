"use client";

// ============================================================
//  가정 패널 (A) — 모든 가정을 묶음별로 보고 바꾸는 곳
// ------------------------------------------------------------
//  머리: 되돌리기(전체) · 공유 링크 · 인쇄/PDF · 학원 실명 보기
//  묶음: 매장 · 매출·현금 · B2B · 생카 · 스모트 · 운영 — 접고 펼치며,
//        묶음마다 되돌리기, 값마다 되돌리기
//  아래: 회의용 저장본(이름 붙여 저장·불러오기) · 변경 이력
// ============================================================

import { useEffect, useRef, useState } from "react";
import type { Model } from "@/lib/neander/decks/model";
import type { HistoryEntry } from "@/lib/neander/decks/state";
import { ASSUMPTION_GROUPS, type AssumptionValue, type DeckContent, type DeckScenario } from "@/lib/neander/decks/types";
import { ValueEditor, kindLabel, shown } from "./fields";

export function AssumptionPanel({
  content,
  model,
  history,
  focusKey,
  realNames,
  scenarios,
  scenarioError,
  message,
  onClose,
  onChange,
  onReset,
  onShare,
  onPrint,
  onRealNames,
  onSaveScenario,
  onLoadScenario,
  onDeleteScenario,
  myEmail,
}: {
  content: DeckContent;
  model: Model;
  history: HistoryEntry[];
  focusKey: string | null;
  realNames: boolean;
  scenarios: DeckScenario[] | null;
  scenarioError: string | null;
  message: string | null;
  onClose: () => void;
  onChange: (key: string, v: AssumptionValue) => void;
  onReset: (keys?: string[]) => void;
  onShare: () => void;
  onPrint: () => void;
  onRealNames: (on: boolean) => void;
  onSaveScenario: (name: string) => void;
  onLoadScenario: (s: DeckScenario) => void;
  onDeleteScenario: (s: DeckScenario) => void;
  myEmail: string | null;
}) {
  const defs = content.assumptions;
  const focusGroup = focusKey ? defs.find((d) => d.key === focusKey)?.group : undefined;
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ASSUMPTION_GROUPS.map((g) => [g, g === focusGroup])),
  );
  const [name, setName] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 칩의 「+N」 으로 열렸으면 그 값으로 스크롤
  useEffect(() => {
    if (!focusKey) return;
    const g = defs.find((d) => d.key === focusKey)?.group;
    if (g) setOpen((o) => ({ ...o, [g]: true }));
    const t = window.setTimeout(() => {
      document.getElementById(`sd-f-${focusKey}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusKey, defs]);

  const overridden = Object.keys(model.meta).filter((k) => model.meta[k].overridden);
  const labelOf = new Map(defs.map((d) => [d.key, d]));

  return (
    <aside className="sd-panel" aria-label="가정 패널" data-panel>
      <div className="sd-panel-head">
        <div className="sd-panel-top">
          <div>
            <div className="sd-panel-title">가정 패널</div>
            <div className="sd-panel-sub">
              값을 바꾸면 모든 장표가 바로 다시 계산됩니다 · 바꾼 값 {overridden.length}개
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="가정 패널 닫기 (A)">
            닫기 A
          </button>
        </div>
        <div className="sd-panel-actions">
          <button type="button" onClick={() => onReset()} disabled={overridden.length === 0}>
            전체 기본값으로
          </button>
          <button type="button" onClick={onShare}>
            공유 링크 복사
          </button>
          <button type="button" onClick={onPrint}>
            인쇄 · PDF
          </button>
          <label className="sd-toggle" style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={realNames} onChange={(e) => onRealNames(e.target.checked)} />
            학원 실명 보기
          </label>
        </div>
        {message && <div className="sd-msg">{message}</div>}
      </div>

      <div className="sd-panel-scroll" ref={scrollRef}>
        {ASSUMPTION_GROUPS.map((g) => {
          const list = defs.filter((d) => d.group === g);
          if (list.length === 0) return null;
          const changed = list.filter((d) => model.meta[d.key]?.overridden).map((d) => d.key);
          return (
            <section key={g} className="sd-group">
              <div className="sd-group-head" onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}>
                <b>
                  {open[g] ? "▾" : "▸"} {g}
                </b>
                <span>
                  {list.length}개{changed.length ? ` · 바꾼 값 ${changed.length}` : ""}
                  {changed.length > 0 && (
                    <button
                      type="button"
                      className="sd-field-reset"
                      style={{ marginLeft: 8 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReset(changed);
                      }}
                    >
                      묶음 되돌리기
                    </button>
                  )}
                </span>
              </div>
              {open[g] && (
                <div className="sd-group-body">
                  {list.map((d) => {
                    const m = model.meta[d.key];
                    const k = kindLabel(d, m);
                    return (
                      <div
                        key={d.key}
                        id={`sd-f-${d.key}`}
                        className={`sd-field${m?.overridden ? " sd-changed" : ""}${focusKey === d.key ? " sd-flash" : ""}`}
                      >
                        <div className="sd-field-top">
                          <div className="sd-field-label">{d.label}</div>
                          <span className={`sd-field-kind ${k.cls}`}>{k.text}</span>
                        </div>
                        <div className="sd-field-row">
                          <ValueEditor def={d} value={model.v[d.key]} onChange={(v) => onChange(d.key, v)} />
                        </div>
                        <div className="sd-field-src">
                          {d.source}
                          {d.note ? ` · ${d.note}` : ""}
                          {m?.overridden && (
                            <>
                              {" "}
                              · 기본값 {shown(d, m.base)}{" "}
                              <button type="button" className="sd-field-reset" onClick={() => onReset([d.key])}>
                                되돌리기
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        <section className="sd-sec">
          <div className="sd-sec-title">회의용 저장본</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={name}
              placeholder="예: 0929 보수안"
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onSaveScenario(name.trim());
                  setName("");
                }
              }}
            />
            <button
              type="button"
              className="sd-primary"
              disabled={!name.trim()}
              onClick={() => {
                onSaveScenario(name.trim());
                setName("");
              }}
            >
              지금 값 저장
            </button>
          </div>
          {scenarioError && <div className="sd-err">{scenarioError}</div>}
          <div className="sd-list">
            {scenarios === null && <small>불러오는 중…</small>}
            {scenarios?.length === 0 && <small>저장본이 없습니다.</small>}
            {scenarios?.map((s) => (
              <div key={s.id} className="sd-list-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{s.name}</div>
                  <small>
                    {s.createdBy.split("@")[0]} · {new Date(s.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 바꾼 값{" "}
                    {Object.keys(s.values).length}개
                  </small>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" onClick={() => onLoadScenario(s)}>
                    불러오기
                  </button>
                  {myEmail === s.createdBy && (
                    <button type="button" className="sd-danger" onClick={() => onDeleteScenario(s)}>
                      지우기
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sd-sec">
          <div className="sd-sec-title" style={{ cursor: "pointer" }} onClick={() => setShowHistory((x) => !x)}>
            {showHistory ? "▾" : "▸"} 변경 이력 ({history.length})
          </div>
          {showHistory && (
            <div className="sd-list">
              {history.length === 0 && <small>아직 바꾼 값이 없습니다.</small>}
              {history.slice(0, 60).map((h, i) => {
                const d = labelOf.get(h.key);
                return (
                  <div key={i} className="sd-list-row">
                    <span style={{ minWidth: 0 }}>
                      {d?.label ?? h.key}: {d ? shown(d, h.from) : String(h.from)} → <b>{d ? shown(d, h.to) : String(h.to)}</b>
                    </span>
                    <small style={{ whiteSpace: "nowrap" }}>
                      {h.via} · {new Date(h.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
