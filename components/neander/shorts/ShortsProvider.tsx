"use client";

// ============================================================
//  AI STUDIO 데이터 — 워크스페이스 한 벌을 서버에서 받아 화면들이 나눠 쓴다
// ------------------------------------------------------------
//  재무처럼 증분 동기화할 만큼 크지 않다 (소재 · 프로젝트 수십 건). 처음 들어올
//  때 한 번, 창에 돌아올 때 · 작업이 끝났을 때 다시 받는다. 받는 동안에도 앞서
//  받은 사본을 그대로 보여 준다 (화면이 깜빡이지 않게).
//
//  「보기」 (viewer) — 사람별로 따로 관리하고, 필요하면 몰아 본다:
//    mine     내가 만든 것만 (기본)
//    visible  볼 수 있는 전체 — 일반: 내 것 + 팀 공개 · 관리자: 모든 사람 (읽기 전용)
//    <이메일> 그 사람의 것만 (일반은 팀 공개만 보인다)
//  관리자가 mine 이 아닌 보기를 고르면 서버에 scope=all 로 받는다.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppData } from "@/components/neander/app-data";
import { shortsGet } from "@/lib/neander/shorts/client";
import type {
  AccountView,
  ClientView,
  IntegrationStatus,
  JobView,
  MetricSnapshotView,
  ProfileView,
  ProjectDoc,
  PublicationView,
  ScoreWeights,
  TemplateDoc,
  TrendDoc,
} from "@/lib/neander/shorts/types";
import { JOBS_EVENT } from "./ShortsRunner";

export type WithId<T> = T & { id: string };

export interface ShortsData {
  me: string;
  admin: boolean;
  scope: "mine" | "all";
  profiles: ProfileView[];
  clients: ClientView[];
  trends: WithId<TrendDoc>[];
  projects: WithId<ProjectDoc>[];
  templates: WithId<TemplateDoc>[];
  accounts: AccountView[];
  jobs: JobView[];
  publications: PublicationView[];
  metrics: MetricSnapshotView[];
  weights: ScoreWeights;
  status: IntegrationStatus;
  quotas: { youtubeSearch: { used: number; limit: number; source: "personal" | "company" | null } };
  models: {
    tts: { id: string; label: string; usdPerChar: number; voices: { id: string; label: string }[] }[];
    video: { id: string; label: string; durations: number[]; resolutions: string[]; usdPerSec: number | null }[];
  };
}

export type Viewer = "mine" | "visible" | string;

interface Ctx {
  data: ShortsData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** 서버가 돌려준 프로젝트 한 건을 사본에 끼운다 (다시 받지 않고) */
  putProject: (p: WithId<ProjectDoc>) => void;
  viewer: Viewer;
  setViewer: (v: Viewer) => void;
  /** 이메일 → ERP 팀원 이름 (없으면 이메일 앞부분) */
  nameOf: (email: string) => string;
}

const ShortsContext = createContext<Ctx | null>(null);
const VIEW_KEY = "neander.shorts.viewer";
let cache: ShortsData | null = null;

export function ShortsProvider({ children }: { children: ReactNode }) {
  const { members } = useAppData();
  const [data, setData] = useState<ShortsData | null>(cache);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewerState] = useState<Viewer>("mine");
  const seen = useRef(new Map<string, string>());
  const wantAll = useRef(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v) setViewerState(v);
    } catch {
      /* 저장소 접근 불가 — 기본값 */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await shortsGet<ShortsData>(wantAll.current ? "data?scope=all" : "data");
      cache = d;
      setData(d);
      setError(null);
      for (const j of d.jobs) seen.current.set(j.id, j.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI STUDIO 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  // 관리자가 「내 것」 밖을 보려 하면 모든 사람의 것을 받는다 (서버가 관리자인지 다시 확인한다)
  useEffect(() => {
    const next = viewer !== "mine";
    if (next !== wantAll.current) {
      wantAll.current = next;
      if (data?.admin) void refresh();
    }
  }, [viewer, data?.admin, refresh]);

  const setViewer = useCallback((v: Viewer) => {
    setViewerState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* noop */
    }
  }, []);

  const putProject = useCallback((p: WithId<ProjectDoc>) => {
    setData((d) => {
      if (!d) return d;
      const next = { ...d, projects: d.projects.some((x) => x.id === p.id) ? d.projects.map((x) => (x.id === p.id ? p : x)) : [p, ...d.projects] };
      cache = next;
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // 실행기가 작업을 끝내면 (상태가 바뀐 작업이 있으면) 다시 받는다 — 결과가 프로젝트에 적혔다
    const onJobs = (e: Event) => {
      const jobs = (e as CustomEvent<JobView[]>).detail;
      let changed = false;
      for (const j of jobs) {
        if (seen.current.get(j.id) !== j.status) changed = true;
        seen.current.set(j.id, j.status);
      }
      setData((d) => (d ? { ...d, jobs } : d));
      if (changed) void refresh();
    };
    window.addEventListener(JOBS_EVENT, onJobs);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(JOBS_EVENT, onJobs);
    };
  }, [refresh]);

  const nameOf = useCallback(
    (email: string) => members.find((m) => (m.email ?? "").toLowerCase() === email.toLowerCase())?.name ?? (email === "company" ? "회사 공용" : email.split("@")[0]),
    [members],
  );

  const value = useMemo(() => ({ data, loading, error, refresh, putProject, viewer, setViewer, nameOf }), [data, loading, error, refresh, putProject, viewer, setViewer, nameOf]);
  return <ShortsContext.Provider value={value}>{children}</ShortsContext.Provider>;
}

export function useShorts(): Ctx {
  const c = useContext(ShortsContext);
  if (!c) throw new Error("useShorts 는 ShortsProvider 안에서만 씁니다.");
  return c;
}

/**
 * 지금 「보기」 에 맞춰 거른 자료. 목록 화면은 이것을 쓴다.
 * (게시할 계정 고르기 · 공식 고르기처럼 「내가 쓸 수 있는 것」 이 필요한 곳은 data 를 그대로 쓴다)
 */
export function useScoped() {
  const { data, viewer } = useShorts();
  return useMemo(() => {
    const d = data!;
    const keep = (owner: string) => (viewer === "mine" ? owner === d.me : viewer === "visible" ? true : owner === viewer);
    // 고객사 영상은 담당자 모두의 「내 것」 이다
    const projects = d.projects.filter((p) => keep(p.owner) || (viewer === "mine" && !!p.members?.includes(d.me)));
    const ids = new Set(projects.map((p) => p.id));
    return {
      projects,
      trends: d.trends.filter((t) => keep(t.owner)),
      templates: d.templates.filter((t) => keep(t.owner)),
      publications: d.publications.filter((p) => ids.has(p.projectId)),
      metrics: d.metrics.filter((m) => ids.has(m.projectId)),
      accounts: d.accounts.filter((a) => keep(a.owner)),
      jobs: d.jobs,
      /** 남의 비공개 자료가 섞여 있는가 (관리자 몰아보기) */
      readOnlyMix: projects.some((p) => p.owner !== d.me && p.visibility === "private"),
    };
  }, [data, viewer]);
}

/** 남의 비공개 자료 — 관리자에게 보이지만 고칠 수 없다 */
export const isReadOnlyFor = (doc: { owner: string; visibility: string }, me: string) => doc.owner !== me && doc.visibility !== "team";
