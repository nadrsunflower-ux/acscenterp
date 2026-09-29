"use client";

// ============================================================
//  가정값을 바꿀 수 있는 발표 장표 — 화면 전체
// ------------------------------------------------------------
//  내용은 로그인 API 로 받는다 (저장소가 public 이라 코드에 두지 않는다 —
//  lib/neander/decks/types.ts 머리말). 받은 내용 + 실측 + 덮어쓴 값으로
//  모델을 만들고(model.ts), 모든 장표가 그 모델에서 숫자를 꺼낸다.
//
//  조작
//    ← → · 클릭      넘기기 (Deck 엔진)
//    N               발표자 노트
//    F               전체화면 = 발표 모드 (가정 패널을 닫는다)
//    A               가정 패널
//    #slide-N        그 장으로 바로
//    인쇄 · PDF      한 장표 한 페이지 + 마지막 장에 인쇄 시점 가정값
//
//  저장: 브라우저(localStorage) · 공유 링크(?a=) · 회의용 저장본(Firestore)
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Deck, type DeckSlide } from "@/components/neander/deck/Deck";
import { useAuth } from "@/components/neander/auth";
import {
  deleteDeckScenario,
  fetchDeck,
  listDeckScenarios,
  loadDeckAsset,
  saveDeckScenario,
} from "@/lib/neander/decks/client";
import { buildModel, type Model } from "@/lib/neander/decks/model";
import {
  decodeOverrides,
  loadLocal,
  resetOverrides,
  sanitizeOverrides,
  saveLocal,
  setOverride,
  shareUrl,
  type ChangeVia,
  type DeckLocalState,
} from "@/lib/neander/decks/state";
import { fill } from "@/lib/neander/decks/template";
import type { AssumptionValue, Block, DeckContent, DeckPayload, DeckScenario } from "@/lib/neander/decks/types";
import { dateLabel } from "@/lib/neander/decks/format";
import { overviewTileIds } from "@/lib/neander/decks/map";
import { SlideView } from "./blocks";
import { SlideChrome } from "./chrome";
import { Computed } from "./computed";
import { Md, SdProvider, type SdContext } from "./context";
import { AssumptionPanel } from "./panel";
import { CANVAS, SD_CSS, SD_OVERLAY_CSS } from "./styles";

/** 이보다 좁은 화면(휴대폰)은 캔버스를 줄이지 않고 세로로 흘린다 — 글씨가 최소 크기 아래로 줄지 않게 */
const FLOW_BELOW = 900;

/** 매물 블록처럼 장 안에서 누를 것이 있는 장 — 좌우 클릭존을 치운다 */
const INTERACTIVE_KINDS = new Set(["propertyOverview", "propertyCards", "propertyTable"]);
function hasInteractive(blocks: Block[]): boolean {
  return blocks.some(
    (b) =>
      (b.type === "computed" && INTERACTIVE_KINDS.has(b.kind)) ||
      (b.type === "cols" && b.cols.some(hasInteractive)) ||
      (b.type === "card" && hasInteractive(b.blocks)),
  );
}

export function StrategyDeck({ slug, exitHref }: { slug: string; exitHref: string }) {
  const { user } = useAuth();
  const [payload, setPayload] = useState<DeckPayload | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status?: number } | null>(null);
  const [local, setLocal] = useState<DeckLocalState>({ overrides: {}, history: [] });
  const [ready, setReady] = useState(false);

  // ---- 받기 ----
  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetchDeck(slug)
      .then((p) => {
        if (!alive) return;
        const defs = p.content.assumptions;
        let state = loadLocal(slug, defs);
        // 공유 링크의 값 — 한 번 반영하고 주소에서 뗀다 (새로고침이 덮어쓰지 않게)
        const url = new URL(window.location.href);
        const shared = decodeOverrides(defs, url.searchParams.get("a"));
        if (shared) {
          const at = Date.now();
          const history = Object.entries(shared).map(([key, to]) => ({
            key,
            from: state.overrides[key] ?? null,
            to,
            at,
            via: "공유 링크" as ChangeVia,
          }));
          state = { ...state, overrides: shared, history: [...history, ...state.history].slice(0, 200) };
          url.searchParams.delete("a");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
        setLocal(state);
        setPayload(p);
        setReady(true);
      })
      .catch((e: Error & { status?: number }) => alive && setLoadError({ message: e.message, status: e.status }));
    return () => {
      alive = false;
    };
  }, [user, slug]);

  useEffect(() => {
    if (ready) saveLocal(slug, local);
  }, [ready, slug, local]);

  if (loadError) {
    return (
      <div className="sd-loading">
        <style dangerouslySetInnerHTML={{ __html: SD_OVERLAY_CSS }} />
        <div style={{ fontWeight: 700 }}>
          {loadError.status === 403 ? "재무 권한이 있는 계정만 이 장표를 볼 수 있습니다." : "장표를 불러오지 못했습니다."}
        </div>
        <div style={{ fontSize: 14, opacity: 0.7 }}>{loadError.message}</div>
        <a href={exitHref}>회의록으로 돌아가기</a>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="sd-loading">
        <style dangerouslySetInnerHTML={{ __html: SD_OVERLAY_CSS }} />
        장표와 ERP 실측값을 불러오는 중…
      </div>
    );
  }
  return (
    <Loaded
      slug={slug}
      exitHref={exitHref}
      payload={payload}
      local={local}
      setLocal={setLocal}
      myEmail={user?.email ?? null}
    />
  );
}

function Loaded({
  slug,
  exitHref,
  payload,
  local,
  setLocal,
  myEmail,
}: {
  slug: string;
  exitHref: string;
  payload: DeckPayload;
  local: DeckLocalState;
  setLocal: React.Dispatch<React.SetStateAction<DeckLocalState>>;
  myEmail: string | null;
}) {
  const content = payload.content;
  const model = useMemo(() => buildModel(content, payload.actuals, local.overrides), [content, payload.actuals, local.overrides]);
  const realNames = local.realNames === true;

  const [index, setIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [chipKey, setChipKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [scenarios, setScenarios] = useState<DeckScenario[] | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  // ---- 바꾸기 ----
  const modelRef = useRef<Model>(model);
  modelRef.current = model;
  const change = useCallback(
    (key: string, to: AssumptionValue, via: ChangeVia) => {
      const m = modelRef.current;
      setLocal((s) => setOverride(s, key, to, m.meta[key]?.base ?? null, m.v[key] ?? null, via));
    },
    [setLocal],
  );
  const reset = useCallback(
    (keys?: string[]) => {
      const m = modelRef.current;
      const base = Object.fromEntries(Object.entries(m.meta).map(([k, x]) => [k, x.base]));
      setLocal((s) => resetOverrides(s, m.v, base, keys));
    },
    [setLocal],
  );

  // ---- 발표 모드 = 전체화면 ----
  useEffect(() => {
    const on = () => {
      const fs = !!document.fullscreenElement;
      setFullscreen(fs);
      if (fs) setPanelOpen(false);
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // ---- 저장본 ----
  const refreshScenarios = useCallback(() => {
    listDeckScenarios(slug)
      .then((l) => {
        setScenarios(l);
        setScenarioError(null);
      })
      .catch((e: Error) => setScenarioError(e.message));
  }, [slug]);
  useEffect(() => {
    if (panelOpen && scenarios === null) refreshScenarios();
  }, [panelOpen, scenarios, refreshScenarios]);

  const flash = (t: string) => {
    setMessage(t);
    window.setTimeout(() => setMessage((m) => (m === t ? null : m)), 3500);
  };

  // ---- 인쇄 ----
  const allAssetIds = useMemo(() => {
    const ids = content.properties.map((p) => p.photo).filter((x): x is string => !!x);
    if (content.properties.length) ids.push(...overviewTileIds(content));
    // 부록 캡처(gallery) — 인쇄본에도 실려야 한다
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.type === "computed" && b.kind === "gallery") {
          ((b.opts?.items as { asset: string }[] | undefined) ?? []).forEach((it) => ids.push(it.asset));
        }
        if (b.type === "cols") b.cols.forEach(walk);
        if (b.type === "card") walk(b.blocks);
      }
    };
    content.slides.forEach((s) => walk(s.blocks));
    return [...new Set(ids)];
  }, [content]);

  // 열자마자 사진·지도 타일을 미리 받아 둔다 — 발표 중 매물 장으로 넘어갔을 때 빈칸이
  // 잠깐 보이지 않게. 한꺼번에 수십 개를 쏘지 않고 네 개씩 이어 받는다.
  useEffect(() => {
    let alive = true;
    const queue = [...allAssetIds];
    const worker = async () => {
      while (alive && queue.length) await loadDeckAsset(slug, queue.shift()!);
    };
    void Promise.all(Array.from({ length: 4 }, worker));
    return () => {
      alive = false;
    };
  }, [allAssetIds, slug]);

  const startPrint = useCallback(async () => {
    setMessage("인쇄 준비 중…");
    await Promise.all(allAssetIds.map((id) => loadDeckAsset(slug, id)));
    flushSync(() => setPrinting(true));
    // 사진이 그려질 틈을 준다
    await new Promise((r) => window.setTimeout(r, 400));
    setMessage(null);
    window.print();
  }, [allAssetIds, slug]);

  useEffect(() => {
    // Ctrl/Cmd+P 로 바로 인쇄할 때도 인쇄본이 있어야 한다
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  // ---- 공유 링크 ----
  const share = useCallback(async () => {
    const url = shareUrl(window.location.href, local.overrides, index + 1);
    try {
      await navigator.clipboard.writeText(url);
      flash("공유 링크를 복사했습니다. 받는 사람도 ERP 로그인이 필요합니다.");
    } catch {
      window.prompt("이 링크를 복사하세요", url);
    }
  }, [local.overrides, index]);

  // ---- 장표 ----
  const ctx: SdContext = useMemo(() => ({ slug, content, model, realNames }), [slug, content, model, realNames]);
  const total = content.slides.length;
  const slides: DeckSlide[] = useMemo(
    () =>
      content.slides.map((s, i) => ({
        id: s.id,
        chapter: s.chapter,
        interactive: s.interactive || hasInteractive(s.blocks),
        render: () => (
          <SdProvider value={ctx}>
            <SlideView s={s} index={i} total={total} />
          </SdProvider>
        ),
      })),
    [content.slides, ctx, total],
  );

  // 진행 막대 칸 — 장의 파트(chapter)가 이어지는 묶음마다 한 칸
  const parts = useMemo(() => {
    const out: { label: string; start: number; end: number; muted?: boolean }[] = [];
    content.slides.forEach((s, i) => {
      const last = out[out.length - 1];
      if (last && last.label === s.chapter) last.end = i;
      else out.push({ label: s.chapter, start: i, end: i, muted: s.appendix });
    });
    return out;
  }, [content.slides]);

  const onIndexChange = useCallback((i: number) => {
    setIndex(i);
    setChipKey(null);
  }, []);

  const extraKeys = useMemo(
    () => ({
      n: () => setNotesOpen((x) => !x),
      a: () => {
        setFocusKey(null);
        setPanelOpen((x) => !x);
      },
    }),
    [],
  );

  const chrome = useCallback(
    (_: DeckSlide, i: number) => (
      <SlideChrome
        spec={content.slides[i]}
        content={content}
        model={model}
        openKey={chipKey}
        onOpen={setChipKey}
        onChange={(k, v) => change(k, v, "칩")}
        onReset={(k) => reset([k])}
        onMore={(k) => {
          setFocusKey(k);
          setPanelOpen(true);
        }}
        showChips
      />
    ),
    [content, model, chipKey, change, reset],
  );

  const snapshotParts = [model.eff.snapshot.smoat ? "스모트" : "", model.eff.snapshot.finance ? "재무" : ""].filter(Boolean);
  const controls = (
    <>
      {snapshotParts.length > 0 && (
        <span className="sd-snap-flag" title={Object.values(payload.errors).filter(Boolean).join(" / ")}>
          스냅샷 값 사용 중 ({snapshotParts.join("·")})
        </span>
      )}
      <button
        className={`dk-btn sd-ctrl-txt${notesOpen ? " sd-on" : ""}`}
        onClick={() => setNotesOpen((x) => !x)}
        aria-pressed={notesOpen}
        title="발표자 노트 (N)"
      >
        노트 N
      </button>
      <button
        className={`dk-btn sd-ctrl-txt${panelOpen ? " sd-on" : ""}`}
        onClick={() => {
          setFocusKey(null);
          setPanelOpen((x) => !x);
        }}
        aria-pressed={panelOpen}
        title="가정 패널 (A)"
      >
        가정 A
      </button>
      <button className="dk-btn sd-ctrl-txt" onClick={() => void startPrint()} title="인쇄 · PDF (한 장표 한 페이지)">
        PDF
      </button>
    </>
  );

  const spec = content.slides[Math.min(index, total - 1)];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SD_CSS + SD_OVERLAY_CSS }} />
      <Deck
        meta={{
          title: content.meta.title,
          dateLabel: content.meta.dateLabel,
          presenter: content.meta.presenter,
          accent: content.meta.accent ?? "#7dd3fc",
          exitHref,
        }}
        slides={slides}
        size={CANVAS}
        flowBelow={FLOW_BELOW}
        parts={parts}
        hashNav
        extraKeys={extraKeys}
        chrome={chrome}
        controls={controls}
        onIndexChange={onIndexChange}
      />
      {notesOpen && spec && (
        <div className="sd-notes" role="complementary" aria-label="발표자 노트">
          <div className="sd-notes-head">
            <span>
              발표자 노트 · {spec.no}. {fill(spec.title, model).replace(/\*\*|==|\[\^\d+\]/g, "")}
            </span>
            <span>N 으로 닫기</span>
          </div>
          <SdProvider value={ctx}>
            {(spec.notes ?? "노트가 없습니다.").split(/\n{2,}/).map((p, i) => (
              // 「예상 질문」 문단은 따로 표시한다
              <p key={i} className={p.startsWith("예상 질문") ? "sd-qa" : undefined}>
                <Md text={p} />
              </p>
            ))}
          </SdProvider>
        </div>
      )}
      {panelOpen && !fullscreen && (
        <AssumptionPanel
          content={content}
          model={model}
          history={local.history}
          focusKey={focusKey}
          realNames={realNames}
          scenarios={scenarios}
          scenarioError={scenarioError}
          message={message}
          myEmail={myEmail}
          onClose={() => setPanelOpen(false)}
          onChange={(k, v) => change(k, v, "패널")}
          onReset={reset}
          onShare={() => void share()}
          onPrint={() => void startPrint()}
          onRealNames={(on) => setLocal((s) => ({ ...s, realNames: on }))}
          onSaveScenario={(name) =>
            saveDeckScenario(slug, name, local.overrides)
              .then(() => {
                flash(`「${name}」 저장본을 만들었습니다.`);
                refreshScenarios();
              })
              .catch((e: Error) => setScenarioError(e.message))
          }
          onLoadScenario={(s) => {
            const m = modelRef.current;
            const values = sanitizeOverrides(content.assumptions, s.values);
            const at = Date.now();
            setLocal((st) => ({
              ...st,
              overrides: values,
              history: [
                ...Object.entries(values).map(([key, to]) => ({ key, from: m.v[key] ?? null, to, at, via: "저장본" as ChangeVia })),
                ...st.history,
              ].slice(0, 200),
            }));
            flash(`「${s.name}」 값을 불러왔습니다.`);
          }}
          onDeleteScenario={(s) => {
            if (!window.confirm(`「${s.name}」 저장본을 지울까요?`)) return;
            deleteDeckScenario(slug, s.id)
              .then(refreshScenarios)
              .catch((e: Error) => setScenarioError(e.message));
          }}
        />
      )}
      {printing && typeof document !== "undefined" && createPortal(<PrintDeck ctx={ctx} content={content} />, document.body)}
    </>
  );
}

/** 인쇄본 — 한 장표 한 페이지, 마지막 페이지에 인쇄 시점 가정값 */
function PrintDeck({ ctx, content }: { ctx: SdContext; content: DeckContent }) {
  const printCtx = { ...ctx, print: true };
  const total = content.slides.length;
  const changed = Object.entries(ctx.model.meta).filter(([, m]) => m.overridden).length;
  const stamp = new Date().toLocaleString("ko-KR");
  return (
    <div className="sd-print" aria-hidden>
      <SdProvider value={printCtx}>
        {content.slides.map((s, i) => {
          const chrome = <PrintBadge ctx={ctx} content={content} i={i} />;
          return (
            <div key={s.id} className="sd-print-page">
              <SlideView s={s} index={i} total={total} />
              {chrome}
              <div className="sd-print-foot">
                <span>
                  {content.meta.title} · {content.meta.dateLabel} · {content.meta.presenter}
                </span>
                <span>
                  {i + 1} / {total + 1}
                </span>
              </div>
            </div>
          );
        })}
        <div className="sd-print-page">
          <div className="sd-slide">
            <div className="sd-head">
              <span className="sd-no">A+</span>
              <span className="sd-sep" />
              <span>인쇄본 부록</span>
            </div>
            <div className="sd-title">이 인쇄본에 쓰인 가정값</div>
            <div className="sd-lead">
              {stamp} 인쇄 · 바꾼 값 {changed}개 (노란 글씨) · 실측은 {ctx.model.r.fin ? `장부 ${dateLabel(ctx.model.r.fin.asOf)}` : "스냅샷"} ·{" "}
              {ctx.model.r.sm ? `스모트 ${dateLabel(ctx.model.r.sm.asOf)}` : "스냅샷"} 기준
            </div>
            <div className="sd-body">
              <Computed kind="assumptionTable" opts={{ dense: true }} />
            </div>
          </div>
          <div className="sd-print-foot">
            <span>{content.meta.title}</span>
            <span>
              {total + 1} / {total + 1}
            </span>
          </div>
        </div>
      </SdProvider>
    </div>
  );
}

function PrintBadge({ ctx, content, i }: { ctx: SdContext; content: DeckContent; i: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <SlideChrome
        spec={content.slides[i]}
        content={content}
        model={ctx.model}
        openKey={null}
        onOpen={() => undefined}
        onChange={() => undefined}
        onReset={() => undefined}
        onMore={() => undefined}
        showChips={false}
      />
    </div>
  );
}
