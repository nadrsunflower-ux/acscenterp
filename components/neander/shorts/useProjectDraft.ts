"use client";

// ============================================================
//  프로젝트 편집 사본 — 고치면 1.2초 뒤 저절로 저장 (저장 버튼 없음)
// ------------------------------------------------------------
//  서버는 baseUpdatedAt 이 다르면 409 를 준다. 그때:
//   · 마지막으로 고친 쪽이 실행기 · 나(다른 동작)면 → 서버가 적은 칸(내레이션 · AI 장면
//     결과 · 완성 파일 · 프로그램 확인)만 서버 것으로 바꿔 끼우고 한 번 더 저장한다
//   · 다른 사람이면 → 덮지 않는다. 「최신 불러오기」 를 띄운다 (내 변경은 버려짐)
//  서버가 다듬은 값(확인한 사람 · 시각)은 저장이 끝나면 화면에 다시 들어온다 —
//  단, 그 사이에 또 고쳤으면 내 사본을 지킨다 (타이핑이 되돌아가지 않게).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate, ShortsApiError } from "@/lib/neander/shorts/client";
import type { ProjectDoc } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "./ShortsProvider";

export type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";
type P = WithId<ProjectDoc>;

/** 서버(실행기)가 적는 칸만 서버 것으로 */
export function mergeServerOwned(local: P, server: P): P {
  const byId = new Map(server.scenes.map((s) => [s.id, s]));
  return {
    ...local,
    narration: server.narration.kind === "ai" || local.narration.kind === "ai" ? server.narration : local.narration,
    review: server.review,
    members: server.members,
    clientName: server.clientName,
    subtitles: local.subtitles.edited ? local.subtitles : server.subtitles,
    renderIds: server.renderIds,
    stage: server.stage === "published" || server.stage === "ready" ? (local.stage === "archived" ? local.stage : server.stage) : local.stage,
    costs: server.costs,
    chinese: { ...local.chinese, generatedAt: server.chinese.generatedAt },
    compliance: Object.fromEntries(
      Object.entries({ ...server.compliance, ...local.compliance }).map(([k, v]) => [k, { system: server.compliance[k as keyof typeof server.compliance]?.system ?? null, user: v?.user ?? null }]),
    ),
    coupang: { ...local.coupang, affiliate: server.coupang.affiliate?.method === "api" && server.coupang.affiliate.url !== local.coupang.affiliate?.url ? server.coupang.affiliate : local.coupang.affiliate },
    scenes: local.scenes.map((s) => {
      const sv = byId.get(s.id);
      if (!s.ai || !sv?.ai) return s;
      const serverNewer = sv.ai.jobId !== s.ai.jobId || ["generating", "review", "failed"].includes(sv.ai.status) && s.ai.status === "generating";
      return serverNewer ? { ...s, ai: { ...s.ai, status: sv.ai.status, jobId: sv.ai.jobId, fileId: sv.ai.fileId, model: sv.ai.model }, duration: sv.duration } : s;
    }),
    updatedAt: server.updatedAt,
    updatedBy: server.updatedBy,
  };
}

/** readOnly — 관리자가 남의 비공개 프로젝트를 몰아볼 때. 고쳐도 사본만 바뀌지 않고 저장도 안 한다 */
export function useProjectDraft(initial: P, readOnly = false) {
  const { putProject, data } = useShorts();
  const [p, setP] = useState<P>(initial);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(p);
  const base = useRef(initial.updatedAt);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  ref.current = p;

  const save = useCallback(async (): Promise<void> => {
    if (saving.current) await saving.current;
    if (!dirty.current) return;
    const run = (async () => {
      dirty.current = false;
      setState("saving");
      const attempt = async (doc: P, baseAt: number): Promise<P> => {
        const r = await mutate<{ project: P }>("project.save", { id: doc.id, project: doc, baseUpdatedAt: baseAt });
        return r.project;
      };
      try {
        let saved: P;
        try {
          saved = await attempt(ref.current, base.current);
        } catch (e) {
          if (!(e instanceof ShortsApiError && e.status === 409)) throw e;
          const { project: latest } = await mutate<{ project: P }>("project.get", { id: ref.current.id });
          const me = data?.me;
          // 실행기 · 나 · 검토 링크(고객사)가 고친 것은 서버 칸이라 합쳐 끼운다 — 다른 사람만 충돌
          if (latest.updatedBy !== "실행기" && latest.updatedBy !== me && !latest.updatedBy.startsWith("고객사 ")) {
            setState("conflict");
            setError(`${latest.updatedBy} 님이 먼저 고쳤습니다. 최신 내용을 불러오면 이 창에서 저장하지 못한 변경은 사라집니다.`);
            dirty.current = true;
            return;
          }
          const merged = mergeServerOwned(ref.current, latest);
          saved = await attempt(merged, latest.updatedAt);
        }
        base.current = saved.updatedAt;
        putProject(saved);
        if (!dirty.current) setP(saved);
        else setP((cur) => ({ ...cur, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy }));
        setState(dirty.current ? "dirty" : "saved");
        setError(null);
      } catch (e) {
        dirty.current = true;
        setState("error");
        setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [data?.me, putProject]);

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 1200);
  }, [save]);

  /** 사본 고치기 — 함수 안에서 바로 고친다 (깊은 복사본이 넘어온다) */
  const update = useCallback(
    (fn: (draft: P) => void) => {
      if (readOnly) return;
      setP((prev) => {
        const next = structuredClone(prev);
        fn(next);
        return next;
      });
      dirty.current = true;
      setState("dirty");
      schedule();
    },
    [schedule, readOnly],
  );

  /** 남은 변경을 지금 저장 (서버 동작 전에) */
  const flush = useCallback(async () => {
    if (readOnly) throw new Error("읽기 전용으로 보는 중입니다 — 남의 비공개 영상은 고칠 수 없습니다.");
    if (timer.current) window.clearTimeout(timer.current);
    await save();
    if (dirty.current && state === "conflict") throw new Error("저장 충돌을 먼저 정리해 주세요.");
  }, [save, state, readOnly]);

  /** 서버가 돌려준 최신 프로젝트로 바꾼다 (AI · 조사 · 실행기 결과) */
  const replace = useCallback(
    (next: P) => {
      base.current = next.updatedAt;
      putProject(next);
      if (dirty.current) setP((cur) => mergeServerOwned(cur, next));
      else setP(next);
    },
    [putProject],
  );

  const reloadLatest = useCallback(async () => {
    const { project } = await mutate<{ project: P }>("project.get", { id: ref.current.id });
    dirty.current = false;
    base.current = project.updatedAt;
    putProject(project);
    setP(project);
    setState("saved");
    setError(null);
  }, [putProject]);

  // 실행기 결과로 공용 사본이 새로워지면 따라간다
  const shared = data?.projects.find((x) => x.id === initial.id);
  useEffect(() => {
    if (!shared || shared.updatedAt <= base.current) return;
    base.current = shared.updatedAt;
    if (dirty.current) setP((cur) => mergeServerOwned(cur, shared));
    else setP(shared);
  }, [shared]);

  // 떠나기 전에 남은 변경
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        void save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
      if (timer.current) window.clearTimeout(timer.current);
      if (dirty.current) void save();
    };
  }, [save]);

  return { p, update, flush, replace, state, error, reloadLatest };
}

export type Draft = ReturnType<typeof useProjectDraft>;
