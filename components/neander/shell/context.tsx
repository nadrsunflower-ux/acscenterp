"use client";

// ============================================================
//  셸 컨텍스트 — 사이드바 상태 · 드로어 · 배지 · 툴바 슬롯
// ------------------------------------------------------------
//  페이지는 ToolbarPortal 로 상단 툴바 오른쪽에 컨트롤(월 선택·검색·
//  재무 비서)을 올리고, 모듈 레이아웃은 setBadge 로 사이드바 건수를
//  갱신한다. 상태는 여기 한 곳에만 둔다.
// ============================================================
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "@/components/neander/ui";
import type { BadgeKey } from "./nav-config";

/** 사이드바 접힘 저장 키 — 기기별 취향이라 localStorage */
const SIDEBAR_KEY = "neander.sidebar.collapsed";

interface ShellValue {
  /** <768: 사이드바 대신 드로어 */
  isMobile: boolean;
  collapsed: boolean;
  toggleCollapsed: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  badges: Partial<Record<BadgeKey, number>>;
  setBadge: (key: BadgeKey, n: number) => void;
  toolbarEl: HTMLElement | null;
  setToolbarEl: (el: HTMLElement | null) => void;
  /** 오른쪽에 도킹된 패널(재무 비서)이 차지하는 폭 — 상단바·본문이 함께 비켜선다 */
  dockWidth: number;
  setDockWidth: (px: number) => void;
  /**
   * 집중 모드 — 사이드바·상단바·본문 여백을 전부 걷어내고 페이지가 창을
   * 꽉 채운다 (원장을 엑셀처럼 쓰고 싶을 때). 페이지가 useShellFocus 로
   * 켜고, 페이지를 떠나면 저절로 꺼진다.
   */
  focus: boolean;
  setFocus: (v: boolean) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(max-width: 1023px)");

  // 초기값은 펼침, 마운트 후 저장값을 읽는다 (SSR 불일치 방지).
  // 저장값이 없으면 태블릿 폭에서는 접힌 채로 시작한다.
  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved === "1" || saved === "0") setCollapsed(saved === "1");
      else setCollapsed(isTablet);
    } catch {
      /* 저장소 접근 불가 — 기본값 유지 */
    }
    setRestored(true);
  }, [isTablet]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* noop */
      }
      return !c;
    });
  }, []);

  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const [badges, setBadges] = useState<Partial<Record<BadgeKey, number>>>({});
  const setBadge = useCallback((key: BadgeKey, n: number) => {
    setBadges((b) => (b[key] === n ? b : { ...b, [key]: n }));
  }, []);

  const [toolbarEl, setToolbarEl] = useState<HTMLElement | null>(null);
  const [dockWidth, setDockWidth] = useState(0);
  const [focus, setFocus] = useState(false);

  const value = useMemo<ShellValue>(
    () => ({
      isMobile,
      collapsed: restored ? collapsed : false,
      toggleCollapsed,
      drawerOpen,
      setDrawerOpen,
      badges,
      setBadge,
      toolbarEl,
      setToolbarEl,
      dockWidth,
      setDockWidth,
      focus,
      setFocus,
    }),
    [isMobile, collapsed, restored, toggleCollapsed, drawerOpen, badges, setBadge, toolbarEl, dockWidth, focus],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}

/** 셸 밖(로그인·상태 화면)에서도 안전하게 — 없으면 null */
export function useShellOptional(): ShellValue | null {
  return useContext(ShellContext);
}

/**
 * 상단 툴바 오른쪽에 컨트롤을 올린다. 페이지가 언마운트되면 함께 사라진다.
 * 여러 페이지 요소가 동시에 올릴 수 있으므로 순서는 마운트 순서다.
 */
export function ToolbarPortal({ children, order = 5 }: { children: ReactNode; order?: number }) {
  const shell = useShellOptional();
  if (!shell?.toolbarEl) return null;
  // 마운트 순서와 무관하게 자리를 정한다 (월 선택 0 → … → 비서 10)
  return createPortal(
    <div className="flex shrink-0 items-center gap-2" style={{ order }}>
      {children}
    </div>,
    shell.toolbarEl,
  );
}

/** 오른쪽 도킹 패널이 열려 있는 동안 셸이 그만큼 비켜선다 (언마운트·닫힘이면 0) */
export function useDockReservation(px: number) {
  const shell = useShellOptional();
  const set = shell?.setDockWidth;
  useEffect(() => {
    set?.(px);
    return () => set?.(0);
  }, [set, px]);
}

/**
 * 페이지가 집중 모드를 켠다. 켜져 있는 동안 셸이 사이드바·상단바를 감추고
 * 본문 여백을 없앤다. 페이지가 언마운트되면(다른 메뉴로 가면) 꺼진다 —
 * 원장에서 켠 전체화면이 대시보드까지 따라오면 길을 잃는다.
 */
export function useShellFocus(enabled: boolean) {
  const shell = useShellOptional();
  const set = shell?.setFocus;
  useEffect(() => {
    set?.(enabled);
    return () => set?.(false);
  }, [set, enabled]);
}

/** 모듈 레이아웃이 사이드바 배지를 갱신할 때 */
export function useSidebarBadge(key: BadgeKey, count: number) {
  const shell = useShellOptional();
  const set = shell?.setBadge;
  useEffect(() => {
    set?.(key, count);
    return () => set?.(key, 0);
  }, [set, key, count]);
}
