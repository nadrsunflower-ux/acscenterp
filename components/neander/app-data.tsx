"use client";

// ============================================================
//  전역 데이터 컨텍스트 — NEANDER ERP
//  - members/sales/tasks/requests를 한 번만 실시간 구독해 공유
//  - 로그인한 Google 계정(useAuth)을 팀원(member)과 이메일로 매칭해
//    "현재 사용자"(currentMember)와 접근권한(authorized)을 도출
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { subscribeMembers } from "@/lib/neander/db/members";
import { subscribeSales } from "@/lib/neander/db/sales";
import { subscribeTasks } from "@/lib/neander/db/tasks";
import { subscribeRequests } from "@/lib/neander/db/requests";
import { useAuth } from "@/components/neander/auth";
import { isAllowedEmail } from "@/lib/neander/access";
import type { Member, Sale, DailyTask, WorkRequest } from "@/lib/neander/types";

interface AppDataValue {
  members: Member[];
  sales: Sale[];
  tasks: DailyTask[];
  requests: WorkRequest[];
  /** members 최초 로드 전 */
  loading: boolean;
  /** 로그인 계정이 접근 허용 대상인지 (팀원 이메일 또는 관리자) */
  authorized: boolean;
  /** 로그인 계정과 매칭된 팀원 (없으면 null) */
  currentMember: Member | null;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [requests, setRequests] = useState<WorkRequest[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);

  useEffect(() => {
    const unsubs = [
      subscribeMembers((m) => {
        setMembers(m);
        setMembersLoaded(true);
      }),
      subscribeSales(setSales),
      subscribeTasks(setTasks),
      subscribeRequests(setRequests),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const email = user?.email?.toLowerCase() ?? null;

  const currentMember = useMemo(
    () => members.find((m) => (m.email ?? "").toLowerCase() === email) ?? null,
    [members, email],
  );

  const authorized = useMemo(
    () =>
      isAllowedEmail(
        email,
        members.map((m) => (m.email ?? "").toLowerCase()).filter(Boolean),
      ),
    [members, email],
  );

  const value: AppDataValue = {
    members,
    sales,
    tasks,
    requests,
    loading: !membersLoaded,
    authorized,
    currentMember,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
