"use client";

// ============================================================
//  Deck — 웹 기반 16:9 회의 발표자료 엔진
// ------------------------------------------------------------
//  회의 준비 자료를 "웹 PPT"로 보여주는 재사용 뷰어.
//  - 1280×720 고정 캔버스를 화면에 맞게 scale (모든 기기에서 동일 레이아웃)
//  - 키보드: ←/→/Space/PgUp/PgDn/Home/End 이동 · F 전체화면 · Esc 나가기
//  - 좌/우 클릭존, 하단 도트 레일, 상단 진행바
//  - 슬라이드 전환 시 remount → 슬라이드 내부 reveal 애니메이션 재생
//    (스태거는 <Reveal i={n}> 또는 className="dk-rise" + style={{"--i": n}})
//
//  새 발표자료 만들기: app/neander/meetings/prep/<slug>/page.tsx 에서
//  <Deck meta={…} slides={…} /> 렌더 + lib/neander/prep-docs.ts 에 등록.
//
//  선택 기능 (넘기지 않으면 예전과 똑같다)
//  - size        캔버스 크기 (기본 1280×720, 가정 장표는 1504×846)
//  - extraKeys   글자 키 → 동작 (N 노트 · A 가정 패널 등). 기본 키보다 먼저 본다
//  - hashNav     주소의 #slide-N 과 지금 장을 맞춘다 (바로 가기 · 새로고침 유지)
//  - chrome      장마다 캔버스 위에 얹는 것 (가정 칩처럼 클릭존 위에서 눌려야 하는 것)
//  - controls    하단 오른쪽 버튼 줄 앞에 넣을 단추
//  - onIndexChange  지금 장이 바뀔 때
//  - flowBelow   화면 폭이 이보다 좁으면(휴대폰) 캔버스를 줄이지 않고 세로로 흘린다.
//                글자가 캔버스 비율만큼 작아지지 않는다 — 대신 세로 스크롤
// ============================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ASSISTANT_STATE_EVENT,
  callAssistant,
  setAssistantContext,
  type AssistantState,
} from "@/components/neander/assistant/events";

export interface DeckSlide {
  id: string;
  /** 하단에 표시되는 챕터 라벨 (예: "스모트 — 마케팅") */
  chapter?: string;
  render: () => ReactNode;
  /**
   * 슬라이드 안에서 커서를 쓰는가 (막대에 커서 → 설명 판 등).
   * 켜면 좌·우 클릭존(각 18%)을 치운다 — 클릭존이 슬라이드 위에 깔려 가장자리
   * 막대에 커서가 닿지 않았다. 넘기기는 방향키·하단 버튼으로 그대로 된다.
   */
  interactive?: boolean;
}

export interface DeckMeta {
  /** 자료 제목 (하단 좌측 표기) */
  title: string;
  /** 날짜 라벨 (예: "2026.07.07 화") */
  dateLabel: string;
  /** 발표자 */
  presenter: string;
  presenterEmoji?: string;
  /** 포인트 색 (진행바·카운터 등) */
  accent: string;
  /** Esc / 닫기 버튼으로 돌아갈 경로 */
  exitHref: string;
  /**
   * 비서에게 알릴 발표 맥락 — 주면 비서가 기간 없는 질문을 이 달 기준으로 답한다
   * (지금 보는 장 이름은 Deck 이 붙인다). 재무·매출 보고 슬라이드가 준다.
   */
  assistantContext?: { module: "finance" | "sales"; month: string };
}

const W = 1280;
const H = 720;

export interface DeckOptions {
  size?: { w: number; h: number };
  extraKeys?: Record<string, () => void>;
  hashNav?: boolean;
  chrome?: (slide: DeckSlide, index: number) => ReactNode;
  controls?: ReactNode;
  onIndexChange?: (index: number) => void;
  flowBelow?: number;
}

/** "#slide-7" → 6 (0부터). 없거나 틀리면 null */
const indexFromHash = (hash: string, count: number): number | null => {
  const m = /^#slide-(\d+)$/.exec(hash);
  if (!m) return null;
  const n = Number(m[1]) - 1;
  return n >= 0 && n < count ? n : null;
};

export function Deck({
  meta,
  slides,
  size,
  extraKeys,
  hashNav = false,
  chrome,
  controls,
  onIndexChange,
  flowBelow,
}: { meta: DeckMeta; slides: DeckSlide[] } & DeckOptions) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const w = size?.w ?? W;
  const h = size?.h ?? H;
  // #slide-N 으로 열면 그 장에서 시작한다 — 효과에서 나중에 옮기면 개발 모드(StrictMode)가
  // 효과를 두 번 돌리는 사이 주소가 1장으로 덮여 1장에 머문다
  const [index, setIndex] = useState(() =>
    hashNav && typeof window !== "undefined" ? indexFromHash(window.location.hash, slides.length) ?? 0 : 0,
  );
  const [scale, setScale] = useState(0); // 0 = 측정 전 (초기 플래시 방지)
  // 좁은 화면 — 캔버스를 줄이는 대신 장 하나를 세로로 흘린다
  const [flow, setFlow] = useState(false);
  // 이 화면에 붙은 비서(재무·매출) — 발표 중 나온 질문에 슬라이드를 떠나지 않고 답한다.
  // 모듈 레이아웃의 비서가 이름을 알려 오면 오른쪽 위에 버튼이 생긴다 (assistant/events.ts)
  const [assistant, setAssistant] = useState<AssistantState>({ name: null, open: false });
  useEffect(() => {
    const onState = (e: Event) => setAssistant((e as CustomEvent<AssistantState>).detail);
    window.addEventListener(ASSISTANT_STATE_EVENT, onState);
    // 비서가 먼저 마운트됐으면 이름을 다시 알려 달라고 한다
    callAssistant("ping");
    return () => window.removeEventListener(ASSISTANT_STATE_EVENT, onState);
  }, []);
  const toggleAssistant = useCallback(() => callAssistant("toggle"), []);

  const count = slides.length;
  const clamp = useCallback(
    (n: number) => Math.max(0, Math.min(count - 1, n)),
    [count],
  );
  const go = useCallback((n: number) => setIndex((_) => clamp(n)), [clamp]);
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);
  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);

  // 화면 크기에 맞춰 캔버스 스케일 계산
  useEffect(() => {
    const update = () => {
      const f = !!flowBelow && window.innerWidth < flowBelow;
      setFlow(f);
      setScale(f ? 1 : Math.min(window.innerWidth / w, window.innerHeight / h));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [w, h, flowBelow]);

  // 흘리는 화면에서는 장이 바뀌면 맨 위부터
  useEffect(() => {
    if (flow) rootRef.current?.scrollTo({ top: 0 });
  }, [flow, index]);

  // #slide-N 바로 가기 — 열려 있는 동안 주소를 바꿀 때 (처음 장은 useState 가 잡는다)
  useEffect(() => {
    if (!hashNav) return;
    const apply = () => {
      const n = indexFromHash(window.location.hash, count);
      if (n !== null) setIndex(n);
    };
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [hashNav, count]);

  // 지금 장을 주소에 적는다 — 새로고침해도 그 장, 링크를 복사하면 그 장
  useEffect(() => {
    if (hashNav && count > 0) {
      const want = `#slide-${Math.min(index, count - 1) + 1}`;
      if (window.location.hash !== want) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${want}`);
      }
    }
    onIndexChange?.(index);
  }, [hashNav, index, count, onIndexChange]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    // 문서 전체를 전체화면으로 — 발표 화면(dk-root)만 올리면 그 밖에 붙는 비서 창·
    // 숫자 미리보기가 전체화면에서 보이지 않는다. dk-root 는 fixed 라 모양은 같다.
    else void (document.documentElement.requestFullscreen?.() ?? rootRef.current?.requestFullscreen?.());
  }, []);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    router.push(meta.exitHref);
  }, [router, meta.exitHref]);

  // 키보드 내비게이션
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 브라우저 단축키(Ctrl+F 찾기, Alt/Cmd+화살표 히스토리 등)는 가로채지 않는다
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 비서 입력칸·내역 창 검색처럼 글자를 치는 중이면 넘기기·Esc 나가기를 하지 않는다
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // 발표 위에 띄운 ERP 창(인사이트 관리 등) 안에서는 Enter·Space·방향키가 그 창의 몫이다
      if (el?.closest?.("#nd-portal-root, [role='dialog']")) return;
      // 링크에 초점이 있으면 Enter 는 그 링크를 여는 키다 (장을 넘기지 않는다). 단추는 예전처럼
      // 넘긴다 — 전체화면 단추를 누른 뒤 Space 로 넘기다가 전체화면이 풀리면 안 된다
      if ((e.key === "Enter" || e.key === " ") && el?.closest?.("a[href]")) return;
      const extra = extraKeys?.[e.key.toLowerCase()];
      if (extra) {
        e.preventDefault();
        extra();
        return;
      }
      switch (e.key) {
        case "a":
        case "A":
          if (!assistant.name) break;
          e.preventDefault();
          toggleAssistant();
          break;
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(count - 1);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          // 전체화면이면 브라우저가 먼저 해제 → 그 외에는 회의록으로 복귀
          if (!document.fullscreenElement) exit();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go, count, toggleFullscreen, exit, assistant.name, toggleAssistant, extraKeys]);

  // 비서에게 발표 맥락(달·지금 장)을 알린다 — 장을 넘기거나 달을 바꾸면 다시, 나가면 지운다
  const ctxModule = meta.assistantContext?.module;
  const ctxMonth = meta.assistantContext?.month;
  const chapterNow = count > 0 ? slides[clamp(index)]?.chapter : undefined;
  useEffect(() => {
    if (!ctxModule || !ctxMonth) return;
    setAssistantContext({ module: ctxModule, month: ctxMonth, chapter: chapterNow });
  }, [ctxModule, ctxMonth, chapterNow]);
  useEffect(() => () => setAssistantContext(null), []);

  // 빈 덱 방어 + slides 가 줄어들어도 범위 밖 접근 금지
  if (count === 0) return null;
  const slide = slides[clamp(index)];
  const progress = count > 1 ? clamp(index) / (count - 1) : 1;

  return (
    <div
      ref={rootRef}
      className={`dk-root${flow ? " dk-flow-root" : ""}`}
      style={{ "--dk-accent": meta.accent } as React.CSSProperties}
    >
      {/* 표제 서체 (Noto Serif KR) — 실패해도 Pretendard 로 자연스럽게 폴백 */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700;900&display=swap"
      />
      {/* style 자식 텍스트는 SSR 시 HTML 이스케이프되어 CSS 가 깨진다 → innerHTML 로 주입 */}
      <style dangerouslySetInnerHTML={{ __html: DECK_CSS }} />

      <div
        className={`dk-stage${flow ? " dk-flow" : ""}`}
        style={
          flow
            ? undefined
            : { width: w, height: h, transform: `translate(-50%, -50%) scale(${scale})`, opacity: scale ? 1 : 0 }
        }
      >
        {/* 배경 분위기: 그리드 + 글로우 + 노이즈 */}
        <div className="dk-bg-grid" aria-hidden />
        <div className="dk-bg-glow" aria-hidden />
        <div className="dk-bg-noise" aria-hidden />

        {/* 상단 진행바 */}
        <div className="dk-progress" aria-hidden>
          <div className="dk-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>

        {/* 슬라이드 본문 — key 로 remount 시켜 reveal 재생 */}
        <div key={slide.id} className="dk-slide">
          {slide.render()}
        </div>

        {/* 좌/우 클릭존 (푸터 컨트롤보다 아래 레이어) — 커서를 쓰는 슬라이드에서는 치운다 */}
        {!slide.interactive && !flow && (
          <>
            <button className="dk-zone dk-zone-left" onClick={prev} aria-label="이전 슬라이드" tabIndex={-1} />
            <button className="dk-zone dk-zone-right" onClick={next} aria-label="다음 슬라이드" tabIndex={-1} />
          </>
        )}

        {/* 장마다 얹는 것 — 클릭존보다 위라 눌린다 */}
        {chrome && <div className="dk-chrome">{chrome(slide, clamp(index))}</div>}

        {/* 비서 호출 — 오른쪽 위. 이 화면에 비서가 붙어 있을 때만 (A 키로도 연다) */}
        {assistant.name && (
          <button
            className={`dk-assist${assistant.open ? " dk-assist-on" : ""}`}
            onClick={toggleAssistant}
            aria-pressed={assistant.open}
            aria-label={assistant.open ? `${assistant.name} 닫기 (A)` : `${assistant.name} 열기 (A)`}
            title={`${assistant.name} — 발표 중 나온 질문에 바로 답합니다 (A)`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h8M8 13h5" />
            </svg>
            {assistant.name}
            <kbd>A</kbd>
          </button>
        )}

        {/* 하단 크롬 */}
        <footer className="dk-footer">
          <div className="dk-footer-meta">
            <span className="dk-footer-brand">NEANDER</span>
            <span className="dk-footer-sep" />
            <span>{meta.dateLabel}</span>
            <span className="dk-footer-sep" />
            <span>
              {meta.presenterEmoji ? `${meta.presenterEmoji} ` : ""}
              {meta.presenter}
            </span>
            {slide.chapter && (
              <>
                <span className="dk-footer-sep" />
                <span className="dk-footer-chapter">{slide.chapter}</span>
              </>
            )}
          </div>

          <div className="dk-dots" role="tablist" aria-label="슬라이드 이동">
            {slides.map((s, i) => (
              <button
                key={s.id}
                className={`dk-dot${i === index ? " dk-dot-on" : ""}`}
                onClick={() => go(i)}
                aria-label={`${i + 1}번 슬라이드`}
              />
            ))}
          </div>

          <div className="dk-footer-ctrl">
            {controls}
            <span className="dk-counter">
              {String(index + 1).padStart(2, "0")}
              <em>/{String(count).padStart(2, "0")}</em>
            </span>
            <button className="dk-btn" onClick={prev} aria-label="이전">‹</button>
            <button className="dk-btn" onClick={next} aria-label="다음">›</button>
            <button className="dk-btn" onClick={toggleFullscreen} aria-label="전체화면 (F)">⛶</button>
            <button className="dk-btn" onClick={exit} aria-label="닫기 (Esc)">✕</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---- 스타일 -------------------------------------------------
// 1280×720 캔버스 안에서만 쓰는 dk- 접두 클래스. px 단위 고정(스케일 일괄 적용).
const DECK_CSS = `
/* 슬라이드 안 숫자에서 여는 ERP 미리보기·창은 발표 화면(z 100) 위에 떠야 한다.
   포탈(#nd-portal-root)의 기본 층(50·60·70)은 발표 화면 뒤로 숨는다. */
body:has(.dk-root) #nd-portal-root .z-nd-popover { z-index: 150; }
body:has(.dk-root) #nd-portal-root .z-nd-dialog { z-index: 160; }
body:has(.dk-root) #nd-portal-root .z-nd-popover-over { z-index: 165; }
body:has(.dk-root) #nd-portal-root .z-nd-toast { z-index: 170; }
/* 비서 창(도킹 패널)도 발표 화면 위로 — 미리보기(150)보다는 아래 */
body:has(.dk-root) .z-nd-dock { z-index: 140; }

/* 비서 호출 버튼 — 캔버스 오른쪽 위, 진행바 바로 아래 */
.dk-assist {
  position: absolute; top: 16px; right: 24px; z-index: 35;
  display: inline-flex; align-items: center; gap: 7px;
  height: 32px; padding: 0 10px 0 12px; border-radius: 999px;
  border: 1px solid rgba(148,163,184,.28); background: rgba(15,18,28,.72);
  color: rgba(238,240,233,.82); font-size: 13px; font-weight: 600; letter-spacing: -.01em;
  cursor: pointer; transition: all .2s ease;
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.dk-assist:hover { color: #eef0e9; border-color: var(--dk-accent); background: rgba(15,18,28,.9); }
.dk-assist-on { color: #04060a; background: var(--dk-accent); border-color: var(--dk-accent); }
.dk-assist-on:hover { color: #04060a; background: var(--dk-accent); }
.dk-assist kbd {
  font: inherit; font-size: 10.5px; font-weight: 700; line-height: 1;
  padding: 3px 5px; border-radius: 5px; border: 1px solid currentColor; opacity: .55;
}

.dk-root {
  position: fixed; inset: 0; z-index: 100;
  background: #04060a;
  font-family: "Pretendard Variable", Pretendard, sans-serif;
  cursor: default;
}
.dk-stage {
  position: absolute; left: 50%; top: 50%;
  transform-origin: center;
  background: #0a0d14;
  color: #eef0e9;
  overflow: hidden;
  transition: opacity .3s ease;
  -webkit-font-smoothing: antialiased;
}

/* ---- 배경 ---- */
.dk-bg-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(148,163,184,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148,163,184,.05) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(ellipse 90% 80% at 50% 40%, #000 30%, transparent 100%);
}
.dk-bg-glow {
  position: absolute; inset: 0;
  background:
    radial-gradient(520px 300px at 12% -6%, rgba(56,189,248,.12), transparent 70%),
    radial-gradient(700px 420px at 105% 110%, rgba(124,92,255,.10), transparent 70%);
}
.dk-bg-noise {
  position: absolute; inset: 0; opacity: .05; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
}

/* ---- 크롬 ---- */
.dk-progress {
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: rgba(148,163,184,.12); z-index: 40;
}
.dk-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--dk-accent), #7c5cff);
  transition: width .45s cubic-bezier(.16,1,.3,1);
}
.dk-slide { position: absolute; inset: 0; z-index: 10; }
/* 장마다 얹는 것 — 슬라이드(10)·클릭존(20) 위, 푸터(30) 아래. 빈 곳은 클릭을 통과시킨다 */
.dk-chrome { position: absolute; inset: 0; z-index: 25; pointer-events: none; }
.dk-chrome > * { pointer-events: auto; }
.dk-zone {
  position: absolute; top: 0; bottom: 64px; width: 18%;
  background: none; border: 0; padding: 0; z-index: 20; cursor: pointer;
  opacity: 0;
}
.dk-zone-left { left: 0; }
.dk-zone-right { right: 0; }

.dk-footer {
  position: absolute; left: 0; right: 0; bottom: 0; height: 56px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 36px; z-index: 30;
  border-top: 1px solid rgba(148,163,184,.14);
  background: linear-gradient(180deg, rgba(10,13,20,0), rgba(10,13,20,.72));
}
.dk-footer-meta {
  display: flex; align-items: center; gap: 12px;
  font-size: 11.5px; letter-spacing: .06em; color: rgba(238,240,233,.5);
}
.dk-footer-brand {
  font-weight: 800; letter-spacing: .34em; color: rgba(238,240,233,.85); font-size: 11px;
}
.dk-footer-sep { width: 1px; height: 10px; background: rgba(148,163,184,.3); }
.dk-footer-chapter { color: var(--dk-accent); font-weight: 600; }

.dk-dots { display: flex; gap: 7px; align-items: center; }
.dk-dot {
  width: 7px; height: 7px; border-radius: 999px; border: 0; padding: 0; cursor: pointer;
  background: rgba(148,163,184,.28); transition: all .25s ease;
}
.dk-dot-on { background: var(--dk-accent); transform: scale(1.35); }
.dk-dot:hover { background: rgba(238,240,233,.7); }

.dk-footer-ctrl { display: flex; align-items: center; gap: 8px; }
.dk-counter {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 13px; color: var(--dk-accent); margin-right: 6px; letter-spacing: .1em;
}
.dk-counter em { font-style: normal; color: rgba(238,240,233,.35); }
.dk-btn {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(148,163,184,.22);
  background: rgba(148,163,184,.06); color: rgba(238,240,233,.75);
  font-size: 14px; line-height: 1; cursor: pointer; transition: all .2s ease;
  display: inline-flex; align-items: center; justify-content: center;
}
.dk-btn:hover { background: rgba(238,240,233,.14); color: #fff; }

/* ---- 좁은 화면: 캔버스를 줄이지 않고 세로로 흘린다 ---- */
.dk-flow-root { overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
.dk-stage.dk-flow { position: relative; left: auto; top: auto; width: 100%; min-height: 100%; overflow: visible; padding-bottom: 64px; }
.dk-flow .dk-slide { position: relative; inset: auto; }
.dk-flow .dk-chrome { position: relative; inset: auto; }
.dk-flow .dk-progress { position: fixed; }
.dk-flow .dk-footer { position: fixed; padding: 0 10px; background: rgba(10,13,20,.94); }
.dk-flow .dk-footer-meta, .dk-flow .dk-dots { display: none; }
.dk-flow .dk-footer-ctrl { margin-left: auto; gap: 6px; flex-wrap: nowrap; }
.dk-flow .dk-bg-grid, .dk-flow .dk-bg-glow, .dk-flow .dk-bg-noise { position: fixed; }

/* ---- 슬라이드 공용 타이포/모션 유틸 ---- */
.dk-serif { font-family: "Noto Serif KR", "Pretendard Variable", serif; }
.dk-mono {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  letter-spacing: .12em;
}
@keyframes dkRise {
  from { opacity: 0; transform: translateY(26px); }
  to   { opacity: 1; transform: none; }
}
.dk-rise {
  opacity: 0;
  animation: dkRise .7s cubic-bezier(.16,1,.3,1) forwards;
  animation-delay: calc(var(--i, 0) * 90ms + 50ms);
}
@keyframes dkGrowX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.dk-grow {
  transform-origin: left center; transform: scaleX(0);
  animation: dkGrowX .9s cubic-bezier(.16,1,.3,1) forwards;
  animation-delay: calc(var(--i, 0) * 90ms + 200ms);
}
`;
