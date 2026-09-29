"use client";

// ============================================================
//  인감 이미지 — 로그인한 채로 받아 data: URL 로 들고 있는다
// ------------------------------------------------------------
//  도장은 api/neander/finance/seals/{id} 가 신원을 확인한 뒤에만 내준다.
//  <img src> 로는 토큰을 못 싣기 때문에 fetch 로 받아 data: URL 로 바꾼다.
//  blob: URL 이 아니라 data: URL 인 이유 — 인쇄는 시트 HTML 을 새 창에
//  옮겨 적는다(quote-pdf.ts). data: URL 은 글자 그대로 따라가서 창이 바뀌어도
//  깨지지 않는다.
//
//  받은 것은 탭이 살아 있는 동안 기억한다. 인쇄용 시트는 flushSync 로
//  한 번에 그려지므로(printableQuoteHtml) 그 순간 이미 기억에 있어야
//  도장이 찍힌다 — 그래서 견적 목록이 뜰 때 preloadSeals 로 미리 받는다.
// ============================================================

import { useEffect, useState } from "react";
import { getNeanderAuth } from "@/lib/neander/firebase";
import { SEALS } from "./supplier";

/** id → data: URL. null 은 「올라가 있지 않음(404)」 — 다시 묻지 않는다 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export type SealImageState = "loading" | "ready" | "missing";

/** 이미 받아 둔 것 — 없으면 undefined (아직 모름) */
export const cachedSealImage = (id: string): string | null | undefined => cache.get(id);

export function loadSealImage(id: string): Promise<string | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!);
  const running = inflight.get(id);
  if (running) return running;

  const p = (async () => {
    const user = getNeanderAuth().currentUser;
    if (!user) return null; // 로그인 전 — 기억하지 않고 다음에 다시 묻는다
    const res = await fetch(`/api/neander/finance/seals/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: "no-store",
    });
    if (res.status === 404) {
      cache.set(id, null);
      return null;
    }
    if (!res.ok) return null; // 권한·일시 오류 — 기억하지 않는다
    const blob = await res.blob();
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    cache.set(id, url);
    return url;
  })()
    .catch(() => null)
    .finally(() => inflight.delete(id));

  inflight.set(id, p);
  return p;
}

/** 등록된 도장을 모두 미리 받는다 — 편집창 없이 목록에서 곧장 인쇄하는 길 */
export function preloadSeals(): void {
  SEALS.forEach((s) => void loadSealImage(s.id));
}

/** 시트가 쓰는 자리. id 가 없으면(「찍지 않음」) 늘 missing */
export function useSealImage(id: string | undefined): { src: string | null; state: SealImageState } {
  // 받기가 끝났는데 기억에 없으면(권한·일시 오류) 그 id 는 이번엔 못 받은 것
  const [failed, setFailed] = useState<string | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!id || cache.has(id)) return;
    let alive = true;
    void loadSealImage(id).then((url) => {
      if (!alive) return;
      if (url === null && !cache.has(id)) setFailed(id);
      bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!id) return { src: null, state: "missing" };
  const known = cachedSealImage(id);
  if (known === undefined) return { src: null, state: failed === id ? "missing" : "loading" };
  return known ? { src: known, state: "ready" } : { src: null, state: "missing" };
}
