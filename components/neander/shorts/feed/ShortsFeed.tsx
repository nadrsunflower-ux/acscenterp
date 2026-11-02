"use client";

// ============================================================
//  쇼츠처럼 보기 — 공용 드로어 (AI 레이더 · 바이럴 형식)
// ------------------------------------------------------------
//  오른쪽 드로어에 한 칸 = 한 편(스냅 스크롤). 넘기기는 휠 · 터치 · ↑↓(PageUp/Down · J/K) · 머리의 버튼.
//  플레이어는 보고 있는 칸에만 띄우고 앞뒤 두 칸까지만 그린다. 칸 안의 정보는 화면마다 renderSlide 로.
//  마지막으로 본 영상을 브라우저에 기억해 「이어 보기」 를 한다(useFeedResume).
//  2026-11-02 AI 레이더(RadarPanel)에서 떼어 냄 — 동작은 그대로.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUp, ExternalLink, Film, GalleryVerticalEnd, Play } from "lucide-react";
import { EmptyState, IconButton, Sheet } from "@/components/neander/ui";

export type FeedGroup<T> = { key: string; items: T[] };

/** YouTube 의 같은 영상 큰 썸네일 (mq 320×180 → hq 480×360) */
export const hqOf = (u: string) => (/^https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/mqdefault\.jpg$/.test(u) ? u.replace(/mqdefault\.jpg$/, "hqdefault.jpg") : u);

/** 드로어 폭 — 화면 높이에 맞춘 세로 영상(9:16) + 오른쪽 정보 칸 */
export function useFeedWidth() {
  const [w, setW] = useState(1000);
  useEffect(() => {
    const calc = () => {
      const videoW = Math.max(0, window.innerHeight - 64 - 32) * (9 / 16);
      setW(Math.round(Math.min(1320, Math.max(760, videoW + 32 + 20 + 430))));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return w;
}

type FeedLast = { id: string; at: number };

/** 마지막으로 본 영상 (이 브라우저 · 화면마다 열쇠) — 다시 열 때 「이어 보기 · N번째」 */
export function useFeedResume(storageKey: string): { last: FeedLast | null; onSeen: (id: string) => void } {
  const [last, setLast] = useState<FeedLast | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const v = raw ? (JSON.parse(raw) as Partial<FeedLast>) : null;
      setLast(v && typeof v.id === "string" ? { id: v.id, at: Number(v.at) || 0 } : null);
    } catch {
      setLast(null);
    }
  }, [storageKey]);
  const onSeen = useCallback(
    (id: string) => {
      const v = { id, at: Date.now() };
      setLast(v);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(v));
      } catch {
        /* 기억 못 해도 보기는 그대로 */
      }
    },
    [storageKey],
  );
  return { last, onSeen };
}

export interface FeedSlideArgs<T> {
  item: T;
  group: T[];
  active: boolean;
  /** 묶음 안의 다른 영상으로 바꾼다 */
  onPick: (id: string) => void;
  /** 이 칸으로 넘긴다 (썸네일을 눌렀을 때) */
  onFocus: () => void;
}

/**
 * 영상을 쇼츠처럼 한 편씩 — 한 칸이 드로어 높이 전체(스냅 스크롤).
 * 순서는 부르는 화면이 준 groups 순서(그 화면의 필터 · 정렬).
 */
export function ShortsFeedSheet<T extends { id: string }>({
  startId,
  groups,
  onClose,
  onSeen,
  renderSlide,
  ariaLabel = "쇼츠처럼 보기",
  hint = "휠 · ↑↓ 넘기기 · 스페이스 재생/정지 · M 소리",
  emptyTitle = "넘겨 볼 영상이 없습니다",
  emptyDescription = "필터를 풀거나 다른 탭을 고르세요.",
  onKey,
}: {
  /** 처음 보여 줄 영상 id (null = 닫힘) */
  startId: string | null;
  groups: FeedGroup<T>[];
  onClose: () => void;
  onSeen?: (id: string) => void;
  renderSlide: (a: FeedSlideArgs<T>) => ReactNode;
  ariaLabel?: string;
  hint?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** 화면마다 더 받는 키 (예: 레이더의 1 · 2 · 0 촬영 표시) — 처리했으면 true */
  onKey?: (key: string, item: T, e: KeyboardEvent) => boolean;
}) {
  const width = useFeedWidth();
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pending = useRef<number | null>(null);
  // 묶음 안에서 고른 영상 (묶음 열쇠 → 영상 id)
  const [picked, setPicked] = useState<Record<string, string>>({});
  const open = !!startId;
  const cur = Math.max(0, Math.min(active, groups.length - 1));

  // 열 때 — 누른 영상 칸으로 바로 간다 (부드럽게 말고 즉시)
  useEffect(() => {
    if (!startId) return;
    const idx = Math.max(0, groups.findIndex((g) => g.items.some((x) => x.id === startId)));
    const g = groups[idx];
    setPicked(g && g.items[0].id !== startId ? { [g.key]: startId } : {});
    activeRef.current = idx;
    setActive(idx);
    pending.current = idx;
    if (scroller.current) {
      scroller.current.scrollTop = idx * scroller.current.clientHeight;
      pending.current = null;
    }
    // 열 때 한 번만 — 넘기는 동안 목록이 바뀌어도(제외 등) 다시 옮기지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId]);
  // 휠 · 트랙패드 — 한 번 굴리면 한 편. 관성으로 이어지는 휠은 멈출 때까지 한 번으로 친다.
  // (스냅만 두면 한 칸보다 짧은 휠은 제자리로 돌아가고, 트랙패드 관성은 여러 칸을 넘긴다)
  const goRef = useRef<(d: number) => void>(() => undefined);
  const wheel = useRef({ acc: 0, lockedAt: 0, last: 0, locked: false });
  const onWheel = useCallback((e: WheelEvent) => {
    const el = scroller.current;
    if (!el || e.ctrlKey) return;
    // 정보 칸처럼 스스로 더 굴러갈 수 있는 상자 안이면 그 상자를 먼저 굴린다
    for (let n = e.target as HTMLElement | null; n && n !== el; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) {
        if ((e.deltaY > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) || (e.deltaY < 0 && n.scrollTop > 0)) return;
      }
    }
    e.preventDefault();
    const w = wheel.current;
    const now = performance.now();
    if (w.locked && now - w.last > 220 && now - w.lockedAt > 450) w.locked = false;
    w.last = now;
    if (w.locked) return;
    w.acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(w.acc) >= 24) {
      goRef.current(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.locked = true;
      w.lockedAt = now;
    }
  }, []);
  // 드로어는 포털이라 칸 상자가 늦게 붙는다 — 붙는 순간 위치를 맞추고 휠을 건다(passive: false 라야 막을 수 있다)
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current?.removeEventListener("wheel", onWheel);
      scroller.current = el;
      if (!el) return;
      el.addEventListener("wheel", onWheel, { passive: false });
      if (pending.current !== null) {
        el.scrollTop = pending.current * el.clientHeight;
        pending.current = null;
      }
    },
    [onWheel],
  );

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
    }
  };
  const go = useCallback(
    (d: number) => {
      const el = scroller.current;
      if (!el) return;
      const next = Math.max(0, Math.min(groups.length - 1, activeRef.current + d));
      el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
    },
    [groups.length],
  );
  goRef.current = go;
  // 지금 보는 영상 — 다음에 열 때 여기서 이어 보게 기억한다
  const curItem = groups[cur] ? (groups[cur].items.find((x) => x.id === picked[groups[cur].key]) ?? groups[cur].items[0]) : null;
  useEffect(() => {
    if (open && curItem) onSeen?.(curItem.id);
  }, [open, curItem?.id, onSeen]); // eslint-disable-line react-hooks/exhaustive-deps
  const curRef = useRef(curItem);
  curRef.current = curItem;
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key;
      if (curRef.current && onKeyRef.current?.(k, curRef.current, e)) return;
      const d = k === "ArrowDown" || k === "PageDown" || k === "j" || k === "ArrowRight" ? 1 : k === "ArrowUp" || k === "PageUp" || k === "k" || k === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      go(d);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, go]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={width}
      ariaLabel={ariaLabel}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>쇼츠처럼 보기</span>
          <span className="nd-num text-[13px] font-normal text-nd-fg-2" aria-live="polite">
            {groups.length ? `${cur + 1} / ${groups.length}` : "0 / 0"}
          </span>
          <span className="inline-flex items-center gap-1">
            <IconButton icon={ChevronUp} label="이전 (↑)" variant="secondary" size="sm" data-feed-key disabled={cur <= 0} onClick={() => go(-1)} />
            <IconButton icon={ChevronDown} label="다음 (↓)" variant="secondary" size="sm" data-feed-key disabled={cur >= groups.length - 1} onClick={() => go(1)} />
            <IconButton
              icon={ChevronsUp}
              label="처음으로"
              variant="secondary"
              size="sm"
              data-feed-key
              disabled={cur <= 0}
              onClick={() => {
                if (scroller.current) scroller.current.scrollTop = 0;
              }}
            />
          </span>
          <span className="hidden text-[13px] font-normal text-nd-fg-3 md:inline">{hint}</span>
        </span>
      }
    >
      {groups.length === 0 ? (
        <div className="p-5">
          <EmptyState compact icon={GalleryVerticalEnd} title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div ref={setScroller} onScroll={onScroll} data-shorts-feed data-feed-key className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain">
          {groups.map((g, idx) => {
            const near = Math.abs(idx - cur) <= 2;
            const item = g.items.find((x) => x.id === picked[g.key]) ?? g.items[0];
            return (
              <section key={g.key} data-feed-slide={idx} aria-label={`${idx + 1}번째`} className="h-full snap-start snap-always">
                {near &&
                  renderSlide({
                    item,
                    group: g.items,
                    active: idx === cur,
                    onPick: (id) => setPicked((p) => ({ ...p, [g.key]: id })),
                    onFocus: () => go(idx - activeRef.current),
                  })}
              </section>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/** 쇼츠 한 칸 — 왼쪽 세로 영상, 오른쪽(좁으면 아래) 정보 */
export function FeedSlideLayout({ video, children }: { video: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 pt-0 sm:flex-row sm:gap-5">
      <div className="flex min-h-0 flex-1 items-center justify-center sm:h-full sm:flex-none">
        <div className="relative aspect-[9/16] h-full max-w-full overflow-hidden rounded-nd-lg bg-black">{video}</div>
      </div>
      <div className="flex max-h-[46%] min-w-0 flex-col gap-3 overflow-y-auto sm:h-full sm:max-h-none sm:flex-1">{children}</div>
    </div>
  );
}

/**
 * 세로 영상 칸 — 보고 있는 칸이면 YouTube 플레이어, 아니면 썸네일(누르면 이 칸으로).
 * YouTube 가 아닌 영상(틱톡 · 더우인 등)은 썸네일과 「원본 열기」 만 — 이 화면에서 틀 수 없다.
 */
export function FeedVideo({ active, videoId, thumbnail, title, url, onFocus }: { active: boolean; videoId: string | null; thumbnail: string | null | undefined; title: string; url: string; onFocus: () => void }) {
  if (active && videoId) return <FeedPlayer key={videoId} videoId={videoId} title={title} />;
  return (
    <>
      <button type="button" onClick={onFocus} aria-label={`${title} — 이 영상으로 넘기기`} className="group block h-full w-full">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hqOf(thumbnail)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-80" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-white/60">
            <Film size={32} aria-hidden />
          </span>
        )}
        {videoId && (
          <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden>
            <Play size={24} fill="currentColor" className="ml-1" />
          </span>
        )}
      </button>
      {!videoId && active && (
        <a href={url} target="_blank" rel="noreferrer" className="absolute inset-x-4 bottom-4 inline-flex items-center justify-center gap-1.5 rounded-nd-md bg-black/70 px-3 py-2 text-[13px] font-medium text-white hover:bg-black/80">
          이 화면에서 틀 수 없는 영상 — 원본 열기 <ExternalLink size={13} aria-hidden />
        </a>
      )}
    </>
  );
}

const YT_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * 보고 있는 칸의 플레이어 — YouTube 퍼가기 위에 투명한 층을 깐다.
 * 층이 휠 · 스와이프를 받아 다음 편으로 넘기고(iframe 은 휠을 바깥으로 넘겨주지 않는다), 누르면 재생/정지.
 * 재생 · 소리(M)는 YouTube 플레이어 API(postMessage · enablejsapi)로 보낸다. 위 아이콘 줄(소리 · 자막 · 설정)과
 * 아래 진행 막대 줄은 층을 비워 YouTube 것을 그대로 쓴다.
 * 층을 눌러도 키보드가 iframe 으로 가지 않아 ↑↓ · 스페이스 · M 이 계속 듣는다.
 */
export function FeedPlayer({ videoId, title }: { videoId: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState(-1); // -1 시작 전 · 0 끝 · 1 재생 · 2 정지 · 3 버퍼링 · 5 대기
  const [muted, setMuted] = useState(false);
  const [stalled, setStalled] = useState(false);
  const known = useRef(false); // 플레이어가 상태를 알려 오는가 (안 오면 누를 때마다 번갈아 보낸다)
  const [guess, setGuess] = useState(true);
  const send = useCallback((func: string) => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), YT_ORIGIN), []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== ref.current?.contentWindow) return;
      let d: { event?: string; info?: unknown } | null = null;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = d?.info as { playerState?: number; muted?: boolean } | number | undefined;
      if (d?.event === "onStateChange" && typeof info === "number") {
        known.current = true;
        setState(info);
      }
      if (d?.event === "infoDelivery" && info && typeof info === "object") {
        if (typeof info.playerState === "number") {
          known.current = true;
          setState(info.playerState);
        }
        if (typeof info.muted === "boolean") setMuted(info.muted);
      }
    };
    window.addEventListener("message", onMsg);
    const t = window.setTimeout(() => setStalled(true), 2500);
    return () => {
      window.removeEventListener("message", onMsg);
      window.clearTimeout(t);
    };
  }, []);
  const playing = known.current ? state === 1 || state === 3 : guess;
  const toggle = useCallback(() => {
    if (known.current) send(state === 1 || state === 3 ? "pauseVideo" : "playVideo");
    else {
      send(guess ? "pauseVideo" : "playVideo");
      setGuess(!guess);
      setStalled(false);
    }
  }, [send, state, guess]);
  const toggleMute = useCallback(() => {
    send(muted ? "unMute" : "mute");
    setMuted(!muted);
  }, [send, muted]);
  useEffect(() => {
    const typing = (t: HTMLElement | null) => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    // 스페이스는 쇼츠처럼 늘 재생/정지 — 넘기기 버튼 · 영상 층 · 드로어 바탕에 포커스가 있어도. (저장 · 제외 같은 버튼은 그대로 스페이스로 누른다)
    const spaceIsPlayer = (t: HTMLElement | null) => !t || t === document.body || t.getAttribute("role") === "dialog" || !!t.closest("[data-feed-key]");
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (typing(t)) return;
      if (e.key === " " && spaceIsPlayer(t)) {
        e.preventDefault();
        if (!e.repeat) toggle();
      } else if (e.key === "m" || e.key === "M") toggleMute();
    };
    // 버튼은 스페이스를 뗄 때 눌리므로 그것도 막는다
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " " && !typing(e.target as HTMLElement | null) && spaceIsPlayer(e.target as HTMLElement | null)) e.preventDefault();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [toggle, toggleMute]);
  const showPlay = known.current ? state === 2 || state === 5 || (state === -1 && stalled) : !guess;
  return (
    <>
      <iframe
        ref={ref}
        src={`${YT_ORIGIN}/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${videoId}&enablejsapi=1&origin=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin : "")}`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        onLoad={() => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: videoId, channel: "widget" }), YT_ORIGIN)}
        className="h-full w-full"
      />
      <button
        type="button"
        data-feed-overlay
        data-feed-key
        onClick={toggle}
        aria-label={playing ? "일시정지 (스페이스)" : "재생 (스페이스)"}
        className="absolute inset-x-0 bottom-14 top-14 flex items-center justify-center bg-transparent"
      >
        {showPlay && (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden>
            <Play size={28} fill="currentColor" className="ml-1" />
          </span>
        )}
      </button>
    </>
  );
}
