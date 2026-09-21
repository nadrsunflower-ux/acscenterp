"use client";

// ============================================================
//  회의 기록 클라이언트 — 서버 API 경유 (app/api/neander/meetings/log)
// ------------------------------------------------------------
//  회의 문서는 브라우저가 Firestore 에 직접 쓰지만(보안 규칙이 있다), 기록은
//  서버를 거친다 — 남기는 사람 이름을 브라우저가 고르지 못하게 하려고.
// ============================================================

import { getNeanderAuth } from "@/lib/neander/firebase";
import type { MeetingEvent, MeetingEventKind } from "./log";

const BASE = "/api/neander/meetings/log";

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

export async function fetchMeetingEvents(meetingId: string): Promise<MeetingEvent[]> {
  const res = await fetch(`${BASE}?meetingId=${encodeURIComponent(meetingId)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`기록을 불러오지 못했습니다 (HTTP ${res.status})`);
  return ((await res.json()) as { events: MeetingEvent[] }).events;
}

/** 회의를 지울 때 — 그 회의의 기록도 지운다 (실패해도 삭제를 막지 않는다) */
export function deleteMeetingLog(meetingId: string): void {
  void (async () => {
    try {
      await fetch(BASE, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-meeting", meetingId }),
      });
    } catch (e) {
      console.warn("회의 기록을 지우지 못했습니다", e);
    }
  })();
}

/**
 * 한 일을 남긴다. 기록이 실패해도 사용자가 한 일(저장·만들기)은 이미 끝났으므로
 * 부르는 쪽을 막지 않는다 — 조용히 삼키고 콘솔에만 남긴다.
 */
export function logMeetingEvent(meetingId: string, kind: MeetingEventKind, detail?: string): void {
  void (async () => {
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, kind, detail }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.warn("회의 기록을 남기지 못했습니다", e);
    }
  })();
}
