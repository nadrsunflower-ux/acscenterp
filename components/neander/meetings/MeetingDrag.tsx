"use client";

// ============================================================
//  회의 목록 끌어다 놓기 — 회의를 다른 회의 위에 놓으면 그 회의의 안건이 된다
// ------------------------------------------------------------
//  「새 회의」 로 잘못 만든 문서를 제자리(어느 회의의 안건)로 옮기는 손짓.
//  ⋯ 메뉴의 「다른 회의의 안건으로 묶기」 와 같은 일을 손으로 한다 — 메뉴는
//  키보드·스크린리더 길로 그대로 남는다.
//
//  움직임 (2026-09-21 사용자 요청: 「부드럽고 자연스럽게」):
//    · 누르고 6px 끌면 시작 (그냥 누르면 여는 것). 휴대폰은 0.28초 꾹 누른 뒤.
//    · 카드가 살짝 떠올라(그림자·1.03배) 손가락을 **조금 늦게** 따라온다 — 매
//      프레임 남은 거리의 35%씩 좁혀 끈에 매달린 듯. 옆으로 빨리 끌면 1~3° 기운다.
//    · 놓을 수 있는 회의 위에 오면 그 줄이 빛나며 「안건으로」 가 떠오른다. 카드는
//      그 줄 **바로 아래 안쪽**(안건이 설 자리)으로 끌려가 살짝 작아진다 — 놓으면
//      어디에 들어가는지 미리 보이고, 놓을 곳의 제목을 가리지 않는다.
//    · 놓으면 카드가 **새 자리로 날아가 앉는다** (목록이 다시 그려진 뒤 그 줄의
//      자리를 재서 그리로). 놓을 수 없는 곳이면 제자리로 미끄러져 돌아간다.
//    · 목록 위·아래 끝에 가까이 가면 목록이 저절로 흐른다.
//  움직임 줄이기 설정이면 따라오기·날아가기 없이 바로 놓인다.
//
//  구현은 Pointer Events 로 직접 한다. HTML5 드래그는 끌리는 모습을 거의
//  못 고치고 터치에서 안 된다.
// ============================================================

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ListTree, CornerUpLeft } from "lucide-react";
import { Icon, Portal, cn } from "@/components/neander/ui";
import { formatDateKo } from "@/lib/neander/format";

export interface DragMeta {
  title: string;
  date: string;
  /** 지금 누군가의 안건인가 */
  isAgenda: boolean;
  /** 딸린 안건 수 — 함께 옮겨진다 */
  agendaCount: number;
}

export type DropOver = { kind: "link"; id: string; title: string } | { kind: "unlink" } | null;

interface Options {
  describe: (id: string) => DragMeta | null;
  /** source 를 target 아래에 넣을 수 있는가 (자기 자신·이미 그 아래 등은 안 된다) */
  canLinkTo: (sourceId: string, targetId: string) => boolean;
  onLink: (sourceId: string, targetId: string) => Promise<void>;
  onUnlink: (sourceId: string) => Promise<void>;
}

/** 이만큼 움직여야 끄는 것으로 본다 — 그 전에는 누른 것(열기) */
const START_PX = 6;
/** 휴대폰은 꾹 눌러야 — 그냥 쓸어 넘기는 스크롤과 구별한다 */
const TOUCH_HOLD_MS = 280;
/** 매 프레임 남은 거리의 이만큼 따라간다 — 1 이면 딱 붙고, 작을수록 늦게 따라온다 */
const FOLLOW = 0.35;
/** 날아가 앉기 · 돌아가기 */
const LAND_MS = 380;
/** 목록 끝에서 저절로 흐르기 시작하는 거리 */
const EDGE_PX = 56;
/** 떠 있는 카드 · 놓을 곳에 끌려간 카드 크기 */
const LIFT_SCALE = 1.03;
const TUCK_SCALE = 0.96;
/** 끌려간 카드가 놓을 줄에서 비켜 앉는 자리 — 안건 줄 들여쓰기만큼 안쪽, 줄 아래쪽 */
const TUCK_X = 22;
const TUCK_Y = 0.62;

/**
 * 흐르는 목록 — 큰 화면은 목록 칸(.nd-scroll)이, 휴대폰은 화면 전체가 흐른다.
 * 실제로 흐를 수 있는 가장 가까운 조상을 찾고, 없으면 문서.
 */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** 흐르는 목록이 화면에 보이는 네모 — 문서면 화면 (위는 떠 있는 윗줄만큼 뺀다) */
function viewOf(sc: HTMLElement): DOMRect {
  if (sc === document.scrollingElement || sc === document.documentElement) {
    return new DOMRect(0, EDGE_PX, window.innerWidth, window.innerHeight - EDGE_PX);
  }
  return sc.getBoundingClientRect();
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Session {
  id: string;
  pointerId: number;
  touch: boolean;
  armed: boolean;
  started: boolean;
  /** 놓았거나 취소해 카드가 날아가는 중 — 그 사이의 떼기·Esc 는 무시한다 */
  ending: boolean;
  startX: number;
  startY: number;
  /** 누른 점이 줄 왼쪽 위에서 얼마나 떨어져 있었나 — 카드가 그만큼 비켜 따라온다 */
  offX: number;
  offY: number;
  origin: DOMRect;
  scroller: HTMLElement | null;
  holdTimer?: ReturnType<typeof setTimeout>;
  /** 카드가 지금 그려진 자리 · 가려는 자리 */
  x: number;
  y: number;
  tx: number;
  ty: number;
  tilt: number;
  scale: number;
  /** 카드를 끌어당기는 자리 — 놓을 회의 줄이나 「따로 선 회의로」 자리 */
  magnet: HTMLElement | null;
  pointerX: number;
  pointerY: number;
  raf: number;
}

export function useMeetingDrag(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropOver>(null);
  const overRef = useRef<DropOver>(null);
  /** 방금 내려앉은 줄 — 잠깐 반짝이며 자리 잡는다 */
  const [landedId, setLandedId] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const s = useRef<Session | null>(null);
  /** 끌기를 마친 직후의 클릭은 버린다 — 놓자마자 그 회의가 열리지 않게 */
  const swallowClick = useRef(false);

  // 핸들러는 한 번만 만든다 — 붙일 때와 뗄 때 같은 함수여야 창 이벤트가 새지 않는다.
  // 안에서는 상태를 ref 로만 읽는다.
  const api = useMemo(() => {
    const setOverBoth = (v: DropOver) => {
      const cur = overRef.current;
      const same =
        (cur === null && v === null) ||
        (cur?.kind === "unlink" && v?.kind === "unlink") ||
        (cur?.kind === "link" && v?.kind === "link" && cur.id === v.id);
      if (same) return;
      overRef.current = v;
      setOver(v);
    };

    // ---- 카드 그리기 (매 프레임) ---------------------------------
    const paint = () => {
      const st = s.current;
      const el = ghost.current;
      if (!st) return;
      if (el) {
        // 놓을 곳 위면 그 자리로 끌려간다 (목록이 흘러도 따라가게 매 프레임 잰다)
        let tx = st.tx;
        let ty = st.ty;
        let ts = LIFT_SCALE;
        if (st.magnet?.isConnected) {
          const r = st.magnet.getBoundingClientRect();
          ts = TUCK_SCALE;
          if (st.magnet.hasAttribute("data-unlink-zone")) {
            // 「따로 선 회의로」 글씨를 가리지 않게 그 아래에 매달린다
            tx = r.left + 6;
            ty = r.bottom - 6;
          } else {
            tx = r.left + TUCK_X;
            ty = r.top + r.height * TUCK_Y;
          }
        }
        const k = reducedMotion() ? 1 : FOLLOW;
        const dx = (tx - st.x) * k;
        st.x += dx;
        st.y += (ty - st.y) * k;
        st.scale += (ts - st.scale) * (reducedMotion() ? 1 : 0.25);
        // 옆으로 빨리 끌면 살짝 기운다 — 멈추면 천천히 바로 선다
        st.tilt += (Math.max(-3, Math.min(3, dx * 0.12)) - st.tilt) * 0.2;
        el.style.transform = `translate3d(${st.x}px, ${st.y}px, 0) rotate(${st.tilt}deg) scale(${st.scale})`;
      }
      // 목록 끝에서 저절로 흐르기 — 목록 안에 있을 때만. 「따로 선 회의로」 자리 위에서는
      // 멈춘다 (휴대폰은 그 자리가 화면 위 끝에 붙어 있어, 흐르면 자리가 손가락 밑에서 빠져나간다)
      const sc = st.scroller;
      if (sc && !st.magnet?.hasAttribute("data-unlink-zone")) {
        const r = viewOf(sc);
        // 문서가 흐를 때는 떠 있는 윗줄 위까지 올라가도 위로 흐른다
        const doc = sc === document.scrollingElement || sc === document.documentElement;
        const inside =
          st.pointerX >= r.left && st.pointerX <= r.right && st.pointerY >= (doc ? 0 : r.top) && st.pointerY <= r.bottom;
        if (inside && st.pointerY < r.top + EDGE_PX) sc.scrollTop -= Math.ceil(((r.top + EDGE_PX - st.pointerY) / EDGE_PX) * 12);
        else if (inside && st.pointerY > r.bottom - EDGE_PX) sc.scrollTop += Math.ceil(((st.pointerY - (r.bottom - EDGE_PX)) / EDGE_PX) * 12);
      }
      st.raf = requestAnimationFrame(paint);
    };

    // ---- 무엇 위에 있나 ------------------------------------------
    const hitTest = (x: number, y: number): DropOver => {
      const st = s.current;
      if (!st) return null;
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!hit) return null;
      const meta = optsRef.current.describe(st.id);
      if (hit.closest("[data-unlink-zone]")) return meta?.isAgenda ? { kind: "unlink" } : null;
      const row = hit.closest<HTMLElement>("[data-meeting-row]");
      const target = row?.dataset.meetingRow;
      if (!target || target === st.id || !optsRef.current.canLinkTo(st.id, target)) return null;
      const t = optsRef.current.describe(target);
      return { kind: "link", id: target, title: t?.title || (t ? formatDateKo(t.date) : "") };
    };

    // ---- 끝내기 --------------------------------------------------
    const cleanup = () => {
      const st = s.current;
      if (st) {
        cancelAnimationFrame(st.raf);
        if (st.holdTimer) clearTimeout(st.holdTimer);
      }
      s.current = null;
      document.documentElement.classList.remove("nd-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", blockScroll);
    };

    /** 카드를 rect 자리로 옮기며 (fade 면 흐리게) — 다 가면 끝 */
    const flyTo = (rect: DOMRect | null, fade: boolean) =>
      new Promise<void>((resolve) => {
        const el = ghost.current;
        const st = s.current;
        if (!el || !st || !rect || reducedMotion()) return resolve();
        cancelAnimationFrame(st.raf);
        el.style.transition = `transform ${LAND_MS}ms var(--nd-ease), opacity ${LAND_MS}ms var(--nd-ease), width ${LAND_MS}ms var(--nd-ease)`;
        el.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) rotate(0deg) scale(1)`;
        // 안건 줄은 들여써서 좁다 — 카드도 그 폭으로 줄어들며 앉는다
        el.style.width = `${rect.width}px`;
        if (fade) el.style.opacity = "0";
        setTimeout(resolve, LAND_MS);
      });

    /** 목록이 다시 그려져 그 줄이 새 자리에 설 때까지 — 길어야 0.8초 */
    const waitForRow = async (id: string, from: DOMRect): Promise<DOMRect | null> => {
      const find = () => document.querySelector<HTMLElement>(`[data-meeting-row="${CSS.escape(id)}"]`);
      const until = Date.now() + 800;
      while (Date.now() < until) {
        await new Promise((r) => requestAnimationFrame(r));
        const r = find()?.getBoundingClientRect();
        if (r && (Math.abs(r.top - from.top) > 2 || Math.abs(r.left - from.left) > 2)) return r;
      }
      return find()?.getBoundingClientRect() ?? null;
    };

    /**
     * 새 자리가 목록 밖(위·아래로 가려진 곳)이면 목록을 부드럽게 흘려 보이게 하고,
     * 흐른 뒤 그 줄이 설 자리를 돌려준다 — 카드는 흐름과 함께 그리로 날아간다
     */
    const revealRow = (rect: DOMRect, scroller: HTMLElement | null): DOMRect => {
      if (!scroller) return rect;
      const view = viewOf(scroller);
      const pad = 12;
      // 화면 전체가 흐를 때(휴대폰)는 아래에 뜨는 알림에 가리지 않을 만큼 더 올린다
      const padBottom = scroller === document.scrollingElement || scroller === document.documentElement ? 120 : pad;
      let delta = 0;
      if (rect.bottom > view.bottom - padBottom) delta = rect.bottom - view.bottom + padBottom;
      else if (rect.top < view.top + pad) delta = rect.top - view.top - pad;
      // 목록 끝을 넘어 흐를 수는 없다
      const max = scroller.scrollHeight - scroller.clientHeight;
      delta = Math.max(-scroller.scrollTop, Math.min(max - scroller.scrollTop, delta));
      if (Math.abs(delta) < 1) return rect;
      scroller.scrollBy({ top: delta, behavior: reducedMotion() ? "auto" : "smooth" });
      return new DOMRect(rect.left, rect.top - delta, rect.width, rect.height);
    };

    const finish = async (drop: DropOver) => {
      const st = s.current;
      if (!st || st.ending) return;
      st.ending = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", blockScroll);
      const id = st.id;
      try {
        if (drop?.kind === "link") await optsRef.current.onLink(id, drop.id);
        else if (drop?.kind === "unlink") await optsRef.current.onUnlink(id);
        if (drop) {
          st.magnet = null;
          const rect = await waitForRow(id, st.origin);
          await flyTo(rect && revealRow(rect, st.scroller), true);
          setLandedId(id);
          setTimeout(() => setLandedId((v) => (v === id ? null : v)), 700);
        } else {
          await flyTo(st.origin, false);
        }
      } catch {
        // 저장이 안 됐다 — 제자리로 돌아간다 (이유는 부르는 쪽이 알림으로 알린다)
        await flyTo(st.origin, false);
      } finally {
        setDragId(null);
        setOverBoth(null);
        cleanup();
      }
    };

    // ---- 포인터 --------------------------------------------------
    const start = (st: Session) => {
      st.started = true;
      swallowClick.current = true;
      document.documentElement.classList.add("nd-dragging");
      st.x = st.tx = st.origin.left;
      st.y = st.ty = st.origin.top;
      setDragId(st.id);
      navigator.vibrate?.(8);
      st.raf = requestAnimationFrame(paint);
    };

    function onMove(e: PointerEvent) {
      const st = s.current;
      if (!st || e.pointerId !== st.pointerId) return;
      st.pointerX = e.clientX;
      st.pointerY = e.clientY;
      if (!st.started) {
        const dist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
        if (dist < START_PX) return;
        // 휴대폰에서 꾹 누르기 전에 움직였다 — 끌기가 아니라 스크롤이다
        if (!st.armed) return cleanup();
        start(st);
      }
      st.tx = e.clientX - st.offX;
      st.ty = e.clientY - st.offY;
      const drop = hitTest(e.clientX, e.clientY);
      setOverBoth(drop);
      st.magnet =
        drop?.kind === "link"
          ? document.querySelector<HTMLElement>(`[data-meeting-row="${CSS.escape(drop.id)}"]`)
          : drop?.kind === "unlink"
            ? document.querySelector<HTMLElement>("[data-unlink-zone]")
            : null;
    }

    function onUp(e: PointerEvent) {
      const st = s.current;
      if (!st || e.pointerId !== st.pointerId) return;
      if (!st.started) return cleanup();
      void finish(hitTest(e.clientX, e.clientY));
    }

    function onCancel() {
      const st = s.current;
      if (!st) return;
      if (!st.started) return cleanup();
      void finish(null);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && s.current?.started) void finish(null);
    }

    /** 끄는 동안 휴대폰 화면이 같이 스크롤되지 않게 */
    function blockScroll(e: TouchEvent) {
      if (s.current?.started) e.preventDefault();
    }

    const onPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0 || s.current) return;
      const row = e.currentTarget;
      const rect = row.getBoundingClientRect();
      const touch = e.pointerType === "touch";
      const st: Session = {
        id,
        pointerId: e.pointerId,
        touch,
        armed: !touch,
        started: false,
        ending: false,
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - rect.left,
        offY: e.clientY - rect.top,
        origin: rect,
        scroller: scrollParent(row),
        x: rect.left,
        y: rect.top,
        tx: rect.left,
        ty: rect.top,
        tilt: 0,
        scale: LIFT_SCALE,
        magnet: null,
        pointerX: e.clientX,
        pointerY: e.clientY,
        raf: 0,
      };
      if (touch) {
        st.holdTimer = setTimeout(() => {
          if (s.current !== st) return;
          st.armed = true;
          start(st); // 꾹 누르면 움직이기 전에 바로 떠오른다
        }, TOUCH_HOLD_MS);
      }
      s.current = st;
      swallowClick.current = false;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      window.addEventListener("touchmove", blockScroll, { passive: false });
    };

    return { onPointerDown, cleanup };
  }, []);

  useEffect(() => () => api.cleanup(), [api]);

  /** 목록 줄에 붙일 것 */
  const bind = (id: string) => ({
    "data-meeting-row": id,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => api.onPointerDown(e, id),
    // 휴대폰에서 꾹 누르면 뜨는 메뉴 대신 끌기가 시작된다
    onContextMenu: (e: React.MouseEvent) => {
      if (s.current?.touch) e.preventDefault();
    },
    // 끌고 놓은 직후 따라오는 클릭은 여는 것이 아니다
    onClickCapture: (e: React.MouseEvent) => {
      if (swallowClick.current) {
        e.preventDefault();
        e.stopPropagation();
        swallowClick.current = false;
      }
    },
  });

  const meta = dragId ? opts.describe(dragId) : null;

  const ghostNode = dragId && meta && (
    <Portal>
      <div
        ref={ghost}
        aria-hidden
        className="nd-drag-ghost pointer-events-none fixed left-0 top-0 z-nd-toast"
        style={{ width: s.current?.origin.width, transform: `translate3d(${s.current?.origin.left ?? 0}px, ${s.current?.origin.top ?? 0}px, 0)` }}
      >
        <div className="rounded-nd-md border border-nd-line bg-nd-content px-3 py-2.5 shadow-nd-pop">
          <p className="truncate text-nd-body font-semibold text-nd-fg">{meta.title || "제목 없는 회의"}</p>
          <p className="nd-num mt-0.5 truncate text-nd-caption text-nd-fg-3">
            {formatDateKo(meta.date)}
            {meta.agendaCount > 0 && ` · 안건 ${meta.agendaCount}건도 함께`}
          </p>
          {/* 어디에 놓이는지 — 카드가 말해 준다 */}
          <p
            className={cn(
              "mt-1.5 flex items-center gap-1 overflow-hidden text-nd-caption font-medium transition-[max-height,opacity] duration-nd ease-nd",
              over ? "max-h-6 opacity-100" : "max-h-0 opacity-0",
              over?.kind === "unlink" ? "text-nd-fg-2" : "text-nd-accent-strong",
            )}
          >
            <Icon icon={over?.kind === "unlink" ? CornerUpLeft : ListTree} size={12} className="shrink-0" />
            <span className="truncate">
              {over?.kind === "link" ? `「${over.title}」 의 안건으로` : over?.kind === "unlink" ? "따로 선 회의로" : ""}
            </span>
          </p>
        </div>
      </div>
    </Portal>
  );

  return {
    dragId,
    over,
    landedId,
    /** 안건을 끌고 있다 — 「따로 선 회의로」 자리를 보인다 */
    draggingAgenda: !!meta?.isAgenda,
    bind,
    ghost: ghostNode,
  };
}

/** 안건을 끌 때만 목록 위에 펼쳐지는 자리 — 여기 놓으면 따로 선 회의가 된다 */
export function UnlinkZone({ open, active }: { open: boolean; active: boolean }) {
  return (
    <div className={cn("nd-unlink-zone grid transition-[grid-template-rows] duration-nd ease-nd", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
      <div className="min-h-0 overflow-hidden">
        <div
          data-unlink-zone
          className={cn(
            "mx-2 mb-2 flex items-center justify-center gap-1.5 rounded-nd-md border-2 border-dashed py-3 text-nd-caption font-medium transition-colors duration-nd ease-nd",
            active ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong" : "border-nd-border text-nd-fg-3",
          )}
        >
          <Icon icon={CornerUpLeft} size={13} />
          여기에 놓으면 따로 선 회의로
        </div>
      </div>
    </div>
  );
}
