"use client";

// ============================================================
//  회의 기록 — 누가 무엇을 했는지 한 줄씩
// ------------------------------------------------------------
//  회의 문서 하나를 팀이 같이 고친다. 「이 파일 누가 올렸지」 ·
//  「이 액션플랜 누가 넣었지」 를 문서 끝에서 바로 볼 수 있게 한다.
//
//  기록은 서버가 남긴다(lib/neander/meetings/log.ts). 남기는 요청은 화면을
//  막지 않고 뒤따라가므로, 방금 한 일이 아직 안 보일 수 있다 — 그래서 문서가
//  바뀐 뒤 한 번 더 읽는다.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button, MemberAvatar, SectionHeader } from "@/components/neander/ui";
import { fetchMeetingEvents } from "@/lib/neander/meetings/log-client";
import { meetingEventText, type MeetingEvent } from "@/lib/neander/meetings/log";
import { formatTimestamp } from "@/lib/neander/format";

/** 처음에 보여 주는 줄 수 — 나머지는 눌러서 편다 */
const FIRST = 6;

export interface MemberLook {
  name: string;
  color?: string;
  avatar?: string;
}

/**
 * 한 회의의 기록. version 이 바뀌면 다시 읽는다 (문서를 고쳤거나 첨부·녹음이
 * 바뀐 때) — 기록 남기기는 뒤따라가므로 조금 뒤에 한 번 더 읽는다.
 */
export function useMeetingLog(meetingId: string | null, version: string) {
  const [events, setEvents] = useState<MeetingEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const read = useCallback(async () => {
    if (!meetingId) return;
    try {
      setEvents(await fetchMeetingEvents(meetingId));
      setLoaded(true);
    } catch {
      // 기록을 못 읽는 것으로 화면을 막지 않는다 — 문서는 그대로 보인다
    }
  }, [meetingId]);

  useEffect(() => {
    setLoaded(false);
    setEvents([]);
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) return;
    void read();
    // 방금 남긴 기록이 서버에 닿을 시간을 준 뒤 한 번 더
    const t = setTimeout(() => void read(), 1500);
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [meetingId, version, read]);

  /** 문서를 마지막으로 고친 사람 (첨부·녹음 말고 글을 고친 것만) */
  const lastEdit = events.find((e) => e.kind === "created" || e.kind === "edited" || e.kind === "minutes-ai") ?? null;

  return { events, loaded, lastEdit, refresh: read };
}

export function MeetingLog({
  events,
  loaded,
  memberOf,
}: {
  events: MeetingEvent[];
  loaded: boolean;
  memberOf: (email: string) => MemberLook;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, FIRST);

  return (
    <div>
      <SectionHeader
        as="h3"
        title="기록"
        hint={events.length ? `${events.length}건 · 누가 무엇을 했는지` : undefined}
      />
      {events.length === 0 ? (
        <p className="text-nd-caption text-nd-fg-3">
          {loaded ? "아직 남은 기록이 없습니다. 지금부터 고치거나 올린 일이 여기에 쌓입니다." : "기록을 불러오는 중…"}
        </p>
      ) : (
        <>
          <ol className="flex flex-col">
            {shown.map((e) => {
              const who = memberOf(e.by);
              return (
                <li key={e.id} className="flex items-start gap-2.5 border-b border-nd-line py-2.5 last:border-b-0">
                  <MemberAvatar name={who.name} color={who.color} avatar={who.avatar} className="mt-0.5 h-5 w-5 text-[10px]" />
                  <p className="min-w-0 flex-1 text-nd-caption text-nd-fg-2">
                    <span className="font-semibold text-nd-fg">{who.name}</span>
                    {" · "}
                    {meetingEventText(e)}
                  </p>
                  <span className="nd-num shrink-0 text-nd-micro text-nd-fg-3">{formatTimestamp(e.at)}</span>
                </li>
              );
            })}
          </ol>
          {!all && events.length > FIRST && (
            <Button variant="ghost" size="sm" icon={History} className="mt-1" onClick={() => setAll(true)}>
              이전 기록 {events.length - FIRST}건 더 보기
            </Button>
          )}
        </>
      )}
    </div>
  );
}
