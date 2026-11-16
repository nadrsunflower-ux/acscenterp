// 프로젝트 워크스페이스 데이터 — 목록 · 상세가 같은 것을 나눠 쓴다 (화면을 옮겨도 다시 받지 않게 모듈에 둔다)
import { useCallback, useEffect, useState } from "react";
import { getNeanderAuth } from "@/lib/neander/firebase";
import { fetchProjects } from "./client";
import type { ProjectView } from "./view";

interface Snapshot {
  projects: ProjectView[];
  financeAccess: boolean;
}

let cache: Snapshot | null = null;
const listeners = new Set<(s: Snapshot) => void>();

const publish = (s: Snapshot) => {
  cache = s;
  listeners.forEach((f) => f(s));
};

async function reload() {
  publish(await fetchProjects());
}

/** 저장 결과 하나를 목록에 끼운다 (다시 받지 않고) */
export function putProject(p: ProjectView) {
  if (!cache) return;
  publish({ ...cache, projects: cache.projects.map((x) => (x.id === p.id ? p : x)) });
}

export function useProjects() {
  const [snap, setSnap] = useState<Snapshot | null>(cache);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    listeners.add(setSnap);
    const off = getNeanderAuth().onAuthStateChanged((u) => {
      if (u) void refresh();
    });
    return () => {
      listeners.delete(setSnap);
      off();
    };
  }, [refresh]);

  return { projects: snap?.projects ?? [], financeAccess: snap?.financeAccess ?? false, loading, error, refresh };
}
