"use client";

// ============================================================
//  개발 협업 허브 전역 데이터 컨텍스트 (/neander/dev)
//  - features / tasks / activity 를 한 번만 실시간 구독해 공유
//  - comments 는 대상별로 각 컴포넌트에서 개별 구독한다(전역 아님)
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { subscribeFeatures } from "@/lib/neander/dev/features";
import { subscribeDevTasks } from "@/lib/neander/dev/tasks";
import { subscribeActivity } from "@/lib/neander/dev/activity";
import type { DevFeature, DevTask, DevActivity } from "@/lib/neander/dev/types";

interface DevDataValue {
  features: DevFeature[];
  tasks: DevTask[];
  activity: DevActivity[];
  /** features 최초 로드 전 */
  loading: boolean;
  featureById: (id?: string) => DevFeature | undefined;
}

const DevDataContext = createContext<DevDataValue | null>(null);

export function DevDataProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<DevFeature[]>([]);
  const [tasks, setTasks] = useState<DevTask[]>([]);
  const [activity, setActivity] = useState<DevActivity[]>([]);
  const [featuresLoaded, setFeaturesLoaded] = useState(false);

  useEffect(() => {
    const unsubs = [
      subscribeFeatures((f) => {
        setFeatures(f);
        setFeaturesLoaded(true);
      }),
      subscribeDevTasks(setTasks),
      subscribeActivity(setActivity),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const featureMap = useMemo(() => {
    const m = new Map<string, DevFeature>();
    for (const f of features) m.set(f.id, f);
    return m;
  }, [features]);

  const value: DevDataValue = {
    features,
    tasks,
    activity,
    loading: !featuresLoaded,
    featureById: (id) => (id ? featureMap.get(id) : undefined),
  };

  return <DevDataContext.Provider value={value}>{children}</DevDataContext.Provider>;
}

export function useDevData(): DevDataValue {
  const ctx = useContext(DevDataContext);
  if (!ctx) throw new Error("useDevData must be used within DevDataProvider");
  return ctx;
}
