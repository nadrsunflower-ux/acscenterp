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
// ============================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

export interface DeckSlide {
  id: string;
  /** 하단에 표시되는 챕터 라벨 (예: "스모트 — 마케팅") */
  chapter?: string;
  render: () => ReactNode;
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
}

const W = 1280;
const H = 720;

export function Deck({ meta, slides }: { meta: DeckMeta; slides: DeckSlide[] }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(0); // 0 = 측정 전 (초기 플래시 방지)

  const count = slides.length;
  const clamp = useCallback(
    (n: number) => Math.max(0, Math.min(count - 1, n)),
    [count],
  );
  const go = useCallback((n: number) => setIndex((_) => clamp(n)), [clamp]);
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);
  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);

  // 화면 크기에 맞춰 1280×720 캔버스 스케일 계산
  useEffect(() => {
    const update = () =>
      setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
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
      switch (e.key) {
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
  }, [next, prev, go, count, toggleFullscreen, exit]);

  // 빈 덱 방어 + slides 가 줄어들어도 범위 밖 접근 금지
  if (count === 0) return null;
  const slide = slides[clamp(index)];
  const progress = count > 1 ? clamp(index) / (count - 1) : 1;

  return (
    <div ref={rootRef} className="dk-root" style={{ "--dk-accent": meta.accent } as React.CSSProperties}>
      {/* 표제 서체 (Noto Serif KR) — 실패해도 Pretendard 로 자연스럽게 폴백 */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700;900&display=swap"
      />
      {/* style 자식 텍스트는 SSR 시 HTML 이스케이프되어 CSS 가 깨진다 → innerHTML 로 주입 */}
      <style dangerouslySetInnerHTML={{ __html: DECK_CSS }} />

      <div
        className="dk-stage"
        style={{ transform: `translate(-50%, -50%) scale(${scale})`, opacity: scale ? 1 : 0 }}
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

        {/* 좌/우 클릭존 (푸터 컨트롤보다 아래 레이어) */}
        <button className="dk-zone dk-zone-left" onClick={prev} aria-label="이전 슬라이드" tabIndex={-1} />
        <button className="dk-zone dk-zone-right" onClick={next} aria-label="다음 슬라이드" tabIndex={-1} />

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
.dk-root {
  position: fixed; inset: 0; z-index: 100;
  background: #04060a;
  font-family: "Pretendard Variable", Pretendard, sans-serif;
  cursor: default;
}
.dk-stage {
  position: absolute; left: 50%; top: 50%;
  width: ${W}px; height: ${H}px;
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
