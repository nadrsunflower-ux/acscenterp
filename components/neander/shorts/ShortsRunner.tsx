"use client";

// ============================================================
//  쇼츠 실행기 (화면 쪽) — 열린 ERP 가 서버 작업을 한 단계씩 밀어 준다
// ------------------------------------------------------------
//  Vercel Cron 은 하루 한 번이라 AI 생성 확인 · 예약 게시를 제때 하려면 누군가
//  실행기(tick)를 불러야 한다. 이 컴포넌트가 그 일을 한다 — 단, 이 브라우저가
//  서버 작업을 만들었거나(신호: localStorage) 쇼츠 화면을 보고 있을 때만.
//  그 밖의 화면에서는 아무것도 안 부른다 (다른 팀원의 ERP 에 부담이 없다).
//
//  tick 결과(내 작업 목록)는 창 이벤트로 흘려보내 쇼츠 화면이 받아 쓴다.
//  결과 확인이 필요한 일(불확실 · 실패)은 사이드바 배지로 센다.
// ============================================================

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "@/components/neander/shell/context";
import { PENDING_KEY, shortsPost } from "@/lib/neander/shorts/client";
import type { JobView } from "@/lib/neander/shorts/types";

export const JOBS_EVENT = "neander-shorts-jobs";

const attention = (jobs: JobView[]) =>
  jobs.filter((j) => (j.status === "uncertain" || j.status === "failed") && (j.finishedAt ?? 0) > Date.now() - 3 * 86_400_000).length;

export function ShortsRunner() {
  const pathname = usePathname();
  const { setBadge } = useShell();
  const onShorts = pathname.startsWith("/neander/shorts");
  const timer = useRef<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    const pendingUntil = () => {
      try {
        return Number(localStorage.getItem(PENDING_KEY)) || 0;
      } catch {
        return 0;
      }
    };
    const schedule = (ms: number) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(run, Math.max(5_000, Math.min(ms, 300_000)));
    };
    const run = async () => {
      if (stopped) return;
      const active = onShorts || pendingUntil() > Date.now();
      if (!active) return; // 신호가 생기면(이벤트) 다시 깨운다
      if (document.visibilityState !== "visible" || busy.current) return schedule(20_000);
      busy.current = true;
      try {
        const r = await shortsPost<{ ran: number; next: number | null; jobs: JobView[] }>("jobs", { action: "tick" });
        window.dispatchEvent(new CustomEvent(JOBS_EVENT, { detail: r.jobs }));
        setBadge("shorts-attention", attention(r.jobs));
        const live = r.jobs.some((j) => ["queued", "running", "waiting"].includes(j.status));
        if (!live && !onShorts) {
          try {
            localStorage.removeItem(PENDING_KEY);
          } catch {
            /* noop */
          }
        }
        schedule(r.next ? r.next - Date.now() + 1_000 : live ? 20_000 : 60_000);
      } catch {
        // 권한 없음 · 일시 오류 — 조용히 늦춰서 다시 (알림은 쇼츠 화면이 띄운다)
        schedule(60_000);
      } finally {
        busy.current = false;
      }
    };
    const wake = () => schedule(1_500);
    window.addEventListener("neander-shorts-pending", wake);
    document.addEventListener("visibilitychange", wake);
    schedule(onShorts ? 1_000 : 4_000);
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
      window.removeEventListener("neander-shorts-pending", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [onShorts, setBadge]);

  return null;
}
